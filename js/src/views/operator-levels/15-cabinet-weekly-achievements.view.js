/* ══════════════════════════════════════
   КАБИНЕТ: показатели недели, прозрачный расчёт коинов, достижения (ТЗ §5, §7)
   Один общий фетч /api/cabinet/me — данные шарятся между обоими блоками.
══════════════════════════════════════ */

function _cabinetIsOperatorLike() {
  return STATE.user?.role === 'operator' || STATE.user?.role === 'supervisor';
}

// Общий загрузчик: гарантирует ровно один запрос, даже если оба блока
// (показатели недели и достижения) рендерятся почти одновременно.
function _loadCabinetData() {
  if (STATE.cabinetData) return Promise.resolve(STATE.cabinetData);
  if (!STATE._cabinetDataPromise) {
    STATE._cabinetDataPromise = api.getMyCabinet()
      .then(data => { STATE.cabinetData = data; return data; })
      .finally(() => { STATE._cabinetDataPromise = null; });
  }
  return STATE._cabinetDataPromise;
}

function _metricBarHtml(label, value, target, unit = '') {
  const v = Number(value) || 0;
  const t = Number(target) || 0;
  const pct = t > 0 ? Math.min(100, Math.round((v / t) * 100)) : (v > 0 ? 100 : 0);
  const overTarget = t > 0 && v >= t;
  return `
    <div class="metric-progress-row">
      <div class="metric-progress-label">
        <span>${esc(label)}</span>
        <b>${levelNum(v)}${esc(unit)}${t > 0 ? ` <span class="cell-muted">/ цель ${levelNum(t)}${esc(unit)}</span>` : ''}</b>
      </div>
      <div class="metric-progress-bar">
        <div class="metric-progress-fill ${overTarget ? 'ok' : ''}" style="width:${pct}%"></div>
      </div>
    </div>`;
}

function _antiMetricHtml(label, value) {
  const v = Number(value) || 0;
  return `
    <div class="metric-anti-row ${v > 0 ? 'bad' : 'ok'}">
      <span>${esc(label)}</span>
      <b>${v}</b>
    </div>`;
}

async function renderCabinetWeeklyDetail() {
  const host = document.getElementById('cabinet-weekly-detail');
  if (!host || !_cabinetIsOperatorLike()) { if (host) host.innerHTML = ''; return; }

  let data;
  try {
    data = await _loadCabinetData();
  } catch {
    host.innerHTML = '';
    return;
  }
  const wm = data.week_metrics;
  const cc = data.coin_calculation;
  if (!wm && !cc) {
    host.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>Показатели недели</h3></div>
        <div class="empty-line">Нет данных за последнюю неделю.</div>
      </div>`;
    return;
  }

  const bonusLabels = {
    top: 'Место в рейтинге недели', no_late: 'Неделя без опозданий',
    no_violation: 'Неделя без нарушений', nomination: 'Номинация недели',
    driver_thanks: 'Благодарность от водителя',
  };

  host.innerHTML = `
    <div class="cabinet-week-grid">
      ${wm ? `
      <div class="panel">
        <div class="panel-head">
          <h3>Показатели недели</h3>
          <span class="panel-badge">${esc(wm.period_start)} — ${esc(wm.period_end)}</span>
        </div>
        ${_metricBarHtml('Выработка часов', wm.hours, wm.hours_target, ' ч')}
        ${_metricBarHtml('Качество', wm.quality, wm.quality_target, '%')}
        ${_metricBarHtml('Эффективность', wm.efficiency, 0, '%')}
        <div class="metric-mini-row">
          <span>Звонков в час: <b>${levelNum(wm.calls_per_hour)}</b></span>
        </div>
        <div class="metric-anti-grid">
          ${_antiMetricHtml('Опоздания (мин)', wm.late_minutes)}
          ${_antiMetricHtml('Нарушения', wm.violations)}
          <div class="metric-anti-row ${wm.thanks_count > 0 ? 'good' : ''}">
            <span>Благодарности</span><b>${wm.thanks_count || 0}</b>
          </div>
        </div>
      </div>` : ''}

      ${cc ? `
      <div class="panel">
        <div class="panel-head">
          <h3>Расчёт коинов за неделю</h3>
          <span class="panel-badge ${cc.is_final ? 'badge-final' : 'badge-pending'}">${cc.is_final ? 'Начислено' : 'Предварительно'}</span>
        </div>
        <div class="coin-calc-row">
          <span>Итоговый балл</span><b>${levelNum(cc.contest_points)}</b>
        </div>
        <div class="coin-calc-row">
          <span>Базовые коины</span><b>${cc.base_coins} ₡</b>
        </div>
        ${cc.bonuses.map(b => `
          <div class="coin-calc-row coin-calc-bonus">
            <span>+ ${esc(bonusLabels[b.type] || b.label)}</span><b>+${b.coins} ₡</b>
          </div>`).join('')}
        <div class="coin-calc-row coin-calc-total">
          <span>Итого за неделю</span><b>${cc.total_week_coins} ₡</b>
        </div>
        ${!cc.is_final ? '<div class="empty-line" style="margin-top:8px">Расчёт предварительный — начисление ещё не применено.</div>' : ''}
      </div>` : ''}
    </div>`;
}

async function renderCabinetAchievements() {
  const host = document.getElementById('cabinet-achievements');
  if (!host || !_cabinetIsOperatorLike()) { if (host) host.innerHTML = ''; return; }

  let data;
  try {
    data = await _loadCabinetData();
  } catch {
    host.innerHTML = '';
    return;
  }
  const ach = data.achievements || { completed: [], in_progress: [] };

  const badgeHtml = (row, completed) => {
    const a = row.achievement || row;
    return `
    <div class="achievement-badge ${completed ? 'unlocked' : 'locked'}" title="${esc(a.description)}">
      <div class="achievement-icon">${esc(a.icon || '🏆')}</div>
      <div class="achievement-info">
        <div class="achievement-title">${esc(a.title)}</div>
        <div class="achievement-desc">${esc(a.description)}</div>
        ${completed
          ? `<div class="achievement-meta">Получено ×${row.times_awarded}${row.completed_at ? ' · ' + fmtDate(row.completed_at) : ''}</div>`
          : (a.condition_value > 0
              ? `<div class="achievement-progress-line">${levelNum(row.progress_value)} / ${levelNum(a.condition_value)}</div>`
              : '<div class="achievement-progress-line cell-muted">Не выполнено</div>')}
      </div>
    </div>`;
  };

  host.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Мои достижения</h3>
        <span class="panel-badge">${ach.completed.length} получено</span>
      </div>
      <div class="achievements-grid">
        ${ach.completed.map(r => badgeHtml(r, true)).join('')}
        ${ach.in_progress.map(r => badgeHtml(r, false)).join('')}
        ${!ach.completed.length && !ach.in_progress.length ? '<div class="empty-line">Достижения скоро появятся.</div>' : ''}
      </div>
    </div>`;
}
