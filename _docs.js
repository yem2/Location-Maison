// Documents PDF : reçus de paiement et contrats (location, vente, réservation).
import { sql, send, currentUser, currentCustomer, sameOrigin, audit, str, notifyCustomer, encrypt, decrypt } from "./_lib.js";
import { Pdf, amountWords, fmtMoney, fmtDate } from "./_pdf.js";
import { METHOD_LABEL } from "./_pay.js";

export const KINDS = { location: "Contrat de location (bail d’habitation)", vente: "Promesse de vente immobilière", reservation: "Contrat de réservation" };
const DISCLAIMER = "Modèle établi par l’agence. Il doit être relu et adapté par un conseil juridique ; un acte de vente d’immeuble doit être passé devant notaire.";

let docsP;
export function ensureDocs() {
  docsP ??= (async () => {
    try {
      await sql`CREATE TABLE IF NOT EXISTS contracts (
        id bigserial PRIMARY KEY, number text NOT NULL DEFAULT '', order_id bigint NOT NULL, customer_id bigint NOT NULL, kind text NOT NULL,
        data text NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'issued', created_by bigint, created_at timestamptz NOT NULL DEFAULT now())`;
      await sql`CREATE INDEX IF NOT EXISTS contracts_order_idx ON contracts (order_id)`;
      await sql`CREATE INDEX IF NOT EXISTS contracts_customer_idx ON contracts (customer_id)`;
      return true;
    } catch { return false; }
  })().then((ok) => { if (!ok) docsP = null; return ok; });
  return docsP;
}

