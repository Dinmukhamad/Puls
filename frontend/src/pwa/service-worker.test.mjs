import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const origin = "https://puls.example";
const artifact = new URL("../../dist/sw.js", import.meta.url);
const source = readFileSync(artifact, "utf8");
const cacheName = source.match(/const CACHE_NAME = "([^"]+)"/)[1];
const staticUrls = JSON.parse(source.match(/const STATIC_URLS = (\[[^;]+\]);/)[1]);
const release = JSON.parse(readFileSync(new URL("../../dist/version.json", import.meta.url), "utf8"));

function runtime({ offline = false, windows = 1 } = {}) {
  const handlers = new Map();
  const stores = new Map();
  const requests = [];
  let activations = 0;
  let claimed = false;
  const key = (value) => new URL(typeof value === "string" ? value : value.url, origin).href;
  const cacheStorage = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(urls) {
          for (const request of urls) {
            requests.push(request);
            store.set(key(request), new Response(`static:${new URL(request.url).pathname}`));
          }
        },
        async match(request) { return store.get(key(request))?.clone(); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  class LocalRequest extends Request {
    constructor(input, options) { super(new URL(input, origin), options); }
  }
  vm.runInNewContext(source, {
    Request: LocalRequest, Response, URL, Set, caches: cacheStorage,
    fetch: async () => {
      if (offline) throw new TypeError("Failed to fetch");
      return new Response("personal-network-response");
    },
    self: {
      location: { origin },
      addEventListener: (event, handler) => handlers.set(event, handler),
      skipWaiting: async () => { activations++; },
      clients: {
        matchAll: async () => Array.from({ length: windows }, (_, index) => ({ id: `window-${index}` })),
        claim: async () => { claimed = true; },
      },
    },
  });
  return {
    stores, requests,
    get activations() { return activations; },
    get claimed() { return claimed; },
    async dispatch(name, data = {}) {
      let response;
      const jobs = [];
      handlers.get(name)({
        ...data,
        waitUntil(promise) { jobs.push(promise); },
        respondWith(promise) { response = promise; },
      });
      await Promise.all(jobs);
      return response ? await response : undefined;
    },
  };
}

function request(path, { method = "GET", authorization = false, mode = "cors" } = {}) {
  return {
    url: new URL(path, origin).href, method, mode,
    headers: new Headers(authorization ? { Authorization: "Bearer test-token" } : {}),
  };
}

test("production worker has a content fingerprint and all precache files exist", () => {
  assert.match(cacheName, /^puls-static-[a-f0-9]{20}$/);
  assert.ok(!source.includes("__BUILD_ID__") && !source.includes("__STATIC_URLS__"));
  assert.ok(staticUrls.includes("/offline.html"));
  assert.ok(!staticUrls.includes("/version.json"));
  assert.match(release.buildId, /^[a-f0-9]{20}$/);
  assert.ok(source.includes(release.buildId));
  assert.ok(readFileSync(new URL("../../dist/index.html", import.meta.url), "utf8").includes(`content="${release.buildId}"`));
  assert.ok(staticUrls.some((path) => path.startsWith("/assets/") && path.endsWith(".js")));
  for (const path of staticUrls) {
    assert.ok(!path.startsWith("/api") && !path.includes("?"));
    assert.ok(existsSync(new URL(`../../dist${path}`, import.meta.url)), path);
  }
});

test("install precaches static files without credentials and does not force activation", async () => {
  const sw = runtime();
  await sw.dispatch("install");
  assert.equal(sw.activations, 0);
  assert.equal(sw.requests.length, staticUrls.length);
  assert.ok(sw.requests.every((req) => req.credentials === "omit" && req.cache === "reload"));
});

test("API, authenticated requests, writes, external resources and unknown paths bypass caches", async () => {
  const sw = runtime();
  await sw.dispatch("install");
  const before = sw.stores.get(cacheName).size;
  for (const req of [
    request("/api/v1/me/dashboard"), request("/api"),
    request("/icons/puls-192.png", { authorization: true }),
    request("/icons/puls-192.png", { method: "POST" }),
    request("https://api.example/me"), request("/private/export.csv"),
    request("/icons/puls-192.png?user=123"),
    request("/version.json"),
  ]) assert.equal(await sw.dispatch("fetch", { request: req }), undefined);
  assert.equal(sw.stores.get(cacheName).size, before);
});

test("offline deep links show the offline screen; online HTML is never persisted", async () => {
  const offline = runtime({ offline: true });
  await offline.dispatch("install");
  const fallback = await offline.dispatch("fetch", { request: request("/admin/users?group=51", { mode: "navigate" }) });
  assert.equal(await fallback.text(), "static:/offline.html");
  const online = runtime();
  await online.dispatch("install");
  const response = await online.dispatch("fetch", { request: request("/profile", { mode: "navigate" }) });
  assert.equal(await response.text(), "personal-network-response");
  assert.equal(online.stores.get(cacheName).has(`${origin}/profile`), false);
});

test("cached build assets work offline without caching runtime responses", async () => {
  const sw = runtime({ offline: true });
  await sw.dispatch("install");
  const path = staticUrls.find((url) => url.endsWith(".js"));
  const cached = await sw.dispatch("fetch", { request: request(path) });
  assert.equal(await cached.text(), `static:${path}`);
  const online = runtime();
  await online.dispatch("install");
  const other = await online.dispatch("fetch", { request: request("/assets/unknown-script.js") });
  assert.equal(await other.text(), "personal-network-response");
  assert.equal(online.stores.get(cacheName).has(`${origin}/assets/unknown-script.js`), false);
});

test("activation preserves old lazy chunks even for a single old tab", async () => {
  const sw = runtime({ windows: 2 });
  sw.stores.set("puls-static-old", new Map());
  sw.stores.set("unrelated-app", new Map());
  await sw.dispatch("message", { data: { type: "OTHER" } });
  assert.equal(sw.activations, 0);
  await sw.dispatch("message", { data: { type: "ACTIVATE_UPDATE" } });
  assert.equal(sw.activations, 1);
  await sw.dispatch("activate");
  assert.ok(sw.claimed && sw.stores.has("puls-static-old") && sw.stores.has("unrelated-app"));
  const single = runtime();
  single.stores.set("puls-static-old", new Map());
  single.stores.set("unrelated-app", new Map());
  await single.dispatch("activate");
  assert.ok(single.stores.has("puls-static-old") && single.stores.has("unrelated-app"));
  await single.dispatch("message", { data: { type: "CLIENT_READY", buildId: release.buildId }, source: { id: "window-0" } });
  assert.ok(!single.stores.has("puls-static-old") && single.stores.has("unrelated-app"));
});

test("all open clients must report the new version before cache cleanup", async () => {
  const sw = runtime({ windows: 2 });
  const oldFile = new URL("/assets/old-lazy.js", origin).href;
  sw.stores.set("puls-static-old", new Map([[oldFile, new Response("old module")]]));
  await sw.dispatch("activate");
  await sw.dispatch("message", { data: { type: "CLIENT_READY", buildId: release.buildId }, source: { id: "window-0" } });
  await sw.dispatch("message", { data: { type: "CLIENT_READY", buildId: "old" }, source: { id: "window-1" } });
  assert.equal(await (await sw.dispatch("fetch", { request: request("/assets/old-lazy.js") })).text(), "old module");
  await sw.dispatch("message", { data: { type: "CLIENT_READY", buildId: release.buildId }, source: { id: "window-1" } });
  assert.equal(sw.stores.has("puls-static-old"), false);
});

test("worker tells the app which release is actually installed", async () => {
  const sw = runtime(); let result;
  await sw.dispatch("message", { data: { type: "GET_RELEASE" }, ports: [{ postMessage(value) { result = value; } }] });
  assert.equal(result.buildId, release.buildId);
  assert.equal(result.version, release.version);
});

test("manifest points to correctly sized PNG icons and permits landscape", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../dist/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "any");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  for (const icon of manifest.icons) {
    const png = readFileSync(new URL(`../../dist${icon.src}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});
