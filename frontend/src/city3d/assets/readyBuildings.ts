/**
 * The ready houses and office towers the district shop sells (world/familyHouses.ts, world/officeBuildings.ts), built
 * in code in the city's v4 style (docs/CITY_V4.md): chamfered walls, gable roofs with eaves, porches, garages and
 * carports, glass lobbies and crowns, occlusion baked into the vertices, windows drawn by the facade material.
 *
 * Each is drawn in metres on its table's footprint (width and depth in model units times the metres in a unit),
 * centred on it and facing +z, and handed over in model units, as the catalogue places it (assets/catalogue.ts). The
 * door and the garage stand exactly where the table says, so the path and the driveway of world/landLayouts.ts lead
 * to them; eaves may reach a little past the walls, as on a real house.
 */
import type * as THREE from "three/webgpu";
import { FACE, MeshBuilder, bakeOcclusion, box, gableRoof, hipRoof, parapet, pyramid, rgb, type V3 } from "./facade";
import { FINISHES, READY_HOUSES, type ReadyHouse, type ReadyHouseModel } from "../world/familyHouses";
import { OFFICE_BUILDINGS, type OfficeBuilding } from "../world/officeBuildings";

/** Metres in one of the tables' model units: a house is drawn 1.35 times bigger, an office twice, a unit is about 4 m. */
const HOUSE_METRES = 4 * 1.35, OFFICE_METRES = 4 * 2;
const FINISH: Record<typeof FINISHES[number], { wall: V3; plinth: V3; door: V3 }> = {
  brick: { wall: rgb("#a85c45"), plinth: rgb("#6f625a"), door: rgb("#2f4f66") },
  stone: { wall: rgb("#dcd3c2"), plinth: rgb("#8f8a82"), door: rgb("#6b3b2a") },
};
const ROOF: Record<ReadyHouse, V3> = {
  carport: rgb("#4f565e"), bungalow: rgb("#a3553f"), attic: rgb("#3f444b"), modern: rgb("#eceae4"), bayhouse: rgb("#7b4b3b"), terrace: rgb("#5a6168"),
};
const TRIM = rgb("#f1eee8"), DARK = rgb("#2a2e33"), PAVING = rgb("#b2ada3"), GARAGE = rgb("#e4e1da");

interface House { W: number; D: number; H: number; door: [number, number]; garage: [number, number] | null; wall: V3; plinth: V3; doorColour: V3; roof: V3 }

