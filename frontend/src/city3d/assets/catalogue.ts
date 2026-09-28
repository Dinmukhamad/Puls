/**
 * The model catalogue: which model, at which detail level and with which transform, stands for every
 * Placement of the world (TZ §5.3). Kenney models (CC0) are reused from the old city with its lists;
 * plain blocks, trees, lamps and the port are procedural. LOD1/LOD2 models called "<scene>__lod1" and
 * "<scene>__lod2" are used when a loaded file has them; otherwise LOD1 is LOD0 and LOD2 is a box proxy in
 * the model's own colours. All proxies share two parts, so every far building together is two draw calls.
 * At night the windows of every building light up (TZ §6.7): emissive nodes scaled by the night level, in
 * the same materials and draw calls, nothing drawn or computed on the CPU per frame.
 */
import * as THREE from "three/webgpu";
import { attribute, clamp, color, dot, float, floor, fwidth, max, mix, varyingProperty, normalGeometry, normalLocal, normalWorld, positionGeometry, positionLocal, positionWorld, smoothstep, step, texture, uv, varying, vec2, vec3, type ShaderNodeObject } from "three/tsl";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Placement, PlacementKind } from "../world/types";
import { createNight, type Night } from "../render/night";
import { loadModels, type Model, type ModelPart } from "./loader";
import { furnitureGeometry, gableGeometry, officeGeometry, SECTION_PART, SECTION_PARTS, sectionGeometry, treeKindGeometry, type FurnitureKind } from "./courtyard";
import { OFFICE_FLOOR, OFFICE_FLOORS, SECTION_FLOORS, SECTION_WIDTH } from "../world/complexes";
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
/**
 * Residential walls, picked by index in world/complexes.ts: renders (0 white, 1 pearl, 2 cream, 3 light grey),
 * bricks (4 red, 5 terracotta, 6 sand, 7 brown), accents (8 graphite, 9 peach, 10 blue-grey, 11 warm stone) and two
 * greens (12 sage, 13 mint) whose towers get planted balconies (sectionFacade tells them by their green cast).
 */
const SECTION_TINTS = ["#f6f4ef", "#ece8e1", "#efe2cc", "#e2e7ea", "#c7765a", "#d49a6e", "#dcc09a", "#9d7b66", "#8c939b", "#e3c3a0", "#b7c6d4", "#c9b8a2", "#a9bda8", "#e2efdf"];
/** Townhouse roofs: slate, terracotta, brown, dark grey, zinc. */
const ROOF_TINTS = ["#5d646c", "#b0654a", "#7a5a48", "#454b52", "#9aa3aa"];
/** Section floors and window columns in world units (a section of SECTION_WIDTH has three columns). */
const SECTION_FLOOR = .75, SECTION_PANE = SECTION_WIDTH / 3;
/** Office glass: white, cool, warm and green-grey tints over the glass colours of officeFacade. */
const OFFICE_TINTS = ["#ffffff", "#eef3f8", "#f5f2ec", "#e9f1ee"];
const FURNITURE: FurnitureKind[] = ["bench", "slide", "swings", "climber", "sandbox", "goal", "hoop", "gazebo", "flowerbed", "bush", "hedge", "planter", "fountain"];
/** Proxy colours when a model's texture cannot be read: [walls, roof]. */
const FALLBACK: Record<string, [string, string]> = { s: ["#eadccb", "#b86b52"], c: ["#cfd6de", "#8e99a6"], i: ["#cdc8bd", "#8b8f95"], car: ["#d9cf6a", "#5b6068"] };

/** Loads the Kenney kits and any LOD files; a file that fails is skipped (the catalogue falls back). */
export async function loadCatalogueModels(lodUrls: string[] = []) {
  const models = new Map<string, Model>();
  const files = await Promise.allSettled([modelsUrl, vehiclesUrl, ...lodUrls].map(url => loadModels(url)));
  for (const file of files) if (file.status === "fulfilled") file.value.forEach((model, name) => models.set(name, model));
  return models;
}

