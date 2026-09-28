import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const load = async (contents) => {
  const built = await build({ stdin: { contents, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
};
const gen = await load(`export * from './generate.ts'; export * from './worldSpec.ts';`);
const reliefModule = await load(`export * from './relief.ts';`);
const old = await load(`export * from '../../pages/city/cityLayout.ts';`);
const { ROAD_HALF, BRIDGE_HALF, WORLD_V1, WORLD_X4 } = gen;

// The first call runs cold, as it does when the city opens.
const started = performance.now();
const RAW_X4 = gen.generateWorld(WORLD_X4);
const coldMs = performance.now() - started;
// The group city's quarters are drawn by stage; the tests below describe the city with every quarter built.
const built = (world) => ({ ...world, placements: [...world.placements, ...world.sites.flatMap((s) => s.placements)], surfaces: [...world.surfaces, ...world.sites.flatMap((s) => s.surfaces)] });
const X4 = built(RAW_X4);
const V1 = gen.generateWorld(WORLD_V1);
const WORLDS = [V1, X4];

const radius = (p) => Math.hypot(p.x, p.z);
const same = (a, b) => gen.angularDistance(a, b) < 1e-6;
const BUILDINGS = new Set(['house', 'office', 'industry', 'block', 'tower', 'port', 'section', 'glass-tower', 'cottage']), TREES = new Set(['tree-cone', 'tree-round', 'tree-birch', 'tree-oak']);
const FURNITURE = ['bench', 'slide', 'swings', 'climber', 'sandbox', 'goal', 'hoop', 'gazebo', 'flowerbed', 'bush', 'hedge', 'planter', 'fountain'];
const KINDS = [...BUILDINGS, ...TREES, 'lamp', 'car-parked', 'roof', ...FURNITURE];
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
  // Sections and office buildings are long boxes: their corners are checked with the complexes below.
  for (const b of buildings.filter((p) => p.kind !== 'section' && p.kind !== 'glass-tower' && p.kind !== 'cottage')) {
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
    // Lamps may stand on bridges; the forests stand on the hills past the horizon.
    if (p.kind !== 'lamp' && !(p.lift && r > spec.horizon)) assert.ok(onIslet || world.land.annuli.some((a) => r > a.inner && r < a.outer), `${p.kind} in the water at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
  }
  assert.ok(world.radius >= spec.horizon);
});

forWorlds('the world is the same for the same seed and differs for another', (world, spec) => {
  const again = gen.generateWorld(spec);
  assert.deepEqual(world === X4 ? built(again) : again, world);
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
  // The forests on the hills past the horizon are new; the city's own trees are the old ones.
  const trees = old.treeSpots(false, parks), mine = ofKind(V1, TREES).filter((p) => !p.lift);
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
  X4.districts.slice(0, 5).forEach((d, i) => {
    close(Math.atan2(d.z, d.x), Math.atan2(V1.districts[i].z, V1.districts[i].x), 'familiar district direction stays');
    assert.ok(radius(d) >= radius(V1.districts[i]) * 1.65, 'main islands have room around the central plaza');
  });
  const future = WORLD_X4.districts.filter((d) => d.ring === 1);
  assert.deepEqual(future.map((d) => d.id), ['future-1', 'future-2', 'future-3', 'future-4', 'future-5']);
  assert.ok(future.every((d) => d.soon));
  // The outer islands stand on v1's cross streets.
  const crossStreets = gen.cityPlan(WORLD_V1).avenues.map((v) => v.angle);
  for (const d of plan.districts.slice(5)) assert.ok(crossStreets.some((a) => gen.angularDistance(a, d.angle) < 1e-9), `${d.id} is off the cross streets`);
  const ratio = X4.placements.length / V1.placements.length, buildings = ofKind(X4, BUILDINGS).length / ofKind(V1, BUILDINGS).length;
  assert.ok(ratio >= 3.5, `x4 has ${ratio.toFixed(2)}× v1's placements`);
  assert.ok(buildings >= 3.5, `x4 has ${buildings.toFixed(2)}× v1's buildings`);
  // The canal houses (and their offices), the blocks, towers and industry are complexes and business quarters in x4,
  // and the suburbs are cottages.
  for (const k of KINDS.filter((kind) => !['office', 'block', 'tower', 'industry', 'house'].includes(kind))) assert.ok(X4.placements.some((p) => p.kind === k), `x4 has no ${k}`);
  assert.ok(X4.complexes.length >= 40 && X4.walks.length >= 2 * X4.complexes.length, `x4 has ${X4.complexes.length} complexes`);
  assert.ok(new Set(WORLD_X4.mainland.map((row) => row.zone)).size >= 4 && WORLD_X4.sectors.some((z) => z.zone === 'port'));
  assert.ok(ofKind(X4, new Set(['port'])).some((p) => radius(p) < WORLD_X4.bank + 6), 'the port reaches the water');
  // Every 30° sector, in every 40-unit band from the canal to the fog, has buildings.
  const { bank, horizon } = WORLD_X4;
  for (let sector = 0; sector < 12; sector++) for (let from = bank; from < horizon - 20; from += 40) {
    const inside = X4.placements.filter((p) => { const r = radius(p), a = (Math.atan2(p.z, p.x) + Math.PI * 2) % (Math.PI * 2); return r >= from && r < from + 40 && a >= sector * Math.PI / 6 && a < (sector + 1) * Math.PI / 6; });
    // Built up: five buildings, or as much floor as that in a few big office buildings.
    const built = inside.filter((p) => BUILDINGS.has(p.kind)), area = built.reduce((sum, p) => sum + p.width * (p.depth ?? p.width), 0);
    assert.ok(built.length >= 5 || area >= 60, `sector ${sector * 30}° at ${from.toFixed(0)}…${(from + 40).toFixed(0)} is empty`);
  }
});

test('x4: spacious water corridors separate every main and reserved island without scaling landmarks', () => {
  assert.equal(WORLD_X4.islet, WORLD_V1.islet);
  assert.equal(WORLD_X4.districtScale, WORLD_V1.districtScale);
  for (const d of X4.districts) {
    assert.ok(radius(d) - WORLD_X4.islet - WORLD_X4.plazaIslet >= 12, `${d.id} crowds the plaza`);
    assert.ok(WORLD_X4.lagoon - radius(d) - WORLD_X4.islet >= 5, `${d.id} crowds the shore`);
    for (const e of X4.districts) if (d !== e) {
      assert.ok(Math.hypot(d.x - e.x, d.z - e.z) - WORLD_X4.islet * 2 >= 14, `${d.id}/${e.id} have too little open water`);
    }
  }
  close(WORLD_X4.bank - WORLD_X4.quay, WORLD_V1.bank - WORLD_V1.quay, 'canal width stays navigable');
  close(WORLD_X4.promenade - WORLD_X4.roadRings[0], WORLD_V1.promenade - WORLD_V1.roadRings[0], 'green belt keeps the original road clearance');
});

test('generation is fast', () => {
  const warm = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); gen.generateWorld(WORLD_X4); warm.push(performance.now() - t); }
  // The best of five: other test files run in parallel and slow single runs down; the best run is the generator's own cost.
  const sorted = warm.sort((a, b) => a - b), best = sorted[0], median = sorted[2];
  const counts = (world) => `${world.placements.length} placements, ${world.routes.length} loops, ${world.routes.reduce((n, r) => n + r.cars, 0)} cars`;
  console.log(`# x4 generation: ${coldMs.toFixed(1)} ms cold, ${best.toFixed(1)} ms best, ${median.toFixed(1)} ms median of 5; v1 ${counts(V1)}; x4 ${counts(X4)}`);
  // The x4 world with its complexes, business quarters and garden suburb is about 22 000 placements; it builds once when the city opens.
  assert.ok(best < 80, `x4 takes ${best.toFixed(1)} ms`);
});

/** The corners of a section's footprint (its +x turned along its rotation). */
const corners = (p) => { const c = Math.cos(p.rotation), s = Math.sin(p.rotation), hw = p.width / 2, hd = p.depth / 2; return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: p.x + c * hw * a + s * hd * b, z: p.z - s * hw * a + c * hd * b })); };
/** Is p inside a complex's footprint grown by pad (its length along `angle`, as terrain marks)? */
const inComplex = (p, c, pad = 0) => { const ux = Math.sin(c.angle), uz = Math.cos(c.angle), dx = p.x - c.x, dz = p.z - c.z; return Math.abs(dx * ux + dz * uz) <= c.length / 2 + pad && Math.abs(dz * ux - dx * uz) <= c.depth / 2 + pad; };

