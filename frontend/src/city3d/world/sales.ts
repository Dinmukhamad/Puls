/** Orthogonal department city. Pure data; catalogue assets are shared with Support. */
import { WORLD_V1 } from "./worldSpec";
import { rng } from "./generate";
import { RAIL_LINES } from "./railway";
import { addStationSquare } from "./stationSquare";
import { LAKE_LINES } from "./land";
import type { Placement, Road, WorldData } from "./types";

export const SALES_CENTERS = Array.from({ length: 10 }, (_, i) => ({
  id: `sales-resource-${String(i + 1).padStart(2, "0")}`, x: i < 5 ? -11 : 11, z: -28 + (i % 5) * 14,
}));
/**
 * Where the town's streets ran: the inner square round the lake and the outer frame. The team districts' land now
 * covers them and the two bands that grew round them (world/land.ts LAKE_LINES), and the districts' operators lay their
 * own roads; only the station's street is left. The flat land reaches a little past the outer band, where the hills
 * begin; the boulevard from the lake meets the station's forecourt at the edge (world/railway.ts).
 */
const WIDTH = 2 * (LAKE_LINES.edgeX + 1), DEPTH = 2 * (LAKE_LINES.edgeZ + 2), FORECOURT = LAKE_LINES.edgeZ - 8;
/** Radius of everything that is drawn: the corners of the flat land. */
export const SALES_RADIUS = Math.round(Math.hypot(WIDTH, DEPTH) / 2);
export function generateSalesWorld(): WorldData {
  const random = rng(20261001), placements: Placement[] = [], streets: Road[] = [];
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
  // The boulevard's two rows of trees, from the lake's south shore to the station at the town's edge.
  for (let z = 61; z <= FORECOURT - 6; z += 7.5) for (const x of [-3.4, 3.4]) add("tree-round", x, z, 0, 1.15);
  const world: WorldData = {
    spec: { ...WORLD_V1, name: "sales", horizon: SALES_RADIUS, seed: 20261001, lagoon: 46, promenade: 50, quay: 46, bank: 47, districts: [], mainland: [], roadRings: [66, 132], islet: 4, districtScale: 1 },
    districts: [], radius: SALES_RADIUS,
    land: { annuli: [], islets: [], rectangle: { width: WIDTH, depth: DEPTH, lake: 46 }, platforms: [{ x: 0, z: 0, width: 38, depth: 76 }, { x: 0, z: 47, width: 4, depth: 20 }] },
    water: { annuli: [{ inner: 0, outer: 46 }] },
    roads: { rings: [], streets, bridges: [], crosswalks: [], parking: [] },
    placements, parks: [], complexes: [], alleys: [], surfaces,
    walks: [Array.from({ length: 65 }, (_, i) => ({ x: Math.cos(i / 64 * Math.PI * 2) * 50, z: Math.sin(i / 64 * Math.PI * 2) * 50 }))],
    plots: [], questSpots: [], routes: [],
    railway: RAIL_LINES.sales,
  };
  // The station's street, car park and park, between the town's edge and the hills (world/stationSquare.ts). The
  // boulevard's walk comes after it: the square clears what lies within a surface's own length of it, and the walk
  // runs between its car park and its park right up to the forecourt.
  addStationSquare(world);
  world.surfaces.push({ kind: "walk", x: 0, z: (57 + FORECOURT) / 2, angle: 0, length: FORECOURT - 57, width: 3.2 });
  return world;
}
