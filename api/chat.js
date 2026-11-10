import { sql, send, throttle, requireCustomer, requireUser, notifyAdmins, notifyCustomer, str , wrap } from "./_lib.js";

const snippet = (s) => String(s).replace(/\s+/g, " ").slice(0, 90);

async function supportThread(customerId) {
  await sql`INSERT INTO chat_threads (kind, customer_a) VALUES ('support', ${customerId}) ON CONFLICT (kind, customer_a, (COALESCE(customer_b, 0))) DO NOTHING`;
  const [t] = await sql`SELECT * FROM chat_threads WHERE kind = 'support' AND customer_a = ${customerId}`;
  return t;
}

async function handler(req, res) {
  const a = req.query.a;

  // ================= Espace administrateur =================
  if (a && a.startsWith("admin_")) {
    const me = await requireUser(req, res);
    if (!me) return;
    const sup = me.role === "super_admin";
    if (a === "admin_threads") {
      return send(res, 200, await sql`SELECT t.id, t.kind, t.last_message_at, ca.name AS a_name, ca.email AS a_email, cb.name AS b_name,
        (SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
        (SELECT count(*)::int FROM chat_messages m WHERE m.thread_id = t.id AND m.sender_type = 'customer' AND m.id > t.admin_read_id AND t.kind = 'support') AS unread
        FROM chat_threads t JOIN customers ca ON ca.id = t.customer_a LEFT JOIN customers cb ON cb.id = t.customer_b
        WHERE (t.kind = 'support' OR ${sup}) AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.thread_id = t.id)
        ORDER BY t.last_message_at DESC LIMIT 200`);
    }
    const tid = Number(req.query.thread || req.body?.thread) || 0;
    const [t] = await sql`SELECT * FROM chat_threads WHERE id = ${tid}`;
    if (!t || (t.kind === "direct" && !sup)) return send(res, 404, { error: "Conversation introuvable" });
    if (a === "admin_messages") {
      const rows = await sql`SELECT m.id, m.sender_type, m.body, m.created_at, c.name AS cname, u.name AS aname FROM chat_messages m
        LEFT JOIN customers c ON c.id = m.sender_customer_id LEFT JOIN users u ON u.id = m.sender_admin_id WHERE m.thread_id = ${tid} ORDER BY m.id LIMIT 500`;
      if (t.kind === "support" && rows.length) await sql`UPDATE chat_threads SET admin_read_id = GREATEST(admin_read_id, ${rows[rows.length - 1].id}) WHERE id = ${tid}`;
      return send(res, 200, rows.map((m) => ({ id: m.id, mine: m.sender_type === "admin", who: m.sender_type === "admin" ? (m.aname || "Support") : m.cname || "Client", body: m.body, created_at: m.created_at })));
    }
    if (a === "admin_send" && req.method === "POST") {
      if (t.kind !== "support") return send(res, 403, { error: "Les conversations privées entre clients sont en lecture seule." });
      const body = str(req.body?.body, 2000);
      if (!body) return send(res, 400, { error: "Message vide." });
      await sql`INSERT INTO chat_messages (thread_id, sender_type, sender_admin_id, body) VALUES (${tid}, 'admin', ${me.id}, ${body})`;
      await sql`UPDATE chat_threads SET last_message_at = now(), admin_read_id = (SELECT max(id) FROM chat_messages WHERE thread_id = ${tid}) WHERE id = ${tid}`;
      await notifyCustomer(t.customer_a, `Réponse du support : ${snippet(body)}`);
      return send(res, 201, { ok: true });
    }
    return send(res, 404, { error: "Inconnu" });
  }

  // ================= Espace client =================
  const c = await requireCustomer(req, res);
  if (!c) return;

  if (a === "threads") {
    await supportThread(c.id);
    return send(res, 200, await sql`SELECT t.id, t.kind, t.last_message_at,
      CASE WHEN t.kind = 'support' THEN 'Support Maison' ELSE o.name END AS title,
      (SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
      (SELECT count(*)::int FROM chat_messages m WHERE m.thread_id = t.id AND NOT (m.sender_type = 'customer' AND m.sender_customer_id = ${c.id})
        AND m.id > CASE WHEN t.customer_a = ${c.id} THEN t.a_read_id ELSE t.b_read_id END) AS unread
      FROM chat_threads t LEFT JOIN customers o ON o.id = CASE WHEN t.customer_a = ${c.id} THEN t.customer_b ELSE t.customer_a END
      WHERE t.customer_a = ${c.id} OR t.customer_b = ${c.id} ORDER BY (t.kind = 'support') DESC, t.last_message_at DESC LIMIT 100`);
  }

  if (a === "start" && req.method === "POST") {
    if (!(await throttle(req, res, "chatstart", 10, 3600))) return;
    const email = str(req.body?.email, 254).toLowerCase();
    const [o] = await sql`SELECT id, name FROM customers WHERE email = ${email} AND active`;
    if (!o || o.id === c.id) return send(res, 404, { error: "Aucun autre client avec cet e-mail." });
    const [x, y] = c.id < o.id ? [c.id, o.id] : [o.id, c.id];
    await sql`INSERT INTO chat_threads (kind, customer_a, customer_b) VALUES ('direct', ${x}, ${y}) ON CONFLICT (kind, customer_a, (COALESCE(customer_b, 0))) DO NOTHING`;
    const [t] = await sql`SELECT id FROM chat_threads WHERE kind = 'direct' AND customer_a = ${x} AND customer_b = ${y}`;
    return send(res, 200, { id: t.id, title: o.name });
  }

  const tid = Number(req.query.thread || req.body?.thread) || 0;
  const [t] = await sql`SELECT * FROM chat_threads WHERE id = ${tid} AND (customer_a = ${c.id} OR customer_b = ${c.id})`;
  if (!t) return send(res, 404, { error: "Conversation introuvable" });
  const mineCol = t.customer_a === c.id;

  if (a === "messages") {
    const after = Number(req.query.after) || 0;
    const rows = await sql`SELECT m.id, m.sender_type, m.sender_customer_id, m.body, m.created_at, cu.name AS cname, u.name AS aname FROM chat_messages m
      LEFT JOIN customers cu ON cu.id = m.sender_customer_id LEFT JOIN users u ON u.id = m.sender_admin_id WHERE m.thread_id = ${tid} AND m.id > ${after} ORDER BY m.id LIMIT 200`;
    if (rows.length) {
      const last = rows[rows.length - 1].id;
      if (mineCol) await sql`UPDATE chat_threads SET a_read_id = GREATEST(a_read_id, ${last}) WHERE id = ${tid}`;
      else await sql`UPDATE chat_threads SET b_read_id = GREATEST(b_read_id, ${last}) WHERE id = ${tid}`;
    }
    return send(res, 200, rows.map((m) => ({ id: m.id, mine: m.sender_type === "customer" && m.sender_customer_id === c.id,
      who: m.sender_type === "admin" ? "Support Maison" : m.cname || "Client", body: m.body, created_at: m.created_at })));
  }

  if (a === "send" && req.method === "POST") {
    if (!(await throttle(req, res, "chat", 40, 60))) return;
    const body = str(req.body?.body, 2000);
    if (!body) return send(res, 400, { error: "Message vide." });
    // Notifier seulement si le destinataire n'a pas déjà des messages non lus (évite le spam)
    let notify;
    if (t.kind === "support") {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM chat_messages WHERE thread_id = ${tid} AND sender_type = 'customer' AND id > ${t.admin_read_id}`;
      notify = n === 0 ? () => notifyAdmins("chat", "Nouveau message d’un client", `${c.name} : ${snippet(body)}`, c.id) : null;
    } else {
      const other = mineCol ? t.customer_b : t.customer_a, otherRead = mineCol ? t.b_read_id : t.a_read_id;
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM chat_messages WHERE thread_id = ${tid} AND sender_customer_id = ${c.id} AND id > ${otherRead}`;
      notify = n === 0 ? () => notifyCustomer(other, `Nouveau message de ${c.name} : ${snippet(body)}`) : null;
    }
    await sql`INSERT INTO chat_messages (thread_id, sender_type, sender_customer_id, body) VALUES (${tid}, 'customer', ${c.id}, ${body})`;
    await sql`UPDATE chat_threads SET last_message_at = now() WHERE id = ${tid}`;
    if (notify) await notify();
    return send(res, 201, { ok: true });
  }
  send(res, 404, { error: "Inconnu" });
}

export default wrap("chat", handler);
