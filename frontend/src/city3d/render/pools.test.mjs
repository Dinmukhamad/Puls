import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The instance pools with three, in one bundle; a made-up catalogue of a big model and a small one.
const built = await build({
  stdin: { contents: 'export * from "./instances.ts"; export * as cells from "./cells.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
});
const pools = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { THREE, cells } = pools;

/** A model whose bounds are a box of `size`, one part, three LOD slots holding the same level (docs/CITY_V4.md). */
function model(id, size) {
  const geometry = new THREE.BoxGeometry(size, size, size), level = { parts: [{ geometry, material: new THREE.MeshStandardNodeMaterial(), castShadow: true }] };
  return { id, lods: [level, level, level], bounds: new THREE.Box3(new THREE.Vector3(-size / 2, 0, -size / 2), new THREE.Vector3(size / 2, size, size / 2)) };
}
const big = model('big', 3), small = model('small', .8);
/** A model with three different levels (architecture LOD, assets/architectureLod.ts): a copy moves between pools by distance. */
const tower = (() => {
  const level = (segments) => ({ parts: [{ geometry: new THREE.CylinderGeometry(1, 1, 4, segments), material: new THREE.MeshStandardNodeMaterial(), castShadow: true }] });
  return { id: 'tower', lods: [level(24), level(12), level(6)], bounds: new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 4, 1)) };
})();
const catalogue = { resolve(placement, matrix) { matrix.makeTranslation(placement.x, 0, placement.z); return placement.kind === 'small' ? small : placement.kind === 'tower' ? tower : big; } };

/** Big and small copies every 6 units over ±300; a camera looking down at the middle from `height`. */
function city({ hooked = true, height = 40, towers = false } = {}) {
  const placements = [];
  for (let x = -300; x <= 300; x += 6) for (let z = -300; z <= 300; z += 6) placements.push({ kind: towers && !(x % 30) && !(z % 30) ? 'tower' : (x / 6 + z / 6) % 2 ? 'small' : 'big', x, z, rotation: 0 });
  const camera = new THREE.PerspectiveCamera(36, 1.6, .5, 4000);
  camera.position.set(0, height, height * .8); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const frames = new Set(), moves = new Set(), shadows = new Set(), quality = { lodDistances: [40, 120, 250], smallReach: 200, staticShadowSize: 2048 };
  let requests = 0;
  const ctx = {
    camera, scene: new THREE.Scene(), world: { radius: 320 }, get quality() { return quality; },
    onFrame(cb) { frames.add(cb); return () => frames.delete(cb); }, onCameraMove(cb) { moves.add(cb); return () => moves.delete(cb); },
    onQuality() { return () => {}; }, requestShadowUpdate() { requests++; },
    ...(hooked ? { onShadowRedraw(cb) { shadows.add(cb); return () => shadows.delete(cb); } } : {}),
  };
  const instance = pools.createInstancePools(ctx, catalogue, placements);
  const meshes = () => ctx.scene.children[0].children;
  const drawn = () => meshes().reduce((sum, mesh) => sum + (mesh.visible ? mesh.geometry.instanceCount : 0), 0);
  /** What the shadow pass draws: three calls onBeforeShadow / onAfterShadow around each caster (ShadowNode). */
  const shadowDrawn = () => meshes().reduce((sum, mesh) => {
    if (!mesh.visible) return sum;
    mesh.onBeforeShadow(); const count = mesh.geometry.instanceCount; mesh.onAfterShadow();
    return sum + count;
  }, 0);
  let now = 1000;
  const frame = (ms = 16) => { now += ms; frames.forEach(cb => cb(ms / 1000, now)); };
  const move = (x, y, z) => { camera.position.set(x, y, z); camera.lookAt(x, 0, z - y * .8); camera.updateMatrixWorld(); moves.forEach(cb => cb()); frame(200); };
  return { instance, ctx, camera, meshes, drawn, shadowDrawn, frame, move, redraw: () => shadows.forEach(cb => cb()), get requests() { return requests; } };
}

test('the frame draws the tight selection; the shadow pass of a redraw frame draws the wide one as well', () => {
  const c = city(), tight = c.drawn();
  assert.ok(tight > 0);
  assert.equal(c.shadowDrawn(), tight);
  // Without the hook (a bare context) the frame draws the wide selection, as the shadow map needs it.
  const wide = city({ hooked: false }).drawn();
  assert.ok(wide > tight * 1.3, `wide ${wide} vs tight ${tight}`);
  c.redraw();
  // The frame's copies stay; the extra casters come after them, for the shadow pass alone.
  assert.equal(c.drawn(), tight);
  assert.ok(c.shadowDrawn() >= wide, `shadow pass ${c.shadowDrawn()} vs wide ${wide}`);
  for (const mesh of c.meshes()) assert.equal(mesh.geometry.instanceCount <= mesh.geometry.getAttribute('copyTint').count, true);
  // The next frame forgets them.
  c.frame();
  assert.equal(c.drawn(), tight);
  assert.equal(c.shadowDrawn(), tight);
});

