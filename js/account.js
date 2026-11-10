(function () {
  const app = (window.Maison = window.Maison || {});
  let customer = null, unread = 0, pendingProperty = null, dlg, box, btn, toastEl;
  const ST = { pending: "En attente", confirmed: "Acceptée", rejected: "Refusée", cancelled: "Annulée" };

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
    if (!r.ok) { const e = new Error(data.error || "Erreur " + r.status); e.data = data; throw e; }
    return data;
  }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (toastEl.hidden = true), 5000);
  }
  function updateBtn() {
    btn.textContent = customer ? "👤 " + customer.name.split(" ")[0] + (unread ? " (" + unread + ")" : "") : "Se connecter";
  }
  async function refresh() {
    try { const r = await api("/api/customer?a=me"); customer = r.customer; unread = r.unread; }
    catch (e) { customer = null; unread = 0; }
    updateBtn();
  }
  const money = (a, c) => new Intl.NumberFormat("fr-FR").format(a) + " " + c;
  let payCfg = { online: false };
  async function pay(kind, o, btnEl, errEl, reload) {
    btnEl.disabled = true; errEl.textContent = "";
    try {
      const r = await api("/api/pay?a=" + kind, "POST", { orderId: o.id });
      if (r.link) { window.location.href = r.link; return; }
      toast("Paiement en espèces enregistré : réglez-le à l’agence."); reload();
    } catch (x) { errEl.textContent = x.message; btnEl.disabled = false; }
  }
  function payBlock(o, reload) {
    if (o.status !== "confirmed" || !(Number(o.amount) > 0)) return "";
    const due = h("div", { class: "acc-pay" }, h("div", {}, "Acompte de réservation : ", h("strong", {}, money(o.amount, o.currency))));
    const err = h("p", { class: "acc-err", role: "alert" });
    if (o.payment_status === "paid") due.append(h("div", {}, h("span", { class: "acc-pill acc-confirmed" }, "Payé ✓")));
    else if (o.payment_status === "cash_pending") due.append(h("div", { class: "acc-note" }, "Paiement en espèces à régler à l’agence."));
    else {
      if (o.payment_status === "pending") due.append(h("div", { class: "acc-note" }, "Un paiement est en cours ou n’a pas abouti : vous pouvez réessayer."));
      const online = h("button", { class: "acc-primary", type: "button", disabled: !payCfg.online, title: payCfg.online ? "" : "Paiement en ligne bientôt disponible", onclick: (e) => pay("online", o, e.target, err, reload) }, "Payer en ligne (Mobile Money, Visa, Mastercard)");
      const cash = h("button", { class: "acc-cash", type: "button", onclick: (e) => pay("cash", o, e.target, err, reload) }, "Payer en espèces à l’agence");
      due.append(online, cash, payCfg.online ? "" : h("p", { class: "acc-note" }, "Le paiement en ligne n’est pas encore activé."));
    }
    due.append(err); return due;
  }
  const field = (label, input) => h("label", { class: "acc-field" }, h("span", {}, label), input);

  function open(view, note) { box.replaceChildren(); dlg.showModal(); render(view, note); }
  function close() { dlg.close(); }

  function authView(mode, note) {
    const signup = mode === "signup";
    const err = h("p", { class: "acc-err", role: "alert" });
    const f = { name: h("input", { required: true, autocomplete: "name", maxlength: 100 }), email: h("input", { type: "email", required: true, autocomplete: "email" }),
      phone: h("input", { type: "tel", autocomplete: "tel", maxlength: 30 }), password: h("input", { type: "password", required: true, minlength: signup ? 8 : 1, autocomplete: signup ? "new-password" : "current-password" }),
      consent: h("input", { type: "checkbox" }) };
    const form = h("form", { onsubmit: async (e) => {
      e.preventDefault(); err.textContent = "";
      try {
        const body = signup ? { name: f.name.value, email: f.email.value, phone: f.phone.value, password: f.password.value, consent: f.consent.checked } : { email: f.email.value, password: f.password.value };
        const r = await api("/api/customer?a=" + (signup ? "signup" : "login"), "POST", body);
        customer = r.customer; await refresh();
        toast(signup ? "Compte créé, bienvenue !" : "Connexion réussie.");
        render(pendingProperty ? "order" : "account");
      } catch (x) {
        err.textContent = x.message;
        if (x.data && x.data.exists) { render("login", "Un compte existe déjà avec cet e-mail : connectez-vous."); }
      }
    } },
      ...(signup ? [field("Nom complet", f.name), field("Téléphone (facultatif)", f.phone)] : []),
      field("E-mail", f.email), field(signup ? "Mot de passe (8 caractères min.)" : "Mot de passe", f.password),
      signup ? h("label", { class: "acc-check" }, f.consent, h("span", {}, "J’accepte que mes actions sur le site (consultation des biens, demandes de réservation) soient visibles par l’administrateur.")) : "",
      err, h("button", { type: "submit", class: "acc-primary" }, signup ? "Créer mon compte" : "Se connecter"));
    if (f.email && window._accEmail) f.email.value = window._accEmail;
    return h("div", {}, h("h2", {}, signup ? "Créer un compte" : "Connexion"), note ? h("p", { class: "acc-note" }, note) : "", form,
      h("p", { class: "acc-switch" }, signup ? "Déjà un compte ? " : "Pas encore de compte ? ",
        h("button", { type: "button", class: "acc-link", onclick: () => { window._accEmail = f.email.value; render(signup ? "login" : "signup"); } }, signup ? "Se connecter" : "Créer un compte")));
  }

  function orderView() {
    const p = pendingProperty;
    const err = h("p", { class: "acc-err", role: "alert" });
    const msg = h("textarea", { rows: 4, maxlength: 1000, placeholder: "Un message pour l’agence (dates de visite, questions…)" });
    return h("div", {}, h("h2", {}, "Demande de réservation"), h("p", {}, h("strong", {}, p.title), " — ", p.location),
      field("Message (facultatif)", msg), err,
      h("button", { class: "acc-primary", onclick: async (e) => {
        e.target.disabled = true; err.textContent = "";
        try { await api("/api/orders", "POST", { propertyId: p.id, message: msg.value }); pendingProperty = null; toast("Demande envoyée. Vous serez notifié de la réponse."); render("account"); }
        catch (x) { err.textContent = x.message; e.target.disabled = false; }
      } }, "Envoyer la demande"),
      h("button", { class: "acc-link", onclick: () => { pendingProperty = null; close(); } }, "Annuler"));
  }

  function accountView() {
    const notes = h("div", {}, h("p", { class: "acc-note" }, "Chargement…")), orders = h("div", {}, h("p", { class: "acc-note" }, "Chargement…"));
    api("/api/pay?a=config").then((c) => { payCfg = c; loadOrders(); }).catch(() => {});
    api("/api/customer?a=notifications").then((rows) => {
      notes.replaceChildren(...(rows.length ? rows.map((n) => h("div", { class: "acc-item" + (n.is_read ? "" : " new") }, n.text, h("small", {}, new Date(n.created_at).toLocaleString("fr-FR")))) : [h("p", { class: "acc-note" }, "Aucune notification.")]));
      if (rows.some((n) => !n.is_read)) api("/api/customer?a=notifications", "POST").then(() => { unread = 0; updateBtn(); }).catch(() => {});
    }).catch(() => notes.replaceChildren(h("p", { class: "acc-err" }, "Impossible de charger les notifications.")));
    const loadOrders = () => api("/api/orders").then((rows) => {
      orders.replaceChildren(...(rows.length ? rows.map((o) => h("div", { class: "acc-item" }, h("strong", {}, o.property_title || "Bien supprimé"), " · ", h("span", { class: "acc-pill acc-" + o.status }, ST[o.status] || o.status),
        o.status === "pending" ? h("button", { class: "acc-link", onclick: async () => { await api("/api/orders?id=" + o.id, "DELETE"); loadOrders(); } }, "Annuler") : "", payBlock(o, loadOrders))) : [h("p", { class: "acc-note" }, "Aucune demande pour le moment.")]));
    }).catch(() => orders.replaceChildren(h("p", { class: "acc-err" }, "Impossible de charger vos demandes.")));
    loadOrders();
    return h("div", {}, h("h2", {}, "Bonjour " + customer.name.split(" ")[0]), h("p", { class: "acc-note" }, customer.email),
      h("h3", {}, "Notifications"), notes, h("h3", {}, "Mes demandes de réservation"), orders,
      h("button", { class: "acc-link", onclick: async () => { await api("/api/customer?a=logout", "POST"); customer = null; unread = 0; updateBtn(); close(); toast("Vous êtes déconnecté."); } }, "Se déconnecter"));
  }

  function render(view, note) {
    if (view === "order" && !customer) view = "signup";
    if (view === "account" && !customer) view = "login";
    const content = view === "signup" || view === "login" ? authView(view, note) : view === "order" ? orderView() : accountView();
    box.replaceChildren(h("button", { class: "acc-close", type: "button", "aria-label": "Fermer", onclick: close }, "×"), content);
  }

  app.requestOrder = function (property) {
    if ((property.availability || "available") !== "available") { toast("Désolé, ce bien n’est plus disponible."); return; }
    pendingProperty = property;
    if (!customer) { open("signup", "Pour réserver ce bien, créez un compte ou connectez-vous."); return; }
    open("order");
  };
  app.trackView = function (id) {
    if (customer) fetch("/api/customer?a=track", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId: id }) }).catch(() => {});
  };
  app.initAccount = function () {
    if (dlg) return;
    const css = h("link", { rel: "stylesheet", href: "css/account.css" }); document.head.append(css);
    box = h("div", { class: "acc-box" });
    dlg = h("dialog", { class: "acc-dialog", "aria-label": "Mon compte" }, box);
    dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
    toastEl = h("div", { class: "acc-toast", role: "status", hidden: true });
    btn = h("button", { type: "button", class: "account-btn", onclick: () => open(customer ? "account" : "login") }, "Se connecter");
    const cta = document.querySelector(".header-cta");
    if (cta) cta.before(btn); else (document.querySelector(".site-header") || document.body).append(btn);
    document.body.append(dlg, toastEl);
    refresh().then(() => {
      const q = new URLSearchParams(location.search).get("paiement");
      if (q) {
        history.replaceState(null, "", location.pathname);
        toast(q === "ok" ? "Paiement reçu, merci !" : q === "annule" ? "Paiement annulé." : q === "attente" ? "Paiement en cours de confirmation." : "Le paiement n’a pas abouti.");
        if (customer) open("account");
      }
    });
  };
})();
