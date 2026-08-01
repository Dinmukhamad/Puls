/* Выделено из 60-wheel-tests.view.js (2603 строки).
   Прохождение теста: таймер, вопросы, завершение, экран результата. */

let _activeTestRun = null; // { attemptId, questions, currentIndex, answers: {qid: [ids]}, expiresAt }

/**
 * Восстанавливает уже идущую попытку без показа предупреждающей модалки
 * (она была показана при первом старте теста) — вызывается автоматически
 * после F5, если у оператора есть активная попытка (status in_progress).
 * api.startTest безопасен для повторного вызова на уже идущей попытке —
 * backend возвращает существующий attempt_id/expires_at, не создавая новую.
 */
async function resumeTestRunner(testId) {
  try {
    const data = await api.startTest(testId);
    _activeTestRun = {
      attemptId: data.attempt_id,
      testTitle: data.test_title,
      questions: data.questions,
      currentIndex: 0,
      answers: data.saved_answers || {},
      expiresAt: new Date(data.expires_at).getTime(),
    };
    swrInvalidate('tests:my');
    invalidateViewCache('tests');
    renderTestRunnerScreen();
    return true;
  } catch(e) {
    showToast(e.message || 'Не удалось восстановить тест', 'error');
    renderTests();
    return false;
  }
}

async function openTestRunner(testId) {
  showModal(`
    <h3 class="modal-title">Перед началом теста</h3>
    <p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px">
      После начала теста запустится таймер.<br>
      Не закрывайте страницу до завершения.<br>
      Правильные ответы будут скрыты до окончания тестирования.
    </p>
    <div style="display:flex;gap:10px">
      <button class="btn-outline" style="flex:1" id="test-cancel-btn">Отмена</button>
      <button class="btn-primary" style="flex:1" id="test-confirm-start-btn">Начать тест</button>
    </div>
  `);
  document.getElementById('test-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('test-confirm-start-btn').addEventListener('click', async () => {
    try {
      const data = await api.startTest(testId);
      closeModal();
      _activeTestRun = {
        attemptId: data.attempt_id,
        testTitle: data.test_title,
        questions: data.questions,
        currentIndex: 0,
        answers: data.saved_answers || {},
        expiresAt: new Date(data.expires_at).getTime(),
      };
      swrInvalidate('tests:my');
      invalidateViewCache('tests');
      renderTestRunnerScreen();
    } catch(e) {
      closeModal();
      showToast(e.message || 'Не удалось начать тест', 'error');
    }
  });
}

function renderTestRunnerScreen() {
  const el = document.getElementById('view-tests');
  if (!el || !_activeTestRun) return;
  const run = _activeTestRun;
  const answeredCount = run.questions.filter(q => (run.answers[q.id] || []).length > 0).length;

  el.innerHTML = `
    <div class="test-runner">
      <header class="test-runner-head">
        <div>
          <div class="section-kicker">Тестирование</div>
          <h2 class="test-runner-title">${esc(run.testTitle)}</h2>
          <div class="test-runner-progress-label"><strong id="test-answered-count">${answeredCount}</strong> из ${run.questions.length} отвечено</div>
        </div>
        <div class="test-runner-timer-wrap">
          <span>Осталось</span>
          <div class="test-runner-timer" id="test-timer">--:--</div>
        </div>
      </header>
      <div class="test-runner-overview">
        <div class="test-runner-progress-bar"><div class="test-runner-progress-fill" id="test-progress-fill" style="width:${Math.round(answeredCount / Math.max(run.questions.length, 1) * 100)}%"></div></div>
        <nav class="test-question-nav" aria-label="Навигация по вопросам">
          ${run.questions.map((q, index) => `<button type="button" class="test-question-nav-item ${index === 0 ? 'current' : ''} ${(run.answers[q.id] || []).length ? 'answered' : ''}" data-question-nav="${index}" title="Вопрос ${index + 1}">${index + 1}</button>`).join('')}
        </nav>
        <div class="test-question-nav-legend"><span><i class="is-current"></i>Текущий</span><span><i class="is-answered"></i>Отвечен</span><span><i></i>Без ответа</span></div>
      </div>
      <main class="test-runner-questions">
        ${run.questions.map((q, index) => testRunnerQuestionHtml(q, index, run.answers[q.id] || [])).join('')}
      </main>
      <footer class="test-runner-finish">
        <div><strong id="test-finish-summary">${answeredCount} из ${run.questions.length}</strong><span>Ответы сохраняются автоматически</span></div>
        <button class="btn-primary" id="test-nav-finish">Завершить тест</button>
      </footer>
    </div>`;

  el.querySelectorAll('[data-test-answer]').forEach(input => {
    input.addEventListener('change', () => {
      const questionId = Number(input.dataset.questionId);
      const questionIndex = Number(input.dataset.questionIndex);
      const q = run.questions[questionIndex];
      const answerId = Number(input.value);
      if (q.question_type === 'multiple_choice') {
        const set = new Set(run.answers[questionId] || []);
        if (input.checked) set.add(answerId); else set.delete(answerId);
        run.answers[questionId] = [...set];
      } else {
        run.answers[questionId] = [answerId];
      }
      const questionEl = input.closest('.test-runner-question');
      questionEl.querySelectorAll('.test-runner-answer-row').forEach(row => {
        const rowInput = row.querySelector('[data-test-answer]');
        row.classList.toggle('selected', rowInput.checked);
      });
      updateTestRunnerProgress();
      api.saveTestAnswer(run.attemptId, questionId, run.answers[questionId]).catch(err => {
        showToast(err.message || 'Не удалось сохранить ответ', 'error');
      });
    });
  });

  el.querySelectorAll('[data-question-nav]').forEach(button => {
    button.addEventListener('click', () => focusTestQuestion(Number(button.dataset.questionNav)));
  });
  el.querySelector('#test-nav-finish')?.addEventListener('click', confirmFinishTestRun);

  if ('IntersectionObserver' in window) {
    run.questionObserver?.disconnect?.();
    run.questionObserver = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const index = Number(visible.target.dataset.questionIndex);
      run.currentIndex = index;
      el.querySelectorAll('[data-question-nav]').forEach(button => button.classList.toggle('current', Number(button.dataset.questionNav) === index));
    }, { rootMargin: '-20% 0px -60% 0px', threshold: [0, .25, .6] });
    el.querySelectorAll('.test-runner-question').forEach(question => run.questionObserver.observe(question));
  }

  startTestTimer();
}