function door(mb: MeshBuilder, h: House, front: number) {
  const x = h.door[0];
  box(mb, [x - .55, .2, front - .03, x + .55, 2.35, front + .1], { c: .02, kind: FACE.trim, col: h.doorColour, top: FACE.trim });
  box(mb, [x - .28, 1.25, front + .09, x + .28, 2.15, front + .13], { c: .01, kind: FACE.glass, top: FACE.glass, occlude: false });
  box(mb, [x - .9, 0, front, x + .9, .18, front + .8], { c: .03, kind: FACE.trim, col: PAVING, top: FACE.trim, occlude: false });
}
function canopy(mb: MeshBuilder, x: number, front: number, width: number, depth: number, posts = true) {
  box(mb, [x - width / 2, 2.75, front, x + width / 2, 2.95, front + depth], { c: .03, kind: FACE.trim, col: TRIM, top: FACE.trim });
  if (posts) for (const side of [-1, 1]) box(mb, [x + side * (width / 2 - .12) - .07, 0, front + depth - .18, x + side * (width / 2 - .12) + .07, 2.75, front + depth - .04], { c: .02, kind: FACE.trim, col: TRIM, top: FACE.trim });
}
function garageDoor(mb: MeshBuilder, x: number, front: number, width = 3) {
  box(mb, [x - width / 2, 0, front - .03, x + width / 2, 2.3, front + .08], { c: .02, kind: FACE.trim, col: GARAGE, top: FACE.trim });
}
function chimney(mb: MeshBuilder, x: number, z: number, y0: number, y1: number) {
  box(mb, [x - .42, y0, z - .42, x + .42, y1, z + .42], { c: .03, kind: FACE.trim, col: rgb("#8e5240"), top: FACE.trim });
  box(mb, [x - .52, y1, z - .52, x + .52, y1 + .14, z + .52], { c: .02, kind: FACE.trim, col: rgb("#c8c3b8"), top: FACE.trim });
}
/** A body with its plinth: windows in every wall; `top` is what its roof face is (hidden under a pitched roof). */
function body(mb: MeshBuilder, h: House, [x0, z0, x1, z1]: [number, number, number, number], height: number, o: { floor?: number; bay?: number; top?: typeof FACE.deck | typeof FACE.trim } = {}) {
  box(mb, [x0 - .08, 0, z0 - .08, x1 + .08, .45, z1 + .08], { c: .04, kind: FACE.trim, col: h.plinth, top: FACE.trim, occlude: false });
  box(mb, [x0, 0, z0, x1, height, z1], { c: .15, kind: FACE.window, col: h.wall, top: o.top ?? FACE.trim, bay: o.bay ?? 2.7, floor: o.floor ?? 2.9, winW: .44, winH: .48, even: ["+z", "-z"] });
}
/** A window set into a wall or a dormer: white frame, glass. `z` is the face it sits on, facing +z. */
function pane(mb: MeshBuilder, x: number, y0: number, y1: number, z: number, width: number) {
  box(mb, [x - width / 2 - .1, y0 - .1, z - .02, x + width / 2 + .1, y1 + .1, z + .06], { c: .02, kind: FACE.trim, col: TRIM, top: FACE.trim, occlude: false });
  box(mb, [x - width / 2, y0, z + .04, x + width / 2, y1, z + .09], { c: .01, kind: FACE.glass, top: FACE.glass, occlude: false });
}
/** A dormer on a front slope: a little gabled box with a window, its face `inset` behind the eaves line `front`. */
function dormer(mb: MeshBuilder, h: House, x: number, front: number, eaves: number, inset = .7) {
  const width = 1.8, z1 = front - inset, z0 = z1 - 2.4, top = eaves + 1.5;
  box(mb, [x - width / 2, eaves - .4, z0, x + width / 2, top, z1], { c: .06, kind: FACE.wall, col: h.wall, top: FACE.trim });
  gableRoof(mb, { a0: z0, a1: z1, b0: x - width / 2, b1: x + width / 2, y: top, pitch: .75, overhang: .2, axis: "z", roof: h.roof, wall: h.wall });
  pane(mb, x, eaves + .1, top - .25, z1, .9);
}
/** A slab on the given cells with a glass railing round its open sides. */
function balcony(mb: MeshBuilder, [x0, z0, x1, z1]: [number, number, number, number], y: number, open: ("+z" | "-z" | "+x" | "-x")[]) {
  box(mb, [x0, y - .18, z0, x1, y, z1], { c: .03, kind: FACE.trim, col: rgb("#d8d4cb"), top: FACE.trim });
  const rail = (b: [number, number, number, number, number, number]) => box(mb, b, { c: .01, kind: FACE.glass, top: FACE.trim, topCol: DARK, occlude: false });
  if (open.includes("+z")) rail([x0, y, z1 - .06, x1, y + 1, z1]);
  if (open.includes("-z")) rail([x0, y, z0, x1, y + 1, z0 + .06]);
  if (open.includes("+x")) rail([x1 - .06, y, z0, x1, y + 1, z1]);
  if (open.includes("-x")) rail([x0, y, z0, x0 + .06, y + 1, z1]);
}
const post = (mb: MeshBuilder, x: number, z: number, height: number, thick = .14) =>
  box(mb, [x - thick, 0, z - thick, x + thick, height, z + thick], { c: thick * .3, kind: FACE.trim, col: TRIM, top: FACE.trim });

/**
 * The houses as the shop describes them (app/services/city_estate.py PLOT_FAMILIES): the roof, the storeys, the
 * dormers, the porch, the garage or the carport, the balconies and the terrace each house is sold with.
 */
