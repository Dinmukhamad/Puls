import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const built = await build({
  stdin: {
    contents: 'export { auth } from "./endpoints"; export { accessApi } from "./access"; export { tokenStore } from "./client";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url)),
  },
  bundle: true, platform: "node", format: "esm", write: false,
  define: { "import.meta.env.DEV": "true", "import.meta.env.VITE_API_BASE_URL": '""' },
});
let serial = 0;
async function setup(t) {
  const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; });
  const storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
  const api = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#${++serial}`);
  api.tokenStore.save({ access_token: "operator-access", refresh_token: "operator-refresh" });
  return api;
}
const reads = (api, signal) => [() => api.auth.me(signal), () => api.accessApi.mine(signal)];
const flush = () => new Promise(setImmediate);

test("profile and permissions stop a hung fetch at 25 seconds and preserve the operator session", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = await setup(t), requests = [];
  globalThis.fetch = (url, options) => {
    requests.push({ url, ...options });
    return new Promise(() => {});
  };
  const failures = reads(api).map(read => assert.rejects(read(), { status: 0, code: "request_timeout" }));
  t.mock.timers.tick(24999);
  assert.ok(requests.every(request => !request.signal.aborted));
  t.mock.timers.tick(1);
  await Promise.all(failures);
  assert.deepEqual(requests.map(request => [request.url, request.method]), [
    ["/api/v1/auth/me", "GET"], ["/api/v1/me/access", "GET"],
  ]);
  assert.ok(requests.every(request => request.signal.aborted));
  assert.equal(api.tokenStore.access, "operator-access");
  assert.equal(api.tokenStore.refresh, "operator-refresh");
});

test("bootstrap deadlines also cover a hung profile or permissions response body", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = await setup(t), signals = [];
  globalThis.fetch = async (_url, options) => {
    signals.push(options.signal);
    return {
      ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
      json: () => new Promise(() => {}),
    };
  };
  const failures = reads(api).map(read => assert.rejects(read(), { status: 0, code: "request_timeout" }));
  await flush();
  t.mock.timers.tick(25000);
  await Promise.all(failures);
  assert.ok(signals.every(signal => signal.aborted));
});

test("leaving bootstrap cancels profile and permissions even when fetch ignores the signal", async t => {
  const api = await setup(t), controller = new AbortController(), signals = [];
  globalThis.fetch = (_url, options) => {
    signals.push(options.signal);
    return new Promise(() => {});
  };
  const failures = reads(api, controller.signal).map(read => assert.rejects(read(), { name: "AbortError" }));
  controller.abort();
  await Promise.all(failures);
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(api.tokenStore.access, "operator-access");
});

test("already cancelled bootstrap reads send no profile or permissions request", async t => {
  const api = await setup(t), controller = new AbortController();
  controller.abort();
  let sent = 0;
  globalThis.fetch = async () => { sent++; return Response.json({}); };
  await Promise.all(reads(api, controller.signal).map(read => assert.rejects(read(), { name: "AbortError" })));
  assert.equal(sent, 0);
});

test("a timed out bootstrap can retry successfully and releases timers and caller listeners", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = await setup(t);
  globalThis.fetch = () => new Promise(() => {});
  const failures = reads(api).map(read => assert.rejects(read(), { code: "request_timeout" }));
  t.mock.timers.tick(25000);
  await Promise.all(failures);
  const controller = new AbortController(), signals = [];
  const remove = t.mock.method(controller.signal, "removeEventListener");
  globalThis.fetch = async (url, options) => {
    signals.push(options.signal);
    return Response.json(url.endsWith("/auth/me") ? { id: 42, role: "operator" } : { allowed: { training: true } });
  };
  assert.deepEqual(await Promise.all(reads(api, controller.signal).map(read => read())), [
    { id: 42, role: "operator" }, { allowed: { training: true } },
  ]);
  assert.equal(remove.mock.callCount(), 2);
  t.mock.timers.tick(25000);
  controller.abort();
  assert.ok(signals.every(signal => !signal.aborted));
});

test("login and mutations keep their existing deadline, method and authentication policies", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = await setup(t), requests = [];
  globalThis.fetch = (url, options) => new Promise(resolve => { requests.push({ url, ...options, resolve }); });
  const change = { revision: 3, target_type: "user", target_ids: ["42"], changes: [{ section: "training", effect: "allow" }] };
  const pending = [api.auth.login("operator", "password"), api.auth.guide({ guide_name: "Пульсар" }), api.accessApi.save(change)];
  t.mock.timers.tick(25000);
  assert.ok(requests.every(request => !request.signal.aborted));
  assert.deepEqual(requests.map(request => [request.url, request.method]), [
    ["/api/v1/auth/login", "POST"], ["/api/v1/auth/guide", "PUT"], ["/api/v1/admin/access", "PUT"],
  ]);
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.equal(requests[0].body, "username=operator&password=password");
  assert.equal(requests[1].headers.Authorization, "Bearer operator-access");
  assert.deepEqual(JSON.parse(requests[2].body), change);
  requests.forEach(request => request.resolve(Response.json({ ok: true })));
  assert.deepEqual(await Promise.all(pending), [{ ok: true }, { ok: true }, { ok: true }]);
});

test("logout keeps its existing 15 second cancellation policy", async t => {
  const api = await setup(t), controller = new AbortController();
  const timeout = t.mock.method(AbortSignal, "timeout", () => controller.signal);
  let request;
  globalThis.fetch = (url, options) => { request = { url, ...options }; return new Promise(() => {}); };
  const cancelled = assert.rejects(api.auth.logout(), { name: "AbortError" });
  assert.deepEqual(timeout.mock.calls.map(call => call.arguments), [[15000]]);
  assert.equal(request.url, "/api/v1/auth/logout");
  assert.equal(request.method, "POST");
  controller.abort();
  await cancelled;
  assert.equal(request.signal.aborted, true);
});
