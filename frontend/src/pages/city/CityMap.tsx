import { useEffect, useRef, useState } from "react";
import type { CityDistrict, CityMission, DistrictId } from "../../api/city";

export function CityMap({ districts, missions, selected, onSelect }: { districts: CityDistrict[]; missions: CityMission[]; selected: DistrictId; onSelect: (id: DistrictId) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const control = useRef<{ dispose: () => void }>();
  const angle = useRef(.38);
  const [positions, setPositions] = useState<Record<string, {x: number; y: number}>>({});
  const [failed, setFailed] = useState(false);
  const levels = Object.fromEntries(districts.map(d => [d.id, missions.filter(m => m.district === d.id && m.state === "completed").length]));
  const levelKey = JSON.stringify(levels);
  useEffect(() => {
    let cancelled = false;
    setFailed(false); setPositions({});
    void import("./cityScene").then(({ createCityScene }) => {
      if (cancelled || !host.current) return;
      control.current = createCityScene(host.current, JSON.parse(levelKey), setPositions, () => setFailed(true), angle.current, value => { angle.current = value; });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; control.current?.dispose(); control.current = undefined; };
  }, [levelKey]);
  return <section className={`city-world${failed ? " city-world--fallback" : ""}`} aria-label="Карта твоего города">
    <div className="city-world-head"><span>ГЛАВА 01 · ПЕРВАЯ СМЕНА</span><span>{failed ? "Карта районов" : "ГОРОД PULS"}</span></div>
    <div ref={host} className="city-scene" tabIndex={failed ? -1 : 0} role="group" aria-label="3D-карта. Вращайте перетаскиванием или клавишами влево и вправо." />
    {!failed && !Object.keys(positions).length && <div className="city-loading" role="status">Строим твой город…</div>}
    <div className={`city-pins${failed ? " city-pins--fallback" : ""}`}>
      {districts.map(d => {
        const own = missions.filter(m => m.district === d.id && m.enabled), done = missions.filter(m => m.district === d.id && m.state === "completed").length;
        const ready = own.some(m => m.state === "ready"), pos = positions[d.id];
        return <button type="button" key={d.id} className="city-pin" aria-pressed={selected === d.id} data-soon={d.soon} onClick={() => onSelect(d.id)} style={!failed && pos ? {left:pos.x, top:pos.y} : undefined}>
          <span>{d.name}</span><small>{d.soon ? "Скоро" : done && done >= own.length ? "✓ Район освоен" : ready ? "✦ Забрать награду" : `${done} / ${Math.max(own.length,done)} миссий`}</small>
        </button>;
      })}
    </div>
    <div className="city-map-tools"><span>{failed ? "Выбери район, чтобы продолжить обучение" : "Потяни карту в сторону — вращай на 360°. Нажми на район, чтобы войти."}</span></div>
  </section>;
}
