/**
 * The public square of a team district (docs/CITY_ESTATES.md): a module of MODULE_CELLS × MODULE_CELLS cells in
 * the district's centre (world/land.ts), where the district's shared projects stand; the server keeps the same
 * cells (app/services/city_estate.py). This file maps a cell to the ground and lays out what stands on it, with
 * the plane geometry the land shares; it has no three.js. What operators build on their plots is laid out in
 * world/landLayouts.ts.
 */
import { segmentDistance } from "./generate";
import type { Placement, PlacementKind, Point, Road, Surface, SurfaceKind } from "./types";

import { MODULE_CELLS, PROJECT_LEVELS, PROJECT_SIZE, projectFootprint, type ProjectFamily } from "./estateGrid";

export * from "./estateGrid";
export type DepartmentKey = "support" | "sales";

/** One cell in world units, the square's side. */
export const CELL = 1.5;
export const MODULE = CELL * MODULE_CELLS;
/** Headquarters stand on a site this large (its half side). */
export const HQ_HALF = 8;

/** A district's public square: its centre, its front (local +v) towards `rotation` (atan2(dx, dz)). */
export interface ModuleSlot { district: number; slot: number; kind: "public"; x: number; z: number; rotation: number }

const H = MODULE / 2;

/** The four corners of a square of half side `h` centred at (x, z), turned by `rotation`. */
export function squareCorners(x: number, z: number, rotation: number, h = H): Point[] {
  const s = Math.sin(rotation), c = Math.cos(rotation);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: x + (c * u + s * v) * h, z: z + (-s * u + c * v) * h }));
}

/** Distance from a segment to a convex polygon (0 when they cross or the segment is inside). */
export function segmentPolygonDistance(road: Road, polygon: Point[]) {
  const [ax, az, bx, bz] = road;
  if (insidePolygon({ x: ax, z: az }, polygon) || insidePolygon({ x: bx, z: bz }, polygon)) return 0;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    if (segmentsCross(ax, az, bx, bz, p.x, p.z, q.x, q.z)) return 0;
    best = Math.min(best, segmentDistance(p.x, p.z, road), segmentDistance(ax, az, [p.x, p.z, q.x, q.z]), segmentDistance(bx, bz, [p.x, p.z, q.x, q.z]));
  }
  return best;
}
function insidePolygon(p: Point, polygon: Point[]) {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}
function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
/** Do two convex polygons overlap (separating axis test), with `pad` added to the gap they need? */
export function polygonsOverlap(a: Point[], b: Point[], pad = 0) {
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], nx = q.z - p.z, nz = p.x - q.x, length = Math.hypot(nx, nz);
    const project = (list: Point[]) => list.map(v => (v.x * nx + v.z * nz) / length);
    const pa = project(a), pb = project(b);
    if (Math.max(...pa) + pad <= Math.min(...pb) || Math.max(...pb) + pad <= Math.min(...pa)) return false;
  }
  return true;
}

/** World position of grid coordinates (0…12 across the module; a cell's centre is at u + ½, v + ½), the front (+v) towards the rotation. */
export function cellPoint(module: Pick<ModuleSlot, "x" | "z" | "rotation">, u: number, v: number): Point {
  const s = Math.sin(module.rotation), c = Math.cos(module.rotation), lu = (u - MODULE_CELLS / 2) * CELL, lv = (v - MODULE_CELLS / 2) * CELL;
  return { x: module.x + c * lu + s * lv, z: module.z - s * lu + c * lv };
}
/** The cell (fractional) under a world point, in the module's own grid; outside the module when off 0…12. */
export function pointCell(module: Pick<ModuleSlot, "x" | "z" | "rotation">, p: Point): { u: number; v: number } {
  const s = Math.sin(module.rotation), c = Math.cos(module.rotation), dx = p.x - module.x, dz = p.z - module.z;
  return { u: (dx * c - dz * s) / CELL + MODULE_CELLS / 2, v: (dx * s + dz * c) / CELL + MODULE_CELLS / 2 };
}
// ---- buildings ------------------------------------------------------------------------------------------

export interface EstateItem { family: ProjectFamily; level: number; u: number; v: number; rotation: number }
export interface Layout { placements: Placement[]; surfaces: Surface[] }

/**
 * A building's own frame: the centre of its footprint and its front, the module's front turned by quarter
 * turns (a turn faces it towards the module's +u). `put(lu, lw)` lays pieces along its width (lu) and towards its front (lw).
 */
