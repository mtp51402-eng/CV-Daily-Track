/* Service worker — offline-first app shell.
   Firebase (data) requests are never cached here; the app keeps its own offline queue. */
const VERSION = "mt-v2.0.0";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "mt-fonts").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });
  const network = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, "mt-fonts"));
    return;
  }

  if (url.origin !== self.location.origin) return; // Firebase etc. → straight to network

  if (req.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then((hit) => {
        const refresh = fetch(req)
          .then((res) => {
            if (res && res.ok) caches.open(VERSION).then((c) => c.put("./index.html", res.clone()));
            return res;
          })
          .catch(() => null);
        return hit || refresh || Response.error();
      })
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(req, VERSION));
});
