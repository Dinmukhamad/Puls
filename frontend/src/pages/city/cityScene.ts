import * as THREE from "three";
import type { DistrictId } from "../../api/city";
interface CityLocation {id: DistrictId; x: number; z: number; soon?: boolean}
const data: CityLocation[]=[{id:"academy",x:-5,z:2},{id:"driver",x:-4,z:-4},{id:"crm",x:3,z:-1},{id:"dispatch",x:4,z:5,soon:true},{id:"opteo",x:-2,z:7,soon:true}];
export function createCityScene(host: HTMLDivElement, levels: Record<string,number>, onProject: (positions: Record<string,{x:number;y:number}>)=>void, onLost: ()=>void) {
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"low-power"});
 renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0,0);host.replaceChildren(renderer.domElement);
 const state={world:"city",completed:(levels.crm??0)>=2,view:"map"};
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-12,12,12,-12,.1,120);let yaw=.38;const target=new THREE.Vector3(0,0,1.2);let world=new THREE.Group();scene.add(world);
      scene.add(new THREE.HemisphereLight('#f6ecff','#776b99',2.4));const sun=new THREE.DirectionalLight('#fff5e1',3.3);sun.position.set(-9,18,12);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-16;sun.shadow.camera.right=16;sun.shadow.camera.top=16;sun.shadow.camera.bottom=-16;sun.shadow.normalBias=.06;scene.add(sun);
      const mats=new Map<string, THREE.MeshStandardMaterial>();function material(color: string,emissive=false){const key=color+emissive;if(!mats.has(key))mats.set(key,new THREE.MeshStandardMaterial({color,roughness:.78,metalness:.05,...(emissive?{emissive:color,emissiveIntensity:.35}:{})}));return mats.get(key);}
      function mesh(geo: THREE.BufferGeometry,color: string,x: number,y: number,z: number,parent=world){const m=new THREE.Mesh(geo,material(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
      function box(w: number,h: number,d: number,c: string,x: number,y: number,z: number,p?: THREE.Group){return mesh(new THREE.BoxGeometry(w,h,d),c,x,y,z,p);}
      function cyl(r: number,h: number,c: string,x: number,y: number,z: number,p?: THREE.Group,n=32){return mesh(new THREE.CylinderGeometry(r,r,h,n),c,x,y,z,p);}
      function sphere(r: number,c: string,x: number,y: number,z: number,p?: THREE.Group){return mesh(new THREE.SphereGeometry(r,16,12),c,x,y,z,p);}
      function tree(x: number,z: number,size=1,p=world){cyl(.10*size,.75*size,'#9b7b88',x,.5,z,p,7);const a=sphere(.5*size,'#96afa8',x,1.05*size,z,p);a.scale.y=1.25;sphere(.31*size,'#b9c8b0',x+.22*size,1.32*size,z,p);}
      function road(a: CityLocation,b: CityLocation){const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);const r=box(.8,.045,len,'#cbc6df',(a.x+b.x)/2,.24,(a.z+b.z)/2);r.rotation.y=Math.atan2(dx,dz);for(let i=1;i<len;i+=1.15){const t=i/len;const dash=box(.07,.05,.4,'#f6f0ff',a.x+dx*t,.28,a.z+dz*t);dash.rotation.y=r.rotation.y;}}
      function windowGrid(x: number,y: number,z: number,cols: number,rows: number,p: THREE.Group,side=false){for(let i=0;i<cols;i++)for(let j=0;j<rows;j++){if(side)box(.035,.26,.3,'#e8e4fc',x,y+j*.5,z+i*.47,p);else box(.3,.26,.035,'#e8e4fc',x+i*.47,y+j*.5,z,p);}}
      function building(d: CityLocation){const g=new THREE.Group();g.position.set(d.x,.3,d.z);world.add(g);if(!d.soon)g.scale.y=1+Math.min(levels[d.id]??0,3)*.055;const muted=d.soon;const wall=muted?'#b1acbd':d.id==='crm'?'#9c85da':'#bfb1e6';const roof=muted?'#948ea5':'#6c52a3';
        cyl(2.45,.28,muted?'#d1cddc':'#e9e2f6',0,0,0,g,6);cyl(2.35,.07,muted?'#c3c6cc':'#c8d7c9',0,.18,0,g,6);
        if(d.id==='academy'){
          box(2.3,1.6,1.9,wall,0,1,0,g);const r=mesh(new THREE.ConeGeometry(1.8,.9,4),roof,0,2.2,0,g);r.rotation.y=Math.PI/4;
          box(.58,1.05,.08,'#665989',0,.76,1,g);windowGrid(-.7,1.25,1,1,1,g);windowGrid(.7,1.25,1,1,1,g);for(let i=0;i<3;i++)box(1.1,.13,1.1-i*.23,'#eee7f5',0,.2+i*.13,1.25,g);
          cyl(.055,1.2,'#877199',.9,2.9,0,g);box(.55,.32,.04,'#c99ef7',1.16,3.24,0,g);
        }else if(d.id==='driver'){
          box(2.7,1.15,1.7,wall,0,.77,-.35,g);box(2.95,.18,1.95,roof,0,1.44,-.35,g);for(const x of [-.73,.73]){box(.95,.83,.045,'#56486d',x,.63,.52,g);for(let i=0;i<4;i++)box(.95,.025,.06,'#88789f',x,.35+i*.17,.56,g);}
          for(const [x,z,c]of[[-.75,1.3,'#eac984'],[.75,1.45,'#b5a0e9']] as const){box(.6,.23,1.05,c,x,.39,z,g);box(.52,.23,.55,'#655f81',x,.6,z-.05,g);for(const xx of[-.33,.33])for(const zz of[-.32,.32]){const w=cyl(.12,.1,'#5d536e',x+xx,.3,z+zz,g,10);w.rotation.z=Math.PI/2;}}
          box(.08,1.45,.08,'#877797',1.75,.9,-.3,g);box(.6,.5,.12,'#e5ca86',1.75,1.6,-.3,g);
        }else if(d.id==='crm'){
          const high=state.completed?3.6:2.8;box(2.25,high,1.8,wall,0,high/2+.22,0,g);box(2.46,.17,2.01,roof,0,high+.3,0,g);box(1.8,.2,1.3,'#c9b6ef',0,high+.47,0,g);windowGrid(-.73,.95,.925,4,state.completed?5:3,g);windowGrid(1.15,.95,-.57,3,state.completed?5:3,g,true);box(.57,.72,.055,'#6d558e',0,.57,.95,g);box(1.04,.16,.5,'#b9a0e4',0,1,.98,g);
          cyl(.05,.7,'#78648e',0,high+.9,0,g);const gem=mesh(new THREE.OctahedronGeometry(.38),state.completed?'#ffd976':'#b3eeec',0,high+1.5,0,g);gem.rotation.y=.3;
        }else if(d.id==='dispatch'){
          cyl(.7,2.7,wall,0,1.55,0,g,8);cyl(1.22,.75,'#7d7699',0,3.2,0,g,8);cyl(1.4,.17,roof,0,3.67,0,g,8);cyl(.045,1.3,'#827691',0,4.35,0,g);sphere(.13,'#e3c2e7',0,5,0,g);box(1.9,.55,1.5,wall,0,.47,.3,g);box(.5,.6,.045,'#8d839e',0,.52,1.07,g);for(const x of[-.64,.03,.64])box(.37,.28,.045,'#aab9ce',x,3.26,1.12,g);
        }else{
          box(2.4,1.35,1.9,wall,0,.91,0,g);const dome=sphere(1.05,'#a39bb8',0,1.55,0,g);dome.scale.set(1,.65,.83);box(2.6,.14,2.1,roof,0,1.65,0,g);box(1.3,.55,.04,'#8d88a7',0,.96,.98,g);for(const x of[-.4,0,.4])box(.15,.33,.05,'#bccfd0',x,1,.995,g);const antenna=mesh(new THREE.TorusGeometry(.55,.055,8,32),'#d4c6e6',.4,2.55,0,g);antenna.rotation.x=-.6;
        }
        for(let i=0;i<(levels[d.id]??0);i++){const star=mesh(new THREE.OctahedronGeometry(.16),'#f2cd77',-1.0+i*.36,.44,1.7,g);star.rotation.z=.25;}tree(-1.8,-.65,.6,g);tree(1.68,.8,.46,g);for(let i=0;i<3;i++)box(.3,.07,.22,'#ded9e9',-.35+i*.34,.24,1.93,g);
        if(!muted){cyl(.045,1.2,'#a293b1',-1.7,.75,1.15,g);sphere(.13,'#fff0c1',-1.7,1.4,1.15,g);}
      }
      function makeWorld(){scene.remove(world);world.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});world=new THREE.Group();scene.add(world);
        if(state.world==='city'){
          const base=box(15,.52,17,'#b6aacb',-.4,-.37,1.25);base.receiveShadow=true;box(14.75,.16,16.75,'#d6d5d9',-.4,-.03,1.25);
          for(const [i,j]of[[0,1],[1,2],[2,3],[3,4],[4,0]])road(data[i],data[j]);
          for(const [x,z,s]of[[-6.5,-6.1,.65],[-6.8,-4.9,.5],[-6.9,7.7,.55],[5.7,-5,.7],[6.1,-3.7,.5],[5.7,8.3,.65],[.3,-6,.55],[-4.5,8.9,.5]])tree(x,z,s);
          box(2.5,.02,1.35,'#a8c6ca',4.8,.09,-5.5);for(let i=0;i<3;i++)box(.35,.03,1.35,'#cfdce0',3.9+i*.65,.13,-5.5);
        }else{
          data.forEach(d=>{mesh(new THREE.CylinderGeometry(2.5,1.2,1.1,6),'#b5a0c9',d.x,-.3,d.z);});
          for(const [a,b]of[[data[0],data[1]],[data[1],data[2]],[data[2],data[3]],[data[3],data[4]]]){const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);for(let i=2.6;i<len-2.1;i+=.44){const plank=box(.8,.12,.3,'#c4acd3',a.x+dx*i/len,.17,a.z+dz*i/len);plank.rotation.y=Math.atan2(dx,dz);}}
        }
        data.forEach(building);
        // A small original Pulsar character marks the active city hub.
        const botGroup=new THREE.Group();botGroup.position.set(-.5,.4,1.25);world.add(botGroup);const head=sphere(.46,'#a787e3',0,.72,0,botGroup);head.scale.set(1.1,.92,.75);const face=sphere(.35,'#37304f',0,.76,.23,botGroup);face.scale.set(1,.64,.3);sphere(.075,'#b3f4ed',-.14,.8,.34,botGroup);sphere(.075,'#b3f4ed',.14,.8,.34,botGroup);cyl(.035,.28,'#b397dd',0,1.22,0,botGroup);sphere(.07,'#d4baff',0,1.39,0,botGroup);sphere(.22,'#9474cc',0,.25,0,botGroup);cyl(.75,.05,'#bda8dc',0,.015,0,botGroup);
        draw();
      }

 function draw(){
  const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;
  renderer.setSize(w,h,false);const aspect=w/h,span=w<440?21.5:24;
  camera.left=-span/2;camera.right=span/2;camera.top=span/aspect/2;camera.bottom=-span/aspect/2;
  camera.position.set(Math.sin(yaw)*27,25,Math.cos(yaw)*27);camera.lookAt(target);camera.updateProjectionMatrix();renderer.render(scene,camera);
  const placed:{x:number;y:number}[]=[],positions:Record<string,{x:number;y:number}>={};
  const mobile:Record<string,number>={academy:.21,driver:.46,crm:.77,dispatch:.77,opteo:.22};
  const pins=data.map(d=>{const p=new THREE.Vector3(d.x,.35,d.z+1.6).project(camera);return {d,p,y:(-p.y*.5+.5)*h+18};}).sort((a,b)=>a.y-b.y);
  const width=w<440?112:124,height=48;
  for(const {d,p,y:py} of pins){const x=Math.max(width/2+8,Math.min(w-width/2-8,w<440?mobile[d.id]*w:(p.x*.5+.5)*w));let y=Math.max(78,Math.min(h-95,py));
   for(let i=0;i<6;i++){const conflict=placed.find(a=>Math.abs(x-a.x)<width+5&&Math.abs(y-a.y)<height+5);if(!conflict)break;y=conflict.y+height+6;}
   positions[d.id]={x,y};placed.push({x,y});
  }
  onProject(positions);
 }
 const observer=new ResizeObserver(draw);observer.observe(host);makeWorld();
 const lost=(event:Event)=>{event.preventDefault();onLost();};renderer.domElement.addEventListener("webglcontextlost",lost);
 return {rotate(direction:number){yaw=Math.max(-.2,Math.min(.8,yaw+direction*.15));draw();},dispose(){observer.disconnect();renderer.domElement.removeEventListener("webglcontextlost",lost);scene.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});mats.forEach(m=>m.dispose());renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
