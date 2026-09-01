/**
 * Общие примитивы (ТЗ, «App shell и общие компоненты») и сценарий
 * запрещённого маршрута.
 *
 * Примитивы не разбираются регулярками, а выполняются: функции вынимаются
 * из исходника и вызываются с настоящими аргументами. Так проверяется
 * результат, а не то, что кто-то написал нужное слово в комментарии.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const primitives = await readFile(new URL('js/src/components/20-primitives.js', root), 'utf8');
const shell = await readFile(new URL('js/src/app/00-core-shell.js', root), 'utf8');
const css = await readFile(new URL('css/src/components/60-primitives.css', root), 'utf8');

// esc и пустое состояние нужны примитивам — подставляем простые заглушки.
const ui = new Function(`
  function esc(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function uiEmptyState(title, text) { return '<div class="state-block state-empty"><b>' + esc(title) + '</b><p>' + esc(text) + '</p></div>'; }
  ${primitives}
  return { uiCard, uiKpi, uiKpiDelta, uiTable, uiPagination, uiChartShell };
`)();

test('карточка отдаёт заголовок, подпись и действия', () => {
  const html = ui.uiCard({ title: 'Группы', subtitle: 'Сначала с риском', actions: '<button>Ещё</button>', body: '<p>тело</p>' });
  assert.match(html, /<h2 class="ui-card-title">Группы<\/h2>/);
  assert.match(html, /Сначала с риском/);
  assert.match(html, /<button>Ещё<\/button>/);
  assert.match(html, /<p>тело<\/p>/);
});

test('KPI не выдумывает отсутствующее значение', () => {
  const withValue = ui.uiKpi({ label: 'Качество', value: 93.3, unit: '%', target: 85, sample: 8 });
  assert.match(withValue, /93\.3%/);
  assert.match(withValue, /Цель: 85%/);
  assert.match(withValue, /выборка: 8/);

  const withoutValue = ui.uiKpi({ label: 'Качество', value: null });
  assert.match(withoutValue, /нет данных/, 'пустое значение должно называться, а не рисоваться нулём');
  assert.doesNotMatch(withoutValue, /Цель:/, 'цели нет — подпись не выдумываем');
});

test('изменение к прошлому периоду различает рост, падение и отсутствие сравнения', () => {
  assert.match(ui.uiKpiDelta(0.6), /is-up/);
  assert.match(ui.uiKpiDelta(-9.7), /is-down/);
  assert.match(ui.uiKpiDelta(0), /is-flat/);
  assert.match(ui.uiKpiDelta(null), /Нет сравнения/);
  // У штрафов «меньше — лучше»: минус должен считаться улучшением.
  assert.match(ui.uiKpiDelta(-3.2, { lowerIsBetter: true }), /is-up/);
});

test('таблица размечена по канону: scope, aria-sort и подписи ячеек', () => {
  const html = ui.uiTable({
    columns: [
      { key: 'name', label: 'Пользователь', sortable: true },
      { key: 'score', label: 'Баллы', sortable: true, numeric: true },
      { key: 'act', label: 'Действия', actions: true },
    ],
    rows: [{ id: 1, cells: ['<b>Иванов</b>', '315', '<button>…</button>'] }],
    sort: { key: 'name', dir: 'asc' },
    caption: 'Операторы',
  });
  assert.equal((html.match(/scope="col"/g) || []).length, 3, 'не у всех заголовков есть scope');
  assert.match(html, /aria-sort="ascending"/, 'активная сортировка не объявлена');
  assert.equal((html.match(/aria-sort="none"/g) || []).length, 2);
  assert.match(html, /data-label="Пользователь"/, 'ячейка без подписи не станет карточкой на телефоне');
  assert.doesNotMatch(html, /data-label="Действия"/, 'колонке действий подпись не нужна');
  assert.match(html, /class="data-table ui-table"/, 'нет общего класса таблицы');
  assert.match(html, /<caption class="sr-only">Операторы<\/caption>/);
});

test('пагинация показывает диапазон, общее число и размер страницы', () => {
  const html = ui.uiPagination({ page: 1, perPage: 10, total: 60 });
  assert.match(html, /Показано 1–10 из 60/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /data-ui-perpage/);
  for (const size of [10, 25, 50, 100]) {
    assert.match(html, new RegExp(`value="${size}"`), `нет размера страницы ${size}`);
  }
  // На последней странице «вперёд» недоступна, на первой — «назад».
  assert.match(ui.uiPagination({ page: 1, perPage: 10, total: 60 }), /data-ui-page="0"\s+disabled/);
  assert.match(ui.uiPagination({ page: 6, perPage: 10, total: 60 }), /data-ui-page="7"\s+disabled/);
});

test('пустая выборка не притворяется первой страницей', () => {
  const html = ui.uiPagination({ page: 1, perPage: 10, total: 0 });
  assert.match(html, /Показано 0–0 из 0/);
});

test('у графика есть текстовая альтернатива, а без данных — честное пустое состояние', () => {
  const withData = ui.uiChartShell({
    title: 'Динамика', unit: '%', chart: '<svg></svg>',
    columns: ['Дата', 'Значение'], rows: [['22 мая', 91.2], ['23 мая', 92.4]],
  });
  assert.match(withData, /Данные графика таблицей/, 'нет текстовой альтернативы');
  assert.match(withData, /<th scope="col">Дата<\/th>/);
  assert.match(withData, /91\.2/);

  const empty = ui.uiChartShell({ title: 'Динамика', chart: '' });
  assert.match(empty, /Недостаточно данных/, 'без точек нужно пустое состояние, а не пустая рамка');
  assert.doesNotMatch(empty, /<svg/, 'график не должен рисоваться из ничего');
});

test('липкая шапка и карточный режим описаны в стилях', () => {
  assert.match(css, /\.ui-table thead th\s*\{[^}]*position:\s*sticky/, 'шапка таблицы не липкая');
  assert.match(css, /@media \(max-width: 767px\)/, 'нет мобильной раскладки таблицы');
  assert.match(css, /data-mobile="cards"\]\s*\.ui-row\s*>\s*td\[data-label\]::before/,
    'на телефоне ячейки не получают подписи');
});

/* ── Запрещённый маршрут ─────────────────────────────────── */

