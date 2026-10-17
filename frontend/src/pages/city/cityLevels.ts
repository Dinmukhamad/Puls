import type { CityDistrict, CityMission } from "../../api/city";

/** Every completed mission of a district upgrades its building; five stages in total. */
export const MAX_DISTRICT_LEVEL = 5;

export const DISTRICT_LEVEL_NAMES = ["Начало", "Развитие", "Открыт", "Расширение", "Легенда"];

/** Districts that are not open yet stay at their initial stage. */
export function districtLevel(completedMissions: number, soon = false) {
  if (soon) return 1;
  return Math.max(1, Math.min(MAX_DISTRICT_LEVEL, 1 + Math.floor(completedMissions)));
}

/** Deferred missions retain their building stage without becoming active assignments again. */
export function completedDistrictMissions(district: CityDistrict, missions: CityMission[]) {
  const active = missions.filter(m => m.district === district.id && m.state === "completed").length;
  return Math.max(active, district.completed_missions ?? 0);
}

/**
 * The stages to compare the city's with: the account's record (seen on any device) together with this browser's and
 * this visit's, the highest of each. Without the account's record (a first visit) only what this visit showed counts:
 * the city records the stages without celebrating.
 */
export function seenLevels(account: Record<string, number> | null, browser: Record<string, number> | null, visit: Record<string, number> | null) {
  if (!account) return visit;
  const out = { ...account };
  for (const source of [browser, visit]) for (const [id, level] of Object.entries(source ?? {})) out[id] = Math.max(out[id] ?? 0, level);
  return out;
}

/** Whether the account's record lacks any of these stages, so the city has to tell the server. */
export function newToAccount(account: Record<string, number> | null, current: Record<string, number>) {
  return !account || Object.keys(current).some(id => (account[id] ?? 0) < current[id]);
}

/** Districts whose level went up since the stages the viewer saw last time. */
export function grownDistricts(previous: Record<string, number> | null, current: Record<string, number>) {
  if (!previous) return [];
  return Object.keys(current).filter(id => (previous[id] ?? current[id]) < current[id]);
}
