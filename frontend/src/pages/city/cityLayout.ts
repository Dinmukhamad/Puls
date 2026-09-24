import type { DistrictId } from "../../api/city";

/*
 * Plan of the training city, in scene units, without any three.js: where the roads, bridges, lots,
 * trees, lamps and parking go, and the lanes cars follow. The scene only turns this plan into meshes.
 *
 * The city is round: a central plaza, a ring road through the districts, a green belt with a
 * promenade on the quay, a canal, and the mainland with its own ring road. Avenues leave the island
 * over bridges between neighbouring districts.
 */

export interface CityLocation { id: DistrictId; x: number; z: number; color: string; soon?: boolean }
export interface Point { x: number; z: number }
export type Road = readonly [number, number, number, number];

export const CITY_LOCATIONS: CityLocation[] = [
  { id: "academy", x: -17, z: 2, color: "#5b8def" },
  { id: "driver", x: -6.5, z: -16.5, color: "#f0a23a" },
  { id: "crm", x: 14, z: -9, color: "#7b5cff" },
  { id: "dispatch", x: 14.5, z: 12.5, color: "#35b6a6", soon: true },
  { id: "oktell", x: -5.5, z: 17.5, color: "#e86aa6", soon: true },
];
/** District buildings are drawn in small units and scaled up to stand above the ordinary city blocks. */
export const DISTRICT_SCALE = 2.3;
export const PLAZA = 4.6;
/** Centre line of the inner ring road; every road is two lanes, one unit each. */
export const RING_ROAD = 25;
export const ROAD_HALF = 1;
/** Promenade along the quay, the island edge and the far bank of the canal. */
export const PROMENADE = 34.1, QUAY = 35.2, BANK = 43.6;
export const OUTER_RING = 62;
/** Avenues run on into the fog up to here. */
export const HORIZON = 150;
/** Cars keep to the right, half a unit from the centre line. */
export const LANE = .5;
/** Tall towers gather on the far side of the default view, so the skyline shows behind the island. */
export const SKYLINE_ANGLE = 1.2;

export const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const polar = (r: number, a: number): Point => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
const angleOf = (d: Point) => Math.atan2(d.z, d.x);
/** Smallest difference between two angles, 0…π. */
export function angularDistance(a: number, b: number) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

