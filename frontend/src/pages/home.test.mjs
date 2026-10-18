/**
 * The operator's home (docs/OPERATOR_HOME.md) is built from the site's own blocks: «Ваше место», «Что подтянуть» and the
 * table of «Гонка недели», beside them the month's contest and what can be done today.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
let state = {};
const mocks = {
  "@tanstack/react-query": { useQuery: ({ queryKey, enabled }) => enabled === false ? {} : { data: state[queryKey[0]] } },
  AccessContext: { useAccess: () => ({ can: () => true, canPath: () => true }) },
  "react-router-dom": { Link: ({ to, children, ...props }) => React.createElement("a", { href: to, ...props }, children) },
};
const keys = Object.keys(mocks);
const built = await build({
  entryPoints: [fileURLToPath(new URL("./CabinetPage.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false,
  plugins: [{ name: "home-fixture", setup(plugin) {
    plugin.onResolve({ filter: /.*/ }, ({ path }) => {
      const key = keys.find((name) => path === name || path.endsWith(`/${name}`));
      return key ? { path: `test:${key}`, external: true } : undefined;
    });
  } }],
});
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)((name) => name.startsWith("test:") ? mocks[name.slice(5)] : require(name), module, module.exports);
const { CabinetPage, weekCaption, monthGap, nextMission } = module.exports;
const render = () => renderToStaticMarkup(React.createElement(CabinetPage));

const names = ["Данияр А.", "Мадина Е.", "Айгерим А.", "Асель Н.", "Салтанат К.", "Ерлан М.", "Арман И.", "Тимур Асхатович Дюсенов", "Жанна Б.", "Динара С.", "Руслан О.", "Нурлан Т."];
const scores = [96.18, 92.07, 89.59, 88.29, 85.43, 85.28, 84.15, 83.63, 82.25, 78.79, 78.23, 77.32];
const standings = (mine = 7) => names.map((name, i) => ({ rank: i + 1, name, points: scores[i], gap: Math.round((scores[i] - scores[mine]) * 100) / 100, rank_delta: null, is_me: i === mine }));
const option = (code, title, unit, value, need, gain) => ({ code, title, unit, value, need, gain });
const race = (patch = {}) => ({
  week: { id: 3, label: "2026-W42", starts_on: "2026-10-12", ends_on: "2026-10-18", status: "open" },
  live: true, period: "month", prizes: [], participants: 12, max_points: 100,
  me: { rank: 8, points: 83.63, rank_delta: -5, shared_with: [] },
  next: { rank: 7, name: "Арман И.", points: 84.15, gap: 0.52, rank_delta: -2, is_me: false },
  behind: { rank: 9, name: "Жанна Б.", points: 82.25, gap: -1.38, rank_delta: -8, is_me: false, lead: 1.38 },
  podium: [{ place: 1, name: "Данияр А.", points: 96.18, gap: 12.55, reached: false }, { place: 2, name: "Мадина Е.", points: 92.07, gap: 8.44, reached: false }, { place: 3, name: "Айгерим А.", points: 89.59, gap: 5.96, reached: false }],
  standings: standings(),
  metrics: [
    { code: "thanks", title: "Благодарности от водителей", unit: "шт", direction: "higher_is_better", value: 0, target: 5, points: 0, max_points: 5, lost: 5, reported: true, per_unit: 1 },
    { code: "overtime", title: "Переработки", unit: "ч", direction: "higher_is_better", value: 8.4, target: 8, points: 10, max_points: 10, lost: 0, reported: true, per_unit: null },
  ],
  advice: {
    room: 16.37,
    next: { rank: 7, name: "Арман И.", gap: 0.52, options: [option("hours", "Выработка часов", "ч", 34.6, 35.5, 0.57), option("quality", "Качество работы", "%", 89.7, 91.9, 0.55), option("eff", "Эффективность", "%", 90.4, 93.1, 0.54), option("calls", "Звонки", "шт/ч", 9.2, 9.8, 0.75)], plan: { reachable: false, steps: [], gain: 0 } },
    podium: { place: 3, name: "Айгерим А.", gap: 5.96, plan: { reachable: true, steps: [option("thanks", "Благодарности от водителей", "шт", 0, 5, 5), option("calls", "Количество звонков в час", "шт/ч", 9.2, 10, 1)], gain: 6 } },
  },
  ...patch,
});
const dashboard = (weekId = 3) => ({ full_name: "Тимур Асхатович Дюсенов", group_name: "Группа 2 - ночная смена", balance: { balance: 300, available: 300, reserved: 0 }, week: { week_id: weekId, coins_total: 167, is_final: false } });
const month = { year: 2026, month: 10, name: "октябрь 2026", status: "calculated", weeks: [{ status: "closed" }, { status: "closed" }, { status: "open" }], weeks_planned: 5,
  standings: [{ name: "Тимур Асхатович Дюсенов", rank: 1, points: 185.45, weeks: 2, coins_rank_bonus: 300, coins_nomination_bonus: 100, mine: true }, { name: "Данияр А.", rank: 2, points: 185.06, weeks: 2, coins_rank_bonus: 200, coins_nomination_bonus: 0, mine: false }], nominations: [] };
