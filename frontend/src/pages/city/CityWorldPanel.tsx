import { SALES_RESOURCES, type CityWorld, type DepartmentId } from "../../api/cityWorld";
import type { CityEstates, MyEstate } from "../../api/cityEstate";
import { CityDistrictSheet } from "./CityDistrictSheet";
import type { JourneyPhase } from "../../city3d/types";
import { Sheet, registerSheet } from "../../components/Sheet";
import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./world.css";

export function CityWorldPanel({ world, current, selected, onPick, onClose, onTravel, onVisit, ready, estates, mine, onMyEstate, onOpenProject }: {
  world: CityWorld; current: DepartmentId; selected: string | null; onPick: (id: string) => void; onClose: () => void;
  onTravel: (id: DepartmentId) => void; onVisit: (id: DepartmentId) => void; ready: boolean;
  /** The city's district land and the viewer's own estate, for the district card. */
  estates?: CityEstates; mine?: MyEstate; onMyEstate?: () => void; onOpenProject?: (district: string) => void;
}) {
  const here = world.cities.find(c => c.id === current)!, other = world.cities.find(c => c.id !== current)!;
  const district = here.districts.find(d => d.id === selected);
  const resourceIndex = selected?.startsWith("sales-resource-") ? Number(selected.slice(-2)) - 1 : -1;
  return <>
    <button className="city-world-switch glass glass--regular" type="button" onClick={() => onPick("world")} aria-label="Города и районы"><span aria-hidden="true">◈</span><strong>{here.name}</strong><span>Города ↗</span></button>
    {selected && <Sheet title={district?.name ?? (resourceIndex >= 0 ? SALES_RESOURCES[resourceIndex] : "Города Puls")} onClose={onClose}>
      {district ? <CityDistrictSheet district={estates?.districts.find(d => d.id === district.id)} team={district} cityName={here.name} mine={mine}
        onMyEstate={onMyEstate && (() => { onClose(); onMyEstate(); })} onOpenProject={onOpenProject && (() => { onClose(); onOpenProject(district.id); })} /> : resourceIndex >= 0 ? <div className="stack city-world-sheet"><span className="city-world-badge">Зарезервировано</span><h2>{SALES_RESOURCES[resourceIndex]}</h2><p>Место в учебном кампусе отдела продаж. Ресурс откроется после подготовки системы и учебных заданий.</p><p className="secondary">Это здание не заменяет действующие CRM и Диспетчерскую Техподдержки.</p></div> : <div className="stack city-world-sheet">
        <div className="city-world-route" aria-hidden="true"><span>◉</span><span>━ 🚆 ▴▴▴ ━</span><span>◉</span></div>
        <div className="city-world-cards">{world.cities.map(c => <article key={c.id} data-current={c.id === current}><small>{c.id === "support" ? "ОСТРОВНОЙ ГОРОД" : "ГОРОД У ОЗЕРА"}</small><h2>{c.name}</h2><p>{c.districts.length} района · {c.id === "support" ? "Действующие учебные центры" : "10 мест для учебных центров"}</p>{world.home_city === c.id && <span className="city-world-badge">Твой отдел</span>}{c.id !== current && <button className="city-secondary" onClick={() => { onVisit(c.id); onClose(); }}>Открыть без поездки →</button>}</article>)}</div>
        <button className="city-action" disabled={!ready} onClick={() => { onTravel(other.id); onClose(); }}>{ready ? `На поезде в ${other.name} →` : "Готовим поезд…"}</button>
        <h3>Районы · {here.name}</h3><div className="city-world-districts">{here.districts.map(d => <button className="city-secondary" key={d.id} onClick={() => onPick(d.id)}><strong>{d.name}</strong><small>{d.supervisor ?? "Команда не назначена"}{d.mine ? " · твой район" : ""}</small></button>)}</div>
        <p className="secondary small">Оба города открыты для посещения. Строить можно в своём районе за коины Puls, когда стройка в нём открыта.</p>
      </div>}
    </Sheet>}
  </>;
}

export function CityJourney({ phase, destination, onSkip }: { phase: JourneyPhase; destination: string; onSkip: () => void }) {
  const layer = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), skip = useRef(onSkip);
  skip.current = onSkip;
  const active = !!phase;
  useLayoutEffect(() => {
    if (!active || !layer.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = registerSheet(layer.current);
    button.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); skip.current(); }
      if (event.key === "Tab") { event.preventDefault(); button.current?.focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); release(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [active]);
  if (!phase) return null;
  return createPortal(<div ref={layer} className="city-journey" data-phase={phase} role="dialog" aria-modal="true" aria-label={`Поезд в ${destination}`}>
    <div className="city-journey__caption glass glass--prominent"><span aria-hidden="true">🚆</span><div><small>ГОРОДА PULS</small><strong>{phase === "tunnel" ? "Через горный туннель" : phase === "arriving" ? `Добро пожаловать в ${destination}` : `Отправляемся в ${destination}`}</strong></div><button ref={button} className="city-secondary" onClick={onSkip}>Пропустить</button></div>
  </div>, document.body);
}
