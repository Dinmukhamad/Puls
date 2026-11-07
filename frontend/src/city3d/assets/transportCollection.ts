/** City-sized, three-level versions of the original transport collection. */
import * as THREE from "three/webgpu";
import { disposeModels, loadModels, type ModelLoadOptions } from "./loader";

export const TRANSPORT_IDS = {
  cars: ["sedan", "hatchback", "crossover", "suv", "coupe", "estate", "cabriolet", "pickup", "minivan", "city-ev"],
  trucks: ["box-truck", "tractor-trailer", "dump-truck", "flatbed-truck"],
  boats: ["speedboat", "fishing-boat", "cabin-boat"],
  yachts: ["motor-yacht", "sailing-yacht", "sport-yacht"],
} as const;
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

export function disposeTrafficCollection(models: Map<string, TransportModel>) {
  models.forEach(model => model.lods.forEach(geometry => geometry.dispose()));
  models.clear();
}

export async function loadTrafficCollection(options: ModelLoadOptions = {}): Promise<Map<string, TransportModel>> {
  const source = await loadModels("/city/transport-v1/collection.glb", options), collection = new Map<string, TransportModel>();
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
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const bounds = geometry.boundingBox!;
        if (![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) || positions.count < 3) throw new Error(`Invalid transport bounds: ${id}`);
        if (!level) size = bounds.getSize(new THREE.Vector3());
        lods.push(geometry);
      }
      collection.set(id, { id, category: category as TransportModel["category"], lods, base: new THREE.Matrix4(), size, scale: .25, draft: DRAFT[id] ?? 0, paints: [new THREE.Color(1, 1, 1)] });
    }
    return collection;
  } catch (error) {
    owned.forEach(geometry => geometry.dispose()); collection.clear(); throw error;
  } finally { disposeModels(source); }
}
