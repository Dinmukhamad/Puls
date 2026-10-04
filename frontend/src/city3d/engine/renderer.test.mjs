import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  entryPoints: [fileURLToPath(new URL('./renderer.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'renderer-lifecycle-spy', setup(builder) {
    builder.onResolve({ filter: /^three\/webgpu$/ }, () => ({ path: 'three', namespace: 'renderer-spy' }));
    builder.onLoad({ filter: /.*/, namespace: 'renderer-spy' }, () => ({ loader: 'js', contents: `
      export class WebGPURenderer { constructor(options) { return globalThis.__cityRendererMocks.construct(options); } }
      export const SRGBColorSpace = 'srgb', ACESFilmicToneMapping = 'aces', PCFSoftShadowMap = 'pcf-soft';
    ` }));
  } }],
});
const { createRenderer, RENDERER_STARTUP_TIMEOUT_MS } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

/** A controllable browser GPU: init and each timer complete only when the test asks them to. */
function browser(t, { adapterInfo, webgpu = true, gl, onInit, restoreAdapter = () => Promise.resolve({}) } = {}) {
  const names = ['window', 'navigator', '__cityRendererMocks'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const timers = new Map(), renderers = [];
  let nextTimer = 0, adapters = 0;
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { devicePixelRatio: 3, setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id) } },
    navigator: { configurable: true, value: { gpu: { requestAdapter() { adapters++; return restoreAdapter(); } } } },
    __cityRendererMocks: { configurable: true, value: {
      construct(options) {
        const initialization = deferred();
        const renderer = {
          options, initialization, initialized: false, initCalls: 0, disposeCalls: 0, destroys: 0, defaultLosses: 0,
          shadowMap: {}, pixelRatios: [],
          backend: { isWebGPUBackend: webgpu, gl, ...(webgpu ? { device: { adapterInfo, destroy() { renderer.destroys++; } } } : {}) },
          init() {
            this.initCalls++;
            onInit?.(this);
            return initialization.promise.then(() => { this.initialized = true; });
          },
          dispose() { assert.equal(this.initialized, true, 'three dispose must not reenter a pending or rejected init'); this.disposeCalls++; },
          onDeviceLost() { this.defaultLosses++; },
          setPixelRatio(value) { this.pixelRatios.push(value); },
        };
        renderers.push(renderer);
        return renderer;
      },
    } },
  });
  const canvas = new EventTarget(), listeners = new Map();
  const add = canvas.addEventListener.bind(canvas), remove = canvas.removeEventListener.bind(canvas);
  canvas.addEventListener = (type, callback) => { listeners.set(callback, type); add(type, callback); };
  canvas.removeEventListener = (type, callback) => { listeners.delete(callback); remove(type, callback); };
  t.after(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  return {
    canvas, listeners, timers, renderers,
    get renderer() { return renderers.at(-1); },
    get adapters() { return adapters; },
    runTimer(delay) {
      const found = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(found, `a ${delay}ms timer is pending`);
      timers.delete(found[0]); found[1].callback();
    },
  };
}

test('a stalled native init exits on a bounded timeout and frees its late success exactly once', async t => {
  const b = browser(t), starting = createRenderer(b.canvas);
  assert.equal(RENDERER_STARTUP_TIMEOUT_MS, 10_000);
  assert.equal(b.listeners.size, 1);
  const rejected = assert.rejects(starting, { name: 'TimeoutError' });
  b.runTimer(RENDERER_STARTUP_TIMEOUT_MS);
  await rejected;
  assert.equal(b.listeners.size, 0);
  assert.equal(b.timers.size, 0);
  assert.equal(b.renderer.disposeCalls, 0, 'dispose cannot interrupt the browser GPU request safely');
  b.renderer.initialization.resolve();
  await flush();
  assert.equal(b.renderer.disposeCalls, 1);
  assert.equal(b.renderer.destroys, 1);
  assert.equal(b.renderer.initCalls, 1);
  assert.deepEqual(b.renderer.pixelRatios, [], 'a stale renderer is never configured or exposed');
});

