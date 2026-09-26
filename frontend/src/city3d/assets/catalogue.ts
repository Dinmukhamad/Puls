/**
 * The model catalogue: which model, at which detail level and with which transform, stands for every
 * Placement of the world (TZ §5.3). Kenney models (CC0) are reused from the old city with its lists;
 * plain blocks, trees, lamps and the port are procedural. LOD1/LOD2 models called "<scene>__lod1" and
 * "<scene>__lod2" are used when a loaded file has them; otherwise LOD1 is LOD0 and LOD2 is a box proxy in
 * the model's own colours. All proxies share two parts, so every far building together is two draw calls.
 */
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Placement, PlacementKind } from "../world/types";
import { loadModels, type Model, type ModelPart } from "./loader";
import modelsUrl from "../../pages/city/models/city-models.glb?url";
import vehiclesUrl from "../../pages/city/models/vehicles.glb?url";

/** One detail level. `matrix` places it inside the model and `colors` tint its parts (the proxy box). */
export interface LodLevel { parts: ModelPart[]; matrix?: THREE.Matrix4; colors?: THREE.Color[] }
export interface CatalogueModel {
  id: string;
  /** LOD0, LOD1, LOD2; null = not drawn at that distance. Levels may share parts: pools draw them once. */
  lods: [LodLevel, LodLevel | null, LodLevel | null];
  /** LOD0 bounds in model space. */
  bounds: THREE.Box3;
  /** Moves the model onto its footprint: centred in x/z, standing on y = 0. */
  base: THREE.Matrix4;
  /** Per-copy shades (block walls, tree greens): copy i of the model gets tints[(i * tintStep) % length]. */
  tints?: THREE.Color[]; tintStep?: number;
}
export interface Catalogue {
  models: CatalogueModel[];
  /** Writes the copy transform of a placement into `out` and returns its model; null if it has none. */
  resolve(placement: Placement, out: THREE.Matrix4): CatalogueModel | null;
  /** Frees every geometry, material and texture, including the loaded models it was given. */
  dispose(): void;
}

const HOUSES = ["s-building-type-a", "s-building-type-b", "s-building-type-c", "s-building-type-d", "s-building-type-f", "s-building-type-g", "s-building-type-h", "s-building-type-k", "s-building-type-m", "s-building-type-p", "s-building-type-q", "s-building-type-t"];
/** Offices light enough to repeat along the mainland rows. */
const LIGHT_OFFICES = ["c-building-a", "c-building-c", "c-building-d", "c-building-f", "c-building-g", "c-building-h"];
const INDUSTRY = ["i-building-g", "i-building-h", "i-building-i", "i-building-g", "i-water-tower", "i-building-h"];
/** Parked cars per car park, as in the old city: green-belt lots behind the depot and the CRM centre, the truck yard. */
const PARKED = [["taxi", "delivery", "van", "taxi", "truck", "suv"], ["sedan", "suv", "hatchback-sports", "taxi", "police", "sedan"], ["truck", "delivery", "van", "truck"]];
/** Car Kit vehicles are 1.5 units wide; this makes them fit a one-unit lane. */
const CAR_SCALE = .5;
/** Fitted models never grow beyond this, so a small model on a big lot does not turn into a giant. */
const MAX_FIT = 2.8;
/** Top of the ground and of the parking pads. */
const GROUND = .2, PAD = .25;
/** The old four plain blocks: floors, height, glass. Blocks use classes 0…2, towers 1…3 (Placement.variant). */
const BLOCKS = [{ floors: 4, height: 3, glass: false }, { floors: 7, height: 5.2, glass: false }, { floors: 11, height: 8.4, glass: true }, { floors: 18, height: 13.6, glass: true }];
const WALLS = ["#f3e6d3", "#e9eef5", "#f6d9cf", "#dfe9dd", "#ece4f4", "#f4efe2"], GLASS = ["#b8cbe3", "#a9c4d8", "#c4c9e6", "#d5dde8"];
const TREE_TINTS = ["#ffffff", "#eaf6e2", "#f7ffe8", "#dfeed7", "#fff6dc"];
/** Proxy colours when a model's texture cannot be read: [walls, roof]. */
const FALLBACK: Record<string, [string, string]> = { s: ["#eadccb", "#b86b52"], c: ["#cfd6de", "#8e99a6"], i: ["#cdc8bd", "#8b8f95"], car: ["#d9cf6a", "#5b6068"] };

