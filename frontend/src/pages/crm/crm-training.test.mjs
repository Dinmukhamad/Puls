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
const props = { loading: false, error: null, busy: false, actionError: null, onReload() {}, onStart() {}, onContinue() {}, onEdit() {}, onOpen() {}, onInstructions() {} };
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
