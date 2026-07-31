let _operatorLevelsTabRenderVersion = 0;

async function renderOperatorLevelsSettings() {
  const el = document.getElementById('view-operator-levels');
  if (!el) return;
  if (!(STATE.user?.role === 'manager' || STATE.user?.role === 'admin')) {
    el.innerHTML = '<div class="empty-state"><p>Недостаточно прав</p></div>';
    return;
  }

  const tab = STATE.opLevelsTab === 'achievements' ? 'achievements' : 'levels';
  el.innerHTML = `
    <div class="levels-page-head">
      <div>
        <div class="section-kicker">Развитие команды</div>
        <h2 class="section-title">Уровни операторов</h2>
        <p>Настройте путь роста, требования к каждому этапу и награды за повышение.</p>
      </div>
      <div class="header-right level-header-actions" ${tab === 'levels' ? '' : 'hidden'}>
        <button type="button" class="btn-outline btn-sm" onclick="recalculateOperatorLevelsUi(this)">Пересчитать уровни</button>
        <button type="button" class="btn-primary btn-sm" onclick="showCreateOperatorLevelPrompt()">+ Добавить уровень</button>
      </div>
    </div>
    <div class="levels-page-tabs" role="tablist" aria-label="Разделы развития операторов">
      <button id="op-levels-tab-levels" class="levels-page-tab ${tab === 'levels' ? 'is-active' : ''}" data-op-levels-tab="levels" role="tab" aria-controls="op-levels-tab-body" aria-selected="${tab === 'levels'}" tabindex="${tab === 'levels' ? '0' : '-1'}">
        <span>Уровни</span><small>Этапы роста и условия</small>
      </button>
      <button id="op-levels-tab-achievements" class="levels-page-tab ${tab === 'achievements' ? 'is-active' : ''}" data-op-levels-tab="achievements" role="tab" aria-controls="op-levels-tab-body" aria-selected="${tab === 'achievements'}" tabindex="${tab === 'achievements' ? '0' : '-1'}">
        <span>Достижения</span><small>Награды за отдельные результаты</small>
      </button>
    </div>
    <div id="op-levels-tab-body" role="tabpanel" tabindex="0" aria-labelledby="op-levels-tab-${tab}"></div>`;
  const tabButtons = [...el.querySelectorAll('[data-op-levels-tab]')];
  tabButtons.forEach((btn, index) => {
    btn.addEventListener('click', () => {
      if (STATE.opLevelsTab === btn.dataset.opLevelsTab) return;
      STATE.opLevelsTab = btn.dataset.opLevelsTab;
      renderOperatorLevelsSettings();
    });
    btn.addEventListener('keydown', event => {
      let nextIndex = null;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabButtons.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabButtons.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      const nextButton = tabButtons[nextIndex];
      nextButton.click();
      requestAnimationFrame(() => document.getElementById(`op-levels-tab-${nextButton.dataset.opLevelsTab}`)?.focus());
    });
  });
  const bodyEl = el.querySelector('#op-levels-tab-body');
  if (tab === 'achievements') { renderAchievementsAdminTab(bodyEl); return; }
  return renderLevelsTabContent(bodyEl);
}

