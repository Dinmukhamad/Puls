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
const { DistrictLandmarkCard } = await load("./DistrictLandmarkCard.tsx");
const { CityDistrictSheet } = await load("./CityDistrictSheet.tsx");
const { CityEstateDock, DistrictTab } = await load("./CityEstateDock.tsx");
const { CitySandboxDock } = await load("./CitySandboxDock.tsx");

const landmark = { status: "active", level: 2, name: "Дом команды", module: 0, u: 0, v: 0, w: 12, h: 12, rotation: 0, taken: 24, plots: 200, peak: 24,
  next: { level: 3, name: "Деловой центр", need: 50, remaining: 26, percent: 25 } };
const district = { id: "support-team-1", name: "Район 1", number: 1, construction: true, mine: true, managed: true,
  land: { cells: 200, taken: 24, built: 24, open_band: 1, bands: [{ band: 1, cells: 50, taken: 24 }, { band: 2, cells: 150, taken: 0 }] }, landmark,
  hq: { level: 2, name: "Штаб", built: 3, next: { level: 3, name: "Главный штаб", need: 6 } }, objects: [], projects: [], version: 1 };
const mine = { status: "ready", message: null, district: { id: district.id, city: "support", name: district.name }, objects: [],
  catalogue: [{ family: "house", name: "Дом", icon: "🏡", size: [1, 1], squares: null, ready: false, levels: [{ level: 1, name: "Небольшой дом", about: "Дом", price: 300 }] }],
  projects: [{ family: "fountain", name: "Площадь с фонтаном", icon: "⛲", size: [2, 2], project: "main", levels: [{ level: 1, name: "Фонтан", about: "Фонтан", cost: 1000 }] }],
  land_prices: [200, 150], economy_revision: 1, balance: 900, available: 850, legacy: { count: 0, paid: 0 }, managed: [district.id] };
const team = { id: district.id, name: district.name, supervisor: "Гаухар", mine: true };
const personal = { district: district.id, area: "plots", placing: null, selected: null, choice: null, spot: null, project: false };
const publicMode = { ...personal, area: "public", project: true };
const noop = () => {};
const dockProps = { mine, land: district, build: personal, setBuild: noop, onClose: noop, onFocus: noop };
function render(Component, props) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(Component, props)));
  client.clear();
  return html;
}

test("complex shows whole-land growth and the server's exact remaining count", () => {
  const html = render(DistrictLandmarkCard, { landmark });
  assert.match(html, /Дом команды/);
  assert.match(html, /Главное здание района/);
  assert.match(html, /Дом команды · уровень 2 из 5/);
  assert.match(html, /Застроено 12 % района/);
  assert.match(html, /24 из 200 клеток/);
  assert.match(html, /застройте ещё 26 клеток/);
  // Buildings make the district grow; its roads and trees do not.
  assert.match(html, /Дороги, деревья и фонари в застройку не входят/);
  assert.match(html, /Дом занимает 3 × 3 клетки, офис и сквер — 2 × 2/);
  assert.match(html, /Уровень 3 открывается при застройке 25 % всего района/);
  assert.match(html, /aria-label="Застройка района для роста главного здания"[^>]+aria-valuenow="12"/);
  assert.match(html, /Растёт автоматически/);
  assert.match(html, /Одно главное здание стоит в центре района/);
  assert.doesNotMatch(html, /рядом со штабом/);
});

test("complex retains achieved level even when current land occupancy falls", () => {
  const transferred = { ...landmark, level: 4, name: "Комплекс команды", taken: 10, peak: 110,
    next: { level: 5, name: "Городской комплекс", need: 150, remaining: 140, percent: 75 } };
  const html = render(DistrictLandmarkCard, { landmark: transferred });
  assert.match(html, /уровень 4 из 5/);
  assert.match(html, /Застроено 5 % района/);
  assert.match(html, /застройте ещё 140 клеток/);
  assert.match(html, /Достигнутый уровень сохраняется/);
  const maximum = render(DistrictLandmarkCard, { landmark: { ...landmark, level: 5, name: "Городской комплекс", next: null } });
  assert.match(maximum, /Главное здание достигло максимального уровня/);
  assert.doesNotMatch(maximum, /застройте ещё|Уровень 6/);
});

test("active complex replaces district project actions while personal building remains available", () => {
  const html = render(CityDistrictSheet, { district, team, cityName: "Техподдержка", mine, onMyEstate: noop, onOpenProject: noop });
  assert.match(html, /Строить в районе →/);
  assert.match(html, /Развитие главного здания района/);
  assert.match(html, /Вся земля доступна сразу/);
  assert.doesNotMatch(html, /Создать общий проект|Штаб:|построено общих проектов|Сейчас нет открытых сборов|Взносы добровольные/);
});

