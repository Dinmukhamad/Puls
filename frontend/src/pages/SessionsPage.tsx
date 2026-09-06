import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { systemApi, type DeviceSession } from "../api/system";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, SegmentedControl } from "../components/ui";
import { dateTime } from "../utils/format";
import "./workflow.css";

function deviceName(agent: string) {
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Браузер";
  const platform = /iPhone|iPad/.test(agent) ? "iOS" : /Android/.test(agent) ? "Android" : /Windows/.test(agent) ? "Windows" : /Mac/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "Устройство";
  return `${browser} · ${platform}`;
}
export function SessionsPage() {
  const [scope, setScope] = useState<"all" | "mine">("all");
  const data = useQuery({ queryKey: ["sessions", "developer"], queryFn: () => systemApi.sessions(true) });
  const [target, setTarget] = useState<DeviceSession | "others" | null>(null);
  const client = useQueryClient(); const toast = useToast(); const { logout, user } = useAuth();
  const revoke = useMutation({ mutationFn: () => target === "others" ? systemApi.revokeOthers() : systemApi.revoke((target as DeviceSession).id, true),
    onSuccess: () => { if (target !== "others" && target?.current) logout(); setTarget(null); void client.invalidateQueries({ queryKey: ["sessions"] }); toast.success("Сеансы завершены"); } });
  return <div className="stack"><div className="page-head"><div><h1 className="page-title">Сессии и устройства</h1><p className="page-subtitle">Панель разработчика · активные входы сотрудников и управление сеансами</p></div><Button disabled={!data.data?.some((s) => s.user_id === user?.id && !s.current)} onClick={() => setTarget("others")}>Завершить мои другие сеансы</Button></div>
    <SegmentedControl label="Сеансы" value={scope} onChange={setScope} options={[{ value: "all", label: "Все аккаунты" }, { value: "mine", label: "Мой аккаунт" }]} />
    {data.isLoading && <Skeleton height={200} />}{data.isError && <ErrorState error={data.error} onRetry={() => data.refetch()} />}{data.data?.length === 0 && <EmptyState title="Активных сессий нет" />}
    {data.data?.filter((record) => scope === "all" || record.user_id === user?.id).map((record) => <Card key={record.id} title={deviceName(record.device)} subtitle={record.full_name} action={record.current ? <Badge tone="success">Текущая</Badge> : undefined}>
      <p className="workflow-note">Последнее обновление: {dateTime(record.last_active_at)}<br />Вход: {dateTime(record.created_at)}{record.ip_address && <><br />IP: {record.ip_address}</>}</p>
      <Button variant="destructive" onClick={() => setTarget(record)}>Завершить сеанс</Button>
    </Card>)}
    {target && <Sheet title="Завершить сеанс?" onClose={() => { if (!revoke.isPending) setTarget(null); }} footer={<><Button disabled={revoke.isPending} onClick={() => setTarget(null)}>Отмена</Button><Button variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate()}>{revoke.isPending ? "Завершаем…" : "Завершить"}</Button></>}><p>{target === "others" ? "На других устройствах вашего аккаунта потребуется повторный вход. Сеансы сотрудников сохранятся." : "На этом устройстве потребуется снова ввести логин и пароль."}</p>{revoke.isError && <ErrorState error={revoke.error} />}</Sheet>}
  </div>;
}
