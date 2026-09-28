/**
 * The group city (docs/CITY_GROUP.md): quarters of the first band that a supervisor's group builds
 * together. The server says each quarter's stage; this file picks the quarters and lays out what a
 * stage looks like, from the quarter's own finished placements: a fenced sand lot, concrete slabs
 * where the buildings will stand, grey frames, the lower half of every building, then the quarter.
 */
import type { Complex, Placement, Surface } from "./types";
import { OUTSIDE } from "./complexes";

export type SiteStage = "planned" | "foundation" | "frame" | "floors" | "done";
export const SITE_STAGES: readonly SiteStage[] = ["planned", "foundation", "frame", "floors", "done"];
/** A quarter of the group city: its complex, and everything the complex laid out, by its key. */
export interface Site extends Complex { key: string; complex: number; placements: Placement[]; surfaces: Surface[] }
/** How many quarters, from the complexes within `within` of the centre, first ones nearest `facing` (radians, atan2(z, x)). */
export interface SiteSpec { count: number; within: number; facing: number }

const BUILDINGS = new Set(["section", "glass-tower", "cottage"]);
/** Concrete grey (SECTION_TINTS 8) for the frames. */
const CONCRETE = 8;
const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
const apart = (a: number, b: number) => { const d = Math.abs(wrap(a) - wrap(b)); return Math.min(d, TAU - d); };

/** Indexes of the complexes that become quarters, spread round the city, the first ones in the default view. */
export function pickSites(complexes: readonly Complex[], spec: SiteSpec): number[] {
  const near = complexes.map((c, i) => ({ i, a: wrap(Math.atan2(c.z, c.x)) })).filter(({ i }) => Math.hypot(complexes[i].x, complexes[i].z) < spec.within).sort((p, q) => p.a - q.a);
  if (!near.length) return [];
  const count = Math.min(spec.count, near.length), step = near.length / count;
  // Spread evenly, starting from the one nearest the default view.
  const first = near.reduce((best, p, k) => apart(p.a, spec.facing) < apart(near[best].a, spec.facing) ? k : best, 0);
  const chosen = Array.from({ length: count }, (_, k) => near[(first + Math.round(k * step)) % near.length]);
  return chosen.sort((p, q) => apart(p.a, spec.facing) - apart(q.a, spec.facing)).map(p => p.i);
}

/** What a quarter shows at `stage`. */
export function siteLayout(site: Site, stage: SiteStage): { placements: Placement[]; surfaces: Surface[] } {
  if (stage === "done") return { placements: site.placements, surfaces: site.surfaces };
  const surfaces: Surface[] = [], placements: Placement[] = [];
  const s = Math.sin(site.angle), c = Math.cos(site.angle), hl = site.length / 2 + OUTSIDE - .2, hd = site.depth / 2 + OUTSIDE - .2;
  // The fenced lot: sand inside white lines.
  surfaces.push({ kind: "sand", x: site.x, z: site.z, angle: site.angle, length: 2 * hl, width: 2 * hd });
  for (const side of [-1, 1]) {
    surfaces.push({ kind: "line", x: site.x + s * hl * side, z: site.z + c * hl * side, angle: site.angle, length: .1, width: 2 * hd });
    surfaces.push({ kind: "line", x: site.x + c * hd * side, z: site.z - s * hd * side, angle: site.angle, length: 2 * hl, width: .1 });
  }
  if (stage === "planned") return { placements, surfaces };
  const buildings = site.placements.filter(p => BUILDINGS.has(p.kind) && (p.lift ?? 0) < .5);
  // Slabs under every building.
  for (const p of buildings) surfaces.push({ kind: "asphalt", x: p.x, z: p.z, angle: p.rotation + Math.PI / 2, length: p.width || 2.6, width: p.depth ?? 2.4 });
  if (stage === "foundation") return { placements, surfaces };
  for (const p of buildings) {
    const tall = p.kind === "glass-tower" ? p.variant + 2 : p.kind === "cottage" ? 0 : p.variant;
    // Frames: the lowest floors in concrete. Floors: half the building in its own colours (towers as sections).
    const variant = stage === "frame" ? 0 : Math.max(0, Math.ceil(tall / 2));
    placements.push({ ...p, kind: p.kind === "cottage" ? "cottage" : "section", variant: p.kind === "cottage" ? 0 : variant, tint: stage === "frame" ? CONCRETE : p.kind === "glass-tower" ? CONCRETE : p.tint, lift: undefined });
  }
  return { placements, surfaces };
}
