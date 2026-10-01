/**
 * The land of the team districts (docs/CITY_ESTATES.md), cut into plots like the properties of a Monopoly board:
 * the whole city goes to three districts and operators buy it plot by plot. The island city's plots run along its
 * ring roads and avenues like the rings of a dartboard, so they cover the round city without gaps and every one
 * lies by a street; the lake city's are squares between its streets. A plot is about PLOT units across.
 *
 * A district's land is blocks (between two ring roads and two avenues, or between streets), each a grid of
 * columns × rows; a plot's address is (district, block, column, row), the same on the server
 * (app/data/city_land.json, written from this file by frontend/scripts/city-land.mjs). Bands count outwards from
 * the centre: land nearer the centre costs more, and a district's next band opens as its inner ones fill up. In
 * every district a few plots near its middle are its centre: the headquarters and the square of its shared
 * projects. Pure data, no three.js.
 */
import { segmentDistance } from "./generate";
import { onRailway } from "./railway";
import { onSquare, stationSquare } from "./stationSquare";
import { polygonsOverlap, segmentPolygonDistance, type ModuleSlot } from "./estates";
import type { Point, Road, WorldData } from "./types";

/** About how wide and deep a plot is; the gap kept from a street's middle line and from a district's border. */
export const PLOT = 9, ROAD_GAP = 1.6, BORDER_GAP = .8;
/**
 * A district's centre, kept from the plots at the front of one block: the headquarters (a site of about 16 × 16)
 * and the public square of its shared projects (a module of 18 × 18, world/estates.ts) side by side, facing the
 * street. As many plots as these units need along the street and across it.
 */
export const CENTRE_WIDTH = 40, CENTRE_DEPTH = 20;

export type LandCity = "support" | "sales";
/** An annular sector (angles counter-clockwise, radians) or an axis-aligned rectangle; columns run along a0 → a1 or x, rows along r or z. */
export type BlockShape = { kind: "ring"; r0: number; r1: number; a0: number; a1: number } | { kind: "rect"; x0: number; x1: number; z0: number; z1: number };
/** A block's sides along a street: a ring block's inner and outer edge and its ends at a0, a1; a rectangle's sides at x0, x1, z0, z1. */
export type BlockSide = "in" | "out" | "a0" | "a1" | "x0" | "x1" | "z0" | "z1";
export interface LandBlock {
  district: number; block: number; band: number; cols: number; rows: number; shape: BlockShape;
  /** Plots that are not for sale ("col:row"): kept for the centre, or where something of the city stands. */
  skip: Set<string>;
  /** The sides with a street along them: plots face the nearest one. */
  streets: Partial<Record<BlockSide, true>>;
}
/**
 * A plot's frame: its middle, its front towards `rotation` (atan2(dx, dz)), width along its row, depth across it,
 * its corners, and whether its front edge lies on the street (or on a neighbour's plot, deeper in the block).
 */
export interface Frame extends Point { rotation: number; width: number; depth: number; corners: Point[]; street: boolean }
export interface LandPlot extends Frame { district: number; block: number; col: number; row: number; band: number }
/** A district's centre: the plots kept for it (`cols` × `rows` from `col`, `row` of its block, their frame `area`), the headquarters' site and the public square. */
export interface DistrictCentre { district: number; block: number; col: number; row: number; cols: number; rows: number; area: Frame; hq: Point & { rotation: number }; square: ModuleSlot }
export interface LandGrid { city: LandCity; bands: number; blocks: LandBlock[]; plots: LandPlot[]; centres: DistrictCentre[] }

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
export const plotKey = (block: number, col: number, row: number) => `${block}:${col}:${row}`;

/**
 * The frame of `cols` × `rows` plots of a block from (col, row): one plot, or a merged park. It faces the nearest
 * street of its block: on the island city's rings the inner or the outer road (the canal and the horizon have
 * none), in the lake city whichever side of its block is nearest; with none, the centre of the city.
 */
