/**
 * Build the city's instanced transport kit from the original collection, offline.
 * Run: node scripts/transport-city-assets.mjs
 *
 * Every scene is one indexed mesh / material. Material appearance is carried by
 * linear vertex colours and the city shader's categorical _ASURF attribute.
 * Source GLBs are read-only; all transforms are baked in physical metres, +X bow.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dequantize, getBounds, prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { Matrix3, Matrix4, Vector3 } from 'three';

export const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_DIR = resolve(FRONTEND, 'public/transport-collection');
export const OUT_DIR = resolve(FRONTEND, 'public/city/transport-v1');
export const PART = { paint: 1, glass: 3, rubber: 4, chrome: 6, plastic: 7, head: 8, tail: 9, sign: 10, checker: 12, fixed: 13, wood: 14, blue: 15 };
export const BUDGETS = { preferredBytes: 4 * 1024 * 1024, maximumBytes: 6 * 1024 * 1024, carLod0: 14000, marineLod0: 19000, lod1: 2500, lod2: 950 };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const triangles = part => part.indices.length / 3;
const boundsFor = positions => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { const a = i % 3; min[a] = Math.min(min[a], positions[i]); max[a] = Math.max(max[a], positions[i]); }
  return { min, max, size: max.map((v, a) => v - min[a]) };
};
const boundsMatch = (a, b, tolerance = .05) => a.min.every((v, k) => Math.abs(v - b.min[k]) <= b.size[k] * tolerance + 1e-4 && Math.abs(a.max[k] - b.max[k]) <= b.size[k] * tolerance + 1e-4);

export async function createIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

/** Source marine batches use node labels; road materials have descriptive names. */
export function classifyMaterial(material, nodeName = '') {
  const name = `${material?.getName() ?? ''} ${nodeName}`.toLowerCase();
  if (material?.getExtras().paint || /\bpaint\b|body colour/.test(name)) return PART.paint;
  if (/glass|glazing/.test(name) || material?.getAlphaMode() === 'BLEND') return PART.glass;
  if (/tyre|tire|rubber/.test(name)) return PART.rubber;
  if (/rear light|red lens|\bred\b/.test(name)) return PART.tail;
  if (/headlamp|daylight|indicator|amber lens|\blamp\b|\bgreen\b/.test(name)) return PART.head;
  if (/number plate/.test(name)) return PART.sign;
  if (/teak|\bwood|timber/.test(name) && !/teakdark/.test(name)) return PART.wood;
  if (/alumin|alloy|steel|chrome|metal|bronze|brake disc/.test(name) || material?.getMetallicFactor() >= .65) return PART.chrome;
  if (/trim|plastic|panel gap|upholstery|charcoal|\bdark\b|seam|teakdark/.test(name)) return PART.plastic;
  return PART.fixed;
}

