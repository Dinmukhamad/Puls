/**
 * District landmarks (TZ §5.5): a building of its own for each of five stages by completed missions
 * (assets/landmarkModels.ts), all standing the same way, their fronts to the default view
 * (engine/camera.ts DISTRICT_FACING); the reserved "future-*" islands share one instanced construction site. A ring inside the island
 * lights up on hover and pulses while selected; invisible cylinders take the picking rays; a district that
 * levelled up grows in under a burst of confetti.
 *
 * The landmarks are drawn in the city's v4 style (docs/CITY_V4.md): one facade material for all of them
 * (assets/facade.ts), whose windows setNight() switches on and off; only the signs have materials of their own.
 *
 * At night (TZ §6.7) the windows light up, warm floodlights on every island wash its building from below
 * and a ring of small lights circles the plaza's pedestal. The light is faked, as for the street lamps:
 * glowing fixtures and additive pools on the ground (two instanced draw calls, hidden in the day) and an
 * uplight in the landmarks' own emissive, scaled by ctx.night.level.
 */
import * as THREE from "three/webgpu";
import { skyLook } from "../render/sky";
import { color, exp, float, normalWorld, positionWorld, rangeFogFactor, smoothstep, uniform, uv, vertexColor, type ShaderNodeObject } from "three/tsl";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { DistrictId } from "../../api/city";
import { createArchitecture } from "../assets/landmarks";
import { facadeMaterial } from "../assets/facade";
import { districtLevel } from "../../pages/city/cityLevels";
import type { CityContext } from "../engine/context";
import { DISTRICT_FACING } from "../engine/camera";

/** Top of the land, as in the old city. */
export const GROUND = .2;
/** Labels float this far above the roof. */
const LABEL_LIFT = .7;
/** The old city's highlight: gold, hugging the island's edge; it pulses in brightness only. */
const RING_COLOR = "#e9bf69", RING_Y = .45;
/** Growth starts half a second after startGrowth() and takes 1.3 s; confetti bursts at 1.3 s and falls for 3.2 s. */
const GROW_DELAY = 500, GROW_TIME = 1300, CONFETTI_DELAY = 1300, CONFETTI_LIFE = 3.2, CONFETTI_COUNT = 160;
const CONFETTI_COLORS = ["#ffcf4d", "#ff6b9a", "#7b5cff", "#5bd6ff", "#6be38a"];
/** The share of a landmark's windows lit at night: public buildings, busier than the homes round them. */
const WINDOWS_LIT = .62;
type Level = CityContext["night"]["level"];

/** Floodlights in a landmark's frame, world units from its centre (+z is its front, the plot is ±5 × ±4.6): two flank the entrance, one lights each side. */
const FLOODLIGHTS: [number, number][] = [[-2.5, 5.55], [2.5, 5.55], [-5.85, -.9], [5.85, -.9]];
const FLOOD = "#ffc88a", FIXTURE_GLOW = 2.4, POOL_STRENGTH = .6;
/** The uplight on the walls: strongest at the plinth, half as strong WASH_HEIGHT × ln 2 higher up. */
const WASH = "#ffcf96", WASH_STRENGTH = .42, WASH_HEIGHT = 2.2;
/** The pedestal of systems/mascot.ts (radius 0.86, its dark band 0.37…0.6 high) on the plaza paving (0.31). */
const PEDESTAL_R = .88, PEDESTAL_Y = .48, PEDESTAL_LIGHTS = 16, PLAZA_Y = .31, PLAZA_LIGHTS = 24;

/** Islands reserved for districts the server does not have yet ("Скоро"): not selectable. */
export const isFutureDistrict = (id: string) => id.startsWith("future-");

export interface DistrictsOptions {
  /** Completed missions per district, as CityOptions.levels. */
  levels: Record<string, number>;
  /** Districts that levelled up since the last visit: they wait flat until startGrowth(). */
  grown?: string[];
}

