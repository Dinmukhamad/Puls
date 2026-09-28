import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const load = async (contents) => {
  const built = await build({ stdin: { contents, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
};
const gen = await load(`export * from './generate.ts'; export * from './worldSpec.ts'; export * from './sites.ts';`);
const X4 = gen.generateWorld(gen.WORLD_X4), V1 = gen.generateWorld(gen.WORLD_V1);
const server = readFileSync(new URL('../../../../app/services/city_group.py', import.meta.url), 'utf8');
const inSite = (p, c, pad) => { const ux = Math.sin(c.angle), uz = Math.cos(c.angle), dx = p.x - c.x, dz = p.z - c.z; return Math.abs(dx * ux + dz * uz) <= c.length / 2 + pad && Math.abs(dz * ux - dx * uz) <= c.depth / 2 + pad; };
const HEIGHT = { section: [3, 4, 5, 7, 9, 12, 16], 'glass-tower': [3, 8, 12, 18, 26, 34], cottage: [1, 2] };
const tallest = (list) => Math.max(0, ...list.filter((p) => HEIGHT[p.kind]).map((p) => HEIGHT[p.kind][p.variant]));

test('x4 has the quarters the server builds, spread round the canal, the first in the default view', () => {
  const projects = [...server.matchAll(/\("Квартал «[^»]+»", \d+\)/g)].length;
  assert.deepEqual(X4.sites.map((s) => s.key), Array.from({ length: projects }, (_, i) => `site-${i}`));
  assert.deepEqual(V1.sites, []);
  assert.equal(new Set(X4.sites.map((s) => s.complex)).size, X4.sites.length);
  const angles = X4.sites.map((s) => Math.atan2(s.z, s.x)), facing = gen.WORLD_X4.sites.facing;
  const apart = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  assert.ok(angles.slice(1).every((a) => apart(a, facing) >= apart(angles[0], facing)), 'site-0 is nearest the default view');
  for (const a of angles) for (const b of angles) if (a !== b) assert.ok(apart(a, b) > .5, 'quarters spread round the city');
  assert.ok(X4.sites.some((s) => !s.business), 'a residential quarter');
});

test('a quarter is drawn only by its stages, and every stage stays on its lot and grows', () => {
  const chosen = new Set(X4.sites.map((s) => s.complex));
  assert.ok(X4.placements.every((p) => p.site === undefined || !chosen.has(p.site)), 'no quarter copy in the city pools');
  assert.ok(X4.surfaces.every((s) => s.site === undefined || !chosen.has(s.site)), 'no quarter patch in the terrain');
  for (const site of X4.sites) {
    assert.ok(site.placements.filter((p) => HEIGHT[p.kind]).length >= 2, `${site.key} has buildings`);
    const layouts = gen.SITE_STAGES.map((stage) => gen.siteLayout(site, stage));
    const [planned, foundation, frame, floors, done] = layouts;
    assert.equal(planned.placements.length, 0); assert.equal(foundation.placements.length, 0);
    assert.ok(foundation.surfaces.length > planned.surfaces.length, 'slabs where the buildings go');
    assert.ok(frame.placements.every((p) => p.kind === 'cottage' || (p.kind === 'section' && p.variant === 0 && p.tint === 8)), 'grey frames');
    assert.ok(tallest(frame.placements) < tallest(floors.placements) && tallest(floors.placements) < tallest(done.placements), `${site.key} grows`);
    assert.deepEqual(done, { placements: site.placements, surfaces: site.surfaces });
    for (const { placements, surfaces } of layouts.slice(0, 4)) for (const p of [...placements, ...surfaces]) assert.ok(inSite(p, site, 1.7), `${site.key}: ${p.kind} on the lot`);
  }
});

test('the daily situations wait at a car of each district car park and at the guide, in both cities', () => {
  const givers = [...readFileSync(new URL('../../../../app/services/city_quests.py', import.meta.url), 'utf8').match(/GIVERS = \(([^)]*)\)/)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
  for (const world of [X4, V1]) {
    assert.equal(world.questSpots.length, givers.length);
    const cars = world.placements.filter((p) => p.kind === 'car-parked');
    for (const spot of world.questSpots.slice(0, 2)) assert.ok(cars.some((car) => car.x === spot.x && car.z === spot.z), 'a parked car');
    for (const [i, lot] of world.roads.parking.slice(0, 2).entries()) assert.ok(Math.hypot(world.questSpots[i].x - lot.x, world.questSpots[i].z - lot.z) < lot.length / 2 + 1, `spot ${i} in its car park`);
    assert.deepEqual(world.questSpots[2], { x: 0, z: 0 });
  }
});
