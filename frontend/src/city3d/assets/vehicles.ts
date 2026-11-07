/**
 * The city's vehicles, built in code in the v4 style (docs/CITY_V4.md, stage 4): every car of the traffic and of the
 * car parks, and the canal's motor boat, is one geometry, and all of them share one material (vehicleMaterial), so a
 * kind of vehicle is one draw call however many of it there are (render/copies.ts). The sizes are the old ones: the
 * Kenney Car Kit's (1.5 units wide; CAR_SCALE 0.5 fits a car to a one-unit lane), the traffic taxi's and the boat's.
 *
 * A body is a loft: rounded sections along the car from the rear bumper to the front one, shaded smooth, with a band
 * of dark plastic along the sills; the glasshouse is a second loft on the belt line whose sections rise to the roof
 * and fall away to the windscreen and the rear window: glass on the sides and at the ends, the roof and the pillars
 * painted, the middle pillar black. Wheels are tyres with silver rims, the bumpers, lamps, grille, plates and mirrors
 * small rounded boxes. The occlusion by the wheels and the ground is baked into the vertices (bakeOcclusion).
 */
import * as THREE from "three/webgpu";
import { abs, attribute, cameraPosition, color, dot, float, floor, fract, fwidth, max, min, mix, normalGeometry, normalWorld, positionGeometry, positionWorld, pow, reflect, smoothstep, step, varyingProperty, vec2, vec3, vertexColor, type ShaderNodeObject } from "three/tsl";
import { MeshBuilder, bakeOcclusion, box, cylinder, rgb, type Face, type V3 } from "./facade";
import { skyGradient, type SkyLook } from "../render/sky";

/**
 * Surfaces of a vehicle in aSurf.z. The builder's boxes and cylinders treat the facade's window (0), curtain (5) and
 * mirror (11) kinds specially, so those numbers are left out.
 */
export const PART = { paint: 1, glass: 3, rubber: 4, chrome: 6, plastic: 7, head: 8, tail: 9, sign: 10, checker: 12, fixed: 13, wood: 14, blue: 15 } as const;
type Part = typeof PART[keyof typeof PART];
const as = (part: Part) => part as unknown as Face;

/** Every vehicle the city draws: the traffic's (systems/traffic.ts) and the car parks' (assets/catalogue.ts PARKED). */
export const VEHICLES = ["taxi", "sedan", "suv", "van", "delivery", "truck", "hatchback-sports", "police", "boat"] as const;
export type VehicleName = typeof VEHICLES[number];
/** The Kenney taxi the car parks had: the traffic taxi scaled to its length (2.75 instead of 3.18). */
export const PARKED_TAXI_SCALE = 2.75 / 3.18;

const C = {
  white: rgb("#f3f3f0"), plastic: rgb("#2b2e33"), glass: rgb("#22313d"), rubber: rgb("#18191c"), chrome: rgb("#a9b0b7"),
  head: rgb("#f6f2e4"), tail: rgb("#b3121b"), plate: rgb("#eceee8"), grille: rgb("#1d2024"), taxi: rgb("#ffc21f"),
  police: rgb("#f4f6f8"), policeBlue: rgb("#1d3b86"), sign: rgb("#fff3c2"), cargo: rgb("#f1f0ea"), deck: rgb("#e6dfcf"),
  hull: rgb("#fbfbf8"), stripe: rgb("#3c74d6"), blueLamp: rgb("#2f6dff"),
};
const NONE: [number, number, number, number] = [99, 99, 0, 0];

