/* Выделено из 60-wheel-tests.view.js (2603 строки).
   Вкладки операций, билетов, вращений и статистики. */

let _wheelTicketFilter = '';
async function renderWheelOperationsTab(body) {
  body.innerHTML = `<div class="panel wheel-admin-panel"><div class="empty-state"><div class="loading-spinner"></div></div></div>`;
  const ticketKey = `wheel:admin:tokens:${_wheelTicketFilter || 'all'}`;
  const rerender = () => wheelRefreshIfTab('operations', renderWheelOperationsTab, body);
  const [ticketsData, spinsData, stats] = await Promise.all([
    wheelCachedFetch(ticketKey, () => api.getWheelTokens(_wheelTicketFilter ? { token_status: _wheelTicketFilter, limit: 80 } : { limit: 80 }), { __fallback: true, items: [] }, rerender),
    wheelCachedFetch('wheel:admin:spins', () => api.getWheelSpins({ limit: 80 }), { __fallback: true, items: [] }, rerender),
    wheelCachedFetch('wheel:admin:stats', () => api.getWheelStats(), { __fallback: true, tokens_issued: 0, tokens_used: 0, tokens_expired: 0, spins_completed: 0, coins_awarded: 0, manual_granted: 0, prizes_histogram: [], top_sources: [] }, rerender),
  ]);

  const tickets = ticketsData.items || [];
  const spins = spinsData.items || [];
  const statusBadge = { available: 'badge-ok', used: 'badge-muted', expired: 'badge-warning', cancelled: 'badge-muted' };
  const statusLabel = { available: 'доступен', used: 'использован', expired: 'истёк', cancelled: 'отменён' };
  const filters = [['', 'Все'], ['available', 'Доступные'], ['used', 'Использованные'], ['expired', 'Истёкшие'], ['cancelled', 'Отменённые']];
  const uniqueOperators = new Set(spins.map(r => r.operator_id).filter(Boolean)).size;

  body.innerHTML = `
    <div class="wheel-ops-shell">
      <div class="wheel-ops-hero">
        <div>
          <div class="section-kicker">Операции</div>
          <h3>Билеты, прокрутки и статистика</h3>
          <p>Единый контроль попыток Wheel of WOW без переключения между отдельными экранами.</p>
        </div>
        <button class="btn-primary" data-wheel-go-issue>Выдать билет</button>
      </div>

      <div class="wheel-metric-grid">
        <div class="wheel-metric"><span>${stats?.tokens_issued ?? 0}</span><p>попыток выдано сегодня</p></div>
        <div class="wheel-metric"><span>${stats?.tokens_used ?? 0}</span><p>использовано</p></div>
        <div class="wheel-metric"><span>${stats?.spins_completed ?? 0}</span><p>прокруток сегодня</p></div>
        <div class="wheel-metric"><span>${stats?.coins_awarded ?? 0}</span><p>коинов выдано</p></div>
        <div class="wheel-metric"><span>${uniqueOperators}</span><p>участников в истории</p></div>
      </div>

      <div class="wheel-ops-grid">
        <section class="panel wheel-admin-panel">
          <div class="panel-head">
            <h3>Билеты</h3>
            <span class="panel-badge">${tickets.length}</span>
          </div>
          <div class="wheel-admin-content">
            <div class="filter-tabs wheel-subtabs">
              ${filters.map(([f, l]) => `<button class="filter-tab ${_wheelTicketFilter === f ? 'active' : ''}" data-ticket-filter="${f}">${l}</button>`).join('')}
            </div>
            ${tickets.length ? `<div class="wheel-record-list">${tickets.map(t => `<article class="wheel-record-row">
                <div class="wheel-record-main"><strong>${esc(t.operator_name)}</strong><span>${esc(t.reason_text || wheelSourceLabel(t.reason_type) || 'Без пояснения')}</span></div>
                <div class="wheel-record-meta"><span>Выдан ${esc(fmtDateTime(t.created_at))}</span><span>${t.expires_at ? 'До ' + esc(fmtDateTime(t.expires_at)) : 'Без срока'}</span></div>
                <span class="badge ${statusBadge[t.status] || 'badge-muted'}">${statusLabel[t.status] || t.status}</span>
              </article>`).join('')}</div>` : '<div class="empty-state wheel-empty"><p>Билетов пока нет.</p></div>'}
          </div>
        </section>

        <section class="panel wheel-admin-panel">
          <div class="panel-head">
            <h3>История прокруток</h3>
            <span class="panel-badge">${spins.length}</span>
          </div>
          <div class="wheel-admin-content">
            ${spins.length ? `<div class="wheel-record-list">${spins.map(r => `<article class="wheel-record-row wheel-spin-record">
                <div class="wheel-record-main"><strong>${esc(r.operator_name)}</strong><span>${esc(r.group_name || 'Без группы')}</span></div>
                <div class="wheel-record-prize"><span class="wheel-type-pill">${esc(wheelPrizeTypeLabel(r.prize_type))}</span><strong>${esc(r.prize)}</strong></div>
                <div class="wheel-record-reason">${esc(r.reason || 'Без пояснения')}</div>
                <time>${esc(fmtDateTime(r.date))}</time>
              </article>`).join('')}</div>` : '<div class="empty-state wheel-empty"><p>Прокруток пока нет.</p></div>'}
          </div>
        </section>
      </div>

      <section class="panel wheel-admin-panel">
        <div class="panel-head"><h3>Статистика по призам и источникам</h3></div>
        <div class="wheel-admin-content">
          <div class="two-col-grid">
            <div>
              <h4 class="panel-subtitle">Частота призов</h4>
              ${(stats?.prizes_histogram || []).length ? `<div class="wheel-chip-list">${stats.prizes_histogram.map(h => `<span class="wheel-data-chip"><strong>${esc(h.title)}</strong>${h.count}</span>`).join('')}</div>` : '<div class="empty-line">Прокруток сегодня нет</div>'}
            </div>
            <div>
              <h4 class="panel-subtitle">Источники попыток</h4>
              ${(stats?.top_sources || []).length ? `<div class="wheel-chip-list">${stats.top_sources.map(x => `<span class="wheel-data-chip"><strong>${esc(wheelSourceLabel(x.reason_type))}</strong>${x.count}</span>`).join('')}</div>` : '<div class="empty-line">Токенов сегодня не выдавалось</div>'}
            </div>
          </div>
        </div>
      </section>
    </div>`;

  body.querySelectorAll('[data-ticket-filter]').forEach(b => {
    b.onclick = () => { _wheelTicketFilter = b.dataset.ticketFilter; renderWheelOperationsTab(body); };
  });
  const issueBtn = body.querySelector('[data-wheel-go-issue]');
  if (issueBtn) issueBtn.onclick = () => { _wheelStaffTab = 'issue'; renderWheelStaffView(document.getElementById('view-wheel')); };
}

