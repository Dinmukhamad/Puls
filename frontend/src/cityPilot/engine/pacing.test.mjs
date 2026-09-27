import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  entryPoints: [fileURLToPath(new URL('./pacing.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { FramePacer } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

function simulate(refreshRate, targetRate, seconds = 10) {
  const pacer = new FramePacer(targetRate);
  const rendered = [];
  const jitter = [-.1, .07, .1, -.04];
  for (let tick = 0; tick <= refreshRate * seconds; tick++) {
    const now = tick === 0 ? 0 : tick * 1000 / refreshRate + jitter[tick % jitter.length];
    if (pacer.shouldRender(now)) rendered.push(now);
  }
  return rendered;
}

function intervals(times) {
  return times.slice(1).map((time, index) => time - times[index]);
}

test('120 Hz with sub-millisecond jitter keeps 60 FPS and does not accumulate early-frame drift', () => {
  const times = simulate(120, 60, 60);
  assert.ok(Math.abs(times.length - 3601) <= 1, `${times.length} frames in 60 seconds`);
  for (const interval of intervals(times)) {
    assert.ok(interval > 16.4 && interval < 16.9, `unexpected render interval ${interval} ms`);
  }
});

test('60 Hz with jitter renders every frame at a 60 FPS target', () => {
  const times = simulate(60, 60);
  assert.equal(times.length, 601, 'a frame slightly earlier than its deadline must not fall into a 30 FPS gate');
  assert.ok(intervals(times).every(interval => interval > 16.4 && interval < 16.9));
});

test('144 Hz maintains a 60 FPS average using available display refreshes', () => {
  const times = simulate(144, 60);
  assert.ok(Math.abs(times.length - 601) <= 1, `${times.length} rendered frames`);
  const deltas = intervals(times);
  assert.ok(deltas.every(interval => interval > 13.6 && interval < 21.1));
  assert.ok(Math.abs(deltas.reduce((total, interval) => total + interval, 0) / deltas.length - 1000 / 60) < .03);
});

test('mobile 30 FPS pacing stays stable on both 60 Hz and 120 Hz displays', () => {
  for (const refreshRate of [60, 120]) {
    const times = simulate(refreshRate, 30);
    assert.ok(Math.abs(times.length - 301) <= 1);
    assert.ok(intervals(times).every(interval => interval > 33.1 && interval < 33.6));
  }
});

test('a long stall restarts one interval ahead without catch-up bursts; reset renders immediately', () => {
  const pacer = new FramePacer(60);
  assert.equal(pacer.shouldRender(0), true);
  assert.equal(pacer.shouldRender(5), false);
  assert.equal(pacer.shouldRender(5001), true);
  for (const now of [5001, 5002, 5005, 5010, 5016]) assert.equal(pacer.shouldRender(now), false);
  assert.equal(pacer.shouldRender(5017.3), true, 'small early tolerance survives after stall recovery');
  assert.equal(pacer.shouldRender(5025), false);
  assert.equal(pacer.shouldRender(5034.1), true);
  pacer.reset();
  assert.equal(pacer.shouldRender(4), true, 'reset drops the old timeline');
  assert.equal(pacer.shouldRender(5), false);
});

test('invalid input cannot poison the pacing clock', () => {
  for (const fps of [0, -30, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new FramePacer(fps), RangeError);
  }
  const pacer = new FramePacer(60);
  assert.equal(pacer.shouldRender(Number.NaN), false);
  assert.equal(pacer.shouldRender(0), true);
  assert.equal(pacer.shouldRender(Number.POSITIVE_INFINITY), false);
  assert.equal(pacer.shouldRender(16.6), true);
});
