import { useId } from 'react';
import type { AnalyticsOut, MetricSummary } from '../api/analytics';
import { Chart } from '../components/Chart';
import { ArrowUpRightIcon } from '../components/icons';
import { formatDateRange, todayDateKey } from '../components/dateRange';
import { calendarDate } from '../components/weekCalendar';
import { Card, EmptyState } from '../components/ui';
import { DeviationChart, GoalBar, MetricCards } from './AnalyticsDashboard';
import { assess, finite, gapText, metricValue, periodCaption, shortNumber } from './analyticsInsights';
import { categoryHealth, groupBreakdown, periodChange, weeklyColumns, weeklyCoverage, type AnalyticsCategory, type AnalyticsChannel } from './analyticsWorkspace';
import './analytics-panels.css';

const CATEGORY_COPY: Record<AnalyticsCategory, { title: string; subtitle: string }> = {
  quality: { title: 'Качество работы', subtitle: 'Качество звонков и обратная связь от водителей.' },
  productivity: { title: 'Продуктивность команды', subtitle: 'Рабочее время, нагрузка и выполнение целей.' },
  discipline: { title: 'Дисциплина команды', subtitle: 'Опоздания и другие нежелательные события.' },
};
/** Chats answer in chats, not calls; discipline is the same for both channels. */
const CHAT_COPY: Partial<Record<AnalyticsCategory, { title: string; subtitle: string }>> = {
  quality: { title: 'Качество работы', subtitle: 'Качество ответов в чатах.' },
  productivity: { title: 'Продуктивность команды', subtitle: 'Норма часов, переработки и время ответа в чатах.' },
};

function shortDate(value: string) {
  return calendarDate(value)?.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }) ?? value;
}

function Change({ current, previous, metric }: { current: number | null | undefined; previous: number | null | undefined; metric: MetricSummary }) {
  const change = periodChange(current, previous, metric);
  if (!change) return <span className="analytics-panel-change analytics-panel-change--missing">Нет сравнения</span>;
  if (change.movement === 'same') return <span className="analytics-panel-change">Без изменений</span>;
  const unit = metric.unit === '%' ? 'п.п.' : metric.unit;
  return <span className={`analytics-panel-change analytics-panel-change--${change.movement}`}>
    <b>{change.delta > 0 ? '+' : '−'}{shortNumber(Math.abs(change.delta))}{unit ? ` ${unit}` : ''}</b>
    <small>{change.movement === 'up' ? 'Улучшение' : 'Ухудшение'}</small>
  </span>;
}

export function FourWeekTable({ report, onMetric }: { report: AnalyticsOut; onMetric?: (code: string) => void }) {
  const title = useId();
  const weeks = weeklyColumns(report);
  const first = weeks[0], last = weeks[weeks.length - 1];
  const today = todayDateKey();
  if (!weeks.length) return <Card title="Сравнение четырёх недель"><EmptyState title="Недельные данные ещё не загружены" hint="Выберите период для сравнения недель." /></Card>;
  return <Card className="analytics-week-card" title={<span id={title}>Сравнение четырёх недель</span>}
    subtitle={`${formatDateRange({ date_from: first.starts_on, date_to: last.ends_on })} · среднее по операторам с данными`}>
    <div className="analytics-table-scroll analytics-week-scroll" tabIndex={0} role="region" aria-labelledby={title}>
      <table className="table analytics-week-table">
        <caption className="sr-only">Показатели по неделям и изменение последней недели относительно первой</caption>
        <thead><tr><th scope="col">Показатель<small>Текущая цель</small></th>{weeks.map((week, index) => <th scope="col" key={week.starts_on}>
          <span className="analytics-week-number">Неделя {index + 1}</span><strong>{shortDate(week.starts_on)} — {shortDate(week.ends_on)}</strong>
          {week.starts_on <= today && today <= week.ends_on ? <small className="analytics-week-open">Ещё идёт</small> : week.starts_on > today ? <small>Будущая неделя</small> : <small>{week.starts_on.slice(0, 4)}</small>}
        </th>)}<th scope="col">Изменение<small>Последняя к первой</small></th></tr></thead>
        <tbody>{report.metrics.map(metric => <tr key={metric.code}>
          <th scope="row">{onMetric ? <button className="analytics-week-metric" type="button" onClick={() => onMetric(metric.code)}>{metric.title}<ArrowUpRightIcon size={12} /></button> : <span>{metric.title}</span>}<small>{metric.direction === 'lower_is_better' ? '≤' : '≥'} {metricValue(metric.target, metric)}</small></th>
          {weeks.map(week => {
            const value = metric.trend?.[week.index];
            const signal = assess(value, metric).signal;
            return <td key={week.starts_on}><span className={`analytics-week-reading analytics-signal--${signal}`} title={gapText(value, metric)}>
              <span aria-hidden="true">{signal === 'missing' ? '—' : signal === 'met' ? '✓' : '!'}</span>{finite(value) ? metricValue(value, metric) : 'Нет данных'}
              <span className="sr-only">. {gapText(value, metric)}</span>
            </span></td>;
          })}<td><Change current={metric.trend?.[last.index]} previous={weeks.length > 1 ? metric.trend?.[first.index] : null} metric={metric} /></td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">Операторов с данными<small>Хотя бы один показатель</small></th>{weeks.map(week => {
          const coverage = weeklyCoverage(report, week.index);
          return <td key={week.starts_on}><strong>{coverage.reported}<small> / {coverage.total}</small></strong><span>Все показатели: {coverage.complete}</span></td>;
        })}<td><span>Пропуски не считаются нулём</span></td></tr></tfoot>
      </table>
    </div>
    <p className="analytics-panel-note">Цвет показывает отклонение от текущей цели. Изменение учитывает направление показателя: снижение опозданий — улучшение. Состав операторов с данными может отличаться по неделям.</p>
  </Card>;
}

