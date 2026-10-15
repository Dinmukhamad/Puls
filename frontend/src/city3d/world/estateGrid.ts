/**
 * The shapes of the team districts' catalogue, shared with the server (app/services/city_estate.py) and light
 * enough for any page: no world generation, no three.js. The districts' land is small cells (world/land.ts):
 * what operators build stands on cells of its own size wherever it fits, a house or a ready house
 * (world/familyHouses.ts) on 3 × 3, a square or an office tower on 2 × 2, parks on the cells of the squares they
 * gathered from (4 × 4, 6 × 4); the small things, roads, footpaths, alleys, trees, lamps and the rest, take a cell each. What
 * a district built together stands on cells of its old public square, a module of MODULE_CELLS × MODULE_CELLS.
 */
import type { ReadyHouse } from "./familyHouses";
import type { OfficeBuilding } from "./officeBuildings";

export type PlotFamily = "square" | "house" | ReadyHouse | OfficeBuilding | "park" | "bigpark";
/** The small things operators lay a cell at a time, as the server's DECOR_FAMILIES. */
export type DecorFamily = "road" | "path" | "alley" | "tree" | "pine" | "birch" | "oak" | "lamp" | "bench" | "bush" | "flowers" | "hedge";
export const DECOR_FAMILIES: readonly DecorFamily[] = ["road", "path", "alley", "tree", "pine", "birch", "oak", "lamp", "bench", "bush", "flowers", "hedge"];
export const isDecorFamily = (family: string): family is DecorFamily => (DECOR_FAMILIES as readonly string[]).includes(family);
export type ProjectFamily = "square" | "gazebo" | "fountain" | "sports" | "park";

/**
 * Each district's own colour, by number: its border on the ground, the tint of its free land, its headquarters'
 * accents, its label on the map and its swatch in the lists (like the colour groups of a Monopoly board).
 */
export const DISTRICT_COLOURS = ["#6b55c8", "#2f9e8f", "#d1823a", "#c44f7c", "#3d7cc4"];
/** The colour of district `number` (1, 2, 3, …; a fourth and later districts reuse the first ones). */
export const districtColour = (number: number) => DISTRICT_COLOURS[(Math.max(1, Math.floor(number)) - 1) % DISTRICT_COLOURS.length];
/** A team district's number from its id: 2 for "support-team-2" and for "support-5-team-2". */
export const districtNumber = (id: string) => Number(id.split("-").at(-1)) || 0;
/** How many districts a city may be cut into; three is its first layout (app/services/city_land.py). */
export const LAYOUT_COUNTS = [2, 3, 4, 5] as const;
export const FIRST_LAYOUT = 3;
const LAYOUT_ID = /^(?:test-)?(support|sales)(?:-([2-5]))?-team-[1-9]$/;
/** How many districts the layout of a district id has: 3 for "support-team-2", 5 for "support-5-team-2". */
export const districtLayout = (id: string) => Number(LAYOUT_ID.exec(id)?.[2] ?? FIRST_LAYOUT);
/** District `number`'s id in `city` cut into `count` districts. */
export const layoutDistrictId = (city: string, count: number, number: number) =>
  count === FIRST_LAYOUT ? `${city}-team-${number}` : `${city}-${count}-team-${number}`;
/** Whether an id is a team district of `city` in any layout. */
export const isDistrictOf = (city: string, id: string) => LAYOUT_ID.exec(id)?.[1] === city && !id.startsWith("test-");

/** The public square's side in cells. */
export const MODULE_CELLS = 12;
/** Whether a district has land to build on: a district of a layout of 2–5 (app/data/city_land.json), not one past it. */
export const preparedLand = (id: string) => LAYOUT_ID.test(id) && districtNumber(id) >= 1 && districtNumber(id) <= districtLayout(id);

