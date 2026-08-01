/* Выделено из 60-wheel-tests.view.js (2603 строки).
   Тесты для оператора: список доступных, история, карточки. */

/* ══════════════════════════════════════
   VIEW: ТЕСТЫ — общий диспетчер по роли
══════════════════════════════════════ */
let _testsTab = 'available'; // available | history (operator) | overview | list (staff)
let _testTimerInterval = null;
let _testResumeFailedFor = null; // attempt_id, на котором resumeTestRunner уже падал — не повторяем автоматически

function renderTests() {
  const el = document.getElementById('view-tests');
  if (!el) return;
  if (isAdmin(STATE.user?.role)) {
    renderTestsStaffView(el);
  } else {
    renderTestsOperatorView(el);
  }
}

/* ────────────────────────────────────────────────────────────────
   ОПЕРАТОРСКАЯ ЧАСТЬ
──────────────────────────────────────────────────────────────── */

async function renderTestsOperatorView(el) {
  const myNavGen = STATE.navGen;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Обучение</div><h2 class="section-title">Мои тесты</h2><div class="section-subtitle">Проверяйте знания и получайте награды за результат.</div></div>
      <button class="btn-outline btn-sm" onclick="renderTests()">Обновить</button>
    </div>
    <div id="tests-op-body"><div class="loading-state"><div class="loading-spinner"></div></div></div>`;

  let data;
  try {
    // Статус попытки нельзя брать из stale-while-revalidate кеша: sessionStorage
    // переживает F5, поэтому сохранённый до старта список мог вернуть тест как
    // available и скрыть уже идущую попытку. Для этого экрана всегда читаем
    // серверное состояние напрямую и лишь обновляем кеш для фонового prefetch.
    data = await api.myTests();
    swrWriteRaw('tests:my', { data, ts: Date.now() });
  } catch(e) {
    if (isNavStale(myNavGen)) return;
    el.querySelector('#tests-op-body').innerHTML = `<div class="status-line status-error">Не удалось загрузить тесты: ${esc(e.message)}</div>`;
    return;
  }
  if (isNavStale(myNavGen)) return;

  const items = data.items || [];

  // Если у оператора есть незавершённая попытка (in_progress) — это значит
  // он либо только начал тест, либо обновил страницу (F5) во время
  // прохождения. В любом случае нужно сразу показать экран теста с
  // таймером, а не список карточек — иначе F5 "выкидывает из теста"
  // (хотя на сервере попытка всё ещё активна и таймер продолжает идти).
  const inProgressTest = items.find(t => t.attempt_status === 'in_progress');
  // Защита от бесконечного цикла: если resumeTestRunner уже падал с ошибкой
  // на этой же попытке (например backend систематически роняет finish/start
  // на ней), не пытаемся восстановить её повторно при каждом рендере —
  // иначе получаем бесконечный цикл "ошибка -> renderTests() -> снова
  // находим in_progress -> снова resumeTestRunner -> снова ошибка",
  // который визуально выглядит как вечная загрузка.
  if (inProgressTest && _testResumeFailedFor !== inProgressTest.attempt_id) {
    const ok = await resumeTestRunner(inProgressTest.id);
    if (!ok) _testResumeFailedFor = inProgressTest.attempt_id;
    return;
  }

  const available = items.filter(t => ['available', 'in_progress'].includes(t.status));
  const completed = items.filter(t => t.status === 'finished');
  const expired = items.filter(t => t.status === 'expired');
  const history = [...completed, ...expired].sort((a, b) =>
    new Date(b.finished_at || 0) - new Date(a.finished_at || 0)
  );
  const upcoming = items.filter(t => t.status === 'upcoming');
  const averageScore = completed.length
    ? completed.reduce((sum, test) => sum + Number(test.score_percent || 0), 0) / completed.length
    : null;

  const body = el.querySelector('#tests-op-body');
  if (!items.length) {
    body.innerHTML = `<div class="empty-state"><p>Доступных тестов пока нет.</p></div>`;
    return;
  }

  body.innerHTML = `
    <div class="tests-summary-strip">
      <div><span>Новые задания</span><strong>${available.length}</strong></div>
      <div><span>Пройдено тестов</span><strong>${completed.length}</strong></div>
      <div><span>Средний результат</span><strong>${averageScore === null ? '—' : `${fmtA(averageScore, 0)}%`}</strong></div>
    </div>
    <section class="tests-section">
      <div class="tests-section-head"><div><h3>Новые задания</h3><p>Тесты, которые можно пройти сейчас.</p></div></div>
      ${available.length ? `<div class="test-card-grid">${available.map(testCardHtml).join('')}</div>` : `<div class="tests-empty-compact">Сейчас нет тестов для прохождения.</div>`}
    </section>
    ${upcoming.length ? `<section class="tests-section"><div class="tests-section-head"><div><h3>Скоро откроются</h3><p>Будущие задания.</p></div></div><div class="test-card-grid">${upcoming.map(testCardHtml).join('')}</div></section>` : ''}
    <section class="tests-section">
      <div class="tests-section-head"><div><h3>Мои результаты</h3><p>Пройденные тесты и полученные награды.</p></div></div>
      ${history.length ? `<div class="test-history-list">${history.map(testHistoryItemHtml).join('')}</div>` : `<div class="tests-empty-compact">Завершённых тестов пока нет.</div>`}
    </section>`;

  body.querySelectorAll('[data-test-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const testId = Number(btn.dataset.testId);
      const action = btn.dataset.testAction;
      if (action === 'start' || action === 'continue') openTestRunner(testId);
      if (action === 'result') openTestResultModal(btn.dataset.attemptId);
    });
  });
}

function testHistoryItemHtml(t) {
  const isFinished = t.status === 'finished';
  const dateLabel = t.finished_at ? fmtDate(t.finished_at) : 'Дата не указана';
  const resultLabel = t.passed === true ? 'Пройден' : (t.passed === false ? 'Нужно повторить' : 'Не завершён');
  const resultClass = t.passed === true ? 'is-passed' : (t.passed === false ? 'is-failed' : 'is-expired');
  const earned = [];
  if (Number(t.reward_coins_earned) > 0) earned.push(`+${fmtA(t.reward_coins_earned, 0)} коинов`);
  if (Number(t.reward_points_earned) > 0) earned.push(`+${fmtA(t.reward_points_earned, 0)} баллов`);

  return `<article class="test-history-item">
    <div class="test-history-main">
      <div class="test-history-date">${esc(dateLabel)}</div>
      <h4>${esc(t.title)}</h4>
      ${t.description ? `<p>${esc(t.description)}</p>` : `<p>${t.questions_count} вопросов</p>`}
    </div>
    <div class="test-history-score">
      ${isFinished ? `<strong>${fmtA(t.score_percent, 0)}%</strong><span>${t.correct_count} из ${t.questions_count} правильно</span>` : `<strong>—</strong><span>Тест не завершён</span>`}
    </div>
    <div class="test-history-outcome">
      <span class="test-history-status ${resultClass}">${resultLabel}</span>
      ${earned.length ? `<small>${earned.join(' · ')}</small>` : '<small>Без награды</small>'}
    </div>
    <div class="test-history-action">
      ${isFinished ? `<button class="btn-outline btn-sm" data-test-action="result" data-attempt-id="${t.attempt_id}">Посмотреть результат</button>` : ''}
    </div>
  </article>`;
}

function testStatusBadge(status) {
  const map = {
    upcoming: ['Скоро откроется', 'badge-neutral'],
    available: ['Доступен', 'badge-info'],
    in_progress: ['В процессе', 'badge-warning'],
    finished: ['Завершён', 'badge-success'],
    expired: ['Просрочен', 'badge-danger'],
    unavailable: ['Недоступен', 'badge-neutral'],
  };
  const [label, cls] = map[status] || [status, 'badge-neutral'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function testCardHtml(t) {
  const rewardParts = [];
  if (t.reward_type?.includes('coins')) rewardParts.push(`${t.reward_coins} ₡`);
  if (t.reward_type?.includes('points')) rewardParts.push(`${fmtA(t.reward_points, 0)} баллов`);
  const rewardLabel = rewardParts.join(' + ') || 'Без награды';

  let actionHtml = '';
  if (t.status === 'available') {
    actionHtml = `<button class="btn-primary btn-sm" data-test-action="start" data-test-id="${t.id}">Начать тест</button>`;
  } else if (t.status === 'in_progress') {
    actionHtml = `<button class="btn-primary btn-sm" data-test-action="continue" data-test-id="${t.id}">Продолжить</button>`;
  } else if (t.status === 'upcoming') {
    actionHtml = `<div class="test-card-disabled-note">Тест откроется ${fmtDateTime(t.opens_at)}</div>`;
  } else if (t.status === 'finished') {
    actionHtml = `<div class="test-card-result"><b>${fmtA(t.score_percent,0)}%</b><span>${t.correct_count} из ${t.questions_count} верно</span></div>
      ${t.reward_coins_earned ? `<div class="test-card-reward-earned">Получено +${t.reward_coins_earned} ₡</div>` : ''}
      <button class="btn-outline btn-sm" data-test-action="result" data-attempt-id="${t.attempt_id}">Подробнее</button>`;
  } else if (t.status === 'expired') {
    actionHtml = `<div class="test-card-disabled-note">Срок прохождения истёк</div>`;
  } else {
    actionHtml = `<div class="test-card-disabled-note">Недоступен</div>`;
  }

  return `<article class="test-card">
    <div class="test-card-head">
      <div><div class="test-card-title">${esc(t.title)}</div>${t.description ? `<div class="test-card-desc">${esc(t.description)}</div>` : ''}</div>
      ${testStatusBadge(t.status)}
    </div>
    <div class="test-card-meta">
      <span>${t.questions_count} вопросов</span><span>${t.time_limit_minutes} мин</span><span class="test-card-reward">${esc(rewardLabel)}</span>
    </div>
    ${t.closes_at && ['available', 'in_progress', 'upcoming'].includes(t.status) ? `<div class="test-card-deadline">До ${fmtDateTime(t.closes_at)}</div>` : ''}
    <div class="test-card-actions">${actionHtml}</div>
  </article>`;
}


/* ── Прохождение теста ────────────────────────────────────────── */
