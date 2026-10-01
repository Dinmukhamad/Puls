/**
 * The districts' ready houses (docs/CITY_ESTATES.md, «Готовые дома»): six models of the CC0 Blend Swap "Family
 * House Collection", each in brick and in stone (scripts/prepare_family_houses.py → pages/city/models/
 * family-houses.glb, one scene per house and finish: family-house-<model>-<finish>). Operators buy them finished,
 * on one plot, at the price of their size (the server's PLOT_FAMILIES and PLOT_PRICES).
 *
 * Sizes are in the models' own units (about 4 m), the front, with the entrance and the garage, towards +z; the city
 * draws them HOUSE_SCALE times bigger, so they stand as large as the district's growing houses. `door` and `garage`
 * say where the entrance and the garage (or the carport) are: across the front from the middle, and how far back
 * from the front wall, so the path and the driveway lead to them (world/landLayouts.ts). Pure data.
 */
export type ReadyHouse = "carport" | "bungalow" | "attic" | "modern" | "bayhouse" | "terrace";
export interface ReadyHouseModel {
  /** The source's house number (scene family-house-<model>-<finish>). */
  model: number;
  width: number; depth: number; height: number;
  door: [number, number];
  garage: [number, number] | null;
}

export const HOUSE_SCALE = 1.35;
/** Placement variant = (model - 1) * 2 + finish. */
export const FINISHES = ["brick", "stone"] as const;
/** Cheapest first, as the catalogue lists them. */
export const READY_HOUSES: Record<ReadyHouse, ReadyHouseModel> = {
  carport: { model: 3, width: 2.961, depth: 2.149, height: 1.719, door: [-0.274, 0.037], garage: [0.903, 0.574] },
  bungalow: { model: 1, width: 4.106, depth: 2.73, height: 1.868, door: [-0.035, 0.575], garage: [1.231, 0.128] },
  attic: { model: 4, width: 2.348, depth: 2.553, height: 1.783, door: [0.079, 0.448], garage: [0.688, 0] },
  modern: { model: 6, width: 2.017, depth: 2.235, height: 1.58, door: [0.279, 0.38], garage: [-0.356, 0.368] },
  bayhouse: { model: 2, width: 2.947, depth: 2.828, height: 2.128, door: [0.274, 0.442], garage: [-0.806, 0.305] },
  terrace: { model: 5, width: 2.135, depth: 2.416, height: 1.676, door: [-0.006, 0.45], garage: null },
};

export const isReadyHouse = (family: string): family is ReadyHouse => Object.prototype.hasOwnProperty.call(READY_HOUSES, family);
/** The scene of the house a placement variant stands for. */
export const houseModelName = (variant: number) => {
  const v = Math.max(0, Math.floor(variant)) % (6 * FINISHES.length);
  return `family-house-${Math.floor(v / FINISHES.length) + 1}-${FINISHES[v % FINISHES.length]}`;
};
