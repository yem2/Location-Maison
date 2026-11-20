// Gestion : incidents (maintenance), propriétaires + relevés mensuels (PDF), statistiques.
// Appelé par api/orders.js pour les actions « ticket_ », « owner_ » et « stats_ ».
import { sql, send, requireUser, requireCustomer, throttle, audit, notifyAdmins, notifyCustomer, str } from "./_lib.js";
import { Pdf, fmtMoney, fmtDate } from "./_pdf.js";
import { loadAgency, letterhead, idLine } from "./_docs.js";
import { METHOD_LABEL, csvCell } from "./_pay.js";
import { localNow } from "./_visits.js";
import { periodLabel } from "./_rent.js";

// ---------- Calcul du relevé (testé) ----------
// lignes = loyers encaissés ; la commission est arrondie au franc ; net = brut − commission
export function statementTotals(amounts, pct) {
  const gross = amounts.reduce((s, a) => s + Number(a || 0), 0), p = Math.min(50, Math.max(0, Number(pct) || 0));
  const commission = Math.round((gross * p) / 100);
  return { gross, commission, net: gross - commission, pct: p };
}
export const validPeriod = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || ""));

// ---------- Base de données ----------
let mgmtP;
export function ensureManage() {
  mgmtP ??= (async () => {
    try {
      await sql`CREATE TABLE IF NOT EXISTS tickets (
        id serial PRIMARY KEY, customer_id bigint NOT NULL, lease_id int, property_title text NOT NULL DEFAULT '', title text NOT NULL, description text NOT NULL DEFAULT '',
        category text NOT NULL DEFAULT 'autre', priority text NOT NULL DEFAULT 'normal', status text NOT NULL DEFAULT 'open', photo text NOT NULL DEFAULT '',
        admin_note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz)`;
      await sql`CREATE INDEX IF NOT EXISTS tickets_customer_idx ON tickets (customer_id)`;
      await sql`CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (status, created_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS owners (
        id serial PRIMARY KEY, name text NOT NULL, phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', commission_pct numeric NOT NULL DEFAULT 10,
        notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now())`;
      await sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_id int`;
      await sql`CREATE TABLE IF NOT EXISTS owner_payouts (
        id serial PRIMARY KEY, owner_id int NOT NULL, period text NOT NULL, currency text NOT NULL, gross numeric NOT NULL, commission numeric NOT NULL, net numeric NOT NULL,
        method text NOT NULL DEFAULT '', reference text NOT NULL DEFAULT '', paid_by bigint, paid_at timestamptz NOT NULL DEFAULT now(), UNIQUE (owner_id, period, currency))`;
      return true;
    } catch { return false; }
  })().then((ok) => { if (!ok) mgmtP = null; return ok; });
  return mgmtP;
}

const CATS = ["plomberie", "electricite", "serrure", "humidite", "toiture", "internet", "autre"];
const TSTATUS = ["open", "in_progress", "resolved", "closed"];
const TLABEL = { open: "Ouvert", in_progress: "En cours", resolved: "Résolu", closed: "Clos" };

// Lignes d'encaissement d'un propriétaire pour un mois (loyers payés dans le mois)
async function statementRows(ownerId, period) {
  return sql`SELECT c.id, c.period, c.amount, c.currency, c.paid_at, l.property_title, cu.name AS customer
    FROM rent_charges c JOIN leases l ON l.id = c.lease_id JOIN properties p ON p.id = l.property_id LEFT JOIN customers cu ON cu.id = l.customer_id
    WHERE p.owner_id = ${ownerId} AND c.status = 'paid' AND to_char(c.paid_at AT TIME ZONE 'Africa/Douala', 'YYYY-MM') = ${period} ORDER BY c.paid_at, c.id`;
}
function groupByCurrency(rows, pct) {
  const by = new Map();
  for (const r of rows) { if (!by.has(r.currency)) by.set(r.currency, []); by.get(r.currency).push(r); }
  return [...by.entries()].map(([currency, lines]) => ({ currency, lines, ...statementTotals(lines.map((l) => l.amount), pct) }));
}

export function statementPdf({ agency, owner, period, g, payout }) {
  const d = new Pdf({ title: `Relevé propriétaire ${period}`, footer: `${agency.name} — Relevé ${owner.name} — ${period}`, header: letterhead(agency) });
  d.h1("RELEVÉ DE GÉRANCE");
  d.kv([["Propriétaire", owner.name], ["Période (encaissements)", periodLabel(period)], ["Taux de commission", `${g.pct} %`], ["Établi le", fmtDate(new Date())]]);
  d.h2("Loyers encaissés");
  d.table([{ h: "Payé le", w: 0.15 }, { h: "Loyer de", w: 0.17 }, { h: "Locataire", w: 0.22 }, { h: "Bien", w: 0.26 }, { h: "Montant", w: 0.2, align: "right" }],
    g.lines.map((l) => [fmtDate(l.paid_at), periodLabel(l.period), l.customer || "—", l.property_title || "—", fmtMoney(l.amount, g.currency)]));
  d.table([{ h: "Récapitulatif", w: 0.7 }, { h: "Montant", w: 0.3, align: "right" }],
    [["Total encaissé", fmtMoney(g.gross, g.currency)], [`Commission de l’agence (${g.pct} %)`, "– " + fmtMoney(g.commission, g.currency)], { bold: true, cells: ["NET À REVERSER AU PROPRIÉTAIRE", fmtMoney(g.net, g.currency)] }]);
  d.box([payout ? `Reversé le ${fmtDate(payout.paid_at)} — ${METHOD_LABEL[payout.method] || payout.method || "—"}${payout.reference ? " — réf. " + payout.reference : ""}` : "Reversement : en attente"], { fill: payout ? [0.9, 0.96, 0.94] : [0.99, 0.95, 0.88], size: 10.5 });
  if (idLine(agency)) d.p(idLine(agency), { size: 8.5, align: "center", color: [0.4, 0.45, 0.45] });
  return d.build();
}

const pdfOut = (res, name, buf) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).send(buf);
};

// ---------- Gestionnaire HTTP ----------
export async function manageHandler(req, res) {
  const a = req.query.a;
  if (!(await ensureManage())) return send(res, 503, { error: "Module momentanément indisponible." });

  // ===== Client : signaler un incident =====
  if (a === "ticket_mine" || a === "ticket_create") {
    const c = await requireCustomer(req, res);
    if (!c) return;
    if (a === "ticket_mine") {
      const rows = await sql`SELECT id, property_title, title, description, category, priority, status, photo, admin_note, created_at, updated_at FROM tickets WHERE customer_id = ${c.id} ORDER BY id DESC LIMIT 50`;
      return send(res, 200, { tickets: rows });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Méthode refusée" });
    if (!(await throttle(req, res, "ticket", 6, 3600))) return;
    const b = req.body || {}, title = str(b.title, 120), description = str(b.description, 1200), category = CATS.includes(b.category) ? b.category : "autre";
    if (title.length < 4) return send(res, 400, { error: "Donnez un titre clair (4 caractères minimum)." });
    if (description.length < 10) return send(res, 400, { error: "Décrivez le problème (10 caractères minimum)." });
    const photo = typeof b.photo === "string" && /^\/api\/image\?id=[a-f0-9]{32}$/.test(b.photo) ? b.photo : "";
    let leaseId = null, property = "";
    if (b.leaseId) { const [l] = await sql`SELECT id, property_title FROM leases WHERE id = ${Number(b.leaseId) || 0} AND customer_id = ${c.id}`; if (l) { leaseId = l.id; property = l.property_title; } }
    const urgent = b.priority === "urgent";
    const [t] = await sql`INSERT INTO tickets (customer_id, lease_id, property_title, title, description, category, priority, photo) VALUES (${c.id}, ${leaseId}, ${property}, ${title}, ${description}, ${category}, ${urgent ? "urgent" : "normal"}, ${photo}) RETURNING id`;
    await notifyAdmins("ticket", urgent ? "🚨 Incident URGENT signalé" : "Incident signalé", `${c.name} — ${property || "logement"} : ${title}`, c.id);
    return send(res, 200, { id: t.id });
  }

  // ===== Administration =====
  const u = await requireUser(req, res);
  if (!u) return;
  const sup = u.role === "super_admin";

  if (a === "ticket_admin") {
    const scope = req.query.scope === "all" ? "all" : "open";
    const rows = await sql`SELECT t.id, t.property_title, t.title, t.description, t.category, t.priority, t.status, t.photo, t.admin_note, t.created_at, t.updated_at, c.name AS customer_name, c.phone AS customer_phone
      FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id WHERE (${scope} = 'all' OR t.status IN ('open', 'in_progress'))
      ORDER BY (t.priority = 'urgent' AND t.status IN ('open', 'in_progress')) DESC, t.id DESC LIMIT 200`;
    return send(res, 200, { tickets: rows });
  }
  if (a === "ticket_set" && req.method === "POST") {
    const b = req.body || {}, status = TSTATUS.includes(b.status) ? b.status : null;
    if (!status) return send(res, 400, { error: "Statut invalide." });
    const [t] = await sql`UPDATE tickets SET status = ${status}, admin_note = ${str(b.adminNote, 400)}, updated_at = now(), resolved_at = CASE WHEN ${status} IN ('resolved', 'closed') THEN now() ELSE NULL END
      WHERE id = ${Number(b.id) || 0} RETURNING customer_id, title, admin_note`;
    if (!t) return send(res, 404, { error: "Incident introuvable." });
    await audit(u.id, "ticket.set", `#${b.id} ${status}`);
    await notifyCustomer(t.customer_id, `Votre incident « ${t.title} » est maintenant : ${TLABEL[status]}.${t.admin_note ? " Message de l’agence : " + t.admin_note : ""}`);
    return send(res, 200, { ok: true });
  }

  // ----- Propriétaires et relevés : réservés au super administrateur (montants, commissions) -----
  if (a.startsWith("owner_") && !sup) return send(res, 403, { error: "Réservé au super administrateur" });
  if (a === "owner_list") {
    const owners = await sql`SELECT o.id, o.name, o.phone, o.email, o.commission_pct, o.notes, (SELECT count(*)::int FROM properties p WHERE p.owner_id = o.id) AS props FROM owners o ORDER BY o.name`;
    const properties = await sql`SELECT id, title, owner_id FROM properties WHERE COALESCE(archived, false) = false ORDER BY title LIMIT 500`;
    return send(res, 200, { owners, properties });
  }
  if (a === "owner_statement" || a === "owner_statement_pdf") {
    const ownerId = Number(req.query.owner) || 0, period = String(req.query.period || localNow().date.slice(0, 7));
    if (!validPeriod(period)) return send(res, 400, { error: "Période invalide (AAAA-MM)." });
    const [owner] = await sql`SELECT id, name, commission_pct FROM owners WHERE id = ${ownerId}`;
    if (!owner) return send(res, 404, { error: "Propriétaire introuvable." });
    const groups = groupByCurrency(await statementRows(ownerId, period), owner.commission_pct);
    const payouts = await sql`SELECT currency, method, reference, paid_at, net FROM owner_payouts WHERE owner_id = ${ownerId} AND period = ${period}`;
    const withPay = groups.map((g) => ({ ...g, payout: payouts.find((p) => p.currency === g.currency) || null }));
    if (a === "owner_statement") return send(res, 200, { owner, period, groups: withPay });
    const g = withPay.find((x) => x.currency === String(req.query.currency || "XAF")) || withPay[0];
    if (!g) return send(res, 404, { error: "Aucun loyer encaissé pour cette période." });
    return pdfOut(res, `releve-${owner.name}-${period}`, statementPdf({ agency: await loadAgency(), owner, period, g, payout: g.payout }));
  }
  if (a === "stats_export" && !sup) return send(res, 403, { error: "Réservé au super administrateur" });
  if (a === "owner_save" && req.method === "POST") {
    const b = req.body || {}, name = str(b.name, 100), pct = Math.min(50, Math.max(0, Number(b.commissionPct)));
    if (!name) return send(res, 400, { error: "Indiquez le nom du propriétaire." });
    if (!(pct >= 0)) return send(res, 400, { error: "Commission invalide (0 à 50 %)." });
    if (b.id) { const [o] = await sql`UPDATE owners SET name = ${name}, phone = ${str(b.phone, 30)}, email = ${str(b.email, 120)}, commission_pct = ${pct}, notes = ${str(b.notes, 300)} WHERE id = ${Number(b.id) || 0} RETURNING id`; if (!o) return send(res, 404, { error: "Introuvable." }); await audit(u.id, "owner.update", name); return send(res, 200, { id: o.id }); }
    const [o] = await sql`INSERT INTO owners (name, phone, email, commission_pct, notes) VALUES (${name}, ${str(b.phone, 30)}, ${str(b.email, 120)}, ${pct}, ${str(b.notes, 300)}) RETURNING id`;
    await audit(u.id, "owner.create", name); return send(res, 200, { id: o.id });
  }
  if (a === "owner_delete" && req.method === "POST") {
    const id = Number(req.body?.id) || 0, [k] = await sql`SELECT count(*)::int AS n FROM properties WHERE owner_id = ${id}`;
    if (k.n) return send(res, 409, { error: "Ce propriétaire a encore des biens : retirez-les d’abord." });
    await sql`DELETE FROM owners WHERE id = ${id}`; await audit(u.id, "owner.delete", String(id)); return send(res, 200, { ok: true });
  }
  if (a === "owner_assign" && req.method === "POST") {
    const ownerId = req.body?.ownerId ? Number(req.body.ownerId) : null;
    await sql`UPDATE properties SET owner_id = ${ownerId} WHERE id = ${str(req.body?.propertyId, 80)}`;
    await audit(u.id, "owner.assign", `${req.body?.propertyId} → ${ownerId}`); return send(res, 200, { ok: true });
  }
  if (a === "owner_payout" && req.method === "POST") {
    const b = req.body || {}, ownerId = Number(b.ownerId) || 0, period = String(b.period || ""), currency = String(b.currency || "XAF").toUpperCase().slice(0, 3);
    if (!validPeriod(period)) return send(res, 400, { error: "Période invalide." });
    const [owner] = await sql`SELECT commission_pct FROM owners WHERE id = ${ownerId}`;
    if (!owner) return send(res, 404, { error: "Propriétaire introuvable." });
    const g = groupByCurrency(await statementRows(ownerId, period), owner.commission_pct).find((x) => x.currency === currency);
    if (!g || g.net <= 0) return send(res, 400, { error: "Rien à reverser pour cette période." });
    const method = Object.hasOwn(METHOD_LABEL, b.method) ? b.method : "cash";
    try { await sql`INSERT INTO owner_payouts (owner_id, period, currency, gross, commission, net, method, reference, paid_by) VALUES (${ownerId}, ${period}, ${currency}, ${g.gross}, ${g.commission}, ${g.net}, ${method}, ${str(b.reference, 60)}, ${u.id})`; }
    catch (e) { if (String(e?.code) === "23505") return send(res, 409, { error: "Ce relevé est déjà marqué comme reversé." }); throw e; }
    await audit(u.id, "owner.payout", `${ownerId} ${period} ${g.net} ${currency}`);
    return send(res, 200, { ok: true });
  }

  // ----- Statistiques -----
  if (a === "stats_overview") {
    const currency = /^[A-Z]{3}$/.test(String(req.query.currency || "")) ? req.query.currency : "XAF";
    const q = (p) => p.catch(() => []);
    const [series, top, snap, cur] = await Promise.all([
      q(sql`SELECT to_char(m, 'YYYY-MM') AS p,
          (SELECT count(*)::int FROM orders o WHERE date_trunc('month', o.created_at) = m) AS requests,
          (SELECT count(*)::int FROM visits v WHERE date_trunc('month', v.visit_date) = m AND v.status IN ('confirmed', 'done')) AS visits,
          (SELECT count(*)::int FROM customers c WHERE date_trunc('month', c.created_at) = m) AS customers,
          (SELECT COALESCE(sum(p.amount), 0)::float FROM payments p WHERE p.status = 'paid' AND p.currency = ${currency} AND date_trunc('month', p.confirmed_at) = m) AS deposits,
          (SELECT COALESCE(sum(r.amount), 0)::float FROM rent_charges r WHERE r.status = 'paid' AND r.currency = ${currency} AND date_trunc('month', r.paid_at) = m) AS rent
        FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') AS m ORDER BY m`),
      q(sql`SELECT COALESCE(o.t, v.t) AS title, COALESCE(o.n, 0) AS requests, COALESCE(v.n, 0) AS visits FROM (SELECT property_title AS t, count(*)::int AS n FROM orders GROUP BY 1) o
          FULL JOIN (SELECT property_title AS t, count(*)::int AS n FROM visits GROUP BY 1) v ON v.t = o.t ORDER BY COALESCE(o.n, 0) + COALESCE(v.n, 0) DESC LIMIT 8`),
      q(sql`SELECT (SELECT count(*)::int FROM properties WHERE COALESCE(archived, false) = false AND COALESCE(published, true)) AS properties, (SELECT count(*)::int FROM customers) AS customers,
          (SELECT count(*)::int FROM orders WHERE status = 'pending') AS pending_requests, (SELECT count(*)::int FROM visits WHERE status = 'requested') AS pending_visits,
          (SELECT count(*)::int FROM leases WHERE status = 'active') AS active_leases, (SELECT count(*)::int FROM tickets WHERE status IN ('open', 'in_progress')) AS open_tickets,
          (SELECT COALESCE(sum(amount), 0)::float FROM rent_charges WHERE status = 'due' AND due_date < current_date AND currency = ${currency}) AS overdue,
          (SELECT count(*)::int FROM contracts WHERE status = 'issued') AS contracts`),
      q(sql`SELECT DISTINCT currency FROM (SELECT currency FROM payments UNION SELECT currency FROM rent_charges) x ORDER BY 1`)
    ]);
    return send(res, 200, { currency, currencies: cur.map((x) => x.currency), series, top, snapshot: snap[0] || {} });
  }
  if (a === "stats_export") {
    const rows = await sql`SELECT to_char(m, 'YYYY-MM') AS p, (SELECT count(*)::int FROM orders o WHERE date_trunc('month', o.created_at) = m) AS demandes,
        (SELECT count(*)::int FROM visits v WHERE date_trunc('month', v.visit_date) = m AND v.status IN ('confirmed', 'done')) AS visites
      FROM generate_series(date_trunc('month', now()) - interval '23 months', date_trunc('month', now()), interval '1 month') AS m ORDER BY m`;
    await audit(u.id, "stats.export", String(rows.length));
    res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", 'attachment; filename="statistiques.csv"');
    return res.status(200).send("\ufeff" + ["mois;demandes;visites", ...rows.map((r) => [r.p, r.demandes, r.visites].map(csvCell).join(";"))].join("\r\n"));
  }
  return send(res, 404, { error: "Inconnu" });
}
