import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { StaticRouter } = require("react-router-dom/server");
const { QueryClient } = require("@tanstack/react-query");
async function moduleAt(path, request = async () => ({})) {
  const built = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false,
    plugins: [{ name: "scenario-client", setup(plugin) { plugin.onResolve({ filter: /(?:^\.\/|\/)(?:client)$/ }, () => ({ path: "test:client", external: true })); } }] });
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(name => name === "test:client" ? { request } : require(name), module, module.exports);
  return module.exports;
}
const { scenarioKeys, scenarioWorkSite, preserveScenarioContext, rememberScenarioWorkspace } = await moduleAt("../../api/scenarios.ts");
const { ScenarioIntroduction, ScenarioAttemptView, ScenarioResult } = await moduleAt("./ScenarioPage.tsx");
const { crmSubmissionDetails, parseScenarioChecks } = await moduleAt("./ScenarioCrmProof.tsx");
const { crmDetailRows } = await moduleAt("../../api/crm.ts");
const noop = () => {};
const summary = (patch = {}) => ({ key: "business_park", title: "Подключение тарифа Бизнес", description: "Учебная консультация", minutes: 20, revision: 3, pass_percent: 80, critical_required: true, coins_reward: 125, completed: false, enabled: true, attempt_id: null, state: "new", ...patch });
const attempt = (patch = {}) => ({ id: 42, scenario_key: "business_park", title: "Подключение тарифа Бизнес", description: "Учебный диалог", revision: 3, opening_message: "Здравствуйте! Хочу подключить Бизнес.", state: "in_progress", phase: "dialogue", current_step: 0, steps: [{ speaker: "Водитель", text: "Можно подключиться?", options: ["Проверим профиль и классификатор", "Гарантирую подключение"], critical: true, kind: "reply" }], answers: {}, feedback: null, practice: { dispatch: false, crm: false }, driver: { id: "zhaksylykov", name: "Учебный водитель", phone: "+7 700 000 00 01", license_number: "TEST-01", park_id: "almaty", park: "iTaxi", city: "Алматы" }, classifier: { title: "Учебный классификатор", checked_on: "2026-10-07", source_url: "https://pro.yandex.com/", notice: "Учебный пример. Допуск не подтверждён.", entries: [] }, crm_requirements: [{ key: "classifier", label: "Проверка допуска" }], coins_reward: 125, awarded_coins: 0, reward_already_claimed: false, score: null, pass_percent: 80, is_preview: false, finished_at: null, ...patch });
const render = (Component, props) => renderToStaticMarkup(React.createElement(StaticRouter, { location: "/" }, React.createElement(Component, props)));

test("introduction presents the case and tools without disclosing the action sequence", () => {
  const html = render(ScenarioIntroduction, { scenario: summary(), preview: false, pending: false, onStart: noop });
  assert.match(html, /125 коинов за первое успешное прохождение/);
  assert.match(html, /80%/);
  assert.match(html, /Вам поступит обращение водителя/);
  assert.match(html, /диспетчерская и CRM/);
  assert.match(html, /учитывается первый выбор/);
  assert.doesNotMatch(html, /scenario-route|Oktell/);
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
  assert.match(html, /НОВОЕ СООБЩЕНИЕ/);
  assert.match(html, /disabled="">Отправить ответ/);
  assert.doesNotMatch(html, /ВОПРОС 1|КРИТИЧЕСКИЙ/);
  assert.doesNotMatch(html, /data-correct|correct-answer|Начислено/);
  const interrupted = render(ScenarioAttemptView, { attempt: attempt(), pending: false, error: "Сервер не ответил", onAnswer: noop, onFinish: noop, onRepeat: noop, onReload: noop });
  assert.match(interrupted, /Проверить сохранённый прогресс/);
  assert.doesNotMatch(interrupted, /Начислено|Сценарий пройден/);
});

