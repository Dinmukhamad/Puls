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

const ADMIN_SESSION_KEY = 'divergentContestAdminUnlocked';
const ADMIN_PASSWORD_KEY = 'divergentContestAdminToken';
let isAdmin = false;

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