export function segmentDistance(x: number, z: number, [ax, az, bx, bz]: Road) {
  const dx = bx - ax, dz = bz - az, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
export const nearRoad = (x: number, z: number, roads: readonly Road[], pad: number) => roads.some(road => segmentDistance(x, z, road) < pad);

/** Directions between neighbouring districts: cross streets inside the ring that go on as avenues over the canal. */
export function avenueAngles() {
  return CITY_LOCATIONS.map((a, i) => { const b = CITY_LOCATIONS[(i + 1) % CITY_LOCATIONS.length]; return Math.atan2((a.z + b.z) / 2, (a.x + b.x) / 2); });
}
/** Every street that starts at the plaza, in the direction it leaves it. */
export function radialAngles() { return [...CITY_LOCATIONS.map(angleOf), ...avenueAngles()]; }

/** Streets inside the ring road: a spoke to every district and a cross street between neighbours. */
export function innerRoads(): Road[] {
  const edge = DISTRICT_SCALE * 2.7, roads: Road[] = [];
  for (const d of CITY_LOCATIONS) {
    const r = Math.hypot(d.x, d.z), ux = d.x / r, uz = d.z / r;
    roads.push([ux * PLAZA, uz * PLAZA, ux * (r - edge), uz * (r - edge)], [ux * (r + edge), uz * (r + edge), ux * 24, uz * 24]);
  }
  for (const a of avenueAngles()) roads.push([Math.cos(a) * PLAZA, Math.sin(a) * PLAZA, Math.cos(a) * 24, Math.sin(a) * 24]);
  return roads;
}
/** Avenues from the ring road over the bridges to the horizon. */
export function avenues(): Road[] { return avenueAngles().map(a => [Math.cos(a) * 26, Math.sin(a) * 26, Math.cos(a) * HORIZON, Math.sin(a) * HORIZON] as const); }
const clearOfAvenues = (p: Point, pad: number) => { const r = Math.hypot(p.x, p.z), a = Math.atan2(p.z, p.x); return avenueAngles().every(b => Math.cos(a - b) <= 0 || r * Math.abs(Math.sin(a - b)) >= pad); };

export interface Lot { x: number; z: number; r: number; rotation: number; roll: number; pick: number; size: number }
/** Ordinary blocks between the districts inside the ring road. */
export function islandLots(): Lot[] {
  const roads = innerRoads(), random = rng(21), lots: Lot[] = [];
  for (let gx = -24; gx <= 24; gx += 2.9) for (let gz = -24; gz <= 24; gz += 2.9) {
    const x = gx + (random() - .5) * 1.1, z = gz + (random() - .5) * 1.1, r = Math.hypot(x, z);
    const lot = { x, z, r, rotation: Math.atan2(x, z) + (random() < .5 ? 0 : Math.PI / 2), roll: random(), pick: random(), size: random() };
    if (r < 6.6 || r > 22.6 || nearRoad(x, z, roads, 1.8) || CITY_LOCATIONS.some(d => Math.hypot(d.x - x, d.z - z) < DISTRICT_SCALE * 2.7 + .55)) continue;
    lots.push(lot);
  }
  return lots;
}

export interface ParkingLot { x: number; z: number; angle: number; length: number; depth: number; stalls: (Point & { rotation: number })[] }
/**
 * Car parks: two on the green belt, behind the depot and the CRM centre, and a truck yard on the mainland
 * behind the depot. `angle` turns the lot so its length runs along the ring; stalls face the aisle.
 */
export function parkingLots(): ParkingLot[] {
  const driver = angleOf(CITY_LOCATIONS[1]), crm = angleOf(CITY_LOCATIONS[2]);
  return ([[30.2, driver, 10, 5.2], [30.2, crm, 7.8, 5.2], [51.6, driver, 14.3, 9]] as const).map(([radius, a, length, depth]) => {
    const c = polar(radius, a), t = { x: -Math.sin(a), z: Math.cos(a) }, n = { x: Math.cos(a), z: Math.sin(a) }, stalls: ParkingLot["stalls"] = [];
    // [offset from the centre line, faces outward]: every row noses towards its aisle.
    const rows: [number, boolean][] = depth > 6 ? [[-depth / 2 + .95, true], [-.95, false], [.95, true], [depth / 2 - .95, false]] : [[-depth / 2 + .95, true], [depth / 2 - .95, false]];
    rows.forEach(([offset, outward]) => {
      for (let s = -length / 2 + .6; s <= length / 2 - .55; s += 1.1) stalls.push({ x: c.x + t.x * s + n.x * offset, z: c.z + t.z * s + n.z * offset, rotation: Math.atan2(n.x, n.z) + (outward ? 0 : Math.PI) });
    });
    return { x: c.x, z: c.z, angle: Math.atan2(t.x, t.z), length, depth, stalls };
  });
}
export function insideParking(p: Point, lot: ParkingLot, pad = 0) {
  const dx = p.x - lot.x, dz = p.z - lot.z, along = dx * Math.sin(lot.angle) + dz * Math.cos(lot.angle), across = dx * Math.cos(lot.angle) - dz * Math.sin(lot.angle);
  return Math.abs(along) < lot.length / 2 + pad && Math.abs(across) < lot.depth / 2 + pad;
}

export type Zone = "houses" | "blocks" | "towers" | "industry";
export interface MainlandLot extends Lot { zone: Zone; width: number }
/**
 * Rows of buildings around the canal and the outer ring road. The rows nearest the island are what the
 * default view shows, so they get the detailed models; farther rows are simple blocks and a skyline.
 * A tenth of the lots stay parks.
 */
export function mainlandLots(lite = false) {
  const random = rng(33), lots: MainlandLot[] = [], parks: Point[] = [], parking = parkingLots();
  const industry = angleOf(CITY_LOCATIONS[1]);
  const rows: [number, Zone, number][] = [[47.6, "houses", 3.5], [51.6, "houses", 3.5], [55.6, "houses", 3.6], [66.6, "blocks", 4], [71, "blocks", 4], [75.4, "blocks", 4.2], [79.8, "blocks", 4.2], [88, "blocks", 4.6], [93, "blocks", 4.8], [99, "towers", 5.4], [108, "towers", 6.5], [118, "towers", 7.5], [129, "towers", 8.5]];
  rows.forEach(([radius, zone, step], row) => {
    if (lite && radius > 80) return;
    const count = Math.floor(2 * Math.PI * radius / step);
    for (let i = 0; i < count; i++) {
      const a = (i + (row % 2) * .5) / count * Math.PI * 2 + (random() - .5) * .25 * step / radius, r = radius + (random() - .5) * .7;
      const p = polar(r, a), roll = random(), pick = random(), size = random();
      if (!clearOfAvenues(p, 1 + step / 2 + .45) || parking.some(lot => insideParking(p, lot, step / 2))) continue;
      // Towers stand close together only in the skyline; elsewhere the far rows thin out.
      if (zone === "towers" && angularDistance(a, SKYLINE_ANGLE) > .75 && roll < .7) continue;
      if (roll < .1) { parks.push(p); continue; }
      const inward = row % 2 === 0;
      lots.push({ ...p, r, rotation: Math.atan2(-p.x, -p.z) + (inward ? 0 : Math.PI), roll, pick, size, width: step - .8, zone: angularDistance(a, industry) < .4 && radius < 90 ? "industry" : zone });
    }
  });
  return { lots, parks };
}

export interface TreeSpot extends Point { scale: number; round: boolean }
/** Trees on the green belt, along the canal bank, the outer ring and the avenues, and in the parks. */
export function treeSpots(lite: boolean, parks: Point[]): TreeSpot[] {
  const random = rng(7), trees: TreeSpot[] = [], parking = parkingLots();
  // `pad` keeps the whole crown, not only the trunk, off the avenue.
  const add = (p: Point, scale: number, pad = 2.4) => {
    const r = Math.hypot(p.x, p.z), onLand = r < QUAY - .6 || r > BANK + .8, offRings = Math.abs(r - RING_ROAD) > 1.8 && Math.abs(r - OUTER_RING) > 1.8;
    if (onLand && offRings && clearOfAvenues(p, pad) && !parking.some(lot => insideParking(p, lot, .7))) trees.push({ ...p, scale, round: random() < .35 });
  };
  for (let i = 0; i < (lite ? 120 : 190); i++) add(polar(27.3 + random() * 5.7, random() * Math.PI * 2), 1.1 + random() * .8);
  for (const [radius, step] of [[45.3, 3.2], [59.4, 3.8], [64.6, 4]] as const) {
    const count = Math.floor(2 * Math.PI * radius / step);
    for (let i = 0; i < count; i++) if (random() > .12) add(polar(radius + (random() - .5) * .5, (i + random() * .3) / count * Math.PI * 2), 1.2 + random() * .7);
  }
  for (const a of avenueAngles()) for (let r = 46; r < (lite ? 82 : 120); r += 5) for (const side of [-1, 1]) {
    const p = polar(r, a), off = 2.5 * side;
    add({ x: p.x - Math.sin(a) * off, z: p.z + Math.cos(a) * off }, 1.1 + random() * .5, 2.3);
  }
  for (const park of parks) for (let k = 0; k < 3; k++) add({ x: park.x + (random() - .5) * 2.6, z: park.z + (random() - .5) * 2.6 }, 1 + random() * .9);
  return trees;
}

/** Street lamps: both edges of the inner ring road, the promenade, the bridges and the outer ring road. */
export function lampSpots(): Point[] {
  const lamps: Point[] = [], radials = radialAngles(), clear = (r: number, a: number) => radials.every(b => angularDistance(a, b) * r > 2.4);
  for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2, r = i % 2 ? 26.45 : 23.55; if (clear(r, a)) lamps.push(polar(r, a)); }
  for (let i = 0; i < 30; i++) { const a = (i + .5) / 30 * Math.PI * 2; if (clear(PROMENADE, a)) lamps.push(polar(PROMENADE + .55, a)); }
  for (let i = 0; i < 32; i++) { const a = (i + .25) / 32 * Math.PI * 2; if (clear(OUTER_RING, a)) lamps.push(polar(OUTER_RING + 1.35, a)); }
  for (const a of avenueAngles()) for (const r of [QUAY + .9, BANK - .9]) for (const side of [-1, 1]) {
    const p = polar(r, a); lamps.push({ x: p.x - Math.sin(a) * 1.5 * side, z: p.z + Math.cos(a) * 1.5 * side });
  }
  return lamps;
}

