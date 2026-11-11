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
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
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
  const rows = await sql`SELECT u.id, u.email, u.name, u.role, u.phone, u.whatsapp_optin, u.totp_enabled FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha(t)} AND s.expires_at > now() AND u.active`;
  const u = rows[0] || null;
  if (u) await sql`UPDATE users SET last_seen = now() WHERE id = ${u.id} AND (last_seen IS NULL OR last_seen < now() - interval '1 minute')`;
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
      await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived_at timestamptz`;
      await sql`CREATE TABLE IF NOT EXISTS password_resets (
        id bigserial PRIMARY KEY, kind text NOT NULL, account_id bigint NOT NULL, token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`;
      return true;
    } catch { return false; }
  })().then((ok) => { if (!ok) schemaP = null; return ok; });
  return schemaP;
}

// ---------- Mot de passe oublié ----------
// E-mail envoyé via Resend (variables RESEND_API_KEY et MAIL_FROM). Renvoie false si non configuré ou en échec.
export const mailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
export async function sendMail(to, subject, text) {
  if (!mailConfigured()) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(8000),
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text })
    });
    return r.ok;
  } catch { return false; }
}
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
// Adresse du site pour les liens : SITE_URL en priorité (évite toute falsification de l'en-tête Host)
export const siteUrl = (req) => (process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "https://" + req.headers.host)).replace(/\/+$/, "");

// Crée un lien à usage unique (30 min) et l'envoie. Silencieux si le compte n'existe pas ou si un e-mail est parti il y a moins de 2 minutes.
export async function startReset(req, kind, account, path, label) {
  if (!mailConfigured() || !(await ensureSchema())) return false;
  const [recent] = await sql`SELECT 1 FROM password_resets WHERE kind = ${kind} AND account_id = ${account.id} AND created_at > now() - interval '2 minutes'`;
  if (recent) return true;
  const token = crypto.randomBytes(32).toString("hex");
  await sql`UPDATE password_resets SET used_at = now() WHERE kind = ${kind} AND account_id = ${account.id} AND used_at IS NULL`;
  await sql`INSERT INTO password_resets (kind, account_id, token_hash, expires_at) VALUES (${kind}, ${account.id}, ${sha256(token)}, now() + interval '30 minutes')`;
  const link = siteUrl(req) + path + "#reset=" + token;
  const sent = await sendMail(account.email, "Réinitialisation de votre mot de passe",
    `Bonjour${account.name ? " " + account.name : ""},\n\nVous avez demandé à réinitialiser le mot de passe de votre ${label}.\nCliquez sur ce lien (valable 30 minutes, utilisable une seule fois) :\n\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.`);
  if (!sent) await sql`DELETE FROM password_resets WHERE token_hash = ${sha256(token)}`; // échec d'envoi : on peut redemander tout de suite
  return sent;
}
// Retrouve le compte d'un lien valide (sans le consommer)
export async function findReset(kind, token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) || !(await ensureSchema())) return null;
  const [r] = await sql`SELECT id, account_id FROM password_resets WHERE kind = ${kind} AND token_hash = ${sha256(token)} AND used_at IS NULL AND expires_at > now()`;
  return r || null;
}
export const burnResets = (kind, accountId) => sql`UPDATE password_resets SET used_at = now() WHERE kind = ${kind} AND account_id = ${accountId} AND used_at IS NULL`;

// Protection CSRF : requête same-origin uniquement pour les écritures
export function sameOrigin(req) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const o = req.headers.origin;
  return !!o && new URL(o).host === req.headers.host;
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
  const rows = await sql`SELECT c.id, c.name, c.email, c.phone, c.whatsapp_optin FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
    WHERE s.token_hash = ${sha(t)} AND s.expires_at > now() AND c.active`;
  const c = rows[0] || null;
  if (c) await sql`UPDATE customers SET last_seen = now() WHERE id = ${c.id} AND (last_seen IS NULL OR last_seen < now() - interval '1 minute')`;
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
export async function throttle(req, res, key, max, windowSec) {
  const ip = String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || "?").trim().slice(0, 64);
  const k = `${key}:${ip}`;
  await sql`DELETE FROM rate_hits WHERE at < now() - interval '1 day'`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM rate_hits WHERE key = ${k} AND at > now() - make_interval(secs => ${windowSec})`;
  if (n >= max) { send(res, 429, { error: "Trop de tentatives, réessayez dans quelques minutes." }); return false; }
  await sql`INSERT INTO rate_hits (key) VALUES (${k})`;
  return true;
}

// ---------- Supervision : journal automatique de toutes les API ----------
export const clientIp = (req) => String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || "").trim().slice(0, 64);

async function record(name, req, status, ms, err) {
  if (name === "image" && status < 400) return; // trop de volume
  const cls = `${Math.floor(status / 100)}xx`;
  await sql`INSERT INTO api_stats (day, api, class, n, ms) VALUES (current_date, ${name}, ${cls}, 1, ${ms})
    ON CONFLICT (day, api, class) DO UPDATE SET n = api_stats.n + 1, ms = api_stats.ms + ${ms}`;
  let kind = null;
  if (err || status >= 500) kind = "error";
  else if ([401, 403, 429].includes(status)) kind = "security";
  else if ([404, 405].includes(status)) kind = "contract";
  else if (status === 400) kind = "validation";
  else if (ms > 2500) kind = "slow";
  if (!kind) return;
  const detail = err ? String(err.message || err).slice(0, 300) + " | " + String(err.stack || "").split("\n").slice(1, 3).join(" ").slice(0, 200) : "";
  await sql`INSERT INTO app_events (kind, api, action, method, status, ms, ip, detail)
    VALUES (${kind}, ${name}, ${String(req.query?.a || "").slice(0, 40)}, ${req.method || ""}, ${status}, ${ms}, ${clientIp(req)}, ${detail})`;
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
