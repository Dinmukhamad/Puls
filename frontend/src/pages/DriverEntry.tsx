import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { driver } from "../api/driver";
import { Badge, Button, Card, ErrorState, RowsSkeleton } from "../components/ui";
import { dateTime } from "../utils/format";

export function DriverEntry() {
  const query = useQuery({ queryKey: ["driver-profile"], queryFn: driver.state });
  const client = useQueryClient();
  const navigate = useNavigate();
  const start = useMutation({ mutationFn: driver.start, onSuccess: (data) => {
    client.setQueryData(["driver-profile"], data);
    navigate("/simulator");
  } });
  const profile = query.data?.profile;
  const unfinished = profile && profile.stage !== "offline";
  const last = query.data?.last_result;
  return <Card title="Driver Simulator" subtitle="Вход и знакомство с приложением водителя">
    <div className="stack">
      <p>Пройдите путь водителя от входа в приложение до выполнения заказов и обращения в поддержку.</p>
      <p className="secondary">Сейчас доступны вход и просмотр разделов водительского приложения.</p>
      {query.isLoading ? <RowsSkeleton rows={2} /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : <>
        <div className="row"><Badge tone={unfinished ? "accent" : profile?.last_login_at ? "success" : "neutral"}>{unfinished ? "Вход не завершён" : profile ? "Вход пройден" : "Ещё не запускали"}</Badge></div>
        {profile?.last_login_at && <p className="secondary small">Последний вход: {dateTime(profile.last_login_at)}</p>}
        {unfinished && <p>Сохранён этап: {profile.stage === "services" ? "Мои сервисы" : profile.stage === "cooperation" ? "Выбор парка" : "Загрузка профиля"}.</p>}
        {last && <p className="small">Последний результат: <Link to={`/simulator/attempts/${last.attempt_id}`}>{last.title} · {last.state === "passed" ? "Пройдено" : "Не пройдено"}{last.score !== null ? ` · ${last.score}%` : ""}</Link></p>}
        <div className="row">
          {unfinished && <Link className="btn btn--primary" to="/simulator">Продолжить вход</Link>}
          <Button variant={unfinished ? "secondary" : "primary"} disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? "Запускаем…" : "Начать симуляцию"}</Button>
        </div>
      </>}
      {start.isError && <ErrorState error={start.error} />}
    </div>
  </Card>;
}
