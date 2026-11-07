import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const built = await build({
  stdin: { contents: 'export * from "./catalogue.ts"; export * from "./vegetation.ts";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /\?url$/ }, a => ({ path: a.path, namespace: 'url' })); b.onLoad({ filter: /.*/, namespace: 'url' }, a => ({ contents: `export default ${JSON.stringify(a.path)};`, loader: 'js' })); } }],
});
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const triangles = g => (g.index?.count ?? g.attributes.position.count) / 3;

test('all procedural buildings retain facade coordinates, colors, bounds and shared lighting across cheaper LODs', () => {
  const catalogue = city.createCatalogue(new Map());
  const models = catalogue.models.filter(m => /^(family-house|office-building|district-landmark|section-|block-|office-\d|cottage|roof|port-)/.test(m.id));
  assert.ok(models.length > 40);
  let nearTotal = 0, farTotal = 0;
  for (const model of models) {
    const near = model.lods[0].parts[0], mid = model.lods[1].parts[0], far = model.lods[2].parts[0];
    assert.ok(mid.material === near.material && far.material === near.material, `${model.id}: shared daytime/nighttime facade`);
    assert.ok(triangles(far.geometry) <= triangles(mid.geometry) && triangles(mid.geometry) <= triangles(near.geometry), `${model.id}: monotonic triangle budget`);
    assert.deepEqual(Object.keys(far.geometry.attributes).sort(), Object.keys(near.geometry.attributes).sort());
    const n = near.geometry.boundingBox, f = far.geometry.boundingBox;
    for (const axis of ['x', 'y', 'z']) assert.ok(f.min[axis] >= n.min[axis] - 1e-6 && f.max[axis] <= n.max[axis] + 1e-6, `${model.id}: LOD stays within its placement envelope`);
    for (const attr of Object.values(far.geometry.attributes)) {
      assert.equal(attr.count, far.geometry.attributes.position.count);
      for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) assert.ok(Number.isFinite(attr.getComponent(i, k)));
    }
    assert.ok(far.geometry.attributes.position.isInterleavedBufferAttribute, 'all attributes use one vertex buffer within WebGPU limits');
    nearTotal += triangles(near.geometry); farTotal += triangles(far.geometry);
  }
  assert.ok(farTotal < nearTotal * .4, `far architecture: ${farTotal} vs ${nearTotal} triangles`);
  console.log(`Architecture prototypes: ${models.length}, near ${nearTotal}, far ${farTotal}`);
  catalogue.dispose();
});

test('far trees preserve species planting envelopes with at most 60 triangles and no detailed shadow casters', () => {
  const catalogue = city.createCatalogue(new Map());
  for (const species of ['cone', 'round', 'birch', 'oak']) {
    const model = catalogue.models.find(m => m.id === `tree-${species}`), near = model.lods[0].parts[0], far = model.lods[2].parts[0];
    assert.ok(triangles(far.geometry) <= 60 && triangles(far.geometry) < triangles(near.geometry) * .2, species);
    assert.equal(far.castShadow, false);
    assert.ok(far.material === near.material);
    for (const edge of ['min', 'max']) assert.ok(far.geometry.boundingBox[edge].distanceTo(near.geometry.boundingBox[edge]) < 1e-5, `${species}: ${edge}`);
  }
  for (const id of ['bench', 'slide', 'swings', 'goal', 'hoop', 'gazebo', 'flowerbed', 'fountain']) assert.equal(catalogue.models.find(m => m.id === id).lods[2], null, `${id}: tiny distant decoration does not consume draw work`);
  catalogue.dispose();
});
