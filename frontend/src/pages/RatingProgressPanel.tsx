import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { rating } from "../api/endpoints";
import { Chart } from "../components/Chart";
import { Badge, Card, EmptyState, ErrorState, KPI, Skeleton } from "../components/ui";
import { WEEK_STATUS_LABELS, coins, points } from "../utils/format";
import "./analytics.css";

export function RatingProgressPanel() {
  const [params, setParams] = useSearchParams();
  const selectedWeek = Number(params.get("week")); const weekId = Number.isInteger(selectedWeek) && selectedWeek > 0 ? selectedWeek : undefined;
  const count = [4, 8, 12, 16].includes(Number(params.get("count"))) ? Number(params.get("count")) : 8;
  const weeks = useQuery({ queryKey: ["weeks"], queryFn: () => rating.weeks() });
  const data = useQuery({ queryKey: ["rating-progress", weekId, count], queryFn: () => rating.progress(weekId, count) });
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next); };
  const timeline = data.data?.points ?? []; const latest = timeline[timeline.length - 1];
  const observations = timeline.filter((point) => point.points !== null);
  return <div className="stack">
    <Card><div className="row"><label className="field"><span className="field__label">До недели</span><select className="input" value={weekId ?? ""} onChange={(e) => update("week", e.target.value)}><option value="">Последний доступный расчёт</option>{weeks.data?.map((week) => <option value={week.id} key={week.id}>{week.label} · {WEEK_STATUS_LABELS[week.status]}</option>)}</select></label><label className="field"><span className="field__label">История</span><select className="input" value={count} onChange={(e) => update("count", e.target.value)}>{[4, 8, 12, 16].map((value) => <option key={value} value={value}>{value} недель</option>)}</select></label></div>{weeks.isError && <ErrorState error={weeks.error} onRetry={() => weeks.refetch()} />}</Card>
    {data.isLoading && <Skeleton height={260} />}{data.isError && <ErrorState error={data.error} onRetry={() => data.refetch()} />}
    {data.data && <>{!observations.length ? <EmptyState title="Личных результатов пока нет" hint="История появится после расчёта периода с вашими показателями" /> : <>
      <div className="kpi-grid"><KPI label="Место в выбранной неделе" value={latest?.rank ? `#${latest.rank}` : "—"} /><KPI label="Баллы" value={points(latest?.points)} /><KPI label="Коины за неделю" value={latest?.coins != null ? coins(latest.coins) : "—"} hint={latest?.status === "calculated" ? "Расчёт до публикации" : latest?.status === "closed" ? "Начислены при публикации" : "Результат не рассчитан"} /><KPI label="Недель с результатом" value={observations.length} unit={`из ${count}`} /></div>
      <Card title="Динамика места" subtitle="Первое место — вверху. Пропуски разрывают линию."><Chart title="Ваше место по неделям" labels={timeline.map((p) => p.label)} series={[{ id: "rank", name: "Место", values: timeline.map((p) => p.rank) }]} lowerAtTop integerAxis /></Card>
      <Card title="Динамика баллов" subtitle="Итог после применения правил и антипоказателей"><Chart title="Ваши баллы по неделям" labels={timeline.map((p) => p.label)} series={[{ id: "points", name: "Баллы", values: timeline.map((p) => p.points) }]} /></Card>
      <Card title="Состояние расчётов"><div className="workflow-results">{timeline.slice().reverse().map((p) => <div className="workflow-result" key={p.starts_on}><span>{p.label}</span><Badge tone={p.status === "closed" ? "success" : "neutral"}>{p.status === "closed" ? "Опубликован" : p.status === "calculated" ? "Предварительный расчёт" : "Нет расчёта"}</Badge></div>)}</div></Card>
    </>}<p className="small secondary">Графики используют ваши сохранённые результаты. Недели без расчёта или без вашего результата показаны пропусками. Предварительные результаты могут измениться до публикации.</p></>}
  </div>;
}
