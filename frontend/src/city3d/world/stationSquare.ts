/**
 * The square round each station (world/railway.ts): a street to its forecourt, a car park with parked cars and a
 * small park with a fountain, paths, benches, lamps, flowerbeds and trees. Pure data like the rest of the world:
 * the terrain draws the street, the car park's pad and the park's lawns and paths, the instance pools its cars,
 * trees and furniture. Laid out in the line's coordinates (u along the track from the buffer stop, w across it),
 * on land no district plot takes (world/land.ts keeps it out; world/stationSquare.test.mjs checks it).
 *
 * The island cities (x4, v1): the station street runs across the end of the track in front of the forecourt, from
 * the avenue beside the station to the park; the car park lies behind it, the park beside the track. The lake city
 * (sales): the forecourt already faces the bottom street; a short street off it runs along the station's side to
 * the car park, and the park lies on the station's other side, both between the street and the hills.
 */
import { rng } from "./generate";
import { railHeading, railLocal, railPoint, STATION, type RailLine } from "./railway";
import type { ParkingLot, Placement, PlacementKind, Point, Road, Surface, WorldData } from "./types";

/** A rectangle in the line's coordinates. */
export interface Area { u0: number; u1: number; w0: number; w1: number }
export interface StationSquare {
  streets: Road[]; parking: ParkingLot[]; surfaces: Surface[]; placements: Placement[]; walks: Point[][];
  crosswalks: (Point & { angle: number })[];
  /** What the square covers: the town's houses, trees and gardens there make way for it. */
  areas: Area[];
}

/** Stall spacing and the share of stalls with a car in them; how far round the fountain people walk. */
const STALL = 1.1, TAKEN = .64, WALK = 1.9;

/** The square for a city's station, or null where there is no station. */
export function stationSquare(world: Pick<WorldData, "spec" | "railway" | "roads">): StationSquare | null {
  const line = world.railway;
  if (!line) return null;
  return world.spec.name === "sales" ? lakeSquare(line) : islandSquare(line, world.roads.streets);
}

/** Clears what stood on the square (as world/railway.ts clearRailway does) and lays the square out. */
export function addStationSquare(world: WorldData) {
  const square = stationSquare(world);
  if (!square) return;
  const line = world.railway!;
  world.placements = world.placements.filter(p => !onSquare(line, square, p, 1.5));
  world.surfaces = world.surfaces.filter(s => !onSquare(line, square, s, Math.max(s.length, s.width) / 2 + .5));
  world.roads.streets.push(...square.streets);
  world.roads.parking.push(...square.parking);
  world.roads.crosswalks.push(...square.crosswalks);
  world.surfaces.push(...square.surfaces);
  world.placements.push(...square.placements);
  world.walks.push(...square.walks);
}

/** Does (x, z) lie on the square, with `pad` to spare? */
export function onSquare(line: RailLine, square: Pick<StationSquare, "areas">, p: Point, pad: number) {
  const { u, w } = railLocal(line, p.x, p.z);
  return square.areas.some(a => u > a.u0 - pad && u < a.u1 + pad && w > a.w0 - pad && w < a.w1 + pad);
}

