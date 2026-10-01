/**
 * Team districts as land (docs/CITY_ESTATES.md): every district has prepared modules of 12 × 12 cells around
 * its headquarters, laid out once per city so that adding a district or hiring an operator never moves an
 * existing cell. The server keeps the same logical grid (app/services/city_estate.py): module slots and their
 * kinds, estates and tower lots of 4 × 4 cells. This file knows where the modules stand in each city and how
 * a cell maps to the ground; it has no three.js.
 */
import { segmentDistance } from "./generate";
import { RAIL_LINES, railRoad, stationBox } from "./railway";
import type { Placement, PlacementKind, Point, Road, Surface, SurfaceKind } from "./types";

import { FAMILY_LEVELS, FAMILY_SIZE, LOT_CELLS, MODULE_CELLS, HOUSE_ROWS, PREPARED, footprint, moduleKind, type EstateFamily, type ModuleKind } from "./estateGrid";

export * from "./estateGrid";
export type DepartmentKey = "support" | "sales";

/** One cell in world units, the street between modules. */
export const CELL = 1.5, STREET = 3;
export const MODULE = CELL * MODULE_CELLS;
/** Headquarters stand on a site this large; modules keep this clear of it. */
export const HQ_HALF = 8;

/** A module square: its centre, its front (local +v) towards `rotation` (atan2(dx, dz)), as plots are turned (world/plots.ts). */
export interface ModuleSlot { district: number; slot: number; kind: ModuleKind; x: number; z: number; rotation: number }
/** Where every district's modules stand; `modules[i]` belongs to district number i + 1. */
export interface DistrictLand { city: DepartmentKey; headquarters: (Point & { rotation: number })[]; modules: ModuleSlot[][] }

/** Keeps out of the land: streets and the railway as segments with their half width, discs (lake) and rectangles. */
export interface LandRules {
  streets: readonly Road[];
  /** Ring roads (support): modules stay between two of them. */
  rings?: readonly number[];
  /** Segments with a clearance of their own (the railway deck). */
  corridors?: { road: Road; half: number }[];
  /** Kept-out discs: the lake with its promenade. */
  discs?: (Point & { r: number })[];
  /** Kept-out axis-aligned rectangles: the station and its stairs. */
  boxes?: { x0: number; z0: number; x1: number; z1: number }[];
  /** Directions (radians) of the avenues across the suburbs: a support district keeps to the wedge of its headquarters. */
  wedges?: readonly number[];
  /** Sales: the part of the frame each district keeps to, by district index; a district without one gets no land. */
  regions?: readonly { x0: number; z0: number; x1: number; z1: number }[];
}

const ROAD_CLEAR = 2.5, H = MODULE / 2;

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

/** Is a module square at (x, z, rotation) clear of every road, the railway, the water and the station? */
export function landClear(rules: LandRules, x: number, z: number, rotation: number) {
  const corners = squareCorners(x, z, rotation);
  if (rules.streets.some(road => segmentPolygonDistance(road, corners) < ROAD_CLEAR)) return false;
  if (rules.corridors?.some(({ road, half }) => segmentPolygonDistance(road, corners) < half + ROAD_CLEAR)) return false;
  if (rules.rings?.length) {
    const near = Math.hypot(x, z) - H, far = Math.max(...corners.map(p => Math.hypot(p.x, p.z)));
    // Beyond the last ring road the suburbs run on to the fog.
    const inner = [...rules.rings].reverse().find(r => r < near + 1e-6), outer = rules.rings.find(r => r > far - 1e-6) ?? Infinity;
    if (inner === undefined || near < inner + 1 + ROAD_CLEAR || far > outer - 1 - ROAD_CLEAR) return false;
  }
  if (rules.discs?.some(d => corners.some(p => Math.hypot(p.x - d.x, p.z - d.z) < d.r) || Math.hypot(x - d.x, z - d.z) < d.r + H)) return false;
  if (rules.boxes?.some(b => polygonsOverlap(corners, [{ x: b.x0, z: b.z0 }, { x: b.x1, z: b.z0 }, { x: b.x1, z: b.z1 }, { x: b.x0, z: b.z1 }]))) return false;
  return true;
}

