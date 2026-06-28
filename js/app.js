/* ============================================================
   iCore: Конкурсы операторов - app.js v4
   Одна страница, один набор данных. Баллы обновляются через админ.
   ============================================================ */

'use strict';

const USE_MOCK = false;
const API_BASE = window.location.origin;

/* ── Группы ─────────────────────────────────────────────────── */
const FACTION_DESC = {
  dauntless: 'Воплощают храбрость, отвагу и силу. Отвечают за безопасность и охраняют границы.',
  erudite:   'Стремятся к знаниям, мудрости и интеллекту. Занимаются наукой и технологиями.',
  candor:    'Ставят во главу угла честность и правду. Выполняют функции судей и дипломатов.',
};

let FACULTIES = [
  { id: 'group-a', cls: 'dauntless', icon: '1', crest: null, name: 'Группа 1', enName: 'Team 1', tagCls: 'tag-dauntless', scoreCls: 'dauntless-score', operators: [] },
  { id: 'group-b', cls: 'erudite',   icon: '2', crest: null, name: 'Группа 2', enName: 'Team 2', tagCls: 'tag-erudite',   scoreCls: 'erudite-score',   operators: [] },
  { id: 'group-c', cls: 'candor',    icon: '3', crest: null, name: 'Группа 3', enName: 'Team 3', tagCls: 'tag-candor',    scoreCls: 'candor-score',    operators: [] },
];

/* Один слот данных — обновляется при каждой публикации результатов */
let WEEKLY_DATA = [ [] ];

const DEFAULT_METRICS = [
  { label: 'Качество',     type: 'metric'  },
  { label: 'Выработка',    type: 'metric'  },
  { label: 'Эфф. %',       type: 'metric'  },
  { label: 'Доп. баллы',   type: 'metric'  },
  { label: 'Опозд. (мин)', type: 'penalty' },
  { label: 'Нарушения',    type: 'penalty' },
  { label: 'Сайты',        type: 'penalty' },
  { label: 'Итого',        type: 'score'   },
];

const GAME_SEASON = {
  title: 'iCore: геймификация операторов',
  theme: 'Рабочий период',
  startDate: '2026-06-15',
  endDate: '2026-06-30',
  currency: 'коинов',
  maxMissionScore: 100,
  kvzTarget: 20,
  efficiencyTarget: 70,
};

const GAME_REWARDS = [
  { title: 'Батончик + напиток', price: 80, tag: 'быстрый приз' },
  { title: 'Мерч / кружка / блокнот', price: 250, tag: 'склад наград' },
  { title: 'Сертификат Kaspi', price: 300, tag: 'сертификат' },
  { title: '1 час тренинга вместо линии', price: 400, tag: 'по согласованию' },
  { title: 'Право выбрать смену', price: 500, tag: 'супервайзер' },
  { title: 'Обед за счёт компании', price: 700, tag: 'супервайзер' },
];

const ICORE_SHOP_ITEMS = [
  { id: 'raffle-ticket', title: 'Участие в розыгрыше', price: 50, desc: '1 билет в ежемесячный розыгрыш крупного приза' },
  { id: 'week-star', title: 'Статус «Звезда недели»', price: 30, desc: 'Бейдж и упоминание в общем чате команды' },
  { id: 'early-shift', title: 'Ранний доступ к аукциону смен', price: 80, desc: 'Выбор смены на 30 минут раньше других' },
  { id: 'break-15', title: 'Дополнительный перерыв +15 мин', price: 80, desc: 'Согласовывается с руководителем' },
  { id: 'coffee', title: 'Сертификат на кофе', price: 120, desc: 'Подарочная карта в кофейню' },
  { id: 'pizza', title: 'Корпоративная пицца', price: 180, desc: 'Пицца для вас и двух коллег на смене' },
  { id: 'merch', title: 'Мерч компании', price: 200, desc: 'Кружка, худи, блокнот, термокружка или шоппер' },
  { id: 'lunch', title: 'Обед за счёт компании', price: 300, desc: 'Оплаченный обед или сертификат на питание' },
  { id: 'marketplace', title: 'Сертификат маркетплейс', price: 400, desc: 'Подарочная карта Kaspi, Wildberries и др.' },
];

const ICORE_REQUEST_STATUS = {
  new: 'Новая',
  approved: 'Одобрена',
  rejected: 'Отклонена',
  done: 'Выполнена',
};

const ADMIN_SESSION_KEY = 'divergentContestAdminUnlocked';
const ADMIN_PASSWORD_KEY = 'divergentContestAdminToken';
const OPERATOR_SESSION_KEY = 'icoreOperatorSession';
const AUTH_SESSION_KEY = 'icoreAuthSession';
const DAILY_IMPORT_STORAGE_KEY = 'divergentContestDailyImport';
const GAMIFICATION_STORAGE_KEY = 'icoreGamificationState';
const VISUAL_MODE_STORAGE_KEY = 'divergentContestVisualMode';
const VISUAL_OPERATOR_STORAGE_KEY = 'divergentContestVisualOperator';
let isAdmin = false;
let currentUser = null;
let operatorSession = null;
let DAILY_IMPORT_DATA = null;
let GAMIFICATION = { settings: { coinRate: 5 }, manualLedger: [], requests: [] };
let visualMode = localStorage.getItem(VISUAL_MODE_STORAGE_KEY) || 'overview';
let visualOperatorKey = localStorage.getItem(VISUAL_OPERATOR_STORAGE_KEY) || '';

function getAdminPassword() {
  return currentUser?.token || '';
}

function normalizeAuthSession(input) {
  if (!input || typeof input !== 'object') return null;
  const token = String(input.token || '').trim();
  const user = input.user && typeof input.user === 'object' ? input.user : null;
  if (!token || !user?.login || !user?.role) return null;
  return {
    token,
    expiresAt: String(input.expiresAt || ''),
    user: {
      id: String(user.id || user.login),
      login: String(user.login || ''),
      name: String(user.name || user.login || ''),
      role: user.role === 'admin' ? 'admin' : 'operator',
      operatorName: String(user.operatorName || ''),
      operatorKey: String(user.operatorKey || ''),
    },
    operator: input.operator || null,
  };
}

function applyAuthSession(session) {
  const normalized = normalizeAuthSession(session);
  api.setAuthToken(normalized?.token || '');
  currentUser = normalized ? { ...normalized.user, token: normalized.token, expiresAt: normalized.expiresAt } : null;
  isAdmin = currentUser?.role === 'admin';

  if (isAdmin) {
    operatorSession = null;
  } else if (normalized?.operator) {
    operatorSession = normalizeOperatorSession(normalized.operator);
  } else if (currentUser) {
    operatorSession = normalizeOperatorSession({
      key: '',
      name: currentUser.operatorName || currentUser.name,
      nameKey: currentUser.operatorKey || currentUser.operatorName || currentUser.name,
      facultyName: '',
    });
  } else {
    operatorSession = null;
  }

  if (normalized) {
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(normalized));
  } else {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
    sessionStorage.removeItem(OPERATOR_SESSION_KEY);
  }
}

function loadAuthSession() {
  try {
    applyAuthSession(JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY) || 'null'));
  } catch {
    applyAuthSession(null);
  }
}

async function refreshAuthSession() {
  if (!currentUser?.token) return null;
  try {
    const result = await api.loadSession();
    if (!result?.user) {
      applyAuthSession(null);
      return null;
    }
    applyAuthSession({
      token: currentUser.token,
      expiresAt: result.expiresAt || currentUser.expiresAt,
      user: result.user,
      operator: result.operator,
    });
    return result;
  } catch {
    applyAuthSession(null);
    return null;
  }
}

function normalizeOperatorSession(input) {
  if (!input || typeof input !== 'object') return null;
  const name = String(input.name || '').trim();
  const nameKey = normalizeOperatorName(input.nameKey || name);
  if (!name || !nameKey) return null;
  return {
    key: String(input.key || ''),
    name,
    nameKey,
    facultyId: String(input.facultyId || ''),
    facultyName: String(input.facultyName || ''),
  };
}

function loadOperatorSession() {
  if (currentUser) return;
  try {
    operatorSession = normalizeOperatorSession(JSON.parse(sessionStorage.getItem(OPERATOR_SESSION_KEY) || 'null'));
  } catch {
    operatorSession = null;
  }
}

function persistOperatorSession() {
  if (!operatorSession) {
    sessionStorage.removeItem(OPERATOR_SESSION_KEY);
    return;
  }
  sessionStorage.setItem(OPERATOR_SESSION_KEY, JSON.stringify(operatorSession));
}

function getOperatorSessionRow(ranking = getOperatorRanking()) {
  if (!operatorSession) return null;
  const row = ranking.find(item => item.nameKey === operatorSession.nameKey) ||
    ranking.find(item => item.key === operatorSession.key);
  if (!row) return null;
  operatorSession = normalizeOperatorSession({
    key: row.key,
    name: row.name,
    nameKey: row.nameKey,
    facultyId: row.faculty?.id,
    facultyName: row.faculty?.name,
  });
  persistOperatorSession();
  return row;
}

function setOperatorSession(operator) {
  operatorSession = normalizeOperatorSession(operator);
  const row = getOperatorSessionRow();
  if (row) {
    visualOperatorKey = row.key;
    try { localStorage.setItem(VISUAL_OPERATOR_STORAGE_KEY, row.key); } catch {}
  }
  persistOperatorSession();
}

function clearOperatorSession() {
  operatorSession = null;
  sessionStorage.removeItem(OPERATOR_SESSION_KEY);
}

