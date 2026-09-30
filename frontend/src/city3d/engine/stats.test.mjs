import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  entryPoints: [fileURLToPath(new URL('./stats.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'telemetry-spy', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/\.\.\/api\/client$/ }, () => ({ path: 'client', namespace: 'telemetry-spy' }));
    builder.onLoad({ filter: /.*/, namespace: 'telemetry-spy' }, () => ({ contents: 'export const request = (...args) => globalThis.__cityTelemetry(...args);', loader: 'js' }));
  } }],
});
const { createStats, TELEMETRY_PATH } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

function setup(t, options = {}) {
  const saved = new Map(['window', 'document', 'performance', '__cityTelemetry'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const timers = new Map(), requests = [], elements = [], hooks = new Set();
  let now = 0, id = 0, writes = 0, refreshes = 0;
  class Target extends EventTarget {
    addEventListener(type, callback) { hooks.add(callback); super.addEventListener(type, callback); }
    removeEventListener(type, callback) { hooks.delete(callback); super.removeEventListener(type, callback); }
  }
  const window = Object.assign(new Target(), {
    setInterval(callback, every) { const handle = id++; timers.set(handle, { callback, every, next: now + every }); return handle; },
    clearInterval(handle) { timers.delete(handle); },
  });
  const document = Object.assign(new Target(), {
    visibilityState: 'visible',
    createElement() {
      const element = { style: {}, textContent: '', removed: false, setAttribute() {}, remove() { this.removed = true; } };
      elements.push(element);
      return element;
    },
  });
  const host = { dataset: new Proxy({}, { set(target, key, value) { writes++; target[key] = value; return true; } }), clientWidth: 1000, clientHeight: 700, append() {} };
  const renderer = { info: { render: { drawCalls: 24, triangles: 40000 }, memory: { geometries: 12, textures: 8 } }, getPixelRatio: () => 1.5 };
  Object.assign(globalThis, { window, document, performance: { now: () => now }, __cityTelemetry(path, request) { requests.push({ path, ...request }); return Promise.resolve(); } });
  const stats = createStats({ renderer, host, backend: 'webgpu', visible: true, userIdKnown: true, gpu: 'test-gpu', quality: { settings: { tier: 'high', fps: 60 }, concessions: [] }, extra() { refreshes++; return 'test'; }, ...options });
  t.after(() => {
    stats.dispose();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  function advance(to) {
    assert.ok(to >= now, 'the fake clock must not run backwards');
    while (timers.size) {
      const next = Math.min(...[...timers.values()].map(timer => timer.next));
      if (next > to) break;
      now = next;
      for (const [handle, timer] of [...timers]) {
        if (timer.next !== next || !timers.has(handle)) continue;
        timer.next += timer.every;
        timer.callback();
      }
    }
    now = to;
  }
  function frame(at, cpu = 2) { advance(at); stats.beginFrame(); advance(at + cpu); stats.endFrame(); }
  function frames(count, start = now + 20, gap = 20) { for (let i = 0; i < count; i++) frame(start + i * gap); }
  return { stats, host, renderer, timers, requests, hooks, elements, advance, frame, frames,
    get now() { return now; }, get writes() { return writes; }, get refreshes() { return refreshes; },
    hide() { document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); },
    pagehide() { window.dispatchEvent(new Event('pagehide')); },
  };
}

test('pausing stops both intervals, sends one eligible report and performs no background work', t => {
  const b = setup(t);
  assert.deepEqual([...b.timers.values()].map(timer => timer.every), [1000, 60000]);
  const queued = [...b.timers.values()].map(timer => timer.callback);
  b.frames(31, 100);
  b.stats.setActive(false); b.stats.setActive(false);
  assert.equal(b.timers.size, 0, 'the overlay timer with handle 0 is canceled too');
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].path, TELEMETRY_PATH);
  assert.equal(b.requests[0].method, 'POST');
  assert.equal(b.requests[0].json.fps_avg, 50);
  assert.equal(b.requests[0].json.fps_p1, 50);
  const writes = b.writes;
  b.advance(180000);
  b.stats.beginFrame(); b.stats.endFrame(); b.stats.markFirstFrame();
  for (const callback of queued) callback();
  b.hide(); b.pagehide();
  assert.equal(b.writes, writes, 'neither timers nor late callbacks update a detached host');
  assert.equal(b.refreshes, 0);
  assert.equal(b.requests.length, 1, 'visibility, pagehide and repeated pause do not duplicate the flush');
});

test('resume starts one pair of fresh timers and preserves the displayed first-frame measurement', t => {
  const b = setup(t);
  b.frame(100); b.stats.markFirstFrame();
  b.frames(30);
  b.stats.setActive(false);
  assert.equal(b.requests[0].json.first_frame_ms, 102);
  b.advance(120000);
  b.stats.setActive(true); b.stats.setActive(true);
  assert.equal(b.timers.size, 2);
  assert.deepEqual([...b.timers.values()].map(timer => timer.next), [121000, 180000]);
  b.frames(31, 120100);
  b.stats.markFirstFrame();
  b.advance(121000);
  assert.equal(b.host.dataset.fps, '50');
  assert.equal(b.host.dataset.drawCalls, '24');
  assert.equal(b.host.dataset.triangles, '40000');
  assert.match(b.elements[0].textContent, /first frame 102 ms/);
  b.stats.setActive(false);
  assert.equal(b.requests.length, 2);
  assert.equal(b.requests[1].json.first_frame_ms, 102);
  assert.equal(b.requests[1].json.fps_avg, 50);
});

test('short visits retain useful samples but never count the pause as a frame or reuse recent FPS', t => {
  const b = setup(t);
  b.frames(16, 100, 20); // 15 measured gaps at 50 FPS, below the report threshold.
  b.stats.setActive(false);
  assert.equal(b.requests.length, 0, 'MIN_FRAMES is unchanged');
  b.advance(600); // Less than MAX_GAP: without resetting previous this pause would be counted.
  b.stats.setActive(true);
  b.frames(16, 620, 40); // 15 measured gaps at 25 FPS.
  b.advance(1600);
  assert.equal(b.host.dataset.fps, '25', 'the overlay contains only frames after resuming');
  b.stats.setActive(false);
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].json.fps_avg, 33.3, 'the report combines 30 active gaps, not the pause');
  assert.equal(b.requests[0].json.fps_p1, 25);
});

