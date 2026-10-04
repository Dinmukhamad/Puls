import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("./cityRouteLoader.ts", import.meta.url), "utf8");
const built = await transform(source, { loader: "ts", format: "esm" });
const { CITY_ROUTE_LOAD_TIMEOUT, createCityRouteLoader } = await import(`data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`);

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup(importModule) {
  let now = 0, serial = 0;
  const timers = new Map(), requests = [];
  const clock = {
    setTimeout(callback, delay) { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const loader = createCityRouteLoader(importModule ?? (() => {
    const request = deferred(); requests.push(request); return request.promise;
  }), { clock });
  return { loader, requests, timers,
    visit() { const states = []; return { states, stop: loader.subscribe(state => states.push(state)) }; },
    advance(delay) {
      now += delay;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
  };
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }

test("a hung import stops loading after 30 seconds and a retry receives a fresh deadline", async () => {
  const s = setup(), first = s.visit();
  assert.equal(CITY_ROUTE_LOAD_TIMEOUT, 30_000);
  s.advance(29_999);
  assert.deepEqual(first.states, [{ status: "loading" }]);
  s.advance(1);
  assert.deepEqual(first.states.at(-1), { status: "error", reason: "timeout" });
  assert.equal(s.timers.size, 0);
  first.stop();
  const retry = s.visit();
  assert.equal(s.requests.length, 2);
  s.advance(29_999);
  assert.deepEqual(retry.states, [{ status: "loading" }]);
  s.requests[1].resolve("city-page"); await settle();
  assert.deepEqual(retry.states.at(-1), { status: "ready", value: "city-page" });
  assert.equal(s.timers.size, 0);
});

test("import rejection is handled immediately and is not cached across retries", async () => {
  const s = setup(), first = s.visit();
  s.requests[0].reject(new TypeError("Failed to fetch dynamically imported module")); await settle();
  assert.deepEqual(first.states, [{ status: "loading" }, { status: "error", reason: "failed" }]);
  assert.equal(s.timers.size, 0);
  first.stop();
  const retry = s.visit();
  assert.equal(s.requests.length, 2);
  s.requests[1].resolve("city-page"); await settle();
  assert.deepEqual(retry.states.at(-1), { status: "ready", value: "city-page" });
});

test("synchronous loader failures offer a retry and leave no active timer", async () => {
  let calls = 0;
  const s = setup(() => { if (++calls === 1) throw new Error("Unavailable import"); return Promise.resolve("city-page"); });
  const first = s.visit();
  assert.deepEqual(first.states.at(-1), { status: "error", reason: "failed" });
  assert.equal(s.timers.size, 0);
  first.stop();
  const retry = s.visit(); await settle();
  assert.deepEqual(retry.states.at(-1), { status: "ready", value: "city-page" });
  assert.equal(calls, 2);
});

test("a successful return renders from the module cache without another import or loading state", async () => {
  const s = setup(), first = s.visit(), CityPage = () => {};
  s.requests[0].resolve(CityPage); await settle();
  first.stop();
  assert.deepEqual(s.loader.peek(), { status: "ready", value: CityPage });
  const returning = s.visit();
  assert.deepEqual(returning.states, [{ status: "ready", value: CityPage }]);
  assert.equal(s.requests.length, 1);
  assert.equal(s.timers.size, 0);
  returning.stop();
});

test("leaving during load clears the timer and late completion cannot reach the unmounted route", async () => {
  const s = setup(), first = s.visit();
  first.stop(); first.stop();
  assert.equal(s.timers.size, 0);
  s.requests[0].resolve("abandoned-page"); await settle();
  assert.deepEqual(first.states, [{ status: "loading" }]);
  assert.deepEqual(s.loader.peek(), { status: "loading" });
  const returning = s.visit();
  assert.equal(s.requests.length, 2);
  s.requests[1].resolve("current-page"); await settle();
  assert.deepEqual(returning.states.at(-1), { status: "ready", value: "current-page" });
});

test("a late timed-out import cannot overwrite a retry or its successful cache", async () => {
  const s = setup(), first = s.visit();
  s.advance(CITY_ROUTE_LOAD_TIMEOUT);
  const retry = s.visit();
  first.stop(); // A stale cleanup must not cancel the new attempt.
  assert.equal(s.timers.size, 1);
  s.requests[1].resolve("current-page"); await settle();
  s.requests[0].resolve("expired-page"); await settle();
  assert.deepEqual(first.states, [{ status: "loading" }, { status: "error", reason: "timeout" }]);
  assert.deepEqual(retry.states, [{ status: "loading" }, { status: "ready", value: "current-page" }]);
  assert.deepEqual(s.loader.peek(), { status: "ready", value: "current-page" });
});

test("late rejection after cancellation is consumed without changing the active visit", async () => {
  const s = setup(), first = s.visit();
  first.stop();
  const next = s.visit();
  s.requests[0].reject(new TypeError("Old chunk failed")); await settle();
  assert.deepEqual(next.states, [{ status: "loading" }]);
  assert.equal(s.timers.size, 1);
  s.requests[1].resolve("city-page"); await settle();
  assert.deepEqual(next.states.at(-1), { status: "ready", value: "city-page" });
});

test("concurrent subscribers share an import and one cleanup does not cancel another", async () => {
  const s = setup(), first = s.visit(), second = s.visit();
  assert.equal(s.requests.length, 1);
  assert.equal(s.timers.size, 1);
  first.stop();
  assert.equal(s.timers.size, 1);
  s.requests[0].resolve("city-page"); await settle();
  assert.deepEqual(first.states, [{ status: "loading" }]);
  assert.deepEqual(second.states, [{ status: "loading" }, { status: "ready", value: "city-page" }]);
  assert.equal(s.timers.size, 0);
});

test("development mount/cleanup/remount gives the current route a new bounded attempt", async () => {
  const s = setup(), first = s.visit();
  first.stop();
  const current = s.visit();
  s.requests[0].resolve("abandoned-page"); await settle();
  assert.deepEqual(current.states, [{ status: "loading" }]);
  assert.equal(s.timers.size, 1);
  s.requests[1].resolve("city-page"); await settle();
  assert.deepEqual(current.states.at(-1), { status: "ready", value: "city-page" });
});
