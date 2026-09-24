import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AccessLink as Link } from "../components/AccessLink";
import { useSearchParams } from "react-router-dom";

import { analytics, type AnalyticsGrain, type AnalyticsOperator, type MetricSummary } from "../api/analytics";
import { rating } from "../api/endpoints";
import { lookups } from "../api/access";

import { Chart } from "../components/Chart";
import { GlassSurface } from "../components/GlassSurface";
import { Sheet } from "../components/Sheet";
import { Badge, Button, Card, EmptyState, ErrorState, KPI, KPISkeleton, Pagination, Progress, SegmentedControl } from "../components/ui";
import { points, signed, WEEK_STATUS_LABELS } from "../utils/format";
import "./analytics.css";

const TABS = [{ value: "summary", label: "Сводка" }, { value: "operators", label: "Операторы" }, { value: "quality", label: "Качество" }];
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
  const data = useQuery({ queryKey: ["analytics", overview ? "overview" : "report", filters], queryFn: ({ signal }) => overview ? analytics.overview(filters, signal) : analytics.summary(filters, signal) });
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
    <div className="field analytics-grain"><span className="field__label">Шаг</span><SegmentedControl label="Шаг периода" options={GRAINS} value={grain} onChange={(value) => report.update({ grain: value === "week" ? undefined : value, week_id: undefined, from: undefined, to: undefined, page: undefined })} /></div>
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
    <GlassSurface className="analytics-filters" variant="regular"><div className="analytics-filters__desktop">{fields}</div><div className="analytics-filters__mobile"><span>{report.data.data?.period_label ?? "Выбрать период"}</span><Button onClick={() => setMobileOpen(true)}>Фильтры</Button></div></GlassSurface>
    {mobileOpen && <Sheet onClose={() => setMobileOpen(false)} title="Фильтры аналитики"><div className="stack">{fields}<Button variant="primary" onClick={() => setMobileOpen(false)}>Показать</Button></div></Sheet>}
    {(report.weeks.isError || report.groups.isError) && <p role="status" className="analytics-muted">Не удалось загрузить часть фильтров. <button className="analytics-text-button" onClick={() => { void report.weeks.refetch(); void report.groups.refetch(); }}>Повторить</button></p>}
  </>;
}

function TargetState({ met }: { met: boolean | null }) {
  return <Badge tone={met === null ? "neutral" : met ? "success" : "warning"}>{met === null ? "— Нет данных" : met ? "✓ Цель выполнена" : "! Ниже цели"}</Badge>;
}

export function AnalyticsPage() {
  const report = useAnalyticsReport();
  const { data, params, update } = report;
  const value = data.data;
  const tab = TABS.some((item) => item.value === params.get("tab")) ? params.get("tab")! : "summary";
  const metric = value?.metrics.find((item) => item.code === value.metric_code);
  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "all";
  const filtered = (value?.operators ?? []).filter((row) => row.full_name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (status === "all" || (status === "missing" ? row.value === null : row.target_met === false)));
  const size = 12;
  const page = Math.min(positiveInt(params.get("page")) ?? 1, Math.max(1, Math.ceil(filtered.length / size)));
  const rows = filtered.slice((page - 1) * size, page * size);
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

  return <div className="stack analytics-page">
    <header className="page-head"><div><h1 className="page-title">Аналитика</h1><p className="page-subtitle">Как работает команда и где нужна поддержка.</p></div></header>
    <ReportFilters report={report} />
    {data.isLoading && <><KPISkeleton /><Card title="Динамика"><div className="analytics-loading" aria-label="Загрузка аналитики" /></Card></>}
    {data.isError && <ErrorState error={data.error} onRetry={() => void data.refetch()} />}
    {value && !data.isError && <>
      {value.grain === "week" && !value.week ? <EmptyState title="Периодов пока нет" hint="Загрузите показатели и выполните расчёт периода." action={<Link hideWhenDenied className="btn btn--primary" to="/admin/periods">Перейти к расчёту</Link>} /> : !metric ? <EmptyState title="Показатели не настроены" hint="Добавьте определения показателей в настройках системы." /> : <>
        <div className="kpi-grid">
          <KPI label={metric.title} value={points(metric.value)} unit={metric.unit ?? undefined} hint={<MetricDelta value={metric.delta} improved={metric.improved} unit={metric.unit} />} />
          <KPI label="Текущая цель" value={points(metric.target)} unit={metric.unit ?? undefined} hint={metric.direction === "higher_is_better" ? "↑ Больше — лучше" : "↓ Меньше — лучше"} />
          <KPI label="Покрытие данных" value={metric.coverage === null ? "—" : `${points(metric.coverage * 100)} %`} hint={`${metric.reported} из ${metric.total} операторов`} />
          <KPI label="Ниже цели" value={metric.below_target} hint="Среди операторов с данными" />
        </div>
        {tab === "summary" && <>
          <Card title={`Динамика · ${metric.title}`} subtitle={GRAIN_TEXT[value.grain].trend}><Chart title={metric.title} labels={value.trend.map((item) => item.label)} series={[{ id: "team", name: "Команда", values: value.trend.map((item) => item.value) }]} target={metric.target} unit={metric.unit} /></Card>
          <Card title="Сравнение" subtitle="Одинаковый показатель и период для всех участников"><div className="stack">{comparisonControls}{comparisons.length ? <Chart title={`Сравнение: ${metric.title}`} labels={value.trend.map((item) => item.label)} series={comparisons.map((item) => ({ id: String(item.id), name: item.name, values: item.values }))} target={metric.target} unit={metric.unit} /> : <EmptyState title="Выберите участников сравнения" hint="Можно сравнить до пяти групп или операторов." />}</div></Card>
          <div className="analytics-metric-grid">{value.metrics.filter((item) => item.code !== metric.code).map((item) => <button key={item.code} className="analytics-metric-card" onClick={() => update({ metric: item.code })}><span>{item.title}</span><strong>{points(item.value)} {item.unit}</strong><MetricDelta value={item.delta} improved={item.improved} unit={item.unit} /><span className="analytics-muted">Есть данные: {item.reported} из {item.total}</span></button>)}</div>
        </>}
        {tab !== "summary" && <>
          {tab === "quality" && <Card title={`Покрытие · ${metric.title}`} subtitle={`Доля действующих операторов с загруженным значением ${GRAIN_TEXT[value.grain].period}`}><div className="stack"><Progress value={metric.coverage ?? 0} label={`Покрытие данных: ${metric.reported} из ${metric.total}`} /><p className="analytics-muted">Без данных: {metric.total - metric.reported}. Количество отдельных проверок качества в системе не хранится.</p></div></Card>}
          <div className="analytics-row-filters"><label className="field"><span className="field__label">Найти оператора</span><input className="input" type="search" placeholder="Имя сотрудника" value={search} onChange={(event) => update({ search: event.target.value, page: undefined })} /></label><label className="field"><span className="field__label">Показать</span><select className="input" value={status} onChange={(event) => update({ status: event.target.value, page: undefined })}><option value="all">Всех</option><option value="below">Ниже цели</option><option value="missing">Без данных</option></select></label></div>
          {!filtered.length ? <EmptyState title={value.operators.length ? "Ничего не найдено" : "В выбранной группе нет действующих операторов"} hint={value.operators.length ? "Измените поиск или фильтр." : "Выберите другую группу или добавьте сотрудников."} /> : <Card title={tab === "quality" ? GRAIN_TEXT[value.grain].matrix : "Показатели операторов"} subtitle={`${filtered.length} операторов · ${metric.title}`} padded={false}>
            {tab === "quality" ? <QualityRows rows={rows} labels={value.trend.map((item) => item.label)} metric={metric} /> : <OperatorRows rows={rows} metric={metric} grain={value.grain} />}
            <Pagination page={page} size={size} total={filtered.length} onChange={(next) => update({ page: String(next) })} />
          </Card>}
        </>}
      </>}
      <p className="analytics-methodology">{value.methodology}</p>
    </>}
  </div>;
}

