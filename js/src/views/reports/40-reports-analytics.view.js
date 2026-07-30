function renderPeriodReport() {
  const el = document.getElementById('view-period-report');
  if (!el) return;

  let lastResult = null;
  let searchVal = '', filterGroup = '', sortKey = 'final_points', sortDir = 'desc';

  function fmtNum(v, decimals = 2) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Number(v).toFixed(decimals);
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Расчёт</div><h2 class="section-title">Расчёт показателей за период</h2></div>
    </div>

    <div class="pr-card">
      <div class="pr-card-head">Загрузка файлов</div>
      <div class="pr-upload-grid">
        <div class="form-group">
          <label class="form-label">Monthly Report — оценки качества звонков</label>
          <label class="pr-file-drop" for="pr-file-monthly" id="pr-file-monthly-drop">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span class="pr-file-drop-text">Нажмите, чтобы выбрать файл .xlsx</span>
          </label>
          <input id="pr-file-monthly" type="file" accept=".xlsx" hidden>
        </div>
        <div class="form-group">
          <label class="form-label">Report — часы, звонки, штрафы</label>
          <label class="pr-file-drop" for="pr-file-report" id="pr-file-report-drop">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span class="pr-file-drop-text">Нажмите, чтобы выбрать файл .xlsx</span>
          </label>
          <input id="pr-file-report" type="file" accept=".xlsx" hidden>
        </div>
      </div>
      <div id="pr-upload-status" class="status-line"></div>
      <button class="btn-primary" id="pr-upload-btn" style="margin-top:8px">Загрузить файлы</button>
    </div>

    <div class="pr-card">
      <div class="pr-card-head">Период расчёта</div>
      <div class="pr-period-row">
        <div class="form-group">
          <label class="form-label">Дата начала</label>
          <input id="pr-start-date" type="date" class="form-input">
        </div>
        <div class="form-group">
          <label class="form-label">Дата окончания</label>
          <input id="pr-end-date" type="date" class="form-input">
        </div>
        <button class="btn-primary" id="pr-calc-btn" style="align-self:flex-end">Рассчитать</button>
      </div>
      <div id="pr-calc-status" class="status-line"></div>
    </div>

    <div id="pr-results"></div>
  `;

  // File selection display
  function bindFileDrop(inputId, dropId) {
    const input = el.querySelector('#' + inputId);
    const drop = el.querySelector('#' + dropId);
    input?.addEventListener('change', () => {
      const file = input.files[0];
      const textEl = drop.querySelector('.pr-file-drop-text');
      if (file) {
        drop.classList.add('pr-file-drop-filled');
        textEl.textContent = file.name;
      } else {
        drop.classList.remove('pr-file-drop-filled');
        textEl.textContent = 'Нажмите, чтобы выбрать файл .xlsx';
      }
    });
  }
  bindFileDrop('pr-file-monthly', 'pr-file-monthly-drop');
  bindFileDrop('pr-file-report', 'pr-file-report-drop');

  // Проверяем, сохранены ли файлы в БД (переживают редеплой)
  (async () => {
    try {
      const status = await swrFetch('period-report:status', () => api.getPeriodReportStatus(), null, SWR_FAST_TTL_MS);
      const statusEl = el.querySelector('#pr-upload-status');
      if (status.monthly && status.report) {
        statusEl.innerHTML = `✓ Файлы уже загружены и сохранены: <b>${esc(status.monthly.filename)}</b>, <b>${esc(status.report.filename)}</b>. Можно сразу выбрать период.`;
        statusEl.className = 'status-line status-ok';
      } else if (status.monthly || status.report) {
        statusEl.textContent = 'Загружен только один из файлов — дозагрузите второй.';
        statusEl.className = 'status-line status-error';
      }
    } catch(e) { /* тихо игнорируем — не критично для работы страницы */ }
  })();

  // Upload handler
  el.querySelector('#pr-upload-btn').addEventListener('click', async () => {
    const monthlyFile = el.querySelector('#pr-file-monthly').files[0];
    const reportFile = el.querySelector('#pr-file-report').files[0];
    const statusEl = el.querySelector('#pr-upload-status');

    if (!monthlyFile || !reportFile) {
      statusEl.textContent = 'Выберите оба файла';
      statusEl.className = 'status-line status-error';
      return;
    }
    if (!monthlyFile.name.toLowerCase().endsWith('.xlsx') || !reportFile.name.toLowerCase().endsWith('.xlsx')) {
      statusEl.textContent = 'Файлы должны быть в формате .xlsx';
      statusEl.className = 'status-line status-error';
      return;
    }

    statusEl.textContent = 'Загружаем…';
    statusEl.className = 'status-line';

    const formData = new FormData();
    formData.append('monthly_report_file', monthlyFile);
    formData.append('report_file', reportFile);

    try {
      const data = await api.uploadPeriodReportFiles(formData);
      swrInvalidate('period-report:');
      statusEl.textContent = '✓ ' + data.message;
      statusEl.className = 'status-line status-ok';
    } catch (e) {
      statusEl.textContent = e.message;
      statusEl.className = 'status-line status-error';
    }
  });

  // Calculate handler
  el.querySelector('#pr-calc-btn').addEventListener('click', async () => {
    const startDate = el.querySelector('#pr-start-date').value;
    const endDate = el.querySelector('#pr-end-date').value;
    const statusEl = el.querySelector('#pr-calc-status');

    if (!startDate || !endDate) {
      statusEl.textContent = 'Укажите дату начала и окончания';
      statusEl.className = 'status-line status-error';
      return;
    }
    if (startDate > endDate) {
      statusEl.textContent = 'Дата начала не может быть позже даты окончания';
      statusEl.className = 'status-line status-error';
      return;
    }

    statusEl.textContent = 'Считаем…';
    statusEl.className = 'status-line';

    try {
      const res = await fetch(
        api._base() + `/api/reports/operators-period-summary?start_date=${startDate}&end_date=${endDate}`,
        { credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Ошибка расчёта');
      statusEl.textContent = '';
      lastResult = data;
      renderResults(data);
    } catch (e) {
      statusEl.textContent = e.message;
      statusEl.className = 'status-line status-error';
      el.querySelector('#pr-results').innerHTML = '';
    }
  });

  function renderResults(data) {
    const ops = data.operators || [];
    const w = data.warnings || {};
    const summary = data.summary || {};
    const groups = [...new Set(ops.map(o => o.group_name).filter(Boolean))].sort();

    // Сводные показатели приходят с backend — считаются только по matched-операторам
    // с реальными данными за период (см. ТЗ: matched-only summary).
    const fmtOrDash = (v, decimals = 2, suffix = '') =>
      (v === null || v === undefined) ? '—' : fmtNum(v, decimals) + suffix;

    function filteredSorted() {
      let r = ops.filter(o =>
        (!searchVal || o.full_name.toLowerCase().includes(searchVal.toLowerCase())) &&
        (!filterGroup || o.group_name === filterGroup)
      );
      r.sort((a, b) => {
        const av = a[sortKey] || 0, bv = b[sortKey] || 0;
        return sortDir === 'desc' ? bv - av : av - bv;
      });
      return r;
    }

    function sortIndicator(key) {
      if (sortKey !== key) return '';
      return sortDir === 'desc' ? ' ↓' : ' ↑';
    }

    function renderTable() {
      const rows = filteredSorted();
      if (!rows.length) return '<div class="empty-line">Нет данных для отображения</div>';
      return `<div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>Оператор</th><th>Группа</th>
          <th class="num sortable" data-sort="final_points">Баллы${sortIndicator('final_points')}</th>
          <th class="num sortable" data-sort="quality_avg">Качество${sortIndicator('quality_avg')}</th>
          <th class="num">Звонков оцен.</th>
          <th class="num">Итог часов</th>
          <th class="num">База часов</th>
          <th class="num sortable" data-sort="kvz">КВЗ${sortIndicator('kvz')}</th>
          <th class="num sortable" data-sort="efficiency_percent">Эфф. %${sortIndicator('efficiency_percent')}</th>
          <th class="num sortable" data-sort="penalty_minutes">Штраф мин${sortIndicator('penalty_minutes')}</th>
        </tr></thead>
        <tbody>
          ${rows.map(o => `
            <tr>
              <td class="name-cell">${esc(o.full_name)}</td>
              <td>${esc(o.group_name || '—')}</td>
              <td class="num"><b>${fmtNum(o.final_points)}</b></td>
              <td class="num">${o.quality_calls_count > 0 ? fmtNum(o.quality_avg) : '<span style="color:var(--text-muted)">нет оценок</span>'}</td>
              <td class="num">${o.quality_calls_count}</td>
              <td class="num">${fmtNum(o.total_hours)}</td>
              <td class="num">${fmtNum(o.base_hours)}</td>
              <td class="num">${fmtNum(o.kvz)}</td>
              <td class="num">${fmtNum(o.efficiency_percent)}%</td>
              <td class="num" style="${o.penalty_minutes > 0 ? 'color:var(--danger)' : ''}">${fmtNum(o.penalty_minutes, 1)}</td>
            </tr>
            ${o.warnings && o.warnings.length ? `<tr><td colspan="10" style="padding:4px 16px;background:var(--warning-soft)">
              <span style="font-size:11px;color:var(--warning)">⚠ ${o.warnings.map(esc).join(' · ')}</span>
            </td></tr>` : ''}
          `).join('')}
        </tbody>
      </table></div>`;
    }

    const totalWarnings = (w.site_only?.length||0) + (w.file_only?.length||0) +
      (w.no_quality?.length||0) + (w.no_base_hours?.length||0);

    function warnGroup(title, items, hint) {
      if (!items || !items.length) return '';
      return `<div class="pr-warn-group">
        <div class="pr-warn-group-title">${esc(title)} (${items.length})</div>
        ${hint ? `<div class="pr-warn-group-hint">${esc(hint)}</div>` : ''}
        <div class="pr-warn-chips">
          ${items.slice(0, 30).map(n => `<span class="pr-warn-chip">${esc(n)}</span>`).join('')}
          ${items.length > 30 ? `<span class="pr-warn-chip pr-warn-chip-more">+${items.length - 30}</span>` : ''}
        </div>
      </div>`;
    }

    el.querySelector('#pr-results').innerHTML = `
      <div class="pr-stats-row">
        <div class="pr-stat">
          <div class="pr-stat-val">${summary.operators_count ?? 0}</div>
          <div class="pr-stat-label">Операторов в расчёте</div>
        </div>
        <div class="pr-stat">
          <div class="pr-stat-val">${fmtOrDash(summary.avg_quality)}</div>
          <div class="pr-stat-label">${summary.avg_quality == null ? 'Нет оценок за период' : 'Сред. качество (по оценкам)'}</div>
        </div>
        <div class="pr-stat">
          <div class="pr-stat-val">${fmtOrDash(summary.total_calls, 0)}</div>
          <div class="pr-stat-label">Всего звонков</div>
        </div>
        <div class="pr-stat">
          <div class="pr-stat-val">${fmtOrDash(summary.avg_kvz)}</div>
          <div class="pr-stat-label">${summary.avg_kvz == null ? 'Нет базы часов' : 'Средний КВЗ'}</div>
        </div>
        <div class="pr-stat">
          <div class="pr-stat-val">${fmtOrDash(summary.avg_efficiency, 2, '%')}</div>
          <div class="pr-stat-label">${summary.avg_efficiency == null ? 'Нет базы часов' : 'Сред. эффективность'}</div>
        </div>
        <div class="pr-stat">
          <div class="pr-stat-val">${fmtOrDash(summary.penalty_minutes_total, 1)}</div>
          <div class="pr-stat-label">Штрафов, мин</div>
        </div>
      </div>

      ${summary.site_total_count != null ? `
      <div class="pr-match-info">
        Всего на сайте: <b>${summary.site_total_count}</b> ·
        Совпало с файлом: <b>${summary.matched_count}</b> ·
        Только на сайте: <b style="color:var(--warning)">${summary.site_only_count}</b> ·
        Только в файле: <b style="color:var(--warning)">${summary.file_only_count}</b>
      </div>` : ''}

      <div class="pr-save-banner">
        <div class="pr-save-banner-text">
          <div class="pr-save-banner-title">Это предварительный просмотр расчёта</div>
          <div class="pr-save-banner-sub">Данные ниже не сохранены. Чтобы они появились в рейтинге и истории начислений, нажмите «Сохранить расчёт».</div>
        </div>
        <button class="btn-primary pr-save-banner-btn" id="pr-save-btn-top">Сохранить расчёт</button>
      </div>

      ${totalWarnings ? `
      <div class="pr-card">
        <div class="pr-card-head">Предупреждения по данным (${totalWarnings})</div>
        ${warnGroup('Есть на сайте, но отсутствуют в файле', w.site_only,
          'Эти операторы не участвуют в расчёте за выбранный период.')}
        ${warnGroup('Есть в файле, но отсутствуют на сайте', w.file_only,
          'Игнорируются — не влияют на статистику и не появляются как операторы.')}
        ${warnGroup('Нет оценок качества за период', w.no_quality)}
        ${warnGroup('Нет базы часов за период', w.no_base_hours)}
      </div>` : ''}

      <div class="pr-card">
        <div class="pr-card-head-row">
          <span>Результаты по операторам</span>
          <div style="display:flex;gap:8px">
            <button class="btn-outline btn-sm" id="pr-export-btn">Экспорт CSV</button>
            <button class="btn-primary btn-sm" id="pr-save-btn">Сохранить расчёт</button>
          </div>
        </div>
        <div class="pr-filters-row">
          <input id="pr-search" class="form-input" placeholder="Поиск по ФИО…" style="max-width:240px">
          <select id="pr-group-filter" class="form-select" style="max-width:180px">
            <option value="">Все группы</option>
            ${groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}
          </select>
        </div>
        <div id="pr-table-wrap">${renderTable()}</div>
      </div>
    `;

    // Bind search/filter/sort
    el.querySelector('#pr-search')?.addEventListener('input', e => {
      searchVal = e.target.value;
      el.querySelector('#pr-table-wrap').innerHTML = renderTable();
      bindTableSort();
    });
    el.querySelector('#pr-group-filter')?.addEventListener('change', e => {
      filterGroup = e.target.value;
      el.querySelector('#pr-table-wrap').innerHTML = renderTable();
      bindTableSort();
    });

    function bindTableSort() {
      el.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort;
          if (sortKey === key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
          else { sortKey = key; sortDir = 'desc'; }
          el.querySelector('#pr-table-wrap').innerHTML = renderTable();
          bindTableSort();
        });
      });
    }
    bindTableSort();

    // Export CSV
    el.querySelector('#pr-export-btn')?.addEventListener('click', () => {
      const rows = filteredSorted();
      const headers = ['ФИО','Группа','Итоговые баллы','Кач-во','Звонков оцен.','Итог часов','База часов',
        'Техсбои','Тренинги','Офлайн','Звонки','КВЗ','Часы в звонке','Эфф. %','Штраф сумма','Штраф мин','Штраф баллы'];
      const csvRows = [headers.join(';')];
      rows.forEach(o => {
        csvRows.push([
          o.full_name, o.group_name || '', o.final_points, o.quality_avg, o.quality_calls_count,
          o.total_hours, o.base_hours, o.tech_issue_hours, o.training_hours, o.offline_activity_hours,
          o.calls_total, o.kvz, o.call_time_hours, o.efficiency_percent, o.penalty_sum, o.penalty_minutes, o.penalty_points
        ].join(';'));
      });
      const blob = new Blob(['\ufeff' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `период_${data.period.start}_${data.period.end}.csv`;
      a.click(); URL.revokeObjectURL(url);
    });

    // Save handler — открывает подтверждение сохранения (обе кнопки используют один обработчик)
    function openSaveModal() {
      showModal(`
        <h3 class="modal-title">Сохранить расчёт</h3>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px">
          Период: ${esc(data.period.start)} — ${esc(data.period.end)}. Будет сохранено ${ops.length} расчётов.
        </p>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:14px">
          <input type="checkbox" id="pr-award-coins-check">
          Начислить коины по формуле: баллы / 5 (округление вниз)
        </label>
        <div id="pr-save-err" class="status-line"></div>
        <button class="btn-primary" style="width:100%" id="pr-save-confirm-btn">Сохранить</button>
      `);
      document.getElementById('pr-save-confirm-btn').addEventListener('click', async () => {
        const awardCoins = document.getElementById('pr-award-coins-check').checked;
        const errEl = document.getElementById('pr-save-err');
        try {
          const result = await api.savePeriodReport({
            start_date: data.period.start,
            end_date: data.period.end,
            award_coins: awardCoins,
          });
          closeModal();
          swrInvalidate('period-report:');
          swrInvalidate('analytics:');
          swrInvalidate('coins:');
          swrInvalidate('rating:');
          showToast(result.message, 'ok');
          if (result.skipped_no_match?.length) {
            console.warn('Не сопоставлены с операторами в БД:', result.skipped_no_match);
          }
        } catch (e) {
          errEl.textContent = e.message;
          errEl.className = 'status-line status-error';
        }
      });
    }
    el.querySelector('#pr-save-btn')?.addEventListener('click', openSaveModal);
    el.querySelector('#pr-save-btn-top')?.addEventListener('click', openSaveModal);
  }
}

window.renderPeriodReport = renderPeriodReport;



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
  return `<div class="an-card">
    <div class="an-card-head-row">
      <span>Таблица эффективности операторов</span>
      <button class="btn-outline btn-sm" id="an-export-ops-btn">Экспорт CSV</button>
    </div>
    <div id="an-ops-table-wrap">${renderOpsTable(items, 'final_points', 'desc')}</div>
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

  return `<div class="table-wrap"><table class="data-table">
    <thead><tr>
      <th>#</th><th>Оператор</th><th>Группа</th>
      <th class="num sortable" data-sort="calls_total">Звонки${sortAttr('calls_total')}</th>
      <th class="num">Факт ч.</th>
      ${hasNorm ? `
      <th class="num">Ставка</th>
      <th class="num sortable" data-sort="individual_norm_hours">Норма${sortAttr('individual_norm_hours')}</th>
      <th class="num sortable" data-sort="norm_completion_percent">Выполн.${sortAttr('norm_completion_percent')}</th>
      <th class="num sortable" data-sort="hours_points">Б.за ч.${sortAttr('hours_points')}</th>
      <th class="num">Перераб.</th>
      ` : ''}
      <th class="num sortable" data-sort="kvz">КВЗ${sortAttr('kvz')}</th>
      <th class="num sortable" data-sort="quality_avg">Качество${sortAttr('quality_avg')}</th>
      <th class="num sortable" data-sort="efficiency_percent">Эфф.%${sortAttr('efficiency_percent')}</th>
      <th class="num sortable" data-sort="penalty_minutes">Штраф м.${sortAttr('penalty_minutes')}</th>
      <th class="num sortable" data-sort="final_points">Итог${sortAttr('final_points')}</th>
      <th>Риск</th>
    </tr></thead>
    <tbody>
      ${sorted.map((o, i) => `
        <tr class="${i<3?'an-row-top3':''}">
          <td>${i+1}</td>
          <td class="name-cell">${esc(o.full_name)}</td>
          <td>${esc(o.group_name||'—')}</td>
          <td class="num">${fmtA(o.calls_total,0)}</td>
          <td class="num">${fmtA(o.total_hours,1)}</td>
          ${hasNorm ? `
          <td class="num">${o.rate != null ? `<span class="rate-badge ${o.rate===0.5?'rate-half':o.rate===0.75?'rate-three-q':'rate-full'}">${o.rate}</span>` : '<span class="cell-muted">—</span>'}</td>
          <td class="num">${o.individual_norm_hours != null ? fmtA(o.individual_norm_hours,1)+' ч' : '<span class="cell-muted">—</span>'}</td>
          <td class="num">${normCompletionHtml(o)}</td>
          <td class="num">${o.hours_points != null ? `<b>${fmtA(o.hours_points,1)}</b><span style="color:var(--tx3)">/25</span>` : '<span class="cell-muted">—</span>'}</td>
          <td class="num">${o.overtime_hours > 0 ? `<span style="color:var(--success)">+${fmtA(o.overtime_hours,1)}ч</span>` : '—'}</td>
          ` : ''}
          <td class="num">${fmtA(o.kvz)}</td>
          <td class="num" style="${o.quality_avg!=null?'color:'+qualityColor(o.quality_band)+';font-weight:600':''}">${o.quality_avg!=null?fmtA(o.quality_avg):'нет оценок'}</td>
          <td class="num">${fmtA(o.efficiency_percent,2,'%')}</td>
          <td class="num" style="${o.penalty_minutes>0?'color:var(--danger)':''}">${fmtA(o.penalty_minutes,1)}</td>
          <td class="num"><b>${fmtA(o.final_points)}</b></td>
          <td>${riskBadge(o.risk_status)}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

/* ── Block: Groups comparison ───────────────────────────────────*/
function renderGroupsComparisonBlock(groupsCmp) {
  const items = groupsCmp.items || [];
  if (!items.length) return `<div class="an-card"><div class="an-card-head">Сравнение групп</div><div class="empty-line">Нет данных</div></div>`;
  const maxPts = Math.max(...items.map(g => g.final_points_sum || 0), 1);
  return `<div class="an-card">
    <div class="an-card-head">Сравнение групп</div>
    <div class="an-bar-chart" style="margin-bottom:16px">
      ${items.map(g => `
        <div class="an-bar-row">
          <div class="an-bar-date" style="width:120px">${esc(g.group_name)}</div>
          <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round((g.final_points_sum/maxPts)*100)}%"></div></div>
          <div class="an-bar-val">${fmtA(g.final_points_sum,0)}</div>
        </div>`).join('')}
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>Группа</th><th class="num">Операторов</th><th class="num">Звонки</th>
        <th class="num">Качество</th><th class="num">КВЗ</th><th class="num">Эфф.%</th>
        <th class="num">Штраф мин</th><th class="num">Без оценок</th><th class="num">В риске</th>
      </tr></thead>
      <tbody>
        ${items.map(g => `<tr>
          <td class="name-cell">${esc(g.group_name)}</td>
          <td class="num">${g.operators_count}</td>
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
/* ══════════════════════════════════════
   VIEW: АНАЛИТИКА — с горизонтальными табами
══════════════════════════════════════ */
/* ══════════════════════════════════════
   ФОНОВЫЙ ПРОГРЕВ КЕША АНАЛИТИКИ
   Запускается через 3с после входа admin/manager.
   Загружает данные в sessionStorage-кеш тихо, в фоне.
   Когда пользователь откроет Аналитику — данные уже там.
══════════════════════════════════════ */
async function prefetchAnalyticsInBackground() {
  // Не запускаем если сейчас открыта Аналитика — там и так грузятся данные
  if (STATE.currentView === 'analytics') return;

  // Определяем период: берём последний доступный из already-loaded данных
  // или стандартно — последние 30 дней
  let startDate, endDate;
  try {
    const periods = await fetch(api._base() + '/api/analytics/available-periods', {
      credentials: 'include'
    }).then(r => r.ok ? r.json() : null).catch(() => null);

    if (periods?.items?.length) {
      _analyticsState.availablePeriods = periods.items;
      // Берём самый свежий период из уже рассчитанных
      const latest = periods.items[0];
      startDate = latest.start_date;
      endDate   = latest.end_date;
    } else {
      // Нет готовых расчётов — берём текущий месяц
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      startDate = new Date(y, m, 1).toISOString().slice(0, 10);
      endDate   = now.toISOString().slice(0, 10);
    }
  } catch {
    return; // Не удалось получить периоды — тихо выходим
  }

  // Обновляем _analyticsState чтобы при открытии Аналитики даты совпали
  if (!_analyticsState.startDate) {
    _analyticsState.startDate = startDate;
    _analyticsState.endDate   = endDate;
  }

  const base = { start_date: startDate, end_date: endDate };
  const full = { ...base };

  // Грузим все основные вкладки параллельно, тихо — ошибки игнорируем
  // Приоритет: сначала Обзор (самая частая), потом остальные
  const prefetchQueue = [
    () => analyticsFetch('management-dashboard', full),
    () => analyticsFetch('operators-combined',  full),
    () => analyticsFetch('groups-comparison',   base),
    () => analyticsFetch('matrix-combined',     base),
    () => analyticsFetch('quality-combined',    base),
    () => analyticsFetch('risk-pyramid',        base),
    () => analyticsFetch('penalties',           base),
    () => analyticsFetch('points',              full),
  ];

  // Запускаем с небольшими задержками — не грузим сервер сразу всеми запросами
  for (let i = 0; i < prefetchQueue.length; i++) {
    // Прерываем если пользователь ушёл — его данные уже загружает renderAnalytics
    if (STATE.currentView === 'analytics') break;
    await new Promise(r => setTimeout(r, 400)); // 400мс между запросами
    prefetchQueue[i]().catch(() => {}); // тихо, без throw
  }
}

const ANALYTICS_TABS = [
  { key: 'overview',   label: 'Сводка',            group: 'primary' },
  { key: 'operators',  label: 'Операторы',         group: 'primary' },
  { key: 'groups',     label: 'Группы',            group: 'primary' },
  { key: 'quality',    label: 'Контроль качества', group: 'primary' },
  { key: 'dynamics',   label: 'По дням',           group: 'primary' },
  { key: 'risks',      label: 'Риски',             group: 'primary' },
  { key: 'matrix',     label: 'Связь показателей', group: 'more' },
  { key: 'penalties',  label: 'Штрафы',            group: 'more' },
  { key: 'points',     label: 'Расчёт баллов',     group: 'more' },
  { key: 'export',     label: 'Выгрузка',          group: 'more' },
];

function getAnalyticsParams() {
  const qs = new URLSearchParams(location.hash.replace(/^#analytics\??/, ''));
  return {
    tab: qs.get('tab') || 'overview',
    start: qs.get('start') || null,
    end: qs.get('end') || null,
    group: qs.get('group') || '',
    operator: qs.get('operator') || '',
    participation: qs.get('participation') || 'all',
    onlyData: qs.get('onlyData') === '1',
  };
}

function setAnalyticsUrl(params) {
  const qs = new URLSearchParams();
  qs.set('tab', params.tab);
  if (params.start) qs.set('start', params.start);
  if (params.end) qs.set('end', params.end);
  if (params.group) qs.set('group', params.group);
  if (params.operator) qs.set('operator', params.operator);
  if (params.participation && params.participation !== 'all') qs.set('participation', params.participation);
  if (params.onlyData) qs.set('onlyData', '1');
  history.replaceState(null, '', '#analytics?' + qs.toString());
}

let _analyticsState = {
  tab: 'overview',
  startDate: null,
  endDate: null,
  groupId: '',
  operatorQuery: '',
  participationStatus: 'all',
  onlyWithData: false,
  groups: [],
  availablePeriods: [],
  coverageWithData: null,
  coverageTotal: null,
  lastUpdatedAt: null,
};

function analyticsApiUrl(path, params) {
  const qs = new URLSearchParams(params).toString();
  return api._base() + '/api/analytics/' + path + (qs ? '?' + qs : '');
}

const ANALYTICS_SWR_TTL_MS = 10 * 60_000; // 10 минут — данные построены из PeriodReport, меняются очень редко

async function analyticsFetch(path, params, onUpdate) {
  const key = 'analytics:' + path + ':' + JSON.stringify(params || {});
  return swrFetch(key, async () => {
    const res = await fetch(analyticsApiUrl(path, params), { credentials: 'include' });
    // Сначала читаем как текст — backend при 500 может вернуть обычный
    // текст ("Internal Server Error"), а не JSON; res.json() в этом случае
    // падает с "Unexpected token 'I'..." вместо понятной ошибки пользователю.
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text?.slice(0, 200) || `Ошибка ${res.status}`);
    }
    if (!res.ok) {
      const msg = data.detail || data.error || `Ошибка ${res.status}`;
      const error = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      error.status = res.status;
      throw error;
    }
    return data;
  }, onUpdate, ANALYTICS_SWR_TTL_MS);
}

async function resolveInitialAnalyticsPeriod(urlParams) {
  let periods = [];
  try {
    const data = await analyticsFetch('available-periods', {});
    periods = Array.isArray(data?.items) ? data.items : [];
  } catch { /* the regular empty state will explain unavailable data */ }

  _analyticsState.availablePeriods = periods;
  const requestedStart = urlParams.start;
  const requestedEnd = urlParams.end;
  const requestedHasData = requestedStart && requestedEnd && periods.some(period =>
    requestedStart <= period.end_date && requestedEnd >= period.start_date
  );

  if (requestedHasData) return { start: requestedStart, end: requestedEnd };
  if (periods.length) return { start: periods[0].start_date, end: periods[0].end_date };
  if (requestedStart && requestedEnd) return { start: requestedStart, end: requestedEnd };

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  return { start: weekAgo.toISOString().slice(0, 10), end: today.toISOString().slice(0, 10) };
}

function fmtA(v, decimals = 2, suffix = '') {
  if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '—';
  return Number(v).toFixed(decimals) + suffix;
}

// Единая канонизация статусов по всей аналитике (ТЗ §1.3, AC-02): раньше
// «В норме/Наблюдать/Критично/Нет данных» дублировались с разными формулировками
// в разных блоках (местами даже «Стабильные»/«Нужен контроль»). Теперь один
// источник правды — риск (стабильно/наблюдать/критично) не путается с
// отсутствием данных (AC-18).
const RISK_STATUS_LABELS = {
  stable: 'Цель выполнена',
  watch: 'Есть отклонение',
  critical: 'Нужно вмешательство',
  no_data: 'Недостаточно данных',
};
function riskStatusLabel(status) {
  return RISK_STATUS_LABELS[status] || RISK_STATUS_LABELS.no_data;
}

/* ── Единый контекст-бар над всеми вкладками (ТЗ §2) ───────────────── */

const RU_MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function analyticsPeriodLabel(startISO, endISO) {
  if (!startISO || !endISO) return '—';
  const [sy, sm, sd] = startISO.split('-').map(Number);
  const [ey, em, ed] = endISO.split('-').map(Number);
  if (sy === ey && sm === em) {
    return `${sd}–${ed} ${RU_MONTHS_GENITIVE[em - 1]} ${ey}`;
  }
  if (sy === ey) {
    return `${sd} ${RU_MONTHS_GENITIVE[sm - 1]} – ${ed} ${RU_MONTHS_GENITIVE[em - 1]} ${ey}`;
  }
  return `${sd} ${RU_MONTHS_GENITIVE[sm - 1]} ${sy} – ${ed} ${RU_MONTHS_GENITIVE[em - 1]} ${ey}`;
}

function analyticsScopeLabel() {
  const s = _analyticsState;
  const parts = [];
  if (s.groupId) {
    const group = s.groups.find(g => String(g.id) === String(s.groupId));
    parts.push(group ? `группа «${group.name}»` : 'выбранная группа');
  } else {
    parts.push('вся команда');
  }
  if (s.operatorQuery) parts.push(`поиск «${s.operatorQuery}»`);
  if (s.participationStatus === 'participating') parts.push('только участвующие');
  if (s.participationStatus === 'not_participating') parts.push('не участвующие');
  if (s.onlyWithData) parts.push('только с данными');
  return parts.join(', ');
}

function analyticsCoverageLabel() {
  const s = _analyticsState;
  if (s.coverageTotal == null) return 'охват уточняется…';
  if (!s.coverageTotal) return 'нет операторов в области';
  return `${s.coverageWithData} из ${s.coverageTotal} операторов имеют данные`;
}

function analyticsUpdatedLabel() {
  const t = _analyticsState.lastUpdatedAt;
  if (!t) return 'обновляется…';
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `обновлено ${hh}:${mm}`;
}

function analyticsAvailabilityNote() {
  const periods = _analyticsState.availablePeriods;
  const s = _analyticsState;
  if (!periods.length || !s.startDate || !s.endDate) return '';
  const minStart = periods.reduce((min, p) => p.start_date < min ? p.start_date : min, periods[0].start_date);
  const maxEnd = periods.reduce((max, p) => p.end_date > max ? p.end_date : max, periods[0].end_date);
  if (s.startDate >= minStart && s.endDate <= maxEnd) return '';
  return `Данные доступны с ${analyticsPeriodLabel(minStart, minStart).split(' ').slice(0,2).join(' ')} ${minStart.slice(0,4)} по ${analyticsPeriodLabel(maxEnd, maxEnd).split(' ').slice(0,2).join(' ')} ${maxEnd.slice(0,4)}.`;
}

function renderAnalyticsContextBar() {
  const note = analyticsAvailabilityNote();
  return `<div class="an-context-bar" id="an-context-bar" role="status">
    <span class="an-context-line">Показаны результаты: ${esc(analyticsScopeLabel())} · ${esc(analyticsPeriodLabel(_analyticsState.startDate, _analyticsState.endDate))} · <span id="an-context-coverage">${esc(analyticsCoverageLabel())}</span> · <span id="an-context-updated">${esc(analyticsUpdatedLabel())}</span></span>
    ${note ? `<span class="an-context-note">${esc(note)}</span>` : ''}
  </div>`;
}

function refreshAnalyticsContextBar(el) {
  const cov = el.querySelector('#an-context-coverage');
  const upd = el.querySelector('#an-context-updated');
  if (cov) cov.textContent = analyticsCoverageLabel();
  if (upd) upd.textContent = analyticsUpdatedLabel();
}

async function refreshAnalyticsCoverage(el) {
  try {
    const dashboard = await analyticsFetch('management-dashboard', analyticsOpParams());
    const health = dashboard.team_health || {};
    _analyticsState.coverageWithData = health.operators_with_data ?? 0;
    _analyticsState.coverageTotal = health.operators_count ?? 0;
    _analyticsState.lastUpdatedAt = new Date();
    refreshAnalyticsContextBar(el);
  } catch { /* контекст-бар остаётся с прежними числами до следующей попытки */ }
}

function qualityColor(band) {
  return { green: 'var(--success)', yellow: '#D97706', orange: '#EA580C', red: 'var(--danger)' }[band] || 'var(--text-muted)';
}

function riskBadge(status) {
  const colors = {
    stable: { color: 'var(--success)', bg: 'var(--success-soft)' },
    watch: { color: 'var(--warning)', bg: 'var(--warning-soft)' },
    critical: { color: 'var(--danger)', bg: 'var(--danger-soft)' },
    no_data: { color: 'var(--text-muted)', bg: 'var(--bg-muted)' },
  };
  const c = colors[status] || colors.no_data;
  return `<span class="risk-badge" style="color:${c.color};background:${c.bg}">${riskStatusLabel(status)}</span>`;
}

async function renderAnalytics() {
  const el = document.getElementById('view-analytics');
  if (!el) return;
  const myNavGen = STATE.navGen;

  const urlParams = getAnalyticsParams();

  if (!_analyticsState.startDate) {
    const initialPeriod = await resolveInitialAnalyticsPeriod(urlParams);
    if (isNavStale(myNavGen)) return;
    _analyticsState.startDate = initialPeriod.start;
    _analyticsState.endDate = initialPeriod.end;
    _analyticsState.tab = urlParams.tab;
    _analyticsState.groupId = urlParams.group;
    _analyticsState.operatorQuery = urlParams.operator;
    _analyticsState.participationStatus = urlParams.participation;
    _analyticsState.onlyWithData = urlParams.onlyData;
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Аналитика</div><h2 class="section-title">Пульс команды</h2><p class="section-subtitle">Риски, отклонения и приоритеты руководителя за выбранный период.</p></div>
    </div>
    ${renderAnalyticsContextBar()}
    <div class="an-filters-card">
      <div class="an-filters-row">
        <div class="form-group">
          <label class="form-label">Период с</label>
          <input id="an-start" type="date" class="form-input" value="${_analyticsState.startDate}">
        </div>
        <div class="form-group">
          <label class="form-label">по</label>
          <input id="an-end" type="date" class="form-input" value="${_analyticsState.endDate}">
        </div>
        <div class="form-group">
          <label class="form-label">Группа</label>
          <select id="an-group" class="form-select"><option value="">Все группы</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">Оператор</label>
          <input id="an-operator" type="text" class="form-input" placeholder="Поиск по ФИО" value="${esc(_analyticsState.operatorQuery)}">
        </div>
        <div class="form-group">
          <label class="form-label">Статус участия</label>
          <select id="an-participation" class="form-select">
            <option value="all">Все</option>
            <option value="participating">Участвует</option>
            <option value="not_participating">Не участвует</option>
          </select>
        </div>
        <label class="an-checkbox-label">
          <input type="checkbox" id="an-only-data" ${_analyticsState.onlyWithData ? 'checked' : ''}>
          Только с данными
        </label>
        <button class="btn-primary" id="an-apply-btn">Применить</button>
      </div>
      ${_analyticsState.availablePeriods.length ? `<div class="an-period-availability">Доступные данные: ${esc(_analyticsState.availablePeriods[0].label)}</div>` : ''}
      <div id="an-availability-warning"></div>
    </div>

    <nav class="an-nav" id="an-tabs" aria-label="Аналитика — разделы">
      <div class="an-nav-primary">
        ${ANALYTICS_TABS.filter(t => t.group === 'primary').map(t => `<button type="button" class="an-nav-tab ${t.key===_analyticsState.tab?'active':''}" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
        <div class="an-nav-more-wrap">
          <button type="button" class="an-nav-tab an-nav-more-btn ${ANALYTICS_TABS.some(t=>t.group==='more'&&t.key===_analyticsState.tab)?'active':''}" id="an-nav-more-btn" aria-haspopup="true" aria-expanded="false">
            <span class="an-nav-more-label">${(() => { const cur = ANALYTICS_TABS.find(t => t.group === 'more' && t.key === _analyticsState.tab); return cur ? `Ещё: ${esc(cur.label)}` : 'Ещё'; })()}</span>
            <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="an-nav-more-menu" id="an-nav-more-menu" role="menu" hidden>
            ${ANALYTICS_TABS.filter(t => t.group === 'more').map(t => `<button type="button" role="menuitem" class="an-nav-more-item ${t.key===_analyticsState.tab?'active':''}" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
          </div>
        </div>
      </div>
      <label class="an-nav-mobile-wrap">
        <span class="sr-only">Раздел аналитики</span>
        <select class="an-nav-mobile-select" id="an-nav-mobile-select" aria-label="Раздел аналитики">
          ${ANALYTICS_TABS.map(t => `<option value="${t.key}" ${t.key===_analyticsState.tab?'selected':''}>${esc(t.label)}</option>`).join('')}
        </select>
      </label>
    </nav>

    <div id="an-tab-content" class="analytics-tab-content">
      <div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>
    </div>
  `;

  try {
    const gdata = await analyticsFetch('groups-list', {});
    if (isNavStale(myNavGen)) return; // ушли с "Аналитики" пока ждали список групп
    _analyticsState.groups = gdata.items || [];
    const sel = el.querySelector('#an-group');
    sel.innerHTML = '<option value="">Все группы</option>' +
      _analyticsState.groups.map(g => `<option value="${g.id}" ${String(g.id)===_analyticsState.groupId?'selected':''}>${esc(g.name)}</option>`).join('');
  } catch(e) { /* groups list optional */ }
  if (isNavStale(myNavGen)) return;

  el.querySelector('#an-participation').value = _analyticsState.participationStatus;

  function syncStateFromFilters() {
    _analyticsState.startDate = el.querySelector('#an-start').value;
    _analyticsState.endDate = el.querySelector('#an-end').value;
    _analyticsState.groupId = el.querySelector('#an-group').value;
    _analyticsState.operatorQuery = el.querySelector('#an-operator').value;
    _analyticsState.participationStatus = el.querySelector('#an-participation').value;
    _analyticsState.onlyWithData = el.querySelector('#an-only-data').checked;
  }

  function updateUrl() {
    setAnalyticsUrl({
      tab: _analyticsState.tab,
      start: _analyticsState.startDate,
      end: _analyticsState.endDate,
      group: _analyticsState.groupId,
      operator: _analyticsState.operatorQuery,
      participation: _analyticsState.participationStatus,
      onlyData: _analyticsState.onlyWithData,
    });
  }

  el.querySelector('#an-apply-btn').addEventListener('click', () => {
    syncStateFromFilters();
    updateUrl();
    refreshAnalyticsContextBar(el);
    refreshAnalyticsCoverage(el);
    loadAnalyticsTab(_analyticsState.tab);
  });

  /* ── Навигация: 6 основных вкладок + «Ещё» (desktop), один select (mobile).
     ТЗ §1.2 — горизонтальный скролл вкладок убран; на мобильном один выпадающий
     список «Раздел аналитики». data-tab + id="an-tabs" сохранены для обратной
     совместимости с data-an-open-tab (клик по причине в Сводке открывает вкладку). */
  function prefetchTab(tab) {
    if (tab === _analyticsState.tab) return;
    const base = analyticsBaseParams();
    const full = analyticsOpParams();
    switch (tab) {
      case 'overview':   analyticsFetch('management-dashboard', full).catch(() => {}); break;
      case 'operators':  analyticsFetch('operators-combined', full).catch(() => {}); break;
      case 'groups':     analyticsFetch('groups-comparison', base).catch(() => {}); break;
      case 'matrix':     analyticsFetch('matrix-combined', base).catch(() => {}); break;
      case 'quality':    analyticsFetch('quality-combined', base).catch(() => {}); break;
      case 'penalties':  analyticsFetch('penalties', base).catch(() => {}); break;
      case 'risks':      analyticsFetch('risk-pyramid', base).catch(() => {}); break;
      case 'points':     analyticsFetch('points', full).catch(() => {}); break;
    }
  }

  const moreMenu = el.querySelector('#an-nav-more-menu');
  const moreBtn = el.querySelector('#an-nav-more-btn');
  function closeMoreMenu() {
    if (!moreMenu || moreMenu.hidden) return;
    moreMenu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
  }
  function openMoreMenu() {
    moreMenu.hidden = false;
    moreBtn.setAttribute('aria-expanded', 'true');
  }

  function switchAnalyticsTab(tab) {
    if (!ANALYTICS_TABS.some(t => t.key === tab)) return;
    _analyticsState.tab = tab;
    el.querySelectorAll('#an-tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const moreActive = ANALYTICS_TABS.some(t => t.group === 'more' && t.key === tab);
    if (moreBtn) {
      moreBtn.classList.toggle('active', moreActive);
      const curMore = ANALYTICS_TABS.find(t => t.group === 'more' && t.key === tab);
      const label = moreBtn.querySelector('.an-nav-more-label');
      if (label) label.textContent = curMore ? `Ещё: ${curMore.label}` : 'Ещё';
    }
    const select = el.querySelector('#an-nav-mobile-select');
    if (select) select.value = tab;
    closeMoreMenu();
    updateUrl();
    loadAnalyticsTab(tab);
  }

  el.querySelectorAll('#an-tabs [data-tab]').forEach(btn => {
    btn.addEventListener('mouseenter', () => prefetchTab(btn.dataset.tab), { passive: true });
    btn.addEventListener('click', () => switchAnalyticsTab(btn.dataset.tab));
  });

  if (moreBtn && moreMenu) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (moreMenu.hidden) openMoreMenu(); else closeMoreMenu();
    });
    document.addEventListener('click', (e) => {
      if (!moreMenu.hidden && !moreMenu.contains(e.target) && e.target !== moreBtn) closeMoreMenu();
    });
    moreMenu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMoreMenu(); moreBtn.focus(); } });
    moreBtn.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMoreMenu(); });
  }

  const mobileSelect = el.querySelector('#an-nav-mobile-select');
  if (mobileSelect) {
    mobileSelect.addEventListener('change', () => switchAnalyticsTab(mobileSelect.value));
  }

  updateUrl();
  if (isNavStale(myNavGen)) return;
  refreshAnalyticsCoverage(el); // фоново — не блокирует первую отрисовку вкладки
  await loadAnalyticsTab(_analyticsState.tab);
}

function analyticsBaseParams() {
  const s = _analyticsState;
  const p = { start_date: s.startDate, end_date: s.endDate };
  if (s.groupId) p.group_id = s.groupId;
  return p;
}
function analyticsOpParams() {
  const s = _analyticsState;
  const p = analyticsBaseParams();
  if (s.operatorQuery) p.operator_query = s.operatorQuery;
  if (s.participationStatus !== 'all') p.participation_status = s.participationStatus;
  if (s.onlyWithData) p.only_with_data = 'true';
  return p;
}

/* ── Ленивая загрузка по активной вкладке ─────────────────── */
/**
 * Запрашивает /summary только для получения data_availability_warning
 * (см. backend ТЗ п.8) и показывает понятное предупреждение прямо под
 * фильтрами — независимо от того, какая вкладка аналитики сейчас открыта.
 */
async function refreshAvailabilityWarning() {
  const box = document.getElementById('an-availability-warning');
  if (!box) return;
  try {
    const summary = await analyticsFetch('summary', analyticsOpParams());
    const msg = summary.data_availability_warning;
    box.innerHTML = msg
      ? `<div class="an-availability-note">${esc(msg)}</div>`
      : '';
  } catch(e) {
    // Если /summary вернул 404 (совсем нет данных) — analyticsFetch бросит
    // ошибку с тем же текстом, что и data_availability_warning на backend.
    box.innerHTML = `<div class="an-availability-note an-availability-note-error">${esc(e.message)}</div>`;
  }
}

async function loadAnalyticsTab(tab) {
  const content = document.getElementById('an-tab-content');
  if (!content) return;
  const myNavGen = STATE.navGen;
  const myTabGen = bumpAnalyticsTabGen();
  // warning обновляется вместе с данными вкладки (в loadOverviewTab) без отдельного запроса
  // Спиннер показываем с небольшой задержкой (150мс) — если данные придут
  // из кеша почти мгновенно (swrFetch отдаёт их синхронно из sessionStorage),
  // спиннер просто не успеет появиться, и переключение вкладок будет
  // выглядеть мгновенным вместо "мигающего лоадера на каждый клик".
  let spinnerShown = false;
  const spinnerTimer = setTimeout(() => {
    if (isNavStale(myNavGen) || isAnalyticsTabStale(myTabGen)) return;
    spinnerShown = true;
    content.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Считаем показатели…</p></div>';
  }, 150);

  try {
    switch (tab) {
      case 'overview':  await loadOverviewTab(content); break;
      case 'operators': await loadOperatorsTab(content); break;
      case 'groups':    await loadGroupsTab(content); break;
      case 'matrix':    await loadMatrixTab(content); break;
      case 'quality':   await loadQualityTab(content); break;
      case 'dynamics':  await loadDynamicsTab(content); break;
      case 'penalties': await loadPenaltiesTab(content); break;
      case 'risks':     await loadRisksTab(content); break;
      case 'points':    await loadPointsTab(content); break;
      case 'export':    await loadExportTab(content); break;
      default: content.innerHTML = '<div class="empty-line">Вкладка не найдена</div>';
    }
  } catch(e) {
    clearTimeout(spinnerTimer);
    if (isNavStale(myNavGen) || isAnalyticsTabStale(myTabGen)) return;
    content.innerHTML = `<div class="an-card"><div class="status-line status-error">Не удалось загрузить: ${esc(e.message)}</div></div>`;
    return;
  }
  clearTimeout(spinnerTimer);
  if (isNavStale(myNavGen) || isAnalyticsTabStale(myTabGen)) {
    content.innerHTML = '';
  }
}

/* ── Вкладка: Обзор ──────────────────────────────────────────*/
async function loadOverviewTab(content) {
  const [dashboard, dynamics] = await Promise.all([
    analyticsFetch('management-dashboard', analyticsOpParams()),
    analyticsFetch('daily-dynamics', { ...analyticsBaseParams(), metric: 'calls' }).catch(() => ({ items: [] })),
  ]);

  const warnBox = document.getElementById('an-availability-warning');
  if (warnBox && dashboard.data_availability_warning) {
    warnBox.innerHTML = `<div class="an-availability-note">${esc(dashboard.data_availability_warning)}</div>`;
  } else if (warnBox) {
    warnBox.innerHTML = '';
  }

  content.innerHTML = renderManagementDashboard(dashboard, dynamics.items || []);
  bindManagementDashboard(content);
}

function analyticsStatusLabel(status) {
  return riskStatusLabel(status);
}

function analyticsMetricValue(value, unit) {
  return value == null ? '—' : `${fmtA(value, value % 1 ? 1 : 0)}${unit || ''}`;
}

function renderManagementDashboard(data, dynamics) {
  const health = data.team_health || {};
  const metrics = data.metric_cards || [];
  const risks = data.risk_distribution || {};
  const bottlenecks = data.bottlenecks || [];
  const groups = data.groups || [];
  const priorities = data.priority_operators || [];
  const leaders = data.top_performers || [];
  const totalRisk = (risks.stable || 0) + (risks.watch || 0) + (risks.critical || 0) + (risks.no_data || 0) || 1;
  const maxBottleneck = Math.max(...bottlenecks.map(item => item.count || 0), 1);

  if (!health.operators_count) return renderAnalyticsEmptyState();

  return `<div class="an-executive-dashboard">
    <section class="an-exec-hero an-status-${esc(health.status || 'no_data')}">
      <div class="an-health-ring" style="--an-health:${Math.max(0, Math.min(100, health.score || 0))}">
        <div><strong>${health.score || 0}</strong><span>из 100</span></div>
      </div>
      <div class="an-exec-hero-copy">
        <span class="an-exec-eyebrow">Индекс выполнения целей</span>
        <h3>${analyticsStatusLabel(health.status)}</h3>
        <p>${health.attention_count ? `${health.attention_count} оператор(ов) требуют внимания, из них критично: ${health.critical_count || 0}.` : 'Все операторы с данными находятся в целевой зоне.'}</p>
      </div>
      <div class="an-exec-hero-stats">
        <div><span>Операторов</span><strong>${health.operators_count || 0}</strong></div>
        <div><span>Покрытие данных</span><strong>${health.data_coverage_percent || 0}%</strong></div>
        <div><span>Покрытие качества</span><strong>${health.quality_coverage_percent || 0}%</strong></div>
      </div>
    </section>

    <section class="an-exec-section">
      <div class="an-exec-section-head"><div><span>Ключевые показатели</span><small>Факт относительно управленческой цели</small></div></div>
      <div class="an-exec-metrics">
        ${metrics.map(metric => `<article class="an-exec-metric an-status-${esc(metric.status)}">
          <div class="an-exec-metric-head"><span>${esc(metric.label)}</span><b>${analyticsStatusLabel(metric.status)}</b></div>
          <strong>${analyticsMetricValue(metric.value, metric.unit)}</strong>
          <div class="an-exec-goal"><span>Цель ${analyticsMetricValue(metric.target, metric.unit)}</span><span>${metric.attainment || 0}%</span></div>
          <div class="an-exec-progress"><i style="width:${Math.min(100, metric.attainment || 0)}%"></i></div>
          <small>${metric.operators_below_target || 0} из ${metric.operators_with_data || 0} ниже цели</small>
        </article>`).join('')}
      </div>
    </section>

    <div class="an-exec-grid an-exec-grid-main">
      <section class="an-exec-section">
        <div class="an-exec-section-head"><div><span>Карта рисков</span><small>Распределение команды по зонам</small></div><button type="button" data-an-open-tab="risks">Подробнее</button></div>
        <div class="an-risk-strip" aria-label="Распределение рисков">
          ${['stable','watch','critical','no_data'].map(key => `<i class="an-risk-strip-${key}" style="width:${((risks[key] || 0) / totalRisk) * 100}%"></i>`).join('')}
        </div>
        <div class="an-risk-legend-v2">
          ${['stable','watch','critical','no_data'].map(key => `<button type="button" data-an-open-tab="risks" class="an-risk-legend-item an-status-${key}"><i></i><span>${riskStatusLabel(key)}</span><strong>${risks[key] || 0}</strong></button>`).join('')}
        </div>
      </section>
      <section class="an-exec-section">
        <div class="an-exec-section-head"><div><span>Что тормозит результат</span><small>Частые причины попадания в зону внимания</small></div></div>
        <div class="an-bottleneck-list">
          ${bottlenecks.length ? bottlenecks.slice(0,5).map(item => `<div class="an-bottleneck-row">
            <div><span>${esc(item.label)}</span><small>${item.critical_count || 0} критично</small></div>
            <div class="an-bottleneck-track"><i style="width:${Math.round((item.count / maxBottleneck) * 100)}%"></i></div>
            <strong>${item.count}</strong>
          </div>`).join('') : '<div class="empty-line">Отклонений не обнаружено</div>'}
        </div>
      </section>
    </div>

    <section class="an-exec-section">
      <div class="an-exec-section-head"><div><span>Состояние групп</span><small>Сначала показаны группы с наибольшим риском</small></div><button type="button" data-an-open-tab="groups">Сравнить группы</button></div>
      <div class="an-group-health-list">
        ${groups.length ? groups.map(group => `<article class="an-group-health-row an-status-${esc(group.status)}">
          <div class="an-group-health-name"><i></i><div><strong>${esc(group.group_name)}</strong><small>${group.operators_count} оператор(ов) · данные ${group.coverage_percent}%</small></div></div>
          <div class="an-group-health-meter"><span><i style="width:${group.health_score}%"></i></span><b>${group.health_score}/100</b></div>
          <div class="an-group-health-risk"><strong>${group.operators_in_risk}</strong><span>требуют внимания</span></div>
        </article>`).join('') : '<div class="empty-line">Нет данных по группам</div>'}
      </div>
    </section>

    <div class="an-exec-grid an-exec-grid-operators">
      <section class="an-exec-section">
        <div class="an-exec-section-head"><div><span>Приоритет на разбор</span><small>Операторы отсортированы по срочности</small></div><button type="button" data-an-open-tab="operators">Все операторы</button></div>
        <div class="an-priority-list">
          ${priorities.length ? priorities.slice(0,6).map((operator, index) => `<article class="an-priority-row an-status-${esc(operator.status)}">
            <div class="an-priority-rank">${index + 1}</div>
            <div class="an-priority-person"><strong>${esc(operator.full_name)}</strong><small>${esc(operator.group_name || 'Без группы')}</small></div>
            <div class="an-priority-issues">${(operator.issues || []).slice(0,2).map(issue => `<span class="an-issue-chip an-status-${esc(issue.severity)}">${esc(issue.label)} ${issue.value == null ? 'нет данных' : analyticsMetricValue(issue.value, issue.unit)}</span>`).join('')}</div>
            <div class="an-priority-score"><strong>${operator.health_score}</strong><span>индекс</span></div>
            <p>${esc(operator.recommendation)}</p>
          </article>`).join('') : '<div class="an-positive-state">Все показатели команды находятся в целевой зоне.</div>'}
        </div>
      </section>
      <aside class="an-exec-section">
        <div class="an-exec-section-head"><div><span>Лидеры периода</span><small>По итоговому баллу</small></div></div>
        <div class="an-leader-list">
          ${leaders.length ? leaders.map((operator, index) => `<div class="an-leader-row"><b>${index + 1}</b><div><strong>${esc(operator.full_name)}</strong><small>${esc(operator.group_name || 'Без группы')}</small></div><span>${fmtA(operator.metrics?.final_points || 0, 1)}</span></div>`).join('') : '<div class="empty-line">Нет данных</div>'}
        </div>
      </aside>
    </div>

    <section class="an-exec-section">
      <div class="an-exec-section-head"><div><span>Нагрузка по дням</span><small>Количество обработанных звонков</small></div><button type="button" data-an-open-tab="dynamics">Открыть динамику</button></div>
      <div class="an-exec-dynamics">${renderDynChart(dynamics, 'calls')}</div>
    </section>
  </div>`;
}

function bindManagementDashboard(content) {
  content.querySelectorAll('[data-an-open-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.dataset.anOpenTab;
      const tabButton = document.querySelector(`#an-tabs [data-tab="${tab}"]`);
      if (tabButton) tabButton.click();
    });
  });
}

