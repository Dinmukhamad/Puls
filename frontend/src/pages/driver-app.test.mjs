import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const fakeSheet = ({ title, children, onClose }) => React.createElement("section", { role: "dialog" }, React.createElement("h2", null, title), React.createElement("button", { onClick: onClose }, "Закрыть"), children);
async function component(path, overrides = {}) {
  const built = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false, define: { "import.meta.env": "{}" }, plugins: [{ name: "test-providers", setup(plugin) {
    plugin.onResolve({ filter: /\/(AuthContext|Sheet)$/ }, ({ path }) => ({ path: `test:${path.split("/").at(-1)}`, external: true }));
  } }] });
  const module = { exports: {} };
  const mocks = {
    "test:AuthContext": { useAuth: () => ({ user: { full_name: "Учебный оператор" }, atLeast: () => false }) },
    "test:Sheet": { Sheet: fakeSheet },
    "react-router-dom": { Link: ({ to, children, ...props }) => React.createElement("a", { href: to, ...props }, children) },
    ...overrides,
  };
  new Function("require", "module", "exports", built.outputFiles[0].text)((name) => mocks[name] ?? require(name), module, module.exports);
  return module.exports;
}
const { DriverScreen, DriverSplash, DriverLoading, DriverLogin, DRIVER_SECTIONS, driverSection } = await component("./DriverAppPage.tsx");
const parks = [{ id: "one", name: "Первый учебный парк", commission: 2.5 }, { id: "two", name: "Второй парк", commission: 0 }];
const profile = { stage: "offline", service: "taxi", park: parks[1], created_at: "2026-09-07T12:00:00Z", last_login_at: "2026-09-07T12:02:00Z" };
const base = { profile, parks, fullName: "Учебный оператор", section: "orders", position: null, busy: false, onAction: () => {}, onSection: () => {}, onRefresh: () => {} };
const loginProps = { stage: "phone", parkName: "iTaxi", phone: "", busy: false,
  authentication: { phone_set: true, telegram_connected: true, telegram_configured: true, remember_days: 30 },
  onPhone() {}, onSend() {}, onVerify() {}, onBack() {}, onRefresh() {} };

test("phone login asks for the employee number before showing the map", () => {
  const html = renderToStaticMarkup(React.createElement(DriverLogin, loginProps));
  assert.match(html, /iTaxi/);
  assert.match(html, /type="tel" autoComplete="tel"/);
  assert.match(html, /Получить код в Telegram/);
  assert.match(html, /30 дней/);
  assert.doesNotMatch(html, /driver-map|driver-nav|type="password"/);
});

test("unconfigured account explains the missing binding instead of accepting a code", () => {
  const html = renderToStaticMarkup(React.createElement(DriverLogin, { ...loginProps, authentication: { ...loginProps.authentication, telegram_connected: false, phone_set: false } }));
  assert.match(html, /руководителя/);
  assert.match(html, /href="\/profile#telegram"/);
  assert.doesNotMatch(html, /<input|driver-map|Подтвердить и войти/);
});

