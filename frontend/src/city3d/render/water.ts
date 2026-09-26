/**
 * Water (TZ §6.5, quality "sky" of stage 1): one TSL material for the lagoon and the canal. Two layers
 * of procedural noise scroll in different directions and bend the normal (no texture files); a Fresnel
 * term mixes the water's own colour towards the sky it reflects (the sky's gradient, evaluated in the
 * reflected direction, so no environment map is needed); the sun leaves a glint. The colour darkens from
 * the shallows at the quays towards the middle: a depth tint without transparency. The surface lies at
 * y = -1.25, receives shadows, and its waves stop with prefers-reduced-motion, as in the old city.
 */
import * as THREE from "three/webgpu";
import { attribute, cameraPosition, cameraViewMatrix, color, dot, float, max, mix, mx_noise_vec3, normalize, pow, positionWorld, reflect, uniform, vec2, vec3, vec4 } from "three/tsl";
import type { CityContext } from "../engine/context";
import type { WorldData } from "../world/types";
import type { Sky } from "./sky";

export interface Water { mesh: THREE.Mesh; dispose(): void }

/** The water level; the land tops are at 0.2 and the quay walls reach down to -1.75. */
export const WATER_Y = -1.25;
const SHALLOW = "#63a6a3", DEEP = "#2b6970";
/** Shallow water fades into deep over this distance from the shore. */
const SHELF = 4.5;

/**
 * An annulus of water divided into rings about 1.5 units apart, so the per-vertex `shore` distance (to the
 * annulus edges and to every islet in it) follows the shore closely enough for the depth tint.
 */
function waterGeometry(world: WorldData) {
  const positions: number[] = [], shore: number[] = [], indices: number[] = [];
  for (const { inner, outer } of world.water.annuli) {
    // Under the land by a little at both edges, as the old rings were, so no gap shows at the walls.
    const r0 = Math.max(0, inner - .5), r1 = outer + .5, rings = Math.max(2, Math.ceil((r1 - r0) / 1.5)), sides = Math.min(720, Math.max(96, Math.round(2 * Math.PI * r1 / 1.5)));
    const islets = world.land.islets.filter(i => Math.hypot(i.x, i.z) + i.r > inner && Math.hypot(i.x, i.z) - i.r < outer);
    const start = positions.length / 3;
    for (let k = 0; k <= rings; k++) {
      const r = r0 + (r1 - r0) * k / rings;
      for (let s = 0; s < sides; s++) {
        const a = s / sides * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
        let d = Math.min(r - inner, outer - r);
        for (const i of islets) d = Math.min(d, Math.hypot(x - i.x, z - i.z) - i.r);
        positions.push(x, WATER_Y, z); shore.push(THREE.MathUtils.clamp(d / SHELF, 0, 1));
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
  g.setIndex(positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  return g;
}

export function createWater(ctx: CityContext, sky?: Sky): Water {
  const time = uniform(0);
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .6, metalness: 0 });

  // Two noise layers, large slow swell and small quick ripples, drifting in different directions.
  const p = positionWorld.xz;
  const swell = mx_noise_vec3(p.mul(.21).add(vec2(time.mul(.04), time.mul(.016))));
  const ripple = mx_noise_vec3(p.mul(1.7).sub(vec2(time.mul(.05), time.mul(.12))));
  const slope = swell.xy.mul(.13).add(ripple.xy.mul(.1));
  const normal = normalize(vec3(slope.x.negate(), float(1), slope.y.negate()));

  const toCamera = normalize(cameraPosition.sub(positionWorld));
  const facing = max(dot(normal, toCamera), float(0));
  const fresnel = float(.02).add(float(.98).mul(pow(float(1).sub(facing), float(5))));
  const reflected = reflect(toCamera.negate(), normal);
  // Reflections never look below the horizon: the waves would show the fog colour in the water.
  const skyDirection = normalize(vec3(reflected.x, max(reflected.y, float(.03)), reflected.z));
  const skyColor = sky ? sky.gradient(skyDirection) : mix(color("#d6e9ef"), color("#86bfe4"), skyDirection.y);
  const sunDirection = sky?.sunDirection ?? uniform(new THREE.Vector3(-52, 46, 34).normalize());
  const sunColor = sky?.sunColor ?? uniform(new THREE.Color("#ffe4bd").multiplyScalar(3.3));
  const glint = pow(max(dot(reflected, sunDirection), float(0)), float(320)).mul(2.2);

  const depth = attribute("shore", "float");
  material.colorNode = vec4(mix(color(SHALLOW), color(DEEP), depth).mul(float(1).sub(fresnel)), 1);
  material.emissiveNode = skyColor.mul(fresnel.mul(.85)).add(sunColor.mul(glint));
  // normalNode is in view space.
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(normal, 0)).xyz);

  const mesh = new THREE.Mesh(waterGeometry(ctx.world), material);
  mesh.name = "city-water"; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
  ctx.scene.add(mesh);
  const offFrame = ctx.reducedMotion ? () => {} : ctx.onFrame(dt => { time.value += dt; });

  return {
    mesh,
    dispose() { offFrame(); ctx.scene.remove(mesh); mesh.geometry.dispose(); material.dispose(); },
  };
}
