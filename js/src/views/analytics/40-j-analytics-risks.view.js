/* Выделено из 40-reports-analytics.view.js (2671 строка).
   Вкладка «Риски»: таблица операторов и разрез по группам. */

async function loadRisksTab(content) {
  const [riskPyramid, opsTable] = await Promise.all([
    analyticsFetch('risk-pyramid', analyticsBaseParams()),
    analyticsFetch('operators', analyticsOpParams()),
  ]);

  content.innerHTML =
    renderRiskPyramidBlock(riskPyramid) +
    renderRiskOperatorsTableBlock(opsTable.items || []) +
    renderRiskByGroupsBlock(riskPyramid, opsTable.items || []);

  document.querySelectorAll('.an-risk-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const status = cell.dataset.riskStatus;
      const detail = document.getElementById('an-risk-detail');
      const bucket = riskPyramid[status];
      if (!detail) return;
      if (!bucket || !bucket.operators.length) { detail.innerHTML = '<div class="empty-line">Операторов в этой категории нет</div>'; return; }
      detail.innerHTML = `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Оператор</th><th>Группа</th><th class="num">Качество</th><th class="num">КВЗ</th><th class="num">Эфф.%</th><th class="num">Штраф мин</th></tr></thead>
        <tbody>${bucket.operators.map(o => `<tr>
          <td class="name-cell">${esc(o.full_name)}</td><td>${esc(o.group_name||'—')}</td>
          <td class="num">${o.quality_avg!=null?fmtA(o.quality_avg):'—'}</td>
          <td class="num">${o.kvz!=null?fmtA(o.kvz):'—'}</td>
          <td class="num">${o.efficiency_percent!=null?fmtA(o.efficiency_percent):'—'}</td>
          <td class="num">${fmtA(o.penalty_minutes,1)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    });
  });
}

function renderRiskOperatorsTableBlock(items) {
  function reasons(o) {
    const r = [];
    if (o.risk_status === 'no_data') return riskStatusLabel('no_data');
    if (o.quality_avg != null && o.quality_avg < 80) r.push(`качество ${o.quality_avg}`);
    if (o.kvz != null && o.kvz < 8) r.push(`КВЗ ${o.kvz}`);
    if (o.efficiency_percent != null && o.efficiency_percent < 45) r.push(`эфф. ${o.efficiency_percent}%`);
    if (o.penalty_minutes > 10) r.push(`штрафы ${o.penalty_minutes} мин`);
    return r.length ? r.join(', ') : '—';
  }
  function recommend(status) {
    return { critical: 'Срочно провести разбор и контрольную точку', watch: 'Поставить на контроль',
      stable: 'Без действий', no_data: 'Проверить наличие данных' }[status] || '—';
  }
  const risky = items.filter(o => o.risk_status !== 'stable');
  return `<div class="an-card">
    <div class="an-card-head">Операторы по рискам</div>
    ${risky.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Оператор</th><th>Группа</th><th>Статус</th><th>Причины</th><th>Рекомендация</th></tr></thead>
      <tbody>${risky.map(o => `<tr>
        <td class="name-cell">${esc(o.full_name)}</td><td>${esc(o.group_name||'—')}</td>
        <td>${riskBadge(o.risk_status)}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${esc(reasons(o))}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${esc(recommend(o.risk_status))}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty-line">Все операторы стабильны</div>'}
  </div>`;
}

function renderRiskByGroupsBlock(riskPyramid, items) {
  const byGroup = {};
  items.forEach(o => {
    const g = o.group_name || 'Без группы';
    if (!byGroup[g]) byGroup[g] = { stable: 0, watch: 0, critical: 0, no_data: 0 };
    byGroup[g][o.risk_status] = (byGroup[g][o.risk_status] || 0) + 1;
  });
  const rows = Object.entries(byGroup);
  return `<div class="an-card">
    <div class="an-card-head">Риски по группам</div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Группа</th><th class="num">${riskStatusLabel('stable')}</th><th class="num">${riskStatusLabel('watch')}</th><th class="num">${riskStatusLabel('critical')}</th><th class="num">${riskStatusLabel('no_data')}</th></tr></thead>
      <tbody>${rows.map(([g,c]) => `<tr>
        <td class="name-cell">${esc(g)}</td>
        <td class="num" style="color:var(--success)">${c.stable||0}</td>
        <td class="num" style="color:var(--warning)">${c.watch||0}</td>
        <td class="num" style="color:var(--danger)">${c.critical||0}</td>
        <td class="num" style="color:var(--text-muted)">${c.no_data||0}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty-line">Нет данных</div>'}
  </div>`;
}

/* ── Вкладка: Баллы ───────────────────────────────────────────*/

/* ── Вкладка: Баллы (полный анализ итоговых баллов) ───────────*/