function renderAnalyticsEmptyState() {
  return `<div class="an-exec-section"><div class="an-empty-state">
    <div class="an-empty-mark" aria-hidden="true"></div>
    <div class="an-empty-title">Нет данных для аналитики</div>
    <div class="an-empty-sub">Загрузите Report и Monthly Report, затем выполните расчёт периода.</div>
    <button class="btn-primary btn-sm" onclick="navigateTo('period-report')" style="margin-top:12px">Перейти к расчёту периода</button>
  </div></div>`;
}

/* ── Вкладка: Операторы (таблица эффективности + зона внимания) ─*/
async function loadOperatorsTab(content) {
  // Один комбинированный запрос вместо 2
  const combined = await analyticsFetch('operators-combined', analyticsOpParams());
  const opsTable = { items: combined.items || [] };
  const topAttn = combined.top_and_attention || {};

  content.innerHTML =
    renderOperatorsTableBlock(opsTable) +
    renderAttentionZoneTableBlock(topAttn.attention_zone || []);

  bindOpsTableSort(opsTable.items || []);

  content.querySelector('#an-export-ops-btn')?.addEventListener('click', () => exportOperatorsCsv(opsTable.items || []));
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

function bindOpsTableSort(items) {
  let curSortKey = 'final_points', curSortDir = 'desc';
  const wrap = document.getElementById('an-ops-table-wrap');
  function bind() {
    document.querySelectorAll('#an-ops-table-wrap .sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (curSortKey === key) curSortDir = curSortDir === 'desc' ? 'asc' : 'desc';
        else { curSortKey = key; curSortDir = 'desc'; }
        wrap.innerHTML = renderOpsTable(items, curSortKey, curSortDir);
        bind();
      });
    });
  }
  bind();
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
        <button class="metric-tab active" data-metric="final_points_sum">Баллы</button>
        <button class="metric-tab" data-metric="avg_quality">Качество</button>
        <button class="metric-tab" data-metric="avg_kvz">КВЗ</button>
        <button class="metric-tab" data-metric="avg_efficiency">Эфф.</button>
        <button class="metric-tab" data-metric="penalty_minutes">Штрафы</button>
        <button class="metric-tab" data-metric="total_calls">Звонки</button>
      </div>
    </div>
    <div id="an-groups-metric-chart">${renderGroupsMetricChart(items, 'final_points_sum')}</div>
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
async function loadMatrixTab(content) {
  content.innerHTML =
    renderQualityKvzMatrixBlock() +
    `<div class="an-card"><div class="an-card-head">Нагрузка и эффективность</div>
      <div id="an-load-eff-matrix"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
    </div>`;

  // Один запрос вместо 2 — получаем все матрицы сразу
  try {
    const d = await analyticsFetch('matrix-combined', analyticsBaseParams());
    drawScatter('an-qk-matrix', d.quality_kvz || [], 'kvz', 'quality_avg', 'КВЗ', 'Качество', d.thresholds?.kvz, d.thresholds?.quality);
    drawScatter('an-load-eff-matrix', d.load_efficiency || [], 'calls_total', 'efficiency_percent', 'Звонки', 'Эффективность %');
  } catch(e) {
    const c = document.getElementById('an-qk-matrix');
    if (c) c.innerHTML = `<div class="empty-line">${esc(e.message)}</div>`;
    const c2 = document.getElementById('an-load-eff-matrix');
    if (c2) c2.innerHTML = `<div class="empty-line">${esc(e.message)}</div>`;
  }
}

