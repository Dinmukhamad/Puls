import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ entryPoints: [fileURLToPath(new URL('./driverMapStyle.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { bearing, tuneStyle, routeLayers, MAP_STYLES, RUSSIAN_LABEL } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

test('the car heading follows the direction of travel and ignores GPS jitter', () => {
  const start = { latitude: 43.2389, longitude: 76.8897 };
  assert.ok(Math.abs(bearing(start, { latitude: 43.2489, longitude: 76.8897 })) < 1);
  assert.ok(Math.abs(bearing(start, { latitude: 43.2389, longitude: 76.9097 }) - 90) < 1);
  assert.ok(Math.abs(bearing(start, { latitude: 43.2289, longitude: 76.8897 }) - 180) < 1);
  assert.equal(bearing(start, { latitude: 43.23891, longitude: 76.88971 }), null);
});

test('the style gets Russian labels, 3D buildings under the labels and theme colours', () => {
  const calls = [], layers = [{ id: 'water', type: 'fill' }, { id: 'highway_minor', type: 'line' }, { id: 'road_name', type: 'symbol', layout: { 'text-field': '{name}' } }, { id: 'place', type: 'symbol', layout: { 'text-field': '{name}' } }];
  const map = { getStyle: () => ({ layers }), getLayer: (id) => layers.some((l) => l.id === id) ? {} : undefined, setLayoutProperty: (...a) => calls.push(['layout', ...a]), setPaintProperty: (...a) => calls.push(['paint', ...a]), addLayer: (layer, before) => calls.push(['add', layer.id, before]) };
  tuneStyle(map, 'dark');
  assert.deepEqual(calls.filter((c) => c[0] === 'layout').map((c) => c[1]), ['road_name', 'place']);
  assert.deepEqual(calls.find((c) => c[0] === 'layout')[3], RUSSIAN_LABEL);
  assert.deepEqual(calls.find((c) => c[0] === 'add'), ['add', 'dx-buildings-3d', 'road_name']);
  assert.ok(calls.some((c) => c[0] === 'paint' && c[1] === 'highway_minor'));
  assert.match(MAP_STYLES.dark, /openfreemap/);
  assert.deepEqual(routeLayers('light').map((l) => l.id), ['dx-route-glow', 'dx-route-casing', 'dx-route']);
});
