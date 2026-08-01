import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const core = await readFile(
  new URL('../../js/src/app/00-core-shell.js', import.meta.url),
  'utf8',
);
const modal = await readFile(
  new URL('../../js/src/components/10-modal.js', import.meta.url),
  'utf8',
);
const theme = await readFile(
  new URL('../../js/theme-init.js', import.meta.url),
  'utf8',
);
const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

const cssRoot = fileURLToPath(new URL('../../css/src/', import.meta.url));
const cssFiles = (await readdir(cssRoot, { recursive: true }))
  .filter(name => name.endsWith('.css'));
const cssSource = (await Promise.all(
  cssFiles.map(name => readFile(path.join(cssRoot, name), 'utf8')),
)).join('\n');

test('SPA navigation restores routes and includes every role-aware product view', () => {
  assert.match(core, /addEventListener\('popstate', restoreBrowserRoute\)/);
  assert.match(core, /'raffles'/);
  assert.match(core, /allowedViewsForRole/);
});

test('theme follows the operating system until the user chooses explicitly', () => {
  assert.match(theme, /prefers-color-scheme: dark/);
  assert.match(theme, /saved === 'light' \|\| saved === 'dark'/);
});

test('shared modal has dialog semantics, Escape support, focus trap, and focus return', () => {
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /event\.key !== 'Tab'/);
  assert.match(modal, /UI_MODAL_RETURN_FOCUS/);
});

test('redesign sources avoid remote fonts and cascading emergency overrides', () => {
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.doesNotMatch(cssSource, /!important/);
});

test('inactive SPA views stay hidden even when a legacy screen declares display', () => {
  assert.match(cssSource, /#app-shell\s+\.app-view:not\(\.active\)\s*\{\s*display:\s*none/);
});
