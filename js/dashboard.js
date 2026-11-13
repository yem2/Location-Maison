(function () {
  "use strict";
  const app = document.getElementById("app");
  const NS = "http://www.w3.org/2000/svg";
  const ST = { pending: "En attente", confirmed: "Acceptée", rejected: "Refusée", cancelled: "Annulée" };
  const NAV = [
    ["apercu", "Tableau de bord", "Accueil", "home"], ["demandes", "Mes demandes", "Demandes", "list"], ["favoris", "Favoris", "Favoris", "heart"],
    ["messages", "Messagerie", "Messages", "chat"], ["notifications", "Notifications", "Alertes", "bell"], ["profil", "Mon profil", "Profil", "user"]
  ];
  const ICON = {
    home: "M3 11l9-8 9 8|M5 10v10h5v-6h4v6h5V10", list: "M8 6h13|M8 12h13|M8 18h13|M3 6h.01|M3 12h.01|M3 18h.01",
    heart: "M12 21s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z", chat: "M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9|M13.7 21a2 2 0 0 1-3.4 0", user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
  };

  let me = null, view = "apercu", docs = { receipts: [], contracts: [] }, orders = [], notes = [], threads = [], props = null, payCfg = { online: false };
  let unreadNotes = 0, filter = "all", active = null, lastId = 0, pollT = null, countT = null, toastEl = null;

  // ---------- Outils ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    kids.flat().forEach((c) => { if (c !== false && c != null) el.append(c instanceof Node ? c : document.createTextNode(c)); });
    return el;
  }
  function icon(name) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
    for (const d of ICON[name].split("|")) { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); s.append(p); }
    return s;
  }
  async function api(path, method = "GET", body) {
    const r = await fetch(path, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && me && !path.includes("a=login")) { me = null; showLogin("Votre session a expiré, reconnectez-vous."); }
    if (!r.ok) throw new Error(data.error || "Erreur " + r.status);
    return data;
  }
  const money = (a, c) => new Intl.NumberFormat("fr-FR").format(Number(a) || 0) + " " + (c || "");
  const fmtDate = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const fmtTime = (d) => new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const msgUnread = () => threads.reduce((s, t) => s + (t.unread || 0), 0);
  function toast(msg) {
    if (!toastEl) { toastEl = h("div", { class: "toast", role: "status", hidden: true }); document.body.append(toastEl); }
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (toastEl.hidden = true), 5000);
  }
  function avatarEl(u, size) {
    const initials = (u.name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
    return h("div", { class: "avatar" + (size ? " " + size : ""), "aria-hidden": "true" }, u.avatar ? h("img", { src: u.avatar, alt: "" }) : initials);
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
  const field = (label, input) => h("label", { class: "field" }, h("span", {}, label), input);
  const empty = (text, btn) => h("div", { class: "empty" }, h("span", {}, text), btn || "");
  const readFavs = () => { try { const a = JSON.parse(localStorage.getItem("maison-favorites") || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } };

  // ---------- Données ----------
  async function loadData() {
    const [o, n, t, c, dc] = await Promise.allSettled([api("/api/orders"), api("/api/customer?a=notifications"), api("/api/chat?a=threads"), api("/api/pay?a=config"), api("/api/payments?a=mydocs")]);
    if (o.status === "fulfilled") orders = o.value;
    if (n.status === "fulfilled") { notes = n.value; unreadNotes = notes.filter((x) => !x.is_read).length; }
    if (t.status === "fulfilled") threads = t.value;
    if (c.status === "fulfilled") payCfg = c.value;
    if (dc.status === "fulfilled") docs = dc.value;
  }
  async function reloadOrders() { try { orders = await api("/api/orders"); } catch (e) { toast(e.message); } }

  // ---------- Navigation ----------
  function navBtns(tab) {
    return NAV.map(([id, label, short, ic]) => {
      const n = id === "messages" ? msgUnread() : id === "notifications" ? unreadNotes : 0;
      return h("button", { type: "button", class: id === view ? "on" : "", "aria-current": id === view ? "page" : null, onclick: () => go(id) },
        icon(ic), tab ? short : label, n ? h("span", { class: "badge" }, n > 99 ? "99+" : String(n)) : "");
    });
  }
  function refreshNav() {
    const nav = app.querySelector(".nav"), tab = app.querySelector(".tabbar");
    if (nav) nav.replaceChildren(...navBtns(false));
    if (tab) tab.replaceChildren(...navBtns(true));
  }
  function go(id) {
    view = id; history.replaceState(null, "", "#" + id);
    window.scrollTo(0, 0); render();
  }
  function stopPoll() { clearInterval(pollT); pollT = null; }
  async function logout() {
    try { await api("/api/customer?a=logout", "POST"); } catch (e) { /* ignore */ }
    me = null; clearInterval(countT); stopPoll(); showLogin("Vous êtes déconnecté.");
  }

  // ---------- Pages ----------
  function brand() { return h("a", { class: "brand", href: "/" }, h("b", {}, "M"), h("span", {}, "maison.")); }

  async function render() {
    stopPoll();
    const title = NAV.find((n) => n[0] === view)[1];
    const content = h("div", { class: "content" });
    app.className = "dash";
    app.replaceChildren(
      h("aside", { class: "side" }, brand(), h("nav", { class: "nav", "aria-label": "Tableau de bord" }, navBtns(false)),
        h("div", { class: "side-user" }, h("div", { class: "su-id" }, avatarEl(me), h("div", {}, h("strong", {}, me.name))), h("small", { class: "muted su-mail" }, me.email),
          h("a", { class: "btn ghost sm", href: "/" }, "Voir le site"), h("button", { class: "btn ghost sm", type: "button", onclick: logout }, "Se déconnecter"))),
      h("div", { class: "main" },
        h("header", { class: "bar" }, brand(), h("h1", {}, title), h("a", { class: "btn ghost sm", href: "/" }, "Voir le site")), content),
      h("nav", { class: "tabbar", "aria-label": "Navigation mobile" }, navBtns(true)));
    content.append(VIEWS[view]());
  }

  function completeness() {
    const todo = [["photo", me.avatar], ["téléphone", me.phone], ["ville", me.city], ["présentation", me.bio]].filter((x) => !x[1]).map((x) => x[0]);
    if (!todo.length) return "";
    const pct = Math.round(((6 - todo.length) / 6) * 100);
    return h("div", { class: "card complete" }, h("div", { class: "complete-top" }, h("h2", {}, "Complétez votre profil"), h("strong", {}, pct + " %")),
      h("div", { class: "progress", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { style: "width:" + pct + "%" })),
      h("p", { class: "muted" }, "Il manque : " + todo.join(", ") + ". Un profil complet facilite le traitement de vos demandes."),
      h("button", { class: "btn sm", type: "button", onclick: () => go("profil") }, "Compléter mon profil"));
  }
  function overview() {
    const first = me.name.split(" ")[0];
    const pending = orders.filter((o) => o.status === "pending").length, accepted = orders.filter((o) => o.status === "confirmed").length;
    const due = {};
    orders.filter((o) => o.status === "confirmed" && Number(o.amount) > 0 && !["paid", "cash_pending", "review"].includes(o.payment_status)).forEach((o) => { due[o.currency] = (due[o.currency] || 0) + Number(o.amount); });
    const dueTxt = Object.entries(due).map(([c, a]) => money(a, c)).join(" + ");
    const kpi = (label, val, sub, small) => h("div", { class: "card kpi" }, h("span", {}, label), h("strong", { class: small ? "sm" : "" }, val), h("em", {}, sub));
    return h("div", { class: "content-inner", style: "display:grid;gap:20px;min-width:0" },
      h("div", { class: "card hero" }, h("div", {}, h("h2", {}, "Bonjour " + first), h("p", {}, "Suivez vos demandes, vos paiements et vos échanges avec notre équipe.")),
        h("div", { class: "btns" }, h("a", { class: "btn light", href: "/acheter" }, "Parcourir les biens"), h("button", { class: "btn lightghost", type: "button", onclick: () => go("messages") }, "Contacter le support"))),
      completeness(),
      h("div", { class: "kpis" },
        kpi("Demandes en attente", String(pending), pending ? "En cours d’examen" : "Aucune en attente"),
        kpi("Demandes acceptées", String(accepted), accepted ? "Bravo !" : "Pas encore"),
        kpi("Acompte à régler", dueTxt || "Aucun", dueTxt ? "Pour confirmer la réservation" : "Rien à payer", true),
        kpi("Messages non lus", String(msgUnread()), "Messagerie")),
      h("div", { class: "grid2" },
        h("div", { class: "card" }, h("h2", {}, "Dernières demandes"),
          orders.length ? h("div", { class: "list" }, orders.slice(0, 4).map((o) => h("div", { class: "item" }, h("div", {}, h("strong", {}, o.property_title || "Bien supprimé"), h("small", { class: "muted" }, fmtDate(o.created_at))), h("span", { class: "pill " + o.status }, ST[o.status] || o.status))))
            : empty("Vous n’avez pas encore fait de demande.", h("a", { class: "btn sm", href: "/acheter" }, "Trouver un bien")),
          orders.length ? h("p", {}, h("button", { class: "btn ghost sm", type: "button", onclick: () => go("demandes") }, "Voir toutes les demandes")) : ""),
        h("div", { class: "card" }, h("h2", {}, "Notifications récentes"),
          notes.length ? h("div", { class: "list" }, notes.slice(0, 4).map((n) => h("div", { class: "item" + (n.is_read ? "" : " new") }, h("div", {}, n.text, h("br"), h("small", { class: "muted" }, fmtTime(n.created_at))))))
            : empty("Aucune notification pour le moment."),
          notes.length ? h("p", {}, h("button", { class: "btn ghost sm", type: "button", onclick: () => go("notifications") }, "Tout voir")) : "")));
  }

  // ---------- Paiement : choix du moyen (espèces, Orange Money, MTN, carte, PayPal, virement) ----------
  const PMLABEL = { cash: "Espèces", orange_money: "Orange Money", mtn_money: "MTN Mobile Money", card: "Carte Visa / Mastercard", paypal: "PayPal", bank_transfer: "Virement bancaire" };
  const PMBADGE = { cash: "Cash", orange_money: "OM", mtn_money: "MTN", card: "VISA", paypal: "PayPal", bank_transfer: "Banque" };
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); } catch (e) { const t = h("textarea", { value: text }); document.body.append(t); t.select(); try { document.execCommand("copy"); } catch (x) { /* ignore */ } t.remove(); }
    toast("Copié : " + text);
  }
  const copyRow = (label, value) => value ? h("div", { class: "kv" }, h("span", { class: "muted" }, label), h("strong", {}, value), h("button", { class: "btn ghost sm", type: "button", onclick: () => copy(value) }, "Copier")) : "";

  async function openPay(o) {
    const overlay = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": "Choisir un moyen de paiement" }), sheet = h("div", { class: "sheet" });
    overlay.append(sheet);
    const esc = (e) => { if (e.key === "Escape") close(); };
    function close() { overlay.remove(); document.body.classList.remove("noscroll"); document.removeEventListener("keydown", esc); }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", esc); document.body.append(overlay); document.body.classList.add("noscroll");
    const head = h("div", { class: "sheet-head" }, h("div", {}, h("h2", {}, "Payer l’acompte"), h("strong", { class: "amount" }, money(o.amount, o.currency)), h("br"), h("small", { class: "muted" }, o.property_title || "")),
      h("button", { class: "btn ghost sm", type: "button", "aria-label": "Fermer", onclick: close }, "✕"));
    sheet.append(head, h("p", { class: "muted" }, "Chargement des moyens de paiement…"));
    let data;
    try { data = await api("/api/pay?a=methods&orderId=" + o.id); }
    catch (x) { sheet.replaceChildren(head, h("p", { class: "err" }, x.message)); return; }
    if (!data.options.length) { sheet.replaceChildren(head, h("p", { class: "err" }, "Aucun moyen de paiement n’est disponible pour le moment. Contactez l’agence via la messagerie.")); return; }

    let sel = data.options[0];
    const list = h("div", { class: "pms", role: "radiogroup", "aria-label": "Moyens de paiement" }), detail = h("div", { class: "pm-detail" }), err = h("p", { class: "err", role: "alert" });
    const submit = h("button", { class: "btn", type: "button" }), phone = h("input", { type: "tel", inputmode: "tel", autocomplete: "tel", placeholder: "Ex. +237 6 90 00 00 00", maxlength: 25 });
    const txn = h("input", { type: "text", autocapitalize: "characters", autocomplete: "off", maxlength: 40 }), payer = h("input", { type: "text", autocomplete: "name", maxlength: 80 });

    function drawList() {
      list.replaceChildren(...data.options.map((m) => h("button", { type: "button", role: "radio", "aria-checked": m.id === sel.id ? "true" : "false", class: "pm" + (m.id === sel.id ? " on" : ""), onclick: () => { sel = m; err.textContent = ""; drawList(); drawDetail(); } },
        h("span", { class: "pm-badge pm-" + m.id }, PMBADGE[m.id]), h("span", { class: "pm-name" }, m.label,
          h("small", { class: "muted" }, m.kind === "cash" ? "À l’agence" : m.kind === "online" ? "Paiement en ligne sécurisé" : "Transfert puis vérification")))));
    }
    function drawDetail() {
      const amt = money(data.amount, data.currency), kids = [];
      if (sel.kind === "cash") {
        kids.push(h("p", {}, "Réglez ", h("strong", {}, amt), " en espèces à l’agence."), sel.address ? h("p", { class: "muted" }, "📍 " + sel.address) : "", sel.instructions ? h("p", { class: "muted" }, sel.instructions) : "");
        submit.textContent = "Confirmer le paiement en espèces";
      } else if (sel.kind === "online") {
        kids.push(h("p", {}, "Vous serez redirigé vers la page sécurisée de ", h("strong", {}, sel.provider), ". Vos données bancaires ne transitent jamais par notre site."));
        if (sel.converted) kids.push(h("p", { class: "muted" }, "Montant débité par PayPal : " + sel.converted.value + " " + sel.converted.currency_code + " (conversion à parité fixe du franc CFA)."));
        submit.textContent = "Payer " + amt + " avec " + sel.label;
      } else if (sel.id === "bank_transfer") {
        kids.push(h("p", {}, "Faites un virement de ", h("strong", {}, amt), " vers :"), copyRow("Banque", sel.bank), copyRow("Titulaire", sel.holder), copyRow("IBAN", sel.iban), copyRow("N° de compte", sel.account), copyRow("BIC / SWIFT", sel.swift),
          sel.instructions ? h("p", { class: "muted" }, sel.instructions) : "", h("label", { class: "field" }, h("span", {}, "Nom du titulaire du compte débité"), payer), h("label", { class: "field" }, h("span", {}, "Référence de votre virement"), txn));
        submit.textContent = "J’ai payé — envoyer pour vérification";
      } else {
        kids.push(h("p", {}, "1. Envoyez ", h("strong", {}, amt), " via ", sel.label, " au numéro :"), copyRow("Numéro", sel.number), copyRow("Titulaire", sel.holder),
          h("p", {}, "2. Notez l’identifiant de la transaction reçu par SMS, puis renseignez-le ci-dessous."), sel.instructions ? h("p", { class: "muted" }, sel.instructions) : "",
          h("label", { class: "field" }, h("span", {}, "Numéro avec lequel vous avez payé"), phone), h("label", { class: "field" }, h("span", {}, "Identifiant de la transaction (SMS)"), txn));
        submit.textContent = "J’ai payé — envoyer pour vérification";
      }
      if (sel.kind === "manual") kids.push(h("small", { class: "muted" }, "L’agence vérifie votre paiement avant de le valider (généralement sous quelques heures). Ne payez qu’au numéro affiché ici."));
      detail.replaceChildren(...kids);
    }
    submit.addEventListener("click", async () => {
      err.textContent = ""; submit.disabled = true;
      try {
        const r = await api("/api/pay?a=start", "POST", { orderId: o.id, method: sel.id, payerPhone: phone.value, payerName: payer.value, txnRef: txn.value });
        if (r.link) { submit.textContent = "Redirection sécurisée…"; window.location.href = r.link; return; }
        close(); toast(r.done === "cash" ? "Paiement en espèces enregistré : réglez-le à l’agence." : "Paiement envoyé : l’agence le vérifie et vous prévient.");
        await reloadOrders(); render();
      } catch (x) { err.textContent = x.message; submit.disabled = false; }
    });
    sheet.replaceChildren(head, list, detail, err, submit, h("small", { class: "muted secure" }, "🔒 Paiements sécurisés : montant fixé par le serveur, vérification auprès du fournisseur."));
    drawList(); drawDetail();
  }

  const PSTATUS = { pending: "Un paiement est en cours ou n’a pas abouti.", failed: "Le dernier paiement n’a pas abouti : vous pouvez réessayer.", cash_pending: "Paiement en espèces à régler à l’agence.", review: "Paiement en cours de vérification par l’agence." };
  function payBlock(o) {
    if (o.status !== "confirmed" || !(Number(o.amount) > 0)) return "";
    const box = h("div", { class: "paybox" }, h("div", {}, "Acompte de réservation : ", h("strong", {}, money(o.amount, o.currency))));
    if (o.payment_status === "paid") box.append(h("div", {}, h("span", { class: "pill paid" }, "Payé ✓"), o.payment_method && PMLABEL[o.payment_method] ? h("small", { class: "muted" }, " · " + PMLABEL[o.payment_method]) : ""));
    if (o.payment_status === "paid") { const rc = docs.receipts.find((r) => r.order_id === o.id); if (rc) box.append(h("a", { class: "btn ghost sm", href: "/api/payments?a=receipt&id=" + rc.id, download: "" }, "📄 Télécharger le reçu (PDF)")); }
    else if (o.payment_status === "review") box.append(h("div", { class: "muted" }, "⏳ " + PSTATUS.review));
    else {
      if (PSTATUS[o.payment_status]) box.append(h("div", { class: "muted" }, PSTATUS[o.payment_status]));
      box.append(h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => openPay(o) }, o.payment_status === "cash_pending" ? "Changer de moyen de paiement" : "Payer l’acompte")));
    }
    return box;
  }
  const recNum = (r) => "REC-" + new Date(r.confirmed_at).getFullYear() + "-" + String(r.id).padStart(6, "0");
  function documents() {
    if (!docs.receipts.length && !docs.contracts.length) return "";
    const row = (title, sub, url) => h("div", { class: "item" }, h("div", {}, h("strong", {}, title), h("small", { class: "muted" }, sub)), h("a", { class: "btn ghost sm", href: url, download: "" }, "Télécharger (PDF)"));
    return h("div", { class: "card" }, h("h2", {}, "Mes documents"), h("div", { class: "list" },
      docs.contracts.map((k) => row(k.label + " — " + k.number, (k.property_title || "") + " · " + fmtDate(k.created_at), "/api/payments?a=contract&id=" + k.id)),
      docs.receipts.map((r) => row("Reçu de paiement — " + recNum(r), money(r.amount, r.currency) + " · " + (r.property_title || "") + " · " + fmtDate(r.confirmed_at), "/api/payments?a=receipt&id=" + r.id))));
  }
  function requests() {
    const groups = { all: () => true, pending: (o) => o.status === "pending", confirmed: (o) => o.status === "confirmed", closed: (o) => ["rejected", "cancelled"].includes(o.status) };
    const labels = { all: "Toutes", pending: "En attente", confirmed: "Acceptées", closed: "Refusées / annulées" };
    const rows = orders.filter(groups[filter]);
    return h("div", { style: "display:grid;gap:16px;min-width:0" }, documents(),
      h("div", { class: "chips" }, Object.keys(labels).map((k) => h("button", { type: "button", class: "chip" + (k === filter ? " on" : ""), onclick: () => { filter = k; render(); } }, labels[k] + " (" + orders.filter(groups[k]).length + ")"))),
      rows.length ? rows.map((o) => h("div", { class: "card order" },
        h("div", { class: "order-head" }, h("div", {}, h("strong", {}, o.property_title || "Bien supprimé"), h("br"), h("small", { class: "muted" }, "Demande du " + fmtDate(o.created_at))), h("span", { class: "pill " + o.status }, ST[o.status] || o.status)),
        o.message ? h("div", { class: "muted" }, "« " + o.message + " »") : "",
        payBlock(o),
        o.status === "pending" ? h("div", {}, h("button", { class: "btn ghost sm", type: "button", onclick: async () => {
          if (!confirm("Annuler cette demande ?")) return;
          try { await api("/api/orders?id=" + o.id, "DELETE"); await reloadOrders(); render(); } catch (x) { toast(x.message); }
        } }, "Annuler la demande")) : ""))
        : h("div", { class: "card" }, empty(orders.length ? "Aucune demande dans cette catégorie." : "Vous n’avez pas encore fait de demande.", h("a", { class: "btn sm", href: "/acheter" }, "Parcourir les biens"))));
  }

  function favorites() {
    const ids = readFavs(), box = h("div", { style: "display:grid;gap:16px;min-width:0" });
    if (!ids.length) { box.append(h("div", { class: "card" }, empty("Vous n’avez pas encore de favori. Cliquez sur le cœur d’une annonce pour la retrouver ici.", h("a", { class: "btn sm", href: "/acheter" }, "Parcourir les biens")))); return box; }
    box.append(h("div", { class: "card" }, "Chargement de vos favoris…"));
    const draw = () => {
      const list = (props || []).filter((p) => ids.includes(p.id));
      if (!list.length) { box.replaceChildren(h("div", { class: "card" }, empty("Vos favoris ne sont plus disponibles."))); return; }
      box.replaceChildren(h("div", { class: "props" }, list.map((p) => {
        const sym = p.currencySymbol || p.currency || "";
        const url = /rent|loc|louer/i.test(p.operation || "") ? "/louer" : "/acheter";
        return h("div", { class: "card prop" }, h("img", { src: p.image, alt: p.alt || p.title, loading: "lazy" }),
          h("div", {}, h("strong", {}, p.title), h("small", { class: "muted" }, p.location),
            h("span", { class: "price" }, new Intl.NumberFormat("fr-FR").format(p.price) + " " + sym + (p.priceSuffix || "")),
            h("small", { class: "muted" }, [p.rooms ? p.rooms + " pièces" : "", p.bedrooms ? p.bedrooms + " ch." : "", p.area ? p.area + " m²" : ""].filter(Boolean).join(" · ")),
            (p.availability && p.availability !== "available") ? h("span", { class: "pill" }, p.availability === "reserved" ? "Réservé" : "Indisponible") : "",
            h("div", { class: "row" }, h("a", { class: "btn sm", href: url }, "Voir les annonces"),
              h("button", { class: "btn ghost sm", type: "button", onclick: () => { try { localStorage.setItem("maison-favorites", JSON.stringify(readFavs().filter((x) => x !== p.id))); } catch (e) { /* ignore */ } render(); } }, "Retirer"))));
      })));
    };
    if (props) draw(); else api("/api/properties").then((r) => { props = Array.isArray(r) ? r : []; draw(); }).catch(() => box.replaceChildren(h("div", { class: "card" }, h("p", { class: "err" }, "Impossible de charger vos favoris."))));
    return box;
  }

  // ---------- Messagerie ----------
  function messaging() {
    const isMobile = () => window.matchMedia("(max-width: 1023px)").matches;
    const wrap = h("div", { class: "card chat" }), list = h("div", { class: "threads-list" }), msgs = h("div", { class: "msgs" });
    const title = h("span", {}, ""), input = h("textarea", { rows: 1, placeholder: "Écrivez votre message…", maxlength: 2000, "aria-label": "Votre message" });
    const emailIn = h("input", { type: "email", placeholder: "E-mail d’un autre client", "aria-label": "E-mail du client" }), nerr = h("p", { class: "err" });
    const sendBtn = h("button", { class: "btn", type: "button" }, "Envoyer");

    const drawThreads = () => list.replaceChildren(...(threads.length ? threads.map((t) => h("button", { type: "button", class: "thread" + (t.id === active ? " on" : ""), onclick: () => openThread(t) },
      h("div", { class: "t" }, h("span", {}, t.title || "Conversation"), t.unread ? h("span", { class: "badge" }, String(t.unread)) : ""), h("div", { class: "l" }, t.last_body || "Aucun message")))
      : [h("p", { class: "muted", style: "padding:16px" }, "Aucune conversation.")]));
    const addMsgs = (rows, first) => {
      const near = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120;
      if (first) msgs.replaceChildren();
      rows.forEach((m) => msgs.append(h("div", { class: "msg" + (m.mine ? " mine" : "") }, m.body, h("small", {}, (m.mine ? "" : m.who + " · ") + fmtTime(m.created_at)))));
      if (rows.length) lastId = rows[rows.length - 1].id;
      if (first && !rows.length) msgs.append(h("div", { class: "conv-empty" }, "Aucun message pour l’instant. Écrivez le premier !"));
      if (rows.length && !first) msgs.querySelector(".conv-empty")?.remove();
      if (first || near) msgs.scrollTop = msgs.scrollHeight;
    };
    async function loadMsgs(first) {
      if (!active) return;
      try { const rows = await api(`/api/chat?a=messages&thread=${active}&after=${first ? 0 : lastId}`); addMsgs(rows, first); if (rows.length) { const t = threads.find((x) => x.id === active); if (t) { t.unread = 0; drawThreads(); refreshNav(); } } }
      catch (e) { if (first) msgs.replaceChildren(h("div", { class: "conv-empty" }, e.message)); }
    }
    function openThread(t) {
      active = t.id; lastId = 0; title.textContent = t.title || "Conversation"; wrap.classList.add("open"); drawThreads(); loadMsgs(true); input.focus({ preventScroll: true });
    }
    async function send() {
      const body = input.value.trim(); if (!body || !active) return;
      sendBtn.disabled = true;
      try { await api("/api/chat?a=send", "POST", { thread: active, body }); input.value = ""; input.style.height = "auto"; await loadMsgs(false); }
      catch (e) { toast(e.message); } finally { sendBtn.disabled = false; }
    }
    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; });
    const startBtn = h("button", { class: "btn ghost sm", type: "button", onclick: async () => {
      nerr.textContent = "";
      try { const r = await api("/api/chat?a=start", "POST", { email: emailIn.value }); emailIn.value = ""; threads = await api("/api/chat?a=threads"); openThread(threads.find((t) => t.id === r.id) || { id: r.id, title: r.title }); }
      catch (e) { nerr.textContent = e.message; }
    } }, "Démarrer");

    wrap.append(
      h("div", { class: "threads" }, list, h("div", { class: "newchat" }, h("small", { class: "muted" }, "Écrire à un autre client"), emailIn, startBtn, nerr)),
      h("div", { class: "conv" }, h("div", { class: "conv-head" }, h("button", { class: "btn ghost sm back", type: "button", onclick: () => wrap.classList.remove("open") }, "← Retour"), title), msgs,
        h("div", { class: "composer" }, input, sendBtn)));
    drawThreads();
    msgs.append(h("div", { class: "conv-empty" }, "Sélectionnez une conversation."));
    const support = threads.find((t) => t.kind === "support");
    if (active && threads.some((t) => t.id === active)) openThread(threads.find((t) => t.id === active));
    else if (support && !isMobile()) openThread(support);
    let tick = 0;
    pollT = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      loadMsgs(false);
      if (++tick % 3 === 0) { try { const t = await api("/api/chat?a=threads"); threads = t; drawThreads(); refreshNav(); } catch (e) { /* ignore */ } }
    }, 6000);
    return wrap;
  }

  // ---------- Notifications ----------
  function notifications() {
    const hadUnread = notes.some((n) => !n.is_read), box = h("div", { class: "card" });
    box.append(h("h2", {}, "Notifications"), notes.length ? h("div", { class: "list" }, notes.map((n) => h("div", { class: "item" + (n.is_read ? "" : " new") }, h("div", {}, n.text, h("br"), h("small", { class: "muted" }, fmtTime(n.created_at))))))
      : empty("Aucune notification pour le moment."));
    if (hadUnread) api("/api/customer?a=notifications", "POST").then(() => { unreadNotes = 0; notes.forEach((n) => (n.is_read = true)); refreshNav(); }).catch(() => {});
    return box;
  }

  // ---------- Profil ----------
  function profile() {
    const name = h("input", { type: "text", value: me.name, maxlength: 100, autocomplete: "name", required: true });
    const phone = h("input", { type: "tel", value: me.phone || "", maxlength: 30, autocomplete: "tel", placeholder: "+237 6XX XX XX XX" });
    const city = h("input", { type: "text", value: me.city || "", maxlength: 80, autocomplete: "address-level2", placeholder: "Ex. Douala" });
    const bio = h("textarea", { rows: 4, maxlength: 500, placeholder: "Quelques mots sur vous (facultatif)" }); bio.value = me.bio || "";
    const wa = h("input", { type: "checkbox" }); wa.checked = !!me.whatsapp_optin;
    let avatar = me.avatar || "";
    const slot = h("div", { class: "avatar-slot" }, avatarEl(me, "lg"));
    const repaint = () => slot.replaceChildren(avatarEl({ name: name.value || me.name, avatar }, "lg"));
    const file = h("input", { type: "file", accept: "image/*", hidden: true, onchange: async (e) => {
      perr.textContent = "";
      try { avatar = await toAvatar(e.target.files[0]); repaint(); } catch (x) { perr.textContent = x.message; } finally { e.target.value = ""; }
    } });
    const perr = h("p", { class: "err", role: "alert" }), pbtn = h("button", { class: "btn", type: "submit" }, "Enregistrer le profil");
    const cur = h("input", { type: "password", autocomplete: "current-password", required: true }), n1 = h("input", { type: "password", autocomplete: "new-password", minlength: 8, required: true }), n2 = h("input", { type: "password", autocomplete: "new-password", minlength: 8, required: true });
    const serr = h("p", { class: "err", role: "alert" }), sbtn = h("button", { class: "btn", type: "submit" }, "Changer le mot de passe");
    return h("div", { style: "display:grid;gap:20px;min-width:0" },
      h("div", { class: "card" }, h("h2", {}, "Mon profil"), h("form", { class: "form", onsubmit: async (e) => {
        e.preventDefault(); perr.textContent = ""; pbtn.disabled = true;
        try {
          const r = await api("/api/customer?a=profile", "POST", { name: name.value, phone: phone.value, city: city.value, bio: bio.value, avatar, whatsapp: wa.checked });
          me = Object.assign(me, r.customer); toast("Profil enregistré."); render();
        } catch (x) { perr.textContent = x.message; pbtn.disabled = false; }
      } },
        h("div", { class: "profile-head" }, slot, h("div", { class: "profile-actions" },
          h("button", { class: "btn ghost sm", type: "button", onclick: () => file.click() }, avatar ? "Changer la photo" : "Ajouter une photo"),
          avatar ? h("button", { class: "btn ghost sm", type: "button", onclick: () => { avatar = ""; repaint(); } }, "Retirer") : "", file,
          h("small", { class: "muted" }, "Image carrée recommandée, recadrée automatiquement."))),
        field("Nom complet", name), field("E-mail (non modifiable)", h("input", { type: "email", value: me.email, readonly: true })),
        field("Téléphone / WhatsApp (avec indicatif)", phone), field("Ville", city), field("À propos de moi", bio),
        h("label", { class: "check" }, wa, h("span", {}, "Me prévenir sur WhatsApp quand je reçois un message ou une réponse et que je ne suis pas connecté.")),
        perr, pbtn)),
      h("div", { class: "card" }, h("h2", {}, "Mot de passe"), h("form", { class: "form", onsubmit: async (e) => {
        e.preventDefault(); serr.textContent = "";
        if (n1.value !== n2.value) { serr.textContent = "Les deux nouveaux mots de passe ne correspondent pas."; return; }
        sbtn.disabled = true;
        try { await api("/api/customer?a=password", "POST", { current: cur.value, next: n1.value }); cur.value = n1.value = n2.value = ""; toast("Mot de passe modifié."); }
        catch (x) { serr.textContent = x.message; } finally { sbtn.disabled = false; }
      } }, field("Mot de passe actuel", cur), field("Nouveau mot de passe (8 caractères minimum)", n1), field("Confirmer le nouveau mot de passe", n2), serr, sbtn)),
      h("div", { class: "card" }, h("h2", {}, "Session"), h("p", { class: "muted" }, "Vous êtes connecté en tant que " + me.email + "."), h("button", { class: "btn danger", type: "button", onclick: logout }, "Se déconnecter")));
  }

  const VIEWS = { apercu: overview, demandes: requests, favoris: favorites, messages: messaging, notifications, profil: profile };

  // ---------- Connexion ----------
  function showLogin(note) {
    stopPoll(); clearInterval(countT); app.className = "boot";
    const email = h("input", { type: "email", autocomplete: "email", required: true }), pw = h("input", { type: "password", autocomplete: "current-password", required: true });
    const err = h("p", { class: "err", role: "alert" }, ""), btn = h("button", { class: "btn", type: "submit" }, "Se connecter");
    app.replaceChildren(h("div", { class: "loginbox" }, brand(), h("div", { class: "card" }, h("h2", {}, "Connexion à votre espace"), note ? h("p", { class: "muted" }, note) : "",
      h("form", { class: "form", style: "margin-top:14px", onsubmit: async (e) => {
        e.preventDefault(); err.textContent = ""; btn.disabled = true;
        try { const r = await api("/api/customer?a=login", "POST", { email: email.value, password: pw.value }); me = r.customer; await start(); }
        catch (x) { err.textContent = x.message; btn.disabled = false; }
      } }, field("E-mail", email), field("Mot de passe", pw), err, btn)),
      h("p", { class: "muted" }, h("a", { href: "/reinitialiser?type=client" }, "Mot de passe oublié ?")),
      h("p", { class: "muted" }, "Pas encore de compte ? ", h("a", { href: "/" }, "Retour au site"), " puis « Se connecter » → « Créer un compte ».")));
  }

  async function start() {
    const hash = location.hash.slice(1);
    view = VIEWS[hash] ? hash : "apercu";
    await loadData();
    const q = new URLSearchParams(location.search).get("paiement");
    if (q) {
      history.replaceState(null, "", "/compte#demandes"); view = "demandes";
      toast(q === "ok" ? "Paiement reçu, merci !" : q === "annule" ? "Paiement annulé." : q === "attente" ? "Paiement en cours de confirmation." : "Le paiement n’a pas abouti.");
    }
    await render();
    clearInterval(countT);
    countT = setInterval(async () => {
      if (document.visibilityState !== "visible" || !me || view === "messages") return;
      try {
        const [m, t] = await Promise.all([api("/api/customer?a=me"), api("/api/chat?a=threads")]);
        unreadNotes = m.unread; threads = t; refreshNav();
      } catch (e) { /* ignore */ }
    }, 30000);
  }

  window.addEventListener("hashchange", () => { const id = location.hash.slice(1); if (me && VIEWS[id] && id !== view) { view = id; render(); } });
  api("/api/customer?a=me&full=1").then((r) => { me = r.customer; return start(); }).catch(() => showLogin());
})();
