/**
 * The collection's traffic uses the city's existing roads. Tall watercraft cannot pass through the canal's
 * stone arches, so each open sector gets a closed two-way course, with round turns before either bridge.
 * Pure world data: no renderer, downloaded assets or browser state are needed to plan or check the routes.
 */
import type { Point, Road, Route, RoutePlan, WorldData } from "../world/types";

export const ROAD_MODEL_IDS = [
  "sedan", "hatchback", "crossover", "suv", "coupe", "estate", "cabriolet", "pickup", "minivan", "city-ev",
  "box-truck", "tractor-trailer", "dump-truck", "flatbed-truck",
] as const;
export const MARINE_MODEL_IDS = ["speedboat", "fishing-boat", "cabin-boat", "motor-yacht", "sailing-yacht", "sport-yacht"] as const;

/** Largest watercraft footprint after the traffic adapter scales the collection to the city. */
export const MAX_MARINE_LENGTH = 4.9, MAX_MARINE_WIDTH = 1.3;
const HULL_REACH = Math.hypot(MAX_MARINE_LENGTH, MAX_MARINE_WIDTH) / 2;
/** Rails extend 1.39 units from the canal bridge's centre line (render/terrain.ts canalBridge). */
const BRIDGE_HALF = 1.4, SHORE_MARGIN = .3, BRIDGE_MARGIN = .4, STEP = .35, TAU = 2 * Math.PI;
const polar = (radius: number, angle: number): Point => ({ x: radius * Math.cos(angle), z: radius * Math.sin(angle) });

/** A fresh Fisher–Yates permutation; callers can inject a seeded generator for repeatable worlds. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.max(0, Math.min(i, Math.floor(random() * (i + 1))));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** A closed polyline, with no repeated closing point or zero-length segments. */
function routeOf(points: Point[]): Route {
  const distance = [0];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    distance.push(distance[i] + Math.hypot(q.x - p.x, q.z - p.z));
  }
  return { points, distance, length: distance[points.length], hidden: points.map(() => false) };
}

/** Concentric arcs joined by semicircles. Both arcs and caps are tangent where they meet. */
function sectorRoute(radius: number, turn: number, from: number, to: number): Route {
  const points: Point[] = [];
  const add = (p: Point) => {
    const previous = points[points.length - 1];
    if (!previous || Math.hypot(p.x - previous.x, p.z - previous.z) > 1e-7) points.push(p);
  };
  const arc = (r: number, a: number, b: number) => {
    const steps = Math.ceil(Math.abs(b - a) * r / STEP);
    for (let i = 0; i <= steps; i++) add(polar(r, a + (b - a) * i / steps));
  };
  const cap = (angle: number, a: number, b: number) => {
    const u = polar(1, angle), tangent = { x: -u.z, z: u.x }, steps = Math.ceil(Math.abs(b - a) * turn / STEP);
    for (let i = 0; i <= steps; i++) {
      const t = a + (b - a) * i / steps;
      add({ x: radius * u.x + turn * (Math.cos(t) * u.x + Math.sin(t) * tangent.x),
        z: radius * u.z + turn * (Math.cos(t) * u.z + Math.sin(t) * tangent.z) });
    }
  };
  arc(radius - turn, from, to); cap(to, Math.PI, 0);
  arc(radius + turn, to, from); cap(from, 0, -Math.PI);
  // The last cap ends exactly at the first arc's start.
  points.pop();
  return routeOf(points);
}

function segmentDistance(p: Point, [ax, az, bx, bz]: Road) {
  const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / length2)) : 0;
  return Math.hypot(p.x - ax - dx * t, p.z - az - dz * t);
}

/**
 * Circular roads use both lanes, with the reverse lane mirrored about the road centre. Existing boat slots are spread over bridge-free
 * canal sectors, with enough slots for all six collection craft. Worlds with no boat plan (e.g. Sales), a
 * narrow canal or no matching water surface get no watercraft. Input world/route data is never changed.
 */
export function createTransportPlans(world: WorldData, random: () => number = Math.random): RoutePlan[] {
  const roads = world.routes.filter(plan => !plan.boats).flatMap(plan => {
    const ring = world.roads.rings.find(radius => plan.route.points.every(p => Math.abs(Math.hypot(p.x, p.z) - radius) < .9));
    if (ring === undefined || plan.cars < 8 || plan.route.hidden.some(Boolean)) return [{ ...plan }];
    const reverse = routeOf([...plan.route.points].reverse().map(p => {
      const r = Math.hypot(p.x, p.z), scale = (2 * ring - r) / r;
      return { x: p.x * scale, z: p.z * scale };
    }));
    return [{ ...plan, cars: Math.ceil(plan.cars / 2) }, { ...plan, route: reverse, cars: Math.floor(plan.cars / 2) }];
  });
  const boats = world.routes.filter(plan => plan.boats), { quay, bank } = world.spec;
  if (!boats.length || bank - quay < 7 || !world.water.annuli.some(a => a.inner <= quay && a.outer >= bank)) return roads;

  const radius = (quay + bank) / 2, turn = Math.min(1.2, (bank - quay) / 2 - HULL_REACH - SHORE_MARGIN);
  if (turn < .6) return roads;
  const inner = radius - turn, bridgeClearance = BRIDGE_HALF + HULL_REACH + BRIDGE_MARGIN;
  const bridges = world.roads.bridges.filter(bridge => bridge.canal).map(bridge => bridge.road);
  // The caps protrude `turn` beyond their arc's endpoints towards a bridge.
  const inset = Math.asin(Math.min(1, (bridgeClearance + turn + STEP * 2) / inner));
  const angles = [...new Set(bridges.map(([ax, az, bx, bz]) => {
    const angle = Math.atan2(az + bz, ax + bx);
    return (angle + TAU) % TAU;
  }))].sort((a, b) => a - b);
  const routes: Route[] = [];
  if (!angles.length) {
    const count = Math.ceil(TAU * radius / STEP);
    const points = Array.from({ length: count }, (_, i) => polar(radius, i * TAU / count));
    routes.push(routeOf(points));
  } else {
    angles.forEach((angle, i) => {
      const next = angles[(i + 1) % angles.length] + (i === angles.length - 1 ? TAU : 0);
      const from = angle + inset, to = next - inset;
      // Keep a straight cruising stretch of at least two hull lengths between the turns.
      if ((to - from) * inner < 2 * MAX_MARINE_LENGTH) return;
      const route = sectorRoute(radius, turn, from, to);
      // This also rejects unusual non-radial bridges or future layouts whose sector angles are insufficient.
      // Segment interpolation can move at most STEP from a checked point, so keep that much extra margin.
      if (route.points.every(p => bridges.every(road => segmentDistance(p, road) >= bridgeClearance + STEP))) routes.push(route);
    });
  }
  if (!routes.length) return roads;

  const count = Math.max(MARINE_MODEL_IDS.length, boats.reduce((sum, plan) => sum + plan.cars, 0));
  const ordered = shuffled(routes, random), speed = boats[0].speed;
  return [...roads, ...ordered.map((route, i) => ({ route, boats: true, speed, cars: Math.floor(count / ordered.length) + (i < count % ordered.length ? 1 : 0) })).filter(plan => plan.cars > 0)];
}
