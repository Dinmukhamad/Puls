import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ stdin: { contents: `export * from './readyBuildings.ts'; export * from '../world/familyHouses.ts'; export * from '../world/officeBuildings.ts'; export { FACE } from './facade.ts'; export * as THREE from 'three/webgpu';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

// Existing geometry envelopes, including the eaves and entrance canopies that the parcel layouts already allow.
const HOUSE_ENVELOPES = {
  carport: [-1.57309258, 0, -1.16709256, 1.48049998, 1.33464539, 1.18564820],
  bungalow: [-2.15485191, 0, -1.46685183, 2.11781478, 1.44131482, 1.46685183],
  attic: [-1.25733328, 0, -1.35983336, 1.17400002, 1.96438432, 1.29131484],
  modern: [-1.00849998, 0, -1.11749995, 1.04553699, 1.31481481, 1.11749995],
  bayhouse: [-1.53831482, 0, -1.49733329, 1.47350001, 2.05225921, 1.44177783],
  terrace: [-1.08231485, 0, -1.22281480, 1.08231485, 1.24074078, 1.20799994],
};
const LANDMARK_ENVELOPES = {
  officej: [-1.16750002, 0, -1.16750002, 1.16750002, 6.80000019, 1.14999998],
  officek: [-2.76687121, 0, -1.39187121, 2.76687121, 18.69325066, 1.39187121],
  officel: [-4.01669073, 0, -4.48032475, 3.98723745, 6.70756292, 4.48436975],
};
const BASE_TRIANGLES = { carport: 558, bungalow: 464, attic: 630, modern: 360, bayhouse: 576, terrace: 570, officea: 330, officeb: 330, officec: 360, officed: 330, officee: 330, officef: 360, officeg: 330, officeh: 330, officei: 360, officej: 710, officek: 1014, officel: 2110 };

const models = () => [
  ...Object.keys(city.READY_HOUSES).flatMap(family => city.FINISHES.map(finish => ({ id: `${family}-${finish}`, family, geometry: city.readyHouseGeometry(family, finish), expected: HOUSE_ENVELOPES[family] }))),
  ...Object.entries(city.OFFICE_BUILDINGS).map(([family, size]) => ({ id: family, family, geometry: city.officeTowerGeometry(family), expected: LANDMARK_ENVELOPES[family] ?? [-size.width / 2, 0, -size.depth / 2, size.width / 2, size.height, size.depth / 2] })),
];

test('every upgraded house and office keeps the previous parcel envelope and stays within its browser geometry budget', () => {
  const all = models();
  assert.equal(all.length, 24);
  for (const { id, family, geometry, expected } of all) {
    const bounds = [...geometry.boundingBox.min.toArray(), ...geometry.boundingBox.max.toArray()];
    bounds.forEach((v, axis) => assert.ok(Math.abs(v - expected[axis]) < 2e-6, `${id}: envelope axis ${axis}`));
    const count = geometry.index.count / 3;
    assert.ok(count > BASE_TRIANGLES[family] && count < 2 * BASE_TRIANGLES[family], `${id}: structural detail within 2× baseline (${count})`);
    assert.ok(count < (family === 'officel' ? 2500 : 1500), `${id}: existing catalogue budget`);
    for (const name of ['position', 'normal', 'color', 'aSurf', 'aWin']) {
      assert.equal(geometry.attributes[name].count, geometry.attributes.position.count, `${id}: ${name} attribute`);
      assert.ok([...geometry.attributes[name].array].every(Number.isFinite), `${id}: finite ${name}`);
    }
    geometry.dispose();
  }
});

test('metal entrance and service details have outward-facing geometry, not only a recoloured facade', () => {
  for (const { id, geometry } of models()) {
    const p = geometry.attributes.position, n = geometry.attributes.normal, surface = geometry.attributes.aSurf, index = geometry.index;
    let metal = 0;
    for (let i = 0; i < index.count; i += 3) {
      const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (surface.getZ(a) !== city.FACE.metal) continue;
      metal++;
      const ab = [p.getX(b) - p.getX(a), p.getY(b) - p.getY(a), p.getZ(b) - p.getZ(a)];
      const ac = [p.getX(c) - p.getX(a), p.getY(c) - p.getY(a), p.getZ(c) - p.getZ(a)];
      const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const length = Math.hypot(...cross);
      assert.ok(length > 1e-12, `${id}: non-degenerate metal face`);
      const dot = (cross[0] * n.getX(a) + cross[1] * n.getY(a) + cross[2] * n.getZ(a)) / length;
      assert.ok(dot > .5, `${id}: front-facing metal face ${i / 3}`);
    }
    assert.ok(metal > 0, `${id}: real entrance/roof metal`);
    geometry.dispose();
  }
});

test('the houses retain both finishes and place new entrance hardware at the existing pedestrian path', () => {
  for (const [family, definition] of Object.entries(city.READY_HOUSES)) {
    const brick = city.readyHouseGeometry(family, 'brick'), stone = city.readyHouseGeometry(family, 'stone');
    assert.notDeepEqual([...brick.attributes.color.array], [...stone.attributes.color.array], `${family}: brick and stone remain distinct`);
    assert.deepEqual([...brick.attributes.position.array], [...stone.attributes.position.array], `${family}: finish does not change the plan`);
    const p = brick.attributes.position, kind = brick.attributes.aSurf;
    const front = definition.depth / 2 - definition.door[1];
    let hardware = false;
    for (let i = 0; i < p.count; i++) if (kind.getZ(i) === city.FACE.metal && Math.abs(p.getX(i) - definition.door[0]) < .2 && Math.abs(p.getZ(i) - front) < .1 && p.getY(i) > .03 && p.getY(i) < .5) hardware = true;
    assert.ok(hardware, `${family}: entrance follows its existing path`);
    brick.dispose(); stone.dispose();
  }
});

test('dormer room panes are visible above the main roof and carry stable lighting identities', () => {
  const { THREE } = city;
  for (const family of ['carport', 'attic', 'bayhouse']) {
    const geometry = city.readyHouseGeometry(family, 'brick'), p = geometry.attributes.position, surf = geometry.attributes.aSurf, win = geometry.attributes.aWin;
    const panes = new Map();
    for (let i = 0; i < p.count; i++) if (surf.getZ(i) === city.FACE.pane) {
      const id = win.getX(i);
      assert.ok(id > 0 && id < 1, `${family}: actual room pane has a valid fixed identity`);
      if (!panes.has(id)) panes.set(id, new THREE.Box3());
      panes.get(id).expandByPoint(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
    }
    assert.equal(panes.size, family === 'attic' ? 2 : 1, `${family}: every dormer has one room window`);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld();
    for (const bounds of panes.values()) {
      // Sample away from the centre mullion and sill. A roof intersection would be the nearest face here.
      const x = bounds.min.x + (bounds.max.x - bounds.min.x) * .25, y = bounds.min.y + (bounds.max.y - bounds.min.y) * .4;
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y, geometry.boundingBox.max.z + 1), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(mesh, false)[0];
      assert.ok(hit && surf.getZ(hit.face.a) === city.FACE.pane, `${family}: the main roof does not cut across the dormer glazing`);
    }
    geometry.dispose(); material.dispose();
  }
});
