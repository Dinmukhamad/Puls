/** Orthogonal department city. Pure data; catalogue assets are shared with Support. */
import { WORLD_V1 } from "./worldSpec";
import { makeRoute, rng, segmentDistance } from "./generate";
import { districtLand, landRules, onDistrictLand, type DistrictLand } from "./estates";
import type { Placement, Point, Road, WorldData } from "./types";

export const SALES_CENTERS = Array.from({ length: 10 }, (_, i) => ({
  id: `sales-resource-${String(i + 1).padStart(2, "0")}`, x: i < 5 ? -11 : 11, z: -28 + (i % 5) * 14,
}));
/**
 * Support: the first three as before, in their wedges between the avenues; the others at the middle of the
 * wedges left (degrees), the last two behind the outer ring road. Sales: on the module lattice round the lake
 * (world/estates.ts): B on the left, C on the right, A at the top, the next below B and C and by the station; the
 * rest, still without land, in the corners.
 */
const SUPPORT_MORE: [number, number][] = [[125.5, 210], [-129.1, 210], [-52.4, 210], [55.1, 210], [160.6, 210], [-91.8, 210], [20, 210], [55.1, 262], [160.6, 262]];
const SALES_SPOTS: Point[] = [
  { x: -78.5, z: -33.5 }, { x: 78.5, z: -33.5 }, { x: 0, z: -77.5 }, { x: -78.5, z: 50.5 }, { x: 78.5, z: 50.5 }, { x: -21, z: 77.5 },
  { x: -120.5, z: -98.5 }, { x: 120.5, z: -98.5 }, { x: -120.5, z: 98.5 }, { x: 120.5, z: 98.5 }, { x: -99.5, z: -98.5 }, { x: 99.5, z: -98.5 },
];
export function teamPositions(count: number, support = false, roads: readonly Road[] = []): Point[] {
  if (support) return Array.from({ length: count }, (_, i) => {
    const [start, radius] = i < 3 ? [1.5 + i * Math.PI * 2 / 3, 210] : [SUPPORT_MORE[i - 3][0] * Math.PI / 180, SUPPORT_MORE[i - 3][1]];
    let a = start, p = { x: 0, z: 0 };
    for (let n = 0; n < 80; n++, a += .025) {
      p = { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
      if (roads.every(road => segmentDistance(p.x, p.z, road) > 10)) break;
    }
    return p;
  });
  return SALES_SPOTS.slice(0, count).map(p => ({ ...p }));
}

/** The sales streets: the outer frame, the inner square round the lake; the bands above and below hold two rows of modules. */
const TOP = -110, BOTTOM = 110, OUTER = 132, INNER = 66;
function salesStreets(): Road[] {
  const streets: Road[] = [];
  for (const x of [-OUTER, -INNER, INNER, OUTER]) streets.push([x, TOP, x, BOTTOM]);
  for (const z of [TOP, -INNER, INNER, BOTTOM]) streets.push([-OUTER, z, OUTER, z]);
  return streets;
}
/** The team districts of the sales city, laid out once from its streets. */
export function salesLand(): DistrictLand {
  return districtLand("sales", landRules("sales", { streets: salesStreets(), rings: [] }), teamPositions(12));
}
/** The team districts of the support city, in the suburbs of the generated island city. */
export function supportLand(roads: { streets: readonly Road[]; rings: readonly number[] }): DistrictLand {
  return districtLand("support", landRules("support", roads), teamPositions(12, true, roads.streets));
}

export function generateSalesWorld(): WorldData {
  const random = rng(20261001), placements: Placement[] = [], streets = salesStreets(), land = salesLand();
  const add = (kind: Placement["kind"], x: number, z: number, width = 0, scale = 1, extra: Partial<Placement> = {}) =>
    placements.push({ kind, x, z, width, scale, variant: Math.floor(random() * 12), rotation: 0, ...extra });
  // A footbridge to the central campus, independent of the road graph.
  const surfaces: WorldData["surfaces"] = [{ kind: "plaza", x: 0, z: 0, angle: 0, length: 74, width: 36 }];
  // Houses and gardens fill only what the districts leave: the band by the station and the corners.
  for (let x = -120; x <= 120; x += 12) for (let z = -102; z <= 102; z += 12) {
    if (Math.abs(x) < 58 && Math.abs(z) < 59 || onDistrictLand(land, { x, z }, 6, 8.5)) continue;
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
    [{ x: -OUTER, z: TOP }, { x: OUTER, z: TOP }, { x: OUTER, z: BOTTOM }, { x: -OUTER, z: BOTTOM }],
    [{ x: -INNER, z: -INNER }, { x: INNER, z: -INNER }, { x: INNER, z: INNER }, { x: -INNER, z: INNER }],
  ];
  return {
    spec: { ...WORLD_V1, name: "sales", horizon: 190, seed: 20261001, lagoon: 46, promenade: 50, quay: 46, bank: 47, districts: [], mainland: [], roadRings: [66, 132], islet: 4, districtScale: 1 },
    districts: [], radius: 190,
    land: { annuli: [], islets: [], rectangle: { width: 284, depth: 244, lake: 46 }, platforms: [{ x: 0, z: 0, width: 38, depth: 76 }, { x: 0, z: 47, width: 4, depth: 20 }] },
    water: { annuli: [{ inner: 0, outer: 46 }] },
    roads: { rings: [], streets, bridges: [], crosswalks: [], parking: [] },
    placements, parks: [], complexes: [], alleys: [], surfaces,
    walks: [Array.from({ length: 65 }, (_, i) => ({ x: Math.cos(i / 64 * Math.PI * 2) * 50, z: Math.sin(i / 64 * Math.PI * 2) * 50 }))],
    plots: [], sites: [], questSpots: [], routes: paths.map(points => ({ route: makeRoute(points.map(p => ({ points: [p] }))), cars: 8, speed: 4 })),
  };
}
