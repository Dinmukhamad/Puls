/* Generated from js/src/{app,auth,components,utils,views}/**/*.js. Run npm run build after editing. */
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
const SWR_VERSION = 'levels-load-fix-1'; // при смене версии весь кеш сбрасывается
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

const COIN_TABS = ['overview', 'accrual', 'requests', 'history', 'rules'];
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
    const isAuthError = msg.includes('401') || msg.includes('403') ||
      msg.includes('unauthorized') || msg.includes('авторизац') ||
      msg.includes('токен') || msg.includes('forbidden');
    if (isAuthError) {
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
const VIEW_CACHE_SKIP = new Set(['analytics', 'period-report', 'wheel']); // эти разделы всегда рендерим заново

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
    case 'manual':   renderManual();   break;
    case 'requests': renderRequests(); break;
    case 'history':  renderHistory();  break;
    case 'groups':   renderGroups();   break;
    case 'period-report': renderPeriodReport(); break;
    case 'analytics': renderAnalytics(); break;
    case 'tests':    renderTests();    break;
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

  // Lazy preload групп
  if (isAdmin(role)) {
    setTimeout(() => {
      if (!STATE.groups?.length) api.listGroups().catch(() => []).then(g => STATE.groups = g);
    }, 2000);
  }

  // Restore last viewed section after F5 reload
  const restoredRoute = initialRouteForRole(role);
  const adminViews = ['summary','operators','operator-levels','coins','groups','shop','wheel','rating','cabinet','period-report','analytics','tests'];
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
    ? ['summary', 'operators', ...(role === 'manager' || role === 'admin' ? ['operator-levels'] : []), 'coins', 'shop', 'wheel', 'tests', ...(canManageGroups(role) ? ['groups'] : []), 'period-report', 'analytics', 'cabinet', 'rating']
    : ['cabinet', 'rating', 'shop', 'wheel', 'tests'];
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
    } else {
      show = operatorViews.includes(t);
    }
    link.style.display = show ? '' : 'none';
  });
}

/* ══════════════════════════════════════
   VIEW: УРОВНИ ОПЕРАТОРОВ
══════════════════════════════════════ */

