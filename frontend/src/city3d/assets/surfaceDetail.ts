/** Clean, softly lit cartoon surfaces for props and imported models, in the existing shared draw calls. */
import * as THREE from "three/webgpu";
import { attribute, cameraPosition, float, materialColor, materialEmissive, max, normalView, normalWorld, positionWorld, reflect, smoothstep, vec3, vertexColor } from "three/tsl";
import { skyGradient, type SkyLook } from "../render/sky";
import type { Model } from "./loader";

export type SurfaceFinish = "stone" | "wood" | "metal" | "paint" | "glass" | "cloth" | "foliage";
interface DetailOptions extends THREE.MeshStandardMaterialParameters {
  finish?: SurfaceFinish;
  look?: SkyLook | null;
  /** Courtyard/vegetation models bake physical roughness and metalness per surface. */
  properties?: boolean;
}
function detail(material: THREE.MeshStandardNodeMaterial, finish: SurfaceFinish, look: SkyLook | null, properties: boolean) {
  const base = materialColor, rough = properties ? attribute("aProp", "vec2").x : float(material.roughness);
  const metal = properties ? attribute("aProp", "vec2").y : float(material.metalness);
  // Large colour areas and the model's rounded normals carry the shape. Removing tiny bump/grain also
  // makes distant trees and station roofs stable while the camera moves on a small screen.
  material.colorNode = base;
  material.roughnessNode = finish === "glass" ? float(.3) : rough.max(.64).min(.94);
  material.metalnessNode = metal.min(.24);
  material.normalNode = normalView;
  const view = cameraPosition.sub(positionWorld).normalize(), facing = max(normalWorld.dot(view), 0);
  const fresnel = float(.04).add(facing.oneMinus().pow(5).mul(.96));
  const direction = reflect(view.negate(), normalWorld), sky = skyGradient(look, vec3(direction.x, max(direction.y, 0), direction.z));
  const sheen = finish === "glass" ? float(.3) : metal.mul(.12).add(rough.oneMinus().mul(.05));
  let reflected = materialEmissive.add(sky.mul(fresnel).mul(sheen));
  if (finish === "foliage" && material.vertexColors) {
    // Broad, restrained leaf light; brown trunks and soil keep their opaque shading.
    const c = vertexColor().xyz, green = smoothstep(.015, .1, c.g.sub(max(c.r, c.b)));
    reflected = reflected.add(c.mul(green).mul(.025));
  }
  material.emissiveNode = reflected;
  material.userData.cityModelStyle = "cartoon-v1";
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
