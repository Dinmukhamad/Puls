/**
 * A bounded walking population for the city (docs/CITY_V4.md, stage 4): every walker is a copy of one body
 * (walkerGeometry) in one draw call, and the step is drawn in the vertex shader (walkerMaterial): the thighs, shins and
 * feet, the upper arms and forearms are parts of the body that it turns about their joints, from a time uniform and
 * each walker's phase, with no skeleton and no work on the CPU but one matrix a walker a frame. The clothes come from
 * small palettes in the shader, by three numbers per copy. The routes, the population, the speeds, the culling and
 * the quality's share are as before.
 */
import * as THREE from 'three/webgpu';
import { abs, attribute, color, cos, float, floor, fwidth, max, mix, nodeObject, normalGeometry, normalLocal, positionGeometry, positionLocal, saturate, sin, smoothstep, step, transformNormal, uniform, uv, vec3, vec4, type ShaderNodeObject } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CityContext } from '../engine/context';
import { COPY_STRIDE, copyGeometry, copyMatrices, copyMatrix, copyMesh, copyTints } from '../render/copies';
import { insideParking, segmentDistance } from '../world/generate';
import type { Point, Route, WorldData } from '../world/types';
import { DISTRICT_FACING } from '../engine/camera';

const TAU = Math.PI * 2;
const PERSON_SCALE = .75;
const LANE = .14;
const CLEARANCE = .5;
/** Walks round the courtyards run .55 from the walls: a little less clearance than the open quays. */
const WALK_CLEARANCE = .45;
/** Walkers in the whole city, on a computer and on a phone. */
const BUDGET = { desktop: 100, mobile: 56 };
/** Courtyard furniture the walkers keep clear of, by its footprint (`width`). */
const FURNITURE = new Set(['bench', 'slide', 'swings', 'climber', 'sandbox', 'goal', 'hoop', 'gazebo', 'flowerbed', 'hedge', 'planter', 'fountain']);
const GROUND_Y = .225;

export interface CrowdRoute extends Route {
  district: string | null;
  cx: number; cz: number; radius: number; start: number; end: number;
}

/** Conservatively clear the largest landmark stage, not only the currently built stage. */
function clearOfLandmark(p: Point, world: WorldData, margin: number) {
  for (const d of world.districts) {
    const dx = p.x - d.x, dz = p.z - d.z;
    if (Math.hypot(dx, dz) > world.spec.islet + margin) continue;
    const c = Math.cos(DISTRICT_FACING), s = Math.sin(DISTRICT_FACING);
    const x = dx * c - dz * s, z = dx * s + dz * c;
    // Landmark base is 5.7 by 5.3, with front steps reaching local z=3.
    if (Math.abs(x) < 2.9 * world.spec.districtScale + margin && Math.abs(z) < 3 * world.spec.districtScale + margin) return false;
    // Keep the approach from the radial bridge empty even where WorldData's
    // road segments end at the island edge (a future entrance must stay clear).
    const r = Math.hypot(d.x, d.z) || 1;
    if (Math.abs(dx * d.z - dz * d.x) / r < 1.35 + margin) return false;
  }
  return true;
}

