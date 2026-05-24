/* ============================================================
   Конкурс Факультетов — app.js
   ============================================================
   Архитектура рассчитана на подключение FastAPI + PostgreSQL.

   Чтобы перейти на реальный бэкенд:
     1. Создайте файл api.js (шаблон в конце этого файла)
     2. Подключите его в index.html ДО app.js
     3. Установите USE_MOCK = false
   ============================================================ */

'use strict';

/* ── Config ─────────────────────────────────────────────────
   USE_MOCK = true  → данные берутся из MOCK_DATA ниже
   USE_MOCK = false → данные запрашиваются через API (api.js)
   ---------------------------------------------------------- */
const USE_MOCK = false;

/* ── API Base URL — укажите URL вашего бэкенда ───────────
   Локально:    'http://localhost:3000'
   На сервере:  'https://your-app.railway.app'  (и т.п.)
   -------------------------------------------------------- */
const API_BASE = window.location.origin;

const HOUSE_CRESTS = {
  gryf: 'assets/crest-gryffindor.png',
  slyth: 'assets/crest-slytherin.png',
  huff: 'assets/crest-hufflepuff.png',
};

/* ============================================================
   MOCK DATA
   Замените реальными вызовами через api.js когда будет готов бэкенд.

   Структура данных для одного оператора за неделю:
   [КЗЧ, QA, CSat, Эфф%, Часы%, Нарушения, Опоздания, Баллы]
   ============================================================ */
let FACULTIES = [
  { id: 'gryf',  cls: 'gryf',  icon: '🦁', crest: HOUSE_CRESTS.gryf,  name: 'Гриффиндор', tagCls: 'tag-gryf',  scoreCls: 'gryf-score',  operators: [] },
  { id: 'slyth', cls: 'slyth', icon: '🐍', crest: HOUSE_CRESTS.slyth, name: 'Слизерин',   tagCls: 'tag-slyth', scoreCls: 'slyth-score', operators: [] },
  { id: 'huff',  cls: 'huff',  icon: '🦡', crest: HOUSE_CRESTS.huff,  name: 'Пуффендуй',  tagCls: 'tag-huff',  scoreCls: 'huff-score',  operators: [] },
];

/* Weekly data: [week][faculty][operator] → [...метрики, Баллы]
   Заполняется исключительно через сервер (POST /api/state).
   Не хранится в localStorage. */
let WEEKLY_DATA = [ [], [], [], [] ];


/* Метрики соответствуют колонкам Excel «Таблица_для_конкурса.xlsx»:
   - 5 обычных показателей (количество звонков, оценка, выработка, эффективность)
   - 2 штрафа (опоздания в минутах, посторонние сайты — факты)
   - 1 итоговый балл (приходит из Excel, не вычисляется на сайте)
   Порядок в массиве задаёт порядок колонок в таблицах. */
const DEFAULT_METRICS = [
  { label: 'Качество',     type: 'metric'  },  // 0: значение качества (например 97.5)
  { label: 'Оценка',       type: 'metric'  },  // 1: оценка клиента (например 4.82)
  { label: 'Выработка %',  type: 'metric'  },  // 2: % выработки
  { label: 'Эфф. %',       type: 'metric'  },  // 3: эффективность %
  { label: 'Опозд. (мин)', type: 'penalty' },  // 4: минуты опозданий
  { label: 'Сайты',        type: 'penalty' },  // 5: факты посещения посторонних сайтов
  { label: 'Итого',        type: 'score'   },  // 6: итоговый балл из Excel
];

const ADMIN_SESSION_KEY = 'hpContestAdminUnlocked';
const ADMIN_PASSWORD_KEY = 'hpContestAdminToken';
let isAdmin = false;

/* Возвращает пароль администратора из sessionStorage.
   Пароль НЕ хранится в коде — он попадает сюда после ввода в модалке
   и существует только до закрытия вкладки. */
function getAdminPassword() {
  return sessionStorage.getItem(ADMIN_PASSWORD_KEY) || '';
}

