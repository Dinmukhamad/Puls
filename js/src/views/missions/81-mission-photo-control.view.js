let _photoDialogReturnFocus = null;

function photoRequirements(attempt) {
  return attempt.current_step.content.requirements || [
    { slot_key: 'front', label: 'Машина спереди', asset_id: 'car-front-v1', asset: '/img/missions/photo-control/car/front.webp', criterion: 'Автомобиль целиком.' },
    { slot_key: 'left', label: 'Машина слева', asset_id: 'car-left-v1', asset: '/img/missions/photo-control/car/left.webp', criterion: 'Виден весь левый бок.' },
    { slot_key: 'rear', label: 'Машина сзади', asset_id: 'car-rear-v1', asset: '/img/missions/photo-control/car/rear.webp', criterion: 'Автомобиль целиком сзади.' },
    { slot_key: 'right', label: 'Машина справа', asset_id: 'car-right-v1', asset: '/img/missions/photo-control/car/right.webp', criterion: 'Виден весь правый бок.' },
    { slot_key: 'front_seats', label: 'Передний ряд сидений', asset_id: 'car-front-seats-v1', asset: '/img/missions/photo-control/car/front-seats.webp', criterion: 'Видны оба передних места.' },
    { slot_key: 'rear_seats', label: 'Задний ряд сидений', asset_id: 'car-rear-seats-v1', asset: '/img/missions/photo-control/car/rear-seats.webp', criterion: 'Виден весь задний ряд.' },
    { slot_key: 'trunk', label: 'Открытый багажник', asset_id: 'car-trunk-v1', asset: '/img/missions/photo-control/car/trunk-open.webp', criterion: 'Багажник открыт и полностью в кадре.' },
  ];
}

function photoCheckRow(type, title, status, interactive) {
  const passed = status === 'passed';
  return `<button type="button" class="photo-check-row ${passed ? 'is-passed' : 'is-pending'}" ${interactive ? `onclick="missionAction('select_check',{check_type:'${type}'})"` : 'disabled'}>
    <span class="photo-check-status" aria-hidden="true">${passed ? '✓' : '×'}</span>
    <span><strong>${esc(title)}</strong><small>${passed ? 'Пройдено' : 'Не пройдено'}</small></span>
    <b aria-hidden="true">${interactive ? '›' : ''}</b>
  </button>`;
}

