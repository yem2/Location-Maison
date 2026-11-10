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
  const rows = await sql`SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha(t)} AND s.expires_at > now() AND u.active`;
  return rows[0] || null;
}

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
  const rows = await sql`SELECT c.id, c.name, c.email, c.phone FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
    WHERE s.token_hash = ${sha(t)} AND s.expires_at > now() AND c.active`;
  return rows[0] || null;
}

export async function requireCustomer(req, res) {
  if (!sameOrigin(req)) { send(res, 403, { error: "Origine refusée" }); return null; }
  const c = await currentCustomer(req);
  if (!c) { send(res, 401, { error: "Connectez-vous ou créez un compte pour continuer." }); return null; }
  return c;
}

export const logActivity = (customerId, action, propertyId = null, detail = "") =>
  sql`INSERT INTO activity (customer_id, action, property_id, detail) VALUES (${customerId}, ${action}, ${propertyId}, ${String(detail).slice(0, 300)})`;

export const notifyAdmins = (type, title, detail = "", customerId = null) =>
  sql`INSERT INTO admin_notifications (type, title, detail, customer_id) VALUES (${type}, ${String(title).slice(0, 200)}, ${String(detail).slice(0, 400)}, ${customerId})`;

export const notifyCustomer = (customerId, text) =>
  sql`INSERT INTO customer_notifications (customer_id, text) VALUES (${customerId}, ${String(text).slice(0, 400)})`;

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

// ---------- Supervision : adresse IP et journal des appels d'API ----------
export const clientIp = (req) =>
  String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || "").trim().slice(0, 64);

const eventKind = (status, ms, thrown, action) => {
  if (thrown || status >= 500) return "error";
  if (status === 401 && action === "me") return null;            // visiteur non connecté : normal
  if (status === 401 || status === 403 || status === 429) return "security";
  if (status === 404 || status === 405) return "contract";
  if (status === 400 || status === 422) return "validation";
  if (ms > 2000) return "slow";
  return null;
};

// Enveloppe un gestionnaire d'API : mesure la durée, attrape les erreurs (réponse 500 propre)
// et alimente les tables api_stats / app_events. L'enregistrement ne doit jamais casser la requête.
export function wrap(name, handler) {
  return async function wrapped(req, res) {
    const t0 = Date.now();
    let thrown = null;
    try { await handler(req, res); }
    catch (e) {
      thrown = e;
      console.error(`[${name}]`, e);
      if (!res.headersSent) res.status(500).json({ error: "Erreur serveur" });
    }
    try {
      const ms = Date.now() - t0, status = res.statusCode || 200;
      const cls = Math.floor(status / 100) + "xx";
      await sql`INSERT INTO api_stats (day, api, class, n, ms) VALUES (current_date, ${name}, ${cls}, 1, ${ms})
        ON CONFLICT (day, api, class) DO UPDATE SET n = api_stats.n + 1, ms = api_stats.ms + EXCLUDED.ms`;
      const action = typeof req.query?.a === "string" ? req.query.a.slice(0, 40) : "";
      const kind = eventKind(status, ms, thrown, action);
      if (kind) {
        const detail = thrown ? String(thrown.message || thrown).slice(0, 300) : "";
        await sql`INSERT INTO app_events (kind, api, action, method, status, ms, ip, detail)
          VALUES (${kind}, ${name}, ${action}, ${req.method}, ${status}, ${ms}, ${clientIp(req)}, ${detail})`;
      }
    } catch { /* journal indisponible (tables non migrées) : on ignore */ }
  };
}
