/**
 * The stretched buildings of the city in its v4 style (docs/CITY_V4.md, stage 2b): residential sections, the floors
 * over an arch, cottages and their garages, gabled roofs, office towers and the plain blocks of the first city. Each
 * is a unit model (assets/facade.ts MeshBuilder.build({ unit })): drawn at a nominal size in metres, handed over in
 * the unit box (x and z in ±0.5, y 0…1), and stretched by every copy to its width, depth and height, as the layouts
 * place it (world/complexes.ts, world/landLayouts.ts, world/generate.ts). The facade material measures the walls on
 * the copy, so windows keep their size, floors line up along a wing and every wall takes a whole number of bays;
 * the plinth, the cornice band and the doors are drawn by it too, so a stretched copy keeps them in proportion.
 */
import type * as THREE from "three/webgpu";
import { FACE, MeshBuilder, bakeOcclusion, box, gableRoof, parapet, rgb, rod, type V3 } from "./facade";

const WHITE: V3 = [1, 1, 1], TRIM = rgb("#efede7"), DARK = rgb("#3a4047"), CONCRETE = rgb("#c9c6bf"), RAIL = rgb("#a9b6bf");
/** A floor of the residential sections and cottages (world/complexes.ts FLOOR, 0.75 units), in metres. */
const FLOOR = 3;
/** A floor of the office towers (OFFICE_FLOOR, 0.9 units). */
const OFFICE = 3.6;

/**
 * A residential section of `floors` (world/complexes.ts SECTION_FLOORS), nominally 12.8 × 9.6 m: three bays a floor,
 * entrances under canopies in the middle of both long fronts, a balcony on every upper floor of both fronts behind a
 * glass balustrade (planters on the green-shaded ones), a parapet, and the stair and lift house on the roof. Walls
 * take the copy's shade.
 */
export function sectionGeometry(floors: number): THREE.BufferGeometry {
  const W = 12.8, D = 9.6, H = floors * FLOOR, mb = new MeshBuilder(), x = W / 2, z = D / 2;
  box(mb, [-x, 0, -z, x, H, z], { c: .15, kind: FACE.window, col: WHITE, top: FACE.deck, bay: W / 3, floor: FLOOR, winW: .5, winH: .52, door: ["+z", "-z"] });
  for (const side of [-1, 1]) {
    const front = side * z, out = side * (z + .62);
    // The canopy over the entrance.
    box(mb, side > 0 ? [-1.6, 2.72, front, 1.6, 2.9, front + 1.1] : [-1.6, 2.72, front - 1.1, 1.6, 2.9, front], { c: 0, kind: FACE.trim, col: TRIM, top: FACE.trim, bottom: true, occlude: false });
    for (let k = 1; k < floors; k++) {
      const y = k * FLOOR;
      mb.detail(() => {
        box(mb, side > 0 ? [-5.7, y - .14, front, 5.7, y + .02, out] : [-5.7, y - .14, out, 5.7, y + .02, front], { c: 0, kind: FACE.trim, col: TRIM, top: FACE.trim, bottom: true, occlude: false });
        // A glass balustrade; the green-shaded towers have planters there instead (the facade material, unit models).
        box(mb, side > 0 ? [-5.7, y + .02, out - .05, 5.7, y + 1.02, out] : [-5.7, y + .02, out, 5.7, y + 1.02, out + .05], { c: 0, kind: FACE.glass, col: RAIL, top: FACE.trim, topCol: TRIM, occlude: false });
      });
    }
  }
  parapet(mb, -x, -z, x, z, H, .45, .25, WHITE);
  box(mb, [1.2, H, -2, 4.4, H + 2.4, 2], { c: .08, kind: FACE.wall, col: WHITE, top: FACE.deck });
  bakeOcclusion(mb, { rays: 16 });
  return mb.build({ unit: [W, H, D] });
}

