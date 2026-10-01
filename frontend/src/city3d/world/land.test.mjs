import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { cityLandText, LAND_FILE } from '../../../scripts/city-land.mjs';

const built = await build({ stdin: { contents: `export * from './land.ts'; export * from './cities.ts'; export * from './railway.ts'; export * from './stationSquare.ts'; export { generateSalesWorld } from './sales.ts'; export { segmentPolygonDistance, polygonsOverlap, squareCorners, MODULE, HQ_HALF } from './estates.ts'; export { generateWorld, segmentDistance } from './generate.ts'; export { WORLD_X4, WORLD_V1 } from './worldSpec.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const L = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

const SUPPORT = L.islandWorld(L.WORLD_X4), SALES = L.generateSalesWorld();
const CITIES = { support: SUPPORT, sales: SALES };
const GRIDS = { support: L.landGrid(SUPPORT), sales: L.landGrid(SALES) };

test('the server sells the plots of the client\'s grid (app/data/city_land.json is up to date)', async () => {
  assert.equal(readFileSync(LAND_FILE, 'utf8'), await cityLandText(), 'run `node scripts/city-land.mjs` in frontend/');
  const data = JSON.parse(readFileSync(LAND_FILE, 'utf8'));
  for (const [city, grid] of Object.entries(GRIDS)) {
    const blocks = Object.values(data.cities[city].districts).flat();
    assert.equal(blocks.reduce((sum, b) => sum + b.cols * b.rows - b.skip.length, 0), grid.plots.length, `${city}: plots`);
    assert.deepEqual(Object.keys(data.cities[city].districts), ['1', '2', '3']);
  }
  assert.equal(L.landGrid(L.generateWorld(L.WORLD_V1)), null, 'the old v1 map has no district land');
});

test('the whole city goes to three districts of about the same size, plot by plot', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    const counts = [1, 2, 3].map(d => grid.plots.filter(p => p.district === d).length), mean = counts.reduce((a, b) => a + b) / 3;
    for (const n of counts) assert.ok(Math.abs(n - mean) / mean < .1, `${city}: ${counts.join(' / ')} plots`);
    assert.ok(grid.plots.length > (city === 'support' ? 3000 : 500), `${city}: ${grid.plots.length} plots`);
    // Every plot is about PLOT across, a little narrower by the centre of the round city, wider by its edge.
    for (const p of grid.plots) assert.ok(Math.min(p.width, p.depth) > 7 && Math.max(p.width, p.depth) < 11.5, `${city}: plot ${p.width.toFixed(1)} × ${p.depth.toFixed(1)}`);
    // Bands count outwards; land opens band by band, so every district has the first.
    for (const d of [1, 2, 3]) assert.ok(grid.plots.some(p => p.district === d && p.band === 1), `${city}: district ${d} has a first band`);
    assert.equal(Math.max(...grid.plots.map(p => p.band)), grid.bands);
    const keys = new Set(grid.plots.map(p => `${p.district}:${L.plotKey(p.block, p.col, p.row)}`));
    assert.equal(keys.size, grid.plots.length, `${city}: one address a plot`);
  }
  // The island city's bands are rings: a band's plots lie farther out than the band before.
  const radius = p => Math.hypot(p.x, p.z), byBand = b => GRIDS.support.plots.filter(p => p.band === b).map(radius);
  for (let b = 1; b < GRIDS.support.bands; b++) assert.ok(Math.max(...byBand(b)) < Math.min(...byBand(b + 1)), `band ${b} inside band ${b + 1}`);
});

test('no plot on a street, the railway, the station\'s square, the lake or a group quarter, none on another', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    const world = CITIES[city], line = world.railway, square = L.stationSquare(world);
    for (const p of grid.plots) {
      for (const road of world.roads.streets) assert.ok(L.segmentPolygonDistance(road, p.corners) >= 1.3, `${city}: plot ${p.district}:${p.block}:${p.col}:${p.row} on a street`);
      for (const r of world.roads.rings) for (const c of p.corners) assert.ok(Math.abs(Math.hypot(c.x, c.z) - r) >= 1.3 - 1e-6, `${city}: plot on a ring road`);
      for (const c of [...p.corners, p]) {
        assert.ok(!L.onRailway(line, c, .5), `${city}: plot on the railway`);
        assert.ok(!L.onSquare(line, square, c, .5), `${city}: plot on the station square`);
      }
      if (city === 'sales') assert.ok(p.corners.every(c => Math.hypot(c.x, c.z) > 56), 'plot by the lake');
    }
    // Plots never overlap: neighbours in a coarse grid, checked pairwise.
    const cells = new Map();
    for (const p of grid.plots) { const key = `${Math.floor(p.x / 12)}:${Math.floor(p.z / 12)}`; (cells.get(key) ?? cells.set(key, []).get(key)).push(p); }
    for (const p of grid.plots) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of cells.get(`${Math.floor(p.x / 12) + i}:${Math.floor(p.z / 12) + j}`) ?? []) {
      if (q === p) continue;
      const shrink = poly => { const cx = poly.reduce((s, v) => s + v.x, 0) / 4, cz = poly.reduce((s, v) => s + v.z, 0) / 4; return poly.map(v => ({ x: cx + (v.x - cx) * .98, z: cz + (v.z - cz) * .98 })); };
      assert.ok(!L.polygonsOverlap(shrink(p.corners), shrink(q.corners)), `${city}: plots overlap at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    }
  }
  // The group quarters stay where they were, with no plot over them.
  for (const site of SUPPORT.sites) {
    const s = Math.sin(site.angle), c = Math.cos(site.angle), l = site.length / 2, d = site.depth / 2;
    const corners = [[-l, -d], [l, -d], [l, d], [-l, d]].map(([a, b]) => ({ x: site.x + s * a + c * b, z: site.z + c * a - s * b }));
    for (const p of GRIDS.support.plots) assert.ok(!L.polygonsOverlap(p.corners, corners), `a plot on group quarter ${site.key}`);
  }
});

