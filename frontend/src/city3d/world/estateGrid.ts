/**
 * The logical grid of team districts and the building catalogue's shapes, shared with the server
 * (app/services/city_estate.py) and light enough for any page: no world generation, no three.js.
 */
export type ModuleKind = "public" | "business" | "residential";
export type EstateFamily = "square" | "gazebo" | "fountain" | "sports" | "park" | "house" | "tower";

/** The cells of a module side and of an estate (or tower lot) side; in an estate the house keeps the two back rows. */
export const MODULE_CELLS = 12, LOT_CELLS = 4, HOUSE_ROWS = 2;
/** Prepared modules of district number n (index n − 1); the server sells only there (city_estate.py PREPARED). */
export const PREPARED = [10, 10, 10, 6, 6, 6, 0, 0, 0, 0, 0, 0] as const;
/** Slot 0 is the district's public square, slot 1 its business quarter, the rest are residential modules. */
export function moduleKind(slot: number): ModuleKind { return slot === 0 ? "public" : slot === 1 ? "business" : "residential"; }
/** Whether district number n has land to build on. */
export const preparedLand = (number: number) => (PREPARED[number - 1] ?? 0) > 0;

/** Footprints in cells (unturned) and levels, the same as the server catalogue (city_estate.py FAMILIES). */
export const FAMILY_SIZE: Record<EstateFamily, [number, number]> = { square: [1, 1], gazebo: [1, 1], fountain: [2, 2], sports: [2, 2], park: [3, 2], house: [4, 2], tower: [4, 4] };
export const FAMILY_LEVELS: Record<EstateFamily, number> = { square: 1, gazebo: 2, fountain: 2, sports: 3, park: 3, house: 5, tower: 4 };
/** The footprint in cells of a building turned by `rotation` quarter turns. */
export function footprint(family: EstateFamily, rotation: number): [number, number] {
  const [w, h] = FAMILY_SIZE[family];
  return rotation % 2 ? [h, w] : [w, h];
}
