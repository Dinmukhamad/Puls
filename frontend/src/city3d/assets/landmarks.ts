import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DistrictId } from '../../api/city';
import { MeshBuilder, bakeOcclusion } from './facade';
import { C, KIT_METRES, PLINTH, createKit, type LandmarkKit, type Sign } from './landmarkKit';
import { LANDMARK_MODELS } from './landmarkModels';

/**
 * The tops of the district landmarks (levels 1–5), as the islands always had them: the labels float over them and the
 * picking cylinders reach them (systems/districts.ts). The models are drawn to the same tops; a test keeps them so.
 */
export const LANDMARK_TOPS: Record<DistrictId, readonly number[]> = {
  academy: [3.255, 4.11, 5.265, 5.455, 8.295],
  driver: [1.85, 2.475, 3.075, 4.445, 5.755],
  crm: [2.737, 3.365, 6.105, 6.785, 8.845],
  dispatch: [3.415, 4.515, 6.295, 7.295, 8.845],
  oktell: [2.495, 2.805, 4.225, 5.315, 6.215],
  scenarios: [2.072, 2.48, 3.725, 4.125, 4.825],
  voice: [2.535, 3.726, 4.35, 6.055, 7.09],
};

/** A whole number for a district, so every island lights its windows in a pattern of its own. */
const seedOf = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 9973, 7);

/**
 * The island plinth: a 5.7 × 5.3 terrace of granite under a paved top (its top in a grid, so the occlusion shows round
 * the building), front steps, lamps and shrubs either side, a gold gem per level; a barrier while the district is soon.
 */
function base(k: LandmarkKit, stage: number, soon: boolean) {
  k.block(5.7, .23, 5.3, '#9d9c91', 0, -.095, 0, { r: .12, top: 'none' });
  // The paved top fills the terrace inside its chamfer (.06, under the .068 a .15 high box allows).
  k.block(5.55, .15, 5.15, C.ivory, 0, .125, 0, { r: .06, top: 'none' });
  k.slab(5.55 - .12, 5.15 - .12, PLINTH, C.ivory, 12);
  for (let i = 0; i < 3; i++) k.block(2.05, .095, 1 - i * .18, C.stone, 0, .13 + i * .085 - .0475, 2.5 - i * .13, { r: .015 });
  for (const side of [-1, 1]) { k.shrub(side * 2.25, 1.9); k.lamp(side * 2.55, 2.1); }
  for (let i = 0; i < stage; i++) k.ball(.11, C.gold, -.5 + i * .25, .38, 2.38, 4);
  if (soon) { for (const x of [-.9, .9]) k.post(.05, .55, C.gold, x, .255, 2.35); k.block(1.8, .025, .03, C.ink, 0, .727, 2.35, { r: 0 }); }
}

