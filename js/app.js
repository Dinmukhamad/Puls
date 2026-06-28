/**
 * iCore Gamification — Main App
 * Полный рефактор по ТЗ v1.0
 */
'use strict';

/* ══════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════ */
let STATE = {
  user: null,          // { id, username, full_name, role, operator_id }
  operator: null,      // текущий оператор (для роли operator)
  wallet: null,
  rating: [],
  shopItems: [],
  purchases: [],
  dashboard: null,
  operators: [],
  weeklyResults: [],
  currentView: 'cabinet',
};

/* ══════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════ */
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
  try {
    STATE.user = await api.me();
    await bootApp();
  } catch {
    api.logout();
    showAuth();
  }
}

/* ══════════════════════════════════════════════════════════
   THEME
══════════════════════════════════════════════════════════ */
function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    localStorage.setItem('icore-theme', dark ? 'light' : 'dark');
  });
  const saved = localStorage.getItem('icore-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
}

/* ══════════════════════════════════════════════════════════
   NAV
══════════════════════════════════════════════════════════ */
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
  document.querySelectorAll('.side-nav-link').forEach(l => l.classList.remove('active'));

  const target = document.getElementById(`view-${view}`);
  if (target) target.classList.add('active');
  const link = document.querySelector(`.side-nav-link[data-nav-target="${view}"]`);
  if (link) link.classList.add('active');

  renderView(view);
}

function renderView(view) {
  switch (view) {
    case 'cabinet':   renderCabinet();   break;
    case 'rating':    renderRating();    break;
    case 'shop':      renderShop();      break;
    case 'admin':     renderAdmin();     break;
    case 'requests':  renderRequests();  break;
  }
}

/* ══════════════════════════════════════════════════════════
   AUTH
══════════════════════════════════════════════════════════ */
function showAuth() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.removeAttribute('hidden');
  document.body.classList.add('operator-login-required');
}

function hideAuth() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.setAttribute('hidden', '');
  document.body.classList.remove('operator-login-required');
}

// Login form submit
document.addEventListener('click', async e => {
  if (e.target.id === 'auth-login-btn') {
    const username = document.getElementById('auth-username')?.value?.trim();
    const password = document.getElementById('auth-password')?.value;
    const errEl = document.getElementById('auth-error');
    if (!username || !password) {
      if (errEl) errEl.textContent = 'Введите логин и пароль';
      return;
    }
    e.target.disabled = true;
    e.target.textContent = 'Вход…';
    try {
      await api.login(username, password);
      STATE.user = await api.me();
      hideAuth();
      await bootApp();
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
      e.target.disabled = false;
      e.target.textContent = 'Войти';
    }
  }

  if (e.target.id === 'auth-logout-btn') {
    api.logout();
    STATE = { user: null, operator: null, wallet: null, rating: [], shopItems: [], purchases: [], dashboard: null, operators: [], weeklyResults: [], currentView: 'cabinet' };
    showAuth();
  }
});

/* ══════════════════════════════════════════════════════════
   BOOT APP
══════════════════════════════════════════════════════════ */
async function bootApp() {
  const role = STATE.user?.role;
  renderSidebar(role);
  buildViewContainers();

  // Загружаем данные параллельно
  await loadAllData(role);

  // Стартовый экран
  const startView = role === 'operator' ? 'cabinet' : 'admin';
  navigateTo(startView);

  // Мета в сайдбаре
  setText('side-role', roleLabel(role));
  setText('side-user', STATE.user?.full_name || STATE.user?.username || '');
}

async function loadAllData(role) {
  const tasks = [api.getRating().catch(() => []).then(r => STATE.rating = r)];

  if (role === 'operator') {
    tasks.push(api.myWallet().catch(() => null).then(w => STATE.wallet = w));
    tasks.push(api.listShopItems().catch(() => []).then(s => STATE.shopItems = s));
    tasks.push(api.listPurchases().catch(() => []).then(p => STATE.purchases = p));
  }
  if (isAdmin(role)) {
    tasks.push(api.getDashboard().catch(() => null).then(d => STATE.dashboard = d));
    tasks.push(api.listOperators().catch(() => []).then(o => STATE.operators = o));
    tasks.push(api.listShopItems().catch(() => []).then(s => STATE.shopItems = s));
    tasks.push(api.listPurchases().catch(() => []).then(p => STATE.purchases = p));
  }
  await Promise.all(tasks);
}

