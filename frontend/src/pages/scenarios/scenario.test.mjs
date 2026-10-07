import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { StaticRouter } = require("react-router-dom/server");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
async function moduleAt(path, request = async () => ({})) {
  const built = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false,
    plugins: [{ name: "scenario-client", setup(plugin) { plugin.onResolve({ filter: /(?:^\.\/|\/)(?:client)$/ }, () => ({ path: "test:client", external: true })); } }] });
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(name => name === "test:client" ? { request } : require(name), module, module.exports);
  return module.exports;
}
const { scenarioKeys, scenarioWorkSite, preserveScenarioContext } = await moduleAt("../../api/scenarios.ts");
const { ScenarioIntroduction, ScenarioAttemptView, ScenarioResult } = await moduleAt("./ScenarioPage.tsx");
const { dispatchObservation, ScenarioDispatchForm } = await moduleAt("./ScenarioPracticePanel.tsx");
const { crmSubmissionDetails, parseScenarioChecks } = await moduleAt("./ScenarioCrmProof.tsx");
const { crmDetailRows } = await moduleAt("../../api/crm.ts");
const noop = () => {};
const summary = (patch = {}) => ({ key: "business_park", title: "Business через парк", description: "Учебная консультация", minutes: 20, revision: 1, pass_percent: 80, critical_required: true, coins_reward: 125, completed: false, enabled: true, attempt_id: null, state: "new", ...patch });
const attempt = (patch = {}) => ({ id: 42, scenario_key: "business_park", title: "Business через парк: консультация водителя", description: "Учебный диалог", revision: 1, state: "in_progress", phase: "dialogue", current_step: 0, steps: [{ speaker: "Водитель", text: "Можно подключиться?", options: ["Проверим профиль и классификатор", "Гарантирую подключение"], critical: true }], answers: {}, feedback: null, practice: { dispatch: false, crm: false }, driver: { id: "zhaksylykov", name: "Учебный водитель", phone: "+7 700 000 00 01", license_number: "TEST-01", park_id: "almaty", park: "iTaxi", city: "Алматы" }, classifier: { title: "Учебный классификатор", checked_on: "2026-10-07", source_url: "https://pro.yandex.com/", notice: "Учебный пример. Допуск не подтверждён.", entries: [] }, crm_requirements: [{ key: "classifier", label: "Проверка допуска" }], coins_reward: 125, awarded_coins: 0, reward_already_claimed: false, score: null, pass_percent: 80, is_preview: false, finished_at: null, ...patch });
const render = (Component, props) => renderToStaticMarkup(React.createElement(StaticRouter, { location: "/" }, React.createElement(Component, props)));

test("introduction shows configured coins, pass criteria and a real three-part practice route", () => {
  const html = render(ScenarioIntroduction, { scenario: summary(), preview: false, pending: false, onStart: noop });
  assert.match(html, /125 коинов за первое успешное прохождение/);
  assert.match(html, /80%/);
  assert.match(html, /Диалог с водителем/);
  assert.match(html, /Практика в диспетчерской/);
  assert.match(html, /Обращение в CRM/);
  assert.match(html, /Начать сценарий/);
  assert.doesNotMatch(html, /disabled/);
});

test("an in-progress attempt resumes even after a mission is disabled; a new operator cannot start", () => {
  const resume = render(ScenarioIntroduction, { scenario: summary({ state: "in_progress", attempt_id: 42, enabled: false }), preview: false, pending: false, onStart: noop });
  assert.match(resume, /href="\/training\/scenarios\/attempts\/42"/);
  assert.match(resume, /Продолжить сценарий/);
  const paused = render(ScenarioIntroduction, { scenario: summary({ enabled: false }), preview: false, pending: false, onStart: noop });
  assert.match(paused, /disabled=""/);
  assert.match(paused, /Сценарий временно выключен/);
  const preview = render(ScenarioIntroduction, { scenario: summary({ enabled: false }), preview: true, pending: false, onStart: noop });
  assert.match(preview, /без начисления коинов/);
  assert.match(preview, /Открыть предпросмотр/);
  assert.doesNotMatch(preview, /disabled=""/);
});

test("numeric API IDs and routed string IDs update the same persisted attempt cache", () => {
  const client = new QueryClient();
  client.setQueryData(scenarioKeys.attempt("42"), attempt());
  const advanced = attempt({ current_step: 1, answers: { 0: 0 } });
  client.setQueryData(scenarioKeys.attempt(advanced.id), advanced);
  assert.equal(client.getQueryData(scenarioKeys.attempt("42")).current_step, 1);
  assert.deepEqual(client.getQueryData(scenarioKeys.attempt("42")).answers, { 0: 0 });
  client.clear();
});

