// Loyers mensuels : baux, échéancier automatique, encaissement, quittance de loyer (PDF) et rappels.
// Appelé par api/orders.js pour les actions « rent_… » et par la tâche quotidienne (rentDaily).
import { sql, send, requireUser, requireCustomer, currentUser, currentCustomer, throttle, audit, notifyAdmins, notifyCustomer, str } from "./_lib.js";
import { Pdf, fmtMoney, fmtDate, amountWords } from "./_pdf.js";
import { loadAgency, letterhead, idLine } from "./_docs.js";
import { loadCfg, optionsFor, METHOD_LABEL, normPhone, csvCell } from "./_pay.js";
import { localNow, validDate, addDays } from "./_visits.js";

// ---------- Calculs purs (testés) ----------
export const addMonths = (period, n) => { const [y, m] = period.split("-").map(Number), t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
export const dueDate = (period, payDay) => `${period}-${String(Math.min(28, Math.max(1, Number(payDay) || 5))).padStart(2, "0")}`;
export const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5);
// Périodes (AAAA-MM) à générer : du mois de début jusqu'à `months` mois, sans dépasser la fin du bail
export function periodsFor({ start, end, months = 12 }) {
  const first = start.slice(0, 7), last = end ? end.slice(0, 7) : addMonths(first, months - 1), out = [];
  for (let p = first; p <= last && out.length < 120; p = addMonths(p, 1)) out.push(p);
  return out;
}
export const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const periodLabel = (p) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
// Quels rappels envoyer aujourd'hui pour un loyer non payé ? (J-3, jour J, puis tous les 3 jours de retard jusqu'à 60 jours)
export function reminderKind(due, today) {
  const d = daysBetween(today, due); // >0 : à venir ; <0 : en retard
  if (d === 3) return "soon";
  if (d === 0) return "today";
  if (d < 0 && -d <= 60 && -d % 3 === 0) return "late";
  return null;
}

// ---------- Base de données ----------
let rentP;
export function ensureRentSchema() {
  rentP ??= (async () => {
    try {
      await sql`CREATE TABLE IF NOT EXISTS leases (
        id serial PRIMARY KEY, customer_id bigint NOT NULL, property_id text NOT NULL DEFAULT '', property_title text NOT NULL DEFAULT '', order_id bigint,
        rent numeric NOT NULL, charges numeric NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'XAF', pay_day int NOT NULL DEFAULT 5,
        start_date date NOT NULL, end_date date, deposit numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active', note text NOT NULL DEFAULT '',
        created_by bigint, created_at timestamptz NOT NULL DEFAULT now())`;
      await sql`CREATE INDEX IF NOT EXISTS leases_customer_idx ON leases (customer_id)`;
      await sql`CREATE TABLE IF NOT EXISTS rent_charges (
        id serial PRIMARY KEY, lease_id int NOT NULL, period text NOT NULL, due_date date NOT NULL, amount numeric NOT NULL, currency text NOT NULL,
        status text NOT NULL DEFAULT 'due', method text NOT NULL DEFAULT '', reference text NOT NULL DEFAULT '', payer_phone text NOT NULL DEFAULT '',
        paid_at timestamptz, paid_by bigint, reminded_on date, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (lease_id, period))`;
      await sql`CREATE INDEX IF NOT EXISTS rent_charges_due_idx ON rent_charges (status, due_date)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS rent_ref_uniq ON rent_charges (method, reference) WHERE reference <> '' AND status IN ('declared', 'paid')`;
      return true;
    } catch { return false; }
  })().then((ok) => { if (!ok) rentP = null; return ok; });
  return rentP;
}
const dup = (e) => !!e && (String(e.code) === "23505" || /duplicate key|unique constraint/i.test(String(e.message || "")));

