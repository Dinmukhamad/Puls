import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(entry) {
  return build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    loader: { ".css": "empty" }, write: false,
  }).then(built => {
    const module = { exports: {} };
    new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
    return module.exports;
  });
}
const { CityTasks } = await load("./CityTasks.tsx");
const { CityToolbarButton } = await load("./CityToolbar.tsx");

const quest = (slot, answered, correct = null) => ({
  slot, giver: "guide", title: "Ситуация дня", speaker: slot === 0 ? "Водитель" : "Клиент", text: `Вопрос ${slot}`,
  options: ["А", "Б"], answered, answer: answered ? 0 : null, correct, right: answered ? 0 : null, explanation: null, coins: correct ? 10 : 0,
});
const scenario = (id, extra) => ({
  id, kind: "simulator", title: `Сценарий ${id}`, description: "", world: "Driver Simulator", difficulty: "medium", minutes: 30,
  status: "published", is_required: true, deadline: null, allow_back: true, pass_percent: 80, coins_reward: 0, revision: 1, step_count: 3,
  is_driver: true, assigned: true, state: "new", completed: false, ...extra,
});
const render = props => renderToStaticMarkup(React.createElement(CityTasks, {
  quests: [], coins: 10, assigned: [], onQuest() {}, onStart() {}, starting: null, error: null, ...props,
}));
const texts = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("the day's situations show what is left, what was right and what the reward is", () => {
  const html = render({ quests: [quest(0, true, true), quest(1, true, false), quest(2, false)] });
  assert.match(html, /<h2 id="city-tasks-day">Задания дня<\/h2><span>2 из 3<\/span>/);
  const states = [...html.matchAll(/class="city-task__state">([^<]+)</g)].map(match => match[1]);
  assert.deepEqual(states, ["✓ +10", "Разбор", "Ответить"]);
  assert.equal((html.match(/data-done="true"/g) ?? []).length, 2, "answered situations are dimmed");
  assert.match(texts(html), /Верный ответ — \+10 коинов\./);
  assert.doesNotMatch(html, /От тренера/, "no trainer section without assignments");
  const done = render({ quests: [quest(0, true, true), quest(1, true, true), quest(2, true, false)] });
  assert.match(texts(done), /На сегодня всё\. Новые задания появятся завтра\./);
});

test("an operator who answered every situation is told so, not left with a missing button", () => {
  const html = render({ quests: [], allPassed: true });
  assert.match(html, /<h2 id="city-tasks-day">Задания дня<\/h2>/);
  assert.match(texts(html), /Все ситуации дня пройдены: они не повторяются\. Новые появятся, когда тренер их добавит\./);
  assert.doesNotMatch(render({ quests: [] }), /Задания дня/, "a staff preview has no situations at all");
});

test("trainer scenarios list what is left first, by deadline, with the right action", () => {
  const html = render({ assigned: [
    scenario(1, { state: "passed", completed: true }),
    scenario(2, { deadline: "2026-10-20T12:00:00Z" }),
    scenario(3, { state: "in_progress", deadline: "2026-10-14T12:00:00Z" }),
  ] });
  assert.doesNotMatch(html, /Задания дня/, "no day section without situations");
  assert.match(html, /<h2 id="city-tasks-trainer">От тренера<\/h2><span>1 из 3<\/span>/);
  assert.deepEqual([...html.matchAll(/<strong>(Сценарий \d)<\/strong>/g)].map(match => match[1]), ["Сценарий 3", "Сценарий 2", "Сценарий 1"]);
  assert.deepEqual([...html.matchAll(/class="city-secondary city-task__start"[^>]*>([^<]+)</g)].map(match => match[1]), ["Продолжить", "Начать", "Повторить"]);
  assert.match(texts(html), /В процессе · до 14\.10\.2026/);
  assert.match(texts(html), /✓ Пройдено/);
});

test("a starting scenario blocks the others and an error stays in view", () => {
  const html = render({ assigned: [scenario(1), scenario(2)], starting: 2, error: "Сначала завершите текущую смену перед другим сценарием" });
  const buttons = [...html.matchAll(/<button type="button" class="city-secondary city-task__start"( disabled="")?[^>]*>([^<]+)</g)];
  assert.deepEqual(buttons.map(match => [!!match[1], match[2]]), [[true, "Начать"], [true, "Запускаем…"]]);
  assert.match(html, /role="alert">Сначала завершите текущую смену перед другим сценарием</);
});

test("a toolbar button without a toolbar renders in place, drawn like the panels' buttons", () => {
  const html = renderToStaticMarkup(React.createElement(CityToolbarButton, { slot: "cities", label: "Города · Техподдержка. Выбрать город", compactLabel: "Города", icon: "🗺️", onClick() {} }));
  assert.match(html, /^<div class="city-peek city-peek--labelled city-toolbar-button"><button type="button" class="city-peek__trigger glass glass--regular" aria-label="Города · Техподдержка\. Выбрать город"/);
  assert.match(html, /<span class="city-peek__label" aria-hidden="true">Города<\/span>/);
  assert.doesNotMatch(html, /aria-expanded/, "it acts at once: there is no popup to expand");
});
