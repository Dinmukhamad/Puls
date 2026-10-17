import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { request } from "../api/client";
import { nextMission, type CityData, type CityMission, type DistrictId } from "../api/city";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card, ErrorState, Skeleton } from "../components/ui";
import type { CityLabelInfo } from "../city3d/types";
import "./city/city.css";
import "./trainee.css";

const CityMap = lazy(() => import("./city/CityMap").then(module => ({ default: module.CityMap })));
const ICONS: Record<DistrictId, string> = { academy: "◈", driver: "▣", crm: "▤", dispatch: "⌖", oktell: "☎", scenarios: "◌" };
const TOOLS: Partial<Record<DistrictId, string>> = { driver: "/simulator", crm: "/training/work-sites?site=crm", dispatch: "/training/work-sites?site=dispatch", oktell: "/training/work-sites?site=oktell", scenarios: "/training/scenarios/business_park" };
const NAMES: Record<DistrictId, string> = { academy: "Знакомство", driver: "Путь водителя", crm: "Учебная CRM", dispatch: "Диспетчерская", oktell: "OKTEL", scenarios: "Сценарии" };
const STATES: Record<CityMission["state"], string> = { completed: "Пройдено", available: "Доступно", in_progress: "В процессе", ready: "Проверено", locked: "Далее", unavailable: "На паузе" };

export function trainingSummary(data: CityData) {
  const missions = data.missions.filter(mission => mission.enabled || mission.state === "completed");
  const completed = missions.filter(mission => mission.state === "completed").length;
  return { missions, completed, total: missions.length, percent: missions.length ? Math.round(completed / missions.length * 100) : 0 };
}

export function TraineeProgress({ data }: { data: CityData }) {
  const summary = trainingSummary(data);
  return <div className="trainee-progress"><strong>{summary.percent}%</strong><progress max={summary.total || 1} value={summary.completed} aria-label="Прогресс подготовки" /><span>{summary.total ? `Пройдено ${summary.completed} из ${summary.total} этапов` : "Программа появится после назначения обучения"}</span></div>;
}

