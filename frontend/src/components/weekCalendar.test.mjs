import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const built = await transform(readFileSync(new URL("./weekCalendar.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm" });
const { calendarDate, dateKey, shiftMonth, monthCaption, weekRange, availableWeeks, adjacentWeek, calendarWeeks, adjacentAvailableMonth } = await import(`data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`);
const week = (id, starts_on, ends_on, status = "closed") => ({ id, starts_on, ends_on, status, label: "not-for-the-user" });
const dates = [week(701, "2026-09-14", "2026-09-20"), week(702, "2026-09-28", "2026-10-04"), week(703, "2026-10-05", "2026-10-11", "calculated"), week(704, "2026-10-12", "2026-10-18", "open")];

test("date-only parsing rejects normalized and invalid calendar dates", () => {
  for (const value of ["2026-02-29", "2026-13-01", "2026-09-31", "2026-1-05", "", "2026-10-05T00:00:00Z"]) assert.equal(calendarDate(value), null);
  assert.equal(dateKey(calendarDate("2024-02-29")), "2024-02-29");
});

test("week ranges are dates with both years when crossing New Year", () => {
  assert.equal(weekRange(dates[2]), "05.10–11.10.2026");
  assert.equal(weekRange(dates[2], true), "05.10.2026–11.10.2026");
  assert.equal(weekRange(week(1, "2026-12-28", "2027-01-03")), "28.12.2026–03.01.2027");
  assert.equal(weekRange(week(1, "invalid", "2027-01-03")), "Даты недели недоступны");
});

test("formatting and calendar rows ignore browser timezone offsets and DST", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["Pacific/Honolulu", "Pacific/Kiritimati", "Asia/Qyzylorda", "America/New_York"]) {
      process.env.TZ = zone;
      assert.equal(weekRange(dates[2]), "05.10–11.10.2026");
      const rows = calendarWeeks("2026-03", [week(1, "2026-03-02", "2026-03-08")]);
      assert.equal(rows[1].days.at(-1).key, "2026-03-08");
      assert.equal(rows[1].week.id, 1);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("sorting uses actual week dates rather than ID, label, or API order", () => {
  assert.deepEqual(availableWeeks([dates[3], dates[0], dates[2], dates[1]]).map((row) => row.id), [701, 702, 703, 704]);
  assert.deepEqual(availableWeeks([week(999, "2026-09-21", "2026-09-27"), week(1, "2026-09-28", "2026-10-04")]).map((row) => row.id), [999, 1]);
});

test("arrows skip missing periods and never synthesize API IDs", () => {
  assert.equal(adjacentWeek(dates, 702, -1).id, 701);
  assert.equal(adjacentWeek(dates, 702, 1).id, 703);
  assert.equal(adjacentWeek(dates, 701, -1), undefined);
  assert.equal(adjacentWeek(dates, 704, 1), undefined);
  assert.equal(adjacentWeek(dates, 123, 1), undefined);
  assert.equal(adjacentWeek([], undefined, -1), undefined);
});

test("calendar is Monday through Sunday and keeps a cross-month week selectable", () => {
  const rows = calendarWeeks("2026-10", dates);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].start, "2026-09-28");
  assert.deepEqual(rows[0].days.map((day) => day.day), [28, 29, 30, 1, 2, 3, 4]);
  assert.deepEqual(rows[0].days.map((day) => day.inMonth), [false, false, false, true, true, true, true]);
  assert.equal(rows[0].week.id, 702);
  assert.equal(rows[1].week.id, 703);
  assert.equal(rows[3].week, undefined);
  assert.equal(rows[4].days.at(-1).key, "2026-11-01");
});

test("six-row, four-row and leap-month calendars have complete week rows", () => {
  assert.equal(calendarWeeks("2026-03", []).length, 6);
  assert.equal(calendarWeeks("2021-02", []).length, 4);
  assert.ok(calendarWeeks("2024-02", []).flatMap((row) => row.days).some((day) => day.key === "2024-02-29"));
  assert.deepEqual(calendarWeeks("not-a-month", []), []);
});

test("January displays the preceding December days and correct calendar year", () => {
  const period = week(501, "2026-12-28", "2027-01-03");
  const row = calendarWeeks("2027-01", [period])[0];
  assert.equal(row.week.id, 501);
  assert.deepEqual(row.days.map((day) => day.key), ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2027-01", -1), "2026-12");
  assert.match(monthCaption("2027-01"), /январь 2027/);
});

test("available month navigation includes end-month and skips wholly absent months", () => {
  const periods = [dates[1], week(999, "2026-12-28", "2027-01-03")];
  assert.equal(adjacentAvailableMonth("2026-09", periods, 1), "2026-10");
  assert.equal(adjacentAvailableMonth("2026-10", periods, 1), "2026-12");
  assert.equal(adjacentAvailableMonth("2027-01", periods, -1), "2026-12");
  assert.equal(adjacentAvailableMonth("2027-01", periods, 1), undefined);
});

test("invalid periods cannot become clickable calendar choices", () => {
  const invalid = [week(0, "2026-10-05", "2026-10-11"), week(3, "2026-10-06", "2026-10-12"), week(4, "2026-10-05", "2026-10-12"), week(5, "bad-date", "2026-10-11")];
  assert.deepEqual(availableWeeks(invalid), []);
  assert.ok(calendarWeeks("2026-10", invalid).every((row) => row.week === undefined));
});

const require = createRequire(import.meta.url);
const component = await build({ entryPoints: [fileURLToPath(new URL("./WeekPicker.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", component.outputFiles[0].text)(require, module, module.exports);
const { WeekPicker } = module.exports;
const render = (props) => renderToStaticMarkup(React.createElement(WeekPicker, { weeks: dates, onChange: () => {}, ...props }));

test("ranked default displays API-resolved dates while preserving an automatic latest mode", () => {
  const html = render({ resolvedWeekId: 702 });
  assert.match(html, /28\.09–04\.10\.2026/);
  assert.match(html, /Последняя рассчитанная/);
  assert.doesNotMatch(html, /not-for-the-user|2026-W|<select/);
});

test("explicit calendar selection shows dates and readable status", () => {
  const html = render({ value: 704, resolvedWeekId: 703 });
  assert.match(html, /12\.10–18\.10\.2026/);
  assert.match(html, /Идёт/);
  assert.match(html, /aria-label="Следующая неделя"[^>]*disabled=""/);
  assert.doesNotMatch(html, /Последняя рассчитанная/);
});

test("analytics latest mode selects newest calendar dates including an open week", () => {
  const html = render({ latestPreference: "latest", latestLabel: "Последняя неделя" });
  assert.match(html, /12\.10–18\.10\.2026/);
  assert.match(html, /Последняя неделя/);
});

test("unresolved ranked defaults cannot navigate relative to a guessed result week", () => {
  const html = render({ resolvedWeekId: undefined });
  assert.match(html, /Последняя рассчитанная/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
  assert.doesNotMatch(html, /05\.10–11\.10\.2026/);
});

test("empty and loading controls explain absence and do not offer fabricated arrow choices", () => {
  const empty = render({ weeks: [] });
  assert.match(empty, /Нет доступных недель/);
  assert.equal((empty.match(/disabled=""/g) ?? []).length, 2);
  assert.match(render({ weeks: [], loading: true }), /Загрузка недель/);
});