const HOUSES: Record<ReadyHouse, (mb: MeshBuilder, h: House) => void> = {
  // «Одноэтажный коттедж под вальмовой крышей со слуховым окном, навес для машины и выход в сад.»
  carport(mb, h) {
    const front = h.door[1], split = h.W / 2 - 5.2, eaves = 3.3;
    body(mb, h, [-h.W / 2, -h.D / 2, split, front], eaves, { floor: 3.3 });
    const ridge = hipRoof(mb, { x0: -h.W / 2, x1: split, z0: -h.D / 2, z1: front, y: eaves, pitch: .55, overhang: .5, roof: h.roof });
    dormer(mb, h, (-h.W / 2 + split) / 2 - 1.6, front, eaves);
    chimney(mb, -h.W / 2 + 2.2, -1.5, eaves - .5, ridge + .8);
    door(mb, h, front); canopy(mb, h.door[0], front, 2, .2, false);
    box(mb, [-1.2, .2, -h.D / 2 - .1, .2, 2.35, -h.D / 2 + .03], { c: .02, kind: FACE.trim, col: h.doorColour, top: FACE.trim });
    const [gx, gz] = h.garage!, x0 = split + .1, x1 = h.W / 2;
    box(mb, [x0, 2.75, -h.D / 2 + 1, x1, 3.0, gz + .4], { c: .04, kind: FACE.trim, col: TRIM, top: FACE.trim });
    for (const x of [x1 - .2, x0 + .25]) for (const z of [gz + .2, -h.D / 2 + 1.3]) post(mb, x, z, 2.75, .1);
    box(mb, [gx - 1.6, 0, -h.D / 2 + 1, gx + 1.6, .08, gz + .4], { c: .02, kind: FACE.trim, col: PAVING, top: FACE.trim, occlude: false });
  },
  // «Просторный одноэтажный дом под вальмовой крышей: крыльцо с колоннами и гараж.»
  bungalow(mb, h) {
    const split = h.W / 2 - 7.6, porch = [h.door[0] - 2, h.door[0] + 2], back = -h.D / 2, eaves = 3.3;
    body(mb, h, [-h.W / 2, back, porch[0], h.D / 2], eaves, { floor: 3.3 });
    body(mb, h, [porch[0], back, porch[1], h.door[1]], eaves, { floor: 3.3 });
    body(mb, h, [porch[1], back, split, h.D / 2], eaves, { floor: 3.3 });
    const ridge = hipRoof(mb, { x0: -h.W / 2, x1: split, z0: back, z1: h.D / 2, y: eaves, pitch: .5, overhang: .55, roof: h.roof });
    chimney(mb, -h.W / 2 + 3, -.5, eaves - .4, ridge + .7);
    door(mb, h, h.door[1]);
    for (const x of [porch[0] + .4, porch[1] - .4]) post(mb, x, h.D / 2 - .35, eaves, .2);
    const [gx, gz] = h.garage!;
    box(mb, [split, 0, back + 1.2, h.W / 2, 3, gz], { c: .12, kind: FACE.wall, col: h.wall, top: FACE.trim, faces: ["+z", "-z", "+x"] });
    hipRoof(mb, { x0: split, x1: h.W / 2, z0: back + 1.2, z1: gz, y: 3, pitch: .45, overhang: .35, roof: h.roof });
    garageDoor(mb, gx, gz, 3.2);
  },
  // «Полтора этажа: мансарда со слуховыми окнами, гараж и козырёк над входом.»
  attic(mb, h) {
    const split = h.W / 2 - 4.2, eaves = 3.9;
    body(mb, h, [-h.W / 2, -h.D / 2, split, h.door[1]], eaves, { floor: 3.9 });
    gableRoof(mb, { a0: -h.W / 2, a1: split, b0: -h.D / 2, b1: h.door[1], y: eaves, pitch: 1.05, overhang: .45, roof: h.roof, wall: h.wall });
    for (const x of [-h.W / 2 + 2.2, split - 2.2]) dormer(mb, h, x, h.door[1], eaves, .9);
    chimney(mb, -h.W / 2 + 1.8, -2, eaves - .4, eaves + (h.door[1] + h.D / 2) / 2 * 1.05 + .6);
    door(mb, h, h.door[1]); canopy(mb, h.door[0], h.door[1], 2.2, 1.1, false);
    const [gx, gz] = h.garage!;
    box(mb, [split, 0, -h.D / 2 + 2, h.W / 2, 3, gz], { c: .1, kind: FACE.wall, col: h.wall, top: FACE.deck });
    parapet(mb, split, -h.D / 2 + 2, h.W / 2, gz, 3, .35, .22, h.wall);
    garageDoor(mb, gx, gz, 2.8);
  },
  // «Два этажа под плоской крышей, встроенный гараж и балкон во двор.»
  modern(mb, h) {
    const front = h.door[1], back = -h.D / 2 + 1.3, white: V3 = rgb("#f2f0eb");
    box(mb, [-h.W / 2, 0, back, h.W / 2, 3.4, front], { c: .1, kind: FACE.window, col: white, top: FACE.deck, bay: 3.6, floor: 3.4, winW: .62, winH: .58 });
    box(mb, [-h.W / 2 + .8, 3.4, back, h.W / 2, 6.8, h.D / 2 - .4], { c: .1, kind: FACE.window, col: rgb("#33373c"), top: FACE.deck, bay: 3.4, floor: 3.4, winW: .66, winH: .6 });
    box(mb, [-h.W / 2 + .6, 6.8, back - .2, h.W / 2 + .2, 7.1, h.D / 2], { c: .03, kind: FACE.trim, col: white, top: FACE.deck });
    balcony(mb, [-h.W / 2 + 1.5, -h.D / 2, h.W / 2 - 1.5, back], 3.4, ["-z", "+x", "-x"]);
    door(mb, h, front);
    box(mb, [h.door[0] + .75, .3, front - .03, Math.min(h.W / 2 - .4, h.door[0] + 3.2), 3.0, front + .06], { c: .02, kind: FACE.glass, top: FACE.glass, occlude: false });
    const [gx, gz] = h.garage!;
    garageDoor(mb, gx, gz, 2.9);
  },
  // «Мансарда со слуховым окном, эркер в гостиной, гараж и балкон сбоку.»
  bayhouse(mb, h) {
    const split = -h.W / 2 + 6.2, front = h.door[1], eaves = 3.9, side = h.W / 2 - 1.4;
    body(mb, h, [split, -h.D / 2, side, front], eaves, { floor: 3.9 });
    const ridge = gableRoof(mb, { a0: split, a1: side, b0: -h.D / 2, b1: front, y: eaves, pitch: 1, overhang: .45, roof: h.roof, wall: h.wall });
    dormer(mb, h, h.door[0] - 2.4, front, eaves);
    chimney(mb, side - 1.8, -2, eaves - .5, ridge + .6);
    const bx0 = side - 4, bx1 = side - .8;
    box(mb, [bx0, 0, front - .2, bx1, 3.3, h.D / 2], { c: .2, kind: FACE.window, col: h.wall, top: FACE.trim, bay: 1.5, floor: 3.3, winW: .62, winH: .55 });
    hipRoof(mb, { x0: bx0, x1: bx1, z0: front - .2, z1: h.D / 2, y: 3.3, pitch: .6, overhang: .15, roof: h.roof });
    balcony(mb, [side, -2.5, h.W / 2, 1.5], 3.2, ["+x", "+z", "-z"]);
    door(mb, h, front); canopy(mb, h.door[0], front, 2.2, 1.1, false);
    const [gx, gz] = h.garage!;
    box(mb, [-h.W / 2, 0, -h.D / 2 + 1.5, split, 3.2, gz], { c: .12, kind: FACE.wall, col: h.wall, top: FACE.trim, faces: ["+z", "-z", "-x"] });
    gableRoof(mb, { a0: -h.D / 2 + 1.5, a1: gz, b0: -h.W / 2, b1: split, y: 3.2, pitch: .5, overhang: .35, axis: "z", roof: h.roof, wall: h.wall });
    garageDoor(mb, gx, gz, 3);
  },
  // «Два этажа под плоской крышей, терраса на столбах и балкон над входом.»
  terrace(mb, h) {
    const front = h.door[1], top = 6.2;
    body(mb, h, [-h.W / 2, -h.D / 2, h.W / 2, front], top, { top: FACE.deck, floor: 3.1 });
    parapet(mb, -h.W / 2, -h.D / 2, h.W / 2, front, top, .5, .25, h.wall);
    const x0 = h.door[0] + 1.8;
    balcony(mb, [x0, front, h.W / 2, h.D / 2], 3.1, ["+z", "+x", "-x"]);
    for (const x of [x0 + .2, h.W / 2 - .2]) post(mb, x, h.D / 2 - .2, 2.92, .13);
    balcony(mb, [h.door[0] - 1.4, front, h.door[0] + 1.4, front + 1.2], 3.1, ["+z", "-x", "+x"]);
    door(mb, h, front);
  },
};