/** Loads the Kenney kits and any LOD files; a file that fails is skipped (the catalogue falls back). */
export async function loadCatalogueModels(lodUrls: string[] = []) {
  const models = new Map<string, Model>();
  const files = await Promise.allSettled([modelsUrl, vehiclesUrl, ...lodUrls].map(url => loadModels(url)));
  for (const file of files) if (file.status === "fulfilled") file.value.forEach((model, name) => models.set(name, model));
  return models;
}

/** Takes ownership of `models`: they are disposed with the catalogue. */
export function createCatalogue(models: Map<string, Model>): Catalogue {
  const owned = { geometries: new Set<THREE.BufferGeometry>(), materials: new Set<THREE.Material>(), textures: new Set<THREE.Texture>() };
  const own = <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(item: T): T => {
    if ((item as THREE.Texture).isTexture) owned.textures.add(item as THREE.Texture);
    else if ((item as THREE.Material).isMaterial) owned.materials.add(item as THREE.Material);
    else owned.geometries.add(item as THREE.BufferGeometry);
    return item;
  };
  for (const model of models.values()) for (const part of model.parts) {
    own(part.geometry); own(part.material);
    for (const value of Object.values(part.material)) if (value instanceof THREE.Texture) own(value);
  }

  const proxy = proxyParts(own);
  const pixels = new Map<unknown, ImageData | null>();
  const catalogueModels: CatalogueModel[] = [];
  const add = (model: CatalogueModel) => { catalogueModels.push(model); return model; };

  /** A loaded model with its LOD files, or the fallbacks; a name listed twice is one model drawn twice as often. */
  const byName = new Map<string, CatalogueModel | null>();
  function kenney(name: string, colours: [string, string]) {
    if (byName.has(name)) return byName.get(name)!;
    const source = models.get(name);
    byName.set(name, null);
    if (!source?.parts.length) return null;
    const lod1 = models.get(`${name}__lod1`), lod2 = models.get(`${name}__lod2`);
    const level0: LodLevel = { parts: source.parts };
    // A generated LOD2 that is only the bounding box (12 triangles) takes one texel's colour, often a dark
    // window; the proxy here averages the walls and the roof, so far buildings keep their real colours.
    const boxOnly = !lod2?.parts.length || lod2.parts.every(part => (part.geometry.index?.count ?? part.geometry.attributes.position.count) <= 36);
    const level2: LodLevel = boxOnly ? { parts: proxy, ...proxyLevel(source, colours, pixels) } : { parts: lod2!.parts };
    const model = add({ id: name, lods: [level0, lod1?.parts.length ? { parts: lod1.parts } : level0, level2], bounds: source.bounds.clone(), base: footprint(source.bounds) });
    byName.set(name, model);
    return model;
  }
  const list = (names: string[], colours: [string, string]) => names.map(name => kenney(name, colours)).filter((m): m is CatalogueModel => !!m);
  const houses = list(HOUSES, FALLBACK.s), offices = list(LIGHT_OFFICES, FALLBACK.c), industry = list(INDUSTRY, FALLBACK.i);
  const cars = new Map<string, CatalogueModel>();
  for (const name of new Set(PARKED.flat())) { const car = kenney(name, FALLBACK.car); if (car) cars.set(name, car); }

  const blocks = BLOCKS.map((kind, index) => {
    const geometry = own(blockGeometry(kind.floors));
    const material = own(new THREE.MeshStandardNodeMaterial({ map: own(facadeTexture(kind.floors, kind.glass)), vertexColors: true, roughness: kind.glass ? .4 : .85, metalness: kind.glass ? .15 : 0 }));
    const level: LodLevel = { parts: [{ geometry, material, castShadow: true }] };
    return add({ id: `block-${index}`, lods: [level, level, level], bounds: new THREE.Box3(new THREE.Vector3(-.5, 0, -.5), new THREE.Vector3(.5, 1, .5)), base: new THREE.Matrix4(), tints: (kind.glass ? GLASS : WALLS).map(c => new THREE.Color(c)), tintStep: 5 });
  });

  const treeMaterial = own(new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .85, flatShading: true }));
  const tree = (round: boolean) => {
    const near: LodLevel = { parts: [{ geometry: own(treeGeometry(round, false)), material: treeMaterial, castShadow: true }] };
    const far: LodLevel = { parts: [{ geometry: own(treeGeometry(round, true)), material: treeMaterial, castShadow: true }] };
    return add(procedural(`tree-${round ? "round" : "cone"}`, [near, near, far], { tints: TREE_TINTS.map(c => new THREE.Color(c)), tintStep: 7 }));
  };
  const trees = { cone: tree(false), round: tree(true) };

  const poleMaterial = own(new THREE.MeshStandardNodeMaterial({ color: "#5f6678", roughness: .72, metalness: .04 }));
  // Warm and brighter than white, so the bloom picks the lamps up when it is on.
  const bulbMaterial = own(new THREE.MeshStandardNodeMaterial({ color: "#fff3c4", emissive: "#ffe08a", emissiveIntensity: 1.6, roughness: .72 }));
  const lampLevel = (detail: boolean): LodLevel => ({ parts: [
    { geometry: own(new THREE.CylinderGeometry(.035, .05, 1.3, detail ? 6 : 4).translate(0, .65, 0)), material: poleMaterial, castShadow: true },
    { geometry: own(detail ? new THREE.SphereGeometry(.11, 10, 8).translate(0, 1.36, 0) : new THREE.IcosahedronGeometry(.11, 0).translate(0, 1.36, 0)), material: bulbMaterial, castShadow: false },
  ] });
  // Lamps are thinner than a pixel beyond the LOD1 distance.
  const lamp = add(procedural("lamp", [lampLevel(true), lampLevel(false), null]));

  const portMaterial = own(new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .8, metalness: .08 }));
  const port = PORT.map((build, index) => { const level: LodLevel = { parts: [{ geometry: own(build(index)), material: portMaterial, castShadow: true }] }; return add(procedural(`port-${index}`, [level, level, level])); });

  const place = new THREE.Vector3(), turn = new THREE.Quaternion(), size = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), extent = new THREE.Vector3();
  /** Fitted like the old modelParts(fit): the longer side fills `width`, at most 2.8 times its size. */
  function fitted(model: CatalogueModel, p: Placement, y: number, out: THREE.Matrix4, fixed = 0) {
    model.bounds.getSize(extent);
    const scale = fixed || (p.width ? Math.min(MAX_FIT, p.width / Math.max(extent.x, extent.z)) : 1);
    return out.compose(place.set(p.x, y, p.z), turn.setFromAxisAngle(up, p.rotation), size.setScalar(scale)).multiply(model.base);
  }
  /** Plain blocks keep the old footprint (`width`) and a height scale; the depth varies a little per lot. */
  function block(p: Placement, variant: number, out: THREE.Matrix4) {
    const model = blocks[Math.min(BLOCKS.length - 1, Math.max(0, variant))], kind = BLOCKS[blocks.indexOf(model)];
    const width = p.width || 3, depth = .8 + .2 * fract(Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453);
    out.compose(place.set(p.x, GROUND, p.z), turn.setFromAxisAngle(up, p.rotation), size.set(width, kind.height * (p.scale || 1), width * depth));
    return model;
  }
  const pick = <T>(items: T[], variant: number) => items.length ? items[((variant % items.length) + items.length) % items.length] : null;

  function resolve(p: Placement, out: THREE.Matrix4): CatalogueModel | null {
    const kind: PlacementKind = p.kind;
    switch (kind) {
      case "house": case "office": case "industry": {
        const model = pick(kind === "house" ? houses : kind === "office" ? offices : industry, p.variant);
        // Without the Kenney file the lots get plain blocks, as the old city did.
        if (!model) return block({ ...p, width: Math.min(p.width, 3.8) }, kind === "office" ? 1 : 0, out);
        fitted(model, p, GROUND, out);
        return model;
      }
      case "block": case "tower": return block(p, p.variant, out);
      case "port": { const model = pick(port, p.variant)!; fitted(model, p, GROUND, out); return model; }
      case "tree-cone": case "tree-round": {
        const model = kind === "tree-round" ? trees.round : trees.cone;
        out.compose(place.set(p.x, GROUND, p.z), turn.setFromAxisAngle(up, p.rotation), size.setScalar(p.scale || 1));
        return model;
      }
      case "lamp": out.compose(place.set(p.x, GROUND, p.z), turn.identity(), size.setScalar(1)); return lamp;
      case "car-parked": {
        // The generator numbers stalls k * 7 + lot: the lot picks the old list, the number a car in it.
        const names = PARKED[(p.variant % 7) % PARKED.length], model = cars.get(names[p.variant % names.length]) ?? pick([...cars.values()], p.variant);
        if (!model) return null;
        fitted(model, p, PAD, out, CAR_SCALE);
        return model;
      }
    }
    return null;
  }

  // Proxy colours are read; the pixel copies are no longer needed.
  pixels.clear();
  return {
    models: catalogueModels,
    resolve,
    dispose() {
      owned.textures.forEach(t => t.dispose()); owned.geometries.forEach(g => g.dispose()); owned.materials.forEach(m => m.dispose());
      owned.textures.clear(); owned.geometries.clear(); owned.materials.clear(); pixels.clear(); models.clear();
    },
  };
}

