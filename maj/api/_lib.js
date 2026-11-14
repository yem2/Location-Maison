// Outils communs de l'API (base de données, sessions, sécurité, notifications, réinitialisation de mot de passe).
// Fichier commençant par « _ » : ce n'est PAS une fonction Vercel (limite de 12 fonctions du plan gratuit).
//
// Compatibilité avec la base existante :
//  - mots de passe : scrypt$16384$8$1$<sel base64>$<empreinte base64> (format déjà présent dans la table users / customers) ;
//  - sessions : seule l'empreinte SHA-256 du jeton est stockée (colonnes token_hash) ;
//  - aucune table n'est modifiée ni supprimée : seules des vérifications « CREATE/ADD COLUMN IF NOT EXISTS » existent.
import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

// ====================================================================================================
// Base de données (connexion créée à la première requête : une variable manquante donne une erreur 500
// lisible dans les journaux au lieu de planter le chargement de tous les fichiers)
// ====================================================================================================
let _sql;
const db = () => (_sql ??= neon(process.env.DATABASE_URL || process.env.POSTGRES_URL || ""));
export const sql = Object.assign((...a) => db()(...a), {
  transaction: (...a) => db().transaction(...a),
  query: (...a) => db().query(...a)
});

// ====================================================================================================
// Réponses HTTP et utilitaires de saisie
// ====================================================================================================
export function send(res, status, body) {
  res.status(status).json(body);
}

// Texte nettoyé (chaînes ou nombres), sans caractères de contrôle, tronqué à max caractères.
export function str(v, max = 200) {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

export const emailOk = (e) => typeof e === "string" && e.length <= 254 && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

// Numéro WhatsApp : chiffres uniquement avec l'indicatif du pays (ex. « 237699123456 »), ou "" si invalide.
export function normalizePhone(v) {
  let s = String(v ?? "").trim();
  if (!s) return "";
  const intl = s.startsWith("+") || s.startsWith("00");
  let d = s.replace(/\D/g, "");
  if (s.startsWith("00")) d = d.slice(2);
  const cc = String(process.env.DEFAULT_COUNTRY_CODE || "237").replace(/\D/g, "");
  if (!intl && d.length === 9 && d.startsWith("6") && cc) d = cc + d; // numéro local camerounais
  if (!/^[1-9]\d{7,14}$/.test(d)) return "";
  if (!intl && d.length < 10) return "";
  return d;
}

export function clientIp(req) {
  const h = req.headers || {};
  const raw = h["x-vercel-forwarded-for"] || h["x-forwarded-for"] || h["x-real-ip"] || req.socket?.remoteAddress || "";
  return String(raw).split(",")[0].trim().slice(0, 64);
}

const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ""; } };
// Protection CSRF : la requête doit venir d'une page de ce même site.
export function sameOrigin(req) {
  const h = req.headers || {};
  const src = h.origin || h.referer || "";
  if (!src) return false;
  const from = hostOf(src);
  const ok = new Set([String(h["x-forwarded-host"] || "").split(",")[0].trim().toLowerCase(), String(h.host || "").toLowerCase()]);
  if (process.env.SITE_URL) ok.add(hostOf(process.env.SITE_URL));
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) ok.add(String(process.env.VERCEL_PROJECT_PRODUCTION_URL).toLowerCase());
  ok.delete("");
  return !!from && ok.has(from);
}

export const siteUrl = (req) => (process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, "") : `https://${(req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || process.env.VERCEL_PROJECT_PRODUCTION_URL || "localhost"}`);