test('запрещённый маршрут не подменяется молча', () => {
  assert.match(shell, /const forbidden = Boolean\(role\) && !allowedViewsForRole\(role\)\.includes\(target\)/,
    'resolveRoute снова подменяет запрещённый маршрут вместо флага');
  assert.match(shell, /return \{ view: target, tab: nextTab, forbidden \};/,
    'флаг запрета не возвращается');
});

test('на запрещённом маршруте не выполняются запросы данных', () => {
  const nav = shell.slice(shell.indexOf('function navigateTo('));
  const guard = nav.indexOf('if (forbidden)');
  const render = nav.indexOf('renderView(target);');
  assert.ok(guard !== -1, 'нет ветки отказа в navigateTo');
  assert.ok(guard < render, 'отказ проверяется после отрисовки — запросы уже уйдут');
  assert.match(nav.slice(guard, render), /renderForbiddenView\(target\);\s*return;/,
    'после отказа выполнение не прервано');
});

test('отказ показывает состояние с кнопкой возврата', () => {
  assert.match(shell, /function renderForbiddenView\(/);
  assert.match(shell, /uiForbiddenState\(\s*'Раздел недоступен'/, 'заголовок отказа изменён');
  assert.match(shell, /\{ id: 'back', label: 'Вернуться' \}/, 'нет кнопки возврата');
  assert.match(shell, /uiBindStateActions\(el, \{ back: goBackSafely \}\)/, 'кнопка не привязана');
});

test('возврат без безопасной истории ведёт на стартовый экран роли', () => {
  const fn = shell.slice(shell.indexOf('function goBackSafely('));
  assert.match(fn, /window\.history\.length > 1 && document\.referrer/,
    'история не проверяется — прямая ссылка уведёт с сайта');
  assert.match(fn, /navigateTo\(fallbackViewForRole\(STATE\.user\?\.role\)\)/,
    'без истории нет запасного перехода');
});
