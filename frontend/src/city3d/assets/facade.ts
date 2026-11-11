/**
 * Procedural buildings of city v4 (docs/CITY_V4.md, stage 2): a mesh builder for chamfered boxes, gable, hip and
 * pyramid roofs, parapets, cylinders, cones, domes, spheres, tori and arches, ambient occlusion baked into the
 * vertices, and the facade material that draws the detail polygons would otherwise carry: windows with frames and
 * sills, curtain walls with mullions, roof tiles, gravel decks, foliage.
 *
 * Every vertex carries `aSurf` (u and v in metres along its wall, the surface kind, baked occlusion) and `aWin` (bay
 * width and floor height in metres, window width and height as shares of them). A model exists once, at one level of
 * detail: where a bay shrinks to a few pixels the material fades its windows into their average, so a building looks
 * the same near and far, without a far copy and without a moiré.
 *
 * Two kinds of model: those drawn in metres and placed at one scale (the ready houses, the landmarks), and unit models
 * stretched to every copy's size (sections, cottages, office towers): those are drawn at a nominal size and keep, per
 * vertex, which way their wall coordinates run (`aUnitU`, `aUnitV`), so the material measures them in metres on the
 * stretched copy and fits a whole number of bays into every wall, whatever its width.
 */
import * as THREE from "three/webgpu";
import { abs, attribute, cameraPosition, dot, float, floor, fract, fwidth, hash, max, min, mix, normalView, normalWorld, positionWorld, pow, reflect, round, smoothstep, step, varying, varyingProperty, vec2, vec3, vec4, vertexColor } from "three/tsl";
import { skyGradient, type SkyLook } from "../render/sky";

/**
 * Surface kinds, kept in aSurf.z. `pane` is a single piece of glass (an arched window, a glass vault or dome) that is
 * lit at night or not by its own number in aWin.x (0…1, a step of 1/16), so it never flickers. `mirror` is a curtain
 * wall of reflective glass in a thin dark grid; `spire` is the same glass on a roof, whose panes never light up at night.
 */
export const FACE = { window: 0, wall: 1, roof: 2, deck: 3, trim: 4, curtain: 5, light: 6, metal: 7, glass: 8, leaf: 9, pane: 10, mirror: 11, spire: 12 } as const;
export type Face = typeof FACE[keyof typeof FACE];
export type V3 = [number, number, number];
/** A colour as linear RGB, from an sRGB hex. */
export const rgb = (hex: string): V3 => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
/** Metres in one world unit: a section floor (0.75) is 3 m, a ready house's table unit times its scale is 5.4 m. */
export const WORLD_METRES = 4;
/** The top of the land the copies stand on (assets/catalogue.ts GROUND): floors are counted from it. */
const WORLD_GROUND = .2;
const WHITE: V3 = [1, 1, 1];
const NO_WINDOWS: [number, number, number, number] = [99, 99, 0, 0];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** `u0` and `v0` shift the wall coordinates (a whole number of bays leaves the windows where they are, but lights others). */
export interface FaceOptions {
  kind: Face; col?: V3; n?: V3; ns?: V3[]; uv?: [number, number][]; u0?: number; v0?: number; win?: [number, number, number, number];
  /** Unit models: a door in the middle bay of this wall's ground floor; shop windows along its ground floor. */
  door?: boolean; shops?: boolean;
}

/**
 * How far a point moves for one unit of u and one of v over a triangle (its tangent and bitangent, not normalised):
 * the wall coordinates are metres, so for a face drawn true to size both are a metre long. A unit model keeps them
 * (in unit space) for the material to measure u and v on a stretched copy.
 */
function gradients(p0: V3, p1: V3, p2: V3, t0: [number, number], t1: [number, number], t2: [number, number]): [V3, V3] {
  const e1 = sub(p1, p0), e2 = sub(p2, p0), du1 = t1[0] - t0[0], dv1 = t1[1] - t0[1], du2 = t2[0] - t0[0], dv2 = t2[1] - t0[1];
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-9) return [unit(e1), unit(e2)];
  const r = 1 / det;
  return [[(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r],
    [(e2[0] * du1 - e1[0] * du2) * r, (e2[1] * du1 - e1[1] * du2) * r, (e2[2] * du1 - e1[2] * du2) * r]];
}