// ====================================================================================================
// Limitation de débit (par adresse IP) : renvoie false (et répond 429) si la limite est dépassée
// ====================================================================================================
export async function throttle(req, res, name, max, windowSec) {
  const key = `${name}:${clientIp(req) || "?"}`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM rate_hits WHERE key = ${key} AND at > now() - make_interval(secs => ${windowSec}::int)`;
  if (n >= max) {
    res.setHeader("Retry-After", String(windowSec));
    send(res, 429, { error: "Trop de tentatives. Patientez un moment avant de réessayer." });
    return false;
  }
  await sql`INSERT INTO rate_hits (key) VALUES (${key})`;
  return true;
}

// ====================================================================================================
// Mots de passe (scrypt) — format déjà utilisé en base : scrypt$N$r$p$sel(base64)$empreinte(base64)
// Les fonctions sont SYNCHRONES : les fichiers de l'API les utilisent sans « await ».
// ====================================================================================================
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored || "").split("$");
    if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, "base64");
    const opts = { N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * Number(N) * Number(r) * 2 + 1024 * 1024 };
    if (!opts.N || !opts.r || !opts.p || !expected.length) return false;
    const pw = String(password);
    // Interprétation usuelle : le sel est décodé depuis le base64 ; second essai : sel utilisé tel quel (texte).
    for (const salt of [Buffer.from(saltB64, "base64"), Buffer.from(saltB64, "utf8")]) {
      const got = crypto.scryptSync(pw, salt, expected.length, opts);
      if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return true;
    }
    return false;
  } catch { return false; }
}

// ====================================================================================================
// Chiffrement des secrets (AES-256-GCM, clé dérivée de APP_SECRET) : secrets 2FA, archives, moyens de paiement
// ====================================================================================================
let _key;
function secretKey() {
  if (_key) return _key;
  const s = process.env.APP_SECRET;
  if (!s) throw new Error("APP_SECRET manquant (variable d'environnement Vercel)");
  return (_key = crypto.createHash("sha256").update("maison-v1:" + s).digest());
}
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}
export function decrypt(payload) {
  if (!payload) return "";
  const [v, iv, tag, ct] = String(payload).split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Donnée chiffrée invalide");
  const d = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

// ====================================================================================================
// Double authentification (TOTP, RFC 6238 : SHA-1, 6 chiffres, pas de 30 s)
// ====================================================================================================
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32encode(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  let bits = 0, val = 0; const out = [];
  for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, "")) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newTotpSecret = () => b32encode(crypto.randomBytes(20));
function hotp(key, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}
export function verifyTotp(secret, code) {
  const c = String(code ?? "").replace(/\s/g, "");
  if (!secret || !/^\d{6}$/.test(c)) return false;
  const key = b32decode(secret), step = Math.floor(Date.now() / 30000);
  let ok = false;
  for (const d of [-1, 0, 1]) if (crypto.timingSafeEqual(Buffer.from(hotp(key, step + d)), Buffer.from(c))) ok = true;
  return ok;
}

// ====================================================================================================
// Sessions (cookies HttpOnly ; seule l'empreinte SHA-256 du jeton est enregistrée)
// ====================================================================================================
const COOKIE_ADMIN = "maison_sid", COOKIE_CUSTOMER = "maison_csid";
const ADMIN_TTL = 12 * 3600, CUSTOMER_TTL = 30 * 86400;
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

function cookies(req) {
  const out = {};
  for (const part of String(req.headers?.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) { const k = part.slice(0, i).trim(); if (!(k in out)) out[k] = decodeURIComponent(part.slice(i + 1).trim()); }
  }
  return out;
}
function setCookie(res, name, value, maxAge) {
  const c = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", prev ? [].concat(prev, c) : c);
}
const memo = (req, key, fn) => ((req[key] ??= fn()), req[key]);

// ----- Administrateurs -----
export async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${sha(token)}, ${userId}, ${new Date(Date.now() + ADMIN_TTL * 1000).toISOString()})`;
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
  setCookie(res, COOKIE_ADMIN, token, ADMIN_TTL);
}
export async function destroySession(req, res) {
  const t = cookies(req)[COOKIE_ADMIN];
  if (t) await sql`DELETE FROM sessions WHERE token_hash = ${sha(t)}`;
  setCookie(res, COOKIE_ADMIN, "", 0);
}
export function currentUser(req) {
  return memo(req, "__user", async () => {
    const t = cookies(req)[COOKIE_ADMIN];
    if (!t || t.length > 200) return null;
    const [u] = await sql`SELECT u.id, u.email, u.name, u.role, u.phone, u.whatsapp_optin, u.totp_enabled, u.last_seen
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ${sha(t)} AND s.expires_at > now() AND u.active`;
    if (!u) return null;
    if (!u.last_seen || Date.now() - new Date(u.last_seen).getTime() > 30000) await sql`UPDATE users SET last_seen = now() WHERE id = ${u.id}`;
    const { last_seen, ...user } = u;
    return user;
  });
}
export async function requireUser(req, res, role) {
  const u = await currentUser(req);
  if (!u) { send(res, 401, { error: "Non connecté" }); return null; }
  if (role && u.role !== role) { send(res, 403, { error: role === "super_admin" ? "Réservé au super administrateur" : "Accès refusé" }); return null; }
  return u;
}

