(function () {
  "use strict";
  const CSS = `
.wa-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}.wa-title h2{margin:0}
.wa-badge{font-size:.74rem;font-weight:700;padding:4px 10px;border-radius:999px;background:rgba(99,102,241,.18);color:#6366f1}
.wa-pill{display:inline-block;font-weight:700;font-size:.85rem;padding:6px 14px;border-radius:999px}
.wa-ok{background:rgba(34,197,94,.16);color:#16a34a}.wa-warn{background:rgba(245,158,11,.18);color:#d97706}.wa-bad{background:rgba(239,68,68,.16);color:#dc2626}.wa-off{background:rgba(148,163,184,.2);color:#64748b}
.wa input[type=tel]{width:100%;margin:12px 0 8px}.wa button{margin:4px 8px 4px 0}.wa-ref{min-width:44px;min-height:44px}
.wa-qr{display:block;background:#fff;padding:10px;border-radius:12px;margin:12px 0;max-width:100%;height:auto}
.wa-note{font-size:.8rem;margin-top:14px}.wa-err{color:#dc2626}.wa-okmsg{color:#16a34a}`;

  function view(ctx) {
    const { api, h } = ctx;
    if (!document.getElementById("wa-css")) { const s = document.createElement("style"); s.id = "wa-css"; s.textContent = CSS; document.head.append(s); }
    const box = h("div", { class: "card wa" });
    let busy = false, lastQr = 0, qrImg = null, st = null, note = "", noteErr = false;
    const phone = h("input", { type: "tel", placeholder: "Numéro de test (ex. +237 699 12 34 56)", autocomplete: "off" });
    const say = (t, err) => { note = t; noteErr = !!err; draw(); };
    const act = async (fn) => { if (busy) return; busy = true; note = ""; draw(); try { await fn(); } catch (e) { say(e.message, true); } busy = false; await refresh(true); };
    const pill = (cls, t) => h("span", { class: "wa-pill " + cls }, t);

    function draw() {
      const kids = [h("div", { class: "wa-title" }, h("h2", {}, "WhatsApp par QR code"), h("span", { class: "wa-badge" }, "Service géré"))];
      if (!st) kids.push(h("p", { class: "muted" }, "Chargement…"));
      else if (!st.configured) kids.push(h("p", {}, "Le service n’est pas encore relié au site."), h("p", { class: "muted" }, "Ajoutez GREEN_API_ID, GREEN_API_TOKEN et GREEN_API_URL dans Vercel (Settings > Environment Variables), puis redéployez." + (st.meta ? " Les notifications passent pour l’instant par l’API Cloud de Meta." : "")));
      else {
        const label = { connected: ["wa-ok", "Connecté"], qr: ["wa-warn", "En attente du scan"], starting: ["wa-warn", "Démarrage…"], failed: ["wa-bad", "Numéro bloqué"], stopped: ["wa-off", "Déconnecté"], unreachable: ["wa-bad", "Service injoignable"] }[st.state] || ["wa-off", "Déconnecté"];
        kids.push(h("div", { class: "row" }, pill(label[0], label[1]), h("button", { class: "ghost wa-ref", title: "Actualiser", "aria-label": "Actualiser", onclick: () => refresh(true) }, "↻")));
        if (st.state === "connected") {
          if (st.number) kids.push(h("p", { class: "muted" }, st.number));
          if (st.warning) kids.push(h("p", { class: "wa-err" }, "Avertissement WhatsApp (carton jaune) : réduisez le volume d’envois."));
          kids.push(phone,
            h("button", { disabled: busy, onclick: () => act(async () => { await api("/api/console?a=wa_test", "POST", { phone: phone.value }); say("Message de test envoyé."); }) }, "Envoyer le test"),
            h("button", { class: "ghost", disabled: busy, onclick: () => { if (confirm("Déconnecter ce numéro de WhatsApp ?")) act(async () => { await api("/api/console?a=wa_logout", "POST", {}); qrImg = null; }); } }, "Déconnecter le numéro"));
        } else if (st.state === "qr") {
          kids.push(qrImg ? h("img", { class: "wa-qr", src: qrImg, alt: "QR code WhatsApp", width: 240, height: 240 }) : h("p", { class: "muted" }, "Génération du QR code…"),
            h("p", { class: "muted" }, "Sur le téléphone : WhatsApp > Paramètres > Appareils connectés > Connecter un appareil, puis scannez ce code."));
        } else if (st.state === "failed") {
          kids.push(h("p", { class: "wa-err" }, "WhatsApp a bloqué ce numéro. Contactez le support Green API ou utilisez un autre numéro."));
        } else if (st.state !== "unreachable") {
          kids.push(h("p", { class: "muted" }, "Aucun numéro connecté : les notifications WhatsApp ne partent pas."),
            h("button", { disabled: busy, onclick: () => act(async () => { await api("/api/console?a=wa_start", "POST", {}); }) }, "Générer le QR code"));
        } else kids.push(h("p", { class: "muted" }, "Green API ne répond pas. Vérifiez GREEN_API_ID, GREEN_API_TOKEN et GREEN_API_URL dans Vercel."));
      }
      if (note) kids.push(h("p", { class: noteErr ? "wa-err" : "wa-okmsg", role: "status" }, note));
      kids.push(h("p", { class: "muted wa-note" }, "Solution non officielle : le numéro peut être bloqué par WhatsApp et les messages transitent par le prestataire. Utilisez un numéro dédié à l’entreprise."));
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
    const timer = setInterval(() => { if (!box.isConnected) return clearInterval(timer); if (!busy) refresh(false); }, 5000);
    return box;
  }
  window.AdminWhatsApp = { view };
})();
