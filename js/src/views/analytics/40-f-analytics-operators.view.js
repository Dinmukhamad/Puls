/* Выделено из 40-reports-analytics.view.js (2671 строка).
   Вкладка «Операторы»: таблица, сортировка, экспорт. */

async function loadOperatorsTab(content) {
  // Один комбинированный запрос вместо 2
  const combined = await analyticsFetch('operators-combined', {
    ...analyticsOpParams(), page: _analyticsState.operatorPage, page_size: 100,
    sort_by: _analyticsState.operatorSort, sort_order: _analyticsState.operatorSortOrder,
  });
  const opsTable = combined;
  const topAttn = combined.top_and_attention || {};

  content.innerHTML =
    renderOperatorsTableBlock(opsTable) +
    renderAttentionZoneTableBlock(topAttn.attention_zone || []);

  bindOpsTableSort();

  content.querySelectorAll('[data-an-page]').forEach(button => button.addEventListener('click', () => {
    _analyticsState.operatorPage += button.dataset.anPage === 'next' ? 1 : -1;
    loadAnalyticsTab('operators');
  }));

  content.querySelector('#an-export-ops-btn')?.addEventListener('click', downloadAnalyticsWorkbook);
}

function downloadAnalyticsWorkbook() {
  window.location.href = api._base() + '/api/analytics/export.xlsx?' + new URLSearchParams(analyticsOpParams()).toString();
}

function renderAttentionZoneTableBlock(items) {
  function recommendation(reason) {
    if (reason.includes('качество')) return 'Провести разбор звонков';
    if (reason.includes('КВЗ')) return 'Поставить контрольную точку';
    if (reason.includes('эффективность')) return 'Проверить загрузку оператора';
    if (reason.includes('штраф')) return 'Проверить дисциплину';
    if (reason.includes('нет оценок')) return 'Проверить отсутствие оценок';
    if (reason.includes('нет базы')) return 'Проверить корректность табеля';
    return '—';
  }
  return `<div class="an-card">
    <div class="an-card-head" style="color:var(--warning)">Зона внимания (${items.length})</div>
    ${items.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Оператор</th><th>Группа</th><th>Проблемный показатель</th><th>Причина</th><th>Рекомендация</th></tr></thead>
      <tbody>${items.map(a => `<tr>
        <td class="name-cell">${esc(a.full_name)}</td>
        <td>${esc(a.group_name||'—')}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${esc(a.reason.split(',')[0])}</td>
        <td style="color:var(--warning);font-size:12px">${esc(a.reason)}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${esc(recommendation(a.reason))}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty-line">Операторов в зоне внимания нет</div>'}
  </div>`;
}

function bindOpsTableSort() {
  const wrap = document.getElementById('an-ops-table-wrap');
  if (!wrap) return;
  // Делегирование на постоянном контейнере: переживает пересортировку (innerHTML
  // меняется, но сам wrap — нет), поэтому и сортировка, и раскрытие строк работают.
  wrap.addEventListener('click', (e) => {
    const th = e.target.closest('.sortable');
    if (th && wrap.contains(th)) {
      const key = th.dataset.sort;
      if (_analyticsState.operatorSort === key) _analyticsState.operatorSortOrder = _analyticsState.operatorSortOrder === 'desc' ? 'asc' : 'desc';
      else { _analyticsState.operatorSort = key; _analyticsState.operatorSortOrder = 'desc'; }
      _analyticsState.operatorPage = 1;
      loadAnalyticsTab('operators');
      return;
    }
    const row = e.target.closest('.an-ops-row');
    if (row && wrap.contains(row)) {
      const idx = row.dataset.opRow;
      const detail = wrap.querySelector(`[data-op-detail="${idx}"]`);
      if (detail) {
        const open = detail.hidden;
        detail.hidden = !open;
        row.setAttribute('aria-expanded', String(open));
        row.classList.toggle('an-ops-row-open', open);
      }
    }
  });
  wrap.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('an-ops-row')) {
      e.preventDefault();
      e.target.click();
    }
  });
}

function exportOperatorsCsv(items) {
  const hasNorm = items.some(o => o.individual_norm_hours != null);
  const headers = ['ФИО','Группа','Звонки','Факт ч'];
  if (hasNorm) headers.push('Ставка','Норма ч','Выполн.%','Баллы за ч','Перераб.ч','Перераб.%');
  headers.push('База ч','КВЗ','Качество','Оцен.звонков','Эфф.%','Штраф мин','Итог','Риск');
  const rows = [headers.join(';')];
  items.forEach(o => {
    const row = [o.full_name, o.group_name||'', o.calls_total??'', o.total_hours??''];
    if (hasNorm) row.push(
      o.rate??'', o.individual_norm_hours??'', o.norm_completion_percent??'',
      o.hours_points??'', o.overtime_hours??'', o.overtime_percent??''
    );
    row.push(o.base_hours??'', o.kvz??'', o.quality_avg??'', o.quality_calls_count??'',
      o.efficiency_percent??'', o.penalty_minutes??'', o.final_points??'', o.risk_status??'');
    rows.push(row.join(';'));
  });
  downloadCsv(rows, 'аналитика_операторы.csv');
}

function downloadCsv(rows, filename) {
  const blob = new Blob(['\ufeff'+rows.join('\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}

/* ── Вкладка: Группы ──────────────────────────────────────────*/
