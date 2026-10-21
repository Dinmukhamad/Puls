import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: `export * from './sales.ts'; export { segmentDistance } from './generate.ts'; export { WORLD_X4 } from './worldSpec.ts'; export { LAKE_LINES } from './land.ts'; export { RAIL_LINES, STATION, railPoint } from './railway.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { generateSalesWorld, SALES_CENTERS, segmentDistance, WORLD_X4, LAKE_LINES, RAIL_LINES, STATION, railPoint } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

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
test('the flat land reaches just past the districts\' outer band, the station at its bottom edge, all of it within the drawn radius', () => {
  const w = generateSalesWorld(), { width, depth } = w.land.rectangle;
  // As large as the island city's land, round the first 284 × 244.
  assert.deepEqual([width, depth], [2 * (LAKE_LINES.edgeX + 1), 2 * (LAKE_LINES.edgeZ + 2)]);
  assert.ok(width > 2 * 284 && depth > 2 * 244, `${width} × ${depth}`);
  // The station stands 8 past the land's bottom edge, as the first one stood past the first land's, on the boulevard's axis.
  assert.deepEqual(w.railway, RAIL_LINES.sales);
  assert.equal(w.railway.z, LAKE_LINES.edgeZ + 8);
  const forecourt = railPoint(w.railway, STATION.forecourt);
  assert.ok(forecourt.z > LAKE_LINES.edgeZ - 10 && forecourt.z < depth / 2, `the forecourt at ${forecourt.z}`);
  assert.ok(w.radius >= Math.hypot(width, depth) / 2 - 1 && w.spec.horizon === w.radius, `radius ${w.radius}`);
});
