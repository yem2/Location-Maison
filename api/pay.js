import crypto from "node:crypto";
import { sql, send, requireUser, requireCustomer, throttle, audit, logActivity, notifyAdmins, wrap } from "./_lib.js";
import {
  METHOD_LABEL, FLW_OPTIONS, MOMO_CUR, ensurePayments, loadCfg, optionsFor, flwReady, ppReady, flw, flwState,
  paypalAmount, ppCreate, ppState, ppVerifyWebhook, markPaid, markFailed, newRef, normPhone, siteUrl
} from "./_pay.js";

const back = (res, result) => { res.setHeader("Location", `/compte?paiement=${result}`); return res.status(302).end(); };
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Retour du client / webhook Flutterwave : on vérifie toujours auprès de Flutterwave, jamais le contenu reçu.
async function settleFlw(ref) {
  const [p] = await sql`SELECT * FROM payments WHERE reference = ${ref} AND provider = 'flutterwave'`;
  if (!p) return null;
  if (p.status === "paid") return "paid";
  const st = await flwState(p);
  if (st === "paid") { await markPaid(p.id); return "paid"; }
  if (st === "failed") await markFailed(p.id, "Refusé par le fournisseur");
  return st;
}

async function settlePaypal(p, paypalOrderId) {
  if (p.status === "paid") return "paid";
  const r = await ppState(p, paypalOrderId);
  if (r.state === "paid") { await markPaid(p.id, { note: "Capture PayPal " + r.captureId }); return "paid"; }
  if (r.state === "failed") await markFailed(p.id, "Refusé par PayPal");
  return r.state;
}