// ----- Clients -----
export async function createCustomerSession(res, customerId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await sql`INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (${sha(token)}, ${customerId}, ${new Date(Date.now() + CUSTOMER_TTL * 1000).toISOString()})`;
  await sql`DELETE FROM customer_sessions WHERE expires_at < now()`;
  setCookie(res, COOKIE_CUSTOMER, token, CUSTOMER_TTL);
}
export async function destroyCustomerSession(req, res) {
  const t = cookies(req)[COOKIE_CUSTOMER];
  if (t) await sql`DELETE FROM customer_sessions WHERE token_hash = ${sha(t)}`;
  setCookie(res, COOKIE_CUSTOMER, "", 0);
}
export function currentCustomer(req) {
  return memo(req, "__customer", async () => {
    const t = cookies(req)[COOKIE_CUSTOMER];
    if (!t || t.length > 200) return null;
    const [c] = await sql`SELECT c.id, c.name, c.email, c.phone, c.whatsapp_optin, c.last_seen
      FROM customer_sessions s JOIN customers c ON c.id = s.customer_id WHERE s.token_hash = ${sha(t)} AND s.expires_at > now() AND c.active`;
    if (!c) return null;
    if (!c.last_seen || Date.now() - new Date(c.last_seen).getTime() > 30000) await sql`UPDATE customers SET last_seen = now() WHERE id = ${c.id}`;
    const { last_seen, ...customer } = c;
    return customer;
  });
}
export async function requireCustomer(req, res) {
  const c = await currentCustomer(req);
  if (!c) { send(res, 401, { error: "Non connecté" }); return null; }
  return c;
}

// ====================================================================================================
// Journal, activité, notifications (dans l'application + WhatsApp)
// ====================================================================================================
export async function audit(userId, action, detail = "") {
  try { await sql`INSERT INTO audit_log (user_id, action, detail) VALUES (${userId ?? null}, ${String(action).slice(0, 80)}, ${String(detail ?? "").slice(0, 500)})`; } catch { /* le journal ne doit jamais bloquer une action */ }
}
export async function logActivity(customerId, action, propertyId = null, detail = "") {
  try { await sql`INSERT INTO activity (customer_id, action, property_id, detail) VALUES (${customerId}, ${String(action).slice(0, 60)}, ${propertyId ?? null}, ${String(detail ?? "").slice(0, 300)})`; } catch { /* idem */ }
}

// Envoi WhatsApp : Green API (QR code) si configuré, sinon API Cloud de Meta (modèle approuvé).
async function waSend(to, text) {
  if (!to) return false;
  try { const g = await import("./_whatsapp.js"); if (g.greenOn()) return await g.sendGreen(to, text); } catch { /* repli ci-dessous */ }
  const { WA_ACCESS_TOKEN: tok, WA_PHONE_ID: pid, WA_TEMPLATE: tpl } = process.env;
  if (!tok || !pid || !tpl) return false;
  try {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(pid)}/messages`, {
      method: "POST", signal: ctrl.signal, headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: tpl, language: { code: process.env.WA_LANG || "fr" }, components: [{ type: "body", parameters: [{ type: "text", text: String(text).replace(/\s+/g, " ").slice(0, 900) }] }] } })
    });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

// Règles : case cochée + numéro valide, hors ligne depuis 5 minutes, pas de message depuis 3 minutes.
export async function notifyCustomer(customerId, text) {
  const msg = String(text ?? "").slice(0, 500);
  try { await sql`INSERT INTO customer_notifications (customer_id, text) VALUES (${customerId}, ${msg})`; } catch { return; }
  try {
    const [c] = await sql`UPDATE customers SET last_wa = now() WHERE id = ${customerId} AND active AND whatsapp_optin AND phone <> ''
      AND (last_seen IS NULL OR last_seen < now() - interval '5 minutes') AND (last_wa IS NULL OR last_wa < now() - interval '3 minutes') RETURNING phone`;
    if (c) await waSend(normalizePhone(c.phone), msg);
  } catch { /* la notification dans l'application est déjà enregistrée */ }
}

export async function notifyAdmins(type, title, detail = "", customerId = null) {
  try { await sql`INSERT INTO admin_notifications (type, title, detail, customer_id) VALUES (${String(type).slice(0, 40)}, ${String(title).slice(0, 200)}, ${String(detail ?? "").slice(0, 500)}, ${customerId ?? null})`; } catch { return; }
  try {
    const rows = await sql`UPDATE users SET last_wa = now() WHERE role = 'super_admin' AND active AND whatsapp_optin AND phone <> ''
      AND (last_seen IS NULL OR last_seen < now() - interval '5 minutes') AND (last_wa IS NULL OR last_wa < now() - interval '3 minutes') RETURNING phone`;
    for (const r of rows) await waSend(normalizePhone(r.phone), detail ? `${title} : ${detail}` : title);
  } catch { /* idem */ }
}

// ====================================================================================================
// Colonnes / tables créées automatiquement si les migrations n'ont pas été lancées (sans rien modifier d'existant)
// ====================================================================================================
let schemaP;
export function ensureSchema() {
  schemaP ??= (async () => {
    try {
      const rows = await sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND
        ((table_name = 'properties' AND column_name IN ('archived', 'archived_at')) OR (table_name = 'users' AND column_name IN ('avatar', 'bio', 'city')))`;
      if (rows.length < 5) {
        await sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS archived_at timestamptz`;
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT ''`;
      }
      return true;
    } catch { return false; }
  })().then((ok) => { if (!ok) schemaP = null; return ok; });
  return schemaP;
}

