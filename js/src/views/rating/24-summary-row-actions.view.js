/* ══════════════════════════════════════
   СВОДКА: быстрые действия по строке оператора (ТЗ §9.5)
   Начислить / Списать / Открыть кабинет / Открыть историю / Открыть заявки
══════════════════════════════════════ */

function summaryRowActionsHtml(operatorId, operatorName) {
  const nameAttr = esc(operatorName).replace(/'/g, '&#39;');
  return `
    <div class="row-actions-group">
      <button class="btn-icon-sm" title="Начислить коины" onclick="openManualCoinModal(${operatorId}, '${nameAttr}', 'credit')">+₡</button>
      <button class="btn-icon-sm" title="Списать коины" onclick="openManualCoinModal(${operatorId}, '${nameAttr}', 'debit')">−₡</button>
      <button class="btn-icon-sm" title="Открыть кабинет" onclick="openOperatorCabinetModal(${operatorId}, '${nameAttr}')">👤</button>
      <button class="btn-icon-sm" title="Открыть историю" onclick="openHistoryForOperator(${operatorId}, '${nameAttr}')">🕘</button>
      <button class="btn-icon-sm" title="Открыть заявки" onclick="openRequestsForOperator(${operatorId}, '${nameAttr}')">🛒</button>
    </div>`;
}

function openManualCoinModal(operatorId, operatorName, operation) {
  const isCredit = operation === 'credit';
  showModal(`
    <h3 class="modal-title">${isCredit ? 'Начислить коины' : 'Списать коины'} — ${esc(operatorName)}</h3>
    <div class="form-group">
      <label class="form-label">Количество коинов</label>
      <input id="mc-amount" class="form-input" type="number" min="1" step="1" placeholder="Например, 10">
    </div>
    <div class="form-group">
      <label class="form-label">Причина</label>
      <input id="mc-reason" class="form-input" type="text" placeholder="Например: помощь новичку">
    </div>
    <div class="form-group">
      <label class="form-label">Комментарий <span class="optional">(необязательно)</span></label>
      <input id="mc-comment" class="form-input" type="text">
    </div>
    <div id="mc-err" class="status-line"></div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" onclick="submitManualCoinModal(${operatorId}, '${operation}')">${isCredit ? 'Начислить' : 'Списать'}</button>
    </div>`);
}

async function submitManualCoinModal(operatorId, operation) {
  const errEl = document.getElementById('mc-err');
  const amount = Number(document.getElementById('mc-amount')?.value);
  const reason = document.getElementById('mc-reason')?.value?.trim();
  const comment = document.getElementById('mc-comment')?.value?.trim() || '';
  if (!amount || amount <= 0) { if (errEl) errEl.textContent = 'Укажите количество коинов больше нуля'; return; }
  if (!reason) { if (errEl) errEl.textContent = 'Укажите причину'; return; }

  try {
    await api.manualTransaction({
      operator_id: operatorId,
      amount: operation === 'debit' ? -amount : amount,
      reason, comment,
    });
    showToast(operation === 'debit' ? 'Коины списаны' : 'Коины начислены', 'ok');
    closeModal();
    STATE.dashboard = await api.getDashboard().catch(() => STATE.dashboard);
    if (typeof _loadAdminSummaryDetail === 'function') _loadAdminSummaryDetail();
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}

async function openOperatorCabinetModal(operatorId, operatorName) {
  showModal(`
    <h3 class="modal-title">Кабинет — ${esc(operatorName)}</h3>
    <div id="op-cabinet-modal-body"><div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div></div>`,
  );
  const body = document.getElementById('op-cabinet-modal-body');
  let data;
  try {
    data = await api.getOperatorCabinet(operatorId);
  } catch (e) {
    if (body) body.innerHTML = `<div class="empty-line">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  if (!body) return;

  const wm = data.week_metrics;
  const cc = data.coin_calculation;
  const ach = data.achievements || { completed: [], in_progress: [] };

  body.innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:16px">
      <div class="kpi-card"><div class="kpi-label">Баланс</div><div class="kpi-value">${data.wallet.balance} <span class="kpi-unit">₡</span></div></div>
      <div class="kpi-card"><div class="kpi-label">В резерве</div><div class="kpi-value">${data.wallet.reserved} <span class="kpi-unit">₡</span></div></div>
      <div class="kpi-card"><div class="kpi-label">За неделю</div><div class="kpi-value">${data.wallet.earned_this_week} <span class="kpi-unit">₡</span></div></div>
      <div class="kpi-card"><div class="kpi-label">Место в рейтинге</div><div class="kpi-value">${data.rating.place ?? '—'}${data.rating.total_participants ? ` <span class="kpi-unit">/ ${data.rating.total_participants}</span>` : ''}</div></div>
    </div>

    ${wm ? `
      <div class="coin-calc-row"><span>Качество</span><b>${levelNum(wm.quality)}%</b></div>
      <div class="coin-calc-row"><span>Эффективность</span><b>${levelNum(wm.efficiency)}%</b></div>
      <div class="coin-calc-row"><span>Опоздания / Нарушения</span><b style="color:${(wm.late_minutes||wm.violations)?'var(--danger)':'inherit'}">${wm.late_minutes ?? 0} / ${wm.violations ?? 0}</b></div>
    ` : '<div class="empty-line">Нет данных за последнюю неделю</div>'}

    ${cc ? `
      <div class="coin-calc-row coin-calc-total" style="margin-top:10px">
        <span>Расчёт за неделю (${cc.is_final ? 'начислено' : 'предварительно'})</span><b>${cc.total_week_coins} ₡</b>
      </div>` : ''}

    <div class="coin-rules-section-title">Достижения (${ach.completed.length})</div>
    <div class="achievements-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
      ${ach.completed.map(r => `
        <div class="achievement-badge unlocked" style="padding:8px">
          <div class="achievement-icon" style="font-size:18px">${esc(r.achievement.icon || '🏆')}</div>
          <div class="achievement-info"><div class="achievement-title" style="font-size:12px">${esc(r.achievement.title)}</div></div>
        </div>`).join('') || '<div class="empty-line">Пока нет полученных достижений</div>'}
    </div>

    <div class="modal-actions" style="margin-top:16px">
      <button class="btn-outline" onclick="closeModal()">Закрыть</button>
      <button class="btn-primary" onclick="closeModal(); openHistoryForOperator(${operatorId}, '${esc(operatorName).replace(/'/g, '&#39;')}')">Вся история →</button>
    </div>`;
}
