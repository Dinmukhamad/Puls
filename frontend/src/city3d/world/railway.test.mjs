import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const built = await build({ stdin: { contents: `export * from './railway.ts'; export * from './relief.ts'; export * from './estates.ts'; export * from './sales.ts'; export * from './stationSquare.ts'; export { generateWorld } from './generate.ts'; export { WORLD_X4, WORLD_V1 } from './worldSpec.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const R = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

// The worlds as the city opens them (city3d/index.ts): district land and the railway cleared of houses, the square laid.
const X4 = R.generateWorld(R.WORLD_X4), V1 = R.generateWorld(R.WORLD_V1), SALES = R.generateSalesWorld();
R.clearDistrictLand(X4, R.supportLand(X4.roads));
for (const world of [X4, V1]) { R.clearRailway(world, world.railway); R.addStationSquare(world); }
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

test('the cutting keeps the track level up to the face, and past it the hill comes down to the portal\'s hood', () => {
  for (const [name, world] of Object.entries(CITIES)) {
    const line = world.railway, land = R.flatLand(world);
    for (let u = R.STATION.end; u < line.length - .05; u += 1) for (let w = -R.CUT_HALF; w <= R.CUT_HALF; w += .75) {
      const p = R.railPoint(line, u, w);
      assert.ok(ground(world, p.x, p.z) < 1e-9, `${name}: the cutting's floor at ${u}, ${w}`);
    }
    for (let w = -5; w <= 5; w += .5) {
      const p = R.railPoint(line, line.length + .1, w), hill = R.groundHeight(land, p.x, p.z), hood = R.RAIL_TOP + R.portalHole(w), h = ground(world, p.x, p.z);
      // Over the bore right past the face: no lower than the hood's outline (or v1's low hill), so the bore stays
      // covered, and not much higher, so the hood shows against a slope instead of a cliff.
      assert.ok(h >= Math.min(hill, hood) - 1e-9 && h <= hood + .5, `${name}: the ground over the hood at ${w} is ${h.toFixed(2)}`);
    }
    for (let w = -6.5; w <= 6.5; w += .5) {
      const p = R.railPoint(line, line.length + 14, w);
      assert.ok(Math.abs(ground(world, p.x, p.z) - R.groundHeight(land, p.x, p.z)) < 1e-9, `${name}: the hill is whole again over the bore at ${w}`);
    }
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

test('along the portal model\'s side walls the ground stays at their top behind them', () => {
  for (const [name, world] of Object.entries(CITIES)) {
    const line = world.railway;
    for (let u = line.length - R.PORTAL_AT - R.WALLS.length + .5; u < line.length - .05; u += 1) for (const w of [R.WALLS.inner, R.WALLS.outer, -R.WALLS.outer]) {
      const p = R.railPoint(line, u, w);
      assert.ok(ground(world, p.x, p.z) <= R.WALLS.top + 1e-9, `${name}: ground over the wall at ${u.toFixed(1)}, ${w}`);
    }
  }
});

test('the portal model is one bore sized to the city, light, with its CC0 license beside it', async () => {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { getBounds } = await import('@gltf-transform/functions');
  const { MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptDecoder.ready;
  const file = new URL('../../pages/city/models/railway-portal.glb', import.meta.url);
  const bytes = readFileSync(file);
  assert.ok(bytes.length < 200 * 1024, `railway-portal.glb is ${bytes.length} bytes`);
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).readBinary(new Uint8Array(bytes));
  const scene = doc.getRoot().listScenes()[0], { min, max } = getBounds(scene);
  assert.equal(scene.getName(), 'railway-portal');
  // Symmetric round the track, at most 7.5 over the rail, the side walls back along the cutting, the bore into the hill.
  assert.ok(Math.abs(min[0] + max[0]) < .05 && max[0] < 6.6, `across ${min[0].toFixed(2)}…${max[0].toFixed(2)}`);
  assert.ok(max[1] < 7.5, `up to ${max[1].toFixed(2)} over the rail`);
  assert.ok(Math.abs(-min[2] - R.WALLS.length) < .3 && max[2] < 30, `along ${min[2].toFixed(2)}…${max[2].toFixed(2)}`);
  const triangles = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((sum, p) => sum + p.getIndices().getCount() / 3, 0);
  assert.ok(triangles < 4000, `${triangles} triangles`);
  assert.deepEqual(doc.getRoot().listMaterials().map((m) => m.getName()).sort(), ['portal-concrete', 'portal-dark', 'portal-stone']);
  assert.match(readFileSync(new URL('../../pages/city/models/LICENSE-railway-portal.txt', import.meta.url), 'utf8'), /CC0 1\.0/);
});

test('the hole in the hill\'s face keeps the bore open and stays inside the hood that hides its edge', async () => {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptDecoder.ready;
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .readBinary(new Uint8Array(readFileSync(new URL('../../pages/city/models/railway-portal.glb', import.meta.url))));
  // The model cut by the face's plane: PORTAL_AT into the model from its origin.
  const points = [], v = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(), m = node.getWorldMatrix();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
      const at = (i) => { pos.getElement(i, v); return [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]); };
      for (let k = 0; k < idx.getCount(); k += 3) {
        const t = [at(idx.getScalar(k)), at(idx.getScalar(k + 1)), at(idx.getScalar(k + 2))], cut = [];
        for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3]; if ((a[2] - R.PORTAL_AT) * (b[2] - R.PORTAL_AT) < 0) { const f = (R.PORTAL_AT - a[2]) / (b[2] - a[2]); cut.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); } }
        if (cut.length === 2) for (let s = 0; s <= 20; s++) points.push([Math.abs(cut[0][0] + (cut[1][0] - cut[0][0]) * s / 20), cut[0][1] + (cut[1][1] - cut[0][1]) * s / 20]);
      }
    }
  }
  const near = (w) => points.filter(([x, y]) => Math.abs(x - w) < .2 && y > 1).map(([, y]) => y);
  for (let w = 0; w <= 3.5; w += .5) assert.ok(R.portalHole(w) > Math.min(...near(w)) + .05, `the face closes the bore at ${w}`);
  for (let w = 0; w <= 5; w += .5) assert.ok(R.portalHole(w) < Math.max(...near(w)) - .2, `the hole's edge shows at ${w}`);
  assert.equal(R.portalHole(R.PORTAL_HOLE[R.PORTAL_HOLE.length - 1][0]), null);
});