function renderPhotoControlScreen(attempt) {
  const step = attempt.current_step;
  const state = attempt.state || {};
  if (step.screen_key === 'photo_intro') {
    return `<div class="photo-intro-screen"><span class="phone-pulse-logo">Puls.</span><div class="photo-camera-mark" aria-hidden="true">◎</div><h2>Прохождение фотоконтроля</h2><p>Разберём безопасный учебный сценарий без камеры, реальных документов и внешних сервисов.</p><button type="button" onclick="missionAction('begin')">Начать миссию 2</button></div>`;
  }
  if (step.screen_key === 'photo_profile') {
    return `<div class="photo-profile-screen"><div class="photo-profile-person"><span>${esc((attempt.license_identity?.full_name || 'У')[0])}</span><div><strong>${esc(attempt.license_identity?.full_name || 'Учебный водитель')}</strong><small>Porsche Panamera · iTaxi</small></div></div><div class="photo-profile-block"><div><span>Оплата</span><b>Наличными или картой</b></div><div><span>Опции для тарифов</span><b>›</b></div></div><div class="photo-profile-menu"><button type="button"><i>◉</i><span>Диагностика</span><em>2</em></button><button class="is-target" type="button" onclick="missionAction('open_photo_control')"><i>▣</i><span>Фотоконтроль</span><b>›</b></button><button type="button"><i>◆</i><span>Яндекс Заправки</span><b>›</b></button><button type="button"><i>％</i><span>Промокоды</span><b>›</b></button></div><div class="profile-bottom"><span>Карта</span><span>Деньги</span><span>Сообщения</span><b>Профиль</b></div></div>`;
  }
  if (step.screen_key === 'photo_checks') {
    const checks = state.checks || {};
    const expected = step.content.check_type;
    const complete = step.action_key === 'confirm_final_statuses';
    return `<div class="photo-checks-screen"><header><span>←</span><strong>Фотоконтроль</strong></header><small class="photo-section-label">Блокирует работу</small>${photoCheckRow('driver_license', 'Фотоконтроль водительского удостоверения', checks.driver_license, expected === 'driver_license')}${photoCheckRow('car', 'Фотоконтроль машины', checks.car, expected === 'car')}<button class="photo-disabled-row" type="button" disabled><span>Фотоконтроль документов на машину</span><small>Будет доступно позже</small></button><div class="photo-passed-title">Пройденные проверки <b>⌄</b></div>${complete ? `<button class="photo-primary" type="button" onclick="missionAction('confirm_final_statuses',{car:true,driver_license:true})">Подтвердить статусы</button>` : ''}</div>`;
  }
  if (step.screen_key === 'car_instruction') {
    return `<div class="photo-instruction-screen"><h2>Фотоконтроль машины</h2><p>Отправьте семь учебных кадров, чтобы проверить доступ к заказам.</p><img src="/img/missions/photo-control/car/instructions.svg" alt="Семь обязательных ракурсов Porsche Panamera"><div class="photo-phone-actions"><button type="button" disabled>Назад</button><button type="button" onclick="missionAction('view_instruction')">Далее</button></div></div>`;
  }
  if (step.screen_key === 'car_grid') return renderPhotoCarGrid(attempt);
  if (step.screen_key === 'license_grid') return renderPhotoLicenseGrid(attempt);
  if (step.screen_key === 'photo_result') {
    const score = Math.round(attempt.score || 0);
    const passed = score >= 80;
    return `<div class="photo-result-screen"><div class="photo-result-ring ${passed ? 'is-passed' : ''}"><strong>${score}</strong><span>из 100</span></div><h2>${passed ? 'Фотоконтроль освоен' : 'Нужно повторить'}</h2><p>${passed ? 'Обе обязательные проверки пройдены. Результат рассчитан сервером.' : 'Посмотри ошибки и пройди сценарий ещё раз. Лучшая попытка сохранена.'}</p>${passed ? `<button type="button" onclick="missionAction('complete')">Завершить миссию</button>` : `<button type="button" onclick="restartCurrentMission()">Попробовать ещё раз</button>`}</div>`;
  }
  return '<div class="photo-result-screen"><p>Экран миссии загружается…</p></div>';
}

function renderPhotoCarGrid(attempt) {
  const requirements = photoRequirements(attempt);
  const slots = attempt.state?.car_slots || {};
  const current = attempt.current_step.content.slot_key;
  const submitting = attempt.current_step.action_key === 'submit_car_check';
  return `<div class="photo-car-grid-screen"><h2>Фотоконтроль машины</h2><p>Добавьте все семь учебных фотографий.</p><div class="photo-slot-grid">${requirements.map((item, index) => { const filled = Boolean(slots[item.slot_key]); return `<button type="button" class="photo-slot ${filled ? 'is-filled' : ''} ${current === item.slot_key ? 'is-current' : ''}" aria-label="${filled ? 'Посмотреть или заменить' : 'Добавить'}: ${esc(item.label)}" onclick="openPhotoAssetDialog('${item.slot_key}',this)">${filled ? `<img src="${esc(item.asset)}" alt="" loading="${index < 2 ? 'eager' : 'lazy'}"><i>✓</i>` : '<b>+</b>'}<span>${esc(item.label)}</span></button>`; }).join('')}</div><div id="photo-grid-error" class="photo-grid-error" aria-live="polite"></div><div class="photo-phone-actions"><button type="button" disabled>Назад</button><button type="button" ${submitting && Object.keys(slots).length === 7 ? `onclick="missionAction('submit_car_check')"` : 'disabled'}>Далее · ${Object.keys(slots).length}/7</button></div></div>`;
}

function licenseCard(side, identity) {
  const back = side === 'back';
  return `<div class="training-license ${back ? 'is-back' : ''}" aria-label="Учебный образец, ${back ? 'обратная' : 'лицевая'} сторона"><div class="license-watermark">УЧЕБНЫЙ ОБРАЗЕЦ · НЕ ДОКУМЕНТ</div><header><b>PULS</b><span>DRIVER TRAINING</span></header>${back ? `<div class="license-back-lines"><i></i><i></i><i></i><p>Категория B · iTaxi<br>Номер: DEMO-0002<br>Действительно: только в миссии</p></div>` : `<div class="license-front-body"><span class="license-avatar">👤</span><div><strong>${esc(identity.full_name || 'Учебный водитель')}</strong><small>Уровень Pulse: ${esc(identity.level || 'Стажёр')}</small><small>Парк: iTaxi · Категория B</small><small>DEMO-0002 · 31.12.2099</small></div></div>`}</div>`;
}

