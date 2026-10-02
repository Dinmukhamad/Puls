import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The catalogue, the night level and three in one bundle; Vite's `?url` imports become plain paths.
const built = await build({
  stdin: { contents: 'export * from "./catalogue.ts"; export * from "../render/night.ts"; export * from "../world/officeBuildings.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
  plugins: [{ name: 'url', setup(b) {
    b.onResolve({ filter: /\?url$/ }, a => ({ path: a.path, namespace: 'url' }));
    b.onLoad({ filter: /.*/, namespace: 'url' }, a => ({ contents: `export default ${JSON.stringify(a.path.replace(/\?url$/, ''))};`, loader: 'js' }));
  } }],
});
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { THREE } = city;

// Canvases: facades draw nothing, and a colour map reads back with the kits' light-blue glass on its left half
// and a white wall on its right half.
const GLASS = [126, 166, 225], WALL = [232, 232, 240];
const pixels = (w, h) => ({ width: w, height: h, data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => (i & 3) === 3 ? 255 : ((i >> 2) % w < w / 2 ? GLASS : WALL)[i & 3]) });
const context2d = new Proxy({}, { get: (_, key) => key === 'getImageData' ? (x, y, w, h) => pixels(w, h) : key === 'measureText' ? () => ({ width: 0 }) : () => {}, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context2d }) };

/** Unindexed quads: two upright glass panes, a wall behind them and a glass skylight (uv on the glass texel). */
function kitGeometry() {
  const quad = ([x0, y0, z0], [ux, uy, uz], [vx, vy, vz]) => { const c = (a, b) => [x0 + ux * a + vx * b, y0 + uy * a + vy * b, z0 + uz * a + vz * b]; return [c(0, 0), c(1, 0), c(1, 1), c(0, 0), c(1, 1), c(0, 1)]; };
  const pieces = [
    { points: quad([0, .4, .51], [.3, 0, 0], [0, .3, 0]), u: .25 },
    { points: quad([.5, .4, .51], [.3, 0, 0], [0, .3, 0]), u: .25 },
    { points: quad([-1, 0, .5], [2, 0, 0], [0, 1, 0]), u: .75 },
    { points: quad([0, 1, 0], [.4, 0, 0], [0, 0, .4]), u: .25 },
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pieces.flatMap(p => p.points.flat()), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(pieces.flatMap(p => p.points.flatMap(() => [p.u, .5])), 2));
  geometry.computeVertexNormals(); geometry.computeBoundingBox();
  return geometry;
}
function kitModels() {
  const map = new THREE.Texture({ width: 2, height: 1 }), kit = new THREE.MeshStandardMaterial({ map, roughness: .7, metalness: .1 });
  const model = name => { const geometry = kitGeometry(); return [name, { name, parts: [{ geometry, material: kit, castShadow: true }], bounds: geometry.boundingBox.clone() }]; };
  return { kit, map, models: new Map([model('s-building-type-a'), model('s-building-type-a__lod1'), model('taxi')]) };
}

test('Kenney glass gets one seed per window, the same in the LOD1 copy; walls, skylights and parked cars stay dark', () => {
  const { kit, map, models } = kitModels(), catalogue = city.createCatalogue(models, city.createNight());
  const house = catalogue.models.find(m => m.id === 's-building-type-a'), taxi = catalogue.models.find(m => m.id === 'taxi');
  const [near] = house.lods[0].parts, [mid] = house.lods[1].parts, seeds = [...near.geometry.getAttribute('windowSeed').array];
  const pane = k => seeds.slice(k * 6, k * 6 + 6);
  for (const k of [0, 1]) { assert.ok(pane(k)[0] > 0 && pane(k)[0] <= 1); assert.ok(pane(k).every(s => s === pane(k)[0]), 'one value per window'); }
  assert.notEqual(pane(0)[0], pane(1)[0]);
  assert.deepEqual([...pane(2), ...pane(3)], new Array(12).fill(0), 'walls and skylights stay dark');
  assert.deepEqual([...mid.geometry.getAttribute('windowSeed').array], seeds, 'LOD1 windows match LOD0');

  // One lit node copy of the kit material, with the kit's look.
  assert.ok(near.material.isMeshStandardNodeMaterial && near.material.emissiveNode && near.material !== kit);
  assert.equal(mid.material, near.material);
  assert.equal(near.material.map, map); assert.equal(near.material.roughness, .7); assert.equal(near.material.metalness, .1);
  assert.ok(near.material.color.equals(kit.color) && near.material.emissive.equals(new THREE.Color(0)));

  // Parked cars keep the kit material and plain proxies; buildings' proxy walls glow, their roofs do not.
  assert.equal(taxi.lods[0].parts[0].material, kit);
  assert.equal(taxi.lods[0].parts[0].geometry.getAttribute('windowSeed'), undefined);
  const [walls, roof] = house.lods[2].parts, [carWalls, carRoof] = taxi.lods[2].parts;
  assert.ok(walls.material.emissiveNode && !roof.material.emissiveNode);
  assert.ok(!carWalls.material.emissiveNode && !carRoof.material.emissiveNode);
  assert.equal(carWalls.geometry, walls.geometry, 'car proxies share the proxy geometry');

  let freed = false; near.material.addEventListener('dispose', () => { freed = true; });
  catalogue.dispose();
  assert.ok(freed, 'the lit copies are disposed with the catalogue');
});

