let _sessionFilterStatus = 'active';
let _sessionFilterQuery = '';
let _sessionFilterRole = 'all';
let _sessionFilterDevice = 'all';
let _sessionFilterLimit = 100;

function sessionsDebounce(fn, delay = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Живость сессии: как давно её видели. ТЗ (стр. 24) отдельно оговаривает,
 * что activity_state и status — разные понятия и разные бейджи. Раньше в
 * колонке «Состояние» показывался только activity_state, и отозванную
 * сессию было не отличить от давно неактивной.
 */
function sessionActivityBadge(state) {
  const meta = {
    current: ['Текущая', 'accent'],
    active: ['Активна <15 мин', 'success'],
    recent: ['Недавняя', 'warning'],
    inactive: ['Неактивна', 'neutral'],
    ended: ['Завершена', 'neutral'],
  };
  const [label, tone] = meta[state] || ['Неактивна', 'neutral'];
  return `<span class="ui-badge ui-badge--${tone}">${label}</span>`;
}

/** Судьба сессии: жива, отозвана или истёк срок. */
function sessionStatusBadge(status) {
  const meta = {
    active: ['Активна', 'success'],
    revoked: ['Отозвана', 'danger'],
    expired: ['Истекла', 'neutral'],
  };
  const [label, tone] = meta[status] || [status || '—', 'neutral'];
  return `<span class="ui-badge ui-badge--${tone}">${label}</span>`;
}

function sessionSafeDate(value) {
  return value ? esc(fmtDateTime(value)) : '—';
}

function sessionsCacheKey() {
  return `sessions:list:${_sessionFilterStatus}:${_sessionFilterRole}:${_sessionFilterDevice}:${_sessionFilterLimit}:${_sessionFilterQuery || ''}`;
}

function sessionsFetchCurrent(onFresh) {
  return swrFetch(
    sessionsCacheKey(),
    () => api.listSessions({
      status: _sessionFilterStatus,
      q: _sessionFilterQuery,
      role: _sessionFilterRole,
      device: _sessionFilterDevice,
      limit: _sessionFilterLimit,
    }),
    onFresh,
    SWR_FAST_TTL_MS,
  );
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
        <h1 class="section-title">Сессии пользователей</h1>
      </div>
      <div class="header-right">
        <button class="btn-outline" id="sessions-refresh-btn">Обновить</button>
      </div>
    </div>
    <div class="panel sessions-panel">
      <div class="sessions-loading"><div class="loading-spinner"></div><span>Загрузка сессий...</span></div>
    </div>`;

  try {
    const data = await sessionsFetchCurrent((fresh) => {
      if (STATE.currentView === 'sessions') paintAdminSessions(el, fresh || { items: [], stats: {} });
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
        <h1 class="section-title">Сессии пользователей</h1>
      </div>
      <div class="header-right">
        <button class="btn-outline" id="sessions-refresh-btn">Обновить</button>
      </div>
    </div>

    <div class="ui-kpi-grid sessions-kpis">
      ${uiKpi({ label: 'Активных сессий', value: stats.active || 0, tone: 'neutral' })}
      ${uiKpi({ label: 'Активны сейчас', value: stats.active_now || 0, tone: 'ok',
                note: 'видели за последние 15 минут' })}
      ${uiKpi({ label: 'За 24 часа', value: stats.last_24h || 0 })}
      ${uiKpi({ label: 'Подозрительные', value: stats.suspicious || 0,
                tone: (stats.suspicious || 0) ? 'warn' : 'neutral',
                note: 'пять и больше активных сессий у одного человека' })}
      ${uiKpi({ label: 'Устройств', value: stats.total_devices || 0 })}
      ${uiKpi({ label: 'Пользователей', value: stats.total_users || 0 })}
      ${uiKpi({ label: 'Отозвано', value: stats.revoked || 0 })}
      ${uiKpi({ label: 'Истекло', value: stats.expired || 0 })}
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
          <label class="sr-only" for="sessions-status">Фильтр по состоянию сессии</label>
          <select class="form-select" id="sessions-status">
            ${[['active','Активные'],['all','Все'],['revoked','Сброшенные'],['expired','Истёкшие']].map(([v,t]) => `<option value="${v}" ${_sessionFilterStatus === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <label class="sr-only" for="sessions-query">Поиск по сессиям</label>
          <input class="form-input" id="sessions-query" placeholder="Поиск: имя, логин, IP, устройство" value="${esc(_sessionFilterQuery)}">
          <label class="sr-only" for="sessions-limit">Сколько сессий показывать</label>
          <select class="form-select" id="sessions-limit">
            ${[25, 50, 100, 200].map(n => `<option value="${n}" ${_sessionFilterLimit === n ? 'selected' : ''}>${n} на странице</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="table-wrap sessions-table-wrap">
        <table class="data-table sessions-table" data-mobile="cards">
          <thead>
            <tr>
              <th scope="col">Пользователь</th>
              <th scope="col">Устройство / браузер</th>
              <th scope="col">IP</th>
              <th scope="col">Вход</th>
              <th scope="col">Последняя активность</th>
              <th scope="col">Состояние</th>
              <th scope="col">Действия</th>
            </tr>
          </thead>
          <tbody>
            ${items.length ? items.map(sessionRow).join('') : `<tr><td colspan="7" class="table-state">${
              (_sessionFilterQuery || _sessionFilterRole !== 'all' || _sessionFilterDevice !== 'all')
                ? uiNoResultsState('Ничего не найдено', 'Под выбранные условия сессий нет.',
                    [{ id: 'reset', label: 'Сбросить фильтры' }], true)
                : _sessionFilterStatus === 'active'
                  ? uiEmptyState('Активных сессий нет',
                      'Никто сейчас не работает в системе — это нормальное состояние, а не ошибка.', [], true)
                  : uiEmptyState('Сессий нет', 'За выбранное состояние записей не нашлось.', [], true)
            }</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;

  el.querySelector('#sessions-refresh-btn')?.addEventListener('click', () => renderAdminSessions());
  el.querySelector('#sessions-limit')?.addEventListener('change', e => {
    _sessionFilterLimit = Number(e.target.value) || 100;
    renderAdminSessions();
  });
  uiBindStateActions(el, {
    reset: () => {
      _sessionFilterQuery = '';
      _sessionFilterRole = 'all';
      _sessionFilterDevice = 'all';
      renderAdminSessions();
    },
  });
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
  // «Desktop · Chrome · Windows» и второй строкой «Chrome · Windows» —
  // подпись дублировала заголовок. Показываем её только когда она добавляет
  // что-то новое.
  const deviceMain = s.device_label || 'Unknown device';
  const deviceParts = [s.browser_label, s.os_label].filter(Boolean);
  const deviceDetail = deviceParts.join(' · ');
  const deviceSub = deviceDetail && !deviceMain.includes(deviceDetail) ? deviceDetail : '';
  return `
    <tr>
      <td data-label="Пользователь">
        <div class="name-cell">${esc(s.user_name || s.username || '—')} ${s.is_current ? '<span class="me-badge">текущая</span>' : ''}</div>
        <div class="cell-muted">${esc(s.username || '')} · ${esc(roleLabel(s.role))}</div>
      </td>
      <td data-label="Устройство">
        <div class="sessions-device">${esc(deviceMain)}</div>
        ${deviceSub ? `<div class="cell-muted">${esc(deviceSub)}</div>` : ''}
      </td>
      <td data-label="IP"><span class="sessions-ip">${esc(s.ip_address || '—')}</span></td>
      <td data-label="Вход">${sessionSafeDate(s.created_at)}</td>
      <td data-label="Активность">${sessionSafeDate(s.last_seen_at)}</td>
      <td data-label="Состояние">
        <div class="sessions-state">
          ${sessionStatusBadge(s.status)}
          ${sessionActivityBadge(s.activity_state)}
        </div>
      </td>
      <td class="row-actions">
        <button class="btn-danger btn-sm" ${canRevoke ? '' : 'disabled title="Текущую или завершённую сессию нельзя завершить"'} onclick="revokeUserSession('${esc(s.session_id)}')">Завершить сессию</button>
        <button class="btn-ghost btn-sm" onclick="revokeAllUserSessions(${Number(s.user_id) || 0})" ${s.user_id ? '' : 'disabled'}>Завершить остальные</button>
      </td>
    </tr>`;
}

async function revokeUserSession(sessionId) {
  if (!sessionId) return;
  const confirmed = await uiConfirmAction({
    title: 'Завершить сессию?',
    description: 'Пользователь сразу выйдет из аккаунта на этом устройстве.',
    confirmLabel: 'Завершить сессию',
  });
  if (!confirmed) return;
  try {
    await api.revokeSession(sessionId);
    swrInvalidate('sessions:list:');
    showToast('Сессия сброшена', 'ok');
    renderAdminSessions();
  } catch (err) {
    showToast(err.message || 'Не удалось сбросить сессию', 'err');
  }
}

async function revokeAllUserSessions(userId) {
  if (!userId) return;
  const confirmed = await uiConfirmAction({
    title: 'Завершить остальные сессии?',
    description: 'Пользователь выйдет из аккаунта на всех устройствах, кроме текущего сеанса администратора.',
    confirmLabel: 'Завершить сессии',
  });
  if (!confirmed) return;
  try {
    const result = await api.revokeUserSessions(userId, true);
    swrInvalidate('sessions:list:');
    showToast(`Сброшено сессий: ${result.revoked || 0}`, 'ok');
    renderAdminSessions();
  } catch (err) {
    showToast(err.message || 'Не удалось сбросить сессии', 'err');
  }
}

window.revokeUserSession = revokeUserSession;
window.revokeAllUserSessions = revokeAllUserSessions;
