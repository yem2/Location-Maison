(function () {
  "use strict";
  const STATUS = { issued: "Émis", void: "Annulé" };
  function view(ctx) {
    const { me, api, h, when } = ctx, isSuper = me.role === "super_admin", box = h("div", {});
    async function load() {
      box.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      let d; try { d = await api("/api/payments?a=contracts"); } catch (e) { box.replaceChildren(h("p", { class: "err" }, e.message)); return; }
      draw(d);
    }
    function draw(d) {
      const today = new Date().toISOString().slice(0, 10), f = { kind: "location", orderId: d.orders[0]?.id || "", city: d.agency.city || "", date: today, months: 12, payDay: 5, notice: 1, validity: 15, buyerFees: true, refundable: true };
      const ord = () => d.orders.find((o) => String(o.id) === String(f.orderId));
      const fields = h("div", { class: "grid" }), msg = h("p", { class: "err", role: "alert" });
      const inp = (k, label, attrs = {}) => h("div", {}, h("label", {}, label), h("input", { value: f[k] ?? "", autocomplete: "off", ...attrs, oninput: (e) => { f[k] = e.target.value; } }));
      const chk = (k, label) => h("label", { class: "chk" }, h("input", { type: "checkbox", checked: !!f[k], onchange: (e) => { f[k] = e.target.checked; } }), label);
      function prefill() { const o = ord(); if (o && o.price) { if (f.kind === "location" && o.operation === "rent") f.rent = f.rent || Number(o.price); if (f.kind !== "location") f.price = f.price || Number(o.price); } }
      function drawFields() {
        prefill();
        const k = f.kind, common = [inp("city", "Ville de signature"), inp("date", "Date du contrat", { type: "date" }), inp("clientId", "N° pièce d’identité du client"), inp("clientAddress", "Adresse du client"),
          inp("partyName", "Propriétaire / bailleur / vendeur (vide = l’agence)"), inp("partyRep", "Représentant (facultatif)")];
        const spec = k === "location" ? [inp("rent", "Loyer mensuel", { type: "number", inputmode: "numeric", min: 0 }), inp("charges", "Charges mensuelles", { type: "number", inputmode: "numeric", min: 0 }), inp("deposit", "Dépôt de garantie", { type: "number", inputmode: "numeric", min: 0 }),
            inp("months", "Durée (mois)", { type: "number", min: 1 }), inp("start", "Début du bail", { type: "date" }), inp("payDay", "Jour de paiement (1–28)", { type: "number", min: 1, max: 28 }), inp("notice", "Préavis (mois)", { type: "number", min: 1 })]
          : k === "vente" ? [inp("price", "Prix de vente", { type: "number", inputmode: "numeric", min: 0 }), inp("deadline", "Signature chez le notaire avant le", { type: "date" }), inp("notary", "Notaire (nom / étude)"), inp("penalty", "Indemnité si le vendeur renonce", { type: "number", min: 0 }), inp("commission", "Commission d’agence", { type: "number", min: 0 }), chk("buyerFees", "Frais de notaire à la charge de l’acquéreur")]
          : [inp("price", "Prix du bien (facultatif)", { type: "number", min: 0 }), inp("validity", "Durée de la réservation (jours)", { type: "number", min: 1 }), chk("refundable", "Acompte remboursable si dossier refusé / bien indisponible")];
        fields.replaceChildren(...spec, ...common, h("div", { style: "grid-column:1/-1" }, h("label", {}, "Clauses particulières"), h("textarea", { oninput: (e) => { f.notes = e.target.value; } }, f.notes || "")));
      }
      const kindSel = h("select", { onchange: (e) => { f.kind = e.target.value; drawFields(); } }, Object.entries(d.kinds).map(([v, l]) => h("option", { value: v }, l)));
      const orderSel = h("select", { onchange: (e) => { f.orderId = e.target.value; f.rent = f.price = ""; drawFields(); } }, d.orders.length ? d.orders.map((o) => h("option", { value: o.id }, `#${o.id} · ${o.customer_name} · ${o.property_title || "bien"}`)) : [h("option", { value: "" }, "Aucune demande acceptée")]);
      const create = h("button", { type: "button" }, "Générer le contrat");
      create.addEventListener("click", async () => {
        msg.className = "err"; msg.textContent = ""; create.disabled = true;
        try {
          const r = await api("/api/payments?a=contract_create", "POST", { orderId: f.orderId, kind: f.kind, params: f });
          msg.className = "ok"; msg.replaceChildren(`Contrat ${r.number} créé et mis à disposition du client. `, h("a", { href: "/api/payments?a=contract&id=" + r.id, download: "" }, "Télécharger le PDF")); load.later = setTimeout(load, 4000);
        } catch (x) { msg.textContent = x.message; }
        create.disabled = false;
      });
      drawFields();

      const ag = { ...d.agency }, agInp = (k, label) => h("div", {}, h("label", {}, label), h("input", { value: ag[k] || "", autocomplete: "off", disabled: !isSuper, oninput: (e) => { ag[k] = e.target.value; } }));
      const agMsg = h("p", { class: "err" }), agSave = h("button", { type: "button", disabled: !isSuper }, "Enregistrer l’agence");
      agSave.addEventListener("click", async () => { agMsg.className = "err"; agMsg.textContent = ""; try { await api("/api/payments?a=agency", "POST", ag); agMsg.className = "ok"; agMsg.textContent = "Enregistré."; } catch (x) { agMsg.textContent = x.message; } });

      box.replaceChildren(
        h("div", { class: "card" }, h("h2", {}, "Nouveau contrat"), d.orders.length ? "" : h("p", { class: "muted" }, "Acceptez d’abord une demande dans « Commandes » : le contrat s’établit à partir d’une demande acceptée."),
          h("div", { class: "grid" }, h("div", {}, h("label", {}, "Demande acceptée"), orderSel), h("div", {}, h("label", {}, "Type de contrat"), kindSel)), fields, msg, create,
          h("p", { class: "muted" }, "Modèles à valider par un juriste avant usage. Les reçus de paiement se téléchargent depuis l’onglet « Paiements ».")),
        h("div", { class: "card" }, h("h2", {}, "Contrats émis"), d.rows.length ? h("div", { style: "overflow-x:auto" }, h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, ["N°", "Type", "Client", "Bien", "Date", "Statut", ""].map((x) => h("th", {}, x)))),
          h("tbody", {}, d.rows.map((r) => h("tr", {}, h("td", {}, r.number), h("td", {}, r.label), h("td", {}, r.customer_name || ""), h("td", {}, r.property_title || ""), h("td", {}, when(r.created_at)), h("td", {}, STATUS[r.status] || r.status),
            h("td", {}, h("a", { href: "/api/payments?a=contract&id=" + r.id, download: "" }, "PDF"), isSuper && r.status === "issued" ? h("button", { class: "ghost", type: "button", onclick: async () => { if (!confirm("Annuler ce contrat ? Le client n’y aura plus accès.")) return; try { await api("/api/payments?a=contract_void", "POST", { id: r.id }); load(); } catch (x) { alert(x.message); } } }, "Annuler") : "")))))) : h("p", { class: "muted" }, "Aucun contrat pour l’instant.")),
        h("div", { class: "card" }, h("h2", {}, "Identité de l’agence (en-tête des documents)"), isSuper ? "" : h("p", { class: "muted" }, "Modifiable par le super administrateur."),
          h("div", { class: "grid" }, agInp("name", "Nom commercial"), agInp("legal", "Forme juridique / capital"), agInp("address", "Adresse"), agInp("city", "Ville"), agInp("phone", "Téléphone"), agInp("email", "E-mail"), agInp("rccm", "N° RCCM"), agInp("niu", "N° contribuable (NIU)"), agInp("rep", "Représentant légal"), agInp("repTitle", "Fonction")), agMsg, agSave));
    }
    load();
    return box;
  }
  window.AdminDocs = { view };
})();
