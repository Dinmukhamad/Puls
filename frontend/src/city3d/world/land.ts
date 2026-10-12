/**
 * The land of the team districts (docs/CITY_ESTATES.md): the whole city goes to three districts, and each district
 * is cut into small cells that its operators build on. A district has no roads of its own: its operators lay them,
 * a cell at a time, together with footpaths, trees, lamps, benches and the rest (world/decor.ts), and a house, an
 * office tower or a square stands on CELLS × CELLS cells, about PLOT units across, wherever it fits on one block.
 *
 * The island city's cells run in rings, as its plots did before: each band of each district is one block, its
 * columns along the ring and its rows outwards, between the canal bank, the circles where the ring roads ran and the
 * horizon. The lake city's blocks are rectangles round the lake, between the lines where its streets ran. A cell's
 * address is (district, block, column, row), the same on the server (app/data/city_land.json, written from this file
 * by frontend/scripts/city-land.mjs). Bands count outwards from the centre and set the price of land. In every
 * district a few cells near its middle are its centre, where its main building grows. Pure data, no three.js.
 */
import { segmentDistance } from "./generate";
import { onRailway } from "./railway";
import { onSquare, stationSquare } from "./stationSquare";
import { polygonsOverlap, segmentPolygonDistance, type ModuleSlot } from "./estates";
import type { Point, Road, WorldData } from "./types";

/**
 * A building's plot is CELLS × CELLS cells, about PLOT units across; the gap kept from what is left of the streets
 * (the station's), and between two districts.
 */
export const CELLS = 3, PLOT = 9, ROAD_GAP = 1.6, BORDER_GAP = .8;
/**
 * A district's centre, kept from the cells at the front of one block: the main building grows there (a site of up to
 * 18 × 18, world/districtLandmark.ts), beside the public square of the districts' old shared projects (a module of
 * 18 × 18, world/estates.ts). As many cells as these units need along the front and across it.
 */
export const CENTRE_WIDTH = 40, CENTRE_DEPTH = 20;

export type LandCity = "support" | "sales";
/** An annular sector (angles counter-clockwise, radians) or an axis-aligned rectangle; columns run along a0 → a1 or x, rows along r or z. */
export type BlockShape = { kind: "ring"; r0: number; r1: number; a0: number; a1: number } | { kind: "rect"; x0: number; x1: number; z0: number; z1: number };
/**
 * A side of an area of cells: on a ring the inner and outer edge and the ends at a0 and a1, on a rectangle the sides at
 * x0, x1, z0 and z1. In a block's own terms: "in"/"z0" before the first row, "out"/"z1" past the last, "a0"/"x0"
 * before the first column, "a1"/"x1" past the last.
 */
export type BlockSide = "in" | "out" | "a0" | "a1" | "x0" | "x1" | "z0" | "z1";
/** The four ways out of a cell, in its block's own terms: back a row, on a row, back a column, on a column. */
export type Way = "row-" | "row+" | "col-" | "col+";
export const WAYS: readonly Way[] = ["row-", "row+", "col-", "col+"];
export interface LandBlock {
  district: number; block: number; band: number; cols: number; rows: number; shape: BlockShape;
  /** Cells that are not for sale ("col:row"): the district's centre, or where something of the city stands. */
  skip: Set<string>;
}
/**
 * An area's frame: its middle, its front towards `rotation` (atan2(dx, dz)), width along its front, depth across it,
 * its corners (the first column's first row, the last column's, the last column's last row, the first column's), and
 * whether a road runs along its front, so a path or a driveway goes out to it.
 */
export interface Frame extends Point { rotation: number; width: number; depth: number; corners: Point[]; street: boolean }
export interface LandCell extends Frame { district: number; block: number; col: number; row: number; band: number }
/** A district's centre: the cells kept for it (`cols` × `rows` from `col`, `row` of its block, their frame `area`), the headquarters' site and the public square. */
export interface DistrictCentre { district: number; block: number; col: number; row: number; cols: number; rows: number; area: Frame; hq: Point & { rotation: number }; square: ModuleSlot }
export interface LandGrid { city: LandCity; bands: number; blocks: LandBlock[]; centres: DistrictCentre[] }

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
export const cellKey = (block: number, col: number, row: number) => `${block}:${col}:${row}`;

/** The side of `ways` and of a block's shape: which edge of an area a way leaves by. */
export function sideOf(block: LandBlock, way: Way): BlockSide {
  const ring = block.shape.kind === "ring";
  return way === "row-" ? (ring ? "in" : "z0") : way === "row+" ? (ring ? "out" : "z1") : way === "col-" ? (ring ? "a0" : "x0") : (ring ? "a1" : "x1");
}
/** The way out of a block's area by its side. */
export function wayOf(side: BlockSide): Way {
  return side === "in" || side === "z0" ? "row-" : side === "out" || side === "z1" ? "row+" : side === "a0" || side === "x0" ? "col-" : "col+";
}

