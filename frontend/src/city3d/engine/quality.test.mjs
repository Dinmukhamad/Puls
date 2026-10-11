import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const load = async (file) => {
  const built = await build({ entryPoints: [fileURLToPath(new URL(file, import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
};
const core = await load('./qualityCore.ts');
const { createQuality, QUALITY_KEY } = await load('./quality.ts');
const { shouldDraw } = await load('./loop.ts');

const desktop = { backend: 'webgpu', mobile: false, ios: false, cores: 8, width: 1920, height: 1080, dpr: 1, gpu: '' };
const android = { ...desktop, mobile: true, width: 393, height: 873, dpr: 2.75 };
const iphone = { ...desktop, backend: 'webgl2', mobile: true, ios: true, cores: 6, width: 390, height: 844, dpr: 3, gpu: 'Apple GPU' };

/** GPU cost of each setting relative to the full "high" frame; resolution scales the pixel-bound part. */
const effects = (s) => (s.ao ? 1 : .85) * { planar: 1.15, ssr: 1, sky: .9 }[s.waterReflections] * { 2048: 1, 1024: .93, 0: .85 }[s.dynamicShadowSize] * (s.crowd >= 1 ? 1 : .95);

/**
 * Frame gaps from a model of the device, like the lead's adapt-sim: GPU time scales with the pixel count
 * and the settings, a frame starts on the first vsync after the GPU is free (and after the loop's 30 fps
 * throttle, or a browser cap), so gaps are whole vsyncs. `gpu` is the full-quality frame of the base tier.
 */
function simulate({ base, gpu, fixed = 3, vsync = 1000 / 60, seconds = 600, busy = () => false, hitchAt = [], seed = 7 }) {
  const adapter = core.createAdapter(base);
  let random = seed;
  const noise = () => ((random = (random * 16807) % 2147483647) / 2147483647 - .5) * .06;
  const trace = [], changes = [];
  let now = 0, lowest = 1;
  while (now < seconds * 1000) {
    const s = adapter.settings;
    const work = (fixed + (gpu - fixed) * s.resolution ** 2 * effects(s) / effects(base)) * (1 + noise());
    let next = now + Math.max(1, Math.ceil(work / vsync - 1e-9)) * vsync;
    while (!shouldDraw(next, now, s.fps)) next += vsync;
    if (hitchAt.length && next >= hitchAt[0]) next += hitchAt.shift();
    const gap = next - now;
    now = next;
    if (adapter.frame(gap, now, busy(now))) {
      changes.push(now);
      trace.push([Math.round(now / 1000), adapter.concessions.join(' ') || '-']);
    }
    lowest = Math.min(lowest, adapter.settings.resolution);
  }
  return { adapter, trace, changes, lowest, settings: adapter.settings, concessions: adapter.concessions };
}

/** New concessions (not retakes after a failed retry) in the order they were first made. */
function firstConcessions(trace) {
  const seen = [], before = new Set();
  for (const [, list] of trace) for (const id of list.split(' ')) if (id !== '-' && !before.has(id)) { before.add(id); seen.push(id); }
  return seen;
}
const tableOrder = (ids) => [...ids].sort((a, b) => core.STEPS.findIndex(s => s.id === a) - core.STEPS.findIndex(s => s.id === b));

/** Steady state: after the first minute, on average at most one change per 30 s, and never two retries in one 30 s. */
function assertSteady(run, name, settle = 60000, seconds = 600) {
  const late = run.changes.filter(t => t >= settle);
  assert.ok(late.length <= (seconds * 1000 - settle) / 30000, `${name}: ${late.length} changes after settling: ${JSON.stringify(run.trace.slice(-12))}`);
  for (const t of late) assert.ok(late.filter(u => u >= t && u < t + 30000).length <= 2, `${name}: more than one retry within 30 s at ${Math.round(t / 1000)} s`);
}

const high = core.baseSettings('high', desktop), medium = core.baseSettings('medium', android), mediumIphone = core.baseSettings('medium', iphone);

test('fast devices keep full quality and never change anything', () => {
  for (const [name, run] of [
    ['desktop 60 Hz, 10 ms', simulate({ base: high, gpu: 10 })],
    ['desktop 120 Hz, 6 ms', simulate({ base: high, gpu: 6, vsync: 1000 / 120 })],
    ['phone 30 fps steady, 20 ms', simulate({ base: medium, gpu: 20 })],
    ['iPhone 60 Hz, 12 ms', simulate({ base: mediumIphone, gpu: 12 })],
  ]) {
    assert.deepEqual(run.changes, [], `${name}: ${JSON.stringify(run.trace)}`);
    assert.deepEqual(run.settings, run.adapter.settings);
    assert.equal(run.settings.resolution, 1);
  }
});

test('a 30 Hz cap with an idle GPU ends at full quality, drawing 30 frames a second', () => {
  const run = simulate({ base: high, gpu: 8, vsync: 1000 / 30 });
  assert.equal(run.lowest, 1, 'resolution must not drop for a capped device');
  assert.deepEqual(run.concessions, ['fps:30'], JSON.stringify(run.trace));
  assert.deepEqual({ ...run.settings, fps: 60 }, high);
  assertSteady(run, '30 Hz cap');
});

test('a GPU-bound desktop gives up effects in table order and keeps its pixels', () => {
  const run = simulate({ base: high, gpu: 40 });
  const first = firstConcessions(run.trace);
  assert.deepEqual(first, tableOrder(first), `order: ${first}`);
  assert.deepEqual(first.slice(0, 2), ['ao', 'water:sky']);
  assert.ok(run.concessions.includes('fps:30') && run.concessions.includes('ao'), JSON.stringify(run.concessions));
  // 30 frames a second is enough for this GPU once the effects are off, so resolution stays native.
  assert.equal(run.lowest, 1);
  assertSteady(run, '60 Hz GPU-bound 40 ms');
});

test('a 120 Hz screen with a busy GPU settles without blinking', () => {
  const run = simulate({ base: high, gpu: 30, vsync: 1000 / 120 });
  const first = firstConcessions(run.trace);
  assert.deepEqual(first, tableOrder(first));
  assert.ok(run.lowest >= .8);
  assertSteady(run, '120 Hz GPU 30 ms');
});

test('a GPU-bound phone concedes shadows, crowd, then pixels, never below 80 %', () => {
  const run = simulate({ base: medium, gpu: 60 });
  assert.deepEqual(firstConcessions(run.trace), ['shadows:0', 'crowd:0.5', 'resolution:0.9', 'resolution:0.8']);
  assert.equal(run.settings.fps, 30);
  assert.equal(run.lowest, .8);
  assertSteady(run, 'phone GPU-bound');
});

test('an iPhone that cannot hold 60 drops to 30 frames a second before anything visible', () => {
  const run = simulate({ base: mediumIphone, gpu: 20 });
  assert.deepEqual(run.concessions, ['fps:30'], JSON.stringify(run.trace));
  assert.equal(run.lowest, 1);
  assertSteady(run, 'iPhone 20 ms');
});

test('a very slow GPU walks the whole table in order and stops at 80 %', () => {
  const run = simulate({ base: high, gpu: 330, fixed: 20 });
  assert.deepEqual(firstConcessions(run.trace), core.STEPS.map(s => s.id));
  assert.deepEqual(run.concessions, core.STEPS.map(s => s.id));
  assert.equal(run.lowest, .8);
  assert.equal(run.changes.length, core.STEPS.length, JSON.stringify(run.trace));
});

test('pixels are the last resort in every scenario: nothing earlier comes back while resolution is lowered', () => {
  for (const [name, options] of [
    ['phone GPU-bound 40 ms', { base: medium, gpu: 40 }], ['phone GPU-bound 60 ms', { base: medium, gpu: 60 }],
    ['desktop 60 Hz 40 ms', { base: high, gpu: 40 }], ['desktop 60 Hz 60 ms', { base: high, gpu: 60 }],
    ['desktop 120 Hz 30 ms', { base: high, gpu: 30, vsync: 1000 / 120 }], ['very slow', { base: high, gpu: 330, fixed: 20 }],
  ]) {
    const run = simulate(options);
    // Steps before 30 fps that change this tier at all (medium has no AO to give up, for instance).
    const before30 = core.STEPS.slice(0, core.STEPS.findIndex(s => s.id === 'fps:30')).filter(step => { const s = structuredClone(options.base); step.apply(s); return JSON.stringify(s) !== JSON.stringify(options.base); });
    const possible = before30.filter(step => step.id !== 'shadows:1024').map(step => step.id);
    for (const [second, list] of run.trace) {
      if (!list.includes('resolution')) continue;
      for (const id of possible) assert.ok(list.split(' ').includes(id), `${name}: ${id} came back at ${second} s while resolution was lowered: ${list}`);
    }
    assert.ok(run.lowest >= .8, name);
    assertSteady(run, name);
  }
});

test('hitches, pauses and busy frames are not measured', () => {
  // One 600 ms compile stall, a 3 s pause, and 3 s of chunk loading at 10 frames a second.
  const loading = (now) => now > 20000 && now < 23000;
  const run = simulate({ base: high, gpu: 10, seconds: 60, hitchAt: [5000, 12000], busy: loading });
  assert.deepEqual(run.changes, []);
  const adapter = core.createAdapter(high);
  for (let now = 0; now < 30000; now += 100) assert.equal(adapter.frame(100, now, true), false);
  for (let now = 0; now < 30000; now += 1200) assert.equal(adapter.frame(1200, now), false);
});

test('the first tier follows the device (TZ §8.1)', () => {
  const tier = (device) => core.initialTier({ ...desktop, ...device });
  assert.equal(tier({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F91) Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'high');
  assert.equal(tier({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'ultra');
  assert.equal(tier({ gpu: 'nvidia ampere' }), 'ultra');
  assert.equal(tier({ gpu: 'nvidia ampere', backend: 'webgl2' }), 'high');
  assert.equal(tier({ gpu: 'nvidia ampere', width: 3840, height: 2160 }), 'high');
  assert.equal(tier({ gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'medium');
  assert.equal(tier({ gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'medium');
  assert.equal(tier({ gpu: 'ANGLE (Intel, Intel(R) HD Graphics 620 (0x00005916) Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'medium');
  assert.equal(tier({ gpu: 'intel gen-12lp' }), 'medium');
  assert.equal(tier({ gpu: 'ANGLE (Intel, Intel(R) HD Graphics 4000 (0x00000166) Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'low');
  assert.equal(tier({ gpu: 'Intel(R) HD Graphics' }), 'low');
  assert.equal(tier({ gpu: 'intel gen-8' }), 'low');
  assert.equal(tier({ gpu: 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'high');
  assert.equal(tier({ gpu: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'medium');
  assert.equal(tier({ gpu: 'NVIDIA GeForce MX250' }), 'medium');
  assert.equal(tier({ gpu: 'google swiftshader' }), 'low');
  assert.equal(tier({ gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)' }), 'low');
  assert.equal(tier({ gpu: 'Apple GPU', backend: 'webgl2' }), 'high');
  assert.equal(tier({ gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)' }), 'ultra');
  assert.equal(tier({ gpu: '', cores: 4 }), 'medium');
  assert.equal(tier({ gpu: '', cores: 2 }), 'low');
  // Phones: iPhone "medium" even with a strong chip; Android by GPU and cores.
  assert.equal(core.initialTier(iphone), 'medium');
  assert.equal(core.initialTier({ ...android, gpu: 'Adreno (TM) 610' }), 'medium');
  assert.equal(core.initialTier({ ...android, gpu: 'Adreno (TM) 506' }), 'low');
  assert.equal(core.initialTier({ ...android, gpu: 'Mali-G52 MC2' }), 'low');
  assert.equal(core.initialTier({ ...android, gpu: 'Mali-G57 MC2', cores: 4 }), 'low');
  assert.equal(core.initialTier({ ...android, gpu: 'Mali-G610 MC6' }), 'medium');
});

test('tier settings match the TZ table and phones pick their frame rate', () => {
  const ultra = core.settingsFor('ultra'), low = core.settingsFor('low');
  assert.equal(ultra.waterReflections, 'planar'); assert.equal(high.waterReflections, 'ssr');
  assert.equal(medium.waterReflections, 'sky'); assert.equal(medium.ao, false); assert.equal(medium.dynamicShadowSize, 1024);
  assert.equal(low.dynamicShadowSize, 0); assert.equal(low.bloom, false); assert.equal(low.crowd, .5);
  assert.equal(high.fps, 60); assert.equal(medium.fps, 30); assert.equal(mediumIphone.fps, 60);
  assert.equal(core.baseSettings('high', iphone).fps, 30);
  for (const tier of core.TIERS) assert.equal(core.settingsFor(tier).resolution, 1);
});

test('a manual choice is remembered, stops adaptation and survives broken storage', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const options = { backend: 'webgpu', mobile: false, gpu: 'nvidia ampere', device: desktop, storage };
  const quality = createQuality(options);
  assert.equal(quality.auto, 'high'); assert.equal(quality.manual, null); assert.equal(quality.settings.tier, 'high');
  const seen = [];
  quality.onChange((s) => seen.push(s.tier));
  quality.setManual('low');
  assert.equal(store.get(QUALITY_KEY), 'low'); assert.deepEqual(seen, ['low']);
  for (let now = 0; now < 20000; now += 100) quality.frame(100, now);
  assert.equal(quality.settings.tier, 'low'); assert.deepEqual(quality.concessions, []);
  assert.equal(createQuality(options).manual, 'low');
  quality.setManual(null);
  assert.equal(store.has(QUALITY_KEY), false); assert.equal(quality.settings.tier, 'high');
  for (let now = 0; now < 5000; now += 50) quality.frame(50, now);
  assert.deepEqual(quality.concessions, ['ao', 'water:sky', 'shadows:1024', 'shadows:0', 'crowd:0.5']);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const fallback = createQuality({ ...options, storage: broken });
  assert.equal(fallback.manual, null);
  fallback.setManual('medium');
  assert.equal(fallback.settings.tier, 'medium');
  quality.dispose(); fallback.dispose();
});
