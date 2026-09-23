import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const built = await build({entryPoints:[fileURLToPath(new URL('./cityInteraction.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const { layoutCityLabels, LABEL_STEM } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

// Building tops of the five districts, as placed by the 3D scene.
const tops=[[-5.6,3.6,.6],[-2.2,2.3,-5.4],[4.6,5.4,-2.8],[4.8,4.4,4.2],[-1.8,3.1,5.8]];

function project(w,h,azimuth,polar,distance,target=[0,0,0]) {
  const camera=new THREE.PerspectiveCamera(w<480?50:36,w/h,.5,200);
  const offset=new THREE.Vector3().setFromSpherical(new THREE.Spherical(distance,polar,azimuth));
  camera.position.set(...target).add(offset);camera.lookAt(new THREE.Vector3(...target));camera.updateMatrixWorld();camera.updateProjectionMatrix();
  return tops.map(([x,y,z],i)=>{const v=new THREE.Vector3(x,y,z);const depth=camera.position.distanceTo(v);v.project(camera);return{id:String(i),x:(v.x*.5+.5)*w,y:(-v.y*.5+.5)*h,depth};});
}

test('labels stay inside the map, never overlap and stay close to their building at every angle, tilt and zoom',()=>{
  for(const [w,h,size] of [[300,430,{width:148,height:44}],[390,430,{width:148,height:44}],[560,470,{width:176,height:50}],[760,580,{width:176,height:50}],[1100,580,{width:176,height:50}]]) {
    for(const distance of [18,31,52]) for(const polar of [.25,.92,1.3]) for(let degree=0;degree<360;degree+=15) {
      const anchors=project(w,h,degree*Math.PI/180,polar,distance);
      const layout=layoutCityLabels(anchors,w,h,size),visible=Object.values(layout).filter(l=>l.visible);
      const where=`${w}px d${distance} p${polar} ${degree}deg`;
      for(const l of visible){
        assert.ok(l.x-size.width/2>=0&&l.x+size.width/2<=w&&l.y-size.height/2>=0&&l.y+size.height/2<=h,`${where} bounds`);
        if(l.anchorX>size.width&&l.anchorX<w-size.width) assert.ok(Math.abs(l.x-l.anchorX)<=size.width*1.7,`${where} drifted sideways`);
      }
      for(let a=0;a<visible.length;a++)for(let b=a+1;b<visible.length;b++)
        assert.ok(Math.abs(visible[a].x-visible[b].x)>=size.width||Math.abs(visible[a].y-visible[b].y)>=size.height,`${where} overlap ${a}/${b}`);
    }
  }
});

test('an uncrowded label sits directly above its building',()=>{
  const layout=layoutCityLabels([{id:'a',x:400,y:300,depth:10}],800,600,{width:150,height:50});
  assert.equal(layout.a.x,400);assert.equal(layout.a.y,300-LABEL_STEM-25);assert.equal(layout.a.moved,false);
});

test('the nearer building keeps its spot and the farther label moves up, not across the map',()=>{
  const layout=layoutCityLabels([{id:'far',x:400,y:300,depth:30},{id:'near',x:410,y:305,depth:10}],800,600,{width:150,height:50});
  assert.equal(layout.near.moved,false);assert.ok(layout.far.y<layout.near.y);assert.ok(Math.abs(layout.far.x-400)<1);
});

test('labels whose building leaves the screen are hidden instead of pinned to the edge',()=>{
  const layout=layoutCityLabels([{id:'gone',x:-50,y:200,depth:10}],800,600,{width:150,height:50});
  assert.equal(layout.gone.visible,false);
});
