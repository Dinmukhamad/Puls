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
    return `<button class="user-open-button" onclick="showUserManagementModal(${o.id})">Открыть</button>`;
  }

  function renderTable() {
    const list = filteredOps();
    return `
      <div class="table-wrap">
        <table class="data-table users-table-compact">
          <thead><tr>
            <th>Сотрудник</th>
            <th>Роль</th>
            <th>Группа</th>
            <th class="tc">Ставка</th>
            <th class="tc">Уровень</th>
            <th class="tc">Стаж</th>
            <th class="tc">Статус</th>
            <th class="tc">Действия</th>
          </tr></thead>
          <tbody>
            ${list.length ? list.map(o => {
              const dismissed = isDismissed(o);
              const isOp = o.role === 'operator';
              return `<tr class="${dismissed ? 'operator-dismissed-row' : ''}">
                <td class="name-cell">
                  <div class="user-cell-name">${esc(o.full_name)}</div>
                  ${o.email ? `<div class="user-cell-sub">${esc(o.email)}</div>` : ''}
                </td>
                <td>
                  ${roleBadge(o.role)}
                </td>
                <td><span class="user-table-value">${o.group_name ? esc(o.group_name) : '—'}</span></td>
                <td class="tc">${isOp ? rateBadgeHtml(o.rate, o.operator_id) : '<span class="cell-muted">—</span>'}</td>
                <td class="tc">${isOp ? levelBadgeHtml(o.level) : '<span class="cell-muted">—</span>'}</td>
                <td class="tc">${isOp && o.tenure_days != null ? tenureBadgeHtml(o.tenure_days) : '<span class="cell-muted">—</span>'}</td>
                <td class="tc">${userStatusBadge(o.status)}</td>
                <td class="tc">${operatorActions(o)}</td>
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
    <div class="view-header">
      <div><div class="section-kicker">Пользователи</div><h2 class="section-title">Пользователи</h2></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="reloadData()">Обновить</button>
        ${['manager','admin'].includes(STATE.user?.role) ? `
          <button class="btn-outline btn-sm" onclick="showWorkNormsModal()">Нормы часов</button>
          <button class="btn-primary btn-sm" onclick="showAddOperatorModal()">+ Новый пользователь</button>
        ` : ''}
      </div>
    </div>

    <div class="ops-tab-bar" id="ops-tab-bar">${renderTabsAndFilters()}</div>

    <div class="ops-filters-row">
      <input id="ops-search" class="form-input" placeholder="ФИО, логин или email…" style="width:260px" value="${esc(searchVal)}">
      <select id="ops-role" class="form-select" style="width:170px">
        <option value="">Все роли</option>
        ${allowedRoles.map(r => `<option value="${r}" ${filterRole===r?'selected':''}>${roleLabel(r)}</option>`).join('')}
      </select>
      <select id="ops-group" class="form-select" style="width:180px">
        <option value="">Все группы</option>
        ${groups.map(g => `<option value="${esc(g)}" ${filterGroup===g?'selected':''}>${esc(g)}</option>`).join('')}
      </select>
      <select id="ops-status" class="form-select" style="width:170px">
        <option value="">Все статусы</option>
        <option value="active" ${filterStatus==='active'?'selected':''}>Активен</option>
        <option value="inactive" ${filterStatus==='inactive'?'selected':''}>Неактивен</option>
        <option value="blocked" ${filterStatus==='blocked'?'selected':''}>Заблокирован</option>
        <option value="dismissed" ${filterStatus==='dismissed'?'selected':''}>Уволен</option>
      </select>
      <select id="ops-level" class="form-select" style="width:170px">
        <option value="">Все уровни</option>
        ${levels.map(l => `<option value="${esc(l.code)}" ${filterLevel===l.code?'selected':''}>${esc(l.name)}</option>`).join('')}
      </select>
      <span class="ops-count-info">Показано: <b>${filteredOps().length}</b> из ${ops.length}</span>
    </div>

    <div id="ops-table-wrap">${renderTable()}</div>`;

  function rebindOps() {
    el.querySelectorAll('.ops-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        savedFilters.tab = activeTab;
        el.querySelector('#ops-tab-bar').innerHTML = renderTabsAndFilters();
        el.querySelector('#ops-table-wrap').innerHTML = renderTable();
        el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
        rebindOps();
      });
    });
    el.querySelector('#ops-search')?.addEventListener('input', e => {
      searchVal = e.target.value;
      savedFilters.search = searchVal;
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    el.querySelector('#ops-group')?.addEventListener('change', e => {
      filterGroup = e.target.value;
      savedFilters.group = filterGroup;
      el.querySelector('#ops-tab-bar').innerHTML = renderTabsAndFilters();
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      rebindOps();
    });
    el.querySelector('#ops-role')?.addEventListener('change', e => {
      filterRole = e.target.value;
      savedFilters.role = filterRole;
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    el.querySelector('#ops-status')?.addEventListener('change', e => {
      filterStatus = e.target.value;
      savedFilters.status = filterStatus;
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
    });
    el.querySelector('#ops-level')?.addEventListener('change', e => {
      filterLevel = e.target.value;
      savedFilters.level = filterLevel;
      el.querySelector('#ops-table-wrap').innerHTML = renderTable();
      el.querySelector('.ops-count-info').innerHTML = `Показано: <b>${filteredOps().length}</b> из ${ops.length}`;
      bindOpsActions();
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
function renderCoins() {
  const el = document.getElementById('view-coins');
  if (!el) return;

  if (!isAdmin(STATE.user?.role)) {
    el.innerHTML = '<div class="empty-state"><p>Недостаточно прав</p></div>';
    return;
  }

  const tab = normalizeCoinTab(STATE.coinsTab);
  STATE.coinsTab = tab;
  const tabs = [
    ['overview', 'Обзор'],
    ['accrual', 'Начисление'],
    ['requests', 'Заявки'],
    ['history', 'История'],
    ['weekly', 'Еженедельный расчёт'],
    ['settings', 'Настройки начислений'],
    ['rules', 'Правила'],
  ];

  el.innerHTML = `
    <div class="view-header coins-header">
      <div>
        <div class="section-kicker">Коины</div>
        <h2 class="section-title">Операции с коинами</h2>
        <p class="section-subtitle">Управление начислениями, заявками и историей операций</p>
      </div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="refreshCoinsModule()">Обновить</button>
      </div>
    </div>
    <div class="filter-tabs coins-tabs">
      ${tabs.map(([id, label]) => `<button class="filter-tab ${tab === id ? 'active' : ''}" data-coins-tab="${id}">${label}</button>`).join('')}
    </div>
    <div id="coins-tab-body" class="coins-tab-body"></div>`;

  el.querySelectorAll('[data-coins-tab]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo('coins', { tab: btn.dataset.coinsTab }));
  });

  const body = el.querySelector('#coins-tab-body');
  if (tab === 'overview') renderCoinsOverview(body);
  if (tab === 'accrual') {
    body.innerHTML = '<section class="coins-embedded-view" id="view-manual"></section>';
    renderManual();
  }
  if (tab === 'requests') {
    body.innerHTML = '<section class="coins-embedded-view" id="view-requests"></section>';
    renderRequests();
  }
  if (tab === 'history') {
    body.innerHTML = '<section class="coins-embedded-view" id="view-history"></section>';
    renderHistory();
  }
  if (tab === 'rules') renderCoinRules(body);
  if (tab === 'weekly') renderWeeklyAccrualTab(body);
  if (tab === 'settings') renderCoinRulesSettingsTab(body);
}

async function refreshCoinsModule() {
  swrInvalidate('coins:');
  swrInvalidate('groups:');
  swrInvalidate('shop:items');
  STATE.coinsOverview = null;
  await reloadData();
  if (STATE.currentView === 'coins') renderCoins();
}

function renderCoinsOverview(body) {
  const overview = STATE.coinsOverview;
  if (!overview) {
    body.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка данных…</p></div>';
    const myNavGen = STATE.navGen;
    swrFetch('coins:overview', () => api.getCoinsOverview(), data => {
      STATE.coinsOverview = data;
      if (!isNavStale(myNavGen) && STATE.currentView === 'coins' && STATE.coinsTab === 'overview') renderCoins();
    }, SWR_FAST_TTL_MS).then(data => {
      STATE.coinsOverview = data;
      if (!isNavStale(myNavGen) && STATE.currentView === 'coins' && STATE.coinsTab === 'overview') renderCoins();
    }).catch(err => {
      if (!isNavStale(myNavGen)) {
        body.innerHTML = `<div class="status-line status-error">Не удалось загрузить обзор: ${esc(err.message)}</div>`;
      }
    });
    return;
  }

  const tx = overview.latest_transactions || [];
  const req = overview.latest_requests || [];
  body.innerHTML = `
    <div class="kpi-grid coins-kpi-grid">
      <div class="kpi-card kpi-accent"><div class="kpi-label">Операций сегодня</div><div class="kpi-value">${overview.today_operations || 0}</div></div>
      <div class="kpi-card kpi-ok"><div class="kpi-label">Начислено сегодня</div><div class="kpi-value">+${overview.today_credited || 0}<span class="kpi-unit"> ₡</span></div></div>
      <div class="kpi-card"><div class="kpi-label">Списано сегодня</div><div class="kpi-value">-${overview.today_debited || 0}<span class="kpi-unit"> ₡</span></div></div>
      <div class="kpi-card ${overview.new_requests ? 'kpi-warn' : ''}"><div class="kpi-label">Новых заявок</div><div class="kpi-value">${overview.new_requests || 0}</div></div>
      <div class="kpi-card"><div class="kpi-label">Зарезервировано</div><div class="kpi-value">${overview.reserved_coins || 0}<span class="kpi-unit"> ₡</span></div></div>
      <div class="kpi-card"><div class="kpi-label">Всего операций</div><div class="kpi-value">${overview.total_operations || 0}</div></div>
    </div>
    <div class="coins-overview-grid">
      <div class="panel">
        <div class="panel-head"><h3>Последние операции</h3><button class="btn-link" onclick="navigateTo('coins',{tab:'history'})">Открыть историю</button></div>
        <div class="coins-list">
          ${tx.length ? tx.map(t => `
            <div class="manual-tx-row">
              <div class="manual-tx-sign ${t.amount >= 0 ? 'plus' : 'minus'}">${t.amount >= 0 ? '+' : ''}${t.amount}</div>
              <div class="manual-tx-body">
                <div class="manual-tx-name">${esc(t.operator_name)}</div>
                <div class="manual-tx-meta">${esc(transactionTypeLabel(t.type))} · ${esc(t.comment)} · ${fmtDate(t.created_at)}</div>
              </div>
            </div>`).join('') : '<div class="empty-line">Операций пока нет</div>'}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Последние заявки</h3><button class="btn-link" onclick="navigateTo('coins',{tab:'requests'})">Открыть заявки</button></div>
        <div class="coins-list">
          ${req.length ? req.map(p => `
            <div class="manual-tx-row">
              <div class="manual-tx-sign">${p.price}</div>
              <div class="manual-tx-body">
                <div class="manual-tx-name">${esc(p.operator_name)} — ${esc(p.bonus_name)}</div>
                <div class="manual-tx-meta">${esc(p.group_name || '—')} · ${statusLabel(p.status)} · ${fmtDate(p.created_at)}</div>
              </div>
            </div>`).join('') : '<div class="empty-line">Заявок нет</div>'}
        </div>
      </div>
    </div>
    <div class="panel coins-actions">
      <div class="panel-head"><h3>Быстрые действия</h3></div>
      <div class="coins-action-row">
        <button class="btn-primary" onclick="navigateTo('coins',{tab:'accrual'})">Начислить коины</button>
        <button class="btn-outline" onclick="navigateTo('coins',{tab:'requests'})">Открыть заявки</button>
        <button class="btn-outline" onclick="navigateTo('coins',{tab:'history'})">Открыть историю</button>
      </div>
    </div>`;
}

function renderCoinRules(body) {
  body.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Правила операций с коинами</h3></div>
      <div class="manual-rules coins-rules">
        <div class="manual-rule"><span class="rule-coin">1</span><span>Любое изменение баланса создается через транзакцию и попадает в историю.</span></div>
        <div class="manual-rule"><span class="rule-coin">2</span><span>Покупка в магазине сначала резервирует коины, затем заявка одобряется или отклоняется.</span></div>
        <div class="manual-rule"><span class="rule-coin">3</span><span>Отклонение заявки возвращает резерв на баланс оператора.</span></div>
        <div class="manual-rule"><span class="rule-coin">4</span><span>Ручные операции не редактируются: для корректировки создается обратная операция.</span></div>
      </div>
    </div>`;
}

