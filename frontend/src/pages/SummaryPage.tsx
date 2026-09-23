import { AccessLink as Link } from "../components/AccessLink";
import { useAccess } from "../auth/AccessContext";


import { Chart } from "../components/Chart";
import { Badge, Card, EmptyState, ErrorState, KPI, KPISkeleton } from "../components/ui";
import { coins, points, WEEK_STATUS_LABELS } from "../utils/format";
import { MetricDelta, ReportFilters, useAnalyticsReport } from "./AnalyticsPage";
import "./analytics.css";

export function SummaryPage() {
  const report = useAnalyticsReport(true);
  const { canPath } = useAccess();
  const data = report.data.data;
  const metric = data?.metrics.find((item) => item.code === data.metric_code);
  const attention = data ? [
    { count: data.operator_count - data.operators_with_data, title: "Операторы без показателей", text: "За выбранную неделю не загружено ни одного показателя.", href: "/admin/periods" },
    { count: metric?.below_target ?? 0, title: "Нужна поддержка", text: `${metric?.title ?? "Показатель"}: результат ниже текущей цели.`, href: `/analytics?tab=operators&status=below${data.week ? `&week_id=${data.week.id}` : ""}${report.filters.group_id ? `&group_id=${report.filters.group_id}` : ""}` },
    { count: data.pending_requests, title: "Заявки ожидают решения", text: "Покупки сотрудников вашей команды.", href: "/admin/requests" },
  ].filter((item) => item.count > 0 && canPath(item.href)) : [];

  return <div className="stack analytics-page">
    <header className="page-head"><div><h1 className="page-title">Сводка</h1><p className="page-subtitle">Состояние команды, результаты и действия на сегодня.</p></div><Link hideWhenDenied className="btn btn--primary" to="/admin/periods">Расчёт периода</Link></header>
    <ReportFilters report={report} metric={false} />
    {report.data.isLoading && <KPISkeleton count={4} />}
    {report.data.isError && <ErrorState error={report.data.error} onRetry={() => void report.data.refetch()} />}
    {data && !report.data.isError && <>
      <div className="kpi-grid"><KPI label="Операторов в команде" value={data.operator_count} hint="Действующие сотрудники" /><KPI label="Есть показатели" value={data.operators_with_data} hint={`Из ${data.operator_count} операторов`} /><KPI label="Начислено за расчёт" value={coins(data.coins_awarded)} tone="coin" hint={data.week?.label ?? "Период не создан"} /><KPI label="Новых заявок" value={data.pending_requests} hint="Ожидают решения" /></div>
      <div className="analytics-summary-grid"><Card title="Требует внимания" subtitle={attention.length ? "Ближайшие действия для команды" : "По доступным данным новых сигналов нет"}>{attention.length ? <div className="analytics-attention-list">{attention.map((item) => <Link hideWhenDenied className="analytics-attention" key={item.href} to={item.href}><span className="analytics-attention__count">{item.count}</span><span><strong>{item.title}</strong><span>{item.text}</span></span><span aria-hidden="true">→</span></Link>)}</div> : <EmptyState title="Всё спокойно" hint="Здесь появятся пропуски данных, результаты ниже цели и новые заявки." />}</Card>
        <Card title="Расчёт периода" subtitle={data.week?.label ?? "Периодов пока нет"}><div className="stack">{data.week ? <><Badge tone={data.week.status === "closed" ? "success" : "warning"}>{WEEK_STATUS_LABELS[data.week.status]}</Badge><p className="analytics-muted">{data.week.status === "closed" ? "Результаты опубликованы. Начисления отражены в кошельках операторов." : data.week.status === "calculated" ? "Расчёт готов к проверке и публикации." : "Загрузите показатели, проверьте данные и выполните расчёт."}</p><Link hideWhenDenied className="btn btn--secondary" style={{ alignSelf: "flex-start" }} to={`/admin/periods?week=${data.week.id}`}>Открыть период</Link></> : <EmptyState title="Начните с первой недели" action={<Link hideWhenDenied className="btn btn--primary" to="/admin/periods">Создать период</Link>} />}</div></Card></div>
      {metric && <Card title={`Команда · ${metric.title}`} subtitle="Среднее по наблюдаемым значениям за восемь недель" action={<Link hideWhenDenied className="btn btn--plain" to={`/analytics${data.week ? `?week_id=${data.week.id}` : ""}`}>Вся аналитика →</Link>}><div className="analytics-summary-metric"><strong>{points(metric.value)} {metric.unit}</strong><MetricDelta value={metric.delta} improved={metric.improved} unit={metric.unit} /></div><Chart compact title={metric.title} labels={data.trend.map((item) => item.label)} series={[{ id: "team", name: "Команда", values: data.trend.map((item) => item.value) }]} target={metric.target} unit={metric.unit} /></Card>}
      <p className="analytics-methodology">{data.methodology}</p>
    </>}
  </div>;
}