/**
 * The side an area of a block looks to when nothing else decides: towards the middle of the city. On a ring that is
 * its inner edge; on a rectangle whichever side faces the city's centre most.
 */
export function homeSide(block: LandBlock, col: number, row: number, cols = 1, rows = 1): BlockSide {
  const s = block.shape;
  if (s.kind === "ring") return "in";
  const dx = (s.x1 - s.x0) / block.cols, dz = (s.z1 - s.z0) / block.rows;
  const cx = s.x0 + (col + cols / 2) * dx, cz = s.z0 + (row + rows / 2) * dz;
  return Math.abs(cx) > Math.abs(cz) ? (cx > 0 ? "x0" : "x1") : (cz > 0 ? "z0" : "z1");
}
/** The four sides in turn, a quarter turn apart: a building's `rotation` turns its front this many steps from its home side. */
const TURNS: Record<"ring" | "rect", BlockSide[]> = { ring: ["in", "a1", "out", "a0"], rect: ["z1", "x1", "z0", "x0"] };
export function turnedSide(block: LandBlock, home: BlockSide, rotation: number): BlockSide {
  const cycle = TURNS[block.shape.kind], at = cycle.indexOf(home);
  return cycle[(at + ((rotation % 4) + 4) % 4) % 4];
}

/**
 * The frame of `cols` × `rows` cells of a block from (col, row): one cell, a building's plot or a merged park. Its
 * front looks to `side` (by default towards the middle of the city); `street` says a road runs along that front.
 */
export function areaFrame(block: LandBlock, col: number, row: number, cols = 1, rows = 1, side: BlockSide = homeSide(block, col, row, cols, rows), street = false): Frame {
  const s = block.shape;
  if (s.kind === "ring") {
    const dr = (s.r1 - s.r0) / block.rows, da = (s.a1 - s.a0) / block.cols;
    const ra = s.r0 + row * dr, rb = ra + rows * dr, aa = s.a0 + col * da, ab = aa + cols * da, r = (ra + rb) / 2, a = (aa + ab) / 2;
    const corners = [[ra, aa], [ra, ab], [rb, ab], [rb, aa]].map(([rr, an]) => ({ x: Math.cos(an) * rr, z: Math.sin(an) * rr }));
    const rotation = side === "out" ? Math.atan2(Math.cos(a), Math.sin(a)) : side === "a0" ? Math.atan2(Math.sin(a), -Math.cos(a)) : side === "a1" ? Math.atan2(-Math.sin(a), Math.cos(a)) : Math.atan2(-Math.cos(a), -Math.sin(a));
    const radial = side === "a0" || side === "a1";
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, rotation, width: radial ? rb - ra : (ab - aa) * r, depth: radial ? (ab - aa) * r : rb - ra, corners, street };
  }
  const dx = (s.x1 - s.x0) / block.cols, dz = (s.z1 - s.z0) / block.rows, xa = s.x0 + col * dx, xb = xa + cols * dx, za = s.z0 + row * dz, zb = za + rows * dz;
  const rotation = side === "z0" ? Math.PI : side === "x1" ? Math.PI / 2 : side === "x0" ? -Math.PI / 2 : 0;
  const across = side === "x0" || side === "x1";
  return {
    x: (xa + xb) / 2, z: (za + zb) / 2, rotation, width: across ? zb - za : xb - xa, depth: across ? xb - xa : zb - za,
    corners: [{ x: xa, z: za }, { x: xb, z: za }, { x: xb, z: zb }, { x: xa, z: zb }], street,
  };
}

/** The corners of `cols` × `rows` cells of a block from (col, row), in areaFrame's order, without the rest of the frame. */
export function areaCorners(block: LandBlock, col: number, row: number, cols = 1, rows = 1): Point[] {
  const s = block.shape;
  if (s.kind === "ring") {
    const dr = (s.r1 - s.r0) / block.rows, da = (s.a1 - s.a0) / block.cols, ra = s.r0 + row * dr, rb = ra + rows * dr, aa = s.a0 + col * da, ab = aa + cols * da;
    const ca = Math.cos(aa), sa = Math.sin(aa), cb = Math.cos(ab), sb = Math.sin(ab);
    return [{ x: ca * ra, z: sa * ra }, { x: cb * ra, z: sb * ra }, { x: cb * rb, z: sb * rb }, { x: ca * rb, z: sa * rb }];
  }
  const dx = (s.x1 - s.x0) / block.cols, dz = (s.z1 - s.z0) / block.rows, xa = s.x0 + col * dx, xb = xa + cols * dx, za = s.z0 + row * dz, zb = za + rows * dz;
  return [{ x: xa, z: za }, { x: xb, z: za }, { x: xb, z: zb }, { x: xa, z: zb }];
}

