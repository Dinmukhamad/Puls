import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { Box3, Vector3 } from 'three';

const built = await build({ entryPoints: [fileURLToPath(new URL('./cityIslands.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { createDistrictIslands } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

test('five landscaped plots share a bounded mesh budget and produce finite shadow-ready geometry', () => {
  const islands = createDistrictIslands();
  assert.equal(islands.userData.districtCount, 5);
  assert.ok(islands.children.length <= 30, 'static detail is batched instead of hundreds of draw calls');
  let triangles = 0;
  islands.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(islands), size = bounds.getSize(new Vector3());
  assert.ok(bounds.min.y >= .19 && bounds.max.y < 4, 'plots sit above the ground without towering over landmarks');
  assert.ok(size.x > 35 && size.x < 50 && size.z > 35 && size.z < 50);
  for (const mesh of islands.children) {
    assert.ok(mesh.castShadow && mesh.receiveShadow);
    const positions = mesh.geometry.getAttribute('position');
    assert.ok([...positions.array].every(Number.isFinite));
    triangles += positions.count / 3;
    mesh.geometry.dispose(); mesh.material.dispose();
  }
  assert.ok(triangles < 30000, `${triangles} triangles exceed the five-island budget`);
});
