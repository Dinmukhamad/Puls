import { useEffect, useId, useState, type ReactNode } from "react";
import type { TrainingDriver } from "../drivers/driverData";
import type { SectionsState } from "./sectionsStore";

/** What every training section of the CRM gets from the Work Sites page. */
export interface SectionProps {
  state: SectionsState;
  update: (change: (state: SectionsState) => SectionsState) => void;
  drivers: TrainingDriver[];
  updateDriver: (id: number, change: (driver: TrainingDriver) => TrainingDriver) => void;
  addDriver: (driver: TrainingDriver) => void;
  /** The operator's name: it goes into «Сотрудник», «Кто подал», «Ответственный менеджер». */
  employee: string;
  notify: (text: string) => void;
  openDriver: (id: number) => void;
  go: (query: string) => void;
}

export const ruDate = (iso: string) => iso ? iso.slice(0, 10).split("-").reverse().join(".") : "—";
export const ruTime = (iso: string) => iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const money = (value: number) => value ? `${value.toLocaleString("ru-RU")} ₸` : "—";
export const today = () => new Date().toISOString().slice(0, 10);

/** The current time, refreshed so that answers due in a couple of minutes show up by themselves. */
export function useNow(every = 5000) {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date().toISOString()), every); return () => window.clearInterval(timer); }, [every]);
  return now;
}

/** A card like the CRM's own pages: a blue title with its actions, then the content. */
export function SectionCard({ title, icon, actions, children, wide, coach }: { title: string; icon: string; actions?: ReactNode; children: ReactNode; wide?: boolean; coach?: string }) {
  return <section className={`crm-panel sec-card${wide ? " is-wide" : ""}`} data-coach={coach}>
    <div className="sec-head"><h2><span aria-hidden="true">{icon}</span> {title}</h2>{actions}</div>
    <div className="sec-body">{children}</div>
  </section>;
}

export function Field({ label, children, error, coach, wide }: { label: string; children: ReactNode; error?: string; coach?: string; wide?: boolean }) {
  return <label className={`sec-field${error ? " has-error" : ""}${wide ? " is-wide" : ""}`} data-coach={coach}><span>{label}</span>{children}{error && <small role="alert">{error}</small>}</label>;
}

export function Chip({ tone, children }: { tone: string; children: ReactNode }) { return <span className={`sec-chip sec-chip--${tone}`}>{children}</span>; }

export function Select({ value, onChange, options, all = "Все", label }: { value: string; onChange: (value: string) => void; options: readonly string[]; all?: string; label?: string }) {
  return <select value={value} aria-label={label} onChange={e => onChange(e.target.value)}><option value="">{all}</option>{options.map(o => <option key={o} value={o}>{o}</option>)}</select>;
}

/** Filters are typed into a draft and apply on «Применить», like in the CRM. */
export function useFilters<T extends Record<string, string | boolean>>(initial: T) {
  const [draft, setDraft] = useState(initial), [applied, setApplied] = useState(initial);
  const set = <K extends keyof T>(key: K, value: T[K]) => setDraft(d => ({ ...d, [key]: value }));
  const changed = JSON.stringify(applied) !== JSON.stringify(initial) || JSON.stringify(draft) !== JSON.stringify(initial);
  return { draft, applied, set, apply: () => setApplied(draft), reset: () => { setDraft(initial); setApplied(initial); }, changed };
}
export function FilterActions({ onApply, onReset, changed, found }: { onApply: () => void; onReset: () => void; changed: boolean; found?: number }) {
  return <div className="sec-filter-actions"><button type="submit" className="crm-primary" onClick={e => { e.preventDefault(); onApply(); }}>▼ Применить</button><button type="button" className="crm-secondary" disabled={!changed} onClick={onReset}>Сбросить</button>{found !== undefined && <span>Найдено: <strong>{found}</strong></span>}</div>;
}

/** Rows of one page and the page switcher under the table. */
export function usePages<T>(rows: T[], size: number) {
  const [page, setPage] = useState(1), pages = Math.max(1, Math.ceil(rows.length / size)), current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * size, current * size);
  const pager = rows.length > size ? <div className="sec-pager"><span>{(current - 1) * size + 1} to {Math.min(rows.length, current * size)} of total {rows.length} items.</span>
    <nav aria-label="Страницы"><button disabled={current === 1} onClick={() => setPage(current - 1)}>«</button>{Array.from({ length: pages }, (_, i) => <button key={i} className={i + 1 === current ? "is-current" : ""} aria-current={i + 1 === current ? "page" : undefined} onClick={() => setPage(i + 1)}>{i + 1}</button>)}<button disabled={current === pages} onClick={() => setPage(current + 1)}>»</button></nav></div> : null;
  return { shown, pager, reset: () => setPage(1) };
}

export function Dialog({ title, onClose, children, footer, coach }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; coach?: string }) {
  const id = useId();
  return <div className="sec-modal" role="dialog" aria-modal="true" aria-labelledby={id} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
    <div className="sec-modal-card" data-coach={coach}><div className="sec-modal-head"><h3 id={id}>{title}</h3><button className="sec-close" aria-label="Закрыть" onClick={onClose}>×</button></div>
      <div className="sec-modal-body">{children}</div>{footer && <div className="sec-modal-foot">{footer}</div>}</div>
  </div>;
}

/** Only file names are kept in the training: nothing leaves the browser. */
export function FilePicker({ files, onChange, limit, accept, coach, error }: { files: string[]; onChange: (files: string[]) => void; limit: number; accept: string; coach?: string; error?: string }) {
  return <div className={`sec-files${error ? " has-error" : ""}`} data-coach={coach}>
    <label className="crm-secondary sec-file-button">📎 Выбрать файлы<input type="file" multiple accept={accept} onChange={e => { const picked = Array.from(e.target.files ?? []).filter(f => f.size <= 5 * 1024 * 1024).map(f => f.name); onChange([...files, ...picked].slice(0, limit)); e.target.value = ""; }} /></label>
    {files.map((name, i) => <span key={`${name}-${i}`} className="sec-file">{name}<button type="button" aria-label={`Убрать ${name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}>×</button></span>)}
    {error && <small role="alert">{error}</small>}
  </div>;
}

export function Empty({ children }: { children: ReactNode }) { return <div className="sec-empty">{children}</div>; }
export function Reset({ onReset, what }: { onReset: () => void; what: string }) {
  return <button className="crm-secondary sec-reset" onClick={() => { if (window.confirm(`Вернуть учебные данные раздела «${what}» в исходное состояние?`)) onReset(); }}>⟲ Сбросить учебные данные</button>;
}
