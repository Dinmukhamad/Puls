import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { analytics, type AnalyticsFilters, type AnalyticsOut, type MetricSummary } from '../api/analytics';
import { lookups } from '../api/access';
import { useAuth } from '../auth/AuthContext';
import { hiddenDashboards } from '../navigation';
import { AccessLink } from '../components/AccessLink';
import { Chart } from '../components/Chart';
import { ArrowUpRightIcon } from '../components/icons';
import { DateRangePicker } from '../components/DateRangePicker';
import { formatDateRange, todayDateKey, validDateRange } from '../components/dateRange';
import { GlassSurface } from '../components/GlassSurface';
import { Sheet } from '../components/Sheet';
import { Button, Card, EmptyState, ErrorState, KPISkeleton, Pagination, SegmentedControl, Select } from '../components/ui';
import { TeamDistribution, PriorityList, OperatorMatrix, OperatorDetails, GoalBar, Sparkline } from './AnalyticsDashboard';
import { FourWeekTable, GroupDashboard, CategoryDashboard } from './AnalyticsPanels';
import { analyticsChannel, categoryMetrics, channelCategories, completedWeekWindow, selectedPeriodReport, weekWindow, type AnalyticsCategory, type AnalyticsChannel } from './analyticsWorkspace';
import { assess, gapText, metricValue, teamInsights, matchesFilter, periodCaption, STATE_LABEL, type OperatorInsight } from './analyticsInsights';
import './analytics.css';
import './management-analytics.css';

const integer = (value: string | null) => value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : undefined;
const DASHBOARDS = ['summary', 'weeks', 'groups', 'quality', 'productivity', 'discipline', 'operators'];
/** Each channel's own dashboards: chats' productivity shows once their hours or response time are loaded (docs/CHANNELS.md). */
const SHORTCUTS: Record<AnalyticsChannel, { tab: AnalyticsCategory; title: string; hint: string; metric: string }[]> = {
  line: [
    { tab: 'quality', title: 'Качество', hint: 'Качество звонков и благодарности водителей', metric: 'quality' },
    { tab: 'productivity', title: 'Производительность', hint: 'Эффективность, звонки в час и рабочее время', metric: 'efficiency' },
    { tab: 'discipline', title: 'Дисциплина', hint: 'Опоздания и другие нежелательные события', metric: 'lateness' },
  ],
  chat: [
    { tab: 'quality', title: 'Качество', hint: 'Качество ответов в чатах', metric: 'chat_quality' },
    { tab: 'productivity', title: 'Производительность', hint: 'Норма часов, переработки и время ответа', metric: 'chat_hours_norm' },
    { tab: 'discipline', title: 'Дисциплина', hint: 'Опоздания и другие нежелательные события', metric: 'lateness' },
  ],
};

/** Explicit four-week windows avoid mixing a partial week with completed weeks. */
export function useManagementAnalytics() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const candidate = { date_from: params.get('from') ?? '', date_to: params.get('to') ?? '' };
  const chosen = validDateRange(candidate) && candidate.date_from >= '1900-01-01'
    && candidate.date_to <= '9998-12-31' ? candidate : undefined;
  // Old bookmarks and summary links keep their original whole-range meaning.
  const mode = chosen && params.get('window') !== 'weeks' ? 'range' : 'weeks';
  const range = chosen ? mode === 'weeks' ? weekWindow(chosen.date_to) : chosen : completedWeekWindow(todayDateKey());
  const channel = analyticsChannel(params.get('channel'));
  const filters: AnalyticsFilters = {
    grain: mode === 'weeks' ? 'week' : 'range', ...range,
    group_id: integer(params.get('group_id')),
    metric_code: params.get('metric') || undefined,
    operator_ids: params.get('operators') || undefined,
    channel,
  };
  const data = useQuery({ queryKey: ['management-analytics', user?.id, filters, user?.role], queryFn: ({ signal }) => analytics.summary(filters, signal), enabled: !!user });
  const groups = useQuery({ queryKey: ['management-groups', user?.id, user?.role], queryFn: lookups.groups, enabled: !!user });
  const weeklyRange = weekWindow(range.date_to);
  const weeklyFilters: AnalyticsFilters = { ...filters, ...weeklyRange, grain: 'week' };
  const weekly = useQuery({ queryKey: ['management-weeks', user?.id, weeklyFilters, user?.role], queryFn: ({ signal }) => analytics.summary(weeklyFilters, signal), enabled: !!user && mode === 'range' });
  const update = (values: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
    for (const key of ['grain', 'week_id']) next.delete(key);
    setParams(next);
  };
  const setRange = (next: typeof range, window: 'range' | 'weeks') => update({ from: next.date_from, to: next.date_to, window, page: undefined });
  // Another channel has other operators and metrics: the picks of this one do not carry over.
  const setChannel = (next: AnalyticsChannel) => update({ channel: next === 'chat' ? 'chat' : undefined, metric: undefined, operators: undefined, status: undefined, page: undefined });
  return { user, params, update, filters, mode, range, setRange, channel, setChannel, data, groups, weekly: mode === 'weeks' ? data : weekly, weeklyRange };
}

