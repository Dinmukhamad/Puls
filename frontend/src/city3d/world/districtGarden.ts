/**
 * The square round a district's main building (docs/CITY_ESTATES.md, «Центр района»): the centre's cells laid out as a
 * garden. A paved walk runs along the front with the way in to the building; either side a lawn framed by paths, the
 * one on the left (as the city sees it) round a fountain, the one on the right with flowerbeds along its walk; trees
 * along the back and the ends, lamps where the paths meet, benches. Nothing stands where the main building grows (its
 * LANDMARK_SIDE square in the middle, world/districtLandmark.ts), only its lawn and the way in, which it covers.
 * Pure data, no three.js: the ground as quads for one mesh, laid out in the block's own columns and rows so that it
 * follows the island city's rings; everything else as placements for the instance pools, the lamps also lit at night.
 */
import type { GroundQuad } from "./decor";
import { LANDMARK_SIDE } from "./districtLandmark";
import { blockCell, blockPoint, wayOf, type DistrictCentre, type LandBlock } from "./land";
import type { Placement, PlacementKind, Point } from "./types";

export interface Garden { ground: GroundQuad[]; placements: Placement[]; lamps: Placement[] }

/** Land top (render/terrain.ts TOP); the garden lies where the centre's paving lay, under the small things. */
const Y = .2 + .003;
export const GARDEN_LAWN = "#8dbb6f", GARDEN_PATH = "#e3dbc9", GARDEN_PLAZA = "#d6cbb4";
/** The front walk's depth, a path's width, the strips of trees along the back and the ends. */
const WALK = 2.4, PATH = 1.2, BACK = 2, END = 1.9;
/** Trees stand this far in from the centre's back and ends, so their crowns stay over its own cells. */
const EDGE = 1;
/** A ground quad runs along the front no longer than this, so on a ring it bends with the land. */
const STEP = 1.5;

interface Region { u0: number; u1: number; w0: number; w1: number; colour: string }

/**
 * Where a point of the centre lies in the world: `u` along its front from the middle (the area's width at its middle
 * row), `w` in from the front edge. And back: `local` of a world point.
 */
function centreMap(block: LandBlock, c: DistrictCentre) {
  const way = wayOf(c.side), along = way === "row-" || way === "row+", W = c.area.width, D = c.area.depth;
  const at = (u: number, w: number): Point => {
    const a = (u + W / 2) / W, b = w / D;
    if (along) return blockPoint(block, c.col + a * c.cols, way === "row-" ? c.row + b * c.rows : c.row + (1 - b) * c.rows);
    return blockPoint(block, way === "col-" ? c.col + b * c.cols : c.col + (1 - b) * c.cols, c.row + a * c.rows);
  };
  const local = (p: Point) => {
    const cell = blockCell(block, p) ?? { u: c.col + c.cols / 2, v: c.row + c.rows / 2 };
    const [s, t] = along ? [(cell.u - c.col) / c.cols, (cell.v - c.row) / c.rows] : [(cell.v - c.row) / c.rows, (cell.u - c.col) / c.cols];
    return { u: s * W - W / 2, w: (way === "row-" || way === "col-" ? t : 1 - t) * D };
  };
  return { at, local, W, D };
}

