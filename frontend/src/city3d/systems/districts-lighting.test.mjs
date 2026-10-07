import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Exercise the real architectural kit and merged node materials, without a GPU.
const bundle = await build({
  stdin: { contents: 'export * from "./districts.ts"; export * from "../render/night.ts"; export * from "../world/generate.ts"; export * from "../world/worldSpec.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
});
const { THREE, createDistricts, createNight, generateWorld, WORLD_X4 } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const noop = () => {};
const context2d = new Proxy({}, { get: (_, key) => key === 'measureText' ? () => ({ width: 0 }) : noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context2d }) };

function context() {
  const frames = new Set();
  return {
    world: generateWorld(WORLD_X4), scene: new THREE.Scene(), reducedMotion: false, night: createNight(),
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

test('the scenario pavilion is selectable, grows and follows shared lighting and disposal', () => {
  const ctx = context(), districts = createDistricts(ctx, { levels: {}, grown:['scenarios'] });
  const root = ctx.scene.getObjectByName('city-districts');
  const scenario = ctx.world.districts.find(d => d.id === 'scenarios');
  assert.ok(scenario && !scenario.soon);
  assert.ok(districts.pickables.some(hit => hit.userData.district === 'scenarios'));
  assert.ok(districts.anchors.has('scenarios'));
  const lowerAnchor = districts.anchors.get('scenarios').y;
  assert.equal(districts.startGrowth(),'scenarios');
  ctx.frame(performance.now()+2200);
  districts.setLevels({scenarios:4},['scenarios']);
  assert.ok(districts.anchors.get('scenarios').y > lowerAnchor);
  districts.setNight(true); districts.startGrowth(); ctx.frame(performance.now()+2200);
  assert.ok(windows(root).every(material => material.emissiveIntensity > 0));
  districts.dispose(); assert.equal(ctx.listeners,0); assert.equal(ctx.scene.children.length,0);
});

test('setNight lights landmark glazing only: opaque surfaces and construction sites keep their emissive', () => {
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
  assert.ok(glass[0].emissiveIntensity > .8 && glass[0].emissiveIntensity < 1.5, 'bright enough for the night bloom, not blown out');
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
  assert.equal(mergedGlass.length, 1, 'completed growth rejoins the shared glass bucket');
  for (const material of mergedGlass) {
    assert.equal(material.isMeshStandardNodeMaterial, true);
    assert.equal(material.emissiveIntensity, nightIntensity, 'new merged windows inherit night immediately');
  }
  districts.setNight(false);
  for (const material of mergedGlass) assert.equal(material.emissiveIntensity, 0);
  const disposed = new Set(); mergedGlass.forEach(material => material.addEventListener('dispose', () => disposed.add(material)));
  districts.dispose(); assert.equal(disposed.size, mergedGlass.length); assert.equal(ctx.listeners, 0);
});

test('at night floodlights wash every island and a ring of lights circles the plaza: instanced, additive, none by day', () => {
  const ctx = context(), districts = createDistricts(ctx, { levels });
  const fixtures = ctx.scene.getObjectByName('city-district-floodlights'), pools = ctx.scene.getObjectByName('city-district-light-pools');
  const islands = ctx.world.districts.length;
  assert.ok(fixtures.isInstancedMesh && pools.isInstancedMesh, 'one draw call per kind');
  assert.equal(fixtures.count, islands * 4 + 16 + 24, 'four floodlights an island, 16 on the pedestal, 24 round the plaza');
  assert.equal(pools.count, islands * 4 + 1 + 24);
  for (const mesh of [fixtures, pools]) {
    assert.equal(mesh.material.blending, THREE.AdditiveBlending); assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.castShadow, false);
  }
  ctx.frame(0);
  assert.deepEqual([fixtures.visible, pools.visible], [false, false], 'the day draws none of them');
  ctx.night.set(true, true); ctx.frame(16);
  assert.deepEqual([fixtures.visible, pools.visible], [true, true]);
  const matrix = new THREE.Matrix4(), p = new THREE.Vector3();
  for (let i = 0; i < islands * 4; i++) {
    const d = ctx.world.districts[Math.floor(i / 4)], r = Math.hypot(p.setFromMatrixPosition((fixtures.getMatrixAt(i, matrix), matrix)).x - d.x, p.z - d.z);
    assert.ok(r > 5 && r < ctx.world.spec.islet - .5, `floodlight ${i} stands on its island, off the plot`);
  }
  // The uplight rides on the opaque finishes' emissive node; glass keeps the switched emissive colour.
  const opaque = materials(ctx.scene).filter(material => material.isMeshStandardNodeMaterial && !material.userData.districtGlass && !material.map);
  assert.ok(opaque.length >= 2 && opaque.every(material => material.emissiveNode), 'walls get the floodlights\' wash');
  assert.ok(windows(ctx.scene).every(material => !material.emissiveNode));
  let lights = 0; ctx.scene.traverse(object => { if (object.isLight) lights++; });
  assert.equal(lights, 0, 'no light sources');
  ctx.night.set(false, true); ctx.frame(32);
  assert.deepEqual([fixtures.visible, pools.visible], [false, false]);
  districts.dispose(); assert.equal(ctx.scene.children.length, 0); assert.equal(ctx.listeners, 0);
});

const signOf = (scene, id) => {
  let sign;
  scene.traverse(object => {
    if (object.isMesh && object.material.map && object.userData.districts?.includes(id)) sign = object;
  });
  return sign;
};
const watch = resource => {
  let calls = 0; resource.addEventListener('dispose', () => calls++);
  return () => calls;
};

test('setLevels refreshes one changed district and retains city resources, anchors, picking and selection', () => {
  const ctx = context(), districts = createDistricts(ctx, { levels: {} });
  const outside = new THREE.Group(); outside.name = 'unchanged-terrain'; ctx.scene.add(outside);
  const root = ctx.scene.getObjectByName('city-districts');
  const allSigns = new Map(ctx.world.districts.filter(d => !d.id.startsWith('future-')).map(d => [d.id, signOf(root, d.id)]));
  const oldCrm = allSigns.get('crm');
  const disposedGeometry = watch(oldCrm.geometry), disposedMaterial = watch(oldCrm.material), disposedTexture = watch(oldCrm.material.map);
  const otherResources = [...allSigns].filter(([id]) => id !== 'crm').map(([id, mesh]) => ({ id, mesh, geometry: mesh.geometry, geometryDisposed: watch(mesh.geometry), texture: mesh.material.map, textureDisposed: watch(mesh.material.map) }));
  const fixtures = ctx.scene.getObjectByName('city-district-floodlights'), site = ctx.scene.getObjectByName('city-construction-sites');
  const lightsGeometry = fixtures.geometry, siteGeometry = site.geometry;
  const pickables = districts.pickables, crmHit = pickables.find(hit => hit.userData.district === 'crm');
  const anchors = districts.anchors, crmAnchor = anchors.get('crm'), previousHeight = crmAnchor.y;
  const glass = windows(root)[0], glassDisposed = watch(glass);
  districts.select('crm'); districts.hover('academy'); districts.setNight(true); ctx.frame(0);
  const rings = root.children.filter(mesh => mesh.geometry?.type === 'TorusGeometry');
  const activeRings = rings.filter(mesh => mesh.visible);
  assert.equal(activeRings.length, 2);

  // One changed sign is a direct observation that only one architecture was generated.
  const originalCreate = document.createElement; let canvases = 0;
  document.createElement = (...args) => { if (args[0] === 'canvas') canvases++; return originalCreate(...args); };
  try { districts.setLevels({ crm: 2 }); } finally { document.createElement = originalCreate; }
  assert.equal(canvases, 1, 'only the changed district regenerated its canvas-backed landmark');
  assert.equal(disposedGeometry(), 1); assert.equal(disposedMaterial(), 1); assert.equal(disposedTexture(), 1);
  assert.notEqual(signOf(root, 'crm'), oldCrm);
  for (const old of otherResources) {
    assert.equal(signOf(root, old.id), old.mesh, `${old.id} sign mesh stays intact`);
    assert.equal(old.mesh.geometry, old.geometry); assert.equal(old.mesh.material.map, old.texture);
    assert.equal(old.geometryDisposed(), 0); assert.equal(old.textureDisposed(), 0);
  }
  assert.equal(districts.anchors, anchors); assert.equal(anchors.get('crm'), crmAnchor);
  assert.ok(crmAnchor.y > previousHeight);
  assert.equal(districts.pickables, pickables); assert.equal(pickables.find(hit => hit.userData.district === 'crm'), crmHit);
  assert.ok(Math.abs(crmHit.position.y + crmHit.scale.y / 2 + .7 - crmAnchor.y) < 1e-9);
  assert.equal(fixtures.geometry, lightsGeometry); assert.equal(site.geometry, siteGeometry); assert.equal(outside.parent, ctx.scene);
  assert.equal(windows(root)[0], glass); assert.equal(glassDisposed(), 0); assert.ok(glass.emissiveIntensity > 0);
  ctx.frame(16); assert.deepEqual(rings.filter(mesh => mesh.visible), activeRings, 'selection and hover survive');
  assert.equal(districts.startGrowth(), null, 'no requested growth is manufactured');
  districts.dispose(); outside.removeFromParent(); assert.equal(ctx.scene.children.length, 0);
});

test('unchanged, saturated and unavailable district levels do no rebuild work', () => {
  const ctx = context(), initial = { crm: 4, academy: 2 }, districts = createDistricts(ctx, { levels: initial });
  const root = ctx.scene.getObjectByName('city-districts'), before = [...root.children];
  const signatures = before.filter(mesh => mesh.isMesh).map(mesh => [mesh, mesh.geometry, mesh.material]);
  const originalCreate = document.createElement; let canvases = 0;
  document.createElement = (...args) => { if (args[0] === 'canvas') canvases++; return originalCreate(...args); };
  try {
    districts.setLevels({ ...initial }, ['crm']);
    districts.setLevels({ ...initial, crm: 99, 'future-1': 99, nowhere: 10 });
  } finally { document.createElement = originalCreate; }
  assert.equal(canvases, 0); assert.deepEqual(root.children, before);
  for (const [mesh, geometry, material] of signatures) { assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material); }
  assert.equal(districts.startGrowth(), null, 'a replayed unchanged snapshot never grows again');
  districts.dispose();
});