export function areaFrame(block: LandBlock, col: number, row: number, cols = 1, rows = 1): Frame {
  const s = block.shape, streets = block.streets;
  if (s.kind === "ring") {
    const dr = (s.r1 - s.r0) / block.rows, da = (s.a1 - s.a0) / block.cols;
    const ra = s.r0 + row * dr, rb = ra + rows * dr, aa = s.a0 + col * da, ab = aa + cols * da, r = (ra + rb) / 2, a = (aa + ab) / 2;
    const corners = [[ra, aa], [ra, ab], [rb, ab], [rb, aa]].map(([rr, an]) => ({ x: Math.cos(an) * rr, z: Math.sin(an) * rr }));
    // The ring roads first: a plot by an avenue faces it only when the avenue is clearly nearer.
    const sides: [BlockSide, number, number, boolean][] = [
      ["in", r - s.r0, Math.atan2(-Math.cos(a), -Math.sin(a)), row === 0], ["out", s.r1 - r, Math.atan2(Math.cos(a), Math.sin(a)), row + rows === block.rows],
      ["a0", (a - s.a0) * r + .6, Math.atan2(Math.sin(a), -Math.cos(a)), col === 0], ["a1", (s.a1 - a) * r + .6, Math.atan2(-Math.sin(a), Math.cos(a)), col + cols === block.cols],
    ];
    const nearest = sides.filter(([side]) => streets[side]).sort((p, q) => p[1] - q[1])[0] ?? sides[0];
    const radial = nearest[0] === "a0" || nearest[0] === "a1";
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, rotation: nearest[2], width: radial ? rb - ra : (ab - aa) * r, depth: radial ? (ab - aa) * r : rb - ra, corners, street: !!streets[nearest[0]] && nearest[3] };
  }
  const dx = (s.x1 - s.x0) / block.cols, dz = (s.z1 - s.z0) / block.rows, xa = s.x0 + col * dx, xb = xa + cols * dx, za = s.z0 + row * dz, zb = za + rows * dz;
  const cx = (xa + xb) / 2, cz = (za + zb) / 2;
  const sides: [BlockSide, number, number, boolean][] = [
    ["z1", s.z1 - cz, 0, row + rows === block.rows], ["z0", cz - s.z0, Math.PI, row === 0],
    ["x1", s.x1 - cx, Math.PI / 2, col + cols === block.cols], ["x0", cx - s.x0, -Math.PI / 2, col === 0],
  ];
  const nearest = sides.filter(([side]) => streets[side]).sort((p, q) => p[1] - q[1])[0];
  const rotation = nearest ? nearest[2] : Math.round(Math.atan2(-cx, -cz) / (Math.PI / 2)) * Math.PI / 2;
  const across = Math.abs(Math.sin(rotation)) > .5;
  return {
    x: cx, z: cz, rotation, width: across ? zb - za : xb - xa, depth: across ? xb - xa : zb - za,
    corners: [{ x: xa, z: za }, { x: xb, z: za }, { x: xb, z: zb }, { x: xa, z: zb }], street: !!nearest?.[3],
  };
}

/** Where a world point lies in a block, in columns (u) and rows (v) from its first corner; null off the block. */
export function blockCell(block: LandBlock, p: Point): { u: number; v: number } | null {
  const s = block.shape;
  let u: number, v: number;
  if (s.kind === "ring") {
    const r = Math.hypot(p.x, p.z), a = s.a0 + wrap(Math.atan2(p.z, p.x) - s.a0);
    u = (a - s.a0) / (s.a1 - s.a0); v = (r - s.r0) / (s.r1 - s.r0);
  } else { u = (p.x - s.x0) / (s.x1 - s.x0); v = (p.z - s.z0) / (s.z1 - s.z0); }
  return u < 0 || u > 1 || v < 0 || v > 1 ? null : { u: u * block.cols, v: v * block.rows };
}

/** The plot under a world point, or null (a street, a plot not for sale, off the land). */
export function plotAt(grid: LandGrid, p: Point): { block: LandBlock; col: number; row: number } | null {
  for (const block of grid.blocks) {
    const at = blockCell(block, p);
    if (!at || at.u >= block.cols || at.v >= block.rows) continue;
    const col = Math.floor(at.u), row = Math.floor(at.v);
    return block.skip.has(`${col}:${row}`) ? null : { block, col, row };
  }
  return null;
}

/** The land of a city's districts: the island city (x4) and the lake city have it, the old v1 map has none. */
export function landGrid(world: WorldData): LandGrid | null {
  if (world.spec.name === "x4") return islandLand(world);
  if (world.spec.name === "sales") return lakeLand(world);
  return null;
}

