/**
 * The small things operators lay on their district's cells (docs/CITY_ESTATES.md, «Мелкие постройки»), one to a
 * cell: roads and footpaths that join their neighbours into streets, corners and crossings, hedges that close into a
 * fence, and trees, lamps, benches, bushes and flowerbeds. A building turns its front to a road beside it. Pure
 * data, no three.js: the paving as coloured quads for one mesh, everything else as placements for the instance
 * pools, the same pieces the yards and parks are made of.
 */
import type { DecorFamily } from "./estateGrid";
import { WAYS, areaCorners, areaPoint, homeSide, neighbours, sideOf, turnedSide, type BlockSide, type LandBlock, type LandGrid, type Neighbour, type Way } from "./land";
import type { Placement, PlacementKind, Point } from "./types";

/** What stands on a cell: its kind and whether the viewer may take it away (laid it, or it is their district's). */
export interface DecorAt { family: DecorFamily; mine: boolean }
/** The small things of a city by cell: `${district}:${block}:${col}:${row}`. */
export type DecorMap = Map<string, DecorAt>;
export const decorKey = (district: number, block: number, col: number, row: number) => `${district}:${block}:${col}:${row}`;

/** The cells of every district as the server lists them: [block, column, row, mine] by kind. */
export function decorMap(districts: readonly { number: number; decor?: Partial<Record<DecorFamily, [number, number, number, number][]>> }[]): DecorMap {
  const map: DecorMap = new Map();
  for (const d of districts) for (const [family, cells] of Object.entries(d.decor ?? {}) as [DecorFamily, [number, number, number, number][]][]) {
    for (const [block, col, row, mine] of cells) map.set(decorKey(d.number, block, col, row), { family, mine: !!mine });
  }
  return map;
}

/** Which kinds a kind runs into: a footpath meets a road, a road only roads, a hedge closes with hedges. */
const JOINS: Partial<Record<DecorFamily, readonly DecorFamily[]>> = { road: ["road"], path: ["path", "road"], hedge: ["hedge"] };
const ROADLIKE: readonly DecorFamily[] = ["road", "path"];

/** The neighbours a cell's small thing joins, way by way. */
export function joins(grid: LandGrid, map: DecorMap, block: LandBlock, col: number, row: number, family: DecorFamily): { way: Way; to: Neighbour }[] {
  const kinds = JOINS[family];
  if (!kinds) return [];
  const out: { way: Way; to: Neighbour }[] = [];
  for (const way of WAYS) for (const to of neighbours(grid, block, col, row, way)) {
    const there = map.get(decorKey(block.district, to.block.block, to.col, to.row));
    if (there && kinds.includes(there.family)) out.push({ way, to });
  }
  return out;
}

/** The ground of the roads and footpaths: flat quads (corners in order), each at its height in its colour. */
export interface GroundQuad { points: Point[]; y: number; colour: string }
export interface DecorLayout { ground: GroundQuad[]; placements: Placement[]; lamps: Placement[] }

/** Land top (render/terrain.ts TOP); the paving lies a little over the grass and the yards' lawns, under the district borders. */
const TOP = .2;
const PAVEMENT = { y: TOP + .009, colour: "#ddd6c4" }, ASPHALT = { y: TOP + .015, colour: "#6d7385" }, MARK = { y: TOP + .021, colour: "#f7f3e8" };
const FOOTPATH = { y: TOP + .013, colour: "#d7ccb6" };
/** Half the width of a road's asphalt and of a footpath, in units; a cell is about three across. */
const ROAD_HALF = 1.05, PATH_HALF = .55;
const TREES: Partial<Record<DecorFamily, [PlacementKind, number]>> = { tree: ["tree-round", 1.35], pine: ["tree-cone", 1.25], birch: ["tree-birch", 1.25], oak: ["tree-oak", 1.15] };

/** A small seeded number for a cell, so a tree or a bench always stands the same way. */
function jitter(block: LandBlock, col: number, row: number, salt: number) {
  let s = (Math.imul(block.district * 977 + block.block * 131 + col * 7919 + row * 104729 + salt * 15485863, 2654435761) ^ 0x9e3779b9) >>> 0;
  s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0;
  return (s >>> 8) / 16777216;
}

/**
 * The paving, pieces and lamps of every small thing on the map. A road is a light pavement over its cell with the
 * asphalt in the middle and an arm out to every road beside it, so the cells read as one street; a lane mark runs down
 * a straight piece. A footpath is a narrower strip the same way. Arms that cross into the next band of the island city
 * meet its cells where their edges overlap, so a road keeps on across the seam.
 */
