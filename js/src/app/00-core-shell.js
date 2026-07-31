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

function levelBadgeHtml(level, extraClass = '') {
  if (!level) return '<span class="cell-muted">—</span>';
  const color = level.color || '#64748B';
  return `<span class="level-badge ${extraClass}" style="--level-color:${esc(color)};border-color:${esc(color)};color:${esc(color)};background:${esc(color)}16">${esc(level.name || 'Стажёр')}</span>`;
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
const LEGACY_COIN_VIEW_TAB = { accrual: 'accrual', manual: 'accrual', requests: 'requests', history: 'history' };

function normalizeCoinTab(tab) {
  if (tab === 'manual') return 'accrual';
  return COIN_TABS.includes(tab) ? tab : 'overview';
}

function parseStoredView(value) {
  if (!value) return { view: '', tab: '' };
  const clean = String(value).replace(/^#/, '');
  const [view, query = ''] = clean.split('?');
  const params = new URLSearchParams(query);
  return { view, tab: params.get('tab') || '' };
}

function allowedViewsForRole(role) {
  if (!isAdmin(role)) return ['cabinet', 'rating', 'missions', 'tests', 'shop', 'wheel', 'raffles'];

  const views = ['summary', 'operators', 'coins', 'shop', 'wheel', 'raffles', 'tests', 'missions', 'period-report', 'analytics'];
  views.push('rating');
  if (role === 'supervisor') views.push('cabinet');
  if (role === 'manager' || role === 'admin') views.push('operator-levels');
  if (canManageGroups(role)) views.push('groups');
  if (role === 'admin') views.push('sessions', 'cabinet');
  return views;
}

function initialRouteForRole(role) {
  const path = location.pathname.replace(/^\/+|\/+$/g, '');
  const params = new URLSearchParams(location.search);
  if (path === 'coins') return { view: 'coins', tab: normalizeCoinTab(params.get('tab')) };
  if (path === 'accrual') return { view: 'coins', tab: 'accrual' };
  if (path === 'requests') return { view: 'coins', tab: 'requests' };
  if (path === 'history') return { view: 'coins', tab: 'history' };

  const hashRoute = parseStoredView(location.hash);
  if (hashRoute.view === 'coins') return { view: 'coins', tab: normalizeCoinTab(hashRoute.tab) };
  if (LEGACY_COIN_VIEW_TAB[hashRoute.view]) return { view: 'coins', tab: LEGACY_COIN_VIEW_TAB[hashRoute.view] };
  // ВАЖНО: до сих пор здесь обрабатывался только частный случай 'coins' —
  // любой другой раздел (rating, shop, tests, ...) из hash игнорировался,
  // и F5 всегда откатывал на дефолтный раздел. Теперь любой непустой view
  // из hash восстанавливается как есть.
  if (hashRoute.view) return { view: hashRoute.view, tab: hashRoute.tab };

  const savedRoute = parseStoredView(localStorage.getItem('pulse-last-view'));
  if (savedRoute.view === 'coins') return { view: 'coins', tab: normalizeCoinTab(savedRoute.tab) };
  if (LEGACY_COIN_VIEW_TAB[savedRoute.view]) return { view: 'coins', tab: LEGACY_COIN_VIEW_TAB[savedRoute.view] };
  // То же самое для localStorage-фоллбэка (срабатывает, когда hash пуст,
  // например при заходе по чистому "/" без сохранённого hash в адресной строке).
  if (savedRoute.view) return { view: savedRoute.view, tab: savedRoute.tab };

  return { view: isAdmin(role) ? 'summary' : 'cabinet', tab: '' };
}

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

// Every browser-driven route change goes through the same role guard as sidebar
// navigation. This also prevents a restricted hash from exposing an empty or
// stale administrative view after Back/Forward navigation.
let _browserRouteSyncQueued = false;

function queueBrowserRouteSync(requestedRoute = null) {
  if (_browserRouteSyncQueued) return;
  _browserRouteSyncQueued = true;
  queueMicrotask(() => {
    _browserRouteSyncQueued = false;
    const role = STATE.user?.role;
    if (!role) return;
    const path = location.pathname.replace(/^\/+|\/+$/g, '');
    const requested = requestedRoute || (path === 'coins'
      ? { view: 'coins', tab: normalizeCoinTab(new URLSearchParams(location.search).get('tab')) }
      : parseStoredView(location.hash));
    const fallback = isAdmin(role) ? 'summary' : 'cabinet';
    const view = allowedViewsForRole(role).includes(requested.view) ? requested.view : fallback;
    navigateTo(view, { tab: requested.tab, history: false });
  });
}

window.addEventListener('hashchange', () => {
  const role = STATE.user?.role;
  if (!role) return;
  const requested = parseStoredView(location.hash);
  const fallback = isAdmin(role) ? 'summary' : 'cabinet';
  const view = allowedViewsForRole(role).includes(requested.view)
    ? requested.view
    : fallback;
  queueBrowserRouteSync({ view, tab: requested.tab });
});

window.addEventListener('popstate', () => {
  queueBrowserRouteSync();
});

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
      if (shell) {
        shell.innerHTML = uiErrorState(
          'Не удалось подключиться',
          uiErrorMessage(err, 'Проверьте соединение и повторите попытку.'),
          '<button class="btn-primary" id="restore-session-retry" type="button">Повторить</button>',
        );
        shell.querySelector('#restore-session-retry')?.addEventListener('click', tryRestoreSession, { once: true });
      }
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
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const saved = localStorage.getItem('pulse-theme');
  const initial = saved === 'dark' || saved === 'light'
    ? saved
    : (media?.matches ? 'dark' : 'light');
  applyTheme(initial, saved ? 'manual' : 'system');
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  media?.addEventListener?.('change', event => {
    if (!localStorage.getItem('pulse-theme')) applyTheme(event.matches ? 'dark' : 'light', 'system');
  });
}

function applyTheme(theme, source = 'manual') {
  const value = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', value);
  document.documentElement.dataset.themeSource = source;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = value === 'dark' ? '#000000' : '#F2F2F7';
  document.querySelectorAll('[data-theme-label]').forEach(node => {
    node.textContent = value === 'dark' ? 'Тёмная тема' : 'Светлая тема';
  });
}

function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = dark ? 'light' : 'dark';
  localStorage.setItem('pulse-theme', next);
  applyTheme(next, 'manual');
}