/** Takes ownership of `models`: they are disposed with the catalogue. Windows glow with `night.level` (ctx.night). */
export function createCatalogue(models: Map<string, Model>, night: Night = createNight()): Catalogue {
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

  const nightLevel = night.level as unknown as Node;
  // Far buildings get a window grid on their proxy walls; parked cars keep plain boxes (same geometries).
  const proxy = proxyParts(own, proxyGlow(nightLevel)), plainProxy = proxy.map(part => ({ ...part, material: proxy[1].material }));
  const pixels = new Map<unknown, ImageData | null>();
  const catalogueModels: CatalogueModel[] = [];
  const add = (model: CatalogueModel) => { catalogueModels.push(model); return model; };

  // One lit node copy of each kit material (the kits share one colour map each), used by the parts whose glass
  // is marked; a part without readable pixels or glass keeps the kit material.
  const kenneyLight = kenneyGlow(nightLevel), litKits = new Map<THREE.Material, THREE.MeshStandardNodeMaterial>();
  function lightWindows(parts: ModelPart[]) {
    for (const part of parts) {
      const kit = part.material as THREE.MeshStandardMaterial;
      if ((kit as unknown as THREE.NodeMaterial).isNodeMaterial || !kit.isMeshStandardMaterial || !kit.map || !markWindows(part.geometry, kit.map, pixels)) continue;
      let lit = litKits.get(kit);
      if (!lit) { lit = own(nodeCopy(kit)); lit.emissiveNode = kenneyLight; litKits.set(kit, lit); }
      part.material = lit;
    }
  }

  /** A loaded model with its LOD files, or the fallbacks; a name listed twice is one model drawn twice as often. */
  const byName = new Map<string, CatalogueModel | null>();
  function kenney(name: string, colours: [string, string], windows = true) {
    if (byName.has(name)) return byName.get(name)!;
    const source = models.get(name);
    byName.set(name, null);
    if (!source?.parts.length) return null;
    const lod1 = models.get(`${name}__lod1`), lod2 = models.get(`${name}__lod2`);
    const level0: LodLevel = { parts: source.parts };
    // A generated LOD2 that is only the bounding box (12 triangles) takes one texel's colour, often a dark
    // window; the proxy here averages the walls and the roof, so far buildings keep their real colours.
    const boxOnly = !lod2?.parts.length || lod2.parts.every(part => (part.geometry.index?.count ?? part.geometry.attributes.position.count) <= 36);
    if (windows) for (const model of [source, lod1, boxOnly ? null : lod2]) if (model) lightWindows(model.parts);
    const level2: LodLevel = boxOnly ? { parts: windows ? proxy : plainProxy, ...proxyLevel(source, colours, pixels) } : { parts: lod2!.parts };
    const model = add({ id: name, lods: [level0, lod1?.parts.length ? { parts: lod1.parts } : level0, level2], bounds: source.bounds.clone(), base: footprint(source.bounds) });
    byName.set(name, model);
    return model;
  }
  const list = (names: string[], colours: [string, string]) => names.map(name => kenney(name, colours)).filter((m): m is CatalogueModel => !!m);
  const houses = list(HOUSES, FALLBACK.s), offices = list(LIGHT_OFFICES, FALLBACK.c), industry = list(INDUSTRY, FALLBACK.i);
  const cars = new Map<string, CatalogueModel>();
  for (const name of new Set(PARKED.flat())) { const car = kenney(name, FALLBACK.car, false); if (car) cars.set(name, car); }

  const blocks = BLOCKS.map((kind, index) => {
    const geometry = own(blockGeometry(kind.floors));
    const map = own(facadeTexture(kind.floors, kind.glass));
    const material = own(new THREE.MeshStandardNodeMaterial({ map, vertexColors: true, roughness: kind.glass ? .4 : .85, metalness: kind.glass ? .15 : 0 }));
    material.emissiveNode = blockGlow(map, kind.floors, nightLevel);
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
  const moreTrees = Object.fromEntries((["birch", "oak"] as const).map(kind => {
    const near: LodLevel = { parts: [{ geometry: own(treeKindGeometry(kind, false)), material: treeMaterial, castShadow: true }] };
    const far: LodLevel = { parts: [{ geometry: own(treeKindGeometry(kind, true)), material: treeMaterial, castShadow: true }] };
    return [kind, add(procedural(`tree-${kind}`, [near, near, far], { tints: TREE_TINTS.map(c => new THREE.Color(c)), tintStep: 3 }))];
  })) as Record<"birch" | "oak", CatalogueModel>;

  // Residential sections, one model per height: balconies and roof houses near, the roof house farther, a plain box
  // far away, shared by every height; all drawn with a facade in world units (sectionFacade).
  const sectionMaterial = own(new THREE.MeshStandardNodeMaterial({ roughness: .8, metalness: 0 }));
  sectionFacade(sectionMaterial, nightLevel);
  const sectionTints = SECTION_TINTS.map(c => new THREE.Color(c)), unitBox = new THREE.Box3(new THREE.Vector3(-.5, 0, -.5), new THREE.Vector3(.5, 1, .5));
  const sectionPart = (geometry: THREE.BufferGeometry): LodLevel => ({ parts: [{ geometry: own(geometry), material: sectionMaterial, castShadow: true }] });
  const plainSection = sectionPart(sectionGeometry(1, 0));
  const sections = SECTION_FLOORS.map(floors => add({ id: `section-${floors}`, lods: [sectionPart(sectionGeometry(floors, 2)), sectionPart(sectionGeometry(floors, 1)), plainSection], bounds: unitBox.clone(), base: new THREE.Matrix4(), tints: sectionTints, tintStep: 5 }));
  // Office towers and podiums of the business quarters: glass curtain walls (officeFacade), one model per height.
  const officeMaterial = own(new THREE.MeshStandardNodeMaterial({ roughness: .5, metalness: 0 }));
  officeFacade(officeMaterial, nightLevel);
  const officeTints = OFFICE_TINTS.map(c => new THREE.Color(c)), officePart = (geometry: THREE.BufferGeometry): LodLevel => ({ parts: [{ geometry: own(geometry), material: officeMaterial, castShadow: true }] });
  const plainOffice = officePart(officeGeometry(1, 0));
  const glassTowers = OFFICE_FLOORS.map(floors => add({ id: `office-${floors}`, lods: [officePart(officeGeometry(floors, 2)), officePart(officeGeometry(floors, 1)), plainOffice], bounds: unitBox.clone(), base: new THREE.Matrix4(), tints: officeTints, tintStep: 3 }));
  // Cottages of the garden suburb: the plain section box (one pool with every far section) under a gabled roof.
  const cottage = add({ id: "cottage", lods: [plainSection, plainSection, plainSection], bounds: unitBox.clone(), base: new THREE.Matrix4(), tints: sectionTints, tintStep: 5 });
  // Gabled townhouse roofs: one prism, its ridge along the depth so the gable faces the street.
  const roofMaterial = own(new THREE.MeshStandardNodeMaterial({ roughness: .8, metalness: 0 }));
  const roofLevel: LodLevel = { parts: [{ geometry: own(gableGeometry()), material: roofMaterial, castShadow: true }] };
  const roof = add({ id: "roof", lods: [roofLevel, roofLevel, roofLevel], bounds: unitBox.clone(), base: new THREE.Matrix4(), tints: ROOF_TINTS.map(c => new THREE.Color(c)), tintStep: 2 });
  // The floors over an arch: a plain box raised over the opening.
  const arch = add({ id: "section-arch", lods: [plainSection, plainSection, plainSection], bounds: unitBox.clone(), base: new THREE.Matrix4(), tints: sectionTints, tintStep: 5 });
  // Courtyard furniture: one material, one pool each; small pieces are not drawn beyond LOD1.
  const furnitureMaterial = own(new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .78, metalness: .05 }));
  const furniture = Object.fromEntries(FURNITURE.map(kind => {
    const [nearGeometry, farGeometry] = furnitureGeometry(kind);
    const near: LodLevel = { parts: [{ geometry: own(nearGeometry), material: (kind === "bush" || kind === "hedge") ? treeMaterial : furnitureMaterial, castShadow: true }] };
    const far: LodLevel | null = farGeometry ? { parts: [{ geometry: own(farGeometry), material: (kind === "bush" || kind === "hedge") ? treeMaterial : furnitureMaterial, castShadow: true }] } : null;
    const model = add(procedural(kind, [near, near, far], (kind === "bush" || kind === "hedge") ? { tints: TREE_TINTS.map(c => new THREE.Color(c)), tintStep: 2 } : {}));
    // Pieces too small for a far version of their own become a box in their own colours, drawn with the far buildings,
    // so a yard never empties when the camera moves away.
    if (!far) model.lods[2] = { parts: plainProxy, ...vertexColourProxy(nearGeometry) };
    return [kind, model];
  })) as Record<FurnitureKind, CatalogueModel>;

  const poleMaterial = own(new THREE.MeshStandardNodeMaterial({ color: "#5f6678", roughness: .72, metalness: .04 }));
  // Plain light-grey glass in the day; a warm glow × the night level, well above the bloom threshold at night.
  const bulbMaterial = own(new THREE.MeshStandardNodeMaterial({ name: "lamp-bulb", color: "#dfe4ea", roughness: .3, metalness: .05 }));
  bulbMaterial.emissiveNode = color("#ffcf85").mul(nightLevel).mul(3.2);
  // Pole and conical shade are one geometry (one draw call); the bulb hangs under the shade, its centre 1.35
  // above the foot (render/lampLights.ts puts the halos there). About 120 triangles near, 46 at LOD1.
  const lampLevel = (detail: boolean): LodLevel => ({ parts: [
    { geometry: own(merge([new THREE.CylinderGeometry(.035, .05, 1.45, detail ? 6 : 4).translate(0, .725, 0), new THREE.ConeGeometry(.17, .12, detail ? 8 : 5, 1, true).translate(0, 1.44, 0)])), material: poleMaterial, castShadow: true },
    { geometry: own(detail ? new THREE.SphereGeometry(.09, 8, 6).translate(0, 1.35, 0) : new THREE.IcosahedronGeometry(.09, 0).translate(0, 1.35, 0)), material: bulbMaterial, castShadow: false },
  ] });
  // Lamps are thinner than a pixel beyond the LOD1 distance.
  // Far away a lamp is a slim grey box, drawn with every other far proxy.
  const lamp = add(procedural("lamp", [lampLevel(true), lampLevel(false), null]));
  lamp.lods[2] = { parts: plainProxy, matrix: new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), new THREE.Vector3(.12, 1.45, .12)), colors: [new THREE.Color("#5f6678"), new THREE.Color("#dfe4ea")] };

  const portMaterial = own(new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .8, metalness: .08 }));
  portMaterial.emissiveNode = portGlow(nightLevel);
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
        out.compose(place.set(p.x, GROUND + (p.lift ?? 0), p.z), turn.setFromAxisAngle(up, p.rotation), size.setScalar(p.scale || 1));
        return model;
      }
      case "tree-birch": case "tree-oak":
        out.compose(place.set(p.x, GROUND, p.z), turn.setFromAxisAngle(up, p.rotation), size.setScalar(p.scale || 1));
        return moreTrees[kind === "tree-birch" ? "birch" : "oak"];
      case "cottage":
        out.compose(place.set(p.x, GROUND, p.z), turn.setFromAxisAngle(up, p.rotation), size.set(p.width || 3, (p.variant ? 2 : 1) * SECTION_FLOOR, p.depth ?? 2.4));
        return cottage;
      case "roof":
        out.compose(place.set(p.x, GROUND + (p.lift ?? 0), p.z), turn.setFromAxisAngle(up, p.rotation), size.set(p.width || 2.6, p.scale || 1, p.depth ?? 2.4));
        return roof;
      case "glass-tower": {
        const index = Math.min(OFFICE_FLOORS.length - 1, Math.max(0, p.variant)), lift = p.lift ?? 0;
        out.compose(place.set(p.x, GROUND + lift, p.z), turn.setFromAxisAngle(up, p.rotation), size.set(p.width || 8, OFFICE_FLOORS[index] * OFFICE_FLOOR - lift, p.depth ?? 6));
        return glassTowers[index];
      }
      case "section": {
        const index = Math.min(SECTION_FLOORS.length - 1, Math.max(0, p.variant)), lift = p.lift ?? 0;
        out.compose(place.set(p.x, GROUND + lift, p.z), turn.setFromAxisAngle(up, p.rotation), size.set(p.width || SECTION_WIDTH, SECTION_FLOORS[index] * SECTION_FLOOR - lift, p.depth ?? 2.4));
        return lift > 0 ? arch : sections[index];
      }
      case "bench": case "slide": case "swings": case "climber": case "sandbox": case "goal": case "hoop": case "gazebo": case "flowerbed": case "bush": case "hedge": case "planter": case "fountain":
        out.compose(place.set(p.x, GROUND + (p.lift ?? 0), p.z), turn.setFromAxisAngle(up, p.rotation), size.setScalar(p.scale || 1));
        return furniture[kind];
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

