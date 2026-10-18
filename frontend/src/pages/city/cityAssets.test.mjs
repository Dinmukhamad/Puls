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

test('every landmark level is a building of its own, taller than the last, on its island, in a few meshes',async()=>{
  const source=await build({entryPoints:[fileURLToPath(new URL('../../city3d/assets/landmarks.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
  const {createArchitecture}=await import(`data:text/javascript;base64,${Buffer.from(source.outputFiles[0].text).toString('base64')}`);
  const previous=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},fillText(){}})})};
  // The island's radius in the landmark's own units (world/worldSpec.ts: islet 7.2 at districtScale 1.75).
  const ISLAND=7.2/1.75;
  try {
    const kit=createArchitecture();
    for(const id of ['academy','driver','crm','dispatch','oktell','scenarios','voice']){
      let below=0;const shapes=new Set();
      for(let level=1;level<=5;level++){
        const {group,height}=kit.landmark(id,level,id==='oktell');
        let meshes=0,triangles=0,reach=0;
        group.traverse(o=>{if(!o.isMesh)return;meshes++;const p=o.geometry.getAttribute('position');triangles+=p.count/3;assert.ok([...p.array].every(Number.isFinite));
          for(let i=0;i<p.count;i++)reach=Math.max(reach,Math.hypot(p.getX(i),p.getZ(i)));});
        assert.ok(height>below,`${id} ${level}: ${height} is not taller than the level below (${below})`);below=height;
        assert.ok(height>1.5&&height<10,`${id} ${level}: ${height} high`);
        assert.ok(reach<ISLAND,`${id} ${level}: reaches ${reach.toFixed(2)} from the middle, past the island's edge`);
        assert.ok(meshes<=25,`${id} ${level}: ${meshes} meshes`);assert.ok(triangles<25000,`${id} ${level}: ${triangles} triangles`);
        shapes.add(`${triangles}:${height.toFixed(2)}`);
      }
      assert.equal(shapes.size,5,`${id}: every level a different building`);
    }
    kit.dispose();
  } finally {globalThis.document=previous;}
});
