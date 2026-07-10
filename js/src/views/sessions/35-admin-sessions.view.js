let _sessionFilterStatus = 'active';
let _sessionFilterQuery = '';
let _sessionFilterRole = 'all';
let _sessionFilterDevice = 'all';

function sessionsDebounce(fn, delay = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function sessionStatusBadge(status, expiresAt) {
  if (status === 'revoked') return '<span class="badge badge-muted">сброшена</span>';
  if (status === 'expired') return '<span class="badge badge-warning">истекла</span>';
  return '<span class="badge badge-ok">активна</span>';
}

function sessionSafeDate(value) {
  return value ? esc(fmtDateTime(value)) : '—';
}

async function renderAdminSessions() {
  const el = document.getElementById('view-sessions');
  if (!el) return;
  if (STATE.user?.role !== 'admin') {
    el.innerHTML = '<div class="empty-state">Раздел доступен только администратору</div>';
    return;
  }

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Безопасность</div>
        <h2 class="section-title">Сессии пользователей</h2>
      </div>
      <div class="header-right">
        <button class="btn-outline" id="sessions-refresh-btn">Обновить</button>
      </div>
    </div>
    <div class="panel sessions-panel">
      <div class="sessions-loading"><div class="loading-spinner"></div><span>Загрузка сессий...</span></div>
    </div>`;

  try {
    const data = await api.listSessions({
      status: _sessionFilterStatus,
      q: _sessionFilterQuery,
      role: _sessionFilterRole,
      device: _sessionFilterDevice,
      limit: 250,
    });
    paintAdminSessions(el, data || { items: [], stats: {} });
  } catch (err) {
    el.querySelector('.sessions-panel').innerHTML = `<div class="empty-state">Не удалось загрузить сессии: ${esc(err.message || err)}</div>`;
  }
}

function paintAdminSessions(el, data) {
  const items = data.items || [];
  const stats = data.stats || {};
  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Безопасность</div>
        <h2 class="section-title">Сессии пользователей</h2>
      </div>
      <div class="header-right">
        <button class="btn-outline" id="sessions-refresh-btn">Обновить</button>
      </div>
    </div>

    <div class="kpi-grid sessions-kpis">
      <div class="kpi-card kpi-accent"><div class="kpi-label">Активные сессии</div><div class="kpi-value">${stats.active || 0}</div></div>
      <div class="kpi-card"><div class="kpi-label">Пользователей онлайн</div><div class="kpi-value">${stats.total_users != null ? stats.total_users : '—'}</div></div>
      <div class="kpi-card kpi-warn"><div class="kpi-label">Истёкшие</div><div class="kpi-value">${stats.expired || 0}</div></div>
      <div class="kpi-card"><div class="kpi-label">Сброшенные</div><div class="kpi-value">${stats.revoked || 0}</div></div>
    </div>

    <div class="sessions-filterbar">
      <div class="filter-tabs" id="sessions-role-tabs">
        ${[
          ['all', 'Все', stats.active || 0],
          ['admin', 'Админы', (stats.by_role && stats.by_role.admin) || 0],
          ['supervisor', 'Супервайзеры', (stats.by_role && stats.by_role.supervisor) || 0],
          ['operator', 'Операторы', (stats.by_role && stats.by_role.operator) || 0],
        ].map(([v, t, c]) => `<button class="filter-tab ${_sessionFilterRole === v ? 'active' : ''}" data-role="${v}">${t}<span class="filter-tab-count">${c}</span></button>`).join('')}
      </div>
      <div class="filter-tabs" id="sessions-device-tabs">
        ${[
          ['all', 'Все устройства', stats.active || 0],
          ['pc', 'ПК', (stats.by_device && stats.by_device.pc) || 0],
          ['mobile', 'Телефон', (stats.by_device && stats.by_device.mobile) || 0],
        ].map(([v, t, c]) => `<button class="filter-tab ${_sessionFilterDevice === v ? 'active' : ''}" data-device="${v}">${t}<span class="filter-tab-count">${c}</span></button>`).join('')}
      </div>
    </div>

    <div class="panel sessions-panel">
      <div class="panel-head sessions-head">
        <div>
          <h3>Устройства и входы</h3>
          <p class="panel-hint">IP определяется по proxy-заголовкам Railway, устройство — по User-Agent браузера.</p>
        </div>
        <div class="sessions-filters">
          <select class="form-select" id="sessions-status">
            ${[['active','Активные'],['all','Все'],['revoked','Сброшенные'],['expired','Истёкшие']].map(([v,t]) => `<option value="${v}" ${_sessionFilterStatus === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <input class="form-input" id="sessions-query" placeholder="Поиск: имя, логин, IP, устройство" value="${esc(_sessionFilterQuery)}">
        </div>
      </div>
      <div class="table-wrap sessions-table-wrap">
        <table class="data-table sessions-table">
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Устройство</th>
              <th>IP</th>
              <th>Вход</th>
              <th>Активность</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${items.length ? items.map(sessionRow).join('') : '<tr><td colspan="7"><div class="empty-line">Сессий пока нет</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  el.querySelector('#sessions-refresh-btn')?.addEventListener('click', () => renderAdminSessions());
  el.querySelector('#sessions-status')?.addEventListener('change', e => {
    _sessionFilterStatus = e.target.value || 'active';
    renderAdminSessions();
  });
  el.querySelector('#sessions-role-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-role]');
    if (!btn) return;
    _sessionFilterRole = btn.dataset.role || 'all';
    renderAdminSessions();
  });
  el.querySelector('#sessions-device-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-device]');
    if (!btn) return;
    _sessionFilterDevice = btn.dataset.device || 'all';
    renderAdminSessions();
  });
  el.querySelector('#sessions-query')?.addEventListener('input', sessionsDebounce(e => {
    _sessionFilterQuery = e.target.value || '';
    renderAdminSessions();
  }, 350));
}

