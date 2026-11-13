// Paiements : moyens, configuration (numéros / comptes), appels Flutterwave et PayPal, enregistrement des paiements.
// Règles de sécurité appliquées partout :
//  - le montant et la devise viennent TOUJOURS de la base de données, jamais du navigateur ;
//  - un paiement n'est validé qu'après vérification serveur à serveur auprès du fournisseur ;
//  - une seule réussite par demande (index unique) ; une référence de transaction manuelle ne peut servir qu'une fois ;
//  - les numéros et comptes sont chiffrés en base (AES-256-GCM) et modifiables par le super administrateur seulement.
import crypto from "node:crypto";
import { sql, encrypt, decrypt, notifyAdmins, notifyCustomer } from "./_lib.js";

// ---------- Moyens de paiement ----------
export const METHOD_LABEL = { cash: "Espèces", orange_money: "Orange Money", mtn_money: "MTN Mobile Money", card: "Carte Visa / Mastercard", paypal: "PayPal", bank_transfer: "Virement bancaire" };
export const METHODS = Object.keys(METHOD_LABEL);
export const MOMO_CUR = ["XAF", "XOF"];
const PAYPAL_NATIVE = ["EUR", "USD", "GBP", "CAD", "CHF"];
export const XAF_PER_EUR = 655.957; // parité fixe du franc CFA

// PayPal ne gère pas le franc CFA : on facture en euros (parité fixe), arrondi au centime supérieur.
export function paypalAmount(amount, currency) {
  const a = Number(amount);
  if (!(a > 0)) return null;
  if (currency === "XAF") return { currency_code: "EUR", value: (Math.ceil((a / XAF_PER_EUR) * 100) / 100).toFixed(2) };
  if (PAYPAL_NATIVE.includes(currency)) return { currency_code: currency, value: a.toFixed(2) };
  return null;
}

export const DEFAULT_CFG = {
  cash: { enabled: true, address: "", instructions: "" },
  card: { enabled: true },
  orange_money: { enabled: true, mode: "auto", number: "", holder: "", instructions: "" },
  mtn_money: { enabled: true, mode: "auto", number: "", holder: "", instructions: "" },
  paypal: { enabled: true, email: "" },
  bank_transfer: { enabled: false, bank: "", holder: "", account: "", iban: "", swift: "", instructions: "" }
};

// ---------- Validation des numéros et comptes ----------
const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
export function normPhone(v) {
  const s = clean(v, 25).replace(/[ .\-()]/g, "");
  if (!s) return "";
  if (!/^\+?\d{8,15}$/.test(s)) throw new Error("Numéro de téléphone invalide (8 à 15 chiffres, avec indicatif si possible).");
  return s;
}
export function ibanOk(v) {
  const s = String(v).replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let rem = 0; for (const d of r) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}
const emailOk = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

// Nettoie et valide la configuration envoyée par le super administrateur. Lève une erreur lisible sinon.
export function sanitizeCfg(input) {
  const i = input && typeof input === "object" ? input : {};
  const out = JSON.parse(JSON.stringify(DEFAULT_CFG));
  const on = (m) => (typeof i[m]?.enabled === "boolean" ? i[m].enabled : out[m].enabled);
  out.cash = { enabled: on("cash"), address: clean(i.cash?.address, 200), instructions: clean(i.cash?.instructions, 400) };
  out.card = { enabled: on("card") };
  for (const m of ["orange_money", "mtn_money"]) {
    const x = i[m] || {}, label = METHOD_LABEL[m];
    const mode = x.mode === "manual" ? "manual" : "auto";
    const number = normPhone(x.number);
    out[m] = { enabled: on(m), mode, number, holder: clean(x.holder, 80), instructions: clean(x.instructions, 400) };
    if (out[m].enabled && mode === "manual" && (!number || !out[m].holder)) throw new Error(`${label} (mode manuel) : renseignez le numéro et le nom du titulaire.`);
  }
  const pe = clean(i.paypal?.email, 120).toLowerCase();
  if (pe && !emailOk(pe)) throw new Error("PayPal : adresse e-mail invalide.");
  out.paypal = { enabled: on("paypal"), email: pe };
  const b = i.bank_transfer || {}, iban = clean(b.iban, 40).replace(/\s/g, "").toUpperCase(), swift = clean(b.swift, 11).toUpperCase(), account = clean(b.account, 40);
  if (iban && !ibanOk(iban)) throw new Error("Virement : IBAN invalide (vérifiez la saisie).");
  if (swift && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(swift)) throw new Error("Virement : code BIC/SWIFT invalide.");
  if (account && !/^[A-Za-z0-9 .\-\/]{4,40}$/.test(account)) throw new Error("Virement : numéro de compte invalide.");
  out.bank_transfer = { enabled: on("bank_transfer"), bank: clean(b.bank, 80), holder: clean(b.holder, 80), account, iban, swift, instructions: clean(b.instructions, 400) };
  if (out.bank_transfer.enabled && (!out.bank_transfer.holder || !(account || iban))) throw new Error("Virement : renseignez le titulaire et le numéro de compte ou l’IBAN.");
  return out;
}

