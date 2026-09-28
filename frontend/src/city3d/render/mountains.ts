/**
 * Hills and mountains round the city (world/relief.ts): one low-poly mesh from the horizon out past the fog,
 * painted by height and slope — meadow, forest green on the hills, grey rock on steep and high slopes, snow on
 * the peaks — so the fog turns the ranges into hazy silhouettes behind the skyline. One draw call; it only
 * receives shadows (it lies beyond the shadow map anyway).
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import { fbm, RELIEF_END, reliefHeight } from "../world/relief";

const TOP = .2;
const MEADOW = new THREE.Color("#86a174"), FOREST = new THREE.Color("#5c7c52"), ROCK = new THREE.Color("#8e8a83"), SNOW = new THREE.Color("#eef2f5");

export interface Mountains { mesh: THREE.Mesh; dispose(): void }

export function createMountains(ctx: CityContext): Mountains {
  // Phones and weak GPUs get a third of the triangles: the ranges are far away and fogged anyway.
  const light = ctx.mobile || ctx.quality.tier === "low", SEGMENTS = light ? 200 : 360, RINGS = light ? 44 : 72;
  const start = ctx.world.spec.horizon, end = ctx.world.radius * RELIEF_END, positions: number[] = [], indices: number[] = [];
  // Rings closer together near the city, where the hills are seen from near by.
  for (let k = 0; k <= RINGS; k++) {
    const r = start + (end - start) * Math.pow(k / RINGS, 1.7);
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i / SEGMENTS * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      positions.push(x, TOP + reliefHeight(x, z, start), z);
    }
  }
  for (let k = 0; k < RINGS; k++) for (let i = 0; i < SEGMENTS; i++) {
    const a = k * SEGMENTS + i, b = k * SEGMENTS + (i + 1) % SEGMENTS, c = a + SEGMENTS, d = b + SEGMENTS;
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
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .95, metalness: 0, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "city-mountains"; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
  ctx.scene.add(mesh);
  return { mesh, dispose() { ctx.scene.remove(mesh); geometry.dispose(); material.dispose(); } };
}
