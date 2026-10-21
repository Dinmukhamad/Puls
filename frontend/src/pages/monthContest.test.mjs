import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
let month, role = "operator";
const fakes = {
  "fake:auth": { useAuth: () => ({ user: { role, channel: "line" }, atLeast: (r) => ["operator", "supervisor", "head", "admin"].indexOf(role) >= ["operator", "supervisor", "head", "admin"].indexOf(r) }) },
  "fake:toast": { useToast: () => ({ success() {} }) },
};
const built = await build({
  entryPoints: [fileURLToPath(new URL("./MonthContest.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false,
  plugins: [{ name: "fakes", setup(b) {
    b.onResolve({ filter: /auth\/AuthContext$/ }, () => ({ path: "fake:auth", external: true }));
    b.onResolve({ filter: /components\/Toast$/ }, () => ({ path: "fake:toast", external: true }));
  } }],
});
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)((name) => fakes[name] ?? ({
  "@tanstack/react-query": {
    useQuery: (options) => ({ data: options.queryKey[0] === "contest-month" ? month : [] }),
    useMutation: () => ({ mutate() {}, isPending: false, isError: false }),
    useQueryClient: () => ({ setQueryData() {}, invalidateQueries() {} }),
  },
})[name] ?? require(name), module, module.exports);
const { MonthContest } = module.exports;
const row = (user_id, rank, points, extra = {}) => ({ user_id, name: `Оператор ${user_id}`, rank, points, weeks: 4, coins_rank_bonus: [0, 300, 200, 150][rank] ?? 0, coins_nomination_bonus: 0, mine: false, ...extra });
const base = {
  id: 1, year: 2026, month: 10, label: "2026-10", name: "октябрь 2026", status: "calculated", closed_at: null,
  weeks: [{ id: 1, label: "2026-W40", starts_on: "2026-09-28", status: "closed" }, { id: 2, label: "2026-W41", starts_on: "2026-10-05", status: "open" }],
  weeks_planned: 4,
  standings: [row(1, 1, 380), row(2, 2, 350, { mine: true, coins_nomination_bonus: 100 }), row(3, 3, 300), row(4, 4, 120)],
  nominations: [{ nomination_id: 5, title: "Лучшее качество", user_id: 2, name: "Оператор 2", value: 98, coins: 100 }],
};

test("an operator sees the podium, their own result with the gaps, and the places around them", () => {
  month = base; role = "operator";
  const html = renderToStaticMarkup(React.createElement(MonthContest));
  assert.match(html, /Конкурс месяца · октябрь 2026/);
  assert.match(html, /Среди операторов линии/);
  assert.match(html, /Опубликовано недель: 1 из 4/);
  assert.match(html, /Топ-3 месяца/);
  assert.match(html, /\+300 коинов/);
  // The operator's own month: the place, the points, the gaps and the prize so far.
  assert.match(html, /<strong>2<\/strong><span>место из 4<\/span>/);
  assert.match(html, /350 баллов/);
  assert.match(html, /номинация: Лучшее качество/);
  assert.match(html, /До 1-го места<\/span><strong>30<\/strong>/);
  assert.match(html, /Запас над 3-м местом<\/span><strong>50<\/strong>/);
  assert.match(html, /Приз сейчас<\/span><strong>\+300<\/strong>/);
  assert.match(html, /class="nomination is-me"/);
  // Instead of the table: the places around, their gap to the operator; one channel, no switch.
  assert.match(html, /Рядом с вами/);
  assert.match(html, /Операторы линии · 4 участника/);
  assert.match(html, /contest-row__diff is-ahead">\+30</);
  assert.match(html, /contest-row__diff is-behind">−230</);
  assert.doesNotMatch(html, /Таблица месяца|aria-label="Направление"|Закрыть месяц|Пересчитать/);
});

test("the places around show two above and two below, everyone one tap away", () => {
  role = "operator";
  const standings = Array.from({ length: 12 }, (_, i) => row(i + 1, i + 1, 400 - i * 5, i === 9 ? { mine: true } : {}));
  month = { ...base, standings, nominations: [] };
  const html = renderToStaticMarkup(React.createElement(MonthContest));
  const ranks = [...html.matchAll(/contest-row__rank">(\d+)</g)].map((m) => Number(m[1]));
  assert.deepEqual(ranks, [8, 9, 10, 11, 12]);
  assert.match(html, /Все операторы \(12\)/);
  assert.match(html, /До топ-3<\/span><strong>35<\/strong>/);
});

test("leaders keep the channel switch and the month's table", () => {
  month = base; role = "head";
  const html = renderToStaticMarkup(React.createElement(MonthContest));
  assert.match(html, /aria-label="Направление"/);
  assert.match(html, /Таблица месяца/);
  assert.doesNotMatch(html, /Рядом с вами/);
});

test("a head can close the month only when all its weeks are closed", () => {
  month = base; role = "head";
  let html = renderToStaticMarkup(React.createElement(MonthContest));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Закрыть месяц/);
  month = { ...base, weeks: base.weeks.map((w) => ({ ...w, status: "closed" })) };
  html = renderToStaticMarkup(React.createElement(MonthContest));
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Закрыть месяц/);
  month = { ...base, status: "closed" };
  html = renderToStaticMarkup(React.createElement(MonthContest));
  assert.match(html, /Итоги опубликованы/);
  assert.doesNotMatch(html, /Закрыть месяц/);
});

test("an empty month says when the places appear", () => {
  month = { ...base, standings: [], nominations: [] }; role = "operator";
  assert.match(renderToStaticMarkup(React.createElement(MonthContest)), /Места появятся после первой закрытой недели месяца/);
});
