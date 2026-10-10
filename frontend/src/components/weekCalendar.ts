import type { WeekOut } from "../api/types";

const DAY_MS = 86_400_000;

/** Contest dates are calendar dates, not instants in the browser's timezone. */
export function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export const dateKey = (date: Date): string => date.toISOString().slice(0, 10);
export const shiftDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);
export const monthKey = (date: Date): string => dateKey(date).slice(0, 7);

export function shiftMonth(month: string, amount: number): string {
  const date = calendarDate(`${month}-01`);
  if (!date) return month;
  date.setUTCMonth(date.getUTCMonth() + amount);
  return monthKey(date);
}

export function monthCaption(month: string): string {
  const date = calendarDate(`${month}-01`);
  return date ? date.toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }) : month;
}

export function weekRange(week: Pick<WeekOut, "starts_on" | "ends_on">, full = false): string {
  const start = calendarDate(week.starts_on), end = calendarDate(week.ends_on);
  if (!start || !end) return "Даты недели недоступны";
  const options = { day: "2-digit", month: "2-digit", timeZone: "UTC" } as const;
  const first = start.toLocaleDateString("ru-RU", { ...options, ...(full || start.getUTCFullYear() !== end.getUTCFullYear() ? { year: "numeric" } as const : {}) });
  const last = end.toLocaleDateString("ru-RU", { ...options, year: "numeric" });
  return `${first}–${last}`;
}

export function availableWeeks(weeks: readonly WeekOut[]): WeekOut[] {
  return weeks.filter((week) => {
    const start = calendarDate(week.starts_on), end = calendarDate(week.ends_on);
    return Number.isInteger(week.id) && week.id > 0 && start && end &&
      start.getUTCDay() === 1 && end.getTime() - start.getTime() === 6 * DAY_MS;
  }).sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}

/** Move only to real API weeks: gaps never produce an invented week ID. */
export function adjacentWeek(weeks: readonly WeekOut[], currentId: number | undefined, direction: -1 | 1): WeekOut | undefined {
  const sorted = availableWeeks(weeks);
  const index = sorted.findIndex((week) => week.id === currentId);
  return index < 0 ? undefined : sorted[index + direction];
}

export interface CalendarWeek {
  start: string;
  days: { key: string; day: number; inMonth: boolean }[];
  week: WeekOut | undefined;
}

/** Complete Monday–Sunday rows, including weeks that cross month/year edges. */
export function calendarWeeks(month: string, weeks: readonly WeekOut[]): CalendarWeek[] {
  const first = calendarDate(`${month}-01`);
  if (!first) return [];
  const last = shiftDays(calendarDate(`${shiftMonth(month, 1)}-01`)!, -1);
  const rowStart = shiftDays(first, -((first.getUTCDay() + 6) % 7));
  const byStart = new Map(availableWeeks(weeks).map((week) => [week.starts_on, week]));
  const rows: CalendarWeek[] = [];
  for (let start = rowStart; start <= last; start = shiftDays(start, 7)) {
    rows.push({ start: dateKey(start), week: byStart.get(dateKey(start)), days: Array.from({ length: 7 }, (_, i) => {
      const day = shiftDays(start, i);
      return { key: dateKey(day), day: day.getUTCDate(), inMonth: monthKey(day) === month };
    }) });
  }
  return rows;
}

export function adjacentAvailableMonth(month: string, weeks: readonly WeekOut[], direction: -1 | 1): string | undefined {
  const months = new Set<string>();
  for (const week of availableWeeks(weeks)) { months.add(week.starts_on.slice(0, 7)); months.add(week.ends_on.slice(0, 7)); }
  const sorted = [...months].sort();
  return direction === -1 ? sorted.filter((item) => item < month).at(-1) : sorted.find((item) => item > month);
}
