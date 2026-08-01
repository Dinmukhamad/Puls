/* Выделено из 30-admin-coins-groups-operators.view.js (3110 строк).
   Раздел «Коины»: обзор, правила, ручное начисление, поиск оператора. */

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
    <div class="coins-page-head">
      <div>
        <div class="section-kicker">Коины</div>
        <h2 class="section-title">Операции с коинами</h2>
        <p>Начисления, заявки и правила в одном рабочем пространстве</p>
      </div>
      <div class="coins-head-actions">
        <button class="btn-outline btn-sm" onclick="refreshCoinsModule()">Обновить</button>
      </div>
    </div>
    <div class="coins-page-tabs" role="tablist" aria-label="Разделы операций с коинами">
      ${tabs.map(([id, label]) => `<button class="coins-page-tab ${tab === id ? 'is-active' : ''}" type="button" role="tab" aria-selected="${tab === id}" data-coins-tab="${id}">${label}</button>`).join('')}
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
    <div class="coins-summary-grid">
      <button class="coins-summary-card is-accent" type="button" onclick="navigateTo('coins',{tab:'history'})">
        <span>Операций сегодня</span><strong>${overview.today_operations || 0}</strong><small>Всего: ${overview.total_operations || 0}</small>
      </button>
      <button class="coins-summary-card is-positive" type="button" onclick="navigateTo('coins',{tab:'history'})">
        <span>Баланс дня</span><strong>${(overview.today_credited || 0) - (overview.today_debited || 0) >= 0 ? '+' : ''}${(overview.today_credited || 0) - (overview.today_debited || 0)} ₡</strong><small>+${overview.today_credited || 0} / -${overview.today_debited || 0}</small>
      </button>
      <button class="coins-summary-card ${overview.new_requests ? 'has-alert' : ''}" type="button" onclick="navigateTo('coins',{tab:'requests'})">
        <span>Новые заявки</span><strong>${overview.new_requests || 0}</strong><small>${overview.new_requests ? 'Требуют решения' : 'Очередь обработана'}</small>
      </button>
      <div class="coins-summary-card">
        <span>Зарезервировано</span><strong>${overview.reserved_coins || 0} ₡</strong><small>В активных заявках</small>
      </div>
    </div>
    <div class="coins-overview-grid">
      <section class="coins-surface">
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
      </section>
      <section class="coins-surface">
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
      </section>
    </div>
    `;
}

function renderCoinRules(body) {
  body.innerHTML = `
    <div class="coins-surface coins-rules-surface">
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
    el.innerHTML = `<div class="coins-section-head"><div><div class="section-kicker">Начисление</div><h3>Ручная операция</h3></div></div><div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>`;
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
    <div class="coins-section-head">
      <div><div class="section-kicker">Начисление</div><h3>Ручная операция</h3><p>Изменение баланса с обязательной записью в историю</p></div>
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