/** Builds a square in the line's frame. */
function planner(line: RailLine, seed: number) {
  const random = rng(seed), heading = railHeading(line), across = heading - line.side * Math.PI / 2;
  const square: StationSquare = { streets: [], parking: [], surfaces: [], placements: [], walks: [], crosswalks: [], areas: [] };
  const at = (u: number, w: number) => railPoint(line, u, w);
  return {
    square, random,
    /** A street from (u, w) to (u, w). */
    street(a: [number, number], b: [number, number]) {
      const p = at(...a), q = at(...b); square.streets.push([p.x, p.z, q.x, q.z]);
    },
    /** A patch over the area, lengthwise along the track. */
    patch(kind: Surface["kind"], a: Area) {
      const c = at((a.u0 + a.u1) / 2, (a.w0 + a.w1) / 2);
      square.surfaces.push({ kind, x: c.x, z: c.z, angle: heading, length: a.u1 - a.u0, width: a.w1 - a.w0 });
    },
    disc(kind: Surface["kind"], u: number, w: number, radius: number) {
      const c = at(u, w); square.surfaces.push({ kind, x: c.x, z: c.z, angle: 0, length: radius * 2, width: radius * 2, round: true });
    },
    /** A copy at (u, w); its front (+z) faces `facing`, the angle in the line's frame from +u towards +w. */
    put(kind: PlacementKind, u: number, w: number, extra: Partial<Placement> = {}, facing = 0) {
      const c = at(u, w);
      square.placements.push({ kind, x: c.x, z: c.z, rotation: heading - line.side * facing, scale: 1, width: 0, variant: Math.floor(random() * 12), ...extra });
    },
    /**
     * A car park over the area: rows of stalls along w (`rowsAlongW`) or along u, two rows nosed towards each
     * aisle as in world/generate.ts, a car in most stalls.
     */
    lot(a: Area, rowsAlongW: boolean) {
      // The pad reaches 0.2 past the lot on every side (render/terrain.ts): the lot is the area less that.
      const c = at((a.u0 + a.u1) / 2, (a.w0 + a.w1) / 2), length = (rowsAlongW ? a.w1 - a.w0 : a.u1 - a.u0) - .4, depth = (rowsAlongW ? a.u1 - a.u0 : a.w1 - a.w0) - .4;
      const angle = rowsAlongW ? across : heading, t = { x: Math.sin(angle), z: Math.cos(angle) }, n = { x: Math.cos(angle), z: -Math.sin(angle) };
      const rows: [number, boolean][] = depth > 6 ? [[-depth / 2 + .95, true], [-.95, false], [.95, true], [depth / 2 - .95, false]] : [[-depth / 2 + .95, true], [depth / 2 - .95, false]];
      const stalls: ParkingLot["stalls"] = [];
      for (const [offset, outward] of rows) for (let s = -length / 2 + .6; s <= length / 2 - .55; s += STALL) {
        stalls.push({ x: c.x + t.x * s + n.x * offset, z: c.z + t.z * s + n.z * offset, rotation: Math.atan2(n.x, n.z) + (outward ? 0 : Math.PI) });
      }
      square.parking.push({ x: c.x, z: c.z, angle, length, depth, stalls });
      const index = square.parking.length - 1;
      stalls.forEach((stall, k) => {
        if (random() > TAKEN) return;
        square.placements.push({ kind: "car-parked", variant: k * 7 + 3 + index, x: stall.x, z: stall.z, rotation: stall.rotation, scale: 1, width: 0 });
      });
      square.areas.push(a);
    },
    /** A park over the area: lawn, a cross of paths meeting at a round plaza with a fountain, and trees round it. */
    park(a: Area, plaza: { u: number; w: number }) {
      const { u: pu, w: pw } = plaza, radius = 3.4;
      this.patch("lawn", a);
      this.patch("walk", { u0: a.u0, u1: a.u1, w0: pw - 1, w1: pw + 1 });
      this.patch("walk", { u0: pu - 1, u1: pu + 1, w0: a.w0, w1: a.w1 });
      this.disc("plaza", pu, pw, radius);
      this.put("fountain", pu, pw, { width: 2.4, scale: 1.2 });
      // Benches at the plaza's edge between the paths, facing the fountain, with a flowerbed behind each.
      for (const k of [1, 3, 5, 7]) {
        const a8 = k * Math.PI / 4, du = Math.cos(a8), dw = Math.sin(a8);
        this.put("bench", pu + du * (radius - .25), pw + dw * (radius - .25), { width: 1.5 }, Math.atan2(-dw, -du));
        this.put("flowerbed", pu + du * (radius + 1.3), pw + dw * (radius + 1.3), { width: 1.4 });
      }
      for (const [du, dw] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) this.put("lamp", pu + du * 1.6, pw + dw * (radius + .2));
      // Lamps where the paths leave the park, trees along its edge and in clumps between the paths.
      for (const [u, w] of [[a.u0 + .8, pw + 1.6], [a.u1 - .8, pw - 1.6], [pu + 1.6, a.w0 + .8], [pu - 1.6, a.w1 - .8]]) this.put("lamp", u, w);
      const kinds: PlacementKind[] = ["tree-round", "tree-oak", "tree-birch", "tree-round", "tree-cone"];
      const tree = (u: number, w: number) => this.put(kinds[Math.floor(this.random() * kinds.length)], u, w, { scale: 1.05 + this.random() * .45 });
      const clear = (u: number, w: number) => Math.abs(w - pw) > 2.4 && Math.abs(u - pu) > 2.4 && Math.hypot(u - pu, w - pw) > radius + 2.6;
      const row = (from: number, to: number) => { const n = Math.max(1, Math.round((to - from) / 3.2)); return Array.from({ length: n + 1 }, (_, k) => from + (to - from) * k / n); };
      for (const u of row(a.u0 + 1.2, a.u1 - 1.2)) for (const w of [a.w0 + 1.2, a.w1 - 1.2]) if (clear(u, w)) tree(u, w);
      for (const w of row(a.w0 + 1.2, a.w1 - 1.2).slice(1, -1)) for (const u of [a.u0 + 1.2, a.u1 - 1.2]) if (clear(u, w)) tree(u, w);
      for (const du of [-1, 1]) for (const dw of [-1, 1]) {
        const u = pu + du * (radius + 4.5), w = pw + dw * (radius + 2.8);
        if (u > a.u0 + 2.5 && u < a.u1 - 2.5 && w > a.w0 + 2.5 && w < a.w1 - 2.5) { tree(u, w); this.put("bush", u + du * 1.4, w - dw * .9, { width: 1 }); }
      }
      // A stroll round the fountain for the town's walkers, between it and the benches (systems/crowd.ts keeps a
      // walk only where nothing stands on it).
      square.walks.push(Array.from({ length: 16 }, (_, k) => at(pu + Math.cos(k / 16 * Math.PI * 2) * WALK, pw + Math.sin(k / 16 * Math.PI * 2) * WALK)));
      square.areas.push(a);
    },
  };
}

