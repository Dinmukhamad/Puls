/**
 * The land of the team districts (docs/CITY_ESTATES.md): the whole city goes to three districts, and each district
 * is cut into small cells that its operators build on. A district has no roads of its own: its operators lay them,
 * a cell at a time, together with footpaths, trees, lamps, benches and the rest (world/decor.ts), and a house, an
 * office tower or a square stands on CELLS × CELLS cells, about PLOT units across, wherever it fits on one block.
 *
 * Both cities' cells are squares in straight rows along x and z. On the island city each band of each district,
 * between the canal bank, the circles where the ring roads ran and the horizon, is one block: the rectangle round its
 * cells, which step along the bank, the horizon and the cuts between the districts. The lake city's blocks are
 * rectangles round the lake, between the lines where its streets ran. A cell's address is (district, block, column,
 * row), the same on the server (app/data/city_land.json, written from this file by frontend/scripts/city-land.mjs).
 * Bands count outwards from the centre and set the price of land. In every district a few cells near its middle are
 * its centre, where its main building grows. Pure data, no three.js.
 */
import { segmentDistance } from "./generate";
import { onRailway, railPoint, STATION, type RailLine } from "./railway";
import { lakeSquare, onSquare, stationSquare, type StationSquare } from "./stationSquare";
import { polygonsOverlap, segmentPolygonDistance, type ModuleSlot } from "./estates";
import type { Point, Road, WorldData } from "./types";

/**
 * A building's plot is CELLS × CELLS cells, about PLOT units across; the gap kept from what is left of the streets
 * (the station's), and between two districts.
 */
export const CELLS = 3, PLOT = 9, ROAD_GAP = 1.6, BORDER_GAP = .8;
/** A cell's side: the island city's cells lie on one lattice of squares from its middle, the lake city's nearly so. */
export const LAND_CELL = 3;
/**
 * A district's centre, kept from the cells at the front of one block: the main building grows there (a site of up to
 * 18 × 18, world/districtLandmark.ts), beside the public square of the districts' old shared projects (a module of
 * 18 × 18, world/estates.ts). As many cells as these units need along the front and across it.
 */
export const CENTRE_WIDTH = 40, CENTRE_DEPTH = 20;

export type LandCity = "support" | "sales";
/** An axis-aligned rectangle: columns run along x, rows along z. */
export type BlockShape = { kind: "rect"; x0: number; x1: number; z0: number; z1: number };
/**
 * A side of an area of cells, at x0, x1, z0 or z1. In a block's own terms: "z0" before the first row, "z1" past the
 * last, "x0" before the first column, "x1" past the last.
 */
export type BlockSide = "x0" | "x1" | "z0" | "z1";
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
/**
 * A district's centre: the cells kept for it (`cols` × `rows` from `col`, `row` of its block, their frame `area`, its
 * front to `side`), the headquarters' site and the public square.
 */
export interface DistrictCentre { district: number; block: number; col: number; row: number; cols: number; rows: number; side: BlockSide; area: Frame; hq: Point & { rotation: number }; square: ModuleSlot }
/**
 * The island city's district `district`, counter-clockwise from the angle a0 to a1 (radians), its land from the radius
 * r0 to r1: its blocks overlap the others', so the sectors say whose land a point not for sale is, and where the cuts
 * between the districts run.
 */
export interface LandSector { district: number; a0: number; a1: number; r0: number; r1: number }
export interface LandGrid { city: LandCity; bands: number; blocks: LandBlock[]; centres: DistrictCentre[]; sectors?: LandSector[] }

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
export const cellKey = (block: number, col: number, row: number) => `${block}:${col}:${row}`;

/** The side of `ways`: which edge of an area a way leaves by (`block` kept for the callers). */
export function sideOf(_block: LandBlock, way: Way): BlockSide {
  return way === "row-" ? "z0" : way === "row+" ? "z1" : way === "col-" ? "x0" : "x1";
}
/** The way out of a block's area by its side. */
export function wayOf(side: BlockSide): Way {
  return side === "z0" ? "row-" : side === "z1" ? "row+" : side === "x0" ? "col-" : "col+";
}

/** The side an area of a block looks to when nothing else decides: whichever faces the middle of the city most. */
export function homeSide(block: LandBlock, col: number, row: number, cols = 1, rows = 1): BlockSide {
  const s = block.shape, dx = (s.x1 - s.x0) / block.cols, dz = (s.z1 - s.z0) / block.rows;
  const cx = s.x0 + (col + cols / 2) * dx, cz = s.z0 + (row + rows / 2) * dz;
  return Math.abs(cx) > Math.abs(cz) ? (cx > 0 ? "x0" : "x1") : (cz > 0 ? "z0" : "z1");
}
/** The four sides in turn, a quarter turn apart: a building's `rotation` turns its front this many steps from its home side. */
const TURNS: BlockSide[] = ["z1", "x1", "z0", "x0"];
export function turnedSide(_block: LandBlock, home: BlockSide, rotation: number): BlockSide {
  return TURNS[(TURNS.indexOf(home) + ((rotation % 4) + 4) % 4) % 4];
}

/**
 * The frame of `cols` × `rows` cells of a block from (col, row): one cell, a building's plot or a merged park. Its
 * front looks to `side` (by default towards the middle of the city); `street` says a road runs along that front.
 */
export function areaFrame(block: LandBlock, col: number, row: number, cols = 1, rows = 1, side: BlockSide = homeSide(block, col, row, cols, rows), street = false): Frame {
  const s = block.shape, dx = (s.x1 - s.x0) / block.cols, dz = (s.z1 - s.z0) / block.rows, xa = s.x0 + col * dx, xb = xa + cols * dx, za = s.z0 + row * dz, zb = za + rows * dz;
  const rotation = side === "z0" ? Math.PI : side === "x1" ? Math.PI / 2 : side === "x0" ? -Math.PI / 2 : 0;
  const across = side === "x0" || side === "x1";
  return {
    x: (xa + xb) / 2, z: (za + zb) / 2, rotation, width: across ? zb - za : xb - xa, depth: across ? xb - xa : zb - za,
    corners: [{ x: xa, z: za }, { x: xb, z: za }, { x: xb, z: zb }, { x: xa, z: zb }], street,
  };
}