test('blocks, towers and port sheds light their windows at night; trees, lamp poles and containers do not', () => {
  const catalogue = city.createCatalogue(new Map(), city.createNight()), matrix = new THREE.Matrix4();
  const at = (kind, variant = 0) => catalogue.resolve({ kind, variant, x: 0, z: 0, rotation: 0, scale: 1, width: 3 }, matrix);
  for (const variant of [0, 1, 2]) assert.ok(at('block', variant).lods[0].parts[0].material.emissiveNode);
  assert.ok(at('tower', 3).lods[0].parts[0].material.emissiveNode);
  // Houses without the Kenney file fall back to lit blocks.
  assert.ok(at('house').lods[0].parts[0].material.emissiveNode);
  for (const kind of ['tree-cone', 'tree-round']) assert.equal(at(kind).lods[0].parts[0].material.emissiveNode, null);
  assert.equal(at('lamp').lods[0].parts[0].material.emissiveNode, null);

  const sheds = [0, 1, 2, 3, 4].map(v => at('port', v)), marks = sheds.map(m => [...m.lods[0].parts[0].geometry.getAttribute('windowSeed').array]);
  assert.ok(sheds.every(m => m.lods[0].parts[0].material.emissiveNode));
  assert.ok(marks[0].includes(1) && marks[4].includes(1), 'the two sheds have window walls');
  assert.ok(marks[0].includes(0), 'their roofs and doors do not');
  assert.ok(marks[2].every(v => v === 0) && marks[3].every(v => v === 0), 'container yards stay dark');
  catalogue.dispose();
});

test('community centre levels resolve cached lit models and retain actual stepped bounds at every distance', () => {
  const catalogue = city.createCatalogue(new Map(), city.createNight()), matrix = new THREE.Matrix4();
  const at = (variant, extra = {}) => catalogue.resolve({ kind: 'district-landmark', variant, x: 11, z: -9, rotation: .4, scale: 1, width: 18, depth: 18, ...extra }, matrix);
  const levels = Array.from({ length: 5 }, (_, variant) => at(variant));
  assert.equal(new Set(levels).size, 5);
  for (let i = 0; i < levels.length; i++) {
    const model = levels[i];
    assert.equal(model.id, `district-landmark-${i + 1}`);
    assert.equal(at(i), model, 'refreshes resolve the same cached geometry');
    assert.ok(model.bounds.min.x > -9 && model.bounds.max.x < 9 && model.bounds.min.z > -9 && model.bounds.max.z < 9);
    if (i) assert.ok(model.bounds.max.y > levels[i - 1].bounds.max.y);
    for (const detail of model.lods) {
      assert.equal(detail.parts.length, 2, 'opaque architecture and glass each use one pooled part');
      const [shell, glass] = detail.parts;
      assert.ok(shell.geometry.hasAttribute('color') && glass.geometry.hasAttribute('sectionPart'));
      assert.ok(glass.material.emissiveNode, 'the facade uses the city night-window shader');
    }
  }
  assert.equal(at(-2), levels[0]); assert.equal(at(99), levels[4]);
  at(4, { width: 9, depth: 12 });
  const position = new THREE.Vector3(), size = new THREE.Vector3(); matrix.decompose(position, new THREE.Quaternion(), size);
  assert.deepEqual(position.toArray(), [11, .2, -9]);
  assert.ok(Math.abs(size.x - .5) < 1e-8 && Math.abs(size.y - .5) < 1e-8 && Math.abs(size.z - 2 / 3) < 1e-8);
  let disposed = 0; levels[4].lods[0].parts[0].geometry.addEventListener('dispose', () => disposed++);
  catalogue.dispose(); assert.equal(disposed, 1, 'catalogue owns and disposes the centre models');
});