test('x4: residential complexes fill their bands between the avenues, clear of roads, sectors, car parks and each other', () => {
  const plan = gen.cityPlan(WORLD_X4), sections = X4.placements.filter((p) => p.kind === 'section' || p.kind === 'glass-tower'), streets = segments(X4);
  assert.equal(V1.complexes.length, 0, 'v1 keeps its rows of houses');
  for (const band of WORLD_X4.complexes) assert.ok(X4.complexes.some((c) => radius(c) > band.from && radius(c) < band.to), `band ${band.from}…${band.to} is empty`);
  for (const p of sections) {
    if (p.kind === 'section') assert.ok(p.width > 2 && p.width < 5.6 && p.depth >= 2 && p.depth <= 2.6 && p.variant >= 0 && p.variant <= 6, `a section is a normal building: ${p.width.toFixed(2)} × ${p.depth}, class ${p.variant}`);
    else assert.ok(p.width > 3 && p.depth > 2.5 && p.variant >= 0 && p.variant <= 5, 'an office is a normal building');
    for (const q of corners(p)) {
      const r = radius(q), band = WORLD_X4.complexes.find((b) => r > b.from - .05 && r < b.to + .05);
      assert.ok(band, `a section corner at r ${r.toFixed(2)} is outside every band`);
      for (const road of streets) assert.ok(gen.segmentDistance(q.x, q.z, road) > ROAD_HALF + 1, `a section on a street at ${q.x.toFixed(1)}, ${q.z.toFixed(1)}`);
      for (const R of X4.roads.rings) assert.ok(Math.abs(r - R) > ROAD_HALF + 1, 'a section on a ring road');
      const a = Math.atan2(q.z, q.x);
      for (const z of WORLD_X4.sectors) assert.ok(gen.angularDistance(a, z.angleDeg * Math.PI / 180) > z.halfWidth || r > z.to, `a section in the ${z.zone} sector`);
      for (const lot of X4.roads.parking) assert.ok(!gen.insideParking(q, lot), 'a section on a car park');
    }
  }
  // Complexes do not touch: each one's paving (1.6 round it) stays off the others.
  const paving = (d) => corners({ x: d.x, z: d.z, rotation: Math.atan2(-Math.cos(d.angle), Math.sin(d.angle)), width: d.length + 3.2, depth: d.depth + 3.2 });
  for (const c of X4.complexes) for (const d of X4.complexes) if (c !== d) assert.ok(!inComplex(d, c) && paving(d).every((q) => !inComplex(q, c, 1.6)), 'two complexes overlap');
  // Each complex keeps 2.6 from every avenue that reaches it.
  for (const c of X4.complexes) for (const q of paving({ ...c, length: c.length - 3.2 + .01, depth: c.depth - 3.2 + .01 })) for (const v of plan.avenues) {
    const along = q.x * v.ux + q.z * v.uz;
    if (along > (v.ring ? WORLD_X4.roadRings[v.ring] : 0)) assert.ok(Math.abs(q.z * v.ux - q.x * v.uz) > ROAD_HALF + 1.5, 'a complex on an avenue');
  }
});