/** Build routes once from actual land/roads, so changing world radii never strands residents in water. */
export function createCrowdRoutes(world: WorldData): CrowdRoute[] {
  const roads = [...world.roads.streets, ...world.roads.bridges.map(bridge => bridge.road)];
  // Round obstacles, and the sections of the complexes as boxes, filed in a grid of 4-unit cells by their reach.
  const CELL = 4, cells = new Map<number, Obstacle[]>();
  const file = (o: Obstacle, reach: number) => {
    for (let i = Math.floor((o.x - reach) / CELL); i <= Math.floor((o.x + reach) / CELL); i++) for (let j = Math.floor((o.z - reach) / CELL); j <= Math.floor((o.z + reach) / CELL); j++) {
      const key = i * 4099 + j, list = cells.get(key);
      if (list) list.push(o); else cells.set(key, [o]);
    }
  };
  for (const p of world.placements) {
    // Roofs, roof gardens and towers on their podiums stand over footprints the walkers already keep off.
    if ((p.lift ?? 0) > .5 && !p.kind.startsWith('tree-')) continue;
    if (p.kind === 'section' || p.kind === 'glass-tower') {
      const hw = p.width / 2, hd = (p.depth ?? 2.4) / 2;
      file({ x: p.x, z: p.z, radius: 0, box: { cos: Math.cos(p.rotation), sin: Math.sin(p.rotation), hw, hd } }, Math.hypot(hw, hd) + 1);
      continue;
    }
    const radius = p.kind === 'lamp' ? .16 : p.kind.startsWith('tree-') ? .25 * p.scale : p.kind === 'car-parked' ? .95 : p.kind === 'bush' ? .3 * p.scale
      : FURNITURE.has(p.kind) ? Math.max(.3, p.width * .5) : Math.max(.7, p.width * .72);
    file({ x: p.x, z: p.z, radius }, radius + 1);
  }
  // The operator's plots, built up or not: what the operator builds there arrives after the routes.
  for (const plot of world.plots ?? []) {
    const h = plot.size / 2;
    file({ x: plot.x, z: plot.z, radius: 0, box: { cos: Math.cos(plot.rotation), sin: Math.sin(plot.rotation), hw: h, hd: h } }, h * Math.SQRT2 + 1);
  }
  const blocked = (p: Point, margin: number) => (cells.get(Math.floor(p.x / CELL) * 4099 + Math.floor(p.z / CELL)) ?? []).some(o => {
    const dx = p.x - o.x, dz = p.z - o.z;
    // A section turns its +x along cos/sin: across the facade is its local z. Distance to the box, round its corners.
    if (o.box) return Math.hypot(Math.max(0, Math.abs(dx * o.box.cos - dz * o.box.sin) - o.box.hw), Math.max(0, Math.abs(dx * o.box.sin + dz * o.box.cos) - o.box.hd)) < margin;
    return Math.abs(dx) < o.radius + margin && Math.abs(dz) < o.radius + margin && Math.hypot(dx, dz) < o.radius + margin;
  });
  const clear = (p: Point, margin = CLEARANCE) => {
    const radius = Math.hypot(p.x, p.z);
    const rect = world.land.rectangle;
    const rectangleLand = rect && Math.abs(p.x) < rect.width / 2 - margin && Math.abs(p.z) < rect.depth / 2 - margin && radius > rect.lake + margin;
    if (!rectangleLand && !world.land.islets.some(island => Math.hypot(p.x - island.x, p.z - island.z) <= island.r - margin)
      && !world.land.annuli.some(land => radius >= land.inner + margin && radius <= land.outer - margin)) return false;
    if (world.roads.rings.some(ring => Math.abs(radius - ring) < 1 + margin)) return false;
    if (roads.some(road => segmentDistance(p.x, p.z, road) < 1.35 + margin)) return false;
    if (world.roads.parking.some(lot => insideParking(p, lot, margin + .2))) return false;
    if (!clearOfLandmark(p, world, margin)) return false;
    return !blocked(p, margin);
  };

  const result: CrowdRoute[] = [];
  const circles = [
    ...world.districts.filter(d => !d.id.startsWith('future-')).map(d => ({ district: d.id, cx: d.x, cz: d.z, radius: world.spec.islet - .72 })),
    { district: null, cx: 0, cz: 0, radius: world.spec.promenade },
    // The ring alleys between the outer bands; the walk breaks where avenues cross them.
    ...[...new Set((world.alleys ?? []).map(alley => alley.radius))].map(radius => ({ district: null, cx: 0, cz: 0, radius })),
  ];
  for (const circle of circles) {
    if (circle.radius <= 1) continue;
    const steps = Math.max(128, Math.ceil(TAU * circle.radius / .2)), step = TAU / steps;
    const open = Array.from({ length: steps }, (_, index) => clear({ x: circle.cx + Math.cos(index * step) * circle.radius, z: circle.cz + Math.sin(index * step) * circle.radius }));
    // Start after a blocked cell so an arc across angle zero stays one route.
    const blocked = open.indexOf(false);
    const offset = blocked === -1 ? 0 : blocked + 1;
    let index = 0;
    while (index < steps) {
      if (!open[(offset + index) % steps]) { index++; continue; }
      const begin = index;
      while (index < steps && open[(offset + index) % steps]) index++;
      const start = (offset + begin + .5) * step + .35 / circle.radius;
      const end = (offset + index - .5) * step - .35 / circle.radius;
      if ((end - start) * circle.radius < 2.4) continue;
      const points: Point[] = [], divisions = Math.max(4, Math.ceil((end - start) * circle.radius / .18));
      const polar = (radius: number, angle: number) => ({ x: circle.cx + Math.cos(angle) * radius, z: circle.cz + Math.sin(angle) * radius });
      for (let k = 0; k <= divisions; k++) points.push(polar(circle.radius + LANE, start + (end - start) * k / divisions));
      const cap = (angle: number, first: boolean) => {
        const center = polar(circle.radius, angle);
        for (let k = 1; k < 10; k++) {
          const phase = k / 10 * Math.PI, radial = (first ? -1 : 1) * Math.cos(phase) * LANE;
          const tangent = (first ? -1 : 1) * Math.sin(phase) * LANE;
          points.push({ x: center.x + Math.cos(angle) * radial - Math.sin(angle) * tangent, z: center.z + Math.sin(angle) * radial + Math.cos(angle) * tangent });
        }
      };
      cap(end, false);
      for (let k = 0; k <= divisions; k++) points.push(polar(circle.radius - LANE, end - (end - start) * k / divisions));
      cap(start, true);
      // Lane turns must fit too; reject, rather than silently clipping obstacles.
      if (points.some(point => !clear(point, .29))) continue;
      const distance = [0];
      for (let k = 0; k < points.length; k++) {
        const a = points[k], b = points[(k + 1) % points.length];
        distance.push(distance[k] + Math.hypot(b.x - a.x, b.z - a.z));
      }
      result.push({ ...circle, start, end, points, distance, length: distance[points.length], hidden: points.map(() => false) });
    }
  }
  // Round the courtyards and the outside of the residential complexes: one way round, dropped if anything stands on it.
  for (const walk of world.walks ?? []) {
    if (walk.length < 8 || walk.some(point => !clear(point, WALK_CLEARANCE))) continue;
    const distance = [0];
    for (let k = 0; k < walk.length; k++) { const a = walk[k], b = walk[(k + 1) % walk.length]; distance.push(distance[k] + Math.hypot(b.x - a.x, b.z - a.z)); }
    const cx = walk.reduce((s, p) => s + p.x, 0) / walk.length, cz = walk.reduce((s, p) => s + p.z, 0) / walk.length;
    result.push({ district: null, cx, cz, radius: 0, start: 0, end: 0, points: walk, distance, length: distance[walk.length], hidden: walk.map(() => false) });
  }
  return result;
}