// ---------- Base de données ----------
let payP;
export function ensurePayments() {
  payP ??= (async () => {
    try {
      await sql`CREATE TABLE IF NOT EXISTS payments (
        id bigserial PRIMARY KEY, order_id bigint NOT NULL, customer_id bigint NOT NULL, method text NOT NULL, provider text NOT NULL DEFAULT '',
        reference text NOT NULL UNIQUE, provider_ref text NOT NULL DEFAULT '', amount numeric NOT NULL, currency text NOT NULL,
        charged_amount numeric, charged_currency text, status text NOT NULL DEFAULT 'pending',
        payer_phone text NOT NULL DEFAULT '', payer_name text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '',
        confirmed_by bigint, confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
      await sql`CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id)`;
      await sql`CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status, created_at DESC)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS payments_txn_uniq ON payments (method, provider_ref) WHERE provider = 'manual' AND provider_ref <> '' AND status <> 'failed'`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS payments_one_paid ON payments (order_id) WHERE status = 'paid'`;
      await sql`CREATE TABLE IF NOT EXISTS payment_settings (key text PRIMARY KEY, value text NOT NULL, updated_by bigint, updated_at timestamptz NOT NULL DEFAULT now())`;
      await sql`CREATE TABLE IF NOT EXISTS payment_settings_log (id bigserial PRIMARY KEY, user_id bigint, at timestamptz NOT NULL DEFAULT now(), changed text NOT NULL, ip text NOT NULL DEFAULT '')`;
      return true;
    } catch { return false; }
  })().then((ok) => { if (!ok) payP = null; return ok; });
  return payP;
}

