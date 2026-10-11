/**
 * Витрина магазина бонусов.
 *
 * Каталог был плоской сеткой из девяти карточек: у каждой сверху одинаковая
 * иконка-заглушка на сто двадцать пикселей, ни поиска, ни порядка, а
 * недоступное выглядело ровно как доступное — чтобы понять, что можно взять
 * прямо сейчас, приходилось перечитывать каждую карточку.
 *
 * Теперь товары делятся на три группы и сортируются. Категорий сервер не
 * отдаёт, поэтому деление построено на настоящих полях: can_buy и
 * missing_coins.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("./ShopPage.tsx", import.meta.url), "utf8");
// Берём только чистые функции, лежащие до компонента: он тянет React.
const head = source.slice(0, source.indexOf("export function ShopPage"));
const built = await transform(head.replace(/^import[\s\S]*?;$/gm, ""), { loader: "tsx", format: "esm" });
const { shopGroup, filterShop, SHOP_SORTS } = await import(
  `data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`
);

const item = (over) => ({
  id: 1, code: "x", title: "Бонус", description: "", price: 100,
  is_active: true, stock_limit: null, per_user_monthly_limit: null,
  requires_approval: false, sort_order: 0,
  can_buy: false, missing_coins: 0, blocked_reason: null,
  ...over,
});

const BASE = { search: "", sort: "cheap", onlyReady: false };
const titles = (rows) => rows.map((r) => r.title);

/* ── Группировка ───────────────────────────────────────────── */

test("доступное к покупке отделено от остального", () => {
  assert.equal(shopGroup(item({ can_buy: true })), "ready");
});

test("нехватка коинов — это «копим», а не «недоступно»", () => {
  // Ловушка, на которой легко ошибиться: при нехватке коинов сервер сам
  // кладёт в blocked_reason строку «Нужно ещё N коинов». Если судить по
  // этому полю, всё копящееся уедет в «недоступно» вместе с тем, что
  // закрыто по-настоящему, и смысл деления пропадёт.
  const saving = item({ can_buy: false, missing_coins: 51, blocked_reason: "Нужно ещё 51 коинов" });
  assert.equal(shopGroup(saving), "saving");
});

test("недоступно — это когда коинов хватает, а взять нельзя", () => {
  // Кончился запас или выбран месячный лимит: копить тут бессмысленно.
  const blocked = item({ can_buy: false, missing_coins: 0, blocked_reason: "Закончился запас" });
  assert.equal(shopGroup(blocked), "blocked");
});

/* ── Поиск ─────────────────────────────────────────────────── */

const CATALOG = [
  item({ id: 1, title: "Сертификат на кофе", description: "Подарочная карта в кофейню", price: 120, can_buy: true }),
  item({ id: 2, title: "Мерч компании", description: "Кружка, худи, блокнот", price: 200, missing_coins: 71, blocked_reason: "Нужно ещё 71 коинов" }),
  item({ id: 3, title: "Корпоративная пицца", description: "Пицца для вас и двух коллег", price: 180, missing_coins: 51, blocked_reason: "Нужно ещё 51 коинов" }),
  item({ id: 4, title: "Статус «Звезда недели»", description: "Бейдж в общем чате", price: 30, can_buy: true }),
  item({ id: 5, title: "Ранний доступ", description: "Выбор смены раньше других", price: 80, missing_coins: 0, blocked_reason: "Закончился запас" }),
];

test("поиск идёт и по описанию, а не только по названию", () => {
  // Название не всегда содержит то слово, которое человек помнит.
  const rows = filterShop(CATALOG, { ...BASE, search: "худи" });
  assert.deepEqual(titles(rows), ["Мерч компании"]);
});

test("поиск не зависит от регистра и пробелов", () => {
  assert.deepEqual(titles(filterShop(CATALOG, { ...BASE, search: "  ПИЦЦА " })), ["Корпоративная пицца"]);
});

test("товар без описания не роняет поиск", () => {
  const rows = filterShop([item({ title: "Без описания", description: null })], { ...BASE, search: "опис" });
  assert.deepEqual(titles(rows), ["Без описания"]);
});

/* ── Порядок ───────────────────────────────────────────────── */

test("по умолчанию — от дешёвого к дорогому, при равной цене — порядок с сервера", () => {
  // Группы «можно купить» и «копим» раскладывает витрина, а не сортировка:
  // повторять их пунктами «сначала доступные» и «ближе всего» не нужно.
  assert.deepEqual(filterShop(CATALOG, BASE).map((r) => r.price), [30, 80, 120, 180, 200]);
  const twins = [item({ id: 7, title: "Второй", price: 50, sort_order: 2 }), item({ id: 8, title: "Первый", price: 50, sort_order: 1 })];
  assert.deepEqual(titles(filterShop(twins, BASE)), ["Первый", "Второй"]);
});

test("«сначала дорогие» разворачивает порядок по цене", () => {
  assert.deepEqual(filterShop(CATALOG, { ...BASE, sort: "expensive" }).map((r) => r.price), [200, 180, 120, 80, 30]);
});

test("порядок выбирается списком в стиле сайта, и в нём нет пунктов-повторов", () => {
  assert.doesNotMatch(source, /<select|<option/);
  assert.match(source, /<Select aria-label="Порядок бонусов" value=\{sort\} options=\{SHOP_SORTS\}/);
  assert.deepEqual(SHOP_SORTS.map((option) => option.label), ["Сначала дешёвые", "Сначала дорогие"]);
});

test("фильтр «только доступные» убирает всё остальное", () => {
  const rows = filterShop(CATALOG, { ...BASE, onlyReady: true });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.can_buy));
});

test("исходный каталог не переупорядочивается", () => {
  // sort мутирует массив на месте; отдать ему данные запроса — значит
  // испортить порядок в кеше при каждом выборе в списке.
  const before = CATALOG.map((r) => r.id);
  filterShop(CATALOG, { ...BASE, sort: "expensive" });
  assert.deepEqual(CATALOG.map((r) => r.id), before);
});