const mission = (key, state, patch = {}) => ({ key, title: `Миссия ${key}`, district: "academy", state, enabled: true, current: 0, target: 1, xp: 25, coins: 0, ...patch });
const city = { can_claim: true, preview: false, inspecting: false, districts: [{ id: "academy", name: "Академия", soon: false }],
  missions: [mission("welcome", "ready", { title: "Твой город начинается здесь" })], quests: { day: "2026-10-18", coins: 3, items: [{ answered: false }, { answered: false }, { answered: false }] } };
const wheel = { enabled: false, free_left: 1, chest: { unlocked: false, answered: 0, total: 3 } };
const everything = (patch = {}) => ({ race: race(), dashboard: dashboard(), "contest-month": month, city, wheel, ...patch });

test("the month's gap reads without declining names", () => {
  assert.equal(monthGap(month.standings, month.standings[0]), "Отрыв 0,39 балла · следом Данияр А.");
  assert.equal(monthGap([{ ...month.standings[0] }, { ...month.standings[1], rank: 1, points: 185.45 }], month.standings[0]), "Поровну с: Данияр А.");
  assert.equal(monthGap([{ name: "Лидер", rank: 1, points: 190, mine: false }, { name: "Я", rank: 3, points: 187.9, mine: true }], { rank: 3, points: 187.9 }), "До 1-го места — 2,1 балла");
});

test("the next mission follows the city's order and skips locked, disabled and coming districts", () => {
  const data = { districts: [{ id: "academy", soon: false }, { id: "voice", soon: true }], missions: [
    mission("a", "available"), mission("b", "in_progress"), mission("c", "ready", { district: "voice" }), mission("d", "ready", { enabled: false }), mission("e", "locked")] };
  assert.equal(nextMission(data).key, "b");
  assert.equal(nextMission({ ...data, missions: [...data.missions, mission("f", "ready")] }).key, "f");
  assert.equal(nextMission(undefined), undefined);
});

test("an old week is named as the latest calculated one, not passed off as this week", () => {
  const data = race();
  assert.equal(weekCaption(data, "2026-10-17"), "Гонка недели · 12.10–18.10.2026 · места по загруженным показателям");
  assert.equal(weekCaption({ ...data, live: false, week: { ...data.week, status: "closed" } }, "2026-10-18"), "Гонка недели · 12.10–18.10.2026 · итог опубликован");
  assert.equal(weekCaption({ ...data, live: false }, "2026-10-19"), "Последняя рассчитанная неделя: 12.10–18.10.2026. Показатели этой недели ещё не загружены");
  assert.equal(weekCaption({ ...data, week: null }), "");
});

