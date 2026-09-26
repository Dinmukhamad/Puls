/**
 * Traffic, stage 1 (TZ §7.1; the GPU version replaces it in stage 2): cars drive the generator's loops and
 * boats the canal, moved on the CPU. Each model part is one InstancedMesh, and all parts of a model share
 * one matrix buffer. Every frame the vehicles in view are packed to the front of that buffer and `count`
 * cuts the rest, so far and off-screen cars cost the GPU nothing and draw calls do not grow with the city.
 * Every car has a blob shadow; cars and boats also cast into the dynamic shadow map (`movers`).
 */
import * as THREE from "three/webgpu";
import { saturate, uv } from "three/tsl";
import { createTaxiModel } from "../../pages/city/cityTraffic";
import type { Model } from "../assets/loader";
import type { CityContext } from "../engine/context";
import { sampleRoute } from "../world/generate";
import type { Route } from "../world/types";
import { disposeTree } from "./districts";

/** Car Kit vehicles are 1.5 units wide; this makes them fit a one-unit lane. */
export const CAR_SCALE = .5, BOAT_SCALE = .75;
/** Every fourth car on the inner ring road and every car elsewhere comes from this list: half are taxis. */
const TRAFFIC = ["taxi", "sedan", "taxi", "suv", "taxi", "van", "taxi", "delivery", "taxi", "hatchback-sports"];
/** Road surfaces of the old city: ring roads lie a little lower than streets and bridges; boats float in the canal. */
const RING_Y = .215, STREET_Y = .26, WATER_Y = -1.36, BLOB_LIFT = .012;
/** A vehicle and its shadow fit in a sphere of 2; the rest covers a frame of camera turn before the next packing. */
const REACH = 3;

interface Kind { parts: { geometry: THREE.BufferGeometry; material: THREE.Material; castShadow: boolean }[]; base: THREE.Matrix4 }
interface Vehicle { route: Route; s: number; speed: number; boat: boolean; active: boolean; rank: number }
interface Fleet { kind: Kind; vehicles: Vehicle[]; matrices: THREE.InstancedBufferAttribute; meshes: THREE.InstancedMesh[] }

export interface TrafficOptions {
  /** Catalogue cars (Kenney Car Kit from vehicles.glb by scene name); without them every car is a taxi. They stay the caller's. */
  vehicles?: Map<string, Model>;
}

export interface Traffic {
  setEnabled(enabled: boolean): void;
  /** Swaps the catalogue cars in once they have loaded. */
  setVehicles(vehicles: Map<string, Model>): void;
  /** Objects for the dynamic shadow map: the group of vehicle meshes, whose children change on setVehicles. */
  movers: THREE.Object3D[];
  dispose(): void;
}

/** Parts centred on the footprint with the wheels at y = 0, as the old modelParts() did. */
function kindOf(parts: Kind["parts"], bounds: THREE.Box3): Kind {
  const center = bounds.getCenter(new THREE.Vector3());
  return { parts, base: new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z) };
}
function taxiKind(taxi: THREE.Object3D) {
  const parts: Kind["parts"] = [];
  taxi.updateMatrixWorld(true);
  taxi.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) parts.push({ geometry: mesh.geometry, material: mesh.material as THREE.Material, castShadow: true }); });
  return kindOf(parts, new THREE.Box3().setFromObject(taxi));
}
/** A small white motor boat with a blue stripe and a cabin, in one vertex-coloured part. */
function boatKind() {
  const boxes: [number, number, number, number, number, string][] = [[1, .36, 2.1, .18, 0, "#ffffff"], [1.02, .08, 2.12, .3, 0, "#3f78d8"], [.6, .34, .7, .53, -.25, "#f4efe4"]];
  const geometry = new THREE.BufferGeometry(), positions: number[] = [], normals: number[] = [], colors: number[] = [];
  for (const [w, h, d, y, z, hex] of boxes) {
    const box = new THREE.BoxGeometry(w, h, d).translate(0, y, z).toNonIndexed(), c = new THREE.Color(hex);
    positions.push(...box.getAttribute("position").array); normals.push(...box.getAttribute("normal").array);
    for (let i = 0; i < box.getAttribute("position").count; i++) colors.push(c.r, c.g, c.b);
    box.dispose();
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .72, metalness: .04 });
  return kindOf([{ geometry, material, castShadow: true }], geometry.boundingBox!);
}
/** The old canvas gradient: 55 % dark green in the middle fading out at the rim, drawn at half opacity. */
function blobMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({ color: "#23402c", transparent: true, depthWrite: false });
  material.opacityNode = saturate(uv().sub(.5).length().mul(2).oneMinus().div(.875)).mul(.275);
  return material;
}

/** Whether vehicle `rank` of a loop stays at this crowd share: every n-th one goes, so the rest stay evenly spread. */
export const activeAt = (rank: number, share: number) => Math.floor((rank + 1) * share) > Math.floor(rank * share);