test("v3 starts with driver search; verified profile can resume and CRM starts at the list", () => {
  const dispatch = new URL(scenarioWorkSite(attempt(), "dispatch"), "https://puls.test");
  assert.equal(dispatch.pathname, "/training/work-sites");
  assert.equal(dispatch.searchParams.get("scenarioAttempt"), "42");
  assert.equal(dispatch.searchParams.get("fleet"), "contractors");
  assert.equal(dispatch.searchParams.has("fpark"), false);
  const resumed = new URL(scenarioWorkSite(attempt({ practice: { inspections: { profile: true, car: false } } }), "dispatch"), "https://puls.test");
  assert.equal(resumed.searchParams.get("fleet"), "driver/zhaksylykov");
  assert.equal(resumed.searchParams.get("fpark"), "almaty");
  const crm = new URL(scenarioWorkSite(attempt(), "crm"), "https://puls.test");
  assert.equal(crm.searchParams.get("site"), "crm");
  assert.equal(crm.searchParams.get("scenarioAttempt"), "42");
  assert.equal(crm.searchParams.has("view"), false);
  const legacy = new URL(scenarioWorkSite(attempt({ revision: 1 }), "crm"), "https://puls.test");
  assert.equal(legacy.searchParams.get("view"), "create");
  const next = preserveScenarioContext(new URLSearchParams("view=drivers&driver=9"), dispatch.searchParams);
  assert.equal(next.get("scenarioAttempt"), "42");
  assert.equal(next.get("driver"), "9");
});

test("workspace entry does not expose future actions or award credit for a link", () => {
  const html = render(ScenarioAttemptView, { attempt: attempt({ phase: "dispatch", current_step: 2 }), pending: false, onAnswer: noop, onFinish: noop, onRepeat: noop });
  assert.match(html, /само по себе не засчитывает действие/);
  assert.match(html, /доступ по QR/);
  assert.match(html, /Открыть рабочие сайты/);
  assert.doesNotMatch(html, /Завершить сценарий|Начислено|Запишите|Автомобиль/);
});

test("verified CRM cannot skip the closing reply; finish requires complete phase", () => {
  const props = { pending: false, onAnswer: noop, onFinish: noop, onRepeat: noop };
  for (const phase of ["crm", "dialogue"]) {
    const html = render(ScenarioAttemptView, { ...props, attempt: attempt({ phase, practice: { dispatch: true, crm: true, crm_appeal_id: 9 } }) });
    assert.doesNotMatch(html, /Завершить сценарий/);
  }
  const complete = render(ScenarioAttemptView, { ...props, attempt: attempt({ phase: "complete" }) });
  assert.match(complete, /Завершить сценарий/);
  const pending = render(ScenarioAttemptView, { ...props, pending: true, attempt: attempt({ phase: "complete" }) });
  assert.match(pending, /disabled="">Сохраняем результат/);
});

test("action choices and incorrect feedback keep the current decision visible", () => {
  const data = attempt({ feedback: { correct: false, explanation: "Найдите действующий профиль." } });
  data.steps[0].kind = "action";
  const html = render(ScenarioAttemptView, { attempt: data, pending: false, onAnswer: noop, onFinish: noop, onRepeat: noop });
  assert.match(html, /Попробуйте иначе/);
  assert.match(html, /Что сделаете дальше/);
  assert.match(html, /disabled="">Выполнить действие/);
  assert.match(html, /name="step-0"/);
});

test("unfinished legacy attempts offer the updated scenario instead of the removed form", () => {
  const html = render(ScenarioAttemptView, { attempt: attempt({ revision: 1, phase: "dispatch" }), pending: false, onAnswer: noop, onFinish: noop, onRepeat: noop });
  assert.match(html, /Сценарий обновлён/);
  assert.match(html, /Открыть новый сценарий/);
  assert.doesNotMatch(html, /name="license_number"|Проверить данные|Открыть рабочие сайты/);
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
  assert.match(failed, /отсутствие критических ошибок/); assert.match(failed, /Коины не начислены/);
  const zero = render(ScenarioResult, { ...props, attempt: attempt({ state: "passed", score: 100, coins_reward: 0 }) });
  assert.match(zero, /настроена награда 0 коинов/);
});

