(function () {
  const app = (window.Maison = window.Maison || {});
  let poll = null, accTab = "home", customer = null, unread = 0, pendingProperty = null, dlg, box, btn, toastEl;
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
    btn.textContent = customer ? "Mon espace" + (unread ? " (" + unread + ")" : "") : "Se connecter";
  }
  async function refresh() {
    try { const r = await api("/api/customer?a=me"); customer = r.customer; unread = r.unread + (r.chatUnread || 0); }
    catch (e) { customer = null; unread = 0; }
    updateBtn();
  }
  const money = (a, c) => new Intl.NumberFormat("fr-FR").format(a) + " " + c;
  let payCfg = { online: false };
  function payBlock(o) {
    if (o.status !== "confirmed" || !(Number(o.amount) > 0)) return "";
    const due = h("div", { class: "acc-pay" }, h("div", {}, "Acompte de réservation : ", h("strong", {}, money(o.amount, o.currency))));
    if (o.payment_status === "paid") due.append(h("div", {}, h("span", { class: "acc-pill acc-confirmed" }, "Payé ✓")));
    else if (o.payment_status === "cash_pending") due.append(h("div", { class: "acc-note" }, o.payment_method === "cash" ? "Paiement en espèces à régler à l’agence." : "Paiement déclaré : en attente de confirmation par notre équipe."));
    else {
      if (o.payment_status === "pending") due.append(h("div", { class: "acc-note" }, "Un paiement est en cours ou n’a pas abouti : vous pouvez réessayer."));
      due.append(h("a", { class: "acc-primary", href: "/compte#demandes", style: "display:block;text-align:center;text-decoration:none" }, "Payer l’acompte"));
    }
    return due;
  }
  const field = (label, input) => h("label", { class: "acc-field" }, h("span", {}, label), input);

  function open(view, note) { box.replaceChildren(); dlg.showModal(); render(view, note); }
  function stop() { clearInterval(poll); poll = null; }
  function close() { stop(); dlg.close(); }

  function authView(mode, note) {
    const signup = mode === "signup";
    const err = h("p", { class: "acc-err", role: "alert" });
    const f = { name: h("input", { required: true, autocomplete: "name", maxlength: 100 }), email: h("input", { type: "email", required: true, autocomplete: "email" }),
      phone: h("input", { type: "tel", autocomplete: "tel", maxlength: 30 }), password: h("input", { type: "password", required: true, minlength: signup ? 8 : 1, autocomplete: signup ? "new-password" : "current-password" }),
      consent: h("input", { type: "checkbox" }), whatsapp: h("input", { type: "checkbox" }) };
    const form = h("form", { onsubmit: async (e) => {
      e.preventDefault(); err.textContent = "";
      try {
        const body = signup ? { name: f.name.value, email: f.email.value, phone: f.phone.value, password: f.password.value, consent: f.consent.checked, whatsapp: f.whatsapp.checked } : { email: f.email.value, password: f.password.value };
        const r = await api("/api/customer?a=" + (signup ? "signup" : "login"), "POST", body);
        customer = r.customer; await refresh();
        toast(signup ? "Compte créé, bienvenue !" : "Connexion réussie.");
        if (pendingProperty) render("order"); else location.href = "/compte";
      } catch (x) {
        err.textContent = x.message;
        if (x.data && x.data.exists) { render("login", "Un compte existe déjà avec cet e-mail : connectez-vous."); }
      }
    } },
      ...(signup ? [field("Nom complet", f.name), field("Téléphone / WhatsApp (avec indicatif, ex. +237…)", f.phone)] : []),
      field("E-mail", f.email), field(signup ? "Mot de passe (8 caractères min.)" : "Mot de passe", f.password),
      signup ? h("label", { class: "acc-check" }, f.consent, h("span", {}, "J’accepte que mes actions sur le site (consultation des biens, demandes, messages) soient visibles par l’administrateur.")) : "",
      signup ? h("label", { class: "acc-check" }, f.whatsapp, h("span", {}, "Je souhaite recevoir mes notifications sur WhatsApp quand je ne suis pas connecté (facultatif).")) : "",
      err, h("button", { type: "submit", class: "acc-primary" }, signup ? "Créer mon compte" : "Se connecter"));
    if (f.email && window._accEmail) f.email.value = window._accEmail;
    return h("div", {}, h("h2", {}, signup ? "Créer un compte" : "Connexion"), note ? h("p", { class: "acc-note" }, note) : "", form,
      signup ? "" : h("p", { class: "acc-switch" }, h("a", { href: "/compte#forgot", class: "acc-link" }, "Mot de passe oublié ?")),
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

  function homeTab() {
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
    return h("div", {}, h("h3", {}, "Notifications"), notes, h("h3", {}, "Mes demandes de réservation"), orders);
  }

  function messagesTab() {
    const box = h("div", {}, h("p", { class: "acc-note" }, "Chargement…")), err = h("p", { class: "acc-err", role: "alert" });
    const email = h("input", { type: "email", placeholder: "E-mail du client", style: "width:100%;padding:10px;border:1px solid #d9d6cf;border-radius:10px" });
    api("/api/chat?a=threads").then((rows) => {
      box.replaceChildren(...rows.map((th) => h("button", { class: "acc-thread", type: "button", onclick: () => render("thread", { id: th.id, title: th.title }) },
        h("strong", {}, th.title || "Client"), th.unread ? h("span", { class: "acc-badge" }, String(th.unread)) : "", h("small", {}, (th.last_body || "Aucun message").slice(0, 60)))));
    }).catch(() => box.replaceChildren(h("p", { class: "acc-err" }, "Impossible de charger les conversations.")));
    return h("div", {}, h("h3", {}, "Mes conversations"), box, h("h3", {}, "Discuter avec un autre client"),
      h("form", { onsubmit: async (e) => { e.preventDefault(); err.textContent = ""; try { const r = await api("/api/chat?a=start", "POST", { email: email.value }); render("thread", { id: r.id, title: r.title }); } catch (x) { err.textContent = x.message; } } },
        email, h("button", { type: "submit", class: "acc-cash", style: "margin-top:8px" }, "Démarrer la discussion"), err),
      h("p", { class: "acc-note" }, "Les conversations peuvent être consultées par l’administrateur."));
  }

  function threadView(th) {
    let last = 0;
    const msgs = h("div", { class: "acc-msgs" }), input = h("input", { maxlength: 2000, placeholder: "Votre message…", autocomplete: "off" }), err = h("p", { class: "acc-err" });
    const pull = () => api("/api/chat?a=messages&thread=" + th.id + "&after=" + last).then((rows) => {
      if (!rows.length) return;
      rows.forEach((m) => { last = m.id; msgs.append(h("div", { class: "acc-msg" + (m.mine ? " mine" : "") }, h("small", {}, m.mine ? "Moi" : m.who), m.body)); });
      msgs.scrollTop = msgs.scrollHeight;
    }).catch(() => {});
    pull(); poll = setInterval(() => { if (!document.hidden) pull(); }, 4000);
    return h("div", {}, h("button", { class: "acc-link", onclick: () => { accTab = "messages"; render("account"); } }, "← Conversations"), h("h2", {}, th.title || "Conversation"), msgs,
      h("form", { class: "acc-send", onsubmit: async (e) => { e.preventDefault(); const v = input.value.trim(); if (!v) return; input.value = ""; err.textContent = ""; try { await api("/api/chat?a=send", "POST", { thread: th.id, body: v }); await pull(); } catch (x) { err.textContent = x.message; input.value = v; } } },
        input, h("button", { type: "submit", class: "acc-primary", style: "width:auto;margin:0" }, "Envoyer")), err);
  }

  function profileTab() {
    const m1 = h("p", { class: "acc-err", role: "status" }), m2 = h("p", { class: "acc-err", role: "status" }), m3 = h("p", { class: "acc-err", role: "status" });
    const ok = (el, txt) => { el.className = "acc-note"; el.textContent = txt; }, ko = (el, txt) => { el.className = "acc-err"; el.textContent = txt; };
    const phone = h("input", { type: "tel", value: customer.phone || "", placeholder: "+237 6XX XX XX XX" }), wa = h("input", { type: "checkbox" }); wa.checked = !!customer.whatsapp_optin;
    const cur = h("input", { type: "password", autocomplete: "current-password" }), nxt = h("input", { type: "password", autocomplete: "new-password", minlength: 8 });
    const sug = h("textarea", { rows: 4, maxlength: 2000, placeholder: "Une idée, un problème, une amélioration ?" });
    return h("div", {},
      h("h3", {}, "Notifications WhatsApp"),
      h("form", { onsubmit: async (e) => { e.preventDefault(); try { await api("/api/customer?a=profile", "POST", { phone: phone.value, whatsapp: wa.checked }); customer.phone = phone.value; customer.whatsapp_optin = wa.checked; ok(m1, "Enregistré."); } catch (x) { ko(m1, x.message); } } },
        field("Numéro WhatsApp (avec indicatif)", phone), h("label", { class: "acc-check" }, wa, h("span", {}, "Me prévenir sur WhatsApp quand je reçois un message ou une réponse et que je ne suis pas connecté.")), m1, h("button", { class: "acc-cash", type: "submit" }, "Enregistrer")),
      h("h3", {}, "Boîte à suggestions"),
      h("form", { onsubmit: async (e) => { e.preventDefault(); try { await api("/api/customer?a=suggest", "POST", { message: sug.value }); sug.value = ""; ok(m3, "Merci, votre suggestion a été envoyée !"); } catch (x) { ko(m3, x.message); } } }, sug, m3, h("button", { class: "acc-cash", type: "submit" }, "Envoyer")),
      h("h3", {}, "Changer mon mot de passe"),
      h("form", { onsubmit: async (e) => { e.preventDefault(); try { await api("/api/customer?a=password", "POST", { current: cur.value, next: nxt.value }); cur.value = nxt.value = ""; ok(m2, "Mot de passe modifié."); } catch (x) { ko(m2, x.message); } } },
        field("Mot de passe actuel", cur), field("Nouveau mot de passe (8 caractères min.)", nxt), m2, h("button", { class: "acc-cash", type: "submit" }, "Modifier")));
  }

  function accountView() {
    const tabBtn = (id, label) => h("button", { type: "button", class: "acc-tab" + (accTab === id ? " on" : ""), onclick: () => { accTab = id; render("account"); } }, label);
    const body = accTab === "messages" ? messagesTab() : accTab === "profile" ? profileTab() : homeTab();
    return h("div", {}, h("h2", {}, "Bonjour " + customer.name.split(" ")[0]), h("p", { class: "acc-note" }, customer.email),
      h("div", { class: "acc-tabs" }, tabBtn("home", "Accueil"), tabBtn("messages", "Messages"), tabBtn("profile", "Profil")), body,
      h("button", { class: "acc-link", onclick: async () => { await api("/api/customer?a=logout", "POST"); customer = null; unread = 0; updateBtn(); close(); toast("Vous êtes déconnecté."); } }, "Se déconnecter"));
  }

  function render(view, note) {
    stop();
    if (view === "order" && !customer) view = "signup";
    if (view === "account" && !customer) view = "login";
    const content = view === "signup" || view === "login" ? authView(view, note) : view === "order" ? orderView() : view === "thread" ? threadView(note) : accountView();
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
    const css = h("link", { rel: "stylesheet", href: "/css/account.css" }); document.head.append(css);
    box = h("div", { class: "acc-box" });
    dlg = h("dialog", { class: "acc-dialog", "aria-label": "Mon compte" }, box);
    dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
    toastEl = h("div", { class: "acc-toast", role: "status", hidden: true });
    btn = h("button", { type: "button", class: "account-btn", onclick: () => { if (customer) location.href = "/compte"; else open("login"); } }, "Se connecter");
    const cta = document.querySelector(".header-cta");
    if (cta) cta.before(btn); else (document.querySelector(".site-header") || document.body).append(btn);
    document.body.append(dlg, toastEl);
    setInterval(() => { if (customer && !document.hidden) refresh(); }, 45000);
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
