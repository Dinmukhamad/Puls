import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");
const built = await transform(source, { loader: "ts", format: "esm", define: {
  "import.meta.env.DEV": "true", "import.meta.env.VITE_API_BASE_URL": '""',
} });
let serial = 0;
async function setup() {
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  return import(`data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}#${++serial}`);
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const json = (value, status = 200) => Response.json(value, { status });
const oldToken = { access_token: "old-access", refresh_token: "old-refresh" };
const newToken = { access_token: "new-access", refresh_token: "new-refresh" };

test("driver proof survives refresh and cannot override the Puls access token", async () => {
  const api = await setup(); api.tokenStore.save(oldToken);
  const requests = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/refresh")) return json(newToken);
    requests.push(options.headers);
    return options.headers.Authorization === "Bearer new-access" ? json({ ok: true }) : json({}, 401);
  };
  assert.deepEqual(await api.request("/driver", { headers: { "X-Driver-Device": "browser-proof", Authorization: "forged" } }), { ok: true });
  assert.deepEqual(requests, [
    { "X-Driver-Device": "browser-proof", Authorization: "Bearer old-access" },
    { "X-Driver-Device": "browser-proof", Authorization: "Bearer new-access" },
  ]);
});

test("section revocation refreshes permissions without clearing the login", async () => {
  const api = await setup(); api.tokenStore.save(oldToken);
  let notifications = 0;
  const stop = api.onSectionDenied(() => { notifications++; });
  globalThis.fetch = async () => json({ code: "section_denied", detail: "Access closed" }, 403);
  await assert.rejects(api.request("/api/v1/admin/users"), { status: 403, code: "section_denied" });
  assert.equal(notifications, 1);
  assert.equal(api.tokenStore.access, oldToken.access_token);
  stop();
  await assert.rejects(api.request("/api/v1/admin/users"), { status: 403 });
  assert.equal(notifications, 1);
});

test("parallel expired requests share one refresh and retry with the rotated access", async () => {
  const api = await setup(); api.tokenStore.save(oldToken);
  const refresh = deferred(); let refreshes = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/refresh")) { refreshes++; return refresh.promise; }
    return options.headers.Authorization === "Bearer new-access" ? json({ ok: true }) : json({}, 401);
  };
  const requests = [api.request("/data"), api.request("/data")];
  await new Promise((done) => setTimeout(done, 0));
  refresh.resolve(json(newToken));
  assert.deepEqual(await Promise.all(requests), [{ ok: true }, { ok: true }]);
  assert.equal(refreshes, 1);
});

test("an old refresh cannot restore credentials after logout", async () => {
  const api = await setup(); api.tokenStore.save(oldToken);
  const refresh = deferred();
  globalThis.fetch = async (url) => url.endsWith("/refresh") ? refresh.promise : json({}, 401);
  const pending = api.request("/data");
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await new Promise((done) => setTimeout(done, 0));
  api.tokenStore.clear(); refresh.resolve(json(newToken));
  await rejected;
  assert.equal(api.tokenStore.access, null);
});

test("a late response from another account neither clears the new login nor returns old data", async () => {
  const api = await setup(); api.tokenStore.save(oldToken);
  const late = deferred(); globalThis.fetch = () => late.promise;
  const pending = api.request("/data");
  const rejected = assert.rejects(pending, { name: "AbortError" });
  api.tokenStore.save(newToken); late.resolve(json({ private: "old account" }));
  await rejected;
  assert.equal(api.tokenStore.access, newToken.access_token);
});

test("a network failure during refresh keeps the session for reconnection", async () => {
  const api = await setup(); api.tokenStore.save(oldToken);
  globalThis.fetch = async (url) => {
    if (url.endsWith("/refresh")) throw new TypeError("Offline");
    return json({}, 401);
  };
  await assert.rejects(api.request("/data"), (error) => error.status === 0);
  assert.equal(api.tokenStore.refresh, oldToken.refresh_token);
});

const flush = () => new Promise(setImmediate);

test("a stalled city fetch settles at its deadline and permits a fresh retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = await setup(); api.tokenStore.save(oldToken);
  let requestSignal;
  globalThis.fetch = (_url, options) => { requestSignal = options.signal; return deferred().promise; };
  const failed = assert.rejects(api.request("/city", { timeoutMs: 25000 }), { status: 0, code: "request_timeout" });
  t.mock.timers.tick(25000);
  await failed;
  assert.equal(requestSignal.aborted, true);
  assert.equal(api.tokenStore.access, oldToken.access_token);
  globalThis.fetch = async () => json({ loaded: true });
  assert.deepEqual(await api.request("/city", { timeoutMs: 25000 }), { loaded: true });
});

test("the deadline covers stalled JSON and error response bodies", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = await setup();
  for (const status of [200, 500]) {
    globalThis.fetch = async () => ({
      ok: status === 200, status, headers: new Headers({ "content-type": "application/json" }),
      json: () => deferred().promise,
    });
    const failed = assert.rejects(api.request("/city", { timeoutMs: 25000 }), { status: 0, code: "request_timeout" });
    await flush();
    t.mock.timers.tick(25000);
    await failed;
  }
});

