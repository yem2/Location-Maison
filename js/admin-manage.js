(function () {
  "use strict";
  const PM = { cash: "Espèces", orange_money: "Orange Money", mtn_money: "MTN Mobile Money", bank_transfer: "Virement", paypal: "PayPal", card: "Carte" };
  const money = (a, c) => new Intl.NumberFormat("fr-FR").format(Number(a) || 0) + " " + (c === "XAF" || c === "XOF" ? "FCFA" : c || "");
  const digits = (p) => String(p || "").replace(/\D/g, "");
  const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

  // =============== Incidents ===============
  function tickets(ctx) {
    const { api, h, when } = ctx, box = h("div", {});
    let scope = "open";
    const CAT = { plomberie: "Plomberie", electricite: "Électricité", serrure: "Serrure / porte", humidite: "Humidité", toiture: "Toiture", internet: "Internet", autre: "Autre" };
    const ST = { open: "Ouvert", in_progress: "En cours", resolved: "Résolu", closed: "Clos" };
    async function load() {
      box.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      let d; try { d = await api("/api/orders?a=ticket_admin&scope=" + scope); } catch (e) { box.replaceChildren(h("p", { class: "err" }, e.message)); return; }
      const card = (t) => {
        const sel = h("select", {}, Object.entries(ST).map(([k, v]) => h("option", { value: k, selected: k === t.status }, v))), note = h("input", { value: t.admin_note || "", maxlength: 400, placeholder: "Message au locataire (facultatif)" });
        const wa = digits(t.customer_phone);
        return h("div", { class: "card" + (t.priority === "urgent" && ["open", "in_progress"].includes(t.status) ? " unread" : "") },
          h("div", { class: "row" }, h("strong", {}, (t.priority === "urgent" ? "🚨 " : "") + t.title), h("span", { class: "pill" }, ST[t.status])),
          h("div", { class: "muted" }, `${CAT[t.category] || t.category} · ${t.property_title || "logement"} · ${t.customer_name || "?"} · ${when(t.created_at)}`),
          h("div", { style: "white-space:pre-wrap" }, t.description),
          t.photo ? h("a", { href: t.photo, target: "_blank", rel: "noopener" }, h("img", { src: t.photo, alt: "Photo de l’incident", style: "max-width:160px;border-radius:10px;display:block;margin:6px 0" })) : "",
          h("div", { class: "row", style: "justify-content:flex-start;gap:10px" }, t.customer_phone ? h("a", { href: "tel:" + t.customer_phone }, "📞 Appeler") : "", wa ? h("a", { href: "https://wa.me/" + wa, target: "_blank", rel: "noopener" }, "💬 WhatsApp") : ""),
          h("div", { class: "row" }, sel, note, h("button", { onclick: async (e) => { e.currentTarget.disabled = true; try { await api("/api/orders?a=ticket_set", "POST", { id: t.id, status: sel.value, adminNote: note.value }); load(); } catch (x) { alert(x.message); e.currentTarget.disabled = false; } } }, "Enregistrer")));
      };
      box.replaceChildren(h("div", { class: "tabs" }, [["open", "À traiter"], ["all", "Tous"]].map(([k, l]) => h("button", { type: "button", class: "stab" + (k === scope ? " on" : ""), onclick: () => { scope = k; load(); } }, l))),
        ...(d.tickets.length ? d.tickets.map(card) : [h("div", { class: "card muted" }, "Aucun incident.")]));
    }
    load();
    return box;
  }

  // =============== Propriétaires et relevés (super administrateur) ===============
  function owners(ctx) {
    const { me, api, h, when } = ctx, box = h("div", {});
    if (me.role !== "super_admin") { box.append(h("div", { class: "card" }, "Réservé au super administrateur.")); return box; }
    let period = new Date().toISOString().slice(0, 7), current = null;
    async function load() {
      box.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      let d; try { d = await api("/api/orders?a=owner_list"); } catch (e) { box.replaceChildren(h("p", { class: "err" }, e.message)); return; }
      const post = async (a, body) => { try { await api("/api/orders?a=" + a, "POST", body); return true; } catch (x) { alert(x.message); return false; } };
      const f = { name: "", phone: "", email: "", commissionPct: 10, notes: "" }, msg = h("p", { class: "err" });
      const inp = (k, label, attrs = {}) => h("div", {}, h("label", {}, label), h("input", { value: f[k], autocomplete: "off", ...attrs, oninput: (e) => { f[k] = e.target.value; } }));
      const form = h("div", { class: "card" }, h("h2", {}, "Nouveau propriétaire"), h("div", { class: "grid" }, inp("name", "Nom"), inp("phone", "Téléphone", { inputmode: "tel" }), inp("email", "E-mail", { inputmode: "email" }), inp("commissionPct", "Commission de l’agence (%)", { type: "number", min: 0, max: 50 }), inp("notes", "Notes")), msg,
        h("button", { onclick: async (e) => { msg.textContent = ""; e.currentTarget.disabled = true; try { await api("/api/orders?a=owner_save", "POST", f); load(); } catch (x) { msg.textContent = x.message; e.currentTarget.disabled = false; } } }, "Ajouter"));
      const ownerSel = (val) => h("select", {}, h("option", { value: "" }, "— aucun —"), d.owners.map((o) => h("option", { value: o.id, selected: String(o.id) === String(val) }, o.name)));
      const assign = h("div", { class: "card" }, h("h2", {}, "Affecter les biens"), d.properties.length ? d.properties.map((p) => { const s = ownerSel(p.owner_id); return h("div", { class: "row" }, h("span", {}, p.title), h("span", { class: "row" }, s, h("button", { class: "ghost", onclick: async () => { if (await post("owner_assign", { propertyId: p.id, ownerId: s.value || null })) load(); } }, "Enregistrer"))); }) : h("p", { class: "muted" }, "Aucune annonce."));
      const list = d.owners.map((o) => h("div", { class: "card" }, h("div", { class: "row" }, h("strong", {}, o.name), h("span", { class: "pill" }, `${o.commission_pct} % · ${o.props} bien(s)`)), h("div", { class: "muted" }, [o.phone, o.email, o.notes].filter(Boolean).join(" · ")),
        h("div", { class: "row" }, h("button", { onclick: () => { current = o.id; load(); } }, "Relevé mensuel"), h("button", { class: "ghost", onclick: async () => { const p = prompt("Commission (%)", o.commission_pct); if (p !== null && await post("owner_save", { id: o.id, name: o.name, phone: o.phone, email: o.email, notes: o.notes, commissionPct: p })) load(); } }, "Changer la commission"),
          h("button", { class: "danger", onclick: async () => { if (confirm("Supprimer ce propriétaire ?") && await post("owner_delete", { id: o.id })) load(); } }, "Supprimer"))));
      const stmt = h("div", {});
      box.replaceChildren(...(list.length ? list : [h("div", { class: "card muted" }, "Aucun propriétaire pour l’instant.")]), form, assign, stmt);
      if (current) statement(stmt, d.owners.find((o) => o.id === current));
    }
    async function statement(slot, o) {
      if (!o) return;
      const pIn = h("input", { type: "month", value: period, onchange: (e) => { period = e.target.value; statement(slot, o); } });
      slot.replaceChildren(h("div", { class: "card" }, h("h2", {}, "Relevé de " + o.name), h("div", { class: "row" }, pIn, h("button", { class: "ghost", onclick: () => { current = null; load(); } }, "Fermer")), h("p", { class: "muted" }, "Chargement…")));
      let d; try { d = await api(`/api/orders?a=owner_statement&owner=${o.id}&period=${period}`); } catch (e) { slot.append(h("p", { class: "err" }, e.message)); return; }
      const body = d.groups.length ? d.groups.map((g) => {
        const method = h("select", {}, Object.entries(PM).map(([k, v]) => h("option", { value: k }, v))), ref = h("input", { placeholder: "Référence", maxlength: 60 });
        return h("div", { class: "card" }, h("div", { class: "row" }, h("strong", {}, `Net à reverser : ${money(g.net, g.currency)}`), g.payout ? h("span", { class: "pill" }, "Reversé le " + when(g.payout.paid_at)) : h("span", { class: "pill bad" }, "À reverser")),
          h("div", { class: "muted" }, `Encaissé ${money(g.gross, g.currency)} − commission ${money(g.commission, g.currency)} (${g.pct} %) · ${g.lines.length} loyer(s)`),
          h("div", { style: "overflow-x:auto" }, h("table", { class: "x-tbl" }, h("thead", {}, h("tr", {}, ["Payé le", "Locataire", "Bien", "Montant"].map((x) => h("th", {}, x)))), h("tbody", {}, g.lines.map((l) => h("tr", {}, h("td", {}, when(l.paid_at)), h("td", {}, l.customer || ""), h("td", {}, l.property_title || ""), h("td", {}, money(l.amount, g.currency))))))),
          h("div", { class: "row" }, h("a", { class: "btn ghost", href: `/api/orders?a=owner_statement_pdf&owner=${o.id}&period=${period}&currency=${g.currency}`, download: "" }, "📄 Relevé PDF"),
            g.payout ? "" : h("span", { class: "row" }, method, ref, h("button", { onclick: async () => { if (!confirm(`Marquer ${money(g.net, g.currency)} comme reversé à ${o.name} ?`)) return; try { await api("/api/orders?a=owner_payout", "POST", { ownerId: o.id, period, currency: g.currency, method: method.value, reference: ref.value }); statement(slot, o); } catch (x) { alert(x.message); } } }, "Marquer reversé"))));
      }) : [h("p", { class: "muted" }, "Aucun loyer encaissé pour ce mois (sur les biens de ce propriétaire).")];
      slot.replaceChildren(h("div", { class: "card" }, h("h2", {}, "Relevé de " + o.name), h("div", { class: "row" }, pIn, h("button", { class: "ghost", onclick: () => { current = null; load(); } }, "Fermer"))), ...body);
    }
    load();
    return box;
  }

  // =============== Statistiques ===============
  function stats(ctx) {
    const { me, api, h } = ctx, box = h("div", {});
    let currency = "XAF";
    async function load() {
      box.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      let d; try { d = await api("/api/orders?a=stats_overview&currency=" + currency); } catch (e) { box.replaceChildren(h("p", { class: "err" }, e.message)); return; }
      const s = d.snapshot || {}, kpi = (l, v, sub, hot) => h("div", { class: "kpi " + (hot ? "hot" : "") }, h("div", { class: "kpi-l" }, l), h("div", { class: "kpi-v" }, String(v)), sub ? h("div", { class: "kpi-s" }, sub) : "");
      const chart = (title, series, keys) => {
        const max = Math.max(1, ...d.series.flatMap((m) => keys.map((k) => Number(m[k.k]) || 0)));
        return h("div", { class: "card" }, h("h2", {}, title), h("div", { class: "x-bars", style: "height:140px;gap:6px" }, d.series.map((m) => h("div", { style: "flex:1;display:flex;align-items:flex-end;gap:2px;height:100%", title: m.p + " — " + keys.map((k) => k.l + " : " + (k.money ? money(m[k.k], currency) : m[k.k])).join(" · ") },
          keys.map((k, i) => h("div", { style: `flex:1;height:${Math.max(3, Math.round(((Number(m[k.k]) || 0) / max) * 100))}%;background:${i ? "var(--acc2, #8b8ff7)" : "var(--acc)"};border-radius:3px 3px 0 0` }))))),
          h("div", { class: "row", style: "justify-content:space-between;gap:0" }, d.series.map((m) => h("small", { class: "muted", style: "flex:1;text-align:center;font-size:.62rem" }, MONTHS[Number(m.p.slice(5, 7)) - 1]))),
          h("div", { class: "muted" }, keys.map((k, i) => (i ? "■ " : "■ ") + k.l).join("   ")));
      };
      const cur = h("select", { onchange: (e) => { currency = e.target.value; load(); } }, (d.currencies.length ? d.currencies : ["XAF"]).map((c) => h("option", { value: c, selected: c === d.currency }, c)));
      box.replaceChildren(
        h("div", { class: "row" }, h("h2", {}, "Vue d’ensemble"), h("span", { class: "row" }, h("label", {}, "Devise"), cur, me.role === "super_admin" ? h("a", { class: "btn ghost", href: "/api/orders?a=stats_export", download: "statistiques.csv" }, "Exporter (CSV)") : "")),
        h("div", { class: "kpis" }, kpi("Annonces publiées", s.properties ?? 0), kpi("Clients inscrits", s.customers ?? 0), kpi("Demandes en attente", s.pending_requests ?? 0, "", s.pending_requests > 0), kpi("Visites à traiter", s.pending_visits ?? 0, "", s.pending_visits > 0),
          kpi("Baux en cours", s.active_leases ?? 0), kpi("Incidents ouverts", s.open_tickets ?? 0, "", s.open_tickets > 0), kpi("Loyers en retard", money(s.overdue ?? 0, d.currency), "", s.overdue > 0), kpi("Contrats émis", s.contracts ?? 0)),
        chart("Demandes et visites — 12 derniers mois", d.series, [{ k: "requests", l: "Demandes" }, { k: "visits", l: "Visites" }]),
        chart(`Encaissements (${d.currency}) — acomptes et loyers`, d.series, [{ k: "deposits", l: "Acomptes", money: true }, { k: "rent", l: "Loyers", money: true }]),
        chart("Nouveaux clients", d.series, [{ k: "customers", l: "Inscriptions" }]),
        h("div", { class: "card" }, h("h2", {}, "Biens les plus demandés"), d.top.length ? h("div", { style: "overflow-x:auto" }, h("table", { class: "x-tbl" }, h("thead", {}, h("tr", {}, ["Bien", "Demandes", "Visites"].map((x) => h("th", {}, x)))), h("tbody", {}, d.top.map((t) => h("tr", {}, h("td", {}, t.title || "—"), h("td", {}, String(t.requests)), h("td", {}, String(t.visits))))))) : h("p", { class: "muted" }, "Pas encore de données.")));
    }
    load();
    return box;
  }
  window.AdminManage = { tickets, owners, stats };
})();
