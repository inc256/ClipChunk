/* ClipChunk service worker — minimal, NetworkFirst for HTML, CacheFirst for assets */
const CACHE = "clipchunk-v1";
const PRECACHE = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .then(() => {
        return self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            try { client.postMessage({ type: "OFFLINE_READY" }); } catch (e) { /* noop */ }
          });
        });
      })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim()).then(() => {
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          try { client.postMessage({ type: "SW_ACTIVATED" }); } catch (e) { /* noop */ }
        });
      });
    })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && !url.hostname.includes("unpkg.com")) return;

  // HTML — network first
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match("/")))
    );
    return;
  }

  // Assets — cache first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (res.type === "basic" || res.type === "cors")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});