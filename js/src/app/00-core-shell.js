/**
 * Puls — Main App v2
 * FastAPI backend, full admin panel per TZ
 */
'use strict';


/* ══════════════════════════════════════
   SWR CACHE (stale-while-revalidate)
   Переживает F5 через sessionStorage. Любой fetch-обёрнутый вызов
   через swrFetch(key, fetcher) сразу отдаёт закешированные данные
   (если есть), а затем тихо обновляет их в фоне и уведомляет подписчика.
══════════════════════════════════════ */
const SWR_PREFIX = 'puls-swr:';
const SWR_DEFAULT_TTL_MS = 120_000;  // 2 минуты — динамичные данные (рейтинг, дашборд)
const SWR_STATIC_TTL_MS  = 600_000; // 10 минут — статичные (уровни, магазин, группы)
const SWR_USER_TTL_MS    = 300_000; // 5 минут — пользователи
const SWR_FAST_TTL_MS    = 45_000;  // короткий кеш для разделов, которые должны открываться сразу
const SWR_VERSION = 'redesign-v2-2'; // при смене версии весь кеш сбрасывается
const SWR_IN_FLIGHT = new Map();
(function() {
  const stored = sessionStorage.getItem('puls-swr-version');
  if (stored !== SWR_VERSION) {
    Object.keys(sessionStorage).filter(k => k.startsWith(SWR_PREFIX)).forEach(k => sessionStorage.removeItem(k));
    sessionStorage.setItem('puls-swr-version', SWR_VERSION);
  }
})();

function swrReadRaw(key) {
  try {
    const raw = sessionStorage.getItem(SWR_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}
function swrWriteRaw(key, entry) {
  try { sessionStorage.setItem(SWR_PREFIX + key, JSON.stringify(entry)); }
  catch(e) { /* sessionStorage может быть полон/недоступен — тихо игнорируем, кеш просто не сохранится */ }
}

/**
 * Возвращает { data, fromCache, isStale }, сразу синхронно если есть кеш.
 * Не делает сетевой запрос сама — для этого используйте swrFetch.
 */
function swrPeek(key) {
  const entry = swrReadRaw(key);
  if (!entry) return null;
  const age = Date.now() - entry.ts;
  return { data: entry.data, fromCache: true, isStale: age > SWR_DEFAULT_TTL_MS, ageMs: age };
}

/**
 * Stale-while-revalidate fetch.
 *
 * @param key       уникальный ключ кеша (например 'analytics:summary:2026-06-15:2026-06-20:all')
 * @param fetcher   async () => data — реальный запрос к API
 * @param onUpdate  (data) => void — вызывается с финальными свежими данными после фонового обновления
 *                  (НЕ вызывается, если возвращённые данные совпадают с тем, что уже было в кеше — избегаем лишних перерисовок)
 * @returns         Promise<data> — резолвится с кешированными данными немедленно, если они есть,
 *                   либо ждёт первый реальный fetch если кеша вообще нет
 */
async function swrFetch(key, fetcher, onUpdate, ttlMs = SWR_DEFAULT_TTL_MS) {
  const cached = swrReadRaw(key);

  if (cached) {
    // Есть кеш — отдаём его сразу, а свежие данные подгружаем в фоне
    const age = Date.now() - cached.ts;
    if (age > ttlMs) {
      const refresh = SWR_IN_FLIGHT.get(key) || Promise.resolve().then(fetcher);
      SWR_IN_FLIGHT.set(key, refresh);
      refresh.then(fresh => {
        const changed = JSON.stringify(fresh) !== JSON.stringify(cached.data);
        swrWriteRaw(key, { data: fresh, ts: Date.now() });
        if (changed && onUpdate) onUpdate(fresh);
      }).catch(() => { /* старые данные остаются видимыми */ })
        .finally(() => { if (SWR_IN_FLIGHT.get(key) === refresh) SWR_IN_FLIGHT.delete(key); });
    }
    return cached.data;
  }

  // Кеша нет вообще — обычный fetch, без фонового режима
  const pending = SWR_IN_FLIGHT.get(key) || Promise.resolve().then(fetcher);
  SWR_IN_FLIGHT.set(key, pending);
  try {
    const fresh = await pending;
    swrWriteRaw(key, { data: fresh, ts: Date.now() });
    return fresh;
  } finally {
    if (SWR_IN_FLIGHT.get(key) === pending) SWR_IN_FLIGHT.delete(key);
  }
}

/** Принудительно стирает один ключ или все ключи кеша (например после сохранения расчёта периода) */
function swrInvalidate(keyOrPrefix) {
  try {
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith(SWR_PREFIX + keyOrPrefix));
    keys.forEach(k => sessionStorage.removeItem(k));
  } catch(e) { /* ignore */ }
}

function stableParamsKey(params = {}) {
  return Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
}

/* ══════════════════════════════════════
   STATE
══════════════════════════════════════ */
let STATE = {
  user: null,
  wallet: null,
  rating: [],
  nominations: { items: [] },
  shopItems: [],
  shopDiscounts: [],
  purchases: [],
  dashboard: null,
  adminOperators: [],
  users: [],
  usersFilters: {
    search: '',
    group: '',
    role: '',
    status: '',
    level: '',
    tab: 'all',
  },
  myLevel: null,
  myOperator: null,
  operatorLevels: [],
  history: [],
  groups: [],
  cabinetData: null,
  cabinetSnapshot: null,
  cabinetLoading: false,
  cabinetError: null,
  cabinetFetchedAt: null,
  opLevelsTab: 'levels',
  currentView: 'cabinet',
  coinsOverview: null,
  coinsTab: 'overview',
  navGen: 0,         // увеличивается при каждой смене раздела/вкладки —
  ratingTabGen: 0,   // используется для отмены "осиротевших" async-рендеров
  analyticsTabGen: 0,
};

/** Уровень в боковой панели: пустое значение прячем, а не показываем прочерком. */
function setSideLevel(value) {
  const el = document.getElementById('side-level');
  if (!el) return;
  const text = (value || '').trim();
  el.textContent = text;
  el.hidden = !text;
}

function levelBadgeHtml(level, extraClass = '') {
  if (!level) return '<span class="cell-muted">—</span>';
  const color = level.color || '#64748B';
  // Цвет уровня задаётся в данных и может быть любым — светло-голубым или
  // тёмно-синим. Как цвет текста он давал 2.8:1 на белом и 3.3:1 на тёмном
  // фоне, поэтому инлайном отдаём только --level-color: рамку и подложку CSS
  // берёт как есть, а текст подмешивает к цвету темы до читаемого контраста.
  return `<span class="level-badge ${extraClass}" style="--level-color:${esc(color)};border-color:${esc(color)};background:${esc(color)}16">${esc(level.name || 'Стажёр')}</span>`;
}

function levelNum(v, decimals = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: decimals });
}

