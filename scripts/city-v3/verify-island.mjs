/** Verify the shipped compressed resource through the production-compatible loader. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../frontend/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../frontend/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../../frontend/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';

const directory=new URL('../../frontend/public/city/v3-pilot/',import.meta.url);
const [bytes,manifestText]=await Promise.all([readFile(new URL('crm-island.glb',directory)),readFile(new URL('manifest.json',directory),'utf8')]);
const manifest=JSON.parse(manifestText);
assert.equal(bytes.byteLength,manifest.bytes);
assert.ok(bytes.byteLength<1_000_000,'The pilot art budget is 1 MB compressed.');
const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
let meshes=0,triangles=0,vertices=0;
const materials=new Set();
gltf.scene.traverse(object=>{
  if(!object.isMesh)return;
  meshes++;
  assert.ok(!Array.isArray(object.material),'Merged meshes use one material each.');
  materials.add(object.material.name);
  const geometry=object.geometry;
  const positions=geometry.getAttribute('position');
  vertices+=positions.count;
  assert.ok(geometry.index,'Geometry must be indexed.');
  triangles+=geometry.index.count/3;
  for(const semantic of ['position','normal','color']) {
    const attribute=geometry.getAttribute(semantic);
    assert.ok(attribute,`${object.name}: missing ${semantic}`);
    assert.equal(attribute.count,positions.count);
    for(let i=0;i<attribute.count;i++) {
      assert.ok(Number.isFinite(attribute.getX(i))&&Number.isFinite(attribute.getY(i))&&Number.isFinite(attribute.getZ(i)),`${object.name}: non-finite ${semantic}`);
    }
  }
  for(let i=0;i<geometry.index.count;i++)assert.ok(geometry.index.getX(i)<positions.count,`${object.name}: index out of range`);
});
assert.equal(meshes,manifest.meshes);assert.equal(vertices,manifest.vertices);assert.equal(triangles,manifest.triangles);
assert.ok(meshes<=25,'The static art budget is 25 draw calls.');
assert.ok(triangles<=75_000,'The pilot art budget is 75k triangles.');
assert.equal(materials.size,manifest.materials);
for(const name of manifest.nightMaterials) {
  assert.ok(materials.has(name));
  const mesh=gltf.scene.getObjectByName(name);
  assert.ok(mesh.material.emissive.getHex()>0,`${name}: missing emissive colour`);
}
for(const [name,expected] of [['crm-label-anchor',manifest.anchors.label],['crm-entrance-anchor',manifest.anchors.entrance]]) {
  const object=gltf.scene.getObjectByName(name);assert.ok(object,`Missing ${name}`);
  assert.deepEqual(object.position.toArray(),expected);
}
const bounds=new THREE.Box3().setFromObject(gltf.scene);
for(const field of ['min','max'])for(let axis=0;axis<3;axis++)assert.ok(Math.abs(bounds[field].getComponent(axis)-manifest.bounds[field][axis])<.002,'Decoded bounds differ from the authored geometry.');
console.log(`Verified CRM island: ${meshes} meshes / ${triangles.toLocaleString('en-US')} triangles / ${bytes.byteLength.toLocaleString('en-US')} bytes; finite geometry, anchors, emissive materials and budgets passed.`);
gltf.scene.traverse(object=>{if(object.isMesh){object.geometry.dispose();object.material.dispose();}});
