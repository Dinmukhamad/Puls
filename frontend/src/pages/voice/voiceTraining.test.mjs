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
const { voiceKeys, oktellRetry, OKTELL_CALLS } = await moduleAt("../../api/voiceTraining.ts");
const { VoiceResults, VoiceHistory, VoiceSettings } = await moduleAt("./VoiceTrainingPage.tsx");
const { retryFromParams } = await moduleAt("../oktell/oktellVoice.ts");
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

test("calls are taken in Oktell, and a repeated moment asks it for the same driver from that answer", () => {
  assert.equal(OKTELL_CALLS, "/training/work-sites?site=oktell");
  const url = new URL(oktellRetry(42, 2), "https://puls.test");
  assert.equal(url.pathname, "/training/work-sites");
  assert.equal(url.searchParams.get("site"), "oktell");
  assert.deepEqual(retryFromParams(url.searchParams), { attempt_id: 42, turn: 2 });
  for (const broken of ["voiceRetry=x&voiceTurn=1", "voiceRetry=42", "voiceRetry=-1&voiceTurn=0", "voiceRetry=42&voiceTurn=101"]) assert.equal(retryFromParams(new URLSearchParams(broken)), null, broken);
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

test("an empty conversation labels driver evidence correctly and offers no invalid retry", () => {
  const html = render(VoiceResults, resultProps(attempt({ state: "completed", result: result() })));
  assert.match(html, /Водитель · реплика 1/);
  assert.match(html, /Сначала проверю аккаунт/);
  assert.doesNotMatch(html, /Повторить момент|Повторить разговор|Твой ответ · реплика 1/);
  assert.match(html, /Принять новый звонок/);
  assert.match(html, /href="\/training\/work-sites\?site=oktell"/);
});

test("feedback separates critical errors, quotes the answer and displays the mentor's saved response", () => {
  const value = attempt({ state: "completed", transcript: [{ role: "driver", text: "Измените номер", turn: 0 }, { role: "operator", text: "Сменю без проверки", turn: 0 }], result: result({
    critical_errors: [{ text: "Обещана недопустимая смена номера", quote: "Сменю без проверки", turn: 0 }],
    review_status: "reviewed", mentor_comment: "Проверка данных обязательна.",
  }) });
  const html = render(VoiceResults, resultProps(value));
  assert.match(html, /Критические ошибки · 1/);
  assert.match(html, /Сменю без проверки/);
  assert.match(html, /Повторить этот момент/);
  assert.match(html, /Наставник рассмотрел запрос/);
  assert.match(html, /Проверка данных обязательна/);
  assert.doesNotMatch(html, /Оспорить оценку/);
});

test("history links completed results and tells a call still going in Oktell from an old unfinished one", () => {
  const html = render(VoiceHistory, { attempts: [
    { ...attempt(), score: null, review_status: null, channel: "oktell" },
    { ...attempt({ id: 41 }), score: null, review_status: null, channel: "page" },
    { ...attempt({ id: 43, state: "completed" }), score: 75, review_status: "reviewed" },
  ] });
  assert.match(html, /\/training\/voice\/attempts\/42/);
  assert.match(html, /Идёт в Oktell/);
  assert.match(html, /Не завершён/);
  assert.match(html, /75%/);
  assert.match(html, /Наставник ответил/);
});


test("cloud speech API sends only provider/persona or a saved driver turn with caller cancellation", async () => {
  const calls = [];
  const { voiceTraining } = await moduleAt("../../api/voiceTraining.ts", async (path, options) => { calls.push({ path, options }); return {}; });
  const controller = new AbortController();
  await voiceTraining.speechConfig(controller.signal);
  await voiceTraining.speechPreview("google", "confused", "kk", controller.signal);
  await voiceTraining.speech(42, "azure", 3, controller.signal);
  assert.equal(calls[0].path, "/api/v1/learning/voice/speech/config");
  assert.deepEqual(calls[1].options.json, { provider: "google", persona: "confused", language: "kk" });
  assert.equal(calls[2].path, "/api/v1/learning/voice/attempts/42/speech");
  assert.deepEqual(calls[2].options.json, { provider: "azure", turn: 3 });
  for (const { options } of calls) {
    assert.equal(options.signal, controller.signal);
    assert.equal(options.timeoutMs, 20000);
    assert.equal("text" in (options.json ?? {}), false, "operator text is never sent for cloud synthesis");
  }
});

test("the driver's voice is Yandex when the server has it, any cloud voice otherwise, the browser's last", async () => {
  const { resolveVoiceProvider } = await moduleAt("./voiceProvider.ts");
  const providers = [{ id: "yandex", label: "Yandex SpeechKit", voice: "persona-v1" }, { id: "google", label: "Google Cloud TTS", voice: "ru-RU-Chirp3-HD-Fenrir" }];
  assert.equal(resolveVoiceProvider({ default_provider: "yandex", providers }), "yandex");
  assert.equal(resolveVoiceProvider({ default_provider: "browser", providers }), "yandex");
  assert.equal(resolveVoiceProvider({ default_provider: "google", providers: providers.slice(1) }), "google");
  assert.equal(resolveVoiceProvider({ default_provider: "browser", providers: [] }), "browser");
  assert.equal(resolveVoiceProvider(undefined), "browser");
});

test("the operator chooses no voice source, browser voice or phone sound: only a sample to hear", () => {
  const speech = { selectedVoiceURI: "", russianVoices: [{ voiceURI: "ru-browser", name: "Browser Russian" }], speaking: false, support: { synthesis: true } };
  const config = { default_provider: "yandex", providers: [{ id: "yandex", label: "Yandex SpeechKit", voice: "persona-v1" }] };
  const props = { speech, disabled: false, onPreview: noop, configLoading: false };
  const html = render(VoiceSettings, { ...props, provider: "yandex", config });
  assert.match(html, /Прослушать голос водителя/);
  assert.match(html, /Yandex SpeechKit: у каждого характера свой голос/);
  assert.match(html, /class="btn btn--secondary/);
  assert.doesNotMatch(html, /Источник голоса|Browser Russian|Звук как по телефону|select|checkbox|API.key|ключ/i);
  const browser = render(VoiceSettings, { ...props, provider: "browser", config: { default_provider: "browser", providers: [] } });
  assert.match(browser, /голос браузера/);
  assert.doesNotMatch(browser, /Browser Russian|select/i);
});

test("a call from the scenario editor waits for the mentor's score, then shows it with the right solution", () => {
  const manual = (patch = {}) => attempt({ state: "completed", custom: true, transcript: [{ role: "driver", text: "Заказов нет", turn: 0 }, { role: "operator", text: "Не пройден фотоконтроль", turn: 0 }], result: {
    score: null, manual: true, review_status: "awaiting_grade", solution: "Пройти фотоконтроль в Такси Про.", reached_end: true,
    criteria: [{ key: "s1", label: "Причина", passed: true, feedback: "Тренажёр узнал ответ.", quote: "Не пройден фотоконтроль", turn: 0, role: "operator", example: null }],
    critical_errors: [], ...patch,
  } });
  const waiting = render(VoiceResults, resultProps(manual()));
  assert.match(waiting, /Ждёт оценки наставника/);
  assert.match(waiting, /Правильное решение/);
  assert.match(waiting, /Узнано/);
  assert.doesNotMatch(waiting, /Оспорить оценку|0%/);
  const graded = render(VoiceResults, resultProps(manual({ score: 85, review_status: "reviewed", mentor_comment: "Хорошо объяснил.", mentor_name: "Супервайзер" })));
  assert.match(graded, /85<span>%<\/span>/);
  assert.match(graded, /Хорошо объяснил/);
  const history = render(VoiceHistory, { attempts: [{ ...attempt({ state: "completed" }), score: null, review_status: "awaiting_grade" }] });
  assert.match(history, /Ждёт оценки/);
});

test("a call graded by the AI says so, shows its summary and the right solution, and can be disputed", () => {
  const value = attempt({ state: "completed", custom: true, transcript: [{ role: "driver", text: "Заказов нет", turn: 0 }, { role: "operator", text: "Не пройден фотоконтроль", turn: 0 }], result: {
    score: 75, ai: true, manual: false, review_status: null, solution: "Пройти фотоконтроль в Такси Про.", summary: "Решение найдено, вежливости не хватило.",
    criteria: [{ key: "s1", label: "Причина", passed: true, feedback: "Назвал причину.", quote: "Не пройден фотоконтроль", turn: 0, role: "operator", example: null }],
    critical_errors: [],
  } });
  const html = render(VoiceResults, resultProps(value));
  assert.match(html, /Оценка ИИ/);
  assert.match(html, /Решение найдено, вежливости не хватило/);
  assert.match(html, /Правильное решение/);
  assert.match(html, /Оспорить оценку/);
  assert.doesNotMatch(html, /Ждёт оценки наставника/);
});

test("mentors see whether the AI plays the drivers and what it cost this month", async () => {
  const { aiLine } = await moduleAt("./VoiceMentorReviews.tsx");
  assert.match(aiLine({ configured: false, active: false, model: "claude-haiku-5-5", budget_usd: 5, spent_usd: 0, calls: 0 }), /ИИ не подключён/);
  assert.match(aiLine({ configured: true, active: false, model: "claude-haiku-5-5", budget_usd: 5, spent_usd: 5.01, calls: 900 }), /Лимит ИИ на месяц \(\$5\) исчерпан/);
  const on = aiLine({ configured: true, active: true, model: "claude-haiku-5-5", budget_usd: 5, spent_usd: 0.4213, calls: 37 });
  assert.match(on, /\$0\.42 из \$5/);
  assert.match(on, /обращений — 37/);
});
