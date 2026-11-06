/**
 * Procedural buildings of city v4 (docs/CITY_V4.md, stage 2): a mesh builder for chamfered boxes, gable roofs and
 * parapets, ambient occlusion baked into the vertices, and the facade material that draws the detail polygons would
 * otherwise carry: windows with frames and sills, curtain walls with mullions, roof tiles, gravel decks.
 *
 * Every vertex carries `aSurf` (u and v in metres along its wall, the surface kind, baked occlusion) and `aWin` (bay
 * width and floor height in metres, window width and height as shares of them). A model exists once, at one level of
 * detail: where a bay shrinks to a few pixels the material fades its windows into their average, so a building looks
 * the same near and far, without a far copy and without a moiré.
 */
import * as THREE from "three/webgpu";
import { abs, attribute, float, floor, fract, fwidth, hash, max, min, mix, positionWorld, smoothstep, step, texture, vec2, vec3, vec4, vertexColor } from "three/tsl";
import { groundNoise } from "../render/ground";

/**
 * Surface kinds, kept in aSurf.z. `mirror` is a curtain wall of reflective glass in a thin dark grid; `spire` is the same
 * glass on a roof, whose panes never light up at night as an office's do.
 */
export const FACE = { window: 0, wall: 1, roof: 2, deck: 3, trim: 4, curtain: 5, light: 6, mirror: 7, glass: 8, spire: 9 } as const;
type Face = typeof FACE[keyof typeof FACE];
export type V3 = [number, number, number];
/** A colour as linear RGB, from an sRGB hex. */
export const rgb = (hex: string): V3 => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const WHITE: V3 = [1, 1, 1];
const NO_WINDOWS: [number, number, number, number] = [99, 99, 0, 0];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export interface FaceOptions { kind: Face; col?: V3; n?: V3; ns?: V3[]; uv?: [number, number][]; u0?: number; win?: [number, number, number, number] }

export class MeshBuilder {
  readonly p: number[] = []; readonly n: number[] = []; readonly c: number[] = []; readonly s: number[] = []; readonly w: number[] = []; readonly i: number[] = [];
  /** Boxes that shade the vertices near them (bakeOcclusion). */
  readonly occluders: [number, number, number, number, number, number][] = [];
  get count() { return this.p.length / 3; }
  private vertex(p: V3, n: V3, col: V3, kind: number, u: number, v: number, win: readonly number[]) {
    this.p.push(...p); this.n.push(...n); this.c.push(...col); this.s.push(u, v, kind, 1); this.w.push(win[0], win[1], win[2], win[3]);
    return this.count - 1;
  }
  /** A quad, corners counter-clockwise seen from outside; u runs along the first edge, v is the height. */
  quad(points: V3[], o: FaceOptions) {
    const normal = o.n ?? unit(cross(sub(points[1], points[0]), sub(points[3], points[0])));
    const normals = o.ns ?? [normal, normal, normal, normal], run = length(sub(points[1], points[0])), u0 = o.u0 ?? 0;
    const uv = o.uv ?? [[u0, points[0][1]], [u0 + run, points[1][1]], [u0 + run, points[2][1]], [u0, points[3][1]]];
    const id = points.map((p, k) => this.vertex(p, normals[k], o.col ?? WHITE, o.kind, uv[k][0], uv[k][1], o.win ?? NO_WINDOWS));
    this.i.push(id[0], id[1], id[2], id[0], id[2], id[3]);
  }
  tri(points: V3[], o: FaceOptions) {
    const normal = o.n ?? unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
    const normals = o.ns ?? [normal, normal, normal], uv = o.uv ?? [[0, points[0][1]], [1, points[1][1]], [.5, points[2][1]]];
    const id = points.map((p, k) => this.vertex(p, normals[k], o.col ?? WHITE, o.kind, uv[k][0], uv[k][1], o.win ?? NO_WINDOWS));
    this.i.push(id[0], id[1], id[2]);
  }
  /**
   * The geometry in the model's units: metres times `unitsPerMetre`, in the frame it was drawn in (centred on its
   * footprint, standing on y = 0, facing +z). The wall coordinates stay in metres, so windows keep their size.
   */
  build(unitsPerMetre: number): THREE.BufferGeometry {
    const positions = new Float32Array(this.p.map(v => v * unitsPerMetre)), normals = new Float32Array(this.n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("aSurf", new THREE.Float32BufferAttribute(this.s, 4));
    g.setAttribute("aWin", new THREE.Float32BufferAttribute(this.w, 4));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

export interface BoxOptions {
  /** Chamfer of the vertical and top edges, metres. */
  c?: number; kind?: Face; col?: V3; top?: Face; topCol?: V3;
  /** Bay width and floor height (metres), window width and height (shares of them). */
  bay?: number; floor?: number; winW?: number; winH?: number;
  /** Walls whose bays come in an even number (a door between two windows). */
  even?: ("+z" | "-z" | "+x" | "-x")[];
  faces?: ("+z" | "-z" | "+x" | "-x")[];
  noTop?: boolean; occlude?: boolean;
  /** Flat bevels: each chamfer strip keeps its own normal instead of blending those of the faces it joins (a cut corner, not a rounded one). */
  crisp?: boolean;
}
/**
 * A box with its vertical and top edges chamfered. The walls keep flat normals; the chamfer strips blend the normals
 * of the faces they join, so the edges catch the light like real bevels (30 triangles in all).
 */
export function box(mb: MeshBuilder, [x0, y0, z0, x1, y1, z1]: [number, number, number, number, number, number], o: BoxOptions = {}) {
  const c = Math.min(o.c ?? .12, (x1 - x0) / 2.2, (z1 - z0) / 2.2, (y1 - y0) / 2.2);
  const col = o.col ?? WHITE, kind = o.kind ?? FACE.wall, glassy = kind === FACE.curtain || kind === FACE.mirror;
  const edgeKind = kind === FACE.window || glassy ? FACE.wall : kind;
  const edgeCol: V3 = glassy ? [col[0] * .5, col[1] * .55, col[2] * .6] : col;
  const target = o.bay ?? 2.8, floorH = o.floor ?? 2.9, ww = o.winW ?? .44, wh = o.winH ?? .48, faces = o.faces ?? ["+z", "-z", "+x", "-x"];
  const bays = (run: number, key: string) => {
    let n = Math.max(1, Math.round(run / target));
    if (o.even?.includes(key as "+z") && n % 2) n += run / target > n ? 1 : -1;
    return run / Math.max(1, n);
  };
  const xi0 = x0 + c, xi1 = x1 - c, zi0 = z0 + c, zi1 = z1 - c, yt = y1 - c;
  const wall = (key: string, run: number, n: V3): FaceOptions => ({ kind, col, n, win: [bays(run, key), floorH, ww, wh] });
  if (faces.includes("+z")) mb.quad([[xi0, y0, z1], [xi1, y0, z1], [xi1, yt, z1], [xi0, yt, z1]], wall("+z", xi1 - xi0, [0, 0, 1]));
  if (faces.includes("-z")) mb.quad([[xi1, y0, z0], [xi0, y0, z0], [xi0, yt, z0], [xi1, yt, z0]], wall("-z", xi1 - xi0, [0, 0, -1]));
  if (faces.includes("+x")) mb.quad([[x1, y0, zi1], [x1, y0, zi0], [x1, yt, zi0], [x1, yt, zi1]], wall("+x", zi1 - zi0, [1, 0, 0]));
  if (faces.includes("-x")) mb.quad([[x0, y0, zi0], [x0, y0, zi1], [x0, yt, zi1], [x0, yt, zi0]], wall("-x", zi1 - zi0, [-1, 0, 0]));
  const e: FaceOptions = { kind: edgeKind, col: edgeCol };
  const s = Math.SQRT1_2, pz: V3 = [0, 0, 1], nz: V3 = [0, 0, -1], px: V3 = [1, 0, 0], nx: V3 = [-1, 0, 0], py: V3 = [0, 1, 0];
  const blend = (...normals: V3[]) => o.crisp ? undefined : normals;
  mb.quad([[xi1, y0, z1], [x1, y0, zi1], [x1, yt, zi1], [xi1, yt, z1]], { ...e, ns: blend(pz, px, px, pz), n: [s, 0, s] });
  mb.quad([[x0, y0, zi1], [xi0, y0, z1], [xi0, yt, z1], [x0, yt, zi1]], { ...e, ns: blend(nx, pz, pz, nx), n: [-s, 0, s] });
  mb.quad([[x1, y0, zi0], [xi1, y0, z0], [xi1, yt, z0], [x1, yt, zi0]], { ...e, ns: blend(px, nz, nz, px), n: [s, 0, -s] });
  mb.quad([[xi0, y0, z0], [x0, y0, zi0], [x0, yt, zi0], [xi0, yt, z0]], { ...e, ns: blend(nz, nx, nx, nz), n: [-s, 0, -s] });
  mb.quad([[xi0, yt, z1], [xi1, yt, z1], [xi1, y1, zi1], [xi0, y1, zi1]], { ...e, ns: blend(pz, pz, py, py), n: [0, s, s] });
  mb.quad([[xi1, yt, z0], [xi0, yt, z0], [xi0, y1, zi0], [xi1, y1, zi0]], { ...e, ns: blend(nz, nz, py, py), n: [0, s, -s] });
  mb.quad([[x1, yt, zi1], [x1, yt, zi0], [xi1, y1, zi0], [xi1, y1, zi1]], { ...e, ns: blend(px, px, py, py), n: [s, s, 0] });
  mb.quad([[x0, yt, zi0], [x0, yt, zi1], [xi0, y1, zi1], [xi0, y1, zi0]], { ...e, ns: blend(nx, nx, py, py), n: [-s, s, 0] });
  mb.tri([[xi1, yt, z1], [x1, yt, zi1], [xi1, y1, zi1]], { ...e, ns: blend(pz, px, py) });
  mb.tri([[x0, yt, zi1], [xi0, yt, z1], [xi0, y1, zi1]], { ...e, ns: blend(nx, pz, py) });
  mb.tri([[x1, yt, zi0], [xi1, yt, z0], [xi1, y1, zi0]], { ...e, ns: blend(px, nz, py) });
  mb.tri([[xi0, yt, z0], [x0, yt, zi0], [xi0, y1, zi0]], { ...e, ns: blend(nz, nx, py) });
  if (!o.noTop) mb.quad([[xi0, y1, zi1], [xi1, y1, zi1], [xi1, y1, zi0], [xi0, y1, zi0]], { kind: o.top ?? FACE.deck, col: o.topCol ?? col, n: py, uv: [[xi0, zi1], [xi1, zi1], [xi1, zi0], [xi0, zi0]] });
  if (o.occlude !== false) mb.occluders.push([x0, y0, z0, x1, y1, z1]);
}

export interface RoofOptions { a0: number; a1: number; b0: number; b1: number; y: number; pitch: number; overhang?: number; axis?: "x" | "z"; roof: V3; wall: V3; soffit?: V3 }
/** A gable roof whose ridge runs along `axis`, with overhangs, soffits and gable walls; returns the ridge height. */
export function gableRoof(mb: MeshBuilder, r: RoofOptions) {
  const { a0, a1, b0, b1, y, pitch, overhang = .45, axis = "x" } = r, soffit = r.soffit ?? rgb("#d6d0c4");
  const bm = (b0 + b1) / 2, yr = y + (b1 - b0) / 2 * pitch, yl = y - overhang * pitch;
  const A0 = a0 - overhang, A1 = a1 + overhang, B0 = b0 - overhang, B1 = b1 + overhang;
  const slope = Math.hypot(B1 - bm, yr - yl), l = Math.hypot(pitch, 1);
  const at = (a: number, h: number, b: number): V3 => axis === "x" ? [a, h, b] : [b, h, a];
  const flip = axis !== "x";
  const up = (sign: number): V3 => axis === "x" ? [0, 1 / l, sign * pitch / l] : [sign * pitch / l, 1 / l, 0];
  const quad = (p: V3[], o: FaceOptions) => flip ? mb.quad([p[0], p[3], p[2], p[1]], { ...o, uv: o.uv && [o.uv[0], o.uv[3], o.uv[2], o.uv[1]] }) : mb.quad(p, o);
  const tri = (p: V3[], o: FaceOptions) => flip ? mb.tri([p[0], p[2], p[1]], o) : mb.tri(p, o);
  const uv: [number, number][] = [[0, 0], [A1 - A0, 0], [A1 - A0, slope], [0, slope]];
  quad([at(A0, yl, B1), at(A1, yl, B1), at(A1, yr, bm), at(A0, yr, bm)], { kind: FACE.roof, col: r.roof, n: up(1), uv });
  quad([at(A1, yl, B0), at(A0, yl, B0), at(A0, yr, bm), at(A1, yr, bm)], { kind: FACE.roof, col: r.roof, n: up(-1), uv });
  const ys = yl - .05, down: V3 = [0, -1, 0];
  quad([at(A0, ys, B1), at(A0, ys, b1), at(A1, ys, b1), at(A1, ys, B1)], { kind: FACE.trim, col: soffit, n: down });
  quad([at(A1, ys, B0), at(A1, ys, b0), at(A0, ys, b0), at(A0, ys, B0)], { kind: FACE.trim, col: soffit, n: down });
  const side = (sign: number): V3 => axis === "x" ? [sign, 0, 0] : [0, 0, sign];
  tri([at(a1, y, b1), at(a1, y, b0), at(a1, yr, bm)], { kind: FACE.wall, col: r.wall, n: side(1) });
  tri([at(a0, y, b0), at(a0, y, b1), at(a0, yr, bm)], { kind: FACE.wall, col: r.wall, n: side(-1) });
  return yr;
}

export interface HipOptions { x0: number; x1: number; z0: number; z1: number; y: number; pitch: number; overhang?: number; roof: V3; soffit?: V3 }
/** A hip roof: four slopes, the ridge along the longer side; eaves all round with a soffit under them. Returns the ridge height. */
export function hipRoof(mb: MeshBuilder, r: HipOptions) {
  const ov = r.overhang ?? .45, X0 = r.x0 - ov, X1 = r.x1 + ov, Z0 = r.z0 - ov, Z1 = r.z1 + ov, low = r.y - ov * r.pitch;
  const w = X1 - X0, d = Z1 - Z0, half = Math.min(w, d) / 2, top = low + half * r.pitch, slope = Math.hypot(half, top - low);
  const o = { kind: FACE.roof, col: r.roof };
  if (w >= d) {
    const rz = (Z0 + Z1) / 2, a = X0 + half, b = X1 - half;
    mb.quad([[X0, low, Z1], [X1, low, Z1], [b, top, rz], [a, top, rz]], { ...o, uv: [[0, 0], [w, 0], [b - X0, slope], [a - X0, slope]] });
    mb.quad([[X1, low, Z0], [X0, low, Z0], [a, top, rz], [b, top, rz]], { ...o, uv: [[0, 0], [w, 0], [X1 - a, slope], [X1 - b, slope]] });
    mb.tri([[X1, low, Z1], [X1, low, Z0], [b, top, rz]], { ...o, uv: [[0, 0], [d, 0], [d / 2, slope]] });
    mb.tri([[X0, low, Z0], [X0, low, Z1], [a, top, rz]], { ...o, uv: [[0, 0], [d, 0], [d / 2, slope]] });
  } else {
    const rx = (X0 + X1) / 2, a = Z0 + half, b = Z1 - half;
    mb.quad([[X1, low, Z1], [X1, low, Z0], [rx, top, a], [rx, top, b]], { ...o, uv: [[0, 0], [d, 0], [d - (a - Z0), slope], [d - (b - Z0), slope]] });
    mb.quad([[X0, low, Z0], [X0, low, Z1], [rx, top, b], [rx, top, a]], { ...o, uv: [[0, 0], [d, 0], [b - Z0, slope], [a - Z0, slope]] });
    mb.tri([[X0, low, Z1], [X1, low, Z1], [rx, top, b]], { ...o, uv: [[0, 0], [w, 0], [w / 2, slope]] });
    mb.tri([[X1, low, Z0], [X0, low, Z0], [rx, top, a]], { ...o, uv: [[0, 0], [w, 0], [w / 2, slope]] });
  }
  mb.quad([[X0, low - .05, Z0], [X1, low - .05, Z0], [X1, low - .05, Z1], [X0, low - .05, Z1]], { kind: FACE.trim, col: r.soffit ?? rgb("#d6d0c4"), n: [0, -1, 0] });
  return top;
}

export interface PyramidOptions { x0: number; x1: number; z0: number; z1: number; y: number; height: number; col: V3; kind?: Face; win?: [number, number, number, number] }
/**
 * A pyramid on a rectangle: four slopes meeting above its middle. `win` sets the grid a curtain wall draws on the
 * slopes (bay and floor in metres); the wall coordinates run in metres along the base and up the slope. Returns the apex.
 */
export function pyramid(mb: MeshBuilder, r: PyramidOptions): number {
  const { x0, x1, z0, z1, y, height } = r, xm = (x0 + x1) / 2, zm = (z0 + z1) / 2, apex = y + height;
  const o = { kind: r.kind ?? FACE.roof, col: r.col, win: r.win };
  const alongX = Math.hypot(height, (z1 - z0) / 2), alongZ = Math.hypot(height, (x1 - x0) / 2);
  const slope = (run: number, rise: number): [number, number][] => [[0, 0], [run, 0], [run / 2, rise]];
  mb.tri([[x0, y, z1], [x1, y, z1], [xm, apex, zm]], { ...o, uv: slope(x1 - x0, alongX) });
  mb.tri([[x1, y, z1], [x1, y, z0], [xm, apex, zm]], { ...o, uv: slope(z1 - z0, alongZ) });
  mb.tri([[x1, y, z0], [x0, y, z0], [xm, apex, zm]], { ...o, uv: slope(x1 - x0, alongX) });
  mb.tri([[x0, y, z0], [x0, y, z1], [xm, apex, zm]], { ...o, uv: slope(z1 - z0, alongZ) });
  return apex;
}

export interface PrismOptions {
  x?: number; z?: number;
  /** Apothem (centre to the middle of a wall) at the foot and, for a frustum, at the top. */
  r: number; top?: number;
  y0: number; y1: number; sides?: number; kind?: Face; col?: V3;
  /** What its flat roof is (null for none) and in what colour. */
  roof?: Face | null; roofCol?: V3;
  bay?: number; floor?: number; winW?: number; winH?: number; occlude?: boolean;
}
/**
 * A prism of `sides` flat walls round a vertical axis, walls facing ±x and ±z among them, or a frustum when `top` is
 * smaller than `r`, with a flat roof. The wall coordinates run round it in metres, so a grid of windows or panes goes on
 * from wall to wall. Returns the roof's height.
 */
export function prism(mb: MeshBuilder, o: PrismOptions): number {
  const n = o.sides ?? 8, x = o.x ?? 0, z = o.z ?? 0, kind = o.kind ?? FACE.wall, col = o.col ?? WHITE, half = Math.PI / n;
  const corner = (k: number, apothem: number, y: number): V3 => {
    const a = (2 * k - 1) * half, r = apothem / Math.cos(half);
    return [x + Math.sin(a) * r, y, z + Math.cos(a) * r];
  };
  const top = o.top ?? o.r, side = 2 * o.r * Math.tan(half), bays = Math.max(1, Math.round(side / (o.bay ?? 2.8)));
  const win: [number, number, number, number] = [side / bays, o.floor ?? 2.9, o.winW ?? .44, o.winH ?? .48];
  for (let k = 0; k < n; k++) mb.quad([corner(k, o.r, o.y0), corner(k + 1, o.r, o.y0), corner(k + 1, top, o.y1), corner(k, top, o.y1)], { kind, col, u0: k * side, win });
  if (o.roof !== null) for (let k = 0; k < n; k++) {
    const a = corner(k, top, o.y1), b = corner(k + 1, top, o.y1);
    mb.tri([[x, o.y1, z], a, b], { kind: o.roof ?? FACE.deck, col: o.roofCol ?? col, n: [0, 1, 0], uv: [[x, z], [a[0], a[2]], [b[0], b[2]]] });
  }
  if (o.occlude !== false) { const r = o.r / Math.cos(half); mb.occluders.push([x - r, o.y0, z - r, x + r, o.y1, z + r]); }
  return o.y1;
}

/** A low wall round a flat roof. */
export function parapet(mb: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, t: number, col: V3) {
  const o: BoxOptions = { c: .04, kind: FACE.wall, col, top: FACE.trim, topCol: rgb("#d9d6cf") };
  box(mb, [x0, y, z0, x1, y + h, z0 + t], o);
  box(mb, [x0, y, z1 - t, x1, y + h, z1], o);
  box(mb, [x0, y, z0 + t, x0 + t, y + h, z1 - t], o);
  box(mb, [x1 - t, y, z0 + t, x1, y + h, z1 - t], o);
}

// ---- baked occlusion ---------------------------------------------------------------------------------------
const RAYS: V3[] = Array.from({ length: 28 }, (_, i) => {
  const u = (i + .5) / 28, phi = i * 2.399963, r = Math.sqrt(u);
  return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)];
});
function rayBox(o: V3, d: V3, b: readonly number[]) {
  let near = 0, far = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-8) { if (o[a] < b[a] || o[a] > b[a + 3]) return -1; continue; }
    let t0 = (b[a] - o[a]) / d[a], t1 = (b[a + 3] - o[a]) / d[a];
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0); far = Math.min(far, t1);
    if (near > far) return -1;
  }
  return near;
}
/**
 * Occlusion of every vertex by the building's own volumes and the ground within a few metres, into aSurf.w: dark
 * at the foot of the walls, under the eaves and in the corners, as a sky would leave them. Done once per model.
 */