interface Obstacle { x: number; z: number; radius: number; box?: { cos: number; sin: number; hw: number; hd: number } }

/** Distance-based sampling keeps speed identical on long promenades and small island paths. */
export function sampleCrowdRoute(route: CrowdRoute, distance: number) {
  const at = ((distance % route.length) + route.length) % route.length;
  let lo = 0, hi = route.points.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (route.distance[mid] <= at) lo = mid; else hi = mid - 1; }
  const a = route.points[lo], b = route.points[(lo + 1) % route.points.length];
  const share = (at - route.distance[lo]) / (route.distance[lo + 1] - route.distance[lo]);
  return { x: a.x + (b.x - a.x) * share, z: a.z + (b.z - a.z) * share, heading: Math.atan2(b.x - a.x, b.z - a.z) };
}

/** Pavement for short island walks; the main promenade already has its own paving. */
function islandPaving(routes: CrowdRoute[]) {
  const vertices: number[] = [];
  for (const route of routes) {
    if (!route.district) continue;
    const steps = Math.ceil((route.end - route.start) * route.radius / .24);
    for (let k = 0; k < steps; k++) {
      const a = route.start + (route.end - route.start) * k / steps, b = route.start + (route.end - route.start) * (k + 1) / steps;
      const point = (angle: number, side: number) => [route.cx + Math.cos(angle) * (route.radius + side * .4), .218, route.cz + Math.sin(angle) * (route.radius + side * .4)];
      const ai = point(a, -1), ao = point(a, 1), bi = point(b, -1), bo = point(b, 1);
      vertices.push(...ai, ...bi, ...ao, ...ao, ...bi, ...bo);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export interface Crowd { setEnabled(enabled: boolean): void; dispose(): void }

/** Parts of a walker's body (aPart.x): the still body, and the limbs the vertex shader turns about their joints. */
const BONE = { body: 0, thighL: 1, shinL: 2, footL: 3, thighR: 4, shinR: 5, footR: 6, armL: 7, foreL: 8, armR: 9, foreR: 10 } as const;
/** What a vertex wears (aPart.y): the walker's shirt, skin, trousers or hair, the shoes, or a forearm (sleeve or skin). */
const SLOT = { shirt: 0, skin: 1, trousers: 2, hair: 3, shoes: 4, sleeve: 5 } as const;
/** The joints' heights in the walker's frame (feet on y = 0, facing +z), as the old jointed walkers had them. */
const HIP = .71, KNEE = .41, ANKLE = .09, SHOULDER = 1.166, ELBOW = .921;
/**
 * The step: radians of its cycle a second (as before), the legs' and arms' swing, the knee's bend while the leg swings
 * forward, the elbow's bend, and the body's rise between two steps (radians; units of the walker's frame).
 */
const STEP_RATE = 4.6, LEG_SWING = .37, KNEE_BEND = .9, ARM_SWING = .32, ELBOW_BEND = .25, BOB = .006;
const SHIRTS = ['#b36b53', '#577c99', '#756783', '#507d70', '#c4a16c', '#515e78'];
const SKINS = ['#efbc96', '#bc845f', '#dfaa83', '#986849', '#f4c8a8', '#cd946e'];
const TROUSERS = ['#34445a', '#586270', '#5b4e49', '#293d50'];
const HAIRS = ['#263143', '#3b2a20', '#6b4a2e', '#c9a26a'];
const SHOES = '#47494b';
/**
 * A walker's three numbers: its step's phase; shirt + 6 × skin; trousers + 4 × hair + 16 × long sleeves (a third of
 * the walkers). Shirt, skin and trousers by number as the old walkers had them.
 */
export const codes = (actor: number): [number, number, number] => [actor * 2.399 % (Math.PI * 2), actor % 6 + 6 * (actor * 5 % 6), actor % 4 + 4 * (actor * 3 % 4) + (actor * 7 % 3 === 0 ? 16 : 0)];

/**
 * One walker, about 1,050 triangles: adult head/neck proportions, a tailored jacket with collar, ears, shaped hands,
 * shoe soles, and the thighs, shins,
 * shoes, upper arms and forearms with their hands as parts of their own (aPart) for the shader to turn.
 */
export function walkerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (geometry: THREE.BufferGeometry, bone: number, slot: number, shade = 1) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    flat.deleteAttribute('uv');
    const marks = new Float32Array(flat.getAttribute('position').count * 2);
    for (let i = 0; i < marks.length; i += 2) { marks[i] = bone; marks[i + 1] = slot; }
    flat.setAttribute('aPart', new THREE.BufferAttribute(marks, 2));
    // A little contact shading survives moving joints without another material or a per-frame CPU update.
    const normal = flat.getAttribute('normal'), shades = new Float32Array(normal.count);
    for (let i = 0; i < shades.length; i++) shades[i] = shade * (.86 + .14 * (normal.getY(i) * .5 + .5));
    flat.setAttribute('aShade', new THREE.BufferAttribute(shades, 1));
    parts.push(flat);
  };
  // A shaped jacket and hips, a rounded head with a nose and a cap of hair keep the silhouette readable from afar.
  const jacket = new THREE.LatheGeometry([
    new THREE.Vector2(.145, -.205), new THREE.Vector2(.16, -.19), new THREE.Vector2(.205, .10), new THREE.Vector2(.19, .17),
    new THREE.Vector2(.095, .215), new THREE.Vector2(0, .215),
  ], 10);
  jacket.scale(1, 1, .68); jacket.translate(0, 1.02, 0); add(jacket, BONE.body, SLOT.shirt);
  const hips = new THREE.CapsuleGeometry(.125, .13, 2, 8);
  hips.rotateZ(Math.PI / 2); hips.scale(1, .66, .82); hips.translate(0, .769, 0); add(hips, BONE.body, SLOT.trousers);
  const collar = new THREE.LatheGeometry([new THREE.Vector2(.082, 0), new THREE.Vector2(.066, .035)], 10);
  collar.scale(1, 1, .84); collar.translate(0, 1.215, .002); add(collar, BONE.body, SLOT.shirt, .72);
  const neck = new THREE.CylinderGeometry(.049, .055, .145, 7, 1, true); neck.translate(0, 1.3025, 0); add(neck, BONE.body, SLOT.skin);
  const head = new THREE.SphereGeometry(.11, 10, 7), hp = head.getAttribute('position');
  for (let i = 0; i < hp.count; i++) {
    // A slightly narrower jaw and flatter cheeks read as a face rather than a large sphere.
    const taper = hp.getY(i) < 0 ? 1 + hp.getY(i) / .11 * .16 : 1;
    hp.setX(i, hp.getX(i) * taper); hp.setZ(i, hp.getZ(i) * (hp.getZ(i) > 0 ? .95 : 1));
  }
  head.scale(.94, 1.08, .94); head.translate(0, 1.484, 0); head.computeVertexNormals(); add(head, BONE.body, SLOT.skin);
  const nose = new THREE.SphereGeometry(.019, 5, 3); nose.scale(.72, .9, 1.2); nose.translate(0, 1.478, .102); add(nose, BONE.body, SLOT.skin);
  for (const side of [-1, 1]) {
    const ear = new THREE.SphereGeometry(.016, 6, 4); ear.scale(.55, 1.15, .7); ear.translate(side * .103, 1.48, -.006); add(ear, BONE.body, SLOT.skin, .94);
  }
  // The hair: a cap tilted back, so it is low on the nape and clear of the forehead.
  const hair = new THREE.SphereGeometry(.113, 10, 5, 0, Math.PI * 2, 0, Math.PI * .57); hair.rotateX(-.24); hair.scale(.98, 1.04, .96); hair.translate(0, 1.4908, -.007); add(hair, BONE.body, SLOT.hair);
  for (const side of [-1, 1]) {
    const left = side < 0, x = side * .095, ax = side * .224;
    /** A capsule from joint to joint, its ends rounding over the joints. */
    const limb = (radius: number, from: number, to: number, bone: number, slot: number, lx: number, taper = 1) => {
      const g = new THREE.CapsuleGeometry(radius, Math.max(.01, from - to - radius * 2), 1, 7);
      const p = g.getAttribute('position'), height = from - to;
      for (let i = 0; i < p.count; i++) {
        const share = Math.max(0, Math.min(1, (p.getY(i) + height / 2) / height)), width = taper + (1 - taper) * share;
        p.setX(i, p.getX(i) * width); p.setZ(i, p.getZ(i) * width);
      }
      g.computeVertexNormals();
      g.translate(lx, (from + to) / 2, 0); add(g, bone, slot);
    };
    limb(.068, HIP, KNEE, left ? BONE.thighL : BONE.thighR, SLOT.trousers, x);
    limb(.058, KNEE, ANKLE, left ? BONE.shinL : BONE.shinR, SLOT.trousers, x);
    const shoe = new THREE.CapsuleGeometry(.058, .1, 1, 7); shoe.rotateX(Math.PI / 2); shoe.scale(1, .68, 1); shoe.translate(x, .042, .035);
    add(shoe, left ? BONE.footL : BONE.footR, SLOT.shoes);
    const sole = new THREE.BoxGeometry(.105, .013, .175); sole.translate(x, .01005, .035);
    add(sole, left ? BONE.footL : BONE.footR, SLOT.shoes, .55);
    limb(.064, SHOULDER, ELBOW, left ? BONE.armL : BONE.armR, SLOT.shirt, ax);
    limb(.043, ELBOW, ELBOW - .225, left ? BONE.foreL : BONE.foreR, SLOT.sleeve, ax, .68);
    const hand = new THREE.SphereGeometry(.045, 6, 4); hand.scale(.72, 1.06, .62); hand.translate(ax, ELBOW - .241, .003); add(hand, left ? BONE.foreL : BONE.foreR, SLOT.skin);
  }
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  geometry.computeBoundingSphere();
  return geometry;
}

type Node = ShaderNodeObject<THREE.Node>;
/** Turns a point about the axis along x through height y (z = 0) by `angle` (positive: the end below swings back). */
const turnAbout = (p: Node, y: Node, angle: Node): Node => {
  const c = cos(angle), s = sin(angle), dy = p.y.sub(y);
  return vec3(p.x, y.add(dy.mul(c)).sub(p.z.mul(s)), dy.mul(s).add(p.z.mul(c)));
};
const turnNormal = (n: Node, angle: Node): Node => { const c = cos(angle), s = sin(angle); return vec3(n.x, n.y.mul(c).sub(n.z.mul(s)), n.y.mul(s).add(n.z.mul(c))); };

/**
 * The step, in the vertex stage: each side's cycle (the right half a cycle behind the left) swings the thigh, and the
 * shin and foot with it; the knee bends while the leg swings forward and straightens to stand; the arms swing against
 * their side's leg with the elbows a little bent; the body rises a little between steps. Then the copy's matrix
 * places the walker, as render/copies.ts places a copy.
 */
class Step extends THREE.Node {
  constructor(private readonly time: Node) { super('void'); }
  setup() {
    const part = attribute('aPart', 'vec2'), data = attribute('copyTint', 'vec3'), bone = part.x;
    const is = (k: number): Node => float(1).sub(step(.5, abs(bone.sub(k))));
    const left = is(BONE.thighL).add(is(BONE.shinL)).add(is(BONE.footL)).add(is(BONE.armL)).add(is(BONE.foreL));
    const thigh = is(BONE.thighL).add(is(BONE.thighR)), shin = is(BONE.shinL).add(is(BONE.shinR)), foot = is(BONE.footL).add(is(BONE.footR));
    const upper = is(BONE.armL).add(is(BONE.armR)), fore = is(BONE.foreL).add(is(BONE.foreR));
    const phase = this.time.mul(STEP_RATE).add(data.x), cycle = phase.add(left.oneMinus().mul(Math.PI)), swing = sin(cycle);
    const legAngle = swing.mul(LEG_SWING), bend = max(cos(cycle).negate(), 0).mul(KNEE_BEND), armAngle = swing.mul(-ARM_SWING);
    // First about the knee or the elbow, then about the hip or the shoulder.
    const first = shin.mul(bend).sub(fore.mul(ELBOW_BEND)), firstY = mix(float(KNEE), float(ELBOW), fore);
    const second = thigh.add(shin).mul(legAngle).add(upper.add(fore).mul(armAngle)), secondY = mix(float(HIP), float(SHOULDER), upper.add(fore));
    // The shoes keep level and follow their ankles.
    const rest = vec3(0, ANKLE, 0), ankle = turnAbout(turnAbout(rest, float(KNEE), bend), float(HIP), legAngle);
    const bob = cos(phase.mul(2)).add(1).mul(BOB);
    const placed = turnAbout(turnAbout(positionGeometry, firstY, first), secondY, second).add(ankle.sub(rest).mul(foot)).add(vec3(0, bob, 0));
    positionLocal.assign(copyMatrix.mul(vec4(placed, 1)).xyz);
    normalLocal.assign(transformNormal(turnNormal(turnNormal(normalGeometry, first), second), copyMatrix));
  }
}
class WalkerMaterial extends THREE.MeshStandardNodeMaterial {
  step: Node | null = null;
  setupPosition(builder: THREE.NodeBuilder) { this.step?.toStack(); return super.setupPosition(builder); }
}
/** Picks colour `index` (a whole number) of a list in the shader. */
const pick = (list: string[], index: Node): Node => list.slice(1).reduce<Node>((acc, hex, k) => mix(acc, color(hex), step(k + .5, index)), color(list[0]));
/** The walkers' material: the step (Step) and the clothes by the copy's numbers (`codes`); `time` drives the step. */
export function walkerMaterial(time: Node): THREE.MeshStandardNodeMaterial {
  const material = new WalkerMaterial(); material.roughness = .88; material.metalness = 0;
  material.step = nodeObject(new Step(time));
  const data = attribute('copyTint', 'vec3'), slot = attribute('aPart', 'vec2').y;
  const first = floor(data.y.add(.5)), second = floor(data.z.add(.5)), sleeves = step(15.5, second);
  const shirt = pick(SHIRTS, first.mod(6)), skin = pick(SKINS, floor(first.add(.5).div(6))), trousers = pick(TROUSERS, second.mod(4)), hair = pick(HAIRS, floor(second.add(.5).div(4)).mod(4));
  const worn = mix(mix(mix(mix(shirt, skin, step(.5, slot)), trousers, step(1.5, slot)), hair, step(2.5, slot)), color(SHOES), step(3.5, slot));
  const cloth = float(1).sub(step(.5, slot)).add(step(1.5, slot).sub(step(2.5, slot))).add(step(4.5, slot).mul(sleeves));
  const skinPart = step(.5, slot).sub(step(1.5, slot)).add(step(4.5, slot).mul(sleeves.oneMinus()));
  const weaveFade = float(1).sub(smoothstep(.006, .035, fwidth(positionGeometry).length()));
  const weave = sin(positionGeometry.y.mul(95)).mul(sin(positionGeometry.x.mul(82))).mul(.018).mul(weaveFade).mul(cloth);
  material.colorNode = mix(worn, mix(skin, shirt, sleeves), step(4.5, slot)).mul(attribute('aShade', 'float')).mul(float(1).add(weave));
  material.roughnessNode = float(.88).sub(skinPart.mul(.28)).sub(step(2.5, slot).sub(step(3.5, slot)).mul(.13)).sub(step(3.5, slot).sub(step(4.5, slot)).mul(.18));
  material.userData.walkTime = time;
  return material;
}

export function createCrowd(ctx: CityContext): Crowd {
  const routes = createCrowdRoutes(ctx.world);
  const people: { route: CrowdRoute; offset: number; speed: number }[] = [];
  // Walkers in proportion to how long each walk is (up to 8 on one), within the budget; every island keeps one.
  const budget = ctx.mobile ? BUDGET.mobile : BUDGET.desktop, capacity = routes.map(route => Math.max(1, Math.min(8, Math.floor(route.length / 2.5))));
  const share = Math.min(1, budget / Math.max(1, capacity.reduce((sum, c) => sum + c, 0)));
  // Whole walkers by largest remainder, so many short walks still get their share between them.
  const exact = capacity.map(c => c * share), perRoute = exact.map((e, index) => Math.max(routes[index].district ? 1 : 0, Math.floor(e)));
  const order = exact.map((_, index) => index).sort((a, b) => (exact[b] - Math.floor(exact[b])) - (exact[a] - Math.floor(exact[a])) || a - b);
  for (let k = 0, left = budget - perRoute.reduce((sum, n) => sum + n, 0); k < order.length && left > 0; k++) if (perRoute[order[k]] < capacity[order[k]]) { perRoute[order[k]]++; left--; }
  for (let excess = perRoute.reduce((sum, n) => sum + n, 0) - budget; excess > 0; excess--) {
    let most = 0; perRoute.forEach((n, index) => { if (n > perRoute[most]) most = index; });
    perRoute[most]--;
  }
  routes.forEach((route, index) => { for (let k = 0; k < perRoute[index]; k++) people.push({ route, offset: k, speed: .39 + index % 3 * .025 }); });
  for (const person of people) {
    const index = routes.indexOf(person.route);
    person.offset = ((person.offset / perRoute[index] + (ctx.world.spec.seed % 97) / 97) % 1) * person.route.length;
  }
  const count = people.length;
  const group = new THREE.Group(); group.name = 'city-crowd'; ctx.scene.add(group);
  group.userData.population = count;
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  let disposed = false, enabled = !ctx.reducedMotion, dirty = true, clock = 0, density = ctx.quality.crowd;
  const pavingGeometry = islandPaving(routes), pavingMaterial = new THREE.MeshStandardNodeMaterial({ color: '#dfd5c0', roughness: .92 });
  const paving = new THREE.Mesh(pavingGeometry, pavingMaterial); paving.name = 'city-crowd-pavement'; paving.receiveShadow = true; group.add(paving);
  geometries.add(pavingGeometry); materials.add(pavingMaterial);

  // Every walker in one draw call: one body whose limbs the vertex shader swings (walkerGeometry, walkerMaterial); per
  // copy its place and size (the matrices) and its step's phase and clothes (the copy's three numbers, `codes`).
  const body = walkerGeometry(), time = uniform(0);
  const matrices = copyMatrices(count).setUsage(THREE.DynamicDrawUsage), details = copyTints(count).setUsage(THREE.DynamicDrawUsage);
  const walkers = new THREE.Mesh(copyGeometry(body, matrices, details), walkerMaterial(time as unknown as Node));
  walkers.name = 'city-crowd-walkers'; walkers.frustumCulled = false; walkers.matrixAutoUpdate = false;
  walkers.castShadow = false; walkers.receiveShadow = true; group.add(walkers);
  geometries.add(body); geometries.add(walkers.geometry); materials.add(walkers.material);

  // Moving people never enter the static sun map: a soft contact shadow is
  // updated with each logical resident, so pausing and culling leave no ghosts.
  const blobMaterial = new THREE.MeshBasicNodeMaterial({ color: '#273e35', transparent: true, depthWrite: false });
  blobMaterial.opacityNode = saturate(uv().sub(.5).length().mul(2).oneMinus()).mul(.25);
  const blobGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMatrices = copyMatrices(count).setUsage(THREE.DynamicDrawUsage);
  const shadows = copyMesh(blobGeometry, blobMaterial, blobMatrices, copyTints(count));
  shadows.name = 'city-crowd-contact-shadows'; shadows.castShadow = false; shadows.receiveShadow = false; group.add(shadows);
  geometries.add(blobGeometry); geometries.add(shadows.geometry); materials.add(blobMaterial);

  const packed = new Int32Array(count).fill(-1), frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
  const center = new THREE.Vector3(), sphere = new THREE.Sphere(center, 1.2), matrix = new THREE.Matrix4();
  const place = new THREE.Vector3(), turn = new THREE.Quaternion(), size = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let recoded = false;
  /** Gives slot `slot` to walker `actor`: its step's phase and its clothes go up only when the slot changes hands. */
  function dress(actor: number, slot: number) {
    if (packed[slot] === actor) return;
    packed[slot] = actor; recoded = true;
    codes(actor).forEach((value, k) => { (details.array as Float32Array)[slot * 3 + k] = value; });
  }

  function update(dt: number) {
    clock += dt;
    const { camera } = ctx;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    // Farther from a high camera, as for the cars: walkers stay in the picture when zoomed out.
    const far = Math.max(120, ctx.quality.lodDistances[2]) + Math.min(450, Math.max(0, camera.position.y - 40) * 1.5), share = Math.max(0, Math.min(1, density));
    const placed = matrices.array as Float32Array, blobs = blobMatrices.array as Float32Array;
    let slot = 0;
    for (let index = 0; index < count; index++) {
      if (Math.floor((index + 1) * share) === Math.floor(index * share)) continue;
      const person = people[index], point = sampleCrowdRoute(person.route, person.offset + clock * person.speed);
      center.set(point.x, GROUND_Y + .65, point.z);
      if (center.distanceToSquared(camera.position) > far * far || !frustum.intersectsSphere(sphere)) continue;
      dress(index, slot);
      const height = PERSON_SCALE * (.94 + (index % 5) * .028);
      matrix.compose(place.set(point.x, GROUND_Y, point.z), turn.setFromAxisAngle(up, point.heading), size.setScalar(height)).toArray(placed, slot * COPY_STRIDE);
      matrix.makeScale(.46, 1, .46).setPosition(point.x, .231, point.z).toArray(blobs, slot * COPY_STRIDE);
      slot++;
    }
    walkers.geometry.instanceCount = shadows.geometry.instanceCount = slot;
    matrices.needsUpdate = blobMatrices.needsUpdate = true;
    // The clothes go up only when a slot changed hands: on most frames every walker keeps its slot.
    if (recoded) details.needsUpdate = true;
    recoded = false;
    // The step's clock: it stands still while the crowd is paused, so nobody jumps when it walks on.
    time.value = clock;
  }

  const offFrame = ctx.onFrame(dt => {
    if (disposed || (!enabled && !dirty)) return;
    update(enabled && Number.isFinite(dt) ? Math.min(.15, Math.max(0, dt)) : 0); dirty = false;
  });
  const offCamera = ctx.onCameraMove(() => { dirty = true; });
  const offQuality = ctx.onQuality(settings => { density = settings.crowd; dirty = true; });
  update(0);
  return {
    setEnabled(value) { enabled = value; },
    dispose() {
      if (disposed) return;
      disposed = true; offFrame(); offCamera(); offQuality(); group.removeFromParent();
      // The copy meshes are the only users of their shapes: freeing them frees the shapes' buffers too.
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); group.clear();
    },
  };
}
