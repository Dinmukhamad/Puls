/* Выделено из 40-reports-analytics.view.js (2671 строка).
   Блоки отчёта за период: KPI, динамика, таблица операторов, сравнение
   групп, матрица, тепловая карта, пирамида рисков, покрытие качеством. */

function renderKpiBlock(summary) {
  const k = summary.kpi || {};
  const cards = [
    { label: 'Операторов в расчёте', val: k.operators_count, dec: 0 },
    { label: 'Всего звонков', val: k.total_calls, dec: 0 },
    { label: 'Среднее качество', val: k.avg_quality, dec: 2 },
    { label: 'Средний КВЗ', val: k.avg_kvz, dec: 2 },
    { label: 'Средняя эффективность', val: k.avg_efficiency, dec: 2, suf: '%' },
    { label: 'Штрафы, мин', val: k.penalty_minutes_total, dec: 1 },
    { label: 'Итог часов', val: k.total_hours, dec: 1 },
    { label: 'База часов', val: k.base_hours_total, dec: 1 },
    { label: 'Оценённых звонков', val: k.quality_calls_count, dec: 0 },
    { label: 'Операторов без оценок', val: k.operators_no_quality, dec: 0 },
  ];
  return `<div class="an-card">
    <div class="an-card-head">Главные показатели</div>
    <div class="an-kpi-grid">
      ${cards.map(c => `
        <div class="an-kpi-cell">
          <div class="an-kpi-val">${fmtA(c.val, c.dec, c.suf||'')}</div>
          <div class="an-kpi-label">${esc(c.label)}</div>
        </div>`).join('')}
    </div>
  </div>`;
}

/* ── Block: Daily dynamics chart ───────────────────────────────*/
function renderDailyDynamicsBlock(dynamics) {
  const items = dynamics.items || [];
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Динамика по дням</span>
      <div class="metric-tabs" id="an-dyn-tabs">
        <button class="metric-tab active" data-metric="calls">Звонки</button>
        <button class="metric-tab" data-metric="kvz">КВЗ</button>
        <button class="metric-tab" data-metric="operators">Операторы</button>
      </div>
    </div>
    <div id="an-dyn-chart">${renderDynChart(items, 'calls')}</div>
  </div>`;
}

function renderDynChart(items, metric) {
  if (!items.length) return '<div class="empty-line">Нет данных за период</div>';
  const field = metric === 'operators' ? 'operators_on_line' : metric;
  const vals = items.map(i => Number(i[field]) || 0);
  const maxV = Math.max(...vals, 1);
  return `<div class="an-bar-chart">
    ${items.map((it, i) => {
      const v = vals[i];
      const pct = Math.round((v / maxV) * 100);
      const label = it[field] == null ? '—' : (metric === 'kvz' ? v.toFixed(2) : Math.round(v));
      return `<div class="an-bar-row">
        <div class="an-bar-date">${esc(it.date.slice(5))}</div>
        <div class="an-bar-track"><div class="an-bar-fill" style="width:${pct}%"></div></div>
        <div class="an-bar-val">${label}</div>
      </div>`;
    }).join('')}
  </div>`;
}

/* ── Block: Operators table ────────────────────────────────────*/
function renderOperatorsTableBlock(opsTable) {
  const items = opsTable.items || [];
  const totalPages = Math.max(1, Math.ceil((opsTable.total || items.length) / (opsTable.page_size || 100)));
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Операторы за период</span>
      <span class="an-table-count">Найдено: ${opsTable.total ?? items.length}</span>
      <button class="btn-outline btn-sm" id="an-export-ops-btn">Экспорт Excel</button>
    </div>
    <p class="an-tab-hint">Каждая строка — один оператор за выбранный период. «Итог» — общий балл (по нему сортировка), красным — кто в зоне риска. Нажмите на строку, чтобы раскрыть детали (звонки, часы, норма, эффективность).</p>
    <div id="an-ops-table-wrap">${renderOpsTable(items, opsTable.sort_by || 'final_points', opsTable.sort_order || 'desc')}</div>
    ${totalPages > 1 ? `<div class="an-pagination"><button class="btn-outline btn-sm" data-an-page="prev" ${opsTable.page <= 1 ? 'disabled' : ''}>Назад</button><span>Страница ${opsTable.page} из ${totalPages}</span><button class="btn-outline btn-sm" data-an-page="next" ${opsTable.page >= totalPages ? 'disabled' : ''}>Далее</button></div>` : ''}
  </div>`;
}

