import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { CityDistrict, CityMission, DistrictId } from "../../api/city";
import type { CitySceneControl, CityView } from "./cityScene";

const ICONS: Record<DistrictId, string> = { academy: "🎓", driver: "🚕", crm: "💬", dispatch: "📡", opteo: "🧭" };
const COLORS: Record<DistrictId, string> = { academy: "#5b8def", driver: "#f0a23a", crm: "#7b5cff", dispatch: "#35b6a6", opteo: "#e86aa6" };

export function CityMap({ districts, missions, selected, onSelect }: { districts: CityDistrict[]; missions: CityMission[]; selected: DistrictId; onSelect: (id: DistrictId) => void }) {
  const host = useRef<HTMLDivElement>(null), pins = useRef<HTMLDivElement>(null);
  const control = useRef<CitySceneControl>();
  const view = useRef<CityView>();
  const selectRef = useRef(onSelect), selectedRef = useRef(selected);
  selectRef.current = onSelect; selectedRef.current = selected;
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const levels = Object.fromEntries(districts.map(d => [d.id, missions.filter(m => m.district === d.id && m.state === "completed").length]));
  const levelKey = JSON.stringify(levels);
  useEffect(() => {
    let cancelled = false;
    setFailed(false); setReady(false);
    void import("./cityScene").then(({ createCityScene }) => {
      if (cancelled || !host.current || !pins.current) return;
      control.current = createCityScene(host.current, {
        levels: JSON.parse(levelKey), selected: selectedRef.current, view: view.current, pinLayer: pins.current,
        onSelect: id => selectRef.current(id), onView: value => { view.current = value; },
        onReady: () => { if (!cancelled) setReady(true); }, onLost: () => { if (!cancelled) setFailed(true); },
      });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; control.current?.dispose(); control.current = undefined; };
  }, [levelKey]);
  useEffect(() => { control.current?.select(selected); }, [selected]);
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
    <div ref={pins} className={`city-pins${failed ? " city-pins--fallback" : ""}`}>
      {districts.map(d => {
        const own = missions.filter(m => m.district === d.id && m.enabled), done = missions.filter(m => m.district === d.id && m.state === "completed").length;
        const ready = own.some(m => m.state === "ready"), status = d.soon ? "Скоро откроется" : done && done >= own.length ? "✓ Район освоен" : ready ? "✦ Забрать награду" : `${done} из ${Math.max(own.length, done)} миссий`;
        return <div key={d.id} className="city-pin-group" style={{ "--district": COLORS[d.id] } as CSSProperties}>
          {!failed && <><span className="city-leader" data-district={d.id} aria-hidden="true" /><span className="city-anchor" data-district={d.id} aria-hidden="true" /></>}
          <button type="button" className="city-pin" data-district={d.id} aria-pressed={selected === d.id} data-soon={d.soon} data-reward={ready || undefined} onClick={() => onSelect(d.id)}>
            <span className="city-pin-icon" aria-hidden="true">{ICONS[d.id]}</span><span className="city-pin-text"><strong>{d.name}</strong><small>{status}</small></span>
          </button>
        </div>;
      })}
    </div>
    {!failed && <div className="city-map-tools">
      <span className="city-map-hint">{ready ? "Тяни — вращай на 360°, колесо или щипок — масштаб, правая кнопка или два пальца — сдвиг" : ""}</span>
      <div className="city-map-buttons" role="toolbar" aria-label="Управление картой">
        <button type="button" aria-label="Повернуть влево" onClick={() => control.current?.rotate(-Math.PI / 4)}>↺</button>
        <button type="button" aria-label="Повернуть вправо" onClick={() => control.current?.rotate(Math.PI / 4)}>↻</button>
        <button type="button" aria-label="Наклонить выше" onClick={() => control.current?.tilt(-.2)}>⤒</button>
        <button type="button" aria-label="Наклонить ниже" onClick={() => control.current?.tilt(.2)}>⤓</button>
        <button type="button" aria-label="Приблизить" onClick={() => control.current?.zoom(.75)}>＋</button>
        <button type="button" aria-label="Отдалить" onClick={() => control.current?.zoom(1.33)}>－</button>
        <button type="button" aria-label="Исходный вид" onClick={() => control.current?.reset()}>⌂</button>
      </div>
    </div>}
    {failed && <div className="city-map-tools"><span className="city-map-hint">Выбери район, чтобы продолжить обучение</span></div>}
  </section>;
}
