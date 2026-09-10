import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const built = await build({ entryPoints: [fileURLToPath(new URL("./driverLocation.ts", import.meta.url))], bundle: true, platform: "node", format: "cjs", write: false });
const module = { exports: {} };
new Function("module", "exports", built.outputFiles[0].text)(module, module.exports);
const { trackDriverLocation, freshFix, pickupAllowed, distanceMeters } = module.exports;
const point = { latitude: 43.2389, longitude: 76.8897 };

function environment() {
  let now = Date.parse("2026-09-09T12:00:00Z"), tick, cleared = false;
  const calls = [], states = [];
  const document = new EventTarget(); document.visibilityState = "visible";
  const permission = new EventTarget(); permission.state = "prompt";
  const tracker = trackDriverLocation(value => states.push(value), {
    document, navigator: { permissions: { query: async () => permission }, geolocation: { getCurrentPosition: (...args) => calls.push(args) } },
    now: () => now, interval: (cb, ms) => { assert.equal(ms, 10000); tick = cb; return 1; }, clear: () => { cleared = true; },
  });
  return { calls, states, tracker, permission, document,
    get latest() { return states.at(-1); }, get now() { return now; },
    success: (index, coords = point, age = 0) => calls[index][0]({ coords: { accuracy: 10, ...coords }, timestamp: now - age }),
    error: (index, code) => calls[index][1]({ code }),
    tick: (ms = 10000) => { now += ms; if (!cleared) tick(); },
    visibility: value => { document.visibilityState = value; document.dispatchEvent(new Event("visibilitychange")); },
    permit: value => { permission.state = value; permission.dispatchEvent(new Event("change")); },
  };
}

test("opening requests a new high-accuracy position even when permission is prompt, then refreshes every 10 seconds", async () => {
  const e = environment(); await Promise.resolve();
  assert.equal(e.calls.length, 1);
  assert.deepEqual(e.calls[0][2], { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
  e.success(0); assert.equal(e.latest.status, "ready");
  e.tick(); assert.equal(e.calls.length, 2);
  e.success(1, { ...point, latitude: point.latitude + .001 });
  assert.equal(e.latest.fix.latitude, point.latitude + .001);
  assert.equal(Date.parse(e.latest.fix.captured_at), e.now);
  e.tracker.stop(); e.tick(); assert.equal(e.calls.length, 2);
});

test("requests never overlap, denial clears the fix and requires retry or changed permission", () => {
  const e = environment(); e.tick(); e.tracker.retry(); assert.equal(e.calls.length, 1);
  e.error(0, 1); assert.equal(e.latest.status, "denied"); assert.equal(e.latest.fix, null);
  e.tick(); assert.equal(e.calls.length, 1);
  e.tracker.retry(); assert.equal(e.calls.length, 2); e.success(1); assert.equal(e.latest.status, "ready"); e.tracker.stop();
});

test("permission revocation invalidates in-flight results and resumes on grant", async () => {
  const e = environment(); await Promise.resolve(); e.success(0); e.tick();
  e.permit("denied"); e.success(1); assert.equal(e.latest.status, "denied"); assert.equal(e.latest.fix, null);
  e.tick(); assert.equal(e.calls.length, 2);
  e.permit("granted"); assert.equal(e.calls.length, 3); e.success(2); assert.equal(e.latest.status, "ready"); e.tracker.stop();
});

test("hiding the simulator clears its fix; returning refreshes immediately; late callbacks cannot restore old location", () => {
  const e = environment(); e.visibility("hidden"); e.success(0); e.tick();
  assert.equal(e.latest.status, "paused"); assert.equal(e.latest.fix, null); assert.equal(e.calls.length, 1);
  e.visibility("visible"); assert.equal(e.calls.length, 2); e.success(1); e.tick();
  e.tracker.stop(); const count = e.states.length;
  e.success(2); e.visibility("hidden"); e.visibility("visible"); e.tick();
  assert.equal(e.states.length, count); assert.equal(e.calls.length, 3);
});

test("poor accuracy, stale data and acquisition failure cannot retain a usable old position", () => {
  const e = environment(); e.success(0, { ...point, accuracy: 201 }); assert.equal(e.latest.fix, null);
  e.tick(); e.success(1, point, 31000); assert.equal(e.latest.fix, null);
  e.tick(); e.success(2); assert.equal(e.latest.status, "ready");
  e.tick(); e.error(3, 2); assert.equal(e.latest.fix, null);
  e.tick(); e.success(4); e.tick(); // Leave the next acquisition unresolved.
  e.tick(31000); assert.equal(e.latest.fix, null); e.tracker.stop();
});

test("the pickup boundary includes uncertainty and freshness, including points across the dateline", () => {
  const now = Date.now(), fix = { ...point, accuracy: 10, captured_at: new Date(now).toISOString() };
  assert.equal(pickupAllowed(fix, point, now), true);
  assert.equal(pickupAllowed(fix, { ...point, latitude: point.latitude + .004 }, now), true);
  assert.equal(pickupAllowed({ ...fix, accuracy: 100 }, { ...point, latitude: point.latitude + .004 }, now), false);
  assert.equal(pickupAllowed(fix, { ...point, latitude: point.latitude + .005 }, now), false);
  assert.equal(pickupAllowed(fix, point, now + 31000), false);
  assert.equal(freshFix({ ...fix, latitude: NaN }, now), false);
  assert.equal(freshFix({ ...fix, captured_at: "bad date" }, now), false);
  assert.equal(freshFix(fix, now - 6000), false);
  assert.ok(distanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 }) < 223);
});

test("continuous GPS emits first fix immediately then latest every 10s, and detaches when hidden or revoked", async () => {
  let now = Date.now(), tick, id = 0;
  const states = [], watches = [], cleared = [];
  const document = new EventTarget(); document.visibilityState = "visible";
  const permission = new EventTarget(); permission.state = "granted";
  const tracker = trackDriverLocation(value => states.push(value), { document,
    navigator: { permissions: { query: async () => permission }, geolocation: {
      watchPosition: (...args) => { watches.push(args); return ++id; }, clearWatch: value => cleared.push(value),
    } }, now: () => now, interval: cb => { tick = cb; return 1; }, clear: () => {},
  });
  await Promise.resolve();
  const send = (n, latitude) => watches[n][0]({ coords: { ...point, latitude, accuracy: 10 }, timestamp: now });
  send(0, 43.2); assert.equal(states.at(-1).fix.latitude, 43.2);
  now += 1000; send(0, 43.21); send(0, 43.22);
  assert.equal(states.at(-1).fix.latitude, 43.2);
  now += 9000; tick(); assert.equal(states.at(-1).fix.latitude, 43.22);
  document.visibilityState = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(cleared, [1]); assert.equal(states.at(-1).status, "paused");
  send(0, 44); assert.equal(states.at(-1).fix, null);
  document.visibilityState = "visible"; document.dispatchEvent(new Event("visibilitychange"));
  send(1, 43.3); assert.equal(states.at(-1).status, "ready");
  permission.state = "denied"; permission.dispatchEvent(new Event("change"));
  send(1, 44); assert.equal(states.at(-1).status, "denied"); assert.deepEqual(cleared, [1,2]);
  tracker.stop();
});