test('residential sections: balconies near, one plain box far for every height, arches raised; yard furniture and new trees stay dark', () => {
  const catalogue = city.createCatalogue(new Map(), city.createNight()), matrix = new THREE.Matrix4(), size = new THREE.Vector3();
  const at = (kind, extra = {}) => catalogue.resolve({ kind, variant: 0, x: 3, z: 4, rotation: .5, scale: 1, width: 0, ...extra }, matrix);
  const heights = [0, 1, 2, 3, 4, 5, 6].map(variant => { const model = at('section', { variant, width: 3.2, depth: 2.2 }); matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), size); return { model, height: size.y, width: size.x, depth: size.z }; });
  assert.equal(new Set(heights.map(h => h.model)).size, 7, 'a model per height');
  assert.equal(new Set(heights.map(h => h.model.lods[2].parts)).size, 1, 'far away every height is the same plain box (one pool)');
  assert.ok(heights.every((h, i) => i === 0 || h.height > heights[i - 1].height), 'the classes rise');
  assert.ok(Math.abs(heights[0].width - 3.2) < 1e-6 && Math.abs(heights[0].depth - 2.2) < 1e-6, 'the footprint is the placement');
  const count = (level) => level.parts[0].geometry.getAttribute('position').count;
  for (const { model } of heights) {
    assert.ok(count(model.lods[0]) > count(model.lods[1]) && count(model.lods[1]) > count(model.lods[2]), 'balconies near, a roof house farther, a box far');
    assert.ok(model.lods[0].parts[0].geometry.getAttribute('sectionPart'), 'faces are marked facade, trim, roof, glass or plain');
  }
  const section = heights[0].model, material = section.lods[0].parts[0].material;
  assert.ok(material.emissiveNode && material.colorNode && section.tints.length >= 12, 'a painted facade with night windows, in shades');
  assert.ok(heights[6].model.lods[0].parts[0].geometry.getAttribute('position').count < 3000, 'the tallest section stays light');
  // Over an arch: raised two floors, as tall as the rest of its wing.
  const arch = at('section', { variant: 1, width: 3, depth: 2.2, lift: 1.5 }), place = new THREE.Vector3();
  matrix.decompose(place, new THREE.Quaternion(), size);
  assert.ok(arch !== heights[1].model && Math.abs(place.y - (.2 + 1.5)) < 1e-6 && Math.abs(place.y + size.y - (.2 + 4 * .75)) < 1e-6, 'the arch floors meet the roof of the wing');
  const gable = at('roof', { width: 2.6, depth: 2.4, scale: 1.2, lift: 3 }); matrix.decompose(place, new THREE.Quaternion(), size);
  assert.ok(gable && gable.lods[0].parts[0].geometry.getAttribute('position').count === 18 && Math.abs(place.y - 3.2) < 1e-6 && Math.abs(size.y - 1.2) < 1e-6, 'a gabled roof sits on its house');
  for (const kind of ['bench', 'slide', 'swings', 'climber', 'sandbox', 'goal', 'hoop', 'gazebo', 'flowerbed', 'bush', 'hedge', 'planter', 'fountain', 'tree-birch', 'tree-oak']) {
    const model = at(kind);
    assert.ok(model, kind);
    assert.equal(model.lods[0].parts.length, 1, `${kind} is one merged part`);
    assert.equal(model.lods[0].parts[0].material.emissiveNode, null, `${kind} does not glow`);
    assert.ok(model.lods[0].parts[0].geometry.getAttribute('position').count < 3000, `${kind} is light`);
  }
  // Far away small pieces become boxes in their own colours, all drawn with the far buildings' shared parts.
  const far = at('bench').lods[2], house = at('block', { variant: 0, width: 3 });
  assert.ok(far && far.matrix && far.colors.length === 2, 'a bench stays visible far away');
  for (const kind of ['slide', 'swings', 'goal', 'hoop', 'gazebo', 'hedge', 'lamp']) assert.ok(at(kind).lods[2]?.parts === far.parts, `${kind} shares the far proxy`);
  void house;
  // Offices: a lit glass model per height, podiums and towers alike, raised onto their podium by `lift`.
  const towers = [0, 1, 2, 3, 4, 5].map(variant => at('glass-tower', { variant, width: 8, depth: 6 }));
  assert.equal(new Set(towers).size, 6);
  assert.ok(towers.every(model => model.lods[0].parts[0].material.emissiveNode && model.lods[0].parts[0].geometry.getAttribute('sectionPart')));
  assert.ok(towers[0].lods[0].parts[0].material !== section.lods[0].parts[0].material, 'offices have a glass facade of their own');
  const raised = new THREE.Vector3(); at('glass-tower', { variant: 4, width: 8, depth: 6, lift: 2.7 }); matrix.decompose(raised, new THREE.Quaternion(), size);
  assert.ok(Math.abs(raised.y - 2.9) < 1e-6 && Math.abs(raised.y + size.y - (.2 + 26 * .9)) < 1e-6, 'a tower on its podium reaches its own height');
  assert.ok(at('tree-oak').lods[2], 'trees keep a far version');
  catalogue.dispose();
});

