import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Lamp lights, the catalogue and the generator in one bundle, so they share one copy of three. Vite's `?url`
// imports become plain paths; the catalogue is built without any loaded models, as its lamps are procedural.
const built = await build({
  stdin: { contents: 'export * from "./lampLights.ts"; export * from "./night.ts"; export * from "../assets/catalogue.ts"; export * from "../world/generate.ts"; export * from "../world/worldSpec.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
  plugins: [{ name: 'url', setup(b) {
    b.onResolve({ filter: /\?url$/ }, a => ({ path: a.path, namespace: 'url' }));
    b.onLoad({ filter: /.*/, namespace: 'url' }, a => ({ contents: `export default ${JSON.stringify(a.path.replace(/\?url$/, ''))};`, loader: 'js' }));
  } }],
});
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { THREE } = city;
// The catalogue paints its facades on a canvas: a stand-in that draws nothing.
const noop = () => {};
const context2d = new Proxy({}, { get: (_, key) => key === 'measureText' ? () => ({ width: 0 }) : noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context2d }) };
const worlds = { v1: city.generateWorld(city.WORLD_V1), x4: city.generateWorld(city.WORLD_X4) };

function context(world, night = false) {
  const frames = new Set(), scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#172946', world.radius * .79, world.radius * 2.2);
  return { world, scene, night: city.createNight(night), onFrame(cb) { frames.add(cb); return () => frames.delete(cb); }, frame(dt) { this.night.step(dt); frames.forEach(cb => cb(dt, 0)); }, get listeners() { return frames.size; } };
}
const at = (mesh, i) => new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('lampAt'), i);
/** Does `node` use `target` anywhere below it? */
const uses = (node, target, seen = new Set()) => node === target || (!!node && !seen.has(node) && (seen.add(node), [...node.getChildren()].some(child => uses(child, target, seen))));

for (const [name, world] of Object.entries(worlds)) test(`${name}: one pool and one halo per lamp, under and around its bulb`, () => {
  const ctx = context(world), lights = city.createLampLights(ctx), lamps = world.placements.filter(p => p.kind === 'lamp');
  assert.ok(lamps.length > 20);
  assert.deepEqual(ctx.scene.children, [lights.pools, lights.halos]);
  for (const mesh of [lights.pools, lights.halos]) {
    // One draw call each: a quad drawn once per lamp, placed by the shader (no instance matrices).
    assert.ok(mesh.geometry.isInstancedBufferGeometry && !mesh.isInstancedMesh);
    assert.equal(mesh.geometry.instanceCount, lamps.length);
    assert.ok(mesh.material.transparent && !mesh.material.depthWrite && mesh.material.blending === THREE.AdditiveBlending && !mesh.material.fog);
    assert.ok(!mesh.castShadow && !mesh.receiveShadow);
    // Every attribute the basic material reads is there (a missing normal only warns, on every compile).
    for (const attribute of ['position', 'normal', 'uv', 'lampAt', 'lampShade']) assert.ok(mesh.geometry.getAttribute(attribute), attribute);
    assert.ok(mesh.geometry.getAttribute('lampAt').isInstancedBufferAttribute && mesh.geometry.getAttribute('lampShade').isInstancedBufferAttribute);
  }
  assert.ok(lights.pools.geometry.getAttribute('lampGround').isInstancedBufferAttribute);
  lamps.forEach((lamp, i) => {
    const pool = at(lights.pools, i), halo = at(lights.halos, i);
    assert.ok(Math.abs(pool.x - lamp.x) < 1e-4 && Math.abs(pool.z - lamp.z) < 1e-4 && Math.abs(halo.x - lamp.x) < 1e-4 && Math.abs(halo.z - lamp.z) < 1e-4);
    // Above the street tops (0.26) and zebra stripes (0.268), below anything a lamp's light would sit on.
    assert.ok(pool.y > .268 && pool.y < .3);
    assert.ok(Math.abs(halo.y - city.BULB_Y) < 1e-6);
  });
  // The pool is flat, facing up, about 2.2…2.6 units in radius.
  const box = new THREE.Box3().setFromBufferAttribute(lights.pools.geometry.getAttribute('position'));
  assert.ok(box.max.y - box.min.y < 1e-9);
  assert.ok(box.max.x >= 2.2 && box.max.x <= 2.6);
  lights.dispose();
});

