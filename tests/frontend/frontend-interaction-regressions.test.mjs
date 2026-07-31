import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const staffRating = await readFile(
  new URL('../../js/src/views/rating/50-rating-tabs.view.js', import.meta.url),
  'utf8',
);
const operatorRating = await readFile(
  new URL('../../js/src/views/rating/99-operator-cabinet-rating-redesign.view.js', import.meta.url),
  'utf8',
);
const users = await readFile(
  new URL('../../js/src/views/coins/30-admin-coins-groups-operators.view.js', import.meta.url),
  'utf8',
);
const analytics = await readFile(
  new URL('../../js/src/views/reports/40-reports-analytics.view.js', import.meta.url),
  'utf8',
);

test('staff and operator rating loaders have distinct global names', () => {
  assert.match(staffRating, /async function loadStaffRatingTab\(tab\)/);
  assert.match(operatorRating, /async function loadOperatorRatingTab\(tab\)/);
  assert.doesNotMatch(staffRating + operatorRating, /function loadRatingTab\(tab\)/);
});

test('operator cabinet is scoped to the active session and stops automatic retries on error', () => {
  assert.match(operatorRating, /const snapshot = cabinetSnapshotForCurrentUser\(\)/);
  assert.match(operatorRating, /if \(!snapshot && STATE\.cabinetError\)/);
  assert.match(operatorRating, /disabled aria-busy="true"/);
});

test('users view delegates dynamic row actions without recursive rebinding', () => {
  assert.match(users, /el\.onclick = event =>/);
  assert.match(users, /function refreshUsersTable/);
  assert.doesNotMatch(users, /function rebindOps/);
  assert.doesNotMatch(users, /function bindOpsActions/);
});

test('CSV download helpers are scoped by feature instead of sharing a global name', () => {
  assert.match(users, /function downloadCoinHistoryCsv\(/);
  assert.match(analytics, /function downloadAnalyticsCsvFile\(/);
  assert.doesNotMatch(users + analytics, /function downloadCSV\(|function downloadCsv\(/);
});

test('every user mutation entry point enforces the frontend capability guard', () => {
  for (const name of [
    'showAddOperatorModal',
    'submitAddOperator',
    'deactivateUserUi',
    'showUserManagementModal',
    'submitUserManagement',
    'showUserResetPasswordModal',
    'submitUserResetPassword',
  ]) {
    assert.match(
      users,
      new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]{0,180}if \\(!canManageOperators\\(\\)\\)`),
      `${name} must check canManageOperators() before doing work`,
    );
  }
});

test('analytics discards stale responses and removes its document listener', () => {
  assert.match(analytics, /function analyticsLoadIsCurrent/);
  assert.match(analytics, /requestGen !== _analyticsQualityWeekGen/);
  assert.match(analytics, /document\.removeEventListener\('click', _analyticsOutsideClickHandler\)/);
  assert.match(analytics, /currentViewSignal\(\)/);
  assert.doesNotMatch(analytics, /content\.innerHTML = '';\s*\}/);
});

test('analytics date inputs use the business timezone and calendar-safe arithmetic', () => {
  assert.match(analytics, /timeZone: UI_TIME_ZONE/);
  assert.match(analytics, /T00:00:00Z/);
  assert.match(analytics, /getUTCDay\(\)/);
  assert.match(analytics, /setUTCDate\(/);
  assert.doesNotMatch(analytics, /new Date\(y, m, 1\)\.toISOString/);
});
