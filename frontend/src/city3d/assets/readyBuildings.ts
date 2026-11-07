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
import { FACE, MeshBuilder, bakeOcclusion, box, cylinder, extrude, gableRoof, hipRoof, parapet, pyramid, rgb, tent, type Plan, type V3 } from "./facade";
import { FINISHES, READY_HOUSES, type ReadyHouse, type ReadyHouseModel } from "../world/familyHouses";
import { NURLY_TAU_RISE, NURLY_TAU_WIDTH, OFFICE_BUILDINGS, type OfficeBuilding } from "../world/officeBuildings";

/** Metres in one of the tables' model units: a house is drawn 1.35 times bigger, an office twice, a unit is about 4 m. */
const HOUSE_METRES = 4 * 1.35, OFFICE_METRES = 4 * 2;
const FINISH: Record<typeof FINISHES[number], { wall: V3; plinth: V3; door: V3 }> = {
  brick: { wall: rgb("#b85f3b"), plinth: rgb("#80654f"), door: rgb("#225e84") },
  stone: { wall: rgb("#f0ddbd"), plinth: rgb("#a3947a"), door: rgb("#8c4930") },
};
const ROOF: Record<ReadyHouse, V3> = {
  carport: rgb("#426a86"), bungalow: rgb("#c65c39"), attic: rgb("#415a7a"), modern: rgb("#f6eddb"), bayhouse: rgb("#a85139"), terrace: rgb("#356c83"),
};
const TRIM = rgb("#fff5df"), DARK = rgb("#273e4f"), PAVING = rgb("#c6b9a0"), GARAGE = rgb("#ece9df");
const ZINC = rgb("#a0afb4"), ANODIZED = rgb("#49738a"), VENT = rgb("#3b474b");

interface House { W: number; D: number; H: number; door: [number, number]; garage: [number, number] | null; wall: V3; plinth: V3; doorColour: V3; roof: V3 }

