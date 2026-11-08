import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ entryPoints: [fileURLToPath(new URL('./people.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const people = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const triangles = geometry => (geometry.index?.count ?? geometry.attributes.position.count) / 3;
const section = (geometry, y, bone, slot) => {
  const p = geometry.getAttribute('position'), parts = geometry.getAttribute('aPart'), points = [];
  for (let i = 0; i < p.count; i += 3) {
    if (parts.getX(i) !== bone || (slot !== undefined && parts.getY(i) !== slot)) continue;
    for (let edge = 0; edge < 3; edge++) {
      const a = i + edge, b = i + (edge + 1) % 3, ay = p.getY(a), by = p.getY(b);
      if (y < Math.min(ay, by) || y > Math.max(ay, by) || Math.abs(ay - by) < 1e-8) continue;
      const t = (y - ay) / (by - ay);
      points.push([p.getX(a) + t * (p.getX(b) - p.getX(a)), p.getZ(a) + t * (p.getZ(b) - p.getZ(a))]);
    }
  }
  assert.ok(points.length >= 3, `joint section has a surface at y=${y}, bone=${bone}`);
  return { min: [0, 1].map(axis => Math.min(...points.map(p => p[axis]))), max: [0, 1].map(axis => Math.max(...points.map(p => p[axis]))) };
};
const overlap = (a, b, axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]);
const signature = geometry => {
  const hash = createHash('sha256');
  for (const name of ['position', 'aPart']) {
    const attr = geometry.getAttribute(name), values = [];
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) values.push(attr.getComponent(i, k));
    hash.update(JSON.stringify(values));
  }
  if (geometry.index) hash.update(JSON.stringify(Array.from(geometry.index.array)));
  return hash.digest('hex');
};

test('six named city residents have distinct authored bodies, not only different paint', () => {
  assert.equal(people.PEOPLE.length, 6);
  for (const field of ['id', 'name', 'outfit']) assert.equal(new Set(people.PEOPLE.map(person => person[field])).size, 6, `unique ${field}`);
  const near = new Set(), far = new Set();
  for (const [variant, person] of people.PEOPLE.entries()) {
    for (const name of ['shirt', 'skin', 'trousers', 'hair', 'shoes', 'accent']) assert.match(person.palette[name], /^#[\da-f]{6}$/i, `${person.id}: ${name}`);
    const close = people.personGeometry(variant, 'near'), distant = people.personGeometry(variant, 'far');
    near.add(signature(close)); far.add(signature(distant)); close.dispose(); distant.dispose();
  }
  assert.equal(near.size, 6, 'all close models differ geometrically');
  assert.equal(far.size, 6, 'their lightweight silhouettes stay distinguishable');
});

test('every person keeps finite animation attributes, valid normals and a bounded single-material budget', () => {
  for (let variant = 0; variant < 6; variant++) for (const detail of ['near', 'far']) {
    const geometry = people.personGeometry(variant, detail), p = geometry.getAttribute('position'), parts = geometry.getAttribute('aPart'), normals = geometry.getAttribute('normal');
    const id = `${people.PEOPLE[variant].id}/${detail}`, buffers = new Set();
    for (const [name, size] of [['position', 3], ['normal', 3], ['aPart', 2], ['aShade', 1]]) {
      const attribute = geometry.getAttribute(name);
      assert.ok(attribute && attribute.itemSize === size && attribute.count === p.count, `${id}: matching ${name}`);
      buffers.add(attribute.isInterleavedBufferAttribute ? attribute.data : attribute);
      for (let i = 0; i < attribute.count; i++) for (let k = 0; k < attribute.itemSize; k++) assert.ok(Number.isFinite(attribute.getComponent(i, k)), `${id}: finite ${name}`);
    }
    assert.ok(buffers.size + 2 <= 8, `${id}: geometry plus copy matrix/tint buffers fit WebGPU`);
    assert.equal(geometry.groups.length, 0, `${id}: no extra material splits`);
    const bones = new Set(), slots = new Set();
    for (let i = 0; i < p.count; i++) {
      const bone = parts.getX(i), slot = parts.getY(i), shade = geometry.getAttribute('aShade').getX(i);
      assert.ok(Number.isInteger(bone) && bone >= 0 && bone <= 10, `${id}: supported walking joint`);
      assert.ok(Number.isInteger(slot) && slot >= 0 && slot <= 8, `${id}: supported clothing slot`);
      assert.ok(shade >= .3 && shade <= 1.01, `${id}: bounded contact shading`);
      assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < .02, `${id}: normalized normals`);
      bones.add(bone); slots.add(slot);
    }
    assert.deepEqual([...bones].sort((a, b) => a - b), Array.from({ length: 11 }, (_, i) => i), `${id}: whole animated rig`);
    for (const slot of [0, 1, 2, 3, 4]) assert.ok(slots.has(slot), `${id}: clothing, skin, hair and footwear remain represented`);
    const count = triangles(geometry);
    assert.ok(count > 50 && count <= (detail === 'near' ? 1400 : 220), `${id}: ${count} triangles`);
    if (geometry.index) for (const index of geometry.index.array) assert.ok(Number.isInteger(index) && index >= 0 && index < p.count, `${id}: valid index`);
    geometry.dispose();
  }
});

test('walking limbs cover their rig pivots, overlap at joints and keep grounded feet', () => {
  for (let variant = 0; variant < 6; variant++) for (const detail of ['near', 'far']) {
    const geometry = people.personGeometry(variant, detail), p = geometry.getAttribute('position'), part = geometry.getAttribute('aPart');
    const range = bone => {
      let low = Infinity, high = -Infinity;
      for (let i = 0; i < p.count; i++) if (part.getX(i) === bone) { low = Math.min(low, p.getY(i)); high = Math.max(high, p.getY(i)); }
      return [low, high];
    };
    for (const [bone, low, high] of [[1, .41, .71], [4, .41, .71], [2, .09, .41], [5, .09, .41], [7, .921, 1.166], [9, .921, 1.166]]) {
      const actual = range(bone);
      assert.ok(actual[0] < low - .025 && actual[1] > high + .025, `${people.PEOPLE[variant].id}: joint ${bone} has overlap beyond its pivots`);
      assert.ok(Math.abs((actual[0] + actual[1] - low - high) / 2) < .005, `${people.PEOPLE[variant].id}: joint ${bone} retains the existing animation centre`);
      assert.ok(low - actual[0] < .08 && actual[1] - high < .08, `${people.PEOPLE[variant].id}: joint ${bone} stays anatomically bounded`);
    }
    for (const [a, b, y] of [[1, 2, .41], [4, 5, .41], [7, 8, .921], [9, 10, .921]]) {
      const first = section(geometry, y, a), second = section(geometry, y, b);
      assert.ok(overlap(first, second, 0) > .04 && overlap(first, second, 1) > .03, `${people.PEOPLE[variant].id}/${detail}: rounded joint ${a}/${b} has visible volume instead of two touching tips`);
    }
    const chest = section(geometry, 1.166, 0, 0);
    for (const arm of [7, 9]) {
      const shoulder = section(geometry, 1.166, arm);
      assert.ok(overlap(chest, shoulder, 0) > .008 && overlap(chest, shoulder, 1) > .04, `${people.PEOPLE[variant].id}/${detail}: sleeve overlaps the shoulder`);
    }
    const torso = section(geometry, .841, 0, 0);
    if ([0, 2, 3, 5].includes(variant)) {
      const hips = section(geometry, .841, 0, 2);
      assert.ok(overlap(torso, hips, 0) > .08 && overlap(torso, hips, 1) > .02, `${people.PEOPLE[variant].id}/${detail}: garment hem covers the waistband`);
    }
    const feet = [range(3), range(6)];
    assert.ok(feet.every(([low]) => low >= -.006 && low < .02), `${people.PEOPLE[variant].id}: grounded soles`);
    for (const [shin, foot] of [[2, 3], [5, 6]]) assert.ok(range(foot)[1] >= .086 && range(foot)[1] - range(shin)[0] > .025, `${people.PEOPLE[variant].id}/${detail}: shoe encloses the ankle joint`);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    assert.ok(box.min.y >= -.006 && box.max.y >= 1.45 && box.max.y <= 1.8, 'adult height and ground reference');
    assert.ok(box.max.x - box.min.x <= .85 && box.max.z - box.min.z <= .7, 'body/accessories fit the city walking clearance');
    geometry.dispose();
  }
});

test('distant models retain the person envelope while substantially reducing geometry', () => {
  for (let variant = 0; variant < 6; variant++) {
    const near = people.personGeometry(variant, 'near'), far = people.personGeometry(variant, 'far');
    near.computeBoundingBox(); far.computeBoundingBox();
    assert.ok(triangles(far) < triangles(near) * .5, `${people.PEOPLE[variant].id}: useful far reduction`);
    for (const edge of ['min', 'max']) for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(near.boundingBox[edge][axis] - far.boundingBox[edge][axis]) < .12, `${people.PEOPLE[variant].id}: ${edge}.${axis} silhouette continuity`);
    near.dispose(); far.dispose();
  }
});

