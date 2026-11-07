/** «Весь город»: every cell of every district built on, once, on the real districts' names; only to look at. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({ stdin: { contents: `export { fullCity, fullDistrict } from "./fullCity.ts"; export { districtPlotGrid } from "./freeDistrictPlot.ts"; export { PLOT_SIZE, layoutDistrictId } from "../../city3d/world/estateGrid.ts";`, resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "error" });
const { fullCity, districtPlotGrid, PLOT_SIZE, layoutDistrictId } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

/** A city as the server sends it: `count` districts with land, a few things built, and one district past the layout. */
const estates = (city, count) => ({
  city, districts: [...Array.from({ length: count }, (_, i) => ({
    id: layoutDistrictId(city, count, i + 1), name: `Команда ${i + 1}`, number: i + 1, construction: true, mine: i === 1, managed: false,
    land: { cells: 900, taken: 12, built: 9, open_band: 1, bands: [] },
    landmark: { status: i ? "active" : "legacy_occupied", level: 2, name: "Площадь", module: 0, u: 0, v: 0, w: 12, h: 12, rotation: 0, taken: 12, plots: 900, peak: 12, next: { level: 3, name: "Парк", need: 40, remaining: 28, percent: 30 } },
    hq: { level: 2, name: "Штаб", built: 3, next: null },
    objects: [{ id: 501, family: "house", level: 2, owner: "resident", module: 1, u: 0, v: 0, w: 3, h: 3, rotation: 0 }],
    projects: [{ id: 7, family: "fountain", module: 0, u: 2, v: 2, w: 2, h: 2, rotation: 0 }], version: 4,
    decor: { road: [[1, 3, 0, 1]] },
  })), { id: `${city}-guests`, name: "Гости", number: count + 1, construction: false, mine: false, managed: false, land: null, landmark: null, hq: { level: 1, name: "Штаб", built: 0, next: null }, objects: [], projects: [], version: 1, decor: {} }],
});

for (const city of ["support", "sales"]) for (const count of [2, 3, 4, 5]) test(`${city}, ${count} districts: every cell for sale built on once, inside its block, on the real districts`, () => {
  const real = estates(city, count), grid = districtPlotGrid(city, count), full = fullCity(real);
  assert.equal(full.city, city);
  assert.equal(full.districts.length, real.districts.length);
  // The district without land stays as the server sent it.
  assert.equal(full.districts.at(-1), real.districts.at(-1));
  const ids = new Set();
  full.districts.slice(0, count).forEach((district, i) => {
    const was = real.districts[i];
    for (const key of ["id", "name", "number", "mine", "managed", "hq"]) assert.deepEqual(district[key], was[key], `${city} ${district.id}: ${key} kept`);
    assert.equal(district.construction, false);
    assert.deepEqual(district.projects, []);
    assert.deepEqual({ status: district.landmark.status, level: district.landmark.level, next: district.landmark.next }, { status: "active", level: 5, next: null });
    const blocks = new Map(grid.blocks.filter(b => b.district === district.number).map(b => [b.block, b]));
    const covered = new Map(), cover = (block, col, row, what) => {
      const at = blocks.get(block);
      assert.ok(at, `${city} ${district.id}: ${what} on block ${block} of another district`);
      assert.ok(col >= 0 && row >= 0 && col < at.cols && row < at.rows, `${city} ${district.id}: ${what} off block ${block} at ${col}:${row}`);
      assert.ok(!at.skip.has(`${col}:${row}`), `${city} ${district.id}: ${what} on a cell not for sale ${block}:${col}:${row}`);
      const key = `${block}:${col}:${row}`;
      assert.ok(!covered.has(key), `${city} ${district.id}: ${what} over ${covered.get(key)} at ${key}`);
      covered.set(key, what);
    };
    for (const o of district.objects) {
      assert.ok(!ids.has(o.id), `object ${o.id} twice`);
      ids.add(o.id);
      const [w, h] = PLOT_SIZE[o.family];
      assert.deepEqual([o.w, o.h], o.rotation % 2 ? [h, w] : [w, h], `${o.family} turned ${o.rotation}`);
      assert.ok(o.level >= 1 && o.level <= (o.family === "house" ? 5 : 3) && o.owner === "resident");
      for (let c = o.u; c < o.u + o.w; c++) for (let r = o.v; r < o.v + o.h; r++) cover(o.module, c, r, `${o.family} ${o.id}`);
    }
    for (const [family, cells] of Object.entries(district.decor)) for (const [block, col, row, mine] of cells) {
      assert.equal(mine, 0, "nothing to take away");
      cover(block, col, row, family);
    }
    let forSale = 0;
    for (const b of blocks.values()) for (let c = 0; c < b.cols; c++) for (let r = 0; r < b.rows; r++) if (!b.skip.has(`${c}:${r}`)) forSale++;
    assert.equal(covered.size, forSale, `${city} ${district.id}: every cell built on`);
    assert.deepEqual([district.land.cells, district.land.taken, district.land.built], [forSale, forSale, forSale]);
    // A city of houses: houses at every level, ready houses, offices, squares, parks, roads and greenery.
    const families = new Set(district.objects.map(o => o.family === "house" ? `house-${o.level}` : o.family.startsWith("office") ? "office" : o.family));
    for (const family of ["house-1", "house-3", "house-5", "office", "square", "park"]) assert.ok(families.has(family), `${city} ${district.id}: no ${family}`);
    assert.ok(district.decor.road.length > 0 && district.decor.tree.length > 0);
  });
});

