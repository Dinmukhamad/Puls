/**
 * The Eiffel Tower, built in code in the city's v4 style (docs/CITY_V4.md): a model ready for the shop, not placed in
 * the city yet. True proportions in metres: 330 m to the antenna's tip, a 125 m square at the ground, the first floor
 * at 57.6 m, the second at 115.7 m, the top at 276 m.
 *
 * About 2,000 triangles: the geometry is the tower's big surfaces only — the four legs as hollow columns whose outer
 * corners follow the tower's curve and which merge into the shaft above the second floor, the shaft's faces between
 * them, the central lift column, the four arches, the floors with their frieze, balustrades and pavilions, the top's
 * cabin, lantern and antenna, the stone feet. The ironwork's lattice is drawn by the material (eiffelMaterial): each
 * lattice face carries its place across (u) and along it in panels (t), the shader keeps the corner girders, the
 * belts and the crossed diagonals and cuts the rest out, in the light and in the shadow map alike. Its bars never get
 * thinner than a pixel, so far away the lattice closes up into the tower's silhouette instead of shimmering.
 *
 * Painted as the real one is, darker at the foot and lighter towards the top so that it reads as one colour against
 * the sky; at night it glows gold from inside and, for twenty seconds every two minutes, sparkles.
 */
import * as THREE from "three/webgpu";
import { Fn, abs, attribute, color, float, floor, fract, fwidth, hash, max, min, mix, positionGeometry, smoothstep, step, time, vec2, vec4, type ShaderNodeObject } from "three/tsl";
import { MeshBuilder, box, cylinder, dome, rgb, type Face, type V3 } from "./facade";

/** Surfaces of the tower in aSurf.z; the builder's boxes treat 0, 5 and 11 specially, so those are left out. */
export const IRON = { solid: 1, lattice: 3, frieze: 4, rail: 6, glass: 7, deck: 8, stone: 9, lamp: 10 } as const;
type Kind = typeof IRON[keyof typeof IRON];
const as = (kind: Kind) => kind as unknown as Face;

/** The levels, metres. */
export const EIFFEL = { height: 330, base: 125, first: 57.6, second: 115.7, top: 276.1 } as const;
/** Half the tower's width at a leg's outer corner at height h: the curve of the legs, then the shaft's taper. */
const outer = (h: number) => 62.5 * Math.exp(-h / 101) + h / 276 * 1.2;
/** A leg's width at height h (25 m at the ground, 15 at the first floor, 9 at the second, 2 at the top). */
const legWidth = (h: number) => 25 * Math.exp(-h / 112.7);
const inner = (h: number) => outer(h) - legWidth(h);
/** A lattice panel is about as tall as its face is wide; the corner girders take this share of a face's width. */
const PANEL = 1.05, GIRDER = .11;

const STONE = rgb("#cfc5b1"), IRONWORK = rgb("#ffffff"), GLASS = rgb("#2c3a46"), DECK = rgb("#8d857a"), RED = rgb("#ff2a1a");

/** Heights from `from` to `to`, closer together low down, through every level in `through`. */
function heights(from: number, to: number, count: number, through: number[] = []) {
  const list = Array.from({ length: count + 1 }, (_, k) => from + (to - from) * Math.pow(k / count, 1.25));
  return [...new Set([...list, ...through.filter(h => h > from && h < to)].map(h => Math.round(h * 1e3) / 1e3))].sort((a, b) => a - b);
}
/** The lattice panel count from the foot to each height, for faces `width(h)` wide. */
function panels(hs: number[], width: (h: number) => number, panel = PANEL) {
  const t = [0];
  for (let k = 1; k < hs.length; k++) t.push(t[k - 1] + (hs[k] - hs[k - 1]) / (panel * width((hs[k] + hs[k - 1]) / 2)));
  return t;
}

/**
 * A lattice face from its corners at the bottom (a0 at u = 0, a1 at u = 1) and the top (b0, b1), panels ta to tb
 * along it. Drawn from both sides by the material.
 */
function lattice(mb: MeshBuilder, a0: V3, a1: V3, b1: V3, b0: V3, ta: number, tb: number) {
  mb.quad([a0, a1, b1, b0], { kind: as(IRON.lattice), col: IRONWORK, uv: [[0, ta], [1, ta], [1, tb], [0, tb]] });
}

