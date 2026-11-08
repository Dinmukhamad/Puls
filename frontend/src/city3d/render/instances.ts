/**
 * Instance pools: every static copy of the world (buildings, trees, lamps, parked cars) is drawn through
 * one copy mesh (render/copies.ts) per model part and detail level, whatever the size of the city (TZ §6.2).
 * Copy meshes of one material share a shader build, so the city's hundred-odd pools build a few shaders.
 *
 * BatchedMesh would be the TZ's tool, but in three r180 its WebGPU backend issues one draw call per
 * instance (5130 calls for 1500 copies), while WebGL2 uses multi-draw. So culling and LOD run on the CPU
 * (render/cells.ts): on camera moves, at most every 100 ms for small ones, cells of the grid and then each copy
 * are tested against the camera frustum, every copy in view picks a level by distance with hysteresis (small
 * things are hidden beyond the quality's smallReach), and each pool gets the matrices of its copies and a count.
 * A pool whose copies and levels stayed the same writes and uploads nothing; a changed pool rewrites and uploads
 * only the slots from its first change (update ranges). Draw calls stay at the number of pools in view; copies
 * beyond the last LOD distance are hidden, and so are empty pools.
 *
 * Two selections. The frame draws a tight one: what is in view, with just enough margin for the moves an update
 * may lag behind. The static shadow map, redrawn once after the camera rests (index.ts), needs a wide one (the
 * view pushed out by CULL_MARGIN), so shadows just beyond the screen's edges stay in the map while the camera
 * pans: ctx.onShadowRedraw fires just before that redraw, and the wide copies the frame does not draw are written
 * after each pool's own and shown to the shadow pass alone (onBeforeShadow / onAfterShadow), so the frame's copies
 * never have to be put back. The wide selection is made once the camera pauses, and the shadow map is asked for
 * again only when it changed. Small things cast shadows only in close views (smallShadowReach).
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import type { QualitySettings } from "../engine/qualityTypes";
import { SMALL_REACH } from "../engine/qualityCore";
import type { Placement } from "../world/types";
import type { ModelPart } from "../assets/loader";
import type { Catalogue, CatalogueModel } from "../assets/catalogue";
import { FOG_END } from "../world/relief";
import { HYSTERESIS, SMALL_RADIUS, THROTTLE_MS, TIGHT_MARGIN, TIGHT_TURN, buildGrid, createCopies, createSelector, select, shouldUpdate, type Pose, type Selection, type View } from "./cells";
import { COPY_STRIDE, copyMatrices, copyMesh, copyTints } from "./copies";

/**
 * How far the static shadow map's casters push the frustum out: the shadow of the tallest block (about 15 units
 * at a 35° sun) and a pan of a few seconds both stay inside it, so casters just out of view still cast.
 */
export const CULL_MARGIN = 24;
/**
 * Small things cast shadows only while the camera looks from no farther than this share of their hide distance,
 * and while the static shadow map's texels (about 2.6 × the view distance / map size, render/sky.ts followView)
 * stay under SMALL_SHADOW_TEXEL world units: coarser, their shadows are blots of a texel or two.
 */
export const SMALL_SHADOW_SHARE = .75, SMALL_SHADOW_TEXEL = .2;
/**
 * How long the camera has to pause before the wide selection is made: longer than an update's throttle, shorter than
 * the rest before index.ts redraws the static shadow map (SHADOW_REST_MS, 250 ms).
 */
