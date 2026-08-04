import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const view = await readFile(
  new URL('../../js/src/views/reports/41-analytics.view.js', import.meta.url),
  'utf8',
);
const css = await readFile(
  new URL('../../css/src/views/41-analytics.css', import.meta.url),
  'utf8',
);

test('analytics has three tabs: summary, operators, quality (ТЗ §4)', () => {
  const m = view.match(/const AN_TABS = \[[\s\S]*?\];/);
  assert.ok(m, 'AN_TABS должен существовать');
  assert.match(m[0], /key: 'summary'/);
  assert.match(m[0], /key: 'operators'/);
  assert.match(m[0], /key: 'quality'/);
  assert.match(view, /<nav class="an2-tabs"/);
  assert.match(css, /\.an2-tab\b/);
});

test('active tab persists in the URL and is restored on load (ТЗ §4)', () => {
  assert.match(view, /function anReadTab/);
  assert.match(view, /function anWriteTab/);
  assert.match(view, /\.get\('atab'\)/);
  assert.match(view, /\.set\('atab'/);
  assert.match(view, /AN_STATE\.tab = anReadTab\(\)/);
});

test('paint branches by tab; summary body extracted', () => {
  assert.match(view, /AN_STATE\.tab === 'operators' \? anOperatorsBody\(\) : anQualityBody\(\)/);
  assert.match(view, /function anSummaryBody/);
});

test('operators tab reuses the existing /operators endpoint with server paging/sort/search', () => {
  assert.match(view, /api\.analyticsGet\('operators', params\)/);
  assert.match(view, /page: AN_STATE\.ops\.page/);
  assert.match(view, /sort_by: AN_STATE\.ops\.sortBy/);
  assert.match(view, /operator_query/);
  assert.match(view, /function anOpsTable/);
  assert.match(view, /function anOpsPager/);
  // не выдумывает новых эндпоинтов под несуществующие данные
  assert.doesNotMatch(view, /analyticsGet\('(driver-ratings|parks|realtime|monitoring)/);
});

test('operators table: FIO horizontal, sticky header, sortable, expandable rows', () => {
  assert.match(view, /an2-ops-row/);
  assert.match(view, /data-an2="ops-sort"/);
  assert.match(css, /\.an2-ops-table thead th\s*\{[^}]*position: sticky/);
  assert.match(css, /\.an2-name\s*\{[^}]*white-space: nowrap/);
});

test('quality tab is built only from real dashboard data (no fabricated metrics)', () => {
  assert.match(view, /function anQualityBody/);
  // качество берёт готовую метрику и покрытие из /dashboard, без выдуманных AR/ATT/водителей
  assert.match(view, /data\.metrics/);
  assert.doesNotMatch(view, /driver_rating|Оценка водител|\bATT\b:/);
});
