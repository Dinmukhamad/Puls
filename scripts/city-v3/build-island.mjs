/**
 * Puls City V3 — original, deterministic miniature architecture.
 * Run from the repository root: node scripts/city-v3/build-island.mjs
 * No Blender, network access, fonts, textures or third-party art are required.
 * All geometry is authored here and merged by PBR material before GLB export.
 */
import * as THREE from '../../frontend/node_modules/three/build/three.module.js';
import { GLTFExporter } from '../../frontend/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from '../../frontend/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptEncoder } from '../../frontend/node_modules/meshoptimizer-pilot/meshopt_encoder.module.js';
import { MeshoptDecoder } from '../../frontend/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

class NodeFileReader {
  async readAsArrayBuffer(blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
  async readAsDataURL(blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onloadend?.(); }
}
globalThis.FileReader = NodeFileReader;

const outDir = new URL('../../frontend/public/city/v3-pilot/', import.meta.url);
const scene = new THREE.Scene();
scene.name = 'Puls — CRM harbour island';
scene.userData = { generator: 'Puls original art / city-v3/build-island.mjs', licence: 'Original project artwork', version: 1 };
const parts = new Map();
const palette = {
  limestone: { color: '#e3d6b9', roughness: .88 },
  ivory: { color: '#fcf4de', roughness: .68 },
  pavement: { color: '#c2c5b6', roughness: .96 },
  asphalt: { color: '#526674', roughness: .98 },
  markings: { color: '#fff4d5', roughness: .82 },
  gold: { color: '#d9ac53', roughness: .38, metalness: .45 },
  graphite: { color: '#243d49', roughness: .49, metalness: .25 },
  glass: { color: '#376777', roughness: .23, metalness: .4 },
  'city-night-glass': { color: '#517984', roughness: .28, metalness: .3, emissive: '#7ca3a2', emissiveIntensity: .06 },
  'city-night-lights': { color: '#ffe0a0', roughness: .42, emissive: '#ffba51', emissiveIntensity: .4 },
  grass: { color: '#73a16b', roughness: 1 },
  foliage: { color: '#529274', roughness: .96 },
  foliageLight: { color: '#91b871', roughness: .95 },
  foliageDark: { color: '#2c6b59', roughness: .98 },
  timber: { color: '#967653', roughness: .84 },
  terracotta: { color: '#ce8068', roughness: .87 },
  water: { color: '#54b7b8', roughness: .19, metalness: .16 },
};
const mat = Object.fromEntries(Object.entries(palette).map(([name, values]) => {
  const material = new THREE.MeshStandardMaterial({ ...values, vertexColors: true });
  material.name = name;
  return [name, material];
}));
const orientation = new THREE.Euler();
const transform = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
let sourceObjects = 0;

/** Subtle vertex ambient shading only: directional sun/shadows remain the renderer's job. */
function add(geometry, material, x = 0, y = 0, z = 0, rotation = [0, 0, 0], scaling = [1, 1, 1], tone = 1) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  geometry.dispose();
  orientation.set(...rotation); quaternion.setFromEuler(orientation);
  transform.compose(position.set(x, y, z), quaternion, scale.set(...scaling));
  g.applyMatrix4(transform);
  g.deleteAttribute('uv');
  const colors = new Float32Array(g.attributes.position.count * 3);
  const normals = g.attributes.normal;
  for (let i = 0; i < g.attributes.position.count; i++) {
    const shade = tone * (.84 + .16 * Math.max(0, normals.getY(i)));
    colors[i * 3] = shade; colors[i * 3 + 1] = shade; colors[i * 3 + 2] = shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (!parts.has(material)) parts.set(material, []);
  parts.get(material).push(g);
  sourceObjects++;
}

function roundedShape(w, d, r) {
  r = Math.min(r, w / 2, d / 2);
  const s = new THREE.Shape();
  s.moveTo(-w/2+r, -d/2); s.lineTo(w/2-r, -d/2);
  s.quadraticCurveTo(w/2, -d/2, w/2, -d/2+r); s.lineTo(w/2, d/2-r);
  s.quadraticCurveTo(w/2, d/2, w/2-r, d/2); s.lineTo(-w/2+r, d/2);
  s.quadraticCurveTo(-w/2, d/2, -w/2, d/2-r); s.lineTo(-w/2, -d/2+r);
  s.quadraticCurveTo(-w/2, -d/2, -w/2+r, -d/2); s.closePath();
  return s;
}

function slab(w, h, d, material, x, y, z, r = .18, angle = 0, tone = 1) {
  const bevel = Math.min(.045, h * .15);
  const g = new THREE.ExtrudeGeometry(roundedShape(w, d, r), { depth: h - 2*bevel, bevelEnabled: true, bevelSegments: 1, bevelSize: bevel, bevelThickness: bevel, steps: 1, curveSegments: 4 });
  g.rotateX(-Math.PI/2); g.translate(0, -h/2+bevel, 0);
  add(g, material, x, y, z, [0, angle, 0], [1, 1, 1], tone);
}
function box(w, h, d, material, x, y, z, angle = 0, tone = 1) {
  add(new THREE.BoxGeometry(w, h, d), material, x, y, z, [0, angle, 0], [1, 1, 1], tone);
}
function cylinder(r, h, material, x, y, z, top = r, n = 24, tone = 1) {
  add(new THREE.CylinderGeometry(top, r, h, n), material, x, y, z, [0,0,0], [1,1,1], tone);
}
function leaf(r, material, x, y, z, sx = 1, sy = 1, sz = 1, tone = 1) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  add(g, material, x, y, z, [0, (x+z)*.7, .12], [sx, sy, sz], tone);
}
function tube(points, radius, material, segments = 24) {
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), segments, radius, 5, false), material);
}
function ring(inner, outer, y, material, start = 0, length = Math.PI*2, segments = 96) {
  add(new THREE.RingGeometry(inner, outer, segments, 1, start, length), material, 0, y, 0, [-Math.PI/2,0,0]);
}
function curb(radius, thickness, y, h, material, start = 0, length = Math.PI*2) {
  const s = new THREE.Shape();
  s.absarc(0,0,radius+thickness/2,start,start+length,false);
  s.absarc(0,0,radius-thickness/2,start+length,start,true); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {depth:h,bevelEnabled:false,curveSegments:64});
  g.rotateX(-Math.PI/2); add(g,material,0,y,0);
}

