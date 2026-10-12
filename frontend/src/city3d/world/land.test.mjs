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
const CELLS = { support: L.landCells(GRIDS.support), sales: L.landCells(GRIDS.sales) };
const same = (at, c) => !!at && at.block.district === c.district && at.block.block === c.block && at.col === c.col && at.row === c.row;
const near = (p, q, d = 1e-6) => Math.hypot(p.x - q.x, p.z - q.z) < d;

test('the server sells the cells of the client\'s grid (app/data/city_land.json is up to date)', async () => {
  assert.equal(readFileSync(LAND_FILE, 'utf8'), await cityLandText(), 'run `node scripts/city-land.mjs` in frontend/');
  const data = JSON.parse(readFileSync(LAND_FILE, 'utf8'));
  // A building stands on CELLS × CELLS cells, on the server as here.
  assert.equal(data.plot_cells, L.CELLS);
  assert.equal(L.CELLS, 3);
  for (const [city, grid] of Object.entries(GRIDS)) {
    const blocks = Object.values(data.cities[city].districts).flat();
    // The cells not for sale go as runs of a row: [first column, last column, row].
    const skipped = b => b.skip.reduce((sum, [c0, c1]) => sum + c1 - c0 + 1, 0);
    assert.equal(blocks.reduce((sum, b) => sum + b.cols * b.rows - skipped(b), 0), CELLS[city].length, `${city}: cells`);
    assert.deepEqual(Object.keys(data.cities[city].districts), ['1', '2', '3']);
    assert.equal(data.cities[city].bands, grid.bands);
  }
  assert.equal(L.landGrid(L.generateWorld(L.WORLD_V1)), null, 'the old v1 map has no district land');
});

test('the whole city goes to three districts of about the same size, cell by cell', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    const cells = CELLS[city], counts = [1, 2, 3].map(d => cells.filter(c => c.district === d).length), mean = counts.reduce((a, b) => a + b) / 3;
    for (const n of counts) assert.ok(Math.abs(n - mean) / mean < .1, `${city}: ${counts.join(' / ')} cells`);
    assert.ok(cells.length > (city === 'support' ? 27000 : 4500), `${city}: ${cells.length} cells`);
    // Every cell is about a third of PLOT across: nine of them make up a building's plot.
    for (const c of cells) assert.ok(Math.min(c.width, c.depth) > 2.4 && Math.max(c.width, c.depth) < 3.6, `${city}: cell ${c.width.toFixed(2)} × ${c.depth.toFixed(2)}`);
    // Bands count outwards and set the price of land; every district has land in the first.
    for (const d of [1, 2, 3]) assert.ok(cells.some(c => c.district === d && c.band === 1), `${city}: district ${d} has a first band`);
    assert.equal(Math.max(...cells.map(c => c.band)), grid.bands);
    const keys = new Set(cells.map(c => `${c.district}:${L.cellKey(c.block, c.col, c.row)}`));
    assert.equal(keys.size, cells.length, `${city}: one address a cell`);
  }
  // The island city's bands are rings, one block for each district: a band's cells lie farther out than the band before.
  const radius = c => Math.hypot(c.x, c.z), byBand = b => CELLS.support.filter(c => c.band === b).map(radius);
  for (let b = 1; b < GRIDS.support.bands; b++) assert.ok(Math.max(...byBand(b)) < Math.min(...byBand(b + 1)), `band ${b} inside band ${b + 1}`);
  for (let b = 1; b <= GRIDS.support.bands; b++) assert.deepEqual(GRIDS.support.blocks.filter(x => x.band === b).map(x => x.district).sort(), [1, 2, 3]);
  // Its rows and columns come in threes, so the old plots' lines still run through the cells.
  for (const b of GRIDS.support.blocks) assert.ok(b.cols % L.CELLS === 0 && b.rows % L.CELLS === 0, `${b.cols} × ${b.rows}`);
});

