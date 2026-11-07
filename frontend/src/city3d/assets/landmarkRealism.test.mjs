import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: `export * from './landmarks.ts'; export * from './port.ts'; export * as THREE from 'three/webgpu';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
const city = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const noop = () => {};
const context = new Proxy({}, { get: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };

// The previous v4 models' measured budgets. Detail can grow within these envelopes without moving labels,
// changing a plot's fit or making the overview substantially more expensive.
const previous = {
  academy: [2166, 3782, 3098, 3628, 3924], driver: [2196, 2848, 2608, 2632, 5706],
  crm: [2006, 2596, 2584, 3998, 3464], dispatch: [3764, 4830, 2866, 3954, 3220],
  oktell: [1888, 3488, 2880, 4748, 4192], scenarios: [2048, 2366, 2654, 2402, 3832],
  voice: [2494, 4096, 2322, 4542, 4232],
};
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < .002, `${label}: ${actual} instead of ${expected}`);
function healthy(geometry) {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  for (const name of ['position', 'normal', 'color', 'aSurf', 'aWin']) {
    const attribute = geometry.getAttribute(name);
    assert.equal(attribute.count, positions.count, name);
    assert.ok(Array.from(attribute.array).every(Number.isFinite), `${name} remains finite`);
  }
  for (let i = 0; i < normals.count; i++) assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < .01, 'unit normal');
  assert.ok(Array.from(geometry.index.array).every(index => index < positions.count));
}

test('all 35 island landmarks gain close detail while keeping their measured heights, footprints and batch count', () => {
  const material = new city.THREE.MeshBasicMaterial(), architecture = city.createArchitecture(material);
  for (const [id, counts] of Object.entries(previous)) for (let level = 1; level <= 5; level++) {
    const { group, height } = architecture.landmark(id, level, false), meshes = group.children.filter(o => o.isMesh && o.material === material);
    assert.equal(meshes.length, 1, `${id}/${level}: one shared facade mesh`);
    const geometry = meshes[0].geometry, bounds = geometry.boundingBox, triangles = geometry.index.count / 3;
    assert.ok(triangles > counts[level - 1] && triangles <= counts[level - 1] * 1.35, `${id}/${level}: ${triangles} triangles`);
    near(bounds.min.x, -2.85, 'min x'); near(bounds.min.y, -.095, 'base');
    near(bounds.min.z, id === 'academy' && level === 4 ? -2.66 : -2.65, 'min z');
    near(bounds.max.x, id === 'voice' && level === 5 ? 2.97 : 2.85, 'max x'); near(bounds.max.z, 3, 'front steps');
    // The studio's tilted roof has always ended below its conservative 2.48 label anchor.
    near(bounds.max.y, id === 'scenarios' && level === 2 ? 2.379506 : city.LANDMARK_TOPS[id][level - 1], 'roof/spire'); near(height, city.LANDMARK_TOPS[id][level - 1], 'label');
    healthy(geometry); geometry.dispose();
    for (const child of group.children) if (child.material !== material) { child.geometry.dispose(); child.material.map?.dispose(); child.material.dispose(); }
  }
  architecture.dispose(); material.dispose();
});

test('construction detail stays in the original crane, scaffold and site envelope', () => {
  const material = new city.THREE.MeshBasicMaterial(), architecture = city.createArchitecture(material), site = architecture.site();
  const { min, max } = site.geometry.boundingBox;
  [-2.85, -.095, -2.65, 3.3, 4.95, 2.65].forEach((value, i) => near([...min.toArray(), ...max.toArray()][i], value, 'site envelope'));
  assert.ok(site.geometry.index.count / 3 <= 2148 * 1.35); near(site.height, 4.95, 'site label');
  healthy(site.geometry); site.geometry.dispose(); architecture.dispose(); material.dispose();
});

test('port rooflights, crane bogies and container door hardware preserve all five original model bounds', () => {
  const bounds = [
    [-3.225, 0, -2.025, 3.225, 2.618, 2.4], [-2.2, 0, -2.8, 2.2, 5.45, 4.6],
    [-2.85, 0, -1.555, 2.85, 1.9175, 1.555], [-2.85, 0, -1.555, 2.85, 1.9175, 1.555],
    [-3.325, 0, -2.025, 3.325, 3.07, 1.225],
  ];
  city.PORT.forEach((buildModel, index) => {
    const geometry = buildModel(1), box = geometry.boundingBox;
    [...box.min.toArray(), ...box.max.toArray()].forEach((value, axis) => near(value, bounds[index][axis], `port ${index}/${axis}`));
    assert.ok(geometry.index.count / 3 < 1100, 'port part remains below 1,100 triangles');
    assert.ok(Array.from(geometry.getAttribute('aSurf').array).some((value, i) => i % 4 === 2 && value === 7), 'hardware uses metal finish');
    healthy(geometry); geometry.dispose();
  });
});
