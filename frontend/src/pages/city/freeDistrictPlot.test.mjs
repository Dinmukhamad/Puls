import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({ stdin: { contents: `export { districtPlotGrid, freeDistrictPlot } from "./freeDistrictPlot.ts"; export { areaCorners, areaPoint } from "../../city3d/world/land.ts";`, resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false });
const { districtPlotGrid, freeDistrictPlot, areaCorners, areaPoint } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const district = (city, number, objects = [], decor = {}) => ({ id: `${city}-team-${number}`, number, objects, decor });
const blockOf = (grid, number, plot) => grid.blocks.find(b => b.district === number && b.block === plot.block);
/** The nine cells of a suggested plot. */
const nine = plot => Array.from({ length: 9 }, (_, i) => [plot.col + i % 3, plot.row + Math.floor(i / 3)]);
const overlaps = (plot, col, row, w, h) => plot.col < col + w && col < plot.col + 3 && plot.row < row + h && row < plot.row + 3;

for (const city of ["support", "sales"]) {
  test(`${city}: a suggestion is a free plot of 3 × 3 cells in the assigned district, by its centre`, () => {
    const grid = districtPlotGrid(city);
    assert.equal(districtPlotGrid(city), grid);
    for (const number of [1, 2, 3]) {
      const plot = freeDistrictPlot(grid, district(city, number)), block = blockOf(grid, number, plot);
      assert.ok(block, `${city} ${number}: a block of the district`);
      assert.equal(plot.band, block.band);
      for (const [c, r] of nine(plot)) assert.ok(c < block.cols && r < block.rows && !block.skip.has(`${c}:${r}`), `${city} ${number}: cell ${c}:${r} for sale`);
      // Right by the district's centre, where its main building stands.
      const centre = grid.centres.find(c => c.district === number).area, middle = areaPoint(areaCorners(block, plot.col, plot.row, 3, 3), .5, .5);
      assert.ok(Math.hypot(middle.x - centre.x, middle.z - centre.z) < 35, `${city} ${number}: ${Math.hypot(middle.x - centre.x, middle.z - centre.z).toFixed(1)} from the centre`);
    }
    assert.equal(freeDistrictPlot(grid, district(city, 4)), null);
    assert.equal(freeDistrictPlot(grid, district(city === "support" ? "sales" : "support", 1)), null);
  });

  test(`${city}: buildings, every cell of a park and small things keep the suggestion off their cells`, () => {
    const grid = districtPlotGrid(city), first = freeDistrictPlot(grid, district(city, 1));
    // A neighbour's big park over the suggested plot: six squares, 9 × 6 cells, turned.
    const park = { module: first.block, u: first.col, v: first.row, w: 6, h: 9, rotation: 1, owner: "resident" };
    const next = freeDistrictPlot(grid, district(city, 1, [park]));
    assert.ok(next && (next.block !== first.block || !overlaps(next, first.col, first.row, 6, 9)), "off the park");
    // A road on one cell of it, or a lamp: the suggestion moves off that cell.
    for (const [family, dc, dr] of [["road", 1, 1], ["lamp", 2, 0]]) {
      const moved = freeDistrictPlot(grid, district(city, 1, [], { [family]: [[first.block, first.col + dc, first.row + dr, 0]] }));
      assert.ok(moved && (moved.block !== first.block || !overlaps(moved, first.col + dc, first.row + dr, 1, 1)), `off the ${family}`);
    }
    // An old public project uses the square's own cells; an unplaced building none.
    assert.deepEqual(freeDistrictPlot(grid, district(city, 1, [{ module: 0, u: 0, v: 0, w: 12, h: 12 }])), first);
    assert.deepEqual(freeDistrictPlot(grid, district(city, 1, [{ module: null, u: null, v: null, w: 3, h: 3 }])), first);
  });

  test(`${city}: the outer land can be suggested, and a full district gets no suggestion`, () => {
    const grid = districtPlotGrid(city), outer = grid.blocks.filter(b => b.district === 1 && b.band === grid.bands && b.cols >= 3 && b.rows >= 3).at(-1);
    // Everything taken by trees but three by three cells for sale at the far edge of the land (the island city's blocks
    // are rectangles round their cells, its corners not for sale).
    const free = (c, r) => [0, 1, 2].every(i => [0, 1, 2].every(j => !outer.skip.has(`${c + i}:${r + j}`)));
    let spare = null;
    for (let c = outer.cols - 3; c >= 0 && !spare; c--) for (let r = outer.rows - 3; r >= 0 && !spare; r--) if (free(c, r)) spare = { col: c, row: r };
    const trees = [];
    for (const block of grid.blocks.filter(b => b.district === 1)) for (let c = 0; c < block.cols; c++) for (let r = 0; r < block.rows; r++) {
      if (block === outer && c >= spare.col && c < spare.col + 3 && r >= spare.row && r < spare.row + 3) continue;
      trees.push([block.block, c, r, 0]);
    }
    assert.deepEqual(freeDistrictPlot(grid, { ...district(city, 1, [], { tree: trees }), land: { open_band: 1 } }), { block: outer.block, ...spare, band: outer.band });
    assert.equal(freeDistrictPlot(grid, district(city, 1, [{ module: outer.block, u: spare.col, v: spare.row, w: 3, h: 3 }], { tree: trees })), null);
  });
}
