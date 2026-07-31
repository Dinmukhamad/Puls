/* Управленческая «Сводка»: компактный экран, не дублирующий подробные вкладки Analytics. */
let _summaryManagement = { start: '', end: '', group: '', preset: 'week', ready: false };

function summaryPresetDates(preset) {
  const end = new Date(); const start = new Date(end);
  start.setDate(end.getDate() - (preset === 'day' ? 0 : preset === 'month' ? 29 : 6));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function summaryDelta(value, lowerIsBetter = false) {
  if (value == null) return '<span class="summary-delta is-neutral">Нет сравнения</span>';
  const improved = lowerIsBetter ? value < 0 : value > 0;
  return `<span class="summary-delta ${improved ? 'is-positive' : value === 0 ? 'is-neutral' : 'is-negative'}">${value > 0 ? '+' : ''}${fmtA(value, 1)} к прошлому периоду</span>`;
}

async function renderManagementSummary() {
  const el = document.getElementById('view-summary');
  if (!el) return;
  const navGeneration = STATE.navGen;
  if (!_summaryManagement.ready) Object.assign(_summaryManagement, summaryPresetDates('week'), { ready: true });
  const state = _summaryManagement;
  el.innerHTML = `
    <div class="view-header summary-management-header"><div><div class="section-kicker">Сводка</div><h2 class="section-title">Управленческий дашборд</h2><p class="section-subtitle">Состояние команды, изменения и точки внимания.</p></div><div class="summary-updated" id="summary-updated">Обновляем данные…</div></div>
    <section class="summary-filter-panel" aria-label="Фильтры сводки">
      <div class="summary-period-switch">${[['day','День'],['week','Неделя'],['month','Месяц'],['custom','Диапазон']].map(([key,label]) => `<button type="button" data-summary-preset="${key}" class="${state.preset === key ? 'active' : ''}">${label}</button>`).join('')}</div>
      <label><span>С</span><input id="summary-start" type="date" class="form-input" value="${state.start}"></label>
      <label><span>По</span><input id="summary-end" type="date" class="form-input" value="${state.end}"></label>
      <label><span>Группа</span><select id="summary-group" class="form-select"><option value="">Все группы</option></select></label>
      <button class="btn-outline btn-sm" id="summary-reset">Сбросить</button><button class="btn-outline btn-sm" id="summary-export">Excel</button><button class="btn-primary btn-sm" id="summary-refresh">Обновить</button>
    </section><div id="summary-warning"></div><div id="summary-management-content"><div class="summary-skeleton-grid">${'<i></i>'.repeat(4)}</div></div>`;
  const groupSelect = el.querySelector('#summary-group');
  try {
    const groups = await analyticsFetch('groups-list', {});
    if (isNavStale(navGeneration)) return;
    groupSelect.innerHTML += (groups.items || []).map(group => `<option value="${group.id}" ${String(group.id) === state.group ? 'selected' : ''}>${esc(group.name)}</option>`).join('');
  } catch { /* необязательный фильтр */ }

  function readFilters() {
    state.start = el.querySelector('#summary-start').value; state.end = el.querySelector('#summary-end').value;
    state.group = groupSelect.value; state.preset = 'custom';
  }

  async function load() {
    const content = el.querySelector('#summary-management-content'); const warning = el.querySelector('#summary-warning'); const button = el.querySelector('#summary-refresh');
    if (!state.start || !state.end || state.start > state.end) { warning.innerHTML = '<div class="an-availability-note an-availability-note-error">Проверьте выбранный диапазон дат.</div>'; return; }
    button.disabled = true; button.textContent = 'Обновляем…';
    try {
      const params = { start_date: state.start, end_date: state.end }; if (state.group) params.group_id = state.group;
      const data = await analyticsFetch('management-dashboard', params);
      if (isNavStale(navGeneration)) return;
      const health = data.team_health || {}; const metrics = data.metric_cards || []; const groups = data.groups || []; const priorities = data.priority_operators || [];
      warning.innerHTML = data.data_availability_warning ? `<div class="an-availability-note">${esc(data.data_availability_warning)}</div>` : '';
      el.querySelector('#summary-updated').textContent = `Обновлено: ${new Date().toLocaleString('ru-RU')}`;
      content.innerHTML = `<section class="summary-health-strip an-status-${esc(health.status || 'no_data')}"><div><span>Состояние команды</span><strong>${health.score || 0}<small>/100 · ${analyticsStatusLabel(health.status)}</small></strong></div><p>${health.attention_count ? `${health.attention_count} оператор(ов) требуют внимания, критично — ${health.critical_count || 0}.` : 'Отклонений по доступным данным не обнаружено.'}</p><div class="summary-coverage"><b>${health.operators_with_data || 0}</b><span>учтено</span><b>${Math.max(0, (health.operators_count || 0) - (health.operators_with_data || 0))}</b><span>без данных</span></div></section>
        <section class="summary-management-kpis">${metrics.map(metric => `<article class="summary-management-kpi an-status-${esc(metric.status)}" title="${esc(metric.definition || '')}"><div><span>${esc(metric.label)}</span><b>${analyticsStatusLabel(metric.status)}</b></div><strong>${analyticsMetricValue(metric.value, metric.unit)}</strong><small>Цель: ${analyticsMetricValue(metric.target, metric.unit)} · выборка: ${metric.operators_with_data || 0}</small>${summaryDelta(metric.change, metric.key === 'penalty')}</article>`).join('')}</section>
        <section class="summary-management-grid"><article class="an-exec-section"><div class="an-exec-section-head"><div><span>Группы</span><small>Сначала группы с риском</small></div><button onclick="navigateTo('analytics',{tab:'groups'})">Подробнее</button></div><div class="an-group-health-list">${groups.slice(0,5).map(group => `<div class="an-group-health-row an-status-${esc(group.status)}"><div class="an-group-health-name"><i></i><div><strong>${esc(group.group_name)}</strong><small>${group.operators_count} оператор(ов), данные ${group.coverage_percent}%</small></div></div><div class="an-group-health-meter"><span><i style="width:${group.health_score}%"></i></span><b>${group.health_score}/100</b></div><div class="an-group-health-risk"><strong>${group.operators_in_risk}</strong><span>требуют внимания</span></div></div>`).join('') || '<div class="empty-line">Нет данных по группам</div>'}</div></article>
        <article class="an-exec-section"><div class="an-exec-section-head"><div><span>Требуют внимания</span><small>Главные приоритеты периода</small></div><button onclick="navigateTo('analytics',{tab:'operators'})">Все операторы</button></div><div class="summary-attention-compact">${priorities.slice(0,5).map(item => `<div><span class="summary-v2-status ${item.status === 'critical' ? 'is-danger' : 'is-warning'}"></span><span><strong title="${esc(item.full_name)}">${esc(item.full_name)}</strong><small>${esc(item.recommendation)}</small></span><b>${item.health_score}</b></div>`).join('') || '<div class="empty-line">Все доступные показатели в норме</div>'}</div></article></section>`;
    } catch {
      content.innerHTML = '<div class="an-exec-section an-error-state"><strong>Не удалось загрузить сводку</strong><p>Проверьте период и повторите попытку.</p><button class="btn-outline btn-sm" id="summary-retry">Повторить</button></div>';
      content.querySelector('#summary-retry')?.addEventListener('click', load);
    } finally { button.disabled = false; button.textContent = 'Обновить'; }
  }

  el.querySelectorAll('[data-summary-preset]').forEach(button => button.addEventListener('click', () => { state.preset = button.dataset.summaryPreset; if (state.preset !== 'custom') Object.assign(state, summaryPresetDates(state.preset)); renderManagementSummary(); }));
  el.querySelector('#summary-refresh').addEventListener('click', () => { readFilters(); load(); });
  el.querySelector('#summary-reset').addEventListener('click', () => { Object.assign(state, summaryPresetDates('week'), { group: '', preset: 'week' }); renderManagementSummary(); });
  el.querySelector('#summary-export').addEventListener('click', () => { readFilters(); const params = new URLSearchParams({ start_date: state.start, end_date: state.end }); if (state.group) params.set('group_id', state.group); window.location.href = api._base() + '/api/analytics/export.xlsx?' + params; });
  await load();
}
