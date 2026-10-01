/**
 * Plain data describing the city, with no three.js (TZ §4). `generate(spec)` turns a WorldSpec into
 * WorldData; the renderer and systems only read WorldData. Units: 1 = one road lane.
 */
import type { RailLine } from "./railway";
import type { Plot } from "./plots";
import type { Site } from "./sites";

export interface Point { x: number; z: number }
/** A straight road or bridge centre line: [ax, az, bx, bz]. */
export type Road = readonly [number, number, number, number];

export type Zone = "houses" | "blocks" | "towers" | "industry" | "port" | "suburb";

export interface DistrictSlot {
  /** One of the five server districts, or `future-N` for an island reserved for later ("Скоро"). */
  id: string;
  /** Direction from the plaza, degrees, 0 = +x, counter-clockwise towards +z. */
  angleDeg: number;
  /** Index into WorldSpec.lagoonRings. */
  ring: number;
  color: string;
  soon: boolean;
}

export interface WorldSpec {
  name: "v1" | "x4" | "sales";
  seed: number;
  /** Radius of the plaza disc and of the plaza islet. */
  plaza: number; plazaIslet: number;
  /** Island radius and landmark scale (landmarks are modelled in units of about 5.7 × 5.3). */
  islet: number; districtScale: number;
  /** Circles the district islands stand on. */
  lagoonRings: { radius: number }[];
  districts: DistrictSlot[];
  /** Outer shore of the lagoon; the inner ring road runs just outside it. */
  lagoon: number;
  /** Centre lines of the ring roads, inside out (the first is the inner ring road around the lagoon). */
  roadRings: number[];
  /** Promenade on the quay, quay edge and far bank of the canal. */
  promenade: number; quay: number; bank: number;
  /** Mainland building rows around the canal. */
  mainland: { radius: number; zone: Zone; step: number }[];
  /** Avenues run on into the fog up to here; also the edge of the ground. */
  horizon: number;
  /** Tall towers gather around this direction (radians) so a skyline shows behind the island. */
  skylineAngle: number;
}

/**
 * What a placement is. The renderer's catalogue maps each kind to models:
 * - house / office / industry: Kenney models fitted to `width` (detailed rows near the canal);
 * - block / tower: plain mid-rise and high-rise blocks, `scale` = height multiplier (0.9…1.1);
 * - port: cranes, warehouses, containers (x4 world);
 * - tree-cone / tree-round / tree-birch / tree-oak: `scale` = tree size; lamp: street lamp; car-parked: `rotation` faces the aisle;
 * - section: one section of a residential complex, `width` along its facade, `depth` across, `variant` its floors class;
 * - cottage: a detached house of the garden suburb, `variant` 0 or 1 for one or two floors, sized like a section;
 * - roof: a gabled roof on a townhouse, `width` along the ridge's gable front, `depth` along the ridge, `scale` its height, `lift` the eaves;
 * - glass-tower: an office building or podium of a business quarter, sized like a section (OFFICE_FLOORS classes);
 * - courtyard furniture (bench, slide, swings, climber, sandbox, goal, hoop, gazebo, flowerbed, bush, hedge, planter): `rotation` turns
 *   its front (+z) where it faces; `width` is its footprint for the walkers to keep clear of.
 */
export type PlacementKind = "house" | "office" | "industry" | "block" | "tower" | "port" | "tree-cone" | "tree-round" | "tree-birch" | "tree-oak" | "lamp" | "car-parked"
  | "section" | "bench" | "slide" | "swings" | "climber" | "sandbox" | "goal" | "hoop" | "gazebo" | "flowerbed" | "bush" | "hedge" | "planter" | "glass-tower" | "fountain" | "roof" | "cottage";

/**
 * One copy of a catalogue model. `variant` is a seeded integer ≥ 0 that picks a model within the kind
 * (the catalogue takes it modulo its list length); `width` is the footprint to fit (0 = natural size).
 */
export interface Placement {
  kind: PlacementKind; variant: number; x: number; z: number; rotation: number; scale: number; width: number;
  /** Sections: the depth of the building across its facade. */
  depth?: number;
  /** Picks the model's shade, so every section of a complex shares one colour (otherwise copies alternate). */
  tint?: number;
  /** Raised this far over the ground: the floors over an arch, towers on their podium, trees on the hills. */
  lift?: number;
  /** The residential or business quarter (index in WorldData.complexes) this copy belongs to. */
  site?: number;
}

/** What a courtyard patch is paved with: walks, lawns, playground rubber, sand, sports courts, their lines, driveways. */
export type SurfaceKind = "walk" | "lawn" | "plaza" | "play" | "play-blue" | "sand" | "court" | "court-orange" | "line" | "asphalt" | "slab";
/** A flat patch on the ground: `length` along the direction `angle` (atan2(dx, dz)), `width` across; a disc when `round`. */
export interface Surface { kind: SurfaceKind; x: number; z: number; angle: number; length: number; width: number; round?: boolean; site?: number }
/** A residential complex: its buildings stand round a courtyard of `length` × `depth`, the length along `angle`. */
export interface Complex { x: number; z: number; angle: number; length: number; depth: number; business?: boolean }

export interface Route { points: Point[]; hidden: boolean[]; distance: number[]; length: number }
export interface RoutePlan { route: Route; cars: number; speed: number; boats?: boolean }

export interface ParkingLot { x: number; z: number; angle: number; length: number; depth: number; stalls: (Point & { rotation: number })[] }

export interface WorldData {
  spec: WorldSpec;
  /** The railway to the other city: the terminus at the town's edge and the line into the hills (world/railway.ts). */
  railway?: RailLine;
  districts: { id: string; x: number; z: number; color: string; soon: boolean }[];
  /** Land: annuli (ring land around the lagoon, mainland) and round islets (plaza, districts). */
  land: { annuli: { inner: number; outer: number }[]; islets: { x: number; z: number; r: number }[];
    rectangle?: { width: number; depth: number; lake: number };
    platforms?: { x: number; z: number; width: number; depth: number }[] };
  /** Water surfaces: lagoon annulus and canal annulus; the sea beyond is ground-coloured land in v1. */
  water: { annuli: { inner: number; outer: number }[] };
  roads: {
    /** Ring road centre lines. */
    rings: number[];
    /** Straight streets on land (spokes, cross streets, avenues). */
    streets: Road[];
    /** Parts of streets over water, carried by bridges; `canal` marks the arch bridges over the canal. */
    bridges: { road: Road; canal: boolean }[];
    crosswalks: (Point & { angle: number })[];
    parking: ParkingLot[];
  };
  /** Every static copy: buildings, trees, lamps, parked cars. */
  placements: Placement[];
  /** Parks on the mainland (Points), used for grass patches. */
  parks: Point[];
  /** Residential complexes and business quarters, the patches of their yards and plazas, and closed loops for walkers. */
  complexes: Complex[];
  /** Ring alleys between the bands: arcs of `radius` from `from` to `to` radians, clear of the avenues. */
  alleys: { radius: number; from: number; to: number }[];
  surfaces: Surface[];
  walks: Point[][];
  /** The operator's building plots (world/plots.ts); what stands on them comes from the server. */
  plots: Plot[];
  /** The group city's quarters (world/sites.ts), drawn by the stage the server reports. */
  sites: Site[];
  /** Where the daily situations of the map wait, one per slot: the depot's taxi, a car at the CRM centre, the guide. */
  questSpots: Point[];
  routes: RoutePlan[];
  /** Radius of everything that is drawn. */
  radius: number;
}
