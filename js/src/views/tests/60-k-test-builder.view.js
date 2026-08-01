/* Выделено из 60-wheel-tests.view.js (2603 строки).
   Конструктор теста: вопросы, награды, назначение, публикация. */

let _testBuilderState = null; // { testId, test, questions: [...], assignTargetType, assignTargetIds }

async function openTestBuilder(testId) {
  const el = document.getElementById('view-tests');
  if (!el) return;

  let test = null;
  if (testId) {
    try {
      test = await api.getAdminTest(testId);
    } catch(e) {
      showToast(e.message || 'Не удалось загрузить тест', 'error');
      return;
    }
  }

  _testBuilderState = {
    testId: testId,
    title: test?.title || '',
    description: test?.description || '',
    instruction: test?.instruction || '',
    time_limit_minutes: test?.time_limit_minutes || 30,
    opens_at: utcISOStringToLocalDateTimeInput(test?.opens_at),
    closes_at: utcISOStringToLocalDateTimeInput(test?.closes_at),
    passing_percent: test?.passing_percent ?? 70,
    show_result_after_finish: test?.show_result_after_finish ?? true,
    show_correct_answers: test?.show_correct_answers ?? false,
    allow_retake: test?.allow_retake ?? false,
    max_attempts: test?.max_attempts ?? 1,
    reward_type: test?.reward_type || 'none',
    reward_points: test?.reward_points ?? 0,
    reward_coins: test?.reward_coins ?? 0,
    reward_min_percent: test?.reward_min_percent ?? 70,
    reward_mode: test?.reward_mode || 'fixed',
    questions: (test?.questions || []).map(question => ({
      ...question,
      answers: (question.answers || []).map(answer => ({ ...answer })),
    })),
    deletedQuestionIds: [],
    assignTargetType: test?.assignments?.[0]?.target_type || 'all',
    assignTargetIds: (test?.assignments || []).filter(a => a.target_id != null).map(a => a.target_id),
    status: test?.status || 'draft',
  };

  renderTestBuilderScreen();
}

