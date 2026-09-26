/**
 * Instance pools: every static copy of the world (buildings, trees, lamps, parked cars) is drawn through
 * one THREE.InstancedMesh per model part and detail level, whatever the size of the city (TZ §6.2).
 *
 * BatchedMesh would be the TZ's tool, but in three r180 its WebGPU backend issues one draw call per
 * instance (5130 calls for 1500 copies), while WebGL2 uses multi-draw. So culling and LOD run on the CPU
 * (render/cells.ts): on camera moves, at most every 100 ms for small ones, cells of the grid are tested
 * against the camera frustum pushed out by a margin, every copy of a visible cell picks a level by
 * distance with hysteresis, and each pool gets the matrices of its copies and a count. Draw calls stay at
 * the number of pools in view; copies beyond the last LOD distance are hidden (impostors come in stage 3).
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import type { Placement } from "../world/types";
import type { ModelPart } from "../assets/loader";
import type { Catalogue, CatalogueModel } from "../assets/catalogue";
import { buildGrid, createCopies, createSelector, select, shouldUpdate, type Pose, type View } from "./cells";

/**
 * How far the culling frustum is pushed out: the shadow of the tallest block (about 15 units at a 35° sun)
 * and a 2° turn at the LOD2 distance both stay inside it, so casters just out of view still cast.
 */
export const CULL_MARGIN = 24;
/**
 * Every pool has room for at least 1001 copies. Three keeps up to 1000 instance matrices in a uniform buffer
 * that is uploaded every frame (and WebGL2 only promises 16 KB uniform blocks, 256 matrices); from 1001 they
 * live in an instanced vertex buffer uploaded only when the pool changes, and all pools then behave alike:
 *
 * three r180 (both backends) uploads that buffer in the render after the one where the change is noticed:
 * a render object compares versions before its InstanceNode syncs them. So a change is written one frame
 * and its counts are applied the next, when the new matrices reach the GPU: every frame shows matching
 * counts and matrices. Empty pools stay visible with count 0 (no draw is issued) so they keep in sync.
 * The static shadow map is asked for twice: in the frame of the change (the old set, which also syncs the
 * shadow pass's own buffers) and in the next one (the new set). One request would draw stale instances.
 */
const ATTRIBUTE_MIN = 1001;

export interface PoolStats { copies: number; drawn: number; drawCalls: number; triangles: number }
export interface InstancePools {
  /** Culls and picks levels now; camera moves and quality changes do it by themselves. */
  update(): void;
  /** What the pools draw in the main view: copies in view, draw calls, triangles (shadow pass not counted). */
  stats(): PoolStats;
  /** Removes the meshes from the scene. The catalogue keeps its geometries and materials: dispose it after. */
  dispose(): void;
}

/** One set of parts drawn together, shared by every model and level that uses the same parts. */
interface Pool { parts: ModelPart[]; meshes: THREE.InstancedMesh[]; matrices: THREE.InstancedBufferAttribute; colors: THREE.InstancedBufferAttribute[]; capacity: number; count: number; triangles: number[] }

