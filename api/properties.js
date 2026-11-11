import { sql, send, requireUser, audit, str, notifyCustomer, ensureSchema, wrap } from "./_lib.js";

const toFront = (r) => ({
  id: r.id, title: r.title, location: r.location, price: Number(r.price), currency: r.currency,
  currencySymbol: r.currency_symbol, operation: r.operation, kind: r.kind, kindLabel: r.kind_label,
  image: r.image, alt: r.alt, rooms: r.rooms, bedrooms: r.bedrooms, bathrooms: r.bathrooms, area: r.area,
  description: r.description, features: r.features, label: r.label, priceSuffix: r.price_suffix || undefined,
  isNew: r.is_new, isExclusive: r.is_exclusive, order: r.position, published: r.published, archived: !!r.archived, availability: r.availability, deposit: Number(r.deposit)
});

const slug = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const num = (v, max = 1e12) => Math.min(Math.max(Number(v) || 0, 0), max);
const imageOk = (s) => /^(assets\/images\/[\w.\-]+|\/api\/image\?id=[a-f0-9]{32}|https:\/\/[^\s"'<>]+)$/.test(s);

function clean(b) {
  const p = {
    title: str(b.title, 120), location: str(b.location, 120), price: num(b.price),
    currency: str(b.currency, 3).toUpperCase() || "EUR", currencySymbol: str(b.currencySymbol, 6) || "€",
    operation: b.operation === "rent" ? "rent" : "sale", kind: str(b.kind, 30) || "maison",
    kindLabel: str(b.kindLabel, 30) || "Maison", image: str(b.image, 500), alt: str(b.alt, 200),
    rooms: num(b.rooms, 99), bedrooms: num(b.bedrooms, 99), bathrooms: num(b.bathrooms, 99), area: num(b.area, 100000),
    description: str(b.description, 2000),
    features: (Array.isArray(b.features) ? b.features : []).map((f) => str(f, 60)).filter(Boolean).slice(0, 12),
    availability: ["available", "reserved", "unavailable"].includes(b.availability) ? b.availability : "available", isNew: !!b.isNew, isExclusive: !!b.isExclusive, published: b.published !== false, position: num(b.order, 9999), deposit: num(b.deposit)
  };
  p.label = p.operation === "rent" ? "À louer" : "À vendre";
  p.priceSuffix = p.operation === "rent" ? " / mois" : "";
  if (!p.title || !p.location || !p.price) return { error: "Titre, localisation et prix sont obligatoires." };
  if (!imageOk(p.image)) return { error: "Image invalide : importez une photo ou indiquez une URL https." };
  return { p };
}

async function handler(req, res) {
  if (req.method === "GET") {
    const all = req.query.all === "1" && (await requireUser(req, res));
    if (req.query.all === "1" && !all) return;
    if (all) await ensureSchema();
    const rows = all
      ? await sql`SELECT * FROM properties ORDER BY position, created_at`
      : await sql`SELECT * FROM properties WHERE published ORDER BY position, created_at`;
    if (!all) res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return send(res, 200, rows.map(toFront));
  }
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === "DELETE") {
    if (user.role !== "super_admin") return send(res, 403, { error: "La suppression définitive est réservée au super administrateur." });
    if (!(await ensureSchema())) return send(res, 500, { error: "Archivage indisponible : exécutez migration-superadmin.sql dans Neon." });
    const id = str(req.query.id, 80);
    const [x] = await sql`SELECT archived FROM properties WHERE id = ${id}`;
    if (!x) return send(res, 404, { error: "Annonce introuvable." });
    if (!x.archived) return send(res, 409, { error: "Mettez d’abord l’annonce dans les archives, puis supprimez-la définitivement." });
    await sql`DELETE FROM properties WHERE id = ${id}`;
    await audit(user.id, "property.delete", id);
    return send(res, 200, { ok: true });
  }
  // Archiver / restaurer : l'annonce disparaît du site public mais reste en base (réversible)
  if (req.method === "PATCH") {
    if (!(await ensureSchema())) return send(res, 500, { error: "Archivage indisponible : exécutez migration-superadmin.sql dans Neon." });
    const id = str(req.query.id, 80), archived = req.body?.archived === true;
    const rows = archived
      ? await sql`UPDATE properties SET archived = true, archived_at = now(), published = false, updated_at = now() WHERE id = ${id} RETURNING title`
      : await sql`UPDATE properties SET archived = false, archived_at = NULL, published = true, updated_at = now() WHERE id = ${id} RETURNING title`;
    if (!rows.length) return send(res, 404, { error: "Annonce introuvable." });
    await audit(user.id, archived ? "property.archive" : "property.restore", id);
    return send(res, 200, { ok: true });
  }
  if (req.method !== "POST" && req.method !== "PUT") return send(res, 405, { error: "Méthode refusée" });

  const { p, error } = clean(req.body || {});
  if (error) return send(res, 400, { error });
  const f = JSON.stringify(p.features);
  if (req.method === "POST") {
    let id = slug(p.title) || "bien", n = 1;
    while ((await sql`SELECT 1 FROM properties WHERE id = ${id}`).length) id = `${slug(p.title)}-${++n}`;
    await sql`INSERT INTO properties (id,title,location,price,currency,currency_symbol,operation,kind,kind_label,image,alt,rooms,bedrooms,bathrooms,area,description,features,label,price_suffix,is_new,is_exclusive,position,published,availability,deposit)
      VALUES (${id},${p.title},${p.location},${p.price},${p.currency},${p.currencySymbol},${p.operation},${p.kind},${p.kindLabel},${p.image},${p.alt},${p.rooms},${p.bedrooms},${p.bathrooms},${p.area},${p.description},${f}::jsonb,${p.label},${p.priceSuffix},${p.isNew},${p.isExclusive},${p.position},${p.published},${p.availability},${p.deposit})`;
    await audit(user.id, "property.create", id);
    return send(res, 201, { id });
  }
  const id = str(req.body.id, 80);
  const hasArch = await ensureSchema();
  const [old] = hasArch ? await sql`SELECT availability, title, archived FROM properties WHERE id = ${id}` : await sql`SELECT availability, title FROM properties WHERE id = ${id}`;
  const published = p.published && !(old && old.archived); // une annonce archivée ne peut pas être republiée sans restauration
  await sql`UPDATE properties SET title=${p.title},location=${p.location},price=${p.price},currency=${p.currency},currency_symbol=${p.currencySymbol},operation=${p.operation},kind=${p.kind},kind_label=${p.kindLabel},image=${p.image},alt=${p.alt},rooms=${p.rooms},bedrooms=${p.bedrooms},bathrooms=${p.bathrooms},area=${p.area},description=${p.description},features=${f}::jsonb,label=${p.label},price_suffix=${p.priceSuffix},is_new=${p.isNew},is_exclusive=${p.isExclusive},position=${p.position},published=${published},availability=${p.availability},deposit=${p.deposit},updated_at=now() WHERE id=${id}`;
  if (old && old.availability === "available" && p.availability !== "available") {
    const waiting = await sql`SELECT DISTINCT customer_id FROM orders WHERE property_id = ${id} AND status = 'pending'`;
    for (const r of waiting) await notifyCustomer(r.customer_id, `Le bien « ${p.title} » n’est plus disponible.`);
  }
  await audit(user.id, "property.update", id);
  send(res, 200, { ok: true });
}

export default wrap("properties", handler);