let archP;
export function ensureArchives() {
  archP ??= sql`CREATE TABLE IF NOT EXISTS archives (id bigserial PRIMARY KEY, kind text NOT NULL, ref_id text NOT NULL, label text NOT NULL DEFAULT '', data text NOT NULL,
    deleted_by bigint, deleted_at timestamptz NOT NULL DEFAULT now(), restored_at timestamptz)`.then(() => true, () => { archP = null; return false; });
  return archP;
}
// Une suppression est d'abord copiée (chiffrée) dans les archives : le super administrateur peut la restaurer.
export async function archiveSnapshot(kind, refId, label, data, deletedBy) {
  await ensureArchives();
  await sql`INSERT INTO archives (kind, ref_id, label, data, deleted_by) VALUES (${kind}, ${String(refId)}, ${String(label ?? "").slice(0, 200)}, ${encrypt(JSON.stringify(data))}, ${deletedBy ?? null})`;
}

// ====================================================================================================
// E-mails (Resend) et réinitialisation du mot de passe
// ====================================================================================================
export const mailReady = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
export async function sendMail({ to, subject, text, html }) {
  if (!mailReady()) return false;
  try {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: ctrl.signal, headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text, html })
    });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Demande de lien de réinitialisation. kind : « admin » ou « customer ». La réponse ne révèle jamais si l'e-mail existe.
export async function requestReset(req, res, kind) {
  if (req.method !== "POST" || !sameOrigin(req)) return send(res, 405, { error: "Méthode refusée" });
  if (!(await throttle(req, res, "forgot", 5, 3600))) return;
  const email = str(req.body?.email, 254).toLowerCase();
  if (!emailOk(email)) return send(res, 400, { error: "Saisissez une adresse e-mail valide." });
  if (!mailReady()) return send(res, 503, { error: "L’envoi d’e-mails n’est pas configuré sur ce site. Contactez l’administrateur pour réinitialiser votre mot de passe." });
  const isAdmin = kind === "admin";
  const [acc] = isAdmin ? await sql`SELECT id, name, email FROM users WHERE email = ${email} AND active` : await sql`SELECT id, name, email FROM customers WHERE email = ${email} AND active`;
  if (acc) {
    const token = crypto.randomBytes(32).toString("base64url");
    await sql`INSERT INTO password_resets (kind, account_id, token_hash, expires_at) VALUES (${isAdmin ? "admin" : "customer"}, ${acc.id}, ${sha(token)}, ${new Date(Date.now() + 3600 * 1000).toISOString()})`;
    const link = `${siteUrl(req)}/reinitialiser${isAdmin ? "?type=admin" : ""}#${token}`;
    const name = acc.name || "";
    await sendMail({
      to: acc.email, subject: "Réinitialisation de votre mot de passe",
      text: `Bonjour ${name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${link}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.`,
      html: `<p>Bonjour ${esc(name)},</p><p>Pour choisir un nouveau mot de passe, cliquez sur le lien ci-dessous (valable 1 heure) :</p><p><a href="${esc(link)}">Choisir un nouveau mot de passe</a></p><p>Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.</p>`
    });
    if (isAdmin) await audit(acc.id, "password.reset_request");
  }
  return send(res, 200, { ok: true, message: "Si un compte existe avec cette adresse, un e-mail contenant un lien de réinitialisation vient d’être envoyé. Le lien est valable 1 heure." });
}

