import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The borders, the land and the cities in one bundle, so they share one copy of three.
const built = await build({
  stdin: { contents: 'export * from "./borders.ts"; export * from "../world/land.ts"; export * from "../world/cities.ts"; export { generateSalesWorld } from "../world/sales.ts"; export { segmentDistance } from "../world/generate.ts"; export { WORLD_X4 } from "../world/worldSpec.ts"; export { districtColour } from "../world/estateGrid.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
});
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { THREE } = city;
const WORLDS = { support: city.islandWorld(city.WORLD_X4), sales: city.generateSalesWorld() };
const hex = (attribute, i) => `#${new THREE.Color(attribute.getX(i), attribute.getY(i), attribute.getZ(i)).getHexString()}`;
/** On a plot's ground: on a plot for sale and farther in than the .24 its ground keeps from the plot's edges (systems/estates.ts INSET). */
const onGround = (grid, p) => {
  const at = city.plotAt(grid, p);
  if (!at) return false;
  const c = city.areaFrame(at.block, at.col, at.row).corners;
  return c.every((q, i) => city.segmentDistance(p.x, p.z, [q.x, q.z, c[(i + 1) % 4].x, c[(i + 1) % 4].z]) > .24);
};

for (const [name, world] of Object.entries(WORLDS)) test(`${name}: each side of a border in its district's colour, flat between the plots, posts along both edges`, () => {
  const grid = city.landGrid(world), borders = city.districtBorders(grid, world), drawn = city.createBorders(borders, city.districtColour);
  const geometry = drawn.band.geometry, position = geometry.getAttribute('position'), colour = geometry.getAttribute('color'), index = geometry.getIndex();
  assert.equal(position.count, borders.length * 8, 'two quads a border');
  assert.equal(index.count, borders.length * 12);
  // Every triangle faces up, at one height: over the ring roads' markings and the kerbs, under the streets (render/terrain.ts).
  const v = i => new THREE.Vector3().fromBufferAttribute(position, i);
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => v(index.getX(i + k)));
    assert.ok(new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).y > 0, 'a triangle facing down');
  }
  const heights = new Set(Array.from({ length: position.count }, (_, i) => position.getY(i)));
  assert.equal(heights.size, 1);
  assert.ok([...heights][0] > .225 && [...heights][0] < .26, `the band at ${[...heights][0]}`);
  borders.forEach((border, k) => {
    for (let j = 0; j < 8; j++) {
      const i = k * 8 + j, district = j < 4 ? border.toward : border.away, p = v(i);
      const across = (p.x - border.a.x) * border.normal.x + (p.z - border.a.z) * border.normal.z;
      assert.ok(j < 4 ? across > -1e-6 : across < 1e-6, 'a colour on the other district\'s side');
      assert.equal(hex(colour, i), city.districtColour(district));
    }
    // Across each quad, never on a plot's ground.
    for (const q of [0, 4]) for (let s = 0; s <= 4; s++) for (let t = 0; t <= 4; t++) {
      const [a, b, c, d] = [0, 1, 2, 3].map(j => v(k * 8 + q + j)), u = s / 4, w = t / 4;
      const p = a.multiplyScalar((1 - u) * (1 - w)).add(b.multiplyScalar(u * (1 - w))).add(c.multiplyScalar(u * w)).add(d.multiplyScalar((1 - u) * w));
      assert.ok(!onGround(grid, p), `${name}: the border's colour on a plot at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
    }
  });
  // Posts in pairs, one on each side in that side's colour, off the plots, standing on the ground.
  const posts = drawn.posts, matrix = new THREE.Matrix4(), at = new THREE.Vector3(), tint = new THREE.Color();
  assert.ok(posts.count >= borders.length * 4 && posts.count % 2 === 0, `${posts.count} posts`);
  assert.ok(posts.castShadow && posts.instanceColor);
  for (let i = 0; i < posts.count; i++) {
    posts.getMatrixAt(i, matrix); at.setFromMatrixPosition(matrix); posts.getColorAt(i, tint);
    const border = borders.find(b => {
      const dx = b.b.x - b.a.x, dz = b.b.z - b.a.z, l = Math.hypot(dx, dz), along = ((at.x - b.a.x) * dx + (at.z - b.a.z) * dz) / l;
      return along >= 0 && along <= l && Math.abs((at.x - b.a.x) * b.normal.x + (at.z - b.a.z) * b.normal.z) < Math.max(...b.gaps) / 2;
    });
    assert.ok(border, `${name}: a post off the borders at ${at.x.toFixed(1)}, ${at.z.toFixed(1)}`);
    const side = (at.x - border.a.x) * border.normal.x + (at.z - border.a.z) * border.normal.z > 0 ? border.toward : border.away;
    assert.equal(`#${tint.getHexString()}`, city.districtColour(side));
    assert.equal(city.plotAt(grid, at), null, `${name}: a post on a plot at ${at.x.toFixed(1)}, ${at.z.toFixed(1)}`);
    assert.equal(at.y, 0);
  }
  posts.geometry.computeBoundingBox();
  assert.ok(Math.abs(posts.geometry.boundingBox.min.y - .2) < 1e-6, 'the posts stand on the ground');
});

test('the borders free their geometry and materials', () => {
  const world = WORLDS.sales, grid = city.landGrid(world), drawn = city.createBorders(city.districtBorders(grid, world), city.districtColour);
  const freed = [];
  for (const item of [drawn.band.geometry, drawn.band.material, drawn.posts.geometry, drawn.posts.material]) item.addEventListener('dispose', () => freed.push(item));
  drawn.dispose();
  assert.equal(freed.length, 4);
});
