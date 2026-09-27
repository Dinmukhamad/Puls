/**
 * World generator (TZ §4.2): turns a WorldSpec into WorldData, with no three.js. It is the logic of
 * `pages/city/cityLayout.ts` with every constant taken from the spec, so WORLD_V1 gives the old city unit
 * for unit, and deterministic for a given spec.seed.
 *
 * The city is round: the plaza on its islet, district islands on one or more lagoon rings, a street from
 * the plaza past every island (bridges over the water) to the inner ring road, cross streets between
 * neighbouring inner districts that go on as avenues over the canal, the green belt with car parks and the
 * promenade, and the mainland with its own ring roads, rows of buildings, parks and trees.
 *
 * Roads in WorldData: `streets` are the parts on land; every bridge carries its own deck and road surface.
 * Lagoon bridges reach 0.3 onto the land at both ends, canal arch bridges 0.7 (the avenue stops 0.2 short
 * of the quay and the bank).
 */
import type { ParkingLot, Placement, PlacementKind, Point, Road, Route, RoutePlan, WorldData, WorldSpec, Zone } from "./types";
import type { CitySpec, ParkingSpec } from "./worldSpec";

/** Every road is two lanes, one unit each; cars keep to the right, half a unit from the centre line. */
export const ROAD_HALF = 1, LANE = .5;
/** Half-width of a lagoon bridge deck with its railings. */
export const BRIDGE_HALF = 1.38;
const TAU = Math.PI * 2, DEG = Math.PI / 180;

export const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
/** One random stream per purpose, all from spec.seed: v1's seed 33 gives the old streams 33 (lots), 7 (trees), 11 (parked cars). */
const stream = (seed: number, offset: number) => { const m = 2147483646; return rng((((seed + offset - 1) % m) + m) % m + 1); };
const polar = (r: number, a: number): Point => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
/** Smallest difference between two angles, 0…π. */
export function angularDistance(a: number, b: number) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }
const same = (a: number, b: number) => angularDistance(a, b) < 1e-6;

