/**
 * The ground of the city, ported from the old cityScene.ts and driven by WorldData: land rings and islets
 * with stone quay walls and beige rims, the ground out to the fog, the lagoon and canal floor, ring roads
 * with lane marks, streets, lagoon bridges with railings trimmed to the curved shore and piers, stone arch
 * bridges over the canal, zebra crossings and car parks. Everything is painted with vertex colours and
 * merged into two meshes with one material: flat ground that only receives shadows, and the structures
 * (quay walls, bridges) that also cast them. The whole terrain is two draw calls.
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import type { Road, WorldData } from "../world/types";

const GRASS = "#8ba67a", GROUND = "#86a174", STONE = "#d4cab6", RIM = "#eadfc8", ROAD = "#6d7385", KERB = "#e5dfcf", MARK = "#f7f3e8";
const DECK = "#dcd3c1", RAIL = "#e8e1d2", PIER = "#cfc5b1", PAD = "#7c8292", PLAZA = "#efe7d6", FLOOR = "#56766f", PARK = "#7f9f6a";
/** Land top, quay wall foot, water floor. */
const TOP = .2, FOOT = -1.75, BED = -1.7;

export interface Terrain { group: THREE.Group; dispose(): void }

/** Collects painted triangles into one indexed geometry. */
class Mesher {
  private positions: number[] = []; private normals: number[] = []; private colors: number[] = []; private indices: number[] = [];
  private count = 0; private paint = new THREE.Color();
  color(hex: string) { this.paint.set(hex); return this; }
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
    this.positions.push(x, y, z); this.normals.push(nx, ny, nz); this.colors.push(this.paint.r, this.paint.g, this.paint.b);
    return this.count++;
  }
  quad(a: number, b: number, c: number, d: number) { this.indices.push(a, b, c, a, c, d); }
  /** Appends a three geometry, moved by `matrix`, in the current colour. */
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) {
    const g = geometry.applyMatrix4(matrix), position = g.getAttribute("position"), normal = g.getAttribute("normal"), start = this.count;
    for (let i = 0; i < position.count; i++) this.vertex(position.getX(i), position.getY(i), position.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i));
    if (g.index) for (let i = 0; i < g.index.count; i++) this.indices.push(start + g.index.getX(i));
    else for (let i = 0; i < position.count; i++) this.indices.push(start + i);
    geometry.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Segments for a circle of radius r: about one per unit of arc, so edges at the same radius line up. */
const segmentsFor = (r: number) => Math.min(1024, Math.max(48, Math.round(r * 2 * Math.PI / .9)));

/** A flat ring (or disc when r0 = 0) facing up at height y, centred at (cx, cz). */
function ring(m: Mesher, r0: number, r1: number, y: number, cx = 0, cz = 0) {
  const n = segmentsFor(r1);
  let prevIn = -1, prevOut = -1, firstIn = -1, firstOut = -1;
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const vIn = i === n ? firstIn : m.vertex(cx + c * r0, y, cz + s * r0, 0, 1, 0), vOut = i === n ? firstOut : m.vertex(cx + c * r1, y, cz + s * r1, 0, 1, 0);
    if (i === 0) { firstIn = vIn; firstOut = vOut; } else m.quad(prevIn, vIn, vOut, prevOut);
    prevIn = vIn; prevOut = vOut;
  }
}
/** A vertical circular wall; `outward` walls face away from the centre (islets), the others towards it (banks). */
function wall(m: Mesher, r: number, y0: number, y1: number, outward: boolean, cx = 0, cz = 0) {
  const n = segmentsFor(r), sign = outward ? 1 : -1;
  let prevLow = -1, prevHigh = -1;
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const low = m.vertex(cx + c * r, y0, cz + s * r, c * sign, 0, s * sign), high = m.vertex(cx + c * r, y1, cz + s * r, c * sign, 0, s * sign);
    if (i > 0) { if (outward) m.quad(prevLow, prevHigh, high, low); else m.quad(prevLow, low, high, prevHigh); }
    prevLow = low; prevHigh = high;
  }
}
/** A box without its bottom, `width` across and `length` along direction `angle` (atan2(dx, dz)). */
function slab(m: Mesher, cx: number, cz: number, angle: number, width: number, length: number, y0: number, y1: number) {
  box.makeRotationY(angle).setPosition(cx, (y0 + y1) / 2, cz);
  const g = new THREE.BoxGeometry(width, y1 - y0, length), index = Array.from(g.index!.array);
  g.setIndex([...index.slice(0, 18), ...index.slice(24)]);
  m.add(g, box);
}
/** A flat mark lying on the ground (lane dashes, zebra stripes, stall lines): two triangles. */
function mark(m: Mesher, cx: number, cz: number, angle: number, width: number, length: number, y: number) {
  const s = Math.sin(angle), c = Math.cos(angle), ax = c * width / 2, az = -s * width / 2, bx = s * length / 2, bz = c * length / 2;
  const v = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, w]) => m.vertex(cx + ax * u + bx * w, y, cz + az * u + bz * w, 0, 1, 0));
  m.quad(v[0], v[3], v[2], v[1]);
}
const box = new THREE.Matrix4();

