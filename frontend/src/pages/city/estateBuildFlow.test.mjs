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
const catalogue = [
  { family: "square", name: "Сквер", icon: "🌳", ready: false, size: [2, 2], squares: null, levels: [{ level: 1, name: "Сквер", about: "Зелёный сквер", price: 20 }] },
  { family: "house", name: "Дом", icon: "🏡", ready: false, size: [3, 3], squares: null, levels: [{ level: 1, name: "Одноэтажный дом", about: "Небольшой дом", price: 120 }, { level: 2, name: "Двухэтажный дом", about: "Второй этаж", price: 180 }] },
];
const land = { id: "support-team-1", name: "Район команды", number: 1, mine: true, managed: false, construction: true, land: { cells: 12, taken: 0, built: 0, open_band: 1, bands: [{ band: 1, cells: 12, taken: 0 }] }, projects: [], objects: [], version: 1 };
const decor = [{ family: "road", name: "Дорога", icon: "🛣️", about: "Клетка дороги.", price: 5 }, { family: "lamp", name: "Фонарь", icon: "💡", about: "Вечером зажигается.", price: 15 }];
const mine = { status: "ready", message: null, district: { id: land.id, name: land.name, city: "support" }, objects: [], catalogue, projects: [], land_prices: [100], economy_revision: 1, balance: 200, available: 200, legacy: { count: 0, paid: 0 }, managed: [] };
const overview = { district: land.id, area: "plots", placing: null, selected: null, choice: null, spot: null, project: false };
/** Cells chosen on the map, free unless said, with what the shop chose for them. */
const cellsAt = (states, row = 0) => states.map((state, col) => ({ block: 1, col, row, band: 1, state }));
const choice = (patch = {}) => ({ cells: [], shape: "cell", family: null, rotation: 0, every: 1, at: null, ...patch });
function render(patch = {}) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(CityEstateDock, { mine, land, build: overview, setBuild: noop, onClose: noop, onFocus: noop, onChooseFree: noop, ...patch })));
  client.clear();
  return html;
}

