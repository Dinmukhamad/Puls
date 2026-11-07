import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: 'export * from "./crowd.ts"; import { uniform } from "three/tsl"; export const uniformTime = uniform(0); export { DISTRICT_FACING } from "../engine/camera.ts"; export * from "../world/generate.ts"; export * from "../world/worldSpec.ts"; export * from "../world/railway.ts"; export * from "../world/sales.ts"; export * from "../world/stationSquare.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
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
      const d = world.districts.find(d => d.id === route.district), yaw = city.DISTRICT_FACING, dx = p.x-d.x, dz = p.z-d.z;
      const x = dx*Math.cos(yaw)-dz*Math.sin(yaw), z = dx*Math.sin(yaw)+dz*Math.cos(yaw);
      assert.ok(Math.abs(x) > 2.85*world.spec.districtScale+.25 || Math.abs(z) > 3*world.spec.districtScale+.25);
    }
  }
});
test('walkers stroll round the fountain in the park by each station', () => {
  const x4 = city.generateWorld(city.WORLD_X4); city.clearRailway(x4, x4.railway); city.addStationSquare(x4);
  for (const world of [x4, city.generateSalesWorld()]) {
    const fountain = city.stationSquare(world).placements.find(p => p.kind === 'fountain');
    const round = city.createCrowdRoutes(world).filter(r => r.points.every(p => Math.abs(Math.hypot(p.x - fountain.x, p.z - fountain.z) - 1.9) < .01));
    assert.equal(round.length, 1, world.spec.name);
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
    assert.ok(group.userData.population > (mobile?40:60) && group.userData.population <= (mobile?56:100), `population ${group.userData.population}`);
    // Every walker in one draw call (the step is drawn in the vertex shader), their contact shadows in another.
    const batches=group.children.filter(m=>m.geometry?.isInstancedBufferGeometry); assert.equal(batches.length, 2);
    assert.ok(batches.every(m=>!m.castShadow));
    const walkers=group.getObjectByName('city-crowd-walkers'), time=walkers.material.userData.walkTime;
    const matrices=()=>Array.from(walkers.geometry.getAttribute('copyMatrix0').data.array);
    const initial=matrices(), still=time.value; ctx.frame(.1); assert.deepEqual(matrices(),initial); assert.equal(time.value,still);
    crowd.setEnabled(true); ctx.frame(.1); assert.notDeepEqual(matrices(),initial); assert.ok(time.value>still,'the step moves on');
    crowd.setEnabled(false); const paused=matrices(), stopped=time.value; ctx.frame(10); assert.deepEqual(matrices(),paused); assert.equal(time.value,stopped,'and stands still while paused');
    crowd.setEnabled(true); ctx.frame(.01); assert.notDeepEqual(matrices(),paused);
    const resources=new Set(); group.traverse(m=>{if(m.isMesh){resources.add(m.geometry);for(const material of [m.material].flat())resources.add(material);}});
    const freed=new Set(); for(const r of resources)r.addEventListener('dispose',()=>freed.add(r));
    crowd.dispose(); assert.equal(freed.size,resources.size); assert.equal(ctx.listeners,0); assert.equal(ctx.scene.children.length,0);
  }
});
test('one walker body: still trunk and head, limbs marked for the shader\'s joints, a modest triangle budget, the old clothes by number', () => {
  const body = city.walkerGeometry(), part = body.getAttribute('aPart'), position = body.getAttribute('position');
  const bones = new Set(), slots = new Set(), lowest = new Map(), highest = new Map();
  for (let i = 0; i < part.count; i++) {
    const bone = part.getX(i), y = position.getY(i); bones.add(bone); slots.add(part.getY(i));
    lowest.set(bone, Math.min(lowest.get(bone) ?? Infinity, y)); highest.set(bone, Math.max(highest.get(bone) ?? -Infinity, y));
  }
  assert.deepEqual([...bones].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'trunk, both thighs, shins, feet, upper arms and forearms');
  assert.deepEqual([...slots].sort(), [0, 1, 2, 3, 4, 5], 'shirt, skin, trousers, hair, shoes, forearms');
  // The limbs reach from joint to joint (hip .71, knee .41, ankle .09; shoulder 1.17, elbow .92), the feet on the ground.
  for (const [bone, top, bottom] of [[1, .71, .41], [2, .41, .09], [7, 1.166, .921]]) assert.ok(Math.abs(highest.get(bone) - top) < .02 && Math.abs(lowest.get(bone) - bottom) < .02, `bone ${bone}: ${lowest.get(bone).toFixed(2)}–${highest.get(bone).toFixed(2)}`);
  assert.ok(lowest.get(3) >= 0 && lowest.get(3) < .01 && highest.get(0) > 1.5 && highest.get(0) < 1.65, 'feet on the ground, head at the old height');
  const triangles = position.count / 3;
  assert.ok(triangles < 1100, `${triangles} triangles a walker`);
  const shade = body.getAttribute('aShade');
  assert.equal(shade.count, position.count);
  assert.ok(Array.from(shade.array).every(v => Number.isFinite(v) && v >= .45 && v <= 1));
  assert.ok(Math.min(...shade.array) < .55, 'soles and collar carry their own contact shade in the single mesh');
  const headX = [];
  for (let i = 0; i < part.count; i++) if (part.getX(i) === 0 && part.getY(i) === 1 && position.getY(i) > 1.38) headX.push(position.getX(i));
  assert.ok(Math.max(...headX) - Math.min(...headX) < .24, 'adult head proportions replace the oversized spherical head');
  for (const attribute of Object.values(body.attributes)) assert.ok(Array.from(attribute.array).every(Number.isFinite), 'all animated attributes stay finite');
  // The old walkers' clothes: shirt actor % 6, skin 5 actor % 6, trousers actor % 4; the step's phase 2.399 actor.
  for (const actor of [0, 1, 7, 23]) {
    const [phase, first, second] = city.codes(actor);
    assert.ok(Math.abs(phase - actor * 2.399 % (Math.PI * 2)) < 1e-9 && phase >= 0 && phase < Math.PI * 2);
    assert.equal(first % 6, actor % 6); assert.equal(Math.floor(first / 6), actor * 5 % 6); assert.equal(second % 4, actor % 4);
    assert.ok(Math.floor(second / 4) % 4 < 4 && second < 32);
  }
  assert.ok([...Array(30).keys()].filter(actor => city.codes(actor)[2] >= 16).length === 10, 'a third in long sleeves');
  const material = city.walkerMaterial(city.uniformTime);
  assert.ok(material.colorNode && material.roughnessNode && material.userData.walkTime === city.uniformTime);
  material.dispose(); body.dispose();
});