const fract = (v: number) => v - Math.floor(v);
function procedural(id: string, lods: CatalogueModel["lods"], extra: Partial<CatalogueModel> = {}): CatalogueModel {
  const bounds = new THREE.Box3();
  for (const level of lods) for (const part of level?.parts ?? []) { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox!); }
  return { id, lods, bounds, base: new THREE.Matrix4(), ...extra };
}
/** Centres the model on its footprint and stands it on y = 0. */
function footprint(bounds: THREE.Box3) {
  const center = bounds.getCenter(new THREE.Vector3());
  return new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z);
}

/** Walls and roof of a unit box (x, z in ±0.5, y in 0…1), shared by every proxy with per-copy colours. */
function proxyParts(own: <T extends THREE.BufferGeometry | THREE.Material>(item: T) => T): ModelPart[] {
  const material = own(new THREE.MeshStandardNodeMaterial({ roughness: .85, metalness: 0 }));
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), index = box.index!.array;
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z, six indices each; the bottom is never seen.
  const faces = (list: number[]) => { const g = box.clone(); g.setIndex(list.flatMap(f => Array.from(index.slice(f * 6, f * 6 + 6)))); g.clearGroups(); g.deleteAttribute("uv"); return own(g); };
  const parts = [{ geometry: faces([0, 1, 4, 5]), material, castShadow: true }, { geometry: faces([2]), material, castShadow: true }];
  box.dispose();
  return parts;
}