export interface Districts {
  /** Invisible hit cylinders with `userData.district`, for the picker. */
  pickables: THREE.Object3D[];
  /** Label anchors above every island's building (future islands too). */
  anchors: Map<string, THREE.Vector3>;
  select(id: string): void;
  hover(id: string | null): void;
  /** Switches the landmarks' windows on or off, including buildings that are still growing. */
  setNight(night: boolean): void;
  /** Refreshes changed building stages; requested growth waits for startGrowth(). */
  setLevels(levels: Record<string, number>, grown?: string[]): void;
  /** Grows the `grown` districts in; returns the first one (for the camera to fly to) or null. */
  startGrowth(): string | null;
  dispose(): void;
}

/** Frees every geometry, material and texture under `root`; returns the materials it freed. */
export function disposeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of [mesh.material].flat()) {
      materials.add(material);
      for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value);
    }
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
  });
  textures.forEach(t => t.dispose()); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  return materials;
}

export function createDistricts(ctx: CityContext, { levels, grown = [] }: DistrictsOptions): Districts {
  const { spec } = ctx.world, scale = spec.districtScale;
  const root = new THREE.Group(); root.name = "city-districts"; ctx.scene.add(root);
  // Every landmark, growing or merged, and the construction sites share one facade material: its windows light
  // with `windows` (setNight), its walls take the floodlights' uplight (0 in the day). The window pattern is fixed
  // per building (assets/landmarks.ts shifts every wall's), so the material needs no seed from a copy.
  const windows = uniform(0);
  const shell = facadeMaterial(windows as unknown as Parameters<typeof facadeMaterial>[0], { seed: float(0), lit: WINDOWS_LIT, look: skyLook(ctx.scene) });
  shell.emissiveNode = (shell.emissiveNode as ShaderNodeObject<THREE.Node>).add(uplight(ctx.night.level));
  shell.name = "city-district-landmarks"; shell.userData.districtNight = windows;
  const architecture = createArchitecture(shell);
  const pickables: THREE.Object3D[] = [], anchors = new Map<string, THREE.Vector3>();
  const landmarks = new Map<string, THREE.Group>(), rings = new Map<string, THREE.Mesh>();
  const stages = new Map<string, number>(), hits = new Map<string, THREE.Mesh>();
  const pendingGrowth = new Set<string>();
  const initialGrowth = new Set(ctx.reducedMotion ? [] : grown);
  const growth: { id: string; group: THREE.Group; start: number }[] = [];
  const confetti: Confetti[] = [];
  const batches = createLandmarkBatches(root);
  let disposed = false;
  const ringGeometry = new THREE.TorusGeometry(spec.islet - .19, .11, 8, 96);
  const hitGeometry = new THREE.CylinderGeometry(1, 1, 1, 12), hitMaterial = new THREE.MeshBasicNodeMaterial();
  type District = CityContext["world"]["districts"][number];

  function buildLandmark(d: District, stage: number, waitForGrowth: boolean) {
    const { group, height } = architecture.landmark(d.id as DistrictId, stage, d.soon);
    group.position.set(d.x, GROUND, d.z); group.scale.setScalar(scale); group.rotation.y = DISTRICT_FACING;
    group.userData.district = d.id; root.add(group); landmarks.set(d.id, group); stages.set(d.id, stage);
    const top = height * scale, hit = hits.get(d.id)!;
    hit.scale.set(spec.islet, top, spec.islet); hit.position.set(d.x, GROUND + top / 2, d.z);
    // Labels and picking keep their existing objects; consumers may retain their references.
    anchors.get(d.id)!.set(d.x, GROUND + top + LABEL_LIFT, d.z);
    if (waitForGrowth) { group.scale.y = scale * .02; pendingGrowth.add(d.id); }
    else batches.add(d.id, group);
  }

  /** Unmerged geometry and signs belong to this district; the shared facade material belongs to the districts. */
  function releaseGrowingGroup(group: THREE.Group | undefined) {
    if (!group) return;
    const geometry = new Set<THREE.BufferGeometry>(), signs = new Set<THREE.Material>();
    group.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometry.add(mesh.geometry);
      for (const material of [mesh.material].flat()) if ((material as THREE.MeshStandardMaterial).map) signs.add(material);
    });
    geometry.forEach(value => value.dispose()); signs.forEach(disposeMaterial);
    group.removeFromParent(); group.clear();
  }

  const futures = ctx.world.districts.filter(d => isFutureDistrict(d.id));
  const site = futures.length ? constructionSite(architecture.site(), shell, futures.map(d => new THREE.Matrix4().compose(
    new THREE.Vector3(d.x, GROUND, d.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), DISTRICT_FACING), new THREE.Vector3(scale, scale, scale)))) : null;
  if (site) root.add(site.mesh);

  for (const d of ctx.world.districts) {
    if (isFutureDistrict(d.id)) { anchors.set(d.id, new THREE.Vector3(d.x, GROUND + site!.height * scale + LABEL_LIFT, d.z)); continue; }
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicNodeMaterial({ color: RING_COLOR, transparent: true, opacity: 0, depthWrite: false }));
    ring.rotation.x = Math.PI / 2; ring.position.set(d.x, RING_Y, d.z); ring.visible = false; root.add(ring); rings.set(d.id, ring);
    // Never drawn, but the raycaster does not look at `visible`.
    const hit = new THREE.Mesh(hitGeometry, hitMaterial);
    hit.visible = false; hit.userData.district = d.id; root.add(hit); pickables.push(hit); hits.set(d.id, hit);
    anchors.set(d.id, new THREE.Vector3());
    buildLandmark(d, districtLevel(levels[d.id] ?? 0, d.soon), initialGrowth.has(d.id));
  }

  batches.flush();
  const lights = nightLights(ctx, ctx.world.districts);

  let selected: string | null = null, hovered: string | null = null;
  const offFrame = ctx.onFrame((dt, now) => {
    lights.show();
    const pulse = ctx.reducedMotion ? .5 : (Math.sin(now / 380) + 1) / 2;
    rings.forEach((ring, id) => {
      const opacity = id === selected ? .55 + pulse * .4 : id === hovered ? .45 : 0;
      ring.visible = opacity > 0; (ring.material as THREE.MeshBasicNodeMaterial).opacity = opacity;
    });
    for (let i = growth.length - 1; i >= 0; i--) {
      const item = growth[i], k = THREE.MathUtils.clamp((now - item.start) / GROW_TIME, 0, 1);
      // Ease-out with a small overshoot, like a building popping into place.
      const e = k === 1 ? 1 : 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
      item.group.scale.y = scale * Math.max(.02, e);
      if (now >= item.start) ctx.requestShadowUpdate();
      // Grown, it joins the others' few draw calls.
      if (k === 1) { growth.splice(i, 1); batches.add(item.id, item.group); }
    }
    batches.flush();
    for (let i = confetti.length - 1; i >= 0; i--) if (!confetti[i].step(dt, now)) { confetti[i].dispose(); confetti.splice(i, 1); }
  });

  return {
    pickables, anchors,
    select(id) { selected = id; },
    hover(id) { hovered = id; },
    setNight(value) { windows.value = value ? 1 : 0; },
    setLevels(next, grown = []) {
      if (disposed) return;
      const animate = new Set(ctx.reducedMotion ? [] : grown);
      let changed = false;
      for (const d of ctx.world.districts) {
        if (isFutureDistrict(d.id)) continue;
        const stage = districtLevel(next[d.id] ?? 0, d.soon), previous = stages.get(d.id)!;
        if (stage === previous) continue;
        changed = true;
        pendingGrowth.delete(d.id);
        for (let i = growth.length - 1; i >= 0; i--) if (growth[i].id === d.id) growth.splice(i, 1);
        releaseGrowingGroup(landmarks.get(d.id)); batches.remove(d.id);
        buildLandmark(d, stage, animate.has(d.id) && stage > previous);
      }
      if (changed) { batches.flush(); ctx.requestShadowUpdate(); }
    },
    startGrowth() {
      if (disposed || !pendingGrowth.size) return null;
      const now = performance.now(), firstId = pendingGrowth.values().next().value!;
      for (const id of pendingGrowth) growth.push({ id, group: landmarks.get(id)!, start: now + GROW_DELAY });
      pendingGrowth.clear();
      const first = ctx.world.districts.find(d => d.id === firstId)!;
      confetti.push(createConfetti(root, first.x, first.z, now + CONFETTI_DELAY));
      return first.id;
    },
    dispose() {
      if (disposed) return;
      disposed = true; offFrame(); confetti.forEach(value => value.dispose()); confetti.length = 0; lights.dispose();
      landmarks.forEach(releaseGrowingGroup); batches.dispose(); pendingGrowth.clear(); growth.length = 0;
      root.removeFromParent();
      // Landmarks hold their own sign textures and merged geometries; the kit frees only what it cached.
      if (!disposeTree(root).has(shell)) shell.dispose();
      architecture.dispose();
    },
  };
}

