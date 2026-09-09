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

test("map starts offline and offers the new order flow", () => {
  const html = render();
  assert.match(html, /Карта учебного города/);
  assert.match(html, /Офлайн/);
  assert.match(html, /class="driver-online"/);
  assert.doesNotMatch(html, /class="driver-online" disabled/);
  assert.match(html, /Один заказ от начала до конца/);
  assert.doesNotMatch(html, /Учебный маршрут:|Построить маршрут|Принять|Начать поездку|Проблема|app-sidebar|bottom-nav/);
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

test("entry offers two modes, resumes the current shift and exposes the last result", async () => {
  let current = { profile, parks };
  const { DriverEntry } = await component("./DriverEntry.tsx", {
    "@tanstack/react-query": { useQuery: () => ({ data: current }), useQueryClient: () => ({}), useMutation: () => ({}) },
    "react-router-dom": { useNavigate: () => () => {}, Link: ({ to, children }) => React.createElement("a", { href: to }, children) },
  });
  const entry = () => renderToStaticMarkup(React.createElement(DriverEntry));
  assert.match(entry(), /Свободный · без штрафов/);
  assert.match(entry(), /Учебная смена · с оценкой/);
  current.shift = { id: "shift", mode: "assessment", finished_at: null, config: { target_orders: 3 }, data: { completed: 1 } };
  assert.match(entry(), /Продолжить смену/);
  assert.match(entry(), /1\/3/);
  assert.doesNotMatch(entry(), /Начать симуляцию/);
  current.shift.finished_at = "2026-09-09T12:00:00Z";
  current.shift_best = 95;
  current.shift_history = [{ id: "shift", finished_at: current.shift.finished_at, result: { score: 90 } }];
  assert.match(entry(), /Лучший результат: 95\/100/);
  assert.match(entry(), /90\/100/);
  assert.match(entry(), /Начать симуляцию/);
  assert.match(entry(), /Открыть разбор/);
});

const { DriverOrders, orderTiming } = await component("./DriverOrders.tsx");
const { routePosition } = await component("./DriverOrderMap.tsx");
const order = { id: "qa-order", stage: "pickup", origin: "Первая улица, 7", destination: "Вторая улица, 10", payment: "cash", fare: 1960, commission: 39, net: 1921, park: parks[0], version: 2, events: [], created_at: "2026-09-09T10:00:00Z", stage_started_at: "2026-09-09T10:00:00", finished_at: null, duration_seconds: 8 };
const orderHtml = (overrides = {}, now = "2026-09-09T10:00:00Z") => renderToStaticMarkup(React.createElement(DriverOrders, { position: null, busy: false, serverNow: now, order: { ...order, ...overrides }, onIncome() {} }));

test("arrival and finishing wait for the simulated route, including restored UTC timestamps", () => {
  assert.deepEqual(orderTiming(order, "2026-09-09T10:00:02Z", 2), { elapsed: 4, remaining: 4, progress: .5, ready: false });
  assert.equal(orderTiming(order, "2026-09-09T09:59:00Z").progress, 0);
  assert.equal(orderTiming(order, "2026-09-09T10:01:00Z").progress, 1);
  assert.match(orderHtml(), /class="driver-order-action" disabled=""/);
  assert.doesNotMatch(orderHtml({}, "2026-09-09T10:00:10Z"), /class="driver-order-action" disabled/);
  assert.match(orderHtml({ stage: "trip", duration_seconds: 38 }), /Завершить поездку/);
  assert.match(orderHtml({ stage: "trip", duration_seconds: 38 }), /class="driver-order-action" disabled=""/);
});

test("payment screens distinguish cash confirmation from automatic card payment", () => {
  const cash = orderHtml({ stage: "payment", duration_seconds: 2 });
  const card = orderHtml({ stage: "payment", payment: "card", duration_seconds: 2 });
  assert.match(cash, /Деньги получены/);
  assert.match(card, /Наличные с пассажира брать не нужно/);
  assert.doesNotMatch(card, /Деньги получены/);
  assert.doesNotMatch(cash + card, /Номер карты|CVV|Пополнить/);
});

test("completed orders expose receipt and repetition; active route hides unrelated navigation", () => {
  const done = orderHtml({ stage: "complete", duration_seconds: 0 });
  assert.match(done, /Заказ выполнен|Ваш учебный доход/);
  assert.match(done, /Следующий заказ/);
  assert.match(done, /Наличные получены/);
  const html = render({ orderState: { order, order_summary: { count: 2, gross: 3920, commission: 78, net: 3842 }, order_history: [], server_now: "2026-09-09T10:00:00Z" } });
  assert.doesNotMatch(html, /class="driver-nav"/);
  assert.match(html, /Выйти из симулятора в Puls/);
});

test("custom address text is escaped and the car follows each route segment", () => {
  const html = orderHtml({ stage: "offer", origin: '<img src=x onerror="bad()">', destination: "Назначение, 25" });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
  assert.match(html, /Назначение, 25/);
  const points = [[0, 0], [10, 0], [10, 10]];
  assert.deepEqual(routePosition(points, .25), { x: 5, y: 0, angle: 90 });
  assert.deepEqual(routePosition(points, .75), { x: 10, y: 5, angle: 180 });
  assert.deepEqual(routePosition(points, 2), { x: 10, y: 10, angle: 180 });
});
