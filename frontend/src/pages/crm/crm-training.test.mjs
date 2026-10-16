import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const built = await build({ entryPoints: [new URL("./CrmTrainingDock.tsx", import.meta.url).pathname], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false, plugins: [{ name: "guide-fixture", setup(plugin) { plugin.onResolve({ filter: /\/guide$/ }, () => ({ path: "test:guide", external: true })); } }] });
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(name => name === "test:guide" ? { useGuide: () => ({ name: "Пульсар", text: value => value }) } : require(name), module, module.exports);
const { CrmTrainingDock } = module.exports;
const driver = { name: "Учебный водитель", id: "driver-1", phone: "+77010000000", license: "KZ123", park: "iTaxi", city: "Алматы", link: "https://fleet.yandex.kz/contractors/driver-1/details" };
const task = (key, state) => ({ key, state, title: key === "crm_first" ? "Первое обращение" : "Смена номера", speech: "Прошу уточнить доступные тарифы", goal: "Зафиксируйте консультацию", driver, category_path: ["Водитель", "Обычный водитель", "Консультация", "Тарифы"], steps: [{ key: "identity", label: "Данные водителя", status: "pending" }, { key: "category", label: "Категория обращения", status: "pending" }], checks: [], appeal_id: null });
const props = { loading: false, error: null, busy: false, actionError: null, onReload() {}, onStart() {}, onContinue() {}, onEdit() {}, onOpen() {}, onInstructions() {}, onCity() {} };
const render = data => renderToStaticMarkup(React.createElement(CrmTrainingDock, { ...props, data }));

test("CRM stages are server evidence, and later exercises remain locked", () => {
  const html = render({ completed: 0, active_task: "crm_first", tasks: [task("crm_first", "in_progress"), task("crm_phone", "locked")] });
  assert.match(html, /Этап 1 из 2/);
  assert.match(html, /Этапы подтверждает система/);
  assert.match(html, /disabled=""[^>]*class="crm-training-task is-locked"/);
  assert.match(html, /Продолжить заполнение/);
  assert.doesNotMatch(html, /type="checkbox"|Я выполнил|Все шаги выполнены|Следующее задание/);
  assert.match(html, /aria-valuenow="0"/);
});

test("an incorrect saved ticket keeps its errors and offers correction instead of completion", () => {
  const current = { ...task("crm_first", "in_progress"), appeal_id: 71, checks: [{ key: "category", label: "Категория", ok: false, message: "Выбрана жалоба вместо консультации" }], steps: [{ key: "identity", label: "Данные водителя", status: "passed" }, { key: "category", label: "Категория обращения", status: "failed" }] };
  const html = render({ completed: 0, active_task: "crm_first", tasks: [current, task("crm_phone", "locked")] });
  assert.match(html, /Обращение сохранено. Исправьте ошибки/);
  assert.match(html, /Выбрана жалоба вместо консультации/);
  assert.match(html, /Исправить обращение #71/);
  assert.match(html, /Этап 2 из 2/);
  assert.doesNotMatch(html, /Следующее задание|Все задания проверены/);
});

test("only a passed server verdict exposes the next exercise", () => {
  const current = { ...task("crm_first", "passed"), appeal_id: 71, steps: [{ key: "identity", label: "Данные водителя", status: "passed" }], checks: [{ key: "identity", label: "Данные водителя", ok: true, message: "" }] };
  const html = render({ completed: 1, active_task: "crm_first", tasks: [current, task("crm_phone", "available")] });
  assert.match(html, /Проверка пройдена/);
  assert.match(html, /Все этапы проверены/);
  assert.match(html, /Следующее задание/);
  assert.match(html, /Открыть сохранённое обращение #71/);
  assert.match(html, /aria-valuenow="1"/);
});

test("what to fix and the action come before the driver's words, and the data open while the task is in work", () => {
  const current = { ...task("crm_first", "in_progress"), appeal_id: 71, driver: { ...driver, type: "Самозанятый водитель" }, checks: [{ key: "phone", label: "Номер телефона водителя", ok: false, message: "Номер не совпадает с номером водителя +77010000000." }] };
  const html = render({ completed: 0, active_task: "crm_first", tasks: [current, task("crm_phone", "locked")] });
  const at = text => html.indexOf(text);
  assert.ok(at("Что нужно исправить") >= 0 && at("Что нужно исправить") < at("Исправить обращение #71"));
  assert.ok(at("Исправить обращение #71") < at("Прошу уточнить доступные тарифы"), "the action is above the speech");
  assert.match(html, /<details class="crm-training-source" open=""><summary>Данные водителя для обращения/);
  assert.match(html, /<dt>Тип<\/dt><dd>Самозанятый водитель<\/dd>/);
  assert.match(html, /Что сделать:/);
});

test("all three passed: the rewards wait in the city, one button away", () => {
  const passed = key => ({ ...task(key, "passed"), checks: [{ key: "phone", label: "Телефон", ok: true, message: "" }] });
  const html = render({ completed: 3, active_task: null, tasks: [passed("crm_first"), passed("crm_phone"), passed("crm_closed")] });
  assert.match(html, /Награды за них — в городе/);
  assert.match(html, /Забрать награды в городе →/);
  // A passed task needs no data at hand: its block stays closed.
  assert.doesNotMatch(html, /<details class="crm-training-source" open=""><summary>Данные водителя/);
});
