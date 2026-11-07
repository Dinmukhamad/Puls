/**
 * The model catalogue: which model, with which transform, stands for every Placement of the world (TZ §5.3). Every
 * building has one level of detail (docs/CITY_V4.md), with window/tile detail averaged by its material. Repeated
 * trees and small courtyard pieces keep their species/form with fewer hidden branches/slats in the far slot,
 * so the fully built city does not draw millions of invisible details. Kenney models (CC0) are
 * reused from the old city with its lists (the five-island map); every other building is built in code in the city's
 * v4 style (assets/facade.ts): the shop's ready houses and office towers (assets/readyBuildings.ts), the community
 * centre (assets/districtLandmark.ts), the stretched sections, cottages, roofs, office towers and blocks
 * (assets/residential.ts) and the port (assets/port.ts); trees, furniture and lamps are procedural.
 * At night the windows of every building light up (TZ §6.7): emissive nodes scaled by the night level, in
 * the same materials and draw calls, nothing drawn or computed on the CPU per frame.
 */
import * as THREE from "three/webgpu";
import { attribute, color, dot, floor, max, mix, normalGeometry, normalLocal, positionGeometry, positionLocal, smoothstep, step, varying, vec2, vec3, type ShaderNodeObject } from "three/tsl";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Placement, PlacementKind } from "../world/types";
import { createNight, type Night } from "../render/night";
import { loadModels, disposeModels, MODEL_LOAD_TIMEOUT_MS, type Model, type ModelPart, type ModelLoadOptions } from "./loader";
import { catalogueFiles } from "./modelFiles";
import { furnitureGeometry, treeKindGeometry, type FurnitureKind } from "./courtyard";
import { archGeometry, blockGeometry, cottageGeometry, garageGeometry, officeGeometry, roofGeometry, sectionGeometry } from "./residential";
import { PORT } from "./port";
import { OFFICE_FLOOR, OFFICE_FLOORS, SECTION_FLOORS, SECTION_WIDTH } from "../world/complexes";
import { FINISHES, HOUSE_SCALE, READY_HOUSES, houseModelName } from "../world/familyHouses";
import { OFFICE_BUILDINGS, OFFICE_SCALE, officeModelName, officeVariant, type OfficeBuilding } from "../world/officeBuildings";
import { facadeMaterial } from "./facade";
import { READY_HOUSE_VARIANTS, officeTowerGeometry, readyHouseGeometry } from "./readyBuildings";
import { LANDMARK_LEVELS, LANDMARK_SIDE, landmarkLevel } from "../world/districtLandmark";
import { landmarkGeometry } from "./districtLandmark";
import { PAINTS, PARKED_TAXI_SCALE, vehicleGeometry, vehicleMaterial, type VehicleName } from "./vehicles";
import type { SkyLook } from "../render/sky";
import { detailedMaterialCopy, surfaceMaterial } from "./surfaceDetail";
import { vegetationGeometry } from "./vegetation";

