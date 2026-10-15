import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { analytics, type AnalyticsOut } from "../api/analytics";
import { lookups } from "../api/access";

import { DateRangePicker } from "../components/DateRangePicker";
import { validDateRange } from "../components/dateRange";
import { GlassSurface } from "../components/GlassSurface";
import { Sheet } from "../components/Sheet";
import { Button, Select } from "../components/ui";
import { signed } from "../utils/format";
import { periodCaption } from "./analyticsInsights";
import "./analytics.css";

const positiveInt = (value: string | null) => value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : undefined;
const isDate = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
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
  return <DateRangePicker className="analytics-period" ariaLabel={label ?? "Период"} value={report.range} loading={report.data.isLoading}
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

// The public route now opens the role-aware management workspace.
export { ManagementAnalyticsPage as AnalyticsPage } from "./ManagementAnalyticsPage";
