import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { learning, LEARNING_LABELS, type LearningContent } from "../api/learning";
import { lookups, type UserOption } from "../api/access";
import { buildQuery, downloadFile } from "../api/client";
import { driver } from "../api/driver";
import { driverShift, type DriverScenario } from "../api/driverShift";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { Badge, Button, Card, EmptyState, ErrorState, KPI, Pagination, RowsSkeleton } from "../components/ui";
import { dateTime } from "../utils/format";
import { ScenarioForm } from "./DriverScenarioEditor";
import "./training-tools.css";

const STATES: Record<string, string> = { not_started: "Не начали", in_progress: "В процессе", passed: "Успешно", failed: "Не пройдено" };

export function AssignmentEditor({ content, onClose }: { content: LearningContent; onClose: () => void }) {
  const [all, setAll] = useState(false), [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UserOption[]>([]), [deadline, setDeadline] = useState("");
  const client = useQueryClient();
  const people = useQuery({ queryKey: ["training-operator-options", search], queryFn: ({ signal }) => lookups.operators({ search, size: 50 }, signal) });
  const save = useMutation({ mutationFn: () => learning.assign(content.id, { all_operators: all, user_ids: all ? [] : selected.map(x => x.id), deadline: deadline ? new Date(deadline).toISOString() : null }), onSuccess: () => {
    for (const key of ["learning", "training-analytics"]) void client.invalidateQueries({ queryKey: [key] });
  } });
  return <Sheet title="Назначить операторам" subtitle={content.title} onClose={() => { if (!save.isPending) onClose(); }} footer={<Button variant="primary" disabled={save.isPending || (!all && !selected.length)} onClick={() => save.mutate()}>{save.isPending ? "Назначаем…" : "Назначить"}</Button>}>
    <div className="stack"><label><input type="checkbox" checked={all} onChange={e => { setAll(e.target.checked); save.reset(); }} disabled={save.isPending} /> Всем активным операторам</label>
      {!all && <><label className="field"><span>Найти оператора</span><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="ФИО" /></label>
        {selected.length > 0 && <div className="row">{selected.map(item => <Button key={item.id} size="s" disabled={save.isPending} onClick={() => setSelected(old => old.filter(x => x.id !== item.id))}>{item.full_name} ×</Button>)}</div>}
        {people.isPending && <RowsSkeleton rows={2} />}{people.isError && <ErrorState error={people.error} />}
        <div className="training-operator-picker">{people.data?.items.map(item => <label key={item.id}><input type="checkbox" checked={selected.some(x => x.id === item.id)} disabled={save.isPending} onChange={e => { setSelected(old => e.target.checked ? [...old, item] : old.filter(x => x.id !== item.id)); save.reset(); }} />{item.full_name}</label>)}</div>
        {(people.data?.total ?? 0) > 50 && <p className="secondary">Показаны первые 50 операторов. Уточните поиск.</p>}
      </>}
      <label className="field"><span>Срок прохождения · необязательно</span><input className="input" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} disabled={save.isPending} /></label>
      <p className="secondary">Повторное назначение не сбрасывает результаты и не создаёт дубликат. Назначение всем охватывает текущих активных операторов.</p>
      {save.isSuccess && <p role="status">Назначено: {save.data.assigned}. Уже назначено ранее: {save.data.already_assigned}.</p>}{save.isError && <ErrorState error={save.error} />}
    </div>
  </Sheet>;
}

