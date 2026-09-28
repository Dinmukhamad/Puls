/**
 * The plots of the operator's own district (docs/CITY_BUILDS.md): squares on the green belt between the
 * inner ring road and the promenade, either side of every open district, facing the lagoon. The server
 * says which are open and what stands on them; this file only knows where they are and how every
 * building is laid out on one, from the same pieces as the courtyards of the complexes.
 */
import type { Placement, Point, Surface, SurfaceKind, PlacementKind } from "./types";

export type BuildingKey = "garden" | "gazebo" | "playground" | "sports" | "fountain" | "cottage" | "house" | "tower";
export const BUILDING_KEYS: readonly BuildingKey[] = ["garden", "gazebo", "playground", "sports", "fountain", "cottage", "house", "tower"];
/** A plot: `size` square, its front (local +w) towards the lagoon along `rotation` (atan2(dx, dz)). */
export interface Plot { key: string; district: string; x: number; z: number; rotation: number; size: number }
/** Which plot looks how: shut (lawn), an open building site, or built up. */
export type PlotState = { unlocked: boolean; item: BuildingKey | null };

/** Where the plots go: these districts, and each plot this many radians off its district's direction. */
export interface PlotSpec { districts: string[]; offsets: number[] }

/** Plot centres on the belt from `inner` to `outer`, `angle` of each district by id. */
export function plotSpots(spec: PlotSpec, angles: Map<string, number>, inner: number, outer: number): Plot[] {
  const r = (inner + outer) / 2, size = Math.min(5, outer - inner - .4);
  return spec.districts.flatMap(district => {
    const a = angles.get(district);
    if (a === undefined) return [];
    return spec.offsets.map((offset, i) => {
      const x = Math.cos(a + offset) * r, z = Math.sin(a + offset) * r;
      return { key: `${district}-${i}`, district, x, z, rotation: Math.atan2(-x, -z), size };
    });
  });
}

/** Is `p` within `pad` of the plot's square? */
export function insidePlot(p: Point, plot: Plot, pad = 0) {
  const s = Math.sin(plot.rotation), c = Math.cos(plot.rotation), dx = p.x - plot.x, dz = p.z - plot.z, h = plot.size / 2 + pad;
  return Math.abs(dx * c - dz * s) <= h && Math.abs(dx * s + dz * c) <= h;
}

