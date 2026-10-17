import { useQuery } from "@tanstack/react-query";
import { city } from "../api/city";
import { Badge, ErrorState, Progress, Skeleton } from "../components/ui";
import { plural } from "../utils/format";

/** A trainee's preparation in the employee window: how far, then each mission in one line with its state. */
export function TraineeResults({ userId }: { userId: number }) {
  const query = useQuery({ queryKey: ["trainee-results", userId], queryFn: ({ signal }) => city.operator(userId, signal) });
  const missions = query.data?.missions.filter(m => m.enabled || m.state === "completed") ?? [];
  const done = missions.filter(m => m.state === "completed" || m.state === "ready").length;
  return <section className="employee__section" aria-labelledby={`employee-preparation-${userId}`}>
    <h3 id={`employee-preparation-${userId}`}>Подготовка стажёра</h3>
    {query.isPending ? <Skeleton height={120} /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <>
      <div className="employee-level">
        <p><strong>{done} из {missions.length} {plural(missions.length, "миссии", "миссий", "миссий")}</strong><span>Засчитываются по действиям в учебных тренажёрах</span></p>
        <Progress value={missions.length ? done / missions.length : 0} tone="accent" label="Подготовка стажёра" />
      </div>
      <ul className="employee-list">{missions.map(m => {
        const passed = m.state === "completed" || m.state === "ready";
        return <li key={m.key}><span><strong>{m.title}</strong><small>{m.objective}</small></span>
          <Badge tone={passed ? "success" : "neutral"}>{passed ? "Пройдено" : m.state === "in_progress" ? `${m.current} из ${m.target}` : m.state === "unavailable" ? "На паузе" : "Не пройдено"}</Badge></li>;
      })}</ul>
    </>}
  </section>;
}