export function segmentDistance(x: number, z: number, [ax, az, bx, bz]: Road) {
  const dx = bx - ax, dz = bz - az, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
export function insideParking(p: Point, lot: ParkingLot, pad = 0) {
  const dx = p.x - lot.x, dz = p.z - lot.z, reach = (lot.length + lot.depth) / 2 + pad;
  if (Math.abs(dx) > reach || Math.abs(dz) > reach) return false;
  const along = dx * Math.sin(lot.angle) + dz * Math.cos(lot.angle), across = dx * Math.cos(lot.angle) - dz * Math.sin(lot.angle);
  return Math.abs(along) < lot.length / 2 + pad && Math.abs(across) < lot.depth / 2 + pad;
}

export interface PlanDistrict { id: string; x: number; z: number; color: string; soon: boolean; angle: number; r: number }
/** An avenue runs out from ring road `ring` (0 = the inner one, continuing a cross street) to the horizon; (ux, uz) is its direction. */
export interface Avenue { angle: number; ring: number; ux: number; uz: number }
/** Directions and car parks everything else is laid out around. */
export interface CityPlan { spec: CitySpec; districts: PlanDistrict[]; avenues: Avenue[]; radials: number[]; parking: ParkingLot[] }

export function cityPlan(spec: WorldSpec): CityPlan {
  const s = spec as CitySpec;
  const districts = s.districts.map(d => { const p = polar(s.lagoonRings[d.ring].radius, d.angleDeg * DEG); return { id: d.id, ...p, color: d.color, soon: d.soon, angle: Math.atan2(p.z, p.x), r: Math.hypot(p.x, p.z) }; });
  // Inner-ring neighbours, counter-clockwise from the first listed: a cross street and an avenue leave between each two.
  const inner = districts.filter((_, i) => s.districts[i].ring === 0), first = inner[0]?.angle ?? 0, ccw = (a: number) => ((a - first) % TAU + TAU) % TAU;
  inner.sort((a, b) => ccw(a.angle) - ccw(b.angle));
  const avenue = (angle: number, ring: number): Avenue => ({ angle, ring, ux: Math.cos(angle), uz: Math.sin(angle) });
  const avenues = inner.map((a, i) => { const b = inner[(i + 1) % inner.length]; return avenue(Math.atan2((a.z + b.z) / 2, (a.x + b.x) / 2), 0); });
  if (s.districtAvenuesFrom !== undefined) for (const d of districts) if (!avenues.some(v => same(v.angle, d.angle))) avenues.push(avenue(d.angle, s.districtAvenuesFrom));
  // Every street that starts at the plaza: one to every island, one along every cross street.
  const radials: number[] = [];
  for (const a of [...districts.map(d => d.angle), ...avenues.filter(v => v.ring === 0).map(v => v.angle)]) if (!radials.some(b => same(a, b))) radials.push(a);
  return { spec: s, districts, avenues, radials, parking: (s.parking ?? []).map(parkingLot) };
}

/** Is `p` clear of every avenue by `pad`? Inner avenues continue cross streets, so they count from the plaza. */
function clearOfAvenues(plan: CityPlan, p: Point, pad: number) {
  for (const v of plan.avenues) {
    const along = p.x * v.ux + p.z * v.uz;
    if (along > (v.ring ? plan.spec.roadRings[v.ring] - pad : 0) && Math.abs(p.z * v.ux - p.x * v.uz) < pad) return false;
  }
  return true;
}

/** Avenues from the inner ring road cross the canal on an arch bridge; the others start beyond it. */
const crossesCanal = (plan: CityPlan, v: Avenue) => plan.spec.roadRings[v.ring] < plan.spec.quay;

/** `angle` turns the lot so its length runs along the ring; stalls face the aisle. */
function parkingLot({ angleDeg, radius, length, depth }: ParkingSpec): ParkingLot {
  const a = angleDeg * DEG, c = polar(radius, a), t = { x: -Math.sin(a), z: Math.cos(a) }, n = { x: Math.cos(a), z: Math.sin(a) }, stalls: ParkingLot["stalls"] = [];
  // [offset from the centre line, faces outward]: every row noses towards its aisle.
  const rows: [number, boolean][] = depth > 6 ? [[-depth / 2 + .95, true], [-.95, false], [.95, true], [depth / 2 - .95, false]] : [[-depth / 2 + .95, true], [depth / 2 - .95, false]];
  rows.forEach(([offset, outward]) => {
    for (let s = -length / 2 + .6; s <= length / 2 - .55; s += 1.1) stalls.push({ x: c.x + t.x * s + n.x * offset, z: c.z + t.z * s + n.z * offset, rotation: Math.atan2(n.x, n.z) + (outward ? 0 : Math.PI) });
  });
  return { x: c.x, z: c.z, angle: Math.atan2(t.x, t.z), length, depth, stalls };
}

/** Streets on land and bridges over the water: inside the ring road along every radial, then the avenues. */
export function roadsOf(plan: CityPlan) {
  const s = plan.spec, streets: Road[] = [], bridges: { road: Road; canal: boolean }[] = [];
  const along = (a: number, from: number, to: number): Road => [Math.cos(a) * from, Math.sin(a) * from, Math.cos(a) * to, Math.sin(a) * to];
  for (const a of plan.radials) {
    // From the plaza to the first island, from island to island, from the last island to the ring road.
    const islands = plan.districts.filter(d => same(d.angle, a)).sort((d, e) => d.r - e.r);
    const stops = [s.plaza, ...islands.flatMap(d => [d.r - s.islet, d.r + s.islet]), s.roadRings[0] - ROAD_HALF];
    for (let k = 0; k < stops.length; k += 2) {
      // The water part [w0, w1] lies past the plaza islet and short of the lagoon shore.
      const from = stops[k], to = stops[k + 1], w0 = Math.min(to, Math.max(from, s.plazaIslet)), w1 = Math.max(w0, Math.min(to, s.lagoon));
      if (w0 - from > .01) streets.push(along(a, from, w0));
      if (w1 - w0 > .1) bridges.push({ road: along(a, w0 - .3, w1 + .3), canal: false });
      if (to - w1 > .01) streets.push(along(a, w1, to));
    }
  }
  for (const v of plan.avenues) {
    const start = s.roadRings[v.ring] + ROAD_HALF;
    if (!crossesCanal(plan, v)) { streets.push(along(v.angle, start, s.horizon)); continue; }
    streets.push(along(v.angle, start, s.quay - .2), along(v.angle, s.bank + .2, s.horizon));
    bridges.push({ road: along(v.angle, s.quay - .7, s.bank + .7), canal: true });
  }
  return { streets, bridges };
}

/** Zebra crossings where streets leave the plaza and cross the ring roads; `angle` is the direction of the street. */
export function crosswalks(plan: CityPlan): WorldData["roads"]["crosswalks"] {
  const s = plan.spec, list: WorldData["roads"]["crosswalks"] = [], at = (r: number, a: number) => ({ ...polar(r, a), angle: Math.atan2(Math.cos(a), Math.sin(a)) });
  for (const a of plan.radials) list.push(at(s.plaza + 1.2, a));
  for (const v of plan.avenues) {
    list.push(at(s.roadRings[v.ring] + 2.1, v.angle));
    for (const r of s.roadRings.slice(v.ring + 1)) list.push(at(r - 2.1, v.angle), at(r + 2.1, v.angle));
  }
  return list;
}

export interface Lot extends Point { r: number; rotation: number; roll: number; pick: number; size: number; zone: Zone; width: number }
/** Is a lot `reach` units across, at `p` and radius `r`, clear of the ring roads, the car parks and the avenues? */
function lotClear(plan: CityPlan, rings: number[], parking: ParkingLot[], p: Point, r: number, reach: number) {
  for (const ring of rings) if (Math.abs(r - ring) < ROAD_HALF + reach / 2) return false;
  for (const lot of parking) if (insideParking(p, lot, reach / 2)) return false;
  return clearOfAvenues(plan, p, 1 + reach / 2 + .45);
}
/**
 * Rows of buildings on the mainland. Lots keep clear of the avenues, ring roads and car parks; towers stand
 * close together only in the skyline, elsewhere most tower lots stay empty; a tenth of the lots are parks.
 * Rows alternate facing the centre and facing out; zone sectors (industry, port) take over their rows.
 */
export function mainlandLots(plan: CityPlan) {
  const s = plan.spec, random = stream(s.seed, 0), lots: Lot[] = [], parks: Point[] = [];
  s.mainland.forEach(({ radius, zone: rowZone, step }, row) => {
    // Only the ring roads, car parks and sectors near this row can matter: lots sit within 0.35 of the row and
    // keep at most a step (half of a double port lot) from a ring road or a car park.
    const count = Math.floor(TAU * radius / step), rings = s.roadRings.filter(ring => Math.abs(ring - radius) < step * 2 + 2);
    const parking = plan.parking.filter(lot => Math.abs(Math.hypot(lot.x, lot.z) - radius) < (lot.length + lot.depth) / 2 + step * 2 + 1), sectors = (s.sectors ?? []).filter(z => radius >= z.from && radius < z.to);
    for (let i = 0; i < count; i++) {
      const a = (i + (row % 2) * .5) / count * TAU + (random() - .5) * .25 * step / radius, r = radius + (random() - .5) * .7;
      const p = polar(r, a), roll = random(), pick = random(), size = random();
      const zone = sectors.find(z => angularDistance(a, z.angleDeg * DEG) < z.halfWidth)?.zone ?? rowZone;
      // Warehouses and cranes take two lots; suburban houses stand in gardens, less than half the lot.
      if (zone === "port" && i % 2) continue;
      const width = zone === "port" ? step * 2 - .8 : zone === "suburb" ? step * .45 : step - .8;
      if (!lotClear(plan, rings, parking, p, r, Math.max(step, width + .8))) continue;
      if (rowZone === "towers" && angularDistance(a, s.skylineAngle) > .75 && roll < .7) continue;
      if (roll < .1) { parks.push(p); continue; }
      lots.push({ x: p.x, z: p.z, r, rotation: Math.atan2(-p.x, -p.z) + (row % 2 === 0 ? 0 : Math.PI), roll, pick, size, width, zone });
    }
  });
  return { lots, parks };
}

export interface TreeSpot extends Point { scale: number; round: boolean }
/** Trees on the plaza islet and the green belt, along the canal bank, the ring roads and the avenues, in parks and gardens. */
export function treeSpots(plan: CityPlan, parks: Point[], lots: Lot[]): TreeSpot[] {
  const s = plan.spec, random = stream(s.seed, -26), trees: TreeSpot[] = [];
  // `pad` keeps the whole crown, not only the trunk, off the avenue.
  const add = (p: Point, scale: number, pad = 2.4) => {
    const r = Math.hypot(p.x, p.z), onLand = r > s.lagoon + .6 && (r < s.quay - .6 || r > s.bank + .8) && r < s.horizon - 2;
    if (!onLand) return;
    for (const ring of s.roadRings) if (Math.abs(r - ring) <= 1.8) return;
    for (const lot of plan.parking) if (insideParking(p, lot, .7)) return;
    if (!clearOfAvenues(plan, p, pad)) return;
    trees.push({ x: p.x, z: p.z, scale, round: random() < .35 });
  };
  // The green belt, one tree per 5.7 square units (190 in v1).
  const belt = s.roadRings[0] + 2.3, beltWidth = s.promenade - 1.1 - belt, beltTrees = Math.round(Math.PI * ((belt + beltWidth) ** 2 - belt ** 2) / 5.683);
  for (let i = 0; i < beltTrees; i++) add(polar(belt + random() * beltWidth, random() * TAU), 1.1 + random() * .8);
  // A small tree between every two streets on the plaza islet.
  const radials = [...plan.radials].sort((a, b) => a - b);
  radials.forEach((a, i) => { const next = radials[(i + 1) % radials.length] + (i === radials.length - 1 ? TAU : 0); trees.push({ ...polar(s.plaza + 1.05, (a + next) / 2), scale: .7, round: true }); });
  const rows: [number, number][] = [[s.bank + 1.7, 3.2], ...s.roadRings.slice(1).flatMap((ring): [number, number][] => [[ring - 2.6, 3.8], [ring + 2.6, 4]])];
  for (const [radius, step] of rows) {
    const count = Math.floor(TAU * radius / step);
    for (let i = 0; i < count; i++) if (random() > .12) add(polar(radius + (random() - .5) * .5, (i + random() * .3) / count * TAU), 1.2 + random() * .7);
  }
  for (const { angle: a, ring } of plan.avenues) for (let r = ring ? s.roadRings[ring] + 3.4 : s.bank + 2.4; r < s.horizon - 30; r += 5) for (const side of [-1, 1]) {
    const p = polar(r, a), off = 2.5 * side;
    add({ x: p.x - Math.sin(a) * off, z: p.z + Math.cos(a) * off }, 1.1 + random() * .5, 2.3);
  }
  for (const park of parks) for (let k = 0; k < 3; k++) add({ x: park.x + (random() - .5) * 2.6, z: park.z + (random() - .5) * 2.6 }, 1 + random() * .9);
  // One or two garden trees beside every suburban house, between it and its neighbours.
  for (const lot of lots) if (lot.zone === "suburb") {
    const a = Math.atan2(lot.z, lot.x), count = random() < .4 ? 2 : 1, side = random() < .5 ? -1 : 1;
    for (let k = 0; k < count; k++) {
      const off = (k ? -side : side) * (lot.width / 2 + 1.2), back = (random() - .5) * 1.6;
      add({ x: lot.x - Math.sin(a) * off + Math.cos(a) * back, z: lot.z + Math.cos(a) * off + Math.sin(a) * back }, .9 + random() * .6);
    }
  }
  return trees;
}

/** Street lamps: both edges of the inner ring road, the promenade, the outer ring roads and the canal bridges. */
export function lampSpots(plan: CityPlan): Point[] {
  const s = plan.spec, lamps: Point[] = [], clear = (r: number, a: number) => plan.radials.every(b => angularDistance(a, b) * r > 2.4);
  // One lamp per so many units of arc: 36, 30 and 32 lamps in v1.
  const around = (r: number, spacing: number) => Math.round(TAU * r / spacing), ring = s.roadRings[0];
  const n = around(ring, 4.3633), m = around(s.promenade, 7.1419);
  for (let i = 0; i < n; i++) { const a = i / n * TAU, r = i % 2 ? ring + 1.45 : ring - 1.45; if (clear(r, a)) lamps.push(polar(r, a)); }
  for (let i = 0; i < m; i++) { const a = (i + .5) / m * TAU; if (clear(s.promenade, a)) lamps.push(polar(s.promenade + .55, a)); }
  for (const outer of s.roadRings.slice(1)) {
    const k = around(outer, 12.1737);
    for (let i = 0; i < k; i++) { const a = (i + .25) / k * TAU; if (clear(outer, a)) lamps.push(polar(outer + 1.35, a)); }
  }
  for (const v of plan.avenues) if (crossesCanal(plan, v)) for (const r of [s.quay + .9, s.bank - .9]) for (const side of [-1, 1]) {
    const a = v.angle, p = polar(r, a); lamps.push({ x: p.x - Math.sin(a) * 1.5 * side, z: p.z + Math.cos(a) * 1.5 * side });
  }
  return lamps;
}

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
/** At least `base` cars (v1's count), more on long loops: one per `spacing` units of visible road. */
function fleet(route: Route, base: number, spacing: number) {
  let visible = 0;
  route.points.forEach((_, i) => { if (!route.hidden[i]) visible += route.distance[i + 1] - route.distance[i]; });
  return Math.max(base, Math.round(visible / spacing));
}

/**
 * Traffic that never crosses itself. Between every two ring roads, each loop between two neighbouring
 * avenues comes in on one, turns right onto the inner ring (its outer lane), leaves on the other and
 * returns along the outer ring (its inner lane); far loops use the outer lane of the last ring road and
 * the avenues beyond it. The inner ring road's inner lane has a loop of its own. Every turn is a right turn.
 */
export function trafficRoutes(plan: CityPlan): RoutePlan[] {
  const s = plan.spec, plans: RoutePlan[] = [];
  const bands = s.roadRings.map((inner, k) => ({ inner, outer: s.roadRings[k + 1] ?? s.horizon, far: k === s.roadRings.length - 1, angles: plan.avenues.filter(v => v.ring <= k).map(v => v.angle).sort((a, b) => a - b) }));
  const most = Math.max(...bands.map(b => b.angles.length));
  // Sector by sector, band by band: v1's order, so loops start at the same phases.
  for (let i = 0; i < most; i++) for (const { inner, outer, far, angles } of bands) {
    if (i >= angles.length) continue;
    const a0 = angles[i]; let a1 = angles[(i + 1) % angles.length]; if (a1 <= a0) a1 += TAU;
    if (!far) { const route = makeRoute([{ points: radialLeg(a1, outer, inner) }, { points: arcLeg(inner, a1, a0) }, { points: radialLeg(a0, inner, outer) }, { points: arcLeg(outer, a0, a1) }]); plans.push({ cars: fleet(route, 4, 50), speed: 4 + (i % 3) * .3, route }); }
    else { const route = makeRoute([{ points: radialLeg(a1, outer, inner) }, { points: arcLeg(inner, a1, a0) }, { points: radialLeg(a0, inner, outer) }, { points: arcLeg(outer, a0, a1), hidden: true }]); plans.push({ cars: fleet(route, 3, 90), speed: 5.2, route }); }
  }
  const ring = makeRoute([{ points: arcLeg(s.roadRings[0], 0, TAU) }]), canal = makeRoute([{ points: arcLeg((s.quay + s.bank) / 2, TAU, 0) }], 1.2);
  plans.push({ cars: fleet(ring, 8, 20), speed: 3.6, route: ring }, { cars: fleet(canal, 2, 124), speed: 1.6, boats: true, route: canal });
  return plans;
}

/**
 * Tower and block height classes (the old four plain blocks): 0 = 4 floors, 1 = 7, 2 = 11 and 3 = 18, the
 * last two glass. Blocks get 0…2, towers 1…3 (2…3 in the skyline). The class is the placement's variant.
 */
function heightClass(lot: Lot, skyline: number) {
  if (lot.zone !== "towers") return lot.pick < .55 ? 0 : lot.pick < .9 ? 1 : 2;
  return angularDistance(Math.atan2(lot.z, lot.x), skyline) < .75 ? (lot.pick < .4 ? 2 : 3) : (lot.pick < .5 ? 1 : 2);
}
const LOT_KINDS: Record<Zone, PlacementKind> = { houses: "house", suburb: "house", industry: "industry", port: "port", blocks: "block", towers: "tower" };
/** A lot's building: detailed models fill the lot; plain blocks keep the old footprint and a height scale of 0.9…1.1. */
function building(lot: Lot, skyline: number): Placement {
  const base = { x: lot.x, z: lot.z, rotation: lot.rotation, variant: Math.floor(lot.pick * 1e4), scale: 1, width: lot.width };
  if (lot.zone === "houses") return { ...base, kind: lot.roll < .8 ? "house" : "office" };
  if (lot.zone !== "blocks" && lot.zone !== "towers") return { ...base, kind: LOT_KINDS[lot.zone] };
  const variant = heightClass(lot, skyline);
  return { ...base, kind: LOT_KINDS[lot.zone], variant, scale: .9 + lot.size * .2, width: Math.min(lot.width, variant >= 2 ? 3.4 : 3.8) * (.82 + lot.size * .18) };
}

/** Cars on the car parks: as in v1, 35% of the stalls stay free, half of them in truck yards. */
function parkedCars(plan: CityPlan): Placement[] {
  const random = stream(plan.spec.seed, -22), cars: Placement[] = [];
  plan.parking.forEach((lot, i) => lot.stalls.forEach((stall, k) => {
    if (random() < (lot.depth > 6 ? .5 : .35)) return;
    cars.push({ kind: "car-parked", variant: k * 7 + i, x: stall.x, z: stall.z, rotation: stall.rotation, scale: 1, width: 0 });
  }));
  return cars;
}

export function generateWorld(spec: WorldSpec): WorldData {
  const plan = cityPlan(spec), s = plan.spec, { lots, parks } = mainlandLots(plan);
  const trees = treeSpots(plan, parks, lots);
  const placements: Placement[] = [];
  for (const lot of lots) placements.push(building(lot, s.skylineAngle));
  trees.forEach((t, i) => placements.push({ kind: t.round ? "tree-round" : "tree-cone", variant: i, x: t.x, z: t.z, rotation: t.x * 3.1, scale: t.scale, width: 0 }));
  for (const p of lampSpots(plan)) placements.push({ kind: "lamp", variant: 0, x: p.x, z: p.z, rotation: 0, scale: 1, width: 0 });
  placements.push(...parkedCars(plan));
  return {
    spec,
    districts: plan.districts.map(({ id, x, z, color, soon }) => ({ id, x, z, color, soon })),
    land: { annuli: [{ inner: s.lagoon, outer: s.quay }, { inner: s.bank, outer: s.horizon }], islets: [{ x: 0, z: 0, r: s.plazaIslet }, ...plan.districts.map(d => ({ x: d.x, z: d.z, r: s.islet }))] },
    water: { annuli: [{ inner: s.plazaIslet, outer: s.lagoon }, { inner: s.quay, outer: s.bank }] },
    roads: { rings: [...s.roadRings], ...roadsOf(plan), crosswalks: crosswalks(plan), parking: plan.parking },
    placements,
    parks,
    routes: trafficRoutes(plan),
    radius: s.horizon,
  };
}
