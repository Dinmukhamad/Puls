import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DistrictId } from '../../api/city';

const C = { stone:'#e8ddc5', ivory:'#fff3dd', trim:'#c4af89', ink:'#253841', glass:'#497785', gold:'#cf9b4a', roof:'#365d66', leaf:'#668b68', wood:'#926b45' };

/** Original landmark kit. Shared geometries/materials and merged static meshes keep
 * architectural detail affordable on mobile; all dimensions are district-local. */
export function createArchitecture() {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const geometry = new Map<string, THREE.BufferGeometry>();
  function mat(color: string, metal = 0, roughness = .65) {
    if(color===C.glass){metal=.35;roughness=.24;}
    const key=`${color}:${metal}:${roughness}`;
    if(!materials.has(key)) materials.set(key,new THREE.MeshStandardMaterial({color,metalness:metal,roughness}));
    return materials.get(key)!;
  }
  const cached=(key:string, make:()=>THREE.BufferGeometry)=>{if(!geometry.has(key))geometry.set(key,make());return geometry.get(key)!;};
  function mesh(p:THREE.Object3D,g:THREE.BufferGeometry,c:string,x:number,y:number,z:number,metal=0,rough=.65) {
    const m=new THREE.Mesh(g,mat(c,metal,rough));m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;p.add(m);return m;
  }
  function box(p:THREE.Object3D,w:number,h:number,d:number,c:string,x:number,y:number,z:number,r=.045) {
    const radius=Math.min(r,w/4,h/4,d/4),key=`box:${w}:${h}:${d}:${radius}`;
    // Rounding thin parts (pavers, trims, rails) costs hundreds of triangles and is not visible.
    return mesh(p,cached(key,()=>radius<.03?new THREE.BoxGeometry(w,h,d):new RoundedBoxGeometry(w,h,d,2,radius)),c,x,y,z);
  }
  function cyl(p:THREE.Object3D,r:number,h:number,c:string,x:number,y:number,z:number,top=r) {
    return mesh(p,cached(`cyl:${r}:${h}:${top}`,()=>new THREE.CylinderGeometry(top,r,h,32)),c,x,y,z);
  }
  function ball(p:THREE.Object3D,r:number,c:string,x:number,y:number,z:number) {
    return mesh(p,cached(`sphere:${r}`,()=>new THREE.SphereGeometry(r,16,12)),c,x,y,z);
  }
  function torus(p:THREE.Object3D,r:number,t:number,c:string,x:number,y:number,z:number) {
    return mesh(p,cached(`torus:${r}:${t}`,()=>new THREE.TorusGeometry(r,t,8,48)),c,x,y,z);
  }
  function sign(p:THREE.Object3D,text:string,x:number,y:number,z:number,w:number,color=C.ink) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,512,128);ctx.fillStyle='#fff5dc';ctx.font='700 65px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,68,460);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshStandardMaterial({map:texture,roughness:.6});
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(w,w/4),material);plane.position.set(x,y,z);p.add(plane);
  }
  function arch(p:THREE.Object3D,w:number,h:number,c:string,x:number,y:number,z:number) {
    const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(w/2,h-w/2);shape.absarc(0,h-w/2,w/2,0,Math.PI,false);shape.closePath();
    const key=`arch:${w}:${h}`;
    return mesh(p,cached(key,()=>new THREE.ExtrudeGeometry(shape,{depth:.07,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:2,steps:1,curveSegments:12})),c,x,y,z);
  }
  function window(p:THREE.Object3D,x:number,y:number,z:number,w=.5,h=.8,arched=false) {
    if(arched){arch(p,w+.14,h+.12,C.ivory,x,y-.06,z-.06);arch(p,w,h,C.glass,x,y,z);}
    else{box(p,w+.13,h+.13,.13,C.ivory,x,y+h/2,z-.04);box(p,w,h,.06,C.glass,x,y+h/2,z+.04,.025);}
    box(p,.035,h,.05,C.gold,x,y+h/2,z+.095,.008);
    box(p,w,.03,.05,C.trim,x,y+h*.42,z+.095,.008);
    box(p,w+.22,.1,.22,C.stone,x,y-.04,z+.04);
  }
  function roof(p:THREE.Object3D,w:number,d:number,h:number,x:number,y:number,z:number) {
    const group=new THREE.Group();group.position.set(x,y,z);p.add(group);
    const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(0,h);shape.lineTo(w/2,0);shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:d,bevelEnabled:true,bevelSize:.035,bevelThickness:.035,bevelSegments:2,steps:1});g.translate(0,0,-d/2);
    mesh(group,g,C.roof,0,0,0);box(group,w+.12,.14,d+.12,C.ivory,0,-.03,0);
    const slope=Math.atan2(h,w/2),len=Math.hypot(w/2,h);
    for(const side of [-1,1])for(let i=1;i<6;i++) {
      const tile=box(group,.035,.025,d+.03,'#517781',side*w/2*i/6,h*(1-i/6)+.035,0,.007);tile.rotation.z=-side*slope;
    }
    for(let i=0;i<Math.ceil(d/.22);i++){const ridge=cyl(group,.055,.2,C.gold,0,h+.055,-d/2+i*.22);ridge.rotation.x=Math.PI/2;}
    return len;
  }
  function shrub(p:THREE.Object3D,x:number,z:number,s=1) {
    box(p,.7*s,.25,.65*s,C.stone,x,.27,z,.09);
    const bush=ball(p,.34*s,C.leaf,x,.57,z);bush.scale.set(1,.85,1);
    ball(p,.19*s,'#91ad71',x+.13*s,.78,z-.06*s);
  }
  function lamp(p:THREE.Object3D,x:number,z:number) {
    cyl(p,.055,1.35,C.ink,x,.86,z);cyl(p,.11,.12,C.gold,x,.23,z);cyl(p,.11,.08,C.gold,x,1.48,z);
    box(p,.2,.26,.2,'#fff0c0',x,1.65,z,.04);box(p,.28,.08,.28,C.ink,x,1.81,z);
  }
  function car(p:THREE.Object3D,x:number,z:number,color:string,angle=0) {
    const g=new THREE.Group();g.position.set(x,.22,z);g.rotation.y=angle;p.add(g);
    box(g,.64,.26,1.2,color,0,.26,0,.12);box(g,.55,.26,.65,C.ink,0,.49,-.08,.09);box(g,.56,.045,.49,color,0,.63,-.09);
    box(g,.57,.045,.045,C.gold,0,.27,.61);box(g,.5,.09,.035,'#dcecf1',0,.32,.61);
    for(const side of [-1,1])for(const iz of [-.37,.38]){const tire=cyl(g,.14,.09,'#253039',side*.32,.19,iz);tire.rotation.z=Math.PI/2;const rim=cyl(g,.075,.095,'#c9cfd0',side*.32,.19,iz);rim.rotation.z=Math.PI/2;}
    box(g,.2,.075,.13,C.gold,0,.7,-.05);return g;
  }
  function base(p:THREE.Object3D,stage:number,soon:boolean) {
    box(p,5.7,.23,5.3,'#9d9c91',0,.02,0,.15);box(p,5.55,.15,5.15,C.ivory,0,.2,0,.15);
    for(let i=0;i<3;i++)box(p,2.05,.095,1-i*.18,C.stone,0,.13+i*.085,2.5-i*.13);
    for(const side of [-1,1]){shrub(p,side*2.25,1.9);lamp(p,side*2.55,2.1);}
    for(let i=0;i<stage;i++){const gem=mesh(p,cached('award',()=>new THREE.OctahedronGeometry(.11)),C.gold,-.5+i*.25,.38,2.38,.5,.25);gem.rotation.z=.3;}
    if(soon){for(const x of [-.9,.9])cyl(p,.05,.55,C.gold,x,.53,2.35);box(p,1.8,.025,.03,C.ink,0,.74,2.35);}
  }
  function academy(p:THREE.Object3D,stage:number) {
    box(p,3.1,1.85,2.05,C.stone,0,1.2,-.15,.12);box(p,3.25,.18,2.2,C.ivory,0,.4,-.15);roof(p,3.55,2.55,.95,0,2.2,-.15);
    for(const side of [-1,1]) {
      window(p,side*1.02,.8,.9,.48,.88,true);
      const wing=new THREE.Group();wing.position.set(side*1.9,0,-.25);p.add(wing);box(wing,.9,1.32,1.65,C.stone,0,.96,0);roof(wing,1.15,1.9,.5,0,1.63,0);window(wing,0,.68,.84,.45,.7,true);
    }
    arch(p,.65,1.25,C.ink,0,.42,.98);
    box(p,1.25,.18,.85,C.ivory,0,1.8,1.32);
    for(const side of [-1,1]){cyl(p,.09,1.35,C.ivory,side*.5,1.08,1.65);cyl(p,.14,.13,C.trim,side*.5,.43,1.65);}
    box(p,.94,1.3,.94,C.stone,0,2.9,-.25);roof(p,1.2,1.2,.68,0,3.6,-.25);
    const clock=cyl(p,.31,.05,C.ivory,0,3.08,.25);clock.rotation.x=Math.PI/2;
    torus(p,.3,.025,C.gold,0,3.08,.3);box(p,.028,.22,.03,C.ink,0,3.15,.31,.005);box(p,.17,.028,.03,C.ink,.08,3.07,.31,.005);
    sign(p,'ACADEMY',0,2.08,1.04,1.5);
    if(stage>=3){for(const x of [-2.25,2.25]){cyl(p,.025,1.6,C.ink,x,1.05,-1.7);box(p,.45,.3,.03,C.gold,x+.2,1.7,-1.7);}}
    return 4.3;
  }
  function garage(p:THREE.Object3D,stage:number) {
    box(p,4.1,1.65,2.15,C.stone,0,1.11,-.6,.12);box(p,4.3,.2,2.35,C.ink,0,2,-.6);
    for(const x of [-1.34,0,1.34]) {
      box(p,1.11,1.28,.1,C.ink,x,1.01,.51);box(p,.94,.95,.04,C.glass,x,1.13,.58);
      for(let i=0;i<4;i++)box(p,.98,.035,.035,'#a6b7b5',x,.76+i*.23,.61,.008);
      box(p,1.18,.12,.55,C.gold,x,1.8,.69);car(p,x,1.38,x===0?'#e3b94e':'#e4e9df');
      const roofGlass=box(p,1.06,.09,1.45,C.glass,x,2.21,-.65);roofGlass.rotation.x=-.18;
      box(p,.07,.32,1.5,C.ivory,x-.52,2.19,-.65);
    }
    sign(p,'PULS GARAGE',0,2.28,.67,2.3);
    for(const x of [-2.2,2.2])box(p,.06,1.55,.06,C.ink,x,1.08,2.1);
    box(p,4.6,.14,.65,C.ivory,0,1.89,2.1,.09);box(p,4.6,.04,.06,C.gold,0,1.84,2.45);
    if(stage>=3){for(const x of [-2.3,2.3]){box(p,.22,.65,.25,C.ink,x,.64,.6);box(p,.13,.18,.02,'#92d7bb',x,.77,.74);}}
    if(stage>=4){for(let i=0;i<4;i++)box(p,.75,.07,.8,C.glass,-1.45+i*.95,2.35,-1.15);}
    return 2.8;
  }
  function crm(p:THREE.Object3D,stage:number) {
    const h=2.55+stage*.16;
    box(p,2.48,h,1.95,C.ivory,0,.34+h/2,-.35,.2);
    box(p,3.1,h-.33,2.52,C.glass,0,.54+(h-.33)/2,-.35,.22);
    for(let level=0;level<3;level++)box(p,3.18,.12,2.68,C.ivory,0,.6+level*(h-.25)/3,-.35,.18);
    for(let i=0;i<7;i++)box(p,.045,h-.27,.085,C.gold,-1.2+i*.4,.58+(h-.27)/2,.945,.014);
    for(const side of [-1,1])for(let i=0;i<4;i++)box(p,.085,h-.27,.045,C.gold,side*1.56,.58+(h-.27)/2,-1.25+i*.55,.014);
    box(p,3.26,.18,2.77,C.ivory,0,h+.35,-.35,.25);
    box(p,2.88,.1,2.4,C.leaf,0,h+.49,-.35,.25);
    for(const x of [-1.05,1.05])for(const z of [-1.13,.4]){const plant=ball(p,.27,C.leaf,x,h+.75,z);plant.scale.y=.7;}
    box(p,1.15,.65,1.06,C.stone,.48,h+.82,-.55,.15);box(p,1.28,.12,1.2,C.ivory,.48,h+1.19,-.55);
    box(p,1.06,1.12,.13,C.ink,0,.89,.99,.1);box(p,.04,1,.04,C.gold,0,.88,1.08);
    box(p,1.8,.15,1.15,C.gold,0,1.72,1.22,.1);
    sign(p,'PULS / CRM',0,2.3,1.02,1.5);
    if(stage>=4){for(const side of [-1,1]){box(p,.55,1.8,1.2,C.stone,side*1.98,1.22,-.2);window(p,side*1.98,.7,.42,.3,.95);}}
    return h+1.3;
  }
  function tower(p:THREE.Object3D) {
    box(p,2.8,.8,2.2,C.stone,0,.72,0,.18);box(p,2.95,.13,2.35,C.ivory,0,1.15,0);
    cyl(p,.68,2.55,C.stone,0,2.04,-.3,.5);
    for(let i=0;i<8;i++){const a=i*Math.PI/4;cyl(p,.04,2.4,C.gold,Math.cos(a)*.61,2,Math.sin(a)*.61-.3);}
    cyl(p,1.32,.15,C.ivory,0,3.23,-.3);cyl(p,1.18,.66,C.glass,0,3.65,-.3,1.27);
    for(let i=0;i<12;i++){const a=i*Math.PI/6;box(p,.055,.67,.055,C.gold,Math.cos(a)*1.23,3.65,Math.sin(a)*1.23-.3);}
    cyl(p,1.42,.18,C.ink,0,4.07,-.3);cyl(p,.035,.9,C.gold,0,4.6,-.3);ball(p,.1,'#dfaf57',0,5.1,-.3);
    sign(p,'CONTROL',0,.84,1.12,1.5);window(p,-.9,.5,1.12,.35,.45);window(p,.9,.5,1.12,.35,.45);
    return 5.2;
  }
  function oktell(p:THREE.Object3D) {
    box(p,3.4,1.35,2.45,C.stone,0,1,-.2,.25);box(p,3.55,.15,2.6,C.ivory,0,1.7,-.2,.25);
    for(const x of [-1.12,-.55,0,.55,1.12])window(p,x,.62,1.04,.4,.75,true);
    const dome=ball(p,1.25,C.roof,0,1.7,-.4);dome.scale.set(1,.8,.85);
    torus(p,1.3,.06,C.gold,0,1.74,-.4).rotation.x=Math.PI/2;
    const dish=new THREE.Group();dish.position.set(.75,2.5,-.8);dish.rotation.x=-.6;p.add(dish);
    const bowl=mesh(dish,cached('dish',()=>new THREE.SphereGeometry(.55,24,12,0,Math.PI*2,0,Math.PI/2)),C.ivory,0,0,0);bowl.material=mat(C.ivory,.25,.3);
    cyl(dish,.025,.55,C.gold,0,.3,0);ball(dish,.06,C.ink,0,.58,0);
    sign(p,'OKTELL',0,1.55,1.16,1.25);return 3.3;
  }
  function landmark(id:DistrictId,stage:number,soon:boolean) {
    const group=new THREE.Group();base(group,stage,soon);
    const height=id==='academy'?academy(group,stage):id==='driver'?garage(group,stage):id==='crm'?crm(group,stage):id==='dispatch'?tower(group):oktell(group);
    if(stage>=2){for(const side of [-1,1]){for(let i=0;i<4;i++)box(group,.05,.55,.05,C.ink,side*2.55,.58,-1.55+i*.55);box(group,.06,.06,2,C.gold,side*2.55,.86,-.72);}}
    if(stage>=4){shrub(group,-2.2,-1.7,1.25);shrub(group,2.2,-1.7,1.25);}
    if(stage===5){const crown=torus(group,.25,.055,C.gold,0,height+.24,0);crown.rotation.y=Math.PI/4;}
    mergeStatic(group);return {group,height};
  }
  function plaza(parent:THREE.Object3D) {
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
  return {landmark,car,plaza,dispose(){geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
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
