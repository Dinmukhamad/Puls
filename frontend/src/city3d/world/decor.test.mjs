import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ stdin: { contents: `export * from './decor.ts'; export * from './land.ts'; export * from './cities.ts'; export { generateSalesWorld } from './sales.ts'; export { WORLD_X4 } from './worldSpec.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const D = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

const GRIDS = { support: D.landGrid(D.islandWorld(D.WORLD_X4)), sales: D.landGrid(D.generateSalesWorld()) };
/**
 * A piece of district 1's land to lay things out on: a block and a window of it, 22 × 12 cells all for sale (the island
 * city's blocks are rectangles round their bands' cells). `C` and `R` give a column and a row of the block from the
 * window's first.
 */
const windowOf = grid => {
  for (const block of grid.blocks.filter(b => b.district === 1)) {
    // How many cells are kept from sale before each (col, row): a window is free when it holds none.
    const kept = Array.from({ length: block.cols + 1 }, () => new Int32Array(block.rows + 1));
    for (let c = 0; c < block.cols; c++) for (let r = 0; r < block.rows; r++) kept[c + 1][r + 1] = kept[c][r + 1] + kept[c + 1][r] - kept[c][r] + (block.skip.has(`${c}:${r}`) ? 1 : 0);
    for (let c0 = 0; c0 + 22 <= block.cols; c0++) for (let r0 = 0; r0 + 12 <= block.rows; r0++) {
      if (kept[c0 + 22][r0 + 12] - kept[c0][r0 + 12] - kept[c0 + 22][r0] + kept[c0][r0] === 0) return { block, b: block.block, C: c => c0 + c, R: r => r0 + r };
    }
  }
  throw new Error('no free window');
};
/** A map of small things: [family, block, col, row, mine?] each. */
const mapOf = (district, items) => D.decorMap([{ number: district, decor: items.reduce((all, [family, block, col, row, mine = 1]) => ((all[family] ??= []).push([block, col, row, mine]), all), {}) }]);
const near = (p, q, d = 1e-9) => Math.hypot(p.x - q.x, p.z - q.z) < d;
const middleOf = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
const ASPHALT = '#6d7385', PAVEMENT = '#ddd6c4', MARK = '#f7f3e8', FOOTPATH = '#d7ccb6';

test('the server\'s lists become one map of the city\'s small things, whose own are marked', () => {
  const map = D.decorMap([{ number: 1, decor: { road: [[3, 1, 2, 1], [3, 2, 2, 0]], tree: [[4, 5, 6, 1]] } }, { number: 2, decor: { lamp: [[3, 1, 2, 0]] } }, { number: 3 }]);
  assert.deepEqual([...map], [['1:3:1:2', { family: 'road', mine: true }], ['1:3:2:2', { family: 'road', mine: false }], ['1:4:5:6', { family: 'tree', mine: true }], ['2:3:1:2', { family: 'lamp', mine: false }]]);
  assert.equal(D.decorKey(2, 3, 1, 2), '2:3:1:2');
});

test('a road joins the roads beside it: an arm out to each, meeting the next one\'s at their shared edge, a lane mark down a straight piece', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    const { block, b, C, R } = windowOf(grid);
    // A street along a row with a turn off it: a dead end, a straight piece, a junction of three, a corner.
    const cells = [[4, 5], [5, 5], [6, 5], [7, 5], [6, 6], [6, 7], [7, 7]].map(([c, r]) => [C(c), R(r)]);
    const map = mapOf(1, cells.map(([c, r]) => ['road', b, c, r])), layout = D.decorLayout(grid, map);
    const of = colour => layout.ground.filter(q => q.colour === colour);
    // A pavement under each road cell, its asphalt square in the middle and an arm for each road it joins.
    const links = cells.map(([c, r]) => D.joins(grid, map, block, c, r, 'road'));
    assert.deepEqual(links.map(l => l.map(x => x.way).sort()), [['col+'], ['col+', 'col-'], ['col+', 'col-', 'row+'], ['col-'], ['row+', 'row-'], ['col+', 'row-'], ['col-']], city);
    assert.equal(of(PAVEMENT).length, cells.length);
    assert.equal(of(ASPHALT).length, cells.length + links.flat().length);
    // A lane mark only on the straight pieces: (5, 5) along the row and (6, 6) across it.
    assert.equal(of(MARK).length, 2);
    for (const mark of of(MARK)) {
      const at = D.cellAt(grid, middleOf(mark.points[0], mark.points[2]));
      assert.ok([[5, 5], [6, 6]].some(([c, r]) => at.col === C(c) && at.row === R(r)), `${city}: a lane mark on ${at.col}:${at.row}`);
    }
    // Every arm ends on its cell's edge at the meeting point, as wide as the asphalt; the next cell's arm ends there too.
    for (const [i, [c, r]] of cells.entries()) for (const { to } of links[i]) {
      const ends = of(ASPHALT).filter(q => near(middleOf(q.points[2], q.points[3]), to.meet, 1e-6));
      assert.equal(ends.length, 2, `${city}: ${c}:${r} → ${to.col}:${to.row}, ${ends.length} arms meet`);
      for (const arm of ends) assert.ok(Math.abs(Math.hypot(arm.points[2].x - arm.points[3].x, arm.points[2].z - arm.points[3].z) - 2.1) < 1e-6, 'an arm as wide as the road');
    }
    // Layered: the pavement over the grass, the asphalt over it, the marks on top.
    assert.ok(of(PAVEMENT)[0].y < of(ASPHALT)[0].y && of(ASPHALT)[0].y < of(MARK)[0].y && of(PAVEMENT)[0].y > .2);
    assert.deepEqual(D.decorLayout(grid, map), layout, 'the same map lays out the same');
    assert.deepEqual([layout.placements.length, layout.lamps.length], [0, 0]);
  }
});

test('a road two or three cells wide is one piece of asphalt, with the pavement along its edges only', () => {
  /** Is a point under a quad of this colour (corners in order, convex)? */
  const under = (ground, colour, p) => ground.some(q => q.colour === colour && q.points.every((a, i) => { const b = q.points[(i + 1) % 4]; return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) >= -1e-9; }) || (q.colour === colour && q.points.every((a, i) => { const b = q.points[(i + 1) % 4]; return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) <= 1e-9; })));
  for (const [city, grid] of Object.entries(GRIDS)) {
    const { block, b, C, R } = windowOf(grid);
    // Two rows of five: where four of its cells meet the asphalt runs through; on the outer edge the pavement stays.
    const wide = D.decorLayout(grid, mapOf(1, [5, 5].flatMap((_, k) => [4, 5, 6, 7, 8].map(c => ['road', b, C(c), R(5 + k)]))));
    const meet = D.areaPoint(D.areaCorners(block, C(6), R(6)), .02, .02), edge = D.areaPoint(D.areaCorners(block, C(6), R(5)), .02, .02);
    assert.ok(under(wide.ground, ASPHALT, meet), `${city}: asphalt where four cells meet`);
    assert.ok(!under(wide.ground, ASPHALT, edge), `${city}: the pavement along the outer edge`);
    // A single road turning a corner keeps its pavement inside the turn, as before.
    const bend = D.decorLayout(grid, mapOf(1, [['road', b, C(4), R(5)], ['road', b, C(5), R(5)], ['road', b, C(5), R(6)]]));
    assert.ok(!under(bend.ground, ASPHALT, D.areaPoint(D.areaCorners(block, C(5), R(5)), .02, .98)), `${city}: the pavement inside a turn`);
  }
});

test('a road three cells wide has a lane to each row: dashes between them, edge lines, kerbs and zebras at its ends', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    const { block, b, C, R } = windowOf(grid);
    const cells = [];
    for (let c = 4; c < 12; c++) for (let r = 5; r < 8; r++) cells.push(['road', b, C(c), R(r)]);
    const layout = D.decorLayout(grid, mapOf(1, cells)), marks = layout.ground.filter(q => q.colour === MARK);
    const middle = q => ({ x: q.points.reduce((s, p) => s + p.x, 0) / 4, z: q.points.reduce((s, p) => s + p.z, 0) / 4 });
    // Dashes on the two edges between the three lanes, one to a cell.
    for (const r of [5, 6]) {
      const dashes = marks.filter(q => [...Array(8).keys()].some(k => { const corners = D.areaCorners(block, C(4 + k), R(r)); return near(middle(q), D.areaPoint(corners, .45, 1), 1e-6); }));
      assert.equal(dashes.length, 8, `${city}: a dash in every cell between rows ${r} and ${r + 1}`);
    }
    // A solid line along either outer edge, a cell long each; zebra bars across both ends.
    const inRow = (q, r) => { const at = D.cellAt(grid, middle(q)); return at && at.row === R(r); };
    assert.ok(marks.filter(q => inRow(q, 5)).length >= 8 && marks.filter(q => inRow(q, 7)).length >= 8, `${city}: edge lines`);
    const ends = c => marks.filter(q => { const at = D.cellAt(grid, middle(q)); return at && at.col === C(c); }).length;
    assert.ok(ends(4) >= 3 * 3 && ends(11) >= 3 * 3, `${city}: a zebra crossing at each end`);
    assert.ok(layout.ground.some(q => q.colour === '#c4bfb2'), 'a kerb along the asphalt');
    // A road a cell wide keeps its plain lane mark.
    const single = D.decorLayout(grid, mapOf(1, [4, 5, 6].map(c => ['road', b, C(c), R(5)])));
    assert.equal(single.ground.filter(q => q.colour === MARK).length, 1);
  }
});

test('a footpath three cells wide is a paved square: tile joints, a border, benches by its edges and planters down the middle', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    const { b, C, R } = windowOf(grid);
    const cells = [];
    for (let c = 4; c < 13; c++) for (let r = 5; r < 8; r++) cells.push(['path', b, C(c), R(r)]);
    const layout = D.decorLayout(grid, mapOf(1, cells)), at = p => D.cellAt(grid, p);
    assert.ok(layout.ground.filter(q => q.colour === '#c9bda5').length >= cells.length * 4, `${city}: tile joints a unit apart`);
    assert.ok(layout.ground.some(q => q.colour === '#baac90'), `${city}: a border`);
    const benches = layout.placements.filter(p => p.kind === 'bench').map(at), planters = layout.placements.filter(p => p.kind === 'planter').map(at);
    assert.deepEqual(benches.map(x => x.row).sort(), [R(5), R(5), R(5), R(7), R(7), R(7)].sort(), `${city}: benches by the outer edges, every third cell`);
    assert.ok(planters.length >= 2 && planters.every(x => x.row === R(6)), `${city}: planters down the middle`);
    // Two cells wide: joints and border, no planters.
    const two = D.decorLayout(grid, mapOf(1, cells.filter(([, , , r]) => r !== R(7))));
    assert.equal(two.placements.filter(p => p.kind === 'planter').length, 0);
  }
});

test('a road keeps on across the seam between two bands of the island city', () => {
  const grid = GRIDS.support, inner = grid.blocks.find(b => b.district === 1 && b.band === 3), outer = grid.blocks.find(b => b.district === 1 && b.band === 4);
  const opposite = { 'row-': 'row+', 'row+': 'row-', 'col-': 'col+', 'col+': 'col-' };
  // The cells of the third band whose square beside them is the fourth band's: on both of its ways out, along x and z.
  const seam = [];
  for (let col = 0; col < inner.cols; col++) for (let row = 0; row < inner.rows; row++) {
    if (inner.skip.has(`${col}:${row}`)) continue;
    for (const way of D.WAYS) for (const n of D.neighbours(grid, inner, col, row, way)) if (n.block === outer) seam.push({ col, row, way, n });
  }
  assert.ok(seam.length > 100, `${seam.length} cells on the seam`);
  // It steps along x and along z, always outwards: the next band's square lies farther from the middle of the city.
  assert.ok(seam.some(s => s.way.startsWith('col')) && seam.some(s => s.way.startsWith('row')), 'the seam steps along x and z');
  for (const { col, row, n } of seam) {
    const here = D.cellCentre(inner, col, row), there = D.cellCentre(outer, n.col, n.row);
    assert.ok(Math.hypot(there.x, there.z) > Math.hypot(here.x, here.z), `${col}:${row} → ${n.col}:${n.row} turns inwards`);
  }
  for (const { col, row, way, n } of seam.filter((_, i) => i % 9 === 0)) {
    assert.ok(!n.block.skip.has(`${n.col}:${n.row}`) && n.from === 0 && n.to === 1, 'a whole edge, for sale');
    const map = mapOf(1, [['road', inner.block, col, row], ['road', outer.block, n.col, n.row]]);
    const back = D.joins(grid, map, outer, n.col, n.row, 'road');
    assert.deepEqual(back.map(l => [l.way, l.to.block.block, l.to.col, l.to.row]), [[opposite[way], inner.block, col, row]]);
    // The two arms end at one point, the middle of the edge the two squares share.
    const ends = D.decorLayout(grid, map).ground.filter(q => q.colour === ASPHALT && q.points.length === 4).map(q => middleOf(q.points[2], q.points[3]));
    assert.ok(near(back[0].to.meet, n.meet, 1e-6), 'both sides find the same meeting point');
    assert.equal(ends.filter(p => near(p, n.meet, 1e-6)).length, 2);
  }
});

test('a footpath meets roads and other paths, a hedge closes with hedges, a road ignores both', () => {
  for (const grid of Object.values(GRIDS)) {
    const { block, b, C, R } = windowOf(grid), cell = ([family, c, r]) => [family, b, C(c), R(r)];
    const map = mapOf(1, [['road', 10, 4], ['path', 10, 5], ['path', 10, 6], ['hedge', 11, 6], ['hedge', 12, 6], ['hedge', 13, 6], ['hedge', 20, 9]].map(cell));
    assert.deepEqual(D.joins(grid, map, block, C(10), R(4), 'road'), [], 'a road does not run into a footpath');
    assert.deepEqual(D.joins(grid, map, block, C(10), R(5), 'path').map(l => l.way).sort(), ['row+', 'row-']);
    assert.deepEqual(D.joins(grid, map, block, C(10), R(6), 'path').map(l => l.way), ['row-'], 'a path does not run into a hedge');
    assert.deepEqual(D.joins(grid, map, block, C(12), R(6), 'hedge').map(l => l.way).sort(), ['col+', 'col-']);
    const layout = D.decorLayout(grid, map), hedges = layout.placements.filter(p => p.kind === 'hedge');
    assert.equal(layout.ground.filter(q => q.colour === FOOTPATH).length, 2 + 3, 'two path squares and three arms');
    // Clipped pieces from each hedge's middle out to its neighbours, a short run across a hedge on its own.
    const on = (c, r) => hedges.filter(p => { const at = D.cellAt(grid, p); return at && at.col === C(c) && at.row === R(r); }).length;
    assert.ok(on(11, 6) >= 1 && on(12, 6) >= 2 && on(13, 6) >= 1 && on(20, 9) >= 1, `hedge pieces ${[on(11, 6), on(12, 6), on(13, 6), on(20, 9)]}`);
    assert.ok(hedges.every(p => p.kind === 'hedge' && Number.isFinite(p.rotation)));
  }
});

test('an alley is a gravel path with trees where nothing it joins lies beside it; it joins alleys, footpaths and roads', () => {
  const GRAVEL = '#cbb994';
  for (const [city, grid] of Object.entries(GRIDS)) {
    const { block, b, C, R } = windowOf(grid), cell = ([family, c, r]) => [family, b, C(c), R(r)];
    // Down a column from a road into a footpath; a line along a row turning a corner; one on its own; one two cells wide.
    const alleys = [[4, 3], [4, 4], [4, 5], [8, 5], [9, 5], [9, 6], [15, 9], [12, 1], [13, 1], [14, 1], [12, 2], [13, 2], [14, 2]];
    const map = mapOf(1, [['road', 4, 2], ...alleys.map(([c, r]) => ['alley', c, r]), ['path', 4, 6], ['lamp', 5, 4]].map(cell));
    assert.deepEqual(D.joins(grid, map, block, C(4), R(3), 'alley').map(l => l.way).sort(), ['row+', 'row-'], `${city}: it runs into the road`);
    assert.deepEqual(D.joins(grid, map, block, C(4), R(6), 'path').map(l => l.way), ['row-'], 'a footpath runs into an alley');
    assert.deepEqual(D.joins(grid, map, block, C(4), R(2), 'road').map(l => l.way), [], 'a road does not run into an alley');
    const layout = D.decorLayout(grid, map), at = p => D.cellAt(grid, p);
    const trees = (c, r) => layout.placements.filter(p => { const x = at(p); return p.kind === 'tree-round' && x && x.col === C(c) && x.row === R(r); });
    // Along a line: one tree on either side of the path, across the middle of the cell.
    for (const r of [3, 4, 5]) {
      const pair = trees(4, r), corners = D.areaCorners(block, C(4), R(r)), middle = D.areaPoint(corners, .5, .5);
      assert.equal(pair.length, 2, `${city}: two trees on 4:${r}`);
      assert.ok(pair.every(p => Math.hypot(p.x - middle.x, p.z - middle.z) > .55), `${city}: off the path`);
      assert.ok(near(middleOf(pair[0], pair[1]), middle, 1e-6), 'on either side of the middle');
    }
    // A corner has its trees on the two sides it does not turn to; the end of a line and one on its own run straight.
    assert.deepEqual([trees(9, 5).length, trees(8, 5).length, trees(15, 9).length], [2, 2, 2]);
    // Two cells wide it is a boulevard: its outer rows of trees as on a line, a row between its two walks but where a
    // path crosses (the second cell), and a bench by either outer edge at the third.
    const between = [12, 13, 14].map(c => D.areaPoint(D.areaCorners(block, C(c), R(1)), .5, 1));
    const on = p => layout.placements.some(q => q.kind === 'tree-round' && near(q, p, 1e-6));
    assert.deepEqual(between.map(on), [true, false, true], `${city}: trees between the walks`);
    const outer = (c, r) => trees(c, r).filter(p => !between.some(b => near(p, b, 1e-6))).length;
    assert.deepEqual([[12, 1], [13, 1], [14, 1], [12, 2], [13, 2], [14, 2]].map(([c, r]) => outer(c, r)), [2, 1, 2, 2, 1, 2]);
    assert.deepEqual(layout.placements.filter(p => p.kind === 'bench').map(p => at(p)).map(x => [x.col - C(0), x.row - R(0)]).sort(), [[14, 1], [14, 2]]);
    // Its gravel: a square in each cell and an arm to each neighbour it joins, across the boulevard only where it crosses.
    const arms = alleys.reduce((n, [c, r]) => n + D.joins(grid, map, block, C(c), R(r), 'alley').length, 0);
    assert.ok(layout.ground.filter(q => q.colour === GRAVEL).length >= alleys.length + arms - 4);
    // The lamp beside it stands at its edge, toward it.
    const lamp = layout.lamps[0], centre = D.areaPoint(D.areaCorners(block, C(5), R(4)), .5, .5);
    assert.deepEqual([at(lamp).col, at(lamp).row], [C(5), R(4)]);
    assert.ok(Math.hypot(lamp.x - centre.x, lamp.z - centre.z) > .5, 'the lamp stands toward the alley');
  }
});

test('trees, bushes and flowerbeds stand in their own cells; a lamp by its road lights, a bench faces the road', () => {
  for (const grid of Object.values(GRIDS)) {
    const { block, b, C, R } = windowOf(grid);
    const things = [['tree', 2, 2, 'tree-round'], ['pine', 3, 2, 'tree-cone'], ['birch', 4, 2, 'tree-birch'], ['oak', 5, 2, 'tree-oak'], ['bush', 6, 2, 'bush'], ['flowers', 7, 2, 'flowerbed']];
    const map = mapOf(1, [...things.map(([family, c, r]) => [family, b, c, r]), ['road', b, 10, 8], ['road', b, 11, 8], ['lamp', b, 10, 9], ['bench', b, 11, 9], ['lamp', b, 20, 9], ['bench', b, 21, 9]].map(([family, , c, r]) => [family, b, C(c), R(r)]));
    const layout = D.decorLayout(grid, map), at = p => D.cellAt(grid, p);
    for (const [family, c, r, kind] of things) {
      const mine = layout.placements.filter(p => { const cell = at(p); return cell && cell.col === C(c) && cell.row === R(r); });
      assert.deepEqual(mine.map(p => p.kind), [kind], `${family} on ${c}:${r}`);
    }
    // The lamp by the road stands at the road's edge of its cell, the one with no road in the middle.
    const lamps = layout.placements.filter(p => p.kind === 'lamp');
    assert.equal(lamps.length, 2); assert.deepEqual(layout.lamps, lamps);
    const roadside = lamps.find(p => at(p).col === C(10)), alone = lamps.find(p => at(p).col === C(20));
    const centre = D.cellCentre(block, C(10), R(9)), meet = D.neighbours(grid, block, C(10), R(9), 'row-')[0].meet;
    assert.ok(Math.hypot(roadside.x - meet.x, roadside.z - meet.z) < Math.hypot(centre.x - meet.x, centre.z - meet.z) - .8, 'the lamp stands by the road');
    assert.ok(near(alone, D.cellCentre(block, C(20), R(9)), 1e-9), 'a lamp with no road beside it stands in the middle');
    // The bench by the road looks at it.
    const bench = layout.placements.find(p => p.kind === 'bench' && at(p).col === C(11)), to = D.neighbours(grid, block, C(11), R(9), 'row-')[0].meet;
    const look = { x: Math.sin(bench.rotation), z: Math.cos(bench.rotation) }, dx = to.x - bench.x, dz = to.z - bench.z;
    assert.ok((look.x * dx + look.z * dz) / Math.hypot(dx, dz) > .99, 'the bench faces the road');
  }
});

test('a building turns its front to the road beside it, to the most of it, else where its owner turned it', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    const { block, b, C, R } = windowOf(grid), col = C(10), row = R(5);
    const home = D.homeSide(block, col, row, 3, 3), empty = D.decorMap([]);
    for (const rotation of [0, 1, 2, 3]) assert.deepEqual(D.buildingFacing(grid, empty, block, col, row, 3, 3, rotation), { side: D.turnedSide(block, home, rotation), street: false }, `${city}: turned ${rotation}`);
    // A road along the plot's edge, a cell or the whole edge of it: the front looks there, however it was turned.
    const before = D.sideOf(block, 'row-'), after = D.sideOf(block, 'col+');
    const rowRoad = [0, 1, 2].map(i => ['road', b, col + i, row - 1]), colRoad = [0, 1].map(i => ['road', b, col + 3, row + i]);
    for (const rotation of [0, 1, 2, 3]) {
      assert.deepEqual(D.buildingFacing(grid, mapOf(1, rowRoad), block, col, row, 3, 3, rotation), { side: before, street: true });
      assert.deepEqual(D.buildingFacing(grid, mapOf(1, colRoad.slice(0, 1)), block, col, row, 3, 3, rotation), { side: after, street: true });
      // Roads on two sides: the longer stretch wins.
      assert.deepEqual(D.buildingFacing(grid, mapOf(1, [...rowRoad, ...colRoad]), block, col, row, 3, 3, rotation).side, before);
    }
    // As many on both: the side its owner turned it to, if it is one of them.
    const both = mapOf(1, [...rowRoad.slice(0, 2), ...colRoad]);
    const turnTo = side => [0, 1, 2, 3].find(k => D.turnedSide(block, home, k) === side);
    assert.equal(D.buildingFacing(grid, both, block, col, row, 3, 3, turnTo(after)).side, after);
    assert.equal(D.buildingFacing(grid, both, block, col, row, 3, 3, turnTo(before)).side, before);
    // A footpath counts as a way in; a tree or a hedge does not.
    assert.equal(D.buildingFacing(grid, mapOf(1, [['path', b, col + 1, row + 3]]), block, col, row, 3, 3, 0).side, D.sideOf(block, 'row+'));
    assert.equal(D.buildingFacing(grid, mapOf(1, [['tree', b, col + 1, row + 3], ['hedge', b, col - 1, row]]), block, col, row, 3, 3, 0).street, false);
  }
});