function renderTestBuilderScreen() {
  const el = document.getElementById('view-tests');
  if (!el || !_testBuilderState) return;
  const s = _testBuilderState;
  const isOpen = s.status === 'open';

  el.innerHTML = `
    <div class="view-header test-builder-header">
      <div><div class="section-kicker">Конструктор теста</div><h2 class="section-title">${s.testId ? 'Настройка теста' : 'Новый тест'}</h2><div class="section-subtitle">Заполните параметры, добавьте вопросы и назначьте аудиторию.</div></div>
      <button class="btn-outline btn-sm" onclick="renderTests()">К списку</button>
    </div>
    ${isOpen ? '<div class="test-builder-notice">Тест уже открыт. Можно изменить дату закрытия и назначение.</div>' : ''}
    <div class="test-builder-shell">
      <section class="test-builder-section">
        <div class="test-builder-section-head"><span>01</span><div><h3>Основные параметры</h3><p>Название, расписание и условия прохождения.</p></div></div>
        <div class="test-builder-fields">
          <div class="form-group test-builder-span-2"><label class="form-label">Название теста</label><input id="tb-title" class="form-input" placeholder="Например: Проверка знаний продукта" value="${esc(s.title)}" ${isOpen?'disabled':''}></div>
          <div class="form-group test-builder-span-2"><label class="form-label">Краткое описание</label><textarea id="tb-description" class="form-input" rows="2" placeholder="Что проверяет этот тест" ${isOpen?'disabled':''}>${esc(s.description)}</textarea></div>
          <div class="form-group test-builder-span-2"><label class="form-label">Инструкция оператору</label><textarea id="tb-instruction" class="form-input" rows="2" placeholder="Что важно знать перед началом" ${isOpen?'disabled':''}>${esc(s.instruction)}</textarea></div>
          <div class="form-group"><label class="form-label">Открытие</label><input id="tb-opens-at" type="datetime-local" class="form-input" value="${s.opens_at}" ${isOpen?'disabled':''}></div>
          <div class="form-group"><label class="form-label">Закрытие</label><input id="tb-closes-at" type="datetime-local" class="form-input" value="${s.closes_at}"></div>
          <div class="form-group"><label class="form-label">Время, минут</label><input id="tb-time-limit" type="number" min="1" class="form-input" value="${s.time_limit_minutes}" ${isOpen?'disabled':''}></div>
          <div class="form-group"><label class="form-label">Проходной результат, %</label><input id="tb-passing-percent" type="number" min="0" max="100" class="form-input" value="${s.passing_percent}" ${isOpen?'disabled':''}></div>
          <div class="form-group"><label class="form-label">Максимум попыток</label><input id="tb-max-attempts" type="number" min="1" class="form-input" value="${s.max_attempts}" ${isOpen?'disabled':''}></div>
        </div>
        <div class="test-toggle-list">
          <label class="test-toggle-row"><span><strong>Показать результат</strong><small>Оператор увидит процент и статус сразу после завершения.</small></span><input type="checkbox" id="tb-show-result" ${s.show_result_after_finish?'checked':''} ${isOpen?'disabled':''}><i></i></label>
          <label class="test-toggle-row"><span><strong>Показать правильные ответы</strong><small>После завершения будут доступны верные варианты.</small></span><input type="checkbox" id="tb-show-correct" ${s.show_correct_answers?'checked':''} ${isOpen?'disabled':''}><i></i></label>
          <label class="test-toggle-row"><span><strong>Разрешить повторное прохождение</strong><small>Количество попыток ограничивается значением выше.</small></span><input type="checkbox" id="tb-allow-retake" ${s.allow_retake?'checked':''} ${isOpen?'disabled':''}><i></i></label>
        </div>
      </section>

      <section class="test-builder-section">
        <div class="test-builder-section-head"><span>02</span><div><h3>Награда</h3><p>Коины начисляются автоматически после успешного завершения.</p></div></div>
        <div class="test-builder-fields">
          <div class="form-group test-builder-span-2"><label class="form-label">Тип награды</label><select id="tb-reward-type" class="form-select" ${isOpen?'disabled':''}><option value="none" ${s.reward_type==='none'?'selected':''}>Без награды</option><option value="points" ${s.reward_type==='points'?'selected':''}>Баллы</option><option value="coins" ${s.reward_type==='coins'?'selected':''}>Коины</option><option value="points_and_coins" ${s.reward_type==='points_and_coins'?'selected':''}>Баллы и коины</option></select></div>
          <div class="form-group" data-reward-field="points"><label class="form-label">Баллы</label><input id="tb-reward-points" type="number" min="0" class="form-input" value="${s.reward_points}" ${isOpen?'disabled':''}></div>
          <div class="form-group" data-reward-field="coins"><label class="form-label">Коины</label><input id="tb-reward-coins" type="number" min="0" class="form-input" value="${s.reward_coins}" ${isOpen?'disabled':''}></div>
          <div class="form-group" data-reward-field="settings"><label class="form-label">Порог для награды, %</label><input id="tb-reward-min-percent" type="number" min="0" max="100" class="form-input" value="${s.reward_min_percent}" ${isOpen?'disabled':''}></div>
          <div class="form-group" data-reward-field="settings"><label class="form-label">Начисление</label><select id="tb-reward-mode" class="form-select" ${isOpen?'disabled':''}><option value="fixed" ${s.reward_mode==='fixed'?'selected':''}>Фиксированное</option><option value="proportional" ${s.reward_mode==='proportional'?'selected':''}>По результату</option></select></div>
        </div>
        <div class="test-reward-note" id="tb-reward-note"></div>
      </section>

      <section class="test-builder-section">
        <div class="test-builder-section-head test-builder-section-head-action"><span>03</span><div><h3>Вопросы</h3><p>${s.questions.length ? `${s.questions.length} ${s.questions.length === 1 ? 'вопрос' : 'вопросов'} в тесте` : 'Добавьте первый вопрос и варианты ответа.'}</p></div>${!isOpen?'<button class="btn-outline btn-sm" id="tb-add-question">Добавить вопрос</button>':''}</div>
        <div id="tb-questions-list" class="test-questions-list">${s.questions.map((q,i) => questionEditorHtml(q,i,isOpen)).join('') || '<div class="tests-empty-compact">Вопросов пока нет.</div>'}</div>
      </section>

      <section class="test-builder-section">
        <div class="test-builder-section-head"><span>04</span><div><h3>Назначение</h3><p>Выберите операторов, которым будет доступен тест.</p></div></div>
        <div class="form-group"><label class="form-label">Аудитория</label><select id="tb-assign-type" class="form-select"><option value="all" ${s.assignTargetType==='all'?'selected':''}>Все операторы</option><option value="group" ${s.assignTargetType==='group'?'selected':''}>Выбранные группы</option><option value="operator" ${s.assignTargetType==='operator'?'selected':''}>Отдельные операторы</option></select></div>
        <div id="tb-assign-targets"></div>
      </section>
    </div>
    <div class="test-builder-actions"><button class="btn-outline" id="tb-save-draft">Сохранить${s.testId?'':' черновик'}</button><button class="btn-primary" id="tb-save-and-publish">${s.status==='open'?'Сохранить изменения':'Сохранить и опубликовать'}</button></div>`;

  el.querySelector('#tb-add-question')?.addEventListener('click', () => {
    captureTestBuilderForm(el);
    s.questions.push({ question_text: '', question_type: 'single_choice', points: 1, answers: [{answer_text:'',is_correct:false},{answer_text:'',is_correct:false}] });
    renderTestBuilderScreen();
  });

  bindQuestionEditorEvents(el, isOpen);
  renderAssignTargetsBlock(el);
  updateTestRewardFields(el);
  el.querySelector('#tb-reward-type')?.addEventListener('change', () => updateTestRewardFields(el));
  el.querySelector('#tb-assign-type').addEventListener('change', (e) => { s.assignTargetType = e.target.value; renderAssignTargetsBlock(el); });

  el.querySelector('#tb-save-draft').addEventListener('click', () => saveTestBuilder(false));
  el.querySelector('#tb-save-and-publish').addEventListener('click', () => saveTestBuilder(true));
}