export function bakeOcclusion(mb: MeshBuilder, { reach = 3.6, ground = 3.2, strength = .95 } = {}) {
  for (let v = 0; v < mb.count; v++) {
    const n = unit([mb.n[v * 3], mb.n[v * 3 + 1], mb.n[v * 3 + 2]]), o: V3 = [mb.p[v * 3] + n[0] * .05, mb.p[v * 3 + 1] + n[1] * .05, mb.p[v * 3 + 2] + n[2] * .05];
    const tangent = unit(cross(Math.abs(n[1]) > .9 ? [1, 0, 0] : [0, 1, 0], n)), bitangent = cross(n, tangent);
    let hidden = 0;
    for (const r of RAYS) {
      const d: V3 = [tangent[0] * r[0] + bitangent[0] * r[1] + n[0] * r[2], tangent[1] * r[0] + bitangent[1] * r[1] + n[1] * r[2], tangent[2] * r[0] + bitangent[2] * r[1] + n[2] * r[2]];
      let hit = 0;
      for (const b of mb.occluders) { const t = rayBox(o, d, b); if (t >= 0 && t < reach) hit = Math.max(hit, 1 - t / reach); }
      if (d[1] < -1e-4 && o[1] > 0) { const t = -o[1] / d[1]; if (t < ground) hit = Math.max(hit, 1 - t / ground); }
      hidden += hit;
    }
    mb.s[v * 4 + 3] = Math.min(1, Math.max(.22, 1 - strength * hidden / RAYS.length));
  }
}

