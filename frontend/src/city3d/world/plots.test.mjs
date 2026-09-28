import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const load = async (contents) => {
  const built = await build({ stdin: { contents, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
};
const gen = await load(`export * from './generate.ts'; export * from './worldSpec.ts'; export * from './plots.ts';`);
const X4 = gen.generateWorld(gen.WORLD_X4), V1 = gen.generateWorld(gen.WORLD_V1);
const server = readFileSync(new URL('../../../../app/services/city.py', import.meta.url), 'utf8');
const corners = (plot, pad = 0) => [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([u, w]) => {
  const h = plot.size / 2 + pad, s = Math.sin(plot.rotation), c = Math.cos(plot.rotation);
  return { x: plot.x + c * u * h + s * w * h, z: plot.z - s * u * h + c * w * h };
});

test('the x4 city has the plots the server sells, the old city none', () => {
  const districts = JSON.parse(server.match(/PLOT_DISTRICTS = (\(.*?\))/)[1].replace('(', '[').replace(')', ']'));
  const keys = districts.flatMap((d) => [0, 1, 2, 3].map((i) => `${d}-${i}`));
  assert.deepEqual(X4.plots.map((p) => p.key), keys);
  assert.deepEqual(V1.plots, []);
  const buildings = [...server.matchAll(/^\s+\("(\w+)", "[^"]+", "[^"]+", "[^"]+", \d+\),$/gm)].map((m) => m[1]);
  assert.deepEqual(buildings, [...gen.BUILDING_KEYS]);
});

test('plots lie on the green belt, clear of roads, car parks, each other and every placement', () => {
  const s = gen.WORLD_X4, segments = [...X4.roads.streets, ...X4.roads.bridges.map((b) => b.road)];
  for (const plot of X4.plots) {
    for (const p of corners(plot)) {
      const r = Math.hypot(p.x, p.z);
      assert.ok(r > s.roadRings[0] + gen.ROAD_HALF + .4 && r < s.promenade - .6, `${plot.key} on the belt`);
      assert.ok(segments.every((road) => gen.segmentDistance(p.x, p.z, road) > gen.ROAD_HALF + .3), `${plot.key} clear of streets`);
    }
    for (const lot of X4.roads.parking) for (const stall of lot.stalls) assert.ok(!gen.insidePlot(stall, plot, 1), `${plot.key} clear of parking`);
    for (const other of X4.plots) if (other !== plot) assert.ok(Math.hypot(other.x - plot.x, other.z - plot.z) > plot.size + 1, `${plot.key} apart`);
    assert.ok(X4.placements.every((p) => !gen.insidePlot(p, plot, .3)), `${plot.key} is empty`);
  }
});

test('every building, the building site and a shut plot stay on their plot', () => {
  const kinds = new Set(X4.placements.map((p) => p.kind));
  for (const plot of X4.plots) for (const state of [{ unlocked: false, item: null }, { unlocked: true, item: null }, ...gen.BUILDING_KEYS.map((item) => ({ unlocked: true, item }))]) {
    const { placements, surfaces } = gen.plotLayout(plot, state);
    assert.ok(surfaces.length > 0);
    if (state.item) assert.ok(placements.length >= 3, `${state.item} has pieces`);
    for (const p of placements) {
      assert.ok(kinds.has(p.kind), `${p.kind} is a known model`);
      assert.ok(gen.insidePlot(p, plot, -.2), `${state.item} ${p.kind} inside ${plot.key}`);
    }
    for (const surface of surfaces) assert.ok(gen.insidePlot(surface, plot), `${surface.kind} inside`);
  }
});
