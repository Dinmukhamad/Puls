import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const built = await build({ stdin: { contents: `export * from './railway.ts'; export * from './relief.ts'; export * from './estates.ts'; export * from './sales.ts'; export * from './stationSquare.ts'; export { generateWorld, insideParking, segmentDistance } from './generate.ts'; export { WORLD_X4, WORLD_V1 } from './worldSpec.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const R = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

// The worlds as the city opens them (city3d/index.ts): district land and the railway cleared, then the square.
const X4 = R.generateWorld(R.WORLD_X4), V1 = R.generateWorld(R.WORLD_V1), SALES = R.generateSalesWorld();
const STREETS = { x4: [...X4.roads.streets], v1: [...V1.roads.streets] };
const SUPPORT_LAND = R.supportLand(X4.roads);
R.clearDistrictLand(X4, SUPPORT_LAND);
for (const world of [X4, V1]) { R.clearRailway(world, world.railway); R.addStationSquare(world); }
const CITIES = { x4: X4, v1: V1, sales: SALES };
const squareOf = (world) => R.stationSquare(world);
const lotCorners = (lot) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, d]) => ({
  x: lot.x + Math.sin(lot.angle) * a * (lot.length / 2 + .2) + Math.cos(lot.angle) * d * (lot.depth / 2 + .2),
  z: lot.z + Math.cos(lot.angle) * a * (lot.length / 2 + .2) - Math.sin(lot.angle) * d * (lot.depth / 2 + .2),
}));

test('a street runs from the town\'s streets to every station\'s forecourt', () => {
  for (const [name, world] of Object.entries(CITIES)) {
    const square = squareOf(world), others = world.roads.streets.filter((s) => !square.streets.includes(s) && !square.streets.some((q) => q.every((v, i) => v === s[i])));
    assert.ok(square.streets.length >= 1, `${name}: the square has its street`);
    for (const [ax, az, bx, bz] of square.streets) {
      const joins = [[ax, az], [bx, bz]].some(([x, z]) => others.some((road) => R.segmentDistance(x, z, road) < 1e-6));
      assert.ok(joins, `${name}: the station street meets the town's streets`);
    }
    // The forecourt's front edge is a few steps from a street: the station street, or the sales city's bottom street.
    const front = [R.STATION.near, R.STATION.middle, R.STATION.far].map((w) => R.railPoint(world.railway, R.STATION.forecourt, w));
    for (const p of front) assert.ok(world.roads.streets.some((road) => R.segmentDistance(p.x, p.z, road) <= 4.01), `${name}: the forecourt at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} has a street in front of it`);
  }
});

test('the car parks are full of cars standing on them, off the streets', () => {
  for (const [name, world] of Object.entries(CITIES)) {
    const square = squareOf(world), cars = square.placements.filter((p) => p.kind === 'car-parked');
    assert.ok(square.parking.length >= 1, `${name}: a car park`);
    for (const lot of square.parking) {
      const inside = cars.filter((car) => R.insideParking(car, lot));
      assert.ok(inside.length >= 30 && inside.length < lot.stalls.length, `${name}: ${inside.length} cars in ${lot.stalls.length} stalls`);
      // The pad comes up to a street's kerb (1.33 off its middle) and no farther.
      for (const road of world.roads.streets) assert.ok(R.segmentPolygonDistance(road, lotCorners(lot)) > 1.3, `${name}: the car park runs into a street`);
      for (const stall of lot.stalls) for (const road of world.roads.streets) assert.ok(R.segmentDistance(stall.x, stall.z, road) > 2, `${name}: a stall on a street`);
    }
    for (const car of cars) assert.ok(square.parking.some((lot) => R.insideParking(car, lot)), `${name}: a car off its car park`);
  }
});

test('every station has a small park: lawn, paths, a fountain with benches round it, lamps and trees', () => {
  for (const [name, world] of Object.entries(CITIES)) {
    const square = squareOf(world), count = (kind) => square.placements.filter((p) => p.kind === kind).length;
    assert.equal(count('fountain'), 1, `${name}: a fountain`);
    assert.ok(count('bench') >= 4 && count('lamp') >= 6 && count('flowerbed') >= 4, `${name}: benches, lamps and flowerbeds`);
    assert.ok(square.placements.filter((p) => p.kind.startsWith('tree-')).length >= 10, `${name}: trees`);
    assert.ok(square.surfaces.some((s) => s.kind === 'lawn') && square.surfaces.filter((s) => s.kind === 'walk').length >= 2, `${name}: lawn and paths`);
    assert.ok(square.walks.length === 1 && world.walks.includes(square.walks[0]) === false && world.walks.length > 0, `${name}: walkers round the fountain`);
  }
});