/** A ready house in a finish (world/familyHouses.ts houseModelName: variant = (model - 1) * 2 + finish), in model units. */
export function readyHouseGeometry(family: ReadyHouse, finish: typeof FINISHES[number]): THREE.BufferGeometry {
  const m: ReadyHouseModel = READY_HOUSES[family], k = HOUSE_METRES, look = FINISH[finish];
  const h: House = {
    W: m.width * k, D: m.depth * k, H: m.height * k,
    door: [m.door[0] * k, m.depth * k / 2 - m.door[1] * k], garage: m.garage ? [m.garage[0] * k, m.depth * k / 2 - m.garage[1] * k] : null,
    wall: look.wall, plinth: look.plinth, doorColour: look.door, roof: ROOF[family],
  };
  const mb = new MeshBuilder();
  HOUSES[family](mb, h);
  bakeOcclusion(mb);
  return mb.build(1 / k);
}

// ---- office towers ---------------------------------------------------------------------------------------------
interface Tower {
  /** Glass tint, stone. */
  glass: V3; stone: V3;
  /** Volumes from the ground up as [inset, top share of the height, curtain wall or stone with windows]. */
  tiers: [number, number, "glass" | "stone"][];
  chamfer?: number; ring?: boolean;
}
const TOWERS: Record<Exclude<OfficeBuilding, "officej">, Tower> = {
  officea: { glass: rgb("#7da7c2"), stone: rgb("#d9d4cb"), tiers: [[0, .16, "stone"], [1, 1, "glass"]] },
  officeb: { glass: rgb("#9cb4c4"), stone: rgb("#cfc6b8"), tiers: [[0, .86, "stone"], [1.4, 1, "stone"]] },
  officec: { glass: rgb("#86a9b8"), stone: rgb("#d5d0c6"), tiers: [[0, .55, "glass"], [1.6, .8, "glass"], [3.2, 1, "glass"]] },
  officed: { glass: rgb("#5d7a8e"), stone: rgb("#cfd3d6"), tiers: [[0, .12, "stone"], [.6, 1, "glass"]], chamfer: 2.4 },
  officee: { glass: rgb("#8fb3c4"), stone: rgb("#b9a99a"), tiers: [[0, .42, "stone"], [.8, 1, "glass"]] },
  officef: { glass: rgb("#4f6f80"), stone: rgb("#c9c5bd"), tiers: [[0, .14, "stone"], [.5, 1, "glass"]], ring: true },
  officeg: { glass: rgb("#7fa2b3"), stone: rgb("#d2cabd"), tiers: [[0, .2, "stone"], [.9, 1, "glass"]] },
  officeh: { glass: rgb("#9ab3c9"), stone: rgb("#d6cfc2"), tiers: [[0, .38, "glass"], [2.2, 1, "glass"]] },
  officei: { glass: rgb("#6f97ac"), stone: rgb("#e0dbd1"), tiers: [[0, .1, "stone"], [.6, 1, "glass"]], chamfer: .9, ring: true },
};

