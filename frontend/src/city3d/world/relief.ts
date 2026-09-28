/**
 * The land round the city: flat inside the horizon, rolling hills just beyond it, and mountain ridges
 * farther out that fade into the fog. Pure data (no three.js), deterministic, shared by the ground mesh
 * (render/mountains.ts) and the forests the generator plants on the hills.
 */

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
 * Height of the ground above the city's land at (x, z), for a city whose flat land ends at `start`: hills up
 * to about 18 over the first 70 units past it, then mountain ridges rising over the next 280 up to about 170.
 */
export function reliefHeight(x: number, z: number, start: number) {
  const d = Math.hypot(x, z) - start;
  if (d <= 0) return 0;
  const hills = smooth(d / 70) * (3 + 15 * fbm(x / 60, z / 60, 3));
  const rise = smooth((d - 120) / 280);
  if (rise <= 0) return hills;
  const ridge = 1 - Math.abs(2 * fbm(x / 170 + 11, z / 170 - 4, 4) - 1), range = .45 + .55 * fbm(x / 420 + 3, z / 420 + 9, 2);
  return hills + rise * (20 + 150 * ridge * ridge * range);
}
