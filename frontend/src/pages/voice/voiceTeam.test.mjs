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
const team = await moduleAt("./VoiceTeamPage.tsx");
const trainer = await moduleAt("./VoiceTrainingPage.tsx");
const noop = () => {};
const render = (Component, props) => renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() },
  React.createElement(StaticRouter, { location: "/training/voice" }, React.createElement(Component, props))));

const operator = (patch = {}) => ({
  id: 3, name: "Оператор Первый", role: "operator", group_id: 1, group_name: "Группа 1", calls: 2, average: 40, change: -10, best: 60,
  last: { id: 21, score: 20, at: "2026-10-19T05:00:00Z" }, ai_calls: 1, waiting: 0, weak: ["Проверка данных"], ...patch,
});
const call = (patch = {}) => ({
  id: 21, user_id: 3, user_name: "Оператор Первый", group_name: "Группа 1", title: "Смена номера телефона", custom: false,
  persona: "irritated", language: "ru", state: "completed", score: 20, grader: "rules", review_status: null, critical: false,
  ai_driver: false, ai_review: null, created_at: "2026-10-19T05:00:00Z", finished_at: "2026-10-19T05:03:00Z", ...patch,
});
const teamData = (patch = {}) => ({
  period: { days: 30, since: "2026-09-19T00:00:00Z", until: "2026-10-19T12:00:00Z" }, groups: [{ id: 1, name: "Группа 1" }], group_id: null,
  summary: { calls: 4, calls_before: 1, average: 55, average_before: 50, operators: 4, practiced: 3, ai_graded: 1, awaiting_grade: 1, disputes: 1, low: 1 },
  operators: [
    operator(),
    operator({ id: 4, name: "Ждущий Ответа", calls: 1, average: 90, change: null, waiting: 1, weak: [], last: { id: 22, score: 90, at: "2026-10-18T05:00:00Z" } }),
    operator({ id: 5, name: "Стажёр Новый", role: "trainee", calls: 3, average: 70, change: null, weak: [], last: { id: 23, score: 70, at: "2026-10-17T05:00:00Z" } }),
    operator({ id: 6, name: "Без Звонков", calls: 0, average: null, change: null, best: null, last: null, ai_calls: 0, weak: [] }),
  ],
  skills: [{ label: "Проверка данных", passed: 1, total: 4, example: "Сверю номер звонка с регистрацией.", attempt_id: 21 }],
  calls: [
    call(),
    call({ id: 22, user_id: 4, user_name: "Ждущий Ответа", score: 90, grader: "ai", ai_driver: true, review_status: "pending" }),
    call({ id: 23, user_id: 5, user_name: "Стажёр Новый", score: 70, critical: true, ai_review: 65 }),
    call({ id: 24, user_id: 5, user_name: "Стажёр Новый", custom: true, title: "Не приходят заказы", score: null, grader: "awaiting", review_status: "awaiting_grade" }),
  ],
  queue: [
    call({ id: 24, user_id: 5, user_name: "Стажёр Новый", custom: true, title: "Не приходят заказы", score: null, grader: "awaiting", review_status: "awaiting_grade", requested_at: "2026-10-18T06:00:00Z" }),
    call({ id: 22, user_id: 4, user_name: "Ждущий Ответа", score: 90, grader: "ai", review_status: "pending", comment: "Я назвал оба способа", requested_at: "2026-10-18T05:10:00Z" }),
  ],
  ai: { configured: true, active: true, model: "claude-haiku", budget_usd: 5, spent_usd: 0.42, calls: 120 }, scenarios: 2, ...patch,
});

test("leaders get the team page, operators and trainees their own calls", () => {
  assert.equal(team.callRoute(21), "/training/voice/calls/21");
  const html = (score) => renderToStaticMarkup(React.createElement(team.ScoreBadge, { score }));
  assert.match(html(null), /Ждёт оценки/);
  assert.match(html(85), /badge--success/);
  assert.match(html(49), /badge--danger/);
  assert.match(html(50), /50%/);
  assert.doesNotMatch(html(50), /badge--(?:danger|success)/);
  const grader = (props) => renderToStaticMarkup(React.createElement(team.GraderMark, props));
  assert.match(grader({ grader: "ai" }), /Звонок оценил ИИ \(Claude\)/);
  assert.match(grader({ grader: "rules", aiReview: 65 }), /Правила.*ИИ 65%/);
  assert.match(grader({ grader: "awaiting" }), /Ждёт наставника/);
  assert.match(grader({ grader: "mentor" }), /Наставник/);
});

