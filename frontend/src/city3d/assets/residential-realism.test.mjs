import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ stdin: { contents: `export * from './residential.ts'; export * from './districtLandmark.ts'; export { FACE } from './facade.ts'; export { SECTION_FLOORS, OFFICE_FLOORS } from '../world/complexes.ts'; export { landmarkBounds } from '../world/districtLandmark.ts';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
const R = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-5, `${label}: ${actual} instead of ${expected}`);
const unitCases = [
  ...R.SECTION_FLOORS.map(n => [`section-${n}`, () => R.sectionGeometry(n), 160 + 44 * n, [-.5, 0, -5.9 / 9.6], [.5, 1 + 2.4 / (n * 3), 5.9 / 9.6]]),
  ...R.OFFICE_FLOORS.map(n => [`office-${n}`, () => R.officeGeometry(n), n > 4 ? 374 : 354, [-18.45 / 36, 0, -18 / 28], [18.45 / 36, 1 + 1 / n, 18 / 28]]),
  ['arch', R.archGeometry, 152, [-.5, 0, -.5], [.5, 1.075, .5]],
  ['cottage', R.cottageGeometry, 30, [-.5, 0, -.5], [.5, 1, .5]],
  ['garage', R.garageGeometry, 90, [-.5, 0, -.5], [.5, 1, .5 + .12 / 9.6]],
  ['roof', R.roofGeometry, 144, [-.5031641126, -.0220579654, -.5074074268], [.5031641126, 1.02, .5074074268]],
  ...[4, 7, 11, 18].map((n, i) => [`block-${n}`, () => R.blockGeometry(n, i >= 2), 180, [-.5, 0, -.5], [.5, 1 + 2.2 / (n * 3), .5]]),
];

test('architectural details retain every stretched model envelope and stay within 1.7 times its old triangle budget', () => {
  for (const [name, build, oldTriangles, min, max] of unitCases) {
    const geometry = build();
    geometry.boundingBox.min.toArray().forEach((v, i) => near(v, min[i], `${name} min axis ${i}`));
    geometry.boundingBox.max.toArray().forEach((v, i) => near(v, max[i], `${name} max axis ${i}`));
    assert.ok(geometry.index.count / 3 <= oldTriangles * 1.7, `${name} remains suitable for repeated district copies`);
    for (const name of ['position', 'normal', 'color', 'aSurf', 'aWin', 'aUnitU', 'aUnitV']) {
      const attribute = geometry.getAttribute(name);
      assert.equal(attribute.count, geometry.getAttribute('position').count);
      for (let i = 0; i < attribute.count; i++) for (let k = 0; k < attribute.itemSize; k++) assert.ok(Number.isFinite(attribute.getComponent(i, k)));
    }
    geometry.dispose();
  }
});

test('balcony handrails and office entrance glazing are real geometry at usable heights', () => {
  const section = R.sectionGeometry(3), office = R.officeGeometry(3);
  const has = (g, check) => { const p = g.getAttribute('position'), s = g.getAttribute('aSurf'); for (let i = 0; i < p.count; i++) if (check(p, s, i)) return true; return false; };
  assert.ok(has(section, (p, s, i) => s.getZ(i) === R.FACE.metal && p.getY(i) > .3 && p.getY(i) < 1), 'railing caps and end posts are below the roof');
  assert.ok(has(office, (p, s, i) => s.getZ(i) === R.FACE.curtain && Math.abs(p.getZ(i)) > .54 && p.getY(i) < .32), 'recessed lobby glazing sits below the existing canopy');
  section.dispose(); office.dispose();
});

test('community centre details preserve all five picking envelopes and phone-friendly mesh sizes', () => {
  const oldTriangles = [988, 1844, 1928, 2400, 2310];
  for (let level = 1; level <= 5; level++) {
    const geometry = R.landmarkGeometry(level), bounds = R.landmarkBounds({ x: 0, z: 0, rotation: 0, width: 18, depth: 18 }, level);
    near(geometry.boundingBox.min.y + .2, bounds.bottom, `level ${level} ground`);
    near(geometry.boundingBox.max.y - geometry.boundingBox.min.y, bounds.height, `level ${level} height`);
    near(geometry.boundingBox.max.x - geometry.boundingBox.min.x, bounds.width, `level ${level} width`);
    near(geometry.boundingBox.max.z - geometry.boundingBox.min.z, bounds.depth, `level ${level} depth`);
    assert.ok(geometry.index.count / 3 < oldTriangles[level - 1] * 1.7);
    geometry.dispose();
  }
});