type Pt = [number, number];
/** A body section at z: bottom y0, top y1 (bumper, bonnet, belt, boot), half width, top and bottom corner radii. */
interface Section { z: number; y0: number; y1: number; hw: number; rt: number; rb: number }
/** The glasshouse: rear window base, roof from z1 to z2, windscreen base z3; belt and roof heights and half widths. */
interface Cabin { z: [number, number, number, number]; yB: number; yR: number; hwB: number; hwR: number; rr: number; crown?: number; pillar?: number }
interface Wheels { r: number; w: number; z: [number, number]; x?: number }
interface Spec {
  length: number; body: Section[]; band: number; mid: number; cabin?: Cabin; wheels: Wheels;
  /** Lower body (between the sills' band and `mid`) and upper body paint, as parts with colours. */
  lower?: [Part, V3]; upper?: [Part, V3];
  /** Head and tail lamps' height and inset from the side. */
  lamps?: { y: number; inset: number };
  /** The lower body's colour only between these z (a taxi's chequers on its doors); the upper colour beyond. */
  lowerSpan?: [number, number];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** The body at z between its keys, every number interpolated linearly. */
function sectionAt(keys: Section[], z: number): Section {
  if (z <= keys[0].z) return { ...keys[0], z };
  for (let i = 1; i < keys.length; i++) if (z <= keys[i].z) {
    const a = keys[i - 1], b = keys[i], t = (z - a.z) / Math.max(1e-6, b.z - a.z);
    return { z, y0: lerp(a.y0, b.y0, t), y1: lerp(a.y1, b.y1, t), hw: lerp(a.hw, b.hw, t), rt: lerp(a.rt, b.rt, t), rb: lerp(a.rb, b.rb, t) };
  }
  return { ...keys[keys.length - 1], z };
}
/** Sorted stations: the given ones and enough between them that no gap is wider than `step`. */
function stations(fixed: number[], step: number) {
  const list = [...new Set(fixed.map(z => Math.round(z * 1e4) / 1e4))].sort((a, b) => a - b), out: number[] = [];
  for (let i = 0; i < list.length; i++) {
    out.push(list[i]);
    if (i === list.length - 1) break;
    const n = Math.ceil((list[i + 1] - list[i]) / step - 1e-6);
    for (let k = 1; k < n; k++) out.push(lerp(list[i], list[i + 1], k / n));
  }
  return out;
}
function arc(points: Pt[], cx: number, cy: number, r: number, a0: number, a1: number, steps: number) {
  for (let i = 0; i <= steps; i++) { const a = lerp(a0, a1, i / steps); points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
}
/**
 * The body's ring, counter-clockwise seen from the front and open underneath: the bottom-right corner, the side
 * (the sills' band and `mid` on it), the top's rounded corners and its crown, the left side down. 17 points, 16
 * segments: 0–1 and 14–15 the sills, 2 and 13 the lower body, 3–12 the upper body and the top.
 */
function bodyRing(s: Section, band: number, mid: number): Pt[] {
  const rb = Math.min(s.rb, (s.y1 - s.y0) / 3), rt = Math.min(s.rt, (s.y1 - s.y0) / 3, s.hw * .6);
  const b = Math.min(Math.max(band, s.y0 + rb + .005), s.y1 - rt - .01), m = Math.min(Math.max(mid, b + .005), s.y1 - rt - .005), points: Pt[] = [];
  arc(points, s.hw - rb, s.y0 + rb, rb, -Math.PI / 2, 0, 1);
  points.push([s.hw, b], [s.hw, m]);
  arc(points, s.hw - rt, s.y1 - rt, rt, 0, Math.PI / 2, 3);
  points.push([0, s.y1 + .012]);
  arc(points, -s.hw + rt, s.y1 - rt, rt, Math.PI / 2, Math.PI, 3);
  points.push([-s.hw, m], [-s.hw, b]);
  arc(points, -s.hw + rb, s.y0 + rb, rb, Math.PI, Math.PI * 1.5, 1);
  return points;
}
/** How far up the glasshouse stands at z (0 on the belt, 1 under the roof), curved like glass into the roof. */
function rise(c: Cabin, z: number) {
  const [z0, z1, z2, z3] = c.z;
  if (z <= z0 || z >= z3) return 0;
  if (z < z1) return Math.sin((z - z0) / (z1 - z0) * Math.PI / 2);
  if (z > z2) return Math.cos((z - z2) / (z3 - z2) * Math.PI / 2);
  return 1;
}
/**
 * The glasshouse's ring at height share f: from the right belt up the side glass, round the roof's corner, over the
 * crown and down the left. 11 points, 10 segments: 0 and 9 the side windows, 1–3 and 6–8 the pillars and the roof's
 * edges, 4–5 the roof (or the windscreen and the rear window where it slopes).
 */
function cabinRing(c: Cabin, f: number): Pt[] {
  const yTop = c.yB + (c.yR - c.yB) * f, rr = c.rr * f, top = lerp(c.hwB, c.hwR, f), points: Pt[] = [[c.hwB, c.yB]];
  arc(points, top - rr, yTop - rr, rr, 0, Math.PI / 2, 3);
  points.push([0, yTop + (c.crown ?? .015) * f]);
  arc(points, -top + rr, yTop - rr, rr, Math.PI / 2, Math.PI, 3);
  points.push([-c.hwB, c.yB]);
  return points;
}

/**
 * A loft through the rings (one per station, rear to front, counter-clockwise seen from the front), shaded smooth:
 * each vertex's normal from its neighbours along and round. `face(i, j)` gives the part and colour of the quad
 * between stations i and i+1 and ring points j and j+1.
 */
function loft(mb: MeshBuilder, zs: number[], rings: Pt[][], face: (i: number, j: number) => [Part, V3, [number, number, number, number]?]) {
  const P = (i: number, j: number): V3 => [rings[i][j][0], rings[i][j][1], zs[i]];
  const n = rings[0].length, normals: V3[][] = [];
  for (let i = 0; i < zs.length; i++) {
    const row: V3[] = [];
    for (let j = 0; j < n; j++) {
      const a = P(i, Math.min(n - 1, j + 1)), b = P(i, Math.max(0, j - 1));
      let around: V3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      // A ring squeezed to a line (the glasshouse's ends): take its neighbour's direction round.
      if (Math.hypot(...around) < 1e-5) {
        const k = i === 0 ? 1 : i - 1, a2 = P(k, Math.min(n - 1, j + 1)), b2 = P(k, Math.max(0, j - 1));
        around = [a2[0] - b2[0], a2[1] - b2[1], 0];
      }
      const f = P(Math.min(zs.length - 1, i + 1), j), r = P(Math.max(0, i - 1), j), along: V3 = [f[0] - r[0], f[1] - r[1], f[2] - r[2]];
      const nx = around[1] * along[2] - around[2] * along[1], ny = around[2] * along[0] - around[0] * along[2], nz = around[0] * along[1] - around[1] * along[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      row.push([nx / l, ny / l, nz / l]);
    }
    normals.push(row);
  }
  for (let i = 0; i + 1 < zs.length; i++) for (let j = 0; j + 1 < n; j++) {
    const [part, col, win] = face(i, j), a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - d[0], c[1] - d[1]) < 1e-5) continue;
    mb.quad([d, a, b, c], { kind: as(part), col, win: win ?? NONE, ns: [normals[i + 1][j], normals[i][j], normals[i][j + 1], normals[i + 1][j + 1]], uv: [[d[2], d[1]], [a[2], a[1]], [b[2], b[1]], [c[2], c[1]]] });
  }
}
/** Closes a ring at z with a flat fan, facing +z (front) or −z (rear). */
function cap(mb: MeshBuilder, ring: Pt[], z: number, front: boolean, part: Part, col: V3) {
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length, centre: V3 = [0, cy, z], n: V3 = [0, 0, front ? 1 : -1];
  for (let j = 0; j < ring.length; j++) {
    const p: V3 = [ring[j][0], ring[j][1], z], q: V3 = [ring[(j + 1) % ring.length][0], ring[(j + 1) % ring.length][1], z];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-5) continue;
    mb.tri(front ? [centre, p, q] : [centre, q, p], { kind: as(part), col, n, uv: [[0, cy], [p[2], p[1]], [q[2], q[1]]] });
  }
}
/** A flat disc of radius r facing `n` (±x), at (x, y, z): a rim or a hub cap. */
function disc(mb: MeshBuilder, x: number, y: number, z: number, r: number, outward: 1 | -1, part: Part, col: V3, seg = 12) {
  const n: V3 = [outward, 0, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    const p: V3 = [x, y + Math.cos(a0) * r, z + Math.sin(a0) * r], q: V3 = [x, y + Math.cos(a1) * r, z + Math.sin(a1) * r];
    mb.tri(outward > 0 ? [[x, y, z], p, q] : [[x, y, z], q, p], { kind: as(part), col, n, uv: [[z, y], [p[2], p[1]], [q[2], q[1]]] });
  }
}
/** A tyre with its rim and hub on the outer side, its axle along x. */
function wheel(mb: MeshBuilder, x: number, z: number, r: number, w: number) {
  const outward = x > 0 ? 1 : -1;
  // The cylinder primitive stands along y: drawn in a frame whose y is the axle (x) and whose x is up.
  mb.frame([x - w / 2, r, z], [0, 1, 0], [1, 0, 0], [0, 0, -1], () => cylinder(mb, { x: 0, z: 0, y0: 0, y1: w, r, seg: 10, kind: as(PART.rubber), col: C.rubber, top: outward > 0 ? as(PART.rubber) : null, bottom: outward < 0 }));
  mb.detail(() => {
    disc(mb, x + outward * (w / 2 + .006), r, z, r * .6, outward, PART.chrome, C.chrome, 10);
    disc(mb, x + outward * (w / 2 + .012), r, z, r * .2, outward, PART.plastic, C.plastic, 6);
  });
}
/** A small box from its centre and size, its edges rounded by `c` (0: a plain box of 10 triangles). */
function part(mb: MeshBuilder, [x, y, z]: V3, [w, h, d]: V3, kind: Part, col: V3, c = 0) {
  mb.detail(() => box(mb, [x - w / 2, y - h / 2, z - d / 2, x + w / 2, y + h / 2, z + d / 2], { c, kind: as(kind), col, top: as(kind), occlude: false }));
}