test('successive updates grow again, replace an in-flight district safely and keep night through merging', () => {
  const ctx = context(), districts = createDistricts(ctx, { levels: {} });
  const root = ctx.scene.getObjectByName('city-districts'); districts.setNight(true);
  const currentGrowth = id => root.children.find(group => group.isGroup && group.userData.district === id);
  districts.setLevels({ crm: 1 }, ['crm']);
  const first = currentGrowth('crm'); assert.ok(first && first.scale.y < .1);
  assert.equal(districts.startGrowth(), 'crm'); assert.equal(districts.startGrowth(), null);
  ctx.frame(performance.now() + 1050); assert.ok(first.parent);
  let sourceSign; first.traverse(mesh => { if (mesh.isMesh && mesh.material.map) sourceSign = mesh; });
  const oldGeometry = watch(sourceSign.geometry), oldSign = watch(sourceSign.material), oldTexture = watch(sourceSign.material.map);
  districts.setLevels({ crm: 2 }, ['crm']);
  assert.equal(first.parent, null); assert.equal(oldGeometry(), 1); assert.equal(oldSign(), 1); assert.equal(oldTexture(), 1);
  const second = currentGrowth('crm'); assert.ok(second && second !== first);
  assert.equal(districts.startGrowth(), 'crm'); ctx.frame(performance.now() + 2200);
  assert.equal(second.parent, null); assert.ok(!currentGrowth('crm'));
  assert.equal(windows(root).length, 1); assert.ok(windows(root)[0].emissiveIntensity > 0);
  districts.setLevels({ crm: 3, academy: 1 }, ['crm', 'academy']);
  assert.equal(districts.startGrowth(), 'academy');
  const waiting = ['crm', 'academy'].map(currentGrowth); assert.ok(waiting.every(Boolean));
  ctx.frame(performance.now() + 2400); assert.ok(waiting.every(group => !group.parent));
  assert.ok(windows(root)[0].emissiveIntensity > 0);
  districts.setNight(false); assert.equal(windows(root)[0].emissiveIntensity, 0);
  districts.dispose(); assert.equal(ctx.listeners, 0); assert.equal(ctx.scene.children.length, 0);
});

test('repeated updates stay bounded, dispose replaced signs and honor reduced motion', () => {
  const ctx = context(); ctx.reducedMotion = true;
  const districts = createDistricts(ctx, { levels: {} }), root = ctx.scene.getObjectByName('city-districts');
  const counts = [], old = [];
  for (let i = 0; i < 16; i++) {
    const sign = signOf(root, 'crm');
    old.push([watch(sign.geometry), watch(sign.material), watch(sign.material.map)]);
    districts.setLevels({ crm: i % 2 ? 0 : 4 }, ['crm']);
    assert.equal(districts.startGrowth(), null); assert.ok(!root.children.some(child => child.isGroup));
    counts.push(geometryCount(root));
  }
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'replacements do not accumulate draw calls');
  for (const disposals of old) for (const disposed of disposals) assert.equal(disposed(), 1, 'replaced resources are released exactly once');
  districts.dispose(); districts.setLevels({ crm: 2 }, ['crm']); districts.dispose();
  assert.equal(ctx.scene.children.length, 0); assert.equal(ctx.listeners, 0);
});
