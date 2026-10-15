import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { StaticRouter } = require("react-router-dom/server");
const bundle = await build({ entryPoints: [fileURLToPath(new URL("./ScenarioPracticePanel.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { scenarioInspection, canCheckScenarioAppeal, ScenarioPracticePanel } = module.exports;
const attempt = (patch = {}) => ({ id: 42, revision: 2, state: "in_progress", phase: "dispatch", current_step: 2, driver: { id: "driver-one", park_id: "park-one", name: "Учебный водитель" }, opening_message: "Здравствуйте! Хочу подключить Business.", steps: [], practice: { dispatch: false, crm: false, inspections: { profile: false, car: false } }, ...patch });
const render = props => renderToStaticMarkup(React.createElement(StaticRouter, { location: "/" }, React.createElement(ScenarioPracticePanel, { loading: false, onReload() {}, ...props })));

test("only the expected profile in its visible details tab yields the first inspection", () => {
  const current = attempt();
  assert.deepEqual(scenarioInspection(current, "driver-one", "park-one", "details"), { driver_id: "driver-one", park_id: "park-one", section: "profile" });
  assert.deepEqual(scenarioInspection(current, "driver-one", "park-one", undefined), { driver_id: "driver-one", park_id: "park-one", section: "profile" });
  for (const [driver, park, tab] of [["another", "park-one", "details"], ["driver-one", "another", "details"], ["driver-one", "park-one", "car"], ["driver-one", "park-one", "income"]]) {
    assert.equal(scenarioInspection(current, driver, park, tab), null);
  }
});

test("the second inspection waits for the car tab and never repeats a completed observation", () => {
  const current = attempt({ current_step: 4, practice: { dispatch: false, crm: false, inspections: { profile: true, car: false } } });
  assert.equal(scenarioInspection(current, "driver-one", "park-one", "details"), null);
  assert.deepEqual(scenarioInspection(current, "driver-one", "park-one", "car"), { driver_id: "driver-one", park_id: "park-one", section: "car" });
  current.practice.inspections.car = true;
  assert.equal(scenarioInspection(current, "driver-one", "park-one", "car"), null);
});

test("dialogue, completed, legacy and absent attempts never record workspace inspections", () => {
  for (const current of [undefined, attempt({ phase: "dialogue" }), attempt({ phase: "crm" }), attempt({ state: "passed" }), attempt({ revision: 1 })]) {
    assert.equal(scenarioInspection(current, "driver-one", "park-one", "details"), null);
  }
});

test("appeal verification only runs for a persisted record at the current CRM gate", () => {
  const current = attempt({ phase: "crm" });
  assert.equal(canCheckScenarioAppeal(current, 801), true);
  for (const [value, id] of [[current, undefined], [current, 0], [undefined, 801], [attempt(), 801], [attempt({ phase: "crm", revision: 1 }), 801], [attempt({ phase: "crm", state: "passed" }), 801], [attempt({ phase: "crm", practice: { crm: true } }), 801]]) assert.equal(canCheckScenarioAppeal(value, id), false);
});

test("workspace keeps the incoming request and recovery controls without the old grading form", () => {
  const html = render({ attempt: attempt(), inspectionError: new Error("Сеть недоступна"), onRetryInspection() {} });
  assert.match(html, /Входящее сообщение/);
  assert.match(html, /Здравствуйте! Хочу подключить Business/);
  assert.match(html, /К диалогу/);
  assert.match(html, /Сеть недоступна/);
  assert.match(html, /Повторить сохранение/);
  assert.doesNotMatch(html, /<input|<select|Business через парк|Классификатор|Проверить данные/);
  const saved = render({ attempt: attempt({ phase: "crm" }), appealId: 801, crmError: new Error("Проверка недоступна"), onCheckAppeal() {} });
  assert.match(saved, /Проверить обращение ещё раз/);
  assert.doesNotMatch(saved, /Создать обращение/);
});
