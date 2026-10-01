/**
 * What stands on the plots of the team districts (docs/CITY_ESTATES.md): a square, a house or a ready house on one
 * plot, a park on the four plots of the squares it gathered from, a big park on six. Built from the catalogue's
 * procedural pieces (cottages under gabled roofs, trees, hedges, benches, fountains), so a district reads from any
 * distance and costs only copies in the instance pools. Every stage of a house changes its silhouette: one storey,
 * two, a wing with a terrace, a garage, a three-storey mansion. A ready house is a model of its own
 * (world/familyHouses.ts) in the same garden. Paths are paving over the lawns and driveways concrete, both drawn
 * above the grass (render/terrain.ts SURFACES). Pure data, no three.js.
 */
import type { Frame } from "./land";
import type { PlotFamily } from "./estateGrid";
import { HOUSE_SCALE, READY_HOUSES, isReadyHouse, type ReadyHouse } from "./familyHouses";
import type { Placement, PlacementKind, Surface, SurfaceKind } from "./types";

export interface Layout { placements: Placement[]; surfaces: Surface[] }

/** Walls of the houses (catalogue SECTION_TINTS: whites, creams, pastels, brick) and their roofs (ROOF_TINTS). */
const WALLS = [0, 1, 2, 3, 5, 6, 9, 10, 11, 13], ROOFS = [0, 1, 1, 2, 3, 4], GARAGE = 8, SLATE = 0;
const TREES: PlacementKind[] = ["tree-round", "tree-oak", "tree-birch", "tree-round", "tree-cone"];

/** A small seeded stream, so neighbouring plots differ and a plot always looks the same. */
function stream(seed: number) {
  let s = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0; return (s >>> 8) / 16777216; };
}

/**
 * The plot's own frame: `put(kind, lu, lw)` places a piece `lu` along the plot's width and `lw` towards its
 * front (the street), turned `turn` from facing the front; `patch` lays ground `alongU` × `alongW`.
 */
function lot(frame: Frame, seed: number) {
  const s = Math.sin(frame.rotation), c = Math.cos(frame.rotation), placements: Placement[] = [], surfaces: Surface[] = [];
  const at = (lu: number, lw: number) => ({ x: frame.x + c * lu + s * lw, z: frame.z - s * lu + c * lw });
  return {
    W: frame.width / 2, D: frame.depth / 2, street: frame.street, random: stream(seed), placements, surfaces,
    put(kind: PlacementKind, lu: number, lw: number, turn = 0, extra: Partial<Placement> = {}) {
      placements.push({ kind, variant: placements.length + seed, ...at(lu, lw), rotation: frame.rotation + turn, scale: 1, width: 0, ...extra });
    },
    patch(kind: SurfaceKind, lu: number, lw: number, alongU: number, alongW: number) {
      surfaces.push({ kind, ...at(lu, lw), angle: frame.rotation + Math.PI / 2, length: alongU, width: alongW });
    },
    disc(kind: SurfaceKind, lu: number, lw: number, r: number) { surfaces.push({ kind, ...at(lu, lw), angle: 0, length: 2 * r, width: 2 * r, round: true }); },
  };
}
type Lot = ReturnType<typeof lot>;

function tree(f: Lot, lu: number, lw: number, size = 1) {
  const kind = TREES[Math.floor(f.random() * TREES.length)];
  f.put(kind, lu, lw, f.random() * 6, { scale: size * (.85 + f.random() * .35) * (kind === "tree-birch" ? 1.1 : 1) });
}

