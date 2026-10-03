import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  stdin: { contents: 'export * from "./estates.ts"; export * from "../engine/camera.ts"; export * from "../assets/catalogue.ts"; export * from "../world/familyHouses.ts"; export * from "../world/land.ts"; export * from "../world/landLayouts.ts"; export * from "../world/officeBuildings.ts"; export * from "../world/districtLandmark.ts"; export * from "../world/cities.ts"; export * from "../world/worldSpec.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
  plugins: [{ name: 'url', setup(b) {
    b.onResolve({ filter: /\?url$/ }, a => ({ path: a.path, namespace: 'url' }));
    b.onLoad({ filter: /.*/, namespace: 'url' }, a => ({ contents: `export default ${JSON.stringify(a.path)};`, loader: 'js' }));
  } }],
});
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { THREE } = city, world = city.islandWorld(city.WORLD_X4), grid = city.landGrid(world), frame = grid.plots[0];
class Element extends EventTarget {
  style = {}; dataset = {}; clientWidth = 800; clientHeight = 800;
  children = []; attributes = {}; nodes = new Map(); parent = null;
  setAttribute(name, value) { this.attributes[name] = value; }
  append(element) { this.children.push(element); element.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  querySelector(selector) { if (!this.nodes.has(selector)) this.nodes.set(selector, new Element()); return this.nodes.get(selector); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800 }; }
  focus() { document.activeElement = this; }
  setPointerCapture() {}
  releasePointerCapture() {}
  getContext() { return new Proxy({}, { get: (_, key) => key === 'measureText' ? () => ({ width: 0 }) : () => {}, set: () => true }); }
}
globalThis.document = { createElement: () => new Element(), body: new Element(), activeElement: null };
globalThis.window = new EventTarget(); globalThis.Node = Element; globalThis.HTMLElement = Element;
const districtId = `support-team-${frame.district}`;
const object = (family = 'officea', extra = {}) => ({ id: 7, family, level: 1, owner: 'mine', module: frame.block, u: frame.col, v: frame.row, w: 1, h: 1, rotation: 0, ...extra });
function setup(targetGrid = grid) {
  const canvas = new Element(), camera = new THREE.PerspectiveCamera(36, 1, 1, 800), picks = [];
  const ctx = { world, scene: new THREE.Scene(), renderer: { domElement: canvas }, camera, overlay: new Element(), quality: { lodDistances: [40, 100, 250] }, reducedMotion: true, requestShadowUpdate() {}, onFrame: () => () => {}, onCameraMove: () => () => {}, onQuality: () => () => {} };
  const estates = city.createEstates(ctx, targetGrid, pick => picks.push(pick));
  const state = (objects, sandbox = false, extra = {}) => estates.set({ state: { city: 'support', sandbox, districts: [{ id: districtId, name: 'Тестовый район', number: frame.district, objects, projects: [], land: { open_band: grid.bands }, ...extra }] } });
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
  return { estates, camera, picks, state, build, aim, tap, ctx };
}

test('normal exploration hides plot grids; personal build shows only own land and preserves permanent centre paving', () => {
  const s = setup(); s.state([]);
  const plots = s.ctx.scene.getObjectByName('district-plots'), centres = s.ctx.scene.getObjectByName('district-centres');
  for (const ground of [plots, centres]) {
    assert.equal(ground.material.polygonOffset, true, 'nearly coplanar terrain cannot fragment the land at a whole-district camera distance');
    assert.ok(ground.material.polygonOffsetFactor < 0 && ground.material.polygonOffsetUnits < 0, 'ground depth is biased toward the camera');
    assert.equal(ground.material.depthTest, true, 'houses and offices still occlude the ground');
    assert.equal(ground.material.depthWrite, true);
    assert.equal(ground.renderOrder, 0, 'the land keeps normal scene depth ordering');
  }
  assert.equal(plots.visible, false);
  assert.equal(centres.visible, true);
  assert.ok(centres.geometry.index.count > 0, 'HQ and community-square paving has its own permanent mesh');
  const paving = centres.geometry.index.array.slice(), indexBuffer = plots.geometry.index;
  for (const number of [1, 2, 3]) {
    s.estates.setBuild({ district: `support-team-${number}`, area: 'plots', placing: null, selected: null, plot: null });
    assert.equal(plots.visible, true);
    const { start, count } = plots.geometry.drawRange;
    assert.equal(count, grid.plots.filter(p => p.district === number).length * 6, 'foreign districts have no visible grid triangles');
    assert.equal(plots.geometry.index, indexBuffer, 'changing build district reuses the same GPU index buffer');
    const position = plots.geometry.getAttribute('position');
    for (let i = start; i < start + count; i += 3) {
      const vertices = Array.from(indexBuffer.array.slice(i, i + 3));
      const point = { x: vertices.reduce((sum, vertex) => sum + position.getX(vertex), 0) / 3, z: vertices.reduce((sum, vertex) => sum + position.getZ(vertex), 0) / 3 };
      assert.equal(city.plotAt(grid, point).block.district, number, 'every rendered triangle belongs to the chosen district');
    }
    assert.deepEqual(centres.geometry.index.array, paving);
  }
  s.estates.setActive(false); assert.equal(plots.visible, false);
  s.build(null); assert.equal(plots.visible, false, 'background build updates never reveal an inactive grid');
  s.estates.setActive(true); assert.equal(plots.visible, true);
  s.estates.setBuild({ district: districtId, area: 'public', placing: null, selected: null, plot: null });
  assert.equal(plots.visible, false);
  assert.equal(centres.visible, true);
  s.estates.setBuild(null); assert.equal(plots.visible, false);
  s.estates.dispose();
  assert.equal(s.ctx.scene.getObjectByName('district-plots'), undefined);
  assert.equal(s.ctx.scene.getObjectByName('district-centres'), undefined);
});

