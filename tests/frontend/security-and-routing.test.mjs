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
const uiSystem = await readFile(
  new URL('../../js/src/utils/10-ui-system.js', import.meta.url),
  'utf8',
);
const ratingOverride = await readFile(
  new URL('../../js/src/views/rating/99-operator-cabinet-rating-redesign.view.js', import.meta.url),
  'utf8',
);
const shop = await readFile(
  new URL('../../js/src/views/rating/20-rating-shop-summary.view.js', import.meta.url),
  'utf8',
);
// Проверки прав живут в модулях групп, операторов и управления пользователями.
const users = (
  await Promise.all([
    '../../js/src/views/groups/30-e-groups.view.js',
    '../../js/src/views/operators/30-f-operators.view.js',
    '../../js/src/views/users/30-i-user-management.view.js',
  ].map((rel) => readFile(new URL(rel, import.meta.url), 'utf8')))
).join('\n');
const levels = await readFile(
  new URL('../../js/src/views/operator-levels/10-levels-cabinet.view.js', import.meta.url),
  'utf8',
);
// Тесты вынесены из файла колеса в js/src/views/tests/.
const testsView = (
  await Promise.all([
    '../../js/src/views/tests/60-h-tests-operator.view.js',
    '../../js/src/views/tests/60-i-test-runner.view.js',
    '../../js/src/views/tests/60-j-tests-staff.view.js',
    '../../js/src/views/tests/60-k-test-builder.view.js',
    '../../js/src/views/tests/60-l-test-results.view.js',
  ].map((rel) => readFile(new URL(rel, import.meta.url), 'utf8')))
).join('\n');

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

test('navigation resets scroll and moves focus to the current page heading', () => {
  assert.match(core, /window\.scrollTo\(\{ top: 0/);
  assert.match(core, /focusCurrentViewHeading/);
  assert.match(core, /heading\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(core, /host\.innerHTML = cached\.html/);
});

test('JSON and multipart writes send the double-submit CSRF token', () => {
  assert.match(api, /'X-CSRF-Token'/);
  assert.match(reportsApi, /'X-CSRF-Token'/);
});

test('mission completion renders the immutable received reward', () => {
  assert.match(missions, /attempt\.reward_received/);
});

test('mission replay is confirmed, idempotent, and cleans completed session state', () => {
  assert.match(missions, /Пройти миссию повторно\?/);
  assert.match(missions, /missionLogicalKey/);
  assert.match(missions, /sessionStorage\.removeItem\('puls-mission-attempt'\)/);
  assert.match(missions, /missionViewController/);
  assert.match(missions, /MISSION_ERROR_MESSAGES/);
});

test('shared presentation contract localizes dates, coins, and statuses', () => {
  assert.match(uiSystem, /Asia\/Almaty/);
  assert.match(uiSystem, /ru-KZ/);
  assert.match(uiSystem, /function uiCoin/);
  assert.match(uiSystem, /function uiStatusBadge/);
});

test('administrators use the staff rating instead of the operator cabinet', () => {
  assert.match(ratingOverride, /isAdmin\(STATE\.user\?\.role\)/);
  assert.match(ratingOverride, /renderStaffRating\(\)/);
});

test('shop separates received quantity from the per-person limit', () => {
  assert.match(shop, /Получено:/);
  assert.match(shop, /Лимит:/);
  assert.doesNotMatch(shop, /Осталось:/);
});

test('destructive controls are admin-only and require confirmation', () => {
  assert.match(uiSystem, /function uiConfirmAction/);
  assert.match(uiSystem, /uiResolveConfirm\(false\)/);
  assert.match(users, /STATE\.user\?\.role === 'admin'/);
  assert.match(users, /Удалять группы может только администратор/);
  assert.match(users, /Удалять операторов может только администратор/);
  assert.match(levels, /const canDeleteLevels = STATE\.user\?\.role === 'admin'/);
  assert.match(levels, /await uiConfirmAction/);
  assert.match(testsView, /const canDelete = STATE\.user\?\.role === 'admin'/);
  assert.match(testsView, /Удалить вопрос\?/);
  assert.match(testsView, /Удалить вариант ответа\?/);
});