/** Keep source index topology, including hard normal seams and real wheel arches. */
export async function extractSource(io, meta, sourceDir = SOURCE_DIR) {
  const bytes = await readFile(resolve(sourceDir, meta.file));
  const doc = await io.readBinary(bytes);
  await doc.transform(dequantize());
  const parts = [];
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  scene.traverse(node => {
    if (!node.getMesh()) return;
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    const normalMatrix = new Matrix3().getNormalMatrix(matrix);
    const point = new Vector3(), normal = new Vector3(), temp = [];
    for (const primitive of node.getMesh().listPrimitives()) {
      const position = primitive.getAttribute('POSITION'), sourceNormal = primitive.getAttribute('NORMAL');
      if (primitive.getMode() !== 4 || !sourceNormal) throw new Error(`${meta.id}: requires triangle geometry with normals`);
      const color = primitive.getAttribute('COLOR_0'), base = primitive.getMaterial()?.getBaseColorFactor() ?? [1, 1, 1, 1];
      const positions = new Float32Array(position.getCount() * 3), normals = new Float32Array(positions.length), colors = new Float32Array(positions.length);
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, temp); point.fromArray(temp).applyMatrix4(matrix).toArray(positions, i * 3);
        sourceNormal.getElement(i, temp); normal.fromArray(temp).applyNormalMatrix(normalMatrix).toArray(normals, i * 3);
        if (color) color.getElement(i, temp);
        for (let k = 0; k < 3; k++) colors[i * 3 + k] = base[k] * (color ? temp[k] : 1);
      }
      const sourceIndices = primitive.getIndices();
      const indices = sourceIndices ? Uint32Array.from(sourceIndices.getArray()) : Uint32Array.from({ length: position.getCount() }, (_, i) => i);
      if (matrix.determinant() < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
      parts.push({ name: primitive.getMaterial()?.getName() || node.getName(), nodeName: node.getName(), kind: classifyMaterial(primitive.getMaterial(), node.getName()), positions, normals, colors, indices, locks: new Uint8Array(position.getCount()) });
    }
  });
  const sourceBounds = unionBounds(parts.map(p => boundsFor(p.positions)));
  // Protect one genuine source vertex at each extremum. In particular the mast
  // and deep sailing keel must not disappear during distant LOD simplification.
  for (let a = 0; a < 3; a++) for (const edge of ['min', 'max']) {
    outer: for (const part of parts) for (let i = a; i < part.positions.length; i += 3) if (Math.abs(part.positions[i] - sourceBounds[edge][a]) < 1e-6) { part.locks[(i - a) / 3] = 1; break outer; }
  }
  return { id: meta.id, parts, sourceBounds, sourceTriangles: parts.reduce((s, p) => s + triangles(p), 0), sourceBytes: bytes.length, sourceSha256: sha256(bytes) };
}

function unionBounds(list) {
  const min = [0, 1, 2].map(k => Math.min(...list.map(b => b.min[k]))), max = [0, 1, 2].map(k => Math.max(...list.map(b => b.max[k])));
  return { min, max, size: max.map((v, k) => v - min[k]) };
}

function compactPart(part, indices) {
  const map = new Map(), positions = [], normals = [], colors = [], outputIndices = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const sourceIndex = indices[i];
    if (!map.has(sourceIndex)) {
      map.set(sourceIndex, map.size);
      for (let k = 0; k < 3; k++) { positions.push(part.positions[sourceIndex * 3 + k]); normals.push(part.normals[sourceIndex * 3 + k]); colors.push(part.colors[sourceIndex * 3 + k]); }
    }
    outputIndices[i] = map.get(sourceIndex);
  }
  return { ...part, positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors), indices: outputIndices };
}

function simplifyPart(part, target, errors) {
  if (triangles(part) <= target) return compactPart(part, part.indices);
  let result;
  for (const error of errors) {
    const [indices, achievedError] = MeshoptSimplifier.simplifyWithAttributes(part.indices, part.positions, 3, part.normals, 3, [.05, .05, .05], part.locks, Math.max(3, Math.floor(target) * 3), error, ['Permissive', 'Prune']);
    result = { indices, error: achievedError };
    if (indices.length <= target * 3) break;
  }
  // Prune may discard even a locked tiny component. Restore its original local
  // surface, rather than stretching surviving geometry to fake source bounds.
  const selected = new Set(result.indices), restored = [];
  for (let i = 0; i < part.locks.length; i++) if (part.locks[i] && !selected.has(i)) {
    for (let j = 0; j < part.indices.length; j += 3) if (part.indices[j] === i || part.indices[j + 1] === i || part.indices[j + 2] === i) restored.push(part.indices[j], part.indices[j + 1], part.indices[j + 2]);
  }
  const indices = restored.length ? Uint32Array.from([...result.indices, ...restored]) : result.indices;
  return { ...compactPart(part, indices), error: result.error, restoredTriangles: restored.length / 3 };
}

