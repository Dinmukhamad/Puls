/** A bounded, instanced walking population for the city. */
import * as THREE from 'three/webgpu';
import { saturate, uv } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CityContext } from '../engine/context';
import { insideParking, segmentDistance } from '../world/generate';
import type { Point, Route, WorldData } from '../world/types';
import { districtFacing } from '../engine/camera';

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
    const yaw = districtFacing(d.x, d.z), c = Math.cos(yaw), s = Math.sin(yaw);
    const x = dx * c - dz * s, z = dx * s + dz * c;
    // Landmark base is 5.7 by 5.3, with front steps reaching local z=3.
    if (Math.abs(x) < 2.9 * world.spec.districtScale + margin && Math.abs(z) < 3 * world.spec.districtScale + margin) return false;
    // Keep the approach from the radial bridge empty even where WorldData's
    // road segments end at the island edge (a future entrance must stay clear).
    if (Math.abs(x) < 1.35 + margin) return false;
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
  // The group city's quarters count as built: walkers keep off their buildings at every stage.
  for (const p of [...world.placements, ...(world.sites ?? []).flatMap(site => site.placements)]) {
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
    if (!world.land.islets.some(island => Math.hypot(p.x - island.x, p.z - island.z) <= island.r - margin)
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
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), batches: THREE.InstancedMesh[] = [];
  const root = new THREE.Object3D(), local = new THREE.Object3D(), matrix = new THREE.Matrix4(), color = new THREE.Color();
  let disposed = false, enabled = !ctx.reducedMotion, dirty = true, clock = 0, density = ctx.quality.crowd;
  function batch(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, instances: number) {
    const mesh = new THREE.InstancedMesh(geometry, material, instances);
    mesh.name = name; mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(mesh);
    geometries.add(geometry); materials.add(material); batches.push(mesh);
    return mesh;
  }
  const pavingGeometry = islandPaving(routes), pavingMaterial = new THREE.MeshStandardNodeMaterial({ color: '#dfd5c0', roughness: .92 });
  const paving = new THREE.Mesh(pavingGeometry, pavingMaterial); paving.name = 'city-crowd-pavement'; paving.receiveShadow = true; group.add(paving);
  geometries.add(pavingGeometry); materials.add(pavingMaterial);
  const shirtMaterial = new THREE.MeshStandardNodeMaterial({ color: '#ffffff', roughness: .88 });
  const skinMaterial = new THREE.MeshStandardNodeMaterial({ color: '#ffffff', roughness: .9 });
  const trousersMaterial = new THREE.MeshStandardNodeMaterial({ color: '#ffffff', roughness: .94 });
  const hairMaterial = new THREE.MeshStandardNodeMaterial({ color: '#263143', roughness: .98 });
  const shoeMaterial = new THREE.MeshStandardNodeMaterial({ color: '#eef1e6', roughness: .8 });
  const shirts = ['#ef9270', '#5e91be', '#8a78c8', '#4eaa98', '#eec768', '#647cba'];
  const skinTones = ['#efbc96', '#bc845f', '#dfaa83', '#986849', '#f4c8a8', '#cd946e'];
  const trouserColors = ['#34445a', '#586270', '#5b4e49', '#293d50'];

  function joined(parts: THREE.BufferGeometry[]) {
    const normalized = parts.map(geometry => {
      geometry.deleteAttribute('uv');
      return geometry.index ? geometry.toNonIndexed() : geometry;
    });
    const geometry = mergeGeometries(normalized)!;
    normalized.forEach((part, index) => {
      part.dispose();
      if (part !== parts[index]) parts[index].dispose();
    });
    return geometry;
  }

  // A shaped jacket, rounded head with nose and eyes, hair cap, hips and
  // articulated legs keep silhouettes readable at the island's camera scale.
  const jacket = new THREE.LatheGeometry([
    new THREE.Vector2(.145, -.205), new THREE.Vector2(.16, -.19),
    new THREE.Vector2(.205, .10), new THREE.Vector2(.19, .17),
    new THREE.Vector2(.095, .215), new THREE.Vector2(0, .215),
  ], 10);
  jacket.scale(1, 1, .68); jacket.translate(0, 1.02, 0);
  const torso = batch('walker-jackets', jacket, shirtMaterial, count);

  const head = new THREE.SphereGeometry(.153, 10, 8);
  head.scale(.93, 1.1, .9); head.translate(0, 1.423, 0);
  const neck = new THREE.CylinderGeometry(.064, .068, .12, 8);
  neck.translate(0, 1.26, 0);
  const nose = new THREE.SphereGeometry(.032, 6, 4);
  nose.scale(.8, .95, 1.15); nose.translate(0, 1.405, .136);
  const heads = batch('walker-heads', joined([head, neck, nose]), skinMaterial, count);

  const hair = new THREE.SphereGeometry(.155, 10, 6, 0, TAU, 0, Math.PI * .51);
  hair.scale(.96, 1.07, .93); hair.translate(0, 1.444, -.008);
  const eyes = [-1, 1].map(side => {
    const eye = new THREE.SphereGeometry(.012, 5, 4);
    eye.translate(side * .053, 1.441, .127);
    return eye;
  });
  const hairstyles = batch('walker-hair-eyes', joined([hair, ...eyes]), hairMaterial, count);
  const hips = new THREE.CapsuleGeometry(.125, .13, 2, 8);
  hips.rotateZ(Math.PI / 2); hips.scale(1, .66, .82); hips.translate(0, .769, 0);
  const waists = batch('walker-waists', hips, trousersMaterial, count);

  // Reuse each capsule geometry across a whole population; matrix scale
  // supplies limb length while keeping the original rounded end caps.
  const sleeveGeometry = new THREE.CapsuleGeometry(.068, .204, 2, 8);
  const forearmGeometry = new THREE.CapsuleGeometry(.047, .166, 2, 8);
  const legGeometry = new THREE.CapsuleGeometry(.064, .192, 2, 8);
  const handGeometry = new THREE.SphereGeometry(.052, 8, 6);
  const shoeGeometry = new THREE.CapsuleGeometry(.063, .11, 2, 8);
  shoeGeometry.rotateX(Math.PI / 2); shoeGeometry.scale(1, .7, 1);
  const upperArms = batch('walker-sleeves', sleeveGeometry, shirtMaterial, count * 2);
  const forearms = batch('walker-forearms', forearmGeometry, skinMaterial, count * 2);
  const hands = batch('walker-hands', handGeometry, skinMaterial, count * 2);
  const legs = batch('walker-legs', legGeometry, trousersMaterial, count * 4);
  const shoes = batch('walker-shoes', shoeGeometry, shoeMaterial, count * 2);
  const staticBodies = [torso, heads, hairstyles, waists];

  for (let index = 0; index < count; index++) {
    const shirt = shirts[index % shirts.length];
    const skin = skinTones[(index * 5) % skinTones.length];
    const trouser = trouserColors[index % trouserColors.length];
    torso.setColorAt(index, color.set(shirt));
    heads.setColorAt(index, color.set(skin));
    waists.setColorAt(index, color.set(trouser));
    for (let side = 0; side < 2; side++) {
      upperArms.setColorAt(index * 2 + side, color.set(shirt));
      forearms.setColorAt(index * 2 + side, color.set(skin));
      hands.setColorAt(index * 2 + side, color.set(skin));
      legs.setColorAt(index * 4 + side * 2, color.set(trouser));
      legs.setColorAt(index * 4 + side * 2 + 1, color.set(trouser));
    }
  }

  function place(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, pitch = 0, lengthScale = 1) {
    local.position.set(x, y, z);
    local.rotation.set(pitch, 0, 0);
    local.scale.set(1, lengthScale, 1);
    local.updateMatrix();
    matrix.multiplyMatrices(root.matrix, local.matrix);
    mesh.setMatrixAt(index, matrix);
  }

  // Moving people never enter the static sun map: a soft contact shadow is
  // updated with each logical resident, so pausing and culling leave no ghosts.
  const blobMaterial = new THREE.MeshBasicNodeMaterial({ color: '#273e35', transparent: true, depthWrite: false });
  blobMaterial.opacityNode = saturate(uv().sub(.5).length().mul(2).oneMinus()).mul(.25);
  const shadows = batch('city-crowd-contact-shadows', new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMaterial, count);
  shadows.receiveShadow = false;
  const packed = new Int32Array(count).fill(-1), frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
  const center = new THREE.Vector3(), sphere = new THREE.Sphere(center, 1.2);
  function tint(actor: number, slot: number) {
    if (packed[slot] === actor) return;
    packed[slot] = actor;
    torso.setColorAt(slot, color.set(shirts[actor % shirts.length]));
    heads.setColorAt(slot, color.set(skinTones[(actor * 5) % skinTones.length]));
    waists.setColorAt(slot, color.set(trouserColors[actor % trouserColors.length]));
    for (let side = 0; side < 2; side++) {
      upperArms.setColorAt(slot * 2 + side, color.set(shirts[actor % shirts.length]));
      forearms.setColorAt(slot * 2 + side, color.set(skinTones[(actor * 5) % skinTones.length]));
      hands.setColorAt(slot * 2 + side, color.set(skinTones[(actor * 5) % skinTones.length]));
      legs.setColorAt(slot * 4 + side * 2, color.set(trouserColors[actor % trouserColors.length]));
      legs.setColorAt(slot * 4 + side * 2 + 1, color.set(trouserColors[actor % trouserColors.length]));
    }
  }

  function update(dt: number) {
    clock += dt;
    const { camera } = ctx;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    // Farther from a high camera, as for the cars: walkers stay in the picture when zoomed out.
    const far = Math.max(120, ctx.quality.lodDistances[2]) + Math.min(450, Math.max(0, camera.position.y - 40) * 1.5), share = Math.max(0, Math.min(1, density));
    let slot = 0;
    for (let index = 0; index < count; index++) {
      if (Math.floor((index + 1) * share) === Math.floor(index * share)) continue;
      const person = people[index], point = sampleCrowdRoute(person.route, person.offset + clock * person.speed);
      center.set(point.x, GROUND_Y + .65, point.z);
      if (center.distanceToSquared(camera.position) > far * far || !frustum.intersectsSphere(sphere)) continue;
      tint(index, slot);
      const phase = clock * 4.6 + index * 2.399;
      const height = PERSON_SCALE * (.94 + (index % 5) * .028);
      root.scale.setScalar(height);
      root.position.set(point.x, GROUND_Y + Math.abs(Math.sin(phase)) * .009, point.z);
      root.rotation.set(0, point.heading, 0); root.updateMatrix();
      for (const body of staticBodies) body.setMatrixAt(slot, root.matrix);

      for (let side = 0; side < 2; side++) {
        const sign = side ? 1 : -1;
        const swing = Math.sin(phase + side * Math.PI);
        const hipAngle = swing * .37;
        const kneeAngle = hipAngle - Math.max(0, -swing) * .58;
        const hipX = sign * .095, hipY = .71, upperLength = .3, lowerLength = .32;
        const kneeY = hipY - Math.cos(hipAngle) * upperLength;
        const kneeZ = -Math.sin(hipAngle) * upperLength;
        const ankleY = kneeY - Math.cos(kneeAngle) * lowerLength;
        const ankleZ = kneeZ - Math.sin(kneeAngle) * lowerLength;
        place(legs, slot * 4 + side * 2, hipX, hipY - Math.cos(hipAngle) * upperLength / 2, -Math.sin(hipAngle) * upperLength / 2, hipAngle, upperLength / .32);
        place(legs, slot * 4 + side * 2 + 1, hipX, kneeY - Math.cos(kneeAngle) * lowerLength / 2, kneeZ - Math.sin(kneeAngle) * lowerLength / 2, kneeAngle);
        place(shoes, slot * 2 + side, hipX, ankleY - .045, ankleZ + .033);

        const armAngle = -swing * .32, elbowAngle = armAngle - .17;
        const shoulderX = sign * .224, shoulderY = 1.166, upperArmLength = .245, forearmLength = .225;
        const elbowY = shoulderY - Math.cos(armAngle) * upperArmLength;
        const elbowZ = -Math.sin(armAngle) * upperArmLength;
        place(upperArms, slot * 2 + side, shoulderX, shoulderY - Math.cos(armAngle) * upperArmLength / 2, -Math.sin(armAngle) * upperArmLength / 2, armAngle, upperArmLength / .34);
        place(forearms, slot * 2 + side, shoulderX, elbowY - Math.cos(elbowAngle) * forearmLength / 2, elbowZ - Math.sin(elbowAngle) * forearmLength / 2, elbowAngle, forearmLength / .26);
        place(hands, slot * 2 + side, shoulderX, elbowY - Math.cos(elbowAngle) * (forearmLength + .013), elbowZ - Math.sin(elbowAngle) * (forearmLength + .013));
      }
      matrix.makeScale(.46, 1, .46).setPosition(point.x, .231, point.z); shadows.setMatrixAt(slot, matrix);
      slot++;
    }
    for (const body of staticBodies) body.count = slot;
    for (const limbs of [upperArms, forearms, hands, shoes]) limbs.count = slot * 2;
    legs.count = slot * 4; shadows.count = slot;
    for (const mesh of batches) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
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
      batches.forEach(mesh => mesh.dispose()); geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); group.clear();
    },
  };
}
