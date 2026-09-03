/* ══════════════════════════════════════
   КОИНЫ: Еженедельный расчёт (ТЗ §3) — preview / apply / история запусков
══════════════════════════════════════ */

function canApplyAccrual(role) { return role === 'manager' || role === 'admin'; }

function _mondayOfWeek(d) {
  const day = (d.getDay() + 6) % 7; // 0 = понедельник
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  return monday;
}
function _isoDate(d) { return d.toISOString().slice(0, 10); }

// Прошлая календарная неделя пн-вс — тот же расчёт, что у cron-задачи на бэкенде.
function _defaultAccrualPeriod() {
  const today = new Date();
  const thisMonday = _mondayOfWeek(today);
  const prevMonday = new Date(thisMonday); prevMonday.setDate(thisMonday.getDate() - 7);
  const prevSunday = new Date(thisMonday); prevSunday.setDate(thisMonday.getDate() - 1);
  return { start: _isoDate(prevMonday), end: _isoDate(prevSunday) };
}

const _weeklyAccrualState = { start: null, end: null, preview: null, runs: null };

function renderWeeklyAccrualTab(body) {
  if (!_weeklyAccrualState.start) {
    const def = _defaultAccrualPeriod();
    _weeklyAccrualState.start = def.start;
    _weeklyAccrualState.end = def.end;
  }
  const canApply = canApplyAccrual(STATE.user?.role);
  const s = _weeklyAccrualState;

  body.innerHTML = `
    <div class="panel coins-weekly-toolbar">
      <div class="panel-head"><h3>Расчёт за период</h3></div>
      <div class="filter-row" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
        <div class="form-group" style="margin:0">
          <label class="form-label">Начало периода</label>
          <input type="date" id="wa-period-start" class="form-input" value="${esc(s.start)}">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Конец периода</label>
          <input type="date" id="wa-period-end" class="form-input" value="${esc(s.end)}">
        </div>
        <button class="btn-outline btn-sm" onclick="runWeeklyAccrualPreview()">Предварительный расчёт</button>
        ${canApply ? `<button class="btn-primary btn-sm" onclick="runWeeklyAccrualApply()">Начислить коины за период</button>` : ''}
      </div>
    </div>

    <div id="wa-preview-host"></div>

    <div class="panel">
      <div class="panel-head">
        <h3>История запусков</h3>
        <button class="btn-link" onclick="loadWeeklyAccrualRuns()">Обновить</button>
      </div>
      <div id="wa-runs-host">${uiListSkeleton(4)}</div>
    </div>`;

  if (_weeklyAccrualState.preview) _renderWeeklyAccrualPreview();
  loadWeeklyAccrualRuns();
}

function _readAccrualPeriodInputs() {
  const start = document.getElementById('wa-period-start')?.value;
  const end = document.getElementById('wa-period-end')?.value;
  if (start) _weeklyAccrualState.start = start;
  if (end) _weeklyAccrualState.end = end;
  return { start: _weeklyAccrualState.start, end: _weeklyAccrualState.end };
}

async function runWeeklyAccrualPreview() {
  const { start, end } = _readAccrualPeriodInputs();
  if (!start || !end) { showToast('Укажите период', 'error'); return; }
  const host = document.getElementById('wa-preview-host');
  if (host) host.innerHTML = uiLoadingBlock('Считаем');
  try {
    _weeklyAccrualState.preview = await api.previewWeeklyAccrual(start, end);
  } catch (e) {
    if (host) host.innerHTML = `<div class="empty-line">Ошибка: ${esc(e.message)}</div>`;
    return;
  }
  _renderWeeklyAccrualPreview();
}

const _bonusChipDefs = [
  ['bonus_top_coins', '🏆', 'Топ недели'],
  ['bonus_no_late_coins', '⏰', 'Без опозданий'],
  ['bonus_no_violation_coins', '✅', 'Без нарушений'],
  ['bonus_nomination_coins', '⭐', 'Номинация'],
  ['bonus_thanks_coins', '🚌', 'Благодарность водителя'],
];

function _bonusChipsHtml(o) {
  const chips = _bonusChipDefs
    .filter(([key]) => o[key])
    .map(([key, icon, title]) => `<span class="bonus-chip" title="${esc(title)}">${icon} +${o[key]}</span>`)
    .join('');
  return chips || '<span class="cell-muted">—</span>';
}