// Layered stone waterfront: architectural foundation rather than a floating grass disc.
cylinder(17.9, .94, 'limestone', 0, -.88, 0, 17.72, 96, .89);
cylinder(18.02, .18, 'ivory', 0, -.34, 0, 18.02, 96);
cylinder(17.85, .26, 'limestone', 0, -.14, 0, 17.8, 96);
cylinder(17.65, .07, 'grass', 0, .015, 0, 17.65, 96);
ring(16.75, 17.63, .067, 'pavement');
curb(17.6, .18, .02, .16, 'ivory');
curb(16.77, .14, .025, .14, 'limestone');
for (let i=0;i<56;i++) {
  const a=i/56*Math.PI*2;
  box(.026,.64,.014,'pavement', Math.sin(a)*17.89,-.86,Math.cos(a)*17.89,a);
}

// Ring road. Its geometry and road markings are prebuilt, not recomputed each frame.
ring(12.2,15.4,.10,'asphalt');
ring(12.25,12.30,.111,'markings'); ring(15.27,15.32,.111,'markings');
curb(12.13,.18,.04,.2,'ivory'); curb(15.48,.18,.04,.2,'ivory');
for(let i=0;i<72;i++) {
  const a=i/72*Math.PI*2;
  // Break the dashed centre line at the arrival intersection.
  if (a<.095 || a>Math.PI*2-.095) continue;
  box(.065,.012,.47,'markings',Math.sin(a)*13.8,.118,Math.cos(a)*13.8,Math.PI/2+a);
}
ring(9.92,10.88,.073,'pavement');
curb(9.88,.12,.03,.11,'limestone'); curb(10.91,.12,.03,.11,'limestone');
ring(11.07,11.18,.074,'grass');

