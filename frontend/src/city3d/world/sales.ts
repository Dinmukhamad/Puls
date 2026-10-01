/** Orthogonal department city. Pure data; catalogue assets are shared with Support. */
import { WORLD_V1 } from "./worldSpec";
import { makeRoute, rng } from "./generate";
import { RAIL_LINES } from "./railway";
import { addStationSquare } from "./stationSquare";
import type { Placement, Road, WorldData } from "./types";

export const SALES_CENTERS = Array.from({ length: 10 }, (_, i) => ({
  id: `sales-resource-${String(i + 1).padStart(2, "0")}`, x: i < 5 ? -11 : 11, z: -28 + (i % 5) * 14,
}));
/** The sales streets: the outer frame and the inner square round the lake; the team districts' plots lie between them (world/land.ts). */
const TOP = -110, BOTTOM = 110, OUTER = 132, INNER = 66;
function salesStreets(): Road[] {
  const streets: Road[] = [];
  for (const x of [-OUTER, -INNER, INNER, OUTER]) streets.push([x, TOP, x, BOTTOM]);
  for (const z of [TOP, -INNER, INNER, BOTTOM]) streets.push([-OUTER, z, OUTER, z]);
  return streets;
}
export function generateSalesWorld(): WorldData {
  const random = rng(20261001), placements: Placement[] = [], streets = salesStreets();
  const add = (kind: Placement["kind"], x: number, z: number, width = 0, scale = 1, extra: Partial<Placement> = {}) =>
    placements.push({ kind, x, z, width, scale, variant: Math.floor(random() * 12), rotation: 0, ...extra });
  // A footbridge to the central campus, independent of the road graph. The land round the lake is the team
  // districts' (world/land.ts): no houses of the town's own, only what the operators build.
  const surfaces: WorldData["surfaces"] = [{ kind: "plaza", x: 0, z: 0, angle: 0, length: 74, width: 36 }];
  for (let i = 0; i < 72; i++) {
    const a = i * Math.PI * 2 / 72, x = Math.cos(a) * 54, z = Math.sin(a) * 54;
    if (Math.abs(x) < 5 && z > 0) continue;
    add(i % 4 ? "tree-round" : "lamp", x, z, 0, i % 4 ? 1.5 : 1);
  }
  for (const p of SALES_CENTERS) surfaces.push({ kind: "plaza", ...p, angle: 0, width: 11, length: 11 });
  // The boulevard from the lake's south shore to the station at the town's edge: a walk between two rows of trees.
  for (const [z0, z1] of [[57, INNER - 1.5], [INNER + 1.5, BOTTOM - 1.5]]) surfaces.push({ kind: "walk", x: 0, z: (z0 + z1) / 2, angle: 0, length: z1 - z0, width: 3.2 });
  for (let z = 61; z <= 106; z += 7.5) if (Math.abs(z - INNER) > 3.5) for (const x of [-3.4, 3.4]) add("tree-round", x, z, 0, 1.15);
  const paths = [
    [{ x: -OUTER, z: TOP }, { x: OUTER, z: TOP }, { x: OUTER, z: BOTTOM }, { x: -OUTER, z: BOTTOM }],
    [{ x: -INNER, z: -INNER }, { x: INNER, z: -INNER }, { x: INNER, z: INNER }, { x: -INNER, z: INNER }],
  ];
  const world: WorldData = {
    spec: { ...WORLD_V1, name: "sales", horizon: 190, seed: 20261001, lagoon: 46, promenade: 50, quay: 46, bank: 47, districts: [], mainland: [], roadRings: [66, 132], islet: 4, districtScale: 1 },
    districts: [], radius: 190,
    land: { annuli: [], islets: [], rectangle: { width: 284, depth: 244, lake: 46 }, platforms: [{ x: 0, z: 0, width: 38, depth: 76 }, { x: 0, z: 47, width: 4, depth: 20 }] },
    water: { annuli: [{ inner: 0, outer: 46 }] },
    roads: { rings: [], streets, bridges: [], crosswalks: [], parking: [] },
    placements, parks: [], complexes: [], alleys: [], surfaces,
    walks: [Array.from({ length: 65 }, (_, i) => ({ x: Math.cos(i / 64 * Math.PI * 2) * 50, z: Math.sin(i / 64 * Math.PI * 2) * 50 }))],
    plots: [], sites: [], questSpots: [], routes: paths.map(points => ({ route: makeRoute(points.map(p => ({ points: [p] }))), cars: 8, speed: 4 })),
    railway: RAIL_LINES.sales,
  };
  // The station's street, car park and park, between the bottom street and the hills (world/stationSquare.ts).
  addStationSquare(world);
  return world;
}