function renderPhotoLicenseGrid(attempt) {
  const slots = attempt.state?.license_slots || {};
  const expected = attempt.current_step.content.side;
  const submitting = attempt.current_step.action_key === 'submit_license_check';
  return `<div class="photo-license-screen"><h2>Водительское удостоверение</h2><p>Все четыре края должны быть видны, текст читаем, бликов нет.</p><div class="license-slot-grid">${['front','back'].map(side => { const filled = Boolean(slots[side]); const label = side === 'front' ? 'Лицевая сторона' : 'Обратная сторона'; return `<button type="button" class="license-slot ${filled ? 'is-filled' : ''} ${expected === side ? 'is-current' : ''}" aria-label="${filled ? 'Посмотреть или заменить' : 'Добавить'}: ${label}" onclick="openLicenseDialog('${side}',this)">${filled ? licenseCard(side, attempt.license_identity || {}) : '<b>+</b>'}<span>${label}</span>${filled ? '<i>✓</i>' : ''}</button>`; }).join('')}</div><div id="license-grid-error" class="photo-grid-error" aria-live="polite"></div><div class="photo-phone-actions"><button type="button" disabled>Назад</button><button type="button" ${submitting && Object.keys(slots).length === 2 ? `onclick="missionAction('submit_license_check')"` : 'disabled'}>Далее · ${Object.keys(slots).length}/2</button></div></div>`;
}

function openPhotoAssetDialog(slotKey, trigger) {
  const item = photoRequirements(_missionAttempt).find(row => row.slot_key === slotKey);
  if (!item) return;
  openMissionPreviewDialog(trigger, `<img class="photo-preview-image" src="${esc(item.asset)}" alt="${esc(item.label)}"><h2>${esc(item.label)}</h2><p>${esc(item.criterion)}</p><ul><li>Кадр чёткий и хорошо освещён</li><li>Нет лиц и читаемых номеров</li><li>Весь требуемый объект помещается в кадре</li></ul>`, () => missionAction('confirm_car_slot', { slot_key: item.slot_key, asset_id: item.asset_id }));
}

function openLicenseDialog(side, trigger) {
  const label = side === 'front' ? 'Лицевая сторона' : 'Обратная сторона';
  openMissionPreviewDialog(trigger, `${licenseCard(side, _missionAttempt.license_identity || {})}<h2>${label}</h2><p>Все четыре края видны, учебный текст читаем, бликов нет. Образец недействителен вне миссии.</p>`, () => missionAction('confirm_license_side', { side }));
}

function openMissionPreviewDialog(trigger, content, confirmAction) {
  closeMissionPreviewDialog();
  _photoDialogReturnFocus = trigger;
  const dialog = document.createElement('div');
  dialog.className = 'mission-preview-backdrop';
  dialog.innerHTML = `<div class="mission-preview-dialog" role="dialog" aria-modal="true" aria-label="Предпросмотр учебной фотографии"><button class="mission-preview-close" type="button" aria-label="Закрыть">×</button><div class="mission-preview-content">${content}</div><div class="mission-preview-actions"><button class="btn-outline" type="button" data-close>Назад</button><button class="btn-primary" type="button" data-confirm>Использовать фото</button></div></div>`;
  document.body.appendChild(dialog);
  const close = () => closeMissionPreviewDialog();
  dialog.querySelector('.mission-preview-close').onclick = close;
  dialog.querySelector('[data-close]').onclick = close;
  dialog.querySelector('[data-confirm]').onclick = () => { close(); confirmAction(); };
  dialog.addEventListener('keydown', trapMissionPreviewFocus);
  dialog.addEventListener('mousedown', event => { if (event.target === dialog) close(); });
  dialog.querySelector('.mission-preview-close').focus();
}

function trapMissionPreviewFocus(event) {
  if (event.key === 'Escape') { closeMissionPreviewDialog(); return; }
  if (event.key !== 'Tab') return;
  const focusable = Array.from(event.currentTarget.querySelectorAll('button:not([disabled])'));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function closeMissionPreviewDialog() {
  document.querySelector('.mission-preview-backdrop')?.remove();
  _photoDialogReturnFocus?.focus?.();
  _photoDialogReturnFocus = null;
}
