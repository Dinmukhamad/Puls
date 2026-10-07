import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
let board;
const queries = [];
const built = await build({
  entryPoints: [fileURLToPath(new URL("./RatingPage.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)((name) => ({
  "react-router-dom": {
    useSearchParams: () => [new URLSearchParams("page=99"), () => {}],
    Navigate: () => null,
  },
  "@tanstack/react-query": {
    useQuery: (options) => {
      queries.push(options.queryKey);
      return { data: options.queryKey[0] === "rating" ? board : [{ id: 17, label: "2026-W41", status: "closed" }] };
    },
  },
})[name] ?? require(name), module, module.exports);
const { RatingPage } = module.exports;
const own = { user_id: 7, full_name: "Свой Оператор", group_name: "Своя группа", is_me: true,
  rank: 4, points: 72.5, coins_week: 28, rank_delta: 0, balance: 80 };
const foreign = { ...own, user_id: 19, full_name: "Чужое Скрытое Имя", group_name: "Чужая Группа", is_me: false, rank: 3, points: 80 };
const nomination = { code: "quality", title: "Качество", description: null, winner_id: null,
  winner_name: null, winner_group: null, value: 0, coins_awarded: 0, winner_hidden: false };
const fixture = (patch = {}) => ({
  header: { week_id: 17, week_label: "2026-W41", period_start: "2026-10-05", period_end: "2026-10-11",
    status: "closed", participants: 48 },
  view_mode: "personal", my_row: own, my_gap_to_podium: 7.5, my_podium_state: "outside_podium",
  rows: [own], podium: [], nominations: [], page: 1, size: 1, total: 1,
  ...patch,
});
const render = (data) => { board = data; return renderToStaticMarkup(React.createElement(RatingPage)); };

test("personal rating explains actual place, participant count and period without a fake table or pagination", () => {
  const html = render(fixture({ rows: [own, foreign], podium: [{ ...foreign, medal: "bronze" }] }));
  assert.match(html, /Ваш результат по неделям/);
  assert.match(html, /Место <strong>4<\/strong> из 48/);
  assert.match(html, /05\.10\.2026 — 11\.10\.2026/);
  assert.match(html, /До призового результата — <strong>7,5 баллов<\/strong>/);
  assert.match(html, /операторы делят место/);
  assert.match(html, /без изменений/);
  assert.doesNotMatch(html, /Общая таблица|Результаты команды|Чужое Скрытое Имя|Чужая Группа|<table|pagination|Топ-3 недели/);
});

test("a prize place and small participant pool never show a distance of zero as a next goal", () => {
  for (const participants of [1, 2, 5]) {
    const html = render(fixture({ header: { ...fixture().header, participants },
      my_row: { ...own, rank: participants < 3 ? participants : 3 },
      my_podium_state: "on_podium", my_gap_to_podium: 0 }));
    assert.match(html, /Вы на призовом месте/);
    assert.doesNotMatch(html, /До призового результата/);
  }
});

test("an uncalculated week does not display stale rank, points, coins or podium comparisons", () => {
  const html = render(fixture({ header: { ...fixture().header, status: "open" },
    my_podium_state: "uncalculated", my_gap_to_podium: null }));
  assert.match(html, /Место пока не рассчитано/);
  assert.match(html, /Участников: 48/);
  assert.match(html, /после загрузки показателей и расчёта недели/);
  assert.doesNotMatch(html, /Место <strong>|До призового результата|Вы на призовом месте|72,5|Коины за неделю|Динамика места/);
});

test("a missing personal result explains the next step instead of an empty search result", () => {
  const html = render(fixture({ my_row: null, rows: [], my_podium_state: "not_participating", my_gap_to_podium: null }));
  assert.match(html, /За эту неделю нет вашего результата/);
  assert.match(html, /Уточните у супервайзера/);
  assert.doesNotMatch(html, /Ничего не найдено|Измените фильтры|Общая таблица|До призового результата/);
});

test("hidden winners are visibly distinct from absent winners without showing a fabricated reward", () => {
  const html = render(fixture({ nominations: [
    { ...nomination, code: "hidden", winner_hidden: true },
    { ...nomination, code: "absent" },
  ] }));
  assert.match(html, /Победитель определён · личные данные скрыты/);
  assert.match(html, /Победитель не определён/);
  assert.doesNotMatch(html, /\+0 коинов|Чужое Скрытое Имя/);
});

test("staff keeps the general table, visible results and pagination", () => {
  const html = render(fixture({ view_mode: "table", rows: [own, foreign], total: 48, page: 2, size: 25,
    podium: [{ ...foreign, medal: "bronze" }], my_row: null }));
  assert.match(html, /Результаты команды по неделям/);
  assert.match(html, /Общая таблица/);
  assert.match(html, /<table/);
  assert.match(html, /pagination/);
  assert.match(html, /Чужое Скрытое Имя/);
  assert.match(html, /Топ-3 недели/);
  assert.doesNotMatch(html, /Ваш результат по неделям/);
});
