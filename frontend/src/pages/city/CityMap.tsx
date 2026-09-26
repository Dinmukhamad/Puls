import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CityDistrict, CityMission, DistrictId } from "../../api/city";
import type { CityMascot, CityLabelInfo, CitySceneControl, CityView } from "./cityScene";
import { districtLevel, grownDistricts } from "./cityLevels";
import { useAuth } from "../../auth/AuthContext";

/**
 * The 3D city fills the whole screen behind the glass panels. `.city-frame` marks the part the panels
 * leave free, and the camera centres the city there. `progressKey` remembers the levels this viewer has
 * seen, so an upgrade is celebrated once.
 */
export function CityMap({ districts, missions, labels, selected, onSelect, progressKey, mascot }: { districts: CityDistrict[]; missions: CityMission[]; labels: CityLabelInfo[]; selected: DistrictId; onSelect: (id: DistrictId) => void; progressKey?: string; mascot?: CityMascot }) {
  const mascotRef = useRef(mascot); mascotRef.current = mascot;
  const host = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null);
  const control = useRef<CitySceneControl>();
  // City v3 (docs/CITY_V3_TZ.md) is the default, with the full map of ten islands (?world=v1: the five-island
  // layout; ?city=v2: the previous city). The stats overlay is for staff.
  const { atLeast } = useAuth(), staff = atLeast("supervisor");
  const view = useRef<CityView>();
  const selectRef = useRef(onSelect), selectedRef = useRef(selected);
  selectRef.current = onSelect; selectedRef.current = selected;
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const [traffic, setTraffic] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const trafficRef = useRef(traffic); trafficRef.current = traffic;
  const levels = Object.fromEntries(districts.map(d => [d.id, missions.filter(m => m.district === d.id && m.state === "completed").length]));
  const levelKey = JSON.stringify(levels);
  const labelsKey = JSON.stringify(labels), labelsRef = useRef(labels);
  labelsRef.current = labels;
  useEffect(() => {
    let cancelled = false;
    setFailed(false); setReady(false);
    const current = Object.fromEntries(districts.map(d => [d.id, districtLevel(JSON.parse(levelKey)[d.id] ?? 0, d.soon)]));
    let grown: DistrictId[] = [];
    if (progressKey) {
      try { grown = grownDistricts(JSON.parse(localStorage.getItem(progressKey) ?? "null"), current) as DistrictId[]; localStorage.setItem(progressKey, JSON.stringify(current)); } catch { /* Celebration is optional. */ }
    }
    const query = new URLSearchParams(window.location.search), v3 = query.get("city") !== "v2";
    const engine = v3
      ? import("../../city3d").then(m => (el: HTMLDivElement, o: Parameters<typeof m.createCity>[1]) => m.createCity(el, {
        ...o, world: query.get("world") === "v1" ? "v1" : "x4", forceWebGL: query.get("backend") === "webgl", stats: staff && query.get("stats") === "1",
      }))
      : import("./cityScene").then(m => m.createCityScene);
    void engine.then(createScene => {
      if (cancelled || !host.current) return;
      control.current = createScene(host.current, {
        levels: JSON.parse(levelKey), selected: selectedRef.current, view: view.current, labels: labelsRef.current, grown, mascot: mascotRef.current, frame: frame.current ?? undefined,
        onSelect: id => selectRef.current(id), onView: value => { view.current = value; },
        onReady: () => { if (!cancelled) setReady(true); }, onLost: () => { if (!cancelled) setFailed(true); },
        onRestored: () => { if (!cancelled) setFailed(false); },
        // Trial "game" look for comparison: /training/city?look=new
        look: new URLSearchParams(window.location.search).get("look") === "new" ? "cinematic" : undefined,
      });
      control.current.setTraffic(trafficRef.current);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; control.current?.dispose(); control.current = undefined; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when mission progress changes
  }, [levelKey]);
  useEffect(() => { control.current?.select(selected); }, [selected]);
  useEffect(() => { if (mascot) control.current?.setMascot(mascot); }, [mascot?.gender, mascot?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { control.current?.setLabels(JSON.parse(labelsKey)); }, [labelsKey]);
  useEffect(() => { control.current?.setTraffic(traffic); }, [traffic]);
  function key(event: KeyboardEvent) {
    const c = control.current; if (!c) return;
    const actions: Record<string, () => void> = { ArrowLeft: () => c.rotate(-.35), ArrowRight: () => c.rotate(.35), ArrowUp: () => c.tilt(-.15), ArrowDown: () => c.tilt(.15), "+": () => c.zoom(.8), "=": () => c.zoom(.8), "-": () => c.zoom(1.25), "0": () => c.reset() };
    const action = actions[event.key]; if (action) { event.preventDefault(); action(); }
  }
  const live = !failed && ready;
  return <section className={`city-world${failed ? " city-world--fallback" : ""}${live ? " is-ready" : ""}`} aria-label="Карта твоего города">
    <div ref={host} className="city-scene" tabIndex={failed ? -1 : 0} role="application" aria-label="3D-карта города. Стрелки — вращать и наклонять, плюс и минус — масштаб, ноль — исходный вид." onKeyDown={key} />
    <div ref={frame} className="city-frame" aria-hidden="true" />
    {!failed && !ready && <div className="city-loading" role="status"><span>Строим твой город…</span></div>}
    {failed && <div className="city-fallback" role="status"><span aria-hidden="true">🏙️</span><strong>3D-карта недоступна на этом устройстве</strong><small>Выбирай районы на панели навыков — миссии работают как обычно.</small></div>}
    {live && <span className="city-map-hint">Тяни — вращай · колесо или щипок — масштаб · правая кнопка или два пальца — сдвиг</span>}
    {!failed && <div className="city-map-tools glass glass--regular" role="toolbar" aria-label="Управление картой" aria-orientation="vertical">
      <button type="button" aria-label="Посмотреть помощника" onClick={() => control.current?.focusMascot()}>♙</button>
      <button type="button" aria-label={traffic ? "Приостановить движение транспорта" : "Включить движение транспорта"} title={traffic ? "Пауза движения" : "Движение транспорта"} aria-pressed={!traffic} onClick={() => setTraffic(value => !value)}>{traffic ? "Ⅱ" : "▶"}</button>
      <button type="button" aria-label="Приблизить" onClick={() => control.current?.zoom(.75)}>＋</button>
      <button type="button" aria-label="Отдалить" onClick={() => control.current?.zoom(1.33)}>－</button>
      <button type="button" aria-label="Исходный вид" onClick={() => control.current?.reset()}>⌂</button>
    </div>}
  </section>;
}
