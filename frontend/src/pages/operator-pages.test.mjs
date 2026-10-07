import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
async function component(path, exports) {
  const built = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false, define: { "import.meta.env": "{}" }, plugins: exports?.["test:auth"] ? [{ name: "test-auth", setup(plugin) { plugin.onResolve({ filter: /\/AuthContext$/ }, () => ({ path: "test:auth", external: true })); } }] : [] });
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)((name) => exports?.[name] ?? require(name), module, module.exports);
  return module.exports;
}
const { WeekMetricsCard } = await component("./WeekMetricsCard.tsx");
const metric = (patch = {}) => ({ code: "quality", title: "Качество работы", kind: "positive", value: 92, target: 100, completion: 0.92, points: 23, max_points: 25, penalty: 0, unit: "%", ...patch });
const week = (patch = {}) => ({ week_id: 1, week_status: "open", is_final: false, base_points: 0, penalty_points: 0, final_points: 0, coins_from_points: 0, coins_rank_bonus: 0, coins_discipline_bonus: 0, coins_nomination_bonus: 0, coins_total: 0, metrics: [], ...patch });
const renderMetrics = (metrics, patch = {}) => renderToStaticMarkup(React.createElement(WeekMetricsCard, { week: week({ metrics, ...patch }) }));
const metricTiles = (html) => (html.match(/<li class="week-metric-tile">[\s\S]*?<\/li>/g) ?? []).join("");

