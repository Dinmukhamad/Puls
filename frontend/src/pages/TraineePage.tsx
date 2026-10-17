import { lazy, Suspense, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { request } from "../api/client";
import type { CityData, CityMission, DistrictId } from "../api/city";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card, ErrorState, Progress, Select, Skeleton } from "../components/ui";
import { CheckIcon, ChevronRightIcon, DisplayIcon, InboxIcon, LockIcon, PhoneIcon, SparkIcon, UserIcon, UsersIcon } from "../components/icons";
import type { CityLabelInfo } from "../city3d/types";
import "./city/city.css";
import "./trainee.css";

const CityMap = lazy(() => import("./city/CityMap").then(module => ({ default: module.CityMap })));
const ICONS = { academy: SparkIcon, driver: UserIcon, crm: InboxIcon, dispatch: DisplayIcon, oktell: PhoneIcon, scenarios: UsersIcon };
const MAP_ICONS: Record<DistrictId, string> = { academy: "◈", driver: "▣", crm: "▤", dispatch: "⌖", oktell: "☎", scenarios: "◌" };
const TOOLS: Partial<Record<DistrictId, string>> = { driver: "/simulator", crm: "/training/work-sites?site=crm", dispatch: "/training/work-sites?site=dispatch", oktell: "/training/work-sites?site=oktell", scenarios: "/training/scenarios/business_park" };
const NAMES: Record<DistrictId, string> = { academy: "Знакомство", driver: "Путь водителя", crm: "Учебная CRM", dispatch: "Диспетчерская", oktell: "OKTEL", scenarios: "Сценарии" };
const DESCRIPTIONS: Record<DistrictId, string> = { academy: "Знакомство с платформой и начало подготовки", driver: "Работа в приложении со стороны водителя", crm: "Создание обращений и работа с тикетами", dispatch: "Поиск водителя и работа с его аккаунтом", oktell: "Работа со звонками и сообщениями", scenarios: "Практика общения и решения обращений" };
const STATES: Record<CityMission["state"], string> = { completed: "Пройдено", available: "Можно начать", in_progress: "В процессе", ready: "Результат проверен", locked: "Позже", unavailable: "На паузе" };

export function trainingSummary(data: CityData) {
  const missions = data.missions.filter(mission => mission.enabled || mission.state === "completed");
  const completed = missions.filter(mission => mission.state === "completed").length;
  return { missions, completed, total: missions.length, percent: missions.length ? Math.round(completed / missions.length * 100) : 0 };
}

/** A call to action must never point at a locked or paused stage. */
export function currentTrainingMission(missions: CityMission[]) {
  const active = missions.filter(mission => mission.enabled);
  return active.find(mission => mission.state === "ready")
    ?? active.find(mission => mission.state === "in_progress")
    ?? active.find(mission => mission.state === "available");
}

export function TraineeProgress({ data }: { data: CityData }) {
  const summary = trainingSummary(data);
  return <div className="trainee-progress">
    <div className="trainee-progress__value"><strong>{summary.percent}%</strong><span>{summary.total ? `Пройдено ${summary.completed} из ${summary.total} этапов` : "Программа появится после назначения обучения"}</span></div>
    <Progress value={summary.total ? summary.completed / summary.total : 0} label="Прогресс подготовки" />
    <p className="small secondary">Прогресс сохраняется автоматически</p>
  </div>;
}

