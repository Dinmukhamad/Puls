import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const built = await transform(readFileSync(new URL("./workSiteTours.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm" });
const { seenTour, browserOnly, queueTourSave } = await import(`data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`);
const page = readFileSync(new URL("./WorkSitesPage.tsx", import.meta.url), "utf8");

test("a walk seen on any device, or in this browser before, does not start by itself", () => {
  assert.equal(seenTour({ oktell: "closed" }, "oktell", null), true);
  assert.equal(seenTour(null, "oktell", "done"), true);
  assert.equal(seenTour({ fleet: "done" }, "oktell", null), false);
  assert.equal(seenTour(undefined, "fleet", null), false);
});

test("this browser's old records move to the account once, and never undo a finished walk", () => {
  assert.deepEqual(browserOnly(null, { fleet: "done", oktell: "closed", appeals: null }), [["fleet", "done"], ["oktell", "closed"]]);
  assert.deepEqual(browserOnly({ fleet: "done", oktell: "closed" }, { fleet: "closed", oktell: "closed" }), []);
  assert.deepEqual(browserOnly({ oktell: "closed" }, { oktell: "done" }), [["oktell", "done"]]);
});

test("saves go one at a time, and a failed one does not stop the next", async () => {
  const order = [];
  let release;
  const first = queueTourSave(() => new Promise((resolve) => { release = () => { order.push("first"); resolve(1); }; }));
  const second = queueTourSave(async () => { order.push("second"); throw new Error("offline"); });
  const third = queueTourSave(async () => { order.push("third"); return 3; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(order, []);
  release();
  assert.equal(await first, 1);
  await assert.rejects(second);
  assert.equal(await third, 3);
  assert.deepEqual(order, ["first", "second", "third"]);
});

test("the work sites start Oktell's and the Диспетчерская's walks once per account and not after training there", () => {
  assert.match(page, /seenTour\(user\?\.tours_seen, "fleet", browserTour\("fleet"\)\) \|\| fleetQuery\.data\.calls\.some\(call => call\.state === "solved"\)/);
  assert.match(page, /seenTour\(user\?\.tours_seen, "oktell", browserTour\("oktell"\)\) \|\| oktellState\.completed\.length > 0/);
  assert.match(page, /rememberTour\("fleet", "closed"\); startFleetTour\("fleet"\);/);
  assert.match(page, /rememberTour\("oktell", "closed"\); setCoach\(\{ id: "oktell", steps: OKTELL_TOUR \}\);/);
  assert.match(page, /if \(current\) rememberTour\(current\.id, finished \? "done" : "closed"\);/);
  assert.match(page, /queueTourSave\(\(\) => authApi\.tourSeen\(tour, state\)\)/);
});
