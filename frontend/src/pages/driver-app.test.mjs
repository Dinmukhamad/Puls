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

test("country prefix alone cannot request an OTP; a complete phone can", () => {
  const prefix = renderToStaticMarkup(React.createElement(DriverLogin, { ...loginProps, phone: "+7" }));
  assert.match(prefix, /value="\+7"/);
  assert.match(prefix, /type="submit" disabled=""/);
  const full = renderToStaticMarkup(React.createElement(DriverLogin, { ...loginProps, phone: "+7 700 123 45 67" }));
  assert.doesNotMatch(full, /type="submit" disabled/);
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
  assert.match(html, /Карта появится после определения местоположения/);
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
    else assert.match(html, /Карта появится после определения местоположения/);
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

const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { DriverNavigationOrders } = await component("./DriverNavigationOrders.tsx");
const navSpec = { mode: "real", pickup: { latitude: 43.2, longitude: 76.9, label: "Точка А" }, destination: { latitude: 43.21, longitude: 76.91, label: "Точка Б" }, planned_distance: 1900, planned_duration: 240, rules: { arrival_radius: 75, free_wait_seconds: 30 } };
function navigationHtml(stage, available, allowed, payment = "cash") {
  const client = new QueryClient();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(DriverNavigationOrders, {
    state: { order: { ...order, stage, payment, details: { navigation: navSpec } }, server_now: new Date().toISOString(), navigation: { gps_available: available, can_arrive: allowed, can_start: allowed, can_finish: allowed, arrival_radius: 75, distance_to_target: 1900, status: stage === "trip" ? "IN_RIDE" : "TO_PICKUP" } },
    location: { status: available ? "ready" : "denied", fix: available ? { latitude: 43.2, longitude: 76.9, accuracy: 10, captured_at: new Date().toISOString() } : null, message: "Нет сигнала GPS", retry() {} },
    consent: "enabled", allowLocation() {}, declineLocation() {}, busy: false, create() {}, go() {},
  })));
  client.clear();
  return html;
}
test("lost GPS blocks completion and offers instructions, not a fictitious settings action", () => {
  const html = navigationHtml("trip", false, true);
  assert.match(html, /class="du-act" data-state="blocked"/);
  assert.match(html, /class="du-btn du-action" type="button" disabled=""/);
  assert.match(html, /Сначала восстановите геолокацию/);
  assert.match(html, /class="du-info" data-open="false"/);
  assert.match(html, /Как разрешить геолокацию\?/);
  assert.match(html, /aria-expanded="false" aria-controls="/);
  assert.match(html, /Повторить запрос геолокации/);
  assert.doesNotMatch(html, /Открыть настройки|До точки Б по прямой/);
});
test("arrival gates and explanations distinguish pickup from trip completion", () => {
  const blocked = navigationHtml("pickup", true, false);
  assert.match(blocked, /class="du-act" data-state="blocked"/);
  assert.match(blocked, /class="du-btn du-action" type="button" disabled=""/);
  assert.match(blocked, /Подойдите к точке А в радиус 75 м/);
  const ready = navigationHtml("pickup", true, true);
  assert.match(ready, /class="du-act" data-state="ready"/);
  assert.doesNotMatch(ready, /du-action" type="button" disabled/);
  assert.match(ready, /Нажатие начнёт ожидание пассажира/);
  assert.match(navigationHtml("trip", true, false), /радиус 75 м/);
  assert.match(navigationHtml("trip", true, true, "cash"), /Получите учебную оплату/);
  assert.doesNotMatch(navigationHtml("trip", true, true, "card"), /Получите учебную оплату/);
});
test("a blocked action states its reason and draws the yellow readiness arc", () => {
  const far = navigationHtml("pickup", true, false);
  assert.match(far, /style="--du-progress:0"/);
  assert.match(far, /<b>1,9 км<\/b>/);
  assert.match(far, /class="du-reason" id="[^"]+" data-tone="blocked"/);
  const ready = navigationHtml("pickup", true, true);
  assert.match(ready, /style="--du-progress:1"/);
  assert.match(ready, /data-tone="ready"/);
});

const { DAction, DChoice, DInfo, DCancel, approach, countdown } = await component("./DriverButtons.tsx");
test("four button roles stay visually distinct and instructions never submit", () => {
  const roles = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(DAction, { label: "Подтвердить прибытие", onClick() {} }),
    React.createElement(DChoice, { onClick() {}, children: "Выбрать на карте" }),
    React.createElement(DInfo, { title: "Как разрешить геолокацию?", children: "Откройте разрешения браузера." }),
    React.createElement(DCancel, { onClick() {}, children: "Отменить заказ" }),
  ));
  assert.match(roles, /class="du-btn du-action"/);
  assert.match(roles, /class="du-btn du-choice"/);
  assert.match(roles, /class="du-btn du-info__button"/);
  assert.match(roles, /class="du-cancel"/);
  assert.equal((roles.match(/type="button"/g) ?? []).length, 4);
  assert.doesNotMatch(roles, /type="submit"/);
  assert.equal(approach(1900, 75), 0);
  assert.equal(approach(60, 75), 1);
  assert.equal(approach(600 - (600 - 75) / 2, 75), .5);
  assert.equal(countdown(15, 30), .5);
  assert.equal(countdown(40, 30), 1);
});
const { DriverChats } = await component("./DriverWorkViews.tsx");
const { DRadio } = await component("./DriverShiftUI.tsx");
test("exclusive settings expose native radios in the same group", () => {
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(DRadio, { name: "payment", value: "cash", title: "Наличные", checked: true, onChange() {} }),
    React.createElement(DRadio, { name: "payment", value: "card", title: "Карта", checked: false, onChange() {}, disabled: true }),
  ));
  assert.equal((html.match(/type="radio" name="payment"/g) ?? []).length, 2);
  assert.equal((html.match(/checked=""/g) ?? []).length, 1);
  assert.match(html, /disabled="" value="card"/);
});
test("chat shortcuts lead to the shift result and support preparation is explicitly labeled", () => {
  let target;
  const props = { shift: { data: { messages: [] } }, state: {}, view: "chats", detail: "", busy: false, go: (...args) => { target = args; }, support() {} };
  const buttons = elements(DriverChats(props)).filter(x => x.type === "button");
  buttons[2].props.onClick();
  assert.deepEqual(target, ["shift-result", undefined]);
  const html = renderToStaticMarkup(React.createElement(DriverChats, { ...props, view: "support" }));
  assert.match(html, /Подготовить обращение в Telegram/);
  assert.doesNotMatch(html, /Продолжить в @puls_i_bot/);
});

