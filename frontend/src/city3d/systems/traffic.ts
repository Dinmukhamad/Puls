/**
 * Traffic (TZ §7.1): cars drive the generator's loops and boats the canal, moved on the CPU. The vehicles are the
 * city's own (assets/vehicles.ts, docs/CITY_V4.md stage 4): each kind is one geometry, drawn as one copy mesh
 * (render/copies.ts) in the vehicles' shared material, its paint from the kind's palette per vehicle. Every frame the
 * vehicles in view are packed to the front of their kind's buffers and the instance count cuts the rest, so far
 * and off-screen cars cost the GPU nothing and draw calls do not grow with the city: one per kind on the screen.
 * Every car has a blob shadow and casts none into the sun's map: that map is static, and a moving car would
 * leave its shadow behind on the road.
 * At night (TZ §6.7) cars show head and tail lights and a beam on the road ahead, boats their navigation
 * lights: additive glow scaled by the night level in the shaders, no light sources. All cars' lamps are one
 * copy mesh and their beams another, sharing one matrix buffer; boat lights are one more part of the boats.
 * Three draw calls at night, none in the day.
 */
import * as THREE from "three/webgpu";
import { attribute, float, rangeFogFactor, saturate, smoothstep, uv } from "three/tsl";
import { PAINTS, vehicleGeometry, vehicleMaterial, type VehicleName } from "../assets/vehicles";
import type { CityContext } from "../engine/context";
import { sampleRoute } from "../world/generate";
import type { Route } from "../world/types";
import { COPY_STRIDE, copyMatrices, copyMesh, copyTints } from "../render/copies";
import { skyLook } from "../render/sky";

/** The vehicles are built 1.5 units wide, as the Car Kit's were; this makes them fit a one-unit lane. */
export const CAR_SCALE = .5, BOAT_SCALE = .75;
/** Every fourth car on the inner ring road and every car elsewhere comes from this list: half are taxis. */
const TRAFFIC: VehicleName[] = ["taxi", "sedan", "taxi", "suv", "taxi", "van", "taxi", "delivery", "taxi", "hatchback-sports"];
/** Road surfaces of the old city: ring roads lie a little lower than streets and bridges; boats float in the canal. */
const RING_Y = .215, STREET_Y = .26, WATER_Y = -1.36, BLOB_LIFT = .012;
/** A vehicle and its shadow fit in a sphere of 2; the rest covers a frame of camera turn before the next packing. */
const REACH = 3;
/** Night lights, in linear colour times a glow above the bloom threshold. Car lamps sit at the height of the models' own. */
const HEAD = "#fff2d0", TAIL = "#ff1008", HEAD_GLOW = 4, TAIL_GLOW = 1.6, LAMP_Y = .62;
/** The beam: a soft pool on the road ahead, in car lengths, just above the road markings. */
const BEAM = "#fff2d0", BEAM_STRENGTH = .6, BEAM_LENGTH = 1.4, BEAM_LIFT = .02;

/** `size`: the vehicle's bounds; `paints`: its palette; `lights`: a night-only geometry (boats). */
interface Kind { name: VehicleName; geometry: THREE.BufferGeometry; base: THREE.Matrix4; size: THREE.Vector3; paints: THREE.Color[]; lights?: THREE.BufferGeometry }
/** `paint`: the vehicle's shade in its kind's palette. */
interface Vehicle { route: Route; s: number; speed: number; boat: boolean; active: boolean; rank: number; paint: number }
type CopyMesh = ReturnType<typeof copyMesh>;
/** `owners`: which vehicle each slot of the buffers last held, so a shade is written only when a slot changes hands. */
interface Fleet { kind: Kind; vehicles: Vehicle[]; matrices: THREE.InstancedInterleavedBuffer; tints: THREE.InstancedBufferAttribute; owners: Int32Array; meshes: CopyMesh[] }

export interface Traffic {
  setEnabled(enabled: boolean): void;
  /** Objects for the dynamic shadow map: the group of vehicle meshes. */
  movers: THREE.Object3D[];
  dispose(): void;
}

