/**
 * Instance pools: every static copy of the world (buildings, trees, lamps, parked cars) is drawn through
 * one copy mesh (render/copies.ts) per model part and detail level, whatever the size of the city (TZ §6.2).
 * Copy meshes of one material share a shader build, so the city's hundred-odd pools build a few shaders.
 *
 * BatchedMesh would be the TZ's tool, but in three r180 its WebGPU backend issues one draw call per
 * instance (5130 calls for 1500 copies), while WebGL2 uses multi-draw. So culling and LOD run on the CPU
 * (render/cells.ts): on camera moves, at most every 100 ms for small ones, cells of the grid are tested
 * against the camera frustum pushed out by a margin, every copy of a visible cell picks a level by
 * distance with hysteresis, and each pool gets the matrices of its copies and a count. Draw calls stay at
 * the number of pools in view; copies beyond the last LOD distance are hidden (impostors come in stage 3).
 * The matrices live in an instanced vertex buffer uploaded only when the pool changes, in the same render
 * as its new count. Empty pools stay in the scene with count 0: no draw is issued.
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import type { Placement } from "../world/types";
import type { ModelPart } from "../assets/loader";
import type { Catalogue, CatalogueModel } from "../assets/catalogue";
import { FOG_END } from "../world/relief";
import { buildGrid, createCopies, createSelector, select, shouldUpdate, type Pose, type View } from "./cells";
import { COPY_STRIDE, copyMatrices, copyMesh, copyTints } from "./copies";

/**
 * How far the culling frustum is pushed out: the shadow of the tallest block (about 15 units at a 35° sun)
 * and a 2° turn at the LOD2 distance both stay inside it, so casters just out of view still cast.
 */
export const CULL_MARGIN = 24;

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
type CopyMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
interface Pool { parts: ModelPart[]; meshes: CopyMesh[]; matrices: THREE.InstancedInterleavedBuffer; colors: THREE.InstancedBufferAttribute[]; capacity: number; count: number; triangles: number[] }