const { DriverMoney, MONEY_VIEWS, weekBuckets, BALANCE_LIMIT } = await component("./DriverMoneyViews.tsx");
const moneyData = { balance: 0, available: 0, reserved: 0, completed: 0, fuel: [], ledger: [], settings: { hide_income: false } };
const moneyHtml = (view, data = {}, detail = "") => renderToStaticMarkup(React.createElement(DriverMoney, {
  shift: { id: "shift", mode: "free", config: {}, data: { ...moneyData, ...data } },
  state: { profile: { park: { name: "Jana Taxi" } } },
  view, detail, fullName: "Учебный водитель", busy: false, act() {}, go() {}, switchPark() {}, support() {},
}));

test("money landing mirrors the park app: today, week strip, balance limit and park", () => {
  const html = moneyHtml("money");
  assert.match(html, /<h1>Деньги<\/h1>/);
  assert.match(html, /Поддержка/);
  assert.match(html, /Сегодня/);
  assert.match(html, /Лимит баланса/);
  assert.match(html, /Всё в порядке/);
  assert.match(html, /Jana Taxi/);
  assert.equal((html.match(/class="dm-week"/g) ?? []).length, 1);
  assert.equal((html.match(/data-now="true"/g) ?? []).length, 1);
  assert.equal((html.match(/<i><\/i>/g) ?? []).length, 7);
});

test("balance screen offers three round actions and splits finished from pending", () => {
  const html = moneyHtml("balance");
  assert.match(html, /Пополнить/);
  assert.match(html, /Вывести/);
  assert.match(html, /Ещё/);
  assert.match(html, /История транзакций/);
  assert.match(html, /aria-pressed="true"[^>]*>Завершенные/);
  assert.match(html, /В процессе · 0/);
  assert.match(html, /Тут пусто/);
  const filled = moneyHtml("balance", { ledger: [
    { id: "a", title: "Заказ", amount: 1200, kind: "order", order_id: null, status: "complete", at: "2026-09-11T07:00:00", note: "" },
    { id: "b", title: "Выплата", amount: -500, kind: "payout", order_id: null, status: "pending", at: "2026-09-11T07:30:00", note: "" },
  ] });
  assert.match(filled, /В процессе · 1/);
  assert.match(filled, /\+1\s200 ₸/);
  assert.doesNotMatch(filled, /Тут пусто/);
});

