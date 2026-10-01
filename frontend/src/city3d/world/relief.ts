/**
 * The land round the city: flat inside the horizon, rolling hills just beyond it, and mountain ridges
 * farther out that fade into the fog. Pure data (no three.js), deterministic, shared by the ground mesh
 * (render/mountains.ts) and the forests the generator plants on the hills. The railway's cutting runs into
 * the hills to its tunnel (world/railway.ts).
 */
import { railCut, type RailLine } from "./railway";

/** The fog swallows everything at this many world radii; the relief ends a little past it. */
export const FOG_END = 2.9, RELIEF_END = 3.1;

/** A value 0…1 per whole grid point. */
function lattice(i: number, j: number) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise, 0…1. */
function noise(x: number, z: number) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = lattice(i, j), b = lattice(i + 1, j), c = lattice(i, j + 1), d = lattice(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Fractal noise, 0…1: octaves of halving size and weight. */
export function fbm(x: number, z: number, octaves: number) {
  let sum = 0, weight = .5, total = 0;
  for (let k = 0; k < octaves; k++) { sum += noise(x, z) * weight; total += weight; x = x * 2.03 + 17.1; z = z * 2.03 + 5.3; weight *= .5; }
  return sum / total;
}
const smooth = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

/**
 * Height of the ground above the city's land at (x, z), `d` units past the city's flat land: hills up to about
 * 18 over the first 70 units, then mountain ridges rising over the next 280 up to about 170.
 */
function natural(x: number, z: number, d: number) {
  if (d <= 0) return 0;
  const hills = smooth(d / 70) * (3 + 15 * fbm(x / 60, z / 60, 3));
  const rise = smooth((d - 120) / 280);
  if (rise <= 0) return hills;
  const ridge = 1 - Math.abs(2 * fbm(x / 170 + 11, z / 170 - 4, 4) - 1), range = .45 + .55 * fbm(x / 420 + 3, z / 420 + 9, 2);
  return hills + rise * (20 + 150 * ridge * ridge * range);
}
/** The relief round a city whose flat land ends at the circle of radius `start`, without its railway. */
export function reliefHeight(x: number, z: number, start: number) {
  return natural(x, z, Math.hypot(x, z) - start);
}

/** Where a city's flat land ends: the island city's horizon circle, or the lake city's rectangle (half sizes). */
export type FlatLand = { radius: number } | { halfX: number; halfZ: number };
export function flatLand(world: { spec: { horizon: number }; land: { rectangle?: { width: number; depth: number } } }): FlatLand {
  const rect = world.land.rectangle;
  return rect ? { halfX: rect.width / 2, halfZ: rect.depth / 2 } : { radius: world.spec.horizon };
}
/** How far (x, z) lies past the flat land (0 or less on it). */
export function pastLand(land: FlatLand, x: number, z: number) {
  if ("radius" in land) return Math.hypot(x, z) - land.radius;
  return Math.hypot(Math.max(0, Math.abs(x) - land.halfX), Math.max(0, Math.abs(z) - land.halfZ));
}
/** How far from the centre the flat land reaches along the direction `angle`. */
export function landEdge(land: FlatLand, angle: number) {
  if ("radius" in land) return land.radius;
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  return Math.min(c > 1e-9 ? land.halfX / c : Infinity, s > 1e-9 ? land.halfZ / s : Infinity);
}
/** The ground past a city's flat land, with its railway's yard and cutting dug into the hills. */
export function groundHeight(land: FlatLand, x: number, z: number, line?: RailLine) {
  const h = natural(x, z, pastLand(land, x, z));
  return line && h > 0 ? Math.min(h, railCut(line, x, z)) : h;
}
