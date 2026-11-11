/**
 * Cartoon mountain ranges: rounded shading, broad green slopes, blue-grey rock and clean cream snow caps.
 * Relief heights remain shared with the trees and railway cutting (world/relief.ts). The mesh still has one draw
 * and the same low-device budget; broad painted zones replace grit and strata. Layered haze follows the sky's
 * day/night colours and dissolves only the far map edge.
 */
import * as THREE from "three/webgpu";
import { cameraPosition, clamp, color, exp, float, max, mix, normalWorld, output, positionWorld, smoothstep, texture, vec2, vec4 } from "three/tsl";
import type { CityContext } from "../engine/context";
import type { WorldData } from "../world/types";
import { FOREST_REACH } from "../world/generate";
import { flatLand, groundHeight, landEdge, RELIEF_END, type FlatLand } from "../world/relief";
import { PORTAL_HOLE, RAIL_TOP, portalHole, railLocal, railPoint, type RailLine } from "../world/railway";
import { groundNoise } from "./ground";
import { FOG_NEAR, skyHaze, skyLook } from "./sky";

const TOP = .2, TAU = Math.PI * 2;
const MEADOW = "#8bd46a", DRY = "#b4dc77", FOREST = "#54a96b", ROCK = "#7f9fbe", ROCK_WARM = "#a8bdce", SNOW = "#fffaf0";
/** Faces meeting at more than this angle keep a sharp edge between them; gentler folds are shaded smooth. */
const CREASE = 60 * Math.PI / 180;
/**
 * The haze over the ranges, in world radii of the camera's distance: none nearer than HAZE_START (where the scene's
 * fog begins, so the city and its hills stay clear), then thickening over every HAZE_DEPTH, up to HAZE_MAX; twice
 * as thick on the valley floors as high on the crests (HAZE_HEIGHT units up). The last EDGE of the relief's reach
 * fades into the sky completely.
 */
export const HAZE_START = FOG_NEAR, HAZE_DEPTH = 1.15, HAZE_MAX = .82, HAZE_HEIGHT = 55, EDGE = .2;
/** Clear daytime air keeps the nearest ridges' colour and contrast; night retains its deeper veil. */
const DAY_HAZE_MAX = .55;
/**
 * The haze stays off the hills the forests stand on (world/generate.ts FOREST_REACH): the trees are copies with the
 * scene's fog only, and on hazed ground they would hang in the haze. It sets in past them over this share of a radius.
 */
export const FOREST_FADE = .3;
/** How far from the centre the haze stays off: the hill forests' reach. */
export const forestReach = (world: Pick<WorldData, "spec">) => world.spec.horizon + FOREST_REACH;
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
  const geometry = creasedGeometry(positions, indices, CREASE);
  const mesh = new THREE.Mesh(geometry, mountainMaterial(ctx, end));
  const material = mesh.material;
  // The ranges lie past the shadow map, where shading for shadows would only cost: they take none.
  mesh.name = "city-mountains"; mesh.receiveShadow = false; mesh.matrixAutoUpdate = false;
  ctx.scene.add(mesh);
  return { mesh, dispose() { ctx.scene.remove(mesh); geometry.dispose(); material.dispose(); } };
}

/**
 * Triangles of an indexed mesh as separate corners, each with the normal of the faces round its vertex that meet
 * its own face at less than `crease` (weighted by their areas): smooth over rounded ground, sharp where it folds.
 * The faces' own normals, not the shader's screen-space ones: those go wrong on the thin faces over the cutting once
 * they are narrower than a pixel far away.
 */
