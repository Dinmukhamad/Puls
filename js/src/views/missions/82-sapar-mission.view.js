function saparRow(icon, title, action = '', accent = false, subtitle = '') {
  const attrs = action ? `onclick="${action}"` : 'disabled';
  return `<button type="button" class="sapar-list-row ${accent ? 'is-target' : ''}" ${attrs}><i>${icon}</i><span><b>${esc(title)}</b>${subtitle ? `<small>${esc(subtitle)}</small>` : ''}</span><em>›</em></button>`;
}

function renderSaparMissionScreen(attempt) {
  const step = attempt.current_step;
  const state = attempt.state || {};
  const rule = state.provider_rule || {};
  if (step.screen_key === 'sapar_intro') {
    return `<div class="sapar-intro"><span class="sapar-badge">СМЗ · ЭДО</span><div class="sapar-doc-icon">✓</div><h2>Перевод на SAPAR</h2><p>Без реальных данных, согласий и внешних запросов. Ты пройдёшь весь путь в учебном режиме.</p><button type="button" onclick="missionAction('begin')">Начать урок</button></div>`;
  }
  if (step.screen_key === 'driver_status') {
    return `<div class="sapar-question"><span class="sapar-step-chip">Проверка обращения</span><h2>Водитель является самозанятым?</h2><div class="sapar-driver-card"><i>Д</i><div><b>Данияр</b><span>Статус: Самозанятый</span><small>Учебный профиль · без персональных данных</small></div></div><div class="sapar-choice-grid"><button type="button" onclick="missionAction('answer_driver_status',{is_self_employed:true})">Да, является</button><button type="button" onclick="missionAction('answer_driver_status',{is_self_employed:false})">Нет</button></div></div>`;
  }
  if (step.screen_key === 'date_eligibility') {
    const shown = new Date(`${state.simulated_date}T12:00:00`).toLocaleDateString('ru-RU', {day:'numeric',month:'long',year:'numeric'});
    return `<div class="sapar-question sapar-date-question"><span class="sapar-step-chip">Правило сроков · версия ${state.setting_version}</span><h2>Можно ли сменить провайдера?</h2><div class="sapar-date-card"><span>Учебная дата</span><strong>${esc(shown)}</strong></div><p>${esc(rule.operator_message || '')}</p><div class="sapar-choice-grid"><button type="button" onclick="missionAction('answer_date_rule',{allowed:true})">Да, можно</button><button type="button" onclick="missionAction('answer_date_rule',{allowed:false})">Нет, сообщить период</button></div></div>`;
  }
  if (step.screen_key === 'sapar_profile') {
    return `<div class="sapar-dark-screen sapar-profile"><div class="sapar-profile-head"><i>Д</i><b>Данияр</b></div>${saparRow('▤','Яндекс Гараж')}${saparRow('◉','Яндекс Заправки')}${saparRow('%','Промокоды')}${saparRow('◫','Обучение')}${saparRow('▣','Юридическая документация',`missionAction('open_legal_docs',{section:'legal_docs'})`,true)}${saparRow('⚙','Настройки')}</div>`;
  }
  if (step.screen_key === 'legal_docs') {
    return `<div class="sapar-dark-screen"><header><span>←</span><b>Юридическая документация</b></header>${saparRow('▣','Правовые документы',`missionAction('open_edo',{section:'wrong'})`)}${saparRow('▣','Электронный документооборот',`missionAction('open_edo',{section:'edo'})`,true)}${saparRow('▣','Закрывающие документы',`missionAction('open_edo',{section:'wrong'})`)}</div>`;
  }
  if (step.screen_key === 'edo_home') {
    return `<div class="sapar-dark-screen"><header><span>←</span><b>Электронный документооборот</b></header><div class="sapar-provider-current"><i>Б</i><span><b>Бухта</b><small>Активный провайдер</small></span><em>✓</em></div><h3>Документы в этом месяце</h3>${saparRow('!','Выбрать провайдера ЭДО',`missionAction('open_provider_list')`,true)}</div>`;
  }
  if (step.screen_key === 'provider_list') {
    const providers = [['Ц','ЦНТ','cnt'],['P','Payda','payda'],['◆','SAPAR','sapar'],['P','Partners Pay','partners_pay'],['V','Vezunchik.Pro','vezunchik'],['▱','Бумажный документооборот','paper']];
    return `<div class="sapar-dark-screen sapar-providers"><header><span>←</span><b>Провайдер</b></header><div class="sapar-provider-current"><i>Б</i><span><b>Бухта</b><small>Активный провайдер</small></span><em>✓</em></div><h3>Доступные провайдеры</h3>${providers.map(([icon,name,code]) => saparRow(icon,name,`missionAction('select_provider',{provider_code:'${code}'})`,code === 'sapar')).join('')}</div>`;
  }
  if (step.screen_key === 'sapar_details') {
    return `<div class="sapar-dark-screen sapar-details"><header><span>←</span><b>Провайдер</b></header><div class="sapar-provider-logo">◆ <b>SAPAR</b></div><p>После выбора нового ЭДО-провайдера документы можно будет подписывать со следующего месяца.</p><div class="sapar-rule-note"><b>Актуальный период</b><span>${esc(rule.operator_message || '')}</span></div>${saparRow('i','Тарифы и условия')}<button class="sapar-yellow" type="button" onclick="missionAction('view_terms')">Сменить провайдера</button></div>`;
  }
  if (step.screen_key === 'sapar_consent') {
    return `<div class="sapar-dark-screen sapar-consent"><header><span>←</span><b>Смена провайдера</b></header><p>${esc(step.content.legal_text || '')}</p><label class="sapar-consent-check"><input id="sapar-consent-box" type="checkbox" onchange="toggleSaparConsent()"><span>Я прочитал учебные условия и понимаю, что действие не создаёт реального согласия.</span></label><button id="sapar-consent-submit" class="sapar-yellow" type="button" disabled onclick="missionAction('confirm_consent',{accepted:true})">Подтвердить</button></div>`;
  }
  if (step.screen_key === 'sapar_processing') {
    return `<div class="sapar-processing" role="status" aria-live="polite"><div></div><h2>Меняем провайдера…</h2><p>Учебная обработка, без внешнего запроса</p></div>`;
  }
  if (step.screen_key === 'sapar_success') {
    return `<div class="sapar-success"><span>✓</span><h2>Провайдер поменялся</h2><p>Проверь итог и отметь оба верных последствия.</p><label><input class="sapar-outcome" type="checkbox" onchange="toggleSaparOutcomes()"> Документы подписываются через нового провайдера со следующего месяца</label><label><input class="sapar-outcome" type="checkbox" onchange="toggleSaparOutcomes()"> Далее водитель выбирает тариф и заключает договор</label><button id="sapar-outcomes-submit" type="button" disabled onclick="missionAction('confirm_outcomes',{next_month:true,contract_and_tariff:true})">Проверить результат</button></div>`;
  }
  const score = Math.round(attempt.score || 0);
  const passed = score >= 80;
  return `<div class="sapar-result"><div class="sapar-score ${passed ? 'is-passed' : ''}"><b>${score}</b><span>из 100</span></div><h2>${passed ? 'Маршрут освоен' : 'Нужно повторить'}</h2><p>${passed ? 'Ты правильно провёл самозанятого водителя до SAPAR.' : 'Повтори зоны с ошибками. Лучший результат сохранён.'}</p>${passed ? `<button type="button" onclick="missionAction('complete')">Завершить миссию</button>` : `<button type="button" onclick="restartCurrentMission()">Попробовать ещё раз</button>`}</div>`;
}

function toggleSaparConsent() {
  const box = document.getElementById('sapar-consent-box');
  const button = document.getElementById('sapar-consent-submit');
  if (button) button.disabled = !box?.checked;
}

function toggleSaparOutcomes() {
  const boxes = Array.from(document.querySelectorAll('.sapar-outcome'));
  const button = document.getElementById('sapar-outcomes-submit');
  if (button) button.disabled = boxes.length !== 2 || boxes.some(box => !box.checked);
}

function scheduleSaparProcessing(attempt) {
  if (attempt.mission_code !== 'smz_sapar_provider_transfer' || attempt.current_step.screen_key !== 'sapar_processing') return;
  missionViewController.timeout(() => {
    if (_missionAttempt?.id === attempt.id && _missionAttempt?.current_step?.screen_key === 'sapar_processing') missionAction('finish_processing');
  }, 1200);
}