/**
 * Builds a car from its spec: the body loft and its caps, the glasshouse, wheels, bumpers, lamps, grille, plates
 * and mirrors. Returns the builder for extras (a taxi's sign, a pickup's bed).
 */
function car(spec: Spec, paint: V3) {
  const mb = new MeshBuilder(), L = spec.length, { body, band, mid, wheels } = spec;
  const [lowerPart, lowerCol] = spec.lower ?? [PART.paint, paint], [upperPart, upperCol] = spec.upper ?? [PART.paint, paint];
  const first = body[0].z, last = body[body.length - 1].z;
  const zs = stations([...body.map(s => s.z), ...wheels.z.flatMap(z => [z - wheels.r, z + wheels.r]), ...(spec.cabin ? spec.cabin.z : []), ...(spec.lowerSpan ?? [])].filter(z => z >= first && z <= last), .26);
  const rings = zs.map(z => bodyRing(sectionAt(body, z), band, mid)), widest = Math.max(...body.map(s => s.hw));
  // The wheels' places for the arches the material darkens on the body's sides.
  const arches: [number, number, number, number] = [wheels.z[1], wheels.z[0], wheels.r + .045, wheels.r];
  const span = spec.lowerSpan ?? [-99, 99];
  loft(mb, zs, rings, (i, j) => {
    if (j <= 1 || j >= 14) return [PART.plastic, C.plastic, arches];
    const z = (zs[i] + zs[i + 1]) / 2;
    if (j === 2 || j === 13) return z > span[0] && z < span[1] ? [lowerPart, lowerCol, arches] : [upperPart, upperCol, arches];
    return [upperPart, upperCol, j === 3 || j === 12 ? arches : undefined];
  });
  cap(mb, rings[0], zs[0], false, upperPart, upperCol);
  cap(mb, rings[rings.length - 1], zs[zs.length - 1], true, upperPart, upperCol);
  if (spec.cabin) {
    const c = spec.cabin, pillar = c.pillar ?? (c.z[1] + c.z[2]) / 2;
    const cz = stations([...c.z, pillar - .035, pillar + .035], .2), cr = cz.map(z => cabinRing(c, rise(c, z)));
    loft(mb, cz, cr, (i, j) => {
      const z = (cz[i] + cz[i + 1]) / 2, roof = rise(c, cz[i]) > .999 && rise(c, cz[i + 1]) > .999;
      if (j === 0 || j === 9) return Math.abs(z - pillar) < .036 ? [PART.plastic, C.plastic] : [PART.glass, C.glass];
      if (j >= 4 && j <= 5) return roof ? [upperPart, upperCol] : [PART.glass, C.glass];
      return [upperPart, upperCol];
    });
    // Mirrors at the windscreen's foot, a little out from the body.
    for (const side of [-1, 1]) part(mb, [side * (widest + .02), c.yB + .1, c.z[3] - .1], [.08, .075, .13], upperPart, upperCol, .02);
  }
  const front = sectionAt(body, L / 2), rear = sectionAt(body, -L / 2), lamp = spec.lamps ?? { y: .62, inset: .2 };
  // Bumpers: dark plastic across the lower front and rear.
  for (const [s, z] of [[front, L / 2 - .025], [rear, -L / 2 + .025]] as const) part(mb, [0, (s.y0 + band) / 2 + .02, z], [s.hw * 2 - .04, band - s.y0 + .02, .07], PART.plastic, C.plastic, .025);
  for (const side of [-1, 1]) {
    part(mb, [side * (front.hw - lamp.inset), lamp.y, L / 2 - .012], [.26, .1, .04], PART.head, C.head);
    part(mb, [side * (rear.hw - lamp.inset), lamp.y + .02, -L / 2 + .012], [.24, .11, .04], PART.tail, C.tail);
  }
  part(mb, [0, (lamp.y + band) / 2, L / 2 - .006], [front.hw * .75, .11, .03], PART.plastic, C.grille);
  part(mb, [0, band - .005, L / 2 + .01], [.3, .085, .02], PART.fixed, C.plate);
  part(mb, [0, (lamp.y + band) / 2, -L / 2 - .01], [.3, .085, .02], PART.fixed, C.plate);
  const x = wheels.x ?? (widest - wheels.w / 2 + .025);
  for (const z of wheels.z) for (const side of [-1, 1]) wheel(mb, side * x, z, wheels.r, wheels.w);
  return mb;
}

