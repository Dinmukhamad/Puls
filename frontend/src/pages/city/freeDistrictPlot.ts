import type { DistrictEstate } from "../../api/cityEstate";
import type { DepartmentId } from "../../api/cityWorld";
import { islandWorld } from "../../city3d/world/cities";
import { districtNumber } from "../../city3d/world/estateGrid";
import { landGrid, plotKey, type LandGrid, type LandPlot } from "../../city3d/world/land";
import { generateSalesWorld } from "../../city3d/world/sales";
import { WORLD_X4 } from "../../city3d/world/worldSpec";

// The same immutable geometry as the map; generate it once, only when building is available.
const grids = new Map<DepartmentId, LandGrid>();
export function districtPlotGrid(city: DepartmentId): LandGrid {
  let grid = grids.get(city);
  if (!grid) {
    grid = landGrid(city === "sales" ? generateSalesWorld() : islandWorld(WORLD_X4))!;
    grids.set(city, grid);
  }
  return grid;
}

/** Suggest a free personal plot, without reserving it or buying anything. The server rechecks at purchase. */
export function freeDistrictPlot(grid: LandGrid, district: DistrictEstate): LandPlot | null {
  const number = districtNumber(district.id);
  if (district.id !== `${grid.city}-team-${number}` || number !== district.number) return null;
  const occupied = new Set<string>();
  for (const object of district.objects) {
    // Module zero is the public square, not personal land. Include every resident's full footprint.
    if (object.module === null || object.module === 0 || object.u === null || object.v === null) continue;
    for (let col = object.u; col < object.u + object.w; col++) {
      for (let row = object.v; row < object.v + object.h; row++) occupied.add(plotKey(object.module, col, row));
    }
  }
  const centre = grid.centres.find(c => c.district === number)?.area;
  let best: LandPlot | null = null, distance = Infinity;
  for (const plot of grid.plots) {
    if (plot.district !== number || occupied.has(plotKey(plot.block, plot.col, plot.row))) continue;
    const next = centre ? Math.hypot(plot.x - centre.x, plot.z - centre.z) : 0;
    if (!best || next < distance) { best = plot; distance = next; }
  }
  return best;
}
