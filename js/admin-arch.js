(function () {
  "use strict";
  const KINDS = { property: "Annonces", customer: "Clients", order: "Demandes", message: "Messages", admin: "Administrateurs" };
  function view(ctx) {
    const { api, h, when } = ctx, box = h("div", {});
    let kind = "";
    async function load() {
      box.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      let d; try { d = await api("/api/console?a=archives"); } catch (e) { box.replaceChildren(h("p", { class: "err" }, e.message)); return; }
      const rows = [...d.properties.map((p) => ({ kind: "property", id: p.id, label: p.title, at: p.archived_at, by: "" })), ...d.items.map((i) => ({ kind: i.kind, id: i.id, label: i.label, at: i.deleted_at, by: i.by_name }))]
        .filter((r) => !kind || r.kind === kind).sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
      const act = (r, a, msg) => async (e) => {
        if (!confirm(msg)) return; e.currentTarget.disabled = true;
        try { await api("/api/console?a=" + a, "POST", { kind: r.kind, id: String(r.id) }); load(); } catch (x) { alert(x.message); e.currentTarget.disabled = false; }
      };
      box.replaceChildren(
        h("p", { class: "muted" }, "Tout ce que vous supprimez arrive ici. Vous pouvez le restaurer ; la suppression définitive est irréversible."),
        h("div", { class: "tabs" }, [["", "Tout"], ...Object.entries(KINDS)].map(([k, l]) => h("button", { type: "button", class: "stab" + (k === kind ? " on" : ""), onclick: () => { kind = k; load(); } }, l))),
        rows.length ? rows.map((r) => h("div", { class: "card" }, h("div", { class: "row" }, h("strong", {}, r.label || "(sans titre)"), h("span", { class: "pill" }, KINDS[r.kind] || r.kind)),
          h("div", { class: "muted" }, "Archivé le " + when(r.at) + (r.by ? " par " + r.by : "")),
          h("div", { class: "row" },
            h("button", { onclick: act(r, "restore", "Restaurer « " + (r.label || "cet élément") + " » ?") }, "Restaurer"),
            h("button", { class: "danger", onclick: act(r, "purge", "Supprimer DÉFINITIVEMENT « " + (r.label || "cet élément") + " » ? Impossible à annuler.") }, "Supprimer définitivement"))))
          : h("div", { class: "card muted" }, "Aucun élément archivé."));
    }
    load();
    return box;
  }
  window.AdminArch = { view };
})();