/* ══════════════════════════════════════
   NAV
══════════════════════════════════════ */
function initNav() {
  const sideNav = document.querySelector('.side-nav');
  if (sideNav && !sideNav.id) sideNav.id = 'primary-navigation';
  document.querySelectorAll('.side-nav-link[data-nav-target]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
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

  document.getElementById('side-bell-btn')?.addEventListener('click', () => showNotificationsModal());
  document.getElementById('side-settings-btn')?.addEventListener('click', () => showAccountSettingsModal());
  document.getElementById('mobile-more-close')?.addEventListener('click', () => setMobileMoreOpen(false));
  document.getElementById('mobile-more-backdrop')?.addEventListener('click', () => setMobileMoreOpen(false));
  document.getElementById('mobile-tab-bar')?.addEventListener('click', event => {
    const button = event.target.closest('[data-mobile-nav-target], [data-mobile-more]');
    if (!button) return;
    if (button.hasAttribute('data-mobile-more')) setMobileMoreOpen(true, button);
    else navigateTo(button.dataset.mobileNavTarget);
  });
  document.getElementById('mobile-more-sheet')?.addEventListener('click', event => {
    const nav = event.target.closest('[data-mobile-nav-target]');
    const action = event.target.closest('[data-mobile-account-action]');
    if (nav) {
      setMobileMoreOpen(false);
      navigateTo(nav.dataset.mobileNavTarget);
    } else if (action?.dataset.mobileAccountAction === 'theme') {
      toggleTheme();
    } else if (action?.dataset.mobileAccountAction === 'settings') {
      setMobileMoreOpen(false);
      showAccountSettingsModal();
    } else if (action?.dataset.mobileAccountAction === 'notifications') {
      setMobileMoreOpen(false);
      showNotificationsModal();
    } else if (action?.dataset.mobileAccountAction === 'logout') {
      setMobileMoreOpen(false);
      logoutAndReload();
    }
  });
}

let _mobileMoreTrigger = null;

function mobilePrimaryViews(role) {
  return isAdmin(role)
    ? ['summary', 'operators', 'analytics', 'coins']
    : ['cabinet', 'rating', 'missions', 'shop'];
}

function navButtonContent(view) {
  const source = document.querySelector(`.side-nav-link[data-nav-target="${view}"]`);
  const label = source?.querySelector('span')?.textContent?.trim() || view;
  const icon = source?.querySelector('svg')?.outerHTML || '';
  return { label, icon };
}

function buildMobileNavigation(role) {
  const bar = document.getElementById('mobile-tab-bar');
  const moreLinks = document.getElementById('mobile-more-links');
  const account = document.getElementById('mobile-more-account');
  if (!bar || !moreLinks || !account) return;
  const allowed = allowedViewsForRole(role);
  const primary = mobilePrimaryViews(role).filter(view => allowed.includes(view)).slice(0, 4);
  const secondary = allowed.filter(view => !primary.includes(view));
  bar.innerHTML = primary.map(view => {
    const { label, icon } = navButtonContent(view);
    return `<button type="button" data-mobile-nav-target="${view}" aria-label="${esc(label)}">${icon}<span>${esc(label)}</span></button>`;
  }).join('') + `<button type="button" data-mobile-more aria-haspopup="dialog" aria-controls="mobile-more-sheet">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg><span>Ещё</span>
  </button>`;
  moreLinks.innerHTML = secondary.map(view => {
    const { label, icon } = navButtonContent(view);
    return `<button type="button" data-mobile-nav-target="${view}">${icon}<span>${esc(label)}</span><svg class="mobile-more-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>`;
  }).join('');
  account.innerHTML = `
    <div class="mobile-account-summary"><span class="side-user-avatar">${esc(userInitials())}</span><div><strong>${esc(STATE.user?.full_name || STATE.user?.username || 'Профиль')}</strong><small>${esc(roleLabel(role))}</small></div></div>
    <button type="button" data-mobile-account-action="notifications"><span>Уведомления</span><small>Новые события и награды</small></button>
    <button type="button" data-mobile-account-action="settings"><span>Профиль и настройки</span><small>Пароль, данные аккаунта и тема</small></button>
    <button type="button" data-mobile-account-action="theme"><span data-theme-label>${document.documentElement.dataset.theme === 'dark' ? 'Тёмная тема' : 'Светлая тема'}</span><small>Изменить оформление</small></button>
    <button type="button" class="is-destructive" data-mobile-account-action="logout"><span>Выйти</span><small>Завершить текущую сессию</small></button>`;
  bar.hidden = false;
  syncMobileNavigation(STATE.currentView);
}

function userInitials() {
  return String(STATE.user?.full_name || STATE.user?.username || '?')
    .trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
}

function syncMobileNavigation(view) {
  const bar = document.getElementById('mobile-tab-bar');
  if (!bar) return;
  let directMatch = false;
  bar.querySelectorAll('[data-mobile-nav-target]').forEach(button => {
    const active = button.dataset.mobileNavTarget === view;
    directMatch ||= active;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  bar.querySelector('[data-mobile-more]')?.classList.toggle('active', !directMatch);
  document.querySelectorAll('#mobile-more-links [data-mobile-nav-target]').forEach(button => {
    const active = button.dataset.mobileNavTarget === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function setMobileMoreOpen(open, trigger = null) {
  const sheet = document.getElementById('mobile-more-sheet');
  const backdrop = document.getElementById('mobile-more-backdrop');
  if (!sheet || !backdrop) return;
  if (open) {
    _mobileMoreTrigger = trigger || document.activeElement;
    sheet.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add('mobile-more-open');
    document.getElementById('mobile-more-close')?.focus();
  } else {
    document.body.classList.remove('mobile-more-open');
    sheet.hidden = true;
    backdrop.hidden = true;
    _mobileMoreTrigger?.focus?.();
    _mobileMoreTrigger = null;
  }
}

// Уже открытые разделы остаются в DOM. Повторная навигация только показывает
// сохранённое представление; invalidateViewCache помечает его для перерендера.
const VIEW_CACHE = {};
const VIEW_RENDERED = new Set();
const VIEW_RENDER_KEYS = new Map();
let _viewAbortController = new AbortController();
let _routeInitialized = false;

function currentViewSignal() {
  return _viewAbortController.signal;
}

function invalidateViewCache(view) {
  if (view) {
    delete VIEW_CACHE[view];
    VIEW_RENDERED.delete(view);
    VIEW_RENDER_KEYS.delete(view);
  } else {
    Object.keys(VIEW_CACHE).forEach(k => delete VIEW_CACHE[k]);
    VIEW_RENDERED.clear();
    VIEW_RENDER_KEYS.clear();
  }
}

// Вызывается после обновления данных — сбрасываем кеш затронутых разделов
function onDataUpdated(views) {
  (views || ['rating','cabinet','summary','operators','coins']).forEach(v => invalidateViewCache(v));
}

function navigateTo(view, options = {}) {
  if (LEGACY_COIN_VIEW_TAB[view]) {
    options = { ...options, tab: LEGACY_COIN_VIEW_TAB[view] };
    view = 'coins';
  }
  const role = STATE.user?.role;
  if (role && !allowedViewsForRole(role).includes(view)) {
    view = isAdmin(role) ? 'summary' : 'cabinet';
    options = {};
  }
  if (
    STATE.currentView === 'missions'
    && view !== 'missions'
    && typeof missionViewController !== 'undefined'
  ) {
    missionViewController.dispose();
  }
  STATE.currentView = view;
  _viewAbortController.abort();
  _viewAbortController = new AbortController();
  if (view === 'coins') STATE.coinsTab = normalizeCoinTab(options.tab || STATE.coinsTab);
  const analyticsTab = view === 'analytics'
    ? (options.tab || (typeof _analyticsState !== 'undefined' ? _analyticsState.tab : '') || 'overview')
    : '';
  const renderKey = view === 'coins'
    ? `${view}:${STATE.coinsTab}`
    : (view === 'analytics' ? `${view}:${analyticsTab}` : view);
  bumpNavGen(); // отменяет все ещё не завершённые рендеры предыдущих разделов
  // Save to URL hash so F5 restores the same section
  let route = view === 'coins' ? `coins?tab=${STATE.coinsTab}` : view;
  if (view === 'analytics' && options.tab) route = `analytics?tab=${encodeURIComponent(options.tab)}`;
  const routeUrl = view === 'coins' ? `/${route}` : '/#' + route;
  if (options.history !== false) {
    const sameRoute = `${location.pathname}${location.hash}` === routeUrl;
    const method = !_routeInitialized || sameRoute ? 'replaceState' : 'pushState';
    history[method](null, '', routeUrl);
  }
  _routeInitialized = true;
  localStorage.setItem('pulse-last-view', route);
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.side-nav-link[data-nav-target]').forEach(l => {
    const target = LEGACY_COIN_VIEW_TAB[l.dataset.navTarget] ? 'coins' : l.dataset.navTarget;
    l.classList.toggle('active', target === view);
    if (target === view) l.setAttribute('aria-current', 'page');
    else l.removeAttribute('aria-current');
  });
  syncMobileNavigation(view);
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.add('active');
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  document.querySelectorAll('.table-wrap, .an-table-scroll, [data-view-scroll]').forEach(node => {
    node.scrollTop = 0;
    node.scrollLeft = 0;
  });
  renderView(view, renderKey);
  focusCurrentViewHeading(view);
}

function renderView(view, renderKey = view) {
  const el = document.getElementById(`view-${view}`);
  if (!el) return;
  if (VIEW_RENDERED.has(view) && VIEW_RENDER_KEYS.get(view) === renderKey && el.childElementCount) {
    _reattachViewListeners(view, el);
    return;
  }
  VIEW_RENDERED.add(view);
  VIEW_RENDER_KEYS.set(view, renderKey);

  switch (view) {
    case 'cabinet':  renderCabinet();  break;
    case 'rating':   renderRating();   break;
    case 'shop':     renderShop();     break;
    case 'summary':  renderSummary();  break;
    case 'operators': renderAdminOperators(); break;
    case 'operator-levels': renderOperatorLevelsSettings(); break;
    case 'coins':    renderCoins();    break;
    case 'wheel':    renderWheel();    break;
    case 'raffles':  renderRaffles();  break;
    case 'manual':   renderManual();   break;
    case 'requests': renderRequests(); break;
    case 'history':  renderHistory();  break;
    case 'groups':   renderGroups();   break;
    case 'period-report': renderPeriodReport(); break;
    case 'analytics': renderAnalytics(); break;
    case 'tests':    renderTests();    break;
    case 'missions': renderMissions(); break;
    case 'sessions': renderAdminSessions(); break;
  }
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
  const el = document.getElementById(`view-${view}`);
  if (el) {
    VIEW_CACHE[view] = { renderedAt: Date.now() };
    VIEW_RENDERED.add(view);
  }
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
  document.getElementById('mobile-tab-bar')?.setAttribute('hidden', '');
  requestAnimationFrame(() => document.getElementById('auth-username')?.focus());
}
function hideAuth() {
  document.getElementById('auth-overlay')?.setAttribute('hidden', '');
  document.body.classList.remove('operator-login-required');
  if (STATE.user) document.getElementById('mobile-tab-bar')?.removeAttribute('hidden');
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
  document.body.classList.remove('role-admin', 'role-manager', 'role-supervisor', 'role-operator', 'mobile-more-open');
  document.body.classList.add('role-pending');
  document.getElementById('mobile-tab-bar')?.setAttribute('hidden', '');
  const shell = document.getElementById('app-shell');
  if (shell) shell.innerHTML = '';
  setMobileMoreOpen(false);
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
}
window.handleAuthExpired = handleAuthExpired;

async function submitLogin() {
    const button = document.getElementById('auth-login-btn');
    const username = document.getElementById('auth-username')?.value?.trim();
    const password = document.getElementById('auth-password')?.value;
    const errEl = document.getElementById('auth-error');
    if (!username || !password) {
      if (errEl) errEl.textContent = 'Введите логин и пароль';
      document.getElementById(!username ? 'auth-username' : 'auth-password')?.focus();
      return;
    }
    if (!button || button.disabled) return;
    uiSetBusy(button, true, 'Входим…');
    if (errEl) errEl.textContent = '';
    try {
      await api.login(username, password);
      STATE.user = normalizeUser(await api.me());
      _authExpiredHandled = false;
      hideAuth();
      await bootApp();
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
      document.getElementById('auth-password')?.focus();
    } finally {
      uiSetBusy(button, false);
    }
}

document.addEventListener('submit', async event => {
  if (event.target.id !== 'auth-form') return;
  event.preventDefault();
  await submitLogin();
});

document.addEventListener('click', e => {
  const passwordToggle = e.target.closest('#auth-password-toggle');
  if (passwordToggle) {
    const input = document.getElementById('auth-password');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    passwordToggle.setAttribute('aria-pressed', String(show));
    passwordToggle.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    input.focus();
  }
  if (e.target.closest('#auth-logout-btn')) {
    logoutAndReload();
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('mobile-more-open')) {
    event.preventDefault();
    setMobileMoreOpen(false);
    return;
  }
  if (event.key === 'Tab' && document.body.classList.contains('mobile-more-open')) {
    const sheet = document.getElementById('mobile-more-sheet');
    const focusable = Array.from(sheet?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') || []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
  document.body.classList.toggle('role-manager', role === 'manager');
  document.body.classList.toggle('role-supervisor', role === 'supervisor');
  document.body.classList.toggle('role-operator', !isAdmin(role));
  buildViews(role);
  renderSidebar(role);
  buildMobileNavigation(role);
  setText('side-user', STATE.user?.full_name || STATE.user?.username || '');
  setText('side-role', roleLabel(role));
  setText('side-level', '—');
  // Update initials avatar
  (function() {
    var av = document.getElementById('side-user-avatar');
    if (!av) return;
    av.textContent = userInitials();
  })();

  if (STATE.user?.must_change_password) {
    document.body.classList.add('must-change-password');
    showForcedPasswordChangeModal();
    return;
  }
  document.body.classList.remove('must-change-password');

  await loadData(role);

  // Фоновый прогрев кеша аналитики для admin и manager —
  // пока пользователь смотрит Сводку, данные аналитики уже загружаются.
  // Запускаем через 3 секунды чтобы не конкурировать с основными запросами.
  if (role === 'admin' || role === 'manager') {
    setTimeout(() => prefetchAnalyticsInBackground(), 3000);
  }
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
      setText('side-level', level?.level?.name || '—');
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
  buildMobileNavigation(role);
}

/* ══════════════════════════════════════
   VIEW: УРОВНИ ОПЕРАТОРОВ
══════════════════════════════════════ */