/** Every cell for sale of the grid with its frame, block by block: for tests and scripts (the map walks the blocks). */
export function landCells(grid: LandGrid): LandCell[] {
  return grid.blocks.flatMap(b => {
    const out: LandCell[] = [];
    for (let c = 0; c < b.cols; c++) for (let r = 0; r < b.rows; r++) if (!b.skip.has(`${c}:${r}`)) out.push({ ...areaFrame(b, c, r), district: b.district, block: b.block, col: c, row: r, band: b.band });
    return out;
  });
}

/** A point of a cell area by its own coordinates: s along its columns, t along its rows, both 0…1 (bilinear over its corners). */
export function areaPoint(corners: Point[], s: number, t: number): Point {
  const [a, b, c, d] = corners;
  return { x: (1 - s) * (1 - t) * a.x + s * (1 - t) * b.x + s * t * c.x + (1 - s) * t * d.x, z: (1 - s) * (1 - t) * a.z + s * (1 - t) * b.z + s * t * c.z + (1 - s) * t * d.z };
}

/**
 * A stretch of the border between two districts, down the middle of the gap that parts their blocks: from `a` to `b`,
 * `normal` pointing into district `toward` (the other side is district `away`), `gaps` the width between the two
 * districts' blocks at `a` and at `b` (in between it changes evenly: the island city's cuts are radial, so they widen
 * outwards). `street` is kept for the renderer: no street runs down a border any more.
 */
export interface DistrictBorder { a: Point; b: Point; normal: Point; toward: number; away: number; gaps: [number, number]; street: boolean }
/** Blocks of two districts this close are neighbours: only the gap between two districts parts them. */
const NEIGHBOURS = 2.5, STEP = 1;

/**
 * Where the districts meet, to draw on the ground (systems/estates.ts): the gap between neighbouring blocks of two
 * districts, a radial cut on the island city, a line on the lake city. Only over dry land: a border stops at the water
 * (the lake and its shore) and on the railway and the station square.
 */