export function TrainerHome() {
  const { user } = useAuth();
  const query = useQuery({ queryKey: ["training-analytics", "summary"], queryFn: () => learning.analytics({}) });
  const summary = query.data?.summary;
  return <div className="stack"><header className="page-head"><div><h1 className="page-title">Кабинет тренера</h1><p className="page-subtitle">{user?.full_name} · обучение всех операторов</p></div></header>
    <Card title="Рабочий день тренера"><p>Создайте операторов, подготовьте материалы и назначьте обучение. В аналитике видны прохождение, попытки и ошибки.</p><div className="training-home-links"><Link to="/admin/users">Создать оператора →</Link><Link to="/admin/learning">Подготовить обучение →</Link><Link to="/admin/learning-analytics">Проверить результаты →</Link></div></Card>
    {query.isPending && <RowsSkeleton />}{query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
    {summary && <div className="kpi-grid"><KPI label="Назначено" value={summary.assigned ?? 0} /><KPI label="Не начали" value={summary.not_started ?? 0} /><KPI label="В процессе" value={summary.in_progress ?? 0} /><KPI label="Завершили" value={summary.completed ?? 0} /></div>}
    <Card title="Проверка перед публикацией"><p>Кнопка «Пройти как оператор» открывает тестовое прохождение. Оно не входит в рабочую статистику и не выдаёт коины.</p><Link to="/admin/learning?kind=simulator">Открыть сценарии Driver Simulator →</Link></Card>
  </div>;
}

export function TrainingAnalyticsPage() {
  const [params, setParams] = useSearchParams(), [search, setSearch] = useState("");
  const filters = Object.fromEntries(["date_from", "date_to", "user_id", "content_id", "kind", "state"].map(key => [key, params.get(key) || undefined]));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const query = useQuery({ queryKey: ["training-analytics", filters], queryFn: () => learning.analytics(filters) });
  const people = useQuery({ queryKey: ["training-operator-options", search], queryFn: ({ signal }) => lookups.operators({ search, size: 50 }, signal) });
  const contents = useQuery({ queryKey: ["learning-definitions"], queryFn: learning.definitions });
  const exporting = useMutation({ mutationFn: () => downloadFile(`/api/v1/admin/learning-analytics${buildQuery({ ...filters, export: true })}`, "training.csv") });
  function change(key: string, value: string) { const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key); if (key !== "page") next.delete("page"); setParams(next); }
  const data = query.data;
  const summary = data?.summary;
  return <div className="stack"><header className="page-head"><div><h1 className="page-title">Аналитика обучения</h1><p className="page-subtitle">Только результаты операторов. Тестовые прохождения сотрудников исключены.</p></div><Button disabled={exporting.isPending || !data} onClick={() => exporting.mutate()}>Скачать CSV</Button></header>
    <Card title="Фильтры"><div className="training-analytics-filters">
      <label className="field"><span>С даты</span><input className="input" type="date" value={params.get("date_from") ?? ""} onChange={e => change("date_from", e.target.value)} /></label>
      <label className="field"><span>По дату</span><input className="input" type="date" value={params.get("date_to") ?? ""} onChange={e => change("date_to", e.target.value)} /></label>
      <label className="field"><span>Поиск оператора</span><input className="input" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label className="field"><span>Оператор</span><select className="input" value={params.get("user_id") ?? ""} onChange={e => change("user_id", e.target.value)}><option value="">Все операторы</option>{params.get("user_id") && !people.data?.items.some(x => String(x.id) === params.get("user_id")) && <option value={params.get("user_id")!}>Выбранный оператор</option>}{people.data?.items.map(x => <option value={x.id} key={x.id}>{x.full_name}</option>)}</select></label>
      <label className="field"><span>Тип</span><select className="input" value={params.get("kind") ?? ""} onChange={e => change("kind", e.target.value)}><option value="">Все типы</option>{Object.entries(LEARNING_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="field"><span>Обучение / тест</span><select className="input" value={params.get("content_id") ?? ""} onChange={e => change("content_id", e.target.value)}><option value="">Все материалы</option>{contents.data?.map(x => <option value={x.id} key={x.id}>{x.title}</option>)}</select></label>
      <label className="field"><span>Статус</span><select className="input" value={params.get("state") ?? ""} onChange={e => change("state", e.target.value)}><option value="">Все статусы</option>{Object.entries(STATES).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><Button onClick={() => { setParams({}); setSearch(""); }}>Сбросить</Button>
    </div><p className="secondary small">Период по UTC: даты назначения и начала попытки. Завершение — оконченная попытка, включая неуспешную. Успешность — доля успешных среди завершённых попыток.</p>
    {people.isError && <ErrorState error={people.error} />}{contents.isError && <ErrorState error={contents.error} />}</Card>
    {query.isPending && <RowsSkeleton />}{query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}{exporting.isError && <ErrorState error={exporting.error} />}
    {summary && <><div className="kpi-grid">{[["Назначено", "assigned"], ["Начали", "started"], ["Завершили", "completed"], ["Не начали", "not_started"], ["В процессе", "in_progress"], ["Попытки", "attempts"], ["Повторные попытки", "repeat_attempts"], ["Завершение, %", "completion_percent"], ["Успешных попыток", "passed"], ["Неуспешных попыток", "failed"], ["Успешность, %", "pass_percent"], ["Неуспешность, %", "fail_percent"], ["Средний балл", "average_score"], ["Медиана", "median_score"], ["Минимальный балл", "min_score"], ["Максимальный балл", "max_score"]].map(([label, key]) => <KPI key={key} label={label} value={summary[key] ?? "—"} />)}<KPI label="Среднее время, мин" value={summary.average_seconds == null ? "—" : Math.round(summary.average_seconds / 60 * 10) / 10} /></div>
      <Card title="Результаты операторов">{!data?.items.length && <EmptyState title="Результатов пока нет" hint="Назначьте обучение или измените фильтры." />}<div className="stack">{data?.items.slice((page - 1) * 20, page * 20).map(row => <article className="training-result-row" key={`${row.user_id}-${row.content_id}`}><div><Link to={`/admin/users/${row.user_id}?tab=${row.kind}`}>{row.full_name}</Link><h3>{row.title}</h3><p>{row.attempts} попыток · последний балл: {row.score ?? "—"}{row.assigned ? " · назначено" : " · самостоятельное обучение"}</p>{row.deadline && <p>Срок: {dateTime(row.deadline)}</p>}</div><Badge tone={row.state === "passed" ? "success" : "neutral"}>{STATES[row.state]}</Badge>{row.checks.length > 0 && <details><summary>Разбор симулятора · ошибок: {row.errors}</summary>{row.checks.map(check => <p key={check.key}>{check.done ? "✓" : "○"} {check.title} · {check.path}</p>)}</details>}</article>)}</div><Pagination page={page} size={20} total={data?.items.length ?? 0} onChange={value => change("page", String(value))} /></Card>
      <Card title="Сложные вопросы" subtitle="От большего процента ошибок к меньшему. Версии вопросов учитываются отдельно."><div className="stack">{data?.questions.map(q => <article className="training-question-stat" key={`${q.content_id}-${q.revision}-${q.number}`}><p className="secondary small">{q.title} · версия {q.revision} · вопрос {q.number}</p><h3>{q.question}</h3><p>Ошибок: {q.errors} из {q.answers} ответов · {q.error_percent}%</p></article>)}{!data?.questions.length && <p className="secondary">Ответов на вопросы пока нет.</p>}</div></Card>
    </>}
  </div>;
}

export function DriverContentEditor({ content, onClose }: { content?: LearningContent; onClose: () => void }) {
  const config = useQuery({ queryKey: ["driver-scenario"], queryFn: driverShift.config, enabled: !content });
  const parks = useQuery({ queryKey: ["driver-parks"], queryFn: driver.parks });
  const [status, setStatus] = useState<"draft" | "published" | "archived">(content?.status ?? "draft");
  const [pass, setPass] = useState(content?.pass_percent ?? 80);
  const client = useQueryClient();
  const initial = content?.driver_config ?? config.data;
  async function save(value: DriverScenario) {
    await learning.save({ kind: "simulator", title: value.title, description: content?.description ?? "Учебная смена водителя", world: "Driver Simulator", difficulty: "medium", minutes: 30, status, is_required: false, deadline: null, allow_back: true, pass_percent: pass, coins_reward: content?.coins_reward ?? 0, driver_config: value,
      steps: [{ speaker: "", text: "Выполните учебную смену", options: ["Выполнено", "Нужна практика"], correct: 0, explanation: "Разбор доступен после смены" }],
    }, content?.id);
    void client.invalidateQueries({ queryKey: ["learning-definitions"] }); void client.invalidateQueries({ queryKey: ["learning"] });
    onClose(); return value;
  }
  return <Sheet title={content ? "Редактор сценария" : "Новый сценарий Driver Simulator"} size="l" onClose={onClose}>
    <div className="stack"><label className="field"><span>Публикация</span><select className="input" value={status} onChange={e => setStatus(e.target.value as typeof status)}><option value="draft">Черновик</option><option value="published">Опубликовано</option><option value="archived">Архив</option></select></label><label className="field"><span>Проходной балл</span><input className="input" type="number" min={1} max={100} value={pass} onChange={e => setPass(Number(e.target.value))} /></label>
    <p className="secondary">Сценарий хранится отдельно от системных настроек и может назначаться операторам. Начатые смены сохраняют свою версию.</p>
    {config.isError && <ErrorState error={config.error} />}{parks.isError && <ErrorState error={parks.error} />}
    {initial && parks.data ? <ScenarioForm initial={initial} parks={parks.data.parks} readOnly={false} onSave={save} saveLabel="Сохранить сценарий" /> : <RowsSkeleton />}</div>
  </Sheet>;
}
