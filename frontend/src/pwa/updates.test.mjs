import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const built = await build({ entryPoints: [fileURLToPath(new URL("./updates.ts", import.meta.url))], bundle: true, platform: "node", format: "cjs", write: false });
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { INITIAL_UPDATE, UpdateManager, updateBlockReason } = module.exports;
const current = { buildId: "a".repeat(20), version: "2.0.1", builtAt: "2026-09-08T00:00:00Z", changes: ["First"] };
const newer = { ...current, buildId: "b".repeat(20), changes: ["Next"] };
function memory() {
  const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function setup(options = {}) {
  const log = [], states = [], storage = memory(), session = memory();
  storage.setItem("pulse.access", "keep-login"); storage.setItem("pulse.driver-device", "keep-browser"); storage.setItem("pulse.theme", "dark");
  const platform = { latest: async () => newer, prepare: async () => log.push("prepare"), activate: async () => log.push("activate"), confirmPage: async () => log.push("confirm"), reload: () => log.push("reload"), blocked: () => null, visible: () => true, lastActivity: () => 0, storage, session, ...options };
  return { manager: new UpdateManager(current, platform, state => states.push(state)), platform, log, states, storage, session };
}

test("periodic check downloads the update and leaves the running page open", async () => {
  const { manager, log } = setup(); await manager.check();
  assert.equal(manager.state.available.buildId, newer.buildId);
  assert.deepEqual(log, ["prepare"]);
});
test("safe app entry applies the matching version while preserving credentials", async () => {
  const { manager, storage, log } = setup(); await manager.check(true);
  assert.deepEqual(log, ["prepare", "prepare", "confirm", "activate", "reload"]);
  assert.equal(storage.getItem("pulse.access"), "keep-login");
  assert.equal(storage.getItem("pulse.driver-device"), "keep-browser");
  assert.equal(storage.getItem("pulse.theme"), "dark");
});
test("pending work blocks both automatic and explicit reload", async () => {
  const { manager, log } = setup({ blocked: () => "Unsaved form" });
  await manager.check(true); await manager.apply();
  assert.equal(log.includes("reload"), false); assert.equal(manager.state.blocked, "Unsaved form");
});
test("new interaction during download cancels automatic application", async () => {
  let activity = 0;
  const { manager, log } = setup({ lastActivity: () => activity, prepare: async () => { activity++; } });
  await manager.check(true); assert.equal(log.includes("reload"), false);
});
test("a form opened during activation is still protected from reload", async () => {
  let blocked = null;
  const { manager, log } = setup({ blocked: () => blocked, activate: async () => { blocked = "Now editing"; } });
  await manager.check(); await manager.apply(); assert.equal(log.includes("reload"), false);
  assert.equal(manager.state.blocked, "Now editing");
});
test("another tab becoming the controller never instructs this tab to reload", async () => {
  const { manager, log } = setup({ latest: async () => current }); await manager.check(true);
  assert.deepEqual(log, ["prepare", "activate"]); assert.equal(manager.state.available, null);
});
test("failed or partially published updates keep the old version usable", async () => {
  for (const method of ["latest", "prepare", "confirmPage", "activate"]) {
    const { manager, platform, log } = setup(); await manager.check();
    platform[method] = async () => { throw new Error("Temporarily unavailable"); };
    await manager.apply();
    assert.equal(log.includes("reload"), false, method);
    assert.equal(manager.state.error, "Temporarily unavailable");
    assert.equal(manager.state.applying, false);
  }
});
test("superseding deployment is detected before applying the previous release", async () => {
  const { manager, platform, log } = setup(); await manager.check();
  platform.latest = async () => ({ ...newer, buildId: "c".repeat(20) });
  await manager.apply(); assert.equal(log.includes("reload"), false);
  assert.equal(manager.state.available.buildId, "c".repeat(20));
});
test("an unsuccessful automatic reload is not repeated in a loop", async () => {
  const initial = setup(); await initial.manager.check(true);
  const next = setup({ session: initial.session }); await next.manager.check(true);
  assert.equal(next.log.includes("reload"), false);
  await next.manager.apply(); assert.equal(next.log.includes("reload"), true);
});
test("blocked storage prevents automatic reload loops but allows a user request", async () => {
  const denied = { getItem() { throw Error("Blocked"); }, setItem() { throw Error("Blocked"); } };
  const { manager, log } = setup({ storage: denied, session: denied });
  await manager.check(true); assert.equal(log.includes("reload"), false);
  await manager.apply(); assert.equal(log.includes("reload"), true);
});
test("an applied update leaves nothing asking to update again", async () => {
  const { storage } = setup();
  const platform = setup({ storage, latest: async () => newer }).platform;
  const next = new UpdateManager(newer, platform, () => {});
  assert.deepEqual({ ...next.state, installedAt: null }, INITIAL_UPDATE);
  await next.check();
  assert.equal(next.state.available, null);
  assert.equal(next.state.error, null);
});
test("concurrent checks are coalesced and unmount cancels application", async () => {
  let resolve, reads = 0;
  const { manager, log } = setup({ latest: () => { reads++; return new Promise(done => { resolve = done; }); } });
  const first = manager.check(true), second = manager.check(); manager.stop(); resolve(newer);
  await Promise.all([first, second]); assert.equal(reads, 1); assert.deepEqual(log, []);
});
test("route, form, pending action and detached editor protection", () => {
  const doc = { querySelector: () => null, activeElement: null };
  for (const path of ["/simulator", "/simulator/attempts/1", "/training/attempts/2", "/games", "/qr-access", "/training/work-sites"]) assert.ok(updateBlockReason(doc, path, false, new Set()));
  assert.ok(updateBlockReason(doc, "/profile", true, new Set()));
  assert.ok(updateBlockReason({ ...doc, querySelector: () => ({}) }, "/admin/users", false, new Set()));
  const edited = new Set([{ isConnected: true }]);
  assert.ok(updateBlockReason(doc, "/profile", false, edited));
  [...edited][0].isConnected = false;
  assert.equal(updateBlockReason(doc, "/profile", false, edited), null);
});