/**
 * «Башня с пирамидой», after the glass business complex of the owner's photographs: volumes of mirror glass with cut
 * corners step down from a core under a steep pyramid, small pinnacles stand on the shoulders, a dark granite podium
 * of two floors carries bronze shop windows, and a glass lobby under a canopy has a little glass pyramid of its own.
 * Like the other towers it stands back by its canopy, so the canopy ends at the footprint's front.
 */
function pyramidTower(): THREE.BufferGeometry {
  const model = OFFICE_BUILDINGS.officej, k = OFFICE_METRES;
  const W = model.width * k, D = model.depth * k, top = model.height * k, hw = W / 2;
  const FLOOR = 3.6, PODIUM = 2 * FLOOR, back = -D / 2, front = D / 2 - 1.6;
  const GRANITE = rgb("#765a4a"), BRONZE = rgb("#8c7a5e"), STEEL = rgb("#46535e");
  const mb = new MeshBuilder();
  /** Mirror-glass floors from the podium up on a rectangle of the plan, three rows of panes to a floor; returns the roof's height. */
  const tier = (x0: number, x1: number, z0: number, z1: number, floors: number, tint: string, c = .9) => {
    const roof = PODIUM + floors * FLOOR;
    box(mb, [x0, PODIUM, z0, x1, roof, z1], { c, kind: FACE.mirror, col: rgb(tint), top: FACE.deck, bay: 1.1, floor: FLOOR / 3, crisp: true });
    return roof;
  };
  box(mb, [-hw, 0, back, hw, PODIUM, front], { c: .3, kind: FACE.wall, col: GRANITE, top: FACE.deck });
  // The plan is three rows of three: the core in the middle, the volumes stepping down by a floor or two round it and
  // by more to the front and the corners, so the mass stays broad and its top edge is notched.
  const xi = 4.6, zf = 2.8, zb = -6.4;
  const core = tier(-xi, xi, zb, zf, 10, "#a3c2d6", 2.2);
  const block = tier(-xi, xi, zf, front, 6, "#aac6d8");
  const west = tier(-hw, -xi, zb, zf, 8, "#93b3c9", 1.2);
  const east = tier(xi, hw, zb, zf, 9, "#88a8c0", 1.2);
  tier(-hw, -xi, zf, front - 1.2, 4, "#9dbad0");
  tier(xi, hw, zf, front - .6, 5, "#9dbad0");
  tier(-xi, xi, back, zb, 8, "#829fb6", 1.2);
  tier(-hw, -xi, back, zb, 6, "#8fadc3");
  tier(xi, hw, back, zb, 7, "#8fadc3");
  // The crown: a collar of dark steel, the pyramid, a mast with its red light, and a pinnacle on each shoulder.
  const zc = (zb + zf) / 2, collar = core + 1.4;
  box(mb, [-3.5, core - .8, zc - 3.5, 3.5, collar, zc + 3.5], { c: .25, kind: FACE.trim, col: STEEL, top: FACE.trim, topCol: rgb("#3a444d") });
  const apex = pyramid(mb, { x0: -3.2, x1: 3.2, z0: zc - 3.2, z1: zc + 3.2, y: collar, height: 7.4, col: rgb("#a3bccf"), kind: FACE.spire, win: [1.2, 1.2, 0, 0] });
  box(mb, [-.14, apex - .4, zc - .14, .14, top - .5, zc + .14], { c: .03, kind: FACE.trim, col: rgb("#aab0b5"), top: FACE.trim, occlude: false });
  box(mb, [-.25, top - .5, zc - .25, .25, top, zc + .25], { c: .04, kind: FACE.light, col: rgb("#ff3a2a"), top: FACE.light, occlude: false });
  for (const [side, roof] of [[-1, west], [1, east]] as const) {
    const x = side * 6.9;
    pyramid(mb, { x0: x - 1.2, x1: x + 1.2, z0: -.6, z1: 1.8, y: roof, height: 2.6, col: rgb("#a3bccf"), kind: FACE.spire, win: [.9, .9, 0, 0] });
  }
  // A glass pyramid over the stair on the roof of the block in front of the core.
  pyramid(mb, { x0: -1.4, x1: 1.4, z0: 3.9, z1: 6.5, y: block, height: 1.8, col: rgb("#a3bccf"), kind: FACE.spire, win: [.8, .8, 0, 0] });
  // Shop windows in bronze between the piers of the podium's four walls.
  const shop = (box6: [number, number, number, number, number, number]) => box(mb, box6, { c: .02, kind: FACE.curtain, col: BRONZE, top: FACE.trim, bay: 1.4, floor: 2.9, occlude: false });
  for (const [x0, x1] of [[-8.4, -5], [5, 8.4]]) shop([x0, .5, front, x1, 6.3, front + .14]);
  for (const [x0, x1] of [[-8.4, -1], [1, 8.4]]) shop([x0, .5, back - .14, x1, 6.3, back]);
  for (const [z0, z1] of [[back + 1, -1], [.4, front - 1]]) { shop([-hw - .14, .5, z0, -hw, 6.3, z1]); shop([hw, .5, z0, hw + .14, 6.3, z1]); }
  // The entrance: a glass lobby, a canopy over it, and a little glass pyramid on the canopy.
  box(mb, [-3.2, 0, front - .1, 3.2, 4.2, front + .15], { c: .03, kind: FACE.glass, top: FACE.glass, occlude: false });
  box(mb, [-4, 4.3, front - .1, 4, 4.6, D / 2], { c: .05, kind: FACE.trim, col: DARK, top: FACE.trim });
  pyramid(mb, { x0: -1.3, x1: 1.3, z0: front + .1, z1: D / 2 - .1, y: 4.6, height: 1.7, col: rgb("#8fb0c6"), kind: FACE.spire, win: [.7, .7, 0, 0] });
  bakeOcclusion(mb, { reach: 5 });
  return mb.build(1 / k);
}

