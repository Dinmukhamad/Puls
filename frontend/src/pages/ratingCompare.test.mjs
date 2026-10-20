import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
let compare;
let search = "";
const built = await build({
  entryPoints: [fileURLToPath(new URL("./OperatorRating.tsx", import.meta.url)), fileURLToPath(new URL("./RatingCompare.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", outdir: "out",
  loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false,
});
const load = (file) => {
  const module = { exports: {} };
  new Function("require", "module", "exports", file.text)((name) => ({
    "react-router-dom": {
      useSearchParams: () => [new URLSearchParams(search), () => {}],
      Link: ({ to, children }) => React.createElement("a", { href: to }, children),
    },
    "@tanstack/react-query": {
      keepPreviousData: undefined,
      useQuery: (options) => ({ data: options.queryKey[0] === "rating-compare" ? compare : [], isLoading: false, isError: false }),
    },
  })[name] ?? require(name), module, module.exports);
  return module.exports;
};
const { OperatorRating } = load(built.outputFiles.find((file) => file.path.endsWith("OperatorRating.js")));
const { chosenColleague, leadLine, weeksAhead, scale, HeadToHead, signedPoints, ChannelsCard } = load(built.outputFiles.find((file) => file.path.endsWith("RatingCompare.js")));

const week = (id, startsOn, endsOn, status, live = false) => ({ id, label: `2026-W${id}`, starts_on: startsOn, ends_on: endsOn, status, live });
const row = (userId, name, rank, points, trail, extra = {}) => ({
  user_id: userId, name, group_id: 1, group: "Группа 1", rank, points, rank_delta: null, weeks: 2, prize: 0, is_me: false,
  trail: trail.map((place) => place == null ? null : { rank: place, points: 80 }), ...extra,
});
const month = () => ({
  period: "month", title: "октябрь 2026", status: "calculated", live: false, week: null,
  month: { year: 2026, month: 10, name: "октябрь 2026", weeks_planned: 5 }, participants: 3,
  weeks: [week(40, "2026-09-28", "2026-10-04", "closed"), week(41, "2026-10-05", "2026-10-11", "closed"), week(42, "2026-10-12", "2026-10-18", "open", true)],
  operators: [
    row(7, "Данияр А.", 1, 182.69, [1, 4, 1], { prize: 300 }),
    row(4, "Тимур Асхатович Дюсенов", 2, 180.05, [2, 1, 4], { is_me: true, prize: 200, group_id: 2, group: "Группа 2" }),
    row(9, "Асель Н.", 3, 167.76, [3, null, 3]),
  ],
  teams: [
    { group_id: 1, name: "Группа 1", rank: 1, members: 2, points: 175.23, total: 350.45, best: { name: "Данияр А.", points: 182.69, is_me: false }, is_mine: false, trail: [80, 80, 80] },
    { group_id: 2, name: "Группа 2", rank: 2, members: 1, points: 180.05, total: 180.05, best: { name: "Тимур Асхатович Дюсенов", points: 180.05, is_me: true }, is_mine: true, trail: [80, 80, 80] },
  ],
  metrics: [
    { code: "quality", title: "Качество работы", unit: "%", direction: "higher_is_better", target: 100, me: 97.7, average: 88.62, best: 97.7, reported: 3, place: 1, points: null, max_points: 25 },
    { code: "hours_worked", title: "Выработка часов", unit: "ч", direction: "higher_is_better", target: 40, me: 38.05, average: 40.44, best: 43.25, reported: 3, place: 3, points: null, max_points: 25 },
  ],
});

test("the page shows your place, the teams, everyone with places by week and the metrics against all", () => {
  compare = month(); search = "";
  const html = renderToStaticMarkup(React.createElement(OperatorRating));
  assert.match(html, /Ваше место/);
  assert.match(html, /<strong>2<\/strong><span>место из 3<\/span>/);
  assert.match(html, /До 1-го места/);
  assert.match(html, /Отрыв от 3-го места/);
  assert.match(html, /Приз сейчас/);
  assert.match(html, /Команды/);
  assert.match(html, /Группа 2<span class="tag-me">ваша<\/span>/);
  assert.match(html, /Все операторы/);
  // Yourself as «Вы», the others as buttons that open the comparison.
  assert.match(html, /Вы<span class="tag-me">это вы<\/span>/);
  assert.match(html, /aria-label="Сравнить с: Данияр А\."/);
  assert.doesNotMatch(html, /Сравнить с: Тимур/);
  assert.match(html, /compare-chip is-top is-live/);
  assert.match(html, /В рамке — неделя без итогов/);
  assert.match(html, /Показатели: вы и все/);
  assert.match(html, /чужие значения без имён/);
  assert.match(html, /лучший результат/);
  assert.match(html, /−2,39 к среднему/);
  assert.match(html, /data-tour="rating-views"/);
});

test("the month's name opens the list of contest months, not only arrows", () => {
  compare = month(); search = "";
  const html = renderToStaticMarkup(React.createElement(OperatorRating));
  assert.match(html, /role="combobox" class="input puls-select__trigger head-step__select"[^>]*aria-label="Выбрать месяц рейтинга"/);
  assert.match(html, /<span class="puls-select__value">Октябрь 2026<\/span>/);
  assert.match(html, /<option value="2026-10" selected="">Октябрь 2026<\/option>/);
  assert.match(html, /aria-label="Предыдущий месяц"/);
});

test("older links to the weeks open the week", () => {
  compare = { ...month(), period: "week" };
  for (const query of ["view=weeks", "week=41", "period=week"]) {
    search = query;
    assert.match(renderToStaticMarkup(React.createElement(OperatorRating)), /aria-checked="true"[^>]*>Неделя</, query);
  }
  search = "";
  assert.match(renderToStaticMarkup(React.createElement(OperatorRating)), /aria-checked="true"[^>]*>Месяц</);
});

test("a colleague is the one a row picked, never yourself", () => {
  const data = month();
  assert.equal(chosenColleague(data, 7)?.name, "Данияр А.");
  assert.equal(chosenColleague(data, 4), undefined);
  assert.equal(chosenColleague(data, 99), undefined);
  assert.equal(chosenColleague(data, undefined), undefined);
});

test("the comparison says who is ahead without declining names, and in how many weeks", () => {
  const [leader, me, third] = month().operators;
  assert.deepEqual(leadLine(me, leader), { who: "Данияр А. впереди на", points: "2,64 балла" });
  assert.deepEqual(leadLine(me, third), { who: "Вы впереди на", points: "12,29 балла" });
  assert.deepEqual(weeksAhead(me, leader), { ahead: 1, both: 3 });
  // A week the colleague has no place in is not counted.
  assert.deepEqual(weeksAhead(me, third), { ahead: 1, both: 2 });
  const html = renderToStaticMarkup(React.createElement(HeadToHead, { data: month(), colleague: leader }));
  assert.match(html, /Данияр А\. впереди на <strong>2,64 балла<\/strong>/);
  assert.match(html, /выше в 1 неделе из 3/);
  assert.match(html, /<td class="is-better">1-е<\/td>/);
});

test("a metric's scale puts better to the right whatever its direction", () => {
  const higher = scale({ me: 90, average: 80, best: 100, target: 95, direction: "higher_is_better" });
  assert.ok(higher(100) > higher(90) && higher(90) > higher(80));
  const lower = scale({ me: 3, average: 5, best: 1, target: 2, direction: "lower_is_better" });
  assert.ok(lower(1) > lower(3) && lower(3) > lower(5));
  assert.ok([higher(80), higher(100), lower(5), lower(1)].every((value) => value >= 0 && value <= 100));
  assert.equal(signedPoints(10.514), "+10,51");
  assert.equal(signedPoints(-0.8), "−0,8");
});

test("without a place of your own the page still shows the table, with no gaps to you", () => {
  compare = month();
  compare.operators = compare.operators.filter((item) => !item.is_me);
  const html = renderToStaticMarkup(React.createElement(OperatorRating));
  assert.match(html, /Вас пока нет в таблице месяца/);
  assert.match(html, /Данияр А\./);
  assert.doesNotMatch(html, /От вас/);
});

test("the channels compare by the average week once both have results (docs/CHANNELS.md)", () => {
  const channel = (name, patch) => ({ channel: name, participants: 0, average: null, best: null, is_mine: false, metrics: [], ...patch });
  const both = { ...month(), channels: [
    channel("line", { participants: 8, average: 84.2, best: { name: "Данияр А.", points: 98.4, is_me: false }, metrics: [{ title: "Качество работы", max_points: 25 }] }),
    channel("chat", { participants: 4, average: 80, best: { name: "Вы", points: 100, is_me: true }, is_mine: true, metrics: [{ title: "Качество чатов", max_points: 100 }] }),
  ] };
  const html = renderToStaticMarkup(React.createElement(ChannelsCard, { data: both }));
  assert.match(html, /Направления/);
  assert.match(html, /Линия/);
  assert.match(html, /Чаты<span class="tag-me">ваше<\/span>/);
  assert.match(html, /84,2/);
  assert.match(html, /лучший — вы, 100/);
  assert.match(html, /Качество чатов — 100/);
  assert.match(html, /средняя неделя оператора за месяц/);
  // Until the other channel has results there is nothing to compare.
  const alone = { ...both, channels: [both.channels[0], channel("chat", {})] };
  assert.equal(renderToStaticMarkup(React.createElement(ChannelsCard, { data: alone })), "");
});