export function createTerrain(ctx: CityContext): Terrain {
  const world = ctx.world, flat = new Mesher(), solid = new Mesher();
  land(world, flat, solid);
  roads(world, flat, solid);
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .8, metalness: .04 });
  const group = new THREE.Group(); group.name = "city-terrain";
  const ground = new THREE.Mesh(flat.build(), material), structures = new THREE.Mesh(solid.build(), material);
  ground.receiveShadow = true; structures.castShadow = structures.receiveShadow = true;
  for (const mesh of [ground, structures]) { mesh.matrixAutoUpdate = false; group.add(mesh); }
  ctx.scene.add(group);
  ctx.requestShadowUpdate();
  return {
    group,
    dispose() { ctx.scene.remove(group); ground.geometry.dispose(); structures.geometry.dispose(); material.dispose(); },
  };
}

/** Land rings, islets, the ground beyond, the water floor, the plaza, the promenade and the parks. */
function land(world: WorldData, flat: Mesher, solid: Mesher) {
  const { spec } = world, water = world.water.annuli, near = (a: number, b: number) => Math.abs(a - b) < .75;
  const wet = (r: number) => water.some(w => near(w.inner, r) || near(w.outer, r));
  // Everything fades into the fog long before this; the edge must never show.
  const far = Math.max(720, world.radius * 3.2);
  const annuli = [...world.land.annuli].sort((a, b) => a.inner - b.inner);
  annuli.forEach((a, i) => {
    const last = i === annuli.length - 1, inner = wet(a.inner), outer = wet(a.outer);
    flat.color(inner && outer ? GRASS : GROUND); ring(flat, a.inner, last && near(a.outer, world.radius) ? far : a.outer, TOP);
    // Stone quay walls where the land meets the water, beige rims along their top; the far bank's rim is wider.
    solid.color(STONE);
    if (inner) wall(solid, a.inner, FOOT, TOP + .005, false);
    if (outer) wall(solid, a.outer, FOOT, TOP + .005, true);
    flat.color(RIM);
    if (inner) ring(flat, a.inner, a.inner + (last ? 1 : .32), TOP + .005);
    if (outer) ring(flat, a.outer - .32, a.outer, TOP + .005);
  });
  for (const islet of world.land.islets) {
    flat.color(GRASS); ring(flat, 0, islet.r, TOP, islet.x, islet.z);
    solid.color(STONE); wall(solid, islet.r, FOOT, TOP + .005, true, islet.x, islet.z);
    flat.color(RIM); ring(flat, islet.r - .32, islet.r, TOP + .005, islet.x, islet.z);
  }
  flat.color(FLOOR);
  for (const w of water) ring(flat, w.inner, w.outer, BED);
  // The paved plaza, a little above the islet, and the promenade on the quay.
  flat.color(PLAZA); ring(flat, 0, spec.plaza, TOP + .11); wall(flat, spec.plaza, TOP - .01, TOP + .11, true);
  flat.color(RIM); ring(flat, spec.promenade - .5, spec.promenade + .5, TOP + .015);
  flat.color(PARK);
  for (const park of world.parks) ring(flat, 0, 2.2, TOP + .003, park.x, park.z);
}

/** Ring roads, streets, bridges, crossings and car parks. */
function roads(world: WorldData, flat: Mesher, solid: Mesher) {
  world.roads.rings.forEach((r, i) => {
    flat.color(ROAD); ring(flat, r - 1, r + 1, TOP + .015);
    // Dashes every 1.4 units on the inner ring road and every 2.6 on the others, as in the old city.
    const count = Math.round(2 * Math.PI * r / (i === 0 ? 1.43 : 2.6));
    flat.color(MARK);
    for (let k = 0; k < count; k++) { const a = k / count * Math.PI * 2; mark(flat, Math.cos(a) * r, Math.sin(a) * r, -a, .14, .72, TOP + .025); }
  });
  for (const road of world.roads.streets) street(flat, road, TOP - .06);
  for (const { road, canal } of world.roads.bridges) {
    if (canal) canalBridge(solid, flat, road);
    else lagoonBridge(world, solid, flat, road);
  }
  // Zebra crossings: five stripes along the street, side by side across it.
  flat.color(MARK);
  for (const w of world.roads.crosswalks) for (let k = -2; k <= 2; k++) mark(flat, w.x + Math.cos(w.angle) * k * .4, w.z - Math.sin(w.angle) * k * .4, w.angle, .24, .95, TOP + .068);
  // Car parks: a pad with painted lines between the stalls.
  for (const lot of world.roads.parking) {
    flat.color(PAD); slab(flat, lot.x, lot.z, lot.angle, lot.depth + .4, lot.length + .4, TOP, TOP + .05);
    flat.color(MARK);
    for (const stall of lot.stalls) for (const side of [-.55, .55]) mark(flat, stall.x + Math.sin(lot.angle) * side, stall.z + Math.cos(lot.angle) * side, stall.rotation, .05, 1.5, TOP + .055);
  }
}

