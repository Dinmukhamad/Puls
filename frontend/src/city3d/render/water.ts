/**
 * The city's lagoon and canal (docs/CITY_V4.md, stage 3). One material, no reflection pass on any quality tier:
 * - waves: a small tileable normal map generated once (waveNormals, 128 × 128 with mip levels), read twice at
 *   different sizes and directions, drifting with time; the waves calm down with distance and the mip levels
 *   average them out, so far water never sparkles;
 * - the sky in the water: a Fresnel mix of the water's own colour and the sky's gradient in the reflected
 *   direction (render/sky.ts skyLook: the colours of the time of day), computed in the shader; below the
 *   ridge line round the city it mirrors the hazy hills instead (dark at night), so the far water never turns white;
 * - the sun's glints from the light itself on the low-roughness waves; at night the moon's path, where a wave
 *   turns the view onto the moon's disc;
 * - colour by depth from the shore attribute: turquoise over the shallows, deep blue in the middle, and a light
 *   strip of lapping water along every quay wall and islet;
 * - at night a deep palette, and the lamps, windows and bridges along the shores mirrored in it as warm streaks
 *   (a noise term × ctx.night.level in the emissive, no extra pass).
 * The surface stays at y = -1.25 beneath the existing quays and bridges.
 */
import * as THREE from "three/webgpu";
import { attribute, cameraPosition, cameraWorldMatrix, color, dot, float, int, max, mix, normalize, positionWorld, pow, reflect, smoothstep, texture, transformNormalToView, uniform, vec2, vec3 } from "three/tsl";
import type { CityContext } from "../engine/context";
import type { WorldData } from "../world/types";
import { BRIDGE_HALF, segmentDistance } from "../world/generate";
import { centerContains, centerShoreDistance } from "../world/civicCenter";
import { groundNoise } from "./ground";
import { HORIZON, skyGradient, skyLook } from "./sky";

export interface Water { mesh: THREE.Mesh; setNight(night: boolean): void; dispose(): void }

/** The water level; the land tops are at 0.2 and the quay walls reach down to -1.75. */
export const WATER_Y = -1.25;
/** Shallow water fades into deep over this distance from the shore. */
const SHELF = 4.5;
/** Night reflections fade out this far from a shore or a bridge's edge; their colour and strength. */
const REFLECTION_REACH = 3.2, REFLECTION = "#ffc684", REFLECTION_GLOW = .55;
/** Wave tiles: the long swell and the short chop, in world units (a tile holds waves of 1/9 of it up to all of it). */
const SWELL = 8, CHOP = 2.6;
/**
 * What the water mirrors low over the horizon: the hills and ridges round the city, hazed by day and dark at
 * night. Their crest stands between these elevations (sines), wandering round the circle.
 */
const RIDGE_LOW = .03, RIDGE_HIGH = .24, HILLS = "#56784a", HILLS_NIGHT = "#0a121d";

/**
 * An annulus of water divided into rings about 1.5 units apart, so the per-vertex `shore` distance (to the
 * annulus edges and to every islet in it) follows the shore closely enough for the depth tint.
 */
