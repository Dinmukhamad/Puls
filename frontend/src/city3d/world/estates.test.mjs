import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: `export * from './estates.ts'; export * from './land.ts'; export * from './landLayouts.ts'; export * from './familyHouses.ts'; export * from './officeBuildings.ts'; export * from './cities.ts'; export { generateSalesWorld } from './sales.ts'; export { WORLD_X4 } from './worldSpec.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const E = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const server = readFileSync(new URL('../../../../app/services/city_estate.py', import.meta.url), 'utf8');
const GRIDS = { support: E.landGrid(E.islandWorld(E.WORLD_X4)), sales: E.landGrid(E.generateSalesWorld()) };
const officeTable = server.slice(server.indexOf('OFFICE_TOWERS = {'), server.indexOf('\n}\n', server.indexOf('OFFICE_TOWERS = {')));
const SERVER_OFFICES = Object.fromEntries([...officeTable.matchAll(/"(\w+)": \("([^"]+)", (\d+)\)/g)].map(([, family, name, price]) => [family, { name, price: Number(price) }]));

/** The server's catalogue by family: footprint and how many levels (city_estate.py PLOT_FAMILIES, PROJECT_FAMILIES). */
function catalogue(name) {
  const text = server.slice(server.indexOf(`${name} = {`), server.indexOf('\n}\n', server.indexOf(`${name} = {`)));
  const families = Object.fromEntries(text.split(/\n {4}"(?=\w+": \{)/).slice(1).map(block => {
    const family = block.match(/^(\w+)"/)[1], size = block.match(/"size": \((\d), (\d)\)/);
    return [family, { size: [Number(size[1]), Number(size[2])], levels: (block.slice(block.indexOf('"levels": [')).match(/\(\s*"/g) ?? []).length }];
  }));
  if (name === 'PLOT_FAMILIES') {
    const office = text.match(/\*\*\{[\s\S]*?for key, \(name, _price\) in OFFICE_TOWERS\.items\(\)/)?.[0];
    assert.ok(office, 'the server adds every source office to its plot catalogue');
    const size = office.match(/"size": \((\d), (\d)\)/), levels = (office.slice(office.indexOf('"levels": [')).split(']')[0].match(/\(name,/g) ?? []).length;
    for (const family of Object.keys(SERVER_OFFICES)) families[family] = { size: [Number(size[1]), Number(size[2])], levels };
  }
  return families;
}

test('the catalogue matches the server: what stands on plots, what stands on the square, the land of every band', () => {
  const plots = catalogue('PLOT_FAMILIES'), projects = catalogue('PROJECT_FAMILIES');
  assert.deepEqual(Object.fromEntries(Object.entries(plots).map(([k, v]) => [k, v.size])), E.PLOT_SIZE);
  assert.deepEqual(Object.fromEntries(Object.entries(plots).map(([k, v]) => [k, v.levels])), E.PLOT_LEVELS);
  assert.deepEqual(Object.fromEntries(Object.entries(projects).map(([k, v]) => [k, v.size])), E.PROJECT_SIZE);
  assert.deepEqual(Object.fromEntries(Object.entries(projects).map(([k, v]) => [k, v.levels])), E.PROJECT_LEVELS);
  assert.match(server, /"park": \{\n {8}"name": "Парк",\n {8}"icon": "[^"]+",\n {8}"size": \(2, 2\),\n {8}"squares": 4,/);
  assert.match(server, /"bigpark": \{\n {8}"name": "Большой парк",\n {8}"icon": "[^"]+",\n {8}"size": \(3, 2\),\n {8}"squares": 6,/);
  assert.deepEqual(E.PARK_SQUARES, { park: 4, bigpark: 6 });
  // A price for the land of every band of the island city; the lake city uses the first three.
  const land = server.match(/^LAND_PRICES = \[([^\]]*)\]/m)[1].split(',').map(Number);
  assert.equal(land.length, GRIDS.support.bands);
  assert.ok(GRIDS.sales.bands <= land.length);
  assert.match(server, /^SQUARE, MODULE_CELLS = 0, 12$/m);
  assert.equal(E.MODULE_CELLS, 12);
  assert.deepEqual([1, 2, 3, 4].map(E.preparedLand), [true, true, true, false]);
});

const KNOWN = new Set(['tree-round', 'tree-oak', 'tree-birch', 'tree-cone', 'bench', 'flowerbed', 'bush', 'hedge', 'lamp', 'cottage', 'roof', 'planter', 'fountain', 'gazebo', 'slide', 'swings', 'sandbox', 'family-house', 'office-building']);
/** Within a frame: in its own axes, inside its width and depth with `pad` to spare (negative: that far inside). */
const within = (p, f, pad) => {
  const s = Math.sin(f.rotation), c = Math.cos(f.rotation), dx = p.x - f.x, dz = p.z - f.z;
  return Math.abs(dx * c - dz * s) <= f.width / 2 + pad && Math.abs(dx * s + dz * c) <= f.depth / 2 + pad;
};
/** Plots of every kind of block: a narrow one by the centre of the island city, a wide one at its edge, the lake city's. */
function samples() {
  const out = [];
  for (const grid of Object.values(GRIDS)) for (const band of [1, grid.bands]) {
    const block = grid.blocks.find(b => b.band === band && b.cols >= 3 && b.rows >= 3) ?? grid.blocks.find(b => b.band === band && b.cols >= 3 && b.rows >= 2) ?? grid.blocks.find(b => b.band === band);
    if (block) out.push(block);
  }
  return out;
}

test('everything on a plot at every level stands inside its plots and uses known models', () => {
  for (const block of samples()) for (const [family, levels] of Object.entries(E.PLOT_LEVELS)) for (let level = 1; level <= levels; level++) for (const rotation of family === 'bigpark' ? [0, 1] : [0]) {
    const [w, h] = E.plotFootprint(family, rotation);
    if (w > block.cols || h > block.rows) continue;
    const frame = E.areaFrame(block, 0, 0, w, h);
    for (const seed of [1, 7, 23, 404]) {
      const { placements, surfaces } = E.plotLayout(frame, family, level, seed);
      assert.ok(placements.length >= 4 && surfaces.length >= 1, `${family} ${level} has pieces`);
      for (const p of placements) {
        assert.ok(KNOWN.has(p.kind), `${p.kind} is a model`);
        assert.ok(within(p, frame, -.15), `${family} ${level} ${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} inside its plots`);
      }
      for (const s of surfaces) {
        const half = s.round ? s.length / 2 : 0;
        assert.ok(within(s, frame, -half + .01), `${family} ${level} ${s.kind} patch inside`);
        if (!s.round) assert.ok(s.length <= (Math.abs(Math.sin(s.angle - frame.rotation)) > .5 ? frame.width : frame.depth) + .01 && s.width <= (Math.abs(Math.sin(s.angle - frame.rotation)) > .5 ? frame.depth : frame.width) + .01, `${family} ${level} ${s.kind} patch fits`);
      }
      // Houses and their garages stay clear of the edge, so neighbouring houses never touch.
      for (const p of placements.filter(p => p.kind === 'cottage' || p.kind === 'family-house' || p.kind === 'office-building')) {
        const s = Math.sin(frame.rotation), c = Math.cos(frame.rotation), dx = p.x - frame.x, dz = p.z - frame.z;
        assert.ok(Math.abs(dx * c - dz * s) + p.width / 2 < frame.width / 2 - .2 && Math.abs(dx * s + dz * c) + p.depth / 2 < frame.depth / 2 - .2, `${family} ${level} a house off its plot's edge`);
      }
    }
  }
});