test("the overview puts what needs the leader first and sorts operators by who needs help", () => {
  const html = render(team.TeamOverview, { team: teamData(), onCalls: noop, onReview: noop });
  for (const label of ["Звонков", "Средний балл", "Тренировались", "Оценил ИИ", "3 из 4", "к прошлому периоду"]) assert.match(html, new RegExp(label));
  assert.match(html, /Ждут вашей оценки/);
  assert.match(html, /Спорные оценки/);
  assert.match(html, /Звонки ниже 50%/);
  // The idle operator is named; the counters with work open their list.
  assert.match(html, /Не тренировались<\/b><small>Без Звонков/);
  assert.equal((html.match(/<li><button type="button"/g) ?? []).length, 3);
  assert.match(html, /Чему учить команду/);
  assert.match(html, /выполнено в 1 из 4/);
  assert.match(html, /Сверю номер звонка с регистрацией/);
  assert.match(html, /стажёр/);
  assert.match(html, /href="\/training\/voice\/calls\/21"/);
  assert.match(html, /Ждёт ответа · 1/);
  const order = (sort) => team.sortOperators(teamData().operators, sort).map(row => row.name);
  assert.deepEqual(order("help"), ["Ждущий Ответа", "Оператор Первый", "Стажёр Новый", "Без Звонков"]);
  assert.deepEqual(order("calls"), ["Стажёр Новый", "Оператор Первый", "Ждущий Ответа", "Без Звонков"]);
  assert.deepEqual(order("name"), ["Без Звонков", "Ждущий Ответа", "Оператор Первый", "Стажёр Новый"]);
  const calm = render(team.TeamOverview, { team: teamData({ skills: [], operators: [operator()] }), onCalls: noop, onReview: noop });
  assert.match(calm, /тренировались все/);
  assert.match(calm, /Пока нечего подсказать/);
});

