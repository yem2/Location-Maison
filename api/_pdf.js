// Mini moteur PDF sans dépendance : A4, polices Helvetica standard (accents français et €), pagination automatique.
import zlib from "node:zlib";

const W = 595.28, H = 841.89, MX = 54, TOP = 60, BOTTOM = 62;
// Largeurs Helvetica (1000 = corps du texte), ASCII 32..126
const REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const WIN = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f };

// Texte → octets WinAnsi (caractères inconnus remplacés par « ? »).
function toWin(str) {
  const out = [];
  for (const ch of String(str).replace(/[\u00a0\u202f\u2009]/g, " ").replace(/[\u0000-\u001f]/g, " ")) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c <= 126) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (WIN[ch]) out.push(WIN[ch]);
    else out.push(63);
  }
  return out;
}
function width(str, size, bold) {
  const t = bold ? BLD : REG; let w = 0;
  for (const b of toWin(str)) {
    let ch = b;
    if (b > 126) { const base = String.fromCharCode(b).normalize("NFD")[0]; ch = base.charCodeAt(0); if (ch < 32 || ch > 126) ch = 101; }
    w += (t[ch - 32] ?? 556);
  }
  return (w * size) / 1000;
}
const esc = (bytes) => bytes.map((b) => (b === 40 || b === 41 || b === 92 ? [92, b] : [b])).flat();