test("OTP input supports mobile autofill and shows server resend cooldown", () => {
  const html = renderToStaticMarkup(React.createElement(DriverLogin, { ...loginProps, stage: "otp", authentication: { ...loginProps.authentication, next_send_at: new Date(Date.now() + 60000).toISOString(), code_expires_at: new Date(Date.now() + 300000).toISOString() } }));
  assert.match(html, /inputMode="numeric" autoComplete="one-time-code"/);
  assert.match(html, /pattern="\[0-9\]\{6\}"/);
  assert.match(html, /Отправить ещё раз через 60 с/);
  assert.match(html, /Подтвердить и войти/);
  assert.doesNotMatch(html, /driver-map|driver-nav/);
});
const render = (patch = {}) => renderToStaticMarkup(React.createElement(DriverScreen, { ...base, ...patch }));
function elements(node) {
  if (!React.isValidElement(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
}

test("splash and skeleton separate opening the app from opening the map", () => {
  const splash = renderToStaticMarkup(React.createElement(DriverSplash));
  const loading = renderToStaticMarkup(React.createElement(DriverLoading));
  assert.match(splash, /Driver Simulator/);
  assert.match(splash, /Загрузка профиля/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /driver-loading__map/);
  assert.match(loading, /driver-loading__nav/);
  assert.doesNotMatch(splash + loading, /Яндекс|type="tel"|type="password"|OTP/);
});

test("service selection uses the Puls identity and explicitly opens Taxi", () => {
  let selected;
  const patch = { profile: { ...profile, stage: "services" }, onAction: (value) => { selected = value; } };
  const html = render(patch);
  assert.match(html, /Учебный оператор/);
  assert.match(html, /Мои сервисы/);
  assert.match(html, /Учебная работа с заказами/);
  assert.doesNotMatch(html, /Доставка|телефона|OTP|Выйти на линию|driver-nav/);
  const button = elements(DriverScreen({ ...base, ...patch })).find((item) => item.props.className === "driver-card driver-service");
  button.props.onClick();
  assert.deepEqual(selected, { action: "taxi" });
});

test("park sheet displays configured choices and sends the chosen ID", () => {
  let selected;
  const patch = { profile: { ...profile, stage: "cooperation" }, onAction: (value) => { selected = value; } };
  const html = render(patch);
  assert.match(html, /role="dialog"/);
  assert.match(html, /Выберите вариант сотрудничества/);
  assert.match(html, /Первый учебный парк/);
  assert.match(html, /2,?\.?5%/);
  assert.match(html, /Второй парк/);
  assert.match(html, /Выбран при прошлом входе/);
  assert.doesNotMatch(html, /iTaxi|Anytime|Jana Taxi|Зарегистрироваться/);
  const choices = elements(DriverScreen({ ...base, ...patch })).filter((item) => item.props.className === "driver-park");
  assert.equal(choices.length, 2);
  choices[0].props.onClick();
  assert.deepEqual(selected, { action: "park", park_id: "one" });
});

test("map is offline with no active route or enabled driving action", () => {
  const html = render();
  assert.match(html, /Карта учебного города/);
  assert.match(html, /Офлайн/);
  assert.match(html, /class="driver-online" disabled=""/);
  assert.match(html, /Сейчас доступны вход и просмотр разделов/);
  assert.doesNotMatch(html, /Учебный маршрут:|Построить маршрут|Принять|Начать поездку|Проблема|app-sidebar|bottom-nav/);
  const online = elements(DriverScreen(base)).find((item) => item.props.className === "driver-online");
  assert.equal(online.props.disabled, true);
  assert.equal(online.props.onClick, undefined);
});

test("every driver tab opens its own view, with a working return to orders", () => {
  let section = "orders";
  for (const destination of [...DRIVER_SECTIONS, DRIVER_SECTIONS[0]]) {
    const tree = DriverScreen({ ...base, section, onSection: (next) => { section = next; } });
    const nav = elements(tree).find((item) => item.type === "nav");
    const button = elements(nav).find((item) => item.type === "button" && elements(item).some((child) => child.type === "span" && child.props.children === destination.title));
    button.props.onClick();
    assert.equal(section, destination.id);
    const html = render({ section });
    if (section !== "orders") assert.match(html, new RegExp(`<h1>${destination.title}</h1>`));
    else assert.match(html, /Карта учебного города/);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.match(html, /href="\/training\?kind=simulator"/);
  }
});

test("income and profile use educational amounts and saved park conditions", () => {
  const income = render({ section: "income" });
  const identity = render({ section: "profile" });
  assert.match(income, /Учебный баланс/);
  assert.match(income, /Операций пока нет/);
  assert.match(identity, /Учебный профиль водителя/);
  assert.match(identity, /Второй парк/);
  assert.match(identity, /0%/);
  assert.doesNotMatch(income + identity, /коин|Сменить пароль|Вывести|Пополнить/);
});

test("profile can return to service selection or browse learning", () => {
  let action, section;
  const tree = DriverScreen({ ...base, section: "profile", onAction: (value) => { action = value; }, onSection: (value) => { section = value; } });
  const menu = elements(tree).find((item) => item.props.className === "driver-card driver-menu");
  const buttons = elements(menu).filter((item) => item.type === "button");
  buttons[0].props.onClick();
  assert.deepEqual(action, { action: "services" });
  buttons[1].props.onClick();
  assert.equal(section, "learning");
  assert.match(render({ section }), /<h1>Обучение<\/h1>/);
  assert.equal(driverSection("learning"), "learning");
  assert.equal(driverSection("online"), "orders");
});

test("entry offers resume only for unfinished login and a fresh launch after completion", async () => {
  let current, lastResult;
  const { DriverEntry } = await component("./DriverEntry.tsx", {
    "@tanstack/react-query": { useQuery: () => ({ data: { profile: current, parks, last_result: lastResult } }), useQueryClient: () => ({}), useMutation: () => ({}) },
    "react-router-dom": { useNavigate: () => () => {}, Link: ({ to, children }) => React.createElement("a", { href: to }, children) },
  });
  const entry = () => renderToStaticMarkup(React.createElement(DriverEntry));
  assert.match(entry(), /Ещё не запускали/);
  current = { ...profile, stage: "cooperation", last_login_at: null };
  assert.match(entry(), /Продолжить вход/);
  assert.match(entry(), /Выбор парка/);
  current = profile;
  const completed = entry();
  assert.match(completed, /Вход пройден/);
  assert.match(completed, /Последний вход/);
  assert.match(completed, /Начать симуляцию/);
  assert.doesNotMatch(completed, /Продолжить вход|href="\/simulator"/);
  lastResult = { attempt_id: 7, title: "Пройденный сценарий", state: "passed", score: 100 };
  assert.match(entry(), /Последний результат/);
  assert.match(entry(), /href="\/simulator\/attempts\/7"/);
  assert.match(entry(), /100%/);
});