function transactionTypeLabel(type) {
  return {
    weekly_accrual: 'Авт. начисление',
    manual_add: 'Ручное начисление',
    manual_subtract: 'Ручное списание',
    manual_accrual: 'Ручное начисление',
    manual_deduction: 'Ручное списание',
    reserve: 'Резервирование',
    reservation: 'Резервирование',
    purchase: 'Покупка бонуса',
    refund: 'Возврат коинов',
    request_completed: 'Заявка выполнена',
    period_report: 'Расчет периода',
    period_report_adjustment: 'Корректировка расчёта периода',
    bonus_top: 'Бонус: место в рейтинге',
    bonus_no_late: 'Бонус: без опозданий',
    bonus_no_violation: 'Бонус: без нарушений',
    bonus_nomination: 'Бонус: номинация недели',
    bonus_driver_thanks: 'Бонус: благодарность водителя',
    achievement_reward: 'Награда за достижение',
    test_reward: 'Награда за тест',
    level_up: 'Повышение уровня',
    wheel_of_wow: 'Колесо WOW',
  }[type] || type;
}

function renderManual() {
  const el = document.getElementById('view-manual');
  if (!el) return;

  // Load operators if empty
  if (!STATE.adminOperators.length) {
    el.innerHTML = `<div class="view-header"><div><div class="section-kicker">Начисление</div><h2 class="section-title">Ручное начисление коинов</h2></div></div><div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>`;
    api.getDashboardOperators()
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
      .filter(t => ['manual_add','manual_subtract','manual_accrual','manual_deduction'].includes(t.type))
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
      invalidateCoinsData();
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
          .filter(t => ['manual_add','manual_subtract','manual_accrual','manual_deduction'].includes(t.type))
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

    <div class="panel" style="margin:12px 0">
      <div class="panel-head">
        <h3>Фильтры</h3>
        <div class="header-right">
          <button class="btn-outline btn-sm" onclick="exportShopRequests('csv')">Экспорт CSV</button>
          <button class="btn-outline btn-sm" onclick="exportShopRequests('xlsx')">Экспорт XLSX</button>
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

    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head">
        <h3>Фильтры</h3>
        <div class="header-right">
          <button class="btn-outline btn-sm" onclick="exportHistoryServerSide()">Экспорт CSV</button>
          <button class="btn-outline btn-sm" onclick="exportHistoryServerSide('xlsx')">Экспорт XLSX</button>
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

/* ══════════════════════════════════════
   VIEW: ГРУППЫ
══════════════════════════════════════ */
async function renderGroups() {
  const el = document.getElementById('view-groups');
  if (!el) return;
  const myNavGen = STATE.navGen;

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
    STATE.groups = await swrFetch('groups:list', () => api.listGroups(false), null, SWR_STATIC_TTL_MS);
  } catch(e) {
    if (isNavStale(myNavGen)) return;
    el.innerHTML = `
      <div class="view-header">
        <div><div class="section-kicker">Группы</div><h2 class="section-title">Управление группами</h2></div>
        <button class="btn-outline btn-sm" onclick="renderGroups()">Повторить</button>
      </div>
      <div class="status-line status-error" style="padding:20px">Не удалось загрузить список групп</div>`;
    return;
  }
  if (isNavStale(myNavGen)) return; // ушли с "Групп" пока ждали ответ сервера

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
    swrInvalidate('groups:');
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
    swrInvalidate('groups:');
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
    swrInvalidate('groups:');
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
    swrInvalidate('groups:');
    closeModal();
    showToast('Группа удалена', 'ok');
    await renderGroups();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function ensureGroupsLoaded() {
  if (!STATE.groups.length) {
    STATE.groups = await swrFetch('groups:list', () => api.listGroups(false), null, SWR_STATIC_TTL_MS);
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

function confirmDeleteOperator(operatorId) {
  // operatorId — это operators.id
  const op = STATE.users.find(u => u.operator_id === operatorId);
  const name = op ? op.full_name : `Оператор #${operatorId}`;
  showModal(`
    <div class="acc-modal">
      <h3 class="acc-title" style="color:var(--danger)">⚠ Удалить оператора?</h3>
      <p style="color:var(--tx2);line-height:1.6;margin:12px 0">
        Вы удаляете <b>${esc(name)}</b>.
      </p>
      <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:12px 14px;margin-bottom:16px">
        <div style="font-weight:600;color:var(--danger);margin-bottom:6px">Будет удалено навсегда:</div>
        <ul style="margin:0;padding-left:18px;color:var(--tx2);line-height:1.8;font-size:13px">
          <li>Профиль оператора</li>
          <li>Вся история расчётов и баллов</li>
          <li>Ежедневные метрики</li>
          <li>Транзакции коинов</li>
          <li>Уровни и история уровней</li>
          <li>Покупки в магазине</li>
          <li>Учётная запись (логин/пароль)</li>
        </ul>
      </div>
      <p style="color:var(--tx3);font-size:12px;margin-bottom:16px">
        Это действие невозможно отменить. Доступно только администратору.
      </p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn-outline" onclick="closeModal()">Отмена</button>
        <button class="btn-danger" onclick="deleteOperator(${operatorId})">Удалить навсегда</button>
      </div>
    </div>`);
}

async function deleteOperator(operatorId) {
  try {
    const btn = document.querySelector('.btn-danger[onclick*="deleteOperator"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Удаление…'; }
    await api.deleteOperator(operatorId);
    closeModal();
    showToast('Оператор удалён', 'ok');
    swrInvalidate('users:list');
    swrInvalidate('dashboard:operators');
    await reloadData();
  } catch(e) {
    showToast(e.message || 'Ошибка удаления', 'error');
    const btn = document.querySelector('.btn-danger[onclick*="deleteOperator"]');
    if (btn) { btn.disabled = false; btn.textContent = 'Удалить навсегда'; }
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
  const extraClass = options.className ? String(options.className).replace(/[^a-zA-Z0-9_\- ]/g, '') : '';
  overlay.innerHTML = `<div class="modal ${forced ? 'modal-forced' : ''} ${extraClass}">${html}${forced ? '' : '<button class="modal-close" onclick="closeModal()">✕</button>'}</div>`;
  overlay.style.display = 'flex';
  overlay.onclick = e => { if (e.target === overlay && !forced) closeModal(); };
}
function closeModal(force = false) {
  const o = document.getElementById('modal-overlay');
  if (o?.dataset.force === 'true' && !force) return;
  if (o) o.style.display = 'none';
}


/* ══════════════════════════════════════
   СТАВКИ И НОРМЫ ЧАСОВ
══════════════════════════════════════ */

function tenureBadgeHtml(days) {
  if (days == null || isNaN(days)) return '<span class="cell-muted">—</span>';
  const months = Math.floor(Math.max(0, days) / 30);
  const d = days % 30;
  let label, cls;
  if (months >= 61)      { label = months + 'м'; cls = 'tenure-pro'; }
  else if (months >= 41) { label = months + 'м'; cls = 'tenure-op'; }
  else if (months >= 16) { label = months + 'м'; cls = 'tenure-mid'; }
  else                   { label = months > 0 ? months + 'м' : d + 'д'; cls = 'tenure-new'; }
  return `<span class="tenure-badge ${cls}">${label}</span>`;
}

function rateBadgeHtml(rate, operatorId) {
  if (rate == null) {
    const btn = operatorId ? ` <button class="btn-link" style="font-size:11px;color:var(--warning)" onclick="showSetRateModal(${operatorId})">Задать</button>` : '';
    return `<span class="rate-badge rate-none">—${btn}</span>`;
  }
  const r = parseFloat(rate); // защита от строк и Decimal
  const cls = r === 0.5 ? 'rate-half' : r === 0.75 ? 'rate-three-q' : 'rate-full';
  const btn = operatorId ? ` <button class="btn-link" style="font-size:11px" onclick="showSetRateModal(${operatorId})">✎</button>` : '';
  return `<span class="rate-badge ${cls}">${r}${btn}</span>`;
}

async function showSetRateModal(operatorId) {
  const op = STATE.users.find(u => u.operator_id === operatorId) || STATE.adminOperators.find(o => o.id === operatorId);
  const name = op?.full_name || `Оператор #${operatorId}`;
  const current = op?.rate != null ? parseFloat(op.rate) : null;

  showModal(`
    <div class="acc-modal">
      <h3 class="acc-title">Ставка оператора</h3>
      <div class="status-line" style="padding:0;color:var(--tx2)"><b>${esc(name)}</b></div>
      <div class="acc-divider"></div>
      <div class="acc-section">
        <div class="form-group">
          <label class="form-label">Ставка</label>
          <select id="rate-select" class="form-select">
            <option value="">— не указана —</option>
            <option value="0.5" ${current === 0.5 ? 'selected' : ''}>0.5 ставки</option>
            <option value="0.75" ${current === 0.75 ? 'selected' : ''}>0.75 ставки</option>
            <option value="1.0" ${current === 1.0 ? 'selected' : ''}>1.0 ставка</option>
          </select>
        </div>
        <div id="rate-err" class="acc-field-err"></div>
        <button class="acc-btn" onclick="submitSetRate(${operatorId})">Сохранить</button>
      </div>
    </div>
  `);
}

async function submitSetRate(operatorId) {
  const val = document.getElementById('rate-select')?.value;
  const rate = val === '' ? null : parseFloat(val);
  const errEl = document.getElementById('rate-err');
  try {
    await api._req('PATCH', `/api/work-norms/operators/${operatorId}/rate`, { rate });
    showToast('Ставка сохранена', 'ok');
    closeModal();
    swrInvalidate('users:list');
    await reloadData();
  } catch(e) {
    if (errEl) errEl.textContent = e.message;
  }
}

/* ── Управление нормами часов ──────────────────────── */

async function showWorkNormsModal() {
  showModal('<div class="acc-modal"><h3 class="acc-title">Нормы часов</h3><div class="loading-spinner" style="margin:24px auto"></div></div>', { wide: true });
  try {
    const norms = await api._req('GET', '/api/work-norms');
    renderWorkNormsModal(norms);
  } catch(e) {
    showToast(e.message, 'error');
    closeModal();
  }
}

function renderWorkNormsModal(norms) {
  const canEdit = ['manager','admin'].includes(STATE.user?.role);

  // Группируем по год/месяц
  const byMonth = {};
  for (const n of norms) {
    const key = `${n.year}-${String(n.month).padStart(2,'0')}`;
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(n);
  }

  const MONTH_RU = ['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  const groupsHtml = Object.entries(byMonth).sort((a,b) => b[0].localeCompare(a[0])).map(([key, rows]) => {
    const [y, m] = key.split('-');
    const rowsHtml = rows.sort((a,b) => a.rate - b.rate).map(n => `
      <tr class="${n.is_active ? '' : 'operator-dismissed-row'}">
        <td><span class="rate-badge ${n.rate===0.5?'rate-half':n.rate===0.75?'rate-three-q':'rate-full'}">${n.rate}</span></td>
        <td><b>${n.monthly_norm_hours}</b> ч</td>
        <td>${n.month_days} дн.</td>
        <td>${n.is_active ? '<span class="status-badge status-active">Активна</span>' : '<span class="status-badge status-inactive">Отключена</span>'}</td>
        <td>
          ${canEdit && n.is_active ? `
            <button class="btn-icon btn-ghost" onclick="showEditNormModal(${n.id}, ${n.monthly_norm_hours})" title="Изменить">✎</button>
            <button class="btn-icon btn-ghost danger" onclick="deleteNorm(${n.id})" title="Отключить">✕</button>
          ` : ''}
        </td>
      </tr>`).join('');
    return `
      <div class="panel" style="margin-bottom:12px">
        <div class="panel-head"><h4>${MONTH_RU[parseInt(m)]} ${y}</h4></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Ставка</th><th>Норма</th><th>Дней</th><th>Статус</th><th></th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="5" class="empty-line">Нет норм</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }).join('') || '<div class="empty-line">Нормы не добавлены</div>';

  const addForm = canEdit ? `
    <div class="panel" style="margin-top:16px">
      <div class="panel-head"><h4>Добавить норму</h4></div>
      <div class="ops-filters-row" style="flex-wrap:wrap;gap:10px;padding:12px 0 0">
        <div class="form-group" style="margin:0">
          <label class="form-label">Год</label>
          <input id="norm-year" class="form-input" type="number" value="${new Date().getFullYear()}" style="width:100px">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Месяц</label>
          <select id="norm-month" class="form-select" style="width:130px">
            ${Array.from({length:12},(_,i)=>`<option value="${i+1}">${MONTH_RU[i+1]}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Ставка</label>
          <select id="norm-rate" class="form-select" style="width:130px">
            <option value="0.5">0.5</option>
            <option value="0.75">0.75</option>
            <option value="1.0">1.0</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Норма (часов)</label>
          <input id="norm-hours" class="form-input" type="number" step="0.5" placeholder="напр. 88" style="width:130px">
        </div>
        <div class="form-group" style="margin:0;align-self:flex-end">
          <button class="btn-primary btn-sm" onclick="submitAddNorm()" style="height:36px">Добавить</button>
        </div>
      </div>
      <div id="norm-add-err" class="acc-field-err" style="padding:4px 0 0"></div>
    </div>` : '';

  updateModal(`
    <div class="acc-modal" style="max-width:680px">
      <h3 class="acc-title">Нормы часов</h3>
      <p style="color:var(--tx2);font-size:13px;margin:0 0 16px">Нормы используются для расчёта % выполнения нормы вместо сырых часов.</p>
      <div style="max-height:420px;overflow-y:auto">${groupsHtml}</div>
      ${addForm}
    </div>
  `);
}

async function submitAddNorm() {
  const year = parseInt(document.getElementById('norm-year')?.value);
  const month = parseInt(document.getElementById('norm-month')?.value);
  const rate = parseFloat(document.getElementById('norm-rate')?.value);
  const hours = parseFloat(document.getElementById('norm-hours')?.value);
  const errEl = document.getElementById('norm-add-err');
  if (!hours || hours <= 0) { errEl.textContent = 'Укажите норму часов'; return; }
  try {
    await api._req('POST', '/api/work-norms', { year, month, rate, monthly_norm_hours: hours });
    showToast('Норма добавлена', 'ok');
    const norms = await api._req('GET', '/api/work-norms');
    renderWorkNormsModal(norms);
  } catch(e) { errEl.textContent = e.message; }
}

async function showEditNormModal(normId, currentHours) {
  const val = prompt('Новая норма часов:', currentHours);
  if (!val) return;
  const hours = parseFloat(val);
  if (!hours || hours <= 0) { showToast('Некорректное значение', 'error'); return; }
  try {
    await api._req('PATCH', `/api/work-norms/${normId}`, { monthly_norm_hours: hours });
    showToast('Норма обновлена', 'ok');
    const norms = await api._req('GET', '/api/work-norms');
    renderWorkNormsModal(norms);
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteNorm(normId) {
  if (!confirm('Отключить норму?')) return;
  try {
    await api._req('DELETE', `/api/work-norms/${normId}`);
    showToast('Норма отключена', 'ok');
    const norms = await api._req('GET', '/api/work-norms');
    renderWorkNormsModal(norms);
  } catch(e) { showToast(e.message, 'error'); }
}

function updateModal(html) {
  // Обновляем содержимое открытого модального окна
  const overlay = document.getElementById('modal-overlay');
  const modal = overlay?.querySelector('.modal');
  if (modal) {
    modal.innerHTML = html + '<button class="modal-close" onclick="closeModal()">✕</button>';
  } else {
    showModal(html);
  }
}

async function showAddOperatorModal() {
  let groups = [];
  let groupsError = '';
  try {
    groups = await swrFetch('groups:active', () => api.listGroups(true), null, SWR_STATIC_TTL_MS);
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
  const canCreateRoles = STATE.user?.role === 'admin'
    ? ['operator','supervisor','manager','admin']
    : ['operator','supervisor'];
  const roleHint = {
    operator: 'Оператор — обычный пользователь системы',
    supervisor: 'Супервайзер — управление операторами своей группы',
    manager: 'Менеджер — управление операторами и супервайзерами',
    admin: 'Администратор — полный доступ',
  };

  showModal(`
    <h3 class="modal-title">Новый пользователь</h3>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">ФИО <span style="color:var(--danger)">*</span></label>
        <input id="new-op-name" class="form-input" placeholder="Иванов Иван Иванович">
      </div>
      <div class="form-group">
        <label class="form-label">Логин <span style="color:var(--danger)">*</span></label>
        <input id="new-user-login" class="form-input" placeholder="ivanov_a">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Email</label>
        <input id="new-op-email" class="form-input" type="email" placeholder="ivanov@company.com">
      </div>
      <div class="form-group">
        <label class="form-label">Телефон</label>
        <input id="new-user-phone" class="form-input" placeholder="+7...">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Роль <span style="color:var(--danger)">*</span></label>
        <select id="new-user-role" class="form-select">
          ${canCreateRoles.map(r => `<option value="${r}">${roleLabel(r)}</option>`).join('')}
        </select>
        <div id="new-role-hint" class="form-hint">${esc(roleHint[canCreateRoles[0]])}</div>
      </div>
      <div class="form-group" id="new-user-group-field">
        <label class="form-label">Группа <span id="new-group-required" style="color:var(--danger)">*</span></label>
        ${groupField}
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Пароль <span style="color:var(--danger)">*</span></label>
        <input id="new-user-password" class="form-input" type="password" placeholder="TempPassword123">
      </div>
      <div class="form-group">
        <label class="form-label">Повтор пароля <span style="color:var(--danger)">*</span></label>
        <input id="new-user-password-confirm" class="form-input" type="password" placeholder="TempPassword123">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group" id="new-user-rate-field" style="display:none">
        <label class="form-label">Ставка <span style="color:var(--danger)">*</span></label>
        <select id="new-user-rate" class="form-select">
          <option value="">— не указана —</option>
          <option value="0.5">0.5 ставки</option>
          <option value="0.75">0.75 ставки</option>
          <option value="1.0">1.0 ставка</option>
        </select>
        <div class="form-hint">Используется для расчёта выполнения нормы часов</div>
      </div>
      <div class="form-group">
        <label class="form-label">Статус</label>
        <select id="new-user-status" class="form-select">
          <option value="active" selected>Активен</option>
          <option value="inactive">Неактивен</option>
          <option value="blocked">Заблокирован</option>
        </select>
      </div>
    </div>
    <div id="new-op-err" class="status-line"></div>
    <button id="create-operator-btn" class="btn-primary create-user-submit" onclick="submitAddOperator()" disabled>Создать пользователя</button>
    <div style="font-size:11px;color:var(--tx3);margin-top:6px">Пароль сохранится только в виде hash, при первом входе пользователь сменит его.</div>
  `, { className: 'modal-user-create' });

  const updateButton = () => {
    const btn = document.getElementById('create-operator-btn');
    const name = document.getElementById('new-op-name')?.value?.trim();
    const login = document.getElementById('new-user-login')?.value?.trim();
    const groupId = document.getElementById('new-op-group-id')?.value;
    const role = document.getElementById('new-user-role')?.value || 'operator';
    const pwd = document.getElementById('new-user-password')?.value || '';
    const confirm = document.getElementById('new-user-password-confirm')?.value || '';
    const needsGroup = role === 'operator' || role === 'supervisor';
    const isOperator = role === 'operator';
    const field = document.getElementById('new-user-group-field');
    const required = document.getElementById('new-group-required');
    const rateField = document.getElementById('new-user-rate-field');
    if (field) field.style.display = needsGroup ? '' : 'none';
    if (required) required.style.display = needsGroup ? '' : 'none';
    if (rateField) rateField.style.display = isOperator ? '' : 'none';
    setText('new-role-hint', roleHint[role] || '');
    if (btn) btn.disabled = !(name && name.length >= 2 && login && pwd.length >= 8 && pwd === confirm && (!needsGroup || groupId));
  };
  ['new-op-name', 'new-user-login', 'new-op-group-id', 'new-user-role', 'new-user-password', 'new-user-password-confirm'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateButton);
    document.getElementById(id)?.addEventListener('change', updateButton);
  });
  updateButton();
}

async function submitAddOperator() {
  const name     = document.getElementById('new-op-name')?.value?.trim();
  const login    = document.getElementById('new-user-login')?.value?.trim();
  const groupId  = document.getElementById('new-op-group-id')?.value;
  const role     = document.getElementById('new-user-role')?.value || 'operator';
  const status   = document.getElementById('new-user-status')?.value || 'active';
  const email    = document.getElementById('new-op-email')?.value?.trim() || null;
  const phone    = document.getElementById('new-user-phone')?.value?.trim() || null;
  const password = document.getElementById('new-user-password')?.value || '';
  const confirm  = document.getElementById('new-user-password-confirm')?.value || '';
  const rateVal  = document.getElementById('new-user-rate')?.value || '';
  const rate     = rateVal ? parseFloat(rateVal) : null;
  const err      = document.getElementById('new-op-err');
  const btn      = document.getElementById('create-operator-btn');

  const setErr = msg => { err.textContent = msg; err.className = 'status-line status-error'; };

  if (!name || name.length < 2) return setErr('Укажите ФИО пользователя');
  if (!login) return setErr('Укажите логин');
  if ((role === 'operator' || role === 'supervisor') && !groupId) return setErr('Выберите группу');
  if (password.length < 8) return setErr('Пароль должен быть минимум 8 символов');
  if (!/[A-Za-zА-Яа-я]/.test(password) || !/\d/.test(password)) return setErr('Пароль должен содержать буквы и цифры');
  if (password !== confirm) return setErr('Пароли не совпадают');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setErr('Введите корректный email');

  err.textContent = 'Создаём…'; err.className = 'status-line';
  if (btn) btn.disabled = true;

  try {
    const result = await api.createUser({
      full_name: name,
      login,
      email: email || null,
      phone: phone || null,
      role,
      group_id: groupId ? +groupId : null,
      password,
      confirm_password: confirm,
      status,
    });

    // Сохраняем ставку если указана и это оператор
    if (role === 'operator' && rate && result.operator_id) {
      try {
        await api._req('PATCH', `/api/work-norms/operators/${result.operator_id}/rate`, { rate });
      } catch(e) {
        console.warn('Не удалось сохранить ставку:', e.message);
      }
    }

    const credentialText = `Пользователь: ${result.full_name}\nРоль: ${roleLabel(result.role)}\nЛогин: ${result.login || result.username}\nВременный пароль: ${password}`;

    showModal(
      '<h3 class="modal-title" style="color:var(--ok)">Пользователь создан</h3>' +
      '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-md);padding:16px;display:grid;gap:8px;font-size:14px">' +
        '<div><span style="color:var(--tx3)">ФИО:</span> <b>' + esc(result.full_name) + '</b></div>' +
        '<div><span style="color:var(--tx3)">Роль:</span> <b>' + esc(roleLabel(result.role)) + '</b></div>' +
        '<div><span style="color:var(--tx3)">Группа:</span> <b>' + esc(result.group_name || '—') + '</b></div>' +
        '<div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px">' +
          '<span style="color:var(--tx3)">Логин:</span> <b style="font-family:monospace;color:var(--accent)">' + esc(result.login || result.username) + '</b>' +
        '</div>' +
        '<div><span style="color:var(--tx3)">Временный пароль:</span> <b style="font-family:monospace;color:var(--accent)">' + esc(password) + '</b></div>' +
      '</div>' +
      '<button id="copy-created-credentials" class="btn-outline" style="width:100%">Скопировать данные для входа</button>' +
      '<button class="btn-primary" style="width:100%" onclick="closeModal()">Готово</button>'
    );
    document.getElementById('copy-created-credentials')?.addEventListener('click', () => {
      navigator.clipboard.writeText(credentialText).then(() => showToast('Скопировано!', 'ok'));
    });
    swrInvalidate('users:list');
    await reloadData();
  } catch(e) {
    setErr(e.message);
    if (btn) btn.disabled = false;
  }
}

async function deactivateUserUi(userId) {
  const user = STATE.users.find(u => u.id === userId);
  if (!confirm(`Деактивировать пользователя ${user?.full_name || ''}?`)) return;
  try {
    await api.deactivateUser(userId);
    showToast('Пользователь деактивирован', 'ok');
    swrInvalidate('users:list');
    await reloadData();
  } catch(e) { showToast(e.message, 'error'); }
}

function userManagementInitials(fullName) {
  return String(fullName || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase();
}

function setUserManagementTab(tab) {
  document.querySelectorAll('.user-manage-tab').forEach(button => {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  });
  document.querySelectorAll('.user-manage-panel').forEach(panel => {
    panel.hidden = panel.dataset.panel !== tab;
  });
}

async function showUserManagementModal(userId) {
  const user = STATE.users.find(item => item.id === userId);
  if (!user) return showToast('Пользователь не найден', 'error');

  showModal('<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка карточки пользователя…</p></div>', {
    className: 'modal-user-manage',
  });

  let groups = STATE.groups || [];
  try {
    if (!groups.length) groups = await ensureGroupsLoaded();
  } catch(e) {
    groups = [];
  }

  const isOperator = user.role === 'operator' && user.operator_id;
  const groupOptions = groups.map(group => `
    <option value="${group.id}" ${Number(user.group_id) === Number(group.id) ? 'selected' : ''}>
      ${esc(group.name)}${group.status !== 'active' ? ' (отключена)' : ''}
    </option>`).join('');
  const levelName = user.level?.name || 'Не назначен';
  const startDate = user.start_date || '';
  const statusOptions = [
    ['active', 'Активен'],
    ['inactive', 'Неактивен'],
    ['blocked', 'Заблокирован'],
    ['dismissed', 'Уволен'],
  ].map(([value, label]) => `<option value="${value}" ${user.status === value ? 'selected' : ''}>${label}</option>`).join('');

  showModal(`
    <div class="user-manage-header">
      <span class="user-manage-avatar">${esc(userManagementInitials(user.full_name))}</span>
      <div>
        <div class="section-kicker">Карточка сотрудника</div>
        <h3 class="modal-title">${esc(user.full_name)}</h3>
        <p>${roleLabel(user.role)}${user.group_name ? ` · ${esc(user.group_name)}` : ''}</p>
      </div>
      ${userStatusBadge(user.status)}
    </div>

    <div class="user-manage-tabs" role="tablist" aria-label="Разделы карточки">
      <button class="user-manage-tab is-active" data-tab="main" onclick="setUserManagementTab('main')">Основное</button>
      <button class="user-manage-tab" data-tab="work" onclick="setUserManagementTab('work')">Работа</button>
      <button class="user-manage-tab" data-tab="access" onclick="setUserManagementTab('access')">Доступ</button>
    </div>

    <div class="user-manage-body">
      <div class="user-manage-form">
        <section class="user-manage-panel" data-panel="main">
          <div class="user-manage-section-head"><h4>Личные данные</h4><p>Информация, которая отображается в Puls.</p></div>
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">ФИО</label>
              <input id="manage-user-name" class="form-input" value="${esc(user.full_name)}">
            </div>
            <div class="form-group">
              <label class="form-label">Роль</label>
              <div class="user-manage-readonly">${roleBadge(user.role)}</div>
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input id="manage-user-email" class="form-input" type="email" value="${esc(user.email || '')}" placeholder="user@company.com">
            </div>
            <div class="form-group">
              <label class="form-label">Телефон</label>
              <input id="manage-user-phone" class="form-input" value="${esc(user.phone || '')}" placeholder="+7...">
            </div>
          </div>
        </section>

        <section class="user-manage-panel" data-panel="work" hidden>
          <div class="user-manage-section-head"><h4>Рабочие параметры</h4><p>Группа, статус и параметры расчёта сотрудника.</p></div>
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Группа</label>
              <select id="manage-user-group" class="form-select">
                <option value="">Без группы</option>
                ${groupOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Статус аккаунта</label>
              <select id="manage-user-status" class="form-select">${statusOptions}</select>
            </div>
            ${isOperator ? `
              <div class="form-group">
                <label class="form-label">Должность</label>
                <select id="manage-user-position" class="form-select">
                  <option value="operator" ${(user.position || 'operator') === 'operator' ? 'selected' : ''}>Оператор</option>
                  <option value="chat_manager" ${user.position === 'chat_manager' ? 'selected' : ''}>Чат-менеджер</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Участие в рейтинге</label>
                <select id="manage-user-participation" class="form-select">
                  <option value="participating" ${user.participation_status !== 'not_participating' ? 'selected' : ''}>Участвует</option>
                  <option value="not_participating" ${user.participation_status === 'not_participating' ? 'selected' : ''}>Не участвует</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Ставка</label>
                <select id="manage-user-rate" class="form-select">
                  <option value="">Не указана</option>
                  <option value="0.5" ${Number(user.rate) === 0.5 ? 'selected' : ''}>0.5 ставки</option>
                  <option value="0.75" ${Number(user.rate) === 0.75 ? 'selected' : ''}>0.75 ставки</option>
                  <option value="1" ${Number(user.rate) === 1 ? 'selected' : ''}>1.0 ставка</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Дата начала работы</label>
                <input id="manage-user-start-date" class="form-input" type="date" value="${esc(startDate)}">
              </div>` : ''}
          </div>
          ${isOperator ? `<div class="user-manage-level-row">
            <div><span>Текущий уровень</span><strong>${esc(levelName)}</strong></div>
            <button class="btn-outline btn-sm" type="button" onclick="manualOperatorLevelUi(${user.operator_id})">Изменить уровень</button>
          </div>` : ''}
        </section>

        <section class="user-manage-panel" data-panel="access" hidden>
          <div class="user-manage-section-head"><h4>Доступ к системе</h4><p>Логин и служебные действия с аккаунтом.</p></div>
          <div class="form-group">
            <label class="form-label">Логин</label>
            <input id="manage-user-login" class="form-input" value="${esc(user.login || user.username || '')}">
          </div>
          <div class="user-manage-service-actions">
            <button class="btn-outline" type="button" onclick="showUserResetPasswordModal(${user.id})">Сбросить пароль</button>
            ${isOperator ? `<button class="btn-outline" type="button" onclick="showOperatorHistoryModal(${user.operator_id})">История изменений</button>` : ''}
          </div>
          ${user.status === 'active' ? `<div class="user-manage-danger-zone">
            <div><strong>Отключение аккаунта</strong><span>Пользователь потеряет доступ до повторной активации.</span></div>
            <button class="btn-outline" type="button" onclick="closeModal();deactivateUserUi(${user.id})">Деактивировать</button>
          </div>` : ''}
        </section>
      </div>
    </div>

    <div id="manage-user-error" class="status-line"></div>
    <div class="user-manage-footer">
      <button class="btn-outline" type="button" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" id="manage-user-save" type="button" onclick="submitUserManagement(${user.id})">Сохранить изменения</button>
    </div>
  `, { className: 'modal-user-manage' });
}

async function submitUserManagement(userId) {
  const user = STATE.users.find(item => item.id === userId);
  const error = document.getElementById('manage-user-error');
  const button = document.getElementById('manage-user-save');
  if (!user || !error || !button) return;

  const fullName = document.getElementById('manage-user-name')?.value?.trim() || '';
  const login = document.getElementById('manage-user-login')?.value?.trim() || '';
  const email = document.getElementById('manage-user-email')?.value?.trim() || null;
  const phone = document.getElementById('manage-user-phone')?.value?.trim() || null;
  const groupValue = document.getElementById('manage-user-group')?.value || '';
  const status = document.getElementById('manage-user-status')?.value || user.status;
  if (fullName.length < 2) {
    error.textContent = 'Укажите корректное ФИО';
    error.className = 'status-line status-error';
    setUserManagementTab('main');
    return;
  }
  if (!login) {
    error.textContent = 'Логин не может быть пустым';
    error.className = 'status-line status-error';
    setUserManagementTab('access');
    return;
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    error.textContent = 'Введите корректный email';
    error.className = 'status-line status-error';
    setUserManagementTab('main');
    return;
  }
  if (user.role === 'operator' && user.operator_id && !groupValue) {
    error.textContent = 'Выберите рабочую группу оператора';
    error.className = 'status-line status-error';
    setUserManagementTab('work');
    return;
  }

  const payload = {
    full_name: fullName,
    login,
    email,
    phone,
    group_id: groupValue ? Number(groupValue) : null,
    status,
  };
  if (user.role === 'operator' && user.operator_id) {
    const rateValue = document.getElementById('manage-user-rate')?.value || '';
    payload.position = document.getElementById('manage-user-position')?.value || 'operator';
    payload.participation_status = document.getElementById('manage-user-participation')?.value || 'participating';
    payload.start_date = document.getElementById('manage-user-start-date')?.value || null;
    payload.rate = rateValue ? Number(rateValue) : null;
  }

  button.disabled = true;
  button.textContent = 'Сохраняем…';
  error.textContent = '';
  try {
    const updated = await api.updateUser(userId, payload);
    STATE.users = STATE.users.map(item => item.id === userId ? updated : item);
    swrInvalidate('users:list');
    swrInvalidate('dashboard:operators');
    closeModal();
    renderAdminOperators();
    showToast('Данные пользователя обновлены', 'ok');
  } catch(e) {
    error.textContent = e.message;
    error.className = 'status-line status-error';
    button.disabled = false;
    button.textContent = 'Сохранить изменения';
  }
}

function showUserResetPasswordModal(userId) {
  const user = STATE.users.find(u => u.id === userId);
  showModal(`
    <h3 class="modal-title">Сбросить пароль</h3>
    <div class="status-line" style="padding:0;color:var(--tx2)">Пользователь: <b>${esc(user?.full_name || '')}</b></div>
    <div class="form-group">
      <label class="form-label">Новый временный пароль</label>
      <input id="reset-user-password" class="form-input" type="password" placeholder="TempPassword123">
    </div>
    <div id="reset-user-password-error" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:8px" onclick="submitUserResetPassword(${userId})">Сохранить</button>
  `);
}

async function submitUserResetPassword(userId) {
  const password = document.getElementById('reset-user-password')?.value || '';
  const err = document.getElementById('reset-user-password-error');
  if (password.length < 8 || !/[A-Za-zА-Яа-я]/.test(password) || !/\d/.test(password)) {
    if (err) { err.textContent = 'Пароль должен быть минимум 8 символов и содержать буквы и цифры'; err.className = 'status-line status-error'; }
    return;
  }
  try {
    await api.resetUserPassword(userId, { new_password: password, must_change_password: true });
    closeModal();
    showToast('Пароль сброшен', 'ok');
  } catch(e) {
    if (err) { err.textContent = e.message; err.className = 'status-line status-error'; }
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
  const levelOptions = (STATE.operatorLevels || [])
    .filter(l => l.is_active)
    .map(l => `<option value="${l.id}">${esc(l.name)}</option>`)
    .join('');
  showModal(`
    <h3 class="modal-title">Добавить бонус в магазин</h3>
    <div class="form-group"><label class="form-label">Название</label>
      <input id="ni-title" class="form-input" placeholder="Сертификат на кофе"></div>
    <div class="form-group"><label class="form-label">Описание</label>
      <input id="ni-desc" class="form-input" placeholder="Подарочная карта в кофейню"></div>
    <div class="form-group"><label class="form-label">Категория</label>
      <select id="ni-category" class="form-select">
        <option value="quick">Быстрые бонусы</option>
        <option value="workday">Комфорт на смене</option>
        <option value="recognition">Признание</option>
        <option value="gifts">Подарки</option>
        <option value="other">Другие</option>
      </select></div>
    <div class="form-group"><label class="form-label">Цена (коины)</label>
      <input id="ni-price" class="form-input" type="number" min="1" placeholder="120"></div>
    <div class="form-group"><label class="form-label">Минимальный уровень</label>
      <select id="ni-min-level" class="form-select">
        <option value="">Без ограничения</option>
        ${levelOptions}
      </select></div>
    <div class="coin-rules-section-title" style="margin-top:14px">Сезонность и лимиты <span class="cell-muted" style="font-weight:400;text-transform:none">(необязательно)</span></div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Доступен с</label>
        <input id="ni-starts" class="form-input" type="datetime-local"></div>
      <div class="form-group"><label class="form-label">Доступен до</label>
        <input id="ni-ends" class="form-input" type="datetime-local"></div>
      <div class="form-group"><label class="form-label">Лимит остатка <span class="hint">(0 = без лимита)</span></label>
        <input id="ni-stock" class="form-input" type="number" min="0" value="0"></div>
      <div class="form-group"><label class="form-label">Лимит на оператора <span class="hint">(0 = без лимита)</span></label>
        <input id="ni-oplimit" class="form-input" type="number" min="0" value="0"></div>
    </div>
    <div id="ni-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitAddItem()">Добавить</button>`);
}
async function submitAddItem() {
  const title = document.getElementById('ni-title')?.value?.trim();
  const desc  = document.getElementById('ni-desc')?.value?.trim() || '';
  const category = document.getElementById('ni-category')?.value || 'other';
  const price = +document.getElementById('ni-price')?.value;
  const minLevelRaw = document.getElementById('ni-min-level')?.value || '';
  const min_level_id = minLevelRaw ? Number(minLevelRaw) : null;
  const starts_at = document.getElementById('ni-starts')?.value || null;
  const ends_at = document.getElementById('ni-ends')?.value || null;
  const stock_limit = +(document.getElementById('ni-stock')?.value || 0);
  const purchase_limit_per_operator = +(document.getElementById('ni-oplimit')?.value || 0);
  const err   = document.getElementById('ni-err');
  if (!title || !price) { err.textContent = 'Заполните название и цену'; return; }
  try {
    await api.createShopItem({ title, description: desc, category, price, min_level_id, starts_at, ends_at, stock_limit, purchase_limit_per_operator });
    closeModal(); showToast('Бонус добавлен', 'ok');
    STATE.shopItems = await api.listShopItems(); renderShop();
  } catch(e) { err.textContent = e.message; }
}

function showEditItemModal(item) {
  const levelOptions = (STATE.operatorLevels || [])
    .filter(l => l.is_active)
    .map(l => `<option value="${l.id}" ${item.min_level_id === l.id ? 'selected' : ''}>${esc(l.name)}</option>`)
    .join('');
  const toLocalInput = (iso) => iso ? String(iso).slice(0, 16) : '';
  showModal(`
    <h3 class="modal-title">Редактировать бонус</h3>
    <div class="form-group"><label class="form-label">Название</label>
      <input id="ei-title" class="form-input" value="${esc(item.title)}"></div>
    <div class="form-group"><label class="form-label">Описание</label>
      <input id="ei-desc" class="form-input" value="${esc(item.description)}"></div>
    <div class="form-group"><label class="form-label">Категория</label>
      <select id="ei-category" class="form-select">
        <option value="quick" ${item.category === 'quick' ? 'selected' : ''}>Быстрые бонусы</option>
        <option value="workday" ${item.category === 'workday' ? 'selected' : ''}>Комфорт на смене</option>
        <option value="recognition" ${item.category === 'recognition' ? 'selected' : ''}>Признание</option>
        <option value="gifts" ${item.category === 'gifts' ? 'selected' : ''}>Подарки</option>
        <option value="other" ${!item.category || item.category === 'other' ? 'selected' : ''}>Другие</option>
      </select></div>
    <div class="form-group"><label class="form-label">Цена (коины)</label>
      <input id="ei-price" class="form-input" type="number" value="${item.price}"></div>
    <div class="form-group"><label class="form-label">Минимальный уровень</label>
      <select id="ei-min-level" class="form-select">
        <option value="" ${!item.min_level_id ? 'selected' : ''}>Без ограничения</option>
        ${levelOptions}
      </select></div>
    <div class="form-group"><label class="form-label">Статус</label>
      <select id="ei-active" class="form-select">
        <option value="true" ${item.is_active?'selected':''}>Активен</option>
        <option value="false" ${!item.is_active?'selected':''}>Отключён</option>
      </select></div>
    <div class="coin-rules-section-title" style="margin-top:14px">Сезонность и лимиты <span class="cell-muted" style="font-weight:400;text-transform:none">(необязательно)</span></div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Доступен с</label>
        <input id="ei-starts" class="form-input" type="datetime-local" value="${toLocalInput(item.starts_at)}"></div>
      <div class="form-group"><label class="form-label">Доступен до</label>
        <input id="ei-ends" class="form-input" type="datetime-local" value="${toLocalInput(item.ends_at)}"></div>
      <div class="form-group"><label class="form-label">Лимит остатка <span class="hint">(0 = без лимита)</span></label>
        <input id="ei-stock" class="form-input" type="number" min="0" value="${item.stock_limit ?? 0}"></div>
      <div class="form-group"><label class="form-label">Лимит на оператора <span class="hint">(0 = без лимита)</span></label>
        <input id="ei-oplimit" class="form-input" type="number" min="0" value="${item.purchase_limit_per_operator ?? 0}"></div>
    </div>
    ${item.stock_remaining != null ? `<div class="status-line">Сейчас остаток: ${item.stock_remaining}</div>` : ''}
    <div id="ei-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitEditItem(${item.id})">Сохранить</button>`);
}
async function submitEditItem(id) {
  const title     = document.getElementById('ei-title')?.value?.trim();
  const description = document.getElementById('ei-desc')?.value?.trim() || '';
  const category  = document.getElementById('ei-category')?.value || 'other';
  const price     = +document.getElementById('ei-price')?.value;
  const minLevelRaw = document.getElementById('ei-min-level')?.value || '';
  const min_level_id = minLevelRaw ? Number(minLevelRaw) : null;
  const is_active = document.getElementById('ei-active')?.value === 'true';
  const starts_at = document.getElementById('ei-starts')?.value || null;
  const ends_at = document.getElementById('ei-ends')?.value || null;
  const stock_limit = +(document.getElementById('ei-stock')?.value || 0);
  const purchase_limit_per_operator = +(document.getElementById('ei-oplimit')?.value || 0);
  const err       = document.getElementById('ei-err');
  if (!title || !price) { err.textContent = 'Заполните поля'; return; }
  try {
    await api.updateShopItem(id, { title, description, category, price, min_level_id, is_active, starts_at, ends_at, stock_limit, purchase_limit_per_operator });
    closeModal(); showToast('Бонус обновлён', 'ok');
    STATE.shopItems = await api.listShopItems(); renderShop();
  } catch(e) { err.textContent = e.message; }
}

/* ══════════════════════════════════════
   EXPORT
══════════════════════════════════════ */
function exportCSV() {
  window.open(api.exportUrl('/api/exports/operators', { format: 'csv' }), '_blank');
}
function exportOperatorsXLSX() {
  window.open(api.exportUrl('/api/exports/operators', { format: 'xlsx' }), '_blank');
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
  return { pending:'Новая', new:'Новая', approved:'Одобрена', rejected:'Отклонена', completed:'Выполнена', cancelled:'Отменена' }[s] || s;
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
        Для продолжения работы в Puls нужно заменить временный пароль.
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
    const data = await api.changeMyPassword({ current_password: curPwd, new_password: newPwd, confirm_password: confPwd });
    showToast('Пароль изменён. Войдите снова.', 'ok');
    closeModal(true);
    setTimeout(logoutAndReload, 900);
  } catch(e) {
    errEl.textContent = e.message;
    btn.disabled = false; btn.textContent = 'Сохранить пароль';
  }
}

async function logoutAndReload() {
  try { await api.logout(); } catch(e) { /* игнорируем ошибку — удаляем куку на клиенте */ }
  // Запасное удаление куки на клиенте (на случай если сервер вернул 403)
  document.cookie.split(';').forEach(c => {
    const name = c.trim().split('=')[0];
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
  });
  // Очищаем sessionStorage (SWR-кеш)
  sessionStorage.clear();
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
    const data = await api.changeMyLogin({ new_login: newLogin, current_password: curPwd });
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
    const data = await api.changeMyPassword({ current_password: curPwd, new_password: newPwd, confirm_password: confPwd });
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
window.deactivateUserUi = deactivateUserUi;

window.setDynMode = function(mode) {
  // dynMode живёт внутри замыкания renderRating,
  // поэтому обновляем через глобальный колбэк
  if (window._setDynModeInternal) window._setDynModeInternal(mode);
};
window.showUserResetPasswordModal = showUserResetPasswordModal;
window.submitUserResetPassword = submitUserResetPassword;
window.showUserManagementModal = showUserManagementModal;
window.setUserManagementTab = setUserManagementTab;
window.submitUserManagement = submitUserManagement;
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
window.renderOperatorLevelsSettings = renderOperatorLevelsSettings;
window.recalculateOperatorLevelsUi = recalculateOperatorLevelsUi;
window.showCreateOperatorLevelPrompt = showCreateOperatorLevelPrompt;
window.submitOperatorLevelForm = submitOperatorLevelForm;
window.editOperatorLevelUi = editOperatorLevelUi;
window.addOperatorLevelRuleUi = addOperatorLevelRuleUi;
window.submitOperatorLevelRuleForm = submitOperatorLevelRuleForm;
window.deleteOperatorLevelRuleUi = deleteOperatorLevelRuleUi;
window.disableOperatorLevelUi = disableOperatorLevelUi;
window.manualOperatorLevelUi = manualOperatorLevelUi;


/* ══════════════════════════════════════
   VIEW: РАСЧЁТ ЗА ПЕРИОД
══════════════════════════════════════ */
