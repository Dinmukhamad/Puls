import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ stdin: { contents: `export * from './transportRoutes.ts'; export * from '../world/cities.ts'; export * from '../world/worldSpec.ts'; export { sampleRoute } from '../world/generate.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const segmentDistance = (p, [ax, az, bx, bz]) => {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - ax - dx * t, p.z - az - dz * t);
};

test('active island keeps the real road loops and gives all six watercraft bridge-free canal courses', () => {
  const world = city.islandWorld(city.WORLD_X4), before = JSON.stringify(world.routes);
  const plans = city.createTransportPlans(world, () => .5), roads = plans.filter(p => !p.boats), boats = plans.filter(p => p.boats);
  assert.equal(JSON.stringify(world.routes), before, 'source world stays immutable');
  assert.equal(roads.length, 2); assert.equal(roads[0].route, world.routes[0].route); assert.equal(roads.reduce((sum, p) => sum + p.cars, 0), 19);
  const winding = route => route.points.reduce((sum, p, i, points) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.z - q.x * p.z; }, 0);
  assert.ok(winding(roads[0].route) * winding(roads[1].route) < 0, 'separate lanes travel in opposite directions');
  for (const plan of roads) for (const p of plan.route.points) assert.ok(Math.abs(Math.hypot(p.x, p.z) - world.roads.rings[0]) < .6, 'both lanes stay on the road');
  assert.equal(boats.reduce((sum, p) => sum + p.cars, 0), 6); assert.ok(boats.length >= 2);
  for (const plan of boats) {
    const route = plan.route;
    assert.equal(route.distance.length, route.points.length + 1); assert.ok(route.length > 20);
    assert.equal(route.distance.at(-1), route.length); assert.ok(route.distance.every((v, i, a) => !i || v > a[i - 1]));
    for (let distance = 0; distance < route.length; distance += .13) {
      const p = city.sampleRoute(route, distance); assert.equal(p.hidden, false);
      // All four corners of the largest hull stay in the canal throughout each rounded turn.
      for (const x of [-city.MAX_MARINE_WIDTH / 2, city.MAX_MARINE_WIDTH / 2]) for (const z of [-city.MAX_MARINE_LENGTH / 2, city.MAX_MARINE_LENGTH / 2]) {
        const point = { x: p.x + Math.cos(p.heading) * x + Math.sin(p.heading) * z, z: p.z - Math.sin(p.heading) * x + Math.cos(p.heading) * z };
        const r = Math.hypot(point.x, point.z);
        assert.ok(r > world.spec.quay + .2 && r < world.spec.bank - .2, 'hull clears both banks');
        assert.ok(world.roads.bridges.filter(b => b.canal).every(b => segmentDistance(point, b.road) > 1.7), 'hull and mast turn before the bridge deck');
      }
    }
    const a = city.sampleRoute(route, .001), b = city.sampleRoute(route, route.length - .001);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < .01, 'closed course does not teleport at its seam');
  }
});

test('watercraft require an existing boat route and a sufficiently wide, matching water surface', () => {
  for (const change of [world => { world.routes = world.routes.filter(p => !p.boats); }, world => { world.water.annuli = []; }, world => { world.spec = { ...world.spec, bank: world.spec.quay + 2 }; }]) {
    const world = city.islandWorld(city.WORLD_X4); change(world);
    assert.equal(city.createTransportPlans(world).filter(p => p.boats).length, 0);
  }
});

test('fleet bags contain the full collection and shuffling leaves the input intact', () => {
  const ids = [...city.ROAD_MODEL_IDS, ...city.MARINE_MODEL_IDS], before = [...ids], shuffled = city.shuffled(ids, () => 0);
  assert.equal(new Set(ids).size, 20); assert.equal(city.ROAD_MODEL_IDS.length, 14); assert.equal(city.MARINE_MODEL_IDS.length, 6);
  assert.deepEqual(ids, before); assert.notDeepEqual(shuffled, before); assert.deepEqual(shuffled.toSorted(), before.toSorted());
});
