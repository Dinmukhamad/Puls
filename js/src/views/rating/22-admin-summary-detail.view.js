/* ══════════════════════════════════════
   СВОДКА: детальная сводка по неделе с фильтрами (ТЗ §9)
══════════════════════════════════════ */

const _adminSummaryState = { filters: {}, data: null, open: false };

function toggleAdminSummaryDetail() {
  const host = document.getElementById('admin-summary-extra');
  const button = document.getElementById('admin-summary-detail-toggle');
  if (!host) return;

  _adminSummaryState.open = !_adminSummaryState.open;
  if (!_adminSummaryState.open) {
    host.innerHTML = '';
    if (button) button.textContent = 'Расширенная выборка';
    return;
  }

  if (button) button.textContent = 'Скрыть выборку';
  renderAdminSummaryDetail();
}

function _disciplineCellHtml(o) {
  const late = o.lateness_count;
  const viol = o.violation_count;
  if (late == null && viol == null) return '<span class="cell-muted">—</span>';
  const badge = (value, label) => {
    const v = value ?? 0;
    const cls = v > 0 ? 'bonus-chip discipline-bad' : 'bonus-chip discipline-ok';
    return `<span class="${cls}" title="${esc(label)}">${label}: ${v}</span>`;
  };
  return `${badge(late, 'Опоздания')} ${badge(viol, 'Нарушения')}`;
}

function _metricsCellHtml(o) {
  if (o.quality == null && o.efficiency == null) return '<span class="cell-muted">—</span>';
  const parts = [];
  if (o.quality != null) parts.push(`Кач. ${levelNum(o.quality)}%`);
  if (o.efficiency != null) parts.push(`Эфф. ${levelNum(o.efficiency)}%`);
  return `<span style="font-size:12.5px">${parts.join(' · ')}</span>`;
}

async function renderAdminSummaryDetail() {
  const host = document.getElementById('admin-summary-extra');
  if (!host || !_adminSummaryState.open) return;
  host.innerHTML = uiLoadingBlock('Загрузка сводки за неделю');

  if (!STATE.groups.length) {
    try { STATE.groups = await swrFetch('groups:list', () => api.listGroups(false), null, SWR_STATIC_TTL_MS); } catch { /* фильтр по группе просто будет пуст */ }
  }

  await _loadAdminSummaryDetail();
}

