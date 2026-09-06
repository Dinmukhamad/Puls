/* Replaced with the production asset list and content fingerprint by Vite. */
const CACHE_NAME = "puls-static-__BUILD_ID__";
const STATIC_URLS = __STATIC_URLS__;
const STATIC_PATHS = new Set(STATIC_URLS);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    STATIC_URLS.map((url) => new Request(url, { credentials: "omit", cache: "reload" })),
  )));
  // A newer worker waits until the user explicitly accepts the update.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Keep older static assets while another open tab may still need them.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.length <= 1) {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("puls-static-") && name !== CACHE_NAME)
        .map((name) => caches.delete(name)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Private data and writes always go straight to the network. Never cache them.
  if (request.method !== "GET" || url.origin !== self.location.origin ||
    request.headers.has("authorization") || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match("/offline.html")) || new Response("Нет соединения. Обновите страницу, когда сеть восстановится.", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }));
    return;
  }

  // Exact build files only: no runtime response (including HTML) is written.
  if (!url.search && (STATIC_PATHS.has(url.pathname) || /^\/assets\/[\w.-]+\.(js|css)$/.test(url.pathname))) {
    event.respondWith((async () => {
      const names = await caches.keys();
      const ordered = [CACHE_NAME, ...names.filter((name) => name.startsWith("puls-static-") && name !== CACHE_NAME)];
      for (const name of ordered) {
        const cached = await (await caches.open(name)).match(url.pathname);
        if (cached) return cached;
      }
      return fetch(request);
    })());
  }
});
