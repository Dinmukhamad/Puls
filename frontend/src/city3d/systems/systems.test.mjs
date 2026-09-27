import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The systems and the generator in one bundle, so they share one copy of three. Vite's `?url` imports become
// plain paths; the operator glTF cannot load in Node, which exercises the robot fallback.
const dir = fileURLToPath(new URL('.', import.meta.url));
const built = await build({
  stdin: { contents: ['districts', 'traffic', 'mascot'].map(f => `export * from './${f}.ts';`).join('\n') + '\nexport * from "../world/generate.ts"; export * from "../world/worldSpec.ts"; export * as THREE from "three/webgpu";', resolveDir: dir },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
  plugins: [{ name: 'url', setup(b) {
    b.onResolve({ filter: /\?url$/ }, a => ({ path: a.path, namespace: 'url' }));
    b.onLoad({ filter: /.*/, namespace: 'url' }, a => ({ contents: `export default ${JSON.stringify(a.path.replace(/\?url$/, ''))};`, loader: 'js' }));
  } }],
});
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { THREE } = city;

// The landmark kit paints its signs on a canvas: a stand-in that draws nothing.
const noop = () => {};
const context2d = new Proxy({}, { get: (_, key) => key === 'measureText' ? () => ({ width: 0 }) : noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context2d }) };

const worlds = { v1: city.generateWorld(city.WORLD_V1), x4: city.generateWorld(city.WORLD_X4) };

/** A CityContext without a renderer: callbacks run when the test says so. */
function fakeContext(world, { reducedMotion = false, crowd = 1, far = 250 } = {}) {
  const frames = new Set(), moves = new Set(), qualities = new Set();
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 1, 2000);
  const ctx = {
    backend: 'webgpu', mobile: false, reducedMotion, world, scene: new THREE.Scene(), camera, overlay: null,
    renderer: { domElement: { dataset: {} } },
    quality: { tier: 'high', resolution: 1, fps: 60, dynamicShadowSize: 2048, staticShadowSize: 4096, ao: true, bloom: true, tiltShift: true, waterReflections: 'ssr', lodDistances: [40, 120, far], crowd },
    shadowRequests: 0,
    onFrame(cb) { frames.add(cb); return () => frames.delete(cb); },
    onCameraMove(cb) { moves.add(cb); return () => moves.delete(cb); },
    onQuality(cb) { qualities.add(cb); return () => qualities.delete(cb); },
    requestShadowUpdate() { ctx.shadowRequests++; },
    frame(dt, now) { frames.forEach(cb => cb(dt, now)); },
    look(x, y, z, tx = 0, ty = 0, tz = 0) { camera.position.set(x, y, z); camera.lookAt(tx, ty, tz); camera.updateMatrixWorld(); moves.forEach(cb => cb()); },
    setQuality(change) { Object.assign(ctx.quality, change); qualities.forEach(cb => cb(ctx.quality)); },
    get listeners() { return frames.size + moves.size + qualities.size; },
  };
  ctx.look(0, 420, 1);
  return ctx;
}

/** Every GPU resource under the scene, with a flag that turns true when it is disposed. */
function watchResources(scene) {
  const found = new Map();
  const watch = r => { if (!found.has(r)) { found.set(r, false); r.addEventListener('dispose', () => found.set(r, true)); } };
  scene.traverse(o => {
    if (!o.isMesh) return;
    watch(o.geometry);
    for (const m of [o.material].flat()) { watch(m); for (const v of Object.values(m)) if (v?.isTexture) watch(v); }
  });
  return found;
}
const meshes = root => { const list = []; root.traverse(o => o.isMesh && list.push(o)); return list; };
const matrixAt = (array, i) => new THREE.Matrix4().fromArray(array, i * 16);

test('every island gets its building, a label anchor above it and, unless reserved, a hit cylinder', () => {
  for (const world of Object.values(worlds)) {
    const ctx = fakeContext(world), districts = city.createDistricts(ctx, { levels: { academy: 2, driver: 5 } });
    assert.equal(districts.anchors.size, world.districts.length);
    for (const d of world.districts) {
      const anchor = districts.anchors.get(d.id);
      assert.ok(Math.hypot(anchor.x - d.x, anchor.z - d.z) < 1e-9 && anchor.y > city.GROUND + 4, `${d.id} anchor`);
    }
    const real = world.districts.filter(d => !city.isFutureDistrict(d.id));
    assert.deepEqual(districts.pickables.map(p => p.userData.district), real.map(d => d.id));
    for (const hit of districts.pickables) {
      const anchor = districts.anchors.get(hit.userData.district);
      assert.equal(hit.visible, false);
      assert.ok(hit.scale.x === world.spec.islet && Math.abs(hit.position.y + hit.scale.y / 2 + .7 - anchor.y) < 1e-9, 'the cylinder reaches the roof');
    }
    districts.dispose();
  }
});

