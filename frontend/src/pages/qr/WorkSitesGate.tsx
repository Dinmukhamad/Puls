import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { workSitesAccess } from "../../api/workSitesAccess";
import { useAuth } from "../../auth/AuthContext";
import { Button, ErrorState, Skeleton } from "../../components/ui";
import { QrIcon } from "../../components/icons";
import { QrImage } from "./QrImage";
import "./qr-access.css";

export function WorkSitesGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === "operator" ? <OperatorGate key={user.id}>{children}</OperatorGate> : children;
}

function OperatorGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [now, setNow] = useState(Date.now());
  const status = useQuery({ queryKey: ["work-sites-access"], queryFn: workSitesAccess.status,
    staleTime: 0, gcTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
    refetchInterval: query => query.state.data?.granted ? false : 2500 });
  const issue = useMutation({ mutationFn: workSitesAccess.issue, onSuccess: () => { setNow(Date.now()); void status.refetch(); } });
  const payload = issue.data?.payload;
  const seconds = Math.min(300, Math.max(0, Math.ceil((Date.parse(issue.data?.expires_at ?? "") - now) / 1000))) || 0;
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (status.isPending) return <div className="qr-gate-page"><Skeleton height={350} /></div>;
  // Never mount the CRM (and its data requests) until the server grants this session.
  if (status.data?.granted) return children;
  return <div className="qr-gate-page"><Link className="qr-back" to="/training">← Обучение</Link>
    <section className="qr-gate-card"><div className="qr-gate-emblem"><QrIcon size={32} /></div>
      <span className="qr-eyebrow">ДОСТУП С ПОДТВЕРЖДЕНИЕМ</span><h1>Рабочие сайты</h1>
      <p className="qr-intro">Покажите свой QR сотруднику. После подтверждения рабочее окно откроется автоматически.</p>
      {status.isError ? <ErrorState error={status.error} onRetry={() => status.refetch()} /> : <>
        {payload && seconds > 0 ? <div className="qr-issued"><QrImage payload={payload} /><strong>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</strong><span>Ожидаем подтверждения</span><p className="qr-person">{user?.full_name}</p></div> : <ol className="qr-gate-steps"><li>Создайте QR-код для этого устройства.</li><li>Попросите тренера, супервайзера, руководителя или администратора открыть «QR-доступ» и отсканировать код.</li><li>Дождитесь подтверждения — доступ откроется здесь.</li></ol>}
        {payload && !seconds && <p className="qr-inline-error" role="status">Время действия QR истекло. Создайте новый код.</p>}
        <Button block variant="primary" disabled={issue.isPending} onClick={() => issue.mutate()}>{issue.isPending ? "Создаём QR…" : payload ? "Создать новый QR" : "Сгенерировать QR"}</Button>
        {issue.isError && <p className="qr-inline-error" role="alert">{issue.error.message}</p>}
        {payload && seconds > 0 && <details className="qr-manual"><summary>Если не получается отсканировать</summary><p>Сотрудник может вставить этот код в ручной ввод раздела «QR-доступ».</p><input aria-label="Код доступа для ручного ввода" readOnly value={payload} onFocus={e => e.target.select()} /><Button onClick={() => { void navigator.clipboard?.writeText(payload).catch(() => {}); }}>Скопировать код</Button></details>}
      </>}
      <p className="qr-session-note">Доступ действует до выхода из аккаунта только в этом браузере или приложении. На другом устройстве нужно новое подтверждение.</p>
    </section></div>;
}
