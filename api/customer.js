import { sql, send, throttle, hashPassword, verifyPassword, createCustomerSession, destroyCustomerSession, currentCustomer, requireCustomer, sameOrigin, logActivity, notifyAdmins, str, emailOk } from "./_lib.js";

const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

export default async function handler(req, res) {
  const a = req.query.a;

  if (a === "me") {
    const c = await currentCustomer(req);
    if (!c) return send(res, 401, { error: "Non connecté" });
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM customer_notifications WHERE customer_id = ${c.id} AND NOT is_read`;
    return send(res, 200, { customer: c, unread: n });
  }

  if (a === "notifications") {
    const c = await requireCustomer(req, res);
    if (!c) return;
    if (req.method === "POST") {
      await sql`UPDATE customer_notifications SET is_read = true WHERE customer_id = ${c.id}`;
      return send(res, 200, { ok: true });
    }
    return send(res, 200, await sql`SELECT id, text, is_read, created_at FROM customer_notifications WHERE customer_id = ${c.id} ORDER BY created_at DESC LIMIT 30`);
  }

  if (req.method !== "POST" || !sameOrigin(req)) return send(res, 405, { error: "Méthode refusée" });
  const b = req.body || {};

  if (a === "logout") { await destroyCustomerSession(req, res); return send(res, 200, { ok: true }); }

  if (a === "track") {
    const c = await currentCustomer(req);
    if (!c) return send(res, 200, { ok: true });
    const pid = str(b.propertyId, 80);
    const [p] = await sql`SELECT id, title FROM properties WHERE id = ${pid}`;
    if (!p) return send(res, 200, { ok: true });
    const recent = await sql`SELECT 1 FROM activity WHERE customer_id = ${c.id} AND property_id = ${pid} AND action = 'view_property' AND created_at > now() - interval '10 minutes'`;
    if (!recent.length) await logActivity(c.id, "view_property", pid, p.title);
    return send(res, 200, { ok: true });
  }

  if (a === "signup") {
    if (!(await throttle(req, res, "signup", 5, 3600))) return;
    const name = str(b.name, 100), email = str(b.email, 254).toLowerCase(), phone = str(b.phone, 30);
    const pw = typeof b.password === "string" ? b.password : "";
    if (!name || !emailOk(email)) return send(res, 400, { error: "Nom et e-mail valides requis." });
    if (pw.length < 8 || pw.length > 200) return send(res, 400, { error: "Le mot de passe doit contenir au moins 8 caractères." });
    if (b.consent !== true) return send(res, 400, { error: "Vous devez accepter que vos actions sur le site soient visibles par l’administrateur." });
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM customers WHERE created_at > now() - interval '1 hour'`;
    if (n >= 40) return send(res, 429, { error: "Trop d’inscriptions pour le moment, réessayez plus tard." });
    if ((await sql`SELECT 1 FROM customers WHERE email = ${email}`).length)
      return send(res, 409, { error: "Un compte existe déjà avec cet e-mail. Connectez-vous avec votre mot de passe.", exists: true });
    const [c] = await sql`INSERT INTO customers (name, email, phone, password_hash, last_login) VALUES (${name}, ${email}, ${phone}, ${hashPassword(pw)}, now()) RETURNING id, name, email, phone`;
    await createCustomerSession(res, c.id);
    await logActivity(c.id, "signup", null, email);
    await notifyAdmins("signup", "Nouveau compte client", `${name} (${email})`, c.id);
    return send(res, 201, { customer: c });
  }

  if (a === "login") {
    if (!(await throttle(req, res, "clogin", 10, 600))) return;
    const email = str(b.email, 254).toLowerCase();
    const pw = typeof b.password === "string" ? b.password.slice(0, 200) : "";
    const [u] = await sql`SELECT * FROM customers WHERE email = ${email}`;
    const locked = u?.locked_until && new Date(u.locked_until) > new Date();
    const ok = verifyPassword(pw, u ? u.password_hash : DUMMY) && u && u.active && !locked;
    if (!ok) {
      if (u && !locked) {
        await sql`UPDATE customers SET failed_logins = CASE WHEN failed_logins + 1 >= 5 THEN 0 ELSE failed_logins + 1 END,
          locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = ${u.id}`;
      }
      return send(res, locked ? 429 : 401, { error: locked ? "Trop de tentatives, réessayez dans 15 minutes." : "E-mail ou mot de passe incorrect." });
    }
    await sql`UPDATE customers SET failed_logins = 0, locked_until = NULL, last_login = now() WHERE id = ${u.id}`;
    await createCustomerSession(res, u.id);
    await logActivity(u.id, "login");
    return send(res, 200, { customer: { id: u.id, name: u.name, email: u.email, phone: u.phone } });
  }

  send(res, 404, { error: "Inconnu" });
}
