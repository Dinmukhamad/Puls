let _missionAttempt = null;
let _missionDirty = false;
let _missionActionBusy = false;

function missionCoinLabel(value) {
  const n = Math.abs(Number(value) || 0);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} коин`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} коина`;
  return `${n} коинов`;
}

function missionStatusLabel(status) {
  return ({
    available: 'Доступна',
    in_progress: 'В процессе',
    completed: 'Завершена',
    locked: 'Недоступна',
  })[status] || status;
}

function missionLoading(el, text = 'Загружаем миссии') {
  el.innerHTML = `<div class="missions-loading" role="status"><div class="loading-spinner"></div><strong>${esc(text)}</strong></div>`;
}

async function renderMissions() {
  const el = document.getElementById('view-missions');
  if (!el) return;
  missionLoading(el);
  if (isAdmin(STATE.user?.role || 'operator')) {
    await renderMissionsAdmin(el);
    return;
  }

  const rememberedAttempt = Number(sessionStorage.getItem('puls-mission-attempt') || 0);
  if (rememberedAttempt) {
    try {
      _missionAttempt = await api.getMissionAttempt(rememberedAttempt);
      renderMissionAttempt(el, _missionAttempt);
      return;
    } catch (error) {
      sessionStorage.removeItem('puls-mission-attempt');
      if (error?.status !== 404 && error?.status !== 409) {
        renderMissionError(el, error);
        return;
      }
    }
  }

  try {
    if (_missionWorldCode) {
      const world = await api.getMissionWorld(_missionWorldCode);
      renderLearningWorldRoute(el, world);
    } else {
      const data = await api.getMissionWorlds();
      renderLearningWorldMap(el, data);
    }
  } catch (error) {
    renderMissionError(el, error);
  }
}

function renderMissionError(el, error) {
  el.innerHTML = `<section class="missions-error panel">
    <span class="missions-error-icon" aria-hidden="true">!</span>
    <h2>Не удалось открыть миссии</h2>
    <p>${esc(error?.message || 'Попробуйте загрузить раздел ещё раз.')}</p>
    <button class="btn-primary" type="button" onclick="renderMissions()">Повторить</button>
  </section>`;
}

function renderMissionMap(el, data) {
  const missions = data.missions || [];
  el.innerHTML = `<div class="missions-page">
    <header class="missions-header">
      <div><span class="missions-eyebrow">Практика</span><h1>Миссии</h1>
        <p>Практикуй консультации в безопасном учебном режиме</p></div>
    </header>
    <section class="missions-progress-card" aria-label="Общий прогресс миссий">
      <div class="missions-progress-copy"><span>Общий прогресс</span><strong>${data.completed} из ${data.total}</strong><p>миссий завершено</p></div>
      <div class="missions-progress-ring" style="--mission-progress:${Math.max(0, Math.min(100, data.percent || 0)) * 3.6}deg"><b>${data.percent || 0}%</b></div>
      <div class="missions-earned"><span class="missions-coin">P</span><div><strong>${missionCoinLabel(data.earned_coins)}</strong><span>заработано за миссии</span></div></div>
    </section>
    <div class="missions-map-layout">
      <section class="missions-route panel" aria-labelledby="mission-route-title">
        <div class="missions-section-head"><div><span>Учебный маршрут</span><h2 id="mission-route-title">Твой путь практики</h2></div><b>${data.completed}/${data.total}</b></div>
        <div class="missions-route-list">
          ${missions.length ? missions.map(missionRouteCard).join('<div class="missions-route-line" aria-hidden="true"></div>') : '<div class="missions-empty">Активных миссий пока нет</div>'}
          <div class="missions-route-line" aria-hidden="true"></div>
          <article class="mission-card mission-card-soon" aria-disabled="true">
            <div class="mission-number"><span>${String(missions.length + 1).padStart(2, '0')}</span></div>
            <div class="mission-card-main"><span class="mission-type">Скоро</span><h3>Продолжение маршрута</h3><p>Следующая практическая ситуация уже готовится.</p></div>
            <button class="btn-outline" type="button" disabled>Недоступно</button>
          </article>
        </div>
      </section>
      <aside class="missions-info-card panel">
        <div class="missions-info-visual" aria-hidden="true">${pulsarSvg('idle')}</div>
        <span class="missions-eyebrow">Безопасная практика</span>
        <h2>Учись через действия</h2>
        <p>Внутри миссии ты увидишь учебный телефон. Никакие данные не отправляются во внешние сервисы.</p>
        <ul>
          <li><span>1</span> Следуй подсказкам Пульсара</li>
          <li><span>2</span> Выполняй действия по порядку</li>
          <li><span>3</span> Получай награду за первое прохождение</li>
        </ul>
      </aside>
    </div>
  </div>`;
}

