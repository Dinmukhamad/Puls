import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: [fileURLToPath(new URL('./analyticsWorkspace.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { selectedPeriodReport, weekWindow, completedWeekWindow, mean, periodChange, metricCategory, categoryMetrics, categoryHealth, metricTrend, weeklyColumns, weeklyCoverage, groupBreakdown } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

const quality = { code: 'quality', title: 'Качество', target: 80, unit: '%', direction: 'higher_is_better', kind: 'positive' };
const efficiency = { ...quality, code: 'efficiency', title: 'Эффективность' };
const lateness = { code: 'lateness', title: 'Опоздания', target: 0, unit: 'шт', direction: 'lower_is_better', kind: 'anti' };
const gratitudes = { ...quality, code: 'driver_gratitudes', title: 'Благодарности', target: 2, unit: 'шт' };
const operator = (id, overrides = {}) => ({ user_id: id, full_name: `Оператор ${id}`, group_id: 1, group_name: 'Группа 1', values: {}, previous_values: {}, trends: {}, trend: [], ...overrides });
const starts = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'];
const report = (overrides = {}) => ({ grain: 'week', metric_code: 'quality', lateness_metric_code: 'lateness', metrics: [quality, efficiency, lateness], operators: [], groups: [], trend: starts.map((starts_on, i) => ({ starts_on, label: `Неделя ${i}`, week_id: i + 1, value: null, reported: 0 })), ...overrides });

test('selected-period charts exclude context from all aligned series while preserving summaries and missing values', () => {
  const source = report({ custom_range: true, context_points: 2,
    metrics: [{ ...quality, value: 80, previous: 75, trend: [90, 91, null, 80, 0, 82] }],
    operators: [operator(1, { values: { quality: 80 }, previous_values: { quality: 75 }, trend: [90, 91, null, 80, 0, 82], trends: { quality: [90, 91, null, 80, 0, 82], lateness: [5, 4, 0, null, 2, 1] } })],
    groups: [{ id: 1, values: [90, 91, null, 80, 0, 82] }], comparisons: [{ id: 1, values: [90, 91, null, 80, 0, 82] }],
  });
  const result = selectedPeriodReport(source);
  assert.deepEqual(result.trend.map(point => point.starts_on), starts.slice(2));
  assert.deepEqual(result.metrics[0].trend, [null, 80, 0, 82]);
  assert.deepEqual(result.operators[0].trend, result.metrics[0].trend);
  assert.deepEqual(result.operators[0].trends.lateness, [0, null, 2, 1]);
  assert.deepEqual(result.groups[0].values, result.metrics[0].trend);
  assert.deepEqual(result.comparisons[0].values, result.metrics[0].trend);
  assert.equal(result.context_points, 0);
  assert.equal(result.metrics[0].value, 80);
  assert.equal(result.metrics[0].previous, 75);
  assert.deepEqual(result.operators[0].previous_values, { quality: 75 });
  assert.equal(source.trend.length, 6);
  assert.equal(source.metrics[0].trend.length, 6);
  assert.equal(source.context_points, 2);
  const weekly = { ...source, custom_range: false };
  assert.strictEqual(selectedPeriodReport(weekly), weekly);
});

test('four-week windows cover Monday through Sunday and preserve month, year and leap-day boundaries', () => {
  assert.deepEqual(weekWindow('2026-10-13'), { date_from: '2026-09-21', date_to: '2026-10-18' });
  assert.deepEqual(weekWindow('2026-10-18'), weekWindow('2026-10-12'));
  assert.deepEqual(weekWindow('2026-01-01'), { date_from: '2025-12-08', date_to: '2026-01-04' });
  assert.deepEqual(weekWindow('2024-02-29'), { date_from: '2024-02-05', date_to: '2024-03-03' });
  for (const anchor of ['2026-02-30', '2026-10-13T00:00:00Z', '', '0001-01-01', '9999-12-31']) {
    assert.throws(() => weekWindow(anchor), RangeError);
  }
});

test('the default window excludes the current week, including an unfinished Sunday', () => {
  assert.deepEqual(completedWeekWindow('2026-10-13'), { date_from: '2026-09-14', date_to: '2026-10-11' });
  assert.deepEqual(completedWeekWindow('2026-10-11'), { date_from: '2026-09-07', date_to: '2026-10-04' });
  assert.deepEqual(completedWeekWindow('2026-10-12'), { date_from: '2026-09-14', date_to: '2026-10-11' });
  assert.deepEqual(completedWeekWindow('2026-01-01'), { date_from: '2025-12-01', date_to: '2025-12-28' });
  assert.throws(() => completedWeekWindow('2026-13-01'), RangeError);
});

test('missing and nonfinite values never become zero or successful performance', () => {
  assert.equal(mean([null, undefined, NaN, Infinity]), null);
  assert.equal(mean([0, null, undefined]), 0);
  assert.equal(mean([0, 80, null, NaN]), 40);
  assert.equal(periodChange(null, 80, quality), null);
  assert.equal(periodChange(80, undefined, quality), null);
  assert.equal(periodChange(Infinity, 80, quality), null);
  assert.deepEqual(periodChange(0, 10, quality), { delta: -10, movement: 'down' });
  assert.deepEqual(periodChange(0, 0, lateness), { delta: 0, movement: 'same' });
});

test('changes keep real signs while lower-is-better decreases count as improvements', () => {
  assert.deepEqual(periodChange(0, 3, lateness), { delta: -3, movement: 'up' });
  assert.deepEqual(periodChange(3, 0, lateness), { delta: 3, movement: 'down' });
  assert.deepEqual(periodChange(90, 80, quality), { delta: 10, movement: 'up' });
  assert.deepEqual(periodChange(80 + 1e-10, 80, quality), { delta: 0, movement: 'same' });
});

test('weekly columns retain source indices, use calendar dates, and never relabel days as weeks', () => {
  const columns = weeklyColumns(report());
  assert.deepEqual(columns.map(column => column.index), [2, 3, 4, 5]);
  assert.deepEqual(columns.map(column => column.starts_on), starts.slice(-4));
  assert.deepEqual(columns.map(column => column.ends_on), ['2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11']);
  assert.equal(weeklyColumns(report({ trend: [{ starts_on: '2025-12-29', label: 'ISO W01' }] }))[0].ends_on, '2026-01-04');
  assert.deepEqual(weeklyColumns(report({ grain: 'day' })), []);
  assert.deepEqual(weeklyColumns(report({ grain: 'month' })), []);
  assert.deepEqual(weeklyColumns(report({ trend: [] })), []);
});

test('per-metric history uses the selected-metric legacy history only for its own code', () => {
  const row = operator(1, { trend: [50, 60], trends: { efficiency: [0, null] } });
  assert.deepEqual(metricTrend(row, report(), 'quality'), [50, 60]);
  assert.deepEqual(metricTrend(row, report(), 'efficiency'), [0, null]);
  assert.deepEqual(metricTrend(row, report(), 'lateness'), []);
});

test('weekly coverage separates any observation from complete data, includes zero, and handles no metrics', () => {
  const current = report({ operators: [
    operator(1, { trends: { quality: [0, 80], efficiency: [90, 90], lateness: [0, null] } }),
    operator(2, { trends: { quality: [null, 80], efficiency: [null, 80], lateness: [0, 0] } }),
    operator(3, { trends: { quality: [NaN, null] } }),
  ] });
  assert.deepEqual(weeklyCoverage(current, 0), { reported: 2, complete: 1, total: 3 });
  assert.deepEqual(weeklyCoverage(current, 1), { reported: 2, complete: 1, total: 3 });
  assert.deepEqual(weeklyCoverage(current, 7), { reported: 0, complete: 0, total: 3 });
  assert.deepEqual(weeklyCoverage({ ...current, metrics: [] }, 0), { reported: 0, complete: 0, total: 3 });
});

test('group means and histories use only supplied authorized operators and ignore directory aggregates', () => {
  const current = report({ groups: [{ id: 999, name: 'Чужая группа', value: 999 }], operators: [
    operator(1, { values: { quality: 0 }, previous_values: { quality: 50 }, trends: { quality: [null, 0, 80] } }),
    operator(2, { values: { quality: 100 }, previous_values: { quality: 90 }, trends: { quality: [null, 80, null] } }),
    operator(3, { values: { quality: null }, previous_values: { quality: null }, trends: { quality: [null, null, NaN] } }),
    operator(4, { group_id: 2, group_name: 'Группа 2', values: { quality: 80 }, previous_values: { quality: 80 }, trends: { quality: [50, 60, 70] } }),
    operator(5, { group_id: null, group_name: null }),
  ] });
  const result = groupBreakdown(current, quality);
  assert.deepEqual(result.map(group => group.id), [1, null, 2]);
  const first = result.find(group => group.id === 1);
  assert.equal(first.total, 3);
  assert.equal(first.reported, 2);
  assert.equal(first.missing, 1);
  assert.equal(first.issues, 1);
  assert.equal(first.met, 1);
  assert.equal(first.value, 50);
  assert.equal(first.previous, 70);
  assert.deepEqual(first.change, { delta: -20, movement: 'down' });
  assert.deepEqual(first.trend, [null, 40, 80, null, null, null]);
  const unassigned = result.find(group => group.id === null);
  assert.equal(unassigned.name, 'Без группы');
  assert.equal(unassigned.value, null);
  assert.equal(unassigned.met, 0);
  assert.equal(unassigned.change, null);
  assert.deepEqual(groupBreakdown(report({ groups: current.groups }), quality), []);
});

test('disciplinary groups preserve zero events and do not mark missing observations as in target', () => {
  const groups = groupBreakdown(report({ operators: [
    operator(1, { values: { lateness: 0 }, previous_values: { lateness: 2 } }),
    operator(2, { values: { lateness: 2 }, previous_values: { lateness: 4 } }),
    operator(3),
  ] }), lateness);
  assert.equal(groups[0].value, 1);
  assert.equal(groups[0].reported, 2);
  assert.equal(groups[0].met, 1);
  assert.equal(groups[0].issues, 1);
  assert.equal(groups[0].missing, 1);
  assert.deepEqual(groups[0].change, { delta: -2, movement: 'up' });
});

test('category membership handles custom lateness, anti metrics and configured positive metrics', () => {
  const customLateness = { ...quality, code: 'tardiness' };
  const customPositive = { ...quality, code: 'custom_metric' };
  const customAnti = { ...lateness, code: 'custom_violation' };
  assert.equal(metricCategory(customLateness, 'tardiness'), 'discipline');
  assert.equal(metricCategory(customPositive), 'productivity');
  assert.equal(metricCategory(customAnti), 'discipline');
  const current = report({ metrics: [quality, gratitudes, efficiency, customLateness, customPositive, customAnti], lateness_metric_code: 'tardiness' });
  assert.deepEqual(categoryMetrics(current, 'quality').map(metric => metric.code), ['quality', 'driver_gratitudes']);
  assert.deepEqual(categoryMetrics(current, 'productivity').map(metric => metric.code), ['efficiency', 'custom_metric']);
  assert.deepEqual(categoryMetrics(current, 'discipline').map(metric => metric.code), ['tardiness', 'custom_violation']);
});

test('category health counts all category goals, never hides poor quality behind productivity or partial data', () => {
  const current = report({ metrics: [quality, gratitudes, efficiency, lateness], operators: [
    operator(1, { values: { quality: 90, driver_gratitudes: 2, efficiency: 0, lateness: 4 } }),
    operator(2, { values: { quality: 90, efficiency: 100, lateness: 0 } }),
    operator(3, { values: { quality: 60, driver_gratitudes: 5, efficiency: 100, lateness: 0 } }),
    operator(4),
  ] });
  const health = categoryHealth(current, 'quality');
  assert.equal(health.total, 4);
  assert.equal(health.met, 1);
  assert.equal(health.attention, 1);
  assert.equal(health.complete, 2);
  assert.deepEqual(health.people.map(person => person.state), ['ontrack', 'partial', 'critical', 'missing']);
  const empty = categoryHealth({ ...current, metrics: [efficiency] }, 'quality');
  assert.equal(empty.met, 0);
  assert.equal(empty.complete, 0);
  assert.equal(empty.attention, 0);
});
