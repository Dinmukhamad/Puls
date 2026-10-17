import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
let race;
const built = await build({
  entryPoints: [fileURLToPath(new URL("./RacePage.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)((name) => ({
  "react-router-dom": {
    useSearchParams: () => [new URLSearchParams(""), () => {}],
    Link: ({ to, children }) => React.createElement("a", { href: to }, children),
  },
  "@tanstack/react-query": {
    keepPreviousData: undefined,
    useQuery: (options) => ({ data: options.queryKey[0] === "race" ? race : [
      { id: 17, iso_year: 2026, iso_week: 41, label: "2026-W41", title: "", starts_on: "2026-10-05",
        ends_on: "2026-10-11", status: "calculated", calculated_at: null, closed_at: null }] }),
  },
})[name] ?? require(name), module, module.exports);
const { RacePage, visibleRows, pointsLabel } = module.exports;

const place = (rank, name, points, gap, extra = {}) => ({ rank, name, points, gap, rank_delta: null, is_me: false, ...extra });
const option = (code, title, unit, value, need, gain) => ({ code, title, unit, value, need, gain });
const fixture = (patch = {}) => ({
  week: { id: 17, label: "2026-W41", starts_on: "2026-10-05", ends_on: "2026-10-11", status: "calculated" },
  live: false, period: "month", prizes: [], participants: 5, max_points: 100,
  me: { rank: 4, points: 91.25, rank_delta: 2, shared_with: [] },
  next: place(3, "Данияр А.", 93.75, 2.5),
  behind: { ...place(5, "Тимур Д.", 85, -6.25), lead: 6.25 },
  podium: [
    { place: 1, name: "Айгерим А.", points: 100, gap: 8.75, reached: false },
    { place: 2, name: "Жанна Б.", points: 99, gap: 7.75, reached: false },
    { place: 3, name: "Данияр А.", points: 93.75, gap: 2.5, reached: false },
  ],
  standings: [place(1, "Айгерим А.", 100, 8.75), place(2, "Жанна Б.", 99, 7.75), place(3, "Данияр А.", 93.75, 2.5),
    place(4, "Оператор Первый", 91.25, 0, { is_me: true, rank_delta: 2 }), place(5, "Тимур Д.", 85, -6.25)],
  metrics: [
    { code: "quality", title: "Качество работы", unit: "%", direction: "higher_is_better", value: 80, target: 100,
      points: 20, max_points: 25, lost: 5, reported: true, per_unit: 0.25 },
    { code: "calls_per_hour", title: "Количество звонков в час", unit: "шт/ч", direction: "higher_is_better", value: 9,
      target: 12, points: 11.25, max_points: 15, lost: 3.75, reported: true, per_unit: 1.25 },
    { code: "overtime", title: "Переработки", unit: "ч", direction: "higher_is_better", value: 8, target: 8,
      points: 10, max_points: 10, lost: 0, reported: true, per_unit: 1.25 },
    { code: "driver_gratitudes", title: "Благодарности от водителей", unit: "шт", direction: "higher_is_better",
      value: null, target: 5, points: 0, max_points: 5, lost: 5, reported: false, per_unit: 1 },
  ],
  advice: {
    room: 13.75,
    next: { rank: 3, name: "Данияр А.", gap: 2.5, plan: { reachable: true, steps: [], gain: 2.52 },
      options: [option("quality", "Качество работы", "%", 80, 90.1, 2.52),
        option("calls_per_hour", "Количество звонков в час", "шт/ч", 9, 11.1, 2.62)] },
    podium: { place: 3, name: "Данияр А.", gap: 2.5, plan: { reachable: true, steps: [], gain: 2.52 } },
  },
  ...patch,
});
const render = (data) => { race = data; return renderToStaticMarkup(React.createElement(RacePage)); };

test("the place, the gap to the next one, the lead and the podium distance are named", () => {
  const html = render(fixture());
  assert.match(html, /Гонка недели/);
  assert.match(html, /<strong>4<\/strong><span>место из 5<\/span>/);
  assert.match(html, /До 3-го места<\/span><strong>2,5 балла<\/strong><small>Данияр А\.<\/small>/);
  assert.match(html, /Отрыв от 5-го места<\/span><strong>6,25 балла<\/strong><small>Тимур Д\.<\/small>/);
  assert.match(html, /До призовой тройки<\/span><strong>2,5 балла<\/strong>/);
  assert.match(html, /\+2/);
  assert.match(html, /91,25<\/strong> из 100 баллов/);
});

test("the advice names the value each metric needs and where the points go", () => {
  const html = render(fixture());
  assert.match(html, /Подняться на 3-е место \(Данияр А\.\): нужно \+2,5 балла/);
  assert.match(html, /Хватит одного из этого/);
  assert.match(html, /80 % → <strong>90,1 %<\/strong>/);
  assert.match(html, /9 шт\/ч → <strong>11,1 шт\/ч<\/strong>/);
  assert.match(html, /\+2,52 балла/);
  // The podium is the next place here: no second, identical goal.
  assert.doesNotMatch(html, /До призовой тройки: \+/);
  assert.match(html, /Где вы теряете баллы/);
  assert.match(html, /−5 баллов/);
  assert.match(html, /максимум/);
  assert.match(html, /нет данных/);
  assert.match(html, /\+1 % = \+0,25 балла/);
  assert.match(html, /Всего можно добрать ещё 13,75 балла/);
});

test("a gap one metric cannot close asks for several, or says it is out of reach this week", () => {
  const steps = [option("quality", "Качество работы", "%", 80, 100, 5), option("calls_per_hour", "Количество звонков в час", "шт/ч", 9, 10.1, 1.37)];
  let html = render(fixture({ advice: { ...fixture().advice, next: { ...fixture().advice.next, gap: 6.25, options: [], plan: { reachable: true, steps, gain: 6.37 } }, podium: null } }));
  assert.match(html, /Одного показателя не хватит — подтяните вместе/);
  assert.match(html, /80 % → <strong>100 %<\/strong>/);
  html = render(fixture({ advice: { ...fixture().advice, next: { ...fixture().advice.next, gap: 20, options: [], plan: { reachable: false, steps, gain: 8.75 } }, podium: null } }));
  assert.match(html, /За эту неделю разрыв не закрыть: по загруженным показателям можно добрать только 8,75 балла/);
});

test("the table names everyone, marks the own row and the distance from it", () => {
  const html = render(fixture());
  assert.match(html, /Таблица гонки/);
  assert.match(html, /Айгерим А\./);
  assert.match(html, /class="row--me"/);
  assert.match(html, /это вы/);
  assert.match(html, /\+8,75/);
  assert.match(html, /−6,25/);
  assert.doesNotMatch(html, /Показать всех/);
});

test("a long table keeps the top three and the places around the operator", () => {
  const standings = Array.from({ length: 30 }, (_, i) => place(i + 1, `Оператор ${i + 1}`, 100 - i, null, { is_me: i === 15 }));
  const rows = visibleRows(standings, false);
  assert.deepEqual(rows.map((row) => row === "gap" ? "…" : row.rank), [1, 2, 3, "…", 13, 14, 15, 16, 17, 18, 19, "…"]);
  assert.equal(visibleRows(standings, true).length, 30);
  assert.match(render(fixture({ standings, participants: 30 })), /Показать всех \(30\)/);
});

test("the leader sees the lead, an operator without metrics sees the field", () => {
  let html = render(fixture({ me: { rank: 1, points: 100, rank_delta: null, shared_with: [] }, next: null,
    advice: { room: 0, next: null, podium: null } }));
  assert.match(html, /Вы лидер недели/);
  assert.match(html, /Отрыв 6,25 балла/);
  assert.match(html, /Вы на первом месте/);
  html = render(fixture({ me: null, next: null, behind: null, advice: null }));
  assert.match(html, /Вас пока нет в гонке этой недели/);
  assert.doesNotMatch(html, /Что подтянуть/);
});

test("the note explains prizes and a week still running", () => {
  let html = render(fixture());
  assert.match(html, /Места недели не приносят призов/);
  assert.match(html, /href="\/rating"/);
  html = render(fixture({ period: "week", prizes: [300, 200, 150], live: true }));
  assert.match(html, /Призы недели: 1 место — 300, 2 — 200, 3 — 150 коинов/);
  assert.match(html, /Неделя идёт · по загруженным данным/);
  assert.match(html, /Места меняются по мере загрузки показателей/);
});

test("points read naturally in Russian", () => {
  assert.equal(pointsLabel(2.5), "2,5 балла");
  assert.equal(pointsLabel(1), "1 балл");
  assert.equal(pointsLabel(3), "3 балла");
  assert.equal(pointsLabel(8), "8 баллов");
  assert.equal(pointsLabel(21), "21 балл");
});
