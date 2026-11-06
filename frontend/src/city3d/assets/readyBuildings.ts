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
import { FACE, MeshBuilder, bakeOcclusion, box, gableRoof, hipRoof, parapet, rgb, type V3 } from "./facade";
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
const TOWERS: Record<OfficeBuilding, Tower> = {
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

/** An office tower, in model units: tiers of curtain wall or stone, a glass lobby and canopy at the front, a crown. */
export function officeTowerGeometry(family: OfficeBuilding): THREE.BufferGeometry {
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
