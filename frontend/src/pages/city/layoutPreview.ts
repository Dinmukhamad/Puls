import type { DepartmentId } from "../../api/cityWorld";
import { landCells } from "../../city3d/world/land";
import { districtPlotGrid } from "./freeDistrictPlot";

/** A city's land cut into `count` districts, flat for a preview: its cells and the districts' centres. */
export interface LayoutPreview {
  cells: { x: number; z: number; district: number }[];
  /** A cell's side. */
  cell: number;
  centres: { x: number; z: number; district: number }[];
  box: { x: number; z: number; w: number; h: number };
}

export function layoutPreview(city: DepartmentId, count: number): LayoutPreview {
  const grid = districtPlotGrid(city, count);
  const all = landCells(grid), cells = all.map(c => ({ x: c.x, z: c.z, district: c.district }));
  const cell = all.length ? Math.max(all[0].width, all[0].depth) : 1;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const c of cells) { x0 = Math.min(x0, c.x); z0 = Math.min(z0, c.z); x1 = Math.max(x1, c.x); z1 = Math.max(z1, c.z); }
  return {
    cells, cell,
    centres: grid.centres.map(c => ({ x: c.area.x, z: c.area.z, district: c.district })),
    box: { x: x0 - cell, z: z0 - cell, w: x1 - x0 + 2 * cell, h: z1 - z0 + 2 * cell },
  };
}
