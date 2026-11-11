/**
 * Smooth cartoon ground: vivid lawns, blue-grey roads and cream paving. The layout's surface codes and colours
 * still define each tile. One broad mipmapped sample softens grass patches; asphalt and paint have no micrograin.
 * The shared noise texture remains available to water/asset materials, without new uploads.
 */
import * as THREE from "three/webgpu";
import { attribute, color, float, mix, positionWorld, smoothstep, texture, vec3, vec4, vertexColor } from "three/tsl";

/** Surface kinds, stored per vertex in the `surface` attribute of every ground mesh. */
export const SURFACE = { plain: 0, grass: 1, asphalt: 2, pavement: 3, paint: 4, gravel: 5, stone: 6 } as const;
export type SurfaceCode = typeof SURFACE[keyof typeof SURFACE];

/** The palette of the layouts (render/terrain.ts, world/decor.ts, world/districtGarden.ts) by surface. */
const KINDS: [SurfaceCode, string[]][] = [
  [SURFACE.grass, ["#8ba67a", "#86a174", "#7f9f6a", "#8fb672", "#8dbb6f"]],
  [SURFACE.asphalt, ["#6d7385", "#7c8292", "#737a8a"]],
  [SURFACE.pavement, ["#eadfc8", "#e5dfcf", "#efe7d6", "#e2dbcc", "#d7cdb9", "#9aa1aa", "#ddd6c4", "#d7ccb6", "#c4bfb2", "#c9bda5", "#baac90", "#e3dbc9", "#d6cbb4"]],
  [SURFACE.paint, ["#f7f3e8", "#f6f3ea"]],
  [SURFACE.gravel, ["#cbb994", "#e9d6a3"]],
  [SURFACE.stone, ["#d4cab6", "#dcd3c1", "#e8e1d2", "#cfc5b1"]],
];
const BY_HEX = new Map<string, SurfaceCode>(KINDS.flatMap(([kind, hexes]) => hexes.map(hex => [hex.slice(1), kind] as [string, SurfaceCode])));
const probe = new THREE.Color();

/** The surface a layout colour stands for; anything else (water floor, playgrounds, courts) is plain. */
export function surfaceOf(colour: string | THREE.Color): SurfaceCode {
  const hex = typeof colour === "string" ? probe.set(colour).getHexString() : colour.getHexString();
  return BY_HEX.get(hex) ?? SURFACE.plain;
}

/** Surface codes for colours given as a flat array (3 or 4 numbers a vertex, linear, as three stores them). */
export function surfacesOfColours(colours: ArrayLike<number>, size: 3 | 4): Float32Array {
  const out = new Float32Array(colours.length / size);
  for (let i = 0; i < out.length; i++) out[i] = surfaceOf(probe.setRGB(colours[i * size], colours[i * size + 1], colours[i * size + 2]));
  return out;
}

const SIZE = 256;
let noise: THREE.DataTexture | null = null;
/**
 * Four channels of tileable value noise, each a few octaves: R broad patches, G medium, B fine grain, A spots. Shared
 * by every ground material; built once (a few milliseconds) and never disposed, like a font.
 */
export function groundNoise(): THREE.DataTexture {
  if (noise) return noise;
  const lattice = (period: number, salt: number) => {
    const values = new Float32Array(period * period);
    for (let i = 0; i < values.length; i++) {
      let h = Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 7, 2246822519);
      h = Math.imul(h ^ (h >>> 15), 2246822519); h ^= h >>> 13;
      values[i] = (h >>> 0) / 4294967296;
    }
    return { period, values };
  };
  const at = ({ period, values }: { period: number; values: Float32Array }, x: number, y: number) => {
    const fx = x / SIZE * period, fy = y / SIZE * period, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const v = (i: number, j: number) => values[((j % period) + period) % period * period + ((i % period) + period) % period];
    const a = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * sx, b = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
  const channels: [number, number][][] = [
    [[4, .5], [8, .3], [16, .2]],
    [[8, .5], [16, .3], [32, .2]],
    [[64, .45], [128, .35], [256, .2]],
    [[16, .6], [32, .4]],
  ];
  const octaves = channels.map((list, c) => list.map(([period, weight], k) => ({ grid: lattice(period, c * 10 + k), weight })));
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) for (let c = 0; c < 4; c++) {
    let sum = 0;
    for (const { grid, weight } of octaves[c]) sum += at(grid, x, y) * weight;
    data[(y * SIZE + x) * 4 + c] = Math.round(Math.min(1, Math.max(0, sum)) * 255);
  }
  noise = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.magFilter = THREE.LinearFilter; noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.generateMipmaps = true; noise.anisotropy = 4; noise.name = "ground-noise";
  noise.needsUpdate = true;
  return noise;
}

/**
 * A ground material: its colour from the `color` attribute, its surface from the `surface` attribute (surfaceOf).
 * Extra parameters (polygon offset for the layers over the ground) pass through.
 */
export function groundMaterial(parameters: THREE.MeshStandardNodeMaterialParameters = {}): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .96, metalness: 0, ...parameters, vertexColors: false });
  const base = vertexColor().xyz, kind = attribute("surface", "float");
  const is = (code: SurfaceCode) => float(1).sub(kind.sub(code).abs()).clamp(0, 1);
  // One broad, mipmapped variation across the lawns: smooth toy surfaces have no gravel grain or worn paint.
  const broad = smoothstep(.25, .75, texture(groundNoise(), positionWorld.xz.div(120)).x);
  const lawn = mix(base.mul(vec3(.8, 1.55, .72)), color("#8bd569"), .3).mul(mix(.97, 1.025, broad));
  const asphalt = mix(base, color("#657587"), .82);
  const pavement = mix(base, color("#f3e5c5"), .4);
  const paint = mix(base, color("#fff9e8"), .3);
  const gravel = mix(base, color("#ddc79a"), .55);
  const stone = mix(base, color("#ded4ba"), .3);
  const rgb = base.mul(is(SURFACE.plain)).add(lawn.mul(is(SURFACE.grass))).add(asphalt.mul(is(SURFACE.asphalt)))
    .add(pavement.mul(is(SURFACE.pavement))).add(paint.mul(is(SURFACE.paint))).add(gravel.mul(is(SURFACE.gravel))).add(stone.mul(is(SURFACE.stone)));
  material.colorNode = vec4(rgb, 1);
  material.userData.cityModelStyle = "cartoon-v1";
  return material;
}
