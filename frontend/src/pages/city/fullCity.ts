import type { CityEstates, DistrictEstate, PublicObject } from "../../api/cityEstate";
import type { DecorCell } from "../../city3d/world/decor";
import { LANDMARK_LEVELS } from "../../city3d/world/districtLandmark";
import { PLOT_SIZE, districtLayout, districtNumber, preparedLand, type DecorFamily, type PlotFamily } from "../../city3d/world/estateGrid";
import type { LandBlock, LandGrid } from "../../city3d/world/land";
import { districtPlotGrid } from "./freeDistrictPlot";

/**
 * «Весь город»: the city as it could look with every cell of every district built on, only to look at. The real
 * districts keep their names, numbers and colours; what stands on their land is made up here, the same each time:
 * in every block bands of three rows of buildings — houses at every level, ready houses, office towers, squares —
 * with a row of road after each, now and then a band of parks, trees, flowers, benches and lamps on the cells left
 * over. Every main building at its last level. Nothing is sent to the server; the real land stays as it is.
 */
const READY: PlotFamily[] = ["bungalow", "attic", "modern", "bayhouse", "terrace", "carport"];
const OFFICES: PlotFamily[] = ["officea", "officeb", "officec", "officed", "officee", "officef", "officeg", "officeh", "officei", "officej", "officek"];
const GREEN: DecorFamily[] = ["tree", "pine", "birch", "oak", "tree", "bush", "flowers", "pine", "oak", "birch"];
/** Rows of buildings between two streets, and every how many bands one of parks comes. */
const BAND_ROWS = 3, PARKS_EVERY = 4;

export interface FullDistrict { objects: PublicObject[]; decor: Partial<Record<DecorFamily, DecorCell[]>>; cells: number; next: number }

/** District `number`'s blocks built up, its objects numbered from `first`. */
export function fullDistrict(blocks: readonly LandBlock[], number: number, first: number): FullDistrict {
  const objects: PublicObject[] = [], decor: Partial<Record<DecorFamily, DecorCell[]>> = {};
  let id = first, k = number * 7, green = number, cells = 0;
  const lay = (family: DecorFamily, block: number, c: number, r: number) => (decor[family] ??= []).push([block, c, r, 0]);
  for (const block of [...blocks].sort((a, b) => a.block - b.block)) {
    const taken = new Set<string>(), key = (c: number, r: number) => `${c}:${r}`;
    for (let c = 0; c < block.cols; c++) for (let r = 0; r < block.rows; r++) if (!block.skip.has(key(c, r))) cells++;
    const free = (c0: number, r0: number, w: number, h: number) => {
      if (c0 < 0 || r0 < 0 || c0 + w > block.cols || r0 + h > block.rows) return false;
      for (let c = c0; c < c0 + w; c++) for (let r = r0; r < r0 + h; r++) if (block.skip.has(key(c, r)) || taken.has(key(c, r))) return false;
      return true;
    };
    const take = (c0: number, r0: number, w: number, h: number) => { for (let c = c0; c < c0 + w; c++) for (let r = r0; r < r0 + h; r++) taken.add(key(c, r)); };
    const put = (family: PlotFamily, level: number, c: number, r: number, rotation: number) => {
      const [w, h] = PLOT_SIZE[family], [fw, fh] = rotation % 2 ? [h, w] : [w, h];
      if (!free(c, r, fw, fh)) return 0;
      take(c, r, fw, fh);
      objects.push({ id: id++, family, level, owner: "resident", module: block.block, u: c, v: r, w: fw, h: fh, rotation });
      return fw;
    };
    // Small things on the free cells of the row the 2 × 2 buildings leave beside them in a band of three.
    const beside = (c: number, r: number, family: (col: number) => DecorFamily) => {
      for (let i = c; i < c + 2; i++) if (free(i, r, 1, 1)) { take(i, r, 1, 1); lay(family(i), block.block, i, r); }
    };
    for (let r = 0, band = 0; r < block.rows; band++) {
      const parks = band % PARKS_EVERY === PARKS_EVERY - 1 && r + 4 <= block.rows, height = parks ? 4 : BAND_ROWS;
      // Every other band faces the other way, so two bands look at the street between them.
      const rotation = band % 2 ? 2 : 0, low = rotation ? 1 : 0, edge = rotation ? r : r + 2;
      for (let c = 0; c < block.cols;) {
        let width = 0;
        if (parks) width = put(k % 3 ? "park" : "bigpark", k % 3 ? 2 : 3, c, r, 0) || put("park", 2, c, r, 0);
        else {
          // A street's mix: mostly houses at every level, ready houses, a pair of office towers, now and then a square.
          const pick = k % 12;
          if (pick === 4 || pick === 9) {
            width = put(OFFICES[(k >> 1) % OFFICES.length], 1, c, r + low, rotation);
            if (width) beside(c, edge, i => i % 2 ? "lamp" : GREEN[green++ % GREEN.length]);
          } else if (pick === 7) {
            width = put("square", 1, c, r + low, rotation);
            if (width) beside(c, edge, () => "bench");
          } else if (pick === 2 || pick === 6 || pick === 11) width = put(READY[(k >> 2) % READY.length], 1, c, r, rotation);
          else width = put("house", 1 + (k * 3 + number) % 5, c, r, rotation);
          if (!width) width = put(OFFICES[k % OFFICES.length], 1, c, r + low, rotation);
        }
        k++;
        c += width || 1;
      }
      r += height;
      // The street after the band: a row of road wherever the cells are free.
      if (r < block.rows) { for (let c = 0; c < block.cols; c++) if (free(c, r, 1, 1)) { take(c, r, 1, 1); lay("road", block.block, c, r); } r++; }
    }
    // Whatever is left: greenery.
    for (let c = 0; c < block.cols; c++) for (let r = 0; r < block.rows; r++) if (free(c, r, 1, 1)) { take(c, r, 1, 1); lay(GREEN[green++ % GREEN.length], block.block, c, r); }
  }
  return { objects, decor, cells, next: id };
}

/**
 * The city of `estates` with all its land built up (fullDistrict): each district with land in the layout its ids
 * name keeps its id, name, number and whose it is; a district without land stays as it is.
 */
export function fullCity(estates: CityEstates, grid: LandGrid = districtPlotGrid(estates.city, districtLayout(estates.districts.find(d => preparedLand(d.id))?.id ?? ""))): CityEstates {
  let id = 1;
  const districts = estates.districts.map((district): DistrictEstate => {
    const number = districtNumber(district.id);
    if (!district.land || !preparedLand(district.id) || districtLayout(district.id) !== grid.centres.length || number !== district.number) return district;
    const built = fullDistrict(grid.blocks.filter(b => b.district === number), number, id);
    id = built.next;
    return {
      ...district, construction: false,
      land: { cells: built.cells, taken: built.cells, built: built.cells, open_band: grid.bands, bands: [] },
      landmark: { status: "active", level: LANDMARK_LEVELS, name: district.landmark?.name ?? "Главное здание", module: 0, u: 0, v: 0, w: 12, h: 12, rotation: 0, taken: built.cells, plots: built.cells, peak: built.cells, next: null },
      objects: built.objects, projects: [], decor: built.decor,
    };
  });
  return { city: estates.city, districts };
}
