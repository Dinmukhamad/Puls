import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const C = {
  stone:'#e8ddc5', ivory:'#fff3dd', trim:'#c4af89', ink:'#253841', glass:'#497785', gold:'#cf9b4a', roof:'#365d66', leaf:'#668b68', wood:'#926b45',
  steel:'#9aa3a8', concrete:'#cfc7b8', red:'#d8574c', taxi:'#e9bd4c', slate:'#4b5d66', lawn:'#86b06a', white:'#f4f1e8',
};
/** The top of the island plinth every landmark stands on (5.7 × 5.3, front steps out to z = 3). */
export const PLINTH = .275;

type Part = THREE.Object3D;
/** The side of a building a row of windows is on: its front looks to +z. */
export type Face = 'front' | 'back' | 'left' | 'right';

/**
 * The landmark kit: parts drawn from shared geometries and one material per colour and finish (glass has its own,
 * which the city lights at night); assets/landmarks.ts merges every landmark's parts by material. All dimensions are
 * district-local, the front to +z.
 */
export function createKit() {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const geometry = new Map<string, THREE.BufferGeometry>();
  function mat(color: string, metal = 0, roughness = .65) {
    if(color===C.glass){metal=.35;roughness=.24;}
    const key=`${color}:${metal}:${roughness}`;
    if(!materials.has(key)) materials.set(key,new THREE.MeshStandardMaterial({color,metalness:metal,roughness}));
    return materials.get(key)!;
  }
  const cached=(key:string, make:()=>THREE.BufferGeometry)=>{if(!geometry.has(key))geometry.set(key,make());return geometry.get(key)!;};
  function mesh(p:Part,g:THREE.BufferGeometry,c:string,x:number,y:number,z:number,metal=0,rough=.65) {
    const m=new THREE.Mesh(g,mat(c,metal,rough));m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;p.add(m);return m;
  }
  /** A box by its centre; edges rounded by r, plain under .03 (rounding thin parts costs hundreds of triangles unseen). */
  function box(p:Part,w:number,h:number,d:number,c:string,x:number,y:number,z:number,r=.045) {
    const radius=Math.min(r,w/4,h/4,d/4),key=`box:${w}:${h}:${d}:${radius}`;
    return mesh(p,cached(key,()=>radius<.03?new THREE.BoxGeometry(w,h,d):new RoundedBoxGeometry(w,h,d,2,radius)),c,x,y,z);
  }
  /** A box standing on y0, plain unless r is given. */
  const block=(p:Part,w:number,h:number,d:number,c:string,x:number,y0:number,z:number,r=0)=>box(p,w,h,d,c,x,y0+h/2,z,r);
  function cyl(p:Part,r:number,h:number,c:string,x:number,y:number,z:number,top=r,seg=32) {
    return mesh(p,cached(`cyl:${r}:${h}:${top}:${seg}`,()=>new THREE.CylinderGeometry(top,r,h,seg)),c,x,y,z);
  }
  /** A cylinder standing on y0: posts, columns, shafts, tanks. */
  const post=(p:Part,r:number,h:number,c:string,x:number,y0:number,z:number,top=r,seg=12)=>cyl(p,r,h,c,x,y0+h/2,z,top,seg);
  function ball(p:Part,r:number,c:string,x:number,y:number,z:number,seg=16) {
    return mesh(p,cached(`sphere:${r}:${seg}`,()=>new THREE.SphereGeometry(r,seg,Math.max(6,seg*3/4|0))),c,x,y,z);
  }
  /** A dome on y0: a half sphere of radius r rising `rise`. */
  function dome(p:Part,r:number,c:string,x:number,y0:number,z:number,rise=r) {
    const m=mesh(p,cached(`dome:${r}`,()=>new THREE.SphereGeometry(r,28,10,0,Math.PI*2,0,Math.PI/2)),c,x,y0,z);m.scale.y=rise/r;return m;
  }
  /** A four-sided pyramid roof over w × d, h high, standing on y0. */
  function pyramid(p:Part,w:number,d:number,h:number,c:string,x:number,y0:number,z:number) {
    const m=mesh(p,cached('pyramid',()=>new THREE.ConeGeometry(Math.SQRT1_2,1,4,1).rotateY(Math.PI/4).translate(0,.5,0)),c,x,y0,z);m.scale.set(w,h,d);return m;
  }
  /** A cone or spire standing on y0. */
  const cone=(p:Part,r:number,h:number,c:string,x:number,y0:number,z:number,seg=16)=>mesh(p,cached(`cone:${r}:${h}:${seg}`,()=>new THREE.ConeGeometry(r,h,seg)),c,x,y0+h/2,z);
  /** A triangular prism standing on y0: w wide, h to its ridge, d long along z (a gable's end faces the front). */
  function prism(p:Part,w:number,h:number,d:number,c:string,x:number,y0:number,z:number) {
    return mesh(p,cached(`prism:${w}:${h}:${d}`,()=>{
      const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(0,h);shape.closePath();
      return new THREE.ExtrudeGeometry(shape,{depth:d,bevelEnabled:false}).translate(0,0,-d/2);
    }),c,x,y0,z);
  }
  /**
   * A pitched roof on y0 over w × d, h to the ridge: gable walls under two overhanging slopes and a ridge cap. The
   * ridge runs along z (a gable end to the front) or, `along: 'x'`, across the front.
   */
  function pitched(p:Part,w:number,d:number,h:number,x:number,y0:number,z:number,{wall=C.stone,cover=C.roof,along='z'}:{wall?:string;cover?:string;along?:'x'|'z'}={}) {
    const g=new THREE.Group();g.position.set(x,y0,z);if(along==='x')g.rotation.y=Math.PI/2;p.add(g);
    const [across,length]=along==='x'?[d,w]:[w,d],half=across/2,slope=Math.atan2(h,half),run=Math.hypot(half,h),t=.07;
    prism(g,across,h,length,wall,0,0,0);
    for(const side of [-1,1]){
      const s=box(g,run+.16,t,length+.24,cover,side*(half/2+h/run*t/2),h/2+half/run*t/2,0,0);s.rotation.z=-side*slope;
    }
    box(g,.12,.1,length+.26,C.slate,0,h+.04,0,0);
    return g;
  }
  /** A barrel vault on y0 over a hall `len` long along z: the arch faces the front. */
  function vault(p:Part,r:number,len:number,c:string,x:number,y0:number,z:number) {
    return mesh(p,cached(`vault:${r}:${len}`,()=>new THREE.CylinderGeometry(r,r,len,20,1,false,Math.PI/2,Math.PI).rotateX(Math.PI/2)),c,x,y0,z);
  }
  function torus(p:Part,r:number,t:number,c:string,x:number,y:number,z:number,seg=48) {
    return mesh(p,cached(`torus:${r}:${t}:${seg}`,()=>new THREE.TorusGeometry(r,t,8,seg)),c,x,y,z);
  }
  function sign(p:Part,text:string,x:number,y:number,z:number,w:number,color=C.ink) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,512,128);ctx.fillStyle='#fff5dc';ctx.font='700 65px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,68,460);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshStandardMaterial({map:texture,roughness:.6});
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(w,w/4),material);plane.position.set(x,y,z);p.add(plane);
  }
  function arch(p:Part,w:number,h:number,c:string,x:number,y:number,z:number) {
    const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(w/2,h-w/2);shape.absarc(0,h-w/2,w/2,0,Math.PI,false);shape.closePath();
    const key=`arch:${w}:${h}`;
    return mesh(p,cached(key,()=>new THREE.ExtrudeGeometry(shape,{depth:.07,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:2,steps:1,curveSegments:12})),c,x,y,z);
  }
  function window(p:Part,x:number,y:number,z:number,w=.5,h=.8,arched=false) {
    if(arched){arch(p,w+.14,h+.12,C.ivory,x,y-.06,z-.06);arch(p,w,h,C.glass,x,y,z);}
    else{box(p,w+.13,h+.13,.13,C.ivory,x,y+h/2,z-.04);box(p,w,h,.06,C.glass,x,y+h/2,z+.04,.025);}
    box(p,.035,h,.05,C.gold,x,y+h/2,z+.095,.008);
    box(p,w,.03,.05,C.trim,x,y+h*.42,z+.095,.008);
    box(p,w+.22,.1,.22,C.stone,x,y-.04,z+.04);
  }
  /**
   * Flat windows on one face of a building: glass in a frame, w × h from y0, at the positions along the face
   * (x on the front and back, z on the sides); `at` is the face's own coordinate.
   */
  function panes(p:Part,face:Face,at:number,y0:number,along:readonly number[],w:number,h:number,frame:string=C.ivory) {
    const out=face==='front'||face==='right'?1:-1,side=face==='left'||face==='right';
    for(const a of along){
      const [x,z]=side?[at,a]:[a,at];
      if(side){box(p,.03,h+.08,w+.08,frame,x+out*.015,y0+h/2,z,0);box(p,.05,h,w,C.glass,x+out*.035,y0+h/2,z,0);}
      else{box(p,w+.08,h+.08,.03,frame,x,y0+h/2,z+out*.015,0);box(p,w,h,.05,C.glass,x,y0+h/2,z+out*.035,0);}
    }
  }
  function shrub(p:Part,x:number,z:number,s=1,y0=0) {
    box(p,.7*s,.25,.65*s,C.stone,x,y0+.27,z,.09);
    const bush=ball(p,.34*s,C.leaf,x,y0+.57,z);bush.scale.set(1,.85,1);
    ball(p,.19*s,'#91ad71',x+.13*s,y0+.78,z-.06*s);
  }
  function lamp(p:Part,x:number,z:number,y0=0) {
    cyl(p,.055,1.35,C.ink,x,y0+.86,z,.055,12);cyl(p,.11,.12,C.gold,x,y0+.23,z,.11,12);cyl(p,.11,.08,C.gold,x,y0+1.48,z,.11,12);
    box(p,.2,.26,.2,'#fff0c0',x,y0+1.65,z,.04);box(p,.28,.08,.28,C.ink,x,y0+1.81,z);
  }
  /** A round-crowned tree, s its size, on y0. */
  function tree(p:Part,x:number,z:number,s=1,y0=PLINTH) {
    post(p,.06*s,.45*s,C.wood,x,y0,z,.05*s,8);
    const crown=ball(p,.36*s,C.leaf,x,y0+.72*s,z,12);crown.scale.y=1.1;ball(p,.2*s,'#91ad71',x+.14*s,y0+.92*s,z-.08*s,10);
  }
  /** A flag on a pole h high, flying towards +x. */
  function flag(p:Part,x:number,z:number,h:number,c:string,y0=PLINTH) {
    post(p,.028,h,C.ink,x,y0,z,.028,8);ball(p,.05,C.gold,x,y0+h+.04,z,8);
    box(p,.5,.3,.025,c,x+.27,y0+h-.2,z,0);
  }
  /** A small taxi, 0.6 × 1.1, its nose to +z turned by `turn`. */
  function taxi(p:Part,x:number,z:number,turn=0,c:string=C.taxi,y0=PLINTH) {
    const g=new THREE.Group();g.position.set(x,y0,z);g.rotation.y=turn;p.add(g);
    box(g,.58,.24,1.08,c,0,.24,0,.06);box(g,.5,.2,.56,C.ink,0,.45,-.06,.05);box(g,.52,.03,.5,c,0,.56,-.06,0);
    box(g,.2,.08,.1,C.gold,0,.62,-.04,0);box(g,.46,.07,.03,'#dcecf1',0,.27,.545,0);
    for(const sx of [-1,1])for(const sz of [-.33,.34])box(g,.08,.18,.18,C.ink,sx*.29,.13,sz,0);
    return g;
  }
  /** A dish aerial: its bowl r across, opening up and tilted `tilt` towards +z, turned by `turn`, on its mount at y. */
  function dish(p:Part,r:number,x:number,y:number,z:number,tilt=.6,turn=0) {
    const g=new THREE.Group();g.position.set(x,y,z);g.rotation.set(0,turn,0);p.add(g);
    const tip=new THREE.Group();tip.rotation.x=tilt;g.add(tip);
    // The bowl from inside and out: the bottom cap of a sphere and the same cap turned inside out.
    const bowl=mesh(tip,cached(`bowl:${r}`,()=>{
      const outer=new THREE.SphereGeometry(r,18,5,0,Math.PI*2,Math.PI*.62,Math.PI*.38),inner=outer.clone(),index=inner.getIndex()!,normal=inner.getAttribute('normal');
      for(let i=0;i<index.count;i+=3){const b=index.getX(i+1);index.setX(i+1,index.getX(i+2));index.setX(i+2,b);}
      for(let i=0;i<normal.count;i++)normal.setXYZ(i,-normal.getX(i),-normal.getY(i),-normal.getZ(i));
      const both=mergeGeometries([outer,inner])!;outer.dispose();inner.dispose();return both.translate(0,r*.79,0);
    }),C.ivory,0,0,0);bowl.material=mat(C.ivory,.25,.3);
    cyl(tip,.025,r*.75,C.gold,0,r*.42,0,.025,8);ball(tip,r*.09,C.ink,0,r*.8,0,8);
    post(g,.06,.12,C.steel,0,-.12,0,.06,8);
    return g;
  }
  /** A lattice mast w across and h high on y0, with a warning light at the top. */
  function mast(p:Part,w:number,h:number,x:number,y0:number,z:number,c:string=C.red) {
    const legs:[number,number][]=[[-1,-1],[1,-1],[1,1],[-1,1]],step=.42,n=Math.max(2,Math.round(h/step));
    for(const [sx,sz] of legs) box(p,.045,h,.045,c,x+sx*w/2,y0+h/2,z+sz*w/2,0);
    for(let i=1;i<=n;i++){
      const y=y0+h*i/n,colour=i%2?C.white:c;
      box(p,w,.035,.035,colour,x,y,z-w/2,0);box(p,w,.035,.035,colour,x,y,z+w/2,0);
      box(p,.035,.035,w,colour,x-w/2,y,z,0);box(p,.035,.035,w,colour,x+w/2,y,z,0);
      // One brace across each face of every bay, alternating.
      const rise=h/n,len=Math.hypot(w,rise),tilt=Math.atan2(rise,w)*(i%2?1:-1);
      for(const face of [-1,1]){
        box(p,len,.025,.025,C.steel,x,y-rise/2,z+face*w/2,0).rotation.z=tilt;
        box(p,.025,.025,len,C.steel,x+face*w/2,y-rise/2,z,0).rotation.x=-tilt;
      }
    }
    ball(p,.07,C.red,x,y0+h+.07,z,8);
  }
  /** Gives a part the kit's metal finish (gold fittings, steel aerials): one shared finish keeps the draw calls few. */
  const metal=(m:THREE.Mesh,c:string)=>{m.material=mat(c,.5,.25);return m;};
  return {box,block,cyl,post,ball,dome,pyramid,cone,prism,pitched,vault,torus,sign,arch,window,panes,shrub,lamp,tree,flag,taxi,dish,mast,metal,mesh,cached,
    dispose(){geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
}
export type LandmarkKit = ReturnType<typeof createKit>;