// The south arrival bridge: stone deck, warm handrails, visible piers and bridge joints.
slab(4.3,.43,7.7,'limestone',0,-.115,20.03,.12);
box(3.15,.04,10.4,'asphalt',0,.12,18.0);
for(const x of [-1.83,1.83]) {
  box(.48,.16,7.65,'pavement',x,.18,20.03);
  box(.12,.11,7.65,'gold',x,.96,20.03);
  box(.08,.05,7.65,'ivory',x,.54,20.03);
  for(let z=16.5;z<24;z+=.95) box(.11,.74,.11,'ivory',x,.55,z);
}
for(const z of [18.3,22.1]) {
  slab(3.15,2.4,.66,'limestone',0,-1.36,z,.18);
  box(4,.026,.07,'graphite',0,.126,z);
}
for(let z=16.2;z<23.5;z+=1.25) box(.065,.012,.56,'markings',0,.151,z);
for(const x of [-1.39,1.39]) box(.06,.012,10.3,'markings',x,.151,18.0);
// Crosswalk is over the ring road, leaving the driving lane continuous.
for (let z=12.45;z<15.2;z+=.40) box(2.72,.014,.18,'markings',0,.13,z);
slab(3.3,.08,2.5,'pavement',0,.085,11.05,.3);

// Plaza, subtle paving joints and terraced front steps.
slab(13,.08,7.6,'pavement',0,.075,5.85,1.8);
for(let x=-5;x<=5;x+=1.25) box(.025,.012,5.5,'limestone',x,.124,5.35);
for(let z=3;z<=8;z+=1.2) box(10.7,.012,.025,'limestone',0,.124,z);
slab(12.4,.25,9.8,'limestone',0,.18,-2,.8);
slab(12,.16,9.4,'ivory',0,.37,-2,.75);
for(let i=0;i<3;i++) slab(5.2,.13,1.45-i*.3,'limestone',0,.16+i*.12,3.45-i*.15,.16);

// Three coherent, rounded curtain-wall storeys; upper floors step back into gardens.
const floors = [
  {w:11.1,d:8.1,z:-2,y:.53,h:2.65},
  {w:9.95,d:7.2,z:-2.38,y:3.36,h:2.50},
  {w:8.7,d:6.2,z:-2.80,y:6.05,h:2.34},
];
// Extruded slabs gain .045 bevel beyond their nominal footprint. Lit inserts must
// sit outside that surface and stay on the straight frontage before the corners.
const glassBevel = .045, panePlane = .076, paneHalfWidth = .475;
if (panePlane - .006 <= glassBevel) throw new Error('Illuminated panes would be buried inside the glass shell.');
for (let floor=0;floor<floors.length;floor++) {
  const f=floors[floor];
  slab(f.w+.54,.22,f.d+.50,'ivory',0,f.y,f.z,.84);
  slab(f.w,f.h,f.d,'glass',0,f.y+f.h/2+.12,f.z,.70);
  slab(f.w+.46,.21,f.d+.42,'ivory',0,f.y+f.h+.18,f.z,.82);
  slab(f.w+.51,.065,f.d+.47,'gold',0,f.y+f.h+.305,f.z,.86);
  // Glazing bay rhythm, generous cream piers and warmer lit panes.
  for(const side of [-1,1]) {
    const z=f.z+side*(f.d/2+.026);
    for(let x=-f.w/2+.90;x<f.w/2-.5;x+=1.18) {
      box(.055,f.h-.06,.065,'gold',x,f.y+f.h/2+.12,z);
      if ((Math.round((x+9)*10)+floor)%3===0 && Math.abs(x+.50)+paneHalfWidth < f.w/2-.70) box(.95,1.82,.012,'city-night-glass',x+.50,f.y+f.h/2+.12,f.z+side*(f.d/2+panePlane));
    }
    box(f.w-1.36,.05,.075,'graphite',0,f.y+1.08,z);
    for(const x of [-f.w/2+.47,f.w/2-.47]) slab(.30,f.h+.12,.24,'ivory',x,f.y+f.h/2+.12,z,.05);
  }
  for(const side of [-1,1]) {
    const x=side*(f.w/2+.026);
    for(let z=f.z-f.d/2+.84;z<f.z+f.d/2-.6;z+=1.2) {
      box(.065,f.h-.06,.055,'gold',x,f.y+f.h/2+.12,z);
      if (Math.round(z*10)%3===0 && Math.abs(z+.50-f.z)+.485 < f.d/2-.70) box(.012,1.84,.97,'city-night-glass',side*(f.w/2+panePlane),f.y+f.h/2+.12,z+.5);
    }
    box(.075,.05,f.d-1.36,'graphite',x,f.y+1.08,f.z);
  }
}
// Stone service core and roof terrace prevent a featureless glass office block.
slab(2.15,5.46,1.24,'limestone',3.48,3.11,-5.36,.22);
for(let i=0;i<8;i++) box(1.96,.07,.085,'ivory',3.48,.78+i*.66,-4.68);
slab(7.92,.12,5.5,'graphite',0,8.57,-2.8,.65);
slab(6.93,.08,4.55,'pavement',0,8.68,-2.8,.53);
slab(2.28,.66,2.34,'ivory',-2.2,8.98,-3.7,.34);
slab(2.43,.12,2.49,'gold',-2.2,9.36,-3.7,.36);
// Rooftop pergola with open beams and planted edges.
for(const x of [.6,3.06]) for(const z of [-4.63,-1.0]) cylinder(.06,.83,'gold',x,9.14,z,.06,8);
for(let z=-4.7;z<=-.8;z+=.36) slab(2.74,.07,.13,'timber',1.84,9.6,z,.03);
for(const x of [.55,3.12]) box(.10,.13,4.07,'ivory',x,9.55,-2.76);