function testRunnerQuestionHtml(question, index, selected) {
  const inputType = question.question_type === 'multiple_choice' ? 'checkbox' : 'radio';
  const instruction = question.question_type === 'multiple_choice' ? 'Можно выбрать несколько вариантов' : 'Выберите один вариант';
  return `<section class="test-runner-question" id="test-question-${index + 1}" data-question-index="${index}">
    <div class="test-runner-question-head">
      <span class="test-runner-question-number">${String(index + 1).padStart(2, '0')}</span>
      <div><h3>${esc(question.question_text)}</h3><p>${instruction}</p></div>
    </div>
    <div class="test-runner-answers">
      ${question.answers.map((answer, answerIndex) => `
        <label class="test-runner-answer-row ${selected.includes(answer.id) ? 'selected' : ''}">
          <input type="${inputType}" name="test-answer-${question.id}" value="${answer.id}" data-test-answer data-question-id="${question.id}" data-question-index="${index}" ${selected.includes(answer.id) ? 'checked' : ''}>
          <i class="test-answer-control" aria-hidden="true"></i>
          <span class="test-answer-letter">${String.fromCharCode(65 + answerIndex)}</span>
          <span class="test-answer-text">${esc(answer.answer_text)}</span>
        </label>
      `).join('')}
    </div>
  </section>`;
}

function updateTestRunnerProgress() {
  if (!_activeTestRun) return;
  const run = _activeTestRun;
  const answered = run.questions.filter(question => (run.answers[question.id] || []).length > 0).length;
  const countEl = document.getElementById('test-answered-count');
  const summaryEl = document.getElementById('test-finish-summary');
  const fillEl = document.getElementById('test-progress-fill');
  if (countEl) countEl.textContent = answered;
  if (summaryEl) summaryEl.textContent = `${answered} из ${run.questions.length}`;
  if (fillEl) fillEl.style.width = `${Math.round(answered / Math.max(run.questions.length, 1) * 100)}%`;
  document.querySelectorAll('[data-question-nav]').forEach(button => {
    const question = run.questions[Number(button.dataset.questionNav)];
    button.classList.toggle('answered', (run.answers[question.id] || []).length > 0);
  });
}

