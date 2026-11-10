(function () {
  // Signale à l'administrateur les erreurs JavaScript rencontrées par les visiteurs (aucune donnée personnelle).
  var sent = 0;
  function report(p) {
    if (sent++ >= 5) return;
    try { fetch("/api/monitor?a=client_error", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p), keepalive: true }); } catch (e) {}
  }
  window.addEventListener("error", function (e) {
    report({ message: String(e.message || "").slice(0, 250), source: String(e.filename || "").slice(0, 120), line: e.lineno, page: location.pathname });
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason; report({ message: "Promesse rejetée : " + String((r && r.message) || r || "").slice(0, 220), page: location.pathname });
  });
})();