export function createTraffic(ctx: CityContext, { vehicles }: TrafficOptions = {}): Traffic {
  const group = new THREE.Group(); group.name = "city-traffic"; ctx.scene.add(group);
  const blobGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobs = blobMaterial();
  const taxiModel = createTaxiModel(), taxi = taxiKind(taxiModel), boat = boatKind();
  const rings = ctx.world.roads.rings;
  let catalogue = vehicles ?? null, fleets: Fleet[] = [], shadows: THREE.InstancedMesh | null = null;
  let enabled = !ctx.reducedMotion, dirty = true, clock = 0, crowd = ctx.quality.crowd;

  const kinds = new Map<string, Kind>();
  function kind(name: string): Kind {
    if (name === "taxi") return taxi;
    if (name === "boat") return boat;
    if (!kinds.has(name)) { const model = catalogue?.get(name); kinds.set(name, model ? kindOf(model.parts, model.bounds) : taxi); }
    return kinds.get(name)!;
  }
  function clear() {
    for (const fleet of fleets) for (const mesh of fleet.meshes) { mesh.removeFromParent(); mesh.dispose(); }
    shadows?.removeFromParent(); shadows?.dispose();
    fleets = []; shadows = null; kinds.clear();
  }
  /** Loops start at different phases, so vehicles are spread over the map from the first frame. */
  function build() {
    clear();
    const lists = new Map<Kind, Vehicle[]>();
    let n = 0, cars = 0;
    ctx.world.routes.forEach((plan, i) => {
      const mainRing = !plan.boats && plan.route.points.every(p => Math.abs(Math.hypot(p.x, p.z) - rings[0]) < 1);
      for (let k = 0; k < plan.cars; k++) {
        const name = plan.boats ? "boat" : !catalogue || (mainRing && k % 4 !== 3) ? "taxi" : TRAFFIC[n++ % TRAFFIC.length];
        const vehicle: Vehicle = { route: plan.route, s: ((k / plan.cars + i * .618) % 1) * plan.route.length, speed: plan.speed, boat: !!plan.boats, rank: k, active: activeAt(k, crowd) };
        const list = lists.get(kind(name)) ?? []; list.push(vehicle); lists.set(kind(name), list);
        if (!plan.boats) cars++;
      }
    });
    lists.forEach((list, k) => {
      const matrices = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 16), 16).setUsage(THREE.DynamicDrawUsage);
      const meshes = k.parts.map(part => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        // One buffer for all parts: each car's matrix is written once, not once per part.
        mesh.instanceMatrix = matrices; mesh.count = 0; mesh.frustumCulled = false;
        mesh.castShadow = part.castShadow; mesh.receiveShadow = true; group.add(mesh);
        return mesh;
      });
      fleets.push({ kind: k, vehicles: list, matrices, meshes });
    });
    shadows = new THREE.InstancedMesh(blobGeometry, blobs, Math.max(1, cars));
    shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage); shadows.count = 0; shadows.frustumCulled = false; shadows.name = "city-traffic-shadows";
    ctx.scene.add(shadows); dirty = true;
  }

  const frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), REACH);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), turn = new THREE.Quaternion(), size = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const roadY = (x: number, z: number) => { const r = Math.hypot(x, z); for (const ring of rings) if (Math.abs(r - ring) < 1.05) return RING_Y; return STREET_Y; };
  /** Moves the vehicles by `dt` and packs the visible ones into the instance buffers. */
  function place(dt: number) {
    const { camera } = ctx, far = ctx.quality.lodDistances[2];
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    const blobArray = shadows!.instanceMatrix.array as Float32Array;
    let blob = 0;
    clock += dt;
    for (const fleet of fleets) {
      const array = fleet.matrices.array as Float32Array;
      let count = 0;
      for (const v of fleet.vehicles) {
        v.s = (v.s + v.speed * dt) % v.route.length;
        if (!v.active) continue;
        const p = sampleRoute(v.route, v.s);
        if (p.hidden) continue;
        position.set(p.x, v.boat ? WATER_Y + Math.sin(clock * 1.67 + v.s) * .04 : roadY(p.x, p.z), p.z);
        if (position.distanceToSquared(camera.position) > far * far || !frustum.intersectsSphere(sphere.set(position, REACH))) continue;
        turn.setFromAxisAngle(up, p.heading);
        matrix.compose(position, turn, size.setScalar(v.boat ? BOAT_SCALE : CAR_SCALE)).multiply(fleet.kind.base).toArray(array, count++ * 16);
        if (v.boat) continue;
        // Exactly one contact shadow per car, under the car whatever the sun does.
        position.y += BLOB_LIFT;
        matrix.compose(position, turn, size.set(.95, 1, 1.7)).toArray(blobArray, blob++ * 16);
      }
      for (const mesh of fleet.meshes) mesh.count = count;
      fleet.matrices.needsUpdate = true;
    }
    shadows!.count = blob; shadows!.instanceMatrix.needsUpdate = true;
  }

  const offFrame = ctx.onFrame(dt => {
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
    setVehicles(next) { catalogue = next; build(); },
    movers: [group],
    dispose() {
      offFrame(); offCamera(); offQuality(); clear();
      group.removeFromParent();
      disposeTree(taxiModel); boat.parts.forEach(p => { p.geometry.dispose(); p.material.dispose(); });
      blobGeometry.dispose(); blobs.dispose();
    },
  };
}
