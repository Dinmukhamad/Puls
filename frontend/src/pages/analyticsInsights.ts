import type { AnalyticsOperator, AnalyticsOut, MetricSummary } from '../api/analytics';

export type Signal = 'met' | 'watch' | 'risk' | 'critical' | 'missing';
export type OperatorState = 'ontrack' | 'attention' | 'critical' | 'partial' | 'missing';
export const STATE_LABEL: Record<OperatorState, string> = {
  ontrack: 'Все цели выполнены', attention: 'Нужно внимание', critical: 'Сильное отставание',
  partial: 'Неполные данные', missing: 'Нет данных',
};
export const SIGNAL_LABEL: Record<Signal, string> = {
  met: 'Цель выполнена', watch: 'Нужно внимание', risk: 'Отклонение от 10%',
  critical: 'Отклонение от 20%', missing: 'Нет данных',
};
const EXPLANATIONS: Record<string, string> = {
  quality: 'Средняя оценка качества работы оператора.',
  efficiency: 'Доля продуктивного времени в отработанном.',
  hours_norm: 'Отработанное время относительно нормы с учётом ставки.',
  hours_worked: 'Сколько часов отработал оператор.',
  overtime: 'Часы работы сверх основного графика.',
  calls_per_hour: 'Сколько звонков обработано за час работы.',
  driver_gratitudes: 'Количество благодарностей от водителей.',
  lateness: 'Количество зарегистрированных опозданий.',
  forbidden_sites: 'Зарегистрированные посещения посторонних сайтов.',
};
export const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
export const shortNumber = (value: number | null | undefined) => finite(value) ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) : '—';
export const metricValue = (value: number | null | undefined, metric: Pick<MetricSummary, 'unit'>) => finite(value) ? `${shortNumber(value)}${metric.unit ? ` ${metric.unit}` : ''}` : 'Нет данных';
export function periodCaption(report: Pick<AnalyticsOut, 'grain' | 'period_from' | 'period_to' | 'period_label'>) {
  if (!report.period_from || !report.period_to) return report.period_label ?? 'Период не выбран';
  const start = new Date(`${report.period_from}T12:00:00`), end = new Date(`${report.period_to}T12:00:00`);
  const format = (date: Date) => date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  return report.grain === 'month' ? start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    : report.grain === 'day' ? format(start) : `${start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${format(end)}`;
}
export const description = (metric: MetricSummary) => EXPLANATIONS[metric.code] ?? metric.description ?? (metric.kind === 'anti' ? 'Нежелательные события. Чем меньше, тем лучше.' : 'Фактический результат относительно настроенной цели.');

/** Positive margin is favourable in either direction. A zero target has no relative percentage. */
export function assess(value: number | null | undefined, metric: MetricSummary) {
  if (!finite(value)) return { signal: 'missing' as Signal, margin: null, percent: null, issue: false };
  const margin = (value - metric.target) * (metric.direction === 'lower_is_better' ? -1 : 1);
  const percent = metric.target > 0 ? margin / metric.target * 100 : null;
  const penalty = metric.kind === 'anti' && value > 0;
  const signal: Signal = margin < 0
    ? percent !== null && percent <= -20 + 1e-8 ? 'critical' : percent !== null && percent <= -10 + 1e-8 ? 'risk' : 'watch'
    : penalty ? 'watch' : 'met';
  return { signal, margin, percent, issue: margin < 0 || penalty };
}

export function gapText(value: number | null | undefined, metric: MetricSummary) {
  const { margin } = assess(value, metric);
  if (margin === null) return 'Нет данных';
  const unit = metric.unit === '%' ? 'п.п.' : metric.unit ?? '';
  if (margin < 0) return `${metric.direction === 'lower_is_better' ? 'Выше лимита' : 'До цели'} ${shortNumber(-margin)} ${unit}`.trim();
  if (metric.kind === 'anti' && value! > 0) return 'Есть нежелательные события';
  return margin === 0 ? 'Точно на цели' : `Лучше цели на ${shortNumber(margin)} ${unit}`.trim();
}

export function movement(current: number | null | undefined, previous: number | null | undefined, metric: MetricSummary) {
  if (!finite(current) || !finite(previous)) return null;
  const difference = (current - previous) * (metric.direction === 'lower_is_better' ? -1 : 1);
  return difference > 1e-8 ? 'up' : difference < -1e-8 ? 'down' : 'same';
}

export function operatorInsight(row: AnalyticsOperator, metrics: MetricSummary[], latenessCode = 'lateness') {
  const cells = metrics.map(metric => ({ metric, value: row.values[metric.code] ?? null, ...assess(row.values[metric.code], metric) }));
  const reported = cells.filter(c => c.signal !== 'missing').length;
  const issues = cells.filter(c => c.issue).sort((a, b) => {
    const weight = { critical: 4, risk: 3, watch: 2, met: 1, missing: 0 };
    return weight[b.signal] - weight[a.signal] || (a.percent ?? 0) - (b.percent ?? 0);
  });
  const state: OperatorState = issues.some(c => c.signal === 'critical') ? 'critical' : issues.length ? 'attention'
    : !reported ? 'missing' : reported < metrics.length ? 'partial' : 'ontrack';
  const improving = cells.filter(c => movement(c.value, row.previous_values?.[c.metric.code], c.metric) === 'up').length;
  const worsening = cells.filter(c => movement(c.value, row.previous_values?.[c.metric.code], c.metric) === 'down').length;
  return { row, cells, issues, state, reported, met: cells.filter(c => c.signal === 'met').length, improving, worsening,
    late: finite(row.values[latenessCode]) && row.values[latenessCode]! > 0,
    worst: Math.min(0, ...issues.map(c => c.percent ?? 0)),
  };
}
export type OperatorInsight = ReturnType<typeof operatorInsight>;
export function teamInsights(report: AnalyticsOut) {
  return report.operators.map(row => operatorInsight(row, report.metrics, report.lateness_metric_code)).sort((a, b) => {
    const priority: Record<OperatorState, number> = { critical: 4, attention: 3, missing: 2, partial: 1, ontrack: 0 };
    return priority[b.state] - priority[a.state] || a.worst - b.worst || b.issues.length - a.issues.length || a.row.full_name.localeCompare(b.row.full_name, 'ru');
  });
}
export function matchesFilter(item: OperatorInsight, status: string, selected: MetricSummary) {
  switch (status) {
    case 'attention': return item.issues.length > 0;
    case 'watch': return item.state === 'attention';
    case 'critical': return item.state === 'critical';
    case 'ontrack': return item.state === 'ontrack';
    case 'down': return item.worsening > 0;
    case 'up': return item.improving > 0;
    case 'late': return item.late;
    case 'missing': return item.reported < item.cells.length;
    case 'partial': return item.state === 'partial';
    case 'empty': return item.state === 'missing';
    case 'below': return assess(item.row.values[selected.code], selected).issue;
    default: return true;
  }
}
