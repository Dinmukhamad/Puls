import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getDriverAnalytics, type DriverProgressState } from "../api/driverAnalytics";
import { Badge, Button, Card, EmptyState, ErrorState, KPI, Pagination, RowsSkeleton } from "../components/ui";
import { dateTime } from "../utils/format";
import "./driver-analytics.css";

const STATES: Record<DriverProgressState, string> = {
  not_started: "Не начинали", in_progress: "В процессе", completed: "Цель выполнена",
};
const STAGES: Record<string, string> = {
  searching: "Поиск заказа", offer: "Выбор заказа", pickup: "Едет к пассажиру",
  waiting: "Ожидает пассажира", trip: "Выполняет поездку", payment: "Принимает оплату",
  photo: "Фотоконтроль", preparing: "Подготовка к работе", finished: "Смена завершена",
  not_started: "Не начинал", complete: "Заказ завершён", cancelled: "Заказ отменён",
};

export function DriverAnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["driver-analytics", [...params].filter(([key]) => key !== "page" && key !== "view").toString()],
    queryFn: ({ signal }) => getDriverAnalytics(params, signal), refetchInterval: 30000,
  });
  const selected = params.getAll("operator_ids");
  const data = query.data;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pages = Math.max(1, Math.ceil((data?.items.length ?? 0) / 20));
  const currentPage = Math.min(page, pages);
  const rows = data?.items.slice((currentPage - 1) * 20, currentPage * 20) ?? [];
  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  }
  function toggle(id: string) {
    const next = new URLSearchParams(params);
    next.delete("operator_ids"); next.delete("page");
    (selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
      .forEach(value => next.append("operator_ids", value));
    setParams(next, { replace: true });
  }
  const options = data?.operators.filter(person => `${person.full_name} ${person.login}`.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru"))) ?? [];
  const total = data?.summary.total ?? 0;
  const completed = data?.summary.completed ?? 0;
  const started = data?.summary.in_progress ?? 0;
  const passedPercent = total ? Math.round(completed / total * 100) : 0;
  const completeAngle = total ? completed / total * 360 : 0;
  const progressAngle = total ? (completed + started) / total * 360 : 0;
  const maxOrders = Math.max(data?.target_orders ?? 5, ...rows.map(row => row.completed_orders));
  return <div className="stack driver-analytics">
    <header className="page-head"><div><h1 className="page-title">Аналитика Driver Simulator</h1><p className="page-subtitle">От первого запуска до уверенной практики — прогресс каждого оператора</p></div><Button disabled={query.isFetching} onClick={() => query.refetch()}>{query.isFetching ? "Обновляем…" : "Обновить"}</Button></header>
    <Card title="Кого сравниваем" subtitle="Все показатели и диаграммы учитывают выбранные фильтры.">
      <div className="driver-analytics__filters">
        <label className="field"><span>Стаж по дате приёма</span><select className="input" value={params.get("tenure") ?? "all"} onChange={e => change("tenure", e.target.value)}><option value="all">Любой стаж</option><option value="new">Новые · 0–30 дней</option><option value="recent">31–90 дней</option><option value="experienced">Более 90 дней</option><option value="unknown">Дата приёма не указана</option><option value="future">Ещё не приступили к работе</option></select></label>
        <label className="field"><span>Прогресс</span><select className="input" value={params.get("state") ?? ""} onChange={e => change("state", e.target.value)}><option value="">Любой прогресс</option>{Object.entries(STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="field"><span>Текущая смена</span><select className="input" value={params.get("activity") ?? ""} onChange={e => change("activity", e.target.value)}><option value="">Все</option><option value="active">Есть незавершённая смена</option><option value="inactive">Нет текущей смены</option></select></label>
        <label className="field"><span>Учётная запись</span><select className="input" value={params.get("employment") ?? "active"} onChange={e => change("employment", e.target.value)}><option value="active">Активные операторы</option><option value="inactive">Неактивные операторы</option><option value="all">Все операторы</option></select></label>
        <label className="field"><span>Цель, выполненных заказов</span><select className="input" value={params.get("target_orders") ?? "5"} onChange={e => change("target_orders", e.target.value)}>{[1, 3, 5, 10, 20].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <Button onClick={() => { setParams({ view: "driver" }); setSearch(""); }}>Сбросить фильтры</Button>
      </div>
      <details className="driver-analytics__picker"><summary>Операторы · {selected.length ? `выбрано ${selected.length}` : "все"}</summary>
        <label className="field"><span>Поиск по имени или логину</span><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти оператора" /></label>
        <div className="driver-analytics__selection">{selected.map(id => <Button key={id} size="s" onClick={() => toggle(id)}>{data?.operators.find(person => String(person.id) === id)?.full_name ?? `ID ${id}`} ×</Button>)}</div>
        <div className="training-operator-picker">{options.map(person => <label key={person.id}><input type="checkbox" checked={selected.includes(String(person.id))} onChange={() => toggle(String(person.id))} /><span>{person.full_name} <span className="secondary">· {person.login}</span></span></label>)}</div>
        {!options.length && <p className="secondary">Операторы не найдены.</p>}
      </details>
    </Card>
    {query.isPending && <RowsSkeleton />}
    {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
    {data && <>
      <div className="kpi-grid"><KPI label="Операторов в выборке" value={total} /><KPI label="Выполнили цель" value={completed} hint={`${passedPercent}% выборки · от ${data.target_orders} заказов`} /><KPI label="Незавершённых смен" value={data.summary.active} /><KPI label="Выполнено заказов" value={data.summary.completed_orders} /></div>
      <div className="driver-analytics__charts">
        <Card title="Прохождение симулятора" subtitle={`Цель: ${data.target_orders} выполненных заказов за всё время`}>
          <div className="driver-analytics__distribution">
            <div className="driver-analytics__donut" role="img" aria-label={`Цель выполнена: ${completed}. В процессе: ${started}. Не начинали: ${data.summary.not_started}.`} style={{ background: `conic-gradient(var(--da-success) 0deg ${completeAngle}deg, var(--da-progress) ${completeAngle}deg ${progressAngle}deg, var(--da-empty) ${progressAngle}deg 360deg)` }}><div><strong>{total ? `${passedPercent}%` : "—"}</strong><span>выполнили цель</span></div></div>
            <ul className="driver-analytics__legend">{(Object.keys(STATES) as DriverProgressState[]).map(key => <li key={key}><span className={`driver-analytics__dot driver-analytics__dot--${key}`} />{STATES[key]}<strong>{data.summary[key]}</strong></li>)}</ul>
          </div>
        </Card>
        <Card title="Заказы по операторам" subtitle="Операторы текущей страницы · число завершённых заказов">
          <div className="driver-analytics__bars">{rows.map(row => <div className="driver-analytics__bar-row" key={row.user_id}><span title={row.full_name}>{row.full_name}</span><div className="driver-analytics__track" role="img" aria-label={`${row.full_name}: ${row.completed_orders} заказов, цель ${data.target_orders}`}><div style={{ width: `${row.completed_orders / maxOrders * 100}%` }} className={row.state === "completed" ? "is-completed" : ""} /></div><strong>{row.completed_orders}</strong></div>)}{!rows.length && <p className="secondary">Нет операторов по выбранным фильтрам.</p>}</div>
        </Card>
      </div>
      <Card title="Прогресс операторов" subtitle={`Обновлено ${dateTime(data.updated_at)} · автообновление каждые 30 секунд`}>
        <p className="secondary small">Цель считается по сумме заказов всех обычных и зачётных смен. Предпросмотры сотрудников и смены с деморежимом исключены. Выполнение цели по заказам не означает сдачу зачёта. Незавершённая смена не означает, что оператор сейчас онлайн.</p>
        {!rows.length ? <EmptyState title="Нет операторов по выбранным фильтрам" hint="Сбросьте фильтры или выберите других операторов." /> : <div className="table-wrap"><table className="table driver-analytics__table"><thead><tr><th>Оператор / стаж</th><th>Выполненные заказы</th><th>Прогресс</th><th>Текущий процесс</th><th>Что прошёл</th></tr></thead><tbody>{rows.map(row => <tr key={row.user_id}>
          <td data-label="Оператор / стаж"><Link to={`/admin/users/${row.user_id}?tab=simulator`}>{row.full_name}</Link><small>{row.login}{!row.is_active && " · неактивен"}</small><small>{row.tenure_days == null ? "Дата приёма не указана" : row.tenure_days < 0 ? "Ещё не приступил" : `Стаж: ${row.tenure_days} дн.`}</small></td>
          <td data-label="Выполненные заказы"><strong>{row.completed_orders} / {data.target_orders}</strong><progress aria-label={`Прогресс ${row.full_name}`} value={Math.min(row.completed_orders, data.target_orders)} max={data.target_orders} /><small>Смен: {row.sessions}</small></td>
          <td data-label="Прогресс"><Badge tone={row.state === "completed" ? "success" : "neutral"}>{STATES[row.state]}</Badge></td>
          <td data-label="Текущий процесс"><strong>{row.active_shift ? "В процессе · " : ""}{STAGES[row.current_stage] ?? row.current_stage}</strong>{row.scenario && <small>{row.scenario}</small>}{row.sessions > 0 && <small>{row.active_shift ? "Текущая" : "Последняя"} смена: {row.session_orders} / {row.session_target} заказов · {row.mode === "assessment" ? "зачёт" : "практика"}</small>}</td>
          <td data-label="Что прошёл">{row.checks.length ? <details><summary>Этапы: {row.checks.filter(check => check.done).length} / {row.checks.length}</summary><ul className="driver-analytics__checks">{row.checks.map(check => <li key={check.key}>{check.done ? "✓" : "○"} {check.title}</li>)}</ul><small>{row.active_shift ? "Текущая смена" : "Последняя смена"}{row.score != null ? ` · балл: ${row.score}` : ""}</small></details> : <span className="secondary">Ещё не начинал</span>}</td>
        </tr>)}</tbody></table></div>}
        <Pagination page={currentPage} size={20} total={data.items.length} onChange={value => change("page", String(value))} />
      </Card>
    </>}
  </div>;
}
