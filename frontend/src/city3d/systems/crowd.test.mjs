import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: 'export * from "./crowd.ts"; export * from "../world/generate.ts"; export * from "../world/worldSpec.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
const city = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const worlds = [city.generateWorld(city.WORLD_V1), city.generateWorld(city.WORLD_X4)];
for (const world of worlds) test(`${world.spec.name}: walking loops stay on land, outside roads, parking and the maximum landmark footprint`, () => {
  const routes = city.createCrowdRoutes(world);
  assert.deepEqual(routes, city.createCrowdRoutes(world));
  for (const id of ['academy', 'driver', 'crm', 'dispatch', 'oktell']) assert.ok(routes.some(r => r.district === id), id);
  for (const route of routes) for (let step = 0; step < 120; step++) {
    const p = city.sampleCrowdRoute(route, route.length * step / 120), r = Math.hypot(p.x, p.z);
    assert.ok(Number.isFinite(p.heading));
    assert.ok(world.land.islets.some(i => Math.hypot(p.x-i.x,p.z-i.z) < i.r-.25) || world.land.annuli.some(a => r > a.inner+.25 && r < a.outer-.25));
    assert.ok(world.roads.rings.every(road => Math.abs(r-road) >= 1.25));
    assert.ok([...world.roads.streets, ...world.roads.bridges.map(b => b.road)].every(road => city.segmentDistance(p.x,p.z,road) >= 1.6));
    assert.ok(world.roads.parking.every(lot => !city.insideParking(p,lot,.25)));
    if (route.district) {
      const d = world.districts.find(d => d.id === route.district), yaw = Math.atan2(-d.x,-d.z), dx = p.x-d.x, dz = p.z-d.z;
      const x = dx*Math.cos(yaw)-dz*Math.sin(yaw), z = dx*Math.sin(yaw)+dz*Math.cos(yaw);
      assert.ok(Math.abs(x) > 2.85*world.spec.districtScale+.25 || Math.abs(z) > 3*world.spec.districtScale+.25);
    }
  }
});
function context({ mobile=false, reducedMotion=false }={}) {
  const frames=new Set(), moves=new Set(), qualities=new Set();
  const camera=new city.THREE.PerspectiveCamera(70,1.6,.1,1200); camera.position.set(0,90,1); camera.lookAt(0,0,0); camera.updateMatrixWorld();
  return { world: worlds[1], scene:new city.THREE.Scene(), camera, mobile, reducedMotion, quality:{ crowd:1, lodDistances:[40,120,300] },
    onFrame(f){frames.add(f);return()=>frames.delete(f);},onCameraMove(f){moves.add(f);return()=>moves.delete(f);},onQuality(f){qualities.add(f);return()=>qualities.delete(f);},
    frame(dt){frames.forEach(f=>f(dt,0));},get listeners(){return frames.size+moves.size+qualities.size;} };
}
test('population has a fixed rendering budget, pauses without a jump, respects reduced motion, and frees its resources', () => {
  for (const mobile of [false,true]) {
    const ctx=context({mobile,reducedMotion:true}), crowd=city.createCrowd(ctx), group=ctx.scene.getObjectByName('city-crowd');
    assert.ok(group.userData.population > 0 && group.userData.population <= (mobile?40:60));
    const batches=group.children.filter(m=>m.isInstancedMesh); assert.ok(batches.length <= 11);
    assert.ok(batches.every(m=>!m.castShadow));
    const matrices=()=>Array.from(group.getObjectByName('walker-jackets').instanceMatrix.array);
    const initial=matrices(); ctx.frame(.1); assert.deepEqual(matrices(),initial);
    crowd.setEnabled(true); ctx.frame(.1); assert.notDeepEqual(matrices(),initial);
    crowd.setEnabled(false); const paused=matrices(); ctx.frame(10); assert.deepEqual(matrices(),paused);
    crowd.setEnabled(true); ctx.frame(.01); assert.notDeepEqual(matrices(),paused);
    const resources=new Set(); group.traverse(m=>{if(m.isMesh){resources.add(m.geometry);for(const material of [m.material].flat())resources.add(material);}});
    const freed=new Set(); for(const r of resources)r.addEventListener('dispose',()=>freed.add(r));
    crowd.dispose(); assert.equal(freed.size,resources.size); assert.equal(ctx.listeners,0); assert.equal(ctx.scene.children.length,0);
  }
});
