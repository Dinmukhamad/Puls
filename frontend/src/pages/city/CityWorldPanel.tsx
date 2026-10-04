import { SALES_RESOURCES, type CityWorld, type DepartmentId } from "../../api/cityWorld";
import type { CityEstates, MyEstate } from "../../api/cityEstate";
import { CityDistrictSheet } from "./CityDistrictSheet";
import { CityTravelCard } from "./CityTravelCard";
import type { JourneyPhase } from "../../city3d/types";
import { Sheet, registerSheet } from "../../components/Sheet";
import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./world.css";
import { CityPeekPanel } from "./CityPeekPanel";

export function CityWorldPanel({ world, current, selected, onPick, onClose, onTravel, onVisit, ready, estates, mine, onMyEstate, onOpenProject }: {
  world: CityWorld; current: DepartmentId; selected: string | null; onPick: (id: string) => void; onClose: () => void;
  onTravel: (id: DepartmentId) => void; onVisit: (id: DepartmentId) => void; ready: boolean;
  /** The city's district land and the viewer's own estate, for the district card. */
  estates?: CityEstates; mine?: MyEstate; onMyEstate?: () => void; onOpenProject?: (district: string) => void;
}) {
  const here = world.cities.find(c => c.id === current)!;
  const district = here.districts.find(d => d.id === selected);
  const resourceIndex = selected?.startsWith("sales-resource-") ? Number(selected.slice(-2)) - 1 : -1;
  return <>
    <CityPeekPanel className="city-world-peek" toolbarSlot="cities" label={`Города · ${here.name}`} compactLabel="Города" icon="🗺️"><button className="city-world-switch glass glass--regular" type="button" onClick={() => onPick("world")} aria-label="Выбрать город"><span aria-hidden="true">◈</span><strong>{here.name}</strong><span>Города ↗</span></button></CityPeekPanel>
    {selected && <Sheet title={district?.name ?? (resourceIndex >= 0 ? SALES_RESOURCES[resourceIndex] : "Выбери город")} onClose={onClose}>
      {district ? <CityDistrictSheet district={estates?.districts.find(d => d.id === district.id)} team={district} cityName={here.name} mine={mine} canManageAssignments={world.can_edit}
        onMyEstate={onMyEstate && (() => { onClose(); onMyEstate(); })} onOpenProject={onOpenProject && (() => { onClose(); onOpenProject(district.id); })} /> : resourceIndex >= 0 ? <div className="stack city-world-sheet"><span className="city-world-badge">Зарезервировано</span><h2>{SALES_RESOURCES[resourceIndex]}</h2><p>Место в учебном кампусе отдела продаж. Ресурс откроется после подготовки системы и учебных заданий.</p><p className="secondary">Это здание не заменяет действующие CRM и Диспетчерскую Техподдержки.</p></div> : <CityTravelCard cities={world.cities} current={current} ready={ready}
        onTravel={id => { onTravel(id); onClose(); }} onVisit={id => { onVisit(id); onClose(); }}>
        <details className="city-travel-credits"><summary tabIndex={0}>Авторы моделей</summary>
        <p className="secondary small city-world-credit">Здание вокзала — «Gare de BlenderVille», автор loran17 (<a href="https://www.blendswap.com/blend/27438" target="_blank" rel="noreferrer">Blend Swap</a>), лицензия <a href="https://creativecommons.org/licenses/by/3.0/deed.ru" target="_blank" rel="noreferrer">CC BY</a>; упрощено и перекрашено для Puls.</p>
        <p className="secondary small city-world-credit">Офисные здания — «High Rise Office Buildings», автор Phoenixdraws (<a href="https://www.blendswap.com/blends/view/74984" target="_blank" rel="noreferrer">Blend Swap</a>), лицензия <a href="https://creativecommons.org/licenses/by/3.0/deed.ru" target="_blank" rel="noreferrer">CC BY 3.0</a>; разделены на модели и адаптированы для Puls.</p>
        </details>
      </CityTravelCard>}
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
