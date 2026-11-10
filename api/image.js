import crypto from "node:crypto";
import { sql, send, requireUser, audit , wrap } from "./_lib.js";

const MAX_BYTES = 1_500_000;

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 4).toString("hex") === "89504e47") return "image/png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

async function handler(req, res) {
  if (req.method === "GET") {
    const id = String(req.query.id || "");
    if (!/^[a-f0-9]{32}$/.test(id)) return res.status(404).end();
    const [row] = await sql`SELECT content_type, data_b64 FROM images WHERE id = ${id}`;
    if (!row) return res.status(404).end();
    res.setHeader("Content-Type", row.content_type);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(Buffer.from(row.data_b64, "base64"));
  }
  if (req.method !== "POST") return send(res, 405, { error: "Méthode refusée" });
  const u = await requireUser(req, res);
  if (!u) return;
  const raw = typeof req.body?.data === "string" ? req.body.data.replace(/^data:[^,]*,/, "") : "";
  const buf = Buffer.from(raw, "base64");
  if (!buf.length || buf.length > MAX_BYTES) return send(res, 400, { error: "Image vide ou trop lourde (1,5 Mo maximum)." });
  const type = sniff(buf);
  if (!type) return send(res, 400, { error: "Format non pris en charge (JPEG, PNG ou WebP)." });
  const id = crypto.randomBytes(16).toString("hex");
  await sql`INSERT INTO images (id, content_type, data_b64) VALUES (${id}, ${type}, ${buf.toString("base64")})`;
  await audit(u.id, "image.upload", id);
  send(res, 201, { url: `/api/image?id=${id}` });
}

export default wrap("image", handler);
