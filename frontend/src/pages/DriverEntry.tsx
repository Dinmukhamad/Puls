import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { driver, orderActive } from "../api/driver";
import { driverShift } from "../api/driverShift";
import { Badge, Button, Card, ErrorState, RowsSkeleton } from "../components/ui";
import { dateTime } from "../utils/format";

export function DriverEntry() {
  const query = useQuery({ queryKey: ["driver-profile"], queryFn: driver.state });
  const client = useQueryClient(), navigate = useNavigate();
  const [mode, setMode] = useState<"free" | "assessment">("free");
  const command = useRef<{ id: string; mode: "free" | "assessment" }>();
  const start = useMutation({ mutationFn: driverShift.start, networkMode: "always", onSuccess: data => { client.setQueryData(["driver-profile"], data); navigate("/simulator"); } });
  const data = query.data, shift = data?.shift, unfinished = shift && !shift.finished_at;
  const legacyOrder = orderActive(data?.order) && !data?.order?.shift_id;
  const last = data?.shift_history?.[0];
  return <Card title="Driver Simulator" subtitle="Учебное приложение водителя · Алматы"><div className="stack">
    <p>Заказы, межгород, деньги, чаты и профиль связаны одной сменой. Пройдите заказ полностью, разберите обращение и проверьте результат.</p>
    {query.isLoading ? <RowsSkeleton rows={2} /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : <>
      <div className="row"><Badge tone={unfinished ? "accent" : last ? "success" : "neutral"}>{unfinished ? "Есть незавершённая смена" : last ? "Готово к новой смене" : "Ещё не запускали"}</Badge>{data?.shift_best != null && <Badge tone="success">Лучший результат: {data.shift_best}/100</Badge>}</div>
      {last && <p>Последняя смена: {dateTime(last.finished_at)} · {last.result.score === null ? "Свободная практика" : `${last.result.score}/100`}. <Link to="/simulator?view=shift-result">Открыть разбор</Link></p>}
      {unfinished ? <><p>{shift.mode === "free" ? "Свободный режим" : "Зачётная смена"} · выполнено {shift.data.completed}/{shift.config.target_orders} заказов. Сохранены все разделы и текущий этап.</p><Link className="btn btn--primary" to="/simulator">Продолжить смену</Link></> : legacyOrder ? <Link className="btn btn--primary" to="/simulator">Завершить ранее начатый заказ</Link> : <>
        <label className="field"><span>Режим запуска</span><select className="input" value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="free">Свободный · без штрафов</option><option value="assessment">Учебная смена · с оценкой</option></select></label>
        <p className="secondary">{mode === "free" ? "Изучайте все экраны, проходите проверки и выполняйте заказы в своём темпе." : "Выполните задание руководителя. Система оценит заказы, проверки, работу с поддержкой и документы; ошибки и подсказки учитываются."}</p>
        <Button disabled={start.isPending} onClick={() => { if (command.current?.mode !== mode) command.current = { id: crypto.randomUUID(), mode }; start.mutate(command.current); }}>{start.isPending ? "Запускаем…" : "Начать симуляцию"}</Button>
      </>}
    </>}{start.isError && <ErrorState error={start.error} />}
  </div></Card>;
}
