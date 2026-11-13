import { sql, send, requireUser, requireCustomer, throttle, audit, logActivity, notifyAdmins, notifyCustomer, str } from "./_lib.js";

// ============================================================================
//  Visites : le client choisit un créneau libre, l'équipe confirme, un rappel part la veille et le jour même.
//  Heures locales de l'agence (SITE_TZ). Créneaux : VISIT_SLOTS ; jours ouvrés : VISIT_DAYS (0 = dimanche).
//  Réservé via un index unique : impossible de réserver deux fois le même créneau pour le même bien.
// ============================================================================

export const TZ = () => process.env.SITE_TZ || "Africa/Douala";
export const SLOTS = () => (process.env.VISIT_SLOTS || "09:00,10:00,11:00,14:00,15:00,16:00,17:00").split(",").map((s) => s.trim()).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
export const DAYS = () => (process.env.VISIT_DAYS || "1,2,3,4,5,6").split(",").map((d) => Number(d.trim())).filter((d) => d >= 0 && d <= 6);
const LEAD_MIN = 120, HORIZON_DAYS = 60, MAX_ACTIVE = 3;

let schemaP;
export function ensureVisitSchema() {
  schemaP ??= (async () => {
    try {
      await sql`CREATE TABLE IF NOT EXISTS visits (
        id serial PRIMARY KEY, property_id text NOT NULL, property_title text NOT NULL DEFAULT '', customer_id bigint NOT NULL,
        visit_date date NOT NULL, visit_time text NOT NULL, status text NOT NULL DEFAULT 'requested',
        note text NOT NULL DEFAULT '', admin_note text NOT NULL DEFAULT '', reminded_on date,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS visits_slot_uniq ON visits (property_id, visit_date, visit_time) WHERE status IN ('requested','confirmed')`;
      await sql`CREATE INDEX IF NOT EXISTS visits_customer_idx ON visits (customer_id, visit_date)`;
      await sql`CREATE INDEX IF NOT EXISTS visits_date_idx ON visits (visit_date, status)`;
      return true;
    } catch { return false; }
  })().then((ok) => { if (!ok) schemaP = null; return ok; });
  return schemaP;
}

