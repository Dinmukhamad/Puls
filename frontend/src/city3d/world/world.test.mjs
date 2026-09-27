import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const load = async (contents) => {
  const built = await build({ stdin: { contents, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
};
const gen = await load(`export * from './generate.ts'; export * from './worldSpec.ts';`);
const old = await load(`export * from '../../pages/city/cityLayout.ts';`);
const { ROAD_HALF, BRIDGE_HALF, WORLD_V1, WORLD_X4 } = gen;

// The first call runs cold, as it does when the city opens.
const started = performance.now();
const X4 = gen.generateWorld(WORLD_X4);
const coldMs = performance.now() - started;
const V1 = gen.generateWorld(WORLD_V1);
const WORLDS = [V1, X4];

const radius = (p) => Math.hypot(p.x, p.z);
const same = (a, b) => gen.angularDistance(a, b) < 1e-6;
const BUILDINGS = new Set(['house', 'office', 'industry', 'block', 'tower', 'port']), TREES = new Set(['tree-cone', 'tree-round']);
const KINDS = [...BUILDINGS, ...TREES, 'lamp', 'car-parked'];
const ofKind = (world, kinds) => world.placements.filter((p) => kinds.has(p.kind));
const segments = (world) => [...world.roads.streets, ...world.roads.bridges.map((b) => b.road)];
const onRoad = (world, p, pad = 0) => world.roads.rings.some((R) => Math.abs(radius(p) - R) <= ROAD_HALF + pad) || segments(world).some((road) => gen.segmentDistance(p.x, p.z, road) <= ROAD_HALF + pad);
const samples = (plan, step = .5) => { const list = []; for (let s = 0; s < plan.route.length; s += step) list.push(gen.sampleRoute(plan.route, s)); return list; };
const close = (a, b, message, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${message}: ${a} vs ${b}`);
const forWorlds = (name, check) => { for (const world of WORLDS) test(`${world.spec.name}: ${name}`, () => check(world, world.spec, gen.cityPlan(world.spec))); };

forWorlds('avenues leave between neighbouring inner districts and run in order around the city', (world, spec, plan) => {
  const angles = plan.avenues.filter((v) => v.ring === 0).map((v) => v.angle), inner = plan.districts.filter((_, i) => spec.districts[i].ring === 0);
  assert.equal(angles.length, inner.length);
  assert.deepEqual([...angles].sort((a, b) => a - b), angles);
  for (const a of angles) for (const d of inner) assert.ok(gen.angularDistance(a, d.angle) > .5, 'an avenue must not run into an inner district');
});

forWorlds('every traffic loop is closed and smooth, with no jumps outside the hidden legs', (world) => {
  for (const plan of world.routes) {
    const { points, hidden } = plan.route;
    points.forEach((p, i) => {
      const next = points[(i + 1) % points.length];
      if (!hidden[i]) assert.ok(Math.hypot(next.x - p.x, next.z - p.z) < 2.3, `gap at point ${i}`);
    });
    assert.ok(plan.route.length > 50 && plan.cars > 0);
  }
});

forWorlds('cars stay on the roads and boats in the canal', (world, spec) => {
  for (const plan of world.routes) for (const p of samples(plan)) {
    if (p.hidden) continue;
    if (plan.boats) assert.ok(radius(p) > spec.quay + .8 && radius(p) < spec.bank - .8, `boat on the bank at r=${radius(p).toFixed(2)}`);
    else assert.ok(onRoad(world, p, .15) && radius(p) <= spec.horizon + 1, `car off the road at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
  }
});

forWorlds('loops never share a lane or cross each other, so cars cannot collide', (world) => {
  // Every sample goes into a one-unit grid cell; only samples of other loops in the 3 × 3 cells around can meet it.
  const grid = new Map(), key = (x, z) => `${x},${z}`;
  world.routes.filter((plan) => !plan.boats).forEach((plan, loop) => samples(plan, .4).filter((p) => !p.hidden).forEach((p) => {
    const k = key(Math.floor(p.x), Math.floor(p.z));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ ...p, loop });
  }));
  for (const [k, list] of grid) {
    const [cx, cz] = k.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const q of grid.get(key(cx + dx, cz + dz)) ?? []) for (const p of list) {
      if (p.loop >= q.loop || Math.abs(p.x - q.x) > 1 || Math.abs(p.z - q.z) > 1) continue;
      assert.ok(Math.hypot(p.x - q.x, p.z - q.z) > .45, `loops ${p.loop} and ${q.loop} meet at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    }
  }
});

forWorlds('traffic keeps to the right: the heading follows the loop and the lane is right of the centre line', (world, spec) => {
  const ringRoad = spec.roadRings[0], ring = world.routes.find((plan) => !plan.boats && plan.route.points.every((p) => Math.abs(radius(p) - ringRoad) < 1));
  for (const p of samples(ring, 3)) {
    // The right-hand side of this loop is the inside of the ring, so it must run towards growing angles.
    const tangent = { x: Math.sin(p.heading), z: Math.cos(p.heading) };
    assert.ok(-p.z * tangent.x + p.x * tangent.z > 0, 'the ring loop runs with the angle');
    assert.ok(radius(p) < ringRoad, 'and keeps to the inner lane');
  }
  // Everywhere away from junctions, every car is right of the centre line of its road (at the horizon the lane bends
  // into the hidden leg, in the fog).
  const streets = segments(world);
  let checked = 0;
  for (const plan of world.routes) if (!plan.boats) for (const p of samples(plan, 2)) {
    if (p.hidden || radius(p) > spec.horizon - 3) continue;
    const right = { x: -Math.cos(p.heading), z: Math.sin(p.heading) }, r = radius(p);
    const rings = world.roads.rings.filter((R) => Math.abs(r - R) < 2.5), near = streets.filter((road) => gen.segmentDistance(p.x, p.z, road) < 2.5);
    if (rings.length === 1 && !near.length) {
      assert.ok((r - rings[0]) * (p.x * right.x + p.z * right.z) / r > .3, `left of the ring road at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`); checked++;
    } else if (!rings.length && near.length === 1) {
      const [ax, az, bx, bz] = near[0], length = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / length, uz = (bz - az) / length, t = (p.x - ax) * ux + (p.z - az) * uz;
      assert.ok((p.x - ax - ux * t) * right.x + (p.z - az - uz * t) * right.z > .3, `left of the avenue at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`); checked++;
    }
  }
  assert.ok(checked > 100);
});

forWorlds('buildings and trees stay off the roads, out of the water and off the car parks', (world, spec) => {
  const parking = world.roads.parking, buildings = ofKind(world, BUILDINGS), streets = segments(world);
  assert.ok(buildings.length > 400 && world.parks.length > 20);
  for (const b of buildings) {
    const r = radius(b), half = b.width / 2;
    assert.ok(r > spec.bank + 2 && r < spec.horizon - 2, 'no house in the canal or beyond the horizon');
    for (const R of world.roads.rings) assert.ok(Math.abs(r - R) > ROAD_HALF + half - .3, 'no house on a ring road');
    for (const road of streets) assert.ok(gen.segmentDistance(b.x, b.z, road) > ROAD_HALF + half, `${b.kind} on a street at ${b.x.toFixed(1)}, ${b.z.toFixed(1)}`);
    assert.ok(!parking.some((p) => gen.insideParking(b, p)), 'no house on a car park');
  }
  for (const tree of ofKind(world, TREES)) {
    const r = radius(tree);
    assert.ok(r < spec.quay - .3 || r > spec.bank + .3, 'no tree in the canal');
    assert.ok(r > spec.lagoon + .3 || r < spec.plazaIslet - .3, 'no tree in the lagoon');
    // The crown is up to 0.62 units per unit of scale wide; none of it may hang over a road.
    assert.ok(!onRoad(world, tree, .62 * tree.scale), `tree crown over a road at ${tree.x.toFixed(1)}, ${tree.z.toFixed(1)}`);
    assert.ok(!parking.some((p) => gen.insideParking(tree, p)), 'no tree on a car park');
  }
});

forWorlds('district islands fit the lagoon, clear of the plaza, the ring road, the bridges and each other', (world, spec, plan) => {
  const { islet, plazaIslet, lagoon } = spec;
  assert.ok(lagoon < spec.roadRings[0] - ROAD_HALF, 'the ring road runs on land');
  for (const d of plan.districts) {
    assert.ok(d.r - islet > plazaIslet + 1.5, 'a bridge leads from the plaza');
    assert.ok(d.r + islet < lagoon, 'the island stays inside the lagoon');
    // Cross streets run on past islands of other directions: deck and railings (1.38) keep half a unit of water.
    for (const v of plan.avenues) {
      if (v.ring || same(v.angle, d.angle)) continue;
      const across = Math.abs(-d.x * Math.sin(v.angle) + d.z * Math.cos(v.angle)), along = d.x * Math.cos(v.angle) + d.z * Math.sin(v.angle);
      if (along > 0) assert.ok(across - islet - BRIDGE_HALF >= .5, `a cross-street bridge passes ${(across - islet - BRIDGE_HALF).toFixed(3)} from the ${d.id} island`);
    }
    for (const e of plan.districts) if (e !== d) assert.ok(Math.hypot(d.x - e.x, d.z - e.z) > islet * 2 + 1, 'water between islands');
    // Corners of the landmark plinth (5.7 × 5.3 units before scaling) stay on the island.
    for (const x of [-2.85, 2.85]) for (const z of [-2.65, 2.65]) assert.ok(Math.hypot(x, z) * spec.districtScale < islet - .2, `${d.id} overhangs its island`);
    const landings = world.roads.bridges.filter(({ road: [ax, az, bx, bz] }) => [[ax, az], [bx, bz]].some(([x, z]) => Math.abs(Math.hypot(x - d.x, z - d.z) - islet) < .35));
    assert.ok(landings.length >= 2, `bridges lead to ${d.id} and on outwards`);
  }
  const wet = (x, z) => { const r = Math.hypot(x, z); return r > plazaIslet && r < lagoon && plan.districts.every((d) => Math.hypot(d.x - x, d.z - z) > islet); };
  for (const { road, canal } of world.roads.bridges) {
    const [ax, az, bx, bz] = road, length = Math.hypot(bx - ax, bz - az), end = canal ? .75 : .35;
    for (let t = end; t <= length - end; t += .25) {
      const x = ax + (bx - ax) * t / length, z = az + (bz - az) * t / length, r = Math.hypot(x, z);
      assert.ok(canal ? r > spec.quay && r < spec.bank : wet(x, z), `a bridge stands on land at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
    if (canal) continue;
    // A bridge passes every island it does not lead to half a unit clear.
    for (const d of plan.districts) if (!same(d.angle, Math.atan2(az + bz, ax + bx))) assert.ok(gen.segmentDistance(d.x, d.z, road) - islet - BRIDGE_HALF >= .5, `a bridge grazes the ${d.id} island`);
  }
});

