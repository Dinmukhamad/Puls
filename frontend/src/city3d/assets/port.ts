/**
 * The port's pieces in the city's v4 style (docs/CITY_V4.md, stage 2b), about 6.5 units across so they fit a double
 * lot (world/generate.ts port lots; the catalogue fits them to the lot at one scale): two warehouses with a row of
 * high windows that light at night, loading doors and low roofs, a gantry crane over its rails, and two yards of
 * stacked containers whose ribbed sides the facade material draws. Drawn in metres, handed over in units of 4 m.
 */
import type * as THREE from "three/webgpu";
import { FACE, MeshBuilder, bakeOcclusion, box, gableRoof, rgb, rod, type V3 } from "./facade";

const U = 4, CRANE = rgb("#d9a13b"), DARK = rgb("#3d4148"), STEEL = rgb("#8e959c");
const CONTAINERS = ["#b5432f", "#2f6fa3", "#d38b2c", "#3f8a5a", "#8a8f99", "#c9c3b6"].map(rgb);

/** A shed's walls with a row of high windows, the floors' grid shifted so the row sits under the eaves. */
function shed(mb: MeshBuilder, [x0, z0, x1, z1]: [number, number, number, number], h: number, wall: V3) {
  box(mb, [x0, 0, z0, x1, h, z1], { c: .2, kind: FACE.window, col: wall, top: FACE.deck, bay: 3.2, floor: h, winW: .55, winH: .2, v0: -.23 * h });
}
/** A loading door on the front (z) at x: a ribbed steel shutter in a frame. */
function door(mb: MeshBuilder, x: number, z: number, w: number, h: number, col: V3) {
  box(mb, [x - w / 2 - .2, 0, z - .05, x + w / 2 + .2, h + .25, z + .08], { c: 0, kind: FACE.trim, col: DARK, top: FACE.trim, occlude: false });
  box(mb, [x - w / 2, 0, z + .08, x + w / 2, h, z + .14], { c: 0, kind: FACE.trim, col, top: FACE.trim, occlude: false });
  for (let k = 1; k < 6; k++) box(mb, [x - w / 2, k * h / 6 - .03, z + .14, x + w / 2, k * h / 6 + .03, z + .17], { c: 0, kind: FACE.trim, col: rgb("#565d66"), top: FACE.trim, occlude: false });
}
/** A container `l` long (along x), its sides ribbed (the tile rows of the roof finish, turned upright), its doors at the ends. */
function container(mb: MeshBuilder, x: number, y: number, z: number, l: number, col: V3) {
  const w = 2.44, h = 2.55, x0 = x - l / 2, x1 = x + l / 2, z0 = z - w / 2, z1 = z + w / 2, y1 = y + h;
  // Long sides: v runs along the container, so the rows of the roof finish are its vertical ribs.
  mb.quad([[x0, y, z1], [x1, y, z1], [x1, y1, z1], [x0, y1, z1]], { kind: FACE.roof, col, uv: [[0, 0], [0, l], [h, l], [h, 0]] });
  mb.quad([[x1, y, z0], [x0, y, z0], [x0, y1, z0], [x1, y1, z0]], { kind: FACE.roof, col, uv: [[0, 0], [0, l], [h, l], [h, 0]] });
  mb.quad([[x1, y, z1], [x1, y, z0], [x1, y1, z0], [x1, y1, z1]], { kind: FACE.trim, col: col.map(c => c * .82) as V3 });
  mb.quad([[x0, y, z0], [x0, y, z1], [x0, y1, z1], [x0, y1, z0]], { kind: FACE.trim, col: col.map(c => c * .82) as V3 });
  mb.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], { kind: FACE.trim, col: col.map(c => c * .9) as V3, uv: [[x0, z1], [x1, z1], [x1, z0], [x0, z0]] });
  mb.occlude([x0, y, z0, x1, y1, z1]);
}
/** A yard of stacked containers, one to three high, in seeded colours. */
function containers(mb: MeshBuilder, seed: number) {
  let s = seed * 7919 + 17;
  const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) {
    const height = 1 + Math.floor(random() * 3);
    for (let level = 0; level < height; level++) container(mb, (col * 3.1 - 1.55) * U, level * 2.56, (row * 1.25 - 1.25) * U, 2.6 * U, CONTAINERS[Math.floor(random() * CONTAINERS.length)]);
  }
}