export interface Crosswalk extends Point { angle: number }
/** Zebra crossings where streets meet the plaza and the ring roads; `angle` is the direction of the street. */
export function crosswalks(): Crosswalk[] {
  const list: Crosswalk[] = [], at = (r: number, a: number) => ({ ...polar(r, a), angle: Math.atan2(Math.cos(a), Math.sin(a)) });
  for (const a of radialAngles()) list.push(at(PLAZA + 1.2, a), at(22.9, a));
  for (const a of avenueAngles()) list.push(at(27.1, a), at(OUTER_RING - 2.1, a), at(OUTER_RING + 2.1, a));
  return list;
}

export interface Route { points: Point[]; hidden: boolean[]; distance: number[]; length: number }
export interface RoutePlan { route: Route; cars: number; speed: number; boats?: boolean }

/** Quadratic corner between the two neighbours of `corner`, `cut` units from it on each side. */
function roundCorner(prev: Point, corner: Point, next: Point, cut: number): Point[] {
  const toward = (to: Point) => { const d = Math.hypot(to.x - corner.x, to.z - corner.z), k = Math.min(cut, d / 2) / d; return { x: corner.x + (to.x - corner.x) * k, z: corner.z + (to.z - corner.z) * k }; };
  const a = toward(prev), b = toward(next);
  return [0, .25, .5, .75, 1].map(t => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * corner.x + t * t * b.x, z: (1 - t) * (1 - t) * a.z + 2 * (1 - t) * t * corner.z + t * t * b.z }));
}

