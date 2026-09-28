/**
 * Street lamps at night (TZ §6.7): a warm pool of light on the ground under every lamp and a soft halo
 * around every bulb, so the lamps read even without the bloom (low tier). Hundreds of point lights would
 * cost far too much, so the light is faked: two additive meshes of instanced quads, scaled by the night
 * level in their shaders: two draw calls at night, none in the day, and no CPU work but one visibility
 * check a frame. The bulbs themselves glow in the catalogue's lamp material, with the same level.
 */
import * as THREE from "three/webgpu";
import { abs, attribute, cameraPosition, cameraWorldMatrix, color, float, int, max, mix, positionGeometry, positionView, positionWorld, rangeFogFactor, smoothstep, uv, vec2 } from "three/tsl";
import type { CityContext } from "../engine/context";
import type { Placement, Road, WorldData } from "../world/types";
import { BRIDGE_HALF, segmentDistance } from "../world/generate";

/** Bulb centre: the lamps stand on the ground (0.2) and the catalogue hangs the bulb 1.35 above the foot. */
export const BULB_Y = .2 + 1.35;
/** Pools lie just above the highest paving around the lamps: streets (0.26) and zebra stripes (0.268). */
export const POOL_Y = .276;
export const POOL_RADIUS = 2.4;
/** Halo radius up close; farther away it keeps at least HALO_SPREAD × distance (2–3 px), dimmer. */
const HALO_RADIUS = .45, HALO_SPREAD = .0045, HALO_PULL = .05;
const POOL_STRENGTH = .5, HALO_STRENGTH = .95;
const POOL_WARM = "#ffd9a0", HALO_WARM = "#ffe2b4";
/** A few shades of warm white, so a row of lamps does not look stamped. */
const SHADES = ["#ffffff", "#fff0d8", "#ffe4c0", "#fff7ea", "#ffeacc"];
/** Deck offset of a lamp away from any bridge: its strip never reaches the pool. */
const NO_DECK = 1e3;

type LampQuads = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshBasicNodeMaterial>;
export interface LampLights {
  /** Light pools on the ground and halos around the bulbs, hidden while the night level is 0. */
  pools: LampQuads; halos: LampQuads;
  dispose(): void;
}

/**
 * The ground a lamp's pool may light, so no light hangs in the air over the lagoon or the canal (quay lamps
 * stand 0.25–0.55 from the wall): [inner, outer] radii of the land ring under the lamp, the nearest ring for a
 * lamp at a bridge head, and that bridge's deck as the angle of its normal and the centre line's offset from
 * the lamp along it (NO_DECK without a bridge). A lamp on an islet is not clipped.
 */
export function poolGround(world: WorldData, x: number, z: number): [number, number, number, number] {
  const r = Math.hypot(x, z), rings = world.land.annuli;
  if (world.land.islets.some(islet => Math.hypot(x - islet.x, z - islet.z) <= islet.r)) return [0, 1e6, 0, NO_DECK];
  const gap = (a: { inner: number; outer: number }) => r < a.inner ? a.inner - r : r > a.outer ? r - a.outer : 0;
  const land = rings.reduce<typeof rings[number] | null>((best, a) => !best || gap(a) < gap(best) ? a : best, null);
  const [inner, outer] = land ? [land.inner, land.outer] : [0, 1e6];
  if (land && !gap(land)) return [inner, outer, 0, NO_DECK];
  let deck: Road | null = null, nearest = POOL_RADIUS;
  for (const { road } of world.roads.bridges) { const d = segmentDistance(x, z, road); if (d < nearest) { deck = road; nearest = d; } }
  if (!deck) return [inner, outer, 0, NO_DECK];
  const [ax, az, bx, bz] = deck, length = Math.hypot(bx - ax, bz - az), nx = (az - bz) / length, nz = (bx - ax) / length;
  return [inner, outer, Math.atan2(nz, nx), (ax - x) * nx + (az - z) * nz];
}

/** Additive glow: never darkens, never hides what is behind, takes no fog colour (it fades by itself). */
const glowMaterial = () => new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });

/**
 * One copy of `quad` per lamp, all in one draw call: `lampAt` (vec3) is where a copy goes, `lampShade` its
 * tint and `extra` more per-lamp data. A plain mesh with instanced attributes, not an InstancedMesh: its
 * positionNode gives the world position itself (three r180 applies positionNode before an instance matrix,
 * so a node there cannot see where its copy is), and there is no matrix buffer to upload.
 */
function lampQuads(quad: THREE.BufferGeometry, lamps: Placement[], y: number, extra: Record<string, [Float32Array, number]> = {}) {
  const geometry = new THREE.InstancedBufferGeometry(), n = lamps.length, at = new Float32Array(n * 3), shades = new Float32Array(n * 3), shade = new THREE.Color();
  geometry.setIndex(quad.getIndex());
  for (const name of ["position", "normal", "uv"]) geometry.setAttribute(name, quad.getAttribute(name));
  lamps.forEach((lamp, i) => { at.set([lamp.x, y, lamp.z], i * 3); shade.set(SHADES[i * 3 % SHADES.length]).toArray(shades, i * 3); });
  const attributes: Record<string, [Float32Array, number]> = { lampAt: [at, 3], lampShade: [shades, 3], ...extra };
  for (const [name, [array, size]] of Object.entries(attributes)) geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, size));
  geometry.instanceCount = n;
  return geometry;
}

