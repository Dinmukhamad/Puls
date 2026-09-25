import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AccessLink as Link } from "../components/AccessLink";
import { useSearchParams } from "react-router-dom";

import { analytics, type AnalyticsGrain, type MetricSummary } from "../api/analytics";
import { rating } from "../api/endpoints";
import { lookups } from "../api/access";

import { Chart } from "../components/Chart";
import { GlassSurface } from "../components/GlassSurface";
import { Sheet } from "../components/Sheet";
import { Button, Card, EmptyState, ErrorState, KPISkeleton, Pagination, SegmentedControl } from "../components/ui";
import { signed, WEEK_STATUS_LABELS } from "../utils/format";
import { TeamPulse, TeamDistribution, MetricCards, DeviationChart, PriorityList, DisciplineCard, OperatorMatrix, OperatorDetails, GoalBar } from "./AnalyticsDashboard";
import { assess, description, gapText, metricValue, teamInsights, matchesFilter, periodCaption, STATE_LABEL, type OperatorInsight } from "./analyticsInsights";
import "./analytics.css";

const TABS = [{ value: "summary", label: "Обзор команды" }, { value: "operators", label: "Операторы" }, { value: "quality", label: "Все показатели" }];
const positiveInt = (value: string | null) => value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : undefined;
const GRAINS: { value: AnalyticsGrain; label: string }[] = [{ value: "day", label: "Дни" }, { value: "week", label: "Недели" }, { value: "month", label: "Месяцы" }];
/** Words for the selected step: the trend, the delta and the coverage hint follow it. */
export const GRAIN_TEXT: Record<AnalyticsGrain, { trend: string; delta: string; period: string; matrix: string }> = {
  day: { trend: "По дням выбранного диапазона", delta: "Изменение за день", period: "за день", matrix: "Матрица по дням" },
  week: { trend: "По неделям до выбранного периода", delta: "Изменение за неделю", period: "за неделю", matrix: "Матрица по неделям" },
  month: { trend: "По месяцам выбранного диапазона", delta: "Изменение за месяц", period: "за месяц", matrix: "Матрица по месяцам" },
};
const isDate = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
const isMonth = (value: string | null) => value && /^\d{4}-\d{2}$/.test(value) ? value : undefined;
const MAX_DAYS = 31;

export function useAnalyticsReport(overview = false) {
  const [params, setParams] = useSearchParams();
  const grain = (GRAINS.some((item) => item.value === params.get("grain")) ? params.get("grain") : "week") as AnalyticsGrain;
  // Days keep full dates in the URL, months keep "2026-08"; the API takes the first day of a month.
  const from = grain === "month" ? isMonth(params.get("from")) : isDate(params.get("from"));
  const to = grain === "month" ? isMonth(params.get("to")) : isDate(params.get("to"));
  const filters = {
    grain, week_id: grain === "week" && !from && !to ? positiveInt(params.get("week_id")) : undefined,
    date_from: from && (grain === "month" ? `${from}-01` : from), date_to: to && (grain === "month" ? `${to}-01` : to),
    group_id: positiveInt(params.get("group_id")), metric_code: params.get("metric") || undefined, operator_ids: params.get("operators") || undefined,
  };
  const data = useQuery({
    queryKey: ["analytics", overview ? "overview" : "report", filters],
    queryFn: ({ signal }) => overview ? analytics.overview(filters, signal) : analytics.summary(filters, signal),
    // Keep comparison controls open while adding people; never retain another group's or period's data.
    placeholderData: (previous, query) => {
      const before = query?.queryKey[2] as typeof filters | undefined;
      return before && before.grain === filters.grain && before.week_id === filters.week_id
        && before.date_from === filters.date_from && before.date_to === filters.date_to
        && before.group_id === filters.group_id ? previous : undefined;
    },
  });
  const weeks = useQuery({ queryKey: ["weeks"], queryFn: () => rating.weeks(100) });
  const groups = useQuery({ queryKey: ["lookup-groups"], queryFn: lookups.groups });
  function update(values: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
    setParams(next);
  }
  return { params, update, data, weeks, groups, filters };
}