// Welcoming entrance: inset doors, floating canopy, brass columns and a luminous strip.
slab(3.48,2.31,.10,'graphite',0,1.64,2.087,.11);
for(const x of [-.61,.61]) {
  box(1.12,1.92,.045,'glass',x,1.45,2.164);
  box(.035,1.92,.05,'gold',x+.53,1.45,2.2);
  box(.045,.56,.07,'ivory',x+Math.sign(x)*-.34,1.45,2.245);
}
slab(5.3,.22,1.84,'ivory',0,2.95,2.7,.38);
box(4.48,.055,.06,'city-night-lights',0,2.82,3.47);
for(const x of [-2.24,2.24]) cylinder(.067,2.28,'gold',x,1.69,3.31,.067,12);
slab(3.62,.59,.13,'graphite',0,3.46,1.82,.15);

// Original geometric CRM lettering on the facade. No imported font licence.
function stroke(ax,ay,bx,by,z, width=.064) {
  const len=Math.hypot(bx-ax,by-ay);
  const g=new THREE.BoxGeometry(width,len,.026);
  add(g,'ivory',(ax+bx)/2,(ay+by)/2,z,[0,0,-Math.atan2(bx-ax,by-ay)]);
}
const sy=3.47, sz=1.909;
const glyphs = [
  [[.30,.20],[0,.20],[0,-.20],[.30,-.20]],
  [[0,-.20],[0,.20],[.28,.20],[.28,0],[0,0],[.32,-.20]],
  [[0,-.20],[0,.20],[.20,-.03],[.4,.20],[.4,-.20]],
];
glyphs.forEach((points,i)=>{for(let p=1;p<points.length;p++)stroke(points[p-1][0]+i*.60-.82,points[p-1][1]+sy,points[p][0]+i*.60-.82,points[p][1]+sy,sz);});

function planter(x,z,w=.8,d=.75,y=.12) {
  slab(w,.35,d,'limestone',x,y+.16,z,.12);
  slab(w*.87,.09,d*.84,'graphite',x,y+.36,z,.10);
  leaf(w*.42,'foliage',x,y+.65,z,1,.83,d/w);
  leaf(w*.20,'foliageLight',x+.1,y+.82,z-.04,1,.8,1);
}
// Planted ledges and outdoor lounges on the two setbacks.
for(let x=-4.85;x<=4.9;x+=1.2) planter(x,1.50,1.04,.55,3.11);
for(let x=-4.25;x<=4.3;x+=1.08) planter(x,.52,.94,.57,5.8);
for(let x=-3.5;x<=3.6;x+=1.3) planter(x,-.25,1.13,.59,8.62);
for(const x of [-3.83,3.83]) for(let z=-4.7;z<-.7;z+=1.45) planter(x,z,.6,1.04,8.61);
for(const x of [-4.95,4.95]) planter(x,3.83,1.27,1.25);

