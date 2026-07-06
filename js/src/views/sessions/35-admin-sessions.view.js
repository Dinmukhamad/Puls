let _sessionFilterStatus = 'active';
let _sessionFilterQuery = '';

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
      <div class="kpi-card kpi-accent"><div class="kpi-label">Активные</div><div class="kpi-value">${stats.active || 0}</div></div>
      <div class="kpi-card"><div class="kpi-label">Показано</div><div class="kpi-value">${stats.shown || items.length}</div></div>
      <div class="kpi-card kpi-warn"><div class="kpi-label">Истёкшие</div><div class="kpi-value">${stats.expired || 0}</div></div>
      <div class="kpi-card"><div class="kpi-label">Сброшенные</div><div class="kpi-value">${stats.revoked || 0}</div></div>
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
