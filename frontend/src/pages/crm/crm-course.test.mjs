import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const bundle = async file => {
  const built = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
};
const { CrmCourseDock } = await bundle("./CrmCourseDock.tsx");
const { courseTarget, practiceReadiness } = await bundle("./crmCourseGuide.ts");
const driver = { name: "Ахметов Данияр", id: "d1", phone: "+77756102284", license: "KZ118456", park: "iTaxi", city: "Караганда", link: "https://fleet.yandex.kz/contractors/d1/details?park_id=p1", new_phone: "+77756102285" };
const steps = (key, done) => ({
  crm_intro_v2: ["list", "appeal", "ticket"], crm_phone_v2: ["inspect", "capture", "form", "save", "ticket"], crm_mismatch_v2: ["inspect", "advice"],
  crm_rework_v2: ["appeal", "ticket", "moderate", "rework", "comment"], crm_practice_v2: ["form", "save"],
})[key].map((name, i) => ({ key: name, label: `Шаг ${name}`, status: i < done ? "passed" : "pending" }));
const KEYS = ["crm_intro_v2", "crm_phone_v2", "crm_mismatch_v2", "crm_rework_v2", "crm_practice_v2"];
const task = (key, state, done = 0, extra = {}) => ({ key, state, title: `Урок ${key}`, goal: "", speech: "", driver, category_path: [], steps: steps(key, done), checks: [], appeal_id: null, ticket_id: null, started_at: null, passed_at: null, ...extra });
const course = (current, done = 0) => ({ revision: 2, completed: done, active_task: current.state === "in_progress" ? current.key : null, tasks: KEYS.map((key, i) => key === current.key ? current : task(key, i < done ? "passed" : "locked")) });
const props = { loading: false, error: null, busy: false, actionError: null, onReload() {}, onStart() {}, onShow() {}, onInstructions() {}, onCity() {} };
const render = (data, extra = {}) => renderToStaticMarkup(React.createElement(CrmCourseDock, { ...props, data, ...extra }));

test("the pending step says where to click, and the dock leads to its screen only from elsewhere", () => {
  const intro = task("crm_intro_v2", "in_progress", 1, { appeal_id: 7, ticket_id: 3 });
  const away = render(course(intro), { location: { place: "ticket", id: 9 } });
  assert.match(away, /Шаг 2 из 3/);
  assert.match(away, /номер подсвечен/);
  assert.match(away, /Открыть список обращений/);
  assert.match(away, /Обращение<\/dt><dd>Данные звонка/);
  const here = render(course(intro), { location: { place: "list" } });
  assert.doesNotMatch(here, /Открыть список обращений/);
  assert.match(here, /выделено синей рамкой/);
  assert.doesNotMatch(here, /Я выполнил<\/button>|Продолжить/);
});

test("every failed check is listed above the step, with the way back to the same appeal", () => {
  const checks = [
    { key: "phone", label: "Текущий номер", ok: false, message: "В поле телефона укажи текущий номер регистрации." },
    { key: "link", label: "Аккаунт водителя", ok: false, message: "Вставь ссылку на аккаунт." },
    { key: "city", label: "Город", ok: true, message: "" },
  ];
  const phone = task("crm_phone_v2", "in_progress", 2, { appeal_id: 71, checks });
  const html = render(course(phone, 1), { location: { place: "appeal", id: 71 } });
  assert.match(html, /Система нашла ошибки: 2/);
  assert.match(html, /Текущий номер\.<\/b> В поле телефона/);
  assert.match(html, /Аккаунт водителя\.<\/b> Вставь ссылку/);
  assert.match(html, /Исправить обращение №71/);
  assert.ok(html.indexOf("Система нашла ошибки") < html.indexOf("crm-course-step"));
  assert.match(html, /Прошу изменить номер телефона на \+77756102285/);
});

test("a lesson just passed is confirmed with what it taught and the next lesson to start", () => {
  const data = { revision: 2, completed: 1, active_task: null, tasks: KEYS.map((key, i) => task(key, i === 0 ? "passed" : i === 1 ? "available" : "locked", i === 0 ? 3 : 0)) };
  const html = render(data, { passed: data.tasks[0] });
  assert.match(html, /✓ Урок 1 пройден/);
  assert.match(html, /дальнейшая обработка запроса идёт в тикете/);
  assert.match(html, /Начать урок 2: Урок crm_phone_v2/);
  assert.match(html, /aria-valuenow="1"/);
});

test("practice gives the task's data and a short way through, and nothing on the page is lit up for it", () => {
  const practice = task("crm_practice_v2", "in_progress", 0, { incoming_phone: "+77756102284" });
  const html = render(course(practice, 4), { location: { place: "lesson" } });
  assert.match(html, /Данные задания/);
  assert.match(html, /<dt>Водитель<\/dt><dd>Ахметов Данияр<\/dd>/);
  assert.match(html, /<dt>Звонит с номера<\/dt><dd>\+77756102284<\/dd>/);
  assert.match(html, /<dt>Просит новый номер<\/dt><dd>\+77756102285<\/dd>/);
  assert.match(html, /Как пройти урок/);
  assert.match(html, /Дождись скриншота внизу формы/);
  assert.match(html, /Перейти к оформлению обращения/);
  assert.doesNotMatch(html, /выделено синей рамкой|Сравни номер в OKTEL|Открыт связанный тикет/);
  assert.equal(courseTarget(practice), undefined);
  assert.equal(courseTarget(task("crm_rework_v2", "in_progress", 2)), "moderate");
  assert.equal(courseTarget(task("crm_rework_v2", "passed", 5)), undefined);
});

test("the mismatched call lists the three ways and a sample answer", () => {
  const html = render(course(task("crm_mismatch_v2", "in_progress", 1), 2), { location: { place: "lesson" } });
  assert.match(html, /Позвонить на линию с номера регистрации/);
  assert.match(html, /Изменить номер в приложении «Такси Про»/);
  assert.match(html, /Написать в WhatsApp для смены номера/);
  assert.match(html, /Пример ответа водителю/);
});

test("the practice's screenshot waits for the same appeal the server accepts", () => {
  const practice = task("crm_practice_v2", "in_progress", 0, { category_path: ["Водитель", "Самозанятый водитель", "Запрос", "Таксопарк", "Обработка запросов/ООЗ", "Смена номера"] });
  const path = practice.category_path;
  const right = { channel: "Звонок", phone: "8 775 610 22 84", license_number: "kz 118456", park: "iTaxi", city: "Караганда", comment: `Прошу изменить номер на +7 775 610 22 85.\n${driver.link}` };
  const missing = (form, chosen = path) => practiceReadiness(practice, form, chosen).filter(check => !check.ok).map(check => check.key);
  assert.deepEqual(missing(right), []);
  // The new number in the phone field is the usual mistake: the current one belongs there.
  assert.deepEqual(missing({ ...right, phone: driver.new_phone }), ["driver"]);
  assert.deepEqual(missing({ ...right, city: "Алматы" }), ["park"]);
  assert.deepEqual(missing(right, path.slice(0, 5)), ["category"]);
  // The number has to be written out: the one inside the link does not count, nor does the link alone.
  assert.deepEqual(missing({ ...right, comment: driver.link }), ["comment"]);
  assert.deepEqual(missing({ ...right, comment: "Новый номер +77756102285" }), ["comment"]);
  assert.deepEqual(missing({ ...right, comment: `Новый номер +77756102285 ${driver.link.replace("park_id=p1", "park_id=other")}` }), ["comment"]);
  assert.deepEqual(missing({ ...right, channel: "Чат" }), ["channel"]);
});