export function MetricDelta({ value, improved, unit }: { value: number | null; improved: boolean | null; unit?: string | null }) {
  if (value === null) return <span className="analytics-muted">Нет сравнения</span>;
  if (value === 0) return <span className="analytics-muted">→ без изменений</span>;
  return <span className={`analytics-delta analytics-delta--${improved ? "positive" : "negative"}`}>{value > 0 ? "↑" : "↓"} {signed(Math.round(value * 100) / 100)}{unit === "%" ? " п.п." : unit ? ` ${unit}` : ""} · {improved ? "лучше" : "хуже"}</span>;
}

export function ReportFilters({ report, metric = true }: { report: ReturnType<typeof useAnalyticsReport>; metric?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const grain = report.filters.grain;
  const from = report.params.get("from") ?? "", to = report.params.get("to") ?? "";
  // A day range longer than a month is cut to its last 31 days instead of failing.
  function setDays(nextFrom: string, nextTo: string) {
    if (nextFrom && nextTo && (Date.parse(nextTo) - Date.parse(nextFrom)) / 864e5 >= MAX_DAYS) {
      const start = new Date(Date.parse(nextTo) - (MAX_DAYS - 1) * 864e5).toISOString().slice(0, 10);
      nextFrom = start;
    }
    report.update({ from: nextFrom || undefined, to: nextTo || undefined, page: undefined });
  }
  const fields = <>
    <div className="field analytics-grain"><span className="field__label">Показывать по</span><SegmentedControl label="Шаг периода" options={GRAINS} value={grain} onChange={(value) => report.update({ grain: value === "week" ? undefined : value, week_id: undefined, from: undefined, to: undefined, page: undefined })} /></div>
    {grain === "week" && <label className="field"><span className="field__label">Период</span><select className="input" value={report.filters.week_id ?? ""} onChange={(event) => report.update({ week_id: event.target.value, from: undefined, to: undefined, page: undefined })}>
      <option value="">Последняя неделя</option>{(report.weeks.data ?? []).map((week) => <option key={week.id} value={week.id}>{week.label} · {WEEK_STATUS_LABELS[week.status]}</option>)}
    </select></label>}
    {grain === "day" && <div className="analytics-range"><label className="field"><span className="field__label">С</span><input className="input" type="date" value={from} max={to || undefined} onChange={(event) => setDays(event.target.value, to)} /></label><label className="field"><span className="field__label">По · до {MAX_DAYS} дней</span><input className="input" type="date" value={to} min={from || undefined} onChange={(event) => setDays(from, event.target.value)} /></label></div>}
    {grain === "month" && <div className="analytics-range"><label className="field"><span className="field__label">С месяца</span><input className="input" type="month" value={from} max={to || undefined} onChange={(event) => report.update({ from: event.target.value || undefined, page: undefined })} /></label><label className="field"><span className="field__label">По месяц</span><input className="input" type="month" value={to} min={from || undefined} onChange={(event) => report.update({ to: event.target.value || undefined, page: undefined })} /></label></div>}
    <label className="field"><span className="field__label">Группа</span><select className="input" value={report.filters.group_id ?? ""} onChange={(event) => report.update({ group_id: event.target.value, operators: undefined, group_compare: undefined, page: undefined })}>
      <option value="">Все доступные</option>{(report.groups.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
    </select></label>
    {metric && <label className="field"><span className="field__label">Показатель</span><select className="input" value={report.data.data?.metric_code ?? report.filters.metric_code ?? ""} onChange={(event) => report.update({ metric: event.target.value, page: undefined })}>
      {!report.data.data?.metrics.length && <option value="">Нет показателей</option>}{(report.data.data?.metrics ?? []).map((item) => <option key={item.code} value={item.code}>{item.title}</option>)}
    </select></label>}
  </>;
  return <>
    <GlassSurface className="analytics-filters" variant="regular"><div className="analytics-filters__desktop">{fields}</div><div className="analytics-filters__mobile"><span>{report.data.data ? periodCaption(report.data.data) : "Выбрать период"}</span><Button onClick={() => setMobileOpen(true)}>Фильтры</Button></div></GlassSurface>
    {mobileOpen && <Sheet onClose={() => setMobileOpen(false)} title="Фильтры аналитики"><div className="stack">{fields}<Button variant="primary" onClick={() => setMobileOpen(false)}>Показать</Button></div></Sheet>}
    {(report.weeks.isError || report.groups.isError) && <p role="status" className="analytics-muted">Не удалось загрузить часть фильтров. <button className="analytics-text-button" onClick={() => { void report.weeks.refetch(); void report.groups.refetch(); }}>Повторить</button></p>}
  </>;
}

export function AnalyticsPage() {
  const report = useAnalyticsReport();
  const { data, params, update } = report;
  const value = data.data;
  const tab = TABS.some(item => item.value === params.get("tab")) ? params.get("tab")! : "summary";
  const metric = value?.metrics.find(item => item.code === value.metric_code);
  const [personId, setPersonId] = useState<number | null>(null);
  const [detailMetric, setDetailMetric] = useState<string | null>(null);
  const people = value ? teamInsights(value) : [];
  const person = people.find(p => p.row.user_id === personId);
  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "all";
  const filtered = people.filter(p => p.row.full_name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (!metric || matchesFilter(p, status, metric)));
  const size = 12;
  const page = Math.min(positiveInt(params.get("page")) ?? 1, Math.max(1, Math.ceil(filtered.length / size)));
  const rows = filtered.slice((page - 1) * size, page * size);
  const filterPeople = (status: string) => update({ tab: "operators", status, page: undefined });
  const late = value?.metrics.find(m => m.code === value.lateness_metric_code);
  const selectedOperators = (params.get("operators") ?? "").split(",").filter(Boolean).map(Number);
  const comparisonMode = params.get("compare") === "operators" ? "operators" : "groups";
  const selectedGroups = params.has("group_compare") ? (params.get("group_compare") ?? "").split(",").filter(Boolean).map(Number) : (value?.groups ?? []).slice(0, 3).map((group) => group.id);
  const comparisons = comparisonMode === "groups" ? value?.groups.filter((group) => selectedGroups.includes(group.id)) ?? [] : value?.comparisons ?? [];
  const comparisonControls = <>
    <SegmentedControl label="Сравнить" value={comparisonMode} options={[{ value: "groups", label: "Группы" }, { value: "operators", label: "Операторы" }]} onChange={(compare) => update({ compare })} />
    {comparisonMode === "groups" ? <fieldset className="analytics-selection"><legend>До 5 групп</legend>{(value?.groups ?? []).map((group) => <label key={group.id}><input type="checkbox" checked={selectedGroups.includes(group.id)} disabled={selectedGroups.length >= 5 && !selectedGroups.includes(group.id)} onChange={() => update({ group_compare: (selectedGroups.includes(group.id) ? selectedGroups.filter((id) => id !== group.id) : [...selectedGroups, group.id]).join(",") || "none" })} />{group.name}</label>)}</fieldset> : <div className="analytics-selection">
      <label className="field"><span className="field__label">Добавить оператора · до 5</span><select className="input" value="" disabled={selectedOperators.length >= 5} onChange={(event) => { if (event.target.value) update({ operators: [...selectedOperators, Number(event.target.value)].join(",") }); }}><option value="">Выберите сотрудника</option>{(value?.operators ?? []).filter((row) => !selectedOperators.includes(row.user_id)).map((row) => <option key={row.user_id} value={row.user_id}>{row.full_name}</option>)}</select></label>
      <div className="analytics-picks">{selectedOperators.map((id) => <Button key={id} size="s" onClick={() => update({ operators: selectedOperators.filter((item) => item !== id).join(",") })} aria-label={`Убрать ${value?.operators.find((row) => row.user_id === id)?.full_name ?? "оператора"} из сравнения`}>{value?.operators.find((row) => row.user_id === id)?.full_name ?? id} ×</Button>)}</div>
    </div>}
  </>;

  const rowFilters = <div className="analytics-row-filters">
    <label className="field"><span className="field__label">Найти оператора</span><input className="input" type="search" placeholder="Имя или фамилия" value={search} onChange={e => update({ search: e.target.value, page: undefined })} /></label>
    <label className="field"><span className="field__label">Показать</span><select className="input" value={status} onChange={e => update({ status: e.target.value, page: undefined })}>
      <option value="all">Всех операторов</option><option value="attention">Требуют внимания</option><option value="watch">Внимание, без сильного отставания</option><option value="critical">Отклонение от 20%</option><option value="ontrack">Выполняют все цели</option><option value="down">Есть ухудшение</option><option value="up">Есть улучшение</option><option value="late">Есть опоздания</option><option value="below">Не в норме: выбранный показатель</option><option value="missing">Нет части или всех данных</option><option value="partial">Неполные данные, без отклонений</option><option value="empty">Нет ни одного показателя</option>
    </select></label>
    {(status !== 'all' || search) && <Button onClick={() => update({ status: undefined, search: undefined, page: undefined })}>Сбросить</Button>}
  </div>;
  return <div className="stack analytics-page analytics-lead">
    <header className="page-head"><div><p className="analytics-eyebrow">ПУЛЬС КОМАНДЫ</p><h1 className="page-title">Аналитика руководителя</h1><p className="page-subtitle">Кто выполняет цели, где падает результат и кому нужна поддержка.</p></div><Button disabled={data.isFetching} onClick={() => void data.refetch()}>{data.isFetching ? 'Обновляем…' : 'Обновить данные'}</Button></header>
    <ReportFilters report={report} />
    {data.isLoading && <KPISkeleton />}
    {data.isError && <ErrorState error={data.error} onRetry={() => void data.refetch()} />}
    {value && !data.isError && <>
      {value.grain === 'week' && !value.week ? <EmptyState title="Периодов пока нет" hint="Загрузите показатели команды за неделю." action={<Link hideWhenDenied className="btn btn--primary" to="/admin/periods">Загрузить показатели</Link>} /> : !metric ? <EmptyState title="Показатели не настроены" hint="Добавьте показатели и цели в настройках системы." /> : <>
        <div className="analytics-snapshot"><strong>Результаты за {periodCaption(value)}</strong><span>Карточки — последний период диапазона · графики — весь диапазон</span>{value.week && value.week.status !== 'closed' && <span>Период ещё не закрыт: значения могут измениться</span>}</div>
        {value.grain === 'month' && <p className="analytics-period-note">Месячные значения усредняются по загруженным неделям, при их отсутствии — по дням. Опоздания здесь тоже показаны в среднем, а не суммой за месяц.</p>}
        <TeamPulse people={people} lateAvailable={!!late?.reported} onFilter={filterPeople} />
        {tab === 'summary' && <>
          <div className="analytics-dashboard-grid"><TeamDistribution people={people} onFilter={filterPeople} />
            <Card title={`Динамика · ${metric.title}`} subtitle={`${description(metric)} ${metric.direction === 'lower_is_better' ? 'Снижение — улучшение.' : 'Рост — улучшение.'}`}>
              <div className="analytics-trend-reading"><strong>{metricValue(metric.value, metric)}</strong><span className={`analytics-signal-text analytics-signal--${assess(metric.value, metric).signal}`}>{gapText(metric.value, metric)}</span><MetricDelta value={metric.delta} improved={metric.improved} unit={metric.unit} /></div>
              <Chart compact title={metric.title} labels={value.trend.map(t => t.label)} series={[{ id: 'team', name: 'Среднее команды', values: value.trend.map(t => t.value) }]} target={metric.target} unit={metric.unit} />
              <p className="analytics-muted">Среднее может скрывать отставание отдельных операторов. Смотрите распределение и список ниже.</p>
            </Card>
          </div>
          <div className="analytics-section-heading"><div><h2>Все цели на одном экране</h2><p>Нажмите на показатель, чтобы посмотреть его динамику и отклонения.</p></div><span>Вертикальная отметка на шкале — цель</span></div>
          <MetricCards report={value} selected={metric.code} onSelect={metric => update({ metric })} />
          <div className="analytics-dashboard-grid"><DeviationChart people={people} metric={metric} onOpen={setPersonId} /><DisciplineCard report={value} people={people} onOpen={setPersonId} /></div>
          <PriorityList people={people} onOpen={setPersonId} onAll={() => filterPeople('attention')} />
          <details className="analytics-comparison-panel"><summary>Сравнить группы или нескольких операторов</summary><div className="stack">{comparisonControls}{comparisons.length ? <Chart title={`Сравнение: ${metric.title}`} labels={value.trend.map(t => t.label)} series={comparisons.map(item => ({ id: String(item.id), name: item.name, values: item.values }))} target={metric.target} unit={metric.unit} /> : <EmptyState title="Выберите участников сравнения" hint="До пяти групп или операторов одновременно." />}</div></details>
        </>}
        {tab !== 'summary' && <>
          {rowFilters}
          <div className="analytics-section-heading"><div><h2>{tab === 'quality' ? 'Матрица целей команды' : 'Операторы и причины внимания'}</h2><p>{filtered.length} операторов · сначала наиболее сильные отклонения</p></div></div>
          {!filtered.length ? <EmptyState title={people.length ? 'Нет операторов по этим условиям' : 'В команде пока нет действующих операторов'} hint="Измените группу, поиск или фильтр." /> : <Card padded={false}>
            {tab === 'quality' ? <OperatorMatrix people={rows} metrics={value.metrics} onOpen={setPersonId} /> : <OperatorList people={rows} metric={metric} onOpen={setPersonId} />}
            <Pagination page={page} size={size} total={filtered.length} onChange={page => update({ page: String(page) })} />
          </Card>}
        </>}
        <details className="analytics-method-card"><summary>Как читать цвета и показатели</summary><div className="analytics-method-content"><p><b>Зелёный</b> — цель выполнена. <b>Жёлтый</b> — есть отклонение или нежелательное событие. <b>Оранжевый</b> — отклонение от 10%, <b>красный</b> — от 20% относительно цели. <b>Серый</b> — данных не хватает.</p><p>Для показателей «меньше — лучше» превышение цели означает ухудшение. Разница процентных показателей указывается в процентных пунктах, отклонение на шкале — в процентах от цели. При нулевой цели процент не рассчитывается.</p><p>Опоздания и другие штрафные показатели требуют внимания при любом положительном значении. Статусы помогают найти проблемы и не меняют правила начисления баллов. «Выполняют все цели» означает наличие всех активных показателей и отсутствие отклонений.</p><p>Карточки внимания, ухудшения и опозданий могут включать одних и тех же людей. Цели берутся из действующих настроек; сравниваются соседние периоды, без подстановки нулей вместо пропусков.</p><p>{value.methodology}</p></div></details>
      </>}
    </>}
    {person && value && metric && <Sheet title={person.row.full_name} onClose={() => setPersonId(null)}><OperatorDetails person={person} report={value} metric={value.metrics.find(m => m.code === detailMetric) ?? metric} onMetric={setDetailMetric} /></Sheet>}
  </div>;
}

function OperatorList({ people, metric, onOpen }: { people: OperatorInsight[]; metric: MetricSummary; onOpen: (id: number) => void }) {
  return <div className="analytics-people-list">{people.map(p => <article className="analytics-person-row" key={p.row.user_id}>
    <div className="analytics-person-row__identity"><button className="analytics-person-name" onClick={() => onOpen(p.row.user_id)}>{p.row.full_name}<span aria-hidden="true"> ↗</span></button><span>{p.row.group_name ?? 'Без группы'}</span><strong className={`analytics-state analytics-state--${p.state}`}>{STATE_LABEL[p.state]}</strong><small>В норме: {p.met}/{p.cells.length} · нет данных: {p.cells.length - p.reported}</small></div>
    <div className="analytics-person-row__goal"><span>{metric.title}</span><GoalBar value={p.row.values[metric.code] ?? null} metric={metric} /><b className={`analytics-signal-text analytics-signal--${assess(p.row.values[metric.code], metric).signal}`}>{gapText(p.row.values[metric.code], metric)}</b></div>
    <div className="analytics-person-row__reasons"><span className="analytics-reasons">{p.issues.slice(0, 3).map(c => <span className={`analytics-signal--${c.signal}`} key={c.metric.code}>{c.metric.title}: {metricValue(c.value, c.metric)} · {gapText(c.value, c.metric)}</span>)}</span>{!p.issues.length && <span className="analytics-muted">{p.reported < p.cells.length ? 'Нужно загрузить недостающие показатели' : 'Все цели выполнены, нарушений нет'}</span>}<small>Улучшились: {p.improving} · ухудшились: {p.worsening}</small><button className="analytics-text-button" onClick={() => onOpen(p.row.user_id)}>Разобрать показатели →</button></div>
  </article>)}</div>;
}
