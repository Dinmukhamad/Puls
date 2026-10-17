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
  const built = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true,
    platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    loader: { ".css": "empty" }, write: false,
    plugins: [{ name: "voice-client", setup(plugin) { plugin.onResolve({ filter: /(?:^\.\/|\/)(?:client)$/ }, () => ({ path: "test:client", external: true })); } }],
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(name => name === "test:client" ? { request } : require(name), loaded, loaded.exports);
  return loaded.exports;
}
const { voiceKeys, voiceWorkSite } = await moduleAt("../../api/voiceTraining.ts");
const { VoiceSituation, VoiceResults, VoiceHistory } = await moduleAt("./VoiceTrainingPage.tsx");
const noop = () => {};
const attempt = (patch = {}) => ({
  id: 42, scenario_key: "phone_change", title: "Смена номера телефона", description: "Водитель просит изменить номер телефона.", revision: 1,
  persona: "irritated", state: "in_progress", stage: "opening", turn: 0,
  driver: { id: "driver-1", name: "Учебный водитель", phone: "+77057314482", park_id: "itaxi-krg", park: "iTaxi" }, incoming_phone: "+77015550192",
  transcript: [{ role: "driver", text: "Помогите сменить номер", turn: 0 }],
  practice: { dispatch: false, oktell: false, compared: false }, result: null, can_finish: false,
  created_at: "2026-10-17T08:00:00Z", finished_at: null, ...patch,
});
const result = (patch = {}) => ({ score: 0, criteria: [{ key: "check", label: "Проверка данных", passed: false, feedback: "Данные не проверены.", quote: "Помогите сменить номер", turn: 0, role: "driver", example: "Сначала проверю аккаунт и номер звонка." }], critical_errors: [], ...patch });
const resultProps = (value) => ({ attempt: value, pending: false, onRetry: noop, reviewOpen: false, onReviewOpen: noop, reviewComment: "", onReviewComment: noop, reviewing: false, onReview: noop, onReviewCancel: noop });
const render = (Component, props) => renderToStaticMarkup(React.createElement(StaticRouter, { location: "/training/voice" }, React.createElement(Component, props)));

test("work site links preserve the voice attempt and leave account search to the learner", () => {
  for (const site of ["dispatch", "oktell", "crm"]) {
    const url = new URL(voiceWorkSite(attempt(), site), "https://puls.test");
    assert.equal(url.pathname, "/training/work-sites");
    assert.equal(url.searchParams.get("voiceAttempt"), "42");
    assert.equal(url.searchParams.get("site"), site);
    assert.equal(url.searchParams.has("scenarioAttempt"), false);
    assert.equal(url.searchParams.has("driver"), false);
    if (site === "dispatch") assert.equal(url.searchParams.get("fleet"), "contractors");
  }
});

test("API sends the same request ID and turn for a retried answer and all explicit comparison fields", async () => {
  const calls = [];
  const { voiceTraining } = await moduleAt("../../api/voiceTraining.ts", async (path, options) => { calls.push({ path, options }); return attempt(); });
  const input = { request_id: "ccf95931-c01b-4c91-88f4-b54aa05e8908", turn: 2, text: "Можно обратиться в WhatsApp." };
  await voiceTraining.answer(42, input);
  await voiceTraining.answer("42", input);
  assert.deepEqual(calls[0].options.json, input);
  assert.deepEqual(calls[1].options.json, input);
  assert.equal(calls[0].path, "/api/v1/learning/voice/attempts/42/answer");
  const comparison = { system: "compare", driver_id: "driver-1", park_id: "itaxi-krg", incoming_phone: "+77015550192", registration_phone: "+77057314482" };
  await voiceTraining.inspect(42, comparison);
  assert.deepEqual(calls[2].options.json, comparison);
});

test("numeric mutation IDs update the string route's saved attempt", () => {
  const client = new QueryClient();
  client.setQueryData(voiceKeys.attempt("42"), attempt());
  client.setQueryData(voiceKeys.attempt(42), attempt({ turn: 1 }));
  assert.equal(client.getQueryData(voiceKeys.attempt("42")).turn, 1);
  client.clear();
});

test("situation hides the account phone before an actual profile inspection and offers no solution", () => {
  const html = render(VoiceSituation, { attempt: attempt() });
  assert.match(html, /\+77015550192/);
  assert.doesNotMatch(html, /\+77057314482|WhatsApp|изменить номер в приложении|позвонить с номера регистрации/);
  const inspected = render(VoiceSituation, { attempt: attempt({ practice: { dispatch: true, oktell: true, compared: false } }) });
  assert.match(inspected, /\+77057314482/);
  assert.match(inspected, /Сверить номера в системе/);
  assert.doesNotMatch(inspected, /Зафиксировать сравнение/);
});

test("an empty conversation labels driver evidence correctly and offers no invalid retry", () => {
  const html = render(VoiceResults, resultProps(attempt({ state: "completed", result: result() })));
  assert.match(html, /Водитель · реплика 1/);
  assert.match(html, /Сначала проверю аккаунт/);
  assert.doesNotMatch(html, /Повторить момент|Повторить разговор|Твой ответ · реплика 1/);
  assert.match(html, /Новая тренировка/);
});

test("feedback separates critical errors, quotes the answer and displays the mentor's saved response", () => {
  const value = attempt({ state: "completed", transcript: [{ role: "driver", text: "Измените номер", turn: 0 }, { role: "operator", text: "Сменю без проверки", turn: 0 }], result: result({
    critical_errors: [{ text: "Обещана недопустимая смена номера", quote: "Сменю без проверки", turn: 0 }],
    review_status: "reviewed", mentor_comment: "Проверка данных обязательна.",
  }) });
  const html = render(VoiceResults, resultProps(value));
  assert.match(html, /КРИТИЧЕСКИЕ ОШИБКИ/);
  assert.match(html, /Сменю без проверки/);
  assert.match(html, /Повторить этот момент/);
  assert.match(html, /Наставник рассмотрел запрос/);
  assert.match(html, /Проверка данных обязательна/);
  assert.doesNotMatch(html, /Оспорить оценку/);
});

test("history links completed results and resumable account attempts", () => {
  const html = render(VoiceHistory, { attempts: [
    { ...attempt(), score: null, review_status: null },
    { ...attempt({ id: 43, state: "completed" }), score: 75, review_status: "reviewed" },
  ] });
  assert.match(html, /\/training\/voice\/attempts\/42/);
  assert.match(html, /Продолжить/);
  assert.match(html, /75%/);
  assert.match(html, /Наставник ответил/);
});
