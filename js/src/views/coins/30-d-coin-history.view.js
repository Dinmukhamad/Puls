/* Выделено из 30-admin-coins-groups-operators.view.js (3110 строк).
   Вкладка «История операций»: фильтры, пагинация, серверный экспорт. */

/* ══════════════════════════════════════
   VIEW: ИСТОРИЯ ОПЕРАЦИЙ
══════════════════════════════════════ */
const _historyTabState = {
  filters: { type: 'all', operator_id: 'all', operator_name: '', source: 'all', created_by: 'all', start_date: '', end_date: '' },
  limit: 50, offset: 0, data: null,
};

const _historySourceLabels = {
  weekly_auto_accrual: 'Автоматический расчёт',
  achievement: 'Достижение',
  level_up: 'Повышение уровня',
  manual: 'Ручная операция',
  manual_grant: 'Ручная выдача',
  wheel_spin: 'Колесо WOW',
};

function renderHistory() {
  const el = document.getElementById('view-history');
  if (!el) return;
  const f = _historyTabState.filters;

  el.innerHTML = `
    ${f.operator_id !== 'all' ? `
      <div class="filter-active-banner">
        Показаны только операции оператора <b>${esc(f.operator_name || '#' + f.operator_id)}</b>
        <button class="btn-link" onclick="clearHistoryOperatorFilter()">Сбросить</button>
      </div>` : ''}

    <div class="panel coins-filter-panel" style="margin-bottom:16px">
      <div class="panel-head">
        <h3>Фильтры</h3>
        <div class="header-right">
          <button class="btn-outline btn-sm" onclick="reloadHistoryTab()">Обновить</button>
        </div>
      </div>
      <div class="filter-row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <div class="form-group" style="margin:0">
          <label class="form-label">Тип</label>
          <select id="hist-f-type" class="form-input">
            <option value="all">Все</option>
            <option value="weekly_accrual">Авт. начисление</option>
            <option value="bonus_top">Бонус: топ недели</option>
            <option value="bonus_no_late">Бонус: без опозданий</option>
            <option value="bonus_no_violation">Бонус: без нарушений</option>
            <option value="bonus_nomination">Бонус: номинация</option>
            <option value="bonus_driver_thanks">Бонус: благодарность</option>
            <option value="achievement_reward">Достижение</option>
            <option value="manual_add">Ручное начисление</option>
            <option value="manual_subtract">Ручное списание</option>
            <option value="purchase">Покупка бонуса</option>
            <option value="refund">Возврат коинов</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Источник</label>
          <select id="hist-f-source" class="form-input">
            <option value="all">Все</option>
            <option value="weekly_auto_accrual">Еженедельный расчёт</option>
            <option value="achievement">Достижение</option>
            <option value="level_up">Повышение уровня</option>
            <option value="wheel_spin">Колесо WOW</option>
            <option value="manual">Ручная операция</option>
            <option value="manual_grant">Ручная выдача</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Дата от</label>
          <input type="date" id="hist-f-start" class="form-input" value="${esc(f.start_date)}">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Дата до</label>
          <input type="date" id="hist-f-end" class="form-input" value="${esc(f.end_date)}">
        </div>
        <button class="btn-primary btn-sm" onclick="applyHistoryFilters()">Применить</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Транзакции</h3>
        <span class="panel-badge" id="hist-total-badge">…</span>
      </div>
      <div class="table-wrap" id="hist-table-host">
        <div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>
      </div>
      <div class="panel-footer" id="hist-pagination-host"></div>
    </div>`;

  document.getElementById('hist-f-type').value = f.type;
  document.getElementById('hist-f-source').value = f.source;
  loadHistoryTabData();
}

