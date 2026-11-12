import { sql, send, requireUser, audit, hashPassword, str, emailOk, ensureSchema, wrap } from "./_lib.js";

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
      const id = Number(req.query.id) || 0, b = req.body || {};
      const [c] = await sql`SELECT id, email FROM customers WHERE id = ${id}`;
      if (!c) return send(res, 404, { error: "Client introuvable." });
      if (typeof b.active === "boolean") {
        await sql`UPDATE customers SET active = ${b.active} WHERE id = ${id}`;
        if (!b.active) await sql`DELETE FROM customer_sessions WHERE customer_id = ${id}`;
        await audit(me.id, b.active ? "customer.enable" : "customer.disable", String(id));
      }
      if (typeof b.archived === "boolean") {
        if (!(await ensureSchema())) return send(res, 500, { error: "Archivage indisponible : exécutez migration-superadmin.sql dans Neon." });
        if (b.archived) {
          await sql`UPDATE customers SET archived_at = now(), active = false WHERE id = ${id}`;
          await sql`DELETE FROM customer_sessions WHERE customer_id = ${id}`;
        } else await sql`UPDATE customers SET archived_at = NULL, active = true WHERE id = ${id}`;
        await audit(me.id, b.archived ? "customer.archive" : "customer.restore", c.email);
      }
      if (b.disconnect === true) {
        await sql`DELETE FROM customer_sessions WHERE customer_id = ${id}`;
        await audit(me.id, "customer.disconnect", c.email);
      }
      if (typeof b.password === "string") {
        if (b.password.length < 8 || b.password.length > 200) return send(res, 400, { error: "Mot de passe d’au moins 8 caractères." });
        await sql`UPDATE customers SET password_hash = ${hashPassword(b.password)}, failed_logins = 0, locked_until = NULL WHERE id = ${id}`;
        await sql`DELETE FROM customer_sessions WHERE customer_id = ${id}`;
        await audit(me.id, "customer.password_reset", c.email);
      }
      if ("name" in b || "email" in b || "phone" in b) {
        const name = "name" in b ? str(b.name, 100) : null, email = "email" in b ? str(b.email, 254).toLowerCase() : null, phone = "phone" in b ? str(b.phone, 30) : null;
        if (name !== null && !name) return send(res, 400, { error: "Le nom est obligatoire." });
        if (email !== null && !emailOk(email)) return send(res, 400, { error: "E-mail invalide." });
        if (email !== null && (await sql`SELECT 1 FROM customers WHERE email = ${email} AND id <> ${id}`).length) return send(res, 409, { error: "Cet e-mail est déjà utilisé par un autre compte." });
        await sql`UPDATE customers SET name = COALESCE(${name}, name), email = COALESCE(${email}, email), phone = COALESCE(${phone}, phone) WHERE id = ${id}`;
        await audit(me.id, "customer.update", c.email);
      }
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      const id = Number(req.query.id) || 0;
      await ensureSchema();
      const [c] = await sql`SELECT id, email, archived_at FROM customers WHERE id = ${id}`;
      if (!c) return send(res, 404, { error: "Client introuvable." });
      if (!c.archived_at) return send(res, 409, { error: "Mettez d’abord le compte dans les archives, puis supprimez-le définitivement." });
      const [p] = await sql`SELECT count(*)::int AS n FROM orders WHERE customer_id = ${id} AND payment_status = 'paid'`;
      if (p.n) return send(res, 409, { error: "Ce client a des acomptes payés : désactivez son compte plutôt que de le supprimer (la comptabilité est conservée)." });
      try {
        await sql.transaction([
          sql`DELETE FROM customer_sessions WHERE customer_id = ${id}`,
          sql`DELETE FROM customer_notifications WHERE customer_id = ${id}`,
          sql`DELETE FROM activity WHERE customer_id = ${id}`,
          sql`DELETE FROM orders WHERE customer_id = ${id}`,
          sql`DELETE FROM suggestions WHERE customer_id = ${id}`,
          sql`DELETE FROM admin_notifications WHERE customer_id = ${id}`,
          sql`DELETE FROM customers WHERE id = ${id}`
        ]);
      } catch { return send(res, 409, { error: "Suppression impossible : des données liées existent encore. Désactivez le compte à la place." }); }
      await audit(me.id, "customer.delete", c.email);
      return send(res, 200, { ok: true });
    }
    await ensureSchema();
    const arch = req.query.archived === "1";
    return send(res, 200, await sql`SELECT c.id, c.name, c.email, c.phone, c.active, c.created_at, c.last_login, c.last_seen, c.archived_at,
      EXISTS (SELECT 1 FROM customer_sessions s WHERE s.customer_id = c.id AND s.expires_at > now()) AND c.last_seen > now() - interval '5 minutes' AS online,
      (SELECT count(*)::int FROM orders o WHERE o.customer_id = c.id) AS orders,
      (SELECT count(*)::int FROM activity x WHERE x.customer_id = c.id) AS actions
      FROM customers c WHERE (c.archived_at IS NOT NULL) = ${arch} ORDER BY c.created_at DESC LIMIT 500`);
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
