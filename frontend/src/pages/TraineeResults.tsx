import { useQuery } from "@tanstack/react-query";
import { city } from "../api/city";
import { Card, ErrorState, Skeleton } from "../components/ui";

export function TraineeResults({ userId }: { userId: number }) {
  const query = useQuery({ queryKey: ["trainee-results", userId], queryFn: ({ signal }) => city.operator(userId, signal) });
  if (query.isPending) return <Skeleton height={220} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const missions = query.data.missions.filter(m => m.enabled || m.state === "completed");
  const done = missions.filter(m => m.state === "completed" || m.state === "ready").length;
  return <Card title="Подготовка стажёра" subtitle="Результаты проверяются по действиям в учебных тренажёрах"><p>Пройдено этапов: {done} из {missions.length}</p><progress value={done} max={missions.length || 1} aria-label="Подготовка стажёра" style={{ width: "100%" }} /><div className="workflow-results">{missions.map(m => <div key={m.key} className="workflow-result"><div><strong>{m.title}</strong><p className="secondary small">{m.objective}</p></div><span>{m.state === "completed" || m.state === "ready" ? "Пройдено" : m.state === "in_progress" ? `${m.current} из ${m.target}` : m.state === "unavailable" ? "На паузе" : "Не пройдено"}</span></div>)}</div></Card>;
}
