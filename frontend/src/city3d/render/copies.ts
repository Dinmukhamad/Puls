/**
 * Copies of a geometry in one draw call without THREE.InstancedMesh. three r180 builds the shaders of every
 * InstancedMesh on its own, because its render cache key carries the mesh's uuid: about 10 ms of main thread
 * each while the city loads, and the full map has a hundred of them. Plain meshes that share a material and the
 * layout of their attributes share one build instead. A copy mesh draws its geometry with the copies' matrices
 * (four vec4 columns of one interleaved buffer) and tints as instanced attributes, and its material places the
 * vertex the way three's InstanceNode places an InstancedMesh's: position, normal (normalLocal, which the
 * catalogue's window seeds read) and the tint in the `vInstanceColor` varying (read by the section facades).
 */
import * as THREE from "three/webgpu";
import { attribute, mat4, materialColor, nodeObject, normalLocal, positionGeometry, positionLocal, transformNormal, varyingProperty, vec4 } from "three/tsl";

/** Floats per copy in a matrices buffer: one column-major 4×4 matrix. */
export const COPY_STRIDE = 16;
const COLUMNS = ["copyMatrix0", "copyMatrix1", "copyMatrix2", "copyMatrix3"], TINT = "copyTint";
// A matrix from four column vectors, as InstanceNode builds one; @types/three lists only 1 or 16 arguments.
const fromColumns = mat4 as unknown as (...columns: ReturnType<typeof attribute>[]) => ReturnType<typeof mat4>;
const copyMatrix = fromColumns(...COLUMNS.map(name => attribute(name, "vec4")));

/** Moves a vertex to its copy, as InstanceNode does in NodeMaterial.setupPosition. */
class PlaceCopy extends THREE.Node {
  constructor() { super("void"); }
  setup(builder: THREE.NodeBuilder) {
    positionLocal.assign(copyMatrix.mul(positionLocal).xyz);
    if (builder.hasGeometryAttribute("normal")) normalLocal.assign(transformNormal(normalLocal, copyMatrix));
    varyingProperty("vec3", "vInstanceColor").assign(attribute(TINT, "vec3"));
  }
}
const placeCopy = nodeObject(new PlaceCopy());
/** The shadow pass draws with three's depth material, which takes this from the copy's material. */
const shadowPosition = copyMatrix.mul(positionGeometry).xyz;
const tint = vec4(varyingProperty("vec3", "vInstanceColor"), 1);
/**
 * The tinted colour of a material without a colour node of its own. One node for all of them, so copy materials
 * that differ only in their values (colours, roughness, textures) share one build, as plain materials do.
 */
const tinted = vec4(materialColor).mul(tint);

type MaterialClass = new () => THREE.NodeMaterial;
/** Node classes for loaded (glTF) materials, as the renderer would convert them. */
const NODE_CLASSES: Record<string, MaterialClass> = {
  MeshStandardMaterial: THREE.MeshStandardNodeMaterial, MeshPhysicalMaterial: THREE.MeshPhysicalNodeMaterial,
  MeshBasicMaterial: THREE.MeshBasicNodeMaterial, MeshLambertMaterial: THREE.MeshLambertNodeMaterial, MeshPhongMaterial: THREE.MeshPhongNodeMaterial,
};
const copyClasses = new Map<MaterialClass, MaterialClass>();
function copyClass(Base: MaterialClass): MaterialClass {
  let Copy = copyClasses.get(Base);
  if (!Copy) {
    // The copy is placed first, where an InstancedMesh's would be; a material position node of its own still
    // follows it in the main pass (shadows then skip it: no copy material has one).
    Copy = class extends Base {
      setupPosition(builder: THREE.NodeBuilder) { placeCopy.toStack(); return super.setupPosition(builder); }
    };
    copyClasses.set(Base, Copy);
  }
  return Copy;
}

const variants = new WeakMap<THREE.Material, THREE.NodeMaterial>();
/**
 * The copy version of a material, one per material: every copy mesh of it shares one shader build. It is a
 * node copy made the way the renderer converts a material, so it looks the same, and it is disposed with the
 * material it copies.
 */
export function copyMaterial(source: THREE.Material): THREE.NodeMaterial {
  let material = variants.get(source);
  if (material) return material;
  const node = (source as THREE.NodeMaterial).isNodeMaterial;
  material = new (copyClass(node ? source.constructor as MaterialClass : NODE_CLASSES[source.type] ?? THREE.MeshStandardNodeMaterial))();
  const from = source as unknown as Record<string, unknown>, to = material as unknown as Record<string, unknown>;
  for (const key in from) if (key !== "uuid" && key !== "type" && key !== "_listeners") to[key] = from[key];
  const own = node ? (source as THREE.NodeMaterial).colorNode : null;
  material.colorNode = own ? vec4(own).mul(tint) : tinted;
  material.castShadowPositionNode = shadowPosition;
  variants.set(source, material);
  const copy = material;
  source.addEventListener("dispose", () => { variants.delete(source); copy.dispose(); });
  return material;
}

/** Room for `capacity` copies' matrices, shared by every part of a model: write COPY_STRIDE floats per copy. */
export function copyMatrices(capacity: number) {
  return new THREE.InstancedInterleavedBuffer(new Float32Array(Math.max(1, capacity) * COPY_STRIDE), COPY_STRIDE, 1);
}
/** Per-copy tints (white by default), three floats per copy. */
export function copyTints(capacity: number) {
  return new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3).fill(1), 3);
}

/**
 * A mesh drawing copies of the source geometry: set `mesh.geometry.instanceCount` and flag the matrices and tints
 * for upload. Its geometry shares the source's attributes and index, and the renderer tracks them through it:
 * disposing it frees their GPU buffers too. Do that only where nothing else draws the source; copy meshes of a
 * shared source (the catalogue's parts) are just dropped, and their buffers go with the renderer.
 */
export function copyMesh(source: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.InstancedInterleavedBuffer, tints: THREE.InstancedBufferAttribute) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(source.getIndex());
  for (const [name, value] of Object.entries(source.attributes)) geometry.setAttribute(name, value);
  COLUMNS.forEach((name, column) => geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(matrices, 4, column * 4)));
  geometry.setAttribute(TINT, tints);
  geometry.instanceCount = 0;
  const mesh = new THREE.Mesh(geometry, copyMaterial(material));
  // The copies are everywhere: the source's bounds say nothing about where they stand.
  mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  return mesh;
}
