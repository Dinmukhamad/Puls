/**
 * The shapes of the team districts' catalogue, shared with the server (app/services/city_estate.py) and light
 * enough for any page: no world generation, no three.js. What operators build stands on plots (world/land.ts):
 * a square, a house or a ready house (world/familyHouses.ts) on one plot, parks on the plots of the squares they
 * gathered from. What a district builds together stands on cells of its public square, a module of
 * MODULE_CELLS × MODULE_CELLS.
 */
import type { ReadyHouse } from "./familyHouses";

export type PlotFamily = "square" | "house" | ReadyHouse | "park" | "bigpark";
export type ProjectFamily = "square" | "gazebo" | "fountain" | "sports" | "park";

/** The public square's side in cells. */
export const MODULE_CELLS = 12;
/** Each city is cut into three districts; others have no land (app/data/city_land.json). */
export const LAND_DISTRICTS = 3;
/** Whether district number n has land to build on. */
export const preparedLand = (number: number) => number >= 1 && number <= LAND_DISTRICTS;

/** Columns × rows of plots (unturned) and levels of what operators build, as the server's PLOT_FAMILIES. */
export const PLOT_SIZE: Record<PlotFamily, [number, number]> = {
  square: [1, 1], house: [1, 1], carport: [1, 1], bungalow: [1, 1], attic: [1, 1], modern: [1, 1], bayhouse: [1, 1], terrace: [1, 1], park: [2, 2], bigpark: [3, 2],
};
export const PLOT_LEVELS: Record<PlotFamily, number> = {
  square: 1, house: 5, carport: 1, bungalow: 1, attic: 1, modern: 1, bayhouse: 1, terrace: 1, park: 2, bigpark: 3,
};
/** How many of an operator's own squares gather into each park. */
export const PARK_SQUARES: Partial<Record<PlotFamily, number>> = { park: 4, bigpark: 6 };
/** Cells (unturned) and levels of the public square's buildings, as the server's PROJECT_FAMILIES. */
export const PROJECT_SIZE: Record<ProjectFamily, [number, number]> = { square: [1, 1], gazebo: [1, 1], fountain: [2, 2], sports: [2, 2], park: [3, 2] };
export const PROJECT_LEVELS: Record<ProjectFamily, number> = { square: 1, gazebo: 2, fountain: 2, sports: 3, park: 3 };

const turned = ([w, h]: [number, number], rotation: number): [number, number] => rotation % 2 ? [h, w] : [w, h];
/** Plots a building takes, turned by quarter turns (a big park stands 3 × 2 or 2 × 3). */
export const plotFootprint = (family: PlotFamily, rotation: number) => turned(PLOT_SIZE[family], rotation);
/** Cells of the public square a shared building takes, turned by quarter turns. */
export const projectFootprint = (family: ProjectFamily, rotation: number) => turned(PROJECT_SIZE[family], rotation);
