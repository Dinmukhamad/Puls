/* Выделено из 30-admin-coins-groups-operators.view.js (3110 строк).
   Вкладка «Заявки из магазина»: фильтры, пагинация, действия, экспорт. */

/* ══════════════════════════════════════
   VIEW: ЗАЯВКИ ИЗ МАГАЗИНА
══════════════════════════════════════ */
const _requestsTabState = { status: 'new', group_id: 'all', bonus_id: 'all', operator_id: 'all', operator_name: '', limit: 20, offset: 0, data: null, newCount: null };

function invalidateCoinsData() {
  swrInvalidate('coins:');
  swrInvalidate('dashboard:');
  swrInvalidate('rating:');
  swrInvalidate('shop:purchases:');
}

async function ensureCoinFiltersLoaded() {
  if (!STATE.groups.length) {
    STATE.groups = await swrFetch('groups:list', () => api.listGroups(false), null, SWR_STATIC_TTL_MS).catch(() => STATE.groups || []);
  }
  if (!STATE.shopItems.length) {
    STATE.shopItems = await swrFetch('shop:items', () => api.listShopItems(), null, SWR_STATIC_TTL_MS).catch(() => STATE.shopItems || []);
  }
}

async function renderRequests() {
  const el = document.getElementById('view-requests');
  if (!el) return;

  await ensureCoinFiltersLoaded();

  const s = _requestsTabState;
  const groups = STATE.groups || [];
  const items = STATE.shopItems || [];

  el.innerHTML = `
    ${s.operator_id !== 'all' ? `
      <div class="filter-active-banner">
        Показаны только заявки оператора <b>${esc(s.operator_name || '#' + s.operator_id)}</b>
        <button class="btn-link" onclick="clearRequestsOperatorFilter()">Сбросить</button>
      </div>` : ''}

    <div class="filter-tabs" id="req-tabs">
      ${[
        ['new', `Новые <span class="badge" id="req-new-badge">…</span>`],
        ['approved', 'Одобрены'],
        ['rejected', 'Отклонены'],
        ['all', 'Все'],
      ].map(([f, label]) => `<button class="filter-tab ${s.status===f?'active':''}" data-filter="${f}">${label}</button>`).join('')}
    </div>

    <div class="panel coins-filter-panel" style="margin:12px 0">
      <div class="panel-head">
        <h3>Фильтры</h3>
        <div class="header-right">
          <button class="btn-outline btn-sm" onclick="reloadRequestsTab()">Обновить</button>
        </div>
      </div>
      <div class="filter-row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <div class="form-group" style="margin:0">
          <label class="form-label">Группа</label>
          <select id="req-f-group" class="form-input">
            <option value="all">Все группы</option>
            ${groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Товар</label>
          <select id="req-f-bonus" class="form-input">
            <option value="all">Все товары</option>
            ${items.map(i => `<option value="${i.id}">${esc(i.title)}</option>`).join('')}
          </select>
        </div>
        <button class="btn-primary btn-sm" onclick="applyRequestsFilters()">Применить</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Заявки</h3><span class="panel-badge" id="req-total-badge">…</span></div>
      <div id="requests-list"><div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div></div>
      <div class="panel-footer" id="req-pagination-host"></div>
    </div>`;

  document.getElementById('req-f-group').value = s.group_id;
  document.getElementById('req-f-bonus').value = s.bonus_id;

  el.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      s.status = tab.dataset.filter;
      s.offset = 0;
      el.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadRequestsTabData();
    });
  });

  loadRequestsTabData();
  refreshNewRequestsBadge();
}

async function refreshNewRequestsBadge() {
  const badge = document.getElementById('req-new-badge');
  if (!badge) return;
  try {
    const r = await swrFetch('coins:requests:badge:new', () => api.listCoinRequests({ status: 'new', limit: 1 }), null, SWR_FAST_TTL_MS);
    badge.textContent = r.total ?? 0;
  } catch { badge.textContent = '?'; }
}

function _requestStatusBadge(status) {
  return `<span class="status-badge status-${status}">${statusLabel(status)}</span>`;
}

