/**
 * The island city as the app opens it (city3d/index.ts): generated from its spec, the full map's mainland emptied
 * for the team districts (world/land.ts clearMainland), then the railway's line and the station's square laid out
 * (world/railway.ts, world/stationSquare.ts). The lake city comes ready from world/sales.ts. Tests and
 * scripts/city-land.mjs open the cities the same way, so the plots they see are the plots of the app.
 */
import { generateWorld } from "./generate";
import { clearMainland } from "./land";
import { clearRailway } from "./railway";
import { addStationSquare } from "./stationSquare";
import type { WorldData, WorldSpec } from "./types";

export function islandWorld(spec: WorldSpec): WorldData {
  const world = generateWorld(spec);
  if (spec.name === "x4") clearMainland(world);
  if (world.railway) { clearRailway(world, world.railway); addStationSquare(world); }
  return world;
}
