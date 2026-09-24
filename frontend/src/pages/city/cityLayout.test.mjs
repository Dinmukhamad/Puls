import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ entryPoints: [fileURLToPath(new URL('./cityLayout.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { RING_ROAD, OUTER_RING, QUAY, BANK, HORIZON, ROAD_HALF } = city;

const radius = (p) => Math.hypot(p.x, p.z);
const avenueGap = (p) => Math.min(...city.avenueAngles().map((a) => { const along = p.x * Math.cos(a) + p.z * Math.sin(a); return along <= 0 ? Infinity : Math.abs(-p.x * Math.sin(a) + p.z * Math.cos(a)); }));
const onRoad = (p, pad = 0) => Math.abs(radius(p) - RING_ROAD) <= ROAD_HALF + pad || Math.abs(radius(p) - OUTER_RING) <= ROAD_HALF + pad || (radius(p) >= RING_ROAD - pad && avenueGap(p) <= ROAD_HALF + pad);
const samples = (plan, step = .5) => { const list = []; for (let s = 0; s < plan.route.length; s += step) list.push(city.sampleRoute(plan.route, s)); return list; };

test('avenues leave between neighbouring districts and run in order around the city', () => {
  const angles = city.avenueAngles();
  assert.equal(angles.length, city.CITY_LOCATIONS.length);
  assert.deepEqual([...angles].sort((a, b) => a - b), angles);
  for (const a of angles) for (const d of city.CITY_LOCATIONS) assert.ok(city.angularDistance(a, Math.atan2(d.z, d.x)) > .5, 'an avenue must not run into a district');
});

test('every traffic loop is closed and smooth, with no jumps outside the hidden legs', () => {
  for (const plan of city.trafficRoutes()) {
    const { points, hidden } = plan.route;
    points.forEach((p, i) => {
      const next = points[(i + 1) % points.length];
      if (!hidden[i]) assert.ok(Math.hypot(next.x - p.x, next.z - p.z) < 2.3, `gap at point ${i}`);
    });
    assert.ok(plan.route.length > 50 && plan.cars > 0);
  }
});

test('cars stay on the roads and boats in the canal', () => {
  for (const plan of city.trafficRoutes()) for (const p of samples(plan)) {
    if (p.hidden) continue;
    if (plan.boats) assert.ok(radius(p) > QUAY + .8 && radius(p) < BANK - .8, `boat on the bank at r=${radius(p).toFixed(2)}`);
    else assert.ok(onRoad(p, .15) && radius(p) <= HORIZON + 1, `car off the road at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
  }
});

test('loops never share a lane or cross each other, so cars cannot collide', () => {
  const cars = city.trafficRoutes().filter((plan) => !plan.boats).map((plan) => samples(plan, .4).filter((p) => !p.hidden));
  for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
    for (const p of cars[a]) for (const q of cars[b]) {
      if (Math.abs(p.x - q.x) > 1 || Math.abs(p.z - q.z) > 1) continue;
      assert.ok(Math.hypot(p.x - q.x, p.z - q.z) > .45, `loops ${a} and ${b} meet at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    }
  }
});

test('traffic keeps to the right: the heading follows the loop and the lane is right of the centre line', () => {
  const ring = city.trafficRoutes().find((plan) => !plan.boats && plan.route.points.every((p) => Math.abs(radius(p) - RING_ROAD) < 1));
  for (const p of samples(ring, 3)) {
    // The right-hand side of this loop is the inside of the ring, so it must run towards growing angles.
    const tangent = { x: Math.sin(p.heading), z: Math.cos(p.heading) };
    assert.ok(-p.z * tangent.x + p.x * tangent.z > 0, 'the ring loop runs with the angle');
    assert.ok(radius(p) < RING_ROAD, 'and keeps to the inner lane');
  }
});

test('buildings and trees stay off the roads, out of the canal and off the car parks', () => {
  const parking = city.parkingLots();
  const { lots, parks } = city.mainlandLots();
  assert.ok(lots.length > 400 && parks.length > 20);
  for (const lot of lots) {
    assert.ok(lot.r > BANK + 2, 'no house in the canal');
    assert.ok(Math.abs(lot.r - OUTER_RING) > ROAD_HALF + lot.width / 2 - .3, 'no house on the outer ring road');
    assert.ok(avenueGap(lot) > ROAD_HALF + lot.width / 2, 'no house on an avenue');
    assert.ok(!parking.some((p) => city.insideParking(lot, p)), 'no house on a car park');
  }
  for (const tree of city.treeSpots(false, parks)) {
    assert.ok(radius(tree) < QUAY - .3 || radius(tree) > BANK + .3, 'no tree in the canal');
    // The crown is up to 0.62 units per unit of scale wide; none of it may hang over a road.
    assert.ok(!onRoad(tree, .62 * tree.scale), `tree crown over a road at ${tree.x.toFixed(1)}, ${tree.z.toFixed(1)}`);
    assert.ok(!parking.some((p) => city.insideParking(tree, p)), 'no tree on a car park');
  }
  assert.ok(city.mainlandLots(true).lots.length < lots.length, 'phones get fewer rows');
});

test('car parks sit on land between the roads and every stall is inside its lot', () => {
  for (const lot of city.parkingLots()) {
    assert.ok(lot.stalls.length >= 12);
    for (const stall of lot.stalls) {
      assert.ok(city.insideParking(stall, lot));
      assert.ok(!onRoad(stall, .5) && (radius(stall) < QUAY - .5 || radius(stall) > BANK + .5));
    }
  }
});

test('lamps and crossings line the streets without blocking them', () => {
  for (const lamp of city.lampSpots()) assert.ok(!onRoad(lamp, .2), `lamp on a road at ${lamp.x.toFixed(1)}, ${lamp.z.toFixed(1)}`);
  const crossings = city.crosswalks();
  assert.equal(crossings.length, city.radialAngles().length * 2 + city.avenueAngles().length * 3);
});