/** Columns × rows of cells (unturned) and levels of what operators build, as the server's PLOT_FAMILIES. */
export const PLOT_SIZE: Record<PlotFamily, [number, number]> = {
  square: [2, 2], house: [3, 3], carport: [3, 3], bungalow: [3, 3], attic: [3, 3], modern: [3, 3], bayhouse: [3, 3], terrace: [3, 3], park: [4, 4], bigpark: [6, 4],
  officea: [2, 2], officeb: [2, 2], officec: [2, 2], officed: [2, 2], officee: [2, 2], officef: [2, 2], officeg: [2, 2], officeh: [2, 2], officei: [2, 2],
};
export const PLOT_LEVELS: Record<PlotFamily, number> = {
  square: 1, house: 5, carport: 1, bungalow: 1, attic: 1, modern: 1, bayhouse: 1, terrace: 1, park: 2, bigpark: 3,
  officea: 1, officeb: 1, officec: 1, officed: 1, officee: 1, officef: 1, officeg: 1, officeh: 1, officei: 1,
};
/** How many of an operator's own squares gather into each park. */
export const PARK_SQUARES: Partial<Record<PlotFamily, number>> = { park: 4, bigpark: 6 };
/** Cells (unturned) and levels of the public square's buildings, as the server's PROJECT_FAMILIES. */
export const PROJECT_SIZE: Record<ProjectFamily, [number, number]> = { square: [1, 1], gazebo: [1, 1], fountain: [2, 2], sports: [2, 2], park: [3, 2] };
export const PROJECT_LEVELS: Record<ProjectFamily, number> = { square: 1, gazebo: 2, fountain: 2, sports: 3, park: 3 };

const turned = ([w, h]: [number, number], rotation: number): [number, number] => rotation % 2 ? [h, w] : [w, h];
/** Cells a building takes on the land, turned by quarter turns (a big park stands 6 × 4 or 4 × 6). */
export const plotFootprint = (family: PlotFamily, rotation: number): [number, number] => turned(PLOT_SIZE[family], rotation);
/** Cells of whatever is bought on a picked cell: a building's footprint, a small thing's one cell. */
export const itemFootprint = (family: PlotFamily | DecorFamily, rotation = 0): [number, number] =>
  isDecorFamily(family) ? [1, 1] : plotFootprint(family, rotation);

/**
 * Where something of w × h cells goes for a cell the operator picked (col, row) in a block of cols × rows: the first
 * cell of the free place nearest to having the picked cell in its middle, among all the places that cover the picked
 * cell; `problem(col, row)` says why a cell cannot be built on (null when it is free). When none is free, the place
 * round the picked cell (kept inside the block), its blocked cells for the map to show, and `fits` false.
 */
export function footprintAt(col: number, row: number, w: number, h: number, cols: number, rows: number, problem: (col: number, row: number) => string | null) {
  const centred = { col: col - Math.floor((w - 1) / 2), row: row - Math.floor((h - 1) / 2) };
  const blocked = (c0: number, r0: number) => {
    const out: [number, number][] = [];
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (problem(c0 + i, r0 + j)) out.push([c0 + i, r0 + j]);
    return out;
  };
  const places: { col: number; row: number; far: number }[] = [];
  for (let c0 = col - w + 1; c0 <= col; c0++) for (let r0 = row - h + 1; r0 <= row; r0++) {
    if (c0 < 0 || r0 < 0 || c0 + w > cols || r0 + h > rows) continue;
    places.push({ col: c0, row: r0, far: Math.abs(c0 - centred.col) + Math.abs(r0 - centred.row) });
  }
  // The nearest to the middle first, then by row and column, so the same pick always lands the same way.
  places.sort((a, b) => a.far - b.far || a.row - b.row || a.col - b.col);
  for (const place of places) if (!blocked(place.col, place.row).length) return { col: place.col, row: place.row, fits: true, blocked: [] as [number, number][] };
  const shown = { col: Math.max(0, Math.min(Math.max(0, cols - w), centred.col)), row: Math.max(0, Math.min(Math.max(0, rows - h), centred.row)) };
  return { ...shown, fits: false, blocked: blocked(shown.col, shown.row) };
}
/** Cells of the public square a shared building takes, turned by quarter turns. */
export const projectFootprint = (family: ProjectFamily, rotation: number) => turned(PROJECT_SIZE[family], rotation);