async function _loadAdminSummaryDetail() {
  const host = document.getElementById('admin-summary-extra');
  if (!host || !_adminSummaryState.open) return;
  const f = _adminSummaryState.filters;
  const params = {};
  if (f.period_start) params.period_start = f.period_start;
  if (f.period_end) params.period_end = f.period_end;
  if (f.group_id) params.group_id = f.group_id;
  if (f.participation_status) params.participation_status = f.participation_status;
  if (f.position) params.position = f.position;
  if (f.has_lateness != null) params.has_lateness = f.has_lateness;
  if (f.has_violations != null) params.has_violations = f.has_violations;

  let data;
  try {
    data = await swrFetch(`admin-summary:${stableParamsKey(params)}`, () => api.getAdminSummary(params), fresh => {
      if (STATE.currentView === 'summary' && _adminSummaryState.open) {
        _adminSummaryState.data = fresh;
        _loadAdminSummaryDetail();
      }
    }, SWR_FAST_TTL_MS);
  } catch (e) {
    host.innerHTML = `<div class="empty-line">Ошибка загрузки сводки: ${esc(e.message)}</div>`;
    return;
  }
  _adminSummaryState.data = data;
  if (!f.period_start) _adminSummaryState.filters.period_start = data.period_start;
  if (!f.period_end) _adminSummaryState.filters.period_end = data.period_end;

  const groups = STATE.groups || [];

  host.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Детальная сводка за неделю</h3>
        ${data.period_start ? `<span class="panel-badge">${esc(data.period_start)} — ${esc(data.period_end)}</span>` : '<span class="panel-badge">Нет расчётов за неделю</span>'}
      </div>

      <div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:18px">
        <div class="kpi-card">
          <div class="kpi-label">Средняя позиция по группе</div>
          <div class="kpi-value">${data.average_team_rank ?? '—'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Коинов в обороте</div>
          <div class="kpi-value">${fmtCoins(data.total_coins_balance)}</div>
        </div>
        <div class="kpi-card ${data.new_shop_requests > 0 ? 'kpi-warn' : ''}">
          <div class="kpi-label">Новых заявок магазина</div>
          <div class="kpi-value">${data.new_shop_requests}</div>
        </div>
      </div>

      <div class="filter-row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:16px">
        <div class="form-group" style="margin:0">
          <label class="form-label">Начало периода</label>
          <input type="date" id="as-period-start" class="form-input" value="${esc(_adminSummaryState.filters.period_start || '')}">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Конец периода</label>
          <input type="date" id="as-period-end" class="form-input" value="${esc(_adminSummaryState.filters.period_end || '')}">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Группа</label>
          <select id="as-group" class="form-input">
            <option value="">Все группы</option>
            ${groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Участие</label>
          <select id="as-participation" class="form-input">
            <option value="">Все</option>
            <option value="participating">Участвует</option>
            <option value="not_participating">Не участвует</option>
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Должность</label>
          <select id="as-position" class="form-input">
            <option value="">Все</option>
            <option value="operator">Оператор</option>
            <option value="chat_manager">Чат-менеджер</option>
          </select>
        </div>
        <label class="an-checkbox-label"><input type="checkbox" id="as-has-lateness"> Есть опоздания</label>
        <label class="an-checkbox-label"><input type="checkbox" id="as-has-violations"> Есть нарушения</label>
        <button class="btn-primary btn-sm" onclick="applyAdminSummaryFilters()">Применить</button>
        <button class="btn-outline btn-sm" onclick="exportAdminSummary()">Экспорт CSV</button>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th scope="col">Место</th><th scope="col">ФИО</th><th scope="col">Группа</th><th scope="col">Статус</th>
            <th scope="col">Баллы недели</th><th scope="col">Коины недели</th><th scope="col">Баланс</th>
            <th scope="col">Дисциплина</th><th scope="col">Показатели</th><th scope="col">Действия</th>
          </tr></thead>
          <tbody>
            ${data.operators.length ? data.operators.map(o => `
              <tr>
                <td><span class="rank-badge ${(o.rank_place||99)<=3?'rank-top':''}">${o.rank_place ?? '—'}</span></td>
                <td class="name-cell">${esc(o.full_name)}</td>
                <td>${esc(o.group_name || '')}</td>
                <td>${o.participation_status === 'participating' ? 'Участвует' : 'Не участвует'}</td>
                <td>${o.week_points != null ? levelNum(o.week_points) : '—'}</td>
                <td>${o.week_coins != null ? `<b class="accent-text">${fmtCoins(o.week_coins)}</b>` : '—'}</td>
                <td>${fmtCoins(o.total_balance)}</td>
                <td>${_disciplineCellHtml(o)}</td>
                <td>${_metricsCellHtml(o)}</td>
                <td>${summaryRowActionsHtml(o.id, o.full_name)}</td>
              </tr>`).join('') : '<tr><td colspan="10" class="empty-line">Нет данных за выбранный период/фильтры</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  document.getElementById('as-group').value = f.group_id || '';
  document.getElementById('as-participation').value = f.participation_status || '';
  document.getElementById('as-position').value = f.position || '';
  document.getElementById('as-has-lateness').checked = f.has_lateness === true;
  document.getElementById('as-has-violations').checked = f.has_violations === true;
}

function applyAdminSummaryFilters() {
  const f = _adminSummaryState.filters;
  f.period_start = document.getElementById('as-period-start')?.value || '';
  f.period_end = document.getElementById('as-period-end')?.value || '';
  f.group_id = document.getElementById('as-group')?.value || '';
  f.participation_status = document.getElementById('as-participation')?.value || '';
  f.position = document.getElementById('as-position')?.value || '';
  const lateChecked = document.getElementById('as-has-lateness')?.checked;
  const violChecked = document.getElementById('as-has-violations')?.checked;
  f.has_lateness = lateChecked ? true : null;
  f.has_violations = violChecked ? true : null;
  _loadAdminSummaryDetail();
}

function exportAdminSummary() {
  const f = _adminSummaryState.filters;
  const params = { period_start: f.period_start, period_end: f.period_end, format: 'csv' };
  if (f.group_id) params.group_id = f.group_id;
  window.open(api.exportUrl('/api/exports/rating', params), '_blank');
}