let cfgCache = { at: 0, v: null };
export async function loadCfg(force) {
  if (!force && cfgCache.v && Date.now() - cfgCache.at < 20000) return cfgCache.v;
  let cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
  try {
    const [r] = await sql`SELECT value FROM payment_settings WHERE key = 'config'`;
    if (r) { const saved = JSON.parse(decrypt(r.value)); for (const m of METHODS) cfg[m] = { ...cfg[m], ...(saved[m] || {}) }; }
  } catch { /* configuration absente ou illisible : valeurs par défaut */ }
  cfgCache = { at: Date.now(), v: cfg };
  return cfg;
}
export async function saveCfg(cfg, userId) {
  await sql`INSERT INTO payment_settings (key, value, updated_by, updated_at) VALUES ('config', ${encrypt(JSON.stringify(cfg))}, ${userId}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  cfgCache = { at: 0, v: null };
}

// ---------- Moyens proposés au client pour une demande ----------
export const flwReady = () => !!process.env.FLW_SECRET_KEY;
export const ppReady = () => !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);

export function optionsFor(cfg, order) {
  const cur = order.currency, amount = Number(order.amount), out = [];
  const add = (o) => out.push({ label: METHOD_LABEL[o.id], ...o });
  if (cfg.cash.enabled) add({ id: "cash", kind: "cash", address: cfg.cash.address, instructions: cfg.cash.instructions });
  for (const m of ["orange_money", "mtn_money"]) {
    const c = cfg[m]; if (!c.enabled) continue;
    if (c.mode === "manual" && c.number) add({ id: m, kind: "manual", number: c.number, holder: c.holder, instructions: c.instructions });
    else if (c.mode === "auto" && flwReady() && MOMO_CUR.includes(cur)) add({ id: m, kind: "online", provider: "Flutterwave" });
  }
  if (cfg.card.enabled && flwReady()) add({ id: "card", kind: "online", provider: "Flutterwave" });
  const pp = paypalAmount(amount, cur);
  if (cfg.paypal.enabled && ppReady() && pp) add({ id: "paypal", kind: "online", provider: "PayPal", converted: pp.currency_code !== cur ? pp : null });
  const b = cfg.bank_transfer;
  if (b.enabled && (b.iban || b.account)) add({ id: "bank_transfer", kind: "manual", bank: b.bank, holder: b.holder, account: b.account, iban: b.iban, swift: b.swift, instructions: b.instructions });
  return out;
}

// ---------- Flutterwave (cartes, Orange Money, MTN Mobile Money) ----------
const FLW = "https://api.flutterwave.com/v3";
async function timed(url, init, ms = 9000) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); } finally { clearTimeout(t); }
}
export async function flw(path, init = {}) {
  try {
    const r = await timed(FLW + path, { ...init, headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, "Content-Type": "application/json" } });
    return await r.json().catch(() => ({}));
  } catch { return {}; }
}
export const FLW_OPTIONS = { card: "card", orange_money: "mobilemoneyfranco", mtn_money: "mobilemoneyfranco" };

// Vérifie une transaction auprès de Flutterwave. Retourne "paid" | "failed" | "pending".
export async function flwState(p) {
  const r = await flw(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(p.reference)}`);
  const d = r.data;
  if (d && d.status === "successful" && d.tx_ref === p.reference && d.currency === p.currency && Number(d.amount) >= Number(p.amount)) return "paid";
  if (d && ["failed", "cancelled"].includes(d.status)) return "failed";
  return "pending";
}

