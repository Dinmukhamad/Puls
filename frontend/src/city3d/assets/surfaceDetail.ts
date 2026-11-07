/** Shared fine surface detail for props and imported models; no added textures or render passes. */
import * as THREE from "three/webgpu";
import { attribute, bumpMap, cameraPosition, float, materialColor, materialEmissive, max, mix, normalWorld, positionWorld, reflect, smoothstep, texture, vec3, vertexColor } from "three/tsl";
import { groundNoise } from "../render/ground";
import { skyGradient, type SkyLook } from "../render/sky";
import type { Model } from "./loader";

export type SurfaceFinish = "stone" | "wood" | "metal" | "paint" | "glass" | "cloth" | "foliage";
interface DetailOptions extends THREE.MeshStandardMaterialParameters {
  finish?: SurfaceFinish;
  look?: SkyLook | null;
  /** Courtyard/vegetation models bake physical roughness and metalness per surface. */
  properties?: boolean;
}
const RELIEF: Record<SurfaceFinish, number> = { stone: .012, wood: .005, metal: .0015, paint: .002, glass: .0002, cloth: .004, foliage: .006 };

function detail(material: THREE.MeshStandardNodeMaterial, finish: SurfaceFinish, look: SkyLook | null, properties: boolean) {
  const grain = texture(groundNoise(), positionWorld.xz.add(positionWorld.y.mul(.37)).mul(finish === "wood" ? 3.4 : 2.8));
  const base = materialColor, rough = properties ? attribute("aProp", "vec2").x : float(material.roughness);
  const metal = properties ? attribute("aProp", "vec2").y : float(material.metalness);
  material.colorNode = base.mul(mix(.965, 1.035, grain.g));
  material.roughnessNode = rough.add(grain.b.sub(.5).mul(.035)).clamp(.06, .98);
  material.metalnessNode = metal;
  material.normalNode = bumpMap(grain.r.mul(RELIEF[finish]));
  const view = cameraPosition.sub(positionWorld).normalize(), facing = max(normalWorld.dot(view), 0);
  const fresnel = float(.04).add(facing.oneMinus().pow(5).mul(.96));
  const direction = reflect(view.negate(), normalWorld), sky = skyGradient(look, vec3(direction.x, max(direction.y, 0), direction.z));
  const sheen = finish === "glass" ? float(.7) : metal.mul(.28).add(rough.oneMinus().mul(.12));
  let reflected = materialEmissive.add(sky.mul(fresnel).mul(sheen));
  if (finish === "foliage" && material.vertexColors) {
    // Broad, restrained leaf light; brown trunks and soil keep their opaque shading.
    const c = vertexColor().xyz, green = smoothstep(.015, .1, c.g.sub(max(c.r, c.b)));
    reflected = reflected.add(c.mul(green).mul(.055));
  }
  material.emissiveNode = reflected;
  material.userData.cityModelStyle = "realistic-v1";
  material.userData.citySurfaceEmission = "reflected-light";
  return material;
}

export function surfaceMaterial({ finish = "stone", look = null, properties = false, ...parameters }: DetailOptions = {}) {
  const defaults = finish === "glass" ? { roughness: .16, metalness: .08 } : finish === "metal" ? { roughness: .32, metalness: .72 } : { roughness: .82, metalness: 0 };
  return detail(new THREE.MeshStandardNodeMaterial({ ...defaults, ...parameters }), finish, look, properties);
}

/** Preserve source maps, colours, transparency and names while using the city's common surface treatment. */
export function detailedMaterialCopy(source: THREE.MeshStandardMaterial, look: SkyLook | null = null): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial(), from = source as unknown as Record<string, unknown>, to = material as unknown as Record<string, unknown>;
  for (const key in from) if (!["uuid", "type", "_listeners"].includes(key)) to[key] = from[key];
  material.userData = { ...source.userData };
  const name = source.name.toLowerCase();
  const finish: SurfaceFinish = /glass|glaz|window/.test(name) ? "glass" : /wood|timber|teak/.test(name) ? "wood" : /metal|steel|rail|alum|chrome/.test(name) || source.metalness > .55 ? "metal" : /cloth|fabric|shirt|skin/.test(name) ? "cloth" : "stone";
  if (finish === "glass") { material.roughness = .15; material.metalness = .08; }
  return detail(material, finish, look, false);
}

/** Only used before imported models enter the scene; shared source materials are replaced/disposed once. */
export function refineModelSurfaces(models: Map<string, Model>, look: SkyLook | null) {
  const replacements = new Map<THREE.Material, THREE.Material>();
  for (const model of models.values()) for (const part of model.parts) {
    const source = part.material as THREE.MeshStandardMaterial;
    if (!source.isMeshStandardMaterial || (source as unknown as THREE.NodeMaterial).isNodeMaterial) continue;
    let material = replacements.get(source);
    if (!material) { material = detailedMaterialCopy(source, look); replacements.set(source, material); }
    part.material = material;
  }
  replacements.forEach((_, source) => source.dispose());
}