function captureTestBuilderForm(el) {
  const s = _testBuilderState;
  if (!s || !el?.querySelector('#tb-title')) return;
  s.title = el.querySelector('#tb-title').value;
  s.description = el.querySelector('#tb-description').value;
  s.instruction = el.querySelector('#tb-instruction').value;
  s.time_limit_minutes = Number(el.querySelector('#tb-time-limit').value);
  s.opens_at = el.querySelector('#tb-opens-at').value;
  s.closes_at = el.querySelector('#tb-closes-at').value;
  s.passing_percent = Number(el.querySelector('#tb-passing-percent').value);
  s.max_attempts = Number(el.querySelector('#tb-max-attempts').value);
  s.show_result_after_finish = el.querySelector('#tb-show-result').checked;
  s.show_correct_answers = el.querySelector('#tb-show-correct').checked;
  s.allow_retake = el.querySelector('#tb-allow-retake').checked;
  s.reward_type = el.querySelector('#tb-reward-type').value;
  s.reward_points = Number(el.querySelector('#tb-reward-points').value);
  s.reward_coins = Number(el.querySelector('#tb-reward-coins').value);
  s.reward_min_percent = Number(el.querySelector('#tb-reward-min-percent').value);
  s.reward_mode = el.querySelector('#tb-reward-mode').value;
}

function updateTestRewardFields(el) {
  const type = el.querySelector('#tb-reward-type')?.value || 'none';
  el.querySelectorAll('[data-reward-field]').forEach(field => {
    const kind = field.dataset.rewardField;
    field.hidden = type === 'none' || (kind === 'points' && !type.includes('points')) || (kind === 'coins' && !type.includes('coins'));
  });
  const note = el.querySelector('#tb-reward-note');
  if (note) note.textContent = type === 'none' ? 'Тест будет проверять знания без начисления награды.' : 'Награда создаётся одной транзакцией после успешной проверки результата.';
}

