/* ══════════════════════════════════════
   УРОВНИ: вкладка «Достижения» (ТЗ §7) — каталог, включение/выключение, ручная выдача
══════════════════════════════════════ */

async function renderAchievementsAdminTab(el) {
  if (!el) return;
  el.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка достижений…</p></div>';

  let achievements;
  try {
    achievements = await swrFetch('achievements:list', () => api.listAchievements(), null, SWR_STATIC_TTL_MS);
  } catch (e) {
    el.innerHTML = `<div class="empty-line">Ошибка загрузки: ${esc(e.message)}</div>`;
    return;
  }
  STATE._achievementsCatalog = achievements;

  if (!STATE.adminOperators.length) {
    try { STATE.adminOperators = await swrFetch('dashboard:operators', () => api.getDashboardOperators(), null, SWR_USER_TTL_MS); } catch { /* форма выдачи покажет пустой список */ }
  }

  const conditionLabel = (a) => {
    const v = levelNum(a.condition_value);
    return {
      top_3_week: 'Топ-3 недели',
      no_late_streak: `${v} недели подряд без опозданий`,
      quality_threshold: `Качество ≥ ${v}%`,
      calls_leader_week: 'Лучший по звонкам за неделю',
      efficiency_leader_week: 'Лучший по эффективности за неделю',
      total_coins: `Всего начислено ≥ ${v} ₡`,
      manual: 'Только ручная выдача',
      test_score: `Результат теста ≥ ${v}%`,
    }[a.condition_type] || a.condition_type;
  };

  el.innerHTML = `
    <div class="an-card-head-row" style="margin-bottom:14px">
      <div class="an-card-head" style="margin-bottom:0">Каталог достижений</div>
      <span class="panel-badge">${achievements.length}</span>
    </div>

    <div class="achievements-admin-grid">
      ${achievements.map(a => `
        <div class="achievement-admin-card ${a.is_active ? '' : 'is-inactive'}">
          <div class="achievement-admin-head">
            <div class="achievement-admin-icon">${esc(a.icon || '🏆')}</div>
            <div>
              <div class="achievement-admin-title">${esc(a.title)}</div>
              <div class="achievement-admin-desc">${esc(a.description)}</div>
            </div>
          </div>

          <div class="achievement-admin-condition">${esc(conditionLabel(a))}</div>

          <div class="achievement-admin-tags">
            <span class="achievement-admin-tag ${a.is_repeatable ? 'repeatable' : ''}">${a.is_repeatable ? 'Повторяемое' : 'Одноразовое'}</span>
          </div>

          <div class="achievement-admin-reward-row">
            <label for="ach-reward-${a.id}">Награда</label>
            <input type="number" class="form-input" id="ach-reward-${a.id}" value="${a.reward_coins}" min="0" step="1">
            <span>₡</span>
            <button class="btn-link" onclick="saveAchievementReward(${a.id})">Сохранить</button>
          </div>

          <div class="achievement-admin-footer">
            <label class="toggle-switch" title="${a.is_active ? 'Активно' : 'Выключено'}">
              <input type="checkbox" ${a.is_active ? 'checked' : ''} onchange="toggleAchievementActive(${a.id}, this.checked)">
              <span class="toggle-slider"></span>
            </label>
            <button class="btn-outline btn-sm" onclick="openGrantAchievementForm(${a.id})">Выдать вручную</button>
          </div>
        </div>`).join('')}
    </div>`;
}

async function toggleAchievementActive(id, isActive) {
  try {
    await api.updateAchievement(id, { is_active: isActive });
    swrInvalidate('achievements:');
    showToast(isActive ? 'Достижение включено' : 'Достижение выключено', 'ok');
    const a = (STATE._achievementsCatalog || []).find(x => x.id === id);
    if (a) a.is_active = isActive;
  } catch (e) {
    showToast(e.message, 'error');
    const body = document.getElementById('op-levels-tab-body');
    if (body) renderAchievementsAdminTab(body);
  }
}

async function saveAchievementReward(id) {
  const val = Number(document.getElementById(`ach-reward-${id}`)?.value);
  try {
    await api.updateAchievement(id, { reward_coins: val });
    swrInvalidate('achievements:');
    showToast('Награда обновлена', 'ok');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function openGrantAchievementForm(achievementId) {
  const a = (STATE._achievementsCatalog || []).find(x => x.id === achievementId);
  const ops = (STATE.adminOperators || []).slice().sort((x, y) => (x.full_name || '').localeCompare(y.full_name || ''));

  showModal(`
    <h3 class="modal-title">Выдать «${esc(a?.title || '')}» вручную</h3>
    <div class="form-group">
      <label class="form-label">Оператор</label>
      <select id="grant-ach-operator" class="form-input">
        <option value="">Выберите оператора…</option>
        ${ops.map(o => `<option value="${o.id}">${esc(o.full_name)}${o.group_name ? ' — ' + esc(o.group_name) : ''}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Комментарий <span class="optional">(необязательно)</span></label>
      <input id="grant-ach-comment" class="form-input" type="text" placeholder="Например: помог новому сотруднику освоиться">
    </div>
    <div id="grant-ach-err" class="status-line"></div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" onclick="submitGrantAchievement(${achievementId})">Выдать достижение</button>
    </div>`);
}

async function submitGrantAchievement(achievementId) {
  const operatorId = Number(document.getElementById('grant-ach-operator')?.value);
  const comment = document.getElementById('grant-ach-comment')?.value || '';
  const errEl = document.getElementById('grant-ach-err');
  if (!operatorId) { if (errEl) errEl.textContent = 'Выберите оператора'; return; }
  try {
    await api.grantAchievement(achievementId, { operator_id: operatorId, comment });
    swrInvalidate('achievements:');
    swrInvalidate('coins:');
    swrInvalidate('rating:');
    showToast('Достижение выдано', 'ok');
    closeModal();
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}