/** A vehicle centred on its footprint with its wheels (or keel) at y = 0. */
function kindOf(name: VehicleName, lights?: THREE.BufferGeometry): Kind {
  const geometry = vehicleGeometry(name), bounds = geometry.boundingBox!, center = bounds.getCenter(new THREE.Vector3());
  return { name, geometry, base: new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z), size: bounds.getSize(new THREE.Vector3()), paints: PAINTS[name].map(c => new THREE.Color(c)), lights };
}
/** [width, height, depth, x, y, z, colour, glow]: one box of a vertex-coloured part. */
type Box = [number, number, number, number, number, number, string, number?];
/** Boxes merged into one geometry; the colour is linear times `glow`, so lights can pass the bloom threshold. */
function boxes(list: Box[]) {
  const geometry = new THREE.BufferGeometry(), positions: number[] = [], normals: number[] = [], colors: number[] = [];
  for (const [w, h, d, x, y, z, hex, glow = 1] of list) {
    const box = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(), c = new THREE.Color(hex).multiplyScalar(glow);
    positions.push(...box.getAttribute("position").array); normals.push(...box.getAttribute("normal").array);
    for (let i = 0; i < box.getAttribute("position").count; i++) colors.push(c.r, c.g, c.b);
    box.dispose();
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  return geometry;
}
/** Additive glow: never darkens or hides what is behind; no fog colour, it fades with the fog by itself. */
const glowMaterial = () => new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });

/**
 * The motor boat's night lights, in its own frame (it faces +z like the cars): a white mast light over the cabin,
 * red to port (+x when heading +z) and green to starboard on the hull's sides by the bow, warm cabin windows.
 */
function boatLights() {
  return boxes([
    [.1, .1, .1, 0, .82, -.35, "#ffffff", 5],
    [.03, .07, .14, .48, .3, .66, "#ff2a18", 5], [.03, .07, .14, -.48, .3, .66, "#22ff66", 4],
    [.02, .12, .44, .31, .56, -.25, "#ffc070", 1.6], [.02, .12, .44, -.31, .56, -.25, "#ffc070", 1.6],
  ]);
}
/** Head and tail lights of any car in a frame where the car is 1 wide and 1 long; heights are in model units. */
function carLamps() {
  const list: Box[] = [];
  for (const side of [-1, 1]) list.push([.2, .12, .04, side * .33, LAMP_Y, .49, HEAD, HEAD_GLOW], [.18, .1, .04, side * .33, LAMP_Y, -.49, TAIL, TAIL_GLOW]);
  return boxes(list);
}
/** The beam in the same frame: a flat trapezoid from under the bumper forwards, u across and v along it. */
function beamGeometry() {
  const y = BEAM_LIFT / CAR_SCALE, near = .46, far = near + BEAM_LENGTH, geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-.36, y, near, .36, y, near, -.62, y, far, .62, y, far], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  return geometry;
}
/** The old canvas gradient: 55 % dark green in the middle fading out at the rim, drawn at half opacity. */
function blobMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({ color: "#23402c", transparent: true, depthWrite: false });
  material.opacityNode = saturate(uv().sub(.5).length().mul(2).oneMinus().div(.875)).mul(.275);
  return material;
}

/** Whether vehicle `rank` of a loop stays at this crowd share: every n-th one goes, so the rest stay evenly spread. */
export const activeAt = (rank: number, share: number) => Math.floor((rank + 1) * share) > Math.floor(rank * share);