test('a house grows at every stage: one storey, two, a wing, a garage, a three-storey mansion', () => {
  const block = GRIDS.support.blocks.find(b => b.band === 3), frame = E.areaFrame(block, 2, 2);
  const stages = [1, 2, 3, 4, 5].map(level => E.plotLayout(frame, 'house', level, 11).placements);
  const storeys = list => Math.max(...list.filter(p => p.kind === 'cottage').map(p => p.variant + 1));
  assert.deepEqual(stages.map(storeys), [1, 2, 2, 2, 3]);
  stages.slice(1).forEach((list, i) => assert.notDeepEqual(list.map(p => p.kind).sort(), stages[i].map(p => p.kind).sort(), `stage ${i + 2} differs from stage ${i + 1}`));
  assert.ok(stages[4].length > stages[0].length * 2, 'the mansion has far more than the first house');
  assert.ok(stages[2].filter(p => p.kind === 'cottage').length === 2, 'a wing at the third stage');
  assert.ok(stages[3].some(p => p.kind === 'cottage' && p.tint === 8), 'a garage at the fourth stage');
  assert.ok(stages[4].some(p => p.kind === 'fountain') && stages[4].some(p => p.kind === 'lamp'), 'a fountain and lamps at the last');
  // The same house looks the same every time; another one differs.
  assert.deepEqual(E.plotLayout(frame, 'house', 3, 11), E.plotLayout(frame, 'house', 3, 11));
  assert.notDeepEqual(E.plotLayout(frame, 'house', 3, 11).placements.map(p => p.tint), E.plotLayout(frame, 'house', 3, 12).placements.map(p => p.tint));
  // Parks gather more: a park has more than four squares had, a big park more than a park.
  const one = E.plotLayout(frame, 'square', 1, 3).placements.length;
  const park = E.plotLayout(E.areaFrame(block, 0, 0, 2, 2), 'park', 1, 3).placements.length, big = E.plotLayout(E.areaFrame(block, 0, 0, 3, 2), 'bigpark', 1, 3).placements.length;
  assert.ok(park > one * 2 && big > park, `${one} → ${park} → ${big}`);
  assert.ok(E.plotLayout(E.areaFrame(block, 0, 0, 2, 2), 'park', 2, 3).placements.some(p => p.kind === 'fountain'), 'a fountain in the park\'s second stage');
});