test('landmarks face the plaza at the world scale and share draw calls; reserved islands share one instanced site', () => {
  const ctx = fakeContext(worlds.x4), districts = city.createDistricts(ctx, { levels: { crm: 2 }, grown: ['crm'] });
  const root = ctx.scene.getObjectByName('city-districts');
  // A growing landmark keeps its own group; the others are merged per kit material.
  const crm = root.children.find(o => o.isGroup && o.userData.district === 'crm');
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(crm.quaternion);
  assert.ok(front.dot(new THREE.Vector3(-crm.position.x, 0, -crm.position.z).normalize()) > .999, 'faces the plaza');
  assert.equal(crm.scale.x, worlds.x4.spec.districtScale);
  const merged = root.children.filter(o => o.isMesh && !o.isInstancedMesh && o.visible && o.geometry.type !== 'TorusGeometry');
  assert.ok(merged.length >= 4 && merged.length <= 12, `${merged.length} draw calls for four landmarks`);
  const tall = d => merged.some(m => { const p = m.geometry.getAttribute('position'); for (let i = 0; i < p.count; i += 5) if (p.getY(i) > 3 && Math.hypot(p.getX(i) - d.x, p.getZ(i) - d.z) < 4) return true; return false; });
  for (const d of worlds.x4.districts) if (!city.isFutureDistrict(d.id) && d.id !== 'crm') assert.ok(tall(d), `${d.id} stands at full height`);
  const site = root.children.filter(m => m.isInstancedMesh);
  assert.ok(site.length === 1 && site[0].count === 5, 'one instanced mesh, one instance per reserved island');
  districts.dispose();
});

test('hover lights the ring, selection pulses it in brightness only, the rest stay hidden', () => {
  const ctx = fakeContext(worlds.v1), districts = city.createDistricts(ctx, { levels: {} });
  const rings = new Map(meshes(ctx.scene).filter(m => m.geometry.type === 'TorusGeometry' && m.material.transparent).map(m => [world(m), m]));
  function world(m) { return worlds.v1.districts.find(d => Math.hypot(d.x - m.position.x, d.z - m.position.z) < 1e-6).id; }
  assert.equal(rings.size, 5);
  districts.select('crm'); districts.hover('academy'); ctx.frame(1 / 60, 1000);
  for (const [id, ring] of rings) assert.equal(ring.visible, id === 'crm' || id === 'academy', id);
  assert.equal(rings.get('academy').material.opacity, .45);
  const opacities = [0, 400, 800, 1200].map(t => { ctx.frame(1 / 60, t); return rings.get('crm').material.opacity; });
  assert.ok(Math.min(...opacities) >= .55 && Math.max(...opacities) <= .95 && new Set(opacities).size > 1, 'the selected ring pulses');
  assert.equal(rings.get('crm').scale.x, 1);
  assert.ok(rings.get('crm').geometry.parameters.radius + rings.get('crm').geometry.parameters.tube < worlds.v1.spec.islet, 'inside the island');
  districts.hover(null); ctx.frame(1 / 60, 2000);
  assert.equal(rings.get('academy').visible, false);
  districts.dispose();
});

test('a grown district waits flat, grows in with an overshoot, redraws shadows and bursts into confetti once', () => {
  const ctx = fakeContext(worlds.v1), scale = worlds.v1.spec.districtScale;
  const districts = city.createDistricts(ctx, { levels: { crm: 3 }, grown: ['crm', 'future-9', 'nowhere'] });
  const root = ctx.scene.getObjectByName('city-districts'), crm = root.children.find(o => o.userData.district === 'crm' && o.isGroup);
  assert.ok(crm.scale.y < scale * .05, 'flat before the start');
  const start = performance.now(), before = meshes(root).length;
  assert.equal(districts.startGrowth(), 'crm');
  assert.equal(districts.startGrowth(), null, 'only once');
  const chips = () => root.children.find(o => o.isInstancedMesh && o.geometry.type === 'PlaneGeometry');
  let highest = 0, confetti = 0;
  for (let t = 0; t <= 6000; t += 50) {
    ctx.frame(.05, start + t);
    highest = Math.max(highest, crm.scale.y);
    if (chips()?.visible) confetti++;
  }
  assert.ok(highest > scale * 1.01 && crm.scale.y === scale, 'overshoots, then settles');
  assert.ok(ctx.shadowRequests > 10, 'the static shadow map follows the growth');
  assert.ok(confetti > 30 && !chips(), 'confetti falls for about 3 s and is gone');
  assert.ok(!crm.parent && meshes(root).length < before, 'grown, it is merged with the other landmarks');
  districts.dispose();
});

