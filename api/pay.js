import crypto from "node:crypto";
import { sql, send, requireUser, requireCustomer, throttle, audit, logActivity, notifyAdmins, notifyCustomer, wrap } from "./_lib.js";

const FLW = "https://api.flutterwave.com/v3";
const key = () => process.env.FLW_SECRET_KEY;

async function flw(path, init = {}) {
  const r = await fetch(FLW + path, { ...init, headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" } });
  return r.json().catch(() => ({}));
}

// Vérifie la transaction auprès de Flutterwave (on ne fait jamais confiance au navigateur ni au contenu du webhook)
async function settle(txRef) {
  const [o] = await sql`SELECT * FROM orders WHERE payment_ref = ${txRef}`;
  if (!o) return null;
  if (o.payment_status === "paid") return "paid";
  const r = await flw(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`);
  const d = r.data;
  if (d && d.status === "successful" && Number(d.amount) >= Number(o.amount) && d.currency === o.currency && d.tx_ref === txRef) {
    const up = await sql`UPDATE orders SET payment_status = 'paid', updated_at = now() WHERE id = ${o.id} AND payment_status <> 'paid' RETURNING id`;
    if (up.length) {
      await notifyAdmins("payment", "Paiement reçu", `${o.property_title} — ${o.amount} ${o.currency}`, o.customer_id);
      await notifyCustomer(o.customer_id, `Paiement reçu pour « ${o.property_title} ». Merci !`);
    }
    return "paid";
  }
  if (d && ["failed", "cancelled"].includes(d.status)) {
    await sql`UPDATE orders SET payment_status = 'failed', updated_at = now() WHERE id = ${o.id} AND payment_status = 'pending'`;
    return "failed";
  }
  return "pending";
}

async function handler(req, res) {
  const a = req.query.a;

  if (a === "config") return send(res, 200, { online: !!key(), cash: true });

  // Retour du client depuis la page de paiement
  if (a === "return") {
    const ref = String(req.query.tx_ref || "").slice(0, 80);
    let result = "echec";
    if (req.query.status === "cancelled") result = "annule";
    else if (ref && key()) result = (await settle(ref)) === "paid" ? "ok" : "attente";
    res.setHeader("Location", `/compte?paiement=${result}`);
    return res.status(302).end();
  }

  // Notification serveur à serveur de Flutterwave
  if (a === "webhook") {
    const expected = process.env.FLW_WEBHOOK_HASH || "";
    const got = String(req.headers["verif-hash"] || "");
    const ok = expected && got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
    if (!ok) return res.status(401).end();
    const ref = req.body?.data?.tx_ref;
    if (typeof ref === "string" && ref.length < 80) await settle(ref);
    return res.status(200).end();
  }

  if (req.method !== "POST") return send(res, 405, { error: "Méthode refusée" });

  // Espèces reçues : l'administrateur confirme
  if (a === "markpaid") {
    const u = await requireUser(req, res);
    if (!u) return;
    const id = Number(req.body?.orderId) || 0;
    const [o] = await sql`UPDATE orders SET payment_status = 'paid', updated_at = now() WHERE id = ${id} AND payment_status = 'cash_pending' RETURNING *`;
    if (!o) return send(res, 404, { error: "Paiement en espèces introuvable." });
    await notifyCustomer(o.customer_id, `Votre paiement en espèces pour « ${o.property_title} » a été enregistré. Merci !`);
    await audit(u.id, "payment.cash_received", String(id));
    return send(res, 200, { ok: true });
  }

  const c = await requireCustomer(req, res);
  if (!c) return;
  if (!(await throttle(req, res, "pay", 10, 600))) return;
  const id = Number(req.body?.orderId) || 0;
  const [o] = await sql`SELECT * FROM orders WHERE id = ${id} AND customer_id = ${c.id}`;
  if (!o || o.status !== "confirmed" || Number(o.amount) <= 0) return send(res, 400, { error: "Aucun paiement à effectuer pour cette demande." });
  if (!["none", "failed", "pending"].includes(o.payment_status)) return send(res, 409, { error: "Un paiement est déjà enregistré pour cette demande." });

  if (a === "cash") {
    await sql`UPDATE orders SET payment_method = 'cash', payment_status = 'cash_pending', updated_at = now() WHERE id = ${id}`;
    await logActivity(c.id, "pay_cash", o.property_id, o.property_title);
    await notifyAdmins("payment_cash", "Paiement en espèces annoncé", `${c.name} → ${o.property_title} (${o.amount} ${o.currency})`, c.id);
    return send(res, 200, { ok: true });
  }

  if (a === "online") {
    if (!key()) return send(res, 503, { error: "Le paiement en ligne n’est pas encore activé. Choisissez le paiement en espèces." });
    const txRef = `maison-${id}-${crypto.randomBytes(6).toString("hex")}`;
    await sql`UPDATE orders SET payment_method = 'online', payment_status = 'pending', payment_ref = ${txRef}, updated_at = now() WHERE id = ${id}`;
    const r = await flw("/payments", { method: "POST", body: JSON.stringify({
      tx_ref: txRef, amount: Number(o.amount), currency: o.currency,
      redirect_url: `https://${req.headers.host}/api/pay?a=return`,
      customer: { email: c.email, name: c.name, phonenumber: c.phone || undefined },
      customizations: { title: "Maison — réservation", description: String(o.property_title).slice(0, 100) },
      meta: { order_id: id }
    }) });
    if (r.status !== "success" || !r.data?.link) {
      await sql`UPDATE orders SET payment_status = 'failed', payment_method = NULL, payment_ref = NULL WHERE id = ${id}`;
      return send(res, 502, { error: "Le service de paiement est indisponible pour cette devise ou en ce moment. Essayez le paiement en espèces." });
    }
    await logActivity(c.id, "pay_online_start", o.property_id, o.property_title);
    return send(res, 200, { link: r.data.link });
  }
  send(res, 404, { error: "Inconnu" });
}

export default wrap("pay", handler);