export const WIDE_PAUSE = THROTTLE_MS + 20;
/** The quality's hide distance of small things (a bare context in tests may not say: the default then). */
const smallReachOf = (q: Partial<QualitySettings>) => q.smallReach ?? SMALL_REACH;
export const smallShadowReach = (q: Partial<QualitySettings>) =>
  Math.min(smallReachOf(q) * SMALL_SHADOW_SHARE, (q.staticShadowSize ?? 2048) * SMALL_SHADOW_TEXEL / 2.6);

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
interface Pool {
  parts: ModelPart[]; meshes: CopyMesh[]; matrices: THREE.InstancedInterleavedBuffer; colors: THREE.InstancedBufferAttribute[];
  capacity: number; count: number; triangles: number[];
  /** The copy and its level in each slot, the slots the write in progress filled, and its first slot that differs (-1: none yet). */
  ids: Uint32Array; levels: Uint8Array; next: number; first: number;
  /** Copies the shadow pass draws: the frame's copies, then the extra shadow casters written after them. */
  shadowCount: number;
  /** Every copy is a small thing: the pool casts shadows only in close views. */
  small: boolean;
}

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
    // Bounding sphere of the copy, for the cell boxes, the LOD distance and whether it is a small thing.
    model.bounds.getCenter(center).applyMatrix4(matrix); model.bounds.getSize(size);
    copies.x[i] = center.x; copies.y[i] = center.y; copies.z[i] = center.z;
    copies.radius[i] = size.length() / 2 * matrix.getMaxScaleOnAxis();
  });
  const grid = buildGrid(copies), tight = createSelector(n), wide = createSelector(n);

  // One pool per distinct parts list; its capacity is the copies of every model that can land in it.
  const pools = new Map<ModelPart[], Pool>(), levelPool = models.map(model => model.lods.map(level => level ? pool(level.parts) : null));
  function pool(parts: ModelPart[]): Pool {
    let p = pools.get(parts);
    if (!p) pools.set(parts, p = { parts, meshes: [], matrices: null!, colors: [], capacity: 0, count: 0, triangles: parts.map(part => triangles(part.geometry)), ids: null!, levels: null!, next: 0, first: -1, shadowCount: 0, small: true });
    return p;
  }
  models.forEach((_, m) => { for (const p of new Set(levelPool[m].filter(Boolean))) p!.capacity += perModel[m]; });
  for (let i = 0; i < n; i++) if (copies.radius[i] >= SMALL_RADIUS) for (const p of levelPool[modelOf[i]]) if (p) p.small = false;
  const list = [...pools.values()];

  const group = new THREE.Group(); group.name = "city-instances"; group.matrixAutoUpdate = false;
  for (const p of list) {
    // The parts of a pool share its matrices; every part has tints (white when the model has none), so pools of
    // one material always share their shaders.
    p.matrices = copyMatrices(p.capacity); p.ids = new Uint32Array(Math.max(1, p.capacity)); p.levels = new Uint8Array(Math.max(1, p.capacity));
    p.parts.forEach(part => {
      const shades = copyTints(p.capacity), mesh = copyMesh(part.geometry, part.material, p.matrices, shades);
      mesh.castShadow = part.castShadow; mesh.receiveShadow = true; mesh.name = "city-pool"; mesh.visible = false;
      // The shadow pass draws the extra casters after the frame's copies; the frame itself draws only its own.
      mesh.onBeforeShadow = () => { if (p.shadowCount > p.count) mesh.geometry.instanceCount = p.shadowCount; };
      mesh.onAfterShadow = () => { mesh.geometry.instanceCount = p.count; };
      p.colors.push(shades); p.meshes.push(mesh); group.add(mesh);
    });
  }
  ctx.scene.add(group);

  const camera = ctx.camera, frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), planes = new Float32Array(24);
  // The far slot retains the architectural model (or a reduced tree/prop silhouette) out to the last placements,
  // so the map never shows empty ground; the quality's last distance only limits the middle slot.
  const fogFar = ctx.world.radius * FOG_END;
  const distancesFor = (d: readonly number[]) => [d[0], d[1], Math.max(d[2], fogFar)] as [number, number, number];
  const views = {
    tight: { x: 0, y: 0, z: 0, planes, margin: TIGHT_MARGIN, turn: TIGHT_TURN, distances: distancesFor(ctx.quality.lodDistances), small: smallReachOf(ctx.quality) } as View,
    wide: { x: 0, y: 0, z: 0, planes, margin: CULL_MARGIN, turn: 0, distances: distancesFor(ctx.quality.lodDistances), small: smallReachOf(ctx.quality) } as View,
  };
  // Without a hook for the shadow redraw (a bare context in tests), the frame draws the wide selection, as the
  // shadow map needs it.
  const split = typeof ctx.onShadowRedraw === "function";
  const white = new THREE.Color(1, 1, 1), forward = new THREE.Vector3();

  /** Marks [start, end) of a buffer for upload, together with what is still waiting from an earlier write. */
  function flag(buffer: THREE.InterleavedBuffer | THREE.BufferAttribute, start: number, end: number) {
    for (const range of buffer.updateRanges) { start = Math.min(start, range.start); end = Math.max(end, range.start + range.count); }
    buffer.clearUpdateRanges(); buffer.addUpdateRange(start, end - start); buffer.needsUpdate = true;
  }
  /** Writes slot `slot` of pool `p` from the copy and level in it: its matrix (times the level's own, if any) and tints. */
  function fill(p: Pool, slot: number) {
    const out = p.matrices.array as Float32Array, c = p.ids[slot], lod = models[modelOf[c]].lods[p.levels[slot]]!;
    if (lod.matrix) multiply(matrices, c * 16, lod.matrix.elements, out, slot * COPY_STRIDE);
    else for (let e = 0; e < 16; e++) out[slot * COPY_STRIDE + e] = matrices[c * 16 + e];
    for (let part = 0; part < p.colors.length; part++) {
      const color = lod.colors?.[part] ?? white, target = p.colors[part].array as Float32Array;
      target[slot * 3] = tints[c * 3] * color.r; target[slot * 3 + 1] = tints[c * 3 + 1] * color.g; target[slot * 3 + 2] = tints[c * 3 + 2] * color.b;
    }
  }
  /** Flags slots [from, to) of a pool's matrices and tints for upload. */
  function flagSlots(p: Pool, from: number, to: number) {
    flag(p.matrices, from * COPY_STRIDE, to * COPY_STRIDE);
    for (const colors of p.colors) flag(colors, from * 3, to * 3);
  }

  /**
   * Puts a selection's copies into the pools: each pool keeps its slots up to its first changed one, and rewrites
   * and flags for upload only the slots from there to its new count. Returns whether any pool changed.
   */
  function write(selection: Selection) {
    for (const p of list) { p.next = 0; p.first = -1; }
    for (let k = 0; k < selection.count; k++) {
      const c = selection.copies[k], level = selection.levels[k], p = levelPool[modelOf[c]][level];
      if (!p) continue;
      const slot = p.next++;
      if (p.first < 0 && (slot >= p.count || p.ids[slot] !== c || p.levels[slot] !== level)) p.first = slot;
      p.ids[slot] = c; p.levels[slot] = level;
    }
    let changed = false;
    for (const p of list) {
      const count = p.next;
      if (p.first < 0) { if (count === p.count) continue; p.first = count; }
      changed = true;
      for (let slot = p.first; slot < count; slot++) fill(p, slot);
      if (count > p.first) flagSlots(p, p.first, count);
      p.count = p.shadowCount = count;
      for (const mesh of p.meshes) { mesh.geometry.instanceCount = count; mesh.visible = count > 0; }
    }
    return changed;
  }

  /** How far the camera looks: along its view to the ground, as the rig's distance to its target. */
  function viewDistance() {
    camera.getWorldDirection(forward);
    return forward.y < -.05 ? camera.position.y / -forward.y : ctx.world.radius;
  }
  // Whether small things cast shadows, as the static shadow map now has them (steady within HYSTERESIS of the limit).
  const castsAt = (distance: number, previous: boolean) => distance < smallShadowReach(ctx.quality) * (previous ? 1 + HYSTERESIS : 1 - HYSTERESIS);
  let smallCast = viewDistance() < smallShadowReach(ctx.quality), mapCast = smallCast;
  function castSmall(cast: boolean) {
    for (const p of list) if (p.small) p.parts.forEach((part, k) => { p.meshes[k].castShadow = part.castShadow && cast; });
    mapCast = cast;
  }
  castSmall(smallCast);

  /** The frustum, the distances and the hide distance of small things for the camera as it is now. */
  function aim() {
    camera.updateMatrixWorld();
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection, camera.coordinateSystem);
    frustum.planes.forEach((plane, k) => { planes[k * 4] = plane.normal.x; planes[k * 4 + 1] = plane.normal.y; planes[k * 4 + 2] = plane.normal.z; planes[k * 4 + 3] = plane.constant; });
    for (const view of [views.tight, views.wide]) {
      view.x = camera.position.x; view.y = camera.position.y; view.z = camera.position.z;
      view.distances = distancesFor(ctx.quality.lodDistances); view.small = smallReachOf(ctx.quality);
    }
    smallCast = castsAt(viewDistance(), smallCast);
  }
  // `wideDue`: the camera moved since the wide selection was made; it is made once the camera pauses (WIDE_PAUSE,
  // before index.ts redraws the map at rest), not on every frame of a move.
  let wideDue = false, clock = 0, lastUpdate = 0;
  /** Makes the wide selection; asks for the shadow map again if its casters changed since it was drawn. */
  function checkWide() {
    wideDue = false;
    if (select(grid, copies, wide, views.wide) || smallCast !== mapCast) ctx.requestShadowUpdate();
  }
  function update() {
    lastUpdate = clock;
    aim();
    if (!split) {
      // One selection for both passes: the wide one, written whenever it changes.
      select(grid, copies, wide, views.wide);
      if (smallCast !== mapCast) { castSmall(smallCast); ctx.requestShadowUpdate(); }
      if (write(wide.current)) ctx.requestShadowUpdate();
      return;
    }
    wideDue = true;
    if (select(grid, copies, tight, views.tight)) write(tight.current);
  }

  // Just before the static shadow map is redrawn: the wide selection's copies the frame does not draw are written
  // after each pool's own, for the shadow pass alone (onBeforeShadow); small things cast or not. The frame's copies
  // stay as they are, so nothing has to be put back; the next frame forgets the extras.
  const seen = new Uint32Array(n);
  let stamp = 0, extrasOut = false;
  function addShadowCasters(selection: Selection) {
    const mark = ++stamp;
    for (const p of list) { for (let slot = 0; slot < p.count; slot++) seen[p.ids[slot]] = mark; p.next = p.count; }
    for (let k = 0; k < selection.count; k++) {
      const c = selection.copies[k], level = selection.levels[k], p = levelPool[modelOf[c]][level];
      if (seen[c] === mark || !p) continue;
      const slot = p.next++;
      p.ids[slot] = c; p.levels[slot] = level; fill(p, slot);
    }
    for (const p of list) {
      p.shadowCount = p.next;
      if (p.next <= p.count) continue;
      flagSlots(p, p.count, p.next);
      for (const mesh of p.meshes) mesh.visible = true;
    }
  }

  // Camera moves mark the pools dirty; the next frames update them, throttled.
  let dirty = true, force = false, last: Pose | null = null, spare: Pose = pose(0);
  function pose(time: number, into?: Pose): Pose {
    const q = camera.quaternion, e = camera.projectionMatrix.elements, p = into ?? {} as Pose;
    p.x = camera.position.x; p.y = camera.position.y; p.z = camera.position.z; p.qx = q.x; p.qy = q.y; p.qz = q.z; p.qw = q.w;
    p.projection = e[0] + e[5] * 3 + e[8] * 7 + e[9] * 11; p.time = time;
    return p;
  }
  const offMove = ctx.onCameraMove(() => { dirty = true; });
  const offFrame = ctx.onFrame((_dt, now) => {
    clock = now;
    if (extrasOut) {
      extrasOut = false;
      for (const p of list) { p.shadowCount = p.count; for (const mesh of p.meshes) mesh.visible = p.count > 0; }
    }
    if (dirty) {
      const next = pose(now, spare);
      if (!force && !shouldUpdate(last, next)) return;
      spare = last ?? pose(0); last = next; dirty = force = false;
      update();
    } else if (wideDue && now - lastUpdate >= WIDE_PAUSE) checkWide();
  });
  const offShadow = split ? ctx.onShadowRedraw!(() => {
    if (dirty) { dirty = force = false; update(); }
    if (wideDue) { wideDue = false; select(grid, copies, wide, views.wide); }
    castSmall(smallCast);
    addShadowCasters(wide.current);
    extrasOut = true;
  }) : () => undefined;
  let settingsKey = qualityKey(ctx.quality);
  const offQuality = ctx.onQuality(q => { const key = qualityKey(q); if (key !== settingsKey) { settingsKey = key; update(); } });
  update();

  return {
    update,
    stats() {
      let drawCalls = 0, tris = 0, drawn = 0;
      for (const p of list) { const count = p.count; drawn += count; if (count) { drawCalls += p.meshes.length; p.triangles.forEach(t => { tris += t * count; }); } }
      return { copies: n, drawn, drawCalls, triangles: tris };
    },
    dispose() {
      offMove(); offFrame(); offQuality(); offShadow();
      // The copy geometries share the catalogue's buffers (see copyMesh): dropping the meshes is enough.
      ctx.scene.remove(group);
      pools.clear();
    },
  };
}

/** What in the quality changes the pools' selections: the LOD distances, the small things' reach, the shadow map. */
function qualityKey(q: Partial<QualitySettings>) {
  return `${q.lodDistances?.join()}|${smallReachOf(q)}|${q.staticShadowSize}`;
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