/** A square: a lawn with a cross of paths, a flowerbed in the middle, trees in its corners, benches and a lamp. */
function square(f: Lot) {
  const { W, D } = f;
  f.patch("lawn", 0, 0, 2 * W - .5, 2 * D - .5);
  const along = f.random() < .5;
  f.patch("plaza", 0, 0, along ? 2 * W - .5 : .9, along ? .9 : 2 * D - .5);
  f.patch("plaza", 0, along ? D / 2 : 0, along ? .9 : W, along ? D : .9);
  f.disc("plaza", 0, 0, 1.25); f.put("flowerbed", 0, 0, 0, { width: .9, scale: .8 });
  for (const [u, w] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tree(f, u * W * .55 + (f.random() - .5) * .6, w * D * .55 + (f.random() - .5) * .6, 1.05);
  f.put("bench", -1.9, 0, Math.PI / 2, { width: .9, scale: .9 }); f.put("bench", 1.9, 0, -Math.PI / 2, { width: .9, scale: .9 });
  f.put("bush", -W * .7, D * .82, 0, { scale: .7 }); f.put("bush", W * .7, D * .82, 1, { scale: .7 });
  f.put("lamp", .9, D * .7, 0);
}

/** One house stage after another on its plot: the house at the back half, the garden in front, a path to the street. */
function house(f: Lot, level: number) {
  const { W, D, random } = f, wall = WALLS[Math.floor(random() * WALLS.length)], roof = ROOFS[Math.floor(random() * ROOFS.length)];
  const side = random() < .5 ? -1 : 1, turned = random() < .35;
  f.patch("lawn", 0, 0, 2 * W - .4, 2 * D - .4);
  const body = [
    { width: 3.3, depth: 2.5, floors: 1, roof: .95 },
    { width: 3.5, depth: 2.6, floors: 2, roof: 1.05 },
    { width: 3.6, depth: 2.7, floors: 2, roof: 1.1 },
    { width: 3.8, depth: 2.8, floors: 2, roof: 1.15 },
    { width: 4.4, depth: 3.1, floors: 3, roof: 1.3 },
  ][level - 1];
  const x = -side * (level >= 3 ? W * .2 : W * .1), w = -D * .28, height = body.floors * .75, front = w + body.depth / 2;
  f.put("cottage", x, w, 0, { variant: body.floors - 1, width: body.width, depth: body.depth, tint: wall });
  // The ridge along the depth shows the gable to the street; some houses turn it along the front.
  f.put("roof", x, w, turned ? Math.PI / 2 : 0, { scale: body.roof, width: (turned ? body.depth : body.width) + .3, depth: (turned ? body.width : body.depth) + .3, tint: roof, lift: height });
  // The door's porch and the path from it: to the street, or (deeper in the block) into the garden.
  const reach = f.street ? D - .2 : Math.max(front + 1.6, D * .45);
  f.patch("plaza", x, front + .35, 1.2, .7);
  f.patch("plaza", x, (front + .7 + reach) / 2, .8, reach - front - .7);
  tree(f, side * W * .62, -D * .62, 1.1);
  f.put("bush", x - 1.05, front + .45, 0, { scale: .6 }); f.put("bush", x + 1.05, front + .45, 1, { scale: .6 });
  if (level === 1) { f.put("bush", side * W * .55, D * .45, 2, { scale: .7 }); return; }
  // A low hedge along the sides and the front, open for the path.
  for (const sgn of [-1, 1]) f.put("hedge", sgn * (W - .35), 0, Math.PI / 2, { width: 2 * D - 1.2, scale: .8 });
  if (f.street) for (const sgn of [-1, 1]) {
    const from = sgn < 0 ? -W + .5 : x + .7, to = sgn < 0 ? x - .7 : W - .5;
    if (to - from > .6) f.put("hedge", (from + to) / 2, D - .35, 0, { width: to - from, scale: .8 });
  }
  else f.put("hedge", 0, D - .35, 0, { width: 2 * W - 1, scale: .8 });
  tree(f, -side * W * .6, D * .45, .95);
  f.put("bench", side * W * .45, D * .25, Math.PI, { width: .9, scale: .85 });
  if (level === 2) return;
  if (level === 3) {
    // A one-storey wing beside the house with a terrace in front of it, and flowerbeds in the garden.
    const wx = x + side * (body.width / 2 + .85);
    f.put("cottage", wx, w + .2, 0, { variant: 0, width: 1.7, depth: 2.2, tint: wall });
    f.put("roof", wx, w + .2, Math.PI / 2, { scale: .6, width: 2.4, depth: 1.9, tint: roof, lift: .75 });
    f.patch("plaza", wx, w + 1.9, 1.9, 1.3); f.put("planter", wx - .6, w + 2.3, 0, { width: .5 }); f.put("planter", wx + .6, w + 2.3, 0, { width: .5 });
    f.put("flowerbed", -side * W * .45, D * .62, 0, { width: .8, scale: .7 }); f.put("flowerbed", x + .1, D * .55, 1, { width: .8, scale: .7 });
    return;
  }
  // A garage beside the house with its driveway to the street; the terrace goes behind the house.
  const gx = x + side * (body.width / 2 + 1.1);
  f.put("cottage", gx, w + .1, 0, { variant: 0, width: 1.9, depth: 2.4, tint: GARAGE });
  f.put("roof", gx, w + .1, Math.PI / 2, { scale: .4, width: 2.6, depth: 2.1, tint: SLATE, lift: .75 });
  // The driveway out to the street; a plot deeper in the block keeps a short apron before the doors.
  f.patch("slab", gx, f.street ? (w + 1.3 + D - .2) / 2 : w + 1.9, 1.5, f.street ? D - .2 - w - 1.3 : 1.2);
  f.patch("plaza", x, w - body.depth / 2 - .9, 2.4, 1.2); f.put("bench", x, w - body.depth / 2 - .9, 0, { width: .9, scale: .85 });
  f.put("flowerbed", -side * W * .45, D * .62, 0, { width: .8, scale: .7 });
  if (level === 4) { f.put("bush", gx, D * .1, 0, { scale: .55 }); return; }
  // The mansion: a porch with its own gable, a little fountain in the front garden, lamps along the path.
  f.put("cottage", x, front + .3, 0, { variant: 0, width: 1.6, depth: .6, tint: wall });
  f.put("roof", x, front + .3, 0, { scale: .45, width: 1.9, depth: .9, tint: roof, lift: .75 });
  f.disc("plaza", -side * W * .4, D * .35, .85); f.put("fountain", -side * W * .4, D * .35, 0, { width: 1.1, scale: .5 });
  f.put("lamp", x - .75, D * .55, 0); f.put("lamp", x + .75, D * .2, 0);
  f.put("flowerbed", x + side * 1.6, D * .7, 2, { width: .7, scale: .6 });
}

/**
 * A ready house: the model in the back half of its plot, in brick or in stone, its front to the street. A path leads
 * from its door and a driveway from its garage out to the street (deeper in the block, a path into the garden and a
 * short apron), through a gap in the hedge round the garden; trees, bushes by the door, a flowerbed and a bench.
 */
function ready(f: Lot, family: ReadyHouse) {
  const { W, D, random } = f, m = READY_HOUSES[family], k = HOUSE_SCALE;
  const width = m.width * k, depth = m.depth * k, finish = Math.floor(random() * 2);
  f.patch("lawn", 0, 0, 2 * W - .4, 2 * D - .4);
  const w = Math.max(-D + .45 + depth / 2, -D * .2), front = w + depth / 2;
  f.put("family-house", 0, w, 0, { variant: (m.model - 1) * 2 + finish, scale: k, width, depth });
  const door = m.door[0] * k, doorAt = front - m.door[1] * k, out = f.street ? D - .2 : Math.max(front + 1.6, D * .45);
  // The driveway is as wide as a car; a door right beside it shares its paving.
  const drive = m.garage && { lo: m.garage[0] * k - .65, hi: m.garage[0] * k + .65, from: front - m.garage[1] * k, to: f.street ? D - .2 : Math.min(D - .4, front + 1.6) };
  const shared = !!drive && door + .4 > drive.lo - .2 && door - .4 < drive.hi + .2;
  if (!shared) f.patch("plaza", door, (doorAt + out) / 2, .8, out - doorAt);
  if (drive) {
    const lo = shared ? Math.min(drive.lo, door - .4) : drive.lo, hi = shared ? Math.max(drive.hi, door + .4) : drive.hi, from = shared ? Math.min(drive.from, doorAt) : drive.from;
    f.patch("slab", (lo + hi) / 2, (from + drive.to) / 2, hi - lo, drive.to - from);
  }
  // The hedge round the garden: along the sides, and along the front open for the path and the driveway.
  for (const sgn of [-1, 1]) f.put("hedge", sgn * (W - .35), 0, Math.PI / 2, { width: 2 * D - 1.2, scale: .8 });
  const gaps = f.street ? [[door - .55, door + .55], ...(drive ? [[drive.lo - .15, drive.hi + .15]] : [])].sort((a, b) => a[0] - b[0]) : [];
  let from = -W + .5;
  for (const [a, b] of [...gaps, [W - .5, W - .5]]) {
    if (Math.min(a, W - .5) - from > .6) f.put("hedge", (from + Math.min(a, W - .5)) / 2, D - .35, 0, { width: Math.min(a, W - .5) - from, scale: .8 });
    from = Math.max(from, b);
  }
  // Trees on the side away from the garage: one in the front garden, two beside the house when there is room.
  const free = drive ? (drive.lo + drive.hi > 0 ? -1 : 1) : random() < .5 ? -1 : 1, garden = (front + D) / 2;
  tree(f, free * W * .62, garden + .15, 1.05);
  if (W - width / 2 > 1.3) { tree(f, free * (W + width / 2) / 2, w - depth * .15, 1.1); tree(f, -free * (W + width / 2) / 2, w - depth * .3, .95); }
  // Bushes either side of the door where the driveway leaves room, a bed and a bench in the garden, a lamp by the path.
  [door - .8, door + .8].forEach((u, i) => { if (!drive || u < drive.lo - .3 || u > drive.hi + .3) f.put("bush", u, front + .4, i, { scale: .6 }); });
  f.put("flowerbed", free * W * .3, garden + .3, 0, { width: .8, scale: .7 });
  f.put("bench", free * Math.min(W - .6, width / 2 + .7), front + .5, Math.PI, { width: .9, scale: .85 });
  if (f.street) f.put("lamp", door + (drive && drive.lo > door ? -.6 : .6), D * .72, 0);
}

/** A park on 2 × 2 plots: lawns, a cross of walks round a middle, trees round the edge and in clumps, benches, lamps. */
function park(f: Lot, level: number) {
  const { W, D } = f;
  f.patch("lawn", 0, 0, 2 * W - .5, 2 * D - .5);
  f.patch("plaza", 0, 0, 2 * W - .6, 1.3); f.patch("plaza", 0, 0, 1.3, 2 * D - .6);
  f.disc("plaza", 0, 0, level > 1 ? 3 : 2.3);
  if (level > 1) { f.put("fountain", 0, 0, 0, { width: 2.4, scale: 1.1 }); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; f.put("bench", Math.sin(a) * 3.6, Math.cos(a) * 3.6, a + Math.PI, { width: .9, scale: .9 }); } }
  else f.put("flowerbed", 0, 0, 0, { width: 1.6, scale: 1.1 });
  // Trees round the edge, three to a side, and a clump in each quarter.
  for (const t of [-.62, 0, .62]) for (const [u, w] of [[t * W, D - 1.1], [t * W, -D + 1.1], [W - 1.1, t * D], [-W + 1.1, t * D]]) if (Math.abs(u) > 1.4 || Math.abs(w) > 1.4) tree(f, u, w, 1.15);
  for (const [qu, qw] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    tree(f, qu * W * .45, qw * D * .5, 1.2); tree(f, qu * W * .58, qw * D * .32, 1);
    f.put("bench", qu * 1.4, qw * D * .55, qu > 0 ? -Math.PI / 2 : Math.PI / 2, { width: .9, scale: .9 });
    f.put("flowerbed", qu * (level > 1 ? 3.9 : 2.9), qw * (level > 1 ? 3.9 : 2.9), 0, { width: .8, scale: .7 });
    f.put("lamp", qu * 1.15, qw * D * .32, 0);
  }
}

