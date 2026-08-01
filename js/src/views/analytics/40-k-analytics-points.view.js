/* Выделено из 40-reports-analytics.view.js (2671 строка).
   Вкладка «Баллы»: режимы отображения, формула, карточки, таблица, drawer. */

let _pointsViewMode = 'top10'; // top10 | all | growth | table
let _pointsData = null;

async function loadPointsTab(content) {
  content.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Считаем баллы…</p></div>';

  try {
    _pointsData = await analyticsFetch('points', analyticsOpParams());
  } catch(e) {
    content.innerHTML = `<div class="an-card"><div class="status-line status-error">${esc(e.message)}</div></div>`;
    return;
  }

  const d = _pointsData;
  if (!d.operators || !d.operators.length) {
    content.innerHTML = `<div class="an-card"><div class="an-empty-state">
      <div class="an-empty-icon">📊</div>
      <div class="an-empty-title">Нет данных по баллам за выбранный период</div>
      <div class="an-empty-sub">Загрузите файлы или измените период</div>
    </div></div>`;
    return;
  }

  content.innerHTML =
    renderPointsFormulaBlock() +
    renderPointsKpiBlock(d.summary) +
    renderPointsModeSwitcher() +
    `<div id="an-points-mode-content"></div>`;

  bindPointsFormulaToggle(content);
  bindPointsModeSwitcher();
  renderPointsModeContent(_pointsViewMode);
}