function makeLod(source, lod, target) {
  const errors = lod === 0 ? [.002, .006, .015, .04, .12] : lod === 1 ? [.006, .02, .06, .15, .4] : [.02, .06, .15, .4, .8];
  const parts = source.parts.map(part => {
    const minimum = part.kind === PART.paint ? (lod === 2 ? 140 : 250) : part.nodeName === 'sail' ? 80 : part.kind === PART.rubber ? 48 : part.kind === PART.glass ? 24 : 8;
    const quota = Math.max(minimum, Math.floor(triangles(part) / source.sourceTriangles * target));
    return simplifyPart(part, quota, errors);
  }).filter(p => p.indices.length);
  return { parts, triangles: parts.reduce((s, p) => s + triangles(p), 0), vertices: parts.reduce((s, p) => s + p.positions.length / 3, 0), bounds: unionBounds(parts.map(p => boundsFor(p.positions))) };
}

function appendScene(doc, buffer, material, source, lod, data) {
  const count = data.vertices, positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3), surf = new Float32Array(count * 4), win = new Float32Array(count * 4), indices = new Uint32Array(data.triangles * 3);
  let vertexOffset = 0, indexOffset = 0;
  for (const part of data.parts) {
    positions.set(part.positions, vertexOffset * 3); normals.set(part.normals, vertexOffset * 3); colors.set(part.colors, vertexOffset * 3);
    for (let i = 0; i < part.positions.length / 3; i++) { surf.set([0, 0, part.kind, 1], (vertexOffset + i) * 4); win.set([99, 99, 0, 0], (vertexOffset + i) * 4); }
    for (let i = 0; i < part.indices.length; i++) indices[indexOffset + i] = part.indices[i] + vertexOffset;
    vertexOffset += part.positions.length / 3; indexOffset += part.indices.length;
  }
  const name = `${source.id}__lod${lod}`;
  const accessor = (semantic, type, array) => doc.createAccessor(`${name}.${semantic}`).setBuffer(buffer).setType(type).setArray(array);
  const prim = doc.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', accessor('position', 'VEC3', positions))
    .setAttribute('NORMAL', accessor('normal', 'VEC3', normals))
    .setAttribute('COLOR_0', accessor('color', 'VEC3', colors))
    .setAttribute('_ASURF', accessor('surface', 'VEC4', surf))
    .setAttribute('_AWIN', accessor('wheel', 'VEC4', win))
    .setIndices(accessor('indices', 'SCALAR', count <= 65535 ? Uint16Array.from(indices) : indices));
  doc.createScene(name).addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  return { scene: name, triangles: data.triangles, vertices: data.vertices, bounds: data.bounds, parts: data.parts.map(p => ({ sourceMaterial: p.name, kind: p.kind, triangles: triangles(p), error: p.error ?? 0, restoredTriangles: p.restoredTriangles ?? 0 })) };
}

