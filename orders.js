import { sql, send, throttle, requireUser, requireCustomer, audit, logActivity, notifyAdmins, notifyCustomer, str , wrap } from "./_lib.js";

async function handler(req, res) {
  // ----- Espace administrateur -----
  if (req.query.admin === "1") {
    const u = await requireUser(req, res);
    if (!u) return;
    if (req.method === "GET") {
      return send(res, 200, await sql`SELECT o.id, o.status, o.message, o.property_id, o.property_title, o.created_at, o.updated_at, o.amount, o.currency, o.payment_status, o.payment_method,
        c.id AS customer_id, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
        FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY (o.status = 'pending') DESC, o.created_at DESC LIMIT 300`);
    }
    if (req.method === "PATCH") {
      const id = Number(req.body?.id) || 0, status = req.body?.status;
      if (!["pending", "confirmed", "rejected"].includes(status)) return send(res, 400, { error: "Statut invalide" });
      const [o] = await sql`UPDATE orders SET status = ${status}, updated_at = now() WHERE id = ${id} RETURNING *`;
      if (!o) return send(res, 404, { error: "Introuvable" });
      if (status === "confirmed") {
        let due = "";
        if (o.property_id) {
          const [pp] = await sql`SELECT deposit, currency FROM properties WHERE id = ${o.property_id}`;
          if (pp && Number(pp.deposit) > 0) {
            await sql`UPDATE orders SET amount = ${pp.deposit}, currency = ${pp.currency}, payment_status = 'none' WHERE id = ${o.id}`;
            due = ` Un acompte de ${pp.deposit} ${pp.currency} est à régler depuis « Mon compte ».`;
          }
        }
        await notifyCustomer(o.customer_id, `Bonne nouvelle : votre demande pour « ${o.property_title} » a été acceptée.${due}`);
        if (o.property_id) {
          await sql`UPDATE properties SET availability = 'reserved', updated_at = now() WHERE id = ${o.property_id}`;
          const others = await sql`SELECT DISTINCT customer_id FROM orders WHERE property_id = ${o.property_id} AND status = 'pending' AND id <> ${o.id}`;
          for (const r of others) await notifyCustomer(r.customer_id, `Le bien « ${o.property_title} » n’est plus disponible.`);
        }
      } else if (status === "rejected") {
        await notifyCustomer(o.customer_id, `Votre demande pour « ${o.property_title} » n’a pas pu être acceptée.`);
      }
      await audit(u.id, "order." + status, String(id));
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      if (u.role !== "super_admin") return send(res, 403, { error: "Réservé au super administrateur" });
      const id = Number(req.query.id) || 0;
      const [x] = await sql`SELECT id, property_id, status, payment_status FROM orders WHERE id = ${id}`;
      if (!x) return send(res, 404, { error: "Demande introuvable." });
      if (x.payment_status === "paid") return send(res, 409, { error: "Cette demande a un acompte payé : elle est conservée pour la comptabilité." });
      try { await sql`DELETE FROM orders WHERE id = ${id}`; }
      catch { return send(res, 409, { error: "Suppression impossible : des données liées existent encore." }); }
      if (x.status === "confirmed" && x.property_id) {
        const [k] = await sql`SELECT count(*)::int AS n FROM orders WHERE property_id = ${x.property_id} AND status = 'confirmed'`;
        if (!k.n) await sql`UPDATE properties SET availability = 'available', updated_at = now() WHERE id = ${x.property_id} AND availability = 'reserved'`;
      }
      await audit(u.id, "order.delete", String(id));
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: "Méthode refusée" });
  }

  // ----- Espace client -----
  const c = await requireCustomer(req, res);
  if (!c) return;

  if (req.method === "GET") {
    return send(res, 200, await sql`SELECT id, status, property_id, property_title, message, created_at, amount, currency, payment_status, payment_method FROM orders WHERE customer_id = ${c.id} ORDER BY created_at DESC LIMIT 50`);
  }

  if (req.method === "POST") {
    if (!(await throttle(req, res, "order", 10, 600))) return;
    const pid = str(req.body?.propertyId, 80), message = str(req.body?.message, 1000);
    const [p] = await sql`SELECT id, title, availability, published FROM properties WHERE id = ${pid}`;
    if (!p || !p.published) return send(res, 404, { error: "Bien introuvable." });
    if (p.availability !== "available") {
      await logActivity(c.id, "order_blocked", p.id, p.title);
      return send(res, 409, { error: `Désolé, « ${p.title} » n’est plus disponible.`, availability: p.availability });
    }
    const rows = await sql`INSERT INTO orders (customer_id, property_id, property_title, message) VALUES (${c.id}, ${p.id}, ${p.title}, ${message})
      ON CONFLICT (customer_id, property_id) WHERE status = 'pending' DO NOTHING RETURNING id`;
    if (!rows.length) return send(res, 409, { error: "Vous avez déjà une demande en cours pour ce bien." });
    await logActivity(c.id, "order", p.id, p.title);
    await notifyAdmins("order", "Nouvelle demande de réservation", `${c.name} → ${p.title}`, c.id);
    return send(res, 201, { ok: true });
  }

  if (req.method === "DELETE") {
    const id = Number(req.query.id) || 0;
    const rows = await sql`UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = ${id} AND customer_id = ${c.id} AND status = 'pending' RETURNING property_id, property_title`;
    if (!rows.length) return send(res, 404, { error: "Demande introuvable ou déjà traitée." });
    await logActivity(c.id, "order_cancel", rows[0].property_id, rows[0].property_title);
    await notifyAdmins("order_cancel", "Demande annulée", `${c.name} → ${rows[0].property_title}`, c.id);
    return send(res, 200, { ok: true });
  }
  send(res, 405, { error: "Méthode refusée" });
}

export default wrap("orders", handler);
