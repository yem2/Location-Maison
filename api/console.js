import { sql, send, requireUser, audit, wrap } from "./_lib.js";

async function handler(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  const a = req.query.a;
  const isSuper = me.role === "super_admin";

  if (a === "counts") {
    const [n] = await sql`SELECT count(*)::int AS n FROM admin_notifications WHERE NOT is_read`;
    const [o] = await sql`SELECT count(*)::int AS n FROM orders WHERE status = 'pending'`;
    return send(res, 200, { notifications: n.n, pendingOrders: o.n });
  }
  if (a === "notifications") {
    if (req.method === "POST") { await sql`UPDATE admin_notifications SET is_read = true`; return send(res, 200, { ok: true }); }
    return send(res, 200, await sql`SELECT id, type, title, detail, is_read, created_at FROM admin_notifications ORDER BY created_at DESC LIMIT 100`);
  }

  // Les deux rubriques suivantes sont réservées au super administrateur
  if (!isSuper) return send(res, 403, { error: "Réservé au super administrateur" });

  if (a === "customers") {
    if (req.method === "PATCH") {
      const id = Number(req.query.id) || 0;
      const active = req.body?.active === true;
      await sql`UPDATE customers SET active = ${active} WHERE id = ${id}`;
      if (!active) await sql`DELETE FROM customer_sessions WHERE customer_id = ${id}`;
      await audit(me.id, active ? "customer.enable" : "customer.disable", String(id));
      return send(res, 200, { ok: true });
    }
    return send(res, 200, await sql`SELECT c.id, c.name, c.email, c.phone, c.active, c.created_at, c.last_login,
      (SELECT count(*)::int FROM orders o WHERE o.customer_id = c.id) AS orders,
      (SELECT count(*)::int FROM activity x WHERE x.customer_id = c.id) AS actions
      FROM customers c ORDER BY c.created_at DESC LIMIT 500`);
  }
  if (a === "activity") {
    const cid = Number(req.query.customer) || 0;
    const rows = cid
      ? await sql`SELECT x.id, x.action, x.property_id, x.detail, x.created_at, c.id AS customer_id, c.name, c.email FROM activity x JOIN customers c ON c.id = x.customer_id WHERE x.customer_id = ${cid} ORDER BY x.created_at DESC LIMIT 300`
      : await sql`SELECT x.id, x.action, x.property_id, x.detail, x.created_at, c.id AS customer_id, c.name, c.email FROM activity x JOIN customers c ON c.id = x.customer_id ORDER BY x.created_at DESC LIMIT 300`;
    return send(res, 200, rows);
  }
  send(res, 404, { error: "Inconnu" });
}

export default wrap("console", handler);
