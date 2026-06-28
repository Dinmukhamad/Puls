/**
 * Puls — Main App v2
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
  currentView: 'cabinet',
  pendingManualOperatorId: null,
};

/* ══════════════════════════════════════
   BOOT
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initNav();
  if (api.getToken()) {
    await tryRestoreSession();
  } else {
    showAuth();
  }
});

async function tryRestoreSession() {
  const token = api.getToken();
  console.log('[puls] tryRestoreSession, token:', token ? token.slice(0,20)+'...' : 'EMPTY');
  
  if (!token) {
    console.log('[puls] No token → showAuth');
    showAuth();
    return;
  }

  try {
    console.log('[puls] Calling api.me()...');
    const u = await api.me();
    console.log('[puls] api.me() OK:', u);
    STATE.user = normalizeUser(u);
    await bootApp();
  } catch(err) {
    console.error('[puls] api.me() FAILED:', err.message);
    // Только 401/403 → выход. Всё остальное → показать кнопку повтора
    const msg = String(err?.message || '').toLowerCase();
    const isAuthError = msg.includes('401') || msg.includes('403') ||
      msg.includes('unauthorized') || msg.includes('авторизац') ||
      msg.includes('токен') || msg.includes('forbidden');
    
    console.log('[puls] isAuthError:', isAuthError);
    
    if (isAuthError) {
      api.logout();
      showAuth();
    } else {
      const shell = document.getElementById('app-shell');
      if (shell) shell.innerHTML = `
        <div class="loading-state" style="gap:20px">
          <p style="color:var(--danger)">Ошибка: ${err.message}</p>
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
    can_manage_operators: !!u.can_manage_operators,
  };
}

/* ══════════════════════════════════════
   THEME
══════════════════════════════════════ */
function initTheme() {
  const saved = localStorage.getItem('puls-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('puls-theme', next);
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
    api.logout();
    STATE = { user:null, wallet:null, rating:[], shopItems:[], purchases:[], dashboard:null, adminOperators:[], history:[], currentView:'cabinet', pendingManualOperatorId:null };
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

  await loadData(role);

  const start = isAdmin(role) ? 'summary' : 'cabinet';
  navigateTo(start);
}

async function loadData(role) {
  const tasks = [
    api.getRating().catch(() => []).then(r => STATE.rating = r),
    api.listShopItems().catch(() => []).then(s => STATE.shopItems = s),
  ];
  if (role === 'operator') {
    tasks.push(api.myWallet().catch(() => null).then(w => STATE.wallet = w));
    tasks.push(api.listPurchases().catch(() => []).then(p => STATE.purchases = p));
  }
  if (isAdmin(role)) {
    tasks.push(api.getDashboard().catch(() => null).then(d => STATE.dashboard = d));
    tasks.push(
      fetch(api._base() + '/api/dashboard/operators', { headers: { Authorization: `Bearer ${api.getToken()}` } })
        .then(r => r.ok ? r.json() : []).then(o => STATE.adminOperators = o).catch(() => [])
    );
    tasks.push(api.listPurchases().catch(() => []).then(p => STATE.purchases = p));
    tasks.push(
      fetch(api._base() + '/api/dashboard/history?limit=50', { headers: { Authorization: `Bearer ${api.getToken()}` } })
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
    ? ['summary', 'operators', 'manual', 'requests', 'shop', 'history', 'cabinet', 'rating']
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
    if (isAdmin(role)) show = adminViews.includes(t) || sharedViews.includes(t);
    else show = operatorViews.includes(t);
    link.style.display = show ? '' : 'none';
  });
  if (isAdmin(role)) {
    const nav = document.getElementById('excel-import-nav');
    if (nav) nav.style.display = '';
  }
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
  const rank = myRow?.rank_position || '—';
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
        <div class="kpi-value">${rank} <span class="kpi-unit">из ${total}</span>
          ${delta != null ? `<span class="rank-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '↑'+delta : delta < 0 ? '↓'+Math.abs(delta) : '—'}</span>` : ''}
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
    </div>

    <div class="panel" style="margin-top:20px">
      <div class="panel-head"><h3>Настройки аккаунта</h3></div>
      <div style="padding:20px;display:grid;gap:14px;max-width:620px">
        <div class="form-group">
          <label class="form-label">Логин</label>
          <input id="account-username" class="form-input" value="${esc(STATE.user?.username || '')}" autocomplete="username">
        </div>
        <div class="form-group">
          <label class="form-label">Текущий пароль</label>
          <input id="account-current-password" class="form-input" type="password" autocomplete="current-password">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group">
            <label class="form-label">Новый пароль</label>
            <input id="account-new-password" class="form-input" type="password" autocomplete="new-password">
          </div>
          <div class="form-group">
            <label class="form-label">Повтор пароля</label>
            <input id="account-repeat-password" class="form-input" type="password" autocomplete="new-password">
          </div>
        </div>
        <div id="account-settings-status" class="status-line" style="min-height:24px"></div>
        <button class="btn-primary" id="account-settings-save" style="width:220px">Сохранить настройки</button>
      </div>
    </div>`;

  bindAccountSettings();
}

async function reloadCabinet() {
  STATE.wallet = await api.myWallet().catch(() => STATE.wallet);
  STATE.rating = await api.getRating().catch(() => STATE.rating);
  renderCabinet();
}

function bindAccountSettings() {
  const btn = document.getElementById('account-settings-save');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const statusEl = document.getElementById('account-settings-status');
    const username = document.getElementById('account-username')?.value?.trim();
    const currentPassword = document.getElementById('account-current-password')?.value || '';
    const newPassword = document.getElementById('account-new-password')?.value || '';
    const repeatPassword = document.getElementById('account-repeat-password')?.value || '';
    const payload = {};

    if (username !== STATE.user?.username) payload.username = username;
    if (newPassword || repeatPassword) {
      payload.current_password = currentPassword;
      payload.new_password = newPassword;
      payload.repeat_password = repeatPassword;
    }
    if (!payload.username && !payload.new_password) {
      if (statusEl) { statusEl.textContent = 'Нет изменений для сохранения'; statusEl.className = 'status-line'; }
      return;
    }

    btn.disabled = true;
    try {
      const user = await api.updateMyCredentials(payload);
      STATE.user = normalizeUser(user);
      setText('side-user', STATE.user?.full_name || STATE.user?.username || '');
      if (statusEl) { statusEl.textContent = 'Настройки сохранены'; statusEl.className = 'status-line status-ok'; }
      ['account-current-password','account-new-password','account-repeat-password'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
      });
    } catch (err) {
      if (statusEl) { statusEl.textContent = err.message; statusEl.className = 'status-line status-error'; }
    } finally {
      btn.disabled = false;
    }
  });
}

/* ══════════════════════════════════════
   VIEW: РЕЙТИНГ
══════════════════════════════════════ */
function renderRating() {
  const el = document.getElementById('view-rating');
  if (!el) return;
  const rows = STATE.rating;
  const myId = STATE.wallet?.operator_id;

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Рейтинг</div><h2 class="section-title">Турнирная таблица</h2></div>
      <button class="btn-outline btn-sm" onclick="api.getRating().then(r=>{STATE.rating=r;renderRating()})">Обновить</button>
    </div>

    ${rows.length >= 3 ? `
    <div class="podium" style="margin-bottom:24px">
      ${[rows[1],rows[0],rows[2]].filter(Boolean).map((op,vi) => {
        const ri = [1,0,2][vi];
        return `<div class="podium-card place-${ri+1} ${op.operator_id===myId?'podium-me':''}">
          <div class="podium-rank">${['🥇','🥈','🥉'][ri]}</div>
          <div class="podium-name">${esc(op.operator_name)}</div>
          <div class="podium-group">${esc(op.group_name)}</div>
          <div class="podium-coins">${op.coins_earned} ₡</div>
          <div class="podium-score">${(op.contest_points||0).toFixed(1)} баллов</div>
        </div>`;
      }).join('')}
    </div>` : ''}

    <div class="panel">
      <div class="panel-head"><h3>Все участники</h3><span class="panel-badge">${rows.length} операторов</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:48px">#</th>
            <th>Оператор</th><th>Группа</th><th>Баллы</th>
            <th>Коины (нед.)</th><th style="width:60px">Дин.</th>
          </tr></thead>
          <tbody>
            ${rows.length ? rows.map(r => {
              const isMe = r.operator_id === myId;
              const d = r.rank_delta;
              return `<tr class="${isMe?'row-me':''} ${r.rank_position<=3?'row-top':''}">
                <td class="rank-cell"><span class="rank-badge ${r.rank_position<=3?'rank-top':''}">${r.rank_position}</span></td>
                <td class="name-cell">${esc(r.operator_name)}${isMe?'<span class="me-badge">Вы</span>':''}</td>
                <td>${esc(r.group_name)}</td>
                <td><b>${(r.contest_points||0).toFixed(1)}</b></td>
                <td><b class="accent-text">${r.coins_earned} ₡</b></td>
                <td class="delta-cell">${d!=null?`<span class="rank-delta ${d>0?'up':d<0?'down':''}">${d>0?'↑'+d:d<0?'↓'+Math.abs(d):'—'}</span>`:'—'}</td>
              </tr>`;
            }).join('') : '<tr><td colspan="6" class="empty-line">Нет данных</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

function miniRating(limit, highlightId) {
  const rows = STATE.rating.slice(0, limit);
  if (!rows.length) return '<div class="empty-line">Нет данных</div>';
  return `<div class="mini-rating">${rows.map(r => `
    <div class="mini-rating-row ${r.operator_id===highlightId?'mini-me':''}">
      <span class="mini-rank">${r.rank_position}</span>
      <span class="mini-name">${esc(r.operator_name)}</span>
      <span class="mini-coins">${r.coins_earned} ₡</span>
    </div>`).join('')}</div>`;
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
  let filterStatus = '';

  const groups = [...new Set(ops.map(o => o.group_name))].sort();

  function filteredOps() {
    return ops.filter(o => {
      const haystack = `${o.full_name || ''} ${o.email || ''} ${o.employee_id || ''} ${o.username || ''}`.toLowerCase();
      const matchSearch = !searchVal || haystack.includes(searchVal.toLowerCase());
      const matchGroup = !filterGroup || o.group_name === filterGroup;
      const matchStatus = !filterStatus || o.status === filterStatus;
      return matchSearch && matchGroup && matchStatus;
    });
  }

  function renderTable() {
    const list = filteredOps();
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>#</th><th>ФИО</th><th>Группа</th><th>Статус</th><th>Логин</th>
            <th>Баллы</th><th>Коины</th><th>Баланс</th><th></th>
          </tr></thead>
          <tbody>
            ${list.length ? list.map(o => {
              return `<tr>
                <td class="rank-cell"><span class="rank-badge ${o.rank_position<=3?'rank-top':''}">${o.rank_position||'—'}</span></td>
                <td class="name-cell">${esc(o.full_name)}
                  ${o.employee_id ? `<span class="me-badge">${esc(o.employee_id)}</span>` : ''}
                  ${o.email ? `<div class="tx-date">${esc(o.email)}</div>` : ''}
                </td>
                <td>${esc(o.group_name)}</td>
                <td><span class="status-badge status-${o.status || 'active'}">${operatorStatusLabel(o.status)}</span></td>
                <td>${esc(o.username || '—')}</td>
                <td>${o.final_score?.toFixed(1)||'—'}</td>
                <td><b class="accent-text">${o.coins_earned_week || 0} ₡</b></td>
                <td><b>${o.current_balance} ₡</b></td>
                <td style="white-space:nowrap">
                  ${o.status === 'active' ? `<button class="btn-link quick-charge-btn" data-id="${o.id}">+ Коины</button>` : ''}
                  <button class="btn-link operator-card-btn" data-id="${o.id}">Карточка</button>
                  ${canManageOperators() ? `<button class="btn-link edit-operator-btn" data-id="${o.id}">Изменить</button>
                  <button class="btn-link reset-password-btn" data-id="${o.id}">Сбросить пароль</button>` : ''}
                </td>
              </tr>`;
            }).join('') : '<tr><td colspan="9" class="empty-line">Нет операторов</td></tr>'}
          </tbody>
        </table>
      </div>`;
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Операторы</div><h2 class="section-title">Список операторов</h2></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="exportCSV()">Экспорт CSV</button>
        <button class="btn-outline btn-sm" onclick="reloadData()">Обновить</button>
        ${canManageOperators() ? '<button class="btn-primary btn-sm" onclick="showAddOperatorModal()">Плюс оператор</button>' : ''}
      </div>
    </div>

    <!-- Фильтры -->
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <input id="ops-search" class="form-input" placeholder="ФИО, email, ID или логин…" style="width:260px" value="${esc(searchVal)}">
      <select id="ops-group" class="form-select" style="width:180px">
        <option value="">Все группы</option>
        ${groups.map(g => `<option value="${esc(g)}" ${filterGroup===g?'selected':''}>${esc(g)}</option>`).join('')}
      </select>
      <select id="ops-status" class="form-select" style="width:160px">
        <option value="">Все статусы</option>
        <option value="active">Активен</option>
        <option value="inactive">Неактивен</option>
        <option value="archive">Архив</option>
      </select>
      <span style="margin-left:auto;color:var(--tx3);font-size:12px;align-self:center">
        Показано: <b>${filteredOps().length}</b> из ${ops.length}
      </span>
    </div>

    <div id="ops-table-wrap">${renderTable()}</div>`;

  // Поиск и фильтр
  el.querySelector('#ops-search')?.addEventListener('input', e => {
    searchVal = e.target.value;
    el.querySelector('#ops-table-wrap').innerHTML = renderTable();
    bindOpsActions();
  });
  el.querySelector('#ops-group')?.addEventListener('change', e => {
    filterGroup = e.target.value;
    el.querySelector('#ops-table-wrap').innerHTML = renderTable();
    bindOpsActions();
  });
  el.querySelector('#ops-status')?.addEventListener('change', e => {
    filterStatus = e.target.value;
    el.querySelector('#ops-table-wrap').innerHTML = renderTable();
    bindOpsActions();
  });

  function bindOpsActions() {
    el.querySelectorAll('.quick-charge-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        STATE.pendingManualOperatorId = +btn.dataset.id;
        navigateTo('manual');
      });
    });
    el.querySelectorAll('.operator-card-btn').forEach(btn => {
      btn.addEventListener('click', () => showOperatorCardModal(+btn.dataset.id));
    });
    el.querySelectorAll('.edit-operator-btn').forEach(btn => {
      btn.addEventListener('click', () => showEditOperatorModal(+btn.dataset.id));
    });
    el.querySelectorAll('.reset-password-btn').forEach(btn => {
      btn.addEventListener('click', () => resetOperatorPassword(+btn.dataset.id));
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
  const ops = STATE.adminOperators.filter(o => o.status === 'active');

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Начисление</div><h2 class="section-title">Ручное начисление коинов</h2></div>
    </div>

    <div class="panel" style="max-width:640px">
      <div class="panel-head"><h3>Форма начисления</h3></div>
      <div style="padding:20px;display:grid;gap:14px">
        <div class="form-group">
          <label class="form-label">Оператор <span style="color:var(--danger)">*</span></label>
          <select id="manual-op-select" class="form-select">
            <option value="">Выберите оператора…</option>
            ${ops.map(o => `<option value="${o.id}" ${STATE.pendingManualOperatorId===o.id?'selected':''}>${esc(o.full_name)} — ${esc(o.group_name)} (${o.current_balance} ₡)</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Тип операции <span style="color:var(--danger)">*</span></label>
          <select id="manual-type" class="form-select">
            <option value="add">Начисление</option>
            <option value="subtract">Списание</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Количество коинов <span style="color:var(--danger)">*</span></label>
          <input id="manual-amount" class="form-input" type="number" min="1" placeholder="Введите количество">
        </div>
        <div class="form-group">
          <label class="form-label">Причина операции <span style="color:var(--danger)">*</span></label>
          <select id="manual-reason" class="form-select">
            <option value="">Выберите причину…</option>
            <option>Топ-1 недели</option>
            <option>Топ-2 недели</option>
            <option>Топ-3 недели</option>
            <option>Номинация недели</option>
            <option>Благодарность от водителя</option>
            <option>Попадание на доску почёта</option>
            <option>Помощь новому сотруднику</option>
            <option>Активность вне конкурса</option>
            <option>Дисциплинарное нарушение</option>
            <option>Другое</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Комментарий <span style="color:var(--danger)">*</span></label>
          <input id="manual-comment" class="form-input" type="text" placeholder="Обязательный комментарий к операции">
        </div>
        <div id="manual-status" class="status-line" style="min-height:24px"></div>
        <button class="btn-primary" id="manual-submit-btn" style="width:100%;height:44px">
          Сохранить операцию
        </button>
        <div style="font-size:11px;color:var(--tx3)">
          Операция будет записана с указанием автора, даты и причины. Удаление невозможно.
        </div>
      </div>
    </div>

    <!-- Последние операции -->
    <div class="panel" style="margin-top:20px">
      <div class="panel-head"><h3>Последние ручные операции</h3></div>
      <div class="tx-list">
        ${STATE.history.filter(t => t.type === 'manual_add' || t.type === 'manual_subtract').slice(0,10).map(t => `
          <div class="tx-row ${t.amount>=0?'tx-plus':'tx-minus'}">
            <div class="tx-info">
              <span class="tx-comment"><b>${esc(t.operator_name)}</b> — ${esc(t.comment)}</span>
              <span class="tx-date">Автор: ${esc(t.created_by_name||'Система')} · ${fmtDate(t.created_at)}</span>
            </div>
            <div class="tx-amount">${t.amount>=0?'+':''}${t.amount} ₡</div>
          </div>`).join('') || '<div class="empty-line">Нет ручных операций</div>'}
      </div>
    </div>`;

  el.querySelector('#manual-submit-btn')?.addEventListener('click', async () => {
    const opId    = +el.querySelector('#manual-op-select').value;
    const type    = el.querySelector('#manual-type').value;
    const amount  = +el.querySelector('#manual-amount').value;
    const reason  = el.querySelector('#manual-reason').value;
    const comment = el.querySelector('#manual-comment').value.trim();
    const statusEl = el.querySelector('#manual-status');

    if (!opId)    { statusEl.textContent = 'Выберите оператора'; statusEl.className = 'status-line status-error'; return; }
    if (!amount || amount <= 0) { statusEl.textContent = 'Введите количество коинов'; statusEl.className = 'status-line status-error'; return; }
    if (!reason)  { statusEl.textContent = 'Выберите причину'; statusEl.className = 'status-line status-error'; return; }
    if (!comment) { statusEl.textContent = 'Введите комментарий'; statusEl.className = 'status-line status-error'; return; }

    const finalAmount = type === 'subtract' ? -amount : amount;
    const fullComment = `${reason}: ${comment}`;

    try {
      await api.manualTransaction({ operator_id: opId, amount: finalAmount, comment: fullComment });
      statusEl.textContent = `✓ Операция сохранена: ${finalAmount > 0 ? '+' : ''}${finalAmount} ₡`;
      statusEl.className = 'status-line status-ok';
      el.querySelector('#manual-amount').value = '';
      el.querySelector('#manual-comment').value = '';
      el.querySelector('#manual-reason').value = '';
      showToast('Операция успешно сохранена', 'ok');
      await reloadData();
      renderManual();
    } catch(err) {
      statusEl.textContent = err.message;
      statusEl.className = 'status-line status-error';
    }
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
            method: 'POST', headers: { Authorization: `Bearer ${api.getToken()}` }
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
   MODALS
══════════════════════════════════════ */
function showModal(html) {
  let overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="modal">${html}<button class="modal-close" onclick="closeModal()">✕</button></div>`;
  overlay.style.display = 'flex';
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
}
function closeModal() {
  const o = document.getElementById('modal-overlay');
  if (o) o.style.display = 'none';
}

function showAddOperatorModal() {
  if (!canManageOperators()) { showToast('Недостаточно прав для управления операторами', 'error'); return; }
  showModal(`
    <h3 class="modal-title">Добавить оператора</h3>
    <div class="form-group"><label class="form-label">ФИО оператора *</label>
      <input id="new-op-name" class="form-input" placeholder="Иванов Иван Иванович"></div>
    <div class="form-group"><label class="form-label">Группа *</label>
      <input id="new-op-group" class="form-input" placeholder="Группа 1"></div>
    <div class="form-group"><label class="form-label">Статус оператора *</label>
      <select id="new-op-status" class="form-select">
        <option value="active">Активен</option>
        <option value="inactive">Неактивен</option>
        <option value="archive">Архив</option>
      </select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Должность</label>
        <input id="new-op-position" class="form-input" placeholder="Оператор звонков"></div>
      <div class="form-group"><label class="form-label">ID сотрудника</label>
        <input id="new-op-employee" class="form-input" placeholder="Табельный номер"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Email / почта</label>
        <input id="new-op-email" class="form-input" type="email" placeholder="operator@example.com"></div>
      <div class="form-group"><label class="form-label">Дата начала участия</label>
        <input id="new-op-started" class="form-input" type="date"></div>
    </div>
    <div class="form-group"><label class="form-label">Комментарий</label>
      <input id="new-op-comment" class="form-input" placeholder="Внутренний комментарий"></div>
    <div id="new-op-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitAddOperator()">Добавить</button>`);
}
function collectOperatorForm(prefix) {
  return {
    full_name: document.getElementById(`${prefix}-name`)?.value?.trim(),
    group_name: document.getElementById(`${prefix}-group`)?.value?.trim(),
    status: document.getElementById(`${prefix}-status`)?.value || 'active',
    position: document.getElementById(`${prefix}-position`)?.value?.trim() || null,
    employee_id: document.getElementById(`${prefix}-employee`)?.value?.trim() || null,
    email: document.getElementById(`${prefix}-email`)?.value?.trim() || null,
    participation_started_at: document.getElementById(`${prefix}-started`)?.value || null,
    admin_comment: document.getElementById(`${prefix}-comment`)?.value?.trim() || null,
  };
}
async function submitAddOperator(confirmDuplicate = false) {
  const name  = document.getElementById('new-op-name')?.value?.trim();
  const group = document.getElementById('new-op-group')?.value?.trim();
  const err   = document.getElementById('new-op-err');
  const statusValue = document.getElementById('new-op-status')?.value;
  if (!name || !group || !statusValue) { err.textContent = 'Заполните ФИО, группу и статус'; err.className = 'status-line status-error'; return; }
  try {
    const result = await api.createOperator({ ...collectOperatorForm('new-op'), confirm_duplicate: confirmDuplicate });
    await reloadData();
    showOperatorCreatedModal(result);
  } catch(e) {
    const detail = e.data?.detail;
    if (e.status === 409 && detail?.code === 'possible_duplicate') {
      showDuplicateWarning(detail.duplicates || []);
      return;
    }
    err.textContent = e.message;
    err.className = 'status-line status-error';
  }
}

function showDuplicateWarning(duplicates) {
  const rows = duplicates.map(item => `
    <div class="tx-row">
      <div class="tx-info">
        <span class="tx-comment"><b>${esc(item.full_name)}</b> — ${esc(item.group_name)}</span>
        <span class="tx-date">${operatorStatusLabel(item.status)}${item.email ? ` · ${esc(item.email)}` : ''}${item.employee_id ? ` · ${esc(item.employee_id)}` : ''}</span>
      </div>
      <button class="btn-link" onclick="showOperatorCardModal(${item.id})">Открыть</button>
    </div>`).join('');
  const err = document.getElementById('new-op-err');
  if (!err) return;
  err.className = 'status-line status-error';
  err.innerHTML = `
    <div>Похожий оператор уже существует. Проверьте данные перед сохранением.</div>
    <div style="margin-top:8px;display:grid;gap:6px">${rows}</div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn-outline btn-sm" type="button" onclick="closeModal()">Отменить</button>
      <button class="btn-primary btn-sm" type="button" onclick="submitAddOperator(true)">Продолжить создание</button>
    </div>`;
}

function showOperatorCreatedModal(result) {
  const op = result.operator;
  const acc = result.account;
  const copyText = buildCredentialsText(acc);
  showModal(`
    <h3 class="modal-title">Оператор успешно добавлен. Аккаунт создан.</h3>
    <div class="credential-box">
      <div><b>ФИО:</b> ${esc(acc.full_name)}</div>
      <div><b>Группа:</b> ${esc(acc.group_name)}</div>
      <div><b>Статус:</b> ${operatorStatusLabel(acc.status)}</div>
      <div><b>Логин:</b> <code>${esc(acc.username)}</code></div>
      <div><b>Временный пароль:</b> <code>${esc(acc.temporary_password)}</code></div>
    </div>
    <textarea id="created-credentials-text" class="form-input" style="height:92px;margin-top:12px">${esc(copyText)}</textarea>
    <button class="btn-primary" style="width:100%;margin-top:10px" onclick="copyCreatedCredentials()">Скопировать данные для входа</button>
    <button class="btn-outline" style="width:100%;margin-top:8px" onclick="showOperatorCardModal(${op.id})">Открыть карточку оператора</button>`);
  showToast('Оператор успешно добавлен. Аккаунт создан.', 'ok');
}

async function showEditOperatorModal(id) {
  if (!canManageOperators()) { showToast('Недостаточно прав для управления операторами', 'error'); return; }
  const op = await api.getOperator(id).catch(err => { showToast(err.message, 'error'); return null; });
  if (!op) return;
  showModal(`
    <h3 class="modal-title">Редактировать оператора</h3>
    <div class="form-group"><label class="form-label">ФИО оператора *</label>
      <input id="edit-op-name" class="form-input" value="${esc(op.full_name)}"></div>
    <div class="form-group"><label class="form-label">Группа *</label>
      <input id="edit-op-group" class="form-input" value="${esc(op.group_name)}"></div>
    <div class="form-group"><label class="form-label">Статус *</label>
      <select id="edit-op-status" class="form-select">
        <option value="active" ${op.status==='active'?'selected':''}>Активен</option>
        <option value="inactive" ${op.status==='inactive'?'selected':''}>Неактивен</option>
        <option value="archive" ${op.status==='archive'?'selected':''}>Архив</option>
      </select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Должность</label>
        <input id="edit-op-position" class="form-input" value="${esc(op.position || '')}"></div>
      <div class="form-group"><label class="form-label">ID сотрудника</label>
        <input id="edit-op-employee" class="form-input" value="${esc(op.employee_id || '')}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Email / почта</label>
        <input id="edit-op-email" class="form-input" type="email" value="${esc(op.email || '')}"></div>
      <div class="form-group"><label class="form-label">Дата начала участия</label>
        <input id="edit-op-started" class="form-input" type="date" value="${esc(op.participation_started_at || '')}"></div>
    </div>
    <div class="form-group"><label class="form-label">Комментарий</label>
      <input id="edit-op-comment" class="form-input" value="${esc(op.admin_comment || '')}"></div>
    <div id="edit-op-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitEditOperator(${id})">Сохранить</button>`);
}

async function submitEditOperator(id) {
  const err = document.getElementById('edit-op-err');
  const payload = collectOperatorForm('edit-op');
  if (!payload.full_name || !payload.group_name || !payload.status) {
    if (err) { err.textContent = 'Заполните ФИО, группу и статус'; err.className = 'status-line status-error'; }
    return;
  }
  try {
    await api.updateOperator(id, payload);
    closeModal();
    showToast('Оператор обновлен', 'ok');
    await reloadData();
  } catch (e) {
    if (err) { err.textContent = e.message; err.className = 'status-line status-error'; }
  }
}

async function resetOperatorPassword(id) {
  if (!canManageOperators()) { showToast('Недостаточно прав для управления операторами', 'error'); return; }
  const op = STATE.adminOperators.find(item => item.id === id);
  if (!confirm(`Сбросить пароль оператору ${op?.full_name || '#'+id}?`)) return;
  try {
    const result = await api.resetOperatorPassword(id);
    await reloadData();
    const acc = result.account;
    const copyText = buildCredentialsText(acc);
    showModal(`
      <h3 class="modal-title">Пароль сброшен</h3>
      <div class="credential-box">
        <div><b>Оператор:</b> ${esc(acc.full_name)}</div>
        <div><b>Логин:</b> <code>${esc(acc.username)}</code></div>
        <div><b>Новый временный пароль:</b> <code>${esc(acc.temporary_password)}</code></div>
      </div>
      <textarea id="created-credentials-text" class="form-input" style="height:92px;margin-top:12px">${esc(copyText)}</textarea>
      <button class="btn-primary" style="width:100%;margin-top:10px" onclick="copyCreatedCredentials()">Скопировать данные для входа</button>`);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function showOperatorCardModal(id) {
  const card = await api.getOperatorCard(id).catch(err => { showToast(err.message, 'error'); return null; });
  if (!card) return;
  const op = card.operator;
  const txRows = card.transactions.slice(0, 8).map(t => `
    <div class="tx-row ${t.amount>=0?'tx-plus':'tx-minus'}">
      <div class="tx-info"><span class="tx-comment">${esc(t.comment)}</span><span class="tx-date">${fmtDate(t.created_at)} · ${esc(t.type)}</span></div>
      <div class="tx-amount">${t.amount>=0?'+':''}${t.amount} ₡</div>
    </div>`).join('') || '<div class="empty-line">Истории начислений пока нет</div>';
  const auditRows = card.audit_log.slice(0, 8).map(item => `
    <div class="tx-row">
      <div class="tx-info"><span class="tx-comment">${esc(operatorAuditLabel(item.action))}</span><span class="tx-date">${esc(item.comment)} · ${fmtDate(item.created_at)}</span></div>
      <div class="tx-date">${esc(item.actor_name || 'Система')}</div>
    </div>`).join('') || '<div class="empty-line">Журнал пока пуст</div>';
  showModal(`
    <h3 class="modal-title">Карточка оператора</h3>
    <div class="operator-card-grid">
      <div><span>ФИО</span><b>${esc(op.full_name)}</b></div>
      <div><span>Группа</span><b>${esc(op.group_name)}</b></div>
      <div><span>Статус</span><b>${operatorStatusLabel(op.status)}</b></div>
      <div><span>Логин</span><b>${esc(op.username || '—')}</b></div>
      <div><span>Должность</span><b>${esc(op.position || '—')}</b></div>
      <div><span>ID сотрудника</span><b>${esc(op.employee_id || '—')}</b></div>
      <div><span>Email</span><b>${esc(op.email || '—')}</b></div>
      <div><span>Дата создания</span><b>${fmtDate(op.created_at)}</b></div>
      <div><span>Автор</span><b>${esc(op.created_by_name || '—')}</b></div>
      <div><span>Баланс</span><b>${op.current_balance} ₡</b></div>
      <div><span>Коины заработаны</span><b>${op.total_earned} ₡</b></div>
      <div><span>Коины потрачены</span><b>${op.total_spent} ₡</b></div>
    </div>
    ${op.admin_comment ? `<div class="empty-line" style="margin-top:12px">${esc(op.admin_comment)}</div>` : ''}
    <div class="panel" style="margin-top:14px"><div class="panel-head"><h3>История начислений и списаний</h3></div><div class="tx-list">${txRows}</div></div>
    <div class="panel" style="margin-top:14px"><div class="panel-head"><h3>Журнал действий</h3></div><div class="tx-list">${auditRows}</div></div>
    ${canManageOperators() ? `<button class="btn-outline" style="width:100%;margin-top:12px" onclick="showEditOperatorModal(${op.id})">Редактировать</button>` : ''}`);
}

function buildCredentialsText(account) {
  return `Оператор: ${account.full_name}\nЛогин: ${account.username}\nВременный пароль: ${account.temporary_password}`;
}

async function copyCreatedCredentials() {
  const text = document.getElementById('created-credentials-text')?.value || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.getElementById('created-credentials-text');
    area?.select();
    document.execCommand('copy');
  }
  showToast('Данные для входа скопированы', 'ok');
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
  const header = ['ФИО','Группа','Статус','Логин','Должность','ID сотрудника','Email','Место','Баллы','Коины нед.','Баланс','Опозд.','Наруш.'];
  const rows = ops.map(o => [
    o.full_name, o.group_name, operatorStatusLabel(o.status), o.username || '', o.position || '', o.employee_id || '', o.email || '',
    o.rank_position||'', o.final_score?.toFixed(1)||'',
    o.coins_earned_week, o.current_balance, o.lateness_count, o.violation_count,
  ]);
  downloadCSV([header, ...rows], 'puls_operators');
}

function exportHistoryCSV() {
  const header = ['Дата','Оператор','Группа','Тип','Коины','Причина','Автор'];
  const rows = STATE.history.map(t => [
    fmtDate(t.created_at), t.operator_name, t.group_name, t.type,
    t.amount, t.comment, t.created_by_name||'Система',
  ]);
  downloadCSV([header, ...rows], 'puls_history');
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
function operatorStatusLabel(s) {
  return { active:'Активен', inactive:'Неактивен', archive:'Архив' }[s] || s || 'Активен';
}
function operatorAuditLabel(action) {
  return {
    operator_created: 'Создание оператора',
    account_created: 'Автоматическое создание аккаунта',
    operator_updated: 'Изменение данных оператора',
    password_reset: 'Сброс пароля',
    username_changed: 'Изменение логина',
    password_changed: 'Изменение пароля',
  }[action] || action;
}
function isAdmin(role) { return ['supervisor','manager','admin'].includes(role); }
function canManageOperators() {
  return ['manager','admin'].includes(STATE.user?.role) || !!STATE.user?.can_manage_operators;
}

/* ══════════════════════════════════════
   WINDOW EXPORTS
══════════════════════════════════════ */
window.navigateTo = navigateTo;
window.reloadData = reloadData;
window.closeModal = closeModal;
window.submitAddOperator = submitAddOperator;
window.submitEditOperator = submitEditOperator;
window.submitAddItem = submitAddItem;
window.submitEditItem = submitEditItem;
window.showAddOperatorModal = showAddOperatorModal;
window.showEditOperatorModal = showEditOperatorModal;
window.showOperatorCardModal = showOperatorCardModal;
window.resetOperatorPassword = resetOperatorPassword;
window.copyCreatedCredentials = copyCreatedCredentials;
window.showAddItemModal = showAddItemModal;
window.showEditItemModal = showEditItemModal;
window.exportCSV = exportCSV;
window.exportHistoryCSV = exportHistoryCSV;
window.reloadCabinet = reloadCabinet;