/* ── Вкладка: Качество ──────────────────────────────────────────*/
async function loadQualityTab(content) {
  // Получаем coverage и penalties одним запросом, heatmap — параллельно
  const [combined, hm] = await Promise.all([
    analyticsFetch('quality-combined', analyticsBaseParams()),
    analyticsFetch('heatmap', { ...analyticsBaseParams(), metric: 'quality' }).catch(() => null),
  ]);

  const coverage = combined.coverage || {};
  content.innerHTML =
    renderQualityCoverageBlock(coverage) +
    `<div class="an-card">
      <div class="an-card-head">Оценки операторов по дням</div>
      <div id="an-quality-heatmap">${hm ? renderHeatmapTable(hm, 'quality') : '<div class="empty-line">Нет данных для сетки оценок</div>'}</div>
    </div>`;
}

/* ── Вкладка: Динамика ────────────────────────────────────────*/
async function loadDynamicsTab(content) {
  content.innerHTML = `
    <div class="an-card">
      <div class="an-card-head-row">
        <span>Динамика по дням</span>
        <div class="metric-tabs" id="an-dyn-tabs2">
          <button class="metric-tab active" data-metric="calls">Звонки</button>
          <button class="metric-tab" data-metric="kvz">КВЗ</button>
          <button class="metric-tab" data-metric="operators">Операторы</button>
        </div>
      </div>
      <div id="an-dyn-chart2"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
    </div>
    <div class="an-card">
      <div class="an-card-head-row">
        <span>Тепловая карта по дням</span>
        <div class="metric-tabs" id="an-heatmap-tabs2">
          <button class="metric-tab active" data-metric="quality">Качество</button>
          <button class="metric-tab" data-metric="calls">Звонки</button>
          <button class="metric-tab" data-metric="kvz">КВЗ</button>
          <button class="metric-tab" data-metric="efficiency">Эфф.</button>
          <button class="metric-tab" data-metric="penalty">Штрафы</button>
        </div>
      </div>
      <div id="an-heatmap-body2"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
    </div>`;

  const base = analyticsBaseParams();

  async function loadDyn(metric) {
    const box = document.getElementById('an-dyn-chart2');
    try {
      const d = await analyticsFetch('daily-dynamics', { ...base, metric });
      box.innerHTML = renderDynChart(d.items || [], metric);
    } catch(e) { box.innerHTML = `<div class="empty-line">${esc(e.message)}</div>`; }
  }
  document.querySelectorAll('#an-dyn-tabs2 .metric-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#an-dyn-tabs2 .metric-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      loadDyn(btn.dataset.metric);
    });
  });
  loadDyn('calls');

  async function loadHm(metric) {
    const box = document.getElementById('an-heatmap-body2');
    try {
      const d = await analyticsFetch('heatmap', { ...base, metric });
      box.innerHTML = renderHeatmapTable(d, metric);
    } catch(e) { box.innerHTML = `<div class="empty-line">${esc(e.message)}</div>`; }
  }
  document.querySelectorAll('#an-heatmap-tabs2 .metric-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#an-heatmap-tabs2 .metric-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      loadHm(btn.dataset.metric);
    });
  });
  loadHm('quality');
}

