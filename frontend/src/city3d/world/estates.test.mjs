import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: `export * from './estates.ts'; export * from './land.ts'; export * from './landLayouts.ts'; export * from './cities.ts'; export { generateSalesWorld } from './sales.ts'; export { WORLD_X4 } from './worldSpec.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const E = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const server = readFileSync(new URL('../../../../app/services/city_estate.py', import.meta.url), 'utf8');
const GRIDS = { support: E.landGrid(E.islandWorld(E.WORLD_X4)), sales: E.landGrid(E.generateSalesWorld()) };

/** The server's catalogue by family: footprint and how many levels (city_estate.py PLOT_FAMILIES, PROJECT_FAMILIES). */
function catalogue(name) {
  const text = server.slice(server.indexOf(`${name} = {`), server.indexOf('\n}\n', server.indexOf(`${name} = {`)));
  return Object.fromEntries(text.split(/\n {4}"(?=\w+": \{)/).slice(1).map(block => {
    const family = block.match(/^(\w+)"/)[1], size = block.match(/"size": \((\d), (\d)\)/);
    return [family, { size: [Number(size[1]), Number(size[2])], levels: (block.slice(block.indexOf('"levels": [')).match(/\(\s*"/g) ?? []).length }];
  }));
}

test('the catalogue matches the server: what stands on plots, what stands on the square, the land of every band', () => {
  const plots = catalogue('PLOT_FAMILIES'), projects = catalogue('PROJECT_FAMILIES');
  assert.deepEqual(Object.fromEntries(Object.entries(plots).map(([k, v]) => [k, v.size])), E.PLOT_SIZE);
  assert.deepEqual(Object.fromEntries(Object.entries(plots).map(([k, v]) => [k, v.levels])), E.PLOT_LEVELS);
  assert.deepEqual(Object.fromEntries(Object.entries(projects).map(([k, v]) => [k, v.size])), E.PROJECT_SIZE);
  assert.deepEqual(Object.fromEntries(Object.entries(projects).map(([k, v]) => [k, v.levels])), E.PROJECT_LEVELS);
  assert.match(server, /"park": \{\n {8}"name": "Парк",\n {8}"icon": "[^"]+",\n {8}"size": \(2, 2\),\n {8}"squares": 4,/);
  assert.match(server, /"bigpark": \{\n {8}"name": "Большой парк",\n {8}"icon": "[^"]+",\n {8}"size": \(3, 2\),\n {8}"squares": 6,/);
  assert.deepEqual(E.PARK_SQUARES, { park: 4, bigpark: 6 });
  // A price for the land of every band of the island city; the lake city uses the first three.
  const land = server.match(/^LAND_PRICES = \[([^\]]*)\]/m)[1].split(',').map(Number);
  assert.equal(land.length, GRIDS.support.bands);
  assert.ok(GRIDS.sales.bands <= land.length);
  assert.match(server, /^SQUARE, MODULE_CELLS = 0, 12$/m);
  assert.equal(E.MODULE_CELLS, 12);
  assert.deepEqual([1, 2, 3, 4].map(E.preparedLand), [true, true, true, false]);
});

const KNOWN = new Set(['tree-round', 'tree-oak', 'tree-birch', 'tree-cone', 'bench', 'flowerbed', 'bush', 'hedge', 'lamp', 'cottage', 'roof', 'planter', 'fountain', 'gazebo', 'slide', 'swings', 'sandbox']);
/** Within a frame: in its own axes, inside its width and depth with `pad` to spare (negative: that far inside). */
const within = (p, f, pad) => {
  const s = Math.sin(f.rotation), c = Math.cos(f.rotation), dx = p.x - f.x, dz = p.z - f.z;
  return Math.abs(dx * c - dz * s) <= f.width / 2 + pad && Math.abs(dx * s + dz * c) <= f.depth / 2 + pad;
};
/** Plots of every kind of block: a narrow one by the centre of the island city, a wide one at its edge, the lake city's. */
function samples() {
  const out = [];
  for (const grid of Object.values(GRIDS)) for (const band of [1, grid.bands]) {
    const block = grid.blocks.find(b => b.band === band && b.cols >= 3 && b.rows >= 3) ?? grid.blocks.find(b => b.band === band && b.cols >= 3 && b.rows >= 2) ?? grid.blocks.find(b => b.band === band);
    if (block) out.push(block);
  }
  return out;
}

test('everything on a plot at every level stands inside its plots and uses known models', () => {
  for (const block of samples()) for (const [family, levels] of Object.entries(E.PLOT_LEVELS)) for (let level = 1; level <= levels; level++) for (const rotation of family === 'bigpark' ? [0, 1] : [0]) {
    const [w, h] = E.plotFootprint(family, rotation);
    if (w > block.cols || h > block.rows) continue;
    const frame = E.areaFrame(block, 0, 0, w, h);
    for (const seed of [1, 7, 23, 404]) {
      const { placements, surfaces } = E.plotLayout(frame, family, level, seed);
      assert.ok(placements.length >= 4 && surfaces.length >= 1, `${family} ${level} has pieces`);
      for (const p of placements) {
        assert.ok(KNOWN.has(p.kind), `${p.kind} is a model`);
        assert.ok(within(p, frame, -.15), `${family} ${level} ${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} inside its plots`);
      }
      for (const s of surfaces) {
        const half = s.round ? s.length / 2 : 0;
        assert.ok(within(s, frame, -half + .01), `${family} ${level} ${s.kind} patch inside`);
        if (!s.round) assert.ok(s.length <= (Math.abs(Math.sin(s.angle - frame.rotation)) > .5 ? frame.width : frame.depth) + .01 && s.width <= (Math.abs(Math.sin(s.angle - frame.rotation)) > .5 ? frame.depth : frame.width) + .01, `${family} ${level} ${s.kind} patch fits`);
      }
      // Houses and their garages stay clear of the edge, so neighbouring houses never touch.
      for (const p of placements.filter(p => p.kind === 'cottage')) {
        const s = Math.sin(frame.rotation), c = Math.cos(frame.rotation), dx = p.x - frame.x, dz = p.z - frame.z;
        assert.ok(Math.abs(dx * c - dz * s) + p.width / 2 < frame.width / 2 - .2 && Math.abs(dx * s + dz * c) + p.depth / 2 < frame.depth / 2 - .2, `${family} ${level} a house off its plot's edge`);
      }
    }
  }
});

