import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  stdin: { contents: 'export * from "./estates.ts"; export * from "../render/night.ts"; export * from "../engine/camera.ts"; export * from "../assets/catalogue.ts"; export * from "../world/familyHouses.ts"; export * from "../world/land.ts"; export * from "../world/districtGarden.ts"; export * from "../world/landLayouts.ts"; export * from "../world/officeBuildings.ts"; export * from "../world/districtLandmark.ts"; export * from "../world/cities.ts"; export * from "../world/worldSpec.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
  plugins: [{ name: 'url', setup(b) {
    b.onResolve({ filter: /\?url$/ }, a => ({ path: a.path, namespace: 'url' }));
    b.onLoad({ filter: /.*/, namespace: 'url' }, a => ({ contents: `export default ${JSON.stringify(a.path)};`, loader: 'js' }));
  } }],
});
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { THREE } = city, world = city.islandWorld(city.WORLD_X4), grid = city.landGrid(world), cells = city.landCells(grid);
// The tests' building plot: 3 × 3 cells of district 1's third band, facing the middle of the city (no road beside it),
// two cells in from the corner of a window of 15 × 14 cells all for sale (the block is a rectangle round its band's cells).
const home = grid.blocks.find(b => b.district === 1 && b.band === 3);
const [plotCol, plotRow] = (() => {
  const kept = Array.from({ length: home.cols + 1 }, () => new Int32Array(home.rows + 1));
  for (let c = 0; c < home.cols; c++) for (let r = 0; r < home.rows; r++) kept[c + 1][r + 1] = kept[c][r + 1] + kept[c + 1][r] - kept[c][r] + (home.skip.has(`${c}:${r}`) ? 1 : 0);
  for (let c = 0; c + 15 <= home.cols; c++) for (let r = 0; r + 14 <= home.rows; r++) if (kept[c + 15][r + 14] - kept[c][r + 14] - kept[c + 15][r] + kept[c][r] === 0) return [c + 2, r + 2];
  throw new Error('no free land for the tests');
})();
const frame = { ...city.areaFrame(home, plotCol, plotRow, city.CELLS, city.CELLS), district: 1, block: home.block, col: plotCol, row: plotRow, band: home.band };
const blockOf = cell => grid.blocks.find(b => b.district === cell.district && b.block === cell.block);
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
const object = (family = 'officea', extra = {}) => ({ id: 7, family, level: 1, owner: 'mine', module: frame.block, u: frame.col, v: frame.row, w: 3, h: 3, rotation: 0, ...extra });
function setup(targetGrid = grid) {
  const canvas = new Element(), camera = new THREE.PerspectiveCamera(36, 1, 1, 800), picks = [];
  const ctx = { world, scene: new THREE.Scene(), renderer: { domElement: canvas }, camera, overlay: new Element(), quality: { lodDistances: [40, 100, 250] }, night: city.createNight(false), reducedMotion: true, requestShadowUpdate() {}, onFrame: () => () => {}, onCameraMove: () => () => {}, onQuality: () => () => {} };
  const estates = city.createEstates(ctx, targetGrid, pick => picks.push(pick));
  const state = (objects, sandbox = false, extra = {}) => estates.set({ state: { city: 'support', sandbox, districts: [{ id: districtId, name: 'Тестовый район', number: frame.district, objects, projects: [], land: { open_band: grid.bands }, ...extra }] } });
  const build = placing => estates.setBuild({ district: districtId, area: 'plots', placing, selected: null, plot: null });
  const aim = (point, azimuth = frame.rotation + .55, aspect = 1, polar = .86) => {
    camera.aspect = aspect; camera.updateProjectionMatrix();
    camera.position.copy(point).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(30, polar, azimuth)));
    camera.lookAt(point); camera.updateMatrixWorld(true);
  };
  const screen = point => { const p = point.clone().project(camera); return { clientX: (p.x + 1) * 400, clientY: (1 - p.y) * 400 }; };
  const tap = point => {
    const options = { isPrimary: true, ...screen(point), pointerType: 'mouse', pointerId: 1, button: 0 };
    for (const type of ['pointerdown', 'pointerup']) canvas.dispatchEvent(Object.assign(new Event(type), options));
  };
  /** A drag with the mouse's left button, from one point of the ground to another. */
  /** A drag with the mouse, by default with its left button and no key held; `during` runs before it is let go. */
  const drag = (from, to, { button = 0, ctrlKey = false, metaKey = false, during } = {}) => {
    const base = { isPrimary: true, pointerType: 'mouse', pointerId: 1, button, ctrlKey, metaKey };
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), base, screen(from)));
    for (let k = 1; k <= 8; k++) canvas.dispatchEvent(Object.assign(new Event('pointermove'), base, { buttons: button === 2 ? 2 : 1 }, screen(from.clone().lerp(to, k / 8))));
    during?.();
    canvas.dispatchEvent(Object.assign(new Event('pointerup'), base, screen(to)));
  };
  return { estates, camera, picks, state, build, aim, tap, drag, ctx };
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
    assert.equal(count, cells.filter(c => c.district === number).length * 6, 'foreign districts have no visible grid triangles');
    assert.equal(plots.geometry.index, indexBuffer, 'changing build district reuses the same GPU index buffer');
    const position = plots.geometry.getAttribute('position');
    for (let i = start; i < start + count; i += 3) {
      const vertices = Array.from(indexBuffer.array.slice(i, i + 3));
      const point = { x: vertices.reduce((sum, vertex) => sum + position.getX(vertex), 0) / 3, z: vertices.reduce((sum, vertex) => sum + position.getZ(vertex), 0) / 3 };
      assert.equal(city.cellAt(grid, point).block.district, number, 'every rendered triangle belongs to the chosen district');
    }
    assert.deepEqual(centres.geometry.index.array, paving);
  }
  // The grid draws its own white lines from each cell's coordinates: unlit and out of the shadows, so it does not
  // shimmer; whole cells side by side, with nothing under them.
  assert.ok(plots.material.isMeshBasicNodeMaterial && plots.material.colorNode, 'an unlit grid with its own lines');
  assert.equal(plots.receiveShadow, false); assert.equal(plots.castShadow, false);
  const uv = plots.geometry.getAttribute('cellUv');
  assert.equal(uv.itemSize, 2); assert.equal(uv.count, plots.geometry.getAttribute('position').count);
  assert.deepEqual(Array.from(uv.array.slice(0, 8)), [0, 0, 1, 0, 1, 1, 0, 1]);
  assert.equal(s.ctx.scene.getObjectByName('district-seams'), undefined);
  assert.ok(centres.receiveShadow, 'the gardens\' paving stays lit ground');
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

