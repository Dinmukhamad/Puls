/* Generated from js/src app source files. Run npm run build after editing. */
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
      fetcher().then(fresh => {
        const changed = JSON.stringify(fresh) !== JSON.stringify(cached.data);
        swrWriteRaw(key, { data: fresh, ts: Date.now() });
        if (changed && onUpdate) onUpdate(fresh);
      }).catch(() => { /* фоновое обновление не удалось — старые данные остаются видимыми, это нормально */ });
    }
    return cached.data;
  }

  // Кеша нет вообще — обычный fetch, без фонового режима
  const fresh = await fetcher();
  swrWriteRaw(key, { data: fresh, ts: Date.now() });
  return fresh;
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
  if (!isAdmin(role)) return ['cabinet', 'rating', 'shop', 'wheel', 'tests'];

  const views = ['summary', 'operators', 'coins', 'shop', 'wheel', 'tests', 'period-report', 'analytics'];
  if (role === 'manager' || role === 'admin') views.push('operator-levels');
  if (canManageGroups(role)) views.push('groups');
  if (role === 'admin') views.push('sessions', 'cabinet', 'rating');
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
}

// Кеш отрендеренных разделов — не перерисовываем если уже есть актуальный HTML
const VIEW_CACHE = {};
const VIEW_CACHE_SKIP = new Set(['analytics', 'period-report', 'wheel', 'sessions', 'tests']); // эти разделы всегда рендерим заново

function invalidateViewCache(view) {
  if (view) delete VIEW_CACHE[view];
  else Object.keys(VIEW_CACHE).forEach(k => delete VIEW_CACHE[k]);
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
  STATE.currentView = view;
  if (view === 'coins') STATE.coinsTab = normalizeCoinTab(options.tab || STATE.coinsTab);
  bumpNavGen(); // отменяет все ещё не завершённые рендеры предыдущих разделов
  // Save to URL hash so F5 restores the same section
  const route = view === 'coins' ? `coins?tab=${STATE.coinsTab}` : view;
  history.replaceState(null, '', view === 'coins' ? `/${route}` : '/#' + route);
  localStorage.setItem('pulse-last-view', route);
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.side-nav-link[data-nav-target]').forEach(l => {
    const target = LEGACY_COIN_VIEW_TAB[l.dataset.navTarget] ? 'coins' : l.dataset.navTarget;
    l.classList.toggle('active', target === view);
  });
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.add('active');
  renderView(view);
}

function renderView(view) {
  const el = document.getElementById(`view-${view}`);

  // Используем кешированный HTML если доступен (кроме тех разделов что всегда свежие)
  if (el && VIEW_CACHE[view] && !VIEW_CACHE_SKIP.has(view)) {
    el.innerHTML = VIEW_CACHE[view];
    // Перезапускаем интерактивность после восстановления из кеша
    _reattachViewListeners(view, el);
    return;
  }

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
    case 'sessions': renderAdminSessions(); break;
  }
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
}
window.handleAuthExpired = handleAuthExpired;

document.addEventListener('click', async e => {
  if (e.target.id === 'auth-login-btn') {
    const username = document.getElementById('auth-username')?.value?.trim();
    const password = document.getElementById('auth-password')?.value;
    const errEl = document.getElementById('auth-error');
    if (!username || !password) { if (errEl) errEl.textContent = 'Введите логин и пароль'; return; }
    e.target.disabled = true; e.target.textContent = 'Вход…';
    try {
      await api.login(username, password);
      STATE.user = normalizeUser(await api.me());
      _authExpiredHandled = false;
      hideAuth();
      await bootApp();
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
      e.target.disabled = false; e.target.textContent = 'Войти';
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
  setText('side-user', STATE.user?.full_name || STATE.user?.username || '');
  setText('side-role', roleLabel(role));
  setText('side-level', '—');
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

/* ══════════════════════════════════════
   УВЕДОМЛЕНИЯ (ТЗ P2) — колокольчик в сайдбаре, модалка со списком
══════════════════════════════════════ */

let _notificationPollTimer = null;
const NOTIFICATION_POLL_MS = 30000; // 30с — не хуже других SWR-опросов в приложении

function startNotificationPolling() {
  if (_notificationPollTimer) return; // reloadData() может вызвать loadData() повторно — не плодим таймеры
  _notificationPollTimer = setInterval(refreshNotificationBadge, NOTIFICATION_POLL_MS);
}

async function refreshNotificationBadge() {
  const badge = document.getElementById('side-bell-badge');
  if (!badge) return;
  try {
    const { unread_count } = await api.getUnreadNotificationCount();
    if (unread_count > 0) {
      badge.textContent = unread_count > 99 ? '99+' : String(unread_count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  } catch {
    // не авторизован / сеть — тихо пропускаем, это фоновый опрос
  }
}

const _notificationTypeIcons = {
  achievement: '🏆', purchase_approved: '✅', purchase_rejected: '❌', purchase_completed: '🎁',
  weekly_accrual: '📊', wheel_prize: '🎡', manual_operation: '✍️',
};

function _notificationLinkTarget(link) {
  const known = ['cabinet', 'shop', 'wheel', 'rating', 'coins', 'summary'];
  return known.includes(link) ? link : null;
}

async function showNotificationsModal() {
  showModal(`
    <h3 class="modal-title">Уведомления</h3>
    <div class="notif-modal-actions">
      <button class="btn-link" id="notif-mark-all">Отметить все прочитанными</button>
    </div>
    <div id="notif-list-host"><div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div></div>`);

  document.getElementById('notif-mark-all').onclick = async () => {
    try {
      await api.markAllNotificationsRead();
      await _loadNotificationsIntoModal();
      refreshNotificationBadge();
    } catch (e) { showToast(e.message, 'error'); }
  };

  await _loadNotificationsIntoModal();
  refreshNotificationBadge();
}

async function _loadNotificationsIntoModal() {
  const host = document.getElementById('notif-list-host');
  if (!host) return;
  let data;
  try {
    data = await api.listNotifications({ limit: 30 });
  } catch (e) {
    host.innerHTML = `<div class="empty-line">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  const items = data.items || [];
  host.innerHTML = items.length ? items.map(n => `
    <div class="notif-row ${n.is_read ? '' : 'is-unread'}" data-notif-id="${n.id}">
      <div class="notif-icon">${_notificationTypeIcons[n.type] || '🔔'}</div>
      <div class="notif-body">
        <div class="notif-title">${esc(n.title)}</div>
        ${n.body ? `<div class="notif-text">${esc(n.body)}</div>` : ''}
        <div class="notif-time">${fmtDateTime(n.created_at)}</div>
      </div>
      ${!n.is_read ? '<span class="notif-dot" title="Не прочитано"></span>' : ''}
    </div>`).join('') : '<div class="empty-state">Пока нет уведомлений</div>';

  host.querySelectorAll('.notif-row').forEach(row => {
    row.addEventListener('click', async () => {
      const id = parseInt(row.dataset.notifId, 10);
      const notif = items.find(n => n.id === id);
      if (notif && !notif.is_read) {
        try {
          await api.markNotificationRead(id);
          row.classList.remove('is-unread');
          const dot = row.querySelector('.notif-dot');
          if (dot) dot.remove();
          refreshNotificationBadge();
        } catch { /* тихо — клик по уведомлению не должен ломать модалку */ }
      }
      const target = notif ? _notificationLinkTarget(notif.link) : null;
      if (target) { closeModal(); navigateTo(target); }
    });
  });
}

async function renderOperatorLevelsSettings() {
  const el = document.getElementById('view-operator-levels');
  if (!el) return;
  if (!(STATE.user?.role === 'manager' || STATE.user?.role === 'admin')) {
    el.innerHTML = '<div class="empty-state"><p>Недостаточно прав</p></div>';
    return;
  }

  const tab = STATE.opLevelsTab === 'achievements' ? 'achievements' : 'levels';
  el.innerHTML = `
    <div class="levels-page-head">
      <div>
        <div class="section-kicker">Развитие команды</div>
        <h2 class="section-title">Уровни операторов</h2>
        <p>Настройте путь роста, требования к каждому этапу и награды за повышение.</p>
      </div>
      <div class="header-right level-header-actions" ${tab === 'levels' ? '' : 'hidden'}>
        <button class="btn-outline btn-sm" onclick="recalculateOperatorLevelsUi()">Пересчитать уровни</button>
        <button class="btn-primary btn-sm" onclick="showCreateOperatorLevelPrompt()">+ Добавить уровень</button>
      </div>
    </div>
    <div class="levels-page-tabs" role="tablist" aria-label="Разделы развития операторов">
      <button class="levels-page-tab ${tab === 'levels' ? 'is-active' : ''}" data-op-levels-tab="levels" role="tab" aria-selected="${tab === 'levels'}">
        <span>Уровни</span><small>Этапы роста и условия</small>
      </button>
      <button class="levels-page-tab ${tab === 'achievements' ? 'is-active' : ''}" data-op-levels-tab="achievements" role="tab" aria-selected="${tab === 'achievements'}">
        <span>Достижения</span><small>Награды за отдельные результаты</small>
      </button>
    </div>
    <div id="op-levels-tab-body"></div>`;
  el.querySelectorAll('[data-op-levels-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.opLevelsTab = btn.dataset.opLevelsTab;
      renderOperatorLevelsSettings();
    });
  });
  const bodyEl = el.querySelector('#op-levels-tab-body');
  if (tab === 'achievements') { renderAchievementsAdminTab(bodyEl); return; }
  return renderLevelsTabContent(bodyEl);
}

async function renderLevelsTabContent(el) {
  if (!el) return;
  el.innerHTML = '<div class="panel level-settings-shell"><div class="empty-state"><p>Загрузка уровней…</p></div></div>';

  let levels = [];
  try {
    levels = await withTimeout(swrFetch('levels:admin', () => api.listAdminOperatorLevels(), null, SWR_STATIC_TTL_MS), 15000, 'Уровни не загрузились: сервер не ответил за 15 секунд');
  } catch (adminErr) {
    try {
      levels = await withTimeout(swrFetch('levels:list', () => api.listOperatorLevels(), null, SWR_STATIC_TTL_MS), 15000, 'Уровни не загрузились: сервер не ответил за 15 секунд');
    } catch (publicErr) {
      el.innerHTML = `<div class="status-line status-error">${esc(publicErr.message || adminErr.message || 'Не удалось загрузить уровни')}</div>
        <button class="btn-outline btn-sm" onclick="renderOperatorLevelsSettings()">Попробовать снова</button>`;
      return;
    }
  }
  STATE.operatorLevels = levels;
  const rewardsData = await withTimeout(swrFetch('levels:rewards', () => api.listOperatorLevelRewards(), null, SWR_FAST_TTL_MS), 10000)
    .catch(() => ({ items: [] }));
  const rewardRows = Array.isArray(rewardsData) ? rewardsData : (rewardsData.items || []);

  function ruleText(rule) {
    if (rule.condition_text) return rule.condition_text;
    const metricLabel = {
      tenure_days: 'Стаж', quality: 'Качество', kvz: 'КВЗ', efficiency: 'Эффективность',
      penalty_minutes: 'Штрафы', final_points: 'Итоговые баллы', test_percent: 'Тесты', total_xp: 'XP',
    }[rule.metric_code] || rule.metric_code;
    if (rule.operator === 'between') return `${metricLabel}: от ${levelNum(rule.value_min)} до ${levelNum(rule.value_max)}`;
    if (rule.operator === 'gte') return `${metricLabel}: не ниже ${levelNum(rule.value_min)}`;
    if (rule.operator === 'lte') return `${metricLabel}: не выше ${levelNum(rule.value_max)}`;
    return `${metricLabel}: равно ${levelNum(rule.value_min)}`;
  }

  function rewardStatus(row) {
    if (!row.reward_coins) return '<span class="status-pill muted">Без бонуса</span>';
    if (row.reward_received) return '<span class="status-pill ok">Получен</span>';
    return '<span class="status-pill warn">Ожидает повышения</span>';
  }

  function coinAmount(value, prefix = '') {
    const amount = Number(value || 0);
    const mod100 = Math.abs(amount) % 100;
    const mod10 = mod100 % 10;
    const word = mod100 >= 11 && mod100 <= 14 ? 'коинов' : mod10 === 1 ? 'коин' : mod10 >= 2 && mod10 <= 4 ? 'коина' : 'коинов';
    return `${prefix}${amount} ${word}`;
  }

  const activeLevels = levels.filter(level => level.is_active).length;
  const rewardsConfigured = levels.filter(level => Number(level.reward_coins) > 0).length;
  el.innerHTML = `<div class="levels-overview-grid">
    <div class="levels-overview-card"><span>Этапов роста</span><strong>${levels.length}</strong><small>${activeLevels} используются в расчёте</small></div>
    <div class="levels-overview-card"><span>Условий перехода</span><strong>${levels.reduce((sum, level) => sum + (level.rules_count ?? level.rules?.length ?? 0), 0)}</strong><small>проверяются автоматически</small></div>
    <div class="levels-overview-card"><span>Награды настроены</span><strong>${rewardsConfigured}</strong><small>разовый бонус при повышении</small></div>
  </div>
  <div class="levels-explainer">
    <strong>Как работает система уровней</strong>
    <span>Этапы идут сверху вниз. Оператор получает самый высокий активный уровень, для которого выполнены все обязательные условия.</span>
  </div>
  <div class="level-progression-list">
    ${levels.map((level, index) => `<article class="level-progression-card ${level.is_active ? '' : 'is-disabled'}">
      <div class="level-stage-rail">
        <span style="--level-color:${esc(level.color || '#64748B')}">${level.stage_number || index + 1}</span>
        ${index < levels.length - 1 ? '<i></i>' : ''}
      </div>
      <div class="level-progression-content">
        <header class="level-card-head">
          <div class="level-card-title">
            <div class="level-card-eyebrow">Этап ${level.stage_number || index + 1}</div>
            <div class="level-card-name"><span class="level-color-dot" style="background:${esc(level.color || '#64748B')}"></span><h3>${esc(level.name)}</h3>${levelBadgeHtml(level)}</div>
            <p>${esc(level.description || 'Добавьте короткое описание роли этого уровня в системе развития.')}</p>
          </div>
          <div class="level-card-controls">
            <span class="status-pill ${level.is_active ? 'ok' : 'muted'}">${level.is_active ? 'Участвует в расчёте' : 'Отключён'}</span>
            <button class="btn-outline btn-sm" onclick="editOperatorLevelUi(${level.id})">Редактировать</button>
            <button class="btn-outline btn-sm ${level.is_active ? 'danger' : ''}" onclick="toggleOperatorLevelUi(${level.id}, ${!level.is_active})">${level.is_active ? 'Отключить' : 'Включить'}</button>
          </div>
        </header>
        <div class="level-card-body">
          <section class="level-conditions-block">
            <div class="level-block-head"><div><span>Условия получения уровня</span><small>Нужно выполнить все обязательные условия</small></div><button class="btn-outline btn-sm" onclick="addOperatorLevelRuleUi(${level.id})">+ Добавить условие</button></div>
            <div class="level-condition-list">
              ${(level.rules || []).length ? level.rules.map(rule => `<div class="level-condition-row">
                <span class="level-condition-check">✓</span>
                <div><strong>${esc(rule.metric_label || ruleText(rule).split(':')[0])}</strong><span>${esc(ruleText(rule))}</span></div>
                <button type="button" onclick="deleteOperatorLevelRuleUi(${rule.id})" aria-label="Удалить условие" title="Удалить условие">×</button>
              </div>`).join('') : '<div class="level-condition-empty">Условия пока не настроены. Без условий уровень доступен всем операторам.</div>'}
            </div>
          </section>
          <aside class="level-reward-block ${level.reward_coins ? 'has-reward' : ''}">
            <span>Награда за повышение</span>
            <strong>${level.reward_coins ? coinAmount(level.reward_coins, '+') : 'Без награды'}</strong>
            <small>${level.reward_coins ? 'Начисляется один раз при первом переходе на этот уровень.' : 'Можно добавить разовый бонус в настройках уровня.'}</small>
          </aside>
        </div>
      </div>
    </article>`).join('')}
  </div>
  <div class="panel level-settings-shell" style="margin-top:18px">
    <div class="level-settings-head">
      <div>
        <h3>Текущие уровни операторов</h3>
        <p>Кто находится на каждом этапе и была ли начислена награда за последнее повышение.</p>
      </div>
      <span class="panel-badge">${rewardRows.length} операторов</span>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Оператор</th>
            <th>Группа</th>
            <th>Уровень</th>
            <th class="num">Стаж</th>
            <th class="num">Награда</th>
            <th>Состояние награды</th>
          </tr>
        </thead>
        <tbody>
          ${rewardRows.length ? rewardRows.map(row => `<tr>
            <td class="name-cell">${esc(row.operator_name)}</td>
            <td>${esc(row.group_name || '—')}</td>
            <td>${levelBadgeHtml(row.level)}</td>
            <td class="num">${levelNum(row.tenure_days, 0)} дн.</td>
            <td class="num">${row.reward_coins ? coinAmount(row.reward_coins, '+') : '—'}</td>
            <td>${rewardStatus(row)}</td>
          </tr>`).join('') : '<tr><td colspan="6" class="empty-line">Нет данных</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}

async function recalculateOperatorLevelsUi() {
  try {
    const res = await api.recalculateOperatorLevels({ mode: 'all' });
    swrInvalidate('levels:');
    showToast(`Пересчитано: ${res.processed}, изменено: ${res.updated}`, 'ok');
    swrInvalidate('rating:list');
    await reloadData();
  } catch(e) { showToast(e.message, 'error'); }
}

async function showCreateOperatorLevelPrompt() {
  showOperatorLevelForm();
}

async function editOperatorLevelUi(levelId) {
  const level = STATE.operatorLevels.find(l => l.id === levelId);
  if (!level) return;
  showOperatorLevelForm(level);
}

function showOperatorLevelForm(level = null) {
  const isEdit = Boolean(level);
  showModal(`
    <h3 class="modal-title">${isEdit ? 'Изменить уровень' : 'Добавить уровень'}</h3>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Название</label>
        <input id="lvl-name" class="form-input" value="${esc(level?.name || '')}" placeholder="Например: Профи">
      </div>
      <div class="form-group">
        <label class="form-label">Код</label>
        <input id="lvl-code" class="form-input" value="${esc(level?.code || '')}" ${isEdit ? 'disabled' : ''} placeholder="pro">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Цвет бейджа</label>
        <input id="lvl-color" class="form-input" value="${esc(level?.color || '#64748B')}" placeholder="#64748B">
      </div>
      <div class="form-group">
        <label class="form-label">Награда за повышение</label>
        <input id="lvl-reward-coins" class="form-input" type="number" min="0" value="${esc(level?.reward_coins ?? 0)}">
        <div class="form-hint">Количество коинов, которое оператор получит один раз при первом переходе.</div>
      </div>
    </div>
    <input id="lvl-order" type="hidden" value="${esc(level?.sort_order ?? ((STATE.operatorLevels.length + 1) * 10))}">
    <input id="lvl-min-xp" type="hidden" value="${esc(level?.min_total_xp ?? 0)}">
    <div class="form-group">
      <label class="form-label">Описание</label>
      <textarea id="lvl-description" class="form-input" rows="3" placeholder="Короткое описание уровня">${esc(level?.description || '')}</textarea>
    </div>
    <div id="lvl-form-error" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:8px" onclick="submitOperatorLevelForm(${isEdit ? level.id : 'null'})">${isEdit ? 'Сохранить' : 'Создать'}</button>
  `);
}

async function submitOperatorLevelForm(levelId) {
  const err = document.getElementById('lvl-form-error');
  const name = document.getElementById('lvl-name')?.value.trim();
  const code = document.getElementById('lvl-code')?.value.trim();
  const color = document.getElementById('lvl-color')?.value.trim() || '#64748B';
  const description = document.getElementById('lvl-description')?.value.trim() || '';
  const sort_order = Number(document.getElementById('lvl-order')?.value || 0);
  const min_total_xp = Number(document.getElementById('lvl-min-xp')?.value || 0);
  const reward_coins = Number(document.getElementById('lvl-reward-coins')?.value || 0);
  if (!name || (!levelId && !code)) {
    if (err) { err.textContent = 'Заполните название и код'; err.className = 'status-line status-error'; }
    return;
  }
  try {
    const payload = { name, color, description, sort_order, min_total_xp, reward_coins, reward_once: true };
    if (levelId) await api.updateOperatorLevel(levelId, payload);
    else await api.createOperatorLevel({ code, icon: '', is_active: true, ...payload });
    swrInvalidate('levels:');
    closeModal();
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function addOperatorLevelRuleUi(levelId) {
  const level = STATE.operatorLevels.find(l => l.id === levelId);
  showModal(`
    <h3 class="modal-title">Добавить показатель</h3>
    <div class="status-line" style="padding:0;color:var(--text-secondary)">Уровень: <b>${esc(level?.name || '')}</b></div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Показатель</label>
        <select id="rule-metric" class="form-select">
          <option value="tenure_days">Стаж</option>
          <option value="quality">Качество</option>
          <option value="kvz">КВЗ</option>
          <option value="efficiency">Эффективность</option>
          <option value="penalty_minutes">Штрафы</option>
          <option value="final_points">Итоговые баллы</option>
          <option value="test_percent">Тесты</option>
          <option value="total_xp">XP</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Условие</label>
        <select id="rule-operator" class="form-select">
          <option value="gte">Больше или равно</option>
          <option value="lte">Меньше или равно</option>
          <option value="eq">Равно</option>
          <option value="between">Между</option>
        </select>
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Минимум / значение</label>
        <input id="rule-min" class="form-input" type="number" step="0.01" value="0">
      </div>
      <div class="form-group">
        <label class="form-label">Максимум</label>
        <input id="rule-max" class="form-input" type="number" step="0.01" placeholder="Для lte / between">
      </div>
    </div>
    <div id="rule-form-error" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:8px" onclick="submitOperatorLevelRuleForm(${levelId})">Добавить</button>
  `);
}

async function submitOperatorLevelRuleForm(levelId) {
  const metric_code = document.getElementById('rule-metric')?.value;
  const operator = document.getElementById('rule-operator')?.value;
  const value_min_raw = document.getElementById('rule-min')?.value;
  const value_max_raw = document.getElementById('rule-max')?.value;
  const payload = {
    metric_code,
    operator,
    value_min: value_min_raw === '' || value_min_raw == null ? null : Number(value_min_raw),
    value_max: value_max_raw === '' || value_max_raw == null ? null : Number(value_max_raw),
    is_required: true,
  };
  if (operator === 'lte') payload.value_min = null;
  if ((operator === 'gte' || operator === 'eq') && payload.value_min === null) {
    const err = document.getElementById('rule-form-error');
    if (err) { err.textContent = 'Укажите значение'; err.className = 'status-line status-error'; }
    return;
  }
  if ((operator === 'lte' || operator === 'between') && payload.value_max === null) {
    const err = document.getElementById('rule-form-error');
    if (err) { err.textContent = 'Укажите максимум'; err.className = 'status-line status-error'; }
    return;
  }
  try {
    await api.addOperatorLevelRule(levelId, payload);
    swrInvalidate('levels:');
    closeModal();
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteOperatorLevelRuleUi(ruleId) {
  if (!confirm('Удалить показатель уровня?')) return;
  try {
    await api.deleteOperatorLevelRule(ruleId);
    swrInvalidate('levels:');
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function disableOperatorLevelUi(levelId) {
  if (!confirm('Отключить уровень?')) return;
  try {
    await api.deleteOperatorLevel(levelId);
    swrInvalidate('levels:');
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function toggleOperatorLevelUi(levelId, isActive) {
  const verb = isActive ? 'включить' : 'отключить';
  if (!confirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} уровень?`)) return;
  try {
    await api.updateOperatorLevel(levelId, { is_active: isActive });
    swrInvalidate('levels:');
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function manualOperatorLevelUi(operatorId) {
  const op = STATE.adminOperators.find(o => o.id === operatorId);
  const levels = STATE.operatorLevels.length ? STATE.operatorLevels : await api.listOperatorLevels().catch(() => []);
  const activeLevels = levels.filter(l => l.is_active);
  if (!activeLevels.length) { showToast('Нет активных уровней', 'error'); return; }
  const options = activeLevels.map(l => `${l.id}: ${l.name}`).join('\n');
  const raw = prompt(`Выберите уровень для ${op?.full_name || 'оператора'}:\n${options}`);
  if (!raw) return;
  const levelId = Number(String(raw).split(':')[0].trim());
  if (!levelId) { showToast('Некорректный уровень', 'error'); return; }
  const reason = prompt('Причина ручной смены уровня');
  if (!reason || !reason.trim()) { showToast('Причина обязательна', 'error'); return; }
  const comment = prompt('Комментарий', '') || '';
  try {
    await api.manualOperatorLevel(operatorId, { level_id: levelId, reason, comment });
    swrInvalidate('levels:');
    showToast('Уровень изменён', 'ok');
    swrInvalidate('rating:list');
    await reloadData();
  } catch(e) { showToast(e.message, 'error'); }
}

/* ══════════════════════════════════════
   VIEW: КАБИНЕТ ОПЕРАТОРА
══════════════════════════════════════ */
function renderCabinet() {
  const el = document.getElementById('view-cabinet');
  if (!el) return;
  if (!(STATE.user?.role === 'operator' || STATE.user?.role === 'supervisor')) {
    el.innerHTML = `<div class="view-header">
      <div>
        <div class="section-kicker">Кабинет</div>
        <h2 class="section-title">Мой кабинет</h2>
      </div>
    </div>
    <div class="panel">
      <h3>Администратор</h3>
      <p class="muted">Личный кошелёк доступен только аккаунтам, привязанным к оператору.</p>
    </div>`;
    return;
  }
  const w = STATE.wallet;
  if (!w) {
    el.innerHTML = `<div class="view-header"><div><div class="section-kicker">Кабинет</div><h2 class="section-title">Мой кабинет</h2></div></div>
      <div class="empty-state"><p>Данные загружаются…</p></div>`;
    const _cabinetGen = STATE.navGen;
    swrFetch('wallet:me', () => api.myWallet(), null, SWR_FAST_TTL_MS).then(data => {
      STATE.wallet = data;
      if (!isNavStale(_cabinetGen)) renderCabinet();
    }).catch(() => {});
    return;
  }

  const myRow = STATE.rating.find(r => r.operator_id === w.operator_id);
  const hasRank = myRow?.rank_position != null && Number(myRow.rank_position) > 0;
  const rank = hasRank ? Number(myRow.rank_position) : null;
  const total = STATE.rating.length || '—';
  const delta = myRow?.rank_delta;
  const levelInfo = STATE.myLevel;
  // Стаж: берём из metrics (API /me/level) или из STATE.myOperator
  const tenureDays = levelInfo?.metrics?.tenure_days ?? STATE.myOperator?.tenure_days ?? null;
  const tenureStr = tenureDays != null ? formatTenureDays(tenureDays) : '—';
  const levelCard = levelInfo ? `
    <div class="panel level-card">
      <div class="panel-head">
        <h3>Мой уровень</h3>
        ${levelBadgeHtml(levelInfo.level, 'level-badge-lg')}
      </div>
      <div class="level-tenure-row">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Стаж: <b>${esc(tenureStr)}</b></span>
      </div>
      ${levelInfo.next_level ? `
        <div class="level-next">До следующего уровня: ${levelBadgeHtml(levelInfo.next_level)}</div>
        <div class="level-gap-list">
          ${(levelInfo.gaps || []).map(g => `
            <div class="level-gap-row ${g.ok ? 'ok' : 'miss'}">
              <span>${esc(g.label)}</span>
              <b>${metricValueHtml(g)}</b>
              <em>${g.ok ? 'готово' : levelRequirementHtml(g)}</em>
            </div>`).join('')}
        </div>` : `
        <div class="empty-line">Вы достигли максимального уровня.</div>`}
      ${levelInfo.is_manual ? `<div class="status-line">Ручной уровень: ${esc(levelInfo.manual_reason || '')}</div>` : ''}
    </div>` : '';

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Кабинет</div><h2 class="section-title">Мой кабинет</h2></div>
      <button class="btn-outline btn-sm" onclick="reloadCabinet()">Обновить</button>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card kpi-accent">
        <div class="kpi-label">Баланс коинов</div>
        <div class="kpi-value">${w.current_balance} <span class="kpi-unit">₡</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Всего заработано</div>
        <div class="kpi-value">${w.total_earned} <span class="kpi-unit">₡</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Потрачено</div>
        <div class="kpi-value">${w.total_spent} <span class="kpi-unit">₡</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Место в рейтинге</div>
        <div class="kpi-value">${rank ? `${rank} <span class="kpi-unit">из ${total}</span>` : '<span class="kpi-unit">Пока не рассчитано</span>'}
          ${delta != null ? `<span class="rank-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '↑'+delta : delta < 0 ? '↓'+Math.abs(delta) : 'без изм.'}</span>` : ''}
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Стаж в компании</div>
        <div class="kpi-value" style="font-size:clamp(14px,2vw,18px)">${esc(tenureStr)}</div>
      </div>
    </div>

    ${levelCard}

    <div class="cabinet-wow-grid">
      <div id="cabinet-wheel-card"></div>
      <div id="cabinet-wheel-winners"></div>
    </div>

    <div id="cabinet-weekly-detail"></div>

    <div id="cabinet-achievements"></div>

    <div class="cabinet-bottom-grid">
      <div class="panel">
        <div class="panel-head"><h3>История начислений</h3><span class="panel-badge">${w.transactions.length} записей</span></div>
        <div class="tx-list">
          ${w.transactions.length ? w.transactions.map(t => `
            <div class="tx-row ${t.amount >= 0 ? 'tx-plus' : 'tx-minus'}">
              <div class="tx-info">
                <span class="tx-comment">${esc(t.comment)}</span>
                <span class="tx-date">${fmtDate(t.created_at)}</span>
              </div>
              <div class="tx-amount">${t.amount >= 0 ? '+' : ''}${t.amount} ₡</div>
            </div>`).join('') : '<div class="empty-line">Операций пока нет</div>'}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Топ-5 недели</h3></div>
        ${miniRating(5, myRow?.operator_id)}
        <div class="panel-footer">
          <button class="btn-link" onclick="navigateTo('rating')">Полный рейтинг →</button>
        </div>
      </div>
    </div>

    <div class="shop-banner">
      <div>
        <div class="shop-banner-title">Магазин бонусов</div>
        <div class="shop-banner-sub">У вас ${w.current_balance} ₡ — потратьте на бонус</div>
      </div>
      <button class="btn-primary" onclick="navigateTo('shop')">В магазин</button>
    </div>`;

  renderCabinetWheelCard();
  renderWheelWinnersToday();
  renderCabinetWeeklyDetail();
  renderCabinetAchievements();
}

// Блок «Победитель Wheel of WOW сегодня» на главной (ТЗ п.10). Грузится
// асинхронно; если сегодня никто не крутил — блок скрыт.
async function renderWheelWinnersToday() {
  const host = document.getElementById('cabinet-wheel-winners');
  if (!host) return;
  let data;
  try {
    data = await api.getWheelWinnersToday();
  } catch {
    host.innerHTML = '';
    return;
  }
  const items = data && data.items ? data.items : [];
  if (!items.length || !data.top) { host.innerHTML = ''; return; }

  const prizeText = (w) => w.prize_type === 'coins' ? `+${w.amount} ₡` : esc(w.prize);
  const top = data.top;
  const rest = items.filter(w => !(w.operator_id === top.operator_id && w.at === top.at));

  host.innerHTML = `
    <div class="panel wheel-winner-card">
      <div class="wheel-winner-head">
        <span class="wheel-winner-kicker">🎡 Победитель Wheel of WOW сегодня</span>
        <span class="wheel-winner-badge">Крупнейший приз дня</span>
      </div>
      <div class="wheel-winner-hero">
        <div class="wheel-winner-avatar">${esc((top.operator_name || '?').trim().charAt(0))}</div>
        <div class="wheel-winner-main">
          <div class="wheel-winner-name">${esc(top.operator_name)}</div>
          ${top.reason ? `<div class="wheel-winner-reason">Причина допуска: ${esc(top.reason)}</div>` : ''}
        </div>
        <div class="wheel-winner-prize">${prizeText(top)}</div>
      </div>
      ${rest.length ? `<div class="wheel-winner-list">
        <div class="wheel-winner-list-title">Сегодня крутили колесо:</div>
        ${rest.slice(0, 6).map(w => `<div class="wheel-winner-row">
          <span class="wheel-winner-row-icon">${WHEEL_PRIZE_ICON[w.prize_type] || '★'}</span>
          <span class="wheel-winner-row-name">${esc(w.operator_name)}</span>
          <span class="wheel-winner-row-prize">${prizeText(w)}</span>
        </div>`).join('')}
      </div>` : ''}
    </div>`;
}

// Карточка «Колесо WOW» на главной панели оператора (ТЗ п.2). Грузится
// асинхронно, чтобы не задерживать рендер кабинета; ошибки скрывают карточку.
async function renderCabinetWheelCard() {
  const host = document.getElementById('cabinet-wheel-card');
  if (!host) return;
  let status;
  try {
    status = await api.getWheelStatus();
  } catch {
    host.innerHTML = '';
    return;
  }
  if (!status || !status.campaign) { host.innerHTML = ''; return; }

  const tickets = status.available_tickets || 0;
  const canSpin = status.can_spin;
  const reason = status.next_ticket_reason;
  const lp = status.last_prize;

  if (tickets > 0) {
    host.innerHTML = `
      <div class="panel wheel-cabinet-card wheel-cabinet-have">
        <div class="wheel-cabinet-main">
          <div class="wheel-cabinet-kicker">🎡 Колесо WOW</div>
          <div class="wheel-cabinet-title">Доступно вращений: <b>${tickets}</b></div>
          ${reason ? `<div class="wheel-cabinet-sub">Получено за: ${esc(reason)}</div>` : ''}
          ${!canSpin && status.reason_if_cannot_spin ? `<div class="wheel-cabinet-sub muted">${esc(status.reason_if_cannot_spin)}</div>` : ''}
        </div>
        <button class="btn-primary" onclick="navigateTo('wheel')">Крутить колесо</button>
      </div>`;
  } else {
    host.innerHTML = `
      <div class="panel wheel-cabinet-card wheel-cabinet-none">
        <div class="wheel-cabinet-main">
          <div class="wheel-cabinet-kicker">🎡 Колесо WOW</div>
          <div class="wheel-cabinet-title">Сегодня вращений нет</div>
          <div class="wheel-cabinet-sub muted">Чтобы получить попытку: пройди тест дня на 80%+, закрой день без опозданий, держи качество 90+.</div>
          ${lp ? `<div class="wheel-cabinet-sub">Последний приз: ${esc(lp.title)}</div>` : ''}
        </div>
        <button class="btn-outline" onclick="navigateTo('wheel')">Открыть колесо</button>
      </div>`;
  }
}

async function reloadCabinet() {
  STATE.wallet = await swrFetch('wallet:me', () => api.myWallet(), null, SWR_FAST_TTL_MS).catch(() => STATE.wallet);
  STATE.myLevel = await api.myLevel().catch(() => STATE.myLevel);
  STATE.myOperator = await api.myOperator().catch(() => STATE.myOperator);
  setText('side-level', STATE.myLevel?.level?.name || '—');
  const ratingResp = await api.getRating().catch(() => ({ items: STATE.rating }));
  STATE.rating = Array.isArray(ratingResp) ? ratingResp : (ratingResp.items || []);
  STATE.cabinetData = null;
  renderCabinet();
}

function cabinetFormatCoin(value) {
  return `${levelNum(value || 0, 0)} <span class="kpi-unit">₡</span>`;
}

function syncCabinetSnapshot(snapshot) {
  if (!snapshot) return;
  const wallet = snapshot.wallet || {};
  const transactions = snapshot.recent_transactions || [];
  STATE.cabinetSnapshot = snapshot;
  STATE.cabinetData = snapshot;
  STATE.cabinetFetchedAt = snapshot.generated_at || new Date().toISOString();
  STATE.myLevel = snapshot.level || STATE.myLevel;
  STATE.myOperator = snapshot.operator || STATE.myOperator;
  STATE.wallet = {
    operator_id: snapshot.operator?.id,
    current_balance: wallet.balance || 0,
    total_earned: wallet.total_earned || 0,
    total_spent: wallet.total_spent || 0,
    transactions: transactions.map(t => ({ ...t, created_at: t.created_at || t.date })),
  };
  STATE.rating = snapshot.top_week || STATE.rating || [];
  if (snapshot.level?.level) setText('side-level', snapshot.level.level.name || '—');
}

async function loadCabinetSnapshot(force = false) {
  if (force) {
    swrInvalidate('cabinet:me');
    STATE.cabinetSnapshot = null;
    STATE.cabinetData = null;
  }
  if (STATE.cabinetSnapshot && !force) return STATE.cabinetSnapshot;
  if (!STATE._cabinetSnapshotPromise) {
    STATE._cabinetSnapshotPromise = withTimeout(
      swrFetch('cabinet:me', () => (api.getMyCabinetV2 ? api.getMyCabinetV2() : api.getMyCabinet()), null, SWR_FAST_TTL_MS),
      12000,
      'Кабинет не загрузился: сервер не ответил за 12 секунд'
    ).then(data => {
      syncCabinetSnapshot(data);
      STATE.cabinetError = null;
      return data;
    }).catch(err => {
      STATE.cabinetError = err.message || 'Не удалось загрузить кабинет';
      throw err;
    }).finally(() => {
      STATE._cabinetSnapshotPromise = null;
    });
  }
  return STATE._cabinetSnapshotPromise;
}

function cabinetLoadingHtml() {
  return `
    <div class="view-header">
      <div><div class="section-kicker">Кабинет</div><h2 class="section-title">Мой кабинет</h2></div>
    </div>
    <div class="cabinet-skeleton-grid">
      <div class="cabinet-skeleton wide"></div>
      <div class="cabinet-skeleton"></div>
      <div class="cabinet-skeleton"></div>
    </div>`;
}

function cabinetLevelCard(levelInfo) {
  if (!levelInfo) return '';
  const tenureDays = levelInfo.metrics?.tenure_days ?? STATE.myOperator?.tenure_days ?? null;
  const tenureStr = tenureDays != null ? formatTenureDays(tenureDays) : '—';
  return `
    <div class="panel level-card">
      <div class="panel-head">
        <h3>Мой уровень</h3>
        ${levelBadgeHtml(levelInfo.level, 'level-badge-lg')}
      </div>
      <div class="level-tenure-row">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Стаж: <b>${esc(tenureStr)}</b></span>
      </div>
      ${levelInfo.next_level ? `
        <div class="level-next">До следующего уровня: ${levelBadgeHtml(levelInfo.next_level)}</div>
        <div class="level-gap-list">
          ${(levelInfo.gaps || []).map(g => `
            <div class="level-gap-row ${g.ok ? 'ok' : 'miss'}">
              <span>${esc(g.label)}</span>
              <b>${metricValueHtml(g)}</b>
              <em>${g.ok ? 'готово' : levelRequirementHtml(g)}</em>
            </div>`).join('')}
        </div>` : '<div class="empty-line">Вы достигли максимального уровня.</div>'}
      ${levelInfo.is_manual ? `<div class="status-line">Ручной уровень: ${esc(levelInfo.manual_reason || '')}</div>` : ''}
    </div>`;
}

function cabinetWheelCard(status) {
  if (!status || !status.campaign) return '';
  const tickets = Number(status.available_tickets || 0);
  const lp = status.last_prize;
  return `
    <div class="panel wheel-cabinet-card ${tickets > 0 ? 'wheel-cabinet-have' : 'wheel-cabinet-none'}">
      <div class="wheel-cabinet-main">
        <div class="wheel-cabinet-kicker">Колесо WOW</div>
        <div class="wheel-cabinet-title">${tickets > 0 ? `Доступно вращений: <b>${tickets}</b>` : 'Сегодня вращений нет'}</div>
        <div class="wheel-cabinet-sub ${tickets > 0 ? '' : 'muted'}">${esc(status.message || status.reason_if_cannot_spin || 'Пока нет доступных билетов')}</div>
        ${lp ? `<div class="wheel-cabinet-sub">Последний приз: ${esc(lp.title || lp.value || '')}</div>` : ''}
      </div>
      <button class="${tickets > 0 ? 'btn-primary' : 'btn-outline'}" onclick="navigateTo('wheel')">${tickets > 0 ? 'Крутить колесо' : 'Открыть колесо'}</button>
    </div>`;
}

function cabinetWinnersCard(data) {
  const items = data?.items || [];
  const top = data?.top;
  if (!items.length || !top) return '';
  const prizeText = (w) => w.prize_type === 'coins' ? `+${w.amount} ₡` : esc(w.prize || '—');
  const rest = items.filter(w => !(w.operator_id === top.operator_id && w.at === top.at));
  return `
    <div class="panel wheel-winner-card">
      <div class="wheel-winner-head">
        <span class="wheel-winner-kicker">Победитель Wheel of WOW сегодня</span>
        <span class="wheel-winner-badge">Крупнейший приз дня</span>
      </div>
      <div class="wheel-winner-hero">
        <div class="wheel-winner-avatar">${esc((top.operator_name || '?').trim().charAt(0))}</div>
        <div class="wheel-winner-main">
          <div class="wheel-winner-name">${esc(top.operator_name)}</div>
          ${top.reason ? `<div class="wheel-winner-reason">Причина допуска: ${esc(top.reason)}</div>` : ''}
        </div>
        <div class="wheel-winner-prize">${prizeText(top)}</div>
      </div>
      ${rest.length ? `<div class="wheel-winner-list">
        ${rest.slice(0, 5).map(w => `<div class="wheel-winner-row">
          <span class="wheel-winner-row-icon">${WHEEL_PRIZE_ICON[w.prize_type] || '★'}</span>
          <span class="wheel-winner-row-name">${esc(w.operator_name)}</span>
          <span class="wheel-winner-row-prize">${prizeText(w)}</span>
        </div>`).join('')}
      </div>` : ''}
    </div>`;
}

function cabinetTransactionsHtml(items) {
  return items.length ? items.map(t => `
    <div class="tx-row ${Number(t.amount || 0) >= 0 ? 'tx-plus' : 'tx-minus'}">
      <div class="tx-info">
        <span class="tx-comment">${esc(t.comment || t.type || 'Операция')}</span>
        <span class="tx-date">${fmtDate(t.created_at || t.date)}</span>
      </div>
      <div class="tx-amount">${Number(t.amount || 0) >= 0 ? '+' : ''}${levelNum(t.amount || 0, 0)} ₡</div>
    </div>`).join('') : '<div class="empty-line">Операций пока нет</div>';
}

function cabinetTopWeekHtml(rows, currentId) {
  return rows.length ? `<div class="mini-rating">
    ${rows.map((r, idx) => `<div class="mini-row ${r.operator_id === currentId ? 'current' : ''}">
      <span class="mini-rank">${r.rank_position || idx + 1}</span>
      <span class="mini-name">${esc(r.operator_name || r.full_name || '—')} ${r.level ? levelBadgeHtml(r.level) : ''}</span>
      <b>${levelNum(r.coins_earned || r.total_balance || 0, 0)} ₡</b>
      <em>${levelNum(r.contest_points || r.final_score || 0)}</em>
    </div>`).join('')}
  </div>` : '<div class="empty-line">Рейтинг пока не рассчитан</div>';
}

function renderCabinet() {
  const el = document.getElementById('view-cabinet');
  if (!el) return;
  if (!(STATE.user?.role === 'operator' || STATE.user?.role === 'supervisor')) {
    el.innerHTML = `<div class="view-header">
      <div><div class="section-kicker">Кабинет</div><h2 class="section-title">Мой кабинет</h2></div>
    </div>
    <div class="panel">
      <h3>Администратор</h3>
      <p class="muted">Личный кабинет доступен только аккаунтам, привязанным к оператору.</p>
    </div>`;
    return;
  }

  const snapshot = STATE.cabinetSnapshot;
  if (!snapshot) {
    el.innerHTML = cabinetLoadingHtml();
    const cabinetGen = STATE.navGen;
    loadCabinetSnapshot(false).then(() => {
      if (!isNavStale(cabinetGen)) renderCabinet();
    }).catch(() => {
      if (!isNavStale(cabinetGen)) renderCabinet();
    });
    if (STATE.cabinetError) {
      el.innerHTML = `<div class="view-header">
        <div><div class="section-kicker">Кабинет</div><h2 class="section-title">Мой кабинет</h2></div>
        <button class="btn-outline btn-sm" onclick="reloadCabinet()">Повторить</button>
      </div><div class="panel empty-state"><p>${esc(STATE.cabinetError)}</p></div>`;
    }
    return;
  }

  syncCabinetSnapshot(snapshot);
  const wallet = snapshot.wallet || {};
  const rating = snapshot.rating || {};
  const levelInfo = snapshot.level;
  const tenureDays = levelInfo?.metrics?.tenure_days ?? STATE.myOperator?.tenure_days ?? null;
  const tenureStr = tenureDays != null ? formatTenureDays(tenureDays) : '—';
  const rank = rating.place;
  const total = rating.total_participants || '—';
  const delta = rating.delta;
  const transactions = snapshot.recent_transactions || [];
  const topWeek = snapshot.top_week || [];
  const generatedAt = STATE.cabinetFetchedAt ? fmtDate(STATE.cabinetFetchedAt) : '';

  el.innerHTML = `
    <div class="view-header cabinet-v2-header">
      <div>
        <div class="section-kicker">Кабинет</div>
        <h2 class="section-title">Мой кабинет</h2>
        ${generatedAt ? `<div class="cabinet-snapshot-note">Обновлено: ${esc(generatedAt)}</div>` : ''}
      </div>
      <button class="btn-outline btn-sm" onclick="reloadCabinet()" ${STATE.cabinetLoading ? 'disabled' : ''}>${STATE.cabinetLoading ? 'Обновляем...' : 'Обновить'}</button>
    </div>

    <div class="kpi-grid cabinet-kpi-grid">
      <div class="kpi-card kpi-accent"><div class="kpi-label">Баланс коинов</div><div class="kpi-value">${cabinetFormatCoin(wallet.balance)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Всего заработано</div><div class="kpi-value">${cabinetFormatCoin(wallet.total_earned)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Потрачено</div><div class="kpi-value">${cabinetFormatCoin(wallet.total_spent)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Место в рейтинге</div><div class="kpi-value">${rank ? `${rank} <span class="kpi-unit">из ${total}</span>` : '<span class="kpi-unit">Пока не рассчитано</span>'}${delta != null ? `<span class="rank-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '↑'+delta : delta < 0 ? '↓'+Math.abs(delta) : 'без изм.'}</span>` : ''}</div></div>
      <div class="kpi-card"><div class="kpi-label">Стаж в компании</div><div class="kpi-value cabinet-tenure-value">${esc(tenureStr)}</div></div>
    </div>

    ${cabinetLevelCard(levelInfo)}

    <div class="cabinet-wow-grid">
      <div id="cabinet-wheel-card">${cabinetWheelCard(snapshot.wheel)}</div>
      <div id="cabinet-wheel-winners">${cabinetWinnersCard(snapshot.winners_today)}</div>
    </div>

    <div id="cabinet-weekly-detail"></div>
    <div id="cabinet-achievements"></div>

    <div class="cabinet-bottom-grid">
      <div class="panel">
        <div class="panel-head"><h3>История начислений</h3><span class="panel-badge">${transactions.length} записей</span></div>
        <div class="tx-list">${cabinetTransactionsHtml(transactions)}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Топ-5 недели</h3></div>
        ${cabinetTopWeekHtml(topWeek, snapshot.operator?.id)}
        <div class="panel-footer"><button class="btn-link" onclick="navigateTo('rating')">Полный рейтинг →</button></div>
      </div>
    </div>

    <div class="shop-banner">
      <div>
        <div class="shop-banner-title">Магазин бонусов</div>
        <div class="shop-banner-sub">У вас ${levelNum(wallet.balance || 0, 0)} ₡ — можно обменять коины на доступные бонусы.</div>
      </div>
      <button class="btn-primary" onclick="navigateTo('shop')">В магазин</button>
    </div>`;

  renderCabinetWeeklyDetail();
  renderCabinetAchievements();
}

async function reloadCabinet() {
  STATE.cabinetLoading = true;
  renderCabinet();
  try {
    await loadCabinetSnapshot(true);
    showToast('Кабинет обновлён', 'ok');
  } catch(e) {
    showToast(e.message || 'Не удалось обновить кабинет', 'error');
  } finally {
    STATE.cabinetLoading = false;
    renderCabinet();
  }
}

function showChangePasswordModal() {
  showModal(`
    <h3 class="modal-title">Сменить пароль</h3>
    <div class="form-group">
      <label class="form-label">Текущий пароль</label>
      <input id="cp-current" class="form-input" type="password" placeholder="Введите текущий пароль">
    </div>
    <div class="form-group">
      <label class="form-label">Новый пароль</label>
      <input id="cp-new" class="form-input" type="password" placeholder="Минимум 8 символов">
    </div>
    <div class="form-group">
      <label class="form-label">Повтор нового пароля</label>
      <input id="cp-confirm" class="form-input" type="password" placeholder="Повторите пароль">
    </div>
    <div id="cp-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitLegacyChangePassword()">Сохранить</button>`);
}

async function submitLegacyChangePassword() {
  const current = document.getElementById('cp-current')?.value;
  const newPwd  = document.getElementById('cp-new')?.value;
  const confirm = document.getElementById('cp-confirm')?.value;
  const err     = document.getElementById('cp-err');
  if (!current || !newPwd || !confirm) { err.textContent='Заполните все поля'; err.className='status-line status-error'; return; }
  if (newPwd.length < 8) { err.textContent='Пароль должен содержать минимум 8 символов'; err.className='status-line status-error'; return; }
  if (newPwd !== confirm) { err.textContent='Пароли не совпадают'; err.className='status-line status-error'; return; }
  try {
    await api.changeOperatorPassword({current_password:current, new_password:newPwd, confirm_password:confirm});
    closeModal(); showToast('Пароль успешно изменён', 'ok');
  } catch(e) { err.textContent=e.message; err.className='status-line status-error'; }
}

function showChangeUsernameModal() {
  showModal(`
    <h3 class="modal-title">Сменить логин</h3>
    <div class="form-group">
      <label class="form-label">Текущий логин</label>
      <input class="form-input" value="${esc(STATE.user?.username||'')}" disabled style="opacity:.5">
    </div>
    <div class="form-group">
      <label class="form-label">Новый логин</label>
      <input id="cu-new" class="form-input" placeholder="Только латиница, цифры и _">
    </div>
    <div id="cu-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitChangeUsername()">Сохранить</button>`);
}

async function submitChangeUsername() {
  const newUsername = document.getElementById('cu-new')?.value?.trim();
  const err = document.getElementById('cu-err');
  if (!newUsername) { err.textContent='Введите новый логин'; err.className='status-line status-error'; return; }
  try {
    const data = await api.changeOperatorUsername({new_username: newUsername});
    closeModal(); showToast('Логин успешно изменён', 'ok');
    STATE.user.username = newUsername;
    setText('side-user', STATE.user.full_name);
  } catch(e) { err.textContent=e.message; err.className='status-line status-error'; }
}

/* ══════════════════════════════════════
   VIEW: РЕЙТИНГ
══════════════════════════════════════ */

/* ══════════════════════════════════════
   УРОВНИ: вкладка «Достижения» (ТЗ §7) — каталог, включение/выключение, ручная выдача
══════════════════════════════════════ */

function achievementVisualIcon(achievement, extraClass = '') {
  const key = achievement?.code || achievement?.condition_type || 'achievement';
  const paths = {
    top_3_week: '<circle cx="12" cy="8" r="5"/><path d="M8.6 12.5 7 22l5-3 5 3-1.6-9.5"/><path d="m9.8 8 1.4 1.4L14.5 6"/>',
    no_late_3_weeks: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/><path d="M5.8 3.5 3.5 5.8M18.2 3.5l2.3 2.3"/>',
    no_late_streak: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/><path d="M5.8 3.5 3.5 5.8M18.2 3.5l2.3 2.3"/>',
    quality_star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    quality_threshold: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    calls_master: '<path d="M7.2 3.8 4.8 5.6c-1.1.9-.9 3.2.5 5.8 1.8 3.3 4.1 5.6 7.4 7.3 2.6 1.4 4.9 1.6 5.8.5l1.7-2.3-4.6-3.2-2 2c-2.3-1.1-4.2-3-5.3-5.3l2-2Z"/>',
    calls_leader_week: '<path d="M7.2 3.8 4.8 5.6c-1.1.9-.9 3.2.5 5.8 1.8 3.3 4.1 5.6 7.4 7.3 2.6 1.4 4.9 1.6 5.8.5l1.7-2.3-4.6-3.2-2 2c-2.3-1.1-4.2-3-5.3-5.3l2-2Z"/>',
    efficiency_top: '<path d="m13 2-8 12h7l-1 8 8-12h-7Z"/>',
    efficiency_leader_week: '<path d="m13 2-8 12h7l-1 8 8-12h-7Z"/>',
    legend_team: '<path d="m3 6 4.5 4L12 4l4.5 6L21 6l-2 11H5Z"/><path d="M5 20h14"/>',
    total_coins: '<path d="m3 6 4.5 4L12 4l4.5 6L21 6l-2 11H5Z"/><path d="M5 20h14"/>',
    helper: '<path d="M16 11.5c1.8 0 3.5-1.6 3.5-3.5S18 4.5 16 4.5c-1.2 0-2.3.6-3 1.5-.7-.9-1.8-1.5-3-1.5C8 4.5 6.5 6 6.5 8c0 1.9 1.7 3.5 3.5 3.5"/><path d="M3 14h4l2 2h6l2-2h4"/><path d="M5 14v5h14v-5"/>',
    manual: '<path d="M16 11.5c1.8 0 3.5-1.6 3.5-3.5S18 4.5 16 4.5c-1.2 0-2.3.6-3 1.5-.7-.9-1.8-1.5-3-1.5C8 4.5 6.5 6 6.5 8c0 1.9 1.7 3.5 3.5 3.5"/><path d="M3 14h4l2 2h6l2-2h4"/><path d="M5 14v5h14v-5"/>',
    test_master: '<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23Z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5A3.5 3.5 0 0 1 20 23Z"/>',
    test_score: '<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23Z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5A3.5 3.5 0 0 1 20 23Z"/>',
  };
  return `<svg class="achievement-system-icon ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key] || '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>'}</svg>`;
}

async function renderAchievementsAdminTab(el) {
  if (!el) return;
  el.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка достижений…</p></div>';

  let achievements;
  try {
    achievements = await swrFetch('achievements:list', () => api.listAchievements(), null, SWR_STATIC_TTL_MS);
  } catch (e) {
    el.innerHTML = `<div class="empty-line">Ошибка загрузки: ${esc(e.message)}</div>`;
    return;
  }
  STATE._achievementsCatalog = achievements;

  if (!STATE.adminOperators.length) {
    try { STATE.adminOperators = await swrFetch('dashboard:operators', () => api.getDashboardOperators(), null, SWR_USER_TTL_MS); } catch { /* форма выдачи покажет пустой список */ }
  }

  const conditionLabel = (a) => {
    const v = levelNum(a.condition_value);
    return {
      top_3_week: 'Топ-3 недели',
      no_late_streak: `${v} недели подряд без опозданий`,
      quality_threshold: `Качество ≥ ${v}%`,
      calls_leader_week: 'Лучший по звонкам за неделю',
      efficiency_leader_week: 'Лучший по эффективности за неделю',
      total_coins: `Всего начислено ≥ ${v} ₡`,
      manual: 'Только ручная выдача',
      test_score: `Результат теста ≥ ${v}%`,
    }[a.condition_type] || a.condition_type;
  };

  el.innerHTML = `
    <div class="achievements-catalog-head">
      <div>
        <div class="an-card-head">Каталог достижений</div>
        <p>Управляйте условиями, наградами и доступностью достижений для операторов.</p>
      </div>
      <span class="panel-badge">${achievements.length}</span>
    </div>

    <div class="achievements-admin-grid">
      ${achievements.map(a => `
        <article class="achievement-admin-card ${a.is_active ? '' : 'is-inactive'}" data-achievement-id="${a.id}">
          <header class="achievement-admin-head">
            <span class="achievement-admin-icon">${achievementVisualIcon(a)}</span>
            <div class="achievement-admin-heading">
              <div class="achievement-admin-title">${esc(a.title)}</div>
              <div class="achievement-admin-desc">${esc(a.description)}</div>
            </div>
            <span class="achievement-admin-state ${a.is_active ? 'is-active' : ''}">${a.is_active ? 'Активно' : 'Выключено'}</span>
          </header>

          <div class="achievement-admin-rule">
            <span>Условие получения</span>
            <strong>${esc(conditionLabel(a))}</strong>
          </div>

          <div class="achievement-admin-meta">
            <span class="achievement-admin-tag ${a.is_repeatable ? 'repeatable' : ''}">${a.is_repeatable ? 'Можно получать повторно' : 'Выдаётся один раз'}</span>
          </div>

          <div class="achievement-admin-reward-row">
            <div class="achievement-admin-reward-label">
              <span>Награда</span>
              <strong>Коины за выполнение</strong>
            </div>
            <div class="achievement-admin-reward-control">
              <input type="number" class="form-input" id="ach-reward-${a.id}" value="${a.reward_coins}" min="0" step="1" aria-label="Награда за достижение">
              <span class="achievement-coin-unit">₡</span>
              <button class="btn-outline btn-sm" onclick="saveAchievementReward(${a.id}, this)">Сохранить</button>
            </div>
          </div>

          <footer class="achievement-admin-footer">
            <label class="achievement-admin-toggle-row">
              <span class="toggle-switch">
                <input type="checkbox" ${a.is_active ? 'checked' : ''} onchange="toggleAchievementActive(${a.id}, this.checked, this)">
                <span class="toggle-slider"></span>
              </span>
              <span>Доступно операторам</span>
            </label>
            <button class="btn-outline btn-sm" onclick="openGrantAchievementForm(${a.id})">Выдать вручную</button>
          </footer>
        </article>`).join('')}
    </div>`;
}

async function toggleAchievementActive(id, isActive, input) {
  try {
    await api.updateAchievement(id, { is_active: isActive });
    swrInvalidate('achievements:');
    showToast(isActive ? 'Достижение включено' : 'Достижение выключено', 'ok');
    const a = (STATE._achievementsCatalog || []).find(x => x.id === id);
    if (a) a.is_active = isActive;
    const card = input?.closest('.achievement-admin-card');
    card?.classList.toggle('is-inactive', !isActive);
    const state = card?.querySelector('.achievement-admin-state');
    if (state) {
      state.textContent = isActive ? 'Активно' : 'Выключено';
      state.classList.toggle('is-active', isActive);
    }
  } catch (e) {
    showToast(e.message, 'error');
    const body = document.getElementById('op-levels-tab-body');
    if (body) renderAchievementsAdminTab(body);
  }
}

async function saveAchievementReward(id, button) {
  const val = Number(document.getElementById(`ach-reward-${id}`)?.value);
  if (!Number.isFinite(val) || val < 0) return showToast('Укажите корректную награду', 'error');
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
  try {
    await api.updateAchievement(id, { reward_coins: val });
    swrInvalidate('achievements:');
    showToast('Награда обновлена', 'ok');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = original || 'Сохранить'; }
  }
}

function openGrantAchievementForm(achievementId) {
  const a = (STATE._achievementsCatalog || []).find(x => x.id === achievementId);
  const ops = (STATE.adminOperators || []).slice().sort((x, y) => (x.full_name || '').localeCompare(y.full_name || ''));

  showModal(`
    <h3 class="modal-title">Выдать «${esc(a?.title || '')}» вручную</h3>
    <div class="form-group">
      <label class="form-label">Оператор</label>
      <select id="grant-ach-operator" class="form-input">
        <option value="">Выберите оператора…</option>
        ${ops.map(o => `<option value="${o.id}">${esc(o.full_name)}${o.group_name ? ' — ' + esc(o.group_name) : ''}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Комментарий <span class="optional">(необязательно)</span></label>
      <input id="grant-ach-comment" class="form-input" type="text" placeholder="Например: помог новому сотруднику освоиться">
    </div>
    <div id="grant-ach-err" class="status-line"></div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" onclick="submitGrantAchievement(${achievementId})">Выдать достижение</button>
    </div>`);
}

async function submitGrantAchievement(achievementId) {
  const operatorId = Number(document.getElementById('grant-ach-operator')?.value);
  const comment = document.getElementById('grant-ach-comment')?.value || '';
  const errEl = document.getElementById('grant-ach-err');
  if (!operatorId) { if (errEl) errEl.textContent = 'Выберите оператора'; return; }
  try {
    await api.grantAchievement(achievementId, { operator_id: operatorId, comment });
    swrInvalidate('achievements:');
    swrInvalidate('coins:');
    swrInvalidate('rating:');
    showToast('Достижение выдано', 'ok');
    closeModal();
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}

/* ══════════════════════════════════════
   КАБИНЕТ: показатели недели, прозрачный расчёт коинов, достижения (ТЗ §5, §7)
   Один общий фетч /api/cabinet/me — данные шарятся между обоими блоками.
══════════════════════════════════════ */

function _cabinetIsOperatorLike() {
  return STATE.user?.role === 'operator' || STATE.user?.role === 'supervisor';
}

// Общий загрузчик: гарантирует ровно один запрос, даже если оба блока
// (показатели недели и достижения) рендерятся почти одновременно.
function _loadCabinetData() {
  if (STATE.cabinetData) return Promise.resolve(STATE.cabinetData);
  if (!STATE._cabinetDataPromise) {
    STATE._cabinetDataPromise = api.getMyCabinet()
      .then(data => { STATE.cabinetData = data; return data; })
      .finally(() => { STATE._cabinetDataPromise = null; });
  }
  return STATE._cabinetDataPromise;
}

function _metricBarHtml(label, value, target, unit = '') {
  const v = Number(value) || 0;
  const t = Number(target) || 0;
  const pct = t > 0 ? Math.min(100, Math.round((v / t) * 100)) : (v > 0 ? 100 : 0);
  const overTarget = t > 0 && v >= t;
  return `
    <div class="metric-progress-row">
      <div class="metric-progress-label">
        <span>${esc(label)}</span>
        <b>${levelNum(v)}${esc(unit)}${t > 0 ? ` <span class="cell-muted">/ цель ${levelNum(t)}${esc(unit)}</span>` : ''}</b>
      </div>
      <div class="metric-progress-bar">
        <div class="metric-progress-fill ${overTarget ? 'ok' : ''}" style="width:${pct}%"></div>
      </div>
    </div>`;
}

function _antiMetricHtml(label, value) {
  const v = Number(value) || 0;
  return `
    <div class="metric-anti-row ${v > 0 ? 'bad' : 'ok'}">
      <span>${esc(label)}</span>
      <b>${v}</b>
    </div>`;
}

async function renderCabinetWeeklyDetail() {
  const host = document.getElementById('cabinet-weekly-detail');
  if (!host || !_cabinetIsOperatorLike()) { if (host) host.innerHTML = ''; return; }

  let data;
  try {
    data = await _loadCabinetData();
  } catch {
    host.innerHTML = '';
    return;
  }
  const wm = data.week_metrics;
  const cc = data.coin_calculation;
  if (!wm && !cc) {
    host.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>Показатели недели</h3></div>
        <div class="empty-line">Нет данных за последнюю неделю.</div>
      </div>`;
    return;
  }

  const bonusLabels = {
    top: 'Место в рейтинге недели', no_late: 'Неделя без опозданий',
    no_violation: 'Неделя без нарушений', nomination: 'Номинация недели',
    driver_thanks: 'Благодарность от водителя',
  };

  host.innerHTML = `
    <div class="cabinet-week-grid">
      ${wm ? `
      <div class="panel">
        <div class="panel-head">
          <h3>Показатели недели</h3>
          <span class="panel-badge">${esc(wm.period_start)} — ${esc(wm.period_end)}</span>
        </div>
        ${_metricBarHtml('Выработка часов', wm.hours, wm.hours_target, ' ч')}
        ${_metricBarHtml('Качество', wm.quality, wm.quality_target, '%')}
        ${_metricBarHtml('Эффективность', wm.efficiency, 0, '%')}
        <div class="metric-mini-row">
          <span>Звонков в час: <b>${levelNum(wm.calls_per_hour)}</b></span>
        </div>
        <div class="metric-anti-grid">
          ${_antiMetricHtml('Опоздания (мин)', wm.late_minutes)}
          ${_antiMetricHtml('Нарушения', wm.violations)}
          <div class="metric-anti-row ${wm.thanks_count > 0 ? 'good' : ''}">
            <span>Благодарности</span><b>${wm.thanks_count || 0}</b>
          </div>
        </div>
      </div>` : ''}

      ${cc ? `
      <div class="panel">
        <div class="panel-head">
          <h3>Расчёт коинов за неделю</h3>
          <span class="panel-badge ${cc.is_final ? 'badge-final' : 'badge-pending'}">${cc.is_final ? 'Начислено' : 'Предварительно'}</span>
        </div>
        <div class="coin-calc-row">
          <span>Итоговый балл</span><b>${levelNum(cc.contest_points)}</b>
        </div>
        <div class="coin-calc-row">
          <span>Базовые коины</span><b>${cc.base_coins} ₡</b>
        </div>
        ${cc.bonuses.map(b => `
          <div class="coin-calc-row coin-calc-bonus">
            <span>+ ${esc(bonusLabels[b.type] || b.label)}</span><b>+${b.coins} ₡</b>
          </div>`).join('')}
        <div class="coin-calc-row coin-calc-total">
          <span>Итого за неделю</span><b>${cc.total_week_coins} ₡</b>
        </div>
        ${!cc.is_final ? '<div class="empty-line" style="margin-top:8px">Расчёт предварительный — начисление ещё не применено.</div>' : ''}
      </div>` : ''}
    </div>`;
}

async function renderCabinetAchievements() {
  const host = document.getElementById('cabinet-achievements');
  if (!host || !_cabinetIsOperatorLike()) { if (host) host.innerHTML = ''; return; }

  let data;
  try {
    data = await _loadCabinetData();
  } catch {
    host.innerHTML = '';
    return;
  }
  const ach = data.achievements || { completed: [], in_progress: [] };

  const badgeHtml = (row, completed) => {
    const a = row.achievement || row;
    return `
    <div class="achievement-badge ${completed ? 'unlocked' : 'locked'}" title="${esc(a.description)}">
      <div class="achievement-icon">${achievementVisualIcon(a, 'achievement-card-icon')}</div>
      <div class="achievement-info">
        <div class="achievement-title">${esc(a.title)}</div>
        <div class="achievement-desc">${esc(a.description)}</div>
        ${completed
          ? `<div class="achievement-meta">Получено ×${row.times_awarded}${row.completed_at ? ' · ' + fmtDate(row.completed_at) : ''}</div>`
          : (a.condition_value > 0
              ? `<div class="achievement-progress-line">${levelNum(row.progress_value)} / ${levelNum(a.condition_value)}</div>`
              : '<div class="achievement-progress-line cell-muted">Не выполнено</div>')}
      </div>
    </div>`;
  };

  host.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Мои достижения</h3>
        <span class="panel-badge">${ach.completed.length} получено</span>
      </div>
      <div class="achievements-grid">
        ${ach.completed.map(r => badgeHtml(r, true)).join('')}
        ${ach.in_progress.map(r => badgeHtml(r, false)).join('')}
        ${!ach.completed.length && !ach.in_progress.length ? '<div class="empty-line">Достижения скоро появятся.</div>' : ''}
      </div>
    </div>`;
}

async function renderRatingOverviewTab(el) {
  const role  = STATE.user?.role || 'operator';
  const isOp  = role === 'operator';
  const canSelectOperator = isAdmin(role);
  let selectedOpId = canSelectOperator ? null : (STATE.user?.operator_id || null);
  let searchVal = '';
  let filterGroup = '';
  let filterLevel = '';
  let operatorSearchVal = '';
  let cmpMetric = 'points';
  let dynType = 'place';
  let personal = { myData: null, myTx: [], myDyn: null, myCmp: null };

  // Skeleton
  el.innerHTML = `
    <div class="rating-page">
      <div class="skel-block rating-skel-header"></div>
      <div class="rating-top-grid">
        <div class="skel-block rating-skel-card"></div>
        <div class="skel-block rating-skel-card"></div>
      </div>
      <div class="rating-mid-grid">
        <div class="skel-block rating-skel-card compact"></div>
        <div class="skel-block rating-skel-card compact"></div>
      </div>
      <div class="skel-block rating-skel-wide"></div>
      <div class="skel-block rating-skel-wide tall"></div>
    </div>`;

  try {
    async function fetchRequired(path) {
      const res = await fetch(api._base() + path, { credentials: 'include' });
      let data = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        const msg = data.detail || data.error || `Ошибка ${res.status}`;
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      return data;
    }

    async function fetchOptional(path, fallback) {
      try {
        const res = await fetch(api._base() + path, { credentials: 'include' });
        if (!res.ok) return fallback;
        return await res.json();
      } catch {
        return fallback;
      }
    }

    // Используем кешированные данные из STATE — без лишних запросов
    let ratingResp = { items: STATE.rating, total: STATE.rating.length, period: '—', updated_at: '' };
    let nominationsResp = STATE.nominations || { items: [] };

    // Если рейтинг пуст — грузим свежие данные (первый вход или инвалидация)
    if (!STATE.rating.length) {
      [ratingResp, nominationsResp] = await Promise.all([
        fetchRequired('/api/rating'),
        fetchOptional('/api/rating/nominations', { items: [] }),
      ]);
      STATE.rating = Array.isArray(ratingResp.items) ? ratingResp.items : [];
      STATE.nominations = nominationsResp;
    }

    const rows = Array.isArray(ratingResp.items) ? ratingResp.items : STATE.rating;
    const total = rows.length;
    const period = ratingResp.period && ratingResp.period !== '—' ? ratingResp.period : 'Период пока не рассчитан';
    const updatedAt = ratingResp.updated_at || '';
    const groups = [...new Set(rows.map(r => r.group_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    const levels = STATE.operatorLevels.length
      ? STATE.operatorLevels
      : [...new Map(rows.map(r => r.level).filter(Boolean).map(l => [l.code, l])).values()];
    const noms = Array.isArray(nominationsResp.items) ? nominationsResp.items : [];
    const operatorChoices = buildOperatorChoices();

    function hasPersonalTarget(opId) {
      return canSelectOperator ? Boolean(opId) : true;
    }

    function pathWithParams(path, params = {}, opId = selectedOpId) {
      const qp = new URLSearchParams(params);
      if (opId) qp.set('operator_id', opId);
      const qs = qp.toString();
      return qs ? `${path}?${qs}` : path;
    }

    async function fetchComparisonData(opId, metric) {
      if (!hasPersonalTarget(opId)) return { metric, items: [] };
      return fetchOptional(pathWithParams('/api/rating/me/comparison', { metric }, opId), { metric, items: [] });
    }

    async function fetchDynamicsData(opId, type) {
      if (!hasPersonalTarget(opId)) return { type, items: [] };
      return fetchOptional(pathWithParams('/api/rating/me/dynamics', { type, weeks: 8 }, opId), { type, items: [] });
    }

    async function fetchTransactionsData(opId) {
      if (!hasPersonalTarget(opId)) return [];
      const data = await fetchOptional(pathWithParams('/api/rating/me/transactions', { limit: 5 }, opId), []);
      return Array.isArray(data) ? data : [];
    }

    // Кеш личных данных — TTL 2 минуты, инвалидируется при смене оператора
    const _personalCacheKey = `rating:personal:${selectedOpId || 'me'}`;

    async function fetchPersonalData(opId) {
      if (!hasPersonalTarget(opId)) return { myData: null, myTx: [], myDyn: null, myCmp: null };

      // Используем SWR кеш — me + transactions загружаем вместе, dynamics отдельно
      const cached = swrReadRaw(_personalCacheKey);
      if (cached) return cached.data;

      const [myData, myTx] = await Promise.all([
        fetchOptional(pathWithParams('/api/rating/me', {}, opId), { no_operator: true }),
        fetchTransactionsData(opId),
      ]);
      const result = { myData, myTx, myDyn: null, myCmp: null };
      swrWriteRaw(_personalCacheKey, { data: result, ts: Date.now() });
      return result;
    }

    personal = await fetchPersonalData(selectedOpId);

    // dynamics и comparison — загружаем в фоне после рендера (не блокируем)
    async function loadPersonalExtras() {
      if (!hasPersonalTarget(selectedOpId)) return;
      const opId = selectedOpId;
      const [myDyn, myCmp] = await Promise.all([
        fetchDynamicsData(opId, dynType),
        fetchComparisonData(opId, cmpMetric),
      ]).catch(() => [null, null]);
      personal.myDyn = myDyn;
      personal.myCmp = myCmp;
      // Обновляем только блоки сравнения и динамики без полного ре-рендера
      const cmpBody = el.querySelector('#cmp-body');
      if (cmpBody) cmpBody.innerHTML = renderComparison(personal.myCmp, cmpMetric);
      loadDynCard();
    }

    function buildOperatorChoices() {
      const map = new Map();
      rows.forEach(r => {
        if (!r.operator_id) return;
        map.set(String(r.operator_id), {
          id: Number(r.operator_id),
          full_name: r.operator_name || 'Без имени',
          group_name: r.group_name || '',
        });
      });
      (STATE.adminOperators || []).forEach(o => {
        if (!o.id) return;
        map.set(String(o.id), {
          id: Number(o.id),
          full_name: o.full_name || 'Без имени',
          group_name: o.group_name || '',
        });
      });
      return [...map.values()].sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), 'ru'));
    }

    function isNum(v) {
      return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
    }

    function cleanNumber(v, decimals = 0, fallback = 'Нет данных') {
      if (!isNum(v)) return fallback;
      const n = Number(v);
      if (decimals > 0) return n.toFixed(decimals).replace(/\.0$/, '');
      return String(Math.round(n));
    }

    function cleanCoins(v, fallback = 'Нет данных') {
      return isNum(v) ? `${Math.round(Number(v))} ₡` : fallback;
    }

    function cleanDate(dt, fallback = 'Нет данных') {
      if (!dt) return fallback;
      const date = new Date(dt);
      if (Number.isNaN(date.getTime())) return fallback;
      return date.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
    }

    function cleanDateTime(dt, fallback = 'Нет данных') {
      if (!dt) return fallback;
      const date = new Date(dt);
      if (Number.isNaN(date.getTime())) return fallback;
      return date.toLocaleString('ru-RU', {
        day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
      });
    }

    function metricDecimals(metric) {
      return metric === 'coins' ? 0 : 1;
    }

    function renderHeader() {
      const myData = personal.myData;
      const bal = myData && !myData.no_operator && isNum(myData.total_balance)
        ? `<div class="rh-balance"><span>Баланс</span><b>${cleanCoins(myData.total_balance)}</b></div>`
        : '';
      return `<div class="rh-card">
        <div>
          <div class="rh-title">Рейтинг операторов</div>
          <div class="rh-meta">Период: ${esc(period)} · Участников: ${total} · Обновлено: ${cleanDateTime(updatedAt)}</div>
        </div>
        ${bal}
      </div>`;
    }

    function operatorOptionsHtml() {
      const q = operatorSearchVal.trim().toLowerCase();
      let visible = operatorChoices.filter(op =>
        !q ||
        String(op.full_name).toLowerCase().includes(q) ||
        String(op.group_name || '').toLowerCase().includes(q)
      );
      if (selectedOpId && !visible.some(op => op.id === selectedOpId)) {
        const selected = operatorChoices.find(op => op.id === selectedOpId);
        if (selected) visible = [selected, ...visible];
      }
      return `<option value="">Не выбран</option>${visible.map(op => `
        <option value="${op.id}" ${op.id === selectedOpId ? 'selected' : ''}>
          ${esc(op.full_name)}${op.group_name ? ` · ${esc(op.group_name)}` : ''}
        </option>`).join('')}`;
    }

    function renderOpSelector() {
      if (!canSelectOperator) return '';
      return `<div class="rating-card rating-card-body rating-selector-card">
        <div>
          <div class="rs-label">Карточка оператора</div>
          <div class="rs-hint">${selectedOpId ? 'Личные блоки показывают данные выбранного оператора' : 'Выберите оператора, чтобы посмотреть индивидуальный результат.'}</div>
        </div>
        <div class="rs-row">
          <input id="rating-op-search" class="form-input" placeholder="Поиск по ФИО" value="${esc(operatorSearchVal)}">
          <select id="rating-op-select" class="form-select">${operatorOptionsHtml()}</select>
        </div>
      </div>`;
    }

    function renderMyResult() {
      const myData = personal.myData;
      if (canSelectOperator && !selectedOpId) {
        return `<div class="rating-card rating-card-body r-my-card">
          <div class="rcard-title">Карточка оператора</div>
          <div class="r-empty-state">
            <div class="r-empty-title">Выберите оператора</div>
            <div class="r-empty-sub">После выбора здесь появятся место, баллы, коины и баланс.</div>
          </div>
        </div>`;
      }
      if (!myData || myData.no_operator) {
        return `<div class="rating-card rating-card-body r-my-card">
          <div class="rcard-title">Мой результат</div>
          <div class="r-empty-state">
            <div class="r-empty-title">Место пока не рассчитано</div>
            <div class="r-empty-sub">Участвуйте в конкурсе, чтобы попасть в рейтинг</div>
          </div>
        </div>`;
      }
      const delta = isNum(myData.place_change) ? Number(myData.place_change) : null;
      const deltaEl = delta === null ? '<span class="rd-neutral">без изменений</span>'
        : delta > 0 ? `<span class="rd-up">↑ +${delta} позиции</span>`
        : delta < 0 ? `<span class="rd-down">↓ ${Math.abs(delta)} позиции</span>`
        : '<span class="rd-neutral">без изменений</span>';

      const place = isNum(myData.place) && Number(myData.place) > 0 ? Number(myData.place) : null;
      const placeTotal = isNum(myData.total_participants) ? Number(myData.total_participants) : total;
      const placeEl = place
        ? `<div class="rmp-place">#${place} <span class="rmp-total">из ${placeTotal || total}</span></div>`
        : `<div class="rmp-noplace"><b>Место пока не рассчитано</b><span>Оператор не участвует в текущем периоде или расчёт ещё не выполнен.</span></div>`;

      return `<div class="rating-card rating-card-body r-my-card">
        <div class="rcard-title">${isOp ? 'Мой результат' : 'Карточка оператора'}</div>
        <div class="rmp-person">
          <b>${esc(myData.full_name || STATE.user?.full_name || 'Оператор')}</b>
          <span>${esc(myData.group_name || 'Группа не указана')}</span>
        </div>
        ${placeEl}
        <div class="rms-list">
          <div class="rms-row"><span class="rms-label">Баллы недели</span><span class="rms-val">${cleanNumber(myData.weekly_points, 1)}</span></div>
          <div class="rms-row"><span class="rms-label">Коины недели</span><span class="rms-val accent">${cleanCoins(myData.weekly_coins)}</span></div>
          <div class="rms-row"><span class="rms-label">Общий баланс</span><span class="rms-val">${cleanCoins(myData.total_balance)}</span></div>
          <div class="rms-row"><span class="rms-label">Динамика</span><span class="rms-val">${deltaEl}</span></div>
        </div>
      </div>`;
    }

    function renderPodium() {
      const top3 = rows.slice(0, 3);
      if (!top3.length) return `<div class="r-empty-state"><div class="r-empty-title">Пока нет данных</div></div>`;
      const medals = ['1', '2', '3'];
      return `<div class="podium-grid">
        ${[0, 1, 2].map(i => {
          const op = top3[i];
          if (!op) return `<div class="pod-card pod-empty">Пока нет данных</div>`;
          const isHighlighted = op.is_current_user || (selectedOpId && Number(op.operator_id) === selectedOpId);
          return `<div class="pod-card pod-${i + 1} ${isHighlighted ? 'pod-me' : ''}">
            <div class="pod-medal">${medals[i]}</div>
            <div class="pod-name">${esc(op.operator_name || 'Оператор')}</div>
            <div class="pod-group">${esc(op.group_name || 'Группа не указана')}</div>
            <div class="pod-pts">${cleanNumber(op.contest_points, 1)} баллов</div>
            <div class="pod-coins">${cleanCoins(op.coins_earned)}</div>
          </div>`;
        }).join('')}
      </div>`;
    }

    function renderComparison(data, metric) {
      if (!data?.items?.length) return `<div class="r-empty-state">
        <div class="r-empty-title">${canSelectOperator && !selectedOpId ? 'Выберите оператора' : 'Сравнение пока недоступно'}</div>
        <div class="r-empty-sub">Данные появятся после расчёта конкурса.</div>
      </div>`;
      const maxVal = Math.max(...data.items.map(i => Number(i.value) || 0), 1);
      return data.items.map(item => {
        const value = Number(item.value) || 0;
        const pct = Math.max(0, Math.min(100, Math.round((value / maxVal) * 100)));
        return `<div class="cmp-row ${item.is_highlight?'cmp-me':''}">
          <div class="cmp-label">${esc(item.label || 'Показатель')}</div>
          <div class="cmp-bar-wrap"><div class="cmp-bar" style="width:${pct}%"></div></div>
          <div class="cmp-value">${cleanNumber(value, metricDecimals(metric))}</div>
        </div>`;
      }).join('');
    }

    /* ── Новый блок динамики оператора (ТЗ §14-19) ──────────────── */
    let dynMode = 'points'; // points | coins | rank
    let dynData = null;

    // expose to global setDynMode
    window._setDynModeInternal = async function(mode) {
      dynMode = mode;
      // Обновляем визуально активную вкладку немедленно
      document.querySelectorAll('.dyn-tab').forEach(btn => {
        const m = btn.getAttribute('onclick')?.match(/setDynMode\('(\w+)'\)/)?.[1];
        if (m) btn.className = 'dyn-tab' + (m === mode ? ' dyn-tab-active' : '');
      });
      await loadDynCard();
    };

    async function loadDynCard() {
      // Для оператора используем его operator_id; для admin/manager — selectedOpId
      const opId = canSelectOperator ? (selectedOpId || null) : (STATE.user?.operator_id || null);
      try {
        const url = `/api/rating/operator-dynamics?mode=${dynMode}&limit=4${opId ? '&operator_id='+opId : ''}`;
        dynData = await api._req('GET', url);
      } catch(e) {
        dynData = null;
      }
      const box = document.getElementById('dyn-body');
      if (box) box.innerHTML = renderDynamics(dynData);
    }

    function renderDynamics(data) {
      if (!data || !data.items) {
        return renderDynEmpty(canSelectOperator && !selectedOpId ? 'Выберите оператора' : 'Нет данных');
      }
      const items = data.items;
      if (!items.length) {
        const reason = (canSelectOperator && !dynData?.operator_id)
          ? 'Выберите оператора для просмотра динамики.'
          : 'Нет данных для построения динамики.<br><small>Динамика появится после загрузки рабочих показателей (Excel-отчёта).</small>';
        return renderDynEmpty(reason);
      }

      // Определяем значения по режиму
      const isRank = dynMode === 'rank';
      const isCoins = dynMode === 'coins';
      const vals = items.map(i =>
        isRank ? (i.rank || 0) : isCoins ? (i.daily_coins || 0) : (i.daily_points || 0)
      );

      const summary = data.summary || {};
      const comps   = data.components_summary || {};

      return `
      <div class="dyn-card">
        <!-- Вкладки режима -->
        <div class="dyn-header">
          <div>
            <div class="dyn-title">Динамика оператора</div>
            <div class="dyn-subtitle">Последние ${items.length} рабочих дня с данными</div>
          </div>
          <div class="dyn-tabs">
            ${['points','coins','rank'].map(m => `
              <button class="dyn-tab${dynMode===m?' dyn-tab-active':''}" onclick="setDynMode('${m}')">
                ${m==='points'?'Баллы':m==='coins'?'Коины':'Место'}
              </button>`).join('')}
          </div>
        </div>

        <!-- График + Summary -->
        <div class="dyn-body-grid">
          <div class="dyn-chart-col">
            ${renderDynChart(items, vals, isRank)}
          </div>
          <div class="dyn-summary-col">
            ${renderDynSummary(summary, dynMode)}
          </div>
        </div>

        <!-- Расшифровка компонентов -->
        ${!isRank ? renderDynBreakdown(comps) : ''}
      </div>`;
    }

    function renderDynEmpty(msg) {
      return `<div class="r-empty-state"><div class="r-empty-title">${msg}</div></div>`;
    }

    function renderDynChart(items, vals, isRank) {
      if (items.length === 1) {
        // Одна точка — показываем без линии
        const v = vals[0];
        const it = items[0];
        return `<div class="dyn-single">
          <div class="dyn-single-val">${isRank ? '#'+v : cleanNumber(v,1)}</div>
          <div class="dyn-single-date">${esc(it.label)} ${esc(it.weekday)}</div>
          <div class="dyn-single-note">Недостаточно данных для сравнения</div>
        </div>`;
      }

      const W = 320, H = 110, PAD = 28, BOTTOM = 36;
      const n = items.length;
      const minV = Math.min(...vals), maxV = Math.max(...vals);
      // Добавляем padding к диапазону чтобы линия не была плоской
      const range = maxV === minV ? Math.max(maxV * 0.2, 5) : (maxV - minV);
      const yPad = range * 0.25;
      const lo = minV - yPad, hi = maxV + yPad;

      const toX = i => PAD + i * (W - PAD*2) / (n - 1);
      const toY = v => isRank
        ? PAD + ((v - minV + yPad) / (range + yPad*2)) * (H - PAD)       // rank: выше = ниже на графике
        : H - PAD - ((v - minV + yPad) / (range + yPad*2)) * (H - PAD);  // points/coins: выше = выше

      const pts = items.map((it, i) => ({ x: toX(i), y: toY(vals[i]), v: vals[i], it }));

      // Smooth bezier path
      function makePath(pts) {
        if (pts.length < 2) return '';
        let d = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i-1], cur = pts[i];
          const cx = (prev.x + cur.x) / 2;
          d += ` C ${cx} ${prev.y} ${cx} ${cur.y} ${cur.x} ${cur.y}`;
        }
        return d;
      }

      const linePath  = makePath(pts);
      const fillPath  = linePath + ` L ${pts[pts.length-1].x} ${H+4} L ${pts[0].x} ${H+4} Z`;

      // Y grid lines
      const gridCount = 3;
      const gridLines = Array.from({length: gridCount}, (_, i) => {
        const y = PAD + i * (H - PAD) / (gridCount - 1);
        return `<line x1="${PAD-4}" y1="${y}" x2="${W-PAD+4}" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="4 3"/>`;
      }).join('');

      return `<svg class="dyn-svg" viewBox="0 0 ${W} ${H + BOTTOM}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="dyn-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
          </linearGradient>
        </defs>

        ${gridLines}

        <!-- Заливка под линией -->
        <path d="${fillPath}" fill="url(#dyn-grad)"/>

        <!-- Линия -->
        <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2.5"
              stroke-linejoin="round" stroke-linecap="round"/>

        <!-- Точки + значения -->
        ${pts.map((p, i) => {
          const isLast = i === pts.length - 1;
          const labelY = Math.max(14, p.y - 10);
          const label  = isRank ? '#' + (p.v||0) : cleanNumber(p.v, isRank ? 0 : 1);
          return `
            <circle cx="${p.x}" cy="${p.y}" r="${isLast?5:4}"
              fill="${isLast?'var(--accent)':'var(--surface)'}"
              stroke="var(--accent)" stroke-width="2"/>
            <text x="${p.x}" y="${labelY}" text-anchor="middle"
              font-size="10" font-weight="${isLast?'700':'500'}"
              fill="${isLast?'var(--accent)':'var(--tx2)'}"
              font-family="Inter,system-ui,sans-serif">${label}</text>
            <text x="${p.x}" y="${H + 14}" text-anchor="middle"
              font-size="10" fill="var(--tx2)"
              font-family="Inter,system-ui,sans-serif">${esc(p.it.label)}</text>
            <text x="${p.x}" y="${H + 26}" text-anchor="middle"
              font-size="9" fill="var(--tx3)"
              font-family="Inter,system-ui,sans-serif">${esc(p.it.weekday)}</text>`;
        }).join('')}
      </svg>`;
    }

    function renderDynSummary(s, mode) {
      const isRank = mode === 'rank';
      const isCoins = mode === 'coins';
      const unit = isRank ? '' : isCoins ? ' ₡' : ' б';
      const todayFmt = s.today_value != null
        ? (isRank ? '#' + s.today_value : cleanNumber(s.today_value, 1) + unit)
        : '—';
      const avgFmt = s.average_4_days != null
        ? (isRank ? '#' + Math.round(s.average_4_days) : cleanNumber(s.average_4_days, 1) + unit)
        : '—';

      let deltaEl = '—';
      if (s.delta != null) {
        const sign = isRank
          ? (s.delta < 0 ? '▲' : s.delta > 0 ? '▼' : '=')   // rank: меньше = лучше
          : (s.delta > 0 ? '▲' : s.delta < 0 ? '▼' : '=');
        const cls  = isRank
          ? (s.delta < 0 ? 'dyn-delta-up' : s.delta > 0 ? 'dyn-delta-dn' : 'dyn-delta-eq')
          : (s.delta > 0 ? 'dyn-delta-up' : s.delta < 0 ? 'dyn-delta-dn' : 'dyn-delta-eq');
        const absDelta = Math.abs(s.delta);
        const pctPart  = s.delta_percent != null ? ` (${s.delta_percent > 0 ? '+' : ''}${cleanNumber(s.delta_percent,1)}%)` : '';
        deltaEl = `<span class="${cls}">${sign} ${isRank ? absDelta + ' поз.' : (s.delta > 0 ? '+' : '') + cleanNumber(s.delta, 1) + unit + pctPart}</span>`;
      }

      return `<div class="dyn-summary">
        <div class="dyn-sum-row">
          <span class="dyn-sum-lbl">${isRank ? 'Позиция сегодня' : isCoins ? 'Коины сегодня' : 'Баллы сегодня'}</span>
          <span class="dyn-sum-val dyn-sum-main">${todayFmt}</span>
        </div>
        <div class="dyn-sum-row">
          <span class="dyn-sum-lbl">Изменение</span>
          <span class="dyn-sum-val">${deltaEl}</span>
        </div>
        <div class="dyn-sum-row">
          <span class="dyn-sum-lbl">Среднее за ${dynData?.items?.length||4} дня</span>
          <span class="dyn-sum-val">${avgFmt}</span>
        </div>
      </div>`;
    }

    function renderDynBreakdown(c) {
      const total = (c.hours_points||0) + (c.kvz||0) + (c.efficiency||0);
      const pct = v => total > 0 ? Math.round(v/total*100) : 0;
      const bar = (v, max, color) => {
        const w = max > 0 ? Math.round(clamp01(v/max)*100) : 0;
        return `<div class="dyn-bar-bg"><div class="dyn-bar-fill" style="width:${w}%;background:${color}"></div></div>`;
      };
      const clamp01 = x => Math.min(1, Math.max(0, x));
      const maxComp = Math.max(c.hours_points||0, c.kvz||0, c.efficiency||0, 0.1);

      return `<div class="dyn-breakdown">
        <div class="dyn-bk-title">Баллы за день формируются без учёта качества, только из:</div>
        <div class="dyn-bk-rows">
          <div class="dyn-bk-row">
            <span class="dyn-bk-icon">⏱</span>
            <span class="dyn-bk-lbl">Часы</span>
            ${bar(c.hours_points||0, maxComp, '#3b82f6')}
            <span class="dyn-bk-val">${cleanNumber(c.hours_points,1)}</span>
          </div>
          <div class="dyn-bk-row">
            <span class="dyn-bk-icon">📞</span>
            <span class="dyn-bk-lbl">КВЗ</span>
            ${bar(c.kvz||0, maxComp, '#10b981')}
            <span class="dyn-bk-val">${cleanNumber(c.kvz,2)}</span>
          </div>
          <div class="dyn-bk-row">
            <span class="dyn-bk-icon">⚡</span>
            <span class="dyn-bk-lbl">Эффективность</span>
            ${bar(c.efficiency||0, maxComp, '#8b5cf6')}
            <span class="dyn-bk-val">${cleanNumber(c.efficiency,1)}%</span>
          </div>
          ${(c.penalty_points||0) > 0 ? `<div class="dyn-bk-row">
            <span class="dyn-bk-icon">⚠</span>
            <span class="dyn-bk-lbl">Штрафы</span>
            ${bar(c.penalty_points||0, maxComp, '#ef4444')}
            <span class="dyn-bk-val dyn-bk-penalty">−${cleanNumber(c.penalty_points,1)}</span>
          </div>` : ''}
        </div>
      </div>`;
    }

    function renderNominations() {
      if (!noms.length) return `<div class="r-empty-state"><div class="r-empty-title">Номинации недели пока не определены.</div></div>`;
      return `<div class="nom-grid-v2">
        ${noms.map(n => `<div class="nom-card-v2 ${n.is_current_user?'nom-me-v2':''}">
          ${n.is_current_user ? '<div class="nom-you">Это вы</div>' : ''}
          <div class="nom-t">${esc(n.title || 'Номинация')}</div>
          <div class="nom-n">${esc(n.winner_name || 'Пока нет победителя')}</div>
          <div class="nom-v">${esc(n.value || 'Нет данных')}</div>
          <div class="nom-c">+${cleanCoins(n.coins_bonus, '0 ₡')}</div>
        </div>`).join('')}
      </div>`;
    }

    function renderTx() {
      const txs = Array.isArray(personal.myTx) ? personal.myTx.slice(0, 5) : [];
      if (canSelectOperator && !selectedOpId) return `<div class="r-empty-state">
        <div class="r-empty-title">Выберите оператора</div>
        <div class="r-empty-sub">Здесь будут последние начисления выбранного оператора.</div>
      </div>`;
      if (!txs.length) return `<div class="r-empty-state"><div class="r-empty-title">Начислений пока нет.</div></div>`;
      return txs.map(t => {
        const amount = Number(t.amount) || 0;
        const comment = t.comment || t.type || 'Операция';
        return `
        <div class="rtx2-row ${amount >= 0 ? 'rtx2-plus' : 'rtx2-minus'}">
          <div class="rtx2-amount">${amount >= 0 ? '+' : ''}${cleanCoins(amount)}</div>
          <div class="rtx2-comment" title="${esc(comment)}">${esc(comment)}</div>
          <div class="rtx2-date">${cleanDate(t.created_at, '')}</div>
        </div>`;
      }).join('');
    }

    function filteredRows() {
      const q = searchVal.trim().toLowerCase();
      return rows.filter(r =>
        (!q || String(r.operator_name || '').toLowerCase().includes(q)) &&
        (!filterGroup || r.group_name === filterGroup) &&
        (!filterLevel || r.level?.code === filterLevel)
      );
    }

    function renderTable() {
      const fr = filteredRows();
      if (!fr.length) return `<div class="r-empty-state">
        <div class="r-empty-title">Рейтинг пока не сформирован.</div>
        <div class="r-empty-sub">Данные появятся после расчёта конкурса.</div>
      </div>`;
      const myData = personal.myData || {};
      const myOpId = myData.operator_id || null;
      return `<div class="table-wrap rating-table-wrap"><table class="data-table rating-table">
        <thead><tr>
          <th style="width:72px;text-align:center">Место</th>
          <th>Оператор</th><th>Группа</th>
          <th style="text-align:right">Баллы</th>
          <th style="text-align:right">Коины</th>
          <th style="text-align:right">Баланс</th>
          <th style="text-align:center">Дин.</th>
        </tr></thead>
        <tbody>
          ${fr.map(r => {
            const isMe = r.is_current_user || (myOpId && r.operator_id == myOpId) || (selectedOpId && r.operator_id == selectedOpId);
            const place = isNum(r.rank_position) && Number(r.rank_position) > 0 ? Number(r.rank_position) : null;
            const d = isNum(r.rank_delta) ? Number(r.rank_delta) : null;
            const dEl = d === null ? '<span class="rd-neutral">без изм.</span>'
              : d > 0 ? `<span class="rd-up">↑${d}</span>`
              : d < 0 ? `<span class="rd-down">↓${Math.abs(d)}</span>`
              : '<span class="rd-neutral">без изм.</span>';
            const badgeText = r.is_current_user ? 'Вы' : (selectedOpId && r.operator_id == selectedOpId ? 'Выбран' : '');
            return `<tr class="${isMe?'rating-my-row':''}">
              <td style="text-align:center">${place ? `<span class="rank-badge ${place <= 3 ? 'rank-top' : ''}">${place}</span>` : '<span class="rank-missing">Нет места</span>'}</td>
              <td class="name-cell">${esc(r.operator_name || 'Оператор')}${levelBadgeHtml(r.level)}${badgeText ? `<span class="me-badge">${badgeText}</span>` : ''}</td>
              <td>${esc(r.group_name || 'Группа не указана')}</td>
              <td style="text-align:right"><b>${cleanNumber(r.contest_points,1)}</b></td>
              <td style="text-align:right"><b class="accent-text">${cleanCoins(r.coins_earned)}</b></td>
              <td style="text-align:right">${cleanCoins(r.total_balance)}</td>
              <td style="text-align:center">${dEl}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
      ${isNum(myData.place) && Number(myData.place) > 10 ? `<div class="rating-my-sticky">Ваше место: <b>#${Number(myData.place)}</b> · ${esc(myData.full_name||'')} · ${cleanNumber(myData.weekly_points,1)} баллов · ${cleanCoins(myData.weekly_coins)}</div>` : ''}`;
    }

    function buildPage() {
      el.innerHTML = `
        <div class="rating-page">

          ${renderHeader()}
          ${renderOpSelector()}

          <div class="rating-top-grid">
            ${renderMyResult()}
            <div class="rating-card rating-card-body">
              <div class="rcard-title">Топ-3 недели</div>
              ${renderPodium()}
            </div>
          </div>

          <div class="rating-mid-grid">
            <div class="rating-card rating-card-body">
              <div class="rcard-title-row">
                <span class="rcard-title">Сравнение</span>
                <div class="metric-tabs" id="cmp-tabs">
                  <button class="metric-tab ${cmpMetric === 'points' ? 'active' : ''}" data-metric="points">Баллы</button>
                  <button class="metric-tab ${cmpMetric === 'coins' ? 'active' : ''}" data-metric="coins">Коины</button>
                  <button class="metric-tab ${cmpMetric === 'quality' ? 'active' : ''}" data-metric="quality">Качество</button>
                  <button class="metric-tab ${cmpMetric === 'efficiency' ? 'active' : ''}" data-metric="efficiency">Эффективность</button>
                </div>
              </div>
              <div id="cmp-body">${renderComparison(personal.myCmp, cmpMetric)}</div>
            </div>
            <div class="rating-card rating-card-body">
              <div id="dyn-body"><div class="loading-state" style="min-height:120px"><div class="loading-spinner"></div></div></div>
            </div>
          </div>

          <div class="rating-card rating-card-body">
            <div class="rcard-title">Номинации недели</div>
            ${renderNominations()}
          </div>

          <div class="rating-card rating-card-body">
            <div class="rcard-title">${isOp ? 'Мои последние начисления' : 'Последние начисления оператора'}</div>
            ${renderTx()}
          </div>

          <div class="rating-card rating-card-body">
            <div class="rcard-title-row">
              <span class="rcard-title">Общий рейтинг</span>
              <span class="panel-badge">${total} участников</span>
            </div>
            <div class="rating-filters">
              <input id="rating-search" class="form-input" placeholder="Поиск по ФИО…" style="max-width:240px">
              <select id="rating-group-filter" class="form-select" style="max-width:180px">
                <option value="">Все группы</option>
                ${groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}
              </select>
              <select id="rating-level-filter" class="form-select" style="max-width:170px">
                <option value="">Все уровни</option>
                ${levels.map(l => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('')}
              </select>
            </div>
            <div id="rating-table-body">${renderTable()}</div>
          </div>

        </div>`;

      // Events
      el.querySelector('#rating-search')?.addEventListener('input', e => {
        searchVal = e.target.value;
        el.querySelector('#rating-table-body').innerHTML = renderTable();
      });
      el.querySelector('#rating-group-filter')?.addEventListener('change', e => {
        filterGroup = e.target.value;
        el.querySelector('#rating-table-body').innerHTML = renderTable();
      });
      el.querySelector('#rating-level-filter')?.addEventListener('change', e => {
        filterLevel = e.target.value;
        el.querySelector('#rating-table-body').innerHTML = renderTable();
      });
      el.querySelector('#rating-op-search')?.addEventListener('input', e => {
        operatorSearchVal = e.target.value;
        const select = el.querySelector('#rating-op-select');
        if (select) select.innerHTML = operatorOptionsHtml();
      });

      el.querySelectorAll('#cmp-tabs .metric-tab').forEach(btn => {
        btn.addEventListener('click', async () => {
          el.querySelectorAll('#cmp-tabs .metric-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          cmpMetric = btn.dataset.metric;
          const body = el.querySelector('#cmp-body');
          if (body) body.innerHTML = '<div class="rating-inline-skeleton"></div>';
          // comparison не кешируем — данные специфичны для метрики
          personal.myCmp = await fetchComparisonData(selectedOpId, cmpMetric);
          if (body) body.innerHTML = renderComparison(personal.myCmp, cmpMetric);
        });
      });

      // dyn tabs are inside renderDynamics — handled by setDynMode

      el.querySelector('#rating-op-select')?.addEventListener('change', async e => {
        selectedOpId = e.target.value ? +e.target.value : null;
        // Инвалидируем кеш предыдущего оператора
        swrInvalidate(`rating:personal:${selectedOpId || 'me'}`);
        personal = await fetchPersonalData(selectedOpId);
        buildPage();
        setTimeout(() => loadPersonalExtras(), 50);
      });
    }

    buildPage();
    // Загружаем extras (динамика, сравнение) в фоне — не блокируем рендер
    setTimeout(async () => {
      await loadPersonalExtras();
      _cacheViewHtml('rating'); // кешируем HTML после полной загрузки
    }, 100);

  } catch(err) {
    const content = el.querySelector('.rating-page');
    if (content) content.innerHTML += `<div class="status-line status-error">Не удалось загрузить рейтинг: ${esc(err.message)}</div>`;
    else el.innerHTML += `<div class="status-line status-error">Не удалось загрузить рейтинг: ${esc(err.message)}</div>`;
  }
}

function miniRating(limit, highlightId) {
  const rows = Array.isArray(STATE.rating) ? STATE.rating.slice(0, limit) : [];
  if (!rows.length) return '<div class="empty-line">Нет данных</div>';
  return '<div class="mini-rating">' + rows.map((r, idx) => {
    const rank = r.rank_position || (idx + 1);
    const isMe = r.operator_id === highlightId;
    const topCls = rank <= 3 ? 'rank-top' : '';
    return `<div class="mini-rating-row ${isMe ? 'mini-me' : ''}">
      <span class="rank-badge ${topCls}">${rank}</span>
      <span class="mini-name">${esc(r.operator_name || 'Оператор')} ${levelBadgeHtml(r.level, 'level-badge-mini')}</span>
      <span class="mini-coins">${r.coins_earned || 0} ₡</span>
      <span class="mini-pts">${(r.contest_points || 0).toFixed(1)}</span>
    </div>`;
  }).join('') + '</div>';
}

/* ══════════════════════════════════════
   VIEW: МАГАЗИН
══════════════════════════════════════ */
const SHOP_CATEGORIES = {
  all: { label: 'Все бонусы' },
  quick: { label: 'Быстрые' },
  workday: { label: 'Комфорт на смене' },
  recognition: { label: 'Признание' },
  gifts: { label: 'Подарки' },
  other: { label: 'Другие' },
};
let _shopCategory = 'all';
let _shopAffordableOnly = false;

function shopCategory(item) {
  return SHOP_CATEGORIES[item?.category] ? item.category : 'other';
}

function shopCategoryIcon(category) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const paths = {
    quick: '<path d="M12 2v6m0 8v6M4.93 4.93l4.24 4.24m5.66 5.66 4.24 4.24M2 12h6m8 0h6M4.93 19.07l4.24-4.24m5.66-5.66 4.24-4.24"/>',
    workday: '<path d="M8 2v4m8-4v4M3 10h18"/><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 15h8"/>',
    recognition: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/>',
    gifts: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M7.5 8C5 8 4 6.8 4 5.5S5 3 6.5 3C9 3 12 8 12 8m4.5 0C19 8 20 6.8 20 5.5S19 3 17.5 3C15 3 12 8 12 8"/>',
    other: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  };
  return `<svg ${common}>${paths[category] || paths.other}</svg>`;
}

function shopItemIcon(item) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const text = `${item?.title || ''} ${item?.category || ''}`.toLowerCase();
  let path = '';
  if (/музык|плейлист/.test(text)) path = '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>';
  else if (/кофе|чай/.test(text)) path = '<path d="M4 8h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2M6 3v2m4-2v2m4-2v2"/>';
  else if (/перерыв|отдых/.test(text)) path = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
  else if (/мест|смен/.test(text)) path = '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8m-4-4v4"/>';
  else if (/круж/.test(text)) path = '<path d="M5 7h11v9a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V7Z"/><path d="M16 9h2a2 2 0 0 1 0 4h-2"/>';
  else if (/обед|пицц|еда/.test(text)) path = '<path d="M7 3v8m-3-8v5a3 3 0 0 0 6 0V3m7 0v18m0-18c-2 2-3 4-3 7h3"/>';
  else if (/сертификат|подар/.test(text)) path = '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M7.5 8C5 8 4 6.8 4 5.5S5 3 6.5 3C9 3 12 8 12 8m4.5 0C19 8 20 6.8 20 5.5S19 3 17.5 3C15 3 12 8 12 8"/>';
  else if (/благодар|статус|звезд/.test(text)) path = '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/>';
  else path = shopCategoryIcon(shopCategory(item)).replace(/^<svg[^>]*>|<\/svg>$/g, '');
  return `<svg ${common}>${path}</svg>`;
}

function shopAvailableCoupons() {
  return (STATE.shopDiscounts || [])
    .filter(coupon => coupon.status === 'available')
    .sort((a, b) => (Number(b.percent) - Number(a.percent)) || (Number(a.id) - Number(b.id)));
}

function shopItemState(item, balance, role = 'operator', coupon = null) {
  const levels = STATE.operatorLevels || [];
  const requiredLevel = item.min_level_id ? levels.find(level => level.id === item.min_level_id) : null;
  const currentLevel = STATE.myLevel?.level || null;
  const levelLocked = role === 'operator' && requiredLevel
    && (!currentLevel || (currentLevel.sort_order || 0) < (requiredLevel.sort_order || 0));
  const now = new Date();
  const notStartedYet = item.starts_at && new Date(item.starts_at) > now;
  const alreadyEnded = item.ends_at && new Date(item.ends_at) < now;
  const outOfStock = item.stock_remaining != null && item.stock_remaining <= 0;
  const personalLimitHit = !!item.operator_limit_reached;
  const blocked = !!(notStartedYet || alreadyEnded || outOfStock || personalLimitHit);
  const originalPrice = Number(item.price) || 0;
  const discountPercent = coupon ? Math.max(1, Math.min(90, Number(coupon.percent) || 10)) : 0;
  const discountAmount = Math.floor(originalPrice * discountPercent / 100);
  const effectivePrice = Math.max(0, originalPrice - discountAmount);
  const canBuy = role === 'operator' && balance >= effectivePrice && !levelLocked && !blocked;
  const needMore = role === 'operator' && balance < effectivePrice ? effectivePrice - balance : 0;
  let label = 'Получить бонус';
  if (levelLocked) label = `С уровня «${requiredLevel.name}»`;
  else if (notStartedYet) label = `Доступно с ${fmtDate(item.starts_at)}`;
  else if (alreadyEnded) label = 'Предложение завершено';
  else if (outOfStock) label = 'Закончилось';
  else if (personalLimitHit) label = 'Лимит использован';
  else if (needMore > 0) label = `Нужно ещё ${needMore} коинов`;
  return { requiredLevel, levelLocked, notStartedYet, alreadyEnded, outOfStock, personalLimitHit, blocked, canBuy, needMore, label, originalPrice, discountPercent, discountAmount, effectivePrice, coupon };
}

function renderShop() {
  const el = document.getElementById('view-shop');
  if (!el) return;
  const items = STATE.shopItems || [];
  const balance = STATE.wallet?.current_balance ?? 0;
  const role = STATE.user?.role;

  if (role === 'operator') {
    renderOperatorShop(el, items, balance);
    return;
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Магазин</div><h2 class="section-title">Магазин бонусов</h2></div>
      <div class="header-right">
        ${role === 'operator' ? `<div class="balance-chip">Баланс: <b>${balance} ₡</b></div>` : ''}
        ${isAdmin(role) ? `<button class="btn-primary btn-sm" onclick="showAddItemModal()">+ Добавить бонус</button>` : ''}
      </div>
    </div>
    <div class="shop-grid">
      ${items.length ? items.map(item => shopCard(item, balance, role)).join('') : '<div class="empty-state">Магазин пуст</div>'}
    </div>`;

  el.querySelectorAll('.edit-item-btn').forEach(btn => {
    const item = items.find(i => i.id === +btn.dataset.id);
    if (item) btn.addEventListener('click', () => showEditItemModal(item));
  });
}

function renderOperatorShop(el, items, balance) {
  const purchases = STATE.purchases || [];
  const coupons = shopAvailableCoupons();
  const bestCoupon = coupons[0] || null;
  const states = new Map(items.map(item => [item.id, shopItemState(item, balance, 'operator', bestCoupon)]));
  const affordableCount = items.filter(item => states.get(item.id).canBuy).length;
  const activeRequests = purchases.filter(row => ['new', 'pending', 'approved'].includes(row.status)).length;
  const categoryItems = items.filter(item => _shopCategory === 'all' || shopCategory(item) === _shopCategory);
  const visibleItems = categoryItems.filter(item => !_shopAffordableOnly || states.get(item.id).canBuy);
  const availableCategories = Object.keys(SHOP_CATEGORIES).filter(category =>
    category === 'all' || items.some(item => shopCategory(item) === category)
  );

  el.innerHTML = `
    <div class="view-header shop-v2-header">
      <div>
        <div class="section-kicker">Магазин</div>
        <h2 class="section-title">Бонусы за ваши результаты</h2>
        <p class="shop-v2-subtitle">Обменивайте заработанные коины на полезные бонусы для работы и отдыха.</p>
      </div>
      <div class="shop-v2-header-meta">
        ${coupons.length ? `<div class="shop-v2-coupon-chip"><span>Скидки Wheel of WOW</span><b>${coupons.length} × ${bestCoupon.percent}%</b></div>` : ''}
        <div class="shop-v2-balance"><span>Ваш баланс</span><b>${balance} коинов</b></div>
      </div>
    </div>

    <section class="shop-v2-summary" aria-label="Сводка магазина">
      <div><span>Можно получить сейчас</span><b>${affordableCount}</b><small>по текущему балансу</small></div>
      <div><span>Активные заявки</span><b>${activeRequests}</b><small>ожидают или выполняются</small></div>
      <div><span>Скидки Wheel of WOW</span><b>${coupons.length}</b><small>${coupons.length ? `каждая применяется отдельно, по ${bestCoupon.percent}%` : 'пока нет доступных купонов'}</small></div>
    </section>

    <section class="panel shop-v2-catalog">
      <div class="shop-v2-catalog-head">
        <div><span>Каталог</span><h3>Выберите бонус</h3></div>
        <label class="shop-v2-affordable"><input type="checkbox" id="shop-affordable-only" ${_shopAffordableOnly ? 'checked' : ''}><span>Только доступные</span></label>
      </div>
      <div class="shop-v2-tabs" role="tablist">
        ${availableCategories.map(category => {
          const count = category === 'all' ? items.length : items.filter(item => shopCategory(item) === category).length;
          return `<button type="button" class="shop-v2-tab ${_shopCategory === category ? 'active' : ''}" data-shop-category="${category}">${SHOP_CATEGORIES[category].label}<span>${count}</span></button>`;
        }).join('')}
      </div>
      <div class="shop-v2-grid">
        ${visibleItems.length ? visibleItems.map(item => shopOperatorCard(item, balance, states.get(item.id))).join('') : `
          <div class="shop-v2-empty"><b>В этой категории пока ничего нет</b><span>Снимите фильтр или выберите другой раздел каталога.</span></div>`}
      </div>
    </section>

    <section class="panel shop-v2-history">
      <div class="shop-v2-history-head"><div><span>Мои заказы</span><h3>История заявок</h3></div><b>${purchases.length}</b></div>
      ${shopPurchaseHistory(purchases, items)}
    </section>`;

  el.querySelectorAll('[data-shop-category]').forEach(button => {
    button.addEventListener('click', () => {
      _shopCategory = button.dataset.shopCategory || 'all';
      renderShop();
    });
  });
  el.querySelector('#shop-affordable-only')?.addEventListener('change', event => {
    _shopAffordableOnly = event.target.checked;
    renderShop();
  });
  el.querySelectorAll('.shop-v2-buy').forEach(button => {
    button.addEventListener('click', () => openShopPurchaseModal(+button.dataset.id));
  });
}

function shopOperatorCard(item, balance, state = shopItemState(item, balance)) {
  const category = shopCategory(item);
  const badges = [];
  if (state.requiredLevel) badges.push(`<span>С уровня «${esc(state.requiredLevel.name)}»</span>`);
  if (item.stock_remaining != null) badges.push(`<span>${state.outOfStock ? 'Нет в наличии' : `Осталось ${item.stock_remaining}`}</span>`);
  if (item.purchase_limit_per_operator > 0) badges.push(`<span>${item.operator_purchased_count || 0} из ${item.purchase_limit_per_operator} получено</span>`);
  if (item.ends_at && !state.alreadyEnded) badges.push(`<span>До ${fmtDate(item.ends_at)}</span>`);
  return `<article class="shop-v2-card ${state.canBuy ? 'is-available' : ''} ${state.blocked ? 'is-blocked' : ''}">
    <div class="shop-v2-card-top">
      <span class="shop-v2-icon is-${category}">${shopItemIcon(item)}</span>
      <span class="shop-v2-category">${SHOP_CATEGORIES[category].label}</span>
    </div>
    <div class="shop-v2-card-copy"><h4>${esc(item.title)}</h4></div>
    ${badges.length ? `<div class="shop-v2-card-badges">${badges.join('')}</div>` : ''}
    <div class="shop-v2-card-footer">
      <div class="shop-v2-price-row">
        <div class="shop-v2-price-stack">
          ${state.discountPercent ? `<s>${state.originalPrice}</s><b>${state.effectivePrice} <span>коинов</span></b><em>−${state.discountPercent}% по купону</em>` : `<b>${state.originalPrice} <span>коинов</span></b>`}
        </div>
        ${state.needMore > 0 ? `<strong class="shop-v2-shortfall">Не хватает ${state.needMore} коинов</strong>` : '<small>спишутся после оформления</small>'}
      </div>
      <button type="button" class="${state.canBuy ? 'btn-primary' : 'btn-disabled'} shop-v2-buy" data-id="${item.id}" ${state.canBuy ? '' : 'disabled'}>${esc(state.label)}</button>
    </div>
  </article>`;
}

function shopPurchaseHistory(purchases, items) {
  if (!purchases.length) return '<div class="shop-v2-history-empty"><b>Заявок пока нет</b><span>Выбранные бонусы и их статусы появятся здесь.</span></div>';
  const statusMeta = {
    new: ['На рассмотрении', 'is-waiting'], pending: ['На рассмотрении', 'is-waiting'],
    approved: ['Одобрено', 'is-approved'], completed: ['Получено', 'is-completed'], rejected: ['Отклонено', 'is-rejected'],
  };
  return `<div class="shop-v2-order-list">${purchases.slice(0, 8).map(row => {
    const item = items.find(candidate => candidate.id === row.shop_item_id);
    const meta = statusMeta[row.status] || [row.status, ''];
    return `<div class="shop-v2-order">
      <span class="shop-v2-order-icon">${shopItemIcon(item)}</span>
      <div><b>${esc(item?.title || `Бонус #${row.shop_item_id}`)}</b><small>${fmtDate(row.created_at)} · ${row.price} коинов${row.discount_percent ? ` · скидка ${row.discount_percent}%` : ''}${row.reject_reason ? ` · ${esc(row.reject_reason)}` : ''}</small></div>
      <span class="shop-v2-order-status ${meta[1]}">${meta[0]}</span>
    </div>`;
  }).join('')}</div>`;
}

function openShopPurchaseModal(itemId) {
  const item = (STATE.shopItems || []).find(candidate => candidate.id === itemId);
  if (!item) return;
  const balance = STATE.wallet?.current_balance ?? 0;
  const coupon = shopAvailableCoupons()[0] || null;
  const state = shopItemState(item, balance, 'operator', coupon);
  if (!state.canBuy) return;
  const category = shopCategory(item);
  showModal(`
    <div class="shop-v2-confirm">
      <span class="shop-v2-icon is-${category}">${shopItemIcon(item)}</span>
      <div class="section-kicker">Подтверждение</div>
      <h3 class="modal-title">${esc(item.title)}</h3>
      ${coupon ? `<label class="shop-v2-discount-option">
        <input type="checkbox" id="shop-use-discount" data-coupon-id="${coupon.id}" data-original-price="${state.originalPrice}" data-discounted-price="${state.effectivePrice}" data-balance="${balance}" checked onchange="updateShopDiscountPreview()">
        <span><b>Применить скидку ${coupon.percent}%</b><small>Доступно купонов: ${shopAvailableCoupons().length}. Спишется только один.</small></span>
      </label>` : ''}
      <div class="shop-v2-confirm-price"><span>Стоимость</span><b id="shop-confirm-price">${state.effectivePrice} коинов</b></div>
      <div class="shop-v2-confirm-price"><span>Останется на балансе</span><b id="shop-confirm-rest">${Math.max(0, balance - state.effectivePrice)} коинов</b></div>
      <small>После оформления коины резервируются. Если заявку отклонят, они автоматически вернутся на баланс.</small>
      <div id="shop-buy-error" class="status-line"></div>
      <div class="shop-v2-confirm-actions"><button class="btn-outline" onclick="closeModal()">Отмена</button><button class="btn-primary" id="shop-confirm-buy" onclick="submitShopPurchase(${item.id})">Отправить заявку</button></div>
    </div>`);
}

function updateShopDiscountPreview() {
  const toggle = document.getElementById('shop-use-discount');
  if (!toggle) return;
  const originalPrice = Number(toggle.dataset.originalPrice) || 0;
  const discountedPrice = Number(toggle.dataset.discountedPrice) || originalPrice;
  const balance = Number(toggle.dataset.balance) || 0;
  const price = toggle.checked ? discountedPrice : originalPrice;
  const priceEl = document.getElementById('shop-confirm-price');
  const restEl = document.getElementById('shop-confirm-rest');
  const submit = document.getElementById('shop-confirm-buy');
  if (priceEl) priceEl.textContent = `${price} коинов`;
  if (restEl) restEl.textContent = `${Math.max(0, balance - price)} коинов`;
  if (submit) submit.disabled = balance < price;
}

async function submitShopPurchase(itemId) {
  const button = document.getElementById('shop-confirm-buy');
  const error = document.getElementById('shop-buy-error');
  if (button) { button.disabled = true; button.textContent = 'Оформляем…'; }
  try {
    const couponToggle = document.getElementById('shop-use-discount');
    const couponId = couponToggle?.checked ? Number(couponToggle.dataset.couponId) : null;
    await api.buyItem(itemId, couponId);
    swrInvalidate('shop:');
    const [wallet, purchases, items, discounts] = await Promise.all([api.myWallet(), api.listPurchases(), api.listShopItems(), api.listShopDiscounts()]);
    STATE.wallet = wallet;
    STATE.purchases = purchases;
    STATE.shopItems = items;
    STATE.shopDiscounts = discounts;
    closeModal();
    showToast('Заявка отправлена руководителю', 'ok');
    renderShop();
  } catch (err) {
    if (error) error.textContent = err.message || 'Не удалось оформить заявку';
    if (button) { button.disabled = false; button.textContent = 'Отправить заявку'; }
  }
}

function shopCard(item, balance, role) {
  const state = shopItemState(item, balance, role);
  const { requiredLevel, notStartedYet, alreadyEnded, outOfStock, canBuy } = state;

  const seasonBadges = [];
  if (item.stock_remaining != null) seasonBadges.push(`<span class="shop-badge ${outOfStock ? 'shop-badge-danger' : ''}">Осталось: ${item.stock_remaining}</span>`);
  if (item.purchase_limit_per_operator > 0 && role === 'operator') seasonBadges.push(`<span class="shop-badge">Взято: ${item.operator_purchased_count || 0} из ${item.purchase_limit_per_operator}</span>`);
  if (notStartedYet) seasonBadges.push(`<span class="shop-badge shop-badge-info">Скоро: с ${fmtDate(item.starts_at)}</span>`);
  else if (item.ends_at && !alreadyEnded) seasonBadges.push(`<span class="shop-badge shop-badge-info">До ${fmtDate(item.ends_at)}</span>`);
  else if (alreadyEnded) seasonBadges.push(`<span class="shop-badge shop-badge-danger">Завершено</span>`);

  return `<div class="shop-card ${canBuy?'shop-card-available':''} ${state.blocked && role==='operator' ? 'shop-card-unavailable' : ''}">
    <div class="shop-card-title">${esc(item.title)}</div>
    <div class="shop-card-desc">${esc(item.description)}</div>
    <div class="shop-card-price">${item.price} <span class="price-unit">коинов</span></div>
    ${requiredLevel ? `<div class="shop-card-desc">Доступно с уровня «${esc(requiredLevel.name)}»</div>` : ''}
    ${seasonBadges.length ? `<div class="shop-card-badges">${seasonBadges.join('')}</div>` : ''}
    <div class="shop-card-footer">
      ${role==='operator' ? `<button class="buy-btn ${canBuy?'btn-primary':'btn-disabled'}" data-id="${item.id}" ${canBuy?'':'disabled'}>${state.label}</button>` : ''}
      ${isAdmin(role) ? `<button class="edit-item-btn btn-outline btn-sm" data-id="${item.id}">Изменить</button>` : ''}
    </div>
  </div>`;
}

/* ══════════════════════════════════════
   VIEW: СВОДКА (SUMMARY)
══════════════════════════════════════ */
function renderSummary() {
  const el = document.getElementById('view-summary');
  if (!el) return;
  const d = STATE.dashboard;
  if (!d) {
    el.innerHTML = `<div class="view-header"><div><div class="section-kicker">Сводка</div><h2 class="section-title">Рабочая сводка</h2></div></div>
      <div class="empty-state"><p>Загрузка данных…</p></div>`;
    const _summaryGen = STATE.navGen;
    api.getDashboard().then(data => {
      STATE.dashboard = data;
      if (!isNavStale(_summaryGen)) renderSummary();
    }).catch(() => {});
    return;
  }

  const leaders = d.top_5_operators || [];
  const groups = d.group_summary || [];
  const transactions = (d.latest_coin_transactions || []).slice(0, 6);
  const pending = d.pending_purchases_count || 0;
  const inactive = Math.max(0, (d.total_operators || 0) - (d.active_operators || 0));
  const lateness = d.total_lateness_week || 0;
  const violations = d.total_violations_week || 0;
  const disciplineTotal = lateness + violations;
  const maxGroupScore = Math.max(1, ...groups.map(group => Number(group.average_score) || 0));

  const initials = name => String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase();

  el.innerHTML = `
    <div class="view-header summary-v2-header">
      <div>
        <div class="section-kicker">Сводка</div>
        <h2 class="section-title">Рабочая сводка</h2>
        <p class="summary-v2-subtitle">Главное за неделю: команда, результаты и вопросы, требующие решения.</p>
      </div>
      <div class="header-right">
        <span class="tx-date">Обновлено: ${fmtDateTime(d.last_updated)}</span>
        <button class="btn-outline btn-sm" onclick="reloadData()">Обновить</button>
      </div>
    </div>

    <section class="summary-v2-kpis" aria-label="Ключевые показатели">
      <button class="summary-v2-kpi summary-v2-kpi-primary" onclick="navigateTo('operators')">
        <span class="summary-v2-kpi-label">Команда на линии</span>
        <strong>${d.active_operators}<small> из ${d.total_operators}</small></strong>
        <span>${inactive ? `${inactive} сейчас неактивны` : 'Все операторы активны'}</span>
      </button>
      <button class="summary-v2-kpi" onclick="navigateTo('rating')">
        <span class="summary-v2-kpi-label">Результат недели</span>
        <strong>${d.coins_earned_this_week}<small> коинов</small></strong>
        <span>Начислено команде</span>
      </button>
      <button class="summary-v2-kpi ${pending ? 'summary-v2-kpi-warning' : ''}" onclick="navigateTo('coins',{tab:'requests'})">
        <span class="summary-v2-kpi-label">Заявки магазина</span>
        <strong>${pending}</strong>
        <span>${pending ? 'Ожидают решения' : 'Новых заявок нет'}</span>
      </button>
      <button class="summary-v2-kpi ${disciplineTotal ? 'summary-v2-kpi-danger' : ''}" onclick="navigateTo('analytics')">
        <span class="summary-v2-kpi-label">Дисциплина</span>
        <strong>${disciplineTotal}</strong>
        <span>${lateness} опозданий · ${violations} нарушений</span>
      </button>
    </section>

    <section class="summary-v2-layout summary-v2-layout-leaders">
      <div class="panel summary-v2-panel summary-v2-leaders">
        <div class="panel-head">
          <div><h3>Лидеры недели</h3><p>Пять лучших результатов команды</p></div>
          <button class="btn-link" onclick="navigateTo('rating')">Открыть рейтинг</button>
        </div>
        ${leaders.length ? `<div class="summary-v2-leader-grid">
          ${leaders.map((op, index) => `
            <button class="summary-v2-leader" onclick="navigateTo('rating')">
              <span class="summary-v2-rank">${op.rank_position || index + 1}</span>
              <span class="summary-v2-avatar">${esc(initials(op.full_name))}</span>
              <span class="summary-v2-leader-name">${esc(op.full_name)}</span>
              <span class="summary-v2-leader-group">${esc(op.group_name || 'Без группы')}</span>
              <strong>${levelNum(op.final_score || 0)} балла</strong>
              <span>${op.coins_earned || 0} коинов</span>
            </button>`).join('')}
        </div>` : '<div class="summary-v2-empty">Рейтинг появится после первого расчёта периода.</div>'}
      </div>

      <div class="panel summary-v2-panel summary-v2-attention">
        <div class="panel-head"><div><h3>Требует внимания</h3><p>Задачи на текущий момент</p></div></div>
        <div class="summary-v2-attention-list">
          <button onclick="navigateTo('coins',{tab:'requests'})">
            <span class="summary-v2-status ${pending ? 'is-warning' : 'is-ok'}"></span>
            <span><strong>Заявки магазина</strong><small>${pending ? `${pending} ожидают решения` : 'Очередь обработана'}</small></span>
            <b>${pending}</b>
          </button>
          <button onclick="navigateTo('operators')">
            <span class="summary-v2-status ${inactive ? 'is-muted' : 'is-ok'}"></span>
            <span><strong>Активность команды</strong><small>${inactive ? `${inactive} операторов неактивны` : 'Вся команда активна'}</small></span>
            <b>${inactive}</b>
          </button>
          <button onclick="navigateTo('analytics')">
            <span class="summary-v2-status ${disciplineTotal ? 'is-danger' : 'is-ok'}"></span>
            <span><strong>Дисциплина недели</strong><small>${disciplineTotal ? 'Есть отклонения' : 'Отклонений нет'}</small></span>
            <b>${disciplineTotal}</b>
          </button>
        </div>
      </div>
    </section>

    <section class="summary-v2-layout">
      <div class="panel summary-v2-panel">
        <div class="panel-head"><div><h3>Группы</h3><p>Средний результат и общий баланс</p></div></div>
        <div class="summary-v2-group-list">
          ${groups.length ? groups.map(group => {
            const score = Number(group.average_score) || 0;
            const width = Math.max(4, Math.round(score / maxGroupScore * 100));
            return `<div class="summary-v2-group-row">
              <div><strong>${esc(group.group_name)}</strong><span>${group.operators_count} операторов</span></div>
              <div class="summary-v2-progress"><i style="width:${width}%"></i></div>
              <b>${levelNum(score)}</b>
              <span>${group.total_balance} коинов</span>
            </div>`;
          }).join('') : '<div class="summary-v2-empty">Группы пока не созданы.</div>'}
        </div>
      </div>

      <div class="panel summary-v2-panel">
        <div class="panel-head">
          <div><h3>Последние начисления</h3><p>Недавние изменения баланса</p></div>
          <button class="btn-link" onclick="navigateTo('coins',{tab:'history'})">Вся история</button>
        </div>
        <div class="summary-v2-activity-list">
          ${transactions.length ? transactions.map(t => `
            <div class="summary-v2-activity">
              <span class="summary-v2-avatar">${esc(initials(t.operator_name))}</span>
              <span><strong>${esc(t.operator_name)}</strong><small>${esc(t.comment || 'Операция с балансом')} · ${fmtDate(t.created_at)}</small></span>
              <b class="${t.amount >= 0 ? 'is-positive' : 'is-negative'}">${t.amount >= 0 ? '+' : ''}${t.amount}</b>
            </div>`).join('') : '<div class="summary-v2-empty">Операций пока нет.</div>'}
        </div>
      </div>
    </section>

    <section class="summary-v2-actions" aria-label="Быстрые переходы">
      <div><strong>Нужен подробный разбор?</strong><span>Показатели и динамика находятся в профильных разделах.</span></div>
      <button class="btn-outline" onclick="navigateTo('analytics')">Аналитика</button>
      <button class="btn-outline" onclick="navigateTo('period-report')">Расчёт периода</button>
      <button class="btn-outline" id="admin-summary-detail-toggle" onclick="toggleAdminSummaryDetail()">Расширенная выборка</button>
    </section>
    <div id="admin-summary-extra"></div>`;
}

/* ══════════════════════════════════════
   VIEW: ОПЕРАТОРЫ (ADMIN)
══════════════════════════════════════ */

/* ══════════════════════════════════════
   СВОДКА: детальная сводка по неделе с фильтрами (ТЗ §9)
══════════════════════════════════════ */

const _adminSummaryState = { filters: {}, data: null, open: false };

function toggleAdminSummaryDetail() {
  const host = document.getElementById('admin-summary-extra');
  const button = document.getElementById('admin-summary-detail-toggle');
  if (!host) return;

  _adminSummaryState.open = !_adminSummaryState.open;
  if (!_adminSummaryState.open) {
    host.innerHTML = '';
    if (button) button.textContent = 'Расширенная выборка';
    return;
  }

  if (button) button.textContent = 'Скрыть выборку';
  renderAdminSummaryDetail();
}

function _disciplineCellHtml(o) {
  const late = o.lateness_count;
  const viol = o.violation_count;
  if (late == null && viol == null) return '<span class="cell-muted">—</span>';
  const badge = (value, label) => {
    const v = value ?? 0;
    const cls = v > 0 ? 'bonus-chip discipline-bad' : 'bonus-chip discipline-ok';
    return `<span class="${cls}" title="${esc(label)}">${label}: ${v}</span>`;
  };
  return `${badge(late, 'Опоздания')} ${badge(viol, 'Нарушения')}`;
}

function _metricsCellHtml(o) {
  if (o.quality == null && o.efficiency == null) return '<span class="cell-muted">—</span>';
  const parts = [];
  if (o.quality != null) parts.push(`Кач. ${levelNum(o.quality)}%`);
  if (o.efficiency != null) parts.push(`Эфф. ${levelNum(o.efficiency)}%`);
  return `<span style="font-size:12.5px">${parts.join(' · ')}</span>`;
}

async function renderAdminSummaryDetail() {
  const host = document.getElementById('admin-summary-extra');
  if (!host || !_adminSummaryState.open) return;
  host.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка сводки за неделю…</p></div>';

  if (!STATE.groups.length) {
    try { STATE.groups = await swrFetch('groups:list', () => api.listGroups(false), null, SWR_STATIC_TTL_MS); } catch { /* фильтр по группе просто будет пуст */ }
  }

  await _loadAdminSummaryDetail();
}

async function _loadAdminSummaryDetail() {
  const host = document.getElementById('admin-summary-extra');
  if (!host || !_adminSummaryState.open) return;
  const f = _adminSummaryState.filters;
  const params = {};
  if (f.period_start) params.period_start = f.period_start;
  if (f.period_end) params.period_end = f.period_end;
  if (f.group_id) params.group_id = f.group_id;
  if (f.participation_status) params.participation_status = f.participation_status;
  if (f.position) params.position = f.position;
  if (f.has_lateness != null) params.has_lateness = f.has_lateness;
  if (f.has_violations != null) params.has_violations = f.has_violations;

  let data;
  try {
    data = await swrFetch(`admin-summary:${stableParamsKey(params)}`, () => api.getAdminSummary(params), fresh => {
      if (STATE.currentView === 'summary' && _adminSummaryState.open) {
        _adminSummaryState.data = fresh;
        _loadAdminSummaryDetail();
      }
    }, SWR_FAST_TTL_MS);
  } catch (e) {
    host.innerHTML = `<div class="empty-line">Ошибка загрузки сводки: ${esc(e.message)}</div>`;
    return;
  }
  _adminSummaryState.data = data;
  if (!f.period_start) _adminSummaryState.filters.period_start = data.period_start;
  if (!f.period_end) _adminSummaryState.filters.period_end = data.period_end;

  const groups = STATE.groups || [];

  host.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Детальная сводка за неделю</h3>
        ${data.period_start ? `<span class="panel-badge">${esc(data.period_start)} — ${esc(data.period_end)}</span>` : '<span class="panel-badge">Нет расчётов за неделю</span>'}
      </div>

      <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:18px">
        <div class="kpi-card">
          <div class="kpi-label">Средняя позиция по группе</div>
          <div class="kpi-value">${data.average_team_rank ?? '—'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Коинов в обороте</div>
          <div class="kpi-value">${data.total_coins_balance} <span class="kpi-unit">₡</span></div>
        </div>
        <div class="kpi-card ${data.new_shop_requests > 0 ? 'kpi-warn' : ''}">
          <div class="kpi-label">Новых заявок магазина</div>
          <div class="kpi-value">${data.new_shop_requests}</div>
        </div>
      </div>

      <div class="filter-row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:16px">
        <div class="form-group" style="margin:0">
          <label class="form-label">Начало периода</label>
          <input type="date" id="as-period-start" class="form-input" value="${esc(_adminSummaryState.filters.period_start || '')}">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Конец периода</label>
          <input type="date" id="as-period-end" class="form-input" value="${esc(_adminSummaryState.filters.period_end || '')}">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Группа</label>
          <select id="as-group" class="form-input">
            <option value="">Все группы</option>
            ${groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Участие</label>
          <select id="as-participation" class="form-input">
            <option value="">Все</option>
            <option value="participating">Участвует</option>
            <option value="not_participating">Не участвует</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Должность</label>
          <select id="as-position" class="form-input">
            <option value="">Все</option>
            <option value="operator">Оператор</option>
            <option value="chat_manager">Чат-менеджер</option>
          </select>
        </div>
        <label class="an-checkbox-label"><input type="checkbox" id="as-has-lateness"> Есть опоздания</label>
        <label class="an-checkbox-label"><input type="checkbox" id="as-has-violations"> Есть нарушения</label>
        <button class="btn-primary btn-sm" onclick="applyAdminSummaryFilters()">Применить</button>
        <button class="btn-outline btn-sm" onclick="exportAdminSummary()">Экспорт CSV</button>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Место</th><th>ФИО</th><th>Группа</th><th>Статус</th>
            <th>Баллы недели</th><th>Коины недели</th><th>Баланс</th>
            <th>Дисциплина</th><th>Показатели</th><th>Действия</th>
          </tr></thead>
          <tbody>
            ${data.operators.length ? data.operators.map(o => `
              <tr>
                <td><span class="rank-badge ${(o.rank_place||99)<=3?'rank-top':''}">${o.rank_place ?? '—'}</span></td>
                <td class="name-cell">${esc(o.full_name)}</td>
                <td>${esc(o.group_name || '')}</td>
                <td>${o.participation_status === 'participating' ? 'Участвует' : 'Не участвует'}</td>
                <td>${o.week_points != null ? levelNum(o.week_points) : '—'}</td>
                <td>${o.week_coins != null ? `<b class="accent-text">${o.week_coins} ₡</b>` : '—'}</td>
                <td>${o.total_balance} ₡</td>
                <td>${_disciplineCellHtml(o)}</td>
                <td>${_metricsCellHtml(o)}</td>
                <td>${summaryRowActionsHtml(o.id, o.full_name)}</td>
              </tr>`).join('') : '<tr><td colspan="10" class="empty-line">Нет данных за выбранный период/фильтры</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  document.getElementById('as-group').value = f.group_id || '';
  document.getElementById('as-participation').value = f.participation_status || '';
  document.getElementById('as-position').value = f.position || '';
  document.getElementById('as-has-lateness').checked = f.has_lateness === true;
  document.getElementById('as-has-violations').checked = f.has_violations === true;
}

function applyAdminSummaryFilters() {
  const f = _adminSummaryState.filters;
  f.period_start = document.getElementById('as-period-start')?.value || '';
  f.period_end = document.getElementById('as-period-end')?.value || '';
  f.group_id = document.getElementById('as-group')?.value || '';
  f.participation_status = document.getElementById('as-participation')?.value || '';
  f.position = document.getElementById('as-position')?.value || '';
  const lateChecked = document.getElementById('as-has-lateness')?.checked;
  const violChecked = document.getElementById('as-has-violations')?.checked;
  f.has_lateness = lateChecked ? true : null;
  f.has_violations = violChecked ? true : null;
  _loadAdminSummaryDetail();
}

function exportAdminSummary() {
  const f = _adminSummaryState.filters;
  const params = { period_start: f.period_start, period_end: f.period_end, format: 'csv' };
  if (f.group_id) params.group_id = f.group_id;
  window.open(api.exportUrl('/api/exports/rating', params), '_blank');
}

/* ══════════════════════════════════════
   СВОДКА: быстрые действия по строке оператора (ТЗ §9.5)
   Начислить / Списать / Открыть кабинет / Открыть историю / Открыть заявки
══════════════════════════════════════ */

function summaryRowActionsHtml(operatorId, operatorName) {
  const nameAttr = esc(operatorName).replace(/'/g, '&#39;');
  return `
    <div class="row-actions-group">
      <button class="btn-icon-sm" title="Начислить коины" onclick="openManualCoinModal(${operatorId}, '${nameAttr}', 'credit')">+₡</button>
      <button class="btn-icon-sm" title="Списать коины" onclick="openManualCoinModal(${operatorId}, '${nameAttr}', 'debit')">−₡</button>
      <button class="btn-icon-sm" title="Открыть кабинет" onclick="openOperatorCabinetModal(${operatorId}, '${nameAttr}')">👤</button>
      <button class="btn-icon-sm" title="Открыть историю" onclick="openHistoryForOperator(${operatorId}, '${nameAttr}')">🕘</button>
      <button class="btn-icon-sm" title="Открыть заявки" onclick="openRequestsForOperator(${operatorId}, '${nameAttr}')">🛒</button>
    </div>`;
}

function openManualCoinModal(operatorId, operatorName, operation) {
  const isCredit = operation === 'credit';
  showModal(`
    <h3 class="modal-title">${isCredit ? 'Начислить коины' : 'Списать коины'} — ${esc(operatorName)}</h3>
    <div class="form-group">
      <label class="form-label">Количество коинов</label>
      <input id="mc-amount" class="form-input" type="number" min="1" step="1" placeholder="Например, 10">
    </div>
    <div class="form-group">
      <label class="form-label">Причина</label>
      <input id="mc-reason" class="form-input" type="text" placeholder="Например: помощь новичку">
    </div>
    <div class="form-group">
      <label class="form-label">Комментарий <span class="optional">(необязательно)</span></label>
      <input id="mc-comment" class="form-input" type="text">
    </div>
    <div id="mc-err" class="status-line"></div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" onclick="submitManualCoinModal(${operatorId}, '${operation}')">${isCredit ? 'Начислить' : 'Списать'}</button>
    </div>`);
}

async function submitManualCoinModal(operatorId, operation) {
  const errEl = document.getElementById('mc-err');
  const amount = Number(document.getElementById('mc-amount')?.value);
  const reason = document.getElementById('mc-reason')?.value?.trim();
  const comment = document.getElementById('mc-comment')?.value?.trim() || '';
  if (!amount || amount <= 0) { if (errEl) errEl.textContent = 'Укажите количество коинов больше нуля'; return; }
  if (!reason) { if (errEl) errEl.textContent = 'Укажите причину'; return; }

  try {
    await api.manualTransaction({
      operator_id: operatorId,
      amount: operation === 'debit' ? -amount : amount,
      reason, comment,
    });
    showToast(operation === 'debit' ? 'Коины списаны' : 'Коины начислены', 'ok');
    closeModal();
    STATE.dashboard = await api.getDashboard().catch(() => STATE.dashboard);
    if (typeof _loadAdminSummaryDetail === 'function') _loadAdminSummaryDetail();
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}

async function openOperatorCabinetModal(operatorId, operatorName) {
  showModal(`
    <h3 class="modal-title">Кабинет — ${esc(operatorName)}</h3>
    <div id="op-cabinet-modal-body"><div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div></div>`,
  );
  const body = document.getElementById('op-cabinet-modal-body');
  let data;
  try {
    data = await api.getOperatorCabinet(operatorId);
  } catch (e) {
    if (body) body.innerHTML = `<div class="empty-line">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  if (!body) return;

  const wm = data.week_metrics;
  const cc = data.coin_calculation;
  const ach = data.achievements || { completed: [], in_progress: [] };

  body.innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:16px">
      <div class="kpi-card"><div class="kpi-label">Баланс</div><div class="kpi-value">${data.wallet.balance} <span class="kpi-unit">₡</span></div></div>
      <div class="kpi-card"><div class="kpi-label">В резерве</div><div class="kpi-value">${data.wallet.reserved} <span class="kpi-unit">₡</span></div></div>
      <div class="kpi-card"><div class="kpi-label">За неделю</div><div class="kpi-value">${data.wallet.earned_this_week} <span class="kpi-unit">₡</span></div></div>
      <div class="kpi-card"><div class="kpi-label">Место в рейтинге</div><div class="kpi-value">${data.rating.place ?? '—'}${data.rating.total_participants ? ` <span class="kpi-unit">/ ${data.rating.total_participants}</span>` : ''}</div></div>
    </div>

    ${wm ? `
      <div class="coin-calc-row"><span>Качество</span><b>${levelNum(wm.quality)}%</b></div>
      <div class="coin-calc-row"><span>Эффективность</span><b>${levelNum(wm.efficiency)}%</b></div>
      <div class="coin-calc-row"><span>Опоздания / Нарушения</span><b style="color:${(wm.late_minutes||wm.violations)?'var(--danger)':'inherit'}">${wm.late_minutes ?? 0} / ${wm.violations ?? 0}</b></div>
    ` : '<div class="empty-line">Нет данных за последнюю неделю</div>'}

    ${cc ? `
      <div class="coin-calc-row coin-calc-total" style="margin-top:10px">
        <span>Расчёт за неделю (${cc.is_final ? 'начислено' : 'предварительно'})</span><b>${cc.total_week_coins} ₡</b>
      </div>` : ''}

    <div class="coin-rules-section-title">Достижения (${ach.completed.length})</div>
    <div class="achievements-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
      ${ach.completed.map(r => `
        <div class="achievement-badge unlocked" style="padding:8px">
          <div class="achievement-icon" style="font-size:18px">${esc(r.achievement.icon || '🏆')}</div>
          <div class="achievement-info"><div class="achievement-title" style="font-size:12px">${esc(r.achievement.title)}</div></div>
        </div>`).join('') || '<div class="empty-line">Пока нет полученных достижений</div>'}
    </div>

    <div class="modal-actions" style="margin-top:16px">
      <button class="btn-outline" onclick="closeModal()">Закрыть</button>
      <button class="btn-primary" onclick="closeModal(); openHistoryForOperator(${operatorId}, '${esc(operatorName).replace(/'/g, '&#39;')}')">Вся история →</button>
    </div>`;
}

function renderAdminOperators() {
  return renderUsersPage();
}

function roleBadge(role) {
  const labels = { operator:'Оператор', supervisor:'Супервайзер', manager:'Менеджер', admin:'Администратор' };
  return `<span class="role-badge user-role-${esc(role)}">${esc(labels[role] || role || '—')}</span>`;
}

function userStatusBadge(status) {
  const labels = { active:'Активен', inactive:'Неактивен', dismissed:'Уволен', blocked:'Заблокирован' };
  const cls = status === 'active' ? 'status-active' : status === 'blocked' ? 'status-danger' : 'status-inactive';
  return `<span class="status-badge ${cls}">${esc(labels[status] || status || '—')}</span>`;
}

function renderUsersPage() {
  const el = document.getElementById('view-operators');
  if (!el) return;
  const ops = STATE.users;
  const savedFilters = STATE.usersFilters || (STATE.usersFilters = {});
  let searchVal = savedFilters.search || '';
  let filterGroup = savedFilters.group || '';
  let filterRole = savedFilters.role || '';
  let filterStatus = savedFilters.status || '';
  let filterLevel = savedFilters.level || '';
  let activeTab = savedFilters.tab || 'all';

  const groups = [...new Set(ops.map(o => o.group_name).filter(Boolean))].sort();
  const levels = STATE.operatorLevels.length
    ? STATE.operatorLevels
    : [...new Map(ops.map(o => o.level).filter(Boolean).map(l => [l.code, l])).values()];
  const allowedRoles = STATE.user?.role === 'admin'
    ? ['operator','supervisor','manager','admin']
    : ['operator','supervisor'];

  function isDismissed(o) {
    return o.status === 'dismissed' || o.status === 'inactive' || o.status === 'blocked';
  }

  // Counts for tabs
  function counts() {
    return {
      all:              ops.filter(o => !isDismissed(o)).length,
      participating:    ops.filter(o => !isDismissed(o) && o.participation_status === 'participating').length,
      not_participating:ops.filter(o => !isDismissed(o) && o.participation_status === 'not_participating').length,
      dismissed:        ops.filter(o => isDismissed(o)).length,
    };
  }

  function filteredOps() {
    return ops.filter(o => {
      const matchSearch = !searchVal || (o.full_name || '').toLowerCase().includes(searchVal.toLowerCase())
        || (o.login || o.username || '').toLowerCase().includes(searchVal.toLowerCase())
        || (o.email || '').toLowerCase().includes(searchVal.toLowerCase())
        || (o.group_name || '').toLowerCase().includes(searchVal.toLowerCase());
      const matchGroup = !filterGroup || o.group_name === filterGroup;
      const matchLevel = !filterLevel || o.level?.code === filterLevel;
      const matchRole = !filterRole || o.role === filterRole;
      const matchStatus = !filterStatus || o.status === filterStatus;
      const matchTab = activeTab === 'all' ? true : activeTab === 'active' ? o.status === 'active' : isDismissed(o);
      return matchSearch && matchGroup && matchLevel && matchRole && matchStatus && matchTab;
    });
  }

  function operatorActions(o) {
    return `<button class="user-open-button" onclick="showUserManagementModal(${o.id})">Открыть</button>`;
  }

  function renderTable() {
    const list = filteredOps();
    return `
      <div class="table-wrap">
        <table class="data-table users-table-compact">
          <thead><tr>
            <th>Сотрудник</th>
            <th>Роль</th>
            <th>Группа</th>
            <th class="tc">Ставка</th>
            <th class="tc">Уровень</th>
            <th class="tc">Стаж</th>
            <th class="tc">Статус</th>
            <th class="tc">Действия</th>
          </tr></thead>
          <tbody>
            ${list.length ? list.map(o => {
              const dismissed = isDismissed(o);
              const isOp = o.role === 'operator';
              return `<tr class="${dismissed ? 'operator-dismissed-row' : ''}">
                <td class="name-cell">
                  <div class="user-cell-name">${esc(o.full_name)}</div>
                  ${o.email ? `<div class="user-cell-sub">${esc(o.email)}</div>` : ''}
                </td>
                <td>
                  ${roleBadge(o.role)}
                </td>
                <td><span class="user-table-value">${o.group_name ? esc(o.group_name) : '—'}</span></td>
                <td class="tc">${isOp ? rateBadgeHtml(o.rate, o.operator_id) : '<span class="cell-muted">—</span>'}</td>
                <td class="tc">${isOp ? levelBadgeHtml(o.level) : '<span class="cell-muted">—</span>'}</td>
                <td class="tc">${isOp && o.tenure_days != null ? tenureBadgeHtml(o.tenure_days) : '<span class="cell-muted">—</span>'}</td>
                <td class="tc">${userStatusBadge(o.status)}</td>
                <td class="tc">${operatorActions(o)}</td>
              </tr>`;
            }).join('') : '<tr><td colspan="8" class="empty-line">Нет пользователей</td></tr>'}
          </tbody>
        </table>
      </div>`;
  }

  function renderTabsAndFilters() {
    const c = {
      all: ops.length,
      active: ops.filter(o => o.status === 'active').length,
      inactive: ops.filter(o => isDismissed(o)).length,
    };
    const tabs = [
      { key: 'all', label: 'Все' },
      { key: 'active', label: 'Активные' },
      { key: 'inactive', label: 'Неактивные' },
    ];
    return tabs.map(t => `
      <button class="ops-tab ${activeTab===t.key?'ops-tab-active':''}" data-tab="${t.key}">
        ${t.label}<span class="ops-tab-badge ${activeTab===t.key?'ops-tab-badge-active':''}">${c[t.key]}</span>
      </button>`).join('');
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Пользователи</div><h2 class="section-title">Пользователи</h2></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="reloadData()">Обновить</button>
        ${['manager','admin'].includes(STATE.user?.role) ? `
          <button class="btn-outline btn-sm" onclick="showWorkNormsModal()">Нормы часов</button>
          <button class="btn-primary btn-sm" onclick="showAddOperatorModal()">+ Новый пользователь</button>
        ` : ''}
      </div>
    </div>

    <div class="ops-tab-bar" id="ops-tab-bar">${renderTabsAndFilters()}</div>

    <div class="ops-filters-row">
      <input id="ops-search" class="form-input" placeholder="ФИО, логин или email…" style="width:260px" value="${esc(searchVal)}">
      <select id="ops-role" class="form-select" style="width:170px">
        <option value="">Все роли</option>
        ${allowedRoles.map(r => `<option value="${r}" ${filterRole===r?'selected':''}>${roleLabel(r)}</option>`).join('')}
      </select>
      <select id="ops-group" class="form-select" style="width:180px">
        <option value="">Все группы</option>
        ${groups.map(g => `<option value="${esc(g)}" ${filterGroup===g?'selected':''}>${esc(g)}</option>`).join('')}
      </select>
      <select id="ops-status" class="form-select" style="width:170px">
        <option value="">Все статусы</option>
        <option value="active" ${filterStatus==='active'?'selected':''}>Активен</option>
        <option value="inactive" ${filterStatus==='inactive'?'selected':''}>Неактивен</option>
        <option value="blocked" ${filterStatus==='blocked'?'selected':''}>Заблокирован</option>
        <option value="dismissed" ${filterStatus==='dismissed'?'selected':''}>Уволен</option>
      </select>
      <select id="ops-level" class="form-select" style="width:170px">
        <option value="">Все уровни</option>
        ${levels.map(l => `<option value="${esc(l.code)}" ${filterLevel===l.code?'selected':''}>${esc(l.name)}</option>`).join('')}
      </select>
      <span class="ops-count-info">Показано: <b>${filteredOps().length}</b> из ${ops.length}</span>
    </div>

    <div id="ops-table-wrap">${renderTable()}</div>`;

  function rebindOps() {
    el.querySelectorAll('.ops-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        savedFilters.tab = activeTab;
        el.querySelector('#ops-tab-bar').innerHTML = renderTabsAndFilters();
        el.querySelector('#ops-table-wrap').innerHTML = renderTable();
        el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
        rebindOps();
      });
    });
    el.querySelector('#ops-search')?.addEventListener('input', e => {
      searchVal = e.target.value;
      savedFilters.search = searchVal;
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    el.querySelector('#ops-group')?.addEventListener('change', e => {
      filterGroup = e.target.value;
      savedFilters.group = filterGroup;
      el.querySelector('#ops-tab-bar').innerHTML = renderTabsAndFilters();
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      rebindOps();
    });
    el.querySelector('#ops-role')?.addEventListener('change', e => {
      filterRole = e.target.value;
      savedFilters.role = filterRole;
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    el.querySelector('#ops-status')?.addEventListener('change', e => {
      filterStatus = e.target.value;
      savedFilters.status = filterStatus;
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    el.querySelector('#ops-level')?.addEventListener('change', e => {
      filterLevel = e.target.value;
      savedFilters.level = filterLevel;
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    bindOpsActions();
  }
  rebindOps();
  function bindOpsActions() {
    el.querySelectorAll('.quick-charge-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigateTo('manual');
        const op = STATE.adminOperators.find(item => String(item.id) === String(btn.dataset.id));
        const hidden = document.getElementById('manual-op-id');
        const display = document.getElementById('op-selected-display');
        const name = document.getElementById('op-selected-name');
        if (op && hidden && display && name) {
          hidden.value = op.id;
          name.textContent = op.full_name;
          display.classList.add('visible');
        }
      });
    });
  }
  bindOpsActions();
}

/* ══════════════════════════════════════
   VIEW: РУЧНОЕ НАЧИСЛЕНИЕ
══════════════════════════════════════ */
function renderCoins() {
  const el = document.getElementById('view-coins');
  if (!el) return;

  if (!isAdmin(STATE.user?.role)) {
    el.innerHTML = '<div class="empty-state"><p>Недостаточно прав</p></div>';
    return;
  }

  const tab = normalizeCoinTab(STATE.coinsTab);
  STATE.coinsTab = tab;
  const tabs = [
    ['overview', 'Обзор'],
    ['accrual', 'Начисление'],
    ['requests', 'Заявки'],
    ['history', 'История'],
    ['weekly', 'Еженедельный расчёт'],
    ['settings', 'Настройки начислений'],
    ['rules', 'Правила'],
  ];

  el.innerHTML = `
    <div class="coins-page-head">
      <div>
        <div class="section-kicker">Коины</div>
        <h2 class="section-title">Операции с коинами</h2>
        <p>Начисления, заявки и правила в одном рабочем пространстве</p>
      </div>
      <div class="coins-head-actions">
        <button class="btn-outline btn-sm" onclick="refreshCoinsModule()">Обновить</button>
      </div>
    </div>
    <div class="coins-page-tabs" role="tablist" aria-label="Разделы операций с коинами">
      ${tabs.map(([id, label]) => `<button class="coins-page-tab ${tab === id ? 'is-active' : ''}" type="button" role="tab" aria-selected="${tab === id}" data-coins-tab="${id}">${label}</button>`).join('')}
    </div>
    <div id="coins-tab-body" class="coins-tab-body"></div>`;

  el.querySelectorAll('[data-coins-tab]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo('coins', { tab: btn.dataset.coinsTab }));
  });

  const body = el.querySelector('#coins-tab-body');
  if (tab === 'overview') renderCoinsOverview(body);
  if (tab === 'accrual') {
    body.innerHTML = '<section class="coins-embedded-view" id="view-manual"></section>';
    renderManual();
  }
  if (tab === 'requests') {
    body.innerHTML = '<section class="coins-embedded-view" id="view-requests"></section>';
    renderRequests();
  }
  if (tab === 'history') {
    body.innerHTML = '<section class="coins-embedded-view" id="view-history"></section>';
    renderHistory();
  }
  if (tab === 'rules') renderCoinRules(body);
  if (tab === 'weekly') renderWeeklyAccrualTab(body);
  if (tab === 'settings') renderCoinRulesSettingsTab(body);
}

async function refreshCoinsModule() {
  swrInvalidate('coins:');
  swrInvalidate('groups:');
  swrInvalidate('shop:items');
  STATE.coinsOverview = null;
  await reloadData();
  if (STATE.currentView === 'coins') renderCoins();
}

function renderCoinsOverview(body) {
  const overview = STATE.coinsOverview;
  if (!overview) {
    body.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка данных…</p></div>';
    const myNavGen = STATE.navGen;
    swrFetch('coins:overview', () => api.getCoinsOverview(), data => {
      STATE.coinsOverview = data;
      if (!isNavStale(myNavGen) && STATE.currentView === 'coins' && STATE.coinsTab === 'overview') renderCoins();
    }, SWR_FAST_TTL_MS).then(data => {
      STATE.coinsOverview = data;
      if (!isNavStale(myNavGen) && STATE.currentView === 'coins' && STATE.coinsTab === 'overview') renderCoins();
    }).catch(err => {
      if (!isNavStale(myNavGen)) {
        body.innerHTML = `<div class="status-line status-error">Не удалось загрузить обзор: ${esc(err.message)}</div>`;
      }
    });
    return;
  }

  const tx = overview.latest_transactions || [];
  const req = overview.latest_requests || [];
  body.innerHTML = `
    <div class="coins-summary-grid">
      <button class="coins-summary-card is-accent" type="button" onclick="navigateTo('coins',{tab:'history'})">
        <span>Операций сегодня</span><strong>${overview.today_operations || 0}</strong><small>Всего: ${overview.total_operations || 0}</small>
      </button>
      <button class="coins-summary-card is-positive" type="button" onclick="navigateTo('coins',{tab:'history'})">
        <span>Баланс дня</span><strong>${(overview.today_credited || 0) - (overview.today_debited || 0) >= 0 ? '+' : ''}${(overview.today_credited || 0) - (overview.today_debited || 0)} ₡</strong><small>+${overview.today_credited || 0} / -${overview.today_debited || 0}</small>
      </button>
      <button class="coins-summary-card ${overview.new_requests ? 'has-alert' : ''}" type="button" onclick="navigateTo('coins',{tab:'requests'})">
        <span>Новые заявки</span><strong>${overview.new_requests || 0}</strong><small>${overview.new_requests ? 'Требуют решения' : 'Очередь обработана'}</small>
      </button>
      <div class="coins-summary-card">
        <span>Зарезервировано</span><strong>${overview.reserved_coins || 0} ₡</strong><small>В активных заявках</small>
      </div>
    </div>
    <div class="coins-overview-grid">
      <section class="coins-surface">
        <div class="panel-head"><h3>Последние операции</h3><button class="btn-link" onclick="navigateTo('coins',{tab:'history'})">Открыть историю</button></div>
        <div class="coins-list">
          ${tx.length ? tx.map(t => `
            <div class="manual-tx-row">
              <div class="manual-tx-sign ${t.amount >= 0 ? 'plus' : 'minus'}">${t.amount >= 0 ? '+' : ''}${t.amount}</div>
              <div class="manual-tx-body">
                <div class="manual-tx-name">${esc(t.operator_name)}</div>
                <div class="manual-tx-meta">${esc(transactionTypeLabel(t.type))} · ${esc(t.comment)} · ${fmtDate(t.created_at)}</div>
              </div>
            </div>`).join('') : '<div class="empty-line">Операций пока нет</div>'}
        </div>
      </section>
      <section class="coins-surface">
        <div class="panel-head"><h3>Последние заявки</h3><button class="btn-link" onclick="navigateTo('coins',{tab:'requests'})">Открыть заявки</button></div>
        <div class="coins-list">
          ${req.length ? req.map(p => `
            <div class="manual-tx-row">
              <div class="manual-tx-sign">${p.price}</div>
              <div class="manual-tx-body">
                <div class="manual-tx-name">${esc(p.operator_name)} — ${esc(p.bonus_name)}</div>
                <div class="manual-tx-meta">${esc(p.group_name || '—')} · ${statusLabel(p.status)} · ${fmtDate(p.created_at)}</div>
              </div>
            </div>`).join('') : '<div class="empty-line">Заявок нет</div>'}
        </div>
      </section>
    </div>
    `;
}

function renderCoinRules(body) {
  body.innerHTML = `
    <div class="coins-surface coins-rules-surface">
      <div class="panel-head"><h3>Правила операций с коинами</h3></div>
      <div class="manual-rules coins-rules">
        <div class="manual-rule"><span class="rule-coin">1</span><span>Любое изменение баланса создается через транзакцию и попадает в историю.</span></div>
        <div class="manual-rule"><span class="rule-coin">2</span><span>Покупка в магазине сначала резервирует коины, затем заявка одобряется или отклоняется.</span></div>
        <div class="manual-rule"><span class="rule-coin">3</span><span>Отклонение заявки возвращает резерв на баланс оператора.</span></div>
        <div class="manual-rule"><span class="rule-coin">4</span><span>Ручные операции не редактируются: для корректировки создается обратная операция.</span></div>
      </div>
    </div>`;
}

function transactionTypeLabel(type) {
  return {
    weekly_accrual: 'Авт. начисление',
    manual_add: 'Ручное начисление',
    manual_subtract: 'Ручное списание',
    manual_accrual: 'Ручное начисление',
    manual_deduction: 'Ручное списание',
    reserve: 'Резервирование',
    reservation: 'Резервирование',
    purchase: 'Покупка бонуса',
    refund: 'Возврат коинов',
    request_completed: 'Заявка выполнена',
    period_report: 'Расчет периода',
    period_report_adjustment: 'Корректировка расчёта периода',
    bonus_top: 'Бонус: место в рейтинге',
    bonus_no_late: 'Бонус: без опозданий',
    bonus_no_violation: 'Бонус: без нарушений',
    bonus_nomination: 'Бонус: номинация недели',
    bonus_driver_thanks: 'Бонус: благодарность водителя',
    achievement_reward: 'Награда за достижение',
    test_reward: 'Награда за тест',
    level_up: 'Повышение уровня',
    wheel_of_wow: 'Колесо WOW',
  }[type] || type;
}

function renderManual() {
  const el = document.getElementById('view-manual');
  if (!el) return;

  // Load operators if empty
  if (!STATE.adminOperators.length) {
    el.innerHTML = `<div class="coins-section-head"><div><div class="section-kicker">Начисление</div><h3>Ручная операция</h3></div></div><div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>`;
    api.getDashboardOperators()
      .then(ops => { STATE.adminOperators = ops; renderManual(); })
      .catch(() => { el.innerHTML += '<p style="color:var(--danger);padding:20px">Не удалось загрузить операторов</p>'; });
    return;
  }

  const ops = STATE.adminOperators.filter(o =>
    (o.participation_status ? o.participation_status === 'participating' : o.status === 'active') &&
    (o.employment_status || 'active') === 'active' && o.is_active
  );

  function todayStats() {
    const today = new Date().toDateString();
    const todayTx = STATE.history.filter(t => new Date(t.created_at).toDateString() === today);
    const add = todayTx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const sub = todayTx.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    return { count: todayTx.length, add, sub };
  }

  function renderHistory() {
    const items = STATE.history
      .filter(t => ['manual_add','manual_subtract','manual_accrual','manual_deduction'].includes(t.type))
      .slice(0, 5);
    if (!items.length) return '<div class="manual-empty">Операций пока нет</div>';
    return items.map(t => `
      <div class="manual-tx-row">
        <div class="manual-tx-sign ${t.amount >= 0 ? 'plus' : 'minus'}">${t.amount >= 0 ? '+' : ''}${t.amount}</div>
        <div class="manual-tx-body">
          <div class="manual-tx-name">${esc(t.operator_name)}</div>
          <div class="manual-tx-meta">${esc(t.comment)} · ${esc(t.created_by_name || 'Система')} · ${fmtDate(t.created_at)}</div>
        </div>
      </div>`).join('');
  }

  const st = todayStats();

  el.innerHTML = `
    <div class="coins-section-head">
      <div><div class="section-kicker">Начисление</div><h3>Ручная операция</h3><p>Изменение баланса с обязательной записью в историю</p></div>
    </div>

    <div class="manual-layout">

      <!-- ─── Левая колонка: форма ─── -->
      <div class="manual-col-form">
        <div class="manual-card">
          <div class="manual-card-head">Форма начисления / списания</div>

          <div class="form-group">
            <label class="form-label">Оператор <span class="req">*</span></label>
            <div class="op-search-wrap" id="op-search-wrap">
              <input id="op-search-input" class="form-input" type="text"
                placeholder="Начните вводить имя или группу…" autocomplete="off">
              <div class="op-search-dropdown" id="op-search-dropdown" hidden>
                <div class="op-search-list" id="op-search-list"></div>
              </div>
            </div>
            <input type="hidden" id="manual-op-id" value="">
            <div id="op-selected-display">
              <span id="op-selected-name"></span>
              <button onclick="clearOpSelection()">×</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Тип операции <span class="req">*</span></label>
            <div class="manual-type-btns">
              <button class="manual-type-btn active-add" id="btn-type-add" onclick="setManualType('add')">
                + Начисление
              </button>
              <button class="manual-type-btn" id="btn-type-sub" onclick="setManualType('subtract')">
                − Списание
              </button>
            </div>
            <input type="hidden" id="manual-type-val" value="add">
          </div>

          <div class="form-group">
            <label class="form-label">Количество коинов <span class="req">*</span></label>
            <input id="manual-amount" class="form-input" type="number" min="1" step="1" placeholder="Например: 50">
          </div>

          <div class="form-group">
            <label class="form-label">Причина операции <span class="req">*</span></label>
            <select id="manual-reason" class="form-select">
              <option value="">Выберите причину…</option>
              <option>Благодарность от водителя</option>
              <option>Помощь новому сотруднику</option>
              <option>Попадание на доску почёта</option>
              <option>Активность вне конкурса</option>
              <option>Топ-1 недели</option>
              <option>Топ-2 недели</option>
              <option>Топ-3 недели</option>
              <option>Номинация недели</option>
              <option>Корректировка баланса</option>
              <option>Ошибка начисления</option>
              <option>Дисциплинарное нарушение</option>
              <option value="Другое">Другое</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" id="comment-label">
              Комментарий <span class="optional">(необязательно)</span>
            </label>
            <input id="manual-comment" class="form-input" type="text"
              placeholder="Дополнительный комментарий">
            <div id="comment-hint" class="field-hint" style="display:none">
              Обязательно при причине «Другое»
            </div>
          </div>

          <div id="manual-status" class="status-line" style="min-height:20px"></div>

          <button class="manual-submit-btn" id="manual-submit-btn">
            Сохранить операцию
          </button>
          <p class="manual-note">Операция записывается с автором, датой и причиной. Удаление невозможно.</p>
        </div>
      </div>

      <!-- ─── Правая колонка: карточки ─── -->
      <div class="manual-col-right">

        <!-- Статистика за сегодня -->
        <div class="manual-card">
          <div class="manual-card-head">Статистика за сегодня</div>
          <div class="manual-stats-grid" id="manual-stats">
            <div class="manual-stat">
              <div class="manual-stat-val">${st.count}</div>
              <div class="manual-stat-label">Операций</div>
            </div>
            <div class="manual-stat green">
              <div class="manual-stat-val">+${st.add}</div>
              <div class="manual-stat-label">Начислено ₡</div>
            </div>
            <div class="manual-stat red">
              <div class="manual-stat-val">−${st.sub}</div>
              <div class="manual-stat-label">Списано ₡</div>
            </div>
          </div>
        </div>

        <!-- Последние операции -->
        <div class="manual-card">
          <div class="manual-card-head">Последние операции</div>
          <div id="manual-history-list">${renderHistory()}</div>
        </div>

        <!-- Правила начисления -->
        <div class="manual-card">
          <div class="manual-card-head">Правила начисления</div>
          <div class="manual-rules">
            <div class="manual-rule"><span class="rule-coin">+50</span><span>Топ-1 недели</span></div>
            <div class="manual-rule"><span class="rule-coin">+30</span><span>Топ-2 недели</span></div>
            <div class="manual-rule"><span class="rule-coin">+20</span><span>Топ-3 недели</span></div>
            <div class="manual-rule"><span class="rule-coin">+15</span><span>Номинация недели</span></div>
            <div class="manual-rule"><span class="rule-coin">+10</span><span>Благодарность от водителя</span></div>
            <div class="manual-rule"><span class="rule-coin">+10</span><span>Попадание на доску почёта</span></div>
          </div>
        </div>

      </div>
    </div>`;

  // Operator search
  initOpSearch(el, ops);

  // Type toggle
  window.setManualType = function(type) {
    document.getElementById('manual-type-val').value = type;
    const btnAdd = el.querySelector('#btn-type-add');
    const btnSub = el.querySelector('#btn-type-sub');
    btnAdd.className = 'manual-type-btn' + (type === 'add' ? ' active-add' : '');
    btnSub.className = 'manual-type-btn' + (type === 'subtract' ? ' active-sub' : '');
  };

  // Reason → comment required
  el.querySelector('#manual-reason').addEventListener('change', function() {
    const isOther = this.value === 'Другое';
    el.querySelector('#comment-label').innerHTML = isOther
      ? 'Комментарий <span class="req">*</span>'
      : 'Комментарий <span class="optional">(необязательно)</span>';
    el.querySelector('#comment-hint').style.display = isOther ? 'block' : 'none';
  });

  // Submit
  el.querySelector('#manual-submit-btn').addEventListener('click', async () => {
    const opId    = el.querySelector('#manual-op-id').value;
    const type    = el.querySelector('#manual-type-val').value || 'add';
    const amount  = +el.querySelector('#manual-amount').value;
    const reason  = el.querySelector('#manual-reason').value;
    const comment = el.querySelector('#manual-comment').value.trim();
    const statusEl = el.querySelector('#manual-status');
    const btn = el.querySelector('#manual-submit-btn');

    const setErr = msg => { statusEl.textContent = msg; statusEl.className = 'status-line status-error'; };

    if (!opId)                  return setErr('Выберите оператора');
    if (!amount || amount <= 0) return setErr('Введите корректное количество коинов');
    if (!reason)                return setErr('Выберите причину операции');
    if (reason === 'Другое' && !comment) return setErr('Укажите комментарий для причины «Другое»');

    btn.disabled = true;
    btn.textContent = 'Сохраняем…';

    const finalAmount = type === 'subtract' ? -Math.abs(amount) : Math.abs(amount);

    try {
      await api.manualTransaction({ operator_id: +opId, amount: finalAmount, reason: reason, comment: comment });
      invalidateCoinsData();
      statusEl.textContent = `✓ Сохранено: ${finalAmount > 0 ? '+' : ''}${finalAmount} ₡`;
      statusEl.className = 'status-line status-ok';
      el.querySelector('#manual-amount').value = '';
      el.querySelector('#manual-comment').value = '';
      el.querySelector('#manual-reason').value = '';
      clearOpSelection();
      showToast('Операция сохранена', 'ok');
      await reloadData();
      // Update right column without re-render
      const hist = el.querySelector('#manual-history-list');
      if (hist) {
        const freshItems = STATE.history
          .filter(t => ['manual_add','manual_subtract','manual_accrual','manual_deduction'].includes(t.type))
          .slice(0, 5);
        hist.innerHTML = freshItems.length ? freshItems.map(t =>
          '<div class="manual-tx-row">' +
            '<div class="manual-tx-sign ' + (t.amount >= 0 ? 'plus' : 'minus') + '">' + (t.amount >= 0 ? '+' : '') + t.amount + '</div>' +
            '<div class="manual-tx-body">' +
              '<div class="manual-tx-name">' + esc(t.operator_name) + '</div>' +
              '<div class="manual-tx-meta">' + esc(t.comment) + ' · ' + esc(t.created_by_name || 'Система') + ' · ' + fmtDate(t.created_at) + '</div>' +
            '</div>' +
          '</div>'
        ).join('') : '<div class="manual-empty">Операций пока нет</div>';
      }
      const stats = el.querySelector('#manual-stats');
      if (stats) {
        const s = todayStats();
        stats.innerHTML = `
          <div class="manual-stat"><div class="manual-stat-val">${s.count}</div><div class="manual-stat-label">Операций</div></div>
          <div class="manual-stat green"><div class="manual-stat-val">+${s.add}</div><div class="manual-stat-label">Начислено ₡</div></div>
          <div class="manual-stat red"><div class="manual-stat-val">−${s.sub}</div><div class="manual-stat-label">Списано ₡</div></div>`;
      }
    } catch(err) {
      statusEl.textContent = err.message;
      statusEl.className = 'status-line status-error';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Сохранить операцию';
    }
  });
}

/* Searchable operator dropdown */
let _opSearchSelected = null;

function initOpSearch(container, ops) {
  const input    = container.querySelector('#op-search-input');
  const dropdown = container.querySelector('#op-search-dropdown');
  const list     = container.querySelector('#op-search-list');
  const hiddenId = container.querySelector('#manual-op-id');
  const display  = container.querySelector('#op-selected-display');
  const dispName = container.querySelector('#op-selected-name');

  if (!ops.length) {
    input.placeholder = 'Операторы не найдены';
    input.disabled = true;
    return;
  }

  function renderList(filtered) {
    if (!filtered.length) {
      list.innerHTML = '<div class="op-search-empty">Оператор не найден</div>';
      return;
    }
    list.innerHTML = filtered.slice(0, 50).map(o => `
      <div class="op-search-item" data-id="${o.id}" data-name="${esc(o.full_name)}">
        <div class="op-search-name">${esc(o.full_name)}</div>
        <div class="op-search-meta">Группа: ${esc(o.group_name)} · ${o.current_balance} ₡</div>
      </div>`).join('');

    list.querySelectorAll('.op-search-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        selectOp(+item.dataset.id, item.dataset.name);
      });
    });
  }

  function selectOp(id, name) {
    _opSearchSelected = id;
    hiddenId.value = id;
    input.value = '';
    input.placeholder = 'Начните вводить имя или группу…';
    dispName.textContent = name;
    display.classList.add('visible');
    dropdown.setAttribute('hidden', '');
  }

  window.clearOpSelection = function() {
    _opSearchSelected = null;
    hiddenId.value = '';
    display.classList.remove('visible');
    input.value = '';
    input.focus();
  };

  input.addEventListener('focus', () => {
    renderList(ops);
    dropdown.removeAttribute('hidden');
  });

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    const filtered = q
      ? ops.filter(o =>
          o.full_name.toLowerCase().includes(q) ||
          o.group_name.toLowerCase().includes(q))
      : ops;
    renderList(filtered);
    dropdown.removeAttribute('hidden');
  });

  input.addEventListener('blur', () => {
    setTimeout(() => dropdown.setAttribute('hidden', ''), 150);
  });
}

/* ══════════════════════════════════════
   VIEW: ЗАЯВКИ ИЗ МАГАЗИНА
══════════════════════════════════════ */
const _requestsTabState = { status: 'new', group_id: 'all', bonus_id: 'all', operator_id: 'all', operator_name: '', limit: 20, offset: 0, data: null, newCount: null };

function invalidateCoinsData() {
  swrInvalidate('coins:');
  swrInvalidate('dashboard:');
  swrInvalidate('rating:');
  swrInvalidate('shop:purchases:');
}

async function ensureCoinFiltersLoaded() {
  if (!STATE.groups.length) {
    STATE.groups = await swrFetch('groups:list', () => api.listGroups(false), null, SWR_STATIC_TTL_MS).catch(() => STATE.groups || []);
  }
  if (!STATE.shopItems.length) {
    STATE.shopItems = await swrFetch('shop:items', () => api.listShopItems(), null, SWR_STATIC_TTL_MS).catch(() => STATE.shopItems || []);
  }
}

async function renderRequests() {
  const el = document.getElementById('view-requests');
  if (!el) return;

  await ensureCoinFiltersLoaded();

  const s = _requestsTabState;
  const groups = STATE.groups || [];
  const items = STATE.shopItems || [];

  el.innerHTML = `
    ${s.operator_id !== 'all' ? `
      <div class="filter-active-banner">
        Показаны только заявки оператора <b>${esc(s.operator_name || '#' + s.operator_id)}</b>
        <button class="btn-link" onclick="clearRequestsOperatorFilter()">Сбросить</button>
      </div>` : ''}

    <div class="filter-tabs" id="req-tabs">
      ${[
        ['new', `Новые <span class="badge" id="req-new-badge">…</span>`],
        ['approved', 'Одобрены'],
        ['rejected', 'Отклонены'],
        ['all', 'Все'],
      ].map(([f, label]) => `<button class="filter-tab ${s.status===f?'active':''}" data-filter="${f}">${label}</button>`).join('')}
    </div>

    <div class="panel coins-filter-panel" style="margin:12px 0">
      <div class="panel-head">
        <h3>Фильтры</h3>
        <div class="header-right">
          <button class="btn-outline btn-sm" onclick="reloadRequestsTab()">Обновить</button>
        </div>
      </div>
      <div class="filter-row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <div class="form-group" style="margin:0">
          <label class="form-label">Группа</label>
          <select id="req-f-group" class="form-input">
            <option value="all">Все группы</option>
            ${groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Товар</label>
          <select id="req-f-bonus" class="form-input">
            <option value="all">Все товары</option>
            ${items.map(i => `<option value="${i.id}">${esc(i.title)}</option>`).join('')}
          </select>
        </div>
        <button class="btn-primary btn-sm" onclick="applyRequestsFilters()">Применить</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Заявки</h3><span class="panel-badge" id="req-total-badge">…</span></div>
      <div id="requests-list"><div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div></div>
      <div class="panel-footer" id="req-pagination-host"></div>
    </div>`;

  document.getElementById('req-f-group').value = s.group_id;
  document.getElementById('req-f-bonus').value = s.bonus_id;

  el.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      s.status = tab.dataset.filter;
      s.offset = 0;
      el.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadRequestsTabData();
    });
  });

  loadRequestsTabData();
  refreshNewRequestsBadge();
}

async function refreshNewRequestsBadge() {
  const badge = document.getElementById('req-new-badge');
  if (!badge) return;
  try {
    const r = await swrFetch('coins:requests:badge:new', () => api.listCoinRequests({ status: 'new', limit: 1 }), null, SWR_FAST_TTL_MS);
    badge.textContent = r.total ?? 0;
  } catch { badge.textContent = '?'; }
}

function _requestStatusBadge(status) {
  return `<span class="status-badge status-${status}">${statusLabel(status)}</span>`;
}

async function loadRequestsTabData() {
  const listHost = document.getElementById('requests-list');
  const totalBadge = document.getElementById('req-total-badge');
  if (!listHost) return;
  const s = _requestsTabState;
  const params = { limit: s.limit, offset: s.offset };
  if (s.status !== 'all') params.status = s.status;
  if (s.group_id !== 'all') params.group_id = s.group_id;
  if (s.bonus_id !== 'all') params.bonus_id = s.bonus_id;
  if (s.operator_id !== 'all') params.operator_id = s.operator_id;

  let data;
  const key = `coins:requests:${stableParamsKey(params)}`;
  const renderFresh = fresh => {
    if (STATE.currentView === 'coins' && STATE.coinsTab === 'requests') paintRequestsTabData(fresh);
  };
  try {
    data = await swrFetch(key, () => api.listCoinRequests(params), renderFresh, SWR_FAST_TTL_MS);
  } catch (e) {
    listHost.innerHTML = `<div class="empty-line">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  paintRequestsTabData(data);
}

function paintRequestsTabData(data) {
  const listHost = document.getElementById('requests-list');
  const totalBadge = document.getElementById('req-total-badge');
  if (!listHost || STATE.currentView !== 'coins' || STATE.coinsTab !== 'requests') return;
  const s = _requestsTabState;
  s.data = data;
  const rows = data.items || [];
  if (totalBadge) totalBadge.textContent = `${data.total ?? rows.length} записей`;

  listHost.innerHTML = rows.length ? rows.map(p => `
    <div class="request-card status-${p.status}">
      <div class="request-info">
        <div class="request-title">${esc(p.bonus_name)}</div>
        <div class="request-meta">
          <span><b>${esc(p.operator_name)}</b></span>
          <span>·</span><span>${esc(p.group_name || '—')}</span>
          <span>·</span><span class="accent-text">${p.price} ₡</span>
          <span>·</span><span>${fmtDate(p.created_at)}</span>
        </div>
        ${p.reject_reason ? `<div class="request-reason">Причина отказа: ${esc(p.reject_reason)}</div>` : ''}
      </div>
      <div class="request-status">${_requestStatusBadge(p.status)}</div>
      ${(p.status === 'pending' || p.status === 'new') ? `
        <div class="request-actions">
          <button class="btn-ok approve-btn" data-id="${p.id}">✓ Одобрить</button>
          <button class="btn-danger reject-btn" data-id="${p.id}">✗ Отклонить</button>
        </div>` : ''}
      ${p.status === 'approved' ? `
        <div class="request-actions">
          <button class="btn-ghost complete-btn" data-id="${p.id}">Отметить выполненной</button>
        </div>` : ''}
    </div>`).join('') : '<div class="empty-state">Заявок нет</div>';

  bindRequestActions();

  const pager = document.getElementById('req-pagination-host');
  if (pager) {
    const total = data.total ?? rows.length;
    const from = s.offset + 1;
    const to = Math.min(total, s.offset + s.limit);
    pager.innerHTML = `
      <span class="cell-muted">${total ? `${from}–${to} из ${total}` : ''}</span>
      <div style="display:flex;gap:8px">
        <button class="btn-outline btn-sm" ${s.offset === 0 ? 'disabled' : ''} onclick="requestsPagePrev()">← Назад</button>
        <button class="btn-outline btn-sm" ${to >= total ? 'disabled' : ''} onclick="requestsPageNext()">Далее →</button>
      </div>`;
  }
}

function applyRequestsFilters() {
  _requestsTabState.group_id = document.getElementById('req-f-group')?.value || 'all';
  _requestsTabState.bonus_id = document.getElementById('req-f-bonus')?.value || 'all';
  _requestsTabState.offset = 0;
  loadRequestsTabData();
}
function requestsPagePrev() { _requestsTabState.offset = Math.max(0, _requestsTabState.offset - _requestsTabState.limit); loadRequestsTabData(); }
function requestsPageNext() { _requestsTabState.offset += _requestsTabState.limit; loadRequestsTabData(); }
function reloadRequestsTab() { loadRequestsTabData(); refreshNewRequestsBadge(); }

function openRequestsForOperator(operatorId, operatorName) {
  _requestsTabState.operator_id = String(operatorId);
  _requestsTabState.operator_name = operatorName;
  _requestsTabState.status = 'all';
  _requestsTabState.offset = 0;
  navigateTo('coins', { tab: 'requests' });
}
function clearRequestsOperatorFilter() {
  _requestsTabState.operator_id = 'all';
  _requestsTabState.offset = 0;
  renderRequests();
}

function exportShopRequests(format) {
  const s = _requestsTabState;
  const params = { format };
  if (s.status !== 'all') params.status = s.status;
  if (s.operator_id !== 'all') params.operator_id = s.operator_id;
  window.open(api.exportUrl('/api/exports/shop-requests', params), '_blank');
}

function bindRequestActions() {
  const el = document.getElementById('view-requests');
  if (!el) return;
  el.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api.approveCoinRequest(+btn.dataset.id);
        invalidateCoinsData();
        showToast('Заявка одобрена', 'ok');
        STATE.dashboard = await swrFetch('dashboard:main', () => api.getDashboard().catch(() => STATE.dashboard), null, SWR_DEFAULT_TTL_MS);
        loadRequestsTabData();
        refreshNewRequestsBadge();
      } catch (err) { showToast(err.message, 'error'); btn.disabled = false; }
    });
  });
  el.querySelectorAll('.reject-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = prompt('Причина отказа (обязательно):');
      if (!reason?.trim()) return;
      btn.disabled = true;
      try {
        await api.rejectCoinRequest(+btn.dataset.id, reason.trim());
        invalidateCoinsData();
        showToast('Заявка отклонена', 'ok');
        STATE.dashboard = await swrFetch('dashboard:main', () => api.getDashboard().catch(() => STATE.dashboard), null, SWR_DEFAULT_TTL_MS);
        loadRequestsTabData();
        refreshNewRequestsBadge();
      } catch (err) { showToast(err.message, 'error'); btn.disabled = false; }
    });
  });
  el.querySelectorAll('.complete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api.completeCoinRequest(+btn.dataset.id);
        invalidateCoinsData();
        loadRequestsTabData();
      } catch (err) { showToast(err.message, 'error'); btn.disabled = false; }
    });
  });
}

/* ══════════════════════════════════════
   VIEW: ИСТОРИЯ ОПЕРАЦИЙ
══════════════════════════════════════ */
const _historyTabState = {
  filters: { type: 'all', operator_id: 'all', operator_name: '', source: 'all', created_by: 'all', start_date: '', end_date: '' },
  limit: 50, offset: 0, data: null,
};

const _historySourceLabels = {
  weekly_auto_accrual: 'Автоматический расчёт',
  achievement: 'Достижение',
  level_up: 'Повышение уровня',
  manual: 'Ручная операция',
  manual_grant: 'Ручная выдача',
  wheel_spin: 'Колесо WOW',
};

function renderHistory() {
  const el = document.getElementById('view-history');
  if (!el) return;
  const f = _historyTabState.filters;

  el.innerHTML = `
    ${f.operator_id !== 'all' ? `
      <div class="filter-active-banner">
        Показаны только операции оператора <b>${esc(f.operator_name || '#' + f.operator_id)}</b>
        <button class="btn-link" onclick="clearHistoryOperatorFilter()">Сбросить</button>
      </div>` : ''}

    <div class="panel coins-filter-panel" style="margin-bottom:16px">
      <div class="panel-head">
        <h3>Фильтры</h3>
        <div class="header-right">
          <button class="btn-outline btn-sm" onclick="reloadHistoryTab()">Обновить</button>
        </div>
      </div>
      <div class="filter-row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <div class="form-group" style="margin:0">
          <label class="form-label">Тип</label>
          <select id="hist-f-type" class="form-input">
            <option value="all">Все</option>
            <option value="weekly_accrual">Авт. начисление</option>
            <option value="bonus_top">Бонус: топ недели</option>
            <option value="bonus_no_late">Бонус: без опозданий</option>
            <option value="bonus_no_violation">Бонус: без нарушений</option>
            <option value="bonus_nomination">Бонус: номинация</option>
            <option value="bonus_driver_thanks">Бонус: благодарность</option>
            <option value="achievement_reward">Достижение</option>
            <option value="manual_add">Ручное начисление</option>
            <option value="manual_subtract">Ручное списание</option>
            <option value="purchase">Покупка бонуса</option>
            <option value="refund">Возврат коинов</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Источник</label>
          <select id="hist-f-source" class="form-input">
            <option value="all">Все</option>
            <option value="weekly_auto_accrual">Еженедельный расчёт</option>
            <option value="achievement">Достижение</option>
            <option value="level_up">Повышение уровня</option>
            <option value="wheel_spin">Колесо WOW</option>
            <option value="manual">Ручная операция</option>
            <option value="manual_grant">Ручная выдача</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Дата от</label>
          <input type="date" id="hist-f-start" class="form-input" value="${esc(f.start_date)}">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Дата до</label>
          <input type="date" id="hist-f-end" class="form-input" value="${esc(f.end_date)}">
        </div>
        <button class="btn-primary btn-sm" onclick="applyHistoryFilters()">Применить</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Транзакции</h3>
        <span class="panel-badge" id="hist-total-badge">…</span>
      </div>
      <div class="table-wrap" id="hist-table-host">
        <div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>
      </div>
      <div class="panel-footer" id="hist-pagination-host"></div>
    </div>`;

  document.getElementById('hist-f-type').value = f.type;
  document.getElementById('hist-f-source').value = f.source;
  loadHistoryTabData();
}

async function loadHistoryTabData() {
  const tableHost = document.getElementById('hist-table-host');
  const badge = document.getElementById('hist-total-badge');
  if (!tableHost) return;
  const f = _historyTabState.filters;
  const params = { limit: _historyTabState.limit, offset: _historyTabState.offset };
  if (f.type !== 'all') params.type = f.type;
  if (f.source !== 'all') params.source = f.source;
  if (f.operator_id !== 'all') params.operator_id = f.operator_id;
  if (f.start_date) params.start_date = f.start_date;
  if (f.end_date) params.end_date = f.end_date;

  let data;
  const key = `coins:transactions:${stableParamsKey(params)}`;
  const renderFresh = fresh => {
    if (STATE.currentView === 'coins' && STATE.coinsTab === 'history') paintHistoryTabData(fresh);
  };
  try {
    data = await swrFetch(key, () => api.listCoinTransactions(params), renderFresh, SWR_FAST_TTL_MS);
  } catch (e) {
    tableHost.innerHTML = `<div class="empty-line">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  paintHistoryTabData(data);
}

function paintHistoryTabData(data) {
  const tableHost = document.getElementById('hist-table-host');
  const badge = document.getElementById('hist-total-badge');
  if (!tableHost || STATE.currentView !== 'coins' || STATE.coinsTab !== 'history') return;
  _historyTabState.data = data;
  const items = data.items || [];
  if (badge) badge.textContent = `${data.total ?? items.length} записей`;

  tableHost.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Дата</th><th>Оператор</th><th>Группа</th>
        <th>Тип</th><th>Коины</th><th>Причина</th><th>Автор</th><th>Источник</th>
      </tr></thead>
      <tbody>
        ${items.length ? items.map(t => `
          <tr>
            <td style="white-space:nowrap">${fmtDate(t.created_at)}</td>
            <td class="name-cell">${esc(t.operator_name)}</td>
            <td>${esc(t.group_name)}</td>
            <td><span style="font-size:11px;color:var(--tx3)">${esc(transactionTypeLabel(t.type))}</span></td>
            <td><b style="color:${t.amount>=0?'var(--ok)':'var(--danger)'}">${t.amount>=0?'+':''}${t.amount} ₡</b></td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.comment)}">${esc(t.comment)}</td>
            <td style="font-size:12px;color:var(--tx3)">${esc(t.created_by_name||'Система')}</td>
            <td style="font-size:11px;color:var(--tx3)">${esc(_historySourceLabels[t.source_type] || t.source_type || '—')}</td>
          </tr>`).join('') : '<tr><td colspan="8" class="empty-line">Нет операций по заданным фильтрам</td></tr>'}
      </tbody>
    </table>`;

  const pager = document.getElementById('hist-pagination-host');
  if (pager) {
    const total = data.total ?? items.length;
    const from = _historyTabState.offset + 1;
    const to = Math.min(total, _historyTabState.offset + _historyTabState.limit);
    pager.innerHTML = `
      <span class="cell-muted">${total ? `${from}–${to} из ${total}` : ''}</span>
      <div style="display:flex;gap:8px">
        <button class="btn-outline btn-sm" ${_historyTabState.offset === 0 ? 'disabled' : ''} onclick="historyPagePrev()">← Назад</button>
        <button class="btn-outline btn-sm" ${to >= total ? 'disabled' : ''} onclick="historyPageNext()">Далее →</button>
      </div>`;
  }
}

function openHistoryForOperator(operatorId, operatorName) {
  _historyTabState.filters.operator_id = String(operatorId);
  _historyTabState.filters.operator_name = operatorName;
  _historyTabState.offset = 0;
  navigateTo('coins', { tab: 'history' });
}
function clearHistoryOperatorFilter() {
  _historyTabState.filters.operator_id = 'all';
  _historyTabState.offset = 0;
  renderHistory();
}

function applyHistoryFilters() {
  _historyTabState.filters.type = document.getElementById('hist-f-type')?.value || 'all';
  _historyTabState.filters.source = document.getElementById('hist-f-source')?.value || 'all';
  _historyTabState.filters.start_date = document.getElementById('hist-f-start')?.value || '';
  _historyTabState.filters.end_date = document.getElementById('hist-f-end')?.value || '';
  _historyTabState.offset = 0;
  loadHistoryTabData();
}

function historyPagePrev() {
  _historyTabState.offset = Math.max(0, _historyTabState.offset - _historyTabState.limit);
  loadHistoryTabData();
}
function historyPageNext() {
  _historyTabState.offset += _historyTabState.limit;
  loadHistoryTabData();
}
function reloadHistoryTab() { loadHistoryTabData(); }

function exportHistoryServerSide(format = 'csv') {
  const f = _historyTabState.filters;
  const params = { format };
  if (f.type !== 'all') params.type = f.type;
  if (f.source !== 'all') params.source = f.source;
  if (f.operator_id !== 'all') params.operator_id = f.operator_id;
  if (f.start_date) params.start_date = f.start_date;
  if (f.end_date) params.end_date = f.end_date;
  window.open(api.exportUrl('/api/exports/coin-transactions', params), '_blank');
}

/* ══════════════════════════════════════
   VIEW: ГРУППЫ
══════════════════════════════════════ */
async function renderGroups() {
  const el = document.getElementById('view-groups');
  if (!el) return;
  const myNavGen = STATE.navGen;

  if (!canManageGroups()) {
    el.innerHTML = `
      <div class="view-header">
        <div><div class="section-kicker">Группы</div><h2 class="section-title">Управление группами</h2></div>
      </div>
      <div class="empty-state"><p>Недостаточно прав для управления группами</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Группы</div><h2 class="section-title">Управление группами</h2></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="renderGroups()">Обновить</button>
        <button class="btn-primary btn-sm" onclick="showAddGroupModal()">Создать группу</button>
      </div>
    </div>
    <div class="panel">
      <div class="loading-state"><div class="loading-spinner"></div><p>Загрузка групп…</p></div>
    </div>`;

  try {
    STATE.groups = await swrFetch('groups:list', () => api.listGroups(false), null, SWR_STATIC_TTL_MS);
  } catch(e) {
    if (isNavStale(myNavGen)) return;
    el.innerHTML = `
      <div class="view-header">
        <div><div class="section-kicker">Группы</div><h2 class="section-title">Управление группами</h2></div>
        <button class="btn-outline btn-sm" onclick="renderGroups()">Повторить</button>
      </div>
      <div class="status-line status-error" style="padding:20px">Не удалось загрузить список групп</div>`;
    return;
  }
  if (isNavStale(myNavGen)) return; // ушли с "Групп" пока ждали ответ сервера

  const rows = STATE.groups;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Группы</div><h2 class="section-title">Управление группами</h2></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="renderGroups()">Обновить</button>
        <button class="btn-primary btn-sm" onclick="showAddGroupModal()">Создать группу</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Список групп</h3>
        <span class="panel-badge">${rows.length} групп</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Название группы</th>
            <th>Статус</th>
            <th>Количество операторов</th>
            <th>Действия</th>
          </tr></thead>
          <tbody>
            ${rows.length ? rows.map(g => `
              <tr>
                <td class="name-cell">${esc(g.name)}</td>
                <td>${groupStatusBadge(g.status)}</td>
                <td>${g.operator_count || 0}</td>
                <td style="display:flex;gap:8px;flex-wrap:wrap">
                  <button class="btn-outline btn-sm" onclick="showEditGroupModal(${g.id})">Изменить</button>
                  <button class="btn-outline btn-sm" onclick="toggleGroupStatus(${g.id}, '${g.status === 'active' ? 'inactive' : 'active'}')">
                    ${g.status === 'active' ? 'Отключить' : 'Включить'}
                  </button>
                  <button class="btn-outline btn-sm danger-text" onclick="confirmDeleteGroup(${g.id})">Удалить</button>
                </td>
              </tr>`).join('') : '<tr><td colspan="4" class="empty-line">Группы не созданы</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

function groupStatusBadge(status) {
  const isActive = status === 'active';
  return `<span class="status-badge ${isActive ? 'status-active' : 'status-inactive'}">${isActive ? 'Активна' : 'Отключена'}</span>`;
}

function showAddGroupModal() {
  showModal(`
    <h3 class="modal-title">Создание группы</h3>
    <div class="form-group">
      <label class="form-label">Название группы</label>
      <input id="group-name" class="form-input" placeholder="Группа звонков">
    </div>
    <div class="form-group">
      <label class="form-label">Статус</label>
      <select id="group-status" class="form-select">
        <option value="active" selected>Активна</option>
        <option value="inactive">Отключена</option>
      </select>
    </div>
    <div id="group-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitAddGroup()">Создать группу</button>`);
}

async function submitAddGroup() {
  const name = document.getElementById('group-name')?.value?.trim();
  const status = document.getElementById('group-status')?.value || 'active';
  const err = document.getElementById('group-err');
  if (!name) {
    err.textContent = 'Название группы обязательно';
    err.className = 'status-line status-error';
    return;
  }
  try {
    await api.createGroup({ name, status });
    swrInvalidate('groups:');
    closeModal();
    showToast('Группа создана', 'ok');
    await renderGroups();
  } catch(e) {
    err.textContent = e.message;
    err.className = 'status-line status-error';
  }
}

function showEditGroupModal(id) {
  const group = STATE.groups.find(g => g.id === id);
  if (!group) return showToast('Группа не найдена', 'error');
  showModal(`
    <h3 class="modal-title">Редактировать группу</h3>
    <div class="form-group">
      <label class="form-label">Название группы</label>
      <input id="edit-group-name" class="form-input" value="${esc(group.name)}">
    </div>
    <div class="form-group">
      <label class="form-label">Статус</label>
      <select id="edit-group-status" class="form-select">
        <option value="active" ${group.status === 'active' ? 'selected' : ''}>Активна</option>
        <option value="inactive" ${group.status === 'inactive' ? 'selected' : ''}>Отключена</option>
      </select>
    </div>
    <div id="edit-group-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitEditGroup(${id})">Сохранить</button>`);
}

async function submitEditGroup(id) {
  const name = document.getElementById('edit-group-name')?.value?.trim();
  const status = document.getElementById('edit-group-status')?.value || 'active';
  const err = document.getElementById('edit-group-err');
  if (!name) {
    err.textContent = 'Название группы обязательно';
    err.className = 'status-line status-error';
    return;
  }
  try {
    await api.updateGroup(id, { name, status });
    swrInvalidate('groups:');
    closeModal();
    showToast('Группа обновлена', 'ok');
    await renderGroups();
  } catch(e) {
    err.textContent = e.message;
    err.className = 'status-line status-error';
  }
}

async function toggleGroupStatus(id, nextStatus) {
  if (nextStatus === 'inactive') {
    showModal(`
      <h3 class="modal-title">Отключить группу?</h3>
      <p style="color:var(--tx2);line-height:1.6">
        Новые операторы не смогут быть добавлены в эту группу, но текущие данные сохранятся.
      </p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn-outline" onclick="closeModal()">Отмена</button>
        <button class="btn-danger" onclick="applyGroupStatus(${id}, 'inactive')">Отключить</button>
      </div>`);
    return;
  }
  await applyGroupStatus(id, nextStatus);
}

async function applyGroupStatus(id, nextStatus) {
  try {
    if (nextStatus === 'active') {
      await api.enableGroup(id);
    } else {
      await api.disableGroup(id);
    }
    swrInvalidate('groups:');
    closeModal();
    showToast(nextStatus === 'active' ? 'Группа включена' : 'Группа отключена', 'ok');
    await renderGroups();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

function confirmDeleteGroup(id) {
  const group = STATE.groups.find(g => g.id === id);
  if (!group) return showToast('Группа не найдена', 'error');
  showModal(`
    <h3 class="modal-title">Удалить группу?</h3>
    <p style="color:var(--tx2);line-height:1.6">
      Группу можно удалить только если в ней нет операторов и исторических данных.
      Это действие нельзя отменить.
    </p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-danger" onclick="deleteGroup(${id})">Удалить</button>
    </div>`);
}

async function deleteGroup(id) {
  try {
    await api.deleteGroup(id);
    swrInvalidate('groups:');
    closeModal();
    showToast('Группа удалена', 'ok');
    await renderGroups();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function ensureGroupsLoaded() {
  if (!STATE.groups.length) {
    STATE.groups = await swrFetch('groups:list', () => api.listGroups(false), null, SWR_STATIC_TTL_MS);
  }
  return STATE.groups;
}

function groupOptionsForOperator(groups, selectedId) {
  return groups
    .filter(g => g.status === 'active' || g.id === selectedId)
    .map(g => `
      <option value="${g.id}" ${g.id === selectedId ? 'selected' : ''}>
        ${esc(g.name)}${g.status !== 'active' ? ' (отключена)' : ''}
      </option>`)
    .join('');
}

async function showEditOperatorModal(id) {
  if (!canManageOperators()) return showToast('Недостаточно прав', 'error');
  showModal('<div class="loading-state" style="min-height:180px"><div class="loading-spinner"></div><p>Загрузка оператора…</p></div>');
  try {
    const [op, groups] = await Promise.all([api.getOperator(id), ensureGroupsLoaded()]);
    const groupOptions = groupOptionsForOperator(groups, op.group_id);
    showModal(`
      <h3 class="modal-title">Редактировать оператора</h3>
      <div style="display:grid;gap:12px">
        <div class="form-group">
          <label class="form-label">ФИО <span style="color:var(--danger)">*</span></label>
          <input id="edit-op-name" class="form-input" value="${esc(op.full_name)}">
        </div>
        <div class="form-group">
          <label class="form-label">Группа <span style="color:var(--danger)">*</span></label>
          <select id="edit-op-group-id" class="form-select">${groupOptions}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Статус участия <span style="color:var(--danger)">*</span></label>
          <select id="edit-op-participation" class="form-select" ${isOperatorDismissed(op) ? 'disabled' : ''}>
            <option value="participating" ${op.participation_status === 'participating' ? 'selected' : ''}>Участвует</option>
            <option value="not_participating" ${op.participation_status !== 'participating' ? 'selected' : ''}>Не участвует</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Должность <span style="color:var(--danger)">*</span></label>
          <select id="edit-op-position" class="form-select">
            <option value="operator" ${(op.position || 'operator') === 'operator' ? 'selected' : ''}>Оператор</option>
            <option value="chat_manager" ${op.position === 'chat_manager' ? 'selected' : ''}>Чат-менеджер</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input id="edit-op-email" class="form-input" type="email" value="${esc(op.email || '')}" placeholder="operator@company.com">
        </div>
        <div class="form-group">
          <label class="form-label">Логин <span style="color:var(--danger)">*</span></label>
          <input id="edit-op-username" class="form-input" value="${esc(op.username || '')}">
        </div>
      </div>
      <div id="edit-op-err" class="status-line"></div>
      <button class="btn-primary" style="width:100%" onclick="submitEditOperator(${id})">Сохранить</button>
    `);
  } catch(e) {
    showModal(`
      <h3 class="modal-title">Не удалось открыть оператора</h3>
      <div class="status-line status-error">${esc(e.message)}</div>
      <button class="btn-outline" onclick="closeModal()">Закрыть</button>`);
  }
}

async function submitEditOperator(id) {
  const err = document.getElementById('edit-op-err');
  const setErr = msg => { err.textContent = msg; err.className = 'status-line status-error'; };
  const fullName = document.getElementById('edit-op-name')?.value?.trim();
  const groupId = document.getElementById('edit-op-group-id')?.value;
  const participationStatus = document.getElementById('edit-op-participation')?.value || 'not_participating';
  const position = document.getElementById('edit-op-position')?.value || 'operator';
  const email = document.getElementById('edit-op-email')?.value?.trim() || null;
  const username = document.getElementById('edit-op-username')?.value?.trim();

  if (!fullName || fullName.length < 2) return setErr('ФИО обязательно');
  if (!groupId) return setErr('Выберите группу');
  if (!username) return setErr('Логин обязателен');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setErr('Введите корректный email');

  try {
    await api.updateOperator(id, {
      full_name: fullName,
      group_id: +groupId,
      participation_status: participationStatus,
      position,
      email,
      username,
    });
    closeModal();
    showToast('Оператор обновлён', 'ok');
    await reloadData();
  } catch(e) {
    setErr(e.message);
  }
}

function resetOperatorPassword(id) {
  const op = STATE.adminOperators.find(o => o.id === id);
  showModal(`
    <h3 class="modal-title">Сбросить пароль?</h3>
    <p style="color:var(--tx2);line-height:1.6">
      Будет создан новый временный пароль для ${esc(op?.full_name || 'оператора')}.
      Пароль будет показан только один раз.
    </p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" onclick="performResetOperatorPassword(${id})">Сбросить пароль</button>
    </div>`);
}

async function performResetOperatorPassword(id) {
  try {
    const result = await api.resetOperatorPassword(id);
    const text = `Оператор: ${result.full_name}\nВременный пароль: ${result.new_password}`;
    showModal(`
      <h3 class="modal-title" style="color:var(--ok)">Пароль сброшен</h3>
      <div class="credential-box">
        <div>Оператор: <b>${esc(result.full_name)}</b></div>
        <div>Временный пароль: <code>${esc(result.new_password)}</code></div>
      </div>
      <button id="copy-reset-password" class="btn-outline" style="width:100%">Скопировать пароль</button>
      <button class="btn-primary" style="width:100%" onclick="closeModal()">Готово</button>`);
    document.getElementById('copy-reset-password')?.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => showToast('Скопировано!', 'ok'));
    });
  } catch(e) {
    showToast(e.message, 'error');
  }
}

function confirmDismissOperator(id) {
  const op = STATE.adminOperators.find(o => o.id === id);
  showModal(`
    <h3 class="modal-title">Уволить оператора?</h3>
    <p style="color:var(--tx2);line-height:1.6">
      После увольнения оператор не сможет входить на сайт и участвовать в рейтинге.
      История начислений, заявок и операций сохранится.
    </p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-danger" onclick="dismissOperator(${id})">Уволить</button>
    </div>`);
}

async function dismissOperator(id) {
  try {
    await api.dismissOperator(id);
    closeModal();
    showToast('Оператор уволен', 'ok');
    await reloadData();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

function showRestoreOperatorModal(id) {
  const op = STATE.adminOperators.find(o => o.id === id);
  showModal(`
    <h3 class="modal-title">Восстановить оператора</h3>
    <p style="color:var(--tx2);line-height:1.6">
      ${esc(op?.full_name || 'Оператор')} снова сможет входить на сайт.
    </p>
    <div class="form-group">
      <label class="form-label">Статус участия</label>
      <select id="restore-op-participation" class="form-select">
        <option value="participating">Участвует</option>
        <option value="not_participating">Не участвует</option>
      </select>
    </div>
    <div id="restore-op-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%" onclick="submitRestoreOperator(${id})">Восстановить</button>`);
}

async function submitRestoreOperator(id) {
  const participationStatus = document.getElementById('restore-op-participation')?.value || 'participating';
  try {
    await api.restoreOperator(id, { participation_status: participationStatus });
    closeModal();
    showToast('Оператор восстановлен', 'ok');
    await reloadData();
  } catch(e) {
    const err = document.getElementById('restore-op-err');
    if (err) { err.textContent = e.message; err.className = 'status-line status-error'; }
  }
}

function confirmDeleteOperator(operatorId) {
  // operatorId — это operators.id
  const op = STATE.users.find(u => u.operator_id === operatorId);
  const name = op ? op.full_name : `Оператор #${operatorId}`;
  showModal(`
    <div class="acc-modal">
      <h3 class="acc-title" style="color:var(--danger)">⚠ Удалить оператора?</h3>
      <p style="color:var(--tx2);line-height:1.6;margin:12px 0">
        Вы удаляете <b>${esc(name)}</b>.
      </p>
      <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:12px 14px;margin-bottom:16px">
        <div style="font-weight:600;color:var(--danger);margin-bottom:6px">Будет удалено навсегда:</div>
        <ul style="margin:0;padding-left:18px;color:var(--tx2);line-height:1.8;font-size:13px">
          <li>Профиль оператора</li>
          <li>Вся история расчётов и баллов</li>
          <li>Ежедневные метрики</li>
          <li>Транзакции коинов</li>
          <li>Уровни и история уровней</li>
          <li>Покупки в магазине</li>
          <li>Учётная запись (логин/пароль)</li>
        </ul>
      </div>
      <p style="color:var(--tx3);font-size:12px;margin-bottom:16px">
        Это действие невозможно отменить. Доступно только администратору.
      </p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn-outline" onclick="closeModal()">Отмена</button>
        <button class="btn-danger" onclick="deleteOperator(${operatorId})">Удалить навсегда</button>
      </div>
    </div>`);
}

async function deleteOperator(operatorId) {
  try {
    const btn = document.querySelector('.btn-danger[onclick*="deleteOperator"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Удаление…'; }
    await api.deleteOperator(operatorId);
    closeModal();
    showToast('Оператор удалён', 'ok');
    swrInvalidate('users:list');
    swrInvalidate('dashboard:operators');
    await reloadData();
  } catch(e) {
    showToast(e.message || 'Ошибка удаления', 'error');
    const btn = document.querySelector('.btn-danger[onclick*="deleteOperator"]');
    if (btn) { btn.disabled = false; btn.textContent = 'Удалить навсегда'; }
  }
}

async function showOperatorHistoryModal(id) {
  showModal('<div class="loading-state" style="min-height:180px"><div class="loading-spinner"></div><p>Загрузка истории…</p></div>');
  try {
    const data = await api.operatorHistory(id);
    const op = data.operator || {};
    const audit = data.audit_logs || [];
    const transactions = data.transactions || [];
    const purchases = data.purchases || [];
    const weekly = data.weekly_results || [];
    showModal(`
      <h3 class="modal-title">История оператора</h3>
      <div class="credential-box">
        <div><b>${esc(op.full_name || '')}</b></div>
        <div>${esc(op.group_name || '')} · ${operatorStatusBadge(op)}</div>
      </div>
      <div class="history-block">
        <h4>Журнал действий</h4>
        ${audit.length ? audit.map(row => `<div class="history-line"><span>${fmtDateTime(row.created_at)}</span><b>${esc(row.action)}</b><small>${esc(row.details || '')}</small></div>`).join('') : '<div class="empty-line">Нет записей</div>'}
      </div>
      <div class="history-block">
        <h4>Коины</h4>
        ${transactions.length ? transactions.map(row => `<div class="history-line"><span>${fmtDateTime(row.created_at)}</span><b>${row.amount > 0 ? '+' : ''}${row.amount} ₡</b><small>${esc(row.comment || row.type)}</small></div>`).join('') : '<div class="empty-line">Нет операций</div>'}
      </div>
      <div class="history-block">
        <h4>Заявки</h4>
        ${purchases.length ? purchases.map(row => `<div class="history-line"><span>${fmtDateTime(row.created_at)}</span><b>${statusLabel(row.status)}</b><small>${row.price} ₡</small></div>`).join('') : '<div class="empty-line">Нет заявок</div>'}
      </div>
      <div class="history-block">
        <h4>Рейтинг</h4>
        ${weekly.length ? weekly.map(row => `<div class="history-line"><span>${fmtDate(row.week_start)}–${fmtDate(row.week_end)}</span><b>${row.final_score || 0}</b><small>место: ${row.rank_position || '—'}, коины: ${row.coins_earned || 0}</small></div>`).join('') : '<div class="empty-line">Нет результатов</div>'}
      </div>
      <button class="btn-outline" onclick="closeModal()">Закрыть</button>`);
  } catch(e) {
    showModal(`
      <h3 class="modal-title">Не удалось загрузить историю</h3>
      <div class="status-line status-error">${esc(e.message)}</div>
      <button class="btn-outline" onclick="closeModal()">Закрыть</button>`);
  }
}

/* ══════════════════════════════════════
   MODALS
══════════════════════════════════════ */
function showModal(html, options = {}) {
  let overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }
  const forced = Boolean(options.force);
  overlay.dataset.force = forced ? 'true' : 'false';
  const extraClass = options.className ? String(options.className).replace(/[^a-zA-Z0-9_\- ]/g, '') : '';
  overlay.innerHTML = `<div class="modal ${forced ? 'modal-forced' : ''} ${extraClass}">${html}${forced ? '' : '<button class="modal-close" onclick="closeModal()">✕</button>'}</div>`;
  overlay.style.display = 'flex';
  overlay.onclick = e => { if (e.target === overlay && !forced) closeModal(); };
}
function closeModal(force = false) {
  const o = document.getElementById('modal-overlay');
  if (o?.dataset.force === 'true' && !force) return;
  if (o) o.style.display = 'none';
}


/* ══════════════════════════════════════
   СТАВКИ И НОРМЫ ЧАСОВ
══════════════════════════════════════ */

function tenureBadgeHtml(days) {
  if (days == null || isNaN(days)) return '<span class="cell-muted">—</span>';
  const months = Math.floor(Math.max(0, days) / 30);
  const d = days % 30;
  let label, cls;
  if (months >= 61)      { label = months + 'м'; cls = 'tenure-pro'; }
  else if (months >= 41) { label = months + 'м'; cls = 'tenure-op'; }
  else if (months >= 16) { label = months + 'м'; cls = 'tenure-mid'; }
  else                   { label = months > 0 ? months + 'м' : d + 'д'; cls = 'tenure-new'; }
  return `<span class="tenure-badge ${cls}">${label}</span>`;
}

function rateBadgeHtml(rate, operatorId) {
  if (rate == null) {
    const btn = operatorId ? ` <button class="btn-link" style="font-size:11px;color:var(--warning)" onclick="showSetRateModal(${operatorId})">Задать</button>` : '';
    return `<span class="rate-badge rate-none">—${btn}</span>`;
  }
  const r = parseFloat(rate); // защита от строк и Decimal
  const cls = r === 0.5 ? 'rate-half' : r === 0.75 ? 'rate-three-q' : 'rate-full';
  const btn = operatorId ? ` <button class="btn-link" style="font-size:11px" onclick="showSetRateModal(${operatorId})">✎</button>` : '';
  return `<span class="rate-badge ${cls}">${r}${btn}</span>`;
}

async function showSetRateModal(operatorId) {
  const op = STATE.users.find(u => u.operator_id === operatorId) || STATE.adminOperators.find(o => o.id === operatorId);
  const name = op?.full_name || `Оператор #${operatorId}`;
  const current = op?.rate != null ? parseFloat(op.rate) : null;

  showModal(`
    <div class="acc-modal">
      <h3 class="acc-title">Ставка оператора</h3>
      <div class="status-line" style="padding:0;color:var(--tx2)"><b>${esc(name)}</b></div>
      <div class="acc-divider"></div>
      <div class="acc-section">
        <div class="form-group">
          <label class="form-label">Ставка</label>
          <select id="rate-select" class="form-select">
            <option value="">— не указана —</option>
            <option value="0.5" ${current === 0.5 ? 'selected' : ''}>0.5 ставки</option>
            <option value="0.75" ${current === 0.75 ? 'selected' : ''}>0.75 ставки</option>
            <option value="1.0" ${current === 1.0 ? 'selected' : ''}>1.0 ставка</option>
          </select>
        </div>
        <div id="rate-err" class="acc-field-err"></div>
        <button class="acc-btn" onclick="submitSetRate(${operatorId})">Сохранить</button>
      </div>
    </div>
  `);
}

async function submitSetRate(operatorId) {
  const val = document.getElementById('rate-select')?.value;
  const rate = val === '' ? null : parseFloat(val);
  const errEl = document.getElementById('rate-err');
  try {
    await api._req('PATCH', `/api/work-norms/operators/${operatorId}/rate`, { rate });
    showToast('Ставка сохранена', 'ok');
    closeModal();
    swrInvalidate('users:list');
    await reloadData();
  } catch(e) {
    if (errEl) errEl.textContent = e.message;
  }
}

/* ── Управление нормами часов ──────────────────────── */

async function showWorkNormsModal() {
  showModal('<div class="acc-modal"><h3 class="acc-title">Нормы часов</h3><div class="loading-spinner" style="margin:24px auto"></div></div>', { wide: true });
  try {
    const norms = await api._req('GET', '/api/work-norms');
    renderWorkNormsModal(norms);
  } catch(e) {
    showToast(e.message, 'error');
    closeModal();
  }
}

function renderWorkNormsModal(norms) {
  const canEdit = ['manager','admin'].includes(STATE.user?.role);

  // Группируем по год/месяц
  const byMonth = {};
  for (const n of norms) {
    const key = `${n.year}-${String(n.month).padStart(2,'0')}`;
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(n);
  }

  const MONTH_RU = ['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  const groupsHtml = Object.entries(byMonth).sort((a,b) => b[0].localeCompare(a[0])).map(([key, rows]) => {
    const [y, m] = key.split('-');
    const rowsHtml = rows.sort((a,b) => a.rate - b.rate).map(n => `
      <tr class="${n.is_active ? '' : 'operator-dismissed-row'}">
        <td><span class="rate-badge ${n.rate===0.5?'rate-half':n.rate===0.75?'rate-three-q':'rate-full'}">${n.rate}</span></td>
        <td><b>${n.monthly_norm_hours}</b> ч</td>
        <td>${n.month_days} дн.</td>
        <td>${n.is_active ? '<span class="status-badge status-active">Активна</span>' : '<span class="status-badge status-inactive">Отключена</span>'}</td>
        <td>
          ${canEdit && n.is_active ? `
            <button class="btn-icon btn-ghost" onclick="showEditNormModal(${n.id}, ${n.monthly_norm_hours})" title="Изменить">✎</button>
            <button class="btn-icon btn-ghost danger" onclick="deleteNorm(${n.id})" title="Отключить">✕</button>
          ` : ''}
        </td>
      </tr>`).join('');
    return `
      <div class="panel" style="margin-bottom:12px">
        <div class="panel-head"><h4>${MONTH_RU[parseInt(m)]} ${y}</h4></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Ставка</th><th>Норма</th><th>Дней</th><th>Статус</th><th></th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="5" class="empty-line">Нет норм</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }).join('') || '<div class="empty-line">Нормы не добавлены</div>';

  const addForm = canEdit ? `
    <div class="panel" style="margin-top:16px">
      <div class="panel-head"><h4>Добавить норму</h4></div>
      <div class="ops-filters-row" style="flex-wrap:wrap;gap:10px;padding:12px 0 0">
        <div class="form-group" style="margin:0">
          <label class="form-label">Год</label>
          <input id="norm-year" class="form-input" type="number" value="${new Date().getFullYear()}" style="width:100px">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Месяц</label>
          <select id="norm-month" class="form-select" style="width:130px">
            ${Array.from({length:12},(_,i)=>`<option value="${i+1}">${MONTH_RU[i+1]}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Ставка</label>
          <select id="norm-rate" class="form-select" style="width:130px">
            <option value="0.5">0.5</option>
            <option value="0.75">0.75</option>
            <option value="1.0">1.0</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Норма (часов)</label>
          <input id="norm-hours" class="form-input" type="number" step="0.5" placeholder="напр. 88" style="width:130px">
        </div>
        <div class="form-group" style="margin:0;align-self:flex-end">
          <button class="btn-primary btn-sm" onclick="submitAddNorm()" style="height:36px">Добавить</button>
        </div>
      </div>
      <div id="norm-add-err" class="acc-field-err" style="padding:4px 0 0"></div>
    </div>` : '';

  updateModal(`
    <div class="acc-modal" style="max-width:680px">
      <h3 class="acc-title">Нормы часов</h3>
      <p style="color:var(--tx2);font-size:13px;margin:0 0 16px">Нормы используются для расчёта % выполнения нормы вместо сырых часов.</p>
      <div style="max-height:420px;overflow-y:auto">${groupsHtml}</div>
      ${addForm}
    </div>
  `);
}

async function submitAddNorm() {
  const year = parseInt(document.getElementById('norm-year')?.value);
  const month = parseInt(document.getElementById('norm-month')?.value);
  const rate = parseFloat(document.getElementById('norm-rate')?.value);
  const hours = parseFloat(document.getElementById('norm-hours')?.value);
  const errEl = document.getElementById('norm-add-err');
  if (!hours || hours <= 0) { errEl.textContent = 'Укажите норму часов'; return; }
  try {
    await api._req('POST', '/api/work-norms', { year, month, rate, monthly_norm_hours: hours });
    showToast('Норма добавлена', 'ok');
    const norms = await api._req('GET', '/api/work-norms');
    renderWorkNormsModal(norms);
  } catch(e) { errEl.textContent = e.message; }
}

async function showEditNormModal(normId, currentHours) {
  const val = prompt('Новая норма часов:', currentHours);
  if (!val) return;
  const hours = parseFloat(val);
  if (!hours || hours <= 0) { showToast('Некорректное значение', 'error'); return; }
  try {
    await api._req('PATCH', `/api/work-norms/${normId}`, { monthly_norm_hours: hours });
    showToast('Норма обновлена', 'ok');
    const norms = await api._req('GET', '/api/work-norms');
    renderWorkNormsModal(norms);
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteNorm(normId) {
  if (!confirm('Отключить норму?')) return;
  try {
    await api._req('DELETE', `/api/work-norms/${normId}`);
    showToast('Норма отключена', 'ok');
    const norms = await api._req('GET', '/api/work-norms');
    renderWorkNormsModal(norms);
  } catch(e) { showToast(e.message, 'error'); }
}

function updateModal(html) {
  // Обновляем содержимое открытого модального окна
  const overlay = document.getElementById('modal-overlay');
  const modal = overlay?.querySelector('.modal');
  if (modal) {
    modal.innerHTML = html + '<button class="modal-close" onclick="closeModal()">✕</button>';
  } else {
    showModal(html);
  }
}

async function showAddOperatorModal() {
  let groups = [];
  let groupsError = '';
  try {
    groups = await swrFetch('groups:active', () => api.listGroups(true), null, SWR_STATIC_TTL_MS);
  } catch(e) {
    groupsError = 'Не удалось загрузить список групп';
  }

  const groupOptions = groups.length
    ? groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')
    : '';

  const groupField = groupsError
    ? `<div class="status-line status-error" style="padding:8px">${esc(groupsError)}</div>`
    : groups.length
      ? `<select id="new-op-group-id" class="form-select">
          <option value="">Выберите группу…</option>
          ${groupOptions}
        </select>`
      : `<div class="status-line" style="padding:8px;color:var(--tx3)">
          Группы не найдены. Создайте группу в разделе «Группы».
         </div>`;
  const canCreateRoles = STATE.user?.role === 'admin'
    ? ['operator','supervisor','manager','admin']
    : ['operator','supervisor'];
  const roleHint = {
    operator: 'Оператор — обычный пользователь системы',
    supervisor: 'Супервайзер — управление операторами своей группы',
    manager: 'Менеджер — управление операторами и супервайзерами',
    admin: 'Администратор — полный доступ',
  };

  showModal(`
    <h3 class="modal-title">Новый пользователь</h3>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">ФИО <span style="color:var(--danger)">*</span></label>
        <input id="new-op-name" class="form-input" placeholder="Иванов Иван Иванович">
      </div>
      <div class="form-group">
        <label class="form-label">Логин <span style="color:var(--danger)">*</span></label>
        <input id="new-user-login" class="form-input" placeholder="ivanov_a">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Email</label>
        <input id="new-op-email" class="form-input" type="email" placeholder="ivanov@company.com">
      </div>
      <div class="form-group">
        <label class="form-label">Телефон</label>
        <input id="new-user-phone" class="form-input" placeholder="+7...">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Роль <span style="color:var(--danger)">*</span></label>
        <select id="new-user-role" class="form-select">
          ${canCreateRoles.map(r => `<option value="${r}">${roleLabel(r)}</option>`).join('')}
        </select>
        <div id="new-role-hint" class="form-hint">${esc(roleHint[canCreateRoles[0]])}</div>
      </div>
      <div class="form-group" id="new-user-group-field">
        <label class="form-label">Группа <span id="new-group-required" style="color:var(--danger)">*</span></label>
        ${groupField}
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Пароль <span style="color:var(--danger)">*</span></label>
        <input id="new-user-password" class="form-input" type="password" placeholder="TempPassword123">
      </div>
      <div class="form-group">
        <label class="form-label">Повтор пароля <span style="color:var(--danger)">*</span></label>
        <input id="new-user-password-confirm" class="form-input" type="password" placeholder="TempPassword123">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group" id="new-user-rate-field" style="display:none">
        <label class="form-label">Ставка <span style="color:var(--danger)">*</span></label>
        <select id="new-user-rate" class="form-select">
          <option value="">— не указана —</option>
          <option value="0.5">0.5 ставки</option>
          <option value="0.75">0.75 ставки</option>
          <option value="1.0">1.0 ставка</option>
        </select>
        <div class="form-hint">Используется для расчёта выполнения нормы часов</div>
      </div>
      <div class="form-group">
        <label class="form-label">Статус</label>
        <select id="new-user-status" class="form-select">
          <option value="active" selected>Активен</option>
          <option value="inactive">Неактивен</option>
          <option value="blocked">Заблокирован</option>
        </select>
      </div>
    </div>
    <div id="new-op-err" class="status-line"></div>
    <button id="create-operator-btn" class="btn-primary create-user-submit" onclick="submitAddOperator()" disabled>Создать пользователя</button>
    <div style="font-size:11px;color:var(--tx3);margin-top:6px">Пароль сохранится только в виде hash, при первом входе пользователь сменит его.</div>
  `, { className: 'modal-user-create' });

  const updateButton = () => {
    const btn = document.getElementById('create-operator-btn');
    const name = document.getElementById('new-op-name')?.value?.trim();
    const login = document.getElementById('new-user-login')?.value?.trim();
    const groupId = document.getElementById('new-op-group-id')?.value;
    const role = document.getElementById('new-user-role')?.value || 'operator';
    const pwd = document.getElementById('new-user-password')?.value || '';
    const confirm = document.getElementById('new-user-password-confirm')?.value || '';
    const needsGroup = role === 'operator' || role === 'supervisor';
    const isOperator = role === 'operator';
    const field = document.getElementById('new-user-group-field');
    const required = document.getElementById('new-group-required');
    const rateField = document.getElementById('new-user-rate-field');
    if (field) field.style.display = needsGroup ? '' : 'none';
    if (required) required.style.display = needsGroup ? '' : 'none';
    if (rateField) rateField.style.display = isOperator ? '' : 'none';
    setText('new-role-hint', roleHint[role] || '');
    if (btn) btn.disabled = !(name && name.length >= 2 && login && pwd.length >= 8 && pwd === confirm && (!needsGroup || groupId));
  };
  ['new-op-name', 'new-user-login', 'new-op-group-id', 'new-user-role', 'new-user-password', 'new-user-password-confirm'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateButton);
    document.getElementById(id)?.addEventListener('change', updateButton);
  });
  updateButton();
}

async function submitAddOperator() {
  const name     = document.getElementById('new-op-name')?.value?.trim();
  const login    = document.getElementById('new-user-login')?.value?.trim();
  const groupId  = document.getElementById('new-op-group-id')?.value;
  const role     = document.getElementById('new-user-role')?.value || 'operator';
  const status   = document.getElementById('new-user-status')?.value || 'active';
  const email    = document.getElementById('new-op-email')?.value?.trim() || null;
  const phone    = document.getElementById('new-user-phone')?.value?.trim() || null;
  const password = document.getElementById('new-user-password')?.value || '';
  const confirm  = document.getElementById('new-user-password-confirm')?.value || '';
  const rateVal  = document.getElementById('new-user-rate')?.value || '';
  const rate     = rateVal ? parseFloat(rateVal) : null;
  const err      = document.getElementById('new-op-err');
  const btn      = document.getElementById('create-operator-btn');

  const setErr = msg => { err.textContent = msg; err.className = 'status-line status-error'; };

  if (!name || name.length < 2) return setErr('Укажите ФИО пользователя');
  if (!login) return setErr('Укажите логин');
  if ((role === 'operator' || role === 'supervisor') && !groupId) return setErr('Выберите группу');
  if (password.length < 8) return setErr('Пароль должен быть минимум 8 символов');
  if (!/[A-Za-zА-Яа-я]/.test(password) || !/\d/.test(password)) return setErr('Пароль должен содержать буквы и цифры');
  if (password !== confirm) return setErr('Пароли не совпадают');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setErr('Введите корректный email');

  err.textContent = 'Создаём…'; err.className = 'status-line';
  if (btn) btn.disabled = true;

  try {
    const result = await api.createUser({
      full_name: name,
      login,
      email: email || null,
      phone: phone || null,
      role,
      group_id: groupId ? +groupId : null,
      password,
      confirm_password: confirm,
      status,
    });

    // Сохраняем ставку если указана и это оператор
    if (role === 'operator' && rate && result.operator_id) {
      try {
        await api._req('PATCH', `/api/work-norms/operators/${result.operator_id}/rate`, { rate });
      } catch(e) {
        console.warn('Не удалось сохранить ставку:', e.message);
      }
    }

    const credentialText = `Пользователь: ${result.full_name}\nРоль: ${roleLabel(result.role)}\nЛогин: ${result.login || result.username}\nВременный пароль: ${password}`;

    showModal(
      '<h3 class="modal-title" style="color:var(--ok)">Пользователь создан</h3>' +
      '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-md);padding:16px;display:grid;gap:8px;font-size:14px">' +
        '<div><span style="color:var(--tx3)">ФИО:</span> <b>' + esc(result.full_name) + '</b></div>' +
        '<div><span style="color:var(--tx3)">Роль:</span> <b>' + esc(roleLabel(result.role)) + '</b></div>' +
        '<div><span style="color:var(--tx3)">Группа:</span> <b>' + esc(result.group_name || '—') + '</b></div>' +
        '<div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px">' +
          '<span style="color:var(--tx3)">Логин:</span> <b style="font-family:monospace;color:var(--accent)">' + esc(result.login || result.username) + '</b>' +
        '</div>' +
        '<div><span style="color:var(--tx3)">Временный пароль:</span> <b style="font-family:monospace;color:var(--accent)">' + esc(password) + '</b></div>' +
      '</div>' +
      '<button id="copy-created-credentials" class="btn-outline" style="width:100%">Скопировать данные для входа</button>' +
      '<button class="btn-primary" style="width:100%" onclick="closeModal()">Готово</button>'
    );
    document.getElementById('copy-created-credentials')?.addEventListener('click', () => {
      navigator.clipboard.writeText(credentialText).then(() => showToast('Скопировано!', 'ok'));
    });
    swrInvalidate('users:list');
    await reloadData();
  } catch(e) {
    setErr(e.message);
    if (btn) btn.disabled = false;
  }
}

async function deactivateUserUi(userId) {
  const user = STATE.users.find(u => u.id === userId);
  if (!confirm(`Деактивировать пользователя ${user?.full_name || ''}?`)) return;
  try {
    await api.deactivateUser(userId);
    showToast('Пользователь деактивирован', 'ok');
    swrInvalidate('users:list');
    await reloadData();
  } catch(e) { showToast(e.message, 'error'); }
}

function userManagementInitials(fullName) {
  return String(fullName || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase();
}

function setUserManagementTab(tab) {
  document.querySelectorAll('.user-manage-tab').forEach(button => {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  });
  document.querySelectorAll('.user-manage-panel').forEach(panel => {
    panel.hidden = panel.dataset.panel !== tab;
  });
}

async function showUserManagementModal(userId) {
  const user = STATE.users.find(item => item.id === userId);
  if (!user) return showToast('Пользователь не найден', 'error');

  showModal('<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка карточки пользователя…</p></div>', {
    className: 'modal-user-manage',
  });

  let groups = STATE.groups || [];
  try {
    if (!groups.length) groups = await ensureGroupsLoaded();
  } catch(e) {
    groups = [];
  }

  const isOperator = user.role === 'operator' && user.operator_id;
  const groupOptions = groups.map(group => `
    <option value="${group.id}" ${Number(user.group_id) === Number(group.id) ? 'selected' : ''}>
      ${esc(group.name)}${group.status !== 'active' ? ' (отключена)' : ''}
    </option>`).join('');
  const levelName = user.level?.name || 'Не назначен';
  const startDate = user.start_date || '';
  const statusOptions = [
    ['active', 'Активен'],
    ['inactive', 'Неактивен'],
    ['blocked', 'Заблокирован'],
    ['dismissed', 'Уволен'],
  ].map(([value, label]) => `<option value="${value}" ${user.status === value ? 'selected' : ''}>${label}</option>`).join('');

  showModal(`
    <div class="user-manage-header">
      <span class="user-manage-avatar">${esc(userManagementInitials(user.full_name))}</span>
      <div>
        <div class="section-kicker">Карточка сотрудника</div>
        <h3 class="modal-title">${esc(user.full_name)}</h3>
        <p>${roleLabel(user.role)}${user.group_name ? ` · ${esc(user.group_name)}` : ''}</p>
      </div>
      ${userStatusBadge(user.status)}
    </div>

    <div class="user-manage-tabs" role="tablist" aria-label="Разделы карточки">
      <button class="user-manage-tab is-active" data-tab="main" onclick="setUserManagementTab('main')">Основное</button>
      <button class="user-manage-tab" data-tab="work" onclick="setUserManagementTab('work')">Работа</button>
      <button class="user-manage-tab" data-tab="access" onclick="setUserManagementTab('access')">Доступ</button>
    </div>

    <div class="user-manage-body">
      <div class="user-manage-form">
        <section class="user-manage-panel" data-panel="main">
          <div class="user-manage-section-head"><h4>Личные данные</h4><p>Информация, которая отображается в Puls.</p></div>
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">ФИО</label>
              <input id="manage-user-name" class="form-input" value="${esc(user.full_name)}">
            </div>
            <div class="form-group">
              <label class="form-label">Роль</label>
              <div class="user-manage-readonly">${roleBadge(user.role)}</div>
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input id="manage-user-email" class="form-input" type="email" value="${esc(user.email || '')}" placeholder="user@company.com">
            </div>
            <div class="form-group">
              <label class="form-label">Телефон</label>
              <input id="manage-user-phone" class="form-input" value="${esc(user.phone || '')}" placeholder="+7...">
            </div>
          </div>
        </section>

        <section class="user-manage-panel" data-panel="work" hidden>
          <div class="user-manage-section-head"><h4>Рабочие параметры</h4><p>Группа, статус и параметры расчёта сотрудника.</p></div>
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Группа</label>
              <select id="manage-user-group" class="form-select">
                <option value="">Без группы</option>
                ${groupOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Статус аккаунта</label>
              <select id="manage-user-status" class="form-select">${statusOptions}</select>
            </div>
            ${isOperator ? `
              <div class="form-group">
                <label class="form-label">Должность</label>
                <select id="manage-user-position" class="form-select">
                  <option value="operator" ${(user.position || 'operator') === 'operator' ? 'selected' : ''}>Оператор</option>
                  <option value="chat_manager" ${user.position === 'chat_manager' ? 'selected' : ''}>Чат-менеджер</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Участие в рейтинге</label>
                <select id="manage-user-participation" class="form-select">
                  <option value="participating" ${user.participation_status !== 'not_participating' ? 'selected' : ''}>Участвует</option>
                  <option value="not_participating" ${user.participation_status === 'not_participating' ? 'selected' : ''}>Не участвует</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Ставка</label>
                <select id="manage-user-rate" class="form-select">
                  <option value="">Не указана</option>
                  <option value="0.5" ${Number(user.rate) === 0.5 ? 'selected' : ''}>0.5 ставки</option>
                  <option value="0.75" ${Number(user.rate) === 0.75 ? 'selected' : ''}>0.75 ставки</option>
                  <option value="1" ${Number(user.rate) === 1 ? 'selected' : ''}>1.0 ставка</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Дата начала работы</label>
                <input id="manage-user-start-date" class="form-input" type="date" value="${esc(startDate)}">
              </div>` : ''}
          </div>
          ${isOperator ? `<div class="user-manage-level-row">
            <div><span>Текущий уровень</span><strong>${esc(levelName)}</strong></div>
            <button class="btn-outline btn-sm" type="button" onclick="manualOperatorLevelUi(${user.operator_id})">Изменить уровень</button>
          </div>` : ''}
        </section>

        <section class="user-manage-panel" data-panel="access" hidden>
          <div class="user-manage-section-head"><h4>Доступ к системе</h4><p>Логин и служебные действия с аккаунтом.</p></div>
          <div class="form-group">
            <label class="form-label">Логин</label>
            <input id="manage-user-login" class="form-input" value="${esc(user.login || user.username || '')}">
          </div>
          <div class="user-manage-service-actions">
            <button class="btn-outline" type="button" onclick="showUserResetPasswordModal(${user.id})">Сбросить пароль</button>
            ${isOperator ? `<button class="btn-outline" type="button" onclick="showOperatorHistoryModal(${user.operator_id})">История изменений</button>` : ''}
          </div>
          ${user.status === 'active' ? `<div class="user-manage-danger-zone">
            <div><strong>Отключение аккаунта</strong><span>Пользователь потеряет доступ до повторной активации.</span></div>
            <button class="btn-outline" type="button" onclick="closeModal();deactivateUserUi(${user.id})">Деактивировать</button>
          </div>` : ''}
        </section>
      </div>
    </div>

    <div id="manage-user-error" class="status-line"></div>
    <div class="user-manage-footer">
      <button class="btn-outline" type="button" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" id="manage-user-save" type="button" onclick="submitUserManagement(${user.id})">Сохранить изменения</button>
    </div>
  `, { className: 'modal-user-manage' });
}

async function submitUserManagement(userId) {
  const user = STATE.users.find(item => item.id === userId);
  const error = document.getElementById('manage-user-error');
  const button = document.getElementById('manage-user-save');
  if (!user || !error || !button) return;

  const fullName = document.getElementById('manage-user-name')?.value?.trim() || '';
  const login = document.getElementById('manage-user-login')?.value?.trim() || '';
  const email = document.getElementById('manage-user-email')?.value?.trim() || null;
  const phone = document.getElementById('manage-user-phone')?.value?.trim() || null;
  const groupValue = document.getElementById('manage-user-group')?.value || '';
  const status = document.getElementById('manage-user-status')?.value || user.status;
  if (fullName.length < 2) {
    error.textContent = 'Укажите корректное ФИО';
    error.className = 'status-line status-error';
    setUserManagementTab('main');
    return;
  }
  if (!login) {
    error.textContent = 'Логин не может быть пустым';
    error.className = 'status-line status-error';
    setUserManagementTab('access');
    return;
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    error.textContent = 'Введите корректный email';
    error.className = 'status-line status-error';
    setUserManagementTab('main');
    return;
  }
  if (user.role === 'operator' && user.operator_id && !groupValue) {
    error.textContent = 'Выберите рабочую группу оператора';
    error.className = 'status-line status-error';
    setUserManagementTab('work');
    return;
  }

  const payload = {
    full_name: fullName,
    login,
    email,
    phone,
    group_id: groupValue ? Number(groupValue) : null,
    status,
  };
  if (user.role === 'operator' && user.operator_id) {
    const rateValue = document.getElementById('manage-user-rate')?.value || '';
    payload.position = document.getElementById('manage-user-position')?.value || 'operator';
    payload.participation_status = document.getElementById('manage-user-participation')?.value || 'participating';
    payload.start_date = document.getElementById('manage-user-start-date')?.value || null;
    payload.rate = rateValue ? Number(rateValue) : null;
  }

  button.disabled = true;
  button.textContent = 'Сохраняем…';
  error.textContent = '';
  try {
    const updated = await api.updateUser(userId, payload);
    STATE.users = STATE.users.map(item => item.id === userId ? updated : item);
    swrInvalidate('users:list');
    swrInvalidate('dashboard:operators');
    closeModal();
    renderAdminOperators();
    showToast('Данные пользователя обновлены', 'ok');
  } catch(e) {
    error.textContent = e.message;
    error.className = 'status-line status-error';
    button.disabled = false;
    button.textContent = 'Сохранить изменения';
  }
}

function showUserResetPasswordModal(userId) {
  const user = STATE.users.find(u => u.id === userId);
  showModal(`
    <h3 class="modal-title">Сбросить пароль</h3>
    <div class="status-line" style="padding:0;color:var(--tx2)">Пользователь: <b>${esc(user?.full_name || '')}</b></div>
    <div class="form-group">
      <label class="form-label">Новый временный пароль</label>
      <input id="reset-user-password" class="form-input" type="password" placeholder="TempPassword123">
    </div>
    <div id="reset-user-password-error" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:8px" onclick="submitUserResetPassword(${userId})">Сохранить</button>
  `);
}

async function submitUserResetPassword(userId) {
  const password = document.getElementById('reset-user-password')?.value || '';
  const err = document.getElementById('reset-user-password-error');
  if (password.length < 8 || !/[A-Za-zА-Яа-я]/.test(password) || !/\d/.test(password)) {
    if (err) { err.textContent = 'Пароль должен быть минимум 8 символов и содержать буквы и цифры'; err.className = 'status-line status-error'; }
    return;
  }
  try {
    await api.resetUserPassword(userId, { new_password: password, must_change_password: true });
    closeModal();
    showToast('Пароль сброшен', 'ok');
  } catch(e) {
    if (err) { err.textContent = e.message; err.className = 'status-line status-error'; }
  }
}

function copyCredentials(name, login, password) {
  const text = `Оператор: ${name}\nЛогин: ${login}\nВременный пароль: ${password}`;
  navigator.clipboard.writeText(text).then(() => showToast('Скопировано!', 'ok'));
}

function participationStatusLabel(s) {
  return { participating: 'Участвует', not_participating: 'Не участвует' }[s] || s || '';
}

function isOperatorDismissed(o) {
  return (o?.employment_status || (o?.status === 'dismissed' ? 'dismissed' : 'active')) === 'dismissed';
}

function operatorStatusBadge(o) {
  if (isOperatorDismissed(o)) {
    return '<span class="status-badge status-archive">Уволен</span>';
  }
  const participates = (o?.participation_status || 'participating') === 'participating';
  return `<span class="status-badge ${participates ? 'status-active' : 'status-inactive'}">${participationStatusLabel(o?.participation_status || 'participating')}</span>`;
}

function positionLabel(s) {
  return { operator: 'Оператор', chat_manager: 'Чат-менеджер' }[s] || s || '';
}

function showAddItemModal() {
  const levelOptions = (STATE.operatorLevels || [])
    .filter(l => l.is_active)
    .map(l => `<option value="${l.id}">${esc(l.name)}</option>`)
    .join('');
  showModal(`
    <h3 class="modal-title">Добавить бонус в магазин</h3>
    <div class="form-group"><label class="form-label">Название</label>
      <input id="ni-title" class="form-input" placeholder="Сертификат на кофе"></div>
    <div class="form-group"><label class="form-label">Описание</label>
      <input id="ni-desc" class="form-input" placeholder="Подарочная карта в кофейню"></div>
    <div class="form-group"><label class="form-label">Категория</label>
      <select id="ni-category" class="form-select">
        <option value="quick">Быстрые бонусы</option>
        <option value="workday">Комфорт на смене</option>
        <option value="recognition">Признание</option>
        <option value="gifts">Подарки</option>
        <option value="other">Другие</option>
      </select></div>
    <div class="form-group"><label class="form-label">Цена (коины)</label>
      <input id="ni-price" class="form-input" type="number" min="1" placeholder="120"></div>
    <div class="form-group"><label class="form-label">Минимальный уровень</label>
      <select id="ni-min-level" class="form-select">
        <option value="">Без ограничения</option>
        ${levelOptions}
      </select></div>
    <div class="coin-rules-section-title" style="margin-top:14px">Сезонность и лимиты <span class="cell-muted" style="font-weight:400;text-transform:none">(необязательно)</span></div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Доступен с</label>
        <input id="ni-starts" class="form-input" type="datetime-local"></div>
      <div class="form-group"><label class="form-label">Доступен до</label>
        <input id="ni-ends" class="form-input" type="datetime-local"></div>
      <div class="form-group"><label class="form-label">Лимит остатка <span class="hint">(0 = без лимита)</span></label>
        <input id="ni-stock" class="form-input" type="number" min="0" value="0"></div>
      <div class="form-group"><label class="form-label">Лимит на оператора <span class="hint">(0 = без лимита)</span></label>
        <input id="ni-oplimit" class="form-input" type="number" min="0" value="0"></div>
    </div>
    <div id="ni-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitAddItem()">Добавить</button>`);
}
async function submitAddItem() {
  const title = document.getElementById('ni-title')?.value?.trim();
  const desc  = document.getElementById('ni-desc')?.value?.trim() || '';
  const category = document.getElementById('ni-category')?.value || 'other';
  const price = +document.getElementById('ni-price')?.value;
  const minLevelRaw = document.getElementById('ni-min-level')?.value || '';
  const min_level_id = minLevelRaw ? Number(minLevelRaw) : null;
  const starts_at = document.getElementById('ni-starts')?.value || null;
  const ends_at = document.getElementById('ni-ends')?.value || null;
  const stock_limit = +(document.getElementById('ni-stock')?.value || 0);
  const purchase_limit_per_operator = +(document.getElementById('ni-oplimit')?.value || 0);
  const err   = document.getElementById('ni-err');
  if (!title || !price) { err.textContent = 'Заполните название и цену'; return; }
  try {
    await api.createShopItem({ title, description: desc, category, price, min_level_id, starts_at, ends_at, stock_limit, purchase_limit_per_operator });
    closeModal(); showToast('Бонус добавлен', 'ok');
    STATE.shopItems = await api.listShopItems(); renderShop();
  } catch(e) { err.textContent = e.message; }
}

function showEditItemModal(item) {
  const levelOptions = (STATE.operatorLevels || [])
    .filter(l => l.is_active)
    .map(l => `<option value="${l.id}" ${item.min_level_id === l.id ? 'selected' : ''}>${esc(l.name)}</option>`)
    .join('');
  const toLocalInput = (iso) => iso ? String(iso).slice(0, 16) : '';
  showModal(`
    <h3 class="modal-title">Редактировать бонус</h3>
    <div class="form-group"><label class="form-label">Название</label>
      <input id="ei-title" class="form-input" value="${esc(item.title)}"></div>
    <div class="form-group"><label class="form-label">Описание</label>
      <input id="ei-desc" class="form-input" value="${esc(item.description)}"></div>
    <div class="form-group"><label class="form-label">Категория</label>
      <select id="ei-category" class="form-select">
        <option value="quick" ${item.category === 'quick' ? 'selected' : ''}>Быстрые бонусы</option>
        <option value="workday" ${item.category === 'workday' ? 'selected' : ''}>Комфорт на смене</option>
        <option value="recognition" ${item.category === 'recognition' ? 'selected' : ''}>Признание</option>
        <option value="gifts" ${item.category === 'gifts' ? 'selected' : ''}>Подарки</option>
        <option value="other" ${!item.category || item.category === 'other' ? 'selected' : ''}>Другие</option>
      </select></div>
    <div class="form-group"><label class="form-label">Цена (коины)</label>
      <input id="ei-price" class="form-input" type="number" value="${item.price}"></div>
    <div class="form-group"><label class="form-label">Минимальный уровень</label>
      <select id="ei-min-level" class="form-select">
        <option value="" ${!item.min_level_id ? 'selected' : ''}>Без ограничения</option>
        ${levelOptions}
      </select></div>
    <div class="form-group"><label class="form-label">Статус</label>
      <select id="ei-active" class="form-select">
        <option value="true" ${item.is_active?'selected':''}>Активен</option>
        <option value="false" ${!item.is_active?'selected':''}>Отключён</option>
      </select></div>
    <div class="coin-rules-section-title" style="margin-top:14px">Сезонность и лимиты <span class="cell-muted" style="font-weight:400;text-transform:none">(необязательно)</span></div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Доступен с</label>
        <input id="ei-starts" class="form-input" type="datetime-local" value="${toLocalInput(item.starts_at)}"></div>
      <div class="form-group"><label class="form-label">Доступен до</label>
        <input id="ei-ends" class="form-input" type="datetime-local" value="${toLocalInput(item.ends_at)}"></div>
      <div class="form-group"><label class="form-label">Лимит остатка <span class="hint">(0 = без лимита)</span></label>
        <input id="ei-stock" class="form-input" type="number" min="0" value="${item.stock_limit ?? 0}"></div>
      <div class="form-group"><label class="form-label">Лимит на оператора <span class="hint">(0 = без лимита)</span></label>
        <input id="ei-oplimit" class="form-input" type="number" min="0" value="${item.purchase_limit_per_operator ?? 0}"></div>
    </div>
    ${item.stock_remaining != null ? `<div class="status-line">Сейчас остаток: ${item.stock_remaining}</div>` : ''}
    <div id="ei-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitEditItem(${item.id})">Сохранить</button>`);
}
async function submitEditItem(id) {
  const title     = document.getElementById('ei-title')?.value?.trim();
  const description = document.getElementById('ei-desc')?.value?.trim() || '';
  const category  = document.getElementById('ei-category')?.value || 'other';
  const price     = +document.getElementById('ei-price')?.value;
  const minLevelRaw = document.getElementById('ei-min-level')?.value || '';
  const min_level_id = minLevelRaw ? Number(minLevelRaw) : null;
  const is_active = document.getElementById('ei-active')?.value === 'true';
  const starts_at = document.getElementById('ei-starts')?.value || null;
  const ends_at = document.getElementById('ei-ends')?.value || null;
  const stock_limit = +(document.getElementById('ei-stock')?.value || 0);
  const purchase_limit_per_operator = +(document.getElementById('ei-oplimit')?.value || 0);
  const err       = document.getElementById('ei-err');
  if (!title || !price) { err.textContent = 'Заполните поля'; return; }
  try {
    await api.updateShopItem(id, { title, description, category, price, min_level_id, is_active, starts_at, ends_at, stock_limit, purchase_limit_per_operator });
    closeModal(); showToast('Бонус обновлён', 'ok');
    STATE.shopItems = await api.listShopItems(); renderShop();
  } catch(e) { err.textContent = e.message; }
}

/* ══════════════════════════════════════
   EXPORT
══════════════════════════════════════ */
function exportCSV() {
  window.open(api.exportUrl('/api/exports/operators', { format: 'csv' }), '_blank');
}
function exportOperatorsXLSX() {
  window.open(api.exportUrl('/api/exports/operators', { format: 'xlsx' }), '_blank');
}

function exportHistoryCSV() {
  const header = ['Дата','Оператор','Группа','Тип','Коины','Причина','Автор'];
  const rows = STATE.history.map(t => [
    fmtDate(t.created_at), t.operator_name, t.group_name, t.type,
    t.amount, t.comment, t.created_by_name||'Система',
  ]);
  downloadCSV([header, ...rows], 'pulse_history');
}

function downloadCSV(rows, name) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

/* ══════════════════════════════════════
   TOAST
══════════════════════════════════════ */
function showToast(msg, type = 'ok') {
  let c = document.getElementById('toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.classList.add('toast-show'), 10);
  setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, 3500);
}

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
function esc(s) {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function fmtDate(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function fmtDateTime(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function roleLabel(r) {
  return { operator:'Оператор', supervisor:'Супервайзер', manager:'Руководитель', admin:'Администратор' }[r] || r || '';
}
function statusLabel(s) {
  return { pending:'Новая', new:'Новая', approved:'Одобрена', rejected:'Отклонена', completed:'Выполнена', cancelled:'Отменена' }[s] || s;
}
function isAdmin(role) { return ['supervisor','manager','admin'].includes(role); }
function canManageGroups(role = STATE.user?.role) { return ['manager','admin'].includes(role); }
function canManageOperators() {
  const role = STATE.user?.role;
  return ['manager','admin'].includes(role) || (role === 'supervisor' && STATE.user?.can_manage_operators);
}

/* ══════════════════════════════════════
   WINDOW EXPORTS
══════════════════════════════════════ */

/* ══════════════════════════════════════
   ACCOUNT SETTINGS MODAL
══════════════════════════════════════ */
function showForcedPasswordChangeModal() {
  showModal(`
    <div class="acc-modal">
      <h3 class="acc-title">Смените временный пароль</h3>
      <div class="status-line" style="padding:0;color:var(--tx2)">
        Для продолжения работы в Puls нужно заменить временный пароль.
      </div>
      <div class="acc-divider"></div>
      <div class="acc-section">
        <div class="form-group">
          <label class="form-label">Текущий временный пароль</label>
          <input id="forced-cur-pwd" class="form-input" type="password" autocomplete="current-password">
        </div>
        <div class="form-group">
          <label class="form-label">Новый пароль</label>
          <input id="forced-new-pwd" class="form-input" type="password" placeholder="Минимум 8 символов" autocomplete="new-password">
        </div>
        <div class="form-group">
          <label class="form-label">Повторите новый пароль</label>
          <input id="forced-confirm-pwd" class="form-input" type="password" autocomplete="new-password">
          <div id="forced-pwd-err" class="acc-field-err"></div>
        </div>
        <button class="acc-btn" id="forced-save-pwd-btn" onclick="submitForcedPasswordChange()">Сохранить пароль</button>
        <button class="btn-outline" style="width:100%;margin-top:10px" onclick="logoutAndReload()">Выйти</button>
      </div>
    </div>
  `, { force: true });
}

async function submitForcedPasswordChange() {
  const curPwd  = document.getElementById('forced-cur-pwd')?.value;
  const newPwd  = document.getElementById('forced-new-pwd')?.value;
  const confPwd = document.getElementById('forced-confirm-pwd')?.value;
  const errEl   = document.getElementById('forced-pwd-err');
  const btn     = document.getElementById('forced-save-pwd-btn');

  errEl.textContent = '';
  if (!curPwd) return errEl.textContent = 'Введите текущий пароль';
  if (!newPwd || newPwd.length < 8) return errEl.textContent = 'Пароль минимум 8 символов';
  if (newPwd !== confPwd) return errEl.textContent = 'Пароли не совпадают';

  btn.disabled = true; btn.textContent = 'Сохраняем…';
  try {
    const data = await api.changeMyPassword({ current_password: curPwd, new_password: newPwd, confirm_password: confPwd });
    showToast('Пароль изменён. Войдите снова.', 'ok');
    closeModal(true);
    setTimeout(logoutAndReload, 900);
  } catch(e) {
    errEl.textContent = e.message;
    btn.disabled = false; btn.textContent = 'Сохранить пароль';
  }
}

async function logoutAndReload() {
  try { await api.logout(); } catch(e) { /* игнорируем ошибку — удаляем куку на клиенте */ }
  // Запасное удаление куки на клиенте (на случай если сервер вернул 403)
  document.cookie.split(';').forEach(c => {
    const name = c.trim().split('=')[0];
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
  });
  // Очищаем sessionStorage (SWR-кеш)
  sessionStorage.clear();
  STATE.user = null;
  location.reload();
}

function showAccountSettingsModal() {
  const u = STATE.user;
  if (!u) return;
  const roleLabel = { operator:'Оператор', supervisor:'Супервайзер', manager:'Руководитель', admin:'Администратор' }[u.role] || u.role;

  showModal(`
    <div class="acc-modal">
      <h3 class="acc-title">Настройки аккаунта</h3>

      <div class="acc-info">
        <div class="acc-avatar">${esc((u.full_name||'?')[0].toUpperCase())}</div>
        <div>
          <div class="acc-name">${esc(u.full_name || '—')}</div>
          <div class="acc-role">${esc(roleLabel)}</div>
          <div class="acc-login">Логин: <b>${esc(u.username || '—')}</b></div>
        </div>
      </div>

      <div class="acc-divider"></div>

      <!-- Изменение логина -->
      <div class="acc-section">
        <div class="acc-section-title">Изменить логин</div>
        <div class="form-group">
          <label class="form-label">Новый логин</label>
          <input id="acc-new-login" class="form-input" type="text"
            placeholder="Только буквы, цифры, точка, _"
            value="${esc(u.username || '')}">
          <div id="acc-login-hint" class="acc-field-hint"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Текущий пароль</label>
          <input id="acc-login-pwd" class="form-input" type="password" placeholder="Подтвердите текущий пароль">
          <div id="acc-login-err" class="acc-field-err"></div>
        </div>
        <button class="acc-btn" id="acc-save-login-btn" onclick="submitChangeLogin()">Сохранить логин</button>
      </div>

      <div class="acc-divider"></div>

      <!-- Изменение пароля -->
      <div class="acc-section">
        <div class="acc-section-title">Изменить пароль</div>
        <div class="form-group">
          <label class="form-label">Текущий пароль</label>
          <input id="acc-cur-pwd" class="form-input" type="password" placeholder="Текущий пароль">
        </div>
        <div class="form-group">
          <label class="form-label">Новый пароль</label>
          <input id="acc-new-pwd" class="form-input" type="password" placeholder="Минимум 8 символов">
          <div id="acc-pwd-hint" class="acc-field-hint"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Повторите новый пароль</label>
          <input id="acc-confirm-pwd" class="form-input" type="password" placeholder="Повторите пароль">
          <div id="acc-pwd-err" class="acc-field-err"></div>
        </div>
        <button class="acc-btn" id="acc-save-pwd-btn" onclick="submitChangePassword()">Сохранить пароль</button>
      </div>
    </div>
  `);

  // Live validation for login
  document.getElementById('acc-new-login')?.addEventListener('input', function() {
    const v = this.value;
    const hint = document.getElementById('acc-login-hint');
    if (!v) { hint.textContent = ''; return; }
    if (!/^[a-zA-Z0-9._]+$/.test(v)) {
      hint.textContent = 'Только буквы, цифры, точка и _';
      hint.className = 'acc-field-err';
    } else if (v.length < 3) {
      hint.textContent = 'Минимум 3 символа';
      hint.className = 'acc-field-err';
    } else {
      hint.textContent = 'Выглядит хорошо';
      hint.className = 'acc-field-hint ok';
    }
  });

  // Live validation for password
  document.getElementById('acc-new-pwd')?.addEventListener('input', function() {
    const v = this.value;
    const hint = document.getElementById('acc-pwd-hint');
    if (!v) { hint.textContent = ''; return; }
    if (v.length < 8) {
      hint.textContent = 'Минимум 8 символов';
      hint.className = 'acc-field-err';
    } else {
      hint.textContent = 'Подходит';
      hint.className = 'acc-field-hint ok';
    }
  });
}

async function submitChangeLogin() {
  const newLogin = document.getElementById('acc-new-login')?.value?.trim();
  const curPwd   = document.getElementById('acc-login-pwd')?.value;
  const errEl    = document.getElementById('acc-login-err');
  const btn      = document.getElementById('acc-save-login-btn');

  errEl.textContent = '';
  if (!newLogin)  return errEl.textContent = 'Введите новый логин';
  if (newLogin.length < 3) return errEl.textContent = 'Логин слишком короткий';
  if (!/^[a-zA-Z0-9._]+$/.test(newLogin)) return errEl.textContent = 'Недопустимые символы в логине';
  if (!curPwd)   return errEl.textContent = 'Введите текущий пароль';

  btn.disabled = true; btn.textContent = 'Сохраняем…';
  try {
    const data = await api.changeMyLogin({ new_login: newLogin, current_password: curPwd });
    STATE.user.username = newLogin;
    errEl.textContent = '✓ Логин изменён';
    errEl.className = 'acc-field-hint ok';
    document.getElementById('acc-login-pwd').value = '';
    showToast('Логин успешно изменён', 'ok');
  } catch(e) {
    errEl.textContent = e.message;
    errEl.className = 'acc-field-err';
  } finally {
    btn.disabled = false; btn.textContent = 'Сохранить логин';
  }
}

async function submitChangePassword() {
  const curPwd  = document.getElementById('acc-cur-pwd')?.value;
  const newPwd  = document.getElementById('acc-new-pwd')?.value;
  const confPwd = document.getElementById('acc-confirm-pwd')?.value;
  const errEl   = document.getElementById('acc-pwd-err');
  const btn     = document.getElementById('acc-save-pwd-btn');

  errEl.textContent = '';
  if (!curPwd)  return errEl.textContent = 'Введите текущий пароль';
  if (!newPwd || newPwd.length < 8) return errEl.textContent = 'Пароль минимум 8 символов';
  if (newPwd !== confPwd) return errEl.textContent = 'Пароли не совпадают';

  btn.disabled = true; btn.textContent = 'Сохраняем…';
  try {
    const data = await api.changeMyPassword({ current_password: curPwd, new_password: newPwd, confirm_password: confPwd });
    showToast('Пароль изменён. Выполняется выход…', 'ok');
    closeModal();
    setTimeout(async () => {
      await api.logout().catch(() => {});
      STATE.user = null;
      location.reload();
    }, 1500);
  } catch(e) {
    errEl.textContent = e.message;
    errEl.className = 'acc-field-err';
    btn.disabled = false; btn.textContent = 'Сохранить пароль';
  }
}

window.showAccountSettingsModal = showAccountSettingsModal;
window.submitChangeLogin        = submitChangeLogin;
window.submitChangePassword     = submitChangePassword;
window.showForcedPasswordChangeModal = showForcedPasswordChangeModal;
window.submitForcedPasswordChange = submitForcedPasswordChange;
window.logoutAndReload = logoutAndReload;

window.navigateTo = navigateTo;
window.reloadData = reloadData;
window.closeModal = closeModal;
window.submitAddOperator = submitAddOperator;
window.deactivateUserUi = deactivateUserUi;

window.setDynMode = function(mode) {
  // dynMode живёт внутри замыкания renderRating,
  // поэтому обновляем через глобальный колбэк
  if (window._setDynModeInternal) window._setDynModeInternal(mode);
};
window.showUserResetPasswordModal = showUserResetPasswordModal;
window.submitUserResetPassword = submitUserResetPassword;
window.showUserManagementModal = showUserManagementModal;
window.setUserManagementTab = setUserManagementTab;
window.submitUserManagement = submitUserManagement;
window.submitAddItem = submitAddItem;
window.submitEditItem = submitEditItem;
window.showAddOperatorModal = showAddOperatorModal;
window.showAddItemModal = showAddItemModal;
window.showEditItemModal = showEditItemModal;
window.exportCSV = exportCSV;
window.exportHistoryCSV = exportHistoryCSV;
window.reloadCabinet = reloadCabinet;
window.renderGroups = renderGroups;
window.showAddGroupModal = showAddGroupModal;
window.submitAddGroup = submitAddGroup;
window.showEditGroupModal = showEditGroupModal;
window.submitEditGroup = submitEditGroup;
window.toggleGroupStatus = toggleGroupStatus;
window.applyGroupStatus = applyGroupStatus;
window.confirmDeleteGroup = confirmDeleteGroup;
window.deleteGroup = deleteGroup;
window.showEditOperatorModal = showEditOperatorModal;
window.submitEditOperator = submitEditOperator;
window.resetOperatorPassword = resetOperatorPassword;
window.performResetOperatorPassword = performResetOperatorPassword;
window.confirmDismissOperator = confirmDismissOperator;
window.dismissOperator = dismissOperator;
window.showRestoreOperatorModal = showRestoreOperatorModal;
window.submitRestoreOperator = submitRestoreOperator;
window.confirmDeleteOperator = confirmDeleteOperator;
window.deleteOperator = deleteOperator;
window.showOperatorHistoryModal = showOperatorHistoryModal;
window.showChangePasswordModal = showChangePasswordModal;
window.showChangeUsernameModal = showChangeUsernameModal;
window.submitLegacyChangePassword = submitLegacyChangePassword;
window.submitChangePassword = submitChangePassword;
window.submitChangeUsername = submitChangeUsername;
window.copyCredentials = copyCredentials;
window.renderOperatorLevelsSettings = renderOperatorLevelsSettings;
window.recalculateOperatorLevelsUi = recalculateOperatorLevelsUi;
window.showCreateOperatorLevelPrompt = showCreateOperatorLevelPrompt;
window.submitOperatorLevelForm = submitOperatorLevelForm;
window.editOperatorLevelUi = editOperatorLevelUi;
window.addOperatorLevelRuleUi = addOperatorLevelRuleUi;
window.submitOperatorLevelRuleForm = submitOperatorLevelRuleForm;
window.deleteOperatorLevelRuleUi = deleteOperatorLevelRuleUi;
window.disableOperatorLevelUi = disableOperatorLevelUi;
window.manualOperatorLevelUi = manualOperatorLevelUi;


/* ══════════════════════════════════════
   VIEW: РАСЧЁТ ЗА ПЕРИОД
══════════════════════════════════════ */

/* ══════════════════════════════════════
   КОИНЫ: Еженедельный расчёт (ТЗ §3) — preview / apply / история запусков
══════════════════════════════════════ */

function canApplyAccrual(role) { return role === 'manager' || role === 'admin'; }

function _mondayOfWeek(d) {
  const day = (d.getDay() + 6) % 7; // 0 = понедельник
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  return monday;
}
function _isoDate(d) { return d.toISOString().slice(0, 10); }

// Прошлая календарная неделя пн-вс — тот же расчёт, что у cron-задачи на бэкенде.
function _defaultAccrualPeriod() {
  const today = new Date();
  const thisMonday = _mondayOfWeek(today);
  const prevMonday = new Date(thisMonday); prevMonday.setDate(thisMonday.getDate() - 7);
  const prevSunday = new Date(thisMonday); prevSunday.setDate(thisMonday.getDate() - 1);
  return { start: _isoDate(prevMonday), end: _isoDate(prevSunday) };
}

const _weeklyAccrualState = { start: null, end: null, preview: null, runs: null };

function renderWeeklyAccrualTab(body) {
  if (!_weeklyAccrualState.start) {
    const def = _defaultAccrualPeriod();
    _weeklyAccrualState.start = def.start;
    _weeklyAccrualState.end = def.end;
  }
  const canApply = canApplyAccrual(STATE.user?.role);
  const s = _weeklyAccrualState;

  body.innerHTML = `
    <div class="panel coins-weekly-toolbar">
      <div class="panel-head"><h3>Расчёт за период</h3></div>
      <div class="filter-row" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
        <div class="form-group" style="margin:0">
          <label class="form-label">Начало периода</label>
          <input type="date" id="wa-period-start" class="form-input" value="${esc(s.start)}">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Конец периода</label>
          <input type="date" id="wa-period-end" class="form-input" value="${esc(s.end)}">
        </div>
        <button class="btn-outline btn-sm" onclick="runWeeklyAccrualPreview()">Предварительный расчёт</button>
        ${canApply ? `<button class="btn-primary btn-sm" onclick="runWeeklyAccrualApply()">Начислить коины за период</button>` : ''}
      </div>
    </div>

    <div id="wa-preview-host"></div>

    <div class="panel">
      <div class="panel-head">
        <h3>История запусков</h3>
        <button class="btn-link" onclick="loadWeeklyAccrualRuns()">Обновить</button>
      </div>
      <div id="wa-runs-host"><div class="empty-line">Загрузка…</div></div>
    </div>`;

  if (_weeklyAccrualState.preview) _renderWeeklyAccrualPreview();
  loadWeeklyAccrualRuns();
}

function _readAccrualPeriodInputs() {
  const start = document.getElementById('wa-period-start')?.value;
  const end = document.getElementById('wa-period-end')?.value;
  if (start) _weeklyAccrualState.start = start;
  if (end) _weeklyAccrualState.end = end;
  return { start: _weeklyAccrualState.start, end: _weeklyAccrualState.end };
}

async function runWeeklyAccrualPreview() {
  const { start, end } = _readAccrualPeriodInputs();
  if (!start || !end) { showToast('Укажите период', 'error'); return; }
  const host = document.getElementById('wa-preview-host');
  if (host) host.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Считаем…</p></div>';
  try {
    _weeklyAccrualState.preview = await api.previewWeeklyAccrual(start, end);
  } catch (e) {
    if (host) host.innerHTML = `<div class="empty-line">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  _renderWeeklyAccrualPreview();
}

const _bonusChipDefs = [
  ['bonus_top_coins', '🏆', 'Топ недели'],
  ['bonus_no_late_coins', '⏰', 'Без опозданий'],
  ['bonus_no_violation_coins', '✅', 'Без нарушений'],
  ['bonus_nomination_coins', '⭐', 'Номинация'],
  ['bonus_thanks_coins', '🚌', 'Благодарность водителя'],
];

function _bonusChipsHtml(o) {
  const chips = _bonusChipDefs
    .filter(([key]) => o[key])
    .map(([key, icon, title]) => `<span class="bonus-chip" title="${esc(title)}">${icon} +${o[key]}</span>`)
    .join('');
  return chips || '<span class="cell-muted">—</span>';
}

function _renderWeeklyAccrualPreview() {
  const host = document.getElementById('wa-preview-host');
  if (!host) return;
  const p = _weeklyAccrualState.preview;
  if (!p) { host.innerHTML = ''; return; }

  host.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Предварительный расчёт: ${esc(p.period_start)} — ${esc(p.period_end)}</h3>
        <span class="panel-badge">${p.total_operators} операторов · ${p.total_coins} ₡</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Место</th><th>Оператор</th><th>Группа</th><th>Баллы</th><th>База</th>
            <th>Бонусы</th><th>Итого</th><th>Динамика</th>
          </tr></thead>
          <tbody>
            ${p.operators.length ? p.operators.slice().sort((a, b) => (a.rank_place ?? 999) - (b.rank_place ?? 999)).map(o => `
              <tr class="${o.already_accrued ? 'row-muted' : ''}">
                <td><span class="rank-badge ${(o.rank_place || 99) <= 3 ? 'rank-top' : ''}">${o.rank_place ?? '—'}</span></td>
                <td class="name-cell">${esc(o.operator_name)}${o.already_accrued ? '<div class="cell-muted" style="font-size:11px">уже начислено</div>' : ''}</td>
                <td>${esc(o.group_name || '')}</td>
                <td>${levelNum(o.contest_points)}</td>
                <td>${o.base_coins} ₡</td>
                <td>${_bonusChipsHtml(o)}</td>
                <td><b class="accent-text">${o.total_coins} ₡</b></td>
                <td>${o.rank_delta != null ? `<span class="rank-delta ${o.rank_delta > 0 ? 'up' : o.rank_delta < 0 ? 'down' : ''}">${o.rank_delta > 0 ? '↑' + o.rank_delta : o.rank_delta < 0 ? '↓' + Math.abs(o.rank_delta) : '—'}</span>` : '—'}</td>
              </tr>`).join('') : '<tr><td colspan="8" class="empty-line">Нет данных WeeklyResult за этот период</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function runWeeklyAccrualApply() {
  const { start, end } = _readAccrualPeriodInputs();
  if (!start || !end) { showToast('Укажите период', 'error'); return; }
  if (!confirm(`Вы уверены, что хотите начислить коины за период ${start} — ${end}? Действие необратимо (повторный запуск не задвоит начисление, но и не отменит его).`)) return;

  try {
    const run = await api.applyWeeklyAccrual({ period_start: start, period_end: end, mode: 'manual' });
    if (run.status === 'success') {
      showToast(`Начислено: ${run.operators_count} операторов, ${run.total_coins} ₡ (пропущено уже начисленных: ${run.skipped_existing_count})`, 'ok');
    } else {
      showToast(`Расчёт завершился с ошибкой: ${run.error_message || 'см. историю запусков'}`, 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
    return;
  }
  _weeklyAccrualState.preview = null;
  document.getElementById('wa-preview-host').innerHTML = '';
  loadWeeklyAccrualRuns();
  // Баланс/история могли измениться — сбрасываем зависимые кеши
  STATE.coinsOverview = null;
  STATE.history = [];
}

async function loadWeeklyAccrualRuns() {
  const host = document.getElementById('wa-runs-host');
  if (!host) return;
  try {
    _weeklyAccrualState.runs = await api.listAccrualRuns();
  } catch {
    host.innerHTML = '<div class="empty-line">Не удалось загрузить историю запусков</div>';
    return;
  }
  const runs = _weeklyAccrualState.runs || [];
  host.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Период</th><th>Режим</th><th>Статус</th><th>Запущен</th><th>Операторов</th><th>Коинов</th><th>Автор</th></tr></thead>
        <tbody>
          ${runs.length ? runs.map(r => `
            <tr>
              <td>${esc(r.period_start)} — ${esc(r.period_end)}</td>
              <td>${r.mode === 'auto' ? 'Авто (cron)' : 'Вручную'}</td>
              <td><span class="status-pill ${r.status === 'success' ? 'ok' : 'error'}">${r.status === 'success' ? 'Успешно' : 'Ошибка'}</span></td>
              <td style="white-space:nowrap">${fmtDateTime(r.started_at)}</td>
              <td>${r.operators_count}${r.skipped_existing_count ? ` <span class="cell-muted">(+${r.skipped_existing_count} пропущено)</span>` : ''}</td>
              <td><b>${r.total_coins} ₡</b></td>
              <td>${esc(r.created_by)}</td>
            </tr>`).join('') : '<tr><td colspan="7" class="empty-line">Запусков ещё не было</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function exportWeeklyAccrualPeriod(format = 'csv') {
  const { start, end } = _readAccrualPeriodInputs();
  if (!start || !end) { showToast('Укажите период', 'error'); return; }
  window.open(api.exportUrl('/api/exports/weekly-results', { period_start: start, period_end: end, format }), '_blank');
}

/* ══════════════════════════════════════
   КОИНЫ: Настройки начислений (ТЗ §4) — GET/PUT /api/settings/coin-rules
══════════════════════════════════════ */

function canEditCoinRules(role) { return role === 'manager' || role === 'admin'; }

const _NOMINATION_TOGGLES = [
  ['nomination_calls_enabled', 'Лучший по звонкам', 'Больше всего звонков в час за неделю'],
  ['nomination_quality_enabled', 'Лучшее качество', 'Самое высокое качество звонков за неделю'],
  ['nomination_efficiency_enabled', 'Топ по эффективности', 'Самая высокая эффективность за неделю'],
  ['nomination_progress_enabled', 'Лучший прогресс недели', 'Наибольший рост места в рейтинге'],
  ['nomination_thanks_enabled', 'Больше всего благодарностей', 'Больше всего благодарностей от водителей'],
];

function _toggleRowHtml(id, label, checked, canEdit, hint = '') {
  return `
    <div class="toggle-row">
      <div>
        <div class="toggle-row-label">${esc(label)}</div>
        ${hint ? `<div class="toggle-row-hint">${esc(hint)}</div>` : ''}
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="cr-${id}" ${checked ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
        <span class="toggle-slider"></span>
      </label>
    </div>`;
}

async function renderCoinRulesSettingsTab(body) {
  body.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка настроек…</p></div>';
  let rules;
  try {
    rules = await swrFetch('coin-rules:settings', () => api.getCoinRulesSettings(), null, SWR_STATIC_TTL_MS);
  } catch (e) {
    body.innerHTML = `<div class="empty-line">Ошибка загрузки: ${esc(e.message)}</div>`;
    return;
  }
  const canEdit = canEditCoinRules(STATE.user?.role);

  const numField = (id, label, value, hint = '') => `
    <div class="coin-rules-field">
      <label for="cr-${id}">${esc(label)}</label>
      <input id="cr-${id}" class="form-input" type="number" step="1" value="${value}" ${canEdit ? '' : 'disabled'}>
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
    </div>`;

  body.innerHTML = `
    <div class="an-card">
      <div class="an-card-head-row">
        <div class="an-card-head">Курс перевода</div>
        <div>
          ${!canEdit ? '<span class="panel-badge">Только просмотр</span>' : ''}
          ${rules.updated_by_name ? `<span class="cell-muted" style="font-size:12px">Изменено: ${esc(rules.updated_by_name)}</span>` : ''}
        </div>
      </div>
      <div class="coin-rules-form">
        ${numField('points_per_coin', 'Баллов за 1 коин', rules.points_per_coin, 'Например, 5 = 5 баллов конвертируются в 1 коин')}
        <div class="coin-rules-field">
          <label for="cr-rounding_mode">Округление</label>
          <select id="cr-rounding_mode" class="form-input" ${canEdit ? '' : 'disabled'}>
            ${['floor', 'ceil', 'round'].map(m => `<option value="${m}" ${rules.rounding_mode === m ? 'selected' : ''}>${{ floor: 'Вниз', ceil: 'Вверх', round: 'Округление' }[m]}</option>`).join('')}
          </select>
        </div>
        ${numField('min_points_for_accrual', 'Минимальный балл для начисления', rules.min_points_for_accrual)}
      </div>
    </div>

    <div class="an-card">
      <div class="an-card-head">Бонусы за рейтинг недели</div>
      <div class="coin-rules-form">
        ${numField('top_1_bonus', '1 место', rules.top_1_bonus)}
        ${numField('top_2_bonus', '2 место', rules.top_2_bonus)}
        ${numField('top_3_bonus', '3 место', rules.top_3_bonus)}
      </div>
    </div>

    <div class="an-card">
      <div class="an-card-head">Бонусы за дисциплину и признание</div>
      <div class="coin-rules-form">
        ${numField('no_late_bonus', 'Неделя без опозданий', rules.no_late_bonus)}
        ${numField('no_violation_bonus', 'Неделя без нарушений', rules.no_violation_bonus)}
        ${numField('nomination_bonus', 'Номинация недели (за каждую)', rules.nomination_bonus)}
        ${numField('driver_thanks_bonus', 'Благодарность от водителя', rules.driver_thanks_bonus)}
      </div>
    </div>

    <div class="an-card">
      <div class="an-card-head">Включённые номинации</div>
      ${_NOMINATION_TOGGLES.map(([key, label, hint]) => _toggleRowHtml(key, label, rules[key], canEdit, hint)).join('')}
    </div>

    <div class="an-card">
      <div class="an-card-head">Ограничения начисления</div>
      ${_toggleRowHtml('accrue_to_fired', 'Начислять уволенным операторам', rules.accrue_to_fired, canEdit)}
      ${_toggleRowHtml('accrue_to_inactive', 'Начислять неучаствующим операторам', rules.accrue_to_inactive, canEdit)}
    </div>

    ${canEdit ? `
      <div class="panel-footer">
        <button class="btn-primary" onclick="saveCoinRulesSettings()">Сохранить настройки</button>
      </div>
      <div class="empty-line" style="margin-top:6px">Изменения применяются к следующему расчёту — старые начисления не пересчитываются.</div>
    ` : ''}`;
}

async function saveCoinRulesSettings() {
  const val = id => Number(document.getElementById(`cr-${id}`)?.value);
  const checked = id => !!document.getElementById(`cr-${id}`)?.checked;

  const payload = {
    points_per_coin: val('points_per_coin'),
    rounding_mode: document.getElementById('cr-rounding_mode')?.value,
    min_points_for_accrual: val('min_points_for_accrual'),
    top_1_bonus: val('top_1_bonus'), top_2_bonus: val('top_2_bonus'), top_3_bonus: val('top_3_bonus'),
    no_late_bonus: val('no_late_bonus'), no_violation_bonus: val('no_violation_bonus'),
    nomination_bonus: val('nomination_bonus'), driver_thanks_bonus: val('driver_thanks_bonus'),
    accrue_to_fired: checked('accrue_to_fired'), accrue_to_inactive: checked('accrue_to_inactive'),
  };
  for (const [key] of _NOMINATION_TOGGLES) payload[key] = checked(key);

  try {
    await api.updateCoinRulesSettings(payload);
    swrInvalidate('coin-rules:');
    swrInvalidate('coins:');
    showToast('Настройки начислений сохранены', 'ok');
  } catch (e) {
    showToast(e.message, 'error');
    return;
  }
  const body = document.getElementById('coins-tab-body');
  if (body) renderCoinRulesSettingsTab(body);
}

let _sessionFilterStatus = 'active';
let _sessionFilterQuery = '';
let _sessionFilterRole = 'all';
let _sessionFilterDevice = 'all';

function sessionsDebounce(fn, delay = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function sessionStatusBadge(status, expiresAt) {
  if (status === 'revoked') return '<span class="badge badge-muted">сброшена</span>';
  if (status === 'expired') return '<span class="badge badge-warning">истекла</span>';
  return '<span class="badge badge-ok">активна</span>';
}

function sessionSafeDate(value) {
  return value ? esc(fmtDateTime(value)) : '—';
}

function sessionsCacheKey() {
  return `sessions:list:${_sessionFilterStatus}:${_sessionFilterRole}:${_sessionFilterDevice}:${_sessionFilterQuery || ''}`;
}

function sessionsFetchCurrent(onFresh) {
  return swrFetch(
    sessionsCacheKey(),
    () => api.listSessions({
      status: _sessionFilterStatus,
      q: _sessionFilterQuery,
      role: _sessionFilterRole,
      device: _sessionFilterDevice,
      limit: 250,
    }),
    onFresh,
    SWR_FAST_TTL_MS,
  );
}

async function renderAdminSessions() {
  const el = document.getElementById('view-sessions');
  if (!el) return;
  if (STATE.user?.role !== 'admin') {
    el.innerHTML = '<div class="empty-state">Раздел доступен только администратору</div>';
    return;
  }

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Безопасность</div>
        <h2 class="section-title">Сессии пользователей</h2>
      </div>
      <div class="header-right">
        <button class="btn-outline" id="sessions-refresh-btn">Обновить</button>
      </div>
    </div>
    <div class="panel sessions-panel">
      <div class="sessions-loading"><div class="loading-spinner"></div><span>Загрузка сессий...</span></div>
    </div>`;

  try {
    const data = await sessionsFetchCurrent((fresh) => {
      if (STATE.currentView === 'sessions') paintAdminSessions(el, fresh || { items: [], stats: {} });
    });
    paintAdminSessions(el, data || { items: [], stats: {} });
  } catch (err) {
    el.querySelector('.sessions-panel').innerHTML = `<div class="empty-state">Не удалось загрузить сессии: ${esc(err.message || err)}</div>`;
  }
}

function paintAdminSessions(el, data) {
  const items = data.items || [];
  const stats = data.stats || {};
  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Безопасность</div>
        <h2 class="section-title">Сессии пользователей</h2>
      </div>
      <div class="header-right">
        <button class="btn-outline" id="sessions-refresh-btn">Обновить</button>
      </div>
    </div>

    <div class="kpi-grid sessions-kpis">
      <div class="kpi-card kpi-accent"><div class="kpi-label">Активные сессии</div><div class="kpi-value">${stats.active || 0}</div></div>
      <div class="kpi-card"><div class="kpi-label">Пользователей онлайн</div><div class="kpi-value">${stats.total_users != null ? stats.total_users : '—'}</div></div>
      <div class="kpi-card kpi-warn"><div class="kpi-label">Истёкшие</div><div class="kpi-value">${stats.expired || 0}</div></div>
      <div class="kpi-card"><div class="kpi-label">Сброшенные</div><div class="kpi-value">${stats.revoked || 0}</div></div>
    </div>

    <div class="sessions-filterbar">
      <div class="filter-tabs" id="sessions-role-tabs">
        ${[
          ['all', 'Все', stats.active || 0],
          ['admin', 'Админы', (stats.by_role && stats.by_role.admin) || 0],
          ['supervisor', 'Супервайзеры', (stats.by_role && stats.by_role.supervisor) || 0],
          ['operator', 'Операторы', (stats.by_role && stats.by_role.operator) || 0],
        ].map(([v, t, c]) => `<button class="filter-tab ${_sessionFilterRole === v ? 'active' : ''}" data-role="${v}">${t}<span class="filter-tab-count">${c}</span></button>`).join('')}
      </div>
      <div class="filter-tabs" id="sessions-device-tabs">
        ${[
          ['all', 'Все устройства', stats.active || 0],
          ['pc', 'ПК', (stats.by_device && stats.by_device.pc) || 0],
          ['mobile', 'Телефон', (stats.by_device && stats.by_device.mobile) || 0],
        ].map(([v, t, c]) => `<button class="filter-tab ${_sessionFilterDevice === v ? 'active' : ''}" data-device="${v}">${t}<span class="filter-tab-count">${c}</span></button>`).join('')}
      </div>
    </div>

    <div class="panel sessions-panel">
      <div class="panel-head sessions-head">
        <div>
          <h3>Устройства и входы</h3>
          <p class="panel-hint">IP определяется по proxy-заголовкам Railway, устройство — по User-Agent браузера.</p>
        </div>
        <div class="sessions-filters">
          <select class="form-select" id="sessions-status">
            ${[['active','Активные'],['all','Все'],['revoked','Сброшенные'],['expired','Истёкшие']].map(([v,t]) => `<option value="${v}" ${_sessionFilterStatus === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <input class="form-input" id="sessions-query" placeholder="Поиск: имя, логин, IP, устройство" value="${esc(_sessionFilterQuery)}">
        </div>
      </div>
      <div class="table-wrap sessions-table-wrap">
        <table class="data-table sessions-table">
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Устройство</th>
              <th>IP</th>
              <th>Вход</th>
              <th>Активность</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${items.length ? items.map(sessionRow).join('') : '<tr><td colspan="7"><div class="empty-line">Сессий пока нет</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  el.querySelector('#sessions-refresh-btn')?.addEventListener('click', () => renderAdminSessions());
  el.querySelector('#sessions-status')?.addEventListener('change', e => {
    _sessionFilterStatus = e.target.value || 'active';
    renderAdminSessions();
  });
  el.querySelector('#sessions-role-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-role]');
    if (!btn) return;
    _sessionFilterRole = btn.dataset.role || 'all';
    renderAdminSessions();
  });
  el.querySelector('#sessions-device-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-device]');
    if (!btn) return;
    _sessionFilterDevice = btn.dataset.device || 'all';
    renderAdminSessions();
  });
  el.querySelector('#sessions-query')?.addEventListener('input', sessionsDebounce(e => {
    _sessionFilterQuery = e.target.value || '';
    renderAdminSessions();
  }, 350));
}

function sessionRow(s) {
  const canRevoke = s.status === 'active' && !s.is_current;
  return `
    <tr>
      <td>
        <div class="name-cell">${esc(s.user_name || s.username || '—')} ${s.is_current ? '<span class="me-badge">текущая</span>' : ''}</div>
        <div class="cell-muted">${esc(s.username || '')} · ${esc(roleLabel(s.role))}</div>
      </td>
      <td>
        <div class="sessions-device">${esc(s.device_label || 'Unknown device')}</div>
        <div class="cell-muted">${esc(s.browser_label || '')}${s.os_label ? ' · ' + esc(s.os_label) : ''}</div>
      </td>
      <td><span class="sessions-ip">${esc(s.ip_address || '—')}</span></td>
      <td>${sessionSafeDate(s.created_at)}</td>
      <td>${sessionSafeDate(s.last_seen_at)}</td>
      <td>${sessionStatusBadge(s.status, s.expires_at)}</td>
      <td class="row-actions">
        <button class="btn-outline btn-sm danger-text" ${canRevoke ? '' : 'disabled'} onclick="revokeUserSession('${esc(s.session_id)}')">Сбросить</button>
        <button class="btn-ghost btn-sm" onclick="revokeAllUserSessions(${Number(s.user_id) || 0})" ${s.user_id ? '' : 'disabled'}>Все</button>
      </td>
    </tr>`;
}

async function revokeUserSession(sessionId) {
  if (!sessionId) return;
  if (!confirm('Сбросить эту сессию? Пользователь выйдет из аккаунта на этом устройстве.')) return;
  try {
    await api.revokeSession(sessionId);
    swrInvalidate('sessions:list:');
    showToast('Сессия сброшена', 'ok');
    renderAdminSessions();
  } catch (err) {
    showToast(err.message || 'Не удалось сбросить сессию', 'err');
  }
}

async function revokeAllUserSessions(userId) {
  if (!userId) return;
  if (!confirm('Сбросить все активные сессии этого пользователя?')) return;
  try {
    const result = await api.revokeUserSessions(userId, true);
    swrInvalidate('sessions:list:');
    showToast(`Сброшено сессий: ${result.revoked || 0}`, 'ok');
    renderAdminSessions();
  } catch (err) {
    showToast(err.message || 'Не удалось сбросить сессии', 'err');
  }
}

window.revokeUserSession = revokeUserSession;
window.revokeAllUserSessions = revokeAllUserSessions;

function renderPeriodReport() {
  const el = document.getElementById('view-period-report');
  if (!el) return;

  let lastResult = null;
  let searchVal = '', filterGroup = '', sortKey = 'final_points', sortDir = 'desc';

  function fmtNum(v, decimals = 2) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Number(v).toFixed(decimals);
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Расчёт</div><h2 class="section-title">Расчёт показателей за период</h2></div>
    </div>

    <div class="pr-card">
      <div class="pr-card-head">Загрузка файлов</div>
      <div class="pr-upload-grid">
        <div class="form-group">
          <label class="form-label">Monthly Report — оценки качества звонков</label>
          <label class="pr-file-drop" for="pr-file-monthly" id="pr-file-monthly-drop">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span class="pr-file-drop-text">Нажмите, чтобы выбрать файл .xlsx</span>
          </label>
          <input id="pr-file-monthly" type="file" accept=".xlsx" hidden>
        </div>
        <div class="form-group">
          <label class="form-label">Report — часы, звонки, штрафы</label>
          <label class="pr-file-drop" for="pr-file-report" id="pr-file-report-drop">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span class="pr-file-drop-text">Нажмите, чтобы выбрать файл .xlsx</span>
          </label>
          <input id="pr-file-report" type="file" accept=".xlsx" hidden>
        </div>
      </div>
      <div id="pr-upload-status" class="status-line"></div>
      <button class="btn-primary" id="pr-upload-btn" style="margin-top:8px">Загрузить файлы</button>
    </div>

    <div class="pr-card">
      <div class="pr-card-head">Период расчёта</div>
      <div class="pr-period-row">
        <div class="form-group">
          <label class="form-label">Дата начала</label>
          <input id="pr-start-date" type="date" class="form-input">
        </div>
        <div class="form-group">
          <label class="form-label">Дата окончания</label>
          <input id="pr-end-date" type="date" class="form-input">
        </div>
        <button class="btn-primary" id="pr-calc-btn" style="align-self:flex-end">Рассчитать</button>
      </div>
      <div id="pr-calc-status" class="status-line"></div>
    </div>

    <div id="pr-results"></div>
  `;

  // File selection display
  function bindFileDrop(inputId, dropId) {
    const input = el.querySelector('#' + inputId);
    const drop = el.querySelector('#' + dropId);
    input?.addEventListener('change', () => {
      const file = input.files[0];
      const textEl = drop.querySelector('.pr-file-drop-text');
      if (file) {
        drop.classList.add('pr-file-drop-filled');
        textEl.textContent = file.name;
      } else {
        drop.classList.remove('pr-file-drop-filled');
        textEl.textContent = 'Нажмите, чтобы выбрать файл .xlsx';
      }
    });
  }
  bindFileDrop('pr-file-monthly', 'pr-file-monthly-drop');
  bindFileDrop('pr-file-report', 'pr-file-report-drop');

  // Проверяем, сохранены ли файлы в БД (переживают редеплой)
  (async () => {
    try {
      const status = await swrFetch('period-report:status', () => api.getPeriodReportStatus(), null, SWR_FAST_TTL_MS);
      const statusEl = el.querySelector('#pr-upload-status');
      if (status.monthly && status.report) {
        statusEl.innerHTML = `✓ Файлы уже загружены и сохранены: <b>${esc(status.monthly.filename)}</b>, <b>${esc(status.report.filename)}</b>. Можно сразу выбрать период.`;
        statusEl.className = 'status-line status-ok';
      } else if (status.monthly || status.report) {
        statusEl.textContent = 'Загружен только один из файлов — дозагрузите второй.';
        statusEl.className = 'status-line status-error';
      }
    } catch(e) { /* тихо игнорируем — не критично для работы страницы */ }
  })();

  // Upload handler
  el.querySelector('#pr-upload-btn').addEventListener('click', async () => {
    const monthlyFile = el.querySelector('#pr-file-monthly').files[0];
    const reportFile = el.querySelector('#pr-file-report').files[0];
    const statusEl = el.querySelector('#pr-upload-status');

    if (!monthlyFile || !reportFile) {
      statusEl.textContent = 'Выберите оба файла';
      statusEl.className = 'status-line status-error';
      return;
    }
    if (!monthlyFile.name.toLowerCase().endsWith('.xlsx') || !reportFile.name.toLowerCase().endsWith('.xlsx')) {
      statusEl.textContent = 'Файлы должны быть в формате .xlsx';
      statusEl.className = 'status-line status-error';
      return;
    }

    statusEl.textContent = 'Загружаем…';
    statusEl.className = 'status-line';

    const formData = new FormData();
    formData.append('monthly_report_file', monthlyFile);
    formData.append('report_file', reportFile);

    try {
      const data = await api.uploadPeriodReportFiles(formData);
      swrInvalidate('period-report:');
      statusEl.textContent = '✓ ' + data.message;
      statusEl.className = 'status-line status-ok';
    } catch (e) {
      statusEl.textContent = e.message;
      statusEl.className = 'status-line status-error';
    }
  });

  // Calculate handler
  el.querySelector('#pr-calc-btn').addEventListener('click', async () => {
    const startDate = el.querySelector('#pr-start-date').value;
    const endDate = el.querySelector('#pr-end-date').value;
    const statusEl = el.querySelector('#pr-calc-status');

    if (!startDate || !endDate) {
      statusEl.textContent = 'Укажите дату начала и окончания';
      statusEl.className = 'status-line status-error';
      return;
    }
    if (startDate > endDate) {
      statusEl.textContent = 'Дата начала не может быть позже даты окончания';
      statusEl.className = 'status-line status-error';
      return;
    }

    statusEl.textContent = 'Считаем…';
    statusEl.className = 'status-line';

    try {
      const res = await fetch(
        api._base() + `/api/reports/operators-period-summary?start_date=${startDate}&end_date=${endDate}`,
        { credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Ошибка расчёта');
      statusEl.textContent = '';
      lastResult = data;
      renderResults(data);
    } catch (e) {
      statusEl.textContent = e.message;
      statusEl.className = 'status-line status-error';
      el.querySelector('#pr-results').innerHTML = '';
    }
  });

  function renderResults(data) {
    const ops = data.operators || [];
    const w = data.warnings || {};
    const summary = data.summary || {};
    const groups = [...new Set(ops.map(o => o.group_name).filter(Boolean))].sort();

    // Сводные показатели приходят с backend — считаются только по matched-операторам
    // с реальными данными за период (см. ТЗ: matched-only summary).
    const fmtOrDash = (v, decimals = 2, suffix = '') =>
      (v === null || v === undefined) ? '—' : fmtNum(v, decimals) + suffix;

    function filteredSorted() {
      let r = ops.filter(o =>
        (!searchVal || o.full_name.toLowerCase().includes(searchVal.toLowerCase())) &&
        (!filterGroup || o.group_name === filterGroup)
      );
      r.sort((a, b) => {
        const av = a[sortKey] || 0, bv = b[sortKey] || 0;
        return sortDir === 'desc' ? bv - av : av - bv;
      });
      return r;
    }

    function sortIndicator(key) {
      if (sortKey !== key) return '';
      return sortDir === 'desc' ? ' ↓' : ' ↑';
    }

    function renderTable() {
      const rows = filteredSorted();
      if (!rows.length) return '<div class="empty-line">Нет данных для отображения</div>';
      return `<div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>Оператор</th><th>Группа</th>
          <th class="num sortable" data-sort="final_points">Баллы${sortIndicator('final_points')}</th>
          <th class="num sortable" data-sort="quality_avg">Качество${sortIndicator('quality_avg')}</th>
          <th class="num">Звонков оцен.</th>
          <th class="num">Итог часов</th>
          <th class="num">База часов</th>
          <th class="num sortable" data-sort="kvz">КВЗ${sortIndicator('kvz')}</th>
          <th class="num sortable" data-sort="efficiency_percent">Эфф. %${sortIndicator('efficiency_percent')}</th>
          <th class="num sortable" data-sort="penalty_minutes">Штраф мин${sortIndicator('penalty_minutes')}</th>
        </tr></thead>
        <tbody>
          ${rows.map(o => `
            <tr>
              <td class="name-cell">${esc(o.full_name)}</td>
              <td>${esc(o.group_name || '—')}</td>
              <td class="num"><b>${fmtNum(o.final_points)}</b></td>
              <td class="num">${o.quality_calls_count > 0 ? fmtNum(o.quality_avg) : '<span style="color:var(--text-muted)">нет оценок</span>'}</td>
              <td class="num">${o.quality_calls_count}</td>
              <td class="num">${fmtNum(o.total_hours)}</td>
              <td class="num">${fmtNum(o.base_hours)}</td>
              <td class="num">${fmtNum(o.kvz)}</td>
              <td class="num">${fmtNum(o.efficiency_percent)}%</td>
              <td class="num" style="${o.penalty_minutes > 0 ? 'color:var(--danger)' : ''}">${fmtNum(o.penalty_minutes, 1)}</td>
            </tr>
            ${o.warnings && o.warnings.length ? `<tr><td colspan="10" style="padding:4px 16px;background:var(--warning-soft)">
              <span style="font-size:11px;color:var(--warning)">⚠ ${o.warnings.map(esc).join(' · ')}</span>
            </td></tr>` : ''}
          `).join('')}
        </tbody>
      </table></div>`;
    }

    const totalWarnings = (w.site_only?.length||0) + (w.file_only?.length||0) +
      (w.no_quality?.length||0) + (w.no_base_hours?.length||0);

    function warnGroup(title, items, hint) {
      if (!items || !items.length) return '';
      return `<div class="pr-warn-group">
        <div class="pr-warn-group-title">${esc(title)} (${items.length})</div>
        ${hint ? `<div class="pr-warn-group-hint">${esc(hint)}</div>` : ''}
        <div class="pr-warn-chips">
          ${items.slice(0, 30).map(n => `<span class="pr-warn-chip">${esc(n)}</span>`).join('')}
          ${items.length > 30 ? `<span class="pr-warn-chip pr-warn-chip-more">+${items.length - 30}</span>` : ''}
        </div>
      </div>`;
    }

    el.querySelector('#pr-results').innerHTML = `
      <div class="pr-stats-row">
        <div class="pr-stat">
          <div class="pr-stat-val">${summary.operators_count ?? 0}</div>
          <div class="pr-stat-label">Операторов в расчёте</div>
        </div>
        <div class="pr-stat">
          <div class="pr-stat-val">${fmtOrDash(summary.avg_quality)}</div>
          <div class="pr-stat-label">${summary.avg_quality == null ? 'Нет оценок за период' : 'Сред. качество (по оценкам)'}</div>
        </div>
        <div class="pr-stat">
          <div class="pr-stat-val">${fmtOrDash(summary.total_calls, 0)}</div>
          <div class="pr-stat-label">Всего звонков</div>
        </div>
        <div class="pr-stat">
          <div class="pr-stat-val">${fmtOrDash(summary.avg_kvz)}</div>
          <div class="pr-stat-label">${summary.avg_kvz == null ? 'Нет базы часов' : 'Средний КВЗ'}</div>
        </div>
        <div class="pr-stat">
          <div class="pr-stat-val">${fmtOrDash(summary.avg_efficiency, 2, '%')}</div>
          <div class="pr-stat-label">${summary.avg_efficiency == null ? 'Нет базы часов' : 'Сред. эффективность'}</div>
        </div>
        <div class="pr-stat">
          <div class="pr-stat-val">${fmtOrDash(summary.penalty_minutes_total, 1)}</div>
          <div class="pr-stat-label">Штрафов, мин</div>
        </div>
      </div>

      ${summary.site_total_count != null ? `
      <div class="pr-match-info">
        Всего на сайте: <b>${summary.site_total_count}</b> ·
        Совпало с файлом: <b>${summary.matched_count}</b> ·
        Только на сайте: <b style="color:var(--warning)">${summary.site_only_count}</b> ·
        Только в файле: <b style="color:var(--warning)">${summary.file_only_count}</b>
      </div>` : ''}

      <div class="pr-save-banner">
        <div class="pr-save-banner-text">
          <div class="pr-save-banner-title">Это предварительный просмотр расчёта</div>
          <div class="pr-save-banner-sub">Данные ниже не сохранены. Чтобы они появились в рейтинге и истории начислений, нажмите «Сохранить расчёт».</div>
        </div>
        <button class="btn-primary pr-save-banner-btn" id="pr-save-btn-top">Сохранить расчёт</button>
      </div>

      ${totalWarnings ? `
      <div class="pr-card">
        <div class="pr-card-head">Предупреждения по данным (${totalWarnings})</div>
        ${warnGroup('Есть на сайте, но отсутствуют в файле', w.site_only,
          'Эти операторы не участвуют в расчёте за выбранный период.')}
        ${warnGroup('Есть в файле, но отсутствуют на сайте', w.file_only,
          'Игнорируются — не влияют на статистику и не появляются как операторы.')}
        ${warnGroup('Нет оценок качества за период', w.no_quality)}
        ${warnGroup('Нет базы часов за период', w.no_base_hours)}
      </div>` : ''}

      <div class="pr-card">
        <div class="pr-card-head-row">
          <span>Результаты по операторам</span>
          <div style="display:flex;gap:8px">
            <button class="btn-outline btn-sm" id="pr-export-btn">Экспорт CSV</button>
            <button class="btn-primary btn-sm" id="pr-save-btn">Сохранить расчёт</button>
          </div>
        </div>
        <div class="pr-filters-row">
          <input id="pr-search" class="form-input" placeholder="Поиск по ФИО…" style="max-width:240px">
          <select id="pr-group-filter" class="form-select" style="max-width:180px">
            <option value="">Все группы</option>
            ${groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}
          </select>
        </div>
        <div id="pr-table-wrap">${renderTable()}</div>
      </div>
    `;

    // Bind search/filter/sort
    el.querySelector('#pr-search')?.addEventListener('input', e => {
      searchVal = e.target.value;
      el.querySelector('#pr-table-wrap').innerHTML = renderTable();
      bindTableSort();
    });
    el.querySelector('#pr-group-filter')?.addEventListener('change', e => {
      filterGroup = e.target.value;
      el.querySelector('#pr-table-wrap').innerHTML = renderTable();
      bindTableSort();
    });

    function bindTableSort() {
      el.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort;
          if (sortKey === key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
          else { sortKey = key; sortDir = 'desc'; }
          el.querySelector('#pr-table-wrap').innerHTML = renderTable();
          bindTableSort();
        });
      });
    }
    bindTableSort();

    // Export CSV
    el.querySelector('#pr-export-btn')?.addEventListener('click', () => {
      const rows = filteredSorted();
      const headers = ['ФИО','Группа','Итоговые баллы','Кач-во','Звонков оцен.','Итог часов','База часов',
        'Техсбои','Тренинги','Офлайн','Звонки','КВЗ','Часы в звонке','Эфф. %','Штраф сумма','Штраф мин','Штраф баллы'];
      const csvRows = [headers.join(';')];
      rows.forEach(o => {
        csvRows.push([
          o.full_name, o.group_name || '', o.final_points, o.quality_avg, o.quality_calls_count,
          o.total_hours, o.base_hours, o.tech_issue_hours, o.training_hours, o.offline_activity_hours,
          o.calls_total, o.kvz, o.call_time_hours, o.efficiency_percent, o.penalty_sum, o.penalty_minutes, o.penalty_points
        ].join(';'));
      });
      const blob = new Blob(['\ufeff' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `период_${data.period.start}_${data.period.end}.csv`;
      a.click(); URL.revokeObjectURL(url);
    });

    // Save handler — открывает подтверждение сохранения (обе кнопки используют один обработчик)
    function openSaveModal() {
      showModal(`
        <h3 class="modal-title">Сохранить расчёт</h3>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px">
          Период: ${esc(data.period.start)} — ${esc(data.period.end)}. Будет сохранено ${ops.length} расчётов.
        </p>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:14px">
          <input type="checkbox" id="pr-award-coins-check">
          Начислить коины по формуле: баллы / 5 (округление вниз)
        </label>
        <div id="pr-save-err" class="status-line"></div>
        <button class="btn-primary" style="width:100%" id="pr-save-confirm-btn">Сохранить</button>
      `);
      document.getElementById('pr-save-confirm-btn').addEventListener('click', async () => {
        const awardCoins = document.getElementById('pr-award-coins-check').checked;
        const errEl = document.getElementById('pr-save-err');
        try {
          const result = await api.savePeriodReport({
            start_date: data.period.start,
            end_date: data.period.end,
            award_coins: awardCoins,
          });
          closeModal();
          swrInvalidate('period-report:');
          swrInvalidate('analytics:');
          swrInvalidate('coins:');
          swrInvalidate('rating:');
          showToast(result.message, 'ok');
          if (result.skipped_no_match?.length) {
            console.warn('Не сопоставлены с операторами в БД:', result.skipped_no_match);
          }
        } catch (e) {
          errEl.textContent = e.message;
          errEl.className = 'status-line status-error';
        }
      });
    }
    el.querySelector('#pr-save-btn')?.addEventListener('click', openSaveModal);
    el.querySelector('#pr-save-btn-top')?.addEventListener('click', openSaveModal);
  }
}

window.renderPeriodReport = renderPeriodReport;



function renderKpiBlock(summary) {
  const k = summary.kpi || {};
  const cards = [
    { label: 'Операторов в расчёте', val: k.operators_count, dec: 0 },
    { label: 'Всего звонков', val: k.total_calls, dec: 0 },
    { label: 'Среднее качество', val: k.avg_quality, dec: 2 },
    { label: 'Средний КВЗ', val: k.avg_kvz, dec: 2 },
    { label: 'Средняя эффективность', val: k.avg_efficiency, dec: 2, suf: '%' },
    { label: 'Штрафы, мин', val: k.penalty_minutes_total, dec: 1 },
    { label: 'Итог часов', val: k.total_hours, dec: 1 },
    { label: 'База часов', val: k.base_hours_total, dec: 1 },
    { label: 'Оценённых звонков', val: k.quality_calls_count, dec: 0 },
    { label: 'Операторов без оценок', val: k.operators_no_quality, dec: 0 },
  ];
  return `<div class="an-card">
    <div class="an-card-head">Главные показатели</div>
    <div class="an-kpi-grid">
      ${cards.map(c => `
        <div class="an-kpi-cell">
          <div class="an-kpi-val">${fmtA(c.val, c.dec, c.suf||'')}</div>
          <div class="an-kpi-label">${esc(c.label)}</div>
        </div>`).join('')}
    </div>
  </div>`;
}

/* ── Block: Daily dynamics chart ───────────────────────────────*/
function renderDailyDynamicsBlock(dynamics) {
  const items = dynamics.items || [];
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Динамика по дням</span>
      <div class="metric-tabs" id="an-dyn-tabs">
        <button class="metric-tab active" data-metric="calls">Звонки</button>
        <button class="metric-tab" data-metric="kvz">КВЗ</button>
        <button class="metric-tab" data-metric="operators">Операторы</button>
      </div>
    </div>
    <div id="an-dyn-chart">${renderDynChart(items, 'calls')}</div>
  </div>`;
}

function renderDynChart(items, metric) {
  if (!items.length) return '<div class="empty-line">Нет данных за период</div>';
  const field = metric === 'operators' ? 'operators_on_line' : metric;
  const vals = items.map(i => Number(i[field]) || 0);
  const maxV = Math.max(...vals, 1);
  return `<div class="an-bar-chart">
    ${items.map((it, i) => {
      const v = vals[i];
      const pct = Math.round((v / maxV) * 100);
      const label = it[field] == null ? '—' : (metric === 'kvz' ? v.toFixed(2) : Math.round(v));
      return `<div class="an-bar-row">
        <div class="an-bar-date">${esc(it.date.slice(5))}</div>
        <div class="an-bar-track"><div class="an-bar-fill" style="width:${pct}%"></div></div>
        <div class="an-bar-val">${label}</div>
      </div>`;
    }).join('')}
  </div>`;
}

/* ── Block: Operators table ────────────────────────────────────*/
function renderOperatorsTableBlock(opsTable) {
  const items = opsTable.items || [];
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Таблица эффективности операторов</span>
      <button class="btn-outline btn-sm" id="an-export-ops-btn">Экспорт CSV</button>
    </div>
    <div id="an-ops-table-wrap">${renderOpsTable(items, 'final_points', 'desc')}</div>
  </div>`;
}

function normCompletionHtml(o) {
  if (o.norm_completion_percent == null) {
    if (o.rate == null) return '<span class="cell-muted" title="Ставка не указана">—</span>';
    return '<span class="cell-muted">нет нормы</span>';
  }
  const pct = o.norm_completion_percent;
  const color = pct >= 100 ? 'var(--success)' : pct >= 80 ? 'var(--warning)' : 'var(--danger)';
  return `<span style="color:${color};font-weight:600">${pct.toFixed(1)}%</span>`;
}

function renderOpsTable(items, sortKey, sortDir) {
  if (!items.length) return '<div class="empty-line">Нет операторов, удовлетворяющих фильтрам</div>';
  const sorted = [...items].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity, bv = b[sortKey] ?? -Infinity;
    return sortDir === 'desc' ? bv - av : av - bv;
  });
  const arrow = dir => dir === 'desc' ? ' ↓' : ' ↑';
  const sortAttr = k => k === sortKey ? arrow(sortDir) : '';
  const hasNorm = items.some(o => o.individual_norm_hours != null);

  return `<div class="table-wrap"><table class="data-table">
    <thead><tr>
      <th>#</th><th>Оператор</th><th>Группа</th>
      <th class="num sortable" data-sort="calls_total">Звонки${sortAttr('calls_total')}</th>
      <th class="num">Факт ч.</th>
      ${hasNorm ? `
      <th class="num">Ставка</th>
      <th class="num sortable" data-sort="individual_norm_hours">Норма${sortAttr('individual_norm_hours')}</th>
      <th class="num sortable" data-sort="norm_completion_percent">Выполн.${sortAttr('norm_completion_percent')}</th>
      <th class="num sortable" data-sort="hours_points">Б.за ч.${sortAttr('hours_points')}</th>
      <th class="num">Перераб.</th>
      ` : ''}
      <th class="num sortable" data-sort="kvz">КВЗ${sortAttr('kvz')}</th>
      <th class="num sortable" data-sort="quality_avg">Качество${sortAttr('quality_avg')}</th>
      <th class="num sortable" data-sort="efficiency_percent">Эфф.%${sortAttr('efficiency_percent')}</th>
      <th class="num sortable" data-sort="penalty_minutes">Штраф м.${sortAttr('penalty_minutes')}</th>
      <th class="num sortable" data-sort="final_points">Итог${sortAttr('final_points')}</th>
      <th>Риск</th>
    </tr></thead>
    <tbody>
      ${sorted.map((o, i) => `
        <tr class="${i<3?'an-row-top3':''}">
          <td>${i+1}</td>
          <td class="name-cell">${esc(o.full_name)}</td>
          <td>${esc(o.group_name||'—')}</td>
          <td class="num">${fmtA(o.calls_total,0)}</td>
          <td class="num">${fmtA(o.total_hours,1)}</td>
          ${hasNorm ? `
          <td class="num">${o.rate != null ? `<span class="rate-badge ${o.rate===0.5?'rate-half':o.rate===0.75?'rate-three-q':'rate-full'}">${o.rate}</span>` : '<span class="cell-muted">—</span>'}</td>
          <td class="num">${o.individual_norm_hours != null ? fmtA(o.individual_norm_hours,1)+' ч' : '<span class="cell-muted">—</span>'}</td>
          <td class="num">${normCompletionHtml(o)}</td>
          <td class="num">${o.hours_points != null ? `<b>${fmtA(o.hours_points,1)}</b><span style="color:var(--tx3)">/25</span>` : '<span class="cell-muted">—</span>'}</td>
          <td class="num">${o.overtime_hours > 0 ? `<span style="color:var(--success)">+${fmtA(o.overtime_hours,1)}ч</span>` : '—'}</td>
          ` : ''}
          <td class="num">${fmtA(o.kvz)}</td>
          <td class="num" style="${o.quality_avg!=null?'color:'+qualityColor(o.quality_band)+';font-weight:600':''}">${o.quality_avg!=null?fmtA(o.quality_avg):'нет оценок'}</td>
          <td class="num">${fmtA(o.efficiency_percent,2,'%')}</td>
          <td class="num" style="${o.penalty_minutes>0?'color:var(--danger)':''}">${fmtA(o.penalty_minutes,1)}</td>
          <td class="num"><b>${fmtA(o.final_points)}</b></td>
          <td>${riskBadge(o.risk_status)}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

/* ── Block: Groups comparison ───────────────────────────────────*/
function renderGroupsComparisonBlock(groupsCmp) {
  const items = groupsCmp.items || [];
  if (!items.length) return `<div class="an-card"><div class="an-card-head">Сравнение групп</div><div class="empty-line">Нет данных</div></div>`;
  const maxPts = Math.max(...items.map(g => g.final_points_sum || 0), 1);
  return `<div class="an-card">
    <div class="an-card-head">Сравнение групп</div>
    <div class="an-bar-chart" style="margin-bottom:16px">
      ${items.map(g => `
        <div class="an-bar-row">
          <div class="an-bar-date" style="width:120px">${esc(g.group_name)}</div>
          <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round((g.final_points_sum/maxPts)*100)}%"></div></div>
          <div class="an-bar-val">${fmtA(g.final_points_sum,0)}</div>
        </div>`).join('')}
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>Группа</th><th class="num">Операторов</th><th class="num">Звонки</th>
        <th class="num">Качество</th><th class="num">КВЗ</th><th class="num">Эфф.%</th>
        <th class="num">Штраф мин</th><th class="num">Без оценок</th><th class="num">В риске</th>
      </tr></thead>
      <tbody>
        ${items.map(g => `<tr>
          <td class="name-cell">${esc(g.group_name)}</td>
          <td class="num">${g.operators_count}</td>
          <td class="num">${fmtA(g.total_calls,0)}</td>
          <td class="num">${fmtA(g.avg_quality)}</td>
          <td class="num">${fmtA(g.avg_kvz)}</td>
          <td class="num">${fmtA(g.avg_efficiency,2,'%')}</td>
          <td class="num">${fmtA(g.penalty_minutes,1)}</td>
          <td class="num">${g.operators_no_quality}</td>
          <td class="num" style="${g.operators_in_risk>0?'color:var(--warning)':''}">${g.operators_in_risk}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </div>`;
}

/* ── Block: Quality x KVZ scatter matrix ────────────────────────*/
let _qkMatrixData = null;
function renderQualityKvzMatrixBlock() {
  return `<div class="an-card">
    <div class="an-card-head">Матрица «Качество × КВЗ»</div>
    <div id="an-qk-matrix"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
  </div>`;
}

function drawScatter(containerId, points, xKey, yKey, xLabel, yLabel, xThreshold, yThreshold) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!points.length) { el.innerHTML = '<div class="empty-line">Нет данных для построения графика</div>'; return; }

  const W = 640, H = 400, PAD_L = 50, PAD_B = 36, PAD_T = 16, PAD_R = 16;
  const xVals = points.map(p => p[xKey]);
  const yVals = points.map(p => p[yKey]);
  const xMaxRaw = Math.max(...xVals, xThreshold||0);
  const yMaxRaw = Math.max(...yVals, yThreshold||0);
  const xMax = (xMaxRaw * 1.15) || 1;
  const yMax = (yMaxRaw * 1.15) || 1;
  const xMin = 0, yMin = 0;

  const sizeMax = Math.max(...points.map(p => p.calls_total || p.base_hours || 1), 1);

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const sx = x => PAD_L + (x - xMin) / (xMax - xMin) * plotW;
  const sy = y => H - PAD_B - (y - yMin) / (yMax - yMin) * plotH;

  // Сетка и числовые деления (5 шагов на каждой оси)
  function niceTicks(max, steps = 5) {
    const raw = max / steps;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const norm = raw / mag;
    let step;
    if (norm < 1.5) step = 1 * mag;
    else if (norm < 3) step = 2 * mag;
    else if (norm < 7) step = 5 * mag;
    else step = 10 * mag;
    const ticks = [];
    for (let v = 0; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 100) / 100);
    return ticks;
  }
  const xTicks = niceTicks(xMax);
  const yTicks = niceTicks(yMax);

  const groupColors = {};
  const palette = ['#0284C7','#16A34A','#D97706','#9333EA','#DC2626','#0891B2'];
  let colorIdx = 0;
  points.forEach(p => {
    const g = p.group_name || '—';
    if (!(g in groupColors)) groupColors[g] = palette[colorIdx++ % palette.length];
  });

  const thresholdX = xThreshold != null ? sx(xThreshold) : null;
  const thresholdY = yThreshold != null ? sy(yThreshold) : null;

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:460px" id="${containerId}-svg" font-family="Inter,sans-serif">
      <!-- Сетка по X -->
      ${xTicks.map(t => {
        const x = sx(t);
        return `<line x1="${x}" y1="${PAD_T}" x2="${x}" y2="${H-PAD_B}" stroke="var(--border-soft)" stroke-width="1"/>
          <text x="${x}" y="${H-PAD_B+16}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${t}</text>`;
      }).join('')}
      <!-- Сетка по Y -->
      ${yTicks.map(t => {
        const y = sy(t);
        return `<line x1="${PAD_L}" y1="${y}" x2="${W-PAD_R}" y2="${y}" stroke="var(--border-soft)" stroke-width="1"/>
          <text x="${PAD_L-8}" y="${y+3}" text-anchor="end" font-size="10" fill="var(--text-muted)">${t}</text>`;
      }).join('')}
      <!-- Оси -->
      <line x1="${PAD_L}" y1="${H-PAD_B}" x2="${W-PAD_R}" y2="${H-PAD_B}" stroke="var(--border-strong)" stroke-width="1.5"/>
      <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${H-PAD_B}" stroke="var(--border-strong)" stroke-width="1.5"/>
      <!-- Пороговые линии -->
      ${thresholdX != null ? `<line x1="${thresholdX}" y1="${PAD_T}" x2="${thresholdX}" y2="${H-PAD_B}" stroke="var(--warning)" stroke-width="1.2" stroke-dasharray="5,4"/>
        <text x="${thresholdX}" y="${PAD_T-2}" text-anchor="middle" font-size="9" fill="var(--warning)">${xThreshold}</text>` : ''}
      ${thresholdY != null ? `<line x1="${PAD_L}" y1="${thresholdY}" x2="${W-PAD_R}" y2="${thresholdY}" stroke="var(--warning)" stroke-width="1.2" stroke-dasharray="5,4"/>
        <text x="${W-PAD_R+2}" y="${thresholdY+3}" text-anchor="start" font-size="9" fill="var(--warning)">${yThreshold}</text>` : ''}
      <!-- Подписи осей -->
      <text x="${PAD_L + plotW/2}" y="${H-4}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--text-primary)">${esc(xLabel)}</text>
      <text x="14" y="${PAD_T + plotH/2}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--text-primary)" transform="rotate(-90,14,${PAD_T + plotH/2})">${esc(yLabel)}</text>
      <!-- Точки -->
      ${points.map(p => {
        const r = 4 + 7 * Math.sqrt((p.calls_total || p.base_hours || 1) / sizeMax);
        const color = groupColors[p.group_name || '—'];
        const cx = sx(p[xKey]), cy = sy(p[yKey]);
        const xv = typeof p[xKey] === 'number' ? (p[xKey] % 1 === 0 ? p[xKey] : p[xKey].toFixed(1)) : p[xKey];
        const yv = typeof p[yKey] === 'number' ? (p[yKey] % 1 === 0 ? p[yKey] : p[yKey].toFixed(1)) : p[yKey];
        return `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${color}" opacity="0.7" stroke="${color}" stroke-width="1.5">
            <title>${esc(p.full_name)} (${esc(p.group_name||'—')})\n${xLabel}: ${p[xKey]}\n${yLabel}: ${p[yKey]}</title>
          </circle>
          <text x="${cx}" y="${cy - r - 4}" text-anchor="middle" font-size="9" fill="var(--text-secondary)" font-weight="600">${yv}</text>`;
      }).join('')}
    </svg>
    <div class="an-legend">
      ${Object.entries(groupColors).map(([g,c]) => `<span class="an-legend-item"><span class="an-legend-dot" style="background:${c}"></span>${esc(g)}</span>`).join('')}
    </div>`;
}

/* ── Block: Top / Attention ─────────────────────────────────────*/
function renderTopAttentionBlock(topAttn) {
  function topList(title, items, suffix='') {
    if (!items || !items.length) return `<div class="an-top-col"><div class="an-top-title">${esc(title)}</div><div class="empty-line">Нет данных</div></div>`;
    return `<div class="an-top-col">
      <div class="an-top-title">${esc(title)}</div>
      ${items.map((it,i) => `<div class="an-top-row">
        <span class="an-top-rank">${i+1}</span>
        <span class="an-top-name">${esc(it.full_name)}</span>
        <span class="an-top-val">${fmtA(it.value)}${suffix}</span>
      </div>`).join('')}
    </div>`;
  }

  const attn = topAttn.attention_zone || [];

  return `<div class="an-card">
    <div class="an-card-head">Топ операторов</div>
    <div class="an-top-grid">
      ${topList('По итоговым баллам', topAttn.top_final_points)}
      ${topList('По качеству', topAttn.top_quality)}
      ${topList('По КВЗ', topAttn.top_kvz)}
      ${topList('По эффективности', topAttn.top_efficiency, '%')}
    </div>
  </div>
  <div class="an-card">
    <div class="an-card-head" style="color:var(--warning)">Зона внимания (${attn.length})</div>
    ${attn.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Оператор</th><th>Группа</th><th>Причина</th></tr></thead>
      <tbody>
        ${attn.map(a => `<tr>
          <td class="name-cell">${esc(a.full_name)}</td>
          <td>${esc(a.group_name||'—')}</td>
          <td style="color:var(--warning)">${esc(a.reason)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : '<div class="empty-line">Операторов в зоне внимания нет</div>'}
  </div>`;
}

/* ── Block: Penalties analytics ─────────────────────────────────*/
function renderPenaltiesBlock(penalties) {
  const ops = penalties.operators || [];
  const byReason = penalties.by_reason || [];
  const maxMin = Math.max(...byReason.map(r=>r.minutes), 1);
  return `<div class="an-card">
    <div class="an-card-head">Аналитика штрафов</div>
    <div class="an-kpi-grid" style="margin-bottom:16px">
      <div class="an-kpi-cell"><div class="an-kpi-val">${fmtA(penalties.total_penalty_minutes,1)}</div><div class="an-kpi-label">Всего штрафов, мин</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val">${penalties.operators_with_penalty_count}</div><div class="an-kpi-label">Операторов со штрафами</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val">${fmtA(penalties.avg_penalty_per_operator,1)}</div><div class="an-kpi-label">Средний штраф/оператор</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val" style="color:var(--danger)">${fmtA(penalties.total_points_lost,1)}</div><div class="an-kpi-label">Потеря баллов</div></div>
    </div>
    ${byReason.length ? `<div class="an-bar-chart" style="margin-bottom:16px">
      ${byReason.map(r => `<div class="an-bar-row">
        <div class="an-bar-date" style="width:200px">${esc(r.reason)}</div>
        <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round((r.minutes/maxMin)*100)}%;background:var(--danger)"></div></div>
        <div class="an-bar-val">${fmtA(r.minutes,1)} мин</div>
      </div>`).join('')}
    </div>` : ''}
    ${ops.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Оператор</th><th>Группа</th><th class="num">Сумма</th><th class="num">Минуты</th><th class="num">Потеря баллов</th></tr></thead>
      <tbody>${ops.map(o => `<tr>
        <td class="name-cell">${esc(o.full_name)}</td><td>${esc(o.group_name||'—')}</td>
        <td class="num">${fmtA(o.penalty_sum,0)}</td>
        <td class="num" style="color:var(--danger)">${fmtA(o.penalty_minutes,1)}</td>
        <td class="num" style="color:var(--danger)">-${fmtA(o.penalty_points,1)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty-line">Штрафов за период нет</div>'}
  </div>`;
}

/* ── Block: Points breakdown (waterfall-style) ───────────────────*/
function renderPointsBreakdownBlock(breakdown) {
  const items = (breakdown.items || []).slice(0, 10);
  return `<div class="an-card">
    <div class="an-card-head">Вклад показателей в итоговый балл (топ-10)</div>
    ${items.length ? items.map(o => renderBreakdownRow(o)).join('') : '<div class="empty-line">Нет данных</div>'}
  </div>`;
}

function renderBreakdownRow(o) {
  const parts = [
    { label: 'Качество', val: o.quality_contribution, color: '#0284C7' },
    { label: 'КВЗ', val: o.kvz_contribution, color: '#16A34A' },
    { label: 'Часы', val: o.hours_contribution, color: '#9333EA' },
    { label: 'Эфф.', val: o.efficiency_contribution, color: '#D97706' },
    { label: 'Штрафы', val: o.penalty_contribution, color: '#DC2626' },
  ];
  const maxAbs = Math.max(...parts.map(p => Math.abs(p.val)), 1);
  return `<div class="an-breakdown-row">
    <div class="an-breakdown-name">${esc(o.full_name)} <span style="color:var(--text-muted);font-weight:400">(${esc(o.group_name||'—')})</span></div>
    <div class="an-breakdown-bars">
      ${parts.map(p => `<div class="an-bd-seg" title="${p.label}: ${fmtA(p.val)}">
        <span class="an-bd-label">${p.label}</span>
        <div class="an-bd-track"><div class="an-bd-fill" style="width:${Math.min(100,Math.abs(p.val)/maxAbs*100)}%;background:${p.color}"></div></div>
        <span class="an-bd-val" style="${p.val<0?'color:var(--danger)':''}">${p.val>=0?'+':''}${fmtA(p.val,1)}</span>
      </div>`).join('')}
    </div>
    <div class="an-breakdown-total">Итог: <b>${fmtA(o.final_points)}</b></div>
  </div>`;
}

/* ── Block: Heatmap by day ───────────────────────────────────────*/
function renderHeatmapBlock() {
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Тепловая карта по дням</span>
      <div class="metric-tabs" id="an-heatmap-tabs">
        <button class="metric-tab active" data-metric="quality">Качество</button>
        <button class="metric-tab" data-metric="calls">Звонки</button>
        <button class="metric-tab" data-metric="kvz">КВЗ</button>
        <button class="metric-tab" data-metric="efficiency">Эфф.</button>
        <button class="metric-tab" data-metric="penalty">Штрафы</button>
      </div>
    </div>
    <div id="an-heatmap-body"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
  </div>`;
}

// Преобразует число 0..1 в мягкий цвет по градиенту красный→жёлтый→зелёный (HSL, низкая насыщенность)
function softGradientColor(t) {
  t = Math.max(0, Math.min(1, t));
  // HSL hue: 0 (красный) -> 50 (жёлтый) -> 142 (зелёный)
  const hue = t < 0.5 ? (t / 0.5) * 50 : 50 + ((t - 0.5) / 0.5) * 92;
  return `hsl(${hue.toFixed(0)}, 62%, 78%)`;
}

function heatColor(metric, v, ctx) {
  if (v === null || v === undefined) return 'var(--bg-muted)';

  if (metric === 'penalty') {
    // Штрафы: 0 — нейтрально-зелёный мягкий, дальше темнее к красному, без скачков
    if (v === 0) return 'hsl(142, 45%, 82%)';
    const maxRef = Math.max(ctx?.maxVal || 30, 20);
    const t = Math.min(1, v / maxRef);
    // инвертируем: больше штраф — краснее
    return softGradientColor(1 - t);
  }

  if (metric === 'quality' || metric === 'efficiency') {
    // Шкала 0-100, фиксированная и предсказуемая
    const t = Math.max(0, Math.min(1, v / 100));
    return softGradientColor(t);
  }

  // calls / kvz — нет фиксированного максимума, используем относительный масштаб
  // по диапазону значений в текущей таблице (min..max), без ложного "всё красное"
  const minV = ctx?.minVal ?? 0;
  const maxV = ctx?.maxVal ?? (v || 1);
  if (maxV <= minV) return softGradientColor(0.6);
  const t = (v - minV) / (maxV - minV);
  return softGradientColor(t);
}

function renderHeatmapTable(data, metric) {
  const dates = data.dates || [];
  const operators = data.operators || [];
  if (!operators.length || !dates.length) return '<div class="empty-line">Нет данных для тепловой карты</div>';

  // Считаем диапазон значений по всей таблице для относительного масштаба (calls/kvz)
  let allVals = [];
  operators.forEach(op => dates.forEach(d => {
    const v = op.values[d];
    if (v !== null && v !== undefined) allVals.push(v);
  }));
  const ctx = {
    minVal: allVals.length ? Math.min(...allVals) : 0,
    maxVal: allVals.length ? Math.max(...allVals) : 1,
  };

  return `<div class="an-heatmap-wrap"><table class="an-heatmap-table">
    <thead><tr><th class="an-heatmap-name-col">Оператор</th>
      ${dates.map(d => `<th>${esc(d.slice(5))}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${operators.map(op => `<tr>
        <td class="an-heatmap-name-col name-cell">${esc(op.full_name)}</td>
        ${dates.map(d => {
          const v = op.values[d];
          const bg = heatColor(metric, v, ctx);
          const label = v == null ? '—' : (metric==='kvz'||metric==='penalty' ? v.toFixed(1) : Math.round(v));
          return `<td class="an-heatmap-cell" style="background:${bg}" title="${esc(op.full_name)} ${d}: ${v==null?'нет данных':label}">${label}</td>`;
        }).join('')}
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}


/* ── Block: Risk pyramid ─────────────────────────────────────────*/
function renderRiskPyramidBlock(riskPyramid) {
  const statuses = [
    { key: 'stable', label: 'Стабильные', icon: '🟢' },
    { key: 'watch', label: 'Нужен контроль', icon: '🟡' },
    { key: 'critical', label: 'Критично', icon: '🔴' },
    { key: 'no_data', label: 'Нет данных', icon: '⚪' },
  ];
  return `<div class="an-card">
    <div class="an-card-head">Пирамида риска операторов</div>
    <div class="an-risk-grid">
      ${statuses.map(s => {
        const bucket = riskPyramid[s.key] || { count: 0, operators: [] };
        return `<div class="an-risk-cell" data-risk-status="${s.key}">
          <div class="an-risk-icon">${s.icon}</div>
          <div class="an-risk-count">${bucket.count}</div>
          <div class="an-risk-label">${s.label}</div>
        </div>`;
      }).join('')}
    </div>
    <div id="an-risk-detail"></div>
  </div>`;
}

/* ── Block: Quality coverage dashboard ─────────────────────────────*/
function renderQualityCoverageBlock(coverage) {
  const byGroup = coverage.by_group || [];
  const withoutQ = coverage.without_quality || [];
  return `<div class="an-card">
    <div class="an-card-head">Дашборд качества прослушки</div>
    <div class="an-kpi-grid" style="margin-bottom:16px">
      <div class="an-kpi-cell"><div class="an-kpi-val">${coverage.total_evaluated_calls}</div><div class="an-kpi-label">Оценённых звонков</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val">${fmtA(coverage.avg_evaluations_per_operator,1)}</div><div class="an-kpi-label">Среднее оценок/оператора</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val" style="color:var(--warning)">${coverage.operators_without_quality_count}</div><div class="an-kpi-label">Без оценок</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val" style="font-size:14px">${esc(coverage.best_coverage_group||'—')}</div><div class="an-kpi-label">Лучшее покрытие</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val" style="font-size:14px">${esc(coverage.worst_coverage_group||'—')}</div><div class="an-kpi-label">Худшее покрытие</div></div>
    </div>
    ${byGroup.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Группа</th><th class="num">Операторов</th><th class="num">Оцен. звонков</th><th class="num">Среднее/опер.</th><th class="num">Без оценок</th><th class="num">Ср. качество</th></tr></thead>
      <tbody>${byGroup.map(g => `<tr>
        <td class="name-cell">${esc(g.group_name)}</td>
        <td class="num">${g.operators_count}</td>
        <td class="num">${g.evaluated_calls}</td>
        <td class="num">${fmtA(g.avg_evaluations_per_operator,1)}</td>
        <td class="num">${g.operators_without_quality}</td>
        <td class="num">${fmtA(g.avg_quality)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : ''}
    ${withoutQ.length ? `<div style="margin-top:16px">
      <div class="an-sub-title">Операторы без оценки качества (${withoutQ.length})</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Оператор</th><th>Группа</th><th class="num">База ч.</th><th class="num">Звонки</th></tr></thead>
        <tbody>${withoutQ.map(o => `<tr>
          <td class="name-cell">${esc(o.full_name)}</td><td>${esc(o.group_name||'—')}</td>
          <td class="num">${fmtA(o.base_hours,1)}</td><td class="num">${fmtA(o.calls_total,0)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}
  </div>`;
}

/* ── Block: Load vs Efficiency scatter ─────────────────────────────*/
function renderLoadEfficiencyBlock(loadEff) {
  return `<div class="an-card">
    <div class="an-card-head">Нагрузка и эффективность</div>
    <div id="an-load-eff-matrix"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
  </div>`;
}

/* ── Block: Future KPI (placeholder) ───────────────────────────────*/
function renderFutureKpiBlock() {
  const future = ['AHT — среднее время обработки', 'ASA — среднее время ожидания ответа', 'Service Level',
    'Abandonment Rate', 'FCR', 'CSAT / NPS', 'Occupancy'];
  return `<div class="an-card">
    <div class="an-card-head">Будущие метрики</div>
    <div class="an-future-grid">
      ${future.map(f => `<div class="an-future-item">
        <div class="an-future-name">${esc(f)}</div>
        <div class="an-future-status">Недоступно: нет данных из телефонии / CRM</div>
      </div>`).join('')}
    </div>
  </div>`;
}

/* ── Block: Warnings ────────────────────────────────────────────────*/
function renderAnalyticsWarningsBlock(warnings) {
  if (!warnings) return '';
  const w = warnings;
  const total = (w.site_only?.length||0)+(w.file_only?.length||0)+(w.no_quality?.length||0)+(w.no_base_hours?.length||0);
  if (!total) return '';

  function chipGroup(title, items) {
    if (!items || !items.length) return '';
    return `<div class="pr-warn-group">
      <div class="pr-warn-group-title">${esc(title)} (${items.length})</div>
      <div class="pr-warn-chips">${items.slice(0,30).map(n=>`<span class="pr-warn-chip">${esc(n)}</span>`).join('')}
      ${items.length>30?`<span class="pr-warn-chip pr-warn-chip-more">+${items.length-30}</span>`:''}</div>
    </div>`;
  }

  return `<div class="an-card">
    <div class="an-card-head">Предупреждения по данным (${total})</div>
    ${chipGroup('Есть на сайте, но отсутствуют в файле', w.site_only)}
    ${chipGroup('Есть в файле, но отсутствуют на сайте', w.file_only)}
    ${chipGroup('Нет оценок качества', w.no_quality)}
    ${chipGroup('Нет базы часов', w.no_base_hours)}
  </div>`;
}

/* ── Wiring: interactions for tabs, scatter plots, exports ──────────*/
/* ══════════════════════════════════════
   VIEW: АНАЛИТИКА — с горизонтальными табами
══════════════════════════════════════ */
/* ══════════════════════════════════════
   ФОНОВЫЙ ПРОГРЕВ КЕША АНАЛИТИКИ
   Запускается через 3с после входа admin/manager.
   Загружает данные в sessionStorage-кеш тихо, в фоне.
   Когда пользователь откроет Аналитику — данные уже там.
══════════════════════════════════════ */
async function prefetchAnalyticsInBackground() {
  // Не запускаем если сейчас открыта Аналитика — там и так грузятся данные
  if (STATE.currentView === 'analytics') return;

  // Определяем период: берём последний доступный из already-loaded данных
  // или стандартно — последние 30 дней
  let startDate, endDate;
  try {
    const periods = await fetch(api._base() + '/api/analytics/available-periods', {
      credentials: 'include'
    }).then(r => r.ok ? r.json() : null).catch(() => null);

    if (periods?.items?.length) {
      _analyticsState.availablePeriods = periods.items;
      // Берём самый свежий период из уже рассчитанных
      const latest = periods.items[0];
      startDate = latest.start_date;
      endDate   = latest.end_date;
    } else {
      // Нет готовых расчётов — берём текущий месяц
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      startDate = new Date(y, m, 1).toISOString().slice(0, 10);
      endDate   = now.toISOString().slice(0, 10);
    }
  } catch {
    return; // Не удалось получить периоды — тихо выходим
  }

  // Обновляем _analyticsState чтобы при открытии Аналитики даты совпали
  if (!_analyticsState.startDate) {
    _analyticsState.startDate = startDate;
    _analyticsState.endDate   = endDate;
  }

  const base = { start_date: startDate, end_date: endDate };
  const full = { ...base };

  // Грузим все основные вкладки параллельно, тихо — ошибки игнорируем
  // Приоритет: сначала Обзор (самая частая), потом остальные
  const prefetchQueue = [
    () => analyticsFetch('overview',            full),
    () => analyticsFetch('operators-combined',  full),
    () => analyticsFetch('groups-comparison',   base),
    () => analyticsFetch('matrix-combined',     base),
    () => analyticsFetch('quality-combined',    base),
    () => analyticsFetch('risk-pyramid',        base),
    () => analyticsFetch('penalties',           base),
    () => analyticsFetch('points',              full),
  ];

  // Запускаем с небольшими задержками — не грузим сервер сразу всеми запросами
  for (let i = 0; i < prefetchQueue.length; i++) {
    // Прерываем если пользователь ушёл — его данные уже загружает renderAnalytics
    if (STATE.currentView === 'analytics') break;
    await new Promise(r => setTimeout(r, 400)); // 400мс между запросами
    prefetchQueue[i]().catch(() => {}); // тихо, без throw
  }
}

const ANALYTICS_TABS = [
  { key: 'overview',   label: 'Обзор' },
  { key: 'operators',  label: 'Операторы' },
  { key: 'groups',     label: 'Группы' },
  { key: 'matrix',     label: 'Матрицы' },
  { key: 'quality',    label: 'Качество' },
  { key: 'dynamics',   label: 'Динамика' },
  { key: 'penalties',  label: 'Штрафы' },
  { key: 'risks',      label: 'Риски' },
  { key: 'points',     label: 'Баллы' },
  { key: 'export',     label: 'Экспорт' },
];

function getAnalyticsParams() {
  const qs = new URLSearchParams(location.hash.replace(/^#analytics\??/, ''));
  return {
    tab: qs.get('tab') || 'overview',
    start: qs.get('start') || null,
    end: qs.get('end') || null,
    group: qs.get('group') || '',
    operator: qs.get('operator') || '',
    participation: qs.get('participation') || 'all',
    onlyData: qs.get('onlyData') === '1',
  };
}

function setAnalyticsUrl(params) {
  const qs = new URLSearchParams();
  qs.set('tab', params.tab);
  if (params.start) qs.set('start', params.start);
  if (params.end) qs.set('end', params.end);
  if (params.group) qs.set('group', params.group);
  if (params.operator) qs.set('operator', params.operator);
  if (params.participation && params.participation !== 'all') qs.set('participation', params.participation);
  if (params.onlyData) qs.set('onlyData', '1');
  history.replaceState(null, '', '#analytics?' + qs.toString());
}

let _analyticsState = {
  tab: 'overview',
  startDate: null,
  endDate: null,
  groupId: '',
  operatorQuery: '',
  participationStatus: 'all',
  onlyWithData: false,
  groups: [],
  availablePeriods: [],
};

function analyticsApiUrl(path, params) {
  const qs = new URLSearchParams(params).toString();
  return api._base() + '/api/analytics/' + path + (qs ? '?' + qs : '');
}

const ANALYTICS_SWR_TTL_MS = 10 * 60_000; // 10 минут — данные построены из PeriodReport, меняются очень редко

async function analyticsFetch(path, params, onUpdate) {
  const key = 'analytics:' + path + ':' + JSON.stringify(params || {});
  return swrFetch(key, async () => {
    const res = await fetch(analyticsApiUrl(path, params), { credentials: 'include' });
    // Сначала читаем как текст — backend при 500 может вернуть обычный
    // текст ("Internal Server Error"), а не JSON; res.json() в этом случае
    // падает с "Unexpected token 'I'..." вместо понятной ошибки пользователю.
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text?.slice(0, 200) || `Ошибка ${res.status}`);
    }
    if (!res.ok) {
      const msg = data.detail || data.error || `Ошибка ${res.status}`;
      const error = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      error.status = res.status;
      throw error;
    }
    return data;
  }, onUpdate, ANALYTICS_SWR_TTL_MS);
}

async function resolveInitialAnalyticsPeriod(urlParams) {
  let periods = [];
  try {
    const data = await analyticsFetch('available-periods', {});
    periods = Array.isArray(data?.items) ? data.items : [];
  } catch { /* the regular empty state will explain unavailable data */ }

  _analyticsState.availablePeriods = periods;
  const requestedStart = urlParams.start;
  const requestedEnd = urlParams.end;
  const requestedHasData = requestedStart && requestedEnd && periods.some(period =>
    requestedStart <= period.end_date && requestedEnd >= period.start_date
  );

  if (requestedHasData) return { start: requestedStart, end: requestedEnd };
  if (periods.length) return { start: periods[0].start_date, end: periods[0].end_date };
  if (requestedStart && requestedEnd) return { start: requestedStart, end: requestedEnd };

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  return { start: weekAgo.toISOString().slice(0, 10), end: today.toISOString().slice(0, 10) };
}

function fmtA(v, decimals = 2, suffix = '') {
  if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '—';
  return Number(v).toFixed(decimals) + suffix;
}

function qualityColor(band) {
  return { green: 'var(--success)', yellow: '#D97706', orange: '#EA580C', red: 'var(--danger)' }[band] || 'var(--text-muted)';
}

function riskBadge(status) {
  const map = {
    stable: { label: 'Стабильно', color: 'var(--success)', bg: 'var(--success-soft)' },
    watch: { label: 'Контроль', color: 'var(--warning)', bg: 'var(--warning-soft)' },
    critical: { label: 'Критично', color: 'var(--danger)', bg: 'var(--danger-soft)' },
    no_data: { label: 'Нет данных', color: 'var(--text-muted)', bg: 'var(--bg-muted)' },
  };
  const r = map[status] || map.no_data;
  return `<span class="risk-badge" style="color:${r.color};background:${r.bg}">${r.label}</span>`;
}

async function renderAnalytics() {
  const el = document.getElementById('view-analytics');
  if (!el) return;
  const myNavGen = STATE.navGen;

  const urlParams = getAnalyticsParams();

  if (!_analyticsState.startDate) {
    const initialPeriod = await resolveInitialAnalyticsPeriod(urlParams);
    if (isNavStale(myNavGen)) return;
    _analyticsState.startDate = initialPeriod.start;
    _analyticsState.endDate = initialPeriod.end;
    _analyticsState.tab = urlParams.tab;
    _analyticsState.groupId = urlParams.group;
    _analyticsState.operatorQuery = urlParams.operator;
    _analyticsState.participationStatus = urlParams.participation;
    _analyticsState.onlyWithData = urlParams.onlyData;
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Аналитика</div><h2 class="section-title">Управленческая аналитика</h2></div>
    </div>
    <div class="an-filters-card">
      <div class="an-filters-row">
        <div class="form-group">
          <label class="form-label">Период с</label>
          <input id="an-start" type="date" class="form-input" value="${_analyticsState.startDate}">
        </div>
        <div class="form-group">
          <label class="form-label">по</label>
          <input id="an-end" type="date" class="form-input" value="${_analyticsState.endDate}">
        </div>
        <div class="form-group">
          <label class="form-label">Группа</label>
          <select id="an-group" class="form-select"><option value="">Все группы</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">Оператор</label>
          <input id="an-operator" type="text" class="form-input" placeholder="Поиск по ФИО" value="${esc(_analyticsState.operatorQuery)}">
        </div>
        <div class="form-group">
          <label class="form-label">Статус участия</label>
          <select id="an-participation" class="form-select">
            <option value="all">Все</option>
            <option value="participating">Участвует</option>
            <option value="not_participating">Не участвует</option>
          </select>
        </div>
        <label class="an-checkbox-label">
          <input type="checkbox" id="an-only-data" ${_analyticsState.onlyWithData ? 'checked' : ''}>
          Только с данными
        </label>
        <button class="btn-primary" id="an-apply-btn">Применить</button>
      </div>
      ${_analyticsState.availablePeriods.length ? `<div class="an-period-availability">Доступные данные: ${esc(_analyticsState.availablePeriods[0].label)}</div>` : ''}
      <div id="an-availability-warning"></div>
    </div>

    <div class="analytics-tabs" id="an-tabs">
      ${ANALYTICS_TABS.map(t => `<button class="analytics-tab ${t.key===_analyticsState.tab?'active':''}" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
    </div>

    <div id="an-tab-content" class="analytics-tab-content">
      <div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>
    </div>
  `;

  try {
    const gdata = await analyticsFetch('groups-list', {});
    if (isNavStale(myNavGen)) return; // ушли с "Аналитики" пока ждали список групп
    _analyticsState.groups = gdata.items || [];
    const sel = el.querySelector('#an-group');
    sel.innerHTML = '<option value="">Все группы</option>' +
      _analyticsState.groups.map(g => `<option value="${g.id}" ${String(g.id)===_analyticsState.groupId?'selected':''}>${esc(g.name)}</option>`).join('');
  } catch(e) { /* groups list optional */ }
  if (isNavStale(myNavGen)) return;

  el.querySelector('#an-participation').value = _analyticsState.participationStatus;

  function syncStateFromFilters() {
    _analyticsState.startDate = el.querySelector('#an-start').value;
    _analyticsState.endDate = el.querySelector('#an-end').value;
    _analyticsState.groupId = el.querySelector('#an-group').value;
    _analyticsState.operatorQuery = el.querySelector('#an-operator').value;
    _analyticsState.participationStatus = el.querySelector('#an-participation').value;
    _analyticsState.onlyWithData = el.querySelector('#an-only-data').checked;
  }

  function updateUrl() {
    setAnalyticsUrl({
      tab: _analyticsState.tab,
      start: _analyticsState.startDate,
      end: _analyticsState.endDate,
      group: _analyticsState.groupId,
      operator: _analyticsState.operatorQuery,
      participation: _analyticsState.participationStatus,
      onlyData: _analyticsState.onlyWithData,
    });
  }

  el.querySelector('#an-apply-btn').addEventListener('click', () => {
    syncStateFromFilters();
    updateUrl();
    loadAnalyticsTab(_analyticsState.tab);
  });

  // Tab click handling + prefetch on hover
  el.querySelectorAll('.analytics-tab').forEach(btn => {
    // Prefetch при наведении — данные загружаются в кеш до клика
    btn.addEventListener('mouseenter', () => {
      const tab = btn.dataset.tab;
      if (tab === _analyticsState.tab) return;
      const base = analyticsBaseParams();
      const full = analyticsOpParams();
      switch(tab) {
        case 'overview':   analyticsFetch('overview', full).catch(() => {}); break;
        case 'operators':  analyticsFetch('operators-combined', full).catch(() => {}); break;
        case 'groups':     analyticsFetch('groups-comparison', base).catch(() => {}); break;
        case 'matrix':     analyticsFetch('matrix-combined', base).catch(() => {}); break;
        case 'quality':    analyticsFetch('quality-combined', base).catch(() => {}); break;
        case 'penalties':  analyticsFetch('penalties', base).catch(() => {}); break;
        case 'risks':      analyticsFetch('risk-pyramid', base).catch(() => {}); break;
        case 'points':     analyticsFetch('points', full).catch(() => {}); break;
      }
    }, { passive: true });
    btn.addEventListener('click', () => {
      el.querySelectorAll('.analytics-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _analyticsState.tab = btn.dataset.tab;
      updateUrl();
      loadAnalyticsTab(_analyticsState.tab);
    });
  });

  updateUrl();
  if (isNavStale(myNavGen)) return;
  await loadAnalyticsTab(_analyticsState.tab);
}

function analyticsBaseParams() {
  const s = _analyticsState;
  const p = { start_date: s.startDate, end_date: s.endDate };
  if (s.groupId) p.group_id = s.groupId;
  return p;
}
function analyticsOpParams() {
  const s = _analyticsState;
  const p = analyticsBaseParams();
  if (s.operatorQuery) p.operator_query = s.operatorQuery;
  if (s.participationStatus !== 'all') p.participation_status = s.participationStatus;
  if (s.onlyWithData) p.only_with_data = 'true';
  return p;
}

/* ── Ленивая загрузка по активной вкладке ─────────────────── */
/**
 * Запрашивает /summary только для получения data_availability_warning
 * (см. backend ТЗ п.8) и показывает понятное предупреждение прямо под
 * фильтрами — независимо от того, какая вкладка аналитики сейчас открыта.
 */
async function refreshAvailabilityWarning() {
  const box = document.getElementById('an-availability-warning');
  if (!box) return;
  try {
    const summary = await analyticsFetch('summary', analyticsOpParams());
    const msg = summary.data_availability_warning;
    box.innerHTML = msg
      ? `<div class="an-availability-note">${esc(msg)}</div>`
      : '';
  } catch(e) {
    // Если /summary вернул 404 (совсем нет данных) — analyticsFetch бросит
    // ошибку с тем же текстом, что и data_availability_warning на backend.
    box.innerHTML = `<div class="an-availability-note an-availability-note-error">${esc(e.message)}</div>`;
  }
}

async function loadAnalyticsTab(tab) {
  const content = document.getElementById('an-tab-content');
  if (!content) return;
  const myNavGen = STATE.navGen;
  const myTabGen = bumpAnalyticsTabGen();
  // warning обновляется вместе с данными вкладки (в loadOverviewTab) без отдельного запроса
  // Спиннер показываем с небольшой задержкой (150мс) — если данные придут
  // из кеша почти мгновенно (swrFetch отдаёт их синхронно из sessionStorage),
  // спиннер просто не успеет появиться, и переключение вкладок будет
  // выглядеть мгновенным вместо "мигающего лоадера на каждый клик".
  let spinnerShown = false;
  const spinnerTimer = setTimeout(() => {
    if (isNavStale(myNavGen) || isAnalyticsTabStale(myTabGen)) return;
    spinnerShown = true;
    content.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Считаем показатели…</p></div>';
  }, 150);

  try {
    switch (tab) {
      case 'overview':  await loadOverviewTab(content); break;
      case 'operators': await loadOperatorsTab(content); break;
      case 'groups':    await loadGroupsTab(content); break;
      case 'matrix':    await loadMatrixTab(content); break;
      case 'quality':   await loadQualityTab(content); break;
      case 'dynamics':  await loadDynamicsTab(content); break;
      case 'penalties': await loadPenaltiesTab(content); break;
      case 'risks':     await loadRisksTab(content); break;
      case 'points':    await loadPointsTab(content); break;
      case 'export':    await loadExportTab(content); break;
      default: content.innerHTML = '<div class="empty-line">Вкладка не найдена</div>';
    }
  } catch(e) {
    clearTimeout(spinnerTimer);
    if (isNavStale(myNavGen) || isAnalyticsTabStale(myTabGen)) return;
    content.innerHTML = `<div class="an-card"><div class="status-line status-error">Не удалось загрузить: ${esc(e.message)}</div></div>`;
    return;
  }
  clearTimeout(spinnerTimer);
  if (isNavStale(myNavGen) || isAnalyticsTabStale(myTabGen)) {
    content.innerHTML = '';
  }
}

/* ── Вкладка: Обзор ──────────────────────────────────────────*/
async function loadOverviewTab(content) {
  // Один комбинированный запрос вместо 4 отдельных (summary + groups + risks)
  // daily-dynamics грузится параллельно и независимо — не блокирует рендер
  const [overview, dynamics] = await Promise.all([
    analyticsFetch('overview', analyticsOpParams()),
    analyticsFetch('daily-dynamics', { ...analyticsBaseParams(), metric: 'calls' }).catch(() => ({ items: [] })),
  ]);

  // Обновляем warning под фильтрами без лишнего запроса
  const warnBox = document.getElementById('an-availability-warning');
  if (warnBox && overview.data_availability_warning) {
    warnBox.innerHTML = `<div class="an-availability-note">${esc(overview.data_availability_warning)}</div>`;
  } else if (warnBox) {
    warnBox.innerHTML = '';
  }

  content.innerHTML =
    renderKpiBlock(overview) +
    '<div class="an-grid-2">' +
      '<div class="an-card"><div class="an-card-head">Динамика звонков</div><div id="an-ov-dyn">' + renderDynChart(dynamics.items||[], 'calls') + '</div></div>' +
      '<div class="an-card"><div class="an-card-head">Сравнение групп по баллам</div>' + renderMiniGroupsChart(overview.groups_comparison||[]) + '</div>' +
    '</div>' +
    renderMiniRiskPyramid(overview.risk_pyramid||{}) +
    renderAnalyticsWarningsBlock(overview.warnings||[]);

  if (!overview.kpi || overview.kpi.operators_count === 0) {
    content.innerHTML = renderAnalyticsEmptyState() + content.innerHTML;
  }
}

function renderMiniGroupsChart(items) {
  if (!items.length) return '<div class="empty-line">Нет данных</div>';
  const maxPts = Math.max(...items.map(g => g.final_points_sum || 0), 1);
  return `<div class="an-bar-chart">
    ${items.slice(0,6).map(g => `<div class="an-bar-row">
      <div class="an-bar-date" style="width:110px">${esc(g.group_name)}</div>
      <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round((g.final_points_sum/maxPts)*100)}%"></div></div>
      <div class="an-bar-val">${fmtA(g.final_points_sum,0)}</div>
    </div>`).join('')}
  </div>`;
}

function renderMiniRiskPyramid(riskPyramid) {
  const statuses = [
    { key: 'stable', label: 'Стабильные', icon: '🟢' },
    { key: 'watch', label: 'Нужен контроль', icon: '🟡' },
    { key: 'critical', label: 'Критично', icon: '🔴' },
    { key: 'no_data', label: 'Нет данных', icon: '⚪' },
  ];
  return `<div class="an-card">
    <div class="an-card-head">Состояние команды</div>
    <div class="an-risk-grid">
      ${statuses.map(s => {
        const bucket = riskPyramid[s.key] || { count: 0 };
        return `<div class="an-risk-cell" style="cursor:default">
          <div class="an-risk-icon">${s.icon}</div>
          <div class="an-risk-count">${bucket.count}</div>
          <div class="an-risk-label">${s.label}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderAnalyticsEmptyState() {
  return `<div class="an-card"><div class="an-empty-state">
    <div class="an-empty-icon">📊</div>
    <div class="an-empty-title">Нет данных для аналитики</div>
    <div class="an-empty-sub">Загрузите файлы Report и Monthly Report в разделе «Расчёт периода»</div>
    <button class="btn-primary btn-sm" onclick="navigateTo('period-report')" style="margin-top:12px">Перейти к загрузке файлов</button>
  </div></div>`;
}

/* ── Вкладка: Операторы (таблица эффективности + зона внимания) ─*/
async function loadOperatorsTab(content) {
  // Один комбинированный запрос вместо 2
  const combined = await analyticsFetch('operators-combined', analyticsOpParams());
  const opsTable = { items: combined.items || [] };
  const topAttn = combined.top_and_attention || {};

  content.innerHTML =
    renderOperatorsTableBlock(opsTable) +
    renderAttentionZoneTableBlock(topAttn.attention_zone || []);

  bindOpsTableSort(opsTable.items || []);

  content.querySelector('#an-export-ops-btn')?.addEventListener('click', () => exportOperatorsCsv(opsTable.items || []));
}

function renderAttentionZoneTableBlock(items) {
  function recommendation(reason) {
    if (reason.includes('качество')) return 'Провести разбор звонков';
    if (reason.includes('КВЗ')) return 'Поставить контрольную точку';
    if (reason.includes('эффективность')) return 'Проверить загрузку оператора';
    if (reason.includes('штраф')) return 'Проверить дисциплину';
    if (reason.includes('нет оценок')) return 'Проверить отсутствие оценок';
    if (reason.includes('нет базы')) return 'Проверить корректность табеля';
    return '—';
  }
  return `<div class="an-card">
    <div class="an-card-head" style="color:var(--warning)">Зона внимания (${items.length})</div>
    ${items.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Оператор</th><th>Группа</th><th>Проблемный показатель</th><th>Причина</th><th>Рекомендация</th></tr></thead>
      <tbody>${items.map(a => `<tr>
        <td class="name-cell">${esc(a.full_name)}</td>
        <td>${esc(a.group_name||'—')}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${esc(a.reason.split(',')[0])}</td>
        <td style="color:var(--warning);font-size:12px">${esc(a.reason)}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${esc(recommendation(a.reason))}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty-line">Операторов в зоне внимания нет</div>'}
  </div>`;
}

function bindOpsTableSort(items) {
  let curSortKey = 'final_points', curSortDir = 'desc';
  const wrap = document.getElementById('an-ops-table-wrap');
  function bind() {
    document.querySelectorAll('#an-ops-table-wrap .sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (curSortKey === key) curSortDir = curSortDir === 'desc' ? 'asc' : 'desc';
        else { curSortKey = key; curSortDir = 'desc'; }
        wrap.innerHTML = renderOpsTable(items, curSortKey, curSortDir);
        bind();
      });
    });
  }
  bind();
}

function exportOperatorsCsv(items) {
  const hasNorm = items.some(o => o.individual_norm_hours != null);
  const headers = ['ФИО','Группа','Звонки','Факт ч'];
  if (hasNorm) headers.push('Ставка','Норма ч','Выполн.%','Баллы за ч','Перераб.ч','Перераб.%');
  headers.push('База ч','КВЗ','Качество','Оцен.звонков','Эфф.%','Штраф мин','Итог','Риск');
  const rows = [headers.join(';')];
  items.forEach(o => {
    const row = [o.full_name, o.group_name||'', o.calls_total??'', o.total_hours??''];
    if (hasNorm) row.push(
      o.rate??'', o.individual_norm_hours??'', o.norm_completion_percent??'',
      o.hours_points??'', o.overtime_hours??'', o.overtime_percent??''
    );
    row.push(o.base_hours??'', o.kvz??'', o.quality_avg??'', o.quality_calls_count??'',
      o.efficiency_percent??'', o.penalty_minutes??'', o.final_points??'', o.risk_status??'');
    rows.push(row.join(';'));
  });
  downloadCsv(rows, 'аналитика_операторы.csv');
}

function downloadCsv(rows, filename) {
  const blob = new Blob(['\ufeff'+rows.join('\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}

/* ── Вкладка: Группы ──────────────────────────────────────────*/
async function loadGroupsTab(content) {
  const groupsCmp = await analyticsFetch('groups-comparison', analyticsBaseParams());
  const items = groupsCmp.items || [];

  const bestQuality = items.length ? [...items].sort((a,b)=>(b.avg_quality??-1)-(a.avg_quality??-1))[0] : null;
  const bestKvz = items.length ? [...items].sort((a,b)=>(b.avg_kvz??-1)-(a.avg_kvz??-1))[0] : null;
  const worstPenalty = items.length ? [...items].sort((a,b)=>b.penalty_minutes-a.penalty_minutes)[0] : null;
  const worstRisk = items.length ? [...items].sort((a,b)=>b.operators_in_risk-a.operators_in_risk)[0] : null;

  content.innerHTML =
    renderGroupsBestWorstBlock(bestQuality, bestKvz, worstPenalty, worstRisk) +
    renderGroupsMetricChartBlock(items) +
    renderGroupsComparisonBlock(groupsCmp);

  bindGroupsMetricTabs(items);
}

function renderGroupsBestWorstBlock(bestQ, bestK, worstP, worstR) {
  function card(label, group, valueFmt) {
    if (!group) return `<div class="an-kpi-cell"><div class="an-kpi-val">—</div><div class="an-kpi-label">${esc(label)}</div></div>`;
    return `<div class="an-kpi-cell"><div class="an-kpi-val" style="font-size:15px">${esc(group.group_name)}</div><div class="an-kpi-label">${esc(label)}: ${valueFmt}</div></div>`;
  }
  return `<div class="an-card">
    <div class="an-card-head">Лучшие и слабые группы</div>
    <div class="an-kpi-grid">
      ${card('Лучшая по качеству', bestQ, fmtA(bestQ?.avg_quality))}
      ${card('Лучшая по КВЗ', bestK, fmtA(bestK?.avg_kvz))}
      ${card('Больше всего штрафов', worstP, fmtA(worstP?.penalty_minutes,1)+' мин')}
      ${card('Больше всего в риске', worstR, (worstR?.operators_in_risk??0)+' опер.')}
    </div>
  </div>`;
}

function renderGroupsMetricChartBlock(items) {
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Сравнение групп по показателю</span>
      <div class="metric-tabs" id="an-groups-metric-tabs">
        <button class="metric-tab active" data-metric="final_points_sum">Баллы</button>
        <button class="metric-tab" data-metric="avg_quality">Качество</button>
        <button class="metric-tab" data-metric="avg_kvz">КВЗ</button>
        <button class="metric-tab" data-metric="avg_efficiency">Эфф.</button>
        <button class="metric-tab" data-metric="penalty_minutes">Штрафы</button>
        <button class="metric-tab" data-metric="total_calls">Звонки</button>
      </div>
    </div>
    <div id="an-groups-metric-chart">${renderGroupsMetricChart(items, 'final_points_sum')}</div>
  </div>`;
}

function renderGroupsMetricChart(items, metric) {
  if (!items.length) return '<div class="empty-line">Нет данных</div>';
  const vals = items.map(g => g[metric] ?? 0);
  const maxV = Math.max(...vals, 1);
  return `<div class="an-bar-chart">
    ${items.map((g,i) => `<div class="an-bar-row">
      <div class="an-bar-date" style="width:120px">${esc(g.group_name)}</div>
      <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round((vals[i]/maxV)*100)}%"></div></div>
      <div class="an-bar-val">${fmtA(vals[i], metric==='total_calls'?0:2)}</div>
    </div>`).join('')}
  </div>`;
}

function bindGroupsMetricTabs(items) {
  document.querySelectorAll('#an-groups-metric-tabs .metric-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#an-groups-metric-tabs .metric-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('an-groups-metric-chart').innerHTML = renderGroupsMetricChart(items, btn.dataset.metric);
    });
  });
}

/* ── Вкладка: Матрицы ──────────────────────────────────────────*/
async function loadMatrixTab(content) {
  content.innerHTML =
    renderQualityKvzMatrixBlock() +
    `<div class="an-card"><div class="an-card-head">Нагрузка и эффективность</div>
      <div id="an-load-eff-matrix"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
    </div>`;

  // Один запрос вместо 2 — получаем все матрицы сразу
  try {
    const d = await analyticsFetch('matrix-combined', analyticsBaseParams());
    drawScatter('an-qk-matrix', d.quality_kvz || [], 'kvz', 'quality_avg', 'КВЗ', 'Качество', d.thresholds?.kvz, d.thresholds?.quality);
    drawScatter('an-load-eff-matrix', d.load_efficiency || [], 'calls_total', 'efficiency_percent', 'Звонки', 'Эффективность %');
  } catch(e) {
    const c = document.getElementById('an-qk-matrix');
    if (c) c.innerHTML = `<div class="empty-line">${esc(e.message)}</div>`;
    const c2 = document.getElementById('an-load-eff-matrix');
    if (c2) c2.innerHTML = `<div class="empty-line">${esc(e.message)}</div>`;
  }
}

/* ── Вкладка: Качество ──────────────────────────────────────────*/
async function loadQualityTab(content) {
  // Получаем coverage и penalties одним запросом, heatmap — параллельно
  const [combined, hm] = await Promise.all([
    analyticsFetch('quality-combined', analyticsBaseParams()),
    analyticsFetch('heatmap', { ...analyticsBaseParams(), metric: 'quality' }).catch(() => null),
  ]);

  const coverage = combined.coverage || {};
  content.innerHTML =
    renderQualityCoverageBlock(coverage) +
    `<div class="an-card">
      <div class="an-card-head">Heatmap качества по дням</div>
      <div id="an-quality-heatmap">${hm ? renderHeatmapTable(hm, 'quality') : '<div class="empty-line">Нет данных для heatmap</div>'}</div>
    </div>`;
}

/* ── Вкладка: Динамика ────────────────────────────────────────*/
async function loadDynamicsTab(content) {
  content.innerHTML = `
    <div class="an-card">
      <div class="an-card-head-row">
        <span>Динамика по дням</span>
        <div class="metric-tabs" id="an-dyn-tabs2">
          <button class="metric-tab active" data-metric="calls">Звонки</button>
          <button class="metric-tab" data-metric="kvz">КВЗ</button>
          <button class="metric-tab" data-metric="operators">Операторы</button>
        </div>
      </div>
      <div id="an-dyn-chart2"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
    </div>
    <div class="an-card">
      <div class="an-card-head-row">
        <span>Тепловая карта по дням</span>
        <div class="metric-tabs" id="an-heatmap-tabs2">
          <button class="metric-tab active" data-metric="quality">Качество</button>
          <button class="metric-tab" data-metric="calls">Звонки</button>
          <button class="metric-tab" data-metric="kvz">КВЗ</button>
          <button class="metric-tab" data-metric="efficiency">Эфф.</button>
          <button class="metric-tab" data-metric="penalty">Штрафы</button>
        </div>
      </div>
      <div id="an-heatmap-body2"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
    </div>`;

  const base = analyticsBaseParams();

  async function loadDyn(metric) {
    const box = document.getElementById('an-dyn-chart2');
    try {
      const d = await analyticsFetch('daily-dynamics', { ...base, metric });
      box.innerHTML = renderDynChart(d.items || [], metric);
    } catch(e) { box.innerHTML = `<div class="empty-line">${esc(e.message)}</div>`; }
  }
  document.querySelectorAll('#an-dyn-tabs2 .metric-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#an-dyn-tabs2 .metric-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      loadDyn(btn.dataset.metric);
    });
  });
  loadDyn('calls');

  async function loadHm(metric) {
    const box = document.getElementById('an-heatmap-body2');
    try {
      const d = await analyticsFetch('heatmap', { ...base, metric });
      box.innerHTML = renderHeatmapTable(d, metric);
    } catch(e) { box.innerHTML = `<div class="empty-line">${esc(e.message)}</div>`; }
  }
  document.querySelectorAll('#an-heatmap-tabs2 .metric-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#an-heatmap-tabs2 .metric-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      loadHm(btn.dataset.metric);
    });
  });
  loadHm('quality');
}

/* ── Вкладка: Штрафы ──────────────────────────────────────────*/
async function loadPenaltiesTab(content) {
  const penalties = await analyticsFetch('penalties', analyticsBaseParams());
  content.innerHTML = renderPenaltiesBlock(penalties);
}

/* ── Вкладка: Риски ───────────────────────────────────────────*/
async function loadRisksTab(content) {
  const [riskPyramid, opsTable] = await Promise.all([
    analyticsFetch('risk-pyramid', analyticsBaseParams()),
    analyticsFetch('operators', analyticsOpParams()),
  ]);

  content.innerHTML =
    renderRiskPyramidBlock(riskPyramid) +
    renderRiskOperatorsTableBlock(opsTable.items || []) +
    renderRiskByGroupsBlock(riskPyramid, opsTable.items || []);

  document.querySelectorAll('.an-risk-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const status = cell.dataset.riskStatus;
      const detail = document.getElementById('an-risk-detail');
      const bucket = riskPyramid[status];
      if (!detail) return;
      if (!bucket || !bucket.operators.length) { detail.innerHTML = '<div class="empty-line">Операторов в этой категории нет</div>'; return; }
      detail.innerHTML = `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Оператор</th><th>Группа</th><th class="num">Качество</th><th class="num">КВЗ</th><th class="num">Эфф.%</th><th class="num">Штраф мин</th></tr></thead>
        <tbody>${bucket.operators.map(o => `<tr>
          <td class="name-cell">${esc(o.full_name)}</td><td>${esc(o.group_name||'—')}</td>
          <td class="num">${o.quality_avg!=null?fmtA(o.quality_avg):'—'}</td>
          <td class="num">${o.kvz!=null?fmtA(o.kvz):'—'}</td>
          <td class="num">${o.efficiency_percent!=null?fmtA(o.efficiency_percent):'—'}</td>
          <td class="num">${fmtA(o.penalty_minutes,1)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    });
  });
}

function renderRiskOperatorsTableBlock(items) {
  function reasons(o) {
    const r = [];
    if (o.risk_status === 'no_data') return 'Нет данных';
    if (o.quality_avg != null && o.quality_avg < 80) r.push(`качество ${o.quality_avg}`);
    if (o.kvz != null && o.kvz < 8) r.push(`КВЗ ${o.kvz}`);
    if (o.efficiency_percent != null && o.efficiency_percent < 45) r.push(`эфф. ${o.efficiency_percent}%`);
    if (o.penalty_minutes > 10) r.push(`штрафы ${o.penalty_minutes} мин`);
    return r.length ? r.join(', ') : '—';
  }
  function recommend(status) {
    return { critical: 'Срочно провести разбор и контрольную точку', watch: 'Поставить на контроль',
      stable: 'Без действий', no_data: 'Проверить наличие данных' }[status] || '—';
  }
  const risky = items.filter(o => o.risk_status !== 'stable');
  return `<div class="an-card">
    <div class="an-card-head">Операторы по рискам</div>
    ${risky.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Оператор</th><th>Группа</th><th>Статус</th><th>Причины</th><th>Рекомендация</th></tr></thead>
      <tbody>${risky.map(o => `<tr>
        <td class="name-cell">${esc(o.full_name)}</td><td>${esc(o.group_name||'—')}</td>
        <td>${riskBadge(o.risk_status)}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${esc(reasons(o))}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${esc(recommend(o.risk_status))}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty-line">Все операторы стабильны</div>'}
  </div>`;
}

function renderRiskByGroupsBlock(riskPyramid, items) {
  const byGroup = {};
  items.forEach(o => {
    const g = o.group_name || 'Без группы';
    if (!byGroup[g]) byGroup[g] = { stable: 0, watch: 0, critical: 0, no_data: 0 };
    byGroup[g][o.risk_status] = (byGroup[g][o.risk_status] || 0) + 1;
  });
  const rows = Object.entries(byGroup);
  return `<div class="an-card">
    <div class="an-card-head">Риски по группам</div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Группа</th><th class="num">Стабильные</th><th class="num">Нужен контроль</th><th class="num">Критично</th><th class="num">Нет данных</th></tr></thead>
      <tbody>${rows.map(([g,c]) => `<tr>
        <td class="name-cell">${esc(g)}</td>
        <td class="num" style="color:var(--success)">${c.stable||0}</td>
        <td class="num" style="color:var(--warning)">${c.watch||0}</td>
        <td class="num" style="color:var(--danger)">${c.critical||0}</td>
        <td class="num" style="color:var(--text-muted)">${c.no_data||0}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty-line">Нет данных</div>'}
  </div>`;
}

/* ── Вкладка: Баллы ───────────────────────────────────────────*/

/* ── Вкладка: Баллы (полный анализ итоговых баллов) ───────────*/
let _pointsViewMode = 'top10'; // top10 | all | growth | table
let _pointsData = null;

async function loadPointsTab(content) {
  content.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Считаем баллы…</p></div>';

  try {
    _pointsData = await analyticsFetch('points', analyticsOpParams());
  } catch(e) {
    content.innerHTML = `<div class="an-card"><div class="status-line status-error">${esc(e.message)}</div></div>`;
    return;
  }

  const d = _pointsData;
  if (!d.operators || !d.operators.length) {
    content.innerHTML = `<div class="an-card"><div class="an-empty-state">
      <div class="an-empty-icon">📊</div>
      <div class="an-empty-title">Нет данных по баллам за выбранный период</div>
      <div class="an-empty-sub">Загрузите файлы или измените период</div>
    </div></div>`;
    return;
  }

  content.innerHTML =
    renderPointsFormulaBlock() +
    renderPointsKpiBlock(d.summary) +
    renderPointsModeSwitcher() +
    `<div id="an-points-mode-content"></div>`;

  bindPointsFormulaToggle(content);
  bindPointsModeSwitcher();
  renderPointsModeContent(_pointsViewMode);
}

function renderPointsFormulaBlock() {
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Формула расчёта итоговых баллов</span>
      <button class="btn-link" id="an-formula-toggle" style="font-size:12px">Как считается? ▾</button>
    </div>
    <div class="an-formula-box">Итоговые баллы = Качество + КВЗ + Итог часов + Эффективность − Штрафные баллы</div>
    <div id="an-formula-detail" class="an-formula-detail" hidden>
      <div class="an-formula-row"><b>Качество</b> — средняя оценка звонков за выбранный период</div>
      <div class="an-formula-row"><b>КВЗ</b> — количество звонков ÷ база часов</div>
      <div class="an-formula-row"><b>Итог часов</b> — все отработанные часы за период</div>
      <div class="an-formula-row"><b>Эффективность</b> — часы в звонке ÷ база часов × 100</div>
      <div class="an-formula-row"><b>Штрафные баллы</b> — минуты штрафа × 5</div>
    </div>
  </div>`;
}

function bindPointsFormulaToggle(content) {
  content.querySelector('#an-formula-toggle')?.addEventListener('click', (e) => {
    const detail = content.querySelector('#an-formula-detail');
    const btn = e.target;
    const isHidden = detail.hasAttribute('hidden');
    if (isHidden) { detail.removeAttribute('hidden'); btn.textContent = 'Как считается? ▴'; }
    else { detail.setAttribute('hidden', ''); btn.textContent = 'Как считается? ▾'; }
  });
}

function renderPointsKpiBlock(summary) {
  const s = summary || {};
  const cards = [
    { label: 'Средний итоговый балл', val: s.avg_final_points },
    { label: 'Лучший результат', val: s.max_final_points },
    { label: 'Худший результат', val: s.min_final_points },
    { label: 'Средний рост к периоду', val: s.avg_delta, signed: true },
    { label: 'Операторов с ростом', val: s.operators_with_growth, dec: 0, color: 'var(--success)' },
    { label: 'Операторов с просадкой', val: s.operators_with_decline, dec: 0, color: 'var(--danger)' },
  ];
  return `<div class="an-card">
    <div class="an-card-head">Сводка по баллам</div>
    <div class="an-kpi-grid">
      ${cards.map(c => {
        const v = c.val;
        const txt = v == null ? '—' : (c.signed && v > 0 ? '+' : '') + fmtA(v, c.dec ?? 1);
        return `<div class="an-kpi-cell"><div class="an-kpi-val" style="${c.color?'color:'+c.color:''}">${txt}</div><div class="an-kpi-label">${esc(c.label)}</div></div>`;
      }).join('')}
    </div>
    ${!summary?.has_previous_period ? '<div class="an-info-note">Сравнение с прошлым периодом недоступно — недостаточно данных за предыдущий период.</div>' : ''}
  </div>`;
}

function renderPointsModeSwitcher() {
  const modes = [
    { key: 'top10', label: 'Топ-10' },
    { key: 'all', label: 'Все операторы' },
    { key: 'growth', label: 'Рост/просадка' },
    { key: 'table', label: 'Детальная таблица' },
  ];
  return `<div class="an-mode-switcher">
    ${modes.map(m => `<button class="an-mode-btn ${m.key===_pointsViewMode?'active':''}" data-mode="${m.key}">${esc(m.label)}</button>`).join('')}
  </div>`;
}

function bindPointsModeSwitcher() {
  document.querySelectorAll('.an-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.an-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _pointsViewMode = btn.dataset.mode;
      renderPointsModeContent(_pointsViewMode);
    });
  });
}

function resultStatusBadge(status) {
  const map = {
    excellent: { label: 'Отличный результат', color: 'var(--success)', bg: 'var(--success-soft)' },
    good:      { label: 'Хороший результат',  color: 'var(--info)',    bg: 'var(--info-soft)' },
    average:   { label: 'Средний результат',  color: 'var(--warning)', bg: 'var(--warning-soft)' },
    low:       { label: 'Низкий результат',   color: 'var(--danger)',  bg: 'var(--danger-soft)' },
    no_data:   { label: 'Нет данных',         color: 'var(--text-muted)', bg: 'var(--bg-muted)' },
  };
  const r = map[status] || map.no_data;
  return `<span class="risk-badge" style="color:${r.color};background:${r.bg}">${r.label}</span>`;
}

function deltaText(v, suffix = '') {
  if (v === null || v === undefined) return '<span style="color:var(--text-muted)">—</span>';
  if (Math.abs(v) < 0.05) return '<span style="color:var(--text-muted)">без изменений</span>';
  const arrow = v > 0 ? '↑' : '↓';
  const color = v > 0 ? 'var(--success)' : 'var(--danger)';
  return `<span style="color:${color}">${arrow} ${v > 0 ? '+' : ''}${fmtA(v, 1)}${suffix}</span>`;
}

function renderPointsModeContent(mode) {
  const box = document.getElementById('an-points-mode-content');
  if (!box || !_pointsData) return;
  const d = _pointsData;

  if (mode === 'top10') box.innerHTML = renderPointsTop10(d.operators);
  else if (mode === 'all') box.innerHTML = renderPointsAllCards(d.operators);
  else if (mode === 'growth') box.innerHTML = renderPointsGrowthDecline(d.top_growth, d.top_decline);
  else if (mode === 'table') {
    box.innerHTML = renderPointsDetailTable(d.operators);
    bindPointsTableSort(d.operators);
    box.querySelector('#an-points-export-btn')?.addEventListener('click', () => exportPointsCsv(d.operators));
  }

  bindPointsRowClicks(d.operators);
}

function exportPointsCsv(operators) {
  const headers = ['ФИО','Группа','Итог','Δ итог','Качество','Δ кач','КВЗ','Δ КВЗ','Часы','Δ часы','Эфф%','Δ эфф','Штраф баллы','Δ штраф','Статус'];
  const rows = [headers.join(';')];
  operators.forEach(o => rows.push([
    o.full_name, o.group_name||'', o.final_points, o.delta_final_points??'',
    o.quality??'', o.delta_quality??'', o.kvz??'', o.delta_kvz??'',
    o.total_hours, o.delta_total_hours??'', o.efficiency??'', o.delta_efficiency??'',
    o.penalty_points, o.delta_penalty_points??'', o.status
  ].join(';')));
  downloadCsv(rows, 'аналитика_баллы.csv');
}

/* Топ-10 bar chart */
function renderPointsTop10(operators) {
  const top10 = operators.slice(0, 10);
  const maxV = Math.max(...top10.map(o => o.final_points), 1);
  return `<div class="an-card">
    <div class="an-card-head">Топ-10 по итоговым баллам</div>
    <div class="an-points-bars">
      ${top10.map((o, i) => `
        <div class="an-points-bar-row" data-points-operator="${o.operator_id ?? o.full_name}">
          <div class="an-points-rank">${i+1}</div>
          <div class="an-points-name">
            <div class="an-points-name-main">${esc(o.full_name)}</div>
            <div class="an-points-name-sub">${esc(o.group_name||'—')}</div>
          </div>
          <div class="an-points-bar-track"><div class="an-points-bar-fill" style="width:${Math.round((o.final_points/maxV)*100)}%"></div></div>
          <div class="an-points-val">${fmtA(o.final_points,2)}</div>
          <div class="an-points-delta">${o.delta_final_points!=null ? deltaText(o.delta_final_points) : '<span style="color:var(--text-muted);font-size:11px">нет сравнения</span>'}</div>
        </div>`).join('')}
    </div>
  </div>`;
}

/* Карточки всех операторов с разбором показателей */
function renderPointsAllCards(operators) {
  return `<div class="an-card">
    <div class="an-card-head">Разбор вклада показателей по оператору</div>
    <div class="an-points-cards-grid">
      ${operators.map(o => renderOperatorPointsCard(o)).join('')}
    </div>
  </div>`;
}

function renderOperatorPointsCard(o) {
  const maxBar = Math.max(o.quality||0, (o.kvz||0)*10, o.total_hours||0, o.efficiency||0, 100);
  function metricRow(label, val, delta, barVal, unit='') {
    if (val == null) return `<div class="an-pc-metric"><span class="an-pc-label">${esc(label)}</span><span class="an-pc-value" style="color:var(--text-muted)">нет данных</span></div>`;
    const pct = Math.min(100, (barVal/maxBar)*100);
    return `<div class="an-pc-metric">
      <span class="an-pc-label">${esc(label)}</span>
      <div class="an-pc-bar-track"><div class="an-pc-bar-fill" style="width:${pct}%"></div></div>
      <span class="an-pc-value">${fmtA(val,1)}${unit}</span>
      <span class="an-pc-delta">${deltaText(delta, unit)}</span>
    </div>`;
  }
  return `<div class="an-points-card" data-points-operator="${o.operator_id ?? o.full_name}">
    <div class="an-pc-header">
      <div>
        <div class="an-pc-name">${esc(o.full_name)}</div>
        <div class="an-pc-group">${esc(o.group_name||'—')}</div>
      </div>
      ${resultStatusBadge(o.status)}
    </div>
    <div class="an-pc-totals">
      <span>Итог: <b>${fmtA(o.final_points,2)}</b></span>
      <span>Рост: ${o.delta_final_points!=null ? deltaText(o.delta_final_points) : '—'}</span>
    </div>
    <div class="an-pc-metrics">
      ${metricRow('Качество', o.quality, o.delta_quality, o.quality||0)}
      ${metricRow('КВЗ', o.kvz, o.delta_kvz, (o.kvz||0)*10)}
      ${metricRow('Часы', o.total_hours, o.delta_total_hours, o.total_hours||0)}
      ${metricRow('Эффективность', o.efficiency, o.delta_efficiency, o.efficiency||0, '%')}
      <div class="an-pc-metric an-pc-penalty">
        <span class="an-pc-label">Штрафы</span>
        <span class="an-pc-value" style="color:${o.penalty_points>0?'var(--danger)':'var(--text-muted)'}">
          ${o.penalty_points>0 ? '-'+fmtA(o.penalty_points,1)+' баллов — '+fmtA(o.penalty_minutes,1)+' мин' : '0 — нарушений нет'}
        </span>
      </div>
    </div>
  </div>`;
}

/* Рост/просадка блок */
function renderPointsGrowthDecline(topGrowth, topDecline) {
  function list(title, items, color) {
    if (!items.length) return `<div class="an-growth-col"><div class="an-growth-title">${esc(title)}</div><div class="empty-line">Нет данных</div></div>`;
    return `<div class="an-growth-col">
      <div class="an-growth-title">${esc(title)}</div>
      ${items.map((o,i) => `<div class="an-growth-row" data-points-operator="${o.operator_id ?? o.full_name}">
        <span class="an-growth-rank">${i+1}</span>
        <span class="an-growth-name">${esc(o.full_name)}</span>
        <span class="an-growth-val" style="color:${color}">${o.delta_final_points>0?'+':''}${fmtA(o.delta_final_points,1)}</span>
      </div>
      <div class="an-growth-reason">${esc(o.main_change_reason)}</div>`).join('')}
    </div>`;
  }
  return `<div class="an-card">
    <div class="an-card-head">Рост и просадка по итоговым баллам</div>
    <div class="an-grid-2">
      ${list('Топ-5 по росту', topGrowth, 'var(--success)')}
      ${list('Топ-5 по просадке', topDecline, 'var(--danger)')}
    </div>
  </div>`;
}

/* Детальная таблица */
let _pointsTableSortKey = 'final_points', _pointsTableSortDir = 'desc';
function renderPointsDetailTable(operators) {
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Детализация баллов</span>
      <button class="btn-outline btn-sm" id="an-points-export-btn">Экспорт CSV</button>
    </div>
    <div id="an-points-table-wrap">${renderPointsTableBody(operators)}</div>
  </div>`;
}

function renderPointsTableBody(operators) {
  const sorted = [...operators].sort((a,b) => {
    const av = a[_pointsTableSortKey] ?? -Infinity, bv = b[_pointsTableSortKey] ?? -Infinity;
    return _pointsTableSortDir === 'desc' ? bv - av : av - bv;
  });
  const arrow = k => k === _pointsTableSortKey ? (_pointsTableSortDir==='desc'?' ↓':' ↑') : '';
  const html = `<div class="table-wrap"><table class="data-table">
    <thead><tr>
      <th>#</th><th>Оператор</th><th>Группа</th>
      <th class="num sortable" data-sort="final_points">Итог${arrow('final_points')}</th>
      <th class="num sortable" data-sort="delta_final_points">Δ итог${arrow('delta_final_points')}</th>
      <th class="num">Качество</th><th class="num">Δ кач.</th>
      <th class="num">КВЗ</th><th class="num">Δ КВЗ</th>
      <th class="num">Эфф.%</th><th class="num">Δ эфф.</th>
      <th class="num">Штраф б.</th><th>Статус</th>
    </tr></thead>
    <tbody>
      ${sorted.map((o,i) => `<tr data-points-operator="${o.operator_id ?? o.full_name}" style="cursor:pointer">
        <td>${i+1}</td>
        <td class="name-cell">${esc(o.full_name)}</td>
        <td>${esc(o.group_name||'—')}</td>
        <td class="num"><b>${fmtA(o.final_points,2)}</b></td>
        <td class="num">${o.delta_final_points!=null?deltaText(o.delta_final_points):'—'}</td>
        <td class="num">${o.quality!=null?fmtA(o.quality,1):'—'}</td>
        <td class="num">${o.delta_quality!=null?deltaText(o.delta_quality):'—'}</td>
        <td class="num">${o.kvz!=null?fmtA(o.kvz,1):'—'}</td>
        <td class="num">${o.delta_kvz!=null?deltaText(o.delta_kvz):'—'}</td>
        <td class="num">${o.efficiency!=null?fmtA(o.efficiency,1):'—'}</td>
        <td class="num">${o.delta_efficiency!=null?deltaText(o.delta_efficiency):'—'}</td>
        <td class="num" style="${o.penalty_points>0?'color:var(--danger)':''}">${fmtA(o.penalty_points,1)}</td>
        <td>${resultStatusBadge(o.status)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
  return html;
}

function bindPointsTableSort(operators) {
  document.querySelectorAll('#an-points-table-wrap .sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (_pointsTableSortKey === key) _pointsTableSortDir = _pointsTableSortDir === 'desc' ? 'asc' : 'desc';
      else { _pointsTableSortKey = key; _pointsTableSortDir = 'desc'; }
      document.getElementById('an-points-table-wrap').innerHTML = renderPointsTableBody(operators);
      bindPointsTableSort(operators);
      bindPointsRowClicks(operators);
    });
  });
}

function bindPointsRowClicks(operators) {
  document.querySelectorAll('[data-points-operator]').forEach(elx => {
    elx.onclick = () => {
      const key = elx.dataset.pointsOperator;
      const op = operators.find(o => String(o.operator_id) === key || o.full_name === key);
      if (op) openOperatorPointsDrawer(op);
    };
  });
}

/* Детальная карточка оператора — модальное окно */
function openOperatorPointsDrawer(o) {
  const improved = [];
  const declined = [];
  if (o.delta_quality != null) (o.delta_quality > 0.5 ? improved : o.delta_quality < -0.5 ? declined : [null]).push?.(`Качество ${o.delta_quality>0?'+':''}${fmtA(o.delta_quality,1)}`);
  if (o.delta_kvz != null && Math.abs(o.delta_kvz) > 0.3) (o.delta_kvz>0?improved:declined).push(`КВЗ ${o.delta_kvz>0?'+':''}${fmtA(o.delta_kvz,1)}`);
  if (o.delta_efficiency != null && Math.abs(o.delta_efficiency) > 1) (o.delta_efficiency>0?improved:declined).push(`Эффективность ${o.delta_efficiency>0?'+':''}${fmtA(o.delta_efficiency,1)}%`);
  if (o.delta_total_hours != null && Math.abs(o.delta_total_hours) > 1) (o.delta_total_hours>0?improved:declined).push(`Часы ${o.delta_total_hours>0?'+':''}${fmtA(o.delta_total_hours,1)}`);
  if (o.delta_penalty_points != null && o.delta_penalty_points > 0.5) declined.push(`Штрафы +${fmtA(o.delta_penalty_points,1)}`);

  showModal(`
    <h3 class="modal-title">${esc(o.full_name)}</h3>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <span style="color:var(--text-secondary);font-size:13px">${esc(o.group_name||'—')}</span>
      ${resultStatusBadge(o.status)}
    </div>
    <div class="an-drawer-totals">
      <div><span class="an-drawer-label">Итоговые баллы</span><span class="an-drawer-val">${fmtA(o.final_points,2)}</span></div>
      <div><span class="an-drawer-label">Изменение</span><span class="an-drawer-val">${o.delta_final_points!=null?deltaText(o.delta_final_points):'—'}</span></div>
    </div>
    <div class="an-drawer-section">
      <div class="an-drawer-section-title">Разбор показателей</div>
      <div class="an-drawer-metric-row"><span>Качество</span><b>${o.quality!=null?fmtA(o.quality,1):'нет данных'}</b>${o.delta_quality!=null?deltaText(o.delta_quality):''}</div>
      <div class="an-drawer-metric-row"><span>КВЗ</span><b>${o.kvz!=null?fmtA(o.kvz,1):'нет данных'}</b>${o.delta_kvz!=null?deltaText(o.delta_kvz):''}</div>
      <div class="an-drawer-metric-row"><span>Итог часов</span><b>${fmtA(o.total_hours,1)}</b>${o.delta_total_hours!=null?deltaText(o.delta_total_hours):''}</div>
      <div class="an-drawer-metric-row"><span>Эффективность</span><b>${o.efficiency!=null?fmtA(o.efficiency,1)+'%':'нет данных'}</b>${o.delta_efficiency!=null?deltaText(o.delta_efficiency,'%'):''}</div>
      <div class="an-drawer-metric-row"><span>Штрафы</span><b style="color:${o.penalty_points>0?'var(--danger)':'inherit'}">${o.penalty_points>0?'-'+fmtA(o.penalty_points,1):'0'}</b></div>
    </div>
    ${improved.length ? `<div class="an-drawer-section">
      <div class="an-drawer-section-title" style="color:var(--success)">Что улучшилось</div>
      ${improved.map(t=>`<div class="an-drawer-change-row" style="color:var(--success)">↑ ${esc(t)}</div>`).join('')}
    </div>` : ''}
    ${declined.length ? `<div class="an-drawer-section">
      <div class="an-drawer-section-title" style="color:var(--danger)">Что просело</div>
      ${declined.map(t=>`<div class="an-drawer-change-row" style="color:var(--danger)">↓ ${esc(t)}</div>`).join('')}
    </div>` : ''}
    <div class="an-drawer-section">
      <div class="an-drawer-section-title">Рекомендация</div>
      <div class="an-drawer-recommendation">${esc(o.recommendation)}</div>
    </div>
  `);
}


/* ── Вкладка: Экспорт ─────────────────────────────────────────*/
async function loadExportTab(content) {
  content.innerHTML = `<div class="an-card">
    <div class="an-card-head">Экспорт отчётов</div>
    <div class="an-export-grid">
      <button class="btn-outline an-export-btn" data-export="operators">Таблица операторов</button>
      <button class="btn-outline an-export-btn" data-export="groups">Сравнение групп</button>
      <button class="btn-outline an-export-btn" data-export="penalties">Штрафы</button>
      <button class="btn-outline an-export-btn" data-export="attention">Зона внимания</button>
      <button class="btn-outline an-export-btn" data-export="risks">Риски</button>
      <button class="btn-outline an-export-btn" data-export="quality_coverage">Качество прослушки</button>
    </div>
    <p style="font-size:12px;color:var(--text-muted);margin-top:14px">Экспорт учитывает выбранные фильтры периода, группы и оператора.</p>
  </div>`;

  content.querySelectorAll('.an-export-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.export;
      btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Готовим…';
      try {
        await exportAnalyticsCsv(kind);
      } catch(e) { showToast('Ошибка экспорта: ' + e.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = orig; }
    });
  });
}

async function exportAnalyticsCsv(kind) {
  const base = analyticsBaseParams();
  const opParams = analyticsOpParams();

  if (kind === 'operators') {
    const d = await analyticsFetch('operators', opParams);
    exportOperatorsCsv(d.items || []);
  } else if (kind === 'groups') {
    const d = await analyticsFetch('groups-comparison', base);
    const rows = ['Группа;Операторов;Звонки;Качество;КВЗ;Эфф.%;Штраф мин;Итог баллов'];
    (d.items||[]).forEach(g => rows.push([g.group_name,g.operators_count,g.total_calls,g.avg_quality??'',g.avg_kvz??'',g.avg_efficiency??'',g.penalty_minutes,g.final_points_sum].join(';')));
    downloadCsv(rows, 'аналитика_группы.csv');
  } else if (kind === 'penalties') {
    const d = await analyticsFetch('penalties', base);
    const rows = ['Оператор;Группа;Сумма;Минуты;Потеря баллов'];
    (d.operators||[]).forEach(o => rows.push([o.full_name,o.group_name||'',o.penalty_sum,o.penalty_minutes,o.penalty_points].join(';')));
    downloadCsv(rows, 'аналитика_штрафы.csv');
  } else if (kind === 'attention') {
    const d = await analyticsFetch('top-and-attention', base);
    const rows = ['Оператор;Группа;Причина'];
    (d.attention_zone||[]).forEach(a => rows.push([a.full_name,a.group_name||'',a.reason].join(';')));
    downloadCsv(rows, 'аналитика_зона_внимания.csv');
  } else if (kind === 'risks') {
    const d = await analyticsFetch('operators', opParams);
    const rows = ['Оператор;Группа;Статус риска;Качество;КВЗ;Эфф.%;Штраф мин'];
    (d.items||[]).forEach(o => rows.push([o.full_name,o.group_name||'',o.risk_status,o.quality_avg??'',o.kvz??'',o.efficiency_percent??'',o.penalty_minutes].join(';')));
    downloadCsv(rows, 'аналитика_риски.csv');
  } else if (kind === 'quality_coverage') {
    const d = await analyticsFetch('quality-coverage', base);
    const rows = ['Группа;Операторов;Оцен.звонков;Среднее/опер;Без оценок;Ср.качество'];
    (d.by_group||[]).forEach(g => rows.push([g.group_name,g.operators_count,g.evaluated_calls,g.avg_evaluations_per_operator,g.operators_without_quality,g.avg_quality??''].join(';')));
    downloadCsv(rows, 'аналитика_качество_прослушки.csv');
  }
}

window.renderAnalytics = renderAnalytics;

/* ══════════════════════════════════════
   VIEW: РЕЙТИНГ — обёртка с горизонтальными вкладками
══════════════════════════════════════ */
const RATING_TABS = [
  { key: 'overview', label: 'Общий рейтинг' },
  { key: 'race',     label: 'Гонка баллов' },
  { key: 'groups',   label: 'Сравнение групп' },
  { key: 'progress', label: 'Мой прогресс' },
];

let _ratingActiveTab = 'overview';

async function exportRatingFromRatingPage() {
  try {
    const summary = await swrFetch('admin-summary:', () => api.getAdminSummary({}), null, SWR_FAST_TTL_MS);
    if (!summary.period_start) { showToast('Нет рассчитанных недель для экспорта', 'error'); return; }
    window.open(api.exportUrl('/api/exports/rating', { period_start: summary.period_start, period_end: summary.period_end, format: 'csv' }), '_blank');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function renderRating() {
  const el = document.getElementById('view-rating');
  if (!el) return;
  const myNavGen = STATE.navGen; // раздел "Рейтинг" уже активен — фиксируем текущее поколение

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Рейтинг</div><h2 class="section-title">Турнирная таблица</h2></div>
      <div class="header-right">
        ${isAdmin(STATE.user?.role) ? '<button class="btn-outline btn-sm" onclick="exportRatingFromRatingPage()">Экспорт CSV</button>' : ''}
        <button class="btn-outline btn-sm" onclick="renderRating()">Обновить</button>
      </div>
    </div>
    <div class="analytics-tabs" id="rating-tabs">
      ${RATING_TABS.map(t => `<button class="analytics-tab ${t.key===_ratingActiveTab?'active':''}" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
    </div>
    <div id="rating-tab-content"></div>
  `;

  el.querySelectorAll('.analytics-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.analytics-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _ratingActiveTab = btn.dataset.tab;
      loadRatingTab(_ratingActiveTab);
    });
  });

  if (isNavStale(myNavGen)) return; // пользователь уже ушёл с "Рейтинга" — дальше не рисуем
  await loadRatingTab(_ratingActiveTab);
}

async function loadRatingTab(tab) {
  const content = document.getElementById('rating-tab-content');
  if (!content) return;
  const myNavGen = STATE.navGen;
  const myTabGen = bumpRatingTabGen(); // отменяет любой ещё не завершённый рендер предыдущей вкладки
  // Спиннер с задержкой 150мс — если данные уже в кеше (sessionStorage),
  // swrFetch отдаст их синхронно внутри render*Tab-функций раньше, чем
  // успеет сработать таймер, и переключение вкладок будет мгновенным.
  const spinnerTimer = setTimeout(() => {
    if (isNavStale(myNavGen) || isRatingTabStale(myTabGen)) return;
    content.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>';
  }, 150);

  try {
    if (tab === 'overview') await renderRatingOverviewTab(content);
    else if (tab === 'race') await renderRatingRaceTab(content);
    else if (tab === 'groups') await renderRatingGroupsTab(content);
    else if (tab === 'progress') await renderRatingProgressTab(content);
  } catch(e) {
    clearTimeout(spinnerTimer);
    if (isNavStale(myNavGen) || isRatingTabStale(myTabGen)) return; // ушли в другой раздел/вкладку — не показываем чужую ошибку
    content.innerHTML = `<div class="rating-card"><div class="status-line status-error">Не удалось загрузить: ${esc(e.message)}</div></div>`;
    return;
  }
  clearTimeout(spinnerTimer);
  // Успешный рендер прошёл, но пока ждали ответ сервера пользователь мог уже
  // переключиться на другой раздел или другую вкладку — в этом случае контент,
  // который только что записали внутренние render*Tab-функции, всё равно устарел.
  if (isNavStale(myNavGen) || isRatingTabStale(myTabGen)) {
    content.innerHTML = '';
  }
}

/* ── Вкладка: Гонка баллов ─────────────────────────────────────*/
let _raceState = { groupId: '', mode: 'my_zone' };

async function fetchRace(params, onUpdate) {
  const key = 'race:' + JSON.stringify(params || {});
  return swrFetch(key, async () => {
    return api.getRatingRace(params);
  }, onUpdate, ANALYTICS_SWR_TTL_MS);
}

async function renderRatingRaceTab(content) {
  let groupOptions = '<option value="">Все группы</option>';
  try {
    const groups = await swrFetch('groups:active', () => api.listGroups(true), null, SWR_STATIC_TTL_MS);
    groupOptions += (groups || []).map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  } catch(e) { /* ignore */ }

  // У admin/manager/supervisor нет своего operator_id — для них "Моя зона"
  // и "Ваш результат" не имеют смысла (нет личного места в рейтинге
  // операторов). Принудительно переключаем на "Топ-10" и не показываем
  // кнопку "Моя зона" вовсе, чтобы не путать управленческий аккаунт.
  const hasOwnOperatorRecord = Boolean(STATE.user?.operator_id);
  if (!hasOwnOperatorRecord && _raceState.mode === 'my_zone') {
    _raceState.mode = 'top10';
  }

  content.innerHTML = `
    <div class="race-card">
      <div class="race-header-row">
        <div>
          <div class="race-title">Гонка баллов</div>
          <div class="race-subtitle">Сравните свои баллы с другими операторами и группами</div>
        </div>
        <div id="race-my-place-badge"></div>
      </div>
      <div class="race-filters-row">
        <select id="race-group-filter" class="race-select">${groupOptions}</select>
        <div class="race-segmented" id="race-mode-switcher">
          ${hasOwnOperatorRecord ? `<button class="race-seg-btn ${_raceState.mode==='my_zone'?'active':''}" data-mode="my_zone">Моя зона</button>` : ''}
          <button class="race-seg-btn ${_raceState.mode==='top10'?'active':''}" data-mode="top10">Топ-10</button>
          <button class="race-seg-btn ${_raceState.mode==='top20'?'active':''}" data-mode="top20">Топ-20</button>
          <button class="race-seg-btn ${_raceState.mode==='all'?'active':''}" data-mode="all">Все</button>
        </div>
      </div>
      <div id="race-chart-wrap"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
    </div>
    <div id="race-bottom-grid"></div>
  `;

  const groupFilter = content.querySelector('#race-group-filter');
  groupFilter.value = _raceState.groupId;
  if (groupFilter.value !== _raceState.groupId) _raceState.groupId = groupFilter.value;

  async function reload() {
    const params = { mode: _raceState.mode };
    if (_raceState.groupId) params.group_id = _raceState.groupId;
    const data = await fetchRace(params);
    renderRaceContent(content, data);
  }

  groupFilter.addEventListener('change', (e) => {
    _raceState.groupId = e.target.value;
    reload();
  });
  content.querySelectorAll('#race-mode-switcher .race-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('#race-mode-switcher .race-seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _raceState.mode = btn.dataset.mode;
      reload();
    });
  });

  await reload();
}

/**
 * Перестраивает порядок элементов под режим "Моя зона": текущий оператор
 * в центре, слева — те, у кого баллов больше (выше по рейтингу),
 * справа — те, у кого меньше. Бэкенд возвращает срез ±5 от оператора,
 * уже отсортированный по убыванию баллов (rank 1..N) — здесь просто
 * физически переставляем массив так, чтобы "Я" оказался посередине.
 */
function reorderForMyZone(items) {
  const meIdx = items.findIndex(i => i.is_current_user);
  if (meIdx === -1) return items; // нет своих данных — оставляем как есть (Топ-N логика)

  const above = items.slice(0, meIdx);       // у кого баллов больше (rank меньше)
  const me = items[meIdx];
  const below = items.slice(meIdx + 1);      // у кого баллов меньше

  // above уже идёт от дальнего к ближнему (по убыванию rank, т.е. ближе к концу — ближе к "Я")
  // Хотим: [дальние слева ... близкие слева][Я][близкие справа ... дальние справа]
  return [...above, me, ...below];
}

function renderRaceContent(content, data) {
  const itemsRaw = data.items || [];
  const cu = data.current_user;
  const items = _raceState.mode === 'my_zone' ? reorderForMyZone(itemsRaw) : itemsRaw;

  const badgeEl = content.querySelector('#race-my-place-badge');
  if (badgeEl) {
    badgeEl.innerHTML = cu
      ? `<div class="race-place-badge">Ваше место: <b>#${cu.rank}</b> из ${cu.total_participants}</div>`
      : '';
  }

  if (!items.length) {
    content.querySelector('#race-chart-wrap').innerHTML = `<div class="race-empty-line">${esc(data.message || 'Нет данных для отображения')}</div>`;
    content.querySelector('#race-bottom-grid').innerHTML = '';
    return;
  }

  content.querySelector('#race-chart-wrap').innerHTML = renderRaceSummary(itemsRaw, cu, data) + renderRaceChart(items);

  content.querySelector('#race-bottom-grid').innerHTML = `
    <div class="race-detail-grid">
      ${renderRaceMyCard(cu, data.not_in_group_note, items)}
      ${renderRaceTopTable(itemsRaw, cu)}
    </div>
  `;
}

function renderRaceSummary(items, cu, data) {
  const visible = items || [];
  const leader = visible[0];
  const avg = visible.length
    ? Math.round(visible.reduce((sum, item) => sum + (Number(item.points) || 0), 0) / visible.length)
    : 0;
  const currentPoints = cu ? Math.round(cu.points || 0) : null;
  const nextGap = cu?.points_to_next_rank != null ? Math.round(cu.points_to_next_rank) : null;

  return `<div class="race-summary-strip">
    <div class="race-summary-item">
      <span class="race-summary-label">Лидер</span>
      <b>${leader ? esc(leader.full_name) : '—'}</b>
      <em>${leader ? Math.round(leader.points) + ' баллов' : 'нет данных'}</em>
    </div>
    <div class="race-summary-item">
      <span class="race-summary-label">Участников</span>
      <b>${data.total_participants || visible.length}</b>
      <em>${_raceState.mode === 'my_zone' ? 'в вашей зоне' : 'в выборке'}</em>
    </div>
    <div class="race-summary-item">
      <span class="race-summary-label">Средний балл</span>
      <b>${avg}</b>
      <em>по показанным</em>
    </div>
    <div class="race-summary-item race-summary-item-accent">
      <span class="race-summary-label">Ваш результат</span>
      <b>${currentPoints ?? '—'}</b>
      <em>${nextGap && nextGap > 0 ? `до следующего ${nextGap}` : 'позиция актуальна'}</em>
    </div>
  </div>`;
}

/* Цвет машинки по месту: топ-1/2/3 — особые цвета, текущий оператор — синий,
   остальные — циклически по палитре (используем реальные PNG-иконки болидов). */
const RACE_CAR_IMAGES = {
  current: 'img/cars/blue.webp',
  rank1:   'img/cars/yellow.webp',  // золото/лидер
  rank2:   'img/cars/green.webp',   // серебро (зелёный — нейтральный, не путать с топ-1)
  rank3:   'img/cars/orange.webp',  // бронза
  default: ['img/cars/purple.webp', 'img/cars/red.webp'],
};

function raceCarImageSrc(rank, isCurrentUser) {
  if (isCurrentUser) return RACE_CAR_IMAGES.current;
  if (rank === 1) return RACE_CAR_IMAGES.rank1;
  if (rank === 2) return RACE_CAR_IMAGES.rank2;
  if (rank === 3) return RACE_CAR_IMAGES.rank3;
  const palette = RACE_CAR_IMAGES.default;
  return palette[rank % palette.length];
}

function raceCarRankClass(rank, isCurrentUser) {
  if (isCurrentUser) return 'is-current-user';
  if (rank === 1) return 'rank-1';
  if (rank === 2) return 'rank-2';
  if (rank === 3) return 'rank-3';
  return 'default';
}

function renderRaceChart(items) {
  const maxPoints = Math.max(...items.map(i => i.points), 1);
  const rawMax = maxPoints * 1.3;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax || 1)));
  const niceMax = Math.ceil(rawMax / (magnitude / 2)) * (magnitude / 2) || 100;
  const ticks = [];
  for (let v = 0; v <= niceMax; v += niceMax / 5) ticks.push(Math.round(v));

  // ── Геометрия столбца сверху вниз (от верха контейнера к низу) ──
  // [ цифра баллов ]  18px текста + 6px зазор до машинки
  // [ зазор 6px ]
  // [ машинка ]        36px макс. высота (растёт вверх от carBottom)
  // [ зазор 14px ]     визуальный воздух между машинкой и верхом столбца
  // [ столбец ]        высота = barH, пропорциональна баллам
  // [ подпись инициалов ]  внизу, в зоне padBottom

  const labelH = 24;     // высота строки с цифрой баллов
  const labelGap = 8;    // зазор между цифрой и машинкой
  const carH = 44;       // максимальная высота машинки
  const carGap = 12;     // зазор между машинкой и верхом столбца
  const padTop = labelH + labelGap + carH + carGap + 10;
  const padBottom = 58;
  const plotH = items.length <= 12 ? 228 : 216;
  const chartH = plotH + padTop + padBottom;
  const usableH = plotH;

  const n = items.length;
  const barW = n <= 6 ? 64 : n <= 12 ? 54 : 42;
  const gap = n <= 6 ? 28 : n <= 12 ? 20 : 14;
  const stretch = n <= 12;

  return `<div class="race-chart-scroll">
    <div class="race-chart ${stretch ? 'race-chart-stretch' : ''}" style="height:${chartH}px">
      <div class="race-axis-labels" style="height:${usableH}px;margin-top:${padTop}px">
        ${ticks.slice().reverse().map(t => `<div class="race-axis-tick">${t}</div>`).join('')}
      </div>
      <div class="race-bars-area" style="height:${chartH}px;gap:${gap}px;${stretch ? '' : `min-width:${n * (barW+gap) + 40}px`}">
        ${ticks.map((t,i) => i>0 ? `<div class="race-grid-line" style="bottom:${padBottom + (t/niceMax)*usableH}px"></div>` : '').join('')}
        ${items.map(it => {
          const barH = Math.max(4, (it.points / niceMax) * usableH);
          const rankClass = raceCarRankClass(it.rank, it.is_current_user);
          const colWidth = stretch ? `calc((100% - ${(n-1)*gap}px) / ${n})` : `${barW}px`;
          // carBottom — нижняя точка машинки (она сама растёт вверх на свою высоту через CSS transform)
          const labelBottom = padBottom + barH + carGap;
          // labelBottom — нижний край текста, должен быть выше верха машинки (carBottom + carH) + зазор
          const carBottom = labelBottom + labelH + labelGap;
          return `<div class="race-col ${rankClass} ${it.is_current_user?'race-col-me':''}" style="width:${colWidth};flex:${stretch?'1 1 0':'0 0 auto'}" data-race-operator="${it.operator_id}"
              title="${esc(it.full_name)}${it.group?' · '+esc(it.group):''} · место #${it.rank} · ${Math.round(it.points)} баллов">
            <div class="race-points-label" style="bottom:${labelBottom}px">${Math.round(it.points)}</div>
            <img class="race-car-icon ${rankClass}" style="bottom:${carBottom}px" src="${raceCarImageSrc(it.rank, it.is_current_user)}" alt="" loading="lazy">
            <div class="race-bar ${it.is_current_user?'race-bar-me':''} ${rankClass}" style="height:${barH}px;bottom:${padBottom}px"></div>
            <div class="race-x-label ${it.is_current_user?'race-x-label-me':''}">
              <span>${esc(it.initials)}</span>
              <small>#${it.rank}</small>
              ${it.is_current_user ? '<div class="race-you-tag">Вы</div>' : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function renderRaceMyCard(cu, note, visibleItems) {
  const hasOwnOperatorRecord = Boolean(STATE.user?.operator_id);
  if (!hasOwnOperatorRecord) {
    // У управленческого аккаунта (admin/manager/supervisor) нет личного
    // места в рейтинге операторов — карточка "Ваш результат" здесь
    // бессмысленна, поэтому просто не показываем её вовсе.
    return '';
  }
  if (!cu) {
    return `<div class="rating-card race-side-card"><div class="rcard-title">Ваш результат</div>
      <div class="r-empty-state"><div>Ваши баллы за выбранный период пока не рассчитаны.</div></div>
    </div>`;
  }

  let hint;
  if (cu.rank === 1) {
    const nextBest = visibleItems?.find(i => !i.is_current_user);
    const gap = nextBest ? Math.round(cu.points - nextBest.points) : null;
    hint = gap != null
      ? `Вы лидер рейтинга. Ближайший оператор отстаёт на ${gap} баллов.`
      : `Вы лидер рейтинга. Удерживайте позицию.`;
  } else if (cu.points_to_next_rank != null && cu.points_to_next_rank > 0) {
    const above = visibleItems?.find(i => i.rank === cu.rank - 1);
    hint = above
      ? `Чтобы обогнать ${esc(above.full_name)}, нужно набрать ещё ${Math.round(cu.points_to_next_rank)} баллов.`
      : `До следующего места: <b>${Math.round(cu.points_to_next_rank)} баллов</b>`;
  } else {
    hint = '—';
  }

  const below = visibleItems?.filter(i => !i.is_current_user && i.points < cu.points).length ?? null;
  const nearestAbove = visibleItems?.filter(i => !i.is_current_user && i.points > cu.points).sort((a,b)=>a.points-b.points)[0];

  return `<div class="rating-card race-side-card">
    <div class="rcard-title">Ваш результат</div>
    ${cu.outside_selected_group ? `<div class="race-note">${esc(note || 'Вы не входите в выбранную группу.')}</div>` : ''}
    <div class="rms-list">
      <div class="rms-row"><span class="rms-label">Место</span><span class="rms-val">#${cu.rank} из ${cu.total_participants}</span></div>
      <div class="rms-row"><span class="rms-label">Баллы</span><span class="rms-val accent">${Math.round(cu.points)}</span></div>
      <div class="rms-row"><span class="rms-label">Группа</span><span class="rms-val">${esc(cu.group||'—')}</span></div>
      ${cu.points_to_top_3 != null && cu.points_to_top_3 > 0 ? `<div class="rms-row"><span class="rms-label">До топ-3</span><span class="rms-val">${Math.round(cu.points_to_top_3)} баллов</span></div>` : ''}
      <div class="rms-row"><span class="rms-label">Изменение</span><span class="rms-val">${cu.rank_change!=null ? (cu.rank_change>0?`<span class="rd-up">↑ +${cu.rank_change}</span>`:cu.rank_change<0?`<span class="rd-down">↓ ${Math.abs(cu.rank_change)}</span>`:'<span class="rd-neutral">без изменений</span>') : '—'}</span></div>
    </div>
    ${below != null ? `<div class="race-extra-line">Вы опережаете ${below} операторов${nearestAbove ? ` · отстаёте от ближайшего на ${Math.round(nearestAbove.points - cu.points)} баллов` : ''}</div>` : ''}
    <div class="race-hint">${hint}</div>
  </div>`;
}

function renderRaceTopTable(items, cu) {
  const myPoints = cu ? cu.points : null;
  return `<div class="rating-card race-side-card">
    <div class="rcard-title">Топ операторов</div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>#</th><th>Оператор</th><th>Группа</th><th class="num">Баллы</th><th class="num">Разница с вами</th></tr></thead>
      <tbody>
        ${items.slice(0, 10).map(it => {
          const diff = myPoints != null ? Math.round(it.points - myPoints) : null;
          const diffHtml = it.is_current_user ? '—' : (diff == null ? '—' : (diff > 0 ? `<span style="color:var(--danger)">+${diff}</span>` : diff < 0 ? `<span style="color:var(--success)">${diff}</span>` : '0'));
          return `<tr class="${it.is_current_user?'rating-my-row':''}">
            <td>${it.rank}</td>
            <td class="name-cell">${it.is_current_user?'Вы':esc(it.full_name)}</td>
            <td>${esc(it.group||'—')}</td>
            <td class="num"><b>${Math.round(it.points)}</b></td>
            <td class="num">${diffHtml}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
  </div>`;
}

/* ── Вкладка: Сравнение групп ────────────────────────────────────*/
async function renderRatingGroupsTab(content) {
  const data = await fetchRace({ mode: 'all' });
  const groups = data.groups || [];
  const cu = data.current_user;

  if (!groups.length) {
    content.innerHTML = `<div class="rating-card"><div class="empty-line">Нет данных для сравнения групп</div></div>`;
    return;
  }

  const rows = groups.map(g => ({ label: g.group, value: g.avg_points, isMe: false }));
  if (cu) rows.push({ label: 'Вы', value: cu.points, isMe: true });
  rows.sort((a,b) => b.value - a.value);
  const maxV = Math.max(...rows.map(r => r.value), 1);

  content.innerHTML = `
    <div class="rating-card">
      <div class="rcard-title">Сравнение групп</div>
      <div class="an-bar-chart">
        ${rows.map(r => `<div class="an-bar-row">
          <div class="an-bar-date" style="width:120px;${r.isMe?'font-weight:700;color:var(--accent-primary)':''}">${esc(r.label)}</div>
          <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round((r.value/maxV)*100)}%;${r.isMe?'background:var(--accent-primary)':''}"></div></div>
          <div class="an-bar-val">${Math.round(r.value)}</div>
        </div>`).join('')}
      </div>
    </div>
  `;
}

/* ── Вкладка: Мой прогресс ───────────────────────────────────────*/
async function renderRatingProgressTab(content) {
  const role = STATE.user?.role || 'operator';
  const isOp = role === 'operator';

  if (!isOp) {
    content.innerHTML = `<div class="rating-card"><div class="empty-line">Выберите оператора во вкладке «Общий рейтинг», чтобы увидеть прогресс</div></div>`;
    return;
  }

  try {
    const dyn = await api.getMyRatingDynamics('place', 8);
    content.innerHTML = `<div class="rating-card">
      <div class="rcard-title">Динамика места за последние недели</div>
      ${renderDynamics ? renderDynamics(dyn) : '<div class="empty-line">Нет данных</div>'}
    </div>`;
  } catch(e) {
    content.innerHTML = `<div class="rating-card"><div class="empty-line">Нет данных о прогрессе</div></div>`;
  }
}

window.renderRating = renderRating;

const WHEEL_PRIZE_ICON = {
  coins: '₡', shop_discount: '%', extra_ticket: '+1', badge: '★', manual_reward: '!',
};
const WHEEL_FAST_MS = 900;
const WHEEL_TTL_MS = 45_000;
const WHEEL_STATIC_TTL_MS = 5 * 60_000;

function wheelCachedFetch(key, fetcher, fallback, onFresh, ttlMs = WHEEL_TTL_MS) {
  const cached = swrReadRaw(key);
  const saveFresh = (fresh, previous) => {
    const changed = JSON.stringify(fresh) !== JSON.stringify(previous);
    swrWriteRaw(key, { data: fresh, ts: Date.now() });
    if (changed && onFresh) onFresh(fresh);
  };
  if (cached) {
    if (Date.now() - cached.ts > ttlMs) {
      fetcher().then(fresh => saveFresh(fresh, cached.data)).catch(() => {});
    }
    return Promise.resolve(cached.data);
  }
  let returnedFallback = false;
  const request = fetcher()
    .then(fresh => {
      swrWriteRaw(key, { data: fresh, ts: Date.now() });
      if (returnedFallback && onFresh) onFresh(fresh);
      return fresh;
    })
    .catch(() => fallback);
  return withTimeout(request, WHEEL_FAST_MS, 'wheel-fast-timeout').catch(() => {
    returnedFallback = true;
    request.catch(() => {});
    return fallback;
  });
}

function wheelRefreshIfTab(tab, renderer, body) {
  if (STATE.currentView === 'wheel' && _wheelStaffTab === tab) renderer(body);
}

function wheelLoadingPanel(title = 'Загрузка Wheel of WOW') {
  return `<div class="panel wheel-admin-panel"><div class="wheel-admin-content"><div class="wheel-fast-loading"><div class="loading-spinner"></div><strong>${esc(title)}</strong><span>Экран открывается сразу, данные обновятся в фоне.</span></div></div></div>`;
}

function wheelPrizeTypeLabel(t) {
  return {
    coins: 'коины', xp: 'XP', shop_discount: 'скидка', extra_ticket: 'билет',
    spin_token: 'ещё вращение', badge: 'бейдж', raffle_ticket: 'розыгрыш',
    status: 'статус', manual_reward: 'приз', empty_consolation: 'приз',
  }[t] || t;
}

function wheelCleanText(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  const mojibakeScore = (text.match(/[РС][\u0400-\u04FF]?/g) || []).length;
  if (mojibakeScore >= 3 || /вЂ|Рџ|Рљ|РЈ|Рќ|РЎ|Р“|Р’/.test(text)) return fallback;
  return text;
}

function wheelPrizePresentation(prize) {
  const type = prize?.type || prize?.prize_type || '';
  const amount = Number(prize?.amount || 0);
  const title = wheelCleanText(prize?.title || prize?.prize, 'Приз Wheel of WOW');
  const map = {
    coins: {
      badge: `+${amount}`,
      line1: `+${amount}`,
      line2: amount === 1 ? 'коин' : 'коинов',
      description: 'Коины сразу поступят на ваш баланс.',
    },
    shop_discount: {
      badge: `${amount}%`,
      line1: `${amount}%`,
      line2: 'скидка',
      description: 'Скидка будет доступна для покупки в магазине.',
    },
    extra_ticket: {
      badge: '+1',
      line1: '+1',
      line2: 'билет',
      description: 'Дополнительная попытка вращения колеса.',
    },
    spin_token: {
      badge: '+1',
      line1: 'Ещё',
      line2: 'вращение',
      description: 'Ещё одна попытка вращения колеса.',
    },
    badge: {
      badge: 'B',
      line1: 'Бейдж',
      line2: 'дня',
      description: 'Памятный бейдж появится в вашем профиле.',
    },
    raffle_ticket: {
      badge: 'R',
      line1: 'Билет',
      line2: 'розыгрыша',
      description: 'Билет автоматически добавится в активный розыгрыш.',
    },
    manual_reward: {
      badge: 'WOW',
      line1: 'Особый',
      line2: 'приз',
      description: 'Руководитель свяжется с вами для вручения приза.',
    },
    status: {
      badge: 'S',
      line1: 'Особый',
      line2: 'статус',
      description: 'Специальный статус оператора.',
    },
  };
  return { title, color: prize?.color || '#1F8FFF', ...(map[type] || {
    badge: 'WOW', line1: title.split(' ')[0] || 'Приз', line2: title.split(' ').slice(1, 3).join(' '),
    description: 'Описание и порядок получения указаны в названии приза.',
  }) };
}

function buildWheelPrizeCatalog(items) {
  return `<div class="wheel-v2-prize-list">${items.map(prize => {
    const ui = wheelPrizePresentation(prize);
    return `<article class="wheel-v2-prize-item">
      <span class="wheel-v2-prize-mark" style="--prize-color:${esc(ui.color)}">${esc(ui.badge)}</span>
      <div><b>${esc(ui.title)}</b><small>${esc(ui.description)}</small></div>
    </article>`;
  }).join('')}</div>`;
}

function wheelTicketGuide() {
  return `<div class="wheel-v2-guide">
    <span>Получить билет можно за:</span>
    <div><b>01</b> дневную цель</div>
    <div><b>02</b> место в топ-3</div>
    <div><b>03</b> выдачу руководителем</div>
  </div>`;
}

function renderWheel() {
  const el = document.getElementById('view-wheel');
  if (!el) return;
  const role = STATE.user?.role || 'operator';
  if (isAdmin(role)) {
    renderWheelStaffView(el);
  } else {
    renderWheelOperatorView(el);
  }
}

/* ---------- Оператор: колесо ---------- */
async function renderWheelOperatorView(el) {
  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Геймификация</div>
        <h2 class="section-title">Wheel of WOW</h2>
      </div>
    </div>
    <div class="panel"><div class="empty-state"><div class="loading-spinner"></div><p>Загрузка колеса…</p></div></div>`;

  const fallbackStatus = { __fallback: true, campaign: { id: 0, title: 'Wheel of WOW' }, available_tickets: 0, spins_used_today: 0, max_spins_per_day: 0, spins_used_this_week: 0, max_spins_per_week: 0, can_spin: false };
  const fallbackItems = { __fallback: true, items: [] };
  const fallbackHistory = { items: [] };
  const rerenderFresh = () => { if (STATE.currentView === 'wheel' && !isAdmin(STATE.user?.role || 'operator')) renderWheelOperatorView(el); };
  const [status, prizes, history] = await Promise.all([
    wheelCachedFetch('wheel:status', () => api.getWheelStatus(), fallbackStatus, rerenderFresh, WHEEL_TTL_MS),
    wheelCachedFetch('wheel:prizes', () => api.getWheelPrizes(), fallbackItems, rerenderFresh, WHEEL_STATIC_TTL_MS),
    wheelCachedFetch('wheel:my-history', () => api.getWheelMyHistory().catch(() => ({ items: [] })), fallbackHistory, rerenderFresh, WHEEL_TTL_MS),
  ]);

  const items = prizes.items || [];
  if (status.__fallback || prizes.__fallback) {
    el.innerHTML = `<div class="view-header"><h2 class="section-title">Wheel of WOW</h2></div>${wheelLoadingPanel('Готовим колесо')}`;
    return;
  }
  if (!status.campaign || !items.length) {
    el.innerHTML = `<div class="view-header"><h2 class="section-title">Wheel of WOW</h2></div>
      <div class="panel"><div class="empty-state"><p>Колесо сейчас недоступно. Загляните позже.</p></div></div>`;
    return;
  }

  const tickets = status.available_tickets || 0;
  // Единый источник истины — backend (ТЗ п.13/17). Если поля нет (старый
  // ответ), падаем на прежний расчёт по лимитам.
  const canSpin = (typeof status.can_spin === 'boolean')
    ? status.can_spin
    : (tickets > 0
        && (!status.max_spins_per_day || status.spins_used_today < status.max_spins_per_day)
        && (!status.max_spins_per_week || status.spins_used_this_week < status.max_spins_per_week));
  const cannotReason = status.reason_if_cannot_spin || (tickets > 0 ? 'Лимит на сегодня исчерпан' : 'Нет билетов');

  const safeCannotReason = wheelCleanText(
    status.reason_if_cannot_spin,
    tickets > 0 ? 'Лимит на сегодня исчерпан' : 'Нет доступных прокруток'
  );
  const safeNextTicketReason = wheelCleanText(status.next_ticket_reason);

  el.innerHTML = `
    <div class="view-header wheel-v2-header">
      <div>
        <div class="section-kicker">Геймификация</div>
        <h2 class="section-title">Колесо наград</h2>
        <p class="wheel-v2-subtitle">Используйте билет и получите один из призов Wheel of WOW</p>
      </div>
      <div class="wheel-v2-counters">
        <div><span>Билеты</span><b id="wheel-ticket-count-value">${tickets}</b></div>
        <div><span>Сегодня</span><b id="wheel-today-limit">${status.spins_used_today} из ${status.max_spins_per_day || '∞'}</b></div>
        <div><span>Неделя</span><b id="wheel-week-limit">${status.spins_used_this_week} из ${status.max_spins_per_week || '∞'}</b></div>
      </div>
    </div>

    <div class="wheel-v2-layout">
      <section class="panel wheel-v2-stage-panel">
        <div class="wheel-v2-panel-head">
          <div><span>Ваш билет</span><h3>${canSpin ? 'Всё готово к вращению' : 'Сначала получите билет'}</h3></div>
          <span class="wheel-v2-status ${canSpin ? 'is-ready' : ''}">${canSpin ? 'Доступно' : 'Нет билета'}</span>
        </div>
        <div class="wheel-v2-stage-body">
          <div class="wheel-stage">
            <div class="wheel-pointer wheel-pointer-v2" aria-hidden="true"></div>
            <div class="wheel-rotor" id="wheel-rotor">${buildWheelSvg(items)}</div>
            <div class="wheel-hub"><span>Puls</span><b>WOW</b></div>
          </div>
          <div class="wheel-v2-action">
            <div class="wheel-v2-ticket-summary">
              <span>Доступно вращений</span>
              <strong>${tickets}</strong>
              <small>${safeNextTicketReason ? `Билет получен: ${esc(safeNextTicketReason)}` : esc(safeCannotReason)}</small>
            </div>
            <button class="btn-primary wheel-spin-btn" id="wheel-spin-btn" ${canSpin ? '' : 'disabled'}>
              ${canSpin ? 'Использовать билет' : 'Нет доступных билетов'}
            </button>
            ${!canSpin ? wheelTicketGuide() : '<p class="wheel-v2-action-note">После нажатия колесо остановится на одном из указанных призов.</p>'}
          </div>
        </div>
      </section>

      <section class="panel wheel-v2-prizes-panel">
        <div class="wheel-v2-panel-head"><div><span>Состав колеса</span><h3>Что можно выиграть</h3></div><b>${items.length} призов</b></div>
        ${buildWheelPrizeCatalog(items)}
        <p class="wheel-v2-prize-note">Каждый активный сектор приносит приз. Пустых секторов в колесе нет.</p>
      </section>
    </div>

    <section class="panel wheel-v2-history-panel">
      <div class="wheel-v2-panel-head"><div><span>История</span><h3>Мои выигрыши</h3></div><b>${(history.items || []).length} записей</b></div>
      <div id="wheel-history-body">${buildWheelHistory(history.items || [])}</div>
    </section>`;

  // Раскладываем сектора по кругу для дальнейшего расчёта угла остановки
  STATE.wheel = { items, rotation: 0, spinning: false };

  const btn = document.getElementById('wheel-spin-btn');
  if (btn) btn.textContent = canSpin ? 'Использовать билет' : 'Нет доступных билетов';
  if (btn && canSpin) btn.onclick = () => doWheelSpin(el);
}

// Резервная палитра, если у приза не задан цвет
const WHEEL_FALLBACK_COLORS = ['#38BDF8', '#818CF8', '#A78BFA', '#F472B6', '#FB7185', '#FBBF24', '#34D399', '#22D3EE'];

// hex -> {r,g,b}
function wheelHexRgb(hex) {
  const h = String(hex || '').trim().replace('#', '');
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(s || '38bdf8', 16);
  if (Number.isNaN(n)) return { r: 56, g: 189, b: 248 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
// Осветлить (pct>0) или затемнить (pct<0) цвет — для объёмного градиента
function wheelShade(hex, pct) {
  const { r, g, b } = wheelHexRgb(hex);
  const t = pct < 0 ? 0 : 255;
  const p = Math.abs(pct);
  const mix = (c) => Math.round((t - c) * p + c);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
// Контрастный цвет подписи, чтобы читалась на любом секторе
function wheelTextColor(hex) {
  const { r, g, b } = wheelHexRgb(hex);
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.62 ? '#1E293B' : '#FFFFFF';
}

// Строит спокойное плоское колесо Puls с понятными двухстрочными названиями.
function buildWheelSvg(items) {
  const n = items.length;
  const cx = 160, cy = 160;
  const rOuter = 158;
  const rSeg = 148;
  const seg = 360 / n;
  let defs = '';
  let paths = '';
  let labels = '';

  for (let i = 0; i < n; i++) {
    const base = items[i].color || WHEEL_FALLBACK_COLORS[i % WHEEL_FALLBACK_COLORS.length];
    const a0 = i * seg, a1 = (i + 1) * seg;
    const p0 = wheelPoint(cx, cy, rSeg, a0);
    const p1 = wheelPoint(cx, cy, rSeg, a1);
    const large = seg > 180 ? 1 : 0;
    defs += `<linearGradient id="wheelSeg${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${wheelShade(base, 0.23)}"/><stop offset="100%" stop-color="${base}"/></linearGradient>`;
    paths += `<path d="M${cx},${cy} L${p0.x.toFixed(2)},${p0.y.toFixed(2)} A${rSeg},${rSeg} 0 ${large} 1 ${p1.x.toFixed(2)},${p1.y.toFixed(2)} Z" fill="url(#wheelSeg${i})" stroke="rgba(255,255,255,.92)" stroke-width="2" stroke-linejoin="round"/>`;
    const mid = a0 + seg / 2;
    const lp = wheelPoint(cx, cy, rSeg * 0.67, mid);
    const ui = wheelPrizePresentation(items[i]);
    labels += `<text x="${lp.x.toFixed(1)}" y="${(lp.y - 6).toFixed(1)}" text-anchor="middle" font-size="15" font-weight="800" fill="${wheelTextColor(base)}"><tspan x="${lp.x.toFixed(1)}">${esc(ui.line1)}</tspan><tspan x="${lp.x.toFixed(1)}" dy="16" font-size="9.5" font-weight="700">${esc(ui.line2)}</tspan></text>`;
  }

  return `<svg viewBox="0 0 320 320" class="wheel-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      ${defs}
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="#E2E8F0"/>
    <circle cx="${cx}" cy="${cy}" r="${rSeg + 3}" fill="#FFFFFF"/>
    ${paths}
    ${labels}
  </svg>`;
}

// Точка на окружности: угол в градусах, 0° = верх (12 часов), по часовой
function wheelPoint(cx, cy, r, deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildWheelHistory(rows) {
  if (!rows.length) return '<div class="wheel-history-empty"><p>Выигрышей пока нет. Используйте первый билет, и приз появится здесь.</p></div>';
  return `<ul class="wheel-history-list">${rows.map(r => `
    <li class="wheel-history-item">
      <span class="wheel-history-icon">${esc(wheelPrizePresentation({ type:r.prize_type, amount:r.amount, title:r.prize }).badge)}</span>
      <span class="wheel-history-main">
        <strong>${esc(r.prize)}</strong>
        <span class="wheel-history-reason">${esc(wheelPrizePresentation({ type:r.prize_type, amount:r.amount, title:r.prize }).description)}</span>
      </span>
      <span class="wheel-history-date">${esc(fmtDate(r.date))}</span>
    </li>`).join('')}</ul>`;
}

// Прокрутка: backend выбирает приз, frontend только докручивает колесо к нему
async function doWheelSpin(el) {
  const w = STATE.wheel;
  if (!w || w.spinning) return;
  const btn = document.getElementById('wheel-spin-btn');
  const rotor = document.getElementById('wheel-rotor');
  if (!rotor) return;

  w.spinning = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Крутим…'; }

  let result;
  try {
    result = await api.spinWheel();
    swrInvalidate('wheel:');
  } catch (err) {
    w.spinning = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Использовать билет'; }
    showToast(err.message || 'Не удалось прокрутить колесо', 'error');
    return;
  }

  // Индекс выигранного сектора
  const idx = w.items.findIndex(p => p.id === result.prize.id);
  const n = w.items.length;
  const seg = 360 / n;
  const safeIdx = idx >= 0 ? idx : 0;
  // Центр сектора относительно верхней стрелки; докручиваем так, чтобы он встал наверх.
  const center = safeIdx * seg + seg / 2;
  const jitter = (Math.random() - 0.5) * seg * 0.5; // лёгкий разброс внутри сектора
  const spins = 3; // полных оборотов — достаточно для эффекта при более быстрой анимации

  // Баг был здесь: раньше target считался как АБСОЛЮТНЫЙ угол (spins*360 - center),
  // то есть всегда попадал в один и тот же узкий диапазон ~[720°,1080°] независимо
  // от того, где колесо уже стоит. При второй и последующих прокрутках CSS-переход
  // просто анимировал крошечную разницу между «уже стоим на ~900°» и «новая цель
  // тоже ~900°» — визуально колесо чуть дёргалось вместо полного оборота. Правильно:
  // всегда крутить ВПЕРЁД от текущего угла минимум на spins полных оборотов.
  const desiredFinalAngle = (((360 - center - jitter) % 360) + 360) % 360;
  const currentAngle = ((w.rotation % 360) + 360) % 360;
  let forwardDelta = desiredFinalAngle - currentAngle;
  if (forwardDelta <= 0) forwardDelta += 360; // никогда не крутим назад и не остаёмся на месте
  const target = w.rotation + spins * 360 + forwardDelta;
  w.rotation = target;

  const SPIN_ANIMATION_MS = 2600; // держим синхронно с MIN_SECONDS_BETWEEN_SPINS на backend
  rotor.style.transition = `transform ${SPIN_ANIMATION_MS / 1000}s cubic-bezier(0.16, 1, 0.3, 1)`;
  rotor.style.transform = `rotate(${target}deg)`;

  setTimeout(() => {
    w.spinning = false;
    showWheelResultModal(result);
    // Обновляем статус и историю без полной перерисовки колеса (оно уже стоит на призе)
    refreshWheelSidebar(el);
  }, SPIN_ANIMATION_MS + 100);
}

function showWheelResultModal(result) {
  const ui = wheelPrizePresentation(result.prize);
  const html = `
    <div class="modal-overlay wheel-result-overlay" id="wheel-result-modal">
      <div class="modal-card wheel-result-card">
        <div class="wheel-result-icon">${esc(ui.badge)}</div>
        <span class="wheel-result-kicker">Ваш приз</span>
        <h3>Поздравляем</h3>
        <p class="wheel-result-prize">${esc(result.prize.title)}</p>
        <p class="wheel-result-msg">${esc(ui.description)}</p>
        ${result.reason ? `<p class="wheel-result-reason">Причина допуска: ${esc(result.reason)}</p>` : ''}
        ${result.prize.type === 'coins' ? '<p class="wheel-result-note">Коины уже добавлены на ваш баланс.</p>' : ''}
        <button class="btn-primary" onclick="document.getElementById('wheel-result-modal')?.remove()">Понятно</button>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function refreshWheelSidebar(el) {
  try {
    const [status, history] = await Promise.all([
      api.getWheelStatus(),
      api.getWheelMyHistory().catch(() => ({ items: [] })),
    ]);
    const histBody = document.getElementById('wheel-history-body');
    if (histBody) histBody.innerHTML = buildWheelHistory(history.items || []);
    const btn = document.getElementById('wheel-spin-btn');
    const tickets = status.available_tickets || 0;
    const canSpin = tickets > 0
      && (!status.max_spins_per_day || status.spins_used_today < status.max_spins_per_day)
      && (!status.max_spins_per_week || status.spins_used_this_week < status.max_spins_per_week);
    if (btn) {
      btn.disabled = !canSpin;
      btn.textContent = canSpin ? 'Использовать билет' : (tickets > 0 ? 'Лимит на сегодня исчерпан' : 'Нет доступных билетов');
      if (canSpin) btn.onclick = () => doWheelSpin(el);
    }
    const ticketCount = document.getElementById('wheel-ticket-count-value');
    if (ticketCount) ticketCount.textContent = String(tickets);
    const todayLimit = document.getElementById('wheel-today-limit');
    if (todayLimit) todayLimit.textContent = `${status.spins_used_today} из ${status.max_spins_per_day || '∞'}`;
    const weekLimit = document.getElementById('wheel-week-limit');
    if (weekLimit) weekLimit.textContent = `${status.spins_used_this_week} из ${status.max_spins_per_week || '∞'}`;
  } catch { /* тихо: колесо уже показало приз */ }
}

/* ---------- Супервайзер / руководитель ---------- */
let _wheelStaffTab = 'operations';

async function renderWheelStaffView(el) {
  if (!el.dataset.wheelRuleDelegated) {
    el.dataset.wheelRuleDelegated = '1';
    el.addEventListener('click', (event) => {
      const openRuleBtn = event.target.closest('#wr-open-create, [data-wheel-rule-open]');
      if (!openRuleBtn) return;
      event.preventDefault();
      const body = document.getElementById('wheel-staff-body');
      showWheelRuleModal(body);
    });
  }
  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Геймификация</div>
        <h2 class="section-title">Wheel of WOW</h2>
      </div>
    </div>
    <div class="filter-tabs wheel-tabs">
        <button class="filter-tab ${_wheelStaffTab === 'campaign' ? 'active' : ''}" data-wheel-tab="campaign">Кампания</button>
        <button class="filter-tab ${_wheelStaffTab === 'prizes' ? 'active' : ''}" data-wheel-tab="prizes">Сектора</button>
        <button class="filter-tab ${_wheelStaffTab === 'operations' || _wheelStaffTab === 'tickets' || _wheelStaffTab === 'history' || _wheelStaffTab === 'stats' ? 'active' : ''}" data-wheel-tab="operations">Операции</button>
        <button class="filter-tab ${_wheelStaffTab === 'rules' ? 'active' : ''}" data-wheel-tab="rules">Правила</button>
        <button class="filter-tab ${_wheelStaffTab === 'logs' ? 'active' : ''}" data-wheel-tab="logs">Логи</button>
        <button class="filter-tab ${_wheelStaffTab === 'issue' ? 'active' : ''}" data-wheel-tab="issue">Выдать билет</button>
    </div>
    <div id="wheel-staff-body">${wheelLoadingPanel()}</div>`;

  el.querySelectorAll('[data-wheel-tab]').forEach(b => {
    b.onclick = () => { _wheelStaffTab = b.dataset.wheelTab; renderWheelStaffView(el); };
  });

  const body = document.getElementById('wheel-staff-body');
  if (_wheelStaffTab === 'campaign') {
    await renderWheelCampaignTab(body);
  } else if (_wheelStaffTab === 'prizes') {
    await renderWheelPrizesTab(body);
  } else if (_wheelStaffTab === 'operations' || _wheelStaffTab === 'tickets' || _wheelStaffTab === 'history' || _wheelStaffTab === 'stats') {
    _wheelStaffTab = 'operations';
    await renderWheelOperationsTab(body);
  } else if (_wheelStaffTab === 'issue') {
    await renderWheelIssueTab(body);
  } else if (_wheelStaffTab === 'stats') {
    await renderWheelStatsTab(body);
  } else if (_wheelStaffTab === 'rules') {
    await renderWheelRulesTab(body);
  } else if (_wheelStaffTab === 'logs') {
    await renderWheelLogsTab(body);
  } else {
    _wheelStaffTab = 'operations';
    await renderWheelOperationsTab(body);
  }
}

/* ---------- Стафф: кампания (ТЗ 11.1) ---------- */
let _wheelCampaignEditId = null;

const WHEEL_PRIZE_TYPES = [
  ['coins', 'Коины'], ['shop_discount', 'Скидка в магазине'], ['extra_ticket', 'Доп. билет'],
  ['badge', 'Бейдж'], ['spin_token', 'Ещё вращение'], ['manual_reward', 'Ручной приз'],
];

async function renderWheelCampaignTab(body) {
  const data = await wheelCachedFetch(
    'wheel:admin:campaigns',
    () => api.getWheelCampaigns(),
    { __fallback: true, items: [] },
    () => wheelRefreshIfTab('campaign', renderWheelCampaignTab, body),
    WHEEL_STATIC_TTL_MS
  );
  if (data.__fallback) {
    body.innerHTML = wheelLoadingPanel('Загрузка кампании');
    return;
  }
  const items = data.items || [];
  if (!items.length) {
    body.innerHTML = `
      <div class="panel wheel-admin-panel">
        <div class="panel-head"><h3>Кампания колеса</h3></div>
        <div class="wheel-admin-content">
          <div class="empty-state wheel-empty"><p>Кампаний пока нет.</p></div>
          <button class="btn-primary" id="wheel-camp-create">Создать кампанию</button>
        </div>
      </div>`;
    document.getElementById('wheel-camp-create').onclick = () => createDefaultCampaign(body);
    return;
  }

  const current = items.find(c => c.is_active) || items[0];
  _wheelCampaignEditId = current.id;

  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head">
        <div>
          <h3>Настройки кампании</h3>
          <p class="panel-hint">Глобальные настройки колеса, лимиты прокруток и срок жизни билетов.</p>
        </div>
        <span class="badge badge-ok">активно всегда</span>
      </div>
      <div class="wheel-admin-content">
        <div class="wheel-campaign-shell">
          <section class="wheel-campaign-main">
            <div class="wheel-campaign-title-card">
              <label class="form-group">
                <span class="form-label">Название</span>
                <input type="text" id="wc-title" class="form-input" value="${esc(current.title)}" maxlength="200">
              </label>
              <label class="form-group">
                <span class="form-label">Описание</span>
                <input type="text" id="wc-desc" class="form-input" value="${esc(current.description || '')}">
              </label>
            </div>
            <div class="form-grid wheel-campaign-grid">
              <label class="form-group">
                <span class="form-label">Прокруток в день</span>
                <input type="number" id="wc-day" class="form-input" min="0" max="50" value="${current.max_spins_per_day}">
              </label>
              <label class="form-group">
                <span class="form-label">Прокруток в неделю</span>
                <input type="number" id="wc-week" class="form-input" min="0" max="200" value="${current.max_spins_per_week}">
              </label>
              <label class="form-group">
                <span class="form-label">Билет действует</span>
                <input type="number" id="wc-ttl" class="form-input" min="1" max="90" value="${current.ticket_ttl_days}">
              </label>
            </div>
          </section>

          <aside class="wheel-campaign-side">
            <div class="wheel-campaign-status is-active">
              <span>Колесо активно всегда</span>
              <strong>${esc(current.title)}</strong>
            </div>
            <div class="wheel-campaign-summary">
              <div><span>${current.max_spins_per_day}</span><p>в день</p></div>
              <div><span>${current.max_spins_per_week}</span><p>в неделю</p></div>
              <div><span>${current.ticket_ttl_days}</span><p>дней билет</p></div>
            </div>
            <div class="wheel-campaign-actions">
              <button class="btn-primary" id="wc-save">Сохранить</button>
            </div>
            <div id="wc-status" class="status-line"></div>
          </aside>
        </div>
      </div>
    </div>`;

  document.getElementById('wc-save').onclick = async () => {
    const statusEl = document.getElementById('wc-status');
    const payload = {
      title: document.getElementById('wc-title').value.trim(),
      description: document.getElementById('wc-desc').value.trim(),
      max_spins_per_day: parseInt(document.getElementById('wc-day').value, 10) || 0,
      max_spins_per_week: parseInt(document.getElementById('wc-week').value, 10) || 0,
      ticket_ttl_days: parseInt(document.getElementById('wc-ttl').value, 10) || 3,
      is_active: true,
      start_date: null,
      end_date: null,
    };
    if (!payload.title) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Укажите название'; return; }
    try {
      await api.updateWheelCampaign(current.id, payload);
      swrInvalidate('wheel:admin:campaigns');
      showToast('Кампания сохранена', 'ok');
      renderWheelCampaignTab(body);
    } catch (err) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = err.message || 'Не удалось сохранить';
    }
  };
}

async function createDefaultCampaign(body) {
  try {
    const c = await api.createWheelCampaign({
      title: 'Wheel of WOW', description: '', is_active: true,
      max_spins_per_day: 1, max_spins_per_week: 3, ticket_ttl_days: 3,
    });
    swrInvalidate('wheel:admin:campaigns');
    _wheelCampaignEditId = c.id;
    showToast('Кампания создана', 'ok');
    renderWheelCampaignTab(body);
  } catch (err) {
    showToast(err.message || 'Не удалось создать кампанию', 'error');
  }
}

/* ---------- Стафф: сектора (ТЗ 11.2) ---------- */
let _wheelSelectedPrizeIds = new Set();

async function renderWheelPrizesTab(body) {
  const data = await wheelCachedFetch(
    'wheel:admin:prizes',
    () => api.getWheelAdminPrizes(),
    { __fallback: true, items: [] },
    () => wheelRefreshIfTab('prizes', renderWheelPrizesTab, body),
    WHEEL_STATIC_TTL_MS
  );
  if (data.__fallback) {
    body.innerHTML = wheelLoadingPanel('Загрузка секторов');
    return;
  }
  const rows = data.items || [];
  _wheelSelectedPrizeIds = new Set([..._wheelSelectedPrizeIds].filter(id => rows.some(r => r.id === id)));
  const totalWeight = rows.filter(r => r.is_active).reduce((s, r) => s + (r.weight || 0), 0);
  const typeOptions = (val) => WHEEL_PRIZE_TYPES.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('');
  const chance = (w) => totalWeight > 0 ? Math.round((w / totalWeight) * 100) : 0;
  const typeOrder = new Map(WHEEL_PRIZE_TYPES.map(([value], index) => [value, index]));
  const groupedRows = [...rows]
    .sort((a, b) => {
      const typeDiff = (typeOrder.get(a.prize_type) ?? 999) - (typeOrder.get(b.prize_type) ?? 999);
      if (typeDiff) return typeDiff;
      if (Boolean(a.is_active) !== Boolean(b.is_active)) return a.is_active ? -1 : 1;
      const weightDiff = (b.weight || 0) - (a.weight || 0);
      if (weightDiff) return weightDiff;
      return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
    })
    .reduce((groups, row) => {
      let group = groups.find(item => item.type === row.prize_type);
      if (!group) {
        group = { type: row.prize_type, items: [] };
        groups.push(group);
      }
      group.items.push(row);
      return groups;
    }, []);
  const prizeRowHtml = (r) => `<tr data-prize-id="${r.id}">
            <td><input type="checkbox" class="wp-select" ${_wheelSelectedPrizeIds.has(r.id) ? 'checked' : ''}></td>
            <td><input type="color" class="wp-color" value="${esc(r.color || '#38BDF8')}"></td>
            <td><input type="text" class="form-input wp-title" value="${esc(r.title)}"></td>
            <td><select class="form-input wp-type">${typeOptions(r.prize_type)}</select></td>
            <td><input type="number" class="form-input wp-amount" value="${r.amount}"></td>
            <td><input type="number" class="form-input wp-weight" value="${r.weight}" min="0"></td>
            <td><span class="wheel-chance">${chance(r.is_active ? r.weight : 0)}%</span></td>
            <td><input type="number" class="form-input wp-maxtotal" value="${r.max_wins_total}" min="0" title="0 — без лимита"></td>
            <td><input type="number" class="form-input wp-maxop" value="${r.max_wins_per_operator}" min="0" title="0 — без лимита"></td>
            <td style="text-align:center"><input type="checkbox" class="wp-active" ${r.is_active ? 'checked' : ''}></td>
            <td><button class="btn-outline btn-sm wp-save">Сохранить</button></td>
          </tr>`;
  const prizeGroupHtml = (group) => {
    const activeItems = group.items.filter(r => r.is_active);
    const groupWeight = activeItems.reduce((sum, r) => sum + (r.weight || 0), 0);
    const groupChance = totalWeight > 0 ? Math.round((groupWeight / totalWeight) * 100) : 0;
    const rawLabel = wheelPrizeTypeLabel(group.type) || group.type || 'Другое';
    const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
    return `<tr class="wheel-prize-group-row"><td colspan="11">
              <div class="wheel-prize-group-title">
                <span class="wheel-prize-group-name">${esc(label)}</span>
                <span class="wheel-prize-group-meta">${group.items.length} сектор(ов) · активных ${activeItems.length} · вес ${groupWeight} · шанс ${groupChance}%</span>
              </div>
            </td></tr>${group.items.map(prizeRowHtml).join('')}`;
  };

  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head">
        <h3>Сектора колеса</h3>
        <span class="panel-badge">${rows.length} · сумма весов ${totalWeight}</span>
      </div>
      <div class="wheel-admin-content">
        <div class="wheel-bulk-bar ${_wheelSelectedPrizeIds.size ? 'is-visible' : ''}" id="wheel-bulk-bar">
          <span><b id="wheel-bulk-count">${_wheelSelectedPrizeIds.size}</b> выбрано</span>
          <button class="btn-outline btn-sm" id="wheel-bulk-disable">Отключить выбранные</button>
          <button class="btn-outline btn-sm" id="wheel-bulk-enable">Включить выбранные</button>
          <button class="btn-link" id="wheel-bulk-clear">Снять выбор</button>
        </div>
        <div class="table-wrap wheel-prizes-wrap"><table class="data-table wheel-prizes-table">
          <colgroup>
            <col class="wp-col-select"><col class="wp-col-color"><col class="wp-col-title"><col class="wp-col-type">
            <col class="wp-col-num"><col class="wp-col-num"><col class="wp-col-chance">
            <col class="wp-col-limit"><col class="wp-col-limit"><col class="wp-col-active"><col class="wp-col-action">
          </colgroup>
          <thead><tr>
            <th><input type="checkbox" id="wp-select-all" title="Выбрать все"></th>
            <th>Цвет</th><th>Название</th><th>Тип</th><th>Кол-во</th><th>Вес</th>
            <th title="Шанс выпадения">Шанс</th><th>Лимит всего</th><th>Лимит/оператор</th><th>Активен</th><th></th>
          </tr></thead>
          <tbody>
          ${groupedRows.map(prizeGroupHtml).join('') || '<tr><td colspan="11" class="empty-line">Секторов пока нет</td></tr>'}
          </tbody>
        </table></div>
        <div class="wheel-newprize">
          <h4 class="panel-subtitle">Добавить сектор</h4>
          <div class="form-grid wheel-newprize-grid">
            <label class="wheel-newprize-field"><span class="form-label">Название</span><input type="text" id="np-title" class="form-input" placeholder="Название"></label>
            <label class="wheel-newprize-field"><span class="form-label">Тип</span><select id="np-type" class="form-input">${typeOptions('coins')}</select></label>
            <label class="wheel-newprize-field"><span class="form-label">Кол-во</span><input type="number" id="np-amount" class="form-input" placeholder="Кол-во" value="1"></label>
            <label class="wheel-newprize-field"><span class="form-label">Вес</span><input type="number" id="np-weight" class="form-input" placeholder="Вес" value="10" min="0"></label>
            <label class="wheel-newprize-field"><span class="form-label">Цвет</span><input type="color" id="np-color" value="#38BDF8"></label>
            <button class="btn-primary" id="np-add">Добавить</button>
          </div>
          <div id="np-status" class="status-line" style="margin-top:8px"></div>
        </div>
        <div class="status-line muted" style="margin-top:10px">Сектор «ничего» запрещён (ТЗ п.6.3): минимальный приз — «+1 коин». Чтобы убрать сектор, выключите «Активен» (или выберите несколько и нажмите «Отключить выбранные»).</div>
      </div>
    </div>`;

  function updateBulkBar() {
    const bar = document.getElementById('wheel-bulk-bar');
    const count = document.getElementById('wheel-bulk-count');
    if (!bar || !count) return;
    count.textContent = _wheelSelectedPrizeIds.size;
    bar.classList.toggle('is-visible', _wheelSelectedPrizeIds.size > 0);
  }

  body.querySelectorAll('tr[data-prize-id]').forEach(tr => {
    const id = parseInt(tr.dataset.prizeId, 10);
    tr.querySelector('.wp-select').onchange = (e) => {
      if (e.target.checked) _wheelSelectedPrizeIds.add(id);
      else _wheelSelectedPrizeIds.delete(id);
      updateBulkBar();
    };
    tr.querySelector('.wp-save').onclick = async () => {
      const payload = {
        title: tr.querySelector('.wp-title').value.trim(),
        prize_type: tr.querySelector('.wp-type').value,
        amount: parseInt(tr.querySelector('.wp-amount').value, 10) || 0,
        weight: parseInt(tr.querySelector('.wp-weight').value, 10) || 0,
        color: tr.querySelector('.wp-color').value,
        max_wins_total: parseInt(tr.querySelector('.wp-maxtotal').value, 10) || 0,
        max_wins_per_operator: parseInt(tr.querySelector('.wp-maxop').value, 10) || 0,
        is_active: tr.querySelector('.wp-active').checked,
      };
      if (!payload.title) { showToast('Укажите название сектора', 'error'); return; }
      try {
        await api.updateWheelPrize(id, payload);
        swrInvalidate('wheel:admin:prizes');
        swrInvalidate('wheel:prizes');
        showToast('Сектор сохранён', 'ok');
        renderWheelPrizesTab(body);
      } catch (err) { showToast(err.message || 'Не удалось сохранить', 'error'); }
    };
  });

  document.getElementById('wp-select-all').onchange = (e) => {
    body.querySelectorAll('tr[data-prize-id]').forEach(tr => {
      const id = parseInt(tr.dataset.prizeId, 10);
      tr.querySelector('.wp-select').checked = e.target.checked;
      if (e.target.checked) _wheelSelectedPrizeIds.add(id); else _wheelSelectedPrizeIds.delete(id);
    });
    updateBulkBar();
  };

  async function bulkSetActive(isActive) {
    const ids = [..._wheelSelectedPrizeIds];
    if (!ids.length) return;
    const results = await Promise.allSettled(ids.map(id => api.updateWheelPrize(id, { is_active: isActive })));
    const failed = results.filter(r => r.status === 'rejected').length;
    swrInvalidate('wheel:admin:prizes');
    swrInvalidate('wheel:prizes');
    showToast(failed ? `Готово, но ${failed} не удалось` : `${isActive ? 'Включено' : 'Отключено'}: ${ids.length}`, failed ? 'error' : 'ok');
    _wheelSelectedPrizeIds.clear();
    renderWheelPrizesTab(body);
  }
  document.getElementById('wheel-bulk-disable').onclick = () => bulkSetActive(false);
  document.getElementById('wheel-bulk-enable').onclick = () => bulkSetActive(true);
  document.getElementById('wheel-bulk-clear').onclick = () => { _wheelSelectedPrizeIds.clear(); renderWheelPrizesTab(body); };

  document.getElementById('np-add').onclick = async () => {
    const statusEl = document.getElementById('np-status');
    const payload = {
      title: document.getElementById('np-title').value.trim(),
      prize_type: document.getElementById('np-type').value,
      amount: parseInt(document.getElementById('np-amount').value, 10) || 0,
      weight: parseInt(document.getElementById('np-weight').value, 10) || 0,
      color: document.getElementById('np-color').value,
    };
    if (!payload.title) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Укажите название'; return; }
    try {
      await api.createWheelPrize(payload);
      swrInvalidate('wheel:admin:prizes');
      swrInvalidate('wheel:prizes');
      showToast('Сектор добавлен', 'ok');
      renderWheelPrizesTab(body);
    } catch (err) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = err.message || 'Не удалось добавить';
    }
  };
}

/* ---------- Стафф: билеты (ТЗ 12.3, 17) ---------- */
let _wheelTicketFilter = '';
async function renderWheelOperationsTab(body) {
  body.innerHTML = `<div class="panel wheel-admin-panel"><div class="empty-state"><div class="loading-spinner"></div></div></div>`;
  const ticketKey = `wheel:admin:tokens:${_wheelTicketFilter || 'all'}`;
  const rerender = () => wheelRefreshIfTab('operations', renderWheelOperationsTab, body);
  const [ticketsData, spinsData, stats] = await Promise.all([
    wheelCachedFetch(ticketKey, () => api.getWheelTokens(_wheelTicketFilter ? { token_status: _wheelTicketFilter, limit: 80 } : { limit: 80 }), { __fallback: true, items: [] }, rerender),
    wheelCachedFetch('wheel:admin:spins', () => api.getWheelSpins({ limit: 80 }), { __fallback: true, items: [] }, rerender),
    wheelCachedFetch('wheel:admin:stats', () => api.getWheelStats(), { __fallback: true, tokens_issued: 0, tokens_used: 0, tokens_expired: 0, spins_completed: 0, coins_awarded: 0, manual_granted: 0, prizes_histogram: [], top_sources: [] }, rerender),
  ]);

  const tickets = ticketsData.items || [];
  const spins = spinsData.items || [];
  const statusBadge = { available: 'badge-ok', used: 'badge-muted', expired: 'badge-warning', cancelled: 'badge-muted' };
  const statusLabel = { available: 'доступен', used: 'использован', expired: 'истёк', cancelled: 'отменён' };
  const filters = [['', 'Все'], ['available', 'Доступные'], ['used', 'Использованные'], ['expired', 'Истёкшие'], ['cancelled', 'Отменённые']];
  const uniqueOperators = new Set(spins.map(r => r.operator_id).filter(Boolean)).size;

  body.innerHTML = `
    <div class="wheel-ops-shell">
      <div class="wheel-ops-hero">
        <div>
          <div class="section-kicker">Операции</div>
          <h3>Билеты, прокрутки и статистика</h3>
          <p>Единый контроль попыток Wheel of WOW без переключения между отдельными экранами.</p>
        </div>
        <button class="btn-primary" data-wheel-go-issue>Выдать билет</button>
      </div>

      <div class="wheel-metric-grid">
        <div class="wheel-metric"><span>${stats?.tokens_issued ?? 0}</span><p>попыток выдано сегодня</p></div>
        <div class="wheel-metric"><span>${stats?.tokens_used ?? 0}</span><p>использовано</p></div>
        <div class="wheel-metric"><span>${stats?.spins_completed ?? 0}</span><p>прокруток сегодня</p></div>
        <div class="wheel-metric"><span>${stats?.coins_awarded ?? 0}</span><p>коинов выдано</p></div>
        <div class="wheel-metric"><span>${uniqueOperators}</span><p>участников в истории</p></div>
      </div>

      <div class="wheel-ops-grid">
        <section class="panel wheel-admin-panel">
          <div class="panel-head">
            <h3>Билеты</h3>
            <span class="panel-badge">${tickets.length}</span>
          </div>
          <div class="wheel-admin-content">
            <div class="filter-tabs wheel-subtabs">
              ${filters.map(([f, l]) => `<button class="filter-tab ${_wheelTicketFilter === f ? 'active' : ''}" data-ticket-filter="${f}">${l}</button>`).join('')}
            </div>
            ${tickets.length ? `<div class="table-wrap wheel-table-wrap"><table class="data-table">
              <thead><tr><th>Оператор</th><th>Причина</th><th>Истекает</th><th>Статус</th></tr></thead>
              <tbody>${tickets.map(t => `<tr>
                <td class="name-cell"><strong>${esc(t.operator_name)}</strong><div class="muted-sm">${esc(fmtDateTime(t.created_at))}</div></td>
                <td>${esc(t.reason_text || wheelSourceLabel(t.reason_type) || '—')}<div class="muted-sm">${esc(wheelSourceLabel(t.reason_type))}</div></td>
                <td>${t.expires_at ? esc(fmtDateTime(t.expires_at)) : '—'}</td>
                <td><span class="badge ${statusBadge[t.status] || 'badge-muted'}">${statusLabel[t.status] || t.status}</span></td>
              </tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty-state wheel-empty"><p>Билетов пока нет.</p></div>'}
          </div>
        </section>

        <section class="panel wheel-admin-panel">
          <div class="panel-head">
            <h3>История прокруток</h3>
            <span class="panel-badge">${spins.length}</span>
          </div>
          <div class="wheel-admin-content">
            ${spins.length ? `<div class="table-wrap wheel-table-wrap"><table class="data-table">
              <thead><tr><th>Оператор</th><th>Приз</th><th>Причина</th><th>Дата</th></tr></thead>
              <tbody>${spins.map(r => `<tr>
                <td class="name-cell"><strong>${esc(r.operator_name)}</strong><div class="muted-sm">${esc(r.group_name || '—')}</div></td>
                <td><span class="wheel-type-pill">${esc(wheelPrizeTypeLabel(r.prize_type))}</span><div><strong>${esc(r.prize)}</strong></div></td>
                <td>${esc(r.reason || '—')}</td>
                <td>${esc(fmtDateTime(r.date))}</td>
              </tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty-state wheel-empty"><p>Прокруток пока нет.</p></div>'}
          </div>
        </section>
      </div>

      <section class="panel wheel-admin-panel">
        <div class="panel-head"><h3>Статистика по призам и источникам</h3></div>
        <div class="wheel-admin-content">
          <div class="two-col-grid">
            <div>
              <h4 class="panel-subtitle">Частота призов</h4>
              ${(stats?.prizes_histogram || []).length ? `<div class="wheel-chip-list">${stats.prizes_histogram.map(h => `<span class="wheel-data-chip"><strong>${esc(h.title)}</strong>${h.count}</span>`).join('')}</div>` : '<div class="empty-line">Прокруток сегодня нет</div>'}
            </div>
            <div>
              <h4 class="panel-subtitle">Источники попыток</h4>
              ${(stats?.top_sources || []).length ? `<div class="wheel-chip-list">${stats.top_sources.map(x => `<span class="wheel-data-chip"><strong>${esc(wheelSourceLabel(x.reason_type))}</strong>${x.count}</span>`).join('')}</div>` : '<div class="empty-line">Токенов сегодня не выдавалось</div>'}
            </div>
          </div>
        </div>
      </section>
    </div>`;

  body.querySelectorAll('[data-ticket-filter]').forEach(b => {
    b.onclick = () => { _wheelTicketFilter = b.dataset.ticketFilter; renderWheelOperationsTab(body); };
  });
  const issueBtn = body.querySelector('[data-wheel-go-issue]');
  if (issueBtn) issueBtn.onclick = () => { _wheelStaffTab = 'issue'; renderWheelStaffView(document.getElementById('view-wheel')); };
}

async function renderWheelTicketsTab(body) {
  let data;
  try {
    data = await api.getWheelTokens(_wheelTicketFilter ? { token_status: _wheelTicketFilter, limit: 300 } : { limit: 300 });
  } catch (err) {
    body.innerHTML = `<div class="panel"><div class="status-line status-error">${esc(err.message)}</div></div>`;
    return;
  }
  const rows = data.items || [];
  const statusBadge = { available: 'badge-ok', used: 'badge-muted', expired: 'badge-warning', cancelled: 'badge-muted' };
  const statusLabel = { available: 'доступен', used: 'использован', expired: 'истёк', cancelled: 'отменён' };
  const filters = [['', 'Все'], ['available', 'Доступные'], ['used', 'Использованные'], ['expired', 'Истёкшие'], ['cancelled', 'Отменённые']];

  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head"><h3>Билеты</h3><span class="panel-badge">${rows.length}</span></div>
      <div class="wheel-admin-content">
        <div class="filter-tabs" style="margin-bottom:14px">
          ${filters.map(([f, l]) => `<button class="filter-tab ${_wheelTicketFilter === f ? 'active' : ''}" data-ticket-filter="${f}">${l}</button>`).join('')}
        </div>
        ${rows.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Создан</th><th>Оператор</th><th>Причина</th><th>Источник</th><th>Истекает</th><th>Использован</th><th>Статус</th></tr></thead>
          <tbody>${rows.map(t => `<tr>
            <td>${esc(fmtDateTime(t.created_at))}</td>
            <td class="name-cell">${esc(t.operator_name)}</td>
            <td>${esc(t.reason_text || '—')}</td>
            <td>${esc(wheelSourceLabel(t.reason_type))}</td>
            <td>${t.expires_at ? esc(fmtDateTime(t.expires_at)) : '—'}</td>
            <td>${t.used_at ? esc(fmtDateTime(t.used_at)) : '—'}</td>
            <td><span class="badge ${statusBadge[t.status] || 'badge-muted'}">${statusLabel[t.status] || t.status}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty-state wheel-empty"><p>Билетов пока нет.</p></div>'}
      </div>
    </div>`;

  body.querySelectorAll('[data-ticket-filter]').forEach(b => {
    b.onclick = () => { _wheelTicketFilter = b.dataset.ticketFilter; renderWheelTicketsTab(body); };
  });
}

async function renderWheelSpinsTab(body) {
  let data;
  try {
    data = await api.getWheelSpins({ limit: 200 });
  } catch (err) {
    body.innerHTML = `<div class="panel"><div class="status-line status-error">${esc(err.message)}</div></div>`;
    return;
  }
  const rows = data.items || [];
  const totalCoins = rows.filter(r => r.prize_type === 'coins').reduce((s, r) => s + (r.amount || 0), 0);
  const uniqueOperators = new Set(rows.map(r => r.operator_id).filter(Boolean)).size;
  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head">
        <h3>История прокруток</h3>
        <span class="panel-badge">${rows.length} записей</span>
      </div>
      <div class="wheel-admin-content">
        <div class="wheel-stats-row">
          <div class="wheel-stat"><span class="wheel-stat-num">${rows.length}</span><span>прокруток</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${totalCoins}</span><span>коинов выдано</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${uniqueOperators}</span><span>участников</span></div>
        </div>
        ${rows.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Дата</th><th>Оператор</th><th>Группа</th><th>Причина</th><th>Приз</th><th>Тип</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td>${esc(fmtDateTime(r.date))}</td>
            <td class="name-cell">${esc(r.operator_name)}</td>
            <td>${esc(r.group_name || '—')}</td>
            <td>${esc(r.reason || '—')}</td>
            <td><strong>${esc(r.prize)}</strong></td>
            <td><span class="wheel-type-pill">${esc(wheelPrizeTypeLabel(r.prize_type))}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty-state wheel-empty"><p>Прокруток пока нет.</p></div>'}
      </div>
    </div>`;
}

/* ---------- Стафф: статистика (ТЗ 16) ---------- */
async function renderWheelStatsTab(body) {
  let s;
  try {
    s = await api.getWheelStats();
  } catch (err) {
    body.innerHTML = `<div class="panel"><div class="status-line status-error">${esc(err.message)}</div></div>`;
    return;
  }
  const hist = s.prizes_histogram || [];
  const src = s.top_sources || [];
  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head"><h3>Статистика за сегодня</h3></div>
      <div class="wheel-admin-content">
        <div class="wheel-stats-row">
          <div class="wheel-stat"><span class="wheel-stat-num">${s.tokens_issued}</span><span>выдано попыток</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${s.tokens_used}</span><span>использовано</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${s.tokens_expired}</span><span>сгорело</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${s.coins_awarded}</span><span>коинов выдано</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${s.manual_granted}</span><span>выдано вручную</span></div>
        </div>
        <div class="two-col-grid">
          <div>
            <h4 class="panel-subtitle">Частота призов</h4>
            ${hist.length ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Приз</th><th>Раз</th></tr></thead>
              <tbody>${hist.map(h => `<tr><td>${esc(h.title)}</td><td><strong>${h.count}</strong></td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty-line">Прокруток сегодня нет</div>'}
          </div>
          <div>
            <h4 class="panel-subtitle">Топ источников попыток</h4>
            ${src.length ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Источник</th><th>Токенов</th></tr></thead>
              <tbody>${src.map(x => `<tr><td>${esc(wheelSourceLabel(x.reason_type))}</td><td><strong>${x.count}</strong></td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty-line">Токенов сегодня не выдавалось</div>'}
          </div>
        </div>
      </div>
    </div>`;
}

function wheelSourceLabel(t) {
  return {
    tests: 'Тесты', period_reports: 'Расчёт периода', missions: 'Миссии',
    test_score: 'Тест дня', test_passed: 'Тест', simulation_passed: 'Симуляция',
    quality_score: 'Качество', no_late: 'Без опозданий', no_violations: 'Без нарушений',
    efficiency_percent: 'Эффективность', work_hours_percent: 'Норма часов',
    rating_place: 'Рейтинг', manual: 'Вручную', manual_grant: 'Ручная выдача',
    extra_ticket: 'Приз колеса',
  }[t] || t;
}

/* ---------- Стафф: правила (ТЗ 15) ---------- */
const WHEEL_RULE_SOURCE_OPTIONS = [
  ['tests', 'Тесты'],
  ['period_reports', 'Расчёт периода'],
  ['missions', 'Миссии'],
  ['manual', 'Ручной источник'],
];
const WHEEL_RULE_METRIC_OPTIONS = [
  ['test_score', 'Результат теста'],
  ['quality_avg', 'Качество звонков'],
  ['late_minutes', 'Минуты опозданий'],
  ['efficiency_percent', 'Эффективность'],
  ['work_hours_percent', 'Норма часов'],
  ['rating_place', 'Место в рейтинге'],
  ['simulation_passed', 'Симуляция пройдена'],
  ['custom', 'Свой показатель'],
];

async function renderWheelRulesTab(body) {
  const data = await wheelCachedFetch(
    'wheel:admin:rules',
    () => api.getWheelRules(),
    { __fallback: true, items: [] },
    () => wheelRefreshIfTab('rules', renderWheelRulesTab, body),
    WHEEL_STATIC_TTL_MS
  );
  if (data.__fallback) {
    body.innerHTML = wheelLoadingPanel('Загрузка правил');
    return;
  }
  const rows = data.items || [];
  const opLabel = { gte: '≥', lte: '≤', eq: '=', between: 'между', is_true: 'да' };
  body.innerHTML = `
    <section class="panel wheel-admin-panel wheel-rules-panel">
      <div class="panel-head wheel-rules-head">
        <div>
          <h3>Правила выдачи попыток</h3>
          <p class="panel-hint">Условия, по которым операторы получают билеты Wheel of WOW.</p>
        </div>
        <div class="wheel-head-actions">
          <span class="panel-badge">${rows.length}</span>
          <button class="btn-primary btn-sm" id="wr-open-create" type="button" data-wheel-rule-open onclick="window.openWheelRuleModal?.(); return false;">Добавить правило</button>
        </div>
      </div>
      <div class="wheel-admin-content">
        ${rows.length ? `<div class="table-wrap wheel-table-wrap wheel-rules-table-wrap"><table class="data-table wheel-rules-table">
          <thead><tr><th>Правило</th><th>Источник</th><th>Условие</th><th>Период</th><th>Лимит</th><th>TTL</th><th>Статус</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td><strong>${esc(r.title)}</strong><div class="muted-sm">${esc(r.code)}</div></td>
            <td><span class="wheel-type-pill">${esc(wheelSourceLabel(r.source_module))}</span></td>
            <td>${esc(r.metric_key || r.rule_type)} ${esc(opLabel[r.operator] || r.operator)} ${esc(String(r.threshold_value))}${r.operator === 'between' && r.threshold_value_max != null ? '…' + esc(String(r.threshold_value_max)) : ''}</td>
            <td>${esc(r.period_type)}</td>
            <td>${r.max_tokens_per_period}</td>
            <td>${r.token_ttl_hours}ч</td>
            <td><span class="badge ${r.is_active ? 'badge-ok' : 'badge-muted'}">${r.is_active ? 'активно' : 'выкл'}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty-state wheel-empty"><p>Правил пока нет.</p></div>'}
      </div>
    </section>`;

  const btn = body.querySelector('#wr-open-create');
  if (btn) {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showWheelRuleModal(body);
    });
  }
}

function showWheelRuleModal(body) {
  document.getElementById('wheel-rule-modal')?.remove();
  const sourceOptions = WHEEL_RULE_SOURCE_OPTIONS.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  const metricOptions = WHEEL_RULE_METRIC_OPTIONS.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  const modal = document.createElement('div');
  modal.className = 'modal-overlay wheel-rule-modal-overlay';
  modal.id = 'wheel-rule-modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-card wheel-rule-modal" role="dialog" aria-modal="true" aria-labelledby="wheel-rule-modal-title">
      <div class="modal-head wheel-rule-modal-head">
        <div>
          <div class="section-kicker">Wheel of WOW</div>
          <h3 class="modal-title" id="wheel-rule-modal-title">Добавить правило</h3>
          <p class="panel-hint">Настройте условие, лимит и срок действия билета.</p>
        </div>
        <button class="modal-close" type="button" data-wheel-rule-close aria-label="Закрыть">×</button>
      </div>
      <div class="wheel-rule-modal-body">
        <div class="form-grid wheel-rule-modal-grid">
          <label class="form-group wheel-rule-wide">
            <span class="form-label">Название</span>
            <input id="wr-title" class="form-input" placeholder="Например: Тест дня 80%+">
          </label>
          <label class="form-group">
            <span class="form-label">Код</span>
            <input id="wr-code" class="form-input" placeholder="test_score_80">
          </label>
          <label class="form-group">
            <span class="form-label">Источник</span>
            <select id="wr-source" class="form-input">${sourceOptions}</select>
          </label>
          <label class="form-group">
            <span class="form-label">Показатель</span>
            <select id="wr-metric" class="form-input">${metricOptions}</select>
          </label>
          <label class="form-group">
            <span class="form-label">Оператор</span>
            <select id="wr-operator" class="form-input">
              <option value="gte">Больше или равно</option>
              <option value="lte">Меньше или равно</option>
              <option value="eq">Равно</option>
              <option value="between">Между</option>
              <option value="is_true">Да/истина</option>
            </select>
          </label>
          <label class="form-group">
            <span class="form-label">Порог</span>
            <input id="wr-threshold" class="form-input" type="number" step="0.01" value="80">
          </label>
          <label class="form-group">
            <span class="form-label">Верхний порог</span>
            <input id="wr-threshold-max" class="form-input" type="number" step="0.01" placeholder="для «между»">
          </label>
          <label class="form-group">
            <span class="form-label">Период</span>
            <select id="wr-period" class="form-input">
              <option value="daily">День</option>
              <option value="weekly">Неделя</option>
              <option value="monthly">Месяц</option>
              <option value="once">Один раз</option>
            </select>
          </label>
          <label class="form-group">
            <span class="form-label">Лимит билетов</span>
            <input id="wr-limit" class="form-input" type="number" min="0" value="1">
          </label>
          <label class="form-group">
            <span class="form-label">TTL, часов</span>
            <input id="wr-ttl" class="form-input" type="number" min="1" value="24">
          </label>
          <label class="form-group">
            <span class="form-label">Приоритет</span>
            <input id="wr-priority" class="form-input" type="number" value="0">
          </label>
          <label class="wheel-toggle-row wheel-rule-toggle">
            <span><strong>Активно</strong><small>Правило начнёт выдавать билеты после сохранения.</small></span>
            <input id="wr-active" type="checkbox" checked>
          </label>
          <label class="form-group wheel-rule-wide">
            <span class="form-label">Описание</span>
            <input id="wr-description" class="form-input" placeholder="Коротко поясните, за что выдаётся билет">
          </label>
        </div>
      </div>
      <div class="modal-actions wheel-rule-modal-actions">
        <button class="btn-outline" type="button" id="wr-fill-quality">Шаблон качества 90+</button>
        <span id="wr-status" class="status-line"></span>
        <button class="btn-outline" type="button" data-wheel-rule-close>Отмена</button>
        <button class="btn-primary" type="button" id="wr-create">Добавить правило</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelectorAll('[data-wheel-rule-close]').forEach(b => b.onclick = close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  const setVal = (id, value) => { const n = document.getElementById(id); if (n) n.value = value; };
  const titleEl = document.getElementById('wr-title');
  const codeEl = document.getElementById('wr-code');
  if (titleEl) titleEl.addEventListener('input', () => {
    if (codeEl && !codeEl.dataset.touched) {
      codeEl.value = titleEl.value.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 64);
    }
  });
  if (codeEl) codeEl.addEventListener('input', () => { codeEl.dataset.touched = '1'; });
  const tmpl = document.getElementById('wr-fill-quality');
  if (tmpl) tmpl.onclick = () => {
    setVal('wr-title', 'Качество звонков за период 90+');
    setVal('wr-code', 'quality_90');
    setVal('wr-source', 'period_reports');
    setVal('wr-metric', 'quality_avg');
    setVal('wr-operator', 'gte');
    setVal('wr-threshold', '90');
    setVal('wr-period', 'weekly');
    setVal('wr-ttl', '72');
    setVal('wr-description', 'Билет за высокое качество звонков по итогам периода');
    if (codeEl) codeEl.dataset.touched = '1';
  };
  const createBtn = document.getElementById('wr-create');
  if (createBtn) createBtn.onclick = async () => {
    const statusEl = document.getElementById('wr-status');
    const metric = document.getElementById('wr-metric').value;
    const payload = {
      title: document.getElementById('wr-title').value.trim(),
      code: document.getElementById('wr-code').value.trim(),
      description: document.getElementById('wr-description').value.trim(),
      source_module: document.getElementById('wr-source').value,
      rule_type: metric,
      metric_key: metric === 'custom' ? '' : metric,
      operator: document.getElementById('wr-operator').value,
      threshold_value: parseFloat(document.getElementById('wr-threshold').value || '0'),
      threshold_value_max: document.getElementById('wr-threshold-max').value ? parseFloat(document.getElementById('wr-threshold-max').value) : null,
      period_type: document.getElementById('wr-period').value,
      max_tokens_per_period: parseInt(document.getElementById('wr-limit').value, 10) || 0,
      token_ttl_hours: parseInt(document.getElementById('wr-ttl').value, 10) || 24,
      priority: parseInt(document.getElementById('wr-priority').value, 10) || 0,
      is_active: document.getElementById('wr-active').checked,
    };
    if (!payload.title || !payload.code) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = 'Укажите название и код правила';
      return;
    }
    createBtn.disabled = true;
    try {
      await api.createWheelRule(payload);
      swrInvalidate('wheel:admin:rules');
      showToast('Правило добавлено', 'ok');
      close();
      renderWheelRulesTab(body);
    } catch (err) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = err.message || 'Не удалось добавить правило';
    } finally {
      createBtn.disabled = false;
    }
  };
  setTimeout(() => titleEl?.focus(), 30);
}

window.openWheelRuleModal = function openWheelRuleModal() {
  showWheelRuleModal(document.getElementById('wheel-staff-body'));
};

if (!window.__pulsWheelRuleModalClickFix) {
  window.__pulsWheelRuleModalClickFix = true;
  document.addEventListener('click', (event) => {
    const btn = event.target?.closest?.('#wr-open-create, [data-wheel-rule-open]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    window.openWheelRuleModal();
  }, true);
}

/* ---------- Стафф: логи проверок (ТЗ 8.7, 15) ---------- */
async function renderWheelLogsTab(body) {
  const data = await wheelCachedFetch(
    'wheel:admin:logs',
    () => api.getWheelEvaluationLogs({ limit: 80 }),
    { __fallback: true, items: [] },
    () => wheelRefreshIfTab('logs', renderWheelLogsTab, body)
  );
  if (data.__fallback) {
    body.innerHTML = wheelLoadingPanel('Загрузка логов');
    return;
  }
  const rows = data.items || [];
  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head"><h3>Логи проверки условий</h3><span class="panel-badge">${rows.length}</span></div>
      <div class="wheel-admin-content">
        ${rows.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Дата</th><th>Оператор</th><th>Источник</th><th>Значение</th><th>Порог</th><th>Итог</th><th>Причина</th></tr></thead>
          <tbody>${rows.map(l => `<tr>
            <td>${esc(fmtDateTime(l.created_at))}</td>
            <td class="name-cell">${esc(l.operator_name)}</td>
            <td>${esc(l.source_module)}${l.source_entity_id ? ' #' + l.source_entity_id : ''}</td>
            <td>${l.metric_value != null ? esc(String(l.metric_value)) : '—'}</td>
            <td>${l.threshold_value != null ? esc(l.operator) + ' ' + esc(String(l.threshold_value)) : '—'}</td>
            <td><span class="badge ${l.is_eligible ? 'badge-ok' : 'badge-muted'}">${l.is_eligible ? 'выдан' : 'нет'}</span></td>
            <td>${esc(l.reason || '—')}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<div class="empty-state wheel-empty">
          <p>Логов пока нет.</p>
          <p class="cell-muted" style="font-size:12px;max-width:480px;margin:6px auto 0">
            Запись появляется автоматически, когда оператор завершает тест или сохраняется расчёт периода —
            и только если для этого источника есть активное правило допуска (вкладка «Правила»)
            в активной кампании. Если ни один оператор ещё не завершал тест/расчёт периода после
            включения колеса — здесь и должно быть пусто.
          </p>
        </div>`}
      </div>
    </div>`;
}

let _wheelIssueSelected = [];

async function renderWheelIssueTab(body) {
  // Загружаем операторов для поиска (ТЗ п.4.2 — searchable dropdown)
  let operators = STATE.adminOperators;
  if (!operators || !operators.length) {
    operators = await wheelCachedFetch(
      'wheel:operators',
      () => api.listOperators().catch(() => []),
      [],
      (fresh) => {
        STATE.adminOperators = fresh || [];
        wheelRefreshIfTab('issue', renderWheelIssueTab, body);
      },
      SWR_USER_TTL_MS
    );
    STATE.adminOperators = operators;
  }
  const active = (operators || []).filter(o => o.is_active !== false);
  _wheelIssueSelected = _wheelIssueSelected.filter(sel => active.some(o => o.id === sel.id));

  body.innerHTML = `
    <div class="panel wheel-issue-panel">
      <div class="panel-head">
        <h3>Ручная выдача билетов</h3>
        <span class="panel-badge">Staff</span>
      </div>
      <div class="wheel-admin-content">
      <div class="form-grid wheel-issue-grid">
        <label class="form-group">
          <span class="form-label">Операторы</span>
          <input type="text" id="wheel-op-search" class="form-input" placeholder="Поиск по имени, фамилии, группе…" autocomplete="off">
          <div id="wheel-op-results" class="wheel-op-results" hidden></div>
        </label>
        <label class="form-group">
          <span class="form-label">Билетов на каждого</span>
          <input type="number" id="wheel-qty" class="form-input" min="1" max="20" value="1">
        </label>
        <label class="form-group">
          <span class="form-label">Причина</span>
          <input type="text" id="wheel-reason" class="form-input" placeholder="Например: помощь новому сотруднику" maxlength="500">
        </label>
        <label class="form-group">
          <span class="form-label">Срок действия, дней</span>
          <input type="number" id="wheel-ttl" class="form-input" min="1" max="30" value="3">
        </label>
      </div>
      <div id="wheel-op-chosen-list" class="wheel-op-chosen-list"></div>
      <div class="wheel-issue-actions">
        <button class="btn-primary" id="wheel-issue-btn" disabled>Выдать билеты</button>
      </div>
      <div id="wheel-issue-status" class="status-line" style="margin-top:10px"></div>
      </div>
    </div>`;

  const search = document.getElementById('wheel-op-search');
  const results = document.getElementById('wheel-op-results');
  const chosenList = document.getElementById('wheel-op-chosen-list');
  const issueBtn = document.getElementById('wheel-issue-btn');

  function matches(o, q) {
    const hay = `${o.full_name || ''} ${o.group_name || o.group || ''}`.toLowerCase();
    return hay.includes(q);
  }
  function renderChosenList() {
    chosenList.innerHTML = _wheelIssueSelected.map(sel => `
      <span class="wheel-op-chip" data-chip-id="${sel.id}">${esc(sel.full_name)} <button type="button" aria-label="Убрать">×</button></span>
    `).join('');
    chosenList.querySelectorAll('[data-chip-id]').forEach(chip => {
      chip.querySelector('button').onclick = () => {
        const id = parseInt(chip.dataset.chipId, 10);
        _wheelIssueSelected = _wheelIssueSelected.filter(s => s.id !== id);
        renderChosenList();
        issueBtn.disabled = _wheelIssueSelected.length === 0;
      };
    });
  }
  renderChosenList();

  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { results.hidden = true; return; }
    const found = active.filter(o => matches(o, q) && !_wheelIssueSelected.some(s => s.id === o.id)).slice(0, 8);
    results.innerHTML = found.length
      ? found.map(o => `<div class="wheel-op-option" data-op-id="${o.id}" data-op-name="${esc(o.full_name)}">
          <strong>${esc(o.full_name)}</strong><span>${esc(o.group_name || o.group || '')}</span></div>`).join('')
      : '<div class="wheel-op-empty">Не найдено</div>';
    results.hidden = false;
    results.querySelectorAll('[data-op-id]').forEach(opt => {
      opt.onclick = () => {
        _wheelIssueSelected.push({ id: parseInt(opt.dataset.opId, 10), full_name: opt.dataset.opName });
        renderChosenList();
        results.hidden = true;
        search.value = '';
        issueBtn.disabled = false;
      };
    });
  };

  issueBtn.onclick = async () => {
    const reason = document.getElementById('wheel-reason').value.trim();
    const ttl = parseInt(document.getElementById('wheel-ttl').value, 10) || 3;
    const quantity = parseInt(document.getElementById('wheel-qty').value, 10) || 1;
    const statusEl = document.getElementById('wheel-issue-status');
    if (!_wheelIssueSelected.length) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Выберите хотя бы одного оператора'; return; }
    if (!reason) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Укажите причину'; return; }
    issueBtn.disabled = true;
    try {
      const res = await api.issueWheelTicketsBulk({
        operator_ids: _wheelIssueSelected.map(s => s.id),
        quantity, reason_text: reason, ttl_days: ttl,
      });
      swrInvalidate('wheel:');
      const failedNote = res.failed?.length ? ` Не удалось: ${res.failed.length} (см. подробности в консоли).` : '';
      if (res.failed?.length) console.warn('Wheel bulk issue failures:', res.failed);
      statusEl.className = res.issued_count > 0 ? 'status-line status-ok' : 'status-line status-error';
      statusEl.textContent = `Выдано билетов: ${res.issued_count}.${failedNote}`;
      showToast(`Выдано билетов: ${res.issued_count}`, res.issued_count > 0 ? 'ok' : 'error');
      document.getElementById('wheel-reason').value = '';
      _wheelIssueSelected = [];
      renderChosenList();
    } catch (err) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = err.message || 'Не удалось выдать билеты';
    } finally {
      issueBtn.disabled = _wheelIssueSelected.length === 0;
    }
  };
}

/* ══════════════════════════════════════
   VIEW: ТЕСТЫ — общий диспетчер по роли
══════════════════════════════════════ */
let _testsTab = 'available'; // available | history (operator) | overview | list (staff)
let _testTimerInterval = null;
let _testResumeFailedFor = null; // attempt_id, на котором resumeTestRunner уже падал — не повторяем автоматически

function renderTests() {
  const el = document.getElementById('view-tests');
  if (!el) return;
  if (isAdmin(STATE.user?.role)) {
    renderTestsStaffView(el);
  } else {
    renderTestsOperatorView(el);
  }
}

/* ────────────────────────────────────────────────────────────────
   ОПЕРАТОРСКАЯ ЧАСТЬ
──────────────────────────────────────────────────────────────── */

async function renderTestsOperatorView(el) {
  const myNavGen = STATE.navGen;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Обучение</div><h2 class="section-title">Мои тесты</h2><div class="section-subtitle">Проверяйте знания и получайте награды за результат.</div></div>
      <button class="btn-outline btn-sm" onclick="renderTests()">Обновить</button>
    </div>
    <div id="tests-op-body"><div class="loading-state"><div class="loading-spinner"></div></div></div>`;

  let data;
  try {
    // Статус попытки нельзя брать из stale-while-revalidate кеша: sessionStorage
    // переживает F5, поэтому сохранённый до старта список мог вернуть тест как
    // available и скрыть уже идущую попытку. Для этого экрана всегда читаем
    // серверное состояние напрямую и лишь обновляем кеш для фонового prefetch.
    data = await api.myTests();
    swrWriteRaw('tests:my', { data, ts: Date.now() });
  } catch(e) {
    if (isNavStale(myNavGen)) return;
    el.querySelector('#tests-op-body').innerHTML = `<div class="status-line status-error">Не удалось загрузить тесты: ${esc(e.message)}</div>`;
    return;
  }
  if (isNavStale(myNavGen)) return;

  const items = data.items || [];

  // Если у оператора есть незавершённая попытка (in_progress) — это значит
  // он либо только начал тест, либо обновил страницу (F5) во время
  // прохождения. В любом случае нужно сразу показать экран теста с
  // таймером, а не список карточек — иначе F5 "выкидывает из теста"
  // (хотя на сервере попытка всё ещё активна и таймер продолжает идти).
  const inProgressTest = items.find(t => t.attempt_status === 'in_progress');
  // Защита от бесконечного цикла: если resumeTestRunner уже падал с ошибкой
  // на этой же попытке (например backend систематически роняет finish/start
  // на ней), не пытаемся восстановить её повторно при каждом рендере —
  // иначе получаем бесконечный цикл "ошибка -> renderTests() -> снова
  // находим in_progress -> снова resumeTestRunner -> снова ошибка",
  // который визуально выглядит как вечная загрузка.
  if (inProgressTest && _testResumeFailedFor !== inProgressTest.attempt_id) {
    const ok = await resumeTestRunner(inProgressTest.id);
    if (!ok) _testResumeFailedFor = inProgressTest.attempt_id;
    return;
  }

  const available = items.filter(t => ['available', 'in_progress'].includes(t.status));
  const completed = items.filter(t => t.status === 'finished');
  const expired = items.filter(t => t.status === 'expired');
  const history = [...completed, ...expired].sort((a, b) =>
    new Date(b.finished_at || 0) - new Date(a.finished_at || 0)
  );
  const upcoming = items.filter(t => t.status === 'upcoming');
  const averageScore = completed.length
    ? completed.reduce((sum, test) => sum + Number(test.score_percent || 0), 0) / completed.length
    : null;

  const body = el.querySelector('#tests-op-body');
  if (!items.length) {
    body.innerHTML = `<div class="empty-state"><p>Доступных тестов пока нет.</p></div>`;
    return;
  }

  body.innerHTML = `
    <div class="tests-summary-strip">
      <div><span>Новые задания</span><strong>${available.length}</strong></div>
      <div><span>Пройдено тестов</span><strong>${completed.length}</strong></div>
      <div><span>Средний результат</span><strong>${averageScore === null ? '—' : `${fmtA(averageScore, 0)}%`}</strong></div>
    </div>
    <section class="tests-section">
      <div class="tests-section-head"><div><h3>Новые задания</h3><p>Тесты, которые можно пройти сейчас.</p></div></div>
      ${available.length ? `<div class="test-card-grid">${available.map(testCardHtml).join('')}</div>` : `<div class="tests-empty-compact">Сейчас нет тестов для прохождения.</div>`}
    </section>
    ${upcoming.length ? `<section class="tests-section"><div class="tests-section-head"><div><h3>Скоро откроются</h3><p>Будущие задания.</p></div></div><div class="test-card-grid">${upcoming.map(testCardHtml).join('')}</div></section>` : ''}
    <section class="tests-section">
      <div class="tests-section-head"><div><h3>Мои результаты</h3><p>Пройденные тесты и полученные награды.</p></div></div>
      ${history.length ? `<div class="test-history-list">${history.map(testHistoryItemHtml).join('')}</div>` : `<div class="tests-empty-compact">Завершённых тестов пока нет.</div>`}
    </section>`;

  body.querySelectorAll('[data-test-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const testId = Number(btn.dataset.testId);
      const action = btn.dataset.testAction;
      if (action === 'start' || action === 'continue') openTestRunner(testId);
      if (action === 'result') openTestResultModal(btn.dataset.attemptId);
    });
  });
}

function testHistoryItemHtml(t) {
  const isFinished = t.status === 'finished';
  const dateLabel = t.finished_at ? fmtDate(t.finished_at) : 'Дата не указана';
  const resultLabel = t.passed === true ? 'Пройден' : (t.passed === false ? 'Нужно повторить' : 'Не завершён');
  const resultClass = t.passed === true ? 'is-passed' : (t.passed === false ? 'is-failed' : 'is-expired');
  const earned = [];
  if (Number(t.reward_coins_earned) > 0) earned.push(`+${fmtA(t.reward_coins_earned, 0)} коинов`);
  if (Number(t.reward_points_earned) > 0) earned.push(`+${fmtA(t.reward_points_earned, 0)} баллов`);

  return `<article class="test-history-item">
    <div class="test-history-main">
      <div class="test-history-date">${esc(dateLabel)}</div>
      <h4>${esc(t.title)}</h4>
      ${t.description ? `<p>${esc(t.description)}</p>` : `<p>${t.questions_count} вопросов</p>`}
    </div>
    <div class="test-history-score">
      ${isFinished ? `<strong>${fmtA(t.score_percent, 0)}%</strong><span>${t.correct_count} из ${t.questions_count} правильно</span>` : `<strong>—</strong><span>Тест не завершён</span>`}
    </div>
    <div class="test-history-outcome">
      <span class="test-history-status ${resultClass}">${resultLabel}</span>
      ${earned.length ? `<small>${earned.join(' · ')}</small>` : '<small>Без награды</small>'}
    </div>
    <div class="test-history-action">
      ${isFinished ? `<button class="btn-outline btn-sm" data-test-action="result" data-attempt-id="${t.attempt_id}">Посмотреть результат</button>` : ''}
    </div>
  </article>`;
}

function testStatusBadge(status) {
  const map = {
    upcoming: ['Скоро откроется', 'badge-neutral'],
    available: ['Доступен', 'badge-info'],
    in_progress: ['В процессе', 'badge-warning'],
    finished: ['Завершён', 'badge-success'],
    expired: ['Просрочен', 'badge-danger'],
    unavailable: ['Недоступен', 'badge-neutral'],
  };
  const [label, cls] = map[status] || [status, 'badge-neutral'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function testCardHtml(t) {
  const rewardParts = [];
  if (t.reward_type?.includes('coins')) rewardParts.push(`${t.reward_coins} ₡`);
  if (t.reward_type?.includes('points')) rewardParts.push(`${fmtA(t.reward_points, 0)} баллов`);
  const rewardLabel = rewardParts.join(' + ') || 'Без награды';

  let actionHtml = '';
  if (t.status === 'available') {
    actionHtml = `<button class="btn-primary btn-sm" data-test-action="start" data-test-id="${t.id}">Начать тест</button>`;
  } else if (t.status === 'in_progress') {
    actionHtml = `<button class="btn-primary btn-sm" data-test-action="continue" data-test-id="${t.id}">Продолжить</button>`;
  } else if (t.status === 'upcoming') {
    actionHtml = `<div class="test-card-disabled-note">Тест откроется ${fmtDateTime(t.opens_at)}</div>`;
  } else if (t.status === 'finished') {
    actionHtml = `<div class="test-card-result"><b>${fmtA(t.score_percent,0)}%</b><span>${t.correct_count} из ${t.questions_count} верно</span></div>
      ${t.reward_coins_earned ? `<div class="test-card-reward-earned">Получено +${t.reward_coins_earned} ₡</div>` : ''}
      <button class="btn-outline btn-sm" data-test-action="result" data-attempt-id="${t.attempt_id}">Подробнее</button>`;
  } else if (t.status === 'expired') {
    actionHtml = `<div class="test-card-disabled-note">Срок прохождения истёк</div>`;
  } else {
    actionHtml = `<div class="test-card-disabled-note">Недоступен</div>`;
  }

  return `<article class="test-card">
    <div class="test-card-head">
      <div><div class="test-card-title">${esc(t.title)}</div>${t.description ? `<div class="test-card-desc">${esc(t.description)}</div>` : ''}</div>
      ${testStatusBadge(t.status)}
    </div>
    <div class="test-card-meta">
      <span>${t.questions_count} вопросов</span><span>${t.time_limit_minutes} мин</span><span class="test-card-reward">${esc(rewardLabel)}</span>
    </div>
    ${t.closes_at && ['available', 'in_progress', 'upcoming'].includes(t.status) ? `<div class="test-card-deadline">До ${fmtDateTime(t.closes_at)}</div>` : ''}
    <div class="test-card-actions">${actionHtml}</div>
  </article>`;
}


/* ── Прохождение теста ────────────────────────────────────────── */
let _activeTestRun = null; // { attemptId, questions, currentIndex, answers: {qid: [ids]}, expiresAt }

/**
 * Восстанавливает уже идущую попытку без показа предупреждающей модалки
 * (она была показана при первом старте теста) — вызывается автоматически
 * после F5, если у оператора есть активная попытка (status in_progress).
 * api.startTest безопасен для повторного вызова на уже идущей попытке —
 * backend возвращает существующий attempt_id/expires_at, не создавая новую.
 */
async function resumeTestRunner(testId) {
  try {
    const data = await api.startTest(testId);
    _activeTestRun = {
      attemptId: data.attempt_id,
      testTitle: data.test_title,
      questions: data.questions,
      currentIndex: 0,
      answers: data.saved_answers || {},
      expiresAt: new Date(data.expires_at).getTime(),
    };
    swrInvalidate('tests:my');
    invalidateViewCache('tests');
    renderTestRunnerScreen();
    return true;
  } catch(e) {
    showToast(e.message || 'Не удалось восстановить тест', 'error');
    renderTests();
    return false;
  }
}

async function openTestRunner(testId) {
  showModal(`
    <h3 class="modal-title">Перед началом теста</h3>
    <p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px">
      После начала теста запустится таймер.<br>
      Не закрывайте страницу до завершения.<br>
      Правильные ответы будут скрыты до окончания тестирования.
    </p>
    <div style="display:flex;gap:10px">
      <button class="btn-outline" style="flex:1" id="test-cancel-btn">Отмена</button>
      <button class="btn-primary" style="flex:1" id="test-confirm-start-btn">Начать тест</button>
    </div>
  `);
  document.getElementById('test-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('test-confirm-start-btn').addEventListener('click', async () => {
    try {
      const data = await api.startTest(testId);
      closeModal();
      _activeTestRun = {
        attemptId: data.attempt_id,
        testTitle: data.test_title,
        questions: data.questions,
        currentIndex: 0,
        answers: data.saved_answers || {},
        expiresAt: new Date(data.expires_at).getTime(),
      };
      swrInvalidate('tests:my');
      invalidateViewCache('tests');
      renderTestRunnerScreen();
    } catch(e) {
      closeModal();
      showToast(e.message || 'Не удалось начать тест', 'error');
    }
  });
}

function renderTestRunnerScreen() {
  const el = document.getElementById('view-tests');
  if (!el || !_activeTestRun) return;
  const run = _activeTestRun;
  const answeredCount = run.questions.filter(q => (run.answers[q.id] || []).length > 0).length;

  el.innerHTML = `
    <div class="test-runner">
      <header class="test-runner-head">
        <div>
          <div class="section-kicker">Тестирование</div>
          <h2 class="test-runner-title">${esc(run.testTitle)}</h2>
          <div class="test-runner-progress-label"><strong id="test-answered-count">${answeredCount}</strong> из ${run.questions.length} отвечено</div>
        </div>
        <div class="test-runner-timer-wrap">
          <span>Осталось</span>
          <div class="test-runner-timer" id="test-timer">--:--</div>
        </div>
      </header>
      <div class="test-runner-overview">
        <div class="test-runner-progress-bar"><div class="test-runner-progress-fill" id="test-progress-fill" style="width:${Math.round(answeredCount / Math.max(run.questions.length, 1) * 100)}%"></div></div>
        <nav class="test-question-nav" aria-label="Навигация по вопросам">
          ${run.questions.map((q, index) => `<button type="button" class="test-question-nav-item ${index === 0 ? 'current' : ''} ${(run.answers[q.id] || []).length ? 'answered' : ''}" data-question-nav="${index}" title="Вопрос ${index + 1}">${index + 1}</button>`).join('')}
        </nav>
        <div class="test-question-nav-legend"><span><i class="is-current"></i>Текущий</span><span><i class="is-answered"></i>Отвечен</span><span><i></i>Без ответа</span></div>
      </div>
      <main class="test-runner-questions">
        ${run.questions.map((q, index) => testRunnerQuestionHtml(q, index, run.answers[q.id] || [])).join('')}
      </main>
      <footer class="test-runner-finish">
        <div><strong id="test-finish-summary">${answeredCount} из ${run.questions.length}</strong><span>Ответы сохраняются автоматически</span></div>
        <button class="btn-primary" id="test-nav-finish">Завершить тест</button>
      </footer>
    </div>`;

  el.querySelectorAll('[data-test-answer]').forEach(input => {
    input.addEventListener('change', () => {
      const questionId = Number(input.dataset.questionId);
      const questionIndex = Number(input.dataset.questionIndex);
      const q = run.questions[questionIndex];
      const answerId = Number(input.value);
      if (q.question_type === 'multiple_choice') {
        const set = new Set(run.answers[questionId] || []);
        if (input.checked) set.add(answerId); else set.delete(answerId);
        run.answers[questionId] = [...set];
      } else {
        run.answers[questionId] = [answerId];
      }
      const questionEl = input.closest('.test-runner-question');
      questionEl.querySelectorAll('.test-runner-answer-row').forEach(row => {
        const rowInput = row.querySelector('[data-test-answer]');
        row.classList.toggle('selected', rowInput.checked);
      });
      updateTestRunnerProgress();
      api.saveTestAnswer(run.attemptId, questionId, run.answers[questionId]).catch(err => {
        showToast(err.message || 'Не удалось сохранить ответ', 'error');
      });
    });
  });

  el.querySelectorAll('[data-question-nav]').forEach(button => {
    button.addEventListener('click', () => focusTestQuestion(Number(button.dataset.questionNav)));
  });
  el.querySelector('#test-nav-finish')?.addEventListener('click', confirmFinishTestRun);

  if ('IntersectionObserver' in window) {
    run.questionObserver?.disconnect?.();
    run.questionObserver = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const index = Number(visible.target.dataset.questionIndex);
      run.currentIndex = index;
      el.querySelectorAll('[data-question-nav]').forEach(button => button.classList.toggle('current', Number(button.dataset.questionNav) === index));
    }, { rootMargin: '-20% 0px -60% 0px', threshold: [0, .25, .6] });
    el.querySelectorAll('.test-runner-question').forEach(question => run.questionObserver.observe(question));
  }

  startTestTimer();
}

function testRunnerQuestionHtml(question, index, selected) {
  const inputType = question.question_type === 'multiple_choice' ? 'checkbox' : 'radio';
  const instruction = question.question_type === 'multiple_choice' ? 'Можно выбрать несколько вариантов' : 'Выберите один вариант';
  return `<section class="test-runner-question" id="test-question-${index + 1}" data-question-index="${index}">
    <div class="test-runner-question-head">
      <span class="test-runner-question-number">${String(index + 1).padStart(2, '0')}</span>
      <div><h3>${esc(question.question_text)}</h3><p>${instruction}</p></div>
    </div>
    <div class="test-runner-answers">
      ${question.answers.map((answer, answerIndex) => `
        <label class="test-runner-answer-row ${selected.includes(answer.id) ? 'selected' : ''}">
          <input type="${inputType}" name="test-answer-${question.id}" value="${answer.id}" data-test-answer data-question-id="${question.id}" data-question-index="${index}" ${selected.includes(answer.id) ? 'checked' : ''}>
          <i class="test-answer-control" aria-hidden="true"></i>
          <span class="test-answer-letter">${String.fromCharCode(65 + answerIndex)}</span>
          <span class="test-answer-text">${esc(answer.answer_text)}</span>
        </label>
      `).join('')}
    </div>
  </section>`;
}

function updateTestRunnerProgress() {
  if (!_activeTestRun) return;
  const run = _activeTestRun;
  const answered = run.questions.filter(question => (run.answers[question.id] || []).length > 0).length;
  const countEl = document.getElementById('test-answered-count');
  const summaryEl = document.getElementById('test-finish-summary');
  const fillEl = document.getElementById('test-progress-fill');
  if (countEl) countEl.textContent = answered;
  if (summaryEl) summaryEl.textContent = `${answered} из ${run.questions.length}`;
  if (fillEl) fillEl.style.width = `${Math.round(answered / Math.max(run.questions.length, 1) * 100)}%`;
  document.querySelectorAll('[data-question-nav]').forEach(button => {
    const question = run.questions[Number(button.dataset.questionNav)];
    button.classList.toggle('answered', (run.answers[question.id] || []).length > 0);
  });
}

function focusTestQuestion(index) {
  if (!_activeTestRun) return;
  _activeTestRun.currentIndex = index;
  document.querySelectorAll('[data-question-nav]').forEach(button => button.classList.toggle('current', Number(button.dataset.questionNav) === index));
  document.getElementById(`test-question-${index + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function confirmFinishTestRun() {
  if (!_activeTestRun) return;
  const unanswered = _activeTestRun.questions.filter(question => !(_activeTestRun.answers[question.id] || []).length).length;
  if (!unanswered) {
    finishTestRun();
    return;
  }
  showModal(`<div class="test-finish-modal">
    <div class="section-kicker">Завершение теста</div>
    <h3 class="modal-title">Остались вопросы без ответа</h3>
    <p>Без ответа: <strong>${unanswered}</strong>. После завершения изменить ответы будет нельзя.</p>
    <div class="test-finish-modal-actions"><button class="btn-outline" id="test-finish-return">Вернуться к вопросам</button><button class="btn-primary" id="test-finish-confirm">Завершить тест</button></div>
  </div>`);
  document.getElementById('test-finish-return').onclick = closeModal;
  document.getElementById('test-finish-confirm').onclick = () => { closeModal(); finishTestRun(); };
}

function startTestTimer() {
  if (_testTimerInterval) clearInterval(_testTimerInterval);
  const tick = () => {
    if (!_activeTestRun) { clearInterval(_testTimerInterval); return; }
    const remainMs = _activeTestRun.expiresAt - Date.now();
    const timerEl = document.getElementById('test-timer');
    if (!timerEl) { clearInterval(_testTimerInterval); return; }
    if (remainMs <= 0) {
      clearInterval(_testTimerInterval);
      timerEl.textContent = '00:00';
      showToast('Время теста истекло. Ответы были отправлены автоматически.', 'error');
      finishTestRun();
      return;
    }
    const totalSec = Math.floor(remainMs / 1000);
    const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
    timerEl.classList.toggle('test-timer-warning', totalSec < 60);
  };
  tick();
  _testTimerInterval = setInterval(tick, 1000);
}

async function finishTestRun() {
  if (!_activeTestRun) return;
  clearInterval(_testTimerInterval);
  const attemptId = _activeTestRun.attemptId;
  try {
    const result = await api.finishTest(attemptId);
    _activeTestRun.questionObserver?.disconnect?.();
    _activeTestRun = null;
    swrInvalidate('tests:my'); // статус теста изменился (finished) — следующий заход в список не должен показать устаревшее "in_progress"
    invalidateViewCache('tests');
    renderTestResultScreen(result);
  } catch(e) {
    showToast(e.message || 'Не удалось завершить тест', 'error');
    if (_activeTestRun) startTestTimer();
  }
}

function renderTestResultScreen(result) {
  const el = document.getElementById('view-tests');
  if (!el) return;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Тесты</div><h2 class="section-title">Результат теста</h2></div>
      <button class="btn-primary btn-sm" onclick="renderTests()">К списку тестов</button>
    </div>
    ${testResultCardHtml(result)}
  `;
}

function testResultCardHtml(result) {
  const passed = result.passed;
  const statusClass = passed === null ? 'neutral' : (passed ? 'passed' : 'failed');
  return `<div class="test-result-card">
    <div class="test-result-head">
      <div><div class="section-kicker">Итог</div><div class="test-result-title">${esc(result.test_title)}</div></div>
      <span class="test-result-status ${statusClass}">${passed === null ? 'Завершён' : (passed ? 'Пройден' : 'Не пройден')}</span>
    </div>
    <div class="test-result-grid">
      <div class="test-result-stat"><div class="test-result-stat-label">Правильных ответов</div><div class="test-result-stat-value">${result.correct_count} из ${result.questions_count}</div></div>
      <div class="test-result-stat"><div class="test-result-stat-label">Процент</div><div class="test-result-stat-value">${fmtA(result.score_percent,0)}%</div></div>
      <div class="test-result-stat"><div class="test-result-stat-label">Баллы</div><div class="test-result-stat-value">${fmtA(result.score_points,1)}</div></div>
      <div class="test-result-stat"><div class="test-result-stat-label">Результат</div><div class="test-result-stat-value">${passed === null ? '—' : (passed ? 'Успешно' : 'Попробуйте ещё')}</div></div>
    </div>
    ${(result.reward_coins > 0 || result.reward_points > 0) ? `
      <div class="test-result-reward">
        ${result.reward_coins > 0 ? `Награда: +${result.reward_coins} коинов` : ''}
        ${result.reward_points > 0 ? ` +${fmtA(result.reward_points,1)} баллов` : ''}
      </div>` : ''}
    ${result.questions ? renderTestCorrectAnswersBlock(result) : ''}
  </div>`;
}

function renderTestCorrectAnswersBlock(result) {
  return `<div class="test-result-answers">
    <div class="test-result-section-head"><h3>Разбор ответов</h3><span>${result.questions.length} вопросов</span></div>
    ${result.questions.map((q, index) => {
      const yourIds = (result.your_answers && result.your_answers[q.id]) || [];
      return `<div class="test-result-question">
        <div class="test-result-question-text"><span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(q.question_text)}</strong></div>
        ${q.answers.map(a => {
          const wasSelected = yourIds.includes(a.id);
          const cls = a.is_correct ? 'correct' : (wasSelected ? 'incorrect' : '');
          return `<div class="test-result-answer-row ${cls} ${wasSelected ? 'selected' : ''}"><i aria-hidden="true"></i><span>${esc(a.answer_text)}</span>${wasSelected ? '<small>Ваш ответ</small>' : ''}</div>`;
        }).join('')}
      </div>`;
    }).join('')}
  </div>`;
}

async function openTestResultModal(attemptId) {
  try {
    const result = await api.getTestResult(attemptId);
    showModal(`<div style="max-height:70vh;overflow-y:auto">${testResultCardHtml(result)}</div>`);
  } catch(e) {
    showToast(e.message || 'Не удалось загрузить результат', 'error');
  }
}

/* ────────────────────────────────────────────────────────────────
   АДМИНСКАЯ ЧАСТЬ (supervisor / manager / admin)
──────────────────────────────────────────────────────────────── */

async function renderTestsStaffView(el) {
  const myNavGen = STATE.navGen;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Обучение команды</div><h2 class="section-title">Тесты</h2><div class="section-subtitle">Создавайте проверки знаний и отслеживайте результаты операторов.</div></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="renderTests()">Обновить</button>
        <button class="btn-primary btn-sm" id="tests-new-btn">Создать тест</button>
      </div>
    </div>
    <div id="tests-staff-body"><div class="loading-state"><div class="loading-spinner"></div></div></div>`;

  el.querySelector('#tests-new-btn').addEventListener('click', () => openTestBuilder(null));

  let data;
  try {
    data = await swrFetch('tests:admin-list', () => api.listAdminTests(), null, SWR_FAST_TTL_MS);
  } catch(e) {
    if (isNavStale(myNavGen)) return;
    el.querySelector('#tests-staff-body').innerHTML = `<div class="status-line status-error">${esc(e.message)}</div>`;
    return;
  }
  if (isNavStale(myNavGen)) return;

  const items = data.items || [];
  const body = el.querySelector('#tests-staff-body');
  if (!items.length) {
    body.innerHTML = `<div class="empty-state"><p>Тестов пока нет. Создайте первый тест.</p></div>`;
    return;
  }

  const statusLabel = { draft: 'Черновик', scheduled: 'Запланирован', open: 'Открыт', finished: 'Завершён', archived: 'Архив' };
  const statusBadgeClass = { draft: 'badge-neutral', scheduled: 'badge-info', open: 'badge-success', finished: 'badge-warning', archived: 'badge-neutral' };

  const openCount = items.filter(t => t.status === 'open').length;
  const draftCount = items.filter(t => ['draft', 'scheduled'].includes(t.status)).length;
  const finishedAttempts = items.reduce((sum, t) => sum + Number(t.attempts_finished || 0), 0);
  const averages = items.filter(t => t.average_percent != null).map(t => Number(t.average_percent));
  const averageScore = averages.length ? Math.round(averages.reduce((sum, value) => sum + value, 0) / averages.length) : 0;

  body.innerHTML = `
    <div class="tests-admin-summary">
      <div><span>Всего тестов</span><strong>${items.length}</strong></div>
      <div><span>Открыты сейчас</span><strong>${openCount}</strong></div>
      <div><span>Черновики и планы</span><strong>${draftCount}</strong></div>
      <div><span>Завершено попыток</span><strong>${finishedAttempts}</strong></div>
      <div><span>Средний результат</span><strong>${averageScore}%</strong></div>
    </div>
    <div class="tests-admin-panel">
      <div class="tests-admin-toolbar">
        <div class="filter-tabs tests-filter-tabs">
          <button class="filter-tab active" data-tests-filter="all">Все <span>${items.length}</span></button>
          <button class="filter-tab" data-tests-filter="open">Открытые <span>${openCount}</span></button>
          <button class="filter-tab" data-tests-filter="draft">Черновики <span>${draftCount}</span></button>
          <button class="filter-tab" data-tests-filter="finished">Завершённые <span>${items.filter(t => t.status === 'finished').length}</span></button>
        </div>
      </div>
      <div class="tests-admin-list">
        ${items.map(t => `<article class="tests-admin-row" data-test-status="${t.status}">
          <div class="tests-admin-main">
            <div class="tests-admin-title-line"><h3>${esc(t.title)}</h3><span class="badge ${statusBadgeClass[t.status]||'badge-neutral'}">${statusLabel[t.status]||t.status}</span></div>
            <div class="tests-admin-meta"><span>${t.questions_count} вопросов</span><span>${t.time_limit_minutes} мин</span><span>${t.opens_at ? `Старт ${fmtDateTime(t.opens_at)}` : 'Без даты старта'}</span></div>
          </div>
          <div class="tests-admin-result"><span>Прошли</span><strong>${t.attempts_finished}</strong></div>
          <div class="tests-admin-result"><span>Средний результат</span><strong>${t.average_percent != null ? t.average_percent + '%' : '—'}</strong></div>
          <div class="tests-admin-actions">
            <button class="btn-outline btn-sm" data-test-results="${t.id}">Результаты</button>
            <button class="btn-outline btn-sm" data-test-edit="${t.id}">Настроить</button>
            ${t.status==='draft'||t.status==='scheduled' ? `<button class="btn-primary btn-sm" data-test-publish="${t.id}">Опубликовать</button>` : ''}
            ${t.status==='open' ? `<button class="btn-outline btn-sm" data-test-close="${t.id}">Закрыть</button>` : ''}
          </div>
        </article>`).join('')}
      </div>
    </div>`;

  body.querySelectorAll('[data-tests-filter]').forEach(button => button.addEventListener('click', () => {
    body.querySelectorAll('[data-tests-filter]').forEach(item => item.classList.toggle('active', item === button));
    const filter = button.dataset.testsFilter;
    body.querySelectorAll('[data-test-status]').forEach(row => {
      const status = row.dataset.testStatus;
      const visible = filter === 'all' || status === filter || (filter === 'draft' && ['draft', 'scheduled'].includes(status));
      row.hidden = !visible;
    });
  }));

  body.querySelectorAll('[data-test-edit]').forEach(btn => btn.addEventListener('click', () => openTestBuilder(Number(btn.dataset.testEdit))));
  body.querySelectorAll('[data-test-results]').forEach(btn => btn.addEventListener('click', () => openTestResultsView(Number(btn.dataset.testResults))));
  body.querySelectorAll('[data-test-publish]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api.publishTest(Number(btn.dataset.testPublish));
      swrInvalidate('tests:'); // публикация меняет статус — сбрасываем и admin-list, и операторский my-list
      showToast('Тест опубликован', 'ok');
      renderTests();
    }
    catch(e) { showToast(e.message, 'error'); }
  }));
  body.querySelectorAll('[data-test-close]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api.closeTest(Number(btn.dataset.testClose));
      swrInvalidate('tests:');
      showToast('Тест закрыт', 'ok');
      renderTests();
    }
    catch(e) { showToast(e.message, 'error'); }
  }));
}

/* ── Конструктор теста ────────────────────────────────────────── */
let _testBuilderState = null; // { testId, test, questions: [...], assignTargetType, assignTargetIds }

async function openTestBuilder(testId) {
  const el = document.getElementById('view-tests');
  if (!el) return;

  let test = null;
  if (testId) {
    try {
      test = await api.getAdminTest(testId);
    } catch(e) {
      showToast(e.message || 'Не удалось загрузить тест', 'error');
      return;
    }
  }

  _testBuilderState = {
    testId: testId,
    title: test?.title || '',
    description: test?.description || '',
    instruction: test?.instruction || '',
    time_limit_minutes: test?.time_limit_minutes || 30,
    opens_at: utcISOStringToLocalDateTimeInput(test?.opens_at),
    closes_at: utcISOStringToLocalDateTimeInput(test?.closes_at),
    passing_percent: test?.passing_percent ?? 70,
    show_result_after_finish: test?.show_result_after_finish ?? true,
    show_correct_answers: test?.show_correct_answers ?? false,
    allow_retake: test?.allow_retake ?? false,
    max_attempts: test?.max_attempts ?? 1,
    reward_type: test?.reward_type || 'none',
    reward_points: test?.reward_points ?? 0,
    reward_coins: test?.reward_coins ?? 0,
    reward_min_percent: test?.reward_min_percent ?? 70,
    reward_mode: test?.reward_mode || 'fixed',
    questions: (test?.questions || []).map(question => ({
      ...question,
      answers: (question.answers || []).map(answer => ({ ...answer })),
    })),
    deletedQuestionIds: [],
    assignTargetType: test?.assignments?.[0]?.target_type || 'all',
    assignTargetIds: (test?.assignments || []).filter(a => a.target_id != null).map(a => a.target_id),
    status: test?.status || 'draft',
  };

  renderTestBuilderScreen();
}

function renderTestBuilderScreen() {
  const el = document.getElementById('view-tests');
  if (!el || !_testBuilderState) return;
  const s = _testBuilderState;
  const isOpen = s.status === 'open';

  el.innerHTML = `
    <div class="view-header test-builder-header">
      <div><div class="section-kicker">Конструктор теста</div><h2 class="section-title">${s.testId ? 'Настройка теста' : 'Новый тест'}</h2><div class="section-subtitle">Заполните параметры, добавьте вопросы и назначьте аудиторию.</div></div>
      <button class="btn-outline btn-sm" onclick="renderTests()">К списку</button>
    </div>
    ${isOpen ? '<div class="test-builder-notice">Тест уже открыт. Можно изменить дату закрытия и назначение.</div>' : ''}
    <div class="test-builder-shell">
      <section class="test-builder-section">
        <div class="test-builder-section-head"><span>01</span><div><h3>Основные параметры</h3><p>Название, расписание и условия прохождения.</p></div></div>
        <div class="test-builder-fields">
          <div class="form-group test-builder-span-2"><label class="form-label">Название теста</label><input id="tb-title" class="form-input" placeholder="Например: Проверка знаний продукта" value="${esc(s.title)}" ${isOpen?'disabled':''}></div>
          <div class="form-group test-builder-span-2"><label class="form-label">Краткое описание</label><textarea id="tb-description" class="form-input" rows="2" placeholder="Что проверяет этот тест" ${isOpen?'disabled':''}>${esc(s.description)}</textarea></div>
          <div class="form-group test-builder-span-2"><label class="form-label">Инструкция оператору</label><textarea id="tb-instruction" class="form-input" rows="2" placeholder="Что важно знать перед началом" ${isOpen?'disabled':''}>${esc(s.instruction)}</textarea></div>
          <div class="form-group"><label class="form-label">Открытие</label><input id="tb-opens-at" type="datetime-local" class="form-input" value="${s.opens_at}" ${isOpen?'disabled':''}></div>
          <div class="form-group"><label class="form-label">Закрытие</label><input id="tb-closes-at" type="datetime-local" class="form-input" value="${s.closes_at}"></div>
          <div class="form-group"><label class="form-label">Время, минут</label><input id="tb-time-limit" type="number" min="1" class="form-input" value="${s.time_limit_minutes}" ${isOpen?'disabled':''}></div>
          <div class="form-group"><label class="form-label">Проходной результат, %</label><input id="tb-passing-percent" type="number" min="0" max="100" class="form-input" value="${s.passing_percent}" ${isOpen?'disabled':''}></div>
          <div class="form-group"><label class="form-label">Максимум попыток</label><input id="tb-max-attempts" type="number" min="1" class="form-input" value="${s.max_attempts}" ${isOpen?'disabled':''}></div>
        </div>
        <div class="test-toggle-list">
          <label class="test-toggle-row"><span><strong>Показать результат</strong><small>Оператор увидит процент и статус сразу после завершения.</small></span><input type="checkbox" id="tb-show-result" ${s.show_result_after_finish?'checked':''} ${isOpen?'disabled':''}><i></i></label>
          <label class="test-toggle-row"><span><strong>Показать правильные ответы</strong><small>После завершения будут доступны верные варианты.</small></span><input type="checkbox" id="tb-show-correct" ${s.show_correct_answers?'checked':''} ${isOpen?'disabled':''}><i></i></label>
          <label class="test-toggle-row"><span><strong>Разрешить повторное прохождение</strong><small>Количество попыток ограничивается значением выше.</small></span><input type="checkbox" id="tb-allow-retake" ${s.allow_retake?'checked':''} ${isOpen?'disabled':''}><i></i></label>
        </div>
      </section>

      <section class="test-builder-section">
        <div class="test-builder-section-head"><span>02</span><div><h3>Награда</h3><p>Коины начисляются автоматически после успешного завершения.</p></div></div>
        <div class="test-builder-fields">
          <div class="form-group test-builder-span-2"><label class="form-label">Тип награды</label><select id="tb-reward-type" class="form-select" ${isOpen?'disabled':''}><option value="none" ${s.reward_type==='none'?'selected':''}>Без награды</option><option value="points" ${s.reward_type==='points'?'selected':''}>Баллы</option><option value="coins" ${s.reward_type==='coins'?'selected':''}>Коины</option><option value="points_and_coins" ${s.reward_type==='points_and_coins'?'selected':''}>Баллы и коины</option></select></div>
          <div class="form-group" data-reward-field="points"><label class="form-label">Баллы</label><input id="tb-reward-points" type="number" min="0" class="form-input" value="${s.reward_points}" ${isOpen?'disabled':''}></div>
          <div class="form-group" data-reward-field="coins"><label class="form-label">Коины</label><input id="tb-reward-coins" type="number" min="0" class="form-input" value="${s.reward_coins}" ${isOpen?'disabled':''}></div>
          <div class="form-group" data-reward-field="settings"><label class="form-label">Порог для награды, %</label><input id="tb-reward-min-percent" type="number" min="0" max="100" class="form-input" value="${s.reward_min_percent}" ${isOpen?'disabled':''}></div>
          <div class="form-group" data-reward-field="settings"><label class="form-label">Начисление</label><select id="tb-reward-mode" class="form-select" ${isOpen?'disabled':''}><option value="fixed" ${s.reward_mode==='fixed'?'selected':''}>Фиксированное</option><option value="proportional" ${s.reward_mode==='proportional'?'selected':''}>По результату</option></select></div>
        </div>
        <div class="test-reward-note" id="tb-reward-note"></div>
      </section>

      <section class="test-builder-section">
        <div class="test-builder-section-head test-builder-section-head-action"><span>03</span><div><h3>Вопросы</h3><p>${s.questions.length ? `${s.questions.length} ${s.questions.length === 1 ? 'вопрос' : 'вопросов'} в тесте` : 'Добавьте первый вопрос и варианты ответа.'}</p></div>${!isOpen?'<button class="btn-outline btn-sm" id="tb-add-question">Добавить вопрос</button>':''}</div>
        <div id="tb-questions-list" class="test-questions-list">${s.questions.map((q,i) => questionEditorHtml(q,i,isOpen)).join('') || '<div class="tests-empty-compact">Вопросов пока нет.</div>'}</div>
      </section>

      <section class="test-builder-section">
        <div class="test-builder-section-head"><span>04</span><div><h3>Назначение</h3><p>Выберите операторов, которым будет доступен тест.</p></div></div>
        <div class="form-group"><label class="form-label">Аудитория</label><select id="tb-assign-type" class="form-select"><option value="all" ${s.assignTargetType==='all'?'selected':''}>Все операторы</option><option value="group" ${s.assignTargetType==='group'?'selected':''}>Выбранные группы</option><option value="operator" ${s.assignTargetType==='operator'?'selected':''}>Отдельные операторы</option></select></div>
        <div id="tb-assign-targets"></div>
      </section>
    </div>
    <div class="test-builder-actions"><button class="btn-outline" id="tb-save-draft">Сохранить${s.testId?'':' черновик'}</button><button class="btn-primary" id="tb-save-and-publish">${s.status==='open'?'Сохранить изменения':'Сохранить и опубликовать'}</button></div>`;

  el.querySelector('#tb-add-question')?.addEventListener('click', () => {
    captureTestBuilderForm(el);
    s.questions.push({ question_text: '', question_type: 'single_choice', points: 1, answers: [{answer_text:'',is_correct:false},{answer_text:'',is_correct:false}] });
    renderTestBuilderScreen();
  });

  bindQuestionEditorEvents(el, isOpen);
  renderAssignTargetsBlock(el);
  updateTestRewardFields(el);
  el.querySelector('#tb-reward-type')?.addEventListener('change', () => updateTestRewardFields(el));
  el.querySelector('#tb-assign-type').addEventListener('change', (e) => { s.assignTargetType = e.target.value; renderAssignTargetsBlock(el); });

  el.querySelector('#tb-save-draft').addEventListener('click', () => saveTestBuilder(false));
  el.querySelector('#tb-save-and-publish').addEventListener('click', () => saveTestBuilder(true));
}

function captureTestBuilderForm(el) {
  const s = _testBuilderState;
  if (!s || !el?.querySelector('#tb-title')) return;
  s.title = el.querySelector('#tb-title').value;
  s.description = el.querySelector('#tb-description').value;
  s.instruction = el.querySelector('#tb-instruction').value;
  s.time_limit_minutes = Number(el.querySelector('#tb-time-limit').value);
  s.opens_at = el.querySelector('#tb-opens-at').value;
  s.closes_at = el.querySelector('#tb-closes-at').value;
  s.passing_percent = Number(el.querySelector('#tb-passing-percent').value);
  s.max_attempts = Number(el.querySelector('#tb-max-attempts').value);
  s.show_result_after_finish = el.querySelector('#tb-show-result').checked;
  s.show_correct_answers = el.querySelector('#tb-show-correct').checked;
  s.allow_retake = el.querySelector('#tb-allow-retake').checked;
  s.reward_type = el.querySelector('#tb-reward-type').value;
  s.reward_points = Number(el.querySelector('#tb-reward-points').value);
  s.reward_coins = Number(el.querySelector('#tb-reward-coins').value);
  s.reward_min_percent = Number(el.querySelector('#tb-reward-min-percent').value);
  s.reward_mode = el.querySelector('#tb-reward-mode').value;
}

function updateTestRewardFields(el) {
  const type = el.querySelector('#tb-reward-type')?.value || 'none';
  el.querySelectorAll('[data-reward-field]').forEach(field => {
    const kind = field.dataset.rewardField;
    field.hidden = type === 'none' || (kind === 'points' && !type.includes('points')) || (kind === 'coins' && !type.includes('coins'));
  });
  const note = el.querySelector('#tb-reward-note');
  if (note) note.textContent = type === 'none' ? 'Тест будет проверять знания без начисления награды.' : 'Награда создаётся одной транзакцией после успешной проверки результата.';
}

function questionEditorHtml(q, index, isOpen) {
  return `<div class="test-question-editor" data-q-index="${index}">
    <div class="test-question-number">${String(index + 1).padStart(2, '0')}</div>
    <div class="test-question-content">
      <div class="test-question-editor-head">
        <div class="form-group test-question-title-field"><label class="form-label">Вопрос</label><input class="form-input" placeholder="Введите текст вопроса" value="${esc(q.question_text)}" data-q-field="question_text" ${isOpen?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Тип ответа</label><select class="form-select" data-q-field="question_type" ${isOpen?'disabled':''}>
        <option value="single_choice" ${q.question_type==='single_choice'?'selected':''}>Один ответ</option>
        <option value="multiple_choice" ${q.question_type==='multiple_choice'?'selected':''}>Несколько ответов</option>
        </select></div>
        <div class="form-group test-question-points"><label class="form-label">Баллы</label><input class="form-input" type="number" min="0" value="${q.points}" data-q-field="points" ${isOpen?'disabled':''}></div>
        ${!isOpen?`<button class="test-icon-button test-question-delete" data-q-delete title="Удалить вопрос" aria-label="Удалить вопрос">×</button>`:''}
      </div>
      <div class="test-answer-label">Варианты ответа <span>Отметьте правильный</span></div>
      <div class="test-answer-options">
        ${q.answers.map((a,ai) => `<div class="test-answer-option-row" data-a-index="${ai}">
          <label class="test-correct-control" title="Правильный ответ"><input type="${q.question_type==='multiple_choice'?'checkbox':'radio'}" name="correct-${index}" data-a-field="is_correct" ${a.is_correct?'checked':''} ${isOpen?'disabled':''}><i></i></label>
          <input class="form-input" placeholder="Вариант ${ai + 1}" value="${esc(a.answer_text)}" data-a-field="answer_text" ${isOpen?'disabled':''}>
          ${!isOpen&&q.answers.length>2?`<button class="test-icon-button" data-a-delete title="Удалить вариант" aria-label="Удалить вариант">×</button>`:''}
        </div>`).join('')}
      </div>
      ${!isOpen && q.answers.length < 10 ? `<button class="btn-outline btn-sm test-add-answer" data-q-add-answer>Добавить вариант</button>` : ''}
    </div>
  </div>`;
}

function bindQuestionEditorEvents(el, isOpen) {
  const s = _testBuilderState;
  el.querySelectorAll('[data-q-index]').forEach(qDiv => {
    const qi = Number(qDiv.dataset.qIndex);
    qDiv.querySelectorAll('[data-q-field]').forEach(input => {
      input.addEventListener('input', () => { s.questions[qi][input.dataset.qField] = input.type === 'number' ? Number(input.value) : input.value; });
      input.addEventListener('change', () => {
        if (input.dataset.qField === 'question_type') {
          captureTestBuilderForm(el);
          renderTestBuilderScreen();
        }
      });
    });
    qDiv.querySelector('[data-q-delete]')?.addEventListener('click', () => {
      captureTestBuilderForm(el);
      const removed = s.questions[qi];
      if (removed?.id) s.deletedQuestionIds.push(removed.id);
      s.questions.splice(qi, 1);
      renderTestBuilderScreen();
    });
    qDiv.querySelector('[data-q-add-answer]')?.addEventListener('click', () => { captureTestBuilderForm(el); s.questions[qi].answers.push({answer_text:'',is_correct:false}); renderTestBuilderScreen(); });

    qDiv.querySelectorAll('[data-a-index]').forEach(aDiv => {
      const ai = Number(aDiv.dataset.aIndex);
      aDiv.querySelectorAll('[data-a-field]').forEach(input => {
        input.addEventListener('input', () => {
          if (input.dataset.aField === 'is_correct') {
            if (s.questions[qi].question_type === 'single_choice') {
              s.questions[qi].answers.forEach(a => a.is_correct = false);
            }
            s.questions[qi].answers[ai].is_correct = input.checked;
          } else {
            s.questions[qi].answers[ai][input.dataset.aField] = input.value;
          }
        });
      });
      aDiv.querySelector('[data-a-delete]')?.addEventListener('click', () => { captureTestBuilderForm(el); s.questions[qi].answers.splice(ai,1); renderTestBuilderScreen(); });
    });
  });
}

function renderAssignTargetsBlock(el) {
  const s = _testBuilderState;
  const box = el.querySelector('#tb-assign-targets');
  if (s.assignTargetType === 'all') { box.innerHTML = ''; return; }
  if (s.assignTargetType === 'group') {
    box.innerHTML = `<div class="form-group"><label class="form-label">Группы</label>
      <div class="test-target-checklist">${(STATE.groups||[]).map(g => `<label class="test-target-option"><input type="checkbox" value="${g.id}" ${s.assignTargetIds.includes(g.id)?'checked':''}><i></i><span>${esc(g.name)}</span></label>`).join('')}</div></div>`;
  } else {
    box.innerHTML = `<div class="form-group"><label class="form-label">Операторы</label>
      <input class="form-input" id="tb-operator-search" placeholder="Поиск по ФИО">
      <div class="test-target-checklist" id="tb-operator-checklist">${(STATE.adminOperators||[]).map(o => `<label class="test-target-option" data-op-name="${esc(o.full_name).toLowerCase()}"><input type="checkbox" value="${o.id}" ${s.assignTargetIds.includes(o.id)?'checked':''}><i></i><span>${esc(o.full_name)}</span></label>`).join('')}</div></div>`;
    box.querySelector('#tb-operator-search')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      box.querySelectorAll('[data-op-name]').forEach(label => { label.style.display = label.dataset.opName.includes(q) ? '' : 'none'; });
    });
  }
  box.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = Number(cb.value);
      if (cb.checked) { if (!s.assignTargetIds.includes(id)) s.assignTargetIds.push(id); }
      else { s.assignTargetIds = s.assignTargetIds.filter(x => x !== id); }
    });
  });
}

/**
 * <input type="datetime-local"> отдаёт значение БЕЗ таймзоны
 * ("2026-06-30T22:10") — браузер показывает его как локальное время
 * пользователя, но если отправить эту строку на backend как есть,
 * сервер (работающий в UTC через datetime.utcnow()) интерпретирует её
 * как 22:10 UTC, а не 22:10 по Алматы/Астане (UTC+5). Из-за этого тест
 * с "открытием сейчас" уходил в статус "Запланирован" на 5 часов дольше
 * реального — оператор не видел тест, хотя по местному времени он уже
 * должен был открыться.
 *
 * Конвертируем явно: new Date(localString) — браузер сам интерпретирует
 * строку без таймзоны как ЛОКАЛЬНОЕ время, затем .toISOString() даёт
 * корректный UTC-момент, который сервер поймёт правильно.
 */
function localDateTimeInputToUTCISOString(value) {
  if (!value) return null;
  const localDate = new Date(value); // браузер трактует как локальное время
  return localDate.toISOString();    // конвертирует в UTC автоматически
}

/** Обратная операция — для заполнения <input type="datetime-local"> при редактировании существующего теста */
function utcISOStringToLocalDateTimeInput(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function saveTestBuilder(publish) {
  const s = _testBuilderState;
  const el = document.getElementById('view-tests');

  const payload = s.status === 'open' ? {
    closes_at: localDateTimeInputToUTCISOString(el.querySelector('#tb-closes-at').value),
  } : {
    title: el.querySelector('#tb-title').value,
    description: el.querySelector('#tb-description').value,
    instruction: el.querySelector('#tb-instruction').value,
    time_limit_minutes: Number(el.querySelector('#tb-time-limit').value),
    opens_at: localDateTimeInputToUTCISOString(el.querySelector('#tb-opens-at').value),
    closes_at: localDateTimeInputToUTCISOString(el.querySelector('#tb-closes-at').value),
    passing_percent: Number(el.querySelector('#tb-passing-percent').value),
    show_result_after_finish: el.querySelector('#tb-show-result').checked,
    show_correct_answers: el.querySelector('#tb-show-correct').checked,
    allow_retake: el.querySelector('#tb-allow-retake').checked,
    max_attempts: Number(el.querySelector('#tb-max-attempts').value),
    reward_type: el.querySelector('#tb-reward-type').value,
    reward_points: Number(el.querySelector('#tb-reward-points').value),
    reward_coins: Number(el.querySelector('#tb-reward-coins').value),
    reward_min_percent: Number(el.querySelector('#tb-reward-min-percent').value),
    reward_mode: el.querySelector('#tb-reward-mode').value,
  };

  if (s.status !== 'open' && !payload.title.trim()) { showToast('Укажите название теста', 'error'); return; }
  if (s.status !== 'open') {
    if (publish && !s.questions.length) { showToast('Добавьте хотя бы один вопрос', 'error'); return; }
    if (publish && s.assignTargetType !== 'all' && !s.assignTargetIds.length) { showToast('Выберите аудиторию теста', 'error'); return; }
    for (const question of s.questions) {
      if (!question.question_text.trim()) { showToast('Заполните текст каждого вопроса', 'error'); return; }
      if (question.answers.some(answer => !answer.answer_text.trim())) { showToast(`Заполните все варианты ответа в вопросе «${question.question_text}»`, 'error'); return; }
      const correctCount = question.answers.filter(answer => answer.is_correct).length;
      if (!correctCount) { showToast(`У вопроса «${question.question_text}» не указан правильный ответ`, 'error'); return; }
      if (question.question_type === 'single_choice' && correctCount !== 1) { showToast(`В вопросе «${question.question_text}» должен быть один правильный ответ`, 'error'); return; }
    }
  }

  try {
    let testId = s.testId;
    if (testId) {
      await api.updateTest(testId, payload);
    } else {
      const created = await api.createTest(payload);
      testId = created.id;
      s.testId = testId;
    }

    for (const questionId of (s.status === 'open' ? [] : s.deletedQuestionIds)) {
      await api.deleteTestQuestion(questionId);
    }
    s.deletedQuestionIds = [];

    for (const [questionIndex, q] of (s.status === 'open' ? [] : s.questions).entries()) {
      const qPayload = { question_text: q.question_text, question_type: q.question_type, points: q.points, sort_order: questionIndex, answers: q.answers.map((answer, answerIndex) => ({ ...answer, sort_order: answerIndex })) };
      if (q.id) await api.updateTestQuestion(q.id, qPayload);
      else { const created = await api.addTestQuestion(testId, qPayload); q.id = created.id; }
    }

    await api.assignTest(testId, { target_type: s.assignTargetType, target_ids: s.assignTargetIds });

    if (publish && s.status !== 'open') {
      await api.publishTest(testId);
      showToast('Тест сохранён и опубликован', 'ok');
    } else {
      showToast('Тест сохранён', 'ok');
    }
    swrInvalidate('tests:'); // создание/редактирование/назначение — список тестов и видимость операторам могли измениться
    renderTests();
  } catch(e) {
    showToast(e.message || 'Не удалось сохранить тест', 'error');
  }
}

/* ── Результаты и аналитика для руководства ─────────────────────── */
async function openTestResultsView(testId) {
  const el = document.getElementById('view-tests');
  if (!el) return;

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Тесты</div><h2 class="section-title">Результаты</h2></div>
      <button class="btn-outline btn-sm" onclick="renderTests()">К списку</button>
    </div>
    <div class="filter-tabs" id="tr-tabs">
      <button class="filter-tab active" data-tr-tab="results">Результаты</button>
      <button class="filter-tab" data-tr-tab="analytics">Аналитика</button>
    </div>
    <div id="tr-body"><div class="loading-state"><div class="loading-spinner"></div></div></div>`;

  el.querySelectorAll('[data-tr-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('[data-tr-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.trTab === 'results') loadTestResultsTable(testId);
      else loadTestAnalyticsBlock(testId);
    });
  });

  await loadTestResultsTable(testId);
}

async function loadTestResultsTable(testId) {
  const body = document.getElementById('tr-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div></div>';
  try {
    const data = await api.getTestResults(testId);
    const items = data.items || [];
    if (!items.length) {
      body.innerHTML = `<div class="empty-state"><p>По выбранным фильтрам операций не найдено.</p></div>`;
      return;
    }
    body.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>Оператор</th><th>Группа</th><th>Статус</th><th>Начал</th><th>Завершил</th>
        <th class="num">Время</th><th class="num">Правильных</th><th class="num">%</th>
        <th class="num">Баллы</th><th class="num">Коины</th><th class="num">Попытка</th>
      </tr></thead>
      <tbody>
        ${items.map(r => `<tr>
          <td class="name-cell">${esc(r.operator_name)}</td>
          <td>${esc(r.group_name||'—')}</td>
          <td>${testStatusBadge(r.status==='finished'?(r.passed?'finished':'expired'):r.status)}</td>
          <td>${fmtDateTime(r.started_at)}</td>
          <td>${r.finished_at?fmtDateTime(r.finished_at):'—'}</td>
          <td class="num">${r.duration_seconds!=null?Math.round(r.duration_seconds/60)+' мин':'—'}</td>
          <td class="num">${r.correct_count}/${r.questions_count}</td>
          <td class="num"><b>${fmtA(r.score_percent,0)}%</b></td>
          <td class="num">${fmtA(r.score_points,1)}</td>
          <td class="num">${r.reward_coins||0}</td>
          <td class="num">${r.attempt_number}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  } catch(e) {
    body.innerHTML = `<div class="status-line status-error">${esc(e.message)}</div>`;
  }
}

async function loadTestAnalyticsBlock(testId) {
  const body = document.getElementById('tr-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div></div>';
  try {
    const a = await api.getTestAnalytics(testId);
    body.innerHTML = `
      <div class="an-kpi-grid">
        <div class="an-kpi-cell"><div class="an-kpi-label">Всего назначено</div><div class="an-kpi-value">${a.total_assigned}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Начали</div><div class="an-kpi-value">${a.started}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Завершили</div><div class="an-kpi-value">${a.finished}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Не начали</div><div class="an-kpi-value">${a.not_started}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Средний %</div><div class="an-kpi-value">${a.average_percent!=null?a.average_percent+'%':'—'}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Среднее время</div><div class="an-kpi-value">${a.average_duration_seconds!=null?Math.round(a.average_duration_seconds/60)+' мин':'—'}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Прошли</div><div class="an-kpi-value">${a.passed}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Не прошли</div><div class="an-kpi-value">${a.failed}</div></div>
      </div>
      <div class="rcard-title" style="margin-top:18px">Вопросы, вызывающие больше всего ошибок</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Вопрос</th><th class="num">Правильных</th><th class="num">Неправильных</th><th class="num">% ошибок</th></tr></thead>
        <tbody>
          ${(a.questions||[]).sort((x,y)=>(y.error_percent||0)-(x.error_percent||0)).map(q => `<tr>
            <td>${esc(q.question_text)}</td>
            <td class="num">${q.correct_count}</td>
            <td class="num">${q.incorrect_count}</td>
            <td class="num"><b>${q.error_percent!=null?q.error_percent+'%':'—'}</b></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    `;
  } catch(e) {
    body.innerHTML = `<div class="status-line status-error">${esc(e.message)}</div>`;
  }
}

/* ══════════════════════════════════════
   РОЗЫГРЫШИ (ТЗ P2)
   Билеты — только из Колеса WOW. Оператор вкладывает билеты в розыгрыш,
   админ запускает тираж (или он проходит автоматически по дате).
══════════════════════════════════════ */

function _raffleStatusBadge(status) {
  const map = {
    active: '<span class="badge badge-ok">активен</span>',
    drawn: '<span class="badge badge-muted">завершён</span>',
    cancelled: '<span class="badge badge-warning">отменён</span>',
  };
  return map[status] || esc(status);
}

function _rafflePrizeText(r) {
  const parts = [];
  if (r.prize_coins > 0) parts.push(`${r.prize_coins} ₡`);
  if (r.prize_description) parts.push(esc(r.prize_description));
  return parts.length ? parts.join(' + ') : '—';
}

function _raffleWinnersHtml(r) {
  if (r.status !== 'drawn' || !r.winners || !r.winners.length) return '';
  return `<div class="raffle-winners">
    <div class="raffle-winners-title">🏆 Победители</div>
    ${r.winners.map(w => `<div class="raffle-winner-row">${esc(w.operator_name || ('#' + w.operator_id))}${w.prize_coins ? ` · +${w.prize_coins} ₡` : ''}</div>`).join('')}
  </div>`;
}

async function renderRaffles() {
  const el = document.getElementById('view-raffles');
  if (!el) return;
  const admin = isAdmin(STATE.user?.role);
  el.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка розыгрышей…</p></div>';
  try {
    if (admin) await renderRafflesAdmin(el);
    else await renderRafflesOperator(el);
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Не удалось загрузить: ${esc(e.message || e)}</div>`;
  }
}

/* ── Оператор ─────────────────────────────────────────── */
async function renderRafflesOperator(el) {
  const data = await swrFetch(
    'raffles:me',
    () => api.getMyRaffles(),
    () => { if (STATE.currentView === 'raffles' && !isAdmin(STATE.user?.role)) renderRafflesOperator(el); },
    SWR_FAST_TTL_MS,
  );
  const tickets = data.raffle_tickets || 0;
  const raffles = data.raffles || [];
  const active = raffles.filter(r => r.status === 'active');
  const finished = raffles.filter(r => r.status !== 'active');

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Геймификация</div>
        <h2 class="section-title">Розыгрыши</h2>
      </div>
      <div class="raffle-tickets-badge">🎟 Мои билеты: <b>${tickets}</b></div>
    </div>
    <p class="panel-hint" style="margin:-4px 0 16px">Билеты можно выиграть в Колесе WOW. Вложите билеты в розыгрыш — чем больше билетов, тем выше шанс.</p>

    ${active.length ? `<div class="raffle-grid">${active.map(r => _raffleCardOperator(r, tickets)).join('')}</div>`
      : '<div class="empty-state">Сейчас нет активных розыгрышей</div>'}

    ${finished.length ? `<h3 class="panel-subtitle" style="margin-top:24px">Завершённые</h3>
      <div class="raffle-grid">${finished.map(r => _raffleCardOperator(r, tickets)).join('')}</div>` : ''}`;

  el.querySelectorAll('[data-enter-raffle]').forEach(btn => {
    btn.onclick = () => _openEnterRaffleModal(parseInt(btn.dataset.enterRaffle, 10), tickets);
  });
}

function _raffleCardOperator(r, myTickets) {
  const canEnter = r.status === 'active' && myTickets > 0;
  return `<div class="raffle-card ${r.status !== 'active' ? 'raffle-card-done' : ''}">
    <div class="raffle-card-head">
      <div class="raffle-card-title">${esc(r.title)}</div>
      ${_raffleStatusBadge(r.status)}
    </div>
    ${r.description ? `<div class="raffle-card-desc">${esc(r.description)}</div>` : ''}
    <div class="raffle-card-prize">Приз: <b>${_rafflePrizeText(r)}</b>${r.winners_count > 1 ? ` · ${r.winners_count} победителей` : ''}</div>
    <div class="raffle-card-meta">
      Участников: ${r.participants} · Билетов всего: ${r.total_tickets}
      ${r.ends_at ? ` · до ${fmtDateTime(r.ends_at)}` : ''}
    </div>
    ${r.my_tickets_in > 0 ? `<div class="raffle-card-mine">Вы вложили: ${r.my_tickets_in} билет(ов)</div>` : ''}
    ${_raffleWinnersHtml(r)}
    ${r.status === 'active' ? `<button class="btn-primary btn-sm" data-enter-raffle="${r.id}" ${canEnter ? '' : 'disabled'}>
      ${myTickets > 0 ? (r.my_tickets_in > 0 ? 'Добавить билеты' : 'Участвовать') : 'Нет билетов'}
    </button>` : ''}
  </div>`;
}

function _openEnterRaffleModal(raffleId, maxTickets) {
  showModal(`
    <h3 class="modal-title">Участие в розыгрыше</h3>
    <div class="form-group">
      <label class="form-label">Сколько билетов вложить? <span class="hint">(доступно: ${maxTickets})</span></label>
      <input id="raffle-enter-tickets" class="form-input" type="number" min="1" max="${maxTickets}" value="1">
    </div>
    <div id="raffle-enter-err" class="status-line"></div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" onclick="submitEnterRaffle(${raffleId})">Участвовать</button>
    </div>`);
}

async function submitEnterRaffle(raffleId) {
  const input = document.getElementById('raffle-enter-tickets');
  const errEl = document.getElementById('raffle-enter-err');
  const tickets = parseInt(input?.value, 10);
  if (!tickets || tickets < 1) { if (errEl) errEl.textContent = 'Укажите число билетов'; return; }
  try {
    await api.enterRaffle(raffleId, tickets);
    swrInvalidate('raffles:');
    swrInvalidate('wheel:');
    showToast('Вы в игре! Удачи 🍀', 'ok');
    closeModal();
    renderRaffles();
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}

/* ── Админ ────────────────────────────────────────────── */
async function renderRafflesAdmin(el) {
  const raffles = await swrFetch(
    'raffles:admin',
    () => api.listRafflesAdmin(),
    () => { if (STATE.currentView === 'raffles' && isAdmin(STATE.user?.role)) renderRafflesAdmin(el); },
    SWR_FAST_TTL_MS,
  );
  const active = raffles.filter(r => r.status === 'active');
  const finished = raffles.filter(r => r.status !== 'active');

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Геймификация</div>
        <h2 class="section-title">Розыгрыши</h2>
      </div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="renderRaffles()">Обновить</button>
        <button class="btn-primary" onclick="openCreateRaffleModal()">+ Новый розыгрыш</button>
      </div>
    </div>
    <p class="panel-hint" style="margin:-4px 0 16px">Участники вкладывают билеты, выигранные в Колесе WOW. Тираж можно запустить вручную или он пройдёт автоматически по дате окончания.</p>

    ${active.length ? `<div class="raffle-grid">${active.map(_raffleCardAdmin).join('')}</div>`
      : '<div class="empty-state">Нет активных розыгрышей</div>'}

    ${finished.length ? `<h3 class="panel-subtitle" style="margin-top:24px">Архив</h3>
      <div class="raffle-grid">${finished.map(_raffleCardAdmin).join('')}</div>` : ''}`;

  el.querySelectorAll('[data-draw-raffle]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Запустить тираж сейчас? Победители определятся окончательно.')) return;
      try { await api.drawRaffle(parseInt(btn.dataset.drawRaffle, 10)); swrInvalidate('raffles:'); showToast('Розыгрыш проведён', 'ok'); renderRaffles(); }
      catch (e) { showToast(e.message, 'error'); }
    };
  });
  el.querySelectorAll('[data-cancel-raffle]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Отменить розыгрыш? Вложенные билеты вернутся участникам.')) return;
      try { await api.cancelRaffle(parseInt(btn.dataset.cancelRaffle, 10)); swrInvalidate('raffles:'); showToast('Розыгрыш отменён', 'ok'); renderRaffles(); }
      catch (e) { showToast(e.message, 'error'); }
    };
  });
}

function _raffleCardAdmin(r) {
  return `<div class="raffle-card ${r.status !== 'active' ? 'raffle-card-done' : ''}">
    <div class="raffle-card-head">
      <div class="raffle-card-title">${esc(r.title)}</div>
      ${_raffleStatusBadge(r.status)}
    </div>
    ${r.description ? `<div class="raffle-card-desc">${esc(r.description)}</div>` : ''}
    <div class="raffle-card-prize">Приз: <b>${_rafflePrizeText(r)}</b> · победителей: ${r.winners_count}</div>
    <div class="raffle-card-meta">
      Участников: ${r.participants} · Билетов всего: ${r.total_tickets}
      ${r.ends_at ? ` · до ${fmtDateTime(r.ends_at)}` : ''}
      ${r.drawn_at ? ` · разыгран ${fmtDateTime(r.drawn_at)}` : ''}
    </div>
    ${_raffleWinnersHtml(r)}
    ${r.status === 'active' ? `<div class="raffle-card-actions">
      <button class="btn-primary btn-sm" data-draw-raffle="${r.id}" ${r.participants > 0 ? '' : 'disabled'}>Разыграть сейчас</button>
      <button class="btn-outline btn-sm danger-text" data-cancel-raffle="${r.id}">Отменить</button>
    </div>` : ''}
  </div>`;
}

function openCreateRaffleModal() {
  showModal(`
    <h3 class="modal-title">Новый розыгрыш</h3>
    <div class="form-group"><label class="form-label">Название</label>
      <input id="nr-title" class="form-input" placeholder="Например: Розыгрыш сертификата"></div>
    <div class="form-group"><label class="form-label">Описание <span class="hint">(необязательно)</span></label>
      <input id="nr-desc" class="form-input" placeholder="Условия, детали приза"></div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Приз в коинах <span class="hint">(0 — без коинов)</span></label>
        <input id="nr-coins" class="form-input" type="number" min="0" value="0"></div>
      <div class="form-group"><label class="form-label">Число победителей</label>
        <input id="nr-winners" class="form-input" type="number" min="1" value="1"></div>
    </div>
    <div class="form-group"><label class="form-label">Приз (текст) <span class="hint">(если не коины)</span></label>
      <input id="nr-prize-desc" class="form-input" placeholder="Например: сертификат на 5000 ₸"></div>
    <div class="form-group"><label class="form-label">Дата окончания <span class="hint">(необязательно — иначе только вручную)</span></label>
      <input id="nr-ends" class="form-input" type="datetime-local"></div>
    <div id="nr-err" class="status-line"></div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" onclick="submitCreateRaffle()">Создать</button>
    </div>`);
}

async function submitCreateRaffle() {
  const title = document.getElementById('nr-title')?.value?.trim();
  const errEl = document.getElementById('nr-err');
  if (!title) { if (errEl) errEl.textContent = 'Укажите название'; return; }
  const payload = {
    title,
    description: document.getElementById('nr-desc')?.value?.trim() || '',
    prize_coins: parseInt(document.getElementById('nr-coins')?.value, 10) || 0,
    prize_description: document.getElementById('nr-prize-desc')?.value?.trim() || '',
    winners_count: parseInt(document.getElementById('nr-winners')?.value, 10) || 1,
    ends_at: document.getElementById('nr-ends')?.value || null,
  };
  try {
    await api.createRaffle(payload);
    swrInvalidate('raffles:');
    showToast('Розыгрыш создан', 'ok');
    closeModal();
    renderRaffles();
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}

window.renderRaffles = renderRaffles;
window.submitEnterRaffle = submitEnterRaffle;
window.openCreateRaffleModal = openCreateRaffleModal;
window.submitCreateRaffle = submitCreateRaffle;

/* Operator workspace v3: one visual system for cabinet and rating. */

const OP_COIN = '₡';

function opNum(value, digits = 0) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('ru-RU', { maximumFractionDigits: digits }) : '0';
}

function opCoin(value, sign = false) {
  const number = Number(value || 0);
  return `${sign && number > 0 ? '+' : ''}${opNum(number)} <span class="op-coin">${OP_COIN}</span>`;
}

function opPercent(value) {
  return `${opNum(value, 1)}%`;
}

function opEmpty(title, text) {
  return `<div class="op-empty"><div class="op-empty-mark">—</div><b>${esc(title)}</b><span>${esc(text || '')}</span></div>`;
}

function opPanel(title, body, meta = '', className = '') {
  return `<section class="op-panel ${className}">
    <header class="op-panel-head"><h3>${title}</h3>${meta ? `<span>${meta}</span>` : ''}</header>
    <div class="op-panel-body">${body}</div>
  </section>`;
}

function opMetric(label, value, target, tone = '') {
  const metricNumber = raw => Number(String(raw ?? 0).replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
  const current = metricNumber(value);
  const goal = metricNumber(target);
  const width = goal > 0 ? Math.min(100, Math.max(0, current / goal * 100)) : Math.min(100, Math.max(0, current));
  return `<div class="op-metric">
    <div class="op-metric-line"><span>${esc(label)}</span><b>${esc(String(value))}${target ? ` <small>/ ${esc(String(target))}</small>` : ''}</b></div>
    <div class="op-progress"><i class="${tone}" style="width:${width}%"></i></div>
  </div>`;
}

function opCabinetLevel(levelInfo) {
  if (!levelInfo) return opEmpty('Уровень не рассчитан', 'Данные появятся после первого расчёта периода.');
  const level = levelInfo.level || {};
  const gaps = levelInfo.gaps || [];
  return `<div class="op-level-main">
    <div><span class="op-label">Текущий уровень</span><div class="op-level-name">${levelBadgeHtml(level)} <strong>${esc(level.name || 'Стажёр')}</strong></div></div>
    <div class="op-level-tenure"><span>Стаж</span><b>${esc(formatTenureDays(levelInfo.metrics?.tenure_days || 0))}</b></div>
  </div>
  ${levelInfo.next_level ? `<div class="op-next-level"><span>Следующий уровень</span>${levelBadgeHtml(levelInfo.next_level)}</div>` : '<div class="op-success-line">Максимальный уровень достигнут</div>'}
  <div class="op-requirements">${gaps.length ? gaps.slice(0, 4).map(g => `<div class="op-requirement ${g.ok ? 'is-ready' : ''}"><span>${esc(g.label)}</span><b>${metricValueHtml(g)}</b><small>${g.ok ? 'Выполнено' : levelRequirementHtml(g)}</small></div>`).join('') : '<div class="op-success-line">Все требования выполнены</div>'}</div>`;
}

function opCabinetAchievements(data) {
  const completed = data?.completed || [];
  const pending = data?.in_progress || [];
  const rows = [...completed.map(x => ({ ...x, done: true })), ...pending.map(x => ({ ...x, done: false }))];
  if (!rows.length) return opEmpty('Достижений пока нет', 'Новые цели появятся после расчёта показателей.');
  return `<div class="op-achievement-grid">${rows.slice(0, 8).map(row => {
    const goal = Number(row.condition_value || 0);
    const progress = Number(row.progress_value || 0);
    const pct = row.done ? 100 : (goal > 0 ? Math.min(100, progress / goal * 100) : 0);
    return `<article class="op-achievement ${row.done ? 'is-done' : ''}">
      <span class="op-achievement-icon">${achievementVisualIcon(row, 'op-achievement-svg')}</span>
      <div><b>${esc(row.title || 'Достижение')}</b><small>${row.done ? 'Получено' : `${opNum(progress, 1)} из ${opNum(goal, 1)}`}</small><div class="op-mini-progress"><i style="width:${pct}%"></i></div></div>
    </article>`;
  }).join('')}</div>`;
}

function opCabinetWeek(metrics) {
  if (!metrics) return opEmpty('Период ещё не рассчитан', 'После загрузки отчёта здесь появятся показатели недели.');
  return `${opMetric('Выработка часов', opNum(metrics.hours, 1), opNum(metrics.hours_target, 1), 'is-green')}
    ${opMetric('Качество', opPercent(metrics.quality), opPercent(metrics.quality_target), 'is-blue')}
    ${opMetric('Эффективность', opPercent(metrics.efficiency), '', 'is-violet')}
    <div class="op-stat-triplet">
      <div><span>Звонков в час</span><b>${opNum(metrics.calls_per_hour, 1)}</b></div>
      <div><span>Опоздания</span><b>${opNum(metrics.late_minutes)} мин</b></div>
      <div><span>Нарушения</span><b>${opNum(metrics.violations)}</b></div>
    </div>`;
}

function opCabinetCoins(calc) {
  if (!calc) return opEmpty('Расчёта пока нет', 'Коины появятся после расчёта периода.');
  const bonuses = calc.bonuses || [];
  return `<div class="op-calc-total"><span>Итоговый балл</span><b>${opNum(calc.contest_points, 1)}</b></div>
    <div class="op-calc-row"><span>Базовые коины</span><b>${opCoin(calc.base_coins)}</b></div>
    ${bonuses.map(b => `<div class="op-calc-row is-bonus"><span>${esc(b.label || b.type)}</span><b>${opCoin(b.coins, true)}</b></div>`).join('')}
    <div class="op-calc-final"><span>Итого за неделю</span><b>${opCoin(calc.total_week_coins)}</b></div>
    <div class="op-calc-note">${calc.is_final ? 'Начисление применено' : 'Предварительный расчёт'}</div>`;
}

function opCabinetWheel(status, winners) {
  const tickets = Number(status?.available_tickets || 0);
  const top = winners?.top;
  return `<div class="op-wheel-main">
    <div class="op-wheel-badge">WOW</div>
    <div><span class="op-label">Доступные вращения</span><strong>${tickets}</strong><p>${esc(status?.message || 'Выполняйте условия, чтобы получить билет.')}</p></div>
    <button class="${tickets ? 'btn-primary' : 'btn-outline'}" onclick="navigateTo('wheel')">${tickets ? 'Крутить' : 'Открыть колесо'}</button>
  </div>
  ${top ? `<div class="op-winner"><span>Крупнейший приз сегодня</span><b>${esc(top.operator_name || '—')}</b><strong>${top.prize_type === 'coins' ? opCoin(top.amount, true) : esc(top.prize || '—')}</strong></div>` : '<div class="op-wheel-foot">Сегодня победителей пока нет</div>'}`;
}

function opTransactions(items) {
  if (!items?.length) return opEmpty('Операций пока нет', 'История начислений появится здесь.');
  return `<div class="op-list">${items.slice(0, 6).map(row => `<div class="op-list-row"><div><b>${esc(row.comment || row.type || 'Операция')}</b><small>${fmtDate(row.date || row.created_at)}</small></div><strong class="${Number(row.amount) >= 0 ? 'is-positive' : 'is-negative'}">${opCoin(row.amount, true)}</strong></div>`).join('')}</div>`;
}

function opTopWeek(rows, currentId) {
  if (!rows?.length) return opEmpty('Рейтинг ещё не рассчитан', 'Результаты появятся после расчёта периода.');
  return `<div class="op-rank-list">${rows.slice(0, 5).map((row, index) => `<div class="op-rank-row ${Number(row.operator_id) === Number(currentId) ? 'is-me' : ''}"><span>${row.rank_position || index + 1}</span><div><b>${esc(row.operator_name || row.full_name || 'Оператор')}</b><small>${esc(row.group_name || 'Без группы')}</small></div><strong>${opNum(row.contest_points || row.final_score, 1)}</strong></div>`).join('')}</div>`;
}

function renderCabinet() {
  const el = document.getElementById('view-cabinet');
  if (!el) return;
  if (!['operator', 'supervisor'].includes(STATE.user?.role)) {
    el.innerHTML = `<div class="op-page">${opEmpty('Личный кабинет недоступен', 'Он предназначен для аккаунтов, связанных с оператором.')}</div>`;
    return;
  }
  const snapshot = STATE.cabinetSnapshot;
  if (!snapshot) {
    el.innerHTML = `<div class="op-page"><div class="op-page-head"><div><span>Кабинет</span><h1>Мой рабочий день</h1></div></div>${cabinetLoadingHtml()}</div>`;
    const nav = STATE.navGen;
    loadCabinetSnapshot(false).then(() => { if (!isNavStale(nav)) renderCabinet(); }).catch(() => { if (!isNavStale(nav)) renderCabinet(); });
    return;
  }
  syncCabinetSnapshot(snapshot);
  const wallet = snapshot.wallet || {};
  const rating = snapshot.rating || {};
  const level = snapshot.level || {};
  const tenure = formatTenureDays(level.metrics?.tenure_days || 0);
  const completed = snapshot.achievements?.completed?.length || 0;
  el.innerHTML = `<div class="op-page op-cabinet-page">
    <div class="op-page-head"><div><span>Кабинет оператора</span><h1>Мой рабочий день</h1><p>Главные результаты, цели и награды в одном месте</p></div><button class="btn-outline btn-sm" onclick="reloadCabinet()">Обновить</button></div>
    <div class="op-kpi-grid">
      <article class="op-kpi is-primary"><span>Баланс</span><strong>${opCoin(wallet.balance)}</strong><small>доступно для покупок</small></article>
      <article class="op-kpi"><span>За неделю</span><strong>${opCoin(wallet.earned_this_week)}</strong><small>заработано коинов</small></article>
      <article class="op-kpi"><span>Место</span><strong>${rating.place ? `#${rating.place} <small>из ${rating.total_participants}</small>` : '—'}</strong><small>${rating.delta ? `${rating.delta > 0 ? 'Выше' : 'Ниже'} на ${Math.abs(rating.delta)}` : 'без изменений'}</small></article>
      <article class="op-kpi"><span>Стаж</span><strong class="is-text">${esc(tenure)}</strong><small>${completed} достижений получено</small></article>
    </div>
    <div class="op-dashboard-grid op-dashboard-top">
      ${opPanel('Мой уровень', opCabinetLevel(snapshot.level), '', 'op-level-panel')}
      ${opPanel('Мои достижения', opCabinetAchievements(snapshot.achievements), `${completed} получено`, 'op-achievements-panel')}
    </div>
    <div class="op-dashboard-grid op-dashboard-week">
      ${opPanel('Показатели недели', opCabinetWeek(snapshot.week_metrics), snapshot.week_metrics ? `${fmtDate(snapshot.week_metrics.period_start)} — ${fmtDate(snapshot.week_metrics.period_end)}` : '')}
      ${opPanel('Расчёт коинов', opCabinetCoins(snapshot.coin_calculation), snapshot.coin_calculation?.is_final ? 'Начислено' : 'Предварительно')}
    </div>
    ${opPanel('Колесо WOW', opCabinetWheel(snapshot.wheel, snapshot.winners_today), '', 'op-wheel-panel')}
    <div class="op-dashboard-grid op-dashboard-bottom">
      ${opPanel('История начислений', opTransactions(snapshot.recent_transactions), `${snapshot.recent_transactions?.length || 0} операций`)}
      ${opPanel('Топ недели', opTopWeek(snapshot.top_week, snapshot.operator?.id), '', 'op-top-panel')}
    </div>
    <div class="op-shop-strip"><div><b>Магазин бонусов</b><span>Доступно ${opCoin(wallet.balance)} для обмена</span></div><button class="btn-primary" onclick="navigateTo('shop')">Открыть магазин</button></div>
  </div>`;
}

async function opRatingRequest(path, fallback) {
  try { return await api._req('GET', path); } catch (_) { return fallback; }
}

function opRatingTabs() {
  return `<div class="op-tabs">${RATING_TABS.map(tab => `<button class="${tab.key === _ratingActiveTab ? 'active' : ''}" data-op-rating-tab="${tab.key}">${esc(tab.label)}</button>`).join('')}</div>`;
}

async function renderRating() {
  const el = document.getElementById('view-rating');
  if (!el) return;
  el.innerHTML = `<div class="op-page op-rating-page"><div class="op-page-head"><div><span>Рейтинг</span><h1>Мои результаты</h1><p>Позиция, динамика и сравнение с командой</p></div><button class="btn-outline btn-sm" data-rating-refresh>Обновить</button></div>${opRatingTabs()}<div id="rating-tab-content" class="op-rating-content"><div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div></div></div>`;
  el.querySelector('[data-rating-refresh]')?.addEventListener('click', () => { swrInvalidate('rating'); swrInvalidate('race:'); renderRating(); });
  el.querySelectorAll('[data-op-rating-tab]').forEach(button => button.addEventListener('click', () => {
    _ratingActiveTab = button.dataset.opRatingTab;
    el.querySelectorAll('[data-op-rating-tab]').forEach(item => item.classList.toggle('active', item === button));
    loadRatingTab(_ratingActiveTab);
  }));
  await loadRatingTab(_ratingActiveTab);
}

async function loadRatingTab(tab) {
  const host = document.getElementById('rating-tab-content');
  if (!host) return;
  const nav = STATE.navGen;
  host.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>';
  try {
    if (tab === 'overview') await opRenderRatingOverview(host);
    else if (tab === 'race') await opRenderRatingRaceRestored(host);
    else if (tab === 'groups') await opRenderRatingGroups(host);
    else await opRenderRatingProgress(host);
  } catch (error) {
    if (!isNavStale(nav)) host.innerHTML = opEmpty('Не удалось загрузить раздел', error.message || 'Попробуйте обновить страницу.');
  }
}

function opRatingRow(row, index, maxPoints) {
  const points = Number(row.contest_points || row.final_score || row.points || 0);
  const width = Math.max(4, Math.round(points / Math.max(maxPoints, 1) * 100));
  return `<div class="op-leader-row ${row.is_current_user ? 'is-me' : ''}"><span class="op-place">${row.rank_position || row.rank || index + 1}</span><div class="op-person"><b>${esc(row.operator_name || row.full_name || 'Оператор')}</b><small>${esc(row.group_name || row.group || 'Без группы')}</small></div><div class="op-score-bar"><i style="width:${width}%"></i></div><strong>${opNum(points, 1)}<small> баллов</small></strong><em>${opCoin(row.coins_earned || 0)}</em></div>`;
}

async function opRenderRatingOverview(host) {
  const [overview, me, nominations, dynamics] = await Promise.all([
    swrFetch('rating:v3:overview', () => api.getRating(), null, SWR_FAST_TTL_MS),
    opRatingRequest('/api/rating/me', {}),
    opRatingRequest('/api/rating/nominations', { items: [] }),
    opRatingRequest('/api/rating/operator-dynamics?mode=points&limit=6', { items: [] }),
  ]);
  const rows = overview?.items || [];
  const max = Math.max(...rows.map(row => Number(row.contest_points || row.final_score || 0)), 1);
  const podium = rows.slice(0, 3);
  host.innerHTML = `<div class="op-rating-summary">
    <div><span>Период</span><b>${esc(overview.period || 'Не рассчитан')}</b></div><div><span>Участников</span><b>${rows.length}</b></div><div><span>Моё место</span><b>${me.place ? `#${me.place} из ${me.total_participants}` : '—'}</b></div><div><span>Мой баланс</span><b>${opCoin(me.total_balance)}</b></div>
  </div>
  <div class="op-dashboard-grid op-rating-hero-grid">
    ${opPanel('Мой результат', `<div class="op-my-result"><span class="op-big-place">${me.place ? `#${me.place}` : '—'}</span><div><b>${esc(me.full_name || STATE.user?.full_name || 'Оператор')}</b><small>${esc(me.group_name || 'Без группы')}</small></div></div><div class="op-result-stats"><div><span>Баллы</span><b>${opNum(me.weekly_points, 1)}</b></div><div><span>Коины</span><b>${opCoin(me.weekly_coins)}</b></div><div><span>Качество</span><b>${opPercent(me.quality_score)}</b></div></div>`)}
    ${opPanel('Лидеры недели', podium.length ? `<div class="op-podium">${podium.map((row, i) => `<article><span>${i + 1}</span><b>${esc(row.operator_name)}</b><small>${esc(row.group_name || 'Без группы')}</small><strong>${opNum(row.contest_points, 1)}</strong></article>`).join('')}</div>` : opEmpty('Нет результатов', 'Рейтинг появится после расчёта периода.'))}
  </div>
  <div class="op-dashboard-grid op-rating-insights">
    ${opPanel('Динамика последних дней', opDynamicsMini(dynamics.items || []))}
    ${opPanel('Номинации недели', opNominations(nominations.items || []))}
  </div>
  ${opPanel('Общий рейтинг', rows.length ? `<div class="op-leader-list">${rows.map((row, i) => opRatingRow(row, i, max)).join('')}</div>` : opEmpty('Рейтинг пока пуст', 'После расчёта периода здесь появятся участники.'), `${rows.length} участников`)} `;
}

function opDynamicsMini(items) {
  if (!items.length) return opEmpty('Недостаточно истории', 'Динамика появится после нескольких рабочих дней.');
  const max = Math.max(...items.map(item => Number(item.daily_points || item.value || 0)), 1);
  return `<div class="op-dynamics-bars">${items.map(item => { const value = Number(item.daily_points || item.value || 0); return `<div><span>${esc(item.label || item.week || '')}</span><i><b style="width:${Math.max(4, value / max * 100)}%"></b></i><strong>${opNum(value, 1)}</strong></div>`; }).join('')}</div>`;
}

function opNominations(items) {
  if (!items.length) return opEmpty('Номинаций пока нет', 'Они появятся после расчёта недели.');
  return `<div class="op-nominations">${items.slice(0, 4).map(item => `<article><span>${item.is_current_user ? 'Это вы' : 'Номинация'}</span><b>${esc(item.title || item.name || 'Лучший результат')}</b><small>${esc(item.winner_name || item.operator_name || '—')} · ${esc(item.value || '')}</small><strong>${item.coins_bonus ? opCoin(item.coins_bonus, true) : ''}</strong></article>`).join('')}</div>`;
}

async function opRenderRatingRace(host) {
  const data = await swrFetch('race:v3:all', () => api.getRatingRace({ mode: 'all' }), null, SWR_FAST_TTL_MS);
  const items = data.items || [];
  const current = data.current_user;
  const max = Math.max(...items.map(item => Number(item.points || 0)), 1);
  host.innerHTML = `${opPanel('Гонка баллов', `<div class="op-race-intro"><div><b>${current?.rank ? `Вы на ${current.rank}-м месте` : 'Ваше место пока не рассчитано'}</b><span>${current?.points_to_next_rank ? `До следующего места: ${opNum(current.points_to_next_rank, 1)} балла` : 'Сравнение строится по итоговому баллу периода'}</span></div><div class="op-race-legend"><span><i></i>Вы</span><span><i></i>Другие участники</span></div></div>${items.length ? `<div class="op-race-list">${items.map((row, i) => opRatingRow({ ...row, contest_points: row.points }, i, max)).join('')}</div>` : opEmpty('Нет участников гонки', 'Данные появятся после расчёта периода.')}`, `${items.length} участников`, 'op-race-panel')}`;
}

async function opRenderRatingRaceRestored(host) {
  // Keep the redesigned page shell, but use the complete race component with
  // group filters, view modes and the Formula 1 car visualization.
  await renderRatingRaceTab(host);
}

async function opRenderRatingGroups(host) {
  const data = await swrFetch('race:v3:groups', () => api.getRatingRace({ mode: 'all' }), null, SWR_FAST_TTL_MS);
  const groups = [...(data.groups || [])].sort((a, b) => Number(b.avg_points) - Number(a.avg_points));
  const members = {};
  (data.items || []).forEach(item => { const name = item.group || 'Без группы'; members[name] = (members[name] || 0) + 1; });
  const max = Math.max(...groups.map(group => Number(group.avg_points || 0)), 1);
  host.innerHTML = `<div class="op-rating-summary"><div><span>Групп</span><b>${groups.length}</b></div><div><span>Лидер</span><b>${esc(groups[0]?.group || '—')}</b></div><div><span>Лучший средний балл</span><b>${opNum(groups[0]?.avg_points, 1)}</b></div><div><span>Участников</span><b>${data.total_participants || 0}</b></div></div>
  ${opPanel('Сравнение групп', groups.length ? `<div class="op-group-list">${groups.map((group, i) => `<article><span>${i + 1}</span><div><b>${esc(group.group || 'Без группы')}</b><small>${members[group.group] || 0} участников</small></div><i><b style="width:${Math.max(4, Number(group.avg_points || 0) / max * 100)}%"></b></i><strong>${opNum(group.avg_points, 1)}<small> средний балл</small></strong></article>`).join('')}</div>` : opEmpty('Недостаточно данных для сравнения', 'Нужно рассчитать результаты хотя бы одной группы.'), `${groups.length} групп`)}`;
}

async function opRenderRatingProgress(host) {
  const [points, coins, ranks, me] = await Promise.all([
    opRatingRequest('/api/rating/operator-dynamics?mode=points&limit=8', { items: [], summary: {} }),
    opRatingRequest('/api/rating/operator-dynamics?mode=coins&limit=8', { items: [], summary: {} }),
    opRatingRequest('/api/rating/operator-dynamics?mode=rank&limit=8', { items: [], summary: {} }),
    opRatingRequest('/api/rating/me', {}),
  ]);
  const items = points.items || [];
  host.innerHTML = `<div class="op-rating-summary"><div><span>Текущий результат</span><b>${opNum(points.summary?.today_value, 1)} балла</b></div><div><span>Среднее</span><b>${opNum(points.summary?.average_4_days, 1)}</b></div><div><span>Коины за день</span><b>${opCoin(coins.summary?.today_value)}</b></div><div><span>Текущее место</span><b>${me.place ? `#${me.place}` : '—'}</b></div></div>
  ${opPanel('Динамика результатов', items.length ? opProgressInfographic(items, coins.items || [], ranks.items || []) : opEmpty('Истории прогресса пока нет', 'Загрузите рабочие показатели минимум за два дня. После этого здесь появится динамика баллов, коинов и места.'), `${items.length} дней`)}`;
}

function opProgressInfographic(pointItems, coinItems, rankItems) {
  const keyOf = item => String(item?.date || item?.label || '');
  const coinByDay = new Map(coinItems.map(item => [keyOf(item), Number(item.daily_coins || item.value || 0)]));
  const rankByDay = new Map(rankItems.map(item => [keyOf(item), Number(item.rank || item.value || 0)]));
  const days = pointItems.map((item, index) => ({
    date: item.label || item.date || `День ${index + 1}`,
    weekday: item.weekday || '',
    points: Number(item.daily_points || item.value || 0),
    coins: coinByDay.get(keyOf(item)) ?? Number(coinItems[index]?.daily_coins || item.daily_coins || 0),
    rank: rankByDay.get(keyOf(item)) ?? Number(rankItems[index]?.rank || 0),
  }));
  const maxPoints = Math.max(...days.map(day => day.points), 1);
  const minPoints = Math.min(...days.map(day => day.points));
  const bestIndex = days.findIndex(day => day.points === maxPoints);
  const latestIndex = days.length - 1;
  const rankedDays = days.filter(day => day.rank > 0);
  const stableRankDays = rankedDays.filter(day => day.rank === rankedDays[latestIndex]?.rank || day.rank === days[latestIndex]?.rank).length;
  const spread = Math.max(0, maxPoints - minPoints);

  return `<div class="op-progress-infographic">
    <div class="op-progress-chart-head">
      <div><b>Баллы по дням</b><span>Высота столбца показывает итоговый результат дня</span></div>
      <div class="op-progress-legend"><span><i></i>Баллы</span><span><i></i>Коины</span></div>
    </div>
    <div class="op-progress-chart-scroll">
      <div class="op-progress-chart" style="--progress-days:${days.length}" role="img" aria-label="Динамика баллов и коинов за ${days.length} дней">
        ${days.map((day, index) => {
          const height = Math.max(8, Math.round(day.points / maxPoints * 100));
          const state = `${index === bestIndex ? ' is-best' : ''}${index === latestIndex ? ' is-current' : ''}`;
          return `<article class="op-progress-day${state}" style="--progress-height:${height}%">
            <strong>${opNum(day.points, 1)}</strong>
            <div class="op-progress-bar-track"><i></i></div>
            <span class="op-progress-coin-value">${opCoin(day.coins)}</span>
            <b>${esc(day.date)}</b>
            <small>${esc(day.weekday)}${day.rank ? ` · #${day.rank}` : ''}</small>
          </article>`;
        }).join('')}
      </div>
    </div>
    <div class="op-progress-insights">
      <div><span>Лучший день</span><b>${esc(days[bestIndex].date)}</b><small>${opNum(maxPoints, 1)} балла</small></div>
      <div><span>Разброс результатов</span><b>${opNum(spread, 1)} балла</b><small>${spread <= 20 ? 'Стабильная динамика' : 'Есть заметные колебания'}</small></div>
      <div><span>Позиция удержана</span><b>${stableRankDays} из ${rankedDays.length || days.length} дней</b><small>${days[latestIndex].rank ? `Сейчас место #${days[latestIndex].rank}` : 'Место пока не рассчитано'}</small></div>
    </div>
  </div>`;
}

window.renderCabinet = renderCabinet;
window.renderRating = renderRating;

