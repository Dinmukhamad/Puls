/* Выделено из 30-admin-coins-groups-operators.view.js (3110 строк).
   Страница «Пользователи»: таблица, бейджи роли и статуса. */

function renderAdminOperators() {
  return renderUsersPage();
}

function roleBadge(role) {
  const labels = { operator:'Оператор', supervisor:'Супервайзер', manager:'Менеджер', admin:'Администратор' };
  return `<span class="role-badge user-role-${esc(role)}">${esc(labels[role] || role || '—')}</span>`;
}

function userStatusBadge(status) {
  const labels = { active:'Активен', inactive:'Неактивен', dismissed:'Уволен', blocked:'Заблокирован' };
  const cls = status === 'active' ? 'status-active' : status === 'blocked' ? 'status-danger' : 'status-inactive';
  return `<span class="status-badge ${cls}">${esc(labels[status] || status || '—')}</span>`;
}

function renderUsersPage() {
  const el = document.getElementById('view-operators');
  if (!el) return;
  const ops = STATE.users;
  const savedFilters = STATE.usersFilters || (STATE.usersFilters = {});
  let searchVal = savedFilters.search || '';
  let filterGroup = savedFilters.group || '';
  let filterRole = savedFilters.role || '';
  let filterStatus = savedFilters.status || '';
  let filterLevel = savedFilters.level || '';
  let activeTab = savedFilters.tab || 'all';
  const queryFilters = uiReadQuery({
    user_search: searchVal,
    user_group: filterGroup,
    user_role: filterRole,
    user_status: filterStatus,
    user_level: filterLevel,
    user_tab: activeTab,
  });
  searchVal = queryFilters.user_search;
  filterGroup = queryFilters.user_group;
  filterRole = queryFilters.user_role;
  filterStatus = queryFilters.user_status;
  filterLevel = queryFilters.user_level;
  activeTab = queryFilters.user_tab;

  const groups = [...new Set(ops.map(o => o.group_name).filter(Boolean))].sort();
  const levels = STATE.operatorLevels.length
    ? STATE.operatorLevels
    : [...new Map(ops.map(o => o.level).filter(Boolean).map(l => [l.code, l])).values()];
  const allowedRoles = STATE.user?.role === 'admin'
    ? ['operator','supervisor','manager','admin']
    : ['operator','supervisor'];

  function isDismissed(o) {
    return o.status === 'dismissed' || o.status === 'inactive' || o.status === 'blocked';
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
      const matchSearch = !searchVal || (o.full_name || '').toLowerCase().includes(searchVal.toLowerCase())
        || (o.login || o.username || '').toLowerCase().includes(searchVal.toLowerCase())
        || (o.email || '').toLowerCase().includes(searchVal.toLowerCase())
        || (o.group_name || '').toLowerCase().includes(searchVal.toLowerCase());
      const matchGroup = !filterGroup || o.group_name === filterGroup;
      const matchLevel = !filterLevel || o.level?.code === filterLevel;
      const matchRole = !filterRole || o.role === filterRole;
      const matchStatus = !filterStatus || o.status === filterStatus;
      const matchTab = activeTab === 'all' ? true : activeTab === 'active' ? o.status === 'active' : isDismissed(o);
      return matchSearch && matchGroup && matchLevel && matchRole && matchStatus && matchTab;
    });
  }

  function operatorActions(o) {
    return `<button class="user-open-button" type="button"
      aria-label="Действия пользователя ${esc(o.full_name)}"
      title="Открыть профиль и действия"
      onclick="event.stopPropagation();showUserManagementModal(${o.id})">⋯</button>`;
  }

  function syncUsersUrl() {
    uiSyncQuery({
      user_search: searchVal,
      user_group: filterGroup,
      user_role: filterRole,
      user_status: filterStatus,
      user_level: filterLevel,
      user_tab: activeTab === 'all' ? '' : activeTab,
    });
  }

  function appliedFiltersHtml() {
    const chips = [
      searchVal && ['search', `Поиск: ${searchVal}`],
      filterRole && ['role', `Роль: ${roleLabel(filterRole)}`],
      filterGroup && ['group', `Группа: ${filterGroup}`],
      filterStatus && ['status', `Статус: ${uiStatusLabel(filterStatus)}`],
      filterLevel && ['level', `Уровень: ${levels.find(item => item.code === filterLevel)?.name || filterLevel}`],
    ].filter(Boolean);
    if (!chips.length) return '';
    return `<div class="ui-filter-chips" aria-label="Применённые фильтры">
      ${chips.map(([key, label]) => `<button type="button" class="ui-filter-chip" data-clear-user-filter="${key}" title="Удалить фильтр">${esc(label)} <span aria-hidden="true">×</span></button>`).join('')}
      <button type="button" class="btn-link" data-clear-user-filter="all">Сбросить всё</button>
    </div>`;
  }

  function renderTable() {
    const list = filteredOps();
    return `
      <div class="table-wrap">
        <table class="data-table users-table-compact">
          <thead><tr>
            <th scope="col" data-sticky="start">Пользователь</th>
            <th scope="col">Роль</th>
            <th scope="col">Группа</th>
            <th scope="col" class="tc">Ставка</th>
            <th scope="col" class="tc">Уровень</th>
            <th scope="col" class="tc">Стаж</th>
            <th scope="col" class="tc">Статус</th>
            <th scope="col" class="tc" data-sticky="end">Действия</th>
          </tr></thead>
          <tbody>
            ${list.length ? list.map(o => {
              const dismissed = isDismissed(o);
              const isOp = o.role === 'operator';
              return `<tr class="${dismissed ? 'operator-dismissed-row' : ''}" data-user-row="${o.id}" tabindex="0" aria-label="Открыть профиль ${esc(o.full_name)}">
                <td class="name-cell" data-label="Пользователь" data-sticky="start">
                  <div class="user-cell-name" title="${esc(o.full_name)}">${esc(o.full_name)}</div>
                  ${o.email ? `<div class="user-cell-sub">${esc(o.email)}</div>` : ''}
                </td>
                <td data-label="Роль">
                  ${roleBadge(o.role)}
                </td>
                <td data-label="Группа"><span class="user-table-value" title="${esc(o.group_name || 'Не назначена')}">${o.group_name ? esc(o.group_name) : 'Не назначена'}</span></td>
                <td class="tc" data-label="Ставка">${isOp ? rateBadgeHtml(o.rate, o.operator_id) : '<span class="cell-muted">Не применяется</span>'}</td>
                <td class="tc" data-label="Уровень">${isOp ? levelBadgeHtml(o.level) : '<span class="cell-muted">Не применяется</span>'}</td>
                <td class="tc" data-label="Стаж">${isOp && o.tenure_days != null ? tenureBadgeHtml(o.tenure_days) : '<span class="cell-muted">Нет данных</span>'}</td>
                <td class="tc" data-label="Статус">${userStatusBadge(o.status)}</td>
                <td class="tc" data-label="Действия" data-sticky="end">${operatorActions(o)}</td>
              </tr>`;
            }).join('') : '<tr><td colspan="8" class="empty-line">Нет пользователей</td></tr>'}
          </tbody>
        </table>
      </div>`;
  }

  function renderTabsAndFilters() {
    const c = {
      all: ops.length,
      active: ops.filter(o => o.status === 'active').length,
      inactive: ops.filter(o => isDismissed(o)).length,
    };
    const tabs = [
      { key: 'all', label: 'Все' },
      { key: 'active', label: 'Активные' },
      { key: 'inactive', label: 'Неактивные' },
    ];
    return tabs.map(t => `
      <button class="ops-tab ${activeTab===t.key?'ops-tab-active':''}" data-tab="${t.key}">
        ${t.label}<span class="ops-tab-badge ${activeTab===t.key?'ops-tab-badge-active':''}">${c[t.key]}</span>
      </button>`).join('');
  }

  el.innerHTML = `
    ${uiPageHeader({
      eyebrow: 'Управление',
      title: 'Пользователи',
      description: `${ops.length} ${pluralize(ops.length, 'учётная запись', 'учётные записи', 'учётных записей')}`,
      actions: `<button class="btn-outline btn-sm ui-icon-button" onclick="reloadData()" aria-label="Обновить пользователей" title="Обновить">↻</button>
        ${['manager','admin'].includes(STATE.user?.role) ? `
          <button class="btn-outline btn-sm" onclick="showWorkNormsModal()">Нормы часов</button>
          <button class="btn-primary btn-sm" onclick="showAddOperatorModal()">+ Новый пользователь</button>
        ` : ''}`,
    })}

    <div class="ops-tab-bar" id="ops-tab-bar">${renderTabsAndFilters()}</div>

    <div class="ops-filters-row ui-filter-bar">
      <label class="sr-only" for="ops-search">Поиск пользователей</label>
      <input id="ops-search" class="form-input" placeholder="ФИО, логин или email…" value="${esc(searchVal)}">
      <details class="ui-more-filters">
        <summary class="btn-outline btn-sm">Ещё фильтры</summary>
        <div class="ui-more-filters__panel">
      <label class="sr-only" for="ops-role">Роль</label>
      <select id="ops-role" class="form-select">
        <option value="">Все роли</option>
        ${allowedRoles.map(r => `<option value="${r}" ${filterRole===r?'selected':''}>${roleLabel(r)}</option>`).join('')}
      </select>
      <label class="sr-only" for="ops-group">Группа</label>
      <select id="ops-group" class="form-select">
        <option value="">Все группы</option>
        ${groups.map(g => `<option value="${esc(g)}" ${filterGroup===g?'selected':''}>${esc(g)}</option>`).join('')}
      </select>
      <label class="sr-only" for="ops-status">Статус</label>
      <select id="ops-status" class="form-select">
        <option value="">Все статусы</option>
        <option value="active" ${filterStatus==='active'?'selected':''}>Активен</option>
        <option value="inactive" ${filterStatus==='inactive'?'selected':''}>Неактивен</option>
        <option value="blocked" ${filterStatus==='blocked'?'selected':''}>Заблокирован</option>
        <option value="dismissed" ${filterStatus==='dismissed'?'selected':''}>Уволен</option>
      </select>
      <label class="sr-only" for="ops-level">Уровень</label>
      <select id="ops-level" class="form-select">
        <option value="">Все уровни</option>
        ${levels.map(l => `<option value="${esc(l.code)}" ${filterLevel===l.code?'selected':''}>${esc(l.name)}</option>`).join('')}
      </select>
        </div>
      </details>
      <span class="ops-count-info" aria-live="polite">Показано: <b>${filteredOps().length}</b> из ${ops.length}</span>
    </div>
    <div id="ops-filter-chips">${appliedFiltersHtml()}</div>

    <div id="ops-table-wrap">${renderTable()}</div>`;

  function rebindOps() {
    el.querySelectorAll('.ops-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        savedFilters.tab = activeTab;
        syncUsersUrl();
        el.querySelector('#ops-tab-bar').innerHTML = renderTabsAndFilters();
        el.querySelector('#ops-table-wrap').innerHTML = renderTable();
        el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
        rebindOps();
      });
    });
    el.querySelector('#ops-search')?.addEventListener('input', e => {
      searchVal = e.target.value;
      savedFilters.search = searchVal;
      syncUsersUrl();
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    el.querySelector('#ops-group')?.addEventListener('change', e => {
      filterGroup = e.target.value;
      savedFilters.group = filterGroup;
      syncUsersUrl();
      el.querySelector('#ops-tab-bar').innerHTML = renderTabsAndFilters();
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      rebindOps();
    });
    el.querySelector('#ops-role')?.addEventListener('change', e => {
      filterRole = e.target.value;
      savedFilters.role = filterRole;
      syncUsersUrl();
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    el.querySelector('#ops-status')?.addEventListener('change', e => {
      filterStatus = e.target.value;
      savedFilters.status = filterStatus;
      syncUsersUrl();
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    el.querySelector('#ops-level')?.addEventListener('change', e => {
      filterLevel = e.target.value;
      savedFilters.level = filterLevel;
      syncUsersUrl();
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    bindOpsActions();
    el.querySelector('#ops-filter-chips').innerHTML = appliedFiltersHtml();
    el.querySelectorAll('[data-clear-user-filter]').forEach(button => {
      button.addEventListener('click', () => {
        const key = button.dataset.clearUserFilter;
        if (key === 'all' || key === 'search') searchVal = '';
        if (key === 'all' || key === 'role') filterRole = '';
        if (key === 'all' || key === 'group') filterGroup = '';
        if (key === 'all' || key === 'status') filterStatus = '';
        if (key === 'all' || key === 'level') filterLevel = '';
        Object.assign(savedFilters, {
          search: searchVal, role: filterRole, group: filterGroup,
          status: filterStatus, level: filterLevel,
        });
        syncUsersUrl();
        renderUsersPage();
      });
    });
  }
  rebindOps();
  function bindOpsActions() {
    el.querySelectorAll('[data-user-row]').forEach(row => {
      const open = () => showUserManagementModal(Number(row.dataset.userRow));
      row.addEventListener('click', event => {
        if (!event.target.closest('button, a, input, select')) open();
      });
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    });
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
