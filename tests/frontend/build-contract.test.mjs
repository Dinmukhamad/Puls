import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MINIFIED_ARTIFACTS,
  minifyCss,
  minifyJavaScript,
} from '../../scripts/minify-frontend.mjs';

const packageJson = JSON.parse(await readFile(
  new URL('../../package.json', import.meta.url),
  'utf8',
));
const bundler = await readFile(
  new URL('../../scripts/build-frontend.mjs', import.meta.url),
  'utf8',
);
const indexHtml = await readFile(
  new URL('../../index.html', import.meta.url),
  'utf8',
);

test('production build bundles sources and creates all minified artifacts', () => {
  assert.equal(packageJson.scripts.bundle, 'node scripts/build-frontend.mjs');
  assert.equal(packageJson.scripts.minify, 'node scripts/minify-frontend.mjs');
  assert.equal(packageJson.scripts.build, 'npm run bundle && npm run minify');
  assert.equal(packageJson.scripts['check:minified'], 'node scripts/minify-frontend.mjs --check');
  assert.deepEqual(
    MINIFIED_ARTIFACTS.map(({ source, output }) => [source, output]),
    [
      ['js/api.js', 'js/api.min.js'],
      ['js/app.js', 'js/app.min.js'],
      ['css/styles.css', 'css/styles.min.css'],
    ],
  );
});

test('the production shell loads generated minified bundles', () => {
  assert.match(indexHtml, /css\/styles\.min\.css/);
  assert.match(indexHtml, /js\/api\.min\.js/);
  assert.match(indexHtml, /js\/app\.min\.js/);
  assert.doesNotMatch(indexHtml, /(?:css\/styles|js\/(?:api|app))\.js/);
});

test('source bundle banners remain deterministic and instruct developers to rebuild', () => {
  assert.match(bundler, /Generated from js\/src\/api source files\. Run npm run build/);
  assert.match(bundler, /Generated from js\/src app source files\. Run npm run build/);
  assert.match(bundler, /Generated from css\/src source files\. Run npm run build/);
  assert.match(bundler, /replace\(\/\\r\\n\?\/g, "\\n"\)/);
});

test('JavaScript and CSS minifiers are deterministic and reduce production samples', async () => {
  const jsSource = `
    function calculateOperatorTotal(values) {
      const normalizedValues = values.map(function normalizeOperatorValue(value) {
        return Number(value) || 0;
      });
      return normalizedValues.reduce(function sumOperatorValues(total, value) {
        return total + value;
      }, 0);
    }
    window.calculateOperatorTotal = calculateOperatorTotal;
  `;
  const cssSource = `
    .operator-card {
      background-color: #ffffff;
      border: 1px solid rgba(60, 60, 67, 0.18);
      border-radius: 16px;
      color: #1c1c1e;
      padding: 16px 16px 16px 16px;
    }
  `;

  const jsFirst = await minifyJavaScript(jsSource);
  const jsSecond = await minifyJavaScript(jsSource);
  const cssFirst = minifyCss(cssSource);
  const cssSecond = minifyCss(cssSource);

  assert.equal(jsFirst, jsSecond);
  assert.equal(cssFirst, cssSecond);
  assert.ok(Buffer.byteLength(jsFirst) < Buffer.byteLength(jsSource));
  assert.ok(Buffer.byteLength(cssFirst) < Buffer.byteLength(cssSource));
  assert.doesNotMatch(jsFirst, /\n\s+/);
  assert.doesNotMatch(cssFirst, /\n\s+/);
});
