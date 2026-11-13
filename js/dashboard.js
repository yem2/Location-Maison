(function () {
  "use strict";
  const app = document.getElementById("app");
  const NS = "http://www.w3.org/2000/svg";
  const ST = { pending: "En attente", confirmed: "Acceptée", rejected: "Refusée", cancelled: "Annulée" };
  const NAV = [
    ["apercu", "Tableau de bord", "Accueil", "home"], ["demandes", "Mes demandes", "Demandes", "list"], ["visites", "Mes visites", "Visites", "calendar"], ["favoris", "Favoris", "Favoris", "heart"],
    ["messages", "Messagerie", "Messages", "chat"], ["notifications", "Notifications", "Alertes", "bell"], ["profil", "Mon profil", "Profil", "user"]
  ];
  const ICON = {
    calendar: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z|M3 10h18|M8 3v4|M16 3v4",
    home: "M3 11l9-8 9 8|M5 10v10h5v-6h4v6h5V10", list: "M8 6h13|M8 12h13|M8 18h13|M3 6h.01|M3 12h.01|M3 18h.01",
    heart: "M12 21s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z", chat: "M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9|M13.7 21a2 2 0 0 1-3.4 0", user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
  };

  let me = null, view = "apercu", orders = [], notes = [], threads = [], props = null, payCfg = { online: false };
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
    const [o, n, t, c] = await Promise.allSettled([api("/api/orders"), api("/api/customer?a=notifications"), api("/api/chat?a=threads"), api("/api/pay?a=config")]);
    if (o.status === "fulfilled") orders = o.value;
    if (n.status === "fulfilled") { notes = n.value; unreadNotes = notes.filter((x) => !x.is_read).length; }
    if (t.status === "fulfilled") threads = t.value;
    if (c.status === "fulfilled") payCfg = c.value;
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
        h("div", { class: "side-user" }, h("div", { class: "su-id" }, avatarEl(me), h("div", {}, h("strong", {}, me.name), h("small", { class: "muted" }, me.email))),
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
    orders.filter((o) => o.status === "confirmed" && Number(o.amount) > 0 && !["paid", "cash_pending"].includes(o.payment_status)).forEach((o) => { due[o.currency] = (due[o.currency] || 0) + Number(o.amount); });
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

  function payBlock(o) {
    if (o.status !== "confirmed") return "";
    const parts = [];
    if (Number(o.amount) > 0) {
      parts.push(h("div", {}, "Acompte de réservation : ", h("strong", {}, money(o.amount, o.currency))));
      if (o.payment_status === "paid") parts.push(h("div", {}, h("span", { class: "pill paid" }, "Payé ✓")));
      else if (o.payment_status === "refunded") parts.push(h("div", { class: "muted" }, "Acompte remboursé."));
      else if (o.payment_status === "cash_pending") parts.push(h("div", { class: "muted" }, o.payment_method === "cash" ? "Paiement en espèces à régler à l’agence." : "Paiement déclaré : en attente de confirmation par notre équipe."));
      else {
        if (o.payment_status === "pending") parts.push(h("div", { class: "muted" }, "Un paiement est en cours ou n’a pas abouti : vous pouvez réessayer."));
        parts.push(h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => window.MaisonPay.open(o, async () => { await reloadOrders(); render(); }) }, "Payer l’acompte")));
      }
    }
    // Documents : reçu (une fois payé) et projet de contrat (dès que la demande est acceptée)
    parts.push(h("div", { class: "row docs" },
      o.payment_status === "paid" ? h("a", { class: "btn ghost sm", href: "/api/pay?a=receipt&orderId=" + o.id, download: "" }, "Télécharger le reçu (PDF)") : "",
      h("a", { class: "btn ghost sm", href: "/api/pay?a=contract&orderId=" + o.id, download: "" }, "Projet de contrat (PDF)"),
      h("a", { class: "btn ghost sm", href: "/compte?visite=" + encodeURIComponent(o.property_id || "") + "#visites" }, "Planifier une visite")));
    return h("div", { class: "paybox" }, ...parts);
  }
  function requests() {
    const groups = { all: () => true, pending: (o) => o.status === "pending", confirmed: (o) => o.status === "confirmed", closed: (o) => ["rejected", "cancelled"].includes(o.status) };
    const labels = { all: "Toutes", pending: "En attente", confirmed: "Acceptées", closed: "Refusées / annulées" };
    const rows = orders.filter(groups[filter]);
    return h("div", { style: "display:grid;gap:16px;min-width:0" },
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

  // ---------- Visites ----------
  const VST = { requested: "Demandée", confirmed: "Confirmée", declined: "Refusée", cancelled: "Annulée", done: "Effectuée" };
  const fmtDay = (d) => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const addDays = (d, n) => new Date(new Date(d + "T12:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
  function visits() {
    const params = new URLSearchParams(location.search);
    let list = null;
    const listBox = h("div", { class: "card" }, h("h2", {}, "Mes visites"), h("p", { class: "muted" }, "Chargement…"));
    const loadList = () => api("/api/orders?a=visits").then((r) => { list = r; date.min = r.today; date.max = addDays(r.today, 60); drawList(); })
      .catch((x) => listBox.replaceChildren(h("h2", {}, "Mes visites"), h("p", { class: "err" }, x.message)));
    async function cancel(v) {
      if (!confirm("Annuler cette visite ?")) return;
      try { await api("/api/orders?a=visit_cancel", "POST", { id: v.id }); toast("Visite annulée."); loadList(); loadSlots(); } catch (x) { toast(x.message); }
    }
    function drawList() {
      const today = list.today, active = (v) => ["requested", "confirmed"].includes(v.status) && v.date >= today;
      const up = list.visits.filter(active).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      const past = list.visits.filter((v) => !active(v));
      const item = (v) => h("div", { class: "visit" },
        h("div", { class: "visit-d" }, h("strong", {}, fmtDay(v.date)), h("span", {}, "à " + v.time)),
        h("div", { class: "visit-m" }, h("strong", {}, v.property_title), v.note ? h("small", { class: "muted" }, "Votre message : " + v.note) : "", v.admin_note ? h("small", { class: "muted" }, "Équipe : " + v.admin_note) : ""),
        h("span", { class: "pill vs-" + v.status }, VST[v.status] || v.status),
        h("div", { class: "visit-a" },
          v.status === "confirmed" ? h("a", { class: "btn ghost sm", href: "/api/orders?a=visit_ics&id=" + v.id, download: "" }, "Ajouter au calendrier") : "",
          active(v) ? h("button", { class: "btn ghost sm", type: "button", onclick: () => cancel(v) }, "Annuler") : ""));
      listBox.replaceChildren(h("h2", {}, "Mes visites"), ...(up.length ? up.map(item) : [empty("Aucune visite à venir.")]), ...(past.length ? [h("h3", { class: "muted", style: "margin:16px 0 6px" }, "Historique"), ...past.slice(0, 10).map(item)] : []));
    }

    const prop = h("select", { "aria-label": "Bien à visiter" }, h("option", { value: "" }, "Choisir un bien…"));
    const date = h("input", { type: "date", "aria-label": "Date de la visite" });
    const slotsBox = h("div", { class: "slots", role: "group", "aria-label": "Horaires disponibles" });
    const note = h("textarea", { rows: 2, maxlength: 300, placeholder: "Message pour l’équipe (facultatif)" });
    const err = h("p", { class: "err", role: "alert" }), btn = h("button", { class: "btn", type: "submit", disabled: true }, "Demander cette visite");
    let time = "";
    function loadSlots() {
      time = ""; btn.disabled = true;
      if (!prop.value || !date.value) { slotsBox.replaceChildren(h("small", { class: "muted" }, "Choisissez un bien et une date pour voir les horaires.")); return; }
      slotsBox.replaceChildren(h("small", { class: "muted" }, "Chargement…"));
      api("/api/orders?a=visit_slots&propertyId=" + encodeURIComponent(prop.value) + "&date=" + date.value).then((r) => {
        if (!r.dayOk) { slotsBox.replaceChildren(h("small", { class: "muted" }, "Pas de visites ce jour-là : choisissez un autre jour.")); return; }
        if (!r.slots.some((s) => s.free)) { slotsBox.replaceChildren(h("small", { class: "muted" }, "Plus de créneau libre ce jour-là : essayez une autre date.")); return; }
        slotsBox.replaceChildren(...r.slots.map((s) => h("button", { type: "button", class: "slot" + (s.free ? "" : " off"), disabled: !s.free, onclick: (e) => {
          time = s.time; [...slotsBox.children].forEach((c) => c.classList.toggle("on", c === e.currentTarget)); btn.disabled = false;
        } }, s.time)));
      }).catch((x) => slotsBox.replaceChildren(h("small", { class: "err" }, x.message)));
    }
    prop.addEventListener("change", loadSlots); date.addEventListener("change", loadSlots);
    const fillProps = (arr) => {
      arr.filter((p) => p.published !== false).forEach((p) => prop.append(h("option", { value: p.id }, p.title + (p.location ? " — " + p.location : ""))));
      const want = params.get("visite"); if (want && [...prop.options].some((o) => o.value === want)) prop.value = want;
      loadSlots();
    };
    if (props) fillProps(props); else api("/api/properties").then((r) => { props = Array.isArray(r) ? r : []; fillProps(props); }).catch(() => { err.textContent = "Impossible de charger la liste des biens."; });
    slotsBox.append(h("small", { class: "muted" }, "Choisissez un bien et une date pour voir les horaires."));

    const form = h("form", { class: "form", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ""; btn.disabled = true;
      try {
        await api("/api/orders?a=visit_book", "POST", { propertyId: prop.value, date: date.value, time, note: note.value });
        note.value = ""; toast("Demande envoyée. Vous serez notifié dès la confirmation."); await loadList(); loadSlots();
      } catch (x) { err.textContent = x.message; btn.disabled = !time; loadSlots(); }
    } }, field("Bien à visiter", prop), field("Date", date), h("div", { class: "field" }, h("span", {}, "Horaire"), slotsBox), field("Message", note), err, btn);
    loadList();
    return h("div", { style: "display:grid;gap:20px;min-width:0" }, h("div", { class: "card" }, h("h2", {}, "Planifier une visite"), h("p", { class: "muted" }, "Choisissez un créneau libre : notre équipe confirme, puis vous recevez un rappel la veille et le jour même."), form), listBox);
  }

  const VIEWS = { apercu: overview, demandes: requests, visites: visits, favoris: favorites, messages: messaging, notifications, profil: profile };

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
      } }, field("E-mail", email), field("Mot de passe", pw), err, btn,
        h("p", { class: "muted", style: "margin:10px 0 0;text-align:center" }, h("a", { href: "#forgot", onclick: (e) => { e.preventDefault(); history.replaceState(null, "", "/compte#forgot"); showForgot(); } }, "Mot de passe oublié ?")))),
      h("p", { class: "muted" }, "Pas encore de compte ? ", h("a", { href: "/" }, "Retour au site"), " puis « Se connecter » → « Créer un compte ».")));
  }

  // ---------- Mot de passe oublié ----------
  function showForgot() {
    stopPoll(); clearInterval(countT); app.className = "boot";
    const email = h("input", { type: "email", autocomplete: "email", required: true }), err = h("p", { class: "err", role: "alert" }, ""), done = h("p", { class: "muted", role: "status" }, "");
    const btn = h("button", { class: "btn", type: "submit" }, "Envoyer le lien");
    app.replaceChildren(h("div", { class: "loginbox" }, brand(), h("div", { class: "card" }, h("h2", {}, "Mot de passe oublié"),
      h("p", { class: "muted" }, "Saisissez l’e-mail de votre compte : nous vous enverrons un lien pour choisir un nouveau mot de passe."),
      h("form", { class: "form", style: "margin-top:14px", onsubmit: async (e) => {
        e.preventDefault(); err.textContent = ""; done.textContent = ""; btn.disabled = true;
        try {
          const r = await api("/api/customer?a=forgot", "POST", { email: email.value });
          if (r.mail === false) err.textContent = "L’envoi d’e-mails n’est pas encore disponible. Contactez-nous : un administrateur peut réinitialiser votre mot de passe.";
          else done.textContent = "Si un compte correspond à cette adresse, un lien de réinitialisation vient d’être envoyé (valable 30 minutes). Pensez à vérifier vos courriers indésirables.";
        } catch (x) { err.textContent = x.message; }
        btn.disabled = false;
      } }, field("E-mail", email), done, err, btn,
        h("p", { class: "muted", style: "margin:10px 0 0;text-align:center" }, h("a", { href: "/compte", onclick: (e) => { e.preventDefault(); history.replaceState(null, "", "/compte"); showLogin(); } }, "Retour à la connexion"))))));
  }
  function showReset(token) {
    stopPoll(); clearInterval(countT); app.className = "boot";
    const p1 = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 8 }), p2 = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 8 });
    const err = h("p", { class: "err", role: "alert" }, ""), btn = h("button", { class: "btn", type: "submit" }, "Enregistrer le mot de passe");
    app.replaceChildren(h("div", { class: "loginbox" }, brand(), h("div", { class: "card" }, h("h2", {}, "Nouveau mot de passe"), h("p", { class: "muted" }, "Choisissez un mot de passe d’au moins 8 caractères."),
      h("form", { class: "form", style: "margin-top:14px", onsubmit: async (e) => {
        e.preventDefault(); err.textContent = "";
        if (p1.value !== p2.value) { err.textContent = "Les deux mots de passe ne correspondent pas."; return; }
        btn.disabled = true;
        try { await api("/api/customer?a=reset", "POST", { token, password: p1.value }); me = null; history.replaceState(null, "", "/compte"); showLogin("Mot de passe modifié. Connectez-vous avec le nouveau."); }
        catch (x) { err.textContent = x.message; btn.disabled = false; }
      } }, field("Nouveau mot de passe", p1), field("Confirmer", p2), err, btn))));
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
  const resetTk = (location.hash.match(/^#reset=([a-f0-9]{64})$/) || [])[1];
  if (resetTk) showReset(resetTk);
  else if (location.hash === "#forgot") showForgot();
  else api("/api/customer?a=me&full=1").then((r) => { me = r.customer; return start(); }).catch(() => showLogin());
})();
