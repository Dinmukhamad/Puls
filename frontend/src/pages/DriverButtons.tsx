import { useId, useState, type CSSProperties, type ReactNode } from "react";
import "./driver-ui.css";

/* Четыре роли кнопок Driver Simulator.
   Водитель должен понимать назначение кнопки до того, как прочитает подпись:
   действие двигает сценарий, выбор ничего не меняет, инструкция объясняет, отмена выходит. */

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Доля пути до разблокировки по расстоянию: 1 — вы внутри радиуса подтверждения. */
export function approach(distance: number | null | undefined, radius: number, from = 600) {
  if (distance == null) return 0;
  if (distance <= radius) return 1;
  return clamp((from - distance) / Math.max(1, from - radius));
}
/** Доля пути до разблокировки по времени: 1 — ожидание закончилось. */
export function countdown(elapsed: number, total: number) {
  return total <= 0 ? 1 : clamp(elapsed / total);
}

interface ActionProps {
  label: string;
  onClick?: () => void;
  type?: "button" | "submit";
  /** Запрос выполняется: кнопка занята, дуга гаснет. */
  busy?: boolean;
  busyLabel?: string;
  /** Действие пока недоступно. Обязательно объясните причину в `reason`. */
  blocked?: boolean;
  /** 0…1 — сколько пройдено до разблокировки. Рисует жёлтую дугу по контуру кнопки. */
  progress?: number | null;
  /** Короткое значение у причины: «65 м», «0:12». */
  meter?: ReactNode;
  /** Почему нельзя нажать. Показывается всегда, пока кнопка заблокирована. */
  reason?: ReactNode;
  /** Что произойдёт по нажатию. Показывается, когда действие доступно. */
  readyNote?: ReactNode;
  className?: string;
}
/** Роль «Действие»: шаг сценария. Жёлтая заливка, дуга готовности, ореол когда можно жать. */
export function DAction({ label, onClick, type = "button", busy, busyLabel = "Подождите…", blocked, progress, meter, reason, readyNote, className = "" }: ActionProps) {
  const help = useId();
  const state = busy ? "busy" : blocked ? "blocked" : "ready";
  const note = busy ? null : blocked ? reason : readyNote ?? null;
  const filled = busy ? clamp(progress ?? 0) : blocked ? clamp(progress ?? 0) : 1;
  return <div className={`du-act ${className}`.trim()} data-state={state} style={{ "--du-progress": filled } as CSSProperties}>
    <div className="du-act__slot">
      <button className="du-btn du-action" type={type} disabled={busy || blocked} onClick={onClick} aria-describedby={note ? help : undefined}>{busy ? busyLabel : label}</button>
      <span className="du-act__ring" aria-hidden="true" />
    </div>
    {note && <p className="du-reason" id={help} data-tone={state}>{meter && <b>{meter}</b>}{note}</p>}
  </div>;
}

interface ChoiceProps { children: ReactNode; onClick?: () => void; disabled?: boolean; arrow?: boolean; type?: "button" | "submit"; className?: string }
/** Роль «Выбор»: переход или переключение, которое не двигает сценарий. */
export function DChoice({ children, onClick, disabled, arrow, type = "button", className = "" }: ChoiceProps) {
  return <button className={`du-btn du-choice ${className}`.trim()} type={type} disabled={disabled} onClick={onClick}>{children}{arrow && <span className="du-choice__arrow" aria-hidden="true">→</span>}</button>;
}

interface ChipProps { children: ReactNode; onClick?: () => void; disabled?: boolean; pressed?: boolean; icon?: string }
/** Компактный выбор в строку: способ указать адрес, режим, точку на карте. */
export function DChip({ children, onClick, disabled, pressed, icon }: ChipProps) {
  return <button className="du-chip" type="button" disabled={disabled} aria-pressed={pressed} onClick={onClick}>{icon && <span aria-hidden="true">{icon}</span>}<span>{children}</span></button>;
}

/** Роль «Отмена»: выход из заказа, отказ, возврат назад. */
export function DCancel({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button className="du-cancel" type="button" disabled={disabled} onClick={onClick}>{children}</button>;
}

/** Роль «Инструкция»: пунктирная рамка и значок «i». Никогда ничего не отправляет. */
export function DInfo({ title, children, defaultOpen }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const body = useId();
  return <div className="du-info" data-open={open}>
    <button className="du-btn du-info__button" type="button" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>
      <span className="du-info__mark" aria-hidden="true">i</span>
      <span className="du-info__title">{title}</span>
      <span className="du-info__chevron" aria-hidden="true" />
    </button>
    {open && <div className="du-info__body" id={body}>{children}</div>}
  </div>;
}

/** Инструкция для кнопки-заглушки: что она делает в парке и что делает здесь. */
export function DExplain({ title = "Что это в реальной работе", real, sim }: { title?: string; real: ReactNode; sim: ReactNode }) {
  return <DInfo title={title}>
    <p><b>В приложении парка:</b> {real}</p>
    <p><b>В тренажёре:</b> {sim}</p>
  </DInfo>;
}

const roles = [
  ["action", "▮", "Действие", "Двигает заказ дальше. Жёлтая дуга показывает, сколько осталось до разблокировки, а ореол — что можно нажимать."],
  ["choice", "▯", "Выбор", "Меняет адрес, режим или экран. Сценарий не двигает, вернуться можно всегда."],
  ["info", "i", "Инструкция", "Только объясняет. Пунктирная рамка — ничего не отправляет и не меняет."],
  ["cancel", "✕", "Отмена", "Выход из заказа или смены. Всегда спрашивает подтверждение."],
] as const;
/** Легенда ролей: объясняет язык кнопок прямо внутри тренажёра. */
export function DLegend() {
  return <div className="du-legend">{roles.map(([role, mark, title, text]) => <div key={role}><i data-role={role} aria-hidden="true">{mark}</i><div><strong>{title}</strong><span>{text}</span></div></div>)}</div>;
}