test('a house grows at every stage: one storey, two, a wing, a garage, a three-storey mansion', () => {
  const block = GRIDS.support.blocks.find(b => b.band === 3), frame = E.areaFrame(block, 2, 2);
  const stages = [1, 2, 3, 4, 5].map(level => E.plotLayout(frame, 'house', level, 11).placements);
  const storeys = list => Math.max(...list.filter(p => p.kind === 'cottage').map(p => p.variant + 1));
  assert.deepEqual(stages.map(storeys), [1, 2, 2, 2, 3]);
  stages.slice(1).forEach((list, i) => assert.notDeepEqual(list.map(p => p.kind).sort(), stages[i].map(p => p.kind).sort(), `stage ${i + 2} differs from stage ${i + 1}`));
  assert.ok(stages[4].length > stages[0].length * 2, 'the mansion has far more than the first house');
  assert.ok(stages[2].filter(p => p.kind === 'cottage').length === 2, 'a wing at the third stage');
  assert.ok(stages[3].some(p => p.kind === 'cottage' && p.tint === 8), 'a garage at the fourth stage');
  assert.ok(stages[4].some(p => p.kind === 'fountain') && stages[4].some(p => p.kind === 'lamp'), 'a fountain and lamps at the last');
  // The same house looks the same every time; another one differs.
  assert.deepEqual(E.plotLayout(frame, 'house', 3, 11), E.plotLayout(frame, 'house', 3, 11));
  assert.notDeepEqual(E.plotLayout(frame, 'house', 3, 11).placements.map(p => p.tint), E.plotLayout(frame, 'house', 3, 12).placements.map(p => p.tint));
  // Parks gather more: a park has more than four squares had, a big park more than a park.
  const one = E.plotLayout(frame, 'square', 1, 3).placements.length;
  const park = E.plotLayout(E.areaFrame(block, 0, 0, 2, 2), 'park', 1, 3).placements.length, big = E.plotLayout(E.areaFrame(block, 0, 0, 3, 2), 'bigpark', 1, 3).placements.length;
  assert.ok(park > one * 2 && big > park, `${one} → ${park} → ${big}`);
  assert.ok(E.plotLayout(E.areaFrame(block, 0, 0, 2, 2), 'park', 2, 3).placements.some(p => p.kind === 'fountain'), 'a fountain in the park\'s second stage');
});

test('the public square: cells map to the ground and back, shared buildings stay in their cells', () => {
  const square = GRIDS.support.centres[0].square;
  const centre = E.cellPoint(square, 6, 6), back = E.pointCell(square, E.cellPoint(square, 3.5, 7.25));
  assert.ok(Math.hypot(centre.x - square.x, centre.z - square.z) < 1e-9);
  assert.ok(Math.abs(back.u - 3.5) < 1e-9 && Math.abs(back.v - 7.25) < 1e-9);
  const inside = (p, x, z, angle, w, d, pad) => {
    const s = Math.sin(angle), c = Math.cos(angle), dx = p.x - x, dz = p.z - z;
    return Math.abs(dx * c - dz * s) <= w / 2 + pad && Math.abs(dx * s + dz * c) <= d / 2 + pad;
  };
  for (const [family, levels] of Object.entries(E.PROJECT_LEVELS)) for (let level = 1; level <= levels; level++) for (const rotation of [0, 1, 2, 3]) {
    const [w, h] = E.projectFootprint(family, rotation), at = E.cellPoint(square, w / 2, h / 2);
    const { placements, surfaces } = E.objectLayout(square, { family, level, u: 0, v: 0, rotation });
    const angle = square.rotation + rotation * Math.PI / 2, [W, D] = E.PROJECT_SIZE[family].map(n => n * E.CELL);
    assert.ok(placements.length >= 1 && surfaces.length >= 1, `${family} ${level}`);
    for (const p of placements) assert.ok(inside(p, at.x, at.z, angle, W, D, -.05), `${family} ${level} ${p.kind} inside`);
    for (const s of surfaces) assert.ok(inside(s, at.x, at.z, angle, W, D, .01), `${family} ${level} ${s.kind} patch inside`);
  }
});

test('the preview of a shared project gives the server\'s reasons', () => {
  const none = () => false;
  assert.equal(E.squareProblem({ family: 'fountain', u: 10, v: 10, rotation: 0 }, none), null);
  assert.equal(E.squareProblem({ family: 'fountain', u: 11, v: 10, rotation: 0 }, none), 'Проект должен целиком помещаться на общественной площади');
  assert.equal(E.squareProblem({ family: 'park', u: 9, v: 0, rotation: 1 }, none), null);
  assert.equal(E.squareProblem({ family: 'park', u: 10, v: 0, rotation: 0 }, none), 'Проект должен целиком помещаться на общественной площади');
  assert.equal(E.squareProblem({ family: 'square', u: 5, v: 5, rotation: 0 }, (u, v) => u === 5 && v === 5), 'Эти клетки уже заняты');
  assert.match(server, /"Проект должен целиком помещаться на общественной площади"/);
  assert.match(server, /"Эти клетки уже заняты"/);
});