async function loadRequestsTabData() {
  const listHost = document.getElementById('requests-list');
  const totalBadge = document.getElementById('req-total-badge');
  if (!listHost) return;
  const s = _requestsTabState;
  const params = { limit: s.limit, offset: s.offset };
  if (s.status !== 'all') params.status = s.status;
  if (s.group_id !== 'all') params.group_id = s.group_id;
  if (s.bonus_id !== 'all') params.bonus_id = s.bonus_id;
  if (s.operator_id !== 'all') params.operator_id = s.operator_id;

  let data;
  const key = `coins:requests:${stableParamsKey(params)}`;
  const renderFresh = fresh => {
    if (STATE.currentView === 'coins' && STATE.coinsTab === 'requests') paintRequestsTabData(fresh);
  };
  try {
    data = await swrFetch(key, () => api.listCoinRequests(params), renderFresh, SWR_FAST_TTL_MS);
  } catch (e) {
    listHost.innerHTML = `<div class="empty-line">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  paintRequestsTabData(data);
}

function paintRequestsTabData(data) {
  const listHost = document.getElementById('requests-list');
  const totalBadge = document.getElementById('req-total-badge');
  if (!listHost || STATE.currentView !== 'coins' || STATE.coinsTab !== 'requests') return;
  const s = _requestsTabState;
  s.data = data;
  const rows = data.items || [];
  if (totalBadge) totalBadge.textContent = `${data.total ?? rows.length} записей`;

  listHost.innerHTML = rows.length ? rows.map(p => `
    <div class="request-card status-${p.status}">
      <div class="request-info">
        <div class="request-title">${esc(p.bonus_name)}</div>
        <div class="request-meta">
          <span><b>${esc(p.operator_name)}</b></span>
          <span>·</span><span>${esc(p.group_name || '—')}</span>
          <span>·</span><span class="accent-text">${p.price} ₡</span>
          <span>·</span><span>${fmtDate(p.created_at)}</span>
        </div>
        ${p.reject_reason ? `<div class="request-reason">Причина отказа: ${esc(p.reject_reason)}</div>` : ''}
      </div>
      <div class="request-status">${_requestStatusBadge(p.status)}</div>
      ${(p.status === 'pending' || p.status === 'new') ? `
        <div class="request-actions">
          <button class="btn-ok approve-btn" data-id="${p.id}">✓ Одобрить</button>
          <button class="btn-danger reject-btn" data-id="${p.id}">✗ Отклонить</button>
        </div>` : ''}
      ${p.status === 'approved' ? `
        <div class="request-actions">
          <button class="btn-ghost complete-btn" data-id="${p.id}">Отметить выполненной</button>
        </div>` : ''}
    </div>`).join('') : '<div class="empty-state">Заявок нет</div>';

  bindRequestActions();

  const pager = document.getElementById('req-pagination-host');
  if (pager) {
    const total = data.total ?? rows.length;
    const from = s.offset + 1;
    const to = Math.min(total, s.offset + s.limit);
    pager.innerHTML = `
      <span class="cell-muted">${total ? `${from}–${to} из ${total}` : ''}</span>
      <div style="display:flex;gap:8px">
        <button class="btn-outline btn-sm" ${s.offset === 0 ? 'disabled' : ''} onclick="requestsPagePrev()">← Назад</button>
        <button class="btn-outline btn-sm" ${to >= total ? 'disabled' : ''} onclick="requestsPageNext()">Далее →</button>
      </div>`;
  }
}

function applyRequestsFilters() {
  _requestsTabState.group_id = document.getElementById('req-f-group')?.value || 'all';
  _requestsTabState.bonus_id = document.getElementById('req-f-bonus')?.value || 'all';
  _requestsTabState.offset = 0;
  loadRequestsTabData();
}
function requestsPagePrev() { _requestsTabState.offset = Math.max(0, _requestsTabState.offset - _requestsTabState.limit); loadRequestsTabData(); }
function requestsPageNext() { _requestsTabState.offset += _requestsTabState.limit; loadRequestsTabData(); }
function reloadRequestsTab() { loadRequestsTabData(); refreshNewRequestsBadge(); }

function openRequestsForOperator(operatorId, operatorName) {
  _requestsTabState.operator_id = String(operatorId);
  _requestsTabState.operator_name = operatorName;
  _requestsTabState.status = 'all';
  _requestsTabState.offset = 0;
  navigateTo('coins', { tab: 'requests' });
}
function clearRequestsOperatorFilter() {
  _requestsTabState.operator_id = 'all';
  _requestsTabState.offset = 0;
  renderRequests();
}

function exportShopRequests(format) {
  const s = _requestsTabState;
  const params = { format };
  if (s.status !== 'all') params.status = s.status;
  if (s.operator_id !== 'all') params.operator_id = s.operator_id;
  window.open(api.exportUrl('/api/exports/shop-requests', params), '_blank');
}

function bindRequestActions() {
  const el = document.getElementById('view-requests');
  if (!el) return;
  el.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api.approveCoinRequest(+btn.dataset.id);
        invalidateCoinsData();
        showToast('Заявка одобрена', 'ok');
        STATE.dashboard = await swrFetch('dashboard:main', () => api.getDashboard().catch(() => STATE.dashboard), null, SWR_DEFAULT_TTL_MS);
        loadRequestsTabData();
        refreshNewRequestsBadge();
      } catch (err) { showToast(err.message, 'error'); btn.disabled = false; }
    });
  });
  el.querySelectorAll('.reject-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = prompt('Причина отказа (обязательно):');
      if (!reason?.trim()) return;
      btn.disabled = true;
      try {
        await api.rejectCoinRequest(+btn.dataset.id, reason.trim());
        invalidateCoinsData();
        showToast('Заявка отклонена', 'ok');
        STATE.dashboard = await swrFetch('dashboard:main', () => api.getDashboard().catch(() => STATE.dashboard), null, SWR_DEFAULT_TTL_MS);
        loadRequestsTabData();
        refreshNewRequestsBadge();
      } catch (err) { showToast(err.message, 'error'); btn.disabled = false; }
    });
  });
  el.querySelectorAll('.complete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api.completeCoinRequest(+btn.dataset.id);
        invalidateCoinsData();
        loadRequestsTabData();
      } catch (err) { showToast(err.message, 'error'); btn.disabled = false; }
    });
  });
}
