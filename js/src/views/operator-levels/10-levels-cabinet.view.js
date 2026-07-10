async function renderOperatorLevelsSettings() {
  const el = document.getElementById('view-operator-levels');
  if (!el) return;
  if (!(STATE.user?.role === 'manager' || STATE.user?.role === 'admin')) {
    el.innerHTML = '<div class="empty-state"><p>Недостаточно прав</p></div>';
    return;
  }

  const tab = STATE.opLevelsTab === 'achievements' ? 'achievements' : 'levels';
  el.innerHTML = `
    <div class="filter-tabs" style="margin-bottom:16px">
      <button class="filter-tab ${tab === 'levels' ? 'active' : ''}" data-op-levels-tab="levels">Уровни</button>
      <button class="filter-tab ${tab === 'achievements' ? 'active' : ''}" data-op-levels-tab="achievements">Достижения</button>
    </div>
    <div id="op-levels-tab-body"></div>`;
  el.querySelectorAll('[data-op-levels-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.opLevelsTab = btn.dataset.opLevelsTab;
      renderOperatorLevelsSettings();
    });
  });
  const bodyEl = el.querySelector('#op-levels-tab-body');
  if (tab === 'achievements') { renderAchievementsAdminTab(bodyEl); return; }
  return renderLevelsTabContent(bodyEl);
}

