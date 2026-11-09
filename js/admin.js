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
    const v = p || { operation: "sale", currency: "EUR", currencySymbol: "€", kind: "maison", kindLabel: "Maison", image: "assets/images/maison-verger.webp", rooms: 3, bedrooms: 2, bathrooms: 1, area: 80, features: [], published: true, order: props.length + 1 };
    const f = {};
    const mk = (name, type = "text", extra = {}) => (f[name] = h("input", { type, value: v[name] ?? "", ...extra }));
    mk("title"); mk("location"); mk("price", "number", { min: 0 }); mk("image"); mk("alt"); mk("kindLabel");
    mk("rooms", "number"); mk("bedrooms", "number"); mk("bathrooms", "number"); mk("area", "number"); mk("order", "number");
    f.description = h("textarea", {}, v.description || "");
    f.features = h("input", { value: (v.features || []).join(", ") });
    f.operation = h("select", {}, h("option", { value: "sale" }, "Vente"), h("option", { value: "rent" }, "Location")); f.operation.value = v.operation;
    f.kind = h("select", {}, ...["maison", "appartement", "loft"].map((k) => h("option", { value: k }, k))); f.kind.value = v.kind;
    f.currency = h("select", {}, ...Object.keys(SYM).map((c) => h("option", { value: c }, c))); f.currency.value = v.currency;
    const chk = (name, label) => { f[name] = h("input", { type: "checkbox" }); f[name].checked = !!v[name]; return h("label", { class: "chk" }, f[name], label); };
    const err = h("p", { class: "err", role: "alert" });
    const form = h("form", { class: "card", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = "";
      const body = { id: v.id, currencySymbol: SYM[f.currency.value] };
      for (const k of ["title", "location", "price", "image", "alt", "kindLabel", "rooms", "bedrooms", "bathrooms", "area", "order", "description", "operation", "kind", "currency"]) body[k] = f[k].value;
      body.features = f.features.value.split(",").map((s) => s.trim()).filter(Boolean);
      body.isNew = f.isNew.checked; body.isExclusive = f.isExclusive.checked; body.published = f.published.checked;
      try { await api("/api/properties", p ? "PUT" : "POST", body); await load(); tab = "annonces"; render(); } catch (x) { err.textContent = x.message; }
    } },
      h("h2", {}, p ? "Modifier l’annonce" : "Nouvelle annonce"),
      h("div", { class: "grid" }, field("Titre", f.title), field("Localisation", f.location), field("Prix", f.price), field("Devise", f.currency),
        field("Opération", f.operation), field("Type", f.kind), field("Libellé du type (ex. Villa)", f.kindLabel), field("Image (assets/images/… ou https)", f.image),
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
        h("div", {}, h("strong", {}, p.title), " ", h("span", { class: "pill" }, p.published ? "Publié" : "Masqué"), h("br"),
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

  async function render() {
    if (!me) { app.replaceChildren(loginView()); return; }
    const t = (id, label) => h("button", { class: id === tab || (tab === "form" && id === "annonces") ? "on" : "ghost", onclick: () => { tab = id; render(); } }, label);
    const tabs = h("div", { class: "tabs" }, t("annonces", "Annonces"), t("messages", "Messages"), me.role === "super_admin" ? t("admins", "Administrateurs") : "");
    const body = tab === "form" ? propForm(window._edit) : tab === "messages" ? await messagesView() : tab === "admins" ? await adminsView() : listView();
    app.replaceChildren(
      h("div", { class: "top" }, h("div", {}, h("h1", {}, "Administration"), h("span", { class: "muted" }, me.email + " · " + (me.role === "super_admin" ? "Super administrateur" : "Administrateur"))),
        h("div", { class: "row" }, h("a", { class: "btn ghost", href: "/", style: "text-decoration:none;border:1px solid var(--line);color:var(--ink);background:transparent" }, "Voir le site"),
          h("button", { class: "ghost", onclick: async () => { await api("/api/auth?a=logout", "POST"); me = null; render(); } }, "Déconnexion"))),
      tabs, body);
  }

  api("/api/auth?a=me").then(async (r) => { me = r.user; await load(); render(); }).catch(() => render());
})();
