"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { IconChevronDown, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ─── Types ─────────────────────────────────────────────────── */

export type CalendarMode = "single" | "range" | "multiple";

export interface DateRange {
  from?: Date;
  to?: Date;
}

export interface CalendarEvent {
  date: Date;
  label?: string;
}

interface CalendarSharedProps {
  /** Month currently displayed (controlled). */
  month?: Date;
  /** Initial displayed month (uncontrolled). Defaults to today's month. */
  defaultMonth?: Date;
  onMonthChange?: (month: Date) => void;
  /** 0 = Sunday, 1 = Monday. Default 1, as everywhere on the site. */
  weekStartsOn?: 0 | 1;
  /** Return true to disable a date from selection. */
  disabled?: (date: Date) => boolean;
  /** Dates that are unavailable/reserved, shown struck-through and disabled. */
  bookedDates?: Date[];
  /** Dates with a scheduled-event indicator dot. */
  events?: CalendarEvent[];
  /** The header's month and year buttons open month and year grids. Default true. */
  quickNav?: boolean;
  className?: string;
}

interface CalendarSingleProps extends CalendarSharedProps {
  mode?: "single";
  selected?: Date;
  defaultSelected?: Date;
  onSelect?: (date: Date | undefined) => void;
}

interface CalendarMultipleProps extends CalendarSharedProps {
  mode: "multiple";
  selected?: Date[];
  defaultSelected?: Date[];
  onSelect?: (dates: Date[]) => void;
}

interface CalendarRangeProps extends CalendarSharedProps {
  mode: "range";
  selected?: DateRange;
  defaultSelected?: DateRange;
  onSelect?: (range: DateRange | undefined) => void;
}

export type CalendarProps = CalendarSingleProps | CalendarMultipleProps | CalendarRangeProps;