/** Bakes a colour into a geometry as a vertex colour attribute (linear, like material colours). */
export function paintGeometry(geometry: THREE.BufferGeometry, color: THREE.Color) {
  const n = geometry.getAttribute("position").count, values = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { values[i * 3] = color.r; values[i * 3 + 1] = color.g; values[i * 3 + 2] = color.b; }
  geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
  return geometry;
}

/**
 * Bakes landmark groups into a few meshes under `parent` and drops the groups: their facade meshes merge into one
 * (they share one material), each sign keeps its own. All districts together take a few draw calls instead of a
 * dozen each.
 */
function createLandmarkBatches(parent: THREE.Object3D) {
  interface Bucket { material: THREE.Material; parts: Map<string, THREE.BufferGeometry[]>; meshes: THREE.Mesh[] }
  const buckets = new Map<string, Bucket>(), owned = new Map<string, Set<string>>(), dirty = new Set<string>();
  const local = new THREE.Matrix4();
  function releaseMeshes(bucket: Bucket) {
    for (const mesh of bucket.meshes) { mesh.removeFromParent(); mesh.geometry.dispose(); }
    bucket.meshes.length = 0;
  }
  function remove(id: string) {
    for (const key of owned.get(id) ?? []) {
      const bucket = buckets.get(key)!;
      bucket.parts.get(id)?.forEach(geometry => geometry.dispose()); bucket.parts.delete(id); dirty.add(key);
    }
    owned.delete(id);
  }
  return {
    remove,
    add(id: string, group: THREE.Group) {
      remove(id); parent.updateMatrixWorld(true);
      const inverse = parent.matrixWorld.clone().invert(), keys = new Set<string>();
      group.traverse(object => {
        const mesh = object as THREE.Mesh, material = mesh.material as THREE.Material;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const geometry = mesh.geometry.clone().applyMatrix4(local.multiplyMatrices(inverse, mesh.matrixWorld));
        mesh.geometry.dispose();
        const key = material.uuid;
        let bucket = buckets.get(key);
        if (!bucket) { bucket = { material, parts: new Map(), meshes: [] }; buckets.set(key, bucket); }
        if (!bucket.parts.has(id)) bucket.parts.set(id, []);
        bucket.parts.get(id)!.push(geometry);
        keys.add(key); dirty.add(key);
      });
      owned.set(id, keys); group.removeFromParent(); group.clear();
    },
    flush() {
      // No work on ordinary frames. Only changed buckets are rebuilt from cached district parts.
      for (const key of dirty) {
        const bucket = buckets.get(key)!; releaseMeshes(bucket);
        const parts = [...bucket.parts.values()].flat();
        if (!parts.length) {
          // A sign's material goes with its last geometry; the shared facade material stays with the districts.
          if ((bucket.material as THREE.MeshStandardMaterial).map) disposeMaterial(bucket.material);
          buckets.delete(key); continue;
        }
        const merged = parts.length > 1 ? mergeGeometries(parts) : null;
        // CPU parts stay owned by districts; rendered geometry has its own disposal lifetime.
        for (const geometry of merged ? [merged] : parts.map(part => part.clone())) {
          const mesh = new THREE.Mesh(geometry, bucket.material); mesh.castShadow = mesh.receiveShadow = true;
          mesh.name = "city-landmark-batch"; mesh.userData.districts = [...bucket.parts.keys()];
          parent.add(mesh); bucket.meshes.push(mesh);
        }
      }
      dirty.clear();
    },
    dispose() {
      for (const bucket of buckets.values()) {
        releaseMeshes(bucket); bucket.parts.forEach(parts => parts.forEach(geometry => geometry.dispose()));
        if ((bucket.material as THREE.MeshStandardMaterial).map) disposeMaterial(bucket.material);
      }
      buckets.clear(); owned.clear(); dirty.clear();
    },
  };
}

