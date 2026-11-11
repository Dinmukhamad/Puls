/**
 * The team's community building (world/districtLandmark.ts) as a warm, rounded cartoon miniature: every part of
 * its level drawn in its box with the facade builder (assets/facade.ts) — chamfered stone walls, gable and pyramid
 * roofs with eaves and tiles, curtain walls with mullions, columns, a dome, clocks and spires — and occlusion baked
 * into the vertices. One geometry per level, drawn with the catalogue's facade material: its windows are window cells
 * the material frames, glazes and lights at night, each by its own number (the box's `glow`), so they come on one by
 * one across the front and never flicker. The boxes stay the building's picking and bounds, so the label and the
 * click stand where they did.
 */
import type * as THREE from "three/webgpu";
import { FACE, MeshBuilder, bakeOcclusion, box, cylinder, dome, gableRoof, pyramid, rgb, sphere, torus, type Face, type V3 } from "./facade";
import { landmarkBoxes, type LandmarkBox, type LandmarkFinish } from "../world/districtLandmark";

/** Metres in a unit of the building's frame (LANDMARK_SIDE units across): a storey of 2.3 units is a grand 4.6 m. */
export const LANDMARK_METRES = 2;
const M = LANDMARK_METRES;
const FINISH: Record<LandmarkFinish, { kind: Face; col: V3 }> = {
  stone: { kind: FACE.wall, col: rgb("#ffe1a0") }, white: { kind: FACE.wall, col: rgb("#fff8df") }, trim: { kind: FACE.trim, col: rgb("#efbb56") },
  dark: { kind: FACE.trim, col: rgb("#306b98") }, green: { kind: FACE.leaf, col: rgb("#64bd50") }, accent: { kind: FACE.trim, col: rgb("#9959d9") },
  roof: { kind: FACE.roof, col: rgb("#268fbd") }, gold: { kind: FACE.metal, col: rgb("#ffbd32") }, window: { kind: FACE.window, col: rgb("#fff2d0") },
  wood: { kind: FACE.trim, col: rgb("#d68d45") }, leaf: { kind: FACE.leaf, col: rgb("#55bf56") }, glass: { kind: FACE.curtain, col: rgb("#76d4ed") },
};

/** A window box: a window cell on its outer face (front, or the side it stands out of), its frame, glass and blind drawn by the material. */
function pane(mb: MeshBuilder, b: LandmarkBox, index: number) {
  const col = FINISH.window.col, sideways = b.depth > b.width, w = (sideways ? b.depth : b.width) * M, h = b.height * M;
  // The cell is the pane plus its frame; the material centres the glass at 0.57 of the cell's height.
  const cw = w + .58, ch = h + .58, win: [number, number, number, number] = [cw, ch, w / cw, h / ch];
  const column = Math.floor((b.glow ?? .5) * 97) + index * 3, row = 3 + (index % 4), u0 = column * cw, v0 = row * ch;
  const y = (b.y + b.height / 2) * M - .57 * ch, uv: [number, number][] = [[u0, v0], [u0 + cw, v0], [u0 + cw, v0 + ch], [u0, v0 + ch]];
  if (!sideways) {
    const z = (b.z + b.depth / 2) * M + .01, x0 = b.x * M - cw / 2, x1 = b.x * M + cw / 2;
    mb.quad([[x0, y, z], [x1, y, z], [x1, y + ch, z], [x0, y + ch, z]], { kind: FACE.window, col, win, uv });
    box(mb, [b.x * M - w / 2 - .08, b.y * M - .12, z - .02, b.x * M + w / 2 + .08, b.y * M, z + .14], { c: 0, kind: FACE.trim, col: FINISH.stone.col, occlude: false });
  } else {
    const out = b.x > 0 ? 1 : -1, x = (b.x + out * b.width / 2) * M + out * .01, z0 = b.z * M - cw / 2, z1 = b.z * M + cw / 2;
    mb.quad(out > 0 ? [[x, y, z1], [x, y, z0], [x, y + ch, z0], [x, y + ch, z1]] : [[x, y, z0], [x, y, z1], [x, y + ch, z1], [x, y + ch, z0]], { kind: FACE.window, col, win, uv });
    box(mb, out > 0 ? [x - .02, b.y * M - .12, b.z * M - w / 2 - .08, x + .14, b.y * M, b.z * M + w / 2 + .08] : [x - .14, b.y * M - .12, b.z * M - w / 2 - .08, x + .02, b.y * M, b.z * M + w / 2 + .08], { c: 0, kind: FACE.trim, col: FINISH.stone.col, occlude: false });
  }
}

/** Twelve radial hour marks, drawn as inlaid strips inside the dial rather than more little boxes. */
function clockTicks(mb: MeshBuilder, x: number, y: number, z: number, radius: number) {
  mb.detail(() => {
    for (let k = 0; k < 12; k++) {
      const a = k * Math.PI / 6, c = Math.cos(a), s = Math.sin(a), inner = radius * (k % 3 ? .81 : .73), outer = radius * .9, half = radius * .022;
      const tx = -s * half, ty = c * half;
      mb.quad([[x + c * inner - tx, y + s * inner - ty, z], [x + c * outer - tx, y + s * outer - ty, z],
        [x + c * outer + tx, y + s * outer + ty, z], [x + c * inner + tx, y + s * inner + ty, z]], { kind: FACE.trim, col: FINISH.dark.col });
    }
  });
}

/** A small planted crown with overlapping lobes, bounded by the original tree's ellipsoid. */
function crown(mb: MeshBuilder, b: LandmarkBox) {
  const x = b.x * M, y = (b.y + b.height / 2) * M, z = b.z * M, r = b.width / 2 * M, rise = b.height / 2 * M, sz = b.depth / b.width;
  sphere(mb, { x, y, z, r: r * .8, rise: rise * .96, sz, seg: 8, rings: 3, kind: FACE.leaf, col: FINISH.leaf.col });
  for (const side of [-1, 1]) sphere(mb, { x: x + side * r * .4, y: y + side * rise * .09, z: z - r * .1, r: r * .56, rise: rise * .68, sz, seg: 6, rings: 2, kind: FACE.leaf, col: FINISH.leaf.col });
}

