import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { CityDistrict, CityMission, DistrictId } from "../../api/city";
import type { CityMascot, CityLabelInfo, CitySceneControl, CitySceneOptions, CityView } from "./cityScene";
import { districtLevel, grownDistricts } from "./cityLevels";
import { PilotTools } from "../../cityPilot/PilotTools";
import type { PilotControl, PilotReport, TimeOfDay } from "../../cityPilot";
import "../../cityPilot/pilot.css";
import { useAuth } from "../../auth/AuthContext";

/**
 * The 3D city fills the whole screen behind the glass panels. `.city-frame` marks the part the panels
 * leave free, and the camera centres the city there. `progressKey` remembers the levels this viewer has
 * seen, so an upgrade is celebrated once.
 */
export function CityMap({ districts, missions, labels, selected, onSelect, progressKey, mascot, pilot = false, inspect = false, forceWebGL = false, focusRequest = 0 }: { districts: CityDistrict[]; missions: CityMission[]; labels: CityLabelInfo[]; selected: DistrictId; onSelect: (id: DistrictId) => void; progressKey?: string; mascot?: CityMascot; pilot?: boolean; inspect?: boolean; forceWebGL?: boolean; focusRequest?: number }) {
  const mascotRef = useRef(mascot); mascotRef.current = mascot;
  const host = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null);
  const control = useRef<CitySceneControl & { setTimeOfDay?: (mode: TimeOfDay) => void }>();
  // City v3 (docs/CITY_V3_TZ.md) is the default, with the full map of ten islands (?world=v1: the five-island
  // layout; ?city=v2: the previous city). The stats overlay is for staff.
  const { atLeast } = useAuth(), staff = atLeast("supervisor");
  const [params] = useSearchParams();
  const legacy = params.get("city") === "v2";
  const world = params.get("world") === "v1" ? "v1" : "x4";
  const showStats = staff && params.get("stats") === "1";
  const webGL = forceWebGL || params.get("backend") === "webgl";
  const look = params.get("look") === "new" ? "cinematic" : undefined;
  const sceneKey = pilot ? "pilot" : legacy ? "v2" : `v3-${world}`;
  const viewScene = useRef(sceneKey);
  const view = useRef<CityView>();
  const selectRef = useRef(onSelect), selectedRef = useRef(selected);
  selectRef.current = onSelect; selectedRef.current = selected;
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0), [report, setReport] = useState<PilotReport | null>(null);
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
    // These worlds use different scales, so an old camera must not carry into a new engine/world.
    if (viewScene.current !== sceneKey) { view.current = undefined; viewScene.current = sceneKey; }
    setFailed(false); setReady(false); setReport(null);
    const current = Object.fromEntries(districts.map(d => [d.id, districtLevel(JSON.parse(levelKey)[d.id] ?? 0, d.soon)]));
    let grown: DistrictId[] = [];
    if (progressKey) {
      try { grown = grownDistricts(JSON.parse(localStorage.getItem(progressKey) ?? "null"), current) as DistrictId[]; localStorage.setItem(progressKey, JSON.stringify(current)); } catch { /* Celebration is optional. */ }
    }
    const engine: Promise<(el: HTMLDivElement, options: CitySceneOptions) => CitySceneControl> = pilot
      ? import("../../cityPilot").then(module => (el, options) => module.createCity(el, {
        ...options, forceWebGL: webGL || attempt > 0, timeOfDay: timeRef.current,
        onStats: value => { if (!cancelled && inspect) setReport(value); },
      }))
      : legacy
        ? import("./cityScene").then(module => module.createCityScene)
        : import("../../city3d").then(module => (el, options) => module.createCity(el, {
          ...options, world, forceWebGL: webGL, stats: showStats, timeOfDay: timeRef.current,
        }));
    void engine.then(createScene => {
      if (cancelled || !host.current) return;
      control.current = createScene(host.current, {
        levels: JSON.parse(levelKey), selected: selectedRef.current, view: view.current, labels: labelsRef.current, grown, mascot: mascotRef.current, frame: frame.current ?? undefined,
        onSelect: id => { if (!cancelled) selectRef.current(id); }, onView: value => { if (!cancelled) view.current = value; },
        onReady: () => { if (!cancelled) setReady(true); }, onLost: () => { if (!cancelled) setFailed(true); },
        onRestored: () => { if (!cancelled) setFailed(false); },
        // Trial "game" look for comparison: /training/city?look=new
        look,
      });
      control.current.setTraffic(trafficRef.current);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; control.current?.dispose(); control.current = undefined; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mission state and engine settings recreate the scene; labels/selection update in place
  }, [levelKey, sceneKey, pilot, legacy, world, webGL, showStats, look, attempt, inspect]);
  useEffect(() => {
    control.current?.setTimeOfDay?.(timeOfDay);
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
  // The v3 city moves like a map (city3d/engine/camera.ts); the old city and the pilot orbit.
  const mapControls = !pilot && !legacy;
  return <section className={`city-world${pilot ? " city-world--pilot" : ""}${failed ? " city-world--fallback" : ""}${live ? " is-ready" : ""}`} aria-label="Карта твоего города">
    <div ref={host} className="city-scene" tabIndex={failed ? -1 : 0} role="application" aria-label={mapControls ? "3D-карта города. Стрелки или W, A, S, D — двигаться, Q и E — поворот, R и F — наклон, плюс и минус — масштаб, ноль — исходный вид." : "3D-карта города. Стрелки — вращать и наклонять, плюс и минус — масштаб, ноль — исходный вид."} onKeyDown={key} />
    <div ref={frame} className="city-frame" aria-hidden="true" />
    {!failed && !ready && <div className="city-loading" role="status"><span>Строим твой город…</span></div>}
    {failed && <div className="city-fallback" role="status"><span aria-hidden="true">🏙️</span><strong>3D-карта недоступна на этом устройстве</strong><small>Выбирай районы на панели навыков — миссии работают как обычно.</small>{pilot && <button type="button" className="city-secondary" onClick={() => setAttempt(value => value + 1)}>Повторить через WebGL2</button>}</div>}
    {live && <span className="city-map-hint">{mapControls ? "Тяни — двигай город · правая кнопка или Shift — поворот и наклон · колесо — масштаб · WASD, Q/E — с клавиатуры" : "Тяни — вращай · колесо или щипок — масштаб · правая кнопка или два пальца — сдвиг"}</span>}
    {!failed && <div className="city-map-tools glass glass--regular" role="toolbar" aria-label="Управление картой" aria-orientation="vertical">
      {!pilot && !legacy && <button type="button" className="city-time-toggle" aria-label={timeOfDay === "day" ? "Включить ночной режим" : "Включить дневной режим"} title={timeOfDay === "day" ? "Включить ночной режим" : "Включить дневной режим"} aria-pressed={timeOfDay === "night"} onClick={() => setTimeOfDay(value => value === "day" ? "night" : "day")}><span aria-hidden="true">{timeOfDay === "day" ? "☀" : "☾"}</span><small>{timeOfDay === "day" ? "День" : "Ночь"}</small></button>}
      <button type="button" aria-label="Посмотреть помощника" onClick={() => control.current?.focusMascot()}>♙</button>
      <button type="button" aria-label={traffic ? "Приостановить движение" : "Включить движение"} title={traffic ? "Пауза движения" : "Возобновить движение"} aria-pressed={!traffic} onClick={() => setTraffic(value => !value)}>{traffic ? "Ⅱ" : "▶"}</button>
      <button type="button" aria-label="Приблизить" onClick={() => control.current?.zoom(.75)}>＋</button>
      <button type="button" aria-label="Отдалить" onClick={() => control.current?.zoom(1.33)}>－</button>
      <button type="button" aria-label="Исходный вид" onClick={() => control.current?.reset()}>⌂</button>
    </div>}
    {pilot && !failed && <PilotTools night={timeOfDay === "night"} onTime={setTimeOfDay} report={report} inspect={inspect} onBenchmark={(mode, seconds) => (control.current as PilotControl | undefined)?.startBenchmark(mode, seconds)} />}
  </section>;
}

