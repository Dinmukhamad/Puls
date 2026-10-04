import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const entry = fileURLToPath(new URL('../index.ts', import.meta.url));
const factories = new Map([...readFileSync(entry, 'utf8').matchAll(/import\s+\{([^}]+)\}\s+from\s+"([^"]+)";/g)]
  .filter(([, , path]) => path.startsWith('./') && path !== './engine/loop')
  .map(([, names, path]) => [path, names.split(',').map(name => name.trim()).filter(name => !name.startsWith('type '))]));
const built = await build({
  stdin: { contents: `export { createCity } from ${JSON.stringify(entry)}; export * as THREE from "three/webgpu";`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error', loader: { '.css': 'empty' },
  define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'controlled-city-startup', setup(plugin) {
    plugin.onResolve({ filter: /.*/ }, args => args.importer === entry && factories.has(args.path) ? { path: args.path, namespace: 'startup-factories' } : undefined);
    plugin.onLoad({ filter: /.*/, namespace: 'startup-factories' }, args => ({
      contents: factories.get(args.path).map(name => `export function ${name}(...args) { return globalThis.__cityStartup.factory(${JSON.stringify(name)}, args); }`).join('\n'), loader: 'js',
    }));
  } }],
});
const { createCity, THREE } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class Element extends EventTarget {
  children = []; dataset = {}; clientWidth = 1280; clientHeight = 720; isConnected = true;
  replaceChildren(...children) { this.children = children; }
}

function fixture(t, { active = true, forceWebGL = false } = {}) {
  const names = ['document', 'window', 'ResizeObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', '__cityStartup'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const requests = [], modelRequests = [], disposals = [], events = [], frames = new Map(), timers = new Map();
  let id = 0, postFailure = null;
  const noop = () => {}, piece = (name, values = {}) => new Proxy({ dispose: () => disposals.push(name), ...values }, { get: (target, key) => key === 'then' ? undefined : key in target ? target[key] : noop });
  const document = new EventTarget(); document.hidden = false; document.createElement = () => new Element();
  const state = { compile: () => Promise.resolve(), factory(name, args) {
    if (state.failure === name) { state.failure = null; throw new Error(`${name} failed`); }
    if (name === 'createRenderer') {
      const request = { canvas: args[0], options: args[1], ...deferred() }; requests.push(request);
      const backend = request.options.forceWebGL ? 'webgl2' : 'webgpu';
      request.handle = piece(`renderer-${requests.length}`, { backend, gpu: 'test', renderer: piece('renderer-internal', { compileAsync: () => state.compile() }) });
      return request.promise.then(() => request.handle);
    }
    if (name === 'loadCatalogueModels') {
      const request = { options: args[1], ...deferred() }; modelRequests.push(request); return request.promise;
    }
    if (name === 'islandWorld') return { radius: 100, districts: [], placements: [], spec: { roadRings: [20] } };
    if (name === 'createCamera') return new THREE.PerspectiveCamera();
    if (name === 'createCameraRig') return piece(name, { currentView: () => ({ target: [0, 0, 0], distance: 90 }), update: () => false });
    if (name === 'createQuality') return piece(name, { settings: { fps: 60, resolution: 1 }, onChange: () => noop });
    if (name === 'createSky') return piece(name, { sun: null });
    if (name === 'createPost') return piece(name, { render() { if (postFailure) throw postFailure; } });
    if (name === 'pixelRatio') return 1;
    return piece(name);
  } };
  Object.assign(globalThis, {
    document, window: { matchMedia: () => ({ matches: true }) }, __cityStartup: state,
    ResizeObserver: class { observe() {} disconnect() { disposals.push('observer'); } }, IntersectionObserver: undefined,
    requestAnimationFrame(callback) { const next = ++id; frames.set(next, callback); return next; }, cancelAnimationFrame(next) { frames.delete(next); },
    setTimeout(callback, delay) { const next = ++id; timers.set(next, { callback, delay }); return next; }, clearTimeout(next) { timers.delete(next); },
  });
  const host = new Element(), control = createCity(host, {
    active, forceWebGL, levels: {}, selected: 'academy', labels: [], onSelect: noop, onView: noop,
    onReady: () => events.push('ready'), onLost: () => events.push('lost'), onProgress: share => events.push(share),
  });
  t.after(() => { control.dispose(); for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  return { state, control, host, requests, modelRequests, disposals, events, frames, timers,
    failFrame() { postFailure = new Error('GPU render failed'); },
    frame() { for (const [next, callback] of [...frames]) { if (frames.delete(next)) callback(1000); } },
    async renderer() { requests.at(-1).resolve(); await flush(); },
    async models(models = new Map()) { modelRequests.at(-1).resolve(models); await flush(); },
  };
}

test('failed GPU startup retries WebGL on a fresh canvas and aborts the abandoned generation', async t => {
  const f = fixture(t), first = f.requests[0]; first.reject(new Error('adapter failed')); await flush();
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].options.forceWebGL, true);
  assert.notEqual(first.canvas, f.requests[1].canvas); assert.equal(first.options.signal.aborted, true);
  assert.equal(f.events.includes('lost'), false);
  await f.renderer(); await f.models(); f.frame();
  assert.equal(f.events.includes('ready'), true); assert.equal(f.events.includes('lost'), false);
  assert.equal(f.timers.size, 0, 'successful compilation clears its deadline timer');
});

test('if both renderers fail the page receives a terminal error instead of remaining in loading', async t => {
  const f = fixture(t); f.requests[0].reject(new Error('GPU unavailable')); await flush();
  f.requests[1].reject(new Error('WebGL unavailable')); await flush();
  assert.equal(f.requests.length, 2); assert.equal(f.events.filter(event => event === 'lost').length, 1);
  assert.equal(f.events.includes('ready'), false); assert.equal(f.frames.size, 0);
});

test('a first-frame exception tears down the failed renderer and recovers with WebGL', async t => {
  const f = fixture(t); await f.renderer(); await f.models(); f.failFrame(); f.frame(); await flush();
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].options.forceWebGL, true);
  assert.ok(f.disposals.includes('renderer-1')); assert.equal(f.events.includes('ready'), false);
  assert.equal(f.events.includes('lost'), false);
});

