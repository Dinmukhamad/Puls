/**
 * The two cities as data (TZ §4.1); world/generate.ts turns either into WorldData.
 * - WORLD_V1 is the current training city of `pages/city/cityLayout.ts`, unit for unit.
 * - WORLD_X4 is the target city: ten district islands on two lagoon rings (the five current districts
 *   and five reserved "Скоро" islands on the cross streets between them), a larger lagoon, and a
 *   mainland built up in bands (houses, blocks, towers, suburbs) with an industrial quarter and a port,
 *   out to a horizon twice as far. It has about four times the area and the buildings of v1.
 */
import type { WorldSpec, Zone } from "./types";

/** A sector where one zone takes over the mainland rows whose radius is in [from, to). */
export interface ZoneSector { zone: Zone; angleDeg: number; halfWidth: number; from: number; to: number }
/** A car park `radius` out in direction `angleDeg`; its length runs along the ring. Lots deeper than 6 are truck yards. */
export interface ParkingSpec { angleDeg: number; radius: number; length: number; depth: number }
/**
 * Generator settings beyond the shared WorldSpec contract (world/types.ts). All optional: a plain WorldSpec
 * gets no zone sectors, no car parks, and avenues only between neighbouring inner-ring districts.
 */
export interface CitySpec extends WorldSpec {
  sectors?: ZoneSector[];
  parking?: ParkingSpec[];
  /** From this ring road outwards, avenues also run along every district direction (x4). */
  districtAvenuesFrom?: number;
}

/** Direction of a point from the plaza, degrees: the old layout placed the districts by points. */
const deg = (x: number, z: number) => Math.atan2(z, x) * 180 / Math.PI;
/** Direction halfway between two directions: the cross street between two neighbouring islands. */
const between = (a: number, b: number) => { const k = Math.PI / 180; return deg(Math.cos(a * k) + Math.cos(b * k), Math.sin(a * k) + Math.sin(b * k)); };

// Neighbours are at least 70° apart, so every cross-street bridge passes half a unit clear of the islands.
const ACADEMY = deg(-15.79, .51), DRIVER = deg(-6.5, -16.5), CRM = deg(14, -9), DISPATCH = deg(12.53, 9.63), OKTELL = deg(-4.85, 15.04);
/** The five server districts on the inner lagoon ring, counter-clockwise; the generator keeps this order. */
const DISTRICTS: WorldSpec["districts"] = [
  { id: "academy", angleDeg: ACADEMY, ring: 0, color: "#5b8def", soon: false },
  { id: "driver", angleDeg: DRIVER, ring: 0, color: "#f0a23a", soon: false },
  { id: "crm", angleDeg: CRM, ring: 0, color: "#7b5cff", soon: false },
  { id: "dispatch", angleDeg: DISPATCH, ring: 0, color: "#35b6a6", soon: true },
  { id: "oktell", angleDeg: OKTELL, ring: 0, color: "#e86aa6", soon: true },
];

export const WORLD_V1: CitySpec = {
  name: "v1",
  // The old layout drew from three streams: lots 33, trees 7, parked cars 11 (see generate.ts `stream`).
  seed: 33,
  plaza: 4.6, plazaIslet: 6.5, islet: 7.2, districtScale: 1.75,
  lagoonRings: [{ radius: 15.8 }],
  districts: DISTRICTS,
  lagoon: 23.3,
  roadRings: [25, 62],
  promenade: 34.1, quay: 35.2, bank: 43.6,
  mainland: ([[47.6, "houses", 3.5], [51.6, "houses", 3.5], [55.6, "houses", 3.6], [66.6, "blocks", 4], [71, "blocks", 4], [75.4, "blocks", 4.2], [79.8, "blocks", 4.2], [88, "blocks", 4.6], [93, "blocks", 4.8], [99, "towers", 5.4], [108, "towers", 6.5], [118, "towers", 7.5], [129, "towers", 8.5]] as const)
    .map(([radius, zone, step]) => ({ radius, zone, step })),
  horizon: 150,
  skylineAngle: 1.2,
  // The depot's industrial quarter.
  sectors: [{ zone: "industry", angleDeg: DRIVER, halfWidth: .4, from: 0, to: 90 }],
  // Two car parks on the green belt behind the depot and the CRM centre, a truck yard on the mainland behind the depot.
  parking: [{ angleDeg: DRIVER, radius: 30.2, length: 10, depth: 5.2 }, { angleDeg: CRM, radius: 30.2, length: 7.8, depth: 5.2 }, { angleDeg: DRIVER, radius: 51.6, length: 14.3, depth: 9 }],
};

