import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: 'export * from "./sky.ts"; export * from "./water.ts"; export * from "./night.ts"; export * from "../world/generate.ts"; export * from "../world/worldSpec.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
const city = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
function context() {
  const callbacks = new Set();
  return { scene: new city.THREE.Scene(), world: city.generateWorld(city.WORLD_X4), quality: { staticShadowSize: 1024 }, reducedMotion: false, requests: 0, night: city.createNight(),
    onFrame(fn) { callbacks.add(fn); return () => callbacks.delete(fn); }, onQuality(fn) { callbacks.add(fn); return () => callbacks.delete(fn); },
    requestShadowUpdate() { this.requests++; }, get listeners() { return callbacks.size; } };
}
test('night changes sky, fog and fill, keeps moon above the city, and restores daylight without adding lights', () => {
  const ctx = context(), sky = city.createSky(ctx);
  const day = { sun: sky.sun.intensity, fog: ctx.scene.fog.color.getHex(), fill: sky.hemisphere.color.getHex() };
  const children = ctx.scene.children.length, background = ctx.scene.backgroundNode;
  sky.setTimeOfDay(22);
  // Stars, moon and the city's glow are in the same background shader; the fog is the deep blue horizon.
  assert.equal(ctx.scene.backgroundNode, background);
  assert.ok(ctx.scene.fog.color.b > ctx.scene.fog.color.r * 2, 'a deep blue night fog');
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
  // Night reflections: under the bridges and near the shores, riding on the emissive (no extra pass).
  const bridge = geometry.getAttribute('bridge'); let lit = 0;
  for (let i = 0; i < bridge.count; i++) { assert.ok(bridge.getX(i) >= 0 && bridge.getX(i) <= 1); if (bridge.getX(i) > .5) lit++; }
  assert.ok(lit > 0 && lit < bridge.count / 2, `${lit} of ${bridge.count} vertices lie under a bridge`);
  const node = material.colorNode, glow = material.emissiveNode;
  assert.ok(glow);
  for (const night of [true, false, true]) water.setNight(night);
  assert.equal(water.mesh.geometry, geometry); assert.equal(water.mesh.material.colorNode, node); assert.equal(material.emissiveNode, glow);
  let geometryFreed = false, materialFreed = false;
  geometry.addEventListener('dispose', () => { geometryFreed = true; }); material.addEventListener('dispose', () => { materialFreed = true; });
  water.dispose(); assert.ok(geometryFreed && materialFreed); assert.equal(ctx.listeners, 0); assert.equal(ctx.scene.children.length, 0);
});

test('the shadow map covers what the view shows and the fog moves out with the camera', () => {
  const ctx = context(), sky = city.createSky(ctx), shadow = sky.sun.shadow.camera, fog = ctx.scene.fog;
  const span = () => shadow.right - shadow.left;
  sky.followView(0, 0, 40); const close = span();
  sky.followView(0, 0, 300); const far = span();
  assert.ok(close < 200 && far > close * 3, `close ${close.toFixed(0)}, far ${far.toFixed(0)}`);
  assert.ok(far <= ctx.world.radius * 2.2, 'never more than the city');
  const requests = ctx.requests; sky.followView(0, 0, 305);
  assert.equal(ctx.requests, requests, 'zooming a little does not redraw the map');
  const near0 = fog.near, far0 = fog.far;
  sky.setViewDistance(300);
  assert.ok(fog.near > near0 + 150 && fog.far > far0 + 150, 'zoomed out, the city stays out of the fog');
  sky.setViewDistance(60);
  assert.equal(fog.near, near0); assert.equal(fog.far, far0);
  sky.dispose();
});
