(function () {
  "use strict";
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
  async function api(path, method = "GET", body) {
    const r = await fetch(path, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Erreur " + r.status);
    return data;
  }
  const when = (d) => (d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const bytes = (n) => (n > 1e9 ? (n / 1e9).toFixed(2) + " Go" : n > 1e6 ? (n / 1e6).toFixed(1) + " Mo" : Math.round(n / 1e3) + " Ko");
  const pill = (ok, yes, no) => h("span", { class: "x-pill " + (ok ? "ok" : "bad") }, ok ? yes : no);
  const errBox = (e) => h("div", { class: "card" }, h("p", { class: "x-err" }, e.message), h("p", { class: "muted" }, "Si les tables n’existent pas encore, exécutez migration-v3.sql dans Neon."));
  const kpi = (label, value, sub) => h("div", { class: "card x-kpi" }, h("span", { class: "muted" }, label), h("strong", {}, String(value)), sub ? h("small", { class: "muted" }, sub) : "");
  function table(cols, rows) {
    if (!rows.length) return h("p", { class: "muted" }, "Aucune donnée.");
    return h("div", { class: "x-scroll" }, h("table", { class: "x-tbl" }, h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c[0])))),
      h("tbody", {}, rows.map((r) => h("tr", {}, cols.map((c) => h("td", {}, c[1](r))))))));
  }

  // =============== Support : boîte de réception des clients ===============
  async function supportView() {
    const box = h("div", {});
    let current = null;
    async function list() {
      let rows;
      try { rows = await api("/api/chat?a=admin_threads"); } catch (e) { box.replaceChildren(errBox(e)); return; }
      box.replaceChildren(h("div", { class: "row" }, h("h2", {}, "Support client"), h("button", { class: "ghost", type: "button", onclick: list }, "Actualiser")),
        rows.length ? rows.map((t) => h("div", { class: "card row x-click", onclick: () => open(t) },
          h("div", {}, h("strong", {}, t.a_name + (t.kind === "direct" ? " ↔ " + (t.b_name || "?") : "")), t.unread ? h("span", { class: "x-pill bad" }, t.unread + " nouveau(x)") : "", h("br"),
            h("span", { class: "muted" }, t.kind === "direct" ? "Conversation privée (lecture seule)" : t.a_email), h("br"), h("span", { class: "muted" }, (t.last_body || "").slice(0, 100))),
          h("span", { class: "muted" }, when(t.last_message_at)))) : h("div", { class: "card muted" }, "Aucune conversation pour le moment."));
    }
    async function open(t) {
      current = t;
      const msgs = h("div", { class: "x-msgs" }), input = h("textarea", { rows: 2, maxlength: 2000, placeholder: "Votre réponse…" }), err = h("p", { class: "x-err" });
      const readonly = t.kind === "direct";
      const load = async () => {
        try {
          const rows = await api("/api/chat?a=admin_messages&thread=" + t.id);
          msgs.replaceChildren(...rows.map((m) => h("div", { class: "x-msg" + (m.mine ? " mine" : "") }, h("small", {}, m.who + " · " + when(m.created_at)), h("div", {}, m.body))));
          msgs.scrollTop = msgs.scrollHeight;
        } catch (e) { err.textContent = e.message; }
      };
      const send = h("button", { type: "button", onclick: async (e) => {
        if (!input.value.trim()) return; e.currentTarget.disabled = true; err.textContent = "";
        try { await api("/api/chat?a=admin_send", "POST", { thread: t.id, body: input.value }); input.value = ""; await load(); } catch (x) { err.textContent = x.message; }
        e.currentTarget.disabled = false;
      } }, "Envoyer");
      box.replaceChildren(h("div", { class: "row" }, h("button", { class: "ghost", type: "button", onclick: list }, "← Retour"), h("strong", {}, t.a_name + (readonly ? " ↔ " + (t.b_name || "?") : "")), h("button", { class: "ghost", type: "button", onclick: load }, "Actualiser")),
        h("div", { class: "card" }, msgs, readonly ? h("p", { class: "muted" }, "Les conversations privées entre clients sont en lecture seule.") : h("div", {}, input, h("div", { class: "row" }, err, send))));
      await load();
    }
    await list();
    return box;
  }

  // =============== Supervision (super administrateur) ===============
  const SUB = [["overview", "Vue d’ensemble"], ["db", "Base de données"], ["server", "Serveur"], ["app", "Application & API"], ["sec", "Sécurité & attaques"], ["code", "Code source"]];
  let sub = "overview", evKind = "error";

  async function supervisionView() {
    const body = h("div", {}), nav = h("div", { class: "tabs" });
    const draw = async () => {
      nav.replaceChildren(...SUB.map(([id, label]) => h("button", { class: id === sub ? "on" : "ghost", type: "button", onclick: () => { sub = id; draw(); } }, label)));
      body.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      try { body.replaceChildren(await PANES[sub](draw)); } catch (e) { body.replaceChildren(errBox(e)); }
    };
    await draw();
    return h("div", {}, nav, body);
  }

  const PANES = {
    async overview() {
      const d = await api("/api/monitor?a=overview");
      const total = d.daily.reduce((s, x) => s + x.n, 0), max = Math.max(1, ...d.daily.map((x) => x.n));
      return h("div", {},
        h("div", { class: "x-kpis" }, kpi("Appels API (14 j)", total), kpi("Erreurs serveur (24 h)", d.events24.error || 0, "bugs 500"), kpi("Sécurité (24 h)", d.events24.security || 0, "401 / 403 / 429"),
          kpi("Bugs navigateur (24 h)", d.events24.client || 0), kpi("En ligne depuis", Math.round(d.uptimeSec / 60) + " min", "instance courante")),
        h("div", { class: "card" }, h("h2", {}, "Trafic sur 14 jours"), h("div", { class: "x-bars" }, d.daily.map((x) => h("div", { title: x.day + " : " + x.n + " appels, " + x.errors + " erreurs", style: "height:" + Math.max(3, Math.round((x.n / max) * 100)) + "%" }))),
          d.daily.length ? h("small", { class: "muted" }, d.daily[0].day + " → " + d.daily[d.daily.length - 1].day) : h("small", { class: "muted" }, "Pas encore de trafic enregistré.")),
        h("div", { class: "card" }, h("h2", {}, "Contrôles quotidiens"), table([["Contrôle", (r) => r.name], ["État", (r) => pill(r.ok, "OK", "Alerte")], ["Détail", (r) => r.detail], ["Date", (r) => when(r.at)]], d.checks),
          d.checks.length ? "" : h("p", { class: "muted" }, "Le premier contrôle automatique aura lieu à 5 h (UTC).")),
        h("div", { class: "card" }, h("h2", {}, "Adresses IP les plus actives (24 h)"), table([["IP", (r) => r.ip], ["Événements", (r) => r.n], ["Échecs de connexion", (r) => r.fails], ["Dernier", (r) => when(r.last)]], d.ips)));
    },
    async db() {
      const d = await api("/api/monitor?a=db"), s = d.stats || {};
      const ratio = Number(s.blks_hit) + Number(s.blks_read) ? Math.round((Number(s.blks_hit) / (Number(s.blks_hit) + Number(s.blks_read))) * 1000) / 10 : 100;
      return h("div", {},
        h("div", { class: "x-kpis" }, kpi("Latence", d.latency + " ms"), kpi("Taille", bytes(d.size)), kpi("Cache", ratio + " %", "lectures en mémoire"), kpi("Blocages", Number(s.deadlocks || 0), "deadlocks"), kpi("Version", String(d.version).split(" ")[0])),
        h("div", { class: "card" }, h("h2", {}, "Connexions"), table([["État", (r) => r.state], ["Nombre", (r) => r.n]], d.conns)),
        h("div", { class: "card" }, h("h2", {}, "Tables"), table([["Table", (r) => r.relname], ["Lignes", (r) => r.rows], ["Mortes", (r) => r.dead], ["Taille", (r) => bytes(Number(r.size))]], d.tables)),
        h("div", { class: "card" }, h("h2", {}, "Requêtes en cours"), table([["Durée (s)", (r) => Math.round(r.secs * 10) / 10], ["État", (r) => r.state], ["Requête", (r) => r.q]], d.running)),
        h("div", { class: "card" }, h("h2", {}, "Requêtes les plus lentes"), table([["Requête", (r) => r.q], ["Appels", (r) => r.calls], ["Moy. (ms)", (r) => r.mean_ms]], d.slow || [])));
    },
    async server() {
      const d = await api("/api/monitor?a=server"), r = d.runtime || {};
      return h("div", {},
        h("div", { class: "x-kpis" }, kpi("Node", r.node), kpi("Région", r.region), kpi("Environnement", r.env), kpi("Version déployée", r.commit || "—", r.message || ""), kpi("Mémoire", (r.memMb ?? "—") + " Mo")),
        h("div", { class: "card" }, h("h2", {}, "Configuration (secrets)"), table([["Élément", (x) => x.label], ["État", (x) => pill(x.set, "Configuré", "Absent")]], d.config)),
        h("div", { class: "card" }, h("h2", {}, "Disponibilité du site"), table([["Page", (x) => x.path], ["Code", (x) => pill(x.status >= 200 && x.status < 400, String(x.status), String(x.status || "Erreur"))], ["Temps (ms)", (x) => x.ms],
          ["En-têtes de sécurité", (x) => (x.headers ? Object.entries(x.headers).map(([k, v]) => (v ? "✓ " : "✗ ") + k).join("  ") : "")]], d.probes)),
        h("div", { class: "card" }, h("h2", {}, "Déploiements Vercel"), !d.deployments.configured ? h("p", { class: "muted" }, "Ajoutez SUPERVISION_VERCEL_TOKEN dans Vercel pour afficher l’historique.")
          : d.deployments.error ? h("p", { class: "x-err" }, d.deployments.error) : table([["État", (x) => x.state], ["Cible", (x) => x.target], ["Date", (x) => when(x.created)], ["Commit", (x) => (x.sha || "") + " " + (x.commit || "")]], d.deployments.list || [])));
    },
    async app(redraw) { return events(["error", "contract", "validation", "slow", "client"], redraw, { error: "Bugs serveur (500)", contract: "API incohérentes (404/405)", validation: "Requêtes invalides (400)", slow: "Lenteurs", client: "Bugs navigateur" }); },
    async sec(redraw) {
      const [ov, ev] = await Promise.all([api("/api/monitor?a=overview"), api("/api/monitor?a=events&kind=security")]);
      return h("div", {}, h("div", { class: "card" }, h("h2", {}, "Par adresse IP (24 h)"), table([["IP", (r) => r.ip], ["Événements", (r) => r.n], ["Échecs de connexion", (r) => r.fails], ["Dernier", (r) => when(r.last)]], ov.ips)),
        h("div", { class: "card" }, h("h2", {}, "Derniers événements de sécurité"), evTable(ev)));
    },
    async code(redraw) {
      const d = await api("/api/monitor?a=code");
      if (!d.readable) return h("div", { class: "card" }, h("p", {}, "Le code déployé n’est pas lisible par le serveur : l’analyse est indisponible sur cet hébergement."));
      const ig = d.integrity, changed = [...ig.modified, ...ig.added, ...ig.removed], deps = h("div", {});
      return h("div", {},
        h("div", { class: "x-kpis" }, kpi("Fichiers analysés", d.count), kpi("Taille", bytes(d.bytes)), kpi("Version de référence", ig.baselineSet ? when(ig.approvedAt) : "Aucune"), kpi("Écarts", ig.baselineSet ? changed.length : "—")),
        h("div", { class: "card" }, h("h2", {}, "Intégrité du code"),
          !ig.baselineSet ? h("p", { class: "muted" }, "Aucune version de référence. Après avoir vérifié votre déploiement, approuvez-le : toute modification ultérieure sera signalée.")
            : changed.length ? h("div", {}, h("p", { class: "x-err" }, changed.length + " fichier(s) différent(s) de la version approuvée :"), h("ul", {}, changed.slice(0, 40).map((f) => h("li", {}, f))), h("p", { class: "muted" }, "Si ce sont vos changements, vérifiez-les puis réapprouvez. Sinon : changez vos accès GitHub et Vercel."))
              : h("p", {}, pill(true, "Code identique à la version approuvée", "")), 
          h("button", { type: "button", onclick: async (e) => { if (!confirm("Approuver la version actuellement déployée comme référence ?")) return; e.currentTarget.disabled = true; try { await api("/api/monitor?a=approve", "POST", {}); redraw(); } catch (x) { alert(x.message); e.currentTarget.disabled = false; } } }, "Approuver la version actuelle")),
        h("div", { class: "card" }, h("h2", {}, "Analyse de sécurité"), table([["Gravité", (r) => h("span", { class: "x-pill " + (["critique", "haute"].includes(r.sev) ? "bad" : "ok") }, r.sev)], ["Fichier", (r) => r.file + (r.line ? ":" + r.line : "")], ["Problème", (r) => r.rule], ["Conseil", (r) => r.fix]], d.findings)),
        h("div", { class: "card" }, h("h2", {}, "Dépendances"), h("button", { class: "ghost", type: "button", onclick: async (e) => {
          e.currentTarget.disabled = true; deps.replaceChildren(h("p", { class: "muted" }, "Vérification auprès de la base OSV…"));
          try { const rows = await api("/api/monitor?a=deps"); deps.replaceChildren(table([["Paquet", (r) => r.name + "@" + r.version], ["Où", (r) => r.where], ["Résultat", (r) => (!r.checked ? "Non vérifié" : r.vulns.length ? r.vulns.map((v) => v.id).join(", ") : pill(true, "Aucune faille connue", ""))]], rows)); }
          catch (x) { deps.replaceChildren(h("p", { class: "x-err" }, x.message)); }
          e.currentTarget.disabled = false;
        } }, "Lancer la vérification"), deps));
    }
  };

  const evTable = (rows) => table([["Date", (r) => when(r.at)], ["API", (r) => r.api + (r.action ? "?a=" + r.action : "")], ["Méthode", (r) => r.method], ["Code", (r) => r.status ?? ""], ["Durée", (r) => (r.ms != null ? r.ms + " ms" : "")], ["IP", (r) => r.ip], ["Détail", (r) => r.detail]], rows);
  async function events(kinds, redraw, labels) {
    if (!kinds.includes(evKind)) evKind = kinds[0];
    const rows = await api("/api/monitor?a=events&kind=" + evKind);
    return h("div", {}, h("div", { class: "tabs" }, kinds.map((k) => h("button", { type: "button", class: k === evKind ? "on" : "ghost", onclick: () => { evKind = k; redraw(); } }, labels[k]))),
      h("div", { class: "card" }, evTable(rows)));
  }

  window.AdminExtra = { supportView, supervisionView };
})();