test('x4: every complex rings a courtyard with an arch, playground or court, benches, lamps and trees', () => {
  const kinds = (c) => X4.placements.filter((p) => inComplex(p, c, -.1)).map((p) => p.kind);
  for (const c of X4.complexes) {
    const inside = kinds(c), count = (k) => inside.filter((kind) => kind === k).length;
    if (count('glass-tower')) {
      // A business quarter: offices, a fountain on an alley of trees, benches and lamps.
      assert.ok(count('fountain') === 1 && count('bench') >= 3 && count('lamp') >= 2 && inside.filter((k) => k.startsWith('tree-')).length >= 6, `a bare plaza: ${[...new Set(inside)].join(', ')}`);
      continue;
    }
    assert.ok(count('section') >= 10, `a complex of ${count('section')} sections`);
    assert.ok(count('bench') >= 3 && count('lamp') >= 2 && inside.filter((k) => k.startsWith('tree-')).length >= 2, `a bare yard: ${[...new Set(inside)].join(', ')}`);
    assert.ok(count('slide') + count('goal') + count('hoop') >= 1, 'a yard to play in');
    assert.ok(new Set(inside.filter((k) => k.startsWith('tree-'))).size >= 2 || inside.filter((k) => k.startsWith('tree-')).length < 4, 'trees of more than one kind');
  }
  // Four kinds of tree and every piece of the playgrounds are in the city.
  for (const kind of ['tree-birch', 'tree-oak', 'slide', 'swings', 'sandbox', 'climber', 'goal', 'hoop', 'gazebo', 'flowerbed', 'bush']) assert.ok(X4.placements.some((p) => p.kind === kind), kind);
  // Yard patches stay within their complex's paving.
  for (const s of X4.surfaces) assert.ok(X4.complexes.some((c) => inComplex(s, c, 1.7)) || s.kind === 'lawn' || s.kind === 'plaza', `a ${s.kind} patch outside every complex`);
  assert.ok(['walk', 'lawn', 'plaza', 'play', 'court', 'line'].every((k) => X4.surfaces.some((s) => s.kind === k)));
});