/** A big park on 3 × 2 plots: an alley along its length with trees in rows, lawns, benches; then a gazebo and a playground, then a fountain. */
function bigpark(f: Lot, level: number) {
  const long = f.W >= f.D, L = long ? f.W : f.D, S = long ? f.D : f.W;
  // In the park's own axes: `a` along its length, `b` across it.
  const at = (a: number, b: number): [number, number] => long ? [a, b] : [b, a];
  const put = (kind: PlacementKind, a: number, b: number, turn = 0, extra: Partial<Placement> = {}) => { const [u, w] = at(a, b); f.put(kind, u, w, turn + (long ? 0 : Math.PI / 2), extra); };
  const patch = (kind: SurfaceKind, a: number, b: number, alongA: number, alongB: number) => { const [u, w] = at(a, b); const [lu, lw] = long ? [alongA, alongB] : [alongB, alongA]; f.patch(kind, u, w, lu, lw); };
  const disc = (kind: SurfaceKind, a: number, b: number, r: number) => { const [u, w] = at(a, b); f.disc(kind, u, w, r); };
  const grove = (a: number, b: number, size = 1) => { const [u, w] = at(a, b); tree(f, u, w, size); };
  patch("lawn", 0, 0, 2 * L - .5, 2 * S - .5);
  patch("plaza", 0, 0, 2 * L - .6, 1.6); patch("plaza", 0, 0, 1.2, 2 * S - .6);
  // Rows of trees along the alley, benches between them.
  for (let a = -L + 2.2; a <= L - 2.2; a += 3.1) {
    if (Math.abs(a) < 2.6 || (level > 1 && Math.abs(Math.abs(a) - L * .62) < 3)) continue;
    grove(a, 1.9, 1.15); grove(a, -1.9, 1.15);
  }
  for (const a of [-L * .38, L * .38]) { put("bench", a, 1.25, Math.PI, { width: .9, scale: .9 }); put("bench", a + 1.4, -1.25, 0, { width: .9, scale: .9 }); }
  // Benches at the cross walk, bushes along the edge of the lawns, lamps at the ends of the alley.
  for (const b of [-S * .55, S * .55]) put("bench", 1.05, b, -Math.PI / 2, { width: .9, scale: .9 });
  for (const a of [-L * .72, -L * .2, L * .2, L * .72]) for (const b of [-(S - .9), S - .9]) put("bush", a, b, a + b, { scale: .7 });
  for (const a of [-(L - 1.2), L - 1.2]) { put("lamp", a, 1.05, 0); put("lamp", a, -1.05, 0); }
  // Clumps of trees in the lawns, more towards the corners.
  for (const [qa, qb] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { grove(qa * (L - 1.6), qb * (S - 1.6), 1.25); grove(qa * L * .78, qb * S * .55, 1.1); grove(qa * L * .3, qb * (S - 1.4), 1); }
  for (const a of [-L * .55, L * .55]) for (const b of [-S * .6, S * .6]) put("flowerbed", a, b, a, { width: .8, scale: .7 });
  if (level > 1) {
    // A gazebo on a round plaza at one end, a playground at the other.
    disc("plaza", -L * .62, 0, 2); put("gazebo", -L * .62, 0, 0, { width: 2.4, scale: .9 });
    put("flowerbed", -L * .62 - 2.3, 1.6, 0, { width: .7, scale: .6 }); put("flowerbed", -L * .62 - 2.3, -1.6, 1, { width: .7, scale: .6 });
    patch("play", L * .62, 0, 4.2, 3.4); put("slide", L * .62 - 1, .6, 0, { scale: .9 }); put("swings", L * .62 + 1.1, -.5, Math.PI / 2, { scale: .9 }); put("sandbox", L * .62 + .9, 1.1, 0, { scale: .8 });
  }
  if (level > 2) {
    // A fountain on a square in the middle and lamps along the alley for the evening.
    disc("plaza", 0, 0, 3.2); put("fountain", 0, 0, 0, { width: 2.6, scale: 1.15 });
    for (const a of [-L * .82, -L * .4, L * .4, L * .82]) { put("lamp", a, 1.05, 0); put("lamp", a, -1.05, 0); }
  } else put("flowerbed", 0, 0, 0, { width: 1.4, scale: 1 });
}

/**
 * What stands on a building's plots at its level, inside its frame (world/land.ts areaFrame over its plots):
 * copies for the instance pools and ground patches. `seed` keeps each building's own look (its id).
 */
export function plotLayout(frame: Frame, family: PlotFamily, level: number, seed: number): Layout {
  const f = lot(frame, seed);
  if (family === "square") square(f);
  else if (family === "house") house(f, Math.max(1, Math.min(5, level)));
  else if (isReadyHouse(family)) ready(f, family);
  else if (family === "park") park(f, Math.max(1, Math.min(2, level)));
  else bigpark(f, Math.max(1, Math.min(3, level)));
  return { placements: f.placements, surfaces: f.surfaces };
}

/** A plot being built up: a fenced site of sand with a little stack of materials, for the moment it changes. */
export function plotSite(frame: Frame): Layout {
  const f = lot(frame, 0), { W, D } = f;
  f.patch("sand", 0, 0, 2 * W - .8, 2 * D - .8);
  for (const [u, w, l, d] of [[0, D - .45, 2 * W - .9, .08], [0, -D + .45, 2 * W - .9, .08], [W - .45, 0, .08, 2 * D - .9], [-W + .45, 0, .08, 2 * D - .9]]) f.patch("line", u, w, l, d);
  return { placements: f.placements, surfaces: f.surfaces };
}
