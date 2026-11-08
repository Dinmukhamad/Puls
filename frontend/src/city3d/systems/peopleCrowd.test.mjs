import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const { outputFiles } = await build({
  stdin: { contents: 'export * from "./crowd.ts"; export * from "../world/cities.ts"; export * from "../world/worldSpec.ts"; export * from "../world/sales.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
});
const C = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const same = (a, b, message) => assert.ok(JSON.stringify(a) === JSON.stringify(b), message);

function context(world, mobile) {
  const frames = new Set(), moves = new Set(), qualities = new Set();
  const camera = new C.THREE.PerspectiveCamera(110, 1.6, .1, 1800);
  camera.position.set(0, 400, 1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  return { world, mobile, reducedMotion: true, camera, scene: new C.THREE.Scene(), quality: { tier: 'medium', crowd: 1, lodDistances: [32, 100, 300] },
    onFrame(f) { frames.add(f); return () => frames.delete(f); },
    onCameraMove(f) { moves.add(f); return () => moves.delete(f); },
    onQuality(f) { qualities.add(f); return () => qualities.delete(f); },
    tick(dt = 0) { frames.forEach(f => f(dt, 0)); },
    move(x, y, z, target) { camera.position.set(x, y, z); camera.lookAt(...target); camera.updateMatrixWorld(); moves.forEach(f => f()); this.tick(0); },
    settings(patch) { this.quality = { ...this.quality, ...patch }; qualities.forEach(f => f(this.quality)); this.tick(0); },
    get listeners() { return frames.size + moves.size + qualities.size; },
  };
}

function bodies(group) { return group.children.filter(m => m.geometry?.isInstancedBufferGeometry && m.geometry.getAttribute('aPart')); }
function snapshot(group) {
  const N = group.userData.population, records = new Map(), activeVariants = new Set(), activeLods = new Set();
  const expected = Array.from({ length: N }, (_, actor) => C.codes(actor));
  for (const mesh of bodies(group)) {
    const count = mesh.geometry.instanceCount, detail = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 > 220 ? 'near' : 'far';
    const details = mesh.geometry.getAttribute('copyTint'), transform = mesh.geometry.getAttribute('copyMatrix0').data;
    for (let slot = 0; slot < count; slot++) {
      const code = [details.getX(slot), details.getY(slot), details.getZ(slot)];
      const actor = expected.findIndex(c => Math.abs(c[0] - code[0]) < 1e-5);
      assert.ok(actor >= 0, 'body code corresponds to an existing logical resident');
      assert.ok(!records.has(actor), 'one actor appears in only one near/far pool');
      assert.ok(code.every((n, i) => Math.abs(n - expected[actor][i]) < 1e-5), 'clothes and phase remain actor-owned');
      const variant = Math.round(code[1]) % 6;
      assert.equal(variant, C.personVariant(actor));
      const position = Array.from(transform.array.slice(slot * transform.stride + 12, slot * transform.stride + 15));
      records.set(actor, { code, position, detail, variant }); activeVariants.add(variant); activeLods.add(detail);
    }
  }
  const shadow = group.getObjectByName('city-crowd-contact-shadows');
  assert.ok(shadow);
  assert.equal(shadow.geometry.instanceCount, records.size, 'one contact shadow per drawn body');
  const shadowTransform = shadow.geometry.getAttribute('copyMatrix0').data;
  const bodyPositions = [...records.values()].map(r => `${r.position[0].toFixed(5)}|${r.position[2].toFixed(5)}`).sort();
  const shadowPositions = Array.from({ length: shadow.geometry.instanceCount }, (_, slot) => `${shadowTransform.array[slot * shadowTransform.stride + 12].toFixed(5)}|${shadowTransform.array[slot * shadowTransform.stride + 14].toFixed(5)}`).sort();
  same(shadowPositions, bodyPositions, 'no stale or misplaced shadow after pool changes');
  return { records, activeVariants, activeLods };
}

for (const [city, world] of [['support', C.islandWorld(C.WORLD_X4)], ['sales', C.generateSalesWorld()]]) for (const mobile of [false, true]) test(`${city}/${mobile ? 'mobile' : 'desktop'}: six residents remain stable across density, LOD, pause and disposal`, t => {
  const ctx = context(world, mobile), crowd = C.createCrowd(ctx), group = ctx.scene.getObjectByName('city-crowd');
  t.after(() => crowd.dispose());
  const batchList = bodies(group), max = mobile ? 56 : 100;
  assert.ok(batchList.length > 0 && batchList.length <= 12, 'body batching stays bounded independently of population');
  assert.ok(group.userData.population <= max && group.userData.population >= 12, `${city}/${mobile ? 'mobile' : 'desktop'}: bounded logical population ${group.userData.population}`);
  assert.equal(new Set(batchList.map(m => m.material)).size, 1, 'all body batches share one material');
  const sharedTime = batchList[0].material.userData.walkTime;
  assert.ok(batchList.every(m => m.material.userData.walkTime === sharedTime && !m.castShadow));
  const all = snapshot(group); assert.equal(all.records.size, group.userData.population); assert.equal(all.activeVariants.size, 6); assert.deepEqual([...all.activeLods], ['far']);
  const initial = [...all.records.entries()]; ctx.tick(.15); same([...snapshot(group).records.entries()], initial, 'reduced motion freezes the resident state');
  ctx.settings({ crowd: .5 }); const half = snapshot(group);
  assert.equal(half.records.size, Math.floor(group.userData.population / 2)); assert.equal(half.activeVariants.size, 6, 'half density still contains every person model');
  ctx.settings({ crowd: 1 });
  const actor = snapshot(group).records.keys().next().value, first = snapshot(group).records.get(actor);
  ctx.move(first.position[0], first.position[1] + 6, first.position[2] + 14, [first.position[0], first.position[1] + .65, first.position[2]]);
  const close = snapshot(group).records.get(actor); assert.ok(close && close.detail === 'near'); same(close.code, first.code, 'LOD does not repaint or restart a person'); same(close.position, first.position, 'LOD does not teleport a person');
  for (const [distance, detail] of [[33, 'near'], [37, 'far'], [31, 'far'], [27, 'near']]) {
    ctx.move(first.position[0], first.position[1] + .65, first.position[2] + distance, [first.position[0], first.position[1] + .65, first.position[2]]);
    const resident = snapshot(group).records.get(actor);
    assert.ok(resident && resident.detail === detail, `camera distance ${distance} keeps the expected LOD without flickering at the boundary`);
    same(resident.code, first.code, 'crossing the LOD boundary preserves clothes and gait phase');
    same(resident.position, first.position, 'crossing the LOD boundary preserves placement');
  }
  ctx.move(0, 400, 1, [0, 0, 0]); const back = snapshot(group).records.get(actor); assert.ok(back && back.detail === 'far'); same(back.code, first.code, 'far return preserves actor phase');
  crowd.setEnabled(true); const stopped = sharedTime.value; ctx.tick(.1); assert.ok(sharedTime.value > stopped);
  crowd.setEnabled(false); const freeze = [...snapshot(group).records.entries()], time = sharedTime.value; ctx.tick(10); same([...snapshot(group).records.entries()], freeze, 'disabled crowd has stable matrices'); assert.equal(sharedTime.value, time);
  crowd.setEnabled(true); ctx.tick(.01); assert.ok(sharedTime.value > time && sharedTime.value < time + .011, 'resume advances only the current frame');
  const resources = new Set(); group.traverse(m => { if (m.isMesh) { resources.add(m.geometry); for (const material of [m.material].flat()) resources.add(material); } });
  const freed = new Set(); for (const resource of resources) resource.addEventListener('dispose', () => freed.add(resource));
  crowd.dispose(); assert.equal(freed.size, resources.size); assert.equal(ctx.listeners, 0); assert.equal(ctx.scene.children.length, 0);
});
