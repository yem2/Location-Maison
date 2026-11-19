#!/usr/bin/env node
/**
 * Sauvegarde automatique des variables d'environnement Vercel (chiffrée).
 *
 *  node scripts/sync-env.mjs              → une synchronisation (crée une sauvegarde seulement s'il y a du nouveau)
 *  node scripts/sync-env.mjs --watch 10   → tourne en continu, vérifie toutes les 10 minutes
 *  node scripts/sync-env.mjs --list       → liste les variables sauvegardées (sans les valeurs)
 *  node scripts/sync-env.mjs --check      → compare avec les variables utilisées par le code (api/*.js)
 *  node scripts/sync-env.mjs --restore .env.local [--target production] [--force]
 *  node scripts/sync-env.mjs --show NOM_VARIABLE [--target production]
 *
 * Aucune dépendance : Node 18 ou plus. Configuration : fichier .env.sync (voir .env.sync.example) ou variables d'environnement.
 * SÉCURITÉ : les valeurs sont chiffrées en AES-256-GCM (clé dérivée par scrypt de BACKUP_PASSPHRASE).
 *            Les sauvegardes sont écrites HORS du dépôt par défaut (~/vercel-env-backup).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null; };

// ---------- Configuration ----------
function loadDotenv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}
const fileCfg = { ...loadDotenv(path.join(ROOT, ".env.sync")), ...loadDotenv(path.join(os.homedir(), ".env.sync")) };
const cfg = (k, d = "") => process.env[k] || fileCfg[k] || d;

const API = cfg("VERCEL_API_URL", "https://api.vercel.com").replace(/\/$/, "");
const TOKEN = cfg("VERCEL_TOKEN");
const TEAM = cfg("VERCEL_TEAM_ID");
const PROJECTS = cfg("VERCEL_PROJECT").split(",").map((s) => s.trim()).filter(Boolean);
const BACKUP_DIR = path.resolve(cfg("BACKUP_DIR", path.join(os.homedir(), "vercel-env-backup")));
const KEEP = Number(cfg("BACKUP_KEEP", "30")) || 30;
const log = (...a) => console.log(`[${new Date().toISOString().replace("T", " ").slice(0, 19)}]`, ...a);

function die(msg) { console.error("✗ " + msg); process.exit(1); }

// ---------- Chiffrement ----------
async function getPassphrase(confirm = false) {
  let p = cfg("BACKUP_PASSPHRASE");
  const pf = cfg("BACKUP_PASSPHRASE_FILE");
  if (!p && pf && fs.existsSync(pf)) p = fs.readFileSync(pf, "utf8").trim();
  if (p) { if (p.length < 12) die("BACKUP_PASSPHRASE trop courte (12 caractères minimum)."); return p; }
  if (!process.stdin.isTTY) die("Aucune phrase secrète : définissez BACKUP_PASSPHRASE (ou BACKUP_PASSPHRASE_FILE) dans .env.sync.");
  const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a); }); });
  const a = await ask("Phrase secrète de chiffrement (12 caractères min.) : ");
  if (a.length < 12) die("Phrase secrète trop courte.");
  if (confirm && (await ask("Confirmez la phrase secrète : ")) !== a) die("Les deux phrases ne correspondent pas.");
  return a;
}
function encrypt(plain, passphrase) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return JSON.stringify({ v: 1, kdf: "scrypt", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") });
}
function decrypt(fileText, passphrase) {
  const f = JSON.parse(fileText);
  const key = crypto.scryptSync(passphrase, Buffer.from(f.salt, "base64"), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(f.iv, "base64"));
  d.setAuthTag(Buffer.from(f.tag, "base64"));
  try { return Buffer.concat([d.update(Buffer.from(f.data, "base64")), d.final()]).toString("utf8"); }
  catch { die("Phrase secrète incorrecte ou fichier abîmé."); }
}
function writeSecret(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
}

// ---------- API Vercel ----------
async function vercel(pathname, query = {}, tries = 4) {
  const url = new URL(API + pathname);
  if (TEAM) url.searchParams.set("teamId", TEAM);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(20000) });
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1000 * 2 ** i)); continue; }
      const body = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403) die("Vercel refuse le jeton (VERCEL_TOKEN invalide, expiré ou sans accès à ce projet / cette équipe).");
      if (r.status === 404) die(`Projet introuvable : ${pathname.split("/")[3]} (vérifiez VERCEL_PROJECT et VERCEL_TEAM_ID).`);
      if (!r.ok) throw new Error(body?.error?.message || "HTTP " + r.status);
      return body;
    } catch (e) { if (i === tries - 1) throw e; await new Promise((s) => setTimeout(s, 1000 * 2 ** i)); }
  }
}

async function fetchProject(project) {
  const list = await vercel(`/v10/projects/${encodeURIComponent(project)}/env`, { decrypt: "true" });
  const out = [];
  for (const e of list.envs || []) {
    let value = typeof e.value === "string" ? e.value : null, recoverable = true;
    if (e.type === "sensitive") { value = null; recoverable = false; }          // Vercel ne rend jamais la valeur d'une variable « sensible »
    else if (!value || e.decrypted === false) {                                  // repli : lecture unitaire
      try { const one = await vercel(`/v1/projects/${encodeURIComponent(project)}/env/${e.id}`); value = typeof one.value === "string" ? one.value : null; } catch { /* reste vide */ }
      if (value === null) recoverable = false;
    }
    out.push({ key: e.key, target: [].concat(e.target || []).sort(), gitBranch: e.gitBranch || null, type: e.type || "encrypted", recoverable, value: recoverable ? value : null, updatedAt: e.updatedAt || e.createdAt || null });
  }
  return out.sort((a, b) => (a.key + a.target.join()).localeCompare(b.key + b.target.join()));
}

