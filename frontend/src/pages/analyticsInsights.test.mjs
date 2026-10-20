import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: [fileURLToPath(new URL('./analyticsInsights.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { assess, gapText, movement, operatorInsight, teamInsights, matchesFilter } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const quality = { code: 'quality', title: 'Качество', target: 80, unit: '%', direction: 'higher_is_better', kind: 'positive' };
const late = { code: 'lateness', title: 'Опоздания', target: 0, unit: 'шт', direction: 'lower_is_better', kind: 'anti' };
const row = (values, previous_values = {}) => ({ user_id: 1, full_name: 'Анна', values, previous_values });

test('thresholds use relative distance from the configured goal, with exact 10 and 20 percent boundaries', () => {
  assert.equal(assess(80, quality).signal, 'met');
  assert.equal(assess(79, quality).signal, 'watch');
  assert.equal(assess(72, quality).signal, 'risk');
  assert.equal(assess(64, quality).signal, 'critical');
  assert.equal(assess(64, quality).percent, -20);
  assert.equal(gapText(64, quality), 'До цели 16 п.п.');
  assert.equal(assess(100, quality).percent, 25);
});

test('lower-is-better respects the limit and treats a decrease as improvement', () => {
  const metric = { ...quality, target: 10, direction: 'lower_is_better', unit: 'мин' };
  assert.equal(assess(8, metric).signal, 'met');
  assert.equal(assess(11, metric).signal, 'risk');
  assert.equal(assess(12, metric).signal, 'critical');
  assert.equal(movement(8, 12, metric), 'up');
  assert.equal(gapText(12, metric), 'Выше лимита 2 мин');
});

test('zero disciplinary target never divides by zero and positive events remain a concern under an allowed limit', () => {
  assert.deepEqual(assess(0, late), { signal: 'met', margin: -0, percent: null, issue: false });
  assert.equal(assess(3, late).percent, null);
  assert.equal(assess(3, late).issue, true);
  assert.equal(assess(1, { ...late, target: 2 }).signal, 'watch');
  assert.equal(gapText(1, { ...late, target: 2 }), 'Есть нежелательные события');
});

test('missing, invalid and partial observations never look like successful performance', () => {
  for (const value of [null, undefined, NaN, Infinity]) assert.equal(assess(value, quality).signal, 'missing');
  assert.equal(assess(0, quality).signal, 'critical');
  assert.equal(operatorInsight(row({ quality: 90 }), [quality, late]).state, 'partial');
  assert.equal(operatorInsight(row({}), [quality, late]).state, 'missing');
  assert.equal(operatorInsight(row({ quality: 90, lateness: 0 }), [quality, late]).state, 'ontrack');
  assert.equal(movement(80, null, quality), null);
});

test('one severe metric cannot be cancelled by overachievement elsewhere; changes can move in both directions', () => {
  const metrics = [quality, { ...quality, code: 'efficiency' }, late];
  const person = operatorInsight(row({ quality: 60, efficiency: 160, lateness: 1 }, { quality: 70, efficiency: 100, lateness: 3 }), metrics);
  assert.equal(person.state, 'critical');
  assert.equal(person.worsening, 1);
  assert.equal(person.improving, 2);
  assert.equal(person.issues.length, 2);
  assert.equal(matchesFilter(person, 'late', quality), true);
  assert.equal(matchesFilter(person, 'down', quality), true);
  assert.equal(matchesFilter(person, 'ontrack', quality), false);
});

test('priority and disjoint distribution filters agree, including custom lateness code and partial data', () => {
  const metric = { ...late, code: 'tardiness' };
  const report = { metrics: [quality, metric], lateness_metric_code: metric.code, operators: [
    { ...row({ quality: 90, tardiness: 0 }), user_id: 1 },
    { ...row({ quality: 70, tardiness: 2 }), user_id: 2 },
    { ...row({ quality: 40 }), user_id: 3 },
    { ...row({ quality: 90 }), user_id: 4 },
    { ...row({}), user_id: 5 },
  ] };
  const people = teamInsights(report);
  assert.deepEqual(people.map(p => p.row.user_id), [3, 2, 5, 4, 1]);
  assert.equal(people.filter(p => p.late).length, 1);
  for (const [filter, state] of [['watch', 'attention'], ['critical', 'critical'], ['partial', 'partial'], ['empty', 'missing'], ['ontrack', 'ontrack']]) {
    assert.deepEqual(people.filter(p => matchesFilter(p, filter, quality)), people.filter(p => p.state === state));
  }
});

test('a chosen range is named by its own dates whatever step its chart uses', async () => {
  const { periodCaption } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const range = (period_from, period_to, grain = 'day') => periodCaption({ grain, period_from, period_to, period_label: null, custom_range: true });
  assert.equal(range('2026-10-05', '2026-10-11', 'week'), '5 окт. — 11 окт. 2026 г.');
  assert.equal(range('2026-10-11', '2026-10-11'), '11 окт. 2026 г.');
  assert.equal(range('2025-12-29', '2026-01-04'), '29 дек. 2025 г. — 4 янв. 2026 г.');
  assert.equal(range('2026-02-01', '2026-08-31', 'month'), '1 февр. — 31 авг. 2026 г.');
  // The last-period reports keep their former captions.
  assert.equal(periodCaption({ grain: 'month', period_from: '2026-08-01', period_to: '2026-08-31', period_label: null }), 'август 2026 г.');
});

test('overtime is a bonus over the 100 points: less than its target is a smaller bonus, never a problem (docs/CHANNELS.md)', () => {
  const overtime = { code: 'overtime', title: 'Переработки', target: 8, unit: 'ч', direction: 'higher_is_better', kind: 'positive', bonus: true };
  assert.deepEqual(assess(3, overtime), { signal: 'bonus', margin: -5, percent: -62.5, issue: false });
  assert.equal(assess(8, overtime).signal, 'met');
  assert.equal(gapText(3, overtime), 'До полного бонуса 5 ч');
  assert.equal(gapText(9, overtime), 'Полный бонус');
  // Without overtime every goal can still be met: its absence is neither a problem nor missing data.
  const insight = operatorInsight(row({ quality: 90, lateness: 0 }), [quality, late, overtime]);
  assert.equal(insight.state, 'ontrack');
  assert.equal(insight.issues.length, 0);
  assert.equal(matchesFilter(insight, 'missing', quality), false);
});

test('a metric without points is for reference: its target is shown, missing it is no problem', () => {
  const response = { code: 'chat_response_time', title: 'Время ответа', target: 120, unit: 'сек', direction: 'lower_is_better', kind: 'positive', scored: false };
  assert.deepEqual(assess(130, response), { signal: 'info', margin: -10, percent: -8.333333333333332, issue: false });
  assert.equal(assess(100, response).signal, 'met');
  assert.equal(gapText(130, response), 'Выше лимита 10 сек');
  const insight = operatorInsight(row({ quality: 90, lateness: 0, chat_response_time: 130 }), [quality, late, response]);
  assert.equal(insight.state, 'ontrack');
  // A penalty metric is never «for reference», whatever its points.
  assert.equal(assess(1, { ...late, scored: false }).issue, true);
});
