import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({ entryPoints: [fileURLToPath(new URL("./startupDeadline.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", write: false });
const { watchCityStartup } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

function clock(hidden = false) {
  let now = 0, sequence = 0;
  const timers = new Map(), events = new EventTarget();
  events.hidden = hidden;
  const runtime = {
    now: () => now, visibility: events,
    schedule(callback, delay) { const id = ++sequence; timers.set(id, { callback, due: now + delay }); return id; },
    unschedule: id => timers.delete(id),
  };
  return { runtime, timers,
    hidden(value) { events.hidden = value; events.dispatchEvent(new Event("visibilitychange")); },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due; timers.delete(next[0]); next[1].callback();
      }
      now = target;
    },
  };
}

test("a stalled visible city reaches a terminal timeout once", () => {
  const c = clock(); let failures = 0;
  watchCityStartup(() => failures++, 50000, c.runtime);
  c.advance(49999); assert.equal(failures, 0);
  c.advance(1); assert.equal(failures, 1);
  c.advance(50000); c.hidden(true); c.hidden(false);
  assert.equal(failures, 1); assert.equal(c.timers.size, 0);
});

test("a background browser tab keeps the entire first-frame budget", () => {
  const c = clock(true); let failures = 0;
  watchCityStartup(() => failures++, 100, c.runtime);
  c.advance(10000); assert.equal(c.timers.size, 0); assert.equal(failures, 0);
  c.hidden(false); c.advance(99); assert.equal(failures, 0);
  c.advance(1); assert.equal(failures, 1);
});

test("switching browser tabs pauses rather than resets the remaining budget", () => {
  const c = clock(); let failures = 0;
  watchCityStartup(() => failures++, 100, c.runtime);
  c.advance(30); c.hidden(true); c.advance(10000); c.hidden(false);
  c.advance(69); assert.equal(failures, 0);
  c.advance(1); assert.equal(failures, 1);
});

test("ready, failed and unmounted maps cancel all later timeout work", () => {
  const c = clock(); let failures = 0;
  const stop = watchCityStartup(() => failures++, 100, c.runtime);
  c.advance(30); stop(); stop(); c.hidden(true); c.hidden(false); c.advance(10000);
  assert.equal(failures, 0); assert.equal(c.timers.size, 0);
});
