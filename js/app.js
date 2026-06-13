/* ============================================================
   Дивергент: Конкурс Операторов — app.js v2
   Одна конкурсная неделя, две публикации: промежуточная и итоговая.
   ============================================================ */

'use strict';

/* ── Config ────────────────────────────────────────────────── */
const USE_MOCK = false;
const API_BASE = window.location.origin;

/* ── Фракции Дивергента ───────────────────────────────────── */
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

/* Два слота: 0 = промежуточные (18.06), 1 = итоговые (23.06) */
let WEEKLY_DATA = [ [], [] ];

/* Метрики */
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

const PUB_LABELS = [
  { date: '18.06', name: 'Промежуточные результаты', badge: 'Результаты предварительные' },
  { date: '23.06', name: 'Итоговые результаты',       badge: 'Финальные результаты конкурсной недели' },
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
    pending: ['rgba(21,88,168,.9)',  '#e4e4f0', '⟳ Сохраняю…'],
    saved:   ['rgba(26,128,64,.9)',  '#e4e4f0', '✓ Сохранено'],
    error:   ['rgba(180,30,30,.95)', '#e4e4f0', '✗ Ошибка сохранения'],
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

function normalizeEditableData() {
  const metricCount = METRICS.length;
  FACULTIES.forEach(fac => { fac.crest = null; });

  // Убедиться что у нас ровно 2 слота
  while (WEEKLY_DATA.length < 2) WEEKLY_DATA.push([]);

  WEEKLY_DATA.forEach((week, wi) => {
    if (!week) WEEKLY_DATA[wi] = [];
    FACULTIES.forEach((fac, fi) => {
      if (!WEEKLY_DATA[wi][fi]) WEEKLY_DATA[wi][fi] = [];
      fac.operators.forEach((_, oi) => {
        if (!WEEKLY_DATA[wi][fi][oi]) WEEKLY_DATA[wi][fi][oi] = Array(metricCount).fill(0);
        while (WEEKLY_DATA[wi][fi][oi].length < metricCount) {
          WEEKLY_DATA[wi][fi][oi].splice(getScoreMetricIndex(), 0, 0);
        }
        if (WEEKLY_DATA[wi][fi][oi].length > metricCount) {
          WEEKLY_DATA[wi][fi][oi].length = metricCount;
        }
      });
      if (WEEKLY_DATA[wi][fi].length > fac.operators.length) {
        WEEKLY_DATA[wi][fi].length = fac.operators.length;
      }
    });
  });
}

async function loadEditableData() {
  const state = await api.loadState();
  if (state && Array.isArray(state.faculties) && Array.isArray(state.weeklyData) && Array.isArray(state.metrics)) {
    FACULTIES   = state.faculties;
    WEEKLY_DATA = state.weeklyData;
    METRICS     = state.metrics;
    console.log('✅ Данные загружены с сервера');
  }
  if (!METRICS.some(m => m.type === 'score')) METRICS.push({ label: 'Итого', type: 'score' });
  normalizeEditableData();
}

async function saveEditableData() {
  normalizeEditableData();
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
    renderStats(currentWeek),
    renderScoreboard(currentWeek),
    renderFacultyCards(currentWeek),
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

/* ── Admin Session ──────────────────────────────────────────── */
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
  if (btn) { btn.classList.toggle('unlocked', isAdmin); }
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
    closeAdminModal(); updateAdminGate(); renderEditor(); setDashboardMode(currentView);
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
  closeAdminModal(); updateAdminGate(); renderEditor(); setDashboardMode(currentView);
}

/* ── Data Layer ─────────────────────────────────────────────── */
async function fetchScores(weekIdx) {
  return calcTotals(weekIdx);
}

async function fetchFacultyTotal(facIdx, weekIdx) {
  return getFacultyTotal(facIdx, weekIdx);
}

function calcTotals(weekIdx) {
  const si = getScoreMetricIndex();
  const wi = Math.min(weekIdx, WEEKLY_DATA.length - 1);
  return FACULTIES.map((fac, fi) =>
    fac.operators.map((name, oi) => ({
      name,
      pts: Number(WEEKLY_DATA[wi]?.[fi]?.[oi]?.[si]) || 0,
    }))
  );
}

function getFacultyTotal(facIdx, weekIdx) {
  const si = getScoreMetricIndex();
  const wi = Math.min(weekIdx, WEEKLY_DATA.length - 1);
  const rows = WEEKLY_DATA[wi]?.[facIdx] ?? [];
  const scores = rows.map(r => Number(r[si]) || 0).filter(v => v !== 0);
  if (scores.length === 0) return 0;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

/* ── Render Helpers ─────────────────────────────────────────── */
function buildRankBadge(rank) {
  const cls = rank <= 3 ? `rank-${rank}` : 'rank-other';
  return `<span class="rank-badge ${cls}">${rank}</span>`;
}

/* ── Stats ──────────────────────────────────────────────────── */
async function renderStats(weekIdx) {
  const el = document.getElementById('stats-section');
  if (!el) return;

  const allTotals = await fetchScores(weekIdx);
  const allPts = allTotals.flat().map(o => o.pts);
  const totalOps = FACULTIES.reduce((s, f) => s + f.operators.length, 0);
  const activePts = allPts.filter(p => p > 0);
  const avgAll = activePts.length ? activePts.reduce((s, v) => s + v, 0) / activePts.length : 0;
  const bestPts = activePts.length ? Math.max(...activePts) : 0;

  // Лидирующая фракция
  const facTotals = await Promise.all(FACULTIES.map((_, fi) => fetchFacultyTotal(fi, weekIdx)));
  const leaderIdx = facTotals.indexOf(Math.max(...facTotals));
  const leader = FACULTIES[leaderIdx];

  // Лучший оператор
  let bestOp = '—';
  allTotals.forEach((facArr, fi) => {
    facArr.forEach(op => {
      if (op.pts === bestPts && bestPts > 0) bestOp = op.name;
    });
  });

  // Нарушения: сумма всех penalty-метрик
  const wi = Math.min(weekIdx, WEEKLY_DATA.length - 1);
  let violations = 0;
  METRICS.forEach((m, mi) => {
    if (m.type === 'penalty') {
      WEEKLY_DATA[wi]?.forEach(facRows => {
        facRows.forEach(row => { violations += Number(row[mi]) || 0; });
      });
    }
  });

  const now = new Date();
  const updated = `${now.getDate().toString().padStart(2,'0')}.${(now.getMonth()+1).toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Всего участников</div>
        <div class="stat-value">${totalOps}</div>
        <div class="stat-note">${FACULTIES.map(f => f.name + ' · ' + f.operators.length).join('  ')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Лидирующая фракция</div>
        <div class="stat-value highlight">${leader ? leader.icon + ' ' + leader.name : '—'}</div>
        <div class="stat-note">Средний балл: ${fmtPts(Math.max(...facTotals))}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Лучший оператор</div>
        <div class="stat-value" style="font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${bestOp}</div>
        <div class="stat-note">Баллы: ${fmtPts(bestPts)}</div>
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
      <div class="stat-card">
        <div class="stat-label">Последнее обновление</div>
        <div class="stat-value" style="font-size:18px">${updated}</div>
        <div class="stat-note">${PUB_LABELS[Math.min(weekIdx, 1)].badge}</div>
      </div>
    </div>
  `;
}

/* ── Scoreboard ─────────────────────────────────────────────── */
async function renderScoreboard(weekIdx) {
  const sb = document.getElementById('scoreboard');
  if (!sb) return;

  const totals = await Promise.all(
    FACULTIES.map(async (f, i) => ({ ...f, avgTotal: await fetchFacultyTotal(i, weekIdx), count: f.operators.length }))
  );

  const allTotals = await fetchScores(weekIdx);
  totals.forEach((fac, fi_orig) => {
    const fi = FACULTIES.findIndex(f => f.id === fac.id);
    fac.sumTotal = allTotals[fi]?.reduce((s, o) => s + o.pts, 0) || 0;
  });

  totals.sort((a, b) => b.avgTotal - a.avgTotal);

  const pub = PUB_LABELS[Math.min(weekIdx, 1)];
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
        <span>${pub.date} · ${pub.name}</span>
        <strong>Лидер: ${first?.name || '—'}</strong>
        <span>Отрыв от 2 места: +${fmtPts(diff)}</span>
      </div>
    </div>
    <div class="score-list">${cards}</div>
  `;
}

/* ── Faculty Cards ──────────────────────────────────────────── */
async function renderFacultyCards(weekIdx) {
  const grid = document.getElementById('faction-grid');
  if (!grid) return;

  const allTotals = await fetchScores(weekIdx);
  const maxPts = Math.max(1, ...allTotals.flat().map(o => o.pts));
  const wi = Math.min(weekIdx, WEEKLY_DATA.length - 1);

  const colHeaders = METRICS.map(m => `<th class="metric-col metric-${m.type}">${escapeHtml(m.label)}</th>`).join('');

  let html = '';

  for (let fi = 0; fi < FACULTIES.length; fi++) {
    const fac = FACULTIES[fi];
    const facTotal = await fetchFacultyTotal(fi, weekIdx);

    // Сортируем операторов по баллу для ранжирования
    const scoreIdx = getScoreMetricIndex();
    const opsWithRank = fac.operators.map((name, oi) => ({
      name, oi,
      pts: allTotals[fi][oi]?.pts || 0,
    }));
    opsWithRank.sort((a, b) => b.pts - a.pts);

    // Глобальный ранг среди всех операторов всех фракций
    const allOpsPts = allTotals.flat().map(o => o.pts).sort((a, b) => b - a);
    function globalRank(pts) {
      if (pts <= 0) return null;
      return allOpsPts.indexOf(pts) + 1;
    }

    const rows = opsWithRank.map(({ name, oi, pts }, sortIdx) => {
      const pct = Math.round((pts / maxPts) * 100);
      const localRank = sortIdx + 1;
      const grank = globalRank(pts);
      const topCls = localRank <= 3 ? ` top${localRank}` : '';

      const row = WEEKLY_DATA[wi]?.[fi]?.[oi] || [];
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

      const rankBadge = buildRankBadge(localRank);

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
    renderStats(currentWeek),
    renderScoreboard(currentWeek),
    renderFacultyCards(currentWeek),
  ]);
}

function renderEditor() {
  const panel = document.getElementById('editor-panel');
  if (!panel) return;
  if (!isAdmin) { panel.innerHTML = ''; return; }

  const editWeek = Math.min(currentWeek, 1);
  const weekOptions = [0, 1].map(idx =>
    `<option value="${idx}" ${idx === editWeek ? 'selected' : ''}>${PUB_LABELS[idx].date} — ${PUB_LABELS[idx].name}</option>`
  ).join('');

  const metricsRows = METRICS.map((metric, mi) => `
    <div class="metric-editor-row">
      <input class="editor-input" value="${escapeHtml(metric.label)}"
        oninput="updateMetricLabel(${mi}, this.value)" aria-label="Название показателя">
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
            value="${WEEKLY_DATA[editWeek]?.[fi]?.[oi]?.[mi] ?? 0}"
            oninput="updateOperatorMetric(${editWeek}, ${fi}, ${oi}, ${mi}, this.value)"
            aria-label="${escapeHtml(metric.label)}">
        </td>
      `).join('');
      return `
        <tr>
          <td>
            <input class="operator-name-input" value="${escapeHtml(name)}"
              oninput="updateOperatorName(${fi}, ${oi}, this.value)">
          </td>
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
            <button class="editor-btn danger-soft" onclick="clearFacultyMetrics(${fi}, ${editWeek})">Очистить группу</button>
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
      <label class="editor-week-label">
        Публикация:
        <select class="editor-select" onchange="showWeek(Number(this.value))">${weekOptions}</select>
      </label>
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

/* ── Operator CRUD ──────────────────────────────────────────── */
function updateOperatorName(facIdx, opIdx, value) {
  if (!requireAdmin()) return;
  FACULTIES[facIdx].operators[opIdx] = value.trim() || `Оператор ${opIdx + 1}`;
  refreshDashboardOnly(); debouncedSave();
}

function updateOperatorMetric(weekIdx, facIdx, opIdx, metricIdx, value) {
  if (!requireAdmin()) return;
  if (!WEEKLY_DATA[weekIdx]) WEEKLY_DATA[weekIdx] = [];
  if (!WEEKLY_DATA[weekIdx][facIdx]) WEEKLY_DATA[weekIdx][facIdx] = [];
  if (!WEEKLY_DATA[weekIdx][facIdx][opIdx]) WEEKLY_DATA[weekIdx][facIdx][opIdx] = Array(METRICS.length).fill(0);
  WEEKLY_DATA[weekIdx][facIdx][opIdx][metricIdx] = Number(value) || 0;
  refreshDashboardOnly(); debouncedSave();
}

async function addOperator(facIdx) {
  if (!requireAdmin()) return;
  const input = document.getElementById(`new-operator-${facIdx}`);
  const name = input.value.trim();
  if (!name) return;
  FACULTIES[facIdx].operators.push(name);
  WEEKLY_DATA.forEach(week => {
    if (!week[facIdx]) week[facIdx] = [];
    week[facIdx].push(Array(METRICS.length).fill(0));
  });
  await saveEditableData(); renderEditor(); refreshDashboard();
}

async function clearOperatorMetrics(facIdx, opIdx) {
  if (!requireAdmin()) return;
  const name = FACULTIES[facIdx].operators[opIdx];
  if (!confirm(`Очистить показатели оператора "${name}" за обе публикации?`)) return;
  WEEKLY_DATA.forEach(week => {
    if (week[facIdx]?.[opIdx]) week[facIdx][opIdx] = Array(METRICS.length).fill(0);
  });
  await saveEditableData(); renderEditor(); refreshDashboard();
}

async function removeOperator(facIdx, opIdx) {
  if (!requireAdmin()) return;
  const name = FACULTIES[facIdx].operators[opIdx];
  if (!confirm(`Удалить оператора "${name}" полностью?`)) return;
  WEEKLY_DATA.forEach(week => { if (week[facIdx]) week[facIdx].splice(opIdx, 1); });
  FACULTIES[facIdx].operators.splice(opIdx, 1);
  await saveEditableData(); renderEditor(); refreshDashboard();
}

async function clearFacultyMetrics(facIdx, weekIdx = currentWeek) {
  if (!requireAdmin()) return;
  const fac = FACULTIES[facIdx];
  const wi = Math.min(weekIdx, WEEKLY_DATA.length - 1);
  if (!confirm(`Очистить показатели группы "${fac.name}" за ${PUB_LABELS[wi].date}?`)) return;
  fac.operators.forEach((_, oi) => {
    if (WEEKLY_DATA[wi]?.[facIdx]) WEEKLY_DATA[wi][facIdx][oi] = Array(METRICS.length).fill(0);
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
  WEEKLY_DATA.forEach(week => {
    week.forEach(facRows => { facRows.forEach(row => row.splice(insertAt, 0, 0)); });
  });
  await saveEditableData(); renderEditor(); refreshDashboard();
}

async function removeMetric(metricIdx) {
  if (!requireAdmin()) return;
  if (METRICS[metricIdx].type === 'score') return;
  if (!confirm(`Удалить показатель "${METRICS[metricIdx].label}"?`)) return;
  METRICS.splice(metricIdx, 1);
  WEEKLY_DATA.forEach(week => {
    week.forEach(facRows => { facRows.forEach(row => row.splice(metricIdx, 1)); });
  });
  await saveEditableData(); renderEditor(); refreshDashboard();
}

/* ── Navigation ─────────────────────────────────────────────── */
let currentWeek = 0;
let currentView = 'week';

function setActiveTab(weekIdx) {
  document.querySelectorAll('.pub-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.week === String(weekIdx));
  });
}

function updateStatusBar(weekIdx) {
  const bar = document.getElementById('status-bar');
  const label = document.getElementById('status-label');
  if (!bar || !label) return;
  const pub = PUB_LABELS[Math.min(weekIdx, 1)];
  label.textContent = `${pub.name} · ${pub.date} · ${pub.badge}`;
  bar.classList.toggle('final', weekIdx === 1);
}

function setDashboardMode(view) {
  currentView = view;
  const sections = [
    ['editor-panel', isAdmin],
    ['stats-section', true],
    ['scoreboard', true],
    ['faction-grid', true],
  ];
  sections.forEach(([id, vis]) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !vis;
  });
}

async function showWeek(idx) {
  currentWeek = idx;
  setDashboardMode('week');
  setActiveTab(idx);
  updateStatusBar(idx);
  await Promise.all([
    renderStats(idx),
    renderScoreboard(idx),
    renderFacultyCards(idx),
  ]);
  renderEditor();
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
      'letter-spacing:.05em','cursor:pointer','border-bottom:1px solid rgba(220,60,60,.4)',
    ].join(';');
    banner.textContent = '⚠ Сервер недоступен. Данные не загружены. Нажмите для повтора.';
    banner.onclick = () => { banner.remove(); location.reload(); };
    document.body.prepend(banner);
  }
  loadAdminSession();
  updateAdminGate();
  renderEditor();
  showWeek(0);
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAdminModal(); });
document.addEventListener('click', e => {
  const gate = document.getElementById('admin-gate');
  const pop = document.getElementById('admin-popover');
  if (!gate || !pop || pop.hidden) return;
  if (!gate.contains(e.target)) closeAdminModal();
});

window.addEventListener('beforeunload', e => {
  if (debouncedSave.hasPending()) {
    debouncedSave.flush(); e.preventDefault(); e.returnValue = ''; return '';
  }
});