function renderPointsFormulaBlock() {
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Формула расчёта итоговых баллов</span>
      <button class="btn-link" id="an-formula-toggle" style="font-size:12px">Как считается? ▾</button>
    </div>
    <div class="an-formula-box">Итоговые баллы = Качество + КВЗ + Итог часов + Эффективность − Штрафные баллы</div>
    <div id="an-formula-detail" class="an-formula-detail" hidden>
      <div class="an-formula-row"><b>Качество</b> — средняя оценка звонков за выбранный период</div>
      <div class="an-formula-row"><b>КВЗ</b> — количество звонков ÷ база часов</div>
      <div class="an-formula-row"><b>Итог часов</b> — все отработанные часы за период</div>
      <div class="an-formula-row"><b>Эффективность</b> — часы в звонке ÷ база часов × 100</div>
      <div class="an-formula-row"><b>Штрафные баллы</b> — минуты штрафа × 5</div>
    </div>
  </div>`;
}

function bindPointsFormulaToggle(content) {
  content.querySelector('#an-formula-toggle')?.addEventListener('click', (e) => {
    const detail = content.querySelector('#an-formula-detail');
    const btn = e.target;
    const isHidden = detail.hasAttribute('hidden');
    if (isHidden) { detail.removeAttribute('hidden'); btn.textContent = 'Как считается? ▴'; }
    else { detail.setAttribute('hidden', ''); btn.textContent = 'Как считается? ▾'; }
  });
}

function renderPointsKpiBlock(summary) {
  const s = summary || {};
  const cards = [
    { label: 'Средний итоговый балл', val: s.avg_final_points },
    { label: 'Лучший результат', val: s.max_final_points },
    { label: 'Худший результат', val: s.min_final_points },
    { label: 'Средний рост к периоду', val: s.avg_delta, signed: true },
    { label: 'Операторов с ростом', val: s.operators_with_growth, dec: 0, color: 'var(--success)' },
    { label: 'Операторов с просадкой', val: s.operators_with_decline, dec: 0, color: 'var(--danger)' },
  ];
  return `<div class="an-card">
    <div class="an-card-head">Сводка по баллам</div>
    <div class="an-kpi-grid">
      ${cards.map(c => {
        const v = c.val;
        const txt = v == null ? '—' : (c.signed && v > 0 ? '+' : '') + fmtA(v, c.dec ?? 1);
        return `<div class="an-kpi-cell"><div class="an-kpi-val" style="${c.color?'color:'+c.color:''}">${txt}</div><div class="an-kpi-label">${esc(c.label)}</div></div>`;
      }).join('')}
    </div>
    ${!summary?.has_previous_period ? '<div class="an-info-note">Сравнение с прошлым периодом недоступно — недостаточно данных за предыдущий период.</div>' : ''}
  </div>`;
}

function renderPointsModeSwitcher() {
  const modes = [
    { key: 'top10', label: 'Топ-10' },
    { key: 'all', label: 'Все операторы' },
    { key: 'growth', label: 'Рост/просадка' },
    { key: 'table', label: 'Детальная таблица' },
  ];
  return `<div class="an-mode-switcher">
    ${modes.map(m => `<button class="an-mode-btn ${m.key===_pointsViewMode?'active':''}" data-mode="${m.key}">${esc(m.label)}</button>`).join('')}
  </div>`;
}

function bindPointsModeSwitcher() {
  document.querySelectorAll('.an-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.an-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _pointsViewMode = btn.dataset.mode;
      renderPointsModeContent(_pointsViewMode);
    });
  });
}

function resultStatusBadge(status) {
  const map = {
    excellent: { label: 'Отличный результат', color: 'var(--success)', bg: 'var(--success-soft)' },
    good:      { label: 'Хороший результат',  color: 'var(--info)',    bg: 'var(--info-soft)' },
    average:   { label: 'Средний результат',  color: 'var(--warning)', bg: 'var(--warning-soft)' },
    low:       { label: 'Низкий результат',   color: 'var(--danger)',  bg: 'var(--danger-soft)' },
    no_data:   { label: riskStatusLabel('no_data'),   color: 'var(--text-muted)', bg: 'var(--bg-muted)' },
  };
  const r = map[status] || map.no_data;
  return `<span class="risk-badge" style="color:${r.color};background:${r.bg}">${r.label}</span>`;
}

function deltaText(v, suffix = '') {
  if (v === null || v === undefined) return '<span style="color:var(--text-muted)">—</span>';
  if (Math.abs(v) < 0.05) return '<span style="color:var(--text-muted)">без изменений</span>';
  const arrow = v > 0 ? '↑' : '↓';
  const color = v > 0 ? 'var(--success)' : 'var(--danger)';
  return `<span style="color:${color}">${arrow} ${v > 0 ? '+' : ''}${fmtA(v, 1)}${suffix}</span>`;
}

function renderPointsModeContent(mode) {
  const box = document.getElementById('an-points-mode-content');
  if (!box || !_pointsData) return;
  const d = _pointsData;

  if (mode === 'top10') box.innerHTML = renderPointsTop10(d.operators);
  else if (mode === 'all') box.innerHTML = renderPointsAllCards(d.operators);
  else if (mode === 'growth') box.innerHTML = renderPointsGrowthDecline(d.top_growth, d.top_decline);
  else if (mode === 'table') {
    box.innerHTML = renderPointsDetailTable(d.operators);
    bindPointsTableSort(d.operators);
    box.querySelector('#an-points-export-btn')?.addEventListener('click', () => exportPointsCsv(d.operators));
  }

  bindPointsRowClicks(d.operators);
}

function exportPointsCsv(operators) {
  const headers = ['ФИО','Группа','Итог','Δ итог','Качество','Δ кач','КВЗ','Δ КВЗ','Часы','Δ часы','Эфф%','Δ эфф','Штраф баллы','Δ штраф','Статус'];
  const rows = [headers.join(';')];
  operators.forEach(o => rows.push([
    o.full_name, o.group_name||'', o.final_points, o.delta_final_points??'',
    o.quality??'', o.delta_quality??'', o.kvz??'', o.delta_kvz??'',
    o.total_hours, o.delta_total_hours??'', o.efficiency??'', o.delta_efficiency??'',
    o.penalty_points, o.delta_penalty_points??'', o.status
  ].join(';')));
  downloadCsv(rows, 'аналитика_баллы.csv');
}

/* Топ-10 bar chart */
function renderPointsTop10(operators) {
  const top10 = operators.slice(0, 10);
  const maxV = Math.max(...top10.map(o => o.final_points), 1);
  return `<div class="an-card">
    <div class="an-card-head">Топ-10 по итоговым баллам</div>
    <div class="an-points-bars">
      ${top10.map((o, i) => `
        <div class="an-points-bar-row" data-points-operator="${o.operator_id ?? o.full_name}">
          <div class="an-points-rank">${i+1}</div>
          <div class="an-points-name">
            <div class="an-points-name-main">${esc(o.full_name)}</div>
            <div class="an-points-name-sub">${esc(o.group_name||'—')}</div>
          </div>
          <div class="an-points-bar-track"><div class="an-points-bar-fill" style="width:${Math.round((o.final_points/maxV)*100)}%"></div></div>
          <div class="an-points-val">${fmtA(o.final_points,2)}</div>
          <div class="an-points-delta">${o.delta_final_points!=null ? deltaText(o.delta_final_points) : '<span style="color:var(--text-muted);font-size:11px">нет сравнения</span>'}</div>
        </div>`).join('')}
    </div>
  </div>`;
}

/* Карточки всех операторов с разбором показателей */
function renderPointsAllCards(operators) {
  return `<div class="an-card">
    <div class="an-card-head">Разбор вклада показателей по оператору</div>
    <div class="an-points-cards-grid">
      ${operators.map(o => renderOperatorPointsCard(o)).join('')}
    </div>
  </div>`;
}

function renderOperatorPointsCard(o) {
  const maxBar = Math.max(o.quality||0, (o.kvz||0)*10, o.total_hours||0, o.efficiency||0, 100);
  function metricRow(label, val, delta, barVal, unit='') {
    if (val == null) return `<div class="an-pc-metric"><span class="an-pc-label">${esc(label)}</span><span class="an-pc-value" style="color:var(--text-muted)">нет данных</span></div>`;
    const pct = Math.min(100, (barVal/maxBar)*100);
    return `<div class="an-pc-metric">
      <span class="an-pc-label">${esc(label)}</span>
      <div class="an-pc-bar-track"><div class="an-pc-bar-fill" style="width:${pct}%"></div></div>
      <span class="an-pc-value">${fmtA(val,1)}${unit}</span>
      <span class="an-pc-delta">${deltaText(delta, unit)}</span>
    </div>`;
  }
  return `<div class="an-points-card" data-points-operator="${o.operator_id ?? o.full_name}">
    <div class="an-pc-header">
      <div>
        <div class="an-pc-name">${esc(o.full_name)}</div>
        <div class="an-pc-group">${esc(o.group_name||'—')}</div>
      </div>
      ${resultStatusBadge(o.status)}
    </div>
    <div class="an-pc-totals">
      <span>Итог: <b>${fmtA(o.final_points,2)}</b></span>
      <span>Рост: ${o.delta_final_points!=null ? deltaText(o.delta_final_points) : '—'}</span>
    </div>
    <div class="an-pc-metrics">
      ${metricRow('Качество', o.quality, o.delta_quality, o.quality||0)}
      ${metricRow('КВЗ', o.kvz, o.delta_kvz, (o.kvz||0)*10)}
      ${metricRow('Часы', o.total_hours, o.delta_total_hours, o.total_hours||0)}
      ${metricRow('Эффективность', o.efficiency, o.delta_efficiency, o.efficiency||0, '%')}
      <div class="an-pc-metric an-pc-penalty">
        <span class="an-pc-label">Штрафы</span>
        <span class="an-pc-value" style="color:${o.penalty_points>0?'var(--danger)':'var(--text-muted)'}">
          ${o.penalty_points>0 ? '-'+fmtA(o.penalty_points,1)+' баллов — '+fmtA(o.penalty_minutes,1)+' мин' : '0 — нарушений нет'}
        </span>
      </div>
    </div>
  </div>`;
}

/* Рост/просадка блок */
function renderPointsGrowthDecline(topGrowth, topDecline) {
  function list(title, items, color) {
    if (!items.length) return `<div class="an-growth-col"><div class="an-growth-title">${esc(title)}</div><div class="empty-line">Нет данных</div></div>`;
    return `<div class="an-growth-col">
      <div class="an-growth-title">${esc(title)}</div>
      ${items.map((o,i) => `<div class="an-growth-row" data-points-operator="${o.operator_id ?? o.full_name}">
        <span class="an-growth-rank">${i+1}</span>
        <span class="an-growth-name">${esc(o.full_name)}</span>
        <span class="an-growth-val" style="color:${color}">${o.delta_final_points>0?'+':''}${fmtA(o.delta_final_points,1)}</span>
      </div>
      <div class="an-growth-reason">${esc(o.main_change_reason)}</div>`).join('')}
    </div>`;
  }
  return `<div class="an-card">
    <div class="an-card-head">Рост и просадка по итоговым баллам</div>
    <div class="an-grid-2">
      ${list('Топ-5 по росту', topGrowth, 'var(--success)')}
      ${list('Топ-5 по просадке', topDecline, 'var(--danger)')}
    </div>
  </div>`;
}

/* Детальная таблица */
let _pointsTableSortKey = 'final_points', _pointsTableSortDir = 'desc';
function renderPointsDetailTable(operators) {
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Детализация баллов</span>
      <button class="btn-outline btn-sm" id="an-points-export-btn">Экспорт CSV</button>
    </div>
    <div id="an-points-table-wrap">${renderPointsTableBody(operators)}</div>
  </div>`;
}

