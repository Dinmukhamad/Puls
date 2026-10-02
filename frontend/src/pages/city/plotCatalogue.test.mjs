import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
async function load(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

const { splitPlotCatalogue, estateRows, plotEconomyName } = await load("./plotCatalogue.ts");
const { OFFICE_BUILDINGS } = await load("../../city3d/world/officeBuildings.ts");
const { CityEstateDock } = await load("./CityEstateDock.tsx");
const { CitySandboxDock } = await load("./CitySandboxDock.tsx");
const officeFamilies = Object.keys(OFFICE_BUILDINGS);
const entry = (family, name, ready = false, price = 100) => ({ family, name, ready, icon: "🏢", size: [1, 1], squares: null, levels: [{ level: 1, name, about: `${name}: описание`, price }] });
const offices = officeFamilies.map((family, i) => entry(family, OFFICE_BUILDINGS[family].name, true, 900 + i * 100));
const catalogue = [entry("square", "Сквер"), entry("house", "Дом"), entry("carport", "Коттедж с навесом", true, 500), ...offices, entry("park", "Парк"), entry("bigpark", "Большой парк")];
const district = { id: "support-team-1", name: "Первый район", number: 1, construction: true, mine: true, managed: true, land: { plots: 10, taken: 0, open_band: 1, bands: [{ band: 1, plots: 10, taken: 0 }] }, hq: { level: 1, name: "Штаб", built: 0, next: null }, objects: [], projects: [], version: 1 };
const mine = { status: "ready", message: null, district: { id: district.id, city: "support", name: district.name }, objects: [], catalogue, projects: [], land_prices: [200], economy_revision: 1, balance: 1500, available: 1500, legacy: { count: 0, paid: 0 }, managed: [] };
const selectedPlot = { district: district.id, area: "plots", placing: null, selected: null, plot: { block: 1, col: 0, row: 0, band: 1, problem: null }, spot: null, project: false };
const noop = () => {};
function render(Dock, props) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(Dock, { build: selectedPlot, setBuild: noop, onClose: noop, onFocus: noop, ...props })));
  client.clear();
  return html;
}
const section = (html, title) => html.match(new RegExp(`<section class="estate-section"><h3>${title}</h3>(.*?)</section>`, "s"))?.[1] ?? assert.fail(`Missing ${title} section`);

test("catalogue separates every office from ready houses and excludes gathered parks", () => {
  assert.equal(officeFamilies.length, 9);
  const grouped = splitPlotCatalogue(catalogue);
  assert.deepEqual(grouped.options.map(c => c.family), ["square", "house"]);
  assert.deepEqual(grouped.houses.map(c => c.family), ["carport"]);
  assert.deepEqual(grouped.offices.map(c => c.family), officeFamilies);
  assert.equal(new Set([...grouped.options, ...grouped.houses, ...grouped.offices].map(c => c.family)).size, 12);
  assert.deepEqual(splitPlotCatalogue([]), { options: [], houses: [], offices: [] });
});

test("economy groups office prices once with readable names, keeping staged buildings separate", () => {
  const estate = { square: [100], carport: [500], officea: [900], house: [100, 200, 300, 400, 500], ...Object.fromEntries(officeFamilies.slice(1).map(family => [family, [1000]])), bungalow: [600], park: [0, 800] };
  const rows = estateRows(estate);
  assert.deepEqual(rows.find(row => row.key === "offices"), { key: "offices", title: "Офисные здания", families: officeFamilies });
  assert.deepEqual(rows.find(row => row.key === "houses").families, ["carport", "bungalow"]);
  assert.deepEqual(rows.find(row => row.key === "house").families, ["house"]);
  assert.deepEqual(rows.flatMap(row => row.families).sort(), Object.keys(estate).sort());
  for (const family of officeFamilies) assert.equal(plotEconomyName(family), `🏢 ${OFFICE_BUILDINGS[family].name}`);
  assert.equal(plotEconomyName("unknown"), "unknown");
});

test("paid purchase shows offices as one-price buildings with land added and affordability enforced", () => {
  const html = render(CityEstateDock, { mine, land: district });
  const officeSection = section(html, "Офисные здания"), houseSection = section(html, "Готовые дома");
  assert.match(officeSection, /по одной цене, без ступеней/);
  for (const office of offices) {
    assert.ok(officeSection.includes(`<strong>${office.name}</strong>`));
    assert.ok(!houseSection.includes(`<strong>${office.name}</strong>`));
    const button = officeSection.match(new RegExp(`<button([^>]*aria-label="${office.name} на участке за ${office.levels[0].price + 200} коинов"[^>]*)>`));
    assert.ok(button, `${office.family} purchase includes land price`);
    assert.equal(button[1].includes('disabled=""'), office.levels[0].price + 200 > mine.available);
  }
  assert.ok(houseSection.includes("Коттедж с навесом"));
});

test("sandbox exposes all offices separately and builds them for free", () => {
  const html = render(CitySandboxDock, { city: "support", state: { city: "support", sandbox: true, districts: [district] }, mine });
  const officeSection = section(html, "Офисные здания"), houseSection = section(html, "Готовые дома");
  for (const office of offices) {
    assert.ok(officeSection.includes(`<strong>${office.name}</strong>`));
    assert.ok(!houseSection.includes(`<strong>${office.name}</strong>`));
    assert.ok(officeSection.includes(`aria-label="${office.name} на участке бесплатно">Бесплатно</button>`));
  }
});

test("owned and sandbox offices have no stage or upgrade controls", () => {
  const office = offices[0], object = { id: 7, family: office.family, level: 1, state: "placed", owner: "mine", district_id: district.id, source: "purchase", paid: 1100, version: 1, squares: 1, module: 1, u: 0, v: 0, w: 1, h: 1, rotation: 0 };
  const build = { ...selectedPlot, plot: null, selected: object.id };
  const owned = render(CityEstateDock, { mine: { ...mine, objects: [object] }, land: district, build });
  const sandbox = render(CitySandboxDock, { city: "support", state: { city: "support", sandbox: true, districts: [{ ...district, objects: [object] }] }, mine, build });
  for (const html of [owned, sandbox]) {
    assert.match(html, /Офисное здание построено целиком, ступеней нет/);
    assert.doesNotMatch(html, /Улучшить|aria-label="Ступень|Выбрать ступень/);
  }
});
