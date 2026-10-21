import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
async function load(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}
const { definitionRow, badgeIcon } = await load("./definitionPresentation.ts");
const { periodNext } = await load("./PeriodsPage.tsx");
const { reportedTo, monthName, monthWeeks } = await load("./ReportsUpload.tsx");
const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const metric = (extra = {}) => ({ id: 1, code: "quality", title: "Качество работы", description: null, is_active: true, kind: "positive", direction: "higher_is_better", target_value: 100, unit: "%", max_points: 25, penalty_per_unit: 0, allow_overachievement: false, ...extra });

test("a metric's row says how it counts and shows its target or its fine", () => {
  assert.deepEqual(definitionRow("metrics", metric()), { meta: "Больше — лучше", value: "Цель 100 %", hint: "25 баллов за цель", coin: false });
  assert.equal(definitionRow("metrics", metric({ allow_overachievement: true, description: "По оценкам проверяющих" })).meta, "Больше — лучше · перевыполнение разрешено · По оценкам проверяющих");
  const late = metric({ title: "Опоздания", kind: "anti", unit: "шт", penalty_per_unit: 2 });
  assert.deepEqual([definitionRow("metrics", late).value, definitionRow("metrics", late).hint], ["−2 балла", "за каждую 1 шт"]);
  // No fine in points is not «−0 баллов»: the fine in coins lives in the rules.
  assert.deepEqual([definitionRow("metrics", { ...late, penalty_per_unit: 0 }).value, definitionRow("metrics", { ...late, penalty_per_unit: 0 }).hint], ["Без штрафа в баллах", "штраф в коинах — в правилах расчёта"]);
});

test("a nomination's and an achievement's row show the reward on the right", () => {
  const nomination = { id: 2, code: "best_calls", title: "Лучший по звонкам", is_active: true, metric_code: "quality", direction: "higher_is_better", require_zero: false, min_value: null, coins_reward: 100 };
  assert.deepEqual(definitionRow("nominations", nomination, [metric()]), { meta: "Качество работы · Максимальное значение", value: "100 коинов", hint: "победителю", coin: true });
  const badge = { id: 3, code: "top3", title: "Топ-3 недели", is_active: true, rule_type: "top_rank", rule_params: { max_rank: 3 }, coins_reward: 0, is_repeatable: false, icon: "medal" };
  assert.deepEqual(definitionRow("badges", badge), { meta: "Войти в топ-3 рейтинга · один раз", value: "Без коинов", hint: "только достижение", coin: false });
  assert.deepEqual(["medal", "crown", "🔥", "unknown", ""].map(badgeIcon), ["🏅", "👑", "🔥", "★", "★"]);
});