/** What the server needs of a city's land: every district's blocks with their band, size and plots not for sale (app/data/city_land.json). */
export function landJson(grid: LandGrid) {
  const districts: Record<string, { block: number; band: number; cols: number; rows: number; skip: [number, number][] }[]> = {};
  for (const b of grid.blocks) (districts[b.district] ??= []).push({
    block: b.block, band: b.band, cols: b.cols, rows: b.rows,
    skip: [...b.skip].map(k => k.split(":").map(Number) as [number, number]).sort((p, q) => p[0] - q[0] || p[1] - q[1]),
  });
  for (const list of Object.values(districts)) list.sort((p, q) => p.block - q.block);
  return { bands: grid.bands, districts };
}

/**
 * The island city's mainland, empty for the districts: of the generated town only its roads with their street
 * lamps stay, and the group quarters (drawn apart, world/sites.ts). Its houses, towers, complexes with their
 * yards and walks, trees, parks, the port and the car parks go; the canal, the island ring with its plots
 * (world/plots.ts) and car parks, the forests on the hills beyond the horizon stay. The station and its square
 * are laid out afterwards (world/cities.ts).
 */
export function clearMainland(world: WorldData) {
  const bank = mainlandOf(world).inner, horizon = world.spec.horizon;
  const mainland = (p: Point, pad = 0) => { const r = Math.hypot(p.x, p.z); return r > bank - pad && r < horizon + pad; };
  const streets = world.roads.streets, rings = world.roads.rings;
  // A street lamp stands by its road; a lamp off the roads lit a yard or a park that is gone.
  const byRoad = (p: Point) => rings.some(r => Math.abs(Math.hypot(p.x, p.z) - r) < 1.6) || streets.some(road => segmentDistance(p.x, p.z, road) < 1.6);
  world.placements = world.placements.filter(p => !mainland(p, .5) || (p.kind === "lamp" && byRoad(p)));
  world.surfaces = world.surfaces.filter(s => !mainland(s, Math.max(s.length, s.width) / 2));
  world.parks = world.parks.filter(p => !mainland(p, 2.2));
  world.roads.parking = world.roads.parking.filter(lot => !mainland(lot, (lot.length + lot.depth) / 2));
  world.complexes = []; world.alleys = []; world.walks = [];
}

/** The island city's mainland: the widest ring of land, from the canal's far bank to the horizon. */
const mainlandOf = (world: WorldData) => world.land.annuli.reduce((best, a) => a.outer - a.inner > best.outer - best.inner ? a : best);

/**
 * Grows the grid: blocks get their number within their district and their plots, each kept clear of the streets
 * and checked against `clear`. A block looks only at the streets near it, so the whole city takes a few tens of ms.
 */