/** The four legs from the ground to the top: hollow columns with lattice faces, merging into the shaft's corners. */
function legs(mb: MeshBuilder) {
  const hs = heights(0, EIFFEL.top, 34, [EIFFEL.first, EIFFEL.second]), t = panels(hs, legWidth);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let k = 0; k + 1 < hs.length; k++) {
    const a = hs[k], b = hs[k + 1];
    const P = (h: number, x: number, z: number): V3 => [sx * x, h, sz * z];
    const [ia, oa, ib, ob] = [inner(a), outer(a), inner(b), outer(b)];
    // Outer and inner faces across x, then across z: u from the inner edge to the outer.
    lattice(mb, P(a, oa, ia), P(a, oa, oa), P(b, ob, ob), P(b, ob, ib), t[k], t[k + 1]);
    lattice(mb, P(a, ia, ia), P(a, ia, oa), P(b, ib, ob), P(b, ib, ib), t[k], t[k + 1]);
    lattice(mb, P(a, ia, oa), P(a, oa, oa), P(b, ob, ob), P(b, ib, ob), t[k], t[k + 1]);
    lattice(mb, P(a, ia, ia), P(a, oa, ia), P(b, ob, ib), P(b, ib, ib), t[k], t[k + 1]);
  }
}

/** The shaft's four faces between the legs above the second floor, and the central lift column inside. */
function shaft(mb: MeshBuilder) {
  const hs = heights(EIFFEL.second, EIFFEL.top, 14), t = panels(hs, h => 2 * inner(h), .8);
  for (let side = 0; side < 4; side++) mb.turned(0, 0, side * Math.PI / 2, () => {
    for (let k = 0; k + 1 < hs.length; k++) {
      const a = hs[k], b = hs[k + 1], ia = inner(a), ib = inner(b), oa = outer(a), ob = outer(b);
      lattice(mb, [-ia, a, oa], [ia, a, oa], [ib, b, ob], [-ib, b, ob], t[k], t[k + 1]);
    }
  });
  const c = 2.3, tc = panels(hs, () => 2 * c, 1);
  for (let side = 0; side < 4; side++) mb.turned(0, 0, side * Math.PI / 2, () => {
    for (let k = 0; k + 1 < hs.length; k++) lattice(mb, [-c, hs[k], c], [c, hs[k], c], [c, hs[k + 1], c], [-c, hs[k + 1], c], tc[k], tc[k + 1]);
  });
}

/**
 * The four great arches under the first floor, one on each side between two legs: a lattice band springing from the
 * legs' inner faces near the ground and rising to just under the floor's frieze.
 */
function arches(mb: MeshBuilder) {
  const spring = 14, crown = 41, band = 3.6, depth = 2.4, z = (inner(spring) + outer(spring)) / 2, R = inner(spring) + 1, segments = 24;
  const at = (theta: number, out: number): [number, number] => [-Math.cos(theta) * (R + out), spring + Math.sin(theta) * (crown - spring + out)];
  // The band's length in panels as tall as it is wide.
  const length: number[] = [0];
  for (let i = 1; i <= segments; i++) {
    const [x0, y0] = at(Math.PI * (i - 1) / segments, band / 2), [x1, y1] = at(Math.PI * i / segments, band / 2);
    length.push(length[i - 1] + Math.hypot(x1 - x0, y1 - y0) / band);
  }
  for (let side = 0; side < 4; side++) mb.turned(0, 0, side * Math.PI / 2, () => {
    for (let i = 0; i < segments; i++) {
      const t0 = Math.PI * i / segments, t1 = Math.PI * (i + 1) / segments;
      const [ax, ay] = at(t0, 0), [bx, by] = at(t1, 0), [cx, cy] = at(t1, band), [dx, dy] = at(t0, band);
      for (const zz of [z - depth / 2, z + depth / 2]) lattice(mb, [ax, ay, zz], [dx, dy, zz], [cx, cy, zz], [bx, by, zz], length[i], length[i + 1]);
      // The intrados and the extrados: solid iron.
      mb.quad([[ax, ay, z - depth / 2], [bx, by, z - depth / 2], [bx, by, z + depth / 2], [ax, ay, z + depth / 2]], { kind: as(IRON.solid), col: IRONWORK });
      mb.quad([[dx, dy, z + depth / 2], [cx, cy, z + depth / 2], [cx, cy, z - depth / 2], [dx, dy, z - depth / 2]], { kind: as(IRON.solid), col: IRONWORK });
    }
  });
}

