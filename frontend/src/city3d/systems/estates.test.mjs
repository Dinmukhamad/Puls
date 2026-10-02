import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  stdin: { contents: 'export * from "./estates.ts"; export * from "../world/land.ts"; export * from "../world/landLayouts.ts"; export * from "../world/officeBuildings.ts"; export * from "../world/cities.ts"; export * from "../world/worldSpec.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
});
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { THREE } = city, world = city.islandWorld(city.WORLD_X4), grid = city.landGrid(world), frame = grid.plots[0];
class Element extends EventTarget {
  style = {}; clientWidth = 800; clientHeight = 800;
  setAttribute() {} append() {} remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 800 }; }
}
globalThis.document = { createElement: () => new Element() };
const districtId = `support-team-${frame.district}`;
const object = (family = 'officea', extra = {}) => ({ id: 7, family, level: 1, owner: 'mine', module: frame.block, u: frame.col, v: frame.row, w: 1, h: 1, rotation: 0, ...extra });
function setup(targetGrid = grid) {
  const canvas = new Element(), camera = new THREE.PerspectiveCamera(36, 1, 1, 800), picks = [];
  const ctx = { world, scene: new THREE.Scene(), renderer: { domElement: canvas }, camera, overlay: new Element(), reducedMotion: true, requestShadowUpdate() {}, onFrame: () => () => {}, onCameraMove: () => () => {} };
  const estates = city.createEstates(ctx, targetGrid, pick => picks.push(pick));
  const state = (objects, sandbox = false) => estates.set({ state: { city: 'support', sandbox, districts: [{ id: districtId, number: frame.district, objects, projects: [], land: { open_band: grid.bands } }] } });
  const build = placing => estates.setBuild({ district: districtId, area: 'plots', placing, selected: null, plot: null });
  const aim = (point, azimuth = frame.rotation + .55, aspect = 1) => {
    camera.aspect = aspect; camera.updateProjectionMatrix();
    camera.position.copy(point).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(30, .86, azimuth)));
    camera.lookAt(point); camera.updateMatrixWorld(true);
  };
  const tap = point => {
    const p = point.clone().project(camera), options = { isPrimary: true, clientX: (p.x + 1) * 400, clientY: (1 - p.y) * 400, pointerType: 'mouse' };
    for (const type of ['pointerdown', 'pointerup']) canvas.dispatchEvent(Object.assign(new Event(type), options));
  };
  return { estates, camera, picks, state, build, aim, tap };
}

test('clicking a tall office facade selects its card before the ground behind it, in the real and sandbox cities', () => {
  const s = setup(), bounds = city.officeBuildingBounds('officea', frame);
  const front = new THREE.Vector3(bounds.x + Math.sin(bounds.rotation) * bounds.depth / 2, 6.8, bounds.z + Math.cos(bounds.rotation) * bounds.depth / 2);
  s.aim(new THREE.Vector3(frame.x, 1, frame.z));
  const p = front.clone().project(s.camera), caster = new THREE.Raycaster(); caster.setFromCamera(new THREE.Vector2(p.x, p.y), s.camera);
  const ground = caster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -.2), new THREE.Vector3());
  const delta = ground.clone().sub(new THREE.Vector3(frame.x, .2, frame.z)), c = Math.cos(frame.rotation), sin = Math.sin(frame.rotation);
  assert.ok(Math.abs(delta.x * c - delta.z * sin) > frame.width / 2 || Math.abs(delta.x * sin + delta.z * c) > frame.depth / 2, 'the old ground-only picker misses this visible facade');
  assert.ok(city.officeBuildingRayDistance('officea', frame, caster.ray.origin, caster.ray.direction) > 0);
  for (const sandbox of [false, true]) {
    s.state([object('officea', { owner: sandbox ? 'resident' : 'mine' })], sandbox); s.build(null); s.picks.length = 0;
    s.tap(front);
    assert.deepEqual(s.picks, [{ kind: 'object', district: districtId, object: 7 }]);
  }
  s.build({ family: 'officea', rotation: 0, moving: 20 }); s.picks.length = 0;
  s.tap(front);
  assert.ok(s.picks.every(pick => pick.kind !== 'object'), 'inventory placement keeps picking the ground');
  s.state([]); s.build(null); s.picks.length = 0;
  s.tap(new THREE.Vector3(frame.x, .2, frame.z));
  assert.equal(s.picks.at(-1).kind, 'plot', 'ordinary free plots remain selectable');
  s.estates.dispose();
});

test('the nearest office facade wins over a farther office listed first, even when the ray misses the ground', () => {
  const targetGrid = {
    city: 'support', bands: 1, centres: [], plots: [],
    blocks: [{ district: frame.district, block: 11, band: 1, cols: 1, rows: 2, skip: new Set(), streets: { z1: true }, shape: { kind: 'rect', x0: -4.5, x1: 4.5, z0: -13.5, z1: 4.5 } }],
  };
  const s = setup(targetGrid);
  s.state([object('officea', { id: 9, module: 11, u: 0, v: 0 }), object('officea', { module: 11, u: 0, v: 1 })]);
  s.build(null); s.picks.length = 0;
  s.camera.position.set(0, 6, 20); s.camera.lookAt(0, 6, 0); s.camera.updateMatrixWorld(true);
  s.tap(new THREE.Vector3(0, 6, 0));
  assert.deepEqual(s.picks, [{ kind: 'object', district: districtId, object: 7 }]);
  s.estates.dispose();
});

test('every office focuses on its actual centre and keeps the complete tower visible in square and portrait cameras', () => {
  const s = setup();
  for (const family of Object.keys(city.OFFICE_BUILDINGS)) {
    s.state([object(family)]);
    const focus = s.estates.focus({ kind: 'object', district: districtId, object: 7 }, 30, .86), bounds = city.officeBuildingBounds(family, frame);
    assert.ok(Math.abs(focus.point.y - (.2 + bounds.height / 2)) < 1e-9);
    assert.ok(Math.abs(focus.point.x - bounds.x) < 1e-9 && Math.abs(focus.point.z - bounds.z) < 1e-9);
    for (const aspect of [.5, 1]) {
      s.aim(focus.point, focus.azimuth, aspect);
      const c = Math.cos(bounds.rotation), sin = Math.sin(bounds.rotation);
      for (const x of [-bounds.width / 2, bounds.width / 2]) for (const z of [-bounds.depth / 2, bounds.depth / 2]) for (const y of [.2, .2 + bounds.height]) {
        const projected = new THREE.Vector3(bounds.x + c * x + sin * z, y, bounds.z - sin * x + c * z).project(s.camera);
        assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1, `${family} fits the ${aspect} aspect camera`);
      }
    }
  }
  s.estates.dispose();
});

test('office ray bounds reject misses and behind-camera objects and order nearer towers first', () => {
  const f = { x: 0, z: 0, rotation: 0, width: 9, depth: 9 }, origin = { x: 0, y: 6, z: 20 }, direction = { x: 0, y: 0, z: -1 };
  const near = city.officeBuildingRayDistance('officea', f, origin, direction), far = city.officeBuildingRayDistance('officea', { ...f, z: -10 }, origin, direction);
  assert.ok(near > 0 && far > near);
  assert.equal(city.officeBuildingRayDistance('officea', f, origin, { x: 0, y: 0, z: 1 }), null);
  assert.equal(city.officeBuildingRayDistance('officea', f, { ...origin, x: 10 }, direction), null);
  assert.equal(city.officeBuildingRayDistance('officea', f, { ...origin, y: 20 }, direction), null);
});
