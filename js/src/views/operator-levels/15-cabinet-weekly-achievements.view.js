/* ══════════════════════════════════════
   КАБИНЕТ: показатели недели, прозрачный расчёт коинов, достижения (ТЗ §5, §7)
   Один общий фетч /api/cabinet/me — данные шарятся между обоими блоками.
══════════════════════════════════════ */

function _cabinetIsOperatorLike() {
  return STATE.user?.role === 'operator' || STATE.user?.role === 'supervisor';
}

let _cabinetWeeklyRenderVersion = 0;
let _cabinetAchievementsRenderVersion = 0;

// Все секции используют единый session-scoped snapshot loader. Это исключает
// параллельные запросы и не позволяет завершившемуся запросу прошлой сессии
// перезаписать кабинет нового пользователя.
function _loadCabinetData() {
  const snapshot = cabinetSnapshotForCurrentUser();
  return snapshot ? Promise.resolve(snapshot) : loadCabinetSnapshot(false);
}

function _metricBarHtml(label, value, target, unit = '') {
  const hasValue = value !== null && value !== undefined && value !== '';
  const hasTarget = target !== null && target !== undefined && Number(target) > 0;
  if (!hasValue) {
    return `
      <div class="metric-progress-row">
        <div class="metric-progress-label">
          <span>${esc(label)}</span>
          <b class="cell-muted">Нет данных</b>
        </div>
      </div>`;
  }
  const rawValue = Number(value);
  const v = Number.isFinite(rawValue) ? rawValue : 0;
  const t = hasTarget ? Number(target) : 0;
  const pct = t > 0 ? Math.min(100, Math.round((v / t) * 100)) : (v > 0 ? 100 : 0);
  const overTarget = t > 0 && v >= t;
  return `
    <div class="metric-progress-row">
      <div class="metric-progress-label">
        <span>${esc(label)}</span>
        <b>${levelNum(v)}${esc(unit)}${t > 0 ? ` <span class="cell-muted">/ цель ${levelNum(t)}${esc(unit)}</span>` : ' <span class="cell-muted">· норма не настроена</span>'}</b>
      </div>
      <div class="metric-progress-bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${t > 0 ? t : 100}" aria-valuenow="${t > 0 ? Math.min(v, t) : Math.min(v, 100)}">
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
  const renderVersion = ++_cabinetWeeklyRenderVersion;
  host.setAttribute('aria-busy', 'true');

  let data;
  try {
    data = await _loadCabinetData();
  } catch (error) {
    if (renderVersion !== _cabinetWeeklyRenderVersion || document.getElementById('cabinet-weekly-detail') !== host) return;
    host.removeAttribute('aria-busy');
    const message = typeof uiErrorMessage === 'function'
      ? uiErrorMessage(error, 'Не удалось загрузить показатели недели')
      : 'Не удалось загрузить показатели недели';
    host.innerHTML = `<div class="panel empty-state" role="alert"><p>${esc(message)}</p><button class="btn-outline btn-sm" type="button" onclick="renderCabinetWeeklyDetail()">Повторить</button></div>`;
    return;
  }
  if (renderVersion !== _cabinetWeeklyRenderVersion || document.getElementById('cabinet-weekly-detail') !== host) return;
  host.removeAttribute('aria-busy');
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
          <span class="panel-badge">${uiDate(wm.period_start)} — ${uiDate(wm.period_end)}</span>
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
        ${(Array.isArray(cc.bonuses) ? cc.bonuses : []).map(b => `
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
  const renderVersion = ++_cabinetAchievementsRenderVersion;
  host.setAttribute('aria-busy', 'true');

  let data;
  try {
    data = await _loadCabinetData();
  } catch (error) {
    if (renderVersion !== _cabinetAchievementsRenderVersion || document.getElementById('cabinet-achievements') !== host) return;
    host.removeAttribute('aria-busy');
    const message = typeof uiErrorMessage === 'function'
      ? uiErrorMessage(error, 'Не удалось загрузить достижения')
      : 'Не удалось загрузить достижения';
    host.innerHTML = `<div class="panel empty-state" role="alert"><p>${esc(message)}</p><button class="btn-outline btn-sm" type="button" onclick="renderCabinetAchievements()">Повторить</button></div>`;
    return;
  }
  if (renderVersion !== _cabinetAchievementsRenderVersion || document.getElementById('cabinet-achievements') !== host) return;
  host.removeAttribute('aria-busy');
  const source = data.achievements || {};
  const ach = {
    completed: Array.isArray(source.completed) ? source.completed : [],
    in_progress: Array.isArray(source.in_progress) ? source.in_progress : [],
  };

  const badgeHtml = (row, completed) => {
    const a = row.achievement || row;
    const target = Number(a.target ?? a.condition_value ?? 0);
    return `
    <article class="achievement-badge ${completed ? 'unlocked' : 'locked'}" aria-label="${esc(a.title || 'Достижение')}: ${completed ? 'получено' : 'в процессе'}">
      <div class="achievement-icon">${achievementVisualIcon(a, 'achievement-card-icon')}</div>
      <div class="achievement-info">
        <div class="achievement-title">${esc(a.title)}</div>
        <div class="achievement-desc">${esc(a.description)}</div>
        ${completed
          ? `<div class="achievement-meta">Получено ×${row.times_awarded ?? 1}${row.completed_at ? ' · ' + fmtDate(row.completed_at) : ''}</div>`
          : (target > 0
              ? `<div class="achievement-progress-line" role="progressbar" aria-label="Прогресс: ${esc(a.title || 'достижение')}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(target, Math.max(0, Number(row.progress_value) || 0))}">${levelNum(row.progress_value)} / ${levelNum(target)}</div>`
              : '<div class="achievement-progress-line cell-muted">Настраивается</div>')}
      </div>
    </article>`;
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