export function createLampLights(ctx: CityContext): LampLights {
  const lamps = ctx.world.placements.filter(p => p.kind === "lamp"), level = ctx.night.level;
  const fog = ctx.scene.fog instanceof THREE.Fog ? ctx.scene.fog : null;
  // Glow fades with the fog, as the ground and lamps under it do.
  const clear = fog ? rangeFogFactor(float(fog.near), float(fog.far)).oneMinus() : float(1);
  // 1 at the centre of a quad, 0 at its inscribed circle and beyond, smooth at both ends.
  const falloff = smoothstep(0, 1, uv().sub(.5).length().mul(2).oneMinus());
  // Attribute names are prefixed so they never meet a GLSL or WGSL word or one of three's own.
  const at = attribute("lampAt", "vec3"), shade = attribute("lampShade", "vec3");

  // Pools: flat quads on the ground, cut at the quay walls (the land ring) unless on a bridge deck.
  const grounds = new Float32Array(lamps.length * 4);
  lamps.forEach((lamp, i) => grounds.set(poolGround(ctx.world, lamp.x, lamp.z), i * 4));
  const pools = new THREE.Mesh(lampQuads(new THREE.PlaneGeometry(POOL_RADIUS * 2, POOL_RADIUS * 2).rotateX(-Math.PI / 2), lamps, POOL_Y, { lampGround: [grounds, 4] }), glowMaterial());
  const ground = attribute("lampGround", "vec4"), r = positionWorld.xz.length();
  // Edges ascending: smoothstep is undefined for edge0 ≥ edge1 in GLSL and WGSL.
  const onLand = smoothstep(ground.x, ground.x.add(.1), r).mul(smoothstep(ground.y.sub(.1), ground.y, r).oneMinus());
  const normal = vec2(ground.z.cos(), ground.z.sin()), onDeck = smoothstep(BRIDGE_HALF - .1, BRIDGE_HALF, abs(positionGeometry.xz.dot(normal).sub(ground.w))).oneMinus();
  pools.material.positionNode = at.add(positionGeometry);
  pools.material.colorNode = color(POOL_WARM).mul(shade);
  pools.material.opacityNode = falloff.mul(falloff).mul(max(onLand, onDeck)).mul(level).mul(clear).mul(POOL_STRENGTH);
  // Just above the paving; the offset keeps it ahead of the street tops at any distance.
  pools.material.polygonOffset = true; pools.material.polygonOffsetFactor = -2; pools.material.polygonOffsetUnits = -2;

  // Halos face the camera: every corner (±1) spans the camera's right and up around its bulb, a little in front
  // of it, so the shade stays a dark cap over the glow.
  const halos = new THREE.Mesh(lampQuads(new THREE.PlaneGeometry(2, 2), lamps, BULB_Y), glowMaterial());
  const toCamera = cameraPosition.sub(at), right = cameraWorldMatrix.element(int(0)).xyz, up = cameraWorldMatrix.element(int(1)).xyz;
  halos.material.positionNode = at.add(toCamera.normalize().mul(HALO_PULL))
    .add(right.mul(positionGeometry.x).add(up.mul(positionGeometry.y)).mul(max(float(HALO_RADIUS), toCamera.length().mul(HALO_SPREAD))));
  // A halo grown for distance spreads the same light: dimmer, but not so dim that far lamps vanish.
  const grown = float(HALO_RADIUS).div(max(float(HALO_RADIUS), positionView.z.negate().mul(HALO_SPREAD)));
  halos.material.colorNode = color(HALO_WARM).mul(shade);
  halos.material.opacityNode = falloff.pow(3).mul(mix(1, grown, .5)).mul(level).mul(clear.mul(.7).add(.3)).mul(HALO_STRENGTH);

  for (const mesh of [pools, halos]) {
    mesh.name = mesh === pools ? "city-lamp-pools" : "city-lamp-halos";
    // The shaders place the copies, so the quad's bounds say nothing; lamps stand all over the city anyway.
    mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.castShadow = mesh.receiveShadow = false;
    ctx.scene.add(mesh);
  }
  // Nothing is drawn in the day: the level is checked on the CPU, once a frame, without allocating.
  const show = () => { pools.visible = halos.visible = level.value > 0 && lamps.length > 0; };
  show();
  const offFrame = ctx.onFrame(show);

  return {
    pools, halos,
    dispose() {
      offFrame();
      ctx.scene.remove(pools, halos);
      for (const mesh of [pools, halos]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    },
  };
}