test('empty community square and its visible invitation open shared projects; paid objects and project sites retain priority', () => {
  const s = setup(), centre = grid.centres.find(c => c.district === frame.district), point = new THREE.Vector3(centre.square.x, .2, centre.square.z);
  s.state([]); s.aim(point, centre.square.rotation + .55);
  const signLayer = s.ctx.overlay.children[0], invitation = signLayer.children[0];
  s.estates.setBuild(null);
  assert.equal(invitation.querySelector('strong').textContent, 'Площадь команды');
  assert.match(invitation.attributes['aria-label'], /Открыть общие проекты/);
  assert.equal(invitation.style.visibility, 'visible');
  invitation.onclick(); assert.deepEqual(s.picks, [{ kind: 'public', district: districtId }]);
  s.picks.length = 0; s.tap(point); assert.deepEqual(s.picks, [{ kind: 'public', district: districtId }]);
  s.state([object('fountain', { module: 0, u: 5, v: 5, w: 2, h: 2 })]);
  s.picks.length = 0; s.tap(point); assert.deepEqual(s.picks, [{ kind: 'object', district: districtId, object: 7 }]);
  s.state([], false, { projects: [{ id: 88, name: 'Парк', family: 'park', target_id: null, u: 5, v: 5, w: 3, h: 2, rotation: 0, progress: 0 }] });
  s.picks.length = 0; s.tap(point); assert.deepEqual(s.picks, [{ kind: 'project', district: districtId, project: 88 }]);
  s.estates.setActive(false); assert.equal(signLayer.hidden, true);
  s.estates.setActive(true); assert.equal(signLayer.hidden, false);
  s.estates.dispose(); assert.equal(s.ctx.overlay.children.length, 0);
});

test('the community-square cell grid appears only during project placement and its invitation clears the preview', () => {
  const s = setup(), centre = grid.centres.find(c => c.district === frame.district), point = new THREE.Vector3(centre.square.x, .2, centre.square.z);
  s.state([]); s.aim(point, centre.square.rotation + .55);
  const cells = s.ctx.scene.getObjectByName('district-project-grid'), invitation = s.ctx.overlay.children[0].children[0];
  s.estates.setBuild({ district: districtId, area: 'public', placing: null, selected: null, plot: null });
  assert.equal(cells.visible, false, 'browsing the shared-project catalogue does not cover the courtyard with a grid');
  assert.equal(invitation.style.visibility, 'visible');
  s.estates.setBuild({ district: districtId, area: 'public', placing: { family: 'fountain', rotation: 0, moving: null }, selected: null, plot: null });
  assert.equal(cells.visible, true);
  assert.equal(cells.geometry.getAttribute('position').count, 13 * 2 * 2, 'the same complete 12 × 12 grid remains available');
  assert.equal(invitation.style.visibility, 'hidden');
  s.picks.length = 0; s.tap(point); assert.equal(s.picks.at(-1).kind, 'place');
  s.estates.setBuild(null); assert.equal(cells.visible, false);
  assert.equal(invitation.style.visibility, 'visible');
  s.estates.dispose();
});

