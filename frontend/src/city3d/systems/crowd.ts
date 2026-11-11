/**
 * A bounded walking population for the city: six authored bodies (assets/people.ts), each in near/far pools,
 * with one shared material. The step is drawn in the vertex shader: the thighs, shins and
 * feet, the upper arms and forearms are parts of the body that it turns about their joints, from a time uniform and
 * each walker's phase, with no skeleton and no work on the CPU but one matrix a walker a frame. The clothes come from
 * small palettes in the shader, by three numbers per copy. The routes, the population, the speeds, the culling and
 * the quality's share are as before.
 */
import * as THREE from 'three/webgpu';
import { abs, attribute, color, cos, float, floor, max, mix, nodeObject, normalGeometry, normalLocal, positionGeometry, positionLocal, saturate, sin, step, transformNormal, uniform, uv, vec3, vec4, type ShaderNodeObject } from 'three/tsl';
import { PEOPLE, personGeometry, type PersonDetail } from '../assets/people';
import type { CityContext } from '../engine/context';
import { COPY_STRIDE, copyGeometry, copyMatrices, copyMatrix, copyMesh, copyTints } from '../render/copies';
import { insideParking, segmentDistance } from '../world/generate';
import { centerContains } from '../world/civicCenter';
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
    if (!world.center && Math.abs(dx * d.z - dz * d.x) / r < 1.35 + margin) return false;
  }
  return true;
}

