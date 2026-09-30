import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

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
      'dispose', 'setActive', 'setLevels', 'setLabels', 'setMascot', 'setPlots',
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
  const callbacks = Object.fromEntries(['onSelect', 'onView', 'onPlot', 'onSite', 'onQuest', 'onReady', 'onLost', 'onRestored', 'onProgress']
    .map(name => [name, (...args) => events.push([name, ...args])]));
  return {
    events,
    options: { levels: { crm: 1 }, selected: 'crm', labels: [{ id: 'crm', name: 'CRM' }], mascot: { gender: 'female', name: 'Пульсар' }, ...callbacks, ...overrides },
  };
}

function emitAll(options) {
  options.onSelect('driver');
  options.onView({ azimuth: 2, polar: 1, distance: 40, target: [1, 2, 3] });
  options.onPlot?.('plot-1'); options.onSite?.('site-1'); options.onQuest?.(1);
  options.onProgress?.(.7); options.onLost(); options.onRestored?.(); options.onReady();
}

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
  assert.deepEqual(newPage.events.map(event => event[0]), ['onSelect', 'onView', 'onPlot', 'onSite', 'onQuest', 'onProgress', 'onLost', 'onReady', 'onRestored', 'onReady']);
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
