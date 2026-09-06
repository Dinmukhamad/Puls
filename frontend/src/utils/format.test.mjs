import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const built = await transform(readFileSync(new URL("./format.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm" });
const { parseTimestamp, dateTime } = await import(`data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`);

test("SQLite UTC and explicit timezone timestamps represent the same moment", () => {
  const instant = Date.UTC(2026, 8, 5, 23, 30);
  for (const timestamp of ["2026-09-05T23:30:00", "2026-09-05T23:30:00Z", "2026-09-06T04:30:00+05:00"]) {
    assert.equal(parseTimestamp(timestamp).getTime(), instant);
    assert.equal(dateTime(timestamp), dateTime("2026-09-05T23:30:00Z"));
  }
});
