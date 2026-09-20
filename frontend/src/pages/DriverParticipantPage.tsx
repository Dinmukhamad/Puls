import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getDriverJourney, getDriverParticipant, type DriverJourney } from "../api/driverAnalytics";
import { Badge, Button, Card, EmptyState, ErrorState, KPI, Pagination, RowsSkeleton } from "../components/ui";
import { dateTime } from "../utils/format";
import { CHECK_LABELS, SKILL_LABELS, STAGES, TrendChart, checkState, shortDate } from "./DriverAnalyticsCharts";

export function DriverParticipantPage({ id, selectedShift, focusCheck, onBack, onShift }: {
  id: number; selectedShift: string | null; focusCheck: string | null; onBack: () => void; onShift: (id: string) => void;
}) {
  const query = useQuery({ queryKey: ["driver-participant", id], queryFn: ({ signal }) => getDriverParticipant(id, signal), refetchInterval: 30000 });
  const data = query.data;
  const shiftId = selectedShift ?? data?.sessions[0]?.id;
  const detail = useQuery({ queryKey: ["driver-journey", id, shiftId], queryFn: ({ signal }) => getDriverJourney(id, shiftId!, signal), enabled: !!shiftId, refetchInterval: 30000 });
  const [sessionPage, setSessionPage] = useState(1);
  const history = [...data?.sessions ?? []].reverse();
  const chartHistory = history.slice(-20);
  return <div className="stack driver-analytics">
    <div className="da-back"><Button onClick={onBack}>← Команда</Button><span>Driver Simulator / Путь участника</span><Button onClick={() => { void query.refetch(); if (shiftId) void detail.refetch(); }}>Обновить</Button></div>
    {query.isPending && <RowsSkeleton />}{query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
    {data && <>
      <header className="da-person-hero"><span className="da-avatar">{data.full_name.split(" ").slice(0, 2).map(s => s[0]).join("")}</span><div><p className="da-eyebrow">ИНДИВИДУАЛЬНАЯ АНАЛИТИКА</p><h1 className="page-title">{data.full_name}</h1><p className="page-subtitle">{data.login} · {data.hired_on ? `В команде с ${new Date(data.hired_on).toLocaleDateString("ru")}` : "Дата приёма не указана"}{!data.is_active && " · неактивный аккаунт"}</p></div><Badge tone={data.sessions.some(s => !s.finished_at) ? "info" : "neutral"}>{data.sessions.some(s => !s.finished_at) ? "Есть незавершённая смена" : data.sessions.length ? "Тренировки завершены" : "Ещё не начинал"}</Badge></header>
      <div className="kpi-grid"><KPI label="Выполнено заказов" value={data.completed_orders} hint={`За ${data.sessions.length} смен`} /><KPI label="Средний балл" value={data.average_score ?? "—"} hint={`Завершённых смен с оценкой: ${data.scored_sessions}`} /><KPI label="Ошибки и отмены" value={data.errors} /><KPI label="Подсказки" value={data.hints} /></div>
      {!data.sessions.length ? <EmptyState title="Путь ещё не начат" hint="После первой учебной смены здесь появятся этапы, заказы и история действий оператора." /> : <>
        <div className="da-two-charts"><Card title="Как меняется результат" subtitle="Оценки последних 20 смен · практика без оценки оставляет пропуск"><TrendChart title="Оценки по сменам" ceiling={100} labels={chartHistory.map((_, i) => `№${history.length - chartHistory.length + i + 1}`)} series={[{ name: "Балл", values: chartHistory.map(s => s.score) }]} /></Card><Card title="Практика по сменам" subtitle="Выполненные заказы и ошибки · последние 20 смен"><TrendChart title="Практика по сменам" labels={chartHistory.map((_, i) => `№${history.length - chartHistory.length + i + 1}`)} series={[{ name: "Заказы", type: "bar", values: chartHistory.map(s => s.orders) }, { name: "Ошибки", values: chartHistory.map(s => s.errors) }]} /></Card></div>
        <div className="da-journey-layout">
          <Card title="История смен" subtitle="Выберите смену для подробного разбора" className="da-sessions-card">
            <div className="da-session-list">{data.sessions.slice((sessionPage - 1) * 10, sessionPage * 10).map((s, i) => <button type="button" key={s.id} className={`da-session ${s.id === shiftId ? "is-selected" : ""}`} onClick={() => onShift(s.id)} aria-pressed={s.id === shiftId}>
              <span className="da-session__top"><strong>Смена {data.sessions.length - (sessionPage - 1) * 10 - i}</strong><span>{shortDate(s.created_at)}</span></span><span>{s.title}</span><span className="da-session__meta">{s.mode === "assessment" ? "Зачёт" : "Практика"} · {s.finished_at ? "Завершена" : "В процессе"}</span><span className="da-session__numbers"><b>{s.orders}<small>заказов</small></b><b>{s.done_checks}/{s.required_checks}<small>этапов</small></b><b>{s.score ?? "—"}<small>балл</small></b></span>
            </button>)}</div><Pagination page={sessionPage} size={10} total={data.sessions.length} onChange={setSessionPage} />
          </Card>
          <div className="stack da-journey-main">{detail.isPending && <RowsSkeleton />}{detail.isError && <ErrorState error={detail.error} onRetry={() => detail.refetch()} />}{detail.data && <JourneyPanel key={detail.data.session.id} data={detail.data} focusCheck={focusCheck} />}</div>
        </div>
      </>}
    </>}
  </div>;
}

function JourneyPanel({ data, focusCheck }: { data: DriverJourney; focusCheck: string | null }) {
  const s = data.session;
  const [filter, setFilter] = useState("all"), [eventPage, setEventPage] = useState(1), [orderFilter, setOrderFilter] = useState<string | null>(null);
  const events = data.events.filter(e => (filter === "all" || (filter === "errors" ? e.kind === "error" || e.kind === "hint" : e.order_id !== null)) && (!orderFilter || e.order_id === orderFilter));
  const pending = s.checks.filter(c => c.required && !c.done);
  const errorLabels: Record<string, string> = { missed: "Пропуски", cancelled: "Отмены", support_errors: "Поддержка", invalid_actions: "Неверные действия" };
  return <>
    <Card title={s.title} subtitle={`${dateTime(s.created_at)} · ${s.mode === "assessment" ? "Зачётная смена" : "Свободная практика"}`} action={<Badge tone={s.passed === false ? "danger" : s.passed ? "success" : "neutral"}>{!s.finished_at ? "В процессе" : s.passed === true ? "Зачёт сдан" : s.passed === false ? "Зачёт не сдан" : "Завершена"}</Badge>}>
      <div className="da-session-metrics"><div><strong>{s.orders}<em> / {s.target}</em></strong><span>заказов по сценарию</span></div><div><strong>{s.done_checks}<em> / {s.required_checks}</em></strong><span>обязательных этапов</span></div><div><strong>{s.score ?? "—"}<em> / 100</em></strong><span>{s.pass_percent != null ? `проходной балл ${s.pass_percent}` : "результат зачёта"}</span></div></div>
      <div className="da-progress-rail">{s.checks.map(c => <span key={c.key} className={`da-rail--${checkState(c)}`} title={`${c.title}: ${CHECK_LABELS[checkState(c)]}`} />)}</div>
      <p className="da-note">Последнее действие: {dateTime(s.last_activity_at)}{s.elapsed_seconds !== null && ` · Длительность с паузами: ${Math.round(s.elapsed_seconds / 60)} мин.`}</p>
    </Card>
    <Card title="Карта прохождения" subtitle="Состояние этапов выбранной смены. Порядок карточек — структура сценария; фактический порядок действий показан ниже.">
      <div className="da-path">{s.checks.map((c, i) => { const state = checkState(c); return <article key={c.key} className={`da-path__step da-path__step--${state} ${focusCheck === c.key ? "is-focused" : ""}`}><span className="da-path__number">{state === "done" ? "✓" : String(i + 1).padStart(2, "0")}</span><div><small>{SKILL_LABELS[c.key]}</small><h3>{c.title}</h3><span className={`da-check-label da-check-label--${state}`}>{CHECK_LABELS[state]}</span><p>{c.path}</p></div></article>; })}</div>
      {pending.length > 0 && <div className="da-next"><strong>{s.finished_at ? "Для следующей практики" : "Осталось в этой смене"}</strong><span>{pending.map(c => SKILL_LABELS[c.key] ?? c.title).join(" · ")}</span></div>}
    </Card>
    <Card title="Где возникли сложности" subtitle="Счётчики этой смены"><div className="da-error-grid">{Object.entries(errorLabels).map(([key, label]) => <div key={key} className={s.error_breakdown[key] ? "has-errors" : ""}><strong>{s.error_breakdown[key] ?? 0}</strong><span>{label}</span></div>)}<div><strong>{s.hints}</strong><span>Подсказки</span></div></div></Card>
    <Card title="Путь каждого заказа" subtitle="От предложения до оплаты. Цветные шаги подтверждены сохранёнными событиями.">
      {!data.orders.length && <EmptyState title="Заказов пока нет" hint="Этапы заказов появятся после начала практики. Старые смены могут содержать только итоговые счётчики." />}
      <div className="da-orders">{data.orders.map(order => <article key={order.id} className="da-order"><div className="da-order__head"><strong>Заказ {order.number}</strong><Badge tone={order.stage === "complete" ? "success" : order.stage === "cancelled" ? "danger" : "info"}>{STAGES[order.stage] ?? order.stage}</Badge></div><p className="da-order__route">{order.origin} <span>→</span> {order.destination}</p><div className="da-order__steps">{["offer", "pickup", "waiting", "trip", "payment", "complete"].map(stage => {
        const recorded = order.timeline.find(e => e.stage === stage), current = order.stage === stage;
        const cls = current && stage !== "complete" ? "current" : recorded || current ? "done" : "unknown";
        return <div key={stage} className={`da-order__step da-order__step--${cls}`}><i>{recorded || current ? "✓" : "·"}</i><span>{STAGES[stage]}</span><small>{recorded ? new Date(recorded.at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }) : current ? "Текущий этап" : "Нет отметки"}</small></div>;
      })}</div><Button size="s" variant="plain" onClick={() => { setOrderFilter(order.id); setFilter("all"); setEventPage(1); document.getElementById("driver-event-log")?.scrollIntoView({ block: "start" }); }}>Действия по заказу {order.number} ↓</Button></article>)}</div>
    </Card>
    <Card id="driver-event-log" title="Лента действий" subtitle="Фактическая хронология учебных событий; настройки интерфейса и технические события не показаны.">
      <div className="da-event-filters"><div className="da-tabs" aria-label="Фильтр событий">{[["all", "Все действия"], ["errors", "Ошибки и подсказки"], ["orders", "Заказы"]].map(([key, title]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setEventPage(1); }}>{title}</button>)}</div>{orderFilter && <Button size="s" onClick={() => { setOrderFilter(null); setEventPage(1); }}>Все заказы ×</Button>}</div>
      <ol className="da-events">{events.slice((eventPage - 1) * 20, eventPage * 20).map((e, i) => <li key={`${e.at}-${i}`} className={`da-event da-event--${e.kind}`}><span className="da-event__pin">{e.kind === "error" ? "!" : e.kind === "milestone" ? "✓" : "·"}</span><div><strong>{e.title}</strong>{e.detail && <p className="da-note">{e.detail}</p>}<time dateTime={e.at}>{dateTime(e.at)}</time></div></li>)}</ol>{!events.length && <p className="da-note">По выбранному фильтру событий нет.</p>}<Pagination page={eventPage} size={20} total={events.length} onChange={setEventPage} />
    </Card>
  </>;
}