export function createInstancePools(ctx: CityContext, catalogue: Catalogue, placements: readonly Placement[]): InstancePools {
  // Resolve every placement to a model and a copy transform.
  const resolved: { model: CatalogueModel; matrix: THREE.Matrix4; tint?: number }[] = [];
  for (const placement of placements) {
    const matrix = new THREE.Matrix4(), model = catalogue.resolve(placement, matrix);
    if (model) resolved.push({ model, matrix, tint: placement.tint });
  }
  const n = resolved.length, models: CatalogueModel[] = [], modelIndex = new Map<CatalogueModel, number>();
  const modelOf = new Uint16Array(n), matrices = new Float32Array(n * 16), tints = new Float32Array(n * 3).fill(1), copies = createCopies(n);
  const perModel: number[] = [], center = new THREE.Vector3(), size = new THREE.Vector3();
  resolved.forEach(({ model, matrix, tint }, i) => {
    let m = modelIndex.get(model);
    if (m === undefined) { m = models.length; models.push(model); modelIndex.set(model, m); perModel.push(0); }
    const k = perModel[m]++;
    modelOf[i] = m; matrix.toArray(matrices, i * 16);
    // A placement may pick its shade (every section of a complex alike); otherwise copies take turns.
    const shades = model.tints?.length ?? 0, shade = tint ?? k * (model.tintStep ?? 1);
    if (shades) model.tints![((shade % shades) + shades) % shades].toArray(tints, i * 3);
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

  const group = new THREE.Group(); group.name = "city-instances"; group.matrixAutoUpdate = false;
  for (const p of pools.values()) {
    // The parts of a pool share its matrices; every part has tints (white when the model has none), so pools of
    // one material always share their shaders.
    p.matrices = copyMatrices(p.capacity);
    p.parts.forEach(part => {
      const shades = copyTints(p.capacity), mesh = copyMesh(part.geometry, part.material, p.matrices, shades);
      mesh.castShadow = part.castShadow; mesh.receiveShadow = true; mesh.name = "city-pool";
      p.colors.push(shades); p.meshes.push(mesh); group.add(mesh);
    });
  }
  ctx.scene.add(group);

  const camera = ctx.camera, frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), planes = new Float32Array(24);
  // LOD2 proxies are 12-triangle boxes: they stay out to the last placements (FOG_END radii, past the hills),
  // so the map never shows empty ground; the quality's last distance only limits LOD1.
  const fogFar = ctx.world.radius * FOG_END;
  const distancesFor = (d: readonly number[]) => [d[0], d[1], Math.max(d[2], fogFar)] as [number, number, number];
  const view: View = { x: 0, y: 0, z: 0, planes, margin: CULL_MARGIN, distances: distancesFor(ctx.quality.lodDistances) };
  const white = new THREE.Color(1, 1, 1);

  /** Writes the selected copies into the pools with their counts: the next render uploads and draws them. */
  function write() {
    for (const p of pools.values()) p.count = 0;
    const { copies: list, levels, count } = selector.current;
    for (let k = 0; k < count; k++) {
      const c = list[k], m = modelOf[c], level = levels[k], p = levelPool[m][level];
      if (!p) continue;
      const slot = p.count++, lod = models[m].lods[level]!, out = p.matrices.array as Float32Array;
      if (lod.matrix) multiply(matrices, c * 16, lod.matrix.elements, out, slot * COPY_STRIDE);
      else for (let e = 0; e < 16; e++) out[slot * COPY_STRIDE + e] = matrices[c * 16 + e];
      for (let part = 0; part < p.colors.length; part++) {
        const color = lod.colors?.[part] ?? white, target = p.colors[part].array as Float32Array;
        target[slot * 3] = tints[c * 3] * color.r; target[slot * 3 + 1] = tints[c * 3 + 1] * color.g; target[slot * 3 + 2] = tints[c * 3 + 2] * color.b;
      }
    }
    for (const p of pools.values()) {
      p.matrices.needsUpdate = true;
      for (const colors of p.colors) colors.needsUpdate = true;
      for (const mesh of p.meshes) mesh.geometry.instanceCount = p.count;
    }
  }

  function update() {
    camera.updateMatrixWorld();
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection, camera.coordinateSystem);
    frustum.planes.forEach((plane, k) => { planes[k * 4] = plane.normal.x; planes[k * 4 + 1] = plane.normal.y; planes[k * 4 + 2] = plane.normal.z; planes[k * 4 + 3] = plane.constant; });
    view.x = camera.position.x; view.y = camera.position.y; view.z = camera.position.z; view.distances = distancesFor(ctx.quality.lodDistances);
    if (!select(grid, copies, selector, view)) return;
    write();
    ctx.requestShadowUpdate();
  }

  // Camera moves mark the pools dirty; the next frames update them, throttled.
  let dirty = true, last: Pose | null = null, spare: Pose = pose(0);
  function pose(time: number, into?: Pose): Pose {
    const q = camera.quaternion, e = camera.projectionMatrix.elements, p = into ?? {} as Pose;
    p.x = camera.position.x; p.y = camera.position.y; p.z = camera.position.z; p.qx = q.x; p.qy = q.y; p.qz = q.z; p.qw = q.w;
    p.projection = e[0] + e[5] * 3 + e[8] * 7 + e[9] * 11; p.time = time;
    return p;
  }
  const offMove = ctx.onCameraMove(() => { dirty = true; });
  const offFrame = ctx.onFrame((_dt, now) => {
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
      for (const p of pools.values()) { const count = p.count; if (count) { drawCalls += p.meshes.length; p.triangles.forEach(t => { tris += t * count; }); } }
      return { copies: n, drawn: selector.current.count, drawCalls, triangles: tris };
    },
    dispose() {
      offMove(); offFrame(); offQuality();
      // The copy geometries share the catalogue's buffers (see copyMesh): dropping the meshes is enough.
      ctx.scene.remove(group);
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