async function reloadData() {
  await loadAllData(STATE.user?.role);
  renderView(STATE.currentView);
}

/* ══════════════════════════════════════════════════════════
   SIDEBAR
══════════════════════════════════════════════════════════ */
function renderSidebar(role) {
  const allLinks = document.querySelectorAll('.side-nav-link[data-nav-target]');
  const adminViews = new Set(['admin', 'requests']);
  const operatorViews = new Set(['cabinet', 'rating', 'shop']);
  const sharedViews = new Set(['rating']);

  allLinks.forEach(link => {
    const t = link.dataset.navTarget;
    let visible = false;
    if (role === 'operator') visible = operatorViews.has(t);
    else if (isAdmin(role)) visible = adminViews.has(t) || sharedViews.has(t) || t === 'cabinet' || t === 'shop';
    link.style.display = visible ? '' : 'none';
  });
}

/* ══════════════════════════════════════════════════════════
   BUILD VIEW CONTAINERS
══════════════════════════════════════════════════════════ */
function buildViewContainers() {
  const shell = document.getElementById('app-shell');
  if (!shell) return;
  const views = ['cabinet', 'rating', 'shop', 'admin', 'requests'];
  shell.innerHTML = views.map(v => `<section class="app-view" id="view-${v}" data-view="${v}"></section>`).join('');
}