test('no cell on the railway, the station\'s square and street, the lake or a group quarter, no block over another', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    const world = CITIES[city], line = world.railway, square = L.stationSquare(world);
    for (const c of CELLS[city]) {
      for (const road of world.roads.streets) if (L.segmentDistance(c.x, c.z, road) < 8) assert.ok(L.segmentPolygonDistance(road, c.corners) >= 1.3, `${city}: cell ${c.district}:${c.block}:${c.col}:${c.row} on a street`);
      for (const r of world.roads.rings) for (const p of c.corners) assert.ok(Math.abs(Math.hypot(p.x, p.z) - r) >= 1.3 - 1e-6, `${city}: cell on a ring road`);
      for (const p of [...c.corners, c]) {
        assert.ok(!L.onRailway(line, p, .5), `${city}: cell on the railway`);
        assert.ok(!L.onSquare(line, square, p, .5), `${city}: cell on the station square`);
      }
      if (city === 'sales') assert.ok(c.corners.every(p => Math.hypot(p.x, p.z) > 56), 'cell by the lake');
    }
    // Cells of a block never overlap; blocks never do either: the same band's sectors or the rectangles stay apart.
    const TAU = 2 * Math.PI, wrap = a => ((a % TAU) + TAU) % TAU;
    for (const a of grid.blocks) for (const b of grid.blocks) {
      if (a === b) continue;
      const s = a.shape, t = b.shape;
      if (s.kind === 'ring') {
        if (Math.min(s.r1, t.r1) - Math.max(s.r0, t.r0) <= 1e-9) continue;
        assert.ok(wrap(t.a0 - s.a0) >= s.a1 - s.a0 - 1e-9, `${city}: blocks ${a.district}:${a.block} and ${b.district}:${b.block} overlap`);
      } else {
        const across = Math.min(s.x1, t.x1) - Math.max(s.x0, t.x0), down = Math.min(s.z1, t.z1) - Math.max(s.z0, t.z0);
        assert.ok(across <= 1e-9 || down <= 1e-9, `${city}: blocks ${a.district}:${a.block} and ${b.district}:${b.block} overlap`);
      }
    }
  }
  // The island city's land is all the districts': beside the centres only the railway, the station's square and its
  // street keep cells from sale (the group quarters that stood across the canal are gone).
  const line = SUPPORT.railway, square = L.stationSquare(SUPPORT), grid = GRIDS.support;
  const streets = SUPPORT.roads.streets.filter(([ax, az, bx, bz]) => Math.max(Math.hypot(ax, az), Math.hypot(bx, bz)) > L.WORLD_X4.bank);
  for (const block of grid.blocks) for (const key of block.skip) {
    const [c, r] = key.split(':').map(Number), centre = grid.centres.find(x => x.district === block.district && x.block === block.block);
    if (centre && c >= centre.col && c < centre.col + centre.cols && r >= centre.row && r < centre.row + centre.rows) continue;
    const corners = L.areaCorners(block, c, r), middle = L.areaPoint(corners, .5, .5);
    const kept = [...corners, middle].some(p => L.onRailway(line, p, 1.5) || L.onSquare(line, square, p, 1.5))
      || streets.some(road => L.segmentPolygonDistance(road, corners) < L.ROAD_GAP);
    assert.ok(kept, `district ${block.district}, block ${block.block}: cell ${key} kept from sale for nothing`);
  }
});

test('every district has its centre: the headquarters and the public square side by side at the front of a block, on no cell for sale', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    assert.deepEqual(grid.centres.map(c => c.district), [1, 2, 3]);
    for (const centre of grid.centres) {
      const block = grid.blocks.find(b => b.district === centre.district && b.block === centre.block);
      assert.ok(block && block.band <= 2, `${city}: the centre of district ${centre.district} lies near the city's centre`);
      assert.ok(centre.area.width >= L.CENTRE_WIDTH - 1e-6 && centre.area.depth >= L.CENTRE_DEPTH - 1e-6, `${city}: centre ${centre.area.width.toFixed(1)} × ${centre.area.depth.toFixed(1)}`);
      // Its cells are kept from sale, and nothing else of the block is.
      for (let c = centre.col; c < centre.col + centre.cols; c++) for (let r = centre.row; r < centre.row + centre.rows; r++) assert.ok(block.skip.has(`${c}:${r}`), `${city}: a centre's cell for sale`);
      // Inside the centre's own cells: in their columns and rows of the block.
      const inside = p => { const at = L.blockCell(block, p); return !!at && at.u >= centre.col && at.u <= centre.col + centre.cols && at.v >= centre.row && at.v <= centre.row + centre.rows; };
      const hq = L.squareCorners(centre.hq.x, centre.hq.z, centre.hq.rotation, L.HQ_HALF), plaza = L.squareCorners(centre.square.x, centre.square.z, centre.square.rotation, L.MODULE / 2);
      for (const p of [...hq, ...plaza]) assert.ok(inside(p), `${city}: district ${centre.district}'s centre spills out of its cells at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      assert.ok(!L.polygonsOverlap(hq, plaza), `${city}: the headquarters stands on the square`);
      // Nowhere in it is a cell for sale, of its block or another.
      for (let c = centre.col; c < centre.col + centre.cols; c++) for (let r = centre.row; r < centre.row + centre.rows; r++) for (const [u, v] of [[.5, .5], [.1, .1], [.9, .1], [.9, .9], [.1, .9]]) {
        assert.equal(L.cellAt(grid, L.areaPoint(L.areaCorners(block, c, r), u, v)), null, `${city}: a cell for sale in district ${centre.district}'s centre`);
      }
      // It stands at the front of its block, its front towards the middle of the city.
      const side = { in: centre.row === 0, z1: centre.row + centre.rows === block.rows, x1: centre.col + centre.cols === block.cols, x0: centre.col === 0 };
      assert.ok(Object.values(side).some(Boolean), `${city}: district ${centre.district}'s centre is not at its block's edge`);
      const front = { x: centre.area.x + Math.sin(centre.area.rotation) * centre.area.depth / 2, z: centre.area.z + Math.cos(centre.area.rotation) * centre.area.depth / 2 };
      assert.ok(Math.hypot(front.x, front.z) < Math.hypot(centre.area.x, centre.area.z) - centre.area.depth / 3, `${city}: district ${centre.district}'s centre turns from the middle of the city`);
    }
  }
});

