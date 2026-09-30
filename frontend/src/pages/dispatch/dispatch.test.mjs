import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL(".", import.meta.url));
async function bundle(contents, stubs = {}) {
  const built = await build({ stdin: { contents, resolveDir: here, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false, define: { "import.meta.env": "{}" },
    plugins: [{ name: "stubs", setup(b) { b.onResolve({ filter: /\/(AuthContext|guide)$/ }, args => ({ path: `stub:${args.path.split("/").at(-1)}`, external: true })); } }] });
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(name => stubs[name] ?? require(name), module, module.exports);
  return module.exports;
}
const guide = { useGuide: () => ({ name: "Пульсар", gender: null, named: true, text: t => t }), guideText: t => t, guideName: () => "Пульсар", DEFAULT_GUIDE: "Пульсар" };
const auth = { useAuth: () => ({ user: { id: 7, role: "operator", full_name: "Оператор Учебный" } }) };
const kit = await bundle(`export * from './fleetNav.ts'; export * from './FleetUi.tsx'; export * from './dispatchTours.ts';
  export { ContractorsPage } from './FleetContractors.tsx'; export { DriverPage, ledger } from './FleetDriver.tsx'; export * from './FleetOverview.tsx';
  export { InventoryPage, Thermobox } from './FleetInventory.tsx'; export { SupportPage } from './FleetSupport.tsx'; export { AntifraudPage, OrderPage } from './FleetAntifraud.tsx';`, { "stub:guide": guide, "stub:AuthContext": auth });

const car = (tariffs, extra = {}) => ({ brand: "Toyota", model: "Camry", year: 2020, color: "Чёрный", plate: "095NBS09", callsign: "095NBS09", vin: "JT1", tariffs, wrap: false, wrap_checked: false, lightbox: false, transmission: "Автоматическая", fuel: "Бензин", ...extra });
const order = (id, tariff, extra = {}) => ({ id, status: "complete", cancel_reason: "", created_at: "2026-09-29T15:02:00", finished_at: "2026-09-29T15:20:00", from: "улица Сыганак, 18", to: "проспект Мангилик Ел, 55", tariff, distance: 4.2, duration: 1080, price: 900, payment: "card", tips: 100, ...extra });
const priority = { value: 42, max: 93, label: "Высокий приоритет", got: [{ label: "Принятые заказы", points: 30, max: 30, hint: "" }], can: [{ label: "Брендинг машины", points: 18, max: 18, hint: "Оклейка включена — осталось пройти фотоконтроль брендинга" }] };
const driver = (id, park, last, extra = {}) => ({ id, park, last_name: last, first_name: "Ерлан", middle_name: "Серикович", phone: "+77014829154", license: "KA482915", license_country: "Казахстан", license_issued: "2020-01-02", license_expires: "2030-01-01", experience_since: "2012-05-01",
  iin: "900214300517", address: "Караганда", segment: "active", works: true, status: "free", gps: true, employment: "Парковый самозанятый", profession: "Водитель такси", rule: "Свободный (Яндекс 4%, Таксопарк 4%)", provider: "Sapar",
  balance: 3450.2, account_limit: -50, withdraw_limit: 0, rating: 4.93, car: car(["Эконом", "Курьер"]), thermobox: null, diagnostics: { ok: true, title: "Всё в порядке", reasons: [] }, priority,
  bonus: null, comment: "", source: "Канал не указан", device: "Redmi", app_version: "13.69", created: "2025-01-01", photo_checks: ["2026-09-23"], orders: [order("86000001", "Эконом")], ...extra });
const state = {
  now: "2026-09-29T18:00:00", login: "oper@training.kz",
  parks: [{ id: "itaxi-krg", name: "iTaxi", city: "Караганда", color: "#c9ec8f", park_id: "a".repeat(32) }, { id: "itaxi-ast", name: "iTaxi", city: "Астана", color: "#b9e4f5", park_id: "b".repeat(32) }],
  drivers: [
    driver("d1", "itaxi-krg", "Жумабаев", { provider: "Бумажный документооборот", car: car(["Эконом", "Комфорт"], { wrap: true }) }),
    driver("d2", "itaxi-krg", "Ким", { status: "offline", gps: false, diagnostics: { ok: false, title: "Доступ временно приостановлен", reasons: ["Восстановите сигнал GPS"] } }),
    driver("d3", "itaxi-ast", "Абенов", { withdraw_limit: 700, orders: [order("65804916", "Эконом", { duration: 53, distance: 0, price: 700, tips: 0 })], bonus: { done: 41, target: 70, amount: 9000, from: "2026-09-21", to: "2026-09-27", place: "Астана", tariffs: "Эконом" } }),
    driver("d4", "itaxi-krg", "Оспанова", { profession: "Курьер", car: null, license: "", thermobox: { type: "eda", number: "EP0812" } }),
  ],
  rules: [{ name: "Для всех 2%", count: 353, default: true }, { name: "Курьеры 1%", count: 612, default: false }],
  antifraud: [{ driver: "d3", driver_name: "Абенов Руслан", park: "itaxi-ast", amount: 700, rule: "Продолжительность поездки", value: "53 с", limit: "2 мин", at: "2026-09-29T16:00:00", order: "65804916", from: "улица Сыганак, 18", to: "проспект Мангилик Ел, 55" }],
  antifraud_rules: ["Стоимость поездки", "Продолжительность поездки"],
  inventory: { stock: { eda: 31, delivery: 49 }, log: [{ employee: "oper@training.kz", driver: "d4", driver_name: "Оспанова Дана", operation: "Выдача", type: "eda", number: "EP0812", qty: 1, at: "2026-09-29T17:00:00", park: "itaxi-krg" }] },
  tickets: [{ id: "M-1", question: "ДД! Прошу проверить ограничение", theme: "Вопросы об исполнителе", subtheme: "Ограничение доступа к сервису", status: "В работе", reply: "", author: "oper@training.kz", created_at: "2026-09-29T17:00:00", updated_at: "2026-09-29T17:00:00", private: false, kind: "text", license: "RS558210", files: [], park: "itaxi-krg", mine: true }],
  calls: [],
  catalog: { tariffs: ["Эконом", "Комфорт", "Курьер", "Межгород"], providers: ["Sapar", "Бумажный документооборот"], inventory: { eda: "Яндекс Еда", delivery: "Яндекс Доставка" }, themes: { "Вопросы об исполнителе": ["Рейтинг и показатели", "Ограничение доступа к сервису"] } },
  revision: 3,
};
function render(Page, route, park = "itaxi-krg") {
  const value = { state, park: state.parks.find(p => p.id === park), route: kit.parseRoute(route), go() {}, run: async () => ({ state, result: {} }), notify() {}, search() {} };
  return renderToStaticMarkup(React.createElement(kit.FleetContext.Provider, { value }, React.createElement(Page)));
}

test("routes live in one parameter and unknown ones fall back to the list", () => {
  assert.deepEqual(kit.parseRoute("driver/abc/car"), { page: "driver", id: "abc", tab: "car" });
  assert.deepEqual(kit.parseRoute("driver/abc"), { page: "driver", id: "abc", tab: "details" });
  assert.deepEqual(kit.parseRoute("driver"), { page: "contractors" });
  assert.deepEqual(kit.parseRoute("nowhere/1"), { page: "contractors" });
  assert.deepEqual(kit.parseRoute(null), { page: "contractors" });
  for (const path of ["contractors/abc", "driver/abc/gps", "order/65804916", "inventory", "antifraud/abc"]) assert.equal(kit.routePath(kit.parseRoute(path)), path);
  assert.equal(kit.routePath(kit.parseRoute("driver/abc/details")), "driver/abc");
  assert.equal(kit.railFor("driver"), "people"); assert.equal(kit.railFor("order"), "cars"); assert.equal(kit.railFor("support"), "help");
});

test("search finds a driver by licence, a dictated phone, the plate or the name — from three characters", () => {
  const d = state.drivers[0];
  for (const q of ["KA4829", "ka 482", "87014829154", "+7 701 482", "095nbs", "Жумабаев", "ерлан жумабаев"]) assert.ok(kit.matchesQuery(d, q), q);
  for (const q of ["KA", "99999999", "Иванов"]) assert.ok(!kit.matchesQuery(d, q), q);
});

test("money, phones, durations and dates look like the cabinet", () => {
  assert.equal(kit.money(20691.85).replace(/\s/g, " "), "20 691,85 ₸");
  assert.equal(kit.money(640.5, 0).replace(/\s/g, " "), "641 ₸");
  assert.equal(kit.phone("+77014829154"), "+7 701 482 9154");
  assert.equal(kit.duration(53), "53 с"); assert.equal(kit.duration(10090), "2 ч 48 мин"); assert.equal(kit.clock(53), "00:00:53");
  assert.equal(kit.shortDate("2026-09-29T16:33:00"), "29 сент., 16:33"); assert.equal(kit.dayDate("2020-01-02"), "02.01.2020");
  assert.equal(kit.countdown(119), "1:59"); assert.equal(kit.initials("iTaxi"), "IT"); assert.equal(kit.initials("Жумабаев Ерлан"), "ЖЕ");
  assert.match(kit.fleetLink(state.drivers[0], state.parks[0]), /contractors\/d1\/details\?park_id=a{32}/);
});

test("the statement of an order adds up to what reaches the balance", () => {
  const lines = kit.orderTransactions(order("1", "Эконом"));
  const total = lines.reduce((a, l) => a + l.amount, 0);
  assert.ok(lines.some(l => l.category === "Оплата картой") && lines.some(l => l.category === "Чаевые"));
  assert.ok(total > 0 && total < 1000);
  assert.deepEqual(kit.orderTransactions({ ...order("2", "Эконом"), price: 0 }), []);
  const ledger = kit.ledger(state.drivers[0]);
  assert.equal(ledger[0].balance, state.drivers[0].balance);
});

// The server owns the calls; every one of them needs a walk-through on its own park and driver.
const server = readFileSync(new URL("../../../../app/services/dispatch_data.py", import.meta.url), "utf8");
const callIds = [...server.matchAll(/"id": "(\w+)", "mission": "(\w+)"/g)].map(m => m[1]);
test("every tour step has a target, an action it waits for and a short explanation", () => {
  assert.deepEqual(callIds, ["provider", "gps", "car", "thermobox", "support", "limit_docs", "limit_duration", "limit_intercity"]);
  const tours = { fleet: kit.FLEET_TOUR, ...Object.fromEntries(callIds.map(id => [id, kit.callTour({ id, park: "itaxi-ast", driver: "d3" }, state.drivers[2], state.parks[1])])) };
  for (const [name, steps] of Object.entries(tours)) {
    assert.ok(steps.length >= 5, name);
    for (const step of steps) {
      assert.ok(step.target && step.title, `${name}: ${step.title}`);
      assert.ok(step.text.length > 20 && step.text.length < 200, `${name}: ${step.title} — ${step.text.length}`);
      // A step that waits for the operator must let him use the lit element.
      if (step.advanceWhen || step.waitClick) assert.ok(step.action, `${name}: ${step.title} waits but the lit element is locked`);
      assert.equal(step.autoClick, undefined, `${name}: ${step.title} — the operator presses every button himself`);
      for (const selector of [step.target, step.advanceWhen, step.skipWhen, step.when].filter(Boolean)) assert.doesNotThrow(() => selector.split(",").forEach(s => assert.ok(s.trim())), selector);
    }
  }
  assert.ok(tours.support.some(s => s.text.includes("ДД! Прошу проверить")));
  assert.ok(tours.support.some(s => s.target.includes("support-private")));
  assert.ok(tours.thermobox.some(s => s.text.includes("2 минуты")));
  assert.ok(tours.limit_duration.some(s => s.target.includes("order-tariff")));
  assert.ok(tours.provider[0].skipWhen.includes('data-park="itaxi-ast"'));
  assert.ok(tours.provider.some(s => s.target.includes('data-driver="d3"')));
  // The section menu closes only when the operator presses «Исполнители» in it.
  assert.ok(tours.fleet.find(s => s.target === "[data-coach=menu-contractors]").advanceWhen.includes('[data-menu=""]'));
  // The diagnostics panel is closed by the operator before the menu it would cover.
  const at = target => tours.support.findIndex(s => s.target.includes(target));
  assert.ok(at("diagnostics-panel] .fleet-close") > 0 && at("diagnostics-panel] .fleet-close") < at("rail-help"));
  assert.ok(tours.gps.at(-1).target.includes(".fleet-close"));
  // Choices wait for the right answer; Pulsar hands over the courier's code in his bubble.
  assert.ok(tours.provider.find(s => s.target === "[data-coach=provider]").advanceWhen.includes('"Sapar"'));
  assert.ok(tours.thermobox.find(s => s.target === "[data-coach=inventory-type]").advanceWhen.includes("eda"));
  assert.equal(tours.thermobox.find(s => s.target === "[data-coach=inventory-code]").slot, "courier-code");
  for (const name of ["provider", "car", "thermobox", "support"]) assert.ok(tours[name].at(-1).waitClick, `${name} ends when the operator saves`);
  assert.ok(tours.provider.find(s => s.title === "Нужный аккаунт").allow.includes("search-input"));
});

test("the list shows only the chosen park and the preview opens the account by name", () => {
  const html = render(kit.ContractorsPage, "contractors/d1");
  assert.match(html, /Жумабаев Ерлан Серикович/); assert.match(html, /Ким/); assert.doesNotMatch(html, /Абенов/);
  assert.match(html, /data-coach="preview"[^>]*data-driver="d1"/); assert.match(html, /data-coach="preview-name"/);
  assert.match(html, /<b>1<\/b> Предупреждения/); assert.match(html, /NO GPS/);
  assert.match(render(kit.ContractorsPage, "contractors", "itaxi-ast"), /Абенов/);
});

test("the account shows the summary, the limit link and every tab", () => {
  const details = render(kit.DriverPage, "driver/d1");
  assert.match(details, /Провайдер ЭДО/); assert.match(details, /data-coach="provider"/); assert.match(details, /Бумажный документооборот/);
  assert.match(details, /Диагностика/); assert.match(details, /Высокий приоритет, 42 балл/); assert.doesNotMatch(details, /data-coach="withdraw-limit"/);
  const car = render(kit.DriverPage, "driver/d1/car");
  assert.match(car, /data-coach="tariffs"/); assert.match(car, /Убрать тариф Комфорт/); assert.match(car, /data-coach="wrap-badge"[^>]*>✕</);
  const limited = render(kit.DriverPage, "driver/d3", "itaxi-ast");
  assert.match(limited, /data-coach="withdraw-limit"/); assert.match(limited, /700,00/);
  for (const [tab, text] of [["income", "Отчёт"], ["transactions", "Инициатор"], ["orders", "65804916"], ["bonuses", "41 из 70 заказов"], ["balance", "Изменение"], ["gps", "Общий пробег"], ["photo", "сент"]]) assert.match(render(kit.DriverPage, `driver/d3/${tab}`, "itaxi-ast"), new RegExp(text), tab);
  assert.match(render(kit.DriverPage, "driver/d3"), /нет такого исполнителя/);
  assert.match(render(kit.DriverPage, "driver/d4/car"), /нет автомобиля/);
});

test("inventory, support, antifraud and the order page render the training data", () => {
  const inventory = render(kit.InventoryPage, "inventory");
  assert.match(inventory, /Осталось на складе/); assert.match(inventory, />31</); assert.match(inventory, /Оспанова Дана/); assert.match(inventory, /data-coach="inventory-add"/);
  assert.match(renderToStaticMarkup(React.createElement(kit.Thermobox, { type: "eda", number: "EP0812" })), /Жёлтый термокороб Яндекс Еды, номер EP0812/);
  const support = render(kit.SupportPage, "support");
  assert.match(support, /Мои обращения/); assert.match(support, /Вопросы об исполнителе • Ограничение доступа к сервису/); assert.match(support, /В работе/);
  const antifraud = render(kit.AntifraudPage, "antifraud/d3", "itaxi-ast");
  assert.match(antifraud, /Продолжительность поездки/); assert.match(antifraud, /data-coach="antifraud-order"[^>]*>65804916</);
  const orderPage = render(kit.OrderPage, "order/65804916", "itaxi-ast");
  assert.match(orderPage, /data-coach="order-tariff"/); assert.match(orderPage, /Эконом/); assert.match(orderPage, /00:00:53/);
  for (const Page of [kit.HomePage, kit.GoalsPage, kit.ProfilePage, kit.MapPage, kit.RulesPage]) assert.ok(render(Page, "home").includes("fleet-head"));
  assert.match(render(kit.HomePage, "home"), /Проблемы 1/);
  assert.match(render(kit.RulesPage, "rules"), /По умолчанию/);
});
