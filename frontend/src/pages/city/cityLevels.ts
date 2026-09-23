/** Every completed mission of a district upgrades its building; five stages in total. */
export const MAX_DISTRICT_LEVEL = 5;

export const DISTRICT_LEVEL_NAMES = ["Стройка", "Каркас", "Открыт", "Расширение", "Легенда"];

/** Districts that are not open yet stay a construction site. */
export function districtLevel(completedMissions: number, soon = false) {
  if (soon) return 1;
  return Math.max(1, Math.min(MAX_DISTRICT_LEVEL, 1 + Math.floor(completedMissions)));
}

/** Districts whose level went up since the stages the viewer saw last time. */
export function grownDistricts(previous: Record<string, number> | null, current: Record<string, number>) {
  if (!previous) return [];
  return Object.keys(current).filter(id => (previous[id] ?? current[id]) < current[id]);
}