test('authored faces have nonzero area and outward winding consistent with their shading normals', () => {
  for (let variant = 0; variant < 6; variant++) for (const detail of ['near', 'far']) {
    const geometry = people.personGeometry(variant, detail), p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
    const id = `${people.PEOPLE[variant].id}/${detail}`;
    for (let i = 0; i < p.count; i += 3) {
      const ax = p.getX(i + 1) - p.getX(i), ay = p.getY(i + 1) - p.getY(i), az = p.getZ(i + 1) - p.getZ(i);
      const bx = p.getX(i + 2) - p.getX(i), by = p.getY(i + 2) - p.getY(i), bz = p.getZ(i + 2) - p.getZ(i);
      const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
      assert.ok(Math.hypot(x, y, z) > 1e-12, `${id}: no collapsed triangle`);
      const nx = n.getX(i) + n.getX(i + 1) + n.getX(i + 2), ny = n.getY(i) + n.getY(i + 1) + n.getY(i + 2), nz = n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2);
      assert.ok(x * nx + y * ny + z * nz >= -1e-9, `${id}: face ${i / 3} winding agrees with its normals`);
    }
    geometry.dispose();
  }
});

test('fringes leave the eyes visible and the baseball cap retains a horizontal visor at distance', () => {
  for (let variant = 0; variant < 6; variant++) {
    const geometry = people.personGeometry(variant), p = geometry.getAttribute('position'), part = geometry.getAttribute('aPart');
    let eyeTop = -Infinity, frontHair = Infinity;
    for (let i = 0; i < p.count; i++) {
      if (part.getY(i) === 8 && p.getY(i) > 1.4) eyeTop = Math.max(eyeTop, p.getY(i));
      if (part.getY(i) === 3 && Math.abs(p.getX(i)) < .05 && p.getZ(i) > .07) frontHair = Math.min(frontHair, p.getY(i));
    }
    assert.ok(Number.isFinite(eyeTop) && frontHair > eyeTop + .002, `${people.PEOPLE[variant].id}: fringe does not form a helmet over the eyes`);
    geometry.dispose();
  }
  for (const detail of ['near', 'far']) {
    const geometry = people.personGeometry(5, detail), p = geometry.getAttribute('position'), part = geometry.getAttribute('aPart');
    let headTop = -Infinity, capTop = -Infinity, visorLow = Infinity, visorHigh = -Infinity;
    for (let i = 0; i < p.count; i++) {
      if (part.getY(i) === 1) headTop = Math.max(headTop, p.getY(i));
      if (part.getY(i) === 6 && p.getY(i) > 1.44) capTop = Math.max(capTop, p.getY(i));
      if (part.getY(i) === 6 && p.getZ(i) > .13) { visorLow = Math.min(visorLow, p.getY(i)); visorHigh = Math.max(visorHigh, p.getY(i)); }
    }
    assert.ok(capTop > headTop + .01, `${detail}: scalp does not poke through the cap crown`);
    assert.ok(Number.isFinite(visorLow) && visorHigh - visorLow < .015, `${detail}: visor is a thin horizontal volume`);
    geometry.dispose();
  }
});