async function loadHistoryTabData() {
  const tableHost = document.getElementById('hist-table-host');
  const badge = document.getElementById('hist-total-badge');
  if (!tableHost) return;
  const f = _historyTabState.filters;
  const params = { limit: _historyTabState.limit, offset: _historyTabState.offset };
  if (f.type !== 'all') params.type = f.type;
  if (f.source !== 'all') params.source = f.source;
  if (f.operator_id !== 'all') params.operator_id = f.operator_id;
  if (f.start_date) params.start_date = f.start_date;
  if (f.end_date) params.end_date = f.end_date;

  let data;
  const key = `coins:transactions:${stableParamsKey(params)}`;
  const renderFresh = fresh => {
    if (STATE.currentView === 'coins' && STATE.coinsTab === 'history') paintHistoryTabData(fresh);
  };
  try {
    data = await swrFetch(key, () => api.listCoinTransactions(params), renderFresh, SWR_FAST_TTL_MS);
  } catch (e) {
    tableHost.innerHTML = `<div class="empty-line">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  paintHistoryTabData(data);
}

function paintHistoryTabData(data) {
  const tableHost = document.getElementById('hist-table-host');
  const badge = document.getElementById('hist-total-badge');
  if (!tableHost || STATE.currentView !== 'coins' || STATE.coinsTab !== 'history') return;
  _historyTabState.data = data;
  const items = data.items || [];
  if (badge) badge.textContent = `${data.total ?? items.length} записей`;

  tableHost.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Дата</th><th>Оператор</th><th>Группа</th>
        <th>Тип</th><th>Коины</th><th>Причина</th><th>Автор</th><th>Источник</th>
      </tr></thead>
      <tbody>
        ${items.length ? items.map(t => `
          <tr>
            <td style="white-space:nowrap">${fmtDate(t.created_at)}</td>
            <td class="name-cell">${esc(t.operator_name)}</td>
            <td>${esc(t.group_name)}</td>
            <td><span style="font-size:11px;color:var(--tx3)">${esc(transactionTypeLabel(t.type))}</span></td>
            <td><b style="color:${t.amount>=0?'var(--ok)':'var(--danger)'}">${t.amount>=0?'+':''}${t.amount} ₡</b></td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.comment)}">${esc(t.comment)}</td>
            <td style="font-size:12px;color:var(--tx3)">${esc(t.created_by_name||'Система')}</td>
            <td style="font-size:11px;color:var(--tx3)">${esc(_historySourceLabels[t.source_type] || t.source_type || '—')}</td>
          </tr>`).join('') : '<tr><td colspan="8" class="empty-line">Нет операций по заданным фильтрам</td></tr>'}
      </tbody>
    </table>`;

  const pager = document.getElementById('hist-pagination-host');
  if (pager) {
    const total = data.total ?? items.length;
    const from = _historyTabState.offset + 1;
    const to = Math.min(total, _historyTabState.offset + _historyTabState.limit);
    pager.innerHTML = `
      <span class="cell-muted">${total ? `${from}–${to} из ${total}` : ''}</span>
      <div style="display:flex;gap:8px">
        <button class="btn-outline btn-sm" ${_historyTabState.offset === 0 ? 'disabled' : ''} onclick="historyPagePrev()">← Назад</button>
        <button class="btn-outline btn-sm" ${to >= total ? 'disabled' : ''} onclick="historyPageNext()">Далее →</button>
      </div>`;
  }
}

function openHistoryForOperator(operatorId, operatorName) {
  _historyTabState.filters.operator_id = String(operatorId);
  _historyTabState.filters.operator_name = operatorName;
  _historyTabState.offset = 0;
  navigateTo('coins', { tab: 'history' });
}
function clearHistoryOperatorFilter() {
  _historyTabState.filters.operator_id = 'all';
  _historyTabState.offset = 0;
  renderHistory();
}

function applyHistoryFilters() {
  _historyTabState.filters.type = document.getElementById('hist-f-type')?.value || 'all';
  _historyTabState.filters.source = document.getElementById('hist-f-source')?.value || 'all';
  _historyTabState.filters.start_date = document.getElementById('hist-f-start')?.value || '';
  _historyTabState.filters.end_date = document.getElementById('hist-f-end')?.value || '';
  _historyTabState.offset = 0;
  loadHistoryTabData();
}

function historyPagePrev() {
  _historyTabState.offset = Math.max(0, _historyTabState.offset - _historyTabState.limit);
  loadHistoryTabData();
}
function historyPageNext() {
  _historyTabState.offset += _historyTabState.limit;
  loadHistoryTabData();
}
function reloadHistoryTab() { loadHistoryTabData(); }

function exportHistoryServerSide(format = 'csv') {
  const f = _historyTabState.filters;
  const params = { format };
  if (f.type !== 'all') params.type = f.type;
  if (f.source !== 'all') params.source = f.source;
  if (f.operator_id !== 'all') params.operator_id = f.operator_id;
  if (f.start_date) params.start_date = f.start_date;
  if (f.end_date) params.end_date = f.end_date;
  window.open(api.exportUrl('/api/exports/coin-transactions', params), '_blank');
}
