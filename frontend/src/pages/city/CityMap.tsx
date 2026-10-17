import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { CityDistrict, CityMission, CityPlot, CityQuest, DistrictId } from "../../api/city";
import type { CityBuildView, CityControl, CityControlScheme, CityEstateView, CityLabelInfo, CityMascot, EstatePick, EstateTarget, TimeOfDay } from "../../city3d/types";
import { CONTROL_SCHEMES } from "./cityControls";
import { completedDistrictMissions, districtLevel, grownDistricts, newToAccount, seenLevels } from "./cityLevels";
import { useAuth } from "../../auth/AuthContext";
import type { CityWorld, DepartmentId } from "../../api/cityWorld";
import type { JourneyPhase } from "../../city3d/types";
import { retainedCity } from "./retainedCity";
import { CityPeekPanel } from "./CityPeekPanel";
import { watchCityStartup } from "./startupDeadline";

/**
 * The 3D city fills the whole screen behind the glass panels. `.city-frame` marks the part the panels
 * leave free, and the camera centres the city there. `progressKey` remembers in this browser the levels this viewer
 * has seen, `levelsSeen` are the ones the account has seen on any device and `onLevelsSeen` records new ones, so an
 * upgrade is celebrated once.
 */
export function CityMap({ department = "support", departmentWorld, onWorldPick, onArrival, onJourney, worldAction, estates, build = null, onEstate, estateFocus, sceneIdentity, districts, missions, labels, selected, onSelect, progressKey, levelsSeen = null, onLevelsSeen, mascot, forceWebGL = false, focusRequest = 0, plots = [], quests = [], onQuest, questFocus, controls = "orbit", onControls, controlsOpen = false, onStatus, onRetry }: { department?: DepartmentId; departmentWorld?: CityWorld; onWorldPick?: (id: string) => void; onArrival?: (id: DepartmentId) => void; onJourney?: (phase: JourneyPhase) => void; worldAction?: { kind: "travel" | "skip" | "focus"; target: string; at: number };
  /** Team district land of both cities, the build mode, taps on the land; `estateFocus` flies there when it changes. */
  estates?: Partial<Record<DepartmentId, CityEstateView>>; build?: CityBuildView | null; onEstate?: (pick: EstatePick) => void;
  estateFocus?: EstateTarget & { at: number };
  sceneIdentity: string; districts: CityDistrict[]; missions: CityMission[]; labels: CityLabelInfo[]; selected: DistrictId; onSelect: (id: DistrictId) => void; progressKey?: string; levelsSeen?: Record<string, number> | null; onLevelsSeen?: (levels: Record<string, number>) => void; mascot?: CityMascot; forceWebGL?: boolean; focusRequest?: number;
  /** What the operator built on the plots behind the learning districts; the others stand built up for everyone. */
  plots?: CityPlot[];
  /** Today's situations; `onQuest` (the operator themself) opens one from its "!"; `questFocus` flies to one. */
  quests?: CityQuest[]; onQuest?: (slot: number) => void; questFocus?: { slot: number; at: number };
  /** How the mouse moves the camera (the operator's choice); `onControls` opens the choice from the map tools. */
  controls?: CityControlScheme; onControls?: () => void; controlsOpen?: boolean;
  /** Whether the 3D map works: the page waits for it before offering the camera choice. */
  onStatus?: (status: "loading" | "ready" | "failed") => void; onRetry?: () => void }) {
  const worldRef = useRef({ department, departmentWorld, onWorldPick, onArrival, onJourney, estates, build, onEstate });
  worldRef.current = { department, departmentWorld, onWorldPick, onArrival, onJourney, estates, build, onEstate };
  const mascotRef = useRef(mascot); mascotRef.current = mascot;
  const mount = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>();
  const control = useRef<CityControl>();
  const questsKey = JSON.stringify(quests.map(q => ({ slot: q.slot, giver: q.giver, answered: q.answered }))), questsRef = useRef(quests), questRef = useRef(onQuest);
  questsRef.current = quests; questRef.current = onQuest;
  const canQuest = !!onQuest;
  const plotsKey = JSON.stringify(plots.map(p => [p.key, p.unlocked, p.item])), plotsRef = useRef(plots);
  plotsRef.current = plots;
  // The city (docs/CITY_V3_TZ.md) with its full map of ten islands (?world=v1: the five-island layout).
  // The stats overlay is for staff.
  const { user, atLeast } = useAuth(), staff = atLeast("supervisor");
  const owner = `${user?.id}:${user?.role}`;
  const [params] = useSearchParams();
  const world = params.get("world") === "v1" ? "v1" : "x4";
  const showStats = staff && params.get("stats") === "1";
  const webGL = forceWebGL || params.get("backend") === "webgl";
  const selectRef = useRef(onSelect), selectedRef = useRef(selected);
  selectRef.current = onSelect; selectedRef.current = selected;
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(() => {
    try { return localStorage.getItem("puls.city.time-of-day") === "night" ? "night" : "day"; } catch { return "day"; }
  });
  const timeRef = useRef(timeOfDay); timeRef.current = timeOfDay;
  const controlsRef = useRef(controls); controlsRef.current = controls;
  const statusRef = useRef(onStatus); statusRef.current = onStatus;
  const [traffic, setTraffic] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const trafficRef = useRef(traffic); trafficRef.current = traffic;
  const levels = Object.fromEntries(districts.map(d => [d.id, completedDistrictMissions(d, missions)]));
  const levelKey = JSON.stringify(levels);
  const levelsRef = useRef(levels); levelsRef.current = levels;
  const growthRef = useRef<() => DistrictId[]>(() => []);
  // What this visit has already shown: the account's record may arrive with the next poll.
  const shownRef = useRef<Record<string, number> | null>(null);
  growthRef.current = () => {
    if (!progressKey) return [];
    const current = Object.fromEntries(districts.map(d => [d.id, districtLevel(levelsRef.current[d.id] ?? 0, d.soon)]));
    let browser: Record<string, number> | null = null;
    try { browser = JSON.parse(localStorage.getItem(progressKey) ?? "null"); } catch { /* The account's record still counts. */ }
    const grown = grownDistricts(seenLevels(levelsSeen, browser, shownRef.current), current) as DistrictId[];
    shownRef.current = current;
    try { localStorage.setItem(progressKey, JSON.stringify(current)); } catch { /* Stored on the server below. */ }
    if (newToAccount(levelsSeen, current)) onLevelsSeen?.(current);
    return grown;
  };
  const labelsKey = JSON.stringify(labels), labelsRef = useRef(labels);
  labelsRef.current = labels;
  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | undefined;
    let stopDeadline: (() => void) | undefined;
    const fail = () => { if (!cancelled) { stopDeadline?.(); setReady(false); setFailed(true); } };
    const loaded = () => { if (!cancelled) { stopDeadline?.(); setProgress(1); setFailed(false); setReady(true); } };
    setFailed(false); setReady(false); setProgress(0); setReloadRequired(true);
    stopDeadline = watchCityStartup(() => {
      if (cancelled) return;
      // Retrying must not reacquire the same stalled runtime or its late callbacks.
      cancelled = true; release?.(); retainedCity.clear();
      control.current = undefined; host.current = undefined;
      setReady(false); setFailed(true);
    });
    void import("../../city3d").then(({ createCity }) => {
      if (cancelled || !mount.current) return;
      setReloadRequired(false);
      const visit = retainedCity.acquire({
        owner, key: JSON.stringify([sceneIdentity, world, webGL, showStats, canQuest]),
        mount: mount.current, traffic: trafficRef.current, create: createCity,
        options: {
        department: worldRef.current.department, departmentWorld: worldRef.current.departmentWorld,
        onWorldPick: id => worldRef.current.onWorldPick?.(id), onArrival: id => worldRef.current.onArrival?.(id), onJourney: phase => worldRef.current.onJourney?.(phase),
        estates: worldRef.current.estates, build: worldRef.current.build, onEstate: pick => { if (!cancelled) worldRef.current.onEstate?.(pick); },
        world, forceWebGL: webGL, stats: showStats, timeOfDay: timeRef.current, controls: controlsRef.current,
        plots: plotsRef.current.map(({ key, unlocked, item }) => ({ key, unlocked, item })),
        quests: questsRef.current.map(({ slot, giver, answered }) => ({ slot, giver, answered })), onQuest: canQuest ? slot => { if (!cancelled) questRef.current?.(slot); } : undefined,
        levels: levelsRef.current, selected: selectedRef.current, labels: labelsRef.current, grown: growthRef.current(), mascot: mascotRef.current,
        onSelect: id => { if (!cancelled) selectRef.current(id); }, onView: () => { /* The retained camera owns its view between visits. */ },
        onReady: loaded, onLost: fail, onRestored: loaded,
        onProgress: share => { if (!cancelled) setProgress(share); },
        },
      });
      control.current = visit.control; host.current = visit.host; release = visit.release;
      visit.host.setAttribute("aria-label", mapLabel(controlsRef.current));
      setTraffic(visit.traffic); setProgress(visit.progress);
      if (visit.status === "ready") loaded(); else if (visit.status === "failed") fail();
    }).catch(fail);
    return () => { cancelled = true; stopDeadline?.(); release?.(); control.current = undefined; host.current = undefined; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- live server state updates below; only a different scene/capability creates a runtime
  }, [owner, sceneIdentity, world, webGL, showStats, canQuest]);
  useEffect(() => { control.current?.setDepartment(department); }, [department]);
  useEffect(() => { if (departmentWorld) control.current?.setDepartmentWorld(departmentWorld); }, [departmentWorld]);
  useEffect(() => { if (estates?.support) control.current?.setEstates("support", estates.support); }, [estates?.support]);
  useEffect(() => { if (estates?.sales) control.current?.setEstates("sales", estates.sales); }, [estates?.sales]);
  useEffect(() => { control.current?.setBuild(build); }, [build]);
  // A build request can arrive before the retained runtime or its land meshes exist.
  // Replay the current request once that runtime is ready, including capability-driven recreations.
  useEffect(() => { if (ready && estateFocus) control.current?.focusEstate(estateFocus); }, [estateFocus?.at, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!worldAction) return;
    if (worldAction.kind === "travel") control.current?.travelTo(worldAction.target as DepartmentId);
    else if (worldAction.kind === "skip") control.current?.skipTravel();
    else control.current?.focusWorld(worldAction.target);
  }, [worldAction]);
  useEffect(() => { if (control.current) control.current.setLevels(levelsRef.current, growthRef.current()); }, [levelKey]);
  useEffect(() => { control.current?.setQuests(JSON.parse(questsKey)); }, [questsKey]);
  useEffect(() => { if (questFocus) control.current?.focusQuest(questFocus.slot); }, [questFocus?.slot, questFocus?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { control.current?.setPlots(JSON.parse(plotsKey).map(([key, unlocked, item]: [string, boolean, CityPlot["item"]]) => ({ key, unlocked, item }))); }, [plotsKey]);
  useEffect(() => {
    control.current?.setTimeOfDay(timeOfDay);
    try { localStorage.setItem("puls.city.time-of-day", timeOfDay); } catch { /* Scene controls also work without storage. */ }
  }, [timeOfDay]);
  useEffect(() => { control.current?.select(selected); }, [selected, focusRequest]);
  useEffect(() => { if (mascot) control.current?.setMascot(mascot); }, [mascot?.gender, mascot?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { control.current?.setLabels(JSON.parse(labelsKey)); }, [labelsKey]);
  useEffect(() => { control.current?.setTraffic(traffic); }, [traffic]);
  useEffect(() => { control.current?.setControls(controls); host.current?.setAttribute("aria-label", mapLabel(controls)); }, [controls]);
  useEffect(() => { statusRef.current?.(failed ? "failed" : ready ? "ready" : "loading"); }, [ready, failed]);
  useEffect(() => { if (host.current) host.current.tabIndex = failed ? -1 : 0; }, [failed]);
  function key(event: KeyboardEvent) {
    // The v3 city reads its keys itself (moving, turning and tilting while held) and marks them handled.
    const c = control.current; if (!c || event.nativeEvent.defaultPrevented) return;
    const actions: Record<string, () => void> = { ArrowLeft: () => c.rotate(-.35), ArrowRight: () => c.rotate(.35), ArrowUp: () => c.tilt(-.15), ArrowDown: () => c.tilt(.15), "+": () => c.zoom(.8), "=": () => c.zoom(.8), "-": () => c.zoom(1.25), "0": () => c.reset() };
    const action = actions[event.key]; if (action) { event.preventDefault(); action(); }
  }
  const live = !failed && ready;
  // The mouse moves the camera as the operator chose (city3d/engine/camera.ts mouseGesture).
  return <section className={`city-world${failed ? " city-world--fallback" : ""}${live ? " is-ready" : ""}`} aria-label="Карта твоего города">
    <div ref={mount} className="city-mount" style={{ position: "absolute", inset: 0 }} onKeyDown={key} />
    {!failed && !ready && <div className="city-loading" role="status"><span>{progress < .3 ? "Запускаем карту…" : progress < .75 ? "Загружаем здания…" : "Подготавливаем город…"} {Math.round(progress * 100)}%</span></div>}
    {failed && <div className="city-fallback" role="status"><span aria-hidden="true">🏙️</span><strong>Не удалось загрузить карту города</strong><small>Попробуй загрузить карту ещё раз. Навыки и задания — на панели сверху.</small>{onRetry && <button type="button" className="city-secondary" onClick={() => reloadRequired ? window.location.reload() : onRetry()}>Повторить загрузку карты</button>}</div>}
    {live && <span className="city-map-hint" key={controls}>{CONTROL_SCHEMES[controls].hint}</span>}
    {!failed && <CityPeekPanel label="Управление картой" compactLabel="Карта" toolbarSlot="tools" icon={<span aria-hidden="true">⚙</span>} className="city-map-peek">
      <div className="city-map-tools glass glass--regular" role="toolbar" aria-label="Управление картой" aria-orientation="horizontal">
      <button type="button" className="city-time-toggle" aria-label={timeOfDay === "day" ? "Включить ночной режим" : "Включить дневной режим"} title={timeOfDay === "day" ? "Включить ночной режим" : "Включить дневной режим"} aria-pressed={timeOfDay === "night"} onClick={() => setTimeOfDay(value => value === "day" ? "night" : "day")}><span aria-hidden="true">{timeOfDay === "day" ? "☀" : "☾"}</span><small>{timeOfDay === "day" ? "День" : "Ночь"}</small></button>
      <button type="button" aria-label="Посмотреть помощника" disabled={department !== "support"} onClick={() => control.current?.focusMascot()}>♙</button>
      {onControls && <button type="button" className="city-controls-button" aria-label={`Управление камерой: ${CONTROL_SCHEMES[controls].title.toLowerCase()}`} title="Управление камерой" aria-expanded={controlsOpen} aria-controls={controlsOpen ? "city-controls-setup" : undefined} onClick={onControls}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="6" /><path d="M12 3v6M6.5 9h11" /><circle cx="12" cy="6.5" r=".9" /></svg>
      </button>}
      <button type="button" aria-label={traffic ? "Приостановить движение" : "Включить движение"} title={traffic ? "Пауза движения" : "Возобновить движение"} aria-pressed={!traffic} onClick={() => setTraffic(value => !value)}>{traffic ? "Ⅱ" : "▶"}</button>
      <button type="button" aria-label="Приблизить" onClick={() => control.current?.zoom(.75)}>＋</button>
      <button type="button" aria-label="Отдалить" onClick={() => control.current?.zoom(1.33)}>－</button>
      <button type="button" aria-label="Исходный вид" onClick={() => control.current?.reset()}>⌂</button>
      </div>
    </CityPeekPanel>}
  </section>;
}

function mapLabel(controls: CityControlScheme) {
  const mouse = controls === "orbit" ? "Мышь: тянуть — вращать, правая кнопка — двигать город, колесо — масштаб." : "Мышь: тянуть — двигать город, правая кнопка — поворот и наклон, колесо — масштаб.";
  return `3D-карта города. ${mouse} Стрелки или W, A, S, D — двигаться, Q и E — поворот, R и F — наклон, плюс и минус — масштаб, ноль — исходный вид.`;
}
