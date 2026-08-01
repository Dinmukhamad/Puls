/* Выделено из 40-reports-analytics.view.js (2671 строка).
   Каркас раздела: вкладки, диспетчер загрузки, предупреждения о данных. */

async function renderAnalytics() {
  const el = document.getElementById('view-analytics');
  if (!el) return;
  const myNavGen = STATE.navGen;

  const urlParams = getAnalyticsParams();
  _analyticsState.tab = ANALYTICS_TABS.some(item => item.key === urlParams.tab) ? urlParams.tab : 'overview';

  if (!_analyticsState.startDate) {
    const initialPeriod = await resolveInitialAnalyticsPeriod(urlParams);
    if (isNavStale(myNavGen)) return;
    _analyticsState.startDate = initialPeriod.start;
    _analyticsState.endDate = initialPeriod.end;
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
      <div class="an-quick-periods" aria-label="Быстрый выбор периода">
        <button type="button" data-an-period="day">День</button><button type="button" data-an-period="week">Неделя</button><button type="button" data-an-period="month">Месяц</button><span>или укажите диапазон вручную</span>
      </div>
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
        <button class="btn-outline" id="an-reset-btn">Сбросить</button>
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
    _analyticsState.operatorPage = 1;
    if (!_analyticsState.startDate || !_analyticsState.endDate || _analyticsState.startDate > _analyticsState.endDate) {
      el.querySelector('#an-availability-warning').innerHTML = '<div class="an-availability-note an-availability-note-error">Проверьте выбранный диапазон дат.</div>';
      return;
    }
    _analyticsState.qualityGridWeekStart = null; // пересчитать неделю сетки под новый период
    updateUrl();
    refreshAnalyticsContextBar(el);
    refreshAnalyticsCoverage(el);
    loadAnalyticsTab(_analyticsState.tab);
  });

  el.querySelector('#an-reset-btn').addEventListener('click', async () => {
    const initial = await resolveInitialAnalyticsPeriod({});
    Object.assign(_analyticsState, { startDate: initial.start, endDate: initial.end, groupId: '', operatorQuery: '', participationStatus: 'all', onlyWithData: false, operatorPage: 1 });
    renderAnalytics();
  });
  el.querySelectorAll('[data-an-period]').forEach(button => button.addEventListener('click', () => {
    const end = new Date(); const start = new Date(end);
    start.setDate(end.getDate() - (button.dataset.anPeriod === 'day' ? 0 : button.dataset.anPeriod === 'month' ? 29 : 6));
    el.querySelector('#an-start').value = start.toISOString().slice(0, 10);
    el.querySelector('#an-end').value = end.toISOString().slice(0, 10);
  }));

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