async function renderLevelsTabContent(el) {
  if (!el) return;
  const renderVersion = ++_operatorLevelsTabRenderVersion;
  el.setAttribute('aria-busy', 'true');
  el.innerHTML = '<div class="panel level-settings-shell"><div class="loading-state" role="status"><div class="loading-spinner"></div><p>Загрузка уровней…</p></div></div>';

  let levels = [];
  try {
    levels = await withTimeout(swrFetch('levels:admin', () => api.listAdminOperatorLevels(), null, SWR_STATIC_TTL_MS), 15000, 'Уровни не загрузились: сервер не ответил за 15 секунд');
  } catch (adminErr) {
    try {
      levels = await withTimeout(swrFetch('levels:list', () => api.listOperatorLevels(), null, SWR_STATIC_TTL_MS), 15000, 'Уровни не загрузились: сервер не ответил за 15 секунд');
    } catch (publicErr) {
      if (renderVersion !== _operatorLevelsTabRenderVersion || document.getElementById('op-levels-tab-body') !== el) return;
      el.removeAttribute('aria-busy');
      const message = typeof uiErrorMessage === 'function'
        ? uiErrorMessage(publicErr || adminErr, 'Не удалось загрузить уровни')
        : 'Не удалось загрузить уровни';
      el.innerHTML = `<div class="status-line status-error" role="alert">${esc(message)}</div>
        <button class="btn-outline btn-sm" onclick="renderOperatorLevelsSettings()">Попробовать снова</button>`;
      return;
    }
  }
  if (renderVersion !== _operatorLevelsTabRenderVersion || document.getElementById('op-levels-tab-body') !== el) return;
  STATE.operatorLevels = levels;
  const canDeleteLevels = STATE.user?.role === 'admin';
  const rewardsData = await withTimeout(swrFetch('levels:rewards', () => api.listOperatorLevelRewards(), null, SWR_FAST_TTL_MS), 10000)
    .catch(() => ({ items: [] }));
  if (renderVersion !== _operatorLevelsTabRenderVersion || document.getElementById('op-levels-tab-body') !== el) return;
  el.removeAttribute('aria-busy');
  const rewardRows = Array.isArray(rewardsData) ? rewardsData : (rewardsData.items || []);

  function ruleText(rule) {
    if (rule.condition_text) return rule.condition_text;
    const metricLabel = {
      tenure_days: 'Стаж', quality: 'Качество', kvz: 'КВЗ', efficiency: 'Эффективность',
      penalty_minutes: 'Штрафы', final_points: 'Итоговые баллы', test_percent: 'Тесты', total_xp: 'XP',
    }[rule.metric_code] || rule.metric_code;
    if (rule.operator === 'between') return `${metricLabel}: от ${levelNum(rule.value_min)} до ${levelNum(rule.value_max)}`;
    if (rule.operator === 'gte') return `${metricLabel}: не ниже ${levelNum(rule.value_min)}`;
    if (rule.operator === 'lte') return `${metricLabel}: не выше ${levelNum(rule.value_max)}`;
    return `${metricLabel}: равно ${levelNum(rule.value_min)}`;
  }

  function rewardStatus(row) {
    if (!row.reward_coins) return '<span class="status-pill muted">Без бонуса</span>';
    if (row.reward_received) return '<span class="status-pill ok">Получен</span>';
    return '<span class="status-pill warn">Ожидает повышения</span>';
  }

  function coinAmount(value, prefix = '') {
    const amount = Number(value || 0);
    const mod100 = Math.abs(amount) % 100;
    const mod10 = mod100 % 10;
    const word = mod100 >= 11 && mod100 <= 14 ? 'коинов' : mod10 === 1 ? 'коин' : mod10 >= 2 && mod10 <= 4 ? 'коина' : 'коинов';
    return `${prefix}${amount} ${word}`;
  }

  const activeLevels = levels.filter(level => level.is_active).length;
  const rewardsConfigured = levels.filter(level => Number(level.reward_coins) > 0).length;
  el.innerHTML = `<div class="levels-overview-grid">
    <div class="levels-overview-card"><span>Этапов роста</span><strong>${levels.length}</strong><small>${activeLevels} используются в расчёте</small></div>
    <div class="levels-overview-card"><span>Условий перехода</span><strong>${levels.reduce((sum, level) => sum + (level.rules_count ?? level.rules?.length ?? 0), 0)}</strong><small>проверяются автоматически</small></div>
    <div class="levels-overview-card"><span>Награды настроены</span><strong>${rewardsConfigured}</strong><small>разовый бонус при повышении</small></div>
  </div>
  <div class="levels-explainer">
    <strong>Как работает система уровней</strong>
    <span>Этапы идут сверху вниз. Оператор получает самый высокий активный уровень, для которого выполнены все обязательные условия.</span>
  </div>
  <div class="level-progression-list">
    ${levels.map((level, index) => `<article class="level-progression-card ${level.is_active ? '' : 'is-disabled'}">
      <div class="level-stage-rail">
        <span style="--level-color:${esc(level.color || '#64748B')}">${level.stage_number || index + 1}</span>
        ${index < levels.length - 1 ? '<i></i>' : ''}
      </div>
      <div class="level-progression-content">
        <header class="level-card-head">
          <div class="level-card-title">
            <div class="level-card-eyebrow">Этап ${level.stage_number || index + 1}</div>
            <div class="level-card-name"><span class="level-color-dot" style="background:${esc(level.color || '#64748B')}"></span><h3>${esc(level.name)}</h3>${levelBadgeHtml(level)}</div>
            <p>${esc(level.description || 'Добавьте короткое описание роли этого уровня в системе развития.')}</p>
          </div>
          <div class="level-card-controls">
            <span class="status-pill ${level.is_active ? 'ok' : 'muted'}">${level.is_active ? 'Участвует в расчёте' : 'Отключён'}</span>
            <button class="btn-outline btn-sm" onclick="editOperatorLevelUi(${level.id})">Редактировать</button>
            ${canDeleteLevels ? `<button class="btn-outline btn-sm ${level.is_active ? 'danger' : ''}" onclick="toggleOperatorLevelUi(${level.id}, ${!level.is_active})">${level.is_active ? 'Отключить' : 'Включить'}</button>` : ''}
          </div>
        </header>
        <div class="level-card-body">
          <section class="level-conditions-block">
            <div class="level-block-head"><div><span>Условия получения уровня</span><small>Нужно выполнить все обязательные условия</small></div><button class="btn-outline btn-sm" onclick="addOperatorLevelRuleUi(${level.id})">+ Добавить условие</button></div>
            <div class="level-condition-list">
              ${(level.rules || []).length ? level.rules.map(rule => `<div class="level-condition-row">
                <span class="level-condition-check">✓</span>
                <div><strong>${esc(rule.metric_label || ruleText(rule).split(':')[0])}</strong><span>${esc(ruleText(rule))}</span></div>
                ${canDeleteLevels ? `<button type="button" onclick="deleteOperatorLevelRuleUi(${rule.id})" aria-label="Удалить условие" title="Удалить условие">×</button>` : ''}
              </div>`).join('') : '<div class="level-condition-empty">Условия пока не настроены. Без условий уровень доступен всем операторам.</div>'}
            </div>
          </section>
          <aside class="level-reward-block ${level.reward_coins ? 'has-reward' : ''}">
            <span>Награда за повышение</span>
            <strong>${level.reward_coins ? coinAmount(level.reward_coins, '+') : 'Без награды'}</strong>
            <small>${level.reward_coins ? 'Начисляется один раз при первом переходе на этот уровень.' : 'Можно добавить разовый бонус в настройках уровня.'}</small>
          </aside>
        </div>
      </div>
    </article>`).join('')}
  </div>
  <div class="panel level-settings-shell" style="margin-top:18px">
    <div class="level-settings-head">
      <div>
        <h3>Текущие уровни операторов</h3>
        <p>Кто находится на каждом этапе и была ли начислена награда за последнее повышение.</p>
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
            <th class="num">Награда</th>
            <th>Состояние награды</th>
          </tr>
        </thead>
        <tbody>
          ${rewardRows.length ? rewardRows.map(row => `<tr>
            <td class="name-cell">${esc(row.operator_name)}</td>
            <td>${esc(row.group_name || '—')}</td>
            <td>${levelBadgeHtml(row.level)}</td>
            <td class="num">${levelNum(row.tenure_days, 0)} дн.</td>
            <td class="num">${row.reward_coins ? coinAmount(row.reward_coins, '+') : '—'}</td>
            <td>${rewardStatus(row)}</td>
          </tr>`).join('') : '<tr><td colspan="6" class="empty-line">Нет данных</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}

async function recalculateOperatorLevelsUi(button) {
  if (STATE._operatorLevelsRecalculating || button?.disabled) return;
  STATE._operatorLevelsRecalculating = true;
  if (button) uiSetBusy(button, true, 'Пересчитываем…');
  try {
    const res = await api.recalculateOperatorLevels({ mode: 'all' });
    swrInvalidate('levels:');
    showToast(`Пересчитано: ${res.processed}, изменено: ${res.updated}`, 'ok');
    swrInvalidate('rating:list');
    await reloadData();
  } catch(e) {
    showToast(typeof uiErrorMessage === 'function' ? uiErrorMessage(e, 'Не удалось пересчитать уровни') : 'Не удалось пересчитать уровни', 'error');
  } finally {
    STATE._operatorLevelsRecalculating = false;
    if (button?.isConnected) uiSetBusy(button, false);
  }
}

function showCreateOperatorLevelPrompt() {
  showOperatorLevelForm();
}

function editOperatorLevelUi(levelId) {
  const level = (STATE.operatorLevels || []).find(l => l.id === levelId);
  if (!level) return;
  showOperatorLevelForm(level);
}

function showOperatorLevelForm(level = null) {
  const isEdit = Boolean(level);
  showModal(`
    <h3 class="modal-title">${isEdit ? 'Изменить уровень' : 'Добавить уровень'}</h3>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label" for="lvl-name">Название</label>
        <input id="lvl-name" class="form-input" value="${esc(level?.name || '')}" maxlength="100" required aria-describedby="lvl-form-error" placeholder="Например: Профи">
      </div>
      <div class="form-group">
        <label class="form-label" for="lvl-code">Код</label>
        <input id="lvl-code" class="form-input" value="${esc(level?.code || '')}" ${isEdit ? 'disabled' : 'required'} maxlength="50" pattern="[a-z0-9_-]+" aria-describedby="lvl-code-hint lvl-form-error" placeholder="pro">
        <div id="lvl-code-hint" class="form-hint">Латинские буквы, цифры, дефис и подчёркивание.</div>
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label" for="lvl-color">Цвет бейджа</label>
        <input id="lvl-color" class="form-input" value="${esc(level?.color || '#64748B')}" pattern="#[0-9A-Fa-f]{6}" aria-describedby="lvl-color-hint lvl-form-error" placeholder="#64748B">
        <div id="lvl-color-hint" class="form-hint">HEX-цвет в формате #64748B.</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="lvl-reward-coins">Награда за повышение</label>
        <input id="lvl-reward-coins" class="form-input" type="number" min="0" step="1" value="${esc(level?.reward_coins ?? 0)}" aria-describedby="lvl-reward-hint lvl-form-error">
        <div id="lvl-reward-hint" class="form-hint">Количество коинов, которое оператор получит один раз при первом переходе.</div>
      </div>
    </div>
    <input id="lvl-order" type="hidden" value="${esc(level?.sort_order ?? ((STATE.operatorLevels.length + 1) * 10))}">
    <input id="lvl-min-xp" type="hidden" value="${esc(level?.min_total_xp ?? 0)}">
    <div class="form-group">
      <label class="form-label" for="lvl-description">Описание</label>
      <textarea id="lvl-description" class="form-input" rows="3" maxlength="500" placeholder="Короткое описание уровня">${esc(level?.description || '')}</textarea>
    </div>
    <div id="lvl-form-error" class="status-line" role="alert" aria-live="polite"></div>
    <button type="button" class="btn-primary" style="width:100%;margin-top:8px" onclick="submitOperatorLevelForm(${isEdit ? level.id : 'null'}, this)">${isEdit ? 'Сохранить' : 'Создать'}</button>
  `);
}

async function submitOperatorLevelForm(levelId, button) {
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
    document.getElementById(!name ? 'lvl-name' : 'lvl-code')?.focus();
    return;
  }
  if (!levelId && !/^[a-z0-9_-]+$/.test(code)) {
    if (err) { err.textContent = 'Код может содержать только латинские буквы, цифры, дефис и подчёркивание'; err.className = 'status-line status-error'; }
    document.getElementById('lvl-code')?.focus();
    return;
  }
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    if (err) { err.textContent = 'Укажите цвет в формате #64748B'; err.className = 'status-line status-error'; }
    document.getElementById('lvl-color')?.focus();
    return;
  }
  if (!Number.isInteger(reward_coins) || reward_coins < 0) {
    if (err) { err.textContent = 'Награда должна быть целым неотрицательным числом'; err.className = 'status-line status-error'; }
    document.getElementById('lvl-reward-coins')?.focus();
    return;
  }
  if (button?.disabled) return;
  if (button) uiSetBusy(button, true);
  try {
    const payload = { name, color, description, sort_order, min_total_xp, reward_coins, reward_once: true };
    if (levelId) await api.updateOperatorLevel(levelId, payload);
    else await api.createOperatorLevel({ code, icon: '', is_active: true, ...payload });
    swrInvalidate('levels:');
    closeModal();
    await renderOperatorLevelsSettings();
  } catch(e) {
    if (err) {
      err.textContent = typeof uiErrorMessage === 'function'
        ? uiErrorMessage(e, 'Не удалось сохранить уровень')
        : 'Не удалось сохранить уровень';
      err.className = 'status-line status-error';
    }
    if (button?.isConnected) uiSetBusy(button, false);
  }
}

function addOperatorLevelRuleUi(levelId) {
  const level = (STATE.operatorLevels || []).find(l => l.id === levelId);
  showModal(`
    <h3 class="modal-title">Добавить показатель</h3>
    <div class="status-line" style="padding:0;color:var(--text-secondary)">Уровень: <b>${esc(level?.name || '')}</b></div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label" for="rule-metric">Показатель</label>
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
        <label class="form-label" for="rule-operator">Условие</label>
        <select id="rule-operator" class="form-select" onchange="syncOperatorLevelRuleFields()">
          <option value="gte">Больше или равно</option>
          <option value="lte">Меньше или равно</option>
          <option value="eq">Равно</option>
          <option value="between">Между</option>
        </select>
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label" for="rule-min">Минимум / значение</label>
        <input id="rule-min" class="form-input" type="number" step="0.01" value="0" aria-describedby="rule-form-error">
      </div>
      <div class="form-group">
        <label class="form-label" for="rule-max">Максимум</label>
        <input id="rule-max" class="form-input" type="number" step="0.01" aria-describedby="rule-form-error" placeholder="Для lte / between">
      </div>
    </div>
    <div id="rule-form-error" class="status-line" role="alert" aria-live="polite"></div>
    <button type="button" class="btn-primary" style="width:100%;margin-top:8px" onclick="submitOperatorLevelRuleForm(${levelId}, this)">Добавить</button>
  `);
  syncOperatorLevelRuleFields();
}

function syncOperatorLevelRuleFields() {
  const operator = document.getElementById('rule-operator')?.value || 'gte';
  const minInput = document.getElementById('rule-min');
  const maxInput = document.getElementById('rule-max');
  if (minInput) minInput.disabled = operator === 'lte';
  if (maxInput) maxInput.disabled = operator === 'gte' || operator === 'eq';
}

async function submitOperatorLevelRuleForm(levelId, button) {
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
  if ((operator === 'gte' || operator === 'eq' || operator === 'between') && (payload.value_min === null || !Number.isFinite(payload.value_min))) {
    const err = document.getElementById('rule-form-error');
    if (err) { err.textContent = 'Укажите значение'; err.className = 'status-line status-error'; }
    document.getElementById('rule-min')?.focus();
    return;
  }
  if ((operator === 'lte' || operator === 'between') && (payload.value_max === null || !Number.isFinite(payload.value_max))) {
    const err = document.getElementById('rule-form-error');
    if (err) { err.textContent = 'Укажите максимум'; err.className = 'status-line status-error'; }
    document.getElementById('rule-max')?.focus();
    return;
  }
  if (operator === 'between' && payload.value_min > payload.value_max) {
    const err = document.getElementById('rule-form-error');
    if (err) { err.textContent = 'Минимум не может быть больше максимума'; err.className = 'status-line status-error'; }
    document.getElementById('rule-min')?.focus();
    return;
  }
  if (button?.disabled) return;
  if (button) uiSetBusy(button, true, 'Добавляем…');
  try {
    await api.addOperatorLevelRule(levelId, payload);
    swrInvalidate('levels:');
    closeModal();
    await renderOperatorLevelsSettings();
  } catch(e) {
    const err = document.getElementById('rule-form-error');
    if (err) {
      err.textContent = typeof uiErrorMessage === 'function'
        ? uiErrorMessage(e, 'Не удалось добавить условие')
        : 'Не удалось добавить условие';
      err.className = 'status-line status-error';
    }
    if (button?.isConnected) uiSetBusy(button, false);
  }
}

async function deleteOperatorLevelRuleUi(ruleId) {
  if (STATE.user?.role !== 'admin') return showToast('Удалять условия может только администратор', 'error');
  const confirmed = await uiConfirmAction({
    title: 'Удалить условие уровня?',
    description: 'Условие перестанет учитываться при расчёте уровня. Это действие нельзя отменить.',
    confirmLabel: 'Удалить',
  });
  if (!confirmed) return;
  try {
    await api.deleteOperatorLevelRule(ruleId);
    swrInvalidate('levels:');
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function disableOperatorLevelUi(levelId) {
  if (STATE.user?.role !== 'admin') return showToast('Отключать уровни может только администратор', 'error');
  const confirmed = await uiConfirmAction({
    title: 'Отключить уровень?',
    description: 'Уровень перестанет назначаться операторам. Вы уверены, что хотите продолжить?',
    confirmLabel: 'Отключить',
  });
  if (!confirmed) return;
  try {
    await api.deleteOperatorLevel(levelId);
    swrInvalidate('levels:');
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function toggleOperatorLevelUi(levelId, isActive) {
  if (STATE.user?.role !== 'admin') return showToast('Включать и отключать уровни может только администратор', 'error');
  const verb = isActive ? 'включить' : 'отключить';
  const confirmed = await uiConfirmAction({
    title: `${verb.charAt(0).toUpperCase() + verb.slice(1)} уровень?`,
    description: isActive
      ? 'Уровень снова будет участвовать в автоматическом расчёте.'
      : 'Уровень перестанет назначаться операторам. Текущая история сохранится.',
    confirmLabel: isActive ? 'Включить' : 'Отключить',
    danger: !isActive,
  });
  if (!confirmed) return;
  try {
    await api.updateOperatorLevel(levelId, { is_active: isActive });
    swrInvalidate('levels:');
    await renderOperatorLevelsSettings();
  } catch(e) { showToast(e.message, 'error'); }
}

async function manualOperatorLevelUi(operatorId) {
  const op = (STATE.adminOperators || []).find(o => o.id === operatorId);
  const levels = STATE.operatorLevels?.length ? STATE.operatorLevels : await api.listOperatorLevels().catch(() => []);
  const activeLevels = levels.filter(l => l.is_active);
  if (!activeLevels.length) { showToast('Нет активных уровней', 'error'); return; }
  showModal(`
    <h3 class="modal-title">Изменить уровень оператора</h3>
    <p class="form-hint">Оператор: <b>${esc(op?.full_name || 'Оператор')}</b></p>
    <div class="form-group">
      <label class="form-label" for="manual-level-id">Новый уровень</label>
      <select id="manual-level-id" class="form-select" required aria-describedby="manual-level-error">
        ${activeLevels.map(level => `<option value="${level.id}">${esc(level.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label" for="manual-level-reason">Причина изменения</label>
      <input id="manual-level-reason" class="form-input" maxlength="300" required aria-describedby="manual-level-error" placeholder="Например: решение руководителя">
    </div>
    <div class="form-group">
      <label class="form-label" for="manual-level-comment">Комментарий <span class="optional">(необязательно)</span></label>
      <textarea id="manual-level-comment" class="form-input" rows="3" maxlength="1000"></textarea>
    </div>
    <div id="manual-level-error" class="status-line" role="alert" aria-live="polite"></div>
    <div class="modal-actions">
      <button type="button" class="btn-outline" onclick="closeModal()">Отмена</button>
      <button type="button" class="btn-primary" onclick="submitManualOperatorLevelUi(${operatorId}, this)">Изменить уровень</button>
    </div>`);
}

async function submitManualOperatorLevelUi(operatorId, button) {
  const levelId = Number(document.getElementById('manual-level-id')?.value);
  const reasonInput = document.getElementById('manual-level-reason');
  const reason = reasonInput?.value.trim() || '';
  const comment = document.getElementById('manual-level-comment')?.value.trim() || '';
  const error = document.getElementById('manual-level-error');
  if (!levelId || !reason) {
    if (error) error.textContent = !levelId ? 'Выберите уровень' : 'Укажите причину изменения';
    (!levelId ? document.getElementById('manual-level-id') : reasonInput)?.focus();
    return;
  }
  if (button?.disabled) return;
  if (button) uiSetBusy(button, true, 'Изменяем…');
  try {
    await api.manualOperatorLevel(operatorId, { level_id: levelId, reason, comment });
    swrInvalidate('levels:');
    showToast('Уровень изменён', 'ok');
    swrInvalidate('rating:list');
    closeModal();
    await reloadData();
  } catch(e) {
    if (error) {
      error.textContent = typeof uiErrorMessage === 'function'
        ? uiErrorMessage(e, 'Не удалось изменить уровень')
        : 'Не удалось изменить уровень';
    }
    if (button?.isConnected) uiSetBusy(button, false);
  }
}

/* Cabinet data helpers live here; the single visual renderer is the v3
   implementation in rating/99-operator-cabinet-rating-redesign.view.js. */

function cabinetSessionKey() {
  const user = STATE.user;
  if (!user) return '';
  return [user.id ?? '', user.operator_id ?? '', user.username ?? '', user.role ?? ''].join(':');
}

function cabinetSnapshotForCurrentUser() {
  const ownerKey = cabinetSessionKey();
  if (!ownerKey) {
    STATE.cabinetSnapshot = null;
    STATE.cabinetData = null;
    return null;
  }
  if (STATE._cabinetSnapshotOwner && STATE._cabinetSnapshotOwner !== ownerKey) {
    swrInvalidate('cabinet:me');
    STATE.cabinetSnapshot = null;
    STATE.cabinetData = null;
    STATE.cabinetError = null;
    STATE.cabinetFetchedAt = null;
    STATE._cabinetSnapshotOwner = ownerKey;
    return null;
  }
  if (!STATE._cabinetSnapshotOwner) STATE._cabinetSnapshotOwner = ownerKey;
  return STATE.cabinetSnapshot;
}

function syncCabinetSnapshot(snapshot, ownerKey = cabinetSessionKey()) {
  if (!snapshot || !ownerKey || ownerKey !== cabinetSessionKey()) return false;
  const wallet = snapshot.wallet || {};
  const transactions = snapshot.recent_transactions || [];
  STATE._cabinetSnapshotOwner = ownerKey;
  STATE.cabinetSnapshot = snapshot;
  STATE.cabinetData = snapshot;
  STATE.cabinetFetchedAt = snapshot.generated_at || new Date().toISOString();
  STATE.myLevel = snapshot.level || STATE.myLevel;
  STATE.myOperator = snapshot.operator || STATE.myOperator;
  STATE.wallet = {
    operator_id: snapshot.operator?.id,
    current_balance: wallet.balance || 0,
    total_earned: wallet.total_earned || 0,
    total_spent: wallet.total_spent || 0,
    transactions: transactions.map(t => ({ ...t, created_at: t.created_at || t.date })),
  };
  STATE.rating = snapshot.top_week || STATE.rating || [];
  if (snapshot.level?.level) setText('side-level', snapshot.level.level.name || '—');
  return true;
}

async function loadCabinetSnapshot(force = false) {
  const ownerKey = cabinetSessionKey();
  if (!ownerKey) throw new Error('Сессия завершена. Войдите снова.');

  const ownerChanged = STATE._cabinetSnapshotOwner && STATE._cabinetSnapshotOwner !== ownerKey;
  if (force || ownerChanged) {
    swrInvalidate('cabinet:me');
    STATE.cabinetSnapshot = null;
    STATE.cabinetData = null;
    STATE.cabinetError = null;
  }
  if (cabinetSnapshotForCurrentUser() && !force) return STATE.cabinetSnapshot;
  if (STATE._cabinetSnapshotPromise && STATE._cabinetSnapshotPromiseOwner === ownerKey && !force) {
    return STATE._cabinetSnapshotPromise;
  }

  const requestVersion = Number(STATE._cabinetRequestVersion || 0) + 1;
  STATE._cabinetRequestVersion = requestVersion;
  STATE._cabinetSnapshotOwner = ownerKey;
  STATE._cabinetSnapshotPromiseOwner = ownerKey;
  const request = withTimeout(
    swrFetch('cabinet:me', () => (api.getMyCabinetV2 ? api.getMyCabinetV2() : api.getMyCabinet()), null, SWR_FAST_TTL_MS),
    12000,
    'Кабинет не загрузился: сервер не ответил за 12 секунд'
  ).then(data => {
    if (STATE._cabinetRequestVersion === requestVersion && cabinetSessionKey() === ownerKey) {
      syncCabinetSnapshot(data, ownerKey);
      STATE.cabinetError = null;
    }
    return data;
  }).catch(err => {
    if (STATE._cabinetRequestVersion === requestVersion && cabinetSessionKey() === ownerKey) {
      STATE.cabinetError = typeof uiErrorMessage === 'function'
        ? uiErrorMessage(err, 'Не удалось загрузить кабинет')
        : 'Не удалось загрузить кабинет';
    }
    throw err;
  }).finally(() => {
    if (STATE._cabinetSnapshotPromise === request) {
      STATE._cabinetSnapshotPromise = null;
      STATE._cabinetSnapshotPromiseOwner = null;
    }
  });
  STATE._cabinetSnapshotPromise = request;
  return request;
}

function cabinetLoadingHtml() {
  return `
    <div class="view-header">
      <div><div class="section-kicker">Кабинет</div><h2 class="section-title">Мой кабинет</h2></div>
    </div>
    <div class="cabinet-skeleton-grid">
      <div class="cabinet-skeleton wide"></div>
      <div class="cabinet-skeleton"></div>
      <div class="cabinet-skeleton"></div>
    </div>`;
}

async function reloadCabinet() {
  const ownerKey = cabinetSessionKey();
  if (!ownerKey || (STATE.cabinetLoading && STATE._cabinetLoadingOwner === ownerKey)) return;
  const navToken = STATE.navGen;
  STATE._cabinetLoadingOwner = ownerKey;
  STATE.cabinetLoading = true;
  if (STATE.currentView === 'cabinet') renderCabinet();
  try {
    await loadCabinetSnapshot(true);
    if (cabinetSessionKey() === ownerKey) showToast('Кабинет обновлён', 'ok');
  } catch(e) {
    if (cabinetSessionKey() === ownerKey) {
      const message = typeof uiErrorMessage === 'function'
        ? uiErrorMessage(e, 'Не удалось обновить кабинет')
        : 'Не удалось обновить кабинет';
      showToast(message, 'error');
    }
  } finally {
    if (STATE._cabinetLoadingOwner === ownerKey) {
      STATE.cabinetLoading = false;
      STATE._cabinetLoadingOwner = null;
    }
    if (cabinetSessionKey() === ownerKey && STATE.currentView === 'cabinet' && !isNavStale(navToken)) {
      renderCabinet();
    }
  }
}

function showChangePasswordModal() {
  showModal(`
    <h3 class="modal-title">Сменить пароль</h3>
    <div class="form-group">
      <label class="form-label" for="cp-current">Текущий пароль</label>
      <input id="cp-current" class="form-input" type="password" autocomplete="current-password" required aria-describedby="cp-err" placeholder="Введите текущий пароль">
    </div>
    <div class="form-group">
      <label class="form-label" for="cp-new">Новый пароль</label>
      <input id="cp-new" class="form-input" type="password" autocomplete="new-password" minlength="8" required aria-describedby="cp-err" placeholder="Минимум 8 символов">
    </div>
    <div class="form-group">
      <label class="form-label" for="cp-confirm">Повтор нового пароля</label>
      <input id="cp-confirm" class="form-input" type="password" autocomplete="new-password" minlength="8" required aria-describedby="cp-err" placeholder="Повторите пароль">
    </div>
    <div id="cp-err" class="status-line" role="alert" aria-live="polite"></div>
    <button type="button" class="btn-primary" style="width:100%;margin-top:4px" onclick="submitLegacyChangePassword(this)">Сохранить</button>`);
}

async function submitLegacyChangePassword(button) {
  const current = document.getElementById('cp-current')?.value;
  const newPwd  = document.getElementById('cp-new')?.value;
  const confirm = document.getElementById('cp-confirm')?.value;
  const err     = document.getElementById('cp-err');
  if (!current || !newPwd || !confirm) {
    if (err) { err.textContent='Заполните все поля'; err.className='status-line status-error'; }
    document.getElementById(!current ? 'cp-current' : !newPwd ? 'cp-new' : 'cp-confirm')?.focus();
    return;
  }
  if (newPwd.length < 8) { if (err) { err.textContent='Пароль должен содержать минимум 8 символов'; err.className='status-line status-error'; } document.getElementById('cp-new')?.focus(); return; }
  if (newPwd !== confirm) { if (err) { err.textContent='Пароли не совпадают'; err.className='status-line status-error'; } document.getElementById('cp-confirm')?.focus(); return; }
  if (button?.disabled) return;
  if (button) uiSetBusy(button, true);
  try {
    await api.changeOperatorPassword({current_password:current, new_password:newPwd, confirm_password:confirm});
    closeModal();
    showToast('Пароль изменён. Войдите снова.', 'ok');
    setTimeout(() => logoutAndReload(), 700);
  } catch(e) {
    if (err) {
      err.textContent = typeof uiErrorMessage === 'function' ? uiErrorMessage(e, 'Не удалось изменить пароль') : 'Не удалось изменить пароль';
      err.className='status-line status-error';
    }
    if (button?.isConnected) uiSetBusy(button, false);
  }
}

function showChangeUsernameModal() {
  showModal(`
    <h3 class="modal-title">Сменить логин</h3>
    <div class="form-group">
      <label class="form-label" for="cu-current">Текущий логин</label>
      <input id="cu-current" class="form-input" value="${esc(STATE.user?.username||'')}" disabled>
    </div>
    <div class="form-group">
      <label class="form-label" for="cu-new">Новый логин</label>
      <input id="cu-new" class="form-input" minlength="3" maxlength="120" pattern="[A-Za-z0-9._]+" autocomplete="username" required aria-describedby="cu-login-hint cu-err" placeholder="Только латиница, цифры, точка и _">
      <div id="cu-login-hint" class="form-hint">От 3 до 120 символов: латиница, цифры, точка и подчёркивание.</div>
    </div>
    <div class="form-group">
      <label class="form-label" for="cu-password">Текущий пароль</label>
      <input id="cu-password" class="form-input" type="password" autocomplete="current-password" required aria-describedby="cu-err">
    </div>
    <div id="cu-err" class="status-line" role="alert" aria-live="polite"></div>
    <button type="button" class="btn-primary" style="width:100%;margin-top:4px" onclick="submitChangeUsername(this)">Сохранить</button>`);
}

async function submitChangeUsername(button) {
  const newUsername = document.getElementById('cu-new')?.value?.trim();
  const currentPassword = document.getElementById('cu-password')?.value || '';
  const err = document.getElementById('cu-err');
  if (!newUsername || !currentPassword) {
    if (err) { err.textContent='Введите новый логин и текущий пароль'; err.className='status-line status-error'; }
    document.getElementById(!newUsername ? 'cu-new' : 'cu-password')?.focus();
    return;
  }
  if (!/^[A-Za-z0-9._]{3,120}$/.test(newUsername)) {
    if (err) { err.textContent='Логин: 3–120 символов, только латиница, цифры, точка и _'; err.className='status-line status-error'; }
    document.getElementById('cu-new')?.focus();
    return;
  }
  if (button?.disabled) return;
  if (button) uiSetBusy(button, true);
  try {
    await api.changeOperatorUsername({new_username: newUsername, current_password: currentPassword});
    closeModal();
    showToast('Логин изменён. Войдите снова.', 'ok');
    setTimeout(() => logoutAndReload(), 700);
  } catch(e) {
    if (err) {
      err.textContent = typeof uiErrorMessage === 'function' ? uiErrorMessage(e, 'Не удалось изменить логин') : 'Не удалось изменить логин';
      err.className='status-line status-error';
    }
    if (button?.isConnected) uiSetBusy(button, false);
  }
}

/* ══════════════════════════════════════
   VIEW: РЕЙТИНГ
══════════════════════════════════════ */