let METRICS = DEFAULT_METRICS.map(m => ({ ...m }));

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

/* ── Debounce ───────────────────────────────────────────────
   При частом редактировании (например, оператор быстро вводит
   цифры) не хочется бить по серверу на каждое нажатие клавиши.
   Откладываем сохранение на 500мс после последнего изменения.
   Метод .flush() вызывает накопленный вызов немедленно — нужен
   на beforeunload, чтобы не потерять последние правки. */
function debounce(fn, delay = 500) {
  let timer = null;
  let lastArgs = null;
  let pendingResolve = null;
  let pendingReject = null;

  function fire() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pendingResolve) return Promise.resolve();
    const args = lastArgs;
    const resolve = pendingResolve;
    const reject = pendingReject;
    pendingResolve = null;
    pendingReject = null;
    return Promise.resolve()
      .then(() => fn.apply(null, args))
      .then(resolve, reject);
  }

  function debounced(...args) {
    lastArgs = args;
    if (timer) clearTimeout(timer);

    return new Promise((resolve, reject) => {
      if (pendingResolve) pendingResolve({ debounced: true });
      pendingResolve = resolve;
      pendingReject = reject;
      timer = setTimeout(() => { fire(); }, delay);
    });
  }

  debounced.flush = fire;
  debounced.hasPending = () => timer !== null;
  return debounced;
}

let savePending = false;

function setSaveIndicator(state) {
  // state: 'idle' | 'pending' | 'saved' | 'error'
  let el = document.getElementById('save-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'save-indicator';
    el.style.cssText = [
      'position:fixed','bottom:16px','left:16px','z-index:9998',
      'padding:8px 14px','border-radius:6px','font-family:Cinzel,serif',
      'font-size:12px','letter-spacing:.06em','pointer-events:none',
      'transition:opacity .25s ease','opacity:0',
    ].join(';');
    document.body.appendChild(el);
  }
  const palette = {
    pending: ['rgba(80,60,100,.85)', '#f4e8c1', '⟳ Сохраняю…'],
    saved:   ['rgba(40,100,60,.85)', '#f4e8c1', '✓ Сохранено'],
    error:   ['rgba(180,40,40,.9)',  '#f4e8c1', '✗ Ошибка сохранения'],
    idle:    ['', '', ''],
  };
  const [bg, fg, text] = palette[state] || palette.idle;
  if (state === 'idle') {
    el.style.opacity = '0';
    return;
  }
  el.style.background = bg;
  el.style.color = fg;
  el.textContent = text;
  el.style.opacity = '1';
  if (state === 'saved') {
    setTimeout(() => { el.style.opacity = '0'; }, 1500);
  }
}

function getScoreMetricIndex() {
  const idx = METRICS.findIndex(metric => metric.type === 'score');
  return idx === -1 ? METRICS.length - 1 : idx;
}

function getPublicMetrics() {
  return METRICS
    .map((metric, index) => ({ metric, index }))
    .filter(item => item.metric.type !== 'score');
}

function resetAllOperatorScores() {
  const scoreIdx = getScoreMetricIndex();
  WEEKLY_DATA.forEach(week => {
    week.forEach(facultyRows => {
      facultyRows.forEach(row => {
        row[scoreIdx] = 0;
      });
    });
  });
}

function normalizeEditableData() {
  const metricCount = METRICS.length;

  FACULTIES.forEach(fac => {
    fac.crest = HOUSE_CRESTS[fac.id] || fac.crest;
    // Операторы загружаются только с сервера — авто-дополнение отключено
  });

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
  // Единственный источник данных — сервер. localStorage не используется.
  const state = await api.loadState(); // выбросит исключение если сервер недоступен

  if (state && Array.isArray(state.faculties) && Array.isArray(state.weeklyData) && Array.isArray(state.metrics)) {
    FACULTIES   = state.faculties;
    WEEKLY_DATA = state.weeklyData;
    METRICS     = state.metrics;
    console.log('✅ Данные загружены с сервера');
  }
  // state === null означает: сервер работает, но данных ещё нет (первый запуск)
  // FACULTIES и WEEKLY_DATA остаются пустыми — это нормально

  if (!METRICS.some(m => m.type === 'score')) METRICS.push({ label: 'Баллы', type: 'score' });
  normalizeEditableData();
}

