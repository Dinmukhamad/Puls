/* Выделено из 30-admin-coins-groups-operators.view.js (3110 строк).
   Операторы: редактирование, сброс пароля, увольнение, восстановление, история. */

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
  if (STATE.user?.role !== 'admin') return showToast('Удалять операторов может только администратор', 'error');
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