test("payments and requisites keep the park layout without asking for card details", () => {
  assert.match(moneyHtml("payments"), /Пока что тут ничего нет/);
  assert.match(moneyHtml("payments", { fuel: [{ liters: 10, amount: 2450, at: "2026-09-11T07:00:00" }] }), /Заправка · 10 л/);
  const cards = moneyHtml("requisites");
  assert.match(cards, /Ваши реквизиты/);
  assert.match(cards, /Добавить карту/);
  assert.doesNotMatch(cards, /<input|Номер карты|CVV/);
});

test("earnings compares seven days and details income against spending", () => {
  const html = moneyHtml("earnings");
  assert.match(html, /Сравнение/);
  assert.match(html, /Детализация/);
  assert.match(html, /Нет данных о заработке/);
  assert.equal((html.match(/class="dm-chart"/g) ?? []).length, 1);
  assert.equal((html.match(/<em>0<\/em>/g) ?? []).length, 7);
});

test("hidden income masks every amount the money section prints", () => {
  const html = moneyHtml("money", { balance: 4200, settings: { hide_income: true } });
  assert.match(html, /••••/);
  assert.doesNotMatch(html, /4\s200/);
});

test("week buckets place today last and separate income from spending", () => {
  const now = new Date("2026-09-11T12:00:00Z").getTime();
  const week = weekBuckets([
    { amount: 1200, at: new Date(now - 1000).toISOString() },
    { amount: -300, at: new Date(now - 2000).toISOString() },
    { amount: 900, at: new Date(now - 3 * 86400000).toISOString() },
  ], now);
  assert.equal(week.length, 7);
  assert.equal(week[6].now, true);
  assert.equal(week[6].income, 1200);
  assert.equal(week[6].spent, 300);
  assert.equal(week[3].income, 900);
  assert.equal(week[0].income, 0);
  assert.ok(MONEY_VIEWS.includes("balance") && MONEY_VIEWS.includes("earnings"));
  assert.ok(BALANCE_LIMIT < 0);
});

const { DriverProfileViews, PROFILE_VIEWS } = await component("./DriverProfileViews.tsx");
const profileConfig = {
  tariffs: [{ id: "econom", name: "Эконом", available: true, reason: "" }, { id: "comfort", name: "Комфорт", available: false, reason: "Машина не подходит" }],
  levels: [{ name: "Новичок", threshold: 0, benefits: "Базовые условия" }, { name: "Мастер", threshold: 1000, benefits: "Доп. приоритет" }],
  priority_base: 30, priority_complete: 5, priority_missed: 2, priority_cancelled: 3, target_orders: 3,
  service_percent: 7, service_tax_percent: 12, wait_per_minute: 40,
};
const profileData = {
  cars: [{ id: "c1", brand: "Audi", model: "RS 6", year: 2026, plate: "280XSH03", status: "available" }], car_id: "c1",
  photo_status: "pending", photo_steps: [], tariffs: ["econom"], payment: "any", rating_votes: [0, 0, 0, 0, 4],
  points: 0, priority: 30, completed: 0, missed: 0, cancelled: 0, available: 0, provider: null,
  documents: [], promos: [], lessons: [], rentals: [], fuel: [], points_history: [], level_restored: false,
  settings: { theme: "dark", hide_income: false, widgets: true, vibration: true, auto_arrive: false, auto_start: false },
};
const profileHtml = (view, data = {}, detail = "") => renderToStaticMarkup(React.createElement(DriverProfileViews, {
  shift: { id: "shift-abc123", mode: "free", data: { ...profileData, ...data }, config: profileConfig },
  state: { profile: { park: { name: "Jana Taxi", commission: 2 }, created_at: "2026-09-11T07:00:00" } },
  view, detail, fullName: "Шерзад Учебный", busy: false, act() {}, go() {}, switchPark() {}, support() {},
}));

test("profile landing mirrors the park app: identity, stat tiles, park rows and vehicle", () => {
  const html = profileHtml("profile");
  assert.match(html, /Шерзад/);
  assert.match(html, /Водитель/);
  assert.match(html, /Сменить парк/);
  assert.match(html, /Рейтинг/);
  assert.match(html, /Баллы/);
  assert.match(html, /Приоритет/);
  assert.match(html, /Jana Taxi/);
  assert.match(html, /1 из 2/);
  assert.match(html, /Наличными или картой/);
  assert.match(html, /Мой транспорт/);
  assert.match(html, /class="dp-plate">280XSH03/);
  assert.equal((html.match(/class="dp-tiles"/g) ?? []).length, 1);
});