test("API submits answer, persisted appeal ID and observations separately; finish never accepts a coin amount", async () => {
  const calls = [];
  const { scenarios } = await moduleAt("../../api/scenarios.ts", async (path, options) => { calls.push({ path, options }); return attempt(); });
  await scenarios.answer("42", 3, 1);
  await scenarios.crmCheck(42, 9);
  await scenarios.finish(42);
  await scenarios.inspect(42, { driver_id: "zhaksylykov", park_id: "almaty", section: "profile" });
  assert.deepEqual(calls[0], { path: "/api/v1/learning/scenarios/attempts/42/answer", options: { method: "PUT", json: { step: 3, answer: 1 }, timeoutMs: 20000 } });
  assert.deepEqual(calls[1].options.json, { appeal_id: 9 });
  assert.deepEqual(calls[2].options.json, {});
  assert.equal(calls[3].path, "/api/v1/learning/scenarios/attempts/42/inspect");
  assert.deepEqual(calls[3].options.json, { driver_id: "zhaksylykov", park_id: "almaty", section: "profile" });
  assert.doesNotMatch(JSON.stringify(calls), /coins|correct|awarded/);
});

test("result reviews first decision and correction without replacing server score", () => {
  const html = render(ScenarioResult, { attempt: attempt({ state: "failed", score: 0, answers: { 0: 0 }, first_answers: { 0: 1 } }), onRepeat: noop });
  assert.match(html, /0%/);
  assert.match(html, /Первый выбор: Гарантирую подключение/);
  assert.match(html, /После исправления: Проверим профиль/);
});

test("CRM diagnostics displays a readable status", () => {
  assert.deepEqual(crmDetailRows({ scenario_diagnostics: "awaiting_driver_diagnostics" }), [["Диагностика", "Скриншот запрошен, ожидается"]]);
});

test("workspace restores driver cards across scenario visits and isolates users and attempts", () => {
  const values = new Map(), previous = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    rememberScenarioWorkspace(7, 42, new URLSearchParams("site=crm&view=drivers&driver=901&screen=car&fleet=driver%2Fzhaksylykov%2Fcar&fpark=almaty&ignored=secret"));
    const crm = new URL(scenarioWorkSite(attempt(), "crm", 7), "https://puls.test");
    const fleet = new URL(scenarioWorkSite(attempt(), "dispatch", 7), "https://puls.test");
    assert.equal(crm.searchParams.get("view"), "drivers");
    assert.equal(crm.searchParams.get("driver"), "901");
    assert.equal(crm.searchParams.get("screen"), "car");
    assert.equal(fleet.searchParams.get("fleet"), "driver/zhaksylykov/car");
    assert.equal(fleet.searchParams.get("fpark"), "almaty");
    assert.equal(fleet.searchParams.get("site"), "dispatch");
    assert.equal(fleet.searchParams.has("ignored"), false);
    assert.equal(new URL(scenarioWorkSite(attempt(), "crm", 8), "https://puls.test").searchParams.has("driver"), false);
    assert.equal(new URL(scenarioWorkSite(attempt({ id: 43 }), "crm", 7), "https://puls.test").searchParams.has("driver"), false);
  } finally { if (previous === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previous; }
});

test("office consultation evidence persists and displays readable labels", () => {
  const details = { scenario_outcome: "eligible", scenario_next_action: "office_visit", scenario_office: "Учебная, 10", scenario_visit_time: "10:00–18:00" };
  const saved = crmSubmissionDetails(details, [], "42");
  assert.equal(saved.scenario_office, details.scenario_office);
  assert.equal(saved.scenario_visit_time, details.scenario_visit_time);
  const rows = JSON.stringify(crmDetailRows(saved));
  assert.match(rows, /соответствуют требованиям Бизнес/);
  assert.match(rows, /Визит в офис/);
  assert.match(rows, /Учебная, 10/);
  assert.doesNotMatch(rows, /scenario_|office_visit|eligible|Диагностика/);
});
