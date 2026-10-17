import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({ stdin: { contents: `export * from "./decorArrange.ts"; export { districtPlotGrid } from "./freeDistrictPlot.ts"; export { decorMap, decorSide, TURN_SIDES } from "../../city3d/world/decor.ts"; export { neighbours, sideOf, homeSide } from "../../city3d/world/land.ts";`, resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false });
const A = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

/** A row of eight cells for sale in district 1, side by side along its columns, and the cells round it free. */
function stretch(grid) {
  for (const block of grid.blocks.filter(b => b.district === 1)) for (let r = 1; r + 1 < block.rows; r++) for (let c = 1; c + 9 < block.cols; c++) {
    let free = true;
    for (let i = -1; i <= 9 && free; i++) for (let j = -1; j <= 1 && free; j++) free = !block.skip.has(`${c + i}:${r + j}`);
    if (free) return { block, b: block.block, col: c, row: r };
  }
  throw new Error("no free stretch");
}
const chosen = (b, band, cells, state = "own") => cells.map(([col, row]) => ({ block: b, col, row, band, state }));
const land = (decor, objects = []) => ({ id: "support-team-1", number: 1, objects, decor });

test("the arrows go the way the map says is up the screen and to its right", () => {
  assert.deepEqual(A.DEFAULT_SCREEN, { up: "row-", right: "col+" });
  const screen = { up: "col+", right: "row+" };
  assert.deepEqual(["up", "down", "left", "right"].map(a => A.arrowWay(screen, a)), ["col+", "col-", "row-", "row+"]);
});

test("one's own small things move a cell along, a line along itself, and the cells chosen go with them", () => {
  const grid = A.districtPlotGrid("support"), { block, b, col, row } = stretch(grid);
  const decor = { lamp: [[b, col, row, 1], [b, col + 1, row, 1]], bench: [[b, col + 2, row, 1]] };
  const cells = chosen(b, block.band, [[col, row], [col + 1, row], [col + 2, row]]);
  const shift = A.shiftChosen(grid, land(decor), cells, "col+");
  assert.equal(shift.problem, null);
  assert.deepEqual(shift.moves, [[b, col, row, b, col + 1, row], [b, col + 1, row, b, col + 2, row], [b, col + 2, row, b, col + 3, row]]);
  assert.deepEqual(shift.cells, chosen(b, block.band, [[col + 1, row], [col + 2, row], [col + 3, row]]));
  // Across the line: each a row on.
  assert.deepEqual(A.shiftChosen(grid, land(decor), cells, "row+").moves.map(m => m.slice(3)), [[b, col, row + 1], [b, col + 1, row + 1], [b, col + 2, row + 1]]);
  // Only what the viewer may move goes; free and taken cells chosen stay out of it.
  const mixed = [...chosen(b, block.band, [[col, row]]), ...chosen(b, block.band, [[col + 5, row]], "free"), ...chosen(b, block.band, [[col + 1, row]], "taken")];
  assert.deepEqual(A.shiftChosen(grid, land(decor), mixed, "row-").moves, [[b, col, row, b, col, row - 1]]);
});

test("nothing moves onto a taken cell or past the district's land", () => {
  const grid = A.districtPlotGrid("support"), { block, b, col, row } = stretch(grid);
  const one = chosen(b, block.band, [[col, row]]);
  const byRoad = land({ lamp: [[b, col, row, 1]], road: [[b, col + 1, row, 0]] });
  assert.deepEqual(A.shiftChosen(grid, byRoad, one, "col+"), { moves: [], cells: [], problem: "Дальше не подвинуть: клетка рядом занята." });
  const byHouse = land({ lamp: [[b, col, row, 1]] }, [{ module: b, u: col - 3, v: row - 1, w: 3, h: 3 }]);
  assert.match(A.shiftChosen(grid, byHouse, one, "col-").problem, /занята/);
  // At a cell kept from sale (the district's centre, the railway) or the end of the land.
  let edge = null;
  for (const bl of grid.blocks.filter(x => x.district === 1)) for (let c = 0; c < bl.cols && !edge; c++) for (let r = 0; r < bl.rows && !edge; r++) {
    if (!bl.skip.has(`${c}:${r}`) && !A.neighbours(grid, bl, c, r, "row-").length) edge = { bl, c, r };
  }
  assert.ok(edge, "a cell at the edge of the land");
  const atEdge = land({ lamp: [[edge.bl.block, edge.c, edge.r, 1]] });
  assert.match(A.shiftChosen(grid, atEdge, chosen(edge.bl.block, edge.bl.band, [[edge.c, edge.r]]), "row-").problem, /кончается земля/);
});

test("lamps and benches turn a quarter from where they stand, the rest do not", () => {
  const grid = A.districtPlotGrid("support"), { block, b, col, row } = stretch(grid);
  const decor = { lamp: [[b, col, row, 1, 0]], bench: [[b, col + 1, row, 1]], tree: [[b, col + 2, row, 1]], road: [[b, col + 1, row - 1, 1]] };
  const cells = chosen(b, block.band, [[col, row], [col + 1, row], [col + 2, row]]), there = land(decor);
  assert.equal(A.turnableChosen(there, cells).length, 2);
  assert.equal(A.turnableChosen(null, cells).length, 0);
  // The lamp turned to z1 goes on to x1 (left, counterclockwise) or x0 (right); the bench from the road above it.
  const map = A.decorMap([there]), road = A.TURN_SIDES.indexOf(A.decorSide(grid, map, block, col + 1, row));
  assert.equal(A.TURN_SIDES[road], A.sideOf(block, "row-"));
  assert.deepEqual(A.turnChosen(grid, there, cells, 1), [[b, col, row, 1], [b, col + 1, row, (road + 1) % 4]]);
  assert.deepEqual(A.turnChosen(grid, there, cells, -1), [[b, col, row, 3], [b, col + 1, row, (road + 3) % 4]]);
});
