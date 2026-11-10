import { sql, send, throttle, requireUser, sameOrigin, audit, str, emailOk , wrap } from "./_lib.js";

async function handler(req, res) {
  if (req.method === "POST") {
    if (!sameOrigin(req)) return send(res, 403, { error: "Origine refusée" });
    if (!(await throttle(req, res, "msg", 6, 600))) return;
    const b = req.body || {};
    if (b.website) return send(res, 200, { ok: true }); // champ piège anti-robots
    const m = { name: str(b.name, 100), email: str(b.email, 254).toLowerCase(), phone: str(b.phone, 30), property: str(b.property, 80) || null, message: str(b.message, 3000) };
    if (!m.name || !emailOk(m.email) || !m.message) return send(res, 400, { error: "Champs invalides." });
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM messages WHERE email = ${m.email} AND created_at > now() - interval '10 minutes'`;
    if (n >= 3) return send(res, 429, { error: "Trop de messages, réessayez plus tard." });
    await sql`INSERT INTO messages (name,email,phone,property_id,message) VALUES (${m.name},${m.email},${m.phone},${m.property},${m.message})`;
    return send(res, 201, { ok: true });
  }
  const user = await requireUser(req, res);
  if (!user) return;
  if (req.method === "GET") return send(res, 200, await sql`SELECT * FROM messages ORDER BY created_at DESC LIMIT 300`);
  const id = Number(req.query.id) || 0;
  if (req.method === "PATCH") {
    await sql`UPDATE messages SET is_read = ${!!req.body?.read} WHERE id = ${id}`;
    return send(res, 200, { ok: true });
  }
  if (req.method === "DELETE") {
    await sql`DELETE FROM messages WHERE id = ${id}`;
    await audit(user.id, "message.delete", String(id));
    return send(res, 200, { ok: true });
  }
  send(res, 405, { error: "Méthode refusée" });
}

export default wrap("messages", handler);
