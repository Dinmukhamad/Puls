/* ══════════════════════════════════════
   КОИНЫ: Настройки начислений (ТЗ §4) — GET/PUT /api/settings/coin-rules
══════════════════════════════════════ */

function canEditCoinRules(role) { return role === 'manager' || role === 'admin'; }

const _NOMINATION_TOGGLES = [
  ['nomination_calls_enabled', 'Лучший по звонкам'],
  ['nomination_quality_enabled', 'Лучшее качество'],
  ['nomination_efficiency_enabled', 'Топ по эффективности'],
  ['nomination_progress_enabled', 'Лучший прогресс недели'],
  ['nomination_thanks_enabled', 'Больше всего благодарностей'],
];

async function renderCoinRulesSettingsTab(body) {
  body.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка настроек…</p></div>';
  let rules;
  try {
    rules = await api.getCoinRulesSettings();
  } catch (e) {
    body.innerHTML = `<div class="empty-line">Ошибка загрузки: ${esc(e.message)}</div>`;
    return;
  }
  const canEdit = canEditCoinRules(STATE.user?.role);

  const numField = (id, label, value, hint = '') => `
    <div class="coin-rules-field">
      <label for="cr-${id}">${esc(label)}</label>
      <input id="cr-${id}" class="form-input" type="number" step="1" value="${value}" ${canEdit ? '' : 'disabled'}>
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
    </div>`;

  body.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Настройки начислений</h3>
        ${!canEdit ? '<span class="panel-badge">Только просмотр</span>' : ''}
        ${rules.updated_by_name ? `<span class="cell-muted" style="font-size:11px">Изменено: ${esc(rules.updated_by_name)}</span>` : ''}
      </div>

      <div class="coin-rules-section-title">Курс перевода</div>
      <div class="coin-rules-form">
        ${numField('points_per_coin', 'Баллов за 1 коин', rules.points_per_coin, 'Например, 5 = 5 баллов конвертируются в 1 коин')}
        <div class="coin-rules-field">
          <label for="cr-rounding_mode">Округление</label>
          <select id="cr-rounding_mode" class="form-input" ${canEdit ? '' : 'disabled'}>
            ${['floor', 'ceil', 'round'].map(m => `<option value="${m}" ${rules.rounding_mode === m ? 'selected' : ''}>${{ floor: 'Вниз', ceil: 'Вверх', round: 'Округление' }[m]}</option>`).join('')}
          </select>
        </div>
        ${numField('min_points_for_accrual', 'Минимальный балл для начисления', rules.min_points_for_accrual)}
      </div>

      <div class="coin-rules-section-title">Бонусы за рейтинг недели</div>
      <div class="coin-rules-form">
        ${numField('top_1_bonus', '1 место', rules.top_1_bonus)}
        ${numField('top_2_bonus', '2 место', rules.top_2_bonus)}
        ${numField('top_3_bonus', '3 место', rules.top_3_bonus)}
      </div>

      <div class="coin-rules-section-title">Бонусы за дисциплину и признание</div>
      <div class="coin-rules-form">
        ${numField('no_late_bonus', 'Неделя без опозданий', rules.no_late_bonus)}
        ${numField('no_violation_bonus', 'Неделя без нарушений', rules.no_violation_bonus)}
        ${numField('nomination_bonus', 'Номинация недели (за каждую)', rules.nomination_bonus)}
        ${numField('driver_thanks_bonus', 'Благодарность от водителя', rules.driver_thanks_bonus)}
      </div>

      <div class="coin-rules-section-title">Включённые номинации</div>
      ${_NOMINATION_TOGGLES.map(([key, label]) => `
        <div class="coin-rules-toggle-row">
          <span>${esc(label)}</span>
          <label class="an-checkbox-label"><input type="checkbox" id="cr-${key}" ${rules[key] ? 'checked' : ''} ${canEdit ? '' : 'disabled'}></label>
        </div>`).join('')}

      <div class="coin-rules-section-title">Ограничения начисления</div>
      <div class="coin-rules-toggle-row">
        <span>Начислять уволенным операторам</span>
        <label class="an-checkbox-label"><input type="checkbox" id="cr-accrue_to_fired" ${rules.accrue_to_fired ? 'checked' : ''} ${canEdit ? '' : 'disabled'}></label>
      </div>
      <div class="coin-rules-toggle-row">
        <span>Начислять неучаствующим операторам</span>
        <label class="an-checkbox-label"><input type="checkbox" id="cr-accrue_to_inactive" ${rules.accrue_to_inactive ? 'checked' : ''} ${canEdit ? '' : 'disabled'}></label>
      </div>

      ${canEdit ? `
        <div class="panel-footer" style="margin-top:18px">
          <button class="btn-primary" onclick="saveCoinRulesSettings()">Сохранить настройки</button>
        </div>
        <div class="empty-line" style="margin-top:6px">Изменения применяются к следующему расчёту — старые начисления не пересчитываются.</div>
      ` : ''}
    </div>`;
}

async function saveCoinRulesSettings() {
  const val = id => Number(document.getElementById(`cr-${id}`)?.value);
  const checked = id => !!document.getElementById(`cr-${id}`)?.checked;

  const payload = {
    points_per_coin: val('points_per_coin'),
    rounding_mode: document.getElementById('cr-rounding_mode')?.value,
    min_points_for_accrual: val('min_points_for_accrual'),
    top_1_bonus: val('top_1_bonus'), top_2_bonus: val('top_2_bonus'), top_3_bonus: val('top_3_bonus'),
    no_late_bonus: val('no_late_bonus'), no_violation_bonus: val('no_violation_bonus'),
    nomination_bonus: val('nomination_bonus'), driver_thanks_bonus: val('driver_thanks_bonus'),
    accrue_to_fired: checked('accrue_to_fired'), accrue_to_inactive: checked('accrue_to_inactive'),
  };
  for (const [key] of _NOMINATION_TOGGLES) payload[key] = checked(key);

  try {
    await api.updateCoinRulesSettings(payload);
    showToast('Настройки начислений сохранены', 'ok');
  } catch (e) {
    showToast(e.message, 'error');
    return;
  }
  const body = document.getElementById('coins-tab-body');
  if (body) renderCoinRulesSettingsTab(body);
}