/**
 * x4 and v1: the station street across the end of the track at STREET_U, from the avenue on the station's side
 * to the park's corner; the pavement in front of the forecourt; the car park behind the street; the park on the
 * far side of the track, along the yard.
 */
const STREET_U = -20;
function islandSquare(line: RailLine, streets: readonly Road[]): StationSquare {
  const plan = planner(line, 3301), { square } = plan, f = STATION.forecourt;
  // Where the street meets the avenue: the nearest street crossing u = STREET_U past the yard.
  let meet = STATION.far + 4;
  for (const [ax, az, bx, bz] of streets) {
    const a = railLocal(line, ax, az), b = railLocal(line, bx, bz);
    if ((a.u - STREET_U) * (b.u - STREET_U) > 0 || Math.abs(b.u - a.u) < 1e-6) continue;
    const w = a.w + (b.w - a.w) * (STREET_U - a.u) / (b.u - a.u);
    if (w > STATION.far && w < 40 && (meet === STATION.far + 4 || w < meet)) meet = w;
  }
  const end = -12;
  plan.street([STREET_U, meet], [STREET_U, end]);
  square.areas.push({ u0: STREET_U - 1.4, u1: STREET_U + 1.4, w0: end - 1.4, w1: meet });
  const pavement = { u0: STREET_U + 1.33, u1: f, w0: end + 1, w1: STATION.far + .5 };
  plan.patch("walk", pavement); square.areas.push(pavement);
  plan.lot({ u0: STREET_U - 11.73, u1: STREET_U - 1.33, w0: -9.5, w1: 10.5 }, true);
  plan.park({ u0: f - .5, u1: 12, w0: -26, w1: STATION.near - 2.5 }, { u: -3, w: -16.2 });
  return square;
}

/**
 * sales: the bottom street runs past the forecourt; a short street off it along the station's side (towards
 * -w) to the car park beside it, the park on the station's other side, both between the street and the hills,
 * and a zebra crossing from the boulevard to the forecourt.
 */
function lakeSquare(line: RailLine): StationSquare {
  const plan = planner(line, 4402), { square } = plan;
  const street = -18, kerb = street + 1.33, edge = -6.5, spur = STATION.near - 2.6;
  plan.street([street, spur], [edge, spur]);
  square.areas.push({ u0: kerb, u1: edge, w0: spur - 1.4, w1: spur + 1.4 });
  plan.lot({ u0: kerb + .7, u1: edge, w0: spur - 25.6, w1: spur - 1.33 }, true);
  plan.park({ u0: kerb + .7, u1: edge, w0: STATION.far + 2, w1: STATION.far + 27.5 }, { u: (kerb + .7 + edge) / 2, w: STATION.far + 14.75 });
  // On the axis of the boulevard: the town's centre line.
  const cross = railPoint(line, street, railLocal(line, 0, 0).w);
  square.crosswalks.push({ x: cross.x, z: cross.z, angle: railHeading(line) + Math.PI / 2 });
  return square;
}
