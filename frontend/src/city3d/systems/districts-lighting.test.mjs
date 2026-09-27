import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Exercise the real architectural kit and merged node materials, without a GPU.
const bundle = await build({
  stdin: { contents: 'export * from "./districts.ts"; export * from "../world/generate.ts"; export * from "../world/worldSpec.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
});
const { THREE, createDistricts, generateWorld, WORLD_X4 } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const noop = () => {};
const context2d = new Proxy({}, { get: (_, key) => key === 'measureText' ? () => ({ width: 0 }) : noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context2d }) };

function context() {
  const frames = new Set();
  return {
    world: generateWorld(WORLD_X4), scene: new THREE.Scene(), reducedMotion: false,
    onFrame(callback) { frames.add(callback); return () => frames.delete(callback); },
    requestShadowUpdate: noop,
    frame(now) { frames.forEach(callback => callback(1 / 60, now)); },
    get listeners() { return frames.size; },
  };
}
function materials(root) {
  const result = new Set();
  root.traverse(object => { if (object.isMesh) for (const material of [object.material].flat()) result.add(material); });
  return [...result];
}
const windows = root => materials(root).filter(material => material.userData.districtGlass);
const geometryCount = root => { let total = 0; root.traverse(object => { if (object.isMesh) total++; }); return total; };
const levels = { academy: 5, driver: 5, crm: 5, dispatch: 5, oktell: 5 };

test('night lights landmark glazing without illuminating opaque surfaces or construction sites', () => {
  const ctx = context(), districts = createDistricts(ctx, { levels });
  const glass = windows(ctx.scene);
  assert.equal(glass.length, 1, 'completed landmarks keep a shared glass draw-call bucket');
  assert.equal(glass[0].isMeshStandardNodeMaterial, true);
  assert.equal(glass[0].emissiveIntensity, 0, 'daytime glazing does not glow');
  const others = materials(ctx.scene).filter(material => !material.userData.districtGlass);
  const original = others.map(material => ({ material, emissive: material.emissive?.getHex(), intensity: material.emissiveIntensity }));
  const before = geometryCount(ctx.scene), daylightColor = glass[0].color.getHex();
  const site = ctx.scene.getObjectByName('city-construction-sites');
  assert.ok(site, 'reserved islands include the actual crane/construction material');
  const opaqueFinish = others.filter(material => material.isMeshStandardNodeMaterial && !material.map);
  assert.ok(opaqueFinish.length >= 2, 'stone/roof and metal finishes are included');

  // A toggle must use its material registry, not traverse a scene or add lights.
  const originalTraverse = ctx.scene.traverse;
  ctx.scene.traverse = () => { throw new Error('setNight should not walk the scene'); };
  districts.setNight(true); districts.setNight(true);
  ctx.scene.traverse = originalTraverse;
  assert.ok(glass[0].emissiveIntensity > 0 && glass[0].emissiveIntensity < 1);
  assert.ok(glass[0].emissive.r > glass[0].emissive.g && glass[0].emissive.g > glass[0].emissive.b, 'warm window light');
  assert.equal(glass[0].color.getHex(), daylightColor, 'surface colour survives the toggle');
  assert.equal(geometryCount(ctx.scene), before, 'night adds no geometry');
  let lights = 0; ctx.scene.traverse(object => { if (object.isLight) lights++; });
  assert.equal(lights, 0, 'windows create no point lights');
  for (const snapshot of original) {
    assert.equal(snapshot.material.emissive?.getHex(), snapshot.emissive);
    assert.equal(snapshot.material.emissiveIntensity, snapshot.intensity);
  }
  districts.setNight(false);
  assert.equal(glass[0].emissiveIntensity, 0, 'day restores non-emissive glazing');
  assert.equal(site.material.emissive.getHex(), 0, 'the crane never glows');
  districts.dispose(); assert.equal(ctx.listeners, 0); assert.equal(ctx.scene.children.length, 0);
});

test('growing windows follow night/day and the completed merge preserves the current lighting', () => {
  const ctx = context(), districts = createDistricts(ctx, { levels, grown: ['crm', 'academy'] });
  const root = ctx.scene.getObjectByName('city-districts');
  const waiting = root.children.filter(object => object.isGroup && object.userData.district);
  assert.equal(waiting.length, 2);
  const originalGlass = windows(waiting[0])[0];
  assert.ok(originalGlass?.isMeshStandardMaterial, 'growing models retain the kit material');
  assert.equal(windows(ctx.scene).length, 2, 'one shared kit glass plus one completed-landmark bucket');
  districts.setNight(true);
  for (const material of windows(ctx.scene)) assert.ok(material.emissiveIntensity > 0);
  const nightIntensity = originalGlass.emissiveIntensity;
  const started = performance.now(); assert.ok(districts.startGrowth());
  ctx.frame(started + 1100);
  assert.ok(waiting.every(group => group.parent === root && group.scale.y > ctx.world.spec.districtScale * .02), 'windows light during the growth animation');
  districts.setNight(false);
  for (const material of windows(ctx.scene)) assert.equal(material.emissiveIntensity, 0);
  districts.setNight(true);
  ctx.frame(started + 2200);
  assert.ok(waiting.every(group => !group.parent), 'completed models entered the existing merge path');
  const mergedGlass = windows(ctx.scene);
  assert.equal(mergedGlass.length, 3, 'one existing bucket plus the two completed growth merges');
  for (const material of mergedGlass) {
    assert.equal(material.isMeshStandardNodeMaterial, true);
    assert.equal(material.emissiveIntensity, nightIntensity, 'new merged windows inherit night immediately');
  }
  districts.setNight(false);
  for (const material of mergedGlass) assert.equal(material.emissiveIntensity, 0);
  const disposed = new Set(); mergedGlass.forEach(material => material.addEventListener('dispose', () => disposed.add(material)));
  districts.dispose(); assert.equal(disposed.size, mergedGlass.length); assert.equal(ctx.listeners, 0);
});