function door(mb: MeshBuilder, h: House, front: number) {
  const x = h.door[0];
  box(mb, [x - .55, .2, front - .03, x + .55, 2.35, front + .1], { c: .02, kind: FACE.trim, col: h.doorColour, top: FACE.trim });
  box(mb, [x - .28, 1.25, front + .09, x + .28, 2.15, front + .13], { c: .01, kind: FACE.glass, top: FACE.glass, occlude: false });
  box(mb, [x - .9, 0, front, x + .9, .18, front + .8], { c: .03, kind: FACE.trim, col: PAVING, top: FACE.trim, occlude: false });
  // Separate jambs, a weather seal, threshold and pull make the entrance readable at street level.
  mb.detail(() => {
    for (const side of [-1, 1]) box(mb, [x + side * .58 - .045, .18, front + .08, x + side * .58 + .045, 2.42, front + .16], { c: 0, kind: FACE.trim, col: TRIM, top: FACE.trim, occlude: false });
    box(mb, [x - .625, 2.35, front + .08, x + .625, 2.45, front + .16], { c: 0, kind: FACE.trim, col: TRIM, top: FACE.trim, occlude: false });
    box(mb, [x - .53, .18, front + .08, x + .53, .24, front + .28], { c: 0, kind: FACE.metal, col: ZINC, top: FACE.metal, occlude: false });
    box(mb, [x + .34, .92, front + .13, x + .38, 1.3, front + .2], { c: 0, kind: FACE.metal, col: ANODIZED, top: FACE.metal, occlude: false });
    box(mb, [x - .83, 1.79, front + .07, x - .67, 2.13, front + .2], { c: 0, kind: FACE.metal, col: ANODIZED, top: FACE.trim, topCol: TRIM, occlude: false });
  });
}
function canopy(mb: MeshBuilder, x: number, front: number, width: number, depth: number, posts = true) {
  box(mb, [x - width / 2, 2.75, front, x + width / 2, 2.95, front + depth], { c: .03, kind: FACE.trim, col: TRIM, top: FACE.trim });
  if (posts) for (const side of [-1, 1]) box(mb, [x + side * (width / 2 - .12) - .07, 0, front + depth - .18, x + side * (width / 2 - .12) + .07, 2.75, front + depth - .04], { c: .02, kind: FACE.trim, col: TRIM, top: FACE.trim });
}
function garageDoor(mb: MeshBuilder, x: number, front: number, width = 3) {
  // Recess the leaf behind the frame. Raised sectional rails retain the original outer face and footprint.
  box(mb, [x - width / 2, 0, front - .03, x + width / 2, 2.3, front + .04], { c: .02, kind: FACE.trim, col: GARAGE, top: FACE.trim });
  mb.detail(() => {
    for (const side of [-1, 1]) box(mb, [x + side * (width / 2 - .05) - .05, 0, front + .035, x + side * (width / 2 - .05) + .05, 2.3, front + .08], { c: 0, kind: FACE.metal, col: ZINC, top: FACE.metal, occlude: false });
    box(mb, [x - width / 2, 2.2, front + .035, x + width / 2, 2.3, front + .08], { c: 0, kind: FACE.metal, col: ZINC, top: FACE.metal, occlude: false });
    for (const y of [.5, 1.05, 1.6]) box(mb, [x - width / 2 + .1, y, front + .04, x + width / 2 - .1, y + .025, front + .075], { c: 0, kind: FACE.trim, col: rgb("#aaa9a3"), top: FACE.trim, occlude: false });
    box(mb, [x - .17, .9, front + .04, x + .17, .95, front + .08], { c: 0, kind: FACE.metal, col: ANODIZED, top: FACE.metal, occlude: false });
  });
}
function chimney(mb: MeshBuilder, x: number, z: number, y0: number, y1: number) {
  box(mb, [x - .42, y0, z - .42, x + .42, y1, z + .42], { c: .03, kind: FACE.trim, col: rgb("#8e5240"), top: FACE.trim });
  box(mb, [x - .52, y1, z - .52, x + .52, y1 + .14, z + .52], { c: .02, kind: FACE.trim, col: rgb("#c8c3b8"), top: FACE.trim });
}
/** A body with its plinth: windows in every wall; `top` is what its roof face is (hidden under a pitched roof). */
function body(mb: MeshBuilder, h: House, [x0, z0, x1, z1]: [number, number, number, number], height: number, o: { floor?: number; bay?: number; top?: typeof FACE.deck | typeof FACE.trim } = {}) {
  box(mb, [x0 - .08, 0, z0 - .08, x1 + .08, .45, z1 + .08], { c: .04, kind: FACE.trim, col: h.plinth, top: FACE.trim, occlude: false });
  box(mb, [x0, 0, z0, x1, height, z1], { c: .15, kind: FACE.window, col: h.wall, top: o.top ?? FACE.trim, bay: o.bay ?? 2.7, floor: o.floor ?? 2.9, winW: .44, winH: .48, even: ["+z", "-z"] });
  mb.detail(() => {
    // Gutters sit under the eaves and the downpipe stays beside a corner, clear of doors and windows.
    box(mb, [x0 + .1, height - .12, z1 + .04, x1 - .1, height - .035, z1 + .15], { c: 0, kind: FACE.metal, col: ZINC, top: FACE.metal, occlude: false });
    box(mb, [x0 + .1, .35, z1 + .065, x0 + .18, height - .08, z1 + .145], { c: 0, kind: FACE.metal, col: ZINC, top: FACE.metal, occlude: false });
  });
}
/** A window set into a wall or a dormer: white frame, glass. `z` is the face it sits on, facing +z. */
function pane(mb: MeshBuilder, x: number, y0: number, y1: number, z: number, width: number) {
  box(mb, [x - width / 2 - .1, y0 - .1, z - .02, x + width / 2 + .1, y1 + .1, z + .06], { c: .02, kind: FACE.trim, col: TRIM, top: FACE.trim, occlude: false });
  box(mb, [x - width / 2, y0, z + .04, x + width / 2, y1, z + .09], { c: .01, kind: FACE.glass, top: FACE.glass, occlude: false });
  mb.detail(() => {
    box(mb, [x - .025, y0, z + .085, x + .025, y1, z + .13], { c: 0, kind: FACE.trim, col: TRIM, top: FACE.trim, occlude: false });
    box(mb, [x - width / 2 - .17, y0 - .16, z + .04, x + width / 2 + .17, y0 - .09, z + .23], { c: 0, kind: FACE.trim, col: TRIM, top: FACE.trim, occlude: false });
  });
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

/** A compact roof condenser: metal enclosure, recessed louvers and a real octagonal fan grille. */
function roofPlant(mb: MeshBuilder, x: number, z: number, y: number, w = 1.7, d = 1.2, h = .65) {
  mb.detail(() => {
    box(mb, [x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2], { c: 0, kind: FACE.metal, col: ZINC, top: FACE.metal, occlude: false });
    for (let i = 1; i <= 4; i++) {
      const yy = y + h * (.12 + i * .15), front = z + d / 2 + .004;
      mb.quad([[x - w * .4, yy, front], [x + w * .4, yy, front], [x + w * .4, yy + h * .045, front], [x - w * .4, yy + h * .045, front]], { kind: FACE.trim, col: VENT });
    }
    const radius = Math.min(w, d) * .32, top = y + h + .006;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, b = (i + 1) * Math.PI / 4;
      mb.tri([[x, top, z], [x + Math.cos(b) * radius, top, z + Math.sin(b) * radius], [x + Math.cos(a) * radius, top, z + Math.sin(a) * radius]], { kind: FACE.trim, col: VENT, n: [0, 1, 0] });
    }
  });
}