function ensureOperatorAuthOverlay() {
  let overlay = document.getElementById('operator-auth-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('section');
  overlay.id = 'operator-auth-overlay';
  overlay.className = 'operator-auth-overlay';
  overlay.hidden = true;
  overlay.setAttribute('aria-label', 'Вход в систему');
  overlay.innerHTML = `
    <div class="operator-auth-shell">
      <aside class="operator-auth-visual" aria-hidden="true">
        <div class="operator-auth-logo-row">
          <span class="operator-auth-mark">C</span>
          <span>Contest</span>
        </div>
        <h1>Панель результатов операторов</h1>
        <p>Единый вход для администратора и операторов системы.</p>
        <div class="operator-auth-lines">
          <span></span><span></span><span></span>
        </div>
      </aside>
      <div class="operator-auth-card">
        <div class="operator-auth-mark" aria-hidden="true">C</div>
        <div class="operator-auth-kicker">Contest</div>
        <h2 id="operator-auth-title">Вход в систему</h2>
        <p id="operator-auth-copy">Введите логин и пароль. Если аккаунта ещё нет, зарегистрируйтесь как оператор.</p>
        <div class="operator-auth-tabs" role="tablist" aria-label="Вход или регистрация">
          <button class="active" id="operator-auth-login-tab" type="button" onclick="setOperatorAuthMode('login')" aria-selected="true">Вход</button>
          <button id="operator-auth-register-tab" type="button" onclick="setOperatorAuthMode('register')" aria-selected="false">Регистрация</button>
        </div>
        <div class="operator-auth-form" id="operator-login-form">
          <label class="operator-auth-field">
            <span>Логин</span>
            <input id="operator-login-input" type="text" autocomplete="username" placeholder="admin или test">
          </label>
          <label class="operator-auth-field">
            <span>Пароль</span>
            <input id="operator-password-input" type="password" autocomplete="current-password" placeholder="Пароль">
          </label>
          <button class="operator-auth-submit" id="operator-login-submit" type="button" onclick="loginOperator()">Войти</button>
        </div>
        <div class="operator-auth-form" id="operator-register-form" hidden>
          <label class="operator-auth-field">
            <span>ФИО оператора</span>
            <input id="operator-register-name" type="text" autocomplete="name" placeholder="Например: Алибек Аружан">
          </label>
          <label class="operator-auth-field">
            <span>Группа</span>
            <select id="operator-register-faculty"></select>
          </label>
          <label class="operator-auth-field">
            <span>Логин</span>
            <input id="operator-register-login" type="text" autocomplete="username" placeholder="Например: alibek">
          </label>
          <label class="operator-auth-field">
            <span>Пароль</span>
            <input id="operator-register-password" type="password" autocomplete="new-password" placeholder="Минимум 6 символов">
          </label>
          <label class="operator-auth-field">
            <span>Повторите пароль</span>
            <input id="operator-register-password-confirm" type="password" autocomplete="new-password" placeholder="Ещё раз пароль">
          </label>
          <button class="operator-auth-submit" id="operator-register-submit" type="button" onclick="registerOperator()">Создать аккаунт</button>
        </div>
        <div class="operator-auth-error" id="operator-login-error" aria-live="polite"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#operator-login-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') loginOperator();
  });
  overlay.querySelector('#operator-password-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') loginOperator();
  });
  overlay.querySelectorAll('#operator-register-form input, #operator-register-form select').forEach(input => {
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') registerOperator();
    });
  });
  updateOperatorRegistrationOptions();
  return overlay;
}

function updateOperatorRegistrationOptions() {
  const select = document.getElementById('operator-register-faculty');
  if (!select) return;
  select.innerHTML = FACULTIES.map((faculty, index) => `
    <option value="${escapeHtml(faculty.id || `group-${index + 1}`)}">${escapeHtml(faculty.name || `Группа ${index + 1}`)}</option>
  `).join('');
}

function setOperatorAuthMode(mode) {
  const registerMode = mode === 'register';
  const title = document.getElementById('operator-auth-title');
  const copy = document.getElementById('operator-auth-copy');
  const loginForm = document.getElementById('operator-login-form');
  const registerForm = document.getElementById('operator-register-form');
  const loginTab = document.getElementById('operator-auth-login-tab');
  const registerTab = document.getElementById('operator-auth-register-tab');
  const error = document.getElementById('operator-login-error');

  if (title) title.textContent = registerMode ? 'Регистрация оператора' : 'Вход в систему';
  if (copy) copy.textContent = registerMode
    ? 'Создайте операторский аккаунт. После регистрации вы сразу попадёте в личный кабинет.'
    : 'Введите логин и пароль. Если аккаунта ещё нет, зарегистрируйтесь как оператор.';
  if (loginForm) loginForm.hidden = registerMode;
  if (registerForm) registerForm.hidden = !registerMode;
  loginTab?.classList.toggle('active', !registerMode);
  registerTab?.classList.toggle('active', registerMode);
  loginTab?.setAttribute('aria-selected', String(!registerMode));
  registerTab?.setAttribute('aria-selected', String(registerMode));
  if (error) error.textContent = '';
  updateOperatorRegistrationOptions();
  setTimeout(() => {
    document.getElementById(registerMode ? 'operator-register-name' : 'operator-login-input')?.focus();
  }, 0);
}

function updateOperatorLoginOptions() {
  const list = document.getElementById('operator-login-list');
  if (!list) return;
  const seen = new Set();
  list.innerHTML = getOperatorRanking()
    .filter(row => {
      if (!row.name || seen.has(row.nameKey)) return false;
      seen.add(row.nameKey);
      return true;
    })
    .map(row => `<option value="${escapeHtml(row.name)}"></option>`)
    .join('');
}

function showOperatorLogin() {
  const overlay = ensureOperatorAuthOverlay();
  updateOperatorLoginOptions();
  updateOperatorRegistrationOptions();
  overlay.hidden = false;
  document.body.classList.add('operator-login-required');
  setTimeout(() => {
    const activeRegister = !document.getElementById('operator-register-form')?.hidden;
    document.getElementById(activeRegister ? 'operator-register-name' : 'operator-login-input')?.focus();
  }, 0);
}

function showAdminLoginFromOperator() {
  document.getElementById('operator-auth-overlay')?.setAttribute('hidden', '');
  document.body.classList.remove('operator-login-required');
  openAdminModal();
}

function updateOperatorAuthOverlay() {
  const ranking = getOperatorRanking();
  if (operatorSession && !getOperatorSessionRow(ranking)) clearOperatorSession();
  const overlay = ensureOperatorAuthOverlay();
  updateOperatorLoginOptions();
  updateOperatorRegistrationOptions();
  const required = !currentUser;
  overlay.hidden = !required;
  document.body.classList.toggle('operator-login-required', required);
}

async function loginOperator() {
  const input = document.getElementById('operator-login-input');
  const passwordInput = document.getElementById('operator-password-input');
  const error = document.getElementById('operator-login-error');
  const button = document.getElementById('operator-login-submit');
  const login = String(input?.value || '').trim();
  const password = String(passwordInput?.value || '');
  if (!login || !password) {
    if (error) error.textContent = 'Введите логин и пароль';
    (login ? passwordInput : input)?.focus();
    return;
  }
  if (button) { button.disabled = true; button.textContent = 'Проверка...'; }
  if (error) error.textContent = '';

  try {
    const result = await api.login(login, password);
    applyAuthSession(result);
    if (!isAdmin && !getOperatorSessionRow()) {
      throw new Error('Операторский аккаунт не привязан к строке таблицы');
    }
    document.getElementById('operator-auth-overlay')?.setAttribute('hidden', '');
    document.body.classList.remove('operator-login-required');
    await refreshDashboard();
    window.showContestSection?.(isAdmin ? 'admin' : 'overview');
  } catch (err) {
    applyAuthSession(null);
    if (error) error.textContent = err.message || 'Не удалось войти';
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Войти'; }
  }
}

async function registerOperator() {
  const nameInput = document.getElementById('operator-register-name');
  const facultyInput = document.getElementById('operator-register-faculty');
  const loginInput = document.getElementById('operator-register-login');
  const passwordInput = document.getElementById('operator-register-password');
  const confirmInput = document.getElementById('operator-register-password-confirm');
  const error = document.getElementById('operator-login-error');
  const button = document.getElementById('operator-register-submit');
  const name = String(nameInput?.value || '').trim();
  const facultyId = String(facultyInput?.value || '').trim();
  const login = String(loginInput?.value || '').trim();
  const password = String(passwordInput?.value || '');
  const passwordConfirm = String(confirmInput?.value || '');

  if (!name || !login || !password || !passwordConfirm) {
    if (error) error.textContent = 'Заполните ФИО, логин и пароль';
    (!name ? nameInput : !login ? loginInput : !password ? passwordInput : confirmInput)?.focus();
    return;
  }
  if (password.length < 6) {
    if (error) error.textContent = 'Пароль должен быть не короче 6 символов';
    passwordInput?.focus();
    return;
  }
  if (password !== passwordConfirm) {
    if (error) error.textContent = 'Пароли не совпадают';
    confirmInput?.focus();
    return;
  }

  if (button) { button.disabled = true; button.textContent = 'Создание...'; }
  if (error) error.textContent = '';

  try {
    const result = await api.registerOperator({ name, login, password, facultyId });
    if (result.state) applyEditableState(result.state);
    applyAuthSession(result);
    if (!getOperatorSessionRow()) {
      throw new Error('Аккаунт создан, но операторская строка не найдена');
    }
    document.getElementById('operator-auth-overlay')?.setAttribute('hidden', '');
    document.body.classList.remove('operator-login-required');
    await refreshDashboard();
    window.showContestSection?.('overview');
  } catch (err) {
    applyAuthSession(null);
    if (error) error.textContent = err.message || 'Не удалось зарегистрироваться';
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Создать аккаунт'; }
  }
}

async function logoutOperator() {
  try { await api.logout(); } catch {}
  applyAuthSession(null);
  updateOperatorAuthOverlay();
  refreshDashboard();
  window.showContestSection?.('overview');
}

function ensureOperatorAccess() {
  if (isAdmin || operatorSession) return true;
  showOperatorLogin();
  return false;
}

let METRICS = DEFAULT_METRICS.map(m => ({ ...m }));

/* ── Debounce ───────────────────────────────────────────────── */
function debounce(fn, delay = 500) {
  let timer = null, lastArgs = null, pendingResolve = null, pendingReject = null;
  function fire() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pendingResolve) return Promise.resolve();
    const args = lastArgs, resolve = pendingResolve, reject = pendingReject;
    pendingResolve = null; pendingReject = null;
    return Promise.resolve().then(() => fn.apply(null, args)).then(resolve, reject);
  }
  function debounced(...args) {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    return new Promise((resolve, reject) => {
      if (pendingResolve) pendingResolve({ debounced: true });
      pendingResolve = resolve; pendingReject = reject;
      timer = setTimeout(() => { fire(); }, delay);
    });
  }
  debounced.flush = fire;
  debounced.hasPending = () => timer !== null;
  return debounced;
}

/* ── Save indicator ─────────────────────────────────────────── */
function setSaveIndicator(state) {
  let el = document.getElementById('save-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'save-indicator';
    el.style.cssText = [
      'position:fixed','bottom:72px','left:16px','z-index:9998',
      'padding:8px 14px','border-radius:6px','font-family:Rajdhani,sans-serif',
      'font-size:12px','letter-spacing:.06em','pointer-events:none',
      'transition:opacity .25s ease','opacity:0',
    ].join(';');
    document.body.appendChild(el);
  }
  const palette = {
    pending: ['rgba(30,60,120,.92)',  '#e0e0f8', '⟳ Сохраняю…'],
    saved:   ['rgba(30,100,55,.92)',  '#e0e0f8', '✓ Сохранено'],
    error:   ['rgba(160,30,30,.95)',  '#e0e0f8', '✗ Ошибка сохранения'],
    idle:    ['','',''],
  };
  const [bg, fg, text] = palette[state] || palette.idle;
  if (state === 'idle') { el.style.opacity = '0'; return; }
  el.style.background = bg; el.style.color = fg; el.textContent = text; el.style.opacity = '1';
  if (state === 'saved') setTimeout(() => { el.style.opacity = '0'; }, 1500);
}

function getScoreMetricIndex() {
  const idx = METRICS.findIndex(m => m.type === 'score');
  return idx === -1 ? METRICS.length - 1 : idx;
}

function roundScoreValue(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function normalizeMetricLabel(value) {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function findMetricIndexByAliases(aliases = []) {
  const normalizedAliases = aliases.map(normalizeMetricLabel).filter(Boolean);
  return METRICS.findIndex(metric => {
    if (!metric || metric.type === 'score') return false;
    const label = normalizeMetricLabel(metric.label);
    return normalizedAliases.some(alias => label.includes(alias));
  });
}

function hasMetric(aliases = []) {
  return findMetricIndexByAliases(aliases) !== -1;
}

function getMetricValue(row = [], aliases = []) {
  const idx = findMetricIndexByAliases(aliases);
  return idx === -1 ? 0 : Number(row[idx]) || 0;
}

function getPenaltyTotal(row = []) {
  return METRICS.reduce((total, metric, metricIdx) => {
    if (metric.type !== 'penalty') return total;
    return total + Math.max(0, Number(row[metricIdx]) || 0);
  }, 0);
}

function getScoreComponent(row, aliases, target, weight) {
  if (!hasMetric(aliases) || !target || !weight) return { value: 0, weight: 0 };
  const raw = getMetricValue(row, aliases);
  return {
    value: clampValue(raw / target, 0, 1) * weight,
    weight,
  };
}

function calculateOperatorScore(row = []) {
  const components = [
    getScoreComponent(row, ['качество'], 100, 35),
    getScoreComponent(row, ['квз', 'звон'], GAME_SEASON.kvzTarget, 20),
    getScoreComponent(row, ['эфф'], GAME_SEASON.efficiencyTarget, 20),
    getScoreComponent(row, ['выработ'], 100, 15),
    getScoreComponent(row, ['мисси', 'доп'], GAME_SEASON.maxMissionScore, 10),
  ].filter(component => component.weight > 0);

  const activeWeight = components.reduce((total, component) => total + component.weight, 0);
  const positiveScore = components.reduce((total, component) => total + component.value, 0);
  const normalizedPositiveScore = activeWeight > 0 ? (positiveScore / activeWeight) * 100 : 0;
  const finalScore = normalizedPositiveScore - getPenaltyTotal(row);

  return roundScoreValue(clampValue(finalScore, 0, 100));
}

function syncOperatorScore(row = []) {
  const scoreIdx = getScoreMetricIndex();
  if (scoreIdx >= 0) row[scoreIdx] = calculateOperatorScore(row);
  return row;
}

function syncAllScores() {
  WEEKLY_DATA[0]?.forEach(facRows => {
    facRows.forEach(row => syncOperatorScore(row));
  });
}

function normalizeOperatorName(name) {
  return String(name || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function neutralizeGroupLabels() {
  const neutralNames = ['Группа 1', 'Группа 2', 'Группа 3', 'Группа 4', 'Группа 5'];
  const neutralIcons = ['1', '2', '3', '4', '5'];
  const themedNames = new Set(['бесстрашие', 'эрудиция', 'искренность', 'dauntless', 'erudite', 'candor']);

  FACULTIES.forEach((fac, idx) => {
    const normalizedName = normalizeOperatorName(fac.name);
    const normalizedEn = normalizeOperatorName(fac.enName);
    fac.crest = null;
    if (themedNames.has(normalizedName) || themedNames.has(normalizedEn) || /dauntless|erudite|candor/i.test(String(fac.id || ''))) {
      fac.name = neutralNames[idx] || `Группа ${idx + 1}`;
      fac.enName = `Team ${idx + 1}`;
      fac.icon = neutralIcons[idx] || String(idx + 1);
    }
  });
}

function sanitizeDailyImport(input) {
  if (!input || typeof input !== 'object' || !input.operators || typeof input.operators !== 'object') return null;
  const operators = {};
  Object.entries(input.operators).forEach(([key, value]) => {
    if (!value || typeof value !== 'object' || !Array.isArray(value.dates)) return;
    operators[normalizeOperatorName(key)] = {
      operator: String(value.operator || ''),
      dates: value.dates.map(day => ({
        key: String(day.key || ''),
        label: String(day.label || ''),
        baseWorked: Number(day.baseWorked) || 0,
        extraHours: Number(day.extraHours) || 0,
        actualFact: Number(day.actualFact) || 0,
        effectiveHours: Number(day.effectiveHours) || 0,
      })).filter(day => day.key),
    };
  });

  return {
    period: String(input.period || ''),
    dateKeys: Array.isArray(input.dateKeys) ? input.dateKeys.map(String) : [],
    generatedAt: String(input.generatedAt || ''),
    operators,
  };
}

function normalizeGamification(input) {
  const source = input && typeof input === 'object' ? input : {};
  const settingsSource = source.settings && typeof source.settings === 'object' ? source.settings : {};
  const coinRate = Number(settingsSource.coinRate);
  const normalizeKey = value => normalizeOperatorName(value || '');

  return {
    settings: {
      coinRate: Number.isFinite(coinRate) && coinRate > 0 ? coinRate : 5,
    },
    manualLedger: Array.isArray(source.manualLedger)
      ? source.manualLedger.map(item => ({
          id: String(item?.id || `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`),
          operatorKey: normalizeKey(item?.operatorKey || item?.operatorName),
          operatorName: String(item?.operatorName || '').trim(),
          amount: Number.isFinite(Number(item?.amount)) ? Math.trunc(Number(item.amount)) : 0,
          comment: String(item?.comment || '').trim(),
          author: String(item?.author || '').trim() || 'Администратор',
          createdAt: String(item?.createdAt || '').trim() || new Date().toISOString(),
        })).filter(item => item.operatorKey && item.amount !== 0 && item.comment)
      : [],
    requests: Array.isArray(source.requests)
      ? source.requests.map(item => ({
          id: String(item?.id || `request-${Date.now()}-${Math.random().toString(16).slice(2)}`),
          operatorKey: normalizeKey(item?.operatorKey || item?.operatorName),
          operatorName: String(item?.operatorName || '').trim(),
          rewardId: String(item?.rewardId || '').trim(),
          rewardTitle: String(item?.rewardTitle || '').trim(),
          price: Number.isFinite(Number(item?.price)) ? Math.max(0, Math.trunc(Number(item.price))) : 0,
          status: ICORE_REQUEST_STATUS[item?.status] ? item.status : 'new',
          reason: String(item?.reason || '').trim(),
          createdAt: String(item?.createdAt || '').trim() || new Date().toISOString(),
          updatedAt: String(item?.updatedAt || '').trim() || String(item?.createdAt || '').trim() || new Date().toISOString(),
        })).filter(item => item.operatorKey && item.rewardId && item.rewardTitle && item.price > 0)
      : [],
  };
}

function readStoredGamification() {
  try {
    return normalizeGamification(JSON.parse(localStorage.getItem(GAMIFICATION_STORAGE_KEY) || 'null'));
  } catch {
    return normalizeGamification(null);
  }
}

function persistGamification() {
  try { localStorage.setItem(GAMIFICATION_STORAGE_KEY, JSON.stringify(GAMIFICATION)); } catch {}
}

function readStoredDailyImport() {
  try {
    return sanitizeDailyImport(JSON.parse(localStorage.getItem(DAILY_IMPORT_STORAGE_KEY) || 'null'));
  } catch {
    return null;
  }
}

function setDailyImportData(data) {
  DAILY_IMPORT_DATA = sanitizeDailyImport(data);
  try {
    if (DAILY_IMPORT_DATA) localStorage.setItem(DAILY_IMPORT_STORAGE_KEY, JSON.stringify(DAILY_IMPORT_DATA));
    else localStorage.removeItem(DAILY_IMPORT_STORAGE_KEY);
  } catch {}
}

/* ── Normalize ──────────────────────────────────────────────── */
function normalizeEditableData() {
  const metricCount = METRICS.length;
  FACULTIES.forEach(fac => { fac.crest = null; });

  if (!WEEKLY_DATA[0]) WEEKLY_DATA[0] = [];

  FACULTIES.forEach((fac, fi) => {
    if (!WEEKLY_DATA[0][fi]) WEEKLY_DATA[0][fi] = [];
    fac.operators.forEach((_, oi) => {
      if (!WEEKLY_DATA[0][fi][oi]) WEEKLY_DATA[0][fi][oi] = Array(metricCount).fill(0);
      while (WEEKLY_DATA[0][fi][oi].length < metricCount) {
        WEEKLY_DATA[0][fi][oi].splice(getScoreMetricIndex(), 0, 0);
      }
      if (WEEKLY_DATA[0][fi][oi].length > metricCount) {
        WEEKLY_DATA[0][fi][oi].length = metricCount;
      }
      syncOperatorScore(WEEKLY_DATA[0][fi][oi]);
    });
    if (WEEKLY_DATA[0][fi].length > fac.operators.length) {
      WEEKLY_DATA[0][fi].length = fac.operators.length;
    }
  });
}

/* ── Load / Save ────────────────────────────────────────────── */
function applyEditableState(state) {
  if (state && Array.isArray(state.faculties) && Array.isArray(state.weeklyData) && Array.isArray(state.metrics)) {
    FACULTIES   = state.faculties;
    /* Совместимость: если сервер вернул старый формат [slot0, slot1],
       берём первый (промежуточный) слот */
    WEEKLY_DATA = Array.isArray(state.weeklyData[0]) && !Array.isArray(state.weeklyData[0][0])
      ? [ state.weeklyData[0] ]
      : [ state.weeklyData[0] ?? [] ];
    METRICS     = state.metrics;
    DAILY_IMPORT_DATA = sanitizeDailyImport(state.dailyImport) || readStoredDailyImport();
    GAMIFICATION = normalizeGamification(state.gamification || readStoredGamification());
  }
  if (!DAILY_IMPORT_DATA) DAILY_IMPORT_DATA = readStoredDailyImport();
  if (!state?.gamification) GAMIFICATION = readStoredGamification();
  GAMIFICATION = normalizeGamification(GAMIFICATION);
  persistGamification();
  if (!METRICS.some(m => m.type === 'score')) METRICS.push({ label: 'Итого', type: 'score' });
  neutralizeGroupLabels();
  normalizeEditableData();
}

async function loadEditableData() {
  applyEditableState(await api.loadState());
}

async function saveEditableData() {
  normalizeEditableData();
  /* Сохраняем в формате совместимом с сервером — один слот */
  setSaveIndicator('pending');
  try {
    await api.saveState({ faculties: FACULTIES, weeklyData: WEEKLY_DATA, metrics: METRICS, dailyImport: DAILY_IMPORT_DATA, gamification: GAMIFICATION }, getAdminPassword());
    persistGamification();
    setSaveIndicator('saved');
  } catch (err) {
    setSaveIndicator('error');
    if (/пароль/i.test(err.message) || err.message.includes('403')) {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
      isAdmin = false; updateAdminGate(); renderEditor();
      alert('⚠ Сессия администратора истекла. Войдите заново.');
      openAdminModal();
    } else {
      alert('⚠ Не удалось сохранить:\n' + err.message);
    }
    throw err;
  }
}

const debouncedSave = debounce(() => saveEditableData(), 500);

async function refreshDashboardOnly() {
  await Promise.all([
    renderModernDashboard(),
    renderIcoreShop(),
    renderIcoreAdmin(),
  ]);
  renderEditor();
  syncModernRoleUi();
}

function escapeHtml(v) {
  return String(v)
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

function fmtPts(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}

function formatMetricValue(value, metric) {
  const n = Number(value) || 0;
  if (metric.type === 'penalty' && n > 0) return `-${fmtPts(n)}`;
  return fmtPts(n);
}

function formatModernDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString('ru-RU');
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getModernUpdatedLabel() {
  const data = getDailyImportData?.();
  return formatModernDateTime(data?.generatedAt || data?.updatedAt || Date.now());
}

function getModernRoleLabel() {
  return isAdmin ? 'администратор' : 'оператор';
}

function getModernRoleLabel() {
  if (isAdmin) return 'администратор';
  return operatorSession?.name || 'оператор';
}

function getMetricTarget(metric) {
  const label = normalizeMetricLabel(metric?.label || '');
  if (metric?.type === 'penalty') return 0;
  if (label.includes('квз') || label.includes('звон')) return GAME_SEASON.kvzTarget;
  if (label.includes('эфф')) return GAME_SEASON.efficiencyTarget;
  if (label.includes('доп') || label.includes('мисси')) return GAME_SEASON.maxMissionScore;
  return 100;
}

function getMetricTone(metric, value, target) {
  if (metric?.type === 'penalty') return value > 0 ? 'risk' : 'good';
  if (!target) return 'neutral';
  if (value >= target) return 'good';
  if (value >= target * 0.75) return 'mid';
  return 'risk';
}

function renderModernOperatorSelect(ranking) {
  if (!ranking.length) return '';
  const selected = getSelectedVisualOperator(ranking);
  if (!isAdmin) {
    if (!selected || !operatorSession) {
      return `
        <div class="operator-session-card">
          <span>Оператор</span>
          <b>Вход не выполнен</b>
          <button type="button" onclick="showOperatorLogin()">Войти</button>
        </div>
      `;
    }
    return `
      <div class="operator-session-card">
        <span>Оператор</span>
        <b>${escapeHtml(selected.name)}</b>
        <small>${escapeHtml(selected.faculty.name)} · #${selected.rank}</small>
        <button type="button" onclick="logoutOperator()">Выйти</button>
      </div>
    `;
  }
  const options = ranking.map(row => `
    <option value="${row.key}" ${selected && selected.key === row.key ? 'selected' : ''}>
      ${row.rank}. ${escapeHtml(row.name)} - ${fmtPts(row.points)}
    </option>
  `).join('');
  return `
    <label class="mvp-operator-select">
      <span>Оператор</span>
      <select class="visual-operator-select" onchange="selectVisualOperator(this.value)">
        ${options}
      </select>
    </label>
  `;
}

function renderModernKpis(selected, state, ranking, states) {
  const activeCount = ranking.filter(row => row.points > 0).length;
  const totalWeekCoins = states.reduce((sum, item) => sum + item.weekCoins, 0);
  const pendingRequests = (GAMIFICATION.requests || []).filter(item => item.status === 'new').length;
  const progress = selected ? getOperatorProgressValue(selected) : 0;
  const cards = [
    { label: 'Баланс', value: state ? state.balance : 0, note: 'доступно коинов', tone: 'primary' },
    { label: 'Рейтинг', value: selected ? `#${selected.rank}` : '-', note: selected ? `из ${ranking.length} операторов` : 'нет данных', tone: selected?.rank <= 3 ? 'good' : 'neutral' },
    { label: 'Коины недели', value: totalWeekCoins, note: `${activeCount} активных участников`, tone: 'info' },
    { label: 'Динамика', value: progress > 0 ? `+${fmtPts(progress)}` : fmtPts(progress), note: `${pendingRequests} заявок в магазине`, tone: progress > 0 ? 'good' : 'neutral' },
  ];

  return `
    <div class="mvp-kpi-grid">
      ${cards.map(card => `
        <div class="mvp-kpi-card ${card.tone}">
          <span>${escapeHtml(card.label)}</span>
          <b>${escapeHtml(card.value)}</b>
          <em>${escapeHtml(card.note)}</em>
        </div>
      `).join('')}
    </div>
  `;
}

