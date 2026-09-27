import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { Matrix4, Vector3, Box3 } from 'three/webgpu';

const built = await build({
  entryPoints: [fileURLToPath(new URL('./life.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { createLife } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const matrices = (life) => life.group.children.map(mesh => [...mesh.instanceMatrix.array]);

test('caller time pauses and replays the entire population including limb motion', () => {
  const life = createLife();
  const initial = matrices(life);
  life.update(12.75);
  const moved = matrices(life);
  assert.notDeepEqual(moved, initial);
  life.update(12.75);
  assert.deepEqual(matrices(life), moved, 'the same simulation time cannot advance traffic or walking');
  life.update(0);
  assert.deepEqual(matrices(life), initial, 'no accumulated drift or runtime randomness');
  life.update(Number.NaN);
  assert.deepEqual(matrices(life), initial, 'invalid clocks do not poison instance matrices');
  life.dispose();
});

test('taxis face their travel direction, stay separated on the road and pedestrians avoid the building', () => {
  const life = createLife();
  const taxi = life.group.children.find(mesh => mesh.name === 'taxi-body-fleet');
  const walkers = life.group.children.find(mesh => mesh.name === 'walker-jackets');
  const matrix = new Matrix4();
  for (const time of [0, 7, 42, 150]) {
    life.update(time);
    const positions = [];
    for (let index = 0; index < taxi.count; index++) {
      taxi.getMatrixAt(index, matrix);
      const p = new Vector3().setFromMatrixPosition(matrix);
      const forward = new Vector3(0, 0, 1).transformDirection(matrix);
      const tangent = new Vector3(-p.z, 0, p.x).normalize();
      assert.ok(forward.dot(tangent) > .9999, 'taxi headlights lead the direction of travel');
      assert.ok(Math.abs(Math.hypot(p.x, p.z) - 13.8) < .00001);
      assert.ok(Math.abs(p.y - .115) < .00001);
      for (const previous of positions) assert.ok(p.distanceTo(previous) > 8, 'ample separation prevents collision');
      positions.push(p);
    }
    for (let index = 0; index < walkers.count; index++) {
      walkers.getMatrixAt(index, matrix);
      const p = new Vector3().setFromMatrixPosition(matrix);
      assert.ok(Math.abs(Math.hypot(p.x, p.z) - 10.4) < .00001);
      assert.ok(Math.abs(p.x) > 6.5 || p.z < -7 || p.z > 3, 'walking route clears the entire building with margin');
    }
  }
  life.dispose();
});

test('population stays within an explicit geometry and draw budget and uses moving instance shadows', (t) => {
  const life = createLife();
  let triangles = 0;
  for (const mesh of life.group.children) {
    assert.equal(mesh.isInstancedMesh, true);
    assert.equal(mesh.castShadow, true);
    assert.equal(mesh.receiveShadow, true);
    assert.equal(mesh.frustumCulled, false, 'initial placement bounds cannot hide later moving instances');
    const vertices = mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count;
    triangles += vertices / 3 * mesh.count;
    for (const attribute of Object.values(mesh.geometry.attributes)) {
      assert.ok([...attribute.array].every(Number.isFinite));
    }
  }
  assert.ok(life.group.children.length <= 14);
  assert.ok(triangles < 70000, `population is ${triangles} triangles`);
  const roadBounds = new Box3();
  for (const mesh of life.group.children.filter(part => part.name.startsWith('taxi-'))) {
    mesh.computeBoundingBox(); roadBounds.union(mesh.boundingBox);
  }
  assert.ok(Math.abs(roadBounds.min.y - .115) < .00001, 'tyres rest directly on the road');
  t.diagnostic(`${life.group.children.length} instanced base-pass draws; ${triangles} submitted triangles for the whole population`);
  life.dispose();
});

test('night lights update and every owned GPU resource is disposed once', () => {
  const life = createLife();
  const lamps = life.group.children.find(mesh => mesh.name === 'taxi-lights-fleet').material;
  life.setNight(true);
  assert.ok(lamps.emissiveIntensity > 1);
  life.setNight(false);
  assert.ok(lamps.emissiveIntensity < 1);
  const resources = new Set(life.group.children.flatMap(mesh => [mesh, mesh.geometry, mesh.material]));
  const events = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => events.set(resource, events.get(resource) + 1));
  life.dispose();
  life.dispose();
  life.update(20);
  life.setNight(true);
  assert.equal(life.group.children.length, 0);
  assert.ok([...events.values()].every(count => count === 1));
});