test('ready houses: each house in each finish its own model at the city scale, its windows lit from the file\'s marks', () => {
  const map = new THREE.Texture({ width: 2, height: 1 }), sheet = new THREE.MeshStandardMaterial({ map, roughness: .85 });
  /** A house of the file: a wall and a window quad, the window marked in _windowseed as glTF names it. */
  const house = name => {
    const geometry = kitGeometry(), count = geometry.getAttribute('position').count;
    geometry.setAttribute('_windowseed', new THREE.Float32BufferAttribute(Array.from({ length: count }, (_, i) => i < 6 ? .42 : 0), 1));
    return [name, { name, parts: [{ geometry, material: sheet, castShadow: true }], bounds: geometry.boundingBox.clone() }];
  };
  const catalogue = city.createCatalogue(new Map([house('family-house-3-stone'), house('family-house-1-brick')]), city.createNight());
  const matrix = new THREE.Matrix4(), size = new THREE.Vector3();
  const at = (variant, extra = {}) => catalogue.resolve({ kind: 'family-house', variant, x: 2, z: 3, rotation: .4, scale: 1.35, width: 4, depth: 3, ...extra }, matrix);
  const stone = at(5), brick = at(0);
  assert.equal(stone.id, 'family-house-3-stone'); assert.equal(brick.id, 'family-house-1-brick');
  matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), size);
  assert.ok(Math.abs(size.x - 1.35) < 1e-6 && Math.abs(size.y - 1.35) < 1e-6, 'the city scale, not fitted to the plot');
  const [part] = stone.lods[0].parts;
  assert.ok(part.geometry.getAttribute('windowSeed') && !part.geometry.getAttribute('_windowseed'), 'the file\'s marks are the windows');
  assert.deepEqual([...part.geometry.getAttribute('windowSeed').array].slice(0, 7), [.42, .42, .42, .42, .42, .42, 0].map(v => Math.fround(v)));
  assert.ok(part.material.emissiveNode && part.material.map === map, 'the windows glow at night on the trim sheet');
  assert.ok(stone.lods[2] && stone.lods[2].colors?.length === 2, 'far away a box in the house\'s colours');
  // Without the file (or a house missing from it) a plain two-storey block stands on the footprint.
  const block = at(7, { width: 3.6, depth: 2.8 });
  matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), size);
  assert.ok(block && block.id === 'cottage' && Math.abs(size.x - 3.6) < 1e-6 && Math.abs(size.z - 2.8) < 1e-6 && Math.abs(size.y - 1.5) < 1e-6);
  catalogue.dispose();
});

