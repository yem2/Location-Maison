import { sql, encrypt, decrypt } from "./_lib.js";

// ---------- Types de moyens de paiement ----------
// providers : comment le paiement est traité
//   flutterwave = page de paiement sécurisée Flutterwave (cartes Visa/Mastercard, Orange Money, MTN MoMo…), vérifiée par l'API
//   paypal      = PayPal (API Orders v2), capturé et vérifié côté serveur
//   manual      = le client envoie l'argent au numéro / compte du site puis indique la référence ; un administrateur confirme
//   cash        = espèces à l'agence ; un administrateur confirme
export const KINDS = {
  cash: { label: "Espèces à l’agence", providers: ["cash"] },
  card: { label: "Carte bancaire (Visa, Mastercard)", providers: ["flutterwave"] },
  orange_money: { label: "Orange Money", providers: ["flutterwave", "manual"] },
  mtn_momo: { label: "MTN Mobile Money", providers: ["flutterwave", "manual"] },
  paypal: { label: "PayPal", providers: ["paypal"] },
  bank_transfer: { label: "Virement bancaire", providers: ["manual"] },
  other: { label: "Autre moyen de paiement", providers: ["manual"] }
};
export const PROVIDER_LABEL = { flutterwave: "En ligne (Flutterwave)", paypal: "En ligne (PayPal)", manual: "Manuel (numéro de compte)", cash: "Espèces" };
// Un seul exemplaire par type, sauf « virement » et « autre »
const UNIQUE_KINDS = ["cash", "card", "orange_money", "mtn_momo", "paypal"];

export function env() {
  return {
    flutterwave: !!process.env.FLW_SECRET_KEY,
    flutterwaveWebhook: !!process.env.FLW_WEBHOOK_HASH,
    paypal: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET),
    paypalLive: process.env.PAYPAL_ENV === "live",
    encryption: !!process.env.APP_SECRET
  };
}
export const providerReady = (p) => (p === "flutterwave" ? env().flutterwave : p === "paypal" ? env().paypal : true);

// ---------- Schéma (créé automatiquement au premier usage ; voir aussi migration-paiement-v2.sql) ----------
let schemaP;
export function ensurePaySchema() {
  schemaP ??= (async () => {
    try {
      await sql`CREATE TABLE IF NOT EXISTS payment_methods (
        id serial PRIMARY KEY, kind text NOT NULL, label text NOT NULL, provider text NOT NULL,
        enabled boolean NOT NULL DEFAULT false, position int NOT NULL DEFAULT 0,
        account_name text NOT NULL DEFAULT '', account_number text NOT NULL DEFAULT '', instructions text NOT NULL DEFAULT '',
        updated_by bigint, updated_at timestamptz NOT NULL DEFAULT now())`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_kind_uniq ON payment_methods (kind) WHERE kind IN ('cash','card','orange_money','mtn_momo','paypal')`;
      await sql`CREATE TABLE IF NOT EXISTS payments (
        id bigserial PRIMARY KEY, order_id bigint NOT NULL, customer_id bigint NOT NULL, method_id int, kind text NOT NULL, provider text NOT NULL,
        amount numeric NOT NULL, currency text NOT NULL, status text NOT NULL, reference text NOT NULL UNIQUE,
        provider_ref text NOT NULL DEFAULT '', payer_ref text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        confirmed_by bigint, confirmed_at timestamptz)`;
      // Garde-fous : un seul paiement « payé » par demande ; une référence de transaction ne peut servir qu'une fois
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS payments_one_paid ON payments (order_id) WHERE status = 'paid'`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS payments_payer_ref_uniq ON payments (lower(payer_ref)) WHERE payer_ref <> '' AND status IN ('awaiting_confirmation','paid')`;
      await sql`CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id, created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status, created_at DESC)`;
      // La base d'origine n'autorise pas le statut « remboursé » sur orders : on élargit la contrainte (une seule fois, de façon atomique)
      await sql`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_status_check' AND conrelid = 'orders'::regclass AND pg_get_constraintdef(oid) NOT LIKE '%refunded%') THEN
          ALTER TABLE orders DROP CONSTRAINT orders_payment_status_check;
          ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check CHECK (payment_status IN ('none','cash_pending','pending','paid','failed','refunded'));
        END IF; END $$`;
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM payment_methods`;
      if (!n) {
        const on = env().flutterwave; // si le paiement en ligne marchait déjà, on le garde actif
        const seed = [["cash", "cash", true], ["card", "flutterwave", on], ["orange_money", "flutterwave", on], ["mtn_momo", "flutterwave", on], ["paypal", "paypal", false], ["bank_transfer", "manual", false]];
        for (let i = 0; i < seed.length; i++) {
          const [kind, provider, enabled] = seed[i];
          await sql`INSERT INTO payment_methods (kind, label, provider, enabled, position) VALUES (${kind}, ${KINDS[kind].label}, ${provider}, ${enabled}, ${i + 1}) ON CONFLICT DO NOTHING`;
        }
      }
      return true;
    } catch { return false; }
  })().then((ok) => { if (!ok) schemaP = null; return ok; });
  return schemaP;
}