function questionEditorHtml(q, index, isOpen) {
  const canDelete = STATE.user?.role === 'admin';
  return `<div class="test-question-editor" data-q-index="${index}">
    <div class="test-question-number">${String(index + 1).padStart(2, '0')}</div>
    <div class="test-question-content">
      <div class="test-question-editor-head">
        <div class="form-group test-question-title-field"><label class="form-label">Вопрос</label><input class="form-input" placeholder="Введите текст вопроса" value="${esc(q.question_text)}" data-q-field="question_text" ${isOpen?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Тип ответа</label><select class="form-select" data-q-field="question_type" ${isOpen?'disabled':''}>
        <option value="single_choice" ${q.question_type==='single_choice'?'selected':''}>Один ответ</option>
        <option value="multiple_choice" ${q.question_type==='multiple_choice'?'selected':''}>Несколько ответов</option>
        </select></div>
        <div class="form-group test-question-points"><label class="form-label">Баллы</label><input class="form-input" type="number" min="0" value="${q.points}" data-q-field="points" ${isOpen?'disabled':''}></div>
        ${!isOpen && canDelete ? `<button class="test-icon-button test-question-delete" data-q-delete title="Удалить вопрос" aria-label="Удалить вопрос">×</button>` : ''}
      </div>
      <div class="test-answer-label">Варианты ответа <span>Отметьте правильный</span></div>
      <div class="test-answer-options">
        ${q.answers.map((a,ai) => `<div class="test-answer-option-row" data-a-index="${ai}">
          <label class="test-correct-control" title="Правильный ответ"><input type="${q.question_type==='multiple_choice'?'checkbox':'radio'}" name="correct-${index}" data-a-field="is_correct" ${a.is_correct?'checked':''} ${isOpen?'disabled':''}><i></i></label>
          <input class="form-input" placeholder="Вариант ${ai + 1}" value="${esc(a.answer_text)}" data-a-field="answer_text" ${isOpen?'disabled':''}>
          ${!isOpen && canDelete && q.answers.length > 2 ? `<button class="test-icon-button" data-a-delete title="Удалить вариант" aria-label="Удалить вариант">×</button>` : ''}
        </div>`).join('')}
      </div>
      ${!isOpen && q.answers.length < 10 ? `<button class="btn-outline btn-sm test-add-answer" data-q-add-answer>Добавить вариант</button>` : ''}
    </div>
  </div>`;
}

function bindQuestionEditorEvents(el, isOpen) {
  const s = _testBuilderState;
  el.querySelectorAll('[data-q-index]').forEach(qDiv => {
    const qi = Number(qDiv.dataset.qIndex);
    qDiv.querySelectorAll('[data-q-field]').forEach(input => {
      input.addEventListener('input', () => { s.questions[qi][input.dataset.qField] = input.type === 'number' ? Number(input.value) : input.value; });
      input.addEventListener('change', () => {
        if (input.dataset.qField === 'question_type') {
          captureTestBuilderForm(el);
          renderTestBuilderScreen();
        }
      });
    });
    qDiv.querySelector('[data-q-delete]')?.addEventListener('click', async () => {
      const confirmed = await uiConfirmAction({
        title: 'Удалить вопрос?',
        description: 'Вопрос и все варианты ответа будут удалены после сохранения теста.',
        confirmLabel: 'Удалить',
      });
      if (!confirmed) return;
      captureTestBuilderForm(el);
      const removed = s.questions[qi];
      if (removed?.id) s.deletedQuestionIds.push(removed.id);
      s.questions.splice(qi, 1);
      renderTestBuilderScreen();
    });
    qDiv.querySelector('[data-q-add-answer]')?.addEventListener('click', () => { captureTestBuilderForm(el); s.questions[qi].answers.push({answer_text:'',is_correct:false}); renderTestBuilderScreen(); });

    qDiv.querySelectorAll('[data-a-index]').forEach(aDiv => {
      const ai = Number(aDiv.dataset.aIndex);
      aDiv.querySelectorAll('[data-a-field]').forEach(input => {
        input.addEventListener('input', () => {
          if (input.dataset.aField === 'is_correct') {
            if (s.questions[qi].question_type === 'single_choice') {
              s.questions[qi].answers.forEach(a => a.is_correct = false);
            }
            s.questions[qi].answers[ai].is_correct = input.checked;
          } else {
            s.questions[qi].answers[ai][input.dataset.aField] = input.value;
          }
        });
      });
      aDiv.querySelector('[data-a-delete]')?.addEventListener('click', async () => {
        const confirmed = await uiConfirmAction({
          title: 'Удалить вариант ответа?',
          description: 'Вариант ответа будет удалён из вопроса.',
          confirmLabel: 'Удалить',
        });
        if (!confirmed) return;
        captureTestBuilderForm(el);
        s.questions[qi].answers.splice(ai, 1);
        renderTestBuilderScreen();
      });
    });
  });
}

