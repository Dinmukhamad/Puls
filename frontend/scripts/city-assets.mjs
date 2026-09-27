/**
 * Offline asset pipeline for city v3 (TZ §5.7, stage 1 prototype). Runs at build time in Node only:
 * `npm run city:assets`. Nothing here reaches the runtime bundle.
 *
 * For every scene of the Kenney kits (one model per scene) it adds two simplified copies as new scenes,
 * "<scene>__lod1" (~35 % of the triangles) and "<scene>__lod2" (~10 %, or a one-colour box when the
 * mesh cannot be simplified that far). LOD copies reuse the kit's materials and textures, so the runtime
 * pools draw every level of a kit with the same few materials. Output goes to public/city/<version>/
 * (versioned path, cached forever) together with manifest.json, and the budgets are checked.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize, getBounds, meshopt, prune, simplifyPrimitive, weldPrimitive } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

export const VERSION = "v1";
const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_DIR = resolve(FRONTEND, "src/pages/city/models");
export const OUT_DIR = resolve(FRONTEND, "public/city", VERSION);
export const SOURCES = ["city-models.glb", "vehicles.glb"];

/** TZ §5.7 checks: file size, LOD triangle shares of LOD0, LOD0 triangles (§5.3), unique materials per file. */
// LOD1 share is 0.72 in stage 1: the Kenney kits split vertices along texture seams, so meshopt cannot go
// below ~50–71 % without breaking silhouettes. The stage 3 models are built for simplification (TZ §5.3).
export const BUDGETS = { fileBytes: 1.5 * 1024 * 1024, lod0Triangles: 8000, lod1Share: 0.72, lod2Share: 0.15, materials: 12 };

/**
 * Detail levels. Simplification tries the error limits in order (relative to the mesh size) and keeps the
 * first result within budget: a small limit keeps the silhouette, a large one lets meshopt reach the target.
 */
const LODS = [
  { suffix: "__lod1", ratio: 0.35, share: BUDGETS.lod1Share, errors: [0.005, 0.02, 0.08, 1] },
  { suffix: "__lod2", ratio: 0.1, share: BUDGETS.lod2Share, errors: [0.02, 0.1, 1], box: true },
];

/** glTF IO with meshopt + quantisation. All extensions are registered so KHR_texture_transform (the UV range of the quantised kits) survives. */
export async function createIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
}

const primitiveTriangles = prim => (prim.getIndices()?.getCount() ?? prim.getAttribute("POSITION").getCount()) / 3;
const meshesOf = scene => { const list = []; scene.traverse(node => { if (node.getMesh()) list.push(node.getMesh()); }); return list; };
/** Triangles drawn for a scene (a mesh used by two nodes counts twice, as it renders twice). */
export const sceneTriangles = scene => meshesOf(scene).reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((s, p) => s + primitiveTriangles(p), 0), 0);

/** A simplified copy of a mesh: welded and simplified primitive clones that keep the source accessors and material untouched. */
function simplifiedMesh(doc, mesh, suffix, ratio, error) {
  const copy = doc.createMesh(`${mesh.getName()}${suffix}`);
  for (const prim of mesh.listPrimitives()) {
    const part = prim.clone();
    weldPrimitive(part);
    simplifyPrimitive(part, { simplifier: MeshoptSimplifier, ratio, error });
    if (primitiveTriangles(part) > 0) copy.addPrimitive(part); else part.dispose();
  }
  return copy;
}

/** Copies a node subtree with TRS and names, swapping every mesh through `meshFor`. */
function copyNode(doc, node, suffix, meshFor) {
  const copy = doc.createNode(`${node.getName()}${suffix}`).setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
  if (node.getMesh()) copy.setMesh(meshFor(node.getMesh()));
  for (const child of node.listChildren()) copy.addChild(copyNode(doc, child, suffix, meshFor));
  return copy;
}

/**
 * Tries each error limit and keeps the first copy within the triangle budget. When none fits, the last
 * (coarsest) copy is kept with `fits: false`, so the budget check reports it instead of a missing level.
 */