export function districtBorders(grid: LandGrid, world: WorldData): DistrictBorder[] {
  type Line = Omit<DistrictBorder, "gaps"> & { gap: (p: Point) => number };
  const lines: Line[] = [];
  for (const A of grid.blocks) for (const B of grid.blocks) {
    if (A.district === B.district) continue;
    const sa = A.shape, sb = B.shape;
    if (sa.kind === "ring" && sb.kind === "ring") {
      // B begins just counter-clockwise of A's end, in the same band: the cut between them, from the band's inner edge to its outer one.
      const turn = wrap(sb.a0 - sa.a1), rm = (sa.r0 + sa.r1) / 2;
      if (A.band !== B.band || turn * rm > NEIGHBOURS) continue;
      const t = sa.a1 + turn / 2, c = Math.cos(t), sn = Math.sin(t), r0 = Math.min(sa.r0, sb.r0), r1 = Math.max(sa.r1, sb.r1);
      const gap = (p: Point) => 2 * Math.hypot(p.x, p.z) * Math.sin(turn / 2);
      lines.push({ a: { x: c * r0, z: sn * r0 }, b: { x: c * r1, z: sn * r1 }, normal: { x: -sn, z: c }, toward: B.district, away: A.district, gap, street: false });
    } else if (sa.kind === "rect" && sb.kind === "rect") {
      // B just past A along x (or along z), the two overlapping across: the gap between them.
      const dx = sb.x0 - sa.x1, dz = sb.z0 - sa.z1;
      if (dx >= 0 && dx <= NEIGHBOURS) {
        const z0 = Math.max(sa.z0, sb.z0), z1 = Math.min(sa.z1, sb.z1), x = (sa.x1 + sb.x0) / 2;
        if (z1 - z0 > 1) lines.push({ a: { x, z: z0 }, b: { x, z: z1 }, normal: { x: 1, z: 0 }, toward: B.district, away: A.district, gap: () => dx, street: false });
      }
      if (dz >= 0 && dz <= NEIGHBOURS) {
        const x0 = Math.max(sa.x0, sb.x0), x1 = Math.min(sa.x1, sb.x1), z = (sa.z1 + sb.z0) / 2;
        if (x1 - x0 > 1) lines.push({ a: { x: x0, z }, b: { x: x1, z }, normal: { x: 0, z: 1 }, toward: B.district, away: A.district, gap: () => dz, street: false });
      }
    }
  }
  const line = world.railway, square = stationSquare(world), rect = world.land.rectangle;
  const dry = (p: Point) => {
    const r = Math.hypot(p.x, p.z);
    if (rect ? Math.abs(p.x) > rect.width / 2 || Math.abs(p.z) > rect.depth / 2 || r < rect.lake + 4 : !world.land.annuli.some(a => r > a.inner + .5 && r < a.outer - .5)) return false;
    return !(line && (onRailway(line, p, 1) || (square ? onSquare(line, square, p, 1) : false)));
  };
  const out: DistrictBorder[] = [];
  for (const { gap, ...border } of lines) {
    const dx = border.b.x - border.a.x, dz = border.b.z - border.a.z, length = Math.hypot(dx, dz);
    // Runs of kept samples become the stretches to draw, from the first of a run to its last.
    const at = (t: number) => ({ x: border.a.x + dx * t, z: border.a.z + dz * t }), steps = Math.max(1, Math.round(length / STEP));
    let start: number | null = null, last = 0;
    for (let i = 0; i <= steps + 1; i++) {
      const t = i / steps;
      if (i <= steps && dry(at(t))) { start ??= t; last = t; continue; }
      if (start !== null && (last - start) * length >= 2) { const a = at(start), b = at(last); out.push({ ...border, a, b, gaps: [gap(a), gap(b)] }); }
      start = null;
    }
  }
  return out;
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

/** The cell under a world point, for sale or not (`skipped`), or null off the land. */
export function cellUnder(grid: LandGrid, p: Point): { block: LandBlock; col: number; row: number; skipped: boolean } | null {
  for (const block of grid.blocks) {
    const at = blockCell(block, p);
    if (!at) continue;
    const col = Math.min(block.cols - 1, Math.floor(at.u)), row = Math.min(block.rows - 1, Math.floor(at.v));
    return { block, col, row, skipped: block.skip.has(`${col}:${row}`) };
  }
  return null;
}
/** The cell for sale under a world point, or null (a cell not for sale, off the land). */
export function cellAt(grid: LandGrid, p: Point): { block: LandBlock; col: number; row: number } | null {
  const at = cellUnder(grid, p);
  return at && !at.skipped ? { block: at.block, col: at.col, row: at.row } : null;
}

/**
 * The cells next to a cell on one of its ways, with the stretch of the edge they share: in the same block the cell
 * beside it; past the block's edge the cells of the district's block on the other side that touch it there (the next
 * band of the island city may have more columns, so there can be two). `from`/`to` say where on the cell's own edge
 * they meet (0…1 along it) and `meet` is the middle of that stretch: a road from both cells joins there exactly.
 * A district's border and land not for sale have no neighbours.
 */
export interface Neighbour { block: LandBlock; col: number; row: number; from: number; to: number; meet: Point }
export function neighbours(grid: LandGrid, block: LandBlock, col: number, row: number, way: Way): Neighbour[] {
  const dc = way === "col-" ? -1 : way === "col+" ? 1 : 0, dr = way === "row-" ? -1 : way === "row+" ? 1 : 0, c = col + dc, r = row + dr;
  if (c >= 0 && r >= 0 && c < block.cols && r < block.rows) {
    if (block.skip.has(`${c}:${r}`)) return [];
    const corners = areaCorners(block, col, row);
    const meet = way === "row-" ? areaPoint(corners, .5, 0) : way === "row+" ? areaPoint(corners, .5, 1) : way === "col-" ? areaPoint(corners, 0, .5) : areaPoint(corners, 1, .5);
    return [{ block, col: c, row: r, from: 0, to: 1, meet }];
  }
  const out: Neighbour[] = [], s = block.shape, EPS = 1e-6;
  for (const other of grid.blocks) {
    if (other === block || other.district !== block.district) continue;
    const o = other.shape;
    // Along the shared edge: this cell's stretch [lo, hi], the other block's start and step there, its row or column.
    let lo: number, hi: number, start: number, step: number, count: number, fixed: number, along: "col" | "row", at: (k: number) => Point;
    if (s.kind === "ring" && o.kind === "ring") {
      if (way === "col-" || way === "col+") continue;
      const R = way === "row+" ? s.r1 : s.r0;
      if (Math.abs((way === "row+" ? o.r0 : o.r1) - R) > EPS) continue;
      const da = (s.a1 - s.a0) / block.cols;
      lo = s.a0 + col * da; hi = lo + da; start = o.a0; step = (o.a1 - o.a0) / other.cols; count = other.cols;
      fixed = way === "row+" ? 0 : other.rows - 1; along = "col"; at = k => ({ x: Math.cos(k) * R, z: Math.sin(k) * R });
    } else if (s.kind === "rect" && o.kind === "rect") {
      if (way === "col-" || way === "col+") {
        const X = way === "col+" ? s.x1 : s.x0;
        if (Math.abs((way === "col+" ? o.x0 : o.x1) - X) > EPS) continue;
        const dz = (s.z1 - s.z0) / block.rows;
        lo = s.z0 + row * dz; hi = lo + dz; start = o.z0; step = (o.z1 - o.z0) / other.rows; count = other.rows;
        fixed = way === "col+" ? 0 : other.cols - 1; along = "row"; at = k => ({ x: X, z: k });
      } else {
        const Z = way === "row+" ? s.z1 : s.z0;
        if (Math.abs((way === "row+" ? o.z0 : o.z1) - Z) > EPS) continue;
        const dx = (s.x1 - s.x0) / block.cols;
        lo = s.x0 + col * dx; hi = lo + dx; start = o.x0; step = (o.x1 - o.x0) / other.cols; count = other.cols;
        fixed = way === "row+" ? 0 : other.rows - 1; along = "col"; at = k => ({ x: k, z: Z });
      }
    } else continue;
    const first = Math.max(0, Math.floor((lo - start) / step)), last = Math.min(count - 1, Math.ceil((hi - start) / step) - 1);
    for (let k = first; k <= last; k++) {
      const a = Math.max(lo, start + k * step), b = Math.min(hi, start + (k + 1) * step);
      const [oc, or] = along === "col" ? [k, fixed] : [fixed, k];
      if (b - a < EPS || other.skip.has(`${oc}:${or}`)) continue;
      out.push({ block: other, col: oc, row: or, from: (a - lo) / (hi - lo), to: (b - lo) / (hi - lo), meet: at((a + b) / 2) });
    }
  }
  return out;
}

/** A cell's middle. */
export function cellCentre(block: LandBlock, col: number, row: number): Point {
  return areaPoint(areaCorners(block, col, row), .5, .5);
}
export interface CellRef { block: LandBlock; col: number; row: number }

/**
 * The cells from one to another along the land's own lines, as a road is laid: first along the way they differ most
 * (round the ring or out from the centre on the island city; along x or z by the lake), then across, through the
 * corner. Only the cells of the first one's district that are for sale; each once, in order from the first.
 */
export function cellsBetween(grid: LandGrid, from: CellRef, to: CellRef): CellRef[] {
  const a = cellCentre(from.block, from.col, from.row), b = cellCentre(to.block, to.col, to.row);
  let path: Point[];
  if (from.block.shape.kind === "ring") {
    const ra = Math.hypot(a.x, a.z), rb = Math.hypot(b.x, b.z), aa = Math.atan2(a.z, a.x), turn = Math.atan2(Math.sin(Math.atan2(b.z, b.x) - aa), Math.cos(Math.atan2(b.z, b.x) - aa));
    const round = Math.abs(turn) * ra >= Math.abs(rb - ra), polar = (r: number, an: number) => ({ x: Math.cos(an) * r, z: Math.sin(an) * r });
    path = round ? [a, ...arc(ra, aa, turn, polar), polar(rb, aa + turn), b] : [a, polar(rb, aa), ...arc(rb, aa, turn, polar), b];
  } else {
    const corner = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z) ? { x: b.x, z: a.z } : { x: a.x, z: b.z };
    path = [a, corner, b];
  }
  const out: CellRef[] = [], seen = new Set<string>();
  const take = (p: Point) => {
    const at = cellUnder(grid, p);
    if (!at || at.skipped || at.block.district !== from.block.district) return;
    const key = `${at.block.block}:${at.col}:${at.row}`;
    if (!seen.has(key)) { seen.add(key); out.push({ block: at.block, col: at.col, row: at.row }); }
  };
  for (let i = 0; i + 1 < path.length; i++) {
    const p = path[i], q = path[i + 1], steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / .4));
    for (let k = 0; k <= steps; k++) take({ x: p.x + (q.x - p.x) * k / steps, z: p.z + (q.z - p.z) * k / steps });
  }
  return out;
}
/** Points along an arc of radius r from angle a0 turning by `turn`, a point a unit or so apart. */
function arc(r: number, a0: number, turn: number, polar: (r: number, a: number) => Point) {
  const n = Math.max(1, Math.ceil(Math.abs(turn) * r)), out: Point[] = [];
  for (let k = 1; k < n; k++) out.push(polar(r, a0 + turn * k / n));
  return out;
}