test('canceling an in-flight city init rejects promptly and cleans its late GPU allocation', async t => {
  const b = browser(t), controller = new AbortController();
  const reason = new DOMException('Replaced city', 'AbortError');
  const starting = createRenderer(b.canvas, { signal: controller.signal });
  const rejected = assert.rejects(starting, error => error === reason);
  controller.abort(reason);
  await rejected;
  assert.equal(b.listeners.size, 0);
  assert.equal(b.timers.size, 0);
  assert.equal(b.renderer.disposeCalls, 0);
  b.renderer.initialization.resolve();
  await flush();
  assert.equal(b.renderer.disposeCalls, 1);
  assert.equal(b.renderer.destroys, 1);
});

test('an already canceled generation never constructs or initializes a renderer', async t => {
  const b = browser(t), controller = new AbortController();
  controller.abort();
  await assert.rejects(createRenderer(b.canvas, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(b.renderers.length, 0);
  assert.equal(b.listeners.size, 0);
  assert.equal(b.timers.size, 0);
});

test('cancellation during a synchronous init hook is not missed', async t => {
  const controller = new AbortController();
  const b = browser(t, { onInit: () => controller.abort() });
  await assert.rejects(createRenderer(b.canvas, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(b.timers.size, 0);
  b.renderer.initialization.resolve();
  await flush();
  assert.equal(b.renderer.disposeCalls, 1);
});

test('native initialization failure and a late failure after timeout never reenter init or dispose', async t => {
  const b = browser(t);
  for (const timeout of [false, true]) {
    const error = new Error('No graphics backend');
    const starting = createRenderer(b.canvas), renderer = b.renderer;
    const rejected = assert.rejects(starting, timeout ? { name: 'TimeoutError' } : failure => failure === error);
    if (timeout) b.runTimer(RENDERER_STARTUP_TIMEOUT_MS); else renderer.initialization.reject(error);
    await rejected;
    if (timeout) { renderer.initialization.reject(error); await flush(); }
    assert.equal(renderer.disposeCalls, 0);
    assert.equal(renderer.initCalls, 1);
    assert.equal(renderer.destroys, 1, 'a device allocated before final init failure is still released');
    assert.equal(b.timers.size, 0);
    assert.equal(b.listeners.size, 0);
  }
});

test('successful WebGL fallback frees the replaced GPU device without reporting a lost active backend', async t => {
  const b = browser(t), starting = createRenderer(b.canvas), renderer = b.renderer;
  const originalDevice = renderer.backend.device;
  const destroy = originalDevice.destroy;
  originalDevice.destroy = () => {
    destroy();
    queueMicrotask(() => renderer.onDeviceLost({ api: 'WebGPU', reason: 'destroyed' }));
  };
  renderer.backend = { isWebGPUBackend: false };
  renderer.initialization.resolve();
  const handle = await starting;
  let losses = 0;
  handle.onLost(() => losses++);
  await flush();
  assert.equal(handle.backend, 'webgl2');
  assert.equal(renderer.destroys, 1, 'the discarded WebGPU backend is no longer renderer.backend');
  assert.equal(renderer.disposeCalls, 0, 'the fallback renderer remains usable');
  assert.equal(renderer.defaultLosses, 0);
  assert.equal(losses, 0);
  assert.equal(b.timers.size, 0);
  handle.dispose(); handle.dispose();
  assert.equal(renderer.destroys, 1, 'final disposal does not destroy the original device again');
  assert.equal(renderer.disposeCalls, 1);
});

test('a fallback failure releases distinct original and current devices, including after timeout', async t => {
  const b = browser(t);
  for (const timeout of [false, true]) {
    const starting = createRenderer(b.canvas), renderer = b.renderer;
    let currentDestroys = 0;
    renderer.backend = { isWebGPUBackend: true, device: { destroy() { currentDestroys++; } } };
    const rejected = assert.rejects(starting, timeout ? { name: 'TimeoutError' } : { message: 'Fallback failed after allocation' });
    if (timeout) {
      b.runTimer(RENDERER_STARTUP_TIMEOUT_MS);
      await rejected;
      assert.equal(renderer.destroys, 0, 'a pending original initialization may still use its device');
      assert.equal(currentDestroys, 0);
    }
    renderer.initialization.reject(new Error('Fallback failed after allocation'));
    if (timeout) await flush(); else await rejected;
    assert.equal(renderer.destroys, 1);
    assert.equal(currentDestroys, 1);
    assert.equal(renderer.disposeCalls, 0);
    assert.equal(renderer.initCalls, 1);
    assert.equal(b.timers.size, 0);
    assert.equal(b.listeners.size, 0);
  }
});

test('a replacement backend referencing the same device releases it only once on final failure', async t => {
  const b = browser(t), starting = createRenderer(b.canvas), renderer = b.renderer;
  renderer.backend = { isWebGPUBackend: true, device: renderer.backend.device };
  const rejected = assert.rejects(starting, { message: 'Shared device failed' });
  renderer.initialization.reject(new Error('Shared device failed'));
  await rejected;
  assert.equal(renderer.destroys, 1);
  assert.equal(renderer.disposeCalls, 0);
});

test('GPU telemetry uses the active device and never requests another adapter', async t => {
  const b = browser(t, { adapterInfo: { vendor: 'NVIDIA', architecture: 'ampere', device: '', description: 'Laptop GPU' } });
  const starting = createRenderer(b.canvas, { mobile: true });
  b.renderer.initialization.resolve();
  const handle = await starting;
  assert.equal(handle.backend, 'webgpu');
  assert.equal(handle.gpu, 'NVIDIA ampere Laptop GPU');
  assert.equal(b.adapters, 0);
  assert.equal(b.timers.size, 0);
  assert.equal(b.renderer.options.powerPreference, 'low-power');
  assert.deepEqual(b.renderer.pixelRatios, [1.5]);
  handle.dispose(); handle.dispose();
  assert.equal(b.renderer.disposeCalls, 1);
  assert.equal(b.renderer.destroys, 1);
  assert.equal(b.listeners.size, 0);
});

test('missing adapterInfo cannot block startup on an optional second GPU lookup', async t => {
  const b = browser(t, { restoreAdapter: () => new Promise(() => {}) });
  const starting = createRenderer(b.canvas);
  b.renderer.initialization.resolve();
  const handle = await starting;
  assert.equal(handle.gpu, '');
  assert.equal(b.adapters, 0);
  handle.dispose();
});

test('WebGL fallback reports the real GPU and disposal does not emit device loss', async t => {
  const gl = { RENDERER: 'renderer', getParameter: name => name === 'renderer' ? 'WebKit WebGL' : 'Intel Iris', getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 'unmasked' }) };
  const b = browser(t, { webgpu: false, gl });
  const starting = createRenderer(b.canvas, { forceWebGL: true });
  b.renderer.initialization.resolve();
  const handle = await starting;
  assert.equal(handle.backend, 'webgl2');
  assert.equal(handle.gpu, 'Intel Iris');
  assert.equal(b.renderer.options.forceWebGL, true);
  let losses = 0;
  handle.onLost(() => losses++);
  handle.dispose();
  b.renderer.onDeviceLost({ api: 'WebGL', reason: 'destroyed' });
  assert.equal(losses, 0);
  assert.equal(b.timers.size, 0);
});

test('GPU loss and WebGL restoration fire once and queued subscribers cannot outlive disposal', async t => {
  const b = browser(t, { webgpu: false });
  const starting = createRenderer(b.canvas);
  b.renderer.initialization.resolve();
  const handle = await starting;
  let losses = 0, restores = 0;
  handle.onLost(() => losses++); handle.onRestored(() => restores++);
  b.renderer.onDeviceLost({ api: 'WebGL' }); b.renderer.onDeviceLost({ api: 'WebGL' });
  b.canvas.dispatchEvent(new Event('webglcontextrestored')); b.canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(losses, 1); assert.equal(restores, 1);
  assert.equal(b.renderer.defaultLosses, 1);
  const unsubscribe = handle.onLost(() => losses++);
  unsubscribe();
  handle.onRestored(() => restores++);
  handle.dispose(); await flush();
  assert.equal(losses, 1); assert.equal(restores, 1);
  assert.equal(b.listeners.size, 0);
});