export class MeshBuilder {
  readonly p: number[] = []; readonly n: number[] = []; readonly c: number[] = []; readonly s: number[] = []; readonly w: number[] = []; readonly i: number[] = [];
  /** Per vertex, for unit models: the direction u runs along and its wall's run, the direction v runs along and whether v is the height. */
  readonly d: number[] = [];
  /** Boxes that shade the vertices near them (bakeOcclusion). */
  readonly occluders: [number, number, number, number, number, number][] = [];
  /** Per vertex: 1 where bakeOcclusion traces the volumes round it, 0 on small parts (only the ground shades them). */
  readonly fine: number[] = [];
  private small = 0;
  /** The frame parts are drawn in (frame()), and its normal matrix; null for the model's own frame. */
  private m: THREE.Matrix4 | null = null; private nm = new THREE.Matrix3();
  private readonly frames: (THREE.Matrix4 | null)[] = [];
  get count() { return this.p.length / 3; }
  private vertex(p: V3, n: V3, col: V3, kind: number, u: number, v: number, win: readonly number[], du: V3, run: number, dv: V3, ground = 0) {
    let px = p[0], py = p[1], pz = p[2], nx = n[0], ny = n[1], nz = n[2], ax = du[0], ay = du[1], az = du[2], bx = dv[0], by = dv[1], bz = dv[2];
    if (this.m) {
      const e = this.m.elements, t = this.nm.elements;
      const qx = e[0] * px + e[4] * py + e[8] * pz + e[12], qy = e[1] * px + e[5] * py + e[9] * pz + e[13], qz = e[2] * px + e[6] * py + e[10] * pz + e[14];
      const mx = t[0] * nx + t[3] * ny + t[6] * nz, my = t[1] * nx + t[4] * ny + t[7] * nz, mz = t[2] * nx + t[5] * ny + t[8] * nz;
      const ux = e[0] * ax + e[4] * ay + e[8] * az, uy = e[1] * ax + e[5] * ay + e[9] * az, uz = e[2] * ax + e[6] * ay + e[10] * az;
      const wx = e[0] * bx + e[4] * by + e[8] * bz, wy = e[1] * bx + e[5] * by + e[9] * bz, wz = e[2] * bx + e[6] * by + e[10] * bz;
      const ln = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
      px = qx; py = qy; pz = qz; nx = mx / ln; ny = my / ln; nz = mz / ln; ax = ux; ay = uy; az = uz; bx = wx; by = wy; bz = wz;
    }
    this.p.push(px, py, pz); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); this.s.push(u, v, kind, 1); this.w.push(win[0], win[1], win[2], win[3]); this.fine.push(this.small ? 0 : 1);
    // Walls count v from the ground (floors line up on a stretched copy); roofs and decks measure it on themselves.
    const upright = Math.abs(ny) < .5 && kind !== FACE.roof && kind !== FACE.deck;
    this.d.push(ax, ay, az, run, bx, by, bz, upright ? 1 + ground : 0);
    return this.count - 1;
  }
  /**
   * Draws `draw` in another frame: its origin and its x, y and z axes in the current one (unit vectors turn, longer
   * ones scale). Occluders boxes drawn there add their bounds in the model's frame.
   */
  frame(origin: V3, x: V3, y: V3, z: V3, draw: () => void) {
    const local = new THREE.Matrix4().set(x[0], y[0], z[0], origin[0], x[1], y[1], z[1], origin[1], x[2], y[2], z[2], origin[2], 0, 0, 0, 1);
    this.frames.push(this.m);
    this.m = this.m ? this.m.clone().multiply(local) : local;
    this.nm.getNormalMatrix(this.m);
    try { draw(); } finally {
      this.m = this.frames.pop() ?? null;
      if (this.m) this.nm.getNormalMatrix(this.m);
    }
  }
  /** Draws small parts (rods, rails, flags, lamps): occlusion leaves their surroundings out, which saves most of its time. */
  detail(draw: () => void) { this.small++; try { draw(); } finally { this.small--; } }
  /** Draws `draw` turned by `angle` about the vertical through (x, z). */
  turned(x: number, z: number, angle: number, draw: () => void) {
    const c = Math.cos(angle), s = Math.sin(angle);
    this.frame([x, 0, z], [c, 0, -s], [0, 1, 0], [s, 0, c], draw);
  }
  /** Adds an occluder, in the model's frame when a frame is current. */
  occlude(b: [number, number, number, number, number, number]) {
    if (!this.m) { this.occluders.push(b); return; }
    const box = new THREE.Box3(), v = new THREE.Vector3();
    for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) box.expandByPoint(v.set(x, y, z).applyMatrix4(this.m));
    this.occluders.push([box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]);
  }
  /** A quad, corners counter-clockwise seen from outside; u runs along the first edge, v is the height. */
  quad(points: V3[], o: FaceOptions) {
    const normal = o.n ?? unit(cross(sub(points[1], points[0]), sub(points[3], points[0])));
    const normals = o.ns ?? [normal, normal, normal, normal], run = length(sub(points[1], points[0])), u0 = o.u0 ?? 0, v0 = o.v0 ?? 0;
    const uv = o.uv ?? [[u0, points[0][1] + v0], [u0 + run, points[1][1] + v0], [u0 + run, points[2][1] + v0], [u0, points[3][1] + v0]];
    const [du, dv] = gradients(points[0], points[1], points[3], uv[0], uv[1], uv[3]);
    const ground = (o.door ? 1 : 0) + (o.shops ? 2 : 0);
    const id = points.map((p, k) => this.vertex(p, normals[k], o.col ?? WHITE, o.kind, uv[k][0], uv[k][1], o.win ?? NO_WINDOWS, du, run, dv, ground));
    this.i.push(id[0], id[1], id[2], id[0], id[2], id[3]);
  }
  tri(points: V3[], o: FaceOptions) {
    const normal = o.n ?? unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
    const normals = o.ns ?? [normal, normal, normal], uv = o.uv ?? [[0, points[0][1]], [1, points[1][1]], [.5, points[2][1]]];
    const [du, dv] = gradients(points[0], points[1], points[2], uv[0], uv[1], uv[2]), run = length(sub(points[1], points[0]));
    const id = points.map((p, k) => this.vertex(p, normals[k], o.col ?? WHITE, o.kind, uv[k][0], uv[k][1], o.win ?? NO_WINDOWS, du, run, dv));
    this.i.push(id[0], id[1], id[2]);
  }
  /**
   * The geometry in the model's units: metres times `unitsPerMetre`, in the frame it was drawn in (centred on its
   * footprint, standing on y = 0, facing +z). The wall coordinates stay in metres, so windows keep their size.
   *
   * With `unit` [width, height, depth] in metres, a unit model: x and z in ±0.5 and y in 0…1 (the model drawn
   * centred on that box, from y = 0), its wall coordinates still in nominal metres, and `aUnitU`/`aUnitV` for the
   * material to measure them on a stretched copy (facadeMaterial `unit`).
   */
  build(unitsPerMetre: number | { unit: V3 }): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry(), count = this.count;
    const scale: V3 = typeof unitsPerMetre === "number" ? [unitsPerMetre, unitsPerMetre, unitsPerMetre] : [1 / unitsPerMetre.unit[0], 1 / unitsPerMetre.unit[1], 1 / unitsPerMetre.unit[2]];
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) for (let a = 0; a < 3; a++) positions[v * 3 + a] = this.p[v * 3 + a] * scale[a];
    for (let v = 0; v < count; v++) {
      // Normals of a stretched model lean the other way: divided by the stretch.
      const n = unit([this.n[v * 3] / scale[0], this.n[v * 3 + 1] / scale[1], this.n[v * 3 + 2] / scale[2]]);
      normals.set(n, v * 3);
    }
    if (typeof unitsPerMetre === "number") {
      g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
      g.setAttribute("aSurf", new THREE.Float32BufferAttribute(this.s, 4));
      g.setAttribute("aWin", new THREE.Float32BufferAttribute(this.w, 4));
    } else {
      // A unit model is drawn as copies, whose matrices and tints take two vertex buffers more: its seven attributes
      // go in one interleaved buffer, so a copy binds three (WebGPU allows eight). The step of one unit of u (and v),
      // in nominal metres, is kept in unit space; the copy's matrix tells how long it is in the world.
      const STRIDE = 25, data = new Float32Array(count * STRIDE);
      for (let v = 0; v < count; v++) {
        const o = v * STRIDE, d = this.d;
        data.set(positions.subarray(v * 3, v * 3 + 3), o); data.set(normals.subarray(v * 3, v * 3 + 3), o + 3);
        data[o + 6] = this.c[v * 3]; data[o + 7] = this.c[v * 3 + 1]; data[o + 8] = this.c[v * 3 + 2];
        for (let k = 0; k < 4; k++) { data[o + 9 + k] = this.s[v * 4 + k]; data[o + 13 + k] = this.w[v * 4 + k]; }
        data[o + 17] = d[v * 8] * scale[0]; data[o + 18] = d[v * 8 + 1] * scale[1]; data[o + 19] = d[v * 8 + 2] * scale[2]; data[o + 20] = d[v * 8 + 3];
        data[o + 21] = d[v * 8 + 4] * scale[0]; data[o + 22] = d[v * 8 + 5] * scale[1]; data[o + 23] = d[v * 8 + 6] * scale[2]; data[o + 24] = d[v * 8 + 7];
      }
      const buffer = new THREE.InterleavedBuffer(data, STRIDE);
      for (const [name, size, offset] of [["position", 3, 0], ["normal", 3, 3], ["color", 3, 6], ["aSurf", 4, 9], ["aWin", 4, 13], ["aUnitU", 4, 17], ["aUnitV", 4, 21]] as const)
        g.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
    }
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
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
  /** Also closes the bottom (a box seen from below: a canopy, a bridge, a raised floor). */
  bottom?: boolean;
  /** Shifts every wall's windows by whole bays (wall k by shift × (k + 1)), so walls of one building light differently. */
  shift?: number;
  /** Added to the walls' v, metres: moves the floors' grid up or down (a ribbon of glass with no spandrel in it). */
  v0?: number;
  /** Unit models: walls with a door in the middle of their ground floor, walls with shop windows along it. */
  door?: ("+z" | "-z" | "+x" | "-x")[]; shops?: ("+z" | "-z" | "+x" | "-x")[];
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
  // Without a chamfer, a plain box: 10 or 12 triangles for the small parts (rods, rails, slats).
  if (c <= 1e-4) {
    const wall = (key: string, run: number, n: V3, k: number): FaceOptions => ({ kind, col, n, win: [bays(run, key), floorH, ww, wh], u0: (o.shift ?? 0) * (k + 1) * bays(run, key), v0: o.v0, door: o.door?.includes(key as "+z"), shops: o.shops?.includes(key as "+z") });
    if (faces.includes("+z")) mb.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], wall("+z", x1 - x0, [0, 0, 1], 0));
    if (faces.includes("-z")) mb.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], wall("-z", x1 - x0, [0, 0, -1], 1));
    if (faces.includes("+x")) mb.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], wall("+x", z1 - z0, [1, 0, 0], 2));
    if (faces.includes("-x")) mb.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], wall("-x", z1 - z0, [-1, 0, 0], 3));
    if (!o.noTop) mb.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], { kind: o.top ?? FACE.deck, col: o.topCol ?? col, n: [0, 1, 0], uv: [[x0, z1], [x1, z1], [x1, z0], [x0, z0]] });
    if (o.bottom) mb.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], { kind: edgeKind, col: edgeCol, n: [0, -1, 0], uv: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] });
    if (o.occlude !== false) mb.occlude([x0, y0, z0, x1, y1, z1]);
    return;
  }
  const xi0 = x0 + c, xi1 = x1 - c, zi0 = z0 + c, zi1 = z1 - c, yt = y1 - c;
  const order = ["+z", "-z", "+x", "-x"];
  const wall = (key: string, run: number, n: V3): FaceOptions => ({ kind, col, n, win: [bays(run, key), floorH, ww, wh], u0: (o.shift ?? 0) * (order.indexOf(key) + 1) * bays(run, key), v0: o.v0, door: o.door?.includes(key as "+z"), shops: o.shops?.includes(key as "+z") });
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
  if (o.bottom) mb.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], { kind: edgeKind, col: edgeCol, n: [0, -1, 0], uv: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] });
  if (o.occlude !== false) mb.occlude([x0, y0, z0, x1, y1, z1]);
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