function simplifiedScene(doc, scene, lod, lod0) {
  let result = null;
  for (const error of lod.errors) {
    if (result) disposeScene(result.scene);
    const copies = new Map();
    const meshFor = mesh => { if (!copies.has(mesh)) copies.set(mesh, simplifiedMesh(doc, mesh, lod.suffix, lod.ratio, error)); return copies.get(mesh); };
    const target = doc.createScene(`${scene.getName()}${lod.suffix}`);
    for (const child of scene.listChildren()) target.addChild(copyNode(doc, child, lod.suffix, meshFor));
    const triangles = sceneTriangles(target);
    result = { scene: target, error, fits: triangles > 0 && triangles <= lod0 * lod.share };
    if (result.fits) break;
  }
  return result;
}

function disposeScene(scene) {
  const nodes = [];
  scene.traverse(node => nodes.push(node));
  for (const mesh of new Set(meshesOf(scene))) { mesh.listPrimitives().forEach(p => p.dispose()); mesh.dispose(); }
  nodes.forEach(node => node.dispose());
  scene.dispose();
}

/** Stored UV of the colour covering most of a primitive (the kits use one palette texture), so a box keeps the model's main colour. */
function dominantUv(prim) {
  const uv = prim.getAttribute("TEXCOORD_0"), position = prim.getAttribute("POSITION"), indices = prim.getIndices();
  if (!uv) return [0, 0];
  const areas = new Map(), a = [], b = [], c = [], t = [];
  const count = indices ? indices.getCount() : position.getCount();
  for (let i = 0; i < count; i += 3) {
    const [ia, ib, ic] = [i, i + 1, i + 2].map(k => (indices ? indices.getScalar(k) : k));
    position.getElement(ia, a); position.getElement(ib, b); position.getElement(ic, c);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    uv.getElement(ia, t);
    const key = `${Math.round(t[0] * 256)},${Math.round(t[1] * 256)}`;
    const entry = areas.get(key) ?? { area: 0, uv: [t[0], t[1]] };
    entry.area += area; areas.set(key, entry);
  }
  return [...areas.values()].sort((x, y) => y.area - x.area)[0]?.uv ?? [0, 0];
}

/** LOD2 fallback: the scene's bounding box (12 triangles) in the material and main colour of its biggest primitive. */
function boxScene(doc, scene, suffix) {
  const { min, max } = getBounds(scene);
  const prims = meshesOf(scene).flatMap(mesh => mesh.listPrimitives());
  const biggest = prims.sort((x, y) => primitiveTriangles(y) - primitiveTriangles(x))[0];
  const [u, v] = dominantUv(biggest);
  const positions = [], normals = [], uvs = [], indices = [];
  // Each face spans the two axes after its own in x→y→z order, mirrored on the negative side, so it winds outwards.
  for (const axis of [0, 1, 2]) for (const sign of [1, -1]) {
    const [s, t] = [(axis + 1) % 3, (axis + 2) % 3], base = positions.length / 3;
    for (const [ds, dt] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const p = [0, 0, 0];
      p[axis] = sign > 0 ? max[axis] : min[axis];
      p[s] = (sign > 0 ? ds : 1 - ds) ? max[s] : min[s];
      p[t] = dt ? max[t] : min[t];
      positions.push(...p);
      normals.push(...[0, 1, 2].map(k => (k === axis ? sign : 0)));
      uvs.push(u, v);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(doc.getRoot().listBuffers()[0]);
  const prim = doc.createPrimitive().setMaterial(biggest.getMaterial())
    .setAttribute("POSITION", accessor("VEC3", new Float32Array(positions)))
    .setAttribute("NORMAL", accessor("VEC3", new Float32Array(normals)))
    .setAttribute("TEXCOORD_0", accessor("VEC2", new Float32Array(uvs)))
    .setIndices(accessor("SCALAR", new Uint16Array(indices)));
  const node = doc.createNode(`${scene.getName()}${suffix}`).setMesh(doc.createMesh(`${scene.getName()}${suffix}`).addPrimitive(prim));
  return doc.createScene(`${scene.getName()}${suffix}`).addChild(node);
}

/** Builds one kit: LOD scenes for every source scene, meshopt compression; returns the .glb bytes and a log per scene. */
export async function buildKit(io, sourcePath) {
  const doc = await io.read(sourcePath);
  await doc.transform(dequantize());
  const log = [];
  for (const scene of doc.getRoot().listScenes()) {
    const lod0 = sceneTriangles(scene), entry = { scene: scene.getName(), lod0 };
    for (const lod of LODS) {
      const result = simplifiedScene(doc, scene, lod, lod0);
      if (result.fits) entry[lod.suffix] = `error ≤ ${result.error}`;
      else if (lod.box) { disposeScene(result.scene); boxScene(doc, scene, lod.suffix); entry[lod.suffix] = "box"; }
      else entry[lod.suffix] = "over budget";
    }
    log.push(entry);
  }
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: "high" }));
  return { bytes: await io.writeBinary(doc), log };
}

