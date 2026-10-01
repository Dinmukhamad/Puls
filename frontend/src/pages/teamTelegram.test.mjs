import assert from "node:assert/strict";
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

const { loadTelegramDraft, telegramUpdate } = await load("./teamTelegram.ts");
const { team } = await load("../api/team.ts");
const status = { configured: true, connected: true, username: "linked_user", pending_username: "pending_user", linked_at: "2026-10-01T00:00:00Z", bot_username: "puls_bot" };

test("editing starts with the pending username and preserves unsaved changes across refreshes", () => {
  const initial = loadTelegramDraft(null, status);
  assert.deepEqual(initial, { value: "pending_user", original: "pending_user" });
  const edited = { ...initial, value: "@next_user" };
  const refreshed = loadTelegramDraft(edited, { ...status, pending_username: "changed_elsewhere" });
  assert.deepEqual(refreshed, edited);
  assert.deepEqual(telegramUpdate(refreshed, false), { telegram_username: "next_user" });
  assert.deepEqual(loadTelegramDraft(null, { ...status, pending_username: null }), { value: "linked_user", original: "linked_user" });
});

test("an unloaded or unchanged Telegram and one's own account never request a binding change", () => {
  assert.deepEqual(telegramUpdate(null, false), {});
  for (const value of ["pending_user", " @PENDING_USER ", "https://t.me/PENDING_USER/", "t.me/PENDING_USER"]) {
    assert.deepEqual(telegramUpdate({ original: "pending_user", value }, false), {});
  }
  assert.deepEqual(telegramUpdate({ original: "", value: "  " }, false), {});
  assert.deepEqual(telegramUpdate({ original: "linked_user", value: "@next_user" }, true), {});
});

test("a connected account without a username is preserved until explicitly disconnected", () => {
  const anonymous = loadTelegramDraft(null, { ...status, username: null, pending_username: null });
  assert.deepEqual(telegramUpdate(anonymous, false), {});
  assert.deepEqual(telegramUpdate({ ...anonymous, clearBinding: true }, false), { telegram_username: null });
  assert.deepEqual(telegramUpdate({ ...anonymous, clearBinding: true }, true), {});
});

test("PATCH preserves omitted Telegram and explicitly distinguishes changing it from clearing it", async () => {
  globalThis.localStorage = { getItem: () => null };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options.method, json: JSON.parse(options.body) });
    return Response.json({ id: 12, full_name: "Updated Name" });
  };
  const original = "linked_user";
  await team.updateUser(12, { full_name: "Updated Name", ...telegramUpdate(null, false) });
  await team.updateUser(12, { full_name: "Updated Name", ...telegramUpdate({ original, value: "@LINKED_USER" }, false) });
  await team.updateUser(12, { full_name: "Updated Name", ...telegramUpdate({ original, value: "https://t.me/NEXT_USER" }, false) });
  await team.updateUser(12, { full_name: "Updated Name", ...telegramUpdate({ original, value: "   " }, false) });
  await team.updateUser(12, { full_name: "Updated Name", ...telegramUpdate({ original: "", value: "", clearBinding: true }, false) });
  assert.deepEqual(requests, [
    { url: "/api/v1/admin/users/12", method: "PATCH", json: { full_name: "Updated Name" } },
    { url: "/api/v1/admin/users/12", method: "PATCH", json: { full_name: "Updated Name" } },
    { url: "/api/v1/admin/users/12", method: "PATCH", json: { full_name: "Updated Name", telegram_username: "next_user" } },
    { url: "/api/v1/admin/users/12", method: "PATCH", json: { full_name: "Updated Name", telegram_username: null } },
    { url: "/api/v1/admin/users/12", method: "PATCH", json: { full_name: "Updated Name", telegram_username: null } },
  ]);
});

test("the account editor reads the selected employee's Telegram status", async () => {
  globalThis.localStorage = { getItem: () => null };
  let requested;
  globalThis.fetch = async (url) => { requested = url; return Response.json(status); };
  assert.deepEqual(await team.userTelegram(12), status);
  assert.equal(requested, "/api/v1/admin/users/12/telegram");
});
