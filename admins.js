import { sql, send, requireUser, hashPassword, audit, str, emailOk , wrap } from "./_lib.js";

const pwOk = (p) => typeof p === "string" && p.length >= 10 && p.length <= 200;

async function handler(req, res) {
  const me = await requireUser(req, res, "super_admin");
  if (!me) return;
  if (req.method === "GET") {
    return send(res, 200, await sql`SELECT id,email,name,role,active,created_at FROM users ORDER BY role DESC, created_at`);
  }
  const b = req.body || {};
  if (req.method === "POST") {
    const email = str(b.email, 254).toLowerCase();
    if (!emailOk(email) || !pwOk(b.password)) return send(res, 400, { error: "E-mail valide et mot de passe d'au moins 10 caractères requis." });
    if ((await sql`SELECT 1 FROM users WHERE email = ${email}`).length) return send(res, 409, { error: "Cet e-mail existe déjà." });
    await sql`INSERT INTO users (email,name,password_hash,role) VALUES (${email},${str(b.name, 100)},${hashPassword(b.password)},'admin')`;
    await audit(me.id, "admin.create", email);
    return send(res, 201, { ok: true });
  }
  const id = Number(req.query.id || b.id) || 0;
  const [target] = await sql`SELECT * FROM users WHERE id = ${id}`;
  if (!target) return send(res, 404, { error: "Introuvable" });
  if (target.role === "super_admin" && target.id !== me.id) return send(res, 403, { error: "Un super administrateur ne peut pas être modifié par un autre." });
  if (req.method === "PATCH") {
    if (b.password !== undefined) {
      if (!pwOk(b.password)) return send(res, 400, { error: "Mot de passe d'au moins 10 caractères." });
      await sql`UPDATE users SET password_hash = ${hashPassword(b.password)}, failed_logins = 0, locked_until = NULL WHERE id = ${id}`;
      await sql`DELETE FROM sessions WHERE user_id = ${id}`;
      await audit(me.id, "admin.password", target.email);
    }
    if (b.disconnect === true && target.id !== me.id) {
      await sql`DELETE FROM sessions WHERE user_id = ${id}`;
      await audit(me.id, "admin.disconnect", target.email);
    }
    if (typeof b.active === "boolean" && target.id !== me.id) {
      await sql`UPDATE users SET active = ${b.active} WHERE id = ${id}`;
      if (!b.active) await sql`DELETE FROM sessions WHERE user_id = ${id}`;
      await audit(me.id, b.active ? "admin.enable" : "admin.disable", target.email);
    }
    return send(res, 200, { ok: true });
  }
  if (req.method === "DELETE") {
    if (target.id === me.id) return send(res, 400, { error: "Vous ne pouvez pas vous supprimer." });
    await sql`DELETE FROM users WHERE id = ${id}`;
    await audit(me.id, "admin.delete", target.email);
    return send(res, 200, { ok: true });
  }
  send(res, 405, { error: "Méthode refusée" });
}

export default wrap("admins", handler);