/** What stands on a plot in `state`: the copies for the instance pools and the ground patches. */
export function plotLayout(plot: Plot, state: PlotState): { placements: Placement[]; surfaces: Surface[] } {
  const placements: Placement[] = [], surfaces: Surface[] = [];
  const s = Math.sin(plot.rotation), c = Math.cos(plot.rotation), h = plot.size / 2;
  // Local u runs along the belt (the plot's x axis), w towards the lagoon (its front).
  const at = (u: number, w: number) => ({ x: plot.x + c * u + s * w, z: plot.z - s * u + c * w });
  // Rotations: `front` turns a piece's front by `turn` from the plot's front, `side` lays a piece's x axis along u.
  const front = (turn = 0) => plot.rotation + turn;
  const put = (kind: PlacementKind, u: number, w: number, rotation: number, extra: Partial<Placement> = {}) =>
    placements.push({ kind, variant: placements.length, ...at(u, w), rotation, scale: 1, width: 0, ...extra });
  const patch = (kind: SurfaceKind, u: number, w: number, length: number, width: number) =>
    surfaces.push({ kind, ...at(u, w), angle: plot.rotation + Math.PI / 2, length, width });
  const disc = (kind: SurfaceKind, u: number, w: number, r: number) => surfaces.push({ kind, ...at(u, w), angle: 0, length: 2 * r, width: 2 * r, round: true });
  // Every plot has a kerb of paving, so the square reads on the belt from afar.
  patch("walk", 0, 0, plot.size, plot.size);

  if (!state.item) {
    if (!state.unlocked) { patch("lawn", 0, 0, plot.size - .5, plot.size - .5); return { placements, surfaces }; }
    // An open building site: sand inside a white line, a pallet of bushes waiting by the gate.
    patch("sand", 0, 0, plot.size - .5, plot.size - .5);
    for (const [u, w, l, wd] of [[0, h - .35, plot.size - .5, .08], [0, -h + .35, plot.size - .5, .08], [h - .35, 0, .08, plot.size - .5], [-h + .35, 0, .08, plot.size - .5]] as const) patch("line", u, w, l, wd);
    put("planter", -h + .8, h - .8, front(), { width: .6 }); put("planter", h - .8, h - .8, front(), { width: .6 });
    return { placements, surfaces };
  }

  const lawn = () => patch("lawn", 0, 0, plot.size - .5, plot.size - .5);
  switch (state.item) {
    case "garden":
      lawn(); patch("walk", 0, 0, .8, plot.size - .5);
      for (const [u, w, kind] of [[-1.35, 1.2, "tree-round"], [1.4, -1.1, "tree-oak"], [-1.3, -1.25, "tree-birch"], [1.3, 1.3, "tree-round"]] as const) put(kind, u, w, u * 2.1, { scale: 1.1 });
      put("bench", -.75, .2, front(Math.PI / 2), { width: .8 }); put("bench", .75, -.2, front(-Math.PI / 2), { width: .8 });
      put("flowerbed", 0, 1.6, 0, { width: .9 });
      break;
    case "gazebo":
      lawn(); patch("plaza", 0, h - .9, .9, 1.4);
      put("gazebo", 0, -.2, front(), { width: 2.4 });
      for (const [u, w] of [[-1.7, 1.6], [1.7, 1.6], [-1.7, -1.7], [1.7, -1.7]]) put("bush", u, w, u + w, { scale: 1.2 });
      put("flowerbed", -1.5, 0, 0, { width: .9 }); put("flowerbed", 1.5, 0, 1, { width: .9 });
      break;
    case "playground":
      lawn(); patch("play", 0, -.2, 4, 3.6); disc("sand", 1, -.9, .8);
      put("slide", -1, -.6, front(Math.PI / 2), { width: 1.6 }); put("swings", .2, .9, front(), { width: 1.8 });
      put("sandbox", 1, -.9, front(), { width: 1.4 });
      put("bench", -1.5, 1.8, front(Math.PI), { width: .8 }); put("tree-round", 1.9, 1.9, 0, { scale: .9 });
      break;
    case "sports":
      patch("court", 0, 0, plot.size - .6, 3.8);
      patch("line", 0, 0, .06, 3.8); disc("line", 0, 0, .5); disc("court", 0, 0, .44);
      put("hoop", -h + .6, 0, front(Math.PI / 2), { width: 1.2 }); put("hoop", h - .6, 0, front(-Math.PI / 2), { width: 1.2 });
      put("bench", 0, h - .35, front(Math.PI), { width: .8 });
      break;
    case "fountain":
      patch("plaza", 0, 0, plot.size - .5, plot.size - .5); disc("walk", 0, 0, 1.5);
      put("fountain", 0, 0, 0, { width: 1.9 });
      for (const k of [0, 1, 2, 3]) { const a = k * Math.PI / 2 + Math.PI / 4; put("bench", Math.sin(a) * 1.75, Math.cos(a) * 1.75, front(a + Math.PI), { width: .8 }); }
      for (const [u, w] of [[-1.95, 1.95], [1.95, 1.95], [-1.95, -1.95], [1.95, -1.95]]) put("planter", u, w, 0, { width: .6 });
      break;
    case "cottage": {
      lawn(); patch("plaza", 0, 1.55, .6, 1.4);
      const width = 3, depth = 2.3;
      put("cottage", 0, -.3, front(), { variant: 1, width, depth, tint: 5 });
      put("roof", 0, -.3, front(), { scale: 1.3, width: width + .3, depth: depth + .3, tint: 1, lift: 1.5 });
      put("tree-round", -1.9, 1.7, 0, { scale: .9 }); put("bush", 1.8, 1.8, 0);
      break;
    }
    case "house":
      patch("plaza", 0, 0, plot.size - .5, plot.size - .5);
      put("section", 0, -.35, front(), { variant: 1, width: 4, depth: 2.6, tint: 7 });
      put("planter", -1.5, 1.6, 0, { width: .6 }); put("planter", 1.5, 1.6, 0, { width: .6 }); put("bench", 0, 1.8, front(Math.PI), { width: .8 });
      break;
    case "tower":
      patch("plaza", 0, 0, plot.size - .5, plot.size - .5);
      put("glass-tower", 0, -.2, front(), { variant: 2, width: 3.2, depth: 3, tint: 2 });
      put("planter", -1.9, 1.9, 0, { width: .6 }); put("planter", 1.9, 1.9, 0, { width: .6 });
      break;
  }
  return { placements, surfaces };
}
