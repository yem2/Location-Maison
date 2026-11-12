import { sql, send, throttle, verifyPassword, hashPassword, createSession, destroySession, currentUser, requireUser, sameOrigin, audit, str, encrypt, decrypt, newTotpSecret, verifyTotp, normalizePhone, ensureSchema, mailConfigured, startReset, findReset, burnResets, wrap } from "./_lib.js";

const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

async function handler(req, res) {
  const a = req.query.a;
  if (a === "me") {
    const u = await currentUser(req);
    if (!u) return send(res, 401, { error: "Non connecté" });
    let user = u;
    if (await ensureSchema()) {
      try { const [x] = await sql`SELECT avatar, bio, city FROM users WHERE id = ${u.id}`; user = { ...u, ...x }; } catch { /* colonnes indisponibles */ }
    }
    return send(res, 200, { user });
  }
  // Signal de présence : l'administration l'appelle chaque minute tant que la page est ouverte
  if (a === "ping") {
    const u = await currentUser(req);
    return send(res, u ? 200 : 401, u ? { ok: true } : { error: "Non connecté" });
  }
  if (req.method !== "POST" || !sameOrigin(req)) return send(res, 405, { error: "Méthode refusée" });
  if (a === "logout") { await destroySession(req, res); return send(res, 200, { ok: true }); }

  // Mot de passe oublié : réponse identique que le compte existe ou non (pas de fuite d'information)
  if (a === "forgot") {
    if (!(await throttle(req, res, "aforgot", 5, 3600))) return;
    const email = str(req.body?.email, 254).toLowerCase();
    const [u] = await sql`SELECT id, email, name FROM users WHERE email = ${email} AND active`;
    if (u) { await startReset(req, "admin", u, "/admin", "compte administrateur"); await audit(u.id, "password.forgot"); }
    return send(res, 200, { ok: true, mail: mailConfigured() });
  }
  if (a === "reset") {
    if (!(await throttle(req, res, "areset", 10, 600))) return;
    const pw = typeof req.body?.password === "string" ? req.body.password : "";
    const code = str(req.body?.code, 10);
    const tk = await findReset("admin", req.body?.token);
    if (!tk) return send(res, 400, { error: "Ce lien est invalide ou a expiré. Refaites une demande." });
    if (pw.length < 12 || pw.length > 200) return send(res, 400, { error: "Le mot de passe doit contenir au moins 12 caractères." });
    const [u] = await sql`SELECT * FROM users WHERE id = ${tk.account_id} AND active`;
    if (!u) return send(res, 400, { error: "Ce lien est invalide ou a expiré. Refaites une demande." });
    if (u.totp_enabled) {
      if (!code) return send(res, 401, { needCode: true, error: "Entrez le code à 6 chiffres de votre application d’authentification." });
      if (!verifyTotp(decrypt(u.totp_secret), code)) return send(res, 401, { needCode: true, error: "Code incorrect." });
    }
    await sql`UPDATE users SET password_hash = ${hashPassword(pw)}, failed_logins = 0, locked_until = NULL WHERE id = ${u.id}`;
    await sql`DELETE FROM sessions WHERE user_id = ${u.id}`;
    await burnResets("admin", u.id);
    await audit(u.id, "password.reset");
    return send(res, 200, { ok: true });
  }

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
    const name = "name" in b ? str(b.name, 100) : row.name;
    const extra = "city" in b || "bio" in b || "avatar" in b;
    let av = null;
    if ("avatar" in b) {
      av = typeof b.avatar === "string" ? b.avatar : "";
      if (av && (av.length > 120000 || !AVATAR_RE.test(av))) return send(res, 400, { error: "Photo invalide ou trop lourde (image JPG, PNG ou WebP)." });
    }
    if (extra && !(await ensureSchema())) return send(res, 500, { error: "Le profil complet n’est pas encore activé (exécutez migration-superadmin.sql dans Neon)." });
    // Tout est validé : on écrit
    await sql`UPDATE users SET name = ${name}, phone = ${phone}, whatsapp_optin = ${opt} WHERE id = ${me.id}`;
    const out = { name, phone, whatsapp_optin: opt };
    if (extra) {
      const cur = (await sql`SELECT avatar, bio, city FROM users WHERE id = ${me.id}`)[0] || {};
      const m = { avatar: cur.avatar || "", bio: cur.bio || "", city: cur.city || "" };
      if ("city" in b) m.city = str(b.city, 80);
      if ("bio" in b) m.bio = str(b.bio, 500);
      if (av !== null) m.avatar = av;
      await sql`UPDATE users SET avatar = ${m.avatar}, bio = ${m.bio}, city = ${m.city} WHERE id = ${me.id}`;
      Object.assign(out, m);
    }
    return send(res, 200, { ok: true, user: out });
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