/** Body keys from five numbers per station: z, bottom, top, half width, top corner radius (bottom radius .06). */
const keys = (...rows: [number, number, number, number, number][]): Section[] => rows.map(([z, y0, y1, hw, rt]) => ({ z, y0, y1, hw, rt, rb: .06 }));

/** The specs, in the car kit's units (a sedan 1.5 wide, 1.3 high, 2.55 long), facing +z, wheels on y = 0. */
const SPECS: Record<Exclude<VehicleName, "boat">, Spec> = {
  sedan: {
    length: 2.55, band: .3, mid: .52, wheels: { r: .3, w: .22, z: [.84, -.84] },
    body: keys([-1.275, .22, .72, .7, .1], [-1.22, .17, .79, .745, .12], [-.95, .16, .81, .75, .14], [-.6, .16, .82, .75, .14], [.42, .16, .82, .75, .14], [.9, .16, .75, .75, .14], [1.22, .17, .7, .745, .12], [1.275, .22, .66, .7, .1]),
    cabin: { z: [-.66, -.3, .12, .46], yB: .78, yR: 1.27, hwB: .69, hwR: .57, rr: .13 },
  },
  taxi: {
    length: 3.12, band: .31, mid: .5, lamps: { y: .64, inset: .22 }, wheels: { r: .285, w: .2, z: [.99, -.99] },
    lower: [PART.checker, C.white], upper: [PART.fixed, C.taxi], lowerSpan: [-.68, .66],
    body: keys([-1.56, .22, .76, .72, .1], [-1.5, .17, .83, .77, .13], [-1.15, .16, .86, .77, .15], [-.7, .16, .86, .77, .15], [.4, .16, .86, .77, .15], [1.05, .16, .8, .77, .15], [1.5, .17, .74, .77, .13], [1.56, .22, .7, .72, .1]),
    cabin: { z: [-.92, -.55, .12, .5], yB: .82, yR: 1.4, hwB: .71, hwR: .6, rr: .14 },
  },
  police: {
    length: 3.1, band: .3, mid: .55, wheels: { r: .3, w: .22, z: [1.02, -1.02] },
    lower: [PART.fixed, C.policeBlue], upper: [PART.fixed, C.police],
    body: keys([-1.55, .22, .73, .7, .1], [-1.49, .17, .8, .745, .12], [-1.15, .16, .82, .75, .14], [-.7, .16, .83, .75, .14], [.45, .16, .83, .75, .14], [1.1, .16, .76, .75, .14], [1.49, .17, .7, .745, .12], [1.55, .22, .66, .7, .1]),
    cabin: { z: [-.85, -.45, .15, .52], yB: .79, yR: 1.2, hwB: .69, hwR: .58, rr: .12 },
  },
  suv: {
    length: 2.7, band: .38, mid: .58, wheels: { r: .32, w: .24, z: [.86, -.86] },
    body: keys([-1.2, .26, .8, .72, .09], [-1.15, .2, .87, .745, .1], [-.9, .2, .89, .75, .12], [.45, .2, .89, .75, .12], [.95, .2, .84, .75, .12], [1.28, .21, .79, .745, .1], [1.35, .26, .75, .71, .09]),
    cabin: { z: [-1.12, -1.04, .3, .62], yB: .85, yR: 1.24, hwB: .7, hwR: .64, rr: .09, crown: .01 },
  },
  "hatchback-sports": {
    length: 2.85, band: .27, mid: .45, lamps: { y: .52, inset: .18 }, wheels: { r: .27, w: .21, z: [.92, -.92] },
    body: keys([-1.425, .2, .62, .6, .1], [-1.36, .15, .68, .645, .12], [-1, .14, .7, .65, .14], [.45, .14, .7, .65, .14], [1, .14, .62, .65, .14], [1.36, .15, .57, .645, .11], [1.425, .2, .53, .6, .09]),
    cabin: { z: [-1.3, -.42, .02, .55], yB: .66, yR: 1.08, hwB: .59, hwR: .48, rr: .12 },
  },
  van: {
    length: 2.75, band: .32, mid: .55, wheels: { r: .3, w: .22, z: [.88, -.9] },
    body: keys([-1.375, .22, .76, .71, .08], [-1.32, .17, .8, .745, .1], [-.9, .16, .82, .75, .12], [.8, .16, .82, .75, .12], [1.15, .16, .75, .75, .12], [1.33, .17, .7, .745, .1], [1.375, .22, .66, .71, .09]),
    cabin: { z: [-1.33, -1.25, .42, 1.02], yB: .755, yR: 1.33, hwB: .7, hwR: .66, rr: .1, crown: .01, pillar: .25 },
  },
  delivery: {
    length: 3.25, band: .34, mid: .58, wheels: { r: .31, w: .24, z: [1.08, -1.0] },
    body: keys([.48, .2, .84, .74, .08], [.6, .18, .86, .75, .1], [1.25, .18, .8, .75, .12], [1.57, .19, .74, .745, .1], [1.625, .24, .7, .71, .09]),
    cabin: { z: [.5, .52, .95, 1.3], yB: .77, yR: 1.36, hwB: .71, hwR: .68, rr: .1, crown: .01, pillar: .5 },
  },
  truck: {
    length: 2.95, band: .32, mid: .56, wheels: { r: .31, w: .23, z: [.95, -.95] },
    body: keys([-1.475, .22, .74, .71, .07], [-1.42, .17, .82, .745, .08], [-.4, .17, .83, .75, .1], [.5, .17, .83, .75, .12], [1.0, .17, .77, .75, .12], [1.42, .18, .71, .745, .1], [1.475, .23, .67, .71, .09]),
    cabin: { z: [-.36, -.3, .16, .52], yB: .8, yR: 1.28, hwB: .7, hwR: .62, rr: .1, pillar: -.1 },
  },
};

