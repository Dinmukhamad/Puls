/**
 * Moving and turning the small things on the chosen cells (docs/CITY_ESTATES.md, «Подвинуть и повернуть»): the panel's
 * arrows move one's own (in the test city anyone's) a cell left, right, up or down the screen, all together, so a
 * line moves along itself; lamps and benches among them turn a quarter, a lamp to the next side of its cell, a bench
 * to look there. Pure helpers of the docks: the requests to send and the cells chosen after; the server checks again.
 */
import type { DecorMove, DecorTurn, DistrictEstate } from "../../api/cityEstate";
import type { ChosenCell } from "../../city3d/types";
import { decorKey, decorMap, decorSide, isTurning, turnFrom } from "../../city3d/world/decor";
import { neighbours, type LandBlock, type LandGrid, type Way } from "../../city3d/world/land";

/** Which way of the cells is up the screen and which to its right, as the map tells it (EstatePick "screen"). */
export interface ScreenWays { up: Way; right: Way }
export type Arrow = "up" | "down" | "left" | "right";
/** Before the map has told it: up the screen along the rows. */
export const DEFAULT_SCREEN: ScreenWays = { up: "row-", right: "col+" };
const OPPOSITE: Record<Way, Way> = { "row-": "row+", "row+": "row-", "col-": "col+", "col+": "col-" };
export const arrowWay = (screen: ScreenWays, arrow: Arrow): Way =>
  arrow === "up" ? screen.up : arrow === "down" ? OPPOSITE[screen.up] : arrow === "right" ? screen.right : OPPOSITE[screen.right];

const blockOf = (grid: LandGrid, district: number, block: number): LandBlock | undefined => grid.blocks.find(b => b.district === district && b.block === block);
/** The chosen cells with a small thing the viewer may move: their own, the district's, in the test city anyone's. */
const movable = (cells: readonly ChosenCell[]) => cells.filter(c => c.state === "own");

/** Cells something stands on in the district: buildings' and small things'. */
function takenCells(land: DistrictEstate) {
  const out = new Set<string>();
  for (const o of land.objects) if (o.module !== null && o.module !== 0 && o.u !== null && o.v !== null)
    for (let i = 0; i < o.w; i++) for (let j = 0; j < o.h; j++) out.add(decorKey(land.number, o.module, o.u + i, o.v + j));
  for (const cells of Object.values(land.decor ?? {})) for (const [block, col, row] of cells ?? []) out.add(decorKey(land.number, block, col, row));
  return out;
}

export interface Shift { moves: DecorMove[]; cells: ChosenCell[]; problem: string | null }
/**
 * Where the small things on the chosen cells go a cell `way`: the moves to send and the cells to choose after (where
 * they went), or why they cannot. Where they go must be the district's land, free or left by another of them.
 */
export function shiftChosen(grid: LandGrid, land: DistrictEstate, cells: readonly ChosenCell[], way: Way): Shift {
  const own = movable(cells), leaving = new Set(own.map(c => decorKey(land.number, c.block, c.col, c.row))), taken = takenCells(land);
  const moves: DecorMove[] = [], next: ChosenCell[] = [];
  for (const c of own) {
    const block = blockOf(grid, land.number, c.block);
    const there = block && neighbours(grid, block, c.col, c.row, way);
    // Across the seam of two bands a cell may meet two: the one across its middle.
    const to = there?.find(n => n.from <= .5 && n.to >= .5) ?? there?.[0];
    if (!to || to.block.district !== land.number) return { moves: [], cells: [], problem: "Дальше не подвинуть: там кончается земля района." };
    const key = decorKey(land.number, to.block.block, to.col, to.row);
    if (taken.has(key) && !leaving.has(key)) return { moves: [], cells: [], problem: "Дальше не подвинуть: клетка рядом занята." };
    moves.push([c.block, c.col, c.row, to.block.block, to.col, to.row]);
    next.push({ block: to.block.block, col: to.col, row: to.row, band: to.block.band, state: "own" });
  }
  return { moves, cells: next, problem: null };
}

/** The lamps and benches on the chosen cells that the viewer may turn. */
export function turnableChosen(land: DistrictEstate | null, cells: readonly ChosenCell[]) {
  if (!land) return [];
  const map = decorMap([land]);
  return movable(cells).filter(c => isTurning(map.get(decorKey(land.number, c.block, c.col, c.row))?.family));
}
/** Each lamp and bench on the chosen cells a quarter turn on from where it is now: `step` +1 to the left, -1 to the right. */
export function turnChosen(grid: LandGrid, land: DistrictEstate, cells: readonly ChosenCell[], step: 1 | -1): DecorTurn[] {
  const map = decorMap([land]), out: DecorTurn[] = [];
  for (const c of turnableChosen(land, cells)) {
    const block = blockOf(grid, land.number, c.block);
    if (block) out.push([c.block, c.col, c.row, turnFrom(decorSide(grid, map, block, c.col, c.row), step)]);
  }
  return out;
}
