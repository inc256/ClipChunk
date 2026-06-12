/* ClipChunk service worker — minimal, NetworkFirst for HTML, CacheFirst for assets */

// Bump this string on every deploy (or template it from your build hash).
// The static "v1" name meant `activate` never had anything to clean up,
// letting stale hashed chunks linger in cache across deploys.
const CACHE = "clipchunk-v2";
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

  // Assets — cache first, but never cache (or mask) a failed response.
  // A 404 here is most likely a stale hashed chunk reference from an old
  // bundle still running in the tab. We deliberately let the 404 propagate
  // so the page's `vite:preloadError` handler can catch it and reload —
  // serving the stale `cached` copy instead would mask the real error and
  // potentially run mismatched old/new code together.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (res.type === "basic" || res.type === "cors")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached || Response.error());
    })
  );
});