/**
 * The team's community building (world/districtLandmark.ts) in the city's v4 style (docs/CITY_V4.md): every part of
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
  stone: { kind: FACE.wall, col: rgb("#e8e1d3") }, white: { kind: FACE.wall, col: rgb("#f1ede5") }, trim: { kind: FACE.trim, col: rgb("#d3c5a8") },
  dark: { kind: FACE.trim, col: rgb("#33454c") }, green: { kind: FACE.leaf, col: rgb("#6f8f62") }, accent: { kind: FACE.trim, col: rgb("#6b55c8") },
  roof: { kind: FACE.roof, col: rgb("#3f6670") }, gold: { kind: FACE.metal, col: rgb("#cf9b4a") }, window: { kind: FACE.window, col: rgb("#ece6da") },
  wood: { kind: FACE.trim, col: rgb("#8d6744") }, leaf: { kind: FACE.leaf, col: rgb("#668f5e") }, glass: { kind: FACE.curtain, col: rgb("#a4c6d6") },
};

/** A window box: a window cell on its outer face (front, or the side it stands out of), its frame, glass and blind drawn by the material. */
function pane(mb: MeshBuilder, b: LandmarkBox, index: number) {
  const col = FINISH.window.col, sideways = b.depth > b.width, w = (sideways ? b.depth : b.width) * M, h = b.height * M;
  // The cell is the pane plus its frame; the material centres the glass at 0.57 of the cell's height.
  const cw = w + .5, ch = h + .5, win: [number, number, number, number] = [cw, ch, w / cw, h / ch];
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
          box(mb, [x0, y0, z0, x1, y1, z1], { c: .12, kind: FACE.curtain, col: f.col, top: FACE.deck, bay: 1.4, floor: 3.2, v0: -y0 });
          return;
        }
        // Flat roofs and terraces paved in the stone of their walls, like the square.
        box(mb, [x0, y0, z0, x1, y1, z1], { c: small ? 0 : Math.min(.14, b.width * M / 8), kind: f.kind, col: f.col, top: f.kind, occlude: !small });
        return;
      }
      case "cylinder": {
        if (b.axis === "z") {
          // A disc facing the front: a clock's dial or its rim.
          const r = b.width / 2 * M, t = b.depth * M, cy = (b.y + b.height / 2) * M;
          mb.frame([cx, cy, z0], [1, 0, 0], [0, 0, 1], [0, -1, 0], () => cylinder(mb, { x: 0, z: 0, y0: 0, y1: t, r, seg: 24, kind: f.kind, col: f.col, top: f.kind, occlude: false }));
          if (b.finish === "gold") mb.frame([cx, cy, z1], [1, 0, 0], [0, 0, 1], [0, -1, 0], () => torus(mb, { x: 0, y: 0, z: 0, R: r * .94, r: r * .06, seg: 24, tube: 5, kind: FACE.metal, col: f.col }));
          return;
        }
        const r = b.width / 2 * M, sz = b.depth / b.width;
        cylinder(mb, { x: cx, z: cz, y0, y1, r, r1: b.finish === "white" && b.height > 1.5 ? r * .88 : r, sz, seg: r > 1 ? 24 : 12, kind: f.kind, col: f.col, top: f.kind === FACE.wall ? FACE.trim : f.kind, occlude: r > .6 });
        return;
      }
      case "cone": cylinder(mb, { x: cx, z: cz, y0, y1, r: b.width / 2 * M, r1: 0, sz: b.depth / b.width, seg: 16, kind: f.kind === FACE.wall ? FACE.roof : f.kind, col: f.col, occlude: false }); return;
      case "dome": dome(mb, { x: cx, z: cz, y0, r: b.width / 2 * M, rise: b.height * M, sz: b.depth / b.width, seg: 28, rings: 7, kind: f.kind === FACE.wall ? FACE.roof : f.kind, col: f.col }); return;
      case "ball": { const r = b.width / 2 * M; sphere(mb, { x: cx, y: (b.y + b.height / 2) * M, z: cz, r, rise: b.height / 2 * M, sz: b.depth / b.width, seg: r > 1 ? 12 : 8, rings: r > 1 ? 4 : 3, kind: f.kind, col: f.col }); return; }
      case "pyramid": pyramid(mb, { x0, x1, z0, z1, y: y0, h: y1 - y0, roof: f.col, kind: f.kind === FACE.roof ? FACE.roof : f.kind }); return;
      case "roof": {
        // A gable with eaves inside its box: the ridge along x or z, the eaves reaching the box's edges.
        const along = b.along === "x" ? "x" : "z", ov = .35, across = along === "x" ? z1 - z0 : x1 - x0, pitch = (y1 - y0) / (across / 2), plate = y0 + ov * pitch;
        const [a0, a1, c0, c1] = along === "x" ? [x0 + ov, x1 - ov, z0 + ov, z1 - ov] : [z0 + ov, z1 - ov, x0 + ov, x1 - ov];
        // The wall plate under the eaves, then the roof from it: eaves at the box's edges, the ridge at its top.
        box(mb, along === "x" ? [a0, y0, c0, a1, plate, c1] : [c0, y0, a0, c1, plate, a1], { c: 0, kind: FACE.wall, col: FINISH.stone.col, noTop: true, occlude: false });
        gableRoof(mb, { a0, a1, b0: c0, b1: c1, y: plate, pitch, overhang: ov, axis: along, roof: f.col, wall: FINISH.stone.col });
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
  bakeOcclusion(mb, { reach: 4.5, ground: 3.5, strength: .9, rays: 16 });
  return mb.build(1 / M);
}
