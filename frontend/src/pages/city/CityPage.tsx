import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { city, MISSION_STATES, nextMission, type CityReward, type DistrictId } from "../../api/city";
import { useAuth } from "../../auth/AuthContext";
import { ErrorState } from "../../components/ui";
import { Sheet } from "../../components/Sheet";
import { PulsarFace } from "../crm/PulsarGuide";
import { CityMap } from "./CityMap";
import { DISTRICT_LEVEL_NAMES, MAX_DISTRICT_LEVEL, districtLevel } from "./cityLevels";
import { DISTRICT_COLORS, districtLabels } from "./cityDistricts";
import type { CityLabelInfo } from "./cityScene";
import "../crm/pulsar.css";
import "./city.css";
import { DriverEntry } from "../DriverEntry";
import { CityGuideSetup, GUIDE_AVATAR } from "./CityGuideSetup";
import { DEFAULT_GUIDE, guideName, guideText } from "../../guide";

/** Город во весь экран: 3D-карта под стеклянными панелями, как в игре. */
export function CityPage() {
  const { user } = useAuth(), client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const operatorId = user?.role !== "operator" && /^\d+$/.test(params.get("operator") ?? "") ? Number(params.get("operator")) : null;
  const query = useQuery({ queryKey: ["city", operatorId ?? "self"], queryFn: () => operatorId ? city.operator(operatorId) : city.own(), refetchInterval: 15000, refetchOnWindowFocus: true });
  const [reward, setReward] = useState<CityReward | null>(null);
  const [driverLaunch, setDriverLaunch] = useState(false);
  const [guideEditing, setGuideEditing] = useState(false);
  // На телефоне панель миссии — шторка над нижним меню: свёрнута до заголовка и кнопки.
  const [expanded, setExpanded] = useState(false);
  const claim = useMutation({ mutationFn: (key: string) => city.claim(key, query.data!.revision), onSuccess: async result => { setReward(result); await client.invalidateQueries(); }, onError: () => { void query.refetch(); } });
  if (!query.data) return <div className="city-immersive city-immersive--empty">
    {query.isError ? <div className="city-empty-card glass glass--prominent"><ErrorState error={query.error} onRetry={() => query.refetch()} /></div> : <div className="city-loading" role="status"><span>Загружаем город…</span></div>}
  </div>;
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
  // В чужом городе — фигура и помощник того оператора, в своём — свои.
  const mascot = data.inspecting ? { gender: data.gender ?? null, name: data.guide_name || DEFAULT_GUIDE } : { gender: user?.gender ?? null, name: guideName(user) };
  const labels = districtLabels(data.districts, data.missions);
  const needsGuide = !data.inspecting && !!user && (!user.gender || !user.guide_name);
  const rank = data.level < 2 ? "Новый житель" : data.level < 4 ? "Исследователь" : "Мастер города";
  const level = districtLevel(missions.filter(m => m.state === "completed").length, selected.soon);
  return <div className="city-immersive">
    <CityMap mascot={mascot} labels={labels} districts={data.districts} missions={data.missions} selected={selected.id} onSelect={selectDistrict} progressKey={!data.inspecting && !data.preview ? `city-levels:${data.user_id}` : undefined} />

    <header className="city-hud glass glass--regular">
      <div className="city-hud__level">
        <span className="city-hud__badge" title={`Уровень города ${data.level}`}>{data.level}</span>
        <div className="city-hud__xp">
          <span><b>{rank}</b><span className="city-hud__wide"> · уровень {data.level}</span> · {data.xp} XP</span>
          <div className="city-meter" role="progressbar" aria-label="Опыт до следующего уровня города" aria-valuemin={0} aria-valuemax={data.level_target} aria-valuenow={data.level_progress}><span style={{width:`${data.level_progress/data.level_target*100}%`}} /></div>
        </div>
      </div>
      <div className="city-hud__stat"><strong>{completed}<small> / {total}</small></strong><span className="city-hud__label">миссий пройдено</span></div>
      {!data.preview && <div className="city-hud__coins"><span className="city-coin" aria-hidden="true">◈</span><span className="city-hud__stat"><strong>{data.balance.toLocaleString("ru-RU")}</strong><span className="city-hud__label">коинов в кошельке</span></span></div>}
      <nav className="city-hud__links" aria-label="Обучение">
        {user?.role !== "operator" && <Link to="/admin/learning/city" aria-label="Управление миссиями"><span aria-hidden="true">⚙︎</span><span className="city-hud__wide">Миссии</span></Link>}
        <Link to="/training" aria-label="Материалы обучения"><span aria-hidden="true">📚</span><span className="city-hud__wide">Материалы</span></Link>
      </nav>
    </header>

    <div className="city-notes">
      {data.inspecting && <p className="city-note glass glass--regular">Город оператора: <strong>{data.full_name}</strong><Link to="/admin/learning/city">← К участникам</Link></p>}
      {data.preview && !data.inspecting && <p className="city-note glass glass--regular">Предпросмотр для сотрудника · без наград</p>}
      {query.isError && <p className="city-note glass glass--regular" role="alert">Не удалось обновить город.<button type="button" onClick={() => query.refetch()}>Повторить</button></p>}
      {(needsGuide || guideEditing) && <CityGuideSetup onClose={needsGuide ? undefined : () => setGuideEditing(false)} />}
    </div>

    <aside className="city-mission glass glass--regular" data-expanded={expanded || undefined} aria-label={`Район «${selected.name}»`}>
      <button type="button" className="city-mission__handle" aria-expanded={expanded} aria-controls="city-mission-body" onClick={() => setExpanded(value => !value)}>
        <span aria-hidden="true" /><span className="sr-only">{expanded ? "Свернуть описание миссии" : "Развернуть описание миссии"}</span>
      </button>
      <div className="city-mission__body" id="city-mission-body" aria-live="polite">
        <div className="city-mission-top"><span className="city-eyebrow">{selected.name}</span><span className="city-state" data-state={mission?.state}>{selected.soon ? "СКОРО" : mission ? MISSION_STATES[mission.state] : "Нет заданий"}</span></div>
        <div className="city-building-level city-extra" aria-label={`Уровень здания ${level} из ${MAX_DISTRICT_LEVEL}`}><span>{"★".repeat(level)}<em>{"★".repeat(MAX_DISTRICT_LEVEL - level)}</em></span><strong>Здание: {DISTRICT_LEVEL_NAMES[level - 1]}</strong><small>{selected.soon ? "Район строится и откроется позже" : level < MAX_DISTRICT_LEVEL ? "Каждая пройденная миссия района улучшает здание" : "Максимальный уровень — район стал легендой"}</small></div>
        {!data.inspecting && selected.id === "driver" && <button className="city-secondary city-extra" onClick={() => setDriverLaunch(true)}>Открыть автопарк →</button>}
        {!data.inspecting && selected.id === "crm" && <Link className="city-secondary city-extra" to="/training/work-sites">Открыть CRM · рабочие сайты →</Link>}
        {selected.soon ? <>
          <h2>{selected.id === "dispatch" ? "Держать город в движении" : "Новый район. Новые возможности."}</h2>
          <p className="city-copy city-extra">{selected.id === "dispatch" ? "Этот район откроется вместе с учебной диспетчерской." : "Миссии появятся после добавления Oktell и подготовки учебных сценариев."}</p>
          <div className="city-guide city-extra"><PulsarFace /><p>А пока продолжим развивать автопарк и CRM-центр. Твой прогресс сохранится.</p></div>
        </> : mission && <>
          <nav className="city-mission-path city-extra" aria-label={`Миссии: ${selected.name}`}>{missions.map((m,i) => <button key={m.key} type="button" onClick={() => selectMission(m.key)} aria-label={`${i+1}. ${m.title}. ${MISSION_STATES[m.state]}`} aria-pressed={mission.key===m.key} data-state={m.state}>{m.state === "completed" ? "✓" : i+1}</button>)}</nav>
          <h2>{mission.title}</h2>
          <p className="city-copy city-extra">{mission.description}</p>
          <div className="city-objective city-extra"><span>{mission.objective}</span><strong>{mission.current} / {mission.target}</strong><div className="city-meter"><span style={{width:`${mission.current/mission.target*100}%`}} /></div></div>
          {mission.state === "locked" && <p className="city-prerequisite city-extra">Сначала завершите «{parent?.title}» и получите награду.</p>}
          <div className="city-rewards city-extra"><span>✦ {mission.xp} XP</span>{mission.coins > 0 && <span>◈ {mission.coins} коинов</span>}<span>{mission.state === "completed" ? "Получено" : "За прохождение"}</span></div>
          <div className="city-guide city-extra">
            {mascot.gender ? <span className="city-guide-avatar" aria-hidden="true">{GUIDE_AVATAR[mascot.gender]}</span> : <PulsarFace />}
            <p><b>{mascot.name}:</b> {guideText(mission.pulsar, mascot.name)}</p>
            {!data.inspecting && !needsGuide && !guideEditing && <button type="button" className="city-guide-edit" onClick={() => setGuideEditing(true)} aria-label="Изменить фигуру и имя помощника" title="Изменить помощника">✎</button>}
          </div>
        </>}
      </div>
      {/* Кнопка действия всегда на виду, описание над ней прокручивается. */}
      <div className="city-mission__footer">
        {selected.soon ? <button className="city-action" disabled>Район строится</button> : mission && <>
          {claim.isError && <p className="city-error" role="alert">{claim.error.message}</p>}
          {mission.state === "ready" && data.can_claim ? <button className="city-action" disabled={claim.isPending} onClick={() => claim.mutate(mission.key)}>{claim.isPending ? "Проверяем результат…" : mission.key === "welcome" ? "Начать свой путь →" : "Завершить и получить награду →"}</button> : actionable && mission.key !== "welcome" && !data.inspecting ? selected.id === "driver" ? <button className="city-action" onClick={() => setDriverLaunch(true)}>{mission.state === "completed" ? "Вернуться к практике →" : "Перейти к заданию →"}</button> : <Link className="city-action" to={mission.path}>{mission.state === "completed" ? "Вернуться к практике →" : "Перейти к заданию →"}</Link> : <button className="city-action" disabled>{mission.state === "unavailable" ? "Миссия на паузе" : data.inspecting ? "Просмотр прогресса" : data.preview ? "Предпросмотр без наград" : mission.state === "completed" ? "Миссия пройдена" : "Завершите предыдущую миссию"}</button>}
          <p className="city-fine city-extra">{selected.id === "crm" ? "Рабочие сайты открываются оператору через QR." : "Завершённые ранее действия тоже учитываются."}</p>
        </>}
      </div>
    </aside>

    <CitySkills labels={labels} selected={selected.id} onSelect={selectDistrict} />

    {reward && <Sheet title={reward.already_claimed ? "Эта награда уже получена" : "Миссия пройдена"} onClose={() => setReward(null)} size="s"><div className="city-celebration"><div className="city-medal" aria-hidden="true">✦</div><h2>{reward.title}</h2><p>{reward.already_claimed ? "Прогресс сохранён. Повторное начисление не требуется." : "Твой город стал немного больше. Следующая миссия уже ждёт."}</p><div className="city-rewards"><span>+{reward.xp} XP</span>{reward.coins>0&&<span>+{reward.coins} коинов</span>}</div><button className="city-action" onClick={()=>setReward(null)}>Вернуться в город →</button></div></Sheet>}
    {driverLaunch && <Sheet title="Автопарк · Driver Simulator" onClose={() => setDriverLaunch(false)}><DriverEntry /></Sheet>}
  </div>;
}

/** Нижняя панель «Твои навыки»: все районы города, на телефоне — лента под верхней панелью. */
function CitySkills({ labels, selected, onSelect }: { labels: CityLabelInfo[]; selected: DistrictId; onSelect: (id: DistrictId) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector("[aria-pressed=true]")?.scrollIntoView({ inline: "center", block: "nearest" }); }, [selected]);
  return <nav className="city-skills glass glass--regular" aria-label="Районы города">
    <div className="city-skills__title"><h2>Твои навыки</h2><p>Опыт города показывает путь обучения. Коины попадают в общий кошелёк Puls.</p></div>
    <div className="city-skills__list" ref={list}>
      {labels.map(l => <button type="button" key={l.id} className="city-skill" style={{ "--district": DISTRICT_COLORS[l.id] } as CSSProperties} aria-pressed={selected === l.id} data-soon={l.soon || undefined} data-reward={l.reward || undefined} onClick={() => onSelect(l.id)}>
        <span className="city-skill__icon" aria-hidden="true">{l.icon}</span>
        <span className="city-skill__text"><strong>{l.name}</strong><small>{l.status}</small></span>
      </button>)}
    </div>
  </nav>;
}
