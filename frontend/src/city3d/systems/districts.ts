/**
 * District landmarks (TZ §5.5), stage 1: the old city's procedural buildings (pages/city/cityArchitecture.ts)
 * stand on their islands until the Blender models of stage 3 replace them. Five stages by completed
 * missions; the reserved "future-*" islands share one instanced construction site. A ring inside the island
 * lights up on hover and pulses while selected; invisible cylinders take the picking rays; a district that
 * levelled up grows in under a burst of confetti.
 */
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { DistrictId } from "../../api/city";
import { createArchitecture } from "../../pages/city/cityArchitecture";
import { districtLevel } from "../../pages/city/cityLevels";
import type { CityContext } from "../engine/context";

/** Top of the land, as in the old city. */
export const GROUND = .2;
/** Labels float this far above the roof. */
const LABEL_LIFT = .7;
/** The old city's highlight: gold, hugging the island's edge; it pulses in brightness only. */
const RING_COLOR = "#e9bf69", RING_Y = .45;
/** Growth starts half a second after startGrowth() and takes 1.3 s; confetti bursts at 1.3 s and falls for 3.2 s. */
const GROW_DELAY = 500, GROW_TIME = 1300, CONFETTI_DELAY = 1300, CONFETTI_LIFE = 3.2, CONFETTI_COUNT = 160;
const CONFETTI_COLORS = ["#ffcf4d", "#ff6b9a", "#7b5cff", "#5bd6ff", "#6be38a"];

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
  /** Grows the `grown` districts in; returns the first one (for the camera to fly to) or null. */
  startGrowth(): string | null;
  dispose(): void;
}

/** Frees every geometry, material and texture under `root`. */
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
}

export function createDistricts(ctx: CityContext, { levels, grown = [] }: DistrictsOptions): Districts {
  const { spec } = ctx.world, scale = spec.districtScale;
  const root = new THREE.Group(); root.name = "city-districts"; ctx.scene.add(root);
  const architecture = createArchitecture();
  const pickables: THREE.Object3D[] = [], anchors = new Map<string, THREE.Vector3>();
  const landmarks = new Map<string, THREE.Group>(), rings = new Map<string, THREE.Mesh>();
  const ringGeometry = new THREE.TorusGeometry(spec.islet - .19, .11, 8, 96);
  const hitGeometry = new THREE.CylinderGeometry(1, 1, 1, 12), hitMaterial = new THREE.MeshBasicNodeMaterial();
  const facing = (x: number, z: number) => Math.atan2(-x, -z);

  const futures = ctx.world.districts.filter(d => isFutureDistrict(d.id));
  const site = futures.length ? constructionSite(futures.map(d => new THREE.Matrix4().compose(
    new THREE.Vector3(d.x, GROUND, d.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing(d.x, d.z)), new THREE.Vector3(scale, scale, scale)))) : null;
  if (site) root.add(site.mesh);

  for (const d of ctx.world.districts) {
    if (isFutureDistrict(d.id)) { anchors.set(d.id, new THREE.Vector3(d.x, GROUND + site!.height * scale + LABEL_LIFT, d.z)); continue; }
    const { group, height } = architecture.landmark(d.id as DistrictId, districtLevel(levels[d.id] ?? 0, d.soon), d.soon);
    // Facing the plaza, where the district's entrance and the camera's "look at it" view are.
    group.position.set(d.x, GROUND, d.z); group.scale.setScalar(scale); group.rotation.y = facing(d.x, d.z);
    group.userData.district = d.id; root.add(group); landmarks.set(d.id, group);
    const top = height * scale;
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicNodeMaterial({ color: RING_COLOR, transparent: true, opacity: 0, depthWrite: false }));
    ring.rotation.x = Math.PI / 2; ring.position.set(d.x, RING_Y, d.z); ring.visible = false; root.add(ring); rings.set(d.id, ring);
    // Never drawn, but the raycaster does not look at `visible`.
    const hit = new THREE.Mesh(hitGeometry, hitMaterial);
    hit.scale.set(spec.islet, top, spec.islet); hit.position.set(d.x, GROUND + top / 2, d.z); hit.visible = false;
    hit.userData.district = d.id; root.add(hit); pickables.push(hit);
    anchors.set(d.id, new THREE.Vector3(d.x, GROUND + top + LABEL_LIFT, d.z));
  }

  // Grown districts wait flat, so they do not pop down when the growth starts.
  const growing = ctx.reducedMotion ? [] : grown.filter(id => landmarks.has(id));
  for (const id of growing) landmarks.get(id)!.scale.y = scale * .02;
  mergeLandmarks([...landmarks].filter(([id]) => !growing.includes(id)).map(([, group]) => group), root);
  const growth: { group: THREE.Group; start: number }[] = [];
  let confetti: Confetti | null = null, started = false;

  let selected: string | null = null, hovered: string | null = null;
  const offFrame = ctx.onFrame((dt, now) => {
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
      if (k === 1) { growth.splice(i, 1); mergeLandmarks([item.group], root); }
    }
    if (confetti && !confetti.step(dt, now)) { confetti.dispose(); confetti = null; }
  });

  return {
    pickables, anchors,
    select(id) { selected = id; },
    hover(id) { hovered = id; },
    startGrowth() {
      if (started || !growing.length) return null;
      started = true;
      const now = performance.now();
      for (const id of growing) growth.push({ group: landmarks.get(id)!, start: now + GROW_DELAY });
      const first = ctx.world.districts.find(d => d.id === growing[0])!;
      confetti = createConfetti(root, first.x, first.z, now + CONFETTI_DELAY);
      return first.id;
    },
    dispose() {
      offFrame(); confetti?.dispose(); confetti = null;
      root.removeFromParent();
      // Landmarks hold their own sign textures and merged geometries; the kit frees only what it cached.
      disposeTree(root); architecture.dispose();
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
 * Bakes landmark groups into a few meshes under `parent` and drops the groups: kit colours become vertex
 * colours, so parts differ only by finish (matte, glass, metal) or by a painted sign. All districts
 * together take about ten draw calls instead of a dozen each.
 */
function mergeLandmarks(groups: THREE.Object3D[], parent: THREE.Object3D) {
  const buckets = new Map<string, { material: THREE.Material; parts: THREE.BufferGeometry[] }>(), local = new THREE.Matrix4();
  parent.updateMatrixWorld(true);
  const inverse = parent.matrixWorld.clone().invert();
  for (const group of groups) {
    group.traverse(o => {
      const mesh = o as THREE.Mesh, source = mesh.material as THREE.MeshStandardMaterial;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const geometry = mesh.geometry.clone().applyMatrix4(local.multiplyMatrices(inverse, mesh.matrixWorld));
      mesh.geometry.dispose();
      const key = source.map ? source.uuid : `${source.metalness}:${source.roughness}`;
      if (!buckets.has(key)) buckets.set(key, { material: source.map ? source : new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: source.metalness, roughness: source.roughness }), parts: [] });
      buckets.get(key)!.parts.push(source.map ? geometry : paintGeometry(geometry, source.color));
    });
    group.removeFromParent();
  }
  buckets.forEach(({ material, parts }) => {
    const merged = parts.length > 1 ? mergeGeometries(parts) : null;
    // Parts whose attributes differ stay apart.
    for (const geometry of merged ? [merged] : parts) {
      const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
    }
    if (merged) parts.forEach(g => g.dispose());
  });
}