export function TraineePage({ learning = false }: { learning?: boolean }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [mapOpen, setMapOpen] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const lessonHeading = useRef<HTMLSpanElement>(null);
  const query = useQuery({
    queryKey: ["trainee-learning", user?.id],
    queryFn: ({ signal }) => request<CityData>("/api/v1/learning/trainee/progress", { method: "POST", signal, timeoutMs: 25000 }),
    enabled: user?.role === "trainee", staleTime: 0, refetchOnWindowFocus: "always",
  });
  if (query.isPending) return <div className="page-skeleton"><Skeleton height={44} width="45%" /><Skeleton height={200} /><Skeleton height={320} /></div>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  if (!data) return null;
  const summary = trainingSummary(data);
  const districts = data.districts.filter(district => !district.soon);
  const current = currentTrainingMission(summary.missions.filter(mission => districts.some(district => district.id === mission.district)));
  const selected = districts.find(district => district.id === params.get("district"))?.id ?? current?.district ?? districts[0]?.id ?? "academy";
  const lessons = summary.missions.filter(mission => mission.district === selected);
  const finished = summary.total > 0 && summary.completed === summary.total;
  const labels: CityLabelInfo[] = districts.map(district => {
    const rows = summary.missions.filter(mission => mission.district === district.id);
    return { id: district.id, name: NAMES[district.id], status: rows.length ? `${rows.filter(row => row.state === "completed").length} из ${rows.length} этапов` : "Практика в тренажёре", icon: MAP_ICONS[district.id], soon: false, reward: false, level: 1 };
  });
  const plan = <ol className="trainee-program" aria-label="Разделы подготовки">{districts.map(district => {
    const rows = summary.missions.filter(mission => mission.district === district.id);
    const done = rows.filter(mission => mission.state === "completed").length;
    const complete = rows.length > 0 && done === rows.length;
    const active = current?.district === district.id;
    const accessible = rows.length === 0 || Boolean(currentTrainingMission(rows));
    const Icon = ICONS[district.id];
    const content = <><span className={`trainee-program__icon${complete ? " is-complete" : ""}`}>{complete ? <CheckIcon /> : <Icon />}</span><span className="trainee-program__text"><strong>{NAMES[district.id]}</strong><span>{learning ? rows.length ? `${done} из ${rows.length} этапов` : "Практика в тренажёре" : DESCRIPTIONS[district.id]}</span></span><span className="trainee-program__status"><Badge tone={complete ? "success" : "neutral"}>{complete ? "Пройдено" : active ? "Продолжить" : accessible ? rows.length ? "Можно начать" : "Практика" : "Позже"}</Badge>{!learning && rows.length > 0 && <small>{done} / {rows.length}</small>}</span><ChevronRightIcon size={16} /></>;
    return <li key={district.id}>{learning
      ? <button type="button" aria-current={selected === district.id ? "step" : undefined} onClick={() => setParams({ district: district.id })}>{content}</button>
      : <Link to={`/training/city?district=${district.id}`}>{content}</Link>}</li>;
  })}</ol>;

  return <div className="stack trainee-page">
    <div className="page-head"><div><h1 className="page-title">{learning ? "Обучение" : "Мой кабинет"}</h1><p className="page-subtitle">{learning ? "Программа подготовки к работе" : `${data.full_name} · Стажёр`}</p></div><div className="page-head__actions">{learning && <Button size="s" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? "Обновляем…" : "Обновить прогресс"}</Button>}</div></div>
    {!learning && <div className="trainee-overview">
      <Card title={finished ? "Подготовка пройдена" : current ? "Продолжить обучение" : "Подготовка к работе"} className="trainee-current">
        {current ? <><div className="trainee-current__meta"><span>{NAMES[current.district]}</span><Badge tone="neutral">{STATES[current.state]}</Badge></div><h3>{current.title}</h3><p className="secondary">{current.description || current.objective}</p><div className="trainee-current__actions"><Link className="btn btn--primary btn--m" to={current.path}>{current.state === "in_progress" ? "Продолжить задание" : "Открыть задание"}<ChevronRightIcon size={16} /></Link><Link className="btn btn--plain btn--m" to={`/training/city?district=${current.district}`}>Все этапы раздела</Link></div></>
          : <><h3>{finished ? "Все этапы завершены" : summary.total ? "Доступных заданий пока нет" : "Программа ещё не назначена"}</h3><p className="secondary">{finished ? "Результаты сохранены. Следующий шаг обсуди с наставником; тренажёры доступны для повторения." : "Обратись к наставнику, чтобы уточнить следующий шаг подготовки."}</p>{!learning && <Link className="btn btn--secondary btn--m" to="/training/city">{finished ? "Повторить практику" : "Посмотреть программу"}</Link>}</>}
      </Card>
      <Card title="Мой прогресс"><TraineeProgress data={data} /></Card>
    </div>}
    {learning && <div className="trainee-learning-progress"><span className="small secondary">Пройдено {summary.completed} из {summary.total} этапов</span><Progress value={summary.total ? summary.completed / summary.total : 0} label="Общий прогресс подготовки" /><strong>{summary.percent}%</strong></div>}
    {learning ? <div className="trainee-learning-layout">
      <Card title="Программа подготовки" padded={false} className="trainee-program-card"><div className="trainee-program-mobile"><Select aria-label="Учебный раздел" value={selected} onChange={value => setParams({ district: String(value) })} options={districts.map(district => ({ value: district.id, label: NAMES[district.id] }))} /></div>{plan}</Card>
      <Card title={<span ref={lessonHeading} tabIndex={-1}>{NAMES[selected]}</span>} subtitle={DESCRIPTIONS[selected]} className="trainee-lesson-card">
        {lessons.length > 0 ? <ol className="trainee-lessons">{lessons.map((mission, index) => {
          const allowed = mission.state === "completed" || Boolean(currentTrainingMission([mission]));
          const prerequisite = summary.missions.find(row => row.key === mission.prerequisite);
          return <li key={mission.key} data-state={mission.state}><span className="trainee-lesson__number" aria-hidden="true">{mission.state === "completed" ? <CheckIcon size={16} /> : mission.state === "locked" ? <LockIcon size={16} /> : index + 1}</span><div className="trainee-lesson__body"><div className="trainee-lesson__title"><h3>{mission.title}</h3><Badge tone={mission.state === "completed" ? "success" : "neutral"}>{STATES[mission.state]}</Badge></div><p>{mission.description || mission.objective}</p>{allowed ? <Link className="btn btn--secondary btn--s" to={mission.path}>{mission.state === "completed" ? "Повторить" : mission.state === "in_progress" ? "Продолжить" : "Открыть задание"}<ChevronRightIcon size={14} /></Link> : <p className="trainee-lesson__hint">{mission.state === "locked" ? prerequisite ? `Сначала пройди этап «${prerequisite.title}»` : "Откроется после предыдущего этапа" : "Этап временно недоступен. Уточни у наставника, что проходить дальше."}</p>}</div></li>;
        })}</ol> : <div className="trainee-practice"><p className="secondary">Задания и подсказки находятся внутри тренажёра.</p>{TOOLS[selected] && <Link className="btn btn--primary btn--m" to={TOOLS[selected]!}>Открыть тренажёр<ChevronRightIcon size={16} /></Link>}</div>}
      </Card>
    </div> : <Card title="Программа подготовки" subtitle="Выбери раздел, чтобы посмотреть его этапы" padded={false} className="trainee-program-card">{plan}</Card>}
    {learning && <Card title="Учебная карта" subtitle="Дополнительный способ перейти к разделу обучения" action={<Button size="s" aria-expanded={mapOpen} aria-controls={mapOpen ? "trainee-map-panel" : undefined} onClick={() => setMapOpen(open => !open)}>{mapOpen ? "Скрыть карту" : "Показать карту"}</Button>}>
      {mapOpen && <div id="trainee-map-panel" className="trainee-map"><Suspense fallback={<Skeleton height={340} />}><CityMap learningOnly onRetry={() => setMapAttempt(attempt => attempt + 1)} sceneIdentity={`trainee-learning:${user?.id}:${mapAttempt}`} districts={districts} missions={[]} labels={labels} selected={selected} onSelect={id => { setParams({ district: id }); requestAnimationFrame(() => { lessonHeading.current?.focus({ preventScroll: true }); lessonHeading.current?.scrollIntoView({ block: "start" }); }); }} controls={user?.city_controls ?? "map"} /></Suspense></div>}
    </Card>}
  </div>;
}
