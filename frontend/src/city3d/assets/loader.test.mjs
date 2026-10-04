import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  stdin: { contents: 'export * from "./loader.ts"; export { loadCatalogueModels } from "./catalogue.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
  plugins: [{ name: 'controlled-gltf-decoding', setup(plugin) {
    plugin.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'model-url' }));
    plugin.onLoad({ filter: /.*/, namespace: 'model-url' }, args => ({ contents: `export default ${JSON.stringify(args.path.replace(/\?url$/, ''))};`, loader: 'js' }));
    plugin.onResolve({ filter: /\/GLTFLoader\.js$/ }, () => ({ path: 'gltf', namespace: 'controlled-gltf' }));
    plugin.onLoad({ filter: /.*/, namespace: 'controlled-gltf' }, () => ({ contents: `
      export class GLTFLoader {
        constructor(manager) { this.manager = manager; }
        setMeshoptDecoder() {}
        parseAsync(bytes, path) { return globalThis.__cityModels.parse(bytes, path, this.manager); }
      }`, loader: 'js' }));
  } }],
});
const { loadModels, loadCharacter, loadCatalogueModels, disposeModels, MODEL_LOAD_TIMEOUT_MS, THREE } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function fixture(t) {
  const saved = new Map(['fetch', '__cityModels', 'setTimeout', 'clearTimeout', 'performance'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const timers = new Map(), downloads = [], parses = [], managers = [];
  let timerId = 0;
  const state = {
    now: 0,
    download: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(24) }),
    decode: async () => source().gltf,
    parse(bytes, path, manager) { parses.push({ bytes, path }); managers.push(manager); return state.decode(bytes, path, manager); },
  };
  Object.assign(globalThis, {
    __cityModels: state,
    performance: { now: () => state.now },
    fetch(url, options) { downloads.push({ url, signal: options.signal }); return state.download(url, options); },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  t.after(() => { for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  return { state, timers, downloads, parses, managers,
    expire() { state.now += Math.max(0, ...[...timers.values()].map(timer => timer.delay)); for (const [id, { callback }] of [...timers]) { timers.delete(id); callback(); } },
  };
}
function source() {
  const geometry = new THREE.BoxGeometry(), map = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map });
  const counts = { geometry: 0, material: 0, texture: 0 };
  geometry.addEventListener('dispose', () => counts.geometry++); material.addEventListener('dispose', () => counts.material++); map.addEventListener('dispose', () => counts.texture++);
  const root = new THREE.Group(); root.name = 'house'; root.position.set(3, 0, 0); root.add(new THREE.Mesh(geometry, material));
  // A second scene shares resources, as glTF kits do.
  const other = new THREE.Group(); other.name = 'house-copy'; other.add(new THREE.Mesh(geometry, material));
  return { gltf: { scene: root, scenes: [root, other], animations: [] }, counts, geometry, material, map };
}

test('a stalled download has a deadline and aborts the underlying fetch', async t => {
  const f = fixture(t); f.state.download = () => new Promise(() => {});
  const pending = loadModels('/timeout.glb');
  const rejection = assert.rejects(pending, { name: 'TimeoutError' });
  assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [MODEL_LOAD_TIMEOUT_MS]);
  f.expire(); await rejection;
  assert.equal(f.downloads[0].signal.aborted, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.parses.length, 0);
});

test('a decode completing after timeout disposes all scenes and their shared resources once', async t => {
  const f = fixture(t), decoded = deferred(), kit = source(); f.state.decode = () => decoded.promise;
  const pending = loadModels('/late-decode.glb'); await flush();
  const rejection = assert.rejects(pending, { name: 'TimeoutError' });
  f.expire(); await rejection;
  assert.equal(f.managers[0].abortController.signal.aborted, false, 'LoadingManager renews its abort controller after cancelling child requests');
  decoded.resolve(kit.gltf); await flush();
  assert.deepEqual(kit.counts, { geometry: 1, material: 1, texture: 1 });
});

test('disposing a startup cancels decoding promptly and frees a late character', async t => {
  const f = fixture(t), decoded = deferred(), kit = source(), controller = new AbortController(); f.state.decode = () => decoded.promise;
  const pending = loadCharacter('/cancel-character.glb', { signal: controller.signal }); await flush();
  const rejection = assert.rejects(pending, { name: 'AbortError' });
  controller.abort(); await rejection;
  assert.equal(f.timers.size, 0);
  decoded.resolve(kit.gltf); await flush();
  assert.deepEqual(kit.counts, { geometry: 1, material: 1, texture: 1 });
});

test('completed file bytes are reused while every scene gets independent owned geometry and materials', async t => {
  const f = fixture(t), kits = []; f.state.decode = () => { const kit = source(); kits.push(kit); return Promise.resolve(kit.gltf); };
  const first = await loadModels('/reusable/kit.glb'), second = await loadModels('/reusable/kit.glb');
  assert.equal(f.downloads.length, 1, 'a renderer rebuild does not download the same kit again');
  assert.equal(f.parses.length, 2, 'mutable decoded scenes are never cached');
  assert.equal(f.parses[0].path, '/reusable/');
  assert.notEqual(first.get('house').parts[0].geometry, second.get('house').parts[0].geometry);
  assert.notEqual(first.get('house').parts[0].material, second.get('house').parts[0].material);
  assert.equal(first.get('house').bounds.min.x, 2.5, 'model transforms are still baked into geometry');
  assert.deepEqual(kits.map(kit => kit.counts), [{ geometry: 1, material: 0, texture: 0 }, { geometry: 1, material: 0, texture: 0 }], 'unused source geometry is freed, source materials belong to the catalogue');
  assert.equal(f.timers.size, 0);
});

test('HTTP errors and already cancelled loads do not start decoding or leave a deadline timer', async t => {
  const f = fixture(t); f.state.download = async () => ({ ok: false, status: 503 });
  await assert.rejects(loadModels('/unavailable.glb'), /503/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadModels('/already-cancelled.glb', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.downloads.length, 1); assert.equal(f.parses.length, 0); assert.equal(f.timers.size, 0);
});

test('generated full kits load once with their base models and named LODs; source kits are not downloaded', async t => {
  const f = fixture(t);
  f.state.download = url => {
    const data = new Uint8Array(24); data[0] = url === '/preferred/city-models.glb' ? 1 : url === '/preferred/vehicles.glb' ? 2 : 3;
    return Promise.resolve({ ok: true, arrayBuffer: async () => data.buffer });
  };
  f.state.decode = bytes => {
    const marker = new Uint8Array(bytes)[0], kit = source(), name = marker === 1 ? 'building' : marker === 2 ? 'taxi' : 'extra';
    kit.gltf.scene.name = name; kit.gltf.scenes[1].name = `${name}__lod1`;
    const lod2 = new THREE.Group(); lod2.name = `${name}__lod2`; lod2.add(new THREE.Mesh(kit.geometry, kit.material)); kit.gltf.scenes.push(lod2);
    return Promise.resolve(kit.gltf);
  };
  const models = await loadCatalogueModels(['/preferred/city-models.glb', '/preferred/vehicles.glb']);
  for (const name of ['building', 'taxi']) for (const suffix of ['', '__lod1', '__lod2']) assert.ok(models.has(`${name}${suffix}`), `${name}${suffix} survives generated kit loading`);
  assert.equal(f.downloads.length, 4, 'only two full kits, houses and offices are downloaded');
  assert.equal(f.downloads.some(download => /\/pages\/city\/models\/(?:city-models|vehicles)\.glb$/.test(download.url)), false);
  disposeModels(models);
});

test('a missing generated kit falls back to the source within the same fifteen-second asset budget', async t => {
  const f = fixture(t);
  f.state.download = url => {
    if (url === '/missing/city-models.glb') { f.state.now = 9000; return Promise.resolve({ ok: false, status: 503 }); }
    if (url.endsWith('/models/city-models.glb')) return new Promise(() => {});
    return Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(24) });
  };
  const pending = loadCatalogueModels(['/missing/city-models.glb']); await flush();
  const fallback = f.downloads.find(download => download.url.endsWith('/models/city-models.glb'));
  assert.ok(fallback, 'a fast generated-kit failure tries its source');
  assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [6000], 'the fallback has the remaining budget, never another fifteen seconds');
  f.expire(); const models = await pending;
  assert.equal(fallback.signal.aborted, true); assert.equal(f.state.now, MODEL_LOAD_TIMEOUT_MS); assert.ok(models.size > 0);
  disposeModels(models);
});