/** The corners of `cols` × `rows` cells of a block from (col, row), in areaFrame's order, without the rest of the frame. */
export function areaCorners(block: LandBlock, col: number, row: number, cols = 1, rows = 1): Point[] {
  const s = block.shape, dx = (s.x1 - s.x0) / block.cols, dz = (s.z1 - s.z0) / block.rows, xa = s.x0 + col * dx, xb = xa + cols * dx, za = s.z0 + row * dz, zb = za + rows * dz;
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
 * A stretch of the border between two districts, down the middle of the gap that parts their cells: from `a` to `b`,
 * `normal` pointing into district `toward` (the other side is district `away`), `gaps` the width kept clear between
 * the two districts' cells at `a` and at `b` (in between it changes evenly). `street` is kept for the renderer: no
 * street runs down a border any more.
 */
export interface DistrictBorder { a: Point; b: Point; normal: Point; toward: number; away: number; gaps: [number, number]; street: boolean }
/** Blocks of two districts this close are neighbours: only the gap between two districts parts them. */
const NEIGHBOURS = 2.5, STEP = 1;

/**
 * Where the districts meet, to draw on the ground (systems/estates.ts): on the island city the cuts out from the centre
 * between their sectors, on the lake city the gap between neighbouring blocks of two districts. Only over dry land: a
 * border stops at the water (the lake and its shore) and on the railway and the station square.
 */
export function districtBorders(grid: LandGrid, world: WorldData): DistrictBorder[] {
  type Line = Omit<DistrictBorder, "gaps"> & { gap: (p: Point) => number };
  const lines: Line[] = [];
  // The island city's cuts, out from the centre where one district's sector begins: both keep BORDER_GAP clear of it.
  for (const s of grid.sectors ?? []) {
    const before = grid.sectors!.find(o => o !== s && Math.abs(wrap(o.a1) - wrap(s.a0)) < 1e-9);
    if (!before || before.district === s.district) continue;
    const c = Math.cos(s.a0), sn = Math.sin(s.a0);
    lines.push({ a: { x: c * s.r0, z: sn * s.r0 }, b: { x: c * s.r1, z: sn * s.r1 }, normal: { x: -sn, z: c }, toward: s.district, away: before.district, gap: () => 2 * BORDER_GAP, street: false });
  }
  if (!grid.sectors) for (const A of grid.blocks) for (const B of grid.blocks) {
    if (A.district === B.district) continue;
    // B just past A along x (or along z), the two overlapping across: the gap between them.
    const sa = A.shape, sb = B.shape, dx = sb.x0 - sa.x1, dz = sb.z0 - sa.z1;
    if (dx >= 0 && dx <= NEIGHBOURS) {
      const z0 = Math.max(sa.z0, sb.z0), z1 = Math.min(sa.z1, sb.z1), x = (sa.x1 + sb.x0) / 2;
      if (z1 - z0 > 1) lines.push({ a: { x, z: z0 }, b: { x, z: z1 }, normal: { x: 1, z: 0 }, toward: B.district, away: A.district, gap: () => dx, street: false });
    }
    if (dz >= 0 && dz <= NEIGHBOURS) {
      const x0 = Math.max(sa.x0, sb.x0), x1 = Math.min(sa.x1, sb.x1), z = (sa.z1 + sb.z0) / 2;
      if (x1 - x0 > 1) lines.push({ a: { x: x0, z }, b: { x: x1, z }, normal: { x: 0, z: 1 }, toward: B.district, away: A.district, gap: () => dz, street: false });
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

/** The world point at `col` columns and `row` rows (fractions too) from a block's first corner. */
export function blockPoint(block: LandBlock, col: number, row: number): Point {
  const s = block.shape;
  return { x: s.x0 + col * (s.x1 - s.x0) / block.cols, z: s.z0 + row * (s.z1 - s.z0) / block.rows };
}

/** Where a world point lies in a block, in columns (u) and rows (v) from its first corner; null off the block. */
export function blockCell(block: LandBlock, p: Point): { u: number; v: number } | null {
  const s = block.shape, u = (p.x - s.x0) / (s.x1 - s.x0), v = (p.z - s.z0) / (s.z1 - s.z0);
  return u < 0 || u > 1 || v < 0 || v > 1 ? null : { u: u * block.cols, v: v * block.rows };
}

/** The district whose land a point is on the island city (by its sector, on the land), null off it; undefined by the lake. */
export function districtAt(grid: LandGrid, p: Point): number | null | undefined {
  if (!grid.sectors) return undefined;
  const r = Math.hypot(p.x, p.z), a = Math.atan2(p.z, p.x);
  return grid.sectors.find(s => r >= s.r0 && r <= s.r1 && wrap(a - s.a0) < s.a1 - s.a0)?.district ?? null;
}
/**
 * The cell under a world point, for sale or not (`skipped`), or null off the land. The island city's blocks overlap: a
 * cell for sale in one of them is the one, else the cell of the block of the district whose land the point is.
 */
export function cellUnder(grid: LandGrid, p: Point): { block: LandBlock; col: number; row: number; skipped: boolean } | null {
  let off: { block: LandBlock; col: number; row: number; skipped: boolean } | null = null, owner: number | null | undefined;
  for (const block of grid.blocks) {
    const at = blockCell(block, p);
    if (!at) continue;
    const col = Math.min(block.cols - 1, Math.floor(at.u)), row = Math.min(block.rows - 1, Math.floor(at.v));
    if (!block.skip.has(`${col}:${row}`)) return { block, col, row, skipped: false };
    if (off) continue;
    if (owner === undefined && grid.sectors) owner = districtAt(grid, p);
    if (!grid.sectors || owner === block.district) off = { block, col, row, skipped: true };
  }
  return off;
}
/** The cell for sale under a world point, or null (a cell not for sale, off the land). */
export function cellAt(grid: LandGrid, p: Point): { block: LandBlock; col: number; row: number } | null {
  const at = cellUnder(grid, p);
  return at && !at.skipped ? { block: at.block, col: at.col, row: at.row } : null;
}

/**
 * The cells next to a cell on one of its ways, with the stretch of the edge they share: in the same block the cell
 * beside it; else the same square for sale in another of the district's blocks (where the island city's bands meet);
 * past the edge of a lake city's block the cells of the district's block on the other side that touch it there (cells
 * of another size, so there can be two). `from`/`to` say where on the cell's own edge they meet (0…1 along it) and
 * `meet` is the middle of that stretch: a road from both cells joins there exactly. A district's border and land not
 * for sale have no neighbours.
 */
export interface Neighbour { block: LandBlock; col: number; row: number; from: number; to: number; meet: Point }
export function neighbours(grid: LandGrid, block: LandBlock, col: number, row: number, way: Way): Neighbour[] {
  const dc = way === "col-" ? -1 : way === "col+" ? 1 : 0, dr = way === "row-" ? -1 : way === "row+" ? 1 : 0, c = col + dc, r = row + dr;
  const on = c >= 0 && r >= 0 && c < block.cols && r < block.rows, corners = areaCorners(block, col, row);
  const meet = () => way === "row-" ? areaPoint(corners, .5, 0) : way === "row+" ? areaPoint(corners, .5, 1) : way === "col-" ? areaPoint(corners, 0, .5) : areaPoint(corners, 1, .5);
  if (on && !block.skip.has(`${c}:${r}`)) return [{ block, col: c, row: r, from: 0, to: 1, meet: meet() }];
  // The same square of the lattice for sale in another of the district's blocks: where the island city's bands meet.
  const there = latticeCell(grid, block, c, r);
  if (there) return [{ ...there, from: 0, to: 1, meet: meet() }];
  if (on) return [];
  const out: Neighbour[] = [], s = block.shape, EPS = 1e-6;
  for (const other of grid.blocks) {
    if (other === block || other.district !== block.district) continue;
    const o = other.shape;
    // Along the shared edge: this cell's stretch [lo, hi], the other block's start and step there, its row or column.
    let lo: number, hi: number, start: number, step: number, count: number, fixed: number, along: "col" | "row", at: (k: number) => Point;
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

/**
 * The cell for sale of the district at the place of (col, row) of a block, off it or on it, in another of the
 * district's blocks whose cells lie on the same lattice; null if there is none. The island city's blocks overlap.
 */
function latticeCell(grid: LandGrid, block: LandBlock, col: number, row: number): CellRef | null {
  const mine = areaCorners(block, col, row), middle = areaPoint(mine, .5, .5);
  for (const other of grid.blocks) {
    if (other === block || other.district !== block.district) continue;
    const at = blockCell(other, middle);
    if (!at) continue;
    const c = Math.floor(at.u), r = Math.floor(at.v);
    if (c >= other.cols || r >= other.rows || other.skip.has(`${c}:${r}`)) continue;
    const theirs = areaCorners(other, c, r);
    if (mine.every((p, i) => Math.abs(p.x - theirs[i].x) < 1e-6 && Math.abs(p.z - theirs[i].z) < 1e-6)) return { block: other, col: c, row: r };
  }
  return null;
}

/**
 * How many columns and rows a rectangle of cells from one to another spans: in one block, or across blocks whose cells
 * lie on the same lattice (the island city's bands); null if they do not line up.
 */
export function areaSpan(from: CellRef, to: CellRef): [number, number] | null {
  if (from.block === to.block) return [Math.abs(to.col - from.col) + 1, Math.abs(to.row - from.row) + 1];
  const a = areaCorners(from.block, from.col, from.row), b = areaCorners(to.block, to.col, to.row);
  const w = a[1].x - a[0].x, d = a[3].z - a[0].z;
  if (Math.abs(b[1].x - b[0].x - w) > 1e-6 || Math.abs(b[3].z - b[0].z - d) > 1e-6) return null;
  const cols = (b[0].x - a[0].x) / w, rows = (b[0].z - a[0].z) / d;
  if (Math.abs(cols - Math.round(cols)) > 1e-6 || Math.abs(rows - Math.round(rows)) > 1e-6) return null;
  return [Math.abs(Math.round(cols)) + 1, Math.abs(Math.round(rows)) + 1];
}

/** A cell's middle. */
export function cellCentre(block: LandBlock, col: number, row: number): Point {
  return areaPoint(areaCorners(block, col, row), .5, .5);
}
export interface CellRef { block: LandBlock; col: number; row: number }

/**
 * The cells from one to another along the land's own lines, as a road is laid: first along x or z, whichever they
 * differ most in, then across, through the corner. Only the cells of the first one's district that are for sale; each
 * once, in order from the first.
 */
export function cellsBetween(grid: LandGrid, from: CellRef, to: CellRef): CellRef[] {
  const a = cellCentre(from.block, from.col, from.row), b = cellCentre(to.block, to.col, to.row);
  const corner = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z) ? { x: b.x, z: a.z } : { x: a.x, z: b.z }, path = [a, corner, b];
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
/**
 * The cells between two as a rectangle along x and z, as an area of small things is laid (a road two or three cells
 * wide, a grove), across the seams between the island city's bands too: every cell for sale of the first one's
 * district whose middle lies within the two cells' outer edges, block by block, row by row.
 */
export function cellsWithin(grid: LandGrid, from: CellRef, to: CellRef): CellRef[] {
  const out: CellRef[] = [], district = from.block.district;
  /** Columns and rows of a block whose middles lie between lo and hi, measured from `start` in steps of `step`. */
  const span = (lo: number, hi: number, start: number, step: number, count: number) =>
    [Math.max(0, Math.ceil((lo - start) / step - .5 - 1e-9)), Math.min(count - 1, Math.floor((hi - start) / step - .5 + 1e-9))];
  const add = (block: LandBlock, [c0, c1]: number[], [r0, r1]: number[]) => {
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) if (!block.skip.has(`${col}:${row}`)) out.push({ block, col, row });
  };
  const edges = (c: CellRef) => {
    const s = c.block.shape, dx = (s.x1 - s.x0) / c.block.cols, dz = (s.z1 - s.z0) / c.block.rows;
    return { x0: s.x0 + c.col * dx, x1: s.x0 + (c.col + 1) * dx, z0: s.z0 + c.row * dz, z1: s.z0 + (c.row + 1) * dz };
  };
  const e = [edges(from), edges(to)], xlo = Math.min(e[0].x0, e[1].x0), xhi = Math.max(e[0].x1, e[1].x1), zlo = Math.min(e[0].z0, e[1].z0), zhi = Math.max(e[0].z1, e[1].z1);
  for (const block of grid.blocks) {
    const s = block.shape;
    if (block.district !== district || s.x1 <= xlo || s.x0 >= xhi || s.z1 <= zlo || s.z0 >= zhi) continue;
    add(block, span(xlo, xhi, s.x0, (s.x1 - s.x0) / block.cols, block.cols), span(zlo, zhi, s.z0, (s.z1 - s.z0) / block.rows, block.rows));
  }
  return out;
}

/** How many districts a city may be cut into; three is the city's first layout. */
export const DISTRICT_COUNTS = [2, 3, 4, 5] as const;
export const DEFAULT_DISTRICTS = 3;

/**
 * The land of a city's districts, cut into `count` of them: the island city (x4) and the lake city have it, the old v1
 * map has none. Three districts keep the city's first layout; another count cuts the city into districts of about
 * equal numbers of cells (balancedBorders).
 */
export function landGrid(world: WorldData, count: number = DEFAULT_DISTRICTS): LandGrid | null {
  if (world.spec.name === "x4") return islandLand(world, count === DEFAULT_DISTRICTS ? BORDERS : islandBorders(world, count));
  if (world.spec.name === "sales") return count === DEFAULT_DISTRICTS ? lakeLand(world) : lakeSectorLand(world, count);
  return null;
}

/**
 * Cuts out from the centre that part `count` districts of about equal numbers of cells: the first at `start`, the
 * others where the cells, taken counter-clockwise by the angle of their middles, reach an equal share.
 */
export function balancedBorders(angles: number[], start: number, count: number): number[] {
  const turned = angles.map(a => wrap(a - start)).sort((p, q) => p - q);
  const out = [wrap(start)];
  for (let k = 1; k < count; k++) {
    const i = Math.min(turned.length - 1, Math.round(turned.length * k / count));
    out.push(wrap(start + (turned[i] + (turned[i - 1] ?? turned[i])) / 2));
  }
  return out;
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
 * The island city's mainland, empty for the districts: its houses, towers, complexes with their yards and walks, trees,
 * parks, the port, the car parks, its ring roads and avenues with their crossings, street lamps and traffic all go: the
 * districts' operators lay their own roads. The canal with its arch bridges, the island ring with its plots
 * (world/plots.ts), car parks and ring road, the forests on the hills beyond the horizon stay. The station and its
 * square are laid out afterwards (world/cities.ts).
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

/** Grows the grid: blocks get their number within their district and their cells, each checked against `keep` and `clear`. */
function builder(clear: (corners: Point[], centre: Point) => boolean) {
  const blocks: LandBlock[] = [], counts: number[] = [];
  /** Keeps `cols` × `rows` cells of a block from (col, row) for the district's centre, its front to `side`, and returns it. */
  const centreAt = (block: LandBlock, col: number, row: number, cols: number, rows: number, side: BlockSide): DistrictCentre => {
    for (let c = col; c < col + cols; c++) for (let r = row; r < row + rows; r++) block.skip.add(`${c}:${r}`);
    // The headquarters on one half, the public square on the other, both facing the front.
    const area = areaFrame(block, col, row, cols, rows, side, true), sin = Math.sin(area.rotation), cos = Math.cos(area.rotation), half = area.width / 4;
    const at = (lu: number) => ({ x: area.x + cos * lu, z: area.z - sin * lu });
    return {
      district: block.district, block: block.block, col, row, cols, rows, side, area,
      hq: { ...at(-half), rotation: area.rotation }, square: { district: block.district, slot: 0, kind: "public", ...at(half), rotation: area.rotation },
    };
  };
  return {
    blocks, centreAt,
    /** A block; a cell is for sale if it is the block's own (`keep`) and nothing of the city stands there (`clear`). */
    add(district: number, band: number, shape: BlockShape, cols: number, rows: number, keep: (col: number, row: number) => boolean = () => true) {
      if (cols < 1 || rows < 1) return null;
      const block: LandBlock = { district, block: (counts[district] = (counts[district] ?? 0) + 1), band, cols, rows, shape, skip: new Set() };
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        if (!keep(c, r)) { block.skip.add(`${c}:${r}`); continue; }
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
      const dx = (s.x1 - s.x0) / block.cols, dz = (s.z1 - s.z0) / block.rows, width = along === "col" ? dx : dz, depth = along === "col" ? dz : dx;
      const count = along === "col" ? block.cols : block.rows, deep = along === "col" ? block.rows : block.cols;
      const n = Math.min(count, Math.ceil(CENTRE_WIDTH / width - 1e-9)), m = Math.min(deep, Math.ceil(CENTRE_DEPTH / depth - 1e-9));
      const k0 = Math.floor((count - n) / 2), j0 = frontHigh ? deep - m : 0;
      const [c0, r0, nc, nr] = along === "col" ? [k0, j0, n, m] : [j0, k0, m, n];
      return centreAt(block, c0, r0, nc, nr, side);
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
 * The island city: a square grid of cells LAND_CELL across, as by the lake, from the canal bank to the horizon. Three
 * districts of about equal size, parted at BORDERS by straight cuts out from the centre: their cells keep BORDER_GAP
 * clear of a cut and step along it, as they step along the bank and the horizon. The circles where the mainland's ring
 * roads ran part the bands, whose land costs more nearer the centre; a cell is in the band its middle lies in. Each
 * band of each district is one block, the rectangle round its cells on the one lattice of the city, so a district's
 * blocks overlap where its bands meet and every cell is for sale in one of them at most.
 */
export const BORDERS = [-32.7 * DEG, 90 * DEG, -146.7 * DEG];

/** The island city's cells for sale before any cut parts them: on the mainland, clear of the station and its street. */
function islandClear(world: WorldData) {
  const line = world.railway, square = stationSquare(world), streets = world.roads.streets, mainland = mainlandOf(world);
  const kept = near(streets, -mainland.outer, mainland.outer, -mainland.outer, mainland.outer).filter(([ax, az, bx, bz]) => Math.max(Math.hypot(ax, az), Math.hypot(bx, bz)) > mainland.inner);
  return (corners: Point[], centre: Point) => {
    if (line && [...corners, centre].some(p => onRailway(line, p, 1) || (square ? onSquare(line, square, p, 1) : false))) return false;
    return !kept.length || offStreets(kept, corners, centre);
  };
}

/** Cuts for `count` districts of the island city with about equal land, the first where the first layout's is. */
function islandBorders(world: WorldData, count: number): number[] {
  const mainland = mainlandOf(world), clear = islandClear(world), inner = mainland.inner + 1.2, outer = mainland.outer - 1.5, angles: number[] = [];
  for (let x = -Math.ceil(outer / LAND_CELL) * LAND_CELL; x < outer; x += LAND_CELL) for (let z = -Math.ceil(outer / LAND_CELL) * LAND_CELL; z < outer; z += LAND_CELL) {
    const corners = [{ x, z }, { x: x + LAND_CELL, z }, { x: x + LAND_CELL, z: z + LAND_CELL }, { x, z: z + LAND_CELL }], middle = { x: x + LAND_CELL / 2, z: z + LAND_CELL / 2 };
    if (corners.some(p => { const r = Math.hypot(p.x, p.z); return r < inner || r > outer; }) || !clear(corners, middle)) continue;
    angles.push(Math.atan2(middle.z, middle.x));
  }
  return balancedBorders(angles, BORDERS[0], count);
}

function islandLand(world: WorldData, cuts: readonly number[] = BORDERS): LandGrid {
  const line = world.railway, square = stationSquare(world), streets = world.roads.streets;
  // What stays of the city on the mainland: the station with its square and its street.
  const mainland = mainlandOf(world);
  const kept = near(streets, -mainland.outer, mainland.outer, -mainland.outer, mainland.outer).filter(([ax, az, bx, bz]) => Math.max(Math.hypot(ax, az), Math.hypot(bx, bz)) > mainland.inner);
  const clear = (corners: Point[], centre: Point) => {
    if (line && [...corners, centre].some(p => onRailway(line, p, 1) || (square ? onSquare(line, square, p, 1) : false))) return false;
    return !kept.length || offStreets(kept, corners, centre);
  };
  const b = builder(clear);
  // The ring roads' circles still part the bands, whose land costs more nearer the centre.
  const rings = world.spec.roadRings.filter(r => r > mainland.inner && r < mainland.outer);
  const edges = [mainland.inner + 1.2, ...rings, mainland.outer - 1.5], inner = edges[0], outer = edges[edges.length - 1];
  const borders = cuts.map(wrap).sort((p, q) => p - q), districtOf = (a: number) => {
    // District k runs counter-clockwise from cuts[k - 1] to cuts[k] (wrapping round).
    const x = wrap(a), start = [...borders].reverse().find(o => o <= x) ?? borders[borders.length - 1];
    return cuts.map(wrap).indexOf(start) + 1;
  };
  const sectors: LandSector[] = borders.map((from, i) => {
    const to = i + 1 < borders.length ? borders[i + 1] : borders[0] + TAU;
    return { district: districtOf((from + to) / 2), a0: from, a1: to, r0: inner, r1: outer };
  });
  /** Is an area (by its corners) on the land, and in the sector BORDER_GAP clear of both its cuts? */
  const within = (s: LandSector, corners: Point[]) => {
    const fx = Math.cos(s.a0), fz = Math.sin(s.a0), tx = Math.cos(s.a1), tz = Math.sin(s.a1);
    return corners.every(p => {
      const r = Math.hypot(p.x, p.z);
      return r >= inner && r <= outer && fx * p.z - fz * p.x >= BORDER_GAP && p.x * tz - p.z * tx >= BORDER_GAP;
    });
  };
  /** The same for a cell of the lattice from (x, z): its corners, the nearest and the farthest, decide. */
  const cellWithin = (s: LandSector, x: number, z: number) => {
    const fx = Math.cos(s.a0), fz = Math.sin(s.a0), tx = Math.cos(s.a1), tz = Math.sin(s.a1), X = x + LAND_CELL, Z = z + LAND_CELL;
    const near = Math.hypot(Math.min(Math.abs(x), Math.abs(X)), Math.min(Math.abs(z), Math.abs(Z))), far = Math.hypot(Math.max(Math.abs(x), Math.abs(X)), Math.max(Math.abs(z), Math.abs(Z)));
    if (near < inner || far > outer) return false;
    // The cuts' lines: the corners furthest round towards them.
    return Math.min(fx * z - fz * x, fx * Z - fz * x, fx * z - fz * X, fx * Z - fz * X) >= BORDER_GAP && Math.min(x * tz - z * tx, X * tz - z * tx, x * tz - Z * tx, X * tz - Z * tx) >= BORDER_GAP;
  };
  const cell = (x: number, z: number): Point[] => [{ x, z }, { x: x + LAND_CELL, z }, { x: x + LAND_CELL, z: z + LAND_CELL }, { x, z: z + LAND_CELL }];
  const lattice = (v: number) => Math.round(v / LAND_CELL) * LAND_CELL;
  // Each district's centre: in the second band on the middle of its sector, its front at the band's inner edge looking
  // to the middle of the city along x or z, whichever it faces most; on the lattice, clear of the station.
  const wide = Math.ceil(CENTRE_WIDTH / LAND_CELL - 1e-9) * LAND_CELL, deep = Math.ceil(CENTRE_DEPTH / LAND_CELL - 1e-9) * LAND_CELL;
  const sites = sectors.map(s => {
    const a = (s.a0 + s.a1) / 2, c = Math.cos(a), sn = Math.sin(a);
    const side: BlockSide = Math.abs(c) > Math.abs(sn) ? (c > 0 ? "x0" : "x1") : (sn > 0 ? "z0" : "z1");
    const w = side === "x0" || side === "x1" ? deep : wide, d = side === "x0" || side === "x1" ? wide : deep;
    for (let r = edges[1]; r < edges[2]; r += LAND_CELL / 4) {
      const x0 = lattice(side === "x0" ? c * r : side === "x1" ? c * r - w : c * r - w / 2), z0 = lattice(side === "z0" ? sn * r : side === "z1" ? sn * r - d : sn * r - d / 2);
      const x1 = x0 + w, z1 = z0 + d, nearest = Math.hypot(Math.min(Math.max(0, x0), x1), Math.min(Math.max(0, z0), z1));
      if (nearest < edges[1] || !within(s, [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }])) continue;
      let free = true;
      for (let x = x0; x < x1 && free; x += LAND_CELL) for (let z = z0; z < z1 && free; z += LAND_CELL) free = clear(cell(x, z), { x: x + LAND_CELL / 2, z: z + LAND_CELL / 2 });
      if (free) return { side, x0, x1, z0, z1 };
    }
    return null;
  });
  const onSite = (p: Point) => sites.some(t => t && p.x > t.x0 && p.x < t.x1 && p.z > t.z0 && p.z < t.z1);
  const centres: DistrictCentre[] = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const band = k + 1, r0 = edges[k], r1 = edges[k + 1];
    sectors.forEach((s, i) => {
      // The band's cells of the sector, on the lattice round its piece of the sector (along its arcs, a cell beyond):
      // their middles in the band, all of them on the land and in the sector, off the centres.
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let j = 0; j <= 120; j++) for (const r of [r0, r1]) {
        const a = s.a0 + (s.a1 - s.a0) * j / 120, x = Math.cos(a) * r, z = Math.sin(a) * r;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
      // A lattice square by its first corner (x, z), as a number.
      const own = new Set<number>(), key = (x: number, z: number) => (Math.round(x / LAND_CELL) + 4096) * 8192 + Math.round(z / LAND_CELL) + 4096;
      let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
      for (let x = lattice(x0) - LAND_CELL; x <= lattice(x1) + LAND_CELL; x += LAND_CELL) for (let z = lattice(z0) - LAND_CELL; z <= lattice(z1) + LAND_CELL; z += LAND_CELL) {
        const middle = { x: x + LAND_CELL / 2, z: z + LAND_CELL / 2 }, r = Math.hypot(middle.x, middle.z);
        if (r < r0 || r >= r1 || onSite(middle) || !cellWithin(s, x, z)) continue;
        own.add(key(x, z));
        bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x + LAND_CELL); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z + LAND_CELL);
      }
      // The block is the rectangle round them; the second band's takes in the district's centre.
      const site = band === 2 ? sites[i] : null;
      if (site) { bx0 = Math.min(bx0, site.x0); bx1 = Math.max(bx1, site.x1); bz0 = Math.min(bz0, site.z0); bz1 = Math.max(bz1, site.z1); }
      if (!(bx1 > bx0)) return;
      const keep = (c: number, r: number) => own.has(key(bx0 + c * LAND_CELL, bz0 + r * LAND_CELL));
      const block = b.add(s.district, band, { kind: "rect", x0: bx0, x1: bx1, z0: bz0, z1: bz1 }, Math.round((bx1 - bx0) / LAND_CELL), Math.round((bz1 - bz0) / LAND_CELL), keep);
      if (block && site) {
        const col = Math.round((site.x0 - bx0) / LAND_CELL), row = Math.round((site.z0 - bz0) / LAND_CELL);
        centres.push(b.centreAt(block, col, row, Math.round((site.x1 - site.x0) / LAND_CELL), Math.round((site.z1 - site.z0) / LAND_CELL), site.side));
      }
    });
  }
  centres.sort((p, q) => p.district - q.district);
  return { city: "support", bands: edges.length - 1, blocks: b.blocks, centres, sectors };
}

/**
 * The lake city's lines on the cells' lattice (world/sales.ts sizes its land by them): the inner square round the lake,
 * the frame round it and the edge of the town's first land, where its streets ran; then the edges of the fourth band
 * and of the whole land, which make the lake city's land as large as the island city's.
 */
export const LAKE_LINES = { inner: 66, frameX: 132, frameZ: 111, firstX: 141, firstZ: 120, ringX: 222, ringZ: 183, edgeX: 303, edgeZ: 249 } as const;

/**
 * Where the lake city's station stood at the edge of its first land, before the land grew round it (2.14–2.24.119). Cut
 * into 2, 4 or 5 districts, the first land keeps its cells round it as they were: the cuts between the districts and
 * their blocks there come from those cells, so what the districts built there keeps its address.
 */
const FIRST_STATION: RailLine = { x: 4, z: 128, dx: 0, dz: 1, length: 56, side: 1 };

/**
 * Is a lake city's cell (by its corners, `centre` its middle) clear of the lake's shore, the pier, the boulevard from
 * the lake to the station's forecourt, the streets, the railway and the station's square?
 */
function lakeClear(lake: number, line: RailLine | undefined, square: StationSquare | null, streets: readonly Road[]) {
  const pier = rectangle(4, 48, 0, 44, 18, 0), end = (line ? railPoint(line, STATION.forecourt).z : 112) + 3;
  const boulevard = rectangle(0, (55 + end) / 2, 0, end - 55, 10.4, 0);
  return (corners: Point[], centre: Point) => {
    if (corners.some(p => Math.hypot(p.x, p.z) < lake)) return false;
    if (polygonsOverlap(corners, pier) || polygonsOverlap(corners, boulevard)) return false;
    if (streets.length && !offStreets(streets, corners, centre)) return false;
    return !(line && [...corners, centre].some(p => onRailway(line, p, 1) || (square ? onSquare(line, square, p, 1) : false)));
  };
}

/**
 * The lake city: rectangles round the lake on the lines where its streets ran, every cell LAND_CELL across. District 1
 * has the top, 2 the left and the bottom left, 3 the right and the bottom right; the boulevard from the lake to the
 * station parts the bottom. Bands: the corners of the inner square by the lake, the frame round it, the strips at the
 * edge of the first land, then two bands round it out to the hills. Each block lies on one side of every district
 * border, so a border runs along whole block sides, where both blocks keep half the gap clear.
 */
function lakeLand(world: WorldData): LandGrid {
  const rect = world.land.rectangle!, clear = lakeClear((rect.lake ?? 46) + 12, world.railway, stationSquare(world), world.roads.streets);
  const b = builder(clear), g = BORDER_GAP / 2;
  const { inner: INNER, frameX: OUTER_X, frameZ: OUTER_Z, firstX: FIRST_X, firstZ: FIRST_Z, ringX: RING_X, ringZ: RING_Z, edgeX: EDGE_X, edgeZ: EDGE_Z } = LAKE_LINES;
  type Cut = Partial<Record<BlockSide, true | number>>;
  /**
   * A block from x0 to x1 and z0 to z1; `cut` names its sides along a district border, which keep half the gap clear
   * (or as much as given).
   */
  const add = (district: number, band: number, x0: number, x1: number, z0: number, z1: number, cut: Cut = {}) => {
    const by = (side: BlockSide) => cut[side] === true ? g : cut[side] ?? 0;
    return b.add(district, band, { kind: "rect", x0: x0 + by("x0"), x1: x1 - by("x1"), z0: z0 + by("z0"), z1: z1 - by("z1") }, Math.round((x1 - x0) / LAND_CELL), Math.round((z1 - z0) / LAND_CELL));
  };
  /** District 2's block, or district 3's: its mirror image, the cut sides with it. */
  const side = (district: number, band: number, x0: number, x1: number, z0: number, z1: number, cut: Cut = {}) => district === 2
    ? add(district, band, x0, x1, z0, z1, cut)
    : add(district, band, -x1, -x0, z0, z1, { x0: cut.x1, x1: cut.x0, z0: cut.z0, z1: cut.z1 });
  // District 1, the top: the lake's top corners, the frame's top in three (its middle meets district 1's own corners), the top strip.
  add(1, 1, -INNER, INNER, -INNER, 0, { x0: true, x1: true, z1: true });
  add(1, 2, -OUTER_X, -INNER, -OUTER_Z, -INNER, { x0: true, z1: true });
  const top = add(1, 2, -INNER, INNER, -OUTER_Z, -INNER);
  add(1, 2, INNER, OUTER_X, -OUTER_Z, -INNER, { x1: true, z1: true });
  add(1, 3, -OUTER_X, OUTER_X, -FIRST_Z, -OUTER_Z);
  // Districts 2 and 3, mirror images: the lake's bottom corner, the frame's side (in two: its top half meets district 1)
  // and bottom, the side strip (in two likewise) and the bottom strip.
  const sides = [2, 3].map(district => {
    const put = (band: number, x0: number, x1: number, z0: number, z1: number, cut: Cut = {}) => side(district, band, x0, x1, z0, z1, cut);
    put(1, -INNER, 0, 0, INNER, { x1: true, z0: true });
    put(2, -OUTER_X, -INNER, -INNER, 0, { x1: true, z0: true });
    const frame = put(2, -OUTER_X, -INNER, 0, INNER);
    put(2, -OUTER_X, 0, INNER, OUTER_Z, { x1: true });
    put(3, -FIRST_X, -OUTER_X, -OUTER_Z, -INNER, { x1: true });
    put(3, -FIRST_X, -OUTER_X, -INNER, OUTER_Z);
    put(3, -OUTER_X, 0, OUTER_Z, FIRST_Z, { x1: true });
    return frame;
  });
  // The land round the first, its blocks numbered after the first land's, which keep theirs. The first land's corners,
  // where the frame's streets met its edge: the top two district 1's, the whole gap kept from the side strips of 2 and 3
  // below them; the bottom two the side districts' own.
  add(1, 3, -FIRST_X, -OUTER_X, -FIRST_Z, -OUTER_Z, { z1: BORDER_GAP });
  add(1, 3, OUTER_X, FIRST_X, -FIRST_Z, -OUTER_Z, { z1: BORDER_GAP });
  for (const district of [2, 3]) side(district, 3, -FIRST_X, -OUTER_X, OUTER_Z, FIRST_Z);
  // Two bands round it, each from the edge of the last. District 1 has the top from edge to edge: its outer pieces reach
  // down to the frame's top street, where its border with 2 and 3 runs on from the first land's corners to the edge,
  // district 1 keeping the whole gap as there. 2 and 3 have the sides below it and the bottom, parted by the boulevard.
  for (const [band, ix, iz, ox, oz] of [[4, FIRST_X, FIRST_Z, RING_X, RING_Z], [5, RING_X, RING_Z, EDGE_X, EDGE_Z]]) {
    add(1, band, -ix, ix, -oz, -iz);
    add(1, band, -ox, -ix, -oz, -OUTER_Z, { z1: BORDER_GAP });
    add(1, band, ix, ox, -oz, -OUTER_Z, { z1: BORDER_GAP });
    for (const district of [2, 3]) {
      side(district, band, -ox, -ix, -OUTER_Z, oz);
      side(district, band, -ix, 0, iz, oz, { x1: true });
    }
  }
  const centres = [
    ...(top ? [b.centre(top, "z1")] : []),
    ...(sides[0] ? [b.centre(sides[0], "x1")] : []),
    ...(sides[1] ? [b.centre(sides[1], "x0")] : []),
  ];
  return { city: "sales", bands: 5, blocks: b.blocks, centres };
}

/**
 * The lake city cut into `count` districts other than its first three: the same land (the inner square by the lake,
 * the frame round it, the strips at the edge of the first land and the two bands round it) on the same lattice, parted
 * by straight cuts out from the lake's middle into districts of about equal numbers of cells, the first along the
 * boulevard to the station. As on the island city, each band of each district is one block round its cells, its
 * centre in the second band on the middle of its sector. The first land is cut as it was round its first station
 * (FIRST_STATION), and its cells alone set the cuts and the centres: its blocks keep their cells' addresses.
 */
function lakeSectorLand(world: WorldData, count: number): LandGrid {
  const rect = world.land.rectangle!, lake = (rect.lake ?? 46) + 12, firstSquare = lakeSquare(FIRST_STATION);
  const clear = lakeClear(lake, world.railway, stationSquare(world), world.roads.streets), first = lakeClear(lake, FIRST_STATION, firstSquare, firstSquare.streets);
  const { inner: INNER, frameX: OUTER_X, frameZ: OUTER_Z, firstX: FIRST_X, firstZ: FIRST_Z, ringX: RING_X, ringZ: RING_Z, edgeX: EDGE_X, edgeZ: EDGE_Z } = LAKE_LINES;
  /** The band of the cell from (x, z): 0 off the land (past the edge, or in a corner of the first land beyond both strips). */
  const bandOf = (x: number, z: number) => {
    const X = x + LAND_CELL, Z = z + LAND_CELL;
    if (x < -EDGE_X || X > EDGE_X || z < -EDGE_Z || Z > EDGE_Z) return 0;
    const mx = Math.abs(x + LAND_CELL / 2), mz = Math.abs(z + LAND_CELL / 2);
    if (mx > FIRST_X || mz > FIRST_Z) return mx < RING_X && mz < RING_Z ? 4 : 5;
    const ax = Math.min(Math.abs(x), Math.abs(X)), az = Math.min(Math.abs(z), Math.abs(Z));
    if (ax >= OUTER_X && az >= OUTER_Z) return 0;
    return mx < INNER && mz < INNER ? 1 : mx < OUTER_X && mz < OUTER_Z ? 2 : 3;
  };
  const cell = (x: number, z: number): Point[] => [{ x, z }, { x: x + LAND_CELL, z }, { x: x + LAND_CELL, z: z + LAND_CELL }, { x, z: z + LAND_CELL }];
  const middle = (x: number, z: number) => ({ x: x + LAND_CELL / 2, z: z + LAND_CELL / 2 });
  // Every cell for sale once, by its band; the cuts share them out.
  const land: { x: number; z: number; band: number }[] = [];
  for (let x = -EDGE_X; x < EDGE_X; x += LAND_CELL) for (let z = -EDGE_Z; z < EDGE_Z; z += LAND_CELL) {
    const band = bandOf(x, z);
    if (band && (band <= 3 ? first : clear)(cell(x, z), middle(x, z))) land.push({ x, z, band });
  }
  const bands = [1, 2, 3, 4, 5].map(band => land.filter(c => c.band === band));
  const cuts = balancedBorders(bands.slice(0, 3).flat().map(c => Math.atan2(c.z + LAND_CELL / 2, c.x + LAND_CELL / 2)), 90 * DEG, count);
  const reach = Math.hypot(EDGE_X, EDGE_Z) + LAND_CELL;
  const sectors: LandSector[] = cuts.map((from, i) => {
    const next = cuts[(i + 1) % cuts.length];
    return { district: i + 1, a0: from, a1: from + (wrap(next - from) || TAU), r0: lake, r1: reach };
  });
  /** Is a cell (its first corner) in the sector, BORDER_GAP clear of both its cuts? */
  const cellWithin = (s: LandSector, x: number, z: number) => {
    const fx = Math.cos(s.a0), fz = Math.sin(s.a0), tx = Math.cos(s.a1), tz = Math.sin(s.a1), X = x + LAND_CELL, Z = z + LAND_CELL;
    const m = middle(x, z);
    if (wrap(Math.atan2(m.z, m.x) - s.a0) >= s.a1 - s.a0) return false;
    return Math.min(fx * z - fz * x, fx * Z - fz * x, fx * z - fz * X, fx * Z - fz * X) >= BORDER_GAP && Math.min(x * tz - z * tx, X * tz - z * tx, x * tz - Z * tx, X * tz - Z * tx) >= BORDER_GAP;
  };
  // A block keeps only cells of `land`, each of them checked already.
  const b = builder(() => true), lattice = (v: number) => Math.round(v / LAND_CELL) * LAND_CELL;
  const wide = Math.ceil(CENTRE_WIDTH / LAND_CELL - 1e-9) * LAND_CELL, deep = Math.ceil(CENTRE_DEPTH / LAND_CELL - 1e-9) * LAND_CELL;
  // Each district's centre: in the second band on the middle of its sector, its front to the lake.
  const sites = sectors.map(s => {
    const a = s.a0 + (s.a1 - s.a0) / 2, c = Math.cos(a), sn = Math.sin(a);
    const side: BlockSide = Math.abs(c) > Math.abs(sn) ? (c > 0 ? "x0" : "x1") : (sn > 0 ? "z0" : "z1");
    const w = side === "x0" || side === "x1" ? deep : wide, d = side === "x0" || side === "x1" ? wide : deep;
    for (let r = INNER; r < reach; r += LAND_CELL / 4) {
      const x0 = lattice(side === "x0" ? c * r : side === "x1" ? c * r - w : c * r - w / 2), z0 = lattice(side === "z0" ? sn * r : side === "z1" ? sn * r - d : sn * r - d / 2);
      let free = true;
      for (let x = x0; x < x0 + w && free; x += LAND_CELL) for (let z = z0; z < z0 + d && free; z += LAND_CELL) free = bandOf(x, z) === 2 && cellWithin(s, x, z) && first(cell(x, z), middle(x, z));
      if (free) return { side, x0, x1: x0 + w, z0, z1: z0 + d };
    }
    return null;
  });
  const onSite = (p: Point) => sites.some(t => t && p.x > t.x0 && p.x < t.x1 && p.z > t.z0 && p.z < t.z1);
  const centres: DistrictCentre[] = [];
  for (let band = 1; band <= 5; band++) sectors.forEach((s, i) => {
    const own = new Set<string>();
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const c of bands[band - 1]) {
      if (onSite(middle(c.x, c.z)) || !cellWithin(s, c.x, c.z)) continue;
      own.add(`${c.x}:${c.z}`);
      bx0 = Math.min(bx0, c.x); bx1 = Math.max(bx1, c.x + LAND_CELL); bz0 = Math.min(bz0, c.z); bz1 = Math.max(bz1, c.z + LAND_CELL);
    }
    const site = band === 2 ? sites[i] : null;
    if (site) { bx0 = Math.min(bx0, site.x0); bx1 = Math.max(bx1, site.x1); bz0 = Math.min(bz0, site.z0); bz1 = Math.max(bz1, site.z1); }
    if (!(bx1 > bx0)) return;
    const keep = (col: number, row: number) => own.has(`${bx0 + col * LAND_CELL}:${bz0 + row * LAND_CELL}`);
    const block = b.add(s.district, band, { kind: "rect", x0: bx0, x1: bx1, z0: bz0, z1: bz1 }, Math.round((bx1 - bx0) / LAND_CELL), Math.round((bz1 - bz0) / LAND_CELL), keep);
    if (block && site) centres.push(b.centreAt(block, Math.round((site.x0 - bx0) / LAND_CELL), Math.round((site.z0 - bz0) / LAND_CELL), Math.round((site.x1 - site.x0) / LAND_CELL), Math.round((site.z1 - site.z0) / LAND_CELL), site.side));
  });
  centres.sort((p, q) => p.district - q.district);
  return { city: "sales", bands: 5, blocks: b.blocks, centres, sectors };
}
