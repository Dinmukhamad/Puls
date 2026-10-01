import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: `export * from './estates.ts'; export * from './sales.ts'; export { generateWorld, segmentDistance } from './generate.ts'; export { WORLD_X4 } from './worldSpec.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const E = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const server = readFileSync(new URL('../../../../app/services/city_estate.py', import.meta.url), 'utf8');
const X4 = E.generateWorld(E.WORLD_X4), SALES = E.generateSalesWorld();
const lands = { support: E.supportLand(X4.roads), sales: E.salesLand() };
const worlds = { support: X4, sales: SALES };

test('the grid matches the server: prepared modules, kinds, footprints and levels', () => {
  const prepared = server.match(/^PREPARED = \(([^)]*)\)/m)[1].split(',').map(Number);
  assert.deepEqual([...E.PREPARED], prepared);
  assert.deepEqual([0, 1, 2, 9].map(E.moduleKind), ['public', 'business', 'residential', 'residential']);
  const families = [...server.matchAll(/^ {4}"(\w+)": \{\n {8}"name": "[^"]+",\n {8}"icon": "[^"]+",\n {8}"size": \((\d), (\d)\),/gm)].map(m => [m[1], [Number(m[2]), Number(m[3])]]);
  assert.deepEqual(Object.fromEntries(families), E.FAMILY_SIZE);
  for (const family of Object.keys(E.FAMILY_SIZE)) {
    const block = server.slice(server.indexOf(`    "${family}": {\n        "name"`)).split(/\n {4}\},/)[0];
    const levels = (block.match(/\n {12}\(\n? *"[^"]+",/g) ?? []).length;
    assert.equal(levels, E.FAMILY_LEVELS[family], family);
  }
  assert.match(server, /MODULE_CELLS, LOT_CELLS, HOUSE_ROWS = 12, 4, 2/);
});

for (const city of ['support', 'sales']) test(`${city}: every prepared district gets its modules, clear of roads, rails, water and each other`, () => {
  const land = lands[city], world = worlds[city];
  assert.deepEqual(land.modules.map(m => m.length), [...E.PREPARED]);
  const all = land.modules.flat(), corners = all.map(m => E.squareCorners(m.x, m.z, m.rotation));
  all.forEach((m, i) => {
    assert.equal(m.kind, E.moduleKind(m.slot));
    for (const road of world.roads.streets) assert.ok(E.segmentPolygonDistance(road, corners[i]) >= 2.5, `${city} ${m.district}.${m.slot} by a street`);
    assert.ok(E.segmentPolygonDistance(E.RAILWAYS[city].road, corners[i]) > 4.8, `${city} ${m.district}.${m.slot} by the railway`);
    if (city === 'sales') assert.ok(corners[i].every(p => Math.hypot(p.x, p.z) > 56), 'off the lake');
    else assert.ok(corners[i].every(p => world.roads.rings.every(r => Math.abs(Math.hypot(p.x, p.z) - r) > 3.4)), 'off the ring roads');
    // A walk at least two units wide between any two modules (exactly a street apart in a row of the lattice).
    for (let j = i + 1; j < all.length; j++) assert.ok(!E.polygonsOverlap(corners[i], corners[j], 2), `${city} modules ${i} and ${j} apart`);
    for (const hq of land.headquarters) assert.ok(!E.polygonsOverlap(corners[i], E.squareCorners(hq.x, hq.z, hq.rotation, E.HQ_HALF), 1.4), 'clear of headquarters');
  });
  // A district keeps together: every module of the first three within 80 units of its headquarters.
  land.modules.slice(0, 3).forEach((list, i) => list.forEach(m => assert.ok(Math.hypot(m.x - land.headquarters[i].x, m.z - land.headquarters[i].z) < 80, `${city} district ${i + 1} compact`)));
});

test('modules face their city and cells map to the ground and back', () => {
  for (const m of [lands.support.modules[0][0], lands.sales.modules[2][3]]) {
    const centre = E.cellPoint(m, 6, 6), front = E.cellPoint(m, 6, 12);
    assert.ok(Math.hypot(centre.x - m.x, centre.z - m.z) < 1e-9);
    assert.ok(Math.hypot(front.x, front.z) < Math.hypot(m.x, m.z), 'the front looks towards the centre');
    const back = E.pointCell(m, E.cellPoint(m, 3.5, 7.25));
    assert.ok(Math.abs(back.u - 3.5) < 1e-9 && Math.abs(back.v - 7.25) < 1e-9);
  }
});

test('nothing of the generated cities stands on district land', () => {
  const world = { placements: [...X4.placements], surfaces: [...X4.surfaces] };
  E.clearDistrictLand(world, lands.support);
  for (const p of world.placements) assert.ok(!E.onDistrictLand(lands.support, p, 0), `${p.kind} on support land`);
  assert.ok(world.placements.length > X4.placements.length * .8, 'the rest of the city stays');
  for (const p of SALES.placements) assert.ok(!E.onDistrictLand(lands.sales, p, 0), `${p.kind} on sales land`);
});

const KNOWN = new Set([...X4.placements.map(p => p.kind), 'cottage', 'roof', 'glass-tower']);
const inside = (p, x, z, angle, w, d, pad) => {
  const s = Math.sin(angle), c = Math.cos(angle), dx = p.x - x, dz = p.z - z;
  return Math.abs(dx * c - dz * s) <= w / 2 + pad && Math.abs(dx * s + dz * c) <= d / 2 + pad;
};
test('every building at every level stays inside its footprint and uses known models', () => {
  const module = lands.sales.modules[0][2];
  for (const [family, levels] of Object.entries(E.FAMILY_LEVELS)) for (let level = 1; level <= levels; level++) for (const rotation of [0, 1, 2, 3]) {
    const [w, h] = E.footprint(family, rotation), u = 0, v = 0, centre = E.cellPoint(module, u + w / 2, v + h / 2);
    const { placements, surfaces } = E.objectLayout(module, { family, level, u, v, rotation });
    assert.ok(placements.length >= 2 && surfaces.length >= 1, `${family} ${level} has pieces`);
    const angle = module.rotation + rotation * Math.PI / 2, [W, D] = E.FAMILY_SIZE[family].map(n => n * E.CELL);
    for (const p of placements) {
      assert.ok(KNOWN.has(p.kind), `${p.kind} is a model`);
      assert.ok(inside(p, centre.x, centre.z, angle, W, D, -.05), `${family} ${level} ${p.kind} inside`);
    }
    for (const s of surfaces) assert.ok(inside(s, centre.x, centre.z, angle, W, D, .01), `${family} ${level} ${s.kind} patch inside`);
  }
});

test('the house and the tower grow visibly at every stage', () => {
  const module = lands.support.modules[0][2], height = list => Math.max(...list.map(p => p.kind === 'glass-tower' ? [0, 0, 10.8, 16.2, 23.4, 30.6][p.variant] ?? 0 : (p.lift ?? 0) + (p.scale ?? 1)));
  const houses = [1, 2, 3, 4, 5].map(level => E.objectLayout(module, { family: 'house', level, u: 0, v: 0, rotation: 0 }).placements);
  houses.slice(1).forEach((list, i) => assert.notDeepEqual(list.map(p => p.kind).sort(), houses[i].map(p => p.kind).sort(), `house ${i + 2} differs`));
  assert.ok(houses[3].some(p => p.kind === 'cottage' && p.tint === 3), 'a garage at the fourth stage');
  assert.ok(houses[4].some(p => p.kind === 'fountain'), 'a fountain at the last stage');
  const towers = [1, 2, 3, 4].map(level => height(E.objectLayout(module, { family: 'tower', level, u: 0, v: 0, rotation: 0 }).placements));
  towers.slice(1).forEach((h, i) => assert.ok(h > towers[i], `tower ${i + 2} taller`));
});

test('the preview gives the server reasons before anyone pays', () => {
  const modules = lands.support.modules[0], land = { district: 1, estate: { module: 2, u: 4, v: 8 }, tower: null }, none = () => false;
  const problem = (family, module, u, v, rotation = 0, occupied = none, publicLand = false) => E.placementProblem({ family, module, u, v, rotation }, modules, land, occupied, publicLand);
  assert.equal(problem('house', 2, 4, 8), null);
  assert.equal(problem('square', 2, 4, 10), null);
  assert.equal(problem('square', 2, 4, 8), 'Постройка должна целиком помещаться в саду усадьбы');
  assert.equal(problem('square', 0, 0, 0), 'Это общественная земля района');
  assert.equal(problem('square', 3, 4, 10), 'Строить можно только на своей усадьбе');
  assert.equal(problem('park', 2, 4, 10), null);
  assert.equal(problem('park', 2, 4, 9, 1), 'Постройка должна целиком помещаться в саду усадьбы');
  assert.equal(problem('tower', 1, 4, 4), null);
  assert.equal(problem('tower', 1, 2, 0), 'Небоскрёб занимает целый деловой участок 4 × 4');
  assert.equal(problem('tower', 2, 4, 8), 'Небоскрёбы строят в деловом квартале района');
  assert.equal(problem('square', 2, 5, 11, 0, (m, u, v) => u === 5 && v === 11), 'Эти клетки уже заняты');
  assert.equal(problem('fountain', 0, 10, 10, 0, none, true), null);
  assert.equal(problem('fountain', 0, 11, 10, 0, none, true), 'Постройка выходит за границы квартала');
  assert.equal(problem('fountain', 2, 0, 0, 0, none, true), 'Общие проекты строят на общественной земле района');
});
