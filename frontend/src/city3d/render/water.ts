/**
 * Turquoise water on the city's lagoon and canal. Analytic ripples and a shore-depth
 * attribute provide colour variation in one material, with no reflection render pass. Night switches
 * to a deep blue palette, and the lamps, windows and bridges along the shores mirror in it as warm
 * streaks (a noise term × ctx.night.level in the emissive, no extra pass). The surface stays at y=-1.25
 * beneath the existing quays and bridges.
 */
import * as THREE from "three/webgpu";
import { attribute, cameraWorldMatrix, color, dot, float, int, materialEmissive, max, mix, positionWorld, smoothstep, uniform, vec2 } from "three/tsl";
import type { CityContext } from "../engine/context";
import type { WorldData } from "../world/types";
import { BRIDGE_HALF, segmentDistance } from "../world/generate";

export interface Water { mesh: THREE.Mesh; setNight(night: boolean): void; dispose(): void }

/** The water level; the land tops are at 0.2 and the quay walls reach down to -1.75. */
export const WATER_Y = -1.25;
/** Shallow water fades into deep over this distance from the shore. */
const SHELF = 4.5;
/** Night reflections fade out this far from a shore or a bridge's edge; their colour and strength. */
const REFLECTION_REACH = 3.2, REFLECTION = "#ffc684", REFLECTION_GLOW = .55;

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
    const bridges = world.roads.bridges.map(b => b.road);
    const start = positions.length / 3;
    for (let k = 0; k <= rings; k++) {
      const r = r0 + (r1 - r0) * k / rings;
      for (let s = 0; s < sides; s++) {
        const a = s / sides * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
        let d = Math.min(r - inner, outer - r);
        for (const i of islets) d = Math.min(d, Math.hypot(x - i.x, z - i.z) - i.r);
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

export function createWater(ctx: CityContext): Water {
  const time = uniform(0), night = uniform(0);
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .32, metalness: .18 });
  // A turquoise palette and calm analytic ripples, following every shore.
  const p = positionWorld;
  const ripple = p.x.mul(.85).add(p.z.mul(1.6)).add(time.mul(.7)).sin()
    .mul(p.z.mul(.66).sub(time.mul(.4)).sin()).mul(.5).add(.5);
  const coast = float(1).sub(attribute("shore", "float"));
  const day = mix(color("#167f9e"), color("#67cfc4"), coast.mul(.58).add(ripple.mul(.08)));
  const evening = mix(color("#142c4b"), color("#39768c"), coast.mul(.6).add(ripple.mul(.05)));
  material.colorNode = mix(day, evening, night);
  material.emissive.set("#0b263b"); material.emissiveIntensity = .25;
  // Night reflections: light on rippled water stretches towards the viewer, so the streaks run along the
  // camera's heading (one frame for the whole view) and the ripples break them up; only near the shores
  // (lamps, windows) and under the bridges. Nothing is added by day (level 0).
  const heading = cameraWorldMatrix.element(int(2)).xz, forward = heading.div(max(heading.length(), 1e-4));
  const along = dot(p.xz, forward), across = dot(p.xz, vec2(forward.y.negate(), forward.x));
  const streak = smoothstep(.3, 1, across.mul(2.9).add(along.mul(.31).add(time.mul(.5)).sin().mul(1.2)).sin())
    .mul(across.mul(1.13).add(2.1).sin().mul(.45).add(.55))
    .mul(along.mul(2.1).sub(time.mul(1.6)).add(across.mul(.7)).sin().mul(.4).add(.6));
  const reach = SHELF / REFLECTION_REACH, shores = max(float(1).sub(attribute("shore", "float").mul(reach)).max(0).pow(2), attribute("bridge", "float").pow(2).mul(.7));
  material.emissiveNode = materialEmissive.add(color(REFLECTION).mul(shores).mul(streak.mul(.85).add(.15)).mul(ctx.night.level).mul(REFLECTION_GLOW));

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
