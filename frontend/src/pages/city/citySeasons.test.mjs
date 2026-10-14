/** The city's seasons in words, and the history a viewer sees: dates, totals, their own part, the past city's button. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const built = await build({
  stdin: { contents: "export * from './seasonText.ts'; export { HistoryContent } from './CityHistory.tsx';", resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
const { HistoryContent, timeLeft, shortLeft, totalsLine, firstReset, localInput, daysText, resetsText, seasonWarning, PERIOD_EVERY } = module.exports;

const HOUR = 3_600_000, DAY = 24 * HOUR;
const season = (id, extra = {}) => ({ id, number: id, started_at: "2026-09-01T04:00:00Z", ended_at: "2026-10-01T04:00:00Z", days: 30, period: "month", period_name: "Месяц", scheduled: true, ended_by: null, visible_until: "2026-10-06T04:00:00Z",
  totals: { buildings: 34, small: 210, builders: 12, cities: {}, mine: { buildings: 2, small: 21, cells: 39 }, districts: [
    { id: "support-team-1", city: "support", name: "Команда Айданы", number: 1, buildings: 20, families: {}, small: 150, decor: {}, cells: 400, landmark_level: 3, builders: 7, top: [{ name: "Айдана С.", buildings: 6, small: 40, cells: 94 }, { name: "Ерлан Ж.", buildings: 3, small: 12, cells: 39 }] },
    { id: "support-team-2", city: "support", name: "Пустой район", number: 2, buildings: 0, families: {}, small: 0, decor: {}, cells: 0, landmark_level: 1, builders: 0, top: [] },
    { id: "sales-team-1", city: "sales", name: "Район продаж", number: 1, buildings: 14, families: {}, small: 60, decor: {}, cells: 200, landmark_level: 2, builders: 5, top: [] },
  ] }, ...extra });
const seasons = (extra = {}) => ({ current: { number: 2, started_at: "2026-10-01T04:00:00Z", period: "month", period_name: "Месяц", ends_at: new Date(Date.now() + 2 * DAY + 5 * HOUR + 60_000).toISOString(), warning: true, revision: 3 },
  history: [season(1)], resets: 1, can_manage: false, visible_days: 5, warn_days: 3, periods: [], ...extra });
const render = (props) => renderToStaticMarkup(React.createElement(HistoryContent, { department: "support", viewing: null, onView() {}, onLeave() {}, seasons: seasons(), ...props }));

test("the time left and the totals read as people say them", () => {
  const now = Date.parse("2026-10-14T09:00:00Z");
  assert.equal(timeLeft(new Date(now + 2 * DAY + 5 * HOUR).toISOString(), now), "2 дня 5 ч");
  assert.equal(timeLeft(new Date(now + 5 * DAY).toISOString(), now), "5 дней");
  assert.equal(timeLeft(new Date(now + 3 * HOUR).toISOString(), now), "3 ч");
  assert.equal(timeLeft(new Date(now + 20 * 60_000).toISOString(), now), "меньше часа");
  assert.equal(shortLeft(new Date(now + DAY + 2 * HOUR).toISOString(), now), "1 день");
  assert.equal(shortLeft(new Date(now + 30 * 60_000).toISOString(), now), "< 1 ч");
  assert.equal(totalsLine({ buildings: 1, small: 2, builders: 1 }), "1 здание · 2 клетки благоустройства · строил 1 человек");
  assert.equal(totalsLine({ buildings: 5, small: 0, builders: 0 }), "5 зданий · 0 клеток благоустройства");
  assert.equal(`${daysText(21)}, ${resetsText(3)}`, "21 день, 3 раза");
  assert.equal(PERIOD_EVERY.week, "раз в неделю");
  assert.match(seasonWarning({ ends_at: new Date(now + 2 * DAY).toISOString() }, now), /^Через 2 дня город начнёт новый сезон: постройки районов уйдут в историю\. Обучение, опыт и коины останутся\.$/);
});

test("a new schedule proposes one period ahead at nine in the morning", () => {
  const now = new Date(2026, 0, 31, 15, 20);
  assert.equal(localInput(firstReset("month", now)), "2026-02-28T09:00");
  assert.equal(localInput(firstReset("week", now)), "2026-02-07T09:00");
  assert.equal(localInput(firstReset("3months", new Date(2026, 10, 30, 8))), "2027-02-28T09:00");
});

test("an operator sees the warning, the past season with their own part and its districts", () => {
  const html = render();
  assert.match(html, /<p class="city-history__warning" role="status">⏳ Через 2 дня 5 ч город начнёт новый сезон/);
  assert.match(html, /Прошлый город виден здесь 5 дней после сброса\./);
  assert.match(html, /<strong>Сезон 1<\/strong><span>[^<]*сентября[^<]*октября 2026 · 30 дней<\/span>/);
  assert.match(html, /<button type="button" class="btn btn--primary btn--s city-history__view">Смотреть город<\/button>/);
  assert.match(html, /Сброшен по расписанию · в истории до/);
  assert.match(html, /<p class="city-history__mine">Ваш вклад: 2 здания · 21 клетка благоустройства<\/p>/);
  // Only the districts of the city on screen that built anything; who built most, by cells.
  assert.match(html, /<strong>Команда Айданы<\/strong><span>20 зданий · 150 клеток благоустройства · строили 7 человек · главное здание 3 уровня<\/span>/);
  assert.match(html, /Больше всех построили: Айдана С\. \(94 клетки\), Ерлан Ж\. \(39 клеток\)/);
  assert.doesNotMatch(html, /Пустой район|Район продаж/);
});

test("on the map a past season is marked and the way back is offered; heads see how many resets there were", () => {
  const html = render({ viewing: 1, seasons: seasons({ can_manage: true, resets: 4, current: { number: 5, started_at: "2026-10-01T04:00:00Z", period: null, period_name: null, ends_at: null, warning: false, revision: 1 } }) });
  assert.match(html, /<p class="city-history__viewing"><span>Сейчас на карте — город сезона 1, каким он был в день сброса\.<\/span><button type="button" class="btn btn--secondary btn--s">Вернуться в нынешний город<\/button><\/p>/);
  assert.match(html, /<span class="city-history__shown">На карте<\/span>/);
  assert.match(html, /Город сбрасывался 4 раза\./);
  assert.doesNotMatch(html, /city-history__warning|Смотреть город/);
  assert.match(render({ seasons: seasons({ history: [] }) }), /Прошлых сезонов пока нет\./);
});