test('all nine ready offices preserve their source material and proportions, share lit materials and far proxies, and dispose once', () => {
  const map = new THREE.Texture({ width: 2, height: 1 }), material = new THREE.MeshStandardMaterial({ map, roughness: .45, metalness: .1 });
  const make = (name, model, marks = true) => {
    const geometry = new THREE.BoxGeometry(model.width, model.height, model.depth).translate(1, model.height / 2 + .3, -2);
    if (marks) {
      const normal = geometry.getAttribute('normal');
      geometry.setAttribute('_windowseed', new THREE.Float32BufferAttribute(Array.from({ length: normal.count }, (_, i) => Math.abs(normal.getY(i)) < .5 ? 1 : 0), 1));
    }
    geometry.computeBoundingBox();
    return [name, { name, parts: [{ geometry, material, castShadow: true }], bounds: geometry.boundingBox.clone() }];
  };
  const entries = Object.values(city.OFFICE_BUILDINGS).map(model => make(city.officeModelName(model.model - 1), model));
  entries.push(make('office-building-1__lod1', city.OFFICE_BUILDINGS.officea));
  const models = new Map(entries), catalogue = city.createCatalogue(models, city.createNight()), matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  const resolved = Object.values(city.OFFICE_BUILDINGS).map(definition => {
    const placement = { kind: 'office-building', variant: definition.model - 1, x: 7, z: 4, rotation: .8, scale: 1.7, width: definition.width * 1.7, depth: definition.depth * 1.7 };
    const model = catalogue.resolve(placement, matrix);
    assert.equal(model.id, city.officeModelName(definition.model - 1));
    matrix.decompose(position, rotation, scale);
    assert.ok([scale.x, scale.y, scale.z].every(value => Math.abs(value - 1.7) < 1e-6), 'uniform source scale');
    const actual = model.bounds.clone().applyMatrix4(matrix), center = new THREE.Vector3(1, .3, -2).applyMatrix4(matrix);
    assert.ok(Math.abs(actual.min.y - .2) < 1e-6 && Math.abs(center.x - placement.x) < 1e-6 && Math.abs(center.z - placement.z) < 1e-6, 'grounded on and centred within its footprint');
    const [part] = model.lods[0].parts, seeds = part.geometry.getAttribute('windowSeed');
    assert.ok(seeds && !part.geometry.hasAttribute('_windowseed'));
    assert.ok([...seeds.array].includes(0) && [...seeds.array].includes(1), 'facades marked and roof excluded');
    assert.ok(part.material.isMeshStandardNodeMaterial && part.material.emissiveNode);
    assert.equal(part.material.map, map); assert.equal(part.material.roughness, .45); assert.equal(part.material.metalness, .1);
    assert.ok(model.lods[2]?.matrix && model.lods[2].colors.length === 2, 'far proxy retains source bounds and colours');
    return model;
  });
  assert.equal(new Set(resolved.map(model => model.lods[0].parts[0].material)).size, 1, 'a shared source material gets one lit copy');
  assert.equal(new Set(resolved.map(model => model.lods[2].parts)).size, 1, 'all office proxies share geometry and materials');
  assert.notEqual(resolved[0].lods[0].parts, resolved[0].lods[1].parts, 'a supplied LOD1 is respected');
  assert.ok(resolved[0].lods[1].parts[0].geometry.hasAttribute('windowSeed'), 'LOD1 gets its facade markers too');
  assert.equal(resolved[1].lods[0], resolved[1].lods[1], 'low-poly source reused when no separate LOD1 exists');
  const counts = { material: 0, lit: 0, texture: 0, geometry: 0 };
  material.addEventListener('dispose', () => counts.material++);
  resolved[0].lods[0].parts[0].material.addEventListener('dispose', () => counts.lit++);
  map.addEventListener('dispose', () => counts.texture++);
  resolved[0].lods[0].parts[0].geometry.addEventListener('dispose', () => counts.geometry++);
  catalogue.dispose();
  assert.deepEqual(counts, { material: 1, lit: 1, texture: 1, geometry: 1 });
  assert.equal(models.size, 0);
});

test('office buildings keep lit glass and matching footprints and heights when their file or one scene is missing', () => {
  const geometry = new THREE.BoxGeometry(2, 6, 2).translate(0, 3, 0), material = new THREE.MeshStandardMaterial({ color: '#7998aa' });
  geometry.computeBoundingBox();
  const catalogue = city.createCatalogue(new Map([['office-building-1', { name: 'office-building-1', parts: [{ geometry, material, castShadow: true }], bounds: geometry.boundingBox.clone() }]]), city.createNight());
  const matrix = new THREE.Matrix4(), size = new THREE.Vector3();
  const at = (variant, extra = {}) => catalogue.resolve({ kind: 'office-building', variant, x: 1, z: 2, rotation: .3, scale: 1.4, width: 3.2, depth: 4.1, ...extra }, matrix);
  const loaded = at(0);
  assert.equal(loaded.id, 'office-building-1');
  assert.ok(loaded.lods[0].parts[0].material.emissiveNode, 'an unmarked, untextured office receives procedural night panes');
  for (const definition of Object.values(city.OFFICE_BUILDINGS).slice(1)) {
    const fallback = at(definition.model - 1);
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), size);
    assert.match(fallback.id, /^office-/);
    assert.ok(fallback.lods[0].parts[0].material.emissiveNode);
    assert.ok(Math.abs(size.x - 3.2) < 1e-6 && Math.abs(size.z - 4.1) < 1e-6 && Math.abs(size.y - definition.height * 1.4) < 1e-6, 'missing scene retains its dimensions');
  }
  catalogue.dispose();
  const empty = city.createCatalogue(new Map(), city.createNight());
  assert.ok(empty.resolve({ kind: 'office-building', variant: 8, x: 0, z: 0, rotation: 0, scale: 2, width: 4.3, depth: 4.3 }, matrix).lods[0].parts[0].material.emissiveNode, 'a failed office file leaves a usable lit building');
  empty.dispose();
});