const dup = (e) => !!e && (e.code === "23505" || /duplicate key|unique constraint/i.test(String(e.message || "")));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const validDate = (d) => typeof d === "string" && ISO.test(d) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
export const dayOfWeek = (d) => new Date(d + "T12:00:00Z").getUTCDay();
export const addDays = (d, n) => new Date(new Date(d + "T12:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
export function localNow(now = new Date()) {
  const s = now.toLocaleString("sv-SE", { timeZone: TZ() }); // « 2026-11-11 14:05:09 »
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmtDay = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const ymd = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v).slice(0, 10)); // colonne « date » → AAAA-MM-JJ

// Un créneau est-il réservable ? (jour ouvré, horaire de la grille, ni passé ni trop lointain)
export function slotProblem(date, time, now = localNow(), { lead = true } = {}) {
  if (!validDate(date)) return "Date invalide.";
  if (!SLOTS().includes(time)) return "Horaire invalide.";
  if (!DAYS().includes(dayOfWeek(date))) return "Nous ne faisons pas de visites ce jour-là.";
  if (date < now.date) return "Cette date est déjà passée.";
  if (date > addDays(now.date, HORIZON_DAYS)) return `Les visites se réservent jusqu’à ${HORIZON_DAYS} jours à l’avance.`;
  if (lead && date === now.date && minutes(time) < minutes(now.time) + LEAD_MIN) return "Ce créneau est trop proche : choisissez un horaire plus tard ou un autre jour.";
  return null;
}

const toFront = (v) => ({ id: v.id, property_id: v.property_id, property_title: v.property_title, date: ymd(v.visit_date), time: v.visit_time, status: v.status, note: v.note, admin_note: v.admin_note,
  ...(v.customer_name !== undefined ? { customer_name: v.customer_name, customer_phone: v.customer_phone, customer_email: v.customer_email } : {}) });

// ---------- Gestionnaire (appelé par api/orders.js pour les actions « visit… ») ----------
export async function visitsHandler(req, res) {
  const a = req.query.a;

  // Rappels quotidiens (planificateur Vercel : en-tête Authorization: Bearer CRON_SECRET)
  if (a === "visit_reminders") {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: "Refusé" });
    if (!(await ensureVisitSchema())) return send(res, 503, { error: "Visites indisponibles." });
    const tz = TZ(), today = localNow().date;
    const rows = await sql`SELECT id, customer_id, property_title, visit_date, visit_time FROM visits
      WHERE status = 'confirmed' AND visit_date IN (${today}::date, ${addDays(today, 1)}::date) AND (reminded_on IS NULL OR reminded_on < ${today}::date)`;
    let n = 0;
    for (const v of rows) {
      const when = ymd(v.visit_date) === today ? "aujourd’hui" : "demain";
      await notifyCustomer(v.customer_id, `Rappel : votre visite de « ${v.property_title} » a lieu ${when} à ${v.visit_time}.`);
      await sql`UPDATE visits SET reminded_on = ${today}::date WHERE id = ${v.id}`;
      n++;
    }
    return send(res, 200, { ok: true, reminded: n, tz });
  }

  // ---------- Administration ----------
  if (a === "visits_admin" || a === "visit_set") {
    const u = await requireUser(req, res);
    if (!u) return;
    if (!(await ensureVisitSchema())) return send(res, 503, { error: "Les visites sont momentanément indisponibles." });
    const today = localNow().date;

    if (a === "visits_admin") {
      const scope = req.query.scope;
      const rows = scope === "all"
        ? await sql`SELECT v.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email FROM visits v LEFT JOIN customers c ON c.id = v.customer_id ORDER BY v.visit_date DESC, v.visit_time DESC LIMIT 300`
        : scope === "upcoming"
        ? await sql`SELECT v.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email FROM visits v LEFT JOIN customers c ON c.id = v.customer_id WHERE v.status = 'confirmed' AND v.visit_date >= ${today}::date ORDER BY v.visit_date, v.visit_time LIMIT 300`
        : await sql`SELECT v.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email FROM visits v LEFT JOIN customers c ON c.id = v.customer_id WHERE v.status = 'requested' ORDER BY v.visit_date, v.visit_time LIMIT 300`;
      return send(res, 200, { visits: rows.map(toFront), slots: SLOTS(), days: DAYS(), today });
    }

    // visit_set : confirmer, refuser, annuler, terminer ou reprogrammer
    if (req.method !== "POST") return send(res, 405, { error: "Méthode refusée" });
    const b = req.body || {};
    const id = Number(b.id) || 0;
    const [v] = await sql`SELECT * FROM visits WHERE id = ${id}`;
    if (!v) return send(res, 404, { error: "Visite introuvable." });
    const adminNote = str(b.adminNote, 300);
    const label = `« ${v.property_title} »`;
    const when = `${fmtDay(ymd(v.visit_date))} à ${v.visit_time}`;

    if (b.date !== undefined || b.time !== undefined) { // reprogrammer
      const date = String(b.date || ""), time = String(b.time || "");
      const pb = slotProblem(date, time, localNow(), { lead: false });
      if (pb) return send(res, 400, { error: pb });
      try { await sql`UPDATE visits SET visit_date = ${date}::date, visit_time = ${time}, status = 'confirmed', admin_note = ${adminNote}, reminded_on = NULL, updated_at = now() WHERE id = ${id}`; }
      catch (e) { if (dup(e)) return send(res, 409, { error: "Ce créneau est déjà pris pour ce bien." }); throw e; }
      await notifyCustomer(v.customer_id, `Votre visite de ${label} est confirmée le ${fmtDay(date)} à ${time}.${adminNote ? " " + adminNote : ""}`);
      await audit(u.id, "visit.reschedule", `#${id} → ${date} ${time}`);
      return send(res, 200, { ok: true });
    }
    const status = ["confirmed", "declined", "cancelled", "done"].includes(b.status) ? b.status : null;
    if (!status) return send(res, 400, { error: "Action inconnue." });
    if (v.status === status) return send(res, 200, { ok: true });
    await sql`UPDATE visits SET status = ${status}, admin_note = ${adminNote}, updated_at = now() WHERE id = ${id}`;
    if (status === "confirmed") await notifyCustomer(v.customer_id, `Votre visite de ${label} est confirmée : ${when}.${adminNote ? " " + adminNote : ""}`);
    if (status === "declined") await notifyCustomer(v.customer_id, `Votre demande de visite de ${label} (${when}) n’a pas pu être acceptée${adminNote ? " : " + adminNote : ""}. Vous pouvez choisir un autre créneau.`);
    if (status === "cancelled") await notifyCustomer(v.customer_id, `Votre visite de ${label} (${when}) a été annulée${adminNote ? " : " + adminNote : ""}.`);
    await audit(u.id, "visit." + status, `#${id}`);
    return send(res, 200, { ok: true });
  }

  // ---------- Client ----------
  const c = await requireCustomer(req, res);
  if (!c) return;
  if (!(await ensureVisitSchema())) return send(res, 503, { error: "Les visites sont momentanément indisponibles." });
  const now = localNow();

  if (a === "visits") {
    const rows = await sql`SELECT * FROM visits WHERE customer_id = ${c.id} ORDER BY visit_date DESC, visit_time DESC LIMIT 100`;
    return send(res, 200, { visits: rows.map(toFront), today: now.date, tz: TZ() });
  }

  if (a === "visit_slots") {
    const pid = str(req.query.propertyId, 80), date = String(req.query.date || "");
    if (!pid || !validDate(date)) return send(res, 400, { error: "Bien ou date invalide." });
    const taken = new Set((await sql`SELECT visit_time FROM visits WHERE property_id = ${pid} AND visit_date = ${date}::date AND status IN ('requested','confirmed')`).map((r) => r.visit_time));
    const mine = new Set((await sql`SELECT visit_time FROM visits WHERE customer_id = ${c.id} AND visit_date = ${date}::date AND status IN ('requested','confirmed')`).map((r) => r.visit_time));
    const dayOk = DAYS().includes(dayOfWeek(date));
    return send(res, 200, { date, dayOk, slots: SLOTS().map((t) => ({ time: t, free: dayOk && !taken.has(t) && !mine.has(t) && !slotProblem(date, t, now) })) });
  }

  if (a === "visit_ics") {
    const id = Number(req.query.id) || 0;
    const [v] = await sql`SELECT * FROM visits WHERE id = ${id} AND customer_id = ${c.id} AND status = 'confirmed'`;
    if (!v) return send(res, 404, { error: "Visite introuvable." });
    const d = ymd(v.visit_date).replace(/-/g, ""), t0 = v.visit_time.replace(":", "") + "00";
    const endMin = minutes(v.visit_time) + 60, t1 = String(Math.floor(endMin / 60) % 24).padStart(2, "0") + String(endMin % 60).padStart(2, "0") + "00";
    const esc = (s) => String(s).replace(/[\\;,]/g, (m) => "\\" + m).replace(/\r?\n/g, "\\n");
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Maison//Visites//FR", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:visite-${v.id}@maison`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      `DTSTART;TZID=${TZ()}:${d}T${t0}`, `DTEND;TZID=${TZ()}:${d}T${t1}`, `SUMMARY:${esc("Visite : " + v.property_title)}`, "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Visite dans 2 heures", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n") + "\r\n";
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="visite-${v.id}.ics"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).end(ics);
  }

  if (req.method !== "POST") return send(res, 405, { error: "Méthode refusée" });
  const b = req.body || {};

  if (a === "visit_book") {
    if (!(await throttle(req, res, "visit", 10, 600))) return;
    const pid = str(b.propertyId, 80), date = String(b.date || ""), time = String(b.time || "");
    const pb = slotProblem(date, time, now);
    if (pb) return send(res, 400, { error: pb });
    const [p] = await sql`SELECT id, title, published FROM properties WHERE id = ${pid}`;
    if (!p || !p.published) return send(res, 404, { error: "Ce bien n’est plus disponible." });
    const [cnt] = await sql`SELECT count(*)::int AS n FROM visits WHERE customer_id = ${c.id} AND status IN ('requested','confirmed') AND visit_date >= ${now.date}::date`;
    if (cnt.n >= MAX_ACTIVE) return send(res, 409, { error: `Vous avez déjà ${MAX_ACTIVE} visites à venir. Annulez-en une pour en demander une autre.` });
    const [clash] = await sql`SELECT 1 FROM visits WHERE customer_id = ${c.id} AND visit_date = ${date}::date AND visit_time = ${time} AND status IN ('requested','confirmed')`;
    if (clash) return send(res, 409, { error: "Vous avez déjà une visite à cette heure-là." });
    let row;
    try { [row] = await sql`INSERT INTO visits (property_id, property_title, customer_id, visit_date, visit_time, note) VALUES (${p.id}, ${p.title}, ${c.id}, ${date}::date, ${time}, ${str(b.note, 300)}) RETURNING id`; }
    catch (e) { if (dup(e)) return send(res, 409, { error: "Ce créneau vient d’être réservé. Choisissez-en un autre." }); throw e; }
    await logActivity(c.id, "visit", p.id, p.title);
    await notifyAdmins("visit", "Nouvelle demande de visite", `${c.name} → ${p.title} le ${fmtDay(date)} à ${time}`, c.id);
    return send(res, 200, { ok: true, id: row.id });
  }

  if (a === "visit_cancel") {
    const id = Number(b.id) || 0;
    const [v] = await sql`UPDATE visits SET status = 'cancelled', updated_at = now() WHERE id = ${id} AND customer_id = ${c.id} AND status IN ('requested','confirmed') RETURNING property_title, visit_date, visit_time, status`;
    if (!v) return send(res, 404, { error: "Visite introuvable ou déjà terminée." });
    await notifyAdmins("visit", "Visite annulée par le client", `${c.name} → ${v.property_title} le ${fmtDay(ymd(v.visit_date))} à ${v.visit_time}`, c.id);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: "Inconnu" });
}
