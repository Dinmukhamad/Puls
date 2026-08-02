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
const meta = await readFile(
  new URL('../../app/modules/analytics/metrics_meta.py', import.meta.url),
  'utf8',
);

test('the whole screen loads from a single dashboard endpoint', () => {
  assert.match(view, /analyticsGet\('dashboard'/);
  // Старый экран дёргал полтора десятка узких эндпоинтов на каждый блок.
  for (const gone of ['management-dashboard', 'operators-combined', 'matrix-combined',
    'quality-combined', 'risk-pyramid', 'heatmap', 'points-breakdown']) {
    assert.doesNotMatch(view, new RegExp(`analyticsGet\\('${gone}'`));
  }
});

test('status is never carried by colour alone', () => {
  // Зелёный и оранжевый неразличимы при протанопии (ΔE ≈ 7), поэтому у
  // каждого статуса обязан быть текст и значок.
  assert.match(view, /AN_STATUS_TEXT\s*=\s*\{/);
  assert.match(view, /good:\s*'Норма'/);
  assert.match(view, /watch:\s*'Ниже нормы'/);
  assert.match(view, /bad:\s*'Критично'/);
  assert.match(view, /AN_STATUS_ICON\s*=\s*\{/);
  assert.match(view, /AN_STATUS_TEXT\[status\]/);
  // Числа в таблице доступны и без графика.
  assert.match(view, /Показать таблицей/);
});

test('every metric explains itself in plain language', () => {
  for (const field of ['definition', 'good', 'bad', 'action']) {
    assert.match(view, new RegExp(`m\\.${field}`));
  }
  assert.match(view, /Что делать/);
  assert.match(view, /Что означают показатели/);
  // Формулировки живут на бэкенде, а не дублируются во фронте.
  assert.match(meta, /"action":/);
  assert.match(meta, /"definition":/);
});

test('filters cover period, group and weekday', () => {
  assert.match(view, /data-an2="preset"/);
  assert.match(view, /data-an2="weekday"/);
  assert.match(view, /an2-group/);
  assert.match(view, /weekdays=|params\.weekdays/);
  for (const label of ['Сегодня', '7 дней', '30 дней', 'Свой период']) {
    assert.ok(view.includes(label), `нет быстрого периода «${label}»`);
  }
});

test('empty days are shown as gaps, not zeroes', () => {
  assert.match(view, /has_data/);
  assert.match(view, /не нули/);
});

test('chart marks follow the spec: thin line, muted grid, hover tooltip', () => {
  assert.match(css, /\.an2-line[^}]*stroke-width:\s*2/s);
  assert.match(css, /\.an2-grid[^}]*var\(--border-soft\)/s);
  assert.match(css, /\.an2-target-line[^}]*stroke-dasharray/s);
  assert.match(view, /mouseenter/);
  assert.match(view, /addEventListener\('focus'/);
  assert.match(view, /setAttribute\('tabindex'/);
});

test('screen is responsive and respects reduced motion', () => {
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('operator names are escaped before landing in innerHTML', () => {
  assert.match(view, /function anEsc/);
  assert.match(view, /anEsc\(a\.name\)/);
  assert.match(view, /anEsc\(g\.name\)/);
});
