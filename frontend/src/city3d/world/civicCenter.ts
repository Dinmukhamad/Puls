/** The Support city's connected civic park. Mission anchors, outer roads and player plots stay in place. */
import { segmentDistance } from "./generate";
import type { CivicCenter, Placement, Point, Road, WorldData } from "./types";

const AX = 57.4, AZ = 57, TAU = Math.PI * 2;
const ellipse = (ax: number, az: number, count = 64) => Array.from({ length: count }, (_, i) => ({ x: Math.cos(i / count * TAU) * ax, z: Math.sin(i / count * TAU) * az }));
const insideRectangle = (r: { x: number; z: number; width: number; depth: number }, p: Point, pad = 0) => Math.abs(p.x - r.x) <= r.width / 2 + pad && Math.abs(p.z - r.z) <= r.depth / 2 + pad;
function insidePolygon(points: readonly Point[], p: Point) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function edgeDistance(points: readonly Point[], p: Point) {
  let squared = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length)) : 0;
    squared = Math.min(squared, (p.x - a.x - dx * t) ** 2 + (p.z - a.z - dz * t) ** 2);
  }
  return Math.sqrt(squared);
}

/** Unsigned distance to an actual park/pond shore, used once when water and lamp buffers are built. */
export function centerShoreDistance(center: CivicCenter, p: Point): number {
  let distance = edgeDistance(center.outline, p);
  for (const pond of center.ponds) {
    const dx = Math.abs(p.x - pond.x) - pond.width / 2, dz = Math.abs(p.z - pond.z) - pond.depth / 2;
    distance = Math.min(distance, dx <= 0 && dz <= 0 ? Math.min(-dx, -dz) : Math.hypot(Math.max(dx, 0), Math.max(dz, 0)));
  }
  return distance;
}

export function centerContains(center: CivicCenter, p: Point, margin = 0): boolean {
  return insidePolygon(center.outline, p) && !center.ponds.some(pond => insideRectangle(pond, p)) && (margin <= 0 || centerShoreDistance(center, p) >= margin);
}

const pathSegments = (center: CivicCenter) => center.paths.flatMap(path => path.points.slice(1).map((b, i) => ({ road: [path.points[i].x, path.points[i].z, b.x, b.z] as Road, width: path.width })));
const hash = (n: number) => { const value = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return value - Math.floor(value); };

