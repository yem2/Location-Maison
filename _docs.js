import { createPdf } from "./_pdf.js";

// ---------- Informations de l'agence (variables Vercel, toutes facultatives) ----------
export function company() {
  return {
    name: process.env.COMPANY_NAME || "Gestion Immobilière",
    address: process.env.COMPANY_ADDRESS || "",
    phone: process.env.COMPANY_PHONE || "",
    email: process.env.COMPANY_EMAIL || process.env.MAIL_REPLY || "",
    legal: process.env.COMPANY_LEGAL || "" // ex. RCCM, NIU, SIRET
  };
}
export const SITE_TZ = () => process.env.SITE_TZ || "Africa/Douala";

const GREEN = [22, 118, 110], GREY = [100, 115, 109];
const clean = (s) => String(s == null ? "" : s).replace(/[\u202f\u00a0]/g, " ");
export const fmtNumber = (n) => clean(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(Number(n) || 0));
const SYM = { XAF: "FCFA", XOF: "FCFA", EUR: "€", USD: "$", GBP: "£", MAD: "DH", CAD: "CA$", CHF: "CHF", AED: "AED" };
export const money = (n, cur) => `${fmtNumber(n)} ${SYM[cur] || cur || ""}`.trim();
export const fmtDate = (d, withTime = false) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "—";
  return clean(dt.toLocaleString("fr-FR", { timeZone: SITE_TZ(), day: "2-digit", month: "long", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }));
};
const METHOD = { cash: "Espèces à l’agence", card: "Carte bancaire", orange_money: "Orange Money", mtn_momo: "MTN Mobile Money", paypal: "PayPal", bank_transfer: "Virement bancaire", other: "Autre moyen" };
export const methodName = (k) => METHOD[k] || k || "—";

export const receiptNo = (p) => {
  const y = new Date(p.confirmed_at || p.created_at || Date.now()).getFullYear();
  return p.legacy ? `R-${y}-O${p.order_id}` : `R-${y}-${String(p.id).padStart(6, "0")}`;
};

function letterhead(doc, co, subtitle) {
  doc.rect(0, 841.89 - 12, 595.28, 12, { fill: GREEN });
  doc.text(doc.margin, doc.y - 14, co.name, { size: 22, bold: true, color: GREEN });
  let yy = doc.y - 28;
  for (const l of [co.address, [co.phone, co.email].filter(Boolean).join(" · "), co.legal].filter(Boolean)) { doc.text(doc.margin, yy, l, { size: 8.5, color: GREY }); yy -= 11; }
  doc.y = yy - 4;
  doc.rule({ before: 2, after: 10 });
  if (subtitle) doc.para(subtitle, { size: 17, bold: true, after: 8 });
}

// ---------- Reçu de paiement ----------
export function buildReceipt({ payment: p, order: o, customer: c }) {
  const co = company();
  const no = receiptNo(p);
  const doc = createPdf({ title: `Reçu ${no}`, author: co.name, footerLeft: `${co.name} — reçu ${no}` });
  letterhead(doc, co, "REÇU DE PAIEMENT");
  doc.kv([["Reçu n°", no], ["Date du paiement", fmtDate(p.confirmed_at || p.created_at, true)], ["Statut", "Payé"]]);
  doc.heading("Reçu de");
  doc.kv([["Client", c.name], ["E-mail", c.email], ["Téléphone", c.phone || "—"]]);
  doc.heading("Objet du paiement");
  doc.kv([["Bien concerné", o.property_title || "—"], ["Nature", "Acompte de réservation"], ["Moyen de paiement", methodName(p.kind)],
    ["Référence", p.payer_ref || p.provider_ref || p.reference || "—"]]);
  doc.gap(8);
  doc.need(70);
  const top = doc.y;
  doc.rect(doc.margin, top - 58, doc.maxW, 58, { fill: [240, 247, 245], stroke: [200, 220, 214] });
  doc.text(doc.margin + 14, top - 22, "MONTANT REÇU", { size: 9, bold: true, color: GREY });
  doc.text(doc.margin + 14, top - 46, money(p.amount, p.currency), { size: 24, bold: true, color: GREEN });
  doc.y = top - 70;
  doc.para(`Nous reconnaissons avoir reçu la somme de ${money(p.amount, p.currency)} au titre de l’acompte de réservation du bien désigné ci-dessus. Ce reçu atteste du paiement ; il ne vaut pas contrat de location ou de vente.`, { size: 10, color: GREY, after: 14 });
  doc.para("Fait pour servir et valoir ce que de droit.", { size: 10, italic: true });
  doc.gap(26);
  doc.para(co.name, { size: 10, bold: true, align: "right", after: 2 });
  doc.para("Document généré automatiquement, valable sans signature.", { size: 8.5, color: GREY, align: "right" });
  return doc.build();
}