test('a system factory failure frees completed modules before retrying a clean renderer', async t => {
  const f = fixture(t); f.state.failure = 'createPost'; await f.renderer();
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].options.forceWebGL, true);
  for (const module of ['createPicker', 'createCameraRig', 'createLabels', 'createTraffic', 'createDistricts', 'createSky', 'createQuality', 'renderer-1']) {
    assert.equal(f.disposals.filter(name => name === module).length, 1, `${module} is released once even before Parts exists`);
  }
  assert.equal(f.modelRequests.length, 0);
  await f.renderer(); await f.models(); f.frame();
  assert.equal(f.events.includes('ready'), true); assert.equal(f.events.includes('lost'), false);
});

test('dispose during model loading cancels fetches and frees any model returned in the same race', async t => {
  const f = fixture(t); await f.renderer();
  const modelRequest = f.modelRequests[0], geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), disposed = [];
  for (const value of [geometry, material, material.map]) value.addEventListener('dispose', () => disposed.push(value));
  f.control.dispose(); assert.equal(modelRequest.options.signal.aborted, true);
  modelRequest.resolve(new Map([['late', { parts: [{ geometry, material }] }]])); await flush();
  assert.equal(disposed.length, 3); assert.equal(f.events.includes('lost'), false); assert.equal(f.events.includes('ready'), false);
});

test('an inactive retained city resumes the same pending startup and reaches its first frame', async t => {
  const f = fixture(t); f.control.setActive(false); await f.renderer();
  assert.equal(f.modelRequests.length, 0, 'hidden retained scene does not build its systems');
  f.control.setActive(true); await flush(); await f.models(); f.frame();
  assert.equal(f.requests.length, 1); assert.equal(f.events.includes('ready'), true);
});

test('dispose cancels shader warmup immediately and ignores its late completion', async t => {
  const f = fixture(t), compile = deferred(); f.state.compile = () => compile.promise;
  await f.renderer(); await f.models(); assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [4000]);
  f.control.dispose(); await flush(); assert.equal(f.timers.size, 0);
  compile.resolve(); await flush(); assert.equal(f.events.includes('ready'), false); assert.equal(f.events.includes('lost'), false);
});
