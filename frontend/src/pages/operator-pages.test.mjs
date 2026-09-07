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
const renderMetrics = (metrics) => renderToStaticMarkup(React.createElement(WeekMetricsCard, { week: { week_id: 1, is_final: false, metrics } }));

test("weekly groups are collapsed by default and show server-calculated points and penalties", () => {
  const html = renderMetrics([metric(), metric({ code: "late", title: "Опоздания", kind: "anti", value: 2, points: 0, penalty: 7, unit: "шт" })]);
  assert.equal((html.match(/<details/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<details[^>]*\bopen/);
  assert.match(html, /Баллы/);
  assert.match(html, /Дисбаллы/);
  assert.match(html, />\+23<\/strong>/);
  assert.match(html, />−7<\/strong>/);
  assert.doesNotMatch(html, /Баллы за показатели|Итоговый балл/);
});

test("missing observations never look like zero points or a clean disciplinary record", () => {
  const html = renderMetrics([metric({ value: null, completion: null, points: 0 }), metric({ code: "late", title: "Опоздания", kind: "anti", value: null, penalty: 0 })]);
  assert.equal((html.match(/Нет данных/g) ?? []).length, 2);
  assert.equal((html.match(/<strong>—<\/strong>/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<strong>0<\/strong>|Нарушений нет|role="progressbar"/);
});

test("reported zero remains a real score and shows the absence of violations", () => {
  const html = renderMetrics([metric({ value: 0, completion: 0, points: 0 }), metric({ code: "late", title: "Опоздания", kind: "anti", value: 0, penalty: 0 })]);
  assert.equal((html.match(/<strong>0<\/strong>/g) ?? []).length, 2);
  assert.match(html, /Нарушений нет/);
  assert.doesNotMatch(html, /Нет данных/);
});

test("old gratitude counts are not presented as call ratings", () => {
  const old = metric({ code: "driver_gratitudes", title: "Благодарности от водителей", value: 12, points: 5, unit: "шт" });
  let html = renderMetrics([old]);
  assert.match(html, /Оценка за звонки/);
  assert.match(html, /Нет данных/);
  assert.doesNotMatch(html, /Благодарности|>12|>\+5<\/strong>/);
  html = renderMetrics([old, metric({ code: "call_rating", title: "Оценка за звонки", value: 4.5, points: 4.5, unit: null })]);
  assert.equal((html.match(/<h3>Оценка за звонки<\/h3>/g) ?? []).length, 1);
  assert.match(html, />\+4,5<\/strong>/);
  assert.doesNotMatch(html, /Благодарности|Нет данных/);
});

test("operator cabinet no longer renders removed summaries or loads its old ledger", async () => {
  const queries = [];
  const { CabinetPage } = await component("./CabinetPage.tsx", {
    "@tanstack/react-query": { useQuery: ({ queryKey }) => {
      queries.push(queryKey[0]);
      const data = {
        dashboard: { full_name: "Оператор", balance: { balance: 10, rank: null, rank_delta: null }, week: { week_id: 1, metrics: [metric()] } },
        "xp-summary": { total: 0, current: null, next: null, progress: 0 },
        badges: [],
      };
      return { data: data[queryKey[0]] };
    } },
  });
  const html = renderToStaticMarkup(React.createElement(CabinetPage));
  assert.match(html, /Показатели недели/);
  assert.doesNotMatch(html, /Быстрые действия|Начислено за неделю|Всего начислено|История операций|Ожидается за неделю|Итог недели|Итоговый балл|Баллы за показатели/);
  assert.deepEqual(queries.sort(), ["badges", "dashboard", "xp-summary"]);
});

test("old rating progress links lead to experience and levels", async () => {
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
        return { data: { summary: { balance: 10, available: 10, reserved: 0, awarded: 10, spent: 0, refunded: 0 }, history: { total: 0, items: [] } } };
      }
      return {};
    } },
  });
  let html = renderToStaticMarkup(React.createElement(WalletPage, { administrative }));
  assert.deepEqual(captured, { page: 2, kind: "", date_from: "", date_to: "", user_id: undefined });
  assert.doesNotMatch(html, /Фильтры|Начало периода|Конец периода|Тип операции|За выбранные даты|Измените фильтры/);
  assert.match(html, /За всё время/);
  administrative = true;
  html = renderToStaticMarkup(React.createElement(WalletPage, { administrative }));
  assert.deepEqual(captured, { page: 2, kind: "purchase", date_from: "2026-01-01", date_to: "2026-02-01", user_id: 37 });
  assert.match(html, /Фильтры/);
});
