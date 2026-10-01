import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ stdin: { contents: `export * from './railway.ts'; export * from './relief.ts'; export * from './estates.ts'; export * from './sales.ts'; export { generateWorld } from './generate.ts'; export { WORLD_X4, WORLD_V1 } from './worldSpec.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const R = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

// The worlds as the city opens them (city3d/index.ts): district land and the railway cleared of houses.
const X4 = R.generateWorld(R.WORLD_X4), V1 = R.generateWorld(R.WORLD_V1), SALES = R.generateSalesWorld();
R.clearDistrictLand(X4, R.supportLand(X4.roads));
for (const world of [X4, V1]) R.clearRailway(world, world.railway);
const CITIES = { x4: X4, v1: V1, sales: SALES };
const ground = (world, x, z) => R.groundHeight(R.flatLand(world), x, z, world.railway);
const station = (line) => [[R.STATION.forecourt, R.STATION.near], [R.STATION.end, R.STATION.near], [R.STATION.end, R.STATION.far], [R.STATION.forecourt, R.STATION.far]].map(([u, w]) => R.railPoint(line, u, w));

test('every city has its line, running straight out from the centre to a portal in its own hills', () => {
  for (const [name, world] of Object.entries(CITIES)) {
    const line = world.railway;
    assert.deepEqual(line, R.RAIL_LINES[name], name);
    assert.ok(Math.abs(Math.hypot(line.dx, line.dz) - 1) < 1e-9, `${name}: the direction is a unit vector`);
    const face = R.railPoint(line, line.length);
    // The hill's face meets the line square only if the line runs out from the centre (render/mountains.ts rings).
    assert.ok(Math.abs(face.x * line.dz - face.z * line.dx) / Math.hypot(face.x, face.z) < .03, `${name}: the line runs out from the centre`);
    assert.ok(R.pastLand(R.flatLand(world), face.x, face.z) > 30, `${name}: the portal lies out in the hills`);
  }
});

test('the station stands at the edge of the town, not in its centre, on level ground', () => {
  for (const [name, world] of Object.entries(CITIES)) {
    const line = world.railway, land = R.flatLand(world);
    const edge = 'radius' in land ? land.radius : Math.min(land.halfX, land.halfZ);
    for (const corner of station(line)) assert.ok(Math.hypot(corner.x, corner.z) > edge * .75, `${name}: the station is out at the edge`);
    // The yard is level wherever the hills would have reached it.
    for (let u = R.STATION.forecourt; u <= R.STATION.end; u += 2) for (let w = R.STATION.near; w <= R.STATION.far; w += 1.5) {
      const p = R.railPoint(line, u, w);
      assert.ok(ground(world, p.x, p.z) < 1e-9, `${name}: the yard at ${u}, ${w} is not level`);
    }
  }
});

test('the cutting keeps the track level up to the face, and the hill over the portal stands above its headwall', () => {
  for (const [name, world] of Object.entries(CITIES)) {
    const line = world.railway;
    for (let u = R.STATION.end; u < line.length - R.FACE_GAP; u += 1) for (let w = -R.CUT_HALF; w <= R.CUT_HALF; w += .75) {
      const p = R.railPoint(line, u, w);
      assert.ok(ground(world, p.x, p.z) < 1e-9, `${name}: the cutting's floor at ${u}, ${w}`);
    }
    // The headwall is 8.4 high with its cap (systems/departmentWorld.ts); v1's hills are lower.
    let lowest = Infinity;
    for (let u = line.length; u <= line.length + 4; u += 1) for (let w = -6.5; w <= 6.5; w += .5) { const p = R.railPoint(line, u, w); lowest = Math.min(lowest, ground(world, p.x, p.z)); }
    assert.ok(lowest > (name === 'v1' ? 5 : 9.5), `${name}: the hill over the portal is ${lowest.toFixed(1)} high`);
  }
});

test('streets, district land and the town keep off the railway', () => {
  for (const [name, world] of Object.entries(CITIES)) {
    const line = world.railway, footprint = station(line);
    for (const road of world.roads.streets) {
      assert.ok(R.segmentPolygonDistance(road, footprint) > 1.4, `${name}: a street runs into the station`);
      const corridor = [[R.STATION.forecourt, -R.CUT_HALF], [line.length, -R.CUT_HALF], [line.length, R.CUT_HALF], [R.STATION.forecourt, R.CUT_HALF]].map(([u, w]) => R.railPoint(line, u, w));
      assert.ok(R.segmentPolygonDistance(road, corridor) > 1.4, `${name}: a street crosses the line`);
    }
    for (const p of world.placements) if (!p.lift) assert.ok(!R.onRailway(line, p, 0), `${name}: ${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} stands on the railway`);
    for (const p of world.placements) if (p.lift && p.kind.startsWith('tree-')) assert.ok(!R.onRailway(line, p, 6), `${name}: a forest tree in the cutting`);
  }
  for (const [city, land] of [['support', R.supportLand(X4.roads)], ['sales', R.salesLand()]]) {
    const line = city === 'support' ? X4.railway : SALES.railway;
    for (const m of land.modules.flat()) for (const c of R.squareCorners(m.x, m.z, m.rotation)) assert.ok(!R.onRailway(line, c, 2), `${city}: module ${m.district}.${m.slot} on the railway`);
    for (const h of land.headquarters) assert.ok(!R.onRailway(line, h, R.HQ_HALF), `${city}: a headquarters on the railway`);
  }
});

test('sales: the boulevard leads from the lake to the station between the districts', () => {
  const walks = SALES.surfaces.filter((s) => s.kind === 'walk' && s.x === 0);
  assert.ok(walks.length >= 2 && walks.every((s) => s.z + s.length / 2 <= 108.6), 'the boulevard stops at the street before the station');
  const forecourt = R.railPoint(SALES.railway, R.STATION.forecourt, 4);
  assert.ok(forecourt.z > 111.3 && Math.abs(forecourt.x) < 1, 'the forecourt faces the boulevard across the bottom street');
});