/** The district landmarks on their islands (assets/landmarkModels.ts): one facade mesh each, and its signs. */
export function createArchitecture(material: THREE.Material) {
  const kit = createKit();
  const built = new Map<string, { geometry: THREE.BufferGeometry; signs: Sign[]; height: number }>();
  function build(id: DistrictId, level: number, soon: boolean) {
    const key = `${id}:${level}:${soon}`;
    let entry = built.get(key);
    if (!entry) {
      const mb = new MeshBuilder(), signs: Sign[] = [];
      kit.begin(mb, signs, seedOf(id) + level * 13);
      base(kit, level, soon);
      LANDMARK_MODELS[id]?.(kit, level);
      bakeOcclusion(mb, { reach: 3.6, ground: 2.4, strength: .9, rays: 16 });
      entry = { geometry: mb.build(1 / KIT_METRES), signs, height: LANDMARK_TOPS[id]?.[level - 1] ?? 3 };
      built.set(key, entry);
    }
    return entry;
  }
  /** A district's building at its level (1–5) on the plinth; `height` is its top, for the label and the picking. */
  function landmark(id: DistrictId, stage: number, soon: boolean) {
    const level = Math.min(5, Math.max(1, Math.round(stage))), entry = build(id, level, soon), group = new THREE.Group();
    const mesh = new THREE.Mesh(entry.geometry.clone(), material);
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    for (const sign of entry.signs) group.add(signMesh(sign));
    return { group, height: entry.height };
  }
  /**
   * The "Скоро" construction site on the landmarks' 5.7 × 5.3 plot: the plinth, the first floor going up in
   * scaffolding, a tower crane and a barrier; one geometry for every reserved island, `height` its top.
   */
  function site() {
    const mb = new MeshBuilder(), k = kit, CRANE = '#e0a936', STEEL = C.steel, WOOD = C.wood, INK = C.ink;
    k.begin(mb, [], 3);
    k.block(5.7, .23, 5.3, '#9d9c91', 0, -.095, 0, { r: .12, top: 'none' });
    k.block(5.55, .15, 5.15, C.stone, 0, .125, 0, { r: .06, top: 'none' });
    k.slab(5.43, 5.03, PLINTH, C.stone, 10);
    // The ground floor in bare concrete, the next one begun.
    k.block(3, 1.2, 2.2, C.concrete, 0, .28, -.3, { r: .02 }); k.block(3.2, .12, 2.4, '#b9b1a2', 0, 1.48, -.3, { r: 0, bottom: true }); k.block(1.3, .7, 1, C.concrete, -.7, 1.6, -.6, { r: .02 });
    for (const x of [-1.05, 0, 1.05]) k.block(.5, .6, .04, INK, x, .5, .82, { r: 0 });
    // Scaffolding: poles, ledgers and planks.
    for (const x of [-1.7, -.57, .57, 1.7]) for (const z of [-1.6, 1]) k.block(.06, 2.5, .06, STEEL, x, .27, z, { r: 0 });
    for (const y of [.95, 1.65, 2.45]) {
      for (const z of [-1.6, 1]) k.block(3.46, .05, .05, STEEL, 0, y - .025, z, { r: 0 });
      for (const x of [-1.7, 1.7]) k.block(.05, .05, 2.66, STEEL, x, y - .025, -.3, { r: 0 });
    }
    for (const y of [.98, 1.68]) k.block(3.4, .04, .42, WOOD, 0, y - .02, 1.2, { r: 0 });
    for (const x of [-1.15, 0, 1.15]) k.rod([x - .5, .98, 1.0], [x + .5, 1.65, 1.0], .03, STEEL);
    // The tower crane behind the building, its jib reaching back over it.
    const cx = 1.95, cz = -1.95, top = 4.81, w = .22;
    k.block(.6, .14, .6, INK, cx, .27, cz, { r: .02 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.block(.04, top - .41, .04, CRANE, cx + sx * w / 2, .41, cz + sz * w / 2, { r: 0 });
    for (let y = .41, i = 0; y < top - .3; y += .44, i++) for (const face of [-1, 1]) {
      const flip = i % 2 ? 1 : -1;
      k.rod([cx - w / 2 * flip, y, cz + face * w / 2], [cx + w / 2 * flip, y + .44, cz + face * w / 2], .02, CRANE);
      k.rod([cx + face * w / 2, y, cz - w / 2 * flip], [cx + face * w / 2, y + .44, cz + w / 2 * flip], .02, CRANE);
    }
    k.box(.34, .3, .34, INK, cx, 4.62, cz + .2, { r: .02 });
    k.box(3.9, .14, .18, CRANE, cx - 1.75, 4.88, cz, { r: 0 }); k.box(1.2, .14, .18, CRANE, cx + .75, 4.88, cz, { r: 0 }); k.box(.4, .34, .3, INK, cx + 1.15, 4.66, cz, { r: .02 });
    k.box(.025, 1.5, .025, INK, cx - 2.6, 4.07, cz, { r: 0 }); k.box(.16, .12, .16, INK, cx - 2.6, 3.26, cz, { r: 0 }); k.box(1, .1, .14, STEEL, cx - 2.6, 3.12, cz, { r: 0 });
    // A striped barrier along the front: the district is not open yet.
    for (const x of [-1.2, 1.2]) k.box(.07, .5, .07, INK, x, .52, 2.35, { r: 0 });
    for (let i = 0; i < 8; i++) k.box(.3, .08, .04, i % 2 ? INK : CRANE, -1.05 + i * .3, .66, 2.35, { r: 0 });
    bakeOcclusion(mb, { reach: 3.6, ground: 2.4, strength: .9, rays: 16 });
    return { geometry: mb.build(1 / KIT_METRES), height: 4.95 };
  }
  return { landmark, site, dispose() { built.forEach(entry => entry.geometry.dispose()); built.clear(); } };
}

/** A sign's text on a canvas, on a plane over its board. */
function signMesh({ text, x, y, z, w, color }: Sign) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,245,220,.4)'; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = color; ctx.fillRect(8, 8, 496, 112);
  ctx.fillStyle = '#fff5dc'; ctx.font = '700 65px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 68, 460);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .6 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), material); plane.position.set(x, y, z);
  return plane;
}

/** Preserve local transforms while batching static detail by material. */
export function mergeStatic(root:THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverse=root.matrixWorld.clone().invert(), groups=new Map<THREE.Material,THREE.BufferGeometry[]>(), meshes:THREE.Mesh[]=[];
  root.traverse(o=>{if(!(o instanceof THREE.Mesh)||Array.isArray(o.material)||o instanceof THREE.SkinnedMesh)return;
    const copy=(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone());copy.applyMatrix4(inverse.clone().multiply(o.matrixWorld));
    if(!groups.has(o.material))groups.set(o.material,[]);groups.get(o.material)!.push(copy);meshes.push(o);
  });
  const mergedMaterials=new Set<THREE.Material>();
  for(const [material,geometries] of groups){const merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!merged)continue;const mesh=new THREE.Mesh(merged,material);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);mergedMaterials.add(material);}
  meshes.forEach(m=>{if(mergedMaterials.has(m.material as THREE.Material))m.removeFromParent();});
}
