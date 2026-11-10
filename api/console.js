import { sql, send, requireUser, audit , wrap } from "./_lib.js";

async function handler(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  const a = req.query.a;
  const isSuper = me.role === "super_admin";

  if (a === "counts") {
    const [n] = await sql`SELECT count(*)::int AS n FROM admin_notifications WHERE NOT is_read`;
    const [o] = await sql`SELECT count(*)::int AS n FROM orders WHERE status = 'pending'`;
    const [ch] = await sql`SELECT count(DISTINCT m.thread_id)::int AS n FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id WHERE t.kind = 'support' AND m.sender_type = 'customer' AND m.id > t.admin_read_id`;
    const [sg] = await sql`SELECT count(*)::int AS n FROM suggestions WHERE NOT is_read`;
    return send(res, 200, { notifications: n.n, pendingOrders: o.n, chat: ch.n, suggestions: sg.n });
  }
  if (a === "stats") {
    const [p] = await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE availability = 'available')::int AS available, count(*) FILTER (WHERE availability = 'reserved')::int AS reserved, count(*) FILTER (WHERE availability = 'unavailable')::int AS unavailable FROM properties`;
    const [c] = await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week FROM customers`;
    const [o] = await sql`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed, count(*) FILTER (WHERE status = 'rejected')::int AS rejected, count(*) FILTER (WHERE payment_status = 'cash_pending')::int AS cash_pending FROM orders`;
    const [m] = await sql`SELECT count(*) FILTER (WHERE NOT is_read)::int AS unread FROM messages`;
    const revenue = await sql`SELECT currency, sum(amount)::float AS total FROM orders WHERE payment_status = 'paid' GROUP BY currency ORDER BY total DESC`;
    const days = await sql`SELECT to_char(d, 'DD/MM') AS day,
      (SELECT count(*)::int FROM activity a WHERE a.created_at::date = d::date) AS actions,
      (SELECT count(*)::int FROM orders x WHERE x.created_at::date = d::date) AS orders
      FROM generate_series(current_date - 13, current_date, interval '1 day') AS d ORDER BY d`;
    const recent = await sql`SELECT type, title, detail, created_at FROM admin_notifications ORDER BY created_at DESC LIMIT 6`;
    return send(res, 200, { properties: p, customers: c, orders: o, messagesUnread: m.unread, revenue, days, recent });
  }
  if (a === "suggestions") {
    if (req.method === "PATCH") { await sql`UPDATE suggestions SET is_read = ${req.body?.read !== false} WHERE id = ${Number(req.query.id) || 0}`; return send(res, 200, { ok: true }); }
    return send(res, 200, await sql`SELECT s.id, s.name, s.message, s.is_read, s.created_at, c.email FROM suggestions s LEFT JOIN customers c ON c.id = s.customer_id ORDER BY s.created_at DESC LIMIT 300`);
  }
  if (a === "audit") {
    if (!isSuper) return send(res, 403, { error: "Réservé au super administrateur" });
    return send(res, 200, await sql`SELECT l.id, l.action, l.detail, l.created_at, u.email FROM audit_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 300`);
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