test('an update that leaves the copies as they were uploads nothing; a change uploads only from its first changed slot', () => {
  const c = city(), pool = c.meshes()[0].geometry.getAttribute('copyMatrix0').data;
  const version = pool.version;
  c.instance.update(); c.frame(); c.instance.update();
  assert.equal(pool.version, version, 'the same view uploads nothing');
  pool.clearUpdateRanges();
  c.move(c.camera.position.x + 20, c.camera.position.y, c.camera.position.z);
  assert.ok(pool.version > version);
  assert.equal(pool.updateRanges.length, 1);
  const { start, count } = pool.updateRanges[0];
  assert.equal(start % 16, 0); assert.equal(count % 16, 0);
  assert.ok(start + count <= c.meshes()[0].geometry.instanceCount * 16 && count > 0, `${start}+${count}`);
});

test('small things are hidden beyond their distance and cast shadows only in close views', () => {
  const near = city({ height: 30 }), smallMesh = (c) => c.meshes().find(mesh => mesh.geometry.getAttribute('position').count === 24 && mesh.geometry.index && new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position')).max.x < .5);
  assert.equal(smallMesh(near).castShadow, true);
  const far = city({ height: 260 });
  assert.equal(smallMesh(far).castShadow, false, 'a far view: no small shadows');
  // Far away, small copies beyond 200 units are not drawn while big ones are.
  far.redraw();
  const matrices = (mesh) => { const out = [], data = mesh.geometry.getAttribute('copyMatrix3').data.array; for (let k = 0; k < mesh.geometry.instanceCount; k++) out.push(new THREE.Vector3(data[k * 16 + 12], data[k * 16 + 13], data[k * 16 + 14])); return out; };
  const camera = far.camera.position, smallOnes = matrices(smallMesh(far)), bigOnes = matrices(far.meshes().find(mesh => mesh !== smallMesh(far)));
  assert.ok(smallOnes.every(p => p.distanceTo(camera) < 200 * 1.06 + 1), 'small copies stay within their distance');
  assert.ok(bigOnes.some(p => p.distanceTo(camera) > 230), 'big copies are drawn farther');
  // Zooming in brings the small shadows back, with a redraw asked for.
  const before = far.requests;
  far.move(0, 30, 24); far.frame(200); far.frame(200);
  assert.ok(far.requests > before);
  far.redraw();
  assert.equal(smallMesh(far).castShadow, true);
});

test('a copy that changes level moves between its model\'s pools, and each pool uploads only within its copies', () => {
  const c = city({ towers: true, height: 14 });
  // A copy mesh shares its source's attributes (copies.ts copyGeometry): that finds each level's pool.
  const towerPools = tower.lods.map(level => c.meshes().find(mesh => mesh.geometry.getAttribute('position') === level.parts[0].geometry.getAttribute('position')));
  assert.ok(towerPools.every(Boolean), 'one pool per level');
  const counts = () => towerPools.map(mesh => mesh.geometry.instanceCount);
  const before = counts();
  assert.ok(before[0] > 0, `near towers in the full level: ${before}`);
  towerPools.forEach(mesh => mesh.geometry.getAttribute('copyMatrix0').data.clearUpdateRanges());
  // From afar the same towers draw their middle and far levels.
  c.move(0, 140, 112); c.frame(200);
  const after = counts();
  assert.ok(after[0] < before[0] && after[1] + after[2] > before[1] + before[2], `levels: ${before} → ${after}`);
  for (const mesh of towerPools) for (const range of mesh.geometry.getAttribute('copyMatrix0').data.updateRanges) assert.ok(range.start + range.count <= mesh.geometry.instanceCount * 16);
});

test('empty pools are hidden, so three skips them', () => {
  const c = city();
  for (const mesh of c.meshes()) assert.equal(mesh.visible, mesh.geometry.instanceCount > 0);
  c.move(5000, 40, 5000);
  for (const mesh of c.meshes()) { assert.equal(mesh.geometry.instanceCount, 0); assert.equal(mesh.visible, false); }
  assert.ok(pools.CULL_MARGIN > cells.TIGHT_MARGIN);
});