function frame(module: Pick<ModuleSlot, "x" | "z" | "rotation">, family: ProjectFamily, u: number, v: number, rotation: number) {
  const [w, h] = projectFootprint(family, rotation), centre = cellPoint(module, u + w / 2, v + h / 2), angle = module.rotation + rotation * Math.PI / 2;
  const s = Math.sin(angle), c = Math.cos(angle);
  const placements: Placement[] = [], surfaces: Surface[] = [];
  const at = (lu: number, lw: number) => ({ x: centre.x + c * lu + s * lw, z: centre.z - s * lu + c * lw });
  return {
    width: PROJECT_SIZE[family][0] * CELL, depth: PROJECT_SIZE[family][1] * CELL, placements, surfaces,
    put(kind: PlacementKind, lu: number, lw: number, turn: number, extra: Partial<Placement> = {}) {
      placements.push({ kind, variant: placements.length, ...at(lu, lw), rotation: angle + turn, scale: 1, width: 0, ...extra });
    },
    patch(kind: SurfaceKind, lu: number, lw: number, alongU: number, alongW: number) { surfaces.push({ kind, ...at(lu, lw), angle: angle + Math.PI / 2, length: alongU, width: alongW }); },
    disc(kind: SurfaceKind, lu: number, lw: number, r: number) { surfaces.push({ kind, ...at(lu, lw), angle: 0, length: 2 * r, width: 2 * r, round: true }); },
  };
}
type Frame = ReturnType<typeof frame>;

/** A slate roof (catalogue ROOF_TINTS 0). */
const SLATE = 0;

function square(f: Frame) {
  f.patch("lawn", 0, 0, 1.36, 1.36);
  f.put("tree-round", -.28, -.28, .7, { scale: .72 });
  f.put("bench", .12, .45, Math.PI, { width: .9, scale: .8 });
  f.put("flowerbed", .4, -.36, 0, { width: .6, scale: .5 });
}
function gazebo(f: Frame, level: number) {
  f.patch("lawn", 0, 0, 1.36, 1.36);
  if (level > 1) { f.disc("plaza", 0, -.05, .58); f.put("flowerbed", -.5, -.5, 0, { width: .5, scale: .42 }); f.put("flowerbed", .5, -.5, 1, { width: .5, scale: .42 }); }
  f.put("gazebo", 0, -.05, 0, { width: 1.2, scale: .46 });
  f.put("bush", -.52, .52, 0, { scale: .62 }); f.put("bush", .52, .52, 1, { scale: .62 });
}
function fountain(f: Frame, level: number) {
  f.patch("plaza", 0, 0, 2.9, 2.9); f.disc("walk", 0, 0, 1.2);
  f.put("fountain", 0, 0, 0, { width: 1.7, scale: .85 });
  for (const k of [0, 1, 2, 3]) { const a = k * Math.PI / 2; f.put("bench", Math.sin(a) * 1.18, Math.cos(a) * 1.18, a + Math.PI, { width: .9, scale: .85 }); }
  if (level > 1) for (const [u, w, kind] of [[-1.1, -1.1, "tree-round"], [1.1, -1.1, "tree-oak"], [-1.1, 1.1, "flowerbed"], [1.1, 1.1, "flowerbed"]] as const) {
    f.patch("lawn", u, w, .74, .74); f.put(kind, u, w, u * 2, kind === "flowerbed" ? { width: .6, scale: .6 } : { scale: .62 });
  }
}
function sports(f: Frame, level: number) {
  f.patch("walk", 0, 0, 2.95, 2.95); f.patch("court", 0, level > 2 ? .2 : 0, 2.9, 2.1);
  f.patch("line", 0, level > 2 ? .2 : 0, .05, 2.1); f.disc("line", 0, level > 2 ? .2 : 0, .36); f.disc("court", 0, level > 2 ? .2 : 0, .31);
  f.put("hoop", -1.32, level > 2 ? .2 : 0, Math.PI / 2, { width: .8, scale: .8 }); f.put("hoop", 1.32, level > 2 ? .2 : 0, -Math.PI / 2, { width: .8, scale: .8 });
  if (level > 1) {
    // Supporters' benches under a light canopy at the back.
    f.put("bench", -.5, -1.22, 0, { width: .9, scale: .85 }); f.put("bench", .5, -1.22, 0, { width: .9, scale: .85 });
    f.put("roof", 0, -1.22, Math.PI / 2, { width: .55, depth: 2.1, scale: .25, lift: .85, tint: SLATE });
  }
  if (level > 2) { f.patch("play-blue", 0, 1.3, 2.9, .34); f.put("tree-round", -1.25, 1.25, 0, { scale: .55 }); f.put("tree-round", 1.25, 1.25, 1, { scale: .55 }); }
}
function park(f: Frame, level: number) {
  f.patch("lawn", 0, 0, 4.4, 2.9); f.patch("walk", 0, 0, 4.4, .42);
  const trees: [number, number, PlacementKind][] = [[-1.75, .92, "tree-round"], [-1.75, -.92, "tree-oak"], [-.62, -.98, "tree-round"], [.62, .98, "tree-birch"], [1.75, .92, "tree-oak"], [1.75, -.92, "tree-round"]];
  trees.forEach(([u, w, kind], i) => { if (level < 3 || Math.abs(u) > 1) f.put(kind, u, w, i * 1.7, { scale: kind === "tree-birch" ? .9 : .82 }); });
  f.put("bench", -.62, .42, Math.PI, { width: .9, scale: .85 }); f.put("bench", .62, -.42, 0, { width: .9, scale: .85 });
  if (level > 1) {
    f.disc("plaza", 1.45, -.58, .55); f.put("gazebo", 1.45, -.62, 0, { width: 1.1, scale: .4 });
    f.put("flowerbed", -1.2, .95, 0, { width: .6, scale: .55 }); f.put("flowerbed", -.1, .98, 1, { width: .6, scale: .55 });
    f.disc("play", -1.45, -.55, .48); f.put("bush", -1.95, -1.1, 0, { scale: .6 });
  }
  if (level > 2) {
    f.disc("plaza", 0, 0, .95); f.put("fountain", 0, 0, 0, { width: 1.2, scale: .6 });
    f.put("lamp", -.95, .55, 0); f.put("lamp", .95, -.55, 0); f.put("flowerbed", .55, .95, 2, { width: .6, scale: .5 });
  }
}
const BUILD: Record<ProjectFamily, (f: Frame, level: number) => void> = { square, gazebo, fountain, sports, park };