/** Door leaves remain behind a three-part metal frame; a low stone step meets the unchanged entrance path. */
function officeEntrance(mb: MeshBuilder, front: number) {
  mb.detail(() => {
    for (const x of [-1.1, 0, 1.1]) box(mb, [x - .035, .03, front + .15, x + .035, 3.25, front + .23], { c: 0, kind: FACE.metal, col: ANODIZED, top: FACE.metal, occlude: false });
    box(mb, [-1.135, 3.2, front + .15, 1.135, 3.3, front + .23], { c: 0, kind: FACE.metal, col: ANODIZED, top: FACE.metal, occlude: false });
    for (const x of [-.15, .15]) box(mb, [x - .025, 1.1, front + .23, x + .025, 1.65, front + .32], { c: 0, kind: FACE.metal, col: ZINC, top: FACE.metal, occlude: false });
    box(mb, [-3.45, 0, front + .1, 3.45, .12, front + 1.1], { c: 0, kind: FACE.trim, col: PAVING, top: FACE.trim, occlude: false });
  });
}

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
    // A recessed flat deck with coping rather than one featureless solid roof slab.
    box(mb, [-h.W / 2 + .6, 6.8, back - .2, h.W / 2 + .2, 6.9, h.D / 2], { c: .03, kind: FACE.trim, col: white, top: FACE.deck });
    const rx0 = -h.W / 2 + .6, rx1 = h.W / 2 + .2, rz0 = back - .2, rz1 = h.D / 2;
    for (const b of [[rx0, 6.9, rz0, rx1, 7.1, rz0 + .16], [rx0, 6.9, rz1 - .16, rx1, 7.1, rz1], [rx0, 6.9, rz0 + .16, rx0 + .16, 7.1, rz1 - .16], [rx1 - .16, 6.9, rz0 + .16, rx1, 7.1, rz1 - .16]] as [number, number, number, number, number, number][]) box(mb, b, { c: 0, kind: FACE.trim, col: white, top: FACE.metal, topCol: ZINC });
    roofPlant(mb, h.W * .2, 0, 6.91, 1.3, .9, .15);
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
    roofPlant(mb, -h.W * .22, -h.D * .24, top + .03, 1.5, 1, .42);
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
const TOWERS: Record<Exclude<OfficeBuilding, "officej" | "officek" | "officel">, Tower> = {
  officea: { glass: rgb("#76bce5"), stone: rgb("#f1dfbd"), tiers: [[0, .16, "stone"], [1, 1, "glass"]] },
  officeb: { glass: rgb("#a1c4df"), stone: rgb("#edc9a3"), tiers: [[0, .86, "stone"], [1.4, 1, "stone"]] },
  officec: { glass: rgb("#76c5ce"), stone: rgb("#e4e6d0"), tiers: [[0, .55, "glass"], [1.6, .8, "glass"], [3.2, 1, "glass"]] },
  officed: { glass: rgb("#4a93bd"), stone: rgb("#d5e6f0"), tiers: [[0, .12, "stone"], [.6, 1, "glass"]], chamfer: 2.4 },
  officee: { glass: rgb("#8bc8de"), stone: rgb("#dcbca2"), tiers: [[0, .42, "stone"], [.8, 1, "glass"]] },
  officef: { glass: rgb("#416f9f"), stone: rgb("#e8d7bd"), tiers: [[0, .14, "stone"], [.5, 1, "glass"]], ring: true },
  officeg: { glass: rgb("#67b6c9"), stone: rgb("#ebd7b5"), tiers: [[0, .2, "stone"], [.9, 1, "glass"]] },
  officeh: { glass: rgb("#9bbce7"), stone: rgb("#e5d5ed"), tiers: [[0, .38, "glass"], [2.2, 1, "glass"]] },
  officei: { glass: rgb("#5cacc8"), stone: rgb("#f4e6c9"), tiers: [[0, .1, "stone"], [.6, 1, "glass"]], chamfer: .9, ring: true },
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
  const GRANITE = rgb("#8b6650"), BRONZE = rgb("#8c7a5e"), STEEL = rgb("#4b6d83");
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
  const core = tier(-xi, xi, zb, zf, 10, "#91c7e1", 2.2);
  const block = tier(-xi, xi, zf, front, 6, "#a1d0e5");
  const west = tier(-hw, -xi, zb, zf, 8, "#80b9d7", 1.2);
  const east = tier(xi, hw, zb, zf, 9, "#73accd", 1.2);
  tier(-hw, -xi, zf, front - 1.2, 4, "#8bc2dd");
  tier(xi, hw, zf, front - .6, 5, "#8bc2dd");
  tier(-xi, xi, back, zb, 8, "#699cbd", 1.2);
  tier(-hw, -xi, back, zb, 6, "#80b0d0");
  tier(xi, hw, back, zb, 7, "#80b0d0");
  // The crown: a collar of dark steel, the pyramid, a mast with its red light, and a pinnacle on each shoulder.
  const zc = (zb + zf) / 2, collar = core + 1.4;
  box(mb, [-3.5, core - .8, zc - 3.5, 3.5, collar, zc + 3.5], { c: .25, kind: FACE.trim, col: STEEL, top: FACE.trim, topCol: rgb("#3a444d") });
  const apex = collar + 7.4;
  pyramid(mb, { x0: -3.2, x1: 3.2, z0: zc - 3.2, z1: zc + 3.2, y: collar, h: apex - collar, roof: rgb("#a2cde3"), kind: FACE.spire, win: [1.2, 1.2, 0, 0] });
  box(mb, [-.14, apex - .4, zc - .14, .14, top - .5, zc + .14], { c: .03, kind: FACE.trim, col: rgb("#aab0b5"), top: FACE.trim, occlude: false });
  box(mb, [-.25, top - .5, zc - .25, .25, top, zc + .25], { c: .04, kind: FACE.light, col: rgb("#ff3a2a"), top: FACE.light, occlude: false });
  for (const [side, roof] of [[-1, west], [1, east]] as const) {
    const x = side * 6.9;
    pyramid(mb, { x0: x - 1.2, x1: x + 1.2, z0: -.6, z1: 1.8, y: roof, h: 2.6, roof: rgb("#a2cde3"), kind: FACE.spire, win: [.9, .9, 0, 0] });
  }
  // A glass pyramid over the stair on the roof of the block in front of the core.
  pyramid(mb, { x0: -1.4, x1: 1.4, z0: 3.9, z1: 6.5, y: block, h: 1.8, roof: rgb("#a2cde3"), kind: FACE.spire, win: [.8, .8, 0, 0] });
  // Shop windows in bronze between the piers of the podium's four walls.
  const shop = (box6: [number, number, number, number, number, number]) => box(mb, box6, { c: .02, kind: FACE.curtain, col: BRONZE, top: FACE.trim, bay: 1.4, floor: 2.9, occlude: false });
  for (const [x0, x1] of [[-8.4, -5], [5, 8.4]]) shop([x0, .5, front, x1, 6.3, front + .14]);
  for (const [x0, x1] of [[-8.4, -1], [1, 8.4]]) shop([x0, .5, back - .14, x1, 6.3, back]);
  for (const [z0, z1] of [[back + 1, -1], [.4, front - 1]]) { shop([-hw - .14, .5, z0, -hw, 6.3, z1]); shop([hw, .5, z0, hw + .14, 6.3, z1]); }
  // The entrance: a glass lobby, a canopy over it, and a little glass pyramid on the canopy.
  box(mb, [-3.2, 0, front - .1, 3.2, 4.2, front + .15], { c: .03, kind: FACE.glass, top: FACE.glass, occlude: false });
  box(mb, [-4, 4.3, front - .1, 4, 4.6, D / 2], { c: .05, kind: FACE.trim, col: DARK, top: FACE.trim });
  pyramid(mb, { x0: -1.3, x1: 1.3, z0: front + .1, z1: D / 2 - .1, y: 4.6, h: 1.7, roof: rgb("#8fc3df"), kind: FACE.spire, win: [.7, .7, 0, 0] });
  officeEntrance(mb, front);
  roofPlant(mb, -6.8, back + 2, PODIUM + 6 * FLOOR + .04, 1.6, 1.2, .8);
  roofPlant(mb, 6.8, back + 2, PODIUM + 7 * FLOOR + .04, 1.6, 1.2, .8);
  mb.detail(() => {
    for (const x of [-xi + .2, xi - .2]) box(mb, [x - .05, PODIUM, zf + .015, x + .05, core - .12, zf + .12], { c: 0, kind: FACE.metal, col: ZINC, top: FACE.metal, occlude: false });
  });
  bakeOcclusion(mb, { reach: 5 });
  return mb.build(1 / k);
}

