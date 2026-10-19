import type { AnalyticsOperator, AnalyticsOut, MetricSummary } from '../api/analytics';
import { todayDateKey, validDateRange, type DateRange } from '../components/dateRange';
import { calendarDate, dateKey, shiftDays } from '../components/weekCalendar';
import { assess, finite, movement, operatorInsight } from './analyticsInsights';

export type AnalyticsCategory = 'quality' | 'productivity' | 'discipline';

/** Keep chart labels and every series inside the chosen range, without changing its summaries. */
export function selectedPeriodReport(report: AnalyticsOut): AnalyticsOut {
  const context = report.custom_range ? Math.max(0, report.context_points ?? 0) : 0;
  if (!context) return report;
  return {
    ...report,
    context_points: 0,
    trend: report.trend.slice(context),
    metrics: report.metrics.map(metric => ({ ...metric, trend: metric.trend.slice(context) })),
    groups: report.groups.map(group => ({ ...group, values: group.values.slice(context) })),
    comparisons: report.comparisons.map(person => ({ ...person, values: person.values.slice(context) })),
    operators: report.operators.map(person => ({
      ...person,
      trend: person.trend.slice(context),
      trends: Object.fromEntries(Object.entries(person.trends ?? {}).map(([code, values]) => [code, values.slice(context)])),
    })),
  };
}

/** Four complete calendar weeks, ending with the week containing the anchor. */
export function weekWindow(anchor: string): DateRange {
  const date = calendarDate(anchor);
  if (!date) throw new RangeError('Некорректная дата для сравнения недель');
  const monday = shiftDays(date, -((date.getUTCDay() + 6) % 7));
  const range = { date_from: dateKey(shiftDays(monday, -21)), date_to: dateKey(shiftDays(monday, 6)) };
  if (!validDateRange(range)) throw new RangeError('Сравнение выходит за допустимые даты');
  return range;
}

/** The current week is incomplete even on Sunday; use the four preceding weeks. */
export function completedWeekWindow(today = todayDateKey()): DateRange {
  const date = calendarDate(today);
  if (!date) throw new RangeError('Некорректная текущая дата');
  return weekWindow(dateKey(shiftDays(date, -((date.getUTCDay() + 6) % 7) - 1)));
}

/** Quality of calls and of chats, and the drivers' thanks; the rest of the work is productivity. */
const QUALITY_CODES = new Set(['quality', 'driver_gratitudes', 'chat_quality']);

export function metricCategory(metric: MetricSummary, latenessCode = 'lateness'): AnalyticsCategory {
  if (metric.kind === 'anti' || metric.code === latenessCode) return 'discipline';
  return QUALITY_CODES.has(metric.code) ? 'quality' : 'productivity';
}

export type AnalyticsChannel = 'line' | 'chat';
/** The line by default; chats only when the link asks for them. */
export const analyticsChannel = (value: string | null): AnalyticsChannel => value === 'chat' ? 'chat' : 'line';
/** Chats have only quality and discipline (docs/CHANNELS.md). */
export const channelCategories = (channel: AnalyticsChannel): AnalyticsCategory[] =>
  channel === 'chat' ? ['quality', 'discipline'] : ['quality', 'productivity', 'discipline'];

export function categoryMetrics(report: AnalyticsOut, category: AnalyticsCategory) {
  return report.metrics.filter(metric => metricCategory(metric, report.lateness_metric_code) === category);
}

export function mean(values: (number | null | undefined)[]): number | null {
  const observed = values.filter(finite);
  return observed.length ? observed.reduce((sum, value) => sum + value, 0) / observed.length : null;
}

/** Numeric difference keeps its real sign; movement respects the metric direction. */
export function periodChange(current: number | null | undefined, previous: number | null | undefined, metric: MetricSummary) {
  if (!finite(current) || !finite(previous)) return null;
  const delta = current - previous;
  return { delta: Math.abs(delta) < 1e-8 ? 0 : delta, movement: movement(current, previous, metric)! };
}

export function metricTrend(row: AnalyticsOperator, report: AnalyticsOut, code: string): (number | null)[] {
  // The legacy trend belongs only to the selected metric, never to another one.
  return row.trends?.[code] ?? (report.metric_code === code ? row.trend : []) ?? [];
}

export function weeklyColumns(report: AnalyticsOut) {
  if (report.grain !== 'week') return [];
  return report.trend.map((point, index) => {
    const start = calendarDate(point.starts_on);
    return { ...point, index, ends_on: start ? dateKey(shiftDays(start, 6)) : point.starts_on };
  }).slice(-4);
}

export function weeklyCoverage(report: AnalyticsOut, index: number) {
  const reported = report.operators.filter(row => report.metrics.some(metric => finite(metricTrend(row, report, metric.code)[index]))).length;
  const complete = report.metrics.length ? report.operators.filter(row => report.metrics.every(metric => finite(metricTrend(row, report, metric.code)[index]))).length : 0;
  return { reported, complete, total: report.operators.length };
}

/** Groups are derived only from the server-authorized operator rows. */
export function groupBreakdown(report: AnalyticsOut, metric: MetricSummary) {
  const groups = new Map<number | null, AnalyticsOperator[]>();
  for (const row of report.operators) {
    const id = row.group_id ?? null;
    const members = groups.get(id);
    if (members) members.push(row);
    else groups.set(id, [row]);
  }
  return [...groups.entries()].map(([id, operators]) => {
    const values = operators.map(row => row.values[metric.code]);
    const reported = values.filter(finite).length;
    const value = mean(values);
    const previous = mean(operators.map(row => row.previous_values?.[metric.code]));
    return {
      id,
      name: operators[0].group_name || 'Без группы',
      total: operators.length,
      reported,
      missing: operators.length - reported,
      issues: values.filter(value => assess(value, metric).issue).length,
      met: values.filter(value => assess(value, metric).signal === 'met').length,
      value,
      previous,
      change: periodChange(value, previous, metric),
      trend: report.trend.map((_, index) => mean(operators.map(row => metricTrend(row, report, metric.code)[index]))),
    };
  }).sort((a, b) => b.issues - a.issues || b.missing - a.missing || a.name.localeCompare(b.name, 'ru'));
}

export function categoryHealth(report: AnalyticsOut, category: AnalyticsCategory) {
  const metrics = categoryMetrics(report, category);
  const people = report.operators.map(row => operatorInsight(row, metrics, report.lateness_metric_code));
  return {
    metrics,
    people,
    met: metrics.length ? people.filter(person => person.state === 'ontrack').length : 0,
    attention: people.filter(person => person.issues.length).length,
    complete: metrics.length ? people.filter(person => person.reported === metrics.length).length : 0,
    total: people.length,
  };
}