test('personal build focus includes every own plot, including occupied land and all expansion bands', () => {
  const s = setup(), centre = grid.centres.find(c => c.district === frame.district), own = grid.plots.filter(p => p.district === frame.district);
  const occupied = own[0];
  s.state([object('house', { module: occupied.block, u: occupied.col, v: occupied.row })], false, { land: { open_band: 1 } });
  s.build(null);
  const focus = s.estates.focus({ district: districtId, kind: 'district' }, 48, .86);
  assert.ok(focus.bounds, 'the runtime receives an area to fit instead of a single nearby plot');
  for (const plot of own) for (const corner of plot.corners) {
    assert.ok(focus.bounds.containsPoint(new THREE.Vector3(corner.x, .203, corner.z)), 'all own land remains in the camera area');
  }
  assert.deepEqual(focus.point.toArray(), focus.bounds.getCenter(new THREE.Vector3()).toArray());
  s.state(own.map((plot, id) => object('house', { id, module: plot.block, u: plot.col, v: plot.row })));
  const full = s.estates.focus({ district: districtId, kind: 'district' }, 48, .86);
  assert.deepEqual(full.bounds, focus.bounds, 'a fully occupied district still frames its land and buildings');
  const close = s.estates.focus({ district: districtId, kind: 'plot', plot: { block: occupied.block, col: occupied.col, row: occupied.row } }, 30, .86);
  assert.equal(close.bounds, undefined, 'a chosen cell keeps the close purchase view');
  s.estates.setBuild(null);
  const overview = s.estates.focus({ district: districtId, kind: 'district' }, 48, .86);
  assert.equal(overview.bounds, undefined);
  assert.ok(Math.hypot(overview.point.x - centre.area.x, overview.point.z - centre.area.z) < 1e-8, 'normal district overview still focuses the centre');
  s.estates.dispose();
});

test('taps in a fitted whole-district camera select the exact free grid address across the outer land', () => {
  const s = setup(), canvas = s.ctx.renderer.domElement;
  const freeFrame = { getBoundingClientRect: () => ({ left: 200, top: 30, right: 740, bottom: 670, width: 540, height: 640 }) };
  const rig = city.createCameraRig(s.camera, { dom: canvas, host: canvas, frame: freeFrame, radius: world.radius, reach: world.radius + 20, reducedMotion: true, onView() {} });
  rig.resize(800, 800);
  for (const number of [1, 2, 3]) {
    const id = `support-team-${number}`, own = grid.plots.filter(p => p.district === number);
    s.estates.set({ state: { city: 'support', sandbox: false, districts: [{ id, number, name: 'Район', objects: [], projects: [], land: { open_band: 1 } }] } });
    s.estates.setBuild({ district: id, area: 'plots', placing: null, selected: null, plot: null });
    const focus = s.estates.focus({ district: id, kind: 'district' }, 48, .86);
    rig.focusBounds(focus.bounds, focus.azimuth, .5, 0);
    assert.ok(rig.currentView().distance > 140 * world.radius / 150, 'the actual estate picker works beyond the former camera limit');
    for (const plot of [own[0], own[Math.floor(own.length / 2)], own.at(-1)]) {
      s.picks.length = 0; s.tap(new THREE.Vector3(plot.x, .2, plot.z));
      assert.deepEqual(s.picks, [{ kind: 'plot', district: id, block: plot.block, col: plot.col, row: plot.row, band: plot.band, problem: null }]);
    }
  }
  rig.dispose(); s.estates.dispose();
});

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

