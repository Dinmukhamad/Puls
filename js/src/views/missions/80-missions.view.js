let _missionAttempt = null;
let _missionDirty = false;
let _missionActionBusy = false;
const _missionPendingKeys = new Map();

const missionViewController = {
  timers: new Set(),
  signal: null,
  abortHandler: null,
  connect(signal) {
    if (this.signal && this.abortHandler) {
      this.signal.removeEventListener('abort', this.abortHandler);
    }
    this.signal = signal;
    this.abortHandler = () => this.dispose();
    signal?.addEventListener('abort', this.abortHandler, { once: true });
  },
  timeout(callback, delay) {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, delay);
    this.timers.add(id);
    return id;
  },
  dispose() {
    this.timers.forEach(id => window.clearTimeout(id));
    this.timers.clear();
    document.querySelectorAll('.mission-preview-backdrop').forEach(node => node.remove());
    if (typeof uiCancelPendingConfirm === 'function') uiCancelPendingConfirm();
    if (document.querySelector('.ui-confirm-dialog') && typeof closeModal === 'function') {
      closeModal();
    }
    _missionActionBusy = false;
  },
};

const MISSION_ERROR_MESSAGES = {
  AUTH_REQUIRED: 'Сессия завершена. Войдите снова.',
  MISSION_FORBIDDEN: 'Эта миссия недоступна для вашего профиля.',
  MISSION_NOT_FOUND: 'Миссия больше недоступна. Вернитесь к карте.',
  MISSION_LOCKED: 'Сначала завершите предыдущий урок.',
  MISSION_REPLAY_DISABLED: 'Повторное прохождение временно недоступно.',
  STALE_STEP: 'Шаг уже изменился. Мы обновили миссию.',
  REWARD_ALREADY_GRANTED: 'Награда за эту версию уже получена.',
  INVALID_ACTION: 'Проверьте действие и попробуйте ещё раз.',
  MISSION_TEMPORARY_ERROR: 'Не удалось сохранить действие. Повторите попытку.',
};

function missionUserMessage(error) {
  if (error?.code && MISSION_ERROR_MESSAGES[error.code]) {
    return MISSION_ERROR_MESSAGES[error.code];
  }
  if (error?.status === 401) return MISSION_ERROR_MESSAGES.AUTH_REQUIRED;
  if (error?.status === 403) return MISSION_ERROR_MESSAGES.MISSION_FORBIDDEN;
  if (error?.status === 404) return MISSION_ERROR_MESSAGES.MISSION_NOT_FOUND;
  if (error?.status === 422) return MISSION_ERROR_MESSAGES.INVALID_ACTION;
  return MISSION_ERROR_MESSAGES.MISSION_TEMPORARY_ERROR;
}

function missionLogicalKey(kind, identity) {
  const logical = `${kind}:${identity}`;
  if (!_missionPendingKeys.has(logical)) {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    _missionPendingKeys.set(logical, `${kind}-${random}`);
  }
  return { logical, key: _missionPendingKeys.get(logical) };
}

function finishMissionLogicalKey(logical, error = null) {
  if (!error || (error.status && error.status < 500)) {
    _missionPendingKeys.delete(logical);
  }
}

function setMissionBusy(busy) {
  _missionActionBusy = busy;
  const player = document.querySelector('.mission-player');
  player?.setAttribute('aria-busy', String(busy));
  player?.querySelectorAll('button').forEach(button => {
    if (busy) {
      button.dataset.missionWasDisabled = String(button.disabled);
      button.disabled = true;
    } else if (button.dataset.missionWasDisabled === 'false') {
      button.disabled = false;
      delete button.dataset.missionWasDisabled;
    }
  });
}

function missionCoinLabel(value) {
  return uiCoin(value, { symbol: true });
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

function resetMissionNavigation() {
  _missionAttempt = null;
  _missionWorldCode = '';
  sessionStorage.removeItem('puls-mission-attempt');
  sessionStorage.removeItem('puls-mission-world');
}

const MISSION_MAP_CACHE_KEY = 'puls-mission-worlds-cache';

function invalidateMissionMapCache() {
  sessionStorage.removeItem(MISSION_MAP_CACHE_KEY);
}

async function loadMissionMap(el) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(MISSION_MAP_CACHE_KEY) || 'null');
    if (cached?.savedAt && Date.now() - cached.savedAt < 15000 && cached.data) {
      renderLearningWorldMap(el, cached.data);
      return;
    }
  } catch (_) {
    sessionStorage.removeItem(MISSION_MAP_CACHE_KEY);
  }
  try {
    const data = await api.getMissionWorlds();
    if ((data.worlds || []).length) {
      sessionStorage.setItem(
        MISSION_MAP_CACHE_KEY,
        JSON.stringify({ savedAt: Date.now(), data }),
      );
      renderLearningWorldMap(el, data);
      return;
    }
  } catch (worldError) {
    try {
      const legacyMap = await api.getMissions();
      renderMissionMap(el, legacyMap);
      return;
    } catch (_) {
      throw worldError;
    }
  }

  const legacyMap = await api.getMissions();
  renderMissionMap(el, legacyMap);
}