test("the same made-up city every time, whatever the real one built", () => {
  const one = fullCity(estates("support", 3)), other = estates("support", 3);
  other.districts[0].objects = [];
  other.districts[0].decor = {};
  assert.deepEqual(fullCity(other), one);
});

test("everyone can look at the whole city built up, and only look: no building, no cards, a banner with the way back", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("./CityPage.tsx", import.meta.url), "utf8");
  assert.match(page, /const fullOn = !sandboxOn && !historyOn && params\.get\("full"\) === "1";/);
  // The button is everyone's: not under a role.
  const button = page.split("\n").find(line => line.includes("onClick={toggleFull}"));
  assert.ok(button && /^\s*<button type="button" className="city-group-button"/.test(button), button);
  assert.match(button, /aria-pressed=\{fullOn\}/);
  assert.match(button, /🏙️<\/span><span className="city-hud__wide">Весь город<\/span>/);
  // The map shows the made-up land; taps on it open nothing, and every way to build stays shut.
  assert.match(page, /if \(fullOn\) \{\n\s*if \(supportFull\) views\.support = \{ state: supportFull \};\n\s*if \(salesFull\) views\.sales = \{ state: salesFull \};\n\s*return views;/);
  assert.match(page, /if \(historyOn \|\| fullOn\) return;/);
  assert.match(page, /if \(historyOn \|\| fullOn\) setBuilding\(null\);/);
  assert.match(page, /canOpenBuild && !sandboxOn && !historyOn && !fullOn && user\?\.role/);
  assert.match(page, /!building && !sandboxOn && !historyOn && !fullOn && <CityPeekPanel className="city-build-peek"/);
  assert.match(page, /onMyEstate=\{canOpenBuild && !historyOn && !fullOn \? openBuild : undefined\}/);
  assert.match(page, /onOpenProject=\{fullOn \? undefined :/);
  // Turning it on leaves the test city and a past season; either of them turns it off.
  assert.match(page, /next\.set\("full", "1"\); next\.delete\("sandbox"\); next\.delete\("history"\);/);
  assert.match(page, /next\.set\("sandbox", "1"\); next\.delete\("full"\);/);
  assert.match(page, /next\.delete\("sandbox"\); next\.delete\("full"\);/);
  assert.match(page, /\{fullOn && <CityFullBanner onLeave=\{toggleFull\} \/>\}/);

  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const view = await build({ stdin: { contents: "export { CityFullBanner } from './CityFullView.tsx';", resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false, logLevel: "error" });
  const module = { exports: {} };
  new Function("require", "module", "exports", view.outputFiles[0].text)(require, module, module.exports);
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  assert.equal(renderToStaticMarkup(React.createElement(module.exports.CityFullBanner, { onLeave() {} })),
    '<div class="city-history-banner city-full-banner glass glass--regular" role="status"><span>🏙️ <strong>Весь город застроен</strong><span class="city-full-banner__about"> · так город может выглядеть, когда команды застроят всю землю</span> · только просмотр</span><button type="button">Выйти</button></div>');
  // A phone keeps the banner to one line: what it is and the way back.
  const css = readFileSync(new URL("./cityHistory.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 700px\) \{ \.city-full-banner__about \{ display: none; \} \}/);
});