// ---- the material ------------------------------------------------------------------------------------------
type Node = ReturnType<typeof float>;
/** sRGB to linear for a colour written as 0…1 numbers. */
const lin = (r: number, g: number, b: number) => vec3(...new THREE.Color(r, g, b).convertSRGBToLinear().toArray() as V3);

/**
 * The facade material of every procedural building, for the instance pools (render/copies.ts): its colour comes from
 * the vertices (walls in their finish, roofs, trim), its detail from aSurf/aWin, its windows light up with `night`.
 * Which windows are lit, have a blind or a lighter pane is fixed per building by its position, so a building keeps
 * its pattern and its neighbour has another; the hash only ever sees whole numbers, so the pattern never sparkles.
 */
export function facadeMaterial(night: Node): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .85, metalness: 0 });
  const surf = attribute("aSurf", "vec4"), win = attribute("aWin", "vec4"), base = vertexColor().xyz;
  const kind = surf.z, occlusion = surf.w;
  const is = (k: number) => float(1).sub(kind.sub(k).abs()).clamp(0, 1);
  // Per building: its place (the copy's translation), cut to whole numbers.
  const place = attribute("copyMatrix3", "vec4");
  const seed = floor(fract(place.x.mul(.0173).add(place.z.mul(.0291)).add(.5)).mul(997));
  const pick = (a: Node, b: Node, salt: number) => hash(a.mul(37).add(b.mul(113)).add(seed.mul(7)).add(salt));

  // Windows in a wall: the grid of bays and floors, frame, sill, glass, lit at night.
  const q = surf.xy.div(win.xy), cell = floor(q), f = fract(q);
  const aa = max(fwidth(q.x), fwidth(q.y));
  const half = win.zw.mul(.5), d = abs(f.sub(vec2(.5, .57))).sub(half), sd = max(d.x, d.y), soft = aa.mul(1.2);
  const above = smoothstep(.35, .55, surf.y);
  const pane = smoothstep(soft.negate(), soft, sd).oneMinus().mul(above);
  const frame = smoothstep(soft.negate(), soft, sd.sub(.05)).oneMinus().mul(above).sub(pane).max(0);
  const sill = smoothstep(soft.negate(), soft, max(abs(f.x.sub(.5)).sub(half.x).sub(.05), abs(f.y.sub(float(.545).sub(half.y))).sub(.022))).oneMinus().mul(above);
  const blind = step(.8, pick(cell.x, cell.y, 3));
  const sky = smoothstep(0, 1, f.y.sub(float(.57).sub(half.y)).div(half.y.mul(2)));
  const glass = mix(mix(lin(.16, .22, .29), lin(.05, .07, .09), pick(cell.x, cell.y, 1).mul(.8)).add(lin(.45, .58, .72).mul(sky.mul(.22))), lin(.78, .74, .66), blind.mul(.75));
  const lit = step(.58, pick(cell.x, cell.y, 5)), warm = mix(vec3(1, .66, .3), vec3(.78, .86, 1), step(.82, pick(cell.x, cell.y, 9)));
  const far = smoothstep(.2, .6, aa), cover = win.z.mul(win.w);
  const windowWall = mix(mix(mix(base, glass, pane), lin(.95, .95, .93), frame.mul(.95)), lin(.82, .8, .76), sill.mul(pane.oneMinus()));
  const windowColour = mix(windowWall, mix(base, lin(.12, .16, .2), cover.mul(1.15)), far);
  const windowGlow = mix(warm.mul(lit).mul(pane).mul(blind.mul(.5).oneMinus()), vec3(1, .7, .36).mul(cover.mul(.42)), far).mul(night).mul(.62);
  const windowRough = mix(mix(.88, .14, pane), .6, far);

  // Curtain walls: mullions, a spandrel at every floor, tinted glass by floor, lit floors at night. Mirror glass has the
  // same panes in a thin dark grid, with thin transoms and a stronger sky in every pane.
  const spire = is(FACE.spire), mirror = is(FACE.mirror).add(spire), curtain = is(FACE.curtain).add(mirror);
  const mullionHalf = mix(.035, .022, mirror), band = mix(.24, .09, mirror);
  const mullion = smoothstep(mullionHalf, aa.add(mullionHalf), min(f.x, f.x.oneMinus())).oneMinus();
  const spandrel = smoothstep(0, aa, f.y).mul(smoothstep(band, aa.add(band), f.y).oneMinus());
  const solid = max(mullion, spandrel.mul(.92));
  const shade = pick(float(0), cell.y, 11).mul(.6).add(.2);
  // The city lights glass without an environment map (TZ §6.3): the tint and a sky gradient up each pane stand in for it.
  const tinted = base.mul(mix(.55, 1, shade)).mul(mix(.6, .98, mirror)).add(lin(.55, .66, .78).mul(smoothstep(.15, 1, f.y).mul(mix(.16, .34, mirror))));
  const grid = mix(lin(.62, .64, .66).mul(.85), lin(.025, .03, .04), mirror);
  const curtainColour = mix(mix(tinted, grid, solid), mix(tinted, grid, .3), far);
  const curtainGlow = mix(vec3(1, .74, .42).mul(step(.6, pick(cell.x, cell.y, 13))).mul(solid.oneMinus()), vec3(1, .74, .42).mul(.28), far).mul(night).mul(.6);
  const glazed = mix(solid.oneMinus(), .7, far);

  // Roof tiles in rows along the slope; flat decks in gravel.
  const row = surf.y.div(.45), tile = hash(floor(surf.x.div(.32).add(floor(row).mul(.5))).add(floor(row).mul(57)).add(seed));
  const seam = smoothstep(0, fwidth(row).mul(1.4).add(.07), fract(row)).oneMinus().mul(smoothstep(.05, .35, fwidth(surf.y)).oneMinus());
  const roof = base.mul(mix(.86, 1.06, tile)).mul(seam.mul(.28).oneMinus());
  const grit = texture(groundNoise(), positionWorld.xz.div(3)).z;
  const deck = lin(.34, .35, .36).mul(mix(.8, 1.15, grit));

  const colour = windowColour.mul(is(FACE.window)).add(base.mul(is(FACE.wall))).add(roof.mul(is(FACE.roof))).add(deck.mul(is(FACE.deck)))
    .add(base.mul(is(FACE.trim))).add(curtainColour.mul(curtain)).add(base.mul(is(FACE.light))).add(lin(.05, .07, .09).mul(is(FACE.glass)));
  material.colorNode = vec4(colour.mul(mix(1, occlusion, .32)), 1);
  material.emissiveNode = windowGlow.mul(is(FACE.window)).add(curtainGlow.mul(curtain).mul(spire.oneMinus())).add(base.mul(night.mul(1.6).add(.4)).mul(is(FACE.light)));
  material.roughnessNode = windowRough.mul(is(FACE.window)).add(float(.88).mul(is(FACE.wall))).add(float(.82).mul(is(FACE.roof))).add(float(.95).mul(is(FACE.deck)))
    .add(float(.7).mul(is(FACE.trim))).add(mix(.55, .22, glazed).mul(curtain)).add(float(.5).mul(is(FACE.light))).add(float(.08).mul(is(FACE.glass)));
  material.metalnessNode = mix(.05, .15, glazed).mul(curtain).add(float(.5).mul(is(FACE.glass))).add(pane.mul(.2).mul(far.oneMinus()).mul(is(FACE.window)));
  material.aoNode = occlusion;
  return material;
}
