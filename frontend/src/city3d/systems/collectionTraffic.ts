/** Animated collection models: shared material, three geometric LODs and one instance batch per kind/LOD. */
import * as THREE from "three/webgpu";
import { uv, saturate, attribute } from "three/tsl";
import type { TransportModel } from "../assets/transportCollection";
import { vehicleMaterial } from "../assets/vehicles";
import type { CityContext } from "../engine/context";
import { copyMatrices, copyMesh, copyTints } from "../render/copies";
import { skyLook } from "../render/sky";
import { sampleRoute } from "../world/generate";
import type { Route } from "../world/types";
import { createTransportPlans, MARINE_MODEL_IDS, ROAD_MODEL_IDS, shuffled } from "./transportRoutes";
import type { Traffic } from "./traffic";

type CopyMesh = ReturnType<typeof copyMesh>;
interface Vehicle { route: Route; distance: number; speed: number; rank: number; phase: number; paint: number }
interface Pack { matrices: THREE.InstancedInterleavedBuffer; tints: THREE.InstancedBufferAttribute; painted: Int32Array; mesh: CopyMesh; count: number }
interface Fleet { model: TransportModel; vehicles: Vehicle[]; packs: Pack[]; marine: boolean }
const activeAt = (rank: number, share: number) => Math.floor((rank + 1) * share) > Math.floor(rank * share);

/** Small merged luminous boxes. The frame is one unit wide/long, +Z forward. */
function lightGeometry(marine: boolean) {
  const positions: number[] = [], colors: number[] = [], normals: number[] = [];
  const parts: [number, number, number, number, number, number, string][] = marine
    ? [[.025, .08, .07, .45, .35, .3, "#ff2211"], [.025, .08, .07, -.45, .35, .3, "#22ff66"], [.05, .05, .05, 0, .9, -.2, "#ffffff"]]
    : [-1, 1].flatMap(side => [[.2, .12, .03, side * .32, .62, .49, "#fff2d0"], [.18, .1, .03, side * .32, .62, -.49, "#ff1008"]] as typeof parts);
  for (const [w, h, d, x, y, z, color] of parts) {
    const box = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(), shade = new THREE.Color(color).multiplyScalar(4);
    positions.push(...box.attributes.position.array); normals.push(...box.attributes.normal.array);
    for (let i = 0; i < box.attributes.position.count; i++) colors.push(shade.r, shade.g, shade.b);
    box.dispose();
  }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    .setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3)).setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
}