function renderPointsTableBody(operators) {
  const sorted = [...operators].sort((a,b) => {
    const av = a[_pointsTableSortKey] ?? -Infinity, bv = b[_pointsTableSortKey] ?? -Infinity;
    return _pointsTableSortDir === 'desc' ? bv - av : av - bv;
  });
  const arrow = k => k === _pointsTableSortKey ? (_pointsTableSortDir==='desc'?' ↓':' ↑') : '';
  const html = `<div class="table-wrap"><table class="data-table">
    <thead><tr>
      <th>#</th><th>Оператор</th><th>Группа</th>
      <th class="num sortable" data-sort="final_points">Итог${arrow('final_points')}</th>
      <th class="num sortable" data-sort="delta_final_points">Δ итог${arrow('delta_final_points')}</th>
      <th class="num">Качество</th><th class="num">Δ кач.</th>
      <th class="num">КВЗ</th><th class="num">Δ КВЗ</th>
      <th class="num">Эфф.%</th><th class="num">Δ эфф.</th>
      <th class="num">Штраф б.</th><th>Статус</th>
    </tr></thead>
    <tbody>
      ${sorted.map((o,i) => `<tr data-points-operator="${o.operator_id ?? o.full_name}" style="cursor:pointer">
        <td>${i+1}</td>
        <td class="name-cell">${esc(o.full_name)}</td>
        <td>${esc(o.group_name||'—')}</td>
        <td class="num"><b>${fmtA(o.final_points,2)}</b></td>
        <td class="num">${o.delta_final_points!=null?deltaText(o.delta_final_points):'—'}</td>
        <td class="num">${o.quality!=null?fmtA(o.quality,1):'—'}</td>
        <td class="num">${o.delta_quality!=null?deltaText(o.delta_quality):'—'}</td>
        <td class="num">${o.kvz!=null?fmtA(o.kvz,1):'—'}</td>
        <td class="num">${o.delta_kvz!=null?deltaText(o.delta_kvz):'—'}</td>
        <td class="num">${o.efficiency!=null?fmtA(o.efficiency,1):'—'}</td>
        <td class="num">${o.delta_efficiency!=null?deltaText(o.delta_efficiency):'—'}</td>
        <td class="num" style="${o.penalty_points>0?'color:var(--danger)':''}">${fmtA(o.penalty_points,1)}</td>
        <td>${resultStatusBadge(o.status)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
  return html;
}

function bindPointsTableSort(operators) {
  document.querySelectorAll('#an-points-table-wrap .sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (_pointsTableSortKey === key) _pointsTableSortDir = _pointsTableSortDir === 'desc' ? 'asc' : 'desc';
      else { _pointsTableSortKey = key; _pointsTableSortDir = 'desc'; }
      document.getElementById('an-points-table-wrap').innerHTML = renderPointsTableBody(operators);
      bindPointsTableSort(operators);
      bindPointsRowClicks(operators);
    });
  });
}

