(function () {
  "use strict";
  const PM = { cash: "Espèces", orange_money: "Orange Money", mtn_money: "MTN Mobile Money", card: "Carte", paypal: "PayPal", bank_transfer: "Virement" };
  const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const per = (p) => MONTHS[Number(p.slice(5, 7)) - 1] + " " + p.slice(0, 4);
  const money = (a, c) => new Intl.NumberFormat("fr-FR").format(Number(a) || 0) + " " + (c === "XAF" || c === "XOF" ? "FCFA" : c || "");
  const day = (d) => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const digits = (p) => String(p || "").replace(/\D/g, "");

  // =============== Visites ===============
  function visits(ctx) {
    const { api, h } = ctx, box = h("div", {});
    let scope = "pending";
    const ST = { requested: "À traiter", confirmed: "Confirmée", declined: "Refusée", cancelled: "Annulée", done: "Effectuée" };
    async function load() {
      box.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      let d; try { d = await api("/api/orders?a=visits_admin&scope=" + scope); } catch (e) { box.replaceChildren(h("p", { class: "err" }, e.message)); return; }
      const post = (body) => async (e) => { e.currentTarget.disabled = true; try { await api("/api/orders?a=visit_set", "POST", body); load(); } catch (x) { alert(x.message); e.currentTarget.disabled = false; } };
      const ask = (id, status, msg) => async (e) => { const note = prompt(msg, ""); if (note === null) return; e.currentTarget.disabled = true; try { await api("/api/orders?a=visit_set", "POST", { id, status, adminNote: note }); load(); } catch (x) { alert(x.message); e.currentTarget.disabled = false; } };
      const card = (v) => {
        const resched = h("div", { class: "row", hidden: true }), dIn = h("input", { type: "date", min: d.today }), sSel = h("select", {}, d.slots.map((t) => h("option", { value: t }, t)));
        resched.append(dIn, sSel, h("button", { onclick: async (e) => { if (!dIn.value) return alert("Choisissez une date."); e.currentTarget.disabled = true; try { await api("/api/orders?a=visit_set", "POST", { id: v.id, date: dIn.value, time: sSel.value, adminNote: "" }); load(); } catch (x) { alert(x.message); e.currentTarget.disabled = false; } } }, "Valider le nouveau créneau"));
        const wa = digits(v.customer_phone);
        return h("div", { class: "card" + (v.status === "requested" ? " unread" : "") },
          h("div", { class: "row" }, h("strong", {}, v.property_title), h("span", { class: "pill" }, ST[v.status] || v.status)),
          h("div", {}, "📅 " + day(v.date) + " à " + v.time),
          h("div", { class: "muted" }, (v.customer_name || "?") + (v.customer_email ? " · " + v.customer_email : "")),
          h("div", { class: "row", style: "justify-content:flex-start;gap:8px" }, v.customer_phone ? h("a", { href: "tel:" + v.customer_phone }, "📞 " + v.customer_phone) : "", wa ? h("a", { href: "https://wa.me/" + wa, target: "_blank", rel: "noopener" }, "💬 WhatsApp") : ""),
          v.note ? h("div", { class: "muted" }, "« " + v.note + " »") : "", v.admin_note ? h("div", { class: "muted" }, "Note : " + v.admin_note) : "",
          ["requested", "confirmed"].includes(v.status) ? h("div", { class: "row" },
            v.status === "requested" ? h("button", { onclick: post({ id: v.id, status: "confirmed" }) }, "Confirmer") : h("button", { onclick: post({ id: v.id, status: "done" }) }, "Marquer effectuée"),
            h("button", { class: "ghost", onclick: () => { resched.hidden = !resched.hidden; } }, "Reprogrammer"),
            h("button", { class: "danger", onclick: ask(v.id, v.status === "requested" ? "declined" : "cancelled", v.status === "requested" ? "Motif du refus (visible par le client) :" : "Motif de l’annulation (visible par le client) :") }, v.status === "requested" ? "Refuser" : "Annuler")) : "",
          resched);
      };
      box.replaceChildren(
        h("div", { class: "tabs" }, [["pending", "À traiter"], ["upcoming", "À venir"], ["all", "Toutes"]].map(([k, l]) => h("button", { type: "button", class: "stab" + (k === scope ? " on" : ""), onclick: () => { scope = k; load(); } }, l))),
        ...(d.visits.length ? d.visits.map(card) : [h("div", { class: "card muted" }, scope === "pending" ? "Aucune demande de visite à traiter." : "Aucune visite.")]));
    }
    load();
    return box;
  }

  // =============== Loyers ===============
  function rents(ctx) {
    const { me, api, h, when } = ctx, isSuper = me.role === "super_admin", box = h("div", {});
    const open = new Set();
    async function load() {
      box.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      let d; try { d = await api("/api/orders?a=rent_admin"); } catch (e) { box.replaceChildren(h("p", { class: "err" }, e.message)); return; }
      const kpis = d.summary.length ? d.summary.flatMap((s) => [
        h("div", { class: "kpi" }, h("div", { class: "kpi-l" }, "Encaissé ce mois"), h("div", { class: "kpi-v" }, money(s.collected, s.currency)), h("div", { class: "kpi-s" }, "sur " + money(s.expected, s.currency) + " attendus")),
        h("div", { class: "kpi " + (s.overdue ? "hot" : "") }, h("div", { class: "kpi-l" }, "En retard"), h("div", { class: "kpi-v" }, money(s.overdue, s.currency)), h("div", { class: "kpi-s" }, s.declared + " paiement(s) à vérifier"))]) : [h("p", { class: "muted" }, "Aucun bail pour l’instant.")];
      box.replaceChildren(h("div", { class: "kpis" }, kpis),
        h("div", { class: "row" }, h("button", { onclick: () => form(d) }, "+ Nouveau bail"), isSuper ? h("a", { class: "btn ghost", href: "/api/orders?a=rent_export", download: "loyers.csv" }, "Exporter (CSV)") : ""),
        h("div", { id: "rent-form" }), ...d.leases.map((l) => leaseCard(l)));
    }
    function leaseCard(l) {
      const det = h("div", {});
      const card = h("div", { class: "card" + (l.overdue_count || l.declared_count ? " unread" : "") },
        h("div", { class: "row" }, h("strong", {}, l.property_title), h("span", { class: "pill" }, l.status === "active" ? "En cours" : "Terminé")),
        h("div", { class: "muted" }, `${l.customer_name || "?"} · ${money(Number(l.rent) + Number(l.charges), l.currency)}/mois · paiement avant le ${l.pay_day} · depuis le ${l.start_date}${l.end_date ? " jusqu’au " + l.end_date : ""}`),
        l.overdue_count ? h("div", { class: "err" }, `⚠ ${l.overdue_count} loyer(s) en retard (${money(l.overdue_amount, l.currency)})`) : "", l.declared_count ? h("div", {}, `⏳ ${l.declared_count} paiement(s) à vérifier`) : "",
        h("div", { class: "row" }, h("button", { class: "ghost", onclick: async () => { if (open.has(l.id)) { open.delete(l.id); det.replaceChildren(); } else { open.add(l.id); await charges(l, det); } } }, "Échéances"),
          l.customer_phone ? h("a", { href: "https://wa.me/" + digits(l.customer_phone), target: "_blank", rel: "noopener" }, "💬 Relancer sur WhatsApp") : "",
          l.status === "active" ? h("button", { class: "ghost", onclick: async () => { if (!confirm("Terminer ce bail ? Les loyers futurs non payés seront annulés.")) return; try { await api("/api/orders?a=rent_lease_end", "POST", { id: l.id }); load(); } catch (x) { alert(x.message); } } }, "Terminer le bail") : ""), det);
      if (open.has(l.id)) charges(l, det);
      return card;
    }
    async function charges(l, det) {
      det.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      let c; try { c = await api("/api/orders?a=rent_charges&lease=" + l.id); } catch (e) { det.replaceChildren(h("p", { class: "err" }, e.message)); return; }
      const ST = { due: "À payer", declared: "À vérifier", paid: "Payé ✓", cancelled: "Annulé" };
      det.replaceChildren(...c.charges.map((x) => {
        const method = h("select", {}, Object.entries(PM).map(([k, v]) => h("option", { value: k, selected: k === (x.method || "cash") }, v))), ref = h("input", { placeholder: "Référence (facultatif)", value: x.reference || "", maxlength: 60 });
        const act = async (a, body) => { try { await api("/api/orders?a=" + a, "POST", body); load(); } catch (e) { alert(e.message); } };
        return h("div", { class: "card" }, h("div", { class: "row" }, h("strong", {}, per(x.period) + " — " + money(x.amount, x.currency)), h("span", { class: "pill" + (x.overdue ? " bad" : "") }, x.overdue ? "En retard" : ST[x.status] || x.status)),
          h("div", { class: "muted" }, "Échéance " + x.due_date + (x.status === "declared" ? ` · déclaré : ${PM[x.method] || x.method}${x.reference ? " réf. " + x.reference : ""}${x.payer_phone ? " (" + x.payer_phone + ")" : ""}` : "") + (x.paid_at ? " · payé le " + when(x.paid_at) + (x.method ? " (" + (PM[x.method] || x.method) + ")" : "") : "")),
          ["due", "declared"].includes(x.status) ? h("div", { class: "row" }, method, ref, h("button", { onclick: () => act("rent_pay", { chargeId: x.id, method: method.value, reference: ref.value }) }, x.status === "declared" ? "Confirmer la réception" : "Marquer payé"),
            x.status === "declared" ? h("button", { class: "danger", onclick: () => { const r = prompt("Motif du refus :", "Transaction introuvable"); if (r !== null) act("rent_reject", { chargeId: x.id, reason: r }); } }, "Refuser") : "",
            isSuper && x.status === "due" ? h("button", { class: "ghost", onclick: () => { if (confirm("Annuler cette échéance ?")) act("rent_cancel_charge", { chargeId: x.id }); } }, "Annuler l’échéance") : "") : "",
          x.status === "paid" ? h("a", { href: "/api/orders?a=rent_receipt&id=" + x.id, download: "" }, "📄 Quittance (PDF)") : "");
      }));
    }
    async function form() {
      const slot = box.querySelector("#rent-form"); slot.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      let o; try { o = await api("/api/orders?a=rent_options"); } catch (e) { slot.replaceChildren(h("p", { class: "err" }, e.message)); return; }
      const f = { currency: "XAF", payDay: 5, startDate: new Date().toISOString().slice(0, 10), charges: 0, deposit: 0 }, msg = h("p", { class: "err", role: "alert" });
      const inp = (k, label, attrs = {}) => h("div", {}, h("label", {}, label), h("input", { value: f[k] ?? "", autocomplete: "off", ...attrs, oninput: (e) => { f[k] = e.target.value; } }));
      const custSel = h("select", { onchange: (e) => { f.customerId = e.target.value; } }, h("option", { value: "" }, "Choisir le locataire…"), o.customers.map((c) => h("option", { value: c.id }, `${c.name} — ${c.email}`)));
      const propSel = h("select", { onchange: (e) => { f.propertyId = e.target.value; const p = o.properties.find((x) => x.id === e.target.value); if (p && p.operation !== "sale" && p.price && !f.rent) { f.rent = Number(p.price); f.currency = p.currency || "XAF"; slot.querySelector('[data-k="rent"]').value = f.rent; } } },
        h("option", { value: "" }, "Bien du catalogue (facultatif)…"), o.properties.map((p) => h("option", { value: p.id }, p.title)));
      const save = h("button", { type: "button" }, "Créer le bail et l’échéancier");
      save.addEventListener("click", async () => { msg.textContent = ""; save.disabled = true; try { await api("/api/orders?a=rent_lease_create", "POST", f); load(); } catch (x) { msg.textContent = x.message; save.disabled = false; } });
      const rentInp = inp("rent", "Loyer mensuel", { type: "number", min: 0, inputmode: "numeric", "data-k": "rent" });
      slot.replaceChildren(h("div", { class: "card" }, h("h2", {}, "Nouveau bail"),
        h("div", { class: "grid" }, h("div", {}, h("label", {}, "Locataire"), custSel), h("div", {}, h("label", {}, "Bien"), propSel), inp("propertyTitle", "…ou intitulé du bien"), rentInp, inp("charges", "Charges mensuelles", { type: "number", min: 0 }), inp("currency", "Devise", { maxlength: 3 }),
          inp("payDay", "Jour de paiement (1–28)", { type: "number", min: 1, max: 28 }), inp("startDate", "Début du bail", { type: "date" }), inp("endDate", "Fin du bail (facultatif)", { type: "date" }), inp("deposit", "Dépôt de garantie", { type: "number", min: 0 })),
        msg, save, h("p", { class: "muted" }, "12 mois d’échéances sont créés, puis le système en ajoute chaque mois. Rappels WhatsApp/notification : 3 jours avant, le jour J, puis tous les 3 jours de retard.")));
    }
    load();
    return box;
  }
  window.AdminOps = { visits, rents };
})();
