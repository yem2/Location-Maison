import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

export const sql = neon(process.env.DATABASE_URL);

export function send(res, code, data) {
  res.status(code).json(data);
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16), N = 16384, r = 8, p = 1;
  const h = crypto.scryptSync(pw, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${h.toString("base64")}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, salt, hash] = stored.split("$");
    if (alg !== "scrypt") return false;
    const h = crypto.scryptSync(pw, Buffer.from(salt, "base64"), 64, { N: +N, r: +r, p: +p });
    const e = Buffer.from(hash, "base64");
    return e.length === h.length && crypto.timingSafeEqual(e, h);
  } catch { return false; }
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export function cookie(req, name) {
  const m = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(name + "="));
  if (!m) return "";
  try { return decodeURIComponent(m.slice(name.length + 1)); } catch { return ""; }
}

export async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${sha(token)}, ${userId}, now() + interval '8 hours')`;
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
  res.setHeader("Set-Cookie", `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);
}

export async function destroySession(req, res) {
  const t = cookie(req, "sid");
  if (t) await sql`DELETE FROM sessions WHERE token_hash = ${sha(t)}`;
  res.setHeader("Set-Cookie", "sid=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
}

export async function currentUser(req) {
  const t = cookie(req, "sid");
  if (!t) return null;
  const rows = await sql`SELECT u.id, u.email, u.name, u.role, u.phone, u.whatsapp_optin, u.totp_enabled, u.last_seen FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha(t)} AND s.expires_at > now() AND u.active`;
  const u = rows[0] || null;
  if (u && (!u.last_seen || Date.now() - new Date(u.last_seen).getTime() > 60000)) await sql`UPDATE users SET last_seen = now() WHERE id = ${u.id}`;
  if (u) delete u.last_seen;
  return u;
}

// Colonnes ajoutées par migration-superadmin.sql (archivage des biens, profil des administrateurs).
// Créées automatiquement au premier usage si la migration n'a pas été lancée ; renvoie false si impossible.
let schemaP;
export function ensureSchema() {
  schemaP ??= (async () => {
    try {
      await sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS archived_at timestamptz`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT ''`;
      return true;
    } catch { return false; }
  })().then((ok) => { if (!ok) schemaP = null; return ok; });
  return schemaP;
}

// Protection CSRF : requête same-origin uniquement pour les écritures
export function sameOrigin(req) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const o = req.headers.origin;
  try { return !!o && new URL(o).host === req.headers.host; } catch { return false; }
}

// Exige un utilisateur connecté (et un rôle si demandé). Renvoie l'utilisateur ou null (réponse déjà envoyée).
export async function requireUser(req, res, role) {
  if (!sameOrigin(req)) { send(res, 403, { error: "Origine refusée" }); return null; }
  const u = await currentUser(req);
  if (!u) { send(res, 401, { error: "Non connecté" }); return null; }
  if (role && u.role !== role) { send(res, 403, { error: "Droits insuffisants" }); return null; }
  return u;
}

export const audit = (userId, action, detail = "") =>
  sql`INSERT INTO audit_log (user_id, action, detail) VALUES (${userId}, ${action}, ${String(detail).slice(0, 300)})`;

export const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const emailOk = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

// ---------- Comptes clients (visiteurs inscrits) ----------
export async function createCustomerSession(res, customerId) {
  const token = crypto.randomBytes(32).toString("hex");
  await sql`INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (${sha(token)}, ${customerId}, now() + interval '30 days')`;
  await sql`DELETE FROM customer_sessions WHERE expires_at < now()`;
  res.setHeader("Set-Cookie", `csid=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`);
}