function _renderWeeklyAccrualPreview() {
  const host = document.getElementById('wa-preview-host');
  if (!host) return;
  const p = _weeklyAccrualState.preview;
  if (!p) { host.innerHTML = ''; return; }

  host.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Предварительный расчёт: ${esc(p.period_start)} — ${esc(p.period_end)}</h3>
        <span class="panel-badge">${p.total_operators} операторов · ${fmtCoins(p.total_coins)}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th scope="col">Место</th><th scope="col">Оператор</th><th scope="col">Группа</th><th scope="col">Баллы</th><th scope="col">База</th>
            <th scope="col">Бонусы</th><th scope="col">Итого</th><th scope="col">Динамика</th>
          </tr></thead>
          <tbody>
            ${p.operators.length ? p.operators.slice().sort((a, b) => (a.rank_place ?? 999) - (b.rank_place ?? 999)).map(o => `
              <tr class="${o.already_accrued ? 'row-muted' : ''}">
                <td><span class="rank-badge ${(o.rank_place || 99) <= 3 ? 'rank-top' : ''}">${o.rank_place ?? '—'}</span></td>
                <td class="name-cell">${esc(o.operator_name)}${o.already_accrued ? '<div class="cell-muted" style="font-size:11px">уже начислено</div>' : ''}</td>
                <td>${esc(o.group_name || '')}</td>
                <td>${levelNum(o.contest_points)}</td>
                <td>${fmtCoins(o.base_coins)}</td>
                <td>${_bonusChipsHtml(o)}</td>
                <td><b class="accent-text">${fmtCoins(o.total_coins)}</b></td>
                <td>${o.rank_delta != null ? `<span class="rank-delta ${o.rank_delta > 0 ? 'up' : o.rank_delta < 0 ? 'down' : ''}">${o.rank_delta > 0 ? '↑' + o.rank_delta : o.rank_delta < 0 ? '↓' + Math.abs(o.rank_delta) : '—'}</span>` : '—'}</td>
              </tr>`).join('') : '<tr><td colspan="8" class="empty-line">Нет данных WeeklyResult за этот период</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function runWeeklyAccrualApply() {
  const { start, end } = _readAccrualPeriodInputs();
  if (!start || !end) { showToast('Укажите период', 'error'); return; }
  const confirmed = await uiConfirmAction({
    title: 'Начислить коины за период?',
    description: `Период: ${start} — ${end}. Действие необратимо; повторный запуск не задвоит начисление, но не отменит его.`,
    confirmLabel: 'Начислить',
  });
  if (!confirmed) return;

  try {
    const run = await api.applyWeeklyAccrual({ period_start: start, period_end: end, mode: 'manual' });
    if (run.status === 'success') {
      showToast(`Начислено: ${run.operators_count} операторов, ${fmtCoins(run.total_coins)} (пропущено уже начисленных: ${run.skipped_existing_count})`, 'ok');
    } else {
      showToast(`Расчёт завершился с ошибкой: ${run.error_message || 'см. историю запусков'}`, 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
    return;
  }
  _weeklyAccrualState.preview = null;
  document.getElementById('wa-preview-host').innerHTML = '';
  loadWeeklyAccrualRuns();
  // Баланс/история могли измениться — сбрасываем зависимые кеши
  STATE.coinsOverview = null;
  STATE.history = [];
}

async function loadWeeklyAccrualRuns() {
  const host = document.getElementById('wa-runs-host');
  if (!host) return;
  try {
    _weeklyAccrualState.runs = await api.listAccrualRuns();
  } catch {
    host.innerHTML = '<div class="empty-line">Не удалось загрузить историю запусков</div>';
    return;
  }
  const runs = _weeklyAccrualState.runs || [];
  host.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th scope="col">Период</th><th scope="col">Режим</th><th scope="col">Статус</th><th scope="col">Запущен</th><th scope="col">Операторов</th><th scope="col">Коинов</th><th scope="col">Автор</th></tr></thead>
        <tbody>
          ${runs.length ? runs.map(r => `
            <tr>
              <td>${esc(r.period_start)} — ${esc(r.period_end)}</td>
              <td>${r.mode === 'auto' ? 'Авто (cron)' : 'Вручную'}</td>
              <td><span class="status-pill ${r.status === 'success' ? 'ok' : 'error'}">${r.status === 'success' ? 'Успешно' : 'Ошибка'}</span></td>
              <td style="white-space:nowrap">${fmtDateTime(r.started_at)}</td>
              <td>${r.operators_count}${r.skipped_existing_count ? ` <span class="cell-muted">(+${r.skipped_existing_count} пропущено)</span>` : ''}</td>
              <td><b>${fmtCoins(r.total_coins)}</b></td>
              <td>${esc(r.created_by)}</td>
            </tr>`).join('') : '<tr><td colspan="7" class="empty-line">Запусков ещё не было</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function exportWeeklyAccrualPeriod(format = 'csv') {
  const { start, end } = _readAccrualPeriodInputs();
  if (!start || !end) { showToast('Укажите период', 'error'); return; }
  window.open(api.exportUrl('/api/exports/weekly-results', { period_start: start, period_end: end, format }), '_blank');
}
