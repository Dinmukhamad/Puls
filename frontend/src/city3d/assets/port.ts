/**
 * The port's cheerful cartoon pieces, about 6.5 units across so they fit a double
 * lot (world/generate.ts port lots; the catalogue fits them to the lot at one scale): two warehouses with a row of
 * high windows that light at night, loading doors and low roofs, a gantry crane over its rails, and two yards of
 * stacked containers whose ribbed sides the facade material draws. Drawn in metres, handed over in units of 4 m.
 */
import type * as THREE from "three/webgpu";
import { FACE, MeshBuilder, bakeOcclusion, box, cylinder, gableRoof, rgb, rod, type V3 } from "./facade";

const U = 4, CRANE = rgb("#ffc535"), DARK = rgb("#355a76"), STEEL = rgb("#a5d6e4");
const CONTAINERS = ["#ef674c", "#309eda", "#ffc445", "#4abb7b", "#869fdf", "#ffe3a8"].map(rgb);

/** A shed's walls with a row of high windows, the floors' grid shifted so the row sits under the eaves. */
function shed(mb: MeshBuilder, [x0, z0, x1, z1]: [number, number, number, number], h: number, wall: V3) {
  box(mb, [x0, 0, z0, x1, h, z1], { c: .48, kind: FACE.window, col: wall, top: FACE.deck, bay: 3.2, floor: h, winW: .55, winH: .2, v0: -.23 * h });
}
/** A loading door on the front (z) at x: a ribbed steel shutter in a frame. */
function door(mb: MeshBuilder, x: number, z: number, w: number, h: number, col: V3) {
  box(mb, [x - w / 2 - .2, 0, z - .05, x + w / 2 + .2, h + .25, z + .08], { c: 0, kind: FACE.trim, col: DARK, top: FACE.trim, occlude: false });
  box(mb, [x - w / 2, 0, z + .08, x + w / 2, h, z + .14], { c: 0, kind: FACE.trim, col, top: FACE.trim, occlude: false });
  for (let k = 1; k < 4; k++) box(mb, [x - w / 2, k * h / 4 - .045, z + .14, x + w / 2, k * h / 4 + .045, z + .17], { c: 0, kind: FACE.trim, col: rgb("#6e9ab5"), top: FACE.trim, occlude: false });
  // The shutter has a bottom weather rail and two rubber loading buffers beside it.
  box(mb, [x - w / 2, .06, z + .14, x + w / 2, .16, z + .21], { c: 0, kind: FACE.metal, col: STEEL, top: FACE.metal, occlude: false });
  for (const side of [-1, 1]) box(mb, [x + side * (w / 2 + .1) - .07, .2, z + .08, x + side * (w / 2 + .1) + .07, .75, z + .3], { c: 0, kind: FACE.trim, col: DARK, top: FACE.trim, occlude: false });
}
/** Flush rooflights follow the pitch exactly; their two raised rails catch the light without a new draw call. */
function rooflights(mb: MeshBuilder, x: number, z0: number, z1: number, h: number, pitch: number) {
  const middle = (z0 + z1) / 2, depth = (z1 - z0) / 2;
  for (const px of [-x * .38, x * .38]) for (const side of [-1, 1]) {
    const a = middle + side * depth * .3, b = middle + side * depth * .58;
    const low = Math.min(a, b), high = Math.max(a, b), y = (z: number) => h + (depth - Math.abs(z - middle)) * pitch + .025;
    mb.quad([[px - 1.2, y(low), low], [px - 1.2, y(high), high], [px + 1.2, y(high), high], [px + 1.2, y(low), low]], { kind: FACE.pane, col: rgb("#5dbddd"), win: [.25, 0, 0, 0] });
    // Unchamfered small rails stay within the roof's old maximum height and plan.
    for (const sx of [-1, 1]) {
      const left = px + sx * 1.2;
      mb.quad([[left - .035, y(low) + .025, low], [left - .035, y(high) + .025, high], [left + .035, y(high) + .025, high], [left + .035, y(low) + .025, low]], { kind: FACE.metal, col: STEEL });
    }
  }
}
/** A container `l` long (along x), its sides ribbed (the tile rows of the roof finish, turned upright), its doors at the ends. */
function container(mb: MeshBuilder, x: number, y: number, z: number, l: number, col: V3) {
  const w = 2.44, h = 2.55, x0 = x - l / 2, x1 = x + l / 2, z0 = z - w / 2, z1 = z + w / 2, y1 = y + h;
  const inset = .035, end0 = x0 + inset, end1 = x1 - inset, side0 = z0 + inset, side1 = z1 - inset;
  // Long sides: v runs along the container, so the rows of the roof finish are its vertical ribs.
  mb.quad([[end0, y, side1], [end1, y, side1], [end1, y1 - inset, side1], [end0, y1 - inset, side1]], { kind: FACE.roof, col, uv: [[0, 0], [0, l], [h, l], [h, 0]] });
  mb.quad([[end1, y, side0], [end0, y, side0], [end0, y1 - inset, side0], [end1, y1 - inset, side0]], { kind: FACE.roof, col, uv: [[0, 0], [0, l], [h, l], [h, 0]] });
  const endColor = col.map(c => c * .9) as V3;
  mb.quad([[end1, y, side1], [end1, y, side0], [end1, y1 - inset, side0], [end1, y1 - inset, side1]], { kind: FACE.trim, col: endColor });
  mb.quad([[end0, y, side0], [end0, y, side1], [end0, y1 - inset, side1], [end0, y1 - inset, side0]], { kind: FACE.trim, col: endColor });
  mb.quad([[end0, y1 - inset, side1], [end1, y1 - inset, side1], [end1, y1 - inset, side0], [end0, y1 - inset, side0]], { kind: FACE.metal, col: col.map(c => c * .96) as V3, uv: [[x0, z1], [x1, z1], [x1, z0], [x0, z0]] });
  // Actual corner castings/rails keep the exact original stacking envelope. Locking bars are on the
  // recessed door face, so they do not push a yard beyond the catalogue's measured footprint.
  for (const xx of [x0, x1 - .07]) for (const zz of [z0, z1 - .07]) box(mb, [xx, y, zz, xx + .07, y1, zz + .07], { c: 0, kind: FACE.metal, col, top: FACE.metal, occlude: false });
  for (const zz of [z - .55, z + .55]) box(mb, [end1, y + .18, zz - .025, x1 - .008, y1 - .18, zz + .025], { c: 0, kind: FACE.metal, col: STEEL, top: FACE.metal, occlude: false });
  mb.quad([[x1 - .005, y + .05, z + .012], [x1 - .005, y + .05, z - .012], [x1 - .005, y1 - .05, z - .012], [x1 - .005, y1 - .05, z + .012]], { kind: FACE.trim, col: DARK });
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
    const mb = new MeshBuilder(), wall = rgb("#ffe0a1"), x = 6.2 * U / 2, z = 3.8 * U / 2, h = 2.2 * U;
    shed(mb, [-x, -z, x, z], h, wall);
    gableRoof(mb, { a0: -x, a1: x, b0: -z, b1: z, y: h, pitch: .22, overhang: .5, axis: "x", roof: rgb("#e96d4d"), wall });
    rooflights(mb, x, -z, z, h, .22);
    for (const dx of [-2, 0, 2]) door(mb, dx * U, z, 1.3 * U, 1.5 * U, rgb("#72a8c6"));
    box(mb, [-x - .3, 0, z, x + .3, .9, z + 2], { c: .05, kind: FACE.wall, col: rgb("#d3be94"), top: FACE.trim, topCol: rgb("#edcf9c") });
    bakeOcclusion(mb, { strength: .62, rays: 16, reach: 5 });
    return mb.build(1 / U);
  },
  () => {
    // The gantry: four legs on rails, the girders, the long boom over the quay, the trolley, the cab, a hook.
    const mb = new MeshBuilder(), legs: [number, number][] = [[-1.5, -1.2], [1.5, -1.2], [-1.5, 1.2], [1.5, 1.2]], top = 5 * U;
    for (const [x, z] of legs) box(mb, [(x - .13) * U, 0, (z - .13) * U, (x + .13) * U, top, (z + .13) * U], { c: .28, kind: FACE.trim, col: CRANE, top: FACE.trim });
    for (const z of [-1.2, 1.2]) box(mb, [-1.65 * U, 2.25 * U, (z - .15) * U, 1.65 * U, 2.55 * U, (z + .15) * U], { c: .25, kind: FACE.trim, col: CRANE, top: FACE.trim, bottom: true });
    for (const z of [-1.2, 1.2]) for (const s of [-1, 1]) rod(mb, [s * 1.5 * U, .4 * U, z * U], [0, 2.25 * U, z * U], .35, { kind: FACE.trim, col: CRANE });
    box(mb, [-.25 * U, top, -2.8 * U, .25 * U, top + .45 * U, 4.6 * U], { c: .28, kind: FACE.trim, col: CRANE, top: FACE.trim, bottom: true });
    for (const z of [-1.2, 1.2]) box(mb, [-1.7 * U, top, (z - .25) * U, 1.7 * U, top + .45 * U, (z + .25) * U], { c: .25, kind: FACE.trim, col: CRANE, top: FACE.trim, bottom: true });
    box(mb, [-.45 * U, top - .7 * U, 1.75 * U, .45 * U, top, 2.65 * U], { c: .1, kind: FACE.window, col: rgb("#fff4d6"), top: FACE.trim, bay: 1.8, floor: 2.8, winW: .7, winH: .5, bottom: true });
    rod(mb, [0, top, 3.6 * U], [0, top - 1.8 * U, 3.6 * U], .12, { kind: FACE.trim, col: DARK });
    box(mb, [-.35, top - 1.8 * U - .5, 3.6 * U - .35, .35, top - 1.8 * U, 3.6 * U + .35], { c: .05, kind: FACE.trim, col: DARK, top: FACE.trim, bottom: true });
    for (const z of [-1.2, 1.2]) box(mb, [-2.2 * U, 0, (z - .06) * U, 2.2 * U, .12, (z + .06) * U], { c: 0, kind: FACE.metal, col: STEEL, top: FACE.metal, occlude: false });
    // Four low bogies and their steel wheels visibly carry the gantry on its rails.
    mb.detail(() => {
      for (const [x, z] of legs) {
        box(mb, [x * U - .9, .2, z * U - .38, x * U + .9, .85, z * U + .38], { c: 0, kind: FACE.metal, col: DARK, top: FACE.metal, occlude: false });
        for (const dx of [-.48, .48]) mb.frame([x * U + dx, .48, z * U - .42], [1, 0, 0], [0, 0, 1], [0, -1, 0], () => cylinder(mb, { x: 0, z: 0, y0: 0, y1: .84, r: .45, seg: 8, kind: FACE.metal, col: STEEL, top: FACE.metal, bottom: true, occlude: false }));
      }
    });
    bakeOcclusion(mb, { strength: .62, rays: 16, reach: 5 });
    return mb.build(1 / U);
  },
  seed => { const mb = new MeshBuilder(); containers(mb, seed); bakeOcclusion(mb, { strength: .62, rays: 16, reach: 4 }); return mb.build(1 / U); },
  seed => { const mb = new MeshBuilder(); containers(mb, seed); bakeOcclusion(mb, { strength: .62, rays: 16, reach: 4 }); return mb.build(1 / U); },
  () => {
    const mb = new MeshBuilder(), wall = rgb("#b8e6f1"), x = 6.4 * U / 2, z0 = (-.4 - 1.5) * U, z1 = (-.4 + 1.5) * U, h = 2.8 * U;
    shed(mb, [-x, z0, x, z1], h, wall);
    gableRoof(mb, { a0: -x, a1: x, b0: z0, b1: z1, y: h, pitch: .18, overhang: .5, axis: "x", roof: rgb("#368fb6"), wall });
    rooflights(mb, x, z0, z1, h, .18);
    for (const dx of [-1.8, 1.8]) door(mb, dx * U, z1, 1.6 * U, 1.8 * U, rgb("#6da4bc"));
    bakeOcclusion(mb, { strength: .62, rays: 16, reach: 5 });
    return mb.build(1 / U);
  },
];