test("dialogue cannot submit without a choice and does not expose a front-end correct answer", () => {
  const html = render(ScenarioAttemptView, { attempt: attempt(), pending: false, onAnswer: noop, onFinish: noop, onRepeat: noop });
  assert.match(html, /name="step-0"/);
  assert.match(html, /КРИТИЧЕСКИЙ/);
  assert.match(html, /disabled="">Ответить/);
  assert.doesNotMatch(html, /data-correct|correct-answer|Начислено/);
  const interrupted = render(ScenarioAttemptView, { attempt: attempt(), pending: false, error: "Сервер не ответил", onAnswer: noop, onFinish: noop, onRepeat: noop, onReload: noop });
  assert.match(interrupted, /Проверить сохранённый прогресс/);
  assert.doesNotMatch(interrupted, /Начислено|Сценарий пройден/);
});

test("dispatch and CRM links preserve the server attempt and exact fictional driver park", () => {
  const dispatch = new URL(scenarioWorkSite(attempt(), "dispatch"), "https://puls.test");
  assert.equal(dispatch.pathname, "/training/work-sites");
  assert.equal(dispatch.searchParams.get("scenarioAttempt"), "42");
  assert.equal(dispatch.searchParams.get("fleet"), "driver/zhaksylykov");
  assert.equal(dispatch.searchParams.get("fpark"), "almaty");
  const crm = new URL(scenarioWorkSite(attempt(), "crm"), "https://puls.test");
  assert.equal(crm.searchParams.get("scenarioAttempt"), "42");
  assert.equal(crm.searchParams.get("view"), "create");
  const next = preserveScenarioContext(new URLSearchParams("view=drivers&driver=9"), dispatch.searchParams);
  assert.equal(next.get("scenarioAttempt"), "42");
  assert.equal(next.get("driver"), "9");
  assert.equal(preserveScenarioContext(new URLSearchParams("view=list"), new URLSearchParams()).has("scenarioAttempt"), false);
});

test("opening practice sites is not presented as a completed check or reward", () => {
  const html = render(ScenarioAttemptView, { attempt: attempt({ phase: "dispatch", current_step: 2 }), pending: false, onAnswer: noop, onFinish: noop, onRepeat: noop });
  assert.match(html, /сама по себе не засчитывает задание/);
  assert.match(html, /подтверждения QR/);
  assert.match(html, /Открыть диспетчерскую/);
  assert.doesNotMatch(html, /Завершить сценарий|Начислено/);
});

test("only a server-verified CRM record unlocks finish at the CRM stage", () => {
  const props = { pending: false, onAnswer: noop, onFinish: noop, onRepeat: noop };
  const unchecked = render(ScenarioAttemptView, { ...props, attempt: attempt({ phase: "crm", practice: { dispatch: true, crm: false } }) });
  assert.match(unchecked, /Создать обращение в CRM/);
  assert.doesNotMatch(unchecked, /Завершить сценарий/);
  const checked = render(ScenarioAttemptView, { ...props, attempt: attempt({ phase: "crm", practice: { dispatch: true, crm: true, crm_appeal_id: 9 } }) });
  assert.match(checked, /Завершить сценарий/);
  assert.doesNotMatch(checked, /Создать обращение в CRM/);
  const pending = render(ScenarioAttemptView, { ...props, pending: true, attempt: attempt({ phase: "crm", practice: { dispatch: true, crm: true } }) });
  assert.match(pending, /disabled="">Сохраняем результат/);
});

test("observed profile and car fields start empty rather than filling expected answers", () => {
  const client = new QueryClient();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(ScenarioDispatchForm, { attempt: attempt({ phase: "dispatch" }), onChecked: noop })));
  assert.match(html, /name="driver_id"[^>]*readonly=""[^>]*value="zhaksylykov"/);
  for (const key of ["license_number", "park", "city", "employment", "brand", "model", "year", "color"]) assert.match(html, new RegExp(`name="${key}"[^>]*value=""`));
  assert.match(html, /Выберите результат/);
  assert.match(html, /Учебный пример/);
  client.clear();
});

