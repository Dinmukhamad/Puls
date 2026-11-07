import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ stdin: { contents: `export * from './surfaceDetail.ts'; export { disposeModels } from './loader.ts'; export * as THREE from 'three/webgpu';`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error', plugins: [{ name: 'url', setup(b) {
  b.onResolve({ filter: /\?url$/ }, a => ({ path: a.path, namespace: 'url' }));
  b.onLoad({ filter: /.*/, namespace: 'url' }, a => ({ contents: `export default ${JSON.stringify(a.path.replace(/\?url$/, ''))}`, loader: 'js' }));
} }] });
const city = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`), { THREE } = city;

test('a detailed imported material preserves maps, transparency, source colour and editable night emission', () => {
  const map = new THREE.Texture(), source = new THREE.MeshStandardMaterial({ name: 'station-glass', map, color: '#426b79', transparent: true, opacity: .8, side: THREE.DoubleSide });
  source.userData = { imported: true };
  const material = city.detailedMaterialCopy(source);
  assert.ok(material.isNodeMaterial && material.normalNode && material.roughnessNode && material.emissiveNode);
  assert.equal(material.map, map); assert.equal(material.opacity, .8); assert.equal(material.transparent, true); assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.color.getHex(), source.color.getHex()); assert.equal(material.name, source.name);
  assert.notEqual(material.userData, source.userData); assert.deepEqual(source.userData, { imported: true });
  assert.equal(material.userData.cityModelStyle, 'realistic-v1');
  material.emissive.set('#ffc77d'); assert.notEqual(material.emissive.getHex(), 0, 'station night controller can still light its glass');
  material.dispose(); source.dispose(); map.dispose();
});

test('shared imported materials are replaced once and source maps live until the model owner disposes them', () => {
  const map = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ name: 'concrete', map }), geometry = new THREE.BoxGeometry();
  let oldFreed = 0, textureFreed = 0, geometryFreed = 0;
  material.addEventListener('dispose', () => oldFreed++); map.addEventListener('dispose', () => textureFreed++); geometry.addEventListener('dispose', () => geometryFreed++);
  const models = new Map(['station', 'portal'].map(name => [name, { name, parts: [{ geometry, material, castShadow: true }], bounds: new THREE.Box3() }]));
  city.refineModelSurfaces(models, null);
  const a = models.get('station').parts[0].material;
  assert.equal(a, models.get('portal').parts[0].material); assert.notEqual(a, material);
  assert.equal(oldFreed, 1); assert.equal(textureFreed, 0); assert.equal(geometryFreed, 0);
  city.refineModelSurfaces(models, null); assert.equal(models.get('station').parts[0].material, a, 'already refined nodes are retained');
  city.disposeModels(models); assert.equal(textureFreed, 1); assert.equal(geometryFreed, 1);
});

test('props carry physical surface nodes while their own emission remains black', () => {
  for (const finish of ['stone', 'wood', 'metal', 'paint', 'glass', 'cloth', 'foliage']) {
    const material = city.surfaceMaterial({ finish, vertexColors: true, properties: true });
    assert.ok(material.normalNode && material.colorNode && material.roughnessNode && material.metalnessNode);
    assert.equal(material.emissive.getHex(), 0); assert.equal(material.userData.citySurfaceEmission, 'reflected-light'); material.dispose();
  }
});