/** The floors over an arch: the section's walls and parapet, closed underneath (the arch's ceiling), nominally two floors. */
export function archGeometry(): THREE.BufferGeometry {
  const W = 12.8, D = 9.6, H = 2 * FLOOR, mb = new MeshBuilder(), x = W / 2, z = D / 2;
  box(mb, [-x, 0, -z, x, H, z], { c: .15, kind: FACE.window, col: WHITE, top: FACE.deck, bay: W / 3, floor: FLOOR, winW: .5, winH: .52, bottom: true });
  parapet(mb, -x, -z, x, z, H, .45, .25, WHITE);
  bakeOcclusion(mb, { rays: 16, ground: 0 });
  return mb.build({ unit: [W, H, D] });
}

/**
 * A cottage, nominally 12 × 9.6 m and one floor high (copies are as high as their floors: the windows and the door
 * stay their size, drawn on the copy): windows all round, the door in the middle of its front, a plinth. Its roof
 * is a copy of its own (roofGeometry).
 */
export function cottageGeometry(): THREE.BufferGeometry {
  const W = 12, D = 9.6, H = FLOOR, mb = new MeshBuilder(), x = W / 2, z = D / 2;
  box(mb, [-x, 0, -z, x, H, z], { c: .14, kind: FACE.window, col: WHITE, top: FACE.trim, topCol: TRIM, bay: 3.3, floor: FLOOR, winW: .42, winH: .5, door: ["+z"] });
  bakeOcclusion(mb, { rays: 16 });
  return mb.build({ unit: [W, H, D] });
}

/** A garage beside a house (a one-floor cottage in the garage's graphite, world/landLayouts.ts): its up-and-over door to the front, plain walls. */
export function garageGeometry(): THREE.BufferGeometry {
  const W = 7.6, D = 9.6, H = FLOOR, mb = new MeshBuilder(), x = W / 2, z = D / 2;
  box(mb, [-x, 0, -z, x, H, z], { c: .12, kind: FACE.wall, col: WHITE, top: FACE.trim, topCol: TRIM });
  mb.detail(() => {
    box(mb, [-2.7, 0, z - .02, 2.7, 2.45, z + .06], { c: 0, kind: FACE.trim, col: rgb("#e2e0da"), top: FACE.trim, occlude: false });
    for (let k = 1; k < 5; k++) box(mb, [-2.6, k * .49 - .02, z + .06, 2.6, k * .49 + .02, z + .09], { c: 0, kind: FACE.trim, col: rgb("#b9b8b2"), top: FACE.trim, occlude: false });
    box(mb, [-2.85, 2.45, z - .02, 2.85, 2.6, z + .12], { c: 0, kind: FACE.trim, col: TRIM, top: FACE.trim, occlude: false });
  });
  bakeOcclusion(mb, { rays: 16 });
  return mb.build({ unit: [W, H, D] });
}

/**
 * A gabled roof in unit space: x ±0.5 to the eaves, z ±0.5 (the ridge along z, the gables to ±z), y 0…1 to the ridge.
 * Tiled slopes in the copy's shade, eaves 0.6 m out over the walls with soffits, rendered gables, white barge boards
 * and a dark ridge. Nominally 13.2 × 10.8 m and 4 m high.
 */
export function roofGeometry(): THREE.BufferGeometry {
  const W = 13.2, D = 10.8, H = 4, ov = .6, mb = new MeshBuilder();
  gableRoof(mb, { a0: -D / 2 + ov, a1: D / 2 - ov, b0: -W / 2 + ov, b1: W / 2 - ov, y: H * ov / (W / 2), pitch: H / (W / 2), overhang: ov, axis: "z", roof: WHITE, wall: rgb("#ece6d9"), soffit: rgb("#e6e1d6") });
  // The gables under the eaves line, down to the roof's foot (the house's walls end at y = 0).
  for (const side of [-1, 1]) {
    const zz = side * (D / 2 - ov), y = H * ov / (W / 2), xx = W / 2 - ov;
    mb.quad(side > 0 ? [[-xx, 0, zz], [xx, 0, zz], [xx, y, zz], [-xx, y, zz]] : [[xx, 0, zz], [-xx, 0, zz], [-xx, y, zz], [xx, y, zz]], { kind: FACE.trim, col: rgb("#ece6d9") });
  }
  mb.detail(() => {
    for (const side of [-1, 1]) for (const end of [-1, 1]) rod(mb, [side * W / 2, -.02, end * D / 2], [0, H + .02, end * D / 2], .16, { kind: FACE.trim, col: TRIM });
    box(mb, [-.14, H - .12, -D / 2, .14, H + .08, D / 2], { c: 0, kind: FACE.trim, col: DARK, top: FACE.trim, occlude: false });
  });
  // Gables and soffits keep their own colours: the copy's shade is the roof's (facade material, unit models).
  for (let v = 0; v < mb.count; v++) if (mb.s[v * 4 + 2] === FACE.wall) mb.s[v * 4 + 2] = FACE.trim;
  bakeOcclusion(mb, { rays: 16, ground: 0, reach: 2 });
  return mb.build({ unit: [W, H, D] });
}

