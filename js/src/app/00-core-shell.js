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
const SWR_VERSION = 'section-prefetch-1'; // при смене версии весь кеш сбрасывается
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
  purchases: [],
  dashboard: null,
  adminOperators: [],
  users: [],
  myLevel: null,
  myOperator: null,
  operatorLevels: [],
  history: [],
  groups: [],
  cabinetData: null,
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
const VIEW_CACHE_SKIP = new Set(['analytics', 'period-report', 'wheel', 'sessions']); // эти разделы всегда рендерим заново

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
  const adminViews = ['summary','operators','operator-levels','coins','groups','shop','wheel','rating','cabinet','period-report','analytics','tests','sessions'];
  const operatorViews = ['cabinet','rating','shop','wheel','tests'];
  const allowedViews = isAdmin(role) ? adminViews : operatorViews;
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
  const views = isAdmin(role)
    ? ['summary', 'operators', ...(role === 'manager' || role === 'admin' ? ['operator-levels'] : []), 'coins', 'shop', 'wheel', 'raffles', 'tests', ...(canManageGroups(role) ? ['groups'] : []), ...(role === 'admin' ? ['sessions'] : []), 'period-report', 'analytics', 'cabinet', 'rating']
    : ['cabinet', 'rating', 'shop', 'wheel', 'raffles', 'tests'];
  shell.innerHTML = views.map(v => `<section class="app-view" id="view-${v}"></section>`).join('');
}

function renderSidebar(role) {
  document.querySelectorAll('.side-nav-link[data-nav-target]').forEach(link => {
    const t = link.dataset.navTarget;
    const adminViews = ['summary','operators','coins','period-report','analytics'];
    const managerViews = ['operator-levels'];
    const operatorViews = ['cabinet','rating','shop','wheel','tests'];
    const sharedViews = ['shop','rating','cabinet','wheel','tests']; // «Тесты» и «Колесо» доступны всем ролям
    let show = false;
    if (isAdmin(role)) {
      show = adminViews.includes(t) || sharedViews.includes(t);
      if (role === 'manager' || role === 'admin') show = show || managerViews.includes(t);
      if (canManageGroups(role)) show = show || t === 'groups';
      if (role === 'admin') show = show || t === 'sessions';
    } else {
      show = operatorViews.includes(t);
    }
    link.style.display = show ? '' : 'none';
  });
}

/* ══════════════════════════════════════
   VIEW: УРОВНИ ОПЕРАТОРОВ
══════════════════════════════════════ */
