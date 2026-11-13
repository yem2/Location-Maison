import crypto from "node:crypto";
import { sql, send, requireUser, requireCustomer, currentUser, currentCustomer, throttle, audit, logActivity, notifyAdmins, notifyCustomer, sendMail, mailConfigured, str, siteUrl, verifyPassword, verifyTotp, decrypt, wrap } from "./_lib.js";
import { KINDS, PROVIDER_LABEL, env, providerReady, ensurePaySchema, sealNumber, openNumber, maskNumber, methodView, flw, flwOptions, PAYPAL_CURRENCIES, ppCreate, ppCapture, ppGet, ppVerified, flwRefund, ppRefund } from "./_paylib.js";
import { buildReceipt, buildContract, receiptNo, company, toCsv, localStamp, SITE_TZ, methodName } from "./_docs.js";

// ============================================================================
//  Paiements : cartes, Orange Money, MTN MoMo, PayPal, espèces, virement.
//  Principes de sécurité :
//   • le montant et la devise viennent TOUJOURS de la base (jamais du navigateur) ;
//   • un paiement en ligne n'est « payé » qu'après vérification auprès du fournisseur (montant, devise, référence) ;
//   • les opérations sont idempotentes (webhook rejoué = sans effet) et un seul paiement « payé » par demande ;
//   • une référence de transaction manuelle ne peut servir qu'une fois ;
//   • les clés API restent dans les variables d'environnement Vercel, jamais en base ni dans le navigateur ;
//   • modifier un numéro de paiement exige le mot de passe (et le code 2FA) du super administrateur.
// ============================================================================

const dup = (e) => !!e && (e.code === "23505" || /duplicate key|unique constraint/i.test(String(e.message || "")));
const money = (a, c) => `${Number(a)} ${c}`;
const kindLabel = (k) => (KINDS[k] ? KINDS[k].label : k);
const redirect = (res, result) => { res.setHeader("Location", `/compte?paiement=${result}`); return res.status(302).end(); };
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{3,39}$/;

// ---------- Documents ----------
function sendPdf(res, buf, name) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).end(buf);
}
async function emailReceipt(p, order) {
  if (!mailConfigured()) return;
  const [c] = await sql`SELECT name, email, phone FROM customers WHERE id = ${p.customer_id}`;
  if (!c || !c.email) return;
  const no = receiptNo(p), pdf = buildReceipt({ payment: p, order, customer: c });
  await sendMail(c.email, `Reçu de paiement ${no}`,
    `Bonjour ${c.name},\n\nNous avons bien reçu votre paiement de ${money(p.amount, p.currency)} pour « ${order.property_title} ». Votre reçu est joint à ce message ; il reste aussi téléchargeable depuis votre espace client.\n\nMerci,\n${company().name}`,
    [{ filename: `recu-${no}.pdf`, content: pdf.toString("base64") }]);
}
const PAY_STATUSES = ["pending", "awaiting_confirmation", "paid", "failed", "cancelled", "rejected", "duplicate", "refund_pending", "refunded"];
const STATUS_FR = { pending: "En cours", awaiting_confirmation: "À confirmer", paid: "Payé", failed: "Échoué", cancelled: "Annulé", rejected: "Refusé", duplicate: "Doublon", refund_pending: "Remboursement en cours", refunded: "Remboursé" };

// ---------- Passage à « payé » (idempotent) ----------
async function markPaid(p, { providerRef = "", by = null, manual = false } = {}) {
  let up;
  try {
    up = manual
      ? await sql`UPDATE payments SET status = 'paid', confirmed_by = ${by}, confirmed_at = now(), updated_at = now() WHERE id = ${p.id} AND status = 'awaiting_confirmation' RETURNING id`
      : await sql`UPDATE payments SET status = 'paid', provider_ref = ${providerRef || p.provider_ref}, confirmed_at = now(), updated_at = now() WHERE id = ${p.id} AND status NOT IN ('paid','rejected','duplicate') RETURNING id`;
  } catch (e) {
    if (!dup(e)) throw e;
    // Déjà payé par un autre moyen : on ne crédite pas deux fois, on alerte pour remboursement.
    await sql`UPDATE payments SET status = 'duplicate', provider_ref = ${providerRef || p.provider_ref}, updated_at = now() WHERE id = ${p.id} AND status <> 'paid'`;
    await notifyAdmins("payment_duplicate", "Paiement en double à rembourser", `${p.reference} — ${money(p.amount, p.currency)} (${kindLabel(p.kind)})`, p.customer_id);
    return "duplicate";
  }
  if (!up.length) { const [x] = await sql`SELECT status FROM payments WHERE id = ${p.id}`; return x ? x.status : null; }
  const [o] = await sql`UPDATE orders SET payment_status = 'paid', payment_method = ${p.kind}, payment_ref = ${p.reference}, updated_at = now() WHERE id = ${p.order_id} RETURNING property_title`;
  const title = (o && o.property_title) || "votre réservation";
  await notifyAdmins("payment", "Paiement reçu", `${title} — ${money(p.amount, p.currency)} (${kindLabel(p.kind)})`, p.customer_id);
  await notifyCustomer(p.customer_id, `Paiement reçu pour « ${title} ». Votre reçu est disponible dans « Mes demandes ».`);
  try { await emailReceipt({ ...p, status: "paid", confirmed_at: new Date().toISOString() }, { ...(o || {}), property_title: title }); } catch { /* le reçu reste téléchargeable */ }
  return "paid";
}