function bench(x,z,angle=0,y=.14) {
  const local=(lx,ly,lz)=>[x+lx*Math.cos(angle)+lz*Math.sin(angle),y+ly,z-lx*Math.sin(angle)+lz*Math.cos(angle)];
  for(const lx of [-.49,.49]) { let p=local(lx,.24,0);box(.09,.48,.49,'graphite',...p,angle);p=local(lx,.52,-.21);box(.08,.64,.08,'graphite',...p,angle); }
  for(const lz of [-.16,0,.16]) {const p=local(0,.48,lz);slab(1.31,.07,.12,'timber',...p,.025,angle);}
  for(const ly of [.70,.86]) {const p=local(0,ly,-.23);slab(1.31,.11,.07,'timber',...p,.025,angle);}
}
function lamp(x,z,height=2.30) {
  cylinder(.15,.13,'limestone',x,.20,z,.14,12);
  cylinder(.045,height,'graphite',x,height/2+.23,z,.035,10);
  cylinder(.24,.10,'gold',x,height+.24,z,.21,12);
  cylinder(.15,.18,'city-night-lights',x,height+.10,z,.15,12);
  cylinder(.27,.065,'graphite',x,height+.32,z,.18,12);
}
function tree(x,z,s=1,tall=false,seed=0) {
  cylinder(.67*s,.095,'limestone',x,.16,z,.65*s,16);
  cylinder(.56*s,.03,'graphite',x,.23,z,.56*s,16);
  cylinder(.10*s,1.8*s,'timber',x,.3+.90*s,z,.065*s,8);
  if(tall) {
    for(let i=0;i<3;i++) {
      const r=(.83-i*.17)*s,h=(1.8-i*.25)*s;
      add(new THREE.ConeGeometry(r,h,9),i%2?'foliage':'foliageDark',x,.72*s+i*.52*s+h/2,z,[0,seed*.4,0]);
    }
  } else {
    leaf(.89*s,seed%3?'foliage':'foliageLight',x,2.2*s,z,1,1.2,.88);
    leaf(.66*s,'foliageLight',x-.20*s,2.92*s,z+.02*s,.82,.93,.80);
    leaf(.53*s,'foliageDark',x+.42*s,2.1*s,z+.04*s,.78,.95,.77);
  }
}

// Waterfront boulevard: a controlled silhouette with breathing room around the building.
for(let i=0;i<27;i++) {
  const a=(i+.42)/27*Math.PI*2;
  if(Math.cos(a)>.94) continue;
  tree(Math.sin(a)*16.1,Math.cos(a)*16.1,.63+(i%4)*.045,i%4===1,i);
}
for(let i=0;i<12;i++) {
  const a=(i+.2)/12*Math.PI*2;
  if(Math.cos(a)>.76) continue;
  const x=Math.sin(a)*8.85,z=Math.cos(a)*8.85;
  tree(x,z,.78+(i%3)*.06,i%4===2,i);
}
// Low green beds define the plaza without crowding the route to the door.
for(const side of [-1,1]) {
  slab(1.32,.16,3.6,'limestone',side*5.38,.17,6.33,.51);
  slab(1.13,.06,3.39,'grass',side*5.38,.29,6.33,.46);
  for(let z=5.23;z<8;z+=.63)leaf(.44,'foliage',side*5.38,.64,z,1,.78,1);
  bench(side*3.64,7.42,side*-Math.PI/2);
  lamp(side*3.97,4.10); lamp(side*3.82,9.20,1.9);
  for(let z=4.65;z<7.1;z+=.65) {
    leaf(.12,'terracotta',side*5.22,.9,z,1,.6,1);
    leaf(.095,'gold',side*5.52,.92,z+.15,1,.65,1);
  }
}
for(let i=0;i<10;i++) {
  const a=(i+.5)/10*Math.PI*2;
  const x=Math.sin(a)*11.52,z=Math.cos(a)*11.52;
  lamp(x,z,2.08);
  if(i%2===0)bench(Math.sin(a)*9.20,Math.cos(a)*9.20,Math.PI+a);
}
for(const x of [-2.53,2.53])lamp(x,16.0,2.35);