// ---------- Comparaison ----------
const idOf = (e) => `${e.key}@${e.target.join("+")}${e.gitBranch ? "#" + e.gitBranch : ""}`;
const fp = (e) => crypto.createHash("sha256").update(JSON.stringify([e.type, e.recoverable, e.value, e.updatedAt && e.recoverable ? null : e.updatedAt])).digest("hex").slice(0, 16);
function diff(prev, cur) {
  const a = new Map(prev.map((e) => [idOf(e), e])), b = new Map(cur.map((e) => [idOf(e), e]));
  const added = [...b.keys()].filter((k) => !a.has(k)), removed = [...a.keys()].filter((k) => !b.has(k));
  const changed = [...b.keys()].filter((k) => a.has(k) && fp(a.get(k)) !== fp(b.get(k)));
  return { added, removed, changed, any: !!(added.length || removed.length || changed.length) };
}

// ---------- Synchronisation ----------
const projDir = (p) => path.join(BACKUP_DIR, p.replace(/[^A-Za-z0-9._-]/g, "_"));
function loadLatest(project, passphrase) {
  const f = path.join(projDir(project), "latest.enc");
  if (!fs.existsSync(f)) return null;
  return JSON.parse(decrypt(fs.readFileSync(f, "utf8"), passphrase));
}

async function syncOne(project, passphrase) {
  const cur = await fetchProject(project), prevSnap = loadLatest(project, passphrase), prev = prevSnap?.envs || [];
  const d = diff(prev, cur), dir = projDir(project);
  const sens = cur.filter((e) => !e.recoverable).map(idOf);
  if (prevSnap && !d.any) { log(`✓ ${project} : ${cur.length} variables, aucun changement.`); return { project, changed: false, count: cur.length }; }
  const snapshot = JSON.stringify({ project, savedAt: new Date().toISOString(), envs: cur });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const enc = encrypt(snapshot, passphrase);
  writeSecret(path.join(dir, `snapshot-${stamp}.enc`), enc);
  writeSecret(path.join(dir, "latest.enc"), enc);
  // journal des changements (noms seulement, jamais de valeurs)
  const lines = [...d.added.map((k) => `+ AJOUTÉE   ${k}`), ...d.changed.map((k) => `~ MODIFIÉE  ${k}`), ...d.removed.map((k) => `- SUPPRIMÉE ${k}`)];
  if (!prevSnap) lines.unshift(`* PREMIÈRE SAUVEGARDE : ${cur.length} variables`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(dir, "changes.log"), lines.map((l) => `${new Date().toISOString()} ${l}`).join("\n") + "\n", { mode: 0o600 });
  // ne garder que les KEEP dernières sauvegardes
  const snaps = fs.readdirSync(dir).filter((f) => f.startsWith("snapshot-")).sort();
  for (const old of snaps.slice(0, Math.max(0, snaps.length - KEEP))) fs.unlinkSync(path.join(dir, old));
  log(`✔ ${project} : sauvegarde mise à jour (${cur.length} variables).`);
  for (const l of lines) log("   " + l);
  if (sens.length) log(`   ⚠ ${sens.length} variable(s) « sensible(s) » : Vercel ne permet pas de relire leur valeur (nom seul sauvegardé) : ${sens.slice(0, 5).join(", ")}${sens.length > 5 ? "…" : ""}`);
  return { project, changed: true, count: cur.length };
}

// ---------- Utilitaires de lecture ----------
const envQuote = (v) => (/^[A-Za-z0-9_./:@+-]*$/.test(v) ? v : JSON.stringify(v).replace(/\$/g, "\\$"));
function pickTarget(envs, target) { return envs.filter((e) => e.recoverable && e.target.includes(target) && !e.gitBranch); }

function usedInCode() {
  const used = new Map(), dir = path.join(ROOT, "api");
  if (!fs.existsSync(dir)) return used;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of s.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) { if (!used.has(m[1])) used.set(m[1], new Set()); used.get(m[1]).add(f); }
  }
  return used;
}
const REQUIRED = new Set(["DATABASE_URL", "APP_SECRET"]);
const IGNORED = new Set(["NODE_ENV", "VERCEL", "VERCEL_ENV", "VERCEL_REGION", "VERCEL_URL", "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_MESSAGE", "VERCEL_DEPLOYMENT_ID", "VERCEL_PROJECT_ID", "CI", "TZ", "HOME", "PATH"]);

