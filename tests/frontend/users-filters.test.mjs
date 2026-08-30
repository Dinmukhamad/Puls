/**
 * Регрессии панели фильтров в разделе «Пользователи».
 *
 * Что ломалось до переработки:
 *  · раскрытие «Ещё фильтры» строилось на <details>/<summary>: у элемента нет
 *    aria-expanded и aria-controls, поэтому скринридер не сообщал, раскрыта
 *    панель или нет и чем она управляет;
 *  · выбранные роль, группа, статус и уровень не попадали в список применённых
 *    фильтров и не считались на кнопке — панель сворачивалась, и было не видно,
 *    что список отфильтрован;
 *  · каждое нажатие клавиши в поиске перерисовывало всю таблицу целиком;
 *  · select-ы стояли без подписей.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const view = await readFile(
  new URL('js/src/views/coins/30-admin-coins-groups-operators.view.js', root), 'utf8');
const css = await readFile(new URL('css/src/components/20-states.css', root), 'utf8');

test('раскрытие «Ещё фильтры» — настоящая кнопка с объявленным состоянием', () => {
  assert.match(view, /<button[^>]*data-more-filters/, 'кнопка раскрытия не найдена');
  assert.match(view, /aria-expanded="\$\{moreFiltersOpen \? 'true' : 'false'\}"/,
    'состояние раскрытия не объявляется через aria-expanded');
  assert.match(view, /aria-controls="ops-more-filters"/, 'кнопка не связана с панелью');
  assert.match(view, /id="ops-more-filters"[^>]*role="group"/, 'панель не помечена как группа полей');
  // <summary> для этого блока больше не используется: у него нет нужных состояний.
  assert.doesNotMatch(view, /<summary[^>]*>\s*Ещё фильтры/, 'вернулся <summary> вместо кнопки');
});

test('каждый select фильтров имеет видимую подпись', () => {
  const bar = view.match(/<div class="ui-more-filters__grid">[\s\S]*?<\/div>\s*<\/div>/)[0];
  const selects = bar.match(/<select /g) || [];
  const labels = bar.match(/<label class="ui-filter-field">\s*<span>/g) || [];
  assert.equal(labels.length, selects.length,
    `подписей ${labels.length}, а select-ов ${selects.length}`);
  assert.ok(selects.length >= 4, 'ожидались фильтры роли, группы, статуса и уровня');
});

test('смена любого фильтра обновляет чипы и счётчик, а не только таблицу', () => {
  assert.match(view, /function applyFilterChange\(\)/, 'нет общего обработчика смены фильтра');
  const handler = view.match(/function applyFilterChange\(\)[\s\S]*?\n {4}\}/)[0];
  assert.match(handler, /ops-filter-chips/, 'чипы применённых фильтров не обновляются');
  assert.match(handler, /ui-more-filters__count/, 'счётчик на кнопке не обновляется');
  assert.match(handler, /ops-count-info/, 'счётчик найденного не обновляется');
  // Все четыре select-а обязаны идти через общий обработчик. Ищем по подстроке:
  // так тест не зависит от точного форматирования привязки.
  for (const id of ['ops-role', 'ops-group', 'ops-status', 'ops-level']) {
    const at = view.indexOf(`#${id}'`);
    assert.notEqual(at, -1, `фильтр ${id} не найден в привязках`);
    const tail = view.slice(at, at + 260);
    assert.ok(tail.includes("addEventListener('change'"), `фильтр ${id} не привязан`);
    assert.ok(tail.includes('applyFilterChange()'), `фильтр ${id} обновляет не всё`);
  }
});

test('поиск ждёт паузу в наборе, а не перерисовывает таблицу на каждый символ', () => {
  const block = view.match(/const searchInput = el\.querySelector\('#ops-search'\)[\s\S]*?\n {4}\}/)[0];
  assert.match(block, /clearTimeout\(searchTimer\)/, 'предыдущий отложенный вызов не отменяется');
  assert.match(block, /setTimeout\(applySearch, \d+\)/, 'перерисовка не отложена');
  assert.match(block, /event\.key !== 'Enter'/, 'Enter не применяет поиск сразу');
});

test('панель фильтров стилизована и скрывается через hidden, а не через display в JS', () => {
  assert.match(css, /\.ui-more-filters__panel/, 'нет стилей панели фильтров');
  assert.match(css, /\.ui-more-filters__count/, 'нет стилей счётчика активных фильтров');
  assert.match(view, /morePanel\.hidden = !moreFiltersOpen/, 'панель скрывается не через hidden');
});
