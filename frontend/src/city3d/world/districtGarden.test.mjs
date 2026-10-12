import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: `export { districtGarden, GARDEN_LAWN, GARDEN_PATH, GARDEN_PLAZA } from './districtGarden.ts'; export { LANDMARK_SIDE } from './districtLandmark.ts'; export { districtPlotGrid } from '../../pages/city/freeDistrictPlot.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const G = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

const gardens = ['support', 'sales'].flatMap(city => {
  const grid = G.districtPlotGrid(city);
  return grid.centres.map(centre => {
    const block = grid.blocks.find(b => b.district === centre.district && b.block === centre.block);
    return { city, centre, block, garden: G.districtGarden(block, centre) };
  });
});
const name = ({ city, centre }) => `${city} ${centre.district}`;
/** Is a point on the centre's cells (to a hair: the front edge is the block's own)? */
const inside = (block, centre, p, pad = 1e-6) => {
  const s = block.shape, u = (p.x - s.x0) / (s.x1 - s.x0) * block.cols, v = (p.z - s.z0) / (s.z1 - s.z0) * block.rows;
  return u > centre.col - pad && u < centre.col + centre.cols + pad && v > centre.row - pad && v < centre.row + centre.rows + pad;
};
/** A point in the centre's own frame: `u` along its front, `w` from its middle towards the front. */
const local = (centre, p) => {
  const s = Math.sin(centre.area.rotation), c = Math.cos(centre.area.rotation), dx = p.x - centre.area.x, dz = p.z - centre.area.z;
  return { u: dx * c - dz * s, w: dx * s + dz * c };
};
const shoelace = points => Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.z - q.x * p.z; }, 0)) / 2;
/** The area of a rectangle of cells. */
const areaOf = (block, centre) => {
  const s = block.shape;
  return (s.x1 - s.x0) / block.cols * centre.cols * (s.z1 - s.z0) / block.rows * centre.rows;
};

test('every district centre of both cities has a garden: three of them a city', () => {
  assert.deepEqual(gardens.map(name), ['support 1', 'support 2', 'support 3', 'sales 1', 'sales 2', 'sales 3']);
});

test('the ground covers the centre\'s cells once, in lawn, paths and paving, and nothing beyond them', () => {
  for (const g of gardens) {
    const { ground } = g.garden, { centre, block } = g;
    assert.ok(ground.length > 30, name(g));
    assert.deepEqual([...new Set(ground.map(q => q.colour))].sort(), [G.GARDEN_LAWN, G.GARDEN_PATH, G.GARDEN_PLAZA].sort(), name(g));
    for (const q of ground) for (const p of q.points) assert.ok(inside(block, centre, p), `${name(g)}: ground off the centre`);
    // The quads tile the centre: their areas add up to its own.
    const sum = ground.reduce((total, q) => total + shoelace(q.points), 0), whole = areaOf(block, centre);
    assert.ok(Math.abs(sum - whole) / whole < .002, `${name(g)}: ${sum.toFixed(1)} of ${whole.toFixed(1)}`);
    // Lawn most of all; the paving at the front and round the fountain.
    const share = colour => ground.filter(q => q.colour === colour).reduce((total, q) => total + shoelace(q.points), 0) / sum;
    assert.ok(share(G.GARDEN_LAWN) > .5 && share(G.GARDEN_PLAZA) > .1 && share(G.GARDEN_PATH) > .1, name(g));
  }
});

test('the main building grows on free ground: nothing stands on its square, everything stands in the centre', () => {
  const half = G.LANDMARK_SIDE / 2;
  for (const g of gardens) {
    const { placements } = g.garden, { centre, block } = g;
    for (const p of placements) {
      const at = local(centre, p), reach = p.kind === 'fountain' ? 1.4 : p.kind.startsWith('tree') ? .9 : p.kind === 'lamp' ? .2 : .5;
      assert.ok(Math.abs(at.u) > half + reach || Math.abs(at.w) > half + reach, `${name(g)}: ${p.kind} on the main building's square (${at.u.toFixed(2)}, ${at.w.toFixed(2)})`);
      assert.ok(inside(block, centre, p, -.3), `${name(g)}: ${p.kind} off the centre`);
    }
  }
});

test('a fountain on the left lawn as the city sees it, flowerbeds on the right, trees, lamps and benches all round', () => {
  for (const g of gardens) {
    const { placements, lamps } = g.garden, count = kind => placements.filter(p => p.kind === kind).length;
    assert.equal(count('fountain'), 1, name(g));
    assert.ok(placements.filter(p => p.kind.startsWith('tree-')).length >= 20, name(g));
    assert.ok(count('bench') >= 10 && count('flowerbed') >= 6 && count('bush') >= 10, name(g));
    assert.ok(lamps.length >= 14 && lamps.every(l => l.kind === 'lamp' && placements.includes(l)), name(g));
    // Facing the building from the front (its front looks along its rotation), the fountain is to the left.
    const fountain = local(g.centre, placements.find(p => p.kind === 'fountain'));
    const front = { x: Math.sin(g.centre.area.rotation), z: Math.cos(g.centre.area.rotation) }, look = { x: -front.x, z: -front.z }, right = { x: -look.z, z: look.x };
    const at = placements.find(p => p.kind === 'fountain'), dx = at.x - g.centre.area.x, dz = at.z - g.centre.area.z;
    assert.ok(dx * right.x + dz * right.z < -8, `${name(g)}: the fountain ${fountain.u.toFixed(1)} along the front`);
    const beds = placements.filter(p => p.kind === 'flowerbed' && (p.x - g.centre.area.x) * right.x + (p.z - g.centre.area.z) * right.z > 8);
    assert.ok(beds.length >= 2, `${name(g)}: flowerbeds on the right`);
  }
});

test('the same land gives the same garden', () => {
  const g = gardens[0];
  assert.deepEqual(G.districtGarden(g.block, g.centre), g.garden);
});