/**
 * The Empire State Building (world/officeBuildings.ts officek), after the owner's model of it: drawn in its own metres
 * (130 m along the street) from the setbacks, the mast and the antenna measured in that model, and handed over in model
 * units. Limestone with windows drawn by the facade material (lit at night), a plinth of five floors with bronze shop
 * fronts and an entrance on each long side, three setbacks to the 21st floor, the shaft, five steps of the crown, the
 * octagonal mooring mast with its observatory and a lit ring, the antenna and its red light.
 */
function empireState(): THREE.BufferGeometry {
  const model = OFFICE_BUILDINGS.officek, M = 130.4 / model.width, top = model.height * M;
  const STONE = rgb("#e8d9b9"), CROWN = rgb("#f2e6ca"), ALUMINIUM = rgb("#718c96"), BRONZE = rgb("#98713f"), STEEL = rgb("#91a8ad");
  const mb = new MeshBuilder();
  /** A limestone volume with its windows: half its width and depth, from y0 to y1. */
  const stone = (hx: number, hz: number, y0: number, y1: number, col = STONE) =>
    box(mb, [-hx, y0, -hz, hx, y1, hz], { c: .8, kind: FACE.window, col, top: FACE.deck, bay: 2.4, floor: 3.8, winW: .4, winH: .84, crisp: true });
  stone(65.2, 29.2, 0, 21.5);
  stone(58.7, 26.2, 21.5, 35.5);
  stone(51.2, 24.2, 35.5, 58);
  stone(41.7, 21.7, 58, 84);
  stone(30.2, 19, 84, 270);
  stone(27.2, 17.3, 270, 285);
  stone(23.2, 15.6, 285, 299);
  stone(18.7, 13.7, 299, 311);
  stone(15.2, 12.2, 311, 320);
  stone(11.2, 9.5, 320, 330.2, CROWN);
  // The mooring mast: octagons of limestone and of aluminium ribs over glass, the observatory, a ring lit at night.
  // Octagons with walls facing the street and the sides: eight segments turned by half of one, their radius to a corner.
  const OCTAGON = { x: 0, z: 0, seg: 8, a0: Math.PI / 8, a1: Math.PI / 8 + Math.PI * 2 };
  const mast = (r: number, y0: number, y1: number, kind: typeof FACE.window | typeof FACE.curtain | typeof FACE.trim | typeof FACE.light, col: V3, top?: number) =>
    cylinder(mb, { ...OCTAGON, r: r / Math.cos(Math.PI / 8), r1: top && top / Math.cos(Math.PI / 8), y0, y1, kind, col, top: FACE.trim, topCol: CROWN, bay: 1.6, floor: 3.8, winW: .4, winH: .7 });
  mast(8.8, 330.2, 336.4, FACE.window, CROWN);
  mast(7.7, 336.4, 352.2, FACE.curtain, ALUMINIUM);
  mast(7.35, 352.2, 354.3, FACE.trim, CROWN);
  mast(6.75, 354.3, 369, FACE.curtain, ALUMINIUM);
  mast(6, 369, 370, FACE.light, rgb("#fff1d6"));
  mast(5.65, 370, 376.7, FACE.curtain, rgb("#4a5c5c"));
  mast(5.5, 376.7, 377.4, FACE.trim, STEEL);
  mast(5.3, 377.4, 380.8, FACE.trim, CROWN);
  mast(2, 380.8, 381.1, FACE.trim, STEEL);
  // The antenna: a tapering lattice, thinner masts, and the red light on its tip.
  cylinder(mb, { x: 0, z: 0, seg: 4, a0: Math.PI / 4, a1: Math.PI * 2.25, r: 1.5 * Math.SQRT2, r1: .9 * Math.SQRT2, y0: 381.1, y1: 408, kind: FACE.trim, col: STEEL, top: FACE.trim, occlude: false });
  for (const [r, y0, y1] of [[.8, 408, 416], [.6, 416, 431], [.4, 431, 440], [.2, 440, top - 1.2]]) cylinder(mb, { ...OCTAGON, r, y0, y1, kind: FACE.trim, col: STEEL, top: FACE.trim, occlude: false });
  box(mb, [-.5, top - 1.2, -.5, .5, top, .5], { c: .1, kind: FACE.light, col: rgb("#ff3a2a"), top: FACE.light, occlude: false });
  // Bronze shop fronts round the plinth, and an entrance with a canopy on each long side.
  const shop = (b: [number, number, number, number, number, number]) => box(mb, b, { c: .05, kind: FACE.curtain, col: BRONZE, top: FACE.trim, bay: 2.2, floor: 5.8, occlude: false });
  for (const side of [-1, 1]) {
    const z = side * 29.2, out = side * .4;
    for (const [x0, x1] of [[-62, -10], [10, 62]]) shop([x0, .6, Math.min(z, z + out), x1, 6.4, Math.max(z, z + out)]);
    shop([side * 65.2 + (side > 0 ? 0 : -.4), .6, -25, side * 65.2 + (side > 0 ? .4 : 0), 6.4, 25]);
    box(mb, [-8, 0, Math.min(z, side * 30), 8, 11.7, Math.max(z, side * 30)], { c: .2, kind: FACE.trim, col: BRONZE, top: FACE.trim });
    box(mb, [-5, 0, Math.min(z, side * 30.2), 5, 7.5, Math.max(z, side * 30.2)], { c: .05, kind: FACE.glass, top: FACE.glass, occlude: false });
    box(mb, [-9.5, 9, Math.min(z, side * 33), 9.5, 10.2, Math.max(z, side * 33)], { c: .15, kind: FACE.trim, col: BRONZE, top: FACE.trim });
  }
  mb.detail(() => {
    // The shaft's restrained Art Deco piers break the long limestone elevations without changing the setbacks.
    for (const side of [-1, 1]) for (const x of [-27.6, 27.6]) box(mb, [x - .45, 84, side * 19 - .22, x + .45, 270, side * 19 + .22], { c: 0, kind: FACE.trim, col: CROWN, top: FACE.trim, occlude: false });
    for (const [hx, hz, y] of [[65.2, 29.2, 21.5], [58.7, 26.2, 35.5], [51.2, 24.2, 58]]) for (const side of [-1, 1]) box(mb, [-hx + 1.2, y, side * hz - .18, hx - 1.2, y + .65, side * hz + .18], { c: 0, kind: FACE.trim, col: CROWN, top: FACE.trim, occlude: false });
    for (const side of [-1, 1]) {
      const z0 = side * 30.2, z1 = side * 30.34;
      for (const x of [-2.7, 0, 2.7]) box(mb, [x - .09, .1, Math.min(z0, z1), x + .09, 7.5, Math.max(z0, z1)], { c: 0, kind: FACE.metal, col: BRONZE, top: FACE.metal, occlude: false });
    }
    for (const yy of [387, 396, 405]) {
      box(mb, [-1.3, yy, -.055, 1.3, yy + .1, .055], { c: 0, kind: FACE.metal, col: STEEL, top: FACE.metal, occlude: false });
      box(mb, [-.055, yy, -1.3, .055, yy + .1, 1.3], { c: 0, kind: FACE.metal, col: STEEL, top: FACE.metal, occlude: false });
    }
  });
  for (const x of [-61.5, 61.5]) roofPlant(mb, x, 0, 21.55, 2.3, 3, 1.7);
  bakeOcclusion(mb, { reach: 12, ground: 8 });
  return mb.build(1 / M);
}