/** A low wall round a flat roof. */
export function parapet(mb: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, t: number, col: V3) {
  const o: BoxOptions = { c: .04, kind: FACE.wall, col, top: FACE.trim, topCol: rgb("#d9d6cf") };
  box(mb, [x0, y, z0, x1, y + h, z0 + t], o);
  box(mb, [x0, y, z1 - t, x1, y + h, z1], o);
  box(mb, [x0, y, z0 + t, x0 + t, y + h, z1 - t], o);
  box(mb, [x1 - t, y, z0 + t, x1, y + h, z1 - t], o);
}

// ---- round and pitched shapes -------------------------------------------------------------------------------
/** A point on an elliptic circle of radius r about (x, z): angle 0 is the front (+z), growing towards +x. */
const around = (x: number, z: number, r: number, a: number, sx: number, sz: number, y: number): V3 => [x + r * Math.sin(a) * sx, y, z + r * Math.cos(a) * sz];

export interface CylinderOptions {
  x: number; z: number; y0: number; y1: number;
  /** Radius at the bottom, and at the top (a cone or a frustum; 0 for a point). */
  r: number; r1?: number;
  /** An elliptic plan: the radius times sx along x and sz along z. */
  sx?: number; sz?: number;
  seg?: number; kind?: Face; col?: V3;
  /** The top's kind, or null for an open top; the bottom is closed only with `bottom`. */
  top?: Face | null; topCol?: V3; bottom?: boolean;
  /** Windows round it, as on a box: a whole number of bays fits the circumference. */
  bay?: number; floor?: number; winW?: number; winH?: number;
  /** A part of the circle, radians (0 is the front, π/2 the right). */
  a0?: number; a1?: number;
  occlude?: boolean;
}
/**
 * A cylinder, a frustum or a cone standing on y0, smooth round its side. Walls take u round the circumference and v
 * the height, so windows wrap seamlessly; roofs take v up the slope, so tiles run in rows from the eaves.
 */
export function cylinder(mb: MeshBuilder, o: CylinderOptions) {
  const seg = o.seg ?? 16, r0 = o.r, r1 = o.r1 ?? o.r, sx = o.sx ?? 1, sz = o.sz ?? 1, { x, z, y0, y1 } = o;
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI * 2, kind = o.kind ?? FACE.wall, col = o.col ?? WHITE;
  const h = y1 - y0, lean = (r0 - r1) / Math.max(h, 1e-6), mean = (sx + sz) / 2;
  const circumference = (r0 + r1) / 2 * mean * (a1 - a0), slope = Math.hypot(h, (r0 - r1) * mean);
  const bays = Math.max(1, Math.round(circumference / (o.bay ?? 2.8)));
  const win: [number, number, number, number] = kind === FACE.window || kind === FACE.curtain ? [circumference / bays, o.floor ?? 2.9, o.winW ?? .44, o.winH ?? .48] : NO_WINDOWS;
  const normal = (a: number): V3 => unit([Math.sin(a) / sx, lean / mean, Math.cos(a) / sz]);
  // Roofs: v up the slope and tiles narrowing to the top; walls: v the height and bays straight up.
  const pitched = kind === FACE.roof, taper = pitched ? r1 / r0 : 1;
  const vb = pitched ? 0 : y0, vt = pitched ? slope : y1;
  for (let i = 0; i < seg; i++) {
    const t0 = a0 + (a1 - a0) * i / seg, t1 = a0 + (a1 - a0) * (i + 1) / seg, u0 = circumference * i / seg, u1 = circumference * (i + 1) / seg;
    if (r1 > 1e-6) mb.quad([around(x, z, r0, t0, sx, sz, y0), around(x, z, r0, t1, sx, sz, y0), around(x, z, r1, t1, sx, sz, y1), around(x, z, r1, t0, sx, sz, y1)],
      { kind, col, win, ns: [normal(t0), normal(t1), normal(t1), normal(t0)], uv: [[u0, vb], [u1, vb], [u1 * taper, vt], [u0 * taper, vt]] });
    else mb.tri([around(x, z, r0, t0, sx, sz, y0), around(x, z, r0, t1, sx, sz, y0), [x, y1, z]],
      { kind, col, win, ns: [normal(t0), normal(t1), normal((t0 + t1) / 2)], uv: [[u0, vb], [u1, vb], [(u0 + u1) / 2, vt]] });
  }
  const cap = (y: number, r: number, up: boolean, capKind: Face, capCol: V3) => {
    for (let i = 0; i < seg; i++) {
      const t0 = a0 + (a1 - a0) * i / seg, t1 = a0 + (a1 - a0) * (i + 1) / seg, p = around(x, z, r, t0, sx, sz, y), q = around(x, z, r, t1, sx, sz, y), c: V3 = [x, y, z];
      const uv: [number, number][] = up ? [[x, z], [p[0], p[2]], [q[0], q[2]]] : [[x, z], [q[0], q[2]], [p[0], p[2]]];
      mb.tri(up ? [c, p, q] : [c, q, p], { kind: capKind, col: capCol, n: [0, up ? 1 : -1, 0], uv });
    }
  };
  if (o.top !== null && r1 > 1e-6) cap(y1, r1, true, o.top ?? FACE.deck, o.topCol ?? col);
  if (o.bottom) cap(y0, r0, false, kind === FACE.window || kind === FACE.curtain ? FACE.wall : kind, col);
  if (o.occlude !== false && h > .05) { const r = Math.max(r0, r1) * .8; mb.occlude([x - r * sx, y0, z - r * sz, x + r * sx, y1, z + r * sz]); }
}

