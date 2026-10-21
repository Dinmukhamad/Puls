import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { WeekOut } from "../api/types";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { weekStatusLabel } from "../utils/format";
import { MONTH_NAMES, adjacentAvailableMonth, adjacentWeek, availableMonths, availableWeeks, calendarWeeks, monthCaption, monthInYear, weekRange } from "./weekCalendar";
import "./WeekPicker.css";

const usePopoverLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface WeekPickerProps {
  weeks: readonly WeekOut[];
  value?: number;
  /** The API's resolved default is authoritative, especially for ranked weeks. */
  resolvedWeekId?: number | null;
  onChange: (weekId: number | undefined) => void;
  label?: string;
  latestLabel?: string;
  latestPreference?: "ranked" | "latest";
  loading?: boolean;
}

export function WeekPicker({ weeks, value, resolvedWeekId, onChange, label = "Неделя", latestLabel = "Последняя рассчитанная", latestPreference = "ranked", loading = false }: WeekPickerProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState("");
  /** Weeks of the month, or the month and year grids opened from the popup's month row. */
  const [view, setView] = useState<"weeks" | "months" | "years">("weeks");
  const focusView = useRef(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const [host, setHost] = useState<HTMLElement | null>(null);
  const choices = availableWeeks(weeks);
  const fallback = (latestPreference === "ranked" ? choices.filter((week) => week.status !== "open").at(-1) : undefined) ?? choices.at(-1);
  const effective = value !== undefined ? choices.find((week) => week.id === value) : choices.find((week) => week.id === resolvedWeekId) ?? fallback;
  const authoritative = value !== undefined || resolvedWeekId != null || latestPreference === "latest";
  const selectedId = authoritative ? effective?.id : undefined;
  const previous = adjacentWeek(choices, selectedId, -1), next = adjacentWeek(choices, selectedId, 1);
  const caption = effective && authoritative ? weekRange(effective) : loading ? "Загрузка недель…" : value !== undefined ? "Неделя недоступна" : choices.length ? latestLabel : "Нет доступных недель";
  const rows = calendarWeeks(month, choices);
  const months = new Set(availableMonths(choices));
  const years = [...new Set([...months].map((item) => Number(item.slice(0, 4))))];
  const year = Number(month.slice(0, 4)), monthName = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? "";
  // The arrows step through what is shown: months with weeks, or years with weeks.
  const previousYear = years.filter((item) => item < year).at(-1), nextYear = years.find((item) => item > year);
  const previousMonth = view === "weeks" ? adjacentAvailableMonth(month, choices, -1) : view === "months" && previousYear !== undefined ? monthInYear(month, previousYear, choices) : undefined;
  const nextMonth = view === "weeks" ? adjacentAvailableMonth(month, choices, 1) : view === "months" && nextYear !== undefined ? monthInYear(month, nextYear, choices) : undefined;
  const stepLabels = view === "months" ? ["Предыдущий год", "Следующий год"] : ["Предыдущий месяц", "Следующий месяц"];

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function pick(weekId: number | undefined) { onChange(weekId); close(true); }
  function show(next: typeof view) { focusView.current = true; setView(next); }
  function toggle() {
    if (open) { close(); return; }
    setMonth(effective?.starts_on.slice(0, 7) ?? new Date().toISOString().slice(0, 7));
    setView("weeks");
    // Remain inside an existing Sheet so its focus trap and inert boundary work.
    setHost(root.current?.closest<HTMLElement>(".sheet") ?? document.body);
    setPosition({});
    setOpen(true);
  }

  usePopoverLayoutEffect(() => {
    if (!open || !host) return;
    const popup = panel.current;
    const topLayer = typeof popup?.showPopover === "function";
    if (topLayer) popup?.showPopover();
    function place() {
      const anchor = trigger.current, popup = panel.current;
      if (!anchor || !popup || !host) return;
      const rect = anchor.getBoundingClientRect();
      const inSheet = host !== document.body && !topLayer;
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0, viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth, viewportHeight = viewport?.height ?? window.innerHeight;
      const boundary = inSheet ? host.getBoundingClientRect() : { left: viewportLeft, top: viewportTop, right: viewportLeft + viewportWidth, bottom: viewportTop + viewportHeight, width: viewportWidth };
      const width = Math.min(340, boundary.width - 24);
      const height = Math.min(popup.scrollHeight, boundary.bottom - boundary.top - 24);
      const spaceBelow = boundary.bottom - rect.bottom - 12;
      const top = Math.max(boundary.top + 12, spaceBelow >= height ? rect.bottom + 8 : rect.top - height - 8);
      const left = Math.max(boundary.left + 12, Math.min(rect.left, boundary.right - width - 12));
      setPosition({ position: "fixed", width, left: left - (inSheet ? boundary.left : 0), top: top - (inSheet ? boundary.top : 0), maxHeight: boundary.bottom - top - 12, visibility: "visible" });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      if (topLayer && popup?.matches(":popover-open")) popup.hidePopover();
    };
  }, [open, host, month, view]);

  usePopoverLayoutEffect(() => {
    if (!open || position.visibility !== "visible") return;
    const popup = panel.current;
    // Native popovers and the click that opens them finish their focus/layout
    // work after React's layout effect. Focus the visible row on the next frame.
    const frame = requestAnimationFrame(() => {
      if (!popup?.isConnected || panel.current !== popup || popup.contains(document.activeElement)) return;
      (popup.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? popup.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus({ preventScroll: true });
    });
    function outside(event: Event) {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("focusin", outside); };
  }, [open, position.visibility]);

  useEffect(() => {
    if (!focusView.current) return;
    focusView.current = false;
    // The grid that just opened (or the weeks again) continues from its current choice.
    const grid = panel.current?.querySelector<HTMLElement>("[data-week-view]");
    (grid?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? grid?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus({ preventScroll: true });
  }, [view]);

  return <div className="week-picker" ref={root} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); } }}>
    <span className="field__label" id={`${id}-label`}>{label}</span>
    <div className="week-picker__control">
      <button type="button" className="week-picker__arrow" aria-label="Предыдущая неделя" title={previous ? weekRange(previous) : "Более ранних недель нет"} disabled={!previous || loading} onClick={() => previous && onChange(previous.id)}><ChevronLeftIcon size={17} /></button>
      <button type="button" className="week-picker__trigger" ref={trigger} aria-label={`${label}: ${caption}. Открыть календарь`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-calendar` : undefined} onClick={toggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4M17 3v4M3 11h18M7 15h2M12 15h2" /></svg>
        <span><strong>{caption}</strong><small>{value === undefined ? [latestLabel, effective ? weekStatusLabel(effective) : null].filter(Boolean).join(" · ") : effective ? weekStatusLabel(effective) : "Неделя недоступна"}</small></span>
      </button>
      <button type="button" className="week-picker__arrow" aria-label="Следующая неделя" title={next ? weekRange(next) : "Более поздних недель нет"} disabled={!next || loading} onClick={() => next && onChange(next.id)}><ChevronRightIcon size={17} /></button>
    </div>
    {open && host && createPortal(<div ref={panel} id={`${id}-calendar`} className="week-picker__popup" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} style={position} {...{ popover: "manual" }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (view === "weeks") close(true); else show("weeks"); } }}>
      <header className="week-picker__head"><div><strong id={`${id}-title`}>Выберите неделю</strong><span>Нажмите на строку с датами</span></div><button type="button" className="week-picker__close" aria-label="Закрыть календарь" onClick={() => close(true)}>×</button></header>
      <div className="week-picker__month">
        <button type="button" className="week-picker__arrow" aria-label={stepLabels[0]} disabled={!previousMonth} onClick={() => previousMonth && setMonth(previousMonth)}><ChevronLeftIcon size={17} /></button>
        <div className="week-picker__picks" aria-live="polite">
          {([["months", monthName, "Выбрать месяц"], ["years", String(year), "Выбрать год"]] as const).map(([target, text, action]) =>
            <button type="button" key={target} className="week-picker__pick" aria-expanded={view === target} aria-label={`${action}: сейчас ${text}`} onClick={() => show(view === target ? "weeks" : target)}>{text}<ChevronDownIcon size={14} /></button>)}
        </div>
        <button type="button" className="week-picker__arrow" aria-label={stepLabels[1]} disabled={!nextMonth} onClick={() => nextMonth && setMonth(nextMonth)}><ChevronRightIcon size={17} /></button>
      </div>
      {view === "weeks" && <div data-week-view="weeks">
        <div className="week-picker__weekdays" aria-hidden="true">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="week-picker__weeks" role="group" aria-label={`Недели: ${monthCaption(month)}`}>{rows.map((row) => <button type="button" key={row.start} className="week-picker__week" disabled={!row.week} aria-pressed={!!row.week && row.week.id === selectedId} title={row.week ? `${weekRange(row.week)} · ${weekStatusLabel(row.week)}` : "Нет недельных данных"} aria-label={row.week ? `Неделя ${weekRange(row.week, true)}. ${weekStatusLabel(row.week)}` : `Неделя ${row.start}: данных нет`} onClick={() => row.week && pick(row.week.id)}>{row.days.map((day) => <span key={day.key} className={day.inMonth ? undefined : "week-picker__outside-month"} aria-hidden="true">{day.day}</span>)}</button>)}</div>
      </div>}
      {view === "months" && <div className="week-picker__grid" data-week-view="months" role="group" aria-label={`Месяцы ${year} года`}>
        {MONTH_NAMES.map((name, index) => {
          const key = `${year}-${String(index + 1).padStart(2, "0")}`;
          return <button type="button" key={key} disabled={!months.has(key)} aria-pressed={key === month} title={months.has(key) ? undefined : "Недельных данных нет"} onClick={() => { setMonth(key); show("weeks"); }}>{name}</button>;
        })}
      </div>}
      {view === "years" && <div className="week-picker__grid" data-week-view="years" role="group" aria-label="Годы с неделями">
        {years.map((item) => <button type="button" key={item} aria-pressed={item === year} onClick={() => { setMonth(monthInYear(month, item, choices) ?? month); show("months"); }}>{item}</button>)}
      </div>}
      <p className="week-picker__hint">{view === "weeks" ? "Серые даты — недельных данных ещё нет." : view === "months" ? "Серые месяцы — недельных данных нет." : "Здесь только годы, за которые есть недели."}</p>
      {!choices.length && <p className="week-picker__empty" role="status">{loading ? "Загружаем доступные недели…" : "Пока нет доступных недель"}</p>}
      <button type="button" className="week-picker__latest" onClick={() => pick(undefined)}>{latestLabel}<span>{effective && authoritative && value === undefined ? weekRange(effective) : "Автоматический выбор"}</span></button>
    </div>, host)}
  </div>;
}
