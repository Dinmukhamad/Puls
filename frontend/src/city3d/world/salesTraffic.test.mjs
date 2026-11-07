import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: `export * from './sales.ts'; export * from './salesTraffic.ts'; export { sampleRoute } from './generate.ts'; export { landGrid, landCells } from './land.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const city = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const corner = (p, x, z) => ({ x: p.x + Math.cos(p.heading) * x + Math.sin(p.heading) * z, z: p.z - Math.sin(p.heading) * x + Math.cos(p.heading) * z });
const samples = function* (route, step = .13) { for (let s = 0; s < route.length; s += step) yield city.sampleRoute(route, s); };

test('Sales has 19 road slots on its rendered shore road and six craft on distinct lake courses', () => {
  const world = city.generateSalesWorld(), roads = world.routes.filter(p => !p.boats), boats = world.routes.filter(p => p.boats);
  assert.deepEqual(world.roads.rings, [city.SALES_ROAD_RADIUS]);
  assert.equal(roads.length, 1); assert.equal(roads[0].cars, 19); assert.equal(roads[0].speed, 3.6);
  assert.equal(boats.length, 2); assert.equal(boats.reduce((sum, p) => sum + p.cars, 0), 6);
  assert.ok(boats[0].route.points.every(p => p.x < 0) && boats[1].route.points.every(p => p.x > 0));
  for (const { route } of world.routes) {
    assert.ok(route.length > 90); assert.equal(route.distance.length, route.points.length + 1);
    assert.ok(route.distance.every((value, i, values) => !i || value > values[i - 1]));
    assert.equal(route.distance.at(-1), route.length);
    const a = city.sampleRoute(route, .001), b = city.sampleRoute(route, route.length - .001);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < .01, 'closed course has no teleport at its seam');
  }
  assert.deepEqual(city.generateSalesWorld(), world, 'generation remains deterministic');
});

test('both traffic lanes fit the largest truck and remain inside the nonbuildable shore reservation', () => {
  const world = city.generateSalesWorld(), route = world.routes.find(p => !p.boats).route;
  let maximum = 0;
  for (const p of samples(route)) for (const mirrored of [false, true]) {
    const radius = Math.hypot(p.x, p.z), ratio = mirrored ? (2 * city.SALES_ROAD_RADIUS - radius) / radius : 1;
    const pose = { x: p.x * ratio, z: p.z * ratio, heading: p.heading + (mirrored ? Math.PI : 0) };
    for (const x of [-.4, .4]) for (const z of [-2.03, 2.03]) {
      const q = corner(pose, x, z), r = Math.hypot(q.x, q.z); maximum = Math.max(maximum, r);
      assert.ok(r > city.SALES_ROAD_RADIUS - 1 && r < city.SALES_ROAD_RADIUS + 1, 'truck footprint stays on rendered asphalt');
    }
  }
  assert.ok(maximum < 53 && maximum < 58 - 4, 'road stays clear of the buildable cells');
  // Both original and repartitioned layouts must retain their original cells and exclude the public shore road.
  for (const count of [2, 3, 4, 5]) {
    const grid = city.landGrid(world, count), cells = city.landCells(grid);
    assert.ok(cells.length > 1000);
    assert.ok(cells.every(c => c.corners.every(p => Math.hypot(p.x, p.z) > maximum + 4)), `${count} districts: road does not consume any cell`);
  }
});

test('full yacht footprints stay on water and clear every campus or footbridge platform throughout turns', () => {
  const world = city.generateSalesWorld();
  for (const plan of world.routes.filter(p => p.boats)) for (const p of samples(plan.route)) {
    for (const x of [-.65, .65]) for (const z of [-2.45, 2.45]) {
      const q = corner(p, x, z);
      assert.ok(Math.hypot(q.x, q.z) < 46 - .5, 'largest hull clears the lake shore');
      for (const platform of world.land.platforms) {
        assert.ok(Math.abs(q.x - platform.x) > platform.width / 2 + .5 || Math.abs(q.z - platform.z) > platform.depth / 2 + .5, 'hull and mast clear campus and footbridge');
      }
    }
  }
});
