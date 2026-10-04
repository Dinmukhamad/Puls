/**
 * glTF loading for city v3. Kenney/Quaternius files are meshopt-compressed with quantised attributes
 * (e.g. positions as three int16 = 6-byte stride). WebGPU requires vertex strides that are multiples of
 * 4 bytes, so every non-float attribute is expanded to Float32 here (normalised values are scaled back),
 * and each mesh's world transform is baked into its geometry: callers get geometry in model space.
 */
import * as THREE from "three/webgpu";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/** Download and decoding share a deadline; a stalled optional kit must not hold the map's first frame. */
export const MODEL_LOAD_TIMEOUT_MS = 15000;
export interface ModelLoadOptions { signal?: AbortSignal; timeoutMs?: number }
// Keep only immutable file bytes. Catalogues mutate/dispose their models, so parsed scenes cannot be shared.
const fileBytes = new Map<string, ArrayBuffer>();
const MAX_CACHED_BYTES = 12 * 1024 * 1024;
let cachedBytes = 0;
function cacheFile(url: string, data: ArrayBuffer) {
  if (fileBytes.has(url) || data.byteLength > MAX_CACHED_BYTES) return;
  while (cachedBytes + data.byteLength > MAX_CACHED_BYTES && fileBytes.size) {
    const first = fileBytes.keys().next().value!;
    cachedBytes -= fileBytes.get(first)!.byteLength; fileBytes.delete(first);
  }
  fileBytes.set(url, data); cachedBytes += data.byteLength;
}

/** Frees shared source resources once, including the other scenes of a multi-scene kit. */
function disposeGLTF(gltf: GLTF, keepMaterials = false) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  gltf.scenes.forEach(root => root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry); [mesh.material].flat().forEach(material => materials.add(material));
  }));
  geometries.forEach(geometry => geometry.dispose());
  if (keepMaterials) return;
  materials.forEach(material => Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); }));
  textures.forEach(texture => texture.dispose()); materials.forEach(material => material.dispose());
}

async function loadGLTF(url: string, { signal, timeoutMs = MODEL_LOAD_TIMEOUT_MS }: ModelLoadOptions = {}): Promise<GLTF> {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Model load cancelled", "AbortError");
  const controller = new AbortController(), manager = new THREE.LoadingManager();
  const loader = new GLTFLoader(manager); loader.setMeshoptDecoder(MeshoptDecoder);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => controller.abort(signal?.reason ?? new DOMException("Model load cancelled", "AbortError"));
  signal?.addEventListener("abort", cancel, { once: true });
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => { manager.abort(); reject(controller.signal.reason); }, { once: true });
    timer = setTimeout(() => controller.abort(new DOMException("Model load timed out", "TimeoutError")), timeoutMs);
  });
  const operation = (async () => {
    let data = fileBytes.get(url);
    if (!data) {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Model download failed (${response.status})`);
      data = await response.arrayBuffer();
    }
    controller.signal.throwIfAborted();
    const gltf = await loader.parseAsync(data, THREE.LoaderUtils.extractUrlBase(url));
    // Decoding cannot always be interrupted. Dispose a late result instead of handing it to a dead scene.
    if (controller.signal.aborted) { disposeGLTF(gltf); throw controller.signal.reason; }
    cacheFile(url, data);
    return gltf;
  })();
  try { return await Promise.race([operation, aborted]); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
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

/** Model downloads can finish just before their owner is discarded; release every shared resource once. */
export function disposeModels(models: Map<string, Model>, retained: Map<string, Model> = new Map()) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  models.forEach(model => model.parts.forEach(part => { geometries.add(part.geometry); materials.add(part.material); }));
  materials.forEach(material => Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); }));
  // A kit may share a material or texture between an overwritten name and another retained model.
  retained.forEach(model => model.parts.forEach(part => {
    geometries.delete(part.geometry); materials.delete(part.material);
    Object.values(part.material).forEach(value => { if (value?.isTexture) textures.delete(value); });
  }));
  geometries.forEach(geometry => geometry.dispose()); textures.forEach(texture => texture.dispose()); materials.forEach(material => material.dispose());
}

/** One model per glTF scene (Kenney kits keep one model per scene), parts grouped by material. */
export async function loadModels(url: string, options: ModelLoadOptions = {}): Promise<Map<string, Model>> {
  const gltf = await loadGLTF(url, options);
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
  // The catalogue owns the baked clones and source materials; the original mesh geometry is unused.
  disposeGLTF(gltf, true);
  return models;
}

/** Skinned characters (the assistant) keep their hierarchy; their geometry is normalised in place. */
export async function loadCharacter(url: string, options: ModelLoadOptions = {}) {
  const gltf = await loadGLTF(url, options);
  gltf.scene.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) normaliseGeometry(mesh.geometry); });
  return gltf;
}
