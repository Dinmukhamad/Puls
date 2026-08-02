import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { MINIFIED_ARTIFACTS, renderMinifiedArtifact } from '../../scripts/minify-frontend.mjs';
import { STAMPED_ASSETS, stampHtml } from '../../scripts/stamp-assets.mjs';

const index = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

// Шаг CI «Verify committed bundles» сверяет только js/app.js, js/api.js и
// css/styles.css. Минифицированные артефакты и версии в index.html туда не
// входят, поэтому их синхронность стережём здесь — npm test запускается тем
// же пайплайном.

test('committed .min artifacts match their source bundles', async () => {
  for (const artifact of MINIFIED_ARTIFACTS) {
    const expected = await renderMinifiedArtifact(artifact);
    const committed = await readFile(new URL(`../../${artifact.output}`, import.meta.url), 'utf8');
    assert.equal(
      committed.replace(/\r\n?/g, '\n'),
      expected.replace(/\r\n?/g, '\n'),
      `${artifact.output} устарел — запустите npm run build`,
    );
  }
});

test('index.html asset versions match the bundles they point at', () => {
  assert.equal(
    stampHtml(index),
    index,
    'index.html отстал от бандлов — запустите npm run build',
  );
});

test('the browser is served minified bundles, not the readable ones', () => {
  for (const asset of STAMPED_ASSETS) {
    assert.match(
      index,
      new RegExp(`(href|src)="${asset.serve.replace(/[.]/g, '\\.')}\\?v=[0-9a-f]{12}"`),
      `${asset.serve} должен подключаться с версией по хешу содержимого`,
    );
  }
  // Читаемые бандлы остаются в репозитории для отладки, но не грузятся.
  assert.doesNotMatch(index, /src="js\/app\.js\?/);
  assert.doesNotMatch(index, /href="css\/styles\.css\?/);
});

test('every version is a content hash, not a hand-written label', () => {
  // Раньше версии правились руками (?v=smz-document-signing-v1) — забыть
  // бампнуть было легко, поэтому сервер отдавал бандлы с no-cache и
  // версионирование не работало вовсе.
  const versions = [...index.matchAll(/(?:href|src)="[^"]+\?v=([^"]+)"/g)].map(m => m[1]);
  assert.ok(versions.length >= STAMPED_ASSETS.length);
  for (const version of versions) {
    assert.match(version, /^[0-9a-f]{12}$/, `версия «${version}» не похожа на хеш содержимого`);
  }
});