function renderModernMetricCards(row) {
  if (!row) return '';
  const rows = METRICS
    .map((metric, idx) => ({ metric, value: Number(row.metrics[idx]) || 0 }))
    .filter(item => item.metric.type !== 'score')
    .slice(0, 8);

  return `
    <div class="mvp-card mvp-progress-card">
      <div class="mvp-card-head">
        <div>
          <span>Показатели недели</span>
          <h3>${escapeHtml(row.name)}</h3>
        </div>
        <b>${fmtPts(row.points)} баллов</b>
      </div>
      <div class="mvp-progress-list">
        ${rows.length ? rows.map(({ metric, value }) => {
          const target = getMetricTarget(metric);
          const width = metric.type === 'penalty'
            ? (value > 0 ? clampValue(value * 8, 8, 100) : 3)
            : clampValue((value / Math.max(1, target || 100)) * 100, 0, 100);
          const tone = getMetricTone(metric, value, target);
          const targetText = metric.type === 'penalty' ? 'цель: 0' : `цель: ${fmtPts(target)}`;
          return `
            <div class="mvp-progress-row ${tone}">
              <div>
                <b>${escapeHtml(metric.label)}</b>
                <span>${escapeHtml(targetText)}</span>
              </div>
              <em>${escapeHtml(formatMetricValue(value, metric))}</em>
              <i><span style="width:${Math.round(width)}%"></span></i>
            </div>
          `;
        }).join('') : '<div class="mvp-empty-line">Показатели появятся после загрузки данных.</div>'}
      </div>
    </div>
  `;
}

function renderModernTopBars(ranking) {
  const rows = ranking.slice(0, 10);
  const max = Math.max(1, ...rows.map(row => Number(row.points) || 0));
  return `
    <div class="mvp-card">
      <div class="mvp-card-head">
        <div>
          <span>Рейтинг</span>
          <h3>Топ операторов</h3>
        </div>
        <b>${rows.length}</b>
      </div>
      <div class="mvp-bar-list">
        ${rows.length ? rows.map(row => `
          <div class="mvp-bar-row ${row.rank <= 3 ? 'top' : ''}">
            <span>#${row.rank}</span>
            <b>${escapeHtml(row.name)}</b>
            <i><span style="width:${Math.round((row.points / max) * 100)}%"></span></i>
            <em>${fmtPts(row.points)}</em>
          </div>
        `).join('') : '<div class="mvp-empty-line">Нет операторов для рейтинга.</div>'}
      </div>
    </div>
  `;
}