// The shader's cut, on the CPU: lit on the lamp's land ring or on its bridge deck (smoothstep as in GLSL).
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function lit([inner, outer, angle, offset], dx, dz, x, z) {
  const r = Math.hypot(x, z), onLand = smooth(inner, inner + .1, r) * (1 - smooth(outer - .1, outer, r));
  return Math.max(onLand, 1 - smooth(city.BRIDGE_HALF - .1, city.BRIDGE_HALF, Math.abs(dx * Math.cos(angle) + dz * Math.sin(angle) - offset)));
}
for (const [name, world] of Object.entries(worlds)) test(`${name}: pools light the land and the bridge decks, never the air over the water`, () => {
  const inWater = (x, z) => { const r = Math.hypot(x, z); return world.water.annuli.some(a => r > a.inner && r < a.outer) && !world.land.islets.some(i => Math.hypot(x - i.x, z - i.z) < i.r); };
  const onDeck = (x, z) => world.roads.bridges.some(b => city.segmentDistance(x, z, b.road) <= city.BRIDGE_HALF);
  let spilling = 0, bridged = 0;
  for (const lamp of world.placements.filter(p => p.kind === 'lamp')) {
    const ground = city.poolGround(world, lamp.x, lamp.z);
    let samples = 0, bright = 0, wet = false;
    for (let dx = -city.POOL_RADIUS; dx <= city.POOL_RADIUS; dx += .1) for (let dz = -city.POOL_RADIUS; dz <= city.POOL_RADIUS; dz += .1) {
      if (Math.hypot(dx, dz) > city.POOL_RADIUS) continue;
      const x = lamp.x + dx, z = lamp.z + dz, light = lit(ground, dx, dz, x, z), water = inWater(x, z) && !onDeck(x, z);
      samples++; if (light > .5) bright++; wet ||= water;
      if (water) assert.ok(light < 1e-6, `lamp ${lamp.x.toFixed(1)},${lamp.z.toFixed(1)} lights water at ${dx.toFixed(1)},${dz.toFixed(1)}`);
    }
    // At least the ground the lamp stands on, or the deck beside it, stays lit.
    assert.ok(bright / samples > .3, `lamp ${lamp.x.toFixed(1)},${lamp.z.toFixed(1)}: ${bright}/${samples} lit`);
    if (wet) spilling++;
    if (ground[3] < 100) bridged++;
  }
  // The quay and lagoon lamps would spill without the cut, and the canal bridge lamps light their decks.
  assert.ok(spilling > 20 && bridged >= 20, `${spilling} at the water, ${bridged} at bridges`);
});

test('nothing is drawn in the day; the lights show while the night level is above 0', () => {
  const ctx = context(worlds.v1), { pools, halos, dispose } = city.createLampLights(ctx);
  assert.ok(!pools.visible && !halos.visible);
  ctx.frame(.016); assert.ok(!pools.visible && !halos.visible);
  ctx.night.set(true); ctx.frame(.1);
  assert.ok(ctx.night.level.value > 0 && ctx.night.level.value < 1 && pools.visible && halos.visible);
  ctx.night.set(false); ctx.frame(.05); assert.ok(pools.visible);
  ctx.frame(1); assert.equal(ctx.night.level.value, 0); assert.ok(!pools.visible && !halos.visible);
  const shaders = [pools.material.opacityNode, halos.material.opacityNode, halos.material.positionNode];
  ctx.night.set(true, true); ctx.frame(.016);
  assert.ok(pools.visible && halos.visible);
  // Switching costs no rebuilt material, and both glows follow this city's level.
  assert.deepEqual([pools.material.opacityNode, halos.material.opacityNode, halos.material.positionNode], shaders);
  assert.ok(uses(pools.material.opacityNode, ctx.night.level) && uses(halos.material.opacityNode, ctx.night.level));
  let freed = 0;
  for (const item of [pools.geometry, halos.geometry, pools.material, halos.material]) item.addEventListener('dispose', () => freed++);
  dispose();
  assert.equal(ctx.scene.children.length, 0); assert.equal(ctx.listeners, 0); assert.equal(freed, 4);
});

test('a city that starts at night shows the lights on its first frame', () => {
  const ctx = context(worlds.v1, true), { pools, halos, dispose } = city.createLampLights(ctx);
  assert.ok(pools.visible && halos.visible);
  dispose();
});

test('the catalogue lamp has a shade, plain glass in the day, and its bulb glows with the city night level', () => {
  const night = city.createNight(), catalogue = city.createCatalogue(new Map(), night);
  const matrix = new THREE.Matrix4(), lamp = catalogue.resolve({ kind: 'lamp', variant: 0, x: 3, z: 4, rotation: 0, scale: 1, width: 0 }, matrix);
  assert.equal(lamp.id, 'lamp');
  const bulbs = lamp.lods.filter(Boolean).flatMap(level => level.parts.filter(part => part.material.name === 'lamp-bulb'));
  assert.equal(bulbs.length, 2);
  for (const level of lamp.lods.filter(Boolean)) {
    // Two parts (two draw calls per level): the pole with its shade, and the bulb; tiny, as lamps come by the hundred.
    assert.equal(level.parts.length, 2);
    const triangles = level.parts.reduce((sum, part) => sum + (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3, 0);
    assert.ok(triangles <= 140, `${triangles} triangles`);
    const pole = new THREE.Box3().setFromBufferAttribute(level.parts.find(part => part.material.name !== 'lamp-bulb').geometry.getAttribute('position'));
    assert.ok(pole.max.x > .15, 'a shade wider than the pole');
  }
  // The halos sit on the bulb the catalogue places.
  for (const { geometry } of bulbs) {
    geometry.computeBoundingBox();
    const centre = geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(matrix);
    assert.ok(Math.abs(centre.y - city.BULB_Y) < 1e-6 && Math.abs(centre.x - 3) < 1e-6 && Math.abs(centre.z - 4) < 1e-6);
  }
  const material = bulbs[0].material;
  assert.ok(bulbs.every(part => part.material === material), 'one bulb material for every level');
  // Plain glass by colour; the glow is the night level's alone (0 in the day), not a fixed emissive.
  assert.equal(material.emissive.getHex(), 0);
  assert.ok(uses(material.emissiveNode, night.level));
  catalogue.dispose();
});
