import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {MODELS,buildModel} from './models/registry.js';

const $=id=>document.getElementById(id);
const categoryNames={cars:'Легковой автомобиль',trucks:'Грузовой автомобиль',boats:'Катер',yachts:'Яхта'};
const categoryPaths={
  cars:'M3 22h42l-2-8-8-2-7-8H15l-5 8-7 2ZM10 13h24M15 7h11m-13 17a4 4 0 1 0 0 .1m25-.1a4 4 0 1 0 0 .1',
  trucks:'M2 5h27v20H2ZM29 12h10l7 8v5H29ZM33 15h5l5 6H33M10 26a4 4 0 1 0 0 .1m28-.1a4 4 0 1 0 0 .1',
  boats:'M3 19h42l-10 9H11ZM14 18l3-9h12l6 9M21 9V4m0 1h8M4 32q5-4 10 0t10 0 10 0 10 0',
  yachts:'M3 24h42l-9 8H11ZM23 23V2L5 21h16m5-16 13 16H26M7 36q5-3 10 0t10 0 10 0',
};
let filter='all',search='',selectedId=null,inventory={};
let renderer,scene,camera,controls,currentGroup,metrics,contact,ground,ambient,sun,rim;
let dirty=true,dark=false,currentView='beauty',transition=null,toastTimer;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile=()=>innerWidth<=760;
const formatter=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});