/** The land of a city's districts: the island city (x4) and the lake city have it, the old v1 map has none. */
export function landGrid(world: WorldData): LandGrid | null {
  if (world.spec.name === "x4") return islandLand(world);
  if (world.spec.name === "sales") return lakeLand(world);
  return null;
}

/**
 * What the server needs of a city's land: every district's blocks with their band, size and the cells not for sale,
 * row by row as runs of columns ([first column, last column, row]), app/data/city_land.json.
 */
export function landJson(grid: LandGrid) {
  const districts: Record<string, { block: number; band: number; cols: number; rows: number; skip: [number, number, number][] }[]> = {};
  for (const b of grid.blocks) {
    const runs: [number, number, number][] = [];
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) {
      if (!b.skip.has(`${c}:${r}`)) continue;
      const last = runs[runs.length - 1];
      if (last && last[2] === r && last[1] === c - 1) last[1] = c; else runs.push([c, c, r]);
    }
    (districts[b.district] ??= []).push({ block: b.block, band: b.band, cols: b.cols, rows: b.rows, skip: runs });
  }
  for (const list of Object.values(districts)) list.sort((p, q) => p.block - q.block);
  return { bands: grid.bands, districts };
}

/**
 * The island city's mainland, empty for the districts: of the generated town only the group quarters stay (drawn apart,
 * world/sites.ts). Its houses, towers, complexes with their yards and walks, trees, parks, the port, the car parks, and
 * now its ring roads and avenues with their crossings, street lamps and traffic go too: the districts' operators lay
 * their own roads. The canal with its arch bridges, the island ring with its plots (world/plots.ts), car parks and
 * ring road, the forests on the hills beyond the horizon stay. The station and its square are laid out afterwards
 * (world/cities.ts).
 */
