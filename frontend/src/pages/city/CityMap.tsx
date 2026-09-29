import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { CityDistrict, CityGroup, CityMission, CityPlot, CityQuest, DistrictId } from "../../api/city";
import type { CityControl, CityLabelInfo, CityMascot, CityView, TimeOfDay } from "../../city3d/types";
import { districtLevel, grownDistricts } from "./cityLevels";
import { useAuth } from "../../auth/AuthContext";

/**
 * The 3D city fills the whole screen behind the glass panels. `.city-frame` marks the part the panels
 * leave free, and the camera centres the city there. `progressKey` remembers the levels this viewer has
 * seen, so an upgrade is celebrated once.
 */
export function CityMap({ districts, missions, labels, selected, onSelect, progressKey, mascot, forceWebGL = false, focusRequest = 0, plots = [], onPlot, plotFocus, sites = null, onSite, siteFocus, quests = [], onQuest, questFocus }: { districts: CityDistrict[]; missions: CityMission[]; labels: CityLabelInfo[]; selected: DistrictId; onSelect: (id: DistrictId) => void; progressKey?: string; mascot?: CityMascot; forceWebGL?: boolean; focusRequest?: number;
  /** The operator's plots; `onPlot` (when the viewer may build) opens the catalogue; `plotFocus` flies to a plot when it changes. */
  plots?: CityPlot[]; onPlot?: (key: string) => void; plotFocus?: { key: string; at: number };
  /** The group's quarters (null: no group, all built); `onSite` opens the group panel; `siteFocus` flies to a quarter. */
  sites?: CityGroup["projects"] | null; onSite?: (key: string) => void; siteFocus?: { key: string; at: number };
  /** Today's situations; `onQuest` (the operator themself) opens one from its "!"; `questFocus` flies to one. */
  quests?: CityQuest[]; onQuest?: (slot: number) => void; questFocus?: { slot: number; at: number } }) {
  const mascotRef = useRef(mascot); mascotRef.current = mascot;
  const host = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null);
  const control = useRef<CityControl>();
  const questsKey = JSON.stringify(quests.map(q => ({ slot: q.slot, giver: q.giver, answered: q.answered }))), questsRef = useRef(quests), questRef = useRef(onQuest);
  questsRef.current = quests; questRef.current = onQuest;
  const canQuest = !!onQuest;
  const sitesKey = JSON.stringify(sites), sitesRef = useRef(sites), siteRef = useRef(onSite);
  sitesRef.current = sites; siteRef.current = onSite;
  const plotsKey = JSON.stringify(plots.map(p => [p.key, p.unlocked, p.item])), plotsRef = useRef(plots), plotRef = useRef(onPlot);
  plotsRef.current = plots; plotRef.current = onPlot;
  const canBuild = !!onPlot;
  // The city (docs/CITY_V3_TZ.md) with its full map of ten islands (?world=v1: the five-island layout).
  // The stats overlay is for staff.
  const { atLeast } = useAuth(), staff = atLeast("supervisor");
  const [params] = useSearchParams();
  const world = params.get("world") === "v1" ? "v1" : "x4";
  const showStats = staff && params.get("stats") === "1";
  const webGL = forceWebGL || params.get("backend") === "webgl";
  const sceneKey = world;
  const viewScene = useRef(sceneKey);
  const view = useRef<CityView>();
  const selectRef = useRef(onSelect), selectedRef = useRef(selected);
  selectRef.current = onSelect; selectedRef.current = selected;
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(() => {
    try { return localStorage.getItem("puls.city.time-of-day") === "night" ? "night" : "day"; } catch { return "day"; }
  });
  const timeRef = useRef(timeOfDay); timeRef.current = timeOfDay;
  const [traffic, setTraffic] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const trafficRef = useRef(traffic); trafficRef.current = traffic;
  const levels = Object.fromEntries(districts.map(d => [d.id, missions.filter(m => m.district === d.id && m.state === "completed").length]));
  const levelKey = JSON.stringify(levels);
  const labelsKey = JSON.stringify(labels), labelsRef = useRef(labels);
  labelsRef.current = labels;
  useEffect(() => {
    let cancelled = false;
    // The two worlds use different scales, so a camera must not carry from one to the other.
    if (viewScene.current !== sceneKey) { view.current = undefined; viewScene.current = sceneKey; }
    setFailed(false); setReady(false);
    const current = Object.fromEntries(districts.map(d => [d.id, districtLevel(JSON.parse(levelKey)[d.id] ?? 0, d.soon)]));
    let grown: DistrictId[] = [];
    if (progressKey) {
      try { grown = grownDistricts(JSON.parse(localStorage.getItem(progressKey) ?? "null"), current) as DistrictId[]; localStorage.setItem(progressKey, JSON.stringify(current)); } catch { /* Celebration is optional. */ }
    }
    void import("../../city3d").then(({ createCity }) => {
      if (cancelled || !host.current) return;
      control.current = createCity(host.current, {
        world, forceWebGL: webGL, stats: showStats, timeOfDay: timeRef.current,
        plots: plotsRef.current, onPlot: canBuild ? key => { if (!cancelled) plotRef.current?.(key); } : undefined,
        sites: sitesRef.current, onSite: key => { if (!cancelled) siteRef.current?.(key); },
        quests: questsRef.current, onQuest: canQuest ? slot => { if (!cancelled) questRef.current?.(slot); } : undefined,
        levels: JSON.parse(levelKey), selected: selectedRef.current, view: view.current, labels: labelsRef.current, grown, mascot: mascotRef.current, frame: frame.current ?? undefined,
        onSelect: id => { if (!cancelled) selectRef.current(id); }, onView: value => { if (!cancelled) view.current = value; },
        onReady: () => { if (!cancelled) setReady(true); }, onLost: () => { if (!cancelled) setFailed(true); },
        onRestored: () => { if (!cancelled) setFailed(false); },
      });
      control.current.setTraffic(trafficRef.current);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; control.current?.dispose(); control.current = undefined; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mission state and engine settings recreate the scene; labels/selection update in place
  }, [levelKey, sceneKey, webGL, showStats, canBuild, canQuest]);
  useEffect(() => { control.current?.setQuests(JSON.parse(questsKey)); }, [questsKey]);
  useEffect(() => { if (questFocus) control.current?.focusQuest(questFocus.slot); }, [questFocus?.slot, questFocus?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { control.current?.setPlots(JSON.parse(plotsKey).map(([key, unlocked, item]: [string, boolean, CityPlot["item"]]) => ({ key, unlocked, item }))); }, [plotsKey]);
  useEffect(() => { control.current?.setSites(JSON.parse(sitesKey)); }, [sitesKey]);
  useEffect(() => { if (siteFocus) control.current?.focusSite(siteFocus.key); }, [siteFocus?.key, siteFocus?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (plotFocus) control.current?.focusPlot(plotFocus.key); }, [plotFocus?.key, plotFocus?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    control.current?.setTimeOfDay(timeOfDay);
    try { localStorage.setItem("puls.city.time-of-day", timeOfDay); } catch { /* Scene controls also work without storage. */ }
  }, [timeOfDay]);
  useEffect(() => { control.current?.select(selected); }, [selected, focusRequest]);
  useEffect(() => { if (mascot) control.current?.setMascot(mascot); }, [mascot?.gender, mascot?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { control.current?.setLabels(JSON.parse(labelsKey)); }, [labelsKey]);
  useEffect(() => { control.current?.setTraffic(traffic); }, [traffic]);
  function key(event: KeyboardEvent) {
    // The v3 city reads its keys itself (moving, turning and tilting while held) and marks them handled.
    const c = control.current; if (!c || event.nativeEvent.defaultPrevented) return;
    const actions: Record<string, () => void> = { ArrowLeft: () => c.rotate(-.35), ArrowRight: () => c.rotate(.35), ArrowUp: () => c.tilt(-.15), ArrowDown: () => c.tilt(.15), "+": () => c.zoom(.8), "=": () => c.zoom(.8), "-": () => c.zoom(1.25), "0": () => c.reset() };
    const action = actions[event.key]; if (action) { event.preventDefault(); action(); }
  }
  const live = !failed && ready;
  // The city moves like a map (city3d/engine/camera.ts).
  return <section className={`city-world${failed ? " city-world--fallback" : ""}${live ? " is-ready" : ""}`} aria-label="Карта твоего города">
    <div ref={host} className="city-scene" tabIndex={failed ? -1 : 0} role="application" aria-label="3D-карта города. Стрелки или W, A, S, D — двигаться, Q и E — поворот, R и F — наклон, плюс и минус — масштаб, ноль — исходный вид." onKeyDown={key} />
    <div ref={frame} className="city-frame" aria-hidden="true" />
    {!failed && !ready && <div className="city-loading" role="status"><span>Строим твой город…</span></div>}
    {failed && <div className="city-fallback" role="status"><span aria-hidden="true">🏙️</span><strong>3D-карта недоступна на этом устройстве</strong><small>Выбирай районы на панели навыков — миссии работают как обычно.</small></div>}
    {live && <span className="city-map-hint">Тяни — двигай город · правая кнопка или Shift — поворот и наклон · колесо — масштаб · WASD, Q/E — с клавиатуры</span>}
    {!failed && <div className="city-map-tools glass glass--regular" role="toolbar" aria-label="Управление картой" aria-orientation="vertical">
      <button type="button" className="city-time-toggle" aria-label={timeOfDay === "day" ? "Включить ночной режим" : "Включить дневной режим"} title={timeOfDay === "day" ? "Включить ночной режим" : "Включить дневной режим"} aria-pressed={timeOfDay === "night"} onClick={() => setTimeOfDay(value => value === "day" ? "night" : "day")}><span aria-hidden="true">{timeOfDay === "day" ? "☀" : "☾"}</span><small>{timeOfDay === "day" ? "День" : "Ночь"}</small></button>
      <button type="button" aria-label="Посмотреть помощника" onClick={() => control.current?.focusMascot()}>♙</button>
      <button type="button" aria-label={traffic ? "Приостановить движение" : "Включить движение"} title={traffic ? "Пауза движения" : "Возобновить движение"} aria-pressed={!traffic} onClick={() => setTraffic(value => !value)}>{traffic ? "Ⅱ" : "▶"}</button>
      <button type="button" aria-label="Приблизить" onClick={() => control.current?.zoom(.75)}>＋</button>
      <button type="button" aria-label="Отдалить" onClick={() => control.current?.zoom(1.33)}>－</button>
      <button type="button" aria-label="Исходный вид" onClick={() => control.current?.reset()}>⌂</button>
    </div>}
  </section>;
}

