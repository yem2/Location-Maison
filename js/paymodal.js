(function () {
  "use strict";
  // Fenêtre « Payer l'acompte » : le client choisit un moyen de paiement activé par l'administration.
  // Aucun montant n'est envoyé : le serveur lit le montant et la devise dans la base.
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
  async function api(path, body) {
    const r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Erreur " + r.status);
    return data;
  }
  const money = (n, c) => { try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n); } catch (e) { return n + " " + c; } };
  const BADGE = { cash: ["ESP", "#5b6b66"], card: ["CB", "#1a1f71"], orange_money: ["OM", "#ff7900"], mtn_momo: ["MoMo", "#e6b800"], paypal: ["PP", "#003087"], bank_transfer: ["VIR", "#0f766e"], other: ["•••", "#6b7280"] };
  const HINT = { online: "Paiement sécurisé en ligne", manual: "Envoi vers notre numéro, puis confirmation", cash: "À régler à l’agence" };

  let styled = false;
  function css() {
    if (styled) return; styled = true;
    const s = document.createElement("style");
    s.textContent = [
      ".mpay-back{position:fixed;inset:0;z-index:1000;background:rgba(10,20,18,.55);display:flex;align-items:flex-end;justify-content:center;padding:0}",
      "@media(min-width:640px){.mpay-back{align-items:center;padding:24px}}",
      ".mpay{width:100%;max-width:480px;max-height:92vh;overflow:auto;background:#fff;color:#14201d;border-radius:18px 18px 0 0;padding:20px 18px calc(20px + env(safe-area-inset-bottom,0px));font:15px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.35)}",
      "@media(min-width:640px){.mpay{border-radius:18px}}",
      "@media(prefers-color-scheme:dark){.mpay{background:#161b1a;color:#eef3f1}.mpay .mp-m{border-color:#2b3533}.mpay .mp-box{background:#1d2422;border-color:#2b3533}.mpay input{background:#1d2422;color:#eef3f1;border-color:#2b3533}.mpay .mp-ghost{color:#eef3f1;border-color:#2b3533}}",
      ".mpay h2{margin:0 0 2px;font-size:1.15rem}.mpay .mp-sub{color:#64736d;margin:0 0 14px}",
      ".mpay .mp-m{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:transparent;color:inherit;border:1px solid #dbe4e0;border-radius:12px;padding:12px;margin-bottom:8px;font:inherit;cursor:pointer;touch-action:manipulation}",
      ".mpay .mp-m:hover,.mpay .mp-m:focus-visible{border-color:#16766e;outline:none}",
      ".mpay .mp-b{flex:none;min-width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:.8rem;padding:0 6px}",
      ".mpay .mp-m strong{display:block}.mpay .mp-m small{color:#64736d}",
      ".mpay .mp-box{background:#f4f8f6;border:1px solid #dbe4e0;border-radius:12px;padding:12px;margin:10px 0;word-break:break-word}",
      ".mpay .mp-num{font-size:1.25rem;font-weight:800;letter-spacing:.02em}",
      ".mpay label{display:block;font-weight:600;margin:10px 0 4px;font-size:.9rem}",
      ".mpay input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cfd9d5;border-radius:10px;font:inherit;font-size:16px;background:#fff;color:inherit}",
      ".mpay .mp-btn{display:block;width:100%;margin-top:12px;padding:13px;border:0;border-radius:12px;background:#16766e;color:#fff;font:inherit;font-weight:700;cursor:pointer;touch-action:manipulation}",
      ".mpay .mp-btn:disabled{opacity:.55;cursor:not-allowed}",
      ".mpay .mp-ghost{display:block;width:100%;margin-top:8px;padding:11px;border:1px solid #cfd9d5;border-radius:12px;background:transparent;color:inherit;font:inherit;cursor:pointer;touch-action:manipulation}",
      ".mpay .mp-err{color:#c0392b;min-height:1.2em;margin:8px 0 0;font-size:.9rem}",
      ".mpay .mp-copy{margin-left:8px;border:1px solid #cfd9d5;background:transparent;color:inherit;border-radius:8px;padding:3px 9px;font:inherit;font-size:.8rem;cursor:pointer}",
      ".mpay .mp-lock{color:#64736d;font-size:.8rem;margin-top:12px;text-align:center}"
    ].join("");
    document.head.append(s);
  }

  function open(order, onDone) {
    css();
    const prevFocus = document.activeElement;
    const back = h("div", { class: "mpay-back" });
    const box = h("div", { class: "mpay", role: "dialog", "aria-modal": "true", "aria-label": "Payer l’acompte" });
    back.append(box);
    const close = () => { document.removeEventListener("keydown", onKey); back.remove(); document.body.style.overflow = ""; if (prevFocus && prevFocus.focus) prevFocus.focus(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    document.body.append(back);

    const state = { methods: [], info: null };
    const closeBtn = (label = "Fermer") => h("button", { class: "mp-ghost", type: "button", onclick: close }, label);

    function loading(msg) { box.replaceChildren(h("p", { class: "mp-sub", role: "status" }, msg)); }
    function failure(msg) { box.replaceChildren(h("h2", {}, "Paiement"), h("p", { class: "mp-err", role: "alert" }, msg), closeBtn()); }
    function done(title, text) {
      box.replaceChildren(h("h2", {}, title), h("p", { class: "mp-sub" }, text), h("button", { class: "mp-btn", type: "button", onclick: () => { close(); if (onDone) onDone(); } }, "Terminé"));
    }

    function list() {
      const { info, methods } = state;
      box.replaceChildren(h("h2", {}, "Payer l’acompte"), h("p", { class: "mp-sub" }, (info.title || "Réservation") + " · ", h("strong", {}, money(info.amount, info.currency))));
      if (!methods.length) { box.append(h("p", { class: "mp-err", role: "alert" }, "Aucun moyen de paiement n’est disponible pour le moment. Contactez-nous depuis la messagerie."), closeBtn()); return; }
      for (const m of methods) {
        const [txt, color] = BADGE[m.kind] || BADGE.other;
        box.append(h("button", { class: "mp-m", type: "button", onclick: () => choose(m) },
          h("span", { class: "mp-b", style: "background:" + color + (m.kind === "mtn_momo" ? ";color:#222" : "") }, txt),
          h("span", {}, h("strong", {}, m.label), h("small", {}, HINT[m.mode] || ""))));
      }
      box.append(closeBtn("Annuler"), h("p", { class: "mp-lock" }, "🔒 Vos données bancaires ne passent jamais par ce site."));
    }

    function choose(m) {
      const err = h("p", { class: "mp-err", role: "alert" });
      const back2 = h("button", { class: "mp-ghost", type: "button", onclick: list }, "← Autres moyens de paiement");
      const amount = money(state.info.amount, state.info.currency);
      const send = async (btn, extra) => {
        btn.disabled = true; err.textContent = "";
        try {
          const r = await api("/api/pay?a=start", { orderId: order.id, methodId: m.id, ...extra });
          if (r.link) { box.replaceChildren(h("p", { class: "mp-sub", role: "status" }, "Redirection vers la page de paiement sécurisée…")); window.location.href = r.link; return; }
          if (m.mode === "cash") done("Paiement en espèces enregistré", "Réglez le montant à l’agence. Il sera confirmé par notre équipe, vous serez notifié.");
          else done("Merci !", "Votre paiement est en cours de vérification par notre équipe. Vous serez notifié dès sa confirmation.");
        } catch (x) { err.textContent = x.message; btn.disabled = false; }
      };

      if (m.mode === "online") {
        const go = h("button", { class: "mp-btn", type: "button", onclick: () => send(go, {}) }, "Payer " + amount);
        box.replaceChildren(h("h2", {}, m.label), h("p", { class: "mp-sub" }, "Vous allez être redirigé vers la page de paiement sécurisée du fournisseur."), go, err, back2);
      } else if (m.mode === "cash") {
        const go = h("button", { class: "mp-btn", type: "button", onclick: () => send(go, {}) }, "Je paierai " + amount + " en espèces");
        box.replaceChildren(h("h2", {}, m.label), h("p", { class: "mp-sub" }, "Présentez-vous à l’agence avec le montant de l’acompte."),
          m.instructions ? h("div", { class: "mp-box" }, m.instructions) : "", go, err, back2);
      } else {
        const ref = h("input", { type: "text", maxlength: "40", autocomplete: "off", autocapitalize: "characters", placeholder: "Ex. MP240101.1234.A55", "aria-label": "Référence de la transaction" });
        const copy = h("button", { class: "mp-copy", type: "button", onclick: async (e) => { try { await navigator.clipboard.writeText(m.account_number); e.target.textContent = "Copié ✓"; } catch (x) { e.target.textContent = "Copie impossible"; } } }, "Copier");
        const go = h("button", { class: "mp-btn", type: "button", onclick: () => send(go, { payerRef: ref.value }) }, "J’ai effectué le paiement");
        box.replaceChildren(h("h2", {}, m.label),
          h("p", { class: "mp-sub" }, "1. Envoyez exactement ", h("strong", {}, amount), " à :"),
          h("div", { class: "mp-box" }, m.account_name ? h("div", {}, m.account_name) : "", h("div", { class: "mp-num" }, m.account_number, copy)),
          m.instructions ? h("p", { class: "mp-sub" }, m.instructions) : "",
          h("p", { class: "mp-sub", style: "margin-bottom:0" }, "2. Saisissez la référence de la transaction reçue par SMS ou e-mail :"),
          ref, go, err, back2);
      }
    }

    loading("Chargement des moyens de paiement…");
    api("/api/pay?a=methods", { orderId: order.id }).then((r) => { state.info = r.order; state.methods = r.methods; list(); }).catch((x) => failure(x.message));
  }

  window.MaisonPay = { open };
})();