/** The five port pieces: a warehouse, the gantry crane, two container yards, a second shed. */
export const PORT: ((seed: number) => THREE.BufferGeometry)[] = [
  () => {
    const mb = new MeshBuilder(), wall = rgb("#cfc6b6"), x = 6.2 * U / 2, z = 3.8 * U / 2, h = 2.2 * U;
    shed(mb, [-x, -z, x, z], h, wall);
    gableRoof(mb, { a0: -x, a1: x, b0: -z, b1: z, y: h, pitch: .22, overhang: .5, axis: "x", roof: rgb("#8f5f4c"), wall });
    for (const dx of [-2, 0, 2]) door(mb, dx * U, z, 1.3 * U, 1.5 * U, rgb("#6b7380"));
    box(mb, [-x - .3, 0, z, x + .3, .9, z + 2], { c: .05, kind: FACE.wall, col: rgb("#b9b3a6"), top: FACE.trim, topCol: rgb("#a9a396") });
    bakeOcclusion(mb, { rays: 16, reach: 5 });
    return mb.build(1 / U);
  },
  () => {
    // The gantry: four legs on rails, the girders, the long boom over the quay, the trolley, the cab, a hook.
    const mb = new MeshBuilder(), legs: [number, number][] = [[-1.5, -1.2], [1.5, -1.2], [-1.5, 1.2], [1.5, 1.2]], top = 5 * U;
    for (const [x, z] of legs) box(mb, [(x - .13) * U, 0, (z - .13) * U, (x + .13) * U, top, (z + .13) * U], { c: .12, kind: FACE.trim, col: CRANE, top: FACE.trim });
    for (const z of [-1.2, 1.2]) box(mb, [-1.65 * U, 2.25 * U, (z - .15) * U, 1.65 * U, 2.55 * U, (z + .15) * U], { c: .1, kind: FACE.trim, col: CRANE, top: FACE.trim, bottom: true });
    for (const z of [-1.2, 1.2]) for (const s of [-1, 1]) rod(mb, [s * 1.5 * U, .4 * U, z * U], [0, 2.25 * U, z * U], .35, { kind: FACE.trim, col: CRANE });
    box(mb, [-.25 * U, top, -2.8 * U, .25 * U, top + .45 * U, 4.6 * U], { c: .12, kind: FACE.trim, col: CRANE, top: FACE.trim, bottom: true });
    for (const z of [-1.2, 1.2]) box(mb, [-1.7 * U, top, (z - .25) * U, 1.7 * U, top + .45 * U, (z + .25) * U], { c: .1, kind: FACE.trim, col: CRANE, top: FACE.trim, bottom: true });
    box(mb, [-.45 * U, top - .7 * U, 1.75 * U, .45 * U, top, 2.65 * U], { c: .1, kind: FACE.window, col: rgb("#e8e3d8"), top: FACE.trim, bay: 1.8, floor: 2.8, winW: .7, winH: .5, bottom: true });
    rod(mb, [0, top, 3.6 * U], [0, top - 1.8 * U, 3.6 * U], .12, { kind: FACE.trim, col: DARK });
    box(mb, [-.35, top - 1.8 * U - .5, 3.6 * U - .35, .35, top - 1.8 * U, 3.6 * U + .35], { c: .05, kind: FACE.trim, col: DARK, top: FACE.trim, bottom: true });
    for (const z of [-1.2, 1.2]) box(mb, [-2.2 * U, 0, (z - .06) * U, 2.2 * U, .12, (z + .06) * U], { c: 0, kind: FACE.metal, col: STEEL, top: FACE.metal, occlude: false });
    bakeOcclusion(mb, { rays: 16, reach: 5 });
    return mb.build(1 / U);
  },
  seed => { const mb = new MeshBuilder(); containers(mb, seed); bakeOcclusion(mb, { rays: 16, reach: 4 }); return mb.build(1 / U); },
  seed => { const mb = new MeshBuilder(); containers(mb, seed); bakeOcclusion(mb, { rays: 16, reach: 4 }); return mb.build(1 / U); },
  () => {
    const mb = new MeshBuilder(), wall = rgb("#b9c2c9"), x = 6.4 * U / 2, z0 = (-.4 - 1.5) * U, z1 = (-.4 + 1.5) * U, h = 2.8 * U;
    shed(mb, [-x, z0, x, z1], h, wall);
    gableRoof(mb, { a0: -x, a1: x, b0: z0, b1: z1, y: h, pitch: .18, overhang: .5, axis: "x", roof: rgb("#6f7d88"), wall });
    for (const dx of [-1.8, 1.8]) door(mb, dx * U, z1, 1.6 * U, 1.8 * U, rgb("#5a626d"));
    bakeOcclusion(mb, { rays: 16, reach: 5 });
    return mb.build(1 / U);
  },
];