/* ══════════════════════════════════════════════════════════
   VIEW: ЛИЧНЫЙ КАБИНЕТ
══════════════════════════════════════════════════════════ */
function renderCabinet() {
  const el = document.getElementById('view-cabinet');
  if (!el) return;
  const w = STATE.wallet;
  const role = STATE.user?.role;

  // Для admin/supervisor — показываем дашборд вместо кабинета
  if (isAdmin(role)) {
    el.innerHTML = renderAdminDashboard();
    bindDashboardEvents(el);
    return;
  }

  if (!w) {
    el.innerHTML = `<div class="view-header"><div class="section-kicker">Кабинет</div><h2 class="section-title">Мой кабинет</h2></div><div class="empty-state"><p>Данные недоступны. Возможно, ваш аккаунт не привязан к оператору.</p></div>`;
    return;
  }

  const myRatingRow = STATE.rating.find(r => r.operator_id === (STATE.wallet?.operator_id));
  const rank = myRatingRow?.rank_position || '—';
  const totalOps = STATE.rating.length || '—';
  const rankDelta = myRatingRow?.rank_delta;

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Кабинет</div>
        <h2 class="section-title">Мой кабинет</h2>
      </div>
      <button class="btn-outline btn-sm" id="cabinet-reload-btn">Обновить</button>
    </div>

    <!-- Баланс -->
    <div class="kpi-grid">
      <div class="kpi-card kpi-accent">
        <div class="kpi-label">Текущий баланс</div>
        <div class="kpi-value">${w.current_balance} <span class="kpi-unit">коинов</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Всего заработано</div>
        <div class="kpi-value">${w.total_earned}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Потрачено</div>
        <div class="kpi-value">${w.total_spent}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Место в рейтинге</div>
        <div class="kpi-value">${rank} <span class="kpi-unit">из ${totalOps}</span>
          ${rankDelta != null ? `<span class="rank-delta ${rankDelta > 0 ? 'up' : rankDelta < 0 ? 'down' : ''}">${rankDelta > 0 ? '↑' + rankDelta : rankDelta < 0 ? '↓' + Math.abs(rankDelta) : '—'}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="two-col-grid">
      <!-- История -->
      <div class="panel">
        <div class="panel-head">
          <h3>История начислений</h3>
          <span class="panel-badge">${w.transactions.length} записей</span>
        </div>
        <div class="tx-list">
          ${w.transactions.length ? w.transactions.map(t => `
            <div class="tx-row ${t.amount >= 0 ? 'tx-plus' : 'tx-minus'}">
              <div class="tx-info">
                <span class="tx-comment">${esc(t.comment)}</span>
                <span class="tx-date">${fmtDate(t.created_at)}</span>
              </div>
              <div class="tx-amount">${t.amount >= 0 ? '+' : ''}${t.amount} ₡</div>
            </div>
          `).join('') : '<div class="empty-line">Операций пока нет</div>'}
        </div>
      </div>

      <!-- Мой рейтинг -->
      <div class="panel">
        <div class="panel-head">
          <h3>Рейтинг недели</h3>
        </div>
        ${renderMiniRating(5, myRatingRow?.operator_id)}
        <div class="panel-footer">
          <button class="btn-link" onclick="navigateTo('rating')">Полный рейтинг →</button>
        </div>
      </div>
    </div>

    <!-- Быстрый переход в магазин -->
    <div class="shop-banner">
      <div>
        <div class="shop-banner-title">Магазин бонусов</div>
        <div class="shop-banner-sub">У вас ${w.current_balance} коинов — потратьте на себя</div>
      </div>
      <button class="btn-primary" onclick="navigateTo('shop')">Перейти в магазин</button>
    </div>
  `;

  el.querySelector('#cabinet-reload-btn')?.addEventListener('click', async () => {
    STATE.wallet = await api.myWallet().catch(() => STATE.wallet);
    STATE.rating = await api.getRating().catch(() => STATE.rating);
    renderCabinet();
  });
}

/* ══════════════════════════════════════════════════════════
   ADMIN DASHBOARD (для супервайзера/руководителя в «кабинете»)
══════════════════════════════════════════════════════════ */
function renderAdminDashboard() {
  const d = STATE.dashboard;
  if (!d) return `<div class="empty-state"><p>Загрузка данных…</p></div>`;

  const pending = d.pending_purchases_count || 0;

  return `
    <div class="view-header">
      <div>
        <div class="section-kicker">Обзор</div>
        <h2 class="section-title">Панель управления</h2>
      </div>
      <button class="btn-outline btn-sm" onclick="reloadData()">Обновить</button>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card kpi-accent">
        <div class="kpi-label">Операторов в системе</div>
        <div class="kpi-value">${d.total_operators}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Коинов начислено за неделю</div>
        <div class="kpi-value">${d.coins_earned_this_week}</div>
      </div>
      <div class="kpi-card ${pending > 0 ? 'kpi-warn' : ''}">
        <div class="kpi-label">Новых заявок из магазина</div>
        <div class="kpi-value">${pending}</div>
        ${pending > 0 ? `<div class="kpi-action"><button class="btn-link" onclick="navigateTo('requests')">Рассмотреть →</button></div>` : ''}
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Групп в рейтинге</div>
        <div class="kpi-value">${d.group_summary?.length || 0}</div>
      </div>
    </div>

    <!-- Топ-3 -->
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head"><h3>Топ-3 недели</h3></div>
      <div class="podium">
        ${d.top_3_operators?.length ? d.top_3_operators.map((op, i) => `
          <div class="podium-card place-${i+1}">
            <div class="podium-rank">${['🥇','🥈','🥉'][i]}</div>
            <div class="podium-name">${esc(op.full_name)}</div>
            <div class="podium-group">${esc(op.group_name)}</div>
            <div class="podium-coins">${op.coins_earned} ₡ за неделю</div>
            <div class="podium-balance">Баланс: ${op.current_balance} ₡</div>
          </div>
        `).join('') : '<div class="empty-line">Нет данных за текущую неделю</div>'}
      </div>
    </div>

    <div class="two-col-grid">
      <!-- Сводка по группам -->
      <div class="panel">
        <div class="panel-head"><h3>Группы</h3></div>
        <table class="data-table">
          <thead><tr><th>Группа</th><th>Операторов</th><th>Средний балл</th><th>Баланс (сумм.)</th></tr></thead>
          <tbody>
            ${d.group_summary?.map(g => `
              <tr>
                <td><b>${esc(g.group_name)}</b></td>
                <td>${g.operators_count}</td>
                <td>${(g.average_score||0).toFixed(1)}</td>
                <td>${g.total_balance} ₡</td>
              </tr>
            `).join('') || '<tr><td colspan="4" class="empty-line">Нет данных</td></tr>'}
          </tbody>
        </table>
      </div>

      <!-- Последние начисления -->
      <div class="panel">
        <div class="panel-head"><h3>Последние транзакции</h3></div>
        <div class="tx-list">
          ${d.latest_coin_transactions?.map(t => `
            <div class="tx-row ${t.amount >= 0 ? 'tx-plus' : 'tx-minus'}">
              <div class="tx-info">
                <span class="tx-comment">${esc(t.comment)}</span>
              </div>
              <div class="tx-amount">${t.amount >= 0 ? '+' : ''}${t.amount} ₡</div>
            </div>
          `).join('') || '<div class="empty-line">Нет данных</div>'}
        </div>
      </div>
    </div>
  `;
}

function bindDashboardEvents(el) {} // placeholder

/* ══════════════════════════════════════════════════════════
   VIEW: РЕЙТИНГ
══════════════════════════════════════════════════════════ */
function renderRating() {
  const el = document.getElementById('view-rating');
  if (!el) return;
  const rows = STATE.rating;
  const myOpId = STATE.wallet?.operator_id;

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Рейтинг</div>
        <h2 class="section-title">Турнирная таблица</h2>
      </div>
      <button class="btn-outline btn-sm" id="rating-reload-btn">Обновить</button>
    </div>

    <!-- Топ-3 пьедестал -->
    ${rows.length >= 3 ? `
    <div class="podium" style="margin-bottom:24px">
      ${[rows[1], rows[0], rows[2]].filter(Boolean).map((op, visualIdx) => {
        const realIdx = [1,0,2][visualIdx];
        return `
          <div class="podium-card place-${realIdx+1} ${op.operator_id === myOpId ? 'podium-me' : ''}">
            <div class="podium-rank">${['🥇','🥈','🥉'][realIdx]}</div>
            <div class="podium-name">${esc(op.operator_name)}</div>
            <div class="podium-group">${esc(op.group_name)}</div>
            <div class="podium-coins">${op.coins_earned} ₡ за неделю</div>
            <div class="podium-score">${op.contest_points?.toFixed(1) || 0} баллов</div>
          </div>
        `;
      }).join('')}
    </div>` : ''}

    <!-- Общая таблица -->
    <div class="panel">
      <div class="panel-head">
        <h3>Все участники</h3>
        <span class="panel-badge">${rows.length} операторов</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:48px">#</th>
              <th>Оператор</th>
              <th>Группа</th>
              <th>Баллы</th>
              <th>Коины за неделю</th>
              <th style="width:60px">Дин.</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map(r => {
              const isMe = r.operator_id === myOpId;
              const delta = r.rank_delta;
              return `
                <tr class="${isMe ? 'row-me' : ''} ${r.rank_position <= 3 ? 'row-top' : ''}">
                  <td class="rank-cell">
                    <span class="rank-badge ${r.rank_position <= 3 ? 'rank-top' : ''}">${r.rank_position}</span>
                  </td>
                  <td class="name-cell">
                    ${esc(r.operator_name)}
                    ${isMe ? '<span class="me-badge">Вы</span>' : ''}
                  </td>
                  <td>${esc(r.group_name)}</td>
                  <td><b>${(r.contest_points||0).toFixed(1)}</b></td>
                  <td><b class="accent-text">${r.coins_earned} ₡</b></td>
                  <td class="delta-cell">
                    ${delta != null ? `<span class="rank-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '↑'+delta : delta < 0 ? '↓'+Math.abs(delta) : '—'}</span>` : '—'}
                  </td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="6" class="empty-line">Нет данных за текущий период</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  el.querySelector('#rating-reload-btn')?.addEventListener('click', async () => {
    STATE.rating = await api.getRating().catch(() => STATE.rating);
    renderRating();
  });
}

function renderMiniRating(limit = 5, highlightId) {
  const rows = STATE.rating.slice(0, limit);
  if (!rows.length) return '<div class="empty-line">Нет данных</div>';
  return `<div class="mini-rating">
    ${rows.map(r => `
      <div class="mini-rating-row ${r.operator_id === highlightId ? 'mini-me' : ''}">
        <span class="mini-rank">${r.rank_position}</span>
        <span class="mini-name">${esc(r.operator_name)}</span>
        <span class="mini-coins">${r.coins_earned} ₡</span>
      </div>
    `).join('')}
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   VIEW: МАГАЗИН
══════════════════════════════════════════════════════════ */
function renderShop() {
  const el = document.getElementById('view-shop');
  if (!el) return;
  const items = STATE.shopItems;
  const balance = STATE.wallet?.current_balance ?? 0;
  const role = STATE.user?.role;

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Магазин</div>
        <h2 class="section-title">Магазин бонусов</h2>
      </div>
      <div class="header-right">
        ${role === 'operator' ? `<div class="balance-chip">Баланс: <b>${balance} ₡</b></div>` : ''}
        ${isAdmin(role) ? `<button class="btn-primary btn-sm" id="add-shop-item-btn">+ Добавить бонус</button>` : ''}
      </div>
    </div>

    <div class="shop-grid" id="shop-grid">
      ${items.length ? items.map(item => renderShopCard(item, balance, role)).join('') : '<div class="empty-state">Магазин пуст</div>'}
    </div>
  `;

  // Кнопки «Купить»
  el.querySelectorAll('.buy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemId = +btn.dataset.id;
      const item = items.find(i => i.id === itemId);
      if (!item) return;
      if (!confirm(`Купить «${item.title}» за ${item.price} ₡?`)) return;
      btn.disabled = true;
      btn.textContent = 'Оформляем…';
      try {
        await api.buyItem(itemId);
        STATE.wallet = await api.myWallet();
        STATE.purchases = await api.listPurchases();
        showToast('Заявка отправлена на рассмотрение', 'ok');
        renderShop();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Купить';
      }
    });
  });

  // Добавить товар (только admin)
  el.querySelector('#add-shop-item-btn')?.addEventListener('click', () => showAddItemModal());

  // Редактировать товар
  el.querySelectorAll('.edit-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = items.find(i => i.id === +btn.dataset.id);
      if (item) showEditItemModal(item);
    });
  });
}