function icon(category){return `<svg class="model-icon" viewBox="0 0 50 38" aria-hidden="true"><path d="${categoryPaths[category]}"/></svg>`;}
function filteredModels(){const q=search.trim().toLocaleLowerCase('ru');return MODELS.filter(m=>(filter==='all'||m.category===filter)&&(!q||`${m.name} ${m.type} ${m.description}`.toLocaleLowerCase('ru').includes(q)));}
function renderList(){
  const list=filteredModels();
  $('model-list').innerHTML=list.map(m=>`<button class="model-item" data-model="${m.id}" aria-pressed="${m.id===selectedId}">${icon(m.category)}<span class="model-text"><strong>${m.name}</strong><small>${m.type}</small></span><span class="item-index">${String(MODELS.indexOf(m)+1).padStart(2,'0')}</span></button>`).join('');
  $('empty').hidden=list.length>0;
  $('model-list').hidden=list.length===0;
  $('result-count').textContent=`${list.length} ${list.length===1?'МОДЕЛЬ':list.length>=2&&list.length<=4?'МОДЕЛИ':'МОДЕЛЕЙ'}`;
  document.querySelectorAll('[data-model]').forEach(button=>button.addEventListener('click',()=>showModel(button.dataset.model)));
}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3000);}
function disposeGroup(group){
  const geometries=new Set(),materials=new Set();
  group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>{for(const value of Object.values(m))if(value?.isTexture)value.dispose();m.dispose();});
}
function modelMetrics(group){
  group.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(group),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  let triangles=0;
  group.traverse(o=>{if(o.isMesh){const count=o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count;triangles+=count/3*(o.isInstancedMesh?o.count:1);}});
  return{box,size,center,triangles:Math.round(triangles)};
}
function updateDownload(){
  const item=inventory[selectedId];
  $('download').href=`./assets/${selectedId}.glb`;
  $('download').download=`${selectedId}.glb`;
  $('download-size').textContent=item?.bytes?`${formatter.format(item.bytes/1048576)} МБ · GLB`:'Геометрия и материалы';
}
function showModel(id){
  const item=MODELS.find(m=>m.id===id);if(!item)return;
  try{
    const next=buildModel(THREE,id);
    if(currentGroup){scene.remove(currentGroup);disposeGroup(currentGroup);}
    currentGroup=next;scene.add(currentGroup);metrics=modelMetrics(currentGroup);selectedId=id;
    const number=String(MODELS.indexOf(item)+1).padStart(2,'0');
    $('model-name').textContent=item.name;$('model-description').textContent=item.description;
    $('category-label').textContent=categoryNames[item.category].toLocaleUpperCase('ru');
    $('model-number').textContent=`${number} / 20`;$('nav-count').textContent=`${number} — 20`;
    $('dim-length').textContent=`${formatter.format(metrics.size.x)} м`;
    $('dim-width').textContent=`${formatter.format(metrics.size.z)} м`;
    $('dim-height').textContent=`${formatter.format(metrics.size.y)} м`;
    $('triangle-count').textContent=new Intl.NumberFormat('ru-RU').format(metrics.triangles);
    updateDownload();renderList();
    const scale=metrics.size.length();
    contact.position.set(metrics.center.x,metrics.box.min.y-.004,metrics.center.z);
    contact.scale.set(Math.max(metrics.size.x*1.3,.4),Math.max(metrics.size.z*1.6,.4),1);
    ground.position.y=metrics.box.min.y-.012;
    sun.position.copy(metrics.center).add(new THREE.Vector3(-2,3.5,2).multiplyScalar(scale));
    sun.target.position.copy(metrics.center);
    sun.shadow.camera.left=-scale;sun.shadow.camera.right=scale;sun.shadow.camera.top=scale;sun.shadow.camera.bottom=-scale;
    sun.shadow.camera.near=.01;sun.shadow.camera.far=scale*10;
    sun.shadow.normalBias=scale*.0005;sun.shadow.bias=-.0001;sun.shadow.camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate=true;
    camera.near=Math.max(.01,scale/150);camera.far=scale*150;camera.updateProjectionMatrix();
    controls.minDistance=scale*.15;controls.maxDistance=scale*12;
    setView('beauty',true);
    const url=new URL(location.href);url.searchParams.set('model',id);history.replaceState(null,'',url);
    dirty=true;
    return currentGroup;
  }catch(error){console.error(error);toast('Не удалось загрузить эту модель.');}
}
function studioEnvironment(){
  const studio=new THREE.Scene();studio.background=new THREE.Color(0x9ba7a8);
  const panel=(color,intensity,position,dimensions)=>{
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(...dimensions),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));
    mesh.material.color.multiplyScalar(intensity);mesh.position.set(...position);mesh.lookAt(0,0,0);studio.add(mesh);
  };
  panel(0xfff3df,4.0,[-8,10,6],[9,15]);panel(0xe1f0ff,2.8,[10,5,-5],[6,12]);panel(0xffffff,2.4,[0,13,0],[15,9]);
  panel(0xf3f7ee,1.2,[0,1,12],[17,3]);
  const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(studio,.035);
  scene.environment=environment.texture;
  studio.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});pmrem.dispose();
}
function initialize(){
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
  $('viewport').appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-hidden','true');
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(36,1,.01,3000);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;
  controls.minPolarAngle=.015;controls.maxPolarAngle=Math.PI*.495;controls.autoRotateSpeed=.65;controls.panSpeed=.6;controls.rotateSpeed=.55;
  controls.listenToKeyEvents($('viewport'));
  controls.addEventListener('change',()=>{dirty=true;});
  controls.addEventListener('start',()=>{transition=null;currentView=null;});
  ambient=new THREE.HemisphereLight(0xe6efff,0x9b9780,1.65);scene.add(ambient);
  sun=new THREE.DirectionalLight(0xffefdc,3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);scene.add(sun,sun.target);
  rim=new THREE.DirectionalLight(0xcfe5ff,1.6);rim.position.set(4,8,-12);scene.add(rim);
  studioEnvironment();
  ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.ShadowMaterial({color:0x34473f,opacity:.16}));
  ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(128,128,8,128,128,128);
  gradient.addColorStop(0,'rgba(31,48,36,.20)');gradient.addColorStop(.55,'rgba(31,48,36,.09)');gradient.addColorStop(1,'rgba(31,48,36,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,256,256);
  contact=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false}));
  contact.rotation.x=-Math.PI/2;scene.add(contact);
  resize();
  const initial=new URL(location.href).searchParams.get('model');showModel(MODELS.some(m=>m.id===initial)?initial:MODELS[0].id);
  window.__transport={MODELS,buildModel:id=>buildModel(THREE,id),showModel,setView,renderer,scene,camera,controls,get group(){return currentGroup;},get metrics(){return metrics;},get selectedId(){return selectedId;}};
  renderer.setAnimationLoop(animate);
  requestAnimationFrame(()=>$('loading').remove());
}
function fitPosition(direction){
  const dir=new THREE.Vector3(...direction).normalize(),right=new THREE.Vector3(0,1,0).cross(dir).normalize(),up=dir.clone().cross(right).normalize();
  const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  let distance=metrics.size.length()*.5;
  const box=metrics.box,center=metrics.center;
  for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z]){
    const v=new THREE.Vector3(x,y,z).sub(center),depth=v.dot(dir);
    distance=Math.max(distance,Math.abs(v.dot(right))/(tan*camera.aspect*.86)+depth,Math.abs(v.dot(up))/(tan*(mobile()?.55:.59))+depth);
  }
  return center.clone().addScaledVector(dir,distance*1.04);
}
const directions={beauty:[1.3,.65,1.6],side:[0,.12,1],front:[1,.13,0],top:[.001,1,.001]};
function setView(name,immediate=false){
  if(!metrics)return;currentView=name;
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));
  const position=fitPosition(directions[name]);
  if(immediate||reducedMotion){camera.position.copy(position);controls.target.copy(metrics.center);controls.update();dirty=true;return;}
  transition={start:performance.now(),from:camera.position.clone(),fromTarget:controls.target.clone(),to:position,toTarget:metrics.center.clone()};
}
function resize(){
  if(!renderer)return;
  const w=$('viewport').clientWidth,h=$('viewport').clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();
  if(metrics)setView(currentView||'beauty',true);dirty=true;
}
function animate(time){
  if(transition){const t=Math.min(1,(time-transition.start)/750),e=t*t*(3-2*t);camera.position.lerpVectors(transition.from,transition.to,e);controls.target.lerpVectors(transition.fromTarget,transition.toTarget,e);if(t===1)transition=null;dirty=true;}
  const moved=controls.update();if(moved||dirty){renderer.render(scene,camera);dirty=false;}
}
function stepModel(offset){const list=filteredModels();if(!list.length)return;let i=list.findIndex(m=>m.id===selectedId);i=(i+offset+list.length)%list.length;showModel(list[i].id);document.querySelector(`[data-model="${list[i].id}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});}
$('search').addEventListener('input',event=>{search=event.target.value;renderList();});
$('clear-search').addEventListener('click',()=>{search='';filter='all';$('search').value='';document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category==='all')));renderList();});
document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.category;document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderList();const list=filteredModels();if(list.length&&!list.some(m=>m.id===selectedId))showModel(list[0].id);}));
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('next').addEventListener('click',()=>stepModel(1));$('previous').addEventListener('click',()=>stepModel(-1));
$('reset').addEventListener('click',()=>{controls.autoRotate=false;$('rotate').setAttribute('aria-pressed','false');setView('beauty');});
$('rotate').addEventListener('click',()=>{controls.autoRotate=!controls.autoRotate;$('rotate').setAttribute('aria-pressed',String(controls.autoRotate));});
$('theme').addEventListener('click',()=>{dark=!dark;document.body.classList.toggle('dark',dark);$('theme').setAttribute('aria-pressed',String(dark));ambient.intensity=dark?1.1:1.65;sun.intensity=dark?2.3:3;scene.environmentIntensity=dark?.8:1;ground.material.opacity=dark?.3:.16;dirty=true;});
$('about').addEventListener('click',()=>$('about-dialog').showModal());$('close-about').addEventListener('click',()=>$('about-dialog').close());
$('about-dialog').addEventListener('click',e=>{if(e.target!==$('about-dialog'))return;const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();});
addEventListener('resize',resize);
addEventListener('keydown',e=>{if(e.key==='/'&&e.target.tagName!=='INPUT'){e.preventDefault();$('search').focus();}});
renderList();
fetch('./inventory.json').then(r=>r.ok?r.json():{}).then(data=>{inventory=Object.fromEntries((data.models||[]).map(m=>[m.id,m]));if(selectedId)updateDownload();}).catch(()=>{});
try{initialize();}catch(error){console.error(error);$('loading').innerHTML='<div style="padding:30px;max-width:360px;text-align:center;line-height:1.8">Для 3D-просмотра нужен браузер с WebGL 2 и аппаратным ускорением. Файлы моделей доступны для скачивания.</div>';}