async function renderOperatorLevelsSettings() {
  const el = document.getElementById('view-operator-levels');
  if (!el) return;
  if (!(STATE.user?.role === 'manager' || STATE.user?.role === 'admin')) {
    el.innerHTML = '<div class="empty-state"><p>Недостаточно прав</p></div>';
    return;
  }
  el.innerHTML = `<div class="view-header level-view-header">
    <div>
      <div class="section-kicker">Операторы</div>
      <h2 class="section-title">Уровни операторов</h2>
    </div>
    <div class="header-right level-header-actions">
      <button class="btn-outline btn-sm" onclick="recalculateOperatorLevelsUi()">Пересчитать</button>
      <button class="btn-primary btn-sm" onclick="showCreateOperatorLevelPrompt()">Добавить уровень</button>
    </div>
  </div>
  <div class="panel level-settings-shell"><div class="empty-state"><p>Загрузка уровней…</p></div></div>`;

  let levels = [];
  try {
    levels = await withTimeout(api.listAdminOperatorLevels(), 15000, 'Уровни не загрузились: сервер не ответил за 15 секунд');
  } catch (adminErr) {
    try {
      levels = await withTimeout(api.listOperatorLevels(), 15000, 'Уровни не загрузились: сервер не ответил за 15 секунд');
    } catch (publicErr) {
      el.innerHTML = `<div class="view-header level-view-header">
        <div>
          <div class="section-kicker">Операторы</div>
          <h2 class="section-title">Уровни операторов</h2>
        </div>
        <div class="header-right level-header-actions">
          <button class="btn-outline btn-sm" onclick="renderOperatorLevelsSettings()">Обновить</button>
        </div>
      </div>
      <div class="status-line status-error">${esc(publicErr.message || adminErr.message || 'Не удалось загрузить уровни')}</div>`;
      return;
    }
  }
  STATE.operatorLevels = levels;
  const rewardsData = await withTimeout(api.listOperatorLevelRewards(), 10000)
    .catch(() => ({ items: [] }));
  const rewardRows = Array.isArray(rewardsData) ? rewardsData : (rewardsData.items || []);

  function metricLabel(code) {
    return {
      tenure_days: 'Стаж',
      quality: 'Качество',
      kvz: 'КВЗ',
      efficiency: 'Эффективность',
      penalty_minutes: 'Штрафы',
      final_points: 'Итоговые баллы',
      test_percent: 'Тесты',
      total_xp: 'XP',
    }[code] || code;
  }

  function ruleText(rule) {
    const label = metricLabel(rule.metric_code);
    if (rule.operator === 'between') return `${label}: ${levelNum(rule.value_min)}-${levelNum(rule.value_max)}`;
    if (rule.operator === 'gte') return `${label} >= ${levelNum(rule.value_min)}`;
    if (rule.operator === 'lte') return `${label} <= ${levelNum(rule.value_max)}`;
    return `${label} = ${levelNum(rule.value_min)}`;
  }

  function rewardStatus(row) {
    if (!row.reward_coins) return '<span class="status-pill muted">Без бонуса</span>';
    if (row.reward_received) return '<span class="status-pill ok">Получен</span>';
    return '<span class="status-pill warn">Ожидает повышения</span>';
  }

  el.innerHTML = `<div class="view-header level-view-header">
    <div>
      <div class="section-kicker">Операторы</div>
      <h2 class="section-title">Уровни операторов</h2>
    </div>
    <div class="header-right level-header-actions">
      <button class="btn-outline btn-sm" onclick="recalculateOperatorLevelsUi()">Пересчитать</button>
      <button class="btn-primary btn-sm" onclick="showCreateOperatorLevelPrompt()">Добавить уровень</button>
    </div>
  </div>
  <div class="panel level-settings-shell">
    <div class="level-settings-head">
      <div>
        <h3>Правила уровней</h3>
        <p>Уровень считается отдельно от роли доступа. Чем выше порядок, тем выше игровой статус оператора.</p>
      </div>
      <span class="panel-badge">${levels.filter(l => l.is_active).length} активных</span>
    </div>
    <div class="level-settings-list">
      ${levels.map(level => `<article class="level-settings-row ${level.is_active ? '' : 'is-disabled'}">
        <div class="level-main-cell">
          <div class="level-title-line">
            <span class="level-color-dot" style="background:${esc(level.color || '#64748B')}"></span>
            <strong>${esc(level.name)}</strong>
            ${levelBadgeHtml(level)}
            <span class="level-order">#${level.sort_order ?? 0}</span>
            ${level.reward_coins ? `<span class="level-order">+${level.reward_coins} ₡</span>` : ''}
          </div>
          <div class="level-desc">${esc(level.description || 'Описание не задано')}${level.min_total_xp ? ` · XP от ${level.min_total_xp}` : ''}</div>
        </div>
        <div class="level-rules-cell">
          ${(level.rules || []).length ? (level.rules || []).map(rule => `
            <span class="level-rule-chip" title="${esc(ruleText(rule))}">
              ${esc(ruleText(rule))}
              <button type="button" onclick="deleteOperatorLevelRuleUi(${rule.id})" aria-label="Удалить показатель">×</button>
            </span>`).join('') : '<span class="cell-muted">Показатели не настроены</span>'}
        </div>
        <div class="level-status-cell">
          <span class="status-pill ${level.is_active ? 'ok' : 'muted'}">${level.is_active ? 'Активен' : 'Отключён'}</span>
        </div>
        <div class="level-actions-cell">
          <button class="btn-outline btn-sm" onclick="editOperatorLevelUi(${level.id})">Изменить</button>
          <button class="btn-outline btn-sm" onclick="addOperatorLevelRuleUi(${level.id})">Показатель</button>
          <button class="btn-outline btn-sm danger" onclick="disableOperatorLevelUi(${level.id})">Отключить</button>
        </div>
      </article>`).join('')}
    </div>
  </div>
  <div class="panel level-settings-shell" style="margin-top:18px">
    <div class="level-settings-head">
      <div>
        <h3>Операторы и награды</h3>
        <p>Контроль текущих уровней, разовых бонусов и связанных coin transactions. XP пока зарезервирован и равен 0.</p>
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
            <th class="num">XP</th>
            <th class="num">Бонус</th>
            <th>Статус</th>
            <th class="num">Tx ID</th>
          </tr>
        </thead>
        <tbody>
          ${rewardRows.length ? rewardRows.map(row => `<tr>
            <td class="name-cell">${esc(row.operator_name)}</td>
            <td>${esc(row.group_name || '—')}</td>
            <td>${levelBadgeHtml(row.level)}</td>
            <td class="num">${levelNum(row.tenure_days, 0)} дн.</td>
            <td class="num">${levelNum(row.total_xp || 0, 0)}</td>
            <td class="num">${row.reward_coins ? `+${row.reward_coins} ₡` : '—'}</td>
            <td>${rewardStatus(row)}</td>
            <td class="num">${row.coin_transaction_id || '—'}</td>
          </tr>`).join('') : '<tr><td colspan="8" class="empty-line">Нет данных</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}

async function recalculateOperatorLevelsUi() {
  try {
    const res = await api.recalculateOperatorLevels({ mode: 'all' });
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
        <label class="form-label">Порядок</label>
        <input id="lvl-order" class="form-input" type="number" value="${esc(level?.sort_order ?? ((STATE.operatorLevels.length + 1) * 10))}">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Минимальный XP</label>
        <input id="lvl-min-xp" class="form-input" type="number" min="0" value="${esc(level?.min_total_xp ?? 0)}">
      </div>
      <div class="form-group">
        <label class="form-label">Бонус коинов</label>
        <input id="lvl-reward-coins" class="form-input" type="number" min="0" value="${esc(level?.reward_coins ?? 0)}">
      </div>
    </div>
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
    closeModal();
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteOperatorLevelRuleUi(ruleId) {
  if (!confirm('Удалить показатель уровня?')) return;
  try {
    await api.deleteOperatorLevelRule(ruleId);
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function disableOperatorLevelUi(levelId) {
  if (!confirm('Отключить уровень?')) return;
  try {
    await api.deleteOperatorLevel(levelId);
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
    api.myWallet().then(data => {
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

    <div id="cabinet-wheel-card"></div>

    <div id="cabinet-wheel-winners"></div>

    <div class="two-col-grid">
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
  STATE.wallet = await api.myWallet().catch(() => STATE.wallet);
  STATE.myLevel = await api.myLevel().catch(() => STATE.myLevel);
  STATE.myOperator = await api.myOperator().catch(() => STATE.myOperator);
  setText('side-level', STATE.myLevel?.level?.name || '—');
  const ratingResp = await api.getRating().catch(() => ({ items: STATE.rating }));
  STATE.rating = Array.isArray(ratingResp) ? ratingResp : (ratingResp.items || []);
  renderCabinet();
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
function renderShop() {
  const el = document.getElementById('view-shop');
  if (!el) return;
  const items = STATE.shopItems;
  const balance = STATE.wallet?.current_balance ?? 0;
  const role = STATE.user?.role;

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

  el.querySelectorAll('.buy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = items.find(i => i.id === +btn.dataset.id);
      if (!item || !confirm(`Купить «${item.title}» за ${item.price} ₡?`)) return;
      btn.disabled = true; btn.textContent = 'Оформляем…';
      try {
        await api.buyItem(item.id);
        STATE.wallet = await api.myWallet();
        STATE.purchases = await api.listPurchases();
        showToast('Заявка отправлена на рассмотрение', 'ok');
        renderShop();
      } catch(err) { showToast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Купить'; }
    });
  });
  el.querySelectorAll('.edit-item-btn').forEach(btn => {
    const item = items.find(i => i.id === +btn.dataset.id);
    if (item) btn.addEventListener('click', () => showEditItemModal(item));
  });
}

function shopCard(item, balance, role) {
  const levels = STATE.operatorLevels || [];
  const requiredLevel = item.min_level_id ? levels.find(l => l.id === item.min_level_id) : null;
  const currentLevel = STATE.myLevel?.level || null;
  const levelLocked = role === 'operator' && requiredLevel && (!currentLevel || (currentLevel.sort_order || 0) < (requiredLevel.sort_order || 0));
  const canBuy = role === 'operator' && balance >= item.price && !levelLocked;
  const needMore = role === 'operator' && balance < item.price ? item.price - balance : 0;
  return `<div class="shop-card ${canBuy?'shop-card-available':''}">
    <div class="shop-card-title">${esc(item.title)}</div>
    <div class="shop-card-desc">${esc(item.description)}</div>
    <div class="shop-card-price">${item.price} <span class="price-unit">коинов</span></div>
    ${requiredLevel ? `<div class="shop-card-desc">Доступно с уровня «${esc(requiredLevel.name)}»</div>` : ''}
    <div class="shop-card-footer">
      ${role==='operator' ? `<button class="buy-btn ${canBuy?'btn-primary':'btn-disabled'}" data-id="${item.id}" ${canBuy?'':'disabled'}>
        ${canBuy ? 'Купить' : (levelLocked ? `Доступно с уровня «${esc(requiredLevel.name)}»` : `Нужно ещё ${needMore} ₡`)}</button>` : ''}
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
    el.innerHTML = `<div class="view-header"><div><div class="section-kicker">Сводка</div><h2 class="section-title">Панель управления</h2></div></div>
      <div class="empty-state"><p>Загрузка данных…</p></div>`;
    const _summaryGen = STATE.navGen;
    api.getDashboard().then(data => {
      STATE.dashboard = data;
      if (!isNavStale(_summaryGen)) renderSummary();
    }).catch(() => {});
    return;
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Сводка</div><h2 class="section-title">Панель управления</h2></div>
      <div class="header-right">
        <span class="tx-date">Обновлено: ${fmtDateTime(d.last_updated)}</span>
        <button class="btn-outline btn-sm" onclick="reloadData()">Обновить</button>
      </div>
    </div>

    <!-- KPI карточки -->
    <div class="kpi-grid" style="grid-template-columns:repeat(5,minmax(0,1fr))">
      <div class="kpi-card kpi-accent">
        <div class="kpi-label">Операторов</div>
        <div class="kpi-value">${d.active_operators}<span class="kpi-unit"> / ${d.total_operators}</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Коинов за неделю</div>
        <div class="kpi-value">${d.coins_earned_this_week} <span class="kpi-unit">₡</span></div>
      </div>
      <div class="kpi-card ${d.pending_purchases_count > 0 ? 'kpi-warn' : ''}">
        <div class="kpi-label">Новых заявок</div>
        <div class="kpi-value">${d.pending_purchases_count}</div>
        ${d.pending_purchases_count > 0 ? `<div class="kpi-action"><button class="btn-link" onclick="navigateTo('coins',{tab:'requests'})">Рассмотреть →</button></div>` : ''}
      </div>
      <div class="kpi-card ${d.total_lateness_week > 0 ? 'kpi-warn' : ''}">
        <div class="kpi-label">Опозданий за неделю</div>
        <div class="kpi-value">${d.total_lateness_week}</div>
      </div>
      <div class="kpi-card ${d.total_violations_week > 0 ? 'kpi-warn' : ''}">
        <div class="kpi-label">Нарушений за неделю</div>
        <div class="kpi-value">${d.total_violations_week}</div>
      </div>
    </div>

    <!-- Заявки статусы -->
    <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:20px">
      <div class="kpi-card">
        <div class="kpi-label">Одобрено заявок</div>
        <div class="kpi-value" style="color:var(--ok)">${d.approved_purchases_count}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Отклонено заявок</div>
        <div class="kpi-value" style="color:var(--danger)">${d.rejected_purchases_count}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Групп</div>
        <div class="kpi-value">${d.group_summary?.length || 0}</div>
      </div>
    </div>

    <!-- Топ-5 + последние транзакции -->
    <div class="two-col-grid">
      <div class="panel">
        <div class="panel-head"><h3>Топ-5 недели</h3></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>#</th><th>Оператор</th><th>Группа</th><th>Коины</th><th>Балл</th></tr></thead>
            <tbody>
              ${d.top_5_operators?.length ? d.top_5_operators.map(op => `
                <tr>
                  <td class="rank-cell"><span class="rank-badge ${op.rank_position<=3?'rank-top':''}">${op.rank_position||'—'}</span></td>
                  <td class="name-cell">${esc(op.full_name)}</td>
                  <td>${esc(op.group_name)}</td>
                  <td><b class="accent-text">${op.coins_earned} ₡</b></td>
                  <td>${op.final_score?.toFixed(1)||0}</td>
                </tr>`).join('') : '<tr><td colspan="5" class="empty-line">Нет данных</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Последние действия</h3><button class="btn-link" onclick="navigateTo('coins',{tab:'history'})">Все →</button></div>
        <div class="tx-list">
          ${d.latest_coin_transactions?.length ? d.latest_coin_transactions.slice(0,10).map(t => `
            <div class="tx-row ${t.amount>=0?'tx-plus':'tx-minus'}">
              <div class="tx-info">
                <span class="tx-comment"><b>${esc(t.operator_name)}</b> — ${esc(t.comment)}</span>
                <span class="tx-date">${esc(t.group_name)} · ${fmtDate(t.created_at)}</span>
              </div>
              <div class="tx-amount">${t.amount>=0?'+':''}${t.amount} ₡</div>
            </div>`).join('') : '<div class="empty-line">Нет данных</div>'}
        </div>
      </div>
    </div>

    <!-- Группы -->
    <div class="panel">
      <div class="panel-head"><h3>Сводка по группам</h3></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Группа</th><th>Операторов</th><th>Средний балл</th><th>Суммарный баланс</th></tr></thead>
          <tbody>
            ${d.group_summary?.map(g => `
              <tr>
                <td class="name-cell">${esc(g.group_name)}</td>
                <td>${g.operators_count}</td>
                <td>${(g.average_score||0).toFixed(1)}</td>
                <td><b>${g.total_balance} ₡</b></td>
              </tr>`).join('') || '<tr><td colspan="4" class="empty-line">Нет данных</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ══════════════════════════════════════
   VIEW: ОПЕРАТОРЫ (ADMIN)
══════════════════════════════════════ */

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
  let searchVal = '';
  let filterGroup = '';
  let filterRole = '';
  let filterStatus = '';
  let filterLevel = '';
  let activeTab = 'all';

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
    const isAdmin = STATE.user?.role === 'admin';
    return `
      <div class="row-actions">
        <button class="btn-icon btn-ghost" onclick="showUserResetPasswordModal(${o.id})" title="Сбросить пароль" aria-label="Сбросить пароль">↻</button>
        ${o.status === 'active' ? `<button class="btn-icon btn-ghost danger" onclick="deactivateUserUi(${o.id})" title="Деактивировать" aria-label="Деактивировать">!</button>` : ''}
        ${o.role === 'operator' && o.operator_id ? `<button class="btn-icon btn-ghost" onclick="manualOperatorLevelUi(${o.operator_id})" title="Сменить уровень" aria-label="Сменить уровень">★</button>` : ''}
        ${isAdmin && o.role === 'operator' && o.operator_id ? `<button class="btn-icon btn-ghost danger" onclick="confirmDeleteOperator(${o.operator_id})" title="Удалить оператора" aria-label="Удалить оператора" style="color:var(--danger)">🗑</button>` : ''}
      </div>`;
  }

  function renderTable() {
    const list = filteredOps();
    return `
      <div class="table-wrap">
        <table class="data-table users-table-compact">
          <thead><tr>
            <th>Сотрудник</th>
            <th>Роль / Группа</th>
            <th class="tc">Ставка</th>
            <th>Уровень</th>
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
                  <div>${roleBadge(o.role)}</div>
                  ${o.group_name ? `<div class="user-cell-sub" style="margin-top:4px">${esc(o.group_name)}</div>` : ''}
                </td>
                <td class="tc">
                  ${isOp ? rateBadgeHtml(o.rate, o.operator_id) : '<span class="cell-muted">—</span>'}
                </td>
                <td>
                  ${isOp ? levelBadgeHtml(o.level) : '<span class="cell-muted">—</span>'}
                </td>
                <td class="tc">
                  ${isOp && o.tenure_days != null ? tenureBadgeHtml(o.tenure_days) : '<span class="cell-muted">—</span>'}
                </td>
                <td class="tc">${userStatusBadge(o.status)}</td>
                <td class="tc">${operatorActions(o)}</td>
              </tr>`;
            }).join('') : '<tr><td colspan="7" class="empty-line">Нет пользователей</td></tr>'}
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
        <button class="btn-outline btn-sm" onclick="exportCSV()">Экспорт CSV</button>
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
        el.querySelector('#ops-tab-bar').innerHTML = renderTabsAndFilters();
        el.querySelector('#ops-table-wrap').innerHTML = renderTable();
        el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
        rebindOps();
      });
    });
    el.querySelector('#ops-search')?.addEventListener('input', e => {
      searchVal = e.target.value;
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    el.querySelector('#ops-group')?.addEventListener('change', e => {
      filterGroup = e.target.value;
      el.querySelector('#ops-tab-bar').innerHTML = renderTabsAndFilters();
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      rebindOps();
    });
    el.querySelector('#ops-role')?.addEventListener('change', e => {
      filterRole = e.target.value;
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    el.querySelector('#ops-status')?.addEventListener('change', e => {
      filterStatus = e.target.value;
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    el.querySelector('#ops-level')?.addEventListener('change', e => {
      filterLevel = e.target.value;
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
    ['rules', 'Правила'],
  ];

  el.innerHTML = `
    <div class="view-header coins-header">
      <div>
        <div class="section-kicker">Коины</div>
        <h2 class="section-title">Операции с коинами</h2>
        <p class="section-subtitle">Управление начислениями, заявками и историей операций</p>
      </div>
      <div class="header-right">
        ${tab === 'history' ? '<button class="btn-outline btn-sm" onclick="exportHistoryCSV()">Экспорт CSV</button>' : ''}
        <button class="btn-outline btn-sm" onclick="refreshCoinsModule()">Обновить</button>
      </div>
    </div>
    <div class="filter-tabs coins-tabs">
      ${tabs.map(([id, label]) => `<button class="filter-tab ${tab === id ? 'active' : ''}" data-coins-tab="${id}">${label}</button>`).join('')}
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
}

async function refreshCoinsModule() {
  STATE.coinsOverview = null;
  await reloadData();
  if (STATE.currentView === 'coins') renderCoins();
}

function renderCoinsOverview(body) {
  const overview = STATE.coinsOverview;
  if (!overview) {
    body.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка данных…</p></div>';
    const myNavGen = STATE.navGen;
    api.getCoinsOverview().then(data => {
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
    <div class="kpi-grid coins-kpi-grid">
      <div class="kpi-card kpi-accent"><div class="kpi-label">Операций сегодня</div><div class="kpi-value">${overview.today_operations || 0}</div></div>
      <div class="kpi-card kpi-ok"><div class="kpi-label">Начислено сегодня</div><div class="kpi-value">+${overview.today_credited || 0}<span class="kpi-unit"> ₡</span></div></div>
      <div class="kpi-card"><div class="kpi-label">Списано сегодня</div><div class="kpi-value">-${overview.today_debited || 0}<span class="kpi-unit"> ₡</span></div></div>
      <div class="kpi-card ${overview.new_requests ? 'kpi-warn' : ''}"><div class="kpi-label">Новых заявок</div><div class="kpi-value">${overview.new_requests || 0}</div></div>
      <div class="kpi-card"><div class="kpi-label">Зарезервировано</div><div class="kpi-value">${overview.reserved_coins || 0}<span class="kpi-unit"> ₡</span></div></div>
      <div class="kpi-card"><div class="kpi-label">Всего операций</div><div class="kpi-value">${overview.total_operations || 0}</div></div>
    </div>
    <div class="coins-overview-grid">
      <div class="panel">
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
      </div>
      <div class="panel">
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
      </div>
    </div>
    <div class="panel coins-actions">
      <div class="panel-head"><h3>Быстрые действия</h3></div>
      <div class="coins-action-row">
        <button class="btn-primary" onclick="navigateTo('coins',{tab:'accrual'})">Начислить коины</button>
        <button class="btn-outline" onclick="navigateTo('coins',{tab:'requests'})">Открыть заявки</button>
        <button class="btn-outline" onclick="navigateTo('coins',{tab:'history'})">Открыть историю</button>
      </div>
    </div>`;
}

function renderCoinRules(body) {
  body.innerHTML = `
    <div class="panel">
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
  }[type] || type;
}

function renderManual() {
  const el = document.getElementById('view-manual');
  if (!el) return;

  // Load operators if empty
  if (!STATE.adminOperators.length) {
    el.innerHTML = `<div class="view-header"><div><div class="section-kicker">Начисление</div><h2 class="section-title">Ручное начисление коинов</h2></div></div><div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>`;
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
    <div class="view-header">
      <div><div class="section-kicker">Начисление</div><h2 class="section-title">Ручное начисление коинов</h2></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="reloadData().then(()=>renderManual())">Обновить</button>
      </div>
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
   VIEW: ЗАЯВКИ
══════════════════════════════════════ */
function renderRequests() {
  const el = document.getElementById('view-requests');
  if (!el) return;
  const all = STATE.purchases;
  let activeFilter = 'new';

  function filtered() {
    if (activeFilter === 'all') return all;
    if (activeFilter === 'new') return all.filter(p => p.status === 'new' || p.status === 'pending');
    return all.filter(p => p.status === activeFilter);
  }

  function renderList() {
    const list = filtered();
    if (!list.length) return '<div class="empty-state">Заявок нет</div>';
    return list.map(p => {
      const op = STATE.adminOperators.find(o => o.id === p.operator_id);
      const item = STATE.shopItems.find(i => i.id === p.shop_item_id);
      return `
        <div class="request-card status-${p.status}">
          <div class="request-info">
            <div class="request-title">${esc(item?.title || `Бонус #${p.shop_item_id}`)}</div>
            <div class="request-meta">
              <span><b>${esc(op?.full_name || `Оператор #${p.operator_id}`)}</b></span>
              <span>·</span><span>${esc(op?.group_name || '—')}</span>
              <span>·</span><span class="accent-text">${p.price} ₡</span>
              <span>·</span><span>${fmtDate(p.created_at)}</span>
            </div>
            ${p.reject_reason ? `<div class="request-reason">Причина отказа: ${esc(p.reject_reason)}</div>` : ''}
          </div>
          <div class="request-status">
            <span class="status-badge status-${p.status}">${statusLabel(p.status)}</span>
          </div>
          ${(p.status === 'pending' || p.status === 'new') ? `
            <div class="request-actions">
              <button class="btn-ok approve-btn" data-id="${p.id}">✓ Одобрить</button>
              <button class="btn-danger reject-btn" data-id="${p.id}">✗ Отклонить</button>
            </div>` : ''}
          ${p.status === 'approved' ? `
            <div class="request-actions">
              <button class="btn-ghost complete-btn" data-id="${p.id}">Отметить выполненной</button>
            </div>` : ''}
        </div>`;
    }).join('');
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Заявки</div><h2 class="section-title">Заявки из магазина</h2></div>
      <button class="btn-outline btn-sm" onclick="reloadData()">Обновить</button>
    </div>
    <div class="filter-tabs" id="req-tabs">
      ${[
        ['new',  `Новые <span class="badge">${all.filter(p=>p.status==='new'||p.status==='pending').length}</span>`],
        ['approved', 'Одобрены'],
        ['rejected', 'Отклонены'],
        ['all',      `Все <span class="badge">${all.length}</span>`],
      ].map(([f, label]) => `<button class="filter-tab ${activeFilter===f?'active':''}" data-filter="${f}">${label}</button>`).join('')}
    </div>
    <div id="requests-list">${renderList()}</div>`;

  el.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeFilter = tab.dataset.filter;
      el.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      el.querySelector('#requests-list').innerHTML = renderList();
      bindRequestActions();
    });
  });

  function bindRequestActions() {
    el.querySelectorAll('.approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await api.approvePurchase(+btn.dataset.id);
          showToast('Заявка одобрена', 'ok');
          STATE.purchases = await api.listPurchases();
          STATE.dashboard = await api.getDashboard().catch(() => STATE.dashboard);
          el.querySelector('#requests-list').innerHTML = renderList();
          bindRequestActions();
        } catch(err) { showToast(err.message, 'error'); btn.disabled = false; }
      });
    });
    el.querySelectorAll('.reject-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reason = prompt('Причина отказа (обязательно):');
        if (!reason?.trim()) return;
        btn.disabled = true;
        try {
          await api.rejectPurchase(+btn.dataset.id, reason.trim());
          showToast('Заявка отклонена', 'ok');
          STATE.purchases = await api.listPurchases();
          STATE.dashboard = await api.getDashboard().catch(() => STATE.dashboard);
          el.querySelector('#requests-list').innerHTML = renderList();
          bindRequestActions();
        } catch(err) { showToast(err.message, 'error'); btn.disabled = false; }
      });
    });
    el.querySelectorAll('.complete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        // Используем approve с пометкой completed
        try {
          await api.completePurchase(btn.dataset.id);
          STATE.purchases = await api.listPurchases();
          el.querySelector('#requests-list').innerHTML = renderList();
          bindRequestActions();
        } catch { btn.disabled = false; }
      });
    });
  }
  bindRequestActions();
}