export function clearMainland(world: WorldData) {
  const bank = mainlandOf(world).inner, horizon = world.spec.horizon;
  const mainland = (p: Point, pad = 0) => { const r = Math.hypot(p.x, p.z); return r > bank - pad && r < horizon + pad; };
  world.placements = world.placements.filter(p => !mainland(p, .5));
  world.surfaces = world.surfaces.filter(s => !mainland(s, Math.max(s.length, s.width) / 2));
  world.parks = world.parks.filter(p => !mainland(p, 2.2));
  world.roads.parking = world.roads.parking.filter(lot => !mainland(lot, (lot.length + lot.depth) / 2));
  // The mainland's avenues run from the canal bank (or a ring road) out to the horizon.
  world.roads.streets = world.roads.streets.filter(([ax, az, bx, bz]) => Math.min(Math.hypot(ax, az), Math.hypot(bx, bz)) < bank - .5);
  world.roads.rings = world.roads.rings.filter(r => r < bank);
  world.roads.crosswalks = world.roads.crosswalks.filter(c => !mainland(c));
  // Cars drove the mainland's ring roads and avenues, the loops between the canal and the first ring road crossing
  // the canal bridges onto it; only the island ring road's loop and the boats on the canal stay.
  world.routes = world.routes.filter(plan => plan.route.points.every((p, i) => plan.route.hidden[i] || !mainland(p, 1)));
  world.complexes = []; world.alleys = []; world.walks = [];
}

/** The island city's mainland: the widest ring of land, from the canal's far bank to the horizon. */
const mainlandOf = (world: WorldData) => world.land.annuli.reduce((best, a) => a.outer - a.inner > best.outer - best.inner ? a : best);

/** Grows the grid: blocks get their number within their district and their cells, each checked against `clear`. */
function builder(clear: (corners: Point[], centre: Point) => boolean) {
  const blocks: LandBlock[] = [], counts = [0, 0, 0, 0];
  return {
    blocks,
    add(district: number, band: number, shape: BlockShape, cols: number, rows: number) {
      if (cols < 1 || rows < 1) return null;
      const block: LandBlock = { district, block: ++counts[district], band, cols, rows, shape, skip: new Set() };
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        const corners = areaCorners(block, c, r), [first, , opposite] = corners;
        if (!clear(corners, { x: (first.x + opposite.x) / 2, z: (first.z + opposite.z) / 2 })) block.skip.add(`${c}:${r}`);
      }
      blocks.push(block);
      return block;
    },
    /** Keeps the cells of the district's centre at the block's `side`, in its middle, and returns it. */
    centre(block: LandBlock, side: BlockSide): DistrictCentre {
      const s = block.shape, way = wayOf(side), along = way === "row-" || way === "row+" ? "col" : "row", frontHigh = way === "row+" || way === "col+";
      // A cell's width along the front and its depth across it.
      let width: number, depth: number;
      if (s.kind === "ring") { width = (s.a1 - s.a0) / block.cols * (frontHigh ? s.r1 : s.r0); depth = (s.r1 - s.r0) / block.rows; }
      else { const dx = (s.x1 - s.x0) / block.cols, dz = (s.z1 - s.z0) / block.rows; width = along === "col" ? dx : dz; depth = along === "col" ? dz : dx; }
      const count = along === "col" ? block.cols : block.rows, deep = along === "col" ? block.rows : block.cols;
      const n = Math.min(count, Math.ceil(CENTRE_WIDTH / width - 1e-9)), m = Math.min(deep, Math.ceil(CENTRE_DEPTH / depth - 1e-9));
      const k0 = Math.floor((count - n) / 2), j0 = frontHigh ? deep - m : 0;
      const [c0, r0, nc, nr] = along === "col" ? [k0, j0, n, m] : [j0, k0, m, n];
      for (let c = c0; c < c0 + nc; c++) for (let r = r0; r < r0 + nr; r++) block.skip.add(`${c}:${r}`);
      // The headquarters on one half, the public square on the other, both facing the front.
      const area = areaFrame(block, c0, r0, nc, nr, side, true), sin = Math.sin(area.rotation), cos = Math.cos(area.rotation), half = area.width / 4;
      const at = (lu: number) => ({ x: area.x + cos * lu, z: area.z - sin * lu });
      return {
        district: block.district, block: block.block, col: c0, row: r0, cols: nc, rows: nr, area,
        hq: { ...at(-half), rotation: area.rotation }, square: { district: block.district, slot: 0, kind: "public", ...at(half), rotation: area.rotation },
      };
    },
  };
}