// Circular water feature / luminous Puls sculpture anchors the public square.
cylinder(1.61,.17,'limestone',0,.23,7.4,1.61,48);
cylinder(1.47,.13,'ivory',0,.36,7.4,1.47,48);
cylinder(1.30,.015,'water',0,.434,7.4,1.30,48);
cylinder(.48,.43,'limestone',0,.66,7.4,.39,32);
cylinder(.39,.065,'gold',0,.90,7.4,.39,32);
add(new THREE.TorusGeometry(.52,.07,7,32),'gold',0,1.5,7.4,[0,.20,0]);
tube([[-.38,1.5,7.44],[-.15,1.5,7.44],[-.05,1.72,7.44],[.08,1.25,7.44],[.19,1.5,7.44],[.4,1.5,7.44]],.042,'city-night-lights',20);

// Discreet waterfront details, marina bollards and curved balustrade segments.
for(let i=0;i<30;i++) {
  const a=(i+.5)/30*Math.PI*2;
  if(Math.cos(a)>.97) continue;
  const x=Math.sin(a)*17.55,z=Math.cos(a)*17.55;
  cylinder(.038,.53,'graphite',x,.43,z,.038,6);
}
for(const start of [.24,Math.PI+.1]) {
  const pts=[];
  for(let i=0;i<=30;i++) {const a=start+i/30*(Math.PI-.36);pts.push([Math.sin(a)*17.55,.71,Math.cos(a)*17.55]);}
  tube(pts,.033,'gold',64);
}
for(const side of [-1,1]) {
  slab(1.02,.39,.58,'graphite',side*7.56,.34,4.12,.11);
  box(.74,.06,.06,'city-night-lights',side*7.56,.59,4.43);
  for(const z of [5.05,5.72])cylinder(.09,.30,'gold',side*7.69,.28,z,.10,10);
}

