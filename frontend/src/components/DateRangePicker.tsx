import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";
import { Select } from "./Select";
import { formatDateRange, inclusiveRangeDays, todayDateKey, validDateRange, type DateRange } from "./dateRange";
import "./DateRangePicker.css";

export type { DateRange } from "./dateRange";

export interface DateRangePickerProps {
  value?: DateRange;
  defaultRange?: DateRange;
  onChange: (range: DateRange) => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  ariaLabel?: string;
  /** One date instead of a period: a tap picks it and closes the calendar (see DatePicker). */
  single?: boolean;
  /** What the closed field says while nothing is chosen. */
  placeholder?: string;
  /** Offers «Очистить» for an optional date. */
  onClear?: () => void;
}

const usePopoverLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
// The calendar and its animations load with the first opened picker, not with every page.
const Calendar = lazy(() => import("./ui/calendar").then((module) => ({ default: module.Calendar })));
// The site speaks «YYYY-MM-DD»; the calendar speaks local dates.
const asDate = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)) || 1);
const asKey = (date: Date) => `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const days = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "день" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "дня" : "дней"}`;

/**
 * One calendar and nothing else: the first tap is the period's start, the second its end (or Apply right
 * away for one day). Dates are a draft until Apply: selecting a day never starts a data request. The days are
 * the site's Calendar primitive (components/ui/calendar.tsx): months slide, and the month or the year is a tap away.
 */