function builder(streets: readonly Road[], clear: (corners: Point[], centre: Point) => boolean) {
  const blocks: LandBlock[] = [], counts = [0, 0, 0, 0];
  return {
    blocks,
    add(district: number, band: number, shape: BlockShape, cols: number, rows: number, sides: Partial<Record<BlockSide, true>>) {
      if (cols < 1 || rows < 1) return null;
      const block: LandBlock = { district, block: ++counts[district], band, cols, rows, shape, skip: new Set(), streets: sides };
      // The block's corners, padded by its outer arc's bulge, find the streets that may come near its plots.
      const bulge = shape.kind === "ring" ? shape.r1 * (1 - Math.cos((shape.a1 - shape.a0) / 2)) : 0;
      const near = streets.filter(road => segmentPolygonDistance(road, areaFrame(block, 0, 0, cols, rows).corners) < bulge + ROAD_GAP + 1);
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        const f = areaFrame(block, c, r);
        if (!offStreets(near, f.corners) || !clear(f.corners, f)) block.skip.add(`${c}:${r}`);
      }
      blocks.push(block);
      return block;
    },
    /** Keeps the plots of the district's centre at the front of a block, in the middle of its street side towards the city's centre, and returns it. */
    centre(block: LandBlock): DistrictCentre {
      const s = block.shape;
      // Along the street (the plot's width) and across it; the front is the side with the street.
      let along: "col" | "row", frontHigh: boolean, width: number, depth: number;
      if (s.kind === "ring") { along = "col"; frontHigh = !block.streets.in; width = (s.a1 - s.a0) / block.cols * (frontHigh ? s.r1 : s.r0); depth = (s.r1 - s.r0) / block.rows; }
      else {
        // Of the sides with a street, the one that looks towards the middle of the city.
        const mx = (s.x0 + s.x1) / 2, mz = (s.z0 + s.z1) / 2, m = Math.hypot(mx, mz) || 1;
        const normals: [BlockSide, number, number][] = [["x0", -1, 0], ["x1", 1, 0], ["z0", 0, -1], ["z1", 0, 1]];
        const [side] = normals.filter(([k]) => block.streets[k]).sort((p, q) => (q[1] * -mx + q[2] * -mz) / m - (p[1] * -mx + p[2] * -mz) / m)[0] ?? ["z1"];
        const dx = (s.x1 - s.x0) / block.cols, dz = (s.z1 - s.z0) / block.rows, across = side === "x0" || side === "x1";
        along = across ? "row" : "col"; width = across ? dz : dx; depth = across ? dx : dz; frontHigh = side === "x1" || side === "z1";
      }
      const count = along === "col" ? block.cols : block.rows, deep = along === "col" ? block.rows : block.cols;
      const n = Math.min(count, Math.ceil(CENTRE_WIDTH / width - 1e-9)), m = Math.min(deep, Math.ceil(CENTRE_DEPTH / depth - 1e-9));
      const k0 = Math.floor((count - n) / 2), j0 = frontHigh ? deep - m : 0;
      const [c0, r0, nc, nr] = along === "col" ? [k0, j0, n, m] : [j0, k0, m, n];
      for (let c = c0; c < c0 + nc; c++) for (let r = r0; r < r0 + nr; r++) block.skip.add(`${c}:${r}`);
      // The headquarters on one half, the public square on the other, both facing the street.
      const area = areaFrame(block, c0, r0, nc, nr), sin = Math.sin(area.rotation), cos = Math.cos(area.rotation), side = area.width / 4;
      const at = (lu: number) => ({ x: area.x + cos * lu, z: area.z - sin * lu });
      return {
        district: block.district, block: block.block, col: c0, row: r0, cols: nc, rows: nr, area,
        hq: { ...at(-side), rotation: area.rotation }, square: { district: block.district, slot: 0, kind: "public", ...at(side), rotation: area.rotation },
      };
    },
    plots(): LandPlot[] {
      return blocks.flatMap(b => {
        const out: LandPlot[] = [];
        for (let c = 0; c < b.cols; c++) for (let r = 0; r < b.rows; r++) if (!b.skip.has(`${c}:${r}`)) out.push({ ...areaFrame(b, c, r), district: b.district, block: b.block, col: c, row: r, band: b.band });
        return out;
      });
    },
  };
}

/** Is the polygon clear of every street by ROAD_GAP? */
const offStreets = (streets: readonly Road[], corners: Point[]) => streets.every(road => segmentPolygonDistance(road, corners) >= ROAD_GAP - .25);
const rectangle = (x: number, z: number, angle: number, length: number, depth: number, pad: number): Point[] => {
  const s = Math.sin(angle), c = Math.cos(angle), l = length / 2 + pad, d = depth / 2 + pad;
  return [[-l, -d], [l, -d], [l, d], [-l, d]].map(([a, b]) => ({ x: x + s * a + c * b, z: z + c * a - s * b }));
};

/**
 * The island city: bands between the canal bank, the mainland ring roads and the horizon, cut by the avenues into
 * blocks. Three districts of about equal size: two borders on the avenues at BORDERS[0] and BORDERS[2], the third
 * through the middle of the block between the avenues round BORDERS[1]; where an avenue does not reach a band (the
 * ones starting at the first ring road), the border runs as a footpath.
 */
