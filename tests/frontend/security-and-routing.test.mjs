import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const core = await readFile(
  new URL('../../js/src/app/00-core-shell.js', import.meta.url),
  'utf8',
);
const api = await readFile(
  new URL('../../js/src/api/client/00-client-auth.js', import.meta.url),
  'utf8',
);
const reportsApi = await readFile(
  new URL('../../js/src/api/domains/20-reports-analytics-tests.api.js', import.meta.url),
  'utf8',
);
const missions = await readFile(
  new URL('../../js/src/views/missions/80-missions.view.js', import.meta.url),
  'utf8',
);

test('every hash navigation is checked against the role registry', () => {
  assert.match(core, /addEventListener\('hashchange'/);
  assert.match(core, /allowedViewsForRole\(role\)\.includes\(requested\.view\)/);
  assert.match(core, /const fallback = isAdmin\(role\) \? 'summary' : 'cabinet'/);
});

test('navigation disposes in-flight view requests', () => {
  assert.match(core, /_viewAbortController\.abort\(\)/);
  assert.match(api, /currentViewSignal/);
  assert.match(api, /removeEventListener\('abort'/);
});

test('JSON and multipart writes send the double-submit CSRF token', () => {
  assert.match(api, /'X-CSRF-Token'/);
  assert.match(reportsApi, /'X-CSRF-Token'/);
});

test('mission completion renders the immutable received reward', () => {
  assert.match(missions, /attempt\.reward_received/);
});
