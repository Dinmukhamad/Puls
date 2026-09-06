import { useQuery } from "@tanstack/react-query";
import { progressApi } from "../api/progress";
import { Badge, Card, EmptyState, ErrorState, KPI, Pagination, Progress, Skeleton } from "./ui";
import { coins, dateTime } from "../utils/format";
import "../pages/workflow.css";

export function XpProgress({ userId, showLevels = false }: { userId?: number; showLevels?: boolean }) {
  const query = useQuery({ queryKey: ["xp-summary", userId ?? "me"], queryFn: () => progressApi.summary(userId) });
  if (query.isLoading) return <Skeleton height={180} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data!;
  return <><Card title={data.current?.title ?? "Путь в Puls"} variant="highlight"><KPI label="Всего опыта" value={coins(data.total)} unit="XP" tone="xp" /><Progress value={data.progress} tone="xp" label="До следующего уровня" /><p className="workflow-note">{data.next ? `${coins(data.remaining)} XP до уровня «${data.next.title}»` : data.current ? "Все доступные уровни пройдены" : "Уровни ещё не настроены"}</p></Card>
    {showLevels && <Card title="Уровни"><div className="workflow-results">{data.levels.map((level) => <article className="workflow-result" key={level.id}><div><strong>{level.title}</strong><p className="small secondary">{level.description}</p><p className="small secondary">От {coins(level.min_xp)} XP</p></div><Badge tone={data.current?.id === level.id ? "xp" : data.total >= level.min_xp ? "success" : "neutral"}>{data.current?.id === level.id ? "Текущий уровень" : data.total >= level.min_xp ? "Достигнут" : "Впереди"}</Badge></article>)}</div>{!data.levels.length && <EmptyState title="Уровни ещё не настроены" />}</Card>}
  </>;
}

export function XpHistory({ userId, page, onPage }: { userId?: number; page: number; onPage: (page: number) => void }) {
  const history = useQuery({ queryKey: ["xp-history", userId ?? "me", page], queryFn: () => progressApi.history(page, userId !== undefined, userId) });
  return <Card title="История опыта">{history.isLoading && <Skeleton height={150} />}{history.isError && <ErrorState error={history.error} onRetry={() => history.refetch()} />}{history.data?.items.length === 0 && <EmptyState title="История опыта пока пуста" hint="Здесь появятся начисления за работу, обучение и награды" />}
    <div className="workflow-results">{history.data?.items.map((entry) => <article key={entry.id} className="workflow-result"><div><strong>{entry.reason}</strong><p className="small secondary">{dateTime(entry.created_at)}</p></div><div><strong style={{ color: "var(--xp-text)" }}>+{coins(entry.amount)} XP</strong><p className="small secondary">Всего {coins(entry.total_after)} XP</p></div></article>)}</div>{history.data && <Pagination page={page} total={history.data.total} size={20} onChange={onPage} />}
  </Card>;
}
