/* ══════════════════════════════════════
   УРОВНИ: вкладка «Достижения» (ТЗ §7) — каталог, включение/выключение, ручная выдача
══════════════════════════════════════ */

function achievementVisualIcon(achievement, extraClass = '') {
  const key = achievement?.code || achievement?.condition_type || 'achievement';
  const paths = {
    top_3_week: '<circle cx="12" cy="8" r="5"/><path d="M8.6 12.5 7 22l5-3 5 3-1.6-9.5"/><path d="m9.8 8 1.4 1.4L14.5 6"/>',
    no_late_3_weeks: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/><path d="M5.8 3.5 3.5 5.8M18.2 3.5l2.3 2.3"/>',
    no_late_streak: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/><path d="M5.8 3.5 3.5 5.8M18.2 3.5l2.3 2.3"/>',
    quality_star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    quality_threshold: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    calls_master: '<path d="M7.2 3.8 4.8 5.6c-1.1.9-.9 3.2.5 5.8 1.8 3.3 4.1 5.6 7.4 7.3 2.6 1.4 4.9 1.6 5.8.5l1.7-2.3-4.6-3.2-2 2c-2.3-1.1-4.2-3-5.3-5.3l2-2Z"/>',
    calls_leader_week: '<path d="M7.2 3.8 4.8 5.6c-1.1.9-.9 3.2.5 5.8 1.8 3.3 4.1 5.6 7.4 7.3 2.6 1.4 4.9 1.6 5.8.5l1.7-2.3-4.6-3.2-2 2c-2.3-1.1-4.2-3-5.3-5.3l2-2Z"/>',
    efficiency_top: '<path d="m13 2-8 12h7l-1 8 8-12h-7Z"/>',
    efficiency_leader_week: '<path d="m13 2-8 12h7l-1 8 8-12h-7Z"/>',
    legend_team: '<path d="m3 6 4.5 4L12 4l4.5 6L21 6l-2 11H5Z"/><path d="M5 20h14"/>',
    total_coins: '<path d="m3 6 4.5 4L12 4l4.5 6L21 6l-2 11H5Z"/><path d="M5 20h14"/>',
    helper: '<path d="M16 11.5c1.8 0 3.5-1.6 3.5-3.5S18 4.5 16 4.5c-1.2 0-2.3.6-3 1.5-.7-.9-1.8-1.5-3-1.5C8 4.5 6.5 6 6.5 8c0 1.9 1.7 3.5 3.5 3.5"/><path d="M3 14h4l2 2h6l2-2h4"/><path d="M5 14v5h14v-5"/>',
    manual: '<path d="M16 11.5c1.8 0 3.5-1.6 3.5-3.5S18 4.5 16 4.5c-1.2 0-2.3.6-3 1.5-.7-.9-1.8-1.5-3-1.5C8 4.5 6.5 6 6.5 8c0 1.9 1.7 3.5 3.5 3.5"/><path d="M3 14h4l2 2h6l2-2h4"/><path d="M5 14v5h14v-5"/>',
    test_master: '<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23Z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5A3.5 3.5 0 0 1 20 23Z"/>',
    test_score: '<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23Z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5A3.5 3.5 0 0 1 20 23Z"/>',
  };
  return `<svg class="achievement-system-icon ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key] || '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>'}</svg>`;
}

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
    <div class="achievements-catalog-head">
      <div>
        <div class="an-card-head">Каталог достижений</div>
        <p>Управляйте условиями, наградами и доступностью достижений для операторов.</p>
      </div>
      <span class="panel-badge">${achievements.length}</span>
    </div>

    <div class="achievements-admin-grid">
      ${achievements.map(a => `
        <article class="achievement-admin-card ${a.is_active ? '' : 'is-inactive'}" data-achievement-id="${a.id}">
          <header class="achievement-admin-head">
            <span class="achievement-admin-icon">${achievementVisualIcon(a)}</span>
            <div class="achievement-admin-heading">
              <div class="achievement-admin-title">${esc(a.title)}</div>
              <div class="achievement-admin-desc">${esc(a.description)}</div>
            </div>
            <span class="achievement-admin-state ${a.is_active ? 'is-active' : ''}">${a.is_active ? 'Активно' : 'Выключено'}</span>
          </header>

          <div class="achievement-admin-rule">
            <span>Условие получения</span>
            <strong>${esc(conditionLabel(a))}</strong>
          </div>

          <div class="achievement-admin-meta">
            <span class="achievement-admin-tag ${a.is_repeatable ? 'repeatable' : ''}">${a.is_repeatable ? 'Можно получать повторно' : 'Выдаётся один раз'}</span>
          </div>

          <div class="achievement-admin-reward-row">
            <div class="achievement-admin-reward-label">
              <span>Награда</span>
              <strong>Коины за выполнение</strong>
            </div>
            <div class="achievement-admin-reward-control">
              <input type="number" class="form-input" id="ach-reward-${a.id}" value="${a.reward_coins}" min="0" step="1" aria-label="Награда за достижение">
              <span class="achievement-coin-unit">₡</span>
              <button class="btn-outline btn-sm" onclick="saveAchievementReward(${a.id}, this)">Сохранить</button>
            </div>
          </div>

          <footer class="achievement-admin-footer">
            <label class="achievement-admin-toggle-row">
              <span class="toggle-switch">
                <input type="checkbox" ${a.is_active ? 'checked' : ''} onchange="toggleAchievementActive(${a.id}, this.checked, this)">
                <span class="toggle-slider"></span>
              </span>
              <span>Доступно операторам</span>
            </label>
            <button class="btn-outline btn-sm" onclick="openGrantAchievementForm(${a.id})">Выдать вручную</button>
          </footer>
        </article>`).join('')}
    </div>`;
}

async function toggleAchievementActive(id, isActive, input) {
  try {
    await api.updateAchievement(id, { is_active: isActive });
    swrInvalidate('achievements:');
    showToast(isActive ? 'Достижение включено' : 'Достижение выключено', 'ok');
    const a = (STATE._achievementsCatalog || []).find(x => x.id === id);
    if (a) a.is_active = isActive;
    const card = input?.closest('.achievement-admin-card');
    card?.classList.toggle('is-inactive', !isActive);
    const state = card?.querySelector('.achievement-admin-state');
    if (state) {
      state.textContent = isActive ? 'Активно' : 'Выключено';
      state.classList.toggle('is-active', isActive);
    }
  } catch (e) {
    showToast(e.message, 'error');
    const body = document.getElementById('op-levels-tab-body');
    if (body) renderAchievementsAdminTab(body);
  }
}

async function saveAchievementReward(id, button) {
  const val = Number(document.getElementById(`ach-reward-${id}`)?.value);
  if (!Number.isFinite(val) || val < 0) return showToast('Укажите корректную награду', 'error');
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
  try {
    await api.updateAchievement(id, { reward_coins: val });
    swrInvalidate('achievements:');
    showToast('Награда обновлена', 'ok');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = original || 'Сохранить'; }
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