/** A square band round the tower at half width w from y0 to y1, of `kind`, its u in metres along each side. */
function band(mb: MeshBuilder, w: number, y0: number, y1: number, kind: Kind) {
  for (let side = 0; side < 4; side++) mb.turned(0, 0, side * Math.PI / 2, () => {
    mb.quad([[-w, y0, w], [w, y0, w], [w, y1, w], [-w, y1, w]], { kind: as(kind), col: IRONWORK, uv: [[0, y0], [2 * w, y0], [2 * w, y1], [0, y1]], win: [y0, y1, 0, 0] });
  });
}
/** A floor: a square ring of deck from half width `hole` to `w`, `thick` deep under `y`. */
function floorRing(mb: MeshBuilder, w: number, hole: number, y: number, thick: number) {
  const o = { c: 0, kind: as(IRON.solid), col: IRONWORK, top: as(IRON.deck), topCol: DECK, bottom: true, occlude: false };
  box(mb, [-w, y - thick, hole, w, y, w], o);
  box(mb, [-w, y - thick, -w, w, y, -hole], o);
  box(mb, [hole, y - thick, -hole, w, y, hole], o);
  box(mb, [-w, y - thick, -hole, -hole, y, hole], o);
}

function floors(mb: MeshBuilder) {
  // The first floor: its deck, the frieze of arches under it, balustrades and the glass pavilions between the legs.
  const f1 = EIFFEL.first, w1 = 36.2;
  floorRing(mb, w1, 20, f1, 2.2);
  band(mb, w1 + .05, f1 - 7.6, f1 - 2.2, IRON.frieze);
  band(mb, w1, f1, f1 + 1.3, IRON.rail);
  band(mb, 20, f1, f1 + 1.1, IRON.rail);
  for (let side = 0; side < 4; side++) mb.turned(0, 0, side * Math.PI / 2, () => {
    box(mb, [-11, f1, 22.5, 11, f1 + 4.6, 29.5], { c: .3, kind: as(IRON.glass), col: GLASS, top: as(IRON.solid), topCol: IRONWORK, occlude: false });
  });
  // The second floor: a deeper deck round the lift column's well, a band and a balustrade.
  const f2 = EIFFEL.second, w2 = 21.6;
  floorRing(mb, w2, 8.5, f2, 2.6);
  band(mb, w2 + .05, f2 - 4.4, f2 - 2.6, IRON.frieze);
  band(mb, w2, f2, f2 + 1.3, IRON.rail);
  // The top: the glazed cabin, the open platform on it, Eiffel's rooms and the lantern, the antenna.
  const f3 = EIFFEL.top;
  box(mb, [-8.4, f3 - 2.6, -8.4, 8.4, f3, 8.4], { c: 0, kind: as(IRON.solid), col: IRONWORK, top: as(IRON.deck), topCol: DECK, bottom: true, occlude: false });
  box(mb, [-8, f3, -8, 8, f3 + 5.6, 8], { c: .2, kind: as(IRON.glass), col: GLASS, top: as(IRON.deck), topCol: DECK, occlude: false });
  band(mb, 8.4, f3 + 5.6, f3 + 7, IRON.rail);
  // Eiffel's rooms with their little windows, the lattice belfry over them, the glazed lantern of the beacon, its dome.
  box(mb, [-4.6, f3 + 5.6, -4.6, 4.6, f3 + 8.6, 4.6], { c: .2, kind: as(IRON.glass), col: GLASS, top: as(IRON.solid), topCol: IRONWORK, occlude: false });
  for (let side = 0; side < 4; side++) mb.turned(0, 0, side * Math.PI / 2, () => lattice(mb, [-4, f3 + 8.6, 4], [4, f3 + 8.6, 4], [2.7, f3 + 13.4, 2.7], [-2.7, f3 + 13.4, 2.7], 0, .7));
  box(mb, [-2.9, f3 + 13.4, -2.9, 2.9, f3 + 13.9, 2.9], { c: 0, kind: as(IRON.solid), col: IRONWORK, top: as(IRON.solid), bottom: true, occlude: false });
  cylinder(mb, { x: 0, z: 0, y0: f3 + 13.9, y1: f3 + 16.4, r: 2.3, seg: 12, kind: as(IRON.glass), col: GLASS, top: null, occlude: false });
  dome(mb, { x: 0, z: 0, y0: f3 + 16.4, r: 2.5, rise: 1.9, seg: 12, rings: 3, kind: as(IRON.solid), col: IRONWORK, occlude: false });
  cylinder(mb, { x: 0, z: 0, y0: f3 + 17.5, y1: EIFFEL.height - 1.2, r: .95, r1: .38, seg: 8, kind: as(IRON.solid), col: IRONWORK, top: null, occlude: false });
  for (const y of [302, 314]) cylinder(mb, { x: 0, z: 0, y0: y, y1: y + .9, r: 1.25, seg: 8, kind: as(IRON.solid), col: IRONWORK, top: as(IRON.solid), bottom: true, occlude: false });
  cylinder(mb, { x: 0, z: 0, y0: EIFFEL.height - 1.2, y1: EIFFEL.height, r: .45, seg: 8, kind: as(IRON.lamp), col: RED, top: as(IRON.lamp), topCol: RED, occlude: false });
}

