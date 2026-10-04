import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  entryPoints: [fileURLToPath(new URL('./loop.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { createLoop, MAX_DT } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

/** A browser clock: each advance delivers only the callbacks queued before that vsync. */
function browser(t, { hidden = false, intersection = true } = {}) {
  const saved = new Map(['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'IntersectionObserver'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const queue = new Map(), observers = [], loops = [], listeners = new Set();
  let id = 0;
  const document = new EventTarget();
  document.hidden = hidden;
  const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
  document.addEventListener = (type, callback) => { listeners.add(callback); add(type, callback); };
  document.removeEventListener = (type, callback) => { listeners.delete(callback); remove(type, callback); };
  class Observer {
    disconnected = false;
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(host) { this.host = host; }
    disconnect() { this.disconnected = true; }
  }
  Object.assign(globalThis, {
    document,
    requestAnimationFrame(callback) { const next = id++; queue.set(next, callback); return next; },
    cancelAnimationFrame(handle) { queue.delete(handle); },
    IntersectionObserver: intersection ? Observer : undefined,
  });
  t.after(() => {
    for (const loop of loops) loop.dispose();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  return {
    queue, observers, listeners,
    create(options = {}) {
      const rendered = [], gaps = [], host = {};
      const loop = createLoop({ host, fps: () => 60, render: (dt, now) => rendered.push({ dt, now }), onGap: (gap, now) => gaps.push({ gap, now }), ...options });
      loops.push(loop);
      return { loop, rendered, gaps, host };
    },
    advance(now) {
      for (const [handle, callback] of [...queue]) {
        if (!queue.delete(handle)) continue;
        callback(now);
      }
    },
    hide(value) { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
    intersect(value) { for (const observer of observers) if (!observer.disconnected) observer.callback([{ target: observer.host, isIntersecting: value }]); },
  };
}

test('the default loop draws every vsync, clamps real stalls and supports a zero RAF handle', t => {
  const b = browser(t), { loop, rendered, gaps } = b.create();
  assert.equal(loop.running, true, 'RAF handle 0 is still a pending frame');
  for (const now of [100, 116, 616]) b.advance(now);
  assert.deepEqual(rendered, [{ dt: 1 / 60, now: 100 }, { dt: .016, now: 116 }, { dt: MAX_DT, now: 616 }]);
  assert.deepEqual(gaps.map(frame => frame.gap), [Infinity, 16, 500], 'only deliberate pauses are excluded from measurement');
  assert.equal(b.queue.size, 1);
});

test('an initially inactive city cannot wake from visibility or intersection events', t => {
  const b = browser(t), { loop, rendered } = b.create({ active: false });
  assert.equal(loop.running, false);
  for (const visible of [false, true, false, true]) { b.hide(!visible); b.intersect(visible); b.advance(100); }
  assert.equal(b.queue.size, 0);
  assert.deepEqual(rendered, []);
  loop.setActive(true);
  loop.setActive(true);
  assert.equal(b.queue.size, 1, 'repeated activation is idempotent');
  b.advance(5000);
  assert.deepEqual(rendered, [{ dt: 1 / 60, now: 5000 }]);
});

test('manual pause cancels all frames and resume excludes hidden time from dt and quality', t => {
  const b = browser(t), { loop, rendered, gaps } = b.create();
  b.advance(0); b.advance(16);
  loop.setActive(false);
  assert.equal(loop.running, false);
  assert.equal(b.queue.size, 0);
  b.hide(true); b.hide(false); b.intersect(false); b.intersect(true);
  b.advance(60000);
  assert.equal(rendered.length, 2);
  loop.setActive(true);
  b.advance(60016);
  loop.setActive(true);
  b.advance(60032);
  assert.deepEqual(gaps.map(frame => frame.gap), [Infinity, 16, Infinity, 16]);
  assert.deepEqual(rendered.map(frame => frame.dt), [1 / 60, .016, 1 / 60, .016]);
});

test('activation waits for both document and host visibility, in either event order', t => {
  const b = browser(t, { hidden: true }), { loop, rendered, gaps } = b.create({ active: false });
  b.intersect(false);
  loop.setActive(true);
  b.hide(false);
  assert.equal(loop.running, false, 'the host is still out of view');
  b.intersect(true); b.advance(100);
  b.hide(true); b.intersect(false); b.intersect(true);
  assert.equal(loop.running, false, 'the document is still hidden');
  b.hide(false); b.advance(100000);
  b.intersect(false); b.advance(100016);
  assert.equal(rendered.length, 2, 'scrolling the host away cancels its pending frame');
  b.intersect(true); b.advance(200000);
  assert.deepEqual(gaps.map(frame => frame.gap), [Infinity, Infinity, Infinity]);
});

test('the existing 30 FPS cap and runtime cap changes still use drawn-frame intervals', t => {
  let fps = 30;
  const b = browser(t), { rendered, gaps } = b.create({ fps: () => fps });
  for (let i = 0; i <= 60; i++) b.advance(i * 1000 / 60);
  assert.equal(rendered.length, 31);
  for (const { gap } of gaps.slice(1)) assert.ok(Math.abs(gap - 1000 / 30) < 1e-9);
  fps = 60;
  b.advance(1016); b.advance(1032);
  assert.equal(rendered.length, 33);
  assert.deepEqual(gaps.slice(-2).map(frame => frame.gap), [16, 16]);
});

test('pausing or disposing inside a frame cannot resurrect its RAF chain', t => {
  const b = browser(t);
  for (const action of ['pause', 'dispose']) {
    let draws = 0, loop;
    ({ loop } = b.create({ render() { draws++; action === 'pause' ? loop.setActive(false) : loop.dispose(); } }));
    b.advance(100);
    assert.equal(loop.running, false);
    assert.equal(b.queue.size, 0);
    b.advance(116);
    assert.equal(draws, 1);
  }
  let loop, draws = 0;
  ({ loop } = b.create({ onGap() { loop.setActive(false); }, render() { draws++; } }));
  b.advance(200);
  assert.equal(draws, 0, 'deactivation from the quality callback also prevents rendering');
  assert.equal(b.queue.size, 0);
});

test('a thrown frame reports failure once and stops RAF, visibility and intersection from restarting it', t => {
  const b = browser(t), failure = new Error('shader failed'), errors = [];
  const { loop } = b.create({ render() { throw failure; }, onError(error) { errors.push(error); } });
  b.advance(100);
  assert.deepEqual(errors, [failure]); assert.equal(loop.running, false); assert.equal(b.queue.size, 0);
  b.hide(true); b.hide(false); b.intersect(false); b.intersect(true); b.advance(1000);
  assert.deepEqual(errors, [failure]); assert.equal(b.queue.size, 0);
});

test('failures from quality measurement also report before rendering and cannot revive a disposed loop', t => {
  const b = browser(t), failure = new Error('quality failed'), errors = [];
  let draws = 0, loop;
  ({ loop } = b.create({ onGap() { throw failure; }, render() { draws++; }, onError(error) { errors.push(error); loop.dispose(); } }));
  b.advance(100); loop.setActive(true); b.hide(false); b.advance(116);
  assert.deepEqual(errors, [failure]); assert.equal(draws, 0); assert.equal(b.queue.size, 0);
});

test('a pause and resume inside rendering queues only one fresh frame', t => {
  const b = browser(t), gaps = [];
  let loop, draws = 0;
  ({ loop } = b.create({ onGap(gap) { gaps.push(gap); }, render() { if (++draws === 1) { loop.setActive(false); loop.setActive(true); } } }));
  b.advance(100);
  assert.equal(b.queue.size, 1);
  b.advance(116);
  assert.equal(draws, 2);
  assert.deepEqual(gaps, [Infinity, Infinity]);
  assert.equal(b.queue.size, 1);
});

test('dispose removes visibility hooks and cannot be reversed by activation or late observer callbacks', t => {
  const b = browser(t), { loop, host, rendered } = b.create();
  assert.equal(b.observers[0].host, host);
  loop.dispose(); loop.dispose();
  assert.equal(b.listeners.size, 0);
  assert.equal(b.observers[0].disconnected, true);
  loop.setActive(true);
  b.hide(true); b.hide(false);
  b.observers[0].callback([{ isIntersecting: true }]);
  b.observers[0].callback([]);
  b.advance(100);
  assert.equal(b.queue.size, 0);
  assert.deepEqual(rendered, []);
});

test('manual and document pausing also work when IntersectionObserver is unavailable', t => {
  const b = browser(t, { intersection: false }), { loop, rendered } = b.create();
  loop.setActive(false);
  assert.equal(b.queue.size, 0, 'even the initial RAF handle 0 is canceled');
  b.hide(true); loop.setActive(true);
  assert.equal(loop.running, false);
  b.hide(false); b.advance(100);
  assert.equal(rendered.length, 1);
});
