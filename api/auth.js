import { sql, send, throttle, verifyPassword, createSession, destroySession, currentUser, sameOrigin, audit, str, wrap } from "./_lib.js";

const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

async function handler(req, res) {
  const a = req.query.a;
  if (a === "me") {
    const u = await currentUser(req);
    return send(res, u ? 200 : 401, u ? { user: u } : { error: "Non connecté" });
  }
  if (req.method !== "POST" || !sameOrigin(req)) return send(res, 405, { error: "Méthode refusée" });
  if (a === "logout") { await destroySession(req, res); return send(res, 200, { ok: true }); }
  if (a !== "login") return send(res, 404, { error: "Inconnu" });

  if (!(await throttle(req, res, "alogin", 10, 600))) return;
  const email = str(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password.slice(0, 200) : "";
  const [user] = await sql`SELECT * FROM users WHERE email = ${email}`;
  const locked = user?.locked_until && new Date(user.locked_until) > new Date();
  const ok = verifyPassword(password, user ? user.password_hash : DUMMY) && user && user.active && !locked;
  if (!ok) {
    if (user && !locked) {
      await sql`UPDATE users SET failed_logins = failed_logins + 1,
        locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END,
        failed_logins = CASE WHEN failed_logins + 1 >= 5 THEN 0 ELSE failed_logins + 1 END WHERE id = ${user.id}`;
    }
    return send(res, locked ? 429 : 401, { error: locked ? "Trop de tentatives, réessayez dans 15 minutes." : "Identifiants incorrects." });
  }
  await sql`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ${user.id}`;
  await createSession(res, user.id);
  await audit(user.id, "login");
  send(res, 200, { user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}

export default wrap("auth", handler);