export function createTraffic(ctx: CityContext): Traffic {
  const group = new THREE.Group(); group.name = "city-traffic"; ctx.scene.add(group);
  const blobGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobs = blobMaterial();
  const level = ctx.night.level, fog = ctx.scene.fog instanceof THREE.Fog ? ctx.scene.fog : null;
  // Glow fades with the fog, as the cars under it do.
  const clearAir = fog ? rangeFogFactor(float(fog.near), float(fog.far)).oneMinus() : float(1);
  const lampMaterial = glowMaterial(), beamMaterial = glowMaterial();
  lampMaterial.colorNode = attribute("color", "vec3").mul(level).mul(clearAir);
  beamMaterial.color.set(BEAM);
  // Brightest a little ahead of the bumper, fading out forwards and to the sides.
  const along = uv().y, across = uv().x;
  beamMaterial.opacityNode = smoothstep(0, .12, along).mul(along.oneMinus().pow(2)).mul(smoothstep(0, .45, across)).mul(smoothstep(0, .45, across.oneMinus()))
    .mul(level).mul(clearAir).mul(BEAM_STRENGTH);
  // Ahead of the road tops and markings at any distance.
  beamMaterial.polygonOffset = true; beamMaterial.polygonOffsetFactor = -2; beamMaterial.polygonOffsetUnits = -2;
  // One material for every vehicle, mirroring the sky of the moment.
  const material = vehicleMaterial(skyLook(ctx.scene)), lightsGeometry = boatLights();
  const rings = ctx.world.roads.rings;
  // Lamps and beams of all cars: one draw call each, one matrix per car (unit frame scaled to the car's bounds).
  const carCount = Math.max(1, ctx.world.routes.reduce((sum, plan) => sum + (plan.boats ? 0 : plan.cars), 0));
  const lampMatrices = copyMatrices(carCount).setUsage(THREE.DynamicDrawUsage), white = copyTints(carCount);
  const lamps = copyMesh(carLamps(), lampMaterial, lampMatrices, white), beams = copyMesh(beamGeometry(), beamMaterial, lampMatrices, white);
  lamps.name = "city-traffic-lamps"; beams.name = "city-traffic-beams";
  for (const mesh of [lamps, beams]) ctx.scene.add(mesh);
  // Contact shadows: one per car, in a buffer of their own.
  const blobMatrices = copyMatrices(carCount).setUsage(THREE.DynamicDrawUsage), shadows = copyMesh(blobGeometry, blobs, blobMatrices, white);
  shadows.name = "city-traffic-shadows"; ctx.scene.add(shadows);
  let fleets: Fleet[] = [], boatGlow: CopyMesh | null = null;
  let enabled = !ctx.reducedMotion, dirty = true, clock = 0, crowd = ctx.quality.crowd, lit = false;
  /** Night meshes are drawn only while the level is above 0; the lamp matrices are written only then. */
  function show() {
    lit = level.value > 0;
    lamps.visible = beams.visible = lit;
    if (boatGlow) boatGlow.visible = lit;
  }
  show();

  const kinds = new Map<VehicleName, Kind>();
  const kind = (name: VehicleName): Kind => { let k = kinds.get(name); if (!k) { k = kindOf(name, name === "boat" ? lightsGeometry : undefined); kinds.set(name, k); } return k; };
  /** Loops start at different phases, so vehicles are spread over the map from the first frame. */
  function build() {
    const lists = new Map<Kind, Vehicle[]>();
    let n = 0;
    ctx.world.routes.forEach((plan, i) => {
      const mainRing = !plan.boats && plan.route.points.every(p => Math.abs(Math.hypot(p.x, p.z) - rings[0]) < 1);
      for (let k = 0; k < plan.cars; k++) {
        const name: VehicleName = plan.boats ? "boat" : mainRing && k % 4 !== 3 ? "taxi" : TRAFFIC[n++ % TRAFFIC.length];
        // The kind's vehicles take its paints in turn.
        const list = lists.get(kind(name)) ?? [];
        list.push({ route: plan.route, s: ((k / plan.cars + i * .618) % 1) * plan.route.length, speed: plan.speed, boat: !!plan.boats, rank: k, active: activeAt(k, crowd), paint: list.length });
        lists.set(kind(name), list);
      }
    });
    lists.forEach((list, k) => {
      const matrices = copyMatrices(list.length).setUsage(THREE.DynamicDrawUsage), tints = copyTints(list.length).setUsage(THREE.DynamicDrawUsage);
      const mesh = copyMesh(k.geometry, material, matrices, tints);
      // The shadow map is static: a car casting into it would leave its shadow behind on the road.
      mesh.name = `city-traffic-${k.name}`; mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh);
      const meshes = [mesh];
      if (k.lights) {
        // Glow casts no shadow, so it stays out of the movers group.
        boatGlow = copyMesh(k.lights, lampMaterial, matrices, list.length > carCount ? copyTints(list.length) : white); boatGlow.name = "city-traffic-boat-lights";
        ctx.scene.add(boatGlow); meshes.push(boatGlow); show();
      }
      fleets.push({ kind: k, vehicles: list, matrices, tints, owners: new Int32Array(list.length).fill(-1), meshes });
    });
    dirty = true;
  }

  const frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), REACH);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), turn = new THREE.Quaternion(), size = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const roadY = (x: number, z: number) => { const r = Math.hypot(x, z); for (const ring of rings) if (Math.abs(r - ring) < 1.05) return RING_Y; return STREET_Y; };
  /** Moves the vehicles by `dt` and packs the visible ones into the instance buffers. */
  function place(dt: number) {
    // Farther from a high camera: zoomed out, the cars on the streets it looks down on stay in the picture.
    const { camera } = ctx, far = ctx.quality.lodDistances[2] + Math.min(450, Math.max(0, camera.position.y - 40) * 1.5);
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    const blobArray = blobMatrices.array as Float32Array, lampArray = lampMatrices.array as Float32Array;
    let blob = 0, lamp = 0;
    clock += dt;
    for (const fleet of fleets) {
      const array = fleet.matrices.array as Float32Array, bounds = fleet.kind.size, paints = fleet.kind.paints, shades = fleet.tints.array as Float32Array;
      let count = 0, repainted = false;
      for (let index = 0; index < fleet.vehicles.length; index++) {
        const v = fleet.vehicles[index];
        v.s = (v.s + v.speed * dt) % v.route.length;
        if (!v.active) continue;
        const p = sampleRoute(v.route, v.s);
        if (p.hidden) continue;
        position.set(p.x, v.boat ? WATER_Y + Math.sin(clock * 1.67 + v.s) * .04 : roadY(p.x, p.z), p.z);
        if (position.distanceToSquared(camera.position) > far * far || !frustum.intersectsSphere(sphere.set(position, REACH))) continue;
        turn.setFromAxisAngle(up, p.heading);
        // Its shade goes up only when the slot changed hands: on most frames every vehicle keeps its slot.
        if (fleet.owners[count] !== index) { fleet.owners[count] = index; paints[v.paint % paints.length].toArray(shades, count * 3); repainted = true; }
        matrix.compose(position, turn, size.setScalar(v.boat ? BOAT_SCALE : CAR_SCALE)).multiply(fleet.kind.base).toArray(array, count++ * COPY_STRIDE);
        if (v.boat) continue;
        // Lamps and beam: the frame of the centred parts, stretched to the car's width and length.
        if (lit) matrix.compose(position, turn, size.set(CAR_SCALE * bounds.x, CAR_SCALE, CAR_SCALE * bounds.z)).toArray(lampArray, lamp++ * COPY_STRIDE);
        // Exactly one contact shadow per car, under the car whatever the sun does.
        position.y += BLOB_LIFT;
        matrix.compose(position, turn, size.set(.95, 1, 1.7)).toArray(blobArray, blob++ * COPY_STRIDE);
      }
      for (const mesh of fleet.meshes) mesh.geometry.instanceCount = count;
      fleet.matrices.needsUpdate = true;
      if (repainted) fleet.tints.needsUpdate = true;
    }
    shadows.geometry.instanceCount = blob; blobMatrices.needsUpdate = true;
    lamps.geometry.instanceCount = beams.geometry.instanceCount = lamp;
    if (lit) lampMatrices.needsUpdate = true;
  }

  const offFrame = ctx.onFrame(dt => {
    // Dusk or dawn began: paused cars need their lamp matrices once.
    if ((level.value > 0) !== lit) { show(); dirty = true; }
    if (!enabled && !dirty) return;
    place(enabled ? dt : 0); dirty = false;
  });
  // Paused vehicles stand still, but the camera still decides which of them are drawn.
  const offCamera = ctx.onCameraMove(() => { dirty = true; });
  const offQuality = ctx.onQuality(q => {
    if (q.crowd === crowd) return;
    crowd = q.crowd; dirty = true;
    for (const fleet of fleets) for (const v of fleet.vehicles) v.active = activeAt(v.rank, crowd);
  });
  build();

  return {
    setEnabled(next) { enabled = next; },
    movers: [group],
    dispose() {
      offFrame(); offCamera(); offQuality();
      // The vehicles' shapes live for the session (assets/vehicles.ts) and the car parks draw them too: freeing the
      // copy meshes only lets their buffers go up again where they are drawn next.
      for (const fleet of fleets) for (const mesh of fleet.meshes) { mesh.removeFromParent(); mesh.geometry.dispose(); }
      fleets = []; boatGlow = null; kinds.clear();
      group.removeFromParent();
      // These copy meshes are the only users of their geometries: freeing them frees the shapes' buffers too.
      for (const mesh of [lamps, beams, shadows]) { mesh.removeFromParent(); mesh.geometry.dispose(); }
      blobs.dispose(); lightsGeometry.dispose(); material.dispose(); lampMaterial.dispose(); beamMaterial.dispose();
    },
  };
}
