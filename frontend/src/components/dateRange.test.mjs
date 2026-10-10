import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
async function load(path) {
  const built = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

const { validDateRange, inclusiveRangeDays, formatDateRange, todayDateKey, presetDateRange, rangeCalendarDays, moveCalendarMonth } = await load("./dateRange.ts");
const range = (date_from, date_to = date_from) => ({ date_from, date_to });

test("arbitrary date periods include both endpoints and allow one day", () => {
  assert.equal(inclusiveRangeDays(range("2026-10-05")), 1);
  assert.equal(inclusiveRangeDays(range("2026-10-05", "2026-10-07")), 3);
  assert.equal(inclusiveRangeDays(range("2026-12-27", "2027-01-05")), 10);
  assert.equal(inclusiveRangeDays(range("2024-02-01", "2024-02-29")), 29);
});

test("invalid, empty, reversed and normalized date ranges cannot be applied", () => {
  for (const value of [undefined, range(""), range("2026-02-29"), range("2026-10-08", "2026-10-07"), range("2026-1-05"), range("0000-01-01"), range("2026-09-31"), range("2026-10-05T00:00:00Z")]) {
    assert.equal(validDateRange(value), false);
    assert.equal(inclusiveRangeDays(value), 0);
    assert.equal(formatDateRange(value), "Выбрать период");
  }
  assert.equal(validDateRange(range("0001-01-01", "9999-12-31")), true);
});

test("a full month preset uses calendar boundaries and includes leap days", () => {
  assert.deepEqual(presetDateRange("this-month", "2024-02-13"), range("2024-02-01", "2024-02-29"));
  assert.deepEqual(presetDateRange("last-month", "2026-01-15"), range("2025-12-01", "2025-12-31"));
  assert.deepEqual(presetDateRange("this-month", "9999-12-15"), range("9999-12-01", "9999-12-31"));
});

test("3 and 10 day presets count back inclusively rather than snapping to a week", () => {
  assert.deepEqual(presetDateRange("today", "2026-10-10"), range("2026-10-10"));
  assert.deepEqual(presetDateRange("three-days", "2026-10-10"), range("2026-10-08", "2026-10-10"));
  assert.deepEqual(presetDateRange("ten-days", "2026-01-05"), range("2025-12-27", "2026-01-05"));
  assert.throws(() => presetDateRange("today", "2026-02-29"), RangeError);
});

test("business today uses Kazakhstan time across a UTC date boundary", () => {
  assert.equal(todayDateKey(new Date("2026-10-09T18:59:00Z")), "2026-10-09");
  assert.equal(todayDateKey(new Date("2026-10-09T19:00:00Z")), "2026-10-10");
});

test("range arithmetic and formatting ignore browser timezone and DST", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["Pacific/Honolulu", "Pacific/Kiritimati", "Asia/Qyzylorda", "America/New_York"]) {
      process.env.TZ = zone;
      assert.equal(inclusiveRangeDays(range("2026-03-07", "2026-03-09")), 3);
      assert.equal(formatDateRange(range("2026-12-30", "2027-01-02")), "30.12.2026 — 02.01.2027");
      assert.equal(formatDateRange(range("2026-10-10")), "10.10.2026");
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("calendar allows every individual date independently of calculated weeks", () => {
  const days = rangeCalendarDays("2026-10");
  assert.deepEqual(days.slice(0, 7).map((day) => day.key), ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.equal(days.filter((day) => day.inMonth).length, 31);
  assert.ok(days.every((day) => day.selectable));
  assert.equal(rangeCalendarDays("2024-02").find((day) => day.key === "2024-02-29").day, 29);
  assert.equal(rangeCalendarDays("1900-01").filter((day) => day.inMonth).length, 31);
  assert.deepEqual(rangeCalendarDays("invalid-month"), []);
});

test("calendar preserves complete rows without crashing at supported year limits", () => {
  for (const month of ["0001-01", "9999-12"]) {
    const days = rangeCalendarDays(month);
    assert.equal(days.length % 7, 0);
    assert.equal(days.filter((day) => day.inMonth).length, 31);
    assert.ok(days.filter((day) => day.selectable).every((day) => day.key >= "0001-01-01" && day.key <= "9999-12-31"));
  }
  assert.ok(rangeCalendarDays("9999-12").some((day) => !day.selectable));
});

test("keyboard month movement clamps to the last day and crosses years safely", () => {
  assert.equal(moveCalendarMonth("2026-03-31", -1), "2026-02-28");
  assert.equal(moveCalendarMonth("2024-03-31", -1), "2024-02-29");
  assert.equal(moveCalendarMonth("2026-12-31", 1), "2027-01-31");
  assert.equal(moveCalendarMonth("0001-01-01", -1), "0001-01-01");
  assert.equal(moveCalendarMonth("9999-12-31", 1), "9999-12-31");
});

const { DateRangePicker } = await load("./DateRangePicker.tsx");
const render = (props) => renderToStaticMarkup(React.createElement(DateRangePicker, { onChange: () => {}, ...props }));

test("date filter shows a full arbitrary range without a visible week label", () => {
  const html = render({ value: range("2026-10-05", "2026-10-07") });
  assert.match(html, /05\.10\.2026 — 07\.10\.2026/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /Неделя|Предыдущая неделя|Следующая неделя/);
});

test("explicit dates override the last calculated default and same-day dates show once", () => {
  const html = render({ value: range("2026-10-10"), defaultRange: range("2026-08-24", "2026-08-30") });
  assert.match(html, /10\.10\.2026/);
  assert.doesNotMatch(html, /24\.08\.2026/);
  assert.match(render({ defaultRange: range("2026-08-24", "2026-08-30") }), /24\.08\.2026 — 30\.08\.2026/);
});