export interface DomeOptions { x: number; z: number; y0: number; r: number; rise?: number; sx?: number; sz?: number; seg?: number; rings?: number; kind?: Face; col?: V3; from?: number; occlude?: boolean }
/**
 * A dome on y0: an upper half ellipsoid r across and `rise` high, smooth, in rings from the base (latitude `from`,
 * radians, 0 at the base) to the crown. Its u runs round each ring, v up the meridian, for ribs and tiles.
 */
export function dome(mb: MeshBuilder, o: DomeOptions) {
  const seg = o.seg ?? 20, rings = o.rings ?? 6, rise = o.rise ?? o.r, sx = o.sx ?? 1, sz = o.sz ?? 1, { x, z, y0, r } = o;
  const kind = o.kind ?? FACE.roof, col = o.col ?? WHITE, from = o.from ?? 0;
  const at = (a: number, t: number) => around(x, z, r * Math.cos(t), a, sx, sz, y0 + rise * Math.sin(t));
  const normal = (a: number, t: number): V3 => unit([Math.cos(t) * Math.sin(a) / (r * sx), Math.sin(t) / rise, Math.cos(t) * Math.cos(a) / (r * sz)]);
  const meridian = (t: number) => t * (r + rise) / 2, ring = (t: number) => r * Math.cos(t) * (sx + sz) / 2;
  for (let j = 0; j < rings; j++) {
    const ta = from + (Math.PI / 2 - from) * j / rings, tb = from + (Math.PI / 2 - from) * (j + 1) / rings;
    for (let i = 0; i < seg; i++) {
      const a0 = Math.PI * 2 * i / seg, a1 = Math.PI * 2 * (i + 1) / seg;
      if (j < rings - 1) mb.quad([at(a0, ta), at(a1, ta), at(a1, tb), at(a0, tb)], { kind, col, ns: [normal(a0, ta), normal(a1, ta), normal(a1, tb), normal(a0, tb)],
        uv: [[ring(ta) * a0, meridian(ta)], [ring(ta) * a1, meridian(ta)], [ring(tb) * a1, meridian(tb)], [ring(tb) * a0, meridian(tb)]] });
      else mb.tri([at(a0, ta), at(a1, ta), [x, y0 + rise, z]], { kind, col, ns: [normal(a0, ta), normal(a1, ta), [0, 1, 0]],
        uv: [[ring(ta) * a0, meridian(ta)], [ring(ta) * a1, meridian(ta)], [ring(ta) * (a0 + a1) / 2, meridian(Math.PI / 2)]] });
    }
  }
  if (o.occlude !== false) { const k = .7; mb.occlude([x - r * sx * k, y0, z - r * sz * k, x + r * sx * k, y0 + rise * k, z + r * sz * k]); }
}

/** A ball (an ellipsoid r across and `rise` half high) about (x, y, z). */
export function sphere(mb: MeshBuilder, o: { x: number; y: number; z: number; r: number; rise?: number; sx?: number; sz?: number; seg?: number; rings?: number; kind?: Face; col?: V3; occlude?: boolean }) {
  const rise = o.rise ?? o.r, seg = o.seg ?? 12, rings = o.rings ?? 4;
  dome(mb, { ...o, y0: o.y, rise, seg, rings, occlude: false });
  // The lower half: the dome drawn upside down in a mirrored frame, its triangles turned back outwards.
  mb.frame([0, 2 * o.y, 0], [1, 0, 0], [0, -1, 0], [0, 0, 1], () => {
    const start = mb.i.length;
    dome(mb, { ...o, y0: o.y, rise, seg, rings, occlude: false });
    for (let k = start; k < mb.i.length; k += 3) { const t = mb.i[k + 1]; mb.i[k + 1] = mb.i[k + 2]; mb.i[k + 2] = t; }
  });
  if (o.occlude) mb.occlude([o.x - o.r * .7, o.y - rise * .7, o.z - o.r * .7, o.x + o.r * .7, o.y + rise * .7, o.z + o.r * .7]);
}

/** A torus about (x, y, z) in the horizontal plane: R to the middle of the tube, r the tube; `arc` < 2π for a part of it. */
export function torus(mb: MeshBuilder, o: { x: number; y: number; z: number; R: number; r: number; seg?: number; tube?: number; arc?: number; start?: number; kind?: Face; col?: V3 }) {
  const seg = o.seg ?? 24, tube = o.tube ?? 6, arc = o.arc ?? Math.PI * 2, start = o.start ?? 0, kind = o.kind ?? FACE.trim, col = o.col ?? WHITE;
  const at = (a: number, b: number): V3 => [o.x + (o.R + o.r * Math.cos(b)) * Math.sin(a), o.y + o.r * Math.sin(b), o.z + (o.R + o.r * Math.cos(b)) * Math.cos(a)];
  const normal = (a: number, b: number): V3 => [Math.cos(b) * Math.sin(a), Math.sin(b), Math.cos(b) * Math.cos(a)];
  for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) {
    const a0 = start + arc * i / seg, a1 = start + arc * (i + 1) / seg, b0 = Math.PI * 2 * j / tube, b1 = Math.PI * 2 * (j + 1) / tube;
    mb.quad([at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)], { kind, col, ns: [normal(a0, b0), normal(a1, b0), normal(a1, b1), normal(a0, b1)], uv: [[o.R * a0, b0 * o.r], [o.R * a1, b0 * o.r], [o.R * a1, b1 * o.r], [o.R * a0, b1 * o.r]] });
  }
}

/** A plan: points in x and z, either way round, every one seen from its middle (a convex or gently curved outline). */
export type Plan = [number, number][];
/** The plan going clockwise seen from above (the way the walls of a box go round), and its middle. */
function clockwise(plan: Plan): { ring: Plan; mid: [number, number] } {
  let area = 0;
  for (let i = 0; i < plan.length; i++) { const [x0, z0] = plan[i], [x1, z1] = plan[(i + 1) % plan.length]; area += x0 * z1 - x1 * z0; }
  const mid: [number, number] = [plan.reduce((a, p) => a + p[0], 0) / plan.length, plan.reduce((a, p) => a + p[1], 0) / plan.length];
  return { ring: area > 0 ? [...plan].reverse() : plan, mid };
}
export interface ExtrudeOptions {
  kind?: Face; col?: V3;
  /** The roof's kind (null for none) and colour. */
  top?: Face | null; topCol?: V3;
  bay?: number; floor?: number; winW?: number; winH?: number; occlude?: boolean;
}
/**
 * A prism over a plan from y0 to y1: a wall on every edge, the wall coordinates running round it in metres (so windows go
 * on from wall to wall, a whole number of bays on each), and a flat roof.
 */