function bindPointsRowClicks(operators) {
  document.querySelectorAll('[data-points-operator]').forEach(elx => {
    elx.onclick = () => {
      const key = elx.dataset.pointsOperator;
      const op = operators.find(o => String(o.operator_id) === key || o.full_name === key);
      if (op) openOperatorPointsDrawer(op);
    };
  });
}

/* Детальная карточка оператора — модальное окно */
function openOperatorPointsDrawer(o) {
  const improved = [];
  const declined = [];
  if (o.delta_quality != null) (o.delta_quality > 0.5 ? improved : o.delta_quality < -0.5 ? declined : [null]).push?.(`Качество ${o.delta_quality>0?'+':''}${fmtA(o.delta_quality,1)}`);
  if (o.delta_kvz != null && Math.abs(o.delta_kvz) > 0.3) (o.delta_kvz>0?improved:declined).push(`КВЗ ${o.delta_kvz>0?'+':''}${fmtA(o.delta_kvz,1)}`);
  if (o.delta_efficiency != null && Math.abs(o.delta_efficiency) > 1) (o.delta_efficiency>0?improved:declined).push(`Эффективность ${o.delta_efficiency>0?'+':''}${fmtA(o.delta_efficiency,1)}%`);
  if (o.delta_total_hours != null && Math.abs(o.delta_total_hours) > 1) (o.delta_total_hours>0?improved:declined).push(`Часы ${o.delta_total_hours>0?'+':''}${fmtA(o.delta_total_hours,1)}`);
  if (o.delta_penalty_points != null && o.delta_penalty_points > 0.5) declined.push(`Штрафы +${fmtA(o.delta_penalty_points,1)}`);

  showModal(`
    <h3 class="modal-title">${esc(o.full_name)}</h3>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <span style="color:var(--text-secondary);font-size:13px">${esc(o.group_name||'—')}</span>
      ${resultStatusBadge(o.status)}
    </div>
    <div class="an-drawer-totals">
      <div><span class="an-drawer-label">Итоговые баллы</span><span class="an-drawer-val">${fmtA(o.final_points,2)}</span></div>
      <div><span class="an-drawer-label">Изменение</span><span class="an-drawer-val">${o.delta_final_points!=null?deltaText(o.delta_final_points):'—'}</span></div>
    </div>
    <div class="an-drawer-section">
      <div class="an-drawer-section-title">Разбор показателей</div>
      <div class="an-drawer-metric-row"><span>Качество</span><b>${o.quality!=null?fmtA(o.quality,1):'нет данных'}</b>${o.delta_quality!=null?deltaText(o.delta_quality):''}</div>
      <div class="an-drawer-metric-row"><span>КВЗ</span><b>${o.kvz!=null?fmtA(o.kvz,1):'нет данных'}</b>${o.delta_kvz!=null?deltaText(o.delta_kvz):''}</div>
      <div class="an-drawer-metric-row"><span>Итог часов</span><b>${fmtA(o.total_hours,1)}</b>${o.delta_total_hours!=null?deltaText(o.delta_total_hours):''}</div>
      <div class="an-drawer-metric-row"><span>Эффективность</span><b>${o.efficiency!=null?fmtA(o.efficiency,1)+'%':'нет данных'}</b>${o.delta_efficiency!=null?deltaText(o.delta_efficiency,'%'):''}</div>
      <div class="an-drawer-metric-row"><span>Штрафы</span><b style="color:${o.penalty_points>0?'var(--danger)':'inherit'}">${o.penalty_points>0?'-'+fmtA(o.penalty_points,1):'0'}</b></div>
    </div>
    ${improved.length ? `<div class="an-drawer-section">
      <div class="an-drawer-section-title" style="color:var(--success)">Что улучшилось</div>
      ${improved.map(t=>`<div class="an-drawer-change-row" style="color:var(--success)">↑ ${esc(t)}</div>`).join('')}
    </div>` : ''}
    ${declined.length ? `<div class="an-drawer-section">
      <div class="an-drawer-section-title" style="color:var(--danger)">Что просело</div>
      ${declined.map(t=>`<div class="an-drawer-change-row" style="color:var(--danger)">↓ ${esc(t)}</div>`).join('')}
    </div>` : ''}
    <div class="an-drawer-section">
      <div class="an-drawer-section-title">Рекомендация</div>
      <div class="an-drawer-recommendation">${esc(o.recommendation)}</div>
    </div>
  `);
}


/* ── Вкладка: Экспорт ─────────────────────────────────────────*/