/** Validate encoded output, after quantization and meshopt decoding. */
export async function validateKit(io, bytes, manifest) {
  const doc = await io.readBinary(bytes);
  await doc.transform(dequantize());
  const scenes = new Map(doc.getRoot().listScenes().map(s => [s.getName(), s]));
  if (scenes.size !== manifest.models.length * 3) throw new Error('Expected three scenes for every transport model');
  if (doc.getRoot().listMaterials().length !== 1) throw new Error('Transport must use one shared material');
  for (const model of manifest.models) {
    let previous = Infinity;
    for (const lod of model.lods) {
      const scene = scenes.get(lod.scene), meshes = []; scene.traverse(n => { if (n.getMesh()) meshes.push(n.getMesh()); });
      if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) throw new Error(`${lod.scene}: expected one mesh / primitive`);
      const p = meshes[0].listPrimitives()[0], count = p.getIndices()?.getCount() / 3;
      if (!(count > 0 && count < previous && count === lod.triangles)) throw new Error(`${lod.scene}: triangle counts are not strictly decreasing`);
      previous = count;
      for (const semantic of ['POSITION', 'NORMAL', 'COLOR_0', '_ASURF', '_AWIN']) {
        const a = p.getAttribute(semantic), values = a?.getArray();
        if (!values || [...values].some(v => !Number.isFinite(v))) throw new Error(`${lod.scene}: invalid ${semantic}`);
        if (a.getCount() !== p.getAttribute('POSITION').getCount()) throw new Error(`${lod.scene}: mismatched ${semantic}`);
      }
      const normal = p.getAttribute('NORMAL'), temp = [];
      for (let i = 0; i < normal.getCount(); i++) { normal.getElement(i, temp); const length = Math.hypot(...temp); if (length < .8 || length > 1.2) throw new Error(`${lod.scene}: non-unit normal`); }
      const b = getBounds(scene), bounds = { ...b, size: b.max.map((v, k) => v - b.min[k]) };
      if (!boundsMatch(bounds, model.sourceBounds)) throw new Error(`${lod.scene}: source silhouette bounds changed >5%`);
      if (model.id === 'sailing-yacht' && bounds.max[1] < model.sourceBounds.max[1] * .98) throw new Error('Sailing mast was lost');
      lod.encodedBounds = bounds;
    }
  }
  if (bytes.length > BUDGETS.maximumBytes) throw new Error(`Transport GLB exceeds 6 MiB: ${bytes.length}`);
  return { scenes: scenes.size, models: manifest.models.length, finite: true, unitNormals: true, sourceBoundsWithinFivePercent: true, sailingMastPreserved: true, oneMeshPerScene: true, oneMaterial: true };
}

export async function buildTransportKit({ sourceDir = SOURCE_DIR, outDir = OUT_DIR } = {}) {
  const io = await createIO(), inventoryBytes = await readFile(resolve(sourceDir, 'inventory.json')), inventory = JSON.parse(inventoryBytes);
  const doc = new Document(), buffer = doc.createBuffer('transport'), material = doc.createMaterial('City transport vertex colours').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(.25).setRoughnessFactor(.4).setDoubleSided(true);
  const manifest = { version: 'transport-v1', file: 'collection.glb', units: 'meters', upAxis: 'Y', forwardAxis: '+X', colorSpace: 'linear-sRGB', sourceInventorySha256: sha256(inventoryBytes), budgets: BUDGETS, attributes: { _ASURF: '[0, 0, PART kind, 1]', _AWIN: '[99, 99, 0, 0]' }, partKinds: PART, models: [] };
  for (const meta of inventory.models) {
    const source = await extractSource(io, meta, sourceDir), marine = meta.category === 'boats' || meta.category === 'yachts';
    const lods = [marine ? BUDGETS.marineLod0 : BUDGETS.carLod0, BUDGETS.lod1, BUDGETS.lod2].map((target, lod) => appendScene(doc, buffer, material, source, lod, makeLod(source, lod, target)));
    manifest.models.push({ id: meta.id, name: meta.name, category: meta.category, sourceFile: meta.file, sourceSha256: source.sourceSha256, sourceBytes: source.sourceBytes, sourceTriangles: source.sourceTriangles, sourceBounds: source.sourceBounds, lods });
    console.log(`${meta.id}: ${source.sourceTriangles} → ${lods.map(l => l.triangles).join(' / ')} triangles`);
  }
  await doc.transform(prune(), reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: 14, quantizeNormal: 10 }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const bytes = await io.writeBinary(doc);
  manifest.bytes = bytes.length; manifest.sha256 = sha256(bytes); manifest.sourceBytes = manifest.models.reduce((sum, m) => sum + m.sourceBytes, 0);
  manifest.validation = await validateKit(io, bytes, manifest);
  manifest.totalTriangles = [0, 1, 2].map(l => manifest.models.reduce((sum, m) => sum + m.lods[l].triangles, 0));
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'collection.glb'), bytes);
  await writeFile(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Transport city kit: ${bytes.length} bytes, ${manifest.models.length} models / 60 scenes; totals ${manifest.totalTriangles.join(' / ')} triangles`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildTransportKit();
