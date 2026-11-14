// Reçus de paiement et contrats (PDF), identité de l'agence.
// Appelé par api/payments.js (fichier « _ » : ce n'est pas une fonction Vercel supplémentaire).
// Le PDF est généré ici même, sans dépendance externe (polices standard Helvetica / Helvetica-Bold).
import { sql, send, requireUser, requireCustomer, currentUser, currentCustomer, sameOrigin, audit, str, notifyCustomer } from "./_lib.js";

export const DOC_ACTIONS = new Set(["agency", "contract", "contract_create", "contract_void", "contracts", "mydocs", "receipt"]);
export const KINDS = { location: "Contrat de bail", vente: "Promesse de vente", reservation: "Contrat de réservation" };
const PREFIX = { location: "BAIL", vente: "PROM", reservation: "RESA" };
const METHOD_LABEL = { cash: "Espèces", orange_money: "Orange Money", mtn_money: "MTN Mobile Money", card: "Carte Visa / Mastercard", paypal: "PayPal", bank_transfer: "Virement bancaire" };

// ====================================================================================================
// Mise en forme
// ====================================================================================================
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export function fdate(v) {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${Number(v.slice(8, 10))} ${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}`;
  const d = new Date(v);
  if (isNaN(d)) return "";
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: process.env.SITE_TZ || "Africa/Douala", day: "numeric", month: "numeric", year: "numeric" }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}`;
  } catch { return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
}
export function money(n, cur = "") {
  const x = Number(n) || 0, neg = x < 0, a = Math.abs(x);
  const [i, f] = (Number.isInteger(a) ? String(a) : a.toFixed(2)).split(".");
  return (neg ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (f ? "," + f : "") + (cur ? " " + cur : "");
}
const dots = (v, n = 22) => (v && String(v).trim() ? String(v).trim() : ".".repeat(n));
export const receiptNumber = (p) => "REC-" + new Date(p.confirmed_at || p.created_at).getUTCFullYear() + "-" + String(p.id).padStart(6, "0");

// ====================================================================================================
// Petit générateur de PDF (A4, texte, filets, encadrés)
// ====================================================================================================
// Largeurs des polices standard (1/1000 em) pour les caractères 32 à 126.
const WR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const WB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const SPECIAL = { "€": 556, "’": 222, "‘": 222, "“": 333, "”": 333, "–": 556, "—": 1000, "…": 1000, "•": 350, "œ": 944, "Œ": 1000, "«": 556, "»": 556, "°": 400, "\u00a0": 278, "\u202f": 278, "\u2009": 278 };
function cw(ch, bold) {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return (bold ? WB : WR)[c - 32];
  if (SPECIAL[ch] != null) return SPECIAL[ch];
  const base = ch.normalize("NFD")[0];
  return base && base !== ch ? cw(base, bold) : 556;
}
const WIN = { "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "œ": 0x9c, "Œ": 0x8c, "\u202f": 0x20, "\u2009": 0x20, "\u00a0": 0x20 };
function hex(s) {
  let out = "";
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0);
    const b = WIN[ch] ?? (c >= 32 && c <= 255 ? c : 0x3f);
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

const INK = [0.1, 0.12, 0.16], GREY = [0.42, 0.45, 0.5], ACCENT = [0.18, 0.31, 0.62];
class Pdf {
  constructor() { this.W = 595; this.H = 842; this.M = 54; this.pages = []; this.newPage(); }
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = this.H - this.M; }
  need(h) { if (this.y - h < this.M + 26) this.newPage(); }
  width(s, size, bold) { let w = 0; for (const ch of s) w += cw(ch, bold); return (w * size) / 1000; }
  wrap(s, size, bold, maxW) {
    const lines = []; let cur = "";
    for (let word of s.split(/\s+/).filter(Boolean)) {
      while (this.width(word, size, bold) > maxW) { // mot plus large que la ligne : coupé
        let k = word.length; while (k > 1 && this.width(word.slice(0, k), size, bold) > maxW) k--;
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(word.slice(0, k)); word = word.slice(k);
      }
      const t = cur ? cur + " " + word : word;
      if (this.width(t, size, bold) <= maxW) cur = t; else { if (cur) lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  put(x, y, s, size, bold, color) {
    this.ops.push(`${color[0]} ${color[1]} ${color[2]} rg BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td <${hex(s)}> Tj ET`);
  }
  text(s, o = {}) {
    const { size = 10, bold = false, align = "left", indent = 0, color = INK, after = 4, lead = 1.4, x0 = this.M + indent } = o;
    const maxW = o.maxW ?? this.W - this.M - x0;
    const lines = [];
    for (const p of String(s ?? "").split("\n")) lines.push(...(p.trim() === "" ? [""] : this.wrap(p, size, bold, maxW)));
    for (const ln of lines) {
      this.need(size * lead);
      const w = this.width(ln, size, bold), x = align === "right" ? x0 + maxW - w : align === "center" ? x0 + (maxW - w) / 2 : x0;
      if (ln) this.put(x, this.y - size, ln, size, bold, color);
      this.y -= size * lead;
    }
    this.y -= after;
  }
  gap(h = 8) { this.y -= h; }
  rule(o = {}) {
    const { color = [0.8, 0.82, 0.86], w = 0.8, after = 8 } = o;
    this.need(10);
    this.ops.push(`${color[0]} ${color[1]} ${color[2]} RG ${w} w ${this.M} ${(this.y - 2).toFixed(2)} m ${this.W - this.M} ${(this.y - 2).toFixed(2)} l S`);
    this.y -= after;
  }
  box(h, fill = [0.94, 0.96, 1]) {
    this.need(h);
    this.ops.push(`${fill[0]} ${fill[1]} ${fill[2]} rg ${this.M} ${(this.y - h).toFixed(2)} ${this.W - 2 * this.M} ${h} re f`);
  }
  kv(rows, labelW = 150) {
    for (const [k, v] of rows) {
      if (v == null || String(v).trim() === "") continue;
      const lines = this.wrap(String(v), 10, false, this.W - 2 * this.M - labelW);
      this.need(14 * Math.max(1, lines.length));
      this.put(this.M, this.y - 10, k, 9, true, GREY);
      for (const ln of lines) { this.put(this.M + labelW, this.y - 10, ln, 10, false, INK); this.y -= 14; }
      this.y -= 2;
    }
  }
  signatures(left, right) {
    this.need(110);
    const colW = (this.W - 2 * this.M - 30) / 2, y = this.y;
    for (const [i, [title, name]] of [left, right].entries()) {
      const x = this.M + i * (colW + 30);
      this.put(x, y - 10, title, 10, true, INK);
      if (name) this.put(x, y - 24, name, 9, false, GREY);
      this.put(x, y - 40, "Signature précédée de « Lu et approuvé » :", 8, false, GREY);
      this.ops.push(`0.6 0.62 0.66 RG 0.8 w ${x} ${(y - 90).toFixed(2)} m ${(x + colW).toFixed(2)} ${(y - 90).toFixed(2)} l S`);
    }
    this.y = y - 104;
  }
  toBuffer({ title, footer }) {
    const n = this.pages.length;
    this.pages.forEach((ops, i) => {
      ops.push(`0.8 0.82 0.86 RG 0.6 w ${this.M} 44 m ${this.W - this.M} 44 l S`);
      const f = footer || "", pg = `Page ${i + 1} / ${n}`;
      ops.push(`${GREY[0]} ${GREY[1]} ${GREY[2]} rg BT /F1 8 Tf ${this.M} 30 Td <${hex(f)}> Tj ET`);
      ops.push(`${GREY[0]} ${GREY[1]} ${GREY[2]} rg BT /F1 8 Tf ${(this.W - this.M - this.width(pg, 8, false)).toFixed(2)} 30 Td <${hex(pg)}> Tj ET`);
    });
    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offs = [];
    const add = (id, body) => { offs[id] = out.length; out += `${id} 0 obj\n${body}\nendobj\n`; };
    const pageIds = this.pages.map((_, i) => 6 + 2 * i);
    add(1, "<< /Type /Catalog /Pages 2 0 R >>");
    add(2, `<< /Type /Pages /Kids [${pageIds.map((p) => p + " 0 R").join(" ")}] /Count ${n} >>`);
    add(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    add(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    add(5, `<< /Title (${String(title || "Document").replace(/[^\x20-\x7e]/g, "").replace(/[()\\]/g, "")}) /Producer (Maison) >>`);
    this.pages.forEach((ops, i) => {
      const content = ops.join("\n");
      add(6 + 2 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + 2 * i} 0 R >>`);
      add(7 + 2 * i, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });
    const size = 6 + 2 * n, xref = out.length;
    out += `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let i = 1; i < size; i++) out += String(offs[i]).padStart(10, "0") + " 00000 n \n";
    out += `trailer\n<< /Size ${size} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, "latin1");
  }
}

// ====================================================================================================
// Identité de l'agence (en-tête des documents)
// ====================================================================================================
const AGENCY_KEYS = ["name", "legal", "address", "city", "phone", "email", "rccm", "niu", "rep", "repTitle"];
export async function loadAgency() {
  const e = process.env;
  const a = { name: e.COMPANY_NAME || "Maison — Location et vente immobilière", legal: e.COMPANY_LEGAL || "", address: e.COMPANY_ADDRESS || "", city: "", phone: e.COMPANY_PHONE || "", email: e.COMPANY_EMAIL || "", rccm: "", niu: "", rep: "", repTitle: "" };
  try {
    const [r] = await sql`SELECT value FROM payment_settings WHERE key = 'agency'`;
    if (r) { const s = JSON.parse(r.value); for (const k of AGENCY_KEYS) if (typeof s[k] === "string" && s[k].trim()) a[k] = s[k]; }
  } catch { /* identité par défaut */ }
  return a;
}
function letterhead(pdf, ag, title, ref, date) {
  pdf.text(ag.name, { size: 15, bold: true, color: ACCENT, after: 1 });
  const l1 = [ag.legal, ag.address, ag.city].filter(Boolean).join(" · "), l2 = [ag.phone && "Tél. " + ag.phone, ag.email, ag.rccm && "RCCM " + ag.rccm, ag.niu && "NIU " + ag.niu].filter(Boolean).join(" · ");
  if (l1) pdf.text(l1, { size: 8.5, color: GREY, after: 0 });
  if (l2) pdf.text(l2, { size: 8.5, color: GREY, after: 0 });
  pdf.gap(6); pdf.rule({ color: ACCENT, w: 1.4, after: 12 });
  pdf.text(title, { size: 17, bold: true, after: 2 });
  pdf.text([ref, date].filter(Boolean).join("  ·  "), { size: 9.5, color: GREY, after: 12 });
}

// ====================================================================================================
// Reçu de paiement
// ====================================================================================================
export function buildReceipt(p, ag) {
  const pdf = new Pdf(), num = receiptNumber(p);
  letterhead(pdf, ag, "REÇU DE PAIEMENT", "N° " + num, "Établi le " + fdate(p.confirmed_at || p.created_at));
  pdf.box(60);
  const top = pdf.y;
  pdf.put(pdf.M + 16, top - 20, "MONTANT REÇU", 9, true, GREY);
  pdf.put(pdf.M + 16, top - 46, money(p.amount, p.currency), 22, true, ACCENT);
  pdf.y = top - 60 - 16;
  pdf.kv([
    ["Reçu de", p.customer_name], ["E-mail", p.customer_email], ["Téléphone", p.customer_phone],
    ["Objet", p.property_title ? `Acompte — ${p.property_title}` : "Acompte"],
    ["Demande n°", String(p.order_id)], ["Moyen de paiement", METHOD_LABEL[p.method] || p.method],
    ["Référence de transaction", p.provider_ref || p.reference], ["Date de paiement", fdate(p.confirmed_at || p.created_at)],
    ["Payeur", p.payer_name || p.payer_phone], ["Validé par", p.confirmed_by_name], ["Statut", "Payé"]
  ]);
  pdf.gap(10); pdf.rule();
  pdf.text("Ce reçu atteste que la somme ci-dessus a bien été reçue par l’agence au titre de l’acompte relatif au bien désigné. Il est établi électroniquement et ne nécessite pas de signature.", { size: 9, color: GREY });
  return pdf.toBuffer({ title: "Reçu " + num, footer: `${ag.name} — ${num}` });
}

// ====================================================================================================
// Contrats (modèles indicatifs : à faire relire par un notaire ou un juriste avant signature)
// ====================================================================================================
const nInt = (v, min, max, d) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(Math.max(x, min), max) : d; };
const nNum = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.min(x, 1e12) : 0; };
const dOk = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
export function cleanParams(p = {}) {
  return {
    city: str(p.city, 80), date: dOk(p.date) || new Date().toISOString().slice(0, 10), clientId: str(p.clientId, 80), clientAddress: str(p.clientAddress, 200),
    partyName: str(p.partyName, 120), partyRep: str(p.partyRep, 120), notes: str(p.notes, 1500),
    rent: nNum(p.rent), charges: nNum(p.charges), deposit: nNum(p.deposit), months: nInt(p.months, 1, 240, 12), start: dOk(p.start), payDay: nInt(p.payDay, 1, 28, 5), notice: nInt(p.notice, 1, 12, 1),
    price: nNum(p.price), deadline: dOk(p.deadline), notary: str(p.notary, 120), penalty: nNum(p.penalty), commission: nNum(p.commission), buyerFees: p.buyerFees !== false,
    validity: nInt(p.validity, 1, 365, 15), refundable: p.refundable !== false
  };
}

function agencyLine(ag) {
  return [ag.name, ag.legal, ag.address && "sis " + ag.address, ag.rccm && "RCCM " + ag.rccm, ag.niu && "NIU " + ag.niu].filter(Boolean).join(", ") +
    (ag.rep ? `, représentée par ${ag.rep}${ag.repTitle ? " (" + ag.repTitle + ")" : ""}` : "");
}
function partyLine(d, ag) {
  return d.partyName ? `${d.partyName}${d.partyRep ? ", représenté(e) par " + d.partyRep : ""}, ayant confié la gestion de l’opération à ${ag.name}` : agencyLine(ag);
}
function clientLine(d, c) {
  return `${c.name}, e-mail ${c.email}, téléphone ${dots(c.phone, 14)}, pièce d’identité n° ${dots(d.clientId)}, demeurant à ${dots(d.clientAddress, 30)}`;
}
function propLine(pr, o) {
  const t = pr?.title || o.property_title || "le bien désigné";
  const det = pr ? [pr.location && "situé à " + pr.location, pr.area > 0 && `superficie ${pr.area} m²`, pr.rooms > 0 && `${pr.rooms} pièce(s)`, pr.bedrooms > 0 && `${pr.bedrooms} chambre(s)`].filter(Boolean).join(", ") : "";
  return det ? `« ${t} », ${det}` : `« ${t} »`;
}

export function buildContract(k, o, c, pr, ag, paid) {
  const d = k.data, kind = k.kind, pdf = new Pdf();
  const cur = pr?.currency || o.currency || "XAF";
  letterhead(pdf, ag, KINDS[kind].toUpperCase(), "N° " + k.number, `${d.city ? d.city + ", le " : "Établi le "}${fdate(d.date)}`);
  const art = (t) => pdf.text(t, { size: 11, bold: true, color: ACCENT, after: 2 });
  const p = (t) => pdf.text(t, { size: 10, after: 7 });
  const acompte = paid ? `Un acompte de ${money(paid.amount, paid.currency)} a été versé le ${fdate(paid.confirmed_at)} (reçu n° ${receiptNumber(paid)}).` : "";
  const bailleur = d.partyName || ag.name;

  if (kind === "location") {
    pdf.text("ENTRE LES SOUSSIGNÉS", { size: 10, bold: true, after: 4 });
    p(`${partyLine(d, ag)}, ci-après « le Bailleur »,`); p("d’une part, et");
    p(`${clientLine(d, c)}, ci-après « le Locataire »,`); p("d’autre part, il a été convenu ce qui suit.");
    art("Article 1 — Objet"); p(`Le Bailleur donne à bail au Locataire, qui l’accepte, le bien suivant : ${propLine(pr, o)}, à usage exclusif d’habitation.`);
    art("Article 2 — Durée"); p(`Le bail est conclu pour une durée de ${d.months} mois à compter du ${d.start ? fdate(d.start) : dots("", 18)}. Il pourra être renouvelé par accord écrit des parties.`);
    art("Article 3 — Loyer et charges"); p(`Le loyer mensuel est fixé à ${d.rent ? money(d.rent, cur) : dots("", 14)}${d.charges ? `, auquel s’ajoutent ${money(d.charges, cur)} de charges mensuelles` : ""}. Il est payable d’avance, au plus tard le ${d.payDay} de chaque mois.`);
    art("Article 4 — Dépôt de garantie"); p(`Le Locataire verse un dépôt de garantie de ${d.deposit ? money(d.deposit, cur) : dots("", 14)}, non productif d’intérêts. Il est restitué dans un délai de deux mois après la remise des clés et l’état des lieux de sortie, déduction faite des sommes dues au titre des loyers, charges et réparations locatives. ${acompte}`.trim());
    art("Article 5 — État des lieux"); p("Un état des lieux contradictoire est établi à l’entrée et à la sortie du Locataire. À défaut, le bien est présumé remis en bon état.");
    art("Article 6 — Obligations du Locataire"); p("Le Locataire s’engage à payer le loyer et les charges aux dates convenues, à user paisiblement du bien suivant sa destination, à l’entretenir, à répondre des dégradations survenues pendant la location, à s’assurer contre les risques locatifs et à ne pas sous-louer ni céder le bail sans l’accord écrit du Bailleur.");
    art("Article 7 — Obligations du Bailleur"); p("Le Bailleur remet au Locataire un logement décent, lui en assure la jouissance paisible et réalise les grosses réparations qui ne sont pas à la charge du Locataire.");
    art("Article 8 — Résiliation"); p(`Chaque partie peut mettre fin au bail en respectant un préavis de ${d.notice} mois notifié par écrit. Le Bailleur peut résilier le bail en cas de non-paiement du loyer ou de violation grave du contrat, huit jours après une mise en demeure restée sans effet.`);
  } else if (kind === "vente") {
    pdf.text("ENTRE LES SOUSSIGNÉS", { size: 10, bold: true, after: 4 });
    p(`${partyLine(d, ag)}, ci-après « le Vendeur »,`); p("d’une part, et");
    p(`${clientLine(d, c)}, ci-après « l’Acquéreur »,`); p("d’autre part, il a été convenu ce qui suit.");
    art("Article 1 — Objet"); p(`Le Vendeur promet de vendre à l’Acquéreur, qui promet d’acquérir, le bien suivant : ${propLine(pr, o)}, libre de toute occupation, hypothèque ou charge non déclarée.`);
    art("Article 2 — Prix"); p(`La vente est convenue au prix de ${d.price ? money(d.price, cur) : dots("", 14)}, payable au plus tard à la signature de l’acte authentique.`);
    art("Article 3 — Acompte"); p(`${acompte || "Un acompte pourra être versé par l’Acquéreur à la signature des présentes."} Il est imputé sur le prix à la réalisation de la vente et reste séquestré jusqu’à l’acte authentique.`);
    art("Article 4 — Conditions suspensives"); p("La vente est subordonnée à la production par le Vendeur d’un titre de propriété régulier, à l’absence de charge, saisie ou hypothèque non déclarée, et, le cas échéant, à l’obtention par l’Acquéreur de son financement.");
    art("Article 5 — Acte authentique"); p(`L’acte de vente sera signé devant notaire${d.notary ? " (" + d.notary + ")" : ""} avant le ${d.deadline ? fdate(d.deadline) : dots("", 18)}. Passé ce délai et sauf prorogation écrite, la présente promesse devient caduque.`);
    art("Article 6 — Frais"); p(`Les frais d’acte et de notaire sont à la charge de ${d.buyerFees ? "l’Acquéreur" : "du Vendeur"}.${d.commission ? ` La commission de l’agence, d’un montant de ${money(d.commission, cur)}, est due à la signature de l’acte authentique.` : ""}`);
    art("Article 7 — Renonciation"); p(`Si l’Acquéreur renonce sans motif légitime, l’acompte versé reste acquis au Vendeur. Si le Vendeur renonce, il restitue l’acompte${d.penalty ? ` et verse à l’Acquéreur une indemnité de ${money(d.penalty, cur)}` : ""}.`);
  } else {
    pdf.text("ENTRE LES SOUSSIGNÉS", { size: 10, bold: true, after: 4 });
    p(`${partyLine(d, ag)}, ci-après « l’Agence »,`); p("d’une part, et");
    p(`${clientLine(d, c)}, ci-après « le Client »,`); p("d’autre part, il a été convenu ce qui suit.");
    art("Article 1 — Objet"); p(`L’Agence s’engage à réserver au profit du Client le bien suivant : ${propLine(pr, o)}${d.price ? `, au prix indicatif de ${money(d.price, cur)}` : ""}.`);
    art("Article 2 — Durée de la réservation"); p(`La réservation est valable ${d.validity} jours à compter du ${fdate(d.date)}. Pendant cette période, le bien est retiré de l’offre et ne sera proposé à aucun tiers.`);
    art("Article 3 — Acompte"); p(acompte || "Le Client verse un acompte de réservation dont le montant et le reçu sont mentionnés par l’Agence.");
    art("Article 4 — Sort de l’acompte"); p(d.refundable
      ? "L’acompte est intégralement remboursé si le dossier du Client est refusé ou si le bien devient indisponible. Si le contrat est conclu, il est imputé sur le premier loyer, le dépôt de garantie ou le prix. Si le Client se désiste sans motif légitime, l’Agence peut en conserver une partie à titre de dédommagement."
      : "L’acompte est imputé sur le premier loyer, le dépôt de garantie ou le prix si le contrat est conclu. Il reste acquis à l’Agence si le Client se désiste sans motif légitime.");
    art("Article 5 — Suite de l’opération"); p("À l’issue de la réservation, les parties concluent le contrat de bail ou la promesse de vente, ou constatent par écrit l’abandon du projet.");
  }
  if (d.notes) { art("Clauses particulières"); p(d.notes); }
  art("Droit applicable et litiges"); p("Le présent contrat est soumis à la législation applicable au lieu de situation du bien. Les parties s’efforcent de régler à l’amiable tout différend ; à défaut, les juridictions du lieu de situation du bien sont seules compétentes.");
  pdf.gap(6);
  const lt = kind === "location" ? ["Le Bailleur", bailleur] : kind === "vente" ? ["Le Vendeur", bailleur] : ["L’Agence", ag.name];
  const rt = kind === "location" ? ["Le Locataire", c.name] : kind === "vente" ? ["L’Acquéreur", c.name] : ["Le Client", c.name];
  pdf.signatures(lt, rt);
  pdf.text("Modèle indicatif généré automatiquement : à faire relire par un notaire ou un juriste avant signature.", { size: 8, color: GREY, align: "center" });
  return pdf.toBuffer({ title: `${KINDS[kind]} ${k.number}`, footer: `${ag.name} — ${k.number}` });
}

// ====================================================================================================
// Accès aux données
// ====================================================================================================
let tableP;
function ensureContracts() {
  tableP ??= sql`CREATE TABLE IF NOT EXISTS contracts (id bigserial PRIMARY KEY, number text NOT NULL DEFAULT '', order_id bigint NOT NULL, customer_id bigint NOT NULL, kind text NOT NULL,
    data text NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'issued', created_by bigint, created_at timestamptz NOT NULL DEFAULT now())`.then(() => true, () => { tableP = null; return false; });
  return tableP;
}
function sendPdf(res, buf, name) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\w.\-]/g, "_")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).send(buf);
}
const same = (a, b) => String(a) === String(b);

export async function docsHandler(req, res) {
  const a = req.query.a;
  await ensureContracts();

  // ----- Espace client : mes reçus et mes contrats -----
  if (a === "mydocs") {
    const c = await requireCustomer(req, res);
    if (!c) return;
    const receipts = await sql`SELECT p.id::int AS id, p.order_id::int AS order_id, p.amount::float8 AS amount, p.currency, p.confirmed_at, o.property_title
      FROM payments p LEFT JOIN orders o ON o.id = p.order_id WHERE p.customer_id = ${c.id} AND p.status = 'paid' ORDER BY p.confirmed_at DESC NULLS LAST LIMIT 100`;
    const rows = await sql`SELECT k.id::int AS id, k.number, k.kind, k.created_at, o.property_title
      FROM contracts k LEFT JOIN orders o ON o.id = k.order_id WHERE k.customer_id = ${c.id} AND k.status = 'issued' ORDER BY k.id DESC LIMIT 100`;
    return send(res, 200, { receipts, contracts: rows.map((r) => ({ ...r, label: KINDS[r.kind] || r.kind })) });
  }

  // ----- Téléchargements (administrateur, ou client propriétaire du document) -----
  if (a === "receipt" || a === "contract") {
    const id = Number(req.query.id) || 0;
    const admin = await currentUser(req), cust = admin ? null : await currentCustomer(req);
    if (!admin && !cust) return send(res, 401, { error: "Non connecté" });
    const ag = await loadAgency();
    if (a === "receipt") {
      const [p] = await sql`SELECT p.*, o.property_title, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, u.name AS confirmed_by_name
        FROM payments p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = p.confirmed_by WHERE p.id = ${id}`;
      if (!p || p.status !== "paid" || (cust && !same(p.customer_id, cust.id))) return send(res, 404, { error: "Reçu introuvable." });
      return sendPdf(res, buildReceipt(p, ag), `recu-${receiptNumber(p)}.pdf`);
    }
    const [k] = await sql`SELECT * FROM contracts WHERE id = ${id}`;
    if (!k || (cust && (!same(k.customer_id, cust.id) || k.status !== "issued"))) return send(res, 404, { error: "Contrat introuvable." });
    const [o] = await sql`SELECT * FROM orders WHERE id = ${k.order_id}`;
    const [c] = await sql`SELECT name, email, phone FROM customers WHERE id = ${k.customer_id}`;
    if (!o || !c) return send(res, 404, { error: "Contrat introuvable." });
    const [pr] = o.property_id ? await sql`SELECT title, location, area, rooms, bedrooms, currency FROM properties WHERE id = ${o.property_id}` : [];
    const [paid] = await sql`SELECT id, amount, currency, confirmed_at, created_at FROM payments WHERE order_id = ${k.order_id} AND status = 'paid' ORDER BY id DESC LIMIT 1`;
    let data = {}; try { data = JSON.parse(k.data); } catch { /* contrat sans paramètres */ }
    const buf = buildContract({ ...k, data: { ...cleanParams({}), ...data } }, o, c, pr, ag, paid);
    return sendPdf(res, buf, `${k.number || "contrat-" + id}.pdf`);
  }

  // ----- Administration -----
  const u = await requireUser(req, res, a === "contract_void" || a === "agency" ? (req.method === "GET" ? undefined : "super_admin") : undefined);
  if (!u) return;

  if (a === "contracts") {
    const rows = await sql`SELECT k.id::int AS id, k.number, k.kind, k.status, k.created_at, c.name AS customer_name, o.property_title
      FROM contracts k LEFT JOIN customers c ON c.id = k.customer_id LEFT JOIN orders o ON o.id = k.order_id ORDER BY k.id DESC LIMIT 300`;
    const orders = await sql`SELECT o.id::int AS id, c.name AS customer_name, o.property_title, p.price::float8 AS price, p.operation
      FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN properties p ON p.id = o.property_id WHERE o.status = 'confirmed' ORDER BY o.created_at DESC LIMIT 200`;
    return send(res, 200, { rows: rows.map((r) => ({ ...r, label: KINDS[r.kind] || r.kind })), orders, kinds: KINDS, agency: await loadAgency() });
  }

  if (a === "agency") {
    if (req.method === "GET") return send(res, 200, await loadAgency());
    if (req.method !== "POST" || !sameOrigin(req)) return send(res, 405, { error: "Méthode refusée" });
    const b = req.body || {}, out = {};
    for (const k of AGENCY_KEYS) out[k] = str(b[k], 160);
    if (!out.name) return send(res, 400, { error: "Le nom commercial est obligatoire." });
    await sql`INSERT INTO payment_settings (key, value, updated_by, updated_at) VALUES ('agency', ${JSON.stringify(out)}, ${u.id}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await audit(u.id, "agency.update", out.name);
    return send(res, 200, { ok: true });
  }

  if (a === "contract_create") {
    if (req.method !== "POST" || !sameOrigin(req)) return send(res, 405, { error: "Méthode refusée" });
    const b = req.body || {}, kind = String(b.kind || ""), orderId = Number(b.orderId) || 0;
    if (!Object.hasOwn(KINDS, kind)) return send(res, 400, { error: "Type de contrat inconnu." });
    const [o] = await sql`SELECT id, customer_id, property_title FROM orders WHERE id = ${orderId} AND status = 'confirmed'`;
    if (!o) return send(res, 400, { error: "Choisissez une demande acceptée." });
    const [row] = await sql`INSERT INTO contracts (order_id, customer_id, kind, data, created_by) VALUES (${o.id}, ${o.customer_id}, ${kind}, ${JSON.stringify(cleanParams(b.params || {}))}, ${u.id}) RETURNING id`;
    const id = Number(row.id), number = `${PREFIX[kind]}-${new Date().getUTCFullYear()}-${String(id).padStart(5, "0")}`;
    await sql`UPDATE contracts SET number = ${number} WHERE id = ${id}`;
    await audit(u.id, "contract.create", number);
    await notifyCustomer(o.customer_id, `Votre document « ${KINDS[kind]} » pour « ${o.property_title} » est disponible dans « Mon compte ».`);
    return send(res, 201, { ok: true, id, number });
  }

  if (a === "contract_void") {
    if (req.method !== "POST" || !sameOrigin(req)) return send(res, 405, { error: "Méthode refusée" });
    const id = Number(req.body?.id) || 0;
    const [k] = await sql`UPDATE contracts SET status = 'void' WHERE id = ${id} AND status = 'issued' RETURNING number`;
    if (!k) return send(res, 404, { error: "Contrat introuvable ou déjà annulé." });
    await audit(u.id, "contract.void", k.number);
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: "Inconnu" });
}