export function extrude(mb: MeshBuilder, plan: Plan, y0: number, y1: number, o: ExtrudeOptions = {}) {
  const { ring, mid } = clockwise(plan), kind = o.kind ?? FACE.wall, col = o.col ?? WHITE, target = o.bay ?? 2.8;
  let u = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], run = Math.hypot(bx - ax, bz - az);
    if (run < 1e-6) continue;
    const win: [number, number, number, number] = [run / Math.max(1, Math.round(run / target)), o.floor ?? 2.9, o.winW ?? .44, o.winH ?? .48];
    mb.quad([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], { kind, col, u0: u, win });
    u += run;
  }
  if (o.top !== null) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    mb.tri([[mid[0], y1, mid[1]], [a[0], y1, a[1]], [b[0], y1, b[1]]], { kind: o.top ?? FACE.deck, col: o.topCol ?? col, n: [0, 1, 0], uv: [mid, a, b] });
  }
  if (o.occlude !== false) {
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
    mb.occlude([Math.min(...xs), y0, Math.min(...zs), Math.max(...xs), y1, Math.max(...zs)]);
  }
}
/**
 * A tent roof over a plan: a slope from every edge at y up to one apex over its middle. The wall coordinates run along
 * the eaves and up the slope in metres, so `win` draws a grid of panes or a curtain wall's mullions on it.
 */
export function tent(mb: MeshBuilder, plan: Plan, y: number, apex: number, o: { kind?: Face; col?: V3; win?: [number, number, number, number] } = {}) {
  const { ring, mid } = clockwise(plan), top: V3 = [mid[0], apex, mid[1]];
  for (let i = 0; i < ring.length; i++) {
    const a: V3 = [ring[i][0], y, ring[i][1]], b: V3 = [ring[(i + 1) % ring.length][0], y, ring[(i + 1) % ring.length][1]];
    const edge = sub(b, a), run = length(edge);
    if (run < 1e-6) continue;
    const along = ((top[0] - a[0]) * edge[0] + (top[2] - a[2]) * edge[2]) / run, foot: V3 = [a[0] + edge[0] / run * along, y, a[2] + edge[2] / run * along];
    mb.tri([a, b, top], { kind: o.kind ?? FACE.roof, col: o.col ?? WHITE, uv: [[0, 0], [run, 0], [along, length(sub(top, foot))]], win: o.win });
  }
}

/**
 * A four-sided pyramid roof over x0…x1 × z0…z1 from y, its apex h higher; eaves `overhang` out with a soffit. `win` is
 * the grid a curtain wall draws on its slopes (bay and floor in metres along the eaves and up the slope).
 */
export function pyramid(mb: MeshBuilder, o: { x0: number; x1: number; z0: number; z1: number; y: number; h: number; overhang?: number; roof: V3; kind?: Face; soffit?: V3; win?: [number, number, number, number] }) {
  const ov = o.overhang ?? 0, X0 = o.x0 - ov, X1 = o.x1 + ov, Z0 = o.z0 - ov, Z1 = o.z1 + ov, low = o.y - (ov ? ov * o.h / Math.max(.01, Math.min(o.x1 - o.x0, o.z1 - o.z0) / 2) : 0);
  const apex: V3 = [(X0 + X1) / 2, o.y + o.h, (Z0 + Z1) / 2], kind = o.kind ?? FACE.roof;
  const face = (a: V3, b: V3) => { const run = length(sub(b, a)), mid: V3 = [(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2], slope = length(sub(apex, mid)); mb.tri([a, b, apex], { kind, col: o.roof, uv: [[0, 0], [run, 0], [run / 2, slope]], win: o.win }); };
  face([X0, low, Z1], [X1, low, Z1]); face([X1, low, Z1], [X1, low, Z0]); face([X1, low, Z0], [X0, low, Z0]); face([X0, low, Z0], [X0, low, Z1]);
  if (ov) mb.quad([[X0, low - .03, Z0], [X1, low - .03, Z0], [X1, low - .03, Z1], [X0, low - .03, Z1]], { kind: FACE.trim, col: o.soffit ?? rgb("#d6d0c4"), n: [0, -1, 0] });
}

/** A pediment or a short gable: a triangular prism over x0…x1 from y, `rise` high, from z0 to z1, its gable to the front. */
export function prism(mb: MeshBuilder, o: { x0: number; x1: number; z0: number; z1: number; y: number; rise: number; col: V3; roof?: V3; kind?: Face }) {
  const { x0, x1, z0, z1, y, rise } = o, xm = (x0 + x1) / 2, top = y + rise, kind = o.kind ?? FACE.wall, slope = Math.hypot((x1 - x0) / 2, rise);
  mb.tri([[x0, y, z1], [x1, y, z1], [xm, top, z1]], { kind, col: o.col });
  mb.tri([[x1, y, z0], [x0, y, z0], [xm, top, z0]], { kind, col: o.col });
  const cover = { kind: o.roof ? FACE.roof : kind, col: o.roof ?? o.col };
  mb.quad([[x0, y, z0], [x0, y, z1], [xm, top, z1], [xm, top, z0]], { ...cover, uv: [[0, 0], [z1 - z0, 0], [z1 - z0, slope], [0, slope]] });
  mb.quad([[x1, y, z1], [x1, y, z0], [xm, top, z0], [xm, top, z1]], { ...cover, uv: [[0, 0], [z1 - z0, 0], [z1 - z0, slope], [0, slope]] });
}

/** An arched panel facing +z: w wide, h to the crown (a half circle on top), `depth` thick, from (x, y, z) at its foot. */
export function arch(mb: MeshBuilder, o: { x: number; y: number; z: number; w: number; h: number; depth: number; kind?: Face; col?: V3; seg?: number; win?: [number, number, number, number]; edge?: V3 }) {
  const seg = o.seg ?? 10, r = o.w / 2, spring = o.y + Math.max(0, o.h - r), kind = o.kind ?? FACE.glass, col = o.col ?? WHITE, zf = o.z + o.depth / 2, zb = o.z - o.depth / 2, win = o.win;
  const outline: [number, number][] = [[o.x + r, o.y], [o.x + r, spring]];
  for (let i = 1; i < seg; i++) { const a = Math.PI * i / seg; outline.push([o.x + r * Math.cos(a), spring + r * Math.sin(a)]); }
  outline.push([o.x - r, spring], [o.x - r, o.y]);
  // Front and back as fans from the foot's middle; the edge strip all round.
  const centre: [number, number] = [o.x, o.y];
  for (let i = 0; i + 1 < outline.length; i++) {
    const [a, b] = [outline[i], outline[i + 1]];
    mb.tri([[centre[0], centre[1], zf], [a[0], a[1], zf], [b[0], b[1], zf]], { kind, col, win, n: [0, 0, 1], uv: [[centre[0], centre[1]], [a[0], a[1]], [b[0], b[1]]] });
    mb.tri([[centre[0], centre[1], zb], [b[0], b[1], zb], [a[0], a[1], zb]], { kind, col, win, n: [0, 0, -1], uv: [[centre[0], centre[1]], [b[0], b[1]], [a[0], a[1]]] });
    const glassy = kind === FACE.glass || kind === FACE.pane || kind === FACE.curtain;
    mb.quad([[a[0], a[1], zb], [b[0], b[1], zb], [b[0], b[1], zf], [a[0], a[1], zf]], { kind: glassy ? FACE.trim : kind, col: glassy ? o.edge ?? rgb("#e9e4d8") : col });
  }
}

/** A bar of square section t from a to b (a rod, a brace, a leg). */
export function rod(mb: MeshBuilder, a: V3, b: V3, t: number, o: { kind?: Face; col?: V3 } = {}) {
  const along = sub(b, a), len = length(along), y = unit(along), helper: V3 = Math.abs(y[1]) > .9 ? [1, 0, 0] : [0, 1, 0];
  const x = unit(cross(helper, y)), z = cross(x, y);
  mb.frame(a, x, y, z, () => box(mb, [-t / 2, 0, -t / 2, t / 2, len, t / 2], { c: t * .2, kind: o.kind ?? FACE.metal, col: o.col, top: o.kind ?? FACE.metal, occlude: false }));
}

// ---- baked occlusion ---------------------------------------------------------------------------------------
/** Rays over the hemisphere, cosine-weighted, in a golden spiral. */
const hemisphere = (count: number): V3[] => Array.from({ length: count }, (_, i) => {
  const u = (i + .5) / count, phi = i * 2.399963, r = Math.sqrt(u);
  return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)];
});
const RAYS = { 28: hemisphere(28), 16: hemisphere(16) };
/** The ray's entry and exit along one axis, folded into [near, far]; false when it misses. */
const span = { near: 0, far: Infinity };
function slab(o: number, d: number, lo: number, hi: number) {
  if (Math.abs(d) < 1e-8) return o >= lo && o <= hi;
  let t0 = (lo - o) / d, t1 = (hi - o) / d;
  if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
  if (t0 > span.near) span.near = t0;
  if (t1 < span.far) span.far = t1;
  return span.near <= span.far;
}
/** Distance along the ray from (ox, oy, oz) in direction (dx, dy, dz) to the box, or -1 if it misses. */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: readonly number[]) {
  span.near = 0; span.far = Infinity;
  return slab(ox, dx, b[0], b[3]) && slab(oy, dy, b[1], b[4]) && slab(oz, dz, b[2], b[5]) ? span.near : -1;
}
/**
 * Occlusion of every vertex by the building's own volumes and the ground within a few metres, into aSurf.w: dark
 * at the foot of the walls, under the eaves and in the corners, as a sky would leave them. Done once per model.
 * `floor` is the height of the ground round it; `rays` how many directions each vertex looks in. Small parts
 * (MeshBuilder.detail) see only the ground.
 */
