import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
async function load(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", define: { "import.meta.env": '{"DEV":true}' }, write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

const { citySandbox } = await load("../../api/cityEstate.ts");
const SANDBOX = "/api/v1/admin/learning/city/sandbox";

async function sent(calls) {
  globalThis.localStorage = { getItem: () => null };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options.method, json: options.body ? JSON.parse(options.body) : undefined });
    return Response.json({});
  };
  for (const call of calls) await call();
  return requests;
}

test("the test city's tools send what the server's routes take, with no price and no idempotency key", async () => {
  const requests = await sent([
    () => citySandbox.city("sales"),
    () => citySandbox.build({ district_id: "support-team-2", family: "house", block: 3, col: 1, row: 0 }),
    () => citySandbox.level(7, 4),
    () => citySandbox.remove(7),
    () => citySandbox.district("support-team-2", { hq_level: 3 }),
    () => citySandbox.district("support-team-2", { landmark_level: 4 }),
    () => citySandbox.openProject({ district_id: "support-team-2", family: "fountain", u: 4, v: 5, rotation: 0 }),
    () => citySandbox.openProject({ district_id: "support-team-2", family: "gazebo", target_id: 9 }),
    () => citySandbox.complete(11),
    () => citySandbox.cancel(11),
    () => citySandbox.reset("support"),
  ]);
  assert.deepEqual(requests, [
    { url: `${SANDBOX}/cities/sales`, method: "GET", json: undefined },
    { url: `${SANDBOX}/plots`, method: "POST", json: { district_id: "support-team-2", family: "house", block: 3, col: 1, row: 0 } },
    { url: `${SANDBOX}/buildings/7/level`, method: "POST", json: { level: 4 } },
    { url: `${SANDBOX}/buildings/7`, method: "DELETE", json: undefined },
    { url: `${SANDBOX}/districts/support-team-2`, method: "PUT", json: { hq_level: 3 } },
    { url: `${SANDBOX}/districts/support-team-2`, method: "PUT", json: { landmark_level: 4 } },
    { url: `${SANDBOX}/projects`, method: "POST", json: { district_id: "support-team-2", family: "fountain", u: 4, v: 5, rotation: 0 } },
    { url: `${SANDBOX}/projects`, method: "POST", json: { district_id: "support-team-2", family: "gazebo", target_id: 9 } },
    { url: `${SANDBOX}/projects/11/complete`, method: "POST", json: undefined },
    { url: `${SANDBOX}/projects/11`, method: "DELETE", json: undefined },
    { url: `${SANDBOX}/cities/support/reset`, method: "POST", json: undefined },
  ]);
  // Every request has its route on the server (app/api/v1/city_sandbox.py), administrators only.
  const server = readFileSync(new URL("../../../../app/api/v1/city_sandbox.py", import.meta.url), "utf8");
  const prefix = server.match(/prefix="([^"]+)"/)[1];
  const routes = [...server.matchAll(/@router\.(get|post|put|delete)\("([^"]+)"\)\nasync def \w+\(([^)]*)/g)].map(([, method, path, args]) => {
    assert.match(args, /user: AdminUser/, `${method} ${path} is for administrators only`);
    return { method: method.toUpperCase(), path: new RegExp(`^/api/v1${prefix}${path.replace(/\{[a-z_]+\}/g, "[^/]+")}$`) };
  });
  assert.equal(routes.length, 9);
  for (const r of requests) assert.ok(routes.some(route => route.method === r.method && route.path.test(r.url)), `${r.method} ${r.url}`);
});

test("only administrators get the test city on the city page, and its dock replaces the real one", () => {
  const page = readFileSync(new URL("./CityPage.tsx", import.meta.url), "utf8");
  assert.match(page, /const sandboxOn = user\?\.role === "admin" && params\.get\("sandbox"\) === "1";/);
  assert.match(page, /\{user\?\.role === "admin" && <button[^>]*onClick=\{toggleSandbox\}/);
  // While it is on, the map draws only the test city, and the real land is not even asked for.
  assert.match(page, /enabled: department === "support" && !sandboxOn/);
  assert.match(page, /enabled: department === "sales" && !sandboxOn/);
  assert.match(page, /\{building && mineEstate && !sandboxOn && <CityEstateDock/);
  assert.match(page, /\{building && sandboxOn && <CitySandboxDock/);
  const dock = readFileSync(new URL("./CitySandboxDock.tsx", import.meta.url), "utf8");
  // The test city never calls the real city's paid operations.
  assert.doesNotMatch(dock, /\bcityEstate\.[a-z]+\(/);
});
