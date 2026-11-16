import { sql, send, requireUser, audit, hashPassword, str, emailOk, wrap, archiveSnapshot, ensureArchives, decrypt, notifyAdmins } from "./_lib.js";
import { waHandler } from "./_whatsapp.js";

async function handler(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  const a = req.query.a;
  if (typeof a === "string" && a.startsWith("wa_")) return waHandler(req, res, me);
  const isSuper = me.role === "super_admin";

  // ----- Archives (super administrateur) : lister, restaurer, supprimer définitivement -----
  if (a === "archives" || a === "restore" || a === "purge") {
    if (me.role !== "super_admin") return send(res, 403, { error: "Réservé au super administrateur" });
    await ensureArchives();
    if (a === "archives" && req.method === "GET") {
      const items = await sql`SELECT a.id, a.kind, a.ref_id, a.label, a.deleted_at, u.name AS by_name FROM archives a LEFT JOIN users u ON u.id = a.deleted_by WHERE a.restored_at IS NULL ORDER BY a.deleted_at DESC LIMIT 300`;
      const props = await sql`SELECT id, title, archived_at FROM properties WHERE archived = true ORDER BY archived_at DESC NULLS LAST LIMIT 300`;
      return send(res, 200, { items, properties: props });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Méthode refusée" });
    const kind = str(req.body?.kind, 20), refId = str(req.body?.id, 80);
    if (kind === "property") {
      if (a === "restore") { await sql`UPDATE properties SET archived = false, archived_at = NULL, published = true, updated_at = now() WHERE id = ${refId}`; await audit(me.id, "property.restore", refId); return send(res, 200, { ok: true }); }
      const [pp] = await sql`DELETE FROM properties WHERE id = ${refId} AND archived = true RETURNING title`;
      if (!pp) return send(res, 404, { error: "Annonce archivée introuvable." });
      await audit(me.id, "property.purge", refId); return send(res, 200, { ok: true });
    }
    const [row] = await sql`SELECT * FROM archives WHERE id = ${Number(refId) || 0} AND restored_at IS NULL`;
    if (!row) return send(res, 404, { error: "Élément introuvable ou déjà restauré." });
    if (a === "purge") { await sql`DELETE FROM archives WHERE id = ${row.id}`; await audit(me.id, "archive.purge", row.kind + " " + row.label); return send(res, 200, { ok: true }); }
    let d; try { d = JSON.parse(decrypt(row.data)); } catch { return send(res, 500, { error: "Archive illisible." }); }
    try {
      if (row.kind === "message") await sql`INSERT INTO messages SELECT * FROM jsonb_populate_record(NULL::messages, ${JSON.stringify(d)}::jsonb) ON CONFLICT DO NOTHING`;
      else if (row.kind === "admin") await sql`INSERT INTO users SELECT * FROM jsonb_populate_record(NULL::users, ${JSON.stringify(d)}::jsonb)`;
      else if (row.kind === "order") {
        await sql`INSERT INTO orders SELECT * FROM jsonb_populate_record(NULL::orders, ${JSON.stringify(d)}::jsonb) ON CONFLICT DO NOTHING`;
        if (d.status === "confirmed" && d.property_id) {
          const [k] = await sql`SELECT count(*)::int AS n FROM orders WHERE property_id = ${d.property_id} AND status = 'confirmed' AND id <> ${d.id}`;
          if (k.n) await sql`UPDATE orders SET status = 'cancelled' WHERE id = ${d.id}`; else await sql`UPDATE properties SET availability = 'reserved', updated_at = now() WHERE id = ${d.property_id} AND availability = 'available'`;
        }
      } else if (row.kind === "customer") {
        await sql`INSERT INTO customers SELECT * FROM jsonb_populate_record(NULL::customers, ${JSON.stringify(d.customer)}::jsonb)`;
        await sql`INSERT INTO orders SELECT * FROM jsonb_populate_recordset(NULL::orders, ${JSON.stringify(d.orders || [])}::jsonb) ON CONFLICT DO NOTHING`;
        await sql`INSERT INTO suggestions SELECT * FROM jsonb_populate_recordset(NULL::suggestions, ${JSON.stringify(d.suggestions || [])}::jsonb) ON CONFLICT DO NOTHING`;
      } else return send(res, 400, { error: "Type d’archive inconnu." });
    } catch (e) {
      return send(res, 409, { error: /duplicate|unique/i.test(String(e?.message)) ? "Restauration impossible : un élément identique (même e-mail ou identifiant) existe déjà." : "Restauration impossible : " + String(e?.message || "erreur").slice(0, 120) });
    }
    await sql`UPDATE archives SET restored_at = now() WHERE id = ${row.id}`;
    await audit(me.id, "archive.restore", row.kind + " " + row.label);
    return send(res, 200, { ok: true });
  }

  if (a === "counts") {
    const safe = (p) => p.then((r) => r[0].n).catch(() => 0);
    const [notifications, pendingOrders, chat, suggestions, paymentsReview] = await Promise.all([
      safe(sql`SELECT count(*)::int AS n FROM admin_notifications WHERE NOT is_read`),
      safe(sql`SELECT count(*)::int AS n FROM orders WHERE status = 'pending'`),
      safe(sql`SELECT count(DISTINCT m.thread_id)::int AS n FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id WHERE t.kind = 'support' AND m.sender_type = 'customer' AND m.id > t.admin_read_id`),
      safe(sql`SELECT count(*)::int AS n FROM suggestions WHERE NOT is_read`),
      safe(sql`SELECT count(*)::int AS n FROM payments WHERE status = 'review' OR (status = 'pending' AND method = 'cash')`)
    ]);
    return send(res, 200, { notifications, pendingOrders, chat, suggestions, paymentsReview });
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
      const [c] = await sql`SELECT id, email FROM customers WHERE id = ${id}`;
      if (!c) return send(res, 404, { error: "Client introuvable." });
      const [p] = await sql`SELECT count(*)::int AS n FROM orders WHERE customer_id = ${id} AND payment_status = 'paid'`;
      if (p.n) return send(res, 409, { error: "Ce client a des acomptes payés : désactivez son compte plutôt que de le supprimer (la comptabilité est conservée)." });
      const [cu] = await sql`SELECT to_jsonb(c) AS j FROM customers c WHERE id = ${id}`;
      const [ords] = await sql`SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb) AS j FROM orders o WHERE customer_id = ${id}`;
      const [sugs] = await sql`SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) AS j FROM suggestions s WHERE customer_id = ${id}`;
      if (cu) await archiveSnapshot("customer", id, c.email, { customer: cu.j, orders: ords.j, suggestions: sugs.j }, me.id);
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
    return send(res, 200, await sql`SELECT c.id, c.name, c.email, c.phone, c.active, c.created_at, c.last_login, c.last_seen,
      EXISTS (SELECT 1 FROM customer_sessions s WHERE s.customer_id = c.id AND s.expires_at > now()) AND c.last_seen > now() - interval '5 minutes' AS online,
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