/** Is the polygon (a cell, `centre` its middle) clear of every street by ROAD_GAP? Streets well away from its middle are not measured. */
const offStreets = (streets: readonly Road[], corners: Point[], centre: Point) =>
  streets.every(road => segmentDistance(centre.x, centre.z, road) > ROAD_GAP + 4 || segmentPolygonDistance(road, corners) >= ROAD_GAP - .25);
const rectangle = (x: number, z: number, angle: number, length: number, depth: number, pad: number): Point[] => {
  const s = Math.sin(angle), c = Math.cos(angle), l = length / 2 + pad, d = depth / 2 + pad;
  return [[-l, -d], [l, -d], [l, d], [-l, d]].map(([a, b]) => ({ x: x + s * a + c * b, z: z + c * a - s * b }));
};
/** The streets near an area: only those can come within a cell's reach of its cells. */
const near = (streets: readonly Road[], x0: number, x1: number, z0: number, z1: number) => streets.filter(([ax, az, bx, bz]) =>
  Math.max(ax, bx) > x0 - ROAD_GAP - 1 && Math.min(ax, bx) < x1 + ROAD_GAP + 1 && Math.max(az, bz) > z0 - ROAD_GAP - 1 && Math.min(az, bz) < z1 + ROAD_GAP + 1);

/**
 * The island city: bands between the canal bank, the circles where the mainland's ring roads ran and the horizon, each
 * band of each district one block. Three districts of about equal size, parted at BORDERS by a narrow gap. A cell is a
 * third of a plot of the old map each way: a band's rows and a block's columns are CELLS times as many as PLOT-wide
 * plots would be, so nine cells make up about one of those plots.
 */
export const BORDERS = [-32.7 * DEG, 90 * DEG, -146.7 * DEG];
function islandLand(world: WorldData): LandGrid {
  const line = world.railway, square = stationSquare(world), streets = world.roads.streets;
  // What stays of the city on the mainland: the station with its square and its street, the group quarters.
  const sites = world.sites.map(s => ({ corners: rectangle(s.x, s.z, s.angle, s.length, s.depth, 1.6), r: Math.hypot(s.x, s.z), reach: Math.hypot(s.length, s.depth) / 2 + 4 }));
  const mainland = mainlandOf(world);
  const kept = near(streets, -mainland.outer, mainland.outer, -mainland.outer, mainland.outer).filter(([ax, az, bx, bz]) => Math.max(Math.hypot(ax, az), Math.hypot(bx, bz)) > mainland.inner);
  const clear = (corners: Point[], centre: Point) => {
    if (line && [...corners, centre].some(p => onRailway(line, p, 1) || (square ? onSquare(line, square, p, 1) : false))) return false;
    if (kept.length && !offStreets(kept, corners, centre)) return false;
    const r = Math.hypot(centre.x, centre.z);
    return sites.every(site => Math.abs(site.r - r) > site.reach || Math.hypot(site.corners[0].x - centre.x, site.corners[0].z - centre.z) > 2 * site.reach || !polygonsOverlap(corners, site.corners));
  };
  const b = builder(clear);
  // The ring roads' circles still part the bands, whose land costs more nearer the centre.
  const rings = world.spec.roadRings.filter(r => r > mainland.inner && r < mainland.outer);
  const edges = [mainland.inner + 1.2, ...rings, mainland.outer - 1.5];
  const borders = BORDERS.map(wrap).sort((p, q) => p - q), districtOf = (a: number) => {
    // District k runs counter-clockwise from BORDERS[k - 1] to BORDERS[k] (wrapping round).
    const x = wrap(a), start = [...borders].reverse().find(o => o <= x) ?? borders[borders.length - 1];
    return BORDERS.map(wrap).indexOf(start) + 1;
  };
  for (let k = 0; k + 1 < edges.length; k++) {
    const band = k + 1, r0 = edges[k], r1 = edges[k + 1], rm = (r0 + r1) / 2, rows = CELLS * Math.max(1, Math.round((r1 - r0) / PLOT));
    for (let i = 0; i < borders.length; i++) {
      const from = borders[i], to = i + 1 < borders.length ? borders[i + 1] : borders[0] + TAU;
      const a0 = from + BORDER_GAP / rm, a1 = to - BORDER_GAP / rm, cols = CELLS * Math.max(1, Math.round((a1 - a0) * rm / PLOT));
      b.add(districtOf((a0 + a1) / 2), band, { kind: "ring", r0, r1, a0, a1 }, cols, rows);
    }
  }
  // Each district's centre: in the second band, in the middle of the district's sector, at its inner edge.
  const centres = [1, 2, 3].flatMap(d => {
    const block = b.blocks.find(x => x.district === d && x.band === 2);
    return block ? [b.centre(block, "in")] : [];
  });
  return { city: "support", bands: edges.length - 1, blocks: b.blocks, centres };
}