function missionRouteCard(mission) {
  const disabled = mission.status === 'locked';
  return `<article class="mission-card is-${esc(mission.status)}">
    <div class="mission-number"><span>${String(mission.sort_order || 1).padStart(2, '0')}</span><i aria-hidden="true"></i></div>
    <div class="mission-card-main">
      <div class="mission-card-tags"><span class="mission-type">Обучение</span><span class="mission-status">${esc(missionStatusLabel(mission.status))}</span></div>
      <h3>${esc(mission.title)}</h3><p>${esc(mission.description)}</p>
      <div class="mission-meta"><span>◷ ${mission.estimated_minutes || 5} минут</span><span class="mission-reward">P ${missionCoinLabel(mission.reward_coins)}</span></div>
    </div>
    <button class="btn-primary mission-start-btn" type="button" ${disabled ? 'disabled' : ''} onclick="startMissionFromMap('${esc(mission.code)}')">${esc(mission.action_label)}</button>
  </article>`;
}

async function startMissionFromMap(code) {
  const button = document.querySelector(`.mission-card button[onclick*="${code}"]`);
  if (button) button.disabled = true;
  try {
    _missionAttempt = await api.startMission(code);
    sessionStorage.setItem('puls-mission-attempt', String(_missionAttempt.id));
    _missionDirty = false;
    renderMissionAttempt(document.getElementById('view-missions'), _missionAttempt);
  } catch (error) {
    showToast(error.message, 'error');
    if (button) button.disabled = false;
  }
}

function pulsarSvg(state = 'idle') {
  return `<svg class="pulsar-character is-${esc(state)}" viewBox="0 0 220 220" role="img" aria-label="Пульсар — помощник Pulse">
    <defs><linearGradient id="pulsarBody" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4F46E5"/><stop offset="1" stop-color="#7C3AED"/></linearGradient><filter id="pulsarGlow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <g class="pulsar-shadow"><ellipse cx="110" cy="193" rx="52" ry="11" fill="rgba(79,70,229,.14)"/></g>
    <g class="body"><rect x="55" y="72" width="110" height="104" rx="43" fill="url(#pulsarBody)"/><rect x="72" y="91" width="76" height="58" rx="25" fill="#111B2E" opacity=".96"/></g>
    <g class="head"><path d="M77 72c3-25 16-39 33-39s30 14 33 39" fill="url(#pulsarBody)"/><path d="M110 34V20" stroke="#24C7E8" stroke-width="5" stroke-linecap="round"/><circle cx="110" cy="17" r="6" fill="#24C7E8" filter="url(#pulsarGlow)"/></g>
    <g class="eyes" fill="#70E5FA" filter="url(#pulsarGlow)"><rect x="88" y="111" width="13" height="7" rx="4"/><rect x="119" y="111" width="13" height="7" rx="4"/></g>
    <g class="arms" fill="none" stroke="#6659F4" stroke-width="14" stroke-linecap="round"><path d="M57 111 34 132"/><path d="M163 111 186 92"/></g>
    <g class="pulse-mark" fill="none" stroke="#24C7E8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" filter="url(#pulsarGlow)"><path d="M81 158h14l6-13 10 25 8-18 5 6h15"/></g>
  </svg>`;
}

