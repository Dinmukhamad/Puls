/** The team's growing community building. The whole reserved footprint stays fixed while its architecture grows. */
import { CELL, MODULE_CELLS, cellPoint, type ModuleSlot } from "./estates";
import type { Placement, Surface } from "./types";
import type { DistrictCentre } from "./land";

/** Models are drawn in this local frame, scaled to the actual reserved footprint by the catalogue. */
export const LANDMARK_SIDE = 18;
export const LANDMARK_LEVELS = 5;
export const LANDMARK_GROUND = .2;

export type LandmarkFinish = "stone" | "glass" | "dark" | "green" | "accent" | "roof" | "white" | "trim" | "gold" | "window" | "wood" | "leaf";
/**
 * How a part is drawn inside its box: a box; a cylinder standing up (or, `axis: "z"`, a disc facing the front); a
 * cone; a dome or a ball; a four-sided pyramid; a gable roof with its ridge `along` x or z.
 */
export type LandmarkShape = "box" | "cylinder" | "cone" | "dome" | "ball" | "pyramid" | "roof";
/**
 * A part of the building in its box, the box's bottom at y, in the building's local frame (the front to +z). The
 * renderer draws the part's shape within the box; picking and the bounds use the box. The simpler details leave out
 * small parts (`detail` 1: windows, bands, clocks; 2: flags, trees, benches); a window's `glow` (0…1) picks how and
 * when it lights at night.
 */
export interface LandmarkBox {
  x: number; y: number; z: number; width: number; height: number; depth: number; finish: LandmarkFinish;
  shape?: LandmarkShape; along?: "x" | "z"; axis?: "y" | "z"; detail?: 0 | 1 | 2; glow?: number;
}
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

/**
 * A family of civic buildings on a growing square: a pavilion under a lantern; the district house, two storeys with a
 * clock in its pediment and a bell turret; a town hall with a clock tower between gabled wings; the district centre,
 * its tower crowned with a dome, a glass wing and a hall with a green roof; a city tower of glass between stone piers
 * on a colonnaded podium, its crown ringed in the Puls colour under a gold spire. Every level has one entrance canopy.
 */
