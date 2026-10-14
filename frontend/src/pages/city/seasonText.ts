/** Words for the city's seasons: dates of a season, the time left before a reset, the totals in a line. */
import type { CurrentSeason, SeasonPeriod, SeasonTotals } from "../../api/citySeasons";
import { plural } from "../../utils/format";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const day = (at: Date, year: boolean) => at.toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(year ? { year: "numeric" } : {}) }).replace(" г.", "");

/** «1 октября 2026». */
export const dateText = (at: string) => day(new Date(at), true);

/** «1 сентября — 30 сентября 2026»: the year once, unless the season crossed into the next. */
export function seasonDates(started: string, ended: string) {
  const from = new Date(started), to = new Date(ended);
  return `${day(from, from.getFullYear() !== to.getFullYear())} — ${day(to, true)}`;
}

/** How often the schedule resets the city, in words. */
export const PERIOD_EVERY: Record<SeasonPeriod, string> = { week: "раз в неделю", "2weeks": "раз в 2 недели", month: "раз в месяц", "2months": "раз в 2 месяца", "3months": "раз в 3 месяца" };

export const daysText = (days: number) => `${days} ${plural(days, "день", "дня", "дней")}`;
export const resetsText = (count: number) => `${count} ${plural(count, "раз", "раза", "раз")}`;

/** «2 дня 5 ч», «3 ч», «меньше часа»: what is left until `at`. */
export function timeLeft(at: string, now = Date.now()) {
  const left = Math.max(0, new Date(at).getTime() - now);
  const days = Math.floor(left / DAY), hours = Math.floor((left % DAY) / HOUR);
  if (days) return `${daysText(days)}${hours ? ` ${hours} ч` : ""}`;
  return hours ? `${hours} ч` : "меньше часа";
}

/** «2 дня», «5 ч», «< 1 ч»: the time left, short enough for the toolbar. */
export function shortLeft(at: string, now = Date.now()) {
  const left = Math.max(0, new Date(at).getTime() - now), days = Math.floor(left / DAY), hours = Math.floor(left / HOUR);
  return days ? daysText(days) : hours ? `${hours} ч` : "< 1 ч";
}

/** The reset in words: a date and time on the viewer's clock. */
export function resetMoment(at: string) {
  const moment = new Date(at);
  return `${day(moment, moment.getFullYear() !== new Date().getFullYear())} в ${moment.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

/** What the city says a few days before the schedule resets it. */
export function seasonWarning(current: CurrentSeason, now = Date.now()) {
  if (!current.ends_at) return "";
  return `Через ${timeLeft(current.ends_at, now)} город начнёт новый сезон: постройки районов уйдут в историю. Обучение, опыт и коины останутся.`;
}

/** «34 здания · 210 клеток благоустройства · строили 12 человек». */
export function totalsLine(totals: Pick<SeasonTotals, "buildings" | "small" | "builders">) {
  const parts = [`${totals.buildings} ${plural(totals.buildings, "здание", "здания", "зданий")}`, `${totals.small} ${plural(totals.small, "клетка", "клетки", "клеток")} благоустройства`];
  if (totals.builders) parts.push(`${plural(totals.builders, "строил", "строили", "строили")} ${totals.builders} ${plural(totals.builders, "человек", "человека", "человек")}`);
  return parts.join(" · ");
}

/** A date for an `<input type="datetime-local">` on the viewer's clock. */
export function localInput(at: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** The first reset a new schedule proposes: one period from now, at nine in the morning. */
export function firstReset(period: SeasonPeriod, now = new Date()) {
  const at = new Date(now);
  if (period === "week" || period === "2weeks") at.setDate(at.getDate() + (period === "week" ? 7 : 14));
  else {
    const months = period === "month" ? 1 : period === "2months" ? 2 : 3, dayOfMonth = at.getDate();
    at.setDate(1); at.setMonth(at.getMonth() + months);
    at.setDate(Math.min(dayOfMonth, new Date(at.getFullYear(), at.getMonth() + 1, 0).getDate()));
  }
  at.setHours(9, 0, 0, 0);
  return at;
}
