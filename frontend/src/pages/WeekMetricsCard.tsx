import type { MetricProgress, WeekMetricsBlock } from "../api/types";
import { Badge, Card, EmptyState, Progress } from "../components/ui";
import { coins, periodLabel, plural, points } from "../utils/format";
import "./cabinet.css";

export function WeekMetricsCard({ week }: { week: WeekMetricsBlock }) {
  const positive = week.metrics.filter((metric) => metric.kind === "positive");
  const negative = week.metrics.filter((metric) => metric.kind === "anti");

  return (
    <Card
      title="Показатели недели"
      tour="cabinet-week"
      subtitle={week.starts_on && week.ends_on ? periodLabel(week.starts_on, week.ends_on) : undefined}
      action={week.week_id ? <Badge tone={week.is_final ? "success" : "accent"} dot>{week.is_final ? "Итог опубликован" : "Предварительный результат"}</Badge> : undefined}
    >
      {!week.week_id ? <EmptyState title="Неделя ещё не заведена" hint="Данные появятся после загрузки показателей" />
        : <div className="week-metrics-content">
          <WeekTotals week={week} />
          {!week.metrics.length ? <EmptyState title={week.is_final || week.week_status === "calculated" ? "Подробная разбивка показателей недоступна" : "Показатели за эту неделю ещё не загружены"} />
            : <div className="week-metric-groups">
              {positive.length > 0 && <MetricGroup title="Баллы" metrics={positive} total={week.base_points} />}
              {negative.length > 0 && <MetricGroup title="Штрафные баллы" metrics={negative} total={week.penalty_points} negative />}
            </div>}
          <WeekCalculation week={week} />
        </div>}
    </Card>
  );
}

function WeekTotals({ week }: { week: WeekMetricsBlock }) {
  return <div className="week-totals">
    <dl className="week-totals__values">
      <div><dt>{week.is_final ? "Итоговый балл" : "Прогноз баллов"}</dt><dd>{points(week.final_points)}</dd></div>
      <div><dt>{week.is_final ? "Начислено за неделю" : "Прогноз коинов"}</dt><dd className="week-totals__coins">{coins(week.coins_total)} <span>коинов</span></dd></div>
    </dl>
    <p className="small secondary">{week.is_final
      ? "Неделя закрыта. Показаны опубликованный результат и начисление за эту неделю."
      : week.week_status === "calculated"
        ? "Неделя рассчитана, но ещё не закрыта. Это прогноз: итог и бонусы могут измениться, коины ещё не начислены."
        : "Прогноз по загруженным показателям. Итог и бонусы могут измениться до закрытия недели; коины ещё не начислены."}</p>
  </div>;
}

type FormulaSign = "+" | "−" | "=";

/** One term of the explanation; its sign is drawn in the gap before the tile and is not read out. */
function FormulaTerm({ sign, label, value, unit, tone }: { sign?: FormulaSign; label: string; value: string; unit?: string; tone?: "penalty" | "result" | "coins" }) {
  return <div className={`week-formula__term${tone ? ` week-formula__term--${tone}` : ""}`}>
    <dt>{sign && <span className="week-formula__sign" aria-hidden="true">{sign}</span>}{label}</dt>
    <dd>{value}{unit && <span className="week-formula__unit"> {unit}</span>}</dd>
  </div>;
}