/**
 * The "Скоро" construction site on the landmarks' 5.7 × 5.3 plot: a plinth, the first floor going up in
 * scaffolding, a tower crane and a barrier. Vertex colours make it one InstancedMesh for every reserved island.
 */
function constructionSite(matrices: THREE.Matrix4[]) {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, color: string, x: number, y: number, z: number) => { parts.push(paintGeometry(new THREE.BoxGeometry(w, h, d).translate(x, y, z), new THREE.Color(color))); };
  const STONE = "#e8ddc5", CONCRETE = "#cfc7b8", STEEL = "#8a8f96", CRANE = "#e0a936", INK = "#253841", WOOD = "#926b45";
  box(5.7, .23, 5.3, "#9d9c91", 0, .02, 0); box(5.55, .15, 5.15, STONE, 0, .2, 0);
  box(3, 1.2, 2.2, CONCRETE, 0, .88, -.3); box(3.2, .12, 2.4, "#b9b1a2", 0, 1.54, -.3); box(1.3, .7, 1, CONCRETE, -.7, 1.95, -.6);
  for (const x of [-1.7, -.57, .57, 1.7]) for (const z of [-1.6, 1]) box(.06, 2.5, .06, STEEL, x, 1.52, z);
  for (const y of [.95, 1.65, 2.45]) {
    for (const z of [-1.6, 1]) box(3.46, .05, .05, STEEL, 0, y, z);
    for (const x of [-1.7, 1.7]) box(.05, .05, 2.66, STEEL, x, y, -.3);
  }
  for (const y of [.98, 1.68]) box(3.4, .04, .42, WOOD, 0, y, 1.2);
  // Tower crane behind the building; its jib reaches over it towards the plaza side.
  const cx = 1.95, cz = -1.95;
  box(.6, .14, .6, INK, cx, .34, cz); box(.22, 4.4, .22, CRANE, cx, 2.6, cz); box(.34, .3, .34, INK, cx, 4.62, cz + .2);
  box(3.9, .14, .18, CRANE, cx - 1.75, 4.88, cz); box(1.2, .14, .18, CRANE, cx + .75, 4.88, cz); box(.4, .34, .3, INK, cx + 1.15, 4.66, cz);
  box(.025, 1.5, .025, INK, cx - 2.6, 4.07, cz); box(.16, .12, .16, INK, cx - 2.6, 3.26, cz); box(1, .1, .14, STEEL, cx - 2.6, 3.12, cz);
  // A striped barrier along the front: the district is not open yet.
  for (const x of [-1.2, 1.2]) box(.07, .5, .07, INK, x, .52, 2.35);
  for (let i = 0; i < 8; i++) box(.3, .08, .04, i % 2 ? INK : CRANE, -1.05 + i * .3, .66, 2.35);

  const geometry = mergeGeometries(parts)!; parts.forEach(g => g.dispose());
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .7 }), matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = "city-construction-sites";
  return { mesh, height: 4.95 };
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