export function GroupDashboard({ report, metric, onGroup, compact = false, onAll }: { report: AnalyticsOut; metric: MetricSummary; onGroup: (id: number | null) => void; compact?: boolean; onAll?: () => void }) {
  const title = useId();
  const groups = groupBreakdown(report, metric);
  if (!groups.length) return <Card title="Сравнение групп"><EmptyState title="Нет групп для сравнения" hint="В выбранной области доступа пока нет операторов." /></Card>;
  const plotted = groups.slice(0, 5);
  if (compact) return <Card title={<span id={title}>Сравнение групп</span>} subtitle={`${metric.title} · сначала группы с отклонениями`} action={onAll && <button type="button" className="btn btn--plain" onClick={onAll}>Все группы →</button>}>
    <div className="analytics-table-scroll analytics-group-summary-scroll" role="region" aria-labelledby={title} tabIndex={0}>
      <table className="table analytics-group-summary"><thead><tr><th scope="col">Группа</th><th scope="col">Операторов</th><th scope="col">{metric.title}</th><th scope="col">Требуют внимания</th><th scope="col">Есть данные</th><th scope="col">Изменение</th></tr></thead>
        <tbody>{plotted.map(group => <tr key={group.id ?? 'unassigned'}>
          <th scope="row"><button type="button" onClick={() => onGroup(group.id)}>{group.name}<ArrowUpRightIcon size={12} /></button></th>
          <td>{group.total}</td><td><span className={`analytics-week-reading analytics-signal--${assess(group.value, metric).signal}`}>{metricValue(group.value, metric)}</span></td>
          <td>{group.issues}</td><td>{group.reported} / {group.total}</td><td><Change current={group.value} previous={group.previous} metric={metric} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="analytics-panel-note">Показано {plotted.length} из {groups.length} групп. Изменение — к предыдущему {report.custom_range ? 'периоду той же длины' : 'периоду'}. Средние рассчитаны по операторам с данными.</p>
  </Card>;
  return <div className="stack analytics-group-dashboard">
    <div className="analytics-panel-stats">
      <PanelStat label="Групп в сравнении" value={groups.length} note="В выбранной области доступа" />
      <PanelStat label="С отклонениями" value={groups.filter(group => group.issues > 0).length} note={`Есть операторы вне цели «${metric.title}»`} tone="watch" />
      <PanelStat label="Без данных по показателю" value={groups.reduce((sum, group) => sum + group.missing, 0)} note={`Из ${report.operators.length} операторов`} />
    </div>
    <div className="analytics-section-heading"><div><h2>Результаты групп</h2><p>{metric.title} · {periodCaption(report)}</p></div><span>Нажмите «Операторы группы» для разбора</span></div>
    <div className="analytics-group-cards">{groups.map(group => <Card className={`analytics-group-card analytics-signal--${assess(group.value, metric).signal}`} key={group.id ?? 'unassigned'}>
      <div className="analytics-group-card__head"><div><h3>{group.name}</h3><span>{group.total} операторов</span></div><span className="analytics-group-card__icon"><ArrowUpRightIcon size={16} /></span></div>
      <div className="analytics-group-card__value"><strong>{metricValue(group.value, metric)}</strong><span>Средний результат</span></div>
      <GoalBar value={group.value} metric={metric} />
      <div className="analytics-group-card__change"><Change current={group.value} previous={group.previous} metric={metric} /><span>{report.custom_range ? 'К предыдущему периоду той же длины' : 'К предыдущему периоду'}</span></div>
      <div className="analytics-group-card__facts"><span><i aria-hidden="true" />Требуют внимания <b>{group.issues}</b></span><span>Есть данные <b>{group.reported} / {group.total}</b></span></div>
      <button type="button" className="btn btn--plain analytics-group-card__button" onClick={() => onGroup(group.id)}>Операторы группы <span aria-hidden="true">→</span></button>
    </Card>)}</div>
    <Card title={`Динамика групп · ${metric.title}`} subtitle={groups.length > 5 ? 'На графике пять групп с наибольшим числом отклонений; при равенстве — сначала группы с пропусками.' : 'Средние значения по доступным операторам каждой группы.'}>
      <Chart title={`Сравнение групп: ${metric.title}`} labels={report.trend.map(point => report.grain === 'week' ? shortDate(point.starts_on) : point.label)}
        series={plotted.map(group => ({ id: String(group.id ?? 'unassigned'), name: group.name, values: group.trend }))} target={metric.target} unit={metric.unit} />
      <p className="analytics-panel-note">Среднее группы не заменяет проверку отдельных операторов. Пропуски исключены из среднего.</p>
    </Card>
  </div>;
}

function PanelStat({ label, value, note, tone = 'neutral' }: { label: string; value: number; note: string; tone?: 'neutral' | 'watch' | 'met' }) {
  return <div className={`analytics-panel-stat analytics-panel-stat--${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

export function CategoryDashboard({ report, category, channel = 'line', selected, onMetric, onOpen }: { report: AnalyticsOut; category: AnalyticsCategory; channel?: AnalyticsChannel; selected: string; onMetric: (code: string) => void; onOpen: (id: number) => void }) {
  const { metrics, people, met, attention, complete, total } = categoryHealth(report, category);
  const copy = (channel === 'chat' && CHAT_COPY[category]) || CATEGORY_COPY[category];
  const metric = metrics.find(item => item.code === selected) ?? metrics[0];
  if (!metric) return <Card title={copy.title}><EmptyState title="Показатели этой категории не настроены" hint="Активные показатели появятся здесь после настройки." /></Card>;
  return <div className={`stack analytics-category analytics-category--${category}`}>
    <div className="analytics-section-heading"><div><h2>{copy.title}</h2><p>{copy.subtitle}</p></div><span>{periodCaption(report)}</span></div>
    <div className="analytics-panel-stats">
      <PanelStat label="Все цели категории выполнены" value={met} note={`Из ${total} операторов · только с полными данными`} tone="met" />
      <PanelStat label="Требуют внимания" value={attention} note="Есть хотя бы одно отклонение в категории" tone="watch" />
      <PanelStat label="Полные данные" value={complete} note={`Из ${total} операторов · ${metrics.length === 1 ? 'по показателю' : `по всем ${metrics.length} показателям`} категории`} />
    </div>
    <MetricCards report={{ ...report, metrics }} selected={metric.code} onSelect={onMetric} />
    <div className="analytics-category-details">
      <Card title={`Динамика · ${metric.title}`} subtitle={report.custom_range ? 'Среднее по операторам за каждый шаг выбранного периода' : 'Среднее по операторам за каждый период'}>
        <div className="analytics-category-reading"><strong>{metricValue(metric.value, metric)}</strong><Change current={metric.value} previous={metric.previous} metric={metric} /></div>
        <Chart title={`${copy.title}: ${metric.title}`} labels={report.trend.map(point => report.grain === 'week' ? shortDate(point.starts_on) : point.label)} series={[{ id: metric.code, name: metric.title, values: metric.trend }]} target={metric.target} unit={metric.unit} compact />
        <p className="analytics-panel-note">Есть данные у {metric.reported} из {metric.total} операторов. {metric.direction === 'lower_is_better' ? 'Чем ниже показатель, тем лучше.' : 'Чем выше показатель, тем лучше.'}</p>
      </Card>
      <DeviationChart people={people} metric={metric} onOpen={onOpen} />
    </div>
  </div>;
}