// Enregistre le nouveau mot de passe à partir du lien reçu par e-mail (jeton à usage unique).
export async function applyReset(req, res) {
  if (req.method !== "POST" || !sameOrigin(req)) return send(res, 405, { error: "Méthode refusée" });
  if (!(await throttle(req, res, "reset", 10, 3600))) return;
  const token = str(req.body?.token, 100), pw = typeof req.body?.password === "string" ? req.body.password : "";
  const bad = "Lien invalide ou expiré. Refaites une demande de réinitialisation.";
  if (token.length < 20) return send(res, 400, { error: bad });
  const [r] = await sql`SELECT id, kind, account_id FROM password_resets WHERE token_hash = ${sha(token)} AND used_at IS NULL AND expires_at > now()`;
  if (!r) return send(res, 400, { error: bad });
  const isAdmin = r.kind === "admin", min = isAdmin ? 12 : 8;
  if (pw.length < min || pw.length > 200) return send(res, 400, { error: `Le mot de passe doit contenir au moins ${min} caractères.` });
  const hash = hashPassword(pw);
  if (isAdmin) {
    await sql`UPDATE users SET password_hash = ${hash}, failed_logins = 0, locked_until = NULL WHERE id = ${r.account_id}`;
    await sql`DELETE FROM sessions WHERE user_id = ${r.account_id}`;
    await audit(r.account_id, "password.reset");
  } else {
    await sql`UPDATE customers SET password_hash = ${hash}, failed_logins = 0, locked_until = NULL WHERE id = ${r.account_id}`;
    await sql`DELETE FROM customer_sessions WHERE customer_id = ${r.account_id}`;
  }
  await sql`UPDATE password_resets SET used_at = now() WHERE kind = ${r.kind} AND account_id = ${r.account_id} AND used_at IS NULL`;
  return send(res, 200, { ok: true, kind: isAdmin ? "admin" : "customer" });
}

// ====================================================================================================
// Enveloppe de chaque API : erreurs en JSON, compteurs et journal de supervision (api_stats / app_events)
// ====================================================================================================
async function record(api, req, status, ms, err) {
  try {
    const cls = status >= 500 ? "5xx" : status >= 400 ? "4xx" : status >= 300 ? "3xx" : "2xx";
    const a = typeof req.query?.a === "string" ? req.query.a.slice(0, 40) : "";
    const tasks = [sql`INSERT INTO api_stats (day, api, class, n, ms) VALUES (current_date, ${api}, ${cls}, 1, ${ms})
      ON CONFLICT (day, api, class) DO UPDATE SET n = api_stats.n + 1, ms = api_stats.ms + EXCLUDED.ms`];
    let kind = null;
    if (status >= 500) kind = "error";
    else if ([401, 403, 429].includes(status)) kind = status === 401 && (a === "me" || a === "ping") ? null : "security"; // « non connecté » sur me/ping est normal
    else if (status === 400 || status === 422) kind = "validation";
    else if (status === 404 || status === 405) kind = "contract";
    else if (ms > 3000) kind = "slow";
    if (kind) {
      const path = String(req.url || "").split("?")[0].slice(0, 80) + (a ? `?a=${a}` : "");
      tasks.push(sql`INSERT INTO app_events (kind, api, action, method, status, ms, ip, detail)
        VALUES (${kind}, ${api}, ${a}, ${String(req.method || "").slice(0, 10)}, ${status}, ${ms}, ${clientIp(req)}, ${(err || path).slice(0, 300)})`);
    }
    await Promise.race([Promise.allSettled(tasks), new Promise((r) => setTimeout(r, 2500))]);
  } catch { /* la supervision ne doit jamais empêcher de répondre */ }
}

export function wrap(name, handler) {
  return async function (req, res) {
    const t0 = Date.now();
    let finished = false, errMsg = "";
    try { if (typeof req.body === "string" && req.body.trim().startsWith("{")) req.body = JSON.parse(req.body); } catch { /* corps non JSON : laissé tel quel */ }
    // La supervision est enregistrée juste avant l'envoi de la réponse (sinon la plateforme peut figer la fonction).
    const origEnd = res.end.bind(res);
    res.end = (...args) => {
      if (finished) return origEnd(...args);
      finished = true;
      record(name, req, res.statusCode || 200, Date.now() - t0, errMsg).finally(() => origEnd(...args));
      return res;
    };
    try {
      await handler(req, res);
    } catch (e) {
      errMsg = String(e?.message || e).slice(0, 300);
      console.error(`[${name}]`, e);
      if (!finished) { try { res.status(500).json({ error: "Erreur serveur" }); } catch { /* réponse déjà partie */ } }
    }
    if (!finished) { try { res.status(204).end(); } catch { /* idem */ } }
  };
}
