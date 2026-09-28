/**
 * Residential complexes (ЖК) in the bands of CitySpec.complexes, as data like the rest of world/.
 *
 * Each complex is a perimeter of sections round a courtyard, stepped down towards the canal: an arch in the
 * middle of the canal-side wing opens the yard to the water, big complexes also have passages through their
 * ends, and the corners of the far wing rise a class higher. Inside, a walk runs round the yard; the rest is
 * cells: a playground (slide, swings, sandbox, a climbing frame in big yards), a sports court (football goals
 * or basketball hoops, painted lines), a garden (lawn, paths to a round plaza with a flower bed, benches,
 * trees and bushes) and a grove (trees of several kinds, benches, a gazebo in big yards). Lamps light the
 * yard and the walk round the outside; between two complexes a driveway with parked cars runs out to the
 * ring road, and a stretch too short for a complex becomes a small square.
 *
 * Business quarters take the half of the city facing `business.angle` (the skyline): glass towers on a
 * podium at the back of the plot, lower by the water and higher out towards the skyline; in front, a plaza
 * with a fountain on a promenade lined by an alley of trees, benches and lamps, lawns with flower beds and
 * hedges, a cross alley on deep plots. Both halves share the paving, the trees, the lamps and the driveways,
 * so they read as one city. Ring alleys (tree-lined walks with benches) run between bands.
 *
 * Every complex lies inside its band and clear of the directions `blocked` returns (avenues, zone sectors,
 * car parks), and each straight complex is pulled in so its outer corners stay inside the curved band.
 */
import type { ComplexBand } from "./worldSpec";
import type { Complex, ParkingLot, Placement, PlacementKind, Point, Surface, SurfaceKind } from "./types";

const TAU = Math.PI * 2;
/** Sections are about this wide along the facade: three windows a floor. */
export const SECTION_WIDTH = 3.2;
/** Floors of the section classes, each FLOOR high. */
export const SECTION_FLOORS = [3, 4, 5, 7, 9, 12, 16], FLOOR = .75;
/**
 * Section shades (assets/catalogue.ts SECTION_TINTS): townhouses in brick and render colours, houses in render or
 * brick, towers light or in the two green shades that plant their balconies.
 */
const ROW_TINTS = [2, 4, 5, 6, 7, 9, 10, 11], HOUSE_TINTS = [0, 1, 2, 3, 4, 6, 7], TOWER_TINTS = [0, 1, 3, 8, 12, 13];
/** Outside a complex: paving this far from the walls, walkers .6 out, lamps 1.35 out (clear of the walkers). */
export const OUTSIDE = 1.6;
const WALK_OUT = .6, LAMP_OUT = 1.35;
/** Inside: walkers .55 from the walls, the yard's cells from 1.1 in. */
const WALK_IN = .55, CELLS_IN = 1.1;
/** Office towers: floors of each class, OFFICE_FLOOR high. */
export const OFFICE_FLOORS = [3, 8, 12, 18, 26, 34], OFFICE_FLOOR = .9;
/** Stalls of the driveway car parks: 1.1 apart, as in the other car parks. */
const STALL = 1.1;
const TREES: PlacementKind[] = ["tree-round", "tree-oak", "tree-birch", "tree-cone"];

/** A rectangle to keep other things out of: centre, the direction of its length and its half sizes. */
export interface Rect { x: number; z: number; ux: number; uz: number; halfLength: number; halfWidth: number }
export function insideRect(p: Point, r: Rect, pad = 0) {
  const dx = p.x - r.x, dz = p.z - r.z, along = dx * r.ux + dz * r.uz, across = dz * r.ux - dx * r.uz;
  return Math.abs(along) <= r.halfLength + pad && Math.abs(across) <= r.halfWidth + pad;
}

export interface ComplexLayout {
  complexes: Complex[]; placements: Placement[]; surfaces: Surface[];
  /** Closed loops for walkers: round every yard and round the outside of every complex. */
  walks: Point[][];
  /** The driveways between complexes, as car parks. */
  parking: ParkingLot[];
  /** Where the rows of houses, blocks, parks and trees must now stay out. */
  keepOut: Rect[];
  /** Ring alleys: arcs of `radius` from `from` to `to` (radians). */
  alleys: { radius: number; from: number; to: number }[];
}

/** A local frame: u along the ring (t), v outwards (n), from the centre (cx, cz). */
interface Frame { cx: number; cz: number; tx: number; tz: number; nx: number; nz: number }
const frameAt = (r: number, a: number): Frame => ({ cx: Math.cos(a) * r, cz: Math.sin(a) * r, tx: -Math.sin(a), tz: Math.cos(a), nx: Math.cos(a), nz: Math.sin(a) });
const at = (f: Frame, u: number, v: number): Point => ({ x: f.cx + f.tx * u + f.nx * v, z: f.cz + f.tz * u + f.nz * v });
/** A local direction in the world. */
const dir = (f: Frame, du: number, dv: number): Point => ({ x: f.tx * du + f.nx * dv, z: f.tz * du + f.nz * dv });
/** Yaw that turns a model's +x along `d` (sections), or its front (+z) towards `d` (furniture, cars). */
const along = (d: Point) => Math.atan2(-d.z, d.x), facing = (d: Point) => Math.atan2(d.x, d.z);

