/** The team's growing community building. The whole reserved footprint stays fixed while its architecture grows. */
import { CELL, MODULE_CELLS, cellPoint, type ModuleSlot } from "./estates";
import type { Placement, Surface } from "./types";
import type { DistrictCentre } from "./land";

/** Models are drawn in this local frame, scaled to the actual reserved footprint by the catalogue. */
export const LANDMARK_SIDE = 18;
export const LANDMARK_LEVELS = 5;
export const LANDMARK_GROUND = .2;

export type LandmarkFinish = "stone" | "glass" | "dark" | "green" | "accent";
/** A solid box with its bottom at y, in the building's local frame. Both the renderer and picking use these boxes. */
export interface LandmarkBox { x: number; y: number; z: number; width: number; height: number; depth: number; finish: LandmarkFinish }
export interface LandmarkFrame { x: number; z: number; rotation: number; width: number; depth: number }
export interface LandmarkItem { level: number; u?: number; v?: number; w?: number; h?: number; rotation?: number }
export interface LandmarkBounds extends LandmarkFrame { bottom: number; height: number }
type Point3 = { x: number; y: number; z: number };

export const landmarkLevel = (level: number) => Math.min(LANDMARK_LEVELS, Math.max(1, Math.floor(Number.isFinite(level) ? level : 1)));

/** One main building in the reserved centre. Paid old projects keep their original square beside it. */
export function districtMainFrame(centre: DistrictCentre, landmark: { status: "active" | "legacy_occupied" } | null | undefined): LandmarkFrame | null {
  if (!landmark) return null;
  const legacy = landmark.status === "legacy_occupied", at = legacy ? centre.hq : centre.area, side = legacy ? 16 : LANDMARK_SIDE;
  return { x: at.x, z: at.z, rotation: at.rotation, width: side, depth: side };
}

export function districtMainLayout(frame: LandmarkFrame, level: number): { placements: Placement[]; surfaces: Surface[] } {
  return { placements: [{ kind: "district-landmark", variant: landmarkLevel(level) - 1, ...frame, scale: 1 }], surfaces: [] };
}

/** A family of civic buildings: pavilion, extended office, community hall, stepped centre and flagship tower. */
export function landmarkBoxes(level: number, detail: 0 | 1 | 2 = 2): LandmarkBox[] {
  const stage = landmarkLevel(level), boxes: LandmarkBox[] = [];
  const put = (finish: LandmarkFinish, width: number, height: number, depth: number, x: number, y: number, z: number) => boxes.push({ finish, width, height, depth, x, y, z });
  const floors = (width: number, height: number, depth: number, x: number, y: number, z: number, planted = true) => {
    put("stone", width, height, depth, x, y, z);
    // Glass panels sit above the solid base and between the stone corners. Their facade material lights at night.
    for (const side of [-1, 1]) {
      put("glass", width - .58, height - .65, .08, x, y + .35, z + side * (depth / 2 + .025));
      put("glass", .08, height - .65, depth - .58, x + side * (width / 2 + .025), y + .35, z);
    }
    put("dark", width + .34, .18, depth + .34, x, y + height, z);
    if (planted) put("green", width - .55, .07, depth - .55, x, y + height + .185, z);
    if (detail > 0) {
      for (let floor = 1; floor * 1.15 < height; floor++) put("stone", width + .14, .1, depth + .14, x, y + floor * 1.15, z);
      for (const side of [-1, 1]) for (const corner of [-1, 1]) put("stone", .18, height, .18, x + side * (width / 2 - .03), y, z + corner * (depth / 2 - .03));
    }
    if (detail === 2) {
      for (const side of [-1, 1]) for (let column = 1; column < Math.ceil(width / 1.4); column++) {
        const dx = -width / 2 + column * width / Math.ceil(width / 1.4);
        put("stone", .085, height - .42, .13, x + dx, y + .22, z + side * (depth / 2 + .02));
      }
    }
  };
  const pad = [[7.2, 6.6], [10.4, 9], [13.4, 11.4], [15.2, 13.4], [16.6, 15.8]][stage - 1];
  put("stone", pad[0], .16, pad[1], 0, .025, 0);
  if (stage === 1) floors(5.2, 2.45, 4.4, 0, .185, -.25);
  if (stage === 2) {
    floors(6.8, 4.05, 5.2, 1.1, .185, -.55);
    floors(3.45, 2.65, 4.3, -3.2, .185, -.45);
  }
  if (stage === 3) {
    floors(8.4, 6.2, 6.2, 1, .185, -.7);
    floors(3.65, 3.6, 5.4, -4.9, .185, -.4);
    floors(3.25, 2.65, 3.8, 4.65, .185, 2.1);
  }
  if (stage === 4) {
    floors(13.8, 3.05, 9.8, 0, .185, .1);
    floors(7.6, 6.3, 6.4, .8, 3.235, -.75);
    // A set-back top and roof terrace change the silhouette instead of stretching the previous facade.
    floors(5.65, 2.1, 4.65, .8, 9.535, -1.15, false);
    if (detail > 0) for (const side of [-1, 1]) put("green", 2.5, .23, .7, side * 4.8, 3.425, 3.45);
  }
  if (stage === 5) {
    floors(15.4, 3.5, 11.8, 0, .185, .15);
    floors(9, 8.75, 7.8, 0, 3.685, -.85);
    floors(7.4, 4.25, 6.2, 0, 12.435, -1.05, false);
    put("dark", 7.95, .3, 6.75, 0, 16.865, -1.05);
    put("accent", 7.4, .19, 6.2, 0, 17.165, -1.05);
    if (detail > 0) for (const side of [-1, 1]) put("green", 3.8, .23, .8, side * 5.3, 3.875, 3.75);
  }
  const entrance = [[0, 2.1, 3.05], [1.1, 2.7, 4.05], [1, 3.2, 4.65], [0, 5.1, 5.35], [0, 6.1, 5.85]][stage - 1];
  // A continuous entrance is visible from the first pavilion to the tower, with one restrained Puls accent.
  put("accent", entrance[2], .17, stage >= 4 ? 2 : 1.35, entrance[0], stage < 3 ? 1.95 : 2.35, entrance[1]);
  put("dark", Math.min(2.6, entrance[2] - .6), 1.45, .1, entrance[0], .2, entrance[1] - .5);
  if (detail > 0) for (const side of [-1, 1]) put("stone", .12, stage < 3 ? 1.75 : 2.15, .12, entrance[0] + side * (entrance[2] / 2 - .15), .2, entrance[1] + .45);
  return boxes;
}

