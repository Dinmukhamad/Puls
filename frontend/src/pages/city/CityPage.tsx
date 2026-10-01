import { cityWorld, SALES_RESOURCES, type DepartmentId } from "../../api/cityWorld";
import { cityEstate } from "../../api/cityEstate";
import { CityWorldPanel, CityJourney } from "./CityWorldPanel";
import { CityEstateDock, type BuildState, type EstateTarget } from "./CityEstateDock";
import type { CityEstateView, EstatePick, JourneyPhase } from "../../city3d/types";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { city, MISSION_STATES, nextMission, POINT_KINDS, SITE_STAGES, type BuildingKey, type CityBuilt, type CityData, type CityGroup, type CityQuest, type CityReward, type DistrictId, type PointKind } from "../../api/city";
import { useAuth } from "../../auth/AuthContext";
import { ErrorState } from "../../components/ui";
import { Sheet } from "../../components/Sheet";
import { PulsarFace } from "../crm/PulsarGuide";
import { CityMap } from "./CityMap";
import { DISTRICT_LEVEL_NAMES, MAX_DISTRICT_LEVEL, districtLevel } from "./cityLevels";
import { DISTRICT_COLORS, districtLabels } from "./cityDistricts";
import type { CityLabelInfo } from "../../city3d/types";
import "../crm/pulsar.css";
import "./city.css";
import { DriverEntry } from "../DriverEntry";
import { CityGuideSetup, GUIDE_AVATAR } from "./CityGuideSetup";
import { CityControlsSetup } from "./CityControlsSetup";
import type { CityControls } from "../../api/types";
import { DEFAULT_GUIDE, guideName, guideText } from "../../guide";

