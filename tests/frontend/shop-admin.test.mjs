/**
 * Регрессии магазина для штата.
 *
 * Что ломалось до переработки:
 *  · администратору показывалась та же сетка карточек, что и оператору, но с
 *    кнопкой «Изменить» на каждой: на 33 бонусах это 33 одинаковые кнопки без
 *    поиска, фильтров и сортировки;
 *  · остаток «без ограничения» (stock_remaining = null) отображался и
 *    сортировался как ноль, то есть «закончился»;
 *  · на телефоне таблица упиралась в жёсткий min-width из слоя вьюх и её
 *    правый край обрезался, потому что body прячет горизонтальный скролл.
 *
 * Карточки оператора и правила списания коинов здесь не участвуют:
 * экран только читает каталог и открывает форму редактирования.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const view = await readFile(
  new URL('js/src/views/rating/20-rating-shop-summary.view.js', root), 'utf8');
const states = await readFile(new URL('css/src/components/20-states.css', root), 'utf8');
const polish = await readFile(new URL('css/src/views/90-visual-polish.css', root), 'utf8');

test('штат получает управляемый каталог, оператор — прежние карточки', () => {
  assert.match(view, /function renderStaffShop/, 'нет каталога для штата');
  assert.match(view, /function renderOperatorShop/, 'потеряны карточки оператора');
  assert.match(view, /class="data-table shop-admin-table"/, 'каталог не таблица');
});

test('в каталоге есть поиск, четыре фильтра и сортировка по пяти колонкам', () => {
  for (const id of ['shop-admin-search', 'shop-admin-category', 'shop-admin-status', 'shop-admin-stock']) {
    assert.ok(view.includes(`id="${id}"`), `нет органа управления ${id}`);
  }
  const keys = Object.keys({
    title: 1, category: 1, price: 1, stock: 1, status: 1,
  });
  for (const key of keys) {
    assert.ok(view.includes(`shopAdminTh('${key}'`), `колонка ${key} не сортируется`);
  }
  assert.match(view, /aria-sort="\$\{ariaSort\}"/, 'состояние сортировки не объявлено');
  assert.match(view, /<button type="button" class="shop-admin-sort"/,
    'сортировка не на кнопке — недоступна с клавиатуры');
});

test('остаток «без ограничения» не считается нулём', () => {
  const value = view.match(/function shopStockValue[\s\S]*?\n\}/)[0];
  assert.match(value, /stock_remaining == null \? Infinity/,
    'отсутствие лимита подменяется нулём');
  const label = view.match(/function shopStockLabel[\s\S]*?\n\}/)[0];
  assert.match(label, /Без лимита/, 'отсутствие лимита не подписано');
  // Фильтр «Закончился» не должен захватывать бонусы без ограничения.
  const filtered = view.match(/function shopAdminFiltered[\s\S]*?\n\}/)[0];
  assert.match(filtered, /shopStockValue\(item\) <= 0/, 'фильтр наличия считает по сырому полю');
});

test('пустой результат отличается от пустого каталога', () => {
  assert.match(view, /shopAdminHasFilters\(\)\s*\n?\s*\?\s*uiNoResultsState/,
    'под фильтрами показывается «каталог пуст» вместо «ничего не найдено»');
  assert.match(view, /uiEmptyState\('Каталог пуст'/, 'нет состояния пустого каталога');
});

test('на телефоне таблица превращается в карточки и не обрезается', () => {
  assert.match(view, /class="data-table shop-admin-table" data-mobile="cards"/,
    'таблица не помечена как карточная');
  assert.match(states, /@media \(max-width: 640px\)[\s\S]*?\.shop-admin-table/,
    'нет мобильного преобразования каталога');
  assert.match(states, /content: attr\(data-label\)/, 'у полей карточки нет подписей');
  // Жёсткий min-width из слоя вьюх обязан обходить карточные таблицы: иначе
  // строка распирает карточку шире экрана, а body прячет скролл.
  const hard = polish.match(/min-width: (720|760|680)px/g) || [];
  assert.ok(hard.length > 0, 'правила min-width исчезли — проверка потеряла смысл');
  for (const m of polish.matchAll(/([^\n{}]*\.data-table[^\n{}]*)\{[^}]*min-width:\s*\d+px/g)) {
    assert.match(m[1], /:not\(\[data-mobile="cards"\]\)/,
      `правило «${m[1].trim()}» распирает карточные таблицы`);
  }
});

test('каждая ячейка каталога подписана для карточного вида', () => {
  const rows = view.match(/rows\.length \? rows\.map\(item => `[\s\S]*?`\)\.join\(''\)/)[0];
  const tds = (rows.match(/<td/g) || []).length;
  const labels = (rows.match(/data-label="/g) || []).length;
  assert.equal(labels, tds, `ячеек ${tds}, а подписей ${labels}`);
});