function withTimeout(promise, ms, message = 'Сервер не отвечает') {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

// Форматирование стажа: дни → читаемая строка
function formatTenureDays(days) {
  if (days == null || isNaN(days)) return '—';
  days = Math.max(0, Math.round(days));
  if (days === 0) return 'Сегодня первый день';
  if (days < 30) return `${days} ${pluralize(days, 'день', 'дня', 'дней')}`;
  const months = Math.floor(days / 30);
  const rem = days % 30;
  const mStr = `${months} ${pluralize(months, 'месяц', 'месяца', 'месяцев')}`;
  return rem > 0 ? `${mStr} ${rem} ${pluralize(rem, 'день', 'дня', 'дней')}` : mStr;
}

function pluralize(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function metricValueHtml(gap) {
  const suffix = gap.metric_code === 'efficiency' || gap.metric_code === 'quality' || gap.metric_code === 'test_percent' ? '%' : '';
  if (gap.metric_code === 'penalty_minutes') return `${levelNum(gap.current, 1)} мин`;
  if (gap.metric_code === 'tenure_days') return formatTenureDays(gap.current);
  return `${levelNum(gap.current, 1)}${suffix}`;
}

function levelRequirementHtml(gap) {
  const suffix = gap.metric_code === 'efficiency' || gap.metric_code === 'quality' || gap.metric_code === 'test_percent' ? '%' : '';
  if (gap.operator === 'gte') {
    if (gap.metric_code === 'tenure_days') return `нужно ${formatTenureDays(gap.required_min)}`;
    return `нужно ${levelNum(gap.required_min, 1)}${suffix}`;
  }
  if (gap.operator === 'lte') {
    if (gap.metric_code === 'tenure_days') return `максимум ${formatTenureDays(gap.required_max)}`;
    return `максимум ${levelNum(gap.required_max, 1)}${gap.metric_code === 'penalty_minutes' ? ' мин' : suffix}`;
  }
  if (gap.operator === 'between') {
    if (gap.metric_code === 'tenure_days') return `${formatTenureDays(gap.required_min)} — ${formatTenureDays(gap.required_max)}`;
    return `${levelNum(gap.required_min, 1)}-${levelNum(gap.required_max, 1)}${gap.metric_code === 'penalty_minutes' ? ' мин' : suffix}`;
  }
  return `нужно ${levelNum(gap.required_min, 1)}${suffix}`;
}

/**
 * Защита от устаревших async-рендеров при быстром переключении разделов/вкладок.
 * Использование: захватить токен ДО await-ов, и проверить isStale() сразу
 * после каждого await — если true, дальше рендерить (писать в DOM) не нужно,
 * пользователь уже ушёл в другой раздел/вкладку.
 *
 *   const myGen = bumpNavGen();
 *   const data = await fetch(...);
 *   if (isNavStale(myGen)) return;   // раздел сменился — выходим тихо
 *   el.innerHTML = ...;
 */
function bumpNavGen() { return ++STATE.navGen; }
function isNavStale(token) { return token !== STATE.navGen; }
function bumpRatingTabGen() { return ++STATE.ratingTabGen; }
function isRatingTabStale(token) { return token !== STATE.ratingTabGen; }
function bumpAnalyticsTabGen() { return ++STATE.analyticsTabGen; }
function isAnalyticsTabStale(token) { return token !== STATE.analyticsTabGen; }

const COIN_TABS = ['overview', 'accrual', 'requests', 'history', 'rules', 'weekly', 'settings'];
// Разделы, которые когда-то были самостоятельными, а теперь стали вкладками
// «Коинов». Старые ссылки и закладки обязаны продолжать работать.
const LEGACY_COIN_VIEW_TAB = { accrual: 'accrual', manual: 'accrual', requests: 'requests', history: 'history' };

function normalizeCoinTab(tab) {
  if (tab === 'manual') return 'accrual';
  return COIN_TABS.includes(tab) ? tab : 'overview';
}

/* ══════════════════════════════════════
   РЕЕСТР МАРШРУТОВ

   Единственный источник правды о разделах: hash, заголовок вкладки браузера
   и функция отрисовки. Раньше это было размазано по четырём местам —
   switch в renderView, список ролей, сборка URL внутри navigateTo и разметка
   sidebar, — и они разъезжались: «Коины» писались в pathname (/coins?tab=),
   а не в hash, из-за чего адрес раздела пропадал, а Back/Forward между
   «Коинами» и остальными разделами работал через раз.

   render задан стрелкой, а не ссылкой на функцию: реестр объявляется раньше
   файлов вьюх, и прямая ссылка вычислялась бы в момент создания объекта.
══════════════════════════════════════ */
const ROUTES = {
  summary:           { title: 'Сводка',            render: () => renderSummary() },
  operators:         { title: 'Пользователи',      render: () => renderAdminOperators() },
  'operator-levels': { title: 'Уровни',            render: () => renderOperatorLevelsSettings() },
  coins:             { title: 'Коины',             render: () => renderCoins(), tabs: COIN_TABS, normalizeTab: normalizeCoinTab },
  groups:            { title: 'Группы',            render: () => renderGroups() },
  analytics:         { title: 'Аналитика',         render: () => renderAnalytics() },
  'period-report':   { title: 'Расчёт за период',  render: () => renderPeriodReport() },
  sessions:          { title: 'Сессии',            render: () => renderAdminSessions() },
  cabinet:           { title: 'Мой кабинет',       render: () => renderCabinet() },
  rating:            { title: 'Рейтинг',           render: () => renderRating() },
  tests:             { title: 'Тесты',             render: () => renderTests() },
  missions:          { title: 'Миссии',            render: () => renderMissions() },
  wheel:             { title: 'Колесо WOW',        render: () => renderWheel() },
  raffles:           { title: 'Розыгрыши',         render: () => renderRaffles() },
  shop:              { title: 'Магазин',           render: () => renderShop() },
};

const APP_TITLE = 'Puls';

function isKnownRoute(view) {
  return Object.prototype.hasOwnProperty.call(ROUTES, view);
}

/** Права по разделам. Правила не менялись — перенесены как были. */
function allowedViewsForRole(role) {
  if (!isAdmin(role)) return ['cabinet', 'rating', 'shop', 'wheel', 'tests', 'missions'];

  const views = ['summary', 'operators', 'coins', 'shop', 'wheel', 'tests', 'missions', 'period-report', 'analytics'];
  if (role === 'manager' || role === 'admin') views.push('operator-levels');
  if (canManageGroups(role)) views.push('groups');
  if (role === 'admin') views.push('sessions', 'cabinet', 'rating');
  return views;
}

function fallbackViewForRole(role) {
  return isAdmin(role) ? 'summary' : 'cabinet';
}

/** Разбирает "#coins?tab=history", "coins?tab=history" и "/coins?tab=history". */
function parseRoute(value) {
  if (!value) return { view: '', tab: '' };
  const clean = String(value).replace(/^[#/]+/, '');
  const [rawView, query = ''] = clean.split('?');
  const view = rawView.replace(/\/+$/, '');
  const tab = new URLSearchParams(query).get('tab') || '';
  if (LEGACY_COIN_VIEW_TAB[view]) return { view: 'coins', tab: LEGACY_COIN_VIEW_TAB[view] };
  return { view, tab };
}

/** Канонический адрес раздела. У каждого раздела он свой и стабильный. */
function routeToHash(view, tab) {
  const spec = ROUTES[view];
  if (spec?.tabs && tab) return `#${view}?tab=${tab}`;
  return `#${view}`;
}

/**
 * Приводит запрошенный раздел к разрешённому: неизвестный маршрут и раздел
 * без прав одинаково уходят на стартовый экран роли.
 */
function resolveRoute(view, tab) {
  const role = STATE.user?.role;
  const parsed = LEGACY_COIN_VIEW_TAB[view] ? { view: 'coins', tab: LEGACY_COIN_VIEW_TAB[view] } : { view, tab };
  let target = parsed.view;

  if (!isKnownRoute(target)) target = fallbackViewForRole(role);
  if (role && !allowedViewsForRole(role).includes(target)) target = fallbackViewForRole(role);

  const spec = ROUTES[target];
  const nextTab = spec?.normalizeTab
    ? spec.normalizeTab(parsed.tab || (target === STATE.currentView ? STATE.coinsTab : ''))
    : '';
  return { view: target, tab: nextTab };
}

/** Стартовый маршрут: адресная строка → сохранённый раздел → дефолт роли. */
function initialRouteForRole(role) {
  const fromPath = parseRoute(location.pathname + location.search);
  if (fromPath.view && isKnownRoute(parseRoute(fromPath.view).view)) return fromPath;

  const fromHash = parseRoute(location.hash);
  if (fromHash.view) return fromHash;

  const saved = parseRoute(localStorage.getItem('pulse-last-view'));
  if (saved.view) return saved;

  return { view: fallbackViewForRole(role), tab: '' };
}

/* ══════════════════════════════════════
   ГЛОБАЛЬНЫЙ ПЕРЕХВАТ ОШИБОК

   Ошибка, не пойманная ни одним разделом, раньше просто уходила в консоль:
   пользователь видел пустой или наполовину отрисованный экран и не понимал,
   что произошло. Теперь она попадает в лог и показывается тостом — экран
   при этом остаётся рабочим, из него можно уйти в другой раздел.
══════════════════════════════════════ */
let _lastGlobalErrorAt = 0;

function reportGlobalError(source, error) {
  console.error(`[global:${source}]`, error);
  // Одна ошибка нередко порождает каскад — не заваливаем экран тостами.
  const now = Date.now();
  if (now - _lastGlobalErrorAt < 4000) return;
  _lastGlobalErrorAt = now;
  const message = error?.message || String(error || 'Неизвестная ошибка');
  if (typeof showToast === 'function') {
    showToast(`Что-то пошло не так: ${message}`, 'error');
  }
}

window.addEventListener('error', event => {
  reportGlobalError('error', event.error || event.message);
});

window.addEventListener('unhandledrejection', event => {
  reportGlobalError('promise', event.reason);
});

/* ══════════════════════════════════════
   BOOT
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initNav();
  // Cookie-auth: always call /api/auth/me to check session
  // No localStorage check needed — token lives in HttpOnly cookie
  await tryRestoreSession();
});

/**
 * Любое изменение адреса браузером — Back, Forward, правка hash руками —
 * приводит экран в соответствие с URL. Слушаем оба события: popstate ловит
 * переходы по истории, hashchange — ручную правку адреса. Оба могут прийти
 * на один переход, поэтому повторное применение того же маршрута отсекается.
 */
function syncRouteFromUrl() {
  if (!STATE.user?.role) return;
  const requested = parseRoute(location.hash);
  const resolved = resolveRoute(requested.view, requested.tab);
  const sameView = resolved.view === STATE.currentView;
  const sameTab = !ROUTES[resolved.view]?.tabs || resolved.tab === STATE.coinsTab;
  if (sameView && sameTab) return;
  navigateTo(resolved.view, { tab: resolved.tab, history: false });
}

window.addEventListener('popstate', syncRouteFromUrl);
window.addEventListener('hashchange', syncRouteFromUrl);

async function tryRestoreSession() {
  try {
    const u = await api.me();
    STATE.user = normalizeUser(u);
    await bootApp();
  } catch(err) {
    const msg = String(err?.message || '').toLowerCase();
    const isAuthError = err?.status === 401 || err?.status === 403 ||
      msg.includes('401') || msg.includes('403') ||
      msg.includes('unauthorized') || msg.includes('авторизац') ||
      msg.includes('токен') || msg.includes('forbidden');
    if (isAuthError) {
      clearSessionUiState();
      showAuth();
    } else {
      const shell = document.getElementById('app-shell');
      if (shell) shell.innerHTML = `
        <div class="loading-state" style="gap:20px">
          <p style="color:var(--danger)">Ошибка подключения: ${esc(err.message)}</p>
          <button class="btn-primary" onclick="tryRestoreSession()">Повторить</button>
        </div>`;
    }
  }
}

function normalizeUser(u) {
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role: u.role,
    operator_id: u.operator_id,
    can_manage_operators: Boolean(u.can_manage_operators),
    must_change_password: Boolean(u.must_change_password),
  };
}

/* ══════════════════════════════════════
   THEME
══════════════════════════════════════ */
function initTheme() {
  const saved = localStorage.getItem('pulse-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('pulse-theme', next);
  });
}

/* ══════════════════════════════════════
   NAV
══════════════════════════════════════ */
function initNav() {
  const sideNav = document.querySelector('.side-nav');
  if (sideNav && !sideNav.id) sideNav.id = 'primary-navigation';
  if (sideNav && !document.getElementById('mobile-nav-toggle')) {
    const mobileToggle = document.createElement('button');
    mobileToggle.id = 'mobile-nav-toggle';
    mobileToggle.className = 'mobile-nav-toggle';
    mobileToggle.type = 'button';
    mobileToggle.setAttribute('aria-controls', sideNav.id);
    mobileToggle.setAttribute('aria-expanded', 'false');
    mobileToggle.setAttribute('aria-label', 'Открыть навигацию');
    mobileToggle.innerHTML = '<span aria-hidden="true">☰</span><b>Puls.</b>';

    const backdrop = document.createElement('button');
    backdrop.className = 'mobile-nav-backdrop';
    backdrop.type = 'button';
    backdrop.setAttribute('aria-label', 'Закрыть навигацию');

    const setMobileNav = open => {
      document.body.classList.toggle('mobile-nav-open', open);
      mobileToggle.setAttribute('aria-expanded', String(open));
      mobileToggle.setAttribute('aria-label', open ? 'Закрыть навигацию' : 'Открыть навигацию');
      // Открыли — уводим фокус внутрь, иначе с клавиатуры панель недостижима:
      // Tab продолжал обходить страницу под затемнением. Закрыли — возвращаем
      // фокус на кнопку, чтобы не терять место в обходе.
      if (open) sideNav.querySelector('.side-nav-link')?.focus({ preventScroll: true });
      else if (sideNav.contains(document.activeElement)) mobileToggle.focus({ preventScroll: true });
    };
    mobileToggle.addEventListener('click', () => setMobileNav(!document.body.classList.contains('mobile-nav-open')));
    backdrop.addEventListener('click', () => setMobileNav(false));

    // Escape закрывает панель — как и любой другой слой поверх страницы.
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!document.body.classList.contains('mobile-nav-open')) return;
      event.preventDefault();
      setMobileNav(false);
    });

    // Tab не выпускает фокус из открытой панели.
    sideNav.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      if (!document.body.classList.contains('mobile-nav-open')) return;
      const items = [...sideNav.querySelectorAll('a[href], button:not([disabled])')]
        .filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    document.body.append(mobileToggle, backdrop);
  }
  document.querySelectorAll('.side-nav-link[data-nav-target]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      document.body.classList.remove('mobile-nav-open');
      document.getElementById('mobile-nav-toggle')?.setAttribute('aria-expanded', 'false');
      navigateTo(link.dataset.navTarget);
    });
  });
  const toggle = document.getElementById('side-nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      document.body.classList.toggle('side-nav-collapsed');
      localStorage.setItem('nav-collapsed', document.body.classList.contains('side-nav-collapsed'));
    });
    if (localStorage.getItem('nav-collapsed') === 'true') {
      document.body.classList.add('side-nav-collapsed');
    }
  }
}