/** The legs' stone feet. */
function feet(mb: MeshBuilder) {
  const half = legWidth(0) / 2 + 1.6, centre = (inner(0) + outer(0)) / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    box(mb, [sx * centre - half, 0, sz * centre - half, sx * centre + half, 3.2, sz * centre + half], { c: .4, kind: as(IRON.stone), col: STONE, top: as(IRON.stone), topCol: STONE, occlude: false });
}

let built: THREE.BufferGeometry | null = null;
/** The tower in metres, its axis on the origin, standing on y = 0; built once and kept (a few milliseconds). */
export function eiffelTowerGeometry(): THREE.BufferGeometry {
  if (built) return built;
  const mb = new MeshBuilder();
  feet(mb); legs(mb); shaft(mb); arches(mb); floors(mb);
  built = mb.build(1);
  built.name = "eiffel-tower";
  return built;
}

type Node = ShaderNodeObject<THREE.Node>;
/** The paint: darker at the foot, lighter towards the top (the real tower's three shades, blended). */
const PAINT_FOOT = "#6a5136", PAINT_TOP = "#ad8d61";
/**
 * The tower's material, drawn from both sides. The lattice (IRON.lattice): corner girders along both edges of a face,
 * a belt at every panel's top and bottom, the panel's two diagonals, the rest cut out; the frieze: a row of round-headed
 * arches cut out of a solid band; the balustrades: thin bars between two rails; the glass: panes between mullions.
 * Every bar keeps at least about a pixel's width, so the openings close up with distance instead of shimmering. The
 * same cut is made in the shadow map (castShadowNode). `night` (0…1) lights the iron gold from inside and the top's
 * windows; `sparkle` (default on) adds the glitter of its lights, twenty seconds every two minutes.
 */
