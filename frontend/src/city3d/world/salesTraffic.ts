/**
 * The lake city's public traffic stays in its unbuildable central reservation: a road round the shore and
 * two independent boat courses beside the campus. District cells begin at least 58 units from the origin.
 * The boat courses are lake routes already checked against its platforms, not canal loops to re-plan.
 */
import type { Point, Route, RoutePlan } from "./types";

/** Between the lake's pavement (46…48), the walker loop (50) and the tree row (54). */
export const SALES_ROAD_RADIUS = 51.5;
const STEP = .25, TAU = 2 * Math.PI;

function closedRoute(points: Point[]): Route {
  const distance = [0];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    distance.push(distance[i] + Math.hypot(q.x - p.x, q.z - p.z));
  }
  return { points, distance, length: distance[points.length], hidden: points.map(() => false) };
}

/** A generous straight cruise on each side of the campus, with rounded turns far from either shore. */
function lakeCourse(x: number): Route {
  const radius = 2, z0 = -20, z1 = 20, points: Point[] = [];
  const line = (a: Point, b: Point) => {
    const count = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP);
    for (let i = 0; i < count; i++) points.push({ x: a.x + (b.x - a.x) * i / count, z: a.z + (b.z - a.z) * i / count });
  };
  const cap = (z: number, from: number) => {
    const count = Math.ceil(Math.PI * radius / STEP);
    for (let i = 0; i < count; i++) {
      const angle = from + Math.PI * i / count;
      points.push({ x: x + radius * Math.cos(angle), z: z + radius * Math.sin(angle) });
    }
  };
  line({ x: x + radius, z: z0 }, { x: x + radius, z: z1 }); cap(z1, 0);
  line({ x: x - radius, z: z1 }, { x: x - radius, z: z0 }); cap(z0, Math.PI);
  return closedRoute(points);
}

export function createSalesTrafficRoutes(): RoutePlan[] {
  const radius = SALES_ROAD_RADIUS - .5, count = Math.ceil(TAU * radius / STEP);
  const road = closedRoute(Array.from({ length: count }, (_, i) => ({ x: radius * Math.cos(TAU * i / count), z: radius * Math.sin(TAU * i / count) })));
  return [
    // The traffic planner mirrors this inner lane about SALES_ROAD_RADIUS for the opposite direction.
    { route: road, cars: 19, speed: 3.6 },
    { route: lakeCourse(-33), cars: 3, speed: 1.2, boats: true },
    { route: lakeCourse(33), cars: 3, speed: 1.2, boats: true },
  ];
}