/**
 * A volume of Nurly Tau as measured in the owner's model, in its metres: [x, z, width, depth, chamfer, sag, turn, from,
 * to, roof]. A block with cut corners whose front (+z) is swept in by `sag` at its middle, turned by `turn` radians
 * round its middle, standing from `from` to `to`; its roof flat (0), a tent up to that height, or a square pyramid
 * [apex, half width, half depth] (the crown of a tower).
 */
type Volume = [number, number, number, number, number, number, number, number, number, number | [number, number, number]];
const NURLY_TAU: Record<"towers" | "slabs" | "blocks" | "links", Volume[]> = {
  // The four towers at the back: a core, a steel collar with its pyramid, a wing on either side, a bay high on the front.
  towers: [
    [91, -116, 30, 34, 3.2, 3.8, .025, 1.1, 96, 0], [91, -116, 25.5, 26.43, 1.56, 1.34, -.046, 95.9, 99, [124.5, 12.97, 13.46]],
    [71.37, -114.99, 13.86, 25.72, 3.28, 1.18, -.125, 1.1, 83, 86.7], [110.55, -114.01, 13.86, 25.72, 3.28, 1.18, -.125, 1.1, 77, 80.7],
    [90.53, -97.2, 17.29, 8.09, 1.11, 1.06, -.051, 89, 94, 98.3],
    [-91, -106, 31, 35, 3.2, 3.8, -.025, 1.1, 104, 0], [-91, -106, 25.5, 26.43, 1.48, 1.34, .046, 103.9, 107, [132.5, 12.97, 13.46]],
    [-70.87, -105, 13.97, 26.44, 1.17, 1.19, .125, 1.1, 85, 88.7], [-111.06, -104, 13.98, 26.44, 1.18, 1.19, .125, 1.1, 91, 94.7],
    [-90.52, -86.7, 17.3, 8.09, 1.11, 1.06, .051, 97, 102, 106.3],
    [72, -38, 31, 35, 3.2, 3.8, -.035, 1.1, 103, 0], [72, -38, 25.49, 26.43, 1.49, 1.35, .036, 102.9, 106, [132, 13.1, 13.58]],
    [92.14, -37.2, 13.95, 26.44, 1.18, 1.18, .114, 1.1, 84, 87.7], [51.96, -35.8, 13.98, 26.44, 1.18, 1.19, .115, 1.1, 90, 93.7],
    [72.68, -18.71, 17.3, 8.08, 1.11, 1.04, .04, 96, 101, 105.3],
    [-72, -28, 31, 35, 3.2, 3.8, .035, 1.1, 99, 0], [-72, -28, 25.49, 26.43, 1.55, 1.35, -.036, 98.9, 102, [129, 13.1, 13.58]],
    [-92.14, -27.2, 13.95, 26.44, 3.37, 1.18, -.114, 1.1, 86, 89.7], [-51.96, -25.8, 13.98, 26.44, 3.41, 1.19, -.115, 1.1, 80, 83.7],
    [-72.68, -8.71, 17.3, 8.08, 1.11, 1.04, -.04, 92, 97, 101.3],
  ],
  // Two slabs with flat roofs either side of the alley.
  slabs: [[35, -75, 27.01, 38.99, 2.29, 5.49, -.025, 1.1, 91, 0], [-35, -65, 27.01, 38.99, 2.3, 5.49, .025, 1.1, 86, 0]],
  // Eight blocks under tall tent roofs of glass, lower towards the front.
  blocks: [
    [-51, 22, 45.01, 45.01, 4, 6.51, -.045, 1.1, 62, 84], [51, 22, 45.01, 45.01, 4, 6.51, .045, 1.1, 65, 87],
    [-48, 69, 48, 43, 4.19, 7.8, .055, 1.1, 43, 64], [48, 69, 48, 43, 4.2, 7.8, -.055, 1.1, 45, 66],
    [-39, 111, 46, 39, 4.2, 7, -.035, 1.1, 31.5, 51.5], [39, 111, 46, 39, 4.2, 7, .035, 1.1, 31.5, 51.5],
    [-87, 113, 47.88, 40.82, 3.63, 6.49, 0, 1.1, 27.2, 46.2], [87, 113, 47.88, 40.82, 4.04, 6.49, 0, 1.1, 27.2, 46.2],
  ],
  // Low links between them.
  links: [
    [-51, -5, 24, 17, 1.4, 1.2, 0, 1.1, 19, 0], [51, -5, 24, 17, 1.4, 1.2, 0, 1.1, 19, 0],
    [-46, 47, 26, 13, 1.4, 1.2, 0, 1.1, 17.5, 0], [46, 47, 26, 13, 1.4, 1.2, 0, 1.1, 17.5, 0],
    [-43, 91, 24, 12, 1.1, 1, 0, 1.1, 14.5, 0], [43, 91, 24, 12, 1.1, 1, 0, 1.1, 14.5, 0],
    [-64, 112, 12, 21, 1.1, 1, 0, 1.1, 16, 0], [64, 112, 12, 21, 1.1, 1, 0, 1.1, 16, 0],
  ],
};

