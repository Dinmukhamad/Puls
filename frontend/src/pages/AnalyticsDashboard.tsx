import { useId } from 'react';
import type { AnalyticsOut, MetricSummary } from '../api/analytics';
import { Chart } from '../components/Chart';
import { Card, EmptyState } from '../components/ui';
import { assess, description, gapText, metricValue, shortNumber, periodCaption, STATE_LABEL, type OperatorInsight, type OperatorState } from './analyticsInsights';

const STATES: OperatorState[] = ['ontrack', 'attention', 'critical', 'partial', 'missing'];
const COLORS: Record<OperatorState, string> = { ontrack: '#16816b', attention: '#c48618', critical: '#d34a61', partial: '#94a3b8', missing: '#d4dbe4' };

export function Sparkline({ values }: { values: (number | null)[] }) {
  const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!valid.length) return <span className="analytics-spark-empty">История ещё не загружена</span>;
  const min = Math.min(...valid), max = Math.max(...valid), span = Math.max(1, max - min);
  let path = '', connected = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) { connected = false; return; }
    path += `${connected ? 'L' : 'M'}${4 + i * 172 / Math.max(1, values.length - 1)},${35 - (v - min) / span * 28} `;
    connected = true;
  });
  return <svg className="analytics-spark" viewBox="0 0 180 42" aria-hidden="true"><path d={path} />{values.map((v, i) => v === null || !Number.isFinite(v) ? null : <circle key={i} cx={4 + i * 172 / Math.max(1, values.length - 1)} cy={35 - (v - min) / span * 28} r="2" />)}</svg>;
}

export function GoalBar({ value, metric }: { value: number | null; metric: MetricSummary }) {
  const signal = assess(value, metric).signal;
  const max = Math.max(1, metric.target * 1.25, value ?? 0);
  return <div className={`analytics-goal analytics-signal--${signal}`} role="img" aria-label={`Факт: ${metricValue(value, metric)}. Цель: ${metric.direction === 'lower_is_better' ? 'не более' : 'не менее'} ${metricValue(metric.target, metric)}`}>
    <div className="analytics-goal__track" aria-hidden="true"><span style={{ width: `${Math.max(0, value ?? 0) / max * 100}%` }} /><i style={{ left: `${metric.target / max * 100}%` }} /></div>
    <div className="analytics-goal__caption"><span>Факт {metricValue(value, metric)}</span><span>{metric.direction === 'lower_is_better' ? 'Лимит ≤' : 'Цель ≥'} {metricValue(metric.target, metric)}</span></div>
  </div>;
}

export function TeamPulse({ people, lateAvailable, onFilter }: { people: OperatorInsight[]; lateAvailable: boolean; onFilter: (status: string) => void }) {
  const cards = [
    { status: 'attention', label: 'Требуют внимания', value: people.filter(p => p.issues.length).length, note: 'Не достигнута цель или есть нарушения', tone: 'critical', icon: '!' },
    { status: 'ontrack', label: 'Выполняют все цели', value: people.filter(p => p.state === 'ontrack').length, note: 'Все показатели загружены и в норме', tone: 'met', icon: '✓' },
    { status: 'down', label: 'Есть ухудшение', value: people.filter(p => p.worsening).length, note: 'Хотя бы один показатель стал хуже', tone: 'risk', icon: '↘' },
    { status: 'late', label: 'Есть опоздания', value: lateAvailable ? people.filter(p => p.late).length : '—', note: lateAvailable ? 'Операторов с зарегистрированными опозданиями' : 'Данные об опозданиях не загружены', tone: 'watch', icon: '◷' },
  ];
  return <div className="analytics-pulse">{cards.map(c => <button key={c.status} className={`analytics-pulse-card analytics-signal--${c.tone}`} onClick={() => onFilter(c.status)}><span className="analytics-pulse-card__head">{c.label}<i aria-hidden="true">{c.icon}</i></span><strong>{c.value}<small> / {people.length}</small></strong><span>{c.note}</span><b>Посмотреть операторов →</b></button>)}</div>;
}

