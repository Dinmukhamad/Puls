/**
 * CPU culling and detail levels for the instance pools (render/instances.ts), with no three.js so Node
 * tests can check it. Copies are binned into a square grid; an update tests the cells' boxes against the
 * camera frustum pushed out by a margin (so shadow casters just outside the view stay), picks a detail
 * level per copy of every visible cell by distance with hysteresis, and says whether the drawn set changed
 * (the static shadow map is then redrawn). The work per update grows with the visible copies, and the
 * number of draw calls not at all: it only decides which instances each pool writes.
 */

/** Cell edge in world units: a few blocks, so a cell test replaces dozens of copy tests. */
export const CELL_SIZE = 32;
/** Levels 0…2 are LOD0…LOD2; HIDDEN lies beyond the last distance (impostors come in stage 3). */
export const HIDDEN = 3;
/** Relative band around every switch distance a copy has to cross before it changes level. */
export const HYSTERESIS = .06;
/** Small camera moves update at most this often; bigger ones at once. */
export const THROTTLE_MS = 100, MOVE = 2, TURN = 2 * Math.PI / 180;

/** Bounding spheres of the copies, one entry per copy. */
export interface Copies { count: number; x: Float32Array; y: Float32Array; z: Float32Array; radius: Float32Array }
export interface Cell { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; items: Uint32Array }
export interface Grid { size: number; cells: Cell[] }

export function createCopies(count: number): Copies {
  return { count, x: new Float32Array(count), y: new Float32Array(count), z: new Float32Array(count), radius: new Float32Array(count) };
}

/** Bins the copies by their centres; each cell's box grows to hold its copies' whole spheres. */
export function buildGrid(copies: Copies, size = CELL_SIZE): Grid {
  const bins = new Map<string, number[]>();
  for (let i = 0; i < copies.count; i++) {
    const key = `${Math.floor(copies.x[i] / size)},${Math.floor(copies.z[i] / size)}`;
    let bin = bins.get(key);
    if (!bin) bins.set(key, bin = []);
    bin.push(i);
  }
  // Cells in a fixed order, so the same view always lists the same copies in the same order.
  const keys = [...bins.keys()].sort();
  const cells = keys.map(key => {
    const items = Uint32Array.from(bins.get(key)!);
    const cell: Cell = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, items };
    for (const i of items) {
      const r = copies.radius[i];
      cell.minX = Math.min(cell.minX, copies.x[i] - r); cell.maxX = Math.max(cell.maxX, copies.x[i] + r);
      cell.minY = Math.min(cell.minY, copies.y[i] - r); cell.maxY = Math.max(cell.maxY, copies.y[i] + r);
      cell.minZ = Math.min(cell.minZ, copies.z[i] - r); cell.maxZ = Math.max(cell.maxZ, copies.z[i] + r);
    }
    return cell;
  });
  return { size, cells };
}

/**
 * Frustum planes as [nx, ny, nz, d] × 6; a point is inside a plane when n·p + d ≥ 0 (three's Plane).
 * The box is outside when its corner farthest along some plane's normal is still more than `margin` behind it.
 */
export function boxOutside(planes: ArrayLike<number>, cell: Cell, margin: number) {
  for (let k = 0; k < planes.length; k += 4) {
    const nx = planes[k], ny = planes[k + 1], nz = planes[k + 2];
    const px = nx > 0 ? cell.maxX : cell.minX, py = ny > 0 ? cell.maxY : cell.minY, pz = nz > 0 ? cell.maxZ : cell.minZ;
    if (nx * px + ny * py + nz * pz + planes[k + 3] + margin < 0) return true;
  }
  return false;
}

/**
 * Detail level for a copy `distance` away: 0 before distances[0], 1 before distances[1], 2 before
 * distances[2], HIDDEN beyond. A copy keeps its previous level until it is `band` (relative) past the
 * switch distance, so a camera resting near a boundary does not make copies flicker between levels.
 */
export function lodLevel(distance: number, previous: number, distances: readonly number[], band = HYSTERESIS) {
  if (previous >= 0) {
    const near = previous > 0 ? distances[previous - 1] * (1 - band) : -Infinity;
    const far = previous < HIDDEN ? distances[previous] * (1 + band) : Infinity;
    if (distance >= near && distance < far) return previous;
  }
  let level = 0;
  while (level < HIDDEN && distance >= distances[level]) level++;
  return level;
}

/** Copies to draw and their levels, in cell order. */
export interface Selection { count: number; copies: Uint32Array; levels: Uint8Array }
export interface Selector {
  /** The last level chosen per copy, kept while its cell is out of view; -1 = never seen. */
  levels: Int8Array;
  current: Selection;
  previous: Selection;
}

export function createSelector(count: number): Selector {
  const selection = (): Selection => ({ count: 0, copies: new Uint32Array(count), levels: new Uint8Array(count) });
  return { levels: new Int8Array(count).fill(-1), current: selection(), previous: selection() };
}

export interface View {
  /** Camera position. */
  x: number; y: number; z: number;
  planes: ArrayLike<number>;
  /** How far the frustum is pushed out, in world units. */
  margin: number;
  distances: readonly number[];
}

/** Fills `selector.current` with the copies to draw; returns true if the set or any level changed. */
export function select(grid: Grid, copies: Copies, selector: Selector, view: View) {
  const done = selector.previous;
  selector.previous = selector.current; selector.current = done;
  const out = selector.current, { levels } = selector;
  let n = 0;
  for (const cell of grid.cells) {
    if (boxOutside(view.planes, cell, view.margin)) continue;
    for (const i of cell.items) {
      const dx = copies.x[i] - view.x, dy = copies.y[i] - view.y, dz = copies.z[i] - view.z;
      const level = lodLevel(Math.sqrt(dx * dx + dy * dy + dz * dz), levels[i], view.distances);
      levels[i] = level;
      if (level === HIDDEN) continue;
      out.copies[n] = i; out.levels[n] = level; n++;
    }
  }
  out.count = n;
  const before = selector.previous;
  if (before.count !== n) return true;
  for (let k = 0; k < n; k++) if (before.copies[k] !== out.copies[k] || before.levels[k] !== out.levels[k]) return true;
  return false;
}

/** Where the camera was at an update: position, orientation, a projection fingerprint and the time in ms. */
export interface Pose { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; projection: number; time: number }

/** Angle between two orientations, radians. */
export function turnAngle(a: Pose, b: Pose) {
  const dot = Math.abs(a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw);
  return 2 * Math.acos(Math.min(1, dot));
}

/**
 * Whether a camera that moved since the `last` update should update now: at most every 100 ms for small
 * moves, at once for a move over 2 units, a turn over 2° or a new projection (resize, zoom of the view).
 */
export function shouldUpdate(last: Pose | null, pose: Pose) {
  if (!last) return true;
  return pose.time - last.time >= THROTTLE_MS || pose.projection !== last.projection ||
    Math.hypot(pose.x - last.x, pose.y - last.y, pose.z - last.z) > MOVE || turnAngle(last, pose) > TURN;
}
