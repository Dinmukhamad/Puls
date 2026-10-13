import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DistrictId } from '../../api/city';
import { C, createKit } from './landmarkKit';
import { LANDMARK_MODELS } from './landmarkModels';

type Part = THREE.Object3D;

/** The district landmarks on their islands (assets/landmarkModels.ts), each merged by material. */
export function createArchitecture() {
  const kit=createKit(),{box,cyl,torus,shrub,lamp,mesh,cached}=kit;
  /** The island plinth: a 5.7 × 5.3 terrace with front steps, lamps and shrubs either side, a gold gem per level. */
  function base(p:Part,stage:number,soon:boolean) {
    box(p,5.7,.23,5.3,'#9d9c91',0,.02,0,.15);box(p,5.55,.15,5.15,C.ivory,0,.2,0,.15);
    for(let i=0;i<3;i++)box(p,2.05,.095,1-i*.18,C.stone,0,.13+i*.085,2.5-i*.13);
    for(const side of [-1,1]){shrub(p,side*2.25,1.9);lamp(p,side*2.55,2.1);}
    for(let i=0;i<stage;i++){const gem=mesh(p,cached('award',()=>new THREE.OctahedronGeometry(.11)),C.gold,-.5+i*.25,.38,2.38,.5,.25);gem.rotation.z=.3;}
    if(soon){for(const x of [-.9,.9])cyl(p,.05,.55,C.gold,x,.53,2.35);box(p,1.8,.025,.03,C.ink,0,.74,2.35);}
  }
  /** A district's building at its level (1–5) on the plinth; `height` is its top, for the label and the picking. */
  function landmark(id:DistrictId,stage:number,soon:boolean) {
    const group=new THREE.Group(),level=Math.min(5,Math.max(1,Math.round(stage)));base(group,level,soon);
    LANDMARK_MODELS[id]?.(kit,group,level);
    const height=new THREE.Box3().setFromObject(group).max.y;
    mergeStatic(group);return {group,height};
  }
  function car(p:Part,x:number,z:number,color:string,angle=0) {
    const g=new THREE.Group();g.position.set(x,.22,z);g.rotation.y=angle;p.add(g);
    box(g,.64,.26,1.2,color,0,.26,0,.12);box(g,.55,.26,.65,C.ink,0,.49,-.08,.09);box(g,.56,.045,.49,color,0,.63,-.09);
    box(g,.57,.045,.045,C.gold,0,.27,.61);box(g,.5,.09,.035,'#dcecf1',0,.32,.61);
    for(const side of [-1,1])for(const iz of [-.37,.38]){const tire=cyl(g,.14,.09,'#253039',side*.32,.19,iz);tire.rotation.z=Math.PI/2;const rim=cyl(g,.075,.095,'#c9cfd0',side*.32,.19,iz);rim.rotation.z=Math.PI/2;}
    box(g,.2,.075,.13,C.gold,0,.7,-.05);return g;
  }
  function plaza(parent:Part) {
    const g=new THREE.Group();parent.add(g);
    const border=torus(g,4.35,.08,C.trim,0,.36,0);border.rotation.x=Math.PI/2;
    const inner=torus(g,2.45,.04,C.gold,0,.38,0);inner.rotation.x=Math.PI/2;
    for(let i=0;i<56;i++){const a=i*Math.PI*2/56;const paver=box(g,.4,.03,.18,C.stone,Math.sin(a)*4,.34,Math.cos(a)*4,.02);paver.rotation.y=a;}
    for(const a of [.35,2.35,4.25]) {
      const seat=new THREE.Group();seat.position.set(Math.sin(a)*3.35,.28,Math.cos(a)*3.35);seat.rotation.y=a;g.add(seat);
      for(let i=0;i<4;i++)box(seat,1.1,.07,.1,C.wood,0,.34,-.18+i*.12,.02);
      for(let i=0;i<3;i++)box(seat,1.1,.07,.08,C.wood,0,.51+i*.12,-.22,.02);
      for(const x of [-.4,.4]){box(seat,.065,.35,.43,C.ink,x,.15,0);box(seat,.065,.7,.065,C.ink,x,.4,-.23);}
    }
    mergeStatic(g);
  }
  return {landmark,car,plaza,dispose:kit.dispose};
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
