/** City-sized cartoon restyles of the transport collection; one shared deformation across all three LODs. */
import * as THREE from "three/webgpu";
import { disposeModels, loadModels, type ModelLoadOptions } from "./loader";

export const TRANSPORT_IDS = {
  cars: ["sedan", "hatchback", "crossover", "suv", "coupe", "estate", "cabriolet", "pickup", "minivan", "city-ev"],
  trucks: ["box-truck", "tractor-trailer", "dump-truck", "flatbed-truck"],
  boats: ["speedboat", "fishing-boat", "cabin-boat"],
  yachts: ["motor-yacht", "sailing-yacht", "sport-yacht"],
} as const;
/** The detailed kit is larger than the other city assets and loads behind an already running fallback. */
export const TRANSPORT_LOAD_TIMEOUT_MS = 45000;
export interface TransportModel {
  id: string;
  category: keyof typeof TRANSPORT_IDS;
  lods: THREE.BufferGeometry[];
  base: THREE.Matrix4;
  /** Metres, after the +X bow/front has been turned towards the city's +Z. */
  size: THREE.Vector3;
  scale: number;
  /** Immersion in city units, measured from the grounded keel/propeller. */
  draft: number;
  paints: THREE.Color[];
}
// Hull waterlines sit at about one third of hull depth. The sailing yacht also has a deep fin keel.
const DRAFT: Record<string, number> = {
  "speedboat": .14, "fishing-boat": .18, "cabin-boat": .15,
  "motor-yacht": .24, "sailing-yacht": .57, "sport-yacht": .20,
};

/** Each type keeps its identity, in the same cheerful paint family as the city's procedural cars. */
const PAINT: Record<string, string> = {
  sedan: "#329ed6", hatchback: "#f49c45", crossover: "#53ba8a", suv: "#ed765d", coupe: "#f2c650",
  estate: "#7b91dc", cabriolet: "#eb88a2", pickup: "#45b6b4", minivan: "#64a4de", "city-ev": "#a4cf5c",
  "box-truck": "#f8a348", "tractor-trailer": "#488fd0", "dump-truck": "#f1bd43", "flatbed-truck": "#50af87",
  speedboat: "#39a9db", "fishing-boat": "#ed8f4c", "cabin-boat": "#5aafd3", "motor-yacht": "#6da6de",
  "sailing-yacht": "#f3bb57", "sport-yacht": "#eb8a76",
};
const PART_COLOURS: Record<number, THREE.Color> = Object.fromEntries(Object.entries({
  1: "#fff9ed", 3: "#64b8d7", 4: "#283444", 6: "#c9dfe6", 7: "#43566e",
  8: "#fff1b8", 9: "#f16260", 10: "#fff4cf", 14: "#e9bb7a", 15: "#3a91ec",
}).map(([part, hex]) => [part, new THREE.Color(hex)]));
const IVORY = new THREE.Color("#fff7e7");

/**
 * A continuous toy-like cage rounds all plan corners and lifts the middle of each body/cabin.
 * The deformation is monotone, keeps tyres/keels on zero and never widens a lane or shortens a mast.
 * Geometry, fittings and every LOD use the same cage, so seams stay joined and LODs do not jump.
 * Normals use the inverse-transpose Jacobian instead of flattening the source's smooth surfaces.
 */
