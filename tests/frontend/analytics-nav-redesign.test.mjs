import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const view = await readFile(
  new URL('../../js/src/views/reports/40-reports-analytics.view.js', import.meta.url),
  'utf8',
);
const css = await readFile(
  new URL('../../css/src/views/99-analytics-management-dashboard.css', import.meta.url),
  'utf8',
);

test('forbidden terms from ТЗ AC-02 are gone from the interface text', () => {
  assert.doesNotMatch(view, /Здоровье команды/);
  assert.doesNotMatch(view, /['"]Наблюдать['"]/);
  assert.doesNotMatch(view, /Heatmap качества/);
});

test('tabs are renamed per ТЗ §1.1', () => {
  assert.match(view, /label:\s*'Сводка'/);
  assert.match(view, /label:\s*'Связь показателей'/);
  assert.match(view, /label:\s*'Контроль качества'/);
  assert.match(view, /label:\s*'По дням'/);
  assert.match(view, /label:\s*'Расчёт баллов'/);
  assert.match(view, /label:\s*'Выгрузка'/);
});

test('navigation has 6 primary tabs and 4 tabs under Ещё (ТЗ §1.2)', () => {
  const matches = [...view.matchAll(/\{ key: '(\w+)',\s*label: '[^']+',\s*group: '(primary|more)' \}/g)];
  assert.equal(matches.length, 10, 'должно быть 10 определений вкладок с группой');
  const primary = matches.filter(m => m[2] === 'primary');
  const more = matches.filter(m => m[2] === 'more');
  assert.equal(primary.length, 6);
  assert.equal(more.length, 4);
});

test('desktop nav has no horizontal scroll and a Ещё dropdown; mobile has one select', () => {
  assert.match(view, /an-nav-more-btn/);
  assert.match(view, /an-nav-more-menu/);
  assert.match(view, /an-nav-mobile-select/);
  assert.doesNotMatch(css, /\.an-nav-primary\s*\{[^}]*overflow-x/);
  assert.match(css, /@media \(max-width: 767px\)/);
});

test('a single canonical status-label mapping is used everywhere (ТЗ §1.3)', () => {
  const map = view.match(/const RISK_STATUS_LABELS = \{[^}]+\}/);
  assert.ok(map, 'RISK_STATUS_LABELS должен существовать');
  assert.match(map[0], /stable:\s*'Цель выполнена'/);
  assert.match(map[0], /watch:\s*'Есть отклонение'/);
  assert.match(map[0], /critical:\s*'Нужно вмешательство'/);
  assert.match(map[0], /no_data:\s*'Недостаточно данных'/);
  // не осталось конкурирующих литеральных карт статусов
  assert.doesNotMatch(view, /stable:\s*'Стабильно'/);
  assert.doesNotMatch(view, /watch:\s*'Контроль'/);
});

test('context bar renders scope, period, coverage and last-updated (ТЗ §2)', () => {
  assert.match(view, /function renderAnalyticsContextBar/);
  assert.match(view, /Показаны результаты:/);
  assert.match(view, /an-context-coverage/);
  assert.match(view, /an-context-updated/);
  assert.match(css, /\.an-context-bar/);
});

test('context bar reuses cached management-dashboard fetch instead of a dedicated endpoint', () => {
  assert.match(view, /async function refreshAnalyticsCoverage/);
  assert.match(view, /analyticsFetch\('management-dashboard', analyticsOpParams\(\)\)/);
});

test('URL state still round-trips tab/period/scope for reload restore (AC-21)', () => {
  assert.match(view, /function getAnalyticsParams/);
  assert.match(view, /function setAnalyticsUrl/);
  assert.match(view, /qs\.set\('tab', params\.tab\)/);
});

test('groups are ranked by average points, not sum (ТЗ §5)', () => {
  // основной график и таблица используют avg_final_points по умолчанию
  assert.match(view, /renderGroupsMetricChart\(items, 'avg_final_points'\)/);
  assert.match(view, /data-metric="avg_final_points">Средний балл/);
  assert.match(view, /Ранжирование по среднему баллу на оператора/);
  // сумма осталась доступной как вторичная опция, но это не дефолт
  assert.match(view, /data-metric="final_points_sum">Сумма баллов/);
  // столбчатый график сравнения групп больше не строится по сумме
  assert.doesNotMatch(view, /\(g\.final_points_sum\/maxPts\)/);
});
