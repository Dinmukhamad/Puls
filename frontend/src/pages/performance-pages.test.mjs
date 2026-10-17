/**
 * «Показатели» in the site's style: the tab names are the page titles, the lists are the site's, the weeks are a
 * history to pick from, and each row says what it is worth.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
async function load(file) {
  const built = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}
const periods = await load("./PeriodsPage.tsx");
const settings = await load("./SettingsPage.tsx");
const uploads = await load("./ReportsUpload.tsx");

test("each tab of the section opens a page with its own name", () => {
  assert.match(read("./PeriodsPage.tsx"), /<h1 className="page-title">Расчёт и история периодов<\/h1>/);
  assert.match(read("./SettingsPage.tsx"), /<h1 className="page-title">Правила расчёта<\/h1>/);
  assert.match(read("./SettingsPage.tsx"), /metrics: "Рабочие показатели", nominations: "Номинации"/);
  const navigation = read("../navigation.ts");
  for (const title of ["Расчёт и история периодов", "Рабочие показатели", "Правила расчёта", "Номинации"]) assert.match(navigation, new RegExp(`"${title}"`), title);
});

test("the section's lists and pickers are the site's, not the system's", () => {
  for (const file of ["PeriodsPage.tsx", "ReportsUpload.tsx", "SettingsPage.tsx", "MonthContest.tsx"]) assert.doesNotMatch(read(`./${file}`), /<select|<option|type="date"|type="month"/, file);
  // A file is chosen with the site's button; the system's input stays hidden behind it.
  for (const file of ["PeriodsPage.tsx", "ReportsUpload.tsx"]) assert.match(read(`./${file}`), /className="periods-file-input" type="file"/, file);
  assert.doesNotMatch(read("./SettingsPage.tsx"), /configuration-nav|definition-card/);
});

test("the weeks that can be opened are listed, current first, without the open ones", () => {
  const today = new Date(2026, 9, 17); // Saturday, 17 October 2026
  const all = periods.newWeekChoices([], today);
  assert.equal(all.length, 11);
  assert.deepEqual(all[0], { value: "2026-10-12", label: "12.10–18.10 · текущая" });
  assert.deepEqual(all[1], { value: "2026-10-05", label: "05.10–11.10 · прошлая" });
  // The weeks ahead come after the past ones.
  assert.deepEqual(all.slice(-2).map((choice) => choice.label), ["19.10–25.10 · следующая", "26.10–01.11"]);
  const left = periods.newWeekChoices([{ starts_on: "2026-10-12" }, { starts_on: "2026-10-05" }], today);
  assert.equal(left[0].value, "2026-09-28");
  // Across the new year the other year is named.
  assert.equal(periods.newWeekChoices([], new Date(2026, 11, 30))[0].label, "28.12–03.01.2027 · текущая");
});

test("the history says how many weeks are closed and what each one waits for", () => {
  assert.equal(periods.historySummary([{ status: "closed" }, { status: "closed" }, { status: "open" }]), "3 недели · 2 закрыты · 1 в работе");
  assert.match(periods.historySummary([]), /^Недель пока нет/);
  const week = { starts_on: "2026-10-12", ends_on: "2026-10-18", calculated_at: null, closed_at: null };
  assert.equal(periods.weekNote({ ...week, status: "open" }, "2026-10-17"), "Текущая неделя");
  assert.equal(periods.weekNote({ ...week, status: "open" }, "2026-10-20"), "Ждёт расчёта");
  assert.equal(periods.weekNote({ ...week, status: "open" }, "2026-10-01"), "Ещё не началась");
  assert.equal(periods.weekNote({ ...week, status: "closed", closed_at: "2026-10-19T03:00:00" }), "Итоги опубликованы 19.10");
  assert.equal(periods.weekNote({ ...week, status: "calculated", calculated_at: "2026-10-19T09:00:00" }), "Расчёт от 19.10 ждёт публикации");
  const sorted = periods.sortedWeeks([{ starts_on: "2026-09-28" }, { starts_on: "2026-10-12" }, { starts_on: "2026-10-05" }]);
  assert.deepEqual(sorted.map((item) => item.starts_on), ["2026-10-12", "2026-10-05", "2026-09-28"]);
});

test("a result line names only the parts of the coins that pay, and fractional points read «балла»", () => {
  assert.equal(periods.coinParts({ coins_from_points: 187, coins_rank_bonus: 0, coins_discipline_bonus: 15, coins_nomination_bonus: 0 }), "за баллы 187 · дисциплина +15");
  assert.equal(periods.coinParts({ coins_from_points: 150, coins_rank_bonus: 300, coins_discipline_bonus: 40, coins_nomination_bonus: 100 }), "за баллы 150 · место +300 · дисциплина +40 · номинация +100");
  assert.equal(periods.pointsWord(93.79), "балла");
  assert.equal(periods.pointsWord(90.24), "балла");
  assert.equal(periods.pointsWord(21), "балл");
  assert.equal(periods.pointsWord(100), "баллов");
  const rows = [{ missing_metrics: [] }, { missing_metrics: ["quality"] }];
  assert.equal(periods.resultsSummary({ participants: 12, rows }, false), "12 участников · у 1 не хватает данных · до публикации коины не начисляются");
  assert.equal(periods.resultsSummary({ participants: 2, rows: [] }, true), "Коины начислены при публикации");
});

const metric = (extra) => ({ id: 1, code: "quality", title: "Качество", description: null, is_active: true, kind: "positive", unit: "%", direction: "higher_is_better", target_value: 100, max_points: 25, penalty_per_unit: 0, allow_overachievement: false, ...extra });
const rules = { lateness_metric_code: "lateness", lateness_fine: 50, no_lateness_bonus: 25, forbidden_sites_metric_code: "sites", forbidden_site_fine: 30, no_forbidden_sites_bonus: 0 };

test("the metrics page counts the week's points and a target row shows its share", () => {
  const rows = [metric({ max_points: 25 }), metric({ id: 2, code: "hours", max_points: 75 }), metric({ id: 3, code: "old", max_points: 40, is_active: false }), metric({ id: 4, code: "lateness", kind: "anti", max_points: 0 })];
  assert.equal(settings.weekPoints(rows), 100);
  assert.equal(settings.definitionSummary("metrics", rows), "2 показателя конкурса · до 100 баллов за неделю · 1 штрафной · 1 неактивная запись");
  assert.deepEqual(settings.definitionValue("metrics", rows[0], undefined, 100), { amount: "25", unit: "баллов", share: 25 });
  assert.equal(settings.definitionValue("metrics", rows[2], undefined, 100).share, undefined);
  assert.equal(settings.definitionMeta("metrics", metric({ allow_overachievement: true }), [], undefined), "Цель 100 % · больше — лучше · перевыполнение разрешено");
});

test("a penalty row shows the fine in coins set in the rules, or says there is none", () => {
  const lateness = metric({ code: "lateness", kind: "anti", unit: "шт" });
  assert.deepEqual(settings.definitionValue("metrics", lateness, rules, 100), { amount: "−50", unit: "коинов за 1 шт" });
  assert.equal(settings.definitionMeta("metrics", lateness, [], rules), "Списывается при закрытии недели · неделя без нарушений: +25 коинов");
  // Without the rules only the points penalty is known.
  const points = metric({ code: "custom", kind: "anti", unit: "шт", penalty_per_unit: 2 });
  assert.deepEqual(settings.definitionValue("metrics", points, rules, 100), { amount: "−2", unit: "балла за 1 шт" });
  const none = metric({ code: "custom", kind: "anti", unit: "" });
  assert.deepEqual(settings.definitionValue("metrics", none, rules, 100), { amount: "—", unit: "штраф не задан" });
  assert.equal(settings.definitionMeta("metrics", none, [], rules), "Не выбран в «Правилах расчёта» как опоздания или посторонние сайты");
});

test("nominations and achievements show their reward and condition", () => {
  const metrics = [metric({ code: "calls", title: "Звонки в час", unit: "шт/ч" })];
  const nomination = { id: 7, code: "n", title: "Лучший по звонкам", is_active: true, metric_code: "calls", direction: "higher_is_better", require_zero: false, min_value: null, coins_reward: 100 };
  assert.deepEqual(settings.definitionValue("nominations", nomination, undefined, 0), { amount: "+100", unit: "коинов", coin: true });
  assert.equal(settings.definitionMeta("nominations", nomination, metrics, undefined), "Звонки в час · максимальное значение");
  assert.equal(settings.definitionSummary("nominations", [nomination, { ...nomination, id: 8, coins_reward: 50 }]), "2 активные номинации · от 50 до 100 коинов победителю");
  const badge = { id: 9, code: "b", title: "Сотня", is_active: true, rule_type: "total_earned", rule_params: { gte: 100 }, coins_reward: 0, is_repeatable: true };
  assert.deepEqual(settings.definitionValue("badges", badge, undefined, 0), { amount: "—", unit: "без коинов" });
  assert.equal(settings.definitionMeta("badges", badge, [], undefined), "Заработать 100 коинов за всё время · можно получать повторно");
});

test("the month of the reports is picked from the site's list", () => {
  assert.equal(uploads.monthName("2026-10"), "Октябрь 2026");
  const months = uploads.reportMonths(new Date(2026, 0, 15));
  assert.deepEqual(months[0], { value: "", label: "Из названий файлов" });
  assert.deepEqual(months[1], { value: "2026-01", label: "Январь 2026" });
  assert.deepEqual(months[2], { value: "2025-12", label: "Декабрь 2025" });
  assert.equal(months.length, 13);
});