export function DateRangePicker({ value, defaultRange, onChange, disabled = false, loading = false, className = "", ariaLabel = "Период", single = false, placeholder, onClear }: DateRangePickerProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const effective = value ?? defaultRange;
  const today = todayDateKey();
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const [draft, setDraft] = useState<DateRange>({ date_from: today, date_to: today });
  const [month, setMonth] = useState(today.slice(0, 7));
  const [anchor, setAnchor] = useState<string | null>(null);
  const valid = validDateRange(draft);
  const count = inclusiveRangeDays(draft);
  const caption = !effective && loading ? "Загрузка периода…" : !validDateRange(effective) && placeholder ? placeholder : formatDateRange(effective);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  function toggle() {
    if (open) { close(); return; }
    const initial = validDateRange(effective) ? effective : { date_from: today, date_to: today };
    setDraft({ ...initial }); setMonth(initial.date_from.slice(0, 7));
    setAnchor(null); setPosition({});
    // Keep the DOM inside an existing dialog's focus trap and inert boundary.
    setHost(root.current?.closest<HTMLElement>(".sheet") ?? document.body);
    setOpen(true);
  }

  function pickDate(key: string) {
    if (single) { onChange({ date_from: key, date_to: key }); close(true); return; }
    if (!anchor) { setDraft({ date_from: key, date_to: key }); setAnchor(key); }
    else { setDraft({ date_from: key < anchor ? key : anchor, date_to: key < anchor ? anchor : key }); setAnchor(null); }
  }

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  usePopoverLayoutEffect(() => {
    if (!open || !host) return;
    const popup = panel.current;
    const topLayer = typeof popup?.showPopover === "function";
    if (topLayer) popup?.showPopover();
    function place() {
      const button = trigger.current, popup = panel.current;
      if (!button || !popup || !host) return;
      const rect = button.getBoundingClientRect();
      const inSheet = host !== document.body && !topLayer;
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0, viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth, viewportHeight = viewport?.height ?? window.innerHeight;
      const boundary = inSheet ? host.getBoundingClientRect() : { left: viewportLeft, top: viewportTop, right: viewportLeft + viewportWidth, bottom: viewportTop + viewportHeight, width: viewportWidth };
      const width = Math.max(0, Math.min(400, boundary.width - 24));
      const height = Math.min(popup.scrollHeight, boundary.bottom - boundary.top - 24);
      const below = boundary.bottom - rect.bottom - 12;
      const top = Math.max(boundary.top + 12, below >= height ? rect.bottom + 8 : rect.top - height - 8);
      const left = Math.max(boundary.left + 12, Math.min(rect.left, boundary.right - width - 12));
      setPosition({ position: "fixed", width, left: left - (inSheet ? boundary.left : 0), top: top - (inSheet ? boundary.top : 0), maxHeight: boundary.bottom - top - 12 });
    }
    place();
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      if (topLayer && popup?.matches(":popover-open")) popup.hidePopover();
    };
  }, [open, host, month]);

  usePopoverLayoutEffect(() => {
    if (!open || position.top === undefined) return;
    const popup = panel.current;
    let waiting: MutationObserver | undefined;
    // The day to start from; on the first opening the calendar is still loading, so wait for it to appear.
    const focusDay = () => {
      if (!popup?.isConnected || panel.current !== popup || popup.contains(document.activeElement)) return true;
      const day = popup.querySelector<HTMLButtonElement>('[data-slot="calendar"] [role="grid"] button[tabindex="0"]');
      day?.focus({ preventScroll: true });
      return !!day;
    };
    const frame = requestAnimationFrame(() => {
      if (focusDay() || !popup) return;
      waiting = new MutationObserver(() => { if (focusDay()) waiting?.disconnect(); });
      waiting.observe(popup, { childList: true, subtree: true });
    });
    function outside(event: Event) {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    }
    document.addEventListener("pointerdown", outside, true); document.addEventListener("focusin", outside);
    return () => { cancelAnimationFrame(frame); waiting?.disconnect(); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("focusin", outside); };
  }, [open, position.top]);

  return <div ref={root} className={`date-range-picker ${className}`.trim()}>
    <button type="button" className="date-range-picker__trigger" ref={trigger} disabled={disabled} aria-label={`${ariaLabel}: ${caption}. Открыть календарь`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-calendar` : undefined} aria-busy={loading || undefined} onClick={toggle}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4M17 3v4M3 11h18M7 15h2M12 15h2" /></svg>
      <span>{caption}</span>
      <svg className={open ? "date-range-picker__chevron is-open" : "date-range-picker__chevron"} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && host && createPortal(<div ref={panel} id={`${id}-calendar`} className="date-range-picker__popup" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} style={position} {...{ popover: "manual" }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); } }}>
      <h2 className="sr-only" id={`${id}-title`}>{single ? "Выберите дату" : "Выберите период"}</h2>
      <Suspense fallback={<div className="date-range-picker__loading" role="status">Загрузка календаря…</div>}>{single
        ? <Calendar className="date-range-picker__calendar" month={asDate(`${month}-01`)} onMonthChange={(next) => setMonth(asKey(next).slice(0, 7))}
          selected={validDateRange(effective) ? asDate(effective.date_from) : undefined} onSelect={(date) => pickDate(date ? asKey(date) : effective?.date_from ?? today)} />
        : <Calendar mode="range" className="date-range-picker__calendar" month={asDate(`${month}-01`)} onMonthChange={(next) => setMonth(asKey(next).slice(0, 7))}
          selected={anchor ? { from: asDate(anchor) } : valid ? { from: asDate(draft.date_from), to: asDate(draft.date_to) } : {}}
          onSelect={(range) => { if (range?.from && !range.to) { setDraft({ date_from: asKey(range.from), date_to: asKey(range.from) }); setAnchor(asKey(range.from)); } else if (range?.from && range.to) { setDraft({ date_from: asKey(range.from), date_to: asKey(range.to) }); setAnchor(null); } }} />}</Suspense>
      {single ? <footer className="date-range-picker__footer">
        <Button onClick={() => close(true)}>Отмена</Button>
        {onClear && validDateRange(effective) ? <Button onClick={() => { onClear(); close(true); }}>Очистить</Button> : <Button onClick={() => pickDate(today)}>Сегодня</Button>}
      </footer> : <><p className="date-range-picker__hint" aria-live="polite">{anchor ? "Выберите дату окончания — или примените один день" : valid ? <><strong>{formatDateRange(draft)}</strong> · {days(count)}</> : "Нажмите дату начала, затем дату окончания"}</p>
      <footer className="date-range-picker__footer"><Button onClick={() => close(true)}>Отмена</Button><Button variant="primary" disabled={!valid} onClick={() => { if (valid) { onChange({ ...draft }); close(true); } }}>Применить</Button></footer></>}
    </div>, host)}
  </div>;
}

/**
 * One date in the site's calendar instead of the browser's field: the closed field shows «17.10.2026», a tap on a day
 * picks it. `value` and `onChange` speak «YYYY-MM-DD»; an empty string is no date.
 */
export function DatePicker({ value, onChange, placeholder = "Выбрать дату", clearable = false, disabled, className = "", ariaLabel = "Дата" }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return <DateRangePicker single className={`date-picker ${className}`.trim()} value={value ? { date_from: value, date_to: value } : undefined}
    onChange={range => onChange(range.date_from)} onClear={clearable ? () => onChange("") : undefined}
    placeholder={placeholder} disabled={disabled} ariaLabel={ariaLabel} />;
}

/** Times of day for a deadline, every half hour. */
export const HALF_HOURS = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);

/**
 * A date and a time («YYYY-MM-DDTHH:MM», local, as the browser's datetime field gave it): the site's calendar and a list
 * of half hours. A time that is not on the half hour stays in the list as it is.
 */
export function DateTimePicker({ value, onChange, clearable = false, disabled, ariaLabel = "Дата и время", defaultTime = "23:30" }: {
  value: string;
  onChange: (value: string) => void;
  clearable?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  defaultTime?: string;
}) {
  const [date, time] = value ? [value.slice(0, 10), value.slice(11, 16)] : ["", ""];
  const times = time && !HALF_HOURS.includes(time) ? [...HALF_HOURS, time].sort() : HALF_HOURS;
  return <div className="date-time-picker">
    <DatePicker ariaLabel={ariaLabel} value={date} clearable={clearable} disabled={disabled} onChange={next => onChange(next ? `${next}T${time || defaultTime}` : "")} />
    <Select aria-label={`${ariaLabel}: время`} value={time} disabled={disabled || !date} onChange={next => onChange(`${date}T${next}`)}
      options={[...(time ? [] : [{ value: "", label: "Время" }]), ...times.map(item => ({ value: item, label: item }))]} />
  </div>;
}