/** One part in its box, in metres. */
function part(mb: MeshBuilder, b: LandmarkBox, index: number) {
  const f = FINISH[b.finish], x0 = (b.x - b.width / 2) * M, x1 = (b.x + b.width / 2) * M, z0 = (b.z - b.depth / 2) * M, z1 = (b.z + b.depth / 2) * M;
  const y0 = b.y * M, y1 = (b.y + b.height) * M, cx = b.x * M, cz = b.z * M, small = Math.min(b.width, b.height, b.depth) < .35;
  const draw = () => {
    switch (b.shape ?? "box") {
      case "box": {
        if (b.finish === "window") { pane(mb, b, index); return; }
        if (b.finish === "glass") {
          // Curtain walls: storeys of 3.2 m from the foot, mullions every 1.4 m.
          box(mb, [x0, y0, z0, x1, y1, z1], { c: .32, kind: FACE.curtain, col: f.col, top: FACE.deck, bay: 1.4, floor: 3.2, v0: -y0 });
          // A grounded sill and a transom give the glass wings a visible metal frame.
          if (b.height > 1.5 && b.width > 1) mb.detail(() => {
            box(mb, [x0 + .04, y0 + .02, z1 - .015, x1 - .04, y0 + .18, z1 + .025], { c: 0, kind: FACE.metal, col: FINISH.dark.col, top: FACE.metal, occlude: false });
            box(mb, [x0 + .04, y1 - .16, z1 - .015, x1 - .04, y1 - .06, z1 + .025], { c: 0, kind: FACE.metal, col: FINISH.trim.col, top: FACE.metal, occlude: false });
          });
          return;
        }
        // Flat roofs and terraces paved in the stone of their walls, like the square.
        const plinth = (b.finish === "stone" || b.finish === "white") && b.width > 2.4 && b.depth > 2 && b.height > 1.5;
        const inset = plinth ? .055 : 0;
        box(mb, [x0 + inset, y0, z0 + inset, x1 - inset, y1, z1 - inset], { c: small ? 0 : Math.min(.42, b.width * M / 6), kind: f.kind, col: f.col, top: f.kind, occlude: !small });
        if (plinth) box(mb, [x0, y0 + .02, z0, x1, y0 + .22, z1], { c: .02, kind: FACE.trim, col: FINISH.trim.col, top: FACE.trim, occlude: false });
        return;
      }
      case "cylinder": {
        if (b.axis === "z") {
          // A disc facing the front: a clock's dial or its rim.
          const r = b.width / 2 * M, t = b.depth * M, cy = (b.y + b.height / 2) * M;
          mb.frame([cx, cy, z0], [1, 0, 0], [0, 0, 1], [0, -1, 0], () => cylinder(mb, { x: 0, z: 0, y0: 0, y1: t, r, seg: 24, kind: f.kind, col: f.col, top: f.kind, occlude: false }));
          if (b.finish === "white") clockTicks(mb, cx, cy, z1 + .003, r);
          if (b.finish === "gold") mb.frame([cx, cy, z1], [1, 0, 0], [0, 0, 1], [0, -1, 0], () => torus(mb, { x: 0, y: 0, z: 0, R: r * .94, r: r * .06, seg: 24, tube: 5, kind: FACE.metal, col: f.col }));
          return;
        }
        const r = b.width / 2 * M, sz = b.depth / b.width;
        cylinder(mb, { x: cx, z: cz, y0, y1, r, r1: b.finish === "white" && b.height > 1.5 ? r * .88 : r, sz, seg: r > 1 ? 24 : 12, kind: f.kind, col: f.col, top: f.kind === FACE.wall ? FACE.trim : f.kind, occlude: r > .6 });
        if (b.finish === "white" && b.height > 1.5) mb.detail(() => {
          // A base and capital stay within the column's former cylinder and read clearly at the entrance.
          cylinder(mb, { x: cx, z: cz, y0: y0 + .01, y1: y0 + .17, r, r1: r * .94, sz, seg: 8, kind: FACE.trim, col: FINISH.trim.col, top: FACE.trim, occlude: false });
          cylinder(mb, { x: cx, z: cz, y0: y1 - .17, y1, r: r * .88, r1: r * .96, sz, seg: 8, kind: FACE.trim, col: FINISH.trim.col, top: FACE.trim, occlude: false });
        });
        return;
      }
      case "cone": cylinder(mb, { x: cx, z: cz, y0, y1, r: b.width / 2 * M, r1: 0, sz: b.depth / b.width, seg: 16, kind: f.kind === FACE.wall ? FACE.roof : f.kind, col: f.col, occlude: false }); return;
      case "dome": dome(mb, { x: cx, z: cz, y0, r: b.width / 2 * M, rise: b.height * M, sz: b.depth / b.width, seg: 28, rings: 7, kind: f.kind === FACE.wall ? FACE.roof : f.kind, col: f.col }); return;
      case "ball": {
        if (b.finish === "leaf") { crown(mb, b); return; }
        const r = b.width / 2 * M; sphere(mb, { x: cx, y: (b.y + b.height / 2) * M, z: cz, r, rise: b.height / 2 * M, sz: b.depth / b.width, seg: r > 1 ? 12 : 8, rings: r > 1 ? 4 : 3, kind: f.kind, col: f.col }); return;
      }
      case "pyramid": pyramid(mb, { x0, x1, z0, z1, y: y0, h: y1 - y0, roof: f.col, kind: f.kind === FACE.roof ? FACE.roof : f.kind }); return;
      case "roof": {
        // A gable with eaves inside its box: the ridge along x or z, the eaves reaching the box's edges.
        const along = b.along === "x" ? "x" : "z", ov = .35, across = along === "x" ? z1 - z0 : x1 - x0, pitch = (y1 - y0) / (across / 2), plate = y0 + ov * pitch;
        const [a0, a1, c0, c1] = along === "x" ? [x0 + ov, x1 - ov, z0 + ov, z1 - ov] : [z0 + ov, z1 - ov, x0 + ov, x1 - ov];
        // The wall plate under the eaves, then the roof from it: eaves at the box's edges, the ridge at its top.
        box(mb, along === "x" ? [a0, y0, c0, a1, plate, c1] : [c0, y0, a0, c1, plate, a1], { c: 0, kind: FACE.wall, col: FINISH.stone.col, noTop: true, occlude: false });
        gableRoof(mb, { a0, a1, b0: c0, b1: c1, y: plate, pitch, overhang: ov, axis: along, roof: f.col, wall: FINISH.stone.col });
        // Metal ridge flashing is contained within the original roof box.
        box(mb, along === "x" ? [x0 + .12, y1 - .1, cz - .09, x1 - .12, y1, cz + .09] : [cx - .09, y1 - .1, z0 + .12, cx + .09, y1, z1 - .12], { c: 0, kind: FACE.metal, col: FINISH.dark.col, top: FACE.metal, occlude: false });
        return;
      }
    }
  };
  if (small) mb.detail(draw); else draw();
}

/** Every architectural part of a level as one facade geometry, in the building's units (the catalogue scales it to its frame). */
export function landmarkGeometry(level: number): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  landmarkBoxes(level).forEach((b, i) => part(mb, b, i));
  bakeOcclusion(mb, { reach: 4.5, ground: 3.5, strength: .62, rays: 16 });
  return mb.build(1 / M);
}