async function renderMissions() {
  const el = document.getElementById('view-missions');
  if (!el) return;
  missionViewController.dispose();
  missionViewController.connect(
    typeof currentViewSignal === 'function' ? currentViewSignal() : null,
  );
  missionLoading(el);
  if (isAdmin(STATE.user?.role || 'operator')) {
    await renderMissionsAdmin(el);
    return;
  }

  const rememberedAttempt = Number(sessionStorage.getItem('puls-mission-attempt') || 0);
  if (rememberedAttempt) {
    try {
      _missionAttempt = await api.getMissionAttempt(rememberedAttempt);
      if (_missionAttempt.status === 'in_progress') {
        renderMissionAttempt(el, _missionAttempt);
        return;
      }
      sessionStorage.removeItem('puls-mission-attempt');
      _missionAttempt = null;
    } catch (error) {
      sessionStorage.removeItem('puls-mission-attempt');
      if (![403, 404, 409].includes(error?.status)) {
        renderMissionError(el, error);
        return;
      }
    }
  }

  try {
    if (_missionWorldCode) {
      try {
        const world = await api.getMissionWorld(_missionWorldCode);
        renderLearningWorldRoute(el, world);
      } catch (error) {
        if (![403, 404, 409].includes(error?.status)) throw error;
        _missionWorldCode = '';
        sessionStorage.removeItem('puls-mission-world');
        await loadMissionMap(el);
      }
    } else {
      await loadMissionMap(el);
    }
  } catch (error) {
    renderMissionError(el, error);
  }
}