test("caller cancellation settles even when fetch ignores its signal", async () => {
  const api = await setup();
  const controller = new AbortController();
  let requestSignal;
  globalThis.fetch = (_url, options) => { requestSignal = options.signal; return deferred().promise; };
  const failed = assert.rejects(api.request("/city", { signal: controller.signal }), { name: "AbortError" });
  controller.abort();
  await failed;
  assert.equal(requestSignal.aborted, true);
});

test("an already cancelled request sends nothing", async () => {
  const api = await setup();
  const controller = new AbortController(); controller.abort();
  let sent = 0;
  globalThis.fetch = async () => { sent++; return json({}); };
  await assert.rejects(api.request("/city", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(sent, 0);
});

test("successful requests clear their deadline and caller listener", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = await setup();
  const controller = new AbortController();
  const remove = t.mock.method(controller.signal, "removeEventListener");
  let requestSignal;
  globalThis.fetch = async (_url, options) => { requestSignal = options.signal; return json({ ok: true }); };
  await api.request("/city", { signal: controller.signal, timeoutMs: 25000 });
  assert.equal(remove.mock.callCount(), 1);
  t.mock.timers.tick(25000);
  controller.abort();
  assert.equal(requestSignal.aborted, false);
});

test("cancelling one city query does not cancel another query's shared refresh", async () => {
  const api = await setup(); api.tokenStore.save(oldToken);
  const controller = new AbortController(), refresh = deferred();
  let refreshSignal, refreshes = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/refresh")) { refreshSignal = options.signal; refreshes++; return refresh.promise; }
    return options.headers.Authorization === "Bearer new-access" ? json({ ok: true }) : json({}, 401);
  };
  const cancelled = assert.rejects(api.request("/city", { signal: controller.signal }), { name: "AbortError" });
  const world = api.request("/city/world");
  await flush();
  controller.abort();
  await cancelled;
  assert.equal(refreshSignal.aborted, false);
  refresh.resolve(json(newToken));
  assert.deepEqual(await world, { ok: true });
  assert.equal(refreshes, 1);
});

test("a hung shared refresh times out, preserves login, and releases the next retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = await setup(); api.tokenStore.save(oldToken);
  let refreshes = 0, firstSignal;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/refresh")) {
      refreshes++;
      if (refreshes === 1) { firstSignal = options.signal; return deferred().promise; }
      return json(newToken);
    }
    return options.headers.Authorization === "Bearer new-access" ? json({ ok: true }) : json({}, 401);
  };
  const pending = [api.request("/city"), api.request("/city/world")];
  const failures = pending.map(promise => assert.rejects(promise, { status: 0, code: "request_timeout" }));
  await flush();
  t.mock.timers.tick(20000);
  await Promise.all(failures);
  assert.equal(firstSignal.aborted, true);
  assert.equal(api.tokenStore.refresh, oldToken.refresh_token);
  assert.deepEqual(await api.request("/city"), { ok: true });
  assert.equal(refreshes, 2);
});

test("shared refresh also bounds a stalled token response body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = await setup(); api.tokenStore.save(oldToken);
  globalThis.fetch = async (url) => url.endsWith("/refresh")
    ? { ok: true, json: () => deferred().promise } : json({}, 401);
  const failed = assert.rejects(api.request("/city"), { status: 0, code: "request_timeout" });
  await flush();
  t.mock.timers.tick(20000);
  await failed;
  assert.equal(api.tokenStore.refresh, oldToken.refresh_token);
});

test("the original city deadline still applies to the replay after token rotation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = await setup(); api.tokenStore.save(oldToken);
  const first = deferred();
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/refresh")) return json(newToken);
    return options.headers.Authorization === "Bearer new-access" ? deferred().promise : first.promise;
  };
  const failed = assert.rejects(api.request("/city", { timeoutMs: 25000 }), { status: 0, code: "request_timeout" });
  t.mock.timers.tick(24000);
  first.resolve(json({}, 401));
  await flush();
  assert.equal(api.tokenStore.access, newToken.access_token);
  t.mock.timers.tick(1000);
  await failed;
});

test("a replacement login starts its own refresh while an old account's refresh is pending", async () => {
  const api = await setup(); api.tokenStore.save(oldToken);
  const oldRefresh = deferred(), replacementRefresh = deferred();
  const replacement = { access_token: "replacement-access", refresh_token: "replacement-refresh" };
  const rotated = { access_token: "rotated-access", refresh_token: "rotated-refresh" };
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/refresh")) return JSON.parse(options.body).refresh_token === "old-refresh"
      ? oldRefresh.promise : replacementRefresh.promise;
    return options.headers.Authorization === "Bearer rotated-access" ? json({ account: "replacement" }) : json({}, 401);
  };
  const old = assert.rejects(api.request("/city"), { name: "AbortError" });
  await flush();
  api.tokenStore.save(replacement);
  const current = api.request("/city");
  await flush();
  oldRefresh.resolve(json(newToken));
  await old;
  replacementRefresh.resolve(json(rotated));
  assert.deepEqual(await current, { account: "replacement" });
  assert.equal(api.tokenStore.access, rotated.access_token);
});