function normCompletionHtml(o) {
  if (o.norm_completion_percent == null) {
    if (o.rate == null) return '<span class="cell-muted" title="Ставка не указана">—</span>';
    return '<span class="cell-muted">нет нормы</span>';
  }
  const pct = o.norm_completion_percent;
  const color = pct >= 100 ? 'var(--success)' : pct >= 80 ? 'var(--warning)' : 'var(--danger)';
  return `<span style="color:${color};font-weight:600">${pct.toFixed(1)}%</span>`;
}

function renderOpsTable(items, sortKey, sortDir) {
  if (!items.length) return '<div class="empty-line">Нет операторов, удовлетворяющих фильтрам</div>';
  const sorted = [...items].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity, bv = b[sortKey] ?? -Infinity;
    return sortDir === 'desc' ? bv - av : av - bv;
  });
  const arrow = dir => dir === 'desc' ? ' ↓' : ' ↑';
  const sortAttr = k => k === sortKey ? arrow(sortDir) : '';
  const hasNorm = items.some(o => o.individual_norm_hours != null);

  function detailCell(o) {
    const rows = [
      ['Звонки', fmtA(o.calls_total, 0)],
      ['Факт часов', fmtA(o.total_hours, 1)],
      ['Эффективность', fmtA(o.efficiency_percent, 2, '%')],
    ];
    if (hasNorm) {
      rows.push(
        ['Ставка', o.rate != null ? String(o.rate) : '—'],
        ['Норма часов', o.individual_norm_hours != null ? fmtA(o.individual_norm_hours, 1) + ' ч' : '—'],
        ['Выполнение нормы', o.norm_completion_percent != null ? fmtA(o.norm_completion_percent, 1) + '%' : '—'],
        ['Переработка', o.overtime_hours > 0 ? '+' + fmtA(o.overtime_hours, 1) + ' ч' : '—'],
        ['Баллы за часы', o.hours_points != null ? fmtA(o.hours_points, 1) + ' / 25' : '—'],
      );
    }
    return `<div class="an-ops-detail-grid">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
  }

  // 7 ключевых столбцов — без горизонтального скролла; остальное в раскрывашке.
  return `<div class="table-wrap"><table class="data-table an-ops-table">
    <thead><tr>
      <th class="an-col-rank">#</th>
      <th>Оператор</th>
      <th class="num sortable" data-sort="final_points">Итог${sortAttr('final_points')}</th>
      <th class="num sortable an-col-q" data-sort="quality_avg">Качество${sortAttr('quality_avg')}</th>
      <th class="num sortable an-col-kvz" data-sort="kvz">КВЗ${sortAttr('kvz')}</th>
      <th class="num sortable an-col-pen" data-sort="penalty_minutes">Штраф${sortAttr('penalty_minutes')}</th>
      <th>Риск</th>
    </tr></thead>
    <tbody>
      ${sorted.map((o, i) => `
        <tr class="an-ops-row ${i<3?'an-row-top3':''}" data-op-row="${i}" tabindex="0" role="button" aria-expanded="false" title="Показать детали">
          <td class="an-col-rank">${i+1}</td>
          <td class="name-cell">${esc(o.full_name)}<small class="an-ops-group">${esc(o.group_name||'—')}</small></td>
          <td class="num"><b>${fmtA(o.final_points)}</b></td>
          <td class="num an-col-q" style="${o.quality_avg!=null?'color:'+qualityColor(o.quality_band)+';font-weight:600':''}">${o.quality_avg!=null?fmtA(o.quality_avg):'нет оценок'}</td>
          <td class="num an-col-kvz">${fmtA(o.kvz)}</td>
          <td class="num an-col-pen" style="${o.penalty_minutes>0?'color:var(--danger)':''}">${fmtA(o.penalty_minutes,1)}</td>
          <td>${riskBadge(o.risk_status)}</td>
        </tr>
        <tr class="an-ops-detail-row" data-op-detail="${i}" hidden><td colspan="7">${detailCell(o)}</td></tr>`).join('')}
    </tbody>
  </table></div>`;
}

/* ── Block: Groups comparison ───────────────────────────────────*/
function renderGroupsComparisonBlock(groupsCmp) {
  const items = groupsCmp.items || [];
  if (!items.length) return `<div class="an-card"><div class="an-card-head">Сравнение групп</div><div class="empty-line">Нет данных</div></div>`;
  const maxAvg = Math.max(...items.map(g => g.avg_final_points || 0), 1);
  const hasSmall = items.some(g => g.ranking_reliable === false);
  return `<div class="an-card">
    <div class="an-card-head-row"><span>Сравнение групп</span><small style="color:var(--text-muted);font-weight:500">Ранжирование по среднему баллу на оператора</small></div>
    <div class="an-bar-chart" style="margin:12px 0 16px">
      ${items.map(g => `
        <div class="an-bar-row">
          <div class="an-bar-date" style="width:140px">${esc(g.group_name)}${g.ranking_reliable === false ? ' <span title="Мало операторов — оценка менее надёжна" style="color:var(--text-muted)">*</span>' : ''}</div>
          <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round((g.avg_final_points/maxAvg)*100)}%"></div></div>
          <div class="an-bar-val">${fmtA(g.avg_final_points,1)}</div>
        </div>`).join('')}
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>Группа</th><th class="num">Операторов</th><th class="num">Средний балл</th><th class="num">Сумма баллов</th><th class="num">Звонки</th>
        <th class="num">Качество</th><th class="num">КВЗ</th><th class="num">Эфф.%</th>
        <th class="num">Штраф мин</th><th class="num">Без оценок</th><th class="num">В риске</th>
      </tr></thead>
      <tbody>
        ${items.map(g => `<tr>
          <td class="name-cell">${esc(g.group_name)}${g.ranking_reliable === false ? ' <span title="Мало операторов — оценка менее надёжна" style="color:var(--text-muted)">*</span>' : ''}</td>
          <td class="num">${g.operators_count}</td>
          <td class="num"><strong>${fmtA(g.avg_final_points,1)}</strong></td>
          <td class="num" style="color:var(--text-secondary)">${fmtA(g.final_points_sum,0)}</td>
          <td class="num">${fmtA(g.total_calls,0)}</td>
          <td class="num">${fmtA(g.avg_quality)}</td>
          <td class="num">${fmtA(g.avg_kvz)}</td>
          <td class="num">${fmtA(g.avg_efficiency,2,'%')}</td>
          <td class="num">${fmtA(g.penalty_minutes,1)}</td>
          <td class="num">${g.operators_no_quality}</td>
          <td class="num" style="${g.operators_in_risk>0?'color:var(--warning)':''}">${g.operators_in_risk}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    ${hasSmall ? '<p class="an-groups-footnote" style="margin:10px 0 0;font-size:12px;color:var(--text-muted)">* В группе мало операторов — среднее менее устойчиво, сравнивайте с осторожностью.</p>' : ''}
  </div>`;
}

/* ── Block: Quality x KVZ scatter matrix ────────────────────────*/
let _qkMatrixData = null;
function renderQualityKvzMatrixBlock() {
  return `<div class="an-card">
    <div class="an-card-head">Матрица «Качество × КВЗ»</div>
    <div id="an-qk-matrix"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
  </div>`;
}

function drawScatter(containerId, points, xKey, yKey, xLabel, yLabel, xThreshold, yThreshold) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!points.length) { el.innerHTML = '<div class="empty-line">Нет данных для построения графика</div>'; return; }

  const W = 640, H = 400, PAD_L = 50, PAD_B = 36, PAD_T = 16, PAD_R = 16;
  const xVals = points.map(p => p[xKey]);
  const yVals = points.map(p => p[yKey]);
  const xMaxRaw = Math.max(...xVals, xThreshold||0);
  const yMaxRaw = Math.max(...yVals, yThreshold||0);
  const xMax = (xMaxRaw * 1.15) || 1;
  const yMax = (yMaxRaw * 1.15) || 1;
  const xMin = 0, yMin = 0;

  const sizeMax = Math.max(...points.map(p => p.calls_total || p.base_hours || 1), 1);

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const sx = x => PAD_L + (x - xMin) / (xMax - xMin) * plotW;
  const sy = y => H - PAD_B - (y - yMin) / (yMax - yMin) * plotH;

  // Сетка и числовые деления (5 шагов на каждой оси)
  function niceTicks(max, steps = 5) {
    const raw = max / steps;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const norm = raw / mag;
    let step;
    if (norm < 1.5) step = 1 * mag;
    else if (norm < 3) step = 2 * mag;
    else if (norm < 7) step = 5 * mag;
    else step = 10 * mag;
    const ticks = [];
    for (let v = 0; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 100) / 100);
    return ticks;
  }
  const xTicks = niceTicks(xMax);
  const yTicks = niceTicks(yMax);

  const groupColors = {};
  const palette = ['#0284C7','#16A34A','#D97706','#9333EA','#DC2626','#0891B2'];
  let colorIdx = 0;
  points.forEach(p => {
    const g = p.group_name || '—';
    if (!(g in groupColors)) groupColors[g] = palette[colorIdx++ % palette.length];
  });

  const thresholdX = xThreshold != null ? sx(xThreshold) : null;
  const thresholdY = yThreshold != null ? sy(yThreshold) : null;

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:460px" id="${containerId}-svg" font-family="Inter,sans-serif">
      <!-- Сетка по X -->
      ${xTicks.map(t => {
        const x = sx(t);
        return `<line x1="${x}" y1="${PAD_T}" x2="${x}" y2="${H-PAD_B}" stroke="var(--border-soft)" stroke-width="1"/>
          <text x="${x}" y="${H-PAD_B+16}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${t}</text>`;
      }).join('')}
      <!-- Сетка по Y -->
      ${yTicks.map(t => {
        const y = sy(t);
        return `<line x1="${PAD_L}" y1="${y}" x2="${W-PAD_R}" y2="${y}" stroke="var(--border-soft)" stroke-width="1"/>
          <text x="${PAD_L-8}" y="${y+3}" text-anchor="end" font-size="10" fill="var(--text-muted)">${t}</text>`;
      }).join('')}
      <!-- Оси -->
      <line x1="${PAD_L}" y1="${H-PAD_B}" x2="${W-PAD_R}" y2="${H-PAD_B}" stroke="var(--border-strong)" stroke-width="1.5"/>
      <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${H-PAD_B}" stroke="var(--border-strong)" stroke-width="1.5"/>
      <!-- Пороговые линии -->
      ${thresholdX != null ? `<line x1="${thresholdX}" y1="${PAD_T}" x2="${thresholdX}" y2="${H-PAD_B}" stroke="var(--warning)" stroke-width="1.2" stroke-dasharray="5,4"/>
        <text x="${thresholdX}" y="${PAD_T-2}" text-anchor="middle" font-size="9" fill="var(--warning)">${xThreshold}</text>` : ''}
      ${thresholdY != null ? `<line x1="${PAD_L}" y1="${thresholdY}" x2="${W-PAD_R}" y2="${thresholdY}" stroke="var(--warning)" stroke-width="1.2" stroke-dasharray="5,4"/>
        <text x="${W-PAD_R+2}" y="${thresholdY+3}" text-anchor="start" font-size="9" fill="var(--warning)">${yThreshold}</text>` : ''}
      <!-- Подписи осей -->
      <text x="${PAD_L + plotW/2}" y="${H-4}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--text-primary)">${esc(xLabel)}</text>
      <text x="14" y="${PAD_T + plotH/2}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--text-primary)" transform="rotate(-90,14,${PAD_T + plotH/2})">${esc(yLabel)}</text>
      <!-- Точки -->
      ${points.map(p => {
        const r = 4 + 7 * Math.sqrt((p.calls_total || p.base_hours || 1) / sizeMax);
        const color = groupColors[p.group_name || '—'];
        const cx = sx(p[xKey]), cy = sy(p[yKey]);
        const xv = typeof p[xKey] === 'number' ? (p[xKey] % 1 === 0 ? p[xKey] : p[xKey].toFixed(1)) : p[xKey];
        const yv = typeof p[yKey] === 'number' ? (p[yKey] % 1 === 0 ? p[yKey] : p[yKey].toFixed(1)) : p[yKey];
        return `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${color}" opacity="0.7" stroke="${color}" stroke-width="1.5">
            <title>${esc(p.full_name)} (${esc(p.group_name||'—')})\n${xLabel}: ${p[xKey]}\n${yLabel}: ${p[yKey]}</title>
          </circle>
          <text x="${cx}" y="${cy - r - 4}" text-anchor="middle" font-size="9" fill="var(--text-secondary)" font-weight="600">${yv}</text>`;
      }).join('')}
    </svg>
    <div class="an-legend">
      ${Object.entries(groupColors).map(([g,c]) => `<span class="an-legend-item"><span class="an-legend-dot" style="background:${c}"></span>${esc(g)}</span>`).join('')}
    </div>`;
}

/* ── Block: Top / Attention ─────────────────────────────────────*/
function renderTopAttentionBlock(topAttn) {
  function topList(title, items, suffix='') {
    if (!items || !items.length) return `<div class="an-top-col"><div class="an-top-title">${esc(title)}</div><div class="empty-line">Нет данных</div></div>`;
    return `<div class="an-top-col">
      <div class="an-top-title">${esc(title)}</div>
      ${items.map((it,i) => `<div class="an-top-row">
        <span class="an-top-rank">${i+1}</span>
        <span class="an-top-name">${esc(it.full_name)}</span>
        <span class="an-top-val">${fmtA(it.value)}${suffix}</span>
      </div>`).join('')}
    </div>`;
  }

  const attn = topAttn.attention_zone || [];

  return `<div class="an-card">
    <div class="an-card-head">Топ операторов</div>
    <div class="an-top-grid">
      ${topList('По итоговым баллам', topAttn.top_final_points)}
      ${topList('По качеству', topAttn.top_quality)}
      ${topList('По КВЗ', topAttn.top_kvz)}
      ${topList('По эффективности', topAttn.top_efficiency, '%')}
    </div>
  </div>
  <div class="an-card">
    <div class="an-card-head" style="color:var(--warning)">Зона внимания (${attn.length})</div>
    ${attn.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Оператор</th><th>Группа</th><th>Причина</th></tr></thead>
      <tbody>
        ${attn.map(a => `<tr>
          <td class="name-cell">${esc(a.full_name)}</td>
          <td>${esc(a.group_name||'—')}</td>
          <td style="color:var(--warning)">${esc(a.reason)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : '<div class="empty-line">Операторов в зоне внимания нет</div>'}
  </div>`;
}

/* ── Block: Penalties analytics ─────────────────────────────────*/
function renderPenaltiesBlock(penalties) {
  const ops = penalties.operators || [];
  const byReason = penalties.by_reason || [];
  const maxMin = Math.max(...byReason.map(r=>r.minutes), 1);
  return `<div class="an-card">
    <div class="an-card-head">Аналитика штрафов</div>
    <div class="an-kpi-grid" style="margin-bottom:16px">
      <div class="an-kpi-cell"><div class="an-kpi-val">${fmtA(penalties.total_penalty_minutes,1)}</div><div class="an-kpi-label">Всего штрафов, мин</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val">${penalties.operators_with_penalty_count}</div><div class="an-kpi-label">Операторов со штрафами</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val">${fmtA(penalties.avg_penalty_per_operator,1)}</div><div class="an-kpi-label">Средний штраф/оператор</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val" style="color:var(--danger)">${fmtA(penalties.total_points_lost,1)}</div><div class="an-kpi-label">Потеря баллов</div></div>
    </div>
    ${byReason.length ? `<div class="an-bar-chart" style="margin-bottom:16px">
      ${byReason.map(r => `<div class="an-bar-row">
        <div class="an-bar-date" style="width:200px">${esc(r.reason)}</div>
        <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round((r.minutes/maxMin)*100)}%;background:var(--danger)"></div></div>
        <div class="an-bar-val">${fmtA(r.minutes,1)} мин</div>
      </div>`).join('')}
    </div>` : ''}
    ${ops.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Оператор</th><th>Группа</th><th class="num">Сумма</th><th class="num">Минуты</th><th class="num">Потеря баллов</th></tr></thead>
      <tbody>${ops.map(o => `<tr>
        <td class="name-cell">${esc(o.full_name)}</td><td>${esc(o.group_name||'—')}</td>
        <td class="num">${fmtA(o.penalty_sum,0)}</td>
        <td class="num" style="color:var(--danger)">${fmtA(o.penalty_minutes,1)}</td>
        <td class="num" style="color:var(--danger)">-${fmtA(o.penalty_points,1)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty-line">Штрафов за период нет</div>'}
  </div>`;
}

/* ── Block: Points breakdown (waterfall-style) ───────────────────*/
function renderPointsBreakdownBlock(breakdown) {
  const items = (breakdown.items || []).slice(0, 10);
  return `<div class="an-card">
    <div class="an-card-head">Вклад показателей в итоговый балл (топ-10)</div>
    ${items.length ? items.map(o => renderBreakdownRow(o)).join('') : '<div class="empty-line">Нет данных</div>'}
  </div>`;
}

function renderBreakdownRow(o) {
  const parts = [
    { label: 'Качество', val: o.quality_contribution, color: '#0284C7' },
    { label: 'КВЗ', val: o.kvz_contribution, color: '#16A34A' },
    { label: 'Часы', val: o.hours_contribution, color: '#9333EA' },
    { label: 'Эфф.', val: o.efficiency_contribution, color: '#D97706' },
    { label: 'Штрафы', val: o.penalty_contribution, color: '#DC2626' },
  ];
  const maxAbs = Math.max(...parts.map(p => Math.abs(p.val)), 1);
  return `<div class="an-breakdown-row">
    <div class="an-breakdown-name">${esc(o.full_name)} <span style="color:var(--text-muted);font-weight:400">(${esc(o.group_name||'—')})</span></div>
    <div class="an-breakdown-bars">
      ${parts.map(p => `<div class="an-bd-seg" title="${p.label}: ${fmtA(p.val)}">
        <span class="an-bd-label">${p.label}</span>
        <div class="an-bd-track"><div class="an-bd-fill" style="width:${Math.min(100,Math.abs(p.val)/maxAbs*100)}%;background:${p.color}"></div></div>
        <span class="an-bd-val" style="${p.val<0?'color:var(--danger)':''}">${p.val>=0?'+':''}${fmtA(p.val,1)}</span>
      </div>`).join('')}
    </div>
    <div class="an-breakdown-total">Итог: <b>${fmtA(o.final_points)}</b></div>
  </div>`;
}

/* ── Block: Heatmap by day ───────────────────────────────────────*/
function renderHeatmapBlock() {
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Тепловая карта по дням</span>
      <div class="metric-tabs" id="an-heatmap-tabs">
        <button class="metric-tab active" data-metric="quality">Качество</button>
        <button class="metric-tab" data-metric="calls">Звонки</button>
        <button class="metric-tab" data-metric="kvz">КВЗ</button>
        <button class="metric-tab" data-metric="efficiency">Эфф.</button>
        <button class="metric-tab" data-metric="penalty">Штрафы</button>
      </div>
    </div>
    <div id="an-heatmap-body"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
  </div>`;
}

// Преобразует число 0..1 в мягкий цвет по градиенту красный→жёлтый→зелёный (HSL, низкая насыщенность)
function softGradientColor(t) {
  t = Math.max(0, Math.min(1, t));
  // HSL hue: 0 (красный) -> 50 (жёлтый) -> 142 (зелёный)
  const hue = t < 0.5 ? (t / 0.5) * 50 : 50 + ((t - 0.5) / 0.5) * 92;
  return `hsl(${hue.toFixed(0)}, 62%, 78%)`;
}

function heatColor(metric, v, ctx) {
  if (v === null || v === undefined) return 'var(--bg-muted)';

  if (metric === 'penalty') {
    // Штрафы: 0 — нейтрально-зелёный мягкий, дальше темнее к красному, без скачков
    if (v === 0) return 'hsl(142, 45%, 82%)';
    const maxRef = Math.max(ctx?.maxVal || 30, 20);
    const t = Math.min(1, v / maxRef);
    // инвертируем: больше штраф — краснее
    return softGradientColor(1 - t);
  }

  if (metric === 'quality' || metric === 'efficiency') {
    // Шкала 0-100, фиксированная и предсказуемая
    const t = Math.max(0, Math.min(1, v / 100));
    return softGradientColor(t);
  }

  // calls / kvz — нет фиксированного максимума, используем относительный масштаб
  // по диапазону значений в текущей таблице (min..max), без ложного "всё красное"
  const minV = ctx?.minVal ?? 0;
  const maxV = ctx?.maxVal ?? (v || 1);
  if (maxV <= minV) return softGradientColor(0.6);
  const t = (v - minV) / (maxV - minV);
  return softGradientColor(t);
}

function renderHeatmapTable(data, metric) {
  const dates = data.dates || [];
  const operators = data.operators || [];
  if (!operators.length || !dates.length) return '<div class="empty-line">Нет данных для тепловой карты</div>';

  // Считаем диапазон значений по всей таблице для относительного масштаба (calls/kvz)
  let allVals = [];
  operators.forEach(op => dates.forEach(d => {
    const v = op.values[d];
    if (v !== null && v !== undefined) allVals.push(v);
  }));
  const ctx = {
    minVal: allVals.length ? Math.min(...allVals) : 0,
    maxVal: allVals.length ? Math.max(...allVals) : 1,
  };

  return `<div class="an-heatmap-wrap"><table class="an-heatmap-table">
    <thead><tr><th class="an-heatmap-name-col">Оператор</th>
      ${dates.map(d => `<th>${esc(d.slice(5))}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${operators.map(op => `<tr>
        <td class="an-heatmap-name-col name-cell">${esc(op.full_name)}</td>
        ${dates.map(d => {
          const v = op.values[d];
          const bg = heatColor(metric, v, ctx);
          const label = v == null ? '—' : (metric==='kvz'||metric==='penalty' ? v.toFixed(1) : Math.round(v));
          return `<td class="an-heatmap-cell" style="background:${bg}" title="${esc(op.full_name)} ${d}: ${v==null?'нет данных':label}">${label}</td>`;
        }).join('')}
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}


/* ── Block: Risk pyramid ─────────────────────────────────────────*/
function renderRiskPyramidBlock(riskPyramid) {
  const statuses = [
    { key: 'stable', label: riskStatusLabel('stable'), icon: '🟢' },
    { key: 'watch', label: riskStatusLabel('watch'), icon: '🟡' },
    { key: 'critical', label: riskStatusLabel('critical'), icon: '🔴' },
    { key: 'no_data', label: riskStatusLabel('no_data'), icon: '⚪' },
  ];
  return `<div class="an-card">
    <div class="an-card-head">Пирамида риска операторов</div>
    <div class="an-risk-grid">
      ${statuses.map(s => {
        const bucket = riskPyramid[s.key] || { count: 0, operators: [] };
        return `<div class="an-risk-cell" data-risk-status="${s.key}">
          <div class="an-risk-icon">${s.icon}</div>
          <div class="an-risk-count">${bucket.count}</div>
          <div class="an-risk-label">${s.label}</div>
        </div>`;
      }).join('')}
    </div>
    <div id="an-risk-detail"></div>
  </div>`;
}

/* ── Block: Quality coverage dashboard ─────────────────────────────*/
function renderQualityCoverageBlock(coverage) {
  const byGroup = coverage.by_group || [];
  const withoutQ = coverage.without_quality || [];
  return `<div class="an-card">
    <div class="an-card-head">Дашборд качества прослушки</div>
    <div class="an-kpi-grid" style="margin-bottom:16px">
      <div class="an-kpi-cell"><div class="an-kpi-val">${coverage.total_evaluated_calls}</div><div class="an-kpi-label">Оценённых звонков</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val">${fmtA(coverage.avg_evaluations_per_operator,1)}</div><div class="an-kpi-label">Среднее оценок/оператора</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val" style="color:var(--warning)">${coverage.operators_without_quality_count}</div><div class="an-kpi-label">Без оценок</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val" style="font-size:14px">${esc(coverage.best_coverage_group||'—')}</div><div class="an-kpi-label">Лучшее покрытие</div></div>
      <div class="an-kpi-cell"><div class="an-kpi-val" style="font-size:14px">${esc(coverage.worst_coverage_group||'—')}</div><div class="an-kpi-label">Худшее покрытие</div></div>
    </div>
    ${byGroup.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Группа</th><th class="num">Операторов</th><th class="num">Оцен. звонков</th><th class="num">Среднее/опер.</th><th class="num">Без оценок</th><th class="num">Ср. качество</th></tr></thead>
      <tbody>${byGroup.map(g => `<tr>
        <td class="name-cell">${esc(g.group_name)}</td>
        <td class="num">${g.operators_count}</td>
        <td class="num">${g.evaluated_calls}</td>
        <td class="num">${fmtA(g.avg_evaluations_per_operator,1)}</td>
        <td class="num">${g.operators_without_quality}</td>
        <td class="num">${fmtA(g.avg_quality)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : ''}
    ${withoutQ.length ? `<div style="margin-top:16px">
      <div class="an-sub-title">Операторы без оценки качества (${withoutQ.length})</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Оператор</th><th>Группа</th><th class="num">База ч.</th><th class="num">Звонки</th></tr></thead>
        <tbody>${withoutQ.map(o => `<tr>
          <td class="name-cell">${esc(o.full_name)}</td><td>${esc(o.group_name||'—')}</td>
          <td class="num">${fmtA(o.base_hours,1)}</td><td class="num">${fmtA(o.calls_total,0)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}
  </div>`;
}

/* ── Block: Load vs Efficiency scatter ─────────────────────────────*/
function renderLoadEfficiencyBlock(loadEff) {
  return `<div class="an-card">
    <div class="an-card-head">Нагрузка и эффективность</div>
    <div id="an-load-eff-matrix"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
  </div>`;
}

/* ── Block: Future KPI (placeholder) ───────────────────────────────*/
function renderFutureKpiBlock() {
  const future = ['AHT — среднее время обработки', 'ASA — среднее время ожидания ответа', 'Service Level',
    'Abandonment Rate', 'FCR', 'CSAT / NPS', 'Occupancy'];
  return `<div class="an-card">
    <div class="an-card-head">Будущие метрики</div>
    <div class="an-future-grid">
      ${future.map(f => `<div class="an-future-item">
        <div class="an-future-name">${esc(f)}</div>
        <div class="an-future-status">Недоступно: нет данных из телефонии / CRM</div>
      </div>`).join('')}
    </div>
  </div>`;
}

/* ── Block: Warnings ────────────────────────────────────────────────*/
function renderAnalyticsWarningsBlock(warnings) {
  if (!warnings) return '';
  const w = warnings;
  const total = (w.site_only?.length||0)+(w.file_only?.length||0)+(w.no_quality?.length||0)+(w.no_base_hours?.length||0);
  if (!total) return '';

  function chipGroup(title, items) {
    if (!items || !items.length) return '';
    return `<div class="pr-warn-group">
      <div class="pr-warn-group-title">${esc(title)} (${items.length})</div>
      <div class="pr-warn-chips">${items.slice(0,30).map(n=>`<span class="pr-warn-chip">${esc(n)}</span>`).join('')}
      ${items.length>30?`<span class="pr-warn-chip pr-warn-chip-more">+${items.length-30}</span>`:''}</div>
    </div>`;
  }

  return `<div class="an-card">
    <div class="an-card-head">Предупреждения по данным (${total})</div>
    ${chipGroup('Есть на сайте, но отсутствуют в файле', w.site_only)}
    ${chipGroup('Есть в файле, но отсутствуют на сайте', w.file_only)}
    ${chipGroup('Нет оценок качества', w.no_quality)}
    ${chipGroup('Нет базы часов', w.no_base_hours)}
  </div>`;
}

/* ── Wiring: interactions for tabs, scatter plots, exports ──────────*/
