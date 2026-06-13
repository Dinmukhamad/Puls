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
  }
  if (!METRICS.some(m => m.type === 'score')) METRICS.push({ label: 'Итого', type: 'score' });
  normalizeEditableData();
}

async function saveEditableData() {
  normalizeEditableData();
  /* Сохраняем в формате совместимом с сервером — один слот */
  setSaveIndicator('pending');
  try {
    await api.saveState({ faculties: FACULTIES, weeklyData: WEEKLY_DATA, metrics: METRICS }, getAdminPassword());
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
  const si = getScoreMetricIndex();
  return FACULTIES.map((fac, fi) =>
    fac.operators.map((name, oi) => ({
      name,
      pts: Number(WEEKLY_DATA[0]?.[fi]?.[oi]?.[si]) || 0,
    }))
  );
}

function getFacultyTotal(facIdx) {
  const si = getScoreMetricIndex();
  const rows = WEEKLY_DATA[0]?.[facIdx] ?? [];
  const scores = rows.map(r => Number(r[si]) || 0).filter(v => v !== 0);
  if (scores.length === 0) return 0;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
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
      const metricItems = METRICS.map((metric, mi) => {
        const value = row[mi] ?? 0;
        const metricClasses = [
          'op-metric',
          `metric-${metric.type}`,
          metric.type === 'penalty' && Number(value) > 0 ? 'neg' : '',
        ].filter(Boolean).join(' ');
        if (metric.type === 'score') {
          return `<div class="${metricClasses}">
            <div class="op-metric-top">
              <span class="op-metric-label">${escapeHtml(metric.label)}</span>
              <span class="op-metric-value pts-val">${fmtPts(pts)}</span>
            </div>
            <div class="score-bar"><div class="score-bar-fill" style="width:${pct}%"></div></div>
          </div>`;
        }
        return `<div class="${metricClasses}">
          <span class="op-metric-label">${escapeHtml(metric.label)}</span>
          <span class="op-metric-value">${formatMetricValue(value, metric)}</span>
        </div>`;
      }).join('');

      return `<article class="operator-row${topCls}">
        <div class="operator-main">
          ${rankBadge}
          <div class="operator-name-wrap">
            <div class="op-name">${escapeHtml(name)}</div>
            <div class="operator-sub">#${localRank} • ${fmtPts(pts)} балл</div>
          </div>
        </div>
        <div class="operator-metrics">${metricItems}</div>
      </article>`;
    }).join('');

    html += `
      <div class="faction-card ${fac.cls}" id="faction-${fac.id}">
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
          <div class="operators-board">${rows}</div>
        </div>
      </div>`;
  }

  const nav = FACULTIES.map(fac => `
    <a class="faction-jump ${fac.cls}" href="#faction-${fac.id}">
      <span>${fac.icon}</span>
      <span>${fac.name}</span>
    </a>
  `).join('');

  grid.innerHTML = `<nav class="faction-jumps" aria-label="Быстрый переход по фракциям">${nav}</nav>${html}`;
}

/* ── Editor ─────────────────────────────────────────────────── */
async function refreshDashboard() {
  await Promise.all([renderStats(), renderScoreboard(), renderFacultyCards()]);
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
          <input class="metric-value-input" type="number" step="0.1"
            value="${WEEKLY_DATA[0]?.[fi]?.[oi]?.[mi] ?? 0}"
            oninput="updateOperatorMetric(${fi}, ${oi}, ${mi}, this.value)">
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
  if (!WEEKLY_DATA[0][facIdx]) WEEKLY_DATA[0][facIdx] = [];
  if (!WEEKLY_DATA[0][facIdx][opIdx]) WEEKLY_DATA[0][facIdx][opIdx] = Array(METRICS.length).fill(0);
  WEEKLY_DATA[0][facIdx][opIdx][metricIdx] = Number(value) || 0;
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
  await saveEditableData(); renderEditor(); refreshDashboard();
}

async function removeMetric(metricIdx) {
  if (!requireAdmin()) return;
  if (METRICS[metricIdx].type === 'score') return;
  if (!confirm(`Удалить показатель "${METRICS[metricIdx].label}"?`)) return;
  METRICS.splice(metricIdx, 1);
  WEEKLY_DATA[0].forEach(facRows => { facRows.forEach(row => row.splice(metricIdx, 1)); });
  await saveEditableData(); renderEditor(); refreshDashboard();
}

/* ── Init ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
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
  await Promise.all([renderStats(), renderScoreboard(), renderFacultyCards()]);
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
