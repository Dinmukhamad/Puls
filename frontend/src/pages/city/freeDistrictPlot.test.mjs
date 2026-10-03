import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({ entryPoints: [fileURLToPath(new URL("./freeDistrictPlot.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", write: false });
const { districtPlotGrid, freeDistrictPlot } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const district = (city, number, objects = []) => ({ id: `${city}-team-${number}`, number, objects });
const objectAt = (plot, extra = {}) => ({ module: plot.block, u: plot.col, v: plot.row, w: 1, h: 1, ...extra });

for (const city of ["support", "sales"]) {
  test(`${city}: suggestion uses real personal land and stays in the assigned district`, () => {
    const grid = districtPlotGrid(city);
    assert.equal(districtPlotGrid(city), grid);
    for (const number of [1, 2, 3]) {
      const plot = freeDistrictPlot(grid, district(city, number));
      assert.ok(grid.plots.includes(plot));
      assert.equal(plot.district, number);
      assert.notEqual(plot.block, 0);
    }
    assert.equal(freeDistrictPlot(grid, district(city, 4)), null);
    assert.equal(freeDistrictPlot(grid, district(city === "support" ? "sales" : "support", 1)), null);
  });

  test(`${city}: neighbours and every cell of a rotated park block the suggestion`, () => {
    const grid = districtPlotGrid(city), first = freeDistrictPlot(grid, district(city, 1));
    const parked = objectAt(first, { w: 2, h: 3, rotation: 1, owner: "resident" });
    const next = freeDistrictPlot(grid, district(city, 1, [parked]));
    assert.ok(next);
    assert.ok(next.block !== first.block || next.col < first.col || next.col >= first.col + 2 || next.row < first.row || next.row >= first.row + 3);
    // An old public project uses different cells, and must not occupy personal land.
    assert.equal(freeDistrictPlot(grid, district(city, 1, [{ module: 0, u: 0, v: 0, w: 12, h: 12 }])), first);
    assert.equal(freeDistrictPlot(grid, district(city, 1, [{ module: null, u: null, v: null, w: 1, h: 1 }])), first);
  });

  test(`${city}: outer land can be suggested and a full district never falls back to foreign plots`, () => {
    const grid = districtPlotGrid(city), own = grid.plots.filter(p => p.district === 1);
    const last = own.find(p => p.band === grid.bands);
    const objects = own.filter(p => p !== last).map(p => objectAt(p));
    assert.equal(freeDistrictPlot(grid, { ...district(city, 1, objects), land: { open_band: 1 } }), last);
    assert.equal(freeDistrictPlot(grid, district(city, 1, [...objects, objectAt(last)])), null);
  });
}
