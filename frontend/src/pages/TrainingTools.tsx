import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { learning, type LearningContent } from "../api/learning";
import { lookups, type UserOption } from "../api/access";
import { driver } from "../api/driver";
import { driverShift, type DriverScenario } from "../api/driverShift";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { Button, ErrorState, KPI, KPISkeleton, RowsSkeleton, Select } from "../components/ui";
import { ChevronRightIcon, DisplayIcon, MedalIcon, SparkIcon, TrophyIcon, UsersIcon } from "../components/icons";
import { getDriverAnalytics } from "../api/driverAnalytics";
import { DateTimePicker } from "../components/DateRangePicker";
import { ScenarioForm } from "./DriverScenarioEditor";
import "./training-tools.css";
import "./reports.css";

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
      {!all && <><label className="field"><span className="field__label">Найти оператора</span><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="ФИО" /></label>
        {selected.length > 0 && <div className="row">{selected.map(item => <Button key={item.id} size="s" disabled={save.isPending} onClick={() => setSelected(old => old.filter(x => x.id !== item.id))}>{item.full_name} ×</Button>)}</div>}
        {people.isPending && <RowsSkeleton rows={2} />}{people.isError && <ErrorState error={people.error} />}
        <div className="training-operator-picker">{people.data?.items.map(item => <label key={item.id}><input type="checkbox" checked={selected.some(x => x.id === item.id)} disabled={save.isPending} onChange={e => { setSelected(old => e.target.checked ? [...old, item] : old.filter(x => x.id !== item.id)); save.reset(); }} />{item.full_name}</label>)}</div>
        {(people.data?.total ?? 0) > 50 && <p className="secondary">Показаны первые 50 операторов. Уточните поиск.</p>}
      </>}
      <label className="field"><span className="field__label">Срок прохождения · необязательно</span><DateTimePicker ariaLabel="Срок прохождения" value={deadline} onChange={setDeadline} clearable disabled={save.isPending} /></label>
      <p className="secondary">Повторное назначение не сбрасывает результаты и не создаёт дубликат. Назначение всем охватывает текущих активных операторов.</p>
      {save.isSuccess && <p role="status">Назначено: {save.data.assigned}. Уже назначено ранее: {save.data.already_assigned}.</p>}{save.isError && <ErrorState error={save.error} />}
    </div>
  </Sheet>;
}

/** What a trainer opens first: where they are going and why, each place one card. */
const TRAINER_PLACES: { title: string; text: string; to: string; icon: ReactNode }[] = [
  { title: "Операторы", text: "Создать участника: он получит логин и сразу увидит свой учебный город", to: "/admin/users", icon: <UsersIcon /> },
  { title: "Сценарии Driver Simulator", text: "Учебные смены водителя: заказы, парк и проверки", to: "/admin/learning?kind=simulator", icon: <DisplayIcon /> },
  { title: "Тестовый запуск", text: "Пройти смену как оператор: без статистики и без коинов", to: "/training/city?district=driver", icon: <SparkIcon /> },
  { title: "Миссии города", text: "Районы обучения, их миссии и награды", to: "/admin/learning/city", icon: <MedalIcon /> },
  { title: "Аналитика симулятора", text: "Кто справляется, где нужна практика и что происходит сейчас", to: "/admin/learning-analytics", icon: <TrophyIcon /> },
];

/**
 * The trainer's home (docs/TRAINER.md): how the team is doing in Driver Simulator — the same numbers as the simulator's
 * analytics — and the places a trainer works in, as the site's cards.
 */
export function TrainerHome() {
  const { user } = useAuth();
  const report = useQuery({ queryKey: ["driver-analytics", "trainer-home"], queryFn: ({ signal }) => getDriverAnalytics(new URLSearchParams(), signal) });
  const data = report.data;
  return <div className="stack trainer-home"><header className="page-head"><div><h1 className="page-title">Учебная сводка</h1><p className="page-subtitle">{user?.full_name} · подготовка операторов в Driver Simulator</p></div></header>
    {report.isPending ? <KPISkeleton /> : report.isError ? <ErrorState error={report.error} onRetry={() => void report.refetch()} /> : <div className="kpi-grid">
      <KPI label="Операторов" value={data!.summary.total} hint={`${data!.summary.not_started} ещё не начинали`} />
      <KPI label="Выполнили цель" value={data!.summary.completed} tone="accent" hint={`от ${data!.target_orders} заказов`} />
      <KPI label="Смены в процессе" value={data!.summary.active} hint="Незавершённые сейчас" />
      <KPI label="Нужен разбор" value={data!.insights.needs_attention} hint={data!.insights.needs_attention ? <Link to="/admin/learning-analytics">Открыть аналитику</Link> : "Ошибок для разбора нет"} />
    </div>}
    <section className="reports-grid" aria-label="Работа тренера">{TRAINER_PLACES.map(place => <Link key={place.to} className="reports-card" to={place.to}>
      <span className="reports-card__icon" aria-hidden="true">{place.icon}</span>
      <span className="reports-card__text"><strong>{place.title}</strong><span>{place.text}</span></span>
      <ChevronRightIcon className="reports-card__go" aria-hidden="true" />
    </Link>)}</section>
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
    <div className="stack"><label className="field"><span className="field__label">Публикация</span><Select aria-label="Статус" value={status} onChange={value => setStatus(value as typeof status)} options={[{ value: "draft", label: "Черновик" }, { value: "published", label: "Опубликовано" }, { value: "archived", label: "Архив" }]} /></label><label className="field"><span className="field__label">Проходной балл</span><input className="input" type="number" min={1} max={100} value={pass} onChange={e => setPass(Number(e.target.value))} /></label>
    <p className="secondary">Сценарий хранится отдельно от системных настроек и может назначаться операторам. Начатые смены сохраняют свою версию.</p>
    {config.isError && <ErrorState error={config.error} />}{parks.isError && <ErrorState error={parks.error} />}
    {initial && parks.data ? <ScenarioForm initial={initial} parks={parks.data.parks} readOnly={false} onSave={save} saveLabel="Сохранить сценарий" /> : <RowsSkeleton />}</div>
  </Sheet>;
}
