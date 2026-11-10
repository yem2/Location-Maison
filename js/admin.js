(function () {
  const app = document.getElementById("app");
  let me = null, props = [], tab = "annonces";
  const SYM = { EUR: "€", USD: "$", XAF: "FCFA", MAD: "DH", CHF: "CHF", CAD: "CA$", GBP: "£", AED: "AED" };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    kids.flat().forEach((c) => el.append(c instanceof Node ? c : document.createTextNode(c ?? "")));
    return el;
  }
  async function api(path, method = "GET", body) {
    const r = await fetch(path, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && me) { me = null; render(); }
    if (!r.ok) throw new Error(data.error || "Erreur " + r.status);
    return data;
  }
  const field = (label, input) => h("div", {}, h("label", {}, label), input);
  const when = (d) => new Date(d).toLocaleString("fr-FR");
  const ST = { pending: "En attente", confirmed: "Acceptée", rejected: "Refusée", cancelled: "Annulée" };
  const ACT = { signup: "a créé son compte", login: "s’est connecté", view_property: "a consulté le bien", order: "a demandé une réservation", order_blocked: "a tenté de réserver un bien indisponible", order_cancel: "a annulé sa demande" };
  const AVL = { available: "Disponible", reserved: "Réservé", unavailable: "Indisponible" };
  let counts = { notifications: 0, pendingOrders: 0 };

  // Réduit la photo (1600 px max, JPEG) avant l'envoi
  async function shrink(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
      if (blob.size <= 1_100_000) return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
    }
    throw new Error("Photo trop lourde, choisissez-en une plus petite.");
  }
  function lazy(path, build) {
    const box = h("div", {}, h("p", { class: "muted" }, "Chargement…"));
    const reload = () => api(path).then((rows) => box.replaceChildren(...build(rows, reload))).catch((x) => box.replaceChildren(h("p", { class: "err" }, x.message)));
    reload(); return box;
  }

  function loginView() {
    const err = h("p", { class: "err", role: "alert" });
    const email = h("input", { type: "email", required: true, autocomplete: "username" });
    const pw = h("input", { type: "password", required: true, autocomplete: "current-password" });
    const form = h("form", { class: "card login", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = "";
      try { me = (await api("/api/auth?a=login", "POST", { email: email.value, password: pw.value })).user; await load(); render(); }
      catch (x) { err.textContent = x.message; }
    } }, h("h1", {}, "Administration"), h("p", { class: "muted" }, "Connexion réservée aux administrateurs."),
      field("E-mail", email), h("br"), field("Mot de passe", pw), err, h("button", { type: "submit" }, "Se connecter"));
    return form;
  }

  async function load() {
    props = await api("/api/properties?all=1");
  }

  function propForm(p) {
    const v = p || { operation: "sale", currency: "EUR", currencySymbol: "€", kind: "maison", kindLabel: "Maison", image: "", deposit: 0, rooms: 3, bedrooms: 2, bathrooms: 1, area: 80, features: [], published: true, order: props.length + 1 };
    const f = {};
    const mk = (name, type = "text", extra = {}) => (f[name] = h("input", { type, value: v[name] ?? "", ...extra }));
    mk("title"); mk("location"); mk("price", "number", { min: 0 }); mk("deposit", "number", { min: 0 }); mk("image"); mk("alt"); mk("kindLabel");
    mk("rooms", "number"); mk("bedrooms", "number"); mk("bathrooms", "number"); mk("area", "number"); mk("order", "number");
    f.description = h("textarea", {}, v.description || "");
    f.features = h("input", { value: (v.features || []).join(", ") });
    f.operation = h("select", {}, h("option", { value: "sale" }, "Vente"), h("option", { value: "rent" }, "Location")); f.operation.value = v.operation;
    f.kind = h("select", {}, ...["maison", "appartement", "loft"].map((k) => h("option", { value: k }, k))); f.kind.value = v.kind;
    f.currency = h("select", {}, ...Object.keys(SYM).map((c) => h("option", { value: c }, c))); f.currency.value = v.currency;
    const chk = (name, label) => { f[name] = h("input", { type: "checkbox" }); f[name].checked = !!v[name]; return h("label", { class: "chk" }, f[name], label); };
    f.availability = h("select", {}, ...Object.entries(AVL).map(([k, l]) => h("option", { value: k }, l))); f.availability.value = v.availability || "available";
    const err = h("p", { class: "err", role: "alert" });
    const status = h("span", { class: "muted" });
    const preview = h("img", { src: v.image ? (/^(https?:|\/)/.test(v.image) ? v.image : "/" + v.image) : "", alt: "", style: "max-width:100%;max-height:160px;border-radius:10px;margin-top:6px;display:block" });
    const up = h("input", { type: "file", accept: "image/*", onchange: async (e) => {
      const file = e.target.files[0]; if (!file) return; err.textContent = ""; status.textContent = "Envoi de la photo…";
      try { const data = await shrink(file); const r = await api("/api/image", "POST", { data }); f.image.value = r.url; preview.src = r.url; status.textContent = "Photo importée ✓ (pensez à enregistrer l’annonce)"; }
      catch (x) { status.textContent = ""; err.textContent = x.message; }
    } });
    const cam = h("input", { type: "file", accept: "image/*", capture: "environment", onchange: (e) => {
      const file = e.target.files[0]; if (!file) return;
      const dt = new DataTransfer(); dt.items.add(file); up.files = dt.files; up.dispatchEvent(new Event("change"));
    } });
    const form = h("form", { class: "card", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = "";
      if (!f.image.value) { err.textContent = "Ajoutez une photo du bien (galerie ou appareil photo)."; return; }
      const body = { id: v.id, currencySymbol: SYM[f.currency.value] };
      for (const k of ["title", "location", "price", "image", "alt", "kindLabel", "rooms", "bedrooms", "bathrooms", "area", "order", "description", "operation", "kind", "currency", "availability", "deposit"]) body[k] = f[k].value;
      body.features = f.features.value.split(",").map((s) => s.trim()).filter(Boolean);
      body.isNew = f.isNew.checked; body.isExclusive = f.isExclusive.checked; body.published = f.published.checked;
      try { await api("/api/properties", p ? "PUT" : "POST", body); await load(); tab = "annonces"; render(); } catch (x) { err.textContent = x.message; }
    } },
      h("h2", {}, p ? "Modifier l’annonce" : "Nouvelle annonce"),
      h("div", { class: "grid" }, field("Titre", f.title), field("Localisation", f.location), field("Prix", f.price), field("Acompte de réservation (0 = aucun paiement)", f.deposit), field("Devise", f.currency),
        field("Opération", f.operation), field("Type", f.kind), field("Libellé du type (ex. Villa)", f.kindLabel), field("Photo du bien (obligatoire)", h("div", {}, h("p", { class: "muted", style: "margin:0 0 4px" }, "Depuis la galerie :"), up, h("p", { class: "muted", style: "margin:8px 0 4px" }, "Ou avec l’appareil photo :"), cam, status, preview)), field("Disponibilité", f.availability),
        field("Texte alternatif de l’image", f.alt), field("Pièces", f.rooms), field("Chambres", f.bedrooms), field("Salles de bain", f.bathrooms),
        field("Surface (m²)", f.area), field("Ordre d’affichage", f.order)),
      h("br"), field("Description", f.description), h("br"), field("Atouts (séparés par des virgules)", f.features), h("br"),
      h("div", { class: "row" }, chk("isNew", "Nouveau"), chk("isExclusive", "Exclusivité"), chk("published", "Publié")), err,
      h("div", { class: "row" }, h("button", { type: "submit" }, "Enregistrer"), h("button", { type: "button", class: "ghost", onclick: () => { tab = "annonces"; render(); } }, "Annuler")));
    return form;
  }

  function listView() {
    return h("div", {}, h("div", { class: "row", style: "margin-bottom:10px" }, h("h2", {}, props.length + " annonce(s)"),
      h("button", { onclick: () => { tab = "form"; window._edit = null; render(); } }, "+ Ajouter")),
      ...props.map((p) => h("div", { class: "card row" },
        h("div", {}, h("strong", {}, p.title), " ", h("span", { class: "pill" }, p.published ? "Publié" : "Masqué"), " ", h("span", { class: "pill" }, AVL[p.availability] || "Disponible"), h("br"),
          h("span", { class: "muted" }, p.location + " · " + new Intl.NumberFormat("fr-FR").format(p.price) + " " + p.currencySymbol + (p.priceSuffix || ""))),
        h("div", { class: "row" }, h("button", { class: "ghost", onclick: () => { tab = "form"; window._edit = p; render(); } }, "Modifier"),
          h("button", { class: "danger", onclick: async () => { if (!confirm("Supprimer « " + p.title + " » ?")) return; await api("/api/properties?id=" + encodeURIComponent(p.id), "DELETE"); await load(); render(); } }, "Supprimer")))));
  }

  async function messagesView() {
    const box = h("div", {}, h("p", { class: "muted" }, "Chargement…"));
    api("/api/messages").then((rows) => {
      box.replaceChildren(h("h2", {}, rows.length + " message(s)"), ...rows.map((m) => h("div", { class: "card" + (m.is_read ? "" : " unread") },
        h("div", { class: "row" }, h("strong", {}, m.name), h("span", { class: "muted" }, new Date(m.created_at).toLocaleString("fr-FR"))),
        h("div", { class: "muted" }, m.email + (m.phone ? " · " + m.phone : "") + (m.property_id ? " · bien : " + m.property_id : "")),
        h("p", { style: "white-space:pre-wrap" }, m.message),
        h("div", { class: "row" }, h("button", { class: "ghost", onclick: async () => { await api("/api/messages?id=" + m.id, "PATCH", { read: !m.is_read }); messagesView().then((n) => box.replaceWith(n)); } }, m.is_read ? "Marquer non lu" : "Marquer lu"),
          h("button", { class: "danger", onclick: async () => { if (!confirm("Supprimer ce message ?")) return; await api("/api/messages?id=" + m.id, "DELETE"); messagesView().then((n) => box.replaceWith(n)); } }, "Supprimer")))));
    }).catch((x) => box.replaceChildren(h("p", { class: "err" }, x.message)));
    return box;
  }

  async function adminsView() {
    const box = h("div", {}, h("p", { class: "muted" }, "Chargement…"));
    const reload = () => adminsView().then((n) => box.replaceWith(n));
    const err = h("p", { class: "err", role: "alert" });
    const email = h("input", { type: "email", required: true }), name = h("input"), pw = h("input", { type: "password", minlength: 10, required: true, autocomplete: "new-password" });
    api("/api/admins").then((rows) => {
      box.replaceChildren(h("h2", {}, "Administrateurs"),
        h("form", { class: "card", onsubmit: async (e) => { e.preventDefault(); err.textContent = ""; try { await api("/api/admins", "POST", { email: email.value, name: name.value, password: pw.value }); reload(); } catch (x) { err.textContent = x.message; } } },
          h("div", { class: "grid" }, field("E-mail", email), field("Nom", name), field("Mot de passe (10 caractères min.)", pw)), err, h("button", { type: "submit" }, "Ajouter un administrateur")),
        ...rows.map((u) => h("div", { class: "card row" },
          h("div", {}, h("strong", {}, u.name || u.email), " ", h("span", { class: "pill" }, u.role === "super_admin" ? "Super admin" : "Admin"), u.active ? "" : h("span", { class: "pill" }, "Désactivé"), h("br"), h("span", { class: "muted" }, u.email)),
          h("div", { class: "row" },
            h("button", { class: "ghost", onclick: async () => { const p = prompt("Nouveau mot de passe (10 caractères min.)"); if (!p) return; try { await api("/api/admins?id=" + u.id, "PATCH", { password: p }); alert("Mot de passe modifié."); } catch (x) { alert(x.message); } } }, "Mot de passe"),
            u.id !== me.id ? h("button", { class: "ghost", onclick: async () => { await api("/api/admins?id=" + u.id, "PATCH", { active: !u.active }); reload(); } }, u.active ? "Désactiver" : "Activer") : "",
            u.id !== me.id ? h("button", { class: "danger", onclick: async () => { if (confirm("Supprimer " + u.email + " ?")) { await api("/api/admins?id=" + u.id, "DELETE"); reload(); } } }, "Supprimer") : ""))));
    }).catch((x) => box.replaceChildren(h("p", { class: "err" }, x.message)));
    return box;
  }


  function ordersView() {
    return lazy("/api/orders?admin=1", (rows, reload) => [h("h2", {}, rows.length + " demande(s) de réservation"),
      ...rows.map((o) => h("div", { class: "card" + (o.status === "pending" ? " unread" : "") },
        h("div", { class: "row" }, h("strong", {}, o.property_title || "(bien supprimé)"), h("span", { class: "pill" }, ST[o.status] || o.status)),
        h("div", { class: "muted" }, o.customer_name + " · " + o.customer_email + (o.customer_phone ? " · " + o.customer_phone : "") + " · " + when(o.created_at)),
        o.message ? h("p", { style: "white-space:pre-wrap" }, o.message) : "",
        Number(o.amount) > 0 ? h("div", { class: "row" }, h("span", {}, "Acompte : " + new Intl.NumberFormat("fr-FR").format(o.amount) + " " + o.currency + " — " + ({ none: "à payer", pending: "paiement en cours", failed: "paiement échoué", paid: "payé ✓", cash_pending: "espèces à encaisser" })[o.payment_status]),
          o.payment_status === "cash_pending" ? h("button", { onclick: async () => { await api("/api/pay?a=markpaid", "POST", { orderId: o.id }); reload(); } }, "Espèces reçues : marquer payé") : "") : "",
        o.status === "pending" ? h("div", { class: "row" },
          h("button", { onclick: async () => { await api("/api/orders?admin=1", "PATCH", { id: o.id, status: "confirmed" }); reload(); } }, "Accepter (bien réservé)"),
          h("button", { class: "danger", onclick: async () => { await api("/api/orders?admin=1", "PATCH", { id: o.id, status: "rejected" }); reload(); } }, "Refuser")) : ""))]);
  }
  function notifsView() {
    return lazy("/api/console?a=notifications", (rows) => {
      if (rows.some((n) => !n.is_read)) api("/api/console?a=notifications", "POST").catch(() => {});
      return [h("h2", {}, rows.length + " notification(s)"), ...rows.map((n) => h("div", { class: "card" + (n.is_read ? "" : " unread") },
        h("div", { class: "row" }, h("strong", {}, n.title), h("span", { class: "muted" }, when(n.created_at))), h("div", { class: "muted" }, n.detail)))];
    });
  }
  function customersView() {
    return lazy("/api/console?a=customers", (rows, reload) => [h("h2", {}, rows.length + " client(s) inscrit(s)"),
      ...rows.map((c) => h("div", { class: "card row" },
        h("div", {}, h("strong", {}, c.name), " ", c.active ? "" : h("span", { class: "pill" }, "Désactivé"), h("br"),
          h("span", { class: "muted" }, c.email + (c.phone ? " · " + c.phone : "")), h("br"),
          h("span", { class: "muted" }, "Inscrit le " + when(c.created_at) + " · " + c.orders + " demande(s) · " + c.actions + " action(s)")),
        h("div", { class: "row" },
          h("button", { class: "ghost", onclick: () => { window._cust = c.id; tab = "activity"; render(); } }, "Voir l’activité"),
          h("button", { class: c.active ? "danger" : "ghost", onclick: async () => { await api("/api/console?a=customers&id=" + c.id, "PATCH", { active: !c.active }); reload(); } }, c.active ? "Désactiver" : "Réactiver"))))]);
  }
  function activityView() {
    const q = window._cust ? "&customer=" + window._cust : "";
    return lazy("/api/console?a=activity" + q, (rows) => [
      h("div", { class: "row", style: "margin-bottom:10px" }, h("h2", {}, rows.length + " action(s)" + (window._cust ? " de ce client" : " récentes")),
        window._cust ? h("button", { class: "ghost", onclick: () => { window._cust = null; render(); } }, "Voir tous les clients") : ""),
      ...rows.map((x) => h("div", { class: "card row" },
        h("div", {}, h("strong", {}, x.name), " " + (ACT[x.action] || x.action) + (x.detail && x.action !== "signup" ? " « " + x.detail + " »" : ""), h("br"), h("span", { class: "muted" }, x.email)),
        h("span", { class: "muted" }, when(x.created_at))))]);
  }

  async function render() {
    if (!me) { app.replaceChildren(loginView()); return; }
    const t = (id, label) => h("button", { class: id === tab || (tab === "form" && id === "annonces") ? "on" : "ghost", onclick: () => { tab = id; window._cust = null; render(); } }, label);
    try { counts = await api("/api/console?a=counts"); } catch (e) {}
    const sup = me.role === "super_admin";
    const tabs = h("div", { class: "tabs" }, t("annonces", "Annonces"), t("orders", "Commandes" + (counts.pendingOrders ? " (" + counts.pendingOrders + ")" : "")),
      t("notifs", "Notifications" + (counts.notifications ? " (" + counts.notifications + ")" : "")), t("messages", "Messages"), t("support", "Support"),
      sup ? t("clients", "Clients") : "", sup ? t("activity", "Activité") : "", sup ? t("admins", "Administrateurs") : "", sup ? t("supervision", "Supervision") : "");
    const body = tab === "support" ? await window.AdminExtra.supportView() : tab === "supervision" && sup ? await window.AdminExtra.supervisionView() : tab === "form" ? propForm(window._edit) : tab === "messages" ? await messagesView() : tab === "admins" ? await adminsView()
      : tab === "orders" ? ordersView() : tab === "notifs" ? notifsView() : tab === "clients" && sup ? customersView() : tab === "activity" && sup ? activityView() : listView();
    app.replaceChildren(
      h("div", { class: "top" }, h("div", {}, h("h1", {}, "Administration"), h("span", { class: "muted" }, me.email + " · " + (me.role === "super_admin" ? "Super administrateur" : "Administrateur"))),
        h("div", { class: "row" }, h("a", { class: "btn ghost", href: "/", style: "text-decoration:none;border:1px solid var(--line);color:var(--ink);background:transparent" }, "Voir le site"),
          h("button", { class: "ghost", onclick: async () => { await api("/api/auth?a=logout", "POST"); me = null; render(); } }, "Déconnexion"))),
      tabs, body);
  }

  api("/api/auth?a=me").then(async (r) => { me = r.user; await load(); render(); }).catch(() => render());
})();