/** Walls and roof of a unit box (x, z in ±0.5, y in 0…1), shared by every proxy with per-copy colours; the walls glow with `glow`. */
function proxyParts(own: <T extends THREE.BufferGeometry | THREE.Material>(item: T) => T, glow: Node): ModelPart[] {
  const material = own(new THREE.MeshStandardNodeMaterial({ roughness: .85, metalness: 0 }));
  const walls = own(new THREE.MeshStandardNodeMaterial({ roughness: .85, metalness: 0 }));
  walls.emissiveNode = glow;
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), index = box.index!.array;
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z, six indices each; the bottom is never seen.
  const faces = (list: number[]) => { const g = box.clone(); g.setIndex(list.flatMap(f => Array.from(index.slice(f * 6, f * 6 + 6)))); g.clearGroups(); g.deleteAttribute("uv"); return own(g); };
  const parts = [{ geometry: faces([0, 1, 4, 5]), material: walls, castShadow: true }, { geometry: faces([2]), material, castShadow: true }];
  box.dispose();
  return parts;
}

/** The proxy box of a model, 5% inside its bounds, in the average colours of its walls and its roof. */
function proxyLevel(model: Model, fallback: [string, string], cache: Map<unknown, ImageData | null>): Pick<LodLevel, "matrix" | "colors"> {
  const center = model.bounds.getCenter(new THREE.Vector3()), size = model.bounds.getSize(new THREE.Vector3()).multiplyScalar(.95);
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(center.x, model.bounds.min.y, center.z), new THREE.Quaternion(), size);
  return { matrix, colors: averageColours(model, cache) ?? fallback.map(c => new THREE.Color(c)) };
}

