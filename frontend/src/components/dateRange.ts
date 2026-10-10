import { calendarDate, dateKey, monthKey, shiftDays, shiftMonth } from "./weekCalendar";

export interface DateRange {
  date_from: string;
  date_to: string;
}

export type DateRangePreset = "today" | "three-days" | "ten-days" | "this-month" | "last-month";

export function validDateRange(range: DateRange | undefined): range is DateRange {
  return !!range && !!calendarDate(range.date_from) && !!calendarDate(range.date_to) &&
    range.date_from >= "0001-01-01" && range.date_to <= "9999-12-31" && range.date_from <= range.date_to;
}

export function inclusiveRangeDays(range: DateRange | undefined): number {
  if (!validDateRange(range)) return 0;
  return Math.round((calendarDate(range.date_to)!.getTime() - calendarDate(range.date_from)!.getTime()) / 86_400_000) + 1;
}

/** A period is made of calendar dates; formatting never shifts its endpoints. */
export function formatDateRange(range: DateRange | undefined): string {
  if (!validDateRange(range)) return "Выбрать период";
  const format = (value: string) => `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
  return range.date_from === range.date_to ? format(range.date_from) : `${format(range.date_from)} — ${format(range.date_to)}`;
}

/** Business dates follow Kazakhstan time, independently of the browser's zone. */
export function todayDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function presetDateRange(preset: DateRangePreset, today = todayDateKey()): DateRange {
  const date = calendarDate(today);
  if (!date || today < "0001-01-01") throw new RangeError("Некорректная дата для выбора периода");
  if (preset === "today") return { date_from: today, date_to: today };
  if (preset === "three-days" || preset === "ten-days") {
    return { date_from: dateKey(shiftDays(date, preset === "three-days" ? -2 : -9)), date_to: today };
  }
  const month = preset === "last-month" ? shiftMonth(monthKey(date), -1) : monthKey(date);
  const next = calendarDate(`${month}-01`)!;
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = shiftDays(next, -1);
  return { date_from: `${month}-01`, date_to: dateKey(end) };
}

/** Individual dates remain selectable even when no calculated week contains them. */
export function rangeCalendarDays(month: string) {
  const first = calendarDate(`${month}-01`);
  if (!first) return [];
  const next = new Date(first.getTime());
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = shiftDays(next, -1);
  const start = shiftDays(first, -((first.getUTCDay() + 6) % 7));
  const end = shiftDays(last, 6 - ((last.getUTCDay() + 6) % 7));
  const days = [];
  for (let date = start; date <= end; date = shiftDays(date, 1)) {
    const selectable = date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999;
    const key = selectable ? dateKey(date) : `outside-${date.getTime()}`;
    days.push({ key, day: date.getUTCDate(), inMonth: selectable && key.slice(0, 7) === month, selectable });
  }
  return days;
}

/** PageUp/PageDown keep the day number, clamped to the target month's length. */
export function moveCalendarMonth(value: string, amount: number): string {
  const date = calendarDate(value);
  if (!date) return value;
  const month = shiftMonth(value.slice(0, 7), amount);
  if (month < "0001-01" || month > "9999-12") return value;
  const next = calendarDate(`${month}-01`);
  if (!next) return value;
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = shiftDays(next, -1).getUTCDate();
  return `${month}-${String(Math.min(date.getUTCDate(), lastDay)).padStart(2, "0")}`;
}