/** A pickup's open bed behind the cab: a dark floor and the sides' top rails. */
function bed(mb: MeshBuilder, paint: V3) {
  const z0 = -1.4, z1 = -.42, hw = .7;
  mb.detail(() => mb.quad([[-hw, .835, z1], [-hw, .835, z0], [hw, .835, z0], [hw, .835, z1]], { kind: as(PART.plastic), col: C.plastic, n: [0, 1, 0] }));
  for (const side of [-1, 1]) part(mb, [side * (hw + .02), .86, (z0 + z1) / 2], [.07, .07, z1 - z0 + .06], PART.paint, paint, .02);
  part(mb, [0, .86, z0 - .02], [hw * 2 + .1, .07, .07], PART.paint, paint, .02);
  part(mb, [0, .86, z1 + .03], [hw * 2 + .1, .07, .08], PART.paint, paint, .02);
}
/** The delivery truck's cargo box on its chassis, behind the cab. */
function cargo(mb: MeshBuilder) {
  part(mb, [0, .42, -.55], [1.24, .34, 2.1], PART.plastic, C.plastic, .02);
  mb.detail(() => box(mb, [-.75, .66, -1.625, .75, 1.65, .46], { c: .06, kind: as(PART.fixed), col: C.cargo, top: as(PART.fixed), occlude: true }));
  // A coloured band along its sides and its rear doors' seam.
  for (const side of [-1, 1]) part(mb, [side * .752, 1.2, -.58], [.012, .14, 1.9], PART.paint, C.white, .004);
  part(mb, [0, 1.15, -1.628], [.02, .9, .012], PART.plastic, C.plastic, .004);
}

