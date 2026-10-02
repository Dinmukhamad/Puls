import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  stdin: { contents: 'export * from "./districtLandmark.ts"; export * from "../assets/districtLandmark.ts"; export * as THREE from "three/webgpu";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
});
const L = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const frame = { x: 31, z: -25, rotation: 0, width: 18, depth: 18 };
const worldPoint = (frame, x, y, z) => ({ x: frame.x + Math.cos(frame.rotation) * x + Math.sin(frame.rotation) * z, y, z: frame.z - Math.sin(frame.rotation) * x + Math.cos(frame.rotation) * z });
const worldDirection = (frame, x, y, z) => ({ x: Math.cos(frame.rotation) * x + Math.sin(frame.rotation) * z, y, z: -Math.sin(frame.rotation) * x + Math.cos(frame.rotation) * z });

test('the five centre levels grow in footprint and height while every architectural piece stays on the reserved square', () => {
  const bounds = Array.from({ length: 5 }, (_, i) => L.landmarkBounds(frame, i + 1));
  assert.ok(bounds[0].width < 8 && bounds[0].height < 3, 'the first building is a small pavilion');
  assert.ok(bounds[4].width > 16 && bounds[4].height > 17, 'the last is a broad flagship with a tall tower');
  for (let level = 1; level <= 5; level++) {
    const boxes = L.landmarkBoxes(level);
    for (const box of boxes) {
      assert.ok(box.width > 0 && box.depth > 0 && box.height > 0);
      assert.ok(Math.abs(box.x) + box.width / 2 < 9, `level ${level}: no part crosses the width`);
      assert.ok(Math.abs(box.z) + box.depth / 2 < 9, `level ${level}: no part crosses the depth`);
    }
    if (level > 1) {
      assert.ok(bounds[level - 1].width > bounds[level - 2].width);
      assert.ok(bounds[level - 1].depth > bounds[level - 2].depth);
      assert.ok(bounds[level - 1].height > bounds[level - 2].height);
    }
    assert.equal(boxes.filter(b => b.finish === 'accent' && b.height === .17).length, 1, 'one continuous entrance canopy');
  }
});

test('layout uses one fixed-footprint pooled model on the cells, and clamps invalid levels', () => {
  const module = { x: 13, z: -8, rotation: .63 };
  for (const level of [1, 2, 3, 4, 5]) {
    const layout = L.landmarkLayout(module, { level });
    assert.equal(layout.placements.length, 1); assert.equal(layout.surfaces.length, 0);
    const placement = layout.placements[0];
    assert.deepEqual({ kind: placement.kind, variant: placement.variant, width: placement.width, depth: placement.depth, x: placement.x, z: placement.z, rotation: placement.rotation },
      { kind: 'district-landmark', variant: level - 1, width: 18, depth: 18, x: module.x, z: module.z, rotation: module.rotation });
  }
  assert.equal(L.landmarkLayout(module, { level: NaN }).placements[0].variant, 0);
  assert.equal(L.landmarkLayout(module, { level: 99 }).placements[0].variant, 4);
  const small = L.landmarkLayout(module, { level: 2, u: 3, v: 5, w: 4, h: 2, rotation: 1 }).placements[0];
  assert.equal(small.width, 6); assert.equal(small.depth, 3);
  assert.equal(small.rotation, module.rotation + Math.PI / 2);
});

test('picking uses actual solids: pavilion facade hits, empty reserved corners and sky above low podiums miss', () => {
  assert.ok(L.landmarkRayDistance(frame, 1, worldPoint(frame, 0, 1.6, 20), { x: 0, y: 0, z: -1 }) > 0);
  assert.equal(L.landmarkRayDistance(frame, 1, worldPoint(frame, 8, 1.6, 20), { x: 0, y: 0, z: -1 }), null);
  assert.equal(L.landmarkRayDistance(frame, 1, worldPoint(frame, 0, 7, 20), { x: 0, y: 0, z: -1 }), null);
  assert.equal(L.landmarkRayDistance(frame, 5, worldPoint(frame, 6.7, 12, 20), { x: 0, y: 0, z: -1 }), null, 'space above a low side of the podium stays clickable behind it');
  assert.ok(L.landmarkRayDistance(frame, 5, worldPoint(frame, 0, 15, 20), { x: 0, y: 0, z: -1 }) > 0, 'upper tower facade can be clicked without touching the ground');
  assert.equal(L.landmarkRayDistance(frame, 5, worldPoint(frame, 0, 15, 20), { x: 0, y: 0, z: 1 }), null, 'buildings behind the ray are ignored');
});

test('actual bounds and picking rotate and scale with the supplied footprint', () => {
  const expected = L.landmarkRayDistance(frame, 4, worldPoint(frame, .8, 7, 20), { x: 0, y: 0, z: -1 });
  for (const rotation of [.5, Math.PI / 2, Math.PI, -.83]) {
    const turned = { ...frame, rotation };
    const distance = L.landmarkRayDistance(turned, 4, worldPoint(turned, .8, 7, 20), worldDirection(turned, 0, 0, -1));
    assert.ok(Math.abs(distance - expected) < 1e-8);
  }
  const scaled = { ...frame, width: 9, depth: 12 };
  const a = L.landmarkBounds(frame, 5), b = L.landmarkBounds(scaled, 5);
  assert.ok(Math.abs(b.width - a.width / 2) < 1e-8);
  assert.ok(Math.abs(b.depth - a.depth * 2 / 3) < 1e-8);
  assert.ok(Math.abs(b.height - a.height / 2) < 1e-8);
  assert.ok(Math.abs(L.landmarkHeight(5, 9, 12) - L.landmarkHeight(5) / 2) < 1e-8);
});

test('all model details retain the full silhouette and their geometry bounds exactly match picking', () => {
  for (let level = 1; level <= 5; level++) {
    const box = L.landmarkBounds({ ...frame, x: 0, z: 0 }, level), details = [];
    for (const detail of [2, 1, 0]) {
      const geometry = L.landmarkGeometry(level, detail), bounds = new L.THREE.Box3();
      for (const g of Object.values(geometry)) { g.computeBoundingBox(); bounds.union(g.boundingBox); }
      assert.ok(Math.abs(bounds.min.y + .2 - box.bottom) < 1e-5);
      assert.ok(Math.abs(bounds.max.y - bounds.min.y - box.height) < 1e-5);
      assert.ok(Math.abs(bounds.max.x - bounds.min.x - box.width) < 1e-5);
      assert.ok(Math.abs(bounds.max.z - bounds.min.z - box.depth) < 1e-5);
      assert.ok(geometry.shell.hasAttribute('color'), 'opaque surfaces preserve their architectural finishes');
      assert.ok(geometry.glass.hasAttribute('sectionPart'), 'night window shader knows which faces are glass');
      details.push(geometry.shell.getAttribute('position').count + geometry.glass.getAttribute('position').count);
      geometry.shell.dispose(); geometry.glass.dispose();
    }
    assert.ok(details[0] > details[1] && details[1] > details[2], 'mullions, floor bands and columns leave the simpler details');
    assert.ok(details[0] < 12000, 'even the last centre remains suitable for mobile');
  }
});