async function renderLevelsTabContent(el) {
  if (!el) return;
  el.innerHTML = `<div class="view-header level-view-header">
    <div>
      <div class="section-kicker">Операторы</div>
      <h2 class="section-title">Уровни операторов</h2>
    </div>
    <div class="header-right level-header-actions">
      <button class="btn-outline btn-sm" onclick="recalculateOperatorLevelsUi()">Пересчитать</button>
      <button class="btn-primary btn-sm" onclick="showCreateOperatorLevelPrompt()">Добавить уровень</button>
    </div>
  </div>
  <div class="panel level-settings-shell"><div class="empty-state"><p>Загрузка уровней…</p></div></div>`;

  let levels = [];
  try {
    levels = await withTimeout(swrFetch('levels:admin', () => api.listAdminOperatorLevels(), null, SWR_STATIC_TTL_MS), 15000, 'Уровни не загрузились: сервер не ответил за 15 секунд');
  } catch (adminErr) {
    try {
      levels = await withTimeout(swrFetch('levels:list', () => api.listOperatorLevels(), null, SWR_STATIC_TTL_MS), 15000, 'Уровни не загрузились: сервер не ответил за 15 секунд');
    } catch (publicErr) {
      el.innerHTML = `<div class="view-header level-view-header">
        <div>
          <div class="section-kicker">Операторы</div>
          <h2 class="section-title">Уровни операторов</h2>
        </div>
        <div class="header-right level-header-actions">
          <button class="btn-outline btn-sm" onclick="renderOperatorLevelsSettings()">Обновить</button>
        </div>
      </div>
      <div class="status-line status-error">${esc(publicErr.message || adminErr.message || 'Не удалось загрузить уровни')}</div>`;
      return;
    }
  }
  STATE.operatorLevels = levels;
  const rewardsData = await withTimeout(swrFetch('levels:rewards', () => api.listOperatorLevelRewards(), null, SWR_FAST_TTL_MS), 10000)
    .catch(() => ({ items: [] }));
  const rewardRows = Array.isArray(rewardsData) ? rewardsData : (rewardsData.items || []);

  function metricLabel(code) {
    return {
      tenure_days: 'Стаж',
      quality: 'Качество',
      kvz: 'КВЗ',
      efficiency: 'Эффективность',
      penalty_minutes: 'Штрафы',
      final_points: 'Итоговые баллы',
      test_percent: 'Тесты',
      total_xp: 'XP',
    }[code] || code;
  }

  function ruleText(rule) {
    const label = metricLabel(rule.metric_code);
    if (rule.operator === 'between') return `${label}: ${levelNum(rule.value_min)}-${levelNum(rule.value_max)}`;
    if (rule.operator === 'gte') return `${label} >= ${levelNum(rule.value_min)}`;
    if (rule.operator === 'lte') return `${label} <= ${levelNum(rule.value_max)}`;
    return `${label} = ${levelNum(rule.value_min)}`;
  }

  function rewardStatus(row) {
    if (!row.reward_coins) return '<span class="status-pill muted">Без бонуса</span>';
    if (row.reward_received) return '<span class="status-pill ok">Получен</span>';
    return '<span class="status-pill warn">Ожидает повышения</span>';
  }

  el.innerHTML = `<div class="view-header level-view-header">
    <div>
      <div class="section-kicker">Операторы</div>
      <h2 class="section-title">Уровни операторов</h2>
    </div>
    <div class="header-right level-header-actions">
      <button class="btn-outline btn-sm" onclick="recalculateOperatorLevelsUi()">Пересчитать</button>
      <button class="btn-primary btn-sm" onclick="showCreateOperatorLevelPrompt()">Добавить уровень</button>
    </div>
  </div>
  <div class="panel level-settings-shell">
    <div class="level-settings-head">
      <div>
        <h3>Правила уровней</h3>
        <p>Уровень считается отдельно от роли доступа. Чем выше порядок, тем выше игровой статус оператора.</p>
      </div>
      <span class="panel-badge">${levels.filter(l => l.is_active).length} активных</span>
    </div>
    <div class="level-settings-list">
      ${levels.map(level => `<article class="level-settings-row ${level.is_active ? '' : 'is-disabled'}">
        <div class="level-main-cell">
          <div class="level-title-line">
            <span class="level-color-dot" style="background:${esc(level.color || '#64748B')}"></span>
            <strong>${esc(level.name)}</strong>
            ${levelBadgeHtml(level)}
            <span class="level-order">#${level.sort_order ?? 0}</span>
            ${level.reward_coins ? `<span class="level-order">+${level.reward_coins} ₡</span>` : ''}
          </div>
          <div class="level-desc">${esc(level.description || 'Описание не задано')}${level.min_total_xp ? ` · XP от ${level.min_total_xp}` : ''}</div>
        </div>
        <div class="level-rules-cell">
          ${(level.rules || []).length ? (level.rules || []).map(rule => `
            <span class="level-rule-chip" title="${esc(ruleText(rule))}">
              ${esc(ruleText(rule))}
              <button type="button" onclick="deleteOperatorLevelRuleUi(${rule.id})" aria-label="Удалить показатель">×</button>
            </span>`).join('') : '<span class="cell-muted">Показатели не настроены</span>'}
        </div>
        <div class="level-status-cell">
          <span class="status-pill ${level.is_active ? 'ok' : 'muted'}">${level.is_active ? 'Активен' : 'Отключён'}</span>
        </div>
        <div class="level-actions-cell">
          <button class="btn-outline btn-sm" onclick="editOperatorLevelUi(${level.id})">Изменить</button>
          <button class="btn-outline btn-sm" onclick="addOperatorLevelRuleUi(${level.id})">Показатель</button>
          <button class="btn-outline btn-sm danger" onclick="disableOperatorLevelUi(${level.id})">Отключить</button>
        </div>
      </article>`).join('')}
    </div>
  </div>
  <div class="panel level-settings-shell" style="margin-top:18px">
    <div class="level-settings-head">
      <div>
        <h3>Операторы и награды</h3>
        <p>Контроль текущих уровней, разовых бонусов и связанных coin transactions. XP пока зарезервирован и равен 0.</p>
      </div>
      <span class="panel-badge">${rewardRows.length} операторов</span>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Оператор</th>
            <th>Группа</th>
            <th>Уровень</th>
            <th class="num">Стаж</th>
            <th class="num">XP</th>
            <th class="num">Бонус</th>
            <th>Статус</th>
            <th class="num">Tx ID</th>
          </tr>
        </thead>
        <tbody>
          ${rewardRows.length ? rewardRows.map(row => `<tr>
            <td class="name-cell">${esc(row.operator_name)}</td>
            <td>${esc(row.group_name || '—')}</td>
            <td>${levelBadgeHtml(row.level)}</td>
            <td class="num">${levelNum(row.tenure_days, 0)} дн.</td>
            <td class="num">${levelNum(row.total_xp || 0, 0)}</td>
            <td class="num">${row.reward_coins ? `+${row.reward_coins} ₡` : '—'}</td>
            <td>${rewardStatus(row)}</td>
            <td class="num">${row.coin_transaction_id || '—'}</td>
          </tr>`).join('') : '<tr><td colspan="8" class="empty-line">Нет данных</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}

async function recalculateOperatorLevelsUi() {
  try {
    const res = await api.recalculateOperatorLevels({ mode: 'all' });
    swrInvalidate('levels:');
    showToast(`Пересчитано: ${res.processed}, изменено: ${res.updated}`, 'ok');
    swrInvalidate('rating:list');
    await reloadData();
  } catch(e) { showToast(e.message, 'error'); }
}

async function showCreateOperatorLevelPrompt() {
  showOperatorLevelForm();
}

async function editOperatorLevelUi(levelId) {
  const level = STATE.operatorLevels.find(l => l.id === levelId);
  if (!level) return;
  showOperatorLevelForm(level);
}

function showOperatorLevelForm(level = null) {
  const isEdit = Boolean(level);
  showModal(`
    <h3 class="modal-title">${isEdit ? 'Изменить уровень' : 'Добавить уровень'}</h3>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Название</label>
        <input id="lvl-name" class="form-input" value="${esc(level?.name || '')}" placeholder="Например: Профи">
      </div>
      <div class="form-group">
        <label class="form-label">Код</label>
        <input id="lvl-code" class="form-input" value="${esc(level?.code || '')}" ${isEdit ? 'disabled' : ''} placeholder="pro">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Цвет бейджа</label>
        <input id="lvl-color" class="form-input" value="${esc(level?.color || '#64748B')}" placeholder="#64748B">
      </div>
      <div class="form-group">
        <label class="form-label">Порядок</label>
        <input id="lvl-order" class="form-input" type="number" value="${esc(level?.sort_order ?? ((STATE.operatorLevels.length + 1) * 10))}">
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Минимальный XP</label>
        <input id="lvl-min-xp" class="form-input" type="number" min="0" value="${esc(level?.min_total_xp ?? 0)}">
      </div>
      <div class="form-group">
        <label class="form-label">Бонус коинов</label>
        <input id="lvl-reward-coins" class="form-input" type="number" min="0" value="${esc(level?.reward_coins ?? 0)}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Описание</label>
      <textarea id="lvl-description" class="form-input" rows="3" placeholder="Короткое описание уровня">${esc(level?.description || '')}</textarea>
    </div>
    <div id="lvl-form-error" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:8px" onclick="submitOperatorLevelForm(${isEdit ? level.id : 'null'})">${isEdit ? 'Сохранить' : 'Создать'}</button>
  `);
}

async function submitOperatorLevelForm(levelId) {
  const err = document.getElementById('lvl-form-error');
  const name = document.getElementById('lvl-name')?.value.trim();
  const code = document.getElementById('lvl-code')?.value.trim();
  const color = document.getElementById('lvl-color')?.value.trim() || '#64748B';
  const description = document.getElementById('lvl-description')?.value.trim() || '';
  const sort_order = Number(document.getElementById('lvl-order')?.value || 0);
  const min_total_xp = Number(document.getElementById('lvl-min-xp')?.value || 0);
  const reward_coins = Number(document.getElementById('lvl-reward-coins')?.value || 0);
  if (!name || (!levelId && !code)) {
    if (err) { err.textContent = 'Заполните название и код'; err.className = 'status-line status-error'; }
    return;
  }
  try {
    const payload = { name, color, description, sort_order, min_total_xp, reward_coins, reward_once: true };
    if (levelId) await api.updateOperatorLevel(levelId, payload);
    else await api.createOperatorLevel({ code, icon: '', is_active: true, ...payload });
    swrInvalidate('levels:');
    closeModal();
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function addOperatorLevelRuleUi(levelId) {
  const level = STATE.operatorLevels.find(l => l.id === levelId);
  showModal(`
    <h3 class="modal-title">Добавить показатель</h3>
    <div class="status-line" style="padding:0;color:var(--text-secondary)">Уровень: <b>${esc(level?.name || '')}</b></div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Показатель</label>
        <select id="rule-metric" class="form-select">
          <option value="tenure_days">Стаж</option>
          <option value="quality">Качество</option>
          <option value="kvz">КВЗ</option>
          <option value="efficiency">Эффективность</option>
          <option value="penalty_minutes">Штрафы</option>
          <option value="final_points">Итоговые баллы</option>
          <option value="test_percent">Тесты</option>
          <option value="total_xp">XP</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Условие</label>
        <select id="rule-operator" class="form-select">
          <option value="gte">Больше или равно</option>
          <option value="lte">Меньше или равно</option>
          <option value="eq">Равно</option>
          <option value="between">Между</option>
        </select>
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Минимум / значение</label>
        <input id="rule-min" class="form-input" type="number" step="0.01" value="0">
      </div>
      <div class="form-group">
        <label class="form-label">Максимум</label>
        <input id="rule-max" class="form-input" type="number" step="0.01" placeholder="Для lte / between">
      </div>
    </div>
    <div id="rule-form-error" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:8px" onclick="submitOperatorLevelRuleForm(${levelId})">Добавить</button>
  `);
}

async function submitOperatorLevelRuleForm(levelId) {
  const metric_code = document.getElementById('rule-metric')?.value;
  const operator = document.getElementById('rule-operator')?.value;
  const value_min_raw = document.getElementById('rule-min')?.value;
  const value_max_raw = document.getElementById('rule-max')?.value;
  const payload = {
    metric_code,
    operator,
    value_min: value_min_raw === '' || value_min_raw == null ? null : Number(value_min_raw),
    value_max: value_max_raw === '' || value_max_raw == null ? null : Number(value_max_raw),
    is_required: true,
  };
  if (operator === 'lte') payload.value_min = null;
  if ((operator === 'gte' || operator === 'eq') && payload.value_min === null) {
    const err = document.getElementById('rule-form-error');
    if (err) { err.textContent = 'Укажите значение'; err.className = 'status-line status-error'; }
    return;
  }
  if ((operator === 'lte' || operator === 'between') && payload.value_max === null) {
    const err = document.getElementById('rule-form-error');
    if (err) { err.textContent = 'Укажите максимум'; err.className = 'status-line status-error'; }
    return;
  }
  try {
    await api.addOperatorLevelRule(levelId, payload);
    swrInvalidate('levels:');
    closeModal();
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteOperatorLevelRuleUi(ruleId) {
  if (!confirm('Удалить показатель уровня?')) return;
  try {
    await api.deleteOperatorLevelRule(ruleId);
    swrInvalidate('levels:');
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function disableOperatorLevelUi(levelId) {
  if (!confirm('Отключить уровень?')) return;
  try {
    await api.deleteOperatorLevel(levelId);
    swrInvalidate('levels:');
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function manualOperatorLevelUi(operatorId) {
  const op = STATE.adminOperators.find(o => o.id === operatorId);
  const levels = STATE.operatorLevels.length ? STATE.operatorLevels : await api.listOperatorLevels().catch(() => []);
  const activeLevels = levels.filter(l => l.is_active);
  if (!activeLevels.length) { showToast('Нет активных уровней', 'error'); return; }
  const options = activeLevels.map(l => `${l.id}: ${l.name}`).join('\n');
  const raw = prompt(`Выберите уровень для ${op?.full_name || 'оператора'}:\n${options}`);
  if (!raw) return;
  const levelId = Number(String(raw).split(':')[0].trim());
  if (!levelId) { showToast('Некорректный уровень', 'error'); return; }
  const reason = prompt('Причина ручной смены уровня');
  if (!reason || !reason.trim()) { showToast('Причина обязательна', 'error'); return; }
  const comment = prompt('Комментарий', '') || '';
  try {
    await api.manualOperatorLevel(operatorId, { level_id: levelId, reason, comment });
    swrInvalidate('levels:');
    showToast('Уровень изменён', 'ok');
    swrInvalidate('rating:list');
    await reloadData();
  } catch(e) { showToast(e.message, 'error'); }
}

/* ══════════════════════════════════════
   VIEW: КАБИНЕТ ОПЕРАТОРА
══════════════════════════════════════ */
function renderCabinet() {
  const el = document.getElementById('view-cabinet');
  if (!el) return;
  if (!(STATE.user?.role === 'operator' || STATE.user?.role === 'supervisor')) {
    el.innerHTML = `<div class="view-header">
      <div>
        <div class="section-kicker">Кабинет</div>
        <h2 class="section-title">Мой кабинет</h2>
      </div>
    </div>
    <div class="panel">
      <h3>Администратор</h3>
      <p class="muted">Личный кошелёк доступен только аккаунтам, привязанным к оператору.</p>
    </div>`;
    return;
  }
  const w = STATE.wallet;
  if (!w) {
    el.innerHTML = `<div class="view-header"><div><div class="section-kicker">Кабинет</div><h2 class="section-title">Мой кабинет</h2></div></div>
      <div class="empty-state"><p>Данные загружаются…</p></div>`;
    const _cabinetGen = STATE.navGen;
    swrFetch('wallet:me', () => api.myWallet(), null, SWR_FAST_TTL_MS).then(data => {
      STATE.wallet = data;
      if (!isNavStale(_cabinetGen)) renderCabinet();
    }).catch(() => {});
    return;
  }

  const myRow = STATE.rating.find(r => r.operator_id === w.operator_id);
  const hasRank = myRow?.rank_position != null && Number(myRow.rank_position) > 0;
  const rank = hasRank ? Number(myRow.rank_position) : null;
  const total = STATE.rating.length || '—';
  const delta = myRow?.rank_delta;
  const levelInfo = STATE.myLevel;
  // Стаж: берём из metrics (API /me/level) или из STATE.myOperator
  const tenureDays = levelInfo?.metrics?.tenure_days ?? STATE.myOperator?.tenure_days ?? null;
  const tenureStr = tenureDays != null ? formatTenureDays(tenureDays) : '—';
  const levelCard = levelInfo ? `
    <div class="panel level-card">
      <div class="panel-head">
        <h3>Мой уровень</h3>
        ${levelBadgeHtml(levelInfo.level, 'level-badge-lg')}
      </div>
      <div class="level-tenure-row">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Стаж: <b>${esc(tenureStr)}</b></span>
      </div>
      ${levelInfo.next_level ? `
        <div class="level-next">До следующего уровня: ${levelBadgeHtml(levelInfo.next_level)}</div>
        <div class="level-gap-list">
          ${(levelInfo.gaps || []).map(g => `
            <div class="level-gap-row ${g.ok ? 'ok' : 'miss'}">
              <span>${esc(g.label)}</span>
              <b>${metricValueHtml(g)}</b>
              <em>${g.ok ? 'готово' : levelRequirementHtml(g)}</em>
            </div>`).join('')}
        </div>` : `
        <div class="empty-line">Вы достигли максимального уровня.</div>`}
      ${levelInfo.is_manual ? `<div class="status-line">Ручной уровень: ${esc(levelInfo.manual_reason || '')}</div>` : ''}
    </div>` : '';

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Кабинет</div><h2 class="section-title">Мой кабинет</h2></div>
      <button class="btn-outline btn-sm" onclick="reloadCabinet()">Обновить</button>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card kpi-accent">
        <div class="kpi-label">Баланс коинов</div>
        <div class="kpi-value">${w.current_balance} <span class="kpi-unit">₡</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Всего заработано</div>
        <div class="kpi-value">${w.total_earned} <span class="kpi-unit">₡</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Потрачено</div>
        <div class="kpi-value">${w.total_spent} <span class="kpi-unit">₡</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Место в рейтинге</div>
        <div class="kpi-value">${rank ? `${rank} <span class="kpi-unit">из ${total}</span>` : '<span class="kpi-unit">Пока не рассчитано</span>'}
          ${delta != null ? `<span class="rank-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '↑'+delta : delta < 0 ? '↓'+Math.abs(delta) : 'без изм.'}</span>` : ''}
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Стаж в компании</div>
        <div class="kpi-value" style="font-size:clamp(14px,2vw,18px)">${esc(tenureStr)}</div>
      </div>
    </div>

    ${levelCard}

    <div id="cabinet-wheel-card"></div>

    <div id="cabinet-wheel-winners"></div>

    <div id="cabinet-weekly-detail"></div>

    <div id="cabinet-achievements"></div>

    <div class="two-col-grid">
      <div class="panel">
        <div class="panel-head"><h3>История начислений</h3><span class="panel-badge">${w.transactions.length} записей</span></div>
        <div class="tx-list">
          ${w.transactions.length ? w.transactions.map(t => `
            <div class="tx-row ${t.amount >= 0 ? 'tx-plus' : 'tx-minus'}">
              <div class="tx-info">
                <span class="tx-comment">${esc(t.comment)}</span>
                <span class="tx-date">${fmtDate(t.created_at)}</span>
              </div>
              <div class="tx-amount">${t.amount >= 0 ? '+' : ''}${t.amount} ₡</div>
            </div>`).join('') : '<div class="empty-line">Операций пока нет</div>'}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Топ-5 недели</h3></div>
        ${miniRating(5, myRow?.operator_id)}
        <div class="panel-footer">
          <button class="btn-link" onclick="navigateTo('rating')">Полный рейтинг →</button>
        </div>
      </div>
    </div>

    <div class="shop-banner">
      <div>
        <div class="shop-banner-title">Магазин бонусов</div>
        <div class="shop-banner-sub">У вас ${w.current_balance} ₡ — потратьте на бонус</div>
      </div>
      <button class="btn-primary" onclick="navigateTo('shop')">В магазин</button>
    </div>`;

  renderCabinetWheelCard();
  renderWheelWinnersToday();
  renderCabinetWeeklyDetail();
  renderCabinetAchievements();
}

// Блок «Победитель Wheel of WOW сегодня» на главной (ТЗ п.10). Грузится
// асинхронно; если сегодня никто не крутил — блок скрыт.
async function renderWheelWinnersToday() {
  const host = document.getElementById('cabinet-wheel-winners');
  if (!host) return;
  let data;
  try {
    data = await api.getWheelWinnersToday();
  } catch {
    host.innerHTML = '';
    return;
  }
  const items = data && data.items ? data.items : [];
  if (!items.length || !data.top) { host.innerHTML = ''; return; }

  const prizeText = (w) => w.prize_type === 'coins' ? `+${w.amount} ₡` : esc(w.prize);
  const top = data.top;
  const rest = items.filter(w => !(w.operator_id === top.operator_id && w.at === top.at));

  host.innerHTML = `
    <div class="panel wheel-winner-card">
      <div class="wheel-winner-head">
        <span class="wheel-winner-kicker">🎡 Победитель Wheel of WOW сегодня</span>
        <span class="wheel-winner-badge">Крупнейший приз дня</span>
      </div>
      <div class="wheel-winner-hero">
        <div class="wheel-winner-avatar">${esc((top.operator_name || '?').trim().charAt(0))}</div>
        <div class="wheel-winner-main">
          <div class="wheel-winner-name">${esc(top.operator_name)}</div>
          ${top.reason ? `<div class="wheel-winner-reason">Причина допуска: ${esc(top.reason)}</div>` : ''}
        </div>
        <div class="wheel-winner-prize">${prizeText(top)}</div>
      </div>
      ${rest.length ? `<div class="wheel-winner-list">
        <div class="wheel-winner-list-title">Сегодня крутили колесо:</div>
        ${rest.slice(0, 6).map(w => `<div class="wheel-winner-row">
          <span class="wheel-winner-row-icon">${WHEEL_PRIZE_ICON[w.prize_type] || '★'}</span>
          <span class="wheel-winner-row-name">${esc(w.operator_name)}</span>
          <span class="wheel-winner-row-prize">${prizeText(w)}</span>
        </div>`).join('')}
      </div>` : ''}
    </div>`;
}

// Карточка «Колесо WOW» на главной панели оператора (ТЗ п.2). Грузится
// асинхронно, чтобы не задерживать рендер кабинета; ошибки скрывают карточку.
async function renderCabinetWheelCard() {
  const host = document.getElementById('cabinet-wheel-card');
  if (!host) return;
  let status;
  try {
    status = await api.getWheelStatus();
  } catch {
    host.innerHTML = '';
    return;
  }
  if (!status || !status.campaign) { host.innerHTML = ''; return; }

  const tickets = status.available_tickets || 0;
  const canSpin = status.can_spin;
  const reason = status.next_ticket_reason;
  const lp = status.last_prize;

  if (tickets > 0) {
    host.innerHTML = `
      <div class="panel wheel-cabinet-card wheel-cabinet-have">
        <div class="wheel-cabinet-main">
          <div class="wheel-cabinet-kicker">🎡 Колесо WOW</div>
          <div class="wheel-cabinet-title">Доступно вращений: <b>${tickets}</b></div>
          ${reason ? `<div class="wheel-cabinet-sub">Получено за: ${esc(reason)}</div>` : ''}
          ${!canSpin && status.reason_if_cannot_spin ? `<div class="wheel-cabinet-sub muted">${esc(status.reason_if_cannot_spin)}</div>` : ''}
        </div>
        <button class="btn-primary" onclick="navigateTo('wheel')">Крутить колесо</button>
      </div>`;
  } else {
    host.innerHTML = `
      <div class="panel wheel-cabinet-card wheel-cabinet-none">
        <div class="wheel-cabinet-main">
          <div class="wheel-cabinet-kicker">🎡 Колесо WOW</div>
          <div class="wheel-cabinet-title">Сегодня вращений нет</div>
          <div class="wheel-cabinet-sub muted">Чтобы получить попытку: пройди тест дня на 80%+, закрой день без опозданий, держи качество 90+.</div>
          ${lp ? `<div class="wheel-cabinet-sub">Последний приз: ${esc(lp.title)}</div>` : ''}
        </div>
        <button class="btn-outline" onclick="navigateTo('wheel')">Открыть колесо</button>
      </div>`;
  }
}

async function reloadCabinet() {
  STATE.wallet = await swrFetch('wallet:me', () => api.myWallet(), null, SWR_FAST_TTL_MS).catch(() => STATE.wallet);
  STATE.myLevel = await api.myLevel().catch(() => STATE.myLevel);
  STATE.myOperator = await api.myOperator().catch(() => STATE.myOperator);
  setText('side-level', STATE.myLevel?.level?.name || '—');
  const ratingResp = await api.getRating().catch(() => ({ items: STATE.rating }));
  STATE.rating = Array.isArray(ratingResp) ? ratingResp : (ratingResp.items || []);
  STATE.cabinetData = null;
  renderCabinet();
}

function showChangePasswordModal() {
  showModal(`
    <h3 class="modal-title">Сменить пароль</h3>
    <div class="form-group">
      <label class="form-label">Текущий пароль</label>
      <input id="cp-current" class="form-input" type="password" placeholder="Введите текущий пароль">
    </div>
    <div class="form-group">
      <label class="form-label">Новый пароль</label>
      <input id="cp-new" class="form-input" type="password" placeholder="Минимум 8 символов">
    </div>
    <div class="form-group">
      <label class="form-label">Повтор нового пароля</label>
      <input id="cp-confirm" class="form-input" type="password" placeholder="Повторите пароль">
    </div>
    <div id="cp-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitLegacyChangePassword()">Сохранить</button>`);
}

async function submitLegacyChangePassword() {
  const current = document.getElementById('cp-current')?.value;
  const newPwd  = document.getElementById('cp-new')?.value;
  const confirm = document.getElementById('cp-confirm')?.value;
  const err     = document.getElementById('cp-err');
  if (!current || !newPwd || !confirm) { err.textContent='Заполните все поля'; err.className='status-line status-error'; return; }
  if (newPwd.length < 8) { err.textContent='Пароль должен содержать минимум 8 символов'; err.className='status-line status-error'; return; }
  if (newPwd !== confirm) { err.textContent='Пароли не совпадают'; err.className='status-line status-error'; return; }
  try {
    await api.changeOperatorPassword({current_password:current, new_password:newPwd, confirm_password:confirm});
    closeModal(); showToast('Пароль успешно изменён', 'ok');
  } catch(e) { err.textContent=e.message; err.className='status-line status-error'; }
}

function showChangeUsernameModal() {
  showModal(`
    <h3 class="modal-title">Сменить логин</h3>
    <div class="form-group">
      <label class="form-label">Текущий логин</label>
      <input class="form-input" value="${esc(STATE.user?.username||'')}" disabled style="opacity:.5">
    </div>
    <div class="form-group">
      <label class="form-label">Новый логин</label>
      <input id="cu-new" class="form-input" placeholder="Только латиница, цифры и _">
    </div>
    <div id="cu-err" class="status-line"></div>
    <button class="btn-primary" style="width:100%;margin-top:4px" onclick="submitChangeUsername()">Сохранить</button>`);
}

async function submitChangeUsername() {
  const newUsername = document.getElementById('cu-new')?.value?.trim();
  const err = document.getElementById('cu-err');
  if (!newUsername) { err.textContent='Введите новый логин'; err.className='status-line status-error'; return; }
  try {
    const data = await api.changeOperatorUsername({new_username: newUsername});
    closeModal(); showToast('Логин успешно изменён', 'ok');
    STATE.user.username = newUsername;
    setText('side-user', STATE.user.full_name);
  } catch(e) { err.textContent=e.message; err.className='status-line status-error'; }
}

/* ══════════════════════════════════════
   VIEW: РЕЙТИНГ
══════════════════════════════════════ */
