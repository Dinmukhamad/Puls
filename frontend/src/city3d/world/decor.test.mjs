import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ stdin: { contents: `export * from './decor.ts'; export * from './land.ts'; export * from './cities.ts'; export { generateSalesWorld } from './sales.ts'; export { WORLD_X4 } from './worldSpec.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const D = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

const GRIDS = { support: D.landGrid(D.islandWorld(D.WORLD_X4)), sales: D.landGrid(D.generateSalesWorld()) };
/** A district's block with no cell kept from sale, big enough to lay things out on. */
const blockOf = grid => grid.blocks.find(b => b.district === 1 && b.skip.size === 0 && b.cols >= 22 && b.rows >= 12);
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
    const block = blockOf(grid), b = block.block;
    // A street along a row with a turn off it: a dead end, a straight piece, a junction of three, a corner.
    const cells = [[4, 5], [5, 5], [6, 5], [7, 5], [6, 6], [6, 7], [7, 7]];
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
      assert.ok([[5, 5], [6, 6]].some(([c, r]) => at.col === c && at.row === r), `${city}: a lane mark on ${at.col}:${at.row}`);
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
    const block = blockOf(grid), b = block.block;
    // Two rows of five: where four of its cells meet the asphalt runs through; on the outer edge the pavement stays.
    const wide = D.decorLayout(grid, mapOf(1, [5, 5].flatMap((_, k) => [4, 5, 6, 7, 8].map(c => ['road', b, c, 5 + k]))));
    const meet = D.areaPoint(D.areaCorners(block, 6, 6), .02, .02), edge = D.areaPoint(D.areaCorners(block, 6, 5), .02, .02);
    assert.ok(under(wide.ground, ASPHALT, meet), `${city}: asphalt where four cells meet`);
    assert.ok(!under(wide.ground, ASPHALT, edge), `${city}: the pavement along the outer edge`);
    // A single road turning a corner keeps its pavement inside the turn, as before.
    const bend = D.decorLayout(grid, mapOf(1, [['road', b, 4, 5], ['road', b, 5, 5], ['road', b, 5, 6]]));
    assert.ok(!under(bend.ground, ASPHALT, D.areaPoint(D.areaCorners(block, 5, 5), .02, .98)), `${city}: the pavement inside a turn`);
  }
});

test('a road keeps on across the seam between two bands of the island city', () => {
  const grid = GRIDS.support, inner = grid.blocks.find(b => b.district === 1 && b.band === 3), outer = grid.blocks.find(b => b.district === 1 && b.band === 4);
  const col = 40, next = D.neighbours(grid, inner, col, inner.rows - 1, 'row+');
  assert.ok(next.length >= 1 && next.every(n => n.block === outer && n.row === 0), 'the next band\'s first row is right past the last row');
  const there = next[0], map = mapOf(1, [['road', inner.block, col, inner.rows - 1], ['road', outer.block, there.col, 0]]);
  const back = D.joins(grid, map, outer, there.col, 0, 'road');
  assert.deepEqual(back.map(l => [l.way, l.to.block.block, l.to.col, l.to.row]), [['row-', inner.block, col, inner.rows - 1]]);
  // The two arms end at one point, the middle of where the two cells' edges overlap.
  const ends = D.decorLayout(grid, map).ground.filter(q => q.colour === ASPHALT && q.points.length === 4).map(q => middleOf(q.points[2], q.points[3]));
  assert.ok(near(back[0].to.meet, there.meet, 1e-6), 'both sides find the same meeting point');
  assert.equal(ends.filter(p => near(p, there.meet, 1e-6)).length, 2);
});

test('a footpath meets roads and other paths, a hedge closes with hedges, a road ignores both', () => {
  for (const grid of Object.values(GRIDS)) {
    const block = blockOf(grid), b = block.block;
    const map = mapOf(1, [['road', b, 10, 4], ['path', b, 10, 5], ['path', b, 10, 6], ['hedge', b, 11, 6], ['hedge', b, 12, 6], ['hedge', b, 13, 6], ['hedge', b, 20, 9]]);
    assert.deepEqual(D.joins(grid, map, block, 10, 4, 'road'), [], 'a road does not run into a footpath');
    assert.deepEqual(D.joins(grid, map, block, 10, 5, 'path').map(l => l.way).sort(), ['row+', 'row-']);
    assert.deepEqual(D.joins(grid, map, block, 10, 6, 'path').map(l => l.way), ['row-'], 'a path does not run into a hedge');
    assert.deepEqual(D.joins(grid, map, block, 12, 6, 'hedge').map(l => l.way).sort(), ['col+', 'col-']);
    const layout = D.decorLayout(grid, map), hedges = layout.placements.filter(p => p.kind === 'hedge');
    assert.equal(layout.ground.filter(q => q.colour === FOOTPATH).length, 2 + 3, 'two path squares and three arms');
    // Clipped pieces from each hedge's middle out to its neighbours, a short run across a hedge on its own.
    const on = (c, r) => hedges.filter(p => { const at = D.cellAt(grid, p); return at && at.col === c && at.row === r; }).length;
    assert.ok(on(11, 6) >= 1 && on(12, 6) >= 2 && on(13, 6) >= 1 && on(20, 9) >= 1, `hedge pieces ${[on(11, 6), on(12, 6), on(13, 6), on(20, 9)]}`);
    assert.ok(hedges.every(p => p.kind === 'hedge' && Number.isFinite(p.rotation)));
  }
});

test('trees, bushes and flowerbeds stand in their own cells; a lamp by its road lights, a bench faces the road', () => {
  for (const grid of Object.values(GRIDS)) {
    const block = blockOf(grid), b = block.block;
    const things = [['tree', 2, 2, 'tree-round'], ['pine', 3, 2, 'tree-cone'], ['birch', 4, 2, 'tree-birch'], ['oak', 5, 2, 'tree-oak'], ['bush', 6, 2, 'bush'], ['flowers', 7, 2, 'flowerbed']];
    const map = mapOf(1, [...things.map(([family, c, r]) => [family, b, c, r]), ['road', b, 10, 8], ['road', b, 11, 8], ['lamp', b, 10, 9], ['bench', b, 11, 9], ['lamp', b, 20, 9], ['bench', b, 21, 9]]);
    const layout = D.decorLayout(grid, map), at = p => D.cellAt(grid, p);
    for (const [family, c, r, kind] of things) {
      const mine = layout.placements.filter(p => { const cell = at(p); return cell && cell.col === c && cell.row === r; });
      assert.deepEqual(mine.map(p => p.kind), [kind], `${family} on ${c}:${r}`);
    }
    // The lamp by the road stands at the road's edge of its cell, the one with no road in the middle.
    const lamps = layout.placements.filter(p => p.kind === 'lamp');
    assert.equal(lamps.length, 2); assert.deepEqual(layout.lamps, lamps);
    const roadside = lamps.find(p => at(p).col === 10), alone = lamps.find(p => at(p).col === 20);
    const centre = D.cellCentre(block, 10, 9), meet = D.neighbours(grid, block, 10, 9, 'row-')[0].meet;
    assert.ok(Math.hypot(roadside.x - meet.x, roadside.z - meet.z) < Math.hypot(centre.x - meet.x, centre.z - meet.z) - .8, 'the lamp stands by the road');
    assert.ok(near(alone, D.cellCentre(block, 20, 9), 1e-9), 'a lamp with no road beside it stands in the middle');
    // The bench by the road looks at it.
    const bench = layout.placements.find(p => p.kind === 'bench' && at(p).col === 11), to = D.neighbours(grid, block, 11, 9, 'row-')[0].meet;
    const look = { x: Math.sin(bench.rotation), z: Math.cos(bench.rotation) }, dx = to.x - bench.x, dz = to.z - bench.z;
    assert.ok((look.x * dx + look.z * dz) / Math.hypot(dx, dz) > .99, 'the bench faces the road');
  }
});

test('a building turns its front to the road beside it, to the most of it, else where its owner turned it', () => {
  for (const [city, grid] of Object.entries(GRIDS)) {
    const block = blockOf(grid), b = block.block, col = 10, row = 5;
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