/**
 * An office tower (or a podium) of `floors` (world/complexes.ts OFFICE_FLOORS), nominally 36 × 28 m: curtain walls in
 * the copy's glass shade, slim fins up the corners, a light band under the parapet of the taller ones, a canopy over
 * the lobby on both long fronts, plant on the roof.
 */
export function officeGeometry(floors: number): THREE.BufferGeometry {
  const W = 36, D = 28, H = floors * OFFICE, mb = new MeshBuilder(), x = W / 2, z = D / 2;
  box(mb, [-x, 0, -z, x, H, z], { c: .35, kind: FACE.curtain, col: WHITE, top: FACE.deck, bay: 1.5, floor: OFFICE });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(mb, [sx * x - .45, 0, sz * z - .45, sx * x + .45, H + .3, sz * z + .45], { c: .08, kind: FACE.trim, col: TRIM, top: FACE.trim });
  if (floors > 4) for (const side of [-1, 1]) box(mb, side > 0 ? [-x, H - 3.2, z - .1, x, H - 2.4, z + .25] : [-x, H - 3.2, -z - .25, x, H - 2.4, -z + .1], { c: 0, kind: FACE.trim, col: TRIM, top: FACE.trim, occlude: false });
  for (const side of [-1, 1]) box(mb, side > 0 ? [-6, 3.4, z, 6, 3.7, z + 4] : [-6, 3.4, -z - 4, 6, 3.7, -z], { c: 0, kind: FACE.trim, col: DARK, top: FACE.trim, bottom: true, occlude: false });
  parapet(mb, -x, -z, x, z, H, .9, .45, TRIM);
  box(mb, [-12, H, -6, 2, H + 3.6, 6], { c: .1, kind: FACE.wall, col: CONCRETE, top: FACE.deck });
  box(mb, [6, H, -9, 13, H + 2.6, -2], { c: .1, kind: FACE.wall, col: CONCRETE, top: FACE.deck });
  // Plant and walls take no glass shade.
  for (let v = 0; v < mb.count; v++) if (mb.s[v * 4 + 2] === FACE.wall) mb.s[v * 4 + 2] = FACE.trim;
  bakeOcclusion(mb, { rays: 16, reach: 5 });
  return mb.build({ unit: [W, H, D] });
}

/**
 * The first city's plain blocks (the five-island map, and the fallback for a missing kit model): `floors` of 3 m in
 * a unit box, walls with windows and a door, or (`glass`) curtain walls; a parapet and roof plant.
 */
export function blockGeometry(floors: number, glass: boolean): THREE.BufferGeometry {
  const W = 12, D = 12, H = floors * FLOOR, mb = new MeshBuilder(), x = W / 2, z = D / 2;
  if (glass) box(mb, [-x, 0, -z, x, H, z], { c: .2, kind: FACE.curtain, col: WHITE, top: FACE.deck, bay: 1.5, floor: FLOOR });
  else box(mb, [-x, 0, -z, x, H, z], { c: .15, kind: FACE.window, col: WHITE, top: FACE.deck, bay: 3, floor: FLOOR, winW: .48, winH: .5, door: ["+z"] });
  parapet(mb, -x, -z, x, z, H, .5, .3, glass ? TRIM : WHITE);
  box(mb, [-3, H, -2, 1.5, H + 2.2, 2.5], { c: .08, kind: FACE.trim, col: CONCRETE, top: FACE.deck });
  bakeOcclusion(mb, { rays: 16 });
  return mb.build({ unit: [W, H, D] });
}
