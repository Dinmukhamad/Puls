/* Выделено из 60-wheel-tests.view.js (2603 строки).
   Административный список тестов. */

async function renderTestsStaffView(el) {
  const myNavGen = STATE.navGen;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Обучение команды</div><h2 class="section-title">Тесты</h2><div class="section-subtitle">Создавайте проверки знаний и отслеживайте результаты операторов.</div></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="renderTests()">Обновить</button>
        <button class="btn-primary btn-sm" id="tests-new-btn">Создать тест</button>
      </div>
    </div>
    <div id="tests-staff-body"><div class="loading-state"><div class="loading-spinner"></div></div></div>`;

  el.querySelector('#tests-new-btn').addEventListener('click', () => openTestBuilder(null));

  let data;
  try {
    data = await swrFetch('tests:admin-list', () => api.listAdminTests(), null, SWR_FAST_TTL_MS);
  } catch(e) {
    if (isNavStale(myNavGen)) return;
    el.querySelector('#tests-staff-body').innerHTML = `<div class="status-line status-error">${esc(e.message)}</div>`;
    return;
  }
  if (isNavStale(myNavGen)) return;

  const items = data.items || [];
  const body = el.querySelector('#tests-staff-body');
  if (!items.length) {
    body.innerHTML = `<div class="empty-state"><p>Тестов пока нет. Создайте первый тест.</p></div>`;
    return;
  }

  const statusLabel = { draft: 'Черновик', scheduled: 'Запланирован', open: 'Открыт', finished: 'Завершён', archived: 'Архив' };
  const statusBadgeClass = { draft: 'badge-neutral', scheduled: 'badge-info', open: 'badge-success', finished: 'badge-warning', archived: 'badge-neutral' };

  const openCount = items.filter(t => t.status === 'open').length;
  const draftCount = items.filter(t => ['draft', 'scheduled'].includes(t.status)).length;
  const finishedAttempts = items.reduce((sum, t) => sum + Number(t.attempts_finished || 0), 0);
  const averages = items.filter(t => t.average_percent != null).map(t => Number(t.average_percent));
  const averageScore = averages.length ? Math.round(averages.reduce((sum, value) => sum + value, 0) / averages.length) : 0;

  body.innerHTML = `
    <div class="tests-admin-summary">
      <div><span>Всего тестов</span><strong>${items.length}</strong></div>
      <div><span>Открыты сейчас</span><strong>${openCount}</strong></div>
      <div><span>Черновики и планы</span><strong>${draftCount}</strong></div>
      <div><span>Завершено попыток</span><strong>${finishedAttempts}</strong></div>
      <div><span>Средний результат</span><strong>${averageScore}%</strong></div>
    </div>
    <div class="tests-admin-panel">
      <div class="tests-admin-toolbar">
        <div class="filter-tabs tests-filter-tabs">
          <button class="filter-tab active" data-tests-filter="all">Все <span>${items.length}</span></button>
          <button class="filter-tab" data-tests-filter="open">Открытые <span>${openCount}</span></button>
          <button class="filter-tab" data-tests-filter="draft">Черновики <span>${draftCount}</span></button>
          <button class="filter-tab" data-tests-filter="finished">Завершённые <span>${items.filter(t => t.status === 'finished').length}</span></button>
        </div>
      </div>
      <div class="tests-admin-list">
        ${items.map(t => `<article class="tests-admin-row" data-test-status="${t.status}">
          <div class="tests-admin-main">
            <div class="tests-admin-title-line"><h3>${esc(t.title)}</h3><span class="badge ${statusBadgeClass[t.status]||'badge-neutral'}">${statusLabel[t.status]||t.status}</span></div>
            <div class="tests-admin-meta"><span>${t.questions_count} вопросов</span><span>${t.time_limit_minutes} мин</span><span>${t.opens_at ? `Старт ${fmtDateTime(t.opens_at)}` : 'Без даты старта'}</span></div>
          </div>
          <div class="tests-admin-result"><span>Прошли</span><strong>${t.attempts_finished}</strong></div>
          <div class="tests-admin-result"><span>Средний результат</span><strong>${t.average_percent != null ? t.average_percent + '%' : '—'}</strong></div>
          <div class="tests-admin-actions">
            <button class="btn-outline btn-sm" data-test-results="${t.id}">Результаты</button>
            <button class="btn-outline btn-sm" data-test-edit="${t.id}">Настроить</button>
            ${t.status==='draft'||t.status==='scheduled' ? `<button class="btn-primary btn-sm" data-test-publish="${t.id}">Опубликовать</button>` : ''}
            ${t.status==='open' ? `<button class="btn-outline btn-sm" data-test-close="${t.id}">Закрыть</button>` : ''}
          </div>
        </article>`).join('')}
      </div>
    </div>`;

  body.querySelectorAll('[data-tests-filter]').forEach(button => button.addEventListener('click', () => {
    body.querySelectorAll('[data-tests-filter]').forEach(item => item.classList.toggle('active', item === button));
    const filter = button.dataset.testsFilter;
    body.querySelectorAll('[data-test-status]').forEach(row => {
      const status = row.dataset.testStatus;
      const visible = filter === 'all' || status === filter || (filter === 'draft' && ['draft', 'scheduled'].includes(status));
      row.hidden = !visible;
    });
  }));

  body.querySelectorAll('[data-test-edit]').forEach(btn => btn.addEventListener('click', () => openTestBuilder(Number(btn.dataset.testEdit))));
  body.querySelectorAll('[data-test-results]').forEach(btn => btn.addEventListener('click', () => openTestResultsView(Number(btn.dataset.testResults))));
  body.querySelectorAll('[data-test-publish]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api.publishTest(Number(btn.dataset.testPublish));
      swrInvalidate('tests:'); // публикация меняет статус — сбрасываем и admin-list, и операторский my-list
      showToast('Тест опубликован', 'ok');
      renderTests();
    }
    catch(e) { showToast(e.message, 'error'); }
  }));
  body.querySelectorAll('[data-test-close]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api.closeTest(Number(btn.dataset.testClose));
      swrInvalidate('tests:');
      showToast('Тест закрыт', 'ok');
      renderTests();
    }
    catch(e) { showToast(e.message, 'error'); }
  }));
}

/* ── Конструктор теста ────────────────────────────────────────── */
