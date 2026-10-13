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
const { districtBuildProgress } = await load("./districtProgress.ts");
const { DistrictBuildProgress } = await load("./DistrictBuildProgress.tsx");
const { CityEstateDock } = await load("./CityEstateDock.tsx");
const { CityDistrictSheet } = await load("./CityDistrictSheet.tsx");

const land = { cells: 90, taken: 31, built: 27, open_band: 2, bands: [{ band: 1, cells: 20, taken: 18 }, { band: 2, cells: 30, taken: 12 }, { band: 3, cells: 40, taken: 1 }] };
const landmark = { status: "legacy_occupied", level: 3, name: "Деловой центр", module: 0, u: 0, v: 0, w: 12, h: 12, rotation: 0, taken: 31, plots: 90, peak: 31,
  next: { level: 4, name: "Комплекс команды", need: 45, remaining: 14, percent: 50 } };
const district = { id: "support-team-1", name: "Район 1", number: 1, construction: true, mine: true, managed: false, land, landmark, hq: { level: 1, name: "Штаб", built: 0, next: null }, objects: [], projects: [], version: 1 };
const team = { id: district.id, name: district.name, supervisor: "Гаухар", mine: true };
const catalogue = [{ family: "house", name: "Дом", icon: "🏡", size: [1, 1], squares: null, ready: false, levels: [{ level: 1, name: "Небольшой дом", about: "Дом для начала стройки", price: 300 }] }];
const mine = { status: "ready", message: null, district: { id: district.id, city: "support", name: district.name }, objects: [], catalogue, projects: [], land_prices: [200, 150, 100], economy_revision: 1, balance: 900, available: 850, legacy: { count: 0, paid: 0 }, managed: [] };
const buildState = { district: district.id, area: "plots", placing: null, selected: null, choice: null, spot: null, project: false };
const noop = () => {};
function render(Component, props) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(Component, props)));
  client.clear();
  return html;
}
const dockProps = { mine, land: district, build: buildState, setBuild: noop, onClose: noop, onFocus: noop };
const sheetProps = { district, team, cityName: "Техподдержка", mine, onMyEstate: noop, onOpenProject: noop };

test("land summary counts the whole district regardless of former open stages", () => {
  assert.deepEqual(districtBuildProgress(land), { cells: 90, taken: 31, available: 59 });
  assert.deepEqual(districtBuildProgress({ ...land, open_band: 1 }), districtBuildProgress(land));
  assert.deepEqual(districtBuildProgress({ ...land, open_band: 3 }), districtBuildProgress(land));
  // A house takes nine cells, a road one; count occupied land rather than buildings.
  assert.equal(districtBuildProgress({ ...land, taken: 35 }).available, 55);
  assert.equal(districtBuildProgress({ ...land, taken: 90 }).available, 0);
});

test("all land is available and the summary has no competing unlock progress", () => {
  const small = { cells: 8, taken: 2, built: 0, open_band: 1, bands: [{ band: 1, cells: 3, taken: 2 }, { band: 2, cells: 5, taken: 0 }] };
  const html = render(DistrictBuildProgress, { land: small });
  assert.match(html, /Весь район открыт/);
  assert.match(html, /Свободно 6 клеток · занято 2 из 8/);
  assert.match(html, /Операторы команды сами планируют район: прокладывают дороги, сажают деревья, ставят фонари и дома/);
  // Thousands read as such.
  assert.match(render(DistrictBuildProgress, { land: { ...small, cells: 10635, taken: 219 } }), /Свободно 10\s416 клеток · занято 219 из 10\s635/);
  assert.doesNotMatch(html, /70 %|Этап застройки|расширения|Откроется позже|role="progressbar"/);
});

test("district card distinguishes personal ownership and shared projects without offering foreign building", () => {
  const own = render(CityDistrictSheet, sheetProps);
  assert.match(own, /Личные постройки/);
  assert.match(own, /Площадь команды/);
  assert.match(own, /Строить в районе →/);
  assert.match(own, /Для стройки свободно 59 клеток/);
  assert.doesNotMatch(own, /Создать общий проект/);
  const foreign = render(CityDistrictSheet, { ...sheetProps, team: { ...team, mine: false }, mine: { ...mine, district: { ...mine.district, id: "support-team-2" } } });
  assert.doesNotMatch(foreign, /Строить в районе|Создать общий проект/);
  assert.match(foreign, /Строить можно в районе своей команды/);
  const managed = render(CityDistrictSheet, { ...sheetProps, district: { ...district, managed: true } });
  assert.match(managed, /Создать общий проект/);
  const closed = render(CityDistrictSheet, { ...sheetProps, district: { ...district, managed: true, construction: false } });
  assert.doesNotMatch(closed, /Создать общий проект/);
});

test("purchase shows full land plus building price and respects spendable coins", () => {
  // A house on 3 × 3 cells round a cell of the second zone: nine cells of land at 15 and the house.
  const choice = band => ({ cells: [{ block: 4, col: 1, row: 1, band, state: "free" }], shape: "cell", family: "house", rotation: 0, every: 1, at: { col: 0, row: 0, problem: null } });
  const selected = { ...buildState, choice: choice(2) };
  const prices = { ...mine, land_prices: [20, 15, 10] };
  const html = render(CityEstateDock, { ...dockProps, mine: prices, build: selected });
  assert.match(html, /<strong>Выбрано: 1 клетка<\/strong>/);
  assert.match(html, /<strong>Дом<\/strong><small>3 × 3 клетки · ◈ 435<\/small>/);
  assert.match(html, /Земля 9 × ◈ 15 = ◈ 135 \+ дом ◈ 300/);
  assert.match(html, /<button type="button" class="city-action">Купить · ◈ 435<\/button>/);
  // The front looks to a road beside the house, or where the operator turns it.
  assert.match(html, />Повернуть фасад<\/button>/);
  assert.doesNotMatch(html, /пояс|Квартал/);
  const insufficient = render(CityEstateDock, { ...dockProps, mine: { ...prices, available: 400 }, build: selected });
  assert.match(insufficient, /disabled="">Не хватает 35<\/button>/);
  const outer = render(CityEstateDock, { ...dockProps, mine: prices, build: { ...selected, choice: choice(3) } });
  assert.match(outer, />Купить · ◈ 390</);
  assert.doesNotMatch(outer, /До расширения|Откроется позже|Этап застройки/);
  const occupied = render(CityEstateDock, { ...dockProps, mine: prices, build: { ...selected, choice: { ...choice(3), at: { col: 0, row: 0, problem: "Не помещается: 3 клетки из 9 заняты — они красные на карте." } } } });
  assert.match(occupied, /role="alert">Не помещается: 3 клетки из 9 заняты/);
  assert.match(occupied, /disabled="">Купить · ◈ 390<\/button>/);
});

test("building opens on the shop with one district progress bar", () => {
  const html = render(CityEstateDock, dockProps);
  assert.match(html, /<section class="estate-shop" aria-label="Магазин района">/);
  assert.match(html, /Можно потратить <strong>◈ 850<\/strong>/);
  assert.match(html, /Весь район открыт/);
  assert.match(html, /Свободно 59 клеток/);
  assert.match(html, /застройте ещё 14 клеток/);
  assert.equal((html.match(/role="progressbar"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Пояса района|Пояс \d|estate-bands|Этап застройки|70 %|estate-steps|Дорогах и благоустройстве/);
});