/** Build routes once from actual land/roads, so changing world radii never strands residents in water. */
export function createCrowdRoutes(world: WorldData): CrowdRoute[] {
  const roads = [...world.roads.streets, ...world.roads.bridges.filter(bridge => !world.center || bridge.canal).map(bridge => bridge.road)];
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
    const centerLand = world.center && centerContains(world.center, p, margin);
    if (!rectangleLand && !centerLand && !world.land.islets.some(island => Math.hypot(p.x - island.x, p.z - island.z) <= island.r - margin)
      && !world.land.annuli.some(land => radius >= land.inner + margin && radius <= land.outer - margin)) return false;
    if (world.center && radius < world.spec.lagoon && !centerLand) return false;
    if (world.center && Math.abs(p.x - world.center.plaza.x) < world.center.plaza.width / 2 + margin && Math.abs(p.z - world.center.plaza.z) < world.center.plaza.depth / 2 + margin) return false;
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
/** Body parts share one shader rig across all six authored silhouettes. */
const SLOT = { shirt: 0, skin: 1, trousers: 2, hair: 3, shoes: 4, sleeve: 5, accent: 6, white: 7, eyes: 8 } as const;
const HIP = .71, KNEE = .41, ANKLE = .09, SHOULDER = 1.166, ELBOW = .921;
const STEP_RATE = 4.6, LEG_SWING = .37, KNEE_BEND = .9, ARM_SWING = .32, ELBOW_BEND = .25, BOB = .006;
const SHIRTS = PEOPLE.map(person => person.palette.shirt), SKINS = PEOPLE.map(person => person.palette.skin);
const TROUSERS = PEOPLE.map(person => person.palette.trousers), HAIRS = PEOPLE.map(person => person.palette.hair);
const SHOES = PEOPLE.map(person => person.palette.shoes), ACCENTS = PEOPLE.map(person => person.palette.accent);
export { PEOPLE };

/** Both alternating half-density subsets retain all six models. Actor identity survives LOD and quality changes. */
export const personVariant = (actor: number) => (Math.floor(actor / 2) + actor * 3) % PEOPLE.length;
/** Phase; variant + 6 x skin; small clothing shade variations and the authored sleeve length. */
export const codes = (actor: number): [number, number, number] => [
  actor * 2.399 % (Math.PI * 2),
  personVariant(actor) + 6 * ((actor * 5 + Math.floor(actor / 6)) % SKINS.length),
  actor % 4 + 4 * (actor * 3 % 4) + (personVariant(actor) === 5 ? 0 : 16),
];
export function walkerGeometry(variant = 0, detail: PersonDetail = 'near'): THREE.BufferGeometry { return personGeometry(variant, detail); }

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
  const variant = first.mod(PEOPLE.length), is = (value: number) => float(1).sub(step(.5, abs(slot.sub(value))));
  const shirt = pick(SHIRTS, variant), skin = pick(SKINS, floor(first.div(PEOPLE.length)));
  const trousers = pick(TROUSERS, variant).mul(mix(.94, 1.04, second.mod(4).div(3)));
  const hair = pick(HAIRS, variant), shoes = pick(SHOES, variant), accent = pick(ACCENTS, variant);
  const worn = shirt.mul(is(SLOT.shirt)).add(skin.mul(is(SLOT.skin))).add(trousers.mul(is(SLOT.trousers)))
    .add(hair.mul(is(SLOT.hair))).add(shoes.mul(is(SLOT.shoes))).add(mix(skin, shirt, sleeves).mul(is(SLOT.sleeve)))
    .add(accent.mul(is(SLOT.accent))).add(color('#f2eee5').mul(is(SLOT.white))).add(color('#24272c').mul(is(SLOT.eyes)));
  const skinPart = is(SLOT.skin).add(is(SLOT.sleeve).mul(sleeves.oneMinus()));
  // Clean broad colour planes, with softly lifted contact shading instead of fabric micrograin.
  material.colorNode = worn.mul(mix(.86, 1, attribute('aShade', 'float')));
  material.userData.cityModelStyle = 'cartoon-v1';
  material.roughnessNode = float(.82).sub(skinPart.mul(.13)).sub(is(SLOT.hair).mul(.1)).sub(is(SLOT.shoes).mul(.13)).sub(is(SLOT.eyes).mul(.28));
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

  // Six authored bodies, each with a lightweight distant silhouette; all pools share one material and step clock.
  const time = uniform(0), material = walkerMaterial(time as unknown as Node);
  materials.add(material);
  const capacities = PEOPLE.map(() => 0); people.forEach((_, actor) => { capacities[personVariant(actor)]++; });
  interface PersonPool {
    mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardNodeMaterial>;
    matrices: THREE.InstancedInterleavedBuffer;
    details: THREE.InstancedBufferAttribute;
    packed: Int32Array; count: number; recoded: boolean;
  }
  const pools: PersonPool[] = PEOPLE.flatMap((person, variant) => (['near', 'far'] as const).map(detail => {
    const body = walkerGeometry(variant, detail), capacity = capacities[variant];
    const matrices = copyMatrices(capacity).setUsage(THREE.DynamicDrawUsage), details = copyTints(capacity).setUsage(THREE.DynamicDrawUsage);
    const mesh = new THREE.Mesh(copyGeometry(body, matrices, details), material);
    mesh.name = `city-crowd-walkers-${person.id}-${detail}`;
    mesh.userData.personVariant = variant; mesh.userData.personDetail = detail;
    mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.castShadow = false; mesh.receiveShadow = true;
    group.add(mesh); geometries.add(body); geometries.add(mesh.geometry);
    return { mesh, matrices, details, packed: new Int32Array(capacity).fill(-1), count: 0, recoded: false };
  }));
  group.userData.models = PEOPLE.map(person => person.id);

  // Moving people never enter the static sun map: a soft contact shadow is
  // updated with each logical resident, so pausing and culling leave no ghosts.
  const blobMaterial = new THREE.MeshBasicNodeMaterial({ color: '#273e35', transparent: true, depthWrite: false });
  blobMaterial.opacityNode = saturate(uv().sub(.5).length().mul(2).oneMinus()).mul(.25);
  const blobGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMatrices = copyMatrices(count).setUsage(THREE.DynamicDrawUsage);
  const shadows = copyMesh(blobGeometry, blobMaterial, blobMatrices, copyTints(count));
  shadows.name = 'city-crowd-contact-shadows'; shadows.castShadow = false; shadows.receiveShadow = false; group.add(shadows);
  geometries.add(blobGeometry); geometries.add(shadows.geometry); materials.add(blobMaterial);

  const levels = new Int8Array(count).fill(-1), frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
  const center = new THREE.Vector3(), sphere = new THREE.Sphere(center, 1.2), matrix = new THREE.Matrix4();
  const place = new THREE.Vector3(), turn = new THREE.Quaternion(), size = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function dress(pool: PersonPool, actor: number, slot: number) {
    if (pool.packed[slot] === actor) return;
    pool.packed[slot] = actor; pool.recoded = true;
    codes(actor).forEach((value, k) => { (pool.details.array as Float32Array)[slot * 3 + k] = value; });
  }

  function update(dt: number) {
    clock += dt;
    const { camera } = ctx;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    // Farther from a high camera, as for the cars: walkers stay in the picture when zoomed out.
    const far = Math.max(120, ctx.quality.lodDistances[2]) + Math.min(450, Math.max(0, camera.position.y - 40) * 1.5), share = Math.max(0, Math.min(1, density));
    const blobs = blobMatrices.array as Float32Array;
    const near = Math.max(24, Math.min(36, ctx.quality.lodDistances[0]));
    pools.forEach(pool => { pool.count = 0; pool.recoded = false; });
    let slot = 0;
    for (let index = 0; index < count; index++) {
      if (Math.floor((index + 1) * share) === Math.floor(index * share)) continue;
      const person = people[index], point = sampleCrowdRoute(person.route, person.offset + clock * person.speed);
      center.set(point.x, GROUND_Y + .65, point.z);
      const distance = center.distanceToSquared(camera.position);
      if (distance > far * far || !frustum.intersectsSphere(sphere)) continue;
      const threshold = near * (levels[index] < 0 ? 1 : levels[index] === 0 ? 1.12 : .88);
      const level = distance < threshold * threshold ? 0 : 1;
      levels[index] = level;
      const pool = pools[personVariant(index) * 2 + level], target = pool.count++;
      dress(pool, index, target);
      const placed = pool.matrices.array as Float32Array;
      const height = PERSON_SCALE * (.94 + (index % 5) * .028);
      matrix.compose(place.set(point.x, GROUND_Y, point.z), turn.setFromAxisAngle(up, point.heading), size.setScalar(height)).toArray(placed, target * COPY_STRIDE);
      matrix.makeScale(.46, 1, .46).setPosition(point.x, .231, point.z).toArray(blobs, slot * COPY_STRIDE);
      slot++;
    }
    shadows.geometry.instanceCount = slot;
    blobMatrices.needsUpdate = true;
    pools.forEach(pool => {
      pool.mesh.geometry.instanceCount = pool.count; pool.mesh.visible = pool.count > 0;
      if (pool.count) pool.matrices.needsUpdate = true;
      if (pool.recoded) pool.details.needsUpdate = true;
    });
    group.userData.visiblePopulation = slot;
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