test('all nine offices are finished one-plot purchases and fit every district plot with an entrance plaza', () => {
  assert.deepEqual(Object.keys(SERVER_OFFICES), Object.keys(E.OFFICE_BUILDINGS));
  assert.equal(Object.keys(SERVER_OFFICES).length, 9);
  assert.ok(!E.isOfficeBuilding('house') && !E.isOfficeBuilding('toString'));
  assert.equal(new Set(Array.from({ length: 9 }, (_, v) => E.officeModelName(v))).size, 9);
  assert.equal(E.officeModelName(8), 'office-building-9');
  const costs = Object.values(SERVER_OFFICES).map(m => m.price);
  assert.ok(costs.every((price, i) => price > 0 && (i === 0 || price > costs[i - 1])));
  assert.match(server, /\*\*\{key: \[price\] for key, \(_name, price\) in OFFICE_TOWERS\.items\(\)\}/);
  for (const [family, model] of Object.entries(E.OFFICE_BUILDINGS)) {
    assert.equal(model.name, SERVER_OFFICES[family].name);
    assert.equal(E.PLOT_LEVELS[family], 1);
    for (const rotation of [0, 1, 2, 3]) assert.deepEqual(E.plotFootprint(family, rotation), [1, 1]);
    for (const grid of Object.values(GRIDS)) for (const frame of grid.plots) {
      const layout = E.plotLayout(frame, family, 1, 19), offices = layout.placements.filter(p => p.kind === 'office-building');
      assert.equal(offices.length, 1);
      const [office] = offices, at = local(frame, office), front = at.w + office.depth / 2;
      assert.equal(office.variant, model.model - 1);
      assert.equal(office.rotation, frame.rotation);
      assert.equal(office.scale, E.officeBuildingScale(family, frame.width, frame.depth));
      assert.ok(office.scale > 0 && office.scale <= E.OFFICE_SCALE);
      assert.ok(Math.abs(at.u) + office.width / 2 <= frame.width / 2 - .499, `${family} clear of side boundaries`);
      assert.ok(at.w - office.depth / 2 >= -frame.depth / 2 + .499, `${family} clear of back boundary`);
      assert.ok(frame.depth / 2 - front >= 1.799, `${family} leaves its entrance plaza`);
      const path = layout.surfaces.find(s => s.kind === 'slab'), pathAt = local(frame, path);
      assert.ok(Math.abs(pathAt.w - path.width / 2 - front) < 1e-6 && Math.abs(pathAt.w + path.width / 2 - (frame.depth / 2 - .2)) < 1e-6, `${family} entrance paving reaches plot front`);
    }
  }
});