/* ─── Easing ────────────────────────────────────────────────── */

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/* ─── Date Helpers ──────────────────────────────────────────── */

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const WEEKDAY_LABELS_SUN = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WEEKDAY_LABELS_MON = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function dayLabel(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function isSameDay(a?: Date, b?: Date): boolean {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function isBefore(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() < startOfDay(b).getTime();
}

function isWithinRange(date: Date, range: DateRange): boolean {
  if (!range.from || !range.to) return false;
  const t = startOfDay(date).getTime();
  const from = startOfDay(range.from).getTime();
  const to = startOfDay(range.to).getTime();
  return t > Math.min(from, to) && t < Math.max(from, to);
}

function buildMonthGrid(month: Date, weekStartsOn: 0 | 1): Date[] {
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstWeekday = firstOfMonth.getDay();
  const leading = weekStartsOn === 1 ? (firstWeekday + 6) % 7 : firstWeekday;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - leading);

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

/* ─── Shared classes ────────────────────────────────────────── */

// The site's look (its tokens are bridged in styles/ui.css): soft grey controls, a dark choice with a soft shadow, a ring
// around today.
const RING = "focus-visible:ring-2 focus-visible:ring-[color:var(--primitive-ring,color-mix(in_srgb,var(--foreground)_45%,transparent))]";
const HOVER = "hover:bg-[color:var(--primitive-surface-hover,color-mix(in_srgb,var(--foreground)_4%,transparent))]";
const SOFT = "bg-[color:var(--primitive-control-soft,transparent)]";
const SOLID = "bg-[var(--primary)] text-[var(--primary-foreground)] font-[650] shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_35%,transparent)]";
const TODAY = "shadow-[inset_0_0_0_1.5px_var(--primary)] font-semibold";
const BAND = "bg-[color:var(--primitive-surface-selected,color-mix(in_srgb,var(--foreground)_6%,transparent))]";

/* ─── <Calendar> ────────────────────────────────────────────── */

export const Calendar = React.forwardRef<HTMLDivElement, CalendarProps>((props, ref) => {
  const {
    mode = "single",
    month: controlledMonth,
    defaultMonth,
    onMonthChange,
    weekStartsOn = 1,
    disabled,
    bookedDates,
    events,
    quickNav = true,
    className,
    selected,
    defaultSelected,
    onSelect,
  } = props as CalendarSharedProps & {
    mode?: CalendarMode;
    selected?: Date | Date[] | DateRange;
    defaultSelected?: Date | Date[] | DateRange;
    onSelect?: (value: Date | undefined | Date[] | DateRange | undefined) => void;
  };

  const prefersReducedMotion = useReducedMotion();
  const today = React.useMemo(() => startOfDay(new Date()), []);

  const [internalMonth, setInternalMonth] = React.useState(() =>
    startOfDay(defaultMonth ?? controlledMonth ?? new Date()),
  );
  const isMonthControlled = controlledMonth !== undefined;
  const displayedMonth = isMonthControlled ? controlledMonth : internalMonth;

  const [navView, setNavView] = React.useState<"days" | "months" | "years">("days");
  const [direction, setDirection] = React.useState(1);
  // Center of the 12-year picker grid, independent of displayedMonth so
  // paging through years (via the picker's own prev/next) doesn't require
  // navigating the actual displayed month.
  const [yearAnchor, setYearAnchor] = React.useState(() => displayedMonth.getFullYear());

  // A view opened from the header or a grid takes the focus to its current button, so the keyboard
  // continues where the eye goes; switching views from outside (none today) would not steal it.
  const viewsRef = React.useRef<HTMLDivElement | null>(null);
  const focusViewRef = React.useRef(false);

  function openView(view: "days" | "months" | "years") {
    focusViewRef.current = true;
    setNavView(view);
  }

  function openYearsView() {
    setYearAnchor(displayedMonth.getFullYear());
    openView("years");
  }

  React.useEffect(() => {
    if (!focusViewRef.current) return;
    focusViewRef.current = false;
    const target = navView === "days"
      ? dayGridRef.current?.querySelector<HTMLElement>('button[tabindex="0"]')
      : viewsRef.current?.querySelector<HTMLElement>(`[data-calendar-view="${navView}"] button[aria-current="true"]`);
    target?.focus({ preventScroll: true });
  }, [navView]);

  // When keyboard nav crosses a month boundary, the day grid remounts (its
  // motion.div key changes) so the old DOM node queried synchronously is the
  // exiting month's grid, not the one containing the target date. Stash the
  // target here and focus it once the new month's grid is actually mounted.
  const dayGridRef = React.useRef<HTMLDivElement | null>(null);
  const pendingFocusDateRef = React.useRef<Date | null>(null);

  React.useEffect(() => {
    if (!pendingFocusDateRef.current) return;
    const iso = pendingFocusDateRef.current.toDateString();
    pendingFocusDateRef.current = null;
    (dayGridRef.current?.querySelector(`[data-date-key="${iso}"]`) as HTMLElement | null)?.focus();
  }, [displayedMonth]);

  const setMonth = React.useCallback(
    (next: Date, dir: number) => {
      setDirection(dir);
      if (!isMonthControlled) setInternalMonth(next);
      onMonthChange?.(next);
    },
    [isMonthControlled, onMonthChange],
  );

  // Internal selection state, used when the caller does not control `selected`.
  const [internalSingle, setInternalSingle] = React.useState<Date | undefined>(
    mode === "single" ? (defaultSelected as Date | undefined) : undefined,
  );
  const [internalMultiple, setInternalMultiple] = React.useState<Date[]>(
    mode === "multiple" ? ((defaultSelected as Date[] | undefined) ?? []) : [],
  );
  const [internalRange, setInternalRange] = React.useState<DateRange | undefined>(
    mode === "range" ? (defaultSelected as DateRange | undefined) : undefined,
  );

  const isSelectedControlled = selected !== undefined;

  const currentSingle = mode === "single" ? ((isSelectedControlled ? selected : internalSingle) as Date | undefined) : undefined;
  const currentMultiple = mode === "multiple" ? ((isSelectedControlled ? selected : internalMultiple) as Date[]) : [];
  const currentRange = mode === "range" ? ((isSelectedControlled ? selected : internalRange) as DateRange | undefined) : undefined;

  function isDisabled(date: Date): boolean {
    if (bookedDates?.some((b) => isSameDay(b, date))) return true;
    return disabled?.(date) ?? false;
  }

  function isBooked(date: Date): boolean {
    return bookedDates?.some((b) => isSameDay(b, date)) ?? false;
  }

  function eventFor(date: Date): CalendarEvent | undefined {
    return events?.find((e) => isSameDay(e.date, date));
  }

  function handleSelectDay(date: Date) {
    if (isDisabled(date)) return;

    if (mode === "single") {
      const next = isSameDay(currentSingle, date) ? undefined : date;
      if (!isSelectedControlled) setInternalSingle(next);
      (onSelect as CalendarSingleProps["onSelect"])?.(next);
      return;
    }

    if (mode === "multiple") {
      const exists = currentMultiple.some((d) => isSameDay(d, date));
      const next = exists ? currentMultiple.filter((d) => !isSameDay(d, date)) : [...currentMultiple, date];
      if (!isSelectedControlled) setInternalMultiple(next);
      (onSelect as CalendarMultipleProps["onSelect"])?.(next);
      return;
    }

    // range
    const from = currentRange?.from;
    const to = currentRange?.to;
    let next: DateRange;
    if (!from || (from && to)) {
      next = { from: date, to: undefined };
    } else if (isBefore(date, from)) {
      next = { from: date, to: from };
    } else {
      next = { from, to: date };
    }
    if (!isSelectedControlled) setInternalRange(next);
    (onSelect as CalendarRangeProps["onSelect"])?.(next);
  }

  function goToMonth(offset: number) {
    setMonth(addMonths(displayedMonth, offset), offset >= 0 ? 1 : -1);
  }

  /** The header arrows: a month over the days, a year over the months, twelve years over the years. */
  function step(dir: -1 | 1) {
    if (navView === "years") setYearAnchor((y) => y + dir * 12);
    else goToMonth(navView === "months" ? dir * 12 : dir);
  }
  const arrowLabels = navView === "days"
    ? ["Предыдущий месяц", "Следующий месяц"]
    : navView === "months" ? ["Предыдущий год", "Следующий год"] : ["Предыдущие годы", "Следующие годы"];

  const weekdayLabels = weekStartsOn === 1 ? WEEKDAY_LABELS_MON : WEEKDAY_LABELS_SUN;
  const grid = React.useMemo(
    () => buildMonthGrid(displayedMonth, weekStartsOn),
    [displayedMonth, weekStartsOn],
  );

  // Roving tabindex target: the selected day if it falls in the displayed
  // month, otherwise today if visible, otherwise the 1st of the month.
  const focusableDate = React.useMemo(() => {
    if (mode === "single" && currentSingle && isSameMonth(currentSingle, displayedMonth)) return currentSingle;
    if (mode === "range" && currentRange?.from && isSameMonth(currentRange.from, displayedMonth)) return currentRange.from;
    if (isSameMonth(today, displayedMonth)) return today;
    return new Date(displayedMonth.getFullYear(), displayedMonth.getMonth(), 1);
  }, [mode, currentSingle, currentRange, displayedMonth, today]);

  function cellState(date: Date) {
    const outsideMonth = !isSameMonth(date, displayedMonth);
    const isToday = isSameDay(date, today);
    const isBookedDay = isBooked(date);
    const event = eventFor(date);
    const isDayDisabled = isDisabled(date);

    let isSelected = false;
    let isRangeStart = false;
    let isRangeEnd = false;
    let isInRange = false;

    if (mode === "single") {
      isSelected = isSameDay(currentSingle, date);
    } else if (mode === "multiple") {
      isSelected = currentMultiple.some((d) => isSameDay(d, date));
    } else if (mode === "range" && currentRange) {
      isRangeStart = isSameDay(currentRange.from, date);
      isRangeEnd = isSameDay(currentRange.to, date);
      isInRange = isWithinRange(date, currentRange);
      isSelected = isRangeStart || isRangeEnd;
    }

    return { outsideMonth, isToday, isBookedDay, event, isDayDisabled, isSelected, isRangeStart, isRangeEnd, isInRange };
  }

  const monthLabel = `${MONTH_NAMES[displayedMonth.getMonth()]} ${displayedMonth.getFullYear()}`;
  const weeks = React.useMemo(() => {
    const rows: Date[][] = [];
    for (let i = 0; i < grid.length; i += 7) {
      rows.push(grid.slice(i, i + 7));
    }
    return rows;
  }, [grid]);

  return (
    <div data-wensity-primitive=""
      ref={ref}
      data-slot="calendar"
      data-mode={mode}
      className={cn(
        "w-full max-w-[300px] select-none rounded-[var(--primitive-radius-surface,1rem)] border border-[var(--border)] p-3",
        "bg-[var(--background)]",
        className,
      )}
      onKeyDown={(e) => {
        // Escape leaves the month or year grid first; the next one is the popup's.
        if (e.key !== "Escape" || navView === "days") return;
        e.preventDefault();
        e.stopPropagation();
        openView("days");
      }}
    >
      {/* Screen-reader announcement when the displayed month changes. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {monthLabel}
      </div>

      {/* Header: arrows step by the open view (a month, a year, twelve years); the month and the year
          are buttons that open their grids, so a far date is two taps away instead of many arrows. */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={arrowLabels[0]}
          onClick={() => step(-1)}
          className={cn(
            "flex size-[34px] shrink-0 items-center justify-center rounded-full text-[var(--foreground)]",
            "outline-none transition-colors duration-150",
            SOFT, HOVER, RING,
          )}
        >
          <IconChevronLeft className="size-4" stroke={2} />
        </button>

        <div className="flex min-w-0 items-center gap-1.5">
          {([
            ["months", MONTH_NAMES[displayedMonth.getMonth()], "Выбрать месяц"],
            ["years", String(displayedMonth.getFullYear()), "Выбрать год"],
          ] as const).map(([view, label, action]) => {
            const open = navView === view;
            return (
              <button
                key={view}
                type="button"
                disabled={!quickNav}
                data-calendar-pick={view}
                aria-label={quickNav ? `${action}: сейчас ${label}` : undefined}
                aria-expanded={quickNav ? open : undefined}
                onClick={() => (open ? setNavView("days") : view === "years" ? openYearsView() : openView("months"))}
                className={cn(
                  "inline-flex h-[34px] items-center gap-1.5 rounded-full px-3.5 text-[15px] font-[650] tracking-[-0.01em] text-[var(--foreground)]",
                  "outline-none transition-colors duration-150",
                  RING,
                  quickNav && !open && cn(SOFT, HOVER),
                  open && BAND,
                )}
              >
                {label}
                {quickNav && (
                  <IconChevronDown
                    aria-hidden="true"
                    className={cn("size-3.5 transition-transform duration-150", open && "rotate-180")}
                    stroke={2.4}
                  />
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-label={arrowLabels[1]}
          onClick={() => step(1)}
          className={cn(
            "flex size-[34px] shrink-0 items-center justify-center rounded-full text-[var(--foreground)]",
            "outline-none transition-colors duration-150",
            SOFT, HOVER, RING,
          )}
        >
          <IconChevronRight className="size-4" stroke={2} />
        </button>
      </div>

      <div ref={viewsRef} className="relative overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          {navView === "days" && (
            <motion.div
              key={`${displayedMonth.getFullYear()}-${displayedMonth.getMonth()}`}
              custom={direction}
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: direction * 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: direction * -12 }}
              transition={{ duration: prefersReducedMotion ? 0.12 : 0.18, ease: EASE_OUT }}
            >
              {/* Weekday row */}
              <div className="mb-1.5 grid grid-cols-7">
                {weekdayLabels.map((label, i) => (
                  <div
                    key={`${label}-${i}`}
                    className="flex h-7 items-center justify-center text-[11px] font-semibold tracking-[0.02em] text-[var(--muted-foreground)]"
                  >
                    {label}
                  </div>
                ))}
              </div>

              {/* Day grid, ARIA grid with row/gridcell required children. */}
              <div
                ref={dayGridRef}
                role="grid"
                aria-label={monthLabel}
                className="grid grid-cols-7 gap-y-1"
                onKeyDown={(e) => {
                  const deltas: Record<string, number> = {
                    ArrowLeft: -1,
                    ArrowRight: 1,
                    ArrowUp: -7,
                    ArrowDown: 7,
                  };
                  let targetDate: Date | undefined;
                  if (e.key in deltas) {
                    const current = new Date((e.target as HTMLElement).dataset.date ?? "");
                    current.setDate(current.getDate() + deltas[e.key]!);
                    targetDate = current;
                  } else if (e.key === "Home" || e.key === "End") {
                    const current = new Date((e.target as HTMLElement).dataset.date ?? "");
                    const weekday = weekStartsOn === 1 ? (current.getDay() + 6) % 7 : current.getDay();
                    current.setDate(current.getDate() + (e.key === "Home" ? -weekday : 6 - weekday));
                    targetDate = current;
                  } else if (e.key === "PageUp" || e.key === "PageDown") {
                    e.preventDefault();
                    const current = new Date((e.target as HTMLElement).dataset.date ?? "");
                    targetDate = addMonths(current, e.key === "PageUp" ? -1 : 1);
                    // Clamp to the target month's last day (e.g. Jan 31 -> Feb 28).
                    const daysInTargetMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
                    targetDate.setDate(Math.min(current.getDate(), daysInTargetMonth));
                  }
                  if (!targetDate) return;
                  e.preventDefault();
                  if (!isSameMonth(targetDate, displayedMonth)) {
                    pendingFocusDateRef.current = targetDate;
                    setMonth(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1), isBefore(targetDate, displayedMonth) ? -1 : 1);
                    return;
                  }
                  const iso = targetDate.toDateString();
                  (dayGridRef.current?.querySelector(`[data-date-key="${iso}"]`) as HTMLElement | null)?.focus();
                }}
              >
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} role="row" className="contents">
                    {week.map((date, column) => {
                      const state = cellState(date);
                      return (
                        <div
                          key={date.toISOString()}
                          role="gridcell"
                          aria-selected={state.isSelected || undefined}
                          className="relative flex h-10 items-center justify-center"
                        >
                          {/* Range band: full width between the endpoints, half width on the endpoint
                              cells themselves so it meets the dark circle without a gap, and rounded where
                              a week's row starts or ends. */}
                          {mode === "range" &&
                            currentRange?.from &&
                            currentRange?.to &&
                            !isSameDay(currentRange.from, currentRange.to) &&
                            (state.isInRange || state.isRangeStart || state.isRangeEnd) && (
                              <div
                                className={cn(
                                  "absolute inset-y-0",
                                  BAND,
                                  state.isRangeStart ? "left-1/2 right-0" : state.isRangeEnd ? "left-0 right-1/2" : "inset-x-0",
                                  column === 0 && !state.isRangeStart && "rounded-l-full",
                                  column === 6 && !state.isRangeEnd && "rounded-r-full",
                                )}
                              />
                            )}
                          <button
                            type="button"
                            disabled={state.isDayDisabled}
                            aria-label={dayLabel(date)}
                            aria-current={state.isToday ? "date" : undefined}
                            data-date={date.toISOString()}
                            data-date-key={date.toDateString()}
                            tabIndex={isSameDay(date, focusableDate) ? 0 : -1}
                            onClick={() => handleSelectDay(date)}
                            className={cn(
                              "relative z-10 flex size-[38px] items-center justify-center rounded-full text-[14px] tabular-nums",
                              "outline-none transition-[background-color,box-shadow,color] duration-150",
                              RING,
                              state.outsideMonth ? "text-[var(--muted-foreground)]" : "text-[var(--foreground)]",
                              !state.isSelected && !state.isDayDisabled && HOVER,
                              state.isSelected && SOLID,
                              state.isToday && !state.isSelected && TODAY,
                              state.isDayDisabled &&
                                !state.isBookedDay &&
                                "pointer-events-none text-[var(--muted-foreground)] opacity-30",
                              state.isBookedDay &&
                                "pointer-events-none text-[var(--muted-foreground)]/50 line-through",
                            )}
                          >
                            {date.getDate()}
                            {state.event && !state.isSelected && (
                              <span className="absolute bottom-0.5 size-1 rounded-full bg-[color:var(--primitive-info,#0ea5e9)]" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {navView === "months" && (
            <motion.div
              key="months"
              data-calendar-view="months"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0.12 : 0.15, ease: EASE_OUT }}
              className="py-1"
            >
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={`Месяцы ${displayedMonth.getFullYear()} года`}>
                {MONTH_NAMES.map((name, i) => {
                  const shown = i === displayedMonth.getMonth();
                  const current = i === today.getMonth() && displayedMonth.getFullYear() === today.getFullYear();
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-current={shown ? "true" : undefined}
                      onClick={() => {
                        setMonth(new Date(displayedMonth.getFullYear(), i, 1), i >= displayedMonth.getMonth() ? 1 : -1);
                        openView("days");
                      }}
                      className={cn(
                        "flex h-11 items-center justify-center rounded-[var(--primitive-radius-control-sm,0.625rem)] text-[14px] text-[var(--foreground)]",
                        "outline-none transition-[background-color,box-shadow,color] duration-150",
                        RING,
                        shown ? SOLID : cn(SOFT, HOVER),
                        current && !shown && TODAY,
                      )}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {navView === "years" && (
            <motion.div
              key="years"
              data-calendar-view="years"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0.12 : 0.15, ease: EASE_OUT }}
              className="py-1"
            >
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={`Годы ${yearAnchor - 5}–${yearAnchor + 6}`}>
                {Array.from({ length: 12 }, (_, i) => yearAnchor - 5 + i).map((year) => {
                  const shown = year === displayedMonth.getFullYear();
                  return (
                    <button
                      key={year}
                      type="button"
                      aria-current={shown ? "true" : undefined}
                      onClick={() => {
                        setMonth(new Date(year, displayedMonth.getMonth(), 1), year >= displayedMonth.getFullYear() ? 1 : -1);
                        openView("months");
                      }}
                      className={cn(
                        "flex h-11 items-center justify-center rounded-[var(--primitive-radius-control-sm,0.625rem)] text-[14px] tabular-nums text-[var(--foreground)]",
                        "outline-none transition-[background-color,box-shadow,color] duration-150",
                        RING,
                        shown ? SOLID : cn(SOFT, HOVER),
                        year === today.getFullYear() && !shown && TODAY,
                      )}
                    >
                      {year}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});
Calendar.displayName = "Calendar";
