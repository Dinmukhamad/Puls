import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { FleetDriver, FleetPark, FleetResponse, FleetState } from "../../api/dispatch";
import { STATUS, fullName, initials, matchesQuery, parkTitle, phone, type FleetRoute } from "./fleetNav";

/** What every page of the training cabinet needs: data, the chosen park and navigation. */
export interface Fleet {
  state: FleetState; park: FleetPark; route: FleetRoute;
  go: (path: string, park?: string) => void;
  /** Sends a change; the server answers with the whole cabinet and the mascot's verdict. */
  run: (action: () => Promise<FleetResponse>, done?: string) => Promise<FleetResponse>;
  notify: (text: string) => void;
  search: () => void;
}
export const FleetContext = createContext<Fleet | null>(null);
export function useFleet() {
  const fleet = useContext(FleetContext);
  if (!fleet) throw new Error("FleetContext is missing");
  return fleet;
}
/** Pulsar's bubble lies over the page: pressing «Дальше» must not close the menu he points at. */
export const outsideCoach = (e: Event) => e.target instanceof Element && !!e.target.closest(".coach");
export const parkDrivers = (state: FleetState, park: string) => state.drivers.filter(d => d.park === park);

const paths: Record<string, string> = {
  park: "M4 17l4.5-5 3.5 3.5L20 7M4 4v16h16",
  people: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5",
  cars: "M5 16v-4l2-5h10l2 5v4M4 16h16v3H4zM7.5 16.5h.01M16.5 16.5h.01M6 12h12",
  help: "M5 18.5V6h14v10H9zM9 10h6M9 13h4",
  search: "M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Zm4.6-1.9L20 20",
  plus: "M12 5v14M5 12h14", close: "M6 6l12 12M18 6 6 18", chevron: "m9 6 6 6-6 6", down: "m6 9 6 6 6-6",
  check: "m5 12 4.5 4.5L19 7", info: "M12 11v6M12 7.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  phone: "M8 3.5 5 4c-.8 2.8.4 7.4 4.6 11.5S18.2 20.3 21 19.5l.5-3-4-2-2 2c-1.8-.8-3.7-2.7-4.5-4.5l2-2z", chat: "M4 5h16v11H9l-5 4z",
  refresh: "M19 12a7 7 0 1 1-2-5M19 4v4h-4", box: "M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9", clip: "M15.5 8.5 9 15a2.1 2.1 0 0 1-3-3l7-7a3.5 3.5 0 0 1 5 5l-7.5 7.5",
};
export function Icon({ name, className = "" }: { name: keyof typeof paths | string; className?: string }) {
  return <svg className={`fleet-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] ?? paths.info} /></svg>;
}
export function FleetLogo() {
  return <svg className="fleet-logo-mark" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" /><path d="M11 11l7 9-7 9h5l4-5 4 5h5l-7-9 7-9h-5l-4 5-4-5z" /></svg>;
}

export function Avatar({ name, color, status, size = "m" }: { name: string; color?: string; status?: FleetDriver["status"]; size?: "s" | "m" | "l" }) {
  return <span className={`fleet-avatar fleet-avatar--${size}`} style={color ? { background: color } : undefined}>{initials(name)}{status && <i className={`fleet-dot fleet-dot--${STATUS[status].tone}`} />}</span>;
}
export function StatusChip({ d }: { d: FleetDriver }) {
  return <span className={`fleet-status fleet-status--${STATUS[d.status].tone}`}><i />{STATUS[d.status].label}{!d.gps && d.works && <b>NO GPS</b>}</span>;
}

/** Page title with its own buttons on the left and search plus the park on the right. */
export function FleetHead({ title, crumbs, children }: { title: ReactNode; crumbs?: { label: string; path: string }[]; children?: ReactNode }) {
  const fleet = useFleet();
  return <header className="fleet-head">
    <h1>{crumbs?.map(c => <span key={c.path}><button className="fleet-crumb" onClick={() => fleet.go(c.path)}>{c.label}</button><Icon name="chevron" className="fleet-crumb-arrow" /></span>)}{title}</h1>
    {children && <div className="fleet-head-actions">{children}</div>}
    <div className="fleet-head-right"><button className="fleet-round" data-coach="fleet-search" aria-label="Поиск исполнителя" onClick={fleet.search}><Icon name="search" /></button><ParkPicker /></div>
  </header>;
}

export function ParkPicker() {
  const { state, park, go, route } = useFleet();
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !outsideCoach(e)) setOpen(false); };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const q = query.trim().toLowerCase();
  const parks = state.parks.filter(p => !q || `${p.name} ${p.city}`.toLowerCase().includes(q));
  // Drivers and orders belong to a park: switching the park goes back to the park's list.
  const next = route.page === "driver" || route.page === "order" ? "contractors" : route.page;
  return <div className="fleet-park" ref={box} onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}>
    <button className="fleet-park-button" data-coach="fleet-park" data-park={park.id} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <Avatar name={park.name} color={park.color} size="s" /><span><strong>{park.name}</strong><small>{park.city}</small></span>
    </button>
    {open && <div className="fleet-park-menu" data-coach="park-menu">
      <label className="fleet-park-search"><Icon name="search" /><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Название парка" aria-label="Название парка" /></label>
      <div role="listbox" aria-label="Парки">{parks.map(p => <button key={p.id} role="option" aria-selected={p.id === park.id} data-coach="park-option" data-park={p.id} onClick={() => { setOpen(false); setQuery(""); go(next, p.id); }}>
        <Avatar name={p.name} color={p.color} /><span><strong>{p.name}</strong><small>{p.city}</small></span>{p.id === park.id && <Icon name="check" className="fleet-park-check" />}
      </button>)}{!parks.length && <p className="fleet-muted">Парк не найден</p>}</div>
    </div>}
  </div>;
}

/** Modal over the cabinet page only, so the mascot's panel stays usable. */
export function Modal({ title, onClose, children, wide = false, className = "" }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  const id = useId();
  return <div className="fleet-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
    <div className={`fleet-modal${wide ? " is-wide" : ""} ${className}`} role="dialog" aria-modal="true" aria-labelledby={id}>
      <header><h2 id={id}>{title}</h2><button className="fleet-close" aria-label="Закрыть" onClick={onClose}><Icon name="close" /></button></header>
      {children}
    </div>
  </div>;
}
export function Drawer({ title, subtitle, onClose, children, footer, coach }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; coach?: string }) {
  const id = useId();
  return <div className="fleet-overlay is-side" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
    <aside className="fleet-drawer" role="dialog" aria-modal="true" aria-labelledby={id} data-coach={coach}>
      <header><div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="fleet-close" autoFocus aria-label="Закрыть" onClick={onClose}><Icon name="close" /></button></header>
      <div className="fleet-drawer-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </aside>
  </div>;
}

export function driverLine(d: FleetDriver) {
  const segment = { new: "Новые", active: "Активные", churn: "Отток", archive: "Архив" }[d.segment];
  return [d.profession, d.car ? `${d.car.brand} ${d.car.model} ${d.car.year} ${d.car.plate}` : "", phone(d.phone), segment, d.employment].filter(Boolean).join(" • ");
}

/** «Поиск» next to the park: finds accounts of the chosen park only, as the cabinet does. */
export function SearchModal({ onClose }: { onClose: () => void }) {
  const { state, park, go } = useFleet();
  const [query, setQuery] = useState("");
  const enough = query.replace(/[^\p{L}\p{N}]/gu, "").length >= 3;
  const found = enough ? state.drivers.filter(d => d.park === park.id && matchesQuery(d, query)) : [];
  const elsewhere = enough && !found.length && state.drivers.some(d => matchesQuery(d, query));
  return <Modal title="Поиск" onClose={onClose} wide className="fleet-search-modal">
    <label className="fleet-search-field" data-coach="search-input"><Icon name="search" /><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Начните вводить имя, номер ВУ или номер машины" aria-label="Имя, номер ВУ или номер машины" />{query && <button aria-label="Очистить" onClick={() => setQuery("")}><Icon name="close" /></button>}</label>
    <div className="fleet-search-results" aria-live="polite">
      {!enough ? <p className="fleet-empty-hint">Чтобы начать поиск, вам нужно ввести как минимум три буквы или цифры</p>
        : found.length ? found.map(d => <button key={d.id} className="fleet-search-row" data-coach="search-result" data-driver={d.id} data-works={d.works} onClick={() => { onClose(); go(`contractors/${d.id}`); }}>
          <Avatar name={fullName(d)} status={d.status} /><span><strong><b>{d.last_name}</b> {d.first_name} {d.middle_name}</strong><small>{driverLine(d)}</small></span><em className={d.works ? "is-on" : ""}>{d.works ? "Работает" : "Не работает"}</em>
        </button>)
        : <p className="fleet-empty-hint">Ничего не нашли в парке «{parkTitle(park)}».{elsewhere && <><br /><strong>Подсказка Пульсара:</strong> проверь парк и город в правом верхнем углу — поиск идёт только по выбранному парку.</>}</p>}
    </div>
  </Modal>;
}
