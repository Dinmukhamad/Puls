import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { systemApi, type DeviceSession } from "../api/system";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "../components/ui";
import { dateTime } from "../utils/format";
import "./workflow.css";

function deviceName(agent: string) {
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Браузер";
  const platform = /iPhone|iPad/.test(agent) ? "iOS" : /Android/.test(agent) ? "Android" : /Windows/.test(agent) ? "Windows" : /Mac/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "Устройство";
  return `${browser} · ${platform}`;
}
export function SessionsPage({ administrative = false }: { administrative?: boolean }) {
  const data = useQuery({ queryKey: ["sessions", administrative], queryFn: () => systemApi.sessions(administrative) });
  const [target, setTarget] = useState<DeviceSession | "others" | null>(null);
  const client = useQueryClient(); const toast = useToast(); const { logout } = useAuth();
  const revoke = useMutation({ mutationFn: () => target === "others" ? systemApi.revokeOthers() : systemApi.revoke((target as DeviceSession).id, administrative),
    onSuccess: () => { if (target !== "others" && target?.current) logout(); setTarget(null); void client.invalidateQueries({ queryKey: ["sessions"] }); toast.success("Сеансы завершены"); } });
  return <div className="stack"><div className="page-head"><div><h1 className="page-title">{administrative ? "Сессии пользователей" : "Мои устройства"}</h1><p className="page-subtitle">Контролируйте доступ к аккаунту и завершайте ненужные сеансы</p></div>{!administrative && <Button disabled={!data.data?.some((s) => !s.current)} onClick={() => setTarget("others")}>Завершить остальные</Button>}</div>
    {data.isLoading && <Skeleton height={200} />}{data.isError && <ErrorState error={data.error} onRetry={() => data.refetch()} />}{data.data?.length === 0 && <EmptyState title="Активных сессий нет" />}
    {data.data?.map((record) => <Card key={record.id} title={deviceName(record.device)} subtitle={administrative ? record.full_name : undefined} action={record.current ? <Badge tone="success">Текущая</Badge> : undefined}>
      <p className="workflow-note">Последнее обновление: {dateTime(record.last_active_at)}<br />Вход: {dateTime(record.created_at)}{record.ip_address && <><br />IP: {record.ip_address}</>}</p>
      <Button variant="destructive" onClick={() => setTarget(record)}>Завершить сеанс</Button>
    </Card>)}
    {target && <Sheet title="Завершить сеанс?" onClose={() => { if (!revoke.isPending) setTarget(null); }} footer={<><Button disabled={revoke.isPending} onClick={() => setTarget(null)}>Отмена</Button><Button variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate()}>{revoke.isPending ? "Завершаем…" : "Завершить"}</Button></>}><p>{target === "others" ? "Все устройства, кроме текущего, потребуют повторного входа." : "На этом устройстве потребуется снова ввести логин и пароль."}</p>{revoke.isError && <ErrorState error={revoke.error} />}</Sheet>}
  </div>;
}
