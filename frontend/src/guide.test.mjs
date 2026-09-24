import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ entryPoints: [fileURLToPath(new URL('./guide.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'stub-auth', setup(b) { b.onResolve({ filter: /AuthContext$/ }, () => ({ path: 'auth', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const useAuth = () => ({ user: null });', loader: 'js' })); } }] });
const { guideText, guideName, DEFAULT_GUIDE } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

test('the guide keeps Pulsar until the operator names it', () => {
  assert.equal(guideName(null), DEFAULT_GUIDE);
  assert.equal(guideName({ guide_name: '  ' }), DEFAULT_GUIDE);
  assert.equal(guideName({ guide_name: 'Айгерим' }), 'Айгерим');
  assert.equal(guideText('Помощь Пульсара', DEFAULT_GUIDE), 'Помощь Пульсара');
});

test('every form of the name is replaced in hints', () => {
  assert.equal(guideText('Привет! Я Пульсар 👋', 'Арман'), 'Привет! Я Арман 👋');
  assert.equal(guideText('Помощь Пульсара · спасибо Пульсару · с Пульсаром', 'Айгерим'), 'Помощь Айгерим · спасибо Айгерим · с Айгерим');
});
