import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const built = await build({ entryPoints: [fileURLToPath(new URL("./CityEstateDock.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
const { CityEstateDock, DistrictTab } = module.exports;
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
const renderTab = district => renderToStaticMarkup(React.createElement(DistrictTab, { land: district, onShow: noop }));
function render(patch = {}) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(CityEstateDock, { mine, land, build: overview, setBuild: noop, onClose: noop, onFocus: noop, onChooseFree: noop, ...patch })));
  client.clear();
  return html;
}

test("the shop goes what → where → buy: seven tabs of pictures first, then the place on the map, then the price", () => {
  const html = render({ mine: { ...mine, decor } });
  // Three sections of the dock; building first.
  assert.match(html, /role="radiogroup" aria-label="Разделы стройки"><button[^>]+aria-checked="true"[^>]*>Строить<\/button><button[^>]+>Мои постройки<\/button><button[^>]+>Район<\/button><\/div>/);
  assert.match(html, /<h3 class="estate-step"><span aria-hidden="true">1<\/span>Что построить\?<\/h3>/);
  // Seven tabs, houses first; each thing with a picture of its model, loaded when it shows, its size and price.
  const tabs = html.match(/<div class="estate-shop__tabs" role="tablist"[^>]*>(.*?)<\/div>/s)?.[1] ?? "";
  assert.deepEqual([...tabs.matchAll(/<\/span>([^<]+)<\/button>/g)].map(m => m[1]), ["Дома", "Офисы", "Скверы", "Дороги", "Деревья", "Фонари и скамейки", "Кусты и клумбы"]);
  assert.match(tabs, /aria-selected="true"><span aria-hidden="true">🏡<\/span>Дома/);
  assert.match(html, /<img src="\/city\/shop\/v1\/house\.webp" alt="" loading="lazy" decoding="async" width="160" height="120"\/><strong>Дом<\/strong><small>3 × 3 клетки · от\s◈\s1\s020<\/small><small>растёт до 2 ступеней<\/small>/);
  // Nothing about the map, shapes, keys or buying until something is chosen.
  assert.doesNotMatch(html, /Где поставить|Как выбирать клетки|Ctrl|estate-choose-free|Убрать своё|Выбрано:|class="city-action"|Показать весь район/);
  // A house chosen: what is built, where it goes, and the purchase waiting for the place.
  const house = render({ mine: { ...mine, decor }, build: { ...overview, choice: choice({ family: "house" }) } });
  assert.match(house, /<div class="estate-chosen"><img[^>]+\/><div><small>Строим<\/small><strong>Дом<\/strong><span>3 × 3 клетки<\/span><b>от\s◈\s1\s020<\/b><\/div><button type="button" class="estate-chosen__change">Сменить<\/button><\/div>/);
  assert.match(house, /<span aria-hidden="true">2<\/span>Где поставить\?<\/h3>/);
  assert.match(house, /<p class="estate-hint">Нажми на карте клетку — дом встанет вокруг неё и займёт 3 × 3 клетки\.<\/p><button type="button" class="city-secondary estate-choose-free">Подобрать свободное место<\/button>/);
  assert.match(house, /<span aria-hidden="true">3<\/span>Купить<\/h3><button type="button" class="city-action" disabled="">Сначала выбери место на карте<\/button>/);
  assert.doesNotMatch(house, /role="tablist"|Как выбирать клетки|Ctrl/);
  const manual = render({ onChooseFree: undefined, build: { ...overview, choice: choice({ family: "house" }) } });
  assert.match(manual, /Нажми на карте клетку/);
  assert.doesNotMatch(manual, /estate-choose-free/);
  // A small thing goes along a line by default; areas and single cells are a tap away, the mouse keys under a fold.
  const road = render({ mine: { ...mine, decor }, build: { ...overview, choice: choice({ family: "road", shape: "line" }) } });
  assert.match(road, /<div class="estate-shape" role="radiogroup" aria-label="Как выбирать клетки"><button type="button" role="radio" aria-checked="true">Линией<\/button><button type="button" role="radio" aria-checked="false">Областью<\/button><button type="button" role="radio" aria-checked="false">По клетке<\/button><\/div>/);
  assert.match(road, /<p class="estate-hint">Нажми на начало и на конец — выберутся все клетки между ними\. Мышью можно просто провести\.<\/p>/);
  assert.match(road, /<details class="estate-tips estate-tip--mouse"><summary>Подсказки для мыши<\/summary><p><kbd>Ctrl<\/kbd> \+ протянуть — добавить прямоугольник; <kbd>Ctrl<\/kbd> \+ клик — добавить или убрать клетку; <kbd>Shift<\/kbd> \+ протянуть — добавить ещё линию\. Камера: ↺ ↻ внизу карты или средняя кнопка мыши — повернуть, колесо — масштаб, WASD — двигать\.<\/p><\/details>/);
  assert.match(road, /disabled="">Сначала выбери клетки на карте<\/button>/);
  const areas = render({ mine: { ...mine, decor }, build: { ...overview, choice: choice({ family: "road", shape: "area" }) } });
  assert.match(areas, /aria-checked="true">Областью<\/button>/);
  assert.match(areas, /Нажми на один угол и на противоположный — выберется прямоугольник: широкая дорога, роща, площадь\./);
});

test("map and district loading keep the dock visible without instructing operators to click unavailable cells", () => {
  for (const props of [{ mapStatus: "loading" }, { loadingLand: true }, { land: null }, { land: { ...land, land: null } }]) {
    const html = render(props);
    assert.match(html, /aria-label="Стройка в районе"/);
    assert.match(html, /role="status">Загружаем карту и свободные клетки района…/);
    assert.match(html, /aria-label="Разделы стройки"/);
    assert.doesNotMatch(html, /estate-shop|нажми на свободную клетку|клетки района зелёные|estate-steps|estate-choose-free|Весь район открыт/i);
  }
  // The district tab waits for the land too.
  const waiting = renderTab(null);
  assert.match(waiting, /<button type="button" class="city-secondary" disabled="">Показать весь район на карте<\/button>/);
  assert.doesNotMatch(waiting, /Весь район открыт|role="progressbar"/);
  assert.match(renderTab(land), /Весь район открыт[\s\S]*<button type="button" class="city-secondary">Показать весь район на карте<\/button>/);
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
  assert.match(recovered, /Что построить\?/);
  assert.match(recovered, /role="tablist"/);
  assert.doesNotMatch(recovered, /Загружаем карту|Повторить загрузку/);
});

test("closed construction cannot select a purchase plot, and full land explains the next available action", () => {
  const closed = render({ mine: { ...mine, status: "closed", message: "Стройка в районе пока закрыта." } });
  assert.doesNotMatch(closed, /estate-choose-free/);
  assert.match(closed, /Стройка в районе пока закрыта/);
  const full = render({ land: { ...land, land: { ...land.land, taken: 12 } }, onChooseFree: undefined });
  assert.doesNotMatch(full, /estate-choose-free/);
  assert.match(full, /Вся земля района занята\. Открой свою постройку во вкладке «Мои постройки»/);
  const closedHouse = render({ mine: { ...mine, status: "closed", message: "Стройка в районе пока закрыта." }, build: { ...overview, choice: choice({ family: "house" }) } });
  assert.doesNotMatch(closedHouse, /estate-choose-free/);
});

test("a building goes round the one cell chosen: its price with the land, its place on the map, bought only when it fits", () => {
  const one = cellsAt(["free"]), rich = { ...mine, available: 2000, decor };
  // A cell tapped before anything is chosen: what is chosen, then the shop with prices on that cell's land.
  const html = render({ mine: rich, build: { ...overview, choice: choice({ cells: one }) } });
  assert.match(html, /<strong>Выбрано: 1 клетка<\/strong><small>свободно 1<\/small>/);
  assert.match(html, /Выбери ниже, что на них поставить\./);
  assert.match(html, />Сбросить выбор<\/button>/);
  assert.match(html, /<strong>Дом<\/strong><small>3 × 3 клетки · ◈\s1\s020<\/small>/);
  assert.doesNotMatch(html, /Купить ·|estate-choose-free/);
  // A square chosen: no tabs now, and while the map works out where it goes, nothing to buy yet.
  const waiting = render({ mine: rich, build: { ...overview, choice: choice({ cells: one, family: "square" }) } });
  assert.match(waiting, /<strong>Сквер<\/strong><span>2 × 2 клетки<\/span><b>◈\s420<\/b>/);
  assert.doesNotMatch(waiting, /role="tablist"|Повернуть фасад/);
  assert.match(waiting, /Показываем место на карте…/);
  assert.match(waiting, /Земля 4 × ◈ 100 = ◈ 400 \+ сквер ◈ 20/);
  assert.match(waiting, /disabled="">Купить · ◈ 420<\/button>/);
  assert.match(waiting, /Четыре своих сквера вплотную квадратом \(4 × 4 клетки\) сами станут парком/);
  // It fits: bought at once with the price on the button.
  const fits = render({ mine: rich, build: { ...overview, choice: choice({ cells: one, family: "square", at: { col: 0, row: 0, problem: null } }) } });
  assert.match(fits, /<p class="estate-ok">Место свободно: клетки на карте зелёные\.<\/p>/);
  assert.match(fits, /<button type="button" class="city-action">Купить · ◈ 420<\/button>/);
  assert.match(fits, /Коины спишутся только после «Купить»/);
  // It does not: the map's reason, and no purchase.
  const blocked = render({ mine: rich, build: { ...overview, choice: choice({ cells: one, family: "square", at: { col: 0, row: 0, problem: "Не помещается: 2 клетки из 4 заняты — они красные на карте." } }) } });
  assert.match(blocked, /role="alert">Не помещается: 2 клетки из 4 заняты — они красные на карте\./);
  assert.match(blocked, /disabled="">Купить · ◈ 420<\/button>/);
  // Not enough coins; several cells chosen for a building; a house turns its front.
  const poor = render({ build: { ...overview, choice: choice({ cells: one, family: "square", at: { col: 0, row: 0, problem: null } }) } });
  assert.match(poor, /disabled="">Не хватает 220<\/button>/);
  const many = render({ mine: rich, build: { ...overview, choice: choice({ cells: cellsAt(["free", "free"]), family: "house" }) } });
  assert.match(many, /Для здания нужна одна клетка: нажми на неё на карте\. Сейчас выбрано 2 клетки\./);
  assert.match(many, /<b>от\s◈\s1\s020<\/b>/);
  assert.match(many, /disabled="">Сначала выбери место на карте<\/button>/);
  assert.doesNotMatch(many, /Повернуть фасад/);
  const house = render({ mine: rich, build: { ...overview, choice: choice({ cells: one, family: "house", at: { col: 0, row: 0, problem: null } }) } });
  assert.match(house, /<button type="button" class="city-secondary">↻ Повернуть фасад<\/button>/);
  assert.match(house, /Земля 9 × ◈ 100 = ◈ 900 \+ дом ◈ 120\./);
  assert.match(house, /<button type="button" class="city-action">Купить · ◈ 1\s020<\/button>/);
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
  const html = render({ ...base, build: { ...overview, choice: choice({ cells: line, family: "road", shape: "line" }) } });
  assert.match(html, /<strong>Дорога<\/strong><b>◈\s5 за\sклетку<\/b>/);
  assert.match(html, /<p class="estate-ok">Встанет на 3 клетки<\/p>/);
  assert.match(html, /<button type="button" class="city-action">Купить · ◈ 15<\/button>/);
  assert.match(html, />Сбросить выбор<\/button>/);
  assert.doesNotMatch(html, /Через одну/, "a road goes on every cell");
  // Nothing chosen yet: how to choose, nothing to buy.
  const none = render({ ...base, build: { ...overview, choice: choice({ family: "road", shape: "line" }) } });
  assert.match(none, /<p class="estate-note">Клетки ещё не выбраны\.<\/p>/);
  assert.match(none, /disabled="">Сначала выбери клетки на карте<\/button>/);
  assert.doesNotMatch(none, /Сбросить выбор/);
  // A lamp on every second cell of five, one of its cells taken.
  const lamps = render({ ...base, build: { ...overview, choice: choice({ cells: cellsAt(["free", "free", "taken", "free", "free"]), family: "lamp", shape: "line", every: 2 }) } });
  assert.match(lamps, /role="group" aria-label="Как часто ставить"><button type="button" aria-pressed="false">Каждую клетку<\/button><button type="button" aria-pressed="true">Через одну<\/button><button type="button" aria-pressed="false">Через две<\/button>/);
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
  assert.match(full, /На 1 клетке уже стоит твоё[\s\S]*>Убрать своё<\/button>/);
  // One's own small things on the cells chosen go away, the coins come back.
  const away = render({ ...base, build: { ...overview, choice: choice({ cells: cellsAt(["own", "free", "own", "taken"]) }) } });
  assert.match(away, /<strong>Выбрано: 4 клетки<\/strong><small>свободно 1 · своё 2 · занято 1<\/small>/);
  assert.match(away, /<button type="button" class="city-secondary">Убрать своё · 2 клетки<\/button>/);
  // A closed district shows why and lays nothing.
  const closed = render({ mine: { ...base.mine, status: "closed", message: "Стройка в районе пока закрыта." }, build: { ...overview, choice: choice({ cells: line, family: "road" }) } });
  assert.match(closed, /Стройка в районе пока закрыта\./);
  assert.match(closed, /disabled="">Купить · ◈ 15<\/button>/);
});

test("while building the map keeps turning: ↺ ↻ on the map, and the middle button turns the camera", () => {
  const map = readFileSync(new URL("./CityMap.tsx", import.meta.url), "utf8"), engine = readFileSync(new URL("../../city3d/index.ts", import.meta.url), "utf8");
  assert.match(map, /\{live && build && <div className="city-turn glass glass--regular" role="group" aria-label="Повернуть карту">/);
  assert.match(map, /aria-label="Повернуть карту против часовой стрелки"[^>]*onClick=\{\(\) => control\.current\?\.rotate\(-TURN\)\}>↺<\/button>/);
  assert.match(map, /aria-label="Повернуть карту по часовой стрелке"[^>]*onClick=\{\(\) => control\.current\?\.rotate\(TURN\)\}>↻<\/button>/);
  // The camera learns of build mode when the city starts and whenever it changes.
  assert.match(engine, /rig\.setActive\(active\); rig\.setBuilding\(!!buildView\);/);
  assert.match(engine, /setBuild\(view\) \{[^\n]*parts\?\.rig\.setBuilding\(!!view\); \}/);
});