/** The canal's small motor boat: white hull with a blue stripe, teak deck, a cabin with windows and a mast. */
function boat() {
  const mb = new MeshBuilder();
  // Hull sections stern to bow: keel y0, sheer y1, half width; the bow narrows to a point and lifts.
  const hull = (z: number) => {
    const t = (z + 1.06) / 2.12, bow = Math.max(0, (t - .7) / .3);
    return { y0: .02 + bow * bow * .2, y1: .36 + bow * bow * .05, hw: .5 * Math.sqrt(Math.max(.006, 1 - bow * bow * .97)) };
  };
  const zs = stations([-1.06, -1.0, .45, .8, 1.06], .14);
  const rings: Pt[][] = zs.map(z => {
    const { y0, y1, hw } = hull(z);
    return [[0, y0], [hw * .78, y0 + .1], [hw, y1 - .1], [hw, y1 - .02], [hw * .9, y1 + .01], [0, y1 + .025], [-hw * .9, y1 + .01], [-hw, y1 - .02], [-hw, y1 - .1], [-hw * .78, y0 + .1], [0, y0]];
  });
  loft(mb, zs, rings, (_, j) => j === 2 || j === 7 ? [PART.fixed, C.stripe] : j === 4 || j === 5 ? [PART.wood, C.deck] : [PART.fixed, C.hull]);
  cap(mb, rings[0], zs[0], false, PART.fixed, C.hull);
  // The cabin: rounded walls, glass all round below its roof, a windscreen leaning back.
  mb.detail(() => {
    box(mb, [-.3, .37, -.6, .3, .5, .1], { c: .04, kind: as(PART.fixed), col: C.hull, top: as(PART.fixed), occlude: false });
    box(mb, [-.29, .5, -.58, .29, .63, .08], { c: .03, kind: as(PART.glass), col: C.glass, top: as(PART.glass), occlude: false });
    box(mb, [-.31, .63, -.62, .31, .69, .1], { c: .03, kind: as(PART.fixed), col: C.hull, top: as(PART.fixed), occlude: false });
  });
  mb.quad([[-.28, .5, .1], [.28, .5, .1], [.26, .63, .02], [-.26, .63, .02]], { kind: as(PART.glass), col: C.glass });
  part(mb, [0, .75, -.35], [.03, .14, .03], PART.chrome, C.chrome, .006);
  return mb;
}