test("weekly groups are collapsed by default and show server-calculated totals separately from metric counts", () => {
  const html = renderMetrics([metric(), metric({ code: "speed", title: "Скорость работы", points: 10.25 }), metric({ code: "late", title: "Опоздания", kind: "anti", value: 2, points: 0, penalty: 7, unit: "шт" })], { base_points: 33.25, penalty_points: 7, final_points: 26.25, coins_from_points: 5, coins_total: 5 });
  assert.equal((html.match(/<details class="week-metric-group"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<details[^>]*\bopen/);
  assert.match(html, /Баллы/);
  assert.match(html, /Штрафные баллы/);
  assert.match(html, /class="week-metric-group__total" aria-label="Баллы: 33,25">\+33,25/);
  assert.match(html, /class="week-metric-group__total is-negative" aria-label="Штрафные баллы: 7">−7/);
  assert.match(html, /2 показателя/);
  assert.match(html, /1 показатель/);
  assert.match(html, />\+23<\/strong>/);
  assert.match(html, />−7<\/strong>/);
  assert.match(html, /Прогноз баллов<\/dt><dd>26,25/);
  assert.match(html, /Прогноз коинов<\/dt><dd[^>]*>5 /);
});

test("published totals come from the saved server result with all bonus components and a zero floor", () => {
  const html = renderMetrics([metric(), metric({ code: "late", kind: "anti", value: 5, points: 0, penalty: 50 })], { is_final: true, week_status: "closed", base_points: 23, penalty_points: 50, final_points: 0, coins_from_points: 0, coins_rank_bonus: 50, coins_discipline_bonus: 9, coins_nomination_bonus: 7, coins_total: 66 });
  assert.match(html, /Итог опубликован/);
  assert.match(html, /Итоговый балл<\/dt><dd>0/);
  assert.match(html, /Начислено за неделю<\/dt><dd[^>]*>66 /);
  assert.match(html, /Бонус за место<\/dt><dd>50/);
  assert.match(html, /Бонус за дисциплину<\/dt><dd>9/);
  assert.match(html, /Бонусы за номинации<\/dt><dd>7/);
  assert.match(html, /Итог не может быть ниже нуля/);
  assert.match(html, /с точностью до сотых/);
  assert.match(html, /с округлением вниз до целого коина/);
  assert.doesNotMatch(html, /Прогноз коинов|коины ещё не начислены/);
});

test("a calculated but unpublished week remains a forecast rather than an award", () => {
  const html = renderMetrics([metric()], { week_status: "calculated", final_points: 123.45, coins_total: 321 });
  assert.match(html, /Предварительный результат/);
  assert.match(html, /Прогноз баллов<\/dt><dd>123,45/);
  assert.match(html, /Прогноз коинов<\/dt><dd[^>]*>321 /);
  assert.match(html, /Неделя рассчитана, но ещё не закрыта/);
  assert.match(html, /коины ещё не начислены/);
  assert.doesNotMatch(html, /Итог опубликован|Начислено за неделю/);
});

test("saved totals remain visible without a historical metric breakdown and are not recomputed", () => {
  const html = renderMetrics([], { is_final: true, week_status: "closed", final_points: 124.56, coins_from_points: 24, coins_total: 277 });
  assert.match(html, /Итоговый балл<\/dt><dd>124,56/);
  assert.match(html, /Начислено за неделю<\/dt><dd[^>]*>277 /);
  assert.match(html, /Показаны сохранённые итоги закрытой недели/);
  assert.match(html, /Подробная разбивка показателей недоступна/);
  assert.doesNotMatch(html, /class="week-metric-group"/);
});

test("a missing week has an empty state and does not invent a points or coins forecast", () => {
  const html = renderMetrics([], { week_id: null });
  assert.match(html, /Неделя ещё не заведена/);
  assert.doesNotMatch(html, /Прогноз баллов|Прогноз коинов|Итог опубликован|Как получен итог/);
});

test("missing observations never look like zero points or a clean disciplinary record", () => {
  const html = renderMetrics([metric({ value: null, completion: null, points: 0 }), metric({ code: "late", title: "Опоздания", kind: "anti", value: null, penalty: 0 })]);
  const tiles = metricTiles(html);
  assert.equal((tiles.match(/Нет данных/g) ?? []).length, 2);
  assert.equal((tiles.match(/<strong>—<\/strong>/g) ?? []).length, 2);
  assert.doesNotMatch(tiles, /<strong>0<\/strong>|Нарушений нет|role="progressbar"/);
  assert.match(html, /aria-label="Баллы: нет данных">—/);
});

test("reported zero remains a real score and shows the absence of violations", () => {
  const html = renderMetrics([metric({ value: 0, completion: 0, points: 0 }), metric({ code: "late", title: "Опоздания", kind: "anti", value: 0, penalty: 0 })]);
  assert.equal((html.match(/<strong>0<\/strong>/g) ?? []).length, 2);
  assert.match(html, /Нарушений нет/);
  assert.doesNotMatch(metricTiles(html), /Нет данных/);
  assert.doesNotMatch(metricTiles(html), /is-negative/);
  assert.equal((metricTiles(html).match(/week-metric-tile__score is-neutral/g) ?? []).length, 2);
  assert.match(html, /week-metric-group__sign--neutral/);
});

test("driver gratitude remains its own metric and never creates or replaces a call rating", () => {
  const old = metric({ code: "driver_gratitudes", title: "Благодарности от водителей", value: 12, points: 5, unit: "шт" });
  let html = renderMetrics([old]);
  assert.match(html, /Благодарности от водителей/);
  assert.match(html, />12 шт/);
  assert.match(html, />\+5<\/strong>/);
  assert.doesNotMatch(metricTiles(html), /Оценка за звонки|Нет данных/);
  html = renderMetrics([old, metric({ code: "call_rating", title: "Оценка за звонки", value: 4.5, points: 4.5, unit: null })]);
  assert.equal((html.match(/<h3>Оценка за звонки<\/h3>/g) ?? []).length, 1);
  assert.match(html, />\+4,5<\/strong>/);
  assert.match(html, /Благодарности от водителей/);
  assert.match(html, />\+5<\/strong>/);
  assert.doesNotMatch(metricTiles(html), /Нет данных/);
});

test("operator cabinet no longer renders removed summaries or loads its old ledger", async () => {
  const queries = [];
  const { CabinetPage } = await component("./CabinetPage.tsx", {
    "@tanstack/react-query": { useQuery: ({ queryKey }) => {
      queries.push(queryKey[0]);
      const data = {
        dashboard: { full_name: "Оператор", balance: { balance: 10, available: 10, rank: null, rank_delta: null }, week: week({ metrics: [metric()], base_points: 23, final_points: 23, coins_from_points: 4, coins_total: 4 }) },
        "coin-progress": { total: 0, current: null, next: null, progress: 0 },
        badges: [],
      };
      return { data: data[queryKey[0]] };
    } },
  });
  const html = renderToStaticMarkup(React.createElement(CabinetPage));
  assert.match(html, /Показатели недели/);
  assert.match(html, /Прогноз баллов/);
  assert.match(html, /Прогноз коинов/);
  assert.doesNotMatch(html, /Быстрые действия|История операций|Ожидается за неделю|Итог недели/);
  assert.deepEqual(queries.sort(), ["badges", "coin-progress", "dashboard"]);
});

test("old rating progress links lead to coin progress and levels", async () => {
  const { RatingPage } = await component("./RatingPage.tsx", {
    "react-router-dom": {
      useSearchParams: () => [new URLSearchParams("tab=progress&week=42"), () => {}],
      Navigate: ({ to }) => React.createElement("a", { href: to }, "redirect"),
    },
  });
  assert.match(renderToStaticMarkup(React.createElement(RatingPage)), /href="\/progress"/);
});

test("personal wallet ignores obsolete URL filters while the team wallet keeps them", async () => {
  let administrative = false;
  let captured;
  const params = new URLSearchParams("from=2026-01-01&to=2026-02-01&kind=purchase&user=37&page=2");
  const { WalletPage } = await component("./WalletPage.tsx", {
    "test:auth": { useAuth: () => ({ atLeast: () => true }) },
    "react-router-dom": { useSearchParams: () => [params, () => {}] },
    "@tanstack/react-query": { useQuery: (options) => {
      if (options.queryKey[0] === "wallet") {
        captured = options.queryKey[2];
        return { data: { summary: { balance: 10, available: 10, reserved: 0, earned_total: 10, awarded: 100, spent: 0, refunded: 0 }, history: { total: 0, items: [] } } };
      }
      return {};
    } },
  });
  let html = renderToStaticMarkup(React.createElement(WalletPage, { administrative }));
  assert.deepEqual(captured, { page: 2, kind: "", date_from: "", date_to: "", user_id: undefined });
  assert.doesNotMatch(html, /Фильтры|Начало периода|Конец периода|Тип операции|За выбранные даты|Измените фильтры/);
  assert.match(html, /Заработано за всё время/);
  assert.doesNotMatch(html, /не число|NaN/);
  assert.match(html, /Заработано за всё время<\/span><span class="kpi__value">10<\/span>/);
  administrative = true;
  html = renderToStaticMarkup(React.createElement(WalletPage, { administrative }));
  assert.deepEqual(captured, { page: 2, kind: "purchase", date_from: "2026-01-01", date_to: "2026-02-01", user_id: 37 });
  assert.match(html, /Фильтры/);
});