/** Support: modules face the lagoon on four rings of the suburbs, two either side of the outer ring road. */
const SUPPORT_ROWS = [202.5, 223.7, 258.5, 279.7];
/** Sales: an axis-aligned lattice in the frame round the lake, facing the lake. */
const SALES_COLUMNS = [-120.5, -99.5, -78.5, -42, -21, 0, 21, 42, 78.5, 99.5, 120.5], SALES_ROWS = [-98.5, -77.5, -54.5, -33.5, -12.5, 8.5, 29.5, 50.5, 77.5, 98.5];

/** Candidate module squares of a city, in a stable order (ring by ring or row by row). */
export function candidates(city: DepartmentKey): (Point & { rotation: number })[] {
  if (city === "support") return SUPPORT_ROWS.flatMap(r => {
    const step = (MODULE + STREET) / r, count = Math.floor(Math.PI * 2 / step);
    return Array.from({ length: count }, (_, j) => { const a = j * Math.PI * 2 / count; return { x: Math.cos(a) * r, z: Math.sin(a) * r, rotation: Math.atan2(-Math.cos(a), -Math.sin(a)) }; });
  });
  return SALES_ROWS.flatMap(z => SALES_COLUMNS.map(x => ({ x, z, rotation: facing(x, z) })));
}
/** The axis direction from (x, z) closest to the lake at the centre. */
function facing(x: number, z: number) {
  const a = Math.atan2(-x, -z), quarter = Math.PI / 2;
  return Math.round(a / quarter) * quarter;
}

/**
 * Every district's modules, district by district: the nearest clear candidates to its headquarters that no
 * earlier district took. A district never depends on a later one, so adding districts moves nothing. Kinds
 * follow the slot order: the nearest square is the public one, the farthest of the chosen is the business
 * quarter (behind or beside the main view), the rest are residential, nearest first.
 */
export function districtLand(city: DepartmentKey, rules: LandRules, headquarters: Point[]): DistrictLand {
  const sites = headquarters.map(p => ({ ...p, rotation: city === "sales" ? facing(p.x, p.z) : Math.atan2(-p.x, -p.z) }));
  const hqSquares = sites.map(p => squareCorners(p.x, p.z, p.rotation, HQ_HALF));
  const free = candidates(city).filter(c => landClear(rules, c.x, c.z, c.rotation) && hqSquares.every(sq => !polygonsOverlap(squareCorners(c.x, c.z, c.rotation), sq, 1.5)));
  const wedge = (p: Point) => rules.wedges ? wedgeOf(rules.wedges, Math.atan2(p.z, p.x)) : 0;
  const inRegion = (i: number, p: Point) => { if (!rules.regions) return true; const r = rules.regions[i]; return !!r && p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1; };
  const taken = new Set<number>();
  const modules = sites.map((hq, i) => {
    const want = PREPARED[i] ?? 0, own = wedge(hq);
    const order = free.map((c, k) => ({ k, d: Math.hypot(c.x - hq.x, c.z - hq.z) })).filter(({ k }) => !taken.has(k) && wedge(free[k]) === own && inRegion(i, free[k])).sort((a, b) => a.d - b.d || a.k - b.k).slice(0, want);
    order.forEach(({ k }) => taken.add(k));
    if (order.length < want) return [];
    // Public nearest, business farthest, residential by distance.
    const chosen = order.map(({ k }) => free[k]);
    const business = chosen.length > 1 ? chosen.length - 1 : -1;
    const ordered = chosen.length > 1 ? [chosen[0], chosen[business], ...chosen.slice(1, business)] : chosen;
    return ordered.map((c, slot) => ({ district: i + 1, slot, kind: moduleKind(slot), x: c.x, z: c.z, rotation: c.rotation }));
  });
  return { city, headquarters: sites, modules };
}

