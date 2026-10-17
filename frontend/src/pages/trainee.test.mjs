import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const result = await build({ entryPoints: [fileURLToPath(new URL("./TraineePage.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", external: ["./city/CityMap"], jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { trainingSummary, TraineeProgress } = module.exports;

test("trainee progress preserves completed historical stages and excludes paused new stages", () => {
  const data = { missions: [{ key: "first", enabled: true, state: "completed" }, { key: "historic", enabled: false, state: "completed" }, { key: "next", enabled: true, state: "available" }, { key: "paused", enabled: false, state: "unavailable" }] };
  const summary = trainingSummary(data);
  assert.equal(summary.completed, 2);
  assert.equal(summary.total, 3);
  assert.equal(summary.percent, 67);
  const html = renderToStaticMarkup(React.createElement(TraineeProgress, { data }));
  assert.match(html, /67%/);
  assert.match(html, /Пройдено 2 из 3 этапов/);
  assert.doesNotMatch(html, /койн|коин|XP|баланс|уровень/i);
});

test("empty training program does not claim completion", () => {
  const data = { missions: [] };
  assert.equal(trainingSummary(data).percent, 0);
  const html = renderToStaticMarkup(React.createElement(TraineeProgress, { data }));
  assert.match(html, /Программа появится после назначения обучения/);
});
