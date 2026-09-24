import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { CityDistrict, CityMission, DistrictId } from "../../api/city";
import type { CityMascot, CityLabelInfo, CitySceneControl, CityView } from "./cityScene";
import { districtLevel, grownDistricts } from "./cityLevels";

const ICONS: Record<DistrictId, string> = { academy: "🎓", driver: "🚕", crm: "💬", dispatch: "📡", oktell: "🎧" };
const COLORS: Record<DistrictId, string> = { academy: "#5b8def", driver: "#f0a23a", crm: "#7b5cff", dispatch: "#35b6a6", oktell: "#e86aa6" };

/** `progressKey` remembers the levels this viewer has seen, so an upgrade is celebrated once. */
export function CityMap({ districts, missions, selected, onSelect, progressKey, mascot }: { districts: CityDistrict[]; missions: CityMission[]; selected: DistrictId; onSelect: (id: DistrictId) => void; progressKey?: string; mascot?: CityMascot }) {
  const mascotRef = useRef(mascot); mascotRef.current = mascot;
  const host = useRef<HTMLDivElement>(null);
  const control = useRef<CitySceneControl>();
  const view = useRef<CityView>();
  const selectRef = useRef(onSelect), selectedRef = useRef(selected);
  selectRef.current = onSelect; selectedRef.current = selected;
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const levels = Object.fromEntries(districts.map(d => [d.id, missions.filter(m => m.district === d.id && m.state === "completed").length]));
  const levelKey = JSON.stringify(levels);
  const labels: CityLabelInfo[] = districts.map(d => {
    const own = missions.filter(m => m.district === d.id && m.enabled), done = missions.filter(m => m.district === d.id && m.state === "completed").length;
    const reward = own.some(m => m.state === "ready");
    return { id: d.id, name: d.name, icon: ICONS[d.id], soon: d.soon, reward, level: districtLevel(levels[d.id] ?? 0, d.soon), status: d.soon ? "Скоро откроется" : done && done >= own.length ? "✓ Район освоен" : reward ? "✦ Забрать награду" : `${done} из ${Math.max(own.length, done)} миссий` };
  });
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
    void import("./cityScene").then(({ createCityScene }) => {
      if (cancelled || !host.current) return;
      control.current = createCityScene(host.current, {
        levels: JSON.parse(levelKey), selected: selectedRef.current, view: view.current, labels: labelsRef.current, grown, mascot: mascotRef.current,
        onSelect: id => selectRef.current(id), onView: value => { view.current = value; },
        onReady: () => { if (!cancelled) setReady(true); }, onLost: () => { if (!cancelled) setFailed(true); },
      });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; control.current?.dispose(); control.current = undefined; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when mission progress changes
  }, [levelKey]);
  useEffect(() => { control.current?.select(selected); }, [selected]);
  useEffect(() => { if (mascot) control.current?.setMascot(mascot); }, [mascot?.gender, mascot?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { control.current?.setLabels(JSON.parse(labelsKey)); }, [labelsKey]);
  function key(event: KeyboardEvent) {
    const c = control.current; if (!c) return;
    const actions: Record<string, () => void> = { ArrowLeft: () => c.rotate(-.35), ArrowRight: () => c.rotate(.35), ArrowUp: () => c.tilt(-.15), ArrowDown: () => c.tilt(.15), "+": () => c.zoom(.8), "=": () => c.zoom(.8), "-": () => c.zoom(1.25), "0": () => c.reset() };
    const action = actions[event.key]; if (action) { event.preventDefault(); action(); }
  }
  const live = !failed && ready;
  return <section className={`city-world${failed ? " city-world--fallback" : ""}${live ? " is-ready" : ""}`} aria-label="Карта твоего города">
    <div ref={host} className="city-scene" tabIndex={failed ? -1 : 0} role="application" aria-label="3D-карта города. Стрелки — вращать и наклонять, плюс и минус — масштаб, ноль — исходный вид." onKeyDown={key} />
    <div className="city-world-head"><span>ГЛАВА 01 · ПЕРВАЯ СМЕНА</span><span>{failed ? "Карта районов" : "ГОРОД PULS"}</span></div>
    {!failed && !ready && <div className="city-loading" role="status">Строим твой город…</div>}
    <div className={`city-districts${failed ? " city-districts--fallback" : ""}`} role="group" aria-label="Районы города">
      {labels.map(l => <button type="button" key={l.id} className="city-district" style={{ "--district": COLORS[l.id] } as CSSProperties} aria-pressed={selected === l.id} data-soon={l.soon} data-reward={l.reward || undefined} onClick={() => onSelect(l.id)}>
        <span aria-hidden="true">{l.icon}</span><span><strong>{l.name}</strong><small>{l.status}</small></span>
      </button>)}
    </div>
    {!failed && ready && <span className="city-map-hint">Тяни — вращай · колесо или щипок — масштаб · правая кнопка или два пальца — сдвиг</span>}
    {!failed && <div className="city-map-tools">
      <div className="city-map-buttons" role="toolbar" aria-label="Управление картой" aria-orientation="vertical">
        <button type="button" aria-label="Повернуть влево" onClick={() => control.current?.rotate(-Math.PI / 4)}>↺</button>
        <button type="button" aria-label="Повернуть вправо" onClick={() => control.current?.rotate(Math.PI / 4)}>↻</button>
        <button type="button" aria-label="Наклонить выше" onClick={() => control.current?.tilt(-.2)}>⤒</button>
        <button type="button" aria-label="Наклонить ниже" onClick={() => control.current?.tilt(.2)}>⤓</button>
        <button type="button" aria-label="Приблизить" onClick={() => control.current?.zoom(.75)}>＋</button>
        <button type="button" aria-label="Отдалить" onClick={() => control.current?.zoom(1.33)}>－</button>
        <button type="button" aria-label="Исходный вид" onClick={() => control.current?.reset()}>⌂</button>
      </div>
    </div>}
  </section>;
}