// Кеш отрендеренных разделов — не перерисовываем если уже есть актуальный HTML
const VIEW_CACHE = {};
const VIEW_CACHE_SKIP = new Set(['analytics', 'period-report', 'wheel', 'sessions', 'tests', 'missions']); // эти разделы всегда рендерим заново
let _viewAbortController = new AbortController();
let _routeInitialized = false;

function currentViewSignal() {
  return _viewAbortController.signal;
}

function invalidateViewCache(view) {
  if (view) delete VIEW_CACHE[view];
  else Object.keys(VIEW_CACHE).forEach(k => delete VIEW_CACHE[k]);
}

// Вызывается после обновления данных — сбрасываем кеш затронутых разделов
function onDataUpdated(views) {
  (views || ['rating','cabinet','summary','operators','coins']).forEach(v => invalidateViewCache(v));
}

function navigateTo(view, options = {}) {
  const { view: target, tab } = resolveRoute(view, options.tab);

  if (
    STATE.currentView === 'missions'
    && target !== 'missions'
    && typeof missionViewController !== 'undefined'
  ) {
    missionViewController.dispose();
  }

  STATE.currentView = target;
  if (ROUTES[target]?.tabs) STATE.coinsTab = tab;
  _viewAbortController.abort();
  _viewAbortController = new AbortController();
  bumpNavGen(); // отменяет все ещё не завершённые рендеры предыдущих разделов

  // Адрес — единственный источник правды о текущем экране. Все разделы
  // (включая «Коины») живут в hash, поэтому F5, копирование ссылки и
  // открытие в новой вкладке ведут себя одинаково.
  const hash = routeToHash(target, tab);
  const canonicalUrl = `${location.pathname}${location.search}${hash}`;
  if (options.history === false) {
    // Переход инициировал сам браузер — историю не трогаем, только
    // выравниваем адрес, если запрошенный маршрут пришлось заменить.
    if (location.hash !== hash) history.replaceState(null, '', canonicalUrl);
  } else {
    const method = (!_routeInitialized || location.hash === hash) ? 'replaceState' : 'pushState';
    history[method](null, '', canonicalUrl);
  }
  _routeInitialized = true;

  try { localStorage.setItem('pulse-last-view', hash.slice(1)); } catch (e) { /* приватный режим */ }

  document.title = `${ROUTES[target]?.title || 'Puls'} · ${APP_TITLE}`;

  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.side-nav-link[data-nav-target]').forEach(l => {
    const linkTarget = LEGACY_COIN_VIEW_TAB[l.dataset.navTarget] ? 'coins' : l.dataset.navTarget;
    const active = linkTarget === target;
    l.classList.toggle('active', active);
    // Скринридер должен слышать, какой раздел открыт, а не догадываться по цвету.
    if (active) l.setAttribute('aria-current', 'page');
    else l.removeAttribute('aria-current');
  });

  const el = document.getElementById(`view-${target}`);
  if (el) el.classList.add('active');
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  document.querySelectorAll('.table-wrap, .an-table-scroll, [data-view-scroll]').forEach(node => {
    node.scrollTop = 0;
    node.scrollLeft = 0;
  });
  renderView(target);
  focusCurrentViewHeading(target);
}