test('office GLB contains all nine source bodies, matching bounds and facade markers, with repeating textures and attribution', async () => {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { getBounds } = await import('@gltf-transform/functions');
  const { MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptDecoder.ready;
  const bytes = readFileSync(new URL('../../pages/city/models/high-rise-offices.glb', import.meta.url));
  assert.ok(bytes.length < 1024 * 1024, `high-rise-offices.glb is ${bytes.length} bytes`);
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).readBinary(new Uint8Array(bytes));
  const scenes = new Map(doc.getRoot().listScenes().map(s => [s.getName(), s]));
  assert.deepEqual([...scenes.keys()], Array.from({ length: 9 }, (_, v) => E.officeModelName(v)));
  for (const [family, model] of Object.entries(E.OFFICE_BUILDINGS)) {
    const scene = scenes.get(E.officeModelName(model.model - 1)), { min, max } = getBounds(scene);
    assert.ok(Math.abs(min[1]) < .01 && Math.abs(min[0] + max[0]) < .01 && Math.abs(min[2] + max[2]) < .01, `${family} is grounded and centred`);
    for (const [k, size] of [[0, model.width], [1, model.height], [2, model.depth]]) assert.ok(Math.abs(max[k] - min[k] - size) < .01, `${family} bounds match metadata`);
    const primitives = [];
    scene.traverse(node => { if (node.getMesh()) primitives.push(...node.getMesh().listPrimitives()); });
    assert.ok(primitives.length > 0);
    let marked = 0, dark = 0, triangles = 0;
    for (const primitive of primitives) {
      const seeds = primitive.getAttribute('_WINDOWSEED');
      assert.ok(seeds, `${family} facade mask exported`);
      for (let i = 0; i < seeds.getCount(); i++) {
        const value = seeds.getElement(i, [])[0];
        assert.ok(value >= 0 && value <= 1.0001);
        if (value > 0) marked++; else dark++;
      }
      triangles += primitive.getIndices().getCount() / 3;
    }
    assert.ok(marked > 0 && dark > 0, `${family} facades marked; roofs and trim dark`);
    assert.ok(triangles < 300, `${family} keeps its low-poly source geometry`);
  }
  assert.equal(doc.getRoot().listTextures().length, 6);
  for (const material of doc.getRoot().listMaterials()) if (material.getBaseColorTexture()) {
    const info = material.getBaseColorTextureInfo();
    assert.equal(info.getWrapS(), 10497); assert.equal(info.getWrapT(), 10497);
  }
  const license = readFileSync(new URL('../../pages/city/models/LICENSE-high-rise-offices.txt', import.meta.url), 'utf8');
  assert.match(license, /Phoenixdraws/); assert.match(license, /CC BY 3\.0/); assert.match(license, /blendswap\.com\/blends\/view\/74984/);
});

/** A layout's pieces in the plot's own axes: `u` across its width, `w` towards its front (the street). */
const local = (frame, p) => {
  const s = Math.sin(frame.rotation), c = Math.cos(frame.rotation), dx = p.x - frame.x, dz = p.z - frame.z;
  return { u: dx * c - dz * s, w: dx * s + dz * c };
};