test('a point finds its cell, and a cell\'s frame lies on it', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    for (const c of CELLS[city].filter((_, i) => i % 7 === 0)) {
      assert.ok(same(L.cellAt(grid, c), c), `${city}: the middle of ${c.block}:${c.col}:${c.row}`);
      // Just inside each corner is still the cell.
      for (const p of c.corners) assert.ok(same(L.cellAt(grid, { x: p.x + (c.x - p.x) * .05, z: p.z + (c.z - p.z) * .05 }), c), `${city}: a corner of ${c.block}:${c.col}:${c.row}`);
      // The front looks along `rotation`: a little ahead is still the cell, a cell's depth ahead is not.
      const ahead = k => ({ x: c.x + Math.sin(c.rotation) * c.depth * k, z: c.z + Math.cos(c.rotation) * c.depth * k });
      assert.ok(same(L.cellAt(grid, ahead(.4)), c), 'a little ahead is the same cell');
      assert.ok(!same(L.cellAt(grid, ahead(.9)), c), 'a cell ahead is the next one');
    }
    for (const centre of grid.centres) {
      assert.equal(L.cellAt(grid, centre.hq), null, 'the centre is not for sale');
      assert.equal(L.cellUnder(grid, centre.hq)?.skipped, true, 'though it is the district\'s land');
    }
    assert.equal(L.cellUnder(grid, { x: 0, z: 0 }), null, `${city}: the middle of the city is no district's land`);
  }
});

test('an area of cells has one frame: its corners, its front at any side, a quarter turn at a time', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    for (const block of grid.blocks) {
      if (block.cols < 3 || block.rows < 3) continue;
      const col = Math.floor(block.cols / 2) - 1, row = Math.floor(block.rows / 2) - 1, corners = L.areaCorners(block, col, row, 3, 3);
      // Nine cells, the corners of the first and the last of them.
      assert.ok(near(corners[0], L.areaCorners(block, col, row)[0]) && near(corners[2], L.areaCorners(block, col + 2, row + 2)[2]), `${city}: block ${block.district}:${block.block}`);
      const home = L.homeSide(block, col, row, 3, 3);
      if (block.shape.kind === 'ring') assert.equal(home, 'in', 'on the island city a building looks to the centre');
      const sides = [0, 1, 2, 3].map(k => L.turnedSide(block, home, k));
      assert.equal(new Set(sides).size, 4, 'four turns, four sides');
      assert.equal(L.turnedSide(block, home, 4), home);
      for (const side of sides) {
        assert.equal(L.sideOf(block, L.wayOf(side)), side);
        const frame = L.areaFrame(block, col, row, 3, 3, side, true);
        assert.deepEqual(frame.corners, corners);
        assert.equal(frame.street, true);
        // The front's middle lies on the side it looks to: the middle of that edge (on a ring, of its arc).
        const front = { x: frame.x + Math.sin(frame.rotation) * frame.depth / 2, z: frame.z + Math.cos(frame.rotation) * frame.depth / 2 };
        const way = L.wayOf(side);
        const middle = L.areaPoint(corners, way === 'col-' ? 0 : way === 'col+' ? 1 : .5, way === 'row-' ? 0 : way === 'row+' ? 1 : .5);
        assert.ok(near(front, middle, .3), `${city}: the front at ${side} is ${Math.hypot(front.x - middle.x, front.z - middle.z).toFixed(2)} off its edge`);
        // Its width runs along that edge, through the area's middle.
        const [p, q] = way === 'row-' || way === 'row+' ? [L.areaPoint(corners, 0, .5), L.areaPoint(corners, 1, .5)] : [L.areaPoint(corners, .5, 0), L.areaPoint(corners, .5, 1)];
        assert.ok(Math.abs(frame.width - Math.hypot(q.x - p.x, q.z - p.z)) < .05, `${city}: the width along ${side}`);
      }
    }
  }
});