// ---------- Contrats (modèles indicatifs, pré-remplis) ----------
const DOTS = "...............................";
const DISCLAIMER = "Modèle indicatif généré automatiquement. Les clauses sont à adapter à la situation et à la législation locale : faites relire ce document par un notaire ou un juriste avant signature.";

export function buildContract({ order: o, property: pr, customer: c, paid }) {
  const co = company();
  const rent = pr && pr.operation === "rent";
  const doc = createPdf({ title: rent ? "Contrat de location" : "Promesse de vente", author: co.name, footerLeft: `${co.name} — ${rent ? "contrat de location" : "promesse de vente"} — modèle à valider avant signature` });
  letterhead(doc, co, rent ? "CONTRAT DE LOCATION (BAIL D’HABITATION)" : "PROMESSE DE VENTE");
  doc.para(DISCLAIMER, { size: 8.5, italic: true, color: GREY, after: 8 });

  const title = (pr && pr.title) || o.property_title || "—";
  const place = pr && pr.location ? pr.location : "";
  const kind = pr && pr.kind_label ? pr.kind_label : "Bien immobilier";
  const feat = pr ? [pr.rooms ? `${pr.rooms} pièce(s)` : "", pr.bedrooms ? `${pr.bedrooms} chambre(s)` : "", pr.bathrooms ? `${pr.bathrooms} salle(s) de bain` : "", pr.area ? `${pr.area} m²` : ""].filter(Boolean).join(", ") : "";
  const price = pr ? money(pr.price, pr.currency) + (pr.price_suffix ? " " + pr.price_suffix : rent ? " / mois" : "") : "";
  const dep = Number(o.amount) > 0 ? money(o.amount, o.currency) : "";

  doc.heading("Article 1 — Parties");
  if (rent) {
    doc.para(`LE BAILLEUR : ${co.name}${co.address ? ", " + co.address : ""}, agissant en qualité de mandataire du propriétaire. Propriétaire : ${DOTS}`, { indent: 10 });
    doc.para(`LE LOCATAIRE : ${c.name}, e-mail ${c.email}${c.phone ? ", téléphone " + c.phone : ""}. Pièce d’identité n° ${DOTS}`, { indent: 10 });
  } else {
    doc.para(`LE PROMETTANT (vendeur) : ${DOTS}, représenté par ${co.name}${co.address ? ", " + co.address : ""}, en qualité de mandataire.`, { indent: 10 });
    doc.para(`LE BÉNÉFICIAIRE (acquéreur) : ${c.name}, e-mail ${c.email}${c.phone ? ", téléphone " + c.phone : ""}. Pièce d’identité n° ${DOTS}`, { indent: 10 });
  }
  doc.heading("Article 2 — Désignation du bien");
  doc.para(`${kind} « ${title} »${place ? ", situé à " + place : ""}${feat ? " (" + feat + ")" : ""}. Adresse précise et références cadastrales : ${DOTS}`, { indent: 10 });

  let n = 3;
  if (rent) {
    doc.heading(`Article ${n++} — Durée`);
    doc.para(`Le bail est conclu pour une durée de ${DOTS} mois, à compter du ${DOTS}, renouvelable par accord exprès des parties.`, { indent: 10 });
    doc.heading(`Article ${n++} — Loyer et charges`);
    doc.para(`Le loyer est fixé à ${price || DOTS}, payable d’avance au plus tard le ${DOTS} de chaque mois. Charges mensuelles : ${DOTS}. Toute révision du loyer doit faire l’objet d’un avenant écrit.`, { indent: 10 });
    doc.heading(`Article ${n++} — Acompte et dépôt de garantie`);
    doc.para(dep
      ? `Un acompte de ${dep} ${paid ? "a été versé le " + fmtDate(paid.confirmed_at || paid.created_at) + (paid.receiptNo ? " (reçu n° " + paid.receiptNo + ")" : "") : "est à verser avant la remise des clés"}. Il sera imputé sur ${DOTS} (premier loyer / dépôt de garantie). Dépôt de garantie total : ${DOTS}, restitué à la sortie du locataire sous déduction des sommes dues.`
      : `Dépôt de garantie : ${DOTS}, restitué à la sortie du locataire sous déduction des sommes dues.`, { indent: 10 });
    doc.heading(`Article ${n++} — Obligations du locataire`);
    doc.para("Le locataire utilise le bien à usage d’habitation, paie le loyer et les charges aux échéances, entretient le logement, souscrit une assurance couvrant les risques locatifs et ne sous-loue ni ne cède le bail sans accord écrit du bailleur.", { indent: 10 });
    doc.heading(`Article ${n++} — Obligations du bailleur`);
    doc.para("Le bailleur délivre le bien en bon état d’usage, en assure la jouissance paisible et prend en charge les réparations qui ne sont pas locatives.", { indent: 10 });
    doc.heading(`Article ${n++} — État des lieux`);
    doc.para("Un état des lieux contradictoire est établi à l’entrée et à la sortie du locataire et annexé au présent contrat.", { indent: 10 });
    doc.heading(`Article ${n++} — Résiliation`);
    doc.para(`Chaque partie peut résilier le bail moyennant un préavis de ${DOTS} mois notifié par écrit. Le défaut de paiement du loyer après mise en demeure restée sans effet pendant ${DOTS} jours permet au bailleur de demander la résiliation.`, { indent: 10 });
  } else {
    doc.heading(`Article ${n++} — Prix`);
    doc.para(`Le prix de vente est fixé à ${price || DOTS}, payable comptant à la signature de l’acte authentique, sauf accord contraire écrit.`, { indent: 10 });
    doc.heading(`Article ${n++} — Acompte`);
    doc.para(dep
      ? `Un acompte de ${dep} ${paid ? "a été versé le " + fmtDate(paid.confirmed_at || paid.created_at) + (paid.receiptNo ? " (reçu n° " + paid.receiptNo + ")" : "") : "est à verser à la signature des présentes"}. Il s’impute sur le prix de vente. Il est restitué au bénéficiaire si une condition suspensive ne se réalise pas.`
      : `Un acompte de ${DOTS} est versé à la signature des présentes ; il s’impute sur le prix de vente.`, { indent: 10 });
    doc.heading(`Article ${n++} — Conditions suspensives`);
    doc.para("La vente est subordonnée : à l’obtention éventuelle du financement par le bénéficiaire ; à la justification de la propriété et de l’absence de charge, hypothèque ou litige sur le bien ; et aux autorisations administratives requises.", { indent: 10 });
    doc.heading(`Article ${n++} — Réalisation`);
    doc.para(`L’acte authentique sera signé devant notaire au plus tard le ${DOTS}. Les frais d’acte et de mutation sont à la charge de ${DOTS}, sauf convention contraire.`, { indent: 10 });
    doc.heading(`Article ${n++} — Défaut d’une partie`);
    doc.para(`Si le bénéficiaire renonce sans motif légitime, l’acompte reste acquis au promettant à titre d’indemnité. Si le promettant refuse de vendre, il restitue l’acompte et verse une indemnité de ${DOTS}.`, { indent: 10 });
  }
  doc.heading(`Article ${n++} — Droit applicable et litiges`);
  doc.para("Le présent contrat est soumis à la législation en vigueur dans le pays où se situe le bien. Les parties recherchent d’abord une solution amiable ; à défaut, les tribunaux compétents du lieu du bien sont seuls compétents.", { indent: 10 });

  doc.gap(12);
  doc.need(110);
  doc.para(`Fait à ${DOTS}, le ${DOTS}, en deux exemplaires originaux.`, { size: 10, after: 16 });
  const top = doc.y, half = doc.maxW / 2;
  doc.text(doc.margin, top - 10, rent ? "Le bailleur (ou son mandataire)" : "Le promettant (ou son mandataire)", { size: 10, bold: true });
  doc.text(doc.margin + half, top - 10, rent ? "Le locataire" : "Le bénéficiaire", { size: 10, bold: true });
  doc.text(doc.margin, top - 24, "Lu et approuvé, bon pour accord", { size: 8.5, italic: true, color: GREY });
  doc.text(doc.margin + half, top - 24, "Lu et approuvé, bon pour accord", { size: 8.5, italic: true, color: GREY });
  doc.rect(doc.margin, top - 92, half - 14, 60, { stroke: [200, 210, 206] });
  doc.rect(doc.margin + half, top - 92, half - 14, 60, { stroke: [200, 210, 206] });
  doc.y = top - 100;
  return doc.build();
}

// ---------- Export CSV (Excel français : séparateur « ; », encodage UTF-8 avec BOM) ----------
export function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise l'injection de formules dans Excel
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCsv = (headers, rows) => "\ufeff" + [headers, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
export const localStamp = (d) => (d ? new Date(d).toLocaleString("sv-SE", { timeZone: SITE_TZ() }).slice(0, 16) : "");