export function TeamDistribution({ people, onFilter }: { people: OperatorInsight[]; onFilter: (status: string) => void }) {
  let offset = 0;
  const slices = STATES.map(state => {
    const count = people.filter(p => p.state === state).length;
    const start = offset; offset += people.length ? count / people.length * 100 : 0;
    return { state, count, color: `${COLORS[state]} ${start}% ${offset}%` };
  });
  return <Card title="Состояние команды" subtitle="Каждый оператор учитывается один раз"><div className="analytics-distribution">
    <div className="analytics-donut" style={{ background: people.length ? `conic-gradient(${slices.map(s => s.color).join(',')})` : '#d4dbe4' }} role="img" aria-label={slices.map(s => `${STATE_LABEL[s.state]}: ${s.count}`).join('. ')}><div><strong>{people.length}</strong><span>операторов</span></div></div>
    <div className="analytics-distribution__legend">{slices.map(s => <button key={s.state} onClick={() => onFilter(s.state === 'missing' ? 'empty' : s.state === 'attention' ? 'watch' : s.state)}><i style={{ background: COLORS[s.state] }} aria-hidden="true" /><span>{STATE_LABEL[s.state]}</span><strong>{s.count}</strong></button>)}</div>
  </div></Card>;
}

export function MetricCards({ report, selected, onSelect }: { report: AnalyticsOut; selected: string; onSelect: (code: string) => void }) {
  return <div className="analytics-metric-grid analytics-metric-grid--goals">{report.metrics.map(metric => {
    const signal = assess(metric.value, metric).signal;
    const affected = report.operators.filter(p => assess(p.values[metric.code], metric).issue).length;
    return <button className={`analytics-metric-card analytics-signal--${signal}`} key={metric.code} aria-pressed={selected === metric.code} onClick={() => onSelect(metric.code)}>
      <span className="analytics-metric-card__heading">{metric.title}<span aria-hidden="true">↗</span></span><span className="analytics-metric-card__description">{description(metric)}</span>
      <div className="analytics-metric-card__reading"><strong>{metricValue(metric.value, metric)}</strong><small>в среднем по команде</small></div>
      <GoalBar value={metric.value} metric={metric} /><Sparkline values={metric.trend ?? []} />
      <span className="analytics-metric-card__footer"><b>{metric.reported ? `${affected} из ${metric.reported} требуют внимания` : 'Нет наблюдений'}</b><small>Без данных: {metric.total - metric.reported}</small></span>
    </button>;
  })}</div>;
}

export function DeviationChart({ people, metric, onOpen }: { people: OperatorInsight[]; metric: MetricSummary; onOpen: (id: number) => void }) {
  const rows = people.map(p => ({ person: p, assessment: assess(p.row.values[metric.code], metric) })).filter(p => p.assessment.margin !== null)
    .sort((a, b) => a.assessment.margin! - b.assessment.margin!).slice(0, 8);
  const relative = metric.target > 0;
  const values = rows.map(p => relative ? p.assessment.percent! : p.assessment.margin!);
  const scale = Math.max(relative ? 20 : 1, ...values.map(Math.abs));
  return <Card title={`Отклонение от цели · ${metric.title}`} subtitle="Сначала наибольшее отставание. Нажмите на имя для разбора.">
    {!rows.length ? <EmptyState title="Нет данных для сравнения" hint="Загрузите выбранный показатель за этот период." /> : <div className="analytics-deviations">
      <div className="analytics-deviation-axis"><span>Хуже цели ←</span><b>Цель</b><span>→ Лучше цели</span></div>
      {rows.map(({ person: p, assessment: a }, i) => <button className={`analytics-deviation analytics-signal--${a.signal}`} key={p.row.user_id} onClick={() => onOpen(p.row.user_id)}>
        <span className="analytics-deviation__name">{p.row.full_name}<small>{metricValue(p.row.values[metric.code], metric)}</small></span>
        <span className="analytics-deviation__plot" aria-hidden="true"><i /><b style={{ left: `${values[i] < 0 ? 50 - Math.abs(values[i]) / scale * 47 : 50}%`, width: `${Math.max(1, Math.abs(values[i]) / scale * 47)}%` }} /></span>
        <span className="analytics-deviation__value">{values[i] > 0 ? '+' : values[i] < 0 ? '−' : ''}{shortNumber(Math.abs(values[i]))}{relative ? '%' : ` ${metric.unit === '%' ? 'п.п.' : metric.unit ?? ''}`}</span>
        <span className="sr-only">{gapText(p.row.values[metric.code], metric)}</span>
      </button>)}
      <p className="analytics-muted">{relative ? 'Процент относительно цели: при цели 80 и факте 64 отставание составляет 20%.' : 'При нулевой цели показываем разницу в единицах показателя.'}</p>
    </div>}
  </Card>;
}