async function insertCharges(lease, periods) {
  for (const p of periods) {
    await sql`INSERT INTO rent_charges (lease_id, period, due_date, amount, currency) VALUES (${lease.id}, ${p}, ${dueDate(p, lease.pay_day)}::date, ${Number(lease.rent) + Number(lease.charges)}, ${lease.currency})
      ON CONFLICT (lease_id, period) DO NOTHING`;
  }
}

// ---------- Tâche quotidienne : échéances à venir + rappels ----------
export async function rentDaily() {
  if (!(await ensureRentSchema())) return null;
  const today = localNow().date, cur = today.slice(0, 7);
  // 1) garder 3 mois d'avance pour les baux sans date de fin
  const open = await sql`SELECT id, pay_day, rent, charges, currency FROM leases WHERE status = 'active' AND end_date IS NULL`;
  for (const l of open) await insertCharges(l, [cur, addMonths(cur, 1), addMonths(cur, 2), addMonths(cur, 3)]);
  // 2) rappels aux locataires
  const rows = await sql`SELECT c.id, c.period, c.due_date::text AS due_date, c.amount, c.currency, l.customer_id, l.property_title FROM rent_charges c JOIN leases l ON l.id = c.lease_id
    WHERE c.status = 'due' AND l.status = 'active' AND c.due_date <= ${addDays(today, 3)}::date AND (c.reminded_on IS NULL OR c.reminded_on < ${today}::date)`;
  let reminded = 0, overdue = 0;
  for (const r of rows) {
    const kind = reminderKind(r.due_date, today);
    if (daysBetween(today, r.due_date) < 0) overdue++;
    if (!kind) continue;
    const label = `${periodLabel(r.period)} — ${fmtMoney(r.amount, r.currency)}`;
    const msg = kind === "soon" ? `Rappel : votre loyer de ${label} est dû dans 3 jours (le ${fmtDate(r.due_date)}).`
      : kind === "today" ? `Rappel : votre loyer de ${label} est dû aujourd’hui.`
      : `Loyer en retard : ${label} (échéance du ${fmtDate(r.due_date)}). Merci de régulariser ou de contacter l’agence.`;
    await notifyCustomer(r.customer_id, msg);
    await sql`UPDATE rent_charges SET reminded_on = ${today}::date WHERE id = ${r.id}`;
    reminded++;
  }
  if (overdue) await notifyAdmins("rent_overdue", "Loyers en retard", `${overdue} loyer(s) impayé(s) à relancer (onglet Demandes › Loyers).`);
  return { reminded, overdue, generated: open.length };
}

// ---------- Quittance de loyer (PDF) ----------
export function rentReceiptPdf({ agency, lease, charge, customer }) {
  const year = new Date(charge.paid_at || Date.now()).getFullYear(), number = `QLY-${year}-${String(charge.id).padStart(6, "0")}`;
  const d = new Pdf({ title: "Quittance de loyer " + number, footer: `${agency.name} — Quittance ${number}`, header: letterhead(agency) });
  const rent = Number(lease.rent), ch = Number(lease.charges), total = Number(charge.amount);
  d.h1("QUITTANCE DE LOYER");
  d.kv([["Numéro", number], ["Période", periodLabel(charge.period)], ["Locataire", customer.name], ["Bien loué", lease.property_title || "—"], ["Bailleur / agence", agency.name]]);
  d.box([`Montant reçu : ${fmtMoney(total, charge.currency)}`, `Arrêté à la somme de : ${amountWords(total, charge.currency)}.`]);
  d.h2("Détail du terme");
  d.kv([["Loyer", fmtMoney(rent, charge.currency)], ...(ch ? [["Charges", fmtMoney(ch, charge.currency)]] : []), ["Total du terme", fmtMoney(total, charge.currency)],
    ["Échéance", fmtDate(charge.due_date)], ["Payé le", fmtDate(charge.paid_at)], ["Moyen de paiement", METHOD_LABEL[charge.method] || charge.method || "—"], ...(charge.reference ? [["Référence", charge.reference]] : [])]);
  d.p(`Je soussigné(e), ${agency.rep ? agency.rep + ", " : ""}agissant pour ${agency.name}, déclare avoir reçu de ${customer.name} la somme indiquée ci-dessus au titre du loyer et des charges de la période de ${periodLabel(charge.period)}, et lui en donne quittance, sous réserve de tous mes droits.`, { size: 10 });
  d.p("Cette quittance atteste le paiement du terme indiqué ; elle ne vaut pas renonciation aux sommes éventuellement dues pour d’autres périodes.", { size: 9.5, italic: true, color: [0.4, 0.45, 0.45] });
  d.signatures("Pour l’agence", "Le locataire");
  if (idLine(agency)) d.p(idLine(agency), { size: 8.5, align: "center", color: [0.4, 0.45, 0.45] });
  return { number, buffer: d.build() };
}