// ---------- Commandes ----------
async function main() {
  if (flag("--help") || flag("-h")) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n/, "").replace(/^[/* ]+/gm, "").trim()); return; }
  const offline = flag("--list") || flag("--restore") || flag("--show") || (flag("--check") && !TOKEN);
  if (!offline) {
    if (!TOKEN) die("VERCEL_TOKEN manquant : créez un jeton sur vercel.com/account/tokens puis mettez-le dans .env.sync (voir scripts/LISEZ-MOI-ENV.md).");
    if (!PROJECTS.length) die("VERCEL_PROJECT manquant (nom du projet Vercel, plusieurs séparés par des virgules).");
  }
  const projects = PROJECTS.length ? PROJECTS : fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((d) => fs.existsSync(path.join(BACKUP_DIR, d, "latest.enc"))) : [];

  if (flag("--list")) {
    const pass = await getPassphrase();
    for (const p of projects) { const s = loadLatest(p, pass); if (!s) { console.log(`${p} : aucune sauvegarde`); continue; }
      console.log(`\n${p} — sauvegarde du ${s.savedAt} — ${s.envs.length} variables`);
      for (const e of s.envs) console.log(`  ${e.key.padEnd(34)} ${e.target.join(",").padEnd(34)} ${e.type}${e.recoverable ? "" : "  (valeur non récupérable)"}`); }
    return;
  }
  if (flag("--show")) {
    const key = opt("--show") || die("Précisez le nom : --show NOM_VARIABLE"), target = opt("--target") || "production", pass = await getPassphrase();
    const s = loadLatest(projects[0], pass) || die("Aucune sauvegarde.");
    const e = pickTarget(s.envs, target).find((x) => x.key === key) || die(`Variable ${key} introuvable pour « ${target} » (ou non récupérable).`);
    console.log(e.value); return;
  }
  if (flag("--restore")) {
    const out = opt("--restore") || ".env.local", target = opt("--target") || "development", pass = await getPassphrase();
    const s = loadLatest(projects[0], pass) || die("Aucune sauvegarde.");
    if (fs.existsSync(out) && !flag("--force")) die(`${out} existe déjà (ajoutez --force pour l'écraser).`);
    const rows = pickTarget(s.envs, target);
    fs.writeFileSync(out, `# Restauré depuis la sauvegarde Vercel du ${s.savedAt} (cible : ${target})\n` + rows.map((e) => `${e.key}=${envQuote(e.value)}`).join("\n") + "\n", { mode: 0o600 });
    console.log(`✔ ${rows.length} variables écrites dans ${out} (ne le commitez jamais).`);
    const skipped = s.envs.filter((e) => !e.recoverable && e.target.includes(target)).length;
    if (skipped) console.log(`  ⚠ ${skipped} variable(s) sensible(s) non récupérable(s) : à ressaisir à la main.`);
    return;
  }
  if (flag("--check")) {
    let names;
    if (TOKEN && PROJECTS.length) names = new Set((await fetchProject(PROJECTS[0])).map((e) => e.key));
    else { const pass = await getPassphrase(); const s = loadLatest(projects[0], pass) || die("Aucune sauvegarde."); names = new Set(s.envs.map((e) => e.key)); }
    const used = usedInCode(); let missingReq = 0;
    console.log(`Variables utilisées par le code (api/*.js) : ${used.size}\n`);
    for (const [k, files] of [...used.entries()].sort()) {
      if (IGNORED.has(k)) continue;
      const ok = names.has(k), req = REQUIRED.has(k);
      if (!ok && req) missingReq++;
      console.log(`${ok ? "✔" : req ? "✗ MANQUANTE (obligatoire)" : "·  absente (facultative)"} ${k.padEnd(28)} ${[...files].join(", ")}`);
    }
    const unused = [...names].filter((k) => !used.has(k) && !IGNORED.has(k));
    if (unused.length) console.log(`\nPrésentes sur Vercel mais jamais lues par api/*.js : ${unused.join(", ")}`);
    process.exit(missingReq ? 2 : 0);
  }

  // ----- synchronisation (par défaut) -----
  const pass = await getPassphrase(!fs.existsSync(path.join(projDir(projects[0]), "latest.enc")));
  const git = path.join(ROOT, ".gitignore");
  if (BACKUP_DIR.startsWith(ROOT) && !(fs.existsSync(git) && /env-backup|vercel-env-backup/.test(fs.readFileSync(git, "utf8")))) console.warn("⚠ BACKUP_DIR est dans le dépôt : ajoutez-le à .gitignore ou choisissez un dossier hors du projet.");
  const once = async () => { for (const p of projects) { try { await syncOne(p, pass); } catch (e) { log(`✗ ${p} : ${e.message}`); if (!flag("--watch")) process.exitCode = 1; } } };
  await once();
  if (flag("--watch")) {
    const minutes = Number(opt("--watch") || 15), ms = (Number(cfg("SYNC_INTERVAL_SEC")) || minutes * 60) * 1000;
    log(`Surveillance active : vérification toutes les ${ms / 60000} minute(s). Ctrl+C pour arrêter.`);
    setInterval(once, ms);
  }
}
main().catch((e) => die(e.message));
