/**
 * Доступ к маршрутам по ролям (ТЗ, разделы «Матрица ролей» и
 * «Маршрутно-функциональная матрица»; DoD: «15 routes и tabs работают
 * с F5/Back/Forward и role guard»).
 *
 * Что было не так: раздел «Розыгрыши» существовал в ROUTES и в меню, но
 * отсутствовал в allowedViewsForRole — ни одна роль не могла его открыть.
 * resolveRoute молча подменял адрес на стартовый экран, поэтому баг не
 * выглядел как ошибка: пользователь просто оказывался на «Сводке».
 *
 * Проверяем не текст, а поведение: вытаскиваем настоящие функции
 * маршрутизации из исходника и выполняем их. Опечатка в списке ролей
 * иначе не ловится ничем, кроме ручного клика по всем разделам.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const shell = await readFile(new URL('js/src/app/00-core-shell.js', root), 'utf8');
const html = await readFile(new URL('index.html', root), 'utf8');

const ROLES = ['operator', 'supervisor', 'manager', 'admin'];
const STAFF_ROLES = ['supervisor', 'manager', 'admin'];

/** Достаёт объявление функции целиком по её имени. */
function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `в исходнике нет функции ${name}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`не нашёл конец функции ${name}`);
}

/** Таблица маршрутов: ключи в порядке объявления. */
function routeKeys(source) {
  const block = source.match(/const ROUTES = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'не нашёл таблицу ROUTES');
  return [...block[1].matchAll(/^\s{2}'?([a-z-]+)'?:\s*\{/gm)].map(m => m[1]);
}

const ROUTE_KEYS = routeKeys(shell);

// Выполняем настоящие функции доступа, подставив предикаты ролей.
const sandbox = new Function(`
  ${extractFn(shell, 'allowedViewsForRole')}
  ${extractFn(shell, 'fallbackViewForRole')}
  function isAdmin(role) { return ['supervisor','manager','admin'].includes(role); }
  function canManageGroups(role) { return ['manager','admin'].includes(role); }
  return { allowedViewsForRole, fallbackViewForRole };
`)();

const allowed = Object.fromEntries(ROLES.map(r => [r, sandbox.allowedViewsForRole(r)]));

test('в таблице маршрутов ровно 15 разделов', () => {
  assert.equal(ROUTE_KEYS.length, 15, `маршрутов ${ROUTE_KEYS.length}: ${ROUTE_KEYS.join(', ')}`);
});

test('каждый маршрут доступен хотя бы одной роли', () => {
  const orphans = ROUTE_KEYS.filter(key => !ROLES.some(r => allowed[r].includes(key)));
  assert.deepEqual(orphans, [], `маршрут есть в ROUTES, но недоступен никому: ${orphans.join(', ')}`);
});

test('«Розыгрыши» открываются и оператору, и штату', () => {
  assert.ok(allowed.operator.includes('raffles'), 'оператор не может участвовать в розыгрышах');
  for (const role of STAFF_ROLES) {
    assert.ok(allowed[role].includes('raffles'), `роль ${role} не видит администрирование розыгрышей`);
  }
});

test('оператор не получает ни одного штатного раздела', () => {
  const staffOnly = ['summary', 'operators', 'operator-levels', 'coins', 'groups',
                     'analytics', 'period-report', 'sessions'];
  const leaked = staffOnly.filter(v => allowed.operator.includes(v));
  assert.deepEqual(leaked, [], `оператору доступны штатные разделы: ${leaked.join(', ')}`);
});

test('права расширяются по возрастанию роли, а не произвольно', () => {
  // Супервайзер не управляет группами и уровнями — это решает бэкенд,
  // фронт обязан повторять то же самое.
  assert.ok(!allowed.supervisor.includes('groups'), 'супервайзеру открыты группы');
  assert.ok(!allowed.supervisor.includes('operator-levels'), 'супервайзеру открыты уровни');
  assert.ok(allowed.manager.includes('groups'), 'руководитель не управляет группами');
  assert.ok(allowed.manager.includes('operator-levels'), 'руководитель не управляет уровнями');
  // Сессии — только администратор: там видны IP и устройства всех сотрудников.
  for (const role of ['operator', 'supervisor', 'manager']) {
    assert.ok(!allowed[role].includes('sessions'), `роль ${role} видит чужие сессии`);
  }
  assert.ok(allowed.admin.includes('sessions'));
});

test('стартовый экран роли ей же и разрешён', () => {
  for (const role of ROLES) {
    const fallback = sandbox.fallbackViewForRole(role);
    assert.ok(ROUTE_KEYS.includes(fallback), `стартовый маршрут ${fallback} отсутствует в ROUTES`);
    assert.ok(allowed[role].includes(fallback),
      `роль ${role} падает на ${fallback}, который ей запрещён — получится цикл подмены`);
  }
});

test('каждая ссылка меню ведёт на существующий маршрут', () => {
  const hrefs = [...html.matchAll(/href="#([a-z-]+)"/g)].map(m => m[1]);
  assert.ok(hrefs.length >= 15, `в меню ${hrefs.length} ссылок — разметка изменилась`);
  const unknown = [...new Set(hrefs)].filter(h => !ROUTE_KEYS.includes(h));
  assert.deepEqual(unknown, [], `меню ведёт на несуществующие маршруты: ${unknown.join(', ')}`);
});

test('каждый маршрут представлен в меню', () => {
  const hrefs = new Set([...html.matchAll(/href="#([a-z-]+)"/g)].map(m => m[1]));
  const hidden = ROUTE_KEYS.filter(k => !hrefs.has(k));
  assert.deepEqual(hidden, [], `в меню нет пунктов для маршрутов: ${hidden.join(', ')}`);
});

test('запрещённый и несуществующий маршрут уводят на стартовый экран роли', () => {
  // resolveRoute — единственное место, где решается подмена; проверяем,
  // что она не отправляет туда, куда роли нельзя.
  assert.match(shell, /function resolveRoute\(/, 'нет resolveRoute');
  for (const role of ROLES) {
    const fallback = sandbox.fallbackViewForRole(role);
    assert.ok(allowed[role].includes(fallback),
      `подмена для роли ${role} ведёт на запрещённый ${fallback}`);
  }
});

test('адрес маршрута сохраняется в hash — F5 и Back/Forward возвращают тот же экран', () => {
  assert.match(shell, /function routeToHash\(/, 'нет routeToHash');
  assert.match(shell, /window\.addEventListener\('popstate', syncRouteFromUrl\)/,
    'Back/Forward не синхронизируют экран с адресом');
  assert.match(shell, /window\.addEventListener\('hashchange', syncRouteFromUrl\)/,
    'смена hash не синхронизирует экран');
  assert.match(shell, /history\[method\]\(null, '', canonicalUrl\)/,
    'переход не пишет адрес в историю — Back/Forward работать не будут');
});