test('a generated kit returning 404 keeps the successfully decoded source model available', async t => {
  const f = fixture(t);
  f.state.download = url => {
    if (url === '/404/city-models.glb') return Promise.resolve({ ok: false, status: 404 });
    const data = new Uint8Array(24); if (url.endsWith('/models/city-models.glb')) data[0] = 55;
    return Promise.resolve({ ok: true, arrayBuffer: async () => data.buffer });
  };
  f.state.decode = bytes => {
    const kit = source(); if (new Uint8Array(bytes)[0] === 55) kit.gltf.scene.name = 'source-from-fallback';
    return Promise.resolve(kit.gltf);
  };
  const models = await loadCatalogueModels(['/404/city-models.glb']);
  assert.ok(models.has('source-from-fallback')); assert.equal(f.timers.size, 0);
  assert.equal(f.downloads.filter(download => download.url.endsWith('/models/city-models.glb')).length, 1);
  disposeModels(models);
});

test('overwritten models free unused geometry while geometry, materials and textures retained by another model stay alive', t => {
  fixture(t);
  const obsolete = source(), activeGeometry = new THREE.BoxGeometry(), unusedGeometry = new THREE.BoxGeometry(), replacement = source(), counts = { activeGeometry: 0, unusedGeometry: 0 };
  activeGeometry.addEventListener('dispose', () => counts.activeGeometry++);
  unusedGeometry.addEventListener('dispose', () => counts.unusedGeometry++);
  const discarded = new Map([['old', { parts: [{ geometry: obsolete.geometry, material: obsolete.material }, { geometry: unusedGeometry, material: obsolete.material }] }]]);
  const retained = new Map([
    ['same-name', { parts: [{ geometry: replacement.geometry, material: replacement.material }] }],
    ['shared-material', { parts: [{ geometry: activeGeometry, material: obsolete.material }] }],
    ['shared-geometry', { parts: [{ geometry: obsolete.geometry, material: replacement.material }] }],
  ]);
  disposeModels(discarded, retained);
  assert.deepEqual(obsolete.counts, { geometry: 0, material: 0, texture: 0 }); assert.deepEqual(counts, { activeGeometry: 0, unusedGeometry: 1 });
  disposeModels(retained);
  assert.deepEqual(obsolete.counts, { geometry: 1, material: 1, texture: 1 }); assert.equal(counts.activeGeometry, 1);
});

test('one stalled optional LOD settles on the deadline while successfully loaded catalogue models remain usable', async t => {
  const f = fixture(t);
  f.state.download = (url) => url === '/stalled-lod.glb' ? new Promise(() => {}) : Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(24) });
  const pending = loadCatalogueModels(['/stalled-lod.glb', '/stalled-lod.glb']); await flush();
  assert.equal(f.downloads.filter(download => download.url === '/stalled-lod.glb').length, 1, 'duplicate file URLs are loaded once');
  f.expire(); const models = await pending;
  assert.ok(models.has('house')); assert.ok(models.has('house-copy'), 'the usable kits survive a failed LOD');
  assert.equal(f.downloads.find(download => download.url === '/stalled-lod.glb').signal.aborted, true);
  assert.equal(f.timers.size, 0);
});