/** A model's mesh. `matrix` places it inside the model and `colors` tint its parts. */
export interface LodLevel { parts: ModelPart[]; matrix?: THREE.Matrix4; colors?: THREE.Color[] }
export interface CatalogueModel {
  id: string;
  /** The pools' three level slots; architectural models share one level, repeated vegetation has a far mesh. */
  lods: [LodLevel, LodLevel | null, LodLevel | null];
  /** Bounds in model space. */
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
/** The vehicles are built 1.5 units wide, as the Car Kit's were; this makes them fit a one-unit lane. */
const CAR_SCALE = .5;
/** Parked cars of one model take its paints in this stride along the stalls (prime to every palette's length). */
const CAR_TINT_STEP = 7;
/** Fitted models never grow beyond this, so a small model on a big lot does not turn into a giant. */
const MAX_FIT = 2.8;
/** Top of the ground and of the parking pads. */
const GROUND = .2, PAD = .25;
/** The old four plain blocks: floors, height, glass. Blocks use classes 0…2, towers 1…3 (Placement.variant). */
const BLOCKS = [{ floors: 4, height: 3, glass: false }, { floors: 7, height: 5.2, glass: false }, { floors: 11, height: 8.4, glass: true }, { floors: 18, height: 13.6, glass: true }];
const WALLS = ["#efc67d", "#9fc9eb", "#ee9c7d", "#a4d99d", "#c1afe2", "#ffe4a8"], GLASS = ["#5faedb", "#4eb0be", "#8d98d4", "#7ac8dc"];
const TREE_TINTS = ["#ffffff", "#eaf6e2", "#f7ffe8", "#dfeed7", "#fff6dc"];
/**
 * Residential walls, picked by index in world/complexes.ts: renders (0 ivory, 1 warm cream, 2 ochre, 3 lilac),
 * bricks (4 red, 5 terracotta, 6 sand, 7 brown), accents (8 graphite, 9 peach, 10 sky blue, 11 warm stone) and two
 * greens (12 sage, 13 mint) whose towers get planted balconies (sectionFacade tells them by their green cast).
 */
const SECTION_TINTS = ["#fffde2", "#f7dfa7", "#efc875", "#bbb7e8", "#c6532b", "#d96d33", "#e8b354", "#a45a33", "#526e87", "#f49a7a", "#63acd3", "#c89760", "#6fb677", "#9ddca4"];
/** Townhouse roofs: blue slate, terracotta, brown, navy and zinc. */
const ROOF_TINTS = ["#356486", "#c64b29", "#98532e", "#2d476d", "#75a8bd"];
/** Section floors in world units. */
const SECTION_FLOOR = .75;
/** The garages of the operators' houses are cottages in this shade (world/landLayouts.ts GARAGE): they get a garage of their own. */
const GARAGE_TINT = 8;
/** Office glass: white, cool blue, warm cream and pale teal tints of the towers' curtain walls (assets/residential.ts). */
const OFFICE_TINTS = ["#ffffff", "#a2d3f4", "#ffe0a2", "#a6d9d6"];
const FURNITURE: FurnitureKind[] = ["bench", "slide", "swings", "climber", "sandbox", "goal", "hoop", "gazebo", "flowerbed", "bush", "hedge", "planter", "fountain"];

/**
 * `kits: false` leaves out the building kit (houses, offices, industry): only the five-island map places
 * those, and the city spares its 1.1 MB download and decoding. A placement that asks for one anyway becomes
 * a procedural block.
 */
export async function loadCatalogueModels(lodUrls: string[] = [], options: ModelLoadOptions & { kits?: boolean } = {}) {
  const models = new Map<string, Model>(), replaced = new Map<string, Model>();
  const { urls, fallbacks } = catalogueFiles(lodUrls, options.kits !== false);
  const deadline = performance.now() + (options.timeoutMs ?? MODEL_LOAD_TIMEOUT_MS);
  const loadOptions = () => ({ ...options, timeoutMs: Math.max(1, deadline - performance.now()) });
  const files = await Promise.allSettled(urls.map(async url => {
    try { return await loadModels(url, loadOptions()); }
    catch (error) {
      const fallback = fallbacks.get(url);
      // A quick missing/invalid generated file may use its source; it shares the original asset budget.
      if (!fallback || options.signal?.aborted || performance.now() >= deadline) throw error;
      return loadModels(fallback, loadOptions());
    }
  }));
  for (const file of files) if (file.status === "fulfilled") file.value.forEach((model, name) => {
    const old = models.get(name); if (old && old !== model) replaced.set(String(replaced.size), old);
    models.set(name, model);
  });
  disposeModels(replaced, models);
  return models;
}

/**
 * Takes ownership of `models`: they are disposed with the catalogue. Windows glow with `night.level` (ctx.night);
 * parked cars mirror `look`, the sky of the moment (render/sky.ts skyLook), or the day's without it.
 */
export function createCatalogue(models: Map<string, Model>, night: Night = createNight(), look: SkyLook | null = null): Catalogue {
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
      if (!lit) { lit = own(nodeCopy(kit, look)); lit.emissiveNode = kenneyLight; litKits.set(kit, lit); }
      part.material = lit;
    }
  }

  /** A loaded kit model at its one level of detail; a name listed twice is one model drawn twice as often. */
  const byName = new Map<string, CatalogueModel | null>();
  const one = (level: LodLevel): CatalogueModel["lods"] => [level, level, level];
  function kenney(name: string, windows = true) {
    if (byName.has(name)) return byName.get(name)!;
    const source = models.get(name);
    byName.set(name, null);
    if (!source?.parts.length) return null;
    if (windows) lightWindows(source.parts);
    const model = add({ id: name, lods: one({ parts: source.parts }), bounds: source.bounds.clone(), base: footprint(source.bounds) });
    byName.set(name, model);
    return model;
  }
  const list = (names: string[]) => names.map(name => kenney(name)).filter((m): m is CatalogueModel => !!m);
  const houses = list(HOUSES), offices = list(LIGHT_OFFICES), industry = list(INDUSTRY);
  // The car parks' cars (PARKED): the city's own vehicles (assets/vehicles.ts) in one material, each model's paints
  // taking turns along the stalls, the taxi at the old kit taxi's size. Their shapes live for the session (not owned).
  const vehicles = own(vehicleMaterial(look)), cars = new Map<string, CatalogueModel>();
  for (const name of new Set(PARKED.flat()) as Set<VehicleName>) {
    const geometry = vehicleGeometry(name), bounds = geometry.boundingBox!.clone(), scale = name === "taxi" ? PARKED_TAXI_SCALE : 1;
    cars.set(name, add({ id: name, lods: one({ parts: [{ geometry, material: vehicles, castShadow: true }] }), bounds,
      base: new THREE.Matrix4().makeScale(scale, scale, scale).multiply(footprint(bounds)), tints: PAINTS[name].map(c => new THREE.Color(c)), tintStep: CAR_TINT_STEP }));
  }
  // The districts' ready houses and office towers (world/familyHouses.ts, world/officeBuildings.ts): built in code
  // (assets/readyBuildings.ts), every house in both finishes, with one facade material that lights their windows.
  const facade = own(facadeMaterial(nightLevel as never, { look }));
  const builtModel = (id: string, geometry: THREE.BufferGeometry) => add(procedural(id, one({ parts: [{ geometry: own(geometry), material: facade, castShadow: true }] })));
  const readyHouses = READY_HOUSE_VARIANTS.map(({ family, finish }, variant) => builtModel(houseModelName(variant), readyHouseGeometry(family, finish)));
  const officeFamilies = (Object.entries(OFFICE_BUILDINGS) as [OfficeBuilding, typeof OFFICE_BUILDINGS[OfficeBuilding]][]).sort((a, b) => a[1].model - b[1].model);
  const officeBuildings = officeFamilies.map(([, model]) => model);
  const readyOffices = officeFamilies.map(([family, model]) => builtModel(officeModelName(model.model - 1), officeTowerGeometry(family)));

  // Stretched buildings (assets/residential.ts): unit models in one facade material that measures them on the copy.
  const unitFacade = own(facadeMaterial(nightLevel as never, { unit: true, look }));
  const unitBox = new THREE.Box3(new THREE.Vector3(-.5, 0, -.5), new THREE.Vector3(.5, 1, .5));
  const unitModel = (id: string, geometry: THREE.BufferGeometry, tints: string[], tintStep: number) =>
    add({ id, lods: one({ parts: [{ geometry: own(geometry), material: unitFacade, castShadow: true }] }), bounds: unitBox.clone(), base: new THREE.Matrix4(), tints: tints.map(c => new THREE.Color(c)), tintStep });
  const blocks = BLOCKS.map((kind, index) => unitModel(`block-${index}`, blockGeometry(kind.floors, kind.glass), kind.glass ? GLASS : WALLS, 5));

  const treeMaterial = own(surfaceMaterial({ finish: "foliage", look, vertexColors: true, roughness: .87, flatShading: false, properties: true }));
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

  // Residential sections, one model per height with its balconies, entrances and roof house.
  const sections = SECTION_FLOORS.map(floors => unitModel(`section-${floors}`, sectionGeometry(floors), SECTION_TINTS, 5));
  // Office towers and podiums of the business quarters: curtain walls in the copies' glass shades, one model per height.
  const glassTowers = OFFICE_FLOORS.map(floors => unitModel(`office-${floors}`, officeGeometry(floors), OFFICE_TINTS, 3));
  // One model per community-centre level (assets/districtLandmark.ts), in the facade material of the ready buildings.
  const landmarks = Array.from({ length: LANDMARK_LEVELS }, (_, index) => builtModel(`district-landmark-${index + 1}`, landmarkGeometry(index + 1)));
  // Cottages of the garden suburb and the operators' houses (as high as their floors), and the houses' garages.
  const cottage = unitModel("cottage", cottageGeometry(), SECTION_TINTS, 5);
  const garage = unitModel("cottage-garage", garageGeometry(), SECTION_TINTS, 5);
  // Gabled roofs: the ridge along the depth so the gable faces the street.
  const roof = unitModel("roof", roofGeometry(), ROOF_TINTS, 2);
  // The floors over an arch, raised over the opening and closed underneath.
  const arch = unitModel("section-arch", archGeometry(), SECTION_TINTS, 5);
  // Courtyard furniture: one material, one pool each.
  const furnitureMaterial = own(surfaceMaterial({ finish: "wood", look, vertexColors: true, roughness: .78, properties: true }));
  const furniture = Object.fromEntries(FURNITURE.map(kind => {
    const [nearGeometry, farGeometry] = furnitureGeometry(kind), material = (kind === "bush" || kind === "hedge") ? treeMaterial : furnitureMaterial;
    const near: LodLevel = { parts: [{ geometry: own(nearGeometry), material, castShadow: true }] };
    const far: LodLevel = farGeometry ? { parts: [{ geometry: own(farGeometry), material, castShadow: true }] } : near;
    return [kind, add(procedural(kind, [near, near, far], (kind === "bush" || kind === "hedge") ? { tints: TREE_TINTS.map(c => new THREE.Color(c)), tintStep: 2 } : {}))];
  })) as Record<FurnitureKind, CatalogueModel>;

  const poleMaterial = own(surfaceMaterial({ finish: "metal", look, color: "#54616a", roughness: .38, metalness: .68 }));
  // Plain light-grey glass in the day; a warm glow × the night level, well above the bloom threshold at night.
  const bulbMaterial = own(new THREE.MeshStandardNodeMaterial({ name: "lamp-bulb", color: "#dfe4ea", roughness: .3, metalness: .05 }));
  bulbMaterial.emissiveNode = color("#ffcf85").mul(nightLevel).mul(3.2);
  // Pole and conical shade are one geometry (one draw call); the bulb hangs under the shade, its centre 1.35
  // above the foot (render/lampLights.ts puts the halos there). At most 320 triangles including its fittings.
  const lampLevel = (detail: boolean): LodLevel => ({ parts: [
    { geometry: own(merge([
      new THREE.CylinderGeometry(.035, .05, 1.45, detail ? 10 : 6).translate(0, .725, 0),
      new THREE.ConeGeometry(.17, .12, detail ? 12 : 6, 1, true).translate(0, 1.44, 0),
      new THREE.CylinderGeometry(.072, .085, .09, 10).translate(0, .045, 0),
      new THREE.CylinderGeometry(.055, .055, .035, 10).translate(0, .17, 0),
      new THREE.TorusGeometry(.145, .013, 4, 12).rotateX(Math.PI / 2).translate(0, 1.382, 0),
    ])), material: poleMaterial, castShadow: true },
    { geometry: own(detail ? new THREE.SphereGeometry(.09, 8, 6).translate(0, 1.35, 0) : new THREE.IcosahedronGeometry(.09, 0).translate(0, 1.35, 0)), material: bulbMaterial, castShadow: false },
  ] });
  const lamp = add(procedural("lamp", one(lampLevel(true))));

  // The port (assets/port.ts): warehouses whose high windows light at night, the gantry crane, container yards.
  const port = PORT.map((build, index) => builtModel(`port-${index}`, build(index)));

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
      case "family-house": {
        const model = readyHouses[houseVariant(p.variant)];
        if (model) { fitted(model, p, GROUND, out, p.scale || HOUSE_SCALE); return model; }
        // Without the file a ready house is a plain two-storey block on its footprint.
        out.compose(place.set(p.x, GROUND, p.z), turn.setFromAxisAngle(up, p.rotation), size.set(p.width || 3, 2 * SECTION_FLOOR, p.depth ?? 2.6));
        return cottage;
      }
      case "office-building": {
        const variant = officeVariant(p.variant), model = readyOffices[variant], scale = p.scale || OFFICE_SCALE;
        if (model) { fitted(model, p, GROUND, out, scale); return model; }
        // A missing file or scene keeps the office's footprint, height and lit glass facade.
        const definition = officeBuildings[variant];
        out.compose(place.set(p.x, GROUND, p.z), turn.setFromAxisAngle(up, p.rotation), size.set(p.width || definition.width * scale, definition.height * scale, p.depth ?? definition.depth * scale));
        return glassTowers[2];
      }
      case "cottage":
        // `variant` is the floors above the ground floor: 0 a bungalow, 1 two storeys, 2 three (a district's mansion).
        out.compose(place.set(p.x, GROUND, p.z), turn.setFromAxisAngle(up, p.rotation), size.set(p.width || 3, Math.min(3, Math.max(1, Math.floor(p.variant) + 1)) * SECTION_FLOOR, p.depth ?? 2.4));
        return p.tint === GARAGE_TINT ? garage : cottage;
      case "roof":
        out.compose(place.set(p.x, GROUND + (p.lift ?? 0), p.z), turn.setFromAxisAngle(up, p.rotation), size.set(p.width || 2.6, p.scale || 1, p.depth ?? 2.4));
        return roof;
      case "glass-tower": {
        const index = Math.min(OFFICE_FLOORS.length - 1, Math.max(0, p.variant)), lift = p.lift ?? 0;
        out.compose(place.set(p.x, GROUND + lift, p.z), turn.setFromAxisAngle(up, p.rotation), size.set(p.width || 8, OFFICE_FLOORS[index] * OFFICE_FLOOR - lift, p.depth ?? 6));
        return glassTowers[index];
      }
      case "district-landmark": {
        const width = p.width || LANDMARK_SIDE, depth = p.depth ?? LANDMARK_SIDE;
        out.compose(place.set(p.x, GROUND, p.z), turn.setFromAxisAngle(up, p.rotation), size.set(width / LANDMARK_SIDE, Math.min(width, depth) / LANDMARK_SIDE, depth / LANDMARK_SIDE));
        return landmarks[landmarkLevel(p.variant + 1) - 1];
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

  // The old imported building kit uses the same material finish as the procedural city. Its night-window
  // nodes were installed first, so refining its remaining opaque parts cannot suppress the window mask.
  const importedSurfaces = new Map<THREE.Material, THREE.Material>();
  for (const model of models.values()) for (const part of model.parts) {
    const source = part.material as THREE.MeshStandardMaterial;
    if (!source.isMeshStandardMaterial || (source as unknown as THREE.NodeMaterial).isNodeMaterial) continue;
    let surface = importedSurfaces.get(source);
    if (!surface) { surface = own(detailedMaterialCopy(source, look)); importedSurfaces.set(source, surface); }
    part.material = surface;
  }
  // The windows are marked; the pixel copies are no longer needed.
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
/** A ready house's model in the list: every house in every finish (world/familyHouses.ts houseModelName). */
const houseVariant = (variant: number) => Math.max(0, Math.floor(variant)) % (Object.keys(READY_HOUSES).length * FINISHES.length);
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

function merge(parts: THREE.BufferGeometry[]) { const merged = mergeGeometries(parts)!; parts.forEach(p => p.dispose()); return merged; }

/** All four species share natural clustered crowns and the courtyard surface properties. */
function treeGeometry(round: boolean, far: boolean) {
  return vegetationGeometry(round ? "round" : "cone", far);
}

// Night windows (TZ §6.7). Every light is an emissive node times the night level: no rebuild when the mode
// switches, and nothing is added in the day (emissive 0). Seeds never use the instance index: it is the
// copy's slot in its pool, which changes whenever the pools refill, so lit windows would jump around.

type Node = ShaderNodeObject<THREE.Node>;
/** Kenney parts: 0 off the glass, a random 0 < w ≤ 1 per window on it. */
const WINDOW = "windowSeed";
/** Share of lit windows per building: from a sleepy one to an all-awake one, ~60% on average. */
const LIT_SHARE: [number, number] = [.4, .85];
/** Warm shades of lit windows; brighter than white, so the bloom picks them up when it is on. */
const WARM_LOW = "#ffd48a", WARM_HIGH = "#fff1c9", WINDOW_GLOW = 1.2;

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
/** Kenney windows: the marked glass, one hash per window and copy, computed per vertex. */
function kenneyGlow(level: Node): Node {
  const w = attribute(WINDOW, "float"), building = hash(floor(copyOrigin().mul(2).add(.5)));
  const h = hash(vec2(w.mul(97.3).add(building.mul(419.1)), w.mul(41.9).add(building.mul(263.7))));
  return varying(windowLight(h, litShare(building)).mul(step(1e-3, w)).mul(stagger(h, level)));
}
/** A node copy of a loaded material, made the way the renderer converts one, so the day look stays the same. */
function nodeCopy(source: THREE.MeshStandardMaterial, look: SkyLook | null) {
  return detailedMaterialCopy(source, look);
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