test('active reporting still runs every minute and does not resend its last sample at pause', t => {
  const b = setup(t);
  b.frames(31, 100);
  b.advance(60000);
  assert.equal(b.requests.length, 1);
  assert.equal(b.refreshes, 60);
  assert.equal(b.requests[0].json.fps_avg, 50);
  b.stats.setActive(false);
  b.stats.dispose();
  assert.equal(b.requests.length, 1);
});

test('pause during a frame drops its unfinished CPU sample instead of charging inactive time', t => {
  const b = setup(t);
  b.advance(100); b.stats.beginFrame();
  b.stats.setActive(false);
  b.advance(5000); b.stats.setActive(true);
  b.stats.endFrame();
  b.frames(31, 5100);
  b.advance(6000);
  const cpu = Number(b.elements[0].textContent.match(/CPU ([\d.]+) ms/)[1]);
  assert.ok(cpu >= 2 && cpu < 2.2, `only the normal 2 ms frames contribute CPU time, got ${cpu} ms`);
  b.stats.setActive(false);
  assert.equal(b.requests[0].json.fps_avg, 50);
});

test('dispose after pause removes hooks, overlay and datasets and cannot restart timers', t => {
  const b = setup(t);
  b.frames(31, 100); b.advance(1000);
  assert.equal(b.hooks.size, 2);
  assert.ok(Object.keys(b.host.dataset).length > 0);
  b.stats.setActive(false); b.stats.dispose(); b.stats.dispose(); b.stats.setActive(true);
  assert.equal(b.timers.size, 0);
  assert.equal(b.hooks.size, 0);
  assert.equal(b.elements[0].removed, true);
  assert.deepEqual(b.host.dataset, {});
  b.advance(180000); b.hide(); b.pagehide(); b.stats.beginFrame(); b.stats.endFrame(); b.stats.markFirstFrame();
  assert.equal(b.requests.length, 1);
  assert.deepEqual(b.host.dataset, {});
});

test('anonymous sessions pause without sending telemetry or creating an overlay', t => {
  const b = setup(t, { userIdKnown: false, visible: false });
  b.frames(31, 100); b.stats.setActive(false);
  assert.equal(b.requests.length, 0);
  assert.equal(b.timers.size, 0);
  b.stats.setActive(true); b.stats.setActive(false);
  assert.equal(b.timers.size, 0);
  assert.equal(b.elements.length, 0);
});

test('a telemetry rejection or synchronous failure cannot leave background timers running', async t => {
  const b = setup(t);
  for (const failure of [() => Promise.reject(new Error('offline')), () => { throw new Error('endpoint missing'); }]) {
    globalThis.__cityTelemetry = failure;
    b.stats.setActive(true); b.frames(31);
    assert.doesNotThrow(() => b.stats.setActive(false));
    assert.equal(b.timers.size, 0);
    await Promise.resolve();
  }
});
