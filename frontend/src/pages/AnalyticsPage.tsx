import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AccessLink as Link } from "../components/AccessLink";
import { useSearchParams } from "react-router-dom";

import { analytics, type AnalyticsOut, type MetricSummary } from "../api/analytics";
import { lookups } from "../api/access";

import { Chart } from "../components/Chart";
import { DateRangePicker } from "../components/DateRangePicker";
import { validDateRange, type DateRangePreset } from "../components/dateRange";
import { GlassSurface } from "../components/GlassSurface";
import { Sheet } from "../components/Sheet";
import { Button, Card, EmptyState, ErrorState, KPISkeleton, Pagination, SegmentedControl, Select } from "../components/ui";
import { signed } from "../utils/format";
import { TeamPulse, TeamDistribution, MetricCards, DeviationChart, PriorityList, DisciplineCard, OperatorMatrix, OperatorDetails, GoalBar } from "./AnalyticsDashboard";
import { assess, description, gapText, metricValue, teamInsights, matchesFilter, periodCaption, STATE_LABEL, type OperatorInsight } from "./analyticsInsights";
import "./analytics.css";

const TABS = [{ value: "summary", label: "Обзор команды" }, { value: "operators", label: "Операторы" }, { value: "quality", label: "Все показатели" }];
const positiveInt = (value: string | null) => value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : undefined;
const isDate = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
/** Analytics reads whole weeks first: the contest is weekly. */
export const ANALYTICS_PRESETS: readonly DateRangePreset[] = ["this-week", "last-week", "this-month", "last-month", "ten-days"];

/**
 * One date filter instead of days, weeks and months: the manager picks any
 * dates, and the server averages the whole range and picks the chart step.
 * Without dates the report shows the latest contest week.
 */
export function useAnalyticsReport(overview = false) {
  const [params, setParams] = useSearchParams();
  const from = isDate(params.get("from")), to = isDate(params.get("to"));
  const chosen = from && to ? { date_from: from, date_to: to } : undefined;
  const range = validDateRange(chosen) ? chosen : undefined;
  const filters = {
    grain: "range" as const, date_from: range?.date_from, date_to: range?.date_to,
    // The summary has no group filter: it always covers everyone the viewer may see.
    group_id: overview ? undefined : positiveInt(params.get("group_id")),
    metric_code: params.get("metric") || undefined, operator_ids: params.get("operators") || undefined,
  };
  const data = useQuery({
    queryKey: ["analytics", overview ? "overview" : "report", filters],
    queryFn: ({ signal }) => overview ? analytics.overview(filters, signal) : analytics.summary(filters, signal),
    // Keep comparison controls open while adding people; never retain another group's or period's data.
    placeholderData: (previous, query) => {
      const before = query?.queryKey[2] as typeof filters | undefined;
      return before && before.date_from === filters.date_from && before.date_to === filters.date_to
        && before.group_id === filters.group_id ? previous : undefined;
    },
  });
  const groups = useQuery({ queryKey: ["lookup-groups"], queryFn: lookups.groups, enabled: !overview });
  // The picker shows the range the server actually used, including the default week.
  const shown = range ?? (data.data?.custom_range && data.data.period_from && data.data.period_to ? { date_from: data.data.period_from, date_to: data.data.period_to } : undefined);
  function update(values: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
    // Old links may still carry the removed day/week/month step.
    for (const key of ["grain", "week_id"]) next.delete(key);
    setParams(next);
  }
  return { params, update, data, groups, filters, range: shown };
}

/** The only period control: any dates, applied as one range. */
export function ReportPeriod({ report, label }: { report: ReturnType<typeof useAnalyticsReport>; label?: string }) {
  return <DateRangePicker className="analytics-period" ariaLabel={label ?? "Период"} value={report.range} loading={report.data.isLoading} presets={ANALYTICS_PRESETS}
    onChange={(next) => report.update({ from: next.date_from, to: next.date_to, page: undefined })} />;
}

export function MetricDelta({ value, improved, unit }: { value: number | null; improved: boolean | null; unit?: string | null }) {
  if (value === null) return <span className="analytics-muted">Нет сравнения</span>;
  if (value === 0) return <span className="analytics-muted">→ без изменений</span>;
  return <span className={`analytics-delta analytics-delta--${improved ? "positive" : "negative"}`}>{value > 0 ? "↑" : "↓"} {signed(Math.round(value * 100) / 100)}{unit === "%" ? " п.п." : unit ? ` ${unit}` : ""} · {improved ? "лучше" : "хуже"}</span>;
}

export function ReportFilters({ report }: { report: ReturnType<typeof useAnalyticsReport> }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const fields = <>
    <div className="field"><span className="field__label">Период</span><ReportPeriod report={report} /></div>
    <label className="field"><span className="field__label">Группа</span><Select aria-label="Группа" value={report.filters.group_id ?? ""}
      options={[{ value: "", label: "Все доступные" }, ...(report.groups.data ?? []).map((group) => ({ value: group.id, label: group.name }))]}
      onChange={(value) => report.update({ group_id: value, operators: undefined, group_compare: undefined, page: undefined })} /></label>
    <label className="field"><span className="field__label">Показатель</span><Select aria-label="Показатель" value={report.data.data?.metric_code ?? report.filters.metric_code ?? ""}
      options={report.data.data?.metrics.length ? report.data.data.metrics.map((item) => ({ value: item.code, label: item.title })) : [{ value: "", label: "Нет показателей" }]}
      onChange={(value) => report.update({ metric: value, page: undefined })} /></label>
  </>;
  return <>
    <GlassSurface className="analytics-filters" variant="regular"><div className="analytics-filters__desktop analytics-filter-fields">{fields}</div><div className="analytics-filters__mobile"><span>{report.data.data ? periodCaption(report.data.data) : "Выбрать период"}</span><Button onClick={() => setMobileOpen(true)}>Фильтры</Button></div></GlassSurface>
    {mobileOpen && <Sheet onClose={() => setMobileOpen(false)} title="Фильтры аналитики"><div className="stack"><div className="analytics-filter-fields analytics-filter-fields--sheet">{fields}</div><Button variant="primary" onClick={() => setMobileOpen(false)}>Показать</Button></div></Sheet>}
    {report.groups.isError && <p role="status" className="analytics-muted">Не удалось загрузить список групп. <button className="analytics-text-button" onClick={() => void report.groups.refetch()}>Повторить</button></p>}
  </>;
}