/** A volume's plan: its corners cut by `c`, its front swept in by `sag` in `n` steps, turned and placed. */
function sweptPlan([x, z, w, d, c, sag, turn]: Volume, n = 4): Plan {
  const local: Plan = [[-w / 2 + c, -d / 2], [w / 2 - c, -d / 2], [w / 2, -d / 2 + c], [w / 2, d / 2 - c], [w / 2 - c, d / 2]];
  for (let k = n - 1; k > 0; k--) { const t = -1 + 2 * k / n; local.push([(w / 2 - c) * t, d / 2 - sag * (1 - t * t)]); }
  local.push([-w / 2 + c, d / 2], [-w / 2, d / 2 - c], [-w / 2, -d / 2 + c]);
  const cos = Math.cos(turn), sin = Math.sin(turn);
  return local.map(([u, v]) => [x + u * cos - v * sin, z + u * sin + v * cos]);
}

/**
 * Nurly Tau, the business complex in Almaty (world/officeBuildings.ts officel), after the owner's model of it: drawn in
 * its own metres, the complex centred and its low blocks to the front, every volume where that model has it
 * (NURLY_TAU). Silver-green mirror glass in a thin dark grid over a granite ground floor, glass tents and pyramids in
 * a grid of panes that never lights up at night, steel collars under the towers' pyramids with a red light on each,
 * and the long fountain pool of the alley. Every height is drawn NURLY_TAU_RISE times its metres (the walls' grid in
 * the metres drawn, so the panes keep their size).
 */