const BORDERS = [-32.7 * DEG, 90 * DEG, -146.7 * DEG];
function islandLand(world: WorldData): LandGrid {
  const line = world.railway, square = stationSquare(world), streets = world.roads.streets;
  // What stays of the city on the mainland: the station with its square, the group quarters, the training centres' car parks.
  const sites = world.sites.map(s => rectangle(s.x, s.z, s.angle, s.length, s.depth, 1.6));
  const clear = (corners: Point[], centre: Point) => {
    if (line && [...corners, centre].some(p => onRailway(line, p, 1) || (square ? onSquare(line, square, p, 1) : false))) return false;
    return sites.every(site => !polygonsOverlap(corners, site));
  };
  const b = builder(streets, clear);
  const mainland = mainlandOf(world);
  const rings = world.roads.rings.filter(r => r > mainland.inner && r < mainland.outer);
  const edges = [mainland.inner + 1.2, ...rings.flatMap(r => [r - ROAD_GAP, r + ROAD_GAP]), mainland.outer - 1.5];
  const borders = BORDERS.map(wrap), districtOf = (a: number) => {
    // District k runs counter-clockwise from borders[k - 1] to borders[k] (wrapping round).
    const x = wrap(a), order = [...borders].sort((p, q) => p - q);
    const start = [...order].reverse().find(o => o <= x) ?? order[order.length - 1];
    return borders.indexOf(start) + 1;
  };
  for (let k = 0; k + 1 < edges.length; k += 2) {
    const band = k / 2 + 1, r0 = edges[k], r1 = edges[k + 1], rm = (r0 + r1) / 2, rows = Math.max(1, Math.round((r1 - r0) / PLOT));
    // Radial lines across the band: the avenues that reach it, and the district borders; each with its gap.
    const cuts = streets.filter(([ax, az, bx, bz]) => Math.min(Math.hypot(ax, az), Math.hypot(bx, bz)) < r0 + 1 && Math.max(Math.hypot(ax, az), Math.hypot(bx, bz)) > r1 - 1)
      .map(([ax, az]) => ({ a: wrap(Math.atan2(az, ax)), gap: ROAD_GAP }));
    for (const border of borders) if (!cuts.some(c => Math.abs(wrap(c.a - border + Math.PI) - Math.PI) < .02)) cuts.push({ a: border, gap: BORDER_GAP });
    cuts.sort((p, q) => p.a - q.a);
    // The block round the middle border is cut in two by it; the borders on avenues are the avenues themselves.
    for (let i = 0; i < cuts.length; i++) {
      const from = cuts[i], to = cuts[(i + 1) % cuts.length], a0 = from.a + from.gap / rm, a1 = (i + 1 < cuts.length ? to.a : to.a + TAU) - to.gap / rm;
      if (a1 <= a0) continue;
      const cols = Math.max(1, Math.round((a1 - a0) * rm / PLOT));
      // The canal before the first band and the horizon past the last have no road; a district border is a footpath.
      const sides: Partial<Record<BlockSide, true>> = {};
      if (k > 0) sides.in = true;
      if (k + 2 < edges.length) sides.out = true;
      if (from.gap === ROAD_GAP) sides.a0 = true;
      if (to.gap === ROAD_GAP) sides.a1 = true;
      b.add(districtOf((a0 + a1) / 2), band, { kind: "ring", r0, r1, a0, a1 }, cols, rows, sides);
    }
  }
  // Each district's centre: in the second band, in the block nearest the middle of the district's sector.
  const centres = [1, 2, 3].flatMap(d => {
    const from = borders[d - 1], middle = from + wrap(borders[d % 3] - from) / 2;
    const block = b.blocks.filter(x => x.district === d && x.band === 2).sort((p, q) => angular(midOf(p), middle) - angular(midOf(q), middle))[0];
    return block ? [b.centre(block)] : [];
  });
  return { city: "support", bands: edges.length / 2, blocks: b.blocks, plots: b.plots(), centres };
}
const angular = (a: number, b: number) => Math.abs(wrap(a - b + Math.PI) - Math.PI);
const midOf = (block: LandBlock) => block.shape.kind === "ring" ? (block.shape.a0 + block.shape.a1) / 2 : 0;

/**
 * The lake city: the frame of streets round the lake holds its blocks. District 1 has the top band, 2 the left
 * band and the bottom left, 3 the right band and the bottom right; the boulevard from the lake to the station
 * parts the bottom band. Bands: the corners of the inner square by the lake, the frame, the strips outside it.
 */
