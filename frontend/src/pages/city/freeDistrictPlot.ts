import type { DistrictEstate } from "../../api/cityEstate";
import type { DepartmentId } from "../../api/cityWorld";
import { islandWorld } from "../../city3d/world/cities";
import { FIRST_LAYOUT, districtLayout, districtNumber, layoutDistrictId } from "../../city3d/world/estateGrid";
import { CELLS, areaPoint, areaCorners, cellKey, landGrid, type LandGrid } from "../../city3d/world/land";
import { generateSalesWorld } from "../../city3d/world/sales";
import { WORLD_X4 } from "../../city3d/world/worldSpec";

// The same immutable geometry as the map; generate it once per city and layout (2–5 districts), only when building
// is available.
const grids = new Map<string, LandGrid>();
export function districtPlotGrid(city: DepartmentId, count = FIRST_LAYOUT): LandGrid {
  const key = `${city}:${count}`;
  let grid = grids.get(key);
  if (!grid) {
    grid = landGrid(city === "sales" ? generateSalesWorld() : islandWorld(WORLD_X4), count)!;
    grids.set(key, grid);
  }
  return grid;
}

/** Free cells for a house, 3 × 3 of them: the first cell and its band. */
export interface FreePlot { block: number; col: number; row: number; band: number }

/**
 * Suggest free cells for a house, 3 × 3 of them, nearest the district's centre, without reserving them or buying
 * anything. Buildings, roads, trees and every other small thing take cells. The server rechecks at purchase.
 */
export function freeDistrictPlot(grid: LandGrid, district: DistrictEstate): FreePlot | null {
  const number = districtNumber(district.id);
  const count = districtLayout(district.id);
  if (district.id !== layoutDistrictId(grid.city, count, number) || number !== district.number || grid.centres.length !== count) return null;
  const occupied = new Set<string>();
  for (const object of district.objects) {
    // Module zero is the public square, not the district's land. Include every resident's full footprint.
    if (object.module === null || object.module === 0 || object.u === null || object.v === null) continue;
    for (let col = object.u; col < object.u + object.w; col++) {
      for (let row = object.v; row < object.v + object.h; row++) occupied.add(cellKey(object.module, col, row));
    }
  }
  for (const cells of Object.values(district.decor ?? {})) for (const [block, col, row] of cells ?? []) occupied.add(cellKey(block, col, row));
  const centre = grid.centres.find(c => c.district === number)?.area;
  let best: FreePlot | null = null, distance = Infinity;
  for (const block of grid.blocks) {
    if (block.district !== number) continue;
    const free = (c: number, r: number) => !block.skip.has(`${c}:${r}`) && !occupied.has(cellKey(block.block, c, r));
    for (let col = 0; col + CELLS <= block.cols; col++) for (let row = 0; row + CELLS <= block.rows; row++) {
      let fits = true;
      for (let i = 0; i < CELLS && fits; i++) for (let j = 0; j < CELLS && fits; j++) fits = free(col + i, row + j);
      if (!fits) continue;
      const middle = areaPoint(areaCorners(block, col, row, CELLS, CELLS), .5, .5);
      const next = centre ? Math.hypot(middle.x - centre.x, middle.z - centre.z) : 0;
      if (!best || next < distance) { best = { block: block.block, col, row, band: block.band }; distance = next; }
    }
  }
  return best;
}