function nurlyTau(): THREE.BufferGeometry {
  const model = OFFICE_BUILDINGS.officel, M = NURLY_TAU_WIDTH / model.width, up = (y: number) => y * NURLY_TAU_RISE;
  const GLASS = ["#8dbbc4", "#75a5b1", "#a0cbd1"].map(rgb), ROOF = rgb("#b2d5dd"), GRANITE = rgb("#8b6650"), STEEL = rgb("#4b6d83");
  const mb = new MeshBuilder();
  const all = [...NURLY_TAU.towers, ...NURLY_TAU.slabs, ...NURLY_TAU.blocks, ...NURLY_TAU.links];
  all.forEach((v, i) => {
    const [x, z, , , , , , from, to, top] = v, plan = sweptPlan(v), y0 = up(from), y1 = up(to);
    if (Array.isArray(top)) {
      // A tower's crown: the steel collar, the pyramid on it, the red light on the apex.
      const [peak, hx, hz] = top, apex = up(peak);
      extrude(mb, plan, y0, y1, { kind: FACE.metal, col: STEEL, top: FACE.metal, topCol: rgb("#3a444d") });
      pyramid(mb, { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y: y1, h: apex - y1, roof: ROOF, kind: FACE.spire, win: [1.6, 1.6, 0, 0] });
      box(mb, [x - .5, apex - .4, z - .5, x + .5, apex + .8, z + .5], { c: .1, kind: FACE.light, col: rgb("#ff3a2a"), top: FACE.light, occlude: false });
      return;
    }
    // Granite under the glass, one floor and a half on the tall ones; the bays high on the towers are glass alone.
    const plinth = from < 2 ? y0 + Math.min(7, (y1 - y0) * .3) : y0;
    if (plinth > y0) extrude(mb, plan, y0, plinth, { kind: FACE.wall, col: GRANITE, top: null });
    extrude(mb, plan, plinth, y1, { kind: FACE.mirror, col: GLASS[i % GLASS.length], top: top ? null : FACE.deck, bay: 1.6, floor: 1.8 });
    if (top) tent(mb, plan, y1, up(top), { kind: FACE.spire, col: ROOF, win: [1.6, 1.6, 0, 0] });
    if (from < 2) mb.detail(() => {
      // Entrances follow the bowed front of each real volume, in its own rotated frame.
      const [, , , depth, , sag, turn] = v, front = depth / 2 - sag + .15, bottom = y0 + .12, head = y0 + 4.8;
      mb.turned(x, z, turn, () => {
        mb.quad([[-1.8, bottom, front], [1.8, bottom, front], [1.8, head, front], [-1.8, head, front]], { kind: FACE.glass, col: GLASS[i % GLASS.length] });
        for (const side of [-1, 1]) mb.quad([[side * 1.8 - .08, bottom, front + .01], [side * 1.8 + .08, bottom, front + .01], [side * 1.8 + .08, head, front + .01], [side * 1.8 - .08, head, front + .01]], { kind: FACE.metal, col: ZINC });
        mb.quad([[-1.88, head - .12, front + .01], [1.88, head - .12, front + .01], [1.88, head + .1, front + .01], [-1.88, head + .1, front + .01]], { kind: FACE.metal, col: ZINC });
        mb.quad([[-2.6, head + .18, front + 1.5], [2.6, head + .18, front + 1.5], [2.6, head + .18, front -.1], [-2.6, head + .18, front -.1]], { kind: FACE.metal, col: STEEL, n: [0, 1, 0] });
      });
    });
  });
  roofPlant(mb, 35, -75, up(91) + .05, 3.4, 2.8, 1.5);
  roofPlant(mb, -35, -65, up(86) + .05, 3.4, 2.8, 1.5);
  // The fountain pool down the middle of the alley: a granite kerb and the water.
  box(mb, [-4.6, 0, 58.4, 4.6, .9, 81.6], { c: .2, kind: FACE.trim, col: rgb("#b9b2a2"), top: FACE.trim, occlude: false });
  box(mb, [-4, .9, 59, 4, 1, 81], { kind: FACE.pane, col: rgb("#3d7f88"), noTop: false, occlude: false });
  bakeOcclusion(mb, { reach: 12, ground: 8 });
  return mb.build(1 / M);
}

