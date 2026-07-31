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

test('analytics requests are coalesced and operator table is server paginated', () => {
  assert.match(app, /const SWR_IN_FLIGHT = new Map\(\)/);
  assert.match(app, /page_size: 100/);
  assert.match(app, /operatorSortOrder/);
  assert.match(app, /Страница \$\{opsTable\.page\} из \$\{totalPages\}/);
});

test('analytics filters include quick periods, reset and URL-backed tab', () => {
  assert.match(app, /data-an-period="day"/);
  assert.match(app, /id="an-reset-btn"/);
  assert.match(app, /qs\.set\('tab', params\.tab\)/);
});