/** An office tower, in model units: tiers of curtain wall or stone, a glass lobby and canopy at the front, a crown. */
export function officeTowerGeometry(family: OfficeBuilding): THREE.BufferGeometry {
  if (family === "officej") return pyramidTower();
  const model = OFFICE_BUILDINGS[family], t = TOWERS[family], k = OFFICE_METRES;
  const W = model.width * k, D = model.depth * k, H = model.height * k * .9, top = model.height * k;
  // The tower stands back by its canopy, so the canopy over the entrance ends at the footprint's front.
  const CANOPY = 1.6, back = -D / 2, front = D / 2 - CANOPY;
  const mb = new MeshBuilder();
  let y = 0, inset = 0;
  for (const [step, share, skin] of t.tiers) {
    inset = step;
    const height = H * share, x0 = -W / 2 + inset, x1 = W / 2 - inset, z0 = back + inset, z1 = front - inset;
    const c = t.chamfer && skin === "glass" ? t.chamfer : .25;
    if (skin === "glass") box(mb, [x0, y, z0, x1, height, z1], { c, kind: FACE.curtain, col: t.glass, top: FACE.deck, bay: 1.5, floor: 3.6 });
    else box(mb, [x0, y, z0, x1, height, z1], { c, kind: FACE.window, col: t.stone, top: FACE.deck, bay: 1.7, floor: 3.6, winW: .6, winH: .66 });
    y = height;
  }
  // The crown: a parapet, the plant room, a mast with its red light; a lit band on some.
  const x0 = -W / 2 + inset, x1 = W / 2 - inset, z0 = back + inset, z1 = front - inset, zm = (back + front) / 2;
  parapet(mb, x0, z0, x1, z1, y, .9, .35, t.stone);
  box(mb, [-W * .2, y, zm - D * .2, W * .2, y + 3.4, zm + D * .2], { c: .08, kind: FACE.wall, col: rgb("#c3c6c9"), top: FACE.trim });
  box(mb, [W * .08 - .14, y + 3.4, zm + D * .08 - .14, W * .08 + .14, top - .5, zm + D * .08 + .14], { c: .03, kind: FACE.trim, col: rgb("#aab0b5"), top: FACE.trim, occlude: false });
  box(mb, [W * .08 - .25, top - .5, zm + D * .08 - .25, W * .08 + .25, top, zm + D * .08 + .25], { c: .04, kind: FACE.light, col: rgb("#ff3a2a"), top: FACE.light, occlude: false });
  if (t.ring) box(mb, [x0 - .05, y - 1.2, z0 - .05, x1 + .05, y - .7, z1 + .05], { c: .05, kind: FACE.light, col: rgb("#dcecff"), top: FACE.trim, occlude: false });
  // The entrance: a glass lobby and a canopy over it.
  box(mb, [-3.2, 0, front - .1, 3.2, 4.2, front + .15], { c: .03, kind: FACE.glass, top: FACE.glass, occlude: false });
  box(mb, [-4, 4.3, front - .1, 4, 4.6, D / 2], { c: .05, kind: FACE.trim, col: DARK, top: FACE.trim });
  bakeOcclusion(mb, { reach: 5 });
  return mb.build(1 / k);
}

/** Every ready house (family, finish) by its model's variant (world/familyHouses.ts houseModelName). */
export const READY_HOUSE_VARIANTS = (Object.entries(READY_HOUSES) as [ReadyHouse, ReadyHouseModel][])
  .sort((a, b) => a[1].model - b[1].model).flatMap(([family]) => FINISHES.map(finish => ({ family, finish })));