function cartoonTransport(geometry: THREE.BufferGeometry, dimensions: THREE.Vector3, marine: boolean) {
  const p = geometry.getAttribute("position"), n = geometry.getAttribute("normal");
  const colours = geometry.getAttribute("color"), surfaces = geometry.getAttribute("aSurf");
  // dimensions were measured on the original +X-facing model, before the city's quarter turn.
  const halfWidth = Math.max(.1, dimensions.z / 2), halfLength = Math.max(.1, dimensions.x / 2), height = Math.max(.1, dimensions.y);
  const lift = marine ? .035 : .075, roundX = marine ? .025 : .055, roundZ = marine ? .025 : .045;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), xn = x / halfWidth, zn = z / halfLength;
    const a = 1 - roundX * zn ** 4, b = -4 * roundX * x * zn ** 3 / halfLength;
    const c = -4 * roundZ * z * xn ** 3 / halfWidth, d = 1 - roundZ * xn ** 4;
    const e = 1 + lift * Math.PI * Math.cos(Math.PI * y / height), determinant = a * d - b * c;
    p.setXYZ(i, x * a, y + height * lift * Math.sin(Math.PI * y / height), z * d);
    const nx = (d * n.getX(i) - c * n.getZ(i)) / determinant, ny = n.getY(i) / e, nz = (-b * n.getX(i) + a * n.getZ(i)) / determinant;
    const length = Math.hypot(nx, ny, nz) || 1; n.setXYZ(i, nx / length, ny / length, nz / length);
    const part = Math.round(surfaces.getZ(i)), paint = PART_COLOURS[part];
    if (paint) colours.setXYZ(i, paint.r, paint.g, paint.b);
    else {
      // Keep source liveries and sail colours, while warming the otherwise grey hulls/cargo panels.
      const r = colours.getX(i), g = colours.getY(i), b = colours.getZ(i), high = Math.max(r, g, b), low = Math.min(r, g, b);
      if (high - low < .08 && high > .4) colours.setXYZ(i, r * .55 + IVORY.r * .45, g * .55 + IVORY.g * .45, b * .55 + IVORY.b * .45);
    }
  }
  geometry.userData.cityModelStyle = "cartoon-v1";
}

export function disposeTrafficCollection(models: Map<string, TransportModel>) {
  models.forEach(model => model.lods.forEach(geometry => geometry.dispose()));
  models.clear();
}

export async function loadTrafficCollection(options: ModelLoadOptions = {}): Promise<Map<string, TransportModel>> {
  const source = await loadModels("/city/transport-v1/collection.glb", { timeoutMs: TRANSPORT_LOAD_TIMEOUT_MS, ...options }), collection = new Map<string, TransportModel>();
  const owned: THREE.BufferGeometry[] = [];
  try {
    if (options.signal?.aborted) throw new DOMException("Transport load aborted", "AbortError");
    for (const [category, ids] of Object.entries(TRANSPORT_IDS)) for (const id of ids) {
      const lods: THREE.BufferGeometry[] = [];
      let size = new THREE.Vector3();
      // All LODs use the same origin; centring each reduced silhouette independently causes visible jumps.
      const first = source.get(`${id}__lod0`);
      if (!first || first.parts.length !== 1) throw new Error(`Missing transport model: ${id}`);
      const origin = first.bounds.getCenter(new THREE.Vector3()); origin.y = first.bounds.min.y;
      const dimensions = first.bounds.getSize(new THREE.Vector3());
      for (let level = 0; level < 3; level++) {
        const model = source.get(`${id}__lod${level}`);
        if (!model || model.parts.length !== 1) throw new Error(`Missing transport LOD: ${id}/${level}`);
        const geometry = model.parts[0].geometry.clone(); owned.push(geometry);
        geometry.translate(-origin.x, -origin.y, -origin.z).rotateY(-Math.PI / 2);
        for (const [from, to] of [["_asurf", "aSurf"], ["_awin", "aWin"]]) {
          const attribute = geometry.getAttribute(from) ?? geometry.getAttribute(to);
          if (!attribute || attribute.itemSize !== 4) throw new Error(`Invalid transport surface: ${id}`);
          geometry.setAttribute(to, attribute); geometry.deleteAttribute(from);
        }
        const positions = geometry.getAttribute("position");
        if (!positions || !geometry.getAttribute("normal") || !geometry.getAttribute("color")) throw new Error(`Invalid transport geometry: ${id}`);
        if (!geometry.getAttribute("uv")) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(positions.count * 2), 2));
        cartoonTransport(geometry, dimensions, category === "boats" || category === "yachts");
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const bounds = geometry.boundingBox!;
        if (![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) || positions.count < 3) throw new Error(`Invalid transport bounds: ${id}`);
        if (!level) size = bounds.getSize(new THREE.Vector3());
        lods.push(geometry);
      }
      collection.set(id, { id, category: category as TransportModel["category"], lods, base: new THREE.Matrix4(), size, scale: .25, draft: DRAFT[id] ?? 0, paints: [new THREE.Color(PAINT[id] ?? "#fff9ed")] });
    }
    return collection;
  } catch (error) {
    owned.forEach(geometry => geometry.dispose()); collection.clear(); throw error;
  } finally { disposeModels(source); }
}