const cache = new Map<VehicleName, THREE.BufferGeometry>();
/**
 * The geometry of a vehicle, built once (a few milliseconds) and shared: the caller must not dispose it (it lives
 * for the session, like the ground's noise image). Facing +z, its wheels (or keel) on y = 0, centred in x and z.
 */
export function vehicleGeometry(name: VehicleName): THREE.BufferGeometry {
  let geometry = cache.get(name);
  if (geometry) return geometry;
  let mb: MeshBuilder;
  if (name === "boat") mb = boat();
  else {
    mb = car(SPECS[name], C.white);
    if (name === "taxi") {
      // The roof sign: a light box on a dark foot.
      part(mb, [0, 1.43, -.17], [.62, .05, .27], PART.plastic, C.plastic, .015);
      part(mb, [0, 1.52, -.17], [.6, .15, .24], PART.sign, C.sign, .03);
    }
    if (name === "police") {
      part(mb, [0, 1.23, -.12], [.7, .05, .22], PART.plastic, C.plastic, .015);
      part(mb, [-.18, 1.285, -.12], [.3, .07, .18], PART.tail, C.tail, .02);
      part(mb, [.18, 1.285, -.12], [.3, .07, .18], PART.blue, C.blueLamp, .02);
    }
    if (name === "suv") {
      for (const side of [-1, 1]) part(mb, [side * .5, 1.27, -.38], [.04, .04, 1.25], PART.plastic, C.plastic, .012);
      // The spare wheel on the tailgate.
      mb.frame([0, .74, -1.2], [1, 0, 0], [0, 0, -1], [0, 1, 0], () => cylinder(mb, { x: 0, z: 0, y0: 0, y1: .15, r: .25, seg: 12, kind: as(PART.rubber), col: C.rubber, top: as(PART.plastic), topCol: C.plastic, occlude: false }));
    }
    if (name === "hatchback-sports") part(mb, [0, 1.06, -.5], [.9, .03, .16], PART.paint, C.white, .012);
    if (name === "truck") bed(mb, C.white);
    if (name === "delivery") cargo(mb);
  }
  bakeOcclusion(mb, { reach: .45, ground: .5, strength: .85, rays: 16 });
  geometry = mb.build(1);
  geometry.name = `vehicle-${name}`;
  cache.set(name, geometry);
  return geometry;
}