function scales(frame: LandmarkFrame) {
  return { x: frame.width / LANDMARK_SIDE, y: Math.min(frame.width, frame.depth) / LANDMARK_SIDE, z: frame.depth / LANDMARK_SIDE };
}

function localBounds(level: number) {
  const boxes = landmarkBoxes(level);
  return {
    x0: Math.min(...boxes.map(b => b.x - b.width / 2)), x1: Math.max(...boxes.map(b => b.x + b.width / 2)),
    y0: Math.min(...boxes.map(b => b.y)), y1: Math.max(...boxes.map(b => b.y + b.height)),
    z0: Math.min(...boxes.map(b => b.z - b.depth / 2)), z1: Math.max(...boxes.map(b => b.z + b.depth / 2)),
  };
}

/** Actual occupied geometry, rather than the whole reservation. Useful for labels, focus and selection. */
export function landmarkBounds(frame: LandmarkFrame, level: number): LandmarkBounds {
  const b = localBounds(level), scale = scales(frame), u = (b.x0 + b.x1) / 2 * scale.x, v = (b.z0 + b.z1) / 2 * scale.z;
  const s = Math.sin(frame.rotation), c = Math.cos(frame.rotation);
  return { ...frame, x: frame.x + c * u + s * v, z: frame.z - s * u + c * v,
    width: (b.x1 - b.x0) * scale.x, depth: (b.z1 - b.z0) * scale.z,
    bottom: LANDMARK_GROUND + b.y0 * scale.y, height: (b.y1 - b.y0) * scale.y };
}

export function landmarkHeight(level: number, width = LANDMARK_SIDE, depth = LANDMARK_SIDE) {
  return localBounds(level).y1 * Math.min(width, depth) / LANDMARK_SIDE;
}

/** Nearest distance to an actual architectural box. Empty space above low wings never steals another building's click. */
export function landmarkRayDistance(frame: LandmarkFrame, level: number, origin: Point3, direction: Point3): number | null {
  const s = Math.sin(frame.rotation), c = Math.cos(frame.rotation), scale = scales(frame), dx = origin.x - frame.x, dz = origin.z - frame.z;
  const o = { x: (dx * c - dz * s) / scale.x, y: (origin.y - LANDMARK_GROUND) / scale.y, z: (dx * s + dz * c) / scale.z };
  const d = { x: (direction.x * c - direction.z * s) / scale.x, y: direction.y / scale.y, z: (direction.x * s + direction.z * c) / scale.z };
  let distance = Infinity;
  for (const box of landmarkBoxes(level)) {
    let near = 0, far = Infinity;
    for (const [at, along, lo, hi] of [[o.x, d.x, box.x - box.width / 2, box.x + box.width / 2], [o.y, d.y, box.y, box.y + box.height], [o.z, d.z, box.z - box.depth / 2, box.z + box.depth / 2]]) {
      if (Math.abs(along) < 1e-10) { if (at < lo || at > hi) { far = -1; break; } continue; }
      const first = (lo - at) / along, last = (hi - at) / along;
      near = Math.max(near, Math.min(first, last)); far = Math.min(far, Math.max(first, last));
      if (far < near) break;
    }
    if (far >= near) distance = Math.min(distance, near);
  }
  return Number.isFinite(distance) ? distance : null;
}

/** One catalogue copy on the reserved cells. The permanent promenade stays outside this footprint. */
export function landmarkLayout(module: Pick<ModuleSlot, "x" | "z" | "rotation">, item: LandmarkItem): { placements: Placement[]; surfaces: Surface[] } {
  const w = item.w ?? MODULE_CELLS, h = item.h ?? MODULE_CELLS, centre = cellPoint(module, (item.u ?? 0) + w / 2, (item.v ?? 0) + h / 2);
  return { placements: [{ kind: "district-landmark", variant: landmarkLevel(item.level) - 1, ...centre,
    rotation: module.rotation + (item.rotation ?? 0) * Math.PI / 2, scale: 1, width: w * CELL, depth: h * CELL }], surfaces: [] };
}
