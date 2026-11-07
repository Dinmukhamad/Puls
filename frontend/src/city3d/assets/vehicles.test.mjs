import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ stdin: { contents: 'export * from "./vehicles.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { THREE, PART } = city;
const CAR_SCALE = .5;
/** The old sizes: the Car Kit's [width, height, length] (its cars had no mirrors) and the traffic taxi's with them. */
const KIT = { sedan: [1.5, 1.3, 2.55], suv: [1.5, 1.3, 2.7], van: [1.5, 1.35, 2.75], delivery: [1.5, 1.65, 3.25], truck: [1.5, 1.3, 2.95], 'hatchback-sports': [1.3, 1.1, 2.85], police: [1.5, 1.3, 3.1] };
const sizeOf = g => g.boundingBox.getSize(new THREE.Vector3());
const kindsOf = g => { const surf = g.getAttribute('aSurf'), list = []; for (let i = 0; i < surf.count; i++) list.push(surf.getZ(i)); return list; };

test('every car keeps its old size and lane, rests on its wheels and faces +z with its lamps', () => {
  for (const [name, [w, h, l]] of Object.entries(KIT)) {
    const g = city.vehicleGeometry(name), size = sizeOf(g);
    assert.ok(Math.abs(size.z - l) / l < .03 && Math.abs(size.y - h) / h < .05, `${name}: ${size.toArray().map(v => v.toFixed(2))}`);
    // The body is the kit's width; the mirrors stand out a little, and the car still fits a one-unit lane.
    assert.ok(size.x >= w && size.x <= w + .14 && size.x * CAR_SCALE < .85, `${name} width ${size.x.toFixed(2)}`);
  }
  const taxi = sizeOf(city.vehicleGeometry('taxi'));
  assert.ok(taxi.x * CAR_SCALE >= .8 && taxi.x * CAR_SCALE <= .9 && taxi.z * CAR_SCALE >= 1.5 && taxi.z * CAR_SCALE <= 1.65 && taxi.y * CAR_SCALE < .85, `taxi ${taxi.toArray().map(v => (v * CAR_SCALE).toFixed(2))}`);
  assert.ok(Math.abs(taxi.z * city.PARKED_TAXI_SCALE - 2.75) < .06, 'parked taxis keep the kit taxi\'s length');
  for (const name of city.VEHICLES.filter(n => n !== 'boat')) {
    const g = city.vehicleGeometry(name), b = g.boundingBox, position = g.getAttribute('position'), kinds = kindsOf(g);
    assert.ok(b.min.y >= 0 && b.min.y < .02 && Math.abs(b.min.x + b.max.x) < 1e-3, `${name} stands centred on its tyres`);
    let front = 0, rear = 0;
    kinds.forEach((kind, i) => {
      if (kind === PART.head) { assert.ok(position.getZ(i) > b.max.z * .85, `${name} headlights lead`); front++; }
      if (kind === PART.tail && position.getY(i) < 1) { assert.ok(position.getZ(i) < b.min.z * .85, `${name} tail lamps trail`); rear++; }
    });
    assert.ok(front > 0 && rear > 0, name);
  }
});

test('each vehicle is one geometry built once, within the triangle budget, with finite attributes and a palette', () => {
  for (const name of city.VEHICLES) {
    const g = city.vehicleGeometry(name);
    assert.equal(city.vehicleGeometry(name), g, 'shared, built once');
    const triangles = g.index.count / 3;
    assert.ok(triangles < (name === 'boat' ? 800 : 1500), `${name}: ${triangles} triangles`);
    for (const attribute of Object.values(g.attributes)) assert.ok(Array.from(attribute.array).every(Number.isFinite), `${name}: finite ${attribute.name ?? ''}`);
    assert.ok(city.PAINTS[name]?.length >= 1, `${name} has paints`);
    const kinds = new Set(kindsOf(g));
    assert.ok(kinds.has(PART.rubber) || name === 'boat', `${name} has tyres`);
    assert.ok(kinds.has(PART.glass), `${name} has glass`);
  }
});

test('the vehicles\' material tints only the paint and mirrors the sky; the surfaces leave the builder\'s special kinds alone', () => {
  const material = city.vehicleMaterial();
  assert.ok(material.isMeshStandardNodeMaterial && material.userData.copyTint === 'own' && !material.vertexColors);
  assert.ok(material.colorNode && material.emissiveNode && material.roughnessNode);
  // The builder's boxes treat the facade's window (0), curtain (5) and mirror (11) kinds specially.
  for (const kind of Object.values(PART)) assert.ok(![0, 5, 11].includes(kind));
  material.dispose();
});