/**
 * Lays out the complexes of every band. `blocked` lists the directions [angle, half width] that something
 * crosses between two radii (the band with its outside walk); `rings` are the ring roads the driveways reach.
 */
export function layoutComplexes(bands: readonly ComplexBand[], random: () => number, blocked: (r0: number, r1: number) => [number, number][], rings: readonly number[],
  options: { business?: { angle: number }; alleys?: readonly number[] } = {}): ComplexLayout {
  const out: ComplexLayout = { complexes: [], placements: [], surfaces: [], walks: [], parking: [], keepOut: [], alleys: [] };
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length) % items.length];
  const put = (kind: PlacementKind, f: Frame, u: number, v: number, rotation: number, extra: Partial<Placement> = {}) =>
    out.placements.push({ kind, variant: Math.floor(random() * 1e4), ...at(f, u, v), rotation, scale: 1, width: 0, ...extra });
  const patch = (kind: SurfaceKind, f: Frame, u0: number, u1: number, v0: number, v1: number) => {
    const c = at(f, (u0 + u1) / 2, (v0 + v1) / 2);
    out.surfaces.push({ kind, x: c.x, z: c.z, angle: Math.atan2(f.tx, f.tz), length: u1 - u0, width: v1 - v0 });
  };
  const disc = (kind: SurfaceKind, f: Frame, u: number, v: number, r: number) => {
    const c = at(f, u, v);
    out.surfaces.push({ kind, x: c.x, z: c.z, angle: 0, length: 2 * r, width: 2 * r, round: true });
  };
  const tree = (f: Frame, u: number, v: number, size = 1) => put(pick(TREES), f, u, v, random() * TAU, { scale: size * (.8 + random() * .4) });

  // The business half of the city faces options.business.angle.
  const isBusiness = (a: number) => !!options.business && Math.abs(Math.atan2(Math.sin(a - options.business.angle), Math.cos(a - options.business.angle))) < Math.PI / 2;
  for (const band of bands) for (const [a0, a1] of openRuns(band.from - OUTSIDE, band.to + OUTSIDE)) fillRun(band, a0, a1);
  for (const radius of options.alleys ?? []) for (const [a0, a1] of openRuns(radius - 2, radius + 2)) alley(radius, a0, a1);
  return out;

  /** The open runs of directions between two radii: the blocked directions as sorted, merged spans in [0, 2π), and the gaps between. */
  function openRuns(r0: number, r1: number): [number, number][] {
    const spans: [number, number][] = [];
    for (const [angle, half] of blocked(r0, r1)) {
      const start = ((angle - half) % TAU + TAU) % TAU, end = start + 2 * half;
      if (end > TAU) spans.push([start, TAU], [0, end - TAU]); else spans.push([start, end]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const span of spans) { const last = merged[merged.length - 1]; if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]); else merged.push([...span]); }
    if (!merged.length) return [[0, TAU]];
    const runs: [number, number][] = [];
    merged.forEach(([, end], i) => { const next = merged[(i + 1) % merged.length][0] + (i === merged.length - 1 ? TAU : 0); if (next - end > 1e-6) runs.push([end, next]); });
    return runs;
  }

  /** A ring alley at `radius` from a0 to a1: a paved walk between two rows of trees, benches facing it, lamps. */
  function alley(radius: number, a0: number, a1: number) {
    const arc = (a1 - a0) * radius;
    if (arc < 6) return;
    // One kind of tree the whole way, for a proper alley: every 2.6 on both sides, a bench or a lamp in some gaps.
    const kind = pick(["tree-round", "tree-oak"] as PlacementKind[]), trees = Math.floor((arc - 1) / 2.6);
    for (let k = 0; k < trees; k++) {
      const f = frameAt(radius, a0 + (.5 + (k + .5) * (arc - 1) / trees) / radius);
      for (const side of [-1, 1]) put(kind, f, 0, side * 1.7, random() * TAU, { scale: 1.05 + random() * .2 });
      if (k % 3 === 1) put("bench", f, 0, (k % 2 ? 1 : -1) * 1.15, facing(dir(f, 0, k % 2 ? -1 : 1)), { width: .8 });
      if (k % 3 === 2) put("lamp", f, 0, (k % 2 ? -1 : 1) * 1.25, 0);
    }
    // The walk itself, in pieces of about two units of arc, and lawn under the trees.
    const pieces = Math.ceil(arc / 2);
    for (let k = 0; k < pieces; k++) {
      const f = frameAt(radius, a0 + (k + .5) * arc / pieces / radius), half = arc / pieces / 2 + .05;
      patch("lawn", f, -half, half, -2.3, 2.3); patch("plaza", f, -half, half, -.85, .85);
    }
    out.alleys.push({ radius, from: a0, to: a1 });
  }

  /** Complexes with driveways between them along one open run, or a square if none fits. */
  function fillRun(band: ComplexBand, a0: number, a1: number) {
    const rin = band.from, rout = band.to, gap = band.gap, usable = (a1 - a0) * rin - 1.6;
    let count = Math.max(0, Math.round((usable + gap) / (band.length + gap)));
    const lengthOf = (n: number) => n ? (usable - (n - 1) * gap) / n : 0;
    if (count && lengthOf(count) > band.length * 1.3) count++;
    while (count && lengthOf(count) < band.length * .6) count--;
    if (!count) { if (usable > 6) square(band, (a0 + a1) / 2, usable); return; }
    const length = lengthOf(count), start = a0 + .8 / rin;
    for (let k = 0; k < count; k++) {
      // Pulled in by the bulge of the straight outer wall, so its corners stay inside the band.
      const bulge = rout - Math.sqrt(rout * rout - length * length / 4), depth = rout - rin - bulge, a = start + (k * (length + gap) + length / 2) / rin;
      // Everything a quarter lays out carries its number, so the group city can build it up (world/sites.ts).
      const placements = out.placements.length, surfaces = out.surfaces.length, business = !!band.office && isBusiness(a);
      if (business) office(band, frameAt(rin + depth / 2, a), length, depth, a);
      else complex(band, frameAt(rin + depth / 2, a), length, depth);
      const site = out.complexes.length - 1;
      out.complexes[site].business = business;
      for (let i = placements; i < out.placements.length; i++) out.placements[i].site = site;
      for (let i = surfaces; i < out.surfaces.length; i++) out.surfaces[i].site = site;
      if (k < count - 1) driveway(band, start + ((k + 1) * (length + gap) - gap / 2) / rin);
    }
  }

  /**
   * A residential quarter after the open blocks of ZILART, Copenhagen and Amsterdam: separate buildings round a
   * yard instead of one wall, each with its own height, colour and roof, green gaps between them. Along the
   * front (towards the canal) a row of narrow townhouses in brick and render shades with gabled roofs; at the
   * ends mid-rise houses; at the back a longer house with a garden on its roof and, at one end, a slim tower,
   * sometimes with planted balconies (Bosco Verticale). Heights step up from the front to the back.
   */
  function complex(band: ComplexBand, f: Frame, length: number, depth: number) {
    const w = band.wing, grid = band.yard === "grid", hu = length / 2, hv = depth / 2, yu = hu - w, yv = hv - w;
    const [front, sides, back] = band.floors, top = SECTION_FLOORS.length - 1;
    patch("walk", f, -hu - OUTSIDE, hu + OUTSIDE, -hv - OUTSIDE, hv + OUTSIDE);
    // Front: townhouses, 2.3–2.9 wide each, in runs of 2–4 with gaps; every house its own shade and gable.
    const row = pieces(-hu, hu, 5.5, 10, 1.8, 3);
    gapTrees(f, row, -hv + w / 2, true, w);
    for (const [a, b] of row) {
      const n = Math.max(2, Math.round((b - a) / 2.6)), unit = (b - a) / n;
      for (let i = 0; i < n; i++) {
        const u = a + unit * (i + .5), variant = Math.min(top, front + (random() < .35 ? 1 : 0)), height = SECTION_FLOORS[variant] * FLOOR;
        out.placements.push({ kind: "section", variant, ...at(f, u, -hv + w / 2), rotation: along(dir(f, 1, 0)), scale: 1, width: unit + .02, depth: w, tint: pick(ROW_TINTS) });
        out.placements.push({ kind: "roof", variant: 0, ...at(f, u, -hv + w / 2), rotation: along(dir(f, 1, 0)), scale: Math.min(1.5, unit * .5), width: unit + .12, depth: w + .3, tint: pick([0, 1, 2, 3, 4]), lift: height });
      }
    }
    // Ends: one house each, mid-rise, over the middle of the side (open corners).
    for (const side of [-1, 1]) {
      const span = Math.min(2 * yv - 2.4, Math.max(5, yv * 1.2));
      house(f, side * (hu - w / 2), -span / 2, span / 2, false, w, Math.min(top, sides + (random() < .4 ? 1 : 0)), pick(HOUSE_TINTS));
      gapTrees(f, [[-yv - 1, -span / 2], [span / 2, yv + 1]], side * (hu - w / 2), false, w);
    }
    // Back: a long house and a slim tower at one end, with a green gap between them.
    const towerAtEnd = random() < .5 ? -1 : 1, towerLength = Math.min(5.2, length * .2), gap = 2.4;
    const [b0, b1] = towerAtEnd < 0 ? [-hu + towerLength + gap, hu - 1.2] : [-hu + 1.2, hu - towerLength - gap];
    const houses = pieces(b0, b1, 7, 14, 2, 3.2), towerU = towerAtEnd * (hu - towerLength / 2);
    for (const [a, b] of houses) house(f, hv - w / 2, a, b, true, w, Math.min(top, back + (random() < .3 ? -1 : 0)), pick(HOUSE_TINTS), true);
    gapTrees(f, towerAtEnd < 0 ? [[-hu, -hu + towerLength], ...houses] : [...houses, [hu - towerLength, hu]], hv - w / 2, true, w);
    out.placements.push({ kind: "section", variant: Math.min(top, back + 2), ...at(f, towerU, hv - w / 2), rotation: along(dir(f, 1, 0)), scale: 1, width: towerLength, depth: w, tint: pick(TOWER_TINTS) });
    out.walks.push(loop(f, yu - WALK_IN, yv - WALK_IN), loop(f, hu + WALK_OUT, hv + WALK_OUT));
    // Lamps along both long sides outside, young trees in planters between them.
    const spans = Math.max(1, Math.round((length - 5) / 8));
    for (const side of [-1, 1]) for (let k = 0; k <= spans; k++) put("lamp", f, -hu + 2.5 + k * (length - 5) / spans, side * (hv + LAMP_OUT), 0);
    for (const side of [-1, 1]) for (let k = 0; k < spans; k++) put("planter", f, -hu + 2.5 + (k + .5) * (length - 5) / spans, side * (hv + LAMP_OUT), random() * TAU, { width: .6 });

    const cu = yu - CELLS_IN, cv = yv - CELLS_IN;
    if (!grid) {
      const path = .9, cell = (2 * cu - 2 * path) / 3, ends = random() < .5 ? ["play", "court"] : ["court", "play"];
      if (random() < .3) ends[ends.indexOf("court")] = "grove";
      yard(ends[0], f, -cu, -cu + cell, -cv, cv); yard("garden", f, -cell / 2, cell / 2, -cv, cv); yard(ends[1], f, cu - cell, cu, -cv, cv);
    } else {
      const path = 1.2, kinds = ["play", "court", "garden", "grove"];
      for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
      yard(kinds[0], f, -cu, -path / 2, -cv, -path / 2); yard(kinds[1], f, path / 2, cu, -cv, -path / 2);
      yard(kinds[2], f, -cu, -path / 2, path / 2, cv); yard(kinds[3], f, path / 2, cu, path / 2, cv);
    }
    out.complexes.push({ x: f.cx, z: f.cz, angle: Math.atan2(f.tx, f.tz), length, depth });
    out.keepOut.push({ x: f.cx, z: f.cz, ux: f.tx, uz: f.tz, halfLength: hu + OUTSIDE + .3, halfWidth: hv + OUTSIDE + .3 });
  }

  /**
   * A business quarter: glass offices at the back of the plot (towers on a podium where the band has one,
   * slabs by the water), a promenade with an alley of trees and a fountain in front, and on deep plots a
   * cross alley to the entrance with lawns, flower beds and hedges in the quarters it leaves.
   */
  function office(band: ComplexBand, f: Frame, length: number, depth: number, angle: number) {
    const hu = length / 2, hv = depth / 2, spec = band.office!, tint = Math.floor(random() * 4);
    patch("walk", f, -hu - OUTSIDE, hu + OUTSIDE, -hv - OUTSIDE, hv + OUTSIDE);
    // Towers rise towards the skyline: the top class at its direction, the lowest at the edge of the half.
    const off = options.business ? Math.abs(Math.atan2(Math.sin(angle - options.business.angle), Math.cos(angle - options.business.angle))) / (Math.PI / 2) : 0;
    const [low, high] = spec.towers, top = Math.max(low, Math.round(high - (high - low) * off));
    const back = Math.min(depth * .42, 11), front = hv - back, lift = spec.podium ? OFFICE_FLOORS[0] * OFFICE_FLOOR : 0, U = dir(f, 1, 0);
    if (spec.podium) put("glass-tower", f, 0, hv - back / 2, along(U), { variant: 0, width: length - 2, depth: back, tint });
    const count = length >= 26 ? 2 : 1, width = Math.min(10, (length - 4) / count - 2), deep = Math.min(back - 1.2, 9.5);
    for (let k = 0; k < count; k++) {
      const u = count === 2 ? (k ? 1 : -1) * length / 4 + (random() - .5) : 0, variant = Math.max(1, top - (k % 2));
      put("glass-tower", f, u, hv - back / 2 + (spec.podium ? (random() - .5) * .6 : 0), along(U), { variant, width, depth: deep, tint, lift });
    }
    out.walks.push(loop(f, hu + WALK_OUT, hv + WALK_OUT));
    const spans = Math.max(1, Math.round((length - 5) / 8));
    for (let k = 0; k <= spans; k++) put("lamp", f, -hu + 2.5 + k * (length - 5) / spans, -hv - LAMP_OUT, 0);

    // The promenade across the front, a fountain in the middle, an alley of one kind of tree along both sides.
    const v0 = -hv, v1 = front - .7, vp = (v0 + v1) / 2, kind = pick(["tree-round", "tree-oak", "tree-birch"] as PlacementKind[]);
    patch("plaza", f, -hu, hu, vp - 1.2, vp + 1.2);
    for (const side of [-1, 1]) if (Math.abs(side * 1.9) + .6 < (v1 - v0) / 2 + .6) patch("lawn", f, -hu + .3, hu - .3, vp + (side > 0 ? 1.25 : -2.55), vp + (side > 0 ? 2.55 : -1.25));
    disc("plaza", f, 0, vp, 2.2);
    put("fountain", f, 0, vp, 0, { width: 1.9 });
    const trees = Math.max(2, Math.floor((length - 2) / 2.6));
    for (let k = 0; k < trees; k++) {
      const u = -hu + 1 + (k + .5) * (length - 2) / trees;
      if (Math.abs(u) < 2.8) continue;
      for (const side of [-1, 1]) {
        const v = vp + side * 1.9;
        if (v > v0 + .5 && v < v1) put(kind, f, u, v, random() * TAU, { scale: 1 + random() * .2 });
      }
      if (k % 2 === 0) put("bench", f, u + 1.3, vp + (k % 4 ? 1.35 : -1.35), facing(dir(f, 0, k % 4 ? -1 : 1)), { width: .8 });
      else if (k % 4 === 1) put("lamp", f, u + 1.3, vp + 1.35, 0);
    }
    // Walkers stroll the promenade on both sides of the fountain.
    for (const side of [-1, 1]) {
      const g = { ...f, ...(({ x, z }) => ({ cx: x, cz: z }))(at(f, side * (hu / 2 + 1.3), vp)) };
      if (hu / 2 - 2.2 > 1.5) out.walks.push(loop(g, hu / 2 - 2.2, .75, .5));
    }
    // Deep plots: a cross alley from the promenade to the entrance, and gardens in the quarters beside it.
    if (v1 - (vp + 2.6) > 4) {
      patch("plaza", f, -1, 1, vp + 1.2, v1 + .7);
      for (let v = vp + 3.4; v < v1 - .4; v += 2.6) for (const side of [-1, 1]) put(kind, f, side * 1.75, v, random() * TAU, { scale: 1 + random() * .2 });
      for (const side of [-1, 1]) {
        const u0 = side > 0 ? 2.8 : -hu + .5, u1 = side > 0 ? hu - .5 : -2.8, q0 = vp + 2.8, q1 = v1 - .3;
        if (u1 - u0 < 3 || q1 - q0 < 2.5) continue;
        patch("lawn", f, u0, u1, q0, q1);
        const cu = (u0 + u1) / 2, cq = (q0 + q1) / 2;
        put("flowerbed", f, cu, cq, random() * TAU, { width: 1.1 });
        for (const s of [-1, 1]) put("bench", f, cu + s * 1.25, cq, facing(dir(f, -s, 0)), { width: .8 });
        hedges(f, u0 + .4, u1 - .4, q1 - .3, true);
        for (const s of [-1, 1]) tree(f, cu + s * (u1 - u0) * .32, cq + (q1 - q0) * .25 * (random() < .5 ? 1 : -1), 1.1);
      }
    }
    out.complexes.push({ x: f.cx, z: f.cz, angle: Math.atan2(f.tx, f.tz), length, depth });
    out.keepOut.push({ x: f.cx, z: f.cz, ux: f.tx, uz: f.tz, halfLength: hu + OUTSIDE + .3, halfWidth: hv + OUTSIDE + .3 });
  }

  /** A tree on a patch of lawn in every gap wider than 1.4 between the buildings `list` (sorted) along u (or v) at `fixed`. */
  function gapTrees(f: Frame, list: [number, number][], fixed: number, alongU: boolean, depth: number) {
    for (let k = 1; k < list.length; k++) {
      const a = list[k - 1][1], b = list[k][0], s = (a + b) / 2;
      if (b - a < 1.4) continue;
      if (alongU) patch("lawn", f, a + .1, b - .1, fixed - depth / 2, fixed + depth / 2); else patch("lawn", f, fixed - depth / 2, fixed + depth / 2, a + .1, b - .1);
      tree(f, alongU ? s : fixed, alongU ? fixed : s, 1.15);
      if (b - a > 2.6) put("bush", f, alongU ? s + .8 : fixed + .5, alongU ? fixed + .5 : s + .8, random() * TAU, { scale: .8, width: .6 });
    }
  }
  /** Splits an edge from `from` to `to` into buildings `min`…`max` long with gaps of `gapMin`…`gapMax`. */
  function pieces(from: number, to: number, min: number, max: number, gapMin: number, gapMax: number): [number, number][] {
    const list: [number, number][] = [];
    let a = from;
    while (to - a >= min) {
      let span = min + random() * (max - min);
      if (to - a - span < min + gapMin) span = to - a;
      list.push([a, a + span]);
      a += span + gapMin + random() * (gapMax - gapMin);
    }
    return list;
  }
  /**
   * A mid-rise house from `from` to `to` along u (or v) at `fixed`: sections of about SECTION_WIDTH in one shade;
   * `garden` puts young trees on its flat roof. 
   */
  function house(f: Frame, fixed: number, from: number, to: number, alongU: boolean, depth: number, variant: number, tint: number, garden = false) {
    const span = to - from, n = Math.max(1, Math.round(span / SECTION_WIDTH)), width = span / n, d = alongU ? dir(f, 1, 0) : dir(f, 0, 1), roof = SECTION_FLOORS[variant] * FLOOR;
    for (let i = 0; i < n; i++) {
      const s = from + width * (i + .5), p = alongU ? at(f, s, fixed) : at(f, fixed, s);
      out.placements.push({ kind: "section", variant, ...p, rotation: along(d), scale: 1, width: width + .02, depth, tint });
      // Roof garden: a planter beside each section's stair house.
      if (garden && SECTION_FLOORS[variant] <= 9) { const q = s - width * .25; put("planter", f, alongU ? q : fixed, alongU ? fixed : q, random() * TAU, { width: .6, lift: roof, scale: 1.1 }); }
    }
  }

  /** One cell of a yard, u0…u1 by v0…v1 in the complex's frame. */
  function yard(kind: string, f: Frame, u0: number, u1: number, v0: number, v1: number) {
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, lu = u1 - u0, lv = v1 - v0, big = lu > 8 && lv > 7;
    const U = dir(f, 1, 0), V = dir(f, 0, 1), back = (d: Point) => ({ x: -d.x, z: -d.z });
    // The lamp stands in the corner towards the middle of the yard.
    const lamp = () => put("lamp", f, (cu > 0 ? u0 + .35 : u1 - .35), (cv > 0 ? v0 + .35 : v1 - .35), 0);
    if (kind === "play") {
      patch(random() < .5 ? "play" : "play-blue", f, u0 + .2, u1 - .2, v0 + .2, v1 - .2);
      put("slide", f, cu - lu * .28, cv + lv * .12, facing(U), { width: 1.6 });
      put("swings", f, cu + lu * .18, cv + lv * .24, facing(V), { width: 1.8 });
      put("sandbox", f, cu + lu * .2, cv - lv * .26, facing(V), { width: 1.4 });
      if (big) put("climber", f, cu - lu * .24, cv - lv * .28, facing(U), { width: 1.4 });
      put("bench", f, cu - lu * .24, v0 + .45, facing(V), { width: .8 });
      put("bench", f, cu - lu * .24, v1 - .45, facing(back(V)), { width: .8 });
      if (big) { put("bench", f, u1 - .45, cv, facing(back(U)), { width: .8 }); put("swings", f, cu + lu * .18, cv - lv * .02, facing(V), { width: 1.8 }); }
      lamp();
    } else if (kind === "court") {
      const longU = lu >= lv, long = Math.min((longU ? lu : lv) - .8, 13), short = Math.min((longU ? lv : lu) - .8, long * .62);
      const football = random() < .6, ku = (longU ? long : short) / 2, kv = (longU ? short : long) / 2, t = .07;
      patch(football ? "court" : "court-orange", f, cu - ku, cu + ku, cv - kv, cv + kv);
      patch("line", f, cu - ku, cu + ku, cv - kv, cv - kv + t); patch("line", f, cu - ku, cu + ku, cv + kv - t, cv + kv);
      patch("line", f, cu - ku, cu - ku + t, cv - kv, cv + kv); patch("line", f, cu + ku - t, cu + ku, cv - kv, cv + kv);
      if (longU) patch("line", f, cu - t / 2, cu + t / 2, cv - kv, cv + kv); else patch("line", f, cu - ku, cu + ku, cv - t / 2, cv + t / 2);
      disc("line", f, cu, cv, .14);
      const end = longU ? U : V, reach = long / 2 - .2;
      for (const side of [-1, 1]) put(football ? "goal" : "hoop", f, cu + (longU ? side * reach : 0), cv + (longU ? 0 : side * reach), facing(side > 0 ? back(end) : end), { width: 1.2 });
      // A bench beside the court where there is room.
      const room = ((longU ? lv : lu) - short) / 2;
      if (room >= .6) put("bench", f, cu + (longU ? 0 : -(short / 2 + .36)), cv + (longU ? -(short / 2 + .36) : 0), facing(longU ? V : U), { width: .8 });
      lamp();
    } else if (kind === "garden") {
      patch("lawn", f, u0 + .15, u1 - .15, v0 + .15, v1 - .15);
      const r = Math.min(2.2, Math.max(1.2, Math.min(lu, lv) * .28));
      patch("plaza", f, u0 + .15, u1 - .15, cv - .35, cv + .35); patch("plaza", f, cu - .35, cu + .35, v0 + .15, v1 - .15);
      disc("plaza", f, cu, cv, r);
      // Clipped hedges line the paths from the plaza out to the walk.
      for (const side of [-1, 1]) {
        hedges(f, u0 + .5, cu - r - .25, cv + side * .62, true); hedges(f, cu + r + .25, u1 - .5, cv + side * .62, true);
        hedges(f, v0 + .5, cv - r - .25, cu + side * .62, false); hedges(f, cv + r + .25, v1 - .5, cu + side * .62, false);
      }
      put("flowerbed", f, cu, cv, random() * TAU, { width: 1.1 });
      for (let k = 0; k < 4; k++) { const q = Math.PI / 4 + k * Math.PI / 2; put("bench", f, cu + Math.cos(q) * (r - .35), cv + Math.sin(q) * (r - .35), facing(dir(f, -Math.cos(q), -Math.sin(q))), { width: .8 }); }
      const qu = (r + lu / 2) / 2 + .1, qv = (r + lv / 2) / 2;
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        tree(f, cu + su * qu, cv + sv * qv);
        put("bush", f, cu + su * (lu / 2 - .45), cv + sv * (lv / 2 - .45), random() * TAU, { scale: .7 + random() * .4, width: .6 });
      }
      put("lamp", f, cu + r + .55, cv + .6, 0);
    } else {
      patch("lawn", f, u0 + .15, u1 - .15, v0 + .15, v1 - .15);
      if (big) {
        put("gazebo", f, cu, cv, facing(U), { width: 2.4 });
        disc("plaza", f, cu, cv, 1.9);
        patch("plaza", f, cu > 0 ? u0 + .15 : cu, cu > 0 ? cu : u1 - .15, cv - .35, cv + .35);
        for (const side of [-1, 1]) put("bench", f, cu, cv + side * 2.35, facing(side > 0 ? back(V) : V), { width: .8 });
      } else {
        patch("plaza", f, u0 + .15, u1 - .15, cv - .35, cv + .35);
        put("bench", f, cu - lu * .2, cv - .72, facing(V), { width: .8 });
        put("bench", f, cu + lu * .2, cv + .72, facing(back(V)), { width: .8 });
        hedges(f, cu - lu * .2 + .8, u1 - .5, cv - .62, true); hedges(f, u0 + .5, cu + lu * .2 - .8, cv + .62, true);
      }
      const rows = lv > 7 ? 3 : 2, cols = Math.max(2, Math.round(lu / 2.6));
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const u = u0 + lu * (i + .5) / cols + (random() - .5) * .5, v = v0 + lv * (j + .5) / rows + (random() - .5) * .4;
        if (Math.abs(v - cv) < 1.15 || (big && Math.hypot(u - cu, v - cv) < 3.2)) continue;
        if (Math.abs(u - u0) < .6 || Math.abs(u1 - u) < .6 || Math.abs(v - v0) < .55 || Math.abs(v1 - v) < .55) continue;
        tree(f, u, v, 1.05);
      }
      lamp();
    }
  }

  /** A row of hedge pieces from s0 to s1 along u (or v) at `fixed`. */
  function hedges(f: Frame, s0: number, s1: number, fixed: number, alongU: boolean) {
    const n = Math.floor((s1 - s0) / 1.05);
    if (n < 1) return;
    const step = (s1 - s0) / n, d = alongU ? dir(f, 1, 0) : dir(f, 0, 1);
    for (let k = 0; k < n; k++) { const s = s0 + step * (k + .5); put("hedge", f, alongU ? s : fixed, alongU ? fixed : s, along(d), { width: .5 }); }
  }

  /** A driveway at angle `a` from the canal-side walk out to the next ring road, with a row of parked cars. */
  function driveway(band: ComplexBand, a: number) {
    const r0 = band.from - OUTSIDE, outer = rings.find(ring => ring > band.to) ?? band.to + OUTSIDE + 1, inner = [...rings].reverse().find(ring => ring < band.from);
    // Out to the ring road next to the band, or to the band's edge where an alley runs instead.
    const from = inner !== undefined && band.from - inner < 6 ? inner + 1 : r0, to = outer - band.to < 6 ? outer - 1 : band.to + OUTSIDE, depth = band.gap - 2 * OUTSIDE;
    const n = { x: Math.cos(a), z: Math.sin(a) }, t = { x: -Math.sin(a), z: Math.cos(a) }, mid = (from + to) / 2, length = to - from;
    const side = random() < .5 ? -1 : 1, stalls: ParkingLot["stalls"] = [];
    // One row nosed towards the lot's side, one stall wide at a time.
    for (let s = -length / 2 + .6; s <= length / 2 - .55; s += STALL) {
      const x = n.x * (mid + s) + t.x * side * (depth / 2 - .75), z = n.z * (mid + s) + t.z * side * (depth / 2 - .75);
      stalls.push({ x, z, rotation: facing({ x: t.x * side, z: t.z * side }) });
    }
    out.parking.push({ x: n.x * mid, z: n.z * mid, angle: Math.atan2(n.x, n.z), length, depth, stalls });
    stalls.forEach((stall, k) => { if (random() < .38) return; out.placements.push({ kind: "car-parked", variant: k * 7 + out.parking.length, x: stall.x, z: stall.z, rotation: stall.rotation, scale: 1, width: 0 }); });
    out.keepOut.push({ x: n.x * mid, z: n.z * mid, ux: n.x, uz: n.z, halfLength: length / 2, halfWidth: depth / 2 + .3 });
  }

  /** A small square where no complex fits: lawn, a path with benches, a flower bed, trees and a lamp. */
  function square(band: ComplexBand, a: number, usable: number) {
    const length = Math.min(usable, band.length), bulge = band.to - Math.sqrt(band.to * band.to - length * length / 4), depth = band.to - band.from - bulge;
    if (depth < 4) return;
    const f = frameAt(band.from + depth / 2, a), hu = length / 2, hv = depth / 2;
    patch("lawn", f, -hu, hu, -hv, hv);
    // In the business half a square is a paved plaza round a fountain.
    const plaza = !!band.office && isBusiness(a) && Math.min(hu, hv) > 2.6;
    if (plaza) disc("plaza", f, 0, 0, Math.min(hu, hv, 4) - .4);
    patch("plaza", f, -hu, hu, -.4, .4);
    if (plaza) put("fountain", f, 0, 0, 0, { width: 1.9 }); else put("flowerbed", f, 0, 0, random() * TAU, { width: 1.1 });
    for (const side of [-1, 1]) {
      put("bench", f, side * Math.min(hu - .8, 2.2), -.8, facing(dir(f, 0, 1)), { width: .8 });
      put("bench", f, side * Math.min(hu - .8, 2.2), .8, facing(dir(f, 0, -1)), { width: .8 });
    }
    put("lamp", f, Math.min(hu - .5, 1.2), .6, 0);
    // A deep square gets a cross path; trees stand in a loose grid clear of the paths and the benches.
    const deep = depth > 12;
    if (deep) {
      patch("plaza", f, -.4, .4, -hv, hv);
      for (const side of [-1, 1]) { put("bench", f, .8, side * hv * .5, facing(dir(f, -1, 0)), { width: .8 }); put("lamp", f, -.6, side * hv * .5 + .9, 0); }
    }
    const cols = Math.max(1, Math.floor(length / 3)), rows = Math.max(2, Math.floor(depth / 3.2));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const u = -hu + length * (i + .5) / cols + (random() - .5) * .6, v = -hv + depth * (j + .5) / rows + (random() - .5) * .5;
      if (Math.abs(v) < 1.5 || (deep && Math.abs(u) < 1.6) || hv - Math.abs(v) < .5 || hu - Math.abs(u) < .5) continue;
      tree(f, u, v, 1.1);
    }
    out.keepOut.push({ x: f.cx, z: f.cz, ux: f.tx, uz: f.tz, halfLength: hu + .3, halfWidth: hv + .3 });
  }
}

/** A closed rounded rectangle (half sizes hu × hv) round the frame's centre, a point every half unit. */
function loop(f: Frame, hu: number, hv: number, corner = .6): Point[] {
  const points: Point[] = [], ku = hu - corner, kv = hv - corner;
  const line = (u0: number, v0: number, u1: number, v1: number) => { const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / .5)); for (let k = 0; k < n; k++) points.push(at(f, u0 + (u1 - u0) * k / n, v0 + (v1 - v0) * k / n)); };
  const arc = (ou: number, ov: number, from: number) => { for (let k = 0; k < 6; k++) { const q = from + k / 6 * Math.PI / 2; points.push(at(f, ou + Math.cos(q) * corner, ov + Math.sin(q) * corner)); } };
  line(-ku, -hv, ku, -hv); arc(ku, -kv, -Math.PI / 2);
  line(hu, -kv, hu, kv); arc(ku, kv, 0);
  line(ku, hv, -ku, hv); arc(-ku, kv, Math.PI / 2);
  line(-hu, kv, -hu, -kv); arc(-ku, -kv, Math.PI);
  return points;
}