async function saveEditableData() {
  normalizeEditableData();
  const state = { faculties: FACULTIES, weeklyData: WEEKLY_DATA, metrics: METRICS };

  setSaveIndicator('pending');

  // Только сервер — никакого localStorage
  try {
    await api.saveState(state, getAdminPassword());
    console.log('✅ Данные сохранены на сервере');
    setSaveIndicator('saved');
  } catch (err) {
    console.error('❌ Ошибка сохранения:', err.message);
    setSaveIndicator('error');

    // Пароль протух или его подменили — выкидываем админа
    if (/пароль/i.test(err.message) || err.message.includes('403')) {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
      isAdmin = false;
      updateAdminGate();
      renderEditor();
      alert('⚠ Сессия администратора истекла. Войдите заново.');
      openAdminModal();
    } else {
      alert('⚠ Не удалось сохранить данные на сервере:\n' + err.message);
    }
    throw err;
  }
}

/* Debounced-версия сохранения. Используется при быстром вводе цифр
   в редакторе, чтобы не слать POST на каждое нажатие клавиши.
   Возвращает Promise, но при «отмене» (новый вызов до истечения delay)
   старый Promise резолвится с { debounced: true } — это нормально. */
const debouncedSave = debounce(() => saveEditableData(), 500);

/* Лёгкий refresh дашборда без перерисовки самого редактора —
   чтобы фокус инпута не терялся при наборе цифры. */
async function refreshDashboardOnly() {
  await Promise.all([
    renderScoreboard(currentWeek),
    renderFacultyCards(currentWeek),
  ]);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMetricValue(value, metric) {
  const number = Number(value) || 0;
  if (metric.type === 'penalty' && number > 0) return `-${fmtPts(number)}`;
  return fmtPts(number);
}

function loadAdminSession() {
  const flag = sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
  const hasPassword = !!sessionStorage.getItem(ADMIN_PASSWORD_KEY);
  isAdmin = flag && hasPassword;
  if (flag && !hasPassword) {
    // Несогласованное состояние (например, после обновления страницы из старой версии)
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
  }
}

function updateAdminGate() {
  const gateBtn = document.getElementById('admin-gate-btn');
  const loginArea = document.getElementById('admin-login-area');
  const activeArea = document.getElementById('admin-active-area');
  const error = document.getElementById('admin-error');

  if (gateBtn) {
    gateBtn.classList.toggle('unlocked', isAdmin);
    gateBtn.setAttribute('aria-label', isAdmin ? 'Режим администратора открыт' : 'Открыть режим администратора');
  }
  if (loginArea) loginArea.hidden = isAdmin;
  if (activeArea) activeArea.hidden = !isAdmin;
  if (error) error.textContent = '';
}

function openAdminModal() {
  const popover = document.getElementById('admin-popover');
  if (!popover) return;
  updateAdminGate();
  popover.hidden = false;

  if (!isAdmin) {
    const input = document.getElementById('admin-password');
    if (input) setTimeout(() => input.focus(), 0);
  }
}

function closeAdminModal() {
  const popover = document.getElementById('admin-popover');
  if (popover) popover.hidden = true;
}

function requireAdmin() {
  if (isAdmin) return true;
  openAdminModal();
  renderEditor();
  return false;
}

async function loginAdmin() {
  const input = document.getElementById('admin-password');
  const error = document.getElementById('admin-error');
  const submitBtn = document.querySelector('.admin-popover-submit');
  const password = input ? input.value : '';

  if (!password) {
    if (error) error.textContent = 'Введите пароль';
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Проверка…';
  }
  if (error) error.textContent = '';

  try {
    const ok = await api.verifyPassword(password);
    if (!ok) {
      if (error) error.textContent = 'Неверный пароль';
      if (input) input.value = '';
      return;
    }

    isAdmin = true;
    sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
    sessionStorage.setItem(ADMIN_PASSWORD_KEY, password);
    closeAdminModal();
    updateAdminGate();
    renderEditor();
    setDashboardMode(currentView);
  } catch (err) {
    console.error('Ошибка проверки пароля:', err);
    if (error) error.textContent = 'Сервер недоступен';
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Войти';
    }
  }
}