test("dispatch observations reject blanks and fractional years, and submit no grading flags", () => {
  const draft = { driver_id: "zhaksylykov", license_number: " TEST-01 ", park: "iTaxi", city: "Алматы", employment: "Самозанятый", brand: "Hyundai", model: "Sonata", year: "2021", color: "Серый", classification_result: "not_confirmed" };
  const input = dispatchObservation(draft);
  assert.equal(input.year, 2021); assert.equal(input.license_number, "TEST-01");
  assert.deepEqual(Object.keys(input).sort(), ["driver_id", "license_number", "park", "city", "employment", "brand", "model", "year", "color", "classification_result"].sort());
  assert.throws(() => dispatchObservation({ ...draft, license_number: " " }), /Заполните/);
  assert.throws(() => dispatchObservation({ ...draft, year: "2021.5" }), /Заполните/);
  assert.throws(() => dispatchObservation({ ...draft, classification_result: "" }), /Заполните/);
});

test("actual CRM submission preserves required structured evidence and scopes the attempt from the route", () => {
  const details = { conditions: "Условия уточнены", scenario_attempt: "forged-other-attempt", scenario_checks: '["classifier","activation"]', scenario_outcome: "not_confirmed", scenario_next_action: "check_pro_diagnostics", ignored: "not a category field" };
  assert.deepEqual(crmSubmissionDetails(details, ["conditions"], "42"), { conditions: "Условия уточнены", scenario_attempt: "42", scenario_checks: details.scenario_checks, scenario_outcome: "not_confirmed", scenario_next_action: "check_pro_diagnostics" });
  assert.deepEqual(crmSubmissionDetails(details, ["conditions"]), { conditions: "Условия уточнены" });
  assert.deepEqual(parseScenarioChecks('not-json'), []);
  assert.deepEqual(parseScenarioChecks('["classifier",3,null]'), ["classifier"]);
});

test("saved appeal evidence reads as understandable labels rather than internal JSON or route IDs", () => {
  const rows = crmDetailRows({ scenario_attempt: "42", scenario_checks: '["classifier","activation","standards","commission","diagnostics"]', scenario_outcome: "not_confirmed", scenario_next_action: "check_pro_diagnostics", conditions: "По договору парка" });
  assert.equal(rows.length, 4);
  const text = JSON.stringify(rows);
  assert.match(text, /Темы консультации/); assert.match(text, /Итог консультации/); assert.match(text, /Следующее действие/); assert.match(text, /По договору парка/);
  assert.doesNotMatch(text, /scenario_|not_confirmed|check_pro_diagnostics|classifier|activation|"42"/);
  assert.deepEqual(crmDetailRows({ scenario_checks: "bad JSON", scenario_attempt: "42" }), []);
});

test("result reports the server award and clearly distinguishes repeats, previews, failure and zero reward", () => {
  const props = { onRepeat: noop };
  const paid = render(ScenarioResult, { ...props, attempt: attempt({ state: "passed", score: 92, awarded_coins: 125, phase: "complete" }) });
  assert.match(paid, /92%/); assert.match(paid, /Начислено 125 коинов/);
  const repeat = render(ScenarioResult, { ...props, attempt: attempt({ state: "passed", score: 100, reward_already_claimed: true }) });
  assert.match(repeat, /Награда была получена ранее/); assert.doesNotMatch(repeat, /Начислено/);
  const preview = render(ScenarioResult, { ...props, attempt: attempt({ state: "passed", score: 100, is_preview: true }) });
  assert.match(preview, /Предпросмотр — коины не начисляются/);
  const failed = render(ScenarioResult, { ...props, attempt: attempt({ state: "failed", score: 92 }) });
  assert.match(failed, /правильные ответы на критические вопросы/); assert.match(failed, /Коины не начислены/);
  const zero = render(ScenarioResult, { ...props, attempt: attempt({ state: "passed", score: 100, coins_reward: 0 }) });
  assert.match(zero, /настроена награда 0 коинов/);
});

test("API submits answer, persisted appeal ID and observations separately; finish never accepts a coin amount", async () => {
  const calls = [];
  const { scenarios } = await moduleAt("../../api/scenarios.ts", async (path, options) => { calls.push({ path, options }); return attempt(); });
  await scenarios.answer("42", 3, 1);
  await scenarios.crmCheck(42, 9);
  await scenarios.finish(42);
  assert.deepEqual(calls[0], { path: "/api/v1/learning/scenarios/attempts/42/answer", options: { method: "PUT", json: { step: 3, answer: 1 }, timeoutMs: 20000 } });
  assert.deepEqual(calls[1].options.json, { appeal_id: 9 });
  assert.deepEqual(calls[2].options.json, {});
  assert.doesNotMatch(JSON.stringify(calls), /coins|correct|awarded/);
});
