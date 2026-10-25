// Affinix service worker. It exists so the site can be installed as an app (Windows / Android / desktop browsers) and
// keeps the last pages it saw for when the network is gone. NETWORK FIRST for everything: a new deploy is always picked up
// at once (the site has its own auto-update, see lib/useAutoUpdate.js), the cache is only a fallback. Nothing from the API
// (Supabase, edge functions, /api) is ever cached.
const CACHE = "affinix-shell-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./assets/pwa/icon-192.png", "./assets/pwa/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/") || /supabase\.co$/.test(url.hostname)) return; // live data: straight to the network
  if (url.origin !== location.origin && !/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)$/.test(url.hostname)) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (res.type === "basic" || res.type === "cors")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit ?? (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