function logoutAdmin() {
  isAdmin = false;
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
  closeAdminModal();
  updateAdminGate();
  renderEditor();
  setDashboardMode(currentView);
}

/* ============================================================
   DATA LAYER
   При подключении FastAPI замените тело каждой функции на
   вызов соответствующего API-метода из api.js
   ============================================================ */

/**
 * Возвращает данные за указанную неделю (или все 4 недели).
 * @param {number} weekIdx — 0-3 конкретная неделя, 4 — итого
 * @returns {Promise<Array>} массив [{name, pts}] для каждого факультета
 *
 * API-замена (когда USE_MOCK = false):
 *   return api.getScores(weekIdx);
 *   → GET /api/v1/scores?week=<weekIdx>
 */
async function fetchScores(weekIdx) {
  if (!USE_MOCK) {
    // TODO: return await api.getScores(weekIdx);
  }
  return calcTotals(weekIdx);
}

/**
 * Возвращает итоговые очки факультета.
 * @param {number} facIdx
 * @param {number} weekIdx
 * @returns {Promise<number>}
 *
 * API-замена:
 *   return api.getFacultyTotal(facIdx, weekIdx);
 *   → GET /api/v1/faculties/<facIdx>/total?week=<weekIdx>
 */
async function fetchFacultyTotal(facIdx, weekIdx) {
  if (!USE_MOCK) {
    // TODO: return await api.getFacultyTotal(facIdx, weekIdx);
  }
  return getFacultyTotal(facIdx, weekIdx);
}

/* ============================================================
   MOCK CALCULATIONS (используются только при USE_MOCK = true)
   ============================================================ */
function calcTotals(weekIdx) {
  const scoreIdx = getScoreMetricIndex();
  return FACULTIES.map((fac, fi) =>
    fac.operators.map((name, oi) => ({
      name,
      pts: weekIdx < 4
        ? (Number(WEEKLY_DATA[weekIdx][fi][oi][scoreIdx]) || 0)
        : [0,1,2,3].reduce((s, w) => s + (Number(WEEKLY_DATA[w][fi][oi][scoreIdx]) || 0), 0),
    }))
  );
}

function getFacultyTotal(facIdx, weekIdx) {
  const scoreIdx = getScoreMetricIndex();

  /* Среднее ИТОГО по факультету.
     Учитываются только операторы с ненулевым баллом — пустые строки
     (например, оператор не работал в эту неделю) не размывают среднее. */
  function avgForWeek(w) {
    const rows = WEEKLY_DATA[w] && WEEKLY_DATA[w][facIdx] ? WEEKLY_DATA[w][facIdx] : [];
    const scores = rows
      .map(r => Number(r[scoreIdx]) || 0)
      .filter(v => v !== 0);
    if (scores.length === 0) return 0;
    return scores.reduce((s, v) => s + v, 0) / scores.length;
  }

  if (weekIdx < 4) return avgForWeek(weekIdx);

  /* Итоги месяца — среднее недельных средних по тем неделям, где есть данные. */
  const weeklyAverages = [0, 1, 2, 3].map(avgForWeek).filter(v => v !== 0);
  if (weeklyAverages.length === 0) return 0;
  return weeklyAverages.reduce((s, v) => s + v, 0) / weeklyAverages.length;
}

/* ============================================================
   RENDER HELPERS
   ============================================================ */
function fmtPts(v) {
  return Number.isInteger(v) ? v.toString() : v.toFixed(1);
}