export function ManagementAnalyticsPage() {
  const report = useManagementAnalytics();
  const { user, params, update, data, channel } = report;
  const head = user?.role === 'head' || user?.role === 'admin';
  const requested = params.get('tab') ?? 'summary';
  const value = data.isError || !data.data ? undefined : selectedPeriodReport(data.data);
  const categories = channelCategories(channel, !!value && categoryMetrics(value, 'productivity').length > 0);
  const tab = DASHBOARDS.includes(requested) && (requested !== 'groups' || head) && (requested !== 'productivity' || categories.includes('productivity')) ? requested : 'summary';
  const noProductivity = !categories.includes('productivity');
  // The section menu leaves out a dashboard the open channel has nothing for.
  useEffect(() => { hiddenDashboards.set(noProductivity ? ['productivity'] : []); }, [noProductivity]);
  useEffect(() => () => hiddenDashboards.set([]), []);
  const category = (categories as string[]).includes(tab) ? tab as AnalyticsCategory : undefined;
  const chats = channel === 'chat';
  const shortcuts = SHORTCUTS[channel].filter(item => categories.includes(item.tab));
  const selectableMetrics = value ? category ? categoryMetrics(value, category) : value.metrics : [];
  const metric = selectableMetrics.find(item => item.code === value?.metric_code) ?? selectableMetrics[0] ?? value?.metrics[0];
  const weekly = report.weekly.isError ? undefined : report.weekly.data;
  const [personId, setPersonId] = useState<number | null>(null);
  const [detailMetric, setDetailMetric] = useState<string | null>(null);
  const people = value ? teamInsights(value) : [];
  const person = people.find(p => p.row.user_id === personId);
  const search = params.get('search') ?? '';
  const status = params.get('status') ?? 'all';
  const unassigned = head && params.get('unassigned') === '1';
  const filtered = people.filter(p => p.row.full_name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    && (!metric || matchesFilter(p, status, metric)) && (!unassigned || p.row.group_id === null));
  const pageSize = 12;
  const page = Math.min(integer(params.get('page')) ?? 1, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const matrix = params.get('view') === 'matrix';
  const onMetric = (code: string) => update({ metric: code, page: undefined });
  const filterPeople = (next: string) => update({ tab: 'operators', status: next, page: undefined, search: undefined, unassigned: undefined });
  const openPerson = (id: number) => { setDetailMetric(null); setPersonId(id); };
  const onGroup = (id: number | null) => update({ group_id: id === null ? undefined : String(id), unassigned: id === null ? '1' : undefined, operators: undefined, search: undefined, status: undefined, page: undefined, tab: 'operators' });
  const selectedOperators = [...new Set((params.get('operators') ?? '').split(',').map(Number).filter(id => id > 0))];
  const today = todayDateKey();
  const hasGroupFilter = head || (report.groups.data?.length ?? 0) > 1 || !!report.filters.group_id;
  const labels = (r: AnalyticsOut) => r.trend.map(t => r.grain === 'week' ? `${t.starts_on.slice(8)}.${t.starts_on.slice(5, 7)}` : t.label);

  const fourWeeks = <>
    {report.weekly.isLoading && <KPISkeleton count={4} />}
    {report.weekly.isError && <ErrorState error={report.weekly.error} onRetry={() => void report.weekly.refetch()} />}
    {weekly && <FourWeekTable report={weekly} onMetric={onMetric} />}
  </>;

  return <div className="stack analytics-page analytics-lead management-analytics">
    <header className="page-head ma-heading"><div><p className="analytics-eyebrow">ПУЛЬС КОМАНДЫ</p><h1 className="page-title">{head ? 'Аналитика руководителя' : 'Аналитика супервайзера'}</h1><p className="page-subtitle">{head ? 'Все команды, динамика результатов и точки внимания.' : 'Результаты вашей команды и операторы, которым нужна поддержка.'}</p></div><div className="ma-heading-actions"><SegmentedControl label="Направление" value={channel} options={[{ value: 'line', label: 'Линия' }, { value: 'chat', label: 'Чаты' }]} onChange={report.setChannel} /><Button size="s" disabled={data.isFetching || report.weekly.isFetching} onClick={() => { void data.refetch(); if (report.mode === 'range') void report.weekly.refetch(); void report.groups.refetch(); }}>{data.isFetching || report.weekly.isFetching ? 'Обновляем…' : 'Обновить'}</Button></div></header>

    <GlassSurface className={`ma-filters${hasGroupFilter ? '' : ' ma-filters--single-group'}`} variant="regular">
      <div className="field ma-period-control">
        <span className="field__label">Период</span>
        <DateRangePicker value={report.range} onChange={next => report.setRange(next, 'range')} />
      </div>
      {hasGroupFilter && <label className="field ma-group-filter"><span className="field__label">{head ? 'Группа' : 'Мои группы'}</span><Select aria-label={head ? 'Группа' : 'Мои группы'} value={report.filters.group_id ?? ''} options={[{ value: '', label: head ? 'Все группы' : 'Все мои группы' }, ...(report.groups.data ?? []).map(g => ({ value: g.id, label: g.name }))]} onChange={id => update({ group_id: id, operators: undefined, unassigned: undefined, search: undefined, status: undefined, page: undefined })} /></label>}
      <label className="field ma-metric-filter"><span className="field__label">Показатель для сравнения</span><Select aria-label="Показатель для сравнения" value={selectableMetrics.length ? metric?.code ?? '' : ''} options={selectableMetrics.length ? selectableMetrics.map(m => ({ value: m.code, label: m.title })) : [{ value: '', label: category ? 'Показателей категории пока нет' : 'Показателей пока нет' }]} onChange={onMetric} /></label>
    </GlassSurface>
    {report.groups.isError && <p className="analytics-muted" role="status">Не удалось загрузить группы. <button className="analytics-text-button" onClick={() => void report.groups.refetch()}>Повторить</button></p>}
    {data.isLoading && <KPISkeleton count={4} />}
    {data.isError && <><ErrorState error={data.error} onRetry={() => void data.refetch()} /><Button onClick={() => update({ group_id: undefined, operators: undefined, metric: undefined, from: undefined, to: undefined, window: undefined })}>Сбросить фильтры</Button></>}

    {value && <>
      <div className="ma-reading"><span><b>{report.mode === 'weeks' ? `Карточки: ${periodCaption(value)}` : `Период: ${periodCaption(value)}`}</b><small>{report.mode === 'weeks' ? 'Карточки — последняя неделя; изменение — к предыдущей. Таблица — все четыре недели.' : 'Карточки — среднее за выбранный период; изменение — к такому же периоду до него.'}</small></span><span className="ma-reading-scope">{report.filters.group_id ? report.groups.data?.find(g => g.id === report.filters.group_id)?.name ?? 'Выбранная группа' : head ? 'Охват всей организации' : 'Только закреплённые группы'}</span></div>
      {(value.week && value.week.status !== 'closed' || report.range.date_to >= today) && <p className="analytics-period-note">{report.range.date_to >= today ? 'Период ещё не завершён. ' : ''}{value.week && value.week.status !== 'closed' ? 'Последняя неделя не закрыта. ' : ''}Показатели могут измениться.</p>}
      <ScopePulse report={value} people={people} head={head} onFilter={filterPeople} />
      {!value.operator_count && (chats
        ? <EmptyState title={head ? 'Операторов чатов в выбранном охвате пока нет' : 'В ваших группах пока нет операторов чатов'} hint="Направление оператора меняют в «Команда → Изменить»." />
        : <EmptyState title={head ? 'Операторов в выбранном охвате пока нет' : 'В ваших группах пока нет операторов'} hint={head ? 'Выберите другую группу или добавьте операторов в команду.' : 'Здесь появятся показатели операторов закреплённых за вами групп.'} />)}
      {value.operator_count > 0 && !value.operators_with_data && <div className="ma-empty-notice"><strong>За этот период показателей нет</strong><span>Выберите другие даты или загрузите показатели. Пропуски не считаются нулями.</span><AccessLink hideWhenDenied to="/admin/periods" className="analytics-text-button">Открыть периоды →</AccessLink></div>}
      {!metric && <EmptyState title="Показатели не настроены" hint="Добавьте рабочие показатели и цели в настройках системы." />}

      {metric && tab === 'summary' && <>
        {fourWeeks}
        <div className={`ma-shortcuts ma-shortcuts--${shortcuts.length}`}>{shortcuts.map(item => {
          const m = value.metrics.find(m => m.code === (item.tab === 'discipline' ? value.lateness_metric_code : item.metric)) ?? categoryMetrics(value, item.tab)[0];
          return <button className="ma-shortcut" key={item.tab} onClick={() => update({ tab: item.tab, metric: m?.code })}><span><strong>{item.title}</strong><ArrowUpRightIcon size={16} /></span><small>{item.hint}</small><div className="ma-shortcut-value">{m ? metricValue(m.value, m) : 'Нет показателей'}</div><Sparkline values={m?.trend ?? []} /><span className="ma-shortcut-footer">Открыть дашборд →</span></button>;
        })}</div>
        {head ? <GroupDashboard report={value} metric={metric} onGroup={onGroup} compact onAll={() => update({ tab: 'groups' })} /> : <PriorityList people={people} onOpen={openPerson} onAll={() => filterPeople('attention')} />}
        <div className="ma-overview-bottom"><TeamDistribution people={people} onFilter={filterPeople} /><Card title={head ? 'От команды к каждому оператору' : 'Фокус на своей команде'} subtitle="Результат складывается из отдельных показателей"><div className="stack"><p className="analytics-muted">{head ? 'Сравнивайте команды, находите отклонения и переходите к показателям сотрудников.' : 'Графики и сравнения включают только операторов групп, которыми вы управляете.'}</p><Button onClick={() => update({ tab: 'operators', view: 'matrix', status: undefined, page: undefined })}>Открыть матрицу показателей →</Button><Button variant="plain" onClick={() => filterPeople('missing')}>Проверить полноту данных →</Button></div></Card></div>
      </>}

      {metric && tab === 'weeks' && <>
        <div className="analytics-section-heading"><div><h2>Четыре недели в деталях</h2><p>{formatDateRange(report.weeklyRange)} · недели с понедельника по воскресенье</p></div></div>
        {report.mode === 'range' && <p className="analytics-period-note">Недельное сравнение заканчивается неделей, в которую входит последняя дата выбранного периода. Карточки выше сохраняют среднее за выбранный период.</p>}
        {fourWeeks}
        {weekly && <Card title={`Динамика · ${metric.title}`} subtitle="Среднее по загруженным значениям операторов"><Chart title={metric.title} labels={labels(weekly)} series={[{ id: 'team', name: head ? 'Выбранные команды' : 'Моя команда', values: weekly.metrics.find(m => m.code === metric.code)?.trend ?? [] }]} target={weekly.metrics.find(m => m.code === metric.code)?.target} unit={metric.unit} /></Card>}
      </>}
      {metric && tab === 'groups' && head && <GroupDashboard report={value} metric={metric} onGroup={onGroup} />}
      {metric && category && <CategoryDashboard report={value} category={category} channel={channel} selected={metric.code} onMetric={onMetric} onOpen={openPerson} />}

      {metric && tab === 'operators' && <>
        <div className="analytics-section-heading"><div><h2>{head ? 'Операторы' : 'Операторы моей команды'}</h2><p>{filtered.length} из {people.length} · сначала наиболее сильные отклонения</p></div><SegmentedControl label="Представление операторов" value={matrix ? 'matrix' : 'list'} options={[{ value: 'list', label: 'Причины внимания' }, { value: 'matrix', label: 'Матрица целей' }]} onChange={view => update({ view })} /></div>
        <div className="analytics-row-filters"><label className="field"><span className="field__label">Найти оператора</span><input className="input" type="search" placeholder="Имя или фамилия" value={search} onChange={e => update({ search: e.target.value, page: undefined })} /></label><label className="field"><span className="field__label">Показать</span><Select aria-label="Состояние операторов" value={status} options={[{ value: 'all', label: 'Всех операторов' }, { value: 'attention', label: 'Требуют внимания' }, { value: 'critical', label: 'Сильное отставание' }, { value: 'ontrack', label: 'Выполняют все цели' }, { value: 'down', label: 'Есть ухудшение' }, { value: 'up', label: 'Есть улучшение' }, { value: 'late', label: 'Есть опоздания' }, { value: 'below', label: 'Не в норме: выбранный показатель' }, { value: 'missing', label: 'Неполные данные' }, { value: 'empty', label: 'Нет показателей' }]} onChange={next => update({ status: next, page: undefined })} /></label>{(search || status !== 'all' || unassigned) && <Button onClick={() => update({ search: undefined, status: undefined, unassigned: undefined, page: undefined })}>Сбросить{unassigned ? ' «Без группы»' : ''}</Button>}</div>
        {!filtered.length ? <EmptyState title="Нет операторов по этим условиям" hint="Измените поиск, группу или состояние." /> : <Card padded={false}>{matrix ? <OperatorMatrix people={filtered.slice((page - 1) * pageSize, page * pageSize)} metrics={value.metrics} onOpen={openPerson} /> : <OperatorList people={filtered.slice((page - 1) * pageSize, page * pageSize)} metric={metric} onOpen={openPerson} />}<Pagination page={page} size={pageSize} total={filtered.length} onChange={next => update({ page: String(next) })} /></Card>}
        <Card title="Сравнение операторов" subtitle="До пяти сотрудников. Выбранный показатель и период общие для всех."><div className="stack"><label className="field"><span className="field__label">Добавить оператора</span><Select aria-label="Добавить оператора в сравнение" value="" disabled={selectedOperators.length >= 5} options={[{ value: '', label: 'Выберите сотрудника' }, ...value.operators.filter(p => !selectedOperators.includes(p.user_id)).map(p => ({ value: p.user_id, label: p.full_name }))]} onChange={id => { if (id) update({ operators: [...selectedOperators, Number(id)].join(',') }); }} /></label><div className="analytics-picks">{selectedOperators.map(id => <Button size="s" key={id} aria-label={`Убрать ${value.operators.find(p => p.user_id === id)?.full_name ?? 'оператора'} из сравнения`} onClick={() => update({ operators: selectedOperators.filter(n => n !== id).join(',') })}>{value.operators.find(p => p.user_id === id)?.full_name ?? 'Оператор'} ×</Button>)}</div>{value.comparisons.length ? <Chart title={`Сравнение · ${metric.title}`} labels={labels(value)} series={value.comparisons.map(p => ({ id: String(p.id), name: p.name, values: p.values }))} target={metric.target} unit={metric.unit} /> : <p className="analytics-muted">Добавьте операторов, чтобы сопоставить их динамику.</p>}</div></Card>
      </>}
      <details className="analytics-method-card"><summary>Как считаются показатели и сравнения</summary><div className="analytics-method-content"><p>Пока период не выбран, показаны четыре последние закрытые недели: карточки относятся к последней неделе и сравниваются с предыдущей, в недельной таблице изменение — последняя неделя к первой. Выбранный период показывает средние значения и сравнение с равным периодом до него.</p><p>Пропуски остаются пропусками. Разница процентных показателей указана в процентных пунктах. Направление улучшения и цели берутся из настроек. Полнота — доля заполненных значений среди всех ожидаемых показателей операторов.</p><p>«Выполняют все цели» — все активные показатели загружены, цели достигнуты и нарушений нет. Сильное отставание — отклонение от цели на 20% и более. Карточки внимания и ухудшения могут включать одних и тех же операторов.</p><p>Линия и чаты смотрятся отдельно: у каждого направления свои операторы и рабочие показатели, дисциплина общая. Полнота данных и «все цели» считаются по показателям своего направления.</p><p>{value.methodology}</p></div></details>
    </>}
    {person && value && metric && <Sheet title={person.row.full_name} onClose={() => setPersonId(null)}><div className="analytics-lead management-analytics"><OperatorDetails person={person} report={value} metric={value.metrics.find(m => m.code === detailMetric) ?? metric} onMetric={setDetailMetric} /></div></Sheet>}
  </div>;
}

function ScopePulse({ report, people, head, onFilter }: { report: AnalyticsOut; people: OperatorInsight[]; head: boolean; onFilter: (status: string) => void }) {
  const expected = report.operator_count * report.metrics.length;
  const filled = report.metrics.reduce((total, m) => total + m.reported, 0);
  const cards = [
    { label: head ? 'Операторы в охвате' : 'Операторы моей команды', value: report.operator_count, note: 'Действующие операторы', tone: 'missing', filter: 'all', icon: '◎' },
    { label: 'Выполняют все цели', value: people.filter(p => p.state === 'ontrack').length, note: 'Все показатели загружены и в норме', tone: 'met', filter: 'ontrack', icon: '✓' },
    { label: 'Требуют внимания', value: people.filter(p => p.issues.length).length, note: 'Есть отклонения или нарушения', tone: 'watch', filter: 'attention', icon: '!' },
    { label: 'Полнота данных', value: expected ? `${Math.round(filled / expected * 100)}%` : '—', note: expected ? `${filled} из ${expected} значений · за период карточек` : 'Нет ожидаемых значений', tone: 'missing', filter: 'missing', icon: '▤' },
  ];
  return <div className="ma-pulse">{cards.map(c => <button key={c.filter} className={`ma-pulse-card analytics-signal--${c.tone}`} onClick={() => onFilter(c.filter)}><span>{c.label}<i aria-hidden="true">{c.icon}</i></span><strong>{c.value}</strong><small>{c.note}</small></button>)}</div>;
}

function OperatorList({ people, metric, onOpen }: { people: OperatorInsight[]; metric: MetricSummary; onOpen: (id: number) => void }) {
  return <div className="analytics-people-list">{people.map(p => <article className="analytics-person-row" key={p.row.user_id}>
    <div className="analytics-person-row__identity"><button className="analytics-person-name" onClick={() => onOpen(p.row.user_id)}>{p.row.full_name}<ArrowUpRightIcon size={14} /></button><span>{p.row.group_name ?? 'Без группы'}</span><strong className={`analytics-state analytics-state--${p.state}`}>{STATE_LABEL[p.state]}</strong><small>В норме: {p.met}/{p.cells.length} · нет данных: {p.cells.length - p.reported}</small></div>
    <div className="analytics-person-row__goal"><span>{metric.title}</span><GoalBar value={p.row.values[metric.code] ?? null} metric={metric} /><b className={`analytics-signal-text analytics-signal--${assess(p.row.values[metric.code], metric).signal}`}>{gapText(p.row.values[metric.code], metric)}</b></div>
    <div className="analytics-person-row__reasons"><span className="analytics-reasons">{p.issues.slice(0, 3).map(c => <span className={`analytics-signal--${c.signal}`} key={c.metric.code}>{c.metric.title}: {metricValue(c.value, c.metric)} · {gapText(c.value, c.metric)}</span>)}</span>{!p.issues.length && <span className="analytics-muted">{p.reported < p.cells.length ? 'Нужно загрузить недостающие показатели' : 'Все цели выполнены, нарушений нет'}</span>}<small>Улучшились: {p.improving} · ухудшились: {p.worsening}</small><button className="analytics-text-button" onClick={() => onOpen(p.row.user_id)}>Разобрать показатели →</button></div>
  </article>)}</div>;
}