export function eiffelMaterial(night: Node, { sparkle = true }: { sparkle?: boolean } = {}): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .6, metalness: .15, side: THREE.DoubleSide });
  const surf = attribute("aSurf", "vec4"), band = attribute("aWin", "vec4"), u = surf.x, v = surf.y, kind = surf.z, p = positionGeometry;
  const is = (k: Kind): Node => float(1).sub(step(.5, abs(kind.sub(k))));
  /** 1 within `half` of a line `distance` away; the half width is at least `pixels` pixels of `coord`. */
  const bar = (distance: Node, half: number | Node, coord: Node, pixels = .7): Node => step(distance, max(half, fwidth(coord).mul(pixels)));
  // The lattice: u across the face (0…1), v along it in panels.
  const s = fract(v);
  // The corner girders are lattice girders themselves: two flanges and a zigzag web between them, which close up
  // into a solid girder as soon as they are finer than a pixel.
  const edge = min(u, u.oneMinus()), inGirder = step(edge, float(GIRDER)), gu = edge.div(GIRDER), gt = v.mul(PANEL / GIRDER);
  const flanges = max(bar(gu, .26, gu), bar(gu.oneMinus(), .26, gu));
  const web = bar(abs(float(1).sub(abs(fract(gt.mul(.5)).mul(2).sub(1))).sub(gu.sub(.26).div(.48).clamp(0, 1))), .17, gt);
  const girders = inGirder.mul(max(flanges, web));
  const belts = max(bar(s, .05, v), bar(s.oneMinus(), .05, v));
  const diagonals = max(bar(abs(u.sub(s)).mul(.7071), .032, u.sub(s)), bar(abs(u.add(s).sub(1)).mul(.7071), .032, u.add(s)));
  const lattice = max(max(girders, belts), diagonals);
  // The frieze (u, v in metres; aWin: the band's bottom and top): round-headed arches 4.6 m apart, 3.4 m wide.
  const rel = v.sub(band.x), height = band.y.sub(band.x), x = fract(u.div(4.6)).sub(.5).mul(4.6), r = float(1.7);
  const springing = height.sub(.9).sub(r);
  const rect = max(max(abs(x).sub(r), float(.5).sub(rel)), rel.sub(springing)), head = vec2(x, rel.sub(springing)).length().sub(r);
  const frieze = step(fwidth(u).mul(-.7), min(rect, head));
  // The balustrade: bars every 0.45 m between a rail along its top and one along its bottom.
  const rx = abs(fract(u.div(.45)).sub(.5)).mul(.45);
  const rail = max(bar(rx, .045, u), max(bar(rel, .12, v), bar(height.sub(rel), .12, v)));
  const coverage = mix(mix(mix(float(1), lattice, is(IRON.lattice)), frieze, is(IRON.frieze)), rail, is(IRON.rail));
  material.maskNode = coverage.greaterThan(.5);
  material.castShadowNode = Fn(() => { coverage.lessThan(.5).discard(); return vec4(0, 0, 0, 1); })();
  // Colour: the painted iron by height; deck, stone and lamp from the vertices; glass dark between iron mullions.
  const iron = is(IRON.solid).add(is(IRON.lattice)).add(is(IRON.frieze)).add(is(IRON.rail)), glass = is(IRON.glass);
  const paint = mix(color(PAINT_FOOT), color(PAINT_TOP), smoothstep(0, 300, p.y));
  const mullion = bar(abs(fract(u.div(1.6)).sub(.5)).oneMinus().sub(.5).mul(1.6), .07, u);
  const base = attribute("color", "vec3");
  material.colorNode = mix(mix(base, paint, iron), mix(base, paint, mullion), glass);
  material.roughnessNode = mix(mix(float(.85), float(.55), iron), mix(float(.08), float(.55), mullion), glass);
  material.metalnessNode = iron.mul(.2);
  // Night: gold from the lamps inside the ironwork, the top's windows lit, the red light on the antenna, the glitter.
  const gold = color("#ffc35c").mul(iron).mul(smoothstep(0, 330, p.y).mul(-.2).add(.5));
  const windows = color("#ffd59a").mul(glass).mul(mullion.oneMinus()).mul(.9);
  const red = color("#ff2a1a").mul(is(IRON.lamp)).mul(night.mul(2.5).add(.6));
  let glow: Node = gold.add(windows).mul(night).add(red);
  if (sparkle) {
    // Cells 6 m across: a point of light at each one's centre, blinking at its own phase; only while the glitter is on,
    // only on iron, and only while a cell is a few pixels across (smaller ones would read as noise).
    const q = p.div(6), cell = floor(q), centre = fract(q).sub(.5).length();
    const phase = hash(cell.x.mul(73).add(cell.y.mul(157)).add(cell.z.mul(311)));
    const on = step(.7, fract(phase.mul(13.7).add(time.mul(2.3)))).mul(step(fract(time.div(120)), 20 / 120));
    const dot = step(centre, max(float(.06), fwidth(q.x).mul(1.2))).mul(float(1).sub(smoothstep(.12, .25, fwidth(q.x))));
    glow = glow.add(color("#eef3ff").mul(on).mul(dot).mul(iron).mul(night).mul(6));
  }
  material.emissiveNode = glow;
  return material;
}
