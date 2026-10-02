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

const BORDERS = { support: L.districtBorders(GRIDS.support, SUPPORT), sales: L.districtBorders(GRIDS.sales, SALES) };
const along = (b, t) => ({ x: b.a.x + (b.b.x - b.a.x) * t, z: b.a.z + (b.b.z - b.a.z) * t });
const pieceLength = b => Math.hypot(b.b.x - b.a.x, b.b.z - b.a.z);

test('the districts\' borders run between their blocks: on each side the land of the district named for it', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    const borders = BORDERS[city], blockAt = p => grid.blocks.find(b => L.blockCell(b, p));
    assert.deepEqual([...new Set(borders.map(b => [b.toward, b.away].sort().join(' and ')))].sort(), ['1 and 2', '1 and 3', '2 and 3'], `${city}: every two districts meet`);
    let both = 0, samples = 0;
    for (const b of borders) {
      const length = pieceLength(b), steps = Math.ceil(length), dx = b.b.x - b.a.x, dz = b.b.z - b.a.z;
      assert.ok(length >= 2 && b.toward !== b.away, `${city}: a border of ${length.toFixed(1)} between ${b.away} and ${b.toward}`);
      assert.ok(Math.abs(Math.hypot(b.normal.x, b.normal.z) - 1) < 1e-9 && Math.abs(b.normal.x * dx + b.normal.z * dz) < 1e-9 * length, `${city}: the normal points across the border`);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, p = along(b, t), half = (b.gaps[0] + (b.gaps[1] - b.gaps[0]) * t) / 2, where = `${city}: at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
        const side = k => blockAt({ x: p.x + b.normal.x * k, z: p.z + b.normal.z * k });
        // The gap is no district's land; right past its edge, each side is the land of its district (or none, by a road).
        assert.equal(side(half - .02), undefined, `${where} the gap is narrower than ${2 * half}`);
        assert.equal(side(-half + .02), undefined, `${where} the gap is narrower than ${2 * half}`);
        const toward = side(half + .05), away = side(-half - .05);
        if (toward) assert.equal(toward.district, b.toward, `${where} district ${toward.district} on district ${b.toward}'s side`);
        if (away) assert.equal(away.district, b.away, `${where} district ${away.district} on district ${b.away}'s side`);
        samples++; if (toward && away) both++;
      }
    }
    assert.ok(both > samples * .95, `${city}: land on both sides at ${both} of ${samples} points`);
  }
});

