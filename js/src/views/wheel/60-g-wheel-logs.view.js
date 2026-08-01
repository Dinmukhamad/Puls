/* Выделено из 60-wheel-tests.view.js (2603 строки).
   Вкладки журнала и ручной выдачи билетов. */

async function renderWheelLogsTab(body) {
  const data = await wheelCachedFetch(
    'wheel:admin:logs',
    () => api.getWheelEvaluationLogs({ limit: 80 }),
    { __fallback: true, items: [] },
    () => wheelRefreshIfTab('logs', renderWheelLogsTab, body)
  );
  if (data.__fallback) {
    body.innerHTML = wheelLoadingPanel('Загрузка логов');
    return;
  }
  const rows = data.items || [];
  const opLabel = { gte: '≥', lte: '≤', eq: '=', between: 'между', is_true: 'да' };
  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head"><h3>Логи проверки условий</h3><span class="panel-badge">${rows.length}</span></div>
      <div class="wheel-admin-content">
        ${rows.length ? `<div class="wheel-log-list">${rows.map(l => `<article class="wheel-log-row">
            <time>${esc(fmtDateTime(l.created_at))}</time>
            <div class="wheel-log-operator"><strong>${esc(l.operator_name)}</strong><span>${esc(wheelSourceLabel(l.source_module))}${l.source_entity_id ? ' · запись ' + l.source_entity_id : ''}</span></div>
            <div class="wheel-log-condition"><span>Значение: <b>${l.metric_value != null ? esc(String(l.metric_value)) : 'нет данных'}</b></span><span>Условие: <b>${l.threshold_value != null ? esc(opLabel[l.operator] || l.operator) + ' ' + esc(String(l.threshold_value)) : '—'}</b></span></div>
            <span class="badge ${l.is_eligible ? 'badge-ok' : 'badge-muted'}">${l.is_eligible ? 'Билет выдан' : 'Не выдан'}</span>
            <p>${esc(l.reason || 'Причина не указана')}</p>
          </article>`).join('')}</div>` : `<div class="empty-state wheel-empty">
          <p>Логов пока нет.</p>
          <p class="cell-muted" style="font-size:12px;max-width:480px;margin:6px auto 0">
            Запись появляется автоматически, когда оператор завершает тест или сохраняется расчёт периода —
            и только если для этого источника есть активное правило допуска (вкладка «Правила»)
            в активной кампании. Если ни один оператор ещё не завершал тест/расчёт периода после
            включения колеса — здесь и должно быть пусто.
          </p>
        </div>`}
      </div>
    </div>`;
}

let _wheelIssueSelected = [];

async function renderWheelIssueTab(body) {
  // Загружаем операторов для поиска (ТЗ п.4.2 — searchable dropdown)
  let operators = STATE.adminOperators;
  if (!operators || !operators.length) {
    operators = await wheelCachedFetch(
      'wheel:operators',
      () => api.listOperators().catch(() => []),
      [],
      (fresh) => {
        STATE.adminOperators = fresh || [];
        wheelRefreshIfTab('issue', renderWheelIssueTab, body);
      },
      SWR_USER_TTL_MS
    );
    STATE.adminOperators = operators;
  }
  const active = (operators || []).filter(o => o.is_active !== false);
  _wheelIssueSelected = _wheelIssueSelected.filter(sel => active.some(o => o.id === sel.id));

  body.innerHTML = `
    <div class="panel wheel-issue-panel">
      <div class="panel-head">
        <h3>Ручная выдача билетов</h3>
        <span class="panel-badge">Staff</span>
      </div>
      <div class="wheel-admin-content">
      <div class="wheel-issue-recipient">
        <label class="form-group">
          <span class="form-label">Получатели</span>
          <input type="text" id="wheel-op-search" class="form-input" placeholder="Найдите оператора по имени или группе" autocomplete="off">
          <div id="wheel-op-results" class="wheel-op-results" hidden></div>
        </label>
        <div id="wheel-op-chosen-list" class="wheel-op-chosen-list"></div>
      </div>
      <div class="form-grid wheel-issue-grid">
        <label class="form-group">
          <span class="form-label">Билетов оператору</span>
          <input type="number" id="wheel-qty" class="form-input" min="1" max="20" value="1">
        </label>
        <label class="form-group wheel-issue-reason">
          <span class="form-label">Причина выдачи</span>
          <input type="text" id="wheel-reason" class="form-input" placeholder="Например: помощь новому сотруднику" maxlength="500">
        </label>
        <label class="form-group">
          <span class="form-label">Действует, дней</span>
          <input type="number" id="wheel-ttl" class="form-input" min="1" max="30" value="3">
        </label>
        <div class="wheel-issue-actions">
          <button class="btn-primary" id="wheel-issue-btn" disabled>Выдать билеты</button>
        </div>
      </div>
      <div id="wheel-issue-status" class="status-line" style="margin-top:10px"></div>
      </div>
    </div>`;

  const search = document.getElementById('wheel-op-search');
  const results = document.getElementById('wheel-op-results');
  const chosenList = document.getElementById('wheel-op-chosen-list');
  const issueBtn = document.getElementById('wheel-issue-btn');

  function matches(o, q) {
    const hay = `${o.full_name || ''} ${o.group_name || o.group || ''}`.toLowerCase();
    return hay.includes(q);
  }
  function renderChosenList() {
    chosenList.innerHTML = _wheelIssueSelected.map(sel => `
      <span class="wheel-op-chip" data-chip-id="${sel.id}">${esc(sel.full_name)} <button type="button" aria-label="Убрать">×</button></span>
    `).join('');
    chosenList.querySelectorAll('[data-chip-id]').forEach(chip => {
      chip.querySelector('button').onclick = () => {
        const id = parseInt(chip.dataset.chipId, 10);
        _wheelIssueSelected = _wheelIssueSelected.filter(s => s.id !== id);
        renderChosenList();
        issueBtn.disabled = _wheelIssueSelected.length === 0;
      };
    });
  }
  renderChosenList();

  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { results.hidden = true; return; }
    const found = active.filter(o => matches(o, q) && !_wheelIssueSelected.some(s => s.id === o.id)).slice(0, 8);
    results.innerHTML = found.length
      ? found.map(o => `<div class="wheel-op-option" data-op-id="${o.id}" data-op-name="${esc(o.full_name)}">
          <strong>${esc(o.full_name)}</strong><span>${esc(o.group_name || o.group || '')}</span></div>`).join('')
      : '<div class="wheel-op-empty">Не найдено</div>';
    results.hidden = false;
    results.querySelectorAll('[data-op-id]').forEach(opt => {
      opt.onclick = () => {
        _wheelIssueSelected.push({ id: parseInt(opt.dataset.opId, 10), full_name: opt.dataset.opName });
        renderChosenList();
        results.hidden = true;
        search.value = '';
        issueBtn.disabled = false;
      };
    });
  };

  issueBtn.onclick = async () => {
    const reason = document.getElementById('wheel-reason').value.trim();
    const ttl = parseInt(document.getElementById('wheel-ttl').value, 10) || 3;
    const quantity = parseInt(document.getElementById('wheel-qty').value, 10) || 1;
    const statusEl = document.getElementById('wheel-issue-status');
    if (!_wheelIssueSelected.length) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Выберите хотя бы одного оператора'; return; }
    if (!reason) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Укажите причину'; return; }
    issueBtn.disabled = true;
    try {
      const res = await api.issueWheelTicketsBulk({
        operator_ids: _wheelIssueSelected.map(s => s.id),
        quantity, reason_text: reason, ttl_days: ttl,
      });
      swrInvalidate('wheel:');
      const failedNote = res.failed?.length ? ` Не удалось: ${res.failed.length} (см. подробности в консоли).` : '';
      if (res.failed?.length) console.warn('Wheel bulk issue failures:', res.failed);
      statusEl.className = res.issued_count > 0 ? 'status-line status-ok' : 'status-line status-error';
      statusEl.textContent = `Выдано билетов: ${res.issued_count}.${failedNote}`;
      showToast(`Выдано билетов: ${res.issued_count}`, res.issued_count > 0 ? 'ok' : 'error');
      document.getElementById('wheel-reason').value = '';
      _wheelIssueSelected = [];
      renderChosenList();
    } catch (err) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = err.message || 'Не удалось выдать билеты';
    } finally {
      issueBtn.disabled = _wheelIssueSelected.length === 0;
    }
  };
}
