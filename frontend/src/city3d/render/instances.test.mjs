import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The pools' culling and LOD logic lives in cells.ts, with no three.js, so it runs on Node.
const built = await build({ entryPoints: [fileURLToPath(new URL('./cells.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const cells = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { HIDDEN, CELL_SIZE } = cells;

const DISTANCES = [40, 120, 250];

/** Copies on a square lattice every `step` units across [-half, half], 3 units tall. */
function lattice(half, step) {
  const points = [];
  for (let x = -half; x <= half; x += step) for (let z = -half; z <= half; z += step) points.push([x, z]);
  const copies = cells.createCopies(points.length);
  points.forEach(([x, z], i) => { copies.x[i] = x; copies.y[i] = 1.5; copies.z[i] = z; copies.radius[i] = 1.8; });
  return copies;
}

/** A box-shaped "frustum": x and z within [x0, x1] × [z0, z1], y within [-10, 100]. */
const boxPlanes = (x0, x1, z0, z1) => [1, 0, 0, -x0, -1, 0, 0, x1, 0, 0, 1, -z0, 0, 0, -1, z1, 0, 1, 0, 10, 0, -1, 0, 100];

test('every copy lands in exactly one cell whose box holds its sphere', () => {
  const copies = lattice(200, 5), grid = cells.buildGrid(copies);
  const seen = new Uint8Array(copies.count);
  for (const cell of grid.cells) for (const i of cell.items) {
    seen[i]++;
    const r = copies.radius[i];
    assert.ok(copies.x[i] - r >= cell.minX && copies.x[i] + r <= cell.maxX && copies.z[i] - r >= cell.minZ && copies.z[i] + r <= cell.maxZ);
    assert.ok(cell.maxX - cell.minX <= CELL_SIZE + 2 * r + 1e-3 && cell.maxZ - cell.minZ <= CELL_SIZE + 2 * r + 1e-3);
  }
  assert.ok(seen.every(n => n === 1));
  // ~13 × 13 cells for a 400-unit square: the grid, not the copies, is what the culling walks.
  assert.ok(grid.cells.length >= 144 && grid.cells.length <= 196, `${grid.cells.length} cells`);
});

test('cells outside the frustum are culled, and the margin keeps the ones just beyond its edge', () => {
  const copies = lattice(200, 5), grid = cells.buildGrid(copies);
  const planes = boxPlanes(0, 40, 0, 40);
  const inside = grid.cells.filter(cell => !cells.boxOutside(planes, cell, 0));
  for (const cell of inside) assert.ok(cell.maxX >= 0 && cell.minX <= 40 && cell.maxZ >= 0 && cell.minZ <= 40);
  const widened = grid.cells.filter(cell => !cells.boxOutside(planes, cell, 30));
  assert.ok(widened.length > inside.length);
  for (const cell of widened) assert.ok(cell.maxX >= -30 && cell.minX <= 70);
  // A cell far away never passes.
  assert.ok(grid.cells.filter(cell => cell.minX > 120).every(cell => cells.boxOutside(planes, cell, 30)));
});

test('levels follow the distances: LOD0, LOD1, LOD2, then hidden', () => {
  assert.equal(cells.lodLevel(10, -1, DISTANCES), 0);
  assert.equal(cells.lodLevel(39.9, -1, DISTANCES), 0);
  assert.equal(cells.lodLevel(40, -1, DISTANCES), 1);
  assert.equal(cells.lodLevel(119, -1, DISTANCES), 1);
  assert.equal(cells.lodLevel(121, -1, DISTANCES), 2);
  assert.equal(cells.lodLevel(260, -1, DISTANCES), HIDDEN);
  // Far jumps skip levels at once, whatever the previous level was.
  assert.equal(cells.lodLevel(300, 0, DISTANCES), HIDDEN);
  assert.equal(cells.lodLevel(5, HIDDEN, DISTANCES), 0);
});

test('hysteresis: a copy near a switch distance keeps its level until it is clearly past it', () => {
  // Going out from LOD0: still LOD0 a little past 40, LOD1 once 6% past.
  assert.equal(cells.lodLevel(41.5, 0, DISTANCES), 0);
  assert.equal(cells.lodLevel(42.5, 0, DISTANCES), 1);
  // Coming back from LOD1: still LOD1 a little inside 40, LOD0 once 6% inside.
  assert.equal(cells.lodLevel(38.5, 1, DISTANCES), 1);
  assert.equal(cells.lodLevel(37.5, 1, DISTANCES), 0);
  // The same at the edge of the drawn range.
  assert.equal(cells.lodLevel(255, 2, DISTANCES), 2);
  assert.equal(cells.lodLevel(240, HIDDEN, DISTANCES), HIDDEN);
  assert.equal(cells.lodLevel(230, HIDDEN, DISTANCES), 2);
  // A camera wobbling across a boundary does not flip the level back and forth.
  let level = 0; const seen = new Set();
  for (let k = 0; k < 50; k++) { level = cells.lodLevel(40 + Math.sin(k) * 2, level, DISTANCES); seen.add(level); }
  assert.deepEqual([...seen], [0]);
});

test('select lists visible copies with their levels and reports only real changes', () => {
  const copies = lattice(300, 6), grid = cells.buildGrid(copies), selector = cells.createSelector(copies.count);
  const view = { x: 0, y: 60, z: 0, planes: boxPlanes(-150, 150, -150, 150), margin: 0, distances: DISTANCES };
  assert.equal(cells.select(grid, copies, selector, view), true);
  const { current } = selector;
  assert.ok(current.count > 0);
  for (let k = 0; k < current.count; k++) {
    const i = current.copies[k], d = Math.hypot(copies.x[i], copies.y[i] - 60, copies.z[i]);
    assert.equal(current.levels[k], cells.lodLevel(d, -1, DISTANCES));
    assert.ok(current.levels[k] < HIDDEN);
  }
  // Nothing hidden or outside the widened box is listed.
  const listed = new Set(current.copies.subarray(0, current.count));
  for (let i = 0; i < copies.count; i++) if (Math.abs(copies.x[i]) > 150 + CELL_SIZE + 2 || Math.abs(copies.z[i]) > 150 + CELL_SIZE + 2) assert.ok(!listed.has(i));
  // The same view again changes nothing; a small move inside the hysteresis band neither.
  assert.equal(cells.select(grid, copies, selector, view), false);
  assert.equal(cells.select(grid, copies, selector, { ...view, x: .5 }), false);
  // A big move does.
  assert.equal(cells.select(grid, copies, selector, { ...view, x: 80, planes: boxPlanes(-70, 230, -150, 150) }), true);
});

test('hidden copies are not drawn: the drawn set stays within the last distance', () => {
  const copies = lattice(400, 8), grid = cells.buildGrid(copies), selector = cells.createSelector(copies.count);
  cells.select(grid, copies, selector, { x: 0, y: 30, z: 0, planes: boxPlanes(-1e4, 1e4, -1e4, 1e4), margin: 0, distances: DISTANCES });
  const { current } = selector;
  assert.ok(current.count < copies.count);
  for (let k = 0; k < current.count; k++) { const i = current.copies[k]; assert.ok(Math.hypot(copies.x[i], copies.y[i] - 30, copies.z[i]) < 250); }
});

test('camera updates are throttled to 100 ms unless it moved 2 units, turned 2° or the projection changed', () => {
  const pose = (extra = {}) => ({ x: 0, y: 50, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, projection: 1, time: 0, ...extra });
  const last = pose();
  assert.equal(cells.shouldUpdate(null, pose()), true);
  assert.equal(cells.shouldUpdate(last, pose({ time: 40, x: .5 })), false);
  assert.equal(cells.shouldUpdate(last, pose({ time: 100, x: .5 })), true);
  assert.equal(cells.shouldUpdate(last, pose({ time: 16, x: 2.5 })), true);
  const half = 1.5 * Math.PI / 180 / 2, more = 2.5 * Math.PI / 180 / 2;
  assert.equal(cells.shouldUpdate(last, pose({ time: 16, qy: Math.sin(half), qw: Math.cos(half) })), false);
  assert.equal(cells.shouldUpdate(last, pose({ time: 16, qy: Math.sin(more), qw: Math.cos(more) })), true);
  assert.equal(cells.shouldUpdate(last, pose({ time: 16, projection: 2 })), true);
});
