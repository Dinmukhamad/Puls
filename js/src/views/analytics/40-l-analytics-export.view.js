/* Выделено из 40-reports-analytics.view.js (2671 строка).
   Вкладка «Экспорт»: выгрузки CSV и книги Excel. */

async function loadExportTab(content) {
  content.innerHTML = `<div class="an-card">
    <div class="an-card-head">Экспорт отчётов</div>
    <div class="an-export-grid">
      <button class="btn-primary an-export-xlsx-btn">Скачать Excel по текущим фильтрам</button>
      <button class="btn-outline an-export-btn" data-export="operators">Таблица операторов</button>
      <button class="btn-outline an-export-btn" data-export="groups">Сравнение групп</button>
      <button class="btn-outline an-export-btn" data-export="penalties">Штрафы</button>
      <button class="btn-outline an-export-btn" data-export="attention">Зона внимания</button>
      <button class="btn-outline an-export-btn" data-export="risks">Риски</button>
      <button class="btn-outline an-export-btn" data-export="quality_coverage">Качество прослушки</button>
    </div>
    <p style="font-size:12px;color:var(--text-muted);margin-top:14px">Экспорт учитывает выбранные фильтры периода, группы и оператора.</p>
  </div>`;

  content.querySelector('.an-export-xlsx-btn')?.addEventListener('click', downloadAnalyticsWorkbook);

  content.querySelectorAll('.an-export-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.export;
      btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Готовим…';
      try {
        await exportAnalyticsCsv(kind);
      } catch(e) { showToast('Ошибка экспорта: ' + e.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = orig; }
    });
  });
}

async function exportAnalyticsCsv(kind) {
  const base = analyticsBaseParams();
  const opParams = analyticsOpParams();

  if (kind === 'operators') {
    const d = await analyticsFetch('operators', opParams);
    exportOperatorsCsv(d.items || []);
  } else if (kind === 'groups') {
    const d = await analyticsFetch('groups-comparison', base);
    const rows = ['Группа;Операторов;Звонки;Качество;КВЗ;Эфф.%;Штраф мин;Итог баллов'];
    (d.items||[]).forEach(g => rows.push([g.group_name,g.operators_count,g.total_calls,g.avg_quality??'',g.avg_kvz??'',g.avg_efficiency??'',g.penalty_minutes,g.final_points_sum].join(';')));
    downloadCsv(rows, 'аналитика_группы.csv');
  } else if (kind === 'penalties') {
    const d = await analyticsFetch('penalties', base);
    const rows = ['Оператор;Группа;Сумма;Минуты;Потеря баллов'];
    (d.operators||[]).forEach(o => rows.push([o.full_name,o.group_name||'',o.penalty_sum,o.penalty_minutes,o.penalty_points].join(';')));
    downloadCsv(rows, 'аналитика_штрафы.csv');
  } else if (kind === 'attention') {
    const d = await analyticsFetch('top-and-attention', base);
    const rows = ['Оператор;Группа;Причина'];
    (d.attention_zone||[]).forEach(a => rows.push([a.full_name,a.group_name||'',a.reason].join(';')));
    downloadCsv(rows, 'аналитика_зона_внимания.csv');
  } else if (kind === 'risks') {
    const d = await analyticsFetch('operators', opParams);
    const rows = ['Оператор;Группа;Статус риска;Качество;КВЗ;Эфф.%;Штраф мин'];
    (d.items||[]).forEach(o => rows.push([o.full_name,o.group_name||'',o.risk_status,o.quality_avg??'',o.kvz??'',o.efficiency_percent??'',o.penalty_minutes].join(';')));
    downloadCsv(rows, 'аналитика_риски.csv');
  } else if (kind === 'quality_coverage') {
    const d = await analyticsFetch('quality-coverage', base);
    const rows = ['Группа;Операторов;Оцен.звонков;Среднее/опер;Без оценок;Ср.качество'];
    (d.by_group||[]).forEach(g => rows.push([g.group_name,g.operators_count,g.evaluated_calls,g.avg_evaluations_per_operator,g.operators_without_quality,g.avg_quality??''].join(';')));
    downloadCsv(rows, 'аналитика_качество_прослушки.csv');
  }
}

window.renderAnalytics = renderAnalytics;