/** The ground: every point takes the colour of the last region over it (lawn where none is); same colours merge. */
function groundOf(at: (u: number, w: number) => Point, regions: Region[], W: number, D: number): GroundQuad[] {
  const cut = (values: number[], hi: number) => [...new Set([0, hi, ...values].map(v => Math.min(hi, Math.max(0, v))))].sort((a, b) => a - b);
  const us = cut(regions.flatMap(r => [r.u0 + W / 2, r.u1 + W / 2]), W).map(v => v - W / 2), ws = cut(regions.flatMap(r => [r.w0, r.w1]), D);
  const colourAt = (u: number, w: number) => regions.reduce((colour, r) => u > r.u0 && u < r.u1 && w > r.w0 && w < r.w1 ? r.colour : colour, GARDEN_LAWN);
  const out: GroundQuad[] = [];
  for (let i = 0; i + 1 < us.length; i++) {
    const u0 = us[i], u1 = us[i + 1], mid = (u0 + u1) / 2, n = Math.max(1, Math.ceil((u1 - u0) / STEP - 1e-9));
    if (u1 - u0 < 1e-6) continue;
    for (let j = 0; j + 1 < ws.length;) {
      const colour = colourAt(mid, (ws[j] + ws[j + 1]) / 2);
      let k = j + 1;
      while (k + 1 < ws.length && colourAt(mid, (ws[k] + ws[k + 1]) / 2) === colour) k++;
      for (let s = 0; s < n; s++) {
        const a = u0 + (u1 - u0) * s / n, b = u0 + (u1 - u0) * (s + 1) / n;
        out.push({ points: [at(a, ws[j]), at(b, ws[j]), at(b, ws[k]), at(a, ws[k])], y: Y, colour });
      }
      j = k;
    }
  }
  return out;
}