export function createInstancePools(ctx: CityContext, catalogue: Catalogue, placements: readonly Placement[]): InstancePools {
  // Resolve every placement to a model and a copy transform.
  const resolved: { model: CatalogueModel; matrix: THREE.Matrix4 }[] = [];
  for (const placement of placements) {
    const matrix = new THREE.Matrix4(), model = catalogue.resolve(placement, matrix);
    if (model) resolved.push({ model, matrix });
  }
  const n = resolved.length, models: CatalogueModel[] = [], modelIndex = new Map<CatalogueModel, number>();
  const modelOf = new Uint16Array(n), matrices = new Float32Array(n * 16), tints = new Float32Array(n * 3).fill(1), copies = createCopies(n);
  const perModel: number[] = [], center = new THREE.Vector3(), size = new THREE.Vector3();
  resolved.forEach(({ model, matrix }, i) => {
    let m = modelIndex.get(model);
    if (m === undefined) { m = models.length; models.push(model); modelIndex.set(model, m); perModel.push(0); }
    const k = perModel[m]++;
    modelOf[i] = m; matrix.toArray(matrices, i * 16);
    if (model.tints?.length) model.tints[(k * (model.tintStep ?? 1)) % model.tints.length].toArray(tints, i * 3);
    // Bounding sphere of the copy, for the cell boxes and the LOD distance.
    model.bounds.getCenter(center).applyMatrix4(matrix); model.bounds.getSize(size);
    copies.x[i] = center.x; copies.y[i] = center.y; copies.z[i] = center.z;
    copies.radius[i] = size.length() / 2 * matrix.getMaxScaleOnAxis();
  });
  const grid = buildGrid(copies), selector = createSelector(n);

  // One pool per distinct parts list; its capacity is the copies of every model that can land in it.
  const pools = new Map<ModelPart[], Pool>(), levelPool = models.map(model => model.lods.map(level => level ? pool(level.parts) : null));
  function pool(parts: ModelPart[]): Pool {
    let p = pools.get(parts);
    if (!p) pools.set(parts, p = { parts, meshes: [], matrices: null!, colors: [], capacity: 0, count: 0, triangles: parts.map(part => triangles(part.geometry)) });
    return p;
  }
  models.forEach((_, m) => { for (const p of new Set(levelPool[m].filter(Boolean))) p!.capacity += perModel[m]; });
  const colored = new Set<Pool>();
  models.forEach((model, m) => model.lods.forEach((level, l) => { if (level && (model.tints?.length || level.colors)) colored.add(levelPool[m][l]!); }));

  const group = new THREE.Group(); group.name = "city-instances"; group.matrixAutoUpdate = false;
  for (const p of pools.values()) {
    const capacity = Math.max(p.capacity, ATTRIBUTE_MIN);
    p.matrices = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
    p.parts.forEach(part => {
      // Built empty: the pool's shared matrices replace the mesh's own.
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, 0);
      mesh.instanceMatrix = p.matrices;
      if (colored.has(p)) { mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3); p.colors.push(mesh.instanceColor); }
      mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      mesh.castShadow = part.castShadow; mesh.receiveShadow = true; mesh.name = "city-pool";
      p.meshes.push(mesh); group.add(mesh);
    });
  }
  ctx.scene.add(group);

  const camera = ctx.camera, frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), planes = new Float32Array(24);
  // LOD2 proxies are 12-triangle boxes: they stay until the fog swallows them (sky.ts: fog ends at 2.2 × radius),
  // so the map never shows empty ground; the quality's last distance only limits LOD1.
  const fogFar = ctx.world.radius * 2.2;
  const distancesFor = (d: readonly number[]) => [d[0], d[1], Math.max(d[2], fogFar)] as [number, number, number];
  const view: View = { x: 0, y: 0, z: 0, planes, margin: CULL_MARGIN, distances: distancesFor(ctx.quality.lodDistances) };
  const white = new THREE.Color(1, 1, 1);

  /** Writes the selected copies into the pools; their counts wait for the next frame (see ATTRIBUTE_MIN). */
  function write() {
    for (const p of pools.values()) p.count = 0;
    const { copies: list, levels, count } = selector.current;
    for (let k = 0; k < count; k++) {
      const c = list[k], m = modelOf[c], level = levels[k], p = levelPool[m][level];
      if (!p) continue;
      const slot = p.count++, lod = models[m].lods[level]!, out = p.matrices.array as Float32Array;
      if (lod.matrix) multiply(matrices, c * 16, lod.matrix.elements, out, slot * 16);
      else for (let e = 0; e < 16; e++) out[slot * 16 + e] = matrices[c * 16 + e];
      for (let part = 0; part < p.colors.length; part++) {
        const color = lod.colors?.[part] ?? white, target = p.colors[part].array as Float32Array;
        target[slot * 3] = tints[c * 3] * color.r; target[slot * 3 + 1] = tints[c * 3 + 1] * color.g; target[slot * 3 + 2] = tints[c * 3 + 2] * color.b;
      }
    }
    // Three copies these into buffers of its own and uploads them whole: update ranges would not reach them.
    for (const p of pools.values()) for (const attribute of [p.matrices, ...p.colors]) attribute.needsUpdate = true;
  }
  function applyCounts() { for (const p of pools.values()) for (const mesh of p.meshes) mesh.count = p.count; }

  function update() {
    camera.updateMatrixWorld();
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection, camera.coordinateSystem);
    frustum.planes.forEach((plane, k) => { planes[k * 4] = plane.normal.x; planes[k * 4 + 1] = plane.normal.y; planes[k * 4 + 2] = plane.normal.z; planes[k * 4 + 3] = plane.constant; });
    view.x = camera.position.x; view.y = camera.position.y; view.z = camera.position.z; view.distances = distancesFor(ctx.quality.lodDistances);
    if (!select(grid, copies, selector, view)) return;
    write();
    counting = true;
    ctx.requestShadowUpdate();
  }

  // Camera moves mark the pools dirty; the next frames update them, throttled.
  let dirty = true, last: Pose | null = null, spare: Pose = pose(0), counting = false;
  function pose(time: number, into?: Pose): Pose {
    const q = camera.quaternion, e = camera.projectionMatrix.elements, p = into ?? {} as Pose;
    p.x = camera.position.x; p.y = camera.position.y; p.z = camera.position.z; p.qx = q.x; p.qy = q.y; p.qz = q.z; p.qw = q.w;
    p.projection = e[0] + e[5] * 3 + e[8] * 7 + e[9] * 11; p.time = time;
    return p;
  }
  const offMove = ctx.onCameraMove(() => { dirty = true; });
  const offFrame = ctx.onFrame((_dt, now) => {
    // The frame after a change: its matrices reach the GPU now, with its counts; no new change this frame.
    if (counting) { counting = false; applyCounts(); ctx.requestShadowUpdate(); return; }
    if (!dirty) return;
    const next = pose(now, spare);
    if (!shouldUpdate(last, next)) return;
    spare = last ?? pose(0); last = next; dirty = false;
    update();
  });
  let distances = ctx.quality.lodDistances.join();
  const offQuality = ctx.onQuality(q => { if (q.lodDistances.join() !== distances) { distances = q.lodDistances.join(); update(); } });
  update();

  return {
    update,
    stats() {
      let drawCalls = 0, tris = 0;
      for (const p of pools.values()) { const count = p.meshes[0]?.count ?? 0; if (count) { drawCalls += p.meshes.length; p.triangles.forEach(t => { tris += t * count; }); } }
      return { copies: n, drawn: selector.current.count, drawCalls, triangles: tris };
    },
    dispose() {
      offMove(); offFrame(); offQuality();
      ctx.scene.remove(group);
      for (const p of pools.values()) for (const mesh of p.meshes) mesh.dispose();
      pools.clear();
    },
  };
}

function triangles(geometry: THREE.BufferGeometry) {
  return (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
}

/** out[o…o+15] = a[i…i+15] × b, column-major like three's Matrix4.elements. */
function multiply(a: Float32Array, i: number, b: ArrayLike<number>, out: Float32Array, o: number) {
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4], b1 = b[col * 4 + 1], b2 = b[col * 4 + 2], b3 = b[col * 4 + 3];
    for (let row = 0; row < 4; row++) out[o + col * 4 + row] = a[i + row] * b0 + a[i + 4 + row] * b1 + a[i + 8 + row] * b2 + a[i + 12 + row] * b3;
  }
}