function renderMissionAttempt(el, attempt, feedback = '') {
  if (!el) return;
  _missionAttempt = attempt;
  const step = attempt.current_step;
  const displayStep = Math.min(step.step_order + 1, step.total_steps);
  const isComplete = attempt.status === 'completed';
  el.innerHTML = `<div class="mission-player">
    <header class="mission-player-top">
      <button class="mission-back-btn" type="button" onclick="backToMissionMap()" aria-label="Назад к карте миссий">← <span>К карте</span></button>
      <div class="mission-player-title"><span>Миссия ${attempt.mission_code === 'photo_control_basics' ? 2 : 1}</span><strong>${esc(attempt.mission_title)}</strong></div>
      <div class="mission-step-progress" aria-label="Прогресс: ${attempt.progress_percent}%"><div><i style="width:${attempt.progress_percent}%"></i></div><span>${displayStep} из ${step.total_steps}</span></div>
      <button class="btn-outline mission-restart-btn" type="button" onclick="restartCurrentMission()" ${isComplete ? 'hidden' : ''}>Начать заново</button>
    </header>
    <main class="mission-scene">
      <section class="pulsar-panel">
        <div class="pulsar-stage">${pulsarSvg(isComplete ? 'success' : (feedback ? 'speak' : 'idle'))}</div>
        <div class="pulsar-speech" aria-live="polite"><span>Пульсар</span><p id="pulsar-message">${esc(feedback || step.content.message || '')}</p></div>
      </section>
      <section class="mission-phone-column">
        ${renderMissionPhone(attempt)}
      </section>
      <aside class="mission-goal-panel">
        <span class="missions-eyebrow">Текущая цель</span><h2>${esc(step.content.goal || 'Выполни действие на телефоне')}</h2>
        <div class="mission-goal-progress"><span>Шаг ${displayStep}</span><b>${attempt.progress_percent}%</b></div>
        <div class="mission-reward-box"><span class="missions-coin">P</span><div><b>${missionCoinLabel(attempt.reward_coins)}</b><span>${attempt.reward_eligible ? 'награда за первое прохождение' : 'награда уже получена'}</span></div></div>
      </aside>
    </main>
    <footer class="mission-player-bottom">
      <button class="btn-outline" type="button" onclick="showMissionHint()" ${isComplete || !step.hint_available ? 'disabled' : ''}>Подсказка</button>
      <span class="mission-autosave" id="mission-autosave"><i></i>${esc(attempt.autosave_state || 'Сохранено')}</span>
      <span class="mission-errors">Ошибки: ${attempt.errors_count} · Подсказки: ${attempt.hints_used}</span>
    </footer>
  </div>`;
  requestAnimationFrame(() => el.querySelector('.mission-phone button:not([disabled]), .mission-phone input')?.focus());
  scheduleSaparProcessing(attempt);
}

function renderMissionPhone(attempt) {
  const step = attempt.current_step;
  return `<div class="mission-phone" data-screen="${esc(step.screen_key)}">
    <div class="mission-phone-speaker" aria-hidden="true"></div>
    <div class="mission-phone-status" aria-hidden="true"><span>16:18</span><span>● LTE ▰</span></div>
    <div class="mission-phone-screen">${renderMissionPhoneScreen(attempt)}</div>
    <div class="mission-phone-home" aria-hidden="true"></div>
  </div>`;
}