function renderAssignTargetsBlock(el) {
  const s = _testBuilderState;
  const box = el.querySelector('#tb-assign-targets');
  if (s.assignTargetType === 'all') { box.innerHTML = ''; return; }
  if (s.assignTargetType === 'group') {
    box.innerHTML = `<div class="form-group"><label class="form-label">Группы</label>
      <div class="test-target-checklist">${(STATE.groups||[]).map(g => `<label class="test-target-option"><input type="checkbox" value="${g.id}" ${s.assignTargetIds.includes(g.id)?'checked':''}><i></i><span>${esc(g.name)}</span></label>`).join('')}</div></div>`;
  } else {
    box.innerHTML = `<div class="form-group"><label class="form-label">Операторы</label>
      <input class="form-input" id="tb-operator-search" placeholder="Поиск по ФИО">
      <div class="test-target-checklist" id="tb-operator-checklist">${(STATE.adminOperators||[]).map(o => `<label class="test-target-option" data-op-name="${esc(o.full_name).toLowerCase()}"><input type="checkbox" value="${o.id}" ${s.assignTargetIds.includes(o.id)?'checked':''}><i></i><span>${esc(o.full_name)}</span></label>`).join('')}</div></div>`;
    box.querySelector('#tb-operator-search')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      box.querySelectorAll('[data-op-name]').forEach(label => { label.style.display = label.dataset.opName.includes(q) ? '' : 'none'; });
    });
  }
  box.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = Number(cb.value);
      if (cb.checked) { if (!s.assignTargetIds.includes(id)) s.assignTargetIds.push(id); }
      else { s.assignTargetIds = s.assignTargetIds.filter(x => x !== id); }
    });
  });
}

/**
 * <input type="datetime-local"> отдаёт значение БЕЗ таймзоны
 * ("2026-06-30T22:10") — браузер показывает его как локальное время
 * пользователя, но если отправить эту строку на backend как есть,
 * сервер (работающий в UTC через datetime.utcnow()) интерпретирует её
 * как 22:10 UTC, а не 22:10 по Алматы/Астане (UTC+5). Из-за этого тест
 * с "открытием сейчас" уходил в статус "Запланирован" на 5 часов дольше
 * реального — оператор не видел тест, хотя по местному времени он уже
 * должен был открыться.
 *
 * Конвертируем явно: new Date(localString) — браузер сам интерпретирует
 * строку без таймзоны как ЛОКАЛЬНОЕ время, затем .toISOString() даёт
 * корректный UTC-момент, который сервер поймёт правильно.
 */
function localDateTimeInputToUTCISOString(value) {
  if (!value) return null;
  const localDate = new Date(value); // браузер трактует как локальное время
  return localDate.toISOString();    // конвертирует в UTC автоматически
}

