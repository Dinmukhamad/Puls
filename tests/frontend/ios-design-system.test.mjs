import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const [index, tokens, core, ui, foundation, navigation, components, forms, tables, states, bundler] = await Promise.all([
  source('index.html'),
  source('css/tokens.css'),
  source('js/src/app/00-core-shell.js'),
  source('js/src/utils/10-ui-system.js'),
  source('css/src/system/00-foundation.css'),
  source('css/src/system/20-navigation.css'),
  source('css/src/system/30-components.css'),
  source('css/src/system/40-forms.css'),
  source('css/src/system/50-tables-charts.css'),
  source('css/src/system/60-states-overlays.css'),
  source('scripts/build-frontend.mjs'),
]);
const viewCssFiles = await readdir(new URL('../../css/src/views/', import.meta.url));

test('theme tokens use the requested system palette and font stack', () => {
  assert.match(tokens, /--bg-page:\s*#f2f2f7/i);
  assert.match(tokens, /--accent-primary:\s*#007aff/i);
  assert.match(tokens, /--success:\s*#248a3d/i);
  assert.match(tokens, /--font-main:\s*-apple-system, BlinkMacSystemFont/);
  assert.match(tokens, /\[data-theme="dark"\]/);
  assert.match(tokens, /--bg-page:\s*#000(?:000)?;/i);
  assert.match(tokens, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(index, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test('mobile navigation is role-aware, limited to four primary views, and safe-area aware', () => {
  assert.match(index, /id="mobile-tab-bar"/);
  assert.match(index, /id="mobile-more-sheet"[^>]+role="dialog"[^>]+aria-modal="true"/);
  assert.match(core, /mobilePrimaryViews\(role\)/);
  assert.match(core, /\.slice\(0, 4\)/);
  assert.match(core, /setMobileMoreOpen/);
  assert.match(navigation, /env\(safe-area-inset-bottom/);
  assert.match(navigation, /env\(safe-area-inset-left/);
  assert.match(navigation, /env\(safe-area-inset-right/);
});

test('shared controls expose keyboard focus and the 44px touch target contract', () => {
  assert.match(tokens, /--touch-target:\s*44px/);
  assert.match(foundation, /focus-visible/);
  assert.match(components, /min-height:\s*var\(--touch-target\)/);
  assert.match(states, /aria-modal|modal/);
  assert.match(core, /event\.key === 'Escape'/);
  assert.match(core, /event\.key === 'Tab'/);
  assert.match(core, /_mobileMoreTrigger\?\.focus/);
});

test('tables are constrained to their own region and become labelled cards on narrow screens', () => {
  assert.match(tables, /overflow(?:-x)?:\s*auto/);
  assert.match(tables, /position:\s*sticky/);
  assert.match(tables, /data-mobile-cards/);
  assert.match(tables, /attr\(data-label\)/);
  assert.match(ui, /uiEnhanceTable/);
  assert.match(ui, /setAttribute\('data-label'/);
});

test('all role routes include rating and raffles where the views are rendered', () => {
  assert.match(core, /return \['cabinet', 'rating', 'missions', 'tests', 'shop', 'wheel', 'raffles'\]/);
  assert.match(core, /views\.push\('rating'\)/);
  assert.match(core, /case 'raffles':\s+renderRaffles\(\)/);
  assert.match(core, /addEventListener\('popstate'/);
});

test('view preservation distinguishes tab routes instead of freezing nested navigation', () => {
  assert.match(core, /const VIEW_RENDER_KEYS = new Map\(\)/);
  assert.match(core, /`\$\{view\}:\$\{STATE\.coinsTab\}`/);
  assert.match(core, /`\$\{view\}:\$\{analyticsTab\}`/);
  assert.match(core, /VIEW_RENDER_KEYS\.get\(view\) === renderKey/);
});

test('destructive actions use the application dialog instead of a browser confirm', () => {
  assert.match(ui, /function uiConfirmAction/);
  assert.doesNotMatch(`${core}\n${ui}`, /\bwindow\.confirm\s*\(|(?<![\w.])confirm\s*\(/);
});

test('the modular system layer is bundled after view-specific CSS', () => {
  assert.match(bundler, /\["css", "src", "views"\]/);
  assert.match(bundler, /\["css", "src", "system"\]/);
  assert.ok(
    bundler.indexOf('["css", "src", "views"]')
      < bundler.indexOf('["css", "src", "system"]'),
  );
});

test('conflicting redesign layers are removed and mixed legacy CSS is split by view', () => {
  for (const removed of [
    '40-coins-tests-wheel-overrides.css',
    '90-visual-polish.css',
    'zz-corporate-trust-system.css',
    'zzz-ui-ux-hardening.css',
  ]) {
    assert.ok(!viewCssFiles.includes(removed), `${removed} must stay removed`);
  }
  for (const module of [
    '40-coins.css',
    '41-tests.css',
    '42-levels-users.css',
    '43-rating-dynamics.css',
    '44-wheel.css',
    '45-sessions.css',
    '46-wheel-admin-refinement.css',
  ]) {
    assert.ok(viewCssFiles.includes(module), `${module} must be bundled`);
  }
});