function renderMissionPhoneScreen(attempt) {
  const step = attempt.current_step;
  if (attempt.status === 'completed') {
    return `<div class="phone-complete"><div class="phone-complete-pulse">✓</div><span>Миссия завершена</span><h2>Отличная работа!</h2><p>${esc(attempt.reward_message || 'Результат сохранён')}</p><button type="button" onclick="backToMissionMap(true)">Вернуться к карте</button></div>`;
  }
  if (attempt.mission_code === 'smz_sapar_provider_transfer') return renderSaparMissionScreen(attempt);
  if (attempt.mission_code === 'photo_control_basics') return renderPhotoControlScreen(attempt);
  if (step.screen_key === 'intro') {
    return `<div class="phone-intro"><span class="phone-pulse-logo">Puls.</span><div class="phone-intro-wave" aria-hidden="true">⌁</div><h2>Безопасный учебный режим</h2><p>Здесь можно ошибаться: мы не отправляем данные в реальные сервисы.</p><button type="button" onclick="missionAction('begin')">Начать обучение</button></div>`;
  }
  if (step.screen_key === 'login_choice') {
    return `<div class="phone-login-choice"><h2>Вход по профилю</h2><p>Чтобы приступить к заказам, войдите по профилю. Если не получается, попробуйте как раньше — по номеру телефона.</p><div class="phone-choice-actions"><button class="phone-secondary mission-target" type="button" onclick="missionAction('choose_phone_login')">Войти по телефону</button><button class="phone-yandex" type="button" onclick="missionAction('choose_profile_login')">Войти по профилю</button></div></div>`;
  }
  if (step.screen_key === 'phone_input') {
    return `<div class="phone-yid"><button class="phone-back-arrow" type="button" aria-label="Назад">←</button><strong class="phone-yid-logo">Яндекс <i>ID</i></strong><h2>Введите номер телефона</h2><p>Нужен для входа в аккаунт</p><label for="mission-phone-input">Учебный номер</label><input id="mission-phone-input" inputmode="tel" autocomplete="off" placeholder="+7 (000) 000-00-00" aria-describedby="mission-phone-help" oninput="formatMissionPhone(this)"><small id="mission-phone-help">Используй только вымышленный номер</small><button id="mission-phone-submit" type="button" disabled onclick="submitMissionPhone()">Продолжить</button><div class="phone-yid-foot">Яндекс ID — ключ от всех сервисов<br><b>Узнать больше</b></div></div>`;
  }
  if (step.screen_key === 'code_input') {
    return `<div class="phone-code"><button class="phone-back-arrow" type="button" aria-label="Назад">←</button><div class="phone-code-logo">Я</div><h2>Введите код</h2><p>Учебный код показан в сообщении Пульсара</p><label id="mission-code-label">Шестизначный учебный код</label><div class="phone-code-inputs" role="group" aria-labelledby="mission-code-label" onpaste="pasteMissionCode(event)">${[0,1,2,3,4,5].map(i => `<input data-code-index="${i}" maxlength="1" inputmode="numeric" aria-label="Цифра ${i + 1}" oninput="inputMissionCode(event)" onkeydown="keyMissionCode(event)">`).join('')}</div><button id="mission-code-submit" type="button" disabled onclick="submitMissionCode()">Далее</button><button class="phone-resend" type="button" onclick="showMissionHint()">Показать подсказку ещё раз</button><div class="phone-keypad" aria-label="Цифровая клавиатура">${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(key => key === '' ? '<i></i>' : `<button type="button" onclick="tapMissionCodeDigit('${key}')" aria-label="${key === '⌫' ? 'Удалить цифру' : `Цифра ${key}`}">${key}</button>`).join('')}</div></div>`;
  }
  if (step.screen_key === 'driver_profile') return renderMissionProfile(attempt);
  return `<div class="phone-complete"><div class="phone-complete-pulse">P</div><span>Все шаги пройдены</span><h2>Вход выполнен</h2><p>Подтверди завершение и сохрани результат миссии.</p><button type="button" onclick="missionAction('complete')">Завершить миссию</button></div>`;
}

function missionProfileTarget(attempt, target, body) {
  const step = attempt.current_step;
  const done = (step.completed_targets || []).includes(target);
  const current = step.required_target === target;
  return `<button type="button" class="profile-check ${current ? 'is-current' : ''} ${done ? 'is-done' : ''}" onclick="missionAction('inspect_profile',{target:'${target}'})" aria-label="Проверить ${target}">${body}${done ? '<i>✓</i>' : ''}</button>`;
}

function renderMissionProfile(attempt) {
  const profile = attempt.current_step.content.profile || {};
  return `<div class="phone-profile">
    <div class="profile-alert">Пришлите фото документов на машину <b>›</b></div>
    <div class="profile-identity"><div class="profile-avatar">${esc((profile.full_name || 'У')[0])}</div><div>${missionProfileTarget(attempt, 'name', `<strong>${esc(profile.full_name)}</strong>`) }${missionProfileTarget(attempt, 'status', `<span>${esc(profile.role)}<small>${esc(profile.tax_status)}</small></span>`)}${missionProfileTarget(attempt, 'park', `<small>Таксопарк · ${esc(profile.fleet)}</small>`)}</div><button type="button">Мои сервисы</button></div>
    <div class="profile-cards">${missionProfileTarget(attempt, 'rating', `<b>${esc(profile.rating)}</b><span>Рейтинг</span><em>★</em>`)}<div><b>${esc(profile.level)}</b><span>Уровень</span></div><div><b>${esc(profile.achievements)}</b><span>Достижения</span></div></div>
    <div class="profile-list"><div><span>Режим дохода</span><b>${esc(profile.income_mode)} ›</b></div><div><span>Тарифы</span><b>${esc(profile.tariffs)} ›</b></div><div><span>Оплата</span><b>›</b></div><div><span>Опции для тарифов</span><b>›</b></div></div>
    <div class="profile-bottom"><span>Карта</span><span>Деньги</span><span>Сообщения</span><b>Профиль</b></div>
  </div>`;
}