forWorlds('car parks sit on land between the roads and every stall is inside its lot', (world, spec) => {
  assert.ok(world.roads.parking.length >= 3);
  for (const lot of world.roads.parking) {
    assert.ok(lot.stalls.length >= 12);
    for (const stall of lot.stalls) {
      assert.ok(gen.insideParking(stall, lot));
      const r = radius(stall);
      assert.ok(!onRoad(world, stall, .5) && r > spec.lagoon + .5 && (r < spec.quay - .5 || r > spec.bank + .5));
    }
  }
  for (const car of ofKind(world, new Set(['car-parked']))) assert.ok(world.roads.parking.some((lot) => gen.insideParking(car, lot)), 'a parked car stands on a car park');
});

forWorlds('lamps and crossings line the streets without blocking them', (world, spec, plan) => {
  const canalBridges = world.roads.bridges.filter((b) => b.canal).map((b) => b.road);
  for (const lamp of ofKind(world, new Set(['lamp']))) {
    assert.ok(!onRoad(world, lamp, .2), `lamp on a road at ${lamp.x.toFixed(1)}, ${lamp.z.toFixed(1)}`);
    const r = radius(lamp);
    // Lamps over the canal stand on the arch bridges' railings.
    if (r > spec.quay && r < spec.bank) assert.ok(canalBridges.some((road) => gen.segmentDistance(lamp.x, lamp.z, road) < 1.6), 'a lamp in the canal');
  }
  const crossings = world.roads.crosswalks, streets = segments(world);
  assert.equal(crossings.length, plan.radials.length + plan.avenues.reduce((n, v) => n + 1 + 2 * (spec.roadRings.length - 1 - v.ring), 0));
  for (const c of crossings) assert.ok(streets.some((road) => gen.segmentDistance(c.x, c.z, road) < .01), 'a zebra crossing lies on a street');
});