export async function destroyCustomerSession(req, res) {
  const t = cookie(req, "csid");
  if (t) await sql`DELETE FROM customer_sessions WHERE token_hash = ${sha(t)}`;
  res.setHeader("Set-Cookie", "csid=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
}

export async function currentCustomer(req) {
  const t = cookie(req, "csid");
  if (!t) return null;
  const rows = await sql`SELECT c.id, c.name, c.email, c.phone, c.whatsapp_optin, c.last_seen FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
    WHERE s.token_hash = ${sha(t)} AND s.expires_at > now() AND c.active`;
  const c = rows[0] || null;
  if (c && (!c.last_seen || Date.now() - new Date(c.last_seen).getTime() > 60000)) await sql`UPDATE customers SET last_seen = now() WHERE id = ${c.id}`;
  if (c) delete c.last_seen;
  return c;
}

export async function requireCustomer(req, res) {
  if (!sameOrigin(req)) { send(res, 403, { error: "Origine refusée" }); return null; }
  const c = await currentCustomer(req);
  if (!c) { send(res, 401, { error: "Connectez-vous ou créez un compte pour continuer." }); return null; }
  return c;
}

export const logActivity = (customerId, action, propertyId = null, detail = "") =>
  sql`INSERT INTO activity (customer_id, action, property_id, detail) VALUES (${customerId}, ${action}, ${propertyId}, ${String(detail).slice(0, 300)})`;

export async function notifyAdmins(type, title, detail = "", customerId = null) {
  await sql`INSERT INTO admin_notifications (type, title, detail, customer_id) VALUES (${type}, ${String(title).slice(0, 200)}, ${String(detail).slice(0, 400)}, ${customerId})`;
  if (process.env.WA_ACCESS_TOKEN) {
    const supers = await sql`SELECT id FROM users WHERE role = 'super_admin' AND active`;
    for (const s of supers) await maybeWhatsApp("user", s.id, `${title} — ${detail}`);
  }
}

export async function notifyCustomer(customerId, text) {
  await sql`INSERT INTO customer_notifications (customer_id, text) VALUES (${customerId}, ${String(text).slice(0, 400)})`;
  await maybeWhatsApp("customer", customerId, text);
}

// ---------- WhatsApp (API Cloud de Meta) : envoyé seulement si le destinataire a accepté et n'est pas connecté ----------
export function normalizePhone(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 9 && d.startsWith("6")) d = (process.env.DEFAULT_COUNTRY_CODE || "237") + d;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

async function waSend(to, text) {
  const { WA_ACCESS_TOKEN: tok, WA_PHONE_ID: pid, WA_TEMPLATE: tpl } = process.env;
  if (!tok || !pid || !tpl) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pid}/messages`, {
      method: "POST", signal: ctrl.signal,
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: tpl, language: { code: process.env.WA_LANG || "fr" },
        components: [{ type: "body", parameters: [{ type: "text", text: String(text).replace(/\s+/g, " ").slice(0, 500) }] }] } })
    });
    return r.ok;
  } catch { return false; } finally { clearTimeout(timer); }
}

export async function maybeWhatsApp(kind, id, text) {
  try {
    if (!process.env.WA_ACCESS_TOKEN) return;
    const rows = kind === "customer"
      ? await sql`SELECT phone, whatsapp_optin, last_seen, last_wa FROM customers WHERE id = ${id}`
      : await sql`SELECT phone, whatsapp_optin, last_seen, last_wa FROM users WHERE id = ${id}`;
    const r = rows[0];
    if (!r || !r.whatsapp_optin) return;
    const to = normalizePhone(r.phone);
    if (!to) return;
    if (r.last_seen && Date.now() - new Date(r.last_seen) < 5 * 60 * 1000) return; // connecté : pas de WhatsApp
    if (r.last_wa && Date.now() - new Date(r.last_wa) < 3 * 60 * 1000) return;     // évite le harcèlement
    if (await waSend(to, text)) {
      if (kind === "customer") await sql`UPDATE customers SET last_wa = now() WHERE id = ${id}`;
      else await sql`UPDATE users SET last_wa = now() WHERE id = ${id}`;
    }
  } catch { /* une notification WhatsApp ne doit jamais bloquer l'action */ }
}

// ---------- Chiffrement des secrets (AES-256-GCM) et double authentification (TOTP) ----------
const encKey = () => crypto.createHash("sha256").update("maison:" + (process.env.APP_SECRET || process.env.DATABASE_URL || "")).digest();
export function encrypt(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
export function decrypt(b64) {
  const b = Buffer.from(b64, "base64"), d = crypto.createDecipheriv("aes-256-gcm", encKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret() {
  let bits = ""; for (const x of crypto.randomBytes(20)) bits += x.toString(2).padStart(8, "0");
  let s = ""; for (let i = 0; i < bits.length; i += 5) s += B32[parseInt(bits.slice(i, i + 5), 2)];
  return s;
}
function b32dec(s) {
  let bits = ""; for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function hotp(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", b32dec(secret)).update(buf).digest(), o = h[19] & 0xf;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000;
  return String(code).padStart(6, "0");
}
export function verifyTotp(secret, code) {
  const c = Math.floor(Date.now() / 30000), s = String(code || "").replace(/\s/g, "");
  return [-1, 0, 1].some((d) => hotp(secret, c + d) === s);
}

// ---------- Limitation de débit (anti-abus), par adresse IP ----------
let idxP;
function ensureIndexes() {
  idxP ??= (async () => {
    const run = async (p) => { try { await p; } catch { /* colonne ou table absente : on ignore */ } };
    await run(sql`CREATE INDEX IF NOT EXISTS rate_hits_key_at_idx ON rate_hits (key, at)`);
    await run(sql`CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id)`);
    await run(sql`CREATE INDEX IF NOT EXISTS orders_property_status_idx ON orders (property_id, status)`);
    await run(sql`CREATE INDEX IF NOT EXISTS activity_customer_idx ON activity (customer_id, created_at DESC)`);
    await run(sql`CREATE INDEX IF NOT EXISTS customer_notifications_idx ON customer_notifications (customer_id, created_at DESC)`);
    await run(sql`CREATE INDEX IF NOT EXISTS messages_created_idx ON messages (created_at DESC)`);
    await run(sql`CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC)`);
    await run(sql`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`);
    await run(sql`CREATE INDEX IF NOT EXISTS customer_sessions_customer_idx ON customer_sessions (customer_id)`);
  })();
  return idxP;
}
// Limitation de débit par adresse IP : une seule requête SQL (comptage + enregistrement), nettoyage rare.
export async function throttle(req, res, key, max, windowSec) {
  const ip = String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || "?").trim().slice(0, 64);
  const k = `${key}:${ip}`;
  ensureIndexes();
  let allowed;
  try {
    const [r] = await sql`WITH c AS (SELECT count(*)::int AS n FROM rate_hits WHERE key = ${k}::text AND at > now() - make_interval(secs => ${windowSec})),
      i AS (INSERT INTO rate_hits (key) SELECT ${k}::text WHERE (SELECT n FROM c) < ${max}::int RETURNING 1)
      SELECT (SELECT count(*)::int FROM i) AS ok`;
    allowed = r?.ok === 1;
  } catch {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM rate_hits WHERE key = ${k} AND at > now() - make_interval(secs => ${windowSec})`;
    allowed = n < max;
    if (allowed) await sql`INSERT INTO rate_hits (key) VALUES (${k})`;
  }
  if (Math.random() < 0.02) await sql`DELETE FROM rate_hits WHERE at < now() - interval '1 day'`;
  if (!allowed) { send(res, 429, { error: "Trop de tentatives, réessayez dans quelques minutes." }); return false; }
  return true;
}