export function bakeOcclusion(mb: MeshBuilder, { reach = 3.6, ground = 3.2, strength = .95, floor = 0, rays = 28 as 28 | 16 } = {}) {
  const near: (readonly number[])[] = [], set = RAYS[rays], p = mb.p, n = mb.n;
  for (let v = 0; v < mb.count; v++) {
    let nx = n[v * 3], ny = n[v * 3 + 1], nz = n[v * 3 + 2];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const ox = p[v * 3] + nx * .05, oy = p[v * 3 + 1] + ny * .05, oz = p[v * 3 + 2] + nz * .05;
    // A tangent frame round the normal.
    const [hx, hy, hz] = Math.abs(ny) > .9 ? [1, 0, 0] : [0, 1, 0];
    let tx = hy * nz - hz * ny, ty = hz * nx - hx * nz, tz = hx * ny - hy * nx;
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    // Only the volumes within reach can shade it (a big building has hundreds of parts, most of them far away).
    near.length = 0;
    if (mb.fine[v]) for (const b of mb.occluders) {
      const dx = Math.max(b[0] - ox, 0, ox - b[3]), dy = Math.max(b[1] - oy, 0, oy - b[4]), dz = Math.max(b[2] - oz, 0, oz - b[5]);
      if (dx * dx + dy * dy + dz * dz < reach * reach) near.push(b);
    }
    let hidden = 0;
    for (const r of set) {
      const dx = tx * r[0] + bx * r[1] + nx * r[2], dy = ty * r[0] + by * r[1] + ny * r[2], dz = tz * r[0] + bz * r[1] + nz * r[2];
      let hit = 0;
      for (const b of near) { const t = rayBox(ox, oy, oz, dx, dy, dz, b); if (t >= 0 && t < reach) hit = Math.max(hit, 1 - t / reach); }
      if (dy < -1e-4 && oy > floor) { const t = (floor - oy) / dy; if (t < ground) hit = Math.max(hit, 1 - t / ground); }
      hidden += hit;
    }
    mb.s[v * 4 + 3] = Math.min(1, Math.max(.22, 1 - strength * hidden / set.length));
  }
}

// ---- the material ------------------------------------------------------------------------------------------
type Node = ReturnType<typeof float>;
/** sRGB to linear for a colour written as 0…1 numbers. */
const lin = (r: number, g: number, b: number) => vec3(...new THREE.Color(r, g, b).convertSRGBToLinear().toArray() as V3);

export interface FacadeOptions {
  /**
   * A whole number per building, for which windows are lit and which have a blind; by default from the copy's place
   * (render/copies.ts copyMatrix3). Meshes that are not copies pass their own.
   */
  seed?: Node;
  /** Unit models stretched per copy (MeshBuilder.build({ unit })): wall coordinates measured on the copy, in metres. */
  unit?: boolean;
  /** The share of windows lit at night (homes and offices about 0.42; public buildings more). */
  lit?: number;
  /** The city's shared sky uniforms, so glass and metal follow daylight, dusk and night without an environment map. */
  look?: SkyLook | null;
}

/**
 * The facade material of every procedural building, for the instance pools (render/copies.ts): its colour comes from
 * the vertices (walls in their finish, roofs, trim), its detail from aSurf/aWin, its windows light up with `night`.
 * Which windows are lit, have a blind or a lighter pane is fixed per building by its position, so a building keeps
 * its pattern and its neighbour has another; the hash only ever sees whole numbers, so the pattern never sparkles.
 */
