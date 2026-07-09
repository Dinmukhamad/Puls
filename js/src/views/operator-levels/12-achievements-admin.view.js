/* ══════════════════════════════════════
   УРОВНИ: вкладка «Достижения» (ТЗ §7) — каталог, включение/выключение, ручная выдача
══════════════════════════════════════ */

async function renderAchievementsAdminTab(el) {
  if (!el) return;
  el.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка достижений…</p></div>';

  let achievements;
  try {
    achievements = await api.listAchievements();
  } catch (e) {
    el.innerHTML = `<div class="empty-line">Ошибка загрузки: ${esc(e.message)}</div>`;
    return;
  }
  STATE._achievementsCatalog = achievements;

  if (!STATE.adminOperators.length) {
    try { STATE.adminOperators = await api.getDashboardOperators(); } catch { /* форма выдачи покажет пустой список */ }
  }

  const conditionLabel = {
    top_3_week: 'Топ-3 недели', no_late_streak: 'Без опозданий N недель подряд',
    quality_threshold: 'Качество ≥ значения', calls_leader_week: 'Лучший по звонкам за неделю',
    efficiency_leader_week: 'Лучший по эффективности за неделю', total_coins: 'Всего начислено коинов ≥ значения',
    manual: 'Только ручная выдача', test_score: 'Результат теста ≥ значения (%)',
  };

  el.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Каталог достижений</h3>
        <span class="panel-badge">${achievements.length}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th></th><th>Название</th><th>Условие</th><th>Награда</th><th>Повторяемое</th><th>Активно</th><th></th>
          </tr></thead>
          <tbody>
            ${achievements.map(a => `
              <tr>
                <td style="font-size:20px">${esc(a.icon || '🏆')}</td>
                <td>
                  <div class="name-cell">${esc(a.title)}</div>
                  <div class="cell-muted" style="font-size:11px">${esc(a.description)}</div>
                </td>
                <td style="font-size:12px">${esc(conditionLabel[a.condition_type] || a.condition_type)}${a.condition_value > 0 ? ` (${levelNum(a.condition_value)})` : ''}</td>
                <td>
                  <input type="number" class="form-input" style="width:80px" id="ach-reward-${a.id}" value="${a.reward_coins}" min="0" step="1">
                  <button class="btn-link" style="font-size:11px" onclick="saveAchievementReward(${a.id})">Сохранить</button>
                </td>
                <td>${a.is_repeatable ? 'Да' : 'Нет'}</td>
                <td>
                  <label class="an-checkbox-label">
                    <input type="checkbox" ${a.is_active ? 'checked' : ''} onchange="toggleAchievementActive(${a.id}, this.checked)">
                  </label>
                </td>
                <td><button class="btn-outline btn-sm" onclick="openGrantAchievementForm(${a.id})">Выдать вручную</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div id="grant-achievement-host"></div>`;
}

async function toggleAchievementActive(id, isActive) {
  try {
    await api.updateAchievement(id, { is_active: isActive });
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
    showToast('Награда обновлена', 'ok');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function openGrantAchievementForm(achievementId) {
  const host = document.getElementById('grant-achievement-host');
  if (!host) return;
  const a = (STATE._achievementsCatalog || []).find(x => x.id === achievementId);
  const ops = (STATE.adminOperators || []).slice().sort((x, y) => (x.full_name || '').localeCompare(y.full_name || ''));

  host.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Выдать «${esc(a?.title || '')}» вручную</h3>
        <button class="btn-link" onclick="document.getElementById('grant-achievement-host').innerHTML=''">Закрыть</button>
      </div>
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
      <button class="btn-primary" onclick="submitGrantAchievement(${achievementId})">Выдать достижение</button>
    </div>`;
}

async function submitGrantAchievement(achievementId) {
  const operatorId = Number(document.getElementById('grant-ach-operator')?.value);
  const comment = document.getElementById('grant-ach-comment')?.value || '';
  if (!operatorId) { showToast('Выберите оператора', 'error'); return; }
  try {
    await api.grantAchievement(achievementId, { operator_id: operatorId, comment });
    showToast('Достижение выдано', 'ok');
    document.getElementById('grant-achievement-host').innerHTML = '';
  } catch (e) {
    showToast(e.message, 'error');
  }
}
