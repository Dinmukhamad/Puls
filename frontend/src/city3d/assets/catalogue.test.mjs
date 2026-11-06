import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The catalogue, the night level and three in one bundle; Vite's `?url` imports become plain paths.
const built = await build({
  stdin: { contents: 'export * from "./catalogue.ts"; export * from "../render/night.ts"; export * from "../world/officeBuildings.ts"; export * from "../world/familyHouses.ts"; export { FACE } from "./facade.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
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

test('Kenney glass gets one seed per window; walls, skylights and parked cars stay dark; one level at every distance', () => {
  const { kit, map, models } = kitModels(), catalogue = city.createCatalogue(models, city.createNight());
  const house = catalogue.models.find(m => m.id === 's-building-type-a'), taxi = catalogue.models.find(m => m.id === 'taxi');
  const [near] = house.lods[0].parts, seeds = [...near.geometry.getAttribute('windowSeed').array];
  const pane = k => seeds.slice(k * 6, k * 6 + 6);
  for (const k of [0, 1]) { assert.ok(pane(k)[0] > 0 && pane(k)[0] <= 1); assert.ok(pane(k).every(s => s === pane(k)[0]), 'one value per window'); }
  assert.notEqual(pane(0)[0], pane(1)[0]);
  assert.deepEqual([...pane(2), ...pane(3)], new Array(12).fill(0), 'walls and skylights stay dark');
  assert.ok(house.lods.every(level => level === house.lods[0]) && taxi.lods.every(level => level === taxi.lods[0]), 'the same model near and far: no LOD copies, no boxes');

  // One lit node copy of the kit material, with the kit's look.
  assert.ok(near.material.isMeshStandardNodeMaterial && near.material.emissiveNode && near.material !== kit);
  assert.equal(near.material.map, map); assert.equal(near.material.roughness, .7); assert.equal(near.material.metalness, .1);
  assert.ok(near.material.color.equals(kit.color) && near.material.emissive.equals(new THREE.Color(0)));

  // Parked cars keep the kit material.
  assert.equal(taxi.lods[0].parts[0].material, kit);
  assert.equal(taxi.lods[0].parts[0].geometry.getAttribute('windowSeed'), undefined);

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

  const sheds = [0, 1, 2, 3, 4].map(v => at('port', v)), windows = sheds.map(m => surfaceVertices(m.lods[0].parts[0].geometry, city.FACE.window).length);
  assert.ok(sheds.every(m => m.lods[0].parts[0].material.emissiveNode && m.lods.every(level => level === m.lods[0])), 'one lit facade model at every distance');
  assert.ok(windows[0] > 0 && windows[4] > 0, 'the two sheds have window walls');
  assert.ok(surfaceVertices(sheds[0].lods[0].parts[0].geometry, city.FACE.roof).length > 0, 'and roofs that do not light');
  assert.ok(windows[2] === 0 && windows[3] === 0, 'container yards stay dark');
  for (const variant of [0, 1, 2, 3]) assert.ok(at('block', variant).lods[0].parts[0].geometry.getAttribute('aUnitU'), 'blocks are stretched unit models of the facade builder');
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
    assert.ok(model.lods.every(level => level === model.lods[0]), 'one model near and far');
    assert.equal(model.lods[0].parts.length, 1, 'walls, roofs, glass and windows in one pooled part');
    const [part] = model.lods[0].parts;
    assert.ok(part.geometry.hasAttribute('color') && part.geometry.hasAttribute('aSurf') && part.geometry.hasAttribute('aWin'), 'built with the facade builder');
    assert.ok(part.material.emissiveNode && part.material.colorNode, 'the facade material: its windows light at night');
    if (i < 4) assert.ok(surfaceVertices(part.geometry, city.FACE.window).length > 0, 'window cells on its walls');
    if (i >= 3) assert.ok(surfaceVertices(part.geometry, city.FACE.curtain).length > 0, 'the upper levels have curtain walls');
    assert.ok(part.geometry.index.count / 3 < 9000, `level ${i + 1}: ${part.geometry.index.count / 3} triangles`);
  }
  assert.equal(at(-2), levels[0]); assert.equal(at(99), levels[4]);
  at(4, { width: 9, depth: 12 });
  const position = new THREE.Vector3(), size = new THREE.Vector3(); matrix.decompose(position, new THREE.Quaternion(), size);
  assert.deepEqual(position.toArray(), [11, .2, -9]);
  assert.ok(Math.abs(size.x - .5) < 1e-8 && Math.abs(size.y - .5) < 1e-8 && Math.abs(size.z - 2 / 3) < 1e-8);
  const material = levels[0].lods[0].parts[0].material;
  assert.ok(levels.every(model => model.lods[0].parts[0].material === material), 'every level shares the facade material');
  let disposed = 0; levels[4].lods[0].parts[0].geometry.addEventListener('dispose', () => disposed++);
  catalogue.dispose(); assert.equal(disposed, 1, 'catalogue owns and disposes the centre models');
});

test('residential sections: a model per height with its balconies at every distance, arches raised; yard furniture and new trees stay dark', () => {
  const catalogue = city.createCatalogue(new Map(), city.createNight()), matrix = new THREE.Matrix4(), size = new THREE.Vector3();
  const at = (kind, extra = {}) => catalogue.resolve({ kind, variant: 0, x: 3, z: 4, rotation: .5, scale: 1, width: 0, ...extra }, matrix);
  const heights = [0, 1, 2, 3, 4, 5, 6].map(variant => { const model = at('section', { variant, width: 3.2, depth: 2.2 }); matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), size); return { model, height: size.y, width: size.x, depth: size.z }; });
  assert.equal(new Set(heights.map(h => h.model)).size, 7, 'a model per height');
  assert.ok(heights.every((h, i) => i === 0 || h.height > heights[i - 1].height), 'the classes rise');
  assert.ok(Math.abs(heights[0].width - 3.2) < 1e-6 && Math.abs(heights[0].depth - 2.2) < 1e-6, 'the footprint is the placement');
  const count = (level) => level.parts[0].geometry.getAttribute('position').count;
  for (const { model } of heights) {
    assert.ok(model.lods.every(level => level === model.lods[0]) && count(model.lods[0]) > 24, 'balconies and the roof house at every distance');
    const geometry = model.lods[0].parts[0].geometry;
    assert.ok(geometry.getAttribute('aUnitU') && geometry.getAttribute('aUnitV') && surfaceVertices(geometry, city.FACE.window).length > 0, 'a unit model with windowed walls, measured on the copy');
    assert.ok(Math.abs(geometry.boundingBox.min.x + .5) < .02 && Math.abs(geometry.boundingBox.max.x - .5) < .02 && Math.abs(geometry.boundingBox.min.y) < 1e-6, 'in the unit box');
  }
  const section = heights[0].model, material = section.lods[0].parts[0].material;
  assert.ok(material.emissiveNode && material.colorNode && section.tints.length >= 12, 'a painted facade with night windows, in shades');
  assert.ok(heights[6].model.lods[0].parts[0].geometry.getAttribute('position').count < 3000, 'the tallest section stays light');
  // Over an arch: raised two floors, as tall as the rest of its wing.
  const arch = at('section', { variant: 1, width: 3, depth: 2.2, lift: 1.5 }), place = new THREE.Vector3();
  matrix.decompose(place, new THREE.Quaternion(), size);
  assert.ok(arch !== heights[1].model && Math.abs(place.y - (.2 + 1.5)) < 1e-6 && Math.abs(place.y + size.y - (.2 + 4 * .75)) < 1e-6, 'the arch floors meet the roof of the wing');
  const gable = at('roof', { width: 2.6, depth: 2.4, scale: 1.2, lift: 3 }); matrix.decompose(place, new THREE.Quaternion(), size);
  assert.ok(gable && surfaceVertices(gable.lods[0].parts[0].geometry, city.FACE.roof).length > 0 && Math.abs(place.y - 3.2) < 1e-6 && Math.abs(size.y - 1.2) < 1e-6, 'a tiled gabled roof sits on its house');
  const roofBox = gable.lods[0].parts[0].geometry.boundingBox;
  assert.ok(Math.abs(roofBox.max.y - 1) < .02 && Math.abs(roofBox.min.x + .5) < .02 && Math.abs(roofBox.max.z - .5) < .02, 'the ridge at the top of its unit box, the eaves at its sides');
  // Cottages: one model whatever their floors; a garage (the houses' graphite shade) has a garage door instead of windows.
  const house = at('cottage', { variant: 1, width: 3.5, depth: 2.6, tint: 3 }), garage = at('cottage', { variant: 0, width: 1.9, depth: 2.4, tint: 8 });
  assert.ok(house.id === 'cottage' && garage.id === 'cottage-garage' && garage !== house);
  assert.ok(surfaceVertices(house.lods[0].parts[0].geometry, city.FACE.window).length > 0 && surfaceVertices(garage.lods[0].parts[0].geometry, city.FACE.window).length === 0);
  const flags = house.lods[0].parts[0].geometry.getAttribute('aUnitV'), normal = house.lods[0].parts[0].geometry.getAttribute('normal');
  let doors = 0; for (let i = 0; i < flags.count; i++) if (flags.getW(i) === 2 && normal.getZ(i) > .9) doors++;
  assert.ok(doors > 0, 'the cottage\'s door is in its front wall');
  for (const kind of ['bench', 'slide', 'swings', 'climber', 'sandbox', 'goal', 'hoop', 'gazebo', 'flowerbed', 'bush', 'hedge', 'planter', 'fountain', 'tree-birch', 'tree-oak']) {
    const model = at(kind);
    assert.ok(model, kind);
    assert.equal(model.lods[0].parts.length, 1, `${kind} is one merged part`);
    assert.equal(model.lods[0].parts[0].material.emissiveNode, null, `${kind} does not glow`);
    assert.ok(model.lods[0].parts[0].geometry.getAttribute('position').count < 3000, `${kind} is light`);
  }
  // Small pieces stay themselves far away: no boxes.
  for (const kind of ['bench', 'slide', 'swings', 'goal', 'hoop', 'gazebo', 'hedge', 'lamp']) assert.ok(at(kind).lods.every(level => level === at(kind).lods[0]), `${kind} is one model at every distance`);
  // Offices: a lit glass model per height, podiums and towers alike, raised onto their podium by `lift`.
  const towers = [0, 1, 2, 3, 4, 5].map(variant => at('glass-tower', { variant, width: 8, depth: 6 }));
  assert.equal(new Set(towers).size, 6);
  assert.ok(towers.every(model => model.lods[0].parts[0].material.emissiveNode && surfaceVertices(model.lods[0].parts[0].geometry, city.FACE.curtain).length > 0), 'curtain walls that light at night');
  assert.ok(surfaceVertices(section.lods[0].parts[0].geometry, city.FACE.curtain).length === 0, 'sections have windows, offices glass: one stretched-facade material draws both');
  const raised = new THREE.Vector3(); at('glass-tower', { variant: 4, width: 8, depth: 6, lift: 2.7 }); matrix.decompose(raised, new THREE.Quaternion(), size);
  assert.ok(Math.abs(raised.y - 2.9) < 1e-6 && Math.abs(raised.y + size.y - (.2 + 26 * .9)) < 1e-6, 'a tower on its podium reaches its own height');
  assert.ok(at('tree-oak').lods[2] === at('tree-oak').lods[0], 'trees too');
  catalogue.dispose();
});

