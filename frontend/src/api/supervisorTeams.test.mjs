import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const built = await build({ entryPoints: [fileURLToPath(new URL("./team.ts", import.meta.url))], bundle: true, platform: "node", format: "cjs", write: false, define: { "import.meta.env": '{"DEV":true}' } });
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
const { team } = module.exports;

test("supervisor list and operator filters use server scope rather than local group membership guesses", async () => {
  globalThis.localStorage = { getItem: () => null };
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(new URL(url, "https://puls.test")); return Response.json([]); };
  await team.supervisorTeams(true);
  await team.users({ role: "operator", supervisor_id: 42, page: 1, size: 20 });
  await team.users({ role: "operator", unassigned: true });
  assert.equal(urls[0].pathname, "/api/v1/admin/supervisor-teams");
  assert.equal(urls[0].searchParams.get("include_inactive"), "true");
  assert.equal(urls[1].searchParams.get("supervisor_id"), "42");
  assert.equal(urls[1].searchParams.has("group_id"), false);
  assert.equal(urls[2].searchParams.get("unassigned"), "true");
});

test("bulk assignment preserves the chosen legacy district and removal has a distinct endpoint", async () => {
  globalThis.localStorage = { getItem: () => null };
  const requests = [];
  globalThis.fetch = async (url, options) => { requests.push({ url, method: options.method, json: JSON.parse(options.body) }); return Response.json({}); };
  await team.assignOperators(42, [11, 12], 79);
  await team.assignOperators(42, [13], null);
  await team.removeOperators(42, [11, 12]);
  assert.deepEqual(requests, [
    { url: "/api/v1/admin/supervisor-teams/42/operators", method: "POST", json: { operator_ids: [11, 12], group_id: 79 } },
    { url: "/api/v1/admin/supervisor-teams/42/operators", method: "POST", json: { operator_ids: [13] } },
    { url: "/api/v1/admin/supervisor-teams/42/operators/remove", method: "POST", json: { operator_ids: [11, 12] } },
  ]);
});

test("editing an account can preserve its membership and Telegram without sending accidental reset fields", async () => {
  globalThis.localStorage = { getItem: () => null };
  let json;
  globalThis.fetch = async (_url, options) => { json = JSON.parse(options.body); return Response.json({}); };
  await team.updateUser(11, { full_name: "Имя Оператора", role: "operator", email: null, phone: null, hired_on: null });
  assert.equal(Object.hasOwn(json, "group_id"), false);
  assert.equal(Object.hasOwn(json, "supervisor_id"), false);
  assert.equal(Object.hasOwn(json, "telegram_username"), false);
});