/** Triangles per LOD for every source scene of a written kit, read back from the output. */
async function inspect(io, bytes) {
  const doc = await io.readBinary(bytes), scenes = new Map(doc.getRoot().listScenes().map(s => [s.getName(), s]));
  const models = {};
  for (const [name, scene] of scenes) {
    if (name.includes("__lod")) continue;
    models[name] = { lod0: sceneTriangles(scene), lod1: scenes.has(`${name}__lod1`) ? sceneTriangles(scenes.get(`${name}__lod1`)) : null, lod2: scenes.has(`${name}__lod2`) ? sceneTriangles(scenes.get(`${name}__lod2`)) : null };
  }
  return { models, materials: doc.getRoot().listMaterials().length };
}

/** Budget violations for a manifest (empty when everything fits). */
export function checkBudgets(manifest) {
  const problems = [];
  for (const [file, info] of Object.entries(manifest.files)) {
    if (info.bytes > BUDGETS.fileBytes) problems.push(`${file}: ${(info.bytes / 1048576).toFixed(2)} MB > 1.5 MB`);
    if (info.materials > BUDGETS.materials) problems.push(`${file}: ${info.materials} materials > ${BUDGETS.materials}`);
    for (const [name, t] of Object.entries(info.models)) {
      if (t.lod0 > BUDGETS.lod0Triangles) problems.push(`${file} ${name}: LOD0 ${t.lod0} triangles > ${BUDGETS.lod0Triangles}`);
      if (t.lod1 == null || t.lod1 > t.lod0 * BUDGETS.lod1Share + 12) problems.push(`${file} ${name}: LOD1 ${t.lod1} of ${t.lod0}`);
      if (t.lod2 == null || t.lod2 > Math.max(12, t.lod0 * BUDGETS.lod2Share)) problems.push(`${file} ${name}: LOD2 ${t.lod2} of ${t.lod0}`);
    }
  }
  return problems;
}

async function main() {
  const io = await createIO();
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = { version: VERSION, generated: new Date().toISOString().slice(0, 10), files: {} };
  for (const source of SOURCES) {
    const { bytes, log } = await buildKit(io, resolve(SOURCE_DIR, source));
    await writeFile(resolve(OUT_DIR, source), bytes);
    const { models, materials } = await inspect(io, bytes);
    manifest.files[source] = { bytes: bytes.byteLength, materials, models };
    const boxes = log.filter(e => e.__lod2 === "box").length;
    console.log(`${source}: ${(bytes.byteLength / 1024).toFixed(0)} KB, ${log.length} models, LOD2 boxes ${boxes}`);
  }
  await writeFile(resolve(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const problems = checkBudgets(manifest);
  if (problems.length) { console.error("Budgets exceeded:\n" + problems.join("\n")); process.exitCode = 1; }
  else console.log(`Budgets OK → ${relative(FRONTEND, OUT_DIR)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
