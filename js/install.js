(function () {
  "use strict";
  // Enregistre le service worker et propose d'installer l'application, avec le bon mode d'emploi selon l'appareil.
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
  }
  const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  if (standalone) return;

  const ua = navigator.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const device = ios ? (/iPad/.test(ua) || navigator.platform === "MacIntel" ? "iPad" : "iPhone") : android ? "téléphone Android" : "ordinateur";
  const KEY = "maison-install-dismissed";
  const recentlyDismissed = () => { try { return Date.now() - Number(localStorage.getItem(KEY) || 0) < 14 * 864e5; } catch (e) { return false; } };
  const remember = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* ignore */ } };
  let deferred = null, banner = null;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
    kids.forEach((c) => n.append(c));
    return n;
  }
  function hide() { if (banner) { banner.remove(); banner = null; } }

  function show() {
    if (banner || recentlyDismissed()) return;
    const style = el("style", {});
    style.textContent = ".inst{position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);z-index:60;max-width:440px;margin:0 auto;display:grid;grid-template-columns:auto 1fr;gap:6px 12px;align-items:center;padding:14px;border-radius:16px;background:#fff;color:#14201d;box-shadow:0 10px 40px rgba(15,31,38,.25);border:1px solid #e1e8e5;font:14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif}" +
      ".inst img{width:44px;height:44px;border-radius:11px}.inst strong{display:block;font-size:15px}.inst span{color:#64736d}" +
      ".inst-btns{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;margin-top:4px}" +
      ".inst button{padding:9px 16px;border-radius:10px;border:1px solid #e1e8e5;background:transparent;color:#14201d;font:inherit;font-weight:600;cursor:pointer}" +
      ".inst button.go{background:#16766e;border-color:#16766e;color:#fff}.inst b{color:#16766e}";
    const close = el("button", { type: "button", onclick: () => { remember(); hide(); } }, ios ? "Compris" : "Plus tard");
    const btns = el("div", { class: "inst-btns" }, close);
    let text;
    if (ios) {
      text = el("span", {}, "Touchez ", el("b", {}, "Partager"), " puis ", el("b", {}, "« Sur l’écran d’accueil »"), " pour l’ajouter à votre " + device + ".");
    } else {
      text = el("span", {}, "Accédez plus vite à vos annonces et à votre espace depuis votre " + device + ".");
      btns.append(el("button", { type: "button", class: "go", onclick: async () => {
        if (!deferred) return;
        deferred.prompt();
        try { await deferred.userChoice; } catch (e) { /* ignore */ }
        deferred = null; hide();
      } }, "Installer"));
    }
    banner = el("div", { class: "inst", role: "region", "aria-label": "Installer l’application" }, style,
      el("img", { src: "/assets/icons/icon-192.png", alt: "", width: "44", height: "44" }), el("div", {}, el("strong", {}, "Installer Gestion Immobilière"), text), btns);
    document.body.append(banner);
    // Au-dessus de la barre de navigation mobile de l'espace client, s'il y en a une
    const tab = document.querySelector(".tabbar");
    if (tab && getComputedStyle(tab).display !== "none") banner.style.bottom = "calc(env(safe-area-inset-bottom,0px) + " + (tab.offsetHeight + 12) + "px)";
  }

  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; setTimeout(show, 3000); });
  window.addEventListener("appinstalled", () => { deferred = null; remember(); hide(); });
  if (ios) window.addEventListener("load", () => setTimeout(show, 4000));
})();
