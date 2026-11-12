import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { sql, send, requireUser, throttle, notifyAdmins, clientIp, sameOrigin, audit, str, ensureSchema, wrap } from "./_lib.js";

const BOOT = Date.now();
const ROOT = process.cwd();
const DIRS = ["api", "js", "css", "html"];
const FILES = ["index.html", "vercel.json", "package.json"];
const KINDS = ["error", "security", "contract", "validation", "slow", "client"];

// ---------- Lecture du code déployé ----------
function walk(dir, out = []) {
  let ents; try { ents = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) { const rel = dir + "/" + e.name; if (e.isDirectory()) walk(rel, out); else out.push(rel); }
  return out;
}
function readSources() {
  const names = [...FILES.filter((f) => fs.existsSync(path.join(ROOT, f))), ...DIRS.flatMap((d) => walk(d))].filter((f) => /\.(js|mjs|html|css|json)$/.test(f)).sort();
  return names.map((f) => { const buf = fs.readFileSync(path.join(ROOT, f)); return { path: f, size: buf.length, sha: crypto.createHash("sha256").update(buf).digest("hex"), text: buf.toString("utf8") }; });
}

// ---------- Analyse de sécurité du code (règles heuristiques) ----------
const RULES = [
  { id: "secret", sev: "critique", re: /(sk_live_[0-9a-zA-Z]{10,}|FLWSECK-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|postgres(?:ql)?:\/\/[^\s'"`:]+:[^\s'"`@]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})/, msg: "Secret ou identifiant en clair dans le code", fix: "Retirez-le du dépôt, régénérez-le, puis placez-le dans les variables d’environnement Vercel." },
  { id: "eval", sev: "haute", re: /\beval\s*\(|new\s+Function\s*\(/, msg: "Exécution de code dynamique (eval / new Function)", fix: "Supprimez-la : elle permet d’exécuter du code injecté." },
  { id: "exec", sev: "haute", re: /child_process|\bexecSync?\s*\(|\bspawn\s*\(/, files: /^api\//, msg: "Exécution de commandes système", fix: "À éviter ; jamais avec des données venant d’un utilisateur." },
  { id: "sqlcat", sev: "haute", re: /\bsql\s*\(\s*(`|["'][^"']*["']\s*\+)/, msg: "Requête SQL construite par concaténation", fix: "Utilisez uniquement les gabarits paramétrés sql`…${valeur}`." },
  { id: "hardpw", sev: "haute", re: /(password|passwd|pwd|secret|token)\s*[:=]\s*["'][^"'\s]{6,}["']/i, msg: "Mot de passe ou jeton possiblement codé en dur", fix: "Déplacez-le dans une variable d’environnement." },
  { id: "storage", sev: "haute", re: /localStorage\.setItem\([^)]*(token|password|secret)/i, msg: "Secret stocké dans le navigateur", fix: "Utilisez des cookies HttpOnly (déjà le cas pour les sessions)." },
  { id: "cors", sev: "moyenne", re: /Access-Control-Allow-Origin["'`]?\s*,\s*["'`]\*/, msg: "CORS ouvert à tous les sites", fix: "Restreignez à votre domaine." },
  { id: "docwrite", sev: "moyenne", re: /document\.write\s*\(/, msg: "document.write", fix: "Utilisez des méthodes DOM sûres." },
  { id: "rand", sev: "moyenne", re: /Math\.random\s*\(/, files: /^api\//, msg: "Math.random côté serveur", fix: "Pour la sécurité, utilisez crypto.randomBytes." },
  { id: "innerhtml", sev: "basse", re: /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(/, files: /^js\//, msg: "Insertion HTML dynamique", fix: "Vérifiez que toutes les données insérées sont échappées (fonction esc)." },
  { id: "blank", sev: "basse", re: /target=["']_blank["'](?![^>]*noopener)/, files: /\.html$|^js\//, msg: "Lien target=_blank sans rel=noopener", fix: "Ajoutez rel=\"noopener noreferrer\"." },
  { id: "inline", sev: "basse", re: /\son(click|load|error|mouseover)\s*=\s*["']/, files: /\.html$/, msg: "Gestionnaire d’événement en ligne (HTML)", fix: "Préférez addEventListener (compatible avec la CSP)." },
  { id: "http", sev: "basse", re: /["'(]http:\/\/(?!localhost|127\.|www\.w3\.org)/, msg: "Lien non sécurisé http://", fix: "Utilisez https://." }
];
const SEV = { critique: 0, haute: 1, moyenne: 2, basse: 3 };

function scan(sources) {
  const out = [], inner = {};
  for (const s of sources) {
    if (s.path === "api/monitor.js") continue; // ce fichier contient les règles elles-mêmes
    const lines = s.text.split("\n");
    lines.forEach((line, i) => {
      for (const r of RULES) {
        if (r.files && !r.files.test(s.path)) continue;
        if (r.id === "innerhtml") { if (r.re.test(line)) inner[s.path] = (inner[s.path] || 0) + 1; continue; }
        if (r.re.test(line)) out.push({ file: s.path, line: i + 1, sev: r.sev, rule: r.msg, fix: r.fix, snippet: line.trim().replace(/(:\/\/[^:\s]+:)[^@\s]+@/, "$1***@").slice(0, 110) });
      }
      if (/\.html$/.test(s.path) && /<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:/.test(line) && !/integrity=/.test(line) && !/fonts\.googleapis/.test(line))
        out.push({ file: s.path, line: i + 1, sev: "moyenne", rule: "Feuille de style externe sans contrôle d’intégrité (SRI)", fix: "Ajoutez integrity= et crossorigin=.", snippet: line.trim().slice(0, 110) });
      if (/\.html$/.test(s.path) && /<script[^>]+src=["']https?:/.test(line) && !/integrity=/.test(line))
        out.push({ file: s.path, line: i + 1, sev: "moyenne", rule: "Script externe sans contrôle d’intégrité (SRI)", fix: "Ajoutez integrity= et crossorigin=.", snippet: line.trim().slice(0, 110) });
    });
  }
  for (const [file, n] of Object.entries(inner)) out.push({ file, line: 0, sev: "basse", rule: `Insertion HTML dynamique (${n} endroits)`, fix: "Vérifiez que toutes les données insérées sont échappées (fonction esc).", snippet: "" });
  return out.sort((a, b) => SEV[a.sev] - SEV[b.sev]).slice(0, 120);
}

async function integrity(sources) {
  const base = await sql`SELECT path, sha256, approved_at FROM code_baseline`;
  const bm = new Map(base.map((b) => [b.path, b])), cm = new Map(sources.map((s) => [s.path, s]));
  return {
    baselineSet: base.length > 0, approvedAt: base[0]?.approved_at || null, total: sources.length,
    modified: sources.filter((s) => bm.has(s.path) && bm.get(s.path).sha256 !== s.sha).map((s) => s.path),
    added: sources.filter((s) => base.length && !bm.has(s.path)).map((s) => s.path),
    removed: base.filter((b) => !cm.has(b.path)).map((b) => b.path)
  };
}

// ---------- Dépendances : vulnérabilités connues (base OSV) ----------
async function timed(url, init = {}, ms = 5000) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), ms), t0 = Date.now();
  try { const r = await fetch(url, { ...init, signal: ctrl.signal }); return { r, ms: Date.now() - t0 }; }
  catch (e) { return { r: null, ms: Date.now() - t0, error: String(e.message || e).slice(0, 100) }; }
  finally { clearTimeout(t); }
}
async function osv(name, version) {
  const { r } = await timed("https://api.osv.dev/v1/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package: { name, ecosystem: "npm" }, version }) });
  if (!r || !r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return (d.vulns || []).slice(0, 8).map((v) => ({ id: v.id, summary: (v.summary || "").slice(0, 160) }));
}
async function deps(sources) {
  const list = new Map();
  try {
    const pkg = JSON.parse(sources.find((s) => s.path === "package.json")?.text || "{}");
    for (const n of Object.keys(pkg.dependencies || {})) {
      let v = null; try { v = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", n, "package.json"), "utf8")).version; } catch { v = String(pkg.dependencies[n]).replace(/^[^\d]*/, ""); }
      list.set("npm:" + n, { name: n, version: v, where: "serveur" });
    }
  } catch { /* ignore */ }
  for (const s of sources.filter((x) => x.path.endsWith(".html"))) {
    for (const m of s.text.matchAll(/cdn\.jsdelivr\.net\/npm\/((?:@[\w.-]+\/)?[\w.-]+)@(\d+\.\d+\.\d+)/g)) list.set("cdn:" + m[1], { name: m[1], version: m[2], where: "navigateur (" + s.path + ")" });
  }
  const items = [...list.values()];
  const res = await Promise.all(items.map((i) => osv(i.name, i.version)));
  return items.map((i, k) => ({ ...i, vulns: res[k], checked: res[k] !== null }));
}

// ---------- Serveur ----------
const PROBES = ["/", "/acheter", "/admin", "/api/properties", "/api/monitor?a=health"];
async function probes(req) {
  const origin = "https://" + (process.env.VERCEL_PROJECT_PRODUCTION_URL || req.headers.host);
  return Promise.all(PROBES.map(async (p) => {
    const { r, ms, error } = await timed(origin + p, { redirect: "manual", headers: { "user-agent": "maison-supervision" } });
    const h = (k) => (r ? r.headers.get(k) : null);
    return { path: p, status: r ? r.status : 0, ms, error, headers: p === "/" && r ? { csp: !!h("content-security-policy"), hsts: !!h("strict-transport-security"), nosniff: !!h("x-content-type-options"), frame: !!h("x-frame-options"), referrer: !!h("referrer-policy"), coop: !!h("cross-origin-opener-policy") } : undefined };
  }));
}
async function deployments() {
  const tok = process.env.SUPERVISION_VERCEL_TOKEN, pid = process.env.SUPERVISION_PROJECT_ID || process.env.VERCEL_PROJECT_ID, tid = process.env.SUPERVISION_TEAM_ID;
  if (!tok || !pid) return { configured: false };
  const { r } = await timed(`https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(pid)}${tid ? "&teamId=" + encodeURIComponent(tid) : ""}&limit=8`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r || !r.ok) return { configured: true, error: "Jeton refusé ou API Vercel indisponible." };
  const d = await r.json();
  return { configured: true, list: (d.deployments || []).map((x) => ({ state: x.state || x.readyState, target: x.target || "preview", created: x.created || x.createdAt, commit: (x.meta?.githubCommitMessage || "").slice(0, 100), sha: (x.meta?.githubCommitSha || "").slice(0, 7), author: x.meta?.githubCommitAuthorLogin || x.creator?.username || "" })) };
}
const ENV_CHECKS = [["DATABASE_URL", "Base de données Neon"], ["APP_SECRET", "Clé de chiffrement 2FA"], ["FLW_SECRET_KEY", "Paiement en ligne (Flutterwave)"], ["FLW_WEBHOOK_HASH", "Secret du webhook de paiement"], ["WA_ACCESS_TOKEN", "WhatsApp (jeton)"], ["WA_PHONE_ID", "WhatsApp (numéro)"], ["WA_TEMPLATE", "WhatsApp (modèle)"], ["CRON_SECRET", "Contrôle automatique quotidien"], ["SUPERVISION_VERCEL_TOKEN", "Suivi des déploiements Vercel"], ["RESEND_API_KEY", "E-mails (mot de passe oublié) : clé Resend"], ["MAIL_FROM", "E-mails : adresse d’expédition"], ["SITE_URL", "Adresse du site pour les liens e-mail"]];

async function dbLatency() { const t0 = Date.now(); await sql`SELECT 1`; return Date.now() - t0; }

async function handler(req, res) {
  const a = req.query.a;

  // Sonde publique minimale (pour un service d'uptime externe)
  if (a === "health") {
    try { const ms = await dbLatency(); return send(res, 200, { ok: true, db: ms }); }
    catch { return send(res, 503, { ok: false }); }
  }

  // Erreurs JavaScript du navigateur (visiteurs)
  if (a === "client_error") {
    if (req.method !== "POST" || !sameOrigin(req)) return send(res, 405, { error: "Refusé" });
    if (!(await throttle(req, res, "cerr", 20, 600))) return;
    const b = req.body || {};
    await sql`INSERT INTO app_events (kind, api, method, ip, detail) VALUES ('client', 'navigateur', 'JS', ${clientIp(req)}, ${(str(b.message, 250) + " @ " + str(b.page, 80) + " " + str(b.source, 120) + ":" + (Number(b.line) || 0))})`;
    return send(res, 200, { ok: true });
  }

  // Contrôle quotidien automatique (Vercel Cron)
  if (a === "cron") {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: "Refusé" });
    const alerts = [], log = (name, ok, ms, detail) => sql`INSERT INTO monitor_checks (name, ok, ms, detail) VALUES (${name}, ${ok}, ${ms}, ${String(detail).slice(0, 400)})`;
    try { const ms = await dbLatency(); await log("Base de données", true, ms, "Répond en " + ms + " ms"); } catch (e) { await log("Base de données", false, 0, e.message); alerts.push("Base de données injoignable"); }
    const sources = readSources();
    if (sources.length > 5) {
      const ig = await integrity(sources), n = ig.modified.length + ig.added.length + ig.removed.length;
      await log("Intégrité du code", !ig.baselineSet || n === 0, 0, !ig.baselineSet ? "Aucune version de référence approuvée" : n === 0 ? "Code identique à la version approuvée" : `${n} fichier(s) différent(s) : ${[...ig.modified, ...ig.added, ...ig.removed].slice(0, 6).join(", ")}`);
      if (ig.baselineSet && n > 0) alerts.push(`Code modifié depuis la version approuvée (${n} fichier(s))`);
      const crit = scan(sources).filter((f) => ["critique", "haute"].includes(f.sev));
      await log("Analyse du code", crit.length === 0, 0, crit.length ? crit.slice(0, 4).map((f) => f.file + ": " + f.rule).join(" | ") : "Aucun problème critique ou élevé");
      if (crit.length) alerts.push(`${crit.length} alerte(s) de sécurité dans le code`);
      const dp = await deps(sources), bad = dp.filter((d) => d.vulns && d.vulns.length);
      await log("Dépendances", bad.length === 0, 0, bad.length ? bad.map((d) => `${d.name}@${d.version} (${d.vulns.length})`).join(", ") : "Aucune vulnérabilité connue");
      if (bad.length) alerts.push(`Dépendance(s) vulnérable(s) : ${bad.map((d) => d.name).join(", ")}`);
    }
    const [e] = await sql`SELECT count(*)::int AS n FROM app_events WHERE kind = 'error' AND at > now() - interval '24 hours'`;
    await log("Erreurs serveur (24 h)", e.n < 10, 0, e.n + " erreur(s)");
    if (e.n >= 10) alerts.push(`${e.n} erreurs serveur en 24 h`);
    const atk = await sql`SELECT ip, count(*)::int AS n FROM app_events WHERE kind = 'security' AND at > now() - interval '1 hour' AND ip <> '' GROUP BY ip HAVING count(*) >= 15 ORDER BY n DESC LIMIT 3`;
    await log("Attaques (1 h)", atk.length === 0, 0, atk.length ? atk.map((x) => `${x.ip} (${x.n})`).join(", ") : "Aucune activité suspecte");
    if (atk.length) alerts.push(`Activité suspecte : ${atk.map((x) => x.ip).join(", ")}`);
    if (alerts.length) await notifyAdmins("alert", "Alerte supervision", alerts.join(" · "));
    await sql`DELETE FROM app_events WHERE at < now() - interval '30 days'`;
    await sql`DELETE FROM monitor_checks WHERE at < now() - interval '90 days'`;
    await sql`DELETE FROM api_stats WHERE day < current_date - 90`;
    await sql`DELETE FROM rate_hits WHERE at < now() - interval '1 day'`;
    return send(res, 200, { ok: true, alerts });
  }

  // ===== Tout le reste : super administrateur uniquement =====
  const me = await requireUser(req, res, "super_admin");
  if (!me) return;

  if (a === "overview") {
    const ev = await sql`SELECT kind, count(*)::int AS n FROM app_events WHERE at > now() - interval '24 hours' GROUP BY kind`;
    const stats = await sql`SELECT api, class, sum(n)::int AS n, sum(ms)::bigint AS ms FROM api_stats WHERE day >= current_date - 6 GROUP BY api, class`;
    const daily = await sql`SELECT to_char(day, 'DD/MM') AS day, sum(n)::int AS n, coalesce(sum(n) FILTER (WHERE class = '5xx'), 0)::int AS errors FROM api_stats WHERE day >= current_date - 13 GROUP BY day ORDER BY day`;
    const ips = await sql`SELECT ip, count(*)::int AS n, count(*) FILTER (WHERE status = 401)::int AS fails, max(at) AS last FROM app_events WHERE kind = 'security' AND at > now() - interval '24 hours' AND ip <> '' GROUP BY ip ORDER BY n DESC LIMIT 10`;
    const checks = await sql`SELECT DISTINCT ON (name) name, ok, ms, detail, at FROM monitor_checks ORDER BY name, at DESC`;
    const [t] = await sql`SELECT count(*)::int AS n FROM app_events`;
    return send(res, 200, { events24: Object.fromEntries(ev.map((x) => [x.kind, x.n])), stats, daily, ips, checks, logSize: t.n, uptimeSec: Math.round((Date.now() - BOOT) / 1000) });
  }

  // Présence : un utilisateur est « en ligne » s'il a une session valide et une activité de moins de 5 minutes
  if (a === "users") {
    await ensureSchema();
    const admins = await sql`SELECT u.id, u.name, u.email, u.role, u.active, u.last_seen,
      (EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AND u.last_seen > now() - interval '5 minutes') AS online
      FROM users u ORDER BY (u.role = 'super_admin') DESC, u.created_at`;
    const customers = await sql`SELECT c.id, c.name, c.email, c.active, c.last_seen, c.last_login,
      (EXISTS (SELECT 1 FROM customer_sessions s WHERE s.customer_id = c.id AND s.expires_at > now()) AND c.last_seen > now() - interval '5 minutes') AS online
      FROM customers c WHERE c.archived_at IS NULL ORDER BY c.last_seen DESC NULLS LAST LIMIT 500`;
    let avatars = {};
    try { (await sql`SELECT id, avatar FROM users WHERE avatar <> ''`).forEach((r) => { avatars[r.id] = r.avatar; }); } catch { /* colonne absente */ }
    return send(res, 200, {
      admins: admins.map((x) => ({ ...x, online: !!x.online || x.id === me.id, avatar: avatars[x.id] || "" })),
      customers: customers.map((x) => ({ ...x, online: !!x.online }))
    });
  }

  if (a === "events") {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : null;
    const rows = kind
      ? await sql`SELECT id, at, kind, api, action, method, status, ms, ip, detail FROM app_events WHERE kind = ${kind} ORDER BY at DESC LIMIT 200`
      : await sql`SELECT id, at, kind, api, action, method, status, ms, ip, detail FROM app_events ORDER BY at DESC LIMIT 200`;
    return send(res, 200, rows);
  }

  if (a === "db") {
    const ms = await dbLatency();
    const [info] = await sql`SELECT pg_database_size(current_database())::bigint AS size, current_setting('server_version') AS version`;
    const conns = await sql`SELECT coalesce(state, 'système') AS state, count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1`;
    const [st] = await sql`SELECT numbackends::int, xact_commit::bigint, xact_rollback::bigint, blks_hit::bigint, blks_read::bigint, deadlocks::bigint, temp_files::bigint, conflicts::bigint FROM pg_stat_database WHERE datname = current_database()`;
    const tables = await sql`SELECT relname, n_live_tup::bigint AS rows, n_dead_tup::bigint AS dead, pg_total_relation_size(relid)::bigint AS size, seq_scan::bigint AS seq, coalesce(idx_scan, 0)::bigint AS idx FROM pg_stat_user_tables ORDER BY size DESC LIMIT 25`;
    const running = await sql`SELECT pid, extract(epoch FROM (now() - query_start))::float AS secs, left(query, 100) AS q, state FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid() ORDER BY query_start LIMIT 5`;
    let slow = [];
    try { slow = await sql`SELECT left(query, 110) AS q, calls::bigint, round(mean_exec_time::numeric, 1)::float AS mean_ms, round(total_exec_time::numeric)::float AS total_ms FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND query NOT ILIKE 'CREATE%' ORDER BY mean_exec_time DESC LIMIT 8`; } catch { /* extension absente */ }
    return send(res, 200, { latency: ms, size: Number(info.size), version: info.version, conns, stats: st, tables, running, slow });
  }

  if (a === "server") {
    const [pr, dep] = await Promise.all([probes(req), deployments()]);
    const mem = process.memoryUsage();
    return send(res, 200, {
      runtime: { node: process.version, region: process.env.VERCEL_REGION || "inconnue", env: process.env.VERCEL_ENV || "inconnu", commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7), message: (process.env.VERCEL_GIT_COMMIT_MESSAGE || "").slice(0, 100), author: process.env.VERCEL_GIT_COMMIT_AUTHOR_LOGIN || "", memMb: Math.round(mem.rss / 1048576), instanceAgeSec: Math.round((Date.now() - BOOT) / 1000) },
      config: ENV_CHECKS.map(([k, label]) => ({ label, set: !!process.env[k] })), probes: pr, deployments: dep
    });
  }

  if (a === "code") {
    const sources = readSources();
    if (sources.length <= 5) return send(res, 200, { readable: false, count: sources.length });
    return send(res, 200, { readable: true, count: sources.length, bytes: sources.reduce((s, f) => s + f.size, 0), integrity: await integrity(sources), findings: scan(sources) });
  }
  if (a === "deps") return send(res, 200, await deps(readSources()));

  if (a === "approve" && req.method === "POST") {
    if (!sameOrigin(req)) return send(res, 403, { error: "Origine refusée" });
    const sources = readSources();
    if (sources.length <= 5) return send(res, 400, { error: "Code déployé illisible : impossible d’approuver." });
    const obj = Object.fromEntries(sources.map((s) => [s.path, s.sha]));
    await sql`DELETE FROM code_baseline`;
    await sql`INSERT INTO code_baseline (path, sha256, approved_by) SELECT key, value, ${me.id} FROM jsonb_each_text(${JSON.stringify(obj)}::jsonb)`;
    await audit(me.id, "code.baseline_approved", sources.length + " fichiers");
    return send(res, 200, { ok: true, files: sources.length });
  }
  send(res, 404, { error: "Inconnu" });
}

export default wrap("monitor", handler);