test('every district has its centre: the headquarters and the public square side by side at a street, on no plot', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    assert.deepEqual(grid.centres.map(c => c.district), [1, 2, 3]);
    for (const centre of grid.centres) {
      const block = grid.blocks.find(b => b.district === centre.district && b.block === centre.block);
      assert.ok(block && block.band <= 2, `${city}: the centre of district ${centre.district} lies near the city's centre`);
      assert.ok(centre.area.width >= L.CENTRE_WIDTH - 4 && centre.area.depth >= L.CENTRE_DEPTH, `${city}: centre ${centre.area.width.toFixed(1)} × ${centre.area.depth.toFixed(1)}`);
      // Inside the centre's own plots: in their columns and rows of the block.
      const inside = p => { const at = L.blockCell(block, p); return !!at && at.u >= centre.col && at.u <= centre.col + centre.cols && at.v >= centre.row && at.v <= centre.row + centre.rows; };
      const hq = L.squareCorners(centre.hq.x, centre.hq.z, centre.hq.rotation, L.HQ_HALF), plaza = L.squareCorners(centre.square.x, centre.square.z, centre.square.rotation, L.MODULE / 2);
      for (const p of [...hq, ...plaza]) assert.ok(inside(p), `${city}: district ${centre.district}'s centre spills out of its plots at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      assert.ok(!L.polygonsOverlap(hq, plaza), `${city}: the headquarters stands on the square`);
      for (const p of grid.plots) assert.ok(!L.polygonsOverlap(p.corners, centre.area.corners, -.05), `${city}: a plot for sale in district ${centre.district}'s centre`);
      // It faces a street: its front edge is a few steps from one.
      const front = { x: centre.area.x + Math.sin(centre.area.rotation) * centre.area.depth / 2, z: centre.area.z + Math.cos(centre.area.rotation) * centre.area.depth / 2 };
      const street = Math.min(...CITIES[city].roads.streets.map(road => L.segmentDistance(front.x, front.z, road)), ...CITIES[city].roads.rings.map(r => Math.abs(Math.hypot(front.x, front.z) - r)));
      assert.ok(street < 3, `${city}: district ${centre.district}'s centre is ${street.toFixed(1)} from a street`);
    }
  }
});

test('a point finds its plot, and a plot\'s frame lies on it', () => {
  for (const grid of Object.values(GRIDS)) {
    for (const p of grid.plots.filter((_, i) => i % 7 === 0)) {
      const at = L.plotAt(grid, p);
      assert.ok(at && at.block.district === p.district && at.block.block === p.block && at.col === p.col && at.row === p.row);
      // The front looks along `rotation`: a little ahead is still the plot, farther ahead the next one or the street.
      const ahead = k => ({ x: p.x + Math.sin(p.rotation) * p.depth * k, z: p.z + Math.cos(p.rotation) * p.depth * k });
      const near = L.plotAt(grid, ahead(.4)), far = L.plotAt(grid, ahead(.9));
      const same = at => at && at.block.district === p.district && at.block.block === p.block && at.col === p.col && at.row === p.row;
      assert.ok(same(near), 'a little ahead is the same plot');
      assert.ok(!same(far), 'a plot ahead is the next one');
    }
    for (const centre of grid.centres) assert.equal(L.plotAt(grid, centre.hq), null, 'the centre is not for sale');
  }
});

