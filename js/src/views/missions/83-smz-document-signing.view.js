function smzPurposeForScreen(screen) {
  return screen.includes('documents') ? 'documents' : 'auth';
}

function smzOperatorName(attempt) {
  return attempt.license_identity?.full_name || 'Учебный водитель';
}

function smzSaparHeader(title = 'SAPAR') {
  return `<header class="smz-sapar-header"><span class="smz-training-mark">УЧЕБНАЯ СРЕДА</span><b>▣ ${esc(title)}</b></header>`;
}

function smzEgovShell(attempt, body) {
  const firstName = smzOperatorName(attempt).split(/\s+/)[1] || smzOperatorName(attempt).split(/\s+/)[0];
  return `<div class="smz-egov smz-app-switch" role="dialog" aria-modal="true" aria-label="Учебный симулятор eGov Mobile" onkeydown="trapSmzEgovFocus(event)">
    <div class="smz-egov-top"><button type="button" aria-label="Закрыть симулятор" onclick="showToast('Сначала заверши текущую учебную подпись','error')">×</button><b>eGov Mobile · обучение</b><span>↗</span></div>
    <div class="smz-egov-avatar" aria-hidden="true"></div><h2>Здравствуйте, ${esc(firstName)}!</h2>${body}
  </div>`;
}

function smzSigningCodeInput(purpose) {
  return `<p>Введите код быстрого доступа из подсказки Пульсара.</p>
    <label for="smz-training-code">Четырёхзначный учебный код</label>
    <input id="smz-training-code" class="smz-code-input" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]{4}" aria-describedby="smz-code-status" oninput="toggleSmzCodeButton(this)">
    <span id="smz-code-status" class="sr-only" aria-live="polite"></span>
    <div class="smz-keypad" aria-label="Цифровая клавиатура">${[1,2,3,4,5,6,7,8,9,0].map(n => `<button type="button" onclick="tapSmzCode('${n}')" aria-label="Цифра ${n}">${n}</button>`).join('')}<button type="button" onclick="tapSmzCode('backspace')" aria-label="Удалить цифру">⌫</button></div>
    <button id="smz-code-submit" class="smz-primary" type="button" disabled onclick="submitSmzSigningCode('${purpose}')">Далее</button>`;
}