test("legacy squares retain paid project controls beside the same growing main building", () => {
  const legacy = { ...district, landmark: { ...landmark, status: "legacy_occupied" }, projects: [{ id: 9, family: "fountain", name: "Фонтан", level: 1, level_name: "Фонтан", target_id: null, cost: 1000, status: "open", mine: 0, version: 1, progress: 25, module: 0, u: 0, v: 0, w: 2, h: 2, rotation: 0 }] };
  const html = render(CityDistrictSheet, { district: legacy, team, cityName: "Техподдержка", mine, onMyEstate: noop, onOpenProject: noop });
  assert.match(html, /Создать общий проект/);
  assert.doesNotMatch(html, /Штаб:|построено общих проектов/);
  assert.match(html, /Фонтан/);
  assert.match(html, /Сколько внести/);
  assert.match(html, /прежние общие постройки и сборы/);
  assert.match(html, /Развитие главного здания района/);
  assert.equal((html.match(/Главное здание района<\/h2>/g) ?? []).length, 1);
});

test("all land opens at once with one main-building progress and active public mode never opens projects", () => {
  assert.doesNotMatch(render(CityEstateDock, dockProps), /role="progressbar"/, "the land waits in the district tab");
  const overview = render(DistrictTab, { land: district, onShow: noop });
  assert.match(overview, /aria-label="Земля района"/);
  assert.match(overview, /Весь район открыт/);
  assert.match(overview, /Свободно 176 клеток/);
  assert.match(overview, /aria-label="Развитие главного здания района"/);
  assert.doesNotMatch(overview, /Этап застройки|осталось занять ещё|70 %|рядом со штабом/);
  assert.equal((overview.match(/role="progressbar"/g) ?? []).length, 1);
  assert.match(overview, /застройте ещё 26 клеток/);
  const stalePlacing = { ...publicMode, placing: { family: "fountain", moving: null, rotation: 0 }, spot: { module: 0, u: 0, v: 0, rotation: 0, problem: null } };
  for (const build of [publicMode, stalePlacing]) {
    const html = render(CityEstateDock, { ...dockProps, build });
    assert.match(html, /Дом команды/);
    assert.doesNotMatch(html, /Что построить вместе|Открыть сбор|Смета|Площадь с фонтаном/);
  }
});

test("sandbox public mode changes complex levels and keeps personal house buying separate", () => {
  const base = { city: "support", state: { city: "support", sandbox: true, districts: [district] }, mine, setBuild: noop, onClose: noop, onFocus: noop };
  const html = render(CitySandboxDock, { ...base, build: publicMode });
  assert.match(html, /aria-label="Уровень главного здания"/);
  assert.match(html, /Уровень главного здания: меньше/);
  assert.match(html, /Уровень главного здания: больше/);
  assert.doesNotMatch(html, /Открыть проект|Общие проекты на площади|Выбрать место|Ступень штаба|Этап застройки/);
  const maximum = render(CitySandboxDock, { ...base, state: { ...base.state, districts: [{ ...district, landmark: { ...landmark, level: 5, next: null } }] }, build: publicMode });
  assert.match(maximum, /disabled=""[^>]+aria-label="Уровень главного здания: больше"/);
  const cell = (block, band) => ({ block, col: 1, row: 1, band, state: "free" });
  const selected = render(CitySandboxDock, { ...base, build: { ...personal, choice: { cells: [cell(1, 1)], shape: "cell", family: null, rotation: 0, every: 1, at: null } } });
  assert.match(selected, /aria-label="Дом: 3 × 3 клетки, бесплатно"/);
  assert.match(selected, /<strong>Выбрано: 1 клетка<\/strong>/);
  assert.doesNotMatch(selected, /aria-label="Уровень главного здания"/);
  const outer = render(CitySandboxDock, { ...base, build: { ...personal, choice: { cells: [cell(5, 2)], shape: "cell", family: "house", rotation: 0, every: 1, at: { col: 0, row: 0, problem: null } } } });
  assert.match(outer, /<button type="button" class="city-action">Построить бесплатно<\/button>/);
  assert.doesNotMatch(outer, /Открыть этап|Этап застройки|Проверка этапов/);
  const overview = render(CitySandboxDock, { ...base, build: personal });
  assert.match(overview, /Весь район открыт/);
  assert.doesNotMatch(overview, /Проверка этапов|Этап застройки|Ступень штаба/);
});

test("sandbox legacy projects remain available while the central main building has its own level controls", () => {
  const legacy = { ...district, landmark: { ...landmark, status: "legacy_occupied" } };
  const html = render(CitySandboxDock, { city: "support", state: { city: "support", sandbox: true, districts: [legacy] }, mine, build: publicMode, setBuild: noop, onClose: noop, onFocus: noop });
  assert.match(html, /Развитие главного здания района/);
  assert.match(html, /Уровень главного здания: больше/);
  assert.match(html, /Общие проекты на площади/);
  assert.match(html, /Площадь с фонтаном/);
  assert.doesNotMatch(html, /Ступень штаба|Проверка этапов|Открыть этап/);
});
