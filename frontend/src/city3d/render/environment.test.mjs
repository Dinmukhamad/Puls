import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: 'export * from "./sky.ts"; export * from "./water.ts"; export * from "../world/generate.ts"; export * from "../world/worldSpec.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
const city = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
function context() {
  const callbacks = new Set();
  return { scene: new city.THREE.Scene(), world: city.generateWorld(city.WORLD_X4), quality: { staticShadowSize: 1024 }, reducedMotion: false, requests: 0,
    onFrame(fn) { callbacks.add(fn); return () => callbacks.delete(fn); }, onQuality(fn) { callbacks.add(fn); return () => callbacks.delete(fn); },
    requestShadowUpdate() { this.requests++; }, get listeners() { return callbacks.size; } };
}
test('night changes sky, fog and fill, keeps moon above the city, and restores daylight without adding lights', () => {
  const ctx = context(), sky = city.createSky(ctx);
  const day = { sun: sky.sun.intensity, fog: ctx.scene.fog.color.getHex(), fill: sky.hemisphere.color.getHex() };
  const children = ctx.scene.children.length;
  sky.setTimeOfDay(22);
  assert.ok(sky.sun.position.y > 0 && sky.sun.intensity > 0 && sky.sun.intensity < day.sun);
  assert.notEqual(ctx.scene.fog.color.getHex(), day.fog);
  assert.notEqual(sky.hemisphere.color.getHex(), day.fill);
  assert.equal(ctx.scene.children.length, children);
  sky.setTimeOfDay(city.DEFAULT_HOURS);
  assert.equal(ctx.scene.fog.color.getHex(), day.fog);
  assert.equal(sky.hemisphere.color.getHex(), day.fill);
  assert.equal(sky.sun.intensity, day.sun);
  assert.ok(ctx.requests >= 3);
  sky.dispose(); assert.equal(ctx.listeners, 0); assert.equal(ctx.scene.children.length, 0);
});
test('water covers the expanded lagoon/canal and changing night keeps one geometry and shader', () => {
  const ctx = context(), water = city.createWater(ctx), { geometry, material } = water.mesh;
  const positions = geometry.getAttribute('position'), shore = geometry.getAttribute('shore');
  const maxRadius = Math.max(...ctx.world.water.annuli.map(a => a.outer));
  assert.ok(geometry.boundingSphere.radius >= maxRadius);
  for (let i = 0; i < positions.count; i++) {
    assert.equal(Math.round(positions.getY(i) * 100), -125);
    assert.ok(Number.isFinite(positions.getX(i)) && shore.getX(i) >= 0 && shore.getX(i) <= 1);
  }
  const node = material.colorNode;
  for (const night of [true, false, true]) water.setNight(night);
  assert.equal(water.mesh.geometry, geometry); assert.equal(water.mesh.material.colorNode, node);
  let geometryFreed = false, materialFreed = false;
  geometry.addEventListener('dispose', () => { geometryFreed = true; }); material.addEventListener('dispose', () => { materialFreed = true; });
  water.dispose(); assert.ok(geometryFreed && materialFreed); assert.equal(ctx.listeners, 0); assert.equal(ctx.scene.children.length, 0);
});