/**
 * Отрисовка раздела через реестр, обёрнутая в error boundary.
 *
 * Раньше сбой внутри любой render-функции оставлял пустой контейнер: именно
 * так выглядела ошибка `RATING_TABS is not defined` — белый экран без единой
 * подсказки. Теперь ошибка одного раздела показывает объяснимое состояние с
 * повторной попыткой и не мешает уйти в другие разделы.
 */
function renderView(view) {
  const spec = ROUTES[view];
  if (!spec) return;
  try {
    const result = spec.render();
    // Асинхронные вьюхи возвращают промис — его отказ тоже наш.
    if (result && typeof result.catch === 'function') {
      result.catch(error => showViewError(view, error));
    }
  } catch (error) {
    showViewError(view, error);
  }
}

/** Понятный экран вместо пустоты, когда раздел не смог отрисоваться. */
function showViewError(view, error) {
  console.error(`[view:${view}] ошибка отрисовки`, error);
  const host = document.getElementById(`view-${view}`);
  if (!host) return;
  const title = ROUTES[view]?.title || 'Раздел';
  const requestId = error?.requestId || error?.request_id || '';
  host.innerHTML = `
    <div class="view-header">
      <div><h1 class="section-title">${esc(title)}</h1></div>
    </div>
    <div class="state-block state-error" role="alert">
      <div class="state-icon" aria-hidden="true">!</div>
      <h2 class="state-title">Раздел не открылся</h2>
      <p class="state-text">Мы не смогли построить эту страницу. Данные не пострадали —
      можно повторить попытку или перейти в другой раздел.</p>
      <p class="state-detail">${esc(error?.message || 'Неизвестная ошибка')}</p>
      ${requestId ? `<p class="state-meta">Код обращения: <code>${esc(requestId)}</code></p>` : ''}
      <div class="state-actions">
        <button class="btn-primary" type="button" data-view-retry="${esc(view)}">Повторить</button>
      </div>
    </div>`;
  host.querySelector('[data-view-retry]')?.addEventListener('click', () => {
    invalidateViewCache(view);
    renderView(view);
  });
}

