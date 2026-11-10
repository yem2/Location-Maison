(function () {
  const app = document.getElementById("app");
  let me = null, props = [], tab = "dashboard";
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
    if (!r.ok) { const e = new Error(data.error || "Erreur " + r.status); e.data = data; throw e; }
    return data;
  }
  const field = (label, input) => h("div", {}, h("label", {}, label), input);
  const when = (d) => new Date(d).toLocaleString("fr-FR");
  const ST = { pending: "En attente", confirmed: "Acceptée", rejected: "Refusée", cancelled: "Annulée" };
  const ACT = { signup: "a créé son compte", login: "s’est connecté", view_property: "a consulté le bien", order: "a demandé une réservation", order_blocked: "a tenté de réserver un bien indisponible", order_cancel: "a annulé sa demande" };
  const AVL = { available: "Disponible", reserved: "Réservé", unavailable: "Indisponible" };
  let counts = { notifications: 0, pendingOrders: 0, chat: 0, suggestions: 0 };

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
    const code = h("input", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: 8, placeholder: "123456" });
    const codeBox = h("div", { hidden: true }, h("br"), field("Code de double authentification", code));
    const form = h("form", { class: "card login", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = "";
      try { me = (await api("/api/auth?a=login", "POST", { email: email.value, password: pw.value, code: code.value })).user; await load(); render(); }
      catch (x) { err.textContent = x.message; if (x.data && x.data.needCode) { codeBox.hidden = false; code.focus(); } }
    } }, h("h1", {}, "Administration"), h("p", { class: "muted" }, "Connexion réservée aux administrateurs."),
      field("E-mail", email), h("br"), field("Mot de passe", pw), codeBox, err, h("button", { type: "submit" }, "Se connecter"));
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

  let pollTimer = null;
  const stopPoll = () => { clearInterval(pollTimer); pollTimer = null; };
  const nf = (n) => new Intl.NumberFormat("fr-FR").format(Math.round(n));
  const snip = (s) => String(s || "").replace(/\s+/g, " ").slice(0, 70);

  function svgEl(tag, attrs) { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; }
  function barChart(days) {
    const W = 640, H = 190, pad = 24, max = Math.max(1, ...days.map((d) => Math.max(d.actions, d.orders)));
    const s = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Activité des 14 derniers jours" });
    const bw = (W - pad * 2) / days.length;
    s.append(svgEl("line", { x1: pad, y1: H - pad, x2: W - pad, y2: H - pad, stroke: "currentColor", opacity: ".2" }));
    days.forEach((d, i) => {
      const x = pad + i * bw, hA = (d.actions / max) * (H - pad * 2 - 6), hO = (d.orders / max) * (H - pad * 2 - 6);
      s.append(svgEl("rect", { x: x + 3, y: H - pad - hA, width: bw / 2 - 4, height: hA, rx: 3, fill: "#4f46e5" }));
      s.append(svgEl("rect", { x: x + bw / 2, y: H - pad - hO, width: bw / 2 - 4, height: hO, rx: 3, fill: "#f59e0b" }));
      if (i % 2 === 0) { const tx = svgEl("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle", "font-size": 10, fill: "currentColor", opacity: ".6" }); tx.textContent = d.day; s.append(tx); }
    });
    return s;
  }
  const meter = (label, n, total) => h("div", {}, h("div", { class: "row" }, h("span", {}, label), h("strong", {}, String(n))), h("div", { class: "bar" }, h("i", { style: "width:" + (total ? (n / total) * 100 : 0) + "%" })));

  function dashboardView() {
    const box = h("div", {}, h("p", { class: "muted" }, "Chargement…"));
    api("/api/console?a=stats").then((s) => {
      const kpi = (l, v, sub, hot) => h("div", { class: "kpi" + (hot ? " hot" : "") }, h("div", { class: "kpi-l" }, l), h("div", { class: "kpi-v" }, String(v)), sub ? h("div", { class: "kpi-s" }, sub) : "");
      const rev = s.revenue.length ? s.revenue.map((r) => nf(r.total) + " " + r.currency).join(" · ") : "0";
      box.replaceChildren(
        me.role === "super_admin" && !me.totp_enabled ? h("div", { class: "banner" }, h("strong", {}, "Sécurité : "), "activez la double authentification pour protéger le compte super administrateur. ", h("button", { class: "ghost", onclick: () => { tab = "profile"; render(); } }, "Activer maintenant")) : "",
        h("div", { class: "kpis" },
          kpi("Annonces", s.properties.total, s.properties.available + " disponibles · " + s.properties.reserved + " réservées"),
          kpi("Clients inscrits", s.customers.total, "+" + s.customers.week + " cette semaine"),
          kpi("Demandes en attente", s.orders.pending, s.orders.confirmed + " acceptées", s.orders.pending > 0),
          kpi("Acomptes encaissés", rev, s.orders.cash_pending + " espèces à encaisser"),
          kpi("Messages non lus", counts.chat + s.messagesUnread, counts.chat + " chat · " + s.messagesUnread + " contact", counts.chat + s.messagesUnread > 0),
          kpi("Suggestions", counts.suggestions, "non lues")),
        h("div", { class: "two" },
          h("div", { class: "card" }, h("h2", {}, "Activité des 14 derniers jours"), barChart(s.days),
            h("div", { class: "legend" }, h("span", {}, h("b", { style: "background:#4f46e5" }), "Actions des clients"), h("span", {}, h("b", { style: "background:#f59e0b" }), "Demandes de réservation"))),
          h("div", { class: "card" }, h("h2", {}, "Disponibilité des biens"),
            meter("Disponibles", s.properties.available, s.properties.total), meter("Réservés", s.properties.reserved, s.properties.total), meter("Indisponibles", s.properties.unavailable, s.properties.total),
            h("h2", { style: "margin-top:14px" }, "Demandes"), meter("En attente", s.orders.pending, s.orders.pending + s.orders.confirmed + s.orders.rejected), meter("Acceptées", s.orders.confirmed, s.orders.pending + s.orders.confirmed + s.orders.rejected), meter("Refusées", s.orders.rejected, s.orders.pending + s.orders.confirmed + s.orders.rejected))),
        h("div", { class: "card" }, h("h2", {}, "Derniers événements"), ...(s.recent.length ? s.recent.map((n) => h("div", { class: "row", style: "padding:6px 0;border-bottom:1px solid var(--line)" }, h("span", {}, h("strong", {}, n.title), " ", h("span", { class: "muted" }, n.detail)), h("span", { class: "muted" }, when(n.created_at)))) : [h("p", { class: "muted" }, "Rien pour le moment.")])));
    }).catch((x) => box.replaceChildren(h("p", { class: "err" }, x.message)));
    return box;
  }

  function chatView() {
    let cur = 0;
    const list = h("div", { class: "chat-list" }), pane = h("div", { class: "chat-pane" }, h("p", { class: "muted", style: "padding:16px" }, "Sélectionnez une conversation."));
    let msgsBox = null, lastId = 0;
    async function loadList() {
      try {
        const rows = await api("/api/chat?a=admin_threads");
        list.replaceChildren(...(rows.length ? rows.map((t) => h("button", { class: "thread" + (t.id === cur ? " on" : ""), onclick: () => open(t) },
          h("div", { class: "row" }, h("strong", {}, t.kind === "support" ? t.a_name : t.a_name + " ↔ " + t.b_name), t.unread ? h("span", { class: "badge" }, String(t.unread)) : ""),
          h("small", {}, (t.kind === "direct" ? "Privé · " : "") + snip(t.last_body)))) : [h("p", { class: "muted", style: "padding:14px" }, "Aucune conversation.")]));
      } catch (e) {}
    }
    async function loadMsgs(first) {
      if (!cur || !msgsBox) return;
      try {
        const rows = await api("/api/chat?a=admin_messages&thread=" + cur);
        if (!first && rows.length && rows[rows.length - 1].id === lastId) return;
        lastId = rows.length ? rows[rows.length - 1].id : 0;
        msgsBox.replaceChildren(...rows.map((m) => h("div", { class: "msg" + (m.mine ? " mine" : "") }, h("small", {}, m.who + " · " + when(m.created_at)), m.body)));
        msgsBox.scrollTop = msgsBox.scrollHeight;
      } catch (e) {}
    }
    function open(t) {
      cur = t.id; lastId = 0;
      msgsBox = h("div", { class: "msgs" });
      const input = h("input", { placeholder: "Votre réponse…", maxlength: 2000 });
      const form = t.kind === "support" ? h("form", { class: "send", onsubmit: async (e) => { e.preventDefault(); if (!input.value.trim()) return; const v = input.value; input.value = ""; try { await api("/api/chat?a=admin_send", "POST", { thread: cur, body: v }); await loadMsgs(true); loadList(); } catch (x) { alert(x.message); } } }, input, h("button", { type: "submit" }, "Envoyer"))
        : h("p", { class: "muted", style: "padding:10px" }, "Conversation privée entre deux clients : lecture seule (modération).");
      pane.replaceChildren(h("div", { class: "row", style: "padding:12px;border-bottom:1px solid var(--line)" }, h("strong", {}, t.kind === "support" ? t.a_name + " · " + (t.a_email || "") : t.a_name + " ↔ " + t.b_name)), msgsBox, form);
      loadMsgs(true); loadList();
    }
    loadList(); pollTimer = setInterval(() => { loadList(); loadMsgs(false); }, 6000);
    return h("div", {}, h("h2", {}, "Messagerie"), h("div", { class: "chat" }, list, pane));
  }

  function suggestionsView() {
    return lazy("/api/console?a=suggestions", (rows, reload) => [h("h2", {}, rows.length + " suggestion(s)"), ...rows.map((s) => h("div", { class: "card" + (s.is_read ? "" : " unread") },
      h("div", { class: "row" }, h("strong", {}, s.name || "Client"), h("span", { class: "muted" }, when(s.created_at))), h("div", { class: "muted" }, s.email || ""),
      h("p", { style: "white-space:pre-wrap" }, s.message),
      h("button", { class: "ghost", onclick: async () => { await api("/api/console?a=suggestions&id=" + s.id, "PATCH", { read: !s.is_read }); reload(); } }, s.is_read ? "Marquer non lue" : "Marquer lue")))]);
  }
  function auditView() {
    return lazy("/api/console?a=audit", (rows) => [h("h2", {}, "Journal de sécurité (" + rows.length + ")"), ...rows.map((l) => h("div", { class: "card row" },
      h("div", {}, h("strong", {}, l.action), " ", h("span", { class: "muted" }, l.detail || ""), h("br"), h("span", { class: "muted" }, l.email || "système")), h("span", { class: "muted" }, when(l.created_at))))]);
  }

  function profileView() {
    const msg = h("p", { class: "err", role: "status" });
    const phone = h("input", { type: "tel", value: me.phone || "", placeholder: "+237 6XX XX XX XX" }), wa = h("input", { type: "checkbox" }); wa.checked = !!me.whatsapp_optin;
    const profile = h("form", { class: "card", onsubmit: async (e) => { e.preventDefault(); msg.textContent = ""; try { await api("/api/auth?a=profile", "POST", { phone: phone.value, whatsapp: wa.checked }); me.phone = phone.value; me.whatsapp_optin = wa.checked; msg.className = "ok"; msg.textContent = "Profil enregistré."; } catch (x) { msg.className = "err"; msg.textContent = x.message; } } },
      h("h2", {}, "Mon profil"), h("p", { class: "muted" }, me.email + " · " + (me.role === "super_admin" ? "Super administrateur" : "Administrateur")),
      field("Numéro WhatsApp (avec indicatif)", phone), h("br"), h("label", { class: "chk" }, wa, "Recevoir mes notifications sur WhatsApp quand je ne suis pas connecté"), msg, h("button", { type: "submit" }, "Enregistrer"));
    const pmsg = h("p", { class: "err" }), cur = h("input", { type: "password", autocomplete: "current-password" }), nxt = h("input", { type: "password", autocomplete: "new-password", minlength: 12 });
    const pw = h("form", { class: "card", onsubmit: async (e) => { e.preventDefault(); pmsg.textContent = ""; try { await api("/api/auth?a=password", "POST", { current: cur.value, next: nxt.value }); pmsg.className = "ok"; pmsg.textContent = "Mot de passe modifié."; cur.value = nxt.value = ""; } catch (x) { pmsg.className = "err"; pmsg.textContent = x.message; } } },
      h("h2", {}, "Changer le mot de passe"), h("div", { class: "grid" }, field("Mot de passe actuel", cur), field("Nouveau (12 caractères min.)", nxt)), pmsg, h("button", { type: "submit" }, "Modifier"));
    const tbox = h("div", { class: "card" }, h("h2", {}, "Double authentification (2FA)"));
    const tmsg = h("p", { class: "err" });
    const draw = () => {
      tbox.replaceChildren(h("h2", {}, "Double authentification (2FA)"));
      if (me.totp_enabled) {
        const pw2 = h("input", { type: "password" }), c2 = h("input", { inputmode: "numeric", maxlength: 8 });
        tbox.append(h("p", { class: "ok" }, "✓ Activée : un code est demandé à chaque connexion."), h("div", { class: "grid" }, field("Mot de passe", pw2), field("Code actuel", c2)), tmsg,
          h("button", { class: "danger", onclick: async () => { tmsg.textContent = ""; try { await api("/api/auth?a=totp_disable", "POST", { password: pw2.value, code: c2.value }); me.totp_enabled = false; draw(); } catch (x) { tmsg.textContent = x.message; } } }, "Désactiver"));
      } else {
        tbox.append(h("p", { class: "muted" }, "Utilisez une application comme Google Authenticator, Microsoft Authenticator ou Authy."), tmsg,
          h("button", { onclick: async () => { tmsg.textContent = ""; try {
            const r = await api("/api/auth?a=totp_setup", "POST", {}); const c3 = h("input", { inputmode: "numeric", maxlength: 8, placeholder: "Code à 6 chiffres" });
            tbox.replaceChildren(h("h2", {}, "Double authentification (2FA)"), h("p", {}, "1. Dans votre application, choisissez « Saisir une clé de configuration » et entrez cette clé :"), h("p", {}, h("code", { style: "font-size:1.1rem;word-break:break-all" }, r.secret)),
              h("p", { class: "muted" }, "(Sur téléphone, vous pouvez aussi ouvrir ce lien : "), h("a", { href: r.uri }, "ajouter automatiquement"), h("span", { class: "muted" }, ")"),
              h("p", {}, "2. Saisissez le code affiché pour confirmer :"), field("Code", c3), tmsg,
              h("button", { onclick: async () => { tmsg.textContent = ""; try { await api("/api/auth?a=totp_enable", "POST", { code: c3.value }); me.totp_enabled = true; draw(); } catch (x) { tmsg.textContent = x.message; } } }, "Activer la 2FA"));
          } catch (x) { tmsg.textContent = x.message; } } }, "Activer la double authentification"));
      }
    };
    draw();
    return h("div", {}, profile, pw, tbox);
  }

  const NAV = (sup) => [
    ["Pilotage", [["dashboard", "Tableau de bord"]]],
    ["Gestion", [["annonces", "Annonces"], ["orders", "Commandes", "pendingOrders"], ["clients", "Clients", null, 1]]],
    ["Communication", [["chat", "Messagerie", "chat"], ["notifs", "Notifications", "notifications"], ["messages", "Messages reçus"], ["suggestions", "Suggestions", "suggestions"]]],
    ["Contrôle", [["activity", "Activité des clients", null, 1], ["admins", "Administrateurs", null, 1], ["audit", "Journal de sécurité", null, 1], ["profile", "Mon profil"]]]
  ].map(([g, items]) => [g, items.filter((i) => !i[3] || sup)]).filter(([, items]) => items.length);

  async function render() {
    stopPoll();
    if (!me) { app.replaceChildren(loginView()); return; }
    try { counts = await api("/api/console?a=counts"); } catch (e) {}
    const sup = me.role === "super_admin";
    const nav = h("aside", { class: "side" }, h("div", { class: "brand" }, h("i", {}, "M"), "Maison Admin"));
    for (const [g, items] of NAV(sup)) {
      nav.append(h("div", { class: "grp" }, g));
      for (const [id, label, cnt] of items) {
        const n = cnt ? counts[cnt] : 0;
        nav.append(h("button", { class: "nav" + (tab === id || (tab === "form" && id === "annonces") ? " on" : ""), onclick: () => { tab = id; window._cust = null; render(); } }, h("span", {}, label), n ? h("span", { class: "badge" }, String(n)) : ""));
      }
    }
    nav.append(h("div", { class: "who" }, h("b", {}, me.name || me.email), sup ? "Super administrateur" : "Administrateur"));
    const body = tab === "form" ? propForm(window._edit) : tab === "messages" ? await messagesView() : tab === "admins" && sup ? await adminsView()
      : tab === "orders" ? ordersView() : tab === "notifs" ? notifsView() : tab === "clients" && sup ? customersView() : tab === "activity" && sup ? activityView()
      : tab === "chat" ? chatView() : tab === "suggestions" ? suggestionsView() : tab === "audit" && sup ? auditView() : tab === "profile" ? profileView()
      : tab === "annonces" ? listView() : dashboardView();
    const titles = { dashboard: "Tableau de bord", annonces: "Annonces", form: "Annonce", orders: "Commandes", clients: "Clients", chat: "Messagerie", notifs: "Notifications", messages: "Messages reçus", suggestions: "Suggestions", activity: "Activité des clients", admins: "Administrateurs", audit: "Journal de sécurité", profile: "Mon profil" };
    app.replaceChildren(h("div", { class: "shell" }, nav, h("section", { class: "main" },
      h("header", { class: "top" }, h("h1", {}, titles[tab] || "Tableau de bord"), h("div", { class: "row" },
        h("a", { class: "btn ghost", href: "/" }, "Voir le site"), h("button", { class: "ghost", onclick: async () => { await api("/api/auth?a=logout", "POST"); me = null; render(); } }, "Déconnexion"))),
      h("div", { class: "content" }, body))));
  }

  api("/api/auth?a=me").then(async (r) => { me = r.user; tab = "dashboard"; await load(); render(); }).catch(() => render());
})();