test('ready houses: the server sells exactly these, finished, and each stands in its garden facing the street', () => {
  // The server's ready houses are this table's, cheapest first.
  const families = server.slice(server.indexOf('PLOT_FAMILIES = {'), server.indexOf('\n}\n', server.indexOf('PLOT_FAMILIES = {')));
  const ready = [...families.matchAll(/\n {4}"(\w+)": \{\n(?: {8}[^\n]*\n)*? {8}"ready": True,/g)].map(m => m[1]);
  assert.deepEqual(ready, Object.keys(E.READY_HOUSES));
  const prices = Object.fromEntries([...server.slice(server.indexOf('PLOT_PRICES = {')).matchAll(/^ {4}"(\w+)": \[(\d+)\],?$/gm)].map(m => [m[1], Number(m[2])]));
  const costs = ready.map(f => prices[f]);
  assert.ok(costs.every((c, i) => c > 0 && (i === 0 || c > costs[i - 1])), `prices go up: ${costs.join(', ')}`);
  for (const family of ready) assert.ok(E.isReadyHouse(family) && E.PLOT_LEVELS[family] === 1 && E.PLOT_SIZE[family].join() === '1,1', family);
  assert.ok(!E.isReadyHouse('house') && !E.isReadyHouse('square') && !E.isReadyHouse('toString'));
  // Every house in every finish is its own model.
  const names = Array.from({ length: 12 }, (_, v) => E.houseModelName(v));
  assert.equal(new Set(names).size, 12);
  assert.deepEqual(names.slice(0, 4), ['family-house-1-brick', 'family-house-1-stone', 'family-house-2-brick', 'family-house-2-stone']);
  for (const block of samples()) {
    const frame = E.areaFrame(block, 0, 0), street = { ...frame, street: true }, inner = { ...frame, street: false };
    for (const [family, m] of Object.entries(E.READY_HOUSES)) {
      const finishes = new Set();
      for (const seed of [1, 2, 3, 5, 8, 13]) {
        const { placements, surfaces } = E.plotLayout(street, family, 1, seed);
        const [house] = placements.filter(p => p.kind === 'family-house');
        assert.equal(placements.filter(p => p.kind === 'family-house').length, 1);
        assert.equal(Math.floor(house.variant / 2), m.model - 1, `${family} is model ${m.model}`);
        finishes.add(house.variant % 2);
        // Turned like its plot (front to the street), as large as the growing houses, its front garden before it.
        assert.ok(Math.abs(house.rotation - frame.rotation) < 1e-9 && house.scale === E.HOUSE_SCALE);
        const at = local(frame, house), front = at.w + m.depth * E.HOUSE_SCALE / 2;
        assert.ok(frame.depth / 2 - front > 1.4, `${family}: a front garden of ${(frame.depth / 2 - front).toFixed(2)}`);
        // A path from the door and a driveway from the garage both reach the street.
        const paving = surfaces.filter(x => x.kind === 'plaza' || x.kind === 'slab').map(x => ({ ...local(frame, x), kind: x.kind, along: x.length, across: x.width }));
        const reaches = (u, from) => paving.some(x => Math.abs(x.u - u) <= x.along / 2 + 1e-6 && x.w - x.across / 2 <= from + 1e-6 && x.w + x.across / 2 >= frame.depth / 2 - .25);
        assert.ok(reaches(m.door[0] * E.HOUSE_SCALE, front - m.door[1] * E.HOUSE_SCALE), `${family}: a path from its door`);
        if (m.garage) assert.ok(paving.some(x => x.kind === 'slab') && reaches(m.garage[0] * E.HOUSE_SCALE, front - m.garage[1] * E.HOUSE_SCALE), `${family}: a driveway from its garage`);
        else assert.ok(!paving.some(x => x.kind === 'slab'), `${family}: no garage, no driveway`);
        // The front hedge leaves the way to the street open; deeper in the block it closes the garden.
        const hedges = placements.filter(p => p.kind === 'hedge').map(p => ({ ...local(frame, p), width: p.width })).filter(h => Math.abs(h.w - (frame.depth / 2 - .35)) < 1e-6);
        assert.ok(!hedges.some(h => Math.abs(h.u - m.door[0] * E.HOUSE_SCALE) < h.width / 2), `${family}: the hedge is open at the path`);
        const closed = E.plotLayout(inner, family, 1, seed).placements.filter(p => p.kind === 'hedge').map(p => ({ ...local(frame, p), width: p.width })).filter(h => Math.abs(h.w - (frame.depth / 2 - .35)) < 1e-6);
        assert.ok(closed.length === 1 && closed[0].width > frame.width - 1.2, `${family}: a closed hedge in the block`);
      }
      assert.equal(finishes.size, 2, `${family} comes in brick and in stone`);
    }
  }
});

test('the ready houses\' model: every house in both finishes, of the table\'s size, its windows marked, light, CC0', async () => {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { getBounds } = await import('@gltf-transform/functions');
  const { MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptDecoder.ready;
  const bytes = readFileSync(new URL('../../pages/city/models/family-houses.glb', import.meta.url));
  assert.ok(bytes.length < 600 * 1024, `family-houses.glb is ${bytes.length} bytes`);
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).readBinary(new Uint8Array(bytes));
  const scenes = Object.fromEntries(doc.getRoot().listScenes().map(s => [s.getName(), s]));
  assert.deepEqual(Object.keys(scenes).sort(), Array.from({ length: 12 }, (_, v) => E.houseModelName(v)).sort());
  for (const m of Object.values(E.READY_HOUSES)) for (const finish of E.FINISHES) {
    const scene = scenes[`family-house-${m.model}-${finish}`], { min, max } = getBounds(scene);
    // The middle of the footprint on the ground, the table's width, depth and height.
    assert.ok(Math.abs(min[1]) < .01 && Math.abs(min[0] + max[0]) < .01 && Math.abs(min[2] + max[2]) < .01, `house ${m.model} ${finish} centred`);
    for (const [k, size] of [[0, m.width], [1, m.height], [2, m.depth]]) assert.ok(Math.abs(max[k] - min[k] - size) < .01, `house ${m.model} ${finish}: ${(max[k] - min[k]).toFixed(3)} for ${size}`);
    const primitives = scene.listChildren().flatMap(n => [n, ...n.listChildren()]).map(n => n.getMesh()).filter(Boolean).flatMap(mesh => mesh.listPrimitives());
    assert.equal(primitives.length, 1, 'one mesh, one material');
    const seeds = primitives[0].getAttribute('_WINDOWSEED');
    assert.ok(seeds, 'its windows are marked');
    const values = Array.from({ length: seeds.getCount() }, (_, i) => seeds.getElement(i, [])[0]);
    assert.ok(values.some(v => v > 0) && values.some(v => v === 0) && values.every(v => v >= 0 && v <= 1.0001));
    assert.ok(primitives[0].getIndices().getCount() / 3 < 1500, `house ${m.model}: ${primitives[0].getIndices().getCount() / 3} triangles`);
    assert.equal(primitives[0].getMaterial().getName(), `family-house-${finish}`);
  }
  assert.equal(doc.getRoot().listTextures().length, 2, 'the brick and the stone trim sheet');
  const license = readFileSync(new URL('../../pages/city/models/LICENSE-family-houses.txt', import.meta.url), 'utf8');
  assert.match(license, /CC0/); assert.match(license, /blendswap\.com\/blends\/view\/92125/); assert.match(license, /Family House Collection/);
});

test('the public square: cells map to the ground and back, shared buildings stay in their cells', () => {
  const square = GRIDS.support.centres[0].square;
  const centre = E.cellPoint(square, 6, 6), back = E.pointCell(square, E.cellPoint(square, 3.5, 7.25));
  assert.ok(Math.hypot(centre.x - square.x, centre.z - square.z) < 1e-9);
  assert.ok(Math.abs(back.u - 3.5) < 1e-9 && Math.abs(back.v - 7.25) < 1e-9);
  const inside = (p, x, z, angle, w, d, pad) => {
    const s = Math.sin(angle), c = Math.cos(angle), dx = p.x - x, dz = p.z - z;
    return Math.abs(dx * c - dz * s) <= w / 2 + pad && Math.abs(dx * s + dz * c) <= d / 2 + pad;
  };
  for (const [family, levels] of Object.entries(E.PROJECT_LEVELS)) for (let level = 1; level <= levels; level++) for (const rotation of [0, 1, 2, 3]) {
    const [w, h] = E.projectFootprint(family, rotation), at = E.cellPoint(square, w / 2, h / 2);
    const { placements, surfaces } = E.objectLayout(square, { family, level, u: 0, v: 0, rotation });
    const angle = square.rotation + rotation * Math.PI / 2, [W, D] = E.PROJECT_SIZE[family].map(n => n * E.CELL);
    assert.ok(placements.length >= 1 && surfaces.length >= 1, `${family} ${level}`);
    for (const p of placements) assert.ok(inside(p, at.x, at.z, angle, W, D, -.05), `${family} ${level} ${p.kind} inside`);
    for (const s of surfaces) assert.ok(inside(s, at.x, at.z, angle, W, D, .01), `${family} ${level} ${s.kind} patch inside`);
  }
});

test('the preview of a shared project gives the server\'s reasons', () => {
  const none = () => false;
  assert.equal(E.squareProblem({ family: 'fountain', u: 10, v: 10, rotation: 0 }, none), null);
  assert.equal(E.squareProblem({ family: 'fountain', u: 11, v: 10, rotation: 0 }, none), 'Проект должен целиком помещаться на общественной площади');
  assert.equal(E.squareProblem({ family: 'park', u: 9, v: 0, rotation: 1 }, none), null);
  assert.equal(E.squareProblem({ family: 'park', u: 10, v: 0, rotation: 0 }, none), 'Проект должен целиком помещаться на общественной площади');
  assert.equal(E.squareProblem({ family: 'square', u: 5, v: 5, rotation: 0 }, (u, v) => u === 5 && v === 5), 'Эти клетки уже заняты');
  assert.match(server, /"Проект должен целиком помещаться на общественной площади"/);
  assert.match(server, /"Эти клетки уже заняты"/);
});
