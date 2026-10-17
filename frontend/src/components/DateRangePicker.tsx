import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { Button } from "./ui";
import { Select } from "./Select";
import { calendarDate, dateKey, monthCaption, shiftDays, shiftMonth } from "./weekCalendar";
import { formatDateRange, inclusiveRangeDays, moveCalendarMonth, rangeCalendarDays, todayDateKey, validDateRange, type DateRange } from "./dateRange";
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
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const days = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "день" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "дня" : "дней"}`;

/**
 * One calendar and nothing else: the first tap is the period's start, the second its end (or Apply right
 * away for one day). Dates are a draft until Apply: selecting a day never starts a data request.
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
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusedDate, setFocusedDate] = useState(today);
  const valid = validDateRange(draft);
  const grid = rangeCalendarDays(month);
  const count = inclusiveRangeDays(draft);
  const caption = !effective && loading ? "Загрузка периода…" : !validDateRange(effective) && placeholder ? placeholder : formatDateRange(effective);
  const preview = anchor && hovered ? { date_from: anchor < hovered ? anchor : hovered, date_to: anchor < hovered ? hovered : anchor } : draft;
  const activeDay = grid.some((day) => day.key === focusedDate) ? focusedDate : grid.find((day) => day.inMonth)?.key;

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  function toggle() {
    if (open) { close(); return; }
    const initial = validDateRange(effective) ? effective : { date_from: today, date_to: today };
    setDraft({ ...initial }); setMonth(initial.date_from.slice(0, 7)); setFocusedDate(initial.date_from);
    setAnchor(null); setHovered(null); setPosition({});
    // Keep the DOM inside an existing dialog's focus trap and inert boundary.
    setHost(root.current?.closest<HTMLElement>(".sheet") ?? document.body);
    setOpen(true);
  }

  function pickDate(key: string) {
    if (single) { onChange({ date_from: key, date_to: key }); close(true); return; }
    if (!anchor) { setDraft({ date_from: key, date_to: key }); setAnchor(key); }
    else { setDraft({ date_from: key < anchor ? key : anchor, date_to: key < anchor ? anchor : key }); setAnchor(null); }
    setHovered(null); setFocusedDate(key);
  }

  function focusDate(key: string) {
    if (!calendarDate(key) || key < "0001-01-01" || key > "9999-12-31") return;
    setFocusedDate(key); setMonth(key.slice(0, 7));
    requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)?.focus({ preventScroll: true }));
  }

  function onDayKey(event: KeyboardEvent<HTMLButtonElement>, key: string) {
    const date = calendarDate(key)!;
    let next: string | undefined;
    const shifts: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in shifts) next = dateKey(shiftDays(date, shifts[event.key]));
    else if (event.key === "Home") next = dateKey(shiftDays(date, -((date.getUTCDay() + 6) % 7)));
    else if (event.key === "End") next = dateKey(shiftDays(date, 6 - ((date.getUTCDay() + 6) % 7)));
    else if (event.key === "PageUp" || event.key === "PageDown") next = moveCalendarMonth(key, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1));
    if (next) { event.preventDefault(); event.stopPropagation(); focusDate(next); }
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
    const frame = requestAnimationFrame(() => {
      if (!popup?.isConnected || panel.current !== popup || popup.contains(document.activeElement)) return;
      (popup.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`) ?? popup.querySelector<HTMLButtonElement>('[data-date][tabindex="0"]'))?.focus({ preventScroll: true });
    });
    function outside(event: Event) {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    }
    document.addEventListener("pointerdown", outside, true); document.addEventListener("focusin", outside);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("focusin", outside); };
  }, [open, position.top, focusedDate]);

  return <div ref={root} className={`date-range-picker ${className}`.trim()}>
    <button type="button" className="date-range-picker__trigger" ref={trigger} disabled={disabled} aria-label={`${ariaLabel}: ${caption}. Открыть календарь`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-calendar` : undefined} aria-busy={loading || undefined} onClick={toggle}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4M17 3v4M3 11h18M7 15h2M12 15h2" /></svg>
      <span>{caption}</span>
      <svg className={open ? "date-range-picker__chevron is-open" : "date-range-picker__chevron"} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && host && createPortal(<div ref={panel} id={`${id}-calendar`} className="date-range-picker__popup" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} style={position} {...{ popover: "manual" }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); } }}>
      <h2 className="sr-only" id={`${id}-title`}>{single ? "Выберите дату" : "Выберите период"}</h2>
      <div className="date-range-picker__month"><button type="button" className="date-range-picker__arrow" aria-label="Предыдущий месяц" disabled={month <= "0001-01"} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeftIcon size={18} /></button><strong aria-live="polite">{capitalized(monthCaption(month))}</strong><button type="button" className="date-range-picker__arrow" aria-label="Следующий месяц" disabled={month >= "9999-12"} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRightIcon size={18} /></button></div>
      <div className="date-range-picker__weekdays" aria-hidden="true">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="date-range-picker__days" role="group" aria-label={`Даты: ${monthCaption(month)}`} onPointerLeave={() => setHovered(null)}>{grid.map((day, index) => {
        const selected = valid && day.key >= draft.date_from && day.key <= draft.date_to;
        const inPreview = validDateRange(preview) && day.key >= preview.date_from && day.key <= preview.date_to;
        const from = inPreview && day.key === preview.date_from, to = inPreview && day.key === preview.date_to;
        // The band runs across a week's row and rounds where the period or the row starts and ends.
        const rowStart = index % 7 === 0, rowEnd = index % 7 === 6;
        const label = calendarDate(day.key)?.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) ?? "Дата вне допустимого диапазона";
        const cls = ["date-range-picker__cell", inPreview && "is-in-range", from && "is-from", to && "is-to", inPreview && rowStart && "is-row-start", inPreview && rowEnd && "is-row-end"].filter(Boolean).join(" ");
        return <span key={day.key} className={cls}><button type="button" data-date={day.key} className={`date-range-picker__day${!day.inMonth ? " is-outside" : ""}${from || to ? " is-endpoint" : ""}`} disabled={!day.selectable} tabIndex={day.key === activeDay ? 0 : -1} aria-label={`${label}${single ? from ? ", выбрана" : "" : from && to ? ", начало и конец периода" : from ? ", начало периода" : to ? ", конец периода" : ""}`} aria-pressed={selected} aria-current={day.key === today ? "date" : undefined} onFocus={() => setFocusedDate(day.key)} onPointerEnter={() => anchor && setHovered(day.key)} onKeyDown={(event) => onDayKey(event, day.key)} onClick={() => pickDate(day.key)}>{day.day}</button></span>;
      })}</div>
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
