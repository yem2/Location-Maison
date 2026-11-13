import zlib from "node:zlib";

// ============================================================================
//  Mini-générateur PDF sans dépendance (polices standard Helvetica, accents français, €).
//  Suffisant pour des reçus et des contrats : texte, filets, rectangles, retour à la ligne, pages, pied de page.
// ============================================================================

const W = 595.28, H = 841.89; // A4 en points

// Largeurs Helvetica (millièmes d'em), caractères 32 à 126
const REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const EXTRA_REG = { "€": 556, "œ": 944, "Œ": 1000, "’": 222, "‘": 222, "“": 333, "”": 333, "«": 556, "»": 556, "–": 556, "—": 1000, "…": 1000, "•": 350, "°": 400, "·": 278, "\u00a0": 278, "\u202f": 278 };
const EXTRA_BOLD = { "€": 556, "œ": 944, "Œ": 1000, "’": 278, "‘": 278, "“": 500, "”": 500, "«": 556, "»": 556, "–": 556, "—": 1000, "…": 1000, "•": 350, "°": 400, "·": 278, "\u00a0": 278, "\u202f": 278 };

// Unicode → octet WinAnsi (cp1252)
const CP1252 = { "€": 0x80, "‚": 0x82, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "œ": 0x9c, "Œ": 0x8c, "\u202f": 0x20 };
function toBytes(s) {
  const out = [];
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (CP1252[ch] !== undefined) out.push(CP1252[ch]);
    else if (c >= 0x20 && c <= 0x7e) out.push(c);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else if (c === 0x09) out.push(0x20);
    else out.push(0x3f);
  }
  return out;
}
const hex = (bytes) => "<" + bytes.map((b) => b.toString(16).padStart(2, "0")).join("") + ">";

function charWidth(ch, bold) {
  const table = bold ? BOLD : REG, extra = bold ? EXTRA_BOLD : EXTRA_REG;
  if (extra[ch] !== undefined) return extra[ch];
  const c = ch.codePointAt(0);
  if (c >= 32 && c <= 126) return table[c - 32];
  const base = ch.normalize("NFD")[0]; // é → e
  const b = base.codePointAt(0);
  if (b >= 32 && b <= 126) return table[b - 32];
  return 556;
}
export function textWidth(s, size, bold = false) {
  let w = 0;
  for (const ch of String(s)) w += charWidth(ch, bold);
  return (w * size) / 1000;
}

function wrap(text, size, bold, maxW) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (textWidth(t, size, bold) <= maxW || !cur) cur = t;
      else { lines.push(cur); cur = w; }
    }
    lines.push(cur);
  }
  return lines;
}

const rgb = (c) => c.map((v) => (v / 255).toFixed(3)).join(" ");

export function createPdf({ title = "Document", author = "Gestion Immobilière", footerLeft = "" } = {}) {
  const margin = 50, top = H - 56, bottom = 60, maxW = W - margin * 2;
  const pages = [];
  let ops, y;
  const newPage = () => { ops = []; pages.push(ops); y = top; };
  newPage();

  const need = (h) => { if (y - h < bottom) newPage(); };
  const text = (x, yy, s, { size = 10, bold = false, italic = false, color = [20, 32, 29] } = {}) => {
    const f = bold ? "F2" : italic ? "F3" : "F1";
    ops.push(`BT /${f} ${size} Tf ${rgb(color)} rg 1 0 0 1 ${x.toFixed(2)} ${yy.toFixed(2)} Tm ${hex(toBytes(s))} Tj ET`);
  };
  const line = (x1, y1, x2, y2, { width = 0.6, color = [200, 210, 206] } = {}) => ops.push(`${width} w ${rgb(color)} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  const rect = (x, yy, w, h, { fill = null, stroke = null, width = 0.6 } = {}) => {
    let p = `${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`;
    if (fill) ops.push(`${rgb(fill)} rg ${p} f`);
    if (stroke) ops.push(`${width} w ${rgb(stroke)} RG ${p} S`);
  };

  const api = {
    margin, maxW, width: W,
    get y() { return y; }, set y(v) { y = v; },
    newPage, need, text, line, rect,
    gap(h = 8) { y -= h; },
    // Paragraphe avec retour à la ligne automatique et saut de page
    para(s, { size = 10, bold = false, italic = false, color = [20, 32, 29], indent = 0, leading = 1.4, after = 6, align = "left" } = {}) {
      const lines = wrap(s, size, bold, maxW - indent);
      for (const l of lines) {
        need(size * leading);
        y -= size * leading;
        let x = margin + indent;
        if (align === "center") x = margin + (maxW - textWidth(l, size, bold)) / 2;
        else if (align === "right") x = margin + maxW - textWidth(l, size, bold);
        text(x, y + size * 0.28, l, { size, bold, italic, color });
      }
      y -= after;
    },
    heading(s, { size = 13, color = [22, 118, 110], before = 8, after = 4 } = {}) {
      need(size * 2.2 + before);
      y -= before;
      api.para(s, { size, bold: true, color, after });
    },
    rule({ color = [200, 210, 206], before = 4, after = 8 } = {}) { y -= before; need(2); line(margin, y, W - margin, y, { color }); y -= after; },
    // Lignes « libellé : valeur »
    kv(rows, { labelW = 150, size = 10 } = {}) {
      for (const [k, v] of rows) {
        const lines = wrap(v === undefined || v === null || v === "" ? "—" : String(v), size, false, maxW - labelW);
        need(size * 1.5 * lines.length);
        const startY = y;
        lines.forEach((l, i) => { y -= size * 1.5; text(margin + labelW, y + size * 0.28, l, { size }); });
        text(margin, startY - size * 1.5 + size * 0.28, k, { size, color: [100, 115, 109] });
      }
      y -= 4;
    },
    box(h, opts) { need(h); rect(margin, y - h, maxW, h, opts); },
    build() {
      const n = pages.length;
      pages.forEach((p, i) => {
        ops = p;
        line(margin, 44, W - margin, 44, { width: 0.4 });
        if (footerLeft) text(margin, 32, footerLeft, { size: 8, color: [120, 134, 128] });
        const t = `Page ${i + 1} / ${n}`;
        text(W - margin - textWidth(t, 8), 32, t, { size: 8, color: [120, 134, 128] });
      });
      return serialize(pages, { title, author });
    }
  };
  return api;
}

function serialize(pages, { title, author }) {
  const objs = []; // index = numéro d'objet - 1 ; valeur = Buffer
  const add = (b) => { objs.push(Buffer.isBuffer(b) ? b : Buffer.from(b, "latin1")); return objs.length; };
  const reserve = () => { objs.push(null); return objs.length; };
  const catalog = reserve(), pagesObj = reserve();
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const f3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");
  const kids = [];
  for (const ops of pages) {
    const raw = zlib.deflateSync(Buffer.from(ops.join("\n"), "latin1"));
    const content = add(Buffer.concat([Buffer.from(`<< /Length ${raw.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), raw, Buffer.from("\nendstream", "latin1")]));
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[pagesObj - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`, "latin1");
  objs[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`, "latin1");
  const info = add(`<< /Title ${hex(toBytes(title))} /Author ${hex(toBytes(author))} /Producer (Gestion Immobiliere) >>`);

  const parts = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((b, i) => {
    offsets.push(pos);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), b, Buffer.from("\nendobj\n", "latin1")]);
    parts.push(chunk); pos += chunk.length;
  });
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += String(o).padStart(10, "0") + " 00000 n \n";
  xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}