// Merge once during authoring. The browser receives seventeen static meshes.
let vertices=0, triangles=0;
for(const [name, geometries] of parts) {
  const merged=mergeGeometries(geometries);
  const geometry=mergeVertices(merged,1e-4);
  merged.dispose(); for(const g of geometries)g.dispose();
  // Byte vertex colours reduce the download while preserving ambient shading.
  const source=geometry.getAttribute('color');
  const colors=new Uint8Array(source.count*3);
  for(let i=0;i<colors.length;i++)colors[i]=Math.round(Math.min(1,source.array[i])*255);
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3,true));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,mat[name]);
  mesh.name=name.startsWith('city-night')?name:`island-${name}`;
  mesh.castShadow=name!=='water'&&name!=='markings';mesh.receiveShadow=true;
  scene.add(mesh);vertices+=geometry.attributes.position.count;triangles+=(geometry.index?.count??geometry.attributes.position.count)/3;
}
const label=new THREE.Object3D();label.name='crm-label-anchor';label.position.set(0,10.1,-2.0);scene.add(label);
const entrance=new THREE.Object3D();entrance.name='crm-entrance-anchor';entrance.position.set(0,.55,3.8);scene.add(entrance);
const bounds=new THREE.Box3().setFromObject(scene);
scene.userData.anchors={ label:label.position.toArray(), entrance:entrance.position.toArray(), buildingCenter:[0,0,-2] };
scene.userData.routes={ taxiRadius:13.8,taxiSurfaceY:.11,pedestrianRadius:10.4,pedestrianSurfaceY:.083 };
scene.userData.building={storeys:3,stage:'completed-pilot',dynamicStageVariants:false};
const rawGlb=await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true});
const glb=await compressGlb(Buffer.from(rawGlb));
await mkdir(outDir,{recursive:true});
await writeFile(new URL('crm-island.glb',outDir),Buffer.from(glb));
const manifest={
  name:'Puls CRM Harbour — City V3 pilot',
  asset:'/city/v3-pilot/crm-island.glb',
  version:1, licence:'Original project artwork; no external art assets',
  generatedBy:'node scripts/city-v3/build-island.mjs',
  bytes:glb.byteLength,uncompressedBytes:rawGlb.byteLength,compression:'EXT_meshopt_compression',meshes:parts.size,materials:parts.size,vertices,triangles,sourceObjects,
  bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},
  anchors:scene.userData.anchors,routes:scene.userData.routes,
  waterLevel:-.65,nightMaterials:['city-night-glass','city-night-lights'],
  notes:['No texture downloads. Geometry is merged offline per material.','Static architectural pilot; five progression stages are not claimed.','Ambient vertex shading is artistic, not a physically baked lightmap.','Bridge extends to +Z; water and moving actors are supplied by the application.'],
};
await writeFile(new URL('manifest.json',outDir),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
console.log(`Wrote ${fileURLToPath(new URL('crm-island.glb',outDir))}`);

/** Standards-compliant required meshopt extension with no duplicate fallback payload. */
async function compressGlb(input) {
  await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);
  const jsonLength=input.readUInt32LE(12);
  const json=JSON.parse(input.subarray(20,20+jsonLength).toString());
  const binary=input.subarray(28+jsonLength);
  const chunks=[];let offset=0;
  const fallbackLength=json.buffers[0].byteLength;
  for(let i=0;i<json.bufferViews.length;i++) {
    const view=json.bufferViews[i];
    const accessor=json.accessors.find(item=>item.bufferView===i);
    const bytesPerIndex=accessor.componentType===5125?4:2;
    const stride=view.target===34963?bytesPerIndex:view.byteStride;
    const count=accessor.count;
    const mode=view.target===34963?'TRIANGLES':'ATTRIBUTES';
    const source=binary.subarray(view.byteOffset,view.byteOffset+view.byteLength);
    // Exponent filtering reduces float entropy at sub-millimetre precision at this scale.
    const filter=mode==='ATTRIBUTES'&&accessor.componentType===5126?'EXPONENTIAL':undefined;
    const filtered=filter?MeshoptEncoder.encodeFilterExp(new Float32Array(source.buffer,source.byteOffset,source.byteLength/4),count,stride,18,'SharedComponent'):source;
    const encoded=MeshoptEncoder.encodeGltfBuffer(filtered,count,stride,mode);
    const decoded=new Uint8Array(count*stride);
    MeshoptDecoder.decodeGltfBuffer(decoded,count,stride,encoded,mode,filter);
    if(!filter&&mode!=='TRIANGLES'&&!Buffer.from(decoded).equals(source))throw new Error(`meshopt roundtrip failed for buffer view ${i}`);
    if(filter) {
      const before=new Float32Array(source.buffer,source.byteOffset,source.byteLength/4);
      const after=new Float32Array(decoded.buffer);
      let maxError=0;for(let j=0;j<before.length;j++)maxError=Math.max(maxError,Math.abs(before[j]-after[j]));
      if(maxError>.002)throw new Error(`Quantization error ${maxError} in buffer view ${i}`);
    }
    // TRIANGLES may cyclically rotate vertices, which preserves winding and appearance.
    if(mode==='TRIANGLES') {
      const ArrayType=stride===2?Uint16Array:Uint32Array;
      const before=new ArrayType(source.buffer,source.byteOffset,count),after=new ArrayType(decoded.buffer);
      for(let j=0;j<count;j+=3)if(![0,1,2].some(shift=>[0,1,2].every(k=>before[j+k]===after[j+(k+shift)%3])))throw new Error(`Triangle mismatch ${i}:${j}`);
    }
    const extension={buffer:0,byteOffset:offset,byteLength:encoded.byteLength,byteStride:stride,count,mode};
    if(filter)extension.filter=filter;
    view.extensions={EXT_meshopt_compression:extension};view.buffer=1;
    chunks.push(Buffer.from(encoded));offset+=encoded.byteLength;
    const padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding;}
  }
  json.buffers=[{byteLength:offset},{byteLength:fallbackLength,extensions:{EXT_meshopt_compression:{fallback:true}}}];
  json.extensionsUsed=[...new Set([...(json.extensionsUsed??[]),'EXT_meshopt_compression'])];
  json.extensionsRequired=[...new Set([...(json.extensionsRequired??[]),'EXT_meshopt_compression'])];
  const encodedJson=Buffer.from(JSON.stringify(json));
  const jsonPad=Buffer.alloc((4-encodedJson.length%4)%4,0x20);
  const binaryOut=Buffer.concat(chunks);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);
  header.writeUInt32LE(28+encodedJson.length+jsonPad.length+binaryOut.length,8);
  header.writeUInt32LE(encodedJson.length+jsonPad.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binaryOut.length,0);binHeader.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,encodedJson,jsonPad,binHeader,binaryOut]);
}