/** What stands on one building at its level: copies for the instance pools and ground patches, all inside its footprint. */
export function objectLayout(module: Pick<ModuleSlot, "x" | "z" | "rotation">, item: EstateItem): Layout {
  const f = frame(module, item.family, item.u, item.v, item.rotation);
  BUILD[item.family](f, Math.max(1, Math.min(PROJECT_LEVELS[item.family], item.level)));
  return { placements: f.placements, surfaces: f.surfaces };
}
/** A project still collecting: a fenced building site on its cells. */
export function siteLayout(module: Pick<ModuleSlot, "x" | "z" | "rotation">, item: Omit<EstateItem, "level">): Layout {
  const f = frame(module, item.family, item.u, item.v, item.rotation), w = f.width / 2 - .2, d = f.depth / 2 - .2;
  f.patch("sand", 0, 0, f.width - .2, f.depth - .2);
  for (const [u, lw, l, wd] of [[0, d, f.width - .4, .07], [0, -d, f.width - .4, .07], [w, 0, .07, f.depth - .4], [-w, 0, .07, f.depth - .4]] as const) f.patch("line", u, lw, l, wd);
  f.put("planter", -w + .3, d - .3, 0, { width: .5 }); f.put("planter", w - .3, d - .3, 0, { width: .5 });
  return { placements: f.placements, surfaces: f.surfaces };
}

/**
 * One paved courtyard for shared projects, with seating and planting around its edges. The full 12 × 12
 * playable grid stays clear: permanent furniture belongs only to the surrounding promenade. Walk paving
 * sits below the ground patches of paid projects, so their lawns and courts replace it when built.
 */
export function moduleGround(module: ModuleSlot): Layout {
  const placements: Placement[] = [], surfaces: Surface[] = [], s = Math.sin(module.rotation), c = Math.cos(module.rotation), h = MODULE / 2;
  const at = (lu: number, lw: number) => ({ x: module.x + c * lu + s * lw, z: module.z - s * lu + c * lw });
  const patch = (kind: SurfaceKind, lu: number, lw: number, alongU: number, alongW: number) => surfaces.push({ kind, ...at(lu, lw), angle: module.rotation + Math.PI / 2, length: alongU, width: alongW });
  const put = (kind: PlacementKind, lu: number, lw: number, turn = 0, scale = 1) => placements.push({ kind, variant: placements.length, ...at(lu, lw), rotation: module.rotation + turn, scale, width: 0 });
  patch("walk", 0, 0, MODULE + 2.2, MODULE + 2.2);
  // A subtle frame reads as one square; it never cuts the buildable area into apparent plots.
  const edge = h + .65;
  for (const side of [-1, 1]) {
    patch("plaza", 0, side * edge, MODULE + 1.6, .18);
    patch("plaza", side * edge, 0, .18, MODULE + 1.6);
    for (const k of [-.62, .62]) {
      put("tree-round", k * h, side * edge, k + side, .8);
      put("tree-round", side * edge, k * h, k - side, .8);
    }
    for (const k of [-.29, .29]) {
      put("bench", k * h, side * edge, side > 0 ? Math.PI : 0, .9);
      put("bench", side * edge, k * h, side > 0 ? -Math.PI / 2 : Math.PI / 2, .9);
    }
  }
  for (const u of [-edge, edge]) for (const w of [-edge, edge]) put("flowerbed", u, w, 0, .6);
  return { placements, surfaces };
}

// ---- placement preview -------------------------------------------------------------------------------------

export interface Placing { family: ProjectFamily; u: number; v: number; rotation: number }

/**
 * Why a shared project cannot stand there on the public square, as the server would say it
 * (app/services/city_estate.py open_project), or null: the preview turns red with the reason, and the server
 * checks everything again.
 */
export function squareProblem(p: Placing, occupied: (u: number, v: number) => boolean): string | null {
  const [w, h] = projectFootprint(p.family, p.rotation), cells: [number, number][] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) cells.push([p.u + i, p.v + j]);
  if (cells.some(([u, v]) => u < 0 || v < 0 || u >= MODULE_CELLS || v >= MODULE_CELLS)) return "Проект должен целиком помещаться на общественной площади";
  if (cells.some(([u, v]) => occupied(u, v))) return "Эти клетки уже заняты";
  return null;
}