/**
 * The lake city: rectangles round the lake on the lines where its streets ran, every cell LAND_CELL across. District 1
 * has the top, 2 the left and the bottom left, 3 the right and the bottom right; the boulevard from the lake to the
 * station parts the bottom. Bands: the corners of the inner square by the lake, the frame round it, the strips at the
 * edge of the land. Each block lies on one side of every district border, so a border runs along whole block sides,
 * where both blocks keep half the gap clear.
 */
export const LAND_CELL = 3;
function lakeLand(world: WorldData): LandGrid {
  const line = world.railway, square = stationSquare(world), rect = world.land.rectangle!;
  const lake = (rect.lake ?? 46) + 12, pier = rectangle(4, 48, 0, 44, 18, 0), boulevard = rectangle(0, 85, 0, 60, 10.4, 0);
  const streets = world.roads.streets;
  const clear = (corners: Point[], centre: Point) => {
    if (corners.some(p => Math.hypot(p.x, p.z) < lake)) return false;
    if (polygonsOverlap(corners, pier) || polygonsOverlap(corners, boulevard)) return false;
    if (streets.length && !offStreets(streets, corners, centre)) return false;
    return !(line && [...corners, centre].some(p => onRailway(line, p, 1) || (square ? onSquare(line, square, p, 1) : false)));
  };
  const b = builder(clear), g = BORDER_GAP / 2;
  // The lines where the streets ran (world/sales.ts), on the cells' lattice: the inner square, the outer frame, the edge.
  const INNER = 66, OUTER_X = 132, OUTER_Z = 111, EDGE_X = 141, EDGE_Z = 120;
  /** A block from x0 to x1 and z0 to z1; `cut` names its sides along a district border, which keep half the gap clear. */
  const add = (district: number, band: number, x0: number, x1: number, z0: number, z1: number, cut: Partial<Record<"x0" | "x1" | "z0" | "z1", true>> = {}) =>
    b.add(district, band, { kind: "rect", x0: x0 + (cut.x0 ? g : 0), x1: x1 - (cut.x1 ? g : 0), z0: z0 + (cut.z0 ? g : 0), z1: z1 - (cut.z1 ? g : 0) }, Math.round((x1 - x0) / LAND_CELL), Math.round((z1 - z0) / LAND_CELL));
  // District 1, the top: the lake's top corners, the frame's top in three (its middle meets district 1's own corners), the top strip.
  add(1, 1, -INNER, INNER, -INNER, 0, { x0: true, x1: true, z1: true });
  add(1, 2, -OUTER_X, -INNER, -OUTER_Z, -INNER, { x0: true, z1: true });
  const top = add(1, 2, -INNER, INNER, -OUTER_Z, -INNER);
  add(1, 2, INNER, OUTER_X, -OUTER_Z, -INNER, { x1: true, z1: true });
  add(1, 3, -OUTER_X, OUTER_X, -EDGE_Z, -OUTER_Z);
  // Districts 2 and 3, mirror images: the lake's bottom corner, the frame's side (in two: its top half meets district 1)
  // and bottom, the side strip (in two likewise) and the bottom strip.
  const sides = [2, 3].map(district => {
    const m = district === 2 ? 1 : -1;
    // A rectangle mirrored for district 3, its cut sides with it.
    const put = (band: number, x0: number, x1: number, z0: number, z1: number, cut: Partial<Record<"x0" | "x1" | "z0" | "z1", true>> = {}) => m > 0
      ? add(district, band, x0, x1, z0, z1, cut)
      : add(district, band, -x1, -x0, z0, z1, { ...(cut.x1 ? { x0: true } : {}), ...(cut.x0 ? { x1: true } : {}), ...(cut.z0 ? { z0: true } : {}), ...(cut.z1 ? { z1: true } : {}) });
    put(1, -INNER, 0, 0, INNER, { x1: true, z0: true });
    put(2, -OUTER_X, -INNER, -INNER, 0, { x1: true, z0: true });
    const side = put(2, -OUTER_X, -INNER, 0, INNER);
    put(2, -OUTER_X, 0, INNER, OUTER_Z, { x1: true });
    put(3, -EDGE_X, -OUTER_X, -OUTER_Z, -INNER, { x1: true });
    put(3, -EDGE_X, -OUTER_X, -INNER, OUTER_Z);
    put(3, -OUTER_X, 0, OUTER_Z, EDGE_Z, { x1: true });
    return side;
  });
  const centres = [
    ...(top ? [b.centre(top, "z1")] : []),
    ...(sides[0] ? [b.centre(sides[0], "x1")] : []),
    ...(sides[1] ? [b.centre(sides[1], "x0")] : []),
  ];
  return { city: "sales", bands: 3, blocks: b.blocks, centres };
}