export function createCollectionTraffic(ctx: CityContext, models: Map<string, TransportModel>, random: () => number, parent: THREE.Object3D): Traffic {
  const group = new THREE.Group(); group.name = "city-traffic"; group.userData.collection = true; parent.add(group);
  const plans = createTransportPlans(ctx.world, random), material = vehicleMaterial(skyLook(ctx.scene));
  // The collection includes two-sided sails, windscreens and thin trim panels.
  material.side = THREE.DoubleSide;
  const roadBag = shuffled(ROAD_MODEL_IDS, random), marineBag = shuffled(MARINE_MODEL_IDS, random);
  const fleets = new Map<string, Fleet>();
  let roadIndex = 0, marineIndex = 0;
  for (const plan of plans) {
    // Equal speed within each lane keeps the evenly spaced vehicles from overtaking one another.
    const start = random(), speed = plan.speed * (.85 + random() * .3);
    for (let rank = 0; rank < plan.cars; rank++) {
      const id = plan.boats ? marineBag[marineIndex++ % marineBag.length] : roadBag[roadIndex++ % roadBag.length];
      const model = models.get(id)!;
      let fleet = fleets.get(id);
      if (!fleet) { fleet = { model, vehicles: [], packs: [], marine: !!plan.boats }; fleets.set(id, fleet); }
      fleet.vehicles.push({ route: plan.route, distance: ((rank / plan.cars + start) % 1) * plan.route.length, speed, rank: plan.boats ? marineIndex - 1 : rank, phase: random() * Math.PI * 2, paint: fleet.vehicles.length % Math.max(1, model.paints.length) });
    }
  }
  for (const fleet of fleets.values()) fleet.packs = fleet.model.lods.map((geometry, lod) => {
    const matrices = copyMatrices(fleet.vehicles.length).setUsage(THREE.DynamicDrawUsage);
    const tints = copyTints(fleet.vehicles.length).setUsage(THREE.DynamicDrawUsage);
    const mesh = copyMesh(geometry, material, matrices, tints);
    mesh.name = `city-traffic-${fleet.model.id}-lod${lod}`; mesh.userData.model = fleet.model.id; mesh.userData.lod = lod;
    mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh);
    return { matrices, tints, painted: new Int32Array(fleet.vehicles.length).fill(-1), mesh, count: 0 };
  });

  const roadCount = Math.max(1, roadIndex), boatCount = Math.max(1, marineIndex);
  const blobGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const blobMaterial = new THREE.MeshBasicNodeMaterial({ color: "#23402c", transparent: true, depthWrite: false });
  blobMaterial.opacityNode = saturate(uv().sub(.5).length().mul(2).oneMinus().div(.875)).mul(.275);
  const shadowMatrices = copyMatrices(roadCount).setUsage(THREE.DynamicDrawUsage);
  const shadows = copyMesh(blobGeometry, blobMaterial, shadowMatrices, copyTints(roadCount));
  shadows.name = "city-traffic-shadows"; parent.add(shadows);
  const glow = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  glow.colorNode = attribute("color", "vec3").mul(ctx.night.level);
  const roadLightGeometry = lightGeometry(false), boatLightGeometry = lightGeometry(true);
  const lampMatrices = copyMatrices(roadCount).setUsage(THREE.DynamicDrawUsage), boatMatrices = copyMatrices(boatCount).setUsage(THREE.DynamicDrawUsage);
  const lamps = copyMesh(roadLightGeometry, glow, lampMatrices, copyTints(roadCount)); lamps.name = "city-traffic-lamps";
  const boatLamps = copyMesh(boatLightGeometry, glow, boatMatrices, copyTints(boatCount)); boatLamps.name = "city-traffic-boat-lights";
  for (const mesh of [lamps, boatLamps]) parent.add(mesh);
  // A soft additive pool ahead of the bumper, also shared by every road vehicle.
  const beamGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, .025, 1);
  const beamMaterial = new THREE.MeshBasicNodeMaterial({ color: "#fff2d0", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  beamMaterial.opacityNode = saturate(uv().sub(.5).length().mul(2).oneMinus()).mul(ctx.night.level).mul(.22);
  const beams = copyMesh(beamGeometry, beamMaterial, lampMatrices, copyTints(roadCount)); beams.name = "city-traffic-beams"; parent.add(beams);
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), sphere = new THREE.Sphere();
  const position = new THREE.Vector3(), center = new THREE.Vector3(), matrix = new THREE.Matrix4(), size = new THREE.Vector3(), turn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const white = new THREE.Color(1, 1, 1);
  let enabled = !ctx.reducedMotion, dirty = true, clock = 0, lit = false;
  const ringY = (x: number, z: number) => ctx.world.roads.rings.some(r => Math.abs(Math.hypot(x, z) - r) < 1.05) ? .215 : .26;
  function place(dt: number) {
    clock += dt;
    const camera = ctx.camera, quality = ctx.quality, night = ctx.night.level.value > 0;
    lamps.visible = boatLamps.visible = beams.visible = night; lit = night;
    const far = quality.lodDistances[2] + Math.min(450, Math.max(0, camera.position.y - 40) * 1.5);
    camera.updateMatrixWorld(); frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    let blob = 0, lamp = 0, boatLamp = 0;
    for (const fleet of fleets.values()) {
      const { model, marine, packs } = fleet, scale = model.scale, bounds = model.size;
      packs.forEach(pack => { pack.count = 0; });
      for (const vehicle of fleet.vehicles) {
        vehicle.distance = (vehicle.distance + vehicle.speed * dt) % vehicle.route.length;
        if (!activeAt(vehicle.rank, quality.crowd)) continue;
        const p = sampleRoute(vehicle.route, vehicle.distance);
        if (p.hidden) continue;
        position.set(p.x, marine ? -1.25 - model.draft + Math.sin(clock * 1.2 + vehicle.phase) * .012 : ringY(p.x, p.z), p.z);
        const distance = position.distanceTo(camera.position), reach = Math.max(1, bounds.length() * scale / 2);
        center.copy(position); center.y += bounds.y * scale / 2;
        if (distance > far || !frustum.intersectsSphere(sphere.set(center, reach))) continue;
        let lod = distance < quality.lodDistances[0] ? 0 : distance < quality.lodDistances[1] ? 1 : 2;
        if (quality.tier === "low") lod = Math.max(1, lod);
        const pack = packs[lod], slot = pack.count++;
        turn.setFromAxisAngle(up, p.heading);
        matrix.compose(position, turn, size.setScalar(scale)).multiply(model.base).toArray(pack.matrices.array, slot * 16);
        // The paint belongs to the logical vehicle, so culling/density/LOD packing cannot repaint it.
        if (pack.painted[slot] !== vehicle.paint) {
          pack.painted[slot] = vehicle.paint;
          (model.paints[vehicle.paint] ?? white).toArray(pack.tints.array, slot * 3);
          pack.tints.needsUpdate = true;
        }
        if (marine) {
          if (night) {
            // Navigation lamps follow the hull at its waterline, independent of a tall sail's full height.
            center.copy(position); center.y += model.draft;
            matrix.compose(center, turn, size.set(bounds.x * scale, .3, bounds.z * scale)).toArray(boatMatrices.array, boatLamp++ * 16);
          }
        } else {
          if (night) matrix.compose(position, turn, size.set(bounds.x * scale, Math.max(.28, bounds.y * scale * .55), bounds.z * scale)).toArray(lampMatrices.array, lamp++ * 16);
          center.copy(position); center.y += .012;
          matrix.compose(center, turn, size.set(bounds.x * scale * 1.35, 1, bounds.z * scale * 1.15)).toArray(shadowMatrices.array, blob++ * 16);
        }
      }
      for (const pack of packs) { pack.mesh.geometry.instanceCount = pack.count; pack.matrices.needsUpdate = true; }
    }
    shadows.geometry.instanceCount = blob; shadowMatrices.needsUpdate = true;
    lamps.geometry.instanceCount = beams.geometry.instanceCount = lamp; boatLamps.geometry.instanceCount = boatLamp;
    if (night) { lampMatrices.needsUpdate = true; boatMatrices.needsUpdate = true; }
  }
  const offFrame = ctx.onFrame(dt => {
    if ((ctx.night.level.value > 0) !== lit) dirty = true;
    if (!enabled && !dirty) return;
    place(enabled ? dt : 0); dirty = false;
  });
  const offCamera = ctx.onCameraMove(() => { dirty = true; }), offQuality = ctx.onQuality(() => { dirty = true; });
  place(0);
  return {
    setEnabled(next) { enabled = next; dirty = true; }, movers: [group],
    dispose() {
      offFrame(); offCamera(); offQuality();
      for (const fleet of fleets.values()) for (const pack of fleet.packs) { pack.mesh.removeFromParent(); pack.mesh.geometry.dispose(); }
      for (const mesh of [shadows, lamps, boatLamps, beams]) { mesh.removeFromParent(); mesh.geometry.dispose(); }
      group.removeFromParent(); material.dispose(); blobMaterial.dispose(); glow.dispose(); beamMaterial.dispose();
      for (const geometry of [blobGeometry, roadLightGeometry, boatLightGeometry, beamGeometry]) geometry.dispose();
    },
  };
}