/** The vertices of a built model whose surface kind is `kind`, as [x, y, z] in model units. */
function surfaceVertices(geometry, kind) {
  const surf = geometry.getAttribute('aSurf'), position = geometry.getAttribute('position'), out = [];
  for (let i = 0; i < position.count; i++) if (Math.round(surf.getZ(i)) === kind) out.push([position.getX(i), position.getY(i), position.getZ(i)]);
  return out;
}

test('ready houses: each house in each finish its own model, built in code on the table\'s footprint, its door and garage where the paths lead', () => {
  const catalogue = city.createCatalogue(new Map(), city.createNight());
  const matrix = new THREE.Matrix4(), size = new THREE.Vector3();
  const at = (variant, extra = {}) => catalogue.resolve({ kind: 'family-house', variant, x: 2, z: 3, rotation: .4, scale: 1.35, width: 4, depth: 3, ...extra }, matrix);
  const models = Array.from({ length: 12 }, (_, variant) => at(variant));
  assert.deepEqual(models.map(m => m.id), Array.from({ length: 12 }, (_, v) => city.houseModelName(v)));
  matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), size);
  assert.ok(Math.abs(size.x - 1.35) < 1e-6 && Math.abs(size.y - 1.35) < 1e-6, 'the city scale, not fitted to the plot');
  const material = models[0].lods[0].parts[0].material;
  assert.ok(material.isMeshStandardNodeMaterial && material.colorNode && material.emissiveNode, 'one facade material: walls, roofs and windows that light at night');
  for (const [family, m] of Object.entries(city.READY_HOUSES)) for (const finish of city.FINISHES) {
    const variant = (m.model - 1) * 2 + city.FINISHES.indexOf(finish), model = models[variant], [part] = model.lods[0].parts;
    assert.ok(model.lods.every(level => level === model.lods[0]), `${family}: one model near and far`);
    assert.equal(part.material, material, 'every house shares the facade material');
    const box = part.geometry.boundingBox, extent = box.getSize(new THREE.Vector3());
    assert.ok(Math.abs(box.min.y) < 1e-4 && Math.abs(box.min.x + box.max.x) < .3 && Math.abs(box.min.z + box.max.z) < .3, `${family} ${finish}: on its footprint and grounded`);
    // The table's size: eaves and porches may reach a little past it, nothing grows out of the plot.
    for (const [k, value] of [['x', m.width], ['y', m.height], ['z', m.depth]]) assert.ok(extent[k] > value * .6 && extent[k] < value + .3, `${family} ${finish}: ${k} ${extent[k].toFixed(3)} for ${value}`);
    assert.ok(surfaceVertices(part.geometry, city.FACE.window).length > 0 && surfaceVertices(part.geometry, city.FACE.roof).length + surfaceVertices(part.geometry, city.FACE.deck).length > 0, `${family}: walls with windows and a roof`);
    const triangles = part.geometry.index.count / 3;
    assert.ok(triangles < 1500, `${family}: ${triangles} triangles`);
    // The door and the garage door stand where world/landLayouts.ts leads the path and the driveway.
    const trim = surfaceVertices(part.geometry, city.FACE.trim), front = m.depth / 2;
    const near = ([x, z], dx) => trim.some(([vx, vy, vz]) => Math.abs(vx - x) < dx && Math.abs(vz - z) < .06 && vy > .02 && vy < .5);
    assert.ok(near([m.door[0], front - m.door[1]], .14), `${family}: its door at the path`);
    if (m.garage && family !== 'carport') assert.ok(near([m.garage[0], front - m.garage[1]], .35), `${family}: its garage door at the driveway`);
  }
  const wall = variant => models[variant].lods[0].parts[0].geometry.getAttribute('color').getX(0);
  assert.notEqual(wall(0), wall(1), 'brick and stone are different walls');
  let disposed = 0; models[0].lods[0].parts[0].geometry.addEventListener('dispose', () => disposed++);
  catalogue.dispose(); assert.equal(disposed, 1, 'the catalogue owns the built houses');
});

