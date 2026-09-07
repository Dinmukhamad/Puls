import type { MetricProgress, WeekMetricsBlock } from "../api/types";
import { Badge, Card, EmptyState, Progress } from "../components/ui";
import { periodLabel, points } from "../utils/format";
import "./cabinet.css";

export function WeekMetricsCard({ week }: { week: WeekMetricsBlock }) {
  // Gratitude counts are not call ratings. Until the new metric is configured,
  // show an empty rating instead of relabelling previously recorded values.
  const hasCallRating = week.metrics.some((metric) => metric.code === "call_rating");
  const metrics = week.metrics.flatMap((metric): MetricProgress[] => {
    if (metric.code !== "driver_gratitudes") return [metric];
    return hasCallRating ? [] : [{ code: "call_rating", title: "Оценка за звонки", kind: "positive", value: null, unit: null, completion: null, target: 0, points: 0, max_points: 0, penalty: 0 }];
  });
  const positive = metrics.filter((metric) => metric.kind === "positive");
  const negative = metrics.filter((metric) => metric.kind === "anti");

  return (
    <Card
      title="Показатели недели"
      subtitle={week.starts_on && week.ends_on ? periodLabel(week.starts_on, week.ends_on) : undefined}
      action={week.week_id ? <Badge tone={week.is_final ? "success" : "accent"} dot>{week.is_final ? "Итог подведён" : "Неделя идёт"}</Badge> : undefined}
    >
      {!week.week_id ? <EmptyState title="Неделя ещё не заведена" hint="Данные появятся после загрузки показателей" />
        : !week.metrics.length ? <EmptyState title="Показатели за эту неделю ещё не загружены" />
        : <div className="week-metric-groups">
          {positive.length > 0 && <MetricGroup title="Баллы" metrics={positive} />}
          {negative.length > 0 && <MetricGroup title="Дисбаллы" metrics={negative} negative />}
        </div>}
    </Card>
  );
}

function MetricGroup({ title, metrics, negative = false }: { title: string; metrics: MetricProgress[]; negative?: boolean }) {
  return (
    <details className="week-metric-group">
      <summary className="week-metric-group__summary">
        <span className={`week-metric-group__sign${negative ? " week-metric-group__sign--negative" : ""}`} aria-hidden="true">{negative ? "−" : "+"}</span>
        <span className="week-metric-group__label"><strong>{title}</strong><span className="small secondary">{negative ? "Снижают результат" : "За рабочие показатели"}</span></span>
        <span className="week-metric-group__count" aria-label={`Показателей: ${metrics.length}`}>{metrics.length}</span>
        <svg className="week-metric-group__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </summary>
      <ul className="week-metric-list">
        {metrics.map((metric) => <MetricTile key={metric.code} metric={metric} />)}
      </ul>
    </details>
  );
}

function MetricTile({ metric }: { metric: MetricProgress }) {
  const negative = metric.kind === "anti";
  const missing = metric.value === null;
  const score = negative ? metric.penalty : metric.points;
  return (
    <li className="week-metric-tile">
      <div className="week-metric-tile__head">
        <h3>{metric.title}</h3>
        <span className={`week-metric-tile__score${missing ? " is-missing" : negative ? " is-negative" : ""}`}>
          <strong>{missing ? "—" : `${score > 0 ? negative ? "−" : "+" : ""}${points(score)}`}</strong>
          <span>{negative ? "дисбаллы" : "баллы"}</span>
        </span>
      </div>
      {missing ? <p className="small secondary">Нет данных</p> : <>
        <p className="small secondary">{negative && metric.value === 0 ? "Нарушений нет" : <>{points(metric.value)}{metric.unit ? ` ${metric.unit}` : ""}{!negative && <> · цель {points(metric.target)}{metric.unit ? ` ${metric.unit}` : ""}</>}</>}</p>
        {!negative && metric.completion !== null && <Progress value={metric.completion} label={metric.title} tone="accent" />}
      </>}
    </li>
  );
}