// ---------- PayPal (API Orders v2) ----------
const ppBase = () => (process.env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com");
let ppTok = { v: "", exp: 0 };
async function ppToken() {
  if (ppTok.v && Date.now() < ppTok.exp - 60000) return ppTok.v;
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");
  const r = await timed(ppBase() + "/v1/oauth2/token", { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("PayPal : authentification refusée");
  ppTok = { v: d.access_token, exp: Date.now() + (Number(d.expires_in) || 300) * 1000 };
  return ppTok.v;
}
async function ppCall(path, method, body, requestId) {
  const r = await timed(ppBase() + path, { method, headers: { Authorization: `Bearer ${await ppToken()}`, "Content-Type": "application/json", ...(requestId ? { "PayPal-Request-Id": requestId } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.message || "PayPal : erreur " + r.status); e.issue = d.details?.[0]?.issue || d.name || ""; throw e; }
  return d;
}
export async function ppCreate({ reference, amount, title, returnUrl, cancelUrl }) {
  const d = await ppCall("/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: reference, custom_id: reference, description: String(title).slice(0, 120), amount }],
    payment_source: { paypal: { experience_context: { brand_name: "Location et vente immobilière", locale: "fr-FR", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: returnUrl, cancel_url: cancelUrl } } }
  }, reference);
  const link = (d.links || []).find((l) => ["payer-action", "approve"].includes(l.rel))?.href;
  if (!d.id || !link || !/^https:\/\/([a-z0-9-]+\.)*paypal\.com\//.test(link)) throw new Error("PayPal : réponse invalide");
  return { id: d.id, link };
}
// Capture (ou relit) la commande PayPal, puis contrôle montant, devise et référence.
export async function ppState(p, paypalOrderId) {
  let d;
  try { d = await ppCall(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, "POST", null, p.reference + "-cap"); }
  catch (e) {
    if (e.issue === "ORDER_ALREADY_CAPTURED") d = await ppCall(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, "GET");
    else if (["ORDER_NOT_APPROVED", "PAYER_ACTION_REQUIRED"].includes(e.issue)) return { state: "pending" };
    else throw e;
  }
  const pu = d.purchase_units?.[0], cap = pu?.payments?.captures?.[0];
  if (!cap) return { state: d.status === "VOIDED" ? "failed" : "pending" };
  if (cap.status === "COMPLETED" && d.status === "COMPLETED" && pu.custom_id === p.reference &&
      cap.amount?.currency_code === p.charged_currency && Number(cap.amount?.value) >= Number(p.charged_amount)) return { state: "paid", captureId: cap.id };
  if (["PENDING", "ON_HOLD"].includes(cap.status)) return { state: "pending" };
  return { state: "failed" };
}
export async function ppVerifyWebhook(headers, event) {
  const id = process.env.PAYPAL_WEBHOOK_ID;
  if (!id) return false;
  try {
    const d = await ppCall("/v1/notifications/verify-webhook-signature", "POST", {
      auth_algo: headers["paypal-auth-algo"], cert_url: headers["paypal-cert-url"], transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"], transmission_time: headers["paypal-transmission-time"], webhook_id: id, webhook_event: event
    });
    return d.verification_status === "SUCCESS";
  } catch { return false; }
}

// ---------- Enregistrement du résultat (un seul chemin pour tous les moyens) ----------
export const newRef = (prefix, orderId) => `${prefix}-${orderId}-${crypto.randomBytes(6).toString("hex")}`;

export async function markPaid(paymentId, { by = null, note = "" } = {}) {
  let p;
  try {
    [p] = await sql`UPDATE payments SET status = 'paid', confirmed_by = ${by}, confirmed_at = now(), updated_at = now(),
      note = COALESCE(NULLIF(${note}, ''), note)
      WHERE id = ${paymentId} AND status IN ('pending', 'review', 'cancelled') RETURNING *`;
  } catch (e) {
    // Une autre transaction est déjà payée pour cette demande : on garde la trace, sans valider deux fois.
    if (String(e?.code) === "23505" || /payments_one_paid/.test(String(e?.message))) {
      const [d] = await sql`UPDATE payments SET status = 'cancelled', note = 'DOUBLON : argent reçu en double, à rembourser', updated_at = now() WHERE id = ${paymentId} RETURNING order_id, amount, currency, method`;
      if (d) await notifyAdmins("payment_duplicate", "Paiement en double à rembourser", `Demande n°${d.order_id} — ${d.amount} ${d.currency} (${METHOD_LABEL[d.method] || d.method})`);
      return null;
    }
    throw e;
  }
  if (!p) return null;
  await sql`UPDATE orders SET payment_status = 'paid', payment_method = ${p.method}, updated_at = now() WHERE id = ${p.order_id}`;
  const [o] = await sql`SELECT property_title FROM orders WHERE id = ${p.order_id}`;
  const title = o?.property_title || "votre réservation";
  await notifyAdmins("payment", "Paiement reçu", `${title} — ${p.amount} ${p.currency} (${METHOD_LABEL[p.method] || p.method})`, p.customer_id);
  await notifyCustomer(p.customer_id, `Paiement reçu pour « ${title} ». Merci !`);
  return p;
}

export async function markFailed(paymentId, note = "", { notify = false } = {}) {
  const [p] = await sql`UPDATE payments SET status = 'failed', note = ${String(note).slice(0, 300)}, updated_at = now()
    WHERE id = ${paymentId} AND status IN ('pending', 'review') RETURNING *`;
  if (!p) return null;
  await sql`UPDATE orders SET payment_status = 'failed', updated_at = now() WHERE id = ${p.order_id} AND payment_status IN ('pending', 'review', 'cash_pending')
    AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id = ${p.order_id} AND status IN ('pending', 'review') AND id <> ${p.id})`;
  if (notify) await notifyCustomer(p.customer_id, `Votre paiement (${METHOD_LABEL[p.method] || p.method}) n’a pas pu être vérifié${note ? " : " + note : ""}. Vous pouvez réessayer depuis « Mes demandes ».`);
  return p;
}

// ---------- Utilitaires ----------
export const siteUrl = (req) => (process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, "") : `https://${req.headers.host}`);
export function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // empêche l'exécution de formules dans Excel / Sheets
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
