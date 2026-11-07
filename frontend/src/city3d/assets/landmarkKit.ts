/**
 * The landmark kit (docs/CITY_V4.md, stage 2b): the parts the district landmarks on the islands are drawn with
 * (assets/landmarkModels.ts), in the city's v4 style. Every part goes into one facade mesh per building
 * (assets/facade.ts): chamfered walls, windows with frames and sills drawn by the material, gable roofs with eaves,
 * domes, columns, clocks, dishes, masts and trees, occlusion baked into the vertices. Only the signs are separate,
 * canvas textures on boards.
 *
 * Dimensions are in kit units, district-local, the front to +z, as the models were always drawn: the island plinth
 * is 5.7 × 5.3 units and a storey about one unit. The mesh is built in metres (KIT_METRES to a unit), so the
 * windows, tiles and sills the material draws have real sizes, and handed over in kit units.
 */
import * as THREE from "three/webgpu";
import { FACE, MeshBuilder, arch as archShape, box as boxShape, cylinder, dome as domeShape, gableRoof, prism as prismShape, pyramid as pyramidShape, rgb, rod as rodShape, sphere, torus as torusShape, type BoxOptions, type Face, type V3 } from "./facade";

export const C = {
  stone: '#e6dcc6', ivory: '#f3ead9', trim: '#c4af89', ink: '#2b3b44', glass: '#5d8794', gold: '#cf9b4a', roof: '#3d5f68', leaf: '#5f8a5c', wood: '#8d6744',
  steel: '#a3abb0', concrete: '#cdc6b8', red: '#cf5248', taxi: '#e5b746', slate: '#4b5d66', lawn: '#7ea865', white: '#efece4',
};
/** The top of the island plinth every landmark stands on (5.7 × 5.3, front steps out to z = 3). */
export const PLINTH = .275;
/** Metres in a kit unit. */
export const KIT_METRES = 3;
const M = KIT_METRES;
const BULB = '#fff0c0';

/** The side of a building a row of windows is on: its front looks to +z. */
export type Side = 'front' | 'back' | 'left' | 'right';
/** Windows in a wall: bay and floor in kit units, the window's width and height as shares of them. */
export interface Grid { bay: number; floor: number; w?: number; h?: number; even?: boolean }
export interface BlockOptions {
  /** Chamfer in kit units; by default a small one on big volumes and none on small parts. */
  r?: number;
  /** Windows in its walls, or a curtain wall when its finish is glass. */
  win?: Grid;
  /** A ribbon of glass: one band of panes with no spandrel. */
  ribbon?: boolean;
  /** Its top: a finish colour, "deck" (gravel), or "none". */
  top?: string;
  faces?: ('+z' | '-z' | '+x' | '-x')[];
  bottom?: boolean;
}
export interface Sign { text: string; x: number; y: number; z: number; w: number; color: string }

/** The finish a palette colour stands for: its surface kind and its colour. */
function surface(c: string): { kind: Face; col: V3 } {
  const col = rgb(c);
  if (c === C.glass) return { kind: FACE.curtain, col };
  if (c === C.gold || c === C.steel) return { kind: FACE.metal, col };
  if (c === C.roof) return { kind: FACE.roof, col };
  if (c === C.leaf || c === C.lawn) return { kind: FACE.leaf, col };
  if (c === BULB) return { kind: FACE.light, col };
  if (c === C.stone || c === C.ivory || c === C.concrete || c === C.white) return { kind: FACE.wall, col };
  return { kind: FACE.trim, col };
}