/** A far proxy for a painted procedural model: its bounds, 5% in, and the area-weighted vertex colours of its sides and top. */
function vertexColourProxy(geometry: THREE.BufferGeometry): Pick<LodLevel, "matrix" | "colors"> {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3()).multiplyScalar(.95);
  const position = geometry.getAttribute("position"), colour = geometry.getAttribute("color"), sums = [[0, 0, 0, 0], [0, 0, 0, 0]];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), count = geometry.index ? geometry.index.count : position.count, at = (k: number) => geometry.index ? geometry.index.getX(k) : k;
  for (let k = 0; colour && k + 2 < count; k += 3) {
    const i = at(k), j = at(k + 1), l = at(k + 2);
    a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, j); c.fromBufferAttribute(position, l);
    const normal = b.sub(a).cross(c.sub(a)), area = normal.length() / 2;
    if (!area) continue;
    const sum = sums[normal.y > area ? 1 : 0];
    sum[0] += colour.getX(i) * area; sum[1] += colour.getY(i) * area; sum[2] += colour.getZ(i) * area; sum[3] += area;
  }
  const colors = sums.map(([r, g, bl, w]) => w ? new THREE.Color(r / w, g / w, bl / w) : new THREE.Color("#8a8f96"));
  return { matrix: new THREE.Matrix4().compose(new THREE.Vector3(center.x, bounds.min.y, center.z), new THREE.Quaternion(), size), colors };
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