export function TraineePage({ learning = false }: { learning?: boolean }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [mapAttempt, setMapAttempt] = useState(0);
  const query = useQuery({
    queryKey: ["trainee-learning", user?.id],
    queryFn: ({ signal }) => request<CityData>("/api/v1/learning/trainee/progress", { method: "POST", signal, timeoutMs: 25000 }),
    enabled: user?.role === "trainee", staleTime: 0, refetchOnWindowFocus: "always",
  });
  if (query.isPending) return <Skeleton height={460} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  if (!data) return null;
  const summary = trainingSummary(data);
  const current = nextMission(summary.missions.filter(m => m.state !== "completed"));
  const selected = data.districts.find(d => d.id === params.get("district"))?.id ?? current?.district ?? "crm";
  const district = data.districts.find(d => d.id === selected);
  const lessons = summary.missions.filter(m => m.district === selected);
  const finished = summary.total > 0 && summary.completed === summary.total;
  const labels: CityLabelInfo[] = data.districts.map(d => {
    const rows = summary.missions.filter(m => m.district === d.id), done = rows.filter(m => m.state === "completed").length;
    return { id: d.id, name: NAMES[d.id], status: rows.length ? `${done} из ${rows.length} этапов` : "Учебный тренажёр", icon: ICONS[d.id], soon: d.soon, reward: false, level: 1 };
  });
  function select(id: DistrictId) {
    if (learning) setParams({ district: id });
    else navigate(`/training/city?district=${id}`);
  }
  return <div className={`trainee-page${learning ? " trainee-page--learning" : ""}`}>
    <header className="trainee-heading"><div className="trainee-eyebrow"><span>{learning ? "Обучение" : "Главная"}</span><Badge tone="neutral">Стажёр</Badge></div><h1>{learning ? "Твоя учебная карта" : "Твоя подготовка к работе"}</h1><p>{learning ? "Выбери навык и переходи к практике в тренажёре" : "Продолжай обучение и отрабатывай навыки в тренажёрах"}</p></header>
    {!learning && <div className="trainee-top"><section className="trainee-resume"><div><span className="trainee-kicker">{finished ? "ПРОГРАММА ПРОЙДЕНА" : "ПРОДОЛЖИТЬ ОБУЧЕНИЕ"}</span><h2>{finished ? "Отличная работа!" : current?.title ?? "Начни знакомство с платформой"}</h2><p>{finished ? "Результаты сохранены. Готовность к работе подтвердит наставник." : current?.objective ?? "Открой учебную карту и выбери первый этап"}</p><Link className="btn btn--primary" to={finished || !current ? "/training/city" : current.path}>{finished ? "Повторить практику" : "Продолжить обучение"}<span aria-hidden="true"> →</span></Link></div><div className="trainee-illustration" aria-hidden="true"><span className="trainee-screen-label">{current ? NAMES[current.district] : "Обучение"}</span><div className="trainee-screen-avatar" /><i /><i /><i /><b>✓</b></div></section><Card title="Твой прогресс"><TraineeProgress data={data} /></Card></div>}
    <div className="trainee-columns"><section className="trainee-map-card"><header><div><h2>Учебная карта</h2><p>Каждое здание — переход к учебному инструменту</p></div>{learning && <Button size="s" disabled={query.isFetching} onClick={() => void query.refetch()}>Обновить прогресс</Button>}</header><div className="trainee-map"><Suspense fallback={<Skeleton height={360} />}><CityMap learningOnly onRetry={() => setMapAttempt(attempt => attempt + 1)} sceneIdentity={`trainee-learning:${user?.id}:${mapAttempt}`} districts={data.districts} missions={[]} labels={labels} selected={selected} onSelect={select} controls={user?.city_controls ?? "map"} /></Suspense></div><nav className="trainee-map-links" aria-label="Учебные инструменты">{data.districts.filter(d => !d.soon).map(d => <button key={d.id} type="button" aria-pressed={learning && selected === d.id} onClick={() => select(d.id)}><span aria-hidden="true">{ICONS[d.id]}</span>{NAMES[d.id]}</button>)}</nav>{!learning && <Link className="trainee-map-open" to="/training/city">Открыть карту обучения <span aria-hidden="true">→</span></Link>}</section>
      <aside className="trainee-plan"><h2>{learning ? NAMES[selected] : "Твой план"}</h2><p>{learning ? district?.subtitle : "Пошаговая подготовка к работе"}</p>{learning ? <>
        {lessons.length === 0 && <p className="trainee-empty">Обучение проходит внутри тренажёра. Открой его, чтобы начать или продолжить.</p>}
        <ol className="trainee-lessons">{lessons.map((mission, index) => <li key={mission.key} data-state={mission.state}><div><span className="trainee-step-mark" aria-hidden="true">{mission.state === "completed" ? "✓" : index + 1}</span><div><h3>{mission.title}</h3><span>{STATES[mission.state]}</span></div></div><p>{mission.description}</p>{mission.state === "locked" ? <small>Сначала пройди предыдущий этап</small> : mission.state === "unavailable" ? <small>Этап временно недоступен</small> : <Link className="btn btn--secondary" to={mission.path}>{mission.state === "completed" ? "Повторить" : "Перейти к практике"} →</Link>}</li>)}</ol>
        {TOOLS[selected] && <Link className="btn btn--primary trainee-tool" to={TOOLS[selected]!}>Открыть тренажёр →</Link>}
      </> : <ol className="trainee-plan-list">{data.districts.filter(d => !d.soon).map(d => {
        const rows = summary.missions.filter(m => m.district === d.id), done = rows.length > 0 && rows.every(m => m.state === "completed"), active = rows.some(m => m.state === "in_progress") || current?.district === d.id;
        return <li key={d.id}><button onClick={() => select(d.id)}><span className={`trainee-step-mark${done ? " is-done" : active ? " is-active" : ""}`} aria-hidden="true">{done ? "✓" : ICONS[d.id]}</span><span><strong>{NAMES[d.id]}</strong><small>{d.subtitle}</small></span><span className={`trainee-state${done ? " is-done" : ""}`}>{done ? "Пройдено" : active ? "В процессе" : "Далее"}</span></button></li>;
      })}</ol>}{learning && <div className="trainee-plan-progress"><h3>Общая подготовка</h3><TraineeProgress data={data} /></div>}</aside>
    </div>
  </div>;
}
