// Affinix service worker. It exists so the site can be installed as an app (Windows / Android / desktop browsers) and
// keeps the last page it saw for when the network is gone. NETWORK FIRST, and only for navigations: a new deploy is always picked up
// at once (the site has its own auto-update, see lib/useAutoUpdate.js), the cache is only a fallback. Nothing from the API
// (Supabase, edge functions, /api) is ever cached.
const CACHE = "affinix-shell-v3";
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
  // Only page navigations go through the worker (network first, the cached shell when offline). Scripts, styles, images and all data go straight
  // to the browser: a worker in the middle of every request only adds delay.
  if (req.method !== "GET" || req.mode !== "navigate") return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {}); }
        return res;
      })
      .catch(() => caches.match("./index.html").then((hit) => hit ?? Response.error()))
  );
});

// --- Push notifications (a chat message arriving while the site is closed or in the background) -------------------------------------
// supabase/functions/notify-message sends { title, body, tag, url }. If a window of the site is open and in front, the page itself already
// shows a toast and plays a sound, so the worker stays quiet then (otherwise the same message would pop up twice).
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === "visible" && w.focused !== false)) return;
    await self.registration.showNotification(data.title || "Affinix", {
      body: data.body || "",
      icon: "./assets/pwa/icon-192.png",
      badge: "./assets/pwa/icon-192.png",
      tag: data.tag || "affinix",
      renotify: true,
      data: { url: data.url || "./#/app/messages" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./#/app/messages", self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const mine = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (mine) { try { await mine.focus(); await mine.navigate(target); return; } catch { /* fall through to a new window */ } }
    await self.clients.openWindow(target);
  })());
});
