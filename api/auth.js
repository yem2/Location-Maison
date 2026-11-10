import { sql, send, throttle, verifyPassword, hashPassword, createSession, destroySession, currentUser, requireUser, sameOrigin, audit, str, encrypt, decrypt, newTotpSecret, verifyTotp, normalizePhone , wrap } from "./_lib.js";

const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

async function handler(req, res) {
  const a = req.query.a;
  if (a === "me") {
    const u = await currentUser(req);
    return send(res, u ? 200 : 401, u ? { user: u } : { error: "Non connecté" });
  }
  if (req.method !== "POST" || !sameOrigin(req)) return send(res, 405, { error: "Méthode refusée" });
  if (a === "logout") { await destroySession(req, res); return send(res, 200, { ok: true }); }

  if (a === "login") {
    if (!(await throttle(req, res, "alogin", 10, 600))) return;
    const email = str(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password.slice(0, 200) : "";
    const code = str(req.body?.code, 10);
    const [user] = await sql`SELECT * FROM users WHERE email = ${email}`;
    const locked = user?.locked_until && new Date(user.locked_until) > new Date();
    const pwOk = verifyPassword(password, user ? user.password_hash : DUMMY) && !!user && user.active && !locked;
    let ok = pwOk;
    if (pwOk && user.totp_enabled) {
      if (!code) return send(res, 401, { needCode: true, error: "Entrez le code à 6 chiffres de votre application d’authentification." });
      ok = verifyTotp(decrypt(user.totp_secret), code);
    }
    if (!ok) {
      if (user && !locked) {
        await sql`UPDATE users SET failed_logins = CASE WHEN failed_logins + 1 >= 5 THEN 0 ELSE failed_logins + 1 END,
          locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = ${user.id}`;
        await audit(user.id, "login.failed");
      }
      return send(res, locked ? 429 : 401, { error: locked ? "Trop de tentatives, réessayez dans 15 minutes." : pwOk ? "Code incorrect." : "Identifiants incorrects." });
    }
    await sql`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ${user.id}`;
    await createSession(res, user.id);
    await audit(user.id, "login");
    return send(res, 200, { user: { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone, whatsapp_optin: user.whatsapp_optin, totp_enabled: user.totp_enabled } });
  }

  // ----- Actions réservées à un administrateur connecté -----
  const me = await requireUser(req, res);
  if (!me) return;
  const b = req.body || {};
  const [row] = await sql`SELECT * FROM users WHERE id = ${me.id}`;

  if (a === "profile") {
    const phone = str(b.phone, 30), opt = b.whatsapp === true;
    if (opt && !normalizePhone(phone)) return send(res, 400, { error: "Indiquez un numéro WhatsApp valide avec l’indicatif du pays." });
    await sql`UPDATE users SET phone = ${phone}, whatsapp_optin = ${opt} WHERE id = ${me.id}`;
    return send(res, 200, { ok: true });
  }
  if (a === "password") {
    const next = typeof b.next === "string" ? b.next : "";
    if (!verifyPassword(String(b.current || ""), row.password_hash)) return send(res, 400, { error: "Mot de passe actuel incorrect." });
    if (next.length < 12 || next.length > 200) return send(res, 400, { error: "Le nouveau mot de passe doit contenir au moins 12 caractères." });
    await sql`UPDATE users SET password_hash = ${hashPassword(next)} WHERE id = ${me.id}`;
    await sql`DELETE FROM sessions WHERE user_id = ${me.id}`;
    await createSession(res, me.id);
    await audit(me.id, "password.change");
    return send(res, 200, { ok: true });
  }
  if (a === "totp_setup") {
    if (row.totp_enabled) return send(res, 409, { error: "La double authentification est déjà active." });
    const secret = newTotpSecret();
    await sql`UPDATE users SET totp_secret = ${encrypt(secret)} WHERE id = ${me.id}`;
    return send(res, 200, { secret, uri: `otpauth://totp/Maison:${encodeURIComponent(row.email)}?secret=${secret}&issuer=Maison` });
  }
  if (a === "totp_enable") {
    if (!row.totp_secret || !verifyTotp(decrypt(row.totp_secret), b.code)) return send(res, 400, { error: "Code incorrect." });
    await sql`UPDATE users SET totp_enabled = true WHERE id = ${me.id}`;
    await audit(me.id, "2fa.enable");
    return send(res, 200, { ok: true });
  }
  if (a === "totp_disable") {
    if (!row.totp_enabled || !verifyPassword(String(b.password || ""), row.password_hash) || !verifyTotp(decrypt(row.totp_secret), b.code)) return send(res, 400, { error: "Mot de passe ou code incorrect." });
    await sql`UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = ${me.id}`;
    await audit(me.id, "2fa.disable");
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: "Inconnu" });
}

export default wrap("auth", handler);
