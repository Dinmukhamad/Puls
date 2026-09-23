import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { city, MISSION_STATES, nextMission, type CityReward, type DistrictId } from "../../api/city";
import { useAuth } from "../../auth/AuthContext";
import { ErrorState, Skeleton } from "../../components/ui";
import { Sheet } from "../../components/Sheet";
import { PulsarFace } from "../crm/PulsarGuide";
import { CityMap } from "./CityMap";
import { DISTRICT_LEVEL_NAMES, MAX_DISTRICT_LEVEL, districtLevel } from "./cityLevels";
import "../crm/pulsar.css";
import "./city.css";
import { DriverEntry } from "../DriverEntry";

export function CityPage() {
  const { user } = useAuth(), client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const operatorId = user?.role !== "operator" && /^\d+$/.test(params.get("operator") ?? "") ? Number(params.get("operator")) : null;
  const query = useQuery({ queryKey: ["city", operatorId ?? "self"], queryFn: () => operatorId ? city.operator(operatorId) : city.own(), refetchInterval: 15000, refetchOnWindowFocus: true });
  const [reward, setReward] = useState<CityReward | null>(null);
  const [driverLaunch, setDriverLaunch] = useState(false);
  const claim = useMutation({ mutationFn: (key: string) => city.claim(key, query.data!.revision), onSuccess: async result => { setReward(result); await client.invalidateQueries(); }, onError: () => { void query.refetch(); } });
  if (!query.data) return query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : <Skeleton height={540} />;
  const data = query.data;
  const selected = data.districts.find(d => d.id === params.get("district")) ?? data.districts.find(d => d.id === nextMission(data.missions)?.district) ?? data.districts[0];
  const missions = data.missions.filter(m => m.district === selected.id);
  const mission = missions.find(m => m.key === params.get("mission")) ?? nextMission(missions);
  const completed = data.missions.filter(m => m.state === "completed").length;
  const total = data.missions.filter(m => m.enabled || m.state === "completed").length;
  function selectDistrict(id: DistrictId) { const p = new URLSearchParams(params); p.set("district", id); p.delete("mission"); setParams(p, {replace:true}); claim.reset(); }
  function selectMission(key: string) { const p = new URLSearchParams(params); p.set("mission", key); setParams(p, {replace:true}); claim.reset(); }
  const parent = data.missions.find(m => m.key === mission?.prerequisite);
  const actionable = mission && !["locked", "unavailable"].includes(mission.state);
  return <div className="city-page">
    <header className="city-heading"><div><span className="city-eyebrow">МИССИИ / ГОРОД НАВЫКОВ</span><h1>Мой город</h1><p>{data.preview ? "Предпросмотр для сотрудника · без наград" : `${data.full_name.split(" ")[0]}, каждый навык меняет твой город.`}</p></div><div className="city-heading-actions">{user?.role !== "operator" && <Link className="city-secondary" to="/admin/learning/city">Управление миссиями</Link>}<Link className="city-secondary" to="/training">Обучение →</Link></div></header>
    {data.inspecting && <div className="city-viewing">Город оператора: <strong>{data.full_name}</strong><Link to="/admin/learning/city">← К участникам</Link></div>}
    <div className="city-profile-strip"><div className="city-level-mark">{data.level}</div><div className="city-level-copy"><strong>{data.level < 2 ? "Новый житель" : data.level < 4 ? "Исследователь" : "Мастер города"}</strong><span>Уровень города {data.level} · {data.xp} XP</span><div className="city-meter" role="progressbar" aria-label="Опыт до следующего уровня города" aria-valuemin={0} aria-valuemax={data.level_target} aria-valuenow={data.level_progress}><span style={{width:`${data.level_progress/data.level_target*100}%`}} /></div></div><div className="city-profile-stat"><strong>{completed}<small> / {total}</small></strong><span>миссий пройдено</span></div>{!data.preview && <div className="city-profile-stat"><strong>{data.balance.toLocaleString("ru-RU")} <small>◈</small></strong><span>коинов в кошельке</span></div>}</div>
    {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
    <div className="city-layout"><CityMap districts={data.districts} missions={data.missions} selected={selected.id} onSelect={selectDistrict} progressKey={!data.inspecting && !data.preview ? `city-levels:${data.user_id}` : undefined} />
      <aside className="city-mission" aria-live="polite">
        <div className="city-mission-top"><span className="city-eyebrow">{selected.name}</span><span className="city-state" data-state={mission?.state}>{selected.soon ? "СКОРО" : mission ? MISSION_STATES[mission.state] : "Нет заданий"}</span></div>
        {(() => { const level = districtLevel(missions.filter(m => m.state === "completed").length, selected.soon); return <div className="city-building-level" aria-label={`Уровень здания ${level} из ${MAX_DISTRICT_LEVEL}`}><span>{"★".repeat(level)}<em>{"★".repeat(MAX_DISTRICT_LEVEL - level)}</em></span><strong>Здание: {DISTRICT_LEVEL_NAMES[level - 1]}</strong><small>{selected.soon ? "Район строится и откроется позже" : level < MAX_DISTRICT_LEVEL ? "Каждая пройденная миссия района улучшает здание" : "Максимальный уровень — район стал легендой"}</small></div>; })()}
        {!data.inspecting && selected.id === "driver" && <button className="city-secondary" onClick={() => setDriverLaunch(true)}>Открыть автопарк →</button>}
        {!data.inspecting && selected.id === "crm" && <Link className="city-secondary" to="/training/work-sites">Открыть CRM · рабочие сайты →</Link>}
        {selected.soon ? <><h2>{selected.id === "dispatch" ? "Держать город в движении" : "Новый район. Новые возможности."}</h2><p className="city-copy">{selected.id === "dispatch" ? "Этот район откроется вместе с учебной диспетчерской." : "Миссии появятся после добавления Opteo и подготовки учебных сценариев."}</p><div className="city-guide"><PulsarFace /><p>А пока продолжим развивать автопарк и CRM-центр. Твой прогресс сохранится.</p></div><button className="city-action" disabled>Район строится</button></> : mission && <>
          <nav className="city-mission-path" aria-label={`Миссии: ${selected.name}`}>{missions.map((m,i) => <button key={m.key} type="button" onClick={() => selectMission(m.key)} aria-label={`${i+1}. ${m.title}. ${MISSION_STATES[m.state]}`} aria-pressed={mission.key===m.key} data-state={m.state}>{m.state === "completed" ? "✓" : i+1}</button>)}</nav>
          <h2>{mission.title}</h2><p className="city-copy">{mission.description}</p>
          <div className="city-objective"><span>{mission.objective}</span><strong>{mission.current} / {mission.target}</strong><div className="city-meter"><span style={{width:`${mission.current/mission.target*100}%`}} /></div></div>
          {mission.state === "locked" && <p className="city-prerequisite">Сначала завершите «{parent?.title}» и получите награду.</p>}
          <div className="city-rewards"><span>✦ {mission.xp} XP</span>{mission.coins > 0 && <span>◈ {mission.coins} коинов</span>}<span>{mission.state === "completed" ? "Получено" : "За прохождение"}</span></div>
          <div className="city-guide"><PulsarFace /><p>{mission.pulsar}</p></div>
          {claim.isError && <p className="city-error" role="alert">{claim.error.message}</p>}
          {mission.state === "ready" && data.can_claim ? <button className="city-action" disabled={claim.isPending} onClick={() => claim.mutate(mission.key)}>{claim.isPending ? "Проверяем результат…" : mission.key === "welcome" ? "Начать свой путь →" : "Завершить и получить награду →"}</button> : actionable && mission.key !== "welcome" && !data.inspecting ? selected.id === "driver" ? <button className="city-action" onClick={() => setDriverLaunch(true)}>{mission.state === "completed" ? "Вернуться к практике →" : "Перейти к заданию →"}</button> : <Link className="city-action" to={mission.path}>{mission.state === "completed" ? "Вернуться к практике →" : "Перейти к заданию →"}</Link> : <button className="city-action" disabled>{mission.state === "unavailable" ? "Миссия на паузе" : data.inspecting ? "Просмотр прогресса" : data.preview ? "Предпросмотр без наград" : mission.state === "completed" ? "Миссия пройдена" : "Завершите предыдущую миссию"}</button>}
          <p className="city-fine">{selected.id === "crm" ? "Рабочие сайты открываются оператору через QR." : "Завершённые ранее действия тоже учитываются."}</p>
        </>}
      </aside>
    </div>
    <section className="city-skills"><div><h2>Твои навыки</h2><p>Опыт города показывает путь обучения. Коины попадают в общий кошелёк Puls.</p></div><div className="city-skill-list">{data.districts.filter(d => !d.soon).map(d => {const own=data.missions.filter(m=>m.district===d.id&&(m.enabled||m.state==='completed')),done=own.filter(m=>m.state==='completed').length;return <button key={d.id} type="button" onClick={()=>selectDistrict(d.id)} className="city-skill" data-mastered={done>0&&done===own.length}><span>{done>0&&done===own.length?'✦':'◇'}</span><strong>{d.name}</strong><small>{done} / {own.length} миссий</small></button>;})}</div></section>
    {reward && <Sheet title={reward.already_claimed ? "Эта награда уже получена" : "Миссия пройдена"} onClose={() => setReward(null)} size="s"><div className="city-celebration"><div className="city-medal" aria-hidden="true">✦</div><h2>{reward.title}</h2><p>{reward.already_claimed ? "Прогресс сохранён. Повторное начисление не требуется." : "Твой город стал немного больше. Следующая миссия уже ждёт."}</p><div className="city-rewards"><span>+{reward.xp} XP</span>{reward.coins>0&&<span>+{reward.coins} коинов</span>}</div><button className="city-action" onClick={()=>setReward(null)}>Вернуться в город →</button></div></Sheet>}
    {driverLaunch && <Sheet title="Автопарк · Driver Simulator" onClose={() => setDriverLaunch(false)}><DriverEntry /></Sheet>}
  </div>;
}