test('every plot faces the nearest street of its block, and a plot on a street has its front edge there', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    const world = CITIES[city], gap = p => Math.min(...world.roads.streets.map(road => L.segmentDistance(p.x, p.z, road)), ...world.roads.rings.map(r => Math.abs(Math.hypot(p.x, p.z) - r)));
    let onStreet = 0;
    for (const p of grid.plots) {
      const front = { x: p.x + Math.sin(p.rotation) * p.depth / 2, z: p.z + Math.cos(p.rotation) * p.depth / 2 }, back = { x: p.x - Math.sin(p.rotation) * p.depth / 2, z: p.z - Math.cos(p.rotation) * p.depth / 2 };
      // The front is never farther from a street than the back, and on a street it is right there.
      assert.ok(gap(front) <= gap(back) + 1e-6 || !p.street, `${city}: plot ${p.district}:${p.block}:${p.col}:${p.row} turns its back to the street`);
      if (p.street) { onStreet++; assert.ok(gap(front) < L.ROAD_GAP + .3, `${city}: plot ${p.district}:${p.block}:${p.col}:${p.row} is ${gap(front).toFixed(2)} from its street`); }
    }
    assert.ok(onStreet > grid.plots.length * .35, `${city}: ${onStreet} of ${grid.plots.length} plots on a street`);
  }
  // The island city's first band lies between the canal and the first ring road: it faces outwards, to the road.
  for (const p of GRIDS.support.plots.filter(p => p.band === 1)) assert.ok(Math.hypot(p.x + Math.sin(p.rotation), p.z + Math.cos(p.rotation)) > Math.hypot(p.x, p.z), 'the first band faces its ring road');
});

test('the island city\'s mainland is empty for the districts: no houses, yards, trees or car parks, lamps only by roads', () => {
  const town = L.generateWorld(L.WORLD_X4), bank = L.WORLD_X4.bank, horizon = L.WORLD_X4.horizon;
  const mainland = p => { const r = Math.hypot(p.x, p.z); return r > bank && r < horizon; };
  assert.ok(town.placements.filter(mainland).length > 5000, 'the generated town had a mainland full of houses');
  // The station's square is laid out after the clearing; its copies are its own.
  const square = L.stationSquare(SUPPORT), key = p => `${p.kind ?? ''}:${p.x}:${p.z}`, ours = list => new Set(list.map(key));
  const own = ours(square.placements), patches = ours(square.surfaces), lots = new Set(square.parking.map(lot => `${lot.x}:${lot.z}`));
  const left = SUPPORT.placements.filter(p => mainland(p) && !own.has(key(p)));
  assert.ok(left.every(p => p.kind === 'lamp'), `left on the mainland: ${[...new Set(left.map(p => p.kind))].join(', ')}`);
  for (const lamp of left) assert.ok(SUPPORT.roads.rings.some(r => Math.abs(Math.hypot(lamp.x, lamp.z) - r) < 1.6) || SUPPORT.roads.streets.some(road => L.segmentDistance(lamp.x, lamp.z, road) < 1.6), 'a lamp off the roads');
  assert.ok(SUPPORT.surfaces.filter(mainland).every(s => patches.has(key(s))), 'yards and gardens left');
  assert.ok(SUPPORT.roads.parking.filter(mainland).every(lot => lots.has(`${lot.x}:${lot.z}`)), 'car parks left on the mainland');
  assert.deepEqual([SUPPORT.complexes.length, SUPPORT.alleys.length], [0, 0]);
  // What stays: the roads, the island ring with its plots and car parks, the group quarters, the forests on the hills.
  assert.deepEqual(SUPPORT.roads.rings, town.roads.rings);
  assert.equal(SUPPORT.sites.length, town.sites.length);
  assert.equal(SUPPORT.plots.length, town.plots.length);
  assert.ok(SUPPORT.roads.parking.filter(lot => Math.hypot(lot.x, lot.z) < bank).length >= 2);
  assert.ok(SUPPORT.placements.filter(p => Math.hypot(p.x, p.z) > horizon).length > 500, 'the hill forests');
  // The lake city has no houses of its own either.
  assert.ok(!SALES.placements.some(p => p.kind === 'cottage' || p.kind === 'glass-tower'));
});

test('laying the grid out is quick', () => {
  let best = Infinity;
  for (let k = 0; k < 3; k++) { const t = performance.now(); L.landGrid(SUPPORT); best = Math.min(best, performance.now() - t); }
  assert.ok(best < 250, `${best.toFixed(0)} ms`);
});
