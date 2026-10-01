/**
 * Hills and mountains round the city (world/relief.ts): one low-poly mesh from the edge of the flat land (the
 * island city's horizon or the lake city's rectangle) out past the fog, painted by height and slope — meadow,
 * forest green on the hills, grey rock on steep and high slopes, snow on the peaks — so the fog turns the ranges
 * into hazy silhouettes behind the skyline. One draw call; it only receives shadows (it lies beyond the shadow map
 * anyway). Over the railway's cutting the rays run four times closer; at the tunnel (world/railway.ts) rings close
 * together frame the portal: the hill's face has a hole the portal's hood fills, through which the bore stays open,
 * and the slope down to the hood keeps its shape.
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import { fbm, flatLand, groundHeight, landEdge, RELIEF_END, type FlatLand } from "../world/relief";
import { PORTAL_HOLE, RAIL_TOP, portalHole, railLocal, railPoint, type RailLine } from "../world/railway";

const TOP = .2, TAU = Math.PI * 2;
const MEADOW = new THREE.Color("#86a174"), FOREST = new THREE.Color("#5c7c52"), ROCK = new THREE.Color("#8e8a83"), SNOW = new THREE.Color("#eef2f5");
/** The face's rings, along the track from the face: the cutting's last, the hole's bottom, the hill's first, then the slope over the portal. */
const FACE_RINGS = [-.2, -.1, .1, 1.5, 3, 5, 7.5, 10.5];

export interface Mountains { mesh: THREE.Mesh; dispose(): void }

const angleOf = (p: { x: number; z: number }) => (Math.atan2(p.z, p.x) + TAU) % TAU;
/**
 * Directions of the rays: evenly round, four times as dense over the railway's cutting, through a rectangle's
 * corners, and through the points of the hole's outline (and just past its sides) so its shape is the same on
 * every device.
 */
function rayAngles(segments: number, land: FlatLand, line: RailLine | undefined) {
  const step = TAU / segments, list: number[] = [];
  const face = line && railPoint(line, line.length), focus = face ? angleOf(face) : 0;
  // The cutting and its banks reach about 34 across, from where the hills begin.
  const spread = face ? Math.atan2(34, landEdge(land, focus)) : -1;
  const off = (a: number) => Math.abs(((a - focus) % TAU + TAU + Math.PI) % TAU - Math.PI);
  for (let i = 0; i < segments; i++) {
    const a = i * step;
    if (!face || Math.min(off(a), off(a + step)) > spread) { list.push(a); continue; }
    for (let k = 0; k < 4; k++) list.push(a + k * step / 4);
  }
  if ("halfX" in land) for (const [x, z] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) list.push(angleOf({ x: x * land.halfX, z: z * land.halfZ }));
  if (line) for (const [w] of [...PORTAL_HOLE, [PORTAL_HOLE[PORTAL_HOLE.length - 1][0] + .25]]) for (const sign of [-1, 1]) list.push(angleOf(railPoint(line, line.length, sign * w)));
  return list.sort((a, b) => a - b).filter((a, i, all) => i === 0 || a - all[i - 1] > 1e-7);
}
/**
 * Ring steps from the flat land's edge (0) to the end (1), closer together near the city, and the face's: `hole` is
 * the index of the one where the hole's outline lies. No other ring falls between the face's first three.
 */
function ringSteps(rings: number, land: FlatLand, line: RailLine | undefined, end: number) {
  const list = Array.from({ length: rings + 1 }, (_, k) => Math.pow(k / rings, 1.7));
  if (!line) return { steps: list, hole: -1 };
  const face = railPoint(line, line.length), r0 = landEdge(land, angleOf(face));
  const at = FACE_RINGS.map(du => { const p = railPoint(line, line.length + du); return (Math.hypot(p.x, p.z) - r0) / (end - r0); });
  const steps = [...list.filter(t => t < at[0] || t > at[2]), ...at].sort((a, b) => a - b);
  return { steps, hole: steps.indexOf(at[1]) };
}

/** `end`: how far out the mesh reaches; by default a little past the fog of this city's own size. */
export function createMountains(ctx: CityContext, options: { end?: number } = {}): Mountains {
  // Phones and weak GPUs get a third of the triangles: the ranges are far away and fogged anyway.
  const light = ctx.mobile || ctx.quality.tier === "low", SEGMENTS = light ? 200 : 360, RINGS = light ? 44 : 72;
  const land = flatLand(ctx.world), line = ctx.world.railway, end = options.end ?? ctx.world.radius * RELIEF_END;
  const angles = rayAngles(SEGMENTS, land, line), { steps, hole } = ringSteps(RINGS, land, line, end), count = angles.length;
  const positions: number[] = [], indices: number[] = [], inHole: boolean[] = [];
  steps.forEach((t, k) => angles.forEach((a, i) => {
    const r0 = landEdge(land, a), r = r0 + (end - r0) * t, x = Math.cos(a) * r, z = Math.sin(a) * r;
    let h = groundHeight(land, x, z, line);
    if (k === hole && line) {
      // The hole's outline: the face starts at the hood's edge here instead of at the cutting's floor.
      const top = portalHole(railLocal(line, x, z).w);
      inHole[i] = top !== null;
      if (top !== null) h = Math.max(h, Math.min(groundHeight(land, x, z), RAIL_TOP + top));
    }
    positions.push(x, TOP + h, z);
  }));
  for (let k = 0; k < steps.length - 1; k++) for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    // Below the hole's outline the face stays open: the bore runs on into the hill there.
    if (k === hole - 1 && inHole[i] && inHole[j]) continue;
    const a = k * count + i, b = k * count + j, c = a + count, d = b + count;
    indices.push(a, b, c, b, d, c);
  }
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  // Flat faces for the low-poly look of the rest of the city: every triangle its own normal and colour.
  const flat = geometry.toNonIndexed(); geometry.dispose(); geometry = flat;
  geometry.computeVertexNormals();
  const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal"), colors = new Float32Array(position.count * 3), paint = new THREE.Color();
  for (let t = 0; t < position.count; t += 3) {
    const y = (position.getY(t) + position.getY(t + 1) + position.getY(t + 2)) / 3 - TOP, x = position.getX(t), z = position.getZ(t);
    const steep = 1 - normal.getY(t), jitter = fbm(x / 23, z / 23, 2) - .5;
    const snowLine = 118 + jitter * 40, rockLine = 48 + jitter * 30;
    if (y > snowLine && steep < .55) paint.copy(SNOW);
    else if (y > rockLine || steep > .45) paint.copy(ROCK).lerp(FOREST, Math.max(0, .35 - steep) * (y < rockLine + 20 ? 1 : 0));
    else paint.copy(MEADOW).lerp(FOREST, Math.min(1, Math.max(0, (y - 2.5) / 9 + jitter * .6)));
    paint.offsetHSL(0, 0, jitter * .05);
    for (let v = 0; v < 3; v++) paint.toArray(colors, (t + v) * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  // The faces' own normals (computed above), not the shader's screen-space ones: those go wrong on the thin
  // faces over the cutting once they are narrower than a pixel far away.
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .95, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "city-mountains"; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
  ctx.scene.add(mesh);
  return { mesh, dispose() { ctx.scene.remove(mesh); geometry.dispose(); material.dispose(); } };
}
