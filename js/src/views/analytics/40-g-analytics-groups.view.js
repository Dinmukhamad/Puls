/* Выделено из 40-reports-analytics.view.js (2671 строка).
   Вкладка «Группы»: сравнение и графики по метрикам. */

async function loadGroupsTab(content) {
  const groupsCmp = await analyticsFetch('groups-comparison', analyticsBaseParams());
  const items = groupsCmp.items || [];

  const bestQuality = items.length ? [...items].sort((a,b)=>(b.avg_quality??-1)-(a.avg_quality??-1))[0] : null;
  const bestKvz = items.length ? [...items].sort((a,b)=>(b.avg_kvz??-1)-(a.avg_kvz??-1))[0] : null;
  const worstPenalty = items.length ? [...items].sort((a,b)=>b.penalty_minutes-a.penalty_minutes)[0] : null;
  const worstRisk = items.length ? [...items].sort((a,b)=>b.operators_in_risk-a.operators_in_risk)[0] : null;

  content.innerHTML =
    renderGroupsBestWorstBlock(bestQuality, bestKvz, worstPenalty, worstRisk) +
    renderGroupsMetricChartBlock(items) +
    renderGroupsComparisonBlock(groupsCmp);

  bindGroupsMetricTabs(items);
}

function renderGroupsBestWorstBlock(bestQ, bestK, worstP, worstR) {
  function card(label, group, valueFmt) {
    if (!group) return `<div class="an-kpi-cell"><div class="an-kpi-val">—</div><div class="an-kpi-label">${esc(label)}</div></div>`;
    return `<div class="an-kpi-cell"><div class="an-kpi-val" style="font-size:15px">${esc(group.group_name)}</div><div class="an-kpi-label">${esc(label)}: ${valueFmt}</div></div>`;
  }
  return `<div class="an-card">
    <div class="an-card-head">Лучшие и слабые группы</div>
    <div class="an-kpi-grid">
      ${card('Лучшая по качеству', bestQ, fmtA(bestQ?.avg_quality))}
      ${card('Лучшая по КВЗ', bestK, fmtA(bestK?.avg_kvz))}
      ${card('Больше всего штрафов', worstP, fmtA(worstP?.penalty_minutes,1)+' мин')}
      ${card('Больше всего в риске', worstR, (worstR?.operators_in_risk??0)+' опер.')}
    </div>
  </div>`;
}

function renderGroupsMetricChartBlock(items) {
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Сравнение групп по показателю</span>
      <div class="metric-tabs" id="an-groups-metric-tabs">
        <button class="metric-tab active" data-metric="avg_final_points">Средний балл</button>
        <button class="metric-tab" data-metric="avg_quality">Качество</button>
        <button class="metric-tab" data-metric="avg_kvz">КВЗ</button>
        <button class="metric-tab" data-metric="avg_efficiency">Эфф.</button>
        <button class="metric-tab" data-metric="penalty_minutes">Штрафы</button>
        <button class="metric-tab" data-metric="total_calls">Звонки</button>
        <button class="metric-tab" data-metric="final_points_sum">Сумма баллов</button>
      </div>
    </div>
    <div id="an-groups-metric-chart">${renderGroupsMetricChart(items, 'avg_final_points')}</div>
  </div>`;
}

function renderGroupsMetricChart(items, metric) {
  if (!items.length) return '<div class="empty-line">Нет данных</div>';
  const vals = items.map(g => g[metric] ?? 0);
  const maxV = Math.max(...vals, 1);
  return `<div class="an-bar-chart">
    ${items.map((g,i) => `<div class="an-bar-row">
      <div class="an-bar-date" style="width:120px">${esc(g.group_name)}</div>
      <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round((vals[i]/maxV)*100)}%"></div></div>
      <div class="an-bar-val">${fmtA(vals[i], metric==='total_calls'?0:2)}</div>
    </div>`).join('')}
  </div>`;
}

function bindGroupsMetricTabs(items) {
  document.querySelectorAll('#an-groups-metric-tabs .metric-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#an-groups-metric-tabs .metric-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('an-groups-metric-chart').innerHTML = renderGroupsMetricChart(items, btn.dataset.metric);
    });
  });
}

/* ── Вкладка: Матрицы ──────────────────────────────────────────*/
