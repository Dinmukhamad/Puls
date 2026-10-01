/** Orthogonal department city. Pure data; catalogue assets are shared with Support. */
import { WORLD_V1 } from "./worldSpec";
import { makeRoute, rng, segmentDistance } from "./generate";
import type { Placement, Point, Road, WorldData } from "./types";

export const SALES_CENTERS = Array.from({ length: 10 }, (_, i) => ({
  id: `sales-resource-${String(i + 1).padStart(2, "0")}`, x: i < 5 ? -11 : 11, z: -28 + (i % 5) * 14,
}));
export function teamPositions(count: number, support = false, roads: readonly Road[] = []): Point[] {
  if (support) return Array.from({ length: count }, (_, i) => {
    let a = 1.5 + (i % 3) * Math.PI * 2 / 3 + Math.floor(i / 3) * .39;
    let p = { x: 0, z: 0 };
    for (let n = 0; n < 80; n++, a += .025) {
      p = { x: Math.cos(a) * 210, z: Math.sin(a) * 210 };
      if (roads.every(road => segmentDistance(p.x, p.z, road) > 10)) break;
    }
    return p;
  });
  const spots = [{ x: -83, z: -46 }, { x: 83, z: -46 }, { x: 0, z: 82 }];
  for (const z of [-84, -42, 0, 42, 84]) for (const x of [-113, 113]) spots.push({ x, z });
  return spots.slice(0, count);
}
export function generateSalesWorld(): WorldData {
  const random = rng(20261001), placements: Placement[] = [], streets: Road[] = [];
  const add = (kind: Placement["kind"], x: number, z: number, width = 0, scale = 1, extra: Partial<Placement> = {}) =>
    placements.push({ kind, x, z, width, scale, variant: Math.floor(random() * 12), rotation: 0, ...extra });
  for (const x of [-132, -66, 66, 132]) streets.push([x, -103, x, 103]);
  for (const z of [-103, -66, 66, 103]) streets.push([-132, z, 132, z]);
  // A footbridge to the central campus, independent of the road graph.
  const surfaces: WorldData["surfaces"] = [{ kind: "plaza", x: 0, z: 0, angle: 0, length: 74, width: 36 }];
  const hqs = teamPositions(12);
  for (let x = -120; x <= 120; x += 12) for (let z = -90; z <= 90; z += 12) {
    if (Math.abs(x) < 58 && Math.abs(z) < 59 || hqs.some(p => Math.hypot(x - p.x, z - p.z) < 16)) continue;
    if (streets.some(([ax, az, bx]) => ax === bx ? Math.abs(x - ax) < 4 : Math.abs(z - az) < 4)) continue;
    if (Math.abs(x) < 7 && z > 35) continue; // rail corridor
    const business = z < -67, park = random() < .16;
    if (park) {
      surfaces.push({ kind: "lawn", x, z, angle: 0, width: 9, length: 9 });
      for (const dx of [-2.5, 2.5]) for (const dz of [-2.5, 2.5]) add("tree-round", x + dx, z + dz, 0, 1.25);
      add("bench", x, z, 1.5);
    } else {
      add(business ? "glass-tower" : "cottage", x, z, business ? 5 : 5.5, 1, { depth: 5, variant: business ? 2 + Math.floor(random() * 3) : Math.floor(random() * 2), tint: Math.floor(random() * 4) });
      add("tree-cone", x + 4, z + 3, 0, 1.2);
      surfaces.push({ kind: "walk", x, z, angle: 0, width: 9, length: 9 });
    }
  }
  for (let i = 0; i < 72; i++) {
    const a = i * Math.PI * 2 / 72, x = Math.cos(a) * 54, z = Math.sin(a) * 54;
    if (Math.abs(x) < 5 && z > 0) continue;
    add(i % 4 ? "tree-round" : "lamp", x, z, 0, i % 4 ? 1.5 : 1);
  }
  for (const p of SALES_CENTERS) surfaces.push({ kind: "plaza", ...p, angle: 0, width: 11, length: 11 });
  const paths = [
    [{ x: -132, z: -103 }, { x: 132, z: -103 }, { x: 132, z: 103 }, { x: -132, z: 103 }, { x: -132, z: -103 }],
    [{ x: -66, z: -66 }, { x: 66, z: -66 }, { x: 66, z: 66 }, { x: -66, z: 66 }, { x: -66, z: -66 }],
  ];
  return {
    spec: { ...WORLD_V1, name: "sales", horizon: 180, seed: 20261001, lagoon: 46, promenade: 50, quay: 46, bank: 47, districts: [], mainland: [], roadRings: [66, 132], islet: 4, districtScale: 1 },
    districts: [], radius: 180,
    land: { annuli: [], islets: [], rectangle: { width: 284, depth: 230, lake: 46 }, platforms: [{ x: 0, z: 0, width: 38, depth: 76 }, { x: 0, z: 47, width: 4, depth: 20 }] },
    water: { annuli: [{ inner: 0, outer: 46 }] },
    roads: { rings: [], streets, bridges: [], crosswalks: [], parking: [] },
    placements, parks: [], complexes: [], alleys: [], surfaces,
    walks: [Array.from({ length: 65 }, (_, i) => ({ x: Math.cos(i / 64 * Math.PI * 2) * 50, z: Math.sin(i / 64 * Math.PI * 2) * 50 }))],
    plots: [], sites: [], questSpots: [], routes: paths.map(points => ({ route: makeRoute(points.slice(0, -1).map(p => ({ points: [p] }))), cars: 8, speed: 4 })),
  };
}