export function decorLayout(grid: LandGrid, map: DecorMap): DecorLayout {
  const ground: GroundQuad[] = [], placements: Placement[] = [], lamps: Placement[] = [];
  const blocks = new Map(grid.blocks.map(b => [`${b.district}:${b.block}`, b]));
  for (const [key, at] of map) {
    const [district, blockNumber, col, row] = key.split(":").map(Number), block = blocks.get(`${district}:${blockNumber}`);
    if (!block || col >= block.cols || row >= block.rows) continue;
    const corners = areaCorners(block, col, row), centre = areaPoint(corners, .5, .5), links = joins(grid, map, block, col, row, at.family);
    if (at.family === "road" || at.family === "path") {
      const half = at.family === "road" ? ROAD_HALF : PATH_HALF, surface = at.family === "road" ? ASPHALT : FOOTPATH;
      if (at.family === "road") ground.push({ points: corners, ...PAVEMENT });
      paving(ground, corners, links, half, surface);
      if (at.family === "road") lane(ground, corners, links);
      continue;
    }
    // Where the nearest road or footpath beside the cell is, for a lamp at its edge and a bench facing it.
    const toward = roadside(grid, map, block, col, row, centre);
    if (at.family === "hedge") { hedge(placements, col, row, corners, centre, links); continue; }
    const tree = TREES[at.family];
    if (tree) {
      const [kind, size] = tree, dx = (jitter(block, col, row, 1) - .5) * .5, dz = (jitter(block, col, row, 2) - .5) * .5;
      placements.push({ kind, variant: col * 31 + row, x: centre.x + dx, z: centre.z + dz, rotation: jitter(block, col, row, 3) * 6.28, scale: size * (.9 + jitter(block, col, row, 4) * .2), width: 0 });
    } else if (at.family === "lamp") {
      const p = toward ? { x: centre.x + toward.x * .95, z: centre.z + toward.z * .95 } : centre;
      const lamp: Placement = { kind: "lamp", variant: 0, x: p.x, z: p.z, rotation: 0, scale: 1, width: 0 };
      placements.push(lamp); lamps.push(lamp);
    } else if (at.family === "bench") {
      const d = toward ?? facing(block, col, row, centre), p = toward ? { x: centre.x + d.x * .75, z: centre.z + d.z * .75 } : centre;
      placements.push({ kind: "bench", variant: 0, x: p.x, z: p.z, rotation: Math.atan2(d.x, d.z), scale: 1.05, width: .9 });
    } else if (at.family === "bush") {
      placements.push({ kind: "bush", variant: col * 7 + row, x: centre.x, z: centre.z, rotation: jitter(block, col, row, 5) * 6.28, scale: 1.45, width: 0 });
    } else if (at.family === "flowers") {
      placements.push({ kind: "flowerbed", variant: col * 5 + row, x: centre.x, z: centre.z, rotation: jitter(block, col, row, 6) * 6.28, scale: 1.3, width: 1.2 });
    }
  }
  return { ground, placements, lamps };
}

/** The asphalt (or a footpath) of a cell: a square in its middle and an arm out to every neighbour it joins. */
function paving(ground: GroundQuad[], corners: Point[], links: { way: Way; to: Neighbour }[], half: number, surface: { y: number; colour: string }) {
  // The cell's size along its columns (s) and its rows (t), to keep the widths in units on a ring's narrower cells.
  const across = Math.hypot(areaPoint(corners, 1, .5).x - areaPoint(corners, 0, .5).x, areaPoint(corners, 1, .5).z - areaPoint(corners, 0, .5).z);
  const along = Math.hypot(areaPoint(corners, .5, 1).x - areaPoint(corners, .5, 0).x, areaPoint(corners, .5, 1).z - areaPoint(corners, .5, 0).z);
  const hs = Math.min(.48, half / across), ht = Math.min(.48, half / along), P = (s: number, t: number) => areaPoint(corners, s, t);
  ground.push({ points: [P(.5 - hs, .5 - ht), P(.5 + hs, .5 - ht), P(.5 + hs, .5 + ht), P(.5 - hs, .5 + ht)], ...surface });
  for (const { way, to } of links) {
    // The arm leaves the middle square on that side and ends on the edge at the meeting point, as wide as the road.
    const [a, b] = way === "row-" ? [P(.5 - hs, .5 - ht), P(.5 + hs, .5 - ht)] : way === "row+" ? [P(.5 - hs, .5 + ht), P(.5 + hs, .5 + ht)]
      : way === "col-" ? [P(.5 - hs, .5 - ht), P(.5 - hs, .5 + ht)] : [P(.5 + hs, .5 - ht), P(.5 + hs, .5 + ht)];
    const [e0, e1] = way === "row-" ? [P(0, 0), P(1, 0)] : way === "row+" ? [P(0, 1), P(1, 1)] : way === "col-" ? [P(0, 0), P(0, 1)] : [P(1, 0), P(1, 1)];
    const ex = e1.x - e0.x, ez = e1.z - e0.z, el = Math.hypot(ex, ez) || 1, ux = ex / el, uz = ez / el;
    ground.push({ points: [a, b, { x: to.meet.x + ux * half, z: to.meet.z + uz * half }, { x: to.meet.x - ux * half, z: to.meet.z - uz * half }], ...surface });
  }
}