/** The proxy box of a model, 5% inside its bounds, in the average colours of its walls and its roof. */
function proxyLevel(model: Model, fallback: [string, string], cache: Map<unknown, ImageData | null>): Pick<LodLevel, "matrix" | "colors"> {
  const center = model.bounds.getCenter(new THREE.Vector3()), size = model.bounds.getSize(new THREE.Vector3()).multiplyScalar(.95);
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(center.x, model.bounds.min.y, center.z), new THREE.Quaternion(), size);
  return { matrix, colors: averageColours(model, cache) ?? fallback.map(c => new THREE.Color(c)) };
}

/** Area-weighted texture colour of the up-facing (roof) and other (wall) triangles; null without pixels. */
function averageColours(model: Model, cache: Map<unknown, ImageData | null>): THREE.Color[] | null {
  const sums = [[0, 0, 0, 0], [0, 0, 0, 0]], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), uv = new THREE.Vector2(), texel = new THREE.Color(), sample = new THREE.Color();
  for (const { geometry, material } of model.parts) {
    const { map, color } = material as THREE.MeshStandardMaterial, position = geometry.getAttribute("position"), uvs = geometry.getAttribute("uv");
    const image = map && uvs ? texturePixels(map, cache) : null;
    if (map) map.updateMatrix();
    // A few hundred triangles per part give the average; every triangle would cost tens of milliseconds.
    const count = geometry.index ? geometry.index.count : position.count, at = (k: number) => geometry.index ? geometry.index.getX(k) : k;
    const stride = 3 * Math.max(1, Math.floor(count / 3 / 400));
    for (let k = 0; k + 2 < count; k += stride) {
      const i = at(k), j = at(k + 1), l = at(k + 2);
      a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, j); c.fromBufferAttribute(position, l);
      const normal = b.sub(a).cross(c.sub(a)), area = normal.length() / 2;
      if (!area) continue;
      texel.copy(color ?? texel.setRGB(1, 1, 1));
      if (image && map && uvs) {
        uv.set((uvs.getX(i) + uvs.getX(j) + uvs.getX(l)) / 3, (uvs.getY(i) + uvs.getY(j) + uvs.getY(l)) / 3);
        map.transformUv(uv);
        const x = Math.min(image.width - 1, Math.floor(uv.x * image.width)), y = Math.min(image.height - 1, Math.floor(uv.y * image.height)), o = (y * image.width + x) * 4;
        texel.multiply(sample.setRGB(image.data[o] / 255, image.data[o + 1] / 255, image.data[o + 2] / 255, THREE.SRGBColorSpace));
      } else if (map) return null;
      const sum = sums[normal.y / (2 * area) > .6 ? 1 : 0];
      sum[0] += texel.r * area; sum[1] += texel.g * area; sum[2] += texel.b * area; sum[3] += area;
    }
  }
  if (!sums[0][3] && !sums[1][3]) return null;
  const mean = ([r, g, bl, w]: number[], other: number[]) => w ? new THREE.Color(r / w, g / w, bl / w) : new THREE.Color(other[0] / other[3], other[1] / other[3], other[2] / other[3]);
  return [mean(sums[0], sums[1]), mean(sums[1], sums[0])];
}