/** Обратная операция — для заполнения <input type="datetime-local"> при редактировании существующего теста */
function utcISOStringToLocalDateTimeInput(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function saveTestBuilder(publish) {
  const s = _testBuilderState;
  const el = document.getElementById('view-tests');

  const payload = s.status === 'open' ? {
    closes_at: localDateTimeInputToUTCISOString(el.querySelector('#tb-closes-at').value),
  } : {
    title: el.querySelector('#tb-title').value,
    description: el.querySelector('#tb-description').value,
    instruction: el.querySelector('#tb-instruction').value,
    time_limit_minutes: Number(el.querySelector('#tb-time-limit').value),
    opens_at: localDateTimeInputToUTCISOString(el.querySelector('#tb-opens-at').value),
    closes_at: localDateTimeInputToUTCISOString(el.querySelector('#tb-closes-at').value),
    passing_percent: Number(el.querySelector('#tb-passing-percent').value),
    show_result_after_finish: el.querySelector('#tb-show-result').checked,
    show_correct_answers: el.querySelector('#tb-show-correct').checked,
    allow_retake: el.querySelector('#tb-allow-retake').checked,
    max_attempts: Number(el.querySelector('#tb-max-attempts').value),
    reward_type: el.querySelector('#tb-reward-type').value,
    reward_points: Number(el.querySelector('#tb-reward-points').value),
    reward_coins: Number(el.querySelector('#tb-reward-coins').value),
    reward_min_percent: Number(el.querySelector('#tb-reward-min-percent').value),
    reward_mode: el.querySelector('#tb-reward-mode').value,
  };

  if (s.status !== 'open' && !payload.title.trim()) { showToast('Укажите название теста', 'error'); return; }
  if (s.status !== 'open') {
    if (publish && !s.questions.length) { showToast('Добавьте хотя бы один вопрос', 'error'); return; }
    if (publish && s.assignTargetType !== 'all' && !s.assignTargetIds.length) { showToast('Выберите аудиторию теста', 'error'); return; }
    for (const question of s.questions) {
      if (!question.question_text.trim()) { showToast('Заполните текст каждого вопроса', 'error'); return; }
      if (question.answers.some(answer => !answer.answer_text.trim())) { showToast(`Заполните все варианты ответа в вопросе «${question.question_text}»`, 'error'); return; }
      const correctCount = question.answers.filter(answer => answer.is_correct).length;
      if (!correctCount) { showToast(`У вопроса «${question.question_text}» не указан правильный ответ`, 'error'); return; }
      if (question.question_type === 'single_choice' && correctCount !== 1) { showToast(`В вопросе «${question.question_text}» должен быть один правильный ответ`, 'error'); return; }
    }
  }

  try {
    let testId = s.testId;
    if (testId) {
      await api.updateTest(testId, payload);
    } else {
      const created = await api.createTest(payload);
      testId = created.id;
      s.testId = testId;
    }

    for (const questionId of (s.status === 'open' ? [] : s.deletedQuestionIds)) {
      await api.deleteTestQuestion(questionId);
    }
    s.deletedQuestionIds = [];

    for (const [questionIndex, q] of (s.status === 'open' ? [] : s.questions).entries()) {
      const qPayload = { question_text: q.question_text, question_type: q.question_type, points: q.points, sort_order: questionIndex, answers: q.answers.map((answer, answerIndex) => ({ ...answer, sort_order: answerIndex })) };
      if (q.id) await api.updateTestQuestion(q.id, qPayload);
      else { const created = await api.addTestQuestion(testId, qPayload); q.id = created.id; }
    }

    await api.assignTest(testId, { target_type: s.assignTargetType, target_ids: s.assignTargetIds });

    if (publish && s.status !== 'open') {
      await api.publishTest(testId);
      showToast('Тест сохранён и опубликован', 'ok');
    } else {
      showToast('Тест сохранён', 'ok');
    }
    swrInvalidate('tests:'); // создание/редактирование/назначение — список тестов и видимость операторам могли измениться
    renderTests();
  } catch(e) {
    showToast(e.message || 'Не удалось сохранить тест', 'error');
  }
}

/* ── Результаты и аналитика для руководства ─────────────────────── */