/* ══════════════════════════════════════
   VIEW: ИСТОРИЯ ОПЕРАЦИЙ
══════════════════════════════════════ */
function renderHistory() {
  const el = document.getElementById('view-history');
  if (!el) return;
  const history = STATE.history;

  const typeLabels = {
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
  };

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">История</div><h2 class="section-title">История операций</h2></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="exportHistoryCSV()">Экспорт CSV</button>
        <button class="btn-outline btn-sm" onclick="reloadData()">Обновить</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Все транзакции</h3>
        <span class="panel-badge">${history.length} записей</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Дата</th><th>Оператор</th><th>Группа</th>
            <th>Тип</th><th>Коины</th><th>Причина</th><th>Автор</th>
          </tr></thead>
          <tbody>
            ${history.length ? history.map(t => `
              <tr>
                <td style="white-space:nowrap">${fmtDate(t.created_at)}</td>
                <td class="name-cell">${esc(t.operator_name)}</td>
                <td>${esc(t.group_name)}</td>
                <td><span style="font-size:11px;color:var(--tx3)">${typeLabels[t.type]||t.type}</span></td>
                <td><b style="color:${t.amount>=0?'var(--ok)':'var(--danger)'}">${t.amount>=0?'+':''}${t.amount} ₡</b></td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.comment)}">${esc(t.comment)}</td>
                <td style="font-size:12px;color:var(--tx3)">${esc(t.created_by_name||'Система')}</td>
              </tr>`).join('') : '<tr><td colspan="7" class="empty-line">История пуста</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
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
    STATE.groups = await api.listGroups(false);
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
    closeModal();
    showToast('Группа удалена', 'ok');
    await renderGroups();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function ensureGroupsLoaded() {
  if (!STATE.groups.length) {
    STATE.groups = await api.listGroups(false);
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
  overlay.innerHTML = `<div class="modal ${forced ? 'modal-forced' : ''}">${html}${forced ? '' : '<button class="modal-close" onclick="closeModal()">✕</button>'}</div>`;
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
    groups = await api.listGroups(true);
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
    <div id="new-op-err" class="status-line" style="margin-top:8px"></div>
    <button id="create-operator-btn" class="btn-primary" style="width:100%;height:44px;margin-top:4px" onclick="submitAddOperator()" disabled>Создать пользователя</button>
    <div style="font-size:11px;color:var(--tx3);margin-top:6px">Пароль сохранится только в виде hash, при первом входе пользователь сменит его.</div>
  `);

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
    <div class="form-group"><label class="form-label">Цена (коины)</label>
      <input id="ni-price" class="form-input" type="number" min="1" placeholder="120"></div>
    <div class="form-group"><label class="form-label">Минимальный уровень</label>
      <select id="ni-min-level" class="form-select">
        <option value="">Без ограничения</option>
        ${levelOptions}
      </select></div>
    <div id="ni-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitAddItem()">Добавить</button>`);
}
async function submitAddItem() {
  const title = document.getElementById('ni-title')?.value?.trim();
  const desc  = document.getElementById('ni-desc')?.value?.trim() || '';
  const price = +document.getElementById('ni-price')?.value;
  const minLevelRaw = document.getElementById('ni-min-level')?.value || '';
  const min_level_id = minLevelRaw ? Number(minLevelRaw) : null;
  const err   = document.getElementById('ni-err');
  if (!title || !price) { err.textContent = 'Заполните название и цену'; return; }
  try {
    await api.createShopItem({ title, description: desc, price, min_level_id });
    closeModal(); showToast('Бонус добавлен', 'ok');
    STATE.shopItems = await api.listShopItems(); renderShop();
  } catch(e) { err.textContent = e.message; }
}

function showEditItemModal(item) {
  const levelOptions = (STATE.operatorLevels || [])
    .filter(l => l.is_active)
    .map(l => `<option value="${l.id}" ${item.min_level_id === l.id ? 'selected' : ''}>${esc(l.name)}</option>`)
    .join('');
  showModal(`
    <h3 class="modal-title">Редактировать бонус</h3>
    <div class="form-group"><label class="form-label">Название</label>
      <input id="ei-title" class="form-input" value="${esc(item.title)}"></div>
    <div class="form-group"><label class="form-label">Описание</label>
      <input id="ei-desc" class="form-input" value="${esc(item.description)}"></div>
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
    <div id="ei-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitEditItem(${item.id})">Сохранить</button>`);
}
async function submitEditItem(id) {
  const title     = document.getElementById('ei-title')?.value?.trim();
  const description = document.getElementById('ei-desc')?.value?.trim() || '';
  const price     = +document.getElementById('ei-price')?.value;
  const minLevelRaw = document.getElementById('ei-min-level')?.value || '';
  const min_level_id = minLevelRaw ? Number(minLevelRaw) : null;
  const is_active = document.getElementById('ei-active')?.value === 'true';
  const err       = document.getElementById('ei-err');
  if (!title || !price) { err.textContent = 'Заполните поля'; return; }
  try {
    await api.updateShopItem(id, { title, description, price, min_level_id, is_active });
    closeModal(); showToast('Бонус обновлён', 'ok');
    STATE.shopItems = await api.listShopItems(); renderShop();
  } catch(e) { err.textContent = e.message; }
}

/* ══════════════════════════════════════
   EXPORT
══════════════════════════════════════ */
function exportCSV() {
  const ops = STATE.adminOperators;
  const header = ['ФИО','Группа','Должность','Статус участия','Статус работы','Email','Логин','Баланс','Коины нед.'];
  const rows = ops.map(o => [
    o.full_name,
    o.group_name,
    positionLabel(o.position || 'operator'),
    participationStatusLabel(o.participation_status || 'participating'),
    isOperatorDismissed(o) ? 'Уволен' : 'Активен',
    o.email || '',
    o.username || '',
    o.current_balance,
    o.coins_earned_week,
  ]);
  downloadCSV([header, ...rows], 'pulse_operators');
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
      const status = await api.getPeriodReportStatus();
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
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
  }, onUpdate, ANALYTICS_SWR_TTL_MS);
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
    const today = new Date();
    const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 6);
    _analyticsState.startDate = urlParams.start || weekAgo.toISOString().slice(0, 10);
    _analyticsState.endDate = urlParams.end || today.toISOString().slice(0, 10);
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
        case 'overview':   analyticsFetch('overview', full); break;
        case 'operators':  analyticsFetch('operators-combined', full); break;
        case 'groups':     analyticsFetch('groups-comparison', base); break;
        case 'matrix':     analyticsFetch('matrix-combined', base); break;
        case 'quality':    analyticsFetch('quality-combined', base); break;
        case 'penalties':  analyticsFetch('penalties', base); break;
        case 'risks':      analyticsFetch('risk-pyramid', base); break;
        case 'points':     analyticsFetch('points', full); break;
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

