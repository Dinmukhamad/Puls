/**
 * Pulse — Main App v2
 * FastAPI backend, full admin panel per TZ
 */
'use strict';

/* ══════════════════════════════════════
   STATE
══════════════════════════════════════ */
let STATE = {
  user: null,
  wallet: null,
  rating: [],
  shopItems: [],
  purchases: [],
  dashboard: null,
  adminOperators: [],
  history: [],
  groups: [],
  currentView: 'cabinet',
};

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
          <p style="color:var(--danger)">Ошибка подключения: ${err.message}</p>
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

function navigateTo(view) {
  STATE.currentView = view;
  // Save to URL hash so F5 restores the same section
  history.replaceState(null, '', '#' + view);
  localStorage.setItem('pulse-last-view', view);
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.side-nav-link[data-nav-target]').forEach(l => {
    l.classList.toggle('active', l.dataset.navTarget === view);
  });
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.add('active');
  renderView(view);
}

function renderView(view) {
  switch (view) {
    case 'cabinet':  renderCabinet();  break;
    case 'rating':   renderRating();   break;
    case 'shop':     renderShop();     break;
    case 'summary':  renderSummary();  break;
    case 'operators': renderAdminOperators(); break;
    case 'manual':   renderManual();   break;
    case 'requests': renderRequests(); break;
    case 'history':  renderHistory();  break;
    case 'groups':   renderGroups();   break;
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
    api.logout().catch(() => {});
    STATE = { user:null, wallet:null, rating:[], shopItems:[], purchases:[], dashboard:null, adminOperators:[], history:[], groups:[], currentView:'cabinet' };
    location.reload();
  }
});

/* ══════════════════════════════════════
   BOOT APP
══════════════════════════════════════ */
async function bootApp() {
  const role = STATE.user?.role;
  buildViews(role);
  renderSidebar(role);
  setText('side-user', STATE.user?.full_name || STATE.user?.username || '');
  setText('side-role', roleLabel(role));
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

  // Restore last viewed section after F5 reload
  const savedView = location.hash.replace('#', '') || localStorage.getItem('pulse-last-view');
  const adminViews = ['summary','operators','manual','requests','history','groups','shop','rating','cabinet'];
  const operatorViews = ['cabinet','rating','shop'];
  const allowedViews = isAdmin(role) ? adminViews : operatorViews;
  const defaultView = isAdmin(role) ? 'summary' : 'cabinet';
  const start = (savedView && allowedViews.includes(savedView)) ? savedView : defaultView;
  navigateTo(start);
}

async function loadData(role) {
  const tasks = [
    api.getRating().catch(() => ({ items: [] })).then(r => STATE.rating = Array.isArray(r) ? r : (r.items || [])),
    api.listShopItems().catch(() => []).then(s => STATE.shopItems = s),
  ];
  if (role === 'operator') {
    tasks.push(api.myWallet().catch(() => null).then(w => STATE.wallet = w));
    tasks.push(api.listPurchases().catch(() => []).then(p => STATE.purchases = p));
  }
  if (isAdmin(role)) {
    tasks.push(api.getDashboard().catch(() => null).then(d => STATE.dashboard = d));
    tasks.push(
      fetch(api._base() + '/api/dashboard/operators', { headers: { 'Content-Type': 'application/json' }, credentials: 'include' })
        .then(r => r.ok ? r.json() : []).then(o => STATE.adminOperators = o).catch(() => [])
    );
    tasks.push(api.listPurchases().catch(() => []).then(p => STATE.purchases = p));
    tasks.push(
      fetch(api._base() + '/api/dashboard/history?limit=50', { headers: { 'Content-Type': 'application/json' }, credentials: 'include' })
        .then(r => r.ok ? r.json() : []).then(h => STATE.history = h).catch(() => [])
    );
  }
  await Promise.all(tasks);
}

async function reloadData() {
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
    ? ['summary', 'operators', 'manual', 'requests', 'shop', 'history', ...(canManageGroups(role) ? ['groups'] : []), 'cabinet', 'rating']
    : ['cabinet', 'rating', 'shop'];
  shell.innerHTML = views.map(v => `<section class="app-view" id="view-${v}"></section>`).join('');
}