function waterGeometry(world: WorldData) {
  const positions: number[] = [], shore: number[] = [], bridge: number[] = [], indices: number[] = [];
  for (const { inner, outer } of world.water.annuli) {
    // Under the land by a little at both edges, as the old rings were, so no gap shows at the walls.
    const r0 = Math.max(0, inner - .5), r1 = outer + .5, rings = Math.max(2, Math.ceil((r1 - r0) / 1.5)), sides = Math.min(720, Math.max(96, Math.round(2 * Math.PI * r1 / 1.5)));
    const islets = world.land.islets.filter(i => Math.hypot(i.x, i.z) + i.r > inner && Math.hypot(i.x, i.z) - i.r < outer);
    const center = world.center && outer <= world.spec.lagoon + .01 ? world.center : null;
    const bridges = world.roads.bridges.map(b => b.road);
    const start = positions.length / 3;
    for (let k = 0; k <= rings; k++) {
      const r = r0 + (r1 - r0) * k / rings;
      for (let s = 0; s < sides; s++) {
        const a = s / sides * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
        let d = Math.min(r - inner, outer - r);
        if (center) {
          // The connected park covers the old islets; only its actual coast and reflecting-pool walls form shores.
          const point = { x, z };
          d = centerContains(center, point) ? 0 : Math.min(outer - r, centerShoreDistance(center, point));
        } else for (const i of islets) d = Math.min(d, Math.hypot(x - i.x, z - i.z) - i.r);
        positions.push(x, WATER_Y, z); shore.push(THREE.MathUtils.clamp(d / SHELF, 0, 1));
        // 1 under a bridge's edge, 0 from REFLECTION_REACH beyond it: where its lamps and cars mirror at night.
        let b = Infinity;
        for (const road of bridges) b = Math.min(b, segmentDistance(x, z, road) - BRIDGE_HALF);
        bridge.push(THREE.MathUtils.clamp(1 - b / REFLECTION_REACH, 0, 1));
      }
    }
    for (let k = 0; k < rings; k++) for (let s = 0; s < sides; s++) {
      const a = start + k * sides + s, b = start + k * sides + (s + 1) % sides, c = a + sides, d = b + sides;
      indices.push(a, d, c, a, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(positions.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  g.setAttribute("shore", new THREE.Float32BufferAttribute(shore, 1));
  g.setAttribute("bridge", new THREE.Float32BufferAttribute(bridge, 1));
  g.setIndex(positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  return g;
}

let waves: THREE.DataTexture | null = null;
/**
 * The wave normal map: 128 × 128, its x and z slopes in red and green (0.5 is level), from a few dozen waves of
 * whole frequencies so it tiles, longer ones stronger, in random directions and phases. Built once (a few
 * milliseconds) with mip levels, and kept for the session like the ground's noise.
 */
export function waveNormals(): THREE.DataTexture {
  if (waves) return waves;
  const SIZE = 128, data = new Uint8Array(SIZE * SIZE * 4), slopes = new Float32Array(SIZE * SIZE * 2);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const list: [number, number, number, number][] = [];
  while (list.length < 30) {
    const kx = Math.round((random() * 2 - 1) * 9), ky = Math.round((random() * 2 - 1) * 9), f = Math.hypot(kx, ky);
    if (f < 1 || f > 9.5) continue;
    list.push([kx, ky, 1 / Math.pow(f, 1.6), random() * Math.PI * 2]);
  }
  let peak = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    let du = 0, dv = 0;
    for (const [kx, ky, a, phase] of list) {
      const c = Math.cos(2 * Math.PI * (kx * x + ky * y) / SIZE + phase) * a * 2 * Math.PI;
      du += c * kx; dv += c * ky;
    }
    slopes[(y * SIZE + x) * 2] = du; slopes[(y * SIZE + x) * 2 + 1] = dv;
    peak = Math.max(peak, Math.abs(du), Math.abs(dv));
  }
  for (let i = 0; i < SIZE * SIZE; i++) {
    data[i * 4] = Math.round((slopes[i * 2] / peak * .5 + .5) * 255);
    data[i * 4 + 1] = Math.round((slopes[i * 2 + 1] / peak * .5 + .5) * 255);
    data[i * 4 + 2] = 128; data[i * 4 + 3] = 255;
  }
  waves = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  waves.wrapS = waves.wrapT = THREE.RepeatWrapping;
  waves.magFilter = THREE.LinearFilter; waves.minFilter = THREE.LinearMipmapLinearFilter;
  waves.generateMipmaps = true; waves.anisotropy = 4; waves.name = "water-waves";
  waves.needsUpdate = true;
  return waves;
}

export function createWater(ctx: CityContext): Water {
  const time = uniform(0), night = uniform(0);
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .1, metalness: 0 });
  const p = positionWorld, shore = attribute("shore", "float");

  // Waves: the swell and the chop drift different ways; both calm down with distance (the mip levels do the rest).
  const map = waveNormals(), slope = (at: Parameters<typeof texture>[1]) => texture(map, at).xy.mul(2).sub(1);
  const swell = slope(p.xz.div(SWELL).add(vec2(time.mul(.011), time.mul(.007))));
  const chop = slope(vec2(p.x.mul(.8).sub(p.z.mul(.6)), p.x.mul(.6).add(p.z.mul(.8))).div(CHOP).add(vec2(time.mul(-.019), time.mul(.024))));
  const distance = cameraPosition.sub(p).length(), calm = smoothstep(20, 240, distance);
  const tilt = swell.mul(.17).add(chop.mul(.13)).mul(mix(1, .3, calm));
  const normal = normalize(vec3(tilt.x.negate(), 1, tilt.y.negate()));
  material.normalNode = transformNormalToView(normal);

  // The sky in the water: Fresnel from the view's angle to the wave, the sky's gradient in the reflected
  // direction; below the ridge line (a noise read round a circle, so it has no seam) the hazy hills instead.
  const view = cameraPosition.sub(p).normalize(), facing = max(dot(normal, view), 0);
  const fresnel = float(.02).add(pow(facing.oneMinus(), 5).mul(.98));
  const reflected = reflect(view.negate(), normal), look = skyLook(ctx.scene);
  const sky = skyGradient(look, vec3(reflected.x, max(reflected.y, 0), reflected.z));
  const around = reflected.xz.div(max(reflected.xz.length(), 1e-4));
  const ridge = mix(RIDGE_LOW, RIDGE_HIGH, smoothstep(.3, .7, texture(groundNoise(), around.mul(.25).add(.5)).x));
  const hills = mix(mix(color(HILLS), color(HILLS_NIGHT), night), look?.horizon ?? color(HORIZON), .35);
  const mirrored = mix(hills, sky, smoothstep(ridge.sub(.035), ridge.add(.025), reflected.y));

  // Colour by depth: turquoise shallows, deep blue in the middle; a light strip of lapping water at the walls.
  const deep = smoothstep(0, 1, shore);
  const day = mix(color("#28c7c5"), color("#087eaf"), deep), dusk = mix(color("#2a6482"), color("#0e2945"), deep);
  const lap = smoothstep(0, .14, shore).oneMinus();
  const froth = texture(groundNoise(), p.xz.mul(.42).add(vec2(time.mul(.02), time.mul(-.013)))).y;
  const bands = shore.mul(46).sub(time.mul(1.7)).add(froth.mul(5)).sin().mul(.5).add(.5);
  const foam = lap.mul(smoothstep(.35, .8, froth.mul(.6).add(bands.mul(.55)))).mul(mix(.8, .35, night));
  const body = mix(day, dusk, night);
  material.colorNode = mix(body.mul(fresnel.oneMinus()), color("#dcebec").mul(mix(1, .25, night)), foam);
  material.roughnessNode = mix(mix(.09, .17, calm), .6, foam);

  // Night reflections: light on rippled water stretches towards the viewer, so the streaks run along the
  // camera's heading (one frame for the whole view) and the ripples break them up; only near the shores
  // (lamps, windows) and under the bridges. Nothing is added by day (level 0).
  const heading = cameraWorldMatrix.element(int(2)).xz, forward = heading.div(max(heading.length(), 1e-4));
  const along = dot(p.xz, forward), across = dot(p.xz, vec2(forward.y.negate(), forward.x));
  const streak = smoothstep(.3, 1, across.mul(2.9).add(along.mul(.31).add(time.mul(.5)).sin().mul(1.2)).sin())
    .mul(across.mul(1.13).add(2.1).sin().mul(.45).add(.55))
    .mul(along.mul(2.1).sub(time.mul(1.6)).add(across.mul(.7)).sin().mul(.4).add(.6));
  const reach = SHELF / REFLECTION_REACH, shores = max(float(1).sub(shore.mul(reach)).max(0).pow(2), attribute("bridge", "float").pow(2).mul(.7));
  const lights = color(REFLECTION).mul(shores).mul(streak.mul(.85).add(.15)).mul(ctx.night.level).mul(REFLECTION_GLOW);
  // The moon's path: glints where a wave turns the view onto the moon's disc (the moonlight itself comes from
  // higher up, render/sky.ts); nothing by day (moonLight is black).
  const moonPath = (look?.moonLight ?? vec3(0)).mul(pow(max(dot(reflected, look?.moon ?? vec3(0, 1, 0)), 0), 1800)).mul(fresnel).mul(2.5);
  material.emissiveNode = mirrored.mul(fresnel).add(moonPath).mul(foam.oneMinus()).mul(.85).add(lights);

  const mesh = new THREE.Mesh(waterGeometry(ctx.world), material);
  mesh.name = "city-water"; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
  ctx.scene.add(mesh);
  const offFrame = ctx.reducedMotion ? () => {} : ctx.onFrame(dt => { time.value += dt; });

  return {
    mesh,
    setNight(value) { night.value = value ? 1 : 0; },
    dispose() { offFrame(); ctx.scene.remove(mesh); mesh.geometry.dispose(); material.dispose(); },
  };
}
