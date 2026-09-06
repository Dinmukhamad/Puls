import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { progressApi } from "../api/progress";
import { Badge, Card, EmptyState, ErrorState, KPI, Pagination, Progress, Skeleton } from "../components/ui";
import { coins, dateTime } from "../utils/format";
import "./workflow.css";

export function ProgressPage() {
  const [params, setParams] = useSearchParams(); const page = Math.max(1, Number(params.get("page")) || 1);
  const data = useQuery({ queryKey: ["xp-summary"], queryFn: progressApi.summary });
  const history = useQuery({ queryKey: ["xp-history", page], queryFn: () => progressApi.history(page) });
  return <div className="stack"><div className="page-head"><div><h1 className="page-title">Мой прогресс</h1><p className="page-subtitle">Опыт растёт за работу и обучение. Покупки в магазине не расходуют XP.</p></div></div>
    {data.isLoading && <Skeleton height={180} />}{data.isError && <ErrorState error={data.error} onRetry={() => data.refetch()} />}
    {data.data && <><Card title={data.data.current?.title ?? "Ваш путь в Puls"} variant="highlight"><KPI label="Всего опыта" value={coins(data.data.total)} unit="XP" tone="xp" /><Progress value={data.data.progress} tone="xp" label="До следующего уровня" /><p className="workflow-note">{data.data.next ? `${coins(data.data.remaining)} XP до уровня «${data.data.next.title}»` : "Все доступные уровни пройдены"}</p></Card>
      <Card title="Уровни"><div className="workflow-results">{data.data.levels.map((level) => <article className="workflow-result" key={level.id}><div><strong>{level.title}</strong><p className="small secondary">{level.description ?? `От ${coins(level.min_xp)} XP`}</p></div><Badge tone={data.data!.total >= level.min_xp ? "success" : "neutral"}>{data.data!.current?.id === level.id ? "Текущий уровень" : data.data!.total >= level.min_xp ? "Достигнут" : `${coins(level.min_xp)} XP`}</Badge></article>)}</div></Card></>}
    <Card title="История опыта">{history.isLoading && <Skeleton height={150} />}{history.isError && <ErrorState error={history.error} onRetry={() => history.refetch()} />}{history.data?.items.length === 0 && <EmptyState title="История опыта пока пуста" hint="Начисления XP появятся здесь после выполнения заданий или начисления руководителем" />}
      <div className="workflow-results">{history.data?.items.map((entry) => <article key={entry.id} className="workflow-result"><div><strong>{entry.reason}</strong><p className="small secondary">{dateTime(entry.created_at)}</p></div><div><strong style={{ color: "var(--xp-color)" }}>+{coins(entry.amount)} XP</strong><p className="small secondary">Всего {coins(entry.total_after)} XP</p></div></article>)}</div>{history.data && <Pagination page={page} total={history.data.total} size={20} onChange={(p) => setParams({ page: String(p) })} />}
    </Card>
  </div>;
}