/* ── Вкладка: Штрафы ──────────────────────────────────────────*/
async function loadPenaltiesTab(content) {
  const penalties = await analyticsFetch('penalties', analyticsBaseParams());
  content.innerHTML = renderPenaltiesBlock(penalties);
}

/* ── Вкладка: Риски ───────────────────────────────────────────*/
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
async function loadExportTab(content) {
  content.innerHTML = `<div class="an-card">
    <div class="an-card-head">Экспорт отчётов</div>
    <div class="an-export-grid">
      <button class="btn-outline an-export-btn" data-export="operators">Таблица операторов</button>
      <button class="btn-outline an-export-btn" data-export="groups">Сравнение групп</button>
      <button class="btn-outline an-export-btn" data-export="penalties">Штрафы</button>
      <button class="btn-outline an-export-btn" data-export="attention">Зона внимания</button>
      <button class="btn-outline an-export-btn" data-export="risks">Риски</button>
      <button class="btn-outline an-export-btn" data-export="quality_coverage">Качество прослушки</button>
    </div>
    <p style="font-size:12px;color:var(--text-muted);margin-top:14px">Экспорт учитывает выбранные фильтры периода, группы и оператора.</p>
  </div>`;

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

/* ══════════════════════════════════════
   VIEW: РЕЙТИНГ — обёртка с горизонтальными вкладками
══════════════════════════════════════ */
const RATING_TABS = [
  { key: 'overview', label: 'Общий рейтинг' },
  { key: 'race',     label: 'Гонка баллов' },
  { key: 'groups',   label: 'Сравнение групп' },
  { key: 'progress', label: 'Мой прогресс' },
];