export function createKit() {
  let mb = new MeshBuilder(), signs: Sign[] = [], shift = 0, number = 0;
  const S = (v: number) => v * M;
  /** A pane's own number, 1/32 off the steps of 1/16 the material lights them by. */
  const paneNumber = () => { number = (number * 7 + 5) % 16; return (number + .5) / 16; };

  /** Starts a building: its parts go into `builder`, its signs into `list`. */
  function begin(builder: MeshBuilder, list: Sign[], seed: number) { mb = builder; signs = list; shift = seed % 7; number = seed % 16; }

  /** A box standing on y0, centred on (x, z). */
  function block(w: number, h: number, d: number, c: string, x: number, y0: number, z: number, o: BlockOptions = {}) {
    const s = surface(c), small = Math.min(w, h, d), big = small >= .22;
    const r = o.r ?? (small >= .3 ? .035 : 0);
    const options: BoxOptions = { c: S(r), kind: s.kind, col: s.col, faces: o.faces, bottom: o.bottom, occlude: big };
    if (o.top === "none") options.noTop = true;
    else if (o.top === "deck") options.top = FACE.deck;
    else if (o.top) { const t = surface(o.top); options.top = t.kind; options.topCol = t.col; }
    else options.top = s.kind === FACE.curtain || s.kind === FACE.window ? FACE.deck : s.kind;
    if (s.kind === FACE.curtain) {
      // Glass: a curtain wall, its floors from the bottom; a ribbon is one band of panes with the spandrel under it.
      const floor = o.ribbon ? h / .76 : o.win?.floor ?? Math.min(h, 1.15);
      Object.assign(options, { bay: S(o.win?.bay ?? .45), floor: S(floor), v0: S(o.ribbon ? floor * .24 - y0 : -y0), shift: ++shift });
    } else if (o.win) {
      Object.assign(options, { kind: FACE.window, bay: S(o.win.bay), floor: S(o.win.floor), winW: o.win.w ?? .46, winH: o.win.h ?? .5, even: o.win.even ? ['+z', '-z'] : undefined, shift: ++shift, top: o.top ? options.top : FACE.deck });
    }
    // Full building volumes have a recessed shell between a stone base and roof coping. These parts stay
    // inside the old envelope: doors, sills, plot edges and labels keep their original positions.
    const architectural = !o.faces && w >= 1.1 && d >= .7 && h >= .9 && (s.kind === FACE.wall || s.kind === FACE.curtain || !!o.win);
    const inset = architectural ? .012 : 0;
    const draw = () => boxShape(mb, [S(x - w / 2 + inset), S(y0), S(z - d / 2 + inset), S(x + w / 2 - inset), S(y0 + h), S(z + d / 2 - inset)], options);
    if (big) draw(); else mb.detail(draw);
    if (architectural) mb.detail(() => {
      const x0 = S(x - w / 2), x1 = S(x + w / 2), z0 = S(z - d / 2), z1 = S(z + d / 2), base = S(y0), top = S(y0 + h);
      boxShape(mb, [x0, base, z0, x1, base + S(.085), z1], { c: 0, kind: FACE.wall, col: rgb(C.concrete), top: FACE.trim, occlude: false });
      boxShape(mb, [x0, top - S(.045), z0, x1, top, z1], { c: 0, kind: FACE.trim, col: rgb(s.kind === FACE.curtain ? C.steel : C.ivory), top: options.top, topCol: options.topCol, noTop: options.noTop, occlude: false });
      if (s.kind === FACE.curtain) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = S(x + sx * (w / 2 - .016)), pz = S(z + sz * (d / 2 - .016)), half = S(.016);
        boxShape(mb, [px - half, base + S(.085), pz - half, px + half, top - S(.045), pz + half], { c: 0, kind: FACE.metal, col: rgb(C.steel), top: FACE.metal, occlude: false });
      }
    });
  }
  /** A box by its centre. */
  const box = (w: number, h: number, d: number, c: string, x: number, y: number, z: number, o: BlockOptions = {}) => block(w, h, d, c, x, y - h / 2, z, o);

  /** A cylinder standing on y0: posts, columns, shafts, tanks; `top` is its top radius. */
  function post(r: number, h: number, c: string, x: number, y0: number, z: number, top = r, seg = 12, o: { win?: Grid; cap?: string | null; ribbon?: boolean } = {}) {
    const s = surface(c), glass = s.kind === FACE.curtain;
    const architectural = r >= .25 && top >= .18 && h >= 1 && (s.kind === FACE.wall || glass);
    const inset = architectural ? .008 : 0;
    const floor = o.ribbon ? h / .76 : o.win?.floor ?? Math.min(h, 1.15);
    const cap = o.cap === null ? null : o.cap ? surface(o.cap) : { kind: glass ? FACE.deck : s.kind, col: s.col };
    const shaft = { x: S(x), z: S(z), y0: S(y0), y1: S(y0 + h), r: S(r - inset), r1: S(top - inset), seg, kind: o.win && !glass ? FACE.window : s.kind, col: s.col, top: cap ? cap.kind : null, topCol: cap?.col, occlude: r >= .2 && h >= .3 };
    const windows = glass || !!o.win;
    if (windows) Object.assign(shaft, { bay: S(o.win?.bay ?? .4), floor: S(floor), winW: o.win?.w ?? .5, winH: o.win?.h ?? .5 });
    const start = mb.count;
    if (r < .2) mb.detail(() => cylinder(mb, shaft)); else cylinder(mb, shaft);
    // The floors' grid from the foot of the shaft.
    if (windows) {
      const v0 = S(o.ribbon ? floor * .24 - y0 : -y0);
      for (let v = start; v < mb.count; v++) if (mb.s[v * 4 + 2] === FACE.curtain || mb.s[v * 4 + 2] === FACE.window) mb.s[v * 4 + 1] += v0;
    }
    if (architectural) mb.detail(() => {
      cylinder(mb, { x: S(x), z: S(z), y0: S(y0), y1: S(y0 + .055), r: S(r), r1: S(r - .004), seg, kind: FACE.trim, col: rgb(glass ? C.steel : C.concrete), top: FACE.trim, occlude: false });
      cylinder(mb, { x: S(x), z: S(z), y0: S(y0 + h - .04), y1: S(y0 + h), r: S(top - .004), r1: S(top), seg, kind: FACE.trim, col: rgb(glass ? C.steel : C.ivory), top: cap?.kind ?? FACE.deck, topCol: cap?.col, occlude: false });
    });
  }
  /** A disc r across and t thick facing the front, its middle at (x, y, z): a clock's dial, a round window. */
  function disc(r: number, t: number, c: string, x: number, y: number, z: number, seg = 20) {
    const s = surface(c);
    mb.detail(() => mb.frame([S(x), S(y), S(z - t / 2)], [1, 0, 0], [0, 0, 1], [0, -1, 0], () => cylinder(mb, { x: 0, z: 0, y0: 0, y1: S(t), r: S(r), seg, kind: s.kind === FACE.curtain ? FACE.pane : s.kind, col: s.col, top: s.kind === FACE.curtain ? FACE.pane : s.kind, occlude: false })));
  }
  /** A ring about (x, y, z): lying flat, or facing the front; `arc` from `start` for a part of it (facing the front, start π/2 and arc π is the upper half). */
  function torus(r: number, t: number, c: string, x: number, y: number, z: number, o: { front?: boolean; seg?: number; arc?: number; start?: number } = {}) {
    const s = surface(c), draw = () => torusShape(mb, { x: 0, y: 0, z: 0, R: S(r), r: S(t), seg: o.seg ?? 24, tube: 6, arc: o.arc, start: o.start, kind: s.kind, col: s.col });
    if (o.front) mb.detail(() => mb.frame([S(x), S(y), S(z)], [1, 0, 0], [0, 0, 1], [0, -1, 0], draw));
    else mb.detail(() => mb.frame([S(x), S(y), S(z)], [1, 0, 0], [0, 1, 0], [0, 0, 1], draw));
  }
  /** A ball r across about (x, y, z); `rise` makes it taller or flatter; `glow` makes it a lamp (lit at night). */
  function ball(r: number, c: string, x: number, y: number, z: number, seg = 12, rise = r, glow = false) {
    const s = surface(c), kind = glow ? FACE.light : s.kind === FACE.curtain ? FACE.pane : s.kind;
    const draw = () => sphere(mb, { x: S(x), y: S(y), z: S(z), r: S(r), rise: S(rise), seg, rings: Math.max(3, Math.round(seg / 3)), kind, col: s.col, occlude: r >= .3 });
    if (r >= .3) draw(); else mb.detail(draw);
  }
  /** A dome on y0, r across, rising `rise`; `sz` stretches it along z. */
  function dome(r: number, c: string, x: number, y0: number, z: number, rise = r, seg = 24, sz = 1) {
    const s = surface(c), kind = s.kind === FACE.curtain ? FACE.pane : s.kind === FACE.wall ? FACE.roof : s.kind;
    domeShape(mb, { x: S(x), z: S(z), y0: S(y0), r: S(r), rise: S(rise), sz, seg, rings: 6, kind, col: s.col });
  }
  /** A cylinder lying along x, centred on (x, y, z): an axle, the ear cup of a headset. */
  function axle(r: number, len: number, c: string, x: number, y: number, z: number, seg = 16) {
    const s = surface(c);
    mb.frame([S(x - len / 2), S(y), S(z)], [0, -1, 0], [1, 0, 0], [0, 0, 1], () => cylinder(mb, { x: 0, z: 0, y0: 0, y1: S(len), r: S(r), seg, kind: s.kind, col: s.col, bottom: true, occlude: false }));
  }
  /** Draws `draw` turned by Euler angles (x, then y, then z, as three.js does) about the point (x, y, z), the parts drawn relative to it. */
  function rotated(x: number, y: number, z: number, ax: number, ay: number, az: number, draw: () => void) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(ax, ay, az)), e = m.elements;
    mb.frame([S(x), S(y), S(z)], [e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]], draw);
  }
  /**
   * A flat top `cells` × `cells` quads w × d at height y: big enough for the occlusion baked into its corners to show the
   * contact shadows of what stands on it (the island's terrace).
   */
  function slab(w: number, d: number, y: number, c: string, cells = 12) {
    const s = surface(c), x0 = -w / 2, z0 = -d / 2;
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      const a = S(x0 + w * i / cells), b = S(x0 + w * (i + 1) / cells), f = S(z0 + d * (j + 1) / cells), n = S(z0 + d * j / cells);
      mb.quad([[a, S(y), f], [b, S(y), f], [b, S(y), n], [a, S(y), n]], { kind: s.kind, col: s.col, n: [0, 1, 0], uv: [[a, f], [b, f], [b, n], [a, n]] });
    }
  }
  /** A four-sided pyramid roof over w × d, h high, on y0. */
  const pyramid = (w: number, d: number, h: number, c: string, x: number, y0: number, z: number, overhang = 0) =>
    pyramidShape(mb, { x0: S(x - w / 2), x1: S(x + w / 2), z0: S(z - d / 2), z1: S(z + d / 2), y: S(y0), h: S(h), overhang: S(overhang), roof: rgb(c), kind: surface(c).kind === FACE.curtain ? FACE.pane : FACE.roof });
  /** A cone or a spire on y0. */
  function cone(r: number, h: number, c: string, x: number, y0: number, z: number, seg = 12) {
    const s = surface(c);
    cylinder(mb, { x: S(x), z: S(z), y0: S(y0), y1: S(y0 + h), r: S(r), r1: 0, seg, kind: s.kind === FACE.wall ? FACE.roof : s.kind, col: s.col, bottom: false, occlude: false });
  }
  /** A pediment: a triangular prism w wide, h to its ridge, d deep, on y0; `cover` for its slopes. */
  const prism = (w: number, h: number, d: number, c: string, x: number, y0: number, z: number, cover?: string) =>
    prismShape(mb, { x0: S(x - w / 2), x1: S(x + w / 2), z0: S(z - d / 2), z1: S(z + d / 2), y: S(y0), rise: S(h), col: rgb(c), roof: cover ? rgb(cover) : undefined });
  /**
   * A pitched roof on y0 over w × d, h to the ridge, with eaves, soffits and gable walls. The ridge runs along z (a
   * gable end to the front) or, `along: 'x'`, across the front.
   */
  function pitched(w: number, d: number, h: number, x: number, y0: number, z: number, { wall = C.stone, cover = C.roof, along = 'z', overhang = .09 }: { wall?: string; cover?: string; along?: 'x' | 'z'; overhang?: number } = {}) {
    const across = along === 'x' ? d : w, length = along === 'x' ? w : d;
    const [a, b] = along === 'x' ? [x, z] : [z, x];
    gableRoof(mb, { a0: S(a - length / 2), a1: S(a + length / 2), b0: S(b - across / 2), b1: S(b + across / 2), y: S(y0), pitch: h / (across / 2), overhang: S(overhang), axis: along, roof: rgb(cover), wall: rgb(wall) });
    // The ridge capping.
    block(along === 'x' ? length + overhang * 2 : .08, .05, along === 'x' ? .08 : length + overhang * 2, C.slate, x, y0 + h - .02, z, { r: 0 });
    // Gutters sit below the eaves, inside their existing overhang instead of widening the model.
    for (const side of [-1, 1]) {
      if (along === 'x') block(length + overhang * 2, .035, .035, C.steel, x, y0 - .07, z + side * (d / 2 + overhang - .018), { r: 0 });
      else block(.035, .035, length + overhang * 2, C.steel, x + side * (w / 2 + overhang - .018), y0 - .07, z, { r: 0 });
    }
  }
  /** A barrel vault on y0 over a hall `len` long along z, its arch to the front, closed at both ends. */
  function vault(r: number, len: number, c: string, x: number, y0: number, z: number, end = C.stone) {
    const s = surface(c), e = rgb(end);
    mb.frame([S(x), S(y0), S(z + len / 2)], [1, 0, 0], [0, 0, -1], [0, 1, 0], () => cylinder(mb, {
      x: 0, z: 0, y0: 0, y1: S(len), r: S(r), seg: 14, a0: -Math.PI / 2, a1: Math.PI / 2,
      kind: s.kind === FACE.curtain ? FACE.pane : s.kind === FACE.metal ? FACE.metal : FACE.roof, col: s.col, top: FACE.wall, topCol: e, bottom: true, occlude: false,
    }));
    mb.occlude([S(x - r * .8), S(y0), S(z - len / 2), S(x + r * .8), S(y0 + r * .8), S(z + len / 2)]);
  }
  /** An arch w wide and h to its crown facing the front at (x, y, z), its foot at y: glass, or a solid arch. */
  function arch(w: number, h: number, c: string, x: number, y: number, z: number, depth = .07) {
    const s = surface(c), glass = s.kind === FACE.curtain;
    archShape(mb, { x: S(x), y: S(y), z: S(z + depth / 2), w: S(w), h: S(h), depth: S(depth), seg: 12, kind: glass ? FACE.curtain : s.kind, col: s.col,
      win: glass ? [S(Math.max(.3, w / Math.max(2, Math.round(w / .45)))), S(Math.min(h, 1.1)), 0, 0] : undefined });
  }

  /**
   * Windows on one face of a building, w × h from y0, at the positions along the face (x on the front and back, z on
   * the sides); `at` is the face's own coordinate. Each is a pane with its frame, glass and blind drawn by the
   * material (a window cell of its own, so each lights on its own at night), and a stone sill under it.
   */
  function panes(face: Side, at: number, y0: number, along: readonly number[], w: number, h: number, frame: string = C.ivory) {
    const out = face === 'front' || face === 'right' ? 1 : -1, side = face === 'left' || face === 'right', col = rgb(frame);
    const qw = w + .1, qh = h + .14, bay = S(qw), floor = S(qh), win: [number, number, number, number] = [bay, floor, w / qw, h / qh];
    for (const a of along) {
      const k = ++number, c0 = (k * 5) % 23, row = 2 + (k % 3), u0 = c0 * bay, u1 = u0 + bay, v0 = row * floor, v1 = v0 + floor;
      // The material centres a window at 0.57 of its cell: the cell is placed so the glass spans y0…y0 + h.
      const y = S(y0 + h / 2 - .57 * qh), top = y + floor, o = S(at) + out * S(.012), half = bay / 2, centre = S(a), sill = S(y0);
      const uv: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      if (side) {
        const pts: V3[] = out > 0 ? [[o, y, centre + half], [o, y, centre - half], [o, top, centre - half], [o, top, centre + half]] : [[o, y, centre - half], [o, y, centre + half], [o, top, centre + half], [o, top, centre - half]];
        mb.quad(pts, { kind: FACE.window, col, win, uv });
        boxShape(mb, out > 0 ? [o - S(.01), sill - S(.045), centre - half * .8, o + S(.07), sill + S(.005), centre + half * .8] : [o - S(.07), sill - S(.045), centre - half * .8, o + S(.01), sill + S(.005), centre + half * .8], { c: 0, kind: FACE.trim, col: rgb(C.stone), occlude: false });
      } else {
        const pts: V3[] = out > 0 ? [[centre - half, y, o], [centre + half, y, o], [centre + half, top, o], [centre - half, top, o]] : [[centre + half, y, o], [centre - half, y, o], [centre - half, top, o], [centre + half, top, o]];
        mb.quad(pts, { kind: FACE.window, col, win, uv });
        boxShape(mb, out > 0 ? [centre - half * .8, sill - S(.045), o - S(.01), centre + half * .8, sill + S(.005), o + S(.07)] : [centre - half * .8, sill - S(.045), o - S(.07), centre + half * .8, sill + S(.005), o + S(.01)], { c: 0, kind: FACE.trim, col: rgb(C.stone), occlude: false });
      }
      // Three shallow reveals give every individual window a real edge and shadow at close range. The
      // glazing and its finer frame remain the material's grid, so distant windows do not multiply meshes.
      mb.detail(() => {
        const low = S(y0 - .015), high = S(y0 + h + .015), depth0 = o - S(out > 0 ? .005 : .035), depth1 = o + S(out > 0 ? .035 : .005), t = S(.025), ww = S(w / 2 + .018);
        for (const sign of [-1, 1]) {
          const a0 = centre + sign * ww - t / 2, a1 = a0 + t;
          boxShape(mb, side ? [depth0, low, a0, depth1, high, a1] : [a0, low, depth0, a1, high, depth1], { c: 0, kind: FACE.trim, col, top: FACE.trim, occlude: false });
        }
        boxShape(mb, side ? [depth0, high - t, centre - ww, depth1, high, centre + ww] : [centre - ww, high - t, depth0, centre + ww, high, depth1], { c: 0, kind: FACE.trim, col, top: FACE.trim, occlude: false });
      });
    }
  }
  /** A window set on the front at (x, y0, z): framed, arched or square, with a sill. */
  function window(x: number, y0: number, z: number, w = .5, h = .8, arched = false) {
    if (arched) {
      archShape(mb, { x: S(x), y: S(y0 - .06), z: S(z - .03), w: S(w + .14), h: S(h + .12), depth: S(.06), seg: 10, kind: FACE.trim, col: rgb(C.ivory) });
      archShape(mb, { x: S(x), y: S(y0), z: S(z + .01), w: S(w), h: S(h), depth: S(.04), seg: 10, kind: FACE.pane, col: rgb(C.glass), win: [paneNumber(), 0, 0, 0] });
      block(.03, h - w / 2, .02, C.ivory, x, y0, z + .035, { r: 0 });
      block(w + .2, .07, .16, C.stone, x, y0 - .07, z + .04, { r: 0 });
    } else panes('front', z, y0, [x], w, h);
  }
  /** A door on the front, its foot at y0: a panelled leaf in a frame, a step before it. */
  function door(w: number, h: number, x: number, y0: number, z: number, c: string = C.ink) {
    block(w + .1, h + .06, .05, C.ivory, x, y0, z - .02, { r: 0 });
    block(w, h, .05, c, x, y0, z, { r: 0 });
    block(w * .04, h * .28, .02, C.gold, x + w * .3, y0 + h * .42, z + .035, { r: 0 });
    // A recessed lower panel and upper glazed leaf, both behind the existing projecting pull handle.
    mb.detail(() => {
      boxShape(mb, [S(x - w * .38), S(y0 + h * .12), S(z + .026), S(x + w * .38), S(y0 + h * .39), S(z + .034)], { c: 0, kind: FACE.trim, col: rgb(C.slate), top: FACE.trim, occlude: false });
      boxShape(mb, [S(x - w * .36), S(y0 + h * .5), S(z + .026), S(x + w * .36), S(y0 + h * .89), S(z + .033)], { c: 0, kind: FACE.pane, col: rgb(C.glass), top: FACE.pane, bay: paneNumber(), occlude: false });
    });
  }
  /** A sign on a board facing the front: the text on a canvas (assets/landmarks.ts). */
  function sign(text: string, x: number, y: number, z: number, w: number, color = C.ink) {
    block(w + .05, w / 4, .03, color, x, y - w / 8, z - .025, { r: 0 });
    signs.push({ text, x, y, z, w, color });
  }
  /** A shrub in a stone planter, s its size, on y0. */
  function shrub(x: number, z: number, s = 1, y0 = 0) {
    block(.7 * s, .25, .65 * s, C.stone, x, y0 + .145, z, { r: .04 });
    ball(.34 * s, C.leaf, x, y0 + .57, z, 10, .29 * s);
    ball(.19 * s, C.lawn, x + .13 * s, y0 + .78, z - .06 * s, 8);
  }
  /** A lamp post on y0: a dark pole, a lantern that glows at night. */
  function lamp(x: number, z: number, y0 = 0) {
    post(.11, .1, C.ink, x, y0 + .17, z, .1, 10);
    post(.045, 1.23, C.ink, x, y0 + .27, z, .035, 8);
    block(.2, .05, .2, C.ink, x, y0 + 1.5, z, { r: 0 });
    block(.15, .18, .15, BULB, x, y0 + 1.55, z, { r: 0 });
    pyramid(.26, .26, .12, C.ink, x, y0 + 1.73, z);
  }
  /** A round-crowned tree, s its size, on y0. */
  function tree(x: number, z: number, s = 1, y0 = PLINTH) {
    post(.06 * s, .5 * s, C.wood, x, y0, z, .045 * s, 6, { cap: null });
    ball(.36 * s, C.leaf, x, y0 + .72 * s, z, 10, .396 * s);
    ball(.2 * s, C.lawn, x + .14 * s, y0 + .92 * s, z - .08 * s, 8);
    ball(.2 * s, C.leaf, x - .17 * s, y0 + .6 * s, z + .1 * s, 8);
  }
  /** A flag on a pole h high, flying towards +x, its cloth in two folds. */
  function flag(x: number, z: number, h: number, c: string, y0 = PLINTH) { mb.detail(() => flagParts(x, z, h, c, y0)); }
  function flagParts(x: number, z: number, h: number, c: string, y0: number) {
    post(.03, h, C.ink, x, y0, z, .022, 6);
    ball(.05, C.gold, x, y0 + h + .04, z, 8);
    const s = rgb(c), y1 = S(y0 + h - .03), y2 = S(y0 + h - .34), x0 = S(x + .02), x1 = S(x + .27), x2 = S(x + .52), z0 = S(z), z1 = S(z + .04);
    for (const side of [1, -1]) {
      const q = (p: V3[]) => mb.quad(side > 0 ? p : [p[1], p[0], p[3], p[2]], { kind: FACE.trim, col: s });
      q([[x0, y2, z0], [x1, y2, z1], [x1, y1, z1], [x0, y1, z0]]);
      q([[x1, y2, z1], [x2, y2 - S(.02), z0], [x2, y1 - S(.02), z0], [x1, y1, z1]]);
    }
  }
  /** A park bench on y0 facing +z, turned by `turn`. */
  function bench(x: number, z: number, turn = 0, y0 = PLINTH) {
    mb.detail(() => mb.turned(S(x), S(z), turn, () => {
      block(.7, .05, .2, C.wood, 0, y0 + .2, 0, { r: 0 }); block(.7, .16, .04, C.wood, 0, y0 + .26, -.09, { r: 0 });
      for (const sx of [-1, 1]) block(.04, .2, .18, C.ink, sx * .3, y0, 0, { r: 0 });
    }));
  }
  /** A small taxi, 0.6 × 1.1, its nose to +z turned by `turn`, on y0. */
  function taxi(x: number, z: number, turn = 0, c: string = C.taxi, y0 = PLINTH) {
    mb.detail(() => mb.turned(S(x), S(z), turn, () => {
      block(.58, .22, 1.08, c, 0, y0 + .12, 0, { r: .06 });
      block(.5, .2, .56, C.ink, 0, y0 + .34, -.06, { r: .05 });
      block(.52, .03, .5, c, 0, y0 + .54, -.06, { r: 0 });
      block(.2, .07, .1, C.gold, 0, y0 + .57, -.04, { r: 0 });
      block(.44, .06, .03, BULB, 0, y0 + .22, .53, { r: 0 });
      block(.44, .06, .03, C.red, 0, y0 + .22, -.55, { r: 0 });
      for (const sx of [-1, 1]) for (const sz of [-.33, .34]) mb.frame([S(sx * .26), S(y0 + .12), S(sz)], [0, 1, 0], [sx, 0, 0], [0, 0, -sx], () => cylinder(mb, { x: 0, z: 0, y0: 0, y1: S(.08), r: S(.12), seg: 10, kind: FACE.trim, col: rgb(C.ink), top: FACE.metal, topCol: rgb(C.steel), occlude: false }));
    }));
  }
  /** A dish aerial: its bowl r across, opening up and tilted `tilt` towards +z, turned by `turn`, on its mount at y. */
  function dish(r: number, x: number, y: number, z: number, tilt = .6, turn = 0) { mb.detail(() => dishParts(r, x, y, z, tilt, turn)); }
  function dishParts(r: number, x: number, y: number, z: number, tilt: number, turn: number) {
    post(.06, .12, C.steel, x, y - .12, z, .06, 8);
    const c = Math.cos(turn), s = Math.sin(turn), ct = Math.cos(tilt), st = Math.sin(tilt);
    // The bowl's frame: turned about y, then tipped about its x axis towards the front.
    const X: V3 = [c, 0, -s], Y: V3 = [s * st, ct, c * st], Z: V3 = [s * ct, -st, c * ct];
    mb.frame([S(x), S(y), S(z)], X, Y, Z, () => {
      // A shallow paraboloid, inside and out, in rings from the hub.
      const R = S(r), depth = R * .32, seg = 18, rings = 4, white = rgb(C.ivory);
      const at = (a: number, t: number): V3 => [R * t * Math.sin(a), depth * t * t, R * t * Math.cos(a)];
      const normal = (a: number, t: number, up: number): V3 => { const n: V3 = [-2 * depth * t / R * Math.sin(a) * up, up, -2 * depth * t / R * Math.cos(a) * up]; const l = Math.hypot(...n); return [n[0] / l, n[1] / l, n[2] / l]; };
      for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
        const a0 = Math.PI * 2 * i / seg, a1 = Math.PI * 2 * (i + 1) / seg, t0 = j / rings, t1 = (j + 1) / rings;
        // Inside (seen from above): rim outwards is "up", so the corners go round the other way.
        mb.quad([at(a1, t0), at(a0, t0), at(a0, t1), at(a1, t1)], { kind: FACE.trim, col: white, ns: [normal(a1, t0, 1), normal(a0, t0, 1), normal(a0, t1, 1), normal(a1, t1, 1)] });
        mb.quad([at(a0, t0), at(a1, t0), at(a1, t1), at(a0, t1)], { kind: FACE.trim, col: white, ns: [normal(a0, t0, -1), normal(a1, t0, -1), normal(a1, t1, -1), normal(a0, t1, -1)] });
      }
      rodShape(mb, [0, 0, 0], [0, R * .78, 0], S(.025), { col: rgb(C.gold) });
      sphere(mb, { x: 0, y: R * .8, z: 0, r: S(r * .08), seg: 8, rings: 3, kind: FACE.trim, col: rgb(C.ink) });
    });
  }
  /** A lattice mast w across and h high on y0, with a warning light at the top. */
  function mast(w: number, h: number, x: number, y0: number, z: number, c: string = C.red) { mb.detail(() => mastParts(w, h, x, y0, z, c)); }
  function mastParts(w: number, h: number, x: number, y0: number, z: number, c: string) {
    const legs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]], step = .42, n = Math.max(2, Math.round(h / step));
    for (const [sx, sz] of legs) block(.045, h, .045, c, x + sx * w / 2, y0, z + sz * w / 2, { r: 0 });
    for (let i = 1; i <= n; i++) {
      const y = y0 + h * i / n, colour = i % 2 ? C.white : c, rise = h / n;
      block(w, .035, .035, colour, x, y - .035, z - w / 2, { r: 0 }); block(w, .035, .035, colour, x, y - .035, z + w / 2, { r: 0 });
      block(.035, .035, w, colour, x - w / 2, y - .035, z, { r: 0 }); block(.035, .035, w, colour, x + w / 2, y - .035, z, { r: 0 });
      // One brace across each face of every bay, alternating.
      const flip = i % 2 ? 1 : -1;
      for (const face of [-1, 1]) {
        rod([x - w / 2 * flip, y - rise, z + face * w / 2], [x + w / 2 * flip, y, z + face * w / 2], .022, C.steel);
        rod([x + face * w / 2, y - rise, z - w / 2 * flip], [x + face * w / 2, y, z + w / 2 * flip], .022, C.steel);
      }
    }
    beacon(x, y0 + h + .07, z);
  }
  /** A red warning light that glows (on a mast, a spire, a roof). */
  const beacon = (x: number, y: number, z: number, r = .07) => ball(r, '#ff4a3d', x, y, z, 8, r, true);
  /** A bar of thickness t from a to b: braces, guy wires, legs. */
  const rod = (a: V3, b: V3, t: number, c: string) => { const s = surface(c); mb.detail(() => rodShape(mb, [S(a[0]), S(a[1]), S(a[2])], [S(b[0]), S(b[1]), S(b[2])], S(t), { kind: s.kind, col: s.col })); };
  /** A light: a glowing ball, a bulb along a marquee. */
  const bulb = (r: number, x: number, y: number, z: number) => ball(r, BULB, x, y, z, 6, r, true);
  return { begin, block, box, post, disc, torus, ball, dome, axle, rotated, slab, pyramid, cone, prism, pitched, vault, arch, panes, window, door, sign, shrub, lamp, tree, flag, bench, taxi, dish, mast, rod, bulb, beacon };
}
export type LandmarkKit = ReturnType<typeof createKit>;