/** A lane mark down a straight piece of road: a cell joining roads on two opposite sides only. */
function lane(ground: GroundQuad[], corners: Point[], links: { way: Way; to: Neighbour }[]) {
  const ways = new Set(links.map(l => l.way));
  if (ways.size !== 2) return;
  const P = (s: number, t: number) => areaPoint(corners, s, t), w = .06;
  const rows = ways.has("row-") && ways.has("row+"), cols = ways.has("col-") && ways.has("col+");
  if (!rows && !cols) return;
  // From a third of the cell to two thirds, along the street.
  const a = rows ? P(.5, .33) : P(.33, .5), b = rows ? P(.5, .67) : P(.67, .5), dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * w, nz = dx / l * w;
  ground.push({ points: [{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }], ...MARK });
}

/** A hedge: clipped pieces from the middle of the cell out to every hedge beside it; on its own, a short run across. */
function hedge(placements: Placement[], col: number, row: number, corners: Point[], centre: Point, links: { way: Way; to: Neighbour }[]) {
  const piece = (from: Point, to: Point) => {
    const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz), n = Math.max(1, Math.round(length / .95));
    for (let k = 0; k < n; k++) {
      const t = (k + .5) / n;
      placements.push({ kind: "hedge", variant: col * 3 + row + k, x: from.x + dx * t, z: from.z + dz * t, rotation: Math.atan2(-dz, dx), scale: 1, width: 0 });
    }
  };
  if (!links.length) { piece(areaPoint(corners, .2, .5), areaPoint(corners, .8, .5)); return; }
  for (const { to } of links) piece(centre, to.meet);
}

/** The direction from a cell's middle to the nearest road or footpath beside it, or null. */
function roadside(grid: LandGrid, map: DecorMap, block: LandBlock, col: number, row: number, centre: Point): Point | null {
  for (const way of WAYS) for (const to of neighbours(grid, block, col, row, way)) {
    const there = map.get(decorKey(block.district, to.block.block, to.col, to.row));
    if (!there || !ROADLIKE.includes(there.family)) continue;
    const dx = to.meet.x - centre.x, dz = to.meet.z - centre.z, l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }
  return null;
}

/** The way a cell looks with nothing beside it: towards the middle of the city. */
function facing(block: LandBlock, col: number, row: number, centre: Point): Point {
  const corners = areaCorners(block, col, row), side = homeSide(block, col, row);
  const edge = side === "in" || side === "z0" ? areaPoint(corners, .5, 0) : side === "out" || side === "z1" ? areaPoint(corners, .5, 1) : side === "a0" || side === "x0" ? areaPoint(corners, 0, .5) : areaPoint(corners, 1, .5);
  const dx = edge.x - centre.x, dz = edge.z - centre.z, l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

/**
 * Where a building's front looks: to the side of its plot with the most road or footpath cells along it, so a house
 * opens onto its street; with none, where its owner turned it (`rotation` quarter turns from facing the middle of the
 * city). `street` says a road runs along the front, so the house's path and driveway go out to it.
 */
export function buildingFacing(grid: LandGrid, map: DecorMap, block: LandBlock, col: number, row: number, cols: number, rows: number, rotation: number): { side: BlockSide; street: boolean } {
  const preferred = turnedSide(block, homeSide(block, col, row, cols, rows), rotation);
  let best: BlockSide | null = null, most = 0;
  for (const way of WAYS) {
    const side = sideOf(block, way), edge: [number, number][] = [];
    if (way === "row-" || way === "row+") for (let c = col; c < col + cols; c++) edge.push([c, way === "row-" ? row : row + rows - 1]);
    else for (let r = row; r < row + rows; r++) edge.push([way === "col-" ? col : col + cols - 1, r]);
    let count = 0;
    for (const [c, r] of edge) for (const to of neighbours(grid, block, c, r, way)) {
      const there = map.get(decorKey(block.district, to.block.block, to.col, to.row));
      if (there && ROADLIKE.includes(there.family)) count++;
    }
    if (count > most || (count === most && count > 0 && side === preferred)) { best = side; most = count; }
  }
  return best ? { side: best, street: true } : { side: preferred, street: false };
}
