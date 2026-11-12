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
    if (r.status === 401 && me && !path.includes("a=reset")) { me = null; render(); }
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

  // ----- Avatar, temps écoulé -----
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  function avatarEl(u, size) {
    return h("div", { class: "avatar" + (size ? " " + size : ""), "aria-hidden": "true" }, u.avatar ? h("img", { src: u.avatar, alt: "" }) : initials(u.name || u.email));
  }
  function toAvatar(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error("Choisissez une image (JPG, PNG ou WebP)."));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("Lecture de l’image impossible."));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Image illisible."));
        img.onload = () => {
          const s = 256, c = document.createElement("canvas"), side = Math.min(img.width, img.height);
          c.width = c.height = s;
          c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, s, s);
          resolve(c.toDataURL("image/jpeg", 0.82));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  const ago = (d) => {
    if (!d) return "jamais";
    const s = Math.max(0, Math.round((Date.now() - new Date(d)) / 1000));
    if (s < 60) return "à l’instant";
    if (s < 3600) return "il y a " + Math.round(s / 60) + " min";
    if (s < 86400) return "il y a " + Math.round(s / 3600) + " h";
    return "il y a " + Math.round(s / 86400) + " j";
  };

  // ----- Présence : l'administration signale chaque minute que l'utilisateur est en ligne -----
  let presence = "online";
  const presenceBadge = () => h("span", { class: "presence " + presence, "data-presence": "" }, presence === "online" ? "En ligne" : "Hors ligne");
  function paintPresence() {
    document.querySelectorAll("[data-presence]").forEach((el) => { el.className = "presence " + presence; el.textContent = presence === "online" ? "En ligne" : "Hors ligne"; });
  }
  async function beat() {
    if (!me) return;
    try {
      const r = await fetch("/api/auth?a=ping", { credentials: "same-origin" });
      if (r.status === 401) { me = null; render(); return; }
      presence = r.ok ? "online" : "offline";
    } catch (e) { presence = "offline"; }
    paintPresence();
  }
  setInterval(() => { if (!document.hidden) beat(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) beat(); });
  window.addEventListener("online", beat);
  window.addEventListener("offline", () => { presence = "offline"; paintPresence(); });

  // Écran d'accès : connexion, mot de passe oublié, réinitialisation (lien reçu par e-mail : /admin#reset=…)
  function loginView() {
    const tk = (location.hash.match(/^#reset=([a-f0-9]{64})$/) || [])[1];
    if (tk) return resetView(tk);
    if (window._authMode === "forgot") return forgotView();
    const note = window._authNote; window._authNote = null;
    const err = h("p", { class: "err", role: "alert" });
    const email = h("input", { type: "email", required: true, autocomplete: "username" });
    const pw = h("input", { type: "password", required: true, autocomplete: "current-password" });
    const code = h("input", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: 8, placeholder: "123456" });
    const codeBox = h("div", { hidden: true }, h("br"), field("Code de double authentification", code));
    const form = h("form", { class: "card login", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = "";
      try { await api("/api/auth?a=login", "POST", { email: email.value, password: pw.value, code: code.value }); me = (await api("/api/auth?a=me")).user; presence = "online"; await load(); render(); }
      catch (x) { err.textContent = x.message; if (x.data && x.data.needCode) { codeBox.hidden = false; code.focus(); } }
    } }, h("h1", {}, "Administration"), h("p", { class: "muted" }, "Connexion réservée aux administrateurs."), note ? h("p", { class: "ok", role: "status" }, note) : "",
      field("E-mail", email), h("br"), field("Mot de passe", pw), codeBox, err, h("button", { type: "submit" }, "Se connecter"),
      h("p", { style: "margin:14px 0 0;text-align:center" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); window._authMode = "forgot"; render(); } }, "Mot de passe oublié ?")));
    return form;
  }
  function forgotView() {
    const err = h("p", { class: "err", role: "alert" }), done = h("p", { class: "ok", role: "status" });
    const email = h("input", { type: "email", required: true, autocomplete: "username" });
    const btn = h("button", { type: "submit" }, "Envoyer le lien");
    return h("form", { class: "card login", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ""; done.textContent = ""; btn.disabled = true;
      try {
        const r = await api("/api/auth?a=forgot", "POST", { email: email.value });
        if (r.mail === false) err.textContent = "L’envoi d’e-mails n’est pas encore configuré sur ce site (variables RESEND_API_KEY et MAIL_FROM). Contactez l’hébergeur du site.";
        else done.textContent = "Si un compte administrateur correspond à cette adresse, un lien de réinitialisation vient d’être envoyé (valable 30 minutes). Pensez à vérifier vos courriers indésirables.";
      } catch (x) { err.textContent = x.message; }
      btn.disabled = false;
    } }, h("h1", {}, "Mot de passe oublié"), h("p", { class: "muted" }, "Saisissez votre e-mail : nous vous enverrons un lien pour choisir un nouveau mot de passe."),
      field("E-mail", email), done, err, btn,
      h("p", { style: "margin:14px 0 0;text-align:center" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); window._authMode = null; render(); } }, "Retour à la connexion")));
  }
  function resetView(token) {
    const err = h("p", { class: "err", role: "alert" });
    const p1 = h("input", { type: "password", required: true, minlength: 12, autocomplete: "new-password" }), p2 = h("input", { type: "password", required: true, minlength: 12, autocomplete: "new-password" });
    const code = h("input", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: 8, placeholder: "123456" });
    const codeBox = h("div", { hidden: true }, h("br"), field("Code de double authentification", code));
    return h("form", { class: "card login", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = "";
      if (p1.value !== p2.value) { err.textContent = "Les deux mots de passe ne correspondent pas."; return; }
      try {
        await api("/api/auth?a=reset", "POST", { token, password: p1.value, code: code.value });
        history.replaceState(null, "", location.pathname); window._authMode = null; window._authNote = "Mot de passe modifié. Connectez-vous avec le nouveau.";
        render();
      } catch (x) { err.textContent = x.message; if (x.data && x.data.needCode) { codeBox.hidden = false; code.focus(); } }
    } }, h("h1", {}, "Nouveau mot de passe"), h("p", { class: "muted" }, "Choisissez un mot de passe d’au moins 12 caractères."),
      field("Nouveau mot de passe", p1), h("br"), field("Confirmer", p2), codeBox, err, h("button", { type: "submit" }, "Enregistrer le mot de passe"),
      h("p", { style: "margin:14px 0 0;text-align:center" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); history.replaceState(null, "", location.pathname); window._authMode = null; render(); } }, "Retour à la connexion")));
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

  // Ligne d'une annonce, avec les actions : modifier, archiver / restaurer, supprimer
  function propRow(p) {
    const refresh = async () => { await load(); render(); };
    return h("div", { class: "card row" + (p.archived ? " archived" : "") },
      h("div", {}, h("strong", {}, p.title), " ", h("span", { class: "pill" }, p.archived ? "Archivée" : p.published ? "Publié" : "Masqué"), " ", h("span", { class: "pill" }, AVL[p.availability] || "Disponible"), h("br"),
        h("span", { class: "muted" }, p.location + " · " + new Intl.NumberFormat("fr-FR").format(p.price) + " " + p.currencySymbol + (p.priceSuffix || ""))),
      h("div", { class: "row" },
        p.archived ? "" : h("button", { class: "ghost", onclick: () => { tab = "form"; window._edit = p; render(); } }, "Modifier"),
        p.archived
          ? h("button", { class: "ghost", onclick: async () => { try { await api("/api/properties?id=" + encodeURIComponent(p.id), "PATCH", { archived: false }); await refresh(); } catch (x) { alert(x.message); } } }, "Restaurer")
          : h("button", { class: "danger", onclick: async () => {
            if (!confirm("Supprimer « " + p.title + " » ? Elle sera retirée du site et placée dans les archives, d’où vous pourrez la restaurer.")) return;
            try { await api("/api/properties?id=" + encodeURIComponent(p.id), "PATCH", { archived: true }); await refresh(); } catch (x) { alert(x.message); }
          } }, "Supprimer"),
        p.archived && me.role === "super_admin" ? h("button", { class: "danger", onclick: async () => {
          if (!confirm("Supprimer DÉFINITIVEMENT « " + p.title + " » ? Cette action est irréversible.")) return;
          try { await api("/api/properties?id=" + encodeURIComponent(p.id), "DELETE"); await refresh(); } catch (x) { alert(x.message); }
        } }, "Supprimer définitivement") : ""));
  }

  let propFilter = "active";
  function listView() {
    const nArch = props.filter((p) => p.archived).length;
    const shown = props.filter((p) => (propFilter === "all" ? true : propFilter === "archived" ? p.archived : !p.archived));
    const bar = h("div", { class: "tabs-in", style: "margin-bottom:12px" }, ...[["active", "Actives (" + (props.length - nArch) + ")"], ["archived", "Archives (" + nArch + ")"], ["all", "Toutes (" + props.length + ")"]]
      .map(([k, l]) => h("button", { class: k === propFilter ? "" : "ghost", onclick: () => { propFilter = k; render(); } }, l)));
    return h("div", {}, h("div", { class: "row", style: "margin-bottom:10px" }, h("h2", {}, shown.length + " annonce(s)"),
      h("button", { onclick: () => { tab = "form"; window._edit = null; render(); } }, "+ Ajouter")), bar,
      ...(shown.length ? shown.map(propRow) : [h("p", { class: "muted" }, propFilter === "archived" ? "Les archives sont vides." : "Aucune annonce dans cette catégorie.")]));
  }

  // Carte du tableau de bord : gérer les maisons sans quitter la page d'accueil de l'administration
  function housesCard() {
    const live = props.filter((p) => !p.archived);
    return h("div", { class: "card" }, h("div", { class: "row", style: "margin-bottom:10px" }, h("h2", { style: "margin:0" }, "Gérer les maisons"),
      h("button", { onclick: () => { tab = "form"; window._edit = null; render(); } }, "+ Ajouter une maison")),
      ...(live.length ? live.slice(0, 5).map(propRow) : [h("p", { class: "muted" }, "Aucune annonce active.")]),
      h("div", { class: "row" }, h("span", { class: "muted" }, (props.length - live.length) + " dans les archives"),
        h("button", { class: "ghost", onclick: () => { tab = "annonces"; render(); } }, "Toutes les annonces (" + props.length + ")")));
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
            u.id !== me.id ? h("button", { class: "ghost", onclick: async () => { if (!confirm("Fermer toutes les sessions de " + u.email + " ?")) return; await api("/api/admins?id=" + u.id, "PATCH", { disconnect: true }); alert("Session fermée."); } }, "Déconnecter") : "",
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
        Number(o.amount) > 0 ? h("div", { class: "row" }, h("span", {}, "Acompte : " + new Intl.NumberFormat("fr-FR").format(o.amount) + " " + o.currency + " — " + ({ none: "à payer", pending: "paiement en cours", failed: "paiement échoué", paid: "payé ✓", cash_pending: "à confirmer (espèces / mobile money)" })[o.payment_status] + (o.payment_method ? " · " + o.payment_method : "")),
          o.payment_status === "cash_pending" ? h("button", { onclick: async () => { await api("/api/pay?a=markpaid", "POST", { orderId: o.id }); reload(); } }, "Paiement reçu : confirmer") : "") : "",
        o.status === "pending" ? h("div", { class: "row" },
          h("button", { onclick: async () => { await api("/api/orders?admin=1", "PATCH", { id: o.id, status: "confirmed" }); reload(); } }, "Accepter (bien réservé)"),
          h("button", { class: "danger", onclick: async () => { await api("/api/orders?admin=1", "PATCH", { id: o.id, status: "rejected" }); reload(); } }, "Refuser")) : "",
        me.role === "super_admin" && o.payment_status !== "paid" ? h("div", { class: "row" }, h("button", { class: "danger", onclick: async () => { if (!confirm("Supprimer définitivement cette demande ?")) return; try { await api("/api/orders?admin=1&id=" + o.id, "DELETE"); reload(); } catch (x) { alert(x.message); } } }, "Supprimer la demande")) : ""))]);
  }
  function notifsView() {
    return lazy("/api/console?a=notifications", (rows) => {
      if (rows.some((n) => !n.is_read)) api("/api/console?a=notifications", "POST").catch(() => {});
      return [h("h2", {}, rows.length + " notification(s)"), ...rows.map((n) => h("div", { class: "card" + (n.is_read ? "" : " unread") },
        h("div", { class: "row" }, h("strong", {}, n.title), h("span", { class: "muted" }, when(n.created_at))), h("div", { class: "muted" }, n.detail)))];
    });
  }
  function customerCard(c, reload) {
    const box = h("div", { class: "card" });
    const url = "/api/console?a=customers&id=" + c.id;
    const act = async (fn) => { try { await fn(); reload(); } catch (x) { alert(x.message); } };
    const edit = () => {
      const n = h("input", { value: c.name, maxlength: 100 }), e = h("input", { type: "email", value: c.email }), t = h("input", { type: "tel", value: c.phone || "" }), err = h("p", { class: "err", role: "alert" });
      box.replaceChildren(h("form", { onsubmit: async (ev) => { ev.preventDefault(); err.textContent = ""; try { await api(url, "PATCH", { name: n.value, email: e.value, phone: t.value }); reload(); } catch (x) { err.textContent = x.message; } } },
        h("h2", {}, "Modifier le client"), h("div", { class: "grid" }, field("Nom", n), field("E-mail", e), field("Téléphone", t)), err,
        h("div", { class: "row" }, h("button", { type: "submit" }, "Enregistrer"), h("button", { type: "button", class: "ghost", onclick: view }, "Annuler"))));
    };
    const view = () => box.replaceChildren(h("div", { class: "row" },
      h("div", {}, h("span", { class: "dot " + (c.online ? "on" : "off") }), h("strong", {}, c.name), " ", c.online ? h("span", { class: "presence online" }, "En ligne") : "", c.active ? "" : h("span", { class: "pill" }, "Désactivé"), h("br"),
        h("span", { class: "muted" }, c.email + (c.phone ? " · " + c.phone : "")), h("br"),
        h("span", { class: "muted" }, "Inscrit le " + when(c.created_at) + " · " + c.orders + " demande(s) · " + c.actions + " action(s) · " + (c.online ? "actif maintenant" : "vu " + ago(c.last_seen)))),
      h("div", { class: "row" },
        h("button", { class: "ghost", onclick: () => { window._cust = c.id; tab = "activity"; render(); } }, "Activité"),
        h("button", { class: "ghost", onclick: edit }, "Modifier"),
        h("button", { class: "ghost", onclick: () => { const p = prompt("Nouveau mot de passe pour " + c.email + " (8 caractères min.)"); if (p) act(async () => { await api(url, "PATCH", { password: p }); alert("Mot de passe modifié. Le client a été déconnecté."); }); } }, "Mot de passe"),
        c.online ? h("button", { class: "ghost", onclick: () => { if (confirm("Déconnecter " + c.name + " maintenant ?")) act(() => api(url, "PATCH", { disconnect: true })); } }, "Déconnecter") : "",
        h("button", { class: c.active ? "danger" : "ghost", onclick: () => act(() => api(url, "PATCH", { active: !c.active })) }, c.active ? "Désactiver" : "Réactiver"),
        h("button", { class: "danger", onclick: () => { if (confirm("Supprimer le compte de " + c.name + " (" + c.email + ") ? Il sera placé dans les archives (connexion bloquée) et vous pourrez le restaurer.")) act(() => api(url, "PATCH", { archived: true })); } }, "Supprimer"))));
    if (c.archived_at) box.replaceChildren(h("div", { class: "row archived" },
      h("div", {}, h("strong", {}, c.name), " ", h("span", { class: "pill" }, "Archivé"), h("br"), h("span", { class: "muted" }, c.email + " · " + c.orders + " demande(s) · inscrit le " + when(c.created_at))),
      h("div", { class: "row" },
        h("button", { class: "ghost", onclick: () => act(() => api(url, "PATCH", { archived: false })) }, "Restaurer"),
        h("button", { class: "danger", onclick: () => { if (confirm("Supprimer DÉFINITIVEMENT le compte de " + c.name + " avec ses demandes et son historique ? Irréversible.")) act(() => api(url, "DELETE")); } }, "Supprimer définitivement"))));
    view();
    return box;
  }
  let custFilter = "active";
  function customersView() {
    const bar = h("div", { class: "tabs-in", style: "margin-bottom:12px" }, ...[["active", "Comptes actifs"], ["archived", "Archives"]]
      .map(([k, l]) => h("button", { class: k === custFilter ? "" : "ghost", onclick: () => { custFilter = k; render(); } }, l)));
    const list = lazy("/api/console?a=customers" + (custFilter === "archived" ? "&archived=1" : ""), (rows, reload) => [
      h("div", { class: "row", style: "margin-bottom:10px" }, h("h2", {}, custFilter === "archived" ? rows.length + " compte(s) archivé(s)" : rows.length + " client(s) inscrit(s)"),
        custFilter === "archived" ? "" : h("span", { class: "muted" }, rows.filter((c) => c.online).length + " en ligne")),
      ...(rows.length ? rows.map((c) => customerCard(c, reload)) : [h("p", { class: "muted" }, "Aucun compte ici.")])]);
    return h("div", {}, bar, list);
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
        housesCard(),
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
        msgsBox.replaceChildren(...rows.map((m) => h("div", { class: "msg" + (m.mine ? " mine" : "") }, h("small", {}, m.who + " · " + when(m.created_at)), m.body,
          me.role === "super_admin" ? h("button", { class: "msg-del", title: "Supprimer ce message", onclick: async () => { if (!confirm("Supprimer ce message ?")) return; try { await api("/api/chat?a=admin_delete_message", "POST", { id: m.id }); await loadMsgs(true); loadList(); } catch (x) { alert(x.message); } } }, "Supprimer") : "")));
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

  // ----- WhatsApp par QR code (service géré) : statut, QR, test, déconnexion -----
  function whatsappView() {
    const box = h("div", { class: "card wa" });
    let busy = false, lastQr = 0, qrImg = null, st = null, note = "", noteErr = false;
    const phone = h("input", { type: "tel", placeholder: "Numéro de test (ex. +237 699 12 34 56)", autocomplete: "off" });
    const say = (t, err) => { note = t; noteErr = !!err; draw(); };
    const act = async (fn) => { if (busy) return; busy = true; draw(); try { await fn(); } catch (e) { say(e.message, true); } busy = false; await refresh(true); };
    const pill = (cls, t) => h("span", { class: "wa-pill " + cls }, t);
    function draw() {
      const head = h("div", { class: "wa-title" }, h("h2", {}, "WhatsApp par QR code"), h("span", { class: "wa-badge" }, "Service géré"));
      const foot = h("p", { class: "muted wa-note" }, "Solution non officielle : le numéro peut être bloqué par WhatsApp et les messages transitent par le prestataire. Utilisez un numéro dédié à l’entreprise.");
      const kids = [head];
      if (!st) kids.push(h("p", { class: "muted" }, "Chargement…"));
      else if (!st.configured) kids.push(h("p", {}, "Le service n’est pas encore relié au site."), h("p", { class: "muted" }, "Ajoutez WA_GATEWAY_URL et WA_GATEWAY_KEY dans Vercel (voir LISEZ-MOI), puis redéployez." + (st.meta ? " Les notifications passent pour l’instant par l’API Cloud de Meta." : "")));
      else {
        const label = { connected: ["wa-ok", "Connecté"], qr: ["wa-warn", "En attente du scan"], starting: ["wa-warn", "Démarrage…"], failed: ["wa-bad", "Échec"], stopped: ["wa-off", "Déconnecté"], unreachable: ["wa-bad", "Service injoignable"] }[st.state] || ["wa-off", "Déconnecté"];
        kids.push(h("div", { class: "row" }, pill(label[0], label[1]), h("button", { class: "ghost wa-ref", title: "Actualiser", "aria-label": "Actualiser", onclick: () => refresh(true) }, "↻")));
        if (st.state === "connected") {
          if (st.number || st.name) kids.push(h("p", { class: "muted" }, [st.name, st.number].filter(Boolean).join(" · ")));
          kids.push(phone, h("button", { disabled: busy, onclick: () => act(async () => { await api("/api/console?a=wa_test", "POST", { phone: phone.value }); say("Message de test envoyé."); }) }, "Envoyer le test"),
            h("button", { class: "ghost", disabled: busy, onclick: () => { if (confirm("Déconnecter ce numéro de WhatsApp ?")) act(async () => { await api("/api/console?a=wa_logout", "POST", {}); qrImg = null; }); } }, "Déconnecter le numéro"));
        } else if (st.state === "qr") {
          kids.push(qrImg ? h("img", { class: "wa-qr", src: qrImg, alt: "QR code WhatsApp", width: 240, height: 240 }) : h("p", { class: "muted" }, "Génération du QR code…"),
            h("p", { class: "muted" }, "Sur le téléphone : WhatsApp > Paramètres > Appareils connectés > Connecter un appareil, puis scannez ce code."));
        } else if (st.state !== "unreachable") {
          kids.push(h("p", { class: "muted" }, "Aucun numéro connecté : les notifications WhatsApp ne partent pas."), h("button", { disabled: busy, onclick: () => act(async () => { await api("/api/console?a=wa_start", "POST", {}); }) }, "Générer le QR code"));
        } else kids.push(h("p", { class: "muted" }, "Le serveur WhatsApp ne répond pas. Vérifiez que le service tourne sur le VPS."));
      }
      if (note) kids.push(h("p", { class: noteErr ? "wa-err" : "wa-okmsg", role: "status" }, note));
      kids.push(foot);
      box.replaceChildren(...kids);
    }
    async function refresh(force) {
      try {
        st = await api("/api/console?a=wa_status");
        if (st.state === "qr" && (force || Date.now() - lastQr > 15000)) { lastQr = Date.now(); const q = await api("/api/console?a=wa_qr"); qrImg = q.image || qrImg; }
        if (st.state !== "qr") qrImg = null;
      } catch (e) { st = { configured: true, state: "unreachable" }; }
      draw();
    }
    draw(); refresh(true);
    const timer = setInterval(() => { if (!box.isConnected) return clearInterval(timer); if (!busy) refresh(false); }, 4000);
    return box;
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

    // Identité : photo, nom d'affichage, ville, présentation, et état de présence
    let avatar = me.avatar || "";
    const nm = h("input", { value: me.name || "", maxlength: 100 }), city = h("input", { value: me.city || "", maxlength: 80 }), bio = h("textarea", { maxlength: 500 }, me.bio || "");
    const imsg = h("p", { class: "err", role: "status" }), slot = h("div", { class: "avatar-slot" }, avatarEl(me, "lg"));
    const repaint = () => slot.replaceChildren(avatarEl({ name: nm.value || me.name, email: me.email, avatar }, "lg"));
    nm.addEventListener("input", repaint);
    const file = h("input", { type: "file", accept: "image/*", hidden: true, onchange: async (e) => {
      imsg.textContent = "";
      try { avatar = await toAvatar(e.target.files[0]); repaint(); } catch (x) { imsg.className = "err"; imsg.textContent = x.message; } finally { e.target.value = ""; }
    } });
    const flash = window._flash; window._flash = null;
    const identity = h("form", { class: "card", onsubmit: async (e) => {
      e.preventDefault(); imsg.textContent = "";
      try {
        const r = await api("/api/auth?a=profile", "POST", { name: nm.value, phone: me.phone || "", whatsapp: !!me.whatsapp_optin, city: city.value, bio: bio.value, avatar });
        Object.assign(me, r.user); window._flash = "Profil enregistré."; render();
      } catch (x) { imsg.className = "err"; imsg.textContent = x.message; }
    } },
      h("div", { class: "who-card" }, slot, h("div", {}, h("strong", { style: "font-size:1.1rem" }, me.name || me.email), " ", presenceBadge(), h("br"),
        h("span", { class: "muted" }, me.email + " · " + (me.role === "super_admin" ? "Super administrateur" : "Administrateur")), h("br"),
        h("span", { class: "muted" }, "Votre statut est visible par le super administrateur dans Supervision > Utilisateurs."))),
      h("div", { class: "row", style: "justify-content:flex-start;margin-bottom:12px" },
        h("button", { type: "button", class: "ghost", onclick: () => file.click() }, avatar ? "Changer la photo" : "Ajouter une photo"),
        avatar ? h("button", { type: "button", class: "ghost", onclick: () => { avatar = ""; repaint(); } }, "Retirer") : "", file),
      h("div", { class: "grid" }, field("Nom affiché", nm), field("Ville", city)), h("br"), field("Présentation", bio), flash ? h("p", { class: "ok" }, flash) : "", imsg,
      h("button", { type: "submit" }, "Enregistrer mon profil"));
    return h("div", {}, identity, profile, pw, tbox);
  }


  // ================= SUPERVISION (super administrateur) =================
  let supTab = "overview";
  const bytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko");
  const dot = (ok) => h("span", { style: "display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;background:" + (ok ? "#12805c" : "#c0392b") });
  const sevColor = { critique: "#c0392b", haute: "#e06c00", moyenne: "#b7791f", basse: "#6a7189" };
  const sevPill = (s) => h("span", { class: "pill", style: "color:#fff;border:0;background:" + (sevColor[s] || "#6a7189") }, s);
  const table = (heads, rows) => h("div", { style: "overflow-x:auto" }, h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, ...heads.map((x) => h("th", {}, x)))), h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r.map((c) => h("td", {}, c)))))));
  const panel = (path, build) => { const box = h("div", {}, h("p", { class: "muted" }, "Analyse en cours…")); api(path).then((d) => box.replaceChildren(...build(d, () => box.replaceWith(panel(path, build))))).catch((x) => box.replaceChildren(h("p", { class: "err" }, x.message))); return box; };

  function overviewPanel() {
    return panel("/api/monitor?a=overview", (d, reload) => {
      const ev = d.events24, tot = d.stats.reduce((s, x) => s + x.n, 0), e5 = d.stats.filter((x) => x.class === "5xx").reduce((s, x) => s + x.n, 0), ms = d.stats.reduce((s, x) => s + Number(x.ms), 0);
      const bad = (ev.error || 0) > 0 || d.checks.some((c) => !c.ok) || d.ips.some((i) => i.n >= 15);
      const byApi = {}; d.stats.forEach((x) => { const a = (byApi[x.api] ||= { n: 0, c4: 0, c5: 0, ms: 0 }); a.n += x.n; a.ms += Number(x.ms); if (x.class === "4xx") a.c4 += x.n; if (x.class === "5xx") a.c5 += x.n; });
      const kpi = (l, v, s, hot) => h("div", { class: "kpi" + (hot ? " hot" : "") }, h("div", { class: "kpi-l" }, l), h("div", { class: "kpi-v" }, String(v)), s ? h("div", { class: "kpi-s" }, s) : "");
      return [
        h("div", { class: "banner", style: bad ? "" : "background:rgba(18,128,92,.1);border-color:#12805c" }, dot(!bad), h("strong", {}, bad ? "Attention : des points demandent votre examen." : "Tout est normal."), " Données des dernières 24 h. ", h("button", { class: "ghost", onclick: reload }, "Actualiser")),
        h("div", { class: "kpis" },
          kpi("Requêtes API (7 j)", nf(tot), "Temps moyen " + (tot ? Math.round(ms / tot) : 0) + " ms"),
          kpi("Erreurs serveur (24 h)", ev.error || 0, "Taux 7 j : " + (tot ? ((e5 / tot) * 100).toFixed(2) : 0) + " %", (ev.error || 0) > 0),
          kpi("Tentatives suspectes (24 h)", ev.security || 0, "401 / 403 / 429", (ev.security || 0) > 10),
          kpi("Incohérences API (24 h)", (ev.contract || 0) + (ev.validation || 0), (ev.contract || 0) + " route inconnue · " + (ev.validation || 0) + " requête invalide"),
          kpi("Bugs navigateur (24 h)", ev.client || 0, "erreurs JavaScript chez les visiteurs", (ev.client || 0) > 0),
          kpi("Journal", nf(d.logSize), "événements conservés (30 j)")),
        h("div", { class: "two" },
          h("div", { class: "card" }, h("h2", {}, "Trafic API sur 14 jours"), barChart(d.daily.map((x) => ({ day: x.day, actions: x.n, orders: x.errors }))),
            h("div", { class: "legend" }, h("span", {}, h("b", { style: "background:#4f46e5" }), "Requêtes"), h("span", {}, h("b", { style: "background:#f59e0b" }), "Erreurs 5xx"))),
          h("div", { class: "card" }, h("h2", {}, "Contrôles automatiques"), ...(d.checks.length ? d.checks.map((c) => h("div", { style: "padding:5px 0;border-bottom:1px solid var(--line)" }, dot(c.ok), h("strong", {}, c.name), h("div", { class: "muted", style: "margin-left:18px;font-size:.82rem" }, c.detail + " · " + when(c.at)))) : [h("p", { class: "muted" }, "Pas encore de contrôle quotidien (il s’exécute chaque matin à 5 h UTC une fois CRON_SECRET configuré).")]))),
        h("div", { class: "card" }, h("h2", {}, "Détail par API (7 jours)"), table(["API", "Requêtes", "Erreurs 4xx", "Erreurs 5xx", "Temps moyen"], Object.entries(byApi).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, nf(v.n), String(v.c4), v.c5 ? h("strong", { style: "color:#c0392b" }, String(v.c5)) : "0", Math.round(v.ms / v.n) + " ms"]))),
        h("div", { class: "card" }, h("h2", {}, "Adresses IP les plus suspectes (24 h)"), d.ips.length ? table(["Adresse IP", "Événements", "Échecs de connexion", "Dernier"], d.ips.map((i) => [i.ip, String(i.n), String(i.fails), when(i.last)])) : h("p", { class: "muted" }, "Aucune activité suspecte."))];
    });
  }

  function dbPanel() {
    return panel("/api/monitor?a=db", (d, reload) => {
      const s = d.stats, hit = Number(s.blks_hit) + Number(s.blks_read) ? (Number(s.blks_hit) / (Number(s.blks_hit) + Number(s.blks_read))) * 100 : 100;
      const kpi = (l, v, sub, hot) => h("div", { class: "kpi" + (hot ? " hot" : "") }, h("div", { class: "kpi-l" }, l), h("div", { class: "kpi-v" }, String(v)), sub ? h("div", { class: "kpi-s" }, sub) : "");
      return [h("div", { class: "row", style: "margin-bottom:10px" }, h("p", { class: "muted", style: "margin:0" }, "PostgreSQL " + d.version + " (Neon)"), h("button", { class: "ghost", onclick: reload }, "Actualiser")),
        h("div", { class: "kpis" }, kpi("Latence", d.latency + " ms", "aller-retour vers la base", d.latency > 400), kpi("Taille de la base", bytes(d.size), "stockage utilisé"), kpi("Connexions", s.numbackends, d.conns.map((c) => c.state + " : " + c.n).join(" · ")),
          kpi("Cache mémoire", hit.toFixed(1) + " %", "lectures servies sans disque", hit < 90), kpi("Transactions", nf(Number(s.xact_commit)), nf(Number(s.xact_rollback)) + " annulées", Number(s.xact_rollback) > Number(s.xact_commit) * 0.05), kpi("Blocages (deadlocks)", s.deadlocks, "fichiers temporaires : " + s.temp_files, Number(s.deadlocks) > 0)),
        h("div", { class: "card" }, h("h2", {}, "Tables"), table(["Table", "Lignes", "Lignes mortes", "Taille", "Lectures complètes", "Lectures par index"], d.tables.map((x) => [x.relname, nf(Number(x.rows)), String(x.dead), bytes(Number(x.size)), String(x.seq), String(x.idx)]))),
        h("div", { class: "card" }, h("h2", {}, "Requêtes en cours"), d.running.length ? table(["Durée", "État", "Requête"], d.running.map((r) => [r.secs.toFixed(1) + " s", r.state, r.q])) : h("p", { class: "muted" }, "Aucune requête active.")),
        h("div", { class: "card" }, h("h2", {}, "Requêtes les plus lentes"), d.slow.length ? table(["Moyenne", "Appels", "Total", "Requête"], d.slow.map((r) => [r.mean_ms + " ms", nf(Number(r.calls)), nf(r.total_ms) + " ms", r.q])) : h("p", { class: "muted" }, "Aucune donnée.")),
        h("p", { class: "muted" }, "Pour le processeur, la mémoire et la facturation de la base, ouvrez aussi la console Neon (onglet Monitoring).")];
    });
  }

  function serverPanel() {
    return panel("/api/monitor?a=server", (d, reload) => {
      const r = d.runtime, dep = d.deployments, hd = d.probes.find((p) => p.path === "/")?.headers;
      const HL = { csp: "Content-Security-Policy", hsts: "HSTS (HTTPS forcé)", nosniff: "X-Content-Type-Options", frame: "Anti-clickjacking", referrer: "Referrer-Policy", coop: "Cross-Origin-Opener-Policy" };
      return [h("div", { class: "row", style: "margin-bottom:10px" }, h("p", { class: "muted", style: "margin:0" }, "Hébergement serverless Vercel : pas de serveur à maintenir, mais des fonctions à surveiller."), h("button", { class: "ghost", onclick: reload }, "Actualiser")),
        h("div", { class: "two" },
          h("div", { class: "card" }, h("h2", {}, "Environnement d’exécution"), table(["Élément", "Valeur"], [["Node.js", r.node], ["Région", r.region], ["Environnement", r.env], ["Version déployée", (r.commit || "?") + (r.message ? " — " + r.message : "")], ["Auteur du commit", r.author || "?"], ["Mémoire de l’instance", r.memMb + " Mo"], ["Âge de l’instance", r.instanceAgeSec + " s"]])),
          h("div", { class: "card" }, h("h2", {}, "Configuration des secrets"), ...d.config.map((c) => h("div", { style: "padding:4px 0" }, dot(c.set), c.label, c.set ? "" : h("span", { class: "muted" }, " — non configuré"))))),
        h("div", { class: "card" }, h("h2", {}, "Sondes de disponibilité"), table(["Adresse", "Statut", "Temps", "Remarque"], d.probes.map((p) => [p.path, h("span", {}, dot(p.status >= 200 && p.status < 400), String(p.status || "erreur")), p.ms + " ms", p.error || ""]))),
        hd ? h("div", { class: "card" }, h("h2", {}, "En-têtes de sécurité du site"), ...Object.entries(HL).map(([k, l]) => h("div", { style: "padding:3px 0" }, dot(hd[k]), l))) : "",
        h("div", { class: "card" }, h("h2", {}, "Derniers déploiements"),
          !dep.configured ? h("p", { class: "muted" }, "Pour voir l’historique des déploiements, ajoutez dans Vercel une variable SUPERVISION_VERCEL_TOKEN (jeton Vercel en lecture : Account Settings > Tokens).") : dep.error ? h("p", { class: "err" }, dep.error)
          : table(["État", "Cible", "Date", "Commit", "Auteur"], dep.list.map((x) => [h("span", {}, dot(x.state === "READY"), x.state), x.target, when(x.created), (x.sha ? x.sha + " " : "") + x.commit, x.author]))),
        h("p", { class: "muted" }, "Journaux bruts de la plateforme (invocations, erreurs de build) : tableau de bord Vercel > Logs. Les erreurs de l’application sont détaillées dans l’onglet « Application & API ».")];
    });
  }

  function eventsPanel(kinds, intro) {
    let kind = kinds[0][0];
    const box = h("div", {});
    const load = () => { box.replaceChildren(h("p", { class: "muted" }, "Chargement…")); api("/api/monitor?a=events&kind=" + kind).then((rows) => {
      box.replaceChildren(rows.length ? table(["Date", "API", "Action", "Statut", "Durée", "IP", "Détail"], rows.map((e) => [when(e.at), e.api, (e.method ? e.method + " " : "") + (e.action || ""), String(e.status || ""), e.ms + " ms", e.ip, h("span", { style: "word-break:break-word" }, e.detail || "")])) : h("p", { class: "muted" }, "Rien à signaler sur cette catégorie. 👍"));
    }).catch((x) => box.replaceChildren(h("p", { class: "err" }, x.message))); };
    const bar = h("div", { class: "tabs-in" }, ...kinds.map(([k, l]) => h("button", { class: k === kind ? "" : "ghost", onclick: (e) => { kind = k; bar.querySelectorAll("button").forEach((b) => (b.className = "ghost")); e.target.className = ""; load(); } }, l)));
    load(); return h("div", {}, h("p", { class: "muted" }, intro), bar, h("div", { class: "card", style: "margin-top:12px" }, box));
  }

  function codePanel() {
    return panel("/api/monitor?a=code", (d, reload) => {
      if (!d.readable) return [h("div", { class: "banner" }, "Le code déployé n’est pas lisible par la supervision (", d.count, " fichiers trouvés). Vérifiez que vercel.json contient bien la section « functions » fournie, puis redéployez.")];
      const ig = d.integrity, changed = ig.modified.length + ig.added.length + ig.removed.length;
      const depBox = h("div", {}, h("button", { class: "ghost", onclick: async (e) => { e.target.disabled = true; depBox.replaceChildren(h("p", { class: "muted" }, "Interrogation de la base de vulnérabilités OSV…")); try {
        const rows = await api("/api/monitor?a=deps"); depBox.replaceChildren(table(["Paquet", "Version", "Utilisé par", "Vulnérabilités connues"], rows.map((x) => [x.name, x.version || "?", x.where, !x.checked ? "Vérification impossible" : x.vulns.length ? h("span", { style: "color:#c0392b" }, x.vulns.map((v) => v.id).join(", ")) : "✓ Aucune"])));
      } catch (x) { depBox.replaceChildren(h("p", { class: "err" }, x.message)); } } }, "Vérifier les dépendances"));
      return [
        h("div", { class: "banner", style: !ig.baselineSet ? "" : changed ? "background:rgba(192,57,43,.1);border-color:#c0392b" : "background:rgba(18,128,92,.1);border-color:#12805c" },
          dot(ig.baselineSet && !changed), h("strong", {}, !ig.baselineSet ? "Aucune version de référence." : changed ? changed + " fichier(s) différent(s) de la version approuvée !" : "Le code est identique à la version approuvée."), " ",
          ig.baselineSet ? h("span", { class: "muted" }, "Référence du " + when(ig.approvedAt) + ". ") : h("span", { class: "muted" }, "Approuvez la version actuelle une fois que vous l’avez vérifiée. "),
          h("button", { onclick: async () => { if (!confirm("Approuver la version actuelle du code comme référence de confiance ?")) return; try { await api("/api/monitor?a=approve", "POST", {}); reload(); } catch (x) { alert(x.message); } } }, ig.baselineSet ? "Approuver cette version" : "Approuver la version actuelle")),
        changed ? h("div", { class: "card" }, h("h2", {}, "Fichiers modifiés depuis la référence"), table(["Fichier", "Changement"], [...ig.modified.map((f) => [f, "Modifié"]), ...ig.added.map((f) => [f, "Ajouté"]), ...ig.removed.map((f) => [f, "Supprimé"])]),
          h("p", { class: "muted" }, "Si ces changements sont les vôtres, vérifiez-les puis cliquez sur « Approuver ». Sinon, quelqu’un a modifié le code : changez immédiatement vos accès GitHub et Vercel.")) : "",
        h("div", { class: "card" }, h("h2", {}, "Analyse de sécurité du code (" + d.count + " fichiers, " + bytes(d.bytes) + ")"), d.findings.length
          ? table(["Gravité", "Fichier", "Constat", "Que faire ?"], d.findings.map((f) => [sevPill(f.sev), f.file + (f.line ? ":" + f.line : ""), h("span", {}, f.rule, f.snippet ? h("div", { class: "muted", style: "font-size:.78rem;word-break:break-all" }, f.snippet) : ""), f.fix])) : h("p", { class: "ok" }, "✓ Aucun problème détecté par les règles automatiques."),
          h("p", { class: "muted" }, "Analyse heuristique : elle repère les erreurs courantes, mais ne remplace pas un audit complet.")),
        h("div", { class: "card" }, h("h2", {}, "Dépendances et bibliothèques"), depBox),
        h("div", { class: "card" }, h("h2", {}, "Protéger le code source (à faire sur GitHub / Vercel)"),
          ...["Activer la double authentification sur vos comptes GitHub et Vercel.", "Protéger la branche principale (Settings > Branches) : pull request obligatoire, force-push interdit.", "Activer Dependabot (alertes de sécurité et mises à jour automatiques) et le « secret scanning ».", "Limiter qui peut pousser du code et supprimer tout accès inutile (Settings > Collaborators).", "Garder le dépôt privé et ne jamais y enregistrer de mots de passe ou de clés.", "Activer la Deployment Protection de Vercel pour les aperçus."].map((x) => h("div", { style: "padding:3px 0" }, "☐ " + x)))];
    });
  }

  function usersPanel() {
    let filter = "all", term = "", data = { admins: [], customers: [] };
    const box = h("div", {}), kpis = h("div", { class: "kpis" }), list = h("div", {}), stamp = h("span", { class: "muted" });
    const search = h("input", { type: "search", placeholder: "Rechercher un nom ou un e-mail…", oninput: (e) => { term = e.target.value.trim().toLowerCase(); draw(); } });
    const bar = h("div", { class: "tabs-in" });
    const everyone = () => [...data.admins.map((u) => ({ ...u, kind: "admin" })), ...data.customers.map((u) => ({ ...u, kind: "client" }))];
    const kpi = (l, v, s, hot) => h("div", { class: "kpi" + (hot ? " hot" : "") }, h("div", { class: "kpi-l" }, l), h("div", { class: "kpi-v" }, String(v)), s ? h("div", { class: "kpi-s" }, s) : "");
    async function force(u) {
      if (!confirm("Déconnecter " + (u.name || u.email) + " maintenant ?")) return;
      try { await api(u.kind === "admin" ? "/api/admins?id=" + u.id : "/api/console?a=customers&id=" + u.id, "PATCH", { disconnect: true }); await load(); } catch (x) { alert(x.message); }
    }
    function row(u) {
      const mine = u.kind === "admin" && u.id === me.id;
      return h("div", { class: "card row" },
        h("div", { class: "uid" }, avatarEl(u), h("div", {}, h("span", { class: "dot " + (u.online ? "on" : "off") }), h("strong", {}, u.name || u.email), mine ? " (vous)" : "", " ",
          h("span", { class: "pill" }, u.kind === "client" ? "Client" : u.role === "super_admin" ? "Super admin" : "Admin"), u.active ? "" : h("span", { class: "pill" }, "Désactivé"), h("br"),
          h("span", { class: "muted" }, u.email + " · " + (u.online ? "en ligne maintenant" : "dernière activité " + ago(u.last_seen))))),
        h("div", { class: "row" },
          u.kind === "client" ? h("button", { class: "ghost", onclick: () => { window._cust = u.id; tab = "activity"; render(); } }, "Activité") : "",
          u.online && !mine ? h("button", { class: "ghost", onclick: () => force(u) }, "Déconnecter") : ""));
    }
    function draw() {
      const all = everyone(), on = all.filter((u) => u.online), isA = (u) => u.kind === "admin";
      kpis.replaceChildren(
        kpi("En ligne maintenant", on.length, on.filter(isA).length + " admin(s) · " + on.filter((u) => !isA(u)).length + " client(s)", on.length > 0),
        kpi("Hors ligne", all.length - on.length, "sur " + all.length + " comptes"),
        kpi("Administrateurs", on.filter(isA).length + " / " + data.admins.length, "en ligne"),
        kpi("Clients", on.filter((u) => !isA(u)).length + " / " + data.customers.length, "en ligne"));
      bar.replaceChildren(...[["all", "Tous (" + all.length + ")"], ["on", "En ligne (" + on.length + ")"], ["off", "Hors ligne (" + (all.length - on.length) + ")"]]
        .map(([k, l]) => h("button", { class: k === filter ? "" : "ghost", onclick: () => { filter = k; draw(); } }, l)));
      const shown = all.filter((u) => (filter === "on" ? u.online : filter === "off" ? !u.online : true) && (!term || ((u.name || "") + " " + u.email).toLowerCase().includes(term)))
        .sort((a, b) => (b.online - a.online) || (new Date(b.last_seen || 0) - new Date(a.last_seen || 0)));
      list.replaceChildren(...(shown.length ? shown.map(row) : [h("p", { class: "muted" }, "Aucun utilisateur dans cette vue.")]));
    }
    async function load() {
      try { data = await api("/api/monitor?a=users"); stamp.textContent = "Actualisé à " + new Date().toLocaleTimeString("fr-FR"); draw(); }
      catch (x) { list.replaceChildren(h("p", { class: "err" }, x.message)); }
    }
    box.append(h("div", { class: "row", style: "margin-bottom:10px" }, h("p", { class: "muted", style: "margin:0" }, "« En ligne » = session ouverte et activité dans les 5 dernières minutes. Mise à jour automatique toutes les 20 secondes."),
      h("span", {}, stamp, " ", h("button", { class: "ghost", onclick: load }, "Actualiser"))), kpis, h("div", { class: "row", style: "margin:12px 0" }, bar, h("div", { style: "min-width:240px;flex:1;max-width:340px" }, search)), list);
    load();
    pollTimer = setInterval(() => { if (!document.hidden && box.isConnected) load(); }, 20000);
    return box;
  }

  function supervisionView() {
    stopPoll();
    const tabs = [["overview", "Vue d’ensemble"], ["users", "Utilisateurs en ligne"], ["db", "Base de données"], ["server", "Serveur"], ["app", "Application & API"], ["sec", "Sécurité & attaques"], ["code", "Code source"]];
    const body = supTab === "users" ? usersPanel() : supTab === "db" ? dbPanel() : supTab === "server" ? serverPanel()
      : supTab === "app" ? eventsPanel([["error", "Bugs serveur"], ["contract", "API incohérentes"], ["validation", "Requêtes invalides"], ["slow", "Lenteurs"], ["client", "Bugs navigateur"]], "Bugs et incohérences entre le site et ses API. « API incohérentes » = routes inexistantes ou méthodes refusées : le site appelle quelque chose que le serveur ne comprend pas.")
      : supTab === "sec" ? eventsPanel([["security", "Accès refusés & attaques"]], "Connexions échouées (401), accès interdits (403) et blocages anti-abus (429). Une même adresse IP qui revient souvent indique une attaque par force brute.")
      : supTab === "code" ? codePanel() : overviewPanel();
    let cur = body;
    if (supTab === "overview") pollTimer = setInterval(() => { if (!document.hidden && tab === "supervision" && supTab === "overview" && cur.isConnected) { const n = overviewPanel(); cur.replaceWith(n); cur = n; } }, 60000);
    return h("div", {}, h("div", { class: "tabs-in" }, ...tabs.map(([k, l]) => h("button", { class: k === supTab ? "" : "ghost", onclick: () => { supTab = k; render(); } }, l))), h("div", { style: "margin-top:14px" }, body));
  }

  // ---------- Paiements (super administrateur) ----------
  let payTab = "tx";
  const PAY_ST = { pending: "En cours", awaiting_confirmation: "À confirmer", paid: "Payé", failed: "Échoué", cancelled: "Annulé", rejected: "Refusé", duplicate: "Doublon" };
  const PAY_COLOR = { paid: "#12805c", awaiting_confirmation: "#b7791f", pending: "#6a7189", failed: "#c0392b", rejected: "#c0392b", duplicate: "#e06c00", cancelled: "#6a7189" };
  const KIND_LBL = { cash: "Espèces", card: "Carte", orange_money: "Orange Money", mtn_momo: "MTN MoMo", paypal: "PayPal", bank_transfer: "Virement", other: "Autre" };
  const payPill = (st) => h("span", { class: "pill", style: "color:#fff;border:0;background:" + (PAY_COLOR[st] || "#6a7189") }, PAY_ST[st] || st);
  const fmtMoney = (n, c) => new Intl.NumberFormat("fr-FR").format(n) + " " + (SYM[c] || c);

  function paymentsView() {
    stopPoll();
    const tabs = [["tx", "Transactions"], ["methods", "Moyens de paiement"], ["security", "Sécurité & API"]];
    const body = payTab === "methods" ? payMethodsPanel() : payTab === "security" ? paySecurityPanel() : payTxPanel();
    return h("div", {}, h("div", { class: "tabs-in" }, ...tabs.map(([k, l]) => h("button", { class: k === payTab ? "" : "ghost", onclick: () => { payTab = k; render(); } }, l))), h("div", { style: "margin-top:14px" }, body));
  }

  function payTxPanel() {
    let st = "";
    const box = h("div", {}, h("p", { class: "muted" }, "Chargement…"));
    const act = async (path, body) => { try { await api(path, "POST", body); load(); } catch (x) { alert(x.message); } };
    const load = () => api("/api/pay?a=admin_payments" + (st ? "&status=" + st : "")).then((d) => {
      const paid = d.summary.paid.map((p) => fmtMoney(p.total, p.currency)).join(" + ") || "0";
      const filters = [["", "Toutes"], ["awaiting_confirmation", "À confirmer"], ["paid", "Payées"], ["pending", "En cours"], ["failed", "Échouées"]];
      box.replaceChildren(
        h("div", { class: "kpis" },
          h("div", { class: "kpi" + (d.summary.awaiting ? " hot" : "") }, h("div", { class: "kpi-l" }, "À confirmer"), h("div", { class: "kpi-v" }, String(d.summary.awaiting)), h("div", { class: "kpi-s" }, "paiements manuels / espèces")),
          h("div", { class: "kpi" }, h("div", { class: "kpi-l" }, "Encaissé"), h("div", { class: "kpi-v", style: "font-size:1.3rem" }, paid), h("div", { class: "kpi-s" }, "paiements confirmés"))),
        h("div", { class: "tabs-in", style: "margin-bottom:12px" }, ...filters.map(([k, l]) => h("button", { class: k === st ? "" : "ghost", onclick: () => { st = k; load(); } }, l))),
        d.rows.length ? table(["Date", "Client", "Bien", "Moyen", "Montant", "Statut", "Référence", "Actions"], d.rows.map((p) => [
          when(p.created_at),
          h("div", {}, p.customer_name || "—", h("br"), h("small", { class: "muted" }, p.customer_phone || p.customer_email || "")),
          p.property_title || "—", KIND_LBL[p.kind] || p.kind, fmtMoney(p.amount, p.currency), payPill(p.status),
          h("small", {}, p.payer_ref || String(p.reference).slice(-12), p.note ? " — " + p.note : ""),
          h("div", { class: "row", style: "gap:6px;justify-content:flex-start" },
            p.status === "awaiting_confirmation" ? h("button", { onclick: () => { if (confirm("Confirmer la réception de " + fmtMoney(p.amount, p.currency) + " ?")) act("/api/pay?a=admin_confirm", { paymentId: p.id }); } }, "Confirmer") : "",
            p.status === "awaiting_confirmation" ? h("button", { class: "danger", onclick: () => { const r = prompt("Motif du refus (visible par le client) :"); if (r !== null) act("/api/pay?a=admin_reject", { paymentId: p.id, reason: r }); } }, "Refuser") : "",
            ["pending", "failed", "cancelled"].includes(p.status) && !["manual", "cash"].includes(p.provider) ? h("button", { class: "ghost", onclick: () => act("/api/pay?a=admin_recheck", { paymentId: p.id }) }, "Revérifier") : "")
        ])) : h("p", { class: "muted" }, "Aucune transaction pour le moment."));
    }).catch((x) => box.replaceChildren(h("p", { class: "err" }, x.message)));
    load(); return box;
  }

  function payMethodsPanel() {
    const box = h("div", {}, h("p", { class: "muted" }, "Chargement…"));
    const load = () => api("/api/pay?a=admin_methods").then((d) => {
      const used = new Set(d.methods.map((m) => m.kind));
      const addable = Object.entries(d.kinds).filter(([k]) => ["bank_transfer", "other"].includes(k) || !used.has(k));
      let draft = null;
      const list = h("div", {});
      const paint = () => list.replaceChildren(...(draft ? [methodCard(d, draft, load)] : []), ...d.methods.map((m) => methodCard(d, m, load)));
      const sel = h("select", {}, ...addable.map(([k, v]) => h("option", { value: k }, v.label)));
      const add = addable.length ? h("div", { class: "card" }, h("div", { class: "row" }, h("strong", {}, "Ajouter un moyen de paiement"), h("div", { class: "row", style: "gap:8px" }, sel,
        h("button", { onclick: () => { const k = sel.value; draft = { id: 0, kind: k, label: d.kinds[k].label, provider: d.kinds[k].providers[0], enabled: false, position: 99, account_name: "", account_number: "", instructions: "", ready: true }; paint(); } }, "Ajouter")))) : "";
      box.replaceChildren(h("p", { class: "muted" }, "Activez les moyens proposés aux clients et renseignez les numéros ou comptes à créditer. Toute modification d’un numéro demande votre mot de passe" + (me.totp_enabled ? " et votre code de double authentification." : ".")), add, list);
      paint();
    }).catch((x) => box.replaceChildren(h("p", { class: "err" }, x.message)));
    load(); return box;
  }

  function methodCard(d, m, reload) {
    const info = d.kinds[m.kind];
    const label = h("input", { value: m.label, maxlength: 60 });
    const provider = h("select", {}, ...info.providers.map((p) => h("option", { value: p, selected: p === m.provider }, d.providerLabels[p] || p)));
    const accName = h("input", { value: m.account_name, maxlength: 100, autocomplete: "off", placeholder: "Nom du titulaire" });
    const accNum = h("input", { value: m.account_number, maxlength: 60, autocomplete: "off", placeholder: "Numéro Orange Money / MTN, IBAN…" });
    const instr = h("textarea", { maxlength: 600, placeholder: "Instructions affichées au client" }); instr.value = m.instructions;
    const pos = h("input", { type: "number", value: m.position, min: 0, max: 999, inputmode: "numeric" });
    const pw = h("input", { type: "password", autocomplete: "current-password", placeholder: "Votre mot de passe" });
    const code = me.totp_enabled ? h("input", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, placeholder: "Code 2FA (6 chiffres)" }) : null;
    const err = h("p", { class: "err", role: "alert" });
    const en = h("input", { type: "checkbox" }); en.checked = !!m.enabled;
    if (m.id) en.addEventListener("change", async () => { err.textContent = ""; try { await api("/api/pay?a=admin_toggle", "POST", { id: m.id, enabled: en.checked }); } catch (x) { en.checked = !en.checked; err.textContent = x.message; } });
    const manualBox = h("div", { class: "grid" }, field("Titulaire du compte", accName), field("Numéro de paiement / de compte", accNum));
    const instrBox = field("Instructions pour le client", instr);
    const sync = () => { const p = provider.value; manualBox.style.display = p === "manual" ? "" : "none"; instrBox.style.display = p === "manual" || p === "cash" ? "" : "none"; };
    provider.addEventListener("change", sync); sync();
    const save = h("button", { onclick: async () => {
      err.textContent = ""; save.disabled = true;
      try {
        await api("/api/pay?a=admin_save", "POST", { id: m.id, kind: m.kind, label: label.value, provider: provider.value, enabled: en.checked, position: Number(pos.value) || 0, account_name: accName.value, account_number: accNum.value, instructions: instr.value, password: pw.value, code: code ? code.value : "" });
        reload();
      } catch (x) { err.textContent = x.message; save.disabled = false; }
    } }, m.id ? "Enregistrer" : "Créer");
    const del = m.id ? h("button", { class: "danger", onclick: async () => {
      if (!confirm("Supprimer « " + m.label + " » ? Les paiements déjà enregistrés sont conservés.")) return;
      try { await api("/api/pay?a=admin_delete", "POST", { id: m.id, password: pw.value, code: code ? code.value : "" }); reload(); } catch (x) { err.textContent = x.message; }
    } }, "Supprimer") : h("button", { class: "ghost", onclick: reload }, "Annuler");
    return h("div", { class: "card" },
      h("div", { class: "row" }, h("strong", {}, (KIND_LBL[m.kind] || m.kind) + (m.id ? "" : " (nouveau)")), h("label", { class: "chk", style: "margin:0" }, en, "Activé pour les clients")),
      !m.ready ? h("p", { class: "err" }, "Clés API absentes sur le serveur : voir l’onglet « Sécurité & API ».") : "",
      h("div", { class: "grid", style: "margin-top:10px" }, field("Libellé affiché", label), field("Mode de paiement", provider), field("Ordre d’affichage", pos)),
      manualBox, instrBox,
      h("div", { class: "grid", style: "margin-top:6px" }, field("Mot de passe (pour enregistrer)", pw), code ? field("Code de double authentification", code) : ""),
      err, h("div", { class: "row", style: "justify-content:flex-start" }, save, del));
  }

  function paySecurityPanel() {
    return panel("/api/pay?a=admin_status", (d) => {
      const e = d.env;
      const row = (ok, title, text) => h("div", { class: "row", style: "justify-content:flex-start;align-items:flex-start;gap:0;margin-bottom:10px;flex-wrap:nowrap" }, dot(ok), h("div", {}, h("strong", {}, title), h("div", { class: "muted" }, text)));
      return [
        h("div", { class: "card" }, h("h2", {}, "État de la configuration serveur"),
          row(e.flutterwave, "Flutterwave : clé secrète (FLW_SECRET_KEY)", e.flutterwave ? "Cartes Visa / Mastercard, Orange Money et MTN MoMo disponibles." : "Absente : les paiements en ligne par carte et mobile money sont désactivés."),
          row(e.flutterwaveWebhook, "Flutterwave : secret du webhook (FLW_WEBHOOK_HASH)", e.flutterwaveWebhook ? "Les notifications de paiement sont authentifiées." : "Absent : sans lui, seul le retour du client confirme le paiement."),
          row(e.paypal, "PayPal (PAYPAL_CLIENT_ID et PAYPAL_SECRET)", e.paypal ? (e.paypalLive ? "Mode réel (live)." : "Mode test (sandbox) : aucun vrai argent. Ajoutez PAYPAL_ENV=live pour la production.") : "Absent : PayPal est désactivé."),
          row(e.encryption, "Clé de chiffrement (APP_SECRET)", e.encryption ? "Les numéros de compte sont chiffrés en base (AES-256)." : "Absente : une clé de secours est utilisée. Définissez APP_SECRET (longue phrase aléatoire)."),
          row(d.https, "Connexion HTTPS", d.https ? "Le site est servi en HTTPS." : "Définissez SITE_URL en https:// : indispensable pour les paiements."),
          row(!!me.totp_enabled, "Double authentification de votre compte", me.totp_enabled ? "Activée : exigée pour modifier un numéro de paiement." : "Désactivée : activez-la dans « Mon profil » pour protéger les numéros de paiement.")),
        h("div", { class: "card" }, h("h2", {}, "Adresse du webhook Flutterwave"), h("code", { style: "word-break:break-all" }, d.webhookUrl),
          h("p", { class: "muted" }, "À renseigner dans Flutterwave > Settings > Webhooks, avec le même secret que FLW_WEBHOOK_HASH.")),
        h("div", { class: "card" }, h("h2", {}, "Protections actives"), h("ul", { style: "margin:0;padding-left:18px;line-height:1.7" }, ...[
          "Le montant et la devise viennent toujours de la base de données, jamais du navigateur.",
          "Un paiement en ligne n’est validé qu’après vérification auprès du fournisseur (montant, devise, référence).",
          "Un seul paiement « payé » par demande ; une notification rejouée ne crédite rien deux fois ; un double paiement est signalé pour remboursement.",
          "Une référence de transaction (Orange Money, MTN…) ne peut être utilisée qu’une seule fois.",
          "Les données de carte ne transitent jamais par ce site (page de paiement du fournisseur).",
          "Les clés API sont uniquement dans les variables d’environnement Vercel, jamais dans la base ni le navigateur.",
          "Les numéros de compte sont chiffrés ; leur modification exige mot de passe (+ code 2FA) et est inscrite au journal de sécurité.",
          "Limitation anti-abus sur chaque tentative de paiement, et refus de toute requête venant d’un autre site."
        ].map((t) => h("li", {}, t)))),
        h("div", { class: "card" }, h("h2", {}, "Où mettre les clés API ?"), h("p", { class: "muted", style: "margin:0" }, "Vercel > Settings > Environment Variables (type « Sensitive »), puis redéployer. Ne saisissez jamais une clé secrète dans ce tableau de bord : elle serait stockée en base de données."))
      ];
    });
  }

  // Modules regroupés : un seul accès dans le menu, des onglets à l'intérieur
  const SUBS = {
    clients: [["clients", "Comptes"], ["activity", "Activité"]],
    chat: [["chat", "Messagerie", "chat"], ["messages", "Formulaire de contact"], ["suggestions", "Suggestions", "suggestions"], ["notifs", "Notifications", "notifications"]],
    admins: [["admins", "Administrateurs"], ["audit", "Journal de sécurité"]]
  };
  const MODULE = {}; for (const [m, subs] of Object.entries(SUBS)) subs.forEach(([id]) => { MODULE[id] = m; });
  const subBar = () => {
    const m = MODULE[tab];
    return m ? h("div", { class: "tabs-in", style: "margin-bottom:14px" }, ...SUBS[m].map(([id, l, cnt]) => h("button", { class: id === tab ? "" : "ghost", onclick: () => { tab = id; render(); } }, l, cnt && counts[cnt] ? h("span", { class: "badge" }, String(counts[cnt])) : ""))) : "";
  };
  const NAV = (sup) => [
    ["Pilotage", [["dashboard", "Tableau de bord"], ["annonces", "Annonces"], ["orders", "Commandes", ["pendingOrders"]], ["payments", "Paiements", null, 1], ["clients", "Clients", null, 1], ["chat", "Messages", ["chat", "notifications", "suggestions"]]]],
    ["Système", [["whatsapp", "WhatsApp", null, 1], ["supervision", "Supervision", null, 1], ["admins", "Équipe & sécurité", null, 1], ["profile", "Mon profil"]]]
  ].map(([g, items]) => [g, items.filter((i) => !i[3] || sup)]).filter(([, items]) => items.length);

  // ----- Menu mobile : barre fixe en bas (ne bouge pas, ne s'étire pas) -----
  const svg = (d) => { const n = "http://www.w3.org/2000/svg", s = document.createElementNS(n, "svg"), p = document.createElementNS(n, "path"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true"); p.setAttribute("d", d); s.append(p); return s; };
  const ICON = { dashboard: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z", annonces: "M3 21V9l9-6 9 6v12M9 21v-7h6v7", orders: "M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6", chat: "M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", more: "M5 12h.01M12 12h.01M19 12h.01" };
  function mobileNav(sup, active, go, countOf) {
    const main = [["dashboard", "Accueil"], ["annonces", "Annonces"], ["orders", "Commandes"], ["chat", "Messages"]];
    const rest = NAV(sup).flatMap(([, items]) => items).filter(([id]) => !main.some(([m]) => m === id));
    const sheet = h("div", { class: "sheet-back", hidden: true, onclick: () => { sheet.hidden = true; } },
      h("div", { class: "sheet", role: "dialog", "aria-label": "Menu", onclick: (e) => e.stopPropagation() },
        ...rest.map(([id, label, cnt]) => { const n = countOf(cnt); return h("button", { class: "ghost sheet-i" + (active === id ? " on" : ""), onclick: () => go(id) }, h("span", {}, label), n ? h("span", { class: "badge" }, String(n)) : ""); }),
        h("a", { class: "btn ghost sheet-i", href: "/" }, "Voir le site"),
        h("button", { class: "ghost sheet-i", onclick: async () => { await api("/api/auth?a=logout", "POST"); me = null; render(); } }, "Déconnexion")));
    const restOn = rest.some(([id]) => id === active);
    const bar = h("nav", { class: "tabbar", "aria-label": "Navigation principale" },
      ...main.map(([id, label]) => { const n = countOf(NAV(sup).flatMap(([, it]) => it).find((i) => i[0] === id)?.[2]); return h("button", { class: "tb" + (active === id ? " on" : ""), "aria-current": active === id ? "page" : null, onclick: () => go(id) }, svg(ICON[id]), h("span", {}, label), n ? h("i", { class: "tb-badge" }, String(n)) : ""); }),
      h("button", { class: "tb" + (restOn ? " on" : ""), "aria-haspopup": "dialog", onclick: () => { sheet.hidden = !sheet.hidden; } }, svg(ICON.more), h("span", {}, "Plus")));
    return [bar, sheet];
  }

  async function render() {
    stopPoll();
    if (!me || /^#reset=/.test(location.hash)) { app.replaceChildren(loginView()); return; }
    try { counts = await api("/api/console?a=counts"); } catch (e) {}
    const sup = me.role === "super_admin";
    const nav = h("aside", { class: "side" }, h("div", { class: "brand" }, h("i", {}, "M"), "Maison Admin"));
    for (const [g, items] of NAV(sup)) {
      nav.append(h("div", { class: "grp" }, g));
      for (const [id, label, cnt] of items) {
        const n = cnt ? cnt.reduce((t, k) => t + (counts[k] || 0), 0) : 0;
        nav.append(h("button", { class: "nav" + ((MODULE[tab] || tab) === id || (tab === "form" && id === "annonces") ? " on" : ""), onclick: () => { tab = id; window._cust = null; render(); } }, h("span", {}, label), n ? h("span", { class: "badge" }, String(n)) : ""));
      }
    }
    nav.append(h("div", { class: "who" }, h("div", { class: "who-id" }, avatarEl(me), h("div", {}, h("b", {}, me.name || me.email), presenceBadge(), h("span", { class: "who-role" }, sup ? "Super administrateur" : "Administrateur")))));
    const countOf = (cnt) => (cnt ? cnt.reduce((t, k) => t + (counts[k] || 0), 0) : 0);
    const go = (id) => { tab = id; window._cust = null; render(); };
    const body = tab === "form" ? propForm(window._edit) : tab === "messages" ? await messagesView() : tab === "admins" && sup ? await adminsView()
      : tab === "orders" ? ordersView() : tab === "notifs" ? notifsView() : tab === "clients" && sup ? customersView() : tab === "activity" && sup ? activityView()
      : tab === "chat" ? chatView() : tab === "suggestions" ? suggestionsView() : tab === "payments" && sup ? paymentsView() : tab === "whatsapp" && sup ? whatsappView() : tab === "supervision" && sup ? supervisionView() : tab === "audit" && sup ? auditView() : tab === "profile" ? profileView()
      : tab === "annonces" ? listView() : dashboardView();
    const titles = { dashboard: "Tableau de bord", annonces: "Annonces", form: "Annonce", orders: "Commandes", payments: "Paiements", clients: "Clients", chat: "Messages", admins: "Équipe & sécurité", supervision: "Supervision", profile: "Mon profil" };
    app.replaceChildren(h("div", { class: "shell" }, nav, h("section", { class: "main" },
      h("header", { class: "top" }, h("h1", {}, titles[MODULE[tab] || tab] || "Tableau de bord"), h("div", { class: "row" },
        h("a", { class: "btn ghost desk-only", href: "/" }, "Voir le site"), h("button", { class: "ghost desk-only", onclick: async () => { await api("/api/auth?a=logout", "POST"); me = null; render(); } }, "Déconnexion"))),
      h("div", { class: "content" }, subBar(), body)), ...mobileNav(sup, MODULE[tab] || (tab === "form" ? "annonces" : tab), go, countOf)));
    window.scrollTo(0, 0);
  }

  api("/api/auth?a=me").then(async (r) => { me = r.user; tab = "dashboard"; await load(); render(); }).catch(() => render());
})();
