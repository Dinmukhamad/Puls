/* Выделено из 30-admin-coins-groups-operators.view.js (3110 строк).
   Ставки операторов и управление нормами часов. */

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
  const canDelete = STATE.user?.role === 'admin';

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
            ${canDelete ? `<button class="btn-icon btn-ghost danger" onclick="deleteNorm(${n.id})" title="Отключить">✕</button>` : ''}
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
  if (STATE.user?.role !== 'admin') return showToast('Отключать нормы может только администратор', 'error');
  const confirmed = await uiConfirmAction({
    title: 'Отключить норму часов?',
    description: 'Норма перестанет использоваться в новых расчётах. Вы уверены, что хотите продолжить?',
    confirmLabel: 'Отключить',
  });
  if (!confirmed) return;
  try {
    await api._req('DELETE', `/api/work-norms/${normId}`);
    showToast('Норма отключена', 'ok');
    const norms = await api._req('GET', '/api/work-norms');
    renderWorkNormsModal(norms);
  } catch(e) { showToast(e.message, 'error'); }
}
