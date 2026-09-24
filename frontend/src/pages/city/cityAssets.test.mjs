import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

test('both self-contained operator models have a usable rig, idle and greeting within the download budget',async()=>{
  for(const gender of ['male','female']){
    const bytes=await readFile(new URL(`./models/operator-${gender}.glb`,import.meta.url));
    assert.ok(bytes.length<1024*1024);
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');
    assert.deepEqual(gltf.animations.map(a=>a.name).sort(),['Idle_Neutral','Wave']);
    assert.ok(gltf.scene.getObjectByName('Head'),'head bone for the headset');
    let skinned=0;gltf.scene.traverse(o=>{if(o.isSkinnedMesh){skinned++;assert.ok(o.skeleton.bones.length>10);}});assert.ok(skinned>0);
    const mixer=new THREE.AnimationMixer(gltf.scene);mixer.clipAction(gltf.animations[0]).play();mixer.update(.5);
    const bounds=new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    assert.ok(bounds.y>1 && bounds.y<3 && bounds.toArray().every(Number.isFinite));
    mixer.stopAllAction();
  }
});

test('every landmark level remains finite and batches facade detail into a small number of meshes',async()=>{
  const source=await build({entryPoints:[fileURLToPath(new URL('./cityArchitecture.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
  const {createArchitecture}=await import(`data:text/javascript;base64,${Buffer.from(source.outputFiles[0].text).toString('base64')}`);
  const previous=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},fillText(){}})})};
  try {
    const kit=createArchitecture();
    for(const id of ['academy','driver','crm','dispatch','oktell'])for(let level=1;level<=5;level++){
      const {group,height}=kit.landmark(id,level,id==='dispatch'||id==='oktell');
      let meshes=0,triangles=0;
      group.traverse(o=>{if(!o.isMesh)return;meshes++;const p=o.geometry.getAttribute('position');triangles+=p.count/3;assert.ok([...p.array].every(Number.isFinite));});
      assert.ok(height>2&&height<7);assert.ok(meshes<=25,`${id}: ${meshes} meshes`);assert.ok(triangles<45000,`${id}: ${triangles} triangles`);
    }
    kit.dispose();
  } finally {globalThis.document=previous;}
});