function lakeLand(world: WorldData): LandGrid {
  const line = world.railway, square = stationSquare(world), streets = world.roads.streets, rect = world.land.rectangle!;
  const lake = (rect.lake ?? 46) + 12, pier = rectangle(4, 48, 0, 44, 18, 0), boulevard = rectangle(0, 85, 0, 60, 10.4, 0);
  const clear = (corners: Point[], centre: Point) => {
    if (corners.some(p => Math.hypot(p.x, p.z) < lake)) return false;
    if (polygonsOverlap(corners, pier) || polygonsOverlap(corners, boulevard)) return false;
    return !(line && [...corners, centre].some(p => onRailway(line, p, 1) || (square ? onSquare(line, square, p, 1) : false)));
  };
  const b = builder(streets, clear), hx = rect.width / 2 - 1, hz = rect.depth / 2 - 1;
  const xs = [...new Set(streets.filter(([ax, , bx]) => ax === bx).map(([x]) => x))].sort((p, q) => p - q);
  const zs = [...new Set(streets.filter(([, az, , bz]) => az === bz).map(([, z]) => z))].sort((p, q) => p - q);
  const [outerX, innerX] = [xs[xs.length - 1], xs[xs.length - 2]], [outerZ, innerZ] = [zs[zs.length - 1], zs[zs.length - 2]];
  const g = ROAD_GAP;
  /** Does a street run along the side at `at` (x = at, or z = at) from `from` to `to`, ROAD_GAP out? */
  const along = (vertical: boolean, at: number, from: number, to: number) => streets.some(([ax, az, bx, bz]) => vertical
    ? ax === bx && Math.abs(Math.abs(ax - at) - g) < .01 && Math.min(az, bz) <= from + 1 && Math.max(az, bz) >= to - 1
    : az === bz && Math.abs(Math.abs(az - at) - g) < .01 && Math.min(ax, bx) <= from + 1 && Math.max(ax, bx) >= to - 1);
  const add = (district: number, band: number, x0: number, x1: number, z0: number, z1: number) => {
    const cols = Math.max(1, Math.round((x1 - x0) / PLOT)), rows = Math.max(1, Math.round((z1 - z0) / PLOT));
    const sides: Partial<Record<BlockSide, true>> = {};
    if (along(true, x0, z0, z1)) sides.x0 = true;
    if (along(true, x1, z0, z1)) sides.x1 = true;
    if (along(false, z0, x0, x1)) sides.z0 = true;
    if (along(false, z1, x0, x1)) sides.z1 = true;
    return b.add(district, band, { kind: "rect", x0, x1, z0, z1 }, cols, rows, sides);
  };
  // Band 1: the corners of the inner square, round the lake.
  add(1, 1, -innerX + g, -g, -innerZ + g, -g); add(1, 1, g, innerX - g, -innerZ + g, -g);
  add(2, 1, -innerX + g, -g, g, innerZ - g); add(3, 1, g, innerX - g, g, innerZ - g);
  // Band 2: the frame between the inner square and the outer streets.
  const top = [add(1, 2, -outerX + g, -innerX - g, -outerZ + g, -innerZ - g), add(1, 2, -innerX + g, innerX - g, -outerZ + g, -innerZ - g), add(1, 2, innerX + g, outerX - g, -outerZ + g, -innerZ - g)];
  const left = add(2, 2, -outerX + g, -innerX - g, -innerZ + g, innerZ - g), right = add(3, 2, innerX + g, outerX - g, -innerZ + g, innerZ - g);
  add(2, 2, -outerX + g, -innerX - g, innerZ + g, outerZ - g); add(2, 2, -innerX + g, -g, innerZ + g, outerZ - g);
  add(3, 2, g, innerX - g, innerZ + g, outerZ - g); add(3, 2, innerX + g, outerX - g, innerZ + g, outerZ - g);
  // Band 3: the strips between the outer streets and the edge of the land.
  add(1, 3, -outerX + g, outerX - g, -hz, -outerZ - g);
  add(2, 3, -hx, -outerX - g, -outerZ + g, outerZ - g); add(2, 3, -outerX + g, -g, outerZ + g, hz);
  add(3, 3, outerX + g, hx, -outerZ + g, outerZ - g); add(3, 3, g, outerX - g, outerZ + g, hz);
  const centres = [top[1], left, right].filter((x): x is LandBlock => !!x).map(block => b.centre(block));
  return { city: "sales", bands: 3, blocks: b.blocks, plots: b.plots(), centres };
}