test('neighbouring cells meet on their shared edge, across a block\'s edge too, and never across a district border', () => {
  const opposite = { 'row-': 'row+', 'row+': 'row-', 'col-': 'col+', 'col+': 'col-' };
  for (const [city, grid] of Object.entries(GRIDS)) {
    let across = 0;
    for (const c of CELLS[city].filter(c => c.row === 0 || c.col === 0 || c.col % 11 === 0)) {
      const block = grid.blocks.find(b => b.district === c.district && b.block === c.block);
      for (const way of L.WAYS) {
        const next = L.neighbours(grid, block, c.col, c.row, way);
        let covered = 0;
        for (const n of next) {
          assert.equal(n.block.district, c.district, `${city}: a neighbour in another district`);
          assert.ok(!n.block.skip.has(`${n.col}:${n.row}`), `${city}: a neighbour not for sale`);
          assert.ok(n.from >= -1e-9 && n.to <= 1 + 1e-9 && n.to > n.from, `${city}: a shared stretch of ${n.from}…${n.to}`);
          covered += n.to - n.from;
          // The meeting point is on both cells' edges: the next cell is right past it, this one right before it.
          const into = { x: n.meet.x + (n.meet.x - c.x) * .02, z: n.meet.z + (n.meet.z - c.z) * .02 };
          assert.ok(same(L.cellAt(grid, into), { district: c.district, block: n.block.block, col: n.col, row: n.row }), `${city}: ${c.block}:${c.col}:${c.row} ${way} meets ${n.block.block}:${n.col}:${n.row} off their edge`);
          // And the way back finds this cell, meeting at the same point when the two edges match.
          const back = L.neighbours(grid, n.block, n.col, n.row, opposite[way]).find(m => m.block === block && m.col === c.col && m.row === c.row);
          assert.ok(back, `${city}: ${n.block.block}:${n.col}:${n.row} does not see ${c.block}:${c.col}:${c.row} back`);
          if (n.block !== block) { across++; if (Math.abs(n.to - n.from - 1) < 1e-9 && Math.abs(back.to - back.from - 1) < 1e-9) assert.ok(near(back.meet, n.meet, 1e-6)); }
        }
        assert.ok(covered <= 1 + 1e-9, `${city}: neighbours share more than the edge`);
      }
    }
    assert.ok(across > (city === 'support' ? 500 : 100), `${city}: ${across} neighbours across blocks`);
    // A block's first column has no neighbour back a column on the island city: the next block that way is another district's.
    for (const block of grid.blocks.filter(b => b.shape.kind === 'ring')) for (let row = 0; row < block.rows; row++) {
      assert.deepEqual(L.neighbours(grid, block, 0, row, 'col-'), []);
      assert.deepEqual(L.neighbours(grid, block, block.cols - 1, row, 'col+'), []);
    }
  }
});

test('a road is laid along the land\'s lines: every cell between two, through one corner, of the first one\'s district', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    for (const block of grid.blocks.filter(b => b.skip.size === 0 && b.cols >= 12 && b.rows >= 6)) {
      const ref = (col, row) => ({ block, col, row }), key = c => `${c.block.block}:${c.col}:${c.row}`;
      // Along a row: each cell once, in order.
      const row = L.cellsBetween(grid, ref(2, 1), ref(10, 1));
      assert.deepEqual(row.map(c => [c.col, c.row]), Array.from({ length: 9 }, (_, i) => [2 + i, 1]), `${city}: block ${block.district}:${block.block} along a row`);
      // Across both ways: as many cells as the steps between them, joined through one corner.
      const bend = L.cellsBetween(grid, ref(1, 1), ref(9, 4));
      assert.equal(bend.length, 8 + 3 + 1, `${city}: block ${block.district}:${block.block} ${bend.map(key).join(' ')}`);
      assert.equal(new Set(bend.map(key)).size, bend.length);
      for (let i = 1; i < bend.length; i++) assert.equal(Math.abs(bend[i].col - bend[i - 1].col) + Math.abs(bend[i].row - bend[i - 1].row), 1, 'each cell next to the last');
      assert.ok([[9, 1], [1, 4]].some(([c, r]) => bend.some(x => x.col === c && x.row === r)), 'through a corner');
    }
    // Only the first one's district: from one district into another stops at the border.
    const [a, b] = [1, 2].map(d => grid.blocks.find(x => x.district === d && x.band === 2));
    const into = L.cellsBetween(grid, { block: a, col: a.cols - 1, row: 1 }, { block: b, col: 0, row: 1 });
    assert.ok(into.every(c => c.block.district === 1), `${city}: a road into the next district`);
  }
});