// ---------- Flutterwave : on ne fait jamais confiance au navigateur ni au contenu du webhook ----------
async function settleFlw(ref) {
  const [p] = await sql`SELECT * FROM payments WHERE reference = ${ref} AND provider = 'flutterwave'`;
  if (!p) return null;
  if (p.status === "paid") return "paid";
  if (["rejected", "duplicate"].includes(p.status)) return p.status;
  const r = await flw(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(ref)}`);
  const d = r.data;
  if (r.status === "success" && d && d.status === "successful" && d.tx_ref === ref && d.currency === p.currency && Number(d.amount) >= Number(p.amount)) {
    return markPaid(p, { providerRef: String(d.id || "") });
  }
  if (d && ["failed", "cancelled"].includes(d.status)) {
    await sql`UPDATE payments SET status = 'failed', updated_at = now() WHERE id = ${p.id} AND status = 'pending'`;
    await sql`UPDATE orders SET payment_status = 'failed', updated_at = now() WHERE id = ${p.order_id} AND payment_status = 'pending' AND payment_ref = ${p.reference}`;
    return "failed";
  }
  return "pending";
}

// ---------- PayPal : capture puis vérification montant / devise / référence ----------
async function settlePayPal(p) {
  if (p.status === "paid") return "paid";
  if (["rejected", "duplicate"].includes(p.status)) return p.status;
  if (!p.provider_ref) return "pending";
  let order = null;
  const cap = await ppCapture(p.provider_ref, p.reference);
  if (cap.ok) order = cap.data;
  else { const g = await ppGet(p.provider_ref); if (g.ok) order = g.data; }
  if (order && ppVerified(order, p)) return markPaid(p, { providerRef: p.provider_ref });
  return "pending";
}

// ---------- Ré-authentification pour les actions sensibles (numéros de paiement) ----------
async function reauth(req, res, me, b) {
  if (!(await throttle(req, res, "payauth", 8, 900))) return false;
  const [row] = await sql`SELECT password_hash, totp_enabled, totp_secret FROM users WHERE id = ${me.id}`;
  const pwOk = !!row && verifyPassword(String(b.password || "").slice(0, 200), row.password_hash);
  const codeOk = !!row && (!row.totp_enabled || (pwOk && verifyTotp(decrypt(row.totp_secret), String(b.code || ""))));
  if (!pwOk || !codeOk) {
    await audit(me.id, "payment.reauth_failed");
    send(res, 403, { error: row && row.totp_enabled ? "Mot de passe ou code de double authentification incorrect." : "Mot de passe incorrect." });
    return false;
  }
  return true;
}

async function handler(req, res) {
  const a = req.query.a;

  // ---------- Configuration publique (sans aucun numéro de compte) ----------
  if (a === "config") {
    let online = !!process.env.FLW_SECRET_KEY, cash = true, methods = [];
    if (await ensurePaySchema()) {
      const rows = (await sql`SELECT id, kind, label, provider FROM payment_methods WHERE enabled ORDER BY position, id`).filter((m) => providerReady(m.provider));
      methods = rows.map((m) => ({ id: m.id, kind: m.kind, label: m.label }));
      online = rows.some((m) => m.provider === "flutterwave" || m.provider === "paypal");
      cash = rows.some((m) => m.provider === "cash");
    }
    return send(res, 200, { online, cash, methods });
  }

  // ---------- Retours des pages de paiement ----------
  if (a === "return") { // Flutterwave
    const ref = String(req.query.tx_ref || "").slice(0, 100);
    let result = "echec";
    if (req.query.status === "cancelled") result = "annule";
    else if (ref && env().flutterwave && (await ensurePaySchema())) { const r = await settleFlw(ref); result = r === "paid" ? "ok" : r ? "attente" : "echec"; }
    return redirect(res, result);
  }
  if (a === "paypal_return") {
    const ref = String(req.query.ref || "").slice(0, 100), token = String(req.query.token || "").slice(0, 64);
    let result = "echec";
    if (ref && env().paypal && (await ensurePaySchema())) {
      const [p] = await sql`SELECT * FROM payments WHERE reference = ${ref} AND provider = 'paypal'`;
      if (p && p.provider_ref === token) { const r = await settlePayPal(p); result = r === "paid" ? "ok" : "attente"; }
    }
    return redirect(res, result);
  }
  if (a === "paypal_cancel") {
    const ref = String(req.query.ref || "").slice(0, 100);
    if (ref && (await ensurePaySchema())) await sql`UPDATE payments SET status = 'cancelled', updated_at = now() WHERE reference = ${ref} AND provider = 'paypal' AND status = 'pending'`;
    return redirect(res, "annule");
  }

  // ---------- Notification serveur à serveur de Flutterwave (signature comparée en temps constant) ----------
  if (a === "webhook") {
    const expected = process.env.FLW_WEBHOOK_HASH || "";
    const got = String(req.headers["verif-hash"] || "");
    const ok = expected && got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
    if (!ok) return res.status(401).end();
    const ref = req.body && req.body.data && req.body.data.tx_ref;
    if (typeof ref === "string" && ref.length < 100 && (await ensurePaySchema())) await settleFlw(ref);
    return res.status(200).end();
  }

  // ---------- Documents PDF : reçu et contrat (client concerné ou administrateur) ----------
  if (a === "receipt" || a === "contract") {
    const c = await currentCustomer(req);
    const u = c ? null : await currentUser(req);
    if (!c && !u) return send(res, 401, { error: "Connexion requise." });
    if (!(await ensurePaySchema())) return send(res, 503, { error: "Module de paiement indisponible." });
    const oid = Number(req.query.orderId) || 0;
    const [o] = c ? await sql`SELECT * FROM orders WHERE id = ${oid} AND customer_id = ${c.id}` : await sql`SELECT * FROM orders WHERE id = ${oid}`;
    if (!o) return send(res, 404, { error: "Demande introuvable." });
    const [cu] = c ? [c] : await sql`SELECT name, email, phone FROM customers WHERE id = ${o.customer_id}`;
    if (!cu) return send(res, 404, { error: "Client introuvable." });
    let [p] = await sql`SELECT * FROM payments WHERE order_id = ${o.id} AND status = 'paid' ORDER BY id DESC LIMIT 1`;
    if (!p && o.payment_status === "paid") p = { id: o.id, order_id: o.id, legacy: true, kind: o.payment_method, amount: o.amount, currency: o.currency, reference: o.payment_ref || "", payer_ref: "", confirmed_at: o.updated_at, created_at: o.updated_at };
    if (a === "receipt") {
      if (!p) return send(res, o.payment_status === "refunded" ? 409 : 404, { error: o.payment_status === "refunded" ? "Ce paiement a été remboursé : aucun reçu n’est disponible." : "Aucun paiement enregistré pour cette demande." });
      return sendPdf(res, buildReceipt({ payment: p, order: o, customer: cu }), `recu-${receiptNo(p)}.pdf`);
    }
    if (o.status !== "confirmed") return send(res, 409, { error: "Le contrat est disponible une fois la demande acceptée." });
    const [pr] = o.property_id ? await sql`SELECT title, location, operation, kind_label, price, currency, rooms, bedrooms, bathrooms, area, price_suffix FROM properties WHERE id = ${o.property_id}` : [];
    const paid = p ? { confirmed_at: p.confirmed_at, created_at: p.created_at, receiptNo: receiptNo(p) } : null;
    return sendPdf(res, buildContract({ order: o, property: pr || null, customer: cu, paid }), `contrat-${o.id}.pdf`);
  }

  // ---------- Export comptable CSV (super administrateur) ----------
  if (a === "export") {
    const me = await requireUser(req, res, "super_admin");
    if (!me) return;
    if (!(await ensurePaySchema())) return send(res, 503, { error: "Module de paiement indisponible." });
    const iso = /^\d{4}-\d{2}-\d{2}$/, today = localStamp(new Date()).slice(0, 10);
    const from = iso.test(req.query.from) ? req.query.from : today.slice(0, 8) + "01", to = iso.test(req.query.to) ? req.query.to : today;
    const tz = SITE_TZ();
    const rows = await sql`SELECT p.id, p.created_at, p.confirmed_at, p.kind, p.amount, p.currency, p.status, p.reference, p.provider_ref, p.payer_ref, o.property_title, c.name, c.email, c.phone
      FROM payments p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN customers c ON c.id = p.customer_id
      WHERE (p.created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date ORDER BY p.created_at LIMIT 20000`;
    const csv = toCsv(["Date", "N° reçu", "Client", "E-mail", "Téléphone", "Bien", "Moyen", "Statut", "Montant", "Devise", "Référence", "Réf. fournisseur", "Réf. transaction client", "Confirmé le"],
      rows.map((r) => [localStamp(r.created_at), r.status === "paid" || r.status === "refunded" ? receiptNo(r) : "", r.name, r.email, r.phone, r.property_title, methodName(r.kind), STATUS_FR[r.status] || r.status,
        String(Number(r.amount)).replace(".", ","), r.currency, r.reference, r.provider_ref, r.payer_ref, localStamp(r.confirmed_at)]));
    await audit(me.id, "payment.export", `${from} → ${to} (${rows.length} lignes)`);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="paiements-${from}_${to}.csv"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).end(csv);
  }

  // ---------- Administration : lectures (GET) ----------
  if (a === "admin_methods" || a === "admin_status") {
    const me = await requireUser(req, res, "super_admin");
    if (!me) return;
    if (!(await ensurePaySchema())) return send(res, 503, { error: "Module de paiement indisponible : base de données injoignable." });
    if (a === "admin_status") return send(res, 200, { env: env(), webhookUrl: `${siteUrl(req)}/api/pay?a=webhook`, https: String(siteUrl(req)).startsWith("https://") });
    const rows = await sql`SELECT * FROM payment_methods ORDER BY position, id`;
    return send(res, 200, {
      methods: rows.map((m) => ({ id: m.id, kind: m.kind, label: m.label, provider: m.provider, enabled: m.enabled, position: m.position, account_name: m.account_name, account_number: openNumber(m.account_number), instructions: m.instructions, ready: providerReady(m.provider) })),
      kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { label: v.label, providers: v.providers }])), providerLabels: PROVIDER_LABEL
    });
  }
  if (a === "admin_payments") {
    const me = await requireUser(req, res);
    if (!me) return;
    if (!(await ensurePaySchema())) return send(res, 200, { rows: [], summary: { awaiting: 0, paid: [] } });
    const st = PAY_STATUSES.includes(req.query.status) ? req.query.status : null;
    const rows = st
      ? await sql`SELECT p.id, p.order_id, p.kind, p.provider, p.amount, p.currency, p.status, p.reference, p.payer_ref, p.note, p.created_at, p.confirmed_at, o.property_title, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
          FROM payments p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN customers c ON c.id = p.customer_id WHERE p.status = ${st} ORDER BY p.created_at DESC LIMIT 200`
      : await sql`SELECT p.id, p.order_id, p.kind, p.provider, p.amount, p.currency, p.status, p.reference, p.payer_ref, p.note, p.created_at, p.confirmed_at, o.property_title, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
          FROM payments p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN customers c ON c.id = p.customer_id ORDER BY p.created_at DESC LIMIT 200`;
    const [aw] = await sql`SELECT count(*)::int AS n FROM payments WHERE status = 'awaiting_confirmation'`;
    const paid = await sql`SELECT currency, sum(amount)::float AS total, count(*)::int AS n FROM payments WHERE status = 'paid' GROUP BY currency ORDER BY currency`;
    const refunded = await sql`SELECT currency, sum(amount)::float AS total, count(*)::int AS n FROM payments WHERE status = 'refunded' GROUP BY currency ORDER BY currency`;
    return send(res, 200, { rows, summary: { awaiting: aw.n, paid, refunded } });
  }

  if (req.method !== "POST") return send(res, 405, { error: "Méthode refusée" });
  const b = req.body || {};

  // ---------- Administration : confirmer / refuser / revérifier (tout administrateur) ----------
  if (a === "markpaid" || a === "admin_confirm" || a === "admin_reject" || a === "admin_recheck") {
    const u = await requireUser(req, res);
    if (!u) return;
    if (!(await ensurePaySchema())) return send(res, 503, { error: "Module de paiement indisponible." });
    if (a === "markpaid") { // compatibilité : par numéro de demande
      const oid = Number(b.orderId) || 0;
      const [p] = await sql`SELECT * FROM payments WHERE order_id = ${oid} AND status = 'awaiting_confirmation' ORDER BY id DESC LIMIT 1`;
      if (p) { await markPaid(p, { by: u.id, manual: true }); await audit(u.id, "payment.confirm", p.reference); return send(res, 200, { ok: true }); }
      const [o] = await sql`UPDATE orders SET payment_status = 'paid', updated_at = now() WHERE id = ${oid} AND payment_status = 'cash_pending' RETURNING customer_id, property_title`;
      if (!o) return send(res, 404, { error: "Paiement à confirmer introuvable." });
      await notifyCustomer(o.customer_id, `Votre paiement pour « ${o.property_title} » a été enregistré. Merci !`);
      await audit(u.id, "payment.cash_received", String(oid));
      return send(res, 200, { ok: true });
    }
    const id = Number(b.paymentId) || 0;
    const [p] = await sql`SELECT * FROM payments WHERE id = ${id}`;
    if (!p) return send(res, 404, { error: "Paiement introuvable." });
    if (a === "admin_confirm") {
      if (p.status !== "awaiting_confirmation") return send(res, 409, { error: "Ce paiement n’est pas en attente de confirmation." });
      const r = await markPaid(p, { by: u.id, manual: true });
      await audit(u.id, "payment.confirm", `${p.reference} ${money(p.amount, p.currency)}`);
      return send(res, 200, { ok: true, status: r });
    }
    if (a === "admin_reject") {
      const reason = str(b.reason, 200);
      const [x] = await sql`UPDATE payments SET status = 'rejected', note = ${reason}, confirmed_by = ${u.id}, confirmed_at = now(), updated_at = now() WHERE id = ${id} AND status = 'awaiting_confirmation' RETURNING *`;
      if (!x) return send(res, 409, { error: "Ce paiement n’est pas en attente de confirmation." });
      const [o] = await sql`UPDATE orders SET payment_status = 'none', payment_method = NULL, payment_ref = NULL, updated_at = now() WHERE id = ${x.order_id} AND payment_status = 'cash_pending' RETURNING property_title`;
      await notifyCustomer(x.customer_id, `Votre paiement pour « ${(o && o.property_title) || "votre réservation"} » n’a pas pu être confirmé${reason ? " : " + reason : ""}. Vous pouvez réessayer depuis « Mon compte ».`);
      await audit(u.id, "payment.reject", `${x.reference}${reason ? " — " + reason : ""}`);
      return send(res, 200, { ok: true });
    }
    // admin_recheck : interroge le fournisseur pour un paiement en ligne resté « en cours »
    if (!["pending", "failed", "cancelled"].includes(p.status)) return send(res, 409, { error: "Ce paiement n’a pas besoin d’être revérifié." });
    let r = null;
    if (p.provider === "flutterwave" && env().flutterwave) r = await settleFlw(p.reference);
    else if (p.provider === "paypal" && env().paypal) r = await settlePayPal(p);
    else return send(res, 400, { error: "Ce paiement ne peut pas être revérifié automatiquement." });
    await audit(u.id, "payment.recheck", `${p.reference} → ${r}`);
    return send(res, 200, { ok: true, status: r });
  }

  // ---------- Administration : moyens de paiement (super administrateur) ----------
  if (a === "admin_save" || a === "admin_toggle" || a === "admin_delete" || a === "admin_refund") {
    const me = await requireUser(req, res, "super_admin");
    if (!me) return;
    if (!(await ensurePaySchema())) return send(res, 503, { error: "Module de paiement indisponible : base de données injoignable." });
    const id = Number(b.id) || 0;

    if (a === "admin_toggle") {
      const [m] = await sql`SELECT * FROM payment_methods WHERE id = ${id}`;
      if (!m) return send(res, 404, { error: "Moyen de paiement introuvable." });
      const enabled = b.enabled === true;
      if (enabled && !providerReady(m.provider)) return send(res, 400, { error: "Les clés API de ce fournisseur ne sont pas configurées sur le serveur (Vercel > Environment Variables)." });
      if (enabled && m.provider === "manual" && !openNumber(m.account_number)) return send(res, 400, { error: "Renseignez d’abord le numéro ou le compte à créditer." });
      await sql`UPDATE payment_methods SET enabled = ${enabled}, updated_by = ${me.id}, updated_at = now() WHERE id = ${id}`;
      await audit(me.id, enabled ? "payment.method_enable" : "payment.method_disable", m.kind);
      return send(res, 200, { ok: true });
    }

    if (!(await reauth(req, res, me, b))) return;

    if (a === "admin_refund") {
      const pid = Number(b.paymentId) || 0, reason = str(b.reason, 200), recordOnly = b.recordOnly === true;
      const [p] = await sql`SELECT * FROM payments WHERE id = ${pid}`;
      if (!p) return send(res, 404, { error: "Paiement introuvable." });
      if (!["paid", "duplicate"].includes(p.status) && !(recordOnly && p.status === "refund_pending")) return send(res, 409, { error: "Seuls les paiements encaissés ou en double peuvent être remboursés." });
      const [claim] = await sql`UPDATE payments SET status = 'refund_pending', updated_at = now() WHERE id = ${pid} AND status = ${p.status} RETURNING id`;
      if (!claim) return send(res, 409, { error: "Un remboursement est déjà en cours pour ce paiement." });
      const viaApi = !recordOnly && (p.provider === "flutterwave" || p.provider === "paypal");
      let r = { ok: true, message: "" };
      if (viaApi) {
        try {
          if (p.provider === "flutterwave") r = env().flutterwave && p.provider_ref ? await flwRefund(p.provider_ref, p.amount) : { ok: false, message: "identifiant de transaction manquant : remboursez depuis le tableau Flutterwave, puis utilisez « Déjà remboursé »" };
          else r = env().paypal ? await ppRefund(p.provider_ref, p.reference) : { ok: false, message: "PayPal n’est pas configuré" };
        } catch (e) {
          // Réponse incertaine : on laisse « remboursement en cours » pour éviter un double remboursement
          await audit(me.id, "payment.refund_unknown", p.reference);
          return send(res, 504, { error: "Le fournisseur n’a pas répondu : vérifiez dans son tableau de bord si le remboursement a eu lieu, puis utilisez « Déjà remboursé »." });
        }
      }
      if (!r.ok) {
        await sql`UPDATE payments SET status = ${p.status === "refund_pending" ? "paid" : p.status}, updated_at = now() WHERE id = ${pid} AND status = 'refund_pending'`;
        await audit(me.id, "payment.refund_failed", `${p.reference} ${r.message}`.slice(0, 300));
        return send(res, 502, { error: "Remboursement refusé par le fournisseur" + (r.message ? " : " + r.message : "") + "." });
      }
      await sql`UPDATE payments SET status = 'refunded', note = ${reason}, confirmed_by = ${me.id}, updated_at = now() WHERE id = ${pid}`;
      await sql`UPDATE orders SET payment_status = 'refunded', updated_at = now() WHERE id = ${p.order_id} AND payment_status = 'paid' AND payment_ref = ${p.reference}`;
      await notifyCustomer(p.customer_id, `Votre paiement de ${money(p.amount, p.currency)} a été remboursé${reason ? " (" + reason + ")" : ""}.`);
      await audit(me.id, "payment.refund", `${p.reference} ${money(p.amount, p.currency)} ${viaApi ? "via " + p.provider : "(enregistré manuellement)"}`);
      return send(res, 200, { ok: true, via: viaApi ? p.provider : "manual" });
    }

    if (a === "admin_delete") {
      const [m] = await sql`DELETE FROM payment_methods WHERE id = ${id} RETURNING kind, label`;
      if (!m) return send(res, 404, { error: "Moyen de paiement introuvable." });
      await audit(me.id, "payment.method_delete", m.kind);
      return send(res, 200, { ok: true });
    }

    // admin_save
    let old = null;
    if (id) { [old] = await sql`SELECT * FROM payment_methods WHERE id = ${id}`; if (!old) return send(res, 404, { error: "Moyen de paiement introuvable." }); }
    const kind = old ? old.kind : Object.prototype.hasOwnProperty.call(KINDS, b.kind) ? b.kind : null;
    if (!kind) return send(res, 400, { error: "Type de moyen de paiement inconnu." });
    const provider = KINDS[kind].providers.includes(b.provider) ? b.provider : KINDS[kind].providers[0];
    const label = str(b.label, 60) || KINDS[kind].label;
    const accName = str(b.account_name, 100);
    const accNum = str(b.account_number, 60).replace(/\s+/g, " ");
    if (accNum && !/^[A-Za-z0-9+\-_. ()\/]+$/.test(accNum)) return send(res, 400, { error: "Numéro de compte invalide : chiffres, lettres, espaces et + - . / ( ) uniquement." });
    const instructions = str(b.instructions, 600);
    const enabled = b.enabled === true;
    const position = Math.min(Math.max(Number(b.position) || 0, 0), 999);
    if (enabled && provider === "manual" && !accNum) return send(res, 400, { error: "Renseignez le numéro ou le compte à créditer avant d’activer ce moyen." });
    if (enabled && !providerReady(provider)) return send(res, 400, { error: "Les clés API de ce fournisseur ne sont pas configurées sur le serveur (Vercel > Environment Variables)." });
    const sealed = sealNumber(accNum);
    try {
      if (old) {
        await sql`UPDATE payment_methods SET label = ${label}, provider = ${provider}, enabled = ${enabled}, position = ${position}, account_name = ${accName}, account_number = ${sealed}, instructions = ${instructions}, updated_by = ${me.id}, updated_at = now() WHERE id = ${id}`;
        await audit(me.id, "payment.method_update", `${kind} ${provider} ${maskNumber(accNum)} (avant ${maskNumber(openNumber(old.account_number))})`);
      } else {
        await sql`INSERT INTO payment_methods (kind, label, provider, enabled, position, account_name, account_number, instructions, updated_by) VALUES (${kind}, ${label}, ${provider}, ${enabled}, ${position}, ${accName}, ${sealed}, ${instructions}, ${me.id})`;
        await audit(me.id, "payment.method_create", `${kind} ${provider} ${maskNumber(accNum)}`);
      }
    } catch (e) {
      if (dup(e)) return send(res, 409, { error: "Ce type de moyen de paiement existe déjà : modifiez-le plutôt que d’en créer un second." });
      throw e;
    }
    await notifyAdmins("payment_config", "Moyen de paiement modifié", `${me.name || me.email} a modifié « ${label} »`);
    return send(res, 200, { ok: true });
  }

  // ---------- Client : choisir un moyen et payer ----------
  const c = await requireCustomer(req, res);
  if (!c) return;
  if (!(await ensurePaySchema())) return send(res, 503, { error: "Le paiement est momentanément indisponible. Réessayez dans quelques minutes." });
  const orderId = Number(b.orderId) || 0;
  const [o] = await sql`SELECT * FROM orders WHERE id = ${orderId} AND customer_id = ${c.id}`;
  if (!o || o.status !== "confirmed" || Number(o.amount) <= 0) return send(res, 400, { error: "Aucun paiement à effectuer pour cette demande." });
  if (!["none", "failed", "pending"].includes(o.payment_status)) return send(res, 409, { error: "Un paiement est déjà enregistré pour cette demande." });

  if (a === "methods") {
    const rows = (await sql`SELECT * FROM payment_methods WHERE enabled ORDER BY position, id`)
      .filter((m) => providerReady(m.provider) && (m.provider !== "paypal" || PAYPAL_CURRENCIES.includes(o.currency)) && (m.provider !== "manual" || openNumber(m.account_number)));
    return send(res, 200, { order: { id: o.id, title: o.property_title, amount: Number(o.amount), currency: o.currency }, methods: rows.map((m) => methodView(m, true)) });
  }

  if (a === "start" || a === "cash" || a === "online") { // « cash » et « online » : anciens appels, conservés
    if (!(await throttle(req, res, "pay", 12, 600))) return;
    const [m] = a === "start" ? await sql`SELECT * FROM payment_methods WHERE id = ${Number(b.methodId) || 0} AND enabled`
      : a === "cash" ? await sql`SELECT * FROM payment_methods WHERE kind = 'cash' AND enabled`
      : await sql`SELECT * FROM payment_methods WHERE kind = 'card' AND enabled`;
    if (!m || !providerReady(m.provider)) return send(res, 400, { error: "Ce moyen de paiement n’est pas disponible. Choisissez-en un autre." });
    const reference = `maison-${o.id}-${crypto.randomBytes(8).toString("hex")}`;
    const insert = (status, payerRef = "", providerRef = "") => sql`INSERT INTO payments (order_id, customer_id, method_id, kind, provider, amount, currency, status, reference, provider_ref, payer_ref)
      VALUES (${o.id}, ${c.id}, ${m.id}, ${m.kind}, ${m.provider}, ${o.amount}, ${o.currency}, ${status}, ${reference}, ${providerRef}, ${payerRef})`;

    if (m.provider === "cash" || m.provider === "manual") {
      let payerRef = "";
      if (m.provider === "manual") {
        payerRef = str(b.payerRef, 40);
        if (!openNumber(m.account_number)) return send(res, 400, { error: "Ce moyen de paiement n’est pas encore configuré." });
        if (!REF_RE.test(payerRef)) return send(res, 400, { error: "Indiquez la référence de la transaction reçue par SMS ou e-mail (4 à 40 caractères)." });
      }
      try { await insert("awaiting_confirmation", payerRef); }
      catch (e) { if (dup(e)) return send(res, 409, { error: "Cette référence de transaction a déjà été utilisée." }); throw e; }
      await sql`UPDATE orders SET payment_method = ${m.kind}, payment_status = 'cash_pending', payment_ref = ${reference}, updated_at = now() WHERE id = ${o.id}`;
      await logActivity(c.id, m.provider === "cash" ? "pay_cash" : "pay_manual", o.property_id, o.property_title);
      await notifyAdmins(m.provider === "cash" ? "payment_cash" : "payment_manual", m.provider === "cash" ? "Paiement en espèces annoncé" : `Paiement ${m.label} à confirmer`,
        `${c.name} → ${o.property_title} (${money(o.amount, o.currency)})${payerRef ? " · réf. " + payerRef : ""}`, c.id);
      return send(res, 200, { ok: true, status: "awaiting_confirmation" });
    }

    // Paiements en ligne : l'ancienne tentative restée « en cours » est annulée côté site
    const base = siteUrl(req);
    if (m.provider === "flutterwave") {
      await sql`UPDATE payments SET status = 'cancelled', updated_at = now() WHERE order_id = ${o.id} AND status = 'pending'`;
      await insert("pending");
      await sql`UPDATE orders SET payment_method = ${m.kind}, payment_status = 'pending', payment_ref = ${reference}, updated_at = now() WHERE id = ${o.id}`;
      const r = await flw("/payments", { method: "POST", body: JSON.stringify({
        tx_ref: reference, amount: Number(o.amount), currency: o.currency, payment_options: flwOptions(m.kind, o.currency),
        redirect_url: `${base}/api/pay?a=return`,
        customer: { email: c.email, name: c.name, phonenumber: c.phone || undefined },
        customizations: { title: "Gestion Immobilière — réservation", description: String(o.property_title).slice(0, 100) },
        meta: { order_id: o.id, method: m.kind }
      }) });
      if (r.status !== "success" || !r.data || !r.data.link) {
        await sql`UPDATE payments SET status = 'failed', updated_at = now() WHERE reference = ${reference}`;
        await sql`UPDATE orders SET payment_status = 'failed', payment_method = NULL, payment_ref = NULL WHERE id = ${o.id}`;
        return send(res, 502, { error: "Ce moyen de paiement est indisponible pour cette devise ou en ce moment. Essayez un autre moyen." });
      }
      await logActivity(c.id, "pay_online_start", o.property_id, o.property_title);
      return send(res, 200, { link: r.data.link });
    }

    if (m.provider === "paypal") {
      if (!PAYPAL_CURRENCIES.includes(o.currency)) return send(res, 400, { error: `PayPal n’accepte pas la devise ${o.currency}. Choisissez un autre moyen.` });
      const pp = await ppCreate({ reference, amount: o.amount, currency: o.currency, description: o.property_title,
        returnUrl: `${base}/api/pay?a=paypal_return&ref=${reference}`, cancelUrl: `${base}/api/pay?a=paypal_cancel&ref=${reference}` });
      if (!pp) return send(res, 502, { error: "PayPal est indisponible en ce moment. Essayez un autre moyen." });
      await sql`UPDATE payments SET status = 'cancelled', updated_at = now() WHERE order_id = ${o.id} AND status = 'pending'`;
      await insert("pending", "", pp.id);
      await sql`UPDATE orders SET payment_method = ${m.kind}, payment_status = 'pending', payment_ref = ${reference}, updated_at = now() WHERE id = ${o.id}`;
      await logActivity(c.id, "pay_online_start", o.property_id, o.property_title);
      return send(res, 200, { link: pp.link });
    }
    return send(res, 400, { error: "Moyen de paiement non pris en charge." });
  }
  send(res, 404, { error: "Inconnu" });
}

export default wrap("pay", handler);
