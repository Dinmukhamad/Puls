/* Replaced with the production asset list and content fingerprint by Vite. */
const CACHE_NAME = "puls-static-__BUILD_ID__";
const STATIC_URLS = __STATIC_URLS__;
const STATIC_PATHS = new Set(STATIC_URLS);
const RELEASE = __RELEASE__;
const clientBuilds = new Map();

async function cleanUnusedCaches() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  // Даже одна старая вкладка может позднее запросить свой отложенный JS-модуль.
  // Неизвестные и старые клиенты сохраняют прежние файлы до закрытия/обновления.
  if (windows.some((client) => clientBuilds.get(client.id) !== RELEASE.buildId)) return;
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith("puls-static-") && name !== CACHE_NAME)
    .map((name) => caches.delete(name)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    STATIC_URLS.map((url) => new Request(url, { credentials: "omit", cache: "reload" })),
  )));
  // Активацию запрашивает приложение после проверки возможности обновления.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await cleanUnusedCaches();
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
  if (event.data?.type === "GET_RELEASE") event.ports?.[0]?.postMessage(RELEASE);
  if (event.data?.type === "CLIENT_READY" && event.source?.id && typeof event.data.buildId === "string") {
    clientBuilds.set(event.source.id, event.data.buildId);
    event.waitUntil(cleanUnusedCaches());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Private data and writes always go straight to the network. Never cache them.
  if (request.method !== "GET" || url.origin !== self.location.origin ||
    request.headers.has("authorization") || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { cache: "no-store" }).catch(async () => {
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
