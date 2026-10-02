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

const land = { plots: 90, taken: 31, open_band: 2, bands: [{ band: 1, plots: 20, taken: 18 }, { band: 2, plots: 30, taken: 12 }, { band: 3, plots: 40, taken: 1 }] };
const district = { id: "support-team-1", name: "Район 1", number: 1, construction: true, mine: true, managed: false, land, hq: { level: 1, name: "Штаб", built: 0, next: null }, objects: [], projects: [], version: 1 };
const team = { id: district.id, name: district.name, supervisor: "Гаухар", mine: true };
const catalogue = [{ family: "house", name: "Дом", icon: "🏡", size: [1, 1], squares: null, ready: false, levels: [{ level: 1, name: "Небольшой дом", about: "Дом для начала стройки", price: 300 }] }];
const mine = { status: "ready", message: null, district: { id: district.id, city: "support", name: district.name }, objects: [], catalogue, projects: [], land_prices: [200, 150, 100], economy_revision: 1, balance: 900, available: 850, legacy: { count: 0, paid: 0 }, managed: [] };
const buildState = { district: district.id, area: "plots", placing: null, selected: null, plot: null, spot: null, project: false };
const noop = () => {};
function render(Component, props) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(Component, props)));
  client.clear();
  return html;
}
const dockProps = { mine, land: district, build: buildState, setBuild: noop, onClose: noop, onFocus: noop };
const sheetProps = { district, team, cityName: "Техподдержка", mine, onMyEstate: noop, onOpenProject: noop };

test("unlock summary counts all open stages and excludes future land", () => {
  assert.deepEqual(districtBuildProgress(land), { stage: 2, stages: 3, plots: 50, taken: 30, available: 20, target: 35, remaining: 5 });
  // A park occupies several plots; the unit here must be plots, not building count.
  const almost = { ...land, bands: land.bands.map(b => b.band === 2 ? { ...b, taken: 16 } : b) };
  assert.equal(districtBuildProgress(almost).remaining, 1);
  assert.equal(districtBuildProgress({ ...land, open_band: 3 }).remaining, null);
});

test("70 percent threshold rounds up and shows one clear next stage", () => {
  const small = { plots: 8, taken: 2, open_band: 1, bands: [{ band: 1, plots: 3, taken: 2 }, { band: 2, plots: 5, taken: 0 }] };
  assert.equal(districtBuildProgress(small).remaining, 1);
  const html = render(DistrictBuildProgress, { land: small });
  assert.match(html, /ещё 1 участок/);
  assert.match(html, /aria-valuemax="3" aria-valuenow="2"/);
  assert.equal((html.match(/role="progressbar"/g) ?? []).length, 1);
  const fullyOpen = render(DistrictBuildProgress, { land: { ...small, open_band: 2 } });
  assert.match(fullyOpen, /Весь район открыт/);
  assert.doesNotMatch(fullyOpen, /следующего этапа|Откроется позже|role="progressbar"/);
});

test("district card distinguishes personal ownership and shared projects without offering foreign building", () => {
  const own = render(CityDistrictSheet, sheetProps);
  assert.match(own, /Личные постройки/);
  assert.match(own, /Площадь команды/);
  assert.match(own, /Выбрать участок/);
  assert.doesNotMatch(own, /Создать общий проект/);
  const foreign = render(CityDistrictSheet, { ...sheetProps, team: { ...team, mine: false }, mine: { ...mine, district: { ...mine.district, id: "support-team-2" } } });
  assert.doesNotMatch(foreign, /Выбрать участок|Создать общий проект/);
  assert.match(foreign, /Строить можно в районе своей команды/);
  const managed = render(CityDistrictSheet, { ...sheetProps, district: { ...district, managed: true } });
  assert.match(managed, /Создать общий проект/);
  const closed = render(CityDistrictSheet, { ...sheetProps, district: { ...district, managed: true, construction: false } });
  assert.doesNotMatch(closed, /Создать общий проект/);
});

test("purchase shows full land plus building price and respects spendable coins", () => {
  const selected = { ...buildState, plot: { block: 4, col: 0, row: 0, band: 2, problem: null } };
  const html = render(CityEstateDock, { ...dockProps, build: selected });
  assert.match(html, /<h2>Свободный участок<\/h2>/);
  assert.match(html, /Земля ◈ 150 · включена в цену покупки/);
  assert.match(html, /aria-label="Небольшой дом на участке за 450 коинов">Купить · ◈ 450<\/button>/);
  assert.doesNotMatch(html, /пояс|Квартал/);
  const insufficient = render(CityEstateDock, { ...dockProps, mine: { ...mine, available: 400 }, build: selected });
  assert.match(insufficient, /disabled=""[^>]+aria-label="Небольшой дом на участке за 450 коинов">Не хватает 50<\/button>/);
  const future = render(CityEstateDock, { ...dockProps, build: { ...selected, plot: { ...selected.plot, band: 3, problem: "Этот участок станет доступен после расширения района" } } });
  assert.match(future, /До расширения — осталось занять ещё 5 участков/);
  assert.match(future, /disabled=""[^>]+aria-label="Небольшой дом на участке за 400 коинов"/);
});

test("building overview gives three short steps and one district progress bar", () => {
  const html = render(CityEstateDock, dockProps);
  assert.match(html, /<ol class="estate-steps"><li>[^<]+<\/li><li>[^<]+<\/li><li>[^<]+<\/li><\/ol>/);
  assert.match(html, /Можно потратить <strong>◈ 850<\/strong>/);
  assert.match(html, /ещё 5 участков/);
  assert.equal((html.match(/role="progressbar"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Пояса района|Пояс \d|estate-bands/);
});
