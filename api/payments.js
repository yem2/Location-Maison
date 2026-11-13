// Module Paiements de l'administration : suivi des transactions, vérification des paiements manuels,
// et réglage des numéros / comptes (super administrateur uniquement, avec confirmation du mot de passe).
import { sql, send, requireUser, throttle, audit, verifyPassword, verifyTotp, decrypt, clientIp, notifyAdmins, notifyCustomer, wrap } from "./_lib.js";
import { docsHandler, DOC_ACTIONS } from "./_docs.js";
import { METHOD_LABEL, METHODS, ensurePayments, loadCfg, saveCfg, sanitizeCfg, flwReady, ppReady, markPaid, markFailed, csvCell } from "./_pay.js";

const STATUSES = ["pending", "review", "paid", "failed", "cancelled"];
const isSuper = (u) => u.role === "super_admin";

async function stepUp(u, body) {
  const [row] = await sql`SELECT password_hash, totp_enabled, totp_secret FROM users WHERE id = ${u.id}`;
  if (!row || !verifyPassword(String(body.password || ""), row.password_hash)) return "Mot de passe incorrect.";
  if (row.totp_enabled && !verifyTotp(decrypt(row.totp_secret), body.code)) return "Code de double authentification incorrect.";
  return "";
}

function changedFields(oldCfg, newCfg) {
  const out = [];
  for (const m of METHODS) for (const k of Object.keys(newCfg[m])) if (JSON.stringify(oldCfg[m]?.[k]) !== JSON.stringify(newCfg[m][k])) out.push(`${METHOD_LABEL[m]} › ${k}`);
  return out;
}