function renderSidebar(role) {
  document.querySelectorAll('.side-nav-link[data-nav-target]').forEach(link => {
    const t = link.dataset.navTarget;
    const adminViews = ['summary','operators','manual','requests','history'];
    const operatorViews = ['cabinet','rating','shop'];
    const sharedViews = ['shop','rating','cabinet'];
    let show = false;
    if (isAdmin(role)) {
      show = adminViews.includes(t) || sharedViews.includes(t);
      if (canManageGroups(role)) show = show || t === 'groups';
    } else {
      show = operatorViews.includes(t);
    }
    link.style.display = show ? '' : 'none';
  });
}

/* ══════════════════════════════════════
   VIEW: КАБИНЕТ ОПЕРАТОРА
══════════════════════════════════════ */
function renderCabinet() {
  const el = document.getElementById('view-cabinet');
  if (!el) return;
  const w = STATE.wallet;
  if (!w) {
    el.innerHTML = `<div class="view-header"><div><div class="section-kicker">Кабинет</div><h2 class="section-title">Мой кабинет</h2></div></div>
      <div class="empty-state"><p>Данные загружаются…</p></div>`;
    api.myWallet().then(data => { STATE.wallet = data; renderCabinet(); }).catch(() => {});
    return;
  }

  const myRow = STATE.rating.find(r => r.operator_id === w.operator_id);
  const hasRank = myRow?.rank_position != null && Number(myRow.rank_position) > 0;
  const rank = hasRank ? Number(myRow.rank_position) : null;
  const total = STATE.rating.length || '—';
  const delta = myRow?.rank_delta;

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
    </div>

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
}

async function reloadCabinet() {
  STATE.wallet = await api.myWallet().catch(() => STATE.wallet);
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
    await fetch(api._base()+'/api/operators/account/change-password', {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
      body: JSON.stringify({current_password:current, new_password:newPwd, confirm_password:confirm})
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).detail); });
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
    const res = await fetch(api._base()+'/api/operators/account/change-username', {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
      body: JSON.stringify({new_username: newUsername})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail||'Ошибка');
    closeModal(); showToast('Логин успешно изменён', 'ok');
    STATE.user.username = newUsername;
    setText('side-user', STATE.user.full_name);
  } catch(e) { err.textContent=e.message; err.className='status-line status-error'; }
}