test('the island city\'s mainland is empty for the districts: no roads, houses, yards, trees, lamps, car parks or traffic', () => {
  const town = L.generateWorld(L.WORLD_X4), bank = L.WORLD_X4.bank, horizon = L.WORLD_X4.horizon;
  const mainland = p => { const r = Math.hypot(p.x, p.z); return r > bank && r < horizon; };
  assert.ok(town.placements.filter(mainland).length > 5000, 'the generated town had a mainland full of houses');
  assert.ok(town.roads.streets.filter(([ax, az, bx, bz]) => mainland({ x: (ax + bx) / 2, z: (az + bz) / 2 })).length >= 6 && town.roads.rings.filter(r => r > bank).length >= 3, 'and its ring roads and avenues');
  // The station's square is laid out after the clearing; its copies are its own.
  const square = L.stationSquare(SUPPORT), key = p => `${p.kind ?? ''}:${p.x}:${p.z}`, ours = list => new Set(list.map(key));
  const own = ours(square.placements), patches = ours(square.surfaces), lots = new Set(square.parking.map(lot => `${lot.x}:${lot.z}`));
  const left = SUPPORT.placements.filter(p => mainland(p) && !own.has(key(p)));
  assert.deepEqual([...new Set(left.map(p => p.kind))], [], 'left on the mainland');
  assert.ok(SUPPORT.surfaces.filter(mainland).every(s => patches.has(key(s))), 'yards and gardens left');
  assert.ok(SUPPORT.roads.parking.filter(mainland).every(lot => lots.has(`${lot.x}:${lot.z}`)), 'car parks left on the mainland');
  // No ring road or avenue on the mainland: only the station's own street reaches it.
  assert.ok(SUPPORT.roads.rings.every(r => r < bank), `ring roads ${SUPPORT.roads.rings.join(', ')}`);
  const streets = SUPPORT.roads.streets.filter(([ax, az, bx, bz]) => Math.max(Math.hypot(ax, az), Math.hypot(bx, bz)) > bank);
  assert.deepEqual(streets, square.streets, 'a street on the mainland');
  assert.ok(SUPPORT.roads.crosswalks.every(c => !mainland(c)), 'a crossing on the mainland');
  assert.ok(SUPPORT.routes.every(plan => plan.route.points.every((p, i) => plan.route.hidden[i] || !mainland(p))), 'traffic on the mainland');
  assert.deepEqual([SUPPORT.complexes.length, SUPPORT.alleys.length], [0, 0]);
  // What stays: the island ring with its road, plots and car parks, the forests on the hills.
  assert.deepEqual(SUPPORT.roads.rings, town.roads.rings.filter(r => r < bank));
  assert.equal(SUPPORT.plots.length, town.plots.length);
  assert.ok(SUPPORT.roads.parking.filter(lot => Math.hypot(lot.x, lot.z) < bank).length >= 2);
  assert.ok(SUPPORT.placements.filter(p => Math.hypot(p.x, p.z) > horizon).length > 500, 'the hill forests');
  // The lake city has no houses and no streets of its own either: only its station's.
  assert.ok(!SALES.placements.some(p => p.kind === 'cottage' || p.kind === 'glass-tower'));
  assert.deepEqual(SALES.roads.streets, L.stationSquare(SALES).streets);
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
      assert.equal(b.street, false, `${city}: no street runs down a border`);
      // Between the ends: where two bands meet, each band's cut is its own width.
      for (let i = 0; i <= steps; i++) {
        const t = (i + .5) / (steps + 1), p = along(b, t), half = (b.gaps[0] + (b.gaps[1] - b.gaps[0]) * t) / 2, where = `${city}: at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
        const side = k => blockAt({ x: p.x + b.normal.x * k, z: p.z + b.normal.z * k });
        // The gap is no district's land; right past its edge, each side is the land of its district.
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

test('a border keeps to the land: off the water, the railway and the station square and street', () => {
  for (const [city, world] of Object.entries(CITIES)) {
    const line = world.railway, square = L.stationSquare(world), rect = world.land.rectangle;
    for (const b of BORDERS[city]) for (let t = 0; t <= 1; t += 1 / 64) {
      const p = along(b, t), r = Math.hypot(p.x, p.z), where = `${city}: border at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
      if (rect) assert.ok(r > rect.lake + 3 && Math.abs(p.x) < rect.width / 2 && Math.abs(p.z) < rect.depth / 2, `${where} over the lake or off the land`);
      else assert.ok(world.land.annuli.some(a => r > a.inner && r < a.outer), `${where} over the water`);
      for (const ring of world.roads.rings) assert.ok(Math.abs(r - ring) > 1.15, `${where} on ring road ${ring}`);
      assert.ok(!L.onRailway(line, p, .5) && !L.onSquare(line, square, p, .5), `${where} on the railway or the station square`);
      assert.ok(world.roads.streets.every(road => L.segmentDistance(p.x, p.z, road) > 1.15), `${where} on a street`);
    }
  }
});