test('every centre is a garden round its main building, its lamps lit at night; an old square keeps its own look', () => {
  const s = setup(); s.state([]);
  const halos = () => s.ctx.scene.getObjectByName('district-lamp-garden-halos'), lamps = () => halos().geometry.instanceCount;
  const gardens = grid.centres.map(c => city.districtGarden(grid.blocks.find(b => b.district === c.district && b.block === c.block), c));
  assert.equal(lamps(), gardens.reduce((sum, g) => sum + g.lamps.length, 0), 'every garden\'s lamps');
  // The centres' ground is the gardens' lawn, paths and paving, laid out once.
  const colours = s.ctx.scene.getObjectByName('district-centres').geometry.getAttribute('color'), lawn = new THREE.Color(city.GARDEN_LAWN);
  assert.ok(Array.from({ length: colours.count }, (_, i) => i).some(i => Math.abs(colours.getX(i) - lawn.r) < 1e-6 && Math.abs(colours.getY(i) - lawn.g) < 1e-6), 'the lawn');
  // A district whose old square still holds projects keeps that square beside its building, without the garden.
  s.state([], false, { landmark: { status: 'legacy_occupied', level: 1, module: 0, u: 0, v: 0, w: 12, h: 12, rotation: 0 } });
  assert.equal(lamps(), gardens.reduce((sum, g, i) => sum + (grid.centres[i].district === frame.district ? 0 : g.lamps.length), 0));
  assert.ok(s.ctx.scene.getObjectByName('city-patches'), 'the old square\'s paving');
  s.estates.dispose();
  assert.equal(halos(), undefined);
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

test('personal build focus includes every own cell, including occupied land and all expansion bands', () => {
  const s = setup(), centre = grid.centres.find(c => c.district === frame.district), own = cells.filter(c => c.district === frame.district);
  const occupied = own[0];
  s.state([object('house', { module: occupied.block, u: occupied.col, v: occupied.row })], false, { land: { open_band: 1 } });
  s.build(null);
  const focus = s.estates.focus({ district: districtId, kind: 'district' }, 48, .86);
  assert.ok(focus.bounds, 'the runtime receives an area to fit instead of a single nearby plot');
  for (const cell of own) for (const corner of cell.corners) {
    assert.ok(focus.bounds.containsPoint(new THREE.Vector3(corner.x, focus.bounds.min.y, corner.z)), 'all own land remains in the camera area');
  }
  assert.deepEqual(focus.point.toArray(), focus.bounds.getCenter(new THREE.Vector3()).toArray());
  // Houses over the whole district, 3 × 3 cells each.
  const filled = own.filter(c => c.col % 3 === 0 && c.row % 3 === 0 && c.col + 3 <= blockOf(c).cols && c.row + 3 <= blockOf(c).rows);
  s.state(filled.map((cell, id) => object('house', { id, module: cell.block, u: cell.col, v: cell.row })));
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

test('taps in a fitted whole-district camera pick the one cell tapped, across the outer land', () => {
  const s = setup(), canvas = s.ctx.renderer.domElement;
  const freeFrame = { getBoundingClientRect: () => ({ left: 200, top: 30, right: 740, bottom: 670, width: 540, height: 640 }) };
  const rig = city.createCameraRig(s.camera, { dom: canvas, host: canvas, frame: freeFrame, radius: world.radius, reach: world.radius + 20, reducedMotion: true, onView() {} });
  rig.resize(800, 800);
  for (const number of [1, 2, 3]) {
    const id = `support-team-${number}`, own = cells.filter(c => c.district === number);
    s.estates.set({ state: { city: 'support', sandbox: false, districts: [{ id, number, name: 'Район', objects: [], projects: [], land: { open_band: 1 } }] } });
    s.estates.setBuild({ district: id, area: 'plots', placing: null, selected: null, plot: null });
    const focus = s.estates.focus({ district: id, kind: 'district' }, 48, .86);
    rig.focusBounds(focus.bounds, focus.azimuth, .5, 0);
    assert.ok(rig.currentView().distance > 140 * world.radius / 150, 'the actual estate picker works beyond the former camera limit');
    for (const cell of [own[0], own[Math.floor(own.length / 2)], own.at(-1)]) {
      s.picks.length = 0; s.tap(new THREE.Vector3(cell.x, .2, cell.z));
      assert.deepEqual(s.picks, [{ kind: 'plot', district: id, block: cell.block, col: cell.col, row: cell.row, band: cell.band, problem: null }]);
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
  // The attic's model in both finishes, whichever the house's seed picks.
  const names = [0, 1].map(finish => city.houseModelName((definition.model - 1) * 2 + finish));
  const catalogue = city.createCatalogue(new Map(names.map(name => [name, {
    name, bounds: geometry.boundingBox.clone(),
    parts: [{ geometry, material: new THREE.MeshStandardMaterial(), castShadow: true }],
  }])));
  s.estates.setCatalogue(catalogue);
  for (const [family, level] of [['house', 1], ['house', 2], ['house', 5], ['attic', 1]]) {
    s.state([object(family, { level })]); s.build(null);
    const layout = city.plotLayout(frame, family, level, 7), candidates = [];
    for (const placement of layout.placements) {
      if (placement.kind !== 'roof' && placement.kind !== 'family-house') continue;
      const matrix = new THREE.Matrix4(), model = catalogue.resolve(placement, matrix);
      if (!model) continue;
      // The top's middle and corners at its front and back edges.
      const box = model.bounds, middle = box.getCenter(new THREE.Vector3());
      for (const z of [box.min.z + .05, box.max.z - .05]) for (const x of [middle.x, box.min.x + .05, box.max.x - .05]) {
        candidates.push(new THREE.Vector3(x, box.max.y - .05, z).applyMatrix4(matrix));
      }
    }
    // From in front of the house, lower if need be (a low roof hides little of the ground): where a roof's point seen
    // from the camera lies over the ground beyond the house's cells.
    let missedRoof;
    for (const polar of [.86, 1.1, 1.25]) {
      s.aim(new THREE.Vector3(frame.x, 1, frame.z), frame.rotation + .55, 1, polar);
      missedRoof = candidates.find(point => {
        const p = point.clone().project(s.camera), caster = new THREE.Raycaster();
        if (Math.abs(p.x) >= 1 || Math.abs(p.y) >= 1) return false;
        caster.setFromCamera(new THREE.Vector2(p.x, p.y), s.camera);
        const ground = caster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -.2), new THREE.Vector3());
        const at = ground && city.cellAt(grid, ground);
        return !at || at.block.block !== frame.block || at.col < frame.col || at.col >= frame.col + 3 || at.row < frame.row || at.row >= frame.row + 3;
      });
      if (missedRoof) break;
    }
    assert.ok(missedRoof, `${family} level ${level} has a visible roof/facade whose old ground-only pick misses the building`);
    s.picks.length = 0; s.tap(missedRoof);
    assert.deepEqual(s.picks, [{ kind: 'object', district: districtId, object: 7 }]);
    const free = cells.find(c => c.district === frame.district && c.block === frame.block && c.col === frame.col + 4 && c.row === frame.row + 1);
    s.aim(new THREE.Vector3(free.x, 1, free.z)); s.picks.length = 0;
    s.tap(new THREE.Vector3(free.x, .2, free.z));
    assert.equal(s.picks.at(-1)?.kind, 'plot', 'house body bounds do not cover a neighbouring free cell');
  }
  s.estates.dispose(); catalogue.dispose();
});

test('the nearest office facade wins over a farther office listed first, even when the ray misses the ground', () => {
  const targetGrid = {
    city: 'support', bands: 1, centres: [],
    blocks: [{ district: frame.district, block: 11, band: 1, cols: 3, rows: 6, skip: new Set(), shape: { kind: 'rect', x0: -4.5, x1: 4.5, z0: -13.5, z1: 4.5 } }],
  };
  const s = setup(targetGrid);
  s.state([object('officea', { id: 9, module: 11, u: 0, v: 0 }), object('officea', { module: 11, u: 0, v: 3 })]);
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

test('outer cells can be bought on and receive inventory even when cached state still says only band 1 is open', () => {
  const s = setup(), outer = cells.find(c => c.district === frame.district && c.band === grid.bands && c.col > 2 && c.row > 2 && c.col < blockOf(c).cols - 3 && c.row < blockOf(c).rows - 3);
  s.state([], false, { land: { open_band: 1 } }); s.build(null);
  const point = new THREE.Vector3(outer.x, .2, outer.z);
  s.aim(point, outer.rotation + .55); s.tap(point);
  assert.equal(s.picks.at(-1).kind, 'plot'); assert.equal(s.picks.at(-1).problem, null);
  s.picks.length = 0; s.build({ family: 'house', rotation: 0, moving: 20 }); s.tap(point);
  assert.equal(s.picks.at(-1).kind, 'place'); assert.equal(s.picks.at(-1).problem, null);
  s.estates.dispose();
});

/** A small thing's tool on, as the page sets it: the cells chosen so far. */
const tool = (s, decor) => s.estates.setBuild({ district: districtId, area: 'plots', placing: null, selected: null, plot: null, decor });
const cellPoint = (col, row, block = home) => { const p = city.cellCentre(block, col, row); return new THREE.Vector3(p.x, .2, p.z); };
const chosen = picks => picks.filter(p => p.kind === 'cells').at(-1)?.cells.map(c => [c.block, c.col, c.row]);

test('a small thing\'s tool draws a line of free cells with the mouse; a tap adds a cell or takes it out again', () => {
  const s = setup(), b = home.block;
  // The house on the test plot and a lamp beside it take cells; a tree of a neighbour's too.
  s.state([object('house')], false, { decor: { lamp: [[b, frame.col + 4, frame.row, 1]], tree: [[b, frame.col + 6, frame.row, 0]] } });
  s.aim(cellPoint(frame.col + 4, frame.row + 1), frame.rotation + .55);
  tool(s, { tool: 'road', cells: [], shape: 'line' });
  // A drag from the house's own cell through the lamp's and the tree's along a row and down a column: only free cells.
  s.drag(cellPoint(frame.col + 2, frame.row), cellPoint(frame.col + 8, frame.row + 2));
  const path = city.cellsBetween(grid, { block: home, col: frame.col + 2, row: frame.row }, { block: home, col: frame.col + 8, row: frame.row + 2 });
  const free = path.filter(c => !(c.col <= frame.col + 2 && c.row <= frame.row + 2) && !(c.row === frame.row && (c.col === frame.col + 4 || c.col === frame.col + 6)));
  assert.ok(free.length >= 6 && free.length < path.length, `${free.length} of ${path.length}`);
  assert.deepEqual(chosen(s.picks), free.map(c => [b, c.col, c.row]));
  // The page keeps them; a tap on one of them takes it out, on a free one adds it, on a taken one does nothing.
  const kept = s.picks.at(-1).cells;
  tool(s, { tool: 'road', cells: kept, shape: 'cell' });
  s.picks.length = 0; s.tap(cellPoint(free[0].col, free[0].row));
  assert.deepEqual(chosen(s.picks), kept.slice(1).map(c => [b, c.col, c.row]));
  s.picks.length = 0; s.tap(cellPoint(frame.col + 4, frame.row + 4));
  assert.deepEqual(chosen(s.picks), [...kept, { block: b, col: frame.col + 4, row: frame.row + 4 }].map(c => [b, c.col, c.row]));
  s.picks.length = 0; s.tap(cellPoint(frame.col + 4, frame.row));
  assert.deepEqual(chosen(s.picks), kept.map(c => [b, c.col, c.row]), 'the lamp\'s cell is taken');
  // With lines on, a tap goes on from the last cell: every free cell between.
  tool(s, { tool: 'road', cells: [], shape: 'line' });
  s.picks.length = 0; s.tap(cellPoint(frame.col + 4, frame.row + 5)); s.tap(cellPoint(frame.col + 4, frame.row + 9));
  assert.deepEqual(chosen(s.picks), [5, 6, 7, 8, 9].map(r => [b, frame.col + 4, frame.row + r]));
  // Another district's land is never chosen, nor is anything chosen without a tool.
  const other = grid.blocks.find(x => x.district === 2 && x.band === 3);
  s.picks.length = 0; s.tap(cellPoint(10, 5, other));
  assert.equal(chosen(s.picks), undefined);
  s.estates.dispose();
});

test('the mouse\'s other buttons and fingers keep moving the camera: only the left button draws', () => {
  const s = setup(), canvas = s.ctx.renderer.domElement, seen = [];
  s.state([]); s.aim(cellPoint(frame.col + 4, frame.row + 1), frame.rotation + .55);
  tool(s, { tool: 'tree', cells: [], shape: 'cell' });
  // A listener of the camera's: it hears the presses the tool does not take.
  canvas.addEventListener('pointerdown', event => seen.push([event.pointerType, event.button]));
  const at = point => { const p = point.clone().project(s.camera); return { clientX: (p.x + 1) * 400, clientY: (1 - p.y) * 400 }; };
  for (const [pointerType, button] of [['mouse', 2], ['mouse', 1], ['touch', 0]]) {
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { isPrimary: true, pointerId: 3, pointerType, button }, at(cellPoint(frame.col + 4, frame.row))));
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { isPrimary: true, pointerId: 3, pointerType, button, buttons: 1 }, at(cellPoint(frame.col + 8, frame.row))));
    canvas.dispatchEvent(Object.assign(new Event('pointerup'), { isPrimary: true, pointerId: 3, pointerType, button }, at(cellPoint(frame.col + 8, frame.row))));
  }
  assert.deepEqual(seen, [['mouse', 2], ['mouse', 1], ['touch', 0]]);
  assert.equal(chosen(s.picks), undefined, 'a drag of the camera chooses nothing');
  // The left button's press goes to the tool alone.
  s.drag(cellPoint(frame.col + 4, frame.row), cellPoint(frame.col + 6, frame.row));
  assert.equal(seen.length, 3);
  assert.equal(chosen(s.picks).length, 3);
  // A finger's tap still chooses a cell.
  s.picks.length = 0;
  for (const type of ['pointerdown', 'pointerup']) canvas.dispatchEvent(Object.assign(new Event(type), { isPrimary: true, pointerId: 4, pointerType: 'touch', button: 0 }, at(cellPoint(frame.col + 9, frame.row))));
  assert.deepEqual(chosen(s.picks), [[home.block, frame.col + 9, frame.row]]);
  s.estates.dispose();
});

test('with Ctrl (or Cmd) either button draws an area: every free cell of the rectangle, its size by the pointer', () => {
  const s = setup(), b = home.block, canvas = s.ctx.renderer.domElement, seen = [];
  // A neighbour's tree takes one cell of the area.
  s.state([], false, { decor: { tree: [[b, frame.col + 5, frame.row + 4, 0]] } });
  s.aim(cellPoint(frame.col + 6, frame.row + 4), frame.rotation + .55);
  tool(s, { tool: 'road', cells: [], shape: 'line' });
  canvas.addEventListener('pointerdown', event => seen.push(event.button));
  const from = { block: home, col: frame.col + 3, row: frame.row + 3 }, to = { block: home, col: frame.col + 10, row: frame.row + 4 };
  const area = city.cellsWithin(grid, from, to).filter(c => !(c.col === frame.col + 5 && c.row === frame.row + 4));
  assert.equal(area.length, 8 * 2 - 1);
  // The right button with Ctrl: a road two cells wide, the camera never hears of it.
  const label = s.ctx.overlay.children.find(c => c.className === 'c3-area-size');
  let during = null;
  s.drag(cellPoint(from.col, from.row), cellPoint(to.col, to.row), { button: 2, ctrlKey: true, during: () => { during = { hidden: label.hidden, text: label.textContent }; } });
  assert.deepEqual(seen, [], 'the camera keeps out of it');
  assert.deepEqual(chosen(s.picks).sort(), area.map(c => [b, c.col, c.row]).sort());
  assert.deepEqual(during, { hidden: false, text: '8 × 2 · 15 клеток' }, 'eight cells along, two across, fifteen of them free');
  assert.equal(label.hidden, true, 'the size goes when the area is chosen');
  // The left button with Cmd draws an area too, added to what is chosen; the next tap starts afresh.
  tool(s, { tool: 'road', cells: s.picks.at(-1).cells, shape: 'line' });
  s.picks.length = 0;
  s.drag(cellPoint(frame.col + 3, frame.row + 6), cellPoint(frame.col + 5, frame.row + 8), { metaKey: true });
  assert.equal(chosen(s.picks).length, 15 + 9);
  // Without a key the right button stays the camera's; the left one draws its line.
  tool(s, { tool: 'tree', cells: [], shape: 'cell' }); s.picks.length = 0;
  s.drag(cellPoint(frame.col + 3, frame.row + 6), cellPoint(frame.col + 6, frame.row + 6), { button: 2 });
  assert.deepEqual(seen, [2]); assert.equal(chosen(s.picks), undefined);
  s.estates.dispose();
});

test('in build mode Ctrl chooses cells before any tool: an area by a drag, a cell in or out by a click; a plain tap picks one cell', () => {
  const s = setup(), b = home.block, canvas = s.ctx.renderer.domElement, seen = [];
  // A neighbour's tree takes one cell of the area.
  s.state([], false, { decor: { tree: [[b, frame.col + 5, frame.row + 4, 0]] } });
  s.aim(cellPoint(frame.col + 6, frame.row + 4), frame.rotation + .55);
  s.build(null);
  canvas.addEventListener('pointerdown', event => seen.push(event.button));
  // Ctrl with the left button: every free cell of the rectangle; the camera never hears of it.
  const from = { block: home, col: frame.col + 3, row: frame.row + 3 }, to = { block: home, col: frame.col + 6, row: frame.row + 4 };
  s.drag(cellPoint(from.col, from.row), cellPoint(to.col, to.row), { ctrlKey: true });
  assert.deepEqual(seen, []);
  const area = city.cellsWithin(grid, from, to).filter(c => !(c.col === frame.col + 5 && c.row === frame.row + 4));
  assert.equal(area.length, 4 * 2 - 1);
  assert.deepEqual(chosen(s.picks).sort(), area.map(c => [b, c.col, c.row]).sort());
  // The page keeps them, with no tool yet: a click with Ctrl (or Cmd) adds a cell, another takes it out again.
  const keep = () => s.estates.setBuild({ district: districtId, area: 'plots', placing: null, selected: null, plot: null, decor: { tool: null, cells: s.picks.filter(p => p.kind === 'cells').at(-1).cells, shape: 'cell' } });
  const click = (point, keys) => s.drag(point, point, keys);
  keep(); s.picks.length = 0;
  click(cellPoint(frame.col + 9, frame.row + 1), { ctrlKey: true });
  assert.deepEqual(chosen(s.picks).sort(), [...area.map(c => [b, c.col, c.row]), [b, frame.col + 9, frame.row + 1]].sort());
  keep(); s.picks.length = 0;
  click(cellPoint(frame.col + 9, frame.row + 1), { metaKey: true });
  assert.equal(chosen(s.picks).length, area.length);
  // A taken cell does not come in.
  keep(); s.picks.length = 0;
  click(cellPoint(frame.col + 5, frame.row + 4), { ctrlKey: true });
  assert.equal(chosen(s.picks).length, area.length);
  // Without a key a drag stays the camera's, and a tap picks one cell, for a building or one small thing.
  keep(); s.picks.length = 0;
  s.drag(cellPoint(frame.col + 3, frame.row + 6), cellPoint(frame.col + 6, frame.row + 6));
  assert.deepEqual(seen, [0]); assert.equal(chosen(s.picks), undefined);
  s.tap(cellPoint(frame.col + 9, frame.row + 1));
  assert.deepEqual(s.picks.map(p => [p.kind, p.col, p.row]), [['plot', frame.col + 9, frame.row + 1]]);
  // Placing a building from the inventory, Ctrl does nothing to cells.
  s.estates.setBuild({ district: districtId, area: 'plots', placing: { family: 'house', rotation: 0, moving: 7 }, selected: null, plot: null });
  s.picks.length = 0;
  s.drag(cellPoint(from.col, from.row), cellPoint(to.col, to.row), { ctrlKey: true });
  assert.equal(chosen(s.picks), undefined);
  s.estates.dispose();
});

test('in the area mode a plain drag draws an area, and taps choose it by its two corners', () => {
  const s = setup(), b = home.block;
  s.state([]); s.aim(cellPoint(frame.col + 6, frame.row + 4), frame.rotation + .55);
  tool(s, { tool: 'pine', cells: [], shape: 'area' });
  s.drag(cellPoint(frame.col + 2, frame.row + 2), cellPoint(frame.col + 4, frame.row + 4));
  assert.equal(chosen(s.picks).length, 9, 'a grove of three by three');
  // Taps: the first one a corner, the second the rectangle between them; then a new corner.
  tool(s, { tool: 'pine', cells: [], shape: 'area' }); s.picks.length = 0;
  s.tap(cellPoint(frame.col + 6, frame.row + 2));
  assert.deepEqual(chosen(s.picks), [[b, frame.col + 6, frame.row + 2]]);
  tool(s, { tool: 'pine', cells: s.picks.at(-1).cells, shape: 'area' });
  s.tap(cellPoint(frame.col + 8, frame.row + 3));
  assert.equal(chosen(s.picks).length, 3 * 2);
  tool(s, { tool: 'pine', cells: s.picks.at(-1).cells, shape: 'area' });
  s.tap(cellPoint(frame.col + 10, frame.row + 6));
  assert.equal(chosen(s.picks).length, 3 * 2 + 1, 'a new corner, not a rectangle from the last one');
  // A corner may lie on the district's centre: the area reaches over it and takes only the cells for sale.
  const centre = grid.centres.find(c => c.district === frame.district), block = grid.blocks.find(x => x.district === centre.district && x.block === centre.block);
  tool(s, { tool: 'pine', cells: [], shape: 'area' }); s.picks.length = 0;
  s.aim(cellPoint(centre.col, centre.row + 2, block), centre.area.rotation + .55);
  s.tap(cellPoint(centre.col + 1, centre.row + 2, block));
  tool(s, { tool: 'pine', cells: s.picks.at(-1)?.cells ?? [], shape: 'area' });
  s.tap(cellPoint(centre.col - 2, centre.row + 3, block));
  // The squares beside the centre, whichever block of the district sells each (the island city's blocks overlap).
  const beside = [[-2, 2], [-2, 3], [-1, 2], [-1, 3]].map(([c, r]) => { const at = city.cellAt(grid, city.cellCentre(block, centre.col + c, centre.row + r)); return [at.block.block, at.col, at.row]; });
  assert.deepEqual(chosen(s.picks).sort(), beside.sort());
  s.estates.dispose();
});

test('taking away chooses one\'s own small things only; in the test city anyone\'s', () => {
  const s = setup(), b = home.block, decor = { road: [[b, frame.col + 5, frame.row, 1], [b, frame.col + 6, frame.row, 0]], lamp: [[b, frame.col + 7, frame.row, 1]] };
  s.state([object('house')], false, { decor });
  s.aim(cellPoint(frame.col + 6, frame.row + 1), frame.rotation + .55);
  tool(s, { tool: 'remove', cells: [], shape: 'cell' });
  s.drag(cellPoint(frame.col + 2, frame.row), cellPoint(frame.col + 8, frame.row));
  assert.deepEqual(chosen(s.picks), [[b, frame.col + 5, frame.row], [b, frame.col + 7, frame.row]], 'not the house, a neighbour\'s road or a free cell');
  s.state([], true, { decor });
  tool(s, { tool: 'remove', cells: [], shape: 'cell', anyone: true });
  s.picks.length = 0; s.drag(cellPoint(frame.col + 2, frame.row), cellPoint(frame.col + 8, frame.row));
  assert.deepEqual(chosen(s.picks), [5, 6, 7].map(c => [b, frame.col + c, frame.row]));
  s.estates.dispose();
});

test('small things are drawn: the roads as one paving mesh, trees and lamps with the buildings, lamps lit, their cells taken', () => {
  const s = setup(), b = home.block, resolved = [];
  s.ctx.quality = { lodDistances: [120, 260, 600] }; s.ctx.onQuality = () => () => {};
  s.estates.setCatalogue({ resolve(placement) { resolved.push(placement.kind); return null; } });
  s.state([], false, { decor: { road: [3, 4, 5].map(r => [b, frame.col + 1, frame.row + r, 1]), pine: [[b, frame.col, frame.row + 4, 0]], lamp: [[b, frame.col + 2, frame.row + 4, 1]] } });
  const roads = s.ctx.scene.getObjectByName('district-roads');
  assert.ok(roads && roads.geometry.index.count > 0, 'the roads\' paving');
  assert.ok(resolved.includes('tree-cone') && resolved.includes('lamp'), resolved.join(', '));
  assert.ok(s.ctx.scene.children.some(o => /^district-lamp/.test(o.name)), 'the lamp\'s light');
  // A cell under a road is not free: the tap picks it with its problem.
  s.build(null); s.aim(cellPoint(frame.col + 1, frame.row + 4)); s.picks.length = 0;
  s.tap(cellPoint(frame.col + 1, frame.row + 4));
  assert.equal(s.picks.at(-1).kind, 'plot');
  assert.match(s.picks.at(-1).problem, /уже занята/);
  // Without the small things the paving goes.
  s.state([]);
  assert.equal(s.ctx.scene.getObjectByName('district-roads'), undefined);
  s.estates.dispose();
});

test('a building looks to the road beside it: its frame turns there, and the plot being bought shows where its front will look', () => {
  const s = setup(), b = home.block;
  const state = decor => s.state([object('officea')], false, { decor });
  const front = () => s.estates.focus({ kind: 'object', district: districtId, object: 7 }, 30, .86).azimuth - .55;
  state({});
  assert.ok(Math.abs(front() - frame.rotation) < 1e-9, 'with no road, towards the middle of the city');
  // A road along the plot's far side: the office turns round to it.
  state({ road: [0, 1, 2].map(c => [b, frame.col + c, frame.row + 3, 1]) });
  const turned = city.areaFrame(home, frame.col, frame.row, 3, 3, city.sideOf(home, 'row+'), true);
  assert.ok(Math.abs(Math.sin(front() - turned.rotation)) < 1e-9 && Math.cos(front() - turned.rotation) > 0);
  // A house chosen for a picked cell shows an arrow on the side its front will look to.
  s.estates.setBuild({ district: districtId, area: 'plots', placing: null, selected: null, plot: { block: b, col: frame.col + 7, row: frame.row + 1, rotation: 1, family: 'house' } });
  const arrow = s.ctx.scene.getObjectByName('district-plot-front');
  assert.ok(arrow?.visible, 'the front arrow');
  const expected = city.areaFrame(home, frame.col + 6, frame.row, 3, 3, city.turnedSide(home, city.homeSide(home, frame.col + 6, frame.row, 3, 3), 1));
  assert.ok(Math.abs(Math.sin(arrow.rotation.y - expected.rotation)) < 1e-9 && Math.cos(arrow.rotation.y - expected.rotation) > 0, 'turned once, a quarter turn from the middle of the city');
  s.estates.dispose();
});

/** The cells over the grid now: each quad's colour, by its four corners. */
function shown(s) {
  const mesh = s.ctx.scene.getObjectByName('district-chosen-cells');
  if (!mesh) return [];
  const colour = mesh.geometry.getAttribute('color'), out = [];
  for (let i = 0; i < colour.count; i += 4) out.push(`#${new THREE.Color(colour.getX(i), colour.getY(i), colour.getZ(i)).getHexString()}`);
  return out;
}
const YELLOW = '#ffd24a', GREEN = '#35b07a', RED = '#e0525d';

test('a tap picks one cell; what is chosen for it shows its cells round it, green where free and red where not', () => {
  const s = setup(), b = home.block, footprints = () => s.picks.filter(p => p.kind === 'footprint');
  // The house of the tests on its 3 × 3 cells, and a road down a column two cells off: a lane two cells wide.
  s.state([object('house')], false, { decor: { road: [0, 1, 2, 3, 4].map(r => [b, frame.col + 5, frame.row + r, 1]) } });
  const pick = (col, row, family = null) => s.estates.setBuild({ district: districtId, area: 'plots', placing: null, selected: null, plot: { block: b, col, row, rotation: 0, family } });
  // The cell alone: yellow, nothing to report.
  pick(frame.col + 4, frame.row + 1);
  assert.deepEqual(shown(s), [YELLOW]);
  assert.equal(footprints().length, 0);
  // A square fits in the lane, on the picked cell and the one beside it, off the road.
  pick(frame.col + 4, frame.row + 1, 'square');
  assert.deepEqual(footprints().at(-1), { kind: 'footprint', district: districtId, cell: { block: b, col: frame.col + 4, row: frame.row + 1 }, family: 'square', col: frame.col + 3, row: frame.row + 1, rotation: 0, problem: null });
  assert.deepEqual(shown(s), [GREEN, GREEN, GREEN, GREEN, YELLOW]);
  // A house does not: the lane is two cells wide. It shows round the cell, the house's and the road's cells red.
  pick(frame.col + 4, frame.row + 1, 'house');
  const house = footprints().at(-1);
  assert.equal(house.family, 'house'); assert.deepEqual([house.col, house.row], [frame.col + 3, frame.row]);
  assert.match(house.problem, /Не помещается: 3 клетки из 9 заняты/);
  const colours = shown(s);
  assert.equal(colours.length, 10); assert.equal(colours.at(-1), YELLOW);
  assert.equal(colours.filter(c => c === RED).length, 3); assert.equal(colours.filter(c => c === GREEN).length, 6);
  // Picked further on, past the road, the house fits round the cell, and the map says where it goes.
  pick(frame.col + 8, frame.row + 1, 'house');
  assert.deepEqual([footprints().at(-1).col, footprints().at(-1).row, footprints().at(-1).problem], [frame.col + 7, frame.row, null]);
  // Next to the road it moves off it rather than onto it.
  pick(frame.col + 6, frame.row + 1, 'house');
  assert.deepEqual([footprints().at(-1).col, footprints().at(-1).problem], [frame.col + 6, null]);
  // A small thing on the road's cell: that one cell, red.
  pick(frame.col + 5, frame.row + 1, 'lamp');
  assert.match(footprints().at(-1).problem, /уже занята/);
  assert.deepEqual(shown(s), [RED, YELLOW]);
  // The same choice again reports nothing new.
  const count = footprints().length;
  pick(frame.col + 5, frame.row + 1, 'lamp');
  assert.equal(footprints().length, count);
  s.estates.setBuild(null); assert.deepEqual(shown(s), []);
  s.estates.dispose();
});
