/**
 * glTF loading for city v3. Kenney/Quaternius files are meshopt-compressed with quantised attributes
 * (e.g. positions as three int16 = 6-byte stride). WebGPU requires vertex strides that are multiples of
 * 4 bytes, so every non-float attribute is expanded to Float32 here (normalised values are scaled back),
 * and each mesh's world transform is baked into its geometry: callers get geometry in model space.
 */
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

let loader: GLTFLoader | null = null;
function gltfLoader() {
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  return loader;
}

/** Copies an attribute into Float32, undoing normalisation (int8/16 → -1…1, uint8/16 → 0…1). */
export function toFloatAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const { count, itemSize } = attribute, out = new Float32Array(count * itemSize);
  for (let i = 0; i < count; i++) for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = attribute.getComponent(i, k);
  return new THREE.BufferAttribute(out, itemSize);
}

/** Makes a geometry safe for both backends: float attributes, no interleaving, a 32/16-bit index. */
export function normaliseGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.attributes[name] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    const isFloat = !(attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && (attribute as THREE.BufferAttribute).array instanceof Float32Array;
    if (!isFloat) geometry.setAttribute(name, toFloatAttribute(attribute));
  }
  return geometry;
}

export interface ModelPart { geometry: THREE.BufferGeometry; material: THREE.Material; castShadow: boolean }
export interface Model { name: string; parts: ModelPart[]; bounds: THREE.Box3 }

/** One model per glTF scene (Kenney kits keep one model per scene), parts grouped by material. */
export async function loadModels(url: string): Promise<Map<string, Model>> {
  const gltf = await gltfLoader().loadAsync(url);
  const models = new Map<string, Model>();
  for (const root of gltf.scenes) {
    root.updateMatrixWorld(true);
    const parts: ModelPart[] = [], bounds = new THREE.Box3();
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
      const geometry = normaliseGeometry(mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
      geometry.computeBoundingBox(); bounds.union(geometry.boundingBox!);
      for (const material of [mesh.material].flat()) parts.push({ geometry, material, castShadow: true });
    });
    models.set(root.name, { name: root.name, parts, bounds });
  }
  return models;
}

/** Skinned characters (the assistant) keep their hierarchy; their geometry is normalised in place. */
export async function loadCharacter(url: string) {
  const gltf = await gltfLoader().loadAsync(url);
  gltf.scene.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) normaliseGeometry(mesh.geometry); });
  return gltf;
}
