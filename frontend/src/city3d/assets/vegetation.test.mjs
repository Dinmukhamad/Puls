import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: `export * from './vegetation.ts'; export * from './courtyard.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false });
const city = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const furniture = ['bench', 'slide', 'swings', 'climber', 'sandbox', 'goal', 'hoop', 'gazebo', 'flowerbed', 'bush', 'hedge', 'planter', 'fountain'];
const bounds = {
  cone: [[-.6, 0, -.6], [.6, 2.4, .6]], round: [[-.62, 0, -.62], [.62, 1.92, .62]],
  birch: [[-.46, 0, -.46], [.46, 2.65, .46]], oak: [[-.82, 0, -.72], [.9, 2.05, .68]],
  bench: [[-.475, 0, -.1775], [.475, .6, .16]], slide: [[-.367696, -.006556, -1.219518], [.367696, 1.845, .962444]],
  swings: [[-.9, -.00982, -.413595], [.9, 1.334641, .413595]], climber: [[-.625981, 0, -.63], [.625981, 1.025, .63]],
  sandbox: [[-.65, 0, -.65], [.925528, 1.29, .95]], goal: [[-.925, -.010373, -.565], [.925, .81, .025]],
  hoop: [[-.32, 0, -.45], [.32, 1.72, .23064]], gazebo: [[-1.229756, 0, -1.42], [1.229756, 1.875, 1.42]],
  flowerbed: [[-.58, 0, -.58], [.58, .56, .58]], bush: [[-.35013, -.0656, -.34], [.387143, .492, .34]],
  hedge: [[-.525, 0, -.16], [.525, .36, .16]], planter: [[-.3, 0, -.3], [.3, 1.37013, .3]], fountain: [[-1, 0, -1], [1, 1.445, 1]],
};
const model = name => furniture.includes(name) ? city.furnitureGeometry(name)[0] : city.vegetationGeometry(name);

test('all replacement planting and street models retain road clearances, heights and a single lightweight geometry', () => {
  for (const [name, expected] of Object.entries(bounds)) {
    const g = model(name), positions = g.getAttribute('position');
    assert.ok(positions.count / 3 < 1000, `${name} below 1,000 triangles`);
    assert.ok(positions.count > 100, `${name} has modeled detail`);
    g.computeBoundingBox();
    for (const [index, edge] of ['min', 'max'].entries()) g.boundingBox[edge].toArray().forEach((value, axis) => assert.ok(Math.abs(value - expected[index][axis]) < .00001, `${name} ${edge}/${axis} moved into a path or changed height`));
    for (const key of ['position', 'normal', 'color', 'aProp']) {
      assert.equal(g.getAttribute(key).count, positions.count, `${name}/${key} matches vertex layout`);
      assert.ok([...g.getAttribute(key).array].every(Number.isFinite));
    }
    assert.equal(g.getAttribute('uv'), undefined, 'no new texture fetches or material splits');
    g.dispose();
  }
});

test('smooth crowns keep many shared normals while trunk and leaves carry separate surface properties', () => {
  for (const name of ['cone', 'round', 'birch', 'oak']) {
    const g = city.vegetationGeometry(name), normals = g.getAttribute('normal'), surfaces = g.getAttribute('aProp');
    const leafyNormals = new Set(), roughness = new Set();
    for (let i = 0; i < normals.count; i++) {
      assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < .0001);
      roughness.add(surfaces.getX(i).toFixed(2));
      if (surfaces.getX(i) > .9) leafyNormals.add([normals.getX(i), normals.getY(i), normals.getZ(i)].map(v => v.toFixed(3)).join());
    }
    assert.ok(leafyNormals.size > 40, `${name} crown has smooth varied normals`);
    assert.ok(roughness.has('0.86') && roughness.has('0.94'), `${name} distinguishes bark and foliage`);
    const again = city.vegetationGeometry(name);
    assert.deepEqual(g.attributes.position.array, again.attributes.position.array, 'fixed shapes do not jitter between catalogues');
    g.dispose(); again.dispose();
  }
});

test('shared props can shade exposed iron, wood, soil, leaves and fountain water independently', () => {
  const bench = city.furnitureGeometry('bench')[0], fountain = city.furnitureGeometry('fountain')[0], planter = city.furnitureGeometry('planter')[0];
  const samples = g => Array.from({ length: g.attributes.aProp.count }, (_, i) => [g.attributes.aProp.getX(i), g.attributes.aProp.getY(i)]);
  assert.ok(samples(bench).some(([rough, metal]) => rough < .5 && metal > .6), 'iron frames reflect as metal');
  assert.ok(samples(bench).some(([rough, metal]) => rough > .7 && metal === 0), 'wooden slats stay matte');
  assert.ok(samples(fountain).some(([rough]) => rough < .2), 'water differs from the stone basin');
  assert.ok(samples(planter).some(([rough]) => rough > .97) && samples(planter).some(([rough]) => rough > .9 && rough < .96), 'soil and living crown differ');
  [bench, fountain, planter].forEach(g => g.dispose());
});