const pdf = (res, name, buf) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).send(buf);
};

// ---------- Gestionnaire HTTP ----------
export async function rentHandler(req, res) {
  const a = req.query.a;
  if (!(await ensureRentSchema())) return send(res, 503, { error: "Les loyers sont momentanément indisponibles." });
  const today = localNow().date;

  // ===== Quittance : le locataire concerné ou un administrateur =====
  if (a === "rent_receipt") {
    const id = Number(req.query.id) || 0;
    const [r] = await sql`SELECT c.id, c.lease_id, c.period, c.due_date::text AS due_date, c.amount, c.currency, c.method, c.reference, c.paid_at, l.customer_id, l.rent, l.charges, l.property_title
      FROM rent_charges c JOIN leases l ON l.id = c.lease_id WHERE c.id = ${id} AND c.status = 'paid'`;
    if (!r) return send(res, 404, { error: "Quittance introuvable" });
    const u = await currentUser(req), c = await currentCustomer(req);
    if (!(u || (c && c.id === r.customer_id))) return send(res, 401, { error: "Connexion requise" });
    const [customer] = await sql`SELECT name, email, phone FROM customers WHERE id = ${r.customer_id}`;
    const q = rentReceiptPdf({ agency: await loadAgency(), lease: r, charge: r, customer: customer || {} });
    return pdf(res, "quittance-" + q.number, q.buffer);
  }

  // ===== Espace administrateur =====
  const adminActions = ["rent_admin", "rent_charges", "rent_options", "rent_lease_create", "rent_lease_end", "rent_pay", "rent_reject", "rent_cancel_charge", "rent_export"];
  if (adminActions.includes(a)) {
    const u = await requireUser(req, res);
    if (!u) return;
    const sup = u.role === "super_admin";

    if (a === "rent_admin") {
      const leases = await sql`SELECT l.id, l.customer_id, l.property_id, l.property_title, l.rent, l.charges, l.currency, l.pay_day, l.start_date::text AS start_date, l.end_date::text AS end_date, l.deposit, l.status,
          cu.name AS customer_name, cu.phone AS customer_phone, cu.email AS customer_email,
          (SELECT count(*)::int FROM rent_charges c WHERE c.lease_id = l.id AND c.status = 'due' AND c.due_date < ${today}::date) AS overdue_count,
          (SELECT COALESCE(sum(c.amount), 0)::float FROM rent_charges c WHERE c.lease_id = l.id AND c.status = 'due' AND c.due_date < ${today}::date) AS overdue_amount,
          (SELECT count(*)::int FROM rent_charges c WHERE c.lease_id = l.id AND c.status = 'declared') AS declared_count,
          (SELECT min(c.due_date)::text FROM rent_charges c WHERE c.lease_id = l.id AND c.status = 'due') AS next_due
        FROM leases l LEFT JOIN customers cu ON cu.id = l.customer_id ORDER BY (l.status = 'active') DESC, l.id DESC LIMIT 300`;
      const month = today.slice(0, 7);
      const summary = await sql`SELECT currency, COALESCE(sum(amount) FILTER (WHERE period = ${month} AND status <> 'cancelled'), 0)::float AS expected,
          COALESCE(sum(amount) FILTER (WHERE period = ${month} AND status = 'paid'), 0)::float AS collected,
          COALESCE(sum(amount) FILTER (WHERE status = 'due' AND due_date < ${today}::date), 0)::float AS overdue,
          count(*) FILTER (WHERE status = 'declared')::int AS declared FROM rent_charges GROUP BY currency`;
      return send(res, 200, { leases, summary, today });
    }
    if (a === "rent_charges") {
      const rows = await sql`SELECT c.id, c.lease_id, c.period, c.due_date::text AS due_date, c.amount, c.currency, c.status, c.method, c.reference, c.payer_phone, c.paid_at,
          (c.status = 'due' AND c.due_date < ${today}::date) AS overdue FROM rent_charges c WHERE c.lease_id = ${Number(req.query.lease) || 0} ORDER BY c.period DESC LIMIT 120`;
      return send(res, 200, { charges: rows });
    }
    if (a === "rent_options") {
      const customers = await sql`SELECT id, name, email, phone FROM customers WHERE COALESCE(active, true) ORDER BY name LIMIT 500`;
      const properties = await sql`SELECT id, title, price, currency, operation FROM properties WHERE COALESCE(archived, false) = false ORDER BY title LIMIT 500`;
      return send(res, 200, { customers, properties });
    }
    if (a === "rent_export") {
      if (!sup) return send(res, 403, { error: "Réservé au super administrateur" });
      const rows = await sql`SELECT c.id, c.period, c.due_date::text AS due_date, c.amount, c.currency, c.status, c.method, c.reference, c.paid_at, l.property_title, cu.name AS customer FROM rent_charges c
        JOIN leases l ON l.id = c.lease_id LEFT JOIN customers cu ON cu.id = l.customer_id ORDER BY c.period DESC, c.id DESC LIMIT 5000`;
      const head = ["id", "période", "échéance", "locataire", "bien", "montant", "devise", "statut", "moyen", "référence", "payé le"];
      const lines = [head.join(";"), ...rows.map((r) => [r.id, r.period, r.due_date, r.customer, r.property_title, r.amount, r.currency, r.status, METHOD_LABEL[r.method] || r.method, r.reference, r.paid_at && new Date(r.paid_at).toISOString()].map(csvCell).join(";"))];
      await audit(u.id, "rent.export", String(rows.length));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="loyers.csv"');
      return res.status(200).send("\ufeff" + lines.join("\r\n"));
    }
    if (req.method !== "POST") return send(res, 405, { error: "Méthode refusée" });
    const b = req.body || {};

    if (a === "rent_lease_create") {
      const customerId = Number(b.customerId) || 0, rent = Math.round(Number(b.rent) || 0), charges = Math.round(Number(b.charges) || 0), payDay = Math.min(28, Math.max(1, Number(b.payDay) || 5));
      const start = String(b.startDate || ""), end = b.endDate ? String(b.endDate) : null, currency = String(b.currency || "XAF").slice(0, 3).toUpperCase();
      if (!validDate(start) || (end && (!validDate(end) || end < start))) return send(res, 400, { error: "Dates invalides (fin après le début)." });
      if (rent <= 0) return send(res, 400, { error: "Indiquez le loyer mensuel." });
      const [cu] = await sql`SELECT id, name FROM customers WHERE id = ${customerId}`;
      if (!cu) return send(res, 404, { error: "Client introuvable." });
      let title = str(b.propertyTitle, 160), pid = str(b.propertyId, 80);
      if (pid) { const [p] = await sql`SELECT title FROM properties WHERE id = ${pid}`; if (p) title = p.title; }
      if (!title) return send(res, 400, { error: "Indiquez le bien loué." });
      const [lease] = await sql`INSERT INTO leases (customer_id, property_id, property_title, rent, charges, currency, pay_day, start_date, end_date, deposit, note, created_by)
        VALUES (${customerId}, ${pid}, ${title}, ${rent}, ${charges}, ${currency}, ${payDay}, ${start}::date, ${end}::date, ${Math.round(Number(b.deposit) || 0)}, ${str(b.note, 300)}, ${u.id})
        RETURNING id, rent, charges, currency, pay_day`;
      await insertCharges(lease, periodsFor({ start, end, months: 12 }));
      await audit(u.id, "rent.lease_create", `#${lease.id} ${cu.name} ${title}`);
      await notifyCustomer(customerId, `Votre bail pour « ${title} » est enregistré : loyer de ${fmtMoney(rent + charges, currency)} par mois, à payer avant le ${payDay} de chaque mois. Suivez vos loyers dans « Loyers ».`);
      return send(res, 200, { id: lease.id });
    }
    if (a === "rent_lease_end") {
      const id = Number(b.id) || 0, end = b.endDate && validDate(String(b.endDate)) ? String(b.endDate) : today;
      const [l] = await sql`UPDATE leases SET status = 'ended', end_date = ${end}::date WHERE id = ${id} AND status = 'active' RETURNING property_title`;
      if (!l) return send(res, 404, { error: "Bail introuvable ou déjà terminé." });
      await sql`UPDATE rent_charges SET status = 'cancelled' WHERE lease_id = ${id} AND status = 'due' AND period > ${end.slice(0, 7)}`;
      await audit(u.id, "rent.lease_end", `#${id} ${l.property_title}`);
      return send(res, 200, { ok: true });
    }
    const id = Number(b.chargeId) || 0;
    const [ch] = await sql`SELECT c.*, l.customer_id, l.property_title FROM rent_charges c JOIN leases l ON l.id = c.lease_id WHERE c.id = ${id}`;
    if (!ch) return send(res, 404, { error: "Échéance introuvable." });
    if (a === "rent_pay") {
      if (!["due", "declared"].includes(ch.status)) return send(res, 409, { error: "Cette échéance est déjà traitée." });
      const method = Object.hasOwn(METHOD_LABEL, b.method) ? b.method : "cash", ref = str(b.reference, 60).toUpperCase();
      try {
        await sql`UPDATE rent_charges SET status = 'paid', method = ${method}, reference = ${ref || ch.reference}, paid_at = now(), paid_by = ${u.id} WHERE id = ${id}`;
      } catch (e) { if (dup(e)) return send(res, 409, { error: "Cette référence de transaction a déjà servi pour un autre loyer." }); throw e; }
      await audit(u.id, "rent.pay", `#${id} ${periodLabel(ch.period)} ${METHOD_LABEL[method]}`);
      await notifyCustomer(ch.customer_id, `Loyer de ${periodLabel(ch.period)} reçu (${fmtMoney(ch.amount, ch.currency)}). Votre quittance est disponible dans « Loyers ».`);
      return send(res, 200, { ok: true });
    }
    if (a === "rent_reject") {
      if (ch.status !== "declared") return send(res, 409, { error: "Aucun paiement déclaré à refuser." });
      const reason = str(b.reason, 160);
      await sql`UPDATE rent_charges SET status = 'due', method = '', reference = '', payer_phone = '' WHERE id = ${id}`;
      await audit(u.id, "rent.reject", `#${id} ${reason}`);
      await notifyCustomer(ch.customer_id, `Votre paiement du loyer de ${periodLabel(ch.period)} n’a pas pu être vérifié${reason ? " : " + reason : ""}. Merci de vérifier ou de contacter l’agence.`);
      return send(res, 200, { ok: true });
    }
    if (a === "rent_cancel_charge") {
      if (!sup) return send(res, 403, { error: "Réservé au super administrateur" });
      if (ch.status === "paid") return send(res, 409, { error: "Un loyer payé ne peut pas être annulé." });
      await sql`UPDATE rent_charges SET status = 'cancelled' WHERE id = ${id}`;
      await audit(u.id, "rent.cancel", `#${id} ${periodLabel(ch.period)}`);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "Inconnu" });
  }

  // ===== Espace client =====
  const c = await requireCustomer(req, res);
  if (!c) return;
  if (a === "rent_mine") {
    const leases = await sql`SELECT id, property_title, rent, charges, currency, pay_day, start_date::text AS start_date, end_date::text AS end_date, status FROM leases WHERE customer_id = ${c.id} ORDER BY id DESC`;
    const charges = leases.length ? await sql`SELECT c.id, c.lease_id, c.period, c.due_date::text AS due_date, c.amount, c.currency, c.status, c.method, c.paid_at,
        (c.status = 'due' AND c.due_date < ${today}::date) AS overdue FROM rent_charges c JOIN leases l ON l.id = c.lease_id
        WHERE l.customer_id = ${c.id} AND c.status <> 'cancelled' AND c.due_date <= ${addDays(today, 62)}::date ORDER BY c.due_date DESC LIMIT 60` : [];
    return send(res, 200, { leases, charges, today });
  }
  if (a === "rent_methods") {
    const [ch] = await sql`SELECT c.id, c.amount, c.currency, c.status FROM rent_charges c JOIN leases l ON l.id = c.lease_id WHERE c.id = ${Number(req.query.chargeId) || 0} AND l.customer_id = ${c.id}`;
    if (!ch) return send(res, 404, { error: "Échéance introuvable." });
    const options = optionsFor(await loadCfg(), { currency: ch.currency, amount: ch.amount }).filter((o) => o.kind === "manual" || o.kind === "cash");
    return send(res, 200, { amount: ch.amount, currency: ch.currency, options });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Méthode refusée" });
  if (a === "rent_declare") {
    if (!(await throttle(req, res, "rent", 10, 600))) return;
    const b = req.body || {}, id = Number(b.chargeId) || 0, method = String(b.method || "");
    const [ch] = await sql`SELECT c.*, l.property_title FROM rent_charges c JOIN leases l ON l.id = c.lease_id WHERE c.id = ${id} AND l.customer_id = ${c.id}`;
    if (!ch || ch.status !== "due") return send(res, 400, { error: "Cette échéance ne peut pas recevoir de paiement." });
    const opt = optionsFor(await loadCfg(), { currency: ch.currency, amount: ch.amount }).find((o) => o.id === method && (o.kind === "manual" || o.kind === "cash"));
    if (!opt) return send(res, 400, { error: "Ce moyen de paiement n’est pas disponible." });
    let ref = String(b.reference || "").trim().toUpperCase(), phone = "";
    if (opt.kind === "manual") {
      if (!/^[A-Z0-9._\-\/ ]{4,40}$/.test(ref)) return send(res, 400, { error: "Indiquez l’identifiant de la transaction (4 à 40 caractères)." });
      if (method !== "bank_transfer") { try { phone = normPhone(b.payerPhone); } catch (e) { return send(res, 400, { error: e.message }); } }
    } else ref = "";
    try { await sql`UPDATE rent_charges SET status = 'declared', method = ${method}, reference = ${ref}, payer_phone = ${phone} WHERE id = ${id} AND status = 'due'`; }
    catch (e) { if (dup(e)) return send(res, 409, { error: "Cette référence de transaction a déjà été utilisée." }); throw e; }
    await notifyAdmins("rent_declared", "Loyer déclaré payé", `${c.name} — ${periodLabel(ch.period)} — ${fmtMoney(ch.amount, ch.currency)} par ${METHOD_LABEL[method]}${ref ? " (réf. " + ref + ")" : ""}`, c.id);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: "Inconnu" });
}