/** A district centre's garden on its block. */
export function districtGarden(block: LandBlock, centre: DistrictCentre): Garden {
  const { at, local, W, D } = centreMap(block, centre), E = W / 2;
  // How far along the front the main building's square reaches (on a ring its corners spread at the front), and
  // which way along the front is the left of someone facing the building from the city.
  const half = LANDMARK_SIDE / 2, sin = Math.sin(centre.area.rotation), cos = Math.cos(centre.area.rotation);
  const corner = (lu: number, lw: number) => local({ x: centre.area.x + cos * lu + sin * lw, z: centre.area.z - sin * lu + cos * lw });
  const reach = Math.max(...[[-half, -half], [half, -half], [half, half], [-half, half]].map(([lu, lw]) => Math.abs(corner(lu, lw).u)));
  const side = reach + 1;
  const middle = at(0, D / 2), ahead = at(0, 0), along = at(1, D / 2);
  // Facing the building from the front, the viewer looks along (middle − ahead); their right is that turned a quarter.
  const lx = middle.x - ahead.x, lz = middle.z - ahead.z, rightward = (along.x - middle.x) * -lz + (along.z - middle.z) * lx > 0;
  const left = rightward ? -1 : 1;
  // The wings: from the path beside the building out to the path along the end, from the front walk to the back path.
  const inner = side + PATH, outer = E - END - PATH, back = D - BACK - PATH, mu = (inner + outer) / 2, mw = (WALK + back) / 2;
  const regions: Region[] = [
    { u0: -E, u1: E, w0: 0, w1: WALK, colour: GARDEN_PLAZA },
    { u0: -1.6, u1: 1.6, w0: WALK, w1: D / 2, colour: GARDEN_PLAZA },
    { u0: -E + END, u1: E - END, w0: back, w1: back + PATH, colour: GARDEN_PATH },
  ];
  for (const s of [-1, 1]) {
    const span = (a: number, b: number) => s > 0 ? { u0: a, u1: b } : { u0: -b, u1: -a };
    regions.push({ ...span(side, inner), w0: WALK, w1: back, colour: GARDEN_PATH }, { ...span(outer, E - END), w0: WALK, w1: back, colour: GARDEN_PATH });
    // Across the wing and down it, through its middle.
    regions.push({ ...span(inner, outer), w0: mw - PATH / 2, w1: mw + PATH / 2, colour: GARDEN_PATH }, { ...span(mu - PATH / 2, mu + PATH / 2), w0: WALK, w1: back, colour: GARDEN_PATH });
  }
  // The fountain's square where the left wing's paths cross.
  const fu = left * mu, plaza = Math.min(5, outer - inner - 1.2);
  regions.push({ u0: fu - plaza / 2, u1: fu + plaza / 2, w0: mw - plaza / 2, w1: mw + plaza / 2, colour: GARDEN_PLAZA });
  const ground = groundOf(at, regions, W, D);

  const placements: Placement[] = [], lamps: Placement[] = [];
  let seed = centre.district * 101;
  const turn = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * Math.PI * 2; };
  const put = (kind: PlacementKind, u: number, w: number, scale: number, rotation = turn(), width = 0) => {
    const p = at(u, w), placement: Placement = { kind, variant: placements.length, x: p.x, z: p.z, rotation, scale, width };
    placements.push(placement);
    return placement;
  };
  /** The rotation that turns a piece's front from (u, w) towards (tu, tw). */
  const facing = (u: number, w: number, tu: number, tw: number) => { const a = at(u, w), b = at(tu, tw); return Math.atan2(b.x - a.x, b.z - a.z); };
  const lamp = (u: number, w: number) => lamps.push(put("lamp", u, w, 1, 0));
  // Trees along the back and down both ends.
  // Behind the building only where its square leaves room for a crown.
  const backTrees = Math.max(2, Math.round((W - 2 * EDGE) / 3.4)), behind = D - EDGE - .9 > D / 2 + half;
  for (let k = 0; k <= backTrees; k++) {
    const u = -E + EDGE + k * (W - 2 * EDGE) / backTrees;
    if (behind || Math.abs(u) > side) put(k % 3 === 1 ? "tree-oak" : "tree-round", u, D - EDGE, k % 3 === 1 ? 1.05 : 1.2);
  }
  for (const s of [-1, 1]) {
    const endTrees = Math.max(2, Math.round((back - WALK - 1) / 3.2));
    for (let k = 0; k <= endTrees; k++) put(k % 2 ? "tree-cone" : "tree-birch", s * (E - EDGE), WALK + 1 + k * (back - WALK - 1) / endTrees, 1.1);
    // Lamps where the side paths and the end paths meet the front walk and the back path.
    for (const u of [side + PATH / 2, outer + PATH / 2]) { lamp(s * u, WALK + .45); lamp(s * u, back - .45); }
    // Benches on the front walk, looking out at the city, and bushes along the paths beside the building.
    for (const u of [inner + 1.6, outer - 1.6]) put("bench", s * u, WALK - .55, 1.05, facing(s * u, WALK - .55, s * u, -1), .9);
    for (let w = WALK + 1.4; w < back - .8; w += 2.6) put("bush", s * (side - .45), w, 1.2);
  }
  // Lamps either side of the way in, on the front walk before the building's square.
  lamp(-2.3, Math.min(WALK - .4, D / 2 - half - .35)); lamp(2.3, Math.min(WALK - .4, D / 2 - half - .35));

  // The left wing: the fountain, benches round it with a lamp behind each, flowerbeds and trees in its four lawns.
  put("fountain", fu, mw, 1.05, 0, 2.4);
  for (const [du, dw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const u = fu + du * (plaza / 2 - .75), w = mw + dw * (plaza / 2 - .75);
    put("bench", u, w, 1, facing(u, w, fu, mw), .9);
    lamp(fu + du * (plaza / 2 - .3), mw + dw * (plaza / 2 - .3));
  }
  const quarter = (outer - inner) / 4 + PATH / 4;
  for (const du of [-1, 1]) for (const dw of [-1, 1]) {
    put("flowerbed", fu + du * quarter, mw + dw * (plaza / 2 + 1.1), 1.2, turn(), 1.2);
    put(dw > 0 ? "tree-round" : "tree-oak", fu + du * quarter, mw + dw * (plaza / 2 + 1.1 + (back - mw - plaza / 2 - 1.1) * .62), 1.1);
  }
  // The right wing: flowerbeds and bushes either side of the walk down its middle, benches facing it.
  const ru = -left * mu, beds = Math.max(2, Math.floor((back - WALK - 2.4) / 2.6));
  for (let k = 0; k < beds; k++) {
    const w = WALK + 1.6 + k * (back - WALK - 3.2) / Math.max(1, beds - 1);
    if (Math.abs(w - mw) < 1.2) {
      for (const du of [-1, 1]) put("bench", ru + du * 1.25, w, 1, facing(ru + du * 1.25, w, ru, w), .9);
      continue;
    }
    for (const du of [-1, 1]) put(k % 2 ? "bush" : "flowerbed", ru + du * quarter, w, k % 2 ? 1.25 : 1.3, turn(), k % 2 ? 0 : 1.2);
  }
  return { ground, placements, lamps };
}
