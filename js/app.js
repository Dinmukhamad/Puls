/* ============================================================
   Дивергент: Конкурс Операторов — app.js v4
   Одна страница, один набор данных. Баллы обновляются через админ.
   ============================================================ */

'use strict';

const USE_MOCK = false;
const API_BASE = window.location.origin;

/* ── Фракции ────────────────────────────────────────────────── */
const FACTION_DESC = {
  dauntless: 'Воплощают храбрость, отвагу и силу. Отвечают за безопасность и охраняют границы.',
  erudite:   'Стремятся к знаниям, мудрости и интеллекту. Занимаются наукой и технологиями.',
  candor:    'Ставят во главу угла честность и правду. Выполняют функции судей и дипломатов.',
};

let FACULTIES = [
  { id: 'dauntless', cls: 'dauntless', icon: '🔥', crest: null, name: 'Бесстрашие', enName: 'Dauntless', tagCls: 'tag-dauntless', scoreCls: 'dauntless-score', operators: [] },
  { id: 'erudite',   cls: 'erudite',   icon: '⚡', crest: null, name: 'Эрудиция',   enName: 'Erudite',   tagCls: 'tag-erudite',   scoreCls: 'erudite-score',   operators: [] },
  { id: 'candor',    cls: 'candor',    icon: '⚖',  crest: null, name: 'Искренность',enName: 'Candor',    tagCls: 'tag-candor',    scoreCls: 'candor-score',    operators: [] },
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
  title: 'Дивергент: Битва фракций',
  theme: 'Сезон испытаний',
  startDate: '2026-06-15',
  endDate: '2026-06-30',
  currency: 'жетонов',
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

const ADMIN_SESSION_KEY = 'divergentContestAdminUnlocked';
const ADMIN_PASSWORD_KEY = 'divergentContestAdminToken';
const DAILY_IMPORT_STORAGE_KEY = 'divergentContestDailyImport';
const VISUAL_MODE_STORAGE_KEY = 'divergentContestVisualMode';
const VISUAL_OPERATOR_STORAGE_KEY = 'divergentContestVisualOperator';
let isAdmin = false;
let DAILY_IMPORT_DATA = null;
let visualMode = localStorage.getItem(VISUAL_MODE_STORAGE_KEY) || 'overview';
let visualOperatorKey = localStorage.getItem(VISUAL_OPERATOR_STORAGE_KEY) || '';

function getAdminPassword() {
  return sessionStorage.getItem(ADMIN_PASSWORD_KEY) || '';
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
async function loadEditableData() {
  const state = await api.loadState();
  if (state && Array.isArray(state.faculties) && Array.isArray(state.weeklyData) && Array.isArray(state.metrics)) {
    FACULTIES   = state.faculties;
    /* Совместимость: если сервер вернул старый формат [slot0, slot1],
       берём первый (промежуточный) слот */
    WEEKLY_DATA = Array.isArray(state.weeklyData[0]) && !Array.isArray(state.weeklyData[0][0])
      ? [ state.weeklyData[0] ]
      : [ state.weeklyData[0] ?? [] ];
    METRICS     = state.metrics;
    DAILY_IMPORT_DATA = sanitizeDailyImport(state.dailyImport) || readStoredDailyImport();
  }
  if (!DAILY_IMPORT_DATA) DAILY_IMPORT_DATA = readStoredDailyImport();
  if (!METRICS.some(m => m.type === 'score')) METRICS.push({ label: 'Итого', type: 'score' });
  normalizeEditableData();
}

async function saveEditableData() {
  normalizeEditableData();
  /* Сохраняем в формате совместимом с сервером — один слот */
  setSaveIndicator('pending');
  try {
    await api.saveState({ faculties: FACULTIES, weeklyData: WEEKLY_DATA, metrics: METRICS, dailyImport: DAILY_IMPORT_DATA }, getAdminPassword());
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
    renderStats(),
    renderVisualDashboard(),
    renderGameDashboard(),
    renderScoreboard(),
    renderFacultyCards(),
  ]);
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

/* ── Admin ──────────────────────────────────────────────────── */
function loadAdminSession() {
  const flag = sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
  const hasPwd = !!sessionStorage.getItem(ADMIN_PASSWORD_KEY);
  isAdmin = flag && hasPwd;
  if (flag && !hasPwd) sessionStorage.removeItem(ADMIN_SESSION_KEY);
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
}

function openAdminModal() {
  const p = document.getElementById('admin-popover');
  if (!p) return;
  updateAdminGate(); p.hidden = false;
  if (!isAdmin) { const i = document.getElementById('admin-password'); if (i) setTimeout(() => i.focus(), 0); }
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
    closeAdminModal(); updateAdminGate(); renderEditor();
    document.getElementById('editor-panel').hidden = false;
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
  document.getElementById('editor-panel').hidden = true;
}

/* ── Data calculations ──────────────────────────────────────── */
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
  let selected = ranking.find(row => row.key === visualOperatorKey);
  if (!selected) selected = ranking.find(row => row.points > 0) || ranking[0];
  visualOperatorKey = selected.key;
  try { localStorage.setItem(VISUAL_OPERATOR_STORAGE_KEY, selected.key); } catch {}
  return selected;
}

function setVisualMode(mode) {
  visualMode = mode === 'personal' ? 'personal' : 'overview';
  try { localStorage.setItem(VISUAL_MODE_STORAGE_KEY, visualMode); } catch {}
  renderVisualDashboard();
  renderGameDashboard();
}

function selectVisualOperator(value) {
  visualOperatorKey = String(value || '');
  try { localStorage.setItem(VISUAL_OPERATOR_STORAGE_KEY, visualOperatorKey); } catch {}
  visualMode = 'personal';
  try { localStorage.setItem(VISUAL_MODE_STORAGE_KEY, visualMode); } catch {}
  renderVisualDashboard();
  renderGameDashboard();
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
      title: 'Фракционный рывок',
      label: 'Средний балл фракции 85+',
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
            <div class="section-kicker">Игровой сезон</div>
            <h2 class="section-title">${escapeHtml(GAME_SEASON.title)}</h2>
          </div>
          <span>${escapeHtml(getSeasonPeriodLabel())}</span>
        </div>
        <div class="visual-empty-note">Добавьте операторов и KPI, чтобы появились миссии, жетоны, магазин и достижения.</div>
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
          <div class="section-kicker">Игровой сезон</div>
          <h2 class="section-title">${escapeHtml(GAME_SEASON.title)}</h2>
          <p>${escapeHtml(GAME_SEASON.theme)}: миссии, жетоны, бейджи и магазин наград.</p>
        </div>
        <div class="game-season-meta">
          <span>${escapeHtml(getSeasonPeriodLabel())}</span>
          <b>${getSeasonDaysLeft()} дн. до финала</b>
        </div>
      </div>

      <div class="game-kpi-grid">
        <div class="game-stat"><span>Активные операторы</span><b>${activeOperators}</b><em>в рейтинге сезона</em></div>
        <div class="game-stat"><span>Средние жетоны</span><b>${fmtPts(averageCoins)}</b><em>на участника</em></div>
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
        <div class="stat-label">Лидирующая фракция</div>
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
        <div class="stat-note">Суммарно по всем фракциям</div>
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
        <div class="section-kicker">Рейтинг фракций</div>
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
  await Promise.all([renderStats(), renderVisualDashboard(), renderGameDashboard(), renderScoreboard(), renderFacultyCards()]);
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

function initSideNavigation() {
  const links = Array.from(document.querySelectorAll('.side-nav-link[data-nav-target]'));
  if (!links.length) return;

  const sections = links.map(link => ({
    id: link.dataset.navTarget,
    link,
    el: document.getElementById(link.dataset.navTarget),
  })).filter(item => item.el);

  if (!sections.length) return;

  function setActive(id) {
    links.forEach(link => link.classList.toggle('active', link.dataset.navTarget === id));
  }

  let ticking = false;
  function updateActiveSection() {
    ticking = false;
    const checkpoint = window.scrollY + window.innerHeight * 0.34;
    let active = sections[0];
    sections.forEach(section => {
      if (section.el.offsetTop <= checkpoint) active = section;
    });
    setActive(active.id);
  }

  links.forEach(link => {
    link.addEventListener('click', () => setActive(link.dataset.navTarget));
  });

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateActiveSection);
  }, { passive: true });
  window.addEventListener('resize', updateActiveSection);
  updateActiveSection();
}

/* ── Init ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  initIntro();
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
  updateAdminGate();
  renderEditor();
  document.getElementById('editor-panel').hidden = !isAdmin;
  await Promise.all([renderStats(), renderVisualDashboard(), renderGameDashboard(), renderScoreboard(), renderFacultyCards()]);
  initSideNavigation();
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAdminModal(); });
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