/**
 * A closed route through several legs. Corners between visible legs are rounded, then every point moves
 * `lane` units to the right of the direction of travel. A hidden leg (far away in the fog) is driven
 * invisibly, so cars can leave the city on one avenue and come back on another.
 */
export function makeRoute(legs: { points: Point[]; hidden?: boolean }[], lane = LANE): Route {
  const raw: { p: Point; hidden: boolean; corner: boolean }[] = [];
  legs.forEach(leg => leg.points.forEach((p, i) => raw.push({ p, hidden: !!leg.hidden, corner: i === 0 })));
  const smooth: { p: Point; hidden: boolean }[] = [];
  raw.forEach((item, i) => {
    const prev = raw[(i - 1 + raw.length) % raw.length], next = raw[(i + 1) % raw.length];
    if (item.corner && !item.hidden && !prev.hidden) roundCorner(prev.p, item.p, next.p, 1.3).forEach(p => smooth.push({ p, hidden: false }));
    else smooth.push({ p: item.p, hidden: item.hidden });
  });
  const points = smooth.map((item, i) => {
    const prev = smooth[(i - 1 + smooth.length) % smooth.length].p, next = smooth[(i + 1) % smooth.length].p;
    const dx = next.x - prev.x, dz = next.z - prev.z, d = Math.hypot(dx, dz) || 1;
    return { x: item.p.x - dz / d * lane, z: item.p.z + dx / d * lane };
  });
  const distance = [0];
  for (let i = 1; i <= points.length; i++) { const a = points[i - 1], b = points[i % points.length]; distance.push(distance[i - 1] + Math.hypot(b.x - a.x, b.z - a.z)); }
  return { points, hidden: smooth.map(item => item.hidden), distance, length: distance[points.length] };
}

/** Position and heading at `s` units along the route; heading is the rotation that turns +z to the direction of travel. */
export function sampleRoute(route: Route, s: number) {
  const at = (value: number) => {
    const d = ((value % route.length) + route.length) % route.length;
    let lo = 0, hi = route.points.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (route.distance[mid] <= d) lo = mid; else hi = mid - 1; }
    const a = route.points[lo], b = route.points[(lo + 1) % route.points.length], k = (d - route.distance[lo]) / ((route.distance[lo + 1] - route.distance[lo]) || 1);
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, hidden: route.hidden[lo] };
  };
  const here = at(s), ahead = at(s + .7), behind = at(s - .7);
  return { x: here.x, z: here.z, hidden: here.hidden, heading: Math.atan2(ahead.x - behind.x, ahead.z - behind.z) };
}

const radialLeg = (a: number, from: number, to: number) => { const points: Point[] = [], step = from < to ? 2 : -2; for (let r = from; step > 0 ? r < to : r > to; r += step) points.push(polar(r, a)); return points; };
const arcLeg = (r: number, from: number, to: number) => { const points: Point[] = [], n = Math.max(2, Math.ceil(Math.abs(to - from) * r / 2)); for (let i = 0; i < n; i++) points.push(polar(r, from + (to - from) * i / n)); return points; };

/**
 * Traffic that never crosses itself: each loop between two neighbouring avenues comes in on one, turns
 * right onto the ring road, leaves on the other and returns along the outer ring; far loops use the outer
 * lane of the outer ring and the avenues beyond it. Cars on one loop keep equal gaps at equal speed.
 */
export function trafficRoutes(lite = false): RoutePlan[] {
  const angles = avenueAngles().slice().sort((a, b) => a - b), plans: RoutePlan[] = [];
  angles.forEach((a0, i) => {
    let a1 = angles[(i + 1) % angles.length]; if (a1 <= a0) a1 += Math.PI * 2;
    plans.push({ cars: lite ? 2 : 4, speed: 4 + (i % 3) * .3, route: makeRoute([{ points: radialLeg(a1, OUTER_RING, RING_ROAD) }, { points: arcLeg(RING_ROAD, a1, a0) }, { points: radialLeg(a0, RING_ROAD, OUTER_RING) }, { points: arcLeg(OUTER_RING, a0, a1) }]) });
    plans.push({ cars: lite ? 1 : 3, speed: 5.2, route: makeRoute([{ points: radialLeg(a1, HORIZON, OUTER_RING) }, { points: arcLeg(OUTER_RING, a1, a0) }, { points: radialLeg(a0, OUTER_RING, HORIZON) }, { points: arcLeg(HORIZON, a0, a1), hidden: true }]) });
  });
  plans.push({ cars: lite ? 6 : 8, speed: 3.6, route: makeRoute([{ points: arcLeg(RING_ROAD, 0, Math.PI * 2) }]) });
  plans.push({ cars: lite ? 1 : 2, speed: 1.6, boats: true, route: makeRoute([{ points: arcLeg((QUAY + BANK) / 2, Math.PI * 2, 0) }], 1.2) });
  return plans;
}
