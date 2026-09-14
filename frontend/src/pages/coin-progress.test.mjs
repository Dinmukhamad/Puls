import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const result = await build({ entryPoints: [fileURLToPath(new URL("../components/CoinProgress.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { ProgressOverview } = module.exports;
const levels = [{ id: 1, title: "Новичок", min_coins: 0 }, { id: 2, title: "Первый результат", min_coins: 100 }];
const render = (changes = {}) => renderToStaticMarkup(React.createElement(ProgressOverview, { showDetails: true, data: {
  total: 80, available: 10, level_number: 1, current: levels[0], next: levels[1], remaining: 20, progress: .8, levels, achievements: [], ...changes,
} }));

test("coin progress explains spending and shows the exact next target without another currency", () => {
  const html = render();
  assert.match(html, /80<\/strong> коинов заработано за всё время/);
  assert.match(html, /20 коинов/);
  assert.match(html, /Доступно в кошельке: <strong>10 коинов/);
  assert.match(html, /Покупки не снижают уровень/);
  assert.doesNotMatch(html, /\bXP\b|опыт|Всего опыта/i);
});
test("a spent wallet keeps the reached level and its milestone visible", () => {
  const html = render({ total: 100, available: 0, level_number: 2, current: levels[1], next: null, remaining: 0, progress: 1,
    achievements: [{ code: "level_2", category: "level", unlocked: true }] });
  assert.match(html, /Уровень 2/);
  assert.match(html, /100 коинов заработано/);
  assert.match(html, /1 достижение/);
  assert.match(html, /Все настроенные уровни достигнуты/);
});
test("work achievements show criteria, progress and the one-time coin reward", () => {
  const html = render({ achievements: [{ code: "learning_three", category: "work", title: "Учусь и применяю", description: "Три разных задания", unlocked: false,
    progress_percent: 66.7, hint: "Пройдено разных заданий: 2 из 3", coins_reward: 50, coins_awarded: 0, action_url: "/training" }] });
  assert.match(html, /Ближайшее достижение/);
  assert.match(html, /2 из 3/);
  assert.match(html, /Награда за первое получение: 50 коинов/);
});
