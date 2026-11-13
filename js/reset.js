(function () {
  "use strict";
  const app = document.getElementById("app");
  const token = location.hash.slice(1);
  const type = new URLSearchParams(location.search).get("type") === "admin" ? "admin" : "client";
  if (token) history.replaceState(null, "", "/reinitialiser"); // le jeton ne reste pas dans l'historique
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (v === true) el.setAttribute(k, ""); else if (v !== false && v != null) el.setAttribute(k, v); }
    kids.flat().forEach((c) => { if (c !== false && c != null) el.append(c instanceof Node ? c : document.createTextNode(c)); });
    return el;
  }
  async function post(path, body) {
    const r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Erreur " + r.status);
    return d;
  }
  const field = (label, input) => h("label", { class: "field" }, h("span", {}, label), input);
  const shell = (...kids) => app.replaceChildren(h("div", { class: "loginbox" }, h("a", { class: "brand", href: "/" }, h("b", {}, "M"), h("span", {}, "maison.")), h("div", { class: "card" }, ...kids)));

  function request() {
    const email = h("input", { type: "email", autocomplete: "email", required: true }), err = h("p", { class: "err", role: "alert" }), btn = h("button", { class: "btn", type: "submit" }, "Envoyer le lien");
    const back = type === "admin" ? "/admin" : "/compte";
    shell(h("h2", {}, "Mot de passe oublié"), h("p", { class: "muted" }, "Saisissez l’e-mail de votre compte " + (type === "admin" ? "administrateur" : "client") + " : nous vous envoyons un lien pour choisir un nouveau mot de passe."),
      h("form", { class: "form", style: "margin-top:14px", onsubmit: async (e) => {
        e.preventDefault(); err.textContent = ""; btn.disabled = true;
        try { const r = await post(type === "admin" ? "/api/auth?a=forgot" : "/api/customer?a=forgot", { email: email.value }); shell(h("h2", {}, "Vérifiez votre boîte mail"), h("p", {}, r.message), h("a", { class: "btn ghost", href: back }, "Retour à la connexion")); }
        catch (x) { err.textContent = x.message; btn.disabled = false; }
      } }, field("E-mail", email), err, btn), h("p", {}, h("a", { href: back }, "← Retour à la connexion")));
  }

  function reset() {
    const p1 = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 8 }), p2 = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 8 });
    const err = h("p", { class: "err", role: "alert" }), btn = h("button", { class: "btn", type: "submit" }, "Enregistrer le mot de passe");
    shell(h("h2", {}, "Nouveau mot de passe"), h("p", { class: "muted" }, "Choisissez un mot de passe d’au moins 8 caractères (12 pour un compte administrateur)."),
      h("form", { class: "form", style: "margin-top:14px", onsubmit: async (e) => {
        e.preventDefault(); err.textContent = "";
        if (p1.value !== p2.value) { err.textContent = "Les deux mots de passe ne correspondent pas."; return; }
        btn.disabled = true;
        try { const r = await post("/api/customer?a=reset", { token, password: p1.value }); shell(h("h2", {}, "Mot de passe modifié ✓"), h("p", {}, "Vous pouvez maintenant vous connecter avec votre nouveau mot de passe."), h("a", { class: "btn", href: r.kind === "admin" ? "/admin" : "/compte" }, "Se connecter")); }
        catch (x) { err.textContent = x.message; btn.disabled = false; }
      } }, field("Nouveau mot de passe", p1), field("Confirmer le mot de passe", p2), err, btn));
  }
  if (token) reset(); else request();
})();
