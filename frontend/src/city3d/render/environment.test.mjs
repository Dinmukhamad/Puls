import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: 'export * from "./sky.ts"; export { RELIEF_END } from "../world/relief.ts"; export * from "./water.ts"; export * from "./mountains.ts"; export * from "./night.ts"; export * from "../world/generate.ts"; export * from "../world/worldSpec.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
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

test("the scene's fog stays off the city and only lightly veils everything out to the relief's end", () => {
  // The fog covers every mesh (the city, the forests on the hills); the ranges add their own layers of haze (below).
  const ctx = context(), sky = city.createSky(ctx), fog = ctx.scene.fog, r = ctx.world.radius;
  assert.ok(fog.near > r * 1.4, `the city and its hills stay clear: haze from ${fog.near.toFixed(0)}, radius ${r}`);
  const veil = (city.RELIEF_END * r - fog.near) / (fog.far - fog.near);
  assert.ok(veil < .4, `the fog alone keeps the colours out to the relief's end: ${veil.toFixed(2)} of the haze`);
  sky.dispose();
});

test('the sky shares its colours of the moment with what mirrors it or fades into it, also in a nested scene', () => {
  const ctx = context(), sky = city.createSky(ctx), look = city.skyLook(ctx.scene);
  assert.ok(look && look.horizon && look.zenith && look.glow && look.sun && look.sunLight && look.moon && look.moonLight);
  const lake = new city.THREE.Scene(); ctx.scene.add(lake);
  assert.equal(city.skyLook(lake), look, "the lake city's scene sits in the city's and takes its sky");
  // The night swaps the colours in place: the same uniforms, so the water and the ranges follow without rebuilding.
  const horizon = look.horizon.value.getHex();
  sky.setTimeOfDay(22); assert.notEqual(look.horizon.value.getHex(), horizon); assert.equal(city.skyLook(ctx.scene), look);
  sky.setTimeOfDay(city.DEFAULT_HOURS); assert.equal(look.horizon.value.getHex(), horizon);
  ctx.scene.remove(lake); sky.dispose();
  assert.equal(city.skyLook(ctx.scene), null, 'the sky takes its colours away with it');
  assert.ok(city.skyGradient(null, new city.THREE.Vector3(0, 1, 0)) && city.skyHaze(null, new city.THREE.Vector3(1, 0, 0)), "without a sky, the day's");
});

test('the waves are one small tiling normal map with mip levels, built once', () => {
  const map = city.waveNormals(), { data, width, height } = map.image;
  assert.equal(map, city.waveNormals());
  assert.ok(width === 128 && height === 128 && data.length === 128 * 128 * 4);
  assert.ok(map.generateMipmaps && map.wrapS === city.THREE.RepeatWrapping && map.wrapT === city.THREE.RepeatWrapping);
  let sum = 0, inner = 0, seam = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const i = (y * 128 + x) * 4; sum += data[i] + data[i + 1];
    if (x < 127) inner = Math.max(inner, Math.abs(data[i] - data[i + 4]));
  }
  for (let y = 0; y < 128; y++) seam = Math.max(seam, Math.abs(data[(y * 128 + 127) * 4] - data[y * 128 * 4]));
  assert.ok(Math.abs(sum / (128 * 128 * 2) - 127.5) < 6, 'level on average');
  assert.ok(seam <= inner, `no seam where the tiles meet: ${seam} against ${inner} between neighbours`);
});

test('creased normals: smooth across a gentle fold, sharp across a steep one', () => {
  // Two triangles sharing the edge (0,0,0)–(1,0,0), the second tipped up by `angle` about it.
  const fold = angle => city.creasedGeometry([0, 0, 0, 1, 0, 0, .5, 0, -1, .5, Math.sin(angle), Math.cos(angle)], [0, 1, 2, 1, 0, 3], 50 * Math.PI / 180);
  const normalAt = (g, corner) => new city.THREE.Vector3().fromBufferAttribute(g.getAttribute('normal'), corner);
  for (const [angle, smooth] of [[.3, true], [1.3, false]]) {
    const g = fold(angle), a = normalAt(g, 0), b = normalAt(g, 4);
    assert.equal(g.getAttribute('position').count, 6);
    assert.ok(Math.abs(a.length() - 1) < 1e-5 && a.y > 0 && normalAt(g, 3).y > 0, 'unit normals on the winding side');
    assert.equal(a.distanceTo(b) < 1e-5, smooth, `fold of ${angle} rad: ${smooth ? 'one' : 'two'} normals on the shared edge`);
  }
});

test("the ranges: one mesh painted in its shader, smooth on the hills, in layers of haze that swallow the map's edge", () => {
  const ctx = context(), sky = city.createSky(ctx), mountains = city.createMountains(ctx), { geometry, material } = mountains.mesh;
  assert.equal(ctx.scene.children.filter(c => c.isMesh).length, 1, 'one draw call');
  assert.ok(geometry.getAttribute('normal') && !geometry.getAttribute('color'), 'painted in the shader, not per face');
  assert.ok(!material.vertexColors && material.colorNode && material.outputNode, 'the ground and the haze are nodes');
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), seen = new Map(), v = new city.THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(normal, i); assert.ok(Math.abs(v.length() - 1) < 1e-4);
    const key = `${position.getX(i).toFixed(3)},${position.getY(i).toFixed(3)},${position.getZ(i).toFixed(3)}`;
    const list = seen.get(key) ?? []; if (!list.some(n => n.distanceTo(v) < 1e-4)) list.push(v.clone()); seen.set(key, list);
  }
  const sharp = [...seen.values()].filter(list => list.length > 1).length;
  assert.ok(sharp > 0 && sharp < seen.size * .35, `${sharp} of ${seen.size} points on a fold, the rest shaded smooth`);
  assert.ok(city.HAZE_START >= city.FOG_NEAR, 'the city and its hills stay clear of the haze');
  assert.ok(city.HAZE_MAX < 1 && city.EDGE > 0 && city.EDGE < .5, 'the ranges keep their shapes in the haze, only the last stretch dissolves');
  // The forests on the hills stand where the haze stays off: they take only the scene's fog, as the ground under them.
  const forests = ctx.world.placements.filter(p => p.kind.startsWith('tree-') && (p.lift ?? 0) > 0);
  assert.ok(forests.length > 100, `${forests.length} hill trees`);
  const farthest = Math.max(...forests.map(p => Math.hypot(p.x, p.z)));
  assert.ok(farthest <= city.forestReach(ctx.world), `trees out to ${farthest.toFixed(0)}, the haze stays off to ${city.forestReach(ctx.world)}`);
  mountains.dispose(); sky.dispose();
  assert.equal(ctx.scene.children.length, 0);
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