// ---------- Numéros de compte : chiffrés au repos (AES-256-GCM), jamais dans les journaux ----------
export const sealNumber = (s) => (s ? encrypt(s) : "");
export function openNumber(s) { if (!s) return ""; try { return decrypt(s); } catch { return ""; } }
export const maskNumber = (s) => (s ? "…" + String(s).replace(/\s/g, "").slice(-3) : "");

export function methodView(m, withDetails) {
  const v = { id: m.id, kind: m.kind, label: m.label, provider: m.provider, mode: m.provider === "manual" ? "manual" : m.provider === "cash" ? "cash" : "online" };
  if (withDetails && (m.provider === "manual" || m.provider === "cash")) {
    v.account_name = m.account_name; v.account_number = openNumber(m.account_number); v.instructions = m.instructions;
  }
  return v;
}

// ---------- Flutterwave (cartes, Orange Money, MTN Mobile Money…) ----------
const FLW = "https://api.flutterwave.com/v3";
export async function flw(path, init = {}) {
  const r = await fetch(FLW + path, { ...init, headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000) });
  return r.json().catch(() => ({}));
}
const MOMO = { XAF: "mobilemoneyfranco", XOF: "mobilemoneyfranco", GHS: "mobilemoneyghana", UGX: "mobilemoneyuganda", RWF: "mobilemoneyrwanda", ZMW: "mobilemoneyzambia", TZS: "mobilemoneytanzania", KES: "mpesa" };
export function flwOptions(kind, currency) {
  if (kind === "card") return "card";
  if (kind === "orange_money" || kind === "mtn_momo") return MOMO[currency] || undefined;
  return undefined;
}

// ---------- PayPal (API Orders v2) ----------
const PP = () => (process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
export const PAYPAL_CURRENCIES = ["AUD", "BRL", "CAD", "CNY", "CZK", "DKK", "EUR", "HKD", "HUF", "ILS", "JPY", "MYR", "MXN", "TWD", "NZD", "NOK", "PHP", "PLN", "GBP", "SGD", "SEK", "CHF", "THB", "USD"];
const ZERO_DECIMAL = ["JPY", "HUF", "TWD"];
export const ppAmount = (amount, currency) => (ZERO_DECIMAL.includes(currency) ? String(Math.round(Number(amount))) : Number(amount).toFixed(2));

async function ppToken() {
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");
  const r = await fetch(PP() + "/v1/oauth2/token", { method: "POST", headers: { Authorization: "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error("PayPal : authentification refusée");
  return j.access_token;
}
async function pp(path, method, body, requestId) {
  const token = await ppToken();
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const r = await fetch(PP() + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: j };
}
export async function ppCreate({ reference, amount, currency, description, returnUrl, cancelUrl }) {
  const r = await pp("/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: reference, custom_id: reference, description: String(description).slice(0, 120), amount: { currency_code: currency, value: ppAmount(amount, currency) } }],
    payment_source: { paypal: { experience_context: { brand_name: "Gestion Immobilière", locale: "fr-FR", landing_page: "LOGIN", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: returnUrl, cancel_url: cancelUrl } } }
  }, reference);
  const link = (r.data.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve");
  if (!r.ok || !r.data.id || !link) return null;
  return { id: r.data.id, link: link.href };
}
export const ppCapture = (orderId, reference) => pp(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, "POST", {}, reference + "-capture");
export const ppGet = (orderId) => pp(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, "GET");

// Vérifie qu'une commande PayPal est bien payée, pour le bon montant et la bonne devise, et pour NOTRE référence
export function ppVerified(order, p) {
  const unit = order && order.purchase_units && order.purchase_units[0];
  const cap = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
  if (!order || order.status !== "COMPLETED" || !unit || !cap || cap.status !== "COMPLETED") return false;
  if (unit.custom_id !== p.reference && unit.reference_id !== p.reference) return false;
  if (!cap.amount || cap.amount.currency_code !== p.currency) return false;
  return Number(cap.amount.value) + 0.005 >= Number(p.amount);
}

// ---------- Remboursements ----------
export async function flwRefund(providerRef, amount) {
  const r = await flw(`/transactions/${encodeURIComponent(providerRef)}/refund`, { method: "POST", body: JSON.stringify({ amount: Number(amount) }) });
  return { ok: r.status === "success", message: r.message || "" };
}
export async function ppRefund(orderId, reference) {
  const g = await ppGet(orderId);
  const cap = g.ok && g.data.purchase_units && g.data.purchase_units[0] && g.data.purchase_units[0].payments && g.data.purchase_units[0].payments.captures && g.data.purchase_units[0].payments.captures[0];
  if (!cap || !cap.id) return { ok: false, message: "capture PayPal introuvable" };
  if (cap.status === "REFUNDED") return { ok: true, message: "" };
  const r = await pp(`/v2/payments/captures/${encodeURIComponent(cap.id)}/refund`, "POST", { note_to_payer: "Remboursement — Gestion Immobilière" }, reference + "-refund");
  const d = r.data || {};
  return { ok: r.ok && ["COMPLETED", "PENDING"].includes(d.status), message: d.message || (d.details && d.details[0] && d.details[0].description) || "" };
}
