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

/* ── Критический путь отрисовки ──────────────────────────────── */

test('внешний шрифт не задерживает первую отрисовку', () => {
  // Обычный rel="stylesheet" на fonts.googleapis.com держал первую
  // отрисовку: запрос уходил на 9-й миллисекунде и отвечал 1288 мс, из-за
  // чего first-contentful-paint случался на 688 мс вместо 64. Шрифт нужен
  // только для слова «Puls» в логотипе — задерживать ради него весь экран
  // незачем.
  const links = [...index.matchAll(/<link\b[^>]*fonts\.googleapis\.com[^>]*>/g)].map(m => m[0]);
  assert.ok(links.length >= 1, 'ссылки на внешний шрифт нет — проверять нечего');

  const blocking = links.filter(link =>
    /rel=["']stylesheet["']/.test(link) && !/media=["']print["']/.test(link));

  // Копия в <noscript> обязана быть блокирующей: без скриптов onload не
  // сработает, и это единственный способ получить шрифт вообще.
  const inNoscript = [...index.matchAll(/<noscript>[\s\S]*?<\/noscript>/g)]
    .map(m => m[0]).join('');
  const blockingOutsideNoscript = blocking.filter(link => !inNoscript.includes(link));

  assert.deepEqual(blockingOutsideNoscript, [],
    'внешняя таблица стилей шрифта блокирует отрисовку: ' + blockingOutsideNoscript.join(' | '));

  const deferred = links.find(link => /media=["']print["']/.test(link));
  assert.ok(deferred, 'нет отложенной загрузки шрифта');
  assert.match(deferred, /onload=["']this\.media=/,
    'media="print" без onload оставит шрифт неприменённым навсегда');
  assert.ok(inNoscript.includes('fonts.googleapis.com'),
    'без скриптов шрифт не загрузится: нужна копия в <noscript>');
});