export function landmarkBoxes(level: number, detail: 0 | 1 | 2 = 2): LandmarkBox[] {
  const stage = landmarkLevel(level), boxes: LandmarkBox[] = [], B = .185;
  let windows = 0;
  const put = (finish: LandmarkFinish, width: number, height: number, depth: number, x: number, y: number, z: number, more: Partial<LandmarkBox> = {}) => {
    if ((more.detail ?? 0) <= detail) boxes.push({ finish, width, height, depth, x, y, z, ...more });
  };
  const roof = (width: number, depth: number, height: number, x: number, y: number, z: number, along: "x" | "z") => put("roof", width, height, depth, x, y, z, { shape: "roof", along });
  /** Windows on a face, w × h from y, at the positions along it; `at` is the face's own coordinate. Each lights on its own at night. */
  const panes = (face: "front" | "left" | "right", at: number, y: number, along: readonly number[], w: number, h: number) => {
    for (const a of along) {
      const glow = .05 + .95 * (Math.abs(Math.sin(++windows * 12.9898 + stage * 78.233) * 43758.5453) % 1);
      if (face === "front") put("window", w, h, .12, a, y, at + .03, { detail: 1, glow });
      else put("window", .12, h, w, at + (face === "right" ? .03 : -.03), y, a, { detail: 1, glow });
    }
  };
  const column = (x: number, z: number, y: number, height: number, d: number) => put("white", d, height, d, x, y, z, { shape: "cylinder" });
  /** A clock facing the front, its middle at height y: the gold rim, the dial and two hands. */
  const clock = (x: number, y: number, z: number, d: number) => {
    put("gold", d + .2, d + .2, .08, x, y - d / 2 - .1, z, { shape: "cylinder", axis: "z", detail: 1 });
    put("white", d, d, .1, x, y - d / 2, z + .03, { shape: "cylinder", axis: "z", detail: 1 });
    put("dark", .07, d * .4, .05, x, y, z + .1, { detail: 2 }); put("dark", d * .32, .07, .05, x + d * .16, y, z + .1, { detail: 2 });
  };
  /** A flag on a pole h high, flying towards +x. */
  const flag = (x: number, z: number, h: number, y = B) => {
    put("dark", .1, h, .1, x, y, z, { shape: "cylinder", detail: 2 }); put("gold", .18, .18, .18, x, y + h, z, { shape: "ball", detail: 2 });
    put("accent", .9, .55, .05, x + .5, y + h - .65, z, { detail: 2 });
  };
  const tree = (x: number, z: number, s: number, y = B) => {
    put("wood", .22 * s, .7 * s, .22 * s, x, y, z, { shape: "cylinder", detail: 2 }); put("leaf", 1.3 * s, 1.4 * s, 1.3 * s, x, y + .55 * s, z, { shape: "ball", detail: 2 });
  };
  const bench = (x: number, z: number) => put("wood", 1.3, .45, .45, x, B, z, { detail: 2 });

  if (stage === 1) {
    // A pavilion: stone walls under a roof along the front, a glazed entrance under the canopy, a lantern on the ridge.
    put("stone", 8.4, .16, 7.6, 0, .025, 0);
    put("stone", 6.2, 2.5, 4.2, 0, B, -.6);
    put("trim", 6.5, .16, 4.5, 0, B + 2.5, -.6, { detail: 1 });
    roof(6.8, 4.9, 1.75, 0, B + 2.5, -.6, "x");
    put("glass", 2.2, 2.1, .14, 0, B, 1.55); put("dark", .9, 1.6, .16, 0, B, 1.57);
    put("accent", 3.0, .17, 1.4, 0, B + 2.1, 2.2);
    for (const x of [-1.3, 1.3]) column(x, 2.75, B, 2.1, .2);
    panes("front", 1.5, B + .8, [-2.4, -1.75, 1.75, 2.4], .45, 1.1);
    panes("left", -3.1, B + .8, [-2.0, -.6, .8], .55, 1.1); panes("right", 3.1, B + .8, [-2.0, -.6, .8], .55, 1.1);
    put("white", .8, .7, .8, 0, B + 3.75, -.6); put("roof", 1.0, .7, 1.0, 0, B + 4.45, -.6, { shape: "pyramid" });
    put("gold", .22, .22, .22, 0, B + 5.12, -.6, { shape: "ball" });
    flag(3.1, 3.0, 4.2); tree(-3.5, -3.1, .9); tree(3.5, -3.1, .8); bench(-2.8, 3.0);
  }
  if (stage === 2) {
    // The district house: two storeys, the entrance bay with a clock in its pediment, a bell turret, a wing with a terrace.
    put("stone", 11.2, .16, 9.8, 0, .025, 0);
    put("stone", 7.8, 4.6, 5.2, .6, B, -1.2);
    put("trim", 7.9, .14, 5.3, .6, B + 2.3, -1.2, { detail: 1 }); put("trim", 8.1, .18, 5.5, .6, B + 4.6, -1.2, { detail: 1 });
    roof(8.4, 5.8, 2.0, .6, B + 4.6, -1.2, "x");
    put("white", 3.0, 5.0, .8, .6, B, 1.75); roof(3.3, 1.1, 1.2, .6, B + 5.0, 1.75, "z");
    clock(.6, B + 5.5, 2.32, .8);
    put("glass", 2.0, 2.1, .12, .6, B, 2.18); put("dark", 1.0, 1.8, .14, .6, B, 2.21); put("accent", 2.8, .17, 1.3, .6, B + 2.2, 2.8);
    for (const x of [-.6, 1.8]) column(x, 3.25, B, 2.2, .2);
    panes("front", 2.15, B + 2.75, [.6], .9, 1.3);
    for (const y of [B + .6, B + 2.9]) {
      panes("front", 1.4, y, [-2.6, -1.6, 2.8, 3.8], .6, 1.2);
      panes("left", -3.3, y, [-3.0, -1.8, -.6, .6], .6, 1.2); panes("right", 4.5, y, [-3.0, -1.8, -.6, .6], .6, 1.2);
    }
    put("white", 1.0, 1.1, 1.0, .6, B + 6.0, -1.2); put("roof", 1.3, .9, 1.3, .6, B + 7.1, -1.2, { shape: "pyramid" });
    put("gold", .26, .26, .26, .6, B + 7.95, -1.2, { shape: "ball" });
    put("stone", 1.9, 2.6, 4.0, -4.3, B, -1.0); put("green", 1.7, .1, 3.8, -4.3, B + 2.6, -1.0, { detail: 1 });
    panes("front", 1.0, B + .7, [-4.3], .7, 1.2); panes("left", -5.25, B + .7, [-2.2, -1.0, .2], .6, 1.2);
    flag(-4.8, 3.9, 4.6); flag(4.6, 3.9, 4.6); tree(4.9, -3.9, 1); tree(-4.8, -3.9, .9); bench(3.4, 3.7);
  }
  if (stage === 3) {
    // A town hall: three storeys between two gabled wings, the clock tower out of the middle of the front.
    put("stone", 13.8, .16, 11.8, 0, .025, 0);
    put("stone", 8.6, 6.9, 5.8, 0, B, -2.0);
    for (const y of [B + 2.3, B + 4.6]) put("trim", 8.7, .14, 5.9, 0, y, -2.0, { detail: 1 });
    put("trim", 8.9, .2, 6.1, 0, B + 6.9, -2.0, { detail: 1 });
    roof(9.2, 6.4, 2.3, 0, B + 6.9, -2.0, "x");
    for (const y of [B + .6, B + 2.9, B + 5.2]) panes("front", .9, y, [-3.4, -2.4, 2.4, 3.4], .6, 1.2);
    for (const sx of [-1, 1]) {
      const x = sx * 5.5;
      put("stone", 2.4, 4.6, 6.4, x, B, -1.5); put("trim", 2.5, .14, 6.5, x, B + 2.3, -1.5, { detail: 1 });
      roof(2.8, 6.8, 1.5, x, B + 4.6, -1.5, "z");
      for (const y of [B + .6, B + 2.9]) {
        panes("front", 1.7, y, [x], .8, 1.3);
        panes(sx < 0 ? "left" : "right", x + sx * 1.2, y, [-4.0, -2.6, -1.2, .2], .6, 1.2);
      }
    }
    put("white", 2.6, 10.2, 2.6, 0, B, .4); put("trim", 2.9, .25, 2.9, 0, B + 10.2, .4, { detail: 1 });
    put("roof", 3.0, 2.1, 3.0, 0, B + 10.45, .4, { shape: "pyramid" }); put("gold", .32, .9, .32, 0, B + 12.45, .4, { shape: "cone" });
    clock(0, B + 8.7, 1.72, 1.4);
    panes("front", 1.7, B + 3.0, [0], .8, 1.5); panes("front", 1.7, B + 5.4, [0], .8, 1.4);
    put("glass", 2.0, 2.3, .12, 0, B, 1.73); put("dark", 1.1, 2.1, .14, 0, B, 1.76); put("accent", 3.6, .17, 1.5, 0, B + 2.4, 2.45);
    for (const x of [-1.5, 1.5]) column(x, 3.0, B, 2.4, .24);
    put("stone", 3.0, .12, .8, 0, B, 3.6, { detail: 1 });
    flag(-6.2, 5.2, 5.2); flag(5.9, 5.2, 5.2); tree(-6.0, -5.0, 1.1); tree(6.0, -5.0, 1.0); bench(-3.8, 4.4); bench(3.8, 4.4);
  }
  if (stage === 4) {
    // The district centre: the hall round the tower crowned with a dome, a glass wing, a hall with a green roof.
    put("stone", 15.8, .16, 13.8, 0, .025, 0);
    put("stone", 7.4, 7.6, 6.2, 0, B, -2.4);
    for (const y of [B + 1.9, B + 3.8, B + 5.7]) put("trim", 7.5, .14, 6.3, 0, y, -2.4, { detail: 1 });
    put("trim", 7.7, .2, 6.5, 0, B + 7.6, -2.4, { detail: 1 });
    roof(8.0, 6.8, 2.0, 0, B + 7.6, -2.4, "x");
    for (const y of [B + .5, B + 2.4, B + 4.3, B + 6.2]) panes("front", .7, y, [-3.0, -2.1, 2.1, 3.0], .55, 1.1);
    put("white", 2.8, 11.4, 2.8, 0, B, .2); put("trim", 3.1, .25, 3.1, 0, B + 11.4, .2, { detail: 1 });
    put("white", 2.6, 1.0, 2.6, 0, B + 11.65, .2, { shape: "cylinder" });
    put("roof", 2.7, 1.8, 2.7, 0, B + 12.65, .2, { shape: "dome" });
    put("white", .7, .8, .7, 0, B + 14.35, .2, { shape: "cylinder" }); put("gold", .5, 1.1, .5, 0, B + 15.1, .2, { shape: "cone" });
    clock(0, B + 9.9, 1.62, 1.6);
    for (const y of [B + 3.2, B + 5.6, B + 7.8]) panes("front", 1.6, y, [0], .8, 1.3);
    put("dark", 1.4, 2.4, .14, 0, B, 1.62); put("accent", 4.2, .17, 1.8, 0, B + 2.6, 2.5);
    for (const x of [-1.8, -.8, .8, 1.8]) column(x, 3.2, B, 2.6, .26);
    // The glass wing: curtain walls between stone piers, a roof garden.
    put("glass", 4.0, 8.6, 5.8, 5.7, B, -2.6);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put("white", .32, 8.8, .32, 5.7 + sx * 1.92, B, -2.6 + sz * 2.82);
    put("dark", 4.3, .25, 6.1, 5.7, B + 8.6, -2.6); put("green", 3.6, .12, 5.4, 5.7, B + 8.85, -2.6, { detail: 1 });
    tree(4.9, -1.2, .6, B + 8.97); tree(6.5, -4.0, .55, B + 8.97);
    // The lower hall with a green roof.
    put("stone", 4.0, 3.4, 6.0, -5.7, B, -1.8); put("green", 3.8, .12, 5.8, -5.7, B + 3.4, -1.8, { detail: 1 });
    panes("front", 1.2, B + .7, [-6.6, -4.8], .8, 1.5); panes("left", -7.7, B + .7, [-4.0, -2.6, -1.2, .2], .6, 1.5);
    tree(-6.6, -4.0, .55, B + 3.52); tree(-5.0, -1.0, .5, B + 3.52);
    flag(-7.2, 6.1, 5.6); flag(6.9, 6.1, 5.6); bench(-4.4, 5.2); bench(4.4, 5.2);
  }
  if (stage === 5) {
    // A city tower: glass between stone piers on a colonnaded podium with roof gardens, the crown ringed in the Puls
    // colour under a gold spire, a great clock on the front.
    put("stone", 16.8, .16, 16.2, 0, .025, 0);
    put("stone", 15.2, .9, 11.6, 0, B, -1.6); put("glass", 14.9, 2.2, 11.3, 0, B + .9, -1.6); put("stone", 15.4, .8, 11.8, 0, B + 3.1, -1.6);
    for (const sx of [-1, 1]) {
      put("green", 4.0, .12, 10.6, sx * 5.3, B + 3.9, -1.6, { detail: 1 });
      tree(sx * 6.0, -5.5, .8, B + 4.02); tree(sx * 4.8, -.5, .7, B + 4.02);
    }
    put("glass", 6.8, 12.4, 5.8, 0, B + 3.9, -2.0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put("white", .6, 12.6, .6, sx * 3.3, B + 3.9, -2.0 + sz * 2.8);
    for (const y of [B + 7.0, B + 10.2, B + 13.4]) put("white", 6.9, .3, 5.9, 0, y, -2.0, { detail: 1 });
    put("white", 7.2, .5, 6.2, 0, B + 16.3, -2.0); put("white", 5.4, 1.3, 4.6, 0, B + 16.8, -2.0);
    put("accent", 5.6, .35, 4.8, 0, B + 17.4, -2.0, { detail: 1 });
    put("white", 3.4, 1.0, 2.8, 0, B + 18.1, -2.0); put("gold", .7, 2.8, .7, 0, B + 19.1, -2.0, { shape: "cone" });
    clock(0, B + 14.4, .94, 2.2);
    // The colonnade before the podium, the canopy over the doors.
    put("white", 13.0, .6, 1.4, 0, B + 3.2, 4.9);
    for (const x of [-6.0, -3.6, -1.2, 1.2, 3.6, 6.0]) column(x, 5.2, B, 3.2, .4);
    put("dark", 2.6, 2.6, .14, 0, B, 4.25); put("accent", 2.0, .17, 1.4, 0, B + 2.7, 4.9);
    for (const x of [-7.4, -5.0, 4.6, 7.0]) flag(x, 7.0, 6.0);
    bench(-3.0, 6.6); bench(3.0, 6.6);
  }
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
