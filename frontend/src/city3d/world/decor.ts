/**
 * The small things operators lay on their district's cells (docs/CITY_ESTATES.md, «Мелкие постройки»), one to a
 * cell: roads, footpaths and alleys that join their neighbours into streets, corners and crossings, hedges that close
 * into a fence, and trees, lamps, benches, bushes and flowerbeds. A building turns its front to a road beside it. Pure
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

/** Which kinds a kind runs into: a footpath or an alley meets the other and a road, a road only roads, a hedge closes with hedges. */
const JOINS: Partial<Record<DecorFamily, readonly DecorFamily[]>> = { road: ["road"], path: ["path", "alley", "road"], alley: ["alley", "path", "road"], hedge: ["hedge"] };
const ROADLIKE: readonly DecorFamily[] = ["road", "path", "alley"];

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
const FOOTPATH = { y: TOP + .013, colour: "#d7ccb6" }, GRAVEL = { y: TOP + .013, colour: "#cbb994" };
/** On wide areas: the kerb along a road's asphalt, a footpath square's tile joints and its border. */
const KERB = { y: TOP + .018, colour: "#c4bfb2" }, JOINT = { y: TOP + .016, colour: "#c9bda5" }, BORDER = { y: TOP + .016, colour: "#baac90" };
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
 * a straight piece. A footpath is a narrower strip the same way, and an alley a gravel one with trees beside it. Arms
 * that cross into the next band of the island city meet its cells where their edges overlap, so a road keeps on across
 * the seam. Laid two or three cells wide they become more: a road with a lane to each row of cells, a boulevard, a
 * paved square (areaPlace).
 */