/** Which wedge between the avenues (sorted directions) a direction falls in. */
export function wedgeOf(avenues: readonly number[], angle: number) {
  const k = avenues.findIndex(a => a > angle);
  return k <= 0 ? 0 : k;
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
/** Estates and tower lots: index = row × 3 + column, their first cell. */
export function lotOrigin(index: number) { return { u: (index % 3) * LOT_CELLS, v: Math.floor(index / 3) * LOT_CELLS }; }

/** Is `p` within `pad` of a district module (or `hqPad` of a headquarters site)? Those stay free for what the teams build. */
export function onDistrictLand(land: DistrictLand, p: Point, pad: number, hqPad = pad) {
  const inside = (x: number, z: number, rotation: number, half: number) => {
    const s = Math.sin(rotation), c = Math.cos(rotation), dx = p.x - x, dz = p.z - z;
    return Math.abs(dx * c - dz * s) <= half && Math.abs(dx * s + dz * c) <= half;
  };
  return land.headquarters.some(h => inside(h.x, h.z, h.rotation, HQ_HALF + hqPad)) || land.modules.some(list => list.some(m => inside(m.x, m.z, m.rotation, MODULE / 2 + pad)));
}
/**
 * The generated city without whatever stood on district land: houses, trees, lamps and their patches. One pad for
 * every copy, so the pieces of one house (walls and roof at the same spot) always go together.
 */
export function clearDistrictLand(world: { placements: Placement[]; surfaces: Surface[] }, land: DistrictLand) {
  world.placements = world.placements.filter(p => !onDistrictLand(land, p, 4, 8.5));
  world.surfaces = world.surfaces.filter(s => !onDistrictLand(land, s, Math.max(s.length, s.width) / 2 + 1.6, 8.5));
}

/**
 * The corridors district land keeps clear of: support's railway from its station to the hills (world/railway.ts);
 * in sales the boulevard from the lake to the station, where the line ran before, so that no module moves.
 */
export const RAILWAYS: Record<DepartmentKey, { road: Road; half: number }> = {
  support: railRoad(RAIL_LINES.x4),
  sales: { road: [0, 48, 0, 218], half: 2.35 },
};
/**
 * Sales: the lake with its promenade trees; the campus pier and the boulevard's head, the box the old station
 * kept out (district 6's modules were laid out round it and stay where they are).
 */
const SALES_LAKE = 56, SALES_PIER = { x0: -4, z0: 26, x1: 12, z1: 70 };
/** Sales districts: B and C on the left and the right above, A along the top, then below B and C, and by the station. */
const SALES_REGIONS = [
  { x0: -132, z0: -66, x1: -66, z1: 19 }, { x0: 66, z0: -66, x1: 132, z1: 19 }, { x0: -132, z0: -110, x1: 132, z1: -66 },
  { x0: -132, z0: 19, x1: -66, z1: 110 }, { x0: 66, z0: 19, x1: 132, z1: 110 }, { x0: -66, z0: 66, x1: 66, z1: 110 },
];

/** Directions of the streets that cross radius `r` (the avenues through the suburbs), sorted. */
export function avenueAngles(streets: readonly Road[], r: number) {
  const angles: number[] = [];
  for (const [ax, az, bx, bz] of streets) {
    const ra = Math.hypot(ax, az), rb = Math.hypot(bx, bz);
    if ((ra - r) * (rb - r) > 0 || ra === rb) continue;
    const t = (r - ra) / (rb - ra);
    angles.push(Math.atan2(az + (bz - az) * t, ax + (bx - ax) * t));
  }
  return angles.sort((a, b) => a - b);
}

/** What a city's district land keeps clear of. */
export function landRules(city: DepartmentKey, roads: { streets: readonly Road[]; rings: readonly number[] }): LandRules {
  if (city === "support") return { streets: roads.streets, rings: roads.rings, corridors: [RAILWAYS.support], boxes: [stationBox(RAIL_LINES.x4)], wedges: avenueAngles(roads.streets, 220) };
  return { streets: roads.streets, corridors: [RAILWAYS.sales], discs: [{ x: 0, z: 0, r: SALES_LAKE }], boxes: [SALES_PIER, stationBox(RAIL_LINES.sales)], regions: SALES_REGIONS };
}

// ---- buildings ------------------------------------------------------------------------------------------

export interface EstateItem { family: EstateFamily; level: number; u: number; v: number; rotation: number }
export interface Layout { placements: Placement[]; surfaces: Surface[] }

/**
 * A building's own frame: the centre of its footprint and its front, the module's front turned by quarter
 * turns (a turn faces it towards the module's +u). `put(lu, lw)` lays pieces along its width (lu) and towards its front (lw).
 */
function frame(module: Pick<ModuleSlot, "x" | "z" | "rotation">, family: EstateFamily, u: number, v: number, rotation: number) {
  const [w, h] = footprint(family, rotation), centre = cellPoint(module, u + w / 2, v + h / 2), angle = module.rotation + rotation * Math.PI / 2;
  const s = Math.sin(angle), c = Math.cos(angle);
  const placements: Placement[] = [], surfaces: Surface[] = [];
  const at = (lu: number, lw: number) => ({ x: centre.x + c * lu + s * lw, z: centre.z - s * lu + c * lw });
  return {
    width: FAMILY_SIZE[family][0] * CELL, depth: FAMILY_SIZE[family][1] * CELL, placements, surfaces,
    put(kind: PlacementKind, lu: number, lw: number, turn: number, extra: Partial<Placement> = {}) {
      placements.push({ kind, variant: placements.length, ...at(lu, lw), rotation: angle + turn, scale: 1, width: 0, ...extra });
    },
    patch(kind: SurfaceKind, lu: number, lw: number, alongU: number, alongW: number) { surfaces.push({ kind, ...at(lu, lw), angle: angle + Math.PI / 2, length: alongU, width: alongW }); },
    disc(kind: SurfaceKind, lu: number, lw: number, r: number) { surfaces.push({ kind, ...at(lu, lw), angle: 0, length: 2 * r, width: 2 * r, round: true }); },
  };
}
type Frame = ReturnType<typeof frame>;

/** Brick walls (world/complexes.ts SECTION_TINTS 4 red, 5 terracotta), roof shades (catalogue ROOF_TINTS 1 terracotta, 0 slate). */
const BRICK = 4, TERRACOTTA = 5, LIGHT = 3, RED_ROOF = 1, SLATE = 0;

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
/** The house keeps the back half of the estate, 6 × 3; it faces the garden. Every stage changes the silhouette. */
function house(f: Frame, level: number) {
  f.patch("lawn", 0, 0, 5.9, 2.9);
  const body = [
    { width: 2.5, depth: 1.9, floors: 0, tint: BRICK, roof: .9 },
    { width: 2.9, depth: 2.1, floors: 1, tint: BRICK, roof: 1.05 },
    { width: 3.2, depth: 2.2, floors: 1, tint: BRICK, roof: 1.15 },
    { width: 3.2, depth: 2.2, floors: 1, tint: BRICK, roof: 1.15 },
    { width: 3.5, depth: 2.3, floors: 1, tint: TERRACOTTA, roof: 1.25 },
  ][level - 1];
  const x = -1.1, w = -.25, height = (body.floors + 1) * .75;
  f.put("cottage", x, w, 0, { variant: body.floors, width: body.width, depth: body.depth, tint: body.tint });
  f.put("roof", x, w, 0, { scale: body.roof, width: body.width + .3, depth: body.depth + .3, tint: RED_ROOF, lift: height });
  // The path from the door to the garden; a porch from the second stage, a front wing with its own gable at the last.
  f.patch("walk", x, 1.15, .7, .7);
  if (level >= 2) {
    f.put("cottage", x, w + body.depth / 2 + .22, 0, { variant: 0, width: level === 5 ? 1.5 : 1, depth: .5, tint: body.tint });
    f.put("roof", x, w + body.depth / 2 + .22, 0, { scale: .35, width: level === 5 ? 1.7 : 1.2, depth: .7, tint: RED_ROOF, lift: .75 });
  }
  if (level === 5) f.put("roof", x, w + .55, Math.PI / 2, { scale: .7, width: 1.1, depth: 1.6, tint: RED_ROOF, lift: height });
  f.put("bush", -2.75, 1.1, 0, { scale: .6 });
  if (level === 1) { f.put("tree-round", 1.6, -.4, .4, { scale: .8 }); f.put("bush", .7, 1.0, 1, { scale: .5 }); return; }
  // A fence of hedges along the sides.
  for (const lw of [-.9, .15]) { f.put("hedge", -2.85, lw, Math.PI / 2, { width: 1, scale: .9 }); f.put("hedge", 2.85, lw, Math.PI / 2, { width: 1, scale: .9 }); }
  if (level < 4) {
    // The yard beside the house: a playground-sized patch, then a terrace with furniture and a garden.
    f.patch("plaza", 1.5, level === 2 ? .3 : 0, level === 2 ? 1.5 : 2, level === 2 ? 1.2 : 2.2);
    f.put("tree-round", 2.35, -1.0, .4, { scale: .75 });
    f.put("bench", 1.3, level === 2 ? .3 : .55, Math.PI, { width: .9, scale: .85 });
    if (level === 3) { f.put("planter", .75, -.75, 0, { width: .5 }); f.put("flowerbed", 2.2, .85, 0, { width: .6, scale: .55 }); f.put("flowerbed", 1.6, -.85, 1, { width: .6, scale: .5 }); f.put("gazebo", 1.75, -.25, 0, { width: .8, scale: .3 }); }
    return;
  }
  // A garage with a driveway to the street side; more planting along the fence.
  f.put("cottage", 1.85, -.35, 0, { variant: 0, width: 1.55, depth: 2.0, tint: LIGHT });
  f.put("roof", 1.85, -.35, 0, { scale: .45, width: 1.75, depth: 2.2, tint: SLATE, lift: .75 });
  f.patch("asphalt", 1.85, 1.0, 1.2, .9);
  f.put("bush", .55, -1.2, 0, { scale: .55 }); f.put("bush", .55, .9, 1, { scale: .55 }); f.put("flowerbed", -2.4, -1.1, 0, { width: .6, scale: .5 });
  if (level === 5) {
    // The little fountain before the door, lamps for the evening and a garden behind the garage.
    f.disc("plaza", .2, 1.05, .42); f.put("fountain", .2, 1.05, 0, { width: .7, scale: .36 });
    f.put("lamp", -2.4, 1.25, 0); f.put("lamp", .75, 1.3, 0); f.put("flowerbed", 2.6, -1.25, 2, { width: .6, scale: .45 });
  }
}
/** The skyscraper keeps a whole 4 × 4 lot from the first stage, so it never needs land it does not have. */
function tower(f: Frame, level: number) {
  f.patch("plaza", 0, 0, 5.9, 5.9);
  const [base, upper, top] = [[2, 2.4, 0], [3, 2.6, 0], [3, 3.0, 2.2], [3, 3.2, 2.6]][level - 1];
  f.put("glass-tower", 0, -.9, 0, { variant: 0, width: level > 1 ? 4.8 : 4.2, depth: 3.4, tint: 1 });
  f.put("glass-tower", 0, -1, 0, { variant: base, width: upper, depth: upper, tint: 0 });
  if (level >= 2) f.put("glass-tower", level === 2 ? 1.9 : -1.95, -.7, 0, { variant: level === 2 ? 1 : 2, width: 1.5, depth: 2, tint: 2 });
  if (level >= 3) {
    // Setbacks with planted terraces on each step.
    f.put("glass-tower", 0, -1, 0, { variant: 4, width: top, depth: top, tint: 3, lift: 16.2 });
    for (const [u, w] of [[-1.1, -2.1], [1.1, .1]]) f.put("planter", u, w, 0, { width: .5, lift: 16.2 });
  }
  if (level === 4) {
    f.put("glass-tower", 0, -1, 0, { variant: 5, width: 2, depth: 2, tint: 0, lift: 23.4 });
    f.put("roof", 0, -1, 0, { scale: 3.4, width: .55, depth: .55, tint: SLATE, lift: 30.6 });
    f.disc("walk", 0, 2, .9); f.put("fountain", 0, 2, 0, { width: 1.2, scale: .6 });
    f.put("lamp", -2.5, 2.5, 0); f.put("lamp", 2.5, 2.5, 0);
  }
  f.put("planter", -2.4, 1.6, 0, { width: .5 }); f.put("planter", 2.4, 1.6, 0, { width: .5 });
  if (level >= 2) { f.put("flowerbed", -1.2, 2.4, 0, { width: .6, scale: .55 }); f.put("flowerbed", 1.2, 2.4, 1, { width: .6, scale: .55 }); }
}
const BUILD: Record<EstateFamily, (f: Frame, level: number) => void> = { square, gazebo, fountain, sports, park, house, tower };

/** What stands on one building at its level: copies for the instance pools and ground patches, all inside its footprint. */
export function objectLayout(module: Pick<ModuleSlot, "x" | "z" | "rotation">, item: EstateItem): Layout {
  const f = frame(module, item.family, item.u, item.v, item.rotation);
  BUILD[item.family](f, Math.max(1, Math.min(FAMILY_LEVELS[item.family], item.level)));
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

/** A module's ground: paving round it, its lawn or square, the paths between estates and trees along its edges. */
export function moduleGround(module: ModuleSlot): Layout {
  const placements: Placement[] = [], surfaces: Surface[] = [], s = Math.sin(module.rotation), c = Math.cos(module.rotation), h = MODULE / 2;
  const at = (lu: number, lw: number) => ({ x: module.x + c * lu + s * lw, z: module.z - s * lu + c * lw });
  const patch = (kind: SurfaceKind, lu: number, lw: number, alongU: number, alongW: number) => surfaces.push({ kind, ...at(lu, lw), angle: module.rotation + Math.PI / 2, length: alongU, width: alongW });
  patch("walk", 0, 0, MODULE + 2.2, MODULE + 2.2);
  if (module.kind === "business") patch("plaza", 0, 0, MODULE - .2, MODULE - .2);
  else patch("lawn", 0, 0, MODULE - .2, MODULE - .2);
  // Free land is a lawn: an estate gets its borders once someone lives there (estateBorder). The public square has a cross of walks.
  if (module.kind === "public") { patch("plaza", 0, 0, 1.1, MODULE - .2); patch("plaza", 0, 0, MODULE - .2, 1.1); }
  // Trees in the paving round the module, clear of its corners' walks.
  for (const k of [-.66, 0, .66]) for (const [u, w] of [[k * h, h + .75], [k * h, -h - .75], [h + .75, k * h], [-h - .75, k * h]]) {
    placements.push({ kind: module.kind === "business" ? "planter" : "tree-round", variant: placements.length, ...at(u, w), rotation: u + w, scale: module.kind === "business" ? 1 : .8, width: module.kind === "business" ? .5 : 0 });
  }
  return { placements, surfaces };
}

/** The paths round an estate (or a tower lot) someone holds: thin paving just inside its edges. */
export function estateBorder(module: Pick<ModuleSlot, "x" | "z" | "rotation">, u0: number, v0: number): Surface[] {
  const surfaces: Surface[] = [], side = LOT_CELLS * CELL, kind: SurfaceKind = "plaza";
  const centre = cellPoint(module, u0 + LOT_CELLS / 2, v0 + LOT_CELLS / 2), s = Math.sin(module.rotation), c = Math.cos(module.rotation);
  for (const [lu, lw, alongU, alongW] of [[0, side / 2 - .11, side, .22], [0, -side / 2 + .11, side, .22], [side / 2 - .11, 0, .22, side], [-side / 2 + .11, 0, .22, side]]) {
    surfaces.push({ kind, x: centre.x + c * lu + s * lw, z: centre.z - s * lu + c * lw, angle: module.rotation + Math.PI / 2, length: alongU, width: alongW });
  }
  return surfaces;
}

// ---- placement preview -------------------------------------------------------------------------------------

/** What the operator owns in their district: the estate's and the tower lot's first cells. */
export interface OwnLand { district: number; estate: { module: number; u: number; v: number } | null; tower: { module: number; u: number; v: number } | null }
export interface Placing { family: EstateFamily; module: number; u: number; v: number; rotation: number }

/**
 * Why a building cannot stand there, as the server would say it (app/services/city_estate.py personal_cells),
 * or null: the preview turns red with the reason, and the server checks everything again.
 */
export function placementProblem(p: Placing, modules: ModuleSlot[], land: OwnLand, occupied: (module: number, u: number, v: number) => boolean, publicLand = false): string | null {
  const module = modules.find(m => m.slot === p.module);
  if (!module) return "Этого квартала в районе нет";
  const [w, h] = footprint(p.family, p.rotation), cells: [number, number][] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) cells.push([p.u + i, p.v + j]);
  if (cells.some(([u, v]) => u < 0 || v < 0 || u >= MODULE_CELLS || v >= MODULE_CELLS)) return "Постройка выходит за границы квартала";
  if (publicLand) {
    if (module.kind !== "public") return "Общие проекты строят на общественной земле района";
  } else if (p.family === "tower") {
    if (module.kind !== "business") return "Небоскрёбы строят в деловом квартале района";
    if (p.u % LOT_CELLS || p.v % LOT_CELLS) return "Небоскрёб занимает целый деловой участок 4 × 4";
  } else {
    if (module.kind === "public") return "Это общественная земля района";
    if (!land.estate || land.estate.module !== p.module) return "Строить можно только на своей усадьбе";
    const { u: eu, v: ev } = land.estate, rows = p.family === "house" ? [ev, ev + HOUSE_ROWS] : [ev + HOUSE_ROWS, ev + LOT_CELLS];
    if (cells.some(([u, v]) => u < eu || u >= eu + LOT_CELLS || v < rows[0] || v >= rows[1])) return p.family === "house" ? "Дом стоит в задней части усадьбы" : "Постройка должна целиком помещаться в саду усадьбы";
  }
  if (cells.some(([u, v]) => occupied(p.module, u, v))) return p.family === "tower" ? "Этот деловой участок уже занят" : "Эти клетки уже заняты";
  return null;
}