async function renderWheelTicketsTab(body) {
  let data;
  try {
    data = await api.getWheelTokens(_wheelTicketFilter ? { token_status: _wheelTicketFilter, limit: 300 } : { limit: 300 });
  } catch (err) {
    body.innerHTML = `<div class="panel"><div class="status-line status-error">${esc(err.message)}</div></div>`;
    return;
  }
  const rows = data.items || [];
  const statusBadge = { available: 'badge-ok', used: 'badge-muted', expired: 'badge-warning', cancelled: 'badge-muted' };
  const statusLabel = { available: 'доступен', used: 'использован', expired: 'истёк', cancelled: 'отменён' };
  const filters = [['', 'Все'], ['available', 'Доступные'], ['used', 'Использованные'], ['expired', 'Истёкшие'], ['cancelled', 'Отменённые']];

  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head"><h3>Билеты</h3><span class="panel-badge">${rows.length}</span></div>
      <div class="wheel-admin-content">
        <div class="filter-tabs" style="margin-bottom:14px">
          ${filters.map(([f, l]) => `<button class="filter-tab ${_wheelTicketFilter === f ? 'active' : ''}" data-ticket-filter="${f}">${l}</button>`).join('')}
        </div>
        ${rows.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Создан</th><th>Оператор</th><th>Причина</th><th>Источник</th><th>Истекает</th><th>Использован</th><th>Статус</th></tr></thead>
          <tbody>${rows.map(t => `<tr>
            <td>${esc(fmtDateTime(t.created_at))}</td>
            <td class="name-cell">${esc(t.operator_name)}</td>
            <td>${esc(t.reason_text || '—')}</td>
            <td>${esc(wheelSourceLabel(t.reason_type))}</td>
            <td>${t.expires_at ? esc(fmtDateTime(t.expires_at)) : '—'}</td>
            <td>${t.used_at ? esc(fmtDateTime(t.used_at)) : '—'}</td>
            <td><span class="badge ${statusBadge[t.status] || 'badge-muted'}">${statusLabel[t.status] || t.status}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty-state wheel-empty"><p>Билетов пока нет.</p></div>'}
      </div>
    </div>`;

  body.querySelectorAll('[data-ticket-filter]').forEach(b => {
    b.onclick = () => { _wheelTicketFilter = b.dataset.ticketFilter; renderWheelTicketsTab(body); };
  });
}

async function renderWheelSpinsTab(body) {
  let data;
  try {
    data = await api.getWheelSpins({ limit: 200 });
  } catch (err) {
    body.innerHTML = `<div class="panel"><div class="status-line status-error">${esc(err.message)}</div></div>`;
    return;
  }
  const rows = data.items || [];
  const totalCoins = rows.filter(r => r.prize_type === 'coins').reduce((s, r) => s + (r.amount || 0), 0);
  const uniqueOperators = new Set(rows.map(r => r.operator_id).filter(Boolean)).size;
  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head">
        <h3>История прокруток</h3>
        <span class="panel-badge">${rows.length} записей</span>
      </div>
      <div class="wheel-admin-content">
        <div class="wheel-stats-row">
          <div class="wheel-stat"><span class="wheel-stat-num">${rows.length}</span><span>прокруток</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${totalCoins}</span><span>коинов выдано</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${uniqueOperators}</span><span>участников</span></div>
        </div>
        ${rows.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Дата</th><th>Оператор</th><th>Группа</th><th>Причина</th><th>Приз</th><th>Тип</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td>${esc(fmtDateTime(r.date))}</td>
            <td class="name-cell">${esc(r.operator_name)}</td>
            <td>${esc(r.group_name || '—')}</td>
            <td>${esc(r.reason || '—')}</td>
            <td><strong>${esc(r.prize)}</strong></td>
            <td><span class="wheel-type-pill">${esc(wheelPrizeTypeLabel(r.prize_type))}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty-state wheel-empty"><p>Прокруток пока нет.</p></div>'}
      </div>
    </div>`;
}

/* ---------- Стафф: статистика (ТЗ 16) ---------- */
async function renderWheelStatsTab(body) {
  let s;
  try {
    s = await api.getWheelStats();
  } catch (err) {
    body.innerHTML = `<div class="panel"><div class="status-line status-error">${esc(err.message)}</div></div>`;
    return;
  }
  const hist = s.prizes_histogram || [];
  const src = s.top_sources || [];
  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head"><h3>Статистика за сегодня</h3></div>
      <div class="wheel-admin-content">
        <div class="wheel-stats-row">
          <div class="wheel-stat"><span class="wheel-stat-num">${s.tokens_issued}</span><span>выдано попыток</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${s.tokens_used}</span><span>использовано</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${s.tokens_expired}</span><span>сгорело</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${s.coins_awarded}</span><span>коинов выдано</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${s.manual_granted}</span><span>выдано вручную</span></div>
        </div>
        <div class="two-col-grid">
          <div>
            <h4 class="panel-subtitle">Частота призов</h4>
            ${hist.length ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Приз</th><th>Раз</th></tr></thead>
              <tbody>${hist.map(h => `<tr><td>${esc(h.title)}</td><td><strong>${h.count}</strong></td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty-line">Прокруток сегодня нет</div>'}
          </div>
          <div>
            <h4 class="panel-subtitle">Топ источников попыток</h4>
            ${src.length ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Источник</th><th>Токенов</th></tr></thead>
              <tbody>${src.map(x => `<tr><td>${esc(wheelSourceLabel(x.reason_type))}</td><td><strong>${x.count}</strong></td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty-line">Токенов сегодня не выдавалось</div>'}
          </div>
        </div>
      </div>
    </div>`;
}
