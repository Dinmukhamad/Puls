import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const built = await build({ entryPoints: [fileURLToPath(new URL("./CityEstateDock.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
const { CityEstateDock } = module.exports;
const noop = () => {};
const catalogue = [{ family: "square", name: "Сквер", icon: "🌳", ready: false, size: [1, 1], squares: null, levels: [{ level: 1, name: "Сквер", about: "Зелёный сквер", price: 20 }] }];
const land = { id: "support-team-1", name: "Район команды", number: 1, mine: true, managed: false, construction: true, land: { cells: 12, taken: 0, built: 0, open_band: 1, bands: [{ band: 1, cells: 12, taken: 0 }] }, projects: [], objects: [], version: 1 };
const decor = [{ family: "road", name: "Дорога", icon: "🛣️", about: "Клетка дороги.", price: 5 }, { family: "lamp", name: "Фонарь", icon: "💡", about: "Вечером зажигается.", price: 15 }];
const mine = { status: "ready", message: null, district: { id: land.id, name: land.name, city: "support" }, objects: [], catalogue, projects: [], land_prices: [100], economy_revision: 1, balance: 200, available: 200, legacy: { count: 0, paid: 0 }, managed: [] };
const overview = { district: land.id, area: "plots", placing: null, selected: null, plot: null, spot: null, project: false };
function render(patch = {}) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(CityEstateDock, { mine, land, build: overview, setBuild: noop, onClose: noop, onFocus: noop, onChooseFree: noop, ...patch })));
  client.clear();
  return html;
}

test("ready overview directs operators to any visible free cell and keeps automatic selection as an optional fallback", () => {
  const html = render();
  assert.match(html, /<h2 class="estate-step-title">Спланируй свой район<\/h2>/);
  assert.match(html, /Нажми на свободную клетку и выбери, что на ней построить: дом займёт 3 × 3 клетки, офис и сквер — 2 × 2\. Место покажется на карте: зелёные клетки свободны, красные заняты/);
  assert.match(html, /На карте свободные клетки района зелёные, занятые — серые/);
  assert.match(html, /<button type="button" class="city-secondary estate-choose-free">Подобрать место для дома<\/button>/);
  const steps = html.match(/<ol class="estate-steps">(.*?)<\/ol>/s)?.[1];
  assert.equal((steps?.match(/<li>/g) ?? []).length, 3);
  const manual = render({ onChooseFree: undefined });
  assert.match(manual, /Нажми на свободную клетку/);
  assert.match(manual, /свободные клетки района зелёные/);
  assert.doesNotMatch(manual, /estate-choose-free/);
  // The small things, a tool each with its price a cell; none to take away yet.
  const tools = render({ mine: { ...mine, decor } });
  assert.match(tools, /<section class="estate-section" aria-label="Дороги и благоустройство"><h3>Дороги и благоустройство<\/h3>/);
  assert.match(tools, /aria-label="Дорога: 5 коинов за клетку"[^>]*><span class="estate-tools__icon" aria-hidden="true">🛣️<\/span><strong>Дорога<\/strong><small>◈ 5<\/small>/);
  assert.match(tools, /aria-label="Фонарь: 15 коинов за клетку"/);
  assert.doesNotMatch(tools, /Убрать своё/);
  const own = render({ mine: { ...mine, decor }, land: { ...land, decor: { road: [[1, 0, 0, 1], [1, 1, 0, 1], [1, 2, 0, 0]], lamp: [[1, 3, 1, 1]] } } });
  assert.match(own, />Убрать своё · 3 клетки<\/button>/);
});

test("map and district loading keep the dock visible without instructing operators to click unavailable cells", () => {
  for (const props of [{ mapStatus: "loading" }, { loadingLand: true }, { land: null }, { land: { ...land, land: null } }]) {
    const html = render(props);
    assert.match(html, /aria-label="Стройка в районе"/);
    assert.match(html, /role="status">Загружаем карту и свободные клетки района…/);
    assert.doesNotMatch(html, /нажми на свободную клетку|клетки района зелёные|estate-steps|estate-choose-free|Весь район открыт|Дороги и благоустройство/i);
    assert.match(html, /<button[^>]+disabled="">Показать район на карте<\/button>/);
  }
});

test("map failures offer a map retry without claiming the grid is available", () => {
  const html = render({ mapStatus: "failed", onRetryMap: noop });
  assert.match(html, /role="alert">Не удалось загрузить карту района/);
  assert.match(html, /<button type="button" class="city-secondary">Повторить загрузку карты<\/button>/);
  assert.doesNotMatch(html, /Повторить загрузку земли|клетки района зелёные|нажми на свободную клетку|estate-choose-free/i);
});

test("land failures offer a land retry even when previously loaded district data remains cached", () => {
  for (const district of [null, land]) {
    const html = render({ land: district, landError: new Error("Land request failed"), onRetryLand: noop });
    assert.match(html, /role="alert">Не удалось загрузить свободные клетки района/);
    assert.match(html, /<button type="button" class="city-secondary">Повторить загрузку земли<\/button>/);
    assert.doesNotMatch(html, /Повторить загрузку карты|Land request failed|клетки района зелёные|нажми на свободную клетку|estate-choose-free/i);
  }
});

test("map and land recover independently and ready data restores direct map guidance", () => {
  const failed = render({ mapStatus: "failed", landError: new Error("Offline"), onRetryMap: noop, onRetryLand: noop });
  assert.match(failed, /Повторить загрузку карты/);
  assert.match(failed, /Повторить загрузку земли/);
  assert.equal((failed.match(/role="alert"/g) ?? []).length, 2);
  const recovered = render({ mapStatus: "ready", loadingLand: false, landError: null });
  assert.match(recovered, /Нажми на свободную клетку/);
  assert.match(recovered, /свободные клетки района зелёные/);
  assert.doesNotMatch(recovered, /Загружаем карту|Повторить загрузку/);
});

test("closed construction cannot select a purchase plot, and full land explains the next available action", () => {
  const closed = render({ mine: { ...mine, status: "closed", message: "Стройка в районе пока закрыта." } });
  assert.doesNotMatch(closed, /estate-choose-free/);
  assert.match(closed, /Стройка в районе пока закрыта/);
  const full = render({ land: { ...land, land: { ...land.land, taken: 12 } }, onChooseFree: undefined });
  assert.doesNotMatch(full, /estate-choose-free/);
  assert.match(full, /Вся земля района занята\. Открой свою постройку/);
});

test("a picked cell offers everything with its cells and price; the chosen one shows on the map and buys only when it fits", () => {
  const cell = { block: 1, col: 4, row: 2, band: 1, problem: null, rotation: 0, family: null, at: null }, rich = { ...mine, available: 1000, decor };
  const html = render({ mine: rich, build: { ...overview, plot: cell } });
  assert.match(html, /<h2>Клетка выбрана<\/h2><small>Зона 1 · земля ◈ 100 за клетку<\/small>/);
  assert.match(html, /место покажется на карте вокруг выбранной клетки — зелёные клетки свободны, красные заняты/);
  // A square takes 2 × 2 cells: four cells of land and the square; a road one cell, its land in its price.
  assert.match(html, /<strong>Сквер<\/strong><small>2 × 2 клетки · ◈ 420<\/small>/);
  assert.match(html, /<strong>Дорога<\/strong><small>1 клетка · ◈ 5<\/small>/);
  assert.match(html, /aria-label="Сквер: 2 × 2 клетки, ◈ 420\. Показать место на карте">Выбрать<\/button>/);
  assert.doesNotMatch(html, /Купить ·|estate-choose-free/);
  // Chosen: while the map works out where it goes, nothing to buy yet.
  const waiting = render({ mine: rich, build: { ...overview, plot: { ...cell, family: "square" } } });
  assert.match(waiting, /class="estate-catalogue__chosen"/);
  assert.match(waiting, /Показываем место на карте…/);
  assert.match(waiting, /Земля 4 × ◈ 100 = ◈ 400 \+ сквер ◈ 20/);
  assert.match(waiting, /disabled="">Купить · ◈ 420<\/button>/);
  // It fits: bought at once with the price on the button.
  const fits = render({ mine: rich, build: { ...overview, plot: { ...cell, family: "square", at: { col: 3, row: 2, problem: null } } } });
  assert.match(fits, /Место свободно: клетки на карте зелёные\./);
  assert.match(fits, /<button type="button" class="city-action">Купить · ◈ 420<\/button>/);
  // It does not: the map's reason, and no purchase.
  const blocked = render({ mine: rich, build: { ...overview, plot: { ...cell, family: "square", at: { col: 3, row: 2, problem: "Не помещается: 2 клетки из 4 заняты — они красные на карте." } } } });
  assert.match(blocked, /role="alert">Не помещается: 2 клетки из 4 заняты — они красные на карте\./);
  assert.match(blocked, /disabled="">Купить · ◈ 420<\/button>/);
  // Not enough coins; a taken cell says so.
  const poor = render({ build: { ...overview, plot: { ...cell, family: "square", at: { col: 3, row: 2, problem: null } } } });
  assert.match(poor, /disabled="">Не хватает 220<\/button>/);
  const taken = render({ mine: rich, build: { ...overview, plot: { ...cell, problem: "Эта клетка уже занята" } } });
  assert.match(taken, /<h2>Клетка занята<\/h2>/);
  assert.match(taken, /Эта клетка уже занята\./);
});

test("automatic purchase selection does not appear during inventory placement, project placement, or an owned building card", () => {
  const own = { id: 5, family: "square", level: 1, state: "placed", owner: "mine", district_id: land.id, source: "purchase", paid: 120, version: 1, squares: 1, module: 1, u: 0, v: 0, w: 3, h: 3, rotation: 0 };
  const inventory = render({ mine: { ...mine, objects: [{ ...own, state: "stored" }] }, build: { ...overview, placing: { family: "square", rotation: 0, moving: own.id } } });
  const owned = render({ mine: { ...mine, objects: [own] }, build: { ...overview, selected: own.id } });
  const project = render({ build: { ...overview, area: "public", project: true } });
  for (const html of [inventory, owned, project]) assert.doesNotMatch(html, /estate-choose-free/);
  assert.match(inventory, /бесплатно, вместе с землёй/);
  assert.match(owned, /твоя постройка/);
});

test("transfer to another ready district disables purchases and automatic selection in the previous dock", () => {
  const transferred = { ...mine, district: { id: "sales-team-2", name: "Новый район", city: "sales" } };
  const oldOverview = render({ mine: transferred });
  assert.doesNotMatch(oldOverview, /estate-choose-free/);
  const oldPlot = render({ mine: { ...transferred, available: 1000 }, build: { ...overview, plot: { block: 1, col: 0, row: 0, band: 1, problem: null, rotation: 0, family: "square", at: { col: 0, row: 0, problem: null } } } });
  const buy = oldPlot.match(/<button type="button" class="city-action"[^>]*>Купить · ◈ 420<\/button>/)?.[0];
  assert.ok(buy, "the chosen building still displays its price while the previous dock is being closed");
  assert.match(buy, /disabled=""/);
});

test("laying small things: the cells chosen, what they cost with the land, and only what one can pay for", () => {
  const cells = [{ block: 1, col: 0, row: 0 }, { block: 1, col: 1, row: 0 }, { block: 1, col: 2, row: 0 }];
  const road = { tool: "road", cells, shape: "line" }, base = { mine: { ...mine, decor, decor_batch: 400 } };
  const html = render({ ...base, build: { ...overview, decor: road } });
  assert.match(html, /<h2>Дорога<\/h2><small>◈ 5 за клетку · земля включена<\/small>/);
  // How taps choose cells: one at a time, by lines (a road's way at first) or by areas; Ctrl with the mouse draws an area.
  assert.match(html, /<div class="estate-shape" role="radiogroup" aria-label="Как выбирать клетки"><button type="button" role="radio" aria-checked="false">Клетка<\/button><button type="button" role="radio" aria-checked="true">Линия<\/button><button type="button" role="radio" aria-checked="false">Область<\/button><\/div>/);
  assert.match(html, /Каждое нажатие продолжает линию от прошлой клетки\./);
  assert.match(html, /С зажатым <kbd>Ctrl<\/kbd> протяни мышью левой или правой кнопкой — выделится прямоугольник\./);
  const grove = render({ ...base, build: { ...overview, decor: { tool: "road", cells, shape: "area" } } });
  assert.match(grove, /aria-checked="true">Область<\/button>/);
  assert.match(grove, /Нажми на один угол, потом на другой — выберется прямоугольник между ними: дорога в две-три клетки шириной, роща, площадь\./);
  assert.match(html, /<p class="estate-ok">Выбрано: 3 клетки · ◈ 15<\/p>/);
  assert.match(html, /<button type="button" class="city-action">Построить · ◈ 15<\/button>/);
  assert.match(html, />Сбросить выбор<\/button>/);
  // While choosing, the dock offers no other building and no camera jump to the whole district.
  assert.doesNotMatch(html, /Показать район на карте|estate-choose-free|Спланируй свой район/);
  const none = render({ ...base, build: { ...overview, decor: { ...road, cells: [] } } });
  assert.match(none, /Клетки ещё не выбраны/);
  assert.match(none, /disabled="">Построить · ◈ 0<\/button>/);
  assert.doesNotMatch(none, /Сбросить выбор/);
  const poor = render({ mine: { ...base.mine, available: 12 }, build: { ...overview, decor: road } });
  assert.match(poor, /disabled="">Не хватает 3<\/button>/);
  const many = render({ mine: { ...base.mine, decor_batch: 2 }, build: { ...overview, decor: road } });
  assert.match(many, /role="alert">За раз можно выбрать не больше 2 клеток\./);
  assert.match(many, /disabled="">Построить · ◈ 15<\/button>/);
  // Taking away: one's own only, the coins come back.
  const away = render({ ...base, build: { ...overview, decor: { tool: "remove", cells: cells.slice(0, 2), shape: "cell" } } });
  assert.match(away, /<h2>Убрать своё<\/h2><small>Своё и общее района: за своё коины вернутся<\/small>/);
  assert.match(away, /Выбрано: 2 клетки<\/p>/);
  assert.match(away, /<button type="button" class="city-action">Убрать выбранное<\/button>/);
  assert.match(away, /Убрать можно своё и общее района — то, что осталось от операторов, перешедших в другой район\./);
  // A closed district shows why and lays nothing.
  const closed = render({ mine: { ...base.mine, status: "closed", message: "Стройка в районе пока закрыта." }, build: { ...overview, decor: road } });
  assert.match(closed, /Стройка в районе пока закрыта\./);
  assert.match(closed, /disabled="">Построить · ◈ 15<\/button>/);
});