test("tariffs gate on photo control and hide unavailable ones behind a group", () => {
  const blocked = profileHtml("tariffs");
  assert.match(blocked, /Курьер/);
  assert.match(blocked, /Пройдите фотоконтроль машины/);
  assert.match(blocked, /data-tone="danger"/);
  assert.doesNotMatch(blocked, /ds-toggle/);
  const ready = profileHtml("tariffs", { photo_status: "passed" });
  assert.match(ready, /ds-toggle/);
  assert.doesNotMatch(ready, /Пройдите фотоконтроль машины/);
  assert.match(ready, /Недоступные тарифы и опции/);
  assert.doesNotMatch(ready, /Машина не подходит/);
});

test("photo control lists every angle with its own status", () => {
  const html = profileHtml("photo", { photo_steps: [0, 1] });
  assert.match(html, /Блокирует работу/);
  assert.match(html, /Автомобиль спереди/);
  assert.match(html, /Селфи водителя/);
  assert.equal((html.match(/Пройдено</g) ?? []).length, 2);
  assert.match(html, /data-tone="danger">✕/);
  const done = profileHtml("photo", { photo_status: "passed", photo_steps: [0, 1, 2, 3, 4] });
  assert.match(done, /Проверка пройдена/);
  assert.match(done, /Пройти фотоконтроль ещё раз/);
});

test("priority draws a gauge against the scenario maximum and splits earned from lost", () => {
  const html = profileHtml("priority");
  assert.match(html, /aria-label="Приоритет 30 из 45"/);
  assert.match(html, /Полученные/);
  assert.match(html, /Базовое значение/);
  assert.match(html, /\+30/);
  assert.match(html, /Снято/);
  assert.match(html, /Без штрафа/);
});

test("levels show the next target with progress and the loyalty scale", () => {
  const html = profileHtml("levels", { points: 400 });
  assert.match(html, /Копите баллы и получите уровень/);
  assert.match(html, /Мастер/);
  assert.match(html, /data-theme="pro"/);
  assert.match(html, /width:40%/);
  const top = profileHtml("levels", { points: 5000 });
  assert.match(top, /Ваш текущий уровень/);
  assert.doesNotMatch(top, /Копите баллы и получите уровень/);
});

test("rating prints the average and a row per star bucket", () => {
  const html = profileHtml("rating");
  assert.match(html, /5\.00/);
  assert.match(html, /Вы здесь/);
  assert.match(html, /История/);
  assert.equal((html.match(/dp-star-on/g) ?? []).length, 5 + 4 + 3 + 2 + 1);
  assert.match(profileHtml("rating", { rating_votes: [0, 0, 0, 0, 0] }), /—/);
});

test("car detail keeps park-only actions visible but locked", () => {
  const html = profileHtml("car", {}, "c1");
  assert.match(html, /Audi RS 6/);
  assert.match(html, /280XSH03/);
  assert.match(html, /Брендинг/);
  assert.match(html, /Нужно обратиться в ваш парк/);
  assert.equal((html.match(/data-locked="true"/g) ?? []).length, 3);
  assert.match(html, /Пройдено 0 из 5/);
});

test("preparation checklist points at the first unfinished step", () => {
  const html = profileHtml("diagnostics");
  assert.match(html, /Завершите подготовку к заказам/);
  assert.match(html, /data-now="true"/);
  assert.match(html, /Следующий шаг: пройдите фотоконтроль/);
  const ready = profileHtml("diagnostics", { photo_status: "passed" });
  assert.match(ready, /Перейти к заказам/);
  assert.match(ready, /Всё готово/);
});

test("about screen leaves the simulator instead of pretending to log out", () => {
  const html = profileHtml("about");
  assert.match(html, /О вас/);
  assert.match(html, /Jana Taxi/);
  assert.match(html, /Карточка качества/);
  assert.match(html, /href="\/training\?kind=simulator"/);
  assert.doesNotMatch(html, /Выйти из аккаунта/);
  assert.ok(PROFILE_VIEWS.includes("about") && PROFILE_VIEWS.includes("car"));
});
