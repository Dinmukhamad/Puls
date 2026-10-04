import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const built = await build({
  stdin: { contents: 'export { city } from "./city"; export { cityWorld } from "./cityWorld"; export { cityEstate, citySandbox } from "./cityEstate";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", write: false,
  define: { "import.meta.env.DEV": "true", "import.meta.env.VITE_API_BASE_URL": '""' },
});
let serial = 0;
async function setup() {
  globalThis.localStorage = { getItem: () => null };
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#${++serial}`);
}
function startupReads(api, signal) {
  return [
    () => api.city.own(signal),
    () => api.city.operator(42, signal),
    () => api.cityWorld.get(signal),
    () => api.cityEstate.mine(signal),
    () => api.cityEstate.city("sales", signal),
    () => api.citySandbox.city("support", signal),
  ];
}

test("every city startup read has a bounded deadline, including the administrator's test map", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = await setup(), requests = [];
  globalThis.fetch = (url, options) => {
    requests.push({ url, signal: options.signal });
    return new Promise(() => {});
  };
  const failures = startupReads(api).map(read => assert.rejects(read(), { status: 0, code: "request_timeout" }));
  t.mock.timers.tick(25000);
  await Promise.all(failures);
  assert.deepEqual(requests.map(request => request.url), [
    "/api/v1/learning/city", "/api/v1/admin/learning/city/operators/42", "/api/v1/learning/city/world",
    "/api/v1/learning/city/estate", "/api/v1/learning/city/cities/sales", "/api/v1/admin/learning/city/sandbox/cities/support",
  ]);
  assert.ok(requests.every(request => request.signal.aborted));
});

test("leaving the city cancels all startup reads immediately", async () => {
  const api = await setup(), controller = new AbortController();
  globalThis.fetch = () => new Promise(() => {});
  const failures = startupReads(api, controller.signal).map(read => assert.rejects(read(), { name: "AbortError" }));
  controller.abort();
  await Promise.all(failures);
});

test("city changes retain their existing deadline policy", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = await setup();
  let finish, requestSignal;
  globalThis.fetch = (_url, options) => {
    requestSignal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = api.city.answer(0, 1);
  t.mock.timers.tick(25000);
  assert.equal(requestSignal.aborted, false);
  finish(Response.json({ answered: true }));
  assert.deepEqual(await pending, { answered: true });
});