/** Город во весь экран: 3D-карта под стеклянными панелями, как в игре. */
export function CityPage() {
  const { user } = useAuth(), client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const worldQuery = useQuery({ queryKey: ["city-world"], queryFn: cityWorld.get, refetchOnWindowFocus: true });
  const department: DepartmentId = params.get("city") === "sales" ? "sales" : params.get("city") === "support" || params.has("operator") || params.has("district") ? "support" : worldQuery.data?.home_city ?? "support";
  const [worldSelected, setWorldSelected] = useState<string | null>(null);
  const [worldAction, setWorldAction] = useState<{ kind: "travel" | "skip" | "focus"; target: string; at: number }>();
  const [journey, setJourney] = useState<JourneyPhase>(null), [destination, setDestination] = useState<DepartmentId>("sales");
  function visit(id: DepartmentId) { const next = new URLSearchParams(params); next.set("city", id); setParams(next); setWorldSelected(null); }
  function pickWorld(id: string) { setWorldSelected(id); if (id !== "world") setWorldAction({ kind: "focus", target: id, at: Date.now() }); }
  const operatorId = user?.role !== "operator" && /^\d+$/.test(params.get("operator") ?? "") ? Number(params.get("operator")) : null;
  const query = useQuery({ queryKey: ["city", operatorId ?? "self"], queryFn: () => operatorId ? city.operator(operatorId) : city.own(), refetchInterval: 15000, refetchOnWindowFocus: true });
  const [reward, setReward] = useState<CityReward | null>(null);
  const [driverLaunch, setDriverLaunch] = useState(false);
  const [guideEditing, setGuideEditing] = useState(false);
  // Камера: выбор оператора из профиля; пока карточка выбора открыта — схема, которую он пробует.
  const [controlsEditing, setControlsEditing] = useState(false), [controlsPreview, setControlsPreview] = useState<CityControls | null>(null);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "failed">("loading");
  // На телефоне панель миссии — шторка над нижним меню: свёрнута до заголовка и кнопки.
  const [expanded, setExpanded] = useState(false);
  const [focusRequest, requestFocus] = useState(0);
  const [plotKey, setPlotKey] = useState<string | null>(null), [built, setBuilt] = useState<CityBuilt | null>(null);
  const [plotFocus, setPlotFocus] = useState<{ key: string; at: number }>();
  const [questSlot, setQuestSlot] = useState<number | null>(null), [questFocus, setQuestFocus] = useState<{ slot: number; at: number }>();
  const answer = useMutation({ mutationFn: ({ slot, choice }: { slot: number; choice: number }) => city.answer(slot, choice), onSuccess: async () => { await client.invalidateQueries(); }, onError: () => { void query.refetch(); } });
  const [groupOpen, setGroupOpen] = useState(false), [siteFocus, setSiteFocus] = useState<{ key: string; at: number }>();
  const build = useMutation({ mutationFn: ({ plot, item }: { plot: string; item: BuildingKey }) => city.build(plot, item), onSuccess: async result => { setPlotKey(null); setBuilt(result); setPlotFocus({ key: result.plot, at: Date.now() }); await client.invalidateQueries(); }, onError: () => { void query.refetch(); } });
  const claim = useMutation({ mutationFn: (key: string) => city.claim(key, query.data!.revision), onSuccess: async result => { setReward(result); await client.invalidateQueries(); }, onError: () => { void query.refetch(); } });
  // Team district land: the viewer's own estate, and the districts of the city on screen, refreshed about every
  // 12 seconds (with a little spread) only while this page is open and visible.
  const estateQuery = useQuery({ queryKey: ["city-estate"], queryFn: cityEstate.mine, refetchOnWindowFocus: true });
  const landPoll = () => 10000 + Math.random() * 5000;
  const supportLand = useQuery({ queryKey: ["city-estates", "support"], queryFn: () => cityEstate.city("support"), enabled: department === "support", refetchInterval: landPoll, refetchOnWindowFocus: true });
  const salesLand = useQuery({ queryKey: ["city-estates", "sales"], queryFn: () => cityEstate.city("sales"), enabled: department === "sales", refetchInterval: landPoll, refetchOnWindowFocus: true });
  const estateViews = useMemo(() => {
    const views: Partial<Record<DepartmentId, CityEstateView>> = {};
    if (supportLand.data) views.support = { state: supportLand.data };
    if (salesLand.data) views.sales = { state: salesLand.data };
    return views;
  }, [supportLand.data, salesLand.data]);
  const [building, setBuilding] = useState<BuildState | null>(null), [estateFocus, setEstateFocus] = useState<EstateTarget & { at: number }>();
  const buildView = useMemo(() => building && { district: building.district, area: building.area, placing: building.placing, selected: building.selected, plot: building.plot && { block: building.plot.block, col: building.plot.col, row: building.plot.row } },
    [building?.district, building?.area, building?.placing, building?.selected, building?.plot]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusLand = (target: EstateTarget) => setEstateFocus({ ...target, at: Date.now() });
  const landOf = (district: string) => (district.startsWith("sales-") ? salesLand.data : supportLand.data)?.districts.find(d => d.id === district) ?? null;
  function onEstate(pick: EstatePick) {
    if (pick.kind === "place") setBuilding(b => b && { ...b, spot: { module: pick.module, u: pick.u, v: pick.v, rotation: pick.rotation, problem: pick.problem } });
    else if (pick.kind === "plot") setBuilding(b => b && { ...b, plot: { block: pick.block, col: pick.col, row: pick.row, band: pick.band, problem: pick.problem }, selected: null });
    else if (pick.kind === "project") setWorldSelected(pick.district);
    else if (pick.kind === "object") setBuilding(b => ({ district: pick.district, area: b?.district === pick.district ? b.area : "plots", placing: null, selected: pick.object, plot: null, spot: null, project: b?.district === pick.district ? b.project : false }));
  }
  /** Opens building in the operator's own district, in whichever city it is. */
  function openBuild() {
    const home = estateQuery.data?.district;
    if (!home) return;
    if (home.city !== department) visit(home.city);
    setBuilding({ district: home.id, area: "plots", placing: null, selected: null, plot: null, spot: null, project: false });
    focusLand({ district: home.id, kind: "district" });
  }
  useEffect(() => {
    if (!building) return;
    // Escape leaves the preview first, then the dock; it never undoes what the server already did.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(".sheet-overlay, [role=dialog][aria-modal=true]")) return;
      event.preventDefault();
      setBuilding(b => b && (b.placing ? { ...b, placing: null, spot: null, area: b.project ? "public" : "plots" } : b.plot || b.selected !== null ? { ...b, plot: null, selected: null } : null));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [!!building]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!query.data) return <div className="city-immersive city-immersive--empty">
    {query.isError ? <div className="city-empty-card glass glass--prominent"><ErrorState error={query.error} onRetry={() => query.refetch()} /></div> : <div className="city-loading" role="status"><span>Загружаем город…</span></div>}
  </div>;
  const data = query.data;
  const selected = data.districts.find(d => d.id === params.get("district")) ?? data.districts.find(d => d.id === nextMission(data.missions)?.district) ?? data.districts[0];
  const missions = data.missions.filter(m => m.district === selected.id);
  const mission = missions.find(m => m.key === params.get("mission")) ?? nextMission(missions);
  const completed = data.missions.filter(m => m.state === "completed").length;
  const total = data.missions.filter(m => m.enabled || m.state === "completed").length;
  function selectDistrict(id: DistrictId) { const p = new URLSearchParams(params); p.set("district", id); p.delete("mission"); setParams(p, {replace:true}); requestFocus(value => value + 1); claim.reset(); }
  function selectMission(key: string) { const p = new URLSearchParams(params); p.set("mission", key); setParams(p, {replace:true}); claim.reset(); }
  const parent = data.missions.find(m => m.key === mission?.prerequisite);
  const actionable = mission && !["locked", "unavailable"].includes(mission.state);
  // В чужом городе — фигура и помощник того оператора, в своём — свои.
  const mascot = data.inspecting ? { gender: data.gender ?? null, name: data.guide_name || DEFAULT_GUIDE } : { gender: user?.gender ?? null, name: guideName(user) };
  const labels = districtLabels(data.districts, data.missions);
  const needsGuide = !data.inspecting && !!user && (!user.gender || !user.guide_name);
  // При первом входе в свой город спрашиваем, как двигать камеру, — когда карта уже работает и схему
  // можно сразу попробовать. До выбора работает «как раньше». В чужом городе не спрашиваем.
  const needsControls = !data.inspecting && !!user && !user.city_controls;
  const controls: CityControls = controlsPreview ?? user?.city_controls ?? "orbit";
  const showControls = !needsGuide && !guideEditing && ((needsControls && mapStatus === "ready") || controlsEditing);
  function closeControls() {
    const fromTools = controlsEditing;
    setControlsEditing(false);
    // Фокус — туда, откуда пришли: на кнопку панели карты или на саму карту, чтобы сразу работали клавиши.
    window.setTimeout(() => document.querySelector<HTMLElement>(fromTools ? ".city-controls-button" : ".city-scene")?.focus({ preventScroll: true }), 0);
  }
  const rank = data.level < 2 ? "Новый житель" : data.level < 4 ? "Исследователь" : "Мастер города";
  const level = districtLevel(missions.filter(m => m.state === "completed").length, selected.soon);
  const districtPlots = data.plots.filter(p => p.district === selected.id);
  const freePlot = districtPlots.find(p => p.unlocked && !p.item);
  function openPlot(key: string) { build.reset(); setPlotKey(key); }
  const mineEstate = estateQuery.data, canOpenBuild = !!mineEstate?.district && (mineEstate.status === "ready" || mineEstate.status === "closed");
  return <div className="city-immersive" data-department={department} data-building={building ? true : undefined}>
    <CityMap department={department} departmentWorld={worldQuery.data} onWorldPick={pickWorld} onArrival={visit} onJourney={setJourney} worldAction={worldAction} estates={estateViews} build={buildView} onEstate={onEstate} estateFocus={estateFocus} sceneIdentity={`${data.user_id}:${data.inspecting ? "inspect" : "self"}`} forceWebGL={params.get("backend") === "webgl"} mascot={mascot} labels={labels} districts={data.districts} missions={data.missions} selected={selected.id} focusRequest={focusRequest} onSelect={selectDistrict} plots={data.plots} onPlot={data.can_build ? openPlot : undefined} plotFocus={plotFocus} sites={data.group?.projects ?? null} onSite={() => setGroupOpen(true)} siteFocus={siteFocus} quests={data.quests?.items ?? []} onQuest={data.inspecting ? undefined : slot => { answer.reset(); setQuestSlot(slot); }} questFocus={questFocus} controls={controls} onControls={user ? () => setControlsEditing(true) : undefined} controlsOpen={showControls} onStatus={setMapStatus} progressKey={!data.inspecting && !data.preview ? `city-levels:${data.user_id}` : undefined} />

    <header className="city-hud glass glass--regular">
      <div className="city-hud__level">
        <span className="city-hud__badge" title={`Уровень города ${data.level}`}>{data.level}</span>
        <div className="city-hud__xp">
          <span><b>{rank}</b><span className="city-hud__wide"> · уровень {data.level}</span> · {data.xp} XP</span>
          <div className="city-meter" role="progressbar" aria-label="Опыт до следующего уровня города" aria-valuemin={0} aria-valuemax={data.level_target} aria-valuenow={data.level_progress}><span style={{width:`${data.level_progress/data.level_target*100}%`}} /></div>
        </div>
      </div>
      <div className="city-hud__stat"><strong>{completed}<small> / {total}</small></strong><span className="city-hud__label">{department === "sales" ? "миссий в первом городе" : "миссий пройдено"}</span></div>
      {!data.preview && <div className="city-hud__coins"><span className="city-coin" aria-hidden="true">◈</span><span className="city-hud__stat"><strong>{data.balance.toLocaleString("ru-RU")}</strong><span className="city-hud__label">коинов в кошельке</span></span></div>}
      <nav className="city-hud__links" aria-label="Обучение">
        {canOpenBuild && <button type="button" className="city-group-button" data-open={building ? true : undefined} aria-pressed={!!building} onClick={() => building ? setBuilding(null) : openBuild()} aria-label={mineEstate!.district!.city === department ? "Строить в своём районе" : "Мой участок в другом городе"}><span aria-hidden="true">🏡</span><span className="city-hud__wide">{mineEstate!.district!.city === department ? "Строить" : "Мой участок"}</span></button>}
        {department === "support" && data.quests && data.quests.items.length > 0 && <button type="button" className="city-group-button" data-open={data.quests.items.some(q => !q.answered) || undefined} onClick={() => { const next = data.quests!.items.find(q => !q.answered) ?? data.quests!.items[0]; answer.reset(); setQuestSlot(next.slot); if (!next.answered) setQuestFocus({ slot: next.slot, at: Date.now() }); }} aria-label={`Задания дня: выполнено ${data.quests.items.filter(q => q.answered).length} из ${data.quests.items.length}`}><span aria-hidden="true">❗</span><span className="city-hud__wide">Задания</span> {data.quests.items.filter(q => q.answered).length}/{data.quests.items.length}</button>}
        {department === "support" && data.group && <button type="button" className="city-group-button" onClick={() => setGroupOpen(true)} aria-label={`Город группы: ${data.group.name}`}><span aria-hidden="true">🏗️</span><span className="city-hud__wide">Группа</span></button>}
        {user?.role !== "operator" && <Link to="/admin/learning/city" aria-label="Управление миссиями"><span aria-hidden="true">⚙︎</span><span className="city-hud__wide">Миссии</span></Link>}
        <Link to="/training" aria-label="Материалы обучения"><span aria-hidden="true">📚</span><span className="city-hud__wide">Материалы</span></Link>
      </nav>
    </header>

    <div className="city-notes">
      {data.inspecting && <p className="city-note glass glass--regular">Город оператора: <strong>{data.full_name}</strong><Link to="/admin/learning/city">← К участникам</Link></p>}
      {data.preview && !data.inspecting && <p className="city-note glass glass--regular">Предпросмотр для сотрудника · без наград</p>}
      {worldQuery.isError && <p className="city-note glass glass--regular" role="alert">Не удалось загрузить города и районы.<button type="button" onClick={() => worldQuery.refetch()}>Повторить</button></p>}
      {query.isError && <p className="city-note glass glass--regular" role="alert">Не удалось обновить город.<button type="button" onClick={() => query.refetch()}>Повторить</button></p>}
      {(needsGuide || guideEditing) && <CityGuideSetup onClose={needsGuide ? undefined : () => setGuideEditing(false)} />}
      {showControls && <CityControlsSetup value={controls} onPick={setControlsPreview} onClose={closeControls} cancellable={!needsControls} />}
    </div>

    {department === "support" && !building && <><aside className="city-mission glass glass--regular" data-expanded={expanded || undefined} aria-label={`Район «${selected.name}»`}>
      <button type="button" className="city-mission__handle" aria-expanded={expanded} aria-controls="city-mission-body" onClick={() => setExpanded(value => !value)}>
        <span aria-hidden="true" /><span className="sr-only">{expanded ? "Свернуть описание миссии" : "Развернуть описание миссии"}</span>
      </button>
      <div className="city-mission__body" id="city-mission-body" aria-live="polite">
        <div className="city-mission-top"><span className="city-eyebrow">{selected.name}</span><span className="city-state" data-state={mission?.state}>{selected.soon ? "СКОРО" : mission ? MISSION_STATES[mission.state] : "Нет заданий"}</span></div>
        <div className="city-building-level city-extra" aria-label={`Уровень здания ${level} из ${MAX_DISTRICT_LEVEL}`}><span>{"★".repeat(level)}<em>{"★".repeat(MAX_DISTRICT_LEVEL - level)}</em></span><strong>Здание: {DISTRICT_LEVEL_NAMES[level - 1]}</strong><small>{selected.soon ? "Район строится и откроется позже" : level < MAX_DISTRICT_LEVEL ? "Каждая пройденная миссия района улучшает здание" : "Максимальный уровень — район стал легендой"}</small></div>
        {districtPlots.length > 0 && <CityPlotsSummary plots={districtPlots} buildings={data.buildings} canBuild={data.can_build} moved={data.plots_moved} onShow={key => setPlotFocus({ key, at: Date.now() })} onBuild={freePlot && data.can_build ? () => { setPlotFocus({ key: freePlot.key, at: Date.now() }); openPlot(freePlot.key); } : undefined} />}
        {!data.inspecting && selected.id === "driver" && <button className="city-secondary city-extra" onClick={() => setDriverLaunch(true)}>Открыть автопарк →</button>}
        {!data.inspecting && selected.id === "crm" && <Link className="city-secondary city-extra" to="/training/work-sites">Открыть CRM · рабочие сайты →</Link>}
        {!data.inspecting && selected.id === "dispatch" && <Link className="city-secondary city-extra" to="/training/work-sites?site=dispatch">Открыть Диспетчерскую · рабочие сайты →</Link>}
        {selected.soon ? <>
          <h2>Новый район. Новые возможности.</h2>
          <p className="city-copy city-extra">Миссии появятся после добавления Oktell и подготовки учебных сценариев.</p>
          <div className="city-guide city-extra"><PulsarFace /><p>А пока продолжим развивать автопарк, CRM-центр и Диспетчерскую. Твой прогресс сохранится.</p></div>
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
            {!data.inspecting && !needsGuide && !guideEditing && !showControls && <button type="button" className="city-guide-edit" onClick={() => setGuideEditing(true)} aria-label="Изменить фигуру и имя помощника" title="Изменить помощника">✎</button>}
          </div>
        </>}
      </div>
      {/* Кнопка действия всегда на виду, описание над ней прокручивается. */}
      <div className="city-mission__footer">
        {selected.soon ? <button className="city-action" disabled>Район строится</button> : mission && <>
          {claim.isError && <p className="city-error" role="alert">{claim.error.message}</p>}
          {mission.state === "ready" && data.can_claim ? <button className="city-action" disabled={claim.isPending} onClick={() => claim.mutate(mission.key)}>{claim.isPending ? "Проверяем результат…" : mission.key === "welcome" ? "Начать свой путь →" : "Завершить и получить награду →"}</button> : actionable && mission.key !== "welcome" && !data.inspecting ? selected.id === "driver" ? <button className="city-action" onClick={() => setDriverLaunch(true)}>{mission.state === "completed" ? "Вернуться к практике →" : "Перейти к заданию →"}</button> : <Link className="city-action" to={mission.path}>{mission.state === "completed" ? "Вернуться к практике →" : "Перейти к заданию →"}</Link> : <button className="city-action" disabled>{mission.state === "unavailable" ? "Миссия на паузе" : data.inspecting ? "Просмотр прогресса" : data.preview ? "Предпросмотр без наград" : mission.state === "completed" ? "Миссия пройдена" : "Завершите предыдущую миссию"}</button>}
          <p className="city-fine city-extra">{selected.id === "crm" || selected.id === "dispatch" ? "Рабочие сайты открываются оператору через QR." : "Завершённые ранее действия тоже учитываются."}</p>
        </>}
      </div>
    </aside>

    <CitySkills labels={labels} selected={selected.id} onSelect={selectDistrict} /></>}
    {department === "sales" && !building && <aside className="city-sales-info glass glass--regular"><span className="city-eyebrow">ОТДЕЛ ПРОДАЖ</span><h2>{worldQuery.data?.cities.find(c => c.id === "sales")?.name ?? "ОП"}</h2><p>Учебный кампус у озера. Десять зданий зарезервированы для ресурсов отдела продаж.</p><button className="city-secondary" onClick={() => pickWorld("world")}>Районы и вокзал →</button><div className="city-sales-resources">{SALES_RESOURCES.map((name, i) => <button key={name} title={name} aria-label={name} onClick={() => pickWorld(`sales-resource-${String(i + 1).padStart(2, "0")}`)}>{i + 1}</button>)}</div></aside>}
    {worldQuery.data && <CityWorldPanel world={worldQuery.data} current={department} selected={worldSelected} onPick={pickWorld} onClose={() => setWorldSelected(null)} ready={mapStatus === "ready"} onVisit={visit} onTravel={id => { setDestination(id); setWorldAction({ kind: "travel", target: id, at: Date.now() }); }}
      estates={department === "sales" ? salesLand.data : supportLand.data} mine={mineEstate} onMyEstate={canOpenBuild ? openBuild : undefined}
      onOpenProject={district => { setBuilding({ district, area: "public", placing: null, selected: null, plot: null, spot: null, project: true }); focusLand({ district, kind: "public" }); }} />}
    {building && mineEstate && <CityEstateDock mine={mineEstate} land={landOf(building.district)} build={building} setBuild={setBuilding} onClose={() => setBuilding(null)} onFocus={focusLand} />}
    <CityJourney phase={journey} destination={worldQuery.data?.cities.find(c => c.id === destination)?.name ?? destination} onSkip={() => setWorldAction({ kind: "skip", target: destination, at: Date.now() })} />

    {reward && <Sheet title={reward.already_claimed ? "Эта награда уже получена" : "Миссия пройдена"} onClose={() => setReward(null)} size="s"><div className="city-celebration"><div className="city-medal" aria-hidden="true">✦</div><h2>{reward.title}</h2><p>{reward.already_claimed ? "Прогресс сохранён. Повторное начисление не требуется." : "Твой город стал немного больше. Следующая миссия уже ждёт."}</p><div className="city-rewards"><span>+{reward.xp} XP</span>{reward.coins>0&&<span>+{reward.coins} коинов</span>}</div><button className="city-action" onClick={()=>setReward(null)}>Вернуться в город →</button></div></Sheet>}
    {plotKey && <Sheet title={`Участок · ${data.districts.find(d => d.id === data.plots.find(p => p.key === plotKey)?.district)?.name ?? "район"}`} onClose={() => setPlotKey(null)}><CityCatalogue data={data} pending={build.isPending} error={build.isError ? build.error.message : null} onBuild={item => build.mutate({ plot: plotKey, item })} /></Sheet>}
    {built && <Sheet title="Построено!" onClose={() => setBuilt(null)} size="s"><div className="city-celebration"><div className="city-medal" aria-hidden="true">{data.buildings.find(b => b.key === built.item)?.icon ?? "🏗️"}</div><h2>{built.name}</h2><p>Постройка уже стоит в твоём районе. Каждый новый участок делает город твоим.</p><div className="city-rewards"><span>−{built.price} коинов</span><span>Осталось {built.balance.toLocaleString("ru-RU")}</span></div><button className="city-action" onClick={() => setBuilt(null)}>Смотреть город →</button></div></Sheet>}
    {questSlot !== null && data.quests?.items.find(q => q.slot === questSlot) && <Sheet title="Задание дня" onClose={() => setQuestSlot(null)} size="s"><CityQuestCard quest={data.quests.items.find(q => q.slot === questSlot)!} reward={data.quests.coins} readOnly={data.inspecting || data.preview} pending={answer.isPending} error={answer.isError ? answer.error.message : null} onAnswer={choice => answer.mutate({ slot: questSlot, choice })} onNext={(() => { const next = data.quests!.items.find(q => !q.answered && q.slot !== questSlot); return next ? () => { answer.reset(); setQuestSlot(next.slot); setQuestFocus({ slot: next.slot, at: Date.now() }); } : undefined; })()} /></Sheet>}
    {groupOpen && data.group && <Sheet title={`Город группы · ${data.group.name}`} onClose={() => setGroupOpen(false)}><CityGroupPanel group={data.group} own={!data.inspecting} onShow={key => { setGroupOpen(false); setSiteFocus({ key, at: Date.now() }); }} /></Sheet>}
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


/** The district's plots in the mission panel: how many are built, and the way to the next free one. */
function CityPlotsSummary({ plots, buildings, canBuild, moved, onShow, onBuild }: { plots: CityData["plots"]; buildings: CityData["buildings"]; canBuild: boolean; moved?: boolean; onShow: (key: string) => void; onBuild?: () => void }) {
  const built = plots.filter(p => p.item), open = plots.some(p => p.unlocked);
  return <div className="city-plots city-extra">
    <div className="city-plots__head"><strong>Участки района</strong><span>{built.length} из {plots.length} застроено</span></div>
    <div className="city-plots__list">{plots.map(p => {
      const b = buildings.find(item => item.key === p.item);
      return <button type="button" key={p.key} data-state={p.item ? "built" : p.unlocked ? "open" : "locked"} onClick={() => onShow(p.key)} aria-label={b ? `Участок: ${b.name}` : p.unlocked ? "Свободный участок" : "Участок закрыт"} title={b?.name ?? (p.unlocked ? "Свободный участок" : "Откроется после первой миссии района")}>{b ? b.icon : p.unlocked ? "＋" : "🔒"}</button>;
    })}</div>
    {moved ? <small>Новые постройки теперь появляются в районе твоей команды — кнопка «Строить». Прежние остаются здесь.</small> : !open ? <small>Участки откроются после первой пройденной миссии района.</small> : onBuild ? <button type="button" className="city-secondary" onClick={onBuild}>Построить на свободном участке →</button> : canBuild ? <small>Все участки района застроены.</small> : null}
  </div>;
}

/** What can be built on a plot, with the price in coins from the common wallet. */
function CityCatalogue({ data, pending, error, onBuild }: { data: CityData; pending: boolean; error: string | null; onBuild: (item: BuildingKey) => void }) {
  return <div className="city-catalogue">
    <p className="city-catalogue__balance">Можно потратить <strong>◈ {data.available.toLocaleString("ru-RU")}</strong> {data.available < data.balance ? "(часть коинов в резерве по заявкам магазина)" : "коинов"}. Постройка остаётся на участке навсегда.</p>
    {error && <p className="city-error" role="alert">{error}</p>}
    <ul>{data.buildings.map(b => {
      const missing = b.price - data.available;
      return <li key={b.key}>
        <span className="city-catalogue__icon" aria-hidden="true">{b.icon}</span>
        <span className="city-catalogue__text"><strong>{b.name}</strong><small>{b.description}</small></span>
        <button type="button" className="city-action" disabled={pending || missing > 0} onClick={() => onBuild(b.key)} aria-label={`Построить «${b.name}» за ${b.price} коинов`}>{missing > 0 ? `Не хватает ${missing}` : `◈ ${b.price}`}</button>
      </li>;
    })}</ul>
  </div>;
}

const STAGE_STEPS = ["foundation", "frame", "floors", "done"] as const;
/** The group's quarters by stage, and the viewer's own points: never another operator's. */
function CityGroupPanel({ group, own, onShow }: { group: CityGroup; own: boolean; onShow: (key: string) => void }) {
  const built = group.projects.filter(p => p.stage === "done").length;
  return <div className="city-group">
    <p className="city-group__lead">Операторы группы строят эти кварталы вместе: каждая миссия, заказ и обращение двигает стройку. Видно только общий результат — чужие показатели скрыты.</p>
    <ol className="city-group__projects">{group.projects.map(p => {
      const step = STAGE_STEPS.indexOf(p.stage as typeof STAGE_STEPS[number]);
      return <li key={p.key} data-stage={p.stage}>
        <button type="button" onClick={() => onShow(p.key)} aria-label={`${p.name}: ${SITE_STAGES[p.stage]}. Показать на карте`}>
          <span className="city-group__icon" aria-hidden="true">{p.stage === "done" ? "🏙️" : p.stage === "planned" ? "📐" : "🏗️"}</span>
          <span className="city-group__name"><strong>{p.name}</strong><small>{SITE_STAGES[p.stage]}</small></span>
          <span className="city-group__steps" aria-hidden="true">{STAGE_STEPS.map((s, i) => <i key={s} data-on={i <= step || undefined} />)}</span>
        </button>
      </li>;
    })}</ol>
    <p className="city-fine">Построено {built} из {group.projects.length}.{group.small ? " В группе меньше трёх человек, поэтому стадия строящегося квартала скрыта: видны только готовые." : ""}</p>
    <div className="city-group__mine">
      <div className="city-plots__head"><strong>{own ? "Твой вклад" : "Вклад оператора"}</strong><span>{group.mine.points} очков</span></div>
      <ul>{(Object.keys(POINT_KINDS) as PointKind[]).map(k => <li key={k}><span>{POINT_KINDS[k]}</span><span>{group.mine[k]} × {group.points[k]}</span></li>)}</ul>
      {own && <small>Эти цифры видишь только ты и твои руководители.</small>}
    </div>
  </div>;
}

const GIVER_ICONS: Record<CityQuest["giver"], string> = { driver: "🚕", client: "📞", guide: "💡" };
/** The icon follows who speaks; a question without a speaker takes its place on the map. */
const speakerIcon = (quest: CityQuest) => /водител/i.test(quest.speaker) ? "🚕" : /клиент|звонящ/i.test(quest.speaker) ? "📞" : GIVER_ICONS[quest.giver];
/** One daily situation: who asks, what happened, the options; after the answer, the right one and why. */
function CityQuestCard({ quest, reward, readOnly, pending, error, onAnswer, onNext }: { quest: CityQuest; reward: number; readOnly: boolean; pending: boolean; error: string | null; onAnswer: (choice: number) => void; onNext?: () => void }) {
  return <div className="city-quest">
    <div className="city-quest__who"><span aria-hidden="true">{speakerIcon(quest)}</span><span><strong>{quest.speaker || "Ситуация"}</strong><small>{quest.title}</small></span></div>
    <p className="city-quest__text">{quest.text}</p>
    <div className="city-quest__options" role="group" aria-label="Варианты ответа">{quest.options.map((option, i) => {
      const state = !quest.answered ? undefined : i === quest.right ? "right" : i === quest.answer ? "wrong" : undefined;
      return <button type="button" key={i} data-state={state} disabled={quest.answered || pending || readOnly} onClick={() => onAnswer(i)}>{option}</button>;
    })}</div>
    {error && <p className="city-error" role="alert">{error}</p>}
    {quest.answered ? <div className="city-quest__result" data-correct={quest.correct || undefined} role="status">
      <strong>{quest.correct ? `Верно! +${quest.coins} коинов` : "Не совсем так"}</strong>
      {quest.explanation && <p>{quest.explanation}</p>}
      {onNext ? <button type="button" className="city-action" onClick={onNext}>Следующее задание →</button> : <small>На сегодня всё. Новые задания появятся завтра.</small>}
    </div> : <p className="city-fine">{readOnly ? "Просмотр: отвечать может только сам оператор." : `Один ответ. Верный ответ — +${reward} коинов и очки для города группы.`}</p>}
  </div>;
}