/** The vehicles' shades of paint: copy tints the paint takes (the rest keeps its colour). */
export const PAINTS: Record<VehicleName, string[]> = {
  taxi: ["#ffffff"], police: ["#ffffff"], boat: ["#ffffff"],
  sedan: ["#c8ccd2", "#2c3b57", "#8e1f22", "#eeeeea", "#25282d", "#3f6d55", "#6d7c90", "#b9a37e"],
  suv: ["#2f3236", "#e8e8e4", "#4c5b3f", "#7c2026", "#8d969f", "#1f3149"],
  "hatchback-sports": ["#c8262f", "#f0c02e", "#1f5fa8", "#ececea", "#ff7a1a", "#2b2d31"],
  van: ["#ecedea", "#b8bfc6", "#30455e", "#d8d2c2"],
  delivery: ["#e14b2a", "#2f6db5", "#3a9a5b", "#f2b01e"],
  truck: ["#3f6d55", "#b5392c", "#e6e3db", "#4d5560", "#2c3b57"],
};

type Node = ShaderNodeObject<THREE.Node>;
/**
 * The vehicles' material, for copy meshes (render/copies.ts): only the paint takes the copy's tint (a car park's or
 * the traffic's colours), every other surface keeps its own colour. Paint, glass and chrome mirror the sky of the moment
 * (`look`, render/sky.ts) by Fresnel; the body's sides darken into wheel arches round the wheels (aWin: the wheels'
 * z, the arch's radius, the axle's height), with a soft edge one pixel wide.
 */
export function vehicleMaterial(look: SkyLook | null = null): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .5, metalness: 0 });
  material.vertexColors = false; material.userData.copyTint = "own";
  const surf = attribute("aSurf", "vec4"), arch = attribute("aWin", "vec4"), kind = surf.z, ao = surf.w, base = vertexColor().xyz;
  const is = (part: Part): Node => float(1).sub(step(.5, abs(kind.sub(part))));
  const tint = varyingProperty("vec3", "vInstanceColor");
  const p = positionGeometry, side = smoothstep(.45, .7, abs(normalGeometry.x));
  // Wheel arches: a dark well round each wheel on the sides of the body.
  const reach = min(vec2(p.z.sub(arch.x), p.y.sub(arch.w)).length(), vec2(p.z.sub(arch.y), p.y.sub(arch.w)).length());
  // Only the body's own sides carry the wheels' places: elsewhere aWin holds 99 (or a box's bays and a 2.9 floor).
  const valid = step(abs(arch.x), float(2.5)).mul(step(abs(arch.y), float(2.5)));
  const well = float(1).sub(smoothstep(arch.z.sub(fwidth(reach)), arch.z.add(fwidth(reach)), reach)).mul(side).mul(valid);
  // A taxi's band of chequers, fading to grey once its squares are finer than a pixel.
  const cell = vec2(p.z.div(.13), p.y.div(.09)), squares = fract(floor(cell.x).add(floor(cell.y)).mul(.5)).mul(2);
  const blur = smoothstep(.35, .9, max(fwidth(cell.x), fwidth(cell.y)));
  const checker = mix(mix(vec3(.02, .02, .025), vec3(.92, .92, .9), squares), vec3(.47), blur);
  const painted = is(PART.paint);
  const surface = mix(mix(mix(base, base.mul(tint), painted), checker, is(PART.checker)), color("#0d0e10"), well);
  material.colorNode = surface.mul(ao);
  const glass = is(PART.glass), chrome = is(PART.chrome), rubber = is(PART.rubber), lamp = is(PART.head).add(is(PART.tail)).add(is(PART.blue)).add(is(PART.sign));
  material.roughnessNode = mix(float(.62), float(.3), painted.add(is(PART.fixed)).add(is(PART.checker))).sub(glass.mul(.55)).sub(chrome.mul(.38)).add(rubber.mul(.3)).sub(lamp.mul(.32)).add(well.mul(.3)).clamp(.05, 1);
  material.metalnessNode = chrome.mul(.35);
  // The sky in the lacquer and the glass: Fresnel from the view's angle, the sky's gradient in the reflected direction.
  const view = cameraPosition.sub(positionWorld).normalize(), facing = max(dot(normalWorld, view), 0);
  const fresnel = float(.04).add(pow(facing.oneMinus(), 5).mul(.96)), reflected = reflect(view.negate(), normalWorld);
  const sky = skyGradient(look, vec3(reflected.x, max(reflected.y, 0), reflected.z));
  const gloss = painted.add(is(PART.fixed)).mul(.5).add(glass.mul(1.4)).add(chrome.mul(.7)).add(lamp.mul(.4)).mul(well.oneMinus());
  material.emissiveNode = sky.mul(fresnel).mul(gloss).mul(ao);
  return material;
}