export function decorLayout(grid: LandGrid, map: DecorMap): DecorLayout {
  const ground: GroundQuad[] = [], placements: Placement[] = [], lamps: Placement[] = [];
  const blocks = new Map(grid.blocks.map(b => [`${b.district}:${b.block}`, b]));
  for (const [key, at] of map) {
    const [district, blockNumber, col, row] = key.split(":").map(Number), block = blocks.get(`${district}:${blockNumber}`);
    if (!block || col >= block.cols || row >= block.rows) continue;
    const corners = areaCorners(block, col, row), centre = areaPoint(corners, .5, .5), links = joins(grid, map, block, col, row, at.family);
    if (at.family === "road" || at.family === "path" || at.family === "alley") {
      const half = at.family === "road" ? ROAD_HALF : PATH_HALF, surface = at.family === "road" ? ASPHALT : at.family === "alley" ? GRAVEL : FOOTPATH;
      const area = areaPlace(grid, map, block, col, row, at.family), wide = area.width >= 2;
      if (at.family === "road") ground.push({ points: corners, ...PAVEMENT });
      if (at.family === "alley" && wide && area.along) {
        // A boulevard: a walk down each row of cells, crossing to the next only every fourth cell, grass between.
        const { lo, hi } = sidesOf(area.along), cross = area.at % 4 === 1;
        paving(ground, corners, links.filter(l => cross || (l.way !== lo && l.way !== hi)), half, surface);
        boulevard(placements, block, col, row, corners, links, area, cross);
      } else paving(ground, corners, links, half, surface, inside(grid, map, block, links, at.family));
      if (at.family === "road") { lane(ground, corners, links); if (wide) roadMarks(ground, corners, links, area); }
      if (at.family === "path" && wide) pathSquare(ground, placements, block, col, row, corners, links, area);
      if (at.family === "alley") alleyTrees(placements, block, col, row, corners, links);
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

/** Where a cell lies in an area of its kind: the way the area runs, how wide it is across that and where in it the cell is. */
interface AreaPlace { along: "col" | "row" | null; width: number; across: number; at: number }
type CellAt = { block: LandBlock; col: number; row: number };
/**
 * A cell's place in the area of its kind it belongs to. The area runs along the longer of the two runs of that kind
 * through the cell; `width` counts the rows of it side by side across that, each running along too (a road turning a
 * corner is no wider for it), `across` is the cell's place among them and `at` its place along. A square has no way
 * it runs, and is wide only where four cells of the kind meet.
 */
function areaPlace(grid: LandGrid, map: DecorMap, block: LandBlock, col: number, row: number, family: DecorFamily): AreaPlace {
  const step = (at: CellAt, way: Way): CellAt | undefined => neighbours(grid, at.block, at.col, at.row, way).find(nb => map.get(decorKey(block.district, nb.block.block, nb.col, nb.row))?.family === family);
  const count = (way: Way, along?: readonly [Way, Way]) => {
    let n = 0, at: CellAt = { block, col, row };
    for (let next = step(at, way); next && n < 24 && (!along || step(next, along[0]) || step(next, along[1])); next = step(at, way)) { n++; at = next; }
    return n;
  };
  const cols = [count("col-"), count("col+")], rows = [count("row-"), count("row+")], colRun = cols[0] + 1 + cols[1], rowRun = rows[0] + 1 + rows[1];
  if (colRun > rowRun) { const lo = count("row-", ["col-", "col+"]); return { along: "col", width: lo + 1 + count("row+", ["col-", "col+"]), across: lo, at: cols[0] }; }
  if (rowRun > colRun) { const lo = count("col-", ["row-", "row+"]); return { along: "row", width: lo + 1 + count("col+", ["row-", "row+"]), across: lo, at: rows[0] }; }
  const here: CellAt = { block, col, row }, square = (["col-", "col+"] as const).some(c => (["row-", "row+"] as const).some(r => { const a = step(here, c); return !!a && !!step(here, r) && !!step(a, r); }));
  return { along: null, width: square ? colRun : 1, across: cols[0], at: rows[0] };
}
/** The ways out of a cell for an area running along `along`: back and ahead along it, lo and hi across it. */
const sidesOf = (along: "col" | "row") => along === "col" ? { back: "col-", ahead: "col+", lo: "row-", hi: "row+" } as const : { back: "row-", ahead: "row+", lo: "col-", hi: "col+" } as const;
/**
 * A cell's own frame for an area running along `along`: `at(u, v)` with u along the area and v across it, each 0…1
 * over the cell (beyond, into the next cell); `units` turns world units into fractions of the cell along and across.
 */
function frameOf(corners: Point[], along: "col" | "row") {
  const at = (u: number, v: number) => along === "col" ? areaPoint(corners, u, v) : areaPoint(corners, v, u);
  const length = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const lu = length(at(0, .5), at(1, .5)), lv = length(at(.5, 0), at(.5, 1));
  return { at, u: (units: number) => units / lu, v: (units: number) => units / lv, lu, lv };
}
/** The part of a cell its paving covers in that frame: to the edge on a side it joins, else to its middle strip. */
function pavedSpan(frame: ReturnType<typeof frameOf>, ways: Set<Way>, sides: ReturnType<typeof sidesOf>, half: number) {
  const hu = Math.min(.48, half / frame.lu), hv = Math.min(.48, half / frame.lv);
  return { u0: ways.has(sides.back) ? 0 : .5 - hu, u1: ways.has(sides.ahead) ? 1 : .5 + hu, v0: ways.has(sides.lo) ? 0 : .5 - hv, v1: ways.has(sides.hi) ? 1 : .5 + hv };
}

/**
 * The marks of a road two or three cells wide, a lane to each row of cells: dashes between the lanes, a solid line
 * along each edge inside the kerb, a zebra crossing at each end, and the kerb round the asphalt. A square of road has
 * its kerb only.
 */
function roadMarks(ground: GroundQuad[], corners: Point[], links: { way: Way; to: Neighbour }[], area: AreaPlace) {
  const along = area.along ?? "col", sides = sidesOf(along), f = frameOf(corners, along), ways = new Set(links.map(l => l.way));
  const { u0, u1, v0, v1 } = pavedSpan(f, ways, sides, ROAD_HALF);
  const quad = (a: number, b: number, c: number, d: number, surface: { y: number; colour: string }) => ground.push({ points: [f.at(a, c), f.at(b, c), f.at(b, d), f.at(a, d)], ...surface });
  const kerb = f.v(.05), kerbU = f.u(.05);
  if (!ways.has(sides.lo)) quad(u0, u1, v0 - kerb, v0 + kerb, KERB);
  if (!ways.has(sides.hi)) quad(u0, u1, v1 - kerb, v1 + kerb, KERB);
  if (!ways.has(sides.back)) quad(u0 - kerbU, u0 + kerbU, v0, v1, KERB);
  if (!ways.has(sides.ahead)) quad(u1 - kerbU, u1 + kerbU, v0, v1, KERB);
  if (!area.along) return;
  if (ways.has(sides.hi)) quad(.2, .7, 1 - f.v(.06), 1 + f.v(.06), MARK);
  if (!ways.has(sides.lo)) quad(u0, u1, v0 + f.v(.22), v0 + f.v(.3), MARK);
  if (!ways.has(sides.hi)) quad(u0, u1, v1 - f.v(.3), v1 - f.v(.22), MARK);
  for (const [end, from, step] of [[sides.back, u0, 1], [sides.ahead, u1, -1]] as const) {
    if (ways.has(end)) continue;
    const a = from + step * f.u(.3), b = from + step * f.u(1.1);
    for (let v = v0 + f.v(.4); v + f.v(.3) <= v1 - f.v(.3); v += f.v(.6)) quad(Math.min(a, b), Math.max(a, b), v, v + f.v(.3), MARK);
  }
}

/**
 * A footpath square (two or three cells wide): its paving laid in tiles a unit across, a darker border round its
 * edge, a bench facing in every third cell along its edges and a planter now and then down its middle.
 */
function pathSquare(ground: GroundQuad[], placements: Placement[], block: LandBlock, col: number, row: number, corners: Point[], links: { way: Way; to: Neighbour }[], area: AreaPlace) {
  const along = area.along ?? "col", sides = sidesOf(along), f = frameOf(corners, along), ways = new Set(links.map(l => l.way));
  const { u0, u1, v0, v1 } = pavedSpan(f, ways, sides, PATH_HALF);
  const quad = (a: number, b: number, c: number, d: number, surface: { y: number; colour: string }) => ground.push({ points: [f.at(a, c), f.at(b, c), f.at(b, d), f.at(a, d)], ...surface });
  const ju = f.u(.025), jv = f.v(.025), band = .22;
  for (const u of [0, 1 / 3, 2 / 3]) if (u > u0 || (u === 0 && ways.has(sides.back))) quad(u - ju, u + ju, v0, v1, JOINT);
  for (const v of [0, 1 / 3, 2 / 3]) if (v > v0 || (v === 0 && ways.has(sides.lo))) quad(u0, u1, v - jv, v + jv, JOINT);
  if (!ways.has(sides.lo)) quad(u0, u1, v0, v0 + f.v(band), BORDER);
  if (!ways.has(sides.hi)) quad(u0, u1, v1 - f.v(band), v1, BORDER);
  if (!ways.has(sides.back)) quad(u0, u0 + f.u(band), v0, v1, BORDER);
  if (!ways.has(sides.ahead)) quad(u1 - f.u(band), u1, v0, v1, BORDER);
  // A bench on the grass by an outer edge, facing in; a planter down the middle of a square three cells wide.
  for (const [side, v] of [[sides.lo, .2], [sides.hi, .8]] as const) {
    if (ways.has(side) || area.at % 3 !== 1) continue;
    const p = f.at(.5, v), q = f.at(.5, .5);
    placements.push({ kind: "bench", variant: 0, x: p.x, z: p.z, rotation: Math.atan2(q.x - p.x, q.z - p.z), scale: 1.05, width: .9 });
  }
  if (area.width >= 3 && area.across === Math.floor(area.width / 2) && area.at % 4 === 2) {
    const p = f.at(.5, .5);
    placements.push({ kind: "planter", variant: col * 5 + row, x: p.x, z: p.z, rotation: jitter(block, col, row, 13) * 6.28, scale: 1.2, width: 0 });
  }
}

/**
 * A boulevard's trees and benches (an alley two or three cells wide): a row of trees on the grass between two walks,
 * not where a path crosses, and benches on the grass by its outer edges facing in. Its outer rows of trees are the
 * alley's own (alleyTrees).
 */
function boulevard(placements: Placement[], block: LandBlock, col: number, row: number, corners: Point[], links: { way: Way; to: Neighbour }[], area: AreaPlace, cross: boolean) {
  const along = area.along ?? "col", sides = sidesOf(along), f = frameOf(corners, along), ways = new Set(links.map(l => l.way));
  if (ways.has(sides.hi) && !cross) {
    const p = f.at(.5, 1);
    placements.push({ kind: "tree-round", variant: col * 17 + row * 3, x: p.x, z: p.z, rotation: jitter(block, col, row, 21) * 6.28, scale: 1.05 + jitter(block, col, row, 22) * .15, width: 0 });
  }
  for (const [side, v] of [[sides.lo, .2], [sides.hi, .8]] as const) {
    if (ways.has(side) || area.at % 3 !== 2) continue;
    const p = f.at(.15, v), q = f.at(.15, .5);
    placements.push({ kind: "bench", variant: 0, x: p.x, z: p.z, rotation: Math.atan2(q.x - p.x, q.z - p.z), scale: 1.05, width: .9 });
  }
}

/**
 * The corners of a cell inside an area of its kind (a road two or three cells wide, a square of footpath): where the
 * cells beside it on both sides of the corner and the one across the corner join it too. There the paving runs on.
 */
function inside(grid: LandGrid, map: DecorMap, block: LandBlock, links: { way: Way; to: Neighbour }[], family: DecorFamily): [Way, Way][] {
  const kinds = JOINS[family] ?? [], out: [Way, Way][] = [];
  for (const across of ["row-", "row+"] as const) for (const along of ["col-", "col+"] as const) {
    const a = links.find(l => l.way === across);
    if (!a || !links.some(l => l.way === along)) continue;
    const corner = neighbours(grid, a.to.block, a.to.col, a.to.row, along).some(n => {
      const there = map.get(decorKey(block.district, n.block.block, n.col, n.row));
      return !!there && kinds.includes(there.family);
    });
    if (corner) out.push([across, along]);
  }
  return out;
}

/**
 * The asphalt (or a footpath) of a cell: a square in its middle, an arm out to every neighbour it joins, and the
 * corners `filled` inside a wider area, so a road two or three cells wide is one piece of asphalt with the pavement
 * along its edges only.
 */
function paving(ground: GroundQuad[], corners: Point[], links: { way: Way; to: Neighbour }[], half: number, surface: { y: number; colour: string }, filled: [Way, Way][] = []) {
  // The cell's size along its columns (s) and its rows (t), to keep the widths in units on narrower cells.
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
  for (const [across, along] of filled) {
    const [s0, s1] = along === "col-" ? [0, .5 - hs] : [.5 + hs, 1], [t0, t1] = across === "row-" ? [0, .5 - ht] : [.5 + ht, 1];
    ground.push({ points: [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)], ...surface });
  }
}

/**
 * An alley's trees, on the sides of its cell where nothing it joins lies beside it: along a line of alley, one on
 * either side of the path, so the line has two rows of trees; an alley two or three cells wide has them along its
 * outer edges (the boulevard plants the rows between its walks). A cell on its own or at the end of a line runs
 * straight, its trees on either side.
 */
function alleyTrees(placements: Placement[], block: LandBlock, col: number, row: number, corners: Point[], links: { way: Way; to: Neighbour }[]) {
  const ways = new Set(links.map(l => l.way));
  const ends: readonly Way[] = ways.size <= 1 ? ([...ways][0] ?? "row-").startsWith("row") ? ["col-", "col+"] : ["row-", "row+"] : WAYS.filter(w => !ways.has(w));
  ends.forEach((way, k) => {
    const [s, t] = way === "col-" ? [.17, .5] : way === "col+" ? [.83, .5] : way === "row-" ? [.5, .17] : [.5, .83], p = areaPoint(corners, s, t);
    placements.push({ kind: "tree-round", variant: col * 13 + row * 7 + k, x: p.x, z: p.z, rotation: jitter(block, col, row, 7 + k) * 6.28, scale: .95 + jitter(block, col, row, 11 + k) * .15, width: 0 });
  });
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
  const edge = side === "z0" ? areaPoint(corners, .5, 0) : side === "z1" ? areaPoint(corners, .5, 1) : side === "x0" ? areaPoint(corners, 0, .5) : areaPoint(corners, 1, .5);
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
