import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const built = await build({ entryPoints: [fileURLToPath(new URL("./cellChoice.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", define: { "import.meta.env": "{}" }, write: false, logLevel: "error" });
const C = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const line = states => states.map((state, col) => ({ block: 2, col, row: 4, band: 2, state }));

test("a small thing goes on every cell of the line, or on every second or third for those that stand apart", () => {
  const cells = line(["free", "taken", "free", "own", "free", "free", "free"]);
  const spots = (family, every) => C.decorSpots({ cells, family, every });
  assert.deepEqual(spots("lamp", 1).free.map(c => c.col), [0, 2, 4, 5, 6]);
  assert.deepEqual(spots("lamp", 2).spots.map(c => c.col), [0, 2, 4, 6]);
  assert.deepEqual(spots("tree", 3).spots.map(c => c.col), [0, 3, 6]);
  assert.deepEqual(spots("tree", 3).free.map(c => c.col), [0, 6], "a spot already taken is left out");
  // Roads, footpaths, alleys and hedges go on every cell, whatever was chosen for the lamps before.
  for (const family of ["road", "path", "alley", "hedge"]) assert.deepEqual(spots(family, 3).spots.map(c => c.col), [0, 1, 2, 3, 4, 5, 6], family);
  assert.deepEqual(C.SPACED, ["tree", "pine", "birch", "oak", "lamp", "bench", "bush", "flowers"]);
  assert.equal(C.spacing({ family: "bench", every: 0 }), 1);
  assert.deepEqual(C.decorSpots({ cells: [], family: "lamp", every: 2 }), { spots: [], free: [] });
});

test("the cells of one's own small things, what is a building, and nothing chosen", () => {
  assert.deepEqual(C.ownCells({ cells: line(["own", "free", "own", "taken"]) }).map(c => c.col), [0, 2]);
  assert.deepEqual(C.ownCells(null), []);
  assert.ok(C.isBuilding("house") && C.isBuilding("officea") && C.isBuilding("square"));
  assert.ok(!C.isBuilding("alley") && !C.isBuilding(null));
  assert.deepEqual(C.NO_CHOICE, { cells: [], shape: "cell", family: null, rotation: 0, every: 1, at: null });
  // What a tap does, for phones: one cell, a line from the last one, an area between two corners.
  assert.deepEqual(C.SHAPES.map(s => [s.value, s.label]), [["cell", "Клетка"], ["line", "Линия"], ["area", "Область"]]);
});

test("the shop's tabs hold every thing once, in the order operators asked for", () => {
  assert.deepEqual(C.SHOP_TABS.map(t => t.name), ["Дома", "Офисы", "Скверы", "Дороги", "Деревья", "Фонари и скамейки", "Кусты и клумбы"]);
  const tabs = { house: "houses", carport: "houses", terrace: "houses", officea: "offices", officei: "offices", square: "squares", park: "squares",
    road: "roads", path: "roads", alley: "roads", tree: "trees", pine: "trees", birch: "trees", oak: "trees", lamp: "lamps", bench: "lamps", bush: "bushes", flowers: "bushes", hedge: "bushes" };
  for (const [family, tab] of Object.entries(tabs)) assert.equal(C.shopTab(family), tab, family);
  // The first tab: the chosen thing's, roads for a line, houses otherwise.
  assert.equal(C.firstTab({ cells: line(["free"]), family: "lamp" }), "lamps");
  assert.equal(C.firstTab({ cells: line(["free", "free"]), family: null }), "roads");
  assert.equal(C.firstTab({ cells: line(["free"]), family: null }), "houses");
  assert.equal(C.firstTab(null), "houses");
  assert.equal(C.shopPicture("alley"), "/city/shop/v1/alley.webp");
});