test('with reduced motion nothing grows and the selection does not pulse', () => {
  const ctx = fakeContext(worlds.v1, { reducedMotion: true }), scale = worlds.v1.spec.districtScale;
  const districts = city.createDistricts(ctx, { levels: {}, grown: ['crm'] });
  assert.ok(ctx.scene.getObjectByName('city-districts').children.every(o => !o.isGroup), 'nothing waits flat: every landmark is merged at full height');
  void scale;
  assert.equal(districts.startGrowth(), null);
  districts.select('crm');
  const ring = meshes(ctx.scene).find(m => m.geometry.type === 'TorusGeometry' && m.visible === false && m.material.transparent);
  const values = [0, 300, 700].map(t => { ctx.frame(1 / 60, t); return meshes(ctx.scene).filter(m => m.visible && m.material.transparent).map(m => m.material.opacity).join(); });
  assert.ok(ring && new Set(values).size === 1);
  districts.dispose();
});

test('districts.dispose() frees every geometry, material and texture and leaves the scene', () => {
  const ctx = fakeContext(worlds.x4), districts = city.createDistricts(ctx, { levels: { academy: 5 }, grown: ['academy'] });
  districts.startGrowth(); const t = performance.now();
  for (let k = 0; k < 40; k++) ctx.frame(.05, t + k * 50);
  const resources = watchResources(ctx.scene);
  districts.dispose();
  assert.equal(ctx.scene.children.length, 0);
  assert.equal(ctx.listeners, 0);
  assert.deepEqual([...resources].filter(([, disposed]) => !disposed).map(([r]) => r.type), []);
});