function disposeMaterial(material: THREE.Material) {
  const textures = new Set<THREE.Texture>();
  for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value);
  textures.forEach(texture => texture.dispose()); material.dispose();
}

/**
 * Floodlight on the walls, as emissive: the surface's own colour, warm, on walls only (not roofs), fading
 * with height above the island. Uniform around the building: light bounced off the pools and the plinth.
 */
function uplight(level: Level) {
  const height = positionWorld.y.sub(GROUND).max(0), walls = float(1).sub(normalWorld.y.abs());
  return vertexColor().xyz.mul(color(WASH)).mul(exp(height.div(-WASH_HEIGHT))).mul(walls).mul(level).mul(WASH_STRENGTH);
}

/**
 * Glowing fixtures (floodlights, the pedestal's and the plaza's small lights) and the warm pools they cast,
 * as two additive InstancedMeshes; like the street lamps' pools they take no fog colour but fade with it.
 */
function nightLights(ctx: CityContext, islands: readonly { x: number; z: number }[]) {
  const level = ctx.night.level, fog = ctx.scene.fog instanceof THREE.Fog ? ctx.scene.fog : null;
  const clear = fog ? rangeFogFactor(float(fog.near), float(fog.far)).oneMinus() : float(1);
  const glowMaterial = () => new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const fixtureMaterial = glowMaterial();
  fixtureMaterial.colorNode = color(FLOOD).mul(FIXTURE_GLOW);
  fixtureMaterial.opacityNode = level.mul(clear);
  const poolMaterial = glowMaterial();
  const falloff = smoothstep(0, 1, uv().sub(.5).length().mul(2).oneMinus()) as ShaderNodeObject<THREE.Node>;
  poolMaterial.colorNode = color(FLOOD);
  poolMaterial.opacityNode = falloff.mul(falloff).mul(level).mul(clear).mul(POOL_STRENGTH);
  poolMaterial.polygonOffset = true; poolMaterial.polygonOffsetFactor = -2; poolMaterial.polygonOffsetUnits = -2;

  const fixtures: THREE.Matrix4[] = [], pools: [THREE.Matrix4, number][] = [];
  const up = new THREE.Vector3(0, 1, 0), turn = new THREE.Quaternion(), spot = new THREE.Vector3();
  const at = (x: number, y: number, z: number, sx: number, sy: number, sz: number, angle = 0) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), turn.setFromAxisAngle(up, angle), new THREE.Vector3(sx, sy, sz));
  for (const island of islands) for (const [lx, lz] of FLOODLIGHTS) {
    spot.set(lx, 0, lz).applyAxisAngle(up, DISTRICT_FACING);
    fixtures.push(at(island.x + spot.x, GROUND + .08, island.z + spot.z, .2, .12, .2));
    // A pool along the wall it lights, wider than deep; the plinth hides the part that reaches under it.
    const front = Math.abs(lz) > Math.abs(lx);
    pools.push([at(island.x + spot.x * .96, GROUND + .015, island.z + spot.z * .96, front ? 2.6 : 1.7, 1, front ? 1.7 : 2.6, DISTRICT_FACING), 1]);
  }
  for (let i = 0; i < PEDESTAL_LIGHTS; i++) {
    const a = i / PEDESTAL_LIGHTS * Math.PI * 2;
    fixtures.push(at(Math.cos(a) * PEDESTAL_R, PEDESTAL_Y, Math.sin(a) * PEDESTAL_R, .05, .05, .05));
  }
  // Lights set in the paving round the plaza's edge, each with a small pool, so the ring reads from afar.
  const plaza = ctx.world.spec.plaza - .3;
  for (let i = 0; i < PLAZA_LIGHTS; i++) {
    const a = (i + .5) / PLAZA_LIGHTS * Math.PI * 2, x = Math.cos(a) * plaza, z = Math.sin(a) * plaza;
    fixtures.push(at(x, PLAZA_Y, z, .09, .025, .09));
    pools.push([at(x, PLAZA_Y + .01, z, .75, 1, .75), .7]);
  }
  // The pedestal's glow on the paving around it, dimmer than a floodlight.
  pools.push([at(0, PLAZA_Y + .01, 0, 2.6, 1, 2.6), .65]);

  const fixtureMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), fixtureMaterial, fixtures.length);
  fixtures.forEach((m, i) => fixtureMesh.setMatrixAt(i, m));
  const poolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), poolMaterial, pools.length);
  const shade = new THREE.Color();
  pools.forEach(([m, k], i) => { poolMesh.setMatrixAt(i, m); poolMesh.setColorAt(i, shade.setScalar(k)); });
  const meshes = [fixtureMesh, poolMesh];
  fixtureMesh.name = "city-district-floodlights"; poolMesh.name = "city-district-light-pools";
  for (const mesh of meshes) {
    mesh.matrixAutoUpdate = false; mesh.castShadow = mesh.receiveShadow = false;
    mesh.computeBoundingSphere(); ctx.scene.add(mesh);
  }
  // Nothing is drawn in the day: one check a frame, no allocation.
  const show = () => { fixtureMesh.visible = poolMesh.visible = (level.value as number) > 0; };
  show();
  return {
    show,
    dispose() { for (const mesh of meshes) { ctx.scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose(); } },
  };
}