function focusCurrentViewHeading(view) {
  const focusHeading = () => {
    const host = document.getElementById(`view-${view}`);
    if (!host?.classList.contains('active')) return;
    const heading = host.querySelector('h1, .section-title, h2');
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  };
  requestAnimationFrame(focusHeading);
  setTimeout(focusHeading, 120);
}

// После рендера сохраняем HTML в кеш
function _cacheViewHtml(view) {
  if (VIEW_CACHE_SKIP.has(view)) return;
  const el = document.getElementById(`view-${view}`);
  if (el) VIEW_CACHE[view] = el.innerHTML;
}

// Восстановление слушателей после кеша — для разделов с динамикой
function _reattachViewListeners(view, el) {
  // Рейтинг: запускаем динамику если есть dyn-body
  if (view === 'rating') {
    const dynBox = el.querySelector('#dyn-body');
    if (dynBox && window._setDynModeInternal) {
      // Блок динамики уже отрендерен — просто убедимся что данные свежие
      if (typeof loadDynCard !== 'undefined') setTimeout(() => loadDynCard(), 50);
    }
  }
}

/* ══════════════════════════════════════
   AUTH
══════════════════════════════════════ */
function showAuth() {
  document.getElementById('auth-overlay')?.removeAttribute('hidden');
  document.body.classList.add('operator-login-required');
}
function hideAuth() {
  document.getElementById('auth-overlay')?.setAttribute('hidden', '');
  document.body.classList.remove('operator-login-required');
}

