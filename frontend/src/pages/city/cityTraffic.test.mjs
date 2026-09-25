import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { Box3, Vector3 } from 'three';

const built = await build({ entryPoints: [fileURLToPath(new URL('./cityTraffic.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { createTaxiModel } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const dispose = (taxi) => taxi.children.forEach(part => { part.geometry.dispose(); part.material.dispose(); });

test('taxi fits the one-unit lane at the existing car scale, rests on its tyres and faces +Z', () => {
  const taxi = createTaxiModel();
  taxi.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(taxi), size = bounds.getSize(new Vector3());
  assert.ok(size.x * .5 >= .8 && size.x * .5 <= .9, `width ${size.x * .5}`);
  assert.ok(size.z * .5 >= 1.5 && size.z * .5 <= 1.65, `length ${size.z * .5}`);
  assert.ok(size.y * .5 < .85 && Math.abs(bounds.min.y) < 1e-6, 'car sits on the road');
  const lamps = taxi.children.find(part => part.name === 'taxi-lights').geometry;
  const points = lamps.getAttribute('position'), colors = lamps.getAttribute('color');
  let front = 0, rear = 0;
  for (let i = 0; i < points.count; i++) {
    if (points.getZ(i) > 1.4 && colors.getY(i) > .5) front++;
    if (points.getZ(i) < -1.4 && colors.getX(i) > colors.getY(i) * 2) rear++;
  }
  assert.ok(front > 0 && rear > 0, 'warm headlights lead and red lamps trail the route heading');
  dispose(taxi);
});

test('taxi fleet can be instanced in four draw calls with a bounded geometry budget and no external textures', () => {
  const taxi = createTaxiModel();
  assert.equal(taxi.children.length, 4);
  let triangles = 0;
  for (const part of taxi.children) {
    assert.equal(part.isMesh, true);
    assert.equal(part.castShadow, true);
    assert.equal(part.material.map, null);
    triangles += part.geometry.getAttribute('position').count / 3;
    for (const attribute of Object.values(part.geometry.attributes)) {
      assert.ok([...attribute.array].every(Number.isFinite), 'all geometry attributes are finite');
    }
  }
  assert.ok(triangles < 2500, `${triangles} triangles per taxi exceeds the mobile budget`);
  dispose(taxi);
});