test('x4: driveways between complexes are car parks out to the ring road; walks are closed loops off the buildings', () => {
  const driveways = X4.roads.parking.slice(gen.cityPlan(WORLD_X4).parking.length);
  assert.ok(driveways.length >= 10);
  for (const lot of driveways) {
    const r0 = radius(lot) - lot.length / 2, r1 = radius(lot) + lot.length / 2;
    const ends = (r) => X4.roads.rings.some((R) => Math.abs(r - R) - ROAD_HALF < .01) || X4.alleys.some((a) => Math.abs(r - a.radius) < 3);
    assert.ok(ends(r1) && (r0 < WORLD_X4.bank + 3 || ends(r0)), 'a driveway runs out to a ring road or an alley');
    assert.ok(r0 > WORLD_X4.bank, 'a driveway stays on the mainland');
    for (const c of X4.complexes) assert.ok(!inComplex(lot, c, -.5), 'a driveway through a complex');
  }
  const sections = X4.placements.filter((p) => p.kind === 'section');
  for (const walk of X4.walks) {
    assert.ok(walk.length > 20);
    for (let i = 0; i < walk.length; i++) {
      const a = walk[i], b = walk[(i + 1) % walk.length];
      assert.ok(Math.hypot(b.x - a.x, b.z - a.z) < .6, 'a walk jumps');
      for (const p of sections) {
        const c = Math.cos(p.rotation), s = Math.sin(p.rotation), dx = a.x - p.x, dz = a.z - p.z;
        const out = Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - p.width / 2), Math.max(0, Math.abs(dx * s + dz * c) - p.depth / 2));
        assert.ok(out > .5, 'a walk runs into a building');
      }
    }
  }
});

test('hills and mountains rise past the horizon, and the forests stand on them', () => {
  const relief = reliefModule;
  for (const world of WORLDS) {
    const start = world.spec.horizon;
    assert.equal(relief.reliefHeight(start * .99, 0, start), 0, 'the city stays flat');
    const heights = Array.from({ length: 72 }, (_, i) => { const a = i / 72 * Math.PI * 2; return [1.05, 1.3, 1.9, 2.6, 3].map((k) => relief.reliefHeight(Math.cos(a) * start * k, Math.sin(a) * start * k, start)); });
    assert.ok(heights.every(([near]) => near >= 0 && near < 20), 'gentle hills just past the horizon');
    assert.ok(Math.max(...heights.map((h) => Math.max(h[2], h[3], h[4]))) > 80, 'mountains farther out');
    for (const tree of world.placements.filter((p) => p.lift && p.kind.startsWith('tree-'))) {
      assert.ok(Math.hypot(tree.x, tree.z) > start && tree.lift < 41, 'a forest tree off the hills');
      assert.ok(Math.abs(tree.lift - relief.reliefHeight(tree.x, tree.z, start)) < 1e-9, 'a forest tree floats or sinks');
    }
    assert.ok(world.placements.filter((p) => p.lift && p.kind.startsWith('tree-')).length > 200, 'forests on the hills');
  }
});