let _authExpiredHandled = false;
function clearSessionUiState() {
  STATE.user = null;
  STATE.wallet = null;
  STATE.myLevel = null;
  STATE.myOperator = null;
  invalidateViewCache();
  try {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith(SWR_PREFIX))
      .forEach(k => sessionStorage.removeItem(k));
  } catch(e) { /* ignore */ }
  document.body.classList.remove('role-admin', 'role-manager', 'role-operator');
  document.body.classList.add('role-pending');
}

function handleAuthExpired(err) {
  if (_authExpiredHandled || !STATE.user) return;
  _authExpiredHandled = true;
  clearSessionUiState();
  showAuth();
  const errEl = document.getElementById('auth-error');
  if (errEl) {
    errEl.textContent = 'Сессия была сброшена администратором. Войдите снова.';
  }
  const username = document.getElementById('auth-username');
  if (username) setTimeout(() => username.focus(), 50);
  // Браузер мог подставить сохранённые логин и пароль — событие input при
  // этом не приходит, поэтому состояние кнопки пересчитываем сами.
  setTimeout(syncAuthSubmit, 60);
}
window.handleAuthExpired = handleAuthExpired;

/**
 * Кнопка входа доступна только когда оба поля заполнены. Слушатель
 * делегированный: форма входа появляется и скрывается вместе с оверлеем,
 * и привязываться к конкретным узлам ненадёжно.
 */
function syncAuthSubmit() {
  const btn = document.getElementById('auth-login-btn');
  if (!btn || btn.classList.contains('is-loading')) return;
  const username = document.getElementById('auth-username')?.value?.trim();
  const password = document.getElementById('auth-password')?.value;
  btn.disabled = !(username && password);
}

document.addEventListener('input', event => {
  if (event.target.id === 'auth-username' || event.target.id === 'auth-password') syncAuthSubmit();
});

document.addEventListener('click', async e => {
  // Показать/скрыть пароль: в скрытом поле опечатку не найти.
  const toggle = e.target.closest?.('#auth-password-toggle');
  if (toggle) {
    const field = document.getElementById('auth-password');
    if (field) {
      const shown = field.type === 'text';
      field.type = shown ? 'password' : 'text';
      toggle.setAttribute('aria-pressed', String(!shown));
      const label = shown ? 'Показать пароль' : 'Скрыть пароль';
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('title', label);
      field.focus({ preventScroll: true });
    }
    return;
  }

  if (e.target.id === 'auth-login-btn') {
    const username = document.getElementById('auth-username')?.value?.trim();
    const password = document.getElementById('auth-password')?.value;
    const errEl = document.getElementById('auth-error');
    if (!username || !password) { if (errEl) errEl.textContent = 'Введите логин и пароль'; return; }
    if (errEl) errEl.textContent = '';
    // Ширина кнопки не меняется: спиннер рисуется поверх текста.
    e.target.disabled = true;
    e.target.classList.add('is-loading');
    try {
      await api.login(username, password);
      STATE.user = normalizeUser(await api.me());
      _authExpiredHandled = false;
      hideAuth();
      await bootApp();
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
      e.target.classList.remove('is-loading');
      syncAuthSubmit();
    } finally {
      e.target.classList.remove('is-loading');
    }
  }
  if (e.target.id === 'auth-logout-btn') {
    logoutAndReload();
  }
});

/* ══════════════════════════════════════
   BOOT APP
══════════════════════════════════════ */
async function bootApp() {
  const role = STATE.user?.role;
  // Снимаем "role-pending" (скрывал admin-ссылки по умолчанию, чтобы не мигали
  // на F5 до подтверждения роли) и ставим точный класс роли для CSS (ширина сайдбара и т.п.)
  document.body.classList.remove('role-pending');
  document.body.classList.toggle('role-admin', isAdmin(role));
  document.body.classList.toggle('role-operator', !isAdmin(role));
  buildViews(role);
  renderSidebar(role);
  const displayName = STATE.user?.full_name || STATE.user?.username || '';
  setText('side-user', displayName);
  // Роль не повторяем, если она дословно совпадает с именем: у учётной записи
  // «Администратор» под именем стояла та же надпись ещё раз.
  const roleText = roleLabel(role);
  const roleEl = document.getElementById('side-role');
  if (roleEl) {
    const duplicate = roleText.trim().toLowerCase() === displayName.trim().toLowerCase();
    roleEl.textContent = duplicate ? '' : roleText;
    roleEl.hidden = duplicate;
  }
  // Уровень есть только у оператора: у остальных строка показывала прочерк,
  // который читался как незагруженные данные.
  setSideLevel('');
  // Update initials avatar
  (function() {
    var av = document.getElementById('side-user-avatar');
    if (!av) return;
    var name = (STATE.user?.full_name || STATE.user?.username || '?').trim();
    av.textContent = name.split(' ').filter(Boolean).slice(0,2).map(function(w){return w[0];}).join('').toUpperCase() || '?';
  })();

  if (STATE.user?.must_change_password) {
    document.body.classList.add('must-change-password');
    showForcedPasswordChangeModal();
    return;
  }
  document.body.classList.remove('must-change-password');

  await loadData(role);

  // Прогрев кеша аналитики больше не нужен: экран руководителя грузится
  // одним запросом /api/analytics/dashboard вместо полутора десятков.
  setTimeout(() => prefetchAppSectionsInBackground(role), 700);

  // Lazy preload групп
  if (isAdmin(role)) {
    setTimeout(() => {
      if (!STATE.groups?.length) api.listGroups().catch(() => []).then(g => STATE.groups = g);
    }, 2000);
  }

  // Restore last viewed section after F5 reload
  const restoredRoute = initialRouteForRole(role);
  const allowedViews = allowedViewsForRole(role);
  const defaultView = isAdmin(role) ? 'summary' : 'cabinet';
  const start = allowedViews.includes(restoredRoute.view) ? restoredRoute.view : defaultView;
  navigateTo(start, { tab: restoredRoute.tab });
}