function renderShopCard(item, balance, role) {
  const canBuy = role === 'operator' && balance >= item.price;
  const needMore = role === 'operator' && balance < item.price ? item.price - balance : 0;
  return `
    <div class="shop-card ${canBuy ? 'shop-card-available' : ''}">
      <div class="shop-card-title">${esc(item.title)}</div>
      <div class="shop-card-desc">${esc(item.description)}</div>
      <div class="shop-card-price">${item.price} <span class="price-unit">коинов</span></div>
      <div class="shop-card-footer">
        ${role === 'operator' ? `
          <button class="buy-btn ${canBuy ? 'btn-primary' : 'btn-disabled'}" data-id="${item.id}" ${canBuy ? '' : 'disabled'}>
            ${canBuy ? 'Купить' : `Нужно ещё ${needMore} ₡`}
          </button>
        ` : ''}
        ${isAdmin(role) ? `
          <button class="edit-item-btn btn-outline btn-sm" data-id="${item.id}">Изменить</button>
        ` : ''}
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════════════
   VIEW: АДМИН (таблица операторов + ручное начисление)
══════════════════════════════════════════════════════════ */
function renderAdmin() {
  const el = document.getElementById('view-admin');
  if (!el) return;
  const ops = STATE.operators;

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Управление</div>
        <h2 class="section-title">Операторы</h2>
      </div>
      <div class="header-right">
        <button class="btn-outline btn-sm" id="admin-reload-btn">Обновить</button>
        <button class="btn-primary btn-sm" id="add-operator-btn">+ Оператор</button>
        <button class="btn-outline btn-sm" id="export-csv-btn">Экспорт CSV</button>
      </div>
    </div>

    <!-- Ручное начисление -->
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head"><h3>Ручное начисление коинов</h3></div>
      <div class="manual-form">
        <select id="manual-op-select" class="form-select">
          <option value="">Выберите оператора…</option>
          ${ops.map(o => `<option value="${o.id}">${esc(o.full_name)} (${esc(o.group_name)})</option>`).join('')}
        </select>
        <input type="number" id="manual-amount" class="form-input" placeholder="Коины (+ начисл., - спис.)" style="width:220px">
        <input type="text" id="manual-comment" class="form-input" placeholder="Причина (обязательно)" style="flex:1;min-width:200px">
        <button class="btn-primary" id="manual-submit-btn">Начислить</button>
      </div>
      <div id="manual-status" class="status-line"></div>
    </div>

    <!-- Таблица -->
    <div class="panel">
      <div class="panel-head">
        <h3>Список операторов</h3>
        <span class="panel-badge">${ops.length} чел.</span>
      </div>
      <div class="table-wrap">
        <table class="data-table" id="operators-table">
          <thead>
            <tr>
              <th>#</th>
              <th>ФИО</th>
              <th>Группа</th>
              <th>Баллы</th>
              <th>Коины (нед.)</th>
              <th>Баланс</th>
              <th>Заработано</th>
              <th>Потрачено</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${ops.length ? ops.map(o => {
              const ratingRow = STATE.rating.find(r => r.operator_id === o.id);
              return `
                <tr>
                  <td>${ratingRow?.rank_position || '—'}</td>
                  <td class="name-cell"><b>${esc(o.full_name)}</b></td>
                  <td>${esc(o.group_name)}</td>
                  <td>${ratingRow ? ratingRow.contest_points.toFixed(1) : '—'}</td>
                  <td><b class="accent-text">${ratingRow?.coins_earned ?? '—'} ₡</b></td>
                  <td><b>${o.current_balance} ₡</b></td>
                  <td>${o.total_earned} ₡</td>
                  <td>${o.total_spent} ₡</td>
                  <td>
                    <button class="btn-link quick-manual-btn" data-id="${o.id}" data-name="${esc(o.full_name)}">+ Коины</button>
                  </td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="9" class="empty-line">Нет операторов</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Ручное начисление (форма сверху)
  el.querySelector('#manual-submit-btn')?.addEventListener('click', async () => {
    const opId = +el.querySelector('#manual-op-select').value;
    const amount = +el.querySelector('#manual-amount').value;
    const comment = el.querySelector('#manual-comment').value.trim();
    const statusEl = el.querySelector('#manual-status');
    if (!opId || !amount || !comment) {
      statusEl.textContent = 'Заполните все поля';
      statusEl.className = 'status-line status-error';
      return;
    }
    try {
      await api.manualTransaction({ operator_id: opId, amount, comment });
      statusEl.textContent = `✓ Начислено ${amount > 0 ? '+' : ''}${amount} ₡ оператору`;
      statusEl.className = 'status-line status-ok';
      el.querySelector('#manual-amount').value = '';
      el.querySelector('#manual-comment').value = '';
      await reloadData();
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = 'status-line status-error';
    }
  });

  // Быстрое начисление из строки таблицы
  el.querySelectorAll('.quick-manual-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelector('#manual-op-select').value = btn.dataset.id;
      el.querySelector('#manual-amount').focus();
    });
  });

  // Экспорт CSV
  el.querySelector('#export-csv-btn')?.addEventListener('click', () => exportOperatorsCSV());

  // Добавить оператора
  el.querySelector('#add-operator-btn')?.addEventListener('click', () => showAddOperatorModal());

  // Перезагрузить
  el.querySelector('#admin-reload-btn')?.addEventListener('click', reloadData);
}