test("the home is the site's own cards: the place, what to improve and the table, the month and today beside them", () => {
  state = everything();
  const html = render();
  assert.match(html, /data-tour="home"/);
  assert.match(html, /<h1 class="page-title">Мой кабинет<\/h1>/);
  assert.match(html, /(Доброе утро|Добрый день|Добрый вечер|Доброй ночи), Тимур · Группа 2 - ночная смена/);
  // «Ваше место» of «Гонка недели», with the week it comes from and a link there.
  assert.match(html, /data-tour="home-race"/);
  assert.match(html, /Ваше место/);
  assert.match(html, /class="race-hero__place"><strong>8<\/strong><span>место из 12<\/span>/);
  assert.match(html, /<strong>83,63<\/strong> из 100 баллов/);
  assert.match(html, /До 7-го места/);
  assert.match(html, /До призовой тройки/);
  assert.match(html, /href="\/race"[^>]*>Гонка недели →/);
  // «Что подтянуть», compact: the goals and the three biggest losses, the rest in «Гонка недели».
  assert.match(html, /data-tour="home-moves"/);
  assert.match(html, /Подняться на 7-е место \(Арман И\.\): нужно \+0,52 балла/);
  assert.match(html, /Где вы теряете больше всего/);
  assert.equal((html.match(/class="race-metric"/g) ?? []).length, 1, "only the metrics that lose points");
  assert.match(html, /href="\/race"[^>]*>Все показатели →/);
  // The table of the race, with the gap to you.
  assert.match(html, /Таблица гонки/);
  assert.match(html, /<th class="num">От вас<\/th>/);
  // Beside them: the month pays the prizes, and what can be done today.
  assert.match(html, /Конкурс месяца/);
  assert.match(html, />1-е место</);
  assert.match(html, /Отрыв 0,39 балла · следом Данияр А\./);
  assert.match(html, /Приз сейчас — 400 коинов/);
  assert.match(html, /Закрыто 2 из 5 недель/);
  assert.match(html, /Ситуации дня · 0 из 3/);
  assert.match(html, /\+3 коина/);
  assert.match(html, /Миссия готова/);
  assert.match(html, /\+25 опыта/);
  assert.match(html, /id="wallet"/);
  assert.match(html, /На счету 300 коинов/);
  for (const href of ["/rating", "/training/city?open=quests", "/training/city?district=academy&amp;mission=welcome", "/shop", "/wallet"]) assert.ok(html.includes(`href="${href}"`), href);
  assert.ok(html.indexOf("home-slot--hero") < html.indexOf("home-slot--advice") && html.indexOf("home-slot--advice") < html.indexOf("home-slot--table") && html.indexOf("home-slot--table") < html.indexOf("home-slot--month"));
  assert.doesNotMatch(html, /home-track|class="home-move|NaN|undefined/);
});

test("a weekly contest and an open chest change only their own parts", () => {
  state = everything({ race: race({ period: "week", prizes: [300, 200, 150] }), wheel: { enabled: true, free_left: 1, chest: { unlocked: true, answered: 3, total: 3 } } });
  const html = render();
  assert.doesNotMatch(html, /Конкурс месяца/);
  assert.match(html, /Сундук дня открыт/);
  assert.match(html, /href="\/games\?tab=wheel"/);
  assert.doesNotMatch(html, /Ситуации дня · /);
});

test("without one's own metrics the home says so, keeps the table without gaps and today, and offers no advice", () => {
  state = everything({ race: race({ me: null, next: null, behind: null, advice: null, standings: standings().map((row) => ({ ...row, is_me: false })) }) });
  let html = render();
  assert.match(html, /<h1 class="page-title">Мой кабинет<\/h1>/);
  assert.match(html, /Вас пока нет в гонке этой недели/);
  assert.match(html, /Таблица гонки/);
  assert.doesNotMatch(html, /От вас|home-moves|Что подтянуть|из 100 баллов/);
  assert.match(html, />Сегодня</);
  // Before the first week there is nothing to race in yet.
  state = everything({ race: race({ week: null, me: null, standings: [], advice: null }) });
  html = render();
  assert.match(html, /Гонка ещё не началась/);
  assert.doesNotMatch(html, /Таблица гонки/);
  assert.match(html, />Сегодня</);
});
