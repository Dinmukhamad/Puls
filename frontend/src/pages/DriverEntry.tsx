import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { driver, orderActive } from "../api/driver";
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
  const active = orderActive(query.data?.order);
  return <Card title="Driver Simulator" subtitle="Вход и полный учебный заказ">
    <div className="stack">
      <p>Пройдите путь водителя от входа в приложение до выполнения заказов и обращения в поддержку.</p>
      <p className="secondary">Введите адреса, примите заказ, заберите пассажира и завершите поездку с оплатой. Можно пройти несколько заказов подряд.</p>
      {query.isLoading ? <RowsSkeleton rows={2} /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : <>
        <div className="row"><Badge tone={active || unfinished ? "accent" : profile?.last_login_at ? "success" : "neutral"}>{active ? "Есть незавершённый заказ" : unfinished ? "Вход не завершён" : profile ? "Вход пройден" : "Ещё не запускали"}</Badge></div>
        {!!query.data?.order_summary?.count && <p>Выполнено учебных заказов: {query.data.order_summary.count}. <Link to="/simulator?section=results">Посмотреть результаты</Link></p>}
        {profile?.last_login_at && <p className="secondary small">Последний вход: {dateTime(profile.last_login_at)}</p>}
        {unfinished && <p>Сохранён этап: {({ services: "Мои сервисы", cooperation: "Выбор парка", phone: "Номер телефона", otp: "Код из Telegram", loading: "Загрузка профиля", offline: "Вход завершён" })[profile.stage]}.</p>}
        {last && <p className="small">Последний результат: <Link to={`/simulator/attempts/${last.attempt_id}`}>{last.title} · {last.state === "passed" ? "Пройдено" : "Не пройдено"}{last.score !== null ? ` · ${last.score}%` : ""}</Link></p>}
        <div className="row">
          {(unfinished || active) && <Link className="btn btn--primary" to="/simulator">{active ? "Продолжить заказ" : "Продолжить вход"}</Link>}
          {!active && <Button variant={unfinished ? "secondary" : "primary"} disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? "Запускаем…" : "Начать симуляцию"}</Button>}
        </div>
      </>}
      {start.isError && <ErrorState error={start.error} />}
    </div>
  </Card>;
}