// ---------- Supervision : journal automatique de toutes les API ----------
export const clientIp = (req) => String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || "").trim().slice(0, 64);

const statBuf = new Map();
let statFlushAt = Date.now();
async function flushStats() {
  if (!statBuf.size) return;
  const rows = [...statBuf.entries()]; statBuf.clear(); statFlushAt = Date.now();
  const api = rows.map(([k]) => k.split("|")[0]), cls = rows.map(([k]) => k.split("|")[1]), n = rows.map(([, v]) => v.n), ms = rows.map(([, v]) => v.ms);
  await sql`INSERT INTO api_stats (day, api, class, n, ms) SELECT current_date, t.a, t.c, t.n, t.ms FROM unnest(${api}::text[], ${cls}::text[], ${n}::int[], ${ms}::bigint[]) AS t(a, c, n, ms)
    ON CONFLICT (day, api, class) DO UPDATE SET n = api_stats.n + EXCLUDED.n, ms = api_stats.ms + EXCLUDED.ms`;
}
async function record(name, req, status, ms, err) {
  if (name === "image" && status < 400) return; // trop de volume
  const key = `${name}|${Math.floor(status / 100)}xx`, cur = statBuf.get(key) || { n: 0, ms: 0 };
  statBuf.set(key, { n: cur.n + 1, ms: cur.ms + ms });
  if (Date.now() - statFlushAt > 20000 || statBuf.size > 40) await flushStats();
  let kind = null;
  const act = String(req.query?.a || "");
  if (err || status >= 500) kind = "error";
  else if (status === 401 && ["me", "ping", "threads"].includes(act)) kind = null; // visiteur non connecté : normal
  else if ([401, 403, 429].includes(status)) kind = "security";
  else if ([404, 405].includes(status)) kind = "contract";
  else if (status === 400) kind = "validation";
  else if (ms > 2500) kind = "slow";
  if (!kind) return;
  const detail = err ? String(err.message || err).slice(0, 300) + " | " + String(err.stack || "").split("\n").slice(1, 3).join(" ").slice(0, 200) : "";
  await sql`INSERT INTO app_events (kind, api, action, method, status, ms, ip, detail)
    VALUES (${kind}, ${name}, ${act.slice(0, 40)}, ${req.method || ""}, ${status}, ${ms}, ${clientIp(req)}, ${detail})`;
}