function buildRankBadge(globalRank) {
  const cls = globalRank <= 3 ? `rank-${globalRank}` : 'rank-other';
  return `<span class="rank-badge ${cls}">${globalRank}</span>`;
}

function getPeriodLabel(weekIdx) {
  return weekIdx < 4 ? `Неделя ${weekIdx + 1}` : 'Итоги месяца';
}

function renderCrest(fac, className = 'faculty-crest-img') {
  if (!fac.crest) return fac.icon;
  return `<img class="${className}" src="${fac.crest}" alt="${escapeHtml(fac.name)}">`;
}

/* ── Scoreboard ─────────────────────────────────────────────── */
async function renderScoreboard(weekIdx) {
  const totals = await Promise.all(
    FACULTIES.map(async (f, i) => ({ ...f, total: await fetchFacultyTotal(i, weekIdx) }))
  );
  totals.sort((a, b) => b.total - a.total);
  const [first, second] = totals;
  const leaderDiff = second ? first.total - second.total : 0;
  const isMonthTotal = weekIdx === 4;
  const scoreItems = totals.map((fac, idx) => `
    <div class="score-faculty score-faculty-card">
      <div class="score-rank">#${idx + 1}</div>
      <div class="score-faculty-name">
        ${renderCrest(fac, 'score-crest-img')}
        <span>${fac.name}</span>
      </div>
      <div class="score-points ${fac.scoreCls}">${fmtPts(fac.total)}</div>
      <div class="score-caption">средний балл</div>
    </div>
  `).join('');

  document.getElementById('scoreboard').innerHTML = `
    <div class="scoreboard-header">
      <div>
        <div class="section-kicker">Командный зачёт</div>
        <h2 class="section-title">Общий рейтинг команд</h2>
      </div>
      <div class="score-summary">
        <span>${getPeriodLabel(weekIdx)}</span>
        <strong>Лидер: ${first.name}</strong>
        <span>${isMonthTotal ? 'Средний отрыв' : 'Отрыв от 2 места'}: +${fmtPts(leaderDiff)}</span>
      </div>
    </div>
    <div class="score-list">${scoreItems}</div>
  `;
}

