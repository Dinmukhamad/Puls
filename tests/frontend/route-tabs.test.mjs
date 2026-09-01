/**
 * Вкладки принадлежат маршруту, а не приложению.
 *
 * Что было не так: активная вкладка любого раздела хранилась в общем
 * STATE.coinsTab, а syncRouteFromUrl сверял вкладку с ним же для ЛЮБОГО
 * маршрута. Пока вкладки были только у «Коинов», это не проявлялось.
 * Со вторым разделом на вкладках («Уровни») Back/Forward внутри него либо
 * зря перерисовывал экран, либо — если бы имена вкладок совпали — молча не
 * срабатывал вовсе.
 *
 * Проверяем поведение настоящих функций из исходника, а не текст файла:
 * иначе тест остаётся зелёным при любой перестановке строк.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const shell = await readFile(new URL('js/src/app/00-core-shell.js', root), 'utf8');

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

function constArray(source, name) {
  const m = source.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  assert.ok(m, `не нашёл ${name}`);
  return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

const COIN_TABS = constArray(shell, 'COIN_TABS');
const LEVEL_TABS = constArray(shell, 'LEVEL_TABS');

/** Маршруты, объявившие вкладки в настоящей таблице ROUTES. */
function tabbedRoutes(source) {
  const block = source.match(/const ROUTES = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'не нашёл таблицу ROUTES');
  return [...block[1].matchAll(/^\s{2}'?([a-z-]+)'?:\s*\{(.*)$/gm)]
    .filter(m => m[2].includes('tabs:'))
    .map(m => m[1]);
}

/** Начальные значения STATE.routeTabs из исходника. */
function initialRouteTabs(source) {
  const m = source.match(/routeTabs: \{([^}]*)\}/);
  assert.ok(m, 'не нашёл routeTabs в STATE');
  return [...m[1].matchAll(/'?([a-z-]+)'?:\s*'([a-z]+)'/g)]
    .reduce((acc, [, key, value]) => Object.assign(acc, { [key]: value }), {});
}

const TABBED = tabbedRoutes(shell);
const INITIAL_TABS = initialRouteTabs(shell);

/**
 * Песочница с настоящими rememberRouteTab, parseRoute, resolveRoute и
 * syncRouteFromUrl. Окружение подставное: ROUTES собран из тех же списков
 * вкладок, что и в приложении, а navigateTo только записывает вызовы.
 */
function makeSandbox({ currentView = '' } = {}) {
  const factory = new Function('LEVEL_TABS', 'COIN_TABS', 'CURRENT_VIEW', 'INITIAL_TABS', `
    const LEGACY_COIN_VIEW_TAB = {};
    const STATE = {
      user: { role: 'admin' },
      currentView: CURRENT_VIEW,
      coinsTab: 'overview',
      opLevelsTab: 'levels',
      routeTabs: { ...INITIAL_TABS },
    };
    ${extractFn(shell, 'normalizeCoinTab')}
    ${extractFn(shell, 'normalizeLevelTab')}
    const ROUTES = {
      summary: {},
      coins: { tabs: COIN_TABS, normalizeTab: normalizeCoinTab },
      'operator-levels': { tabs: LEVEL_TABS, normalizeTab: normalizeLevelTab },
    };
    const LEGACY_TAB_MIRRORS = { coins: 'coinsTab', 'operator-levels': 'opLevelsTab' };
    function isKnownRoute(view) { return Boolean(ROUTES[view]); }
    function allowedViewsForRole() { return Object.keys(ROUTES); }
    function fallbackViewForRole() { return 'summary'; }
    ${extractFn(shell, 'rememberRouteTab')}
    ${extractFn(shell, 'parseRoute')}
    ${extractFn(shell, 'resolveRoute')}

    const navigations = [];
    function navigateTo(view, options) { navigations.push({ view, tab: options && options.tab }); }
    const location = { hash: '' };
    ${extractFn(shell, 'syncRouteFromUrl')}

    return {
      STATE,
      navigations,
      rememberRouteTab,
      resolveRoute,
      sync(hash) { location.hash = hash; syncRouteFromUrl(); },
    };
  `);
  return factory(LEVEL_TABS, COIN_TABS, currentView, INITIAL_TABS);
}

