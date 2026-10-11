/**
 * Период сводки и аналитики руководителя.
 *
 * Переключатель «Дни · Недели · Месяцы» убран: руководитель выбирает любые
 * даты одним календарём, а сервер сам усредняет весь период и подбирает шаг
 * графика. В сводке остаётся только период — без подписей, описания и группы.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
async function load(path, mocks) {
  const keys = Object.keys(mocks);
  const built = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false,
    plugins: [{ name: "fixtures", setup(plugin) { plugin.onResolve({ filter: /.*/ }, ({ path }) => {
      const key = keys.find((name) => path === name || path.endsWith(`/${name}`));
      return key ? { path: `test:${key}`, external: true } : undefined;
    }); } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)((name) => name.startsWith("test:") ? mocks[name.slice(5)] : require(name), module, module.exports);
  return module.exports;
}

const metric = { code: "quality", title: "Качество работы", unit: "%", direction: "higher_is_better", kind: "positive", target: 100, value: 92, previous: 90, delta: 2, improved: true, reported: 1, total: 1, coverage: 1, below_target: 1, description: null, penalty_per_unit: 0, trend: [90, 92] };
const report = { week: { id: 7, label: "2026-W41", status: "open" }, grain: "day", custom_range: true, context_points: 0, period_label: "05.10.2026–11.10.2026", period_from: "2026-10-05", period_to: "2026-10-11", metric_code: "quality", operator_count: 1, operators_with_data: 1, pending_requests: 0, coins_awarded: 12, lateness_metric_code: "lateness", metrics: [metric], trend: [{ week_id: null, label: "05.10", starts_on: "2026-10-05", value: 92, reported: 1 }], groups: [], comparisons: [], operators: [], methodology: "Методика." };

function fixtures(search) {
  const queries = [];
  return { queries, mocks: {
    "@tanstack/react-query": { useQuery: (options) => { queries.push(options.queryKey); return options.queryKey[0] === "analytics" ? { data: report, isLoading: false, isError: false } : { data: [], isError: false }; } },
    "react-router-dom": { useSearchParams: () => [new URLSearchParams(search), () => {}] },
    AccessContext: { useAccess: () => ({ canPath: () => true }) },
    AccessLink: { AccessLink: ({ to, children, className }) => React.createElement("a", { href: to, className }, children) },
  } };
}

test("the summary offers only the period: no step switch, labels, description or group", async () => {
  const { queries, mocks } = fixtures("from=2026-10-05&to=2026-10-11&group_id=4&grain=month");
  const { SummaryPage } = await load("./SummaryPage.tsx", mocks);
  const html = renderToStaticMarkup(React.createElement(SummaryPage));
  assert.doesNotMatch(html, /Показывать по|Дни|Недели|Месяцы|field__label|Группа|Состояние команды, результаты/);
  assert.match(html, /class="date-range-picker analytics-period"/);
  assert.match(html, /05\.10\.2026 — 11\.10\.2026/);
  assert.match(html, /Начислено за период/);
  assert.match(html, /href="\/analytics\?from=2026-10-05&amp;to=2026-10-11"/);
  // The summary covers everyone the viewer may see, whatever an old link says.
  const filters = queries.find((key) => key[0] === "analytics")[2];
  assert.deepEqual(filters, { grain: "range", date_from: "2026-10-05", date_to: "2026-10-11", group_id: undefined, metric_code: undefined, operator_ids: undefined });
});

test("the manager report asks for the chosen dates as one range and keeps group and metric", async () => {
  const { queries, mocks } = fixtures("from=2026-09-01&to=2026-10-11&group_id=4&week_id=9");
  const { ReportFilters, useAnalyticsReport } = await load("./AnalyticsPage.tsx", mocks);
  function Filters() { return React.createElement(ReportFilters, { report: useAnalyticsReport() }); }
  const html = renderToStaticMarkup(React.createElement(Filters));
  assert.doesNotMatch(html, /Показывать по|Шаг периода|type="date"|type="month"|week-picker/);
  assert.match(html, /Период/); assert.match(html, /Группа/); assert.match(html, /Показатель/);
  const filters = queries.find((key) => key[0] === "analytics")[2];
  assert.deepEqual(filters, { grain: "range", date_from: "2026-09-01", date_to: "2026-10-11", group_id: 4, metric_code: undefined, operator_ids: undefined });
});

test("an incomplete or reversed range falls back to the latest contest week", async () => {
  for (const search of ["from=2026-10-11", "from=2026-10-11&to=2026-10-01", "from=junk&to=2026-10-01"]) {
    const { queries, mocks } = fixtures(search);
    const { useAnalyticsReport } = await load("./AnalyticsPage.tsx", mocks);
    function Probe() { useAnalyticsReport(); return null; }
    renderToStaticMarkup(React.createElement(Probe));
    const filters = queries.find((key) => key[0] === "analytics")[2];
    assert.equal(filters.date_from, undefined, search); assert.equal(filters.date_to, undefined, search);
  }
});

test("the reading explains how a chosen range is averaged and when whole weeks stand in for days", async () => {
  const { mocks } = fixtures("");
  const { rangeReading } = await load("./AnalyticsPage.tsx", mocks);
  const reading = (patch) => rangeReading({ grain: "day", custom_range: true, context_points: 0, period_from: "2026-10-05", period_to: "2026-10-11", ...patch });
  assert.equal(reading({}), "Карточки — среднее по дням за весь период, сравнение с таким же периодом до него · график по дням");
  assert.match(reading({ context_points: 4 }), /график по дням, с предыдущими для сравнения$/);
  assert.doesNotMatch(reading({ grain: "week" }), /целиком/);
  assert.match(reading({ grain: "week", period_from: "2026-10-11" }), /дневных значений за эти даты нет — недели взяты целиком$/);
  assert.match(reading({ grain: "week", period_from: "2026-08-03", period_to: "2026-10-08" }), /крайние недели взяты целиком$/);
  assert.equal(rangeReading({ grain: "week", custom_range: false }), "Карточки — последний период диапазона · графики — весь диапазон");
});
