import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const app = readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');

test('management summary exposes compact filters and server Excel export', () => {
  assert.match(app, /function renderManagementSummary\(\)/);
  assert.match(app, /data-summary-preset="\$\{key\}"/);
  assert.match(app, /\/api\/analytics\/export\.xlsx/);
  assert.match(app, /summary-management-kpis/);
});

test('request coalescing still guards repeated view loads', () => {
  assert.match(app, /const SWR_IN_FLIGHT = new Map\(\)/);
});

// Фильтры и пагинация экрана аналитики переехали на единый /dashboard —
// их контракт проверяет tests/frontend/analytics-dashboard.test.mjs.