// ---------- Identité de l'agence (affichée sur les documents) ----------
export const AGENCY_DEFAULT = { name: "Location et vente immobilière", legal: "", address: "", city: "Douala", phone: "", email: "", rccm: "", niu: "", rep: "", repTitle: "Directeur" };
export async function loadAgency() {
  try { const [r] = await sql`SELECT value FROM payment_settings WHERE key = 'agency'`; if (r) return { ...AGENCY_DEFAULT, ...JSON.parse(decrypt(r.value)) }; } catch { /* valeurs par défaut */ }
  return { ...AGENCY_DEFAULT };
}
const clean = (v, max) => str(typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, " ") : "", max);
export async function saveAgency(input, userId) {
  const a = {};
  for (const k of Object.keys(AGENCY_DEFAULT)) { const v = clean(input?.[k], k === "address" ? 200 : 100); a[k] = v || (k === "name" ? AGENCY_DEFAULT.name : ""); }
  await sql`INSERT INTO payment_settings (key, value, updated_by, updated_at) VALUES ('agency', ${encrypt(JSON.stringify(a))}, ${userId}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  return a;
}

function letterhead(agency, title, number) {
  return (d) => {
    d.rect(0, 841.89 - 70, 595.28, 70, [0.04, 0.42, 0.37]);
    d.color(1, 1, 1); d._text(54, 841.89 - 34, agency.name, 16, "F2");
    const sub = [agency.address, agency.phone && "Tél. " + agency.phone, agency.email].filter(Boolean).join("  ·  ");
    if (sub) d._text(54, 841.89 - 52, sub, 8.5, "F1");
    d.color(0.1, 0.12, 0.12); d.y = 841.89 - 100;
    void title; void number;
  };
}
const idLine = (a) => [a.legal, a.rccm && "RCCM " + a.rccm, a.niu && "NIU " + a.niu].filter(Boolean).join(" — ");

// ---------- Reçu de paiement ----------
export function receiptPdf({ agency, p, order, customer }) {
  const year = new Date(p.confirmed_at || p.created_at).getFullYear(), number = `REC-${year}-${String(p.id).padStart(6, "0")}`;
  const d = new Pdf({ title: "Reçu " + number, footer: `${agency.name} — Reçu ${number}`, header: letterhead(agency) });
  d.h1("REÇU DE PAIEMENT");
  d.kv([["Numéro", number], ["Date du paiement", fmtDate(p.confirmed_at || p.created_at)], ["Reçu de", customer.name], ["E-mail", customer.email], ["Téléphone", customer.phone || "—"]]);
  d.box([`Montant reçu : ${fmtMoney(p.amount, p.currency)}`, `Arrêté à la somme de : ${amountWords(p.amount, p.currency)}.`]);
  d.h2("Détail");
  d.kv([["Objet", `Acompte de réservation — ${order.property_title || "bien immobilier"}`], ["Demande n°", String(p.order_id)], ["Moyen de paiement", METHOD_LABEL[p.method] || p.method],
    ["Référence", p.provider_ref || p.reference], ...(p.charged_amount ? [["Montant débité", `${p.charged_amount} ${p.charged_currency}`]] : []), ["Statut", "PAYÉ"]]);
  d.p("Ce reçu atteste que la somme ci-dessus a bien été encaissée par l’agence et enregistrée sur la demande indiquée. Il est généré électroniquement et reste valable sans signature manuscrite.", { size: 9.5, italic: true, color: [0.4, 0.45, 0.45] });
  d.signatures("Pour l’agence", "Le client");
  if (idLine(agency)) d.p(idLine(agency), { size: 8.5, align: "center", color: [0.4, 0.45, 0.45] });
  return { number, buffer: d.build() };
}

// ---------- Contrats ----------
const n = (v) => Math.max(0, Math.round(Number(v) || 0));
const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
export function normalizeParams(kind, p = {}) {
  const base = { city: clean(p.city, 60), date: iso(p.date), notes: clean(p.notes, 800), partyName: clean(p.partyName, 100), partyRep: clean(p.partyRep, 100), clientId: clean(p.clientId, 60), clientAddress: clean(p.clientAddress, 160) };
  if (kind === "location") return { ...base, rent: n(p.rent), charges: n(p.charges), deposit: n(p.deposit), months: n(p.months) || 12, start: iso(p.start), payDay: Math.min(28, n(p.payDay) || 5), notice: n(p.notice) || 1 };
  if (kind === "vente") return { ...base, price: n(p.price), deadline: iso(p.deadline), notary: clean(p.notary, 100), penalty: n(p.penalty), commission: n(p.commission), buyerFees: p.buyerFees !== false && p.buyerFees !== "false" };
  if (kind === "reservation") return { ...base, price: n(p.price), validity: n(p.validity) || 15, refundable: p.refundable !== false && p.refundable !== "false" };
  throw new Error("Type de contrat inconnu.");
}

export function contractPdf({ agency, c, order, customer, property }) {
  const x = JSON.parse(c.data), cur = order.currency || property?.currency || "XAF", city = x.city || agency.city || "";
  const d = new Pdf({ title: `${KINDS[c.kind]} ${c.number}`, footer: `${agency.name} — ${c.number}`, header: letterhead(agency) });
  d.h1(KINDS[c.kind].toUpperCase());
  d.p(`Référence : ${c.number}  ·  Établi le ${fmtDate(x.date || c.created_at)}`, { size: 9.5, color: [0.4, 0.45, 0.45] });
  const bien = [property?.title || order.property_title, property?.location, property?.kind_label, property?.rooms ? property.rooms + " pièces" : "", property?.bedrooms ? property.bedrooms + " chambre(s)" : "", property?.area ? property.area + " m²" : ""].filter(Boolean).join(", ");
  const owner = x.partyName || agency.name, ownerRep = x.partyRep || (agency.rep ? `${agency.rep}, ${agency.repTitle}` : "");
  const client = `${customer.name}${customer.email ? ", e-mail " + customer.email : ""}${customer.phone ? ", tél. " + customer.phone : ""}${x.clientId ? ", pièce d’identité n° " + x.clientId : ""}${x.clientAddress ? ", demeurant à " + x.clientAddress : ""}`;
  const roleA = c.kind === "location" ? "LE BAILLEUR" : c.kind === "vente" ? "LE VENDEUR" : "L’AGENCE / LE PROPRIÉTAIRE", roleB = c.kind === "location" ? "LE PRENEUR" : c.kind === "vente" ? "L’ACQUÉREUR" : "LE CLIENT";
  d.h2("Entre les soussignés");
  d.p(`${roleA} : ${owner}${ownerRep ? ", représenté par " + ownerRep : ""}${idLine(agency) && !x.partyName ? " (" + idLine(agency) + ")" : ""}${agency.address && !x.partyName ? ", " + agency.address : ""}.`, { after: 4 });
  d.p("d’une part, et", { italic: true, after: 4 });
  d.p(`${roleB} : ${client}.`, { after: 4 });
  d.p("d’autre part, il a été convenu ce qui suit.", { italic: true, after: 8 });

  const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  const money = (v) => `${fmtMoney(v, cur)} (${lowerFirst(amountWords(v, cur))})`;
  const paid = order.payment_status === "paid" ? `Un acompte de ${money(order.amount)} a été réglé par le ${roleB.toLowerCase()} et est reçu par l’agence.` : `Un acompte de ${money(order.amount)} est convenu au titre de la réservation.`;
  const sign = () => {
    d.gap(6); d.p(`Fait à ${city || "…………"}, le ${fmtDate(x.date || c.created_at)}, en deux exemplaires originaux.`, { size: 10.5 });
    d.signatures(roleA === "L’AGENCE / LE PROPRIÉTAIRE" ? "L’agence / le propriétaire" : roleA[0] + roleA.slice(1).toLowerCase(), roleB[0] + roleB.slice(1).toLowerCase());
    d.p(DISCLAIMER, { size: 8.5, italic: true, color: [0.45, 0.5, 0.5], after: 0 });
  };
  const notes = () => { if (x.notes) d.clause(`Clauses particulières`, x.notes); };

  if (c.kind === "location") {
    d.clause("Article 1 — Objet", `Le bailleur donne en location au preneur, qui l’accepte, le bien suivant : ${bien}.`);
    d.clause("Article 2 — Destination", "Le bien est loué à usage exclusif d’habitation. Toute activité commerciale ou professionnelle y est interdite sans accord écrit du bailleur.");
    d.clause("Article 3 — Durée", `Le bail est conclu pour une durée de ${x.months} mois à compter du ${fmtDate(x.start) || "…………"}. Il peut être renouvelé par accord écrit des parties.`);
    d.clause("Article 4 — Loyer et charges", `Le loyer mensuel est fixé à ${money(x.rent)}${x.charges ? `, auquel s’ajoutent ${money(x.charges)} de charges mensuelles` : ""}. Il est payable d’avance, au plus tard le ${x.payDay} de chaque mois, auprès de l’agence.`);
    d.clause("Article 5 — Dépôt de garantie", `Le preneur verse un dépôt de garantie de ${money(x.deposit)}. Il est restitué dans un délai d’un mois après la remise des clés et l’état des lieux de sortie, déduction faite des sommes dues et des réparations locatives.`);
    d.clause("Article 6 — Acompte de réservation", `${paid} Il est imputé sur les premières sommes dues au titre du présent bail.`);
    d.clause("Article 7 — État des lieux", "Un état des lieux contradictoire est établi à l’entrée et à la sortie du preneur. À défaut, le bien est présumé remis en bon état d’usage.");
    d.clause("Article 8 — Obligations du preneur", "Le preneur paie le loyer et les charges aux échéances, use paisiblement du bien, l’entretient et effectue les réparations locatives, s’assure contre les risques locatifs (incendie, dégâts des eaux) et ne sous-loue ni ne cède le bail sans accord écrit du bailleur.");
    d.clause("Article 9 — Obligations du bailleur", "Le bailleur délivre un bien en bon état d’usage, en assure la jouissance paisible et réalise les grosses réparations, hors celles causées par le preneur.");
    d.clause("Article 10 — Résiliation", `Chaque partie peut mettre fin au bail à l’échéance moyennant un préavis écrit de ${x.notice} mois. Le bail est résilié de plein droit, après mise en demeure restée sans effet pendant 15 jours, en cas de défaut de paiement du loyer ou de manquement grave aux obligations du preneur.`);
    d.clause("Article 11 — Litiges", `Le présent contrat est soumis au droit applicable au lieu de situation du bien. À défaut d’accord amiable, les tribunaux compétents de ${city || "la juridiction du bien"} sont seuls compétents.`);
    notes(); sign();
  } else if (c.kind === "vente") {
    const balance = Math.max(0, x.price - n(order.amount));
    d.clause("Article 1 — Objet", `Le vendeur promet de vendre à l’acquéreur, qui promet d’acheter, le bien suivant : ${bien}, libre de toute occupation à la date de signature de l’acte authentique.`);
    d.clause("Article 2 — Prix", `La vente est consentie au prix de ${money(x.price)}.`);
    d.clause("Article 3 — Acompte", `${paid} Il s’impute sur le prix. Solde à payer : ${money(balance)}.`);
    d.clause("Article 4 — Acte authentique", `Les parties s’engagent à signer l’acte de vente devant notaire${x.notary ? " (" + x.notary + ")" : ""} au plus tard le ${fmtDate(x.deadline) || "…………"}, contre paiement du solde du prix.`);
    d.clause("Article 5 — Conditions suspensives", "La vente est subordonnée à : (a) la justification par le vendeur d’un titre de propriété régulier ; (b) l’absence d’hypothèque, de saisie ou de charge non déclarée ; (c) l’obtention des autorisations administratives éventuellement nécessaires.");
    d.clause("Article 6 — Garanties du vendeur", "Le vendeur déclare être seul propriétaire du bien, le posséder librement et le garantir contre toute éviction et tout vice caché connu de lui.");
    d.clause("Article 7 — Frais", x.buyerFees ? "Les droits d’enregistrement, les frais et honoraires du notaire sont à la charge de l’acquéreur." : "Les frais de l’acte sont répartis entre les parties conformément à la loi.");
    if (x.commission) d.clause("Article 8 — Commission d’agence", `La commission de l’agence est fixée à ${money(x.commission)}, payable à la signature de l’acte authentique.`);
    d.clause(`Article ${x.commission ? 9 : 8} — Défaillance`, `Si l’acquéreur renonce sans motif légitime ou ne paie pas le solde dans le délai, l’acompte reste acquis au vendeur. Si le vendeur renonce ou ne peut justifier de sa propriété, il restitue l’acompte${x.penalty ? ` et verse en outre ${money(x.penalty)} à titre d’indemnité` : ""}.`);
    d.clause(`Article ${x.commission ? 10 : 9} — Litiges`, `En cas de litige, les parties recherchent une solution amiable ; à défaut, les tribunaux compétents de ${city || "la juridiction du bien"} sont seuls compétents.`);
    notes(); sign();
  } else {
    d.clause("Article 1 — Objet", `Le présent contrat a pour objet la réservation du bien suivant : ${bien}${x.price ? `, au prix de ${money(x.price)}` : ""}.`);
    d.clause("Article 2 — Acompte", `${paid} Moyen de paiement : ${METHOD_LABEL[order.payment_method] || "à préciser"}.`);
    d.clause("Article 3 — Effets", `Pendant ${x.validity} jours à compter de la signature, le bien est retiré de la vente ou de la location au profit du client. À l’issue de ce délai, la réservation devient caduque si le contrat définitif (bail ou promesse de vente) n’est pas signé.`);
    d.clause("Article 4 — Imputation", "En cas de signature du contrat définitif, l’acompte est imputé sur le prix, le loyer ou le dépôt de garantie.");
    d.clause("Article 5 — Remboursement", x.refundable ? "L’acompte est intégralement remboursé si le dossier du client est refusé par le propriétaire ou si le bien n’est plus disponible. Il reste acquis à l’agence si le client se désiste sans motif légitime." : "L’acompte reste acquis à l’agence en cas de désistement du client. Il est remboursé si le propriétaire renonce ou si le bien n’est plus disponible.");
    d.clause("Article 6 — Litiges", `Les parties recherchent une solution amiable ; à défaut, les tribunaux compétents de ${city || "la juridiction du bien"} sont seuls compétents.`);
    notes(); sign();
  }
  return d.build();
}

// ---------- Réponses HTTP ----------
const pdf = (res, name, buf) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).send(buf);
};
export const DOC_ACTIONS = new Set(["receipt", "contract", "mydocs", "contracts", "contract_create", "contract_void", "agency"]);

export async function docsHandler(req, res) {
  await ensureDocs();
  if (req.method !== "GET" && !sameOrigin(req)) return send(res, 403, { error: "Origine refusée" });
  const a = req.query.a, u = await currentUser(req), c = u ? null : await currentCustomer(req);
  if (!u && !c) return send(res, 401, { error: "Connexion requise" });

  if (a === "receipt") {
    const id = Number(req.query.id) || 0;
    const [p] = await sql`SELECT * FROM payments WHERE id = ${id} AND status = 'paid'`;
    if (!p || (c && p.customer_id !== c.id)) return send(res, 404, { error: "Reçu introuvable" });
    const [order] = await sql`SELECT * FROM orders WHERE id = ${p.order_id}`, [customer] = await sql`SELECT name, email, phone FROM customers WHERE id = ${p.customer_id}`;
    const r = receiptPdf({ agency: await loadAgency(), p, order: order || {}, customer: customer || {} });
    return pdf(res, "recu-" + r.number, r.buffer);
  }

  if (a === "contract") {
    const id = Number(req.query.id) || 0;
    const [k] = await sql`SELECT * FROM contracts WHERE id = ${id}`;
    if (!k || (c && (k.customer_id !== c.id || k.status !== "issued"))) return send(res, 404, { error: "Contrat introuvable" });
    const [order] = await sql`SELECT * FROM orders WHERE id = ${k.order_id}`, [customer] = await sql`SELECT name, email, phone FROM customers WHERE id = ${k.customer_id}`;
    const [property] = order?.property_id ? await sql`SELECT title, location, kind_label, rooms, bedrooms, area, currency FROM properties WHERE id = ${order.property_id}` : [];
    return pdf(res, k.number || "contrat-" + k.id, contractPdf({ agency: await loadAgency(), c: k, order: order || {}, customer: customer || {}, property }));
  }

  if (a === "mydocs") {
    if (!c) return send(res, 403, { error: "Réservé aux clients" });
    const receipts = await sql`SELECT p.id, p.order_id, p.method, p.amount, p.currency, p.confirmed_at, o.property_title FROM payments p LEFT JOIN orders o ON o.id = p.order_id WHERE p.customer_id = ${c.id} AND p.status = 'paid' ORDER BY p.confirmed_at DESC LIMIT 50`;
    const contracts = await sql`SELECT k.id, k.number, k.kind, k.created_at, o.property_title FROM contracts k LEFT JOIN orders o ON o.id = k.order_id WHERE k.customer_id = ${c.id} AND k.status = 'issued' ORDER BY k.id DESC LIMIT 50`;
    return send(res, 200, { receipts, contracts: contracts.map((k) => ({ ...k, label: KINDS[k.kind] || k.kind })) });
  }

  // Les actions suivantes sont réservées aux administrateurs.
  if (!u) return send(res, 403, { error: "Accès refusé" });
  const sup = u.role === "super_admin";

  if (a === "contracts" && req.method === "GET") {
    const rows = await sql`SELECT k.id, k.number, k.kind, k.status, k.created_at, k.order_id, o.property_title, c.name AS customer_name, c.email AS customer_email
      FROM contracts k LEFT JOIN orders o ON o.id = k.order_id LEFT JOIN customers c ON c.id = k.customer_id ORDER BY k.id DESC LIMIT 200`;
    const orders = await sql`SELECT o.id, o.property_title, o.amount, o.currency, o.payment_status, o.status, o.property_id, c.name AS customer_name, p.price, p.operation
      FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN properties p ON p.id = o.property_id WHERE o.status = 'confirmed' ORDER BY o.id DESC LIMIT 200`;
    return send(res, 200, { rows: rows.map((r) => ({ ...r, label: KINDS[r.kind] || r.kind })), orders, kinds: KINDS, agency: await loadAgency() });
  }

  if (a === "agency" && req.method === "POST") {
    if (!sup) return send(res, 403, { error: "Réservé au super administrateur" });
    const ag = await saveAgency(req.body, u.id);
    await audit(u.id, "agency.update", ag.name);
    return send(res, 200, { agency: ag });
  }

  if (a === "contract_create" && req.method === "POST") {
    const b = req.body || {}, kind = String(b.kind || "");
    if (!Object.hasOwn(KINDS, kind)) return send(res, 400, { error: "Type de contrat inconnu." });
    const [o] = await sql`SELECT id, customer_id, property_title, status FROM orders WHERE id = ${Number(b.orderId) || 0}`;
    if (!o || o.status !== "confirmed") return send(res, 400, { error: "Choisissez une demande acceptée." });
    let params; try { params = normalizeParams(kind, b.params); } catch (e) { return send(res, 400, { error: e.message }); }
    if (kind === "location" && !params.rent) return send(res, 400, { error: "Indiquez le loyer mensuel." });
    if (kind === "vente" && !params.price) return send(res, 400, { error: "Indiquez le prix de vente." });
    const [k] = await sql`INSERT INTO contracts (order_id, customer_id, kind, data, created_by) VALUES (${o.id}, ${o.customer_id}, ${kind}, ${JSON.stringify(params)}, ${u.id}) RETURNING id, created_at`;
    const number = `CTR-${new Date(k.created_at).getFullYear()}-${String(k.id).padStart(5, "0")}`;
    await sql`UPDATE contracts SET number = ${number} WHERE id = ${k.id}`;
    await audit(u.id, "contract.create", `${number} (${kind})`);
    await notifyCustomer(o.customer_id, `Votre ${KINDS[kind].toLowerCase()} pour « ${o.property_title} » est disponible dans « Mes demandes › Documents ».`);
    return send(res, 200, { id: k.id, number });
  }

  if (a === "contract_void" && req.method === "POST") {
    if (!sup) return send(res, 403, { error: "Réservé au super administrateur" });
    const [k] = await sql`UPDATE contracts SET status = 'void' WHERE id = ${Number(req.body?.id) || 0} AND status = 'issued' RETURNING number`;
    if (!k) return send(res, 404, { error: "Contrat introuvable" });
    await audit(u.id, "contract.void", k.number);
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: "Inconnu" });
}