function renderModernDailyChart(row) {
  const daily = row ? getOperatorDailySummary(row) : null;
  const items = [
    { label: 'Рабочих дней', value: daily?.activeDays || 0, max: 31 },
    { label: 'Факт часов', value: daily?.totalFact || 0, max: Math.max(1, daily?.totalFact || 0, daily?.totalEffective || 0) },
    { label: 'Эфф. часов', value: daily?.totalEffective || 0, max: Math.max(1, daily?.totalFact || 0, daily?.totalEffective || 0) },
    { label: 'Прогресс', value: Math.max(0, daily?.progress || 0), max: 10 },
  ];
  return `
    <div class="mvp-card">
      <div class="mvp-card-head">
        <div>
          <span>Период</span>
          <h3>Работа по датам</h3>
        </div>
        <b>${escapeHtml(getSeasonPeriodLabel())}</b>
      </div>
      <div class="mvp-mini-chart">
        ${items.map(item => `
          <div class="mvp-mini-bar">
            <span>${escapeHtml(item.label)}</span>
            <i><span style="height:${Math.round(clampValue((item.value / Math.max(1, item.max)) * 100, 4, 100))}%"></span></i>
            <b>${fmtPts(item.value)}</b>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderModernTopThree(states) {
  const top = states.slice().sort((a, b) => (b.row.points - a.row.points) || (b.weekCoins - a.weekCoins)).slice(0, 3);
  return `
    <div class="mvp-card">
      <div class="mvp-card-head">
        <div>
          <span>Лидеры</span>
          <h3>Топ-3 недели</h3>
        </div>
      </div>
      <div class="mvp-top-three">
        ${top.length ? top.map((state, idx) => `
          <div class="mvp-top-card place-${idx + 1}">
            <span>#${idx + 1}</span>
            <b>${escapeHtml(state.row.name)}</b>
            <em>${escapeHtml(state.row.faculty.name)}</em>
            <strong>${fmtPts(state.row.points)} баллов</strong>
            <small>${state.weekCoins} коинов</small>
          </div>
        `).join('') : '<div class="mvp-empty-line">Нет данных для топа.</div>'}
      </div>
    </div>
  `;
}

function renderModernRatingTable(states, selected) {
  const rows = states.slice(0, 18).map(state => `
    <tr class="${selected && selected.nameKey === state.row.nameKey ? 'current' : ''}">
      <td>${state.row.rank}</td>
      <td><b>${escapeHtml(state.row.name)}</b><small>${escapeHtml(state.row.faculty.name)}</small></td>
      <td>${fmtPts(state.row.points)}</td>
      <td>${state.weekCoins}</td>
      <td>${state.balance}</td>
      <td>${state.row.rank <= 3 ? 'рост' : state.row.points > 0 ? 'активен' : '-'}</td>
    </tr>
  `).join('');

  return `
    <div class="mvp-card mvp-table-card">
      <div class="mvp-card-head">
        <div>
          <span>Индивидуально</span>
          <h3>Компактный рейтинг</h3>
        </div>
        <b>${states.length} операторов</b>
      </div>
      <div class="mvp-table-wrap">
        <table class="mvp-table">
          <thead>
            <tr><th>#</th><th>Оператор</th><th>Баллы</th><th>Неделя</th><th>Баланс</th><th>Статус</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6">Нет данных</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderModernRules() {
  return `
    <div class="mvp-card mvp-rules-card">
      <div class="mvp-card-head">
        <div>
          <span>Правила</span>
          <h3>Как начисляются коины</h3>
        </div>
        <b>${getIcoreCoinRate()}:1</b>
      </div>
      <div class="mvp-rule-grid">
        <div><b>Баллы</b><span>${getIcoreCoinRate()} баллов дают 1 коин.</span></div>
        <div><b>Топ недели</b><span>За первые 3 места добавляется бонус.</span></div>
        <div><b>Дисциплина</b><span>Неделя без опозданий и сайтов дает дополнительные коины.</span></div>
        <div><b>Магазин</b><span>Заявка резервирует коины до решения администратора.</span></div>
      </div>
    </div>
  `;
}

function renderModernDashboard() {
  const el = document.getElementById('overview-view');
  if (!el) return;
  const ranking = getOperatorRanking();
  const selected = getSelectedVisualOperator(ranking);
  const states = getIcoreStates(ranking);
  const selectedState = selected ? getIcoreOperatorState(selected, ranking) : null;
  const average = ranking.length ? ranking.reduce((sum, row) => sum + row.points, 0) / ranking.length : 0;
  const activeCount = ranking.filter(row => row.points > 0).length;

  if (!ranking.length) {
    el.innerHTML = `
      <div class="mvp-dashboard empty">
        <div class="mvp-hero-panel">
          <div>
            <span>iCore Contest</span>
            <h1>Дашборд операторов</h1>
            <p>Загрузите Excel или добавьте операторов, чтобы увидеть рейтинг, коины, магазин и управление.</p>
          </div>
        </div>
      </div>
    `;
    syncModernRoleUi();
    return;
  }

  el.innerHTML = `
    <div class="mvp-dashboard">
      <div class="mvp-hero-panel">
        <div>
          <span>iCore Contest</span>
          <h1>Дашборд операторов</h1>
          <p>Рейтинг, баланс коинов, недельные показатели, топы и быстрые действия в одном рабочем экране.</p>
        </div>
        <div class="mvp-hero-side">
          ${renderModernOperatorSelect(ranking)}
          <div class="mvp-hero-meta">
            <span>Период: ${escapeHtml(getSeasonPeriodLabel())}</span>
            <span>Обновлено: ${escapeHtml(getModernUpdatedLabel())}</span>
            <span>Роль: ${escapeHtml(getModernRoleLabel())}</span>
          </div>
        </div>
      </div>

      ${renderModernKpis(selected, selectedState, ranking, states)}

      <div class="mvp-dashboard-grid">
        ${renderModernMetricCards(selected)}
        ${renderModernTopBars(ranking)}
        ${renderModernDailyChart(selected)}
        ${renderModernTopThree(states)}
      </div>

      <div class="mvp-quick-actions">
        <button type="button" data-icore-view="shop">Открыть магазин</button>
        ${isAdmin ? '<button type="button" data-icore-view="admin">Перейти в управление</button>' : ''}
        <span>${activeCount} активных из ${ranking.length}, средний балл ${fmtPts(average)}</span>
      </div>

      ${renderModernRatingTable(states, selected)}
      ${renderModernRules()}
    </div>
  `;
  syncModernRoleUi();
}

/* ── Admin ──────────────────────────────────────────────────── */
function loadAdminSession() {
  loadAuthSession();
}

function updateAdminGate() {
  const btn = document.getElementById('admin-gate-btn');
  const login = document.getElementById('admin-login-area');
  const active = document.getElementById('admin-active-area');
  const err = document.getElementById('admin-error');
  if (btn) btn.classList.toggle('unlocked', isAdmin);
  if (login) login.hidden = isAdmin;
  if (active) active.hidden = !isAdmin;
  if (err) err.textContent = '';
  if (typeof syncModernRoleUi === 'function') syncModernRoleUi();
}

function openAdminModal() {
  const p = document.getElementById('admin-popover');
  if (!p) return;
  updateAdminGate(); p.hidden = false;
  if (!isAdmin) { const i = document.getElementById('admin-login'); if (i) setTimeout(() => i.focus(), 0); }
}
function closeAdminModal() { const p = document.getElementById('admin-popover'); if (p) p.hidden = true; }
function requireAdmin() { if (isAdmin) return true; openAdminModal(); return false; }

async function loginAdmin() {
  const input = document.getElementById('admin-password');
  const error = document.getElementById('admin-error');
  const btn = document.querySelector('.admin-popover-submit');
  const pwd = input ? input.value : '';
  if (!pwd) { if (error) error.textContent = 'Введите пароль'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Проверка…'; }
  if (error) error.textContent = '';
  try {
    const ok = await api.verifyPassword(pwd);
    if (!ok) { if (error) error.textContent = 'Неверный пароль'; if (input) input.value = ''; return; }
    isAdmin = true;
    sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
    sessionStorage.setItem(ADMIN_PASSWORD_KEY, pwd);
    closeAdminModal(); updateAdminGate();
    await refreshDashboard();
    renderEditor();
    const editorPanel = document.getElementById('editor-panel');
    if (editorPanel) editorPanel.hidden = false;
  } catch (err) {
    if (error) error.textContent = 'Сервер недоступен';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Войти'; }
  }
}

function logoutAdmin() {
  isAdmin = false;
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
  closeAdminModal(); updateAdminGate(); renderEditor();
  const editorPanel = document.getElementById('editor-panel');
  if (editorPanel) editorPanel.hidden = true;
  renderModernDashboard();
  renderIcoreAdmin();
}

/* ── Data calculations ──────────────────────────────────────── */
async function loginAdmin() {
  const loginInput = document.getElementById('admin-login');
  const passwordInput = document.getElementById('admin-password');
  const error = document.getElementById('admin-error');
  const btn = document.querySelector('.admin-popover-submit');
  const login = String(loginInput?.value || '').trim();
  const password = String(passwordInput?.value || '');
  if (!login || !password) {
    if (error) error.textContent = 'Введите логин и пароль';
    (login ? passwordInput : loginInput)?.focus();
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Проверка...'; }
  if (error) error.textContent = '';
  try {
    const result = await api.login(login, password);
    applyAuthSession(result);
    if (!isAdmin) {
      applyAuthSession(null);
      if (error) error.textContent = 'У этого аккаунта нет прав администратора';
      return;
    }
    closeAdminModal();
    updateAdminGate();
    await refreshDashboard();
    renderEditor();
    const editorPanel = document.getElementById('editor-panel');
    if (editorPanel) editorPanel.hidden = false;
    window.showContestSection?.('admin');
  } catch (err) {
    applyAuthSession(null);
    if (error) error.textContent = err.message || 'Не удалось войти';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Войти'; }
  }
}

async function logoutAdmin() {
  try { await api.logout(); } catch {}
  applyAuthSession(null);
  closeAdminModal();
  updateAdminGate();
  renderEditor();
  const editorPanel = document.getElementById('editor-panel');
  if (editorPanel) editorPanel.hidden = true;
  renderModernDashboard();
  renderIcoreAdmin();
}

function calcTotals() {
  return FACULTIES.map((fac, fi) =>
    fac.operators.map((name, oi) => {
      const row = WEEKLY_DATA[0]?.[fi]?.[oi] || [];
      return {
        name,
        pts: calculateOperatorScore(row),
      };
    })
  );
}

function getFacultyTotal(facIdx) {
  const rows = FACULTIES[facIdx]?.operators?.map((_, oi) => WEEKLY_DATA[0]?.[facIdx]?.[oi] || []) ?? [];
  const scores = rows.map(row => calculateOperatorScore(row)).filter(v => v !== 0);
  if (scores.length === 0) return 0;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

/* ── Visual Dashboard ──────────────────────────────────────── */
function operatorVisualKey(facIdx, opIdx) {
  return `${facIdx}:${opIdx}`;
}

function getOperatorRanking() {
  const rows = [];

  FACULTIES.forEach((fac, facIdx) => {
    (fac.operators || []).forEach((name, opIdx) => {
      const metricRow = WEEKLY_DATA[0]?.[facIdx]?.[opIdx] || [];
      rows.push({
        key: operatorVisualKey(facIdx, opIdx),
        name,
        nameKey: normalizeOperatorName(name),
        facIdx,
        opIdx,
        faculty: fac,
        metrics: metricRow,
        points: calculateOperatorScore(metricRow),
      });
    });
  });

  rows.sort((a, b) => (b.points - a.points) || a.name.localeCompare(b.name, 'ru'));
  rows.forEach((row, idx) => { row.rank = idx + 1; });
  return rows;
}

function getSelectedVisualOperator(ranking) {
  if (!ranking.length) return null;
  const sessionRow = !isAdmin ? getOperatorSessionRow(ranking) : null;
  if (sessionRow) {
    visualOperatorKey = sessionRow.key;
    try { localStorage.setItem(VISUAL_OPERATOR_STORAGE_KEY, sessionRow.key); } catch {}
    return sessionRow;
  }
  let selected = ranking.find(row => row.key === visualOperatorKey);
  if (!selected) selected = ranking.find(row => row.points > 0) || ranking[0];
  visualOperatorKey = selected.key;
  try { localStorage.setItem(VISUAL_OPERATOR_STORAGE_KEY, selected.key); } catch {}
  return selected;
}

function getIcoreCoinRate() {
  return Math.max(1, Number(GAMIFICATION?.settings?.coinRate) || 5);
}

function getIcoreBaseCoins(row) {
  return Math.floor(Math.max(0, Number(row?.points) || 0) / getIcoreCoinRate());
}

function getIcoreLateValue(row) {
  return getMetricValue(row?.metrics || [], ['опозд']);
}

function getIcoreSiteValue(row) {
  return getMetricValue(row?.metrics || [], ['сайт']);
}

function getIcoreNominations(ranking = []) {
  const active = ranking.filter(row => row.points > 0);
  const nominations = [];
  const used = new Set();

  function addNomination(id, title, row, value) {
    if (!row || !row.nameKey) return;
    nominations.push({ id, title, row, value });
    used.add(`${id}:${row.nameKey}`);
  }

  function bestMetric(id, title, aliases, suffix = '') {
    if (!hasMetric(aliases)) return;
    const rows = active
      .map(row => ({ row, value: getMetricValue(row.metrics, aliases) }))
      .filter(item => item.value > 0)
      .sort((a, b) => (b.value - a.value) || (b.row.points - a.row.points) || a.row.name.localeCompare(b.row.name, 'ru'));
    if (rows[0]) addNomination(id, title, rows[0].row, `${fmtPts(rows[0].value)}${suffix}`);
  }

  bestMetric('calls', 'Лучший по звонкам', ['квз', 'звон'], '');
  bestMetric('quality', 'Лучшее качество', ['качество'], '%');
  bestMetric('efficiency', 'Топ по эффективности', ['эфф'], '%');
  bestMetric('thanks', 'Больше всего благодарностей', ['благодар'], '');

  const progressLeader = getProgressRanking(active)[0];
  if (progressLeader && progressLeader.progress > 0) addNomination('progress', 'Лучший прогресс недели', progressLeader, `+${fmtPts(progressLeader.progress)}`);

  const disciplineLeader = active
    .filter(row => getIcoreLateValue(row) <= 0)
    .sort((a, b) => (getIcoreSiteValue(a) - getIcoreSiteValue(b)) || (b.points - a.points) || a.name.localeCompare(b.name, 'ru'))[0];
  if (disciplineLeader) addNomination('discipline', 'Без опозданий', disciplineLeader, '0 мин');

  return nominations.filter((item, idx, arr) =>
    arr.findIndex(other => other.id === item.id && other.row.nameKey === item.row.nameKey) === idx
  ).slice(0, 6);
}

function getIcoreManualEntries(operatorKey) {
  return (GAMIFICATION.manualLedger || []).filter(item => item.operatorKey === operatorKey);
}

function getIcoreRequests(operatorKey) {
  return (GAMIFICATION.requests || []).filter(item => item.operatorKey === operatorKey);
}

function getIcoreOperatorState(row, ranking = []) {
  const nominations = getIcoreNominations(ranking).filter(item => item.row.nameKey === row.nameKey);
  const baseCoins = getIcoreBaseCoins(row);
  const topBonus = row.rank === 1 ? 15 : row.rank === 2 ? 10 : row.rank === 3 ? 7 : 0;
  const lateBonus = row.points > 0 && getIcoreLateValue(row) <= 0 ? 5 : 0;
  const siteBonus = row.points > 0 && getIcoreSiteValue(row) <= 0 ? 3 : 0;
  const nominationBonus = nominations.length * 5;
  const weekCoins = baseCoins + topBonus + lateBonus + siteBonus + nominationBonus;
  const manualEntries = getIcoreManualEntries(row.nameKey);
  const manualTotal = manualEntries.reduce((sum, item) => sum + item.amount, 0);
  const manualEarned = manualEntries.filter(item => item.amount > 0).reduce((sum, item) => sum + item.amount, 0);
  const requests = getIcoreRequests(row.nameKey);
  const reserved = requests.filter(item => item.status === 'new').reduce((sum, item) => sum + item.price, 0);
  const spent = requests.filter(item => item.status === 'approved' || item.status === 'done').reduce((sum, item) => sum + item.price, 0);
  const totalEarned = weekCoins + manualEarned;
  const balance = Math.max(0, weekCoins + manualTotal - reserved - spent);

  return {
    row,
    baseCoins,
    topBonus,
    lateBonus,
    siteBonus,
    nominationBonus,
    nominations,
    weekCoins,
    manualEntries,
    manualTotal,
    requests,
    reserved,
    spent,
    totalEarned,
    balance,
  };
}

function getIcoreStates(ranking = getOperatorRanking()) {
  return ranking.map(row => getIcoreOperatorState(row, ranking));
}

function getSelectedIcoreState(ranking = getOperatorRanking()) {
  const selected = getSelectedVisualOperator(ranking);
  return selected ? getIcoreOperatorState(selected, ranking) : null;
}

function formatIcoreDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function setVisualMode(mode) {
  visualMode = mode === 'personal' ? 'personal' : 'overview';
  try { localStorage.setItem(VISUAL_MODE_STORAGE_KEY, visualMode); } catch {}
  renderModernDashboard();
  renderVisualDashboard();
  renderGameDashboard();
  renderIcoreCabinet();
  renderIcoreShop();
  renderIcoreAdmin();
}

function selectVisualOperator(value) {
  if (!isAdmin) {
    const row = getOperatorSessionRow();
    if (!row) {
      showOperatorLogin();
      return;
    }
    value = row.key;
  }
  visualOperatorKey = String(value || '');
  try { localStorage.setItem(VISUAL_OPERATOR_STORAGE_KEY, visualOperatorKey); } catch {}
  visualMode = 'personal';
  try { localStorage.setItem(VISUAL_MODE_STORAGE_KEY, visualMode); } catch {}
  renderModernDashboard();
  renderVisualDashboard();
  renderGameDashboard();
  renderIcoreCabinet();
  renderIcoreShop();
  renderIcoreAdmin();
}

function getRankTone(row, total) {
  if (!row || !total) return 'neutral';
  if (row.rank <= 3) return 'good';
  if (row.rank <= Math.ceil(total * 0.65)) return 'mid';
  return 'risk';
}

function getContestStatus(row, ranking, gapToNext) {
  if (!row) return { label: 'Нет данных', tone: 'neutral' };
  const total = ranking.length || 1;
  const topThird = Math.ceil(total * 0.34);
  const midLine = Math.ceil(total * 0.68);
  const leaderPoints = ranking[0]?.points || 0;
  const closeGap = Math.max(8, leaderPoints * 0.04);

  if (row.rank === 1) return { label: 'Лидер', tone: 'good' };
  if (row.rank <= 3) return { label: 'В топ-3', tone: 'good' };
  if (gapToNext > 0 && gapToNext <= closeGap) return { label: 'Догоняет', tone: 'good' };
  if (row.rank <= topThird) return { label: 'Рядом с лидерами', tone: 'info' };
  if (row.rank <= midLine) return { label: 'Средняя зона', tone: 'mid' };
  if (row.rank <= total - 2) return { label: 'Зона риска', tone: 'risk' };
  return { label: 'Сильно отстает', tone: 'risk' };
}

function isAutoMetric(metric) {
  const label = normalizeOperatorName(metric.label);
  return label.includes('выработ') || label.includes('эфф');
}

function getMetricAverages(ranking) {
  return METRICS.map((metric, metricIdx) => {
    if (metric.type === 'score') return 0;
    const values = ranking.map(row => Number(row.metrics[metricIdx]) || 0);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  });
}

function getOperatorInsight(row, ranking) {
  if (!row || !ranking.length) return 'Данные появятся после добавления операторов и баллов.';
  const averages = getMetricAverages(ranking);
  let weak = null;
  let strong = null;

  METRICS.forEach((metric, metricIdx) => {
    if (metric.type === 'score') return;
    const value = Number(row.metrics[metricIdx]) || 0;
    const avg = averages[metricIdx] || 0;
    let delta = 0;
    if (metric.type === 'penalty') {
      delta = value - avg;
      if (delta > (weak?.delta || 0)) weak = { label: metric.label, delta };
      if (-delta > (strong?.delta || 0)) strong = { label: metric.label, delta: -delta };
    } else {
      delta = avg - value;
      if (delta > (weak?.delta || 0)) weak = { label: metric.label, delta };
      if (-delta > (strong?.delta || 0)) strong = { label: metric.label, delta: -delta };
    }
  });

  if (row.rank <= 5 && weak) return `Вы входите в топ-5, ближайшая зона роста — ${weak.label}.`;
  if (weak && strong) return `Сильная сторона: ${strong.label}. Основное отставание: ${weak.label}.`;
  if (weak) return `Основное отставание сейчас по показателю «${weak.label}».`;
  return 'Показатели ровные: явной просадки относительно группы нет.';
}

/* ── Game season ───────────────────────────────────────────── */
function getDailyImportData() {
  return DAILY_IMPORT_DATA || readStoredDailyImport();
}

function formatSeasonDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function getSeasonPeriodLabel() {
  const data = getDailyImportData();
  if (data?.period) return data.period;
  return `${formatSeasonDate(GAME_SEASON.startDate)} - ${formatSeasonDate(GAME_SEASON.endDate)}`;
}

function getSeasonDaysLeft() {
  const end = new Date(`${GAME_SEASON.endDate}T23:59:59`);
  if (Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
}

function getOperatorDailySummary(row) {
  const data = getDailyImportData();
  const dates = data?.operators?.[row?.nameKey]?.dates || [];
  const activeDates = dates.filter(day => (Number(day.actualFact) || 0) > 0 || (Number(day.effectiveHours) || 0) > 0);
  const totalFact = activeDates.reduce((sum, day) => sum + (Number(day.actualFact) || 0), 0);
  const totalEffective = activeDates.reduce((sum, day) => sum + (Number(day.effectiveHours) || 0), 0);
  const first = activeDates[0];
  const last = activeDates[activeDates.length - 1];
  const firstScore = first ? ((Number(first.actualFact) || 0) + (Number(first.effectiveHours) || 0)) / 2 : 0;
  const lastScore = last ? ((Number(last.actualFact) || 0) + (Number(last.effectiveHours) || 0)) / 2 : 0;

  return {
    activeDays: activeDates.length,
    totalFact,
    totalEffective,
    averageFact: activeDates.length ? totalFact / activeDates.length : 0,
    averageEffective: activeDates.length ? totalEffective / activeDates.length : 0,
    progress: activeDates.length > 1 ? roundScoreValue(lastScore - firstScore) : 0,
  };
}

function getOperatorProgressValue(row) {
  const daily = getOperatorDailySummary(row);
  if (daily.activeDays > 1) return daily.progress;

  const quality = getMetricValue(row.metrics, ['качество']);
  const work = getMetricValue(row.metrics, ['выработ']);
  const efficiency = getMetricValue(row.metrics, ['эфф']);
  const fallback = Math.max(0, (quality - 85) * 0.06)
    + Math.max(0, (work - 85) * 0.05)
    + Math.max(0, (efficiency - GAME_SEASON.efficiencyTarget) * 0.08);
  return roundScoreValue(fallback);
}

function getProgressRanking(ranking) {
  return ranking.map(row => ({
    ...row,
    progress: getOperatorProgressValue(row),
  })).sort((a, b) => (b.progress - a.progress) || (b.points - a.points) || a.name.localeCompare(b.name, 'ru'));
}

function getMetricRanking(ranking, aliases) {
  if (!hasMetric(aliases)) return [];
  return ranking.map(row => ({
    ...row,
    metricValue: getMetricValue(row.metrics, aliases),
  })).sort((a, b) => (b.metricValue - a.metricValue) || (b.points - a.points) || a.name.localeCompare(b.name, 'ru'));
}

function getMissionDefinitions() {
  const definitions = [
    {
      id: 'quality',
      title: 'Чистая линия',
      label: 'Качество 90%+',
      target: 90,
      unit: '%',
      value: row => getMetricValue(row.metrics, ['качество']),
    },
    {
      id: 'work',
      title: 'Рабочий ритм',
      label: 'Выработка 100%+',
      target: 100,
      unit: '%',
      value: row => getMetricValue(row.metrics, ['выработ']),
    },
    {
      id: 'efficiency',
      title: 'Эффективный ритм',
      label: `Эффективность ${GAME_SEASON.efficiencyTarget}%+`,
      target: GAME_SEASON.efficiencyTarget,
      unit: '%',
      value: row => getMetricValue(row.metrics, ['эфф']),
    },
    {
      id: 'discipline',
      title: 'Без штрафов',
      label: '0 опозданий, нарушений и сайтов',
      target: 0,
      unit: '',
      reverse: true,
      value: row => getPenaltyTotal(row.metrics),
    },
    {
      id: 'team',
      title: 'Групповой рывок',
      label: 'Средний балл группы 85+',
      target: 85,
      unit: '',
      value: row => getFacultyTotal(row.facIdx),
    },
  ];

  if (hasMetric(['квз', 'звон'])) {
    definitions.splice(3, 0, {
      id: 'kvz',
      title: 'Испытание Бесстрашия',
      label: `КВЗ ${GAME_SEASON.kvzTarget}+`,
      target: GAME_SEASON.kvzTarget,
      unit: '',
      value: row => getMetricValue(row.metrics, ['квз', 'звон']),
    });
  }

  if (hasMetric(['мисси', 'доп'])) {
    definitions.push({
      id: 'mission-points',
      title: 'Дополнительная миссия',
      label: `Доп. баллы ${GAME_SEASON.maxMissionScore}+`,
      target: GAME_SEASON.maxMissionScore,
      unit: '',
      value: row => getMetricValue(row.metrics, ['мисси', 'доп']),
    });
  }

  return definitions;
}

function getOperatorMissionResults(row) {
  return getMissionDefinitions().map(mission => {
    const value = Number(mission.value(row)) || 0;
    const completed = mission.reverse ? value <= mission.target : value >= mission.target;
    const progress = mission.reverse
      ? (completed ? 100 : clampValue(100 - (value - mission.target) * 14, 0, 100))
      : clampValue((value / Math.max(1, mission.target)) * 100, 0, 100);
    return { ...mission, value, completed, progress };
  });
}

function getOperatorGameState(row, ranking = []) {
  const quality = getMetricValue(row.metrics, ['качество']);
  const work = getMetricValue(row.metrics, ['выработ']);
  const efficiency = getMetricValue(row.metrics, ['эфф']);
  const kvz = getMetricValue(row.metrics, ['квз', 'звон']);
  const missionValue = getMetricValue(row.metrics, ['мисси', 'доп']);
  const penalties = getPenaltyTotal(row.metrics);
  const progress = getOperatorProgressValue(row);
  const missionResults = getOperatorMissionResults(row);
  const completedMissions = missionResults.filter(mission => mission.completed).length;
  const progressLeader = getProgressRanking(ranking)[0];

  let coins = Math.max(0, Math.round(row.points));
  if (quality >= 90) coins += 20;
  if (quality >= 98) coins += 20;
  if (work >= 100) coins += 15;
  if (efficiency >= GAME_SEASON.efficiencyTarget) coins += 15;
  if (hasMetric(['квз', 'звон']) && kvz >= GAME_SEASON.kvzTarget) coins += 15;
  if (penalties === 0 && row.points > 0) coins += 10;
  coins += completedMissions * 12;
  coins += Math.min(50, Math.max(0, Math.round(missionValue)));
  coins += Math.min(30, Math.max(0, Math.round(progress * 3)));

  const level = clampValue(Math.floor(coins / 150) + 1, 1, 5);
  const levelNames = ['Новичок линии', 'Стабильный оператор', 'Мастер консультаций', 'Лидер смены', 'Легенда линии'];
  const currentLevelFloor = (level - 1) * 150;
  const nextLevelFloor = level >= 5 ? 0 : level * 150;
  const levelProgress = level >= 5 ? 100 : clampValue(((coins - currentLevelFloor) / 150) * 100, 0, 100);

  const achievements = [];
  if (row.rank === 1) achievements.push('Лидер сезона');
  if (quality >= 98) achievements.push('Безупречная консультация');
  else if (quality >= 90) achievements.push('Серия качества');
  if (penalties === 0 && row.points > 0) achievements.push('Железная дисциплина');
  if (work >= 100) achievements.push('Стабильный темп');
  if (efficiency >= GAME_SEASON.efficiencyTarget) achievements.push('Эффективный ритм');
  if (progressLeader?.key === row.key && progressLeader.progress > 0) achievements.push('Лучший прогресс');
  if (progress >= 2 && row.rank > Math.ceil((ranking.length || 1) * 0.4)) achievements.push('Камбэк недели');
  if (completedMissions >= Math.min(4, missionResults.length)) achievements.push('Мастер миссий');

  return {
    coins,
    level,
    levelName: levelNames[level - 1] || levelNames[0],
    levelProgress,
    nextLevelFloor,
    quality,
    work,
    efficiency,
    kvz,
    missionValue,
    penalties,
    progress,
    missionResults,
    completedMissions,
    achievements: achievements.slice(0, 8),
  };
}

function renderGameMiniRanking(title, rows, valueFormatter) {
  const visibleRows = rows.slice(0, 5);
  return `
    <div class="game-mini-ranking">
      <div class="game-mini-title">${escapeHtml(title)}</div>
      <div class="game-mini-list">
        ${visibleRows.length ? visibleRows.map((row, idx) => `
          <div class="game-mini-row">
            <span>#${idx + 1}</span>
            <b>${escapeHtml(row.name)}</b>
            <em>${escapeHtml(valueFormatter(row))}</em>
          </div>
        `).join('') : '<div class="game-empty-line">Нет данных</div>'}
      </div>
    </div>
  `;
}

function renderGameDashboard() {
  const el = document.getElementById('game-dashboard');
  if (!el) return;

  const ranking = getOperatorRanking();
  if (!ranking.length) {
    el.innerHTML = `
      <div class="game-shell empty">
        <div class="game-season-head">
          <div>
            <div class="section-kicker">Бонусы</div>
            <h2 class="section-title">${escapeHtml(GAME_SEASON.title)}</h2>
          </div>
          <span>${escapeHtml(getSeasonPeriodLabel())}</span>
        </div>
        <div class="visual-empty-note">Добавьте операторов и KPI, чтобы появились миссии, коины, магазин и достижения.</div>
      </div>
    `;
    return;
  }

  const selected = getSelectedVisualOperator(ranking);
  const selectedState = getOperatorGameState(selected, ranking);
  const states = ranking.map(row => getOperatorGameState(row, ranking));
  const activeOperators = ranking.filter(row => row.points > 0).length;
  const averageCoins = states.length ? states.reduce((sum, state) => sum + state.coins, 0) / states.length : 0;
  const allMissionResults = ranking.flatMap(row => getOperatorMissionResults(row));
  const completedMissionCount = allMissionResults.filter(mission => mission.completed).length;
  const missionCompletion = allMissionResults.length ? Math.round(completedMissionCount / allMissionResults.length * 100) : 0;
  const topReward = GAME_REWARDS.find(reward => selectedState.coins >= reward.price);
  const badges = selectedState.achievements.length
    ? selectedState.achievements.map(title => `<span class="game-badge">${escapeHtml(title)}</span>`).join('')
    : '<span class="game-badge muted">Бейджи появятся после выполнения миссий</span>';

  const missionRows = selectedState.missionResults.map(mission => `
    <div class="game-mission ${mission.completed ? 'done' : ''}">
      <div>
        <b>${escapeHtml(mission.title)}</b>
        <span>${escapeHtml(mission.label)}</span>
      </div>
      <div class="game-mission-side">
        <em>${fmtPts(mission.value)}${escapeHtml(mission.unit)}</em>
        <i>${mission.completed ? 'готово' : `${Math.round(mission.progress)}%`}</i>
      </div>
      <div class="game-mission-track" aria-hidden="true">
        <span style="width:${Math.round(mission.progress)}%"></span>
      </div>
    </div>
  `).join('');

  const shopRows = GAME_REWARDS.map(reward => {
    const available = selectedState.coins >= reward.price;
    const missing = Math.max(0, reward.price - selectedState.coins);
    return `
      <div class="game-shop-item ${available ? 'available' : ''}">
        <div>
          <b>${escapeHtml(reward.title)}</b>
          <span>${escapeHtml(reward.tag)}</span>
        </div>
        <em>${reward.price} ${escapeHtml(GAME_SEASON.currency)}</em>
        <small>${available ? 'доступно' : `еще ${missing}`}</small>
      </div>
    `;
  }).join('');

  const teamRows = FACULTIES.map((fac, facIdx) => ({
    ...fac,
    avgTotal: getFacultyTotal(facIdx),
    active: (fac.operators || []).filter((_, opIdx) => calculateOperatorScore(WEEKLY_DATA[0]?.[facIdx]?.[opIdx] || []) > 0).length,
  })).sort((a, b) => b.avgTotal - a.avgTotal);

  const progressRows = getProgressRanking(ranking);
  const qualityRows = getMetricRanking(ranking, ['качество']);
  const disciplineRows = ranking.map(row => ({
    ...row,
    penaltyValue: getPenaltyTotal(row.metrics),
  })).sort((a, b) => (a.penaltyValue - b.penaltyValue) || (b.points - a.points) || a.name.localeCompare(b.name, 'ru'));

  el.innerHTML = `
    <div class="game-shell">
      <div class="game-season-head">
        <div>
          <div class="section-kicker">Бонусы</div>
          <h2 class="section-title">${escapeHtml(GAME_SEASON.title)}</h2>
          <p>${escapeHtml(GAME_SEASON.theme)}: миссии, коины, бейджи и магазин наград.</p>
        </div>
        <div class="game-season-meta">
          <span>${escapeHtml(getSeasonPeriodLabel())}</span>
          <b>${getSeasonDaysLeft()} дн. до финала</b>
        </div>
      </div>

      <div class="game-kpi-grid">
        <div class="game-stat"><span>Активные операторы</span><b>${activeOperators}</b><em>в рейтинге сезона</em></div>
        <div class="game-stat"><span>Средние коины</span><b>${fmtPts(averageCoins)}</b><em>на участника</em></div>
        <div class="game-stat"><span>Миссии выполнены</span><b>${missionCompletion}%</b><em>${completedMissionCount} из ${allMissionResults.length}</em></div>
        <div class="game-stat"><span>Ближайшая награда</span><b>${topReward ? 'доступна' : 'копим'}</b><em>${topReward ? topReward.title : `${GAME_REWARDS[0].price} ${GAME_SEASON.currency}`}</em></div>
      </div>

      <div class="game-layout">
        <div class="game-panel game-operator-card">
          <div class="game-avatar ${selected.faculty.cls}">${selected.faculty.icon}</div>
          <div class="game-operator-main">
            <div class="game-panel-kicker">${escapeHtml(selected.faculty.name)} · #${selected.rank}</div>
            <h3>${escapeHtml(selected.name)}</h3>
            <div class="game-level-row">
              <span>${escapeHtml(selectedState.levelName)}</span>
              <b>${selectedState.coins} ${escapeHtml(GAME_SEASON.currency)}</b>
            </div>
            <div class="game-progress">
              <span style="width:${Math.round(selectedState.levelProgress)}%"></span>
            </div>
            <div class="game-level-note">Уровень ${selectedState.level} · ${selectedState.nextLevelFloor ? `следующий порог ${selectedState.nextLevelFloor}` : 'максимум сезона'}</div>
            <div class="game-badges">${badges}</div>
          </div>
        </div>

        <div class="game-panel">
          <div class="game-panel-head">
            <div>
              <div class="game-panel-kicker">Ежедневные и недельные задания</div>
              <h3>Миссии оператора</h3>
            </div>
            <span>${selectedState.completedMissions}/${selectedState.missionResults.length}</span>
          </div>
          <div class="game-mission-list">${missionRows}</div>
        </div>

        <div class="game-panel">
          <div class="game-panel-head">
            <div>
              <div class="game-panel-kicker">Валюта сезона</div>
              <h3>Магазин наград</h3>
            </div>
            <span>${selectedState.coins} ${escapeHtml(GAME_SEASON.currency)}</span>
          </div>
          <div class="game-shop-list">${shopRows}</div>
        </div>

        <div class="game-panel">
          <div class="game-panel-head">
            <div>
              <div class="game-panel-kicker">Средний балл активных</div>
              <h3>Командный рейтинг</h3>
            </div>
            <span>не сумма, а среднее</span>
          </div>
          <div class="game-team-list">
            ${teamRows.map((fac, idx) => `
              <div class="game-team-row ${fac.cls}">
                <span>#${idx + 1}</span>
                <b>${fac.icon} ${escapeHtml(fac.name)}</b>
                <em>${fmtPts(fac.avgTotal)}</em>
                <small>${fac.active} активных</small>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="game-ratings-grid">
        ${renderGameMiniRanking('Личный рейтинг', ranking, row => `${fmtPts(row.points)} балла`)}
        ${renderGameMiniRanking('Качество', qualityRows, row => `${fmtPts(row.metricValue)}%`)}
        ${renderGameMiniRanking('Лучший прогресс', progressRows, row => `+${fmtPts(Math.max(0, row.progress))}`)}
        ${renderGameMiniRanking('Дисциплина', disciplineRows, row => `${fmtPts(row.penaltyValue)} штрафов`)}
      </div>
    </div>
  `;
}

function renderVisualKpis(selected, ranking) {
  const selectedIdx = ranking.findIndex(row => row.key === selected.key);
  const leader = ranking[0] || selected;
  const nextHigher = selectedIdx > 0 ? ranking[selectedIdx - 1] : null;
  const nextLower = selectedIdx >= 0 ? ranking[selectedIdx + 1] : null;
  const gapToNext = nextHigher ? Math.max(0, nextHigher.points - selected.points) : 0;
  const gapToLeader = leader && selected.key !== leader.key ? Math.max(0, leader.points - selected.points) : 0;
  const leadBelow = nextLower ? Math.max(0, selected.points - nextLower.points) : 0;
  const status = getContestStatus(selected, ranking, gapToNext);
  const tone = getRankTone(selected, ranking.length);

  const cards = [
    { label: 'Место в рейтинге', value: `${selected.rank} из ${ranking.length}`, note: selected.name, tone },
    { label: 'Общий балл', value: fmtPts(selected.points), note: selected.faculty.name, tone: 'info' },
    { label: 'До следующего места', value: nextHigher ? fmtPts(gapToNext) : '0', note: nextHigher ? `До ${nextHigher.rank} места: ${nextHigher.name}` : 'Вы занимаете 1 место', tone: gapToNext <= 8 ? 'good' : 'mid' },
    { label: 'До лидера', value: fmtPts(gapToLeader), note: leader ? `Лидер: ${leader.name}` : 'Лидер не определен', tone: gapToLeader === 0 ? 'good' : 'risk' },
    { label: 'Отрыв снизу', value: nextLower ? fmtPts(leadBelow) : '—', note: nextLower ? `От ${nextLower.rank} места: ${nextLower.name}` : 'Ниже никого нет', tone: leadBelow >= 8 ? 'good' : 'mid' },
    { label: 'Статус', value: status.label, note: getOperatorInsight(selected, ranking), tone: status.tone },
  ];

  return `<div class="visual-kpis">${cards.map(card => `
    <div class="visual-kpi ${card.tone}">
      <div class="visual-kpi-label">${escapeHtml(card.label)}</div>
      <div class="visual-kpi-value">${escapeHtml(card.value)}</div>
      <div class="visual-kpi-note">${escapeHtml(card.note)}</div>
    </div>
  `).join('')}</div>`;
}

function renderRatingChart(ranking, selected) {
  const maxPoints = Math.max(1, ...ranking.map(row => row.points));
  const rows = ranking.map(row => {
    const width = Math.max(2, Math.round(row.points / maxPoints * 100));
    const isSelected = row.key === selected.key;
    const title = `${row.rank} место — ${row.name}: ${fmtPts(row.points)} балла`;
    return `
      <div class="rating-bar-row ${isSelected ? 'selected' : ''}" title="${escapeHtml(title)}">
        <div class="rating-rank">#${row.rank}</div>
        <div class="rating-name">
          <span class="rating-faculty-dot ${row.faculty.cls}"></span>
          <span>${escapeHtml(row.name)}</span>
        </div>
        <div class="rating-track">
          <div class="rating-fill ${row.faculty.cls}" style="width:${width}%"></div>
        </div>
        <div class="rating-points">${fmtPts(row.points)}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="visual-panel rating-panel">
      <div class="visual-panel-head">
        <div>
          <div class="visual-panel-kicker">Общий график рейтинга</div>
          <h3>Все операторы</h3>
        </div>
        <span>${ranking.length} участников</span>
      </div>
      <div class="rating-bars">${rows}</div>
    </div>
  `;
}

function renderGapPanels(selected, ranking) {
  const selectedIdx = ranking.findIndex(row => row.key === selected.key);
  const leader = ranking[0] || selected;
  const nextHigher = selectedIdx > 0 ? ranking[selectedIdx - 1] : null;
  const leaderPct = leader.points > 0 ? Math.min(100, Math.round(selected.points / leader.points * 100)) : 0;
  const nextPct = nextHigher && nextHigher.points > 0 ? Math.min(100, Math.round(selected.points / nextHigher.points * 100)) : 100;

  return `
    <div class="visual-panel gap-panel">
      <div class="visual-panel-head">
        <div>
          <div class="visual-panel-kicker">Отставание от лидера</div>
          <h3>${escapeHtml(leader.name)}</h3>
        </div>
        <span>${fmtPts(Math.max(0, leader.points - selected.points))} балла</span>
      </div>
      <div class="gap-scale">
        <div class="gap-scale-fill leader-gap" style="width:${leaderPct}%"></div>
      </div>
      <div class="gap-values">
        <span>Лидер: ${fmtPts(leader.points)}</span>
        <span>Выбрано: ${fmtPts(selected.points)}</span>
      </div>
    </div>
    <div class="visual-panel gap-panel">
      <div class="visual-panel-head">
        <div>
          <div class="visual-panel-kicker">До следующего места</div>
          <h3>${nextHigher ? `${nextHigher.rank} место` : 'Цель достигнута'}</h3>
        </div>
        <span>${nextHigher ? fmtPts(nextHigher.points - selected.points) : '0'} балла</span>
      </div>
      <div class="gap-scale">
        <div class="gap-scale-fill next-gap" style="width:${nextPct}%"></div>
      </div>
      <div class="gap-values">
        <span>${nextHigher ? escapeHtml(nextHigher.name) + ': ' + fmtPts(nextHigher.points) : 'Вы лидер'}</span>
        <span>Выбрано: ${fmtPts(selected.points)}</span>
      </div>
    </div>
  `;
}

function renderMetricComposition(selected) {
  const components = METRICS.map((metric, metricIdx) => ({
    metric,
    value: Number(selected.metrics[metricIdx]) || 0,
  })).filter(item => item.metric.type !== 'score');
  const maxAbs = Math.max(1, ...components.map(item => Math.abs(item.value)));

  const rows = components.map(({ metric, value }) => {
    const isPenalty = metric.type === 'penalty';
    const width = Math.max(3, Math.round(Math.abs(value) / maxAbs * 100));
    const tag = isPenalty ? 'Минус' : (isAutoMetric(metric) ? 'Авто' : 'Ручной');
    const shown = isPenalty && value > 0 ? `-${fmtPts(value)}` : fmtPts(value);
    return `
      <div class="composition-row" title="${escapeHtml(metric.label)}: ${shown}">
        <div class="composition-meta">
          <span>${escapeHtml(metric.label)}</span>
          <em class="${isPenalty ? 'negative' : ''}">${tag}</em>
        </div>
        <div class="composition-track">
          <div class="composition-fill ${isPenalty ? 'negative' : 'positive'}" style="width:${width}%"></div>
        </div>
        <div class="composition-value ${isPenalty ? 'negative' : ''}">${shown}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="visual-panel">
      <div class="visual-panel-head">
        <div>
          <div class="visual-panel-kicker">Состав баллов</div>
          <h3>${escapeHtml(selected.name)}</h3>
        </div>
        <span>Авто / ручные / минусы</span>
      </div>
      <div class="composition-list">${rows}</div>
    </div>
  `;
}

function renderLeaderComparison(selected, ranking) {
  const leader = ranking[0] || selected;
  const rows = METRICS.map((metric, metricIdx) => ({
    metric,
    selectedValue: Number(selected.metrics[metricIdx]) || 0,
    leaderValue: Number(leader.metrics[metricIdx]) || 0,
  })).filter(item => item.metric.type !== 'score').map(({ metric, selectedValue, leaderValue }) => {
    const maxValue = Math.max(1, Math.abs(selectedValue), Math.abs(leaderValue));
    const selectedWidth = Math.max(3, Math.round(Math.abs(selectedValue) / maxValue * 100));
    const leaderWidth = Math.max(3, Math.round(Math.abs(leaderValue) / maxValue * 100));
    const isPenalty = metric.type === 'penalty';
    return `
      <div class="compare-row" title="${escapeHtml(metric.label)} — выбранный: ${fmtPts(selectedValue)}, лидер: ${fmtPts(leaderValue)}">
        <div class="compare-label">${escapeHtml(metric.label)}</div>
        <div class="compare-bars">
          <div class="compare-line">
            <span>Вы</span>
            <div><i class="${isPenalty ? 'negative' : 'selected'}" style="width:${selectedWidth}%"></i></div>
            <b>${formatMetricValue(selectedValue, metric)}</b>
          </div>
          <div class="compare-line">
            <span>Лидер</span>
            <div><i class="leader" style="width:${leaderWidth}%"></i></div>
            <b>${formatMetricValue(leaderValue, metric)}</b>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="visual-panel">
      <div class="visual-panel-head">
        <div>
          <div class="visual-panel-kicker">Сравнение с лидером</div>
          <h3>${escapeHtml(leader.name)}</h3>
        </div>
        <span>${selected.key === leader.key ? 'Вы лидер' : `Разница ${fmtPts(leader.points - selected.points)}`}</span>
      </div>
      <div class="compare-list">${rows}</div>
    </div>
  `;
}

function buildDailyPolyline(days, field, maxValue) {
  if (!days.length) return '';
  const width = 360;
  const height = 112;
  const xStep = days.length > 1 ? width / (days.length - 1) : 0;
  return days.map((day, idx) => {
    const x = days.length > 1 ? idx * xStep : width / 2;
    const y = height - Math.min(1, (Number(day[field]) || 0) / maxValue) * 92 - 10;
    return `${roundSvg(x)},${roundSvg(y)}`;
  }).join(' ');
}

function roundSvg(value) {
  return Math.round(value * 10) / 10;
}

function renderDailyDynamics(selected) {
  const data = DAILY_IMPORT_DATA || readStoredDailyImport();
  const operatorDaily = data?.operators?.[selected.nameKey];

  if (!operatorDaily || !operatorDaily.dates?.length) {
    return `
      <div class="visual-panel daily-panel empty">
        <div class="visual-panel-head">
          <div>
            <div class="visual-panel-kicker">Динамика по дням</div>
            <h3>Нет дневной разбивки</h3>
          </div>
          <span>Excel</span>
        </div>
        <p class="visual-empty-note">Динамика появится после загрузки Excel-файла с выбранным периодом.</p>
      </div>
    `;
  }

  const days = operatorDaily.dates;
  const maxValue = Math.max(1, ...days.map(day => Math.max(day.actualFact, day.effectiveHours)));
  const workLine = buildDailyPolyline(days, 'actualFact', maxValue);
  const effLine = buildDailyPolyline(days, 'effectiveHours', maxValue);
  const points = days.map(day => `
    <div class="daily-point" title="${escapeHtml(day.label)}: факт ${fmtPts(day.actualFact)}, эффективность ${fmtPts(day.effectiveHours)}">
      <span>${escapeHtml(day.label.replace(/\.\d{4}$/, ''))}</span>
      <b>${fmtPts(day.actualFact)}</b>
      <em>${fmtPts(day.effectiveHours)}</em>
    </div>
  `).join('');

  return `
    <div class="visual-panel daily-panel">
      <div class="visual-panel-head">
        <div>
          <div class="visual-panel-kicker">Динамика по дням</div>
          <h3>${escapeHtml(data.period || 'Последний импорт')}</h3>
        </div>
        <span>Факт / эффективность</span>
      </div>
      <svg class="daily-line-chart" viewBox="0 0 360 120" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="112" x2="360" y2="112"></line>
        <polyline class="work" points="${workLine}"></polyline>
        <polyline class="eff" points="${effLine}"></polyline>
      </svg>
      <div class="daily-legend">
        <span><i class="work"></i> Факт часов</span>
        <span><i class="eff"></i> Эффективность</span>
      </div>
      <div class="daily-points">${points}</div>
    </div>
  `;
}

function renderIcoreOperatorSelect(ranking, label = 'Выбрать оператора') {
  const selected = getSelectedVisualOperator(ranking);
  const options = ranking.map(row => `
    <option value="${row.key}" ${selected && row.key === selected.key ? 'selected' : ''}>
      ${row.rank}. ${escapeHtml(row.name)} — ${fmtPts(row.points)}
    </option>
  `).join('');
  return `
    <label class="icore-select-wrap">
      <span>${escapeHtml(label)}</span>
      <select class="visual-operator-select" onchange="selectVisualOperator(this.value)">
        ${options}
      </select>
    </label>
  `;
}

function renderIcoreOperatorSelect(ranking, label = 'Выбрать оператора') {
  const selected = getSelectedVisualOperator(ranking);
  if (!isAdmin) {
    if (!selected || !operatorSession) {
      return `
        <div class="operator-session-card compact">
          <span>Оператор</span>
          <b>Вход не выполнен</b>
          <button type="button" onclick="showOperatorLogin()">Войти</button>
        </div>
      `;
    }
    return `
      <div class="operator-session-card compact">
        <span>${escapeHtml(label)}</span>
        <b>${escapeHtml(selected.name)}</b>
        <small>${escapeHtml(selected.faculty.name)} · #${selected.rank}</small>
        <button type="button" onclick="logoutOperator()">Выйти</button>
      </div>
    `;
  }
  const options = ranking.map(row => `
    <option value="${row.key}" ${selected && row.key === selected.key ? 'selected' : ''}>
      ${row.rank}. ${escapeHtml(row.name)} - ${fmtPts(row.points)}
    </option>
  `).join('');
  return `
    <label class="icore-select-wrap">
      <span>${escapeHtml(label)}</span>
      <select class="visual-operator-select" onchange="selectVisualOperator(this.value)">
        ${options}
      </select>
    </label>
  `;
}

function renderIcoreCabinet() {
  const el = document.getElementById('icore-cabinet');
  if (!el) return;
  const ranking = getOperatorRanking();
  if (!ranking.length) {
    el.innerHTML = `
      <div class="icore-empty">
        <div class="section-kicker">iCore · Мой кабинет</div>
        <h2 class="section-title">Нет операторов для отображения</h2>
        <p>Добавьте операторов и показатели, чтобы появился баланс коинов, история и достижения.</p>
      </div>
    `;
    return;
  }

  const state = getSelectedIcoreState(ranking);
  const row = state.row;
  const metricRows = METRICS.map((metric, idx) => ({ metric, value: Number(row.metrics[idx]) || 0 }))
    .filter(item => item.metric.type !== 'score')
    .map(({ metric, value }) => {
      const danger = metric.type === 'penalty';
      const width = danger ? clampValue(value * 4, 0, 100) : clampValue(value, 0, 100);
      return `
        <div class="icore-progress-row ${danger ? 'danger' : ''}">
          <div><b>${escapeHtml(metric.label)}</b><span>${danger ? 'Антипоказатель' : 'Показатель недели'}</span></div>
          <em>${danger && value > 0 ? '-' : ''}${fmtPts(value)}</em>
          <i><span style="width:${Math.round(width)}%"></span></i>
        </div>
      `;
    }).join('');

  const autoHistory = [
    { type: '+', amount: state.baseCoins, reason: `Перевод баллов по курсу ${getIcoreCoinRate()}:1`, date: 'Итоги недели' },
    state.topBonus ? { type: '+', amount: state.topBonus, reason: `Бонус за место #${row.rank}`, date: 'Итоги недели' } : null,
    state.lateBonus ? { type: '+', amount: state.lateBonus, reason: 'Неделя без опозданий', date: 'Итоги недели' } : null,
    state.siteBonus ? { type: '+', amount: state.siteBonus, reason: 'Неделя без посторонних сайтов', date: 'Итоги недели' } : null,
    state.nominationBonus ? { type: '+', amount: state.nominationBonus, reason: state.nominations.map(n => n.title).join(', '), date: 'Номинации' } : null,
  ].filter(Boolean);
  const manualHistory = state.manualEntries.map(item => ({
    type: item.amount >= 0 ? '+' : '-',
    amount: Math.abs(item.amount),
    reason: item.comment,
    date: formatIcoreDate(item.createdAt),
  }));
  const requestHistory = state.requests.map(item => ({
    type: item.status === 'rejected' ? '↺' : '-',
    amount: item.price,
    reason: `${item.rewardTitle} · ${ICORE_REQUEST_STATUS[item.status]}`,
    date: formatIcoreDate(item.updatedAt || item.createdAt),
  }));
  const history = [...autoHistory, ...manualHistory, ...requestHistory].slice(0, 9);
  const historyHtml = history.length ? history.map(item => `
    <div class="icore-history-row ${item.type === '-' ? 'minus' : ''}">
      <span>${escapeHtml(item.date)}</span>
      <b>${item.type}${item.amount}</b>
      <em>${escapeHtml(item.reason)}</em>
    </div>
  `).join('') : '<div class="icore-muted-line">История появится после начислений или заявок.</div>';

  const badges = [
    { title: 'Топ-3 недели', active: row.rank <= 3, hint: 'попасть в топ-3 рейтинга' },
    { title: 'Без опозданий', active: state.lateBonus > 0, hint: 'закрыть неделю без опозданий' },
    { title: 'Звезда качества', active: getMetricValue(row.metrics, ['качество']) >= 98, hint: 'качество 98%+' },
    { title: 'Легенда команды', active: state.balance >= 400, hint: `накопить ${Math.max(0, 400 - state.balance)} коинов` },
  ];
  const badgesHtml = badges.map(badge => `
    <div class="icore-badge ${badge.active ? 'active' : 'locked'}">
      <b>${escapeHtml(badge.title)}</b>
      <span>${badge.active ? 'получено' : badge.hint}</span>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="icore-head">
      <div><div class="section-kicker">iCore · Мой кабинет</div><h2 class="section-title">Баланс и прогресс оператора</h2></div>
      ${renderIcoreOperatorSelect(ranking)}
    </div>
    <div class="icore-kpi-grid">
      <div class="icore-kpi primary"><span>Текущий баланс</span><b>${state.balance}</b><em>коинов доступно</em></div>
      <div class="icore-kpi"><span>За текущую неделю</span><b>${state.weekCoins}</b><em>${fmtPts(row.points)} баллов</em></div>
      <div class="icore-kpi"><span>Место в рейтинге</span><b>#${row.rank}</b><em>из ${ranking.length}</em></div>
      <div class="icore-kpi"><span>Потрачено / резерв</span><b>${state.spent} / ${state.reserved}</b><em>по заявкам магазина</em></div>
    </div>
    <div class="icore-layout">
      <div class="icore-panel">
        <div class="icore-panel-head"><div><span>Показатели недели</span><h3>${escapeHtml(row.name)}</h3></div><b>${state.weekCoins} коинов</b></div>
        <div class="icore-progress-list">${metricRows || '<div class="icore-muted-line">Нет показателей.</div>'}</div>
      </div>
      <div class="icore-panel">
        <div class="icore-panel-head"><div><span>История</span><h3>Начисления и списания</h3></div><b>${state.totalEarned} начислено</b></div>
        <div class="icore-history-list">${historyHtml}</div>
      </div>
      <div class="icore-panel">
        <div class="icore-panel-head"><div><span>Достижения</span><h3>Бейджи оператора</h3></div><b>${badges.filter(b => b.active).length}/4</b></div>
        <div class="icore-badge-grid">${badgesHtml}</div>
        <button class="icore-action-btn" data-icore-view="shop">Перейти в магазин · ${state.balance} коинов</button>
      </div>
    </div>
  `;
}

function renderIcoreRating() {
  const el = document.getElementById('icore-rating');
  if (!el) return;
  const ranking = getOperatorRanking();
  const states = getIcoreStates(ranking)
    .sort((a, b) => (b.weekCoins - a.weekCoins) || (b.row.points - a.row.points) || a.row.name.localeCompare(b.row.name, 'ru'));
  if (!states.length) {
    el.innerHTML = '<div class="icore-empty"><div class="section-kicker">iCore · Рейтинг</div><h2 class="section-title">Нет данных рейтинга</h2></div>';
    return;
  }

  const selected = getSelectedVisualOperator(ranking);
  const podium = states.slice(0, 3).map((state, idx) => `
    <div class="icore-podium-card place-${idx + 1}">
      <span>#${idx + 1}</span><b>${escapeHtml(state.row.name)}</b><em>${escapeHtml(state.row.faculty.name)}</em>
      <strong>${state.weekCoins} коинов</strong><small>баланс ${state.balance}</small>
    </div>
  `).join('');
  const nominations = getIcoreNominations(ranking).map(item => `
    <div class="icore-nomination"><span>${escapeHtml(item.title)}</span><b>${escapeHtml(item.row.name)}</b><em>${escapeHtml(item.value)}</em></div>
  `).join('');
  const rows = states.map((state, idx) => `
    <tr class="${selected && selected.nameKey === state.row.nameKey ? 'current' : ''}">
      <td>${idx + 1}</td>
      <td>${escapeHtml(state.row.name)}<small>${escapeHtml(state.row.faculty.name)}</small></td>
      <td>${fmtPts(state.row.points)}</td>
      <td>${state.weekCoins}</td>
      <td>${state.balance}</td>
      <td>${state.row.rank <= 3 ? '↑' : state.row.points > 0 ? '→' : '—'}</td>
    </tr>
  `).join('');

  el.innerHTML = `
    <div class="icore-head">
      <div><div class="section-kicker">iCore · Рейтинг</div><h2 class="section-title">Турнирная таблица коинов</h2></div>
      <div class="icore-meta"><span>${ranking.length} участников</span><b>${new Date().toLocaleDateString('ru-RU')}</b></div>
    </div>
    <div class="icore-podium">${podium}</div>
    <div class="icore-nomination-grid">${nominations || '<div class="icore-muted-line">Номинации появятся после загрузки показателей.</div>'}</div>
    <div class="icore-table-wrap">
      <table class="icore-table">
        <thead><tr><th>#</th><th>Оператор</th><th>Баллы</th><th>Неделя</th><th>Баланс</th><th>Дин.</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderIcoreShop() {
  const el = document.getElementById('icore-shop');
  if (!el) return;
  const ranking = getOperatorRanking();
  if (!ranking.length) {
    el.innerHTML = '<div class="icore-empty"><div class="section-kicker">iCore · Магазин</div><h2 class="section-title">Нет операторов для магазина</h2></div>';
    return;
  }
  const state = getSelectedIcoreState(ranking);
  const cards = ICORE_SHOP_ITEMS.map(item => {
    const missing = Math.max(0, item.price - state.balance);
    const canBuy = missing === 0;
    return `
      <div class="icore-shop-card ${canBuy ? 'available' : ''}">
        <div><span>${item.price} коинов</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.desc)}</p></div>
        <button data-icore-buy="${item.id}" ${canBuy ? '' : 'disabled'}>${canBuy ? 'Купить' : `Нужно ещё ${missing}`}</button>
      </div>
    `;
  }).join('');
  const requests = state.requests.slice(0, 5).map(item => `
    <div class="icore-request-row ${item.status}"><span>${ICORE_REQUEST_STATUS[item.status]}</span><b>${escapeHtml(item.rewardTitle)}</b><em>${item.price} коинов</em></div>
  `).join('');

  el.innerHTML = `
    <div class="icore-head">
      <div><div class="section-kicker">iCore · Магазин бонусов</div><h2 class="section-title">Каталог наград</h2></div>
      ${renderIcoreOperatorSelect(ranking)}
    </div>
    <div class="icore-shop-summary"><b>${escapeHtml(state.row.name)}</b><span>Баланс: ${state.balance} коинов · резерв: ${state.reserved}</span></div>
    <div class="icore-shop-grid">${cards}</div>
    <div class="icore-panel icore-shop-history">
      <div class="icore-panel-head"><div><span>Мои заявки</span><h3>Статусы магазина</h3></div><b>${state.requests.length}</b></div>
      <div class="icore-request-list">${requests || '<div class="icore-muted-line">Заявок пока нет.</div>'}</div>
    </div>
  `;
}

function renderIcoreAdmin() {
  const el = document.getElementById('icore-admin');
  if (!el) return;
  const ranking = getOperatorRanking();
  const states = getIcoreStates(ranking);
  const newRequests = (GAMIFICATION.requests || []).filter(item => item.status === 'new');
  const weekCoins = states.reduce((sum, state) => sum + state.weekCoins, 0);
  const avgRank = ranking.length ? ranking.reduce((sum, row) => sum + row.rank, 0) / ranking.length : 0;
  const selected = getSelectedVisualOperator(ranking);
  const options = ranking.map(row => `<option value="${row.nameKey}" ${selected && row.nameKey === selected.nameKey ? 'selected' : ''}>${escapeHtml(row.name)}</option>`).join('');
  const requestRows = (GAMIFICATION.requests || []).slice(0, 30).map(item => `
    <div class="icore-admin-request ${item.status}">
      <div><span>${ICORE_REQUEST_STATUS[item.status]}</span><b>${escapeHtml(item.operatorName || item.operatorKey)}</b><em>${escapeHtml(item.rewardTitle)} · ${item.price} коинов</em>${item.reason ? `<small>${escapeHtml(item.reason)}</small>` : ''}</div>
      <div class="icore-admin-actions">
        <button data-icore-request="${item.id}" data-icore-status="approved" ${item.status !== 'new' ? 'disabled' : ''}>Одобрить</button>
        <button data-icore-request="${item.id}" data-icore-status="rejected" ${item.status !== 'new' ? 'disabled' : ''}>Отклонить</button>
        <button data-icore-request="${item.id}" data-icore-status="done" ${item.status !== 'approved' ? 'disabled' : ''}>Выполнена</button>
      </div>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="icore-head">
      <div><div class="section-kicker">iCore · Администрирование</div><h2 class="section-title">Заявки, ручные начисления и отчёт</h2></div>
      <button class="icore-action-btn compact" data-icore-export="csv">CSV</button>
    </div>
    <div class="icore-kpi-grid">
      <div class="icore-kpi"><span>Операторов</span><b>${ranking.length}</b><em>в системе</em></div>
      <div class="icore-kpi"><span>Начислено за неделю</span><b>${weekCoins}</b><em>коинов</em></div>
      <div class="icore-kpi"><span>Новых заявок</span><b>${newRequests.length}</b><em>ожидают решения</em></div>
      <div class="icore-kpi"><span>Средняя позиция</span><b>${fmtPts(avgRank)}</b><em>по команде</em></div>
    </div>
    <div class="icore-admin-layout">
      <div class="icore-panel">
        <div class="icore-panel-head"><div><span>Ручное начисление</span><h3>Добавить или списать коины</h3></div></div>
        <div class="icore-form-grid">
          <select id="icore-manual-operator">${options}</select>
          <input id="icore-manual-amount" type="number" step="1" placeholder="+10 или -5">
          <input id="icore-manual-comment" type="text" placeholder="Причина начисления или списания">
          <button data-icore-manual="save">Сохранить</button>
        </div>
      </div>
      <div class="icore-panel">
        <div class="icore-panel-head"><div><span>Заявки из магазина</span><h3>Очередь согласования</h3></div><b>${GAMIFICATION.requests.length}</b></div>
        <div class="icore-admin-request-list">${requestRows || '<div class="icore-muted-line">Заявок пока нет.</div>'}</div>
      </div>
    </div>
  `;
}

function getOrCreateEditorPanel() {
  let panel = document.getElementById('editor-panel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'editor-panel';
    panel.className = 'editor-panel';
    panel.setAttribute('aria-label', 'Управление данными');
    panel.hidden = true;
  }
  return panel;
}

function mountModernAdminTools(editorPanel, excelBlock) {
  const editorSlot = document.getElementById('modern-admin-editor-slot');
  const excelSlot = document.getElementById('modern-admin-excel-slot');
  if (editorSlot && editorPanel) {
    editorSlot.appendChild(editorPanel);
    editorPanel.hidden = !isAdmin;
  }
  if (excelSlot && excelBlock && isAdmin) {
    excelSlot.appendChild(excelBlock);
  }
}

function renderIcoreAdmin() {
  const el = document.getElementById('icore-admin');
  if (!el) return;

  const editorPanel = getOrCreateEditorPanel();
  const excelBlock = document.querySelector('.excel-import-block');

  if (!isAdmin) {
    el.innerHTML = `
      <div class="mvp-admin mvp-admin-locked">
        <div class="mvp-hero-panel">
          <div>
            <span>Управление</span>
            <h1>Раздел доступен администратору</h1>
            <p>Войдите через кнопку администратора, чтобы открыть загрузку Excel, заявки и ручные начисления.</p>
          </div>
          <button type="button" class="mvp-admin-login" onclick="openAdminModal()">Войти</button>
        </div>
        <div id="modern-admin-editor-slot" hidden></div>
      </div>
    `;
    mountModernAdminTools(editorPanel, excelBlock);
    syncModernRoleUi();
    return;
  }

  const ranking = getOperatorRanking();
  const states = getIcoreStates(ranking);
  const newRequests = (GAMIFICATION.requests || []).filter(item => item.status === 'new');
  const weekCoins = states.reduce((sum, state) => sum + state.weekCoins, 0);
  const totalBalance = states.reduce((sum, state) => sum + state.balance, 0);
  const totalSpent = states.reduce((sum, state) => sum + state.spent, 0);
  const selected = getSelectedVisualOperator(ranking);
  const options = ranking.map(row => `<option value="${row.nameKey}" ${selected && row.nameKey === selected.nameKey ? 'selected' : ''}>${escapeHtml(row.name)}</option>`).join('');
  const requestRows = (GAMIFICATION.requests || []).slice(0, 40).map(item => `
    <div class="icore-admin-request ${item.status}">
      <div>
        <span>${ICORE_REQUEST_STATUS[item.status] || item.status}</span>
        <b>${escapeHtml(item.operatorName || item.operatorKey)}</b>
        <em>${escapeHtml(item.rewardTitle)} · ${item.price} коинов</em>
        ${item.reason ? `<small>${escapeHtml(item.reason)}</small>` : ''}
      </div>
      <div class="icore-admin-actions">
        <button data-icore-request="${item.id}" data-icore-status="approved" ${item.status !== 'new' ? 'disabled' : ''}>Одобрить</button>
        <button data-icore-request="${item.id}" data-icore-status="rejected" ${item.status !== 'new' ? 'disabled' : ''}>Отклонить</button>
        <button data-icore-request="${item.id}" data-icore-status="done" ${item.status !== 'approved' ? 'disabled' : ''}>Выполнено</button>
      </div>
    </div>
  `).join('');
  const operatorRows = states.map(state => `
    <tr>
      <td>${state.row.rank}</td>
      <td><b>${escapeHtml(state.row.name)}</b><small>${escapeHtml(state.row.faculty.name)}</small></td>
      <td>${fmtPts(state.row.points)}</td>
      <td>${state.weekCoins}</td>
      <td>${state.balance}</td>
      <td>${state.reserved}</td>
      <td>${state.spent}</td>
    </tr>
  `).join('');

  el.innerHTML = `
    <div class="mvp-admin">
      <div class="mvp-hero-panel">
        <div>
          <span>Управление</span>
          <h1>Администрирование геймификации</h1>
          <p>Загрузка Excel, заявки магазина, ручные коины, экспорт и таблица операторов собраны в одном месте.</p>
        </div>
        <button class="icore-action-btn compact" type="button" data-icore-export="csv">Экспорт CSV</button>
      </div>

      <div class="mvp-kpi-grid">
        <div class="mvp-kpi-card primary"><span>Операторов</span><b>${ranking.length}</b><em>в текущем списке</em></div>
        <div class="mvp-kpi-card info"><span>Начислено</span><b>${weekCoins}</b><em>коинов за неделю</em></div>
        <div class="mvp-kpi-card ${newRequests.length ? 'mid' : 'good'}"><span>Новые заявки</span><b>${newRequests.length}</b><em>ожидают решения</em></div>
        <div class="mvp-kpi-card neutral"><span>Баланс / потрачено</span><b>${totalBalance} / ${totalSpent}</b><em>по всем операторам</em></div>
      </div>

      <div class="mvp-admin-grid">
        <div class="icore-panel">
          <div class="icore-panel-head">
            <div><span>Ручное начисление</span><h3>Добавить или списать коины</h3></div>
          </div>
          <div class="icore-form-grid">
            <select id="icore-manual-operator">${options}</select>
            <input id="icore-manual-amount" type="number" step="1" placeholder="+10 или -5">
            <input id="icore-manual-comment" type="text" placeholder="Причина начисления или списания">
            <button data-icore-manual="save">Сохранить</button>
          </div>
        </div>

        <div class="icore-panel">
          <div class="icore-panel-head">
            <div><span>Заявки магазина</span><h3>Очередь согласования</h3></div>
            <b>${GAMIFICATION.requests.length}</b>
          </div>
          <div class="icore-admin-request-list">${requestRows || '<div class="icore-muted-line">Заявок пока нет.</div>'}</div>
        </div>
      </div>

      <div class="mvp-card mvp-table-card">
        <div class="mvp-card-head">
          <div><span>Операторы</span><h3>Итоги и балансы</h3></div>
          <b>${states.length}</b>
        </div>
        <div class="mvp-table-wrap">
          <table class="mvp-table">
            <thead>
              <tr><th>#</th><th>Оператор</th><th>Баллы</th><th>Неделя</th><th>Баланс</th><th>Резерв</th><th>Потрачено</th></tr>
            </thead>
            <tbody>${operatorRows || '<tr><td colspan="7">Нет данных</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <div class="mvp-admin-tools">
        <div class="mvp-card">
          <div class="mvp-card-head"><div><span>Excel</span><h3>Загрузка отчетов</h3></div></div>
          <div id="modern-admin-excel-slot"></div>
        </div>
        <div class="mvp-card mvp-editor-card">
          <div class="mvp-card-head"><div><span>Данные</span><h3>Операторы, группы и метрики</h3></div></div>
          <div id="modern-admin-editor-slot"></div>
        </div>
      </div>
    </div>
  `;
  mountModernAdminTools(editorPanel, excelBlock);
  syncModernRoleUi();
}

async function renderVisualDashboard() {
  const el = document.getElementById('visual-dashboard');
  if (!el) return;

  const ranking = getOperatorRanking();
  if (!ranking.length) {
    el.innerHTML = `
      <div class="visual-dashboard-header">
        <div>
          <div class="section-kicker">Визуальный дашборд</div>
          <h2 class="section-title">Положение операторов</h2>
        </div>
      </div>
      <div class="visual-empty-note">Добавьте операторов и баллы, чтобы увидеть рейтинг и сравнения.</div>
    `;
    return;
  }

  if (visualMode !== 'personal') visualMode = 'overview';
  const selected = getSelectedVisualOperator(ranking);
  const options = ranking.map(row => `
    <option value="${row.key}" ${row.key === selected.key ? 'selected' : ''}>
      ${row.rank}. ${escapeHtml(row.name)} — ${fmtPts(row.points)}
    </option>
  `).join('');

  el.innerHTML = `
    <div class="visual-dashboard-header">
      <div>
        <div class="section-kicker">Визуальный дашборд</div>
        <h2 class="section-title">Положение операторов</h2>
      </div>
      <div class="visual-controls">
        <div class="visual-mode-tabs" aria-label="Режим просмотра">
          <button class="${visualMode === 'overview' ? 'active' : ''}" onclick="setVisualMode('overview')">Общий</button>
          <button class="${visualMode === 'personal' ? 'active' : ''}" onclick="setVisualMode('personal')">Персональный</button>
        </div>
        <select class="visual-operator-select" onchange="selectVisualOperator(this.value)" aria-label="Выбрать оператора">
          ${options}
        </select>
      </div>
    </div>
    ${renderVisualKpis(selected, ranking)}
    <div class="visual-layout ${visualMode}">
      ${renderRatingChart(ranking, selected)}
      <div class="visual-side">
        ${renderGapPanels(selected, ranking)}
      </div>
    </div>
    <div class="visual-detail-grid">
      ${renderMetricComposition(selected)}
      ${renderLeaderComparison(selected, ranking)}
      ${renderDailyDynamics(selected)}
    </div>
  `;
}

/* ── Stats ──────────────────────────────────────────────────── */
async function renderStats() {
  const el = document.getElementById('stats-section');
  if (!el) return;

  const allTotals = calcTotals();
  const allPts = allTotals.flat().map(o => o.pts);
  const activePts = allPts.filter(p => p > 0);
  const avgAll = activePts.length ? activePts.reduce((s, v) => s + v, 0) / activePts.length : 0;

  const facTotals = FACULTIES.map((_, fi) => getFacultyTotal(fi));
  const leaderIdx = facTotals.indexOf(Math.max(...facTotals));
  const leader = FACULTIES[leaderIdx];

  let violations = 0;
  METRICS.forEach((m, mi) => {
    if (m.type === 'penalty') {
      WEEKLY_DATA[0]?.forEach(facRows => {
        facRows.forEach(row => { violations += Number(row[mi]) || 0; });
      });
    }
  });

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Лидирующая группа</div>
        <div class="stat-value highlight">${leader ? leader.icon + ' ' + leader.name : '—'}</div>
        <div class="stat-note">Средний балл: ${fmtPts(Math.max(...facTotals))}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Средний балл</div>
        <div class="stat-value">${fmtPts(avgAll)}</div>
        <div class="stat-note">Среди активных участников</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Нарушений / штрафов</div>
        <div class="stat-value" style="color:var(--danger)">${fmtPts(violations)}</div>
        <div class="stat-note">Суммарно по всем группам</div>
      </div>
    </div>
  `;
}

/* ── Scoreboard ─────────────────────────────────────────────── */
async function renderScoreboard() {
  const sb = document.getElementById('scoreboard');
  if (!sb) return;

  const allTotals = calcTotals();
  const totals = FACULTIES.map((fac, fi) => ({
    ...fac,
    avgTotal: getFacultyTotal(fi),
    sumTotal: allTotals[fi]?.reduce((s, o) => s + o.pts, 0) || 0,
    count: fac.operators.length,
  }));
  totals.sort((a, b) => b.avgTotal - a.avgTotal);

  const [first, second] = totals;
  const diff = second ? first.avgTotal - second.avgTotal : 0;

  const cards = totals.map((fac, idx) => `
    <div class="scard ${fac.cls}${idx === 0 ? ' leader' : ''}">
      <div class="scard-top">
        <div class="scard-rank">#${idx + 1}</div>
        <div class="scard-icon">${fac.icon}</div>
        <div class="scard-names">
          <div class="scard-name">${fac.name}</div>
          <div class="scard-en">${fac.enName || ''}</div>
        </div>
      </div>
      <div class="scard-stats">
        <div class="sstat">
          <div class="sstat-label">Средний балл</div>
          <div class="sstat-val big">${fmtPts(fac.avgTotal)}</div>
        </div>
        <div class="sstat">
          <div class="sstat-label">Общий балл</div>
          <div class="sstat-val">${fmtPts(fac.sumTotal)}</div>
        </div>
        <div class="sstat">
          <div class="sstat-label">Участников</div>
          <div class="sstat-val">${fac.count}</div>
        </div>
        <div class="sstat">
          <div class="sstat-label">Место</div>
          <div class="sstat-val">${idx + 1} из ${totals.length}</div>
        </div>
      </div>
      <div class="scard-desc">${FACTION_DESC[fac.id] || ''}</div>
    </div>
  `).join('');

  sb.innerHTML = `
    <div class="scoreboard-header">
      <div>
        <div class="section-kicker">Рейтинг групп</div>
        <h2 class="section-title">Общий рейтинг команд</h2>
      </div>
      <div class="score-meta">
        <strong>Лидер: ${first?.name || '—'}</strong>
        <span>Отрыв от 2 места: +${fmtPts(diff)}</span>
      </div>
    </div>
    <div class="score-list">${cards}</div>
  `;
}

/* ── Faculty Cards ──────────────────────────────────────────── */
async function renderFacultyCards() {
  const grid = document.getElementById('faction-grid');
  if (!grid) return;

  const allTotals = calcTotals();
  const maxPts = Math.max(1, ...allTotals.flat().map(o => o.pts));
  const colHeaders = METRICS.map(m => `<th class="metric-col metric-${m.type}">${escapeHtml(m.label)}</th>`).join('');

  let html = '';

  for (let fi = 0; fi < FACULTIES.length; fi++) {
    const fac = FACULTIES[fi];
    const facTotal = getFacultyTotal(fi);
    const scoreIdx = getScoreMetricIndex();

    const opsWithRank = fac.operators.map((name, oi) => ({
      name, oi, pts: allTotals[fi][oi]?.pts || 0,
    }));
    opsWithRank.sort((a, b) => b.pts - a.pts);

    const rows = opsWithRank.map(({ name, oi, pts }, sortIdx) => {
      const pct = Math.round((pts / maxPts) * 100);
      const localRank = sortIdx + 1;
      const topCls = localRank <= 3 ? ` top${localRank}` : '';
      const rankBadge = `<span class="rank-badge${localRank <= 3 ? ' rank-'+localRank : ''}">${localRank}</span>`;

      const row = WEEKLY_DATA[0]?.[fi]?.[oi] || [];
      const metricCells = METRICS.map((metric, mi) => {
        const value = row[mi] ?? 0;
        if (metric.type === 'score') {
          return `<td class="metric-score-cell">
            <div class="score-bar-wrap">
              <div class="score-bar"><div class="score-bar-fill" style="width:${pct}%"></div></div>
              <span class="pts-val">${fmtPts(pts)}</span>
            </div>
          </td>`;
        }
        const cls = metric.type === 'penalty' && Number(value) > 0 ? ' class="neg"' : '';
        return `<td${cls}>${formatMetricValue(value, metric)}</td>`;
      }).join('');

      return `<tr class="${topCls}">
        <td>${rankBadge}</td>
        <td class="op-name">${escapeHtml(name)}</td>
        ${metricCells}
      </tr>`;
    }).join('');

    html += `
      <div class="faction-card ${fac.cls}">
        <div class="faction-header">
          <div class="fh-left">
            <div class="fh-icon">${fac.icon}</div>
            <div class="fh-names">
              <div class="fh-name">${fac.name}</div>
              <div class="fh-en">${fac.enName || ''}</div>
            </div>
          </div>
          <div class="fh-meta">
            <div class="fh-stat">
              <div class="fh-stat-val">${fmtPts(facTotal)}</div>
              <div class="fh-stat-label">ср. балл</div>
            </div>
            <div class="fh-stat">
              <div class="fh-stat-val">${fac.operators.length}</div>
              <div class="fh-stat-label">участников</div>
            </div>
          </div>
        </div>
        <div class="faction-table-wrap">
          <table class="operators">
            <thead>
              <tr>
                <th style="width:36px">#</th>
                <th>Оператор</th>
                ${colHeaders}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  grid.innerHTML = html;
}

/* ── Editor ─────────────────────────────────────────────────── */
async function refreshDashboard() {
  await Promise.all([
    renderModernDashboard(),
    renderIcoreShop(),
    renderIcoreAdmin(),
  ]);
  renderEditor();
  syncModernRoleUi();
}

function renderEditor() {
  const panel = document.getElementById('editor-panel');
  if (!panel) return;
  if (!isAdmin) { panel.innerHTML = ''; return; }

  const metricsRows = METRICS.map((metric, mi) => `
    <div class="metric-editor-row">
      <input class="editor-input" value="${escapeHtml(metric.label)}"
        oninput="updateMetricLabel(${mi}, this.value)">
      <select class="editor-select" onchange="updateMetricType(${mi}, this.value)" ${metric.type === 'score' ? 'disabled' : ''}>
        <option value="metric"  ${metric.type === 'metric'  ? 'selected' : ''}>Показатель</option>
        <option value="penalty" ${metric.type === 'penalty' ? 'selected' : ''}>Штраф</option>
        <option value="score"   ${metric.type === 'score'   ? 'selected' : ''}>Баллы</option>
      </select>
      <button class="editor-icon-btn danger" onclick="removeMetric(${mi})" ${metric.type === 'score' ? 'disabled' : ''} title="Удалить">×</button>
    </div>
  `).join('');

  const factionEditors = FACULTIES.map((fac, fi) => {
    const rows = fac.operators.map((name, oi) => {
      const cells = METRICS.map((metric, mi) => `
        <td>
          <input class="metric-value-input${metric.type === 'score' ? ' metric-value-input--readonly' : ''}" type="number" step="0.1"
            value="${WEEKLY_DATA[0]?.[fi]?.[oi]?.[mi] ?? 0}"
            ${metric.type === 'score'
              ? 'readonly title="Считается автоматически"'
              : `oninput="updateOperatorMetric(${fi}, ${oi}, ${mi}, this.value)"`}>
        </td>
      `).join('');
      return `
        <tr>
          <td><input class="operator-name-input" value="${escapeHtml(name)}"
            oninput="updateOperatorName(${fi}, ${oi}, this.value)"></td>
          ${cells}
          <td>
            <button class="editor-icon-btn danger" onclick="clearOperatorMetrics(${fi}, ${oi})" title="Очистить">⊘</button>
            <button class="editor-icon-btn danger" onclick="removeOperator(${fi}, ${oi})" title="Удалить">🗑</button>
          </td>
        </tr>`;
    }).join('');

    return `
      <div class="editor-faction ${fac.cls}">
        <div class="editor-faction-header">
          <div class="editor-faction-name">${fac.icon} ${escapeHtml(fac.name)}</div>
          <div class="editor-faction-actions">
            <button class="editor-btn danger-soft" onclick="clearFactionMetrics(${fi})">Очистить группу</button>
            <div class="editor-add-operator">
              <input class="editor-input" id="new-operator-${fi}" placeholder="Новый оператор">
              <button class="editor-btn" onclick="addOperator(${fi})">Добавить</button>
            </div>
          </div>
        </div>
        <div class="editor-table-wrap">
          <table class="editor-table">
            <thead>
              <tr>
                <th>Оператор</th>
                ${METRICS.map(m => `<th class="metric-col metric-${m.type}">${escapeHtml(m.label)}</th>`).join('')}
                <th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="editor-toolbar">
      <div>
        <div class="editor-title">Управление данными</div>
        <div class="editor-subtitle">Изменения сохраняются на сервере</div>
      </div>
      <button class="editor-btn ghost" onclick="logoutAdmin()">Выйти</button>
    </div>
    <div class="editor-metrics">
      <div class="editor-metrics-list">${metricsRows}</div>
      <div class="editor-add-metric">
        <input class="editor-input" id="new-metric-name" placeholder="Новый показатель">
        <select class="editor-select" id="new-metric-type">
          <option value="metric">Показатель</option>
          <option value="penalty">Штраф</option>
        </select>
        <button class="editor-btn" onclick="addMetric()">Добавить колонку</button>
      </div>
    </div>
    <div class="editor-factions">${factionEditors}</div>
  `;
}

/* ── CRUD ───────────────────────────────────────────────────── */
function updateOperatorName(facIdx, opIdx, value) {
  if (!requireAdmin()) return;
  FACULTIES[facIdx].operators[opIdx] = value.trim() || `Оператор ${opIdx + 1}`;
  refreshDashboardOnly(); debouncedSave();
}

function updateOperatorMetric(facIdx, opIdx, metricIdx, value) {
  if (!requireAdmin()) return;
  if (METRICS[metricIdx]?.type === 'score') return;
  if (!WEEKLY_DATA[0][facIdx]) WEEKLY_DATA[0][facIdx] = [];
  if (!WEEKLY_DATA[0][facIdx][opIdx]) WEEKLY_DATA[0][facIdx][opIdx] = Array(METRICS.length).fill(0);
  WEEKLY_DATA[0][facIdx][opIdx][metricIdx] = Number(value) || 0;
  syncOperatorScore(WEEKLY_DATA[0][facIdx][opIdx]);
  refreshDashboardOnly(); debouncedSave();
}

async function addOperator(facIdx) {
  if (!requireAdmin()) return;
  const input = document.getElementById(`new-operator-${facIdx}`);
  const name = input.value.trim();
  if (!name) return;
  FACULTIES[facIdx].operators.push(name);
  if (!WEEKLY_DATA[0][facIdx]) WEEKLY_DATA[0][facIdx] = [];
  WEEKLY_DATA[0][facIdx].push(Array(METRICS.length).fill(0));
  await saveEditableData(); renderEditor(); refreshDashboard();
}

async function clearOperatorMetrics(facIdx, opIdx) {
  if (!requireAdmin()) return;
  const name = FACULTIES[facIdx].operators[opIdx];
  if (!confirm(`Очистить показатели оператора "${name}"?`)) return;
  if (WEEKLY_DATA[0]?.[facIdx]?.[opIdx]) WEEKLY_DATA[0][facIdx][opIdx] = Array(METRICS.length).fill(0);
  await saveEditableData(); renderEditor(); refreshDashboard();
}

async function removeOperator(facIdx, opIdx) {
  if (!requireAdmin()) return;
  const name = FACULTIES[facIdx].operators[opIdx];
  if (!confirm(`Удалить оператора "${name}" полностью?`)) return;
  if (WEEKLY_DATA[0]?.[facIdx]) WEEKLY_DATA[0][facIdx].splice(opIdx, 1);
  FACULTIES[facIdx].operators.splice(opIdx, 1);
  await saveEditableData(); renderEditor(); refreshDashboard();
}

async function clearFactionMetrics(facIdx) {
  if (!requireAdmin()) return;
  const fac = FACULTIES[facIdx];
  if (!confirm(`Очистить все показатели группы "${fac.name}"?`)) return;
  fac.operators.forEach((_, oi) => {
    if (WEEKLY_DATA[0]?.[facIdx]) WEEKLY_DATA[0][facIdx][oi] = Array(METRICS.length).fill(0);
  });
  await saveEditableData(); renderEditor(); refreshDashboard();
}

function updateMetricLabel(metricIdx, value) {
  if (!requireAdmin()) return;
  METRICS[metricIdx].label = value.trim() || `Показатель ${metricIdx + 1}`;
  refreshDashboardOnly(); debouncedSave();
}

async function updateMetricType(metricIdx, value) {
  if (!requireAdmin()) return;
  if (METRICS[metricIdx].type === 'score') return;
  METRICS[metricIdx].type = value === 'penalty' ? 'penalty' : 'metric';
  await saveEditableData(); refreshDashboard();
}

async function addMetric() {
  if (!requireAdmin()) return;
  const nameInput = document.getElementById('new-metric-name');
  const typeInput = document.getElementById('new-metric-type');
  const label = nameInput.value.trim();
  if (!label) return;
  const insertAt = getScoreMetricIndex();
  METRICS.splice(insertAt, 0, { label, type: typeInput.value === 'penalty' ? 'penalty' : 'metric' });
  WEEKLY_DATA[0].forEach(facRows => { facRows.forEach(row => row.splice(insertAt, 0, 0)); });
  syncAllScores();
  await saveEditableData(); renderEditor(); refreshDashboard();
}

async function removeMetric(metricIdx) {
  if (!requireAdmin()) return;
  if (METRICS[metricIdx].type === 'score') return;
  if (!confirm(`Удалить показатель "${METRICS[metricIdx].label}"?`)) return;
  METRICS.splice(metricIdx, 1);
  WEEKLY_DATA[0].forEach(facRows => { facRows.forEach(row => row.splice(metricIdx, 1)); });
  syncAllScores();
  await saveEditableData(); renderEditor(); refreshDashboard();
}

function applyGamificationResponse(result) {
  if (result?.gamification) {
    GAMIFICATION = normalizeGamification(result.gamification);
    persistGamification();
  }
}

async function buyIcoreReward(rewardId) {
  if (!ensureOperatorAccess()) return;
  const ranking = getOperatorRanking();
  const state = getSelectedIcoreState(ranking);
  const reward = ICORE_SHOP_ITEMS.find(item => item.id === rewardId);
  if (!state || !reward) return;
  if (state.balance < reward.price) {
    alert(`Не хватает ${reward.price - state.balance} коинов`);
    return;
  }

  setSaveIndicator('pending');
  try {
    const result = await api.createRewardRequest({
      operatorKey: state.row.nameKey,
      operatorName: state.row.name,
      rewardId: reward.id,
      rewardTitle: reward.title,
      price: reward.price,
    });
    applyGamificationResponse(result);
    setSaveIndicator('saved');
    await refreshDashboard();
    window.showContestSection?.('shop');
  } catch (error) {
    setSaveIndicator('error');
    alert('Не удалось создать заявку: ' + error.message);
  }
}

async function addManualIcoreCoins() {
  if (!requireAdmin()) return;
  const operatorKey = document.getElementById('icore-manual-operator')?.value || '';
  const amount = Math.trunc(Number(document.getElementById('icore-manual-amount')?.value || 0));
  const comment = String(document.getElementById('icore-manual-comment')?.value || '').trim();
  const row = getOperatorRanking().find(item => item.nameKey === operatorKey);
  if (!row || !amount || !comment) {
    alert('Выберите оператора, сумму и укажите причину.');
    return;
  }

  setSaveIndicator('pending');
  try {
    const result = await api.addManualCoins({
      operatorKey: row.nameKey,
      operatorName: row.name,
      amount,
      comment,
      author: 'Администратор',
    }, getAdminPassword());
    applyGamificationResponse(result);
    setSaveIndicator('saved');
    await refreshDashboard();
    window.showContestSection?.('admin');
  } catch (error) {
    setSaveIndicator('error');
    alert('Не удалось сохранить начисление: ' + error.message);
  }
}

async function updateIcoreRequest(id, status) {
  if (!requireAdmin()) return;
  const reason = status === 'rejected' ? String(prompt('Причина отказа') || '').trim() : '';
  if (status === 'rejected' && !reason) return;

  setSaveIndicator('pending');
  try {
    const result = await api.updateRewardRequest(id, { status, reason }, getAdminPassword());
    applyGamificationResponse(result);
    setSaveIndicator('saved');
    await refreshDashboard();
    window.showContestSection?.('admin');
  } catch (error) {
    setSaveIndicator('error');
    alert('Не удалось обновить заявку: ' + error.message);
  }
}

function exportIcoreCsv() {
  const ranking = getOperatorRanking();
  const states = getIcoreStates(ranking);
  const lines = [
    ['Место', 'Оператор', 'Группа', 'Баллы', 'Коины за неделю', 'Баланс', 'Резерв', 'Потрачено'].join(';'),
    ...states.map(state => [
      state.row.rank,
      state.row.name,
      state.row.faculty.name,
      fmtPts(state.row.points),
      state.weekCoins,
      state.balance,
      state.reserved,
      state.spent,
    ].map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')),
  ];
  const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `icore-gamification-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

Object.assign(window, {
  loginOperator,
  registerOperator,
  logoutOperator,
  setOperatorAuthMode,
  showOperatorLogin,
  showAdminLoginFromOperator,
  buyIcoreReward,
  addManualIcoreCoins,
  updateIcoreRequest,
  exportIcoreCsv,
});

const MODERN_NAV_LABELS = {
  overview: 'Дашборд',
  shop: 'Магазин',
  admin: 'Управление',
};

const MODERN_NAV_TITLES = {
  overview: 'Дашборд операторов',
  shop: 'Магазин бонусов',
  admin: 'Управление',
};

function isModernNavTargetAllowed(target) {
  if (target === 'admin') return isAdmin;
  return target === 'overview' || target === 'shop';
}

function syncModernNavLabels() {
  document.querySelectorAll('.side-nav-link[data-nav-target]').forEach(link => {
    const target = link.dataset.navTarget;
    const label = MODERN_NAV_LABELS[target];
    const title = MODERN_NAV_TITLES[target] || label;
    if (label) {
      const text = link.querySelector('span');
      if (text) text.textContent = label;
      link.setAttribute('title', title);
    }
    link.hidden = !isModernNavTargetAllowed(target);
    link.setAttribute('aria-hidden', String(!isModernNavTargetAllowed(target)));
  });
}

function syncModernRoleUi() {
  document.body.classList.toggle('user-role-admin', isAdmin);
  document.body.classList.toggle('operator-authenticated', !!operatorSession);
  document.body.dataset.role = isAdmin ? 'admin' : 'operator';
  syncModernNavLabels();

  const roleLabel = document.getElementById('side-role-label');
  const rateLabel = document.getElementById('side-rate-label');
  const updatedLabel = document.getElementById('side-updated-label');
  if (roleLabel) roleLabel.textContent = `Роль: ${getModernRoleLabel()}`;
  if (rateLabel) rateLabel.textContent = `${getIcoreCoinRate()} баллов = 1 коин`;
  if (updatedLabel) updatedLabel.textContent = `Обновлено: ${getModernUpdatedLabel()}`;

  const meta = document.querySelector('.side-nav-meta');
  let sessionPanel = document.getElementById('operator-session-panel');
  if (meta && !sessionPanel) {
    sessionPanel = document.createElement('div');
    sessionPanel.id = 'operator-session-panel';
    sessionPanel.className = 'operator-session-panel';
    meta.appendChild(sessionPanel);
  }
  if (sessionPanel) {
    sessionPanel.innerHTML = operatorSession && !isAdmin
      ? `
        <div class="operator-session-user">
          <span>Аккаунт</span>
          <b>${escapeHtml(currentUser?.name || currentUser?.login || operatorSession.name || 'Оператор')}</b>
        </div>
        <button type="button" onclick="logoutOperator()">Выйти</button>
      `
      : (!isAdmin ? `<button type="button" onclick="showOperatorLogin()">Войти</button>` : '');
    sessionPanel.hidden = isAdmin || !currentUser;
  }

  const activeAdmin = document.querySelector('.app-view.active')?.dataset.sectionView === 'admin';
  if (!isAdmin && activeAdmin) window.showContestSection?.('overview');
  updateOperatorAuthOverlay();
}

function closeMobileSidebar() {
  const overlay = document.getElementById('sidebar-overlay');
  const button = document.getElementById('mobile-menu-button');
  document.body.classList.remove('sidebar-open');
  if (overlay) overlay.hidden = true;
  if (button) button.setAttribute('aria-expanded', 'false');
}

function openMobileSidebar() {
  const overlay = document.getElementById('sidebar-overlay');
  const button = document.getElementById('mobile-menu-button');
  document.body.classList.add('sidebar-open');
  if (overlay) overlay.hidden = false;
  if (button) button.setAttribute('aria-expanded', 'true');
}

function initMobileSidebar() {
  const button = document.getElementById('mobile-menu-button');
  const close = document.getElementById('side-nav-close');
  const overlay = document.getElementById('sidebar-overlay');

  button?.addEventListener('click', () => {
    if (document.body.classList.contains('sidebar-open')) closeMobileSidebar();
    else openMobileSidebar();
  });
  close?.addEventListener('click', closeMobileSidebar);
  overlay?.addEventListener('click', closeMobileSidebar);
  document.querySelectorAll('.side-nav-link').forEach(link => {
    link.addEventListener('click', closeMobileSidebar);
  });
}

function initIntro() {
  const intro = document.getElementById('intro-screen');
  if (!intro) return;

  const skip = document.getElementById('intro-skip');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let closed = false;

  function closeIntro() {
    if (closed) return;
    closed = true;
    intro.classList.add('is-hidden');
    document.body.classList.remove('intro-lock');
    window.setTimeout(() => intro.remove(), reducedMotion ? 50 : 700);
  }

  document.body.classList.add('intro-lock');
  skip?.addEventListener('click', closeIntro);
  window.setTimeout(closeIntro, reducedMotion ? 450 : 3700);
}

function initSideNavCollapse() {
  const toggle = document.getElementById('side-nav-toggle');
  const storageKey = 'contestSideNavCollapsed';
  if (!toggle) return;

  const applyState = collapsed => {
    document.body.classList.toggle('side-nav-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Раскрыть меню' : 'Свернуть меню');
    toggle.setAttribute('title', collapsed ? 'Раскрыть меню' : 'Свернуть меню');
  };

  const saved = localStorage.getItem(storageKey) === '1';
  applyState(saved);

  toggle.addEventListener('click', () => {
    const collapsed = !document.body.classList.contains('side-nav-collapsed');
    applyState(collapsed);
    localStorage.setItem(storageKey, collapsed ? '1' : '0');
  });
}

function initSideNavigation() {
  const links = Array.from(document.querySelectorAll('.side-nav-link[data-nav-target]'));
  const views = Array.from(document.querySelectorAll('[data-section-view]'));
  if (!links.length || !views.length) return;
  syncModernNavLabels();

  const defaultView = views.find(view => view.dataset.sectionView === 'overview') || views[0];
  const legacyTargets = {
    dashboard: 'overview',
    cabinet: 'overview',
    'coin-rating': 'overview',
    individual: 'overview',
    season: 'overview',
    factions: 'overview',
    tables: 'overview',
    criteria: 'overview',
    'icore-cabinet': 'overview',
    'icore-rating': 'overview',
    'visual-dashboard': 'overview',
    'game-dashboard': 'overview',
    scoreboard: 'overview',
    'tables-section': 'overview',
    'criteria-section': 'overview',
    'icore-shop': 'shop',
    'icore-admin': 'admin',
  };

  function resolveView(target) {
    const normalized = (target || '').replace(/^#/, '');
    const mapped = legacyTargets[normalized] || normalized || 'overview';
    const allowed = isModernNavTargetAllowed(mapped) ? mapped : 'overview';
    return views.find(view => view.dataset.sectionView === allowed || view.id === allowed) || defaultView;
  }

  function activeViewFromHash() {
    if (!window.location.hash) return defaultView;
    return resolveView(decodeURIComponent(window.location.hash.slice(1)));
  }

  function setActiveView(target, options = {}) {
    const selectedView = resolveView(target);
    const sectionId = selectedView.dataset.sectionView;

    views.forEach(view => {
      const isActive = view === selectedView;
      view.classList.toggle('active', isActive);
      view.hidden = !isActive;
    });

    links.forEach(link => {
      link.classList.toggle('active', link.dataset.navTarget === sectionId && isModernNavTargetAllowed(link.dataset.navTarget));
    });

    if (!options.skipHash) {
      const activeLink = links.find(link => link.dataset.navTarget === sectionId);
      const nextHash = activeLink?.getAttribute('href') || `#${selectedView.id}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', nextHash);
      }
    }

    if (!options.skipScroll) {
      const anchor = document.getElementById('dashboard') || selectedView;
      anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  links.forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      setActiveView(link.dataset.navTarget);
    });
  });

  document.querySelectorAll('.side-nav-logo, .hero-cta').forEach(anchor => {
    anchor.addEventListener('click', event => {
      const view = resolveView(anchor.getAttribute('href'));
      if (!view) return;
      event.preventDefault();
      setActiveView(view.dataset.sectionView);
    });
  });

  window.addEventListener('hashchange', () => {
    const activeView = activeViewFromHash();
    setActiveView(activeView.dataset.sectionView, { skipHash: true, skipScroll: false });
  });

  window.showContestSection = target => setActiveView(target);
  setActiveView(activeViewFromHash().dataset.sectionView, { skipHash: true, skipScroll: true });
  syncModernRoleUi();
}

/* ── Init ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  initIntro();
  initSideNavCollapse();
  loadAuthSession();
  await refreshAuthSession();
  try {
    await loadEditableData();
  } catch (err) {
    console.error('Не удалось загрузить данные:', err);
    const banner = document.createElement('div');
    banner.style.cssText = [
      'position:fixed','top:0','left:0','right:0','z-index:9999',
      'background:#fff3f0','color:#8b2800','font-family:Rajdhani,sans-serif',
      'font-size:13px','text-align:center','padding:10px 16px',
      'letter-spacing:.05em','cursor:pointer',
      'border-bottom:1px solid rgba(200,52,26,.3)',
    ].join(';');
    banner.textContent = '⚠ Сервер недоступен. Данные не загружены. Нажмите для повтора.';
    banner.onclick = () => { banner.remove(); location.reload(); };
    document.body.prepend(banner);
  }
  loadAdminSession();
  loadOperatorSession();
  updateAdminGate();
  await Promise.all([
    renderModernDashboard(),
    renderIcoreShop(),
    renderIcoreAdmin(),
  ]);
  renderEditor();
  const editorPanel = document.getElementById('editor-panel');
  if (editorPanel) editorPanel.hidden = !isAdmin;
  syncModernRoleUi();
  initMobileSidebar();
  initSideNavigation();
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAdminModal(); });
document.addEventListener('click', e => {
  const buyBtn = e.target.closest('[data-icore-buy]');
  if (buyBtn) {
    e.preventDefault();
    buyIcoreReward(buyBtn.dataset.icoreBuy);
    return;
  }

  const requestBtn = e.target.closest('[data-icore-request][data-icore-status]');
  if (requestBtn) {
    e.preventDefault();
    updateIcoreRequest(requestBtn.dataset.icoreRequest, requestBtn.dataset.icoreStatus);
    return;
  }

  const manualBtn = e.target.closest('[data-icore-manual="save"]');
  if (manualBtn) {
    e.preventDefault();
    addManualIcoreCoins();
    return;
  }

  const exportBtn = e.target.closest('[data-icore-export="csv"]');
  if (exportBtn) {
    e.preventDefault();
    exportIcoreCsv();
    return;
  }

  const viewBtn = e.target.closest('[data-icore-view]');
  if (viewBtn) {
    e.preventDefault();
    window.showContestSection?.(viewBtn.dataset.icoreView);
  }
});
document.addEventListener('click', e => {
  const gate = document.getElementById('admin-gate');
  const pop  = document.getElementById('admin-popover');
  if (!gate || !pop || pop.hidden) return;
  if (!gate.contains(e.target)) closeAdminModal();
});

window.addEventListener('beforeunload', e => {
  if (debouncedSave.hasPending()) {
    debouncedSave.flush(); e.preventDefault(); e.returnValue = ''; return '';
  }
});