test('all nine ready offices are built in code at the table\'s proportions, grounded and centred in their plot, with one lit facade', () => {
  const catalogue = city.createCatalogue(new Map(), city.createNight()), matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  const resolved = Object.values(city.OFFICE_BUILDINGS).map(definition => {
    const placement = { kind: 'office-building', variant: definition.model - 1, x: 7, z: 4, rotation: .8, scale: 1.7, width: definition.width * 1.7, depth: definition.depth * 1.7 };
    const model = catalogue.resolve(placement, matrix);
    assert.equal(model.id, city.officeModelName(definition.model - 1));
    matrix.decompose(position, rotation, scale);
    assert.ok([scale.x, scale.y, scale.z].every(value => Math.abs(value - 1.7) < 1e-6), 'uniform scale');
    const actual = model.bounds.clone().applyMatrix4(matrix), extent = model.bounds.getSize(new THREE.Vector3());
    assert.ok(Math.abs(actual.min.y - .2) < 1e-6 && Math.abs(position.x - placement.x) < 1e-6 && Math.abs(position.z - placement.z) < 1e-6, 'grounded on and centred within its footprint');
    for (const [k, value] of [['x', definition.width], ['y', definition.height], ['z', definition.depth]]) assert.ok(Math.abs(extent[k] - value) < .2, `${definition.name}: ${k} ${extent[k].toFixed(3)} for ${value}`);
    const [part] = model.lods[0].parts;
    assert.ok(surfaceVertices(part.geometry, city.FACE.curtain).length + surfaceVertices(part.geometry, city.FACE.window).length > 0, 'glass or windowed facades');
    assert.ok(part.geometry.index.count / 3 < 1500 && model.lods.every(level => level === model.lods[0]));
    assert.ok(part.material.emissiveNode, 'lit at night');
    return model;
  });
  assert.equal(new Set(resolved.map(model => model.lods[0].parts[0].material)).size, 1, 'one facade material for all nine');
  assert.equal(new Set(resolved.map(model => model.lods[0].parts[0].geometry)).size, 9, 'nine towers');
  const counts = { lit: 0, geometry: 0 };
  resolved[0].lods[0].parts[0].material.addEventListener('dispose', () => counts.lit++);
  resolved[0].lods[0].parts[0].geometry.addEventListener('dispose', () => counts.geometry++);
  catalogue.dispose();
  assert.deepEqual(counts, { lit: 1, geometry: 1 });
});