async function renderRating() {
  const el = document.getElementById('view-rating');
  if (!el) return;
  const myNavGen = STATE.navGen; // раздел "Рейтинг" уже активен — фиксируем текущее поколение

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Рейтинг</div><h2 class="section-title">Турнирная таблица</h2></div>
      <div class="header-right"><button class="btn-outline btn-sm" onclick="renderRating()">Обновить</button></div>
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
    const groups = await api.listGroups(true);
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

  const ticketCard = tickets > 0
    ? `<div class="wheel-ticket-badge wheel-ticket-have">
         <span class="wheel-ticket-count">${tickets}</span>
         <span>${tickets === 1 ? 'доступная прокрутка' : 'доступных прокруток'}</span>
         ${status.next_ticket_reason ? `<div class="wheel-ticket-reason">Причина: ${esc(status.next_ticket_reason)}</div>` : ''}
       </div>`
    : `<div class="wheel-ticket-badge wheel-ticket-none">
         <strong>У вас пока нет доступных прокруток.</strong>
         <div class="wheel-hint">Как получить билет:<br>• выполнить дневную цель (эффективность, норма часов, без опозданий);<br>• попасть в топ-3 рейтинга;<br>• получить билет от супервайзера.</div>
       </div>`;

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Геймификация</div>
        <h2 class="section-title">Wheel of WOW</h2>
      </div>
      <div class="wheel-limits">
        <span title="Прокруток сегодня">Сегодня: ${status.spins_used_today}/${status.max_spins_per_day || '∞'}</span>
        <span title="Прокруток за неделю">Неделя: ${status.spins_used_this_week}/${status.max_spins_per_week || '∞'}</span>
      </div>
    </div>

    <div class="wheel-layout">
      <div class="panel wheel-stage-panel">
        <div class="wheel-stage">
          <div class="wheel-pointer" aria-hidden="true">
            <svg viewBox="0 0 40 52" width="38" height="49" xmlns="http://www.w3.org/2000/svg">
              <defs><linearGradient id="wheelPinG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#FDE68A"/><stop offset="1" stop-color="#F59E0B"/>
              </linearGradient></defs>
              <path d="M20 50 L5 21 A15 15 0 1 1 35 21 Z" fill="url(#wheelPinG)" stroke="#B45309" stroke-width="2"/>
              <circle cx="20" cy="18" r="5.5" fill="#fff" opacity=".92"/>
            </svg>
          </div>
          <div class="wheel-rotor" id="wheel-rotor">${buildWheelSvg(items)}</div>
          <div class="wheel-hub">WOW</div>
        </div>
        <div class="wheel-controls">
          ${ticketCard}
          <button class="btn-primary wheel-spin-btn" id="wheel-spin-btn" ${canSpin ? '' : 'disabled'}>
            ${canSpin ? 'Крутить колесо' : esc(cannotReason)}
          </button>
        </div>
      </div>

      <div class="panel wheel-history-panel">
        <h3 class="panel-title">🏆 Мои выигрыши</h3>
        <div id="wheel-history-body">${buildWheelHistory(history.items || [])}</div>
      </div>
    </div>`;

  // Раскладываем сектора по кругу для дальнейшего расчёта угла остановки
  STATE.wheel = { items, rotation: 0, spinning: false };

  const btn = document.getElementById('wheel-spin-btn');
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

// Строит SVG-колесо: N равных секторов с объёмом, золотым ободом и читаемыми подписями
function buildWheelSvg(items) {
  const n = items.length;
  const cx = 160, cy = 160;
  const rOuter = 158; // внешний золотой обод
  const rSeg = 148;   // радиус секторов
  const seg = 360 / n;
  let defs = '';
  let paths = '';
  let labels = '';
  let lights = '';

  for (let i = 0; i < n; i++) {
    const base = items[i].color || WHEEL_FALLBACK_COLORS[i % WHEEL_FALLBACK_COLORS.length];
    const a0 = i * seg, a1 = (i + 1) * seg;
    const p0 = wheelPoint(cx, cy, rSeg, a0);
    const p1 = wheelPoint(cx, cy, rSeg, a1);
    const large = seg > 180 ? 1 : 0;
    defs += `<radialGradient id="wheelSeg${i}" cx="50%" cy="50%" r="72%">`
      + `<stop offset="0%" stop-color="${wheelShade(base, 0.30)}"/>`
      + `<stop offset="62%" stop-color="${base}"/>`
      + `<stop offset="100%" stop-color="${wheelShade(base, -0.16)}"/>`
      + `</radialGradient>`;
    paths += `<path d="M${cx},${cy} L${p0.x.toFixed(2)},${p0.y.toFixed(2)} A${rSeg},${rSeg} 0 ${large} 1 ${p1.x.toFixed(2)},${p1.y.toFixed(2)} Z" fill="url(#wheelSeg${i})" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>`;
    // Подпись всегда вертикально (не вверх ногами), крупно и читаемо
    const mid = a0 + seg / 2;
    const lp = wheelPoint(cx, cy, rSeg * 0.64, mid);
    const icon = WHEEL_PRIZE_ICON[items[i].type] || '★';
    const short = items[i].type === 'coins' ? `+${items[i].amount}` : icon;
    labels += `<text x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="20" font-weight="800" fill="${wheelTextColor(base)}" style="paint-order:stroke;stroke:rgba(15,23,42,.16);stroke-width:.6px;">${esc(short)}</text>`;
  }

  // Лампочки по ободу — «казино»-эффект
  const nLights = n * 2;
  for (let i = 0; i < nLights; i++) {
    const lpt = wheelPoint(cx, cy, rSeg + 5.5, i * 360 / nLights);
    lights += `<circle cx="${lpt.x.toFixed(1)}" cy="${lpt.y.toFixed(1)}" r="2.6" fill="#FFFFFF" opacity=".9"/>`;
  }

  return `<svg viewBox="0 0 320 320" class="wheel-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      ${defs}
      <radialGradient id="wheelRim" cx="50%" cy="35%" r="75%">
        <stop offset="0%" stop-color="#FDE68A"/>
        <stop offset="45%" stop-color="#F59E0B"/>
        <stop offset="100%" stop-color="#B45309"/>
      </radialGradient>
      <radialGradient id="wheelGloss" cx="50%" cy="26%" r="72%">
        <stop offset="0%" stop-color="rgba(255,255,255,.5)"/>
        <stop offset="38%" stop-color="rgba(255,255,255,.08)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="url(#wheelRim)"/>
    <circle cx="${cx}" cy="${cy}" r="${rSeg + 2}" fill="#0f172a" opacity=".08"/>
    ${paths}
    ${lights}
    <circle cx="${cx}" cy="${cy}" r="${rSeg}" fill="url(#wheelGloss)" pointer-events="none"/>
    ${labels}
  </svg>`;
}

// Точка на окружности: угол в градусах, 0° = верх (12 часов), по часовой
function wheelPoint(cx, cy, r, deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildWheelHistory(rows) {
  if (!rows.length) return '<div class="wheel-history-empty"><span class="wheel-history-empty-emoji">🎁</span><p>Пока пусто.<br>Выиграйте первый приз!</p></div>';
  return `<ul class="wheel-history-list">${rows.map(r => `
    <li class="wheel-history-item">
      <span class="wheel-history-icon">${WHEEL_PRIZE_ICON[r.prize_type] || '★'}</span>
      <span class="wheel-history-main">
        <strong>${esc(r.prize)}</strong>
        ${r.reason ? `<span class="wheel-history-reason">${esc(r.reason)}</span>` : ''}
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
    if (btn) { btn.disabled = false; btn.textContent = 'Крутить колесо'; }
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
  const spins = 5; // полных оборотов для эффекта
  const target = spins * 360 - center - jitter;
  const from = w.rotation % 360;
  const total = from + (spins * 360 - center - jitter - (from % 360));
  w.rotation = target;

  rotor.style.transition = 'transform 4.2s cubic-bezier(0.16, 1, 0.3, 1)';
  rotor.style.transform = `rotate(${target}deg)`;

  setTimeout(() => {
    w.spinning = false;
    showWheelResultModal(result);
    // Обновляем статус и историю без полной перерисовки колеса (оно уже стоит на призе)
    refreshWheelSidebar(el);
  }, 4400);
}

function showWheelResultModal(result) {
  const icon = WHEEL_PRIZE_ICON[result.prize.type] || '🎉';
  const html = `
    <div class="modal-overlay wheel-result-overlay" id="wheel-result-modal">
      <div class="modal-card wheel-result-card">
        <div class="wheel-result-icon">${icon}</div>
        <h3>Поздравляем!</h3>
        <p class="wheel-result-prize">${esc(result.prize.title)}</p>
        <p class="wheel-result-msg">${esc(result.message)}</p>
        ${result.reason ? `<p class="wheel-result-reason">Причина допуска: ${esc(result.reason)}</p>` : ''}
        ${result.prize.type === 'coins' ? '<p class="wheel-result-note">Коины уже добавлены на ваш баланс.</p>' : ''}
        <button class="btn-primary" onclick="document.getElementById('wheel-result-modal')?.remove()">Отлично</button>
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
      btn.textContent = canSpin ? 'Крутить колесо' : (tickets > 0 ? 'Лимит на сегодня исчерпан' : 'Нет билетов');
      if (canSpin) btn.onclick = () => doWheelSpin(el);
    }
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
  const totalWeight = rows.filter(r => r.is_active).reduce((s, r) => s + (r.weight || 0), 0);
  const typeOptions = (val) => WHEEL_PRIZE_TYPES.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('');
  const chance = (w) => totalWeight > 0 ? Math.round((w / totalWeight) * 100) : 0;

  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head">
        <h3>Сектора колеса</h3>
        <span class="panel-badge">${rows.length} · сумма весов ${totalWeight}</span>
      </div>
      <div class="wheel-admin-content">
        <div class="table-wrap wheel-prizes-wrap"><table class="data-table wheel-prizes-table">
          <colgroup>
            <col class="wp-col-color"><col class="wp-col-title"><col class="wp-col-type">
            <col class="wp-col-num"><col class="wp-col-num"><col class="wp-col-chance">
            <col class="wp-col-limit"><col class="wp-col-limit"><col class="wp-col-active"><col class="wp-col-action">
          </colgroup>
          <thead><tr><th>Цвет</th><th>Название</th><th>Тип</th><th>Кол-во</th><th>Вес</th><th title="Шанс выпадения">Шанс</th><th>Лимит всего</th><th>Лимит/оператор</th><th>Активен</th><th></th></tr></thead>
          <tbody>
          ${rows.map(r => `<tr data-prize-id="${r.id}">
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
          </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="wheel-newprize">
          <h4 class="panel-subtitle">Добавить сектор</h4>
          <div class="form-grid wheel-newprize-grid">
            <input type="text" id="np-title" class="form-input" placeholder="Название">
            <select id="np-type" class="form-input">${typeOptions('coins')}</select>
            <input type="number" id="np-amount" class="form-input" placeholder="Кол-во" value="1">
            <input type="number" id="np-weight" class="form-input" placeholder="Вес" value="10" min="0">
            <input type="color" id="np-color" value="#38BDF8">
            <button class="btn-primary" id="np-add">Добавить</button>
          </div>
          <div id="np-status" class="status-line" style="margin-top:8px"></div>
        </div>
        <div class="status-line muted" style="margin-top:10px">Сектор «ничего» запрещён (ТЗ п.6.3): минимальный приз — «+1 коин». Чтобы убрать сектор, выключите «Активен».</div>
      </div>
    </div>`;

  body.querySelectorAll('tr[data-prize-id]').forEach(tr => {
    const id = parseInt(tr.dataset.prizeId, 10);
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
        </table></div>` : '<div class="empty-state wheel-empty"><p>Логов пока нет.</p></div>'}
      </div>
    </div>`;
}

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

  body.innerHTML = `
    <div class="panel wheel-issue-panel">
      <div class="panel-head">
        <h3>Ручная выдача билета</h3>
        <span class="panel-badge">Staff</span>
      </div>
      <div class="wheel-admin-content">
      <div class="form-grid wheel-issue-grid">
        <label class="form-group">
          <span class="form-label">Оператор</span>
          <input type="text" id="wheel-op-search" class="form-input" placeholder="Поиск по имени, фамилии, группе…" autocomplete="off">
          <div id="wheel-op-results" class="wheel-op-results" hidden></div>
          <input type="hidden" id="wheel-op-id">
          <div id="wheel-op-chosen" class="wheel-op-chosen" hidden></div>
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
      <div class="wheel-issue-actions">
        <button class="btn-primary" id="wheel-issue-btn" disabled>Выдать билет</button>
      </div>
      <div id="wheel-issue-status" class="status-line" style="margin-top:10px"></div>
      </div>
    </div>`;

  const search = document.getElementById('wheel-op-search');
  const results = document.getElementById('wheel-op-results');
  const hidden = document.getElementById('wheel-op-id');
  const chosen = document.getElementById('wheel-op-chosen');
  const issueBtn = document.getElementById('wheel-issue-btn');

  function matches(o, q) {
    const hay = `${o.full_name || ''} ${o.group_name || o.group || ''}`.toLowerCase();
    return hay.includes(q);
  }
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { results.hidden = true; return; }
    const found = active.filter(o => matches(o, q)).slice(0, 8);
    results.innerHTML = found.length
      ? found.map(o => `<div class="wheel-op-option" data-op-id="${o.id}" data-op-name="${esc(o.full_name)}">
          <strong>${esc(o.full_name)}</strong><span>${esc(o.group_name || o.group || '')}</span></div>`).join('')
      : '<div class="wheel-op-empty">Не найдено</div>';
    results.hidden = false;
    results.querySelectorAll('[data-op-id]').forEach(opt => {
      opt.onclick = () => {
        hidden.value = opt.dataset.opId;
        chosen.textContent = `Выбран: ${opt.dataset.opName}`;
        chosen.hidden = false;
        results.hidden = true;
        search.value = opt.dataset.opName;
        issueBtn.disabled = false;
      };
    });
  };

  issueBtn.onclick = async () => {
    const operatorId = parseInt(hidden.value, 10);
    const reason = document.getElementById('wheel-reason').value.trim();
    const ttl = parseInt(document.getElementById('wheel-ttl').value, 10) || 3;
    const statusEl = document.getElementById('wheel-issue-status');
    if (!operatorId) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Выберите оператора'; return; }
    if (!reason) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Укажите причину'; return; }
    issueBtn.disabled = true;
    try {
      await api.issueWheelTicket({ operator_id: operatorId, reason_text: reason, ttl_days: ttl });
      swrInvalidate('wheel:');
      statusEl.className = 'status-line status-ok';
      statusEl.textContent = 'Билет выдан';
      showToast('Билет выдан', 'ok');
      document.getElementById('wheel-reason').value = '';
      chosen.hidden = true; hidden.value = ''; search.value = '';
    } catch (err) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = err.message || 'Не удалось выдать билет';
    } finally {
      issueBtn.disabled = false;
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

const TESTS_SWR_TTL_MS = 15_000; // короткий TTL — статус теста (открыт/просрочен) должен быстро актуализироваться

async function renderTestsOperatorView(el) {
  const myNavGen = STATE.navGen;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Тесты</div><h2 class="section-title">Мои тесты</h2></div>
      <button class="btn-outline btn-sm" onclick="renderTests()">Обновить</button>
    </div>
    <div id="tests-op-body"><div class="loading-state"><div class="loading-spinner"></div></div></div>`;

  let data;
  try {
    data = await swrFetch('tests:my', () => api.myTests(), null, TESTS_SWR_TTL_MS);
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
  const finished = items.filter(t => ['finished', 'expired'].includes(t.status));
  const upcoming = items.filter(t => t.status === 'upcoming');

  const body = el.querySelector('#tests-op-body');
  if (!items.length) {
    body.innerHTML = `<div class="empty-state"><p>Доступных тестов пока нет.</p></div>`;
    return;
  }

  body.innerHTML = `
    ${upcoming.length ? `<div class="rcard-title" style="margin-top:6px">Скоро откроются</div><div class="test-card-grid">${upcoming.map(testCardHtml).join('')}</div>` : ''}
    <div class="rcard-title" style="margin-top:18px">Доступные</div>
    ${available.length ? `<div class="test-card-grid">${available.map(testCardHtml).join('')}</div>` : `<div class="empty-line">Доступных тестов пока нет.</div>`}
    <div class="rcard-title" style="margin-top:18px">Завершённые / история</div>
    ${finished.length ? `<div class="test-card-grid">${finished.map(testCardHtml).join('')}</div>` : `<div class="empty-line">Вы пока не проходили тесты.</div>`}
  `;

  body.querySelectorAll('[data-test-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const testId = Number(btn.dataset.testId);
      const action = btn.dataset.testAction;
      if (action === 'start' || action === 'continue') openTestRunner(testId);
      if (action === 'result') openTestResultModal(btn.dataset.attemptId);
    });
  });
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
  const rewardLine = t.reward_type === 'none' ? '' :
    `<div class="test-card-row"><span>Награда</span><span>${t.reward_type.includes('coins') ? `до ${t.reward_coins} коинов` : ''}${t.reward_type.includes('points') ? ` ${t.reward_points} баллов` : ''}</span></div>`;

  let actionHtml = '';
  if (t.status === 'available') {
    actionHtml = `<button class="btn-primary btn-sm" data-test-action="start" data-test-id="${t.id}">Начать тест</button>`;
  } else if (t.status === 'in_progress') {
    actionHtml = `<button class="btn-primary btn-sm" data-test-action="continue" data-test-id="${t.id}">Продолжить</button>`;
  } else if (t.status === 'upcoming') {
    actionHtml = `<div class="test-card-disabled-note">Тест откроется ${fmtDateTime(t.opens_at)}</div>`;
  } else if (t.status === 'finished') {
    actionHtml = `<div class="test-card-result"><b>Результат:</b> ${t.correct_count} / ${t.questions_count} · <b>${fmtA(t.score_percent,0)}%</b></div>
      ${t.reward_coins_earned ? `<div class="test-card-result">+${t.reward_coins_earned} коинов</div>` : ''}
      <button class="btn-outline btn-sm" data-test-action="result" data-attempt-id="${t.attempt_id}">Подробнее</button>`;
  } else if (t.status === 'expired') {
    actionHtml = `<div class="test-card-disabled-note">Срок прохождения истёк</div>`;
  } else {
    actionHtml = `<div class="test-card-disabled-note">Недоступен</div>`;
  }

  return `<div class="test-card">
    <div class="test-card-head">
      <div class="test-card-title">${esc(t.title)}</div>
      ${testStatusBadge(t.status)}
    </div>
    ${t.description ? `<div class="test-card-desc">${esc(t.description)}</div>` : ''}
    <div class="test-card-meta">
      ${t.opens_at ? `<div class="test-card-row"><span>Открыт</span><span>${fmtDateTime(t.opens_at)}</span></div>` : ''}
      ${t.closes_at ? `<div class="test-card-row"><span>Закрывается</span><span>${fmtDateTime(t.closes_at)}</span></div>` : ''}
      <div class="test-card-row"><span>Время на прохождение</span><span>${t.time_limit_minutes} мин</span></div>
      <div class="test-card-row"><span>Вопросов</span><span>${t.questions_count}</span></div>
      ${rewardLine}
    </div>
    <div class="test-card-actions">${actionHtml}</div>
  </div>`;
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
      answers: {},
      expiresAt: new Date(data.expires_at).getTime(),
    };
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
        answers: {},
        expiresAt: new Date(data.expires_at).getTime(),
      };
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
  const q = run.questions[run.currentIndex];
  const selected = run.answers[q.id] || [];

  el.innerHTML = `
    <div class="test-runner">
      <div class="test-runner-head">
        <div class="test-runner-title">${esc(run.testTitle)}</div>
        <div class="test-runner-timer" id="test-timer">--:--</div>
      </div>
      <div class="test-runner-progress">
        <div class="test-runner-progress-bar"><div class="test-runner-progress-fill" style="width:${Math.round((run.currentIndex+1)/run.questions.length*100)}%"></div></div>
        <div class="test-runner-progress-label">Вопрос ${run.currentIndex+1} из ${run.questions.length}</div>
      </div>
      <div class="test-runner-question">
        <div class="test-runner-question-text">${esc(q.question_text)}</div>
        <div class="test-runner-answers">
          ${q.answers.map(a => `
            <label class="test-runner-answer-row ${selected.includes(a.id) ? 'selected' : ''}">
              <input type="${q.question_type === 'multiple_choice' ? 'checkbox' : 'radio'}" name="test-answer" value="${a.id}" ${selected.includes(a.id) ? 'checked' : ''}>
              <span>${esc(a.answer_text)}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="test-runner-nav">
        <button class="btn-outline" id="test-nav-back" ${run.currentIndex === 0 ? 'disabled' : ''}>Назад</button>
        <div style="flex:1"></div>
        ${run.currentIndex < run.questions.length - 1
          ? '<button class="btn-primary" id="test-nav-next">Далее</button>'
          : '<button class="btn-primary" id="test-nav-finish">Завершить тест</button>'}
      </div>
    </div>`;

  el.querySelectorAll('input[name="test-answer"]').forEach(input => {
    input.addEventListener('change', () => {
      const answerId = Number(input.value);
      if (q.question_type === 'multiple_choice') {
        const set = new Set(run.answers[q.id] || []);
        if (input.checked) set.add(answerId); else set.delete(answerId);
        run.answers[q.id] = [...set];
      } else {
        run.answers[q.id] = [answerId];
      }
      el.querySelectorAll('.test-runner-answer-row').forEach(row => row.classList.remove('selected'));
      input.closest('.test-runner-answer-row').classList.add('selected');
      api.saveTestAnswer(run.attemptId, q.id, run.answers[q.id]).catch(() => {});
    });
  });

  el.querySelector('#test-nav-back')?.addEventListener('click', () => {
    run.currentIndex = Math.max(0, run.currentIndex - 1);
    renderTestRunnerScreen();
  });
  el.querySelector('#test-nav-next')?.addEventListener('click', () => {
    run.currentIndex = Math.min(run.questions.length - 1, run.currentIndex + 1);
    renderTestRunnerScreen();
  });
  el.querySelector('#test-nav-finish')?.addEventListener('click', () => finishTestRun());

  startTestTimer();
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
    _activeTestRun = null;
    swrInvalidate('tests:my'); // статус теста изменился (finished) — следующий заход в список не должен показать устаревшее "in_progress"
    renderTestResultScreen(result);
  } catch(e) {
    showToast(e.message || 'Не удалось завершить тест', 'error');
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
  return `<div class="test-result-card">
    <div class="test-result-title">${esc(result.test_title)}</div>
    <div class="test-result-grid">
      <div class="test-result-stat"><div class="test-result-stat-label">Правильных ответов</div><div class="test-result-stat-value">${result.correct_count} из ${result.questions_count}</div></div>
      <div class="test-result-stat"><div class="test-result-stat-label">Процент</div><div class="test-result-stat-value">${fmtA(result.score_percent,0)}%</div></div>
      <div class="test-result-stat"><div class="test-result-stat-label">Баллы</div><div class="test-result-stat-value">${fmtA(result.score_points,1)}</div></div>
      <div class="test-result-stat"><div class="test-result-stat-label">Статус</div><div class="test-result-stat-value">${passed === null ? '—' : (passed ? '<span class="badge badge-success">Пройден</span>' : '<span class="badge badge-danger">Не пройден</span>')}</div></div>
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
    <div class="rcard-title" style="margin-top:18px">Разбор ответов</div>
    ${result.questions.map(q => {
      const yourIds = (result.your_answers && result.your_answers[q.id]) || [];
      return `<div class="test-result-question">
        <div class="test-result-question-text">${esc(q.question_text)}</div>
        ${q.answers.map(a => {
          const wasSelected = yourIds.includes(a.id);
          const cls = a.is_correct ? 'correct' : (wasSelected ? 'incorrect' : '');
          return `<div class="test-result-answer-row ${cls}">${wasSelected ? '☑' : '☐'} ${esc(a.answer_text)}</div>`;
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
      <div><div class="section-kicker">Тесты</div><h2 class="section-title">Управление тестами</h2></div>
      <div class="header-right">
        <button class="btn-primary btn-sm" id="tests-new-btn">+ Новый тест</button>
        <button class="btn-outline btn-sm" onclick="renderTests()">Обновить</button>
      </div>
    </div>
    <div id="tests-staff-body"><div class="loading-state"><div class="loading-spinner"></div></div></div>`;

  el.querySelector('#tests-new-btn').addEventListener('click', () => openTestBuilder(null));

  let data;
  try {
    data = await swrFetch('tests:admin-list', () => api.listAdminTests(), null, TESTS_SWR_TTL_MS);
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

  body.innerHTML = `<div class="table-wrap"><table class="data-table">
    <thead><tr>
      <th>Название</th><th>Статус</th><th>Автор</th><th>Открытие</th><th>Закрытие</th>
      <th class="num">Вопросов</th><th class="num">Прошли</th><th class="num">Средний %</th><th>Действия</th>
    </tr></thead>
    <tbody>
      ${items.map(t => `<tr>
        <td class="name-cell">${esc(t.title)}</td>
        <td><span class="badge ${statusBadgeClass[t.status]||'badge-neutral'}">${statusLabel[t.status]||t.status}</span></td>
        <td>${esc(t.created_by_name||'—')}</td>
        <td>${t.opens_at?fmtDateTime(t.opens_at):'—'}</td>
        <td>${t.closes_at?fmtDateTime(t.closes_at):'—'}</td>
        <td class="num">${t.questions_count}</td>
        <td class="num">${t.attempts_finished}</td>
        <td class="num">${t.average_percent!=null?t.average_percent+'%':'—'}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn-outline btn-sm" data-test-edit="${t.id}">Изменить</button>
            <button class="btn-outline btn-sm" data-test-results="${t.id}">Результаты</button>
            ${t.status==='draft'||t.status==='scheduled' ? `<button class="btn-primary btn-sm" data-test-publish="${t.id}">Опубликовать</button>` : ''}
            ${t.status==='open' ? `<button class="btn-outline btn-sm" data-test-close="${t.id}">Закрыть</button>` : ''}
          </div>
        </td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;

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
  let questions = [];
  if (testId) {
    try {
      const list = await api.listAdminTests();
      test = (list.items || []).find(t => t.id === testId);
    } catch(e) { /* fallthrough — test stays null, builder treats as new */ }
  }

  _testBuilderState = {
    testId: testId,
    title: test?.title || '',
    description: '',
    instruction: '',
    time_limit_minutes: test?.time_limit_minutes || 30,
    opens_at: utcISOStringToLocalDateTimeInput(test?.opens_at),
    closes_at: utcISOStringToLocalDateTimeInput(test?.closes_at),
    passing_percent: 70,
    show_result_after_finish: true,
    show_correct_answers: false,
    allow_retake: false,
    max_attempts: 1,
    reward_type: 'none',
    reward_points: 0,
    reward_coins: 0,
    reward_min_percent: 70,
    reward_mode: 'fixed',
    questions: [],
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
    <div class="view-header">
      <div><div class="section-kicker">Тесты</div><h2 class="section-title">${s.testId ? 'Редактирование теста' : 'Новый тест'}</h2></div>
      <button class="btn-outline btn-sm" onclick="renderTests()">К списку</button>
    </div>
    ${isOpen ? '<div class="status-line status-error" style="margin-bottom:14px">Тест уже открыт — можно изменить только дату закрытия и назначение.</div>' : ''}
    <div class="test-builder-card">
      <div class="rcard-title">1. Основная информация</div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Название теста</label><input id="tb-title" class="form-input" value="${esc(s.title)}" ${isOpen?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Время на прохождение (мин)</label><input id="tb-time-limit" type="number" min="1" class="form-input" value="${s.time_limit_minutes}" ${isOpen?'disabled':''}></div>
      </div>
      <div class="form-group"><label class="form-label">Описание</label><textarea id="tb-description" class="form-input" rows="2" ${isOpen?'disabled':''}>${esc(s.description)}</textarea></div>
      <div class="form-group"><label class="form-label">Инструкция для операторов</label><textarea id="tb-instruction" class="form-input" rows="2" ${isOpen?'disabled':''}>${esc(s.instruction)}</textarea></div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Дата и время открытия</label><input id="tb-opens-at" type="datetime-local" class="form-input" value="${s.opens_at}" ${isOpen?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Дата и время закрытия</label><input id="tb-closes-at" type="datetime-local" class="form-input" value="${s.closes_at}"></div>
      </div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Проходной процент</label><input id="tb-passing-percent" type="number" min="0" max="100" class="form-input" value="${s.passing_percent}" ${isOpen?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Максимум попыток</label><input id="tb-max-attempts" type="number" min="1" class="form-input" value="${s.max_attempts}" ${isOpen?'disabled':''}></div>
      </div>
      <label class="an-checkbox-label"><input type="checkbox" id="tb-show-result" ${s.show_result_after_finish?'checked':''} ${isOpen?'disabled':''}> Показывать результат сразу после завершения</label>
      <label class="an-checkbox-label"><input type="checkbox" id="tb-show-correct" ${s.show_correct_answers?'checked':''} ${isOpen?'disabled':''}> Показывать правильные ответы после завершения</label>
      <label class="an-checkbox-label"><input type="checkbox" id="tb-allow-retake" ${s.allow_retake?'checked':''} ${isOpen?'disabled':''}> Разрешить повторное прохождение</label>
    </div>

    <div class="test-builder-card">
      <div class="rcard-title">Награда</div>
      <div class="form-group"><label class="form-label">Тип награды</label>
        <select id="tb-reward-type" class="form-select" ${isOpen?'disabled':''}>
          <option value="none" ${s.reward_type==='none'?'selected':''}>Без награды</option>
          <option value="points" ${s.reward_type==='points'?'selected':''}>Баллы</option>
          <option value="coins" ${s.reward_type==='coins'?'selected':''}>Коины</option>
          <option value="points_and_coins" ${s.reward_type==='points_and_coins'?'selected':''}>Баллы + коины</option>
        </select>
      </div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Максимум баллов</label><input id="tb-reward-points" type="number" min="0" class="form-input" value="${s.reward_points}" ${isOpen?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Максимум коинов</label><input id="tb-reward-coins" type="number" min="0" class="form-input" value="${s.reward_coins}" ${isOpen?'disabled':''}></div>
      </div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Минимальный % для награды</label><input id="tb-reward-min-percent" type="number" min="0" max="100" class="form-input" value="${s.reward_min_percent}" ${isOpen?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Режим начисления</label>
          <select id="tb-reward-mode" class="form-select" ${isOpen?'disabled':''}>
            <option value="fixed" ${s.reward_mode==='fixed'?'selected':''}>Фиксированная</option>
            <option value="proportional" ${s.reward_mode==='proportional'?'selected':''}>Пропорциональная</option>
          </select>
        </div>
      </div>
    </div>

    <div class="test-builder-card">
      <div class="rcard-title-row"><div class="rcard-title">2. Вопросы</div>${!isOpen?'<button class="btn-outline btn-sm" id="tb-add-question">+ Добавить вопрос</button>':''}</div>
      <div id="tb-questions-list">${s.questions.map((q,i) => questionEditorHtml(q,i,isOpen)).join('') || '<div class="empty-line">Вопросов пока нет</div>'}</div>
    </div>

    <div class="test-builder-card">
      <div class="rcard-title">3. Назначение — кому назначить тест</div>
      <div class="form-group">
        <select id="tb-assign-type" class="form-select">
          <option value="all" ${s.assignTargetType==='all'?'selected':''}>Все операторы</option>
          <option value="group" ${s.assignTargetType==='group'?'selected':''}>По группам</option>
          <option value="operator" ${s.assignTargetType==='operator'?'selected':''}>Отдельные операторы</option>
        </select>
      </div>
      <div id="tb-assign-targets"></div>
    </div>

    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn-outline" id="tb-save-draft">Сохранить ${s.testId?'':'как черновик'}</button>
      <button class="btn-primary" id="tb-save-and-publish">${s.status==='open'?'Сохранить изменения':'Сохранить и опубликовать'}</button>
    </div>
  `;

  el.querySelector('#tb-add-question')?.addEventListener('click', () => {
    s.questions.push({ question_text: '', question_type: 'single_choice', points: 1, answers: [{answer_text:'',is_correct:false},{answer_text:'',is_correct:false}] });
    renderTestBuilderScreen();
  });

  bindQuestionEditorEvents(el, isOpen);
  renderAssignTargetsBlock(el);
  el.querySelector('#tb-assign-type').addEventListener('change', (e) => { s.assignTargetType = e.target.value; renderAssignTargetsBlock(el); });

  el.querySelector('#tb-save-draft').addEventListener('click', () => saveTestBuilder(false));
  el.querySelector('#tb-save-and-publish').addEventListener('click', () => saveTestBuilder(true));
}

function questionEditorHtml(q, index, isOpen) {
  return `<div class="test-question-editor" data-q-index="${index}">
    <div class="test-question-editor-head">
      <input class="form-input" placeholder="Текст вопроса" value="${esc(q.question_text)}" data-q-field="question_text" ${isOpen?'disabled':''}>
      <select class="form-select" data-q-field="question_type" style="max-width:200px" ${isOpen?'disabled':''}>
        <option value="single_choice" ${q.question_type==='single_choice'?'selected':''}>Один ответ</option>
        <option value="multiple_choice" ${q.question_type==='multiple_choice'?'selected':''}>Несколько ответов</option>
      </select>
      <input class="form-input" type="number" min="0" style="max-width:90px" placeholder="Баллы" value="${q.points}" data-q-field="points" ${isOpen?'disabled':''}>
      ${!isOpen?`<button class="btn-outline btn-sm" data-q-delete>×</button>`:''}
    </div>
    <div class="test-answer-options">
      ${q.answers.map((a,ai) => `<div class="test-answer-option-row" data-a-index="${ai}">
        <input type="${q.question_type==='multiple_choice'?'checkbox':'radio'}" data-a-field="is_correct" ${a.is_correct?'checked':''} ${isOpen?'disabled':''}>
        <input class="form-input" placeholder="Вариант ответа" value="${esc(a.answer_text)}" data-a-field="answer_text" ${isOpen?'disabled':''}>
        ${!isOpen&&q.answers.length>2?`<button class="btn-outline btn-sm" data-a-delete>×</button>`:''}
      </div>`).join('')}
    </div>
    ${!isOpen && q.answers.length < 10 ? `<button class="btn-outline btn-sm" data-q-add-answer>+ Добавить вариант ответа</button>` : ''}
  </div>`;
}

function bindQuestionEditorEvents(el, isOpen) {
  const s = _testBuilderState;
  el.querySelectorAll('[data-q-index]').forEach(qDiv => {
    const qi = Number(qDiv.dataset.qIndex);
    qDiv.querySelectorAll('[data-q-field]').forEach(input => {
      input.addEventListener('input', () => { s.questions[qi][input.dataset.qField] = input.type === 'number' ? Number(input.value) : input.value; });
      input.addEventListener('change', () => {
        if (input.dataset.qField === 'question_type') renderTestBuilderScreen();
      });
    });
    qDiv.querySelector('[data-q-delete]')?.addEventListener('click', () => { s.questions.splice(qi,1); renderTestBuilderScreen(); });
    qDiv.querySelector('[data-q-add-answer]')?.addEventListener('click', () => { s.questions[qi].answers.push({answer_text:'',is_correct:false}); renderTestBuilderScreen(); });

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
      aDiv.querySelector('[data-a-delete]')?.addEventListener('click', () => { s.questions[qi].answers.splice(ai,1); renderTestBuilderScreen(); });
    });
  });
}

function renderAssignTargetsBlock(el) {
  const s = _testBuilderState;
  const box = el.querySelector('#tb-assign-targets');
  if (s.assignTargetType === 'all') { box.innerHTML = ''; return; }
  if (s.assignTargetType === 'group') {
    box.innerHTML = `<div class="form-group"><label class="form-label">Группы</label>
      <div class="test-target-checklist">${(STATE.groups||[]).map(g => `<label class="an-checkbox-label"><input type="checkbox" value="${g.id}" ${s.assignTargetIds.includes(g.id)?'checked':''}> ${esc(g.name)}</label>`).join('')}</div></div>`;
  } else {
    box.innerHTML = `<div class="form-group"><label class="form-label">Операторы</label>
      <input class="form-input" id="tb-operator-search" placeholder="Поиск по ФИО" style="margin-bottom:8px">
      <div class="test-target-checklist" id="tb-operator-checklist">${(STATE.adminOperators||[]).map(o => `<label class="an-checkbox-label" data-op-name="${esc(o.full_name).toLowerCase()}"><input type="checkbox" value="${o.id}" ${s.assignTargetIds.includes(o.id)?'checked':''}> ${esc(o.full_name)}</label>`).join('')}</div></div>`;
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

  const payload = {
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

  if (!payload.title.trim()) { showToast('Укажите название теста', 'error'); return; }

  try {
    let testId = s.testId;
    if (testId) {
      await api.updateTest(testId, payload);
    } else {
      const created = await api.createTest(payload);
      testId = created.id;
      s.testId = testId;
    }

    for (const q of s.questions) {
      if (q.answers.filter(a => a.is_correct).length === 0) {
        showToast(`У вопроса "${q.question_text || '(без текста)'}" не указан правильный ответ`, 'error');
        return;
      }
      const qPayload = { question_text: q.question_text, question_type: q.question_type, points: q.points, sort_order: 0, answers: q.answers };
      if (q.id) await api.updateTestQuestion(q.id, qPayload);
      else { const created = await api.addTestQuestion(testId, qPayload); q.id = created.id; }
    }

    await api.assignTest(testId, { target_type: s.assignTargetType, target_ids: s.assignTargetIds });

    if (publish) {
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