/** An office tower, in model units: tiers of curtain wall or stone, a glass lobby and canopy at the front, a crown. */
export function officeTowerGeometry(family: OfficeBuilding): THREE.BufferGeometry {
  if (family === "officej") return pyramidTower();
  if (family === "officek") return empireState();
  if (family === "officel") return nurlyTau();
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
    mb.detail(() => {
      box(mb, [x0 + c, height - .08, z1 - .02, x1 - c, height + .12, z1 + .1], { c: 0, kind: FACE.metal, col: ZINC, top: FACE.metal, occlude: false });
      if (skin === "glass") for (const x of [x0 + c + .1, x1 - c - .1]) {
        box(mb, [x - .045, y + .15, z1 - .02, x + .045, height - .12, z1 + .08], { c: 0, kind: FACE.metal, col: ZINC, top: FACE.metal, occlude: false });
        if (inset > .1) box(mb, [x - .045, y + .15, z0 - .08, x + .045, height - .12, z0 + .02], { c: 0, kind: FACE.metal, col: ZINC, top: FACE.metal, occlude: false });
      }
    });
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
  officeEntrance(mb, front);
  const plantX = Math.min(W * .29, (x1 - x0) / 2 - 1.2);
  roofPlant(mb, -plantX, zm - D * .18, y + .03);
  roofPlant(mb, plantX, zm + D * .18, y + .03);
  bakeOcclusion(mb, { reach: 5 });
  return mb.build(1 / k);
}

/** Every ready house (family, finish) by its model's variant (world/familyHouses.ts houseModelName). */
export const READY_HOUSE_VARIANTS = (Object.entries(READY_HOUSES) as [ReadyHouse, ReadyHouseModel][])
  .sort((a, b) => a[1].model - b[1].model).flatMap(([family]) => FINISHES.map(finish => ({ family, finish })));