const STEP_TEXT = { day: "по дням", week: "по неделям", month: "по месяцам" } as const;

/** How the cards and the chart read the chosen period. */
export function rangeReading(value: Pick<AnalyticsOut, "grain" | "custom_range" | "context_points" | "period_from" | "period_to">): string {
  if (!value.custom_range) return "Карточки — последний период диапазона · графики — весь диапазон";
  const step = STEP_TEXT[value.grain];
  const parts = [`Карточки — среднее ${step} за весь период, сравнение с таким же периодом до него`, `график ${step}${value.context_points ? ", с предыдущими для сравнения" : ""}`];
  if (value.grain === "week" && value.period_from && value.period_to) {
    // Weekly snapshots cannot be split: dates inside a week bring the whole week.
    const from = new Date(`${value.period_from}T12:00:00Z`), to = new Date(`${value.period_to}T12:00:00Z`);
    const days = Math.round((to.getTime() - from.getTime()) / 864e5) + 1;
    if (from.getUTCDay() !== 1 || to.getUTCDay() !== 0) parts.push(days <= 31 ? "дневных значений за эти даты нет — недели взяты целиком" : "крайние недели взяты целиком");
  }
  return parts.join(" · ");
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
      <label className="field"><span className="field__label">Добавить оператора · до 5</span><Select aria-label="Добавить оператора в сравнение" value="" disabled={selectedOperators.length >= 5}
        options={[{ value: "", label: "Выберите сотрудника" }, ...(value?.operators ?? []).filter((row) => !selectedOperators.includes(row.user_id)).map((row) => ({ value: row.user_id, label: row.full_name }))]}
        onChange={(id) => { if (id) update({ operators: [...selectedOperators, Number(id)].join(",") }); }} /></label>
      <div className="analytics-picks">{selectedOperators.map((id) => <Button key={id} size="s" onClick={() => update({ operators: selectedOperators.filter((item) => item !== id).join(",") })} aria-label={`Убрать ${value?.operators.find((row) => row.user_id === id)?.full_name ?? "оператора"} из сравнения`}>{value?.operators.find((row) => row.user_id === id)?.full_name ?? "Выбранный оператор"} ×</Button>)}</div>
    </div>}
  </>;

  const rowFilters = <div className="analytics-row-filters">
    <label className="field"><span className="field__label">Найти оператора</span><input className="input" type="search" placeholder="Имя или фамилия" value={search} onChange={e => update({ search: e.target.value, page: undefined })} /></label>
    <label className="field"><span className="field__label">Показать</span><Select aria-label="Состояние операторов" value={status} onChange={(value) => update({ status: value, page: undefined })}
      options={[{ value: "all", label: "Всех операторов" }, { value: "attention", label: "Требуют внимания" }, { value: "watch", label: "Внимание, без сильного отставания" }, { value: "critical", label: "Отклонение от 20%" }, { value: "ontrack", label: "Выполняют все цели" }, { value: "down", label: "Есть ухудшение" }, { value: "up", label: "Есть улучшение" }, { value: "late", label: "Есть опоздания" }, { value: "below", label: "Не в норме: выбранный показатель" }, { value: "missing", label: "Нет части или всех данных" }, { value: "partial", label: "Неполные данные, без отклонений" }, { value: "empty", label: "Нет ни одного показателя" }]} /></label>
    {(status !== 'all' || search) && <Button onClick={() => update({ status: undefined, search: undefined, page: undefined })}>Сбросить</Button>}
  </div>;
  return <div className="stack analytics-page analytics-lead">
    <header className="page-head"><div><p className="analytics-eyebrow">ПУЛЬС КОМАНДЫ</p><h1 className="page-title">Аналитика руководителя</h1><p className="page-subtitle">Кто выполняет цели, где падает результат и кому нужна поддержка.</p></div><Button disabled={data.isFetching} onClick={() => void data.refetch()}>{data.isFetching ? 'Обновляем…' : 'Обновить данные'}</Button></header>
    <ReportFilters report={report} />
    {data.isLoading && <KPISkeleton />}
    {data.isError && <ErrorState error={data.error} onRetry={() => void data.refetch()} />}
    {value && !data.isError && <>
      {!metric ? <EmptyState title="Показатели не настроены" hint="Добавьте показатели и цели в настройках системы." /> : value.operators_with_data === 0 ? <EmptyState title="За выбранный период показателей нет" hint="Выберите другие даты или загрузите показатели команды." action={<Link hideWhenDenied className="btn btn--primary" to="/admin/periods">Загрузить показатели</Link>} /> : <>
        <div className="analytics-snapshot"><strong>Результаты за {periodCaption(value)}</strong><span>{rangeReading(value)}</span>{value.week && value.week.status !== 'closed' && <span>Неделя {value.week.label} ещё не закрыта: значения могут измениться</span>}</div>
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