function OperatorRows({ rows, metric, grain }: { rows: AnalyticsOperator[]; metric: MetricSummary; grain: AnalyticsGrain }) {
  return <><div className="analytics-desktop-table"><table className="table"><thead><tr><th scope="col">Оператор</th><th scope="col">Группа</th><th scope="col">Значение</th><th scope="col">{GRAIN_TEXT[grain].delta}</th><th scope="col">Цель</th>{grain === "week" && <th scope="col">Баллы расчёта</th>}</tr></thead><tbody>{rows.map((row) => <tr key={row.user_id}><th scope="row"><Link to={`/admin/users/${row.user_id}`}>{row.full_name}</Link></th><td>{row.group_name ?? "Без группы"}</td><td>{points(row.value)} {row.value === null ? "" : metric.unit}</td><td><MetricDelta value={row.delta} improved={row.improved} unit={metric.unit} /></td><td><TargetState met={row.target_met} /></td>{grain === "week" && <td>{points(row.points)}</td>}</tr>)}</tbody></table></div><div className="analytics-mobile-list">{rows.map((row) => <article key={row.user_id} className="analytics-operator-card"><Link to={`/admin/users/${row.user_id}`}>{row.full_name}</Link><span className="analytics-muted">{row.group_name ?? "Без группы"}</span><div className="analytics-operator-card__value"><strong>{points(row.value)} {row.value === null ? "" : metric.unit}</strong><TargetState met={row.target_met} /></div><MetricDelta value={row.delta} improved={row.improved} unit={metric.unit} />{grain === "week" && <span className="analytics-muted">Баллы расчёта: {points(row.points)}</span>}</article>)}</div></>;
}

function QualityRows({ rows, labels, metric }: { rows: AnalyticsOperator[]; labels: string[]; metric: MetricSummary }) {
  function tone(value: number | null) { return value === null ? "missing" : (metric.direction === "lower_is_better" ? value <= metric.target : value >= metric.target) ? "met" : "below"; }
  function cell(value: number | null) { const state = tone(value); return <span className={`analytics-quality-cell analytics-quality-cell--${state}`}><span aria-hidden="true">{state === "missing" ? "—" : state === "met" ? "✓" : "!"}</span>{value === null ? "Нет данных" : points(value)}<span className="sr-only">{state === "met" ? ", цель выполнена" : state === "below" ? ", ниже цели" : ""}</span></span>; }
  return <><div className="analytics-desktop-table analytics-table-scroll" tabIndex={0} role="region" aria-label="Матрица показателей"><table className="table analytics-quality-table"><thead><tr><th scope="col">Оператор</th>{labels.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.user_id}><th scope="row"><Link to={`/admin/users/${row.user_id}`}>{row.full_name}</Link></th>{row.trend.map((value, index) => <td key={index}>{cell(value)}</td>)}</tr>)}</tbody></table></div><div className="analytics-mobile-list">{rows.map((row) => <article className="analytics-operator-card" key={row.user_id}><Link to={`/admin/users/${row.user_id}`}>{row.full_name}</Link><div className="analytics-quality-mobile-grid">{row.trend.map((value, index) => <div key={index}><span className="analytics-muted">{labels[index]}</span>{cell(value)}</div>)}</div></article>)}</div></>;
}