function setMissionAutosave(text, state = '') {
  const el = document.getElementById('mission-autosave');
  if (!el) return;
  el.className = `mission-autosave ${state}`;
  el.innerHTML = `<i></i>${esc(text)}`;
}

async function missionAction(actionKey, payload = {}) {
  if (!_missionAttempt || _missionActionBusy) return;
  _missionActionBusy = true;
  setMissionAutosave('Сохраняем…', 'is-saving');
  try {
    const result = await api.submitMissionAction(_missionAttempt.id, actionKey, payload);
    _missionAttempt = result.attempt;
    _missionDirty = false;
    if (_missionAttempt.status === 'completed') sessionStorage.setItem('puls-mission-attempt', String(_missionAttempt.id));
    renderMissionAttempt(
      document.getElementById('view-missions'),
      _missionAttempt,
      result.accepted ? '' : result.feedback,
    );
    if (!result.accepted) showToast(result.feedback, 'error');
  } catch (error) {
    setMissionAutosave('Не сохранено — повтори', 'is-error');
    showToast(error.message || 'Действие не сохранено', 'error');
  } finally {
    _missionActionBusy = false;
  }
}

function formatMissionPhone(input) {
  let digits = input.value.replace(/\D/g, '');
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith('7')) digits = `7${digits}`;
  digits = digits.slice(0, 11);
  const tail = digits.slice(1);
  let value = '+7';
  if (tail.length) value += ` (${tail.slice(0, 3)}`;
  if (tail.length >= 3) value += ')';
  if (tail.length > 3) value += ` ${tail.slice(3, 6)}`;
  if (tail.length > 6) value += `-${tail.slice(6, 8)}`;
  if (tail.length > 8) value += `-${tail.slice(8, 10)}`;
  input.value = value;
  input.dataset.digits = digits;
  _missionDirty = digits.length > 1;
  const submit = document.getElementById('mission-phone-submit');
  if (submit) submit.disabled = digits.length !== 11;
}

function submitMissionPhone() {
  const input = document.getElementById('mission-phone-input');
  const digits = input?.dataset.digits || '';
  if (digits.length !== 11) return;
  missionAction('submit_phone', {
    phone_valid: true,
    masked_phone: `+7 (***) ***-**-${digits.slice(-2)}`,
  });
}

function missionCodeInputs() {
  return Array.from(document.querySelectorAll('.phone-code-inputs input'));
}

function updateMissionCodeButton() {
  const code = missionCodeInputs().map(input => input.value).join('');
  const button = document.getElementById('mission-code-submit');
  if (button) button.disabled = code.length !== 6;
  _missionDirty = code.length > 0;
}

function inputMissionCode(event) {
  const input = event.currentTarget;
  input.value = input.value.replace(/\D/g, '').slice(-1);
  if (input.value) missionCodeInputs()[Number(input.dataset.codeIndex) + 1]?.focus();
  updateMissionCodeButton();
}

function keyMissionCode(event) {
  const input = event.currentTarget;
  if (event.key === 'Backspace' && !input.value) {
    missionCodeInputs()[Number(input.dataset.codeIndex) - 1]?.focus();
  }
}

function pasteMissionCode(event) {
  const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
  if (!digits) return;
  event.preventDefault();
  missionCodeInputs().forEach((input, index) => { input.value = digits[index] || ''; });
  missionCodeInputs()[Math.min(digits.length, 6) - 1]?.focus();
  updateMissionCodeButton();
}