/* ── Faculty Cards ──────────────────────────────────────────── */
async function renderFacultyCards(weekIdx) {
  const grid = document.getElementById('faculty-grid');
  const allTotals = await fetchScores(weekIdx);
  const maxPts = Math.max(1, ...allTotals.flat().map(o => o.pts));

  const colHeaders = weekIdx < 4
    ? METRICS.map(metric => `<th class="metric-col metric-${metric.type}">${escapeHtml(metric.label)}</th>`).join('')
    : '<th>Баллы (итого)</th>';

  let html = '';

  for (let fi = 0; fi < FACULTIES.length; fi++) {
    const fac = FACULTIES[fi];
    const facTotal = await fetchFacultyTotal(fi, weekIdx);
    const visibleOperators = fac.operators;

    const rows = visibleOperators.map((name, oi) => {
      const opTotal = allTotals[fi][oi]?.pts || 0;
      const pct = Math.round((opTotal / maxPts) * 100);
      let metricCells = '';

      if (weekIdx < 4) {
        const row = WEEKLY_DATA[weekIdx][fi][oi] || [];
        metricCells = METRICS.map((metric, index) => {
          const value = row[index] ?? 0;
          if (metric.type === 'score') {
            return `
              <td class="metric-score-cell">
                <div class="score-bar-wrap">
                  <div class="score-bar">
                    <div class="score-bar-fill" style="width:${pct}%"></div>
                  </div>
                  <span class="pts-value">${fmtPts(opTotal)}</span>
                </div>
              </td>`;
          }

          const cls = metric.type === 'penalty' && Number(value) > 0 ? ' class="neg"' : '';
          return `<td${cls}>${formatMetricValue(value, metric)}</td>`;
        }).join('');
      }

      return `
        <tr>
          <td class="operator-name-cell">${escapeHtml(name)}</td>
          ${weekIdx < 4 ? metricCells : `<td>
            <div class="score-bar-wrap">
              <div class="score-bar">
                <div class="score-bar-fill" style="width:${pct}%"></div>
              </div>
              <span class="pts-value">${fmtPts(opTotal)}</span>
            </div>
          </td>`}
        </tr>`;
    }).join('');

    html += `
      <div class="faculty-card ${fac.cls}">
        <div class="faculty-header">
          <div class="faculty-header-left">
            <div class="faculty-crest">${renderCrest(fac)}</div>
            <div class="faculty-name">${fac.name}</div>
          </div>
          <div>
            <div class="faculty-total">${fmtPts(facTotal)}</div>
            <div class="faculty-total-label">средний балл</div>
          </div>
        </div>
        <div class="faculty-table-wrap">
          <table class="operators">
            <thead>
              <tr><th>Оператор</th>${colHeaders}</tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  grid.innerHTML = html;
}
/* ── Editor ───────────────────────────────────────────────── */
async function refreshDashboard() {
  await Promise.all([
    renderScoreboard(currentWeek),
    renderFacultyCards(currentWeek),
  ]);
}

function renderEditor() {
  const panel = document.getElementById('editor-panel');
  if (!panel) return;

  if (!isAdmin) {
    panel.innerHTML = '';
    return;
  }

  const editWeek = currentWeek < 4 ? currentWeek : 0;
  const weekOptions = [0,1,2,3].map(idx =>
    `<option value="${idx}" ${idx === editWeek ? 'selected' : ''}>Неделя ${idx + 1}</option>`
  ).join('');

  const metricsRows = METRICS.map((metric, mi) => `
    <div class="metric-editor-row">
      <input class="editor-input" value="${escapeHtml(metric.label)}"
        oninput="updateMetricLabel(${mi}, this.value)" aria-label="Название показателя">
      <select class="editor-select" onchange="updateMetricType(${mi}, this.value)" ${metric.type === 'score' ? 'disabled' : ''}>
        <option value="metric" ${metric.type === 'metric' ? 'selected' : ''}>Показатель</option>
        <option value="penalty" ${metric.type === 'penalty' ? 'selected' : ''}>Штраф</option>
        <option value="score" ${metric.type === 'score' ? 'selected' : ''}>Баллы</option>
      </select>
      <button class="editor-icon-btn danger" onclick="removeMetric(${mi})" ${metric.type === 'score' ? 'disabled' : ''} title="Удалить показатель">×</button>
    </div>
  `).join('');

  const facultyEditors = FACULTIES.map((fac, fi) => {
    const rows = fac.operators.map((name, oi) => {
      const cells = METRICS.map((metric, mi) => `
        <td>
          <input class="metric-value-input" type="number" step="0.1"
            value="${WEEKLY_DATA[editWeek][fi][oi][mi] ?? 0}"
            oninput="updateOperatorMetric(${editWeek}, ${fi}, ${oi}, ${mi}, this.value)"
            aria-label="${escapeHtml(metric.label)}">
        </td>
      `).join('');

      return `
        <tr>
          <td>
            <input class="operator-name-input" value="${escapeHtml(name)}"
              oninput="updateOperatorName(${fi}, ${oi}, this.value)" aria-label="Имя оператора">
          </td>
          ${cells}
          <td>
            <button class="editor-icon-btn danger" onclick="clearOperatorMetrics(${fi}, ${oi})" title="Очистить показатели оператора">⊘</button>
            <button class="editor-icon-btn danger" onclick="removeOperator(${fi}, ${oi})" title="Удалить оператора полностью">🗑</button>
          </td>
        </tr>`;
    }).join('');

    return `
      <div class="editor-faculty ${fac.cls}">
        <div class="editor-faculty-header">
          <div class="editor-faculty-name">${escapeHtml(fac.name)}</div>
          <div class="editor-faculty-actions">
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
                ${METRICS.map(metric => `<th class="metric-col metric-${metric.type}">${escapeHtml(metric.label)}</th>`).join('')}
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
        <div class="editor-title">Управление показателями</div>
        <div class="editor-subtitle">Все изменения сохраняются в этом браузере</div>
      </div>
      <label class="editor-week-label">
        Неделя
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

    <div class="editor-faculties">${facultyEditors}</div>
  `;
}

function updateOperatorName(facIdx, opIdx, value) {
  if (!requireAdmin()) return;
  FACULTIES[facIdx].operators[opIdx] = value.trim() || `Оператор ${opIdx + 1}`;
  // Имена показываются в дашборде → перерисовываем его, но без редактора
  refreshDashboardOnly();
  debouncedSave();
}

function updateOperatorMetric(weekIdx, facIdx, opIdx, metricIdx, value) {
  if (!requireAdmin()) return;
  WEEKLY_DATA[weekIdx][facIdx][opIdx][metricIdx] = Number(value) || 0;
  refreshDashboardOnly();
  debouncedSave();
}

async function addOperator(facIdx) {
  if (!requireAdmin()) return;
  const input = document.getElementById(`new-operator-${facIdx}`);
  const name = input.value.trim();
  if (!name) return;

  FACULTIES[facIdx].operators.push(name);
  WEEKLY_DATA.forEach(week => {
    week[facIdx].push(Array(METRICS.length).fill(0));
  });

  await saveEditableData();
  renderEditor();
  refreshDashboard();
}

async function clearOperatorMetrics(facIdx, opIdx) {
  if (!requireAdmin()) return;
  const name = FACULTIES[facIdx].operators[opIdx];
  if (!confirm(`Очистить все показатели оператора "${name}" за 4 недели? Имя оператора останется в списке.`)) return;

  WEEKLY_DATA.forEach(week => {
    if (week[facIdx] && week[facIdx][opIdx]) {
      week[facIdx][opIdx] = Array(METRICS.length).fill(0);
    }
  });

  await saveEditableData();
  renderEditor();
  refreshDashboard();
}

async function removeOperator(facIdx, opIdx) {
  if (!requireAdmin()) return;
  const name = FACULTIES[facIdx].operators[opIdx];
  if (!confirm(`Удалить оператора "${name}" полностью? Все его данные за все недели будут удалены без возможности восстановления.`)) return;

  // Удаляем оператора из всех недель
  WEEKLY_DATA.forEach(week => {
    if (week[facIdx]) {
      week[facIdx].splice(opIdx, 1);
    }
  });

  // Удаляем имя из списка операторов факультета
  FACULTIES[facIdx].operators.splice(opIdx, 1);

  await saveEditableData();
  renderEditor();
  refreshDashboard();
}
async function clearFacultyMetrics(facIdx, weekIdx = currentWeek < 4 ? currentWeek : 0) {
  if (!requireAdmin()) return;
  const fac = FACULTIES[facIdx];
  const week = WEEKLY_DATA[weekIdx];
  if (!fac || !week || !week[facIdx]) return;
  if (!confirm(`Очистить все показатели всех операторов группы "${fac.name}" только за неделю ${weekIdx + 1}? Имена операторов останутся.`)) return;

  fac.operators.forEach((_, opIdx) => {
    week[facIdx][opIdx] = Array(METRICS.length).fill(0);
  });

  await saveEditableData();
  renderEditor();
  refreshDashboard();
}
function updateMetricLabel(metricIdx, value) {
  if (!requireAdmin()) return;
  METRICS[metricIdx].label = value.trim() || `Показатель ${metricIdx + 1}`;
  refreshDashboardOnly();
  debouncedSave();
}

async function updateMetricType(metricIdx, value) {
  if (!requireAdmin()) return;
  if (METRICS[metricIdx].type === 'score') return;
  METRICS[metricIdx].type = value === 'penalty' ? 'penalty' : 'metric';
  await saveEditableData();
  refreshDashboard();
}

async function addMetric() {
  if (!requireAdmin()) return;
  const nameInput = document.getElementById('new-metric-name');
  const typeInput = document.getElementById('new-metric-type');
  const label = nameInput.value.trim();
  if (!label) return;

  const insertAt = getScoreMetricIndex();
  METRICS.splice(insertAt, 0, {
    label,
    type: typeInput.value === 'penalty' ? 'penalty' : 'metric',
  });

  WEEKLY_DATA.forEach(week => {
    week.forEach(facRows => {
      facRows.forEach(row => row.splice(insertAt, 0, 0));
    });
  });

  await saveEditableData();
  renderEditor();
  refreshDashboard();
}

async function removeMetric(metricIdx) {
  if (!requireAdmin()) return;
  if (METRICS[metricIdx].type === 'score') return;
  if (!confirm(`Удалить показатель "${METRICS[metricIdx].label}" из всех операторов за 4 недели?`)) return;

  METRICS.splice(metricIdx, 1);
  WEEKLY_DATA.forEach(week => {
    week.forEach(facRows => {
      facRows.forEach(row => row.splice(metricIdx, 1));
    });
  });

  await saveEditableData();
  renderEditor();
  refreshDashboard();
}

/* ============================================================
   NAVIGATION
   ============================================================ */
let currentWeek = 0;
let currentView = 'week';

function setActiveTab(view, weekIdx = null) {
  document.querySelectorAll('.week-tab').forEach(tab => {
    const isWeek = view === 'week' && tab.dataset.week === String(weekIdx);
    tab.classList.toggle('active', isWeek);
  });
}

function setDashboardMode(view) {
  currentView = view;
  const sections = [
    ['editor-panel', isAdmin],
    ['scoreboard', true],
    ['faculty-grid', true],
  ];

  sections.forEach(([id, visible]) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !visible;
  });

  document.querySelectorAll('.details-intro').forEach(el => {
    el.hidden = false;
  });
}

async function showWeek(idx) {
  currentWeek = idx;
  setDashboardMode('week');
  setActiveTab('week', idx);

  await Promise.all([
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
    console.error('Не удалось загрузить данные с сервера:', err);
    // Показываем баннер ошибки — данные не грузятся из локалки
    const banner = document.createElement('div');
    banner.style.cssText = [
      'position:fixed','top:0','left:0','right:0','z-index:9999',
      'background:#740001','color:#f4e8c1','font-family:Cinzel,serif',
      'font-size:13px','text-align:center','padding:10px 16px',
      'letter-spacing:.05em','cursor:pointer',
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

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeAdminModal();
});

document.addEventListener('click', event => {
  const gate = document.getElementById('admin-gate');
  const popover = document.getElementById('admin-popover');
  if (!gate || !popover || popover.hidden) return;
  if (!gate.contains(event.target)) closeAdminModal();
});

/* При закрытии вкладки с несохранёнными правками — попытаемся сохранить
   и предупредим пользователя, если есть pending-debounce. */
window.addEventListener('beforeunload', (event) => {
  if (debouncedSave.hasPending()) {
    debouncedSave.flush();
    event.preventDefault();
    event.returnValue = '';
    return '';
  }
});


/* ============================================================
   ШАБЛОН api.js (создайте отдельный файл когда будет готов бэкенд)
   ============================================================

// api.js — подключить в index.html перед app.js
// <script src="js/api.js"></script>

const API_BASE = 'http://localhost:8000/api/v1';

const api = {
  // GET /api/v1/scores?week=<weekIdx>
  // Ответ: { faculties: [ { id, operators: [{name, pts}] } ] }
  async getScores(weekIdx) {
    const res = await fetch(`${API_BASE}/scores?week=${weekIdx}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    return data.faculties.map(f => f.operators);
  },

  // GET /api/v1/faculties/<facIdx>/total?week=<weekIdx>
  // Ответ: { total: 12345.5 }
  async getFacultyTotal(facIdx, weekIdx) {
    const res = await fetch(`${API_BASE}/faculties/${facIdx}/total?week=${weekIdx}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    return data.total;
  },
};

============================================================ */