function sessionRow(s) {
  const canRevoke = s.status === 'active' && !s.is_current;
  return `
    <tr>
      <td>
        <div class="name-cell">${esc(s.user_name || s.username || '—')} ${s.is_current ? '<span class="me-badge">текущая</span>' : ''}</div>
        <div class="cell-muted">${esc(s.username || '')} · ${esc(roleLabel(s.role))}</div>
      </td>
      <td>
        <div class="sessions-device">${esc(s.device_label || 'Unknown device')}</div>
        <div class="cell-muted">${esc(s.browser_label || '')}${s.os_label ? ' · ' + esc(s.os_label) : ''}</div>
      </td>
      <td><span class="sessions-ip">${esc(s.ip_address || '—')}</span></td>
      <td>${sessionSafeDate(s.created_at)}</td>
      <td>${sessionSafeDate(s.last_seen_at)}</td>
      <td>${sessionStatusBadge(s.status, s.expires_at)}</td>
      <td class="row-actions">
        <button class="btn-outline btn-sm danger-text" ${canRevoke ? '' : 'disabled'} onclick="revokeUserSession('${esc(s.session_id)}')">Сбросить</button>
        <button class="btn-ghost btn-sm" onclick="revokeAllUserSessions(${Number(s.user_id) || 0})" ${s.user_id ? '' : 'disabled'}>Все</button>
      </td>
    </tr>`;
}

async function revokeUserSession(sessionId) {
  if (!sessionId) return;
  if (!confirm('Сбросить эту сессию? Пользователь выйдет из аккаунта на этом устройстве.')) return;
  try {
    await api.revokeSession(sessionId);
    showToast('Сессия сброшена', 'ok');
    renderAdminSessions();
  } catch (err) {
    showToast(err.message || 'Не удалось сбросить сессию', 'err');
  }
}

async function revokeAllUserSessions(userId) {
  if (!userId) return;
  if (!confirm('Сбросить все активные сессии этого пользователя?')) return;
  try {
    const result = await api.revokeUserSessions(userId, true);
    showToast(`Сброшено сессий: ${result.revoked || 0}`, 'ok');
    renderAdminSessions();
  } catch (err) {
    showToast(err.message || 'Не удалось сбросить сессии', 'err');
  }
}

window.revokeUserSession = revokeUserSession;
window.revokeAllUserSessions = revokeAllUserSessions;
