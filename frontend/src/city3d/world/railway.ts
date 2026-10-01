/**
 * The railway between the two cities: in each a terminus at the edge of the town and a short line out into a
 * tunnel bored in the hills round it, so the train never crosses the centre. Pure data (no three.js), shared by
 * the relief (the cutting in front of the portal, world/relief.ts), the generators (nothing of the town stands
 * on the line), the district land (world/estates.ts) and the station's models (systems/departmentWorld.ts).
 */
import type { Placement, Point, Road, Surface } from "./types";

/**
 * A line from the buffer stop at (x, z) along the unit direction (dx, dz) to the face of the hill the tunnel
 * enters, `length` farther on. The station stands on the `side` of the track: +1 towards (-dz, dx), -1 the
 * other way. Every line runs straight out from the city, so the hill's face meets it square.
 */
export interface RailLine { x: number; z: number; dx: number; dz: number; length: number; side: 1 | -1 }

/** A line along the ray at `degrees` from the city's centre: the buffer stop `from` out, the hill's face `length` beyond. */
function ray(degrees: number, from: number, length: number, side: 1 | -1): RailLine {
  const a = degrees * Math.PI / 180;
  return { x: Math.cos(a) * from, z: Math.sin(a) * from, dx: Math.cos(a), dz: Math.sin(a), length, side };
}

/**
 * Support (x4): beside the avenue that runs out to the hills towards +x, on its south side, the station between
 * them; the face where the hills past the horizon stand about 12 high (58 past it). v1 the same on its smaller
 * map, where the hills stay lower. Sales: south of the frame's bottom street, on the axis of the boulevard from
 * the lake, the face 62 past the town's edge.
 */
export const RAIL_LINES = {
  x4: ray(-.73, 290, 88, 1),
  v1: ray(-5.5, 130, 80, 1),
  sales: { x: 4, z: 128, dx: 0, dz: 1, length: 56, side: 1 },
} satisfies Record<string, RailLine>;

/**
 * The station in the line's coordinates (u along the track from the buffer stop, w across it, positive on the
 * station's side): the forecourt across the end of the track, the station building behind it (its middle at
 * `building` along and `middle` across) on a floor slab out to the platform, which runs beside the track from
 * `platform` to `end`.
 */
export const STATION = {
  forecourt: -16, building: -7.6, platform: -1.5, end: 22,
  /** Across: from the far side of the track to the building's outer end, and the building's middle. */
  near: -5, far: 12.5, middle: 4,
  /** The floor slab and the platform stand this high over the ground: the floor of railway-station.glb. */
  floor: .53,
};
/**
 * The cutting: its floor half as wide as this beside the track, banks of 1 : BANK rising from there, steepening to
 * rock walls of 1 : ROCK over the last ROCK_RUN before the face, so the face stays close round the portal.
 */
export const CUT_HALF = 4.5, BANK = 1.4, ROCK = .55, ROCK_RUN = 14;

/**
 * The portal model (frontend/src/pages/city/models/railway-portal.glb, scripts/prepare_railway_portal.py) stands
 * with its origin on the track at the rail top PORTAL_AT before the hill's face, its hood reaching through the
 * face. Its low side walls run WALLS.length back along the cutting from the origin, from WALLS.inner to
 * WALLS.outer across and WALLS.top high: behind them the ground keeps to their top.
 */
export const PORTAL_AT = 3.5, WALLS = { length: 24.2, inner: 4.4, outer: 5.45, top: 1.5 };
/** The rail top over the ground (systems/departmentWorld.ts: ballast and rails). */
export const RAIL_TOP = .3;
/**
 * The hole in the hill's face the hood fills: half its outline as (across, height over the rail top), between
 * the bore's opening and the hood's outer edge where the face cuts the model (measured on the model and checked
 * by world/railway.test.mjs), straight down at its sides. Through it the bore is open; the hood hides its edge.
 */
export const PORTAL_HOLE: readonly (readonly [number, number])[] = [
  [0, 6], [1, 5.85], [2, 5.55], [3, 4.9], [3.5, 4.35], [4, 3.8], [4.5, 3.4], [5, 3], [5.3, 3],
];
/** The hole's top at `w` across the track (over the rail top), or null outside it. */
export function portalHole(w: number): number | null {
  const a = Math.abs(w), last = PORTAL_HOLE[PORTAL_HOLE.length - 1];
  if (a >= last[0]) return null;
  const k = PORTAL_HOLE.findIndex(([x]) => x > a), [x0, h0] = PORTAL_HOLE[k - 1], [x1, h1] = PORTAL_HOLE[k];
  return h0 + (h1 - h0) * (a - x0) / (x1 - x0);
}

