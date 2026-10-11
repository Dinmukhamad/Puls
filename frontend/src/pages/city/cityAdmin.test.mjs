/**
 * «Управление городом» (/admin/learning/city) is built from the site's own pieces:
 * the page head, one segmented row of sections, cards, fields, tables with a phone
 * list, KPI tiles and the site's switch. These tests keep the old hand-made look
 * (rounded pill tabs, home-made grids and checkboxes) from coming back.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("./CityAdminPage.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false,
  plugins: [{ name: "test-context", setup(plugin) {
    plugin.onResolve({ filter: /\/AuthContext$/ }, () => ({ path: "test:auth", external: true }));
    plugin.onResolve({ filter: /\/Toast$/ }, () => ({ path: "test:toast", external: true }));
  } }],
});
const controls = await build({
  entryPoints: [fileURLToPath(new URL("./CityAdminControls.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  loader: { ".css": "empty" }, write: false,
});

const kinds = { missions: 20, quests: 5, orders: 3, appeals: 3, closed: 5 };
const member = (user_id, full_name, points) => ({ user_id, full_name, missions: 1, quests: 2, orders: 0, appeals: 0, closed: 0, points });
const fixtures = {
  "city-participants": { total: 1, size: 20, page: 1, items: [{ user_id: 7, full_name: "Анна Смирнова", login: "op07", level: 2, xp: 120, orders: 3, appeals: 1, completed: 1, total: 3, ready: 1, missions: [
    { key: "welcome", title: "Старт", state: "completed", current: 1, target: 1 },
    { key: "crm", title: "CRM", state: "ready", current: 2, target: 2 },
    { key: "fleet", title: "Автопарк", state: "locked", current: 0, target: 3 },
  ] }] },
  "city-groups": { points: kinds, items: [{ id: 1, name: "Группа 1 - дневная смена", total: 40, members: [member(7, "Анна Смирнова", 25), member(8, "Борис Ким", 15)], projects: [
    { key: "embankment", name: "Квартал «Набережный»", stage: "foundation", points: 40, cost: 150 },
    { key: "central", name: "Квартал «Центральный»", stage: "planned", points: 0, cost: 1200 },
  ] }] },
  "city-situations": { revision: 1, can_edit: true, answered: { phone: 4, rude: 1 }, exhausted: 2, items: [
    { id: "phone", speaker: "Водитель", text: "Водитель просит сменить номер телефона.", options: ["Только новый номер", "Старый и новый номера"], correct: 1, explanation: "Нужны оба номера.", enabled: true },
    { id: "late", speaker: "Клиент", text: "Клиент спрашивает, где машина.", options: ["Проверить заказ", "Отменить заказ"], correct: 0, explanation: "", enabled: false },
    { id: "rude", speaker: "Водитель", text: "Водитель повышает голос.", options: ["Выслушать", "Перебить", "Положить трубку"], correct: 0, explanation: "", enabled: true },
    { id: "own-x", speaker: "Диспетчер", text: "Диспетчер просит уточнить адрес.", options: ["Уточнить", "Отказать"], correct: 0, explanation: "", enabled: true },
  ] },
  "city-economy": { revision: 3, can_edit: true, quest_coins: 10, points: kinds,
    prices: { garden: 40, gazebo: 50, playground: 60, sports: 70, fountain: 90, cottage: 120, house: 200, tower: 350 },
    catalogue: [{ key: "garden", name: "Сквер", icon: "🌳" }, { key: "playground", name: "Детская площадка", icon: "🎠" }],
    projects: [{ key: "embankment", name: "Квартал «Набережный»", cost: 150 }, { key: "central", name: "Квартал «Центральный»", cost: 1200 }],
    land: [60, 45, 30], estate: { square: [40], house: [120, 180], carport: [300], officea: [900], park: [0, 120] }, district: { square: [120] }, hq: [1, 3] },
  "city-estates-report": { operators_without_district: 12, inventory: 0, legacy: { buildings: 0, operators: 0, paid: 0 }, coins: { buildings: 0, contributions: 0, refunded: 0 }, districts: [
    { id: "support-team-1", city: "support", name: "Район 1", construction: true, operators: 6, builders: 2, land: { plots: 1119, taken: 4, open_band: 1 }, buildings: 4, open_projects: 1, landmark_level: 1, hq_level: 1, built_projects: 0 },
    { id: "sales-team-1", city: "sales", name: "Район продаж", construction: false, operators: 0, builders: 0, land: null, buildings: 0, open_projects: 0, landmark_level: 1, hq_level: 1, built_projects: 0 },
  ] },
  "city-settings": { revision: 2, missions: {
    welcome: { title: "Твой город начинается здесь", description: "Познакомься с картой.", pulsar: "Начни путь.", target: 1, xp: 25, coins: 0, enabled: true, prerequisite: null },
    crm: { title: "Первое обращение", description: "Создай обращение в CRM.", pulsar: "Открой CRM.", target: 2, xp: 40, coins: 10, enabled: false, prerequisite: "welcome" },
  } },
  "city-world-settings": { revision: 4, can_edit: true, can_manage_heads: true, editable_city_ids: ["support", "sales"], heads: [{ id: 10, name: "Руководитель ТП" }],
    supervisors: [{ id: 20, name: "Анна", group_ids: [1], group_names: ["Смена А"], operator_count: 6 }], groups: [],
    cities: [
      { id: "support", name: "Техподдержка", head_id: 10, districts: [{ id: "support-team-1", name: "Первый район", supervisor_id: 20, group_ids: [1], construction: true }, { id: "support-team-2", name: "Второй район", supervisor_id: null, group_ids: [], construction: false }] },
      { id: "sales", name: "Отдел продаж", head_id: null, districts: [{ id: "sales-team-1", name: "Район продаж", supervisor_id: null, group_ids: [], construction: false }] },
    ] },
};

function load(code, role, tab) {
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "@tanstack/react-query") return {
      keepPreviousData: previous => previous,
      useQuery: ({ queryKey }) => ({ data: fixtures[queryKey[0]], isPending: !fixtures[queryKey[0]], isError: false, isPlaceholderData: false, refetch() {} }),
      useMutation: () => ({ isPending: false, isError: false, error: null, mutate() {}, reset() {} }),
      useQueryClient: () => ({ setQueryData() {}, invalidateQueries: async () => {}, cancelQueries: async () => {} }),
    };
    if (name === "react-router-dom") return {
      useSearchParams: () => [new URLSearchParams(tab ? `tab=${tab}` : ""), () => {}],
      Link: ({ to, className, children }) => React.createElement("a", { href: to, className }, children),
    };
    if (name === "test:auth") return { useAuth: () => ({ user: { role } }) };
    if (name === "test:toast") return { useToast: () => ({ success() {}, error() {}, info() {} }) };
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const page = (tab, role = "admin") => renderToStaticMarkup(React.createElement(load(bundle.outputFiles[0].text, role, tab).CityAdminPage));
const { FormStatus, Switch } = load(controls.outputFiles[0].text, "admin");

test("the page uses the site's head and one segmented row of sections that follows the address", () => {
  const html = page("economy");
  assert.match(html, /<div class="page-head"><div><h1 class="page-title">Управление городом<\/h1><p class="page-subtitle">/);
  assert.match(html, /<div class="page-head__actions"><a href="\/training\/city" class="btn btn--secondary btn--m">Открыть город<\/a><\/div>/);
  assert.match(html, /<div class="city-admin-tabs"><div class="segmented" role="radiogroup" aria-label="Разделы управления городом">/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 7);
  assert.match(html, /<button type="button" role="radio" aria-checked="true" tabindex="0" class="segmented__item is-active">Экономика игры<\/button>/);
  assert.doesNotMatch(html, /city-page|city-heading|city-eyebrow|aria-pressed|city-action|city-secondary/);
  // Without a section in the address a head starts on the cities, a supervisor on the operators.
  assert.match(page(null, "head"), /aria-checked="true"[^>]*>Города и районы</);
  assert.match(page(null, "supervisor"), /aria-checked="true"[^>]*>Прогресс операторов</);
});

test("cities and districts are cards with the site's selects and switches", () => {
  const html = page("world");
  assert.match(html, /<section class="card card--standard city-world-editor__city" aria-labelledby="world-city-support"><header class="card__head">/);
  assert.match(html, /<span class="badge badge--success">Доступно управление<\/span>/);
  assert.match(html, /role="combobox"[^>]*aria-label="Супервайзер района"/);
  assert.match(html, /class="city-admin-switch"><input type="checkbox" role="switch" checked=""\/>/);
  assert.match(html, /<span class="badge badge--neutral">Свободен<\/span>/);
  // The districts of a city share one row: as many columns as districts.
  assert.match(html, /<div class="city-world-editor__districts" style="--districts:2">/);
  assert.match(html, /<div class="city-world-editor__districts" style="--districts:1">/);
  assert.doesNotMatch(html, /<select class="input"|city-group-card|city-admin-warning|class="row city-world-editor__construction"/);
});

test("district construction is a table on a wide screen and a list of cards on a phone", () => {
  const html = page("estates");
  assert.match(html, /<div class="table-wrap table-wrap--responsive city-admin-table"><table class="table">/);
  assert.match(html, /<td><strong>Район 1<\/strong><span class="city-admin-muted"> · Техподдержка<\/span><\/td><td><span class="badge badge--success">Открыта<\/span><\/td>/);
  assert.match(html, /<span class="badge badge--neutral">Нет земли<\/span>/);
  assert.match(html, /<ul class="card-list"><li class="list-card">/);
  assert.equal((html.match(/class="kpi kpi--/g) ?? []).length, 4);
});

test("operators get a search, a legend and a mission scale in rows of one list", () => {
  const html = page("participants");
  assert.match(html, /<ul class="city-admin-legend" aria-label="Обозначения шкалы миссий">/);
  assert.match(html, /<li class="city-admin-person"><div class="city-admin-person__who"><strong>Анна Смирнова<\/strong>/);
  assert.match(html, /<span data-state="completed" title="Старт: Пройдено"><\/span><span data-state="ready" title="CRM: Можно завершить"><\/span><span data-state="locked"/);
  assert.match(html, /<a href="\/training\/city\?operator=7" class="btn btn--secondary btn--s">Открыть путь<\/a>/);
});

test("group cities show quarters with their stage above the name and members in a table or a phone list", () => {
  const html = page("groups");
  assert.match(html, /<div class="card__body city-admin-quarters-body"><ol class="city-admin-quarters">/);
  assert.match(html, /<li><span class="badge badge--neutral">Запланирован<\/span><strong class="city-admin-quarters__name">Квартал «Центральный»<\/strong><div class="progress/);
  assert.match(html, /<li><span class="badge badge--accent">Фундамент<\/span><strong class="city-admin-quarters__name">Квартал «Набережный»<\/strong><div [^>]*><div [^>]*><\/div><\/div><span class="city-admin-quarters__count">40 \/ 150 очков<\/span><\/li>/);
  assert.match(html, /<div class="table-wrap table-wrap--responsive city-admin-table"><table class="table"><thead><tr><th>Оператор<\/th>/);
  assert.match(html, /<div class="card__body city-admin-members"><h3 class="city-admin-subtitle">Операторы группы<\/h3><ul class="card-list">/);
  assert.match(html, /<strong class="nowrap">25 очков<\/strong>/);
});

test("daily situations are a list; a new one is created in a dialog from the card's button", () => {
  const html = page("situations");
  assert.match(html, /<div class="card__action"><button type="button" class="btn btn--primary btn--m">\+ Новая ситуация<\/button><\/div>/);
  assert.match(html, /<p class="card__subtitle">Включено 3 из 4 · в день — до 3<\/p>/);
  assert.match(html, /<p class="ui-note city-admin-alert" role="status">У 2 операторов не осталось новых ситуаций\./);
  assert.match(html, /<ol class="city-admin-situations"><li><span class="city-admin-situations__icon" aria-hidden="true">🚕<\/span>/);
  assert.match(html, /<span class="city-admin-situations__facts">2 варианта ответа · прошли 4 оператора<\/span>/);
  assert.match(html, /<span class="city-admin-situations__facts">3 варианта ответа · прошли 1 оператор<\/span>/);
  assert.match(html, /<li class="is-off"><span class="city-admin-situations__icon" aria-hidden="true">📞<\/span>.*<span class="badge badge--neutral">Выключена<\/span>.*ещё никто не проходил/s);
  assert.match(html, /<span class="city-admin-situations__icon" aria-hidden="true">💡<\/span>/);
  // Three are on — as many as a day needs: they can be neither switched off nor deleted, the fourth can be switched on.
  const rows = html.match(/<li[^>]*>.*?<\/li>/gs);
  assert.equal(rows.length, 4);
  assert.match(rows[0], /<input type="checkbox" disabled="" role="switch" checked=""\/>/);
  assert.match(rows[0], /aria-label="Удалить ситуацию 1" disabled="">Удалить<\/button>/);
  assert.match(rows[1], /<input type="checkbox" role="switch"\/>/);
  assert.doesNotMatch(rows[1], /aria-label="Удалить ситуацию 2" disabled=""/);
  assert.match(html, /Включено 3 — столько выдаётся в день\. Чтобы выключить или удалить ситуацию, сначала добавьте или включите другую\./);
  assert.doesNotMatch(html, /city-admin-picker|Сохранить все ситуации/);
  // A supervisor reads the set (the server says so with can_edit): the situations open, nothing changes.
  const editable = fixtures["city-situations"];
  fixtures["city-situations"] = { ...editable, can_edit: false };
  const read = page("situations", "supervisor");
  fixtures["city-situations"] = editable;
  assert.doesNotMatch(read, /Новая ситуация|role="switch"|>Удалить</);
  assert.equal((read.match(/>Открыть<\/button>/g) ?? []).length, 4);
});

test("the economy lines its numbers up in grids, and ready buildings are named once under their section", () => {
  const html = page("economy");
  assert.match(html, /<fieldset class="city-admin-fieldset city-admin-fieldset--sections">/);
  assert.match(html, /<span aria-hidden="true">🎠<\/span>Детская площадка/);
  assert.match(html, /<h3 class="city-admin-subtitle">Готовые дома<\/h3><div class="city-admin-grid"><label class="field"><span class="field__label">🏠 Коттедж с навесом<\/span>/);
  assert.match(html, /<h3 class="city-admin-subtitle">Офисные здания<\/h3>/);
  assert.doesNotMatch(html, /готовый дом|офисное здание/);
  assert.match(html, /🌲 Парк · сбор из скверов \(0 — бесплатно\)/);
  assert.match(html, /<li><span class="city-admin-quarter-list__number" aria-hidden="true">2<\/span>/);
});

test("missions: a narrow chooser, the mission's card with its state, the site's switch", () => {
  const html = page("settings");
  assert.match(html, /<label class="field city-admin-field-narrow"><span class="field__label">Выберите миссию<\/span>/);
  assert.match(html, /<h2 class="card__title">Твой город начинается здесь<\/h2><\/div><div class="card__action"><span class="badge badge--success">Доступна<\/span>/);
  assert.match(html, /<div class="city-admin-grid city-admin-grid--three">/);
  assert.match(html, /Миссия доступна операторам/);
});

test("a save reports an error first, then the confirmation, then a hint", () => {
  const status = props => renderToStaticMarkup(React.createElement(FormStatus, props));
  assert.equal(status({ error: new Error("Нет связи"), saved: "Сохранено.", note: "Есть изменения." }), '<p class="city-admin-status city-admin-status--error" role="alert">Не удалось сохранить: Нет связи</p>');
  assert.equal(status({ error: false, saved: "Сохранено.", note: "Есть изменения." }), '<p class="city-admin-status city-admin-status--ok" role="status">Сохранено.</p>');
  assert.equal(status({ saved: false, note: "Есть изменения." }), '<p class="city-admin-status">Есть изменения.</p>');
  assert.equal(status({ saved: false, note: false }), "");
  const off = renderToStaticMarkup(React.createElement(Switch, { checked: false, disabled: true, onChange() {}, hint: "Нет земли" }, "Стройка открыта"));
  assert.equal(off, '<label class="city-admin-switch"><input type="checkbox" disabled="" role="switch"/><span class="city-admin-switch__track" aria-hidden="true"><span></span></span><span class="city-admin-switch__text"><span>Стройка открыта</span><small>Нет земли</small></span></label>');
});