function focusTestQuestion(index) {
  if (!_activeTestRun) return;
  _activeTestRun.currentIndex = index;
  document.querySelectorAll('[data-question-nav]').forEach(button => button.classList.toggle('current', Number(button.dataset.questionNav) === index));
  document.getElementById(`test-question-${index + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function confirmFinishTestRun() {
  if (!_activeTestRun) return;
  const unanswered = _activeTestRun.questions.filter(question => !(_activeTestRun.answers[question.id] || []).length).length;
  if (!unanswered) {
    finishTestRun();
    return;
  }
  showModal(`<div class="test-finish-modal">
    <div class="section-kicker">Завершение теста</div>
    <h3 class="modal-title">Остались вопросы без ответа</h3>
    <p>Без ответа: <strong>${unanswered}</strong>. После завершения изменить ответы будет нельзя.</p>
    <div class="test-finish-modal-actions"><button class="btn-outline" id="test-finish-return">Вернуться к вопросам</button><button class="btn-primary" id="test-finish-confirm">Завершить тест</button></div>
  </div>`);
  document.getElementById('test-finish-return').onclick = closeModal;
  document.getElementById('test-finish-confirm').onclick = () => { closeModal(); finishTestRun(); };
}

function startTestTimer() {
  if (_testTimerInterval) clearInterval(_testTimerInterval);
  const tick = () => {
    if (!_activeTestRun) { clearInterval(_testTimerInterval); return; }
    const remainMs = _activeTestRun.expiresAt - Date.now();
    const timerEl = document.getElementById('test-timer');
    if (!timerEl) { clearInterval(_testTimerInterval); return; }
    if (remainMs <= 0) {
      clearInterval(_testTimerInterval);
      timerEl.textContent = '00:00';
      showToast('Время теста истекло. Ответы были отправлены автоматически.', 'error');
      finishTestRun();
      return;
    }
    const totalSec = Math.floor(remainMs / 1000);
    const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
    timerEl.classList.toggle('test-timer-warning', totalSec < 60);
  };
  tick();
  _testTimerInterval = setInterval(tick, 1000);
}

async function finishTestRun() {
  if (!_activeTestRun) return;
  clearInterval(_testTimerInterval);
  const attemptId = _activeTestRun.attemptId;
  try {
    const result = await api.finishTest(attemptId);
    _activeTestRun.questionObserver?.disconnect?.();
    _activeTestRun = null;
    swrInvalidate('tests:my'); // статус теста изменился (finished) — следующий заход в список не должен показать устаревшее "in_progress"
    invalidateViewCache('tests');
    renderTestResultScreen(result);
  } catch(e) {
    showToast(e.message || 'Не удалось завершить тест', 'error');
    if (_activeTestRun) startTestTimer();
  }
}

function renderTestResultScreen(result) {
  const el = document.getElementById('view-tests');
  if (!el) return;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Тесты</div><h2 class="section-title">Результат теста</h2></div>
      <button class="btn-primary btn-sm" onclick="renderTests()">К списку тестов</button>
    </div>
    ${testResultCardHtml(result)}
  `;
}

function testResultCardHtml(result) {
  const passed = result.passed;
  const statusClass = passed === null ? 'neutral' : (passed ? 'passed' : 'failed');
  return `<div class="test-result-card">
    <div class="test-result-head">
      <div><div class="section-kicker">Итог</div><div class="test-result-title">${esc(result.test_title)}</div></div>
      <span class="test-result-status ${statusClass}">${passed === null ? 'Завершён' : (passed ? 'Пройден' : 'Не пройден')}</span>
    </div>
    <div class="test-result-grid">
      <div class="test-result-stat"><div class="test-result-stat-label">Правильных ответов</div><div class="test-result-stat-value">${result.correct_count} из ${result.questions_count}</div></div>
      <div class="test-result-stat"><div class="test-result-stat-label">Процент</div><div class="test-result-stat-value">${fmtA(result.score_percent,0)}%</div></div>
      <div class="test-result-stat"><div class="test-result-stat-label">Баллы</div><div class="test-result-stat-value">${fmtA(result.score_points,1)}</div></div>
      <div class="test-result-stat"><div class="test-result-stat-label">Результат</div><div class="test-result-stat-value">${passed === null ? '—' : (passed ? 'Успешно' : 'Попробуйте ещё')}</div></div>
    </div>
    ${(result.reward_coins > 0 || result.reward_points > 0) ? `
      <div class="test-result-reward">
        ${result.reward_coins > 0 ? `Награда: +${result.reward_coins} коинов` : ''}
        ${result.reward_points > 0 ? ` +${fmtA(result.reward_points,1)} баллов` : ''}
      </div>` : ''}
    ${result.questions ? renderTestCorrectAnswersBlock(result) : ''}
  </div>`;
}

function renderTestCorrectAnswersBlock(result) {
  return `<div class="test-result-answers">
    <div class="test-result-section-head"><h3>Разбор ответов</h3><span>${result.questions.length} вопросов</span></div>
    ${result.questions.map((q, index) => {
      const yourIds = (result.your_answers && result.your_answers[q.id]) || [];
      return `<div class="test-result-question">
        <div class="test-result-question-text"><span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(q.question_text)}</strong></div>
        ${q.answers.map(a => {
          const wasSelected = yourIds.includes(a.id);
          const cls = a.is_correct ? 'correct' : (wasSelected ? 'incorrect' : '');
          return `<div class="test-result-answer-row ${cls} ${wasSelected ? 'selected' : ''}"><i aria-hidden="true"></i><span>${esc(a.answer_text)}</span>${wasSelected ? '<small>Ваш ответ</small>' : ''}</div>`;
        }).join('')}
      </div>`;
    }).join('')}
  </div>`;
}

async function openTestResultModal(attemptId) {
  try {
    const result = await api.getTestResult(attemptId);
    showModal(`<div style="max-height:70vh;overflow-y:auto">${testResultCardHtml(result)}</div>`);
  } catch(e) {
    showToast(e.message || 'Не удалось загрузить результат', 'error');
  }
}

/* ────────────────────────────────────────────────────────────────
   АДМИНСКАЯ ЧАСТЬ (supervisor / manager / admin)
──────────────────────────────────────────────────────────────── */