/** Rows every `gap` units from `from`, all of one zone and lot size. */
const rows = (zone: Zone, step: number, from: number, count: number, gap: number) => Array.from({ length: count }, (_, i) => ({ radius: from + i * gap, zone, step }));

/*
 * X4 keeps v1's proportions around every road: the green belt (ring road → promenade 9.1, quay +1.1,
 * canal 8.4 wide), rows starting 4.6 past a ring road and ending 6.4 before the next, and tree rows 2.6
 * either side of the mainland ring roads. Ring 1 islands sit on the cross streets 30 out: 19.3 from the
 * ring 0 islands (15.4 needed for water between them) and 3.3 inside the lagoon shore.
 */
export const WORLD_X4: CitySpec = {
  name: "x4",
  seed: 2026,
  plaza: 4.6, plazaIslet: 6.5, islet: 7.2, districtScale: 1.75,
  lagoonRings: [{ radius: 15.8 }, { radius: 30 }],
  districts: [
    ...DISTRICTS,
    { id: "future-1", angleDeg: between(ACADEMY, DRIVER), ring: 1, color: "#8f9bb3", soon: true },
    { id: "future-2", angleDeg: between(DRIVER, CRM), ring: 1, color: "#c9a36b", soon: true },
    { id: "future-3", angleDeg: between(CRM, DISPATCH), ring: 1, color: "#6fa8c7", soon: true },
    { id: "future-4", angleDeg: between(DISPATCH, OKTELL), ring: 1, color: "#86b07a", soon: true },
    { id: "future-5", angleDeg: between(OKTELL, ACADEMY), ring: 1, color: "#b98fb8", soon: true },
  ],
  lagoon: 40.5,
  roadRings: [42.2, 79.2, 118, 170, 226],
  promenade: 51.3, quay: 52.4, bank: 60.8,
  mainland: [
    // Detailed houses along the canal (industry and the port take their sectors).
    ...rows("houses", 3.5, 64.8, 2, 4), { radius: 72.8, zone: "houses", step: 3.6 },
    // Mid-rise blocks between the first two mainland ring roads.
    ...rows("blocks", 4, 83.8, 2, 4.4), ...rows("blocks", 4.2, 92.6, 2, 4.4), { radius: 101.6, zone: "blocks", step: 4.4 }, { radius: 106.4, zone: "blocks", step: 4.6 }, { radius: 111.4, zone: "blocks", step: 4.8 },
    // Towers (dense in the skyline behind the island) alternating with blocks, so no sector thins out.
    { radius: 124.6, zone: "towers", step: 5.4 }, { radius: 131.6, zone: "blocks", step: 4.8 }, { radius: 139, zone: "towers", step: 6.5 },
    { radius: 146.5, zone: "towers", step: 7 }, { radius: 154.5, zone: "towers", step: 7.5 }, { radius: 162.4, zone: "blocks", step: 5 },
    // Suburbs: small houses with gardens out to the fog.
    ...rows("suburb", 7, 176, 7, 7), ...rows("suburb", 7, 232.6, 8, 7),
  ],
  horizon: 300,
  skylineAngle: 1.2,
  sectors: [
    { zone: "industry", angleDeg: DRIVER, halfWidth: .5, from: 0, to: 118 },
    // Cranes, warehouses and containers from the canal bank inland, in front of the default view.
    { zone: "port", angleDeg: CRM, halfWidth: .6, from: 0, to: 118 },
  ],
  parking: [
    { angleDeg: DRIVER, radius: 47.4, length: 10, depth: 5.2 }, { angleDeg: CRM, radius: 47.4, length: 7.8, depth: 5.2 },
    { angleDeg: DRIVER, radius: 68.8, length: 14.3, depth: 9 }, { angleDeg: CRM, radius: 68.8, length: 14.3, depth: 9 },
    { angleDeg: 90, radius: 99.2, length: 12, depth: 5.2 }, { angleDeg: 195.7, radius: 99.2, length: 12, depth: 5.2 },
  ],
  districtAvenuesFrom: 1,
};