function renderSmzDocumentSigningScreen(attempt) {
  const step = attempt.current_step;
  const state = attempt.state || {};
  const target = state.target_period || {};
  const operatorName = smzOperatorName(attempt);
  const screen = step.screen_key;
  if (screen === 'signing_intro') {
    return `<div class="smz-intro"><span class="smz-lesson-chip">СМЗ · УРОК 2</span><div class="smz-sign-icon">✓</div><h2>Подписание документов</h2><p>Две разные подписи: первая открывает SAPAR, вторая подписывает три АВР. Данные никуда не отправляются.</p><button class="smz-primary" type="button" onclick="missionAction('begin')">Начать урок</button></div>`;
  }
  if (screen === 'signing_date_check') {
    const shown = new Date(`${state.current_date}T12:00:00`).toLocaleDateString('ru-RU', {day:'numeric', month:'long', year:'numeric'});
    return `<div class="smz-question"><span class="smz-lesson-chip">ПРАВИЛО · ВЕРСИЯ ${state.setting_version}</span><h2>Можно ли подписывать сегодня?</h2><div class="smz-calendar"><small>Дата в Asia/Almaty</small><b>${esc(shown)}</b><span>Базовый период: 5–15${state.effective_end_day > 15 ? ` · продлён до ${state.effective_end_day}` : ''}</span></div><div class="smz-choice"><button type="button" onclick="missionAction('answer_date_eligibility',{allowed:true})">Да, доступно</button><button type="button" onclick="missionAction('answer_date_eligibility',{allowed:false})">Нет, вне периода</button></div></div>`;
  }
  if (screen === 'signing_period_check') {
    const prevMonth = target.month === 1 ? 12 : target.month - 1;
    const prevYear = target.month === 1 ? target.year - 1 : target.year;
    return `<div class="smz-question"><span class="smz-lesson-chip">ПЕРИОД ДОКУМЕНТОВ</span><h2>За какой месяц нужны АВР?</h2><p>Сейчас ${esc(state.current_month || '')}. Выбери календарный месяц документов.</p><div class="smz-period-list"><button type="button" onclick="missionAction('answer_target_period',{year:${target.year},month:${target.month}})"><b>${esc(target.label || '')}</b><span>Предыдущий месяц</span></button><button type="button" onclick="missionAction('answer_target_period',{year:${prevYear},month:${prevMonth}})">Другой период</button><button type="button" onclick="missionAction('answer_target_period',{year:${new Date(state.current_date).getFullYear()},month:${new Date(state.current_date).getMonth()+1}})">Текущий месяц</button></div></div>`;
  }
  if (screen === 'signing_sapar_login') {
    return `<div class="smz-sapar">${smzSaparHeader()}<h2>Вход в платформу</h2><p>Авторизация и подписание документации доступны только через мобильное устройство.</p><div class="smz-info-card"><b>Для входа нужен eGov Mobile</b><span>Это учебная имитация — настоящая подпись не создаётся.</span><button type="button" onclick="missionAction('start_egov_signature',{purpose:'auth'})">Подписать в eGov Mobile</button></div><button class="smz-primary" type="button" disabled>Войти</button></div>`;
  }
  if (screen === 'signing_egov_code_auth' || screen === 'signing_egov_code_documents') {
    const purpose = smzPurposeForScreen(screen);
    return smzEgovShell(attempt, smzSigningCodeInput(purpose));
  }
  if (screen === 'signing_egov_sign_auth' || screen === 'signing_egov_sign_documents') {
    const purpose = smzPurposeForScreen(screen);
    const title = purpose === 'auth' ? 'Авторизация на SAPAR' : `АВР ${target.label || ''}`;
    return smzEgovShell(attempt, `<div class="smz-sign-dialog"><span>Подписание</span><h3>Документ на подписании</h3><div class="smz-sign-warning">После подписания самостоятельно вернитесь на SAPAR.</div><b>${esc(title)}</b><small>Учебная сессия · ${purpose === 'auth' ? 'вход' : 'документы'}</small><button class="smz-primary" type="button" onclick="missionAction('approve_signature',{purpose:'${purpose}'})">Подписать</button><button class="smz-decline" type="button" onclick="missionAction('decline_signature',{purpose:'${purpose}'})">Отказать</button></div>`);
  }
  if (screen === 'signing_egov_return_auth' || screen === 'signing_egov_return_documents') {
    const purpose = smzPurposeForScreen(screen);
    return smzEgovShell(attempt, `<div class="smz-sign-success" role="status" aria-live="polite"><span>✓</span><h3>Подпись подтверждена</h3><p>${purpose === 'auth' ? 'Авторизация разрешена.' : 'Подпись АВР получена, но ещё не сохранена.'}</p><button class="smz-primary" type="button" onclick="missionAction('return_to_sapar',{purpose:'${purpose}'})">Вернуться на SAPAR</button></div>`);
  }
  if (screen === 'signing_sapar_authorized') {
    return `<div class="smz-sapar smz-app-switch">${smzSaparHeader()}<h2>Вход в платформу</h2><div class="smz-user-card"><span>✓</span><b>${esc(operatorName)}</b><small>ИИН: 9••••••••••• · учебная маска</small></div><button class="smz-primary" type="button" onclick="missionAction('enter_sapar')">Войти</button></div>`;
  }
  if (screen === 'signing_driver_profile') {
    return `<div class="smz-sapar">${smzSaparHeader('Профиль водителя')}<span class="smz-demo-base">ДЕМО-БАЗА</span><h3>Текущие документы на подписание</h3><div class="smz-avr-card"><div><b>Акт выполненных работ (АВР)</b><span>${esc(target.label || '')}</span></div><button type="button" onclick="missionAction('open_target_avr')">Открыть</button></div><div class="smz-profile-data"><b>Информация о пользователе</b><span>${esc(operatorName)}</span><small>ИИН: 9•••••••••••</small></div></div>`;
  }
  if (screen === 'signing_avr_details') {
    return `<div class="smz-sapar">${smzSaparHeader('Документы')}<span class="smz-demo-base">ДЕМО-БАЗА</span><h3>Акт выполненных работ</h3><div class="smz-avr-card"><div><b>АВР ${esc(target.label || '')}</b><span>Комплект из 3 учебных документов</span></div><button type="button" onclick="missionAction('open_avr_package')">Подписать</button></div></div>`;
  }
  if (screen === 'signing_avr_package') {
    return `<div class="smz-sapar">${smzSaparHeader('Подписание АВР')}<span class="smz-demo-base">ДЕМО-БАЗА</span><h3>Комплект ${esc(target.label || '')}</h3><div class="smz-doc-buttons">${[1,2,3].map(n => `<button type="button" onclick="openTrainingAvr(${n})">Скачать АВР ${n}</button>`).join('')}</div><div class="smz-info-card"><b>Все три файла готовы</b><span>Повторная подпись относится к документам, а не ко входу.</span><button type="button" onclick="missionAction('start_egov_signature',{purpose:'documents'})">Подписать в eGov Mobile</button></div></div>`;
  }
  if (screen === 'signing_save_documents') {
    return `<div class="smz-sapar smz-app-switch">${smzSaparHeader('Подписание АВР')}<span class="smz-demo-base">ДЕМО-БАЗА</span><div class="smz-user-card"><span>✓</span><b>Подпись документов получена</b><small>Статус: подписано, но не сохранено</small></div><div class="smz-doc-buttons">${[1,2,3].map(n => `<button type="button" onclick="openTrainingAvr(${n})">Скачать АВР ${n}</button>`).join('')}</div><button class="smz-primary smz-save-pulse" type="button" onclick="missionAction('save_signed_documents')">Сохранить</button><p class="smz-save-warning" aria-live="polite">Без этой кнопки документы не получат статус «Подписано».</p></div>`;
  }
  const score = Math.round(attempt.score || 0);
  return `<div class="smz-result"><span class="smz-result-check">✓</span><h2>Документы подписаны</h2><p>АВР ${esc(target.label || '')} подписаны и сохранены.</p><div><b>${score}</b><span>из 100 баллов</span></div><button class="smz-primary" type="button" onclick="missionAction('complete')">Завершить миссию</button></div>`;
}