// Enveloppe une API : capture les exceptions (réponse 500 propre) et alimente la supervision
export function wrap(name, fn) {
  return async (req, res) => {
    const t0 = Date.now();
    let err = null;
    try { await fn(req, res); }
    catch (e) { err = e; if (!res.headersSent) res.status(500).json({ error: "Erreur interne. L’administrateur a été informé." }); }
    try { await record(name, req, res.statusCode, Date.now() - t0, err); } catch { /* la supervision ne doit jamais casser l'API */ }
  };
}

// ---------- Mot de passe oublié (clients et administrateurs) ----------
// Jeton aléatoire de 256 bits, stocké uniquement sous forme d'empreinte, valable 30 minutes, à usage unique.
// Réponse identique que le compte existe ou non (pas d'énumération). Envoi par e-mail via Resend (RESEND_API_KEY + MAIL_FROM).
export async function sendMail({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, text }), signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
}
let resetsP;
function ensureResets() {
  resetsP ??= (async () => {
    try {
      await sql`CREATE TABLE IF NOT EXISTS password_resets (id bigserial PRIMARY KEY, kind text NOT NULL, account_id bigint NOT NULL, token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`;
      await sql`CREATE INDEX IF NOT EXISTS password_resets_acc_idx ON password_resets (kind, account_id, created_at DESC)`;
      return true;
    } catch { return false; }
  })().then((ok) => { if (!ok) resetsP = null; return ok; });
  return resetsP;
}
export async function requestReset(req, res, kind) {
  if (!(await throttle(req, res, "forgot", 5, 3600))) return;
  const email = str(req.body?.email, 200).toLowerCase();
  const generic = { ok: true, message: "Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d’être envoyé (valable 30 minutes). Pensez à vérifier vos courriers indésirables." };
  if (!emailOk(email) || !(await ensureResets())) return send(res, 200, generic);
  const [acc] = kind === "admin" ? await sql`SELECT id, name FROM users WHERE lower(email) = ${email}`
    : await sql`SELECT id, name FROM customers WHERE lower(email) = ${email} AND COALESCE(active, true)`;
  if (acc) {
    const [recent] = await sql`SELECT 1 AS x FROM password_resets WHERE kind = ${kind} AND account_id = ${acc.id} AND created_at > now() - interval '2 minutes'`;
    if (!recent) {
      const token = crypto.randomBytes(32).toString("base64url");
      await sql`DELETE FROM password_resets WHERE kind = ${kind} AND account_id = ${acc.id} AND (used_at IS NOT NULL OR expires_at < now())`;
      await sql`INSERT INTO password_resets (kind, account_id, token_hash, expires_at) VALUES (${kind}, ${acc.id}, ${sha(token)}, now() + interval '30 minutes')`;
      const site = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, "") : `https://${req.headers.host}`;
      const ok = await sendMail({ to: email, subject: "Réinitialisation de votre mot de passe",
        text: `Bonjour ${acc.name || ""},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 30 minutes, utilisable une seule fois) :\n\n${site}/reinitialiser#${token}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.\n\nLocation et vente immobilière` });
      if (!ok) console.error("[reset] e-mail non envoyé : RESEND_API_KEY / MAIL_FROM absents ou refusés");
      if (kind === "admin") await audit(acc.id, "password.reset_request", ok ? "e-mail envoyé" : "e-mail NON envoyé");
    }
  }
  return send(res, 200, generic);
}
export async function applyReset(req, res) {
  if (!(await throttle(req, res, "reset", 10, 3600))) return;
  const token = str(req.body?.token, 100), pw = typeof req.body?.password === "string" ? req.body.password : "";
  if (!token || !(await ensureResets())) return send(res, 400, { error: "Lien invalide ou expiré. Refaites une demande de réinitialisation." });
  const [t] = await sql`SELECT id, kind, account_id FROM password_resets WHERE token_hash = ${sha(token)} AND used_at IS NULL AND expires_at > now()`;
  if (!t) return send(res, 400, { error: "Lien invalide ou expiré. Refaites une demande de réinitialisation." });
  const min = t.kind === "admin" ? 12 : 8;
  if (pw.length < min || pw.length > 200) return send(res, 400, { error: `Le mot de passe doit contenir au moins ${min} caractères.`, min });
  const [used] = await sql`UPDATE password_resets SET used_at = now() WHERE id = ${t.id} AND used_at IS NULL RETURNING id`;
  if (!used) return send(res, 400, { error: "Lien déjà utilisé. Refaites une demande de réinitialisation." });
  if (t.kind === "admin") {
    await sql`UPDATE users SET password_hash = ${hashPassword(pw)}, failed_logins = 0, locked_until = NULL WHERE id = ${t.account_id}`;
    await sql`DELETE FROM sessions WHERE user_id = ${t.account_id}`;
    await audit(t.account_id, "password.reset", "mot de passe réinitialisé par e-mail");
  } else {
    await sql`UPDATE customers SET password_hash = ${hashPassword(pw)}, failed_logins = 0, locked_until = NULL WHERE id = ${t.account_id}`;
    await sql`DELETE FROM customer_sessions WHERE customer_id = ${t.account_id}`;
    await notifyCustomer(t.account_id, "Votre mot de passe vient d’être modifié. Si ce n’est pas vous, contactez-nous immédiatement.");
  }
  return send(res, 200, { ok: true, kind: t.kind });
}

// ---------- Archives : toute suppression est d'abord copiée ici (chiffrée), donc récupérable ----------
let archP;
export function ensureArchives() {
  archP ??= (async () => {
    try {
      await sql`CREATE TABLE IF NOT EXISTS archives (id bigserial PRIMARY KEY, kind text NOT NULL, ref_id text NOT NULL, label text NOT NULL DEFAULT '', data text NOT NULL,
        deleted_by bigint, deleted_at timestamptz NOT NULL DEFAULT now(), restored_at timestamptz)`;
      await sql`CREATE INDEX IF NOT EXISTS archives_kind_idx ON archives (kind, deleted_at DESC)`;
      return true;
    } catch { return false; }
  })().then((ok) => { if (!ok) archP = null; return ok; });
  return archP;
}
export async function archiveSnapshot(kind, refId, label, payload, by) {
  await ensureArchives();
  await sql`INSERT INTO archives (kind, ref_id, label, data, deleted_by) VALUES (${kind}, ${String(refId)}, ${String(label || "").slice(0, 200)}, ${encrypt(JSON.stringify(payload))}, ${by})`;
}