export function addCivicCenter(world: WorldData): void {
  if (world.spec.name !== "x4" || world.center) return;
  const perimeter = ellipse(AX - 1.8, AZ - 1.8);
  const center: CivicCenter = {
    outline: ellipse(AX, AZ),
    ponds: [-15, 15].map(x => ({ x, z: 3, width: 6, depth: 14 })),
    plaza: { x: 0, z: 0, width: 20, depth: 34 },
    forecourts: world.districts.map(d => ({ x: d.x, z: d.z, width: 12.4, depth: 12.4 })),
    paths: [
      { points: [{ x: 0, z: -54.5 }, { x: 0, z: 54.5 }], width: 5.4 },
      { points: [{ x: -55, z: -7 }, { x: 55, z: -7 }], width: 3.4 },
      { points: [...perimeter, perimeter[0]], width: 1.7 },
    ],
  };
  // Each entrance reaches the boulevard, without drawing every approach through the central pedestal.
  const blocked = (road: Road, district: string) => {
    const steps = Math.max(2, Math.ceil(Math.hypot(road[2] - road[0], road[3] - road[1])));
    for (let i = 0; i <= steps; i++) {
      const p = { x: road[0] + (road[2] - road[0]) * i / steps, z: road[1] + (road[3] - road[1]) * i / steps };
      if (center.ponds.some(pond => insideRectangle(pond, p, 1.3)) || world.districts.some(d => d.id !== district && Math.abs(p.x - d.x) < 6.4 && Math.abs(p.z - d.z) < 6.4)) return true;
    }
    return false;
  };
  for (const d of world.districts) {
    const start = { x: d.x, z: d.z - 6.1 }, approach = { x: d.x, z: d.z - 7.5 };
    const horizontal: Road = [approach.x, approach.z, 0, approach.z];
    const points = blocked(horizontal, d.id) ? [start, approach, { x: d.x, z: -7 }, { x: 0, z: -7 }] : [start, approach, { x: 0, z: approach.z }];
    center.paths.push({ points, width: 2.1 });
  }
  // Five short access bridges replace the former wheel of lagoon bridges. Cars retain their outer routes.
  const access = world.roads.bridges.filter(b => b.canal).map(({ road }) => Math.atan2(road[1] + road[3], road[0] + road[2]));
  const unique = access.filter((a, i) => access.findIndex(b => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < .01) === i);
  const bridges = unique.map(angle => {
    const ux = Math.cos(angle), uz = Math.sin(angle);
    let low = 0, high = Math.max(AX, AZ) + 2;
    for (let k = 0; k < 30; k++) { const mid = (low + high) / 2; if (centerContains(center, { x: ux * mid, z: uz * mid })) low = mid; else high = mid; }
    const shore = low;
    const outer = world.spec.lagoon + .3, inner = shore - .35;
    center.paths.push({ points: [{ x: ux * (shore - 2), z: uz * (shore - 2) }, { x: ux * (shore - .05), z: uz * (shore - .05) }], width: 2.75 });
    return { canal: false, road: [ux * inner, uz * inner, ux * outer, uz * outer] as Road };
  });
  world.roads.streets = world.roads.streets.filter(([ax, az, bx, bz]) => Math.min(Math.hypot(ax, az), Math.hypot(bx, bz)) >= world.spec.roadRings[0] - .1);
  for (const angle of unique) {
    const from = world.spec.lagoon, to = world.spec.roadRings[0] - .95;
    world.roads.streets.push([Math.cos(angle) * from, Math.sin(angle) * from, Math.cos(angle) * to, Math.sin(angle) * to]);
  }
  world.roads.bridges = [...world.roads.bridges.filter(b => b.canal), ...bridges];
  world.roads.crosswalks = world.roads.crosswalks.filter(p => Math.hypot(p.x, p.z) >= world.spec.roadRings[0]);
  world.center = center;
  world.placements = world.placements.filter(p => !p.kind.startsWith("tree-") || Math.hypot(p.x, p.z) > world.spec.lagoon);
  const segments = pathSegments(center), added: Placement[] = [];
  const put = (kind: Placement["kind"], p: Point, scale = 1, rotation = 0, lift = 0) => added.push({ kind, variant: 0, ...p, scale, rotation, width: 0, ...(lift ? { lift } : {}) });
  for (let x = -48; x <= 48; x += 8) for (let z = -48; z <= 48; z += 8) {
    const seed = (x + 60) * 131 + z + 61, p = { x: x + (hash(seed) - .5) * 2.1, z: z + (hash(seed + 7) - .5) * 2.1 };
    if (!centerContains(center, p, 3) || insideRectangle(center.plaza, p, 3) || world.districts.some(d => Math.hypot(p.x - d.x, p.z - d.z) < 8.3) || segments.some(s => segmentDistance(p.x, p.z, s.road) < s.width / 2 + 1.3)) continue;
    put(hash(seed + 1) > .65 ? "tree-birch" : "tree-round", p, 1.55 + hash(seed + 2) * .35, hash(seed + 3) * TAU);
  }
  for (const d of world.districts) for (const side of [-1, 1]) {
    put("bench", { x: d.x + side * 5.7, z: d.z - 2.5 }, .9, side * Math.PI / 2);
    put("flowerbed", { x: d.x + side * 3.5, z: d.z + 5.4 }, .85);
    const lamp = { x: d.x + side * 5.5, z: d.z - 6.8 };
    if (!centerContains(center, lamp, .35)) lamp.z += 1.2;
    put("lamp", lamp);
  }
  for (const x of [-8.3, 8.3]) for (const z of [-12, 12]) put("planter", { x, z }, 1.2, 0, .112);
  world.placements.push(...added);
  // Only the perimeter is a closed pedestrian loop; the centre's raised pedestal stays unobstructed.
  world.walks.push(perimeter);
}
