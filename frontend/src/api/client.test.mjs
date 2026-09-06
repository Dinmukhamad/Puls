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