export function PriorityList({ people, onOpen, onAll }: { people: OperatorInsight[]; onOpen: (id: number) => void; onAll: () => void }) {
  const priority = people.filter(p => p.issues.length).slice(0, 5);
  return <Card title="С кем стоит разобраться в первую очередь" subtitle="Причины внимания видны сразу" action={<button className="btn btn--plain" onClick={onAll}>Все операторы →</button>}>
    {priority.length ? <div className="analytics-priority-list">{priority.map(p => <button key={p.row.user_id} onClick={() => onOpen(p.row.user_id)} className="analytics-priority">
      <span className={`analytics-person-avatar analytics-signal--${p.state === 'critical' ? 'critical' : 'watch'}`}>{p.row.full_name.split(' ').slice(0, 2).map(s => s[0]).join('')}</span>
      <span><strong>{p.row.full_name}</strong><small>{p.row.group_name ?? 'Без группы'}</small><span className="analytics-reasons">{p.issues.slice(0, 2).map(c => <span key={c.metric.code} className={`analytics-signal--${c.signal}`}>{c.metric.title}: {gapText(c.value, c.metric)}</span>)}</span></span><b aria-hidden="true">↗</b>
    </button>)}</div> : <EmptyState title="По загруженным данным отклонений нет" hint={people.some(p => p.state === 'missing' || p.state === 'partial') ? 'Часть показателей отсутствует — для полного вывода загрузите данные.' : 'Все доступные цели выполнены.'} />}
  </Card>;
}

export function DisciplineCard({ report, people, onOpen }: { report: AnalyticsOut; people: OperatorInsight[]; onOpen: (id: number) => void }) {
  const late = report.metrics.find(m => m.code === report.lateness_metric_code);
  const rows = late ? people.filter(p => p.late).sort((a, b) => b.row.values[late.code]! - a.row.values[late.code]!).slice(0, 6) : [];
  const maximum = late ? Math.max(1, ...rows.map(p => p.row.values[late.code]!)) : 1;
  return <Card title="Опоздания" subtitle={report.grain === 'month' ? 'Среднее за исходный период; месячная сумма не рассчитывается' : 'Количество событий по каждому оператору'}>
    {!late?.reported ? <EmptyState title="Данные об опозданиях отсутствуют" hint="Отсутствие записи не означает, что опозданий не было." /> : <>
      <div className="analytics-discipline-total"><strong>{people.filter(p => p.late).length}</strong><span>операторов с опозданиями<br /><small>Есть данные у {late.reported} из {late.total}</small></span></div>
      {rows.length ? <div className="analytics-late-list">{rows.map(p => <button key={p.row.user_id} onClick={() => onOpen(p.row.user_id)}><span>{p.row.full_name}</span><strong>{metricValue(p.row.values[late.code], late)}</strong><i style={{ width: `${p.row.values[late.code]! / maximum * 100}%` }} aria-hidden="true" /></button>)}</div> : <p className="analytics-muted">У операторов с данными опозданий нет.</p>}
      <p className="analytics-muted">{late.penalty_per_unit > 0 ? `В недельном расчёте каждое событие снижает результат на ${shortNumber(late.penalty_per_unit)} баллов.` : 'Опоздания выделены отдельно от выполнения рабочих целей.'}</p>
    </>}
  </Card>;
}

