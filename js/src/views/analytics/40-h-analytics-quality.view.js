/* Выделено из 40-reports-analytics.view.js (2671 строка).
   Вкладки «Матрица» и «Качество», недельная сетка. */

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

/* ── Вкладка: Контроль качества ────────────────────────────────*/
async function loadQualityTab(content) {
  const combined = await analyticsFetch('quality-combined', analyticsBaseParams());
  const coverage = combined.coverage || {};
  if (!_analyticsState.qualityGridWeekStart) {
    _analyticsState.qualityGridWeekStart = mondayOfWeekISO(_analyticsState.endDate || _analyticsState.startDate);
  }

  content.innerHTML =
    renderQualityCoverageBlock(coverage) +
    `<div class="an-card">
      <div class="an-card-head-row">
        <span>Оценки операторов по дням</span>
        <div class="an-week-nav" id="an-quality-week-nav">
          <button type="button" class="btn-outline btn-sm" data-week="prev" aria-label="Предыдущая неделя">←</button>
          <span class="an-week-label" id="an-quality-week-label"></span>
          <button type="button" class="btn-outline btn-sm" data-week="next" aria-label="Следующая неделя">→</button>
        </div>
      </div>
      <div id="an-quality-grid"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
    </div>`;

  await loadQualityGridWeek(content);

  content.querySelectorAll('#an-quality-week-nav [data-week]').forEach(btn => {
    btn.addEventListener('click', () => {
      _analyticsState.qualityGridWeekStart = addDaysISO(
        _analyticsState.qualityGridWeekStart, btn.dataset.week === 'prev' ? -7 : 7,
      );
      loadQualityGridWeek(content);
    });
  });
}

async function loadQualityGridWeek(content) {
  const label = content.querySelector('#an-quality-week-label');
  const box = content.querySelector('#an-quality-grid');
  const ws = _analyticsState.qualityGridWeekStart;
  if (label) label.textContent = analyticsPeriodLabel(ws, addDaysISO(ws, 6));
  if (box) box.innerHTML = '<div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div>';
  const params = { week_start: ws, metric: 'quality' };
  if (_analyticsState.groupId) params.group_id = _analyticsState.groupId;
  if (_analyticsState.participationStatus !== 'all') params.participation_status = _analyticsState.participationStatus;
  try {
    const grid = await analyticsFetch('daily-grid', params);
    if (box) box.innerHTML = renderDailyGridBlock(grid);
  } catch (e) {
    if (box) box.innerHTML = `<div class="empty-line">${esc(e.message)}</div>`;
  }
}

const AN_GRID_DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function renderDailyGridBlock(grid) {
  const dates = grid.dates || [];
  const operators = grid.operators || [];
  if (!operators.length) {
    const reason = grid.empty_reason === 'no_reports_uploaded'
      ? 'Отчёты ещё не загружены — сетка появится после расчёта периода.'
      : 'За эту неделю нет оценок. Переключите неделю стрелками.';
    return `<div class="empty-line">${esc(reason)}</div>`;
  }
  const legend = grid.legend || {};
  const target = legend.target;
  const critical = legend.critical;
  function cellColor(v) {
    if (v == null) return 'transparent';
    if (target != null && v >= target) return 'var(--success-soft)';
    if (critical != null && v < critical) return 'var(--danger-soft)';
    return 'var(--warning-soft)';
  }
  return `<div class="an-heatmap-wrap"><table class="an-heatmap-table an-daily-grid">
    <thead><tr><th class="an-heatmap-name-col">Оператор</th>
      ${dates.map((d, i) => `<th>${AN_GRID_DOW[i]}<small>${esc(d.slice(8))}</small></th>`).join('')}
    </tr></thead>
    <tbody>
      ${operators.map(op => `<tr>
        <td class="an-heatmap-name-col name-cell">${esc(op.full_name)}</td>
        ${dates.map(d => {
          const cell = op.values[d];
          if (!cell || cell.value == null) {
            return `<td class="an-heatmap-cell" title="${esc(op.full_name)} ${d}: нет оценок">—</td>`;
          }
          return `<td class="an-heatmap-cell" style="background:${cellColor(cell.value)}" title="${esc(op.full_name)} ${d}: ${Math.round(cell.value)}% по ${cell.count} оцен.">${Math.round(cell.value)}<sup>${cell.count}</sup></td>`;
        }).join('')}
      </tr>`).join('')}
    </tbody>
  </table></div>
  <p class="an-grid-legend" style="margin:8px 0 0;font-size:12px;color:var(--text-muted)">Число — средняя оценка за день, надстрочное — сколько звонков оценено. Пусто — оценок не было (не считается за ноль).</p>`;
}

/* ── Вкладка: Динамика ────────────────────────────────────────*/