test('a border keeps to the land: off the water, the ring roads, the streets it crosses, the railway and the station square', () => {
  for (const [city, world] of Object.entries(CITIES)) {
    const line = world.railway, square = L.stationSquare(world), rect = world.land.rectangle;
    for (const b of BORDERS[city]) for (let t = 0; t <= 1; t += 1 / 64) {
      const p = along(b, t), r = Math.hypot(p.x, p.z), where = `${city}: border at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
      if (rect) assert.ok(r > rect.lake + 3 && Math.abs(p.x) < rect.width / 2 && Math.abs(p.z) < rect.depth / 2, `${where} over the lake or off the land`);
      else assert.ok(world.land.annuli.some(a => r > a.inner && r < a.outer), `${where} over the water`);
      // The ring roads are 2 wide and lie lower than the band; a street it crosses stands higher and would hide it.
      for (const ring of world.roads.rings) assert.ok(Math.abs(r - ring) > 1.15, `${where} on ring road ${ring}`);
      assert.ok(!L.onRailway(line, p, .5) && !L.onSquare(line, square, p, .5), `${where} on the railway or the station square`);
      // Right down the middle of its street, or clear of every street.
      const near = world.roads.streets.map(road => L.segmentDistance(p.x, p.z, road)).sort((x, y) => x - y);
      if (b.street) assert.ok(near[0] < 1e-6 && near[1] > 1.15, `${where} off its street or on a crossing`);
      else assert.ok(near[0] > 1.15, `${where} on a street`);
    }
  }
});

test('the island city\'s three borders run from the canal to the horizon at BORDERS, along the avenues where they reach', () => {
  const mainland = SUPPORT.land.annuli.reduce((p, q) => q.outer - q.inner > p.outer - p.inner ? q : p);
  const crossings = SUPPORT.roads.rings.filter(r => r > mainland.inner && r < mainland.outer).length;
  const turn = (a, b) => Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  L.BORDERS.forEach((angle, i) => {
    const ours = BORDERS.support.filter(b => turn(Math.atan2(b.a.z, b.a.x), angle) < .021);
    // District k runs counter-clockwise from BORDERS[k - 1]: the normal points that way, into it.
    for (const b of ours) {
      assert.ok(turn(Math.atan2(b.b.z, b.b.x), angle) < .021, 'a border runs out from the centre');
      assert.deepEqual([b.away, b.toward], [(i + 2) % 3 + 1, i + 1]);
      assert.ok(b.normal.x * -Math.sin(angle) + b.normal.z * Math.cos(angle) > .99, 'the normal points counter-clockwise');
      // A street's two kerbs, or the footpath through a block: the gap between the districts is as the grid cut it.
      assert.ok(Math.abs((b.gaps[0] + b.gaps[1]) / 2 - 2 * (b.street ? L.ROAD_GAP : L.BORDER_GAP)) < .1, `a gap of ${b.gaps.map(g => g.toFixed(2)).join(' to ')}`);
      assert.ok(b.gaps[1] > b.gaps[0] === Math.hypot(b.b.x, b.b.z) > Math.hypot(b.a.x, b.a.z), 'the radial cut widens outwards');
    }
    const length = ours.reduce((sum, b) => sum + pieceLength(b), 0);
    assert.ok(length > mainland.outer - mainland.inner - 4 * crossings - 4, `border ${i + 1}: ${length.toFixed(0)} of the mainland's ${(mainland.outer - mainland.inner).toFixed(0)}`);
    // The middle border runs through blocks, the other two down the avenues (the first band has none on one of them).
    const streets = ours.filter(b => b.street).length;
    if (i === 1) assert.equal(streets, 0, 'the middle border is a footpath');
    else assert.ok(streets >= GRIDS.support.bands - 1, `border ${i + 1}: ${streets} of ${ours.length} pieces along an avenue`);
  });
  assert.equal(BORDERS.support.filter(b => L.BORDERS.some(angle => turn(Math.atan2(b.a.z, b.a.x), angle) < .021)).length, BORDERS.support.length);
});

test('the lake city\'s districts meet along its streets and down the boulevard to the station, never over the lake', () => {
  const borders = BORDERS.sales, pair = b => [b.toward, b.away].sort().join('');
  const length = key => borders.filter(b => pair(b) === key).reduce((sum, b) => sum + pieceLength(b), 0);
  // The top district meets the left and the right ones along the frame of streets and by the lake.
  for (const key of ['12', '13']) {
    assert.ok(length(key) > 150, `${key}: ${length(key).toFixed(0)}`);
    assert.ok(borders.filter(b => pair(b) === key && b.street).reduce((sum, b) => sum + pieceLength(b), 0) > 120, `${key} along the streets`);
  }
  // The left and the right meet down the boulevard from the lake to the station: no street, the walk between its trees.
  for (const b of borders.filter(b => pair(b) === '23')) assert.ok(!b.street && Math.abs(b.a.x) < 1e-9 && Math.abs(b.b.x) < 1e-9 && b.a.z > 0, 'the boulevard');
  assert.ok(length('23') > 40, `23: ${length('23').toFixed(0)}`);
  for (const b of borders) for (const gap of b.gaps) assert.ok(Math.abs(gap - 2 * L.ROAD_GAP) < 1e-9, `a gap of ${gap} between the blocks`);
});

test('laying the grid out and finding its borders is quick', () => {
  let best = Infinity;
  for (let k = 0; k < 3; k++) { const t = performance.now(); L.landGrid(SUPPORT); best = Math.min(best, performance.now() - t); }
  assert.ok(best < 250, `${best.toFixed(0)} ms`);
  for (const [city, grid] of Object.entries(GRIDS)) {
    let fastest = Infinity;
    for (let k = 0; k < 3; k++) { const t = performance.now(); L.districtBorders(grid, CITIES[city]); fastest = Math.min(fastest, performance.now() - t); }
    assert.ok(fastest < 40, `${city} borders: ${fastest.toFixed(1)} ms`);
  }
});