export function facadeMaterial(night: Node, options: FacadeOptions = {}): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .85, metalness: 0 });
  const surf = attribute("aSurf", "vec4"), win = attribute("aWin", "vec4"), base = vertexColor().xyz;
  const kind = surf.z, occlusion = surf.w;
  const is = (k: number) => float(1).sub(kind.sub(k).abs()).clamp(0, 1);
  // Per building: its place (the copy's translation), cut to a whole number in the vertex stage and rounded again in
  // the fragment stage, so the interpolation can never tip it to the next one.
  const place = attribute("copyMatrix3", "vec4");
  const seed = options.seed ?? floor(varying(floor(fract(place.x.mul(.0173).add(place.z.mul(.0291)).add(.5)).mul(997))).add(.5));
  const pick = (a: Node, b: Node, salt: number) => hash(a.mul(37).add(b.mul(113)).add(seed.mul(7)).add(salt));

  // Where the wall coordinates are, in metres, and the bay and floor of its windows.
  let at: Node = surf.xy, grid: Node = win.xy, shares: Node = win.zw;
  // Unit models: the ground floor's door and shops, the plinth and the cornice band (all in metres on the copy).
  let doorCell: Node = float(0), shopFloor: Node = float(0), plinth: Node = float(0), cornice: Node = float(0), upright: Node = float(0);
  if (options.unit) {
    // Measured in the vertex stage on the copy: a nominal metre along u (v) is |M · aUnitU| world units long. Walls
    // count their floors from the ground, so a section raised over an arch keeps the floors of its wing, and every
    // wall takes a whole number of bays of about its nominal width (an odd number where a door is in the middle).
    const columns = [0, 1, 2].map(k => attribute(`copyMatrix${k}`, "vec4").xyz);
    const stretch = (d: Node) => columns[0].mul(d.x).add(columns[1].mul(d.y)).add(columns[2].mul(d.z)).length().mul(WORLD_METRES);
    const U = attribute("aUnitU", "vec4"), V = attribute("aUnitV", "vec4"), ku = stretch(U.xyz), kv = stretch(V.xyz);
    const wall = step(.5, V.w), door = step(1.5, V.w).mul(step(V.w, 2.5)).add(step(3.5, V.w)), shops = step(2.5, V.w);
    const run = U.w.mul(ku), even = max(1, round(run.div(win.x))), odd = max(1, round(run.div(win.x).sub(1).mul(.5)).mul(2).add(1));
    const count = mix(even, odd, door), bay = run.div(count);
    const height = positionWorld.y.sub(WORLD_GROUND).mul(WORLD_METRES), top = place.y.add(columns[1].length()).sub(WORLD_GROUND).mul(WORLD_METRES);
    at = varying(vec2(surf.x.mul(ku), mix(surf.y.mul(kv), height, wall)));
    // Bay, floor and the copy's top in one varying, the door and shop flags in another: WebGPU has few to spare.
    const measures = varying(vec3(bay, win.y, top));
    grid = measures.xy;
    const flags = varying(vec4(door, shops, wall, count.sub(1).mul(.5)));
    const ground = step(at.y, grid.y), middle = step(abs(floor(at.x.div(grid.x)).sub(flags.w)), .5);
    doorCell = flags.x.mul(ground).mul(middle); shopFloor = flags.y.mul(ground); upright = flags.z;
    plinth = upright.mul(step(at.y, .45)); cornice = upright.mul(step(measures.z.sub(.32), at.y));
    // Window widths vary a little from building to building; shops are wide and tall.
    const jitter = hash(seed.add(71)).mul(.24).add(.88);
    shares = mix(vec2(win.z.mul(jitter).min(.9), win.w), vec2(.8, .66), shopFloor);
  }

  const tint = options.unit ? varyingProperty("vec3", "vInstanceColor") : vec3(1);
  const plantedGlass = options.unit ? step(.035, tint.y.sub(max(tint.x, tint.z))) : float(0);
  // A clean painted toy facade: broad light across each storey instead of tiny mortar, grime and bump.
  const wall = base.mul(mix(.98, 1.035, smoothstep(0, 3, at.y)));

  // View-dependent reflected sky is shared by every glazed surface. Diffuse interiors stay dark behind it;
  // only the reflected portion goes into emission, so buildings do not glow like lamps in daylight.
  const view = cameraPosition.sub(positionWorld).normalize(), facing = max(dot(normalWorld, view), 0);
  const fresnel = float(.04).add(pow(facing.oneMinus(), 5).mul(.96));
  const reflected = reflect(view.negate(), normalWorld);
  const reflectedSky = skyGradient(options.look ?? null, vec3(reflected.x, max(reflected.y, 0), reflected.z))
    .mul(options.look ? float(1) : mix(1, .035, night));

  // Windows in a wall: the grid of bays and floors, frame, sill, glass, lit at night.
  const q = at.div(grid), cell = floor(q), f = fract(q);
  const aa = max(fwidth(q.x), fwidth(q.y));
  const half = shares.mul(.5), d = abs(f.sub(vec2(.5, .57))).sub(half), sd = max(d.x, d.y), soft = aa.mul(1.2);
  const above = smoothstep(.35, .55, at.y).mul(doorCell.oneMinus());
  const pane = smoothstep(soft.negate(), soft, sd).oneMinus().mul(above);
  // Bold cream frames and a soft shallow sill stay readable on the miniature buildings.
  const outerFrame = max(d.x.sub(float(.085).div(grid.x)), d.y.sub(float(.085).div(grid.y)));
  const frame = smoothstep(soft.negate(), soft, outerFrame).oneMinus().mul(above).sub(pane).max(0);
  const sill = smoothstep(soft.negate(), soft, max(abs(f.x.sub(.5)).sub(half.x).sub(float(.09).div(grid.x)), abs(f.y.sub(float(.57).sub(half.y).sub(float(.055).div(grid.y)))).sub(float(.028).div(grid.y)))).oneMinus().mul(above);
  const insetLeft = smoothstep(0, float(.12).div(grid.x).add(aa), f.x.sub(float(.5).sub(half.x))).oneMinus();
  const insetTop = smoothstep(0, float(.14).div(grid.y).add(aa), float(.57).add(half.y).sub(f.y)).oneMinus();
  const reveal = max(insetLeft, insetTop).mul(pane).mul(smoothstep(.12, .45, aa).oneMinus());
  const blind = step(.8, pick(cell.x, cell.y, 3));
  const sky = smoothstep(0, 1, f.y.sub(float(.57).sub(half.y)).div(half.y.mul(2)));
  const glass = mix(lin(.19, .42, .57), lin(.42, .72, .83), sky.mul(.64))
    .mul(mix(.9, 1.04, pick(cell.x, cell.y, 1))).mul(reveal.mul(.2).oneMinus());
  const share = 1 - (options.lit ?? .42);
  const lit = step(share, pick(cell.x, cell.y, 5)), warm = mix(vec3(1, .66, .3), vec3(.78, .86, 1), step(.82, pick(cell.x, cell.y, 9)));
  const far = smoothstep(.2, .6, aa), cover = shares.x.mul(shares.y);
  const windowWall = mix(mix(mix(wall, glass, pane), lin(.96, .92, .79), frame.mul(.95)), lin(.85, .8, .67), sill.mul(pane.oneMinus()));
  // A door in its cell: a panelled leaf 2.3 m high in a light frame, a glazed top light.
  const doorLeaf = doorCell.mul(step(abs(f.x.sub(.5)), .22)).mul(step(at.y, 2.3)), doorFrame = doorCell.mul(step(abs(f.x.sub(.5)), .27)).mul(step(at.y, 2.42)).sub(doorLeaf).max(0);
  const doorColour = mix(lin(.3, .22, .16), lin(.2, .26, .3), step(1.75, at.y));
  const withDoor = mix(mix(windowWall, lin(.9, .89, .86), doorFrame), doorColour, doorLeaf);
  const windowColour = mix(withDoor, mix(base, lin(.25, .48, .6), cover), far);
  const windowGlow = mix(warm.mul(lit).mul(pane).mul(blind.mul(.3).oneMinus()), vec3(1, .7, .36).mul(cover.mul(.42)), far).mul(night).mul(.8);
  const windowRough = mix(mix(.86, .3, pane), .65, far);

  // Curtain walls: mullions, a spandrel at every floor, tinted glass by floor, lit floors at night. Mirror glass has the
  // same panes in a thin dark grid, with thin transoms and a stronger sky in every pane.
  const spire = is(FACE.spire), mirror = is(FACE.mirror).add(spire), curtain = is(FACE.curtain).add(mirror);
  const mullionHalf = mix(.042, .03, mirror), band = mix(.21, .09, mirror);
  const mullion = smoothstep(mullionHalf, aa.add(mullionHalf), min(f.x, f.x.oneMinus())).oneMinus();
  const spandrel = smoothstep(0, aa, f.y).mul(smoothstep(band, aa.add(band), f.y).oneMinus());
  const solid = max(mullion, spandrel.mul(.92));
  const shade = pick(float(0), cell.y, 11).mul(.6).add(.2);
  // Adjacent panels vary subtly, as real coatings and interiors do, without a hash per pixel.
  const panelShade = pick(cell.x, cell.y, 17).mul(.12).add(.94);
  const tinted = base.mul(mix(.78, 1.02, shade)).mul(panelShade)
    .add(lin(.32, .62, .75).mul(smoothstep(.15, 1, f.y).mul(.16)));
  const ribs = mix(lin(.86, .9, .88), lin(.17, .36, .44), mirror);
  const curtainColour = mix(mix(tinted, ribs, solid), mix(tinted, ribs, .3), far);
  const curtainGlow = mix(vec3(1, .74, .42).mul(step(share + .02, pick(cell.x, cell.y, 13))).mul(solid.oneMinus()), vec3(1, .74, .42).mul(.28), far).mul(night).mul(.6);
  const glazed = mix(solid.oneMinus(), .7, far);

  // Roof tiles in rows along the slope; flat decks in gravel.
  const row = at.y.div(.45), tile = hash(floor(at.x.div(.32).add(floor(row).mul(.5))).add(floor(row).mul(57)).add(seed));
  const seam = smoothstep(0, fwidth(row).mul(1.4).add(.07), fract(row)).oneMinus().mul(smoothstep(.05, .35, fwidth(at.y)).oneMinus());
  const roof = base.mul(mix(.98, 1.025, tile)).mul(seam.mul(.1).oneMinus());
  const deck = lin(.64, .7, .72);
  const canopy = normalWorld.y.mul(.5).add(.5);
  const leaf = base.mul(mix(.9, 1.1, canopy));

  // A single pane: the tint of its glass with a sheen up it, lit at night by its own number.
  const sheet = base.mul(.76).add(lin(.4, .7, .83).mul(smoothstep(0, 1, fract(at.y.div(3))).mul(.13)));
  const sheetGlow = vec3(1, .72, .4).mul(step(share, win.x)).mul(night).mul(.55);

  const metal = base;
  const colour = windowColour.mul(is(FACE.window)).add(wall.mul(is(FACE.wall))).add(roof.mul(is(FACE.roof))).add(deck.mul(is(FACE.deck)))
    .add(base.mul(is(FACE.trim))).add(curtainColour.mul(curtain)).add(base.mul(is(FACE.light))).add(metal.mul(is(FACE.metal)))
    .add(lin(.18, .39, .51).mul(is(FACE.glass))).add(leaf.mul(is(FACE.leaf))).add(sheet.mul(is(FACE.pane)));
  let shaded: Node = colour;
  if (options.unit) {
    // The plinth a shade darker and the cornice band lighter; the copy's tint (render/copies.ts) is for the walls and
    // the roofs, so glass, frames, doors and trim are divided by it here, before the copy multiplies it back in.
    shaded = mix(mix(colour, colour.mul(.72), plinth.mul(is(FACE.window).add(is(FACE.wall)))), colour.mul(1.1), cornice.mul(is(FACE.window).add(is(FACE.wall))).mul(.8));
    const tint = varyingProperty("vec3", "vInstanceColor");
    // Copies in the two green shades (assets/catalogue.ts SECTION_TINTS) plant their balconies: the glass of their
    // balustrades turns to clipped shrubs.
    const planted = mix(lin(.25, .56, .24), lin(.5, .75, .29), canopy);
    shaded = mix(shaded, planted, is(FACE.glass).mul(plantedGlass));
    const keep = shaded.div(max(tint, vec3(.04)));
    const wallShare = is(FACE.wall).add(is(FACE.roof)).add(is(FACE.curtain)).add(is(FACE.window).mul(pane.add(frame).add(sill).add(doorLeaf).add(doorFrame).min(1).oneMinus().mul(far.oneMinus()).add(far.mul(cover.oneMinus()))));
    shaded = mix(keep, shaded, wallShare.min(1));
  }
  material.colorNode = vec4(shaded.mul(mix(1, occlusion, .2)), 1);
  const windowReflection = mix(pane.mul(blind.mul(.7).oneMinus()), cover.mul(.8), far).mul(is(FACE.window));
  const glazing = windowReflection.add(glazed.mul(curtain)).add(is(FACE.glass).mul(plantedGlass.oneMinus())).add(is(FACE.pane));
  const sheen = reflectedSky.mul(fresnel.mul(.55).add(mirror.mul(.11).add(.04))).mul(glazing)
    .add(reflectedSky.mul(fresnel.mul(.2).add(.06)).mul(is(FACE.metal)));
  material.emissiveNode = windowGlow.mul(is(FACE.window)).add(curtainGlow.mul(curtain).mul(spire.oneMinus())).add(base.mul(night.mul(1.6).add(.4)).mul(is(FACE.light)))
    .add(sheetGlow.mul(is(FACE.pane))).add(sheen.mul(occlusion));
  const wallRough = float(.88);
  material.roughnessNode = windowRough.mul(is(FACE.window)).add(wallRough.mul(is(FACE.wall))).add(float(.77).mul(is(FACE.roof))).add(float(.94).mul(is(FACE.deck)))
    .add(float(.73).mul(is(FACE.trim))).add(mix(.64, .3, glazed).mul(curtain)).add(float(.5).mul(is(FACE.light))).add(float(.48).mul(is(FACE.metal)))
    .add(mix(.28, .88, plantedGlass).mul(is(FACE.glass))).add(float(.92).mul(is(FACE.leaf))).add(float(.3).mul(is(FACE.pane)));
  material.metalnessNode = float(.07).mul(curtain).add(plantedGlass.oneMinus().mul(.12).mul(is(FACE.glass)))
    .add(float(.25).mul(is(FACE.metal))).add(float(.08).mul(is(FACE.pane)));
  material.normalNode = normalView;
  material.aoNode = mix(.45, 1, occlusion);
  material.userData.cityModelStyle = "cartoon-v1";
  return material;
}