test('visible house roofs and ready-house facades select the building instead of a free cell behind it', () => {
  const s = setup(), definition = city.READY_HOUSES.attic;
  const geometry = new THREE.BoxGeometry(definition.width, definition.height, definition.depth).translate(1, definition.height / 2 + .3, -2);
  geometry.computeBoundingBox();
  const catalogue = city.createCatalogue(new Map([['family-house-3-brick', {
    name: 'family-house-3-brick', bounds: geometry.boundingBox.clone(),
    parts: [{ geometry, material: new THREE.MeshStandardMaterial(), castShadow: true }],
  }]]));
  s.estates.setCatalogue(catalogue);
  for (const [family, level] of [['house', 1], ['house', 2], ['house', 5], ['attic', 1]]) {
    s.state([object(family, { level })]); s.build(null);
    s.aim(new THREE.Vector3(frame.x, 1, frame.z));
    const layout = city.plotLayout(frame, family, level, 7), candidates = [];
    for (const placement of layout.placements) {
      if (placement.kind !== 'roof' && placement.kind !== 'family-house') continue;
      const matrix = new THREE.Matrix4(), model = catalogue.resolve(placement, matrix);
      if (!model) continue;
      const box = model.bounds, middle = box.getCenter(new THREE.Vector3());
      for (const z of [box.min.z + .05, box.max.z - .05]) {
        candidates.push(new THREE.Vector3(middle.x, box.max.y - .05, z).applyMatrix4(matrix));
      }
    }
    const missedRoof = candidates.find(point => {
      const p = point.clone().project(s.camera), caster = new THREE.Raycaster();
      if (Math.abs(p.x) >= 1 || Math.abs(p.y) >= 1) return false;
      caster.setFromCamera(new THREE.Vector2(p.x, p.y), s.camera);
      const ground = caster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -.2), new THREE.Vector3());
      const at = ground && city.plotAt(grid, ground);
      return !at || at.block.block !== frame.block || at.col !== frame.col || at.row !== frame.row;
    });
    assert.ok(missedRoof, `${family} level ${level} has a visible roof/facade whose old ground-only pick misses the building`);
    s.picks.length = 0; s.tap(missedRoof);
    assert.deepEqual(s.picks, [{ kind: 'object', district: districtId, object: 7 }]);
    const free = grid.plots.find(p => p.district === frame.district && p.block === frame.block && p.col !== frame.col);
    s.aim(new THREE.Vector3(free.x, 1, free.z)); s.picks.length = 0;
    s.tap(new THREE.Vector3(free.x, .2, free.z));
    assert.equal(s.picks.at(-1)?.kind, 'plot', 'house body bounds do not cover a neighboring free plot');
  }
  s.estates.dispose(); catalogue.dispose();
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

const landmark = (level = 1, status = 'active') => ({ status, level, name: 'Павильон команды', module: 0, u: 0, v: 0, w: 12, h: 12, rotation: 0, taken: 0, plots: 1119, peak: 0, next: null });

test('the growing team complex focuses its real architecture and facade clicks open district development in real and sandbox cities', () => {
  const s = setup(), centre = grid.centres.find(c => c.district === frame.district);
  const reserved = city.districtMainFrame(centre, landmark());
  for (const sandbox of [false, true]) for (const level of [1, 5]) {
    s.state([], sandbox, { landmark: landmark(level) }); s.build(null); s.picks.length = 0;
    const bounds = city.landmarkBounds(reserved, level), focus = s.estates.focus({ district: districtId, kind: 'public' }, 48, .86);
    assert.ok(Math.abs(focus.point.y - (bounds.bottom + bounds.height / 2)) < 1e-9);
    assert.ok(Math.abs(focus.point.x - bounds.x) < 1e-9 && Math.abs(focus.point.z - bounds.z) < 1e-9);
    const invitation = s.ctx.overlay.children[0].children[0];
    assert.equal(invitation.querySelector('strong').textContent, 'Главное здание · Тестовый район');
    assert.match(invitation.attributes['aria-label'], new RegExp(`Уровень ${level} из 5`));
    invitation.onclick(); assert.deepEqual(s.picks.pop(), { kind: 'public', district: districtId });
    // Aim horizontally at the tower: no ground intersection exists, yet its visible facade must be clickable.
    const local = level === 5 ? { x: 0, z: -1.05, y: 14 } : { x: 0, z: -.25, y: 1.4 };
    const c = Math.cos(reserved.rotation), sin = Math.sin(reserved.rotation);
    const point = new THREE.Vector3(reserved.x + c * local.x + sin * local.z, local.y, reserved.z - sin * local.x + c * local.z);
    s.camera.position.copy(point).add(new THREE.Vector3(sin * 35, 0, c * 35)); s.camera.lookAt(point); s.camera.updateMatrixWorld(true);
    s.tap(point);
    assert.deepEqual(s.picks, [{ kind: 'public', district: districtId }]);
  }
  s.state([object('fountain', { module: 0, u: 5, v: 5, w: 2, h: 2 })], false, { landmark: landmark(5, 'legacy_occupied') });
  s.picks.length = 0; const ground = new THREE.Vector3(centre.square.x, .2, centre.square.z); s.aim(ground); s.tap(ground);
  assert.deepEqual(s.picks, [{ kind: 'object', district: districtId, object: 7 }], 'legacy objects keep picking priority beside the main building');
  s.estates.dispose();
});