export function creasedGeometry(positions: ArrayLike<number>, indices: ArrayLike<number>, crease: number): THREE.BufferGeometry {
  const triangles = indices.length / 3, vertices = positions.length / 3, limit = Math.cos(crease);
  const area = new Float32Array(triangles * 3), unit = new Float32Array(triangles * 3);
  const first = new Int32Array(vertices + 1), around = new Int32Array(indices.length);
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    // (c - b) × (a - b), as BufferGeometry.computeVertexNormals: the side the triangles wind counter-clockwise.
    const ux = positions[c] - positions[b], uy = positions[c + 1] - positions[b + 1], uz = positions[c + 2] - positions[b + 2];
    const vx = positions[a] - positions[b], vy = positions[a + 1] - positions[b + 1], vz = positions[a + 2] - positions[b + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, length = Math.hypot(nx, ny, nz) || 1;
    area[t * 3] = nx; area[t * 3 + 1] = ny; area[t * 3 + 2] = nz;
    unit[t * 3] = nx / length; unit[t * 3 + 1] = ny / length; unit[t * 3 + 2] = nz / length;
    for (let k = 0; k < 3; k++) first[indices[t * 3 + k] + 1]++;
  }
  for (let v = 0; v < vertices; v++) first[v + 1] += first[v];
  const filled = first.slice(0, vertices);
  for (let t = 0; t < triangles; t++) for (let k = 0; k < 3; k++) around[filled[indices[t * 3 + k]]++] = t;
  const position = new Float32Array(triangles * 9), normal = new Float32Array(triangles * 9);
  for (let t = 0; t < triangles; t++) for (let k = 0; k < 3; k++) {
    const v = indices[t * 3 + k], o = (t * 3 + k) * 3;
    let x = 0, y = 0, z = 0;
    for (let i = first[v]; i < first[v + 1]; i++) {
      const f = around[i];
      if (unit[t * 3] * unit[f * 3] + unit[t * 3 + 1] * unit[f * 3 + 1] + unit[t * 3 + 2] * unit[f * 3 + 2] < limit) continue;
      x += area[f * 3]; y += area[f * 3 + 1]; z += area[f * 3 + 2];
    }
    const length = Math.hypot(x, y, z) || 1;
    position[o] = positions[v * 3]; position[o + 1] = positions[v * 3 + 1]; position[o + 2] = positions[v * 3 + 2];
    normal[o] = x / length; normal[o + 1] = y / length; normal[o + 2] = z / length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** The ranges' material: ground painted by height and slope, then the layers of haze (see the top of the file). */
function mountainMaterial(ctx: CityContext, end: number) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const p = positionWorld, height = p.y.sub(TOP), steep = float(1).sub(normalWorld.y), noise = groundNoise();
  // Broad painted zones follow the rounded relief. Fine strata and photographic grit disappear in the toy world.
  const jitter = texture(noise, p.xz.div(150)).x.sub(.5), patches = texture(noise, p.xz.div(240).add(.31)).y;
  const forest = clamp(height.sub(3).div(13).add(jitter.mul(.25)), 0, 1);
  const green = mix(mix(color(MEADOW), color(DRY), smoothstep(.55, .85, patches).mul(.22)), color(FOREST), forest);
  const rockLine = jitter.mul(20).add(56);
  const scrub = max(float(.38).sub(steep), 0).mul(float(1).sub(smoothstep(rockLine.add(12), rockLine.add(28), height)));
  const rock = mix(mix(color(ROCK), color(ROCK_WARM), patches), color(FOREST), scrub);
  const rocky = max(smoothstep(rockLine.sub(12), rockLine.add(14), height), smoothstep(.44, .64, steep));
  // Generous, scalloped cream snow caps read clearly on small screens, without noisy rock speckles.
  const snowLine = jitter.mul(32).add(104), hold = smoothstep(140, 175, height).mul(.16);
  const snow = smoothstep(snowLine.sub(4), snowLine.add(5), height).mul(float(1).sub(smoothstep(hold.add(.55), hold.add(.7), steep)));
  material.colorNode = mix(mix(green, rock, rocky), color(SNOW), snow);
  material.userData.cityModelStyle = "cartoon-v1";
  // Layers of haze over the lit, fogged colour (`output`): see HAZE_*; the sky's colour round each point.
  const radius = end / RELIEF_END, look = skyLook(ctx.scene);
  const toward = p.sub(cameraPosition), distance = toward.length();
  const depth = max(distance.sub(radius * HAZE_START), 0).div(radius * HAZE_DEPTH);
  const valley = exp(max(height, 0).div(-HAZE_HEIGHT)).mul(.5).add(.5);
  const reach = forestReach(ctx.world), fromCentre = vec2(p.x, p.z).length();
  const hazeStrength = mix(DAY_HAZE_MAX, HAZE_MAX, ctx.night.level);
  const haze = float(1).sub(exp(depth.mul(valley).negate())).mul(hazeStrength).mul(smoothstep(reach, reach + radius * FOREST_FADE, fromCentre));
  const veil = max(haze, smoothstep(end * (1 - EDGE), end, fromCentre));
  material.outputNode = vec4(mix(output.rgb, skyHaze(look, toward.div(distance)), veil), output.a);
  return material;
}