async function handler(req, res) {
  if (DOC_ACTIONS.has(req.query.a)) { await ensurePayments(); return docsHandler(req, res); }
  const u = await requireUser(req, res);
  if (!u) return;
  if (!(await ensurePayments())) return send(res, 500, { error: "Tables de paiement indisponibles : exécutez migration-paiements.sql dans Neon." });
  const a = req.query.a;

  if (a === "list" && req.method === "GET") {
    const status = STATUSES.includes(req.query.status) ? req.query.status : "", method = METHODS.includes(req.query.method) ? req.query.method : "";
    const rows = await sql`SELECT p.id, p.order_id, p.method, p.provider, p.reference, p.provider_ref, p.amount, p.currency, p.charged_amount, p.charged_currency, p.status,
        p.payer_phone, p.payer_name, p.note, p.created_at, p.confirmed_at, o.property_title, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, cu.name AS confirmed_by_name
      FROM payments p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN users cu ON cu.id = p.confirmed_by
      WHERE (${status} = '' OR p.status = ${status}) AND (${method} = '' OR p.method = ${method})
      ORDER BY (p.status = 'review') DESC, p.created_at DESC LIMIT 300`;
    const totals = await sql`SELECT currency, COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::float AS paid,
        COALESCE(sum(amount) FILTER (WHERE status = 'paid' AND confirmed_at > now() - interval '30 days'), 0)::float AS paid30,
        count(*) FILTER (WHERE status = 'review')::int AS review, count(*) FILTER (WHERE status = 'pending')::int AS pending FROM payments GROUP BY currency`;
    return send(res, 200, { rows, totals });
  }

  if (a === "settings") {
    if (!isSuper(u)) return send(res, 403, { error: "Réservé au super administrateur" });
    if (req.method === "GET") {
      const [meta] = await sql`SELECT s.updated_at, u.name AS by_name FROM payment_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.key = 'config'`;
      const log = await sql`SELECT l.at, l.changed, l.ip, u.name FROM payment_settings_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 15`;
      return send(res, 200, {
        cfg: await loadCfg(true), meta: meta || null, log,
        env: { flutterwave: flwReady(), flutterwaveWebhook: !!process.env.FLW_WEBHOOK_HASH, paypal: ppReady(), paypalWebhook: !!process.env.PAYPAL_WEBHOOK_ID, paypalSandbox: process.env.PAYPAL_ENV === "sandbox", siteUrl: !!process.env.SITE_URL, secret: !!process.env.APP_SECRET }
      });
    }
    if (req.method === "POST") {
      if (!(await throttle(req, res, "paycfg", 6, 900))) return;
      const b = req.body || {};
      const bad = await stepUp(u, b);
      if (bad) { await audit(u.id, "payment.settings_denied", "confirmation refusée"); return send(res, 403, { error: bad }); }
      let cfg;
      try { cfg = sanitizeCfg(b.cfg); } catch (e) { return send(res, 400, { error: e.message }); }
      const old = await loadCfg(true), changed = changedFields(old, cfg);
      if (!changed.length) return send(res, 200, { ok: true, changed: [] });
      await saveCfg(cfg, u.id);
      await sql`INSERT INTO payment_settings_log (user_id, changed, ip) VALUES (${u.id}, ${changed.join(" ; ").slice(0, 900)}, ${clientIp(req)})`;
      await audit(u.id, "payment.settings", changed.join(" ; "));
      await notifyAdmins("payment_settings", "Moyens de paiement modifiés", `${u.name || u.email} : ${changed.join(", ").slice(0, 300)}`);
      return send(res, 200, { ok: true, changed });
    }
  }

  if (a === "export" && req.method === "GET") {
    if (!isSuper(u)) return send(res, 403, { error: "Réservé au super administrateur" });
    const rows = await sql`SELECT p.id, p.created_at, p.order_id, o.property_title, c.name AS customer, c.email, p.method, p.status, p.amount, p.currency, p.provider_ref, p.reference, p.payer_phone, p.payer_name, p.confirmed_at
      FROM payments p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN customers c ON c.id = p.customer_id ORDER BY p.id DESC LIMIT 5000`;
    const head = ["id", "date", "demande", "bien", "client", "e-mail", "moyen", "statut", "montant", "devise", "réf. transaction", "réf. interne", "téléphone payeur", "nom payeur", "confirmé le"];
    const lines = [head.join(";"), ...rows.map((r) => [r.id, r.created_at && new Date(r.created_at).toISOString(), r.order_id, r.property_title, r.customer, r.email, METHOD_LABEL[r.method] || r.method, r.status, r.amount, r.currency, r.provider_ref, r.reference, r.payer_phone, r.payer_name, r.confirmed_at && new Date(r.confirmed_at).toISOString()].map(csvCell).join(";"))];
    await audit(u.id, "payment.export", String(rows.length));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="paiements.csv"');
    return res.status(200).send("\ufeff" + lines.join("\r\n"));
  }

  // Confirmer / refuser un paiement. Espèces : tout administrateur. Autres moyens : super administrateur.
  if ((a === "confirm" || a === "reject") && req.method === "POST") {
    const id = Number(req.body?.id) || 0;
    const [p] = await sql`SELECT id, method, status, order_id, customer_id FROM payments WHERE id = ${id}`;
    if (!p) return send(res, 404, { error: "Paiement introuvable." });
    if (p.method !== "cash" && !isSuper(u)) return send(res, 403, { error: "Seul le super administrateur peut valider ce type de paiement." });
    if (!["pending", "review"].includes(p.status)) return send(res, 409, { error: "Ce paiement est déjà traité." });
    if (a === "confirm") {
      if (!(await markPaid(id, { by: u.id }))) return send(res, 409, { error: "Un autre paiement est déjà enregistré pour cette demande." });
      await audit(u.id, "payment.confirm", `${id} (${p.method})`);
    } else {
      const reason = String(req.body?.reason || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 200);
      await markFailed(id, reason, { notify: true });
      await audit(u.id, "payment.reject", `${id} (${p.method}) ${reason}`);
    }
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: "Inconnu" });
}

export default wrap("payments", handler);
