import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const built = await transform(readFileSync(new URL("./format.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm" });
const { parseTimestamp, dateTime, periodLabel, weekStatusLabel, pointsWord } = await import(`data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`);

test("SQLite UTC and explicit timezone timestamps represent the same moment", () => {
  const instant = Date.UTC(2026, 8, 5, 23, 30);
  for (const timestamp of ["2026-09-05T23:30:00", "2026-09-05T23:30:00Z", "2026-09-06T04:30:00+05:00"]) {
    assert.equal(parseTimestamp(timestamp).getTime(), instant);
    assert.equal(dateTime(timestamp), dateTime("2026-09-05T23:30:00Z"));
  }
});

test("a week reads «19–25 окт.», «28 сент. – 4 окт.» and an open week that is over is «Не рассчитана»", () => {
  assert.equal(periodLabel("2026-10-19", "2026-10-25"), "19–25 окт.");
  assert.equal(periodLabel("2026-09-28", "2026-10-04"), "28 сент. – 4 окт.");
  assert.equal(periodLabel("2026-12-28", "2027-01-03"), "28 дек. – 3 янв.");
  const today = new Date(2026, 9, 21);
  assert.equal(weekStatusLabel({ status: "open", ends_on: "2026-10-25" }, today), "Идёт");
  assert.equal(weekStatusLabel({ status: "open", ends_on: "2026-10-18" }, today), "Не рассчитана");
  assert.equal(weekStatusLabel({ status: "calculated", ends_on: "2026-10-18" }, today), "Рассчитана");
  assert.equal(weekStatusLabel({ status: "closed", ends_on: "2026-10-18" }, today), "Опубликована");
  assert.deepEqual([1, 2, 5, 21, 100, 97.9, 359.58].map(pointsWord), ["балл", "балла", "баллов", "балл", "баллов", "балла", "балла"]);
});