test('activeAt keeps an evenly spread share of every loop', () => {
  const kept = share => Array.from({ length: 8 }, (_, k) => k).filter(k => city.activeAt(k, share));
  assert.deepEqual(kept(1), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(kept(.5), [1, 3, 5, 7]);
  assert.deepEqual(kept(0), []);
  for (const share of [.25, .6, .75]) assert.ok(Math.abs(kept(share).length - 8 * share) <= 1);
});

/** Vehicles drawn: each shared matrix buffer counted once; boats are the ones below the water line. */
function drawn(ctx) {
  const seen = new Set();
  let cars = 0, boats = 0;
  for (const mesh of ctx.scene.getObjectByName('city-traffic').children) {
    if (seen.has(mesh.instanceMatrix)) continue;
    seen.add(mesh.instanceMatrix);
    if (mesh.count && new THREE.Vector3().setFromMatrixPosition(matrixAt(mesh.instanceMatrix.array, 0)).y < -1) boats += mesh.count; else cars += mesh.count;
  }
  return { cars, boats, shadows: ctx.scene.getObjectByName('city-traffic-shadows').count };
}

test('every loop gets its cars and the canal its boats; each drawn car has one blob shadow on the road', () => {
  for (const world of Object.values(worlds)) {
    const ctx = fakeContext(world, { far: 1e4 }), traffic = city.createTraffic(ctx);
    ctx.frame(1 / 60, 0);
    const capacity = meshes(ctx.scene.getObjectByName('city-traffic')).reduce((sum, m, i, all) => all.findIndex(o => o.instanceMatrix === m.instanceMatrix) === i ? sum + m.instanceMatrix.count : sum, 0);
    assert.equal(capacity, world.routes.reduce((sum, r) => sum + r.cars, 0));
    const counts = drawn(ctx);
    assert.ok(counts.boats >= 2 && counts.cars > capacity * .6, `${world.spec.name}: ${JSON.stringify(counts)} of ${capacity}`);
    assert.equal(counts.shadows, counts.cars);
    const blobs = ctx.scene.getObjectByName('city-traffic-shadows'), points = world.routes.filter(r => !r.boats).flatMap(r => r.route.points);
    for (let i = 0; i < blobs.count; i++) {
      const p = new THREE.Vector3().setFromMatrixPosition(matrixAt(blobs.instanceMatrix.array, i));
      assert.ok([.227, .272].some(y => Math.abs(p.y - y) < 1e-6), `blob height ${p.y}`);
      assert.ok(points.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 1.3), `blob off the routes at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    }
    traffic.dispose();
  }
});

test('traffic draws only what the camera sees within the far LOD distance', () => {
  const ctx = fakeContext(worlds.x4), traffic = city.createTraffic(ctx);
  ctx.look(0, 90, 60, 0, 0, 0); ctx.frame(1 / 60, 0);
  const near = drawn(ctx).cars;
  ctx.look(0, 90, 60, 0, 200, 60); ctx.frame(1 / 60, 20);
  assert.equal(drawn(ctx).cars, 0, 'looking at the sky');
  ctx.look(0, 2000, 1); ctx.frame(1 / 60, 40);
  assert.equal(drawn(ctx).cars, 0, 'everything beyond the far LOD distance');
  assert.ok(near > 20);
  traffic.dispose();
});

test('paused traffic stands still (the default with reduced motion) and moves again when enabled', () => {
  const ctx = fakeContext(worlds.v1, { reducedMotion: true, far: 1e4 }), traffic = city.createTraffic(ctx);
  const blobs = ctx.scene.getObjectByName('city-traffic-shadows'), snapshot = () => Array.from(blobs.instanceMatrix.array.slice(0, blobs.count * 16)).join();
  ctx.frame(.05, 0); const first = snapshot();
  assert.ok(blobs.count > 0);
  ctx.frame(.05, 50); ctx.frame(.05, 100);
  assert.equal(snapshot(), first);
  traffic.setEnabled(true); ctx.frame(.05, 150);
  assert.notEqual(snapshot(), first);
  traffic.setEnabled(false); const stopped = snapshot(); ctx.frame(.05, 200);
  assert.equal(snapshot(), stopped);
  traffic.dispose();
});

test('a lower crowd share thins the traffic without rebuilding it', () => {
  const ctx = fakeContext(worlds.x4, { far: 1e4 }), traffic = city.createTraffic(ctx);
  ctx.frame(1 / 60, 0);
  const before = drawn(ctx).cars, meshesBefore = [...ctx.scene.getObjectByName('city-traffic').children];
  ctx.setQuality({ crowd: .5 }); ctx.frame(1 / 60, 16);
  const after = drawn(ctx).cars;
  assert.ok(after > before * .35 && after < before * .65, `${after} of ${before}`);
  assert.deepEqual(ctx.scene.getObjectByName('city-traffic').children, meshesBefore);
  traffic.dispose();
});

test('catalogue cars join the loops, unknown names drive as taxis, and the catalogue stays the caller\'s', () => {
  const model = color => { const geometry = new THREE.BoxGeometry(1.5, 1, 3).translate(0, .5, 0); geometry.computeBoundingBox(); return { name: color, parts: [{ geometry, material: new THREE.MeshStandardNodeMaterial({ color }), castShadow: true }], bounds: geometry.boundingBox.clone() }; };
  const vehicles = new Map([['sedan', model('#f00')], ['suv', model('#0f0')]]);
  const ctx = fakeContext(worlds.v1, { far: 1e4 }), traffic = city.createTraffic(ctx);
  const group = ctx.scene.getObjectByName('city-traffic'), taxiOnly = group.children.length;
  traffic.setVehicles(vehicles); ctx.frame(1 / 60, 0);
  assert.equal(group.children.length, taxiOnly + 2);
  const sedan = group.children.find(m => m.geometry === vehicles.get('sedan').parts[0].geometry);
  assert.ok(sedan.count > 0 && sedan.castShadow);
  assert.deepEqual(traffic.movers, [group]);
  const catalogue = [...vehicles.values()].flatMap(m => [m.parts[0].geometry, m.parts[0].material]), freed = new Set();
  catalogue.forEach(r => r.addEventListener('dispose', () => freed.add(r)));
  const resources = watchResources(ctx.scene);
  traffic.dispose();
  assert.equal(freed.size, 0);
  assert.deepEqual([...resources].filter(([r, disposed]) => !disposed && !catalogue.includes(r)).map(([r]) => r.type), []);
  assert.equal(ctx.scene.children.length, 0);
  assert.equal(ctx.listeners, 0);
});

test('the mascot: the robot on its pedestal by default, the robot again when the operator cannot load', async () => {
  const ctx = fakeContext(worlds.v1), mascot = city.createMascot(ctx);
  const figure = mascot.movers[0];
  assert.equal(figure.children.length, 1);
  assert.equal(ctx.renderer.domElement.dataset.character, 'robot');
  assert.ok(ctx.shadowRequests >= 1, 'the pedestal is baked into the static shadows');
  assert.ok(mascot.focusPoint.y > 0 && mascot.nameAnchor.y > 7);
  mascot.setMascot({ gender: 'female', name: 'Аня' });
  assert.equal(figure.children.length, 0);
  mascot.setMascot({ gender: 'male', name: 'Олег' });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(figure.children.length, 1, 'one fallback robot, the stale request is dropped');
  assert.equal(ctx.renderer.domElement.dataset.character, 'fallback');
  const resources = watchResources(ctx.scene);
  mascot.dispose();
  assert.deepEqual([...resources].filter(([, disposed]) => !disposed).map(([r]) => r.type), []);
  assert.equal(ctx.scene.children.length, 0);
  assert.equal(ctx.listeners, 0);
  assert.equal(ctx.renderer.domElement.dataset.character, undefined);
});
