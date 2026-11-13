(function () {
  "use strict";
  const LABEL = { cash: "Espèces", orange_money: "Orange Money", mtn_money: "MTN Mobile Money", card: "Carte Visa / Mastercard", paypal: "PayPal", bank_transfer: "Virement bancaire" };
  const STATUS = { pending: "En attente", review: "À vérifier", paid: "Payé ✓", failed: "Échoué", cancelled: "Annulé" };
  const money = (a, c) => new Intl.NumberFormat("fr-FR").format(Number(a) || 0) + " " + (c || "");

  // =============== Transactions ===============
  function transactions(ctx) {
    const { me, api, h, when } = ctx;
    const isSuper = me.role === "super_admin";
    let status = "", method = "";
    const box = h("div", {});
    const sel = (opts, val, on) => { const s = h("select", { onchange: (e) => on(e.target.value) }, opts.map(([v, l]) => h("option", { value: v, selected: v === val }, l))); return s; };

    async function load() {
      box.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      let d;
      try { d = await api(`/api/payments?a=list&status=${status}&method=${method}`); } catch (e) { box.replaceChildren(h("p", { class: "err" }, e.message)); return; }
      const kpis = d.totals.length ? d.totals.flatMap((t) => [
        h("div", { class: "kpi" }, h("div", { class: "kpi-l" }, "Encaissé (30 jours)"), h("div", { class: "kpi-v" }, money(t.paid30, t.currency)), h("div", { class: "kpi-s" }, "Total : " + money(t.paid, t.currency))),
        h("div", { class: "kpi " + (t.review ? "hot" : "") }, h("div", { class: "kpi-l" }, "À vérifier (" + t.currency + ")"), h("div", { class: "kpi-v" }, String(t.review)), h("div", { class: "kpi-s" }, t.pending + " en attente"))
      ]) : [h("p", { class: "muted" }, "Aucun paiement enregistré pour l’instant.")];
      const filters = h("div", { class: "row" },
        h("div", { class: "row" },
          sel([["", "Tous les statuts"], ...Object.entries(STATUS)], status, (v) => { status = v; load(); }),
          sel([["", "Tous les moyens"], ...Object.entries(LABEL)], method, (v) => { method = v; load(); })),
        isSuper ? h("a", { class: "btn ghost", href: "/api/payments?a=export", download: "paiements.csv" }, "Exporter (CSV)") : "");
      box.replaceChildren(h("div", { class: "kpis" }, kpis), filters, h("p", { class: "muted" }, d.rows.length + " transaction(s)"), ...d.rows.map(card));
    }

    function actions(p) {
      if (!["pending", "review"].includes(p.status)) return "";
      if (p.method !== "cash" && !isSuper) return h("p", { class: "muted" }, "À valider par le super administrateur.");
      if (p.provider === "flutterwave" || p.provider === "paypal") return h("p", { class: "muted" }, "Vérification automatique auprès de " + (p.provider === "paypal" ? "PayPal" : "Flutterwave") + ".");
      return h("div", { class: "row" },
        h("button", { onclick: async (e) => {
          if (!confirm(`Confirmer que ${money(p.amount, p.currency)} a bien été reçu (${LABEL[p.method]}${p.provider_ref ? ", réf. " + p.provider_ref : ""}) ?`)) return;
          e.currentTarget.disabled = true;
          try { await api("/api/payments?a=confirm", "POST", { id: p.id }); load(); } catch (x) { alert(x.message); e.currentTarget.disabled = false; }
        } }, "Confirmer la réception"),
        h("button", { class: "danger", onclick: async (e) => {
          const reason = prompt("Motif du refus (visible par le client) :", "Transaction introuvable"); if (reason === null) return;
          e.currentTarget.disabled = true;
          try { await api("/api/payments?a=reject", "POST", { id: p.id, reason }); load(); } catch (x) { alert(x.message); e.currentTarget.disabled = false; }
        } }, "Refuser"));
    }

    function card(p) {
      return h("div", { class: "card" + (p.status === "review" ? " unread" : "") },
        h("div", { class: "row" }, h("strong", {}, money(p.amount, p.currency) + " · " + (LABEL[p.method] || p.method)), h("span", { class: "pill" }, STATUS[p.status] || p.status)),
        h("div", { class: "muted" }, (p.property_title || "(bien supprimé)") + " — demande n°" + p.order_id),
        h("div", { class: "muted" }, (p.customer_name || "?") + (p.customer_email ? " · " + p.customer_email : "") + (p.customer_phone ? " · " + p.customer_phone : "")),
        p.provider_ref || p.payer_phone || p.payer_name ? h("div", {}, [p.provider_ref && "Réf. : " + p.provider_ref, p.payer_phone && "Tél. payeur : " + p.payer_phone, p.payer_name && "Titulaire : " + p.payer_name].filter(Boolean).join(" · ")) : "",
        p.charged_amount ? h("div", { class: "muted" }, "Débité : " + p.charged_amount + " " + p.charged_currency) : "",
        p.note ? h("div", { class: p.note.startsWith("DOUBLON") ? "err" : "muted" }, p.note) : "",
        h("div", { class: "muted" }, "Créé le " + when(p.created_at) + (p.confirmed_at ? " · validé le " + when(p.confirmed_at) + (p.confirmed_by_name ? " par " + p.confirmed_by_name : "") : "")),
        p.status === "paid" ? h("div", {}, h("a", { href: "/api/payments?a=receipt&id=" + p.id, download: "" }, "📄 Télécharger le reçu (PDF)")) : "",
        actions(p));
    }
    load();
    return box;
  }

  // =============== Moyens de paiement (super administrateur) ===============
  function settings(ctx) {
    const { me, api, h, when } = ctx;
    const box = h("div", {});
    if (me.role !== "super_admin") { box.append(h("div", { class: "card" }, "Réservé au super administrateur.")); return box; }

    async function load() {
      box.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      let d;
      try { d = await api("/api/payments?a=settings"); } catch (e) { box.replaceChildren(h("p", { class: "err" }, e.message)); return; }
      draw(d);
    }

    function draw(d) {
      const cfg = JSON.parse(JSON.stringify(d.cfg)), env = d.env;
      const badge = (ok, yes, no) => h("span", { class: "pill " + (ok ? "ok" : ""), style: ok ? "color:var(--ok);border-color:var(--ok)" : "color:var(--bad);border-color:var(--bad)" }, (ok ? "✓ " : "✗ ") + (ok ? yes : no));
      const text = (m, k, label, attrs = {}) => { const i = h("input", { type: "text", value: cfg[m][k] || "", autocomplete: "off", ...attrs, oninput: (e) => { cfg[m][k] = e.target.value; } }); return h("div", {}, h("label", {}, label), i); };
      const area = (m, k, label) => h("div", {}, h("label", {}, label), h("textarea", { oninput: (e) => { cfg[m][k] = e.target.value; } }, cfg[m][k] || ""));
      const toggle = (m) => h("label", { class: "chk" }, h("input", { type: "checkbox", checked: !!cfg[m].enabled, onchange: (e) => { cfg[m].enabled = e.target.checked; } }), "Activé pour les clients");
      const mode = (m) => h("div", {}, h("label", {}, "Mode"), h("select", { onchange: (e) => { cfg[m].mode = e.target.value; } },
        h("option", { value: "auto", selected: cfg[m].mode !== "manual" }, "Automatique (API Flutterwave) — XAF / XOF"), h("option", { value: "manual", selected: cfg[m].mode === "manual" }, "Manuel (le client paie sur le numéro ci-dessous, vous vérifiez)")));
      const section = (m, title, ...kids) => h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, title), toggle(m)), ...kids);

      const password = h("input", { type: "password", autocomplete: "current-password", placeholder: "Votre mot de passe" });
      const code = me.totp_enabled ? h("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 8, placeholder: "Code à 6 chiffres" }) : null;
      const msg = h("p", { class: "err", role: "alert" }), save = h("button", { type: "button" }, "Enregistrer les moyens de paiement");
      save.addEventListener("click", async () => {
        msg.className = "err"; msg.textContent = ""; save.disabled = true;
        try {
          const r = await api("/api/payments?a=settings", "POST", { cfg, password: password.value, code: code ? code.value : undefined });
          password.value = ""; if (code) code.value = "";
          msg.className = "ok"; msg.textContent = r.changed.length ? "Enregistré : " + r.changed.length + " modification(s). Les administrateurs ont été notifiés." : "Aucun changement.";
          setTimeout(load, 1200);
        } catch (x) { msg.textContent = x.message; }
        save.disabled = false;
      });

      box.replaceChildren(
        h("div", { class: "card" }, h("h2", {}, "Connexion aux fournisseurs"),
          h("div", { class: "row", style: "justify-content:flex-start" }, badge(env.flutterwave, "Flutterwave (carte, Orange, MTN)", "Flutterwave : clé absente"), badge(env.flutterwaveWebhook, "Webhook Flutterwave", "Webhook Flutterwave absent"),
            badge(env.paypal, env.paypalSandbox ? "PayPal (mode test)" : "PayPal", "PayPal : clés absentes"), badge(env.paypalWebhook, "Webhook PayPal", "Webhook PayPal absent"), badge(env.siteUrl, "SITE_URL", "SITE_URL absent"), badge(env.secret, "APP_SECRET", "APP_SECRET absent")),
          h("p", { class: "muted" }, "Les clés secrètes se règlent uniquement dans Vercel › Settings › Environment Variables (FLW_SECRET_KEY, FLW_WEBHOOK_HASH, PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_WEBHOOK_ID, SITE_URL, APP_SECRET). Elles ne sont jamais enregistrées ni affichées ici.")),
        h("div", { class: "banner" }, "⚠️ Les numéros et comptes ci-dessous sont affichés aux clients. Vérifiez chaque chiffre : toute modification demande votre mot de passe, est journalisée et notifiée aux administrateurs."),
        section("cash", "Espèces", text("cash", "address", "Adresse de l’agence"), area("cash", "instructions", "Instructions (horaires, interlocuteur…)")),
        section("orange_money", "Orange Money", mode("orange_money"), text("orange_money", "number", "Numéro Orange Money de l’agence", { inputmode: "tel", placeholder: "+237 6 .. .. .. .." }), text("orange_money", "holder", "Nom du titulaire du compte"), area("orange_money", "instructions", "Instructions supplémentaires")),
        section("mtn_money", "MTN Mobile Money", mode("mtn_money"), text("mtn_money", "number", "Numéro MTN MoMo de l’agence", { inputmode: "tel", placeholder: "+237 6 .. .. .. .." }), text("mtn_money", "holder", "Nom du titulaire du compte"), area("mtn_money", "instructions", "Instructions supplémentaires")),
        section("card", "Carte Visa / Mastercard", h("p", { class: "muted" }, "Paiement sécurisé par Flutterwave : les données de carte ne passent jamais par votre site.")),
        section("paypal", "PayPal", text("paypal", "email", "E-mail du compte PayPal marchand (information)", { inputmode: "email" }), h("p", { class: "muted" }, "Le franc CFA est converti en euros à la parité fixe (655,957 FCFA = 1 €), arrondi au centime supérieur.")),
        section("bank_transfer", "Virement bancaire", text("bank_transfer", "bank", "Banque"), text("bank_transfer", "holder", "Titulaire du compte"), text("bank_transfer", "iban", "IBAN (contrôle automatique)"), text("bank_transfer", "account", "Numéro de compte / RIB"), text("bank_transfer", "swift", "BIC / SWIFT"), area("bank_transfer", "instructions", "Instructions supplémentaires")),
        h("div", { class: "card" }, h("h2", {}, "Confirmer et enregistrer"), h("p", { class: "muted" }, "Pour votre sécurité, confirmez avec votre mot de passe" + (me.totp_enabled ? " et votre code de double authentification." : ".")),
          h("div", { class: "grid" }, h("div", {}, h("label", {}, "Mot de passe"), password), code ? h("div", {}, h("label", {}, "Code 2FA"), code) : ""), msg, save,
          d.meta ? h("p", { class: "muted" }, "Dernière modification : " + when(d.meta.updated_at) + (d.meta.by_name ? " par " + d.meta.by_name : "")) : ""),
        h("div", { class: "card" }, h("h2", {}, "Historique des modifications"),
          d.log.length ? h("div", { style: "overflow-x:auto" }, h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, ["Date", "Par", "Modifié", "IP"].map((x) => h("th", {}, x)))),
            h("tbody", {}, d.log.map((l) => h("tr", {}, h("td", {}, when(l.at)), h("td", {}, l.name || "?"), h("td", {}, l.changed), h("td", {}, l.ip || "")))))) : h("p", { class: "muted" }, "Aucune modification pour l’instant.")));
    }
    load();
    return box;
  }

  window.AdminPay = { transactions, settings };
})();