const along = ([ax, az, bx, bz]: Road) => { const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz); return { dx, dz, length, angle: Math.atan2(dx, dz), cx: (ax + bx) / 2, cz: (az + bz) / 2 }; };
/** A street: kerbs, the road surface and centre dashes every 2.2 units; `base` is the bottom of the kerb. */
function street(m: Mesher, road: Road, base: number) {
  const { dx, dz, length, angle, cx, cz } = along(road), [ax, az] = road;
  m.color(KERB); slab(m, cx, cz, angle, 2.65, length, base, TOP + .02);
  m.color(ROAD); slab(m, cx, cz, angle, 2, length, TOP, TOP + .06);
  m.color(MARK);
  for (let t = 1.2; t < length - .8; t += 2.2) mark(m, ax + dx * t / length, az + dz * t / length, angle, .14, .8, TOP + .065);
}

/**
 * A bridge over the lagoon: deck, street, railings and piers down to the water. The deck reaches 0.3
 * onto the land; railings, 1.3 off the centre line, stop where the curved shore meets them: a little
 * farther in on the round plaza and islands, a little sooner at the lagoon shore.
 */
function lagoonBridge(world: WorldData, solid: Mesher, flat: Mesher, road: Road) {
  const { length, angle, cx, cz } = along(road), [ax, az, bx, bz] = road, ux = Math.sin(angle), uz = Math.cos(angle);
  solid.color(DECK); slab(solid, cx, cz, angle, 2.75, length, TOP - .36, TOP - .02);
  street(flat, road, TOP - .02);
  const trim = (x: number, z: number) => {
    const islet = world.land.islets.find(i => Math.abs(Math.hypot(x - i.x, z - i.z) - i.r) < 1);
    const shore = islet ? islet.r : -(world.land.annuli.find(a => Math.abs(Math.hypot(x, z) - a.inner) < 1)?.inner ?? world.spec.lagoon);
    const bend = Math.abs(shore) - Math.sqrt(shore * shore - 1.3 * 1.3);
    return shore > 0 ? .3 - bend : .3 + bend;
  };
  const ta = trim(ax, az), tb = trim(bx, bz), shift = (ta - tb) / 2;
  solid.color(RAIL);
  for (const side of [-1, 1]) slab(solid, cx + uz * side * 1.3 + ux * shift, cz - ux * side * 1.3 + uz * shift, angle, .16, length - ta - tb, TOP + .01, TOP + .31);
  const piers = Math.floor(length / 3.4);
  solid.color(PIER);
  for (let i = 1; i <= piers; i++) { const t = -length / 2 + i * length / (piers + 1); slab(solid, cx + ux * t, cz + uz * t, angle, 2.1, .5, TOP - 1.76, TOP - .36); }
}

/** A stone arch bridge over the canal; the deck carries the avenue. The arch was drawn for a 9.8-unit span. */
function canalBridge(solid: Mesher, flat: Mesher, road: Road) {
  const { dx, dz, length: span, angle, cx, cz } = along(road), [ax, az] = road, ux = Math.sin(angle), uz = Math.cos(angle), k = span / 9.8;
  flat.color(ROAD); slab(flat, cx, cz, angle, 2.3, span, TOP - .24, TOP + .06);
  solid.color(RAIL);
  for (const side of [-1, 1]) slab(solid, cx + uz * side * 1.27, cz - ux * side * 1.27, angle, .24, span, TOP - .05, TOP + .37);
  flat.color(MARK);
  for (let t = .8; t < span - .4; t += 2.2) mark(flat, ax + dx * t / span, az + dz * t / span, angle, .14, .8, TOP + .065);
  const arch = new THREE.Shape();
  arch.moveTo(-span / 2, 0); arch.lineTo(span / 2, 0); arch.lineTo(span / 2, -1.95); arch.lineTo(2.56 * k, -1.95);
  arch.absarc(0, -2.95, 2.75 * k, .372, Math.PI - .372, false); arch.lineTo(-span / 2, -1.95); arch.closePath();
  const wallGeometry = new THREE.ExtrudeGeometry(arch, { depth: 2.44, bevelEnabled: false, curveSegments: 16 });
  wallGeometry.deleteAttribute("uv"); wallGeometry.rotateY(-Math.PI / 2); wallGeometry.translate(1.22, TOP - .24, 0);
  solid.color(DECK); solid.add(wallGeometry, box.makeRotationY(angle).setPosition(cx, 0, cz));
}