test('the island city\'s three borders run from the canal to the horizon at BORDERS, a narrow cut between the bands\' blocks', () => {
  const mainland = SUPPORT.land.annuli.reduce((p, q) => q.outer - q.inner > p.outer - p.inner ? q : p);
  const turn = (a, b) => Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  L.BORDERS.forEach((angle, i) => {
    const ours = BORDERS.support.filter(b => turn(Math.atan2(b.a.z, b.a.x), angle) < .021);
    // District k runs counter-clockwise from BORDERS[k - 1]: the normal points that way, into it.
    for (const b of ours) {
      assert.ok(turn(Math.atan2(b.b.z, b.b.x), angle) < .021, 'a border runs out from the centre');
      assert.deepEqual([b.away, b.toward], [(i + 2) % 3 + 1, i + 1]);
      assert.ok(b.normal.x * -Math.sin(angle) + b.normal.z * Math.cos(angle) > .99, 'the normal points counter-clockwise');
      // The gap the grid cut between the districts, about twice BORDER_GAP; the radial cut widens outwards.
      assert.ok(Math.min(...b.gaps) > L.BORDER_GAP && Math.max(...b.gaps) < 4 * L.BORDER_GAP, `a gap of ${b.gaps.map(g => g.toFixed(2)).join(' to ')}`);
      assert.ok(b.gaps[1] > b.gaps[0] === Math.hypot(b.b.x, b.b.z) > Math.hypot(b.a.x, b.a.z), 'the radial cut widens outwards');
    }
    // From the canal to the horizon, but for the railway and its station where they cross.
    const length = ours.reduce((sum, b) => sum + pieceLength(b), 0);
    assert.ok(length > mainland.outer - mainland.inner - 40, `border ${i + 1}: ${length.toFixed(0)} of the mainland's ${(mainland.outer - mainland.inner).toFixed(0)}`);
  });
  assert.equal(BORDERS.support.filter(b => L.BORDERS.some(angle => turn(Math.atan2(b.a.z, b.a.x), angle) < .021)).length, BORDERS.support.length);
});

test('the lake city\'s districts meet where its streets ran and down the boulevard to the station, never over the lake', () => {
  const borders = BORDERS.sales, pair = b => [b.toward, b.away].sort().join('');
  const length = key => borders.filter(b => pair(b) === key).reduce((sum, b) => sum + pieceLength(b), 0);
  // The top district meets the left and the right ones round the lake's corners and out to the edge.
  for (const key of ['12', '13']) assert.ok(length(key) > 150, `${key}: ${length(key).toFixed(0)}`);
  // The left and the right meet down the boulevard from the lake to the station: the walk between its trees.
  for (const b of borders.filter(b => pair(b) === '23')) assert.ok(Math.abs(b.a.x) < 1e-9 && Math.abs(b.b.x) < 1e-9 && b.a.z > 0, 'the boulevard');
  assert.ok(length('23') > 40, `23: ${length('23').toFixed(0)}`);
  for (const b of borders) for (const gap of b.gaps) assert.ok(Math.abs(gap - L.BORDER_GAP) < 1e-9, `a gap of ${gap} between the blocks`);
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