test("metrics, nominations and achievements are lists of rows: a row opens the editor, or the details for readers", () => {
  const page = read("./SettingsPage.tsx");
  assert.doesNotMatch(page, /definition-card|>Подробнее</);
  assert.match(page, /<button type="button" className=\{`definition-row\$\{row\.is_active \? "" : " is-inactive"\}`\} onClick=\{\(\) => atLeast\("head"\) \? setEditor\(row\) : setDetails\(row\)\}/);
  // The results by channel, each adding up to 100 points (docs/CHANNELS.md); the penalties are common.
  assert.match(page, /\{ title: "Линия · рабочие результаты", subtitle: `\$\{count\(results\("line"\)/);
  assert.match(page, /\{ title: "Чаты · рабочие результаты", subtitle: `\$\{count\(results\("chat"\)/);
  assert.match(page, /\{ title: "Штрафные показатели", subtitle: `\$\{count\(penalties/);
  assert.match(page, /\{kind === "badges" && <span className="definition-row__icon" aria-hidden="true">\{badgeIcon\(row\.icon\)\}<\/span>\}/);
});

test("the rules show every number with its unit, the course under the rate, and the save bar only after a change", () => {
  const page = read("./SettingsPage.tsx"), css = read("./configuration.css");
  for (const unit of ['unit: "баллов"', 'unit: C', 'unit: "чел."', 'unit: "симв."', 'unit: "₸"']) assert.ok(page.includes(unit), unit);
  // Driver gratitude is paused (docs/CHANNELS.md): its bonus and monthly limit are not offered.
  assert.doesNotMatch(page, /driver_gratitude_bonus|gratitude_monthly_limit/);
  assert.match(page, /key: "prize_min_points", label: "Минимум для приза за место"/);
  assert.match(page, /: spec\.unit \? <span className="input-unit"><input className="input" type="number" inputMode="decimal"/);
  assert.match(page, /\{index === 0 && <div className="configuration-example" aria-label="Проверка курса">/);
  assert.doesNotMatch(page, /<Card title="Проверка курса"/);
  // A retyped «50.0» is not a change; «Отменить» brings the saved rules back.
  assert.match(page, /const dirty = normalizedRules\(values\) !== normalizedRules\(\{ \.\.\.initial \}\);/);
  assert.match(page, /\{dirty && <Button disabled=\{save\.isPending\} onClick=\{\(\) => \{ setValues\(\{ \.\.\.initial \}\); save\.reset\(\); \}\}>Отменить<\/Button>\}/);
  assert.match(css, /\.rules-save\.is-dirty \{ position: sticky; bottom: var\(--sp-4\);/);
  assert.match(css, /\.rules-grid \{ column-count: 2; column-gap: var\(--sp-5\); \}/);
});

test("periods are a history of weeks; a week opens with its status and actions at the top and its results as a table", () => {
  assert.equal(periodNext({ status: "open", calculated_at: null, closed_at: null }), "Идёт · загрузите показатели и рассчитайте");
  assert.equal(periodNext({ status: "calculated", calculated_at: "2026-10-17T08:00:00Z", closed_at: null }), "Рассчитана 17.10.2026 · проверьте итоги и опубликуйте");
  assert.equal(periodNext({ status: "closed", calculated_at: null, closed_at: "2026-10-17T09:00:00Z" }), "Итоги опубликованы 17.10.2026");
  // How far the monthly team reports go (docs/SZOV_REPORTS.md).
  assert.equal(reportedTo({ month: "2026-09", reported_to: { line: "2026-09-30", chat: "2026-09-30" } }), "весь месяц");
  assert.equal(reportedTo({ month: "2026-10", reported_to: { line: "2026-10-16", chat: "2026-10-16" } }), "по 16.10");
  assert.equal(reportedTo({ month: "2026-10", reported_to: { line: "2026-10-31", chat: "2026-10-15" } }), "линия весь месяц · чаты по 15.10");
  assert.equal(reportedTo({ month: "2026-10", reported_to: {} }), "нет отчёта команды");
  assert.equal(monthName("2026-10"), "Октябрь 2026");
  // The month's weeks in date order, whatever list they came from.
  const weeks = monthWeeks({
    weeks: [{ label: "W41", starts_on: "2026-10-05", ends_on: "2026-10-11", status: "closed", operators: 4 }, { label: "W42", starts_on: "2026-10-12", ends_on: "2026-10-18", status: "calculated", operators: 4 }],
    pending: [{ label: "W40", starts_on: "2026-09-28", ends_on: "2026-10-04", operators: 4, reason: "ждёт отчёта за сентябрь" }],
  });
  assert.deepEqual(weeks.map((week) => [week.label, week.state]), [["W40", "pending"], ["W41", "closed"], ["W42", "saved"]]);
  // A week is published once it is over.
  const week = { calculated_at: null, closed_at: null, ends_on: "2026-10-25" };
  assert.equal(periodNext({ ...week, status: "open" }, "2026-10-26"), "Завершилась · загрузите показатели и рассчитайте");
  assert.equal(periodNext({ ...week, status: "calculated" }, "2026-10-25"), "Рассчитана · предварительно, неделя ещё идёт");
  const page = read("./PeriodsPage.tsx");
  assert.doesNotMatch(page, /<Select|Отчётный период|workflow-result"/);
  assert.match(page, /<button type="button" className="period-row" onClick=\{\(\) => selectWeek\(item\.id\)\}>/);
  assert.match(page, /const history = \[\.\.\.\(weeks\.data \?\? \[\]\)\]\.sort\(\(x, y\) => y\.starts_on\.localeCompare\(x\.starts_on\)\);/);
  assert.match(page, /<button type="button" className="periods-back" onClick=\{\(\) => selectWeek\(\)\}>← Все периоды<\/button>/);
  // The actions sit in the week's header, before the steps and the long list.
  assert.ok(page.indexOf(">Опубликовать итоги</Button>") < page.indexOf('<ol className="workflow-steps"'));
  assert.ok(page.indexOf('<ol className="workflow-steps"') < page.indexOf('<ol className="period-results"'));
  // A published week no longer asks to load; the line and the chats each have their own places.
  assert.match(page, /\{!closed && !!preview\.data\.missing_metrics\.length && <p className="workflow-error">/);
  assert.match(page, /byChannel\(preview\.data\.rows\)/);
  // A file with errors is not «ready»: it says what blocks the save.
  assert.match(page, /Сохранить можно, когда в файле не останется ошибок/);
  // Data nobody has is said once, not on every row; a row names only its own gaps.
  assert.match(page, /const own = \(row\.missing_metrics \?\? \[\]\)\.filter\(code => !common\.has\(code\)\);/);
  assert.match(page, /\[\[row\.coins_from_points, "за баллы"\], \[row\.coins_rank_bonus, "за место"\], \[row\.coins_discipline_bonus, "дисциплина"\], \[row\.coins_nomination_bonus, "номинации"\]\]/);
  // A new week is opened from a window with the site's calendar.
  assert.match(page, /\{opening && <Sheet title="Открыть неделю"/);
  assert.match(page, /<DatePicker ariaLabel="Любой день недели" value=\{date\} onChange=\{setDate\}/);
});

test("the rating names the operator's team as the rest of the site does", () => {
  const page = read("./RatingPage.tsx");
  assert.match(page, /<th>Команда<\/th>/);
  assert.doesNotMatch(page, /<th>Группа<\/th>/);
});
