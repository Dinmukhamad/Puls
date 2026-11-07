import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const compiled = await build({ stdin: { contents: `export * from './civicCenter.ts'; export * from './cities.ts'; export * from './generate.ts'; export * from './land.ts'; export * from './railway.ts'; export * from './stationSquare.ts'; export * from './worldSpec.ts'; export * from '../systems/crowd.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false });
const city = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const rectangleCorners = r => [-1, 1].flatMap(x => [-1, 1].map(z => ({ x: r.x + x * r.width / 2, z: r.z + z * r.depth / 2 })));
const baseWorld = () => { const w = city.generateWorld(city.WORLD_X4); city.clearMainland(w); if (w.railway) { city.clearRailway(w, w.railway); city.addStationSquare(w); } return w; };

test('the civic park preserves missions, player land addresses, rail and all outer traffic routes', () => {
  const before = baseWorld(), after = city.islandWorld(city.WORLD_X4);
  assert.ok(after.center);
  for (const key of ['districts', 'questSpots', 'railway', 'plots', 'routes']) assert.deepEqual(after[key], before[key], key);
  assert.deepEqual(city.landGrid(after, 3), city.landGrid(before, 3), 'existing bought/built cells keep their addresses and geometry');
  assert.deepEqual(after.roads.bridges.filter(b => b.canal), before.roads.bridges.filter(b => b.canal));
  assert.equal(after.roads.bridges.filter(b => !b.canal).length, 5, 'five short park access bridges replace the wheel');
  assert.ok(after.roads.bridges.filter(b => !b.canal).every(({ road: [ax, az, bx, bz] }) => Math.hypot(bx - ax, bz - az) < 5));
  const expected = after.center; city.addCivicCenter(after); assert.ok(after.center === expected, 'idempotent: no duplicate objects or paths');
  assert.equal(city.islandWorld(city.WORLD_V1).center, undefined, 'legacy city stays independent');
});

test('park contains every mission forecourt, keeps ponds open and bounds decoration cost', () => {
  const world = city.islandWorld(city.WORLD_X4), center = world.center;
  assert.equal(center.ponds.length, 2);
  for (const pond of center.ponds) {
    assert.equal(city.centerContains(center, pond), false);
    assert.ok(Math.abs(city.centerShoreDistance(center, pond) - pond.width / 2) < .001);
  }
  assert.equal(city.centerContains(center, { x: 0, z: 0 }), true);
  assert.equal(city.centerContains(center, { x: 90, z: 0 }), false);
  for (const courtyard of center.forecourts) for (const p of rectangleCorners(courtyard)) assert.equal(city.centerContains(center, p), true, 'forecourt does not float over water');
  const original = baseWorld(), additions = world.placements.filter(p => Math.hypot(p.x, p.z) < world.spec.lagoon);
  assert.ok(additions.length > 60 && additions.length < 190, `bounded park population: ${additions.length}`);
  for (const p of additions) assert.ok(city.centerContains(center, p, .25), `${p.kind} stands on land at ${p.x},${p.z}`);
  for (const tree of additions.filter(p => p.kind.startsWith('tree-'))) for (const path of center.paths) for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i];
    assert.ok(city.segmentDistance(tree.x, tree.z, [a.x, a.z, b.x, b.z]) >= path.width / 2 + .62 * tree.scale, 'mature crowns stay clear of walking paths');
  }
  assert.ok(world.placements.length - original.placements.length < 190);
});

test('pedestrian approaches stay on connected land and out of reflecting pools', () => {
  const world = city.islandWorld(city.WORLD_X4), center = world.center;
  for (const path of center.paths) for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], count = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) * 2);
    for (let k = 0; k <= count; k++) {
      const p = { x: a.x + (b.x - a.x) * k / count, z: a.z + (b.z - a.z) * k / count };
      assert.ok(city.centerContains(center, p), `walk stays on land at ${p.x.toFixed(2)},${p.z.toFixed(2)}`);
    }
  }
  const routes = city.createCrowdRoutes(world);
  assert.ok(routes.length > 10 && routes.some(r => r.radius === 0), 'park promenade is available to bounded walking population');
  for (const route of routes) for (const p of route.points) if (Math.hypot(p.x, p.z) < world.spec.lagoon) assert.ok(city.centerContains(center, p), 'walkers never cross reflecting pools');
});
