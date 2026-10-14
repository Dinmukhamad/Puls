/**
 * Seasons of the city (docs/CITY_SEASONS.md): both cities' districts are built until the shared schedule (or a head)
 * resets them; the past city stays in the history, for operators five days, for heads and administrators always.
 */
import { request } from "./client";
import { CITY_READ_TIMEOUT_MS } from "./city";
import type { CityEstates } from "./cityEstate";
import type { DepartmentId } from "./cityWorld";

export type SeasonPeriod = "week" | "2weeks" | "month" | "2months" | "3months";
export interface CurrentSeason {
  number: number; started_at: string; period: SeasonPeriod | null; period_name: string | null;
  /** When the schedule resets the city; null without a schedule. */
  ends_at: string | null;
  /** The reset is a few days away: the city tells everyone. */
  warning: boolean; revision: number;
}
export interface SeasonBuilder { name: string; buildings: number; small: number; cells: number }
export interface SeasonDistrict {
  id: string; city: DepartmentId; name: string; number: number; buildings: number; families: Record<string, number>;
  small: number; decor: Record<string, number>; cells: number; landmark_level: number; builders: number;
  /** Who took most cells, at most three. */
  top: SeasonBuilder[];
}
export interface SeasonTotals {
  buildings: number; small: number; builders: number;
  cities: Partial<Record<DepartmentId, { buildings: number; small: number; cells: number; builders: number }>>;
  districts: SeasonDistrict[];
  /** The viewer's own part of the season, if they built. */
  mine: { buildings: number; small: number; cells: number } | null;
}
export interface PastSeason {
  id: number; number: number; started_at: string; ended_at: string; days: number;
  period: SeasonPeriod | null; period_name: string | null;
  /** Reset by the schedule, or by `ended_by`. */
  scheduled: boolean; ended_by: string | null;
  /** Operators see it until then; null for heads and administrators, who always do. */
  visible_until: string | null;
  totals: SeasonTotals;
}
export interface CitySeasons {
  current: CurrentSeason; history: PastSeason[];
  /** How many times the city was reset in all. */
  resets: number; can_manage: boolean; visible_days: number; warn_days: number;
  periods: { id: SeasonPeriod; name: string }[];
}
/** A past city's districts as everyone saw them on its last day. */
export interface PastCity extends CityEstates { history: { season: number; number: number; started_at: string; ended_at: string } }

export const SEASONS_QUERY = ["city-seasons"] as const;
export const citySeasons = {
  overview: (signal?: AbortSignal) => request<CitySeasons>("/api/v1/learning/city/seasons", { signal, timeoutMs: CITY_READ_TIMEOUT_MS }),
  city: (season: number, city: DepartmentId, signal?: AbortSignal) => request<PastCity>(`/api/v1/learning/city/seasons/${season}/cities/${city}`, { signal, timeoutMs: CITY_READ_TIMEOUT_MS }),
  schedule: (json: { revision: number; period: SeasonPeriod | null; ends_at: string | null }) => request<CitySeasons>("/api/v1/admin/learning/city/seasons/schedule", { method: "PUT", json }),
  /** Ends season `number` now; a repeated press finds it ended and is refused. */
  reset: (number: number) => request<CitySeasons>("/api/v1/admin/learning/city/seasons/reset", { method: "POST", json: { number } }),
};
