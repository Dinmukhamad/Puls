import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('./retainedCity.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
});
const { createCityRetention } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

// The retention boundary only owns DOM attachment and the engine's public API.
// No renderer, browser or React mount is needed to exercise its lifecycle.
class Element {
  constructor(tagName = 'div') { this.tagName = tagName; this.parentNode = null; this.children = []; this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) {
    for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); }
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
}

function fixture(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  const cache = createCityRetention(), engines = [];
  t.after(() => {
    cache.clear();
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  function create(host, options) {
    const canvas = new Element('canvas'), calls = [];
    host.append(canvas);
    const raw = Object.fromEntries([
      'setDepartment', 'setDepartmentWorld', 'setEstates', 'setBuild', 'focusEstate', 'focusWorld', 'travelTo', 'skipTravel', 'dispose', 'setActive', 'setLevels', 'setLabels', 'setMascot', 'setPlots',
      'setSites', 'setQuests', 'setTimeOfDay', 'setControls', 'select', 'setTraffic',
      'focusMascot', 'focusPlot', 'focusSite', 'focusQuest', 'zoom', 'rotate', 'tilt', 'reset',
    ].map(name => [name, (...args) => calls.push([name, ...args])]));
    const engine = { host, canvas, options, raw, calls, called: name => calls.filter(call => call[0] === name) };
    engines.push(engine);
    return raw;
  }
  function acquire(overrides = {}) {
    return cache.acquire({ owner: 'operator-a', key: 'x4-webgpu', mount: new Element(), options: page().options, traffic: true, create, ...overrides });
  }
  return { cache, engines, acquire };
}

function page(overrides = {}) {
  const events = [];
  const callbacks = Object.fromEntries(['onWorldPick', 'onArrival', 'onJourney', 'onEstate', 'onSelect', 'onView', 'onPlot', 'onSite', 'onQuest', 'onReady', 'onLost', 'onRestored', 'onProgress']
    .map(name => [name, (...args) => events.push([name, ...args])]));
  return {
    events,
    options: { levels: { crm: 1 }, selected: 'crm', labels: [{ id: 'crm', name: 'CRM' }], mascot: { gender: 'female', name: 'Пульсар' }, ...callbacks, ...overrides },
  };
}

function emitAll(options) {
  options.onWorldPick?.('station'); options.onArrival?.('sales'); options.onJourney?.('departing'); options.onEstate?.({ kind: 'object', district: 'support-team-1', object: 1 });
  options.onSelect('driver');
  options.onView({ azimuth: 2, polar: 1, distance: 40, target: [1, 2, 3] });
  options.onPlot?.('plot-1'); options.onSite?.('site-1'); options.onQuest?.(1);
  options.onProgress?.(.7); options.onLost(); options.onRestored?.(); options.onReady();
}

test('returning during startup restores progress and routes subsequent updates to the new page', t => {
  const { acquire, engines } = fixture(t), oldPage = page(), newPage = page();
  const first = acquire({ options: oldPage.options }), engine = engines[0];
  engine.options.onProgress(.3); first.release();
  engine.options.onProgress(.65);
  const next = acquire({ options: newPage.options });
  assert.equal(next.reused, true); assert.equal(next.progress, .65);
  assert.deepEqual(oldPage.events, [['onProgress', .3]]);
  engine.options.onProgress(.95);
  assert.deepEqual(newPage.events, [['onProgress', .95]]);
  engine.options.onReady(); next.release();
  assert.equal(acquire().progress, 1);
});

test('invalid progress cannot corrupt a retained loading state', t => {
  const { acquire, engines } = fixture(t), pageOne = page();
  const first = acquire({ options: pageOne.options }), engine = engines[0];
  engine.options.onProgress(.3); engine.options.onProgress(NaN); engine.options.onProgress(Infinity);
  first.release();
  assert.equal(acquire().progress, .3);
  assert.deepEqual(pageOne.events, [['onProgress', .3]]);
});

test('returning to the other department reuses the renderer and forwards journey events only to the current page', t => {
  const { acquire, engines } = fixture(t), firstPage = page({ department: 'support' });
  const first = acquire({ options: firstPage.options }), engine = engines[0];
  first.release();
  engine.options.onJourney('arriving'); engine.options.onArrival('sales');
  assert.deepEqual(firstPage.events, []);
  const config = { revision: 2, cities: [] }, nextPage = page({ department: 'sales', departmentWorld: config });
  const next = acquire({ options: nextPage.options });
  assert.equal(next.reused, true); assert.equal(engines.length, 1);
  assert.deepEqual(engine.called('setDepartment').at(-1), ['setDepartment', 'sales']);
  assert.deepEqual(engine.called('setDepartmentWorld').at(-1), ['setDepartmentWorld', config]);
  engine.options.onWorldPick('sales-team-1'); engine.options.onJourney('departing'); engine.options.onArrival('support');
  assert.deepEqual(nextPage.events, [['onWorldPick', 'sales-team-1'], ['onJourney', 'departing'], ['onArrival', 'support']]);
  assert.deepEqual(firstPage.events, []);
});

test('district land and the build mode follow the page into a retained scene, and land taps reach only it', t => {
  const { acquire, engines } = fixture(t), firstPage = page();
  const first = acquire({ options: firstPage.options }), engine = engines[0];
  first.release();
  const land = { state: { city: 'support', districts: [] }, own: null }, build = { district: 'support-team-1', area: 'estate', placing: null, selected: 3 };
  const nextPage = page({ estates: { support: land }, build });
  acquire({ options: nextPage.options });
  assert.deepEqual(engine.called('setEstates').at(-1), ['setEstates', 'support', land]);
  assert.deepEqual(engine.called('setBuild').at(-1), ['setBuild', build]);
  engine.options.onEstate({ kind: 'object', district: 'support-team-1', object: 3 });
  assert.deepEqual(nextPage.events, [['onEstate', { kind: 'object', district: 'support-team-1', object: 3 }]]);
  assert.deepEqual(firstPage.events, []);
});

test('returning to the same city keeps the engine, canvas and frame instead of rebuilding', t => {
  const { acquire, engines } = fixture(t), firstMount = new Element(), secondMount = new Element();
  const first = acquire({ mount: firstMount });
  const engine = engines[0], frame = engine.options.frame;
  assert.equal(first.reused, false);
  assert.equal(first.status, 'loading');
  assert.deepEqual(firstMount.children, [first.host, frame]);
  assert.equal(first.host.children[0], engine.canvas);
  engine.options.onReady();
  first.release();
  assert.equal(firstMount.children.length, 0);
  assert.equal(first.host.children[0], engine.canvas, 'GPU canvas stays inside the retained host');
  assert.equal(engine.called('dispose').length, 0);
  const second = acquire({ mount: secondMount });
  assert.equal(engines.length, 1, 'the expensive engine factory runs only once');
  assert.equal(second.reused, true);
  assert.equal(second.status, 'ready');
  assert.equal(second.host, first.host);
  assert.equal(second.control, first.control);
  assert.equal(second.host.children[0], engine.canvas);
  assert.deepEqual(secondMount.children, [first.host, frame]);
  assert.deepEqual(engine.called('setActive'), [['setActive', true], ['setActive', false], ['setActive', true]]);
});

test('leaving pauses and detaches the city; late engine events cannot reach an unmounted page', t => {
  const { acquire, engines } = fixture(t), oldPage = page(), mount = new Element();
  const lease = acquire({ mount, options: oldPage.options }), engine = engines[0];
  lease.release(); lease.release();
  emitAll(engine.options);
  assert.deepEqual(oldPage.events, [], 'all callbacks must be disconnected, including progress and optional actions');
  assert.equal(mount.children.length, 0);
  assert.equal(engine.canvas.parentNode, lease.host);
  assert.deepEqual(engine.called('setActive'), [['setActive', true], ['setActive', false]], 'releasing twice is harmless');
  assert.equal(engine.called('dispose').length, 0);
});

test('reattachment refreshes progress and callbacks but keeps traffic and an unchanged camera selection', t => {
  const { acquire, engines } = fixture(t), oldPage = page();
  const first = acquire({ options: oldPage.options }), engine = engines[0];
  first.control.setTraffic(false);
  first.release();
  const newPage = page({
    levels: { crm: 3, driver: 2 }, grown: ['crm'], labels: [{ id: 'crm', name: 'Новый CRM' }],
    mascot: { gender: 'male', name: 'Оператор' },
    plots: [{ key: 'plot-1', unlocked: true, item: 'cafe' }],
    sites: [{ key: 'site-1', name: 'Квартал', stage: 2 }], quests: [{ slot: 1, giver: 'trainer', answered: true }],
    timeOfDay: 'night', controls: 'map',
  });
  const second = acquire({ options: newPage.options, traffic: true });
  assert.equal(second.traffic, false, 'a new page default must not restart paused traffic');
  assert.deepEqual(engine.called('setTraffic'), [['setTraffic', true], ['setTraffic', false]]);
  assert.deepEqual(engine.called('select'), [], 'returning must not replay the camera flight');
  for (const [method, field] of [['setLabels', 'labels'], ['setMascot', 'mascot'], ['setPlots', 'plots'], ['setSites', 'sites'], ['setQuests', 'quests'], ['setTimeOfDay', 'timeOfDay'], ['setControls', 'controls']]) {
    assert.deepEqual(engine.called(method), [[method, newPage.options[field]]]);
  }
  assert.deepEqual(engine.called('setLevels'), [['setLevels', newPage.options.levels, ['crm']]]);
  emitAll(engine.options);
  assert.deepEqual(oldPage.events, []);
  assert.deepEqual(newPage.events.map(event => event[0]), ['onWorldPick', 'onArrival', 'onJourney', 'onEstate', 'onSelect', 'onView', 'onPlot', 'onSite', 'onQuest', 'onProgress', 'onLost', 'onReady', 'onRestored', 'onReady']);
});

test('selection changes from both the page and the canvas are remembered across visits', t => {
  const { acquire, engines } = fixture(t);
  const first = acquire(), engine = engines[0];
  first.control.select('academy');
  first.release();
  const second = acquire({ options: page({ selected: 'academy' }).options });
  assert.deepEqual(engine.called('select'), [['select', 'academy']]);
  engine.options.onSelect('driver');
  second.release();
  const third = acquire({ options: page({ selected: 'driver' }).options });
  assert.equal(engine.called('select').length, 1, 'selection from a label should not replay on return');
  third.release();
  acquire({ options: page({ selected: 'crm' }).options });
  assert.deepEqual(engine.called('select'), [['select', 'academy'], ['select', 'crm']], 'an explicit different district still focuses');
});

test('changing owner, city key or logging out disposes the previous scene and never reuses its resources', t => {
  const { acquire, engines, cache } = fixture(t);
  const first = acquire(), firstEngine = engines[0];
  first.release();
  cache.setOwner('operator-a');
  assert.equal(firstEngine.called('dispose').length, 0);
  const second = acquire({ key: 'v1-webgl' }), secondEngine = engines[1];
  assert.equal(second.reused, false);
  assert.notEqual(first.host, second.host);
  assert.equal(firstEngine.called('dispose').length, 1);
  second.release();
  const third = acquire({ owner: 'operator-b', key: 'v1-webgl' }), thirdEngine = engines[2];
  assert.equal(third.reused, false);
  assert.equal(secondEngine.called('dispose').length, 1);
  third.release();
  cache.setOwner(null);
  assert.equal(thirdEngine.called('dispose').length, 1, 'logout also frees a detached scene');
  cache.clear();
  assert.equal(thirdEngine.called('dispose').length, 1, 'clear is idempotent');
  const fourth = acquire({ owner: 'operator-b', key: 'v1-webgl' });
  assert.equal(fourth.reused, false);
  assert.equal(engines.length, 4);
});

test('a capability change rebuilds with the new permitted actions instead of retaining the old permissions', t => {
  const { acquire, engines } = fixture(t);
  // CityMap includes canBuild/canQuest in the key: callback presence controls
  // whether the renderer creates interactive plot/quest controls at all.
  const first = acquire({ key: 'x4-build0-quest0', options: page({ onPlot: undefined, onQuest: undefined }).options });
  assert.equal(engines[0].options.onPlot, undefined);
  assert.equal(engines[0].options.onQuest, undefined);
  first.release();
  const newPage = page(), second = acquire({ key: 'x4-build1-quest1', options: newPage.options });
  assert.equal(second.reused, false);
  assert.equal(engines[0].called('dispose').length, 1);
  engines[1].options.onPlot('plot-1'); engines[1].options.onQuest(2);
  assert.deepEqual(newPage.events, [['onPlot', 'plot-1'], ['onQuest', 2]]);
});

test('a failed retained engine is recreated, while an engine that finishes loading off-page is reused', t => {
  const { acquire, engines } = fixture(t), oldPage = page();
  const first = acquire({ options: oldPage.options }), firstEngine = engines[0];
  first.release();
  firstEngine.options.onReady();
  const second = acquire();
  assert.equal(second.status, 'ready');
  assert.equal(second.reused, true);
  assert.deepEqual(oldPage.events, []);
  second.release();
  firstEngine.options.onLost();
  const third = acquire();
  assert.equal(third.reused, false);
  assert.equal(third.status, 'loading');
  assert.equal(firstEngine.called('dispose').length, 1);
  assert.equal(engines.length, 2);
});

test('a synchronous factory failure removes its DOM, disconnects callbacks and allows a clean retry', t => {
  const { acquire, engines } = fixture(t), mount = new Element(), oldPage = page();
  const error = new Error('renderer startup failed');
  let failedHost, failedFrame, failedOptions;
  assert.throws(() => acquire({ mount, options: oldPage.options, create(host, options) {
    failedHost = host; failedFrame = options.frame; failedOptions = options;
    host.append(new Element('canvas'));
    throw error;
  } }), thrown => thrown === error, 'the caller still receives the original failure');
  assert.equal(mount.children.length, 0);
  assert.equal(failedHost.parentNode, null);
  assert.equal(failedFrame.parentNode, null);
  emitAll(failedOptions);
  assert.deepEqual(oldPage.events, [], 'even a scheduled factory callback is disconnected');
  const retry = acquire({ mount });
  assert.equal(retry.reused, false);
  assert.equal(engines.length, 1);
  assert.notEqual(retry.host, failedHost);
  assert.equal(mount.children.length, 2);
  assert.equal(retry.host.parentNode, mount);
});

test('cleanup from a stale lease cannot detach or pause the current visit', t => {
  const { acquire, engines } = fixture(t), oldPage = page(), newPage = page(), mount = new Element();
  const first = acquire({ options: oldPage.options }), engine = engines[0];
  const second = acquire({ options: newPage.options, mount });
  const activeCalls = engine.called('setActive').length;
  first.release();
  assert.equal(second.host.parentNode, mount);
  assert.equal(engine.called('setActive').length, activeCalls);
  engine.options.onSelect('driver');
  assert.deepEqual(oldPage.events, []);
  assert.deepEqual(newPage.events, [['onSelect', 'driver']]);
  second.release();
  assert.equal(mount.children.length, 0);
  const third = acquire({ key: 'another-city', mount });
  second.release();
  assert.equal(third.host.parentNode, mount, 'an old entry cannot remove a replacement city either');
});

// Run the real engine entry point and camera while renderer/model/system factories wait under test control.
const cityEntry = fileURLToPath(new URL('../../city3d/index.ts', import.meta.url));
const cameraEntry = fileURLToPath(new URL('../../city3d/engine/camera.ts', import.meta.url));
const runtimeFactories = new Map([...readFileSync(cityEntry, 'utf8').matchAll(/import\s+\{([^}]+)\}\s+from\s+"([^"]+)";/g)]
  .filter(([, , path]) => path.startsWith('./') && !path.startsWith('./world/') && path !== './engine/camera')
  .map(([, names, path]) => [path, names.split(',').map(name => name.trim()).filter(name => !name.startsWith('type '))]));
const startupBundle = await build({
  stdin: { contents: `export { createCity } from ${JSON.stringify(cityEntry)}; export * as THREE from "three/webgpu";`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error', loader: { '.css': 'empty' },
  define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'city-startup-factories', setup(plugin) {
    plugin.onResolve({ filter: /.*/ }, args => {
      if (args.importer !== cityEntry) return;
      if (args.path === './engine/camera') return { path: args.path, namespace: 'observed-camera' };
      if (runtimeFactories.has(args.path)) return { path: args.path, namespace: 'startup-factory' };
    });
    plugin.onLoad({ filter: /.*/, namespace: 'startup-factory' }, args => ({
      contents: runtimeFactories.get(args.path).map(name => `export function ${name}(...args) { return globalThis.__pulsCityStartup.factory(${JSON.stringify(name)}, args); }`).join('\n'), loader: 'js',
    }));
    plugin.onLoad({ filter: /.*/, namespace: 'observed-camera' }, () => ({ contents: `
      export { createCamera } from ${JSON.stringify(cameraEntry)};
      import { createCameraRig as realCameraRig } from ${JSON.stringify(cameraEntry)};
      export function createCameraRig(...args) {
        const rig = realCameraRig(...args), state = globalThis.__pulsCityStartup;
        for (const name of ["focus", "focusBounds", "animateTo"]) {
          const run = rig[name];
          rig[name] = (...values) => { state.calls.push(["camera", name, ...values]); return run(...values); };
        }
        state.rig = rig; return rig;
      }`, loader: 'js', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }));
  } }],
});
const startupCity = await import(`data:text/javascript;base64,${Buffer.from(startupBundle.outputFiles[0].text).toString('base64')}`);
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
class RuntimeElement extends EventTarget {
  dataset = {}; style = {}; clientWidth = 1600; clientHeight = 900; children = []; tagName = 'DIV';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
  getBoundingClientRect() { return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight }; }
}
function startupFixture(t) {
  const names = ['document', 'window', 'ResizeObserver', 'HTMLElement', 'Node', '__pulsCityStartup', 'setTimeout'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)])), timers = [];
  const rendererReady = deferred(), modelsReady = deferred(), modelsRequested = deferred(), compiled = deferred(), calls = [];
  const state = { calls, rig: null, render: null };
  const noop = () => {}, piece = values => new Proxy(values ?? {}, { get: (target, key) => key === 'then' ? undefined : key in target ? target[key] : noop });
  const realTimeout = globalThis.setTimeout;
  const window = new EventTarget(); window.matchMedia = () => ({ matches: true });
  Object.assign(globalThis, {
    document: { createElement: () => new RuntimeElement(), body: new RuntimeElement(), activeElement: null }, window,
    ResizeObserver: class { observe() {} disconnect() {} }, HTMLElement: RuntimeElement, Node: RuntimeElement,
    __pulsCityStartup: state,
    setTimeout(callback, delay, ...args) { const timer = realTimeout(callback, delay, ...args); if (delay === 8000) { timer.unref(); timers.push(timer); } return timer; },
  });
  const focusViews = new Map([
    ['support-team-1', { bounds: new startupCity.THREE.Box3(new startupCity.THREE.Vector3(-160, .2, -30), new startupCity.THREE.Vector3(-80, .2, 30)), azimuth: .55 }],
    ['support-team-2', { bounds: new startupCity.THREE.Box3(new startupCity.THREE.Vector3(60, .2, -30), new startupCity.THREE.Vector3(140, .2, 30)), azimuth: .75 }],
  ]);
  state.factory = (name, args) => {
    if (name === 'createRenderer') {
      calls.push(['renderer-request']);
      return rendererReady.promise.then(() => piece({ backend: 'webgl2', gpu: 'test',
        onRestored(callback) { state.restoreCallback = callback; return noop; },
        renderer: piece({ compileAsync() { calls.push(['compile']); compiled.resolve(); return Promise.resolve(); } }),
      }));
    }
    if (name === 'loadCatalogueModels') { calls.push(['models-request']); modelsRequested.resolve(); return modelsReady.promise; }
    if (name === 'createLoop') { state.render = args[0].render; return piece(); }
    if (name === 'createQuality') return piece({ settings: { fps: 60, resolution: 1 }, onChange: () => noop });
    if (name === 'createSky') return piece({ sun: null });
    if (name === 'createDistricts') { state.pickables = [new startupCity.THREE.Object3D()]; return piece({ anchors: new Map(), pickables: state.pickables, startGrowth() { calls.push(['growth']); return 'crm'; } }); }
    if (name === 'createPicker') { state.learningPickables = args[2]; return piece(); }
    if (name === 'createMascot') return piece({ nameAnchor: new startupCity.THREE.Vector3(), focusPoint: new startupCity.THREE.Vector3() });
    if (name === 'createDepartmentWorld') return piece({
      setEstates(city, value) { calls.push(['estates', city, value]); },
      setBuild(value) { calls.push(['build', value]); },
      focusEstate(target) { calls.push(['estate-focus', target]); return focusViews.get(target.district); },
    });
    if (name === 'pixelRatio') return 1;
    return piece();
  };
  const host = new RuntimeElement(), options = page({ world: 'x4', onReady: () => calls.push(['ready']), onLost: () => calls.push(['lost']),
    onRestored: () => { calls.push(['restored']); state.restoration?.resolve(); },
  }).options;
  const control = startupCity.createCity(host, options);
  t.after(() => {
    control.dispose(); timers.forEach(clearTimeout);
    for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  return { control, state, calls, rendererReady, modelsRequested,
    async finishModels() {
      modelsReady.resolve(new Map()); await compiled.promise;
      // Let compileAsync and the real entry point's Promise.race finish before requesting its first frame.
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
    async restore() {
      state.restoration = deferred(); state.restoreCallback();
      await state.restoration.promise;
    },
    frame() { state.render(1 / 60, 1000); },
  };
}
const startupBuild = district => ({ district, area: 'plots', placing: null, selected: null, plot: null });

test('the real city startup replays only the latest estate focus after state and growth are ready', async t => {
  const s = startupFixture(t), first = { district: 'support-team-1', kind: 'district' }, latest = { district: 'support-team-2', kind: 'district' };
  const estate = { state: { city: 'support', districts: [{ id: latest.district }] } }, build = startupBuild(latest.district);
  s.control.setBuild(startupBuild(first.district)); s.control.focusEstate(first);
  assert.deepEqual(s.calls, [['renderer-request']], 'focus cannot run before the renderer exists');
  s.rendererReady.resolve(); await s.modelsRequested.promise;
  s.control.setEstates('support', estate); s.control.setBuild(build); s.control.focusEstate(latest);
  assert.deepEqual(s.state.learningPickables(), [], 'legacy learning-district volumes cannot hijack personal build taps');
  s.frame();
  assert.equal(s.calls.some(call => call[0] === 'estate-focus'), false, 'a loading frame cannot consume the destination');
  await s.finishModels();
  assert.equal(s.calls.some(call => call[0] === 'estate-focus'), false, 'model initialization alone does not mark the scene ready');
  s.frame();
  assert.deepEqual(s.calls.filter(call => call[0] === 'estate-focus'), [['estate-focus', latest]]);
  const focusIndex = s.calls.findIndex(call => call[0] === 'estate-focus');
  assert.ok(s.calls.findIndex(call => call[0] === 'estates' && call[2] === estate) < focusIndex, 'late estate state arrives before focus');
  assert.ok(s.calls.findIndex(call => call[0] === 'build' && call[1] === build) < focusIndex, 'the latest build district arrives before focus');
  const flights = s.calls.filter(call => call[0] === 'camera');
  assert.deepEqual(flights.map(call => call[1]), ['focus', 'focusBounds'], 'district growth flies first; the requested build view wins afterward');
  assert.deepEqual(s.state.rig.currentView().target, [100, .2, 0], 'the actual camera ends at the latest district, not the growth district');
  assert.ok(s.calls.findIndex(call => call[0] === 'ready') > focusIndex, 'the page is notified only after focus replay');
  s.frame();
  assert.equal(s.calls.filter(call => call[0] === 'estate-focus').length, 1, 'later frames do not replay a consumed request');
  assert.equal(s.calls.some(call => call[0] === 'lost'), false);
});

test('closing build mode while the real city is loading cancels its queued estate focus', async t => {
  const s = startupFixture(t), target = { district: 'support-team-2', kind: 'district' };
  s.control.setBuild(startupBuild(target.district)); s.control.focusEstate(target);
  s.rendererReady.resolve(); await s.modelsRequested.promise;
  assert.deepEqual(s.state.learningPickables(), []);
  s.control.setBuild(null);
  assert.equal(s.state.learningPickables(), s.state.pickables, 'closing build mode restores the normal learning-district picker');
  await s.finishModels(); s.frame();
  assert.deepEqual(s.calls.filter(call => call[0] === 'build'), [['build', null]], 'startup receives the closed build state');
  assert.equal(s.calls.some(call => call[0] === 'estate-focus'), false, 'the canceled district never reaches the estate system');
  assert.deepEqual(s.calls.filter(call => call[0] === 'camera').map(call => call[1]), ['focus'], 'only the normal growth focus remains');
  assert.equal(s.calls.some(call => call[0] === 'ready'), true);
  assert.equal(s.calls.some(call => call[0] === 'lost'), false);
});

test('context restoration rebuilds the real runtime and returns to the last estate destination after growth', async t => {
  const s = startupFixture(t), first = { district: 'support-team-1', kind: 'district' }, latest = { district: 'support-team-2', kind: 'district' };
  const estate = { state: { city: 'support', districts: [{ id: latest.district }] } }, build = startupBuild(latest.district);
  s.control.setBuild(startupBuild(first.district)); s.control.focusEstate(first);
  s.rendererReady.resolve(); await s.modelsRequested.promise;
  s.control.setEstates('support', estate); s.control.setBuild(build); s.control.focusEstate(latest);
  await s.finishModels(); s.frame();
  assert.deepEqual(s.state.rig.currentView().target, [100, .2, 0]);
  const firstRig = s.state.rig, beforeRestore = s.calls.length;
  await s.restore();
  assert.notEqual(s.state.rig, firstRig, 'restoration creates a fresh camera rig');
  assert.equal(s.calls.slice(beforeRestore).some(call => call[0] === 'estate-focus'), false, 'restored models still wait for the first complete frame');
  s.frame();
  const restoredCalls = s.calls.slice(beforeRestore), focusIndex = restoredCalls.findIndex(call => call[0] === 'estate-focus');
  assert.deepEqual(restoredCalls.filter(call => call[0] === 'estate-focus'), [['estate-focus', latest]], 'restoration retains the latest destination, not the first queued one');
  assert.ok(restoredCalls.findIndex(call => call[0] === 'estates' && call[2] === estate) < focusIndex, 'fresh department geometry receives the saved estate data first');
  assert.ok(restoredCalls.findIndex(call => call[0] === 'build' && call[1] === build) < focusIndex, 'build mode is restored before its camera destination');
  assert.deepEqual(restoredCalls.filter(call => call[0] === 'camera').map(call => call[1]), ['focus', 'focusBounds'], 'the remembered estate view overrides the new growth focus');
  assert.deepEqual(s.state.rig.currentView().target, [100, .2, 0], 'the actual replacement camera returns to the last district');
  assert.ok(restoredCalls.findIndex(call => call[0] === 'ready') > focusIndex);
  s.frame();
  assert.equal(s.calls.slice(beforeRestore).filter(call => call[0] === 'estate-focus').length, 1, 'the restored destination is consumed once');
  assert.equal(s.calls.some(call => call[0] === 'lost'), false);
});

test('closing build mode before context restoration removes the remembered estate destination', async t => {
  const s = startupFixture(t), target = { district: 'support-team-2', kind: 'district' };
  s.control.setBuild(startupBuild(target.district)); s.control.focusEstate(target);
  s.rendererReady.resolve(); await s.modelsRequested.promise;
  await s.finishModels(); s.frame();
  assert.deepEqual(s.state.rig.currentView().target, [100, .2, 0]);
  s.control.setBuild(null);
  const beforeRestore = s.calls.length;
  await s.restore(); s.frame();
  const restoredCalls = s.calls.slice(beforeRestore);
  assert.deepEqual(restoredCalls.filter(call => call[0] === 'build'), [['build', null]]);
  assert.equal(restoredCalls.some(call => call[0] === 'estate-focus'), false, 'a closed district does not reopen after restoration');
  assert.deepEqual(restoredCalls.filter(call => call[0] === 'camera').map(call => call[1]), ['focus'], 'only normal growth controls the replacement camera');
  assert.notDeepEqual(s.state.rig.currentView().target, [100, .2, 0]);
  assert.equal(restoredCalls.some(call => call[0] === 'ready'), true);
  assert.equal(s.calls.some(call => call[0] === 'lost'), false);
});