/** A painted box; `windows` 1 marks shed walls for the night windows (every port piece has the attribute, so they merge). */
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, windows = 0) {
  const part = paint(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), color);
  part.setAttribute(WINDOW, new THREE.BufferAttribute(new Float32Array(part.getAttribute("position").count).fill(windows), 1));
  return part;
}
/** Port pieces, about 6.5 units across so they fit a double lot: warehouses, a gantry crane, container yards. */
const PORT: ((seed: number) => THREE.BufferGeometry)[] = [
  () => merge([box(6.2, 2.2, 3.8, 0, 0, 0, "#cfc6b6", 1), box(6.4, .35, 4, 0, 2.2, 0, "#8f5f4c"), box(5.6, .3, 2.6, 0, 2.55, 0, "#a06a53"),
    ...[-2, 0, 2].map(x => box(1.3, 1.5, .08, x, 0, 1.92, "#6b7380"))]),
  () => {
    const legs = [[-1.5, -1.2], [1.5, -1.2], [-1.5, 1.2], [1.5, 1.2]].map(([x, z]) => box(.26, 5, .26, x, 0, z, "#d9a13b"));
    return merge([...legs, box(3.3, .3, .3, 0, 2.4, -1.2, "#d9a13b"), box(3.3, .3, .3, 0, 2.4, 1.2, "#d9a13b"), box(.5, .45, 7.4, 0, 5, .9, "#d9a13b"),
      box(3.4, .45, .5, 0, 5, -1.2, "#d9a13b"), box(3.4, .45, .5, 0, 5, 1.2, "#d9a13b"), box(.9, .7, .9, 0, 4.3, 2.2, "#e8e3d8"), box(.06, 1.8, .06, 0, 3.2, 3.6, "#3d4148")]);
  },
  seed => containers(seed), seed => containers(seed),
  () => merge([box(6.4, 2.8, 3, 0, 0, -.4, "#b9c2c9", 1), box(6.6, .3, 3.2, 0, 2.8, -.4, "#6f7d88"), box(1.6, 1.8, .08, -1.8, 0, 1.12, "#5a626d"), box(1.6, 1.8, .08, 1.8, 0, 1.12, "#5a626d")]),
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

// Night windows (TZ §6.7). Every light is an emissive node times the night level: no rebuild when the mode
// switches, and nothing is added in the day (emissive 0). Seeds never use the instance index: it is the
// copy's slot in its pool, which changes whenever the pools refill, so lit windows would jump around.

type Node = ShaderNodeObject<THREE.Node>;
/** Kenney parts: 0 off the glass, a random 0 < w ≤ 1 per window on it. Port pieces: 1 on shed walls. */
const WINDOW = "windowSeed";
/** Share of lit windows per building (per wall for blocks): from a sleepy one to an all-awake one, ~60% on average. */
const LIT_SHARE: [number, number] = [.4, .85];
/** Warm shades of lit windows; brighter than white, so the bloom picks them up when it is on. */
const WARM_LOW = "#ffd48a", WARM_HIGH = "#fff1c9", WINDOW_GLOW = 1.2;
/**
 * Far proxies: the window grid in world units, the part of a cell a window takes (across, up) and the lit share
 * against a near building. Tuned so a box gives off about as much light as the Kenney model it replaces (houses
 * have few windows): a grid of 0.7 × 0.62 made buildings about 5 times brighter when they turned into boxes.
 */
const FLOOR_HEIGHT = .95, COLUMN_WIDTH = 1.3, PANE_U: [number, number] = [.36, .64], PANE_V: [number, number] = [.35, .65], PROXY_LIT = .55;

/** Hash without sine (D. Hoskins): 0…1 from a vec2, the same on every GPU and both backends. */
function hash(p: Node): Node {
  const p3 = vec3(p.x, p.y, p.x).mul(.1031).fract();
  const q = p3.add(dot(p3, p3.yzx.add(33.33)));
  return q.x.add(q.y).mul(q.z).fract();
}
const litShare = (seed: Node) => mix(LIT_SHARE[0], LIT_SHARE[1], seed);
/** One window at full night: on when its hash is under the share, in a shade and brightness of its own. */
function windowLight(h: Node, share: Node): Node {
  return mix(color(WARM_LOW), color(WARM_HIGH), h.mul(7.31).fract()).mul(step(h, share)).mul(h.mul(3.17).fract().mul(.4).add(.6)).mul(WINDOW_GLOW);
}
/** The night level for one window: windows switch on one by one while the level eases in, not all at once (TZ §6.7); 0 by day, 1 at night. */
function stagger(h: Node, level: Node): Node {
  const start = h.mul(5.31).fract().mul(.65);
  return smoothstep(start, start.add(.3), level);
}
/** Box-filtered pulse train, 1 on a…b of every unit of x: the share of the pixel a window covers, so far grids average instead of shimmering. */
function pulse(x: Node, a: number, b: number): Node {
  const w = max(fwidth(x), 1e-4), ramp = (t: Node) => floor(t).mul(b - a).add(clamp(t.fract().sub(a), 0, b - a));
  return ramp(x.add(w.mul(.5))).sub(ramp(x.sub(w.mul(.5)))).div(w);
}

/**
 * Vertex stage only: the copy's origin. Fitted copies only move, turn about y and scale evenly, and three's
 * instanced normal is R·n / s, so s = |n| / |normal| and R turns n.xz onto normal.xz (as complex numbers).
 * Every vertex of a copy gets the same point, wherever the copy sits in its pool.
 */
function copyOrigin(): Node {
  const n = normalGeometry, m = normalLocal, p = positionGeometry;
  const scale = n.length().div(max(m.length(), 1e-6));
  const a = n.xz.div(max(n.xz.length(), 1e-6)), b = m.xz.div(max(m.xz.length(), 1e-6));
  const re = dot(a, b), im = a.x.mul(b.y).sub(a.y.mul(b.x));
  return positionLocal.xz.sub(vec2(p.x.mul(re).sub(p.z.mul(im)), p.x.mul(im).add(p.z.mul(re))).mul(scale));
}
/** A whole number 0…1023 per copy (half-unit cells of its origin), exact in the fragment stage. */
const copySeed = () => varying(floor(hash(floor(copyOrigin().mul(2).add(.5))).mul(1024))).add(.5).floor();
/**
 * A whole number 0…1023, the same on every vertex of a flat wall of an unevenly scaled box (blocks, proxies),
 * from its plane (offset along the normal), its direction and its width (the instanced normal is R·n / width).
 */
function wallSeed(): Node {
  const m = normalLocal, dir = m.xz.div(max(m.xz.length(), 1e-6));
  const plane = floor(dot(positionLocal.xz, dir).mul(4).add(.5)).add(floor(m.length().reciprocal().mul(16).add(.5)).mul(131));
  return varying(floor(hash(vec2(plane, floor(dir.x.mul(64).add(.5)).add(floor(dir.y.mul(64).add(.5)).mul(129)))).mul(1024))).add(.5).floor();
}

/** Kenney windows: the marked glass, one hash per window and copy, computed per vertex. */
function kenneyGlow(level: Node): Node {
  const w = attribute(WINDOW, "float"), building = hash(floor(copyOrigin().mul(2).add(.5)));
  const h = hash(vec2(w.mul(97.3).add(building.mul(419.1)), w.mul(41.9).add(building.mul(263.7))));
  return varying(windowLight(h, litShare(building)).mul(step(1e-3, w)).mul(stagger(h, level)));
}
/** Block facades: the painted panes (three a floor, see facadeTexture) glow, at random per wall and pane. */
function blockGlow(map: THREE.Texture, floors: number, level: Node): Node {
  const texel = texture(map, uv());
  // Blue-grey glass on white walls, and the warm pane of every seventh window; the roof band is plain.
  const glass = max(smoothstep(.04, .12, texel.b.sub(texel.r)), step(.9, texel.r).mul(step(texel.b, .8)));
  const wall = wallSeed(), pane = floor(vec2(uv().x.mul(64).sub(3.5).div(19), uv().y.mul(floors + 1)));
  const h = hash(pane.add(vec2(wall.mul(17.3), wall.mul(5.1))));
  return windowLight(h, litShare(hash(vec2(wall, 91.7)))).mul(glass).mul(stagger(h, level));
}
/** Far proxies: a window grid in world units on the walls (the roof is another material). */
function proxyGlow(level: Node): Node {
  const wall = wallSeed(), dir = varying(normalLocal.xz.div(max(normalLocal.xz.length(), 1e-6)));
  const u = dot(positionWorld.xz, vec2(dir.y.negate(), dir.x)).div(COLUMN_WIDTH), v = positionWorld.y.sub(GROUND).div(FLOOR_HEIGHT);
  const h = hash(floor(vec2(u, v)).add(vec2(wall.mul(17.3), wall.mul(5.1)))), share = litShare(hash(vec2(wall, 91.7))).mul(PROXY_LIT);
  // Where a pixel spans several windows it shows their average light, not one window's.
  const light = mix(windowLight(h, share).mul(stagger(h, level)), color(WARM_LOW).mul(share.mul(WINDOW_GLOW * .8)).mul(level), clamp(max(fwidth(u), fwidth(v)).sub(.5), 0, 1));
  return light.mul(pulse(u, ...PANE_U)).mul(pulse(v, ...PANE_V));
}
/**
 * Residential sections: the facade is drawn in world units, so every section of a wing shows one continuous
 * front whatever its width and height: windows in columns of SECTION_PANE on every floor of SECTION_FLOOR, a
 * balcony under every other column, and a stone ground floor with doors. The copy's tint (instance colour)
 * shades the walls; the roof is grey by vertex colour. At night each window has a seed of its own from its
 * place on the wall, so neighbouring sections never repeat one pattern of lit windows.
 */
function sectionFacade(material: THREE.MeshStandardNodeMaterial, level: Node) {
  const P = SECTION_PARTS, part = attribute(SECTION_PART, "float"), is = (k: number) => step(part.sub(k).abs(), .5);
  const n = normalWorld.normalize(), wall = step(n.y.abs(), .5).mul(is(P.facade));
  const d = n.xz.div(max(n.xz.length(), 1e-6)), u = dot(positionWorld.xz, vec2(d.y.negate(), d.x)).div(SECTION_PANE), v = positionWorld.y.sub(GROUND).div(SECTION_FLOOR);
  const upper = step(1, v).mul(wall), ground = step(v, 1).mul(wall);
  // Every wing wall has a style of its own: accent columns, a two-tone base, or wide windows; and an accent colour.
  const plane = wallSeed(), style = hash(vec2(plane, 13.7)), pick = hash(vec2(plane, 47.1));
  const accent = mix(mix(color("#c98a6b"), color("#6d737b"), step(.34, pick)), color("#b98d62"), step(.67, pick));
  const columns = pulse(u.div(3), 0, .34).mul(step(style, .4)).mul(upper), base = step(v, 3).mul(step(1, v)).mul(step(.4, style)).mul(step(style, .7)).mul(wall);
  const wide = step(.7, style);
  const frame = mix(pulse(u, .19, .81), pulse(u, .05, .95), wide).mul(pulse(v, .24, .86)).mul(upper);
  const pane = mix(pulse(u, .24, .76), pulse(u, .1, .9), wide).mul(pulse(v, .3, .8)).mul(upper);
  const door = pulse(u.div(3), .42, .58).mul(pulse(v, 0, .8)).mul(ground);
  const shop = pulse(u, .08, .92).mul(pulse(v, .18, .8)).mul(ground).mul(float(1).sub(door));
  let facade: Node = mix(vec3(1, 1, 1), color("#bdb4a7"), ground.mul(.9));
  facade = mix(facade, accent, columns.add(base).min(1).mul(.85));
  facade = mix(mix(facade, color("#5d636b"), frame), color("#8ea8bf"), pane);
  facade = mix(mix(facade, color("#4c4038"), door), color("#9cb6c9"), shop.mul(.85));
  // The copy's shade (instance colour) is for the walls: glass, frames, doors, trim and roofs keep their own colours,
  // so they are divided by it here, before the renderer multiplies it back in.
  const shade = varyingProperty("vec3", "vInstanceColor"), keep = (c: Node) => c.div(max(shade, vec3(.04)));
  const wallShare = mix(float(1), float(0), pane.add(frame).add(door).add(shop).min(1));
  const walls = mix(keep(facade), facade, wallShare);
  // Glass rails, or planted boxes on the balconies of the green towers (their shade has a green cast).
  const green = step(.035, shade.y.sub(max(shade.x, shade.z))), leaves = mix(color("#5f8a4e"), color("#86ad63"), hash(floor(positionWorld.xz.mul(2.5))));
  material.colorNode = walls.mul(is(P.facade)).add(keep(color("#f4f3ef")).mul(is(P.trim))).add(keep(color("#7d838a")).mul(is(P.roof)))
    .add(keep(mix(color("#b4c6d2"), leaves, green)).mul(is(P.glass))).add(keep(color("#d9d5cd")).mul(is(P.plain)));
  material.roughnessNode = float(.82).sub(is(P.glass).mul(.5));
  const h = hash(vec2(floor(u).add(plane.mul(17.3)), floor(v).add(plane.mul(5.1))));
  // Homes are darker than offices at night: about 40% of their windows are lit.
  material.emissiveNode = windowLight(h, litShare(hash(vec2(plane, 91.7))).mul(.65)).mul(pane.add(shop.mul(.6))).mul(stagger(h, level));
}

/**
 * Office glass in world units: a curtain wall of panes one unit wide and a floor (OFFICE_FLOOR) high between
 * mullions, with a spandrel band at every floor and a bright lobby at the ground. Each wall picks its glass
 * (blue, teal, bronze or silver) and light or dark mullions; panes vary a little, like real reflections. At
 * night offices light more of their panes than homes, in a cooler white.
 */
function officeFacade(material: THREE.MeshStandardNodeMaterial, level: Node) {
  const P = SECTION_PARTS, part = attribute(SECTION_PART, "float"), is = (k: number) => step(part.sub(k).abs(), .5);
  const n = normalWorld.normalize(), wall = step(n.y.abs(), .5).mul(is(P.facade));
  const d = n.xz.div(max(n.xz.length(), 1e-6)), u = dot(positionWorld.xz, vec2(d.y.negate(), d.x)), v = positionWorld.y.sub(GROUND).div(OFFICE_FLOOR);
  const plane = wallSeed(), pick = hash(vec2(plane, 23.9)), frames = hash(vec2(plane, 61.3));
  // Glass reads light, as it does reflecting a bright sky (there is no environment map to reflect).
  const tone = mix(mix(color("#8fb3d6"), color("#8cc0c2"), step(.3, pick)), mix(color("#c2b49c"), color("#b3c0cc"), step(.8, pick)), step(.55, pick));
  const mullion = mix(color("#eef1f4"), color("#4a525b"), step(.72, frames));
  const pane = pulse(u, .05, .95).mul(pulse(v, .22, 1)).mul(wall), lobby = step(v, 1).mul(wall), cell = hash(floor(vec2(u, v)).add(plane.mul(7.7)));
  // Panes vary a little, and the glass brightens up the tower like a sky reflection.
  const glass = tone.mul(cell.mul(.16).add(.9)).mul(v.mul(.012).add(.92).min(1.15));
  let facade: Node = mix(mullion, glass, pane);
  facade = mix(facade, mix(color("#a6c2d6"), color("#3a3f45"), pulse(u.div(6), .44, .56).mul(pulse(v, 0, .8))), lobby.mul(pulse(u, .05, .95)));
  material.colorNode = facade.mul(is(P.facade)).add(mullion.mul(is(P.trim))).add(color("#6e757d").mul(is(P.roof))).add(color("#c9ccd0").mul(is(P.plain)));
  material.roughnessNode = mix(float(.72), float(.22), pane);
  const h = hash(vec2(floor(u).add(plane.mul(17.3)), floor(v).add(plane.mul(5.1))));
  material.emissiveNode = windowLight(h, litShare(hash(vec2(plane, 91.7))).mul(.85)).mul(vec3(.62, .7, .85)).mul(pane.add(lobby.mul(.5))).mul(stagger(h, level));
}

/** Port sheds: one row of high windows along the marked walls, in model units, seeded by the copy. */
function portGlow(level: Node): Node {
  const n = normalGeometry, p = positionGeometry, copy = copySeed();
  const u = dot(p.xz, vec2(n.z.negate(), n.x)).div(.7), v = p.y.sub(1.2).div(.6);
  const h = hash(vec2(floor(u).add(n.x.mul(37)).add(n.z.mul(71)), copy));
  const mask = attribute(WINDOW, "float").mul(step(n.y.abs(), .5)).mul(step(0, v)).mul(step(v, 1)).mul(pulse(u, .2, .8)).mul(pulse(v, .2, .8));
  return windowLight(h, litShare(hash(vec2(copy, 91.7)))).mul(mask).mul(stagger(h, level));
}

/** A node copy of a loaded material, made the way the renderer converts one, so the day look stays the same. */
function nodeCopy(source: THREE.MeshStandardMaterial) {
  const material = new THREE.MeshStandardNodeMaterial(), from = source as unknown as Record<string, unknown>, to = material as unknown as Record<string, unknown>;
  for (const key in from) if (key !== "uuid" && key !== "type" && key !== "_listeners") to[key] = from[key];
  return material;
}

/**
 * Marks the glass of a Kenney part (WINDOW): the kits paint glass with the light-blue ramp of their colour
 * map. Upright glass triangles that share corners form a window, whose random value comes from its centre,
 * so its LOD1 copy agrees. False when the pixels cannot be read or the part has no glass.
 */
function markWindows(geometry: THREE.BufferGeometry, map: THREE.Texture, cache: Map<unknown, ImageData | null>): boolean {
  if (geometry.hasAttribute(WINDOW)) return true;
  const position = geometry.getAttribute("position"), uvs = geometry.getAttribute("uv"), image = uvs ? texturePixels(map, cache) : null;
  if (!image || !uvs) return false;
  map.updateMatrix();
  const n = position.count, count = geometry.index ? geometry.index.count : n, at = (k: number) => geometry.index ? geometry.index.getX(k) : k;
  const parent = Int32Array.from({ length: n }, (_, i) => i), glass = new Uint8Array(n);
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const join = (i: number, j: number) => { parent[find(i)] = find(j); };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), at2 = new THREE.Vector2();
  let found = false;
  for (let k = 0; k + 2 < count; k += 3) {
    const i = at(k), j = at(k + 1), l = at(k + 2);
    // The texel first: most triangles are not glass, and it is the cheaper test.
    at2.set((uvs.getX(i) + uvs.getX(j) + uvs.getX(l)) / 3, (uvs.getY(i) + uvs.getY(j) + uvs.getY(l)) / 3);
    map.transformUv(at2);
    const x = Math.min(image.width - 1, Math.floor(at2.x * image.width)), y = Math.min(image.height - 1, Math.floor(at2.y * image.height)), o = (y * image.width + x) * 4;
    const red = image.data[o], green = image.data[o + 1], blue = image.data[o + 2];
    if (green - red < 16 || blue - green < 16 || blue < 140) continue;
    a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, j); c.fromBufferAttribute(position, l);
    const normal = b.sub(a).cross(c.sub(a)), length = normal.length();
    // Skylights and flat sheets stay dark: lit glass is upright.
    if (!length || Math.abs(normal.y) > .5 * length) continue;
    glass[i] = glass[j] = glass[l] = 1; join(i, j); join(j, l); found = true;
  }
  if (!found) return false;
  // Corners at one place (split vertices) belong to one window.
  const corners = new Map<string, number>(), boxes = new Map<number, THREE.Box3>();
  for (let v = 0; v < n; v++) if (glass[v]) {
    const key = `${Math.round(position.getX(v) * 1e4)},${Math.round(position.getY(v) * 1e4)},${Math.round(position.getZ(v) * 1e4)}`, first = corners.get(key);
    if (first === undefined) corners.set(key, v); else join(v, first);
  }
  for (let v = 0; v < n; v++) if (glass[v]) { const root = find(v); if (!boxes.has(root)) boxes.set(root, new THREE.Box3()); boxes.get(root)!.expandByPoint(a.fromBufferAttribute(position, v)); }
  const seeds = new Float32Array(n);
  for (let v = 0; v < n; v++) if (glass[v]) {
    boxes.get(find(v))!.getCenter(a);
    seeds[v] = .002 + .998 * fract(Math.sin(Math.round(a.x * 100) * 12.9898 + Math.round(a.y * 100) * 78.233 + Math.round(a.z * 100) * 37.719) * 43758.5453);
  }
  geometry.setAttribute(WINDOW, new THREE.BufferAttribute(seeds, 1));
  return true;
}