async function handler(req, res) {
  const a = req.query.a;
  await ensurePayments();

  if (a === "config") return send(res, 200, { online: flwReady() || ppReady(), cash: true });

  // ----- Retours navigateur -----
  if (a === "return") {
    const ref = String(req.query.tx_ref || "").slice(0, 80);
    let result = "echec";
    if (req.query.status === "cancelled") result = "annule";
    else if (ref && flwReady()) result = (await settleFlw(ref)) === "paid" ? "ok" : "attente";
    return back(res, result);
  }
  if (a === "pp_return") {
    const ref = String(req.query.ref || "").slice(0, 80), token = String(req.query.token || "").slice(0, 40);
    const [p] = ref && token ? await sql`SELECT * FROM payments WHERE reference = ${ref} AND provider = 'paypal' AND provider_ref = ${token}` : [];
    if (!p) return back(res, "echec");
    try { return back(res, (await settlePaypal(p, token)) === "paid" ? "ok" : "attente"); } catch { return back(res, "attente"); }
  }

  // ----- Webhooks (serveur à serveur) -----
  if (a === "webhook") {
    const expected = process.env.FLW_WEBHOOK_HASH || "", got = String(req.headers["verif-hash"] || "");
    if (!expected || !safeEq(got, expected)) return res.status(401).end();
    const ref = req.body?.data?.tx_ref;
    if (typeof ref === "string" && ref.length < 80) await settleFlw(ref);
    return res.status(200).end();
  }
  if (a === "pp_webhook") {
    if (!(await ppVerifyWebhook(req.headers, req.body))) return res.status(401).end();
    const rs = req.body?.resource || {};
    const orderId = rs.supplementary_data?.related_ids?.order_id || rs.id;
    if (typeof orderId === "string" && orderId.length < 40) {
      const [p] = await sql`SELECT * FROM payments WHERE provider = 'paypal' AND provider_ref = ${orderId}`;
      if (p) await settlePaypal(p, orderId).catch(() => {});
    }
    return res.status(200).end();
  }

  // ----- Moyens disponibles pour une demande (client connecté) -----
  if (a === "methods") {
    const c = await requireCustomer(req, res);
    if (!c) return;
    const id = Number(req.query.orderId) || 0;
    const [o] = await sql`SELECT * FROM orders WHERE id = ${id} AND customer_id = ${c.id}`;
    if (!o || o.status !== "confirmed" || Number(o.amount) <= 0) return send(res, 400, { error: "Aucun paiement à effectuer pour cette demande." });
    const hist = await sql`SELECT method, status, created_at FROM payments WHERE order_id = ${id} ORDER BY created_at DESC LIMIT 5`;
    return send(res, 200, { amount: o.amount, currency: o.currency, options: optionsFor(await loadCfg(), o), history: hist });
  }

  if (req.method !== "POST") return send(res, 405, { error: "Méthode refusée" });

  // ----- Espèces reçues à l'agence (conservé pour l'écran Commandes) -----
  if (a === "markpaid") {
    const u = await requireUser(req, res);
    if (!u) return;
    const id = Number(req.body?.orderId) || 0;
    const [p] = await sql`SELECT id FROM payments WHERE order_id = ${id} AND method = 'cash' AND status = 'pending' ORDER BY id DESC LIMIT 1`;
    if (!p) return send(res, 404, { error: "Paiement en espèces introuvable." });
    if (!(await markPaid(p.id, { by: u.id }))) return send(res, 409, { error: "Un paiement est déjà enregistré pour cette demande." });
    await audit(u.id, "payment.cash_received", String(id));
    return send(res, 200, { ok: true });
  }

  // ----- Le client choisit un moyen de paiement -----
  if (a === "start") {
    const c = await requireCustomer(req, res);
    if (!c) return;
    if (!(await throttle(req, res, "pay", 12, 600))) return;
    const b = req.body || {}, id = Number(b.orderId) || 0, method = String(b.method || "");
    if (!Object.hasOwn(METHOD_LABEL, method)) return send(res, 400, { error: "Moyen de paiement inconnu." });
    const [o] = await sql`SELECT * FROM orders WHERE id = ${id} AND customer_id = ${c.id}`;
    if (!o || o.status !== "confirmed" || Number(o.amount) <= 0) return send(res, 400, { error: "Aucun paiement à effectuer pour cette demande." });
    if (o.payment_status === "paid") return send(res, 409, { error: "Cette demande est déjà payée." });
    const [open] = await sql`SELECT id FROM payments WHERE order_id = ${id} AND status = 'review' LIMIT 1`;
    if (open) return send(res, 409, { error: "Un paiement est en cours de vérification par l’agence. Patientez ou contactez-nous." });

    const opt = optionsFor(await loadCfg(), o).find((x) => x.id === method);
    if (!opt) return send(res, 400, { error: "Ce moyen de paiement n’est pas disponible pour cette demande." });

    await sql`UPDATE payments SET status = 'cancelled', updated_at = now() WHERE order_id = ${id} AND status = 'pending'`;
    const base = { order_id: id, customer_id: c.id, amount: o.amount, currency: o.currency };

    if (opt.kind === "cash") {
      await sql`INSERT INTO payments (order_id, customer_id, method, provider, reference, amount, currency) VALUES (${id}, ${c.id}, 'cash', 'cash', ${newRef("cash", id)}, ${o.amount}, ${o.currency})`;
      await sql`UPDATE orders SET payment_method = 'cash', payment_status = 'cash_pending', updated_at = now() WHERE id = ${id}`;
      await logActivity(c.id, "pay_cash", o.property_id, o.property_title);
      await notifyAdmins("payment_cash", "Paiement en espèces annoncé", `${c.name} → ${o.property_title} (${o.amount} ${o.currency})`, c.id);
      return send(res, 200, { ok: true, done: "cash" });
    }

    if (opt.kind === "manual") {
      const txn = String(b.txnRef || "").trim().toUpperCase(), isBank = method === "bank_transfer";
      if (!/^[A-Z0-9._\-\/ ]{4,40}$/.test(txn)) return send(res, 400, { error: isBank ? "Indiquez la référence de votre virement." : "Indiquez l’identifiant de la transaction reçu par SMS (4 à 40 caractères)." });
      let phone = "", name = String(b.payerName || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 80);
      if (!isBank) { try { phone = normPhone(b.payerPhone); } catch (e) { return send(res, 400, { error: e.message }); } if (!phone) return send(res, 400, { error: "Indiquez le numéro avec lequel vous avez payé." }); }
      else if (!name) return send(res, 400, { error: "Indiquez le nom du titulaire du compte débité." });
      try {
        await sql`INSERT INTO payments (order_id, customer_id, method, provider, reference, provider_ref, amount, currency, status, payer_phone, payer_name)
          VALUES (${id}, ${c.id}, ${method}, 'manual', ${newRef("man", id)}, ${txn}, ${o.amount}, ${o.currency}, 'review', ${phone}, ${name})`;
      } catch (e) {
        if (String(e?.code) === "23505") return send(res, 409, { error: "Cette référence de transaction a déjà été utilisée. Vérifiez-la ou contactez l’agence." });
        throw e;
      }
      await sql`UPDATE orders SET payment_method = ${method}, payment_status = 'review', updated_at = now() WHERE id = ${id}`;
      await logActivity(c.id, "pay_manual", o.property_id, METHOD_LABEL[method]);
      await notifyAdmins("payment_review", "Paiement à vérifier", `${c.name} — ${o.amount} ${o.currency} par ${METHOD_LABEL[method]} (réf. ${txn})`, c.id);
      return send(res, 200, { ok: true, done: "review" });
    }

    // Paiement en ligne : Flutterwave (carte, Orange Money, MTN) ou PayPal
    const site = siteUrl(req);
    if (method === "paypal") {
      const ppAmt = paypalAmount(o.amount, o.currency);
      const ref = newRef("pp", id);
      const [p] = await sql`INSERT INTO payments (order_id, customer_id, method, provider, reference, amount, currency, charged_amount, charged_currency)
        VALUES (${id}, ${c.id}, 'paypal', 'paypal', ${ref}, ${o.amount}, ${o.currency}, ${ppAmt.value}, ${ppAmt.currency_code}) RETURNING id`;
      try {
        const r = await ppCreate({ reference: ref, amount: ppAmt, title: o.property_title, returnUrl: `${site}/api/pay?a=pp_return&ref=${ref}`, cancelUrl: `${site}/compte?paiement=annule` });
        await sql`UPDATE payments SET provider_ref = ${r.id} WHERE id = ${p.id}`;
        await sql`UPDATE orders SET payment_method = 'paypal', payment_status = 'pending', updated_at = now() WHERE id = ${id}`;
        await logActivity(c.id, "pay_online_start", o.property_id, "PayPal");
        return send(res, 200, { link: r.link });
      } catch {
        await markFailed(p.id, "PayPal indisponible");
        return send(res, 502, { error: "PayPal est indisponible pour le moment. Choisissez un autre moyen de paiement." });
      }
    }

    const ref = newRef("maison", id);
    const [p] = await sql`INSERT INTO payments (order_id, customer_id, method, provider, reference, amount, currency) VALUES (${id}, ${c.id}, ${method}, 'flutterwave', ${ref}, ${o.amount}, ${o.currency}) RETURNING id`;
    const r = await flw("/payments", { method: "POST", body: JSON.stringify({
      tx_ref: ref, amount: Number(o.amount), currency: o.currency, payment_options: FLW_OPTIONS[method],
      redirect_url: `${site}/api/pay?a=return`,
      customer: { email: c.email, name: c.name, phonenumber: c.phone || undefined },
      customizations: { title: "Location et vente immobilière", description: String(o.property_title).slice(0, 100) },
      meta: { order_id: id, method }
    }) });
    if (r.status !== "success" || !r.data?.link || !/^https:\/\/([a-z0-9-]+\.)*flutterwave\.com\//.test(r.data.link)) {
      await markFailed(p.id, "Fournisseur indisponible");
      return send(res, 502, { error: "Le service de paiement est indisponible en ce moment. Choisissez un autre moyen de paiement." });
    }
    await sql`UPDATE orders SET payment_method = ${method}, payment_status = 'pending', updated_at = now() WHERE id = ${id}`;
    await logActivity(c.id, "pay_online_start", o.property_id, METHOD_LABEL[method]);
    return send(res, 200, { link: r.data.link });
  }
  send(res, 404, { error: "Inconnu" });
}

export default wrap("pay", handler);
