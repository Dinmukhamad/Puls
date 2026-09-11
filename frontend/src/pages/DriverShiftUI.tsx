import type { FormEvent, ReactNode } from "react";
import type { DriverShift, ShiftAct } from "../api/driverShift";
import type { DriverState } from "../api/driver";
import { DAction } from "./DriverButtons";

export interface ShiftViewProps { shift: DriverShift; state: DriverState; view: string; detail: string; fullName: string; busy: boolean; act: ShiftAct; go: (view: string, detail?: string) => void; switchPark: () => void; support: () => void }
export function DCard({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return <section className={`driver-card ds-card ${className}`}>{title && <h2>{title}</h2>}{children}</section>;
}
export function DRow({ title, value, note, onClick }: { title: string; value?: ReactNode; note?: string; onClick?: () => void }) {
  const contents = <><span><strong>{title}</strong>{note && <small>{note}</small>}</span><span>{value}{onClick && <b aria-hidden="true">›</b>}</span></>;
  return onClick ? <button className="ds-row" onClick={onClick}>{contents}</button> : <div className="ds-row">{contents}</div>;
}
export function DToggle({ title, checked, onChange, note, disabled }: { title: string; checked: boolean; onChange: () => void; note?: string; disabled?: boolean }) {
  return <label className="ds-toggle"><span>{title}{note && <small>{note}</small>}</span><input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} /><i aria-hidden="true" /></label>;
}
export function DRadio({ title, name, value, checked, onChange, note, disabled }: { title: string; name: string; value: string; checked: boolean; onChange: () => void; note?: string; disabled?: boolean }) {
  return <label className="ds-radio"><input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} /><span><strong>{title}</strong>{note && <small>{note}</small>}</span></label>;
}
export function DForm({ children, onSubmit, label, busy }: { children: ReactNode; onSubmit: (values: Record<string, unknown>) => void; label: string; busy: boolean }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget, values: Record<string, unknown> = {};
    for (const [key, value] of new FormData(form)) {
      const input = form.elements.namedItem(key);
      values[key] = input instanceof HTMLInputElement && input.type === "number" ? Number(value) : value;
    }
    onSubmit(values);
  }
  return <form className="ds-form" onSubmit={submit}><fieldset disabled={busy}>{children}<DAction type="submit" busy={busy} busyLabel="Сохраняем…" label={label} /></fieldset></form>;
}
export function DInput({ label, name, type = "text", value, min, max, placeholder }: { label: string; name: string; type?: string; value?: string | number; min?: number | string; max?: number | string; placeholder?: string }) {
  return <label>{label}<input name={name} type={type} defaultValue={value} min={min} max={max} maxLength={160} placeholder={placeholder} required /></label>;
}
export function CarArt({ color = "#c2c6cc" }: { color?: string }) {
  return <svg className="ds-car-art" viewBox="0 0 400 160" aria-label="Учебный автомобиль" role="img"><ellipse cx="200" cy="130" rx="170" ry="12" fill="#000" opacity=".18" /><path d="M37 102 54 76 102 66 154 28 249 28 306 68 353 80 368 108 358 122H41Z" fill={color} /><path d="m121 66 41-28h77l42 30z" fill="#333c48" /><path d="M201 36v34m-94 8h199" stroke="#8e96a0" strokeWidth="3" /><path d="M47 92h30m247 0h30" stroke="#fff5bd" strokeWidth="9" /><g fill="#202227" stroke="#626a72" strokeWidth="8"><circle cx="105" cy="116" r="25" /><circle cx="302" cy="116" r="25" /></g><path d="M107 114h193" stroke="#9099a1" strokeWidth="5" /></svg>;
}