export class Pdf {
  constructor({ title = "Document", footer = "", header = null } = {}) {
    this.title = title; this.footer = footer; this.header = header; this.pages = []; this.y = 0; this.cur = null; this.page();
  }
  page() {
    this.cur = []; this.pages.push(this.cur); this.y = H - TOP;
    if (this.header && this.pages.length === 1) this.header(this);
  }
  need(h) { if (this.y - h < BOTTOM) { this.page(); } }
  gap(n = 8) { this.y -= n; return this; }
  // primitives
  _text(x, y, str, size, font) { this.cur.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${Buffer.from(esc(toWin(str))).toString("latin1")}) Tj ET`); }
  color(r, g, b, stroke) { this.cur.push(`${r} ${g} ${b} ${stroke ? "RG" : "rg"}`); }
  rect(x, y, w, h, fill) { if (fill) this.color(...fill); this.cur.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); this.color(0.1, 0.12, 0.12); }
  line(x1, y1, x2, y2, gray = 0.75, lw = 0.6) { this.cur.push(`${gray} G ${lw} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S 0 G`); }
  wrap(str, size, bold, maxW) {
    const lines = [];
    for (const para of String(str ?? "").split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? line + " " + word : word;
        if (width(test, size, bold) <= maxW) line = test;
        else {
          if (line) lines.push(line);
          if (width(word, size, bold) > maxW) { let chunk = ""; for (const c of word) { if (width(chunk + c, size, bold) > maxW) { lines.push(chunk); chunk = c; } else chunk += c; } line = chunk; } else line = word;
        }
      }
      lines.push(line);
    }
    return lines;
  }
  // texte courant (paragraphe)
  p(str, { size = 10.5, bold = false, italic = false, indent = 0, after = 6, align = "left", color = null, lead = 1.38 } = {}) {
    const font = bold ? "F2" : italic ? "F3" : "F1", maxW = W - 2 * MX - indent, lh = size * lead;
    for (const ln of this.wrap(str, size, bold, maxW)) {
      this.need(lh);
      this.y -= lh;
      if (color) this.color(...color);
      let x = MX + indent;
      if (align === "center") x = (W - width(ln, size, bold)) / 2; else if (align === "right") x = W - MX - width(ln, size, bold);
      this._text(x, this.y + size * 0.28, ln, size, font);
      if (color) this.color(0.1, 0.12, 0.12);
    }
    this.y -= after; return this;
  }
  h1(str) { this.need(40); this.p(str, { size: 18, bold: true, after: 4, color: [0.04, 0.42, 0.37] }); this.line(MX, this.y + 2, W - MX, this.y + 2, 0.04, 1.2); this.y -= 10; return this; }
  h2(str) { this.need(34); this.y -= 6; return this.p(str, { size: 12, bold: true, after: 4, color: [0.04, 0.42, 0.37] }); }
  // Article numéroté : titre en gras puis texte
  clause(title, text) { this.need(48); this.p(title, { size: 10.5, bold: true, after: 2 }); return this.p(text, { size: 10, after: 8 }); }
  // Liste clé / valeur sur deux colonnes
  kv(rows, { labelW = 150, size = 10 } = {}) {
    for (const [k, v] of rows) {
      const lines = this.wrap(String(v ?? "—") || "—", size, true, W - 2 * MX - labelW), lh = size * 1.45;
      this.need(lines.length * lh + 2);
      const y0 = this.y;
      this.color(0.4, 0.45, 0.45); this.y -= lh; this._text(MX, this.y + size * 0.28, k, size, "F1"); this.color(0.1, 0.12, 0.12);
      lines.forEach((ln, i) => { if (i) this.y -= lh; this._text(MX + labelW, this.y + size * 0.28, ln, size, "F2"); });
      this.line(MX, this.y - 3, W - MX, this.y - 3, 0.9, 0.4); this.y -= 6; void y0;
    }
    return this.gap(4);
  }
  // Bloc encadré (montant, mention importante…)
  box(lines, { fill = [0.9, 0.96, 0.94], size = 11, bold = true } = {}) {
    const lh = size * 1.5, pad = 10, content = lines.flatMap((l) => this.wrap(l, size, bold, W - 2 * MX - 2 * pad)), h = content.length * lh + 2 * pad;
    this.need(h + 6);
    this.rect(MX, this.y - h, W - 2 * MX, h, fill);
    let y = this.y - pad;
    for (const ln of content) { y -= lh; this._text(MX + pad, y + size * 0.3, ln, size, bold ? "F2" : "F1"); }
    this.y -= h + 10; return this;
  }
  // Zones de signature
  signatures(left, right) {
    this.need(110); this.gap(8);
    const colW = (W - 2 * MX - 30) / 2, y = this.y;
    [[MX, left], [MX + colW + 30, right]].forEach(([x, label]) => {
      this._text(x, y - 12, label, 10, "F2");
      this._text(x, y - 26, "Lu et approuvé — date et signature", 8.5, "F3");
      this.line(x, y - 86, x + colW, y - 86, 0.5, 0.6);
    });
    this.y -= 100; return this;
  }
  build() {
    const total = this.pages.length, objs = [];
    const add = (buf) => { objs.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "latin1")); return objs.length; };
    const catalog = add(""), pagesObj = add(""), fonts = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique"].map((n) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${n} /Encoding /WinAnsiEncoding >>`));
    const kids = [];
    this.pages.forEach((ops, i) => {
      const foot = [`0.55 g`, `BT /F1 8 Tf ${MX} 34 Td (${Buffer.from(esc(toWin(this.footer))).toString("latin1")}) Tj ET`,
        `BT /F1 8 Tf ${(W - MX - width(`Page ${i + 1}/${total}`, 8)).toFixed(2)} 34 Td (Page ${i + 1}/${total}) Tj ET`, `0.85 G 0.5 w ${MX} 46 m ${W - MX} 46 l S 0 g`];
      const stream = zlib.deflateSync(Buffer.from(["0.1 0.12 0.12 rg", ...ops, ...foot].join("\n"), "latin1"));
      const sid = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]));
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R >> >> /Contents ${sid} 0 R >>`));
    });
    const info = add(`<< /Title (${Buffer.from(esc(toWin(this.title))).toString("latin1")}) /Producer (Location et vente immobiliere) >>`);
    objs[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`, "latin1");
    objs[pagesObj - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`, "latin1");
    const parts = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")], offsets = [];
    let pos = parts[0].length;
    objs.forEach((o, i) => { const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), o, Buffer.from("\nendobj\n", "latin1")]); offsets.push(pos); pos += b.length; parts.push(b); });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n"), `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`].join("");
    parts.push(Buffer.from(xref, "latin1"));
    return Buffer.concat(parts);
  }
}

// ---------- Montant en lettres (français) ----------
const U = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const T = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];
function below100(n) {
  if (n < 20) return U[n];
  const d = Math.floor(n / 10), u = n % 10;
  if (d === 7 || d === 9) { const base = d === 7 ? "soixante" : "quatre-vingt"; const r = n - (d - 1) * 10; return base + (d === 7 && r === 11 ? " et " : "-") + U[r]; }
  if (d === 8) return u ? "quatre-vingt-" + U[u] : "quatre-vingts";
  return T[d] + (u === 1 ? " et un" : u ? "-" + U[u] : "");
}
function below1000(n) {
  const c = Math.floor(n / 100), r = n % 100;
  const head = c === 0 ? "" : c === 1 ? "cent" : U[c] + " cent" + (r === 0 ? "s" : "");
  return [head, r ? below100(r) : ""].filter(Boolean).join(" ");
}
export function words(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return "zéro";
  const parts = [], scales = [[1e9, "milliard"], [1e6, "million"]];
  for (const [v, name] of scales) { const q = Math.floor(n / v); if (q) { parts.push(below1000(q) + " " + name + (q > 1 ? "s" : "")); n %= v; } }
  const th = Math.floor(n / 1000);
  if (th) { parts.push((th === 1 ? "" : below1000(th).replace(/cents$/, "cent").replace(/vingts$/, "vingt") + " ") + "mille"); n %= 1000; }
  if (n) parts.push(below1000(n));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
const CUR = { XAF: ["francs CFA", "franc CFA"], XOF: ["francs CFA", "franc CFA"], EUR: ["euros", "euro"], USD: ["dollars", "dollar"], GBP: ["livres sterling", "livre sterling"], CAD: ["dollars canadiens", "dollar canadien"], CHF: ["francs suisses", "franc suisse"], MAD: ["dirhams", "dirham"], AED: ["dirhams", "dirham"] };
export function amountWords(amount, currency) {
  const a = Number(amount) || 0, int = Math.floor(a), cents = Math.round((a - int) * 100), [pl, sg] = CUR[currency] || [currency, currency];
  let s = words(int) + " " + (int > 1 ? pl : sg);
  if (cents) s += " et " + words(cents) + " centime" + (cents > 1 ? "s" : "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export const fmtMoney = (a, c) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(Number(a) || 0).replace(/[\u202f\u00a0]/g, " ") + " " + (c === "XAF" || c === "XOF" ? "FCFA" : c || "");
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Douala" }) : "");
