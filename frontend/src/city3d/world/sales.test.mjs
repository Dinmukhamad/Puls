import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: `export * from './sales.ts'; export { segmentDistance } from './generate.ts'; export { WORLD_X4 } from './worldSpec.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { generateSalesWorld, SALES_CENTERS, segmentDistance, WORLD_X4 } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

test('sales has a rectangular footprint, a lake and ten stable central slots', () => {
  const w = generateSalesWorld();
  assert.equal(w.spec.name, 'sales'); assert.equal(w.roads.rings.length, 0);
  assert.ok(w.land.rectangle.width > w.land.rectangle.depth);
  assert.equal(SALES_CENTERS.length, 10); assert.equal(new Set(SALES_CENTERS.map(c => c.id)).size, 10);
  for (const c of SALES_CENTERS) assert.ok(w.land.platforms.some(p => Math.abs(c.x - p.x) + 5 <= p.width / 2 && Math.abs(c.z - p.z) + 5 <= p.depth / 2));
});
test('world generation is deterministic and does not mutate Support', () => {
  const original = JSON.stringify(WORLD_X4);
  assert.deepEqual(generateSalesWorld(), generateSalesWorld());
  assert.equal(JSON.stringify(WORLD_X4), original);
});
test('the lake city has no houses of its own: its land is the districts\' plots, its trees and lamps line the lake and the boulevard', () => {
  const w = generateSalesWorld();
  assert.ok(!w.placements.some(p => ['cottage', 'glass-tower', 'house', 'block', 'tower'].includes(p.kind)));
  for (const p of w.placements.filter(p => p.kind.startsWith('tree-') || p.kind === 'lamp')) {
    assert.ok(w.roads.streets.every(road => segmentDistance(p.x, p.z, road) > 2), `${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} on a street`);
  }
});
test('cars follow closed rectilinear routes and do not cross the lake', () => {
  const w = generateSalesWorld();
  for (const { route } of w.routes) {
    assert.ok(route.length > 0); assert.ok(route.points.every(p => Math.hypot(p.x, p.z) > 46));
  }
});