test('the square keeps off the railway, the district land and the hills, and the houses there make way for it', () => {
  const lands = { x4: SUPPORT_LAND, v1: null, sales: R.salesLand() };
  for (const [name, world] of Object.entries(CITIES)) {
    const square = squareOf(world), line = world.railway, land = R.flatLand(world);
    const points = [...square.placements, ...square.parking.flatMap(lotCorners)];
    for (const p of points) {
      assert.ok(!R.onRailway(line, p, .5), `${name}: ${p.kind ?? 'car park'} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} on the railway`);
      assert.ok(R.groundHeight(land, p.x, p.z, line) < 1e-9, `${name}: ${p.kind ?? 'car park'} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} up on the hills`);
      if (lands[name]) assert.ok(!R.onDistrictLand(lands[name], p, 1), `${name}: ${p.kind ?? 'car park'} on district land`);
    }
    // Of the town's own copies none is left on the square: houses, trees and lamps all made way.
    const own = world.placements.filter((p) => !square.placements.some((q) => q.x === p.x && q.z === p.z && q.kind === p.kind));
    for (const p of own) assert.ok(!R.onSquare(line, square, p, 0), `${name}: a ${p.kind} left on the square`);
  }
});

test('the square leaves the district land where it was', () => {
  // index.ts lays out the land before the square; the city's own copy (systems/departmentWorld.ts) after it.
  const before = R.supportLand({ streets: STREETS.x4, rings: X4.roads.rings }), after = R.supportLand(X4.roads);
  assert.deepEqual(after, before);
  assert.deepEqual(after, SUPPORT_LAND);
});

test('the station model is a light building of the city\'s size, named for each city, with its CC BY credit', async () => {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { getBounds } = await import('@gltf-transform/functions');
  const { MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptDecoder.ready;
  const bytes = readFileSync(new URL('../../pages/city/models/railway-station.glb', import.meta.url));
  assert.ok(bytes.length < 300 * 1024, `railway-station.glb is ${bytes.length} bytes`);
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).readBinary(new Uint8Array(bytes));
  const scenes = Object.fromEntries(doc.getRoot().listScenes().map((s) => [s.getName(), s]));
  assert.deepEqual(Object.keys(scenes).sort(), ['railway-station', 'station-sign-sales', 'station-sign-support']);
  const { min, max } = getBounds(scenes['railway-station']);
  // 17 long across the end of the track, standing on the floor slab, no deeper than the slab under it.
  assert.ok(Math.abs(max[0] - min[0] - 17) < .05 && Math.abs(min[0] + max[0]) < .05, `along ${min[0].toFixed(2)}…${max[0].toFixed(2)}`);
  assert.ok(Math.abs(min[1] - R.STATION.floor) < .06 && max[1] < 8, `up ${min[1].toFixed(2)}…${max[1].toFixed(2)}`);
  assert.ok(max[2] - min[2] < 6.5 && R.STATION.building + min[2] > -10.6 && R.STATION.building + max[2] < R.STATION.platform, `across ${min[2].toFixed(2)}…${max[2].toFixed(2)}`);
  const triangles = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((sum, p) => sum + p.getIndices().getCount() / 3, 0);
  assert.ok(triangles < 30000, `${triangles} triangles`);
  assert.equal(doc.getRoot().listTextures().length, 0, 'plain colours, no textures');
  assert.ok(doc.getRoot().listMaterials().some((m) => m.getName() === 'station-glass'), 'the windows that light up at night');
  const license = readFileSync(new URL('../../pages/city/models/LICENSE-railway-station.txt', import.meta.url), 'utf8');
  assert.match(license, /CC BY/); assert.match(license, /loran17/); assert.match(license, /blendswap\.com\/blend\/27438/);
  const panel = readFileSync(new URL('../../pages/city/CityWorldPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /Gare de BlenderVille/); assert.match(panel, /loran17/); assert.match(panel, /CC BY/);
});