forWorlds('placements are well formed and on land', (world, spec) => {
  for (const p of world.placements) {
    assert.ok(KINDS.includes(p.kind), p.kind);
    assert.ok([p.x, p.z, p.rotation, p.scale, p.width].every(Number.isFinite) && Number.isInteger(p.variant) && p.variant >= 0 && p.scale > 0 && p.width >= 0);
    const r = radius(p), onIslet = world.land.islets.some((i) => Math.hypot(p.x - i.x, p.z - i.z) < i.r);
    if (p.kind !== 'lamp') assert.ok(onIslet || world.land.annuli.some((a) => r > a.inner && r < a.outer), `${p.kind} in the water at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
  }
  assert.ok(world.radius >= spec.horizon);
});

forWorlds('the world is the same for the same seed and differs for another', (world, spec) => {
  assert.deepEqual(gen.generateWorld(spec), world);
  const other = gen.generateWorld({ ...spec, seed: spec.seed + 1 });
  assert.notDeepEqual(other.placements, world.placements);
  assert.deepEqual(other.roads.streets, world.roads.streets);
});

test('v1 reproduces the old city: districts, roads, lots, trees, lamps, car parks and traffic', () => {
  const plan = gen.cityPlan(WORLD_V1), each = (a, b, name, fields) => { assert.equal(a.length, b.length, `${name} count`); a.forEach((x, i) => fields.forEach((f) => close(x[f], b[i][f], `${name} ${i} ${f}`))); };
  each(V1.districts, old.CITY_LOCATIONS, 'district', ['x', 'z']);
  V1.districts.forEach((d, i) => { const o = old.CITY_LOCATIONS[i]; assert.equal(d.id, o.id); assert.equal(d.color, o.color); assert.equal(d.soon, !!o.soon); });
  plan.avenues.forEach((v, i) => close(v.angle, old.avenueAngles()[i], 'avenue'));
  plan.radials.forEach((a, i) => close(a, old.radialAngles()[i], 'radial'));
  for (const name of ['PLAZA', 'ISLET', 'LAGOON', 'QUAY', 'BANK', 'PROMENADE', 'HORIZON', 'SKYLINE_ANGLE', 'DISTRICT_SCALE']) assert.ok(Object.values(WORLD_V1).includes(old[name]), name);
  assert.deepEqual(WORLD_V1.roadRings, [old.RING_ROAD, old.OUTER_RING]);
  // Lagoon bridges are the old spans; streets and bridges together cover the old streets and avenues.
  const key = (r) => r.map((v) => v.toFixed(6)).join(), lagoon = V1.roads.bridges.filter((b) => !b.canal).map((b) => key(b.road)).sort();
  assert.deepEqual(lagoon, old.bridgeSpans().map(key).sort());
  const covered = segments(V1);
  for (const [ax, az, bx, bz] of [...old.innerRoads(), ...old.avenues()]) for (let t = 0; t <= 1; t += .01) {
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    assert.ok(covered.some((road) => gen.segmentDistance(x, z, road) < 1e-6), `old street not covered at ${x.toFixed(1)}, ${z.toFixed(1)}`);
  }
  const { lots, parks } = old.mainlandLots(), kind = (l) => (l.zone === 'industry' ? 'industry' : l.zone === 'houses' ? (l.roll < .8 ? 'house' : 'office') : l.zone === 'blocks' ? 'block' : 'tower');
  const buildings = ofKind(V1, BUILDINGS);
  each(buildings, lots, 'lot', ['x', 'z', 'rotation']);
  buildings.forEach((b, i) => { assert.equal(b.kind, kind(lots[i])); if (b.kind !== 'block' && b.kind !== 'tower') close(b.width, lots[i].width, 'lot width'); });
  each(V1.parks, parks, 'park', ['x', 'z']);
  const trees = old.treeSpots(false, parks), mine = ofKind(V1, TREES);
  each(mine, trees, 'tree', ['x', 'z', 'scale']);
  mine.forEach((t, i) => assert.equal(t.kind, trees[i].round ? 'tree-round' : 'tree-cone'));
  each(ofKind(V1, new Set(['lamp'])), old.lampSpots(), 'lamp', ['x', 'z']);
  each(V1.roads.crosswalks, old.crosswalks(), 'crosswalk', ['x', 'z', 'angle']);
  const parking = old.parkingLots();
  each(V1.roads.parking, parking, 'car park', ['x', 'z', 'angle', 'length', 'depth']);
  V1.roads.parking.forEach((lot, i) => each(lot.stalls, parking[i].stalls, 'stall', ['x', 'z', 'rotation']));
  // The old scene parked a car on a stall unless rng(11) said it stays free.
  const random = old.rng(11), parked = [];
  parking.forEach((lot, i) => lot.stalls.forEach((stall) => { if (!(random() < (i === 2 ? .5 : .35))) parked.push(stall); }));
  each(ofKind(V1, new Set(['car-parked'])), parked, 'parked car', ['x', 'z', 'rotation']);
  const routes = old.trafficRoutes();
  assert.equal(V1.routes.length, routes.length);
  V1.routes.forEach((plan, i) => {
    const o = routes[i];
    assert.equal(plan.cars, o.cars); assert.equal(plan.speed, o.speed); assert.equal(!!plan.boats, !!o.boats);
    assert.deepEqual(plan.route.hidden, o.route.hidden);
    each(plan.route.points, o.route.points, `route ${i} point`, ['x', 'z']);
  });
});

test('x4: ten district islands on two rings, four times the city, and no empty corner of the map', () => {
  const plan = gen.cityPlan(WORLD_X4);
  assert.equal(X4.districts.length, 10);
  assert.deepEqual(X4.districts.slice(0, 5).map((d) => d.id), V1.districts.map((d) => d.id));
  X4.districts.slice(0, 5).forEach((d, i) => { close(d.x, V1.districts[i].x, 'inner districts stay'); close(d.z, V1.districts[i].z, 'inner districts stay'); });
  const future = WORLD_X4.districts.filter((d) => d.ring === 1);
  assert.deepEqual(future.map((d) => d.id), ['future-1', 'future-2', 'future-3', 'future-4', 'future-5']);
  assert.ok(future.every((d) => d.soon));
  // The outer islands stand on v1's cross streets.
  const crossStreets = gen.cityPlan(WORLD_V1).avenues.map((v) => v.angle);
  for (const d of plan.districts.slice(5)) assert.ok(crossStreets.some((a) => gen.angularDistance(a, d.angle) < 1e-9), `${d.id} is off the cross streets`);
  const ratio = X4.placements.length / V1.placements.length, buildings = ofKind(X4, BUILDINGS).length / ofKind(V1, BUILDINGS).length;
  assert.ok(ratio >= 3.5, `x4 has ${ratio.toFixed(2)}× v1's placements`);
  assert.ok(buildings >= 3.5, `x4 has ${buildings.toFixed(2)}× v1's buildings`);
  for (const k of KINDS) assert.ok(X4.placements.some((p) => p.kind === k), `x4 has no ${k}`);
  assert.ok(new Set(WORLD_X4.mainland.map((row) => row.zone)).size >= 4 && WORLD_X4.sectors.some((z) => z.zone === 'industry') && WORLD_X4.sectors.some((z) => z.zone === 'port'));
  assert.ok(ofKind(X4, new Set(['port'])).some((p) => radius(p) < WORLD_X4.bank + 6), 'the port reaches the water');
  // Every 30° sector, in every 40-unit band from the canal to the fog, has buildings.
  const { bank, horizon } = WORLD_X4;
  for (let sector = 0; sector < 12; sector++) for (let from = bank; from < horizon - 20; from += 40) {
    const inside = X4.placements.filter((p) => { const r = radius(p), a = (Math.atan2(p.z, p.x) + Math.PI * 2) % (Math.PI * 2); return r >= from && r < from + 40 && a >= sector * Math.PI / 6 && a < (sector + 1) * Math.PI / 6; });
    assert.ok(inside.filter((p) => BUILDINGS.has(p.kind)).length >= 5, `sector ${sector * 30}° at ${from.toFixed(0)}…${(from + 40).toFixed(0)} is empty`);
  }
});

test('generation is fast', () => {
  const warm = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); gen.generateWorld(WORLD_X4); warm.push(performance.now() - t); }
  const median = warm.sort((a, b) => a - b)[2];
  const counts = (world) => `${world.placements.length} placements, ${world.routes.length} loops, ${world.routes.reduce((n, r) => n + r.cars, 0)} cars`;
  console.log(`# x4 generation: ${coldMs.toFixed(1)} ms cold, ${median.toFixed(1)} ms warm (median of 5); v1 ${counts(V1)}; x4 ${counts(X4)}`);
  assert.ok(median < 60, `x4 takes ${median.toFixed(1)} ms`);
});