/* ══════════════════════════════════════════════════════════
   VIEW: ЗАЯВКИ
══════════════════════════════════════════════════════════ */
function renderRequests() {
  const el = document.getElementById('view-requests');
  if (!el) return;
  const all = STATE.purchases;
  const pending = all.filter(p => p.status === 'pending');
  const others  = all.filter(p => p.status !== 'pending');

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Заявки</div>
        <h2 class="section-title">Заявки из магазина</h2>
      </div>
      <button class="btn-outline btn-sm" id="req-reload-btn">Обновить</button>
    </div>

    <!-- Фильтры -->
    <div class="filter-tabs" id="req-filter-tabs">
      <button class="filter-tab active" data-filter="pending">Новые <span class="badge">${pending.length}</span></button>
      <button class="filter-tab" data-filter="approved">Одобрены</button>
      <button class="filter-tab" data-filter="rejected">Отклонены</button>
      <button class="filter-tab" data-filter="all">Все <span class="badge">${all.length}</span></button>
    </div>

    <div id="requests-list">
      ${renderRequestsList(pending)}
    </div>
  `;

  // Фильтры
  el.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      el.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const filter = tab.dataset.filter;
      const filtered = filter === 'all' ? all : all.filter(p => p.status === filter);
      el.querySelector('#requests-list').innerHTML = renderRequestsList(filtered);
      bindRequestActions(el);
    });
  });

  bindRequestActions(el);
  el.querySelector('#req-reload-btn')?.addEventListener('click', reloadData);
}

function renderRequestsList(purchases) {
  if (!purchases.length) return '<div class="empty-state">Заявок нет</div>';
  return purchases.map(p => {
    const op = STATE.operators.find(o => o.id === p.operator_id);
    const item = STATE.shopItems.find(i => i.id === p.shop_item_id);
    return `
      <div class="request-card status-${p.status}">
        <div class="request-info">
          <div class="request-title">${esc(item?.title || `Бонус #${p.shop_item_id}`)}</div>
          <div class="request-meta">
            <span>${esc(op?.full_name || `Оператор #${p.operator_id}`)}</span>
            <span>·</span>
            <span>${p.price} ₡</span>
            <span>·</span>
            <span>${fmtDate(p.created_at)}</span>
          </div>
          ${p.reject_reason ? `<div class="request-reason">Причина отказа: ${esc(p.reject_reason)}</div>` : ''}
        </div>
        <div class="request-status">
          <span class="status-badge status-${p.status}">${statusLabel(p.status)}</span>
        </div>
        ${p.status === 'pending' ? `
          <div class="request-actions">
            <button class="btn-ok approve-btn" data-id="${p.id}">Одобрить</button>
            <button class="btn-danger reject-btn" data-id="${p.id}">Отклонить</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function bindRequestActions(el) {
  el.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = +btn.dataset.id;
      btn.disabled = true;
      try {
        await api.approvePurchase(id);
        showToast('Заявка одобрена', 'ok');
        STATE.purchases = await api.listPurchases();
        STATE.dashboard = await api.getDashboard().catch(() => STATE.dashboard);
        renderRequests();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  el.querySelectorAll('.reject-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = prompt('Причина отказа:');
      if (!reason?.trim()) return;
      const id = +btn.dataset.id;
      btn.disabled = true;
      try {
        await api.rejectPurchase(id, reason.trim());
        showToast('Заявка отклонена', 'ok');
        STATE.purchases = await api.listPurchases();
        STATE.dashboard = await api.getDashboard().catch(() => STATE.dashboard);
        renderRequests();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

/* ══════════════════════════════════════════════════════════
   MODALS
══════════════════════════════════════════════════════════ */
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
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

function showAddOperatorModal() {
  showModal(`
    <h3 class="modal-title">Добавить оператора</h3>
    <div class="form-group">
      <label class="form-label">ФИО</label>
      <input id="new-op-name" class="form-input" placeholder="Иванов Иван Иванович">
    </div>
    <div class="form-group">
      <label class="form-label">Группа</label>
      <input id="new-op-group" class="form-input" placeholder="Группа 1">
    </div>
    <div id="new-op-error" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:12px" onclick="submitAddOperator()">Добавить</button>
  `);
}

async function submitAddOperator() {
  const name = document.getElementById('new-op-name')?.value?.trim();
  const group = document.getElementById('new-op-group')?.value?.trim();
  const errEl = document.getElementById('new-op-error');
  if (!name || !group) { errEl.textContent = 'Заполните все поля'; return; }
  try {
    await api.createOperator({ full_name: name, group_name: group });
    closeModal();
    showToast('Оператор добавлен', 'ok');
    STATE.operators = await api.listOperators();
    renderAdmin();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function showAddItemModal() {
  showModal(`
    <h3 class="modal-title">Добавить бонус в магазин</h3>
    <div class="form-group">
      <label class="form-label">Название</label>
      <input id="new-item-title" class="form-input" placeholder="Сертификат на кофе">
    </div>
    <div class="form-group">
      <label class="form-label">Описание</label>
      <input id="new-item-desc" class="form-input" placeholder="Подарочная карта в кофейню">
    </div>
    <div class="form-group">
      <label class="form-label">Цена (коины)</label>
      <input id="new-item-price" class="form-input" type="number" min="1" placeholder="120">
    </div>
    <div id="new-item-error" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:12px" onclick="submitAddItem()">Добавить</button>
  `);
}

async function submitAddItem() {
  const title = document.getElementById('new-item-title')?.value?.trim();
  const description = document.getElementById('new-item-desc')?.value?.trim() || '';
  const price = +document.getElementById('new-item-price')?.value;
  const errEl = document.getElementById('new-item-error');
  if (!title || !price) { errEl.textContent = 'Заполните название и цену'; return; }
  try {
    await api.createShopItem({ title, description, price });
    closeModal();
    showToast('Бонус добавлен', 'ok');
    STATE.shopItems = await api.listShopItems();
    renderShop();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function showEditItemModal(item) {
  showModal(`
    <h3 class="modal-title">Редактировать бонус</h3>
    <div class="form-group">
      <label class="form-label">Название</label>
      <input id="edit-item-title" class="form-input" value="${esc(item.title)}">
    </div>
    <div class="form-group">
      <label class="form-label">Описание</label>
      <input id="edit-item-desc" class="form-input" value="${esc(item.description)}">
    </div>
    <div class="form-group">
      <label class="form-label">Цена (коины)</label>
      <input id="edit-item-price" class="form-input" type="number" min="1" value="${item.price}">
    </div>
    <div class="form-group">
      <label class="form-label">Активен</label>
      <select id="edit-item-active" class="form-select">
        <option value="true" ${item.is_active ? 'selected' : ''}>Да</option>
        <option value="false" ${!item.is_active ? 'selected' : ''}>Нет (скрыт)</option>
      </select>
    </div>
    <div id="edit-item-error" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:12px" onclick="submitEditItem(${item.id})">Сохранить</button>
  `);
}

async function submitEditItem(id) {
  const title = document.getElementById('edit-item-title')?.value?.trim();
  const description = document.getElementById('edit-item-desc')?.value?.trim() || '';
  const price = +document.getElementById('edit-item-price')?.value;
  const is_active = document.getElementById('edit-item-active')?.value === 'true';
  const errEl = document.getElementById('edit-item-error');
  if (!title || !price) { errEl.textContent = 'Заполните название и цену'; return; }
  try {
    await api.updateShopItem(id, { title, description, price, is_active });
    closeModal();
    showToast('Бонус обновлён', 'ok');
    STATE.shopItems = await api.listShopItems();
    renderShop();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

/* ══════════════════════════════════════════════════════════
   EXCEL IMPORT (интеграция с существующим excel-import.js)
══════════════════════════════════════════════════════════ */
// excel-import.js вызывает эту функцию после парсинга
window.onExcelImportComplete = async function(results) {
  if (!results?.operators?.length) return;
  const weekStart = document.getElementById('excel-period-start')?.value;
  const weekEnd   = document.getElementById('excel-period-end')?.value;
  if (!weekStart || !weekEnd) {
    showToast('Укажите период (даты)', 'error');
    return;
  }

  let ok = 0, fail = 0;
  for (const op of results.operators) {
    // Найти или создать оператора по имени
    let found = STATE.operators.find(o =>
      o.full_name.trim().toLowerCase() === op.name.trim().toLowerCase()
    );
    if (!found && op.name) {
      try {
        found = await api.createOperator({ full_name: op.name, group_name: op.group || 'Группа 1' });
        STATE.operators.push(found);
      } catch {}
    }
    if (!found) { fail++; continue; }

    try {
      await api.upsertWeekly({
        operator_id: found.id,
        week_start: weekStart,
        week_end: weekEnd,
        hours_score: op.hours_score || 0,
        overtime_score: op.overtime_score || 0,
        quality_score: op.quality_score || 0,
        efficiency_score: op.efficiency_score || 0,
        calls_per_hour_score: op.calls_per_hour_score || 0,
        lateness_count: op.lateness_count || 0,
        violation_count: op.violation_count || 0,
        final_score: op.final_score || null,
      });
      ok++;
    } catch { fail++; }
  }
  showToast(`Импорт: ${ok} операторов обновлено${fail ? ', ' + fail + ' ошибок' : ''}`, ok > 0 ? 'ok' : 'error');
  await reloadData();
};

/* ══════════════════════════════════════════════════════════
   EXPORT CSV
══════════════════════════════════════════════════════════ */
function exportOperatorsCSV() {
  const rows = STATE.operators.map(o => {
    const r = STATE.rating.find(rr => rr.operator_id === o.id);
    return [
      o.full_name, o.group_name,
      r?.rank_position || '', r?.contest_points?.toFixed(1) || '',
      r?.coins_earned || '', o.current_balance, o.total_earned, o.total_spent,
    ];
  });
  const header = ['ФИО','Группа','Место','Баллы','Коины (нед.)','Баланс','Заработано','Потрачено'];
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `icore_operators_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

/* ══════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════ */
function showToast(msg, type = 'ok') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('toast-show'), 10);
  setTimeout(() => { toast.classList.remove('toast-show'); setTimeout(() => toast.remove(), 300); }, 3500);
}

/* ══════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════ */
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function fmtDate(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function roleLabel(role) {
  return { operator: 'Оператор', supervisor: 'Супервайзер', manager: 'Руководитель', admin: 'Администратор' }[role] || role || '';
}

function statusLabel(s) {
  return { pending: 'Новая', approved: 'Одобрена', rejected: 'Отклонена', completed: 'Выполнена' }[s] || s;
}

function isAdmin(role) {
  return ['supervisor', 'manager', 'admin'].includes(role);
}

// Expose for modals (inline onclick)
window.closeModal = closeModal;
window.submitAddOperator = submitAddOperator;
window.submitAddItem = submitAddItem;
window.submitEditItem = submitEditItem;
window.navigateTo = navigateTo;
window.reloadData = reloadData;