/** The texture's pixels via a small canvas (browsers only); cached per image. */
function texturePixels(texture: THREE.Texture, cache: Map<unknown, ImageData | null>): ImageData | null {
  const image = texture.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!image?.width || typeof document === "undefined") return null;
  if (!cache.has(image)) {
    try {
      const canvas = document.createElement("canvas"), scale = Math.min(1, 256 / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      cache.set(image, ctx.getImageData(0, 0, canvas.width, canvas.height));
    } catch { cache.set(image, null); }
  }
  return cache.get(image) ?? null;
}

/**
 * A unit block (x, z in ±0.5, y in 0…1) with one material: walls map the window rows of the facade, the
 * roof maps its plain top band and is painted grey by vertex colour, as the old top material was.
 */
function blockGeometry(floors: number) {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), uv = g.getAttribute("uv"), colors = new Float32Array(24 * 3), roof = new THREE.Color("#9aa3ad");
  const rows = floors / (floors + 1), band = (floors + .5) / (floors + 1);
  for (let i = 0; i < 24; i++) {
    const top = Math.floor(i / 4) === 2;
    if (top) uv.setXY(i, .5, band); else uv.setY(i, uv.getY(i) * rows);
    colors.set(top ? [roof.r, roof.g, roof.b] : [1, 1, 1], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const index = Array.from(g.index!.array); g.setIndex([...index.slice(0, 18), ...index.slice(24)]); g.clearGroups();
  return g;
}

/** Painted windows, three per floor, every seventh lit; a plain band on top for the roof. */
function facadeTexture(floors: number, glass: boolean) {
  const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64 * (floors + 1);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 64, canvas.height);
  for (let f = 0; f < floors; f++) for (let c = 0; c < 3; c++) {
    ctx.fillStyle = (f * 3 + c) % 7 === 0 ? "#ffe9a8" : glass ? "#8fb3dc" : "#9aabc4";
    ctx.fillRect(6 + c * 19, (f + 1) * 64 + 14, 14, 30);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** One colour per vertex and no uvs, so pieces merge into one geometry drawn with one material. */
function paint(geometry: THREE.BufferGeometry, color: string) {
  const c = new THREE.Color(color), part = geometry.index ? geometry.toNonIndexed() : geometry, n = part.getAttribute("position").count, colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  part.setAttribute("color", new THREE.BufferAttribute(colors, 3)); part.deleteAttribute("uv");
  if (part !== geometry) geometry.dispose();
  return part;
}
function merge(parts: THREE.BufferGeometry[]) { const merged = mergeGeometries(parts)!; parts.forEach(p => p.dispose()); return merged; }

/** The old low-poly trees; the far version has fewer sides. */
function treeGeometry(round: boolean, far: boolean) {
  const parts = [paint(new THREE.CylinderGeometry(.08, .11, .8, far ? 4 : 6).translate(0, .4, 0), "#8a6a55")];
  if (round) parts.push(paint(new THREE.IcosahedronGeometry(.62, far ? 0 : 1).translate(0, 1.3, 0), "#799363"));
  else if (far) parts.push(paint(new THREE.ConeGeometry(.6, 1.9, 5).translate(0, 1.55, 0), "#5f8662"));
  else parts.push(paint(new THREE.ConeGeometry(.6, 1.3, 8).translate(0, 1.3, 0), "#517b60"), paint(new THREE.ConeGeometry(.44, 1, 8).translate(0, 1.9, 0), "#789465"));
  return merge(parts);
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), color);
/** Port pieces, about 6.5 units across so they fit a double lot: warehouses, a gantry crane, container yards. */
const PORT: ((seed: number) => THREE.BufferGeometry)[] = [
  () => merge([box(6.2, 2.2, 3.8, 0, 0, 0, "#cfc6b6"), box(6.4, .35, 4, 0, 2.2, 0, "#8f5f4c"), box(5.6, .3, 2.6, 0, 2.55, 0, "#a06a53"),
    ...[-2, 0, 2].map(x => box(1.3, 1.5, .08, x, 0, 1.92, "#6b7380"))]),
  () => {
    const legs = [[-1.5, -1.2], [1.5, -1.2], [-1.5, 1.2], [1.5, 1.2]].map(([x, z]) => box(.26, 5, .26, x, 0, z, "#d9a13b"));
    return merge([...legs, box(3.3, .3, .3, 0, 2.4, -1.2, "#d9a13b"), box(3.3, .3, .3, 0, 2.4, 1.2, "#d9a13b"), box(.5, .45, 7.4, 0, 5, .9, "#d9a13b"),
      box(3.4, .45, .5, 0, 5, -1.2, "#d9a13b"), box(3.4, .45, .5, 0, 5, 1.2, "#d9a13b"), box(.9, .7, .9, 0, 4.3, 2.2, "#e8e3d8"), box(.06, 1.8, .06, 0, 3.2, 3.6, "#3d4148")]);
  },
  seed => containers(seed), seed => containers(seed),
  () => merge([box(6.4, 2.8, 3, 0, 0, -.4, "#b9c2c9"), box(6.6, .3, 3.2, 0, 2.8, -.4, "#6f7d88"), box(1.6, 1.8, .08, -1.8, 0, 1.12, "#5a626d"), box(1.6, 1.8, .08, 1.8, 0, 1.12, "#5a626d")]),
];
/** A yard of stacked containers, 1 to 3 high, in seeded colours. */
function containers(seed: number) {
  const colours = ["#b5432f", "#2f6fa3", "#d38b2c", "#3f8a5a", "#8a8f99", "#c9c3b6"], parts: THREE.BufferGeometry[] = [];
  let s = seed * 7919 + 17;
  const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) {
    const height = 1 + Math.floor(random() * 3);
    for (let level = 0; level < height; level++) parts.push(box(2.6, .62, 1.05, col * 3.1 - 1.55, level * .64, row * 1.25 - 1.25, colours[Math.floor(random() * colours.length)]));
  }
  return merge(parts);
}