function tapMissionCodeDigit(value) {
  const inputs = missionCodeInputs();
  if (value === '⌫') {
    const index = inputs.map(input => Boolean(input.value)).lastIndexOf(true);
    if (inputs[index]) inputs[index].value = '';
    inputs[Math.max(0, index)]?.focus();
  } else {
    const target = inputs.find(input => !input.value);
    if (target) {
      target.value = value;
      inputs[Number(target.dataset.codeIndex) + 1]?.focus();
    }
  }
  updateMissionCodeButton();
}

function submitMissionCode() {
  const code = missionCodeInputs().map(input => input.value).join('');
  if (code.length === 6) missionAction('submit_code', { code });
}

async function showMissionHint() {
  if (!_missionAttempt || _missionActionBusy) return;
  try {
    const data = await api.requestMissionHint(_missionAttempt.id);
    _missionAttempt = data.attempt;
    const speech = document.getElementById('pulsar-message');
    if (speech) speech.textContent = data.hint;
    const counter = document.querySelector('.mission-errors');
    if (counter) counter.textContent = `Ошибки: ${_missionAttempt.errors_count} · Подсказки: ${_missionAttempt.hints_used}`;
    showToast(data.hint, 'ok');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function restartCurrentMission() {
  if (!_missionAttempt || !confirm('Начать миссию заново? Текущая попытка будет закрыта, а подтверждённые данные останутся в истории.')) return;
  try {
    missionLoading(document.getElementById('view-missions'), 'Перезапускаем миссию');
    _missionAttempt = await api.restartMission(_missionAttempt.id);
    sessionStorage.setItem('puls-mission-attempt', String(_missionAttempt.id));
    _missionDirty = false;
    renderMissionAttempt(document.getElementById('view-missions'), _missionAttempt);
  } catch (error) {
    showToast(error.message, 'error');
    renderMissionAttempt(document.getElementById('view-missions'), _missionAttempt);
  }
}

function backToMissionMap(force = false) {
  if (!force && _missionDirty && !confirm('Введённое, но ещё не подтверждённое действие не сохранится. Вернуться к карте?')) return;
  sessionStorage.removeItem('puls-mission-attempt');
  _missionAttempt = null;
  _missionDirty = false;
  renderMissions();
}

async function renderMissionsAdmin(el) {
  try {
    const [stats, attempts, worlds] = await Promise.all([
      api.getMissionStats(),
      api.listMissionAttempts({ limit: 100 }),
      api.getAdminMissionWorlds(),
    ]);
    const saparMission = worlds.flatMap(world => world.missions || []).find(mission => mission.code === 'smz_sapar_provider_transfer');
    let saparSetting = null;
    let windowPreview = null;
    if (saparMission) {
      const settings = await api.getMissionSettings(saparMission.id);
      saparSetting = settings.find(setting => setting.key === 'provider_transfer_window' && setting.is_active) || settings[0] || null;
      if (saparSetting) {
        const now = new Date();
        windowPreview = await api.previewProviderWindow(saparMission.id, { start_day: saparSetting.value.start_day, end_day: saparSetting.value.end_day, year: now.getFullYear(), month: now.getMonth() + 1 });
      }
    }
    const dropOff = Object.entries(stats.drop_off_by_step || {});
    el.innerHTML = `<div class="missions-page missions-admin">
      <header class="missions-header"><div><span class="missions-eyebrow">Обучение операторов</span><h1>Миссии</h1><p>Статистика прохождения интерактивных учебных сценариев</p></div><span class="mission-admin-badge">Только просмотр</span></header>
      ${missionAdminConfiguration(worlds, saparMission, saparSetting, windowPreview)}
      <section class="mission-admin-stats">
        <article><span>Начали</span><strong>${stats.started_operators}</strong><small>уникальных операторов</small></article>
        <article><span>Завершили</span><strong>${stats.completed_operators}</strong><small>${stats.conversion_percent}% конверсия</small></article>
        <article><span>Среднее время</span><strong>${Math.round(stats.average_duration_seconds / 60)} мин</strong><small>по завершённым попыткам</small></article>
        <article><span>Выдано</span><strong>${missionCoinLabel(stats.awarded_coins)}</strong><small>за все миссии</small></article>
      </section>
      <div class="mission-admin-grid">
        <section class="panel mission-admin-table"><div class="missions-section-head"><div><span>История</span><h2>Попытки операторов</h2></div><b>${attempts.total}</b></div>
          <div class="table-wrap"><table><thead><tr><th>Оператор</th><th>Миссия</th><th>Статус</th><th>Шаг</th><th>Попытка</th><th>Время</th></tr></thead><tbody>${(attempts.items || []).map(row => `<tr><td><strong>${esc(row.operator_name)}</strong></td><td>${esc(row.mission_title)}</td><td><span class="mission-table-status is-${esc(row.status)}">${esc(missionStatusLabel(row.status))}</span></td><td>${esc(row.current_step_key)}</td><td>№${row.attempt_number}</td><td>${row.duration_seconds == null ? '—' : `${Math.max(1, Math.round(row.duration_seconds / 60))} мин`}</td></tr>`).join('') || '<tr><td colspan="6" class="missions-empty">Попыток пока нет</td></tr>'}</tbody></table></div>
        </section>
        <aside class="panel mission-dropoff"><div class="missions-section-head"><div><span>Прогресс</span><h2>Точки остановки</h2></div></div>${dropOff.length ? dropOff.map(([step, count]) => `<div><span>${esc(step)}</span><b>${count}</b></div>`).join('') : '<p class="missions-empty">Незавершённых попыток нет</p>'}<div class="mission-repeat"><span>Повторные прохождения</span><strong>${stats.repeat_operators}</strong></div></aside>
      </div>
    </div>`;
  } catch (error) {
    renderMissionError(el, error);
  }
}

function missionAdminConfiguration(worlds, saparMission, setting, preview) {
  const canEdit = STATE.user?.role === 'admin';
  const rule = setting?.value || { start_day: 16, end_day: 1, operator_message: '' };
  const allowed = (preview?.days || []).filter(day => day.allowed).length;
  return `<section class="panel mission-admin-config"><div class="missions-section-head"><div><span>Структура обучения</span><h2>Территории и период SAPAR</h2></div><b>${worlds.length} территории</b></div>
    <div class="mission-admin-worlds">${worlds.map(world => `<article style="--world-accent:${esc(world.accent_color)}"><i>${learningWorldIllustration(world)}</i><div><b>${esc(world.title)}</b><small>${(world.missions || []).length} мисс. · ${esc(world.availability)}</small></div></article>`).join('')}</div>
    ${saparMission ? `<div class="mission-window-editor"><div><h3>Период смены провайдера</h3><p>Версия ${setting?.version || 1}. Активные попытки продолжают использовать сохранённую версию.</p></div><label>Начало<input id="mission-window-start" type="number" min="1" max="31" value="${rule.start_day}"></label><label>Окончание<input id="mission-window-end" type="number" min="1" max="31" value="${rule.end_day}"></label><label class="mission-window-message">Сообщение оператору<input id="mission-window-message" value="${esc(rule.operator_message || '')}" maxlength="1000"></label><button class="btn-primary" type="button" ${canEdit ? '' : 'disabled'} onclick="saveMissionProviderWindow(${saparMission.id})">${canEdit ? 'Опубликовать версию' : 'Только просмотр'}</button><div class="mission-window-preview"><b>${allowed}</b><span>разрешённых дней в текущем месяце</span></div></div>` : '<p class="missions-empty">Миссия SAPAR ещё не назначена территории.</p>'}
  </section>`;
}

async function saveMissionProviderWindow(missionId) {
  const start = Number(document.getElementById('mission-window-start')?.value);
  const end = Number(document.getElementById('mission-window-end')?.value);
  const message = document.getElementById('mission-window-message')?.value?.trim();
  if (!start || !end || !message) { showToast('Заполните период и сообщение оператору', 'error'); return; }
  try {
    await api.updateProviderWindow(missionId, { start_day: start, end_day: end, timezone: 'Asia/Almaty', operator_message: message, is_active: true });
    showToast('Новая версия периода опубликована', 'ok');
    renderMissions();
  } catch (error) {
    showToast(error.message, 'error');
  }
}
