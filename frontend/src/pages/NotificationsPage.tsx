import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { progressApi } from "../api/progress";
import { Badge, Button, Card, EmptyState, ErrorState, Pagination, Skeleton } from "../components/ui";
import { dateTime } from "../utils/format";
import "./workflow.css";
export function NotificationsPage() {
  const [params, setParams] = useSearchParams(); const page = Math.max(1, Number(params.get("page")) || 1); const unread = params.get("unread") === "1";
  const data = useQuery({ queryKey: ["notifications", page, unread], queryFn: () => progressApi.notifications(page, unread) }); const client = useQueryClient();
  const read = useMutation({ mutationFn: (id?: number) => progressApi.read(id), onSuccess: () => { void client.invalidateQueries({ queryKey: ["notifications"] }); } });
  const today = new Date().toDateString(); const yesterday = new Date(Date.now() - 86400000).toDateString();
  const groups = ["Сегодня", "Вчера", "Ранее"].map((title) => ({ title, items: data.data?.items.filter((n) => { const date = new Date(n.created_at).toDateString(); return (date === today ? "Сегодня" : date === yesterday ? "Вчера" : "Ранее") === title; }) ?? [] }));
  return <div className="stack"><div className="page-head"><div><h1 className="page-title">Уведомления</h1><p className="page-subtitle">Результаты, награды и важные события</p></div><div className="workflow-actions"><Button onClick={() => setParams(unread ? {} : { unread: "1" })}>{unread ? "Показать все" : "Непрочитанные"}</Button><Button disabled={read.isPending} onClick={() => read.mutate(undefined)}>Прочитать все</Button></div></div>
    {data.isLoading && <Skeleton height={200} />}{data.isError && <ErrorState error={data.error} onRetry={() => data.refetch()} />}{read.isError && <ErrorState error={read.error} />}{data.data?.items.length === 0 && <EmptyState title={unread ? "Всё прочитано" : "Уведомлений пока нет"} />}
    {groups.filter((g) => g.items.length > 0).map((group) => <Card title={group.title} key={group.title}><div className="workflow-results">{group.items.map((n) => <article className="workflow-result" key={n.id}><div><strong>{n.title}</strong>{!n.read_at && <Badge tone="accent">Новое</Badge>}<p className="workflow-note">{n.body}</p><p className="small secondary">{dateTime(n.created_at)}</p></div><div className="workflow-actions">{n.link?.startsWith("/") && !n.link.startsWith("//") && <Link className="btn btn--secondary btn--m" to={n.link} onClick={() => { if (!n.read_at) read.mutate(n.id); }}>Открыть</Link>}{!n.read_at && <Button disabled={read.isPending} onClick={() => read.mutate(n.id)}>Прочитано</Button>}</div></article>)}</div></Card>)}
    {data.data && <Pagination page={page} total={data.data.total} size={20} onChange={(p) => setParams({ page: String(p), unread: unread ? "1" : "0" })} />}
  </div>;
}