test('the whole complex reservation rejects stale public placement and shows no cell grid', () => {
  const s = setup(), centre = grid.centres.find(c => c.district === frame.district);
  s.state([], false, { landmark: landmark() }); s.aim(new THREE.Vector3(centre.square.x, .2, centre.square.z));
  s.estates.setBuild({ district: districtId, area: 'public', placing: { family: 'fountain', rotation: 0, moving: null }, selected: null, plot: null });
  assert.equal(s.ctx.scene.getObjectByName('district-project-grid').visible, false);
  s.tap(new THREE.Vector3(centre.square.x, .2, centre.square.z));
  assert.equal(s.picks.at(-1).kind, 'place');
  assert.match(s.picks.at(-1).problem, /Площадь занята комплексом команды/);
  s.estates.dispose();
});

test('changes to complex levels rebuild their pooled models, while occupancy-only progress preserves geometry', () => {
  const s = setup(), resolved = [];
  s.ctx.quality = { lodDistances: [120, 260, 600] }; s.ctx.onQuality = () => () => {};
  s.state([], false, { landmark: landmark() });
  s.estates.setCatalogue({ resolve(placement) { if (placement.kind === 'district-landmark') resolved.push(placement.variant); return null; } });
  assert.deepEqual(resolved, [0]);
  s.state([], false, { landmark: { ...landmark(), taken: 20 } });
  assert.deepEqual(resolved, [0], 'progress alone does not churn the model pools');
  s.state([], false, { landmark: landmark(5) });
  assert.deepEqual(resolved, [0, 4]);
  s.state([], true, { landmark: landmark(2) });
  assert.deepEqual(resolved, [0, 4, 1], 'sandbox has its own complex level');
  s.state([], false, { landmark: landmark(5, 'legacy_occupied') });
  assert.deepEqual(resolved, [0, 4, 1, 4], 'legacy districts also have one growing main building on the former HQ site');
  s.estates.dispose(); assert.equal(s.ctx.scene.getObjectByName('city-instances'), undefined);
});

test('every land district has exactly one main model, with old paid square coordinates preserved', () => {
  const s = setup(), resolved = [];
  s.ctx.quality = { lodDistances: [120, 260, 600] }; s.ctx.onQuality = () => () => {};
  const districts = grid.centres.map(c => ({ id: `support-team-${c.district}`, name: `Район ${c.district}`, number: c.district,
    objects: c.district === 2 ? [object('fountain', { module: 0, u: 5, v: 5, w: 2, h: 2 })] : [], projects: [], land: { open_band: 1 }, landmark: landmark(5, c.district === 2 ? 'legacy_occupied' : 'active') }));
  s.estates.set({ state: { city: 'support', districts } });
  s.estates.setCatalogue({ resolve(placement) { resolved.push(placement); return null; } });
  const mains = resolved.filter(p => p.kind === 'district-landmark');
  assert.equal(mains.length, 3);
  for (const c of grid.centres) {
    const expected = city.districtMainFrame(c, districts.find(d => d.number === c.district).landmark);
    assert.equal(mains.filter(p => p.x === expected.x && p.z === expected.z && p.width === expected.width && p.depth === expected.depth).length, 1);
  }
  const legacy = grid.centres.find(c => c.district === 2), at = new THREE.Vector3(legacy.square.x, .2, legacy.square.z);
  s.picks.length = 0; s.aim(at, legacy.square.rotation + .55); s.tap(at);
  assert.deepEqual(s.picks, [{ kind: 'object', district: 'support-team-2', object: 7 }]);
  s.estates.dispose();
});

test('outer plots can be purchased and receive inventory even when cached state still says only band 1 is open', () => {
  const s = setup(), outer = grid.plots.find(p => p.district === frame.district && p.band === grid.bands);
  s.state([], false, { land: { open_band: 1 } }); s.build(null);
  const point = new THREE.Vector3(outer.x, .2, outer.z);
  s.aim(point, outer.rotation + .55); s.tap(point);
  assert.equal(s.picks.at(-1).kind, 'plot'); assert.equal(s.picks.at(-1).problem, null);
  s.picks.length = 0; s.build({ family: 'house', rotation: 0, moving: 20 }); s.tap(point);
  assert.equal(s.picks.at(-1).kind, 'place'); assert.equal(s.picks.at(-1).problem, null);
  s.estates.dispose();
});
