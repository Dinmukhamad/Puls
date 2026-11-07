import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ stdin: { contents: `export * from './transportCollection.ts'; export * from '../systems/traffic.ts'; export * from '../world/cities.ts'; export * from '../world/worldSpec.ts'; export * from '../render/night.ts'; export * as THREE from 'three/webgpu';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error', plugins: [{ name: 'url', setup(b) {
  b.onResolve({ filter: /\?url$/ }, a => ({ path: a.path, namespace: 'url' }));
  b.onLoad({ filter: /.*/, namespace: 'url' }, a => ({ contents: `export default ${JSON.stringify(a.path.replace(/\?url$/, ''))}`, loader: 'js' }));
} }] });
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { THREE } = city;
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  assert.equal(url, '/city/transport-v1/collection.glb');
  return new Response(await readFile(new URL('../../../public/city/transport-v1/collection.glb', import.meta.url)));
};
// The path above is relative to src/city3d/assets, so public is three levels up.
const originals = await city.loadTrafficCollection();
globalThis.fetch = originalFetch;
after(() => city.disposeTrafficCollection(originals));
const cloneModels = () => new Map([...originals].map(([id, model]) => [id, { ...model, lods: model.lods.map(g => g.clone()) }]));
const rng = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);

function context({ reducedMotion = false } = {}) {
  const frames = new Set(), moves = new Set(), qualities = new Set();
  const ctx = {
    world: city.islandWorld(city.WORLD_X4), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(50, 1.5, .1, 20000),
    renderer: { domElement: { dataset: {} } }, reducedMotion, mobile: false, night: city.createNight(),
    quality: { tier: 'high', lodDistances: [40, 120, 10000], crowd: 1 },
    onFrame(cb) { frames.add(cb); return () => frames.delete(cb); }, onCameraMove(cb) { moves.add(cb); return () => moves.delete(cb); }, onQuality(cb) { qualities.add(cb); return () => qualities.delete(cb); },
    frame(dt) { frames.forEach(cb => cb(dt, 0)); },
    look(x, y, z, tx = 0, ty = 0, tz = 0) { ctx.camera.position.set(x, y, z); ctx.camera.lookAt(tx, ty, tz); ctx.camera.updateMatrixWorld(); moves.forEach(cb => cb()); },
    qualityChange(q) { Object.assign(ctx.quality, q); qualities.forEach(cb => cb(ctx.quality)); },
    get listeners() { return frames.size + moves.size + qualities.size; },
  };
  ctx.look(0, 420, 1); return ctx;
}
const drawn = ctx => ctx.scene.getObjectByName('city-traffic').children.filter(m => m.geometry.instanceCount > 0);
const count = ctx => drawn(ctx).reduce((sum, m) => sum + m.geometry.instanceCount, 0);
const matrices = mesh => mesh.geometry.getAttribute('copyMatrix0').data.array;
const snapshot = ctx => drawn(ctx).map(m => [m.name, ...matrices(m).slice(0, m.geometry.instanceCount * 16)]).flat().join();
async function loaded(options = {}) {
  const ctx = context(options), models = cloneModels();
  const traffic = city.createTraffic(ctx, { random: rng(42), loadCollection: async () => models });
  assert.equal(await traffic.ready, true); ctx.frame(0); return { ctx, traffic, models };
}

test('all original models decode into three smaller, grounded +Z-facing LODs with material classes', () => {
  assert.equal(originals.size, 20);
  for (const model of originals.values()) {
    assert.equal(model.scale, .25); assert.equal(model.lods.length, 3);
    assert.ok(model.size.z > model.size.x, `${model.id} length faces Z`);
    let previous = Infinity;
    for (const g of model.lods) {
      assert.ok(g.index.count < previous, `${model.id}: decreasing detail`); previous = g.index.count;
      assert.ok(Math.abs(g.boundingBox.min.y) < .01, `${model.id} grounded`);
      for (const name of ['position', 'normal', 'color', 'aSurf', 'aWin', 'uv']) assert.equal(g.attributes[name].count, g.attributes.position.count);
      assert.ok([...g.attributes.position.array].every(Number.isFinite));
      assert.ok(g.attributes.aWin.getX(0) > 90, 'procedural wheel arches disabled');
    }
    if (['boats', 'yachts'].includes(model.category)) assert.ok(model.draft > .1 && model.draft < .7);
    else assert.equal(model.draft, 0);
    assert.ok(model.size.x * model.scale < (model.category === 'trucks' ? .85 : model.category === 'cars' ? .7 : 1.4), `${model.id} fits its lane`);
  }
  assert.ok(originals.get('sailing-yacht').size.y > 20, 'real sail and mast retained');
});

test('active island city uses every collection model, with moving cars on roads and six floating craft', async () => {
  const { ctx, traffic } = await loaded();
  assert.equal(ctx.renderer.domElement.dataset.transport, 'collection');
  assert.equal(new Set(drawn(ctx).map(m => m.userData.model)).size, 20);
  assert.equal(count(ctx), 25, '19 road vehicles and six watercraft');
  assert.equal(ctx.scene.getObjectByName('city-traffic-shadows').geometry.instanceCount, 19);
  let water = 0, road = 0;
  const before = snapshot(ctx);
  for (const m of drawn(ctx)) for (let i = 0; i < m.geometry.instanceCount; i++) {
    const a = matrices(m), x = a[i * 16 + 12], y = a[i * 16 + 13], z = a[i * 16 + 14];
    if (originals.get(m.userData.model).draft) {
      water++; assert.ok(y < -1.25); assert.ok(Math.hypot(x, z) > ctx.world.spec.quay && Math.hypot(x, z) < ctx.world.spec.bank);
    } else { road++; assert.ok(Math.abs(y - .215) < 1e-5 || Math.abs(y - .26) < 1e-5); }
  }
  assert.equal(water, 6); assert.equal(road, 19);
  ctx.frame(.25); assert.notEqual(snapshot(ctx), before);
  const a = snapshot(ctx); ctx.frame(.25); assert.notEqual(snapshot(ctx), a);
  traffic.dispose(); assert.equal(ctx.listeners, 0); assert.equal(ctx.scene.children.length, 0);
});

test('density, distance LODs, culling, pause and night work after the collection replaces the fallback', async () => {
  const { ctx, traffic } = await loaded({ reducedMotion: true });
  const first = snapshot(ctx); ctx.frame(.5); assert.equal(snapshot(ctx), first);
  assert.ok(drawn(ctx).every(m => m.userData.lod === 2));
  ctx.qualityChange({ crowd: .5 }); ctx.frame(0); assert.equal(count(ctx), 12, 'nine cars and three craft survive low density');
  ctx.qualityChange({ crowd: 1 }); ctx.frame(0);
  const car = drawn(ctx).find(m => !originals.get(m.userData.model).draft), a = matrices(car), x = a[12], z = a[14];
  ctx.look(x, 8, z + 8, x, 0, z); ctx.frame(0); assert.ok(drawn(ctx).some(m => m.userData.lod === 0));
  ctx.qualityChange({ tier: 'low' }); ctx.frame(0); assert.ok(drawn(ctx).every(m => m.userData.lod >= 1));
  ctx.look(0, 420, 1); ctx.frame(0); const paused = snapshot(ctx);
  ctx.night.set(true, true); ctx.frame(.1); assert.equal(snapshot(ctx), paused);
  assert.equal(ctx.scene.getObjectByName('city-traffic-lamps').geometry.instanceCount, 19);
  assert.equal(ctx.scene.getObjectByName('city-traffic-boat-lights').geometry.instanceCount, 6);
  traffic.setEnabled(true); ctx.frame(.1); assert.notEqual(snapshot(ctx), paused);
  traffic.setEnabled(false); const stopped = snapshot(ctx); ctx.frame(.5); assert.equal(snapshot(ctx), stopped);
  ctx.look(0, 420, 1, 0, 1000, 1); ctx.frame(0); assert.equal(count(ctx), 0);
  traffic.dispose();
});

test('failed detail download leaves working traffic; disposing a pending load aborts and releases its late result', async () => {
  const ctx = context(), traffic = city.createTraffic(ctx, { loadCollection: async () => { throw new Error('offline'); } });
  assert.equal(await traffic.ready, false); ctx.frame(.01);
  assert.equal(ctx.renderer.domElement.dataset.transport, 'fallback'); assert.ok(count(ctx) > 0);
  traffic.dispose();
  const pendingCtx = context(), models = cloneModels(); let resolve, signal;
  let freed = 0; models.forEach(m => m.lods.forEach(g => g.addEventListener('dispose', () => freed++)));
  const pending = city.createTraffic(pendingCtx, { loadCollection: options => { signal = options.signal; return new Promise(r => { resolve = r; }); } });
  pending.dispose(); assert.equal(signal.aborted, true); resolve(models);
  assert.equal(await pending.ready, false); assert.equal(freed, 60); assert.equal(models.size, 0);
  assert.equal(pendingCtx.listeners, 0); assert.equal(pendingCtx.scene.children.length, 0);
});

test('random city seeds change model order and positions while the same seed is reproducible', async () => {
  async function run(seed) {
    const ctx = context(), traffic = city.createTraffic(ctx, { random: rng(seed), loadCollection: async () => cloneModels() });
    await traffic.ready; ctx.frame(0); const value = snapshot(ctx); traffic.dispose(); return value;
  }
  assert.equal(await run(15), await run(15)); assert.notEqual(await run(15), await run(16));
});
