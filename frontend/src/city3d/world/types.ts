/**
 * Plain data describing the city, with no three.js (TZ §4). `generate(spec)` turns a WorldSpec into
 * WorldData; the renderer and systems only read WorldData. Units: 1 = one road lane.
 */

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
  name: "v1" | "x4";
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
 * - tree-cone / tree-round: `scale` = tree size; lamp: street lamp; car-parked: `rotation` faces the aisle.
 */
export type PlacementKind = "house" | "office" | "industry" | "block" | "tower" | "port" | "tree-cone" | "tree-round" | "lamp" | "car-parked";

/**
 * One copy of a catalogue model. `variant` is a seeded integer ≥ 0 that picks a model within the kind
 * (the catalogue takes it modulo its list length); `width` is the footprint to fit (0 = natural size).
 */
export interface Placement { kind: PlacementKind; variant: number; x: number; z: number; rotation: number; scale: number; width: number }

export interface Route { points: Point[]; hidden: boolean[]; distance: number[]; length: number }
export interface RoutePlan { route: Route; cars: number; speed: number; boats?: boolean }

export interface ParkingLot { x: number; z: number; angle: number; length: number; depth: number; stalls: (Point & { rotation: number })[] }

export interface WorldData {
  spec: WorldSpec;
  districts: { id: string; x: number; z: number; color: string; soon: boolean }[];
  /** Land: annuli (ring land around the lagoon, mainland) and round islets (plaza, districts). */
  land: { annuli: { inner: number; outer: number }[]; islets: { x: number; z: number; r: number }[] };
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
  routes: RoutePlan[];
  /** Radius of everything that is drawn. */
  radius: number;
}
