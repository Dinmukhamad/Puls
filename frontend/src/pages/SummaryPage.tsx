import { useQuery } from "@tanstack/react-query";

import { analytics } from "../api/analytics";
import type { Channel } from "../api/types";
import { AccessLink as Link } from "../components/AccessLink";
import { useAccess } from "../auth/AccessContext";
import { Chart } from "../components/Chart";
import { Badge, Card, EmptyState, ErrorState, KPI, KPISkeleton } from "../components/ui";
import { CHANNEL_LABELS, coins, points, WEEK_STATUS_LABELS } from "../utils/format";
import { MetricDelta, ReportPeriod, useAnalyticsReport } from "./AnalyticsPage";
import { periodCaption, teamInsights } from "./analyticsInsights";
import "./analytics.css";

export function SummaryPage() {
  const report = useAnalyticsReport(true);
  const { canPath } = useAccess();
  const data = report.data.data;
  // Links to the full report keep the period shown here, including the default week.
  const period = report.range ? `from=${report.range.date_from}&to=${report.range.date_to}` : "";
  const caption = data ? periodCaption(data) : "";
  const needingAttention = data ? teamInsights(data).filter(p => p.issues.length).length : 0;
  const attention = data ? [
    { count: data.operator_count - data.operators_with_data, title: "Операторы без показателей", text: `За выбранный период (${caption || "—"}) не загружено ни одного показателя.`, href: "/admin/periods" },
    { count: needingAttention, title: "Операторы требуют внимания", text: "Есть отклонения от рабочих целей или нарушения дисциплины.", href: `/analytics?tab=operators&status=attention${period ? `&${period}` : ""}` },
    { count: data.pending_requests, title: "Заявки ожидают решения", text: "Покупки сотрудников вашей команды.", href: "/admin/requests" },
  ].filter((item) => item.count > 0 && canPath(item.href)) : [];

  return <div className="stack analytics-page">
    {/* Only the period is chosen here: the summary always covers the whole visible team. */}
    <header className="page-head analytics-summary-head"><h1 className="page-title">Сводка</h1><div className="analytics-summary-head__actions"><ReportPeriod report={report} /><Link hideWhenDenied className="btn btn--primary" to="/admin/periods">Расчёт периода</Link></div></header>
    {report.data.isLoading && <KPISkeleton count={4} />}
    {report.data.isError && <ErrorState error={report.data.error} onRetry={() => void report.data.refetch()} />}
    {data && !report.data.isError && <>
      <div className="kpi-grid"><KPI label="Операторов в команде" value={data.operator_count} hint="Действующие сотрудники" /><KPI label="Есть показатели" value={data.operators_with_data} hint={`Из ${data.operator_count} операторов`} /><KPI label="Начислено за период" value={coins(data.coins_awarded)} tone="coin" hint={caption} /><KPI label="Новых заявок" value={data.pending_requests} hint="Ожидают решения" /></div>
      <div className="analytics-summary-grid"><Card title="Требует внимания" subtitle={attention.length ? "Ближайшие действия для команды" : "По доступным данным новых сигналов нет"}>{attention.length ? <div className="analytics-attention-list">{attention.map((item) => <Link hideWhenDenied className="analytics-attention" key={item.href} to={item.href}><span className="analytics-attention__count">{item.count}</span><span><strong>{item.title}</strong><span>{item.text}</span></span><span aria-hidden="true">→</span></Link>)}</div> : <EmptyState title="Всё спокойно" hint="Здесь появятся пропуски данных, результаты ниже цели и новые заявки." />}</Card>
        <Card title="Расчёт периода" subtitle={data.week ? `Неделя ${data.week.label}` : "Периодов пока нет"}><div className="stack">{data.week ? <><Badge tone={data.week.status === "closed" ? "success" : "warning"}>{WEEK_STATUS_LABELS[data.week.status]}</Badge><p className="analytics-muted">{data.week.status === "closed" ? "Результаты опубликованы. Начисления отражены в кошельках операторов." : data.week.status === "calculated" ? "Расчёт готов к проверке и публикации." : "Загрузите показатели, проверьте данные и выполните расчёт."}</p><Link hideWhenDenied className="btn btn--secondary" style={{ alignSelf: "flex-start" }} to={`/admin/periods?week=${data.week.id}`}>Открыть период</Link></> : <EmptyState title="Начните с первой недели" action={<Link hideWhenDenied className="btn btn--primary" to="/admin/periods">Создать период</Link>} />}</div></Card></div>
      <ChannelQuality report={report} channel="line" period={period} />
      <ChannelQuality report={report} channel="chat" period={period} />
      <p className="analytics-methodology ui-note">{data.methodology}</p>
    </>}
  </div>;
}

/**
 * Each channel's main quality on its own operators: the calls of the line, the chats of chat
 * operators (docs/CHANNELS.md). Chats appear once there are chat operators.
 */
function ChannelQuality({ report, channel, period }: { report: ReturnType<typeof useAnalyticsReport>; channel: Channel; period: string }) {
  const filters = { ...report.filters, metric_code: undefined, channel };
  const query = useQuery({ queryKey: ["analytics", "overview", filters], queryFn: ({ signal }) => analytics.overview(filters, signal) });
  const data = query.data;
  const metric = data?.metrics.find((item) => item.code === data.metric_code);
  if (!data || !metric || (channel === "chat" && !data.operator_count)) return null;
  const link = [period, channel === "chat" ? "channel=chat" : ""].filter(Boolean).join("&");
  return <Card title={`${CHANNEL_LABELS[channel]} · ${metric.title}`} subtitle={`Среднее по загруженным значениям за выбранный период · операторов: ${data.operator_count}`} action={<Link hideWhenDenied className="btn btn--plain" to={`/analytics${link ? `?${link}` : ""}`}>Вся аналитика →</Link>}><div className="analytics-summary-metric"><strong>{points(metric.value)} {metric.unit}</strong><MetricDelta value={metric.delta} improved={metric.improved} unit={metric.unit} /></div><Chart compact title={metric.title} labels={data.trend.map((item) => item.label)} series={[{ id: channel, name: CHANNEL_LABELS[channel], values: data.trend.map((item) => item.value) }]} target={metric.target} unit={metric.unit} /></Card>;
}