function WeekCalculation({ week }: { week: WeekMetricsBlock }) {
  return <details className="week-calculation">
    <summary className="week-calculation__summary">
      <span className="week-calculation__icon" aria-hidden="true">=</span>
      <span className="week-calculation__label"><strong>Как получен итог</strong><span className="small secondary">Баллы, штрафы, коины и бонусы по шагам</span></span>
      <svg className="week-calculation__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </summary>
    <div className="week-calculation__content">
      <section className="week-formula" aria-label="Как считаются баллы">
        <h3 className="week-formula__title"><span className="week-formula__step">1</span>Баллы недели</h3>
        <dl className="week-formula__terms">
          <FormulaTerm label="Баллы за показатели" value={points(week.base_points)} />
          <FormulaTerm sign="−" label="Штрафные баллы" value={points(week.penalty_points)} tone={week.penalty_points > 0 ? "penalty" : undefined} />
          <FormulaTerm sign="=" label={week.is_final ? "Итоговый балл" : "Прогноз баллов"} value={points(week.final_points)} tone="result" />
        </dl>
      </section>
      <section className="week-formula" aria-label="Как считаются коины">
        <h3 className="week-formula__title"><span className="week-formula__step">2</span>Коины за неделю</h3>
        <dl className="week-formula__terms week-formula__terms--coins">
          <FormulaTerm label="Коины за баллы" value={coins(week.coins_from_points)} />
          <FormulaTerm sign="+" label="Бонус за место" value={coins(week.coins_rank_bonus)} />
          <FormulaTerm sign="+" label="Бонус за дисциплину" value={coins(week.coins_discipline_bonus)} />
          <FormulaTerm sign="+" label="Бонусы за номинации" value={coins(week.coins_nomination_bonus)} />
          <FormulaTerm sign="=" label={week.is_final ? "Всего начислено за неделю" : "Всего по прогнозу"} value={coins(week.coins_total)} unit="коинов" tone="coins" />
        </dl>
      </section>
      <ul className="week-calculation__notes">
        <li>Итог не может быть ниже нуля. Баллы показаны с точностью до сотых.</li>
        <li>Коины за баллы считаются по курсу недели с округлением вниз до целого коина, затем добавляются бонусы.</li>
        <li>{week.is_final ? "Показаны сохранённые итоги закрытой недели." : "Это прогноз: бонусы и итог окончательно определятся при закрытии недели."}</li>
        <li>«Нет данных» у показателя означает, что его значение ещё не загружено.</li>
      </ul>
    </div>
  </details>;
}

function MetricGroup({ title, metrics, total, negative = false }: { title: string; metrics: MetricProgress[]; total: number; negative?: boolean }) {
  const hasData = metrics.some((metric) => metric.value !== null);
  const penalized = negative && total > 0;
  const missing = !hasData && total === 0;
  return (
    <details className="week-metric-group">
      <summary className="week-metric-group__summary">
        <span className={`week-metric-group__sign${negative ? penalized ? " week-metric-group__sign--negative" : " week-metric-group__sign--neutral" : ""}`} aria-hidden="true">{negative ? "−" : "+"}</span>
        <span className="week-metric-group__label"><strong>{title}</strong><span className="small secondary">{metrics.length} {plural(metrics.length, "показатель", "показателя", "показателей")} · {negative ? "Снижают результат" : "За рабочие показатели"}</span></span>
        <span className={`week-metric-group__total${penalized ? " is-negative" : ""}`} aria-label={`${title}: ${missing ? "нет данных" : points(total)}`}>{missing ? "—" : `${total > 0 ? negative ? "−" : "+" : ""}${points(total)}`}</span>
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
        <span className={`week-metric-tile__score${missing ? " is-missing" : score === 0 ? " is-neutral" : negative ? " is-negative" : ""}`}>
          <strong>{missing ? "—" : `${score > 0 ? negative ? "−" : "+" : ""}${points(score)}`}</strong>
          <span>{negative ? "штрафные баллы" : "баллы"}</span>
        </span>
      </div>
      {missing ? <p className="small secondary">Нет данных</p> : <>
        <p className="small secondary">{negative && metric.value === 0 ? "Нарушений нет" : <>{points(metric.value)}{metric.unit ? ` ${metric.unit}` : ""}{!negative && <> · цель {points(metric.target)}{metric.unit ? ` ${metric.unit}` : ""}</>}</>}</p>
        {!negative && metric.completion !== null && <Progress value={metric.completion} label={metric.title} tone="accent" />}
      </>}
    </li>
  );
}