test("the team's calls filter by what waits, low scores, errors, the AI and one operator", () => {
  const ids = (props) => [...render(team.TeamCalls, { team: teamData(), filter: "all", operator: null, onFilter: noop, onOperator: noop, ...props })
    .matchAll(/<li class="list-card"><a class="voice-team-call-card" href="\/training\/voice\/calls\/(\d+)"/g)].map(match => Number(match[1]));
  assert.deepEqual(ids({}), [21, 22, 23, 24]);
  assert.deepEqual(ids({ filter: "waiting" }), [22, 24]);
  assert.deepEqual(ids({ filter: "low" }), [21]);
  assert.deepEqual(ids({ filter: "critical" }), [23]);
  assert.deepEqual(ids({ filter: "ai" }), [22, 23]);
  assert.deepEqual(ids({ operator: 5 }), [23, 24]);
  const html = render(team.TeamCalls, { team: teamData(), filter: "all", operator: 5, onFilter: noop, onOperator: noop });
  assert.match(html, /Стажёр Новый<span aria-hidden="true">×<\/span>/);
  assert.match(render(team.TeamCalls, { team: teamData(), filter: "ai", operator: null, onFilter: noop, onOperator: noop }), /Водителя играл ИИ \(Claude\)/);
  assert.match(html, /критическая ошибка/);
  assert.match(render(team.TeamCalls, { team: teamData(), filter: "waiting", operator: null, onFilter: noop, onOperator: noop }), /badge--warning">Спор</);
  const none = render(team.TeamCalls, { team: teamData({ calls: [] }), filter: "all", operator: null, onFilter: noop, onOperator: noop });
  assert.match(none, /операторы не принимали звонков/);
});

test("the queue lists the oldest first: a score to give and a dispute with the operator's words", () => {
  const html = render(team.TeamQueue, { team: teamData() });
  assert.ok(html.indexOf("Спор об оценке") < html.indexOf("Поставить оценку"));
  assert.match(html, /«Я назвал оба способа»/);
  assert.match(html, /ИИ был недоступен — оценку ставит наставник/);
  assert.equal((html.match(/Открыть и ответить/g) ?? []).length, 2);
  assert.match(render(team.TeamQueue, { team: teamData({ queue: [] }) }), /Ничего не ждёт вашего ответа/);
});

test("the AI tab shows the month's spend, where Claude works and the scenarios", () => {
  const html = render(team.TeamAI, { team: teamData() });
  assert.match(html, /\$0\.42/);
  assert.match(html, /из \$5 за месяц/);
  assert.match(html, /Обращений к ИИ в этом месяце: 120/);
  assert.match(html, /Включён/);
  assert.match(html, /2 из конструктора/);
  assert.match(html, /href="\/admin\/learning\/voice-scenarios"/);
  const spent = render(team.TeamAI, { team: teamData({ ai: { configured: true, active: false, model: "claude-haiku", budget_usd: 5, spent_usd: 5, calls: 1400 }, scenarios: 0 }) });
  assert.match(spent, /Лимит исчерпан/);
  assert.match(spent, /до 1-го числа/);
  assert.match(spent, /Из конструктора — пока нет/);
  assert.match(render(team.TeamAI, { team: teamData({ ai: { configured: false, active: false, model: "", budget_usd: 5, spent_usd: 0, calls: 0 } }) }), /Не подключён/);
});

test("a leader reads an operator's call without the operator's buttons and answers a dispute or grades", async () => {
  const conversation = [{ role: "driver", text: "Хочу сменить номер", turn: 0 }, { role: "operator", text: "Напишите в WhatsApp", turn: 0 }];
  const attempt = {
    id: 21, scenario_key: "phone_change", title: "Смена номера телефона", description: "", revision: 3, persona: "irritated", state: "completed",
    stage: "resolved", turn: 1, driver: { id: "d", name: "Водитель", phone: "+7", park_id: "p", park: "P" }, incoming_phone: "+7",
    transcript: conversation, practice: { dispatch: false, oktell: false, compared: false }, can_finish: false,
    result: { score: 50, criteria: [{ key: "check", label: "Проверка данных", passed: false, feedback: "Данные не проверены.", quote: "Напишите в WhatsApp", turn: 0, role: "operator", example: "Сверю номер." }], critical_errors: [] },
    created_at: "2026-10-19T05:00:00Z", finished_at: "2026-10-19T05:03:00Z",
  };
  const props = { attempt, pending: false, viewer: true, aiReview: { run: noop, pending: false, error: "" } };
  const html = render(trainer.VoiceResults, props);
  assert.match(html, /Результат звонка/);
  assert.match(html, /Ответ оператора · реплика 1/);
  assert.match(html, /Оценить с ИИ/);
  for (const own of ["Принять новый звонок", "Повторить разговор", "Есть вопрос к оценке", "Твой ответ"]) assert.doesNotMatch(html, new RegExp(own));
  const detail = { ...attempt, learner: { id: 3, name: "Оператор Первый", group_id: 1, group_name: "Группа 1" }, needs_answer: true };
  const dispute = render(team.MentorAnswer, { call: { ...detail, result: { ...attempt.result, review_status: "pending" }, review: { comment: "Я назвал способ", created_at: "2026-10-19T06:00:00Z" } }, onSaved: noop });
  assert.match(dispute, /Оператор не согласен с оценкой/);
  assert.match(dispute, /«Я назвал способ»/);
  assert.match(dispute, /Ответить оператору/);
  assert.doesNotMatch(dispute, /Оценка, %/);
  const grade = render(team.MentorAnswer, { call: { ...detail, custom: true, result: { ...attempt.result, score: null, manual: true, review_status: "awaiting_grade" }, review: null }, onSaved: noop });
  assert.match(grade, /Поставьте оценку звонку/);
  assert.match(grade, /Оценка, %/);
  assert.match(grade, /Сохранить оценку/);
  const calls = [];
  const { voiceTraining } = await moduleAt("../../api/voiceTraining.ts", async (path, options) => { calls.push({ path, options }); return detail; });
  await voiceTraining.team(7, null);
  await voiceTraining.team(30, 4);
  await voiceTraining.teamCall(21);
  await voiceTraining.teamAiReview(21);
  await voiceTraining.resolve(21, "Согласен", null);
  await voiceTraining.resolve(24, "Хороший звонок", 80);
  assert.deepEqual(calls.map(item => item.path), [
    "/api/v1/learning/voice/team?days=7", "/api/v1/learning/voice/team?days=30&group_id=4", "/api/v1/learning/voice/team/calls/21",
    "/api/v1/learning/voice/team/calls/21/ai-review", "/api/v1/learning/voice/reviews/21/resolve", "/api/v1/learning/voice/reviews/24/resolve",
  ]);
  assert.equal(calls[3].options.method, "POST");
  assert.deepEqual(calls[4].options.json, { comment: "Согласен" });
  assert.deepEqual(calls[5].options.json, { comment: "Хороший звонок", score: 80 });
});

test("the operator sees his numbers, what to train next and the calls to reread", () => {
  const progress = {
    calls: 7, calls_30d: 3, average: 57, average_30d: 61,
    best: { id: 30, title: "Смена номера телефона", persona: "calm", score: 100, created_at: "2026-10-18T05:00:00Z" },
    worst: { id: 31, title: "Смена номера телефона", persona: "irritated", score: 0, created_at: "2026-10-17T05:00:00Z" },
    weak: [{ label: "Проверка данных", passed: 1, total: 6, example: "Откройте аккаунт водителя.", attempt_id: 31 }],
  };
  const kpis = render(trainer.VoiceProgressKPIs, { progress });
  for (const label of ["Звонков", "За 30 дней", "Средний балл", "Лучший результат", ">61<", "за 30 дней", "За 30 дней</span><span class=\"kpi__value\">3</span><span class=\"kpi__hint\">звонка<"]) assert.match(kpis, new RegExp(label));
  const next = render(trainer.NextSkills, { progress });
  assert.match(next, /Что тренировать дальше/);
  assert.match(next, /получилось в 1 из 6 звонков/);
  assert.match(next, /Откройте аккаунт водителя/);
  assert.match(next, /href="\/training\/voice\/attempts\/31"/);
  assert.match(next, /Принять звонок/);
  assert.match(render(trainer.NextSkills, { progress: { ...progress, weak: [] } }), /все критерии выполнены/);
  const reread = render(trainer.BestAndHardest, { progress });
  assert.match(reread, /Лучший звонок.*100%.*Самый сложный.*0%/);
  assert.equal((render(trainer.BestAndHardest, { progress: { ...progress, worst: progress.best } }).match(/voice-best__item/g) ?? []).length, 1);
  const fresh = render(trainer.VoiceProgressKPIs, { progress: { calls: 0, calls_30d: 0, average: null, average_30d: null, best: null, worst: null, weak: [] } });
  assert.match(fresh, /пора принять звонок/);
});