export function OperatorMatrix({ people, metrics, onOpen }: { people: OperatorInsight[]; metrics: MetricSummary[]; onOpen: (id: number) => void }) {
  const title = useId();
  return <div className="analytics-matrix-scroll" role="region" aria-labelledby={title} tabIndex={0}><span id={title} className="sr-only">Все показатели операторов, горизонтальная прокрутка</span><table className="table analytics-all-metrics"><thead><tr><th scope="col">Оператор</th>{metrics.map(m => <th scope="col" key={m.code}>{m.title}<small>{m.direction === 'lower_is_better' ? '≤' : '≥'} {metricValue(m.target, m)}</small></th>)}</tr></thead><tbody>{people.map(p => <tr key={p.row.user_id}><th scope="row"><button onClick={() => onOpen(p.row.user_id)}>{p.row.full_name}</button><small>{STATE_LABEL[p.state]}</small></th>{metrics.map(m => { const value = p.row.values[m.code]; const a = assess(value, m); return <td key={m.code}><span className={`analytics-matrix-cell analytics-signal--${a.signal}`} title={gapText(value, m)}>{a.signal === 'met' ? '✓' : a.signal === 'missing' ? '—' : '!'} {metricValue(value, m)}<small>{gapText(value, m)}</small></span></td>; })}</tr>)}</tbody></table></div>;
}

export function OperatorDetails({ person, report, metric, onMetric }: { person: OperatorInsight; report: AnalyticsOut; metric: MetricSummary; onMetric: (code: string) => void }) {
  const row = person.row;
  const previous = row.previous_values?.[metric.code], current = row.values[metric.code];
  return <div className="stack analytics-person-detail">
    <div className={`analytics-person-status analytics-state--${person.state}`}><strong>{STATE_LABEL[person.state]}</strong><span>{row.group_name ?? 'Без группы'} · {periodCaption(report)}</span></div>
    <div className="analytics-person-totals"><div><strong>{person.met}/{report.metrics.length}</strong><span>показателей в норме</span></div><div><strong>{person.improving} ↑ / {person.worsening} ↓</strong><span>стали лучше / хуже</span></div></div>
    <p className="analytics-muted">Есть данные по {person.reported} из {report.metrics.length} показателей. Рост и снижение сравниваются с предыдущим периодом; учитывается направление цели.</p>
    <label className="field"><span className="field__label">Показатель для графика</span><select className="input" value={metric.code} onChange={e => onMetric(e.target.value)}>{report.metrics.map(m => <option key={m.code} value={m.code}>{m.title}</option>)}</select></label>
    <Chart title={`${row.full_name} · ${metric.title}`} labels={report.trend.map(t => t.label)} series={[{ id: 'person', name: row.full_name, values: row.trends?.[metric.code] ?? row.trend }]} target={metric.target} unit={metric.unit} compact />
    <div className="analytics-person-comparison"><span>Предыдущий: <b>{metricValue(previous, metric)}</b></span><span>Текущий: <b>{metricValue(current, metric)}</b></span></div>
    <div className="analytics-person-metrics">{person.cells.map(c => <article key={c.metric.code} className={`analytics-person-metric analytics-signal--${c.signal}`}><header><strong>{c.metric.title}</strong><b>{metricValue(c.value, c.metric)}</b></header><p>{description(c.metric)}</p><GoalBar value={c.value} metric={c.metric} /><span>{gapText(c.value, c.metric)}</span></article>)}</div>
    {row.points !== null && <p className="analytics-muted">Итог недельного расчёта: {shortNumber(row.points)} баллов. Это конкурсные баллы, а не финансовый результат.</p>}
  </div>;
}