/** (x, z) in the line's coordinates. */
export function railLocal(line: RailLine, x: number, z: number) {
  const px = x - line.x, pz = z - line.z;
  return { u: px * line.dx + pz * line.dz, w: (pz * line.dx - px * line.dz) * line.side };
}
/** The world point at `u` along the track and `w` across it. */
export function railPoint(line: RailLine, u: number, w = 0): Point {
  return { x: line.x + line.dx * u - line.dz * line.side * w, z: line.z + line.dz * u + line.dx * line.side * w };
}
/** Direction of the track as `rotation` (atan2(dx, dz)), the way placements and the station's models turn. */
export const railHeading = (line: RailLine) => Math.atan2(line.dx, line.dz);

/** Does (x, z) lie, with `pad` to spare, on the station or the track out to the hill (the tunnel's part excepted)? */
export function onRailway(line: RailLine, p: Point, pad: number) {
  const { u, w } = railLocal(line, p.x, p.z);
  if (u < STATION.forecourt - pad || u > line.length + pad) return false;
  if (u <= STATION.end + pad && w >= STATION.near - pad && w <= STATION.far + pad) return true;
  return Math.abs(w) <= CUT_HALF + pad;
}

/**
 * Past the face the hill comes down to the portal: from the hole's outline over the bore (the hood fills the hole)
 * and from the cutting's walls beside it, the ground rises RISE for every unit into the hill until it meets the
 * hill's own height. At 1 : 1 the slope stays grass (render/mountains.ts paints steeper ones as rock).
 */
export const RISE = 1;

/**
 * The highest the ground may stand at (x, z) for the railway: level (0) on the station's yard and the cutting's
 * floor, banks rising from them, and past the face the slope down to the portal.
 */
export function railCut(line: RailLine, x: number, z: number) {
  const { u, w } = railLocal(line, x, z);
  if (u < line.length) return cutting(line, u, w);
  // Beside the hole the hood's shoulders keep to its lowest until the cutting's walls rise past them.
  const hole = portalHole(w) ?? PORTAL_HOLE[PORTAL_HOLE.length - 1][1];
  return Math.max(cutting(line, line.length, w), RAIL_TOP + hole) + (u - line.length) * RISE;
}
function cutting(line: RailLine, u: number, w: number) {
  const yard = Math.hypot(Math.max(0, STATION.forecourt - u, u - STATION.end), Math.max(0, STATION.near - w, w - STATION.far));
  const track = Math.hypot(Math.max(0, Math.abs(w) - CUT_HALF), Math.max(0, STATION.forecourt - u));
  const near = Math.min(1, Math.max(0, (u - (line.length - ROCK_RUN)) / ROCK_RUN)), slope = BANK + (ROCK - BANK) * near;
  // The floor's edge belongs to the floor, whatever rounding puts it a hair outside.
  const walled = u > line.length - PORTAL_AT - WALLS.length && Math.abs(w) > CUT_HALF + 1e-6;
  return Math.min(yard / BANK, walled ? WALLS.top + Math.max(0, Math.abs(w) - WALLS.outer) / slope : track / slope);
}

/** The line as a corridor for laying out district land: the track from the forecourt to the face, and its half width. */
export function railRoad(line: RailLine): { road: Road; half: number } {
  const a = railPoint(line, STATION.forecourt), b = railPoint(line, line.length);
  return { road: [a.x, a.z, b.x, b.z], half: CUT_HALF };
}
/** The station's footprint as an axis-aligned box (with `pad`), for the land rules' kept-out boxes. */
export function stationBox(line: RailLine, pad = 0) {
  const corners = [[STATION.forecourt, STATION.near], [STATION.end, STATION.near], [STATION.end, STATION.far], [STATION.forecourt, STATION.far]].map(([u, w]) => railPoint(line, u, w));
  return { x0: Math.min(...corners.map(c => c.x)) - pad, z0: Math.min(...corners.map(c => c.z)) - pad, x1: Math.max(...corners.map(c => c.x)) + pad, z1: Math.max(...corners.map(c => c.z)) + pad };
}

/**
 * The generated town without what stood on the railway: houses, trees, lamps and their gardens. One pad for
 * every copy, so the pieces of one house go together.
 */
export function clearRailway(world: { placements: Placement[]; surfaces: Surface[] }, line: RailLine) {
  world.placements = world.placements.filter(p => !onRailway(line, p, 2.5));
  world.surfaces = world.surfaces.filter(s => !onRailway(line, s, Math.max(s.length, s.width) / 2 + 1));
}
