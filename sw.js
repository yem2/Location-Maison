// Service worker de Maison : installation de l'application + page hors ligne.
// Les appels /api, l'espace client (/compte) et l'administration ne sont jamais mis en cache.
const VERSION = "maison-v1";
const SHELL = ["/offline.html", "/assets/favicon.svg", "/assets/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req) {
  try {
    const r = await fetch(req);
    if (r && r.ok) { const c = await caches.open(VERSION); c.put(req, r.clone()); }
    return r;
  } catch (e) {
    const hit = await caches.match(req);
    if (hit) return hit;
    throw e;
  }
}
async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r && r.ok) { const c = await caches.open(VERSION); c.put(req, r.clone()); }
  return r;
}

self.addEventListener("fetch", (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.startsWith("/api/") || u.pathname === "/admin" || u.pathname === "/compte") return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  if (/^\/assets\//.test(u.pathname)) { e.respondWith(cacheFirst(req)); return; }
  if (/^\/(css|js)\//.test(u.pathname)) e.respondWith(networkFirst(req));
});