/**
 * Загружает основные данные приложения (рейтинг, магазин, дашборд, операторы,
 * история) через SWR-кеш. После F5 эти данные сначала читаются из
 * sessionStorage (мгновенно — без ожидания сети), а свежая версия
 * подгружается в фоне и тихо обновляет STATE + перерисовывает активный
 * раздел, если данные реально изменились.
 */
async function loadData(role) {
  const onDashboardUpdate = (fresh) => {
    STATE.dashboard = fresh;
    if (STATE.currentView === 'summary') renderSummary();
  };
  const onRatingUpdate = (fresh) => {
    STATE.rating = Array.isArray(fresh) ? fresh : (fresh.items || []);
    if (STATE.currentView === 'rating') renderRating();
    if (STATE.currentView === 'cabinet') renderCabinet();
  };
  const onOperatorsUpdate = (fresh) => {
    STATE.adminOperators = fresh;
    if (STATE.currentView === 'operators') renderAdminOperators();
  };
  const onUsersUpdate = (fresh) => {
    STATE.users = Array.isArray(fresh) ? fresh : (fresh.items || []);
    if (STATE.currentView === 'operators') renderAdminOperators();
  };
  const onHistoryUpdate = (fresh) => {
    STATE.history = fresh;
    if (STATE.currentView === 'coins') renderCoins();
  };

  const tasks = [
    swrFetch('rating:list', () => api.getRating().catch(() => ({ items: [] })), onRatingUpdate, SWR_DEFAULT_TTL_MS)
      .then(r => STATE.rating = Array.isArray(r) ? r : (r.items || [])),
    swrFetch('rating:nominations', () => api._req('GET', '/api/rating/nominations').catch(() => ({ items: [] })), null, SWR_STATIC_TTL_MS)
      .then(n => STATE.nominations = n),
    swrFetch('shop:items', () => api.listShopItems().catch(() => []), null, SWR_STATIC_TTL_MS)
      .then(s => STATE.shopItems = s),
    swrFetch('levels:list', () => api.listOperatorLevels().catch(() => []), null, SWR_STATIC_TTL_MS)
      .then(levels => STATE.operatorLevels = levels),
  ];
  // myLevel и myOperator — только для операторов (у admin нет operator_id → всегда 403)
  if (role === 'operator' || role === 'supervisor') {
    tasks.push(api.myLevel().catch(() => null).then(level => {
      STATE.myLevel = level;
      setSideLevel(level?.level?.name || '');
    }));
    tasks.push(api.myOperator().catch(() => null).then(op => { STATE.myOperator = op; }));
  }
  if (role === 'operator') {
    tasks.push(api.myWallet().catch(() => null).then(w => STATE.wallet = w)); // личный баланс — всегда свежий, без кеша
    tasks.push(api.listPurchases().catch(() => []).then(p => STATE.purchases = p));
    tasks.push(api.listShopDiscounts().catch(() => []).then(c => STATE.shopDiscounts = c));
  }
  if (isAdmin(role)) {
    tasks.push(
      swrFetch('dashboard:main', () => api.getDashboard().catch(() => null), onDashboardUpdate, SWR_DEFAULT_TTL_MS)
        .then(d => STATE.dashboard = d)
    );
    tasks.push(
      swrFetch('dashboard:operators', () =>
        api.getDashboardOperators().catch(() => []),
        onOperatorsUpdate, SWR_USER_TTL_MS
      ).then(o => STATE.adminOperators = o)
    );
    tasks.push(
      swrFetch('users:list', () =>
        api.listUsers({ limit: 200 }).catch(err => {
          console.error('[users:list] ошибка загрузки:', err?.message || err);
          return { items: [] };
        }),
        onUsersUpdate, SWR_USER_TTL_MS
      ).then(u => STATE.users = Array.isArray(u) ? u : (u.items || []))
    );
    // История транзакций — грузим лениво, не блокируем загрузку
    swrFetch('dashboard:history', () =>
      api.getDashboardHistory(50).catch(() => []),
      onHistoryUpdate
    ).then(h => { STATE.history = h; });
  }
  await Promise.all(tasks);
  refreshNotificationBadge();
  startNotificationPolling();
}

async function runWarmupQueue(tasks, gapMs = 140) {
  for (const task of tasks) {
    try { await Promise.resolve(task()); } catch(e) { /* warmup is best-effort */ }
    await new Promise(resolve => setTimeout(resolve, gapMs));
  }
}