test('у каждого маршрута с вкладками есть своя запись в STATE.routeTabs', () => {
  for (const view of TABBED) {
    assert.ok(view in INITIAL_TABS,
      `маршрут ${view} объявляет tabs, но не имеет начальной вкладки в STATE.routeTabs`);
  }
  assert.ok(TABBED.length >= 2,
    `ожидали минимум два маршрута с вкладками, нашли: ${TABBED.join(', ') || 'ни одного'}`);
});

test('вкладка одного маршрута не затирает вкладку другого', () => {
  const s = makeSandbox();
  s.rememberRouteTab('coins', 'history');
  s.rememberRouteTab('operator-levels', 'achievements');

  assert.equal(s.STATE.routeTabs.coins, 'history');
  assert.equal(s.STATE.routeTabs['operator-levels'], 'achievements');

  // Обратный порядок не должен менять исход.
  s.rememberRouteTab('coins', 'weekly');
  assert.equal(s.STATE.routeTabs['operator-levels'], 'achievements',
    'запись вкладки «Коинов» сбросила вкладку «Уровней»');
});

test('legacy-зеркало пишется только для своего маршрута', () => {
  const s = makeSandbox();
  s.rememberRouteTab('operator-levels', 'achievements');
  assert.equal(s.STATE.opLevelsTab, 'achievements');
  assert.equal(s.STATE.coinsTab, 'overview', 'вкладка «Уровней» протекла в coinsTab');
});

test('вкладка восстанавливается из адреса', () => {
  const s = makeSandbox();
  assert.equal(s.resolveRoute('operator-levels', 'achievements').tab, 'achievements');
  assert.equal(s.resolveRoute('coins', 'history').tab, 'history');
});

test('чужая вкладка в адресе не принимается', () => {
  const s = makeSandbox();
  // history — вкладка «Коинов»; для «Уровней» это мусор и должен быть отброшен.
  assert.equal(s.resolveRoute('operator-levels', 'history').tab, 'levels');
  assert.equal(s.resolveRoute('coins', 'achievements').tab, 'overview');
});

test('возврат на маршрут без вкладки в адресе поднимает его собственную вкладку', () => {
  const s = makeSandbox({ currentView: 'operator-levels' });
  s.rememberRouteTab('operator-levels', 'achievements');
  s.rememberRouteTab('coins', 'history');
  assert.equal(s.resolveRoute('operator-levels', '').tab, 'achievements',
    'подставилась вкладка чужого маршрута');
});

test('Back/Forward на ту же вкладку не перерисовывает экран', () => {
  const s = makeSandbox({ currentView: 'operator-levels' });
  s.rememberRouteTab('operator-levels', 'achievements');
  s.rememberRouteTab('coins', 'overview');

  s.sync('#operator-levels?tab=achievements');
  assert.deepEqual(s.navigations, [],
    'сверка шла с вкладкой другого маршрута: экран перерисовался зря');
});

test('Back/Forward на другую вкладку того же маршрута перерисовывает экран', () => {
  const s = makeSandbox({ currentView: 'operator-levels' });
  s.rememberRouteTab('operator-levels', 'achievements');

  s.sync('#operator-levels?tab=levels');
  assert.deepEqual(s.navigations, [{ view: 'operator-levels', tab: 'levels' }],
    'смена вкладки через историю не применилась');
});

test('вкладки «Коинов» и «Уровней» переживают переход между разделами', () => {
  const s = makeSandbox({ currentView: 'coins' });
  s.rememberRouteTab('coins', 'weekly');
  s.rememberRouteTab('operator-levels', 'achievements');

  s.STATE.currentView = 'operator-levels';
  assert.equal(s.resolveRoute('operator-levels', '').tab, 'achievements');
  s.STATE.currentView = 'coins';
  assert.equal(s.resolveRoute('coins', '').tab, 'weekly',
    'вкладка «Коинов» потерялась после визита в «Уровни»');
});
