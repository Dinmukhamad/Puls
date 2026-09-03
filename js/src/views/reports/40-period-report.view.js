function renderPeriodReport() {
  const el = document.getElementById('view-period-report');
  if (!el) return;

  let lastResult = null;
  let searchVal = '', filterGroup = '', sortKey = 'final_points', sortDir = 'desc';

  function fmtNum(v, decimals = 2) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Number(v).toFixed(decimals);
  }

  /** Что уже лежит на сервере. Только реальные поля upload_status. */
  function prStatusStrip(status) {
    const files = [
      ['Monthly Report', status?.monthly],
      ['Report', status?.report],
    ];
    const ready = files.every(([, f]) => f);
    return `
      <div class="pr-status ${ready ? 'is-ready' : 'is-waiting'}">
        <span class="pr-status-mark" aria-hidden="true">${ready ? '✓' : '•'}</span>
        <div class="pr-status-text">
          <b>${ready ? 'Исходные файлы загружены' : 'Файлы ещё не загружены полностью'}</b>
          <span>${files.map(([label, f]) => f
            ? `${esc(label)}: ${esc(f.filename)}${f.uploaded_at ? ` · ${esc(fmtDateTime(f.uploaded_at))}` : ''}`
            : `${esc(label)}: нет`).join(' · ')}</span>
        </div>
      </div>`;
  }

  /**
   * Блокировка действий по условиям ТЗ (стр. 22): загрузка недоступна без
   * обоих файлов, расчёт — без корректного периода, причём конец не раньше
   * начала. Раньше обе кнопки были всегда активны и объясняли отказ уже
   * после нажатия.
   */
  function prSyncActions(host) {
    const monthly = host.querySelector('#pr-file-monthly')?.files?.[0];
    const report = host.querySelector('#pr-file-report')?.files?.[0];
    const start = host.querySelector('#pr-start-date')?.value;
    const end = host.querySelector('#pr-end-date')?.value;

    const uploadBtn = host.querySelector('#pr-upload-btn');
    if (uploadBtn) {
      const ready = Boolean(monthly && report);
      uploadBtn.disabled = !ready;
      uploadBtn.title = ready ? '' : 'Выберите оба файла .xlsx';
    }

    const calcBtn = host.querySelector('#pr-calc-btn');
    if (calcBtn) {
      const datesOk = Boolean(start && end && start <= end);
      // Файлы могут быть уже на сервере с прошлого раза — тогда выбирать их
      // заново не нужно, достаточно корректного периода.
      const filesOnServer = host.querySelector('#pr-status-strip .pr-status.is-ready');
      const ready = datesOk && Boolean(filesOnServer || (monthly && report));
      calcBtn.disabled = !ready;
      calcBtn.title = !datesOk
        ? (start && end ? 'Дата окончания не может быть раньше начала' : 'Укажите обе даты периода')
        : (ready ? '' : 'Сначала загрузите оба файла');
    }
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Расчёт</div><h1 class="section-title">Расчёт показателей за период</h1></div>
    </div>

    <div class="pr-status-strip" id="pr-status-strip" role="status" aria-live="polite"></div>

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
          <label class="form-label" for="pr-start-date">Дата начала</label>
          <input id="pr-start-date" type="date" class="form-input">
        </div>
        <div class="form-group">
          <label class="form-label" for="pr-end-date">Дата окончания</label>
          <input id="pr-end-date" type="date" class="form-input">
        </div>
        <button class="btn-primary" id="pr-calc-btn" style="align-self:flex-end">Рассчитать</button>
      </div>
      <div id="pr-calc-status" class="status-line"></div>
    </div>

    <div id="pr-results"></div>
  `;

  // Порог сознательно завышен: сервер ограничивает не сам файл, а его
  // распакованный объём (120 МБ). Архив крупнее этого точно не пройдёт,
  // а файлы обычного размера отклонять нельзя.
  const MAX_FILE_BYTES = 60 * 1024 * 1024;

  function humanSize(bytes) {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  }

  /**
   * Зона загрузки со всеми состояниями: исходное, перетаскивание, файл
   * выбран, неподдерживаемый формат, слишком большой файл и удаление
   * выбранного. Раньше зона умела только «выбран» и показывала имя без
   * размера, а заменить файл можно было лишь повторным выбором.
   */
  function bindFileDrop(inputId, dropId) {
    const input = el.querySelector('#' + inputId);
    const drop = el.querySelector('#' + dropId);
    if (!input || !drop) return;
    const textEl = drop.querySelector('.pr-file-drop-text');
    const IDLE = 'Перетащите файл .xlsx или нажмите, чтобы выбрать';

    const setState = (state, text) => {
      drop.classList.remove('pr-file-drop-filled', 'pr-file-drop-error', 'pr-file-drop-over');
      if (state) drop.classList.add(`pr-file-drop-${state}`);
      textEl.textContent = text;
      drop.querySelector('.pr-file-remove')?.remove();
      if (state === 'filled') {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'pr-file-remove';
        remove.setAttribute('aria-label', 'Убрать выбранный файл');
        remove.title = 'Убрать файл';
        remove.innerHTML = '<span aria-hidden="true">×</span>';
        remove.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          input.value = '';
          setState('', IDLE);
          prSyncActions(el);
          input.focus({ preventScroll: true });
        });
        drop.appendChild(remove);
      }
    };

    const accept = file => {
      if (!file) { setState('', IDLE); return false; }
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        setState('error', `${file.name} — нужен файл .xlsx`);
        input.value = '';
        return false;
      }
      if (file.size > MAX_FILE_BYTES) {
        setState('error', `${file.name} — ${humanSize(file.size)}, это больше допустимого`);
        input.value = '';
        return false;
      }
      setState('filled', `${file.name} · ${humanSize(file.size)}`);
      return true;
    };

    setState('', IDLE);
    input.addEventListener('change', () => { accept(input.files[0]); prSyncActions(el); });

    // Перетаскивание: подсветка зоны и приём файла.
    ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => {
      event.preventDefault();
      drop.classList.add('pr-file-drop-over');
    }));
    ['dragleave', 'dragend'].forEach(type => drop.addEventListener(type, () => {
      drop.classList.remove('pr-file-drop-over');
    }));
    drop.addEventListener('drop', event => {
      event.preventDefault();
      drop.classList.remove('pr-file-drop-over');
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      // Порядок важен: сначала кладём файл в input, потом пересчитываем
      // доступность — иначе кнопка останется заблокированной.
      // Кладём файл в input, чтобы отправка шла тем же путём, что и выбор.
      const data = new DataTransfer();
      data.items.add(file);
      input.files = data.files;
      accept(file);
      prSyncActions(el);
    });
  }
  ['#pr-start-date', '#pr-end-date'].forEach(sel => {
    el.querySelector(sel)?.addEventListener('change', () => prSyncActions(el));
  });

  bindFileDrop('pr-file-monthly', 'pr-file-monthly-drop');
  bindFileDrop('pr-file-report', 'pr-file-report-drop');
  prSyncActions(el);

  // Полоса статуса: что уже лежит на сервере. Файлы хранятся в БД и
  // переживают редеплой, поэтому после перезагрузки страницы состояние
  // восстанавливается, а не показывается «ничего не выбрано».
  //
  // Дату сохранённого расчёта API не отдаёт (upload_status возвращает только
  // загруженные файлы), поэтому её здесь нет — выдумывать нельзя.
  (async () => {
    try {
      const status = await swrFetch('period-report:status', () => api.getPeriodReportStatus(), null, SWR_FAST_TTL_MS);
      const strip = el.querySelector('#pr-status-strip');
      if (strip) strip.innerHTML = prStatusStrip(status);
      const statusEl = el.querySelector('#pr-upload-status');
      if (status.monthly && status.report) {
        statusEl.innerHTML = `Файлы уже загружены и сохранены: <b>${esc(status.monthly.filename)}</b>, <b>${esc(status.report.filename)}</b>. Можно сразу выбрать период.`;
        statusEl.className = 'status-line status-ok';
      } else if (status.monthly || status.report) {
        statusEl.textContent = 'Загружен только один из файлов — дозагрузите второй.';
        statusEl.className = 'status-line status-error';
      }
      prSyncActions(el);
    } catch (e) { /* тихо игнорируем — не критично для работы страницы */ }
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
        // Отсутствующее значение (например, качество без единой оценки) — не ноль:
        // такие строки уходят в конец при любом направлении, а не притворяются
        // худшим результатом.
        const av = a[sortKey], bv = b[sortKey];
        const aMissing = av === null || av === undefined;
        const bMissing = bv === null || bv === undefined;
        if (aMissing || bMissing) return aMissing - bMissing;
        return sortDir === 'desc' ? bv - av : av - bv;
      });
      return r;
    }

    function sortIndicator(key) {
      if (sortKey !== key) return '';
      return sortDir === 'desc' ? ' ↓' : ' ↑';
    }

    /* Заголовок сортируемой колонки: настоящая кнопка внутри <th> + aria-sort.
       Раньше обработчик висел на самой ячейке, поэтому сортировать таблицу
       можно было только мышью — с клавиатуры заголовки не фокусировались. */
    function sortTh(label, key) {
      const active = sortKey === key;
      const ariaSort = active ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none';
      return `<th class="num sortable" aria-sort="${ariaSort}" scope="col">`
        + `<button type="button" class="sort-btn" data-sort="${key}">`
        + `${label}<span aria-hidden="true">${sortIndicator(key)}</span></button></th>`;
    }

    function renderTable() {
      const rows = filteredSorted();
      if (!rows.length) return '<div class="empty-line">Нет данных для отображения</div>';
      return `<div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th scope="col">Оператор</th><th scope="col">Группа</th>
          ${sortTh('Баллы', 'final_points')}
          ${sortTh('Качество', 'quality_avg')}
          <th class="num" scope="col">Звонков оцен.</th>
          <th class="num" scope="col">Итог часов</th>
          <th class="num" scope="col">База часов</th>
          ${sortTh('КВЗ', 'kvz')}
          ${sortTh('Эфф. %', 'efficiency_percent')}
          ${sortTh('Штраф мин', 'penalty_minutes')}
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
      el.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.sort;
          if (sortKey === key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
          else { sortKey = key; sortDir = 'desc'; }
          el.querySelector('#pr-table-wrap').innerHTML = renderTable();
          bindTableSort();
          // Перерисовка заменила кнопку — возвращаем фокус на ту же колонку,
          // иначе после сортировки с клавиатуры фокус улетает в начало страницы.
          el.querySelector(`.sort-btn[data-sort="${key}"]`)?.focus();
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