/**
 * The "Скоро" construction site (assets/landmarks.ts site()) on every reserved island: one InstancedMesh in the
 * landmarks' facade material.
 */
function constructionSite(site: { geometry: THREE.BufferGeometry; height: number }, material: THREE.Material, matrices: THREE.Matrix4[]) {
  const mesh = new THREE.InstancedMesh(site.geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = "city-construction-sites";
  return { mesh, height: site.height };
}

interface Confetti { step(dt: number, now: number): boolean; dispose(): void }

/** A burst of paper chips from 4 units above the island: they fly out, tumble, fall and fade in 3.2 s. */
function createConfetti(parent: THREE.Object3D, x: number, z: number, start: number): Confetti {
  const geometry = new THREE.PlaneGeometry(.42, .26);
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
  material.toneMapped = false;
  const mesh = new THREE.InstancedMesh(geometry, material, CONFETTI_COUNT);
  mesh.frustumCulled = false; mesh.visible = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); parent.add(mesh);
  const position = new Float32Array(CONFETTI_COUNT * 3), velocity = new Float32Array(CONFETTI_COUNT * 3), spin = new Float32Array(CONFETTI_COUNT * 2);
  const palette = CONFETTI_COLORS.map(c => new THREE.Color(c));
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const a = Math.random() * Math.PI * 2, speed = 4 + Math.random() * 7;
    position.set([x, 4, z], i * 3); velocity.set([Math.cos(a) * speed, 9 + Math.random() * 9, Math.sin(a) * speed], i * 3);
    spin.set([(Math.random() - .5) * 14, (Math.random() - .5) * 14], i * 2);
    mesh.setColorAt(i, palette[i % palette.length]);
  }
  const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  return {
    step(dt, now) {
      if (now < start) return true;
      const age = (now - start) / 1000;
      if (age > CONFETTI_LIFE) return false;
      mesh.visible = true; material.opacity = Math.max(0, 1 - age / CONFETTI_LIFE);
      for (let i = 0; i < CONFETTI_COUNT; i++) {
        velocity[i * 3 + 1] -= 14 * dt;
        for (let k = 0; k < 3; k++) position[i * 3 + k] += velocity[i * 3 + k] * dt;
        position[i * 3 + 1] = Math.max(.3, position[i * 3 + 1]);
        p.fromArray(position, i * 3); q.setFromEuler(e.set(spin[i * 2] * age, spin[i * 2 + 1] * age, 0));
        mesh.setMatrixAt(i, matrix.compose(p, q, one));
      }
      mesh.instanceMatrix.needsUpdate = true;
      return true;
    },
    dispose() { mesh.removeFromParent(); mesh.dispose(); geometry.dispose(); material.dispose(); },
  };
}