function renderMissionError(el, error) {
  el.innerHTML = `<section class="missions-error panel">
    <span class="missions-error-icon" aria-hidden="true">!</span>
    <h2>Не удалось открыть миссии</h2>
    <p role="alert" aria-live="assertive">${esc(missionUserMessage(error))}</p>
    <div class="missions-error-actions">
      <button class="btn-primary" type="button" onclick="renderMissions()">Повторить</button>
      <button class="btn-outline" type="button" onclick="resetMissionNavigation(); renderMissions()">Вернуться к карте</button>
    </div>
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
      <div class="missions-earned"><div><strong>${missionCoinLabel(data.earned_coins)}</strong><span>получено за миссии</span></div></div>
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
  const continuing = mission.status === 'in_progress' && mission.active_attempt_id;
  const replay = mission.status === 'completed';
  const disabled = mission.status === 'locked'
    || (!continuing && !mission.can_start && !mission.can_replay);
  const rewardLabel = mission.reward_state === 'claimed' || mission.reward_claimed
    ? `Получено: ${missionCoinLabel(mission.reward_coins)}`
    : mission.reward_state === 'not_available' || replay
      ? 'Награда не начисляется повторно'
      : `Награда: ${missionCoinLabel(mission.reward_coins)}`;
  const actionLabel = mission.action_label || (replay ? 'Пройти повторно' : 'Начать');
  const completionMeta = replay
    ? `<span>✓ Лучший балл: ${mission.best_score == null ? '—' : Math.round(mission.best_score)}</span>${mission.completed_at ? `<span>${esc(fmtDate(mission.completed_at))}</span>` : ''}`
    : '';
  return `<article class="mission-card is-${esc(mission.status)}">
    <div class="mission-number"><span>${String(mission.sort_order || 1).padStart(2, '0')}</span><i aria-hidden="true"></i></div>
    <div class="mission-card-main">
      <div class="mission-card-tags"><span class="mission-type">Обучение</span><span class="mission-status">${esc(missionStatusLabel(mission.status))}</span></div>
      <h3>${esc(mission.title)}</h3><p>${esc(mission.description)}</p>
      <div class="mission-meta"><span>◷ ${mission.estimated_minutes || 5} минут</span>${completionMeta}<span class="mission-reward">${rewardLabel}</span></div>
    </div>
    <button class="btn-primary mission-start-btn" type="button" ${disabled ? 'disabled' : ''} onclick="startMissionFromMap('${esc(mission.code)}','${replay ? 'replay' : 'start'}')">${esc(actionLabel)}</button>
  </article>`;
}

async function startMissionFromMap(code, mode = 'start') {
  if (_missionActionBusy) return;
  if (mode === 'replay') {
    const confirmed = await uiConfirmAction({
      title: 'Пройти миссию повторно?',
      description: 'Награда за первое прохождение уже получена. Повторное прохождение не начислит коины, но позволит улучшить лучший результат. Начать заново?',
      confirmLabel: 'Начать',
      danger: false,
    });
    if (!confirmed) return;
  }
  const button = document.querySelector(`.mission-card button[onclick*="${code}"]`);
  const pending = missionLogicalKey('mission-start', `${code}:${mode}`);
  setMissionBusy(true);
  if (button) button.setAttribute('aria-busy', 'true');
  try {
    _missionAttempt = await api.startMission(code, pending.key);
    _missionPendingKeys.delete(pending.logical);
    invalidateMissionMapCache();
    sessionStorage.setItem('puls-mission-attempt', String(_missionAttempt.id));
    _missionDirty = false;
    renderMissionAttempt(document.getElementById('view-missions'), _missionAttempt);
  } catch (error) {
    finishMissionLogicalKey(pending.logical, error);
    showToast(missionUserMessage(error), 'error');
  } finally {
    setMissionBusy(false);
    if (button) button.removeAttribute('aria-busy');
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
  const displayedReward = isComplete
    ? (attempt.reward_received || 0)
    : attempt.reward_coins;
  const rewardCaption = isComplete
    ? (attempt.reward_awarded ? 'награда получена' : 'награда была получена ранее')
    : (attempt.reward_eligible ? 'награда за первое прохождение' : 'награда уже получена');
  el.innerHTML = `<div class="mission-player">
    <header class="mission-player-top">
      <button class="mission-back-btn" type="button" onclick="backToMissionMap()" aria-label="Назад к карте миссий">← <span>К карте</span></button>
      <div class="mission-player-title"><span>Миссия ${attempt.display_number || 1}</span><strong>${esc(attempt.mission_title)}</strong></div>
      <div class="mission-step-progress" aria-label="Прогресс: ${attempt.progress_percent}%"><div><i style="width:${attempt.progress_percent}%"></i></div><span>${displayStep} из ${step.total_steps}</span></div>
      <button class="btn-outline mission-restart-btn" type="button" onclick="restartCurrentMission()">${isComplete ? 'Пройти ещё раз' : 'Начать заново'}</button>
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
        <div class="mission-reward-box"><div><b>${missionCoinLabel(displayedReward)}</b><span>${rewardCaption}</span></div></div>
      </aside>
    </main>
    <footer class="mission-player-bottom">
      <button class="btn-outline" type="button" onclick="showMissionHint()" ${isComplete || !step.hint_available ? 'disabled' : ''}>Подсказка</button>
      <span class="mission-autosave" id="mission-autosave"><i></i>${esc(attempt.autosave_state || 'Сохранено')}</span>
      <span class="mission-errors">Ошибки: ${attempt.errors_count} · Подсказки: ${attempt.hints_used}</span>
    </footer>
  </div>`;
  requestAnimationFrame(() => {
    const target = el.querySelector(
      '.mission-phone [data-autofocus], .mission-phone .is-target:not([disabled]), .mission-phone button:not([disabled]):not(.phone-back-arrow), .mission-phone input:not([disabled])',
    );
    if (target) {
      target.dataset.autofocus = '';
      target.focus();
    }
  });
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
    const currentScore = attempt.score == null ? '—' : Math.round(attempt.score);
    const bestScore = attempt.best_score == null ? currentScore : Math.round(attempt.best_score);
    return `<div class="phone-complete"><div class="phone-complete-pulse">✓</div><span>Миссия завершена</span><h2>Отличная работа!</h2>
      ${attempt.is_new_best ? '<strong class="mission-new-best">Новый лучший результат</strong>' : ''}
      <div class="mission-result-scores"><span>Текущий балл <b>${currentScore}</b></span><span>Лучший балл <b>${bestScore}</b></span></div>
      <p>${esc(attempt.reward_message || 'Результат сохранён')}</p>
      <div class="mission-result-actions"><button type="button" onclick="restartCurrentMission()">Пройти ещё раз</button><button type="button" class="btn-outline" onclick="backToMissionMap(true)">Вернуться к карте</button></div>
    </div>`;
  }
  if (attempt.mission_code === 'smz_sign_previous_month_acts') return renderSmzDocumentSigningScreen(attempt);
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
  const pending = missionLogicalKey(
    'mission-action',
    `${_missionAttempt.id}:${actionKey}:${JSON.stringify(payload)}`,
  );
  setMissionBusy(true);
  setMissionAutosave('Сохраняем…', 'is-saving');
  try {
    const result = await api.submitMissionAction(
      _missionAttempt.id,
      actionKey,
      payload,
      pending.key,
    );
    _missionPendingKeys.delete(pending.logical);
    _missionAttempt = result.attempt;
    _missionDirty = false;
    if (_missionAttempt.status === 'completed') {
      invalidateMissionMapCache();
      sessionStorage.removeItem('puls-mission-attempt');
    } else {
      sessionStorage.setItem('puls-mission-attempt', String(_missionAttempt.id));
    }
    renderMissionAttempt(
      document.getElementById('view-missions'),
      _missionAttempt,
      result.accepted ? '' : result.feedback,
    );
    if (!result.accepted) showToast(result.feedback, 'error');
  } catch (error) {
    finishMissionLogicalKey(pending.logical, error);
    setMissionAutosave('Не сохранено — повтори', 'is-error');
    showToast(missionUserMessage(error), 'error');
  } finally {
    setMissionBusy(false);
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
  const pending = missionLogicalKey(
    'mission-hint',
    `${_missionAttempt.id}:${_missionAttempt.current_step.step_key}`,
  );
  setMissionBusy(true);
  try {
    const data = await api.requestMissionHint(_missionAttempt.id, pending.key);
    _missionPendingKeys.delete(pending.logical);
    _missionAttempt = data.attempt;
    const speech = document.getElementById('pulsar-message');
    if (speech) speech.textContent = data.hint;
    const counter = document.querySelector('.mission-errors');
    if (counter) counter.textContent = `Ошибки: ${_missionAttempt.errors_count} · Подсказки: ${_missionAttempt.hints_used}`;
    showToast(data.hint, 'ok');
  } catch (error) {
    finishMissionLogicalKey(pending.logical, error);
    showToast(missionUserMessage(error), 'error');
  } finally {
    setMissionBusy(false);
  }
}

async function restartCurrentMission() {
  if (!_missionAttempt || _missionActionBusy) return;
  const replay = _missionAttempt.status === 'completed';
  const confirmed = await uiConfirmAction({
    title: replay ? 'Пройти миссию повторно?' : 'Начать миссию заново?',
    description: replay
      ? 'Награда за первое прохождение уже получена. Повторное прохождение не начислит коины, но позволит улучшить лучший результат. Начать заново?'
      : 'Текущая попытка будет закрыта, а подтверждённые данные останутся в истории.',
    confirmLabel: 'Начать',
    danger: false,
  });
  if (!confirmed) return;
  const pending = missionLogicalKey(
    'mission-restart',
    `${_missionAttempt.id}:${replay ? 'replay' : 'restart'}`,
  );
  try {
    missionViewController.dispose();
    setMissionBusy(true);
    missionLoading(document.getElementById('view-missions'), 'Перезапускаем миссию');
    _missionAttempt = await api.restartMission(_missionAttempt.id, pending.key);
    invalidateMissionMapCache();
    _missionPendingKeys.delete(pending.logical);
    sessionStorage.setItem('puls-mission-attempt', String(_missionAttempt.id));
    _missionDirty = false;
    renderMissionAttempt(document.getElementById('view-missions'), _missionAttempt);
  } catch (error) {
    finishMissionLogicalKey(pending.logical, error);
    showToast(missionUserMessage(error), 'error');
    renderMissionAttempt(document.getElementById('view-missions'), _missionAttempt);
  } finally {
    setMissionBusy(false);
  }
}

async function backToMissionMap(force = false) {
  if (!force && _missionDirty) {
    const confirmed = await uiConfirmAction({
      title: 'Вернуться к карте?',
      description: 'Введённое, но ещё не подтверждённое действие не сохранится.',
      confirmLabel: 'Вернуться к карте',
      danger: false,
    });
    if (!confirmed) return;
  }
  sessionStorage.removeItem('puls-mission-attempt');
  _missionAttempt = null;
  _missionDirty = false;
  missionViewController.dispose();
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
    const signingMission = worlds.flatMap(world => world.missions || []).find(mission => mission.code === 'smz_sign_previous_month_acts');
    let saparSetting = null;
    let windowPreview = null;
    let signingSetting = null;
    let signingPreview = null;
    if (saparMission) {
      const settings = await api.getMissionSettings(saparMission.id);
      saparSetting = settings.find(setting => setting.key === 'provider_transfer_window' && setting.is_active) || settings[0] || null;
      if (saparSetting) {
        const now = new Date();
        windowPreview = await api.previewProviderWindow(saparMission.id, { start_day: saparSetting.value.start_day, end_day: saparSetting.value.end_day, year: now.getFullYear(), month: now.getMonth() + 1 });
      }
    }
    if (signingMission) {
      const settings = await api.getMissionSettings(signingMission.id);
      signingSetting = settings.find(setting => setting.key === 'document_signing_window' && setting.is_active) || settings[0] || null;
      if (signingSetting) {
        const now = new Date();
        const rule = signingSetting.value;
        const params = {year: now.getFullYear(), month: now.getMonth() + 1, start_day: rule.start_day, end_day: rule.end_day};
        if (rule.exception_end_day && rule.exception_year_month) Object.assign(params, {exception_end_day: rule.exception_end_day, exception_year_month: rule.exception_year_month});
        signingPreview = await api.previewDocumentSigningWindow(signingMission.id, params);
      }
    }
    const dropOff = Object.entries(stats.drop_off_by_step || {});
    el.innerHTML = `<div class="missions-page missions-admin">
      <header class="missions-header"><div><span class="missions-eyebrow">Обучение операторов</span><h1>Миссии</h1><p>Статистика прохождения интерактивных учебных сценариев</p></div><span class="mission-admin-badge">Только просмотр</span></header>
      ${missionAdminConfiguration(worlds, saparMission, saparSetting, windowPreview, signingMission, signingSetting, signingPreview)}
      <section class="mission-admin-stats">
        <article><span>Начали</span><strong>${stats.started_operators}</strong><small>уникальных операторов</small></article>
        <article><span>Завершили</span><strong>${stats.completed_operators}</strong><small>${stats.conversion_percent}% конверсия</small></article>
        <article><span>Среднее время</span><strong>${Math.round(stats.average_duration_seconds / 60)} мин</strong><small>по завершённым попыткам</small></article>
        <article><span>Выдано</span><strong>${missionCoinLabel(stats.awarded_coins)}</strong><small>за все миссии</small></article>
      </section>
      <div class="mission-admin-grid">
        <section class="panel mission-admin-table"><div class="missions-section-head"><div><span>История</span><h2>Попытки операторов</h2></div><b>${attempts.total}</b></div>
          <div class="table-wrap"><table><thead><tr><th>Оператор</th><th>Миссия</th><th>Статус</th><th>Шаг</th><th>Попытка</th><th>Активное время</th></tr></thead><tbody>${(attempts.items || []).map(row => `<tr><td><strong>${esc(row.operator_name)}</strong></td><td>${esc(row.mission_title)}</td><td><span class="mission-table-status is-${esc(row.status)}">${esc(missionStatusLabel(row.status))}</span></td><td>${esc(row.current_step_key)}</td><td>№${row.attempt_number}</td><td>${row.duration_anomalous ? 'Аномалия' : row.active_duration_seconds == null ? '—' : `${Math.max(1, Math.round(row.active_duration_seconds / 60))} мин`}</td></tr>`).join('') || '<tr><td colspan="6" class="missions-empty">Попыток пока нет</td></tr>'}</tbody></table></div>
        </section>
        <aside class="panel mission-dropoff"><div class="missions-section-head"><div><span>Прогресс</span><h2>Точки остановки</h2></div></div>${dropOff.length ? dropOff.map(([step, count]) => `<div><span>${esc(step)}</span><b>${count}</b></div>`).join('') : '<p class="missions-empty">Незавершённых попыток нет</p>'}<div class="mission-repeat"><span>Повторные прохождения</span><strong>${stats.repeat_operators}</strong></div></aside>
      </div>
    </div>`;
  } catch (error) {
    renderMissionError(el, error);
  }
}

function missionAdminConfiguration(worlds, saparMission, setting, preview, signingMission, signingSetting, signingPreview) {
  const canEdit = STATE.user?.role === 'admin';
  const rule = setting?.value || { start_day: 16, end_day: 1, operator_message: '' };
  const allowed = (preview?.days || []).filter(day => day.allowed).length;
  return `<section class="panel mission-admin-config"><div class="missions-section-head"><div><span>Структура обучения</span><h2>Территории и период SAPAR</h2></div><b>${worlds.length} территории</b></div>
    <div class="mission-admin-worlds">${worlds.map(world => `<article style="--world-accent:${esc(world.accent_color)}"><i>${learningWorldIllustration(world)}</i><div><b>${esc(world.title)}</b><small>${(world.missions || []).length} мисс. · ${esc(world.availability)}</small></div></article>`).join('')}</div>
    ${saparMission ? `<div class="mission-window-editor"><div><h3>Период смены провайдера</h3><p>Версия ${setting?.version || 1}. Активные попытки продолжают использовать сохранённую версию.</p></div><label>Начало<input id="mission-window-start" type="number" min="1" max="31" value="${rule.start_day}"></label><label>Окончание<input id="mission-window-end" type="number" min="1" max="31" value="${rule.end_day}"></label><label class="mission-window-message">Сообщение оператору<input id="mission-window-message" value="${esc(rule.operator_message || '')}" maxlength="1000"></label><button class="btn-primary" type="button" ${canEdit ? '' : 'disabled'} onclick="saveMissionProviderWindow(${saparMission.id})">${canEdit ? 'Опубликовать версию' : 'Только просмотр'}</button><div class="mission-window-preview"><b>${allowed}</b><span>разрешённых дней в текущем месяце</span></div></div>` : '<p class="missions-empty">Миссия SAPAR ещё не назначена территории.</p>'}
    ${signingMission ? documentSigningWindowEditor(signingMission, signingSetting, signingPreview, canEdit) : ''}
  </section>`;
}

function documentSigningWindowEditor(mission, setting, preview, canEdit) {
  const rule = setting?.value || {start_day:5,end_day:15,exception_end_day:null,exception_year_month:null,operator_message:''};
  return `<div class="mission-window-editor smz-window-editor"><div><h3>Подписание АВР</h3><p>Версия ${setting?.version || 1}. Базовый период и исключение сохраняются в активной попытке.</p></div><label>Начало<input id="smz-window-start" type="number" min="1" max="31" value="${rule.start_day}"></label><label>Окончание<input id="smz-window-end" type="number" min="1" max="31" value="${rule.end_day}"></label><label>Продлить до<input id="smz-window-exception-end" type="number" min="1" max="31" value="${rule.exception_end_day || ''}" placeholder="25"></label><label>Месяц исключения<input id="smz-window-exception-month" type="month" value="${rule.exception_year_month || ''}"></label><label class="mission-window-message">Сообщение оператору<input id="smz-window-message" value="${esc(rule.operator_message || '')}" maxlength="1000"></label><button class="btn-primary" type="button" ${canEdit ? '' : 'disabled'} onclick="saveDocumentSigningWindow(${mission.id})">${canEdit ? 'Опубликовать версию' : 'Только просмотр'}</button><div class="mission-window-preview"><b>${esc(preview?.effective_end_date || String(rule.end_day))}</b><span>фактическая конечная дата · документы ${esc(preview?.target_period?.label || '')}</span></div></div>`;
}

async function saveDocumentSigningWindow(missionId) {
  const start = Number(document.getElementById('smz-window-start')?.value);
  const end = Number(document.getElementById('smz-window-end')?.value);
  const exceptionEnd = Number(document.getElementById('smz-window-exception-end')?.value) || null;
  const exceptionMonth = document.getElementById('smz-window-exception-month')?.value || null;
  const message = document.getElementById('smz-window-message')?.value?.trim();
  if (!start || !end || !message || Boolean(exceptionEnd) !== Boolean(exceptionMonth)) { showToast('Заполните базовый период; для исключения нужны и месяц, и день', 'error'); return; }
  try {
    await api.updateDocumentSigningWindow(missionId, {start_day:start,end_day:end,timezone:'Asia/Almaty',exception_end_day:exceptionEnd,exception_year_month:exceptionMonth,operator_message:message});
    showToast('Новая версия периода подписания опубликована', 'ok');
    renderMissions();
  } catch (error) { showToast(error.message, 'error'); }
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