test("the shop opens on choosing cells on the map, its tabs, and an automatic choice for a house as a fallback", () => {
  const html = render({ mine: { ...mine, decor } });
  assert.match(html, /Выбери место на карте: нажми на клетку или проведи по клеткам левой кнопкой мыши — получится линия\. Камера: правая кнопка мыши, колесо и WASD, на телефоне — двумя пальцами\./);
  // With the mouse, Ctrl adds areas and cells; on a phone the taps go as «Клетка / Линия / Область» says.
  assert.match(html, /<p class="estate-tip estate-tip--mouse"><kbd>Ctrl<\/kbd> \+ протянуть мышью — добавить прямоугольник: дорогу в две-три клетки шириной, рощу; <kbd>Ctrl<\/kbd> \+ клик — добавить или убрать клетку; <kbd>Shift<\/kbd> \+ протянуть — добавить ещё линию\.<\/p>/);
  assert.match(html, /<div class="estate-shape" role="radiogroup" aria-label="Что делает нажатие"><button type="button" role="radio" aria-checked="true">Клетка<\/button><button type="button" role="radio" aria-checked="false">Линия<\/button><button type="button" role="radio" aria-checked="false">Область<\/button><\/div>/);
  assert.match(html, /<p class="secondary small estate-shape__hint">Нажатие выбирает одну клетку\.<\/p>/);
  const areas = render({ mine: { ...mine, decor }, build: { ...overview, choice: choice({ shape: "area" }) } });
  assert.match(areas, /aria-checked="true">Область<\/button>/);
  assert.match(areas, /Нажми на один угол, потом на другой — добавится прямоугольник между ними: дорога в две-три клетки шириной, роща, площадь\./);
  assert.match(html, /<button type="button" class="city-secondary estate-choose-free">Подобрать место для дома<\/button>/);
  // Seven tabs, houses first; each thing with a picture of its model, loaded when it shows, its size and price.
  const tabs = html.match(/<div class="estate-shop__tabs" role="tablist"[^>]*>(.*?)<\/div>/s)?.[1] ?? "";
  assert.deepEqual([...tabs.matchAll(/<\/span>([^<]+)<\/button>/g)].map(m => m[1]), ["Дома", "Офисы", "Скверы", "Дороги", "Деревья", "Фонари и скамейки", "Кусты и клумбы"]);
  assert.match(tabs, /aria-selected="true"><span aria-hidden="true">🏡<\/span>Дома/);
  assert.match(html, /<img src="\/city\/shop\/v1\/house\.webp" alt="" loading="lazy" decoding="async" width="160" height="120"\/><strong>Дом<\/strong><small>3 × 3 клетки · от ◈ 1\s020<\/small><small>растёт до 2 ступеней<\/small>/);
  assert.doesNotMatch(html, /Убрать своё|Выбрано:|class="city-action"/);
  const manual = render({ onChooseFree: undefined });
  assert.match(manual, /Выбери место на карте/);
  assert.doesNotMatch(manual, /estate-choose-free/);
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
  assert.match(recovered, /Выбери место на карте/);
  assert.match(recovered, /role="tablist"/);
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

test("a building goes round the one cell chosen: its price with the land, its place on the map, bought only when it fits", () => {
  const one = cellsAt(["free"]), rich = { ...mine, available: 2000, decor };
  const html = render({ mine: rich, build: { ...overview, choice: choice({ cells: one }) } });
  assert.match(html, /<strong>Выбрано: 1 клетка<\/strong><small>свободно 1<\/small>/);
  assert.match(html, />Сбросить выбор<\/button>/);
  // The price on the cell's land: nine cells of it under a house and the house.
  assert.match(html, /<strong>Дом<\/strong><small>3 × 3 клетки · ◈ 1\s020<\/small>/);
  assert.doesNotMatch(html, /Купить ·|estate-choose-free/);
  // A square chosen: its tab, and while the map works out where it goes, nothing to buy yet.
  const waiting = render({ mine: rich, build: { ...overview, choice: choice({ cells: one, family: "square" }) } });
  assert.match(waiting, /aria-selected="true"><span aria-hidden="true">🌳<\/span>Скверы/);
  assert.match(waiting, /aria-pressed="true" title="Зелёный сквер"/);
  assert.match(waiting, /Показываем место на карте…/);
  assert.match(waiting, /Земля 4 × ◈ 100 = ◈ 400 \+ сквер ◈ 20/);
  assert.match(waiting, /disabled="">Купить · ◈ 420<\/button>/);
  assert.match(waiting, /Четыре своих сквера вплотную квадратом \(4 × 4 клетки\) сами станут парком/);
  // It fits: bought at once with the price on the button.
  const fits = render({ mine: rich, build: { ...overview, choice: choice({ cells: one, family: "square", at: { col: 0, row: 0, problem: null } }) } });
  assert.match(fits, /Место свободно: клетки на карте зелёные\./);
  assert.match(fits, /<button type="button" class="city-action">Купить · ◈ 420<\/button>/);
  // It does not: the map's reason, and no purchase.
  const blocked = render({ mine: rich, build: { ...overview, choice: choice({ cells: one, family: "square", at: { col: 0, row: 0, problem: "Не помещается: 2 клетки из 4 заняты — они красные на карте." } }) } });
  assert.match(blocked, /role="alert">Не помещается: 2 клетки из 4 заняты — они красные на карте\./);
  assert.match(blocked, /disabled="">Купить · ◈ 420<\/button>/);
  // Not enough coins; several cells chosen for a building; a house turns its front.
  const poor = render({ build: { ...overview, choice: choice({ cells: one, family: "square", at: { col: 0, row: 0, problem: null } }) } });
  assert.match(poor, /disabled="">Не хватает 220<\/button>/);
  const many = render({ mine: rich, build: { ...overview, choice: choice({ cells: cellsAt(["free", "free"]), family: "house" }) } });
  assert.match(many, /Для здания нужна одна клетка: нажми на неё на карте\. Сейчас выбрано 2 клетки\./);
  assert.match(many, /<strong>Дом<\/strong><small>3 × 3 клетки · от ◈ 1\s020<\/small>/);
  assert.doesNotMatch(many, /Повернуть фасад/);
  const house = render({ mine: rich, build: { ...overview, choice: choice({ cells: one, family: "house", at: { col: 0, row: 0, problem: null } }) } });
  assert.match(house, />Повернуть фасад<\/button><button type="button" class="city-action">Купить · ◈ 1\s020<\/button>/);
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
  const oldPlot = render({ mine: { ...transferred, available: 1000 }, build: { ...overview, choice: choice({ cells: cellsAt(["free"]), family: "square", at: { col: 0, row: 0, problem: null } }) } });
  const buy = oldPlot.match(/<button type="button" class="city-action"[^>]*>Купить · ◈ 420<\/button>/)?.[0];
  assert.ok(buy, "the chosen building still displays its price while the previous dock is being closed");
  assert.match(buy, /disabled=""/);
});

test("small things go on the free cells of the line chosen, lamps and trees also on every second or third; one's own go away", () => {
  const line = cellsAt(["free", "free", "free"]), base = { mine: { ...mine, decor, decor_batch: 400 } };
  const html = render({ ...base, build: { ...overview, choice: choice({ cells: line, family: "road" }) } });
  assert.match(html, /aria-selected="true"><span aria-hidden="true">🛣️<\/span>Дороги/);
  assert.match(html, /<h3>Дорога<\/h3><small>◈ 5 за клетку · земля включена<\/small>/);
  assert.match(html, /<strong>Выбрано: 3 клетки<\/strong><small>свободно 3<\/small>/);
  assert.match(html, /<p class="estate-ok">Встанет на 3 клетки<\/p>/);
  assert.match(html, /<button type="button" class="city-action">Купить · ◈ 15<\/button>/);
  assert.doesNotMatch(html, /Через одну/, "a road goes on every cell");
  // Nothing chosen yet: how to choose, nothing to buy.
  const none = render({ ...base, build: { ...overview, choice: choice({ family: "road" }) } });
  assert.match(none, /Выбери клетки на карте: проведи по ним левой кнопкой мыши или нажми на клетку\./);
  assert.match(none, /disabled="">Купить · ◈ 0<\/button>/);
  assert.doesNotMatch(none, /Сбросить выбор/);
  // A lamp on every second cell of five, one of its cells taken.
  const lamps = render({ ...base, build: { ...overview, choice: choice({ cells: cellsAt(["free", "free", "taken", "free", "free"]), family: "lamp", every: 2 }) } });
  assert.match(lamps, /role="group" aria-label="Как часто ставить вдоль линии"><button type="button" aria-pressed="false">На каждую клетку<\/button><button type="button" aria-pressed="true">Через одну<\/button><button type="button" aria-pressed="false">Через две<\/button>/);
  assert.match(lamps, /<p class="estate-ok">Встанет на 2 клетки · 1 занята — на неё не ставится<\/p>/);
  const one = render({ ...base, build: { ...overview, choice: choice({ cells: cellsAt(["free", "taken", "taken"]), family: "road" }) } });
  assert.match(one, /<p class="estate-ok">Встанет на 1 клетку · 2 заняты — на них не ставится<\/p>/);
  assert.match(lamps, /Купить · ◈ 30<\/button>/);
  const poor = render({ mine: { ...base.mine, available: 12 }, build: { ...overview, choice: choice({ cells: line, family: "road" }) } });
  assert.match(poor, /disabled="">Не хватает 3<\/button>/);
  const many = render({ mine: { ...base.mine, decor_batch: 2 }, build: { ...overview, choice: choice({ cells: line, family: "road" }) } });
  assert.match(many, /role="alert">За раз можно поставить не больше 2 клеток\./);
  assert.match(many, /disabled="">Купить · ◈ 15<\/button>/);
  const full = render({ ...base, build: { ...overview, choice: choice({ cells: cellsAt(["taken", "own"]), family: "road" }) } });
  assert.match(full, /role="alert">На выбранных клетках нет свободного места\./);
  // One's own small things on the cells chosen go away, the coins come back.
  const away = render({ ...base, build: { ...overview, choice: choice({ cells: cellsAt(["own", "free", "own", "taken"]) }) } });
  assert.match(away, /<strong>Выбрано: 4 клетки<\/strong><small>свободно 1 · своё 2 · занято 1<\/small>/);
  assert.match(away, /<button type="button" class="city-secondary">Убрать своё · 2 клетки<\/button>/);
  // A closed district shows why and lays nothing.
  const closed = render({ mine: { ...base.mine, status: "closed", message: "Стройка в районе пока закрыта." }, build: { ...overview, choice: choice({ cells: line, family: "road" }) } });
  assert.match(closed, /Стройка в районе пока закрыта\./);
  assert.match(closed, /disabled="">Купить · ◈ 15<\/button>/);
});