function toggleSmzCodeButton(input) {
  input.value = input.value.replace(/\D/g, '').slice(0, 4);
  const button = document.getElementById('smz-code-submit');
  if (button) button.disabled = input.value.length !== 4;
  _missionDirty = input.value.length > 0;
}

function tapSmzCode(value) {
  const input = document.getElementById('smz-training-code');
  if (!input) return;
  input.value = value === 'backspace' ? input.value.slice(0, -1) : `${input.value}${value}`.slice(0, 4);
  toggleSmzCodeButton(input);
  input.focus();
}

function submitSmzSigningCode(purpose) {
  const input = document.getElementById('smz-training-code');
  if (!/^\d{4}$/.test(input?.value || '')) return;
  missionAction('submit_training_code', {purpose, code: input.value});
}

function trapSmzEgovFocus(event) {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(event.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled])'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function openTrainingAvr(number) {
  const screen = document.querySelector('.mission-phone-screen');
  if (!screen) return;
  screen.insertAdjacentHTML('beforeend', `<div class="smz-pdf-preview" role="dialog" aria-modal="true" aria-label="Предпросмотр учебного АВР"><div><button type="button" onclick="this.closest('.smz-pdf-preview').remove()" aria-label="Закрыть">×</button><span>УЧЕБНЫЙ ДОКУМЕНТ</span><h3>АВР ${number}</h3><p>Без персональных данных, реальной подписи и юридической силы.</p></div></div>`);
  screen.querySelector('.smz-pdf-preview button')?.focus();
}