function prefetchAppSectionsInBackground(role) {
  const admin = isAdmin(role);
  const tasks = [
    () => swrFetch('shop:items', () => api.listShopItems(), null, SWR_STATIC_TTL_MS),
    () => swrFetch('rating:list', () => api.getRating(), null, SWR_DEFAULT_TTL_MS),
    () => swrFetch('rating:nominations', () => api._req('GET', '/api/rating/nominations'), null, SWR_STATIC_TTL_MS),
    () => swrFetch('levels:list', () => api.listOperatorLevels(), null, SWR_STATIC_TTL_MS),
  ];

  if (role === 'operator' || role === 'supervisor') {
    tasks.push(
      () => swrFetch('cabinet:me', () => api.getMyCabinet(), null, SWR_FAST_TTL_MS),
      () => swrFetch('wallet:me', () => api.myWallet(), null, SWR_FAST_TTL_MS),
      () => swrFetch('shop:purchases:me', () => api.listPurchases(), null, SWR_FAST_TTL_MS),
      () => swrFetch('wheel:status', () => api.getWheelStatus(), null, SWR_FAST_TTL_MS),
      () => swrFetch('wheel:prizes', () => api.getWheelPrizes(), null, SWR_STATIC_TTL_MS),
      () => swrFetch('wheel:my-history', () => api.getWheelMyHistory(), null, SWR_FAST_TTL_MS),
      () => swrFetch('tests:my', () => api.myTests(), null, SWR_FAST_TTL_MS),
      () => swrFetch('missions:map', () => api.getMissions(), null, SWR_FAST_TTL_MS),
      () => swrFetch('raffles:me', () => api.getMyRaffles(), null, SWR_FAST_TTL_MS),
    );
  }

  if (role === 'operator') {
    tasks.push(() => swrFetch('shop:discounts:me', () => api.listShopDiscounts(), null, SWR_FAST_TTL_MS));
  }

  if (admin) {
    tasks.push(
      () => swrFetch('dashboard:main', () => api.getDashboard(), null, SWR_DEFAULT_TTL_MS),
      () => swrFetch('dashboard:operators', () => api.getDashboardOperators(), null, SWR_USER_TTL_MS),
      () => swrFetch('users:list', () => api.listUsers({ limit: 200 }), null, SWR_USER_TTL_MS),
      () => swrFetch('groups:list', () => api.listGroups(false), null, SWR_STATIC_TTL_MS),
      () => swrFetch('groups:active', () => api.listGroups(true), null, SWR_STATIC_TTL_MS),
      () => swrFetch('admin-summary:', () => api.getAdminSummary({}), null, SWR_FAST_TTL_MS),
      () => swrFetch('achievements:list', () => api.listAchievements(), null, SWR_STATIC_TTL_MS),
      () => swrFetch('levels:admin', () => api.listAdminOperatorLevels(), null, SWR_STATIC_TTL_MS),
      () => swrFetch('levels:rewards', () => api.listOperatorLevelRewards(), null, SWR_FAST_TTL_MS),
      () => swrFetch('coin-rules:settings', () => api.getCoinRulesSettings(), null, SWR_STATIC_TTL_MS),
      () => swrFetch('coins:overview', () => api.getCoinsOverview(), null, SWR_DEFAULT_TTL_MS),
      () => swrFetch('coins:requests:new', () => api.listCoinRequests({ status: 'new', limit: 20 }), null, SWR_FAST_TTL_MS),
      () => swrFetch('coins:transactions:latest', () => api.listCoinTransactions({ limit: 50 }), null, SWR_FAST_TTL_MS),
      () => swrFetch('period-report:status', () => api.getPeriodReportStatus(), null, SWR_FAST_TTL_MS),
      () => swrFetch('wheel:admin:campaigns', () => api.getWheelCampaigns(), null, SWR_STATIC_TTL_MS),
      () => swrFetch('wheel:admin:prizes', () => api.getWheelAdminPrizes(), null, SWR_STATIC_TTL_MS),
      () => swrFetch('wheel:admin:rules', () => api.getWheelRules(), null, SWR_STATIC_TTL_MS),
      () => swrFetch('wheel:admin:spins', () => api.getWheelSpins({ limit: 80 }), null, SWR_FAST_TTL_MS),
      () => swrFetch('wheel:admin:stats', () => api.getWheelStats(), null, SWR_FAST_TTL_MS),
      () => swrFetch('tests:admin-list', () => api.listAdminTests(), null, SWR_FAST_TTL_MS),
      () => swrFetch('missions:admin-stats', () => api.getMissionStats(), null, SWR_FAST_TTL_MS),
      () => swrFetch('raffles:admin', () => api.listRafflesAdmin(), null, SWR_FAST_TTL_MS),
      () => swrFetch('sessions:list:active:all:all:', () => api.listSessions({ status: 'active', q: '', role: 'all', device: 'all', limit: 250 }), null, SWR_FAST_TTL_MS),
    );
  }

  runWarmupQueue(tasks);
}

async function reloadData() {
  invalidateViewCache(); // данные изменились — все разделы нужно перерисовать
  await loadData(STATE.user?.role);
  renderView(STATE.currentView);
}

/* ══════════════════════════════════════
   BUILD VIEWS
══════════════════════════════════════ */
function buildViews(role) {
  const shell = document.getElementById('app-shell');
  if (!shell) return;
  const views = allowedViewsForRole(role);
  shell.innerHTML = views.map(v => `<section class="app-view" id="view-${v}"></section>`).join('');
}

function renderSidebar(role) {
  const allowedViews = new Set(allowedViewsForRole(role));
  document.querySelectorAll('.side-nav-link[data-nav-target]').forEach(link => {
    const t = link.dataset.navTarget;
    link.style.display = allowedViews.has(t) ? '' : 'none';
  });
}

/* ══════════════════════════════════════
   VIEW: УРОВНИ ОПЕРАТОРОВ
══════════════════════════════════════ */