/* ══════════════════════════════════════
   VIEW: РЕЙТИНГ
══════════════════════════════════════ */
async function renderRating() {
  const el = document.getElementById('view-rating');
  if (!el) return;

  const role  = STATE.user?.role || 'operator';
  const isOp  = role === 'operator';
  const canSelectOperator = isAdmin(role);
  let selectedOpId = canSelectOperator ? null : (STATE.user?.operator_id || null);
  let searchVal = '';
  let filterGroup = '';
  let operatorSearchVal = '';
  let cmpMetric = 'points';
  let dynType = 'place';
  let personal = { myData: null, myTx: [], myDyn: null, myCmp: null };

  // Skeleton
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Рейтинг</div><h2 class="section-title">Турнирная таблица</h2></div>
      <div class="header-right"><button class="btn-outline btn-sm" onclick="renderRating()">Обновить</button></div>
    </div>
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

    const [ratingResp, nominationsResp] = await Promise.all([
      fetchRequired('/api/rating'),
      fetchOptional('/api/rating/nominations', { items: [] }),
    ]);

    const rows = Array.isArray(ratingResp.items) ? ratingResp.items : [];
    const total = ratingResp.total !== null && ratingResp.total !== undefined && ratingResp.total !== ''
      && Number.isFinite(Number(ratingResp.total)) ? Number(ratingResp.total) : rows.length;
    const period = ratingResp.period && ratingResp.period !== '—' ? ratingResp.period : 'Период пока не рассчитан';
    const updatedAt = ratingResp.updated_at || '';
    const groups = [...new Set(rows.map(r => r.group_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
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

    async function fetchPersonalData(opId) {
      if (!hasPersonalTarget(opId)) return { myData: null, myTx: [], myDyn: null, myCmp: null };
      const [myData, myTx, myDyn, myCmp] = await Promise.all([
        fetchOptional(pathWithParams('/api/rating/me', {}, opId), { no_operator: true }),
        fetchTransactionsData(opId),
        fetchDynamicsData(opId, dynType),
        fetchComparisonData(opId, cmpMetric),
      ]);
      return { myData, myTx, myDyn, myCmp };
    }

    personal = await fetchPersonalData(selectedOpId);

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

    function renderDynamics(data) {
      if (!data?.items?.length || data.items.length < 2) return `<div class="r-empty-state">
        <div class="r-empty-title">${canSelectOperator && !selectedOpId ? 'Выберите оператора' : 'Динамика пока недоступна'}</div>
        <div class="r-empty-sub">Появится после нескольких недель участия</div>
      </div>`;
      const items = data.items;
      const isPlace = data.type === 'place';
      const vals = items.map(i => Number(i.value) || 0);
      const minV = Math.min(...vals), maxV = Math.max(...vals);
      const range = maxV - minV || 1;
      const H = 82, W = 240;
      const pts = items.map((item, i) => {
        const value = Number(item.value) || 0;
        const norm = isPlace ? 1 - ((value - minV) / range) : ((value - minV) / range);
        const x = 8 + i * ((W - 16) / (items.length - 1));
        const y = 10 + ((1 - norm) * (H - 20));
        return { x, y, value, week: item.week || 'Неделя' };
      });
      return `<div class="dyn-chart-wrap">
        <svg class="dyn-chart" viewBox="0 0 ${W} 118" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
          ${pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--accent)"/>
            <text x="${p.x}" y="${Math.max(8, p.y - 8)}" text-anchor="middle" font-size="9" fill="var(--tx3)" font-family="Inter,sans-serif">${cleanNumber(p.value, dynType === 'place' ? 0 : 1)}</text>`).join('')}
          ${pts.map(p => `<text x="${p.x}" y="108" text-anchor="middle" font-size="8" fill="var(--tx3)" font-family="Inter,sans-serif">${esc(String(p.week).split('–')[0])}</text>`).join('')}
        </svg>
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
        (!filterGroup || r.group_name === filterGroup)
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
              <td class="name-cell">${esc(r.operator_name || 'Оператор')}${badgeText ? `<span class="me-badge">${badgeText}</span>` : ''}</td>
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
        <div class="view-header">
          <div><div class="section-kicker">Рейтинг</div><h2 class="section-title">Турнирная таблица</h2></div>
          <div class="header-right"><button class="btn-outline btn-sm" onclick="renderRating()">Обновить</button></div>
        </div>
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
              <div class="rcard-title-row">
                <span class="rcard-title">Динамика</span>
                <div class="metric-tabs" id="dyn-tabs">
                  <button class="metric-tab ${dynType === 'place' ? 'active' : ''}" data-type="place">Место</button>
                  <button class="metric-tab ${dynType === 'points' ? 'active' : ''}" data-type="points">Баллы</button>
                  <button class="metric-tab ${dynType === 'coins' ? 'active' : ''}" data-type="coins">Коины</button>
                </div>
              </div>
              <div id="dyn-body">${renderDynamics(personal.myDyn)}</div>
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
          personal.myCmp = await fetchComparisonData(selectedOpId, cmpMetric);
          if (body) body.innerHTML = renderComparison(personal.myCmp, cmpMetric);
        });
      });

      el.querySelectorAll('#dyn-tabs .metric-tab').forEach(btn => {
        btn.addEventListener('click', async () => {
          el.querySelectorAll('#dyn-tabs .metric-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          dynType = btn.dataset.type;
          const body = el.querySelector('#dyn-body');
          if (body) body.innerHTML = '<div class="rating-inline-skeleton"></div>';
          personal.myDyn = await fetchDynamicsData(selectedOpId, dynType);
          if (body) body.innerHTML = renderDynamics(personal.myDyn);
        });
      });

      el.querySelector('#rating-op-select')?.addEventListener('change', async e => {
        selectedOpId = e.target.value ? +e.target.value : null;
        personal = await fetchPersonalData(selectedOpId);
        buildPage();
      });
    }

    buildPage();

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
      <span class="mini-name">${esc(r.operator_name || 'Оператор')}</span>
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
  const canBuy = role === 'operator' && balance >= item.price;
  const needMore = role === 'operator' && balance < item.price ? item.price - balance : 0;
  return `<div class="shop-card ${canBuy?'shop-card-available':''}">
    <div class="shop-card-title">${esc(item.title)}</div>
    <div class="shop-card-desc">${esc(item.description)}</div>
    <div class="shop-card-price">${item.price} <span class="price-unit">коинов</span></div>
    <div class="shop-card-footer">
      ${role==='operator' ? `<button class="buy-btn ${canBuy?'btn-primary':'btn-disabled'}" data-id="${item.id}" ${canBuy?'':'disabled'}>
        ${canBuy ? 'Купить' : `Нужно ещё ${needMore} ₡`}</button>` : ''}
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
    api.getDashboard().then(data => { STATE.dashboard = data; renderSummary(); }).catch(() => {});
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
        ${d.pending_purchases_count > 0 ? `<div class="kpi-action"><button class="btn-link" onclick="navigateTo('requests')">Рассмотреть →</button></div>` : ''}
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
        <div class="panel-head"><h3>Последние действия</h3><button class="btn-link" onclick="navigateTo('history')">Все →</button></div>
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
  const el = document.getElementById('view-operators');
  if (!el) return;
  const ops = STATE.adminOperators;
  let searchVal = '';
  let filterGroup = '';
  let activeTab = 'all'; // all | participating | not_participating | dismissed

  const groups = [...new Set(ops.map(o => o.group_name).filter(Boolean))].sort();

  function isDismissed(o) {
    return o.employment_status === 'dismissed' || o.status === 'dismissed';
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
      const dismissed = isDismissed(o);
      const matchSearch = !searchVal || o.full_name.toLowerCase().includes(searchVal.toLowerCase())
        || (o.group_name || '').toLowerCase().includes(searchVal.toLowerCase());
      const matchGroup = !filterGroup || o.group_name === filterGroup;
      let matchTab = false;
      if (activeTab === 'all')               matchTab = !dismissed;
      else if (activeTab === 'participating') matchTab = !dismissed && o.participation_status === 'participating';
      else if (activeTab === 'not_participating') matchTab = !dismissed && o.participation_status === 'not_participating';
      else if (activeTab === 'dismissed')    matchTab = dismissed;
      return matchSearch && matchGroup && matchTab;
    });
  }

  function operatorActions(o) {
    const dismissed = isOperatorDismissed(o);
    const canManage = canManageOperators();
    const canCharge = !dismissed && o.participation_status === 'participating' && o.is_active;
    const chargeBtn = canCharge
      ? `<button class="btn-icon btn-ghost quick-charge-btn" data-id="${o.id}" title="Начислить коины" aria-label="Начислить коины">₡</button>`
      : '';
    const historyBtn = `<button class="btn-icon btn-ghost" onclick="showOperatorHistoryModal(${o.id})" title="История" aria-label="История">≡</button>`;

    if (!canManage) return `<div class="row-actions">${historyBtn}${chargeBtn}</div>`;

    if (dismissed) {
      return `
        <div class="row-actions">
          ${historyBtn}
          <button class="btn-icon btn-ghost" onclick="showRestoreOperatorModal(${o.id})" title="Восстановить" aria-label="Восстановить">↺</button>
          <button class="btn-icon btn-ghost danger" onclick="confirmDeleteOperator(${o.id})" title="Удалить" aria-label="Удалить">×</button>
        </div>`;
    }

    return `
      <div class="row-actions">
        <button class="btn-icon btn-ghost" onclick="showEditOperatorModal(${o.id})" title="Редактировать" aria-label="Редактировать">✎</button>
        <button class="btn-icon btn-ghost" onclick="resetOperatorPassword(${o.id})" title="Сбросить пароль" aria-label="Сбросить пароль">↻</button>
        <button class="btn-icon btn-ghost danger" onclick="confirmDismissOperator(${o.id})" title="Уволить" aria-label="Уволить">!</button>
        <button class="btn-icon btn-ghost danger" onclick="confirmDeleteOperator(${o.id})" title="Удалить" aria-label="Удалить">×</button>
        ${historyBtn}
        ${chargeBtn}
      </div>`;
  }

  function renderTable() {
    const list = filteredOps();
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>ФИО</th>
            <th>Группа</th>
            <th>Должность</th>
            <th>Статус</th>
            <th>Email</th>
            <th>Баланс</th>
            <th>Действия</th>
          </tr></thead>
          <tbody>
            ${list.length ? list.map(o => {
              const dismissed = isOperatorDismissed(o);
              return `<tr class="${dismissed ? 'operator-dismissed-row' : ''}">
                <td class="name-cell">
                  ${esc(o.full_name)}
                  ${o.username ? `<div class="cell-muted">${esc(o.username)}</div>` : ''}
                </td>
                <td>${esc(o.group_name)}</td>
                <td>${positionLabel(o.position || 'operator')}</td>
                <td>${operatorStatusBadge(o)}</td>
                <td>${o.email ? esc(o.email) : '<span class="cell-muted">—</span>'}</td>
                <td><b>${o.current_balance} ₡</b></td>
                <td>${operatorActions(o)}</td>
              </tr>`;
            }).join('') : '<tr><td colspan="7" class="empty-line">Нет операторов</td></tr>'}
          </tbody>
        </table>
      </div>`;
  }

  function renderTabsAndFilters() {
    const c = {
      all:               ops.filter(o => !isDismissed(o)).length,
      participating:     ops.filter(o => !isDismissed(o) && o.participation_status === 'participating').length,
      not_participating: ops.filter(o => !isDismissed(o) && o.participation_status === 'not_participating').length,
      dismissed:         ops.filter(o => isDismissed(o)).length,
    };
    const tabs = [
      { key: 'all',               label: 'Активные' },
      { key: 'participating',     label: 'Участвует' },
      { key: 'not_participating', label: 'Не участвует' },
      { key: 'dismissed',         label: 'Уволенные' },
    ];
    return tabs.map(t => `
      <button class="ops-tab ${activeTab===t.key?'ops-tab-active':''}" data-tab="${t.key}">
        ${t.label}<span class="ops-tab-badge ${activeTab===t.key?'ops-tab-badge-active':''}">${c[t.key]}</span>
      </button>`).join('');
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Операторы</div><h2 class="section-title">Список операторов</h2></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="exportCSV()">Экспорт CSV</button>
        <button class="btn-outline btn-sm" onclick="reloadData()">Обновить</button>
        ${canManageOperators() ? '<button class="btn-icon btn-primary operator-add-btn" onclick="showAddOperatorModal()" title="Добавить оператора" aria-label="Добавить оператора">+</button>' : ''}
      </div>
    </div>

    <div class="ops-tab-bar" id="ops-tab-bar">${renderTabsAndFilters()}</div>

    <div class="ops-filters-row">
      <input id="ops-search" class="form-input" placeholder="Поиск по ФИО или группе…" style="width:260px" value="${esc(searchVal)}">
      <select id="ops-group" class="form-select" style="width:180px">
        <option value="">Все группы</option>
        ${groups.map(g => `<option value="${esc(g)}" ${filterGroup===g?'selected':''}>${esc(g)}</option>`).join('')}
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
function renderManual() {
  const el = document.getElementById('view-manual');
  if (!el) return;

  // Load operators if empty
  if (!STATE.adminOperators.length) {
    el.innerHTML = `<div class="view-header"><div><div class="section-kicker">Начисление</div><h2 class="section-title">Ручное начисление коинов</h2></div></div><div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>`;
    fetch(api._base() + '/api/dashboard/operators', { headers: {'Content-Type':'application/json'}, credentials:'include' })
      .then(r => r.ok ? r.json() : [])
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
      .filter(t => t.type === 'manual_add' || t.type === 'manual_subtract')
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
          .filter(t => t.type === 'manual_add' || t.type === 'manual_subtract')
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
  let activeFilter = 'pending';

  function filtered() {
    if (activeFilter === 'all') return all;
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
          ${p.status === 'pending' ? `
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
        ['pending',  `Новые <span class="badge">${all.filter(p=>p.status==='pending').length}</span>`],
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
          await fetch(api._base() + `/api/shop/purchases/${btn.dataset.id}/complete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include'
          });
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
    weekly_accrual: 'Авт. начисление', manual_add: 'Ручное начисление',
    manual_subtract: 'Ручное списание', reserve: 'Резервирование',
    purchase: 'Покупка бонуса', refund: 'Возврат коинов',
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
    el.innerHTML = `
      <div class="view-header">
        <div><div class="section-kicker">Группы</div><h2 class="section-title">Управление группами</h2></div>
        <button class="btn-outline btn-sm" onclick="renderGroups()">Повторить</button>
      </div>
      <div class="status-line status-error" style="padding:20px">Не удалось загрузить список групп</div>`;
    return;
  }

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

function confirmDeleteOperator(id) {
  const op = STATE.adminOperators.find(o => o.id === id);
  showModal(`
    <h3 class="modal-title">Удалить оператора?</h3>
    <p style="color:var(--tx2);line-height:1.6">
      Это действие нельзя отменить. Удаление разрешено только для ошибочно созданных операторов без истории.
      Если история уже есть, система предложит использовать увольнение.
    </p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-danger" onclick="deleteOperator(${id})">Удалить</button>
    </div>`);
}

async function deleteOperator(id) {
  try {
    await api.deleteOperator(id);
    closeModal();
    showToast('Оператор удалён', 'ok');
    await reloadData();
  } catch(e) {
    showToast(e.message, 'error');
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

  showModal(
    '<h3 class="modal-title">Создание оператора</h3>' +
    '<div style="display:grid;gap:12px">' +
      '<div class="form-group">' +
        '<label class="form-label">ФИО <span style="color:var(--danger)">*</span></label>' +
        '<input id="new-op-name" class="form-input" placeholder="Иванов Иван Иванович">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Группа <span style="color:var(--danger)">*</span></label>' +
        groupField +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Статус участия <span style="color:var(--danger)">*</span></label>' +
        '<select id="new-op-status" class="form-select">' +
          '<option value="participating" selected>Участвует</option>' +
          '<option value="not_participating">Не участвует</option>' +
        '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Должность <span style="color:var(--danger)">*</span></label>' +
        '<select id="new-op-position" class="form-select">' +
          '<option value="operator" selected>Оператор</option>' +
          '<option value="chat_manager">Чат-менеджер</option>' +
        '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Email <span style="color:var(--tx3);font-weight:400;font-size:10px">(необязательно)</span></label>' +
        '<input id="new-op-email" class="form-input" type="email" placeholder="ivanov@company.com">' +
      '</div>' +
    '</div>' +
    '<div id="new-op-err" class="status-line" style="margin-top:8px"></div>' +
    '<button id="create-operator-btn" class="btn-primary" style="width:100%;height:44px;margin-top:4px" onclick="submitAddOperator()" disabled>Создать оператора</button>' +
    '<div style="font-size:11px;color:var(--tx3);margin-top:6px">После создания система автоматически сформирует логин и временный пароль.</div>'
  );

  const updateButton = () => {
    const btn = document.getElementById('create-operator-btn');
    const name = document.getElementById('new-op-name')?.value?.trim();
    const groupId = document.getElementById('new-op-group-id')?.value;
    const status = document.getElementById('new-op-status')?.value;
    const position = document.getElementById('new-op-position')?.value;
    if (btn) btn.disabled = !(name && name.length >= 2 && groupId && status && position);
  };
  ['new-op-name', 'new-op-group-id', 'new-op-status', 'new-op-position'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateButton);
    document.getElementById(id)?.addEventListener('change', updateButton);
  });
  updateButton();
}

async function submitAddOperator() {
  const name     = document.getElementById('new-op-name')?.value?.trim();
  const groupId  = document.getElementById('new-op-group-id')?.value;
  const status   = document.getElementById('new-op-status')?.value || 'participating';
  const position = document.getElementById('new-op-position')?.value || 'operator';
  const email    = document.getElementById('new-op-email')?.value?.trim() || null;
  const err      = document.getElementById('new-op-err');
  const btn      = document.getElementById('create-operator-btn');

  const setErr = msg => { err.textContent = msg; err.className = 'status-line status-error'; };

  if (!name || name.length < 2) return setErr('Укажите ФИО оператора');
  if (!groupId) return setErr('Выберите группу');
  if (!status) return setErr('Выберите статус участия');
  if (!position) return setErr('Выберите должность');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setErr('Введите корректный email');

  err.textContent = 'Создаём…'; err.className = 'status-line';
  if (btn) btn.disabled = true;

  try {
    const result = await api.createOperator({
      full_name: name,
      group_id: +groupId,
      participation_status: status,
      position: position,
      email: email || null,
    });

    const login = result.login || result.username;
    const temporaryPassword = result.temporary_password || result.temp_password;
    const groupName = result.group?.name || result.group_name || '';
    const credentialText = `Оператор: ${result.full_name}\nЛогин: ${login}\nВременный пароль: ${temporaryPassword}`;

    showModal(
      '<h3 class="modal-title" style="color:var(--ok)">Оператор успешно создан</h3>' +
      '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-md);padding:16px;display:grid;gap:8px;font-size:14px">' +
        '<div><span style="color:var(--tx3)">ФИО:</span> <b>' + esc(result.full_name) + '</b></div>' +
        '<div><span style="color:var(--tx3)">Группа:</span> <b>' + esc(groupName) + '</b></div>' +
        '<div><span style="color:var(--tx3)">Должность:</span> <b>' + positionLabel(result.position) + '</b></div>' +
        '<div><span style="color:var(--tx3)">Статус:</span> <b>' + participationStatusLabel(result.participation_status) + '</b></div>' +
        '<div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px">' +
          '<span style="color:var(--tx3)">Логин:</span> <b style="font-family:monospace;color:var(--accent)">' + esc(login) + '</b>' +
        '</div>' +
        '<div><span style="color:var(--tx3)">Временный пароль:</span> <b style="font-family:monospace;color:var(--accent)">' + esc(temporaryPassword) + '</b></div>' +
      '</div>' +
      '<button id="copy-created-credentials" class="btn-outline" style="width:100%">Скопировать данные для входа</button>' +
      '<button class="btn-primary" style="width:100%" onclick="closeModal()">Готово</button>'
    );
    document.getElementById('copy-created-credentials')?.addEventListener('click', () => {
      navigator.clipboard.writeText(credentialText).then(() => showToast('Скопировано!', 'ok'));
    });
    await reloadData();
  } catch(e) {
    setErr(e.message);
    if (btn) btn.disabled = false;
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
  showModal(`
    <h3 class="modal-title">Добавить бонус в магазин</h3>
    <div class="form-group"><label class="form-label">Название</label>
      <input id="ni-title" class="form-input" placeholder="Сертификат на кофе"></div>
    <div class="form-group"><label class="form-label">Описание</label>
      <input id="ni-desc" class="form-input" placeholder="Подарочная карта в кофейню"></div>
    <div class="form-group"><label class="form-label">Цена (коины)</label>
      <input id="ni-price" class="form-input" type="number" min="1" placeholder="120"></div>
    <div id="ni-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitAddItem()">Добавить</button>`);
}
async function submitAddItem() {
  const title = document.getElementById('ni-title')?.value?.trim();
  const desc  = document.getElementById('ni-desc')?.value?.trim() || '';
  const price = +document.getElementById('ni-price')?.value;
  const err   = document.getElementById('ni-err');
  if (!title || !price) { err.textContent = 'Заполните название и цену'; return; }
  try {
    await api.createShopItem({ title, description: desc, price });
    closeModal(); showToast('Бонус добавлен', 'ok');
    STATE.shopItems = await api.listShopItems(); renderShop();
  } catch(e) { err.textContent = e.message; }
}

function showEditItemModal(item) {
  showModal(`
    <h3 class="modal-title">Редактировать бонус</h3>
    <div class="form-group"><label class="form-label">Название</label>
      <input id="ei-title" class="form-input" value="${esc(item.title)}"></div>
    <div class="form-group"><label class="form-label">Описание</label>
      <input id="ei-desc" class="form-input" value="${esc(item.description)}"></div>
    <div class="form-group"><label class="form-label">Цена (коины)</label>
      <input id="ei-price" class="form-input" type="number" value="${item.price}"></div>
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
  const is_active = document.getElementById('ei-active')?.value === 'true';
  const err       = document.getElementById('ei-err');
  if (!title || !price) { err.textContent = 'Заполните поля'; return; }
  try {
    await api.updateShopItem(id, { title, description, price, is_active });
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
  return { pending:'Новая', approved:'Одобрена', rejected:'Отклонена', completed:'Выполнена' }[s] || s;
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
        Для продолжения работы в Pulse нужно заменить временный пароль.
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
    const res = await fetch(api._base() + '/api/auth/me/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ current_password: curPwd, new_password: newPwd, confirm_password: confPwd }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Ошибка');
    showToast('Пароль изменён. Войдите снова.', 'ok');
    closeModal(true);
    setTimeout(logoutAndReload, 900);
  } catch(e) {
    errEl.textContent = e.message;
    btn.disabled = false; btn.textContent = 'Сохранить пароль';
  }
}

async function logoutAndReload() {
  await api.logout().catch(() => {});
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
    const res = await fetch(api._base() + '/api/auth/me/login', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ new_login: newLogin, current_password: curPwd }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Ошибка');
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
    const res = await fetch(api._base() + '/api/auth/me/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ current_password: curPwd, new_password: newPwd, confirm_password: confPwd }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Ошибка');
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
