/* Выделено из 60-wheel-tests.view.js (2603 строки).
   Кеш, подписи призов и экран колеса для оператора. */

function wheelCachedFetch(key, fetcher, fallback, onFresh, ttlMs = WHEEL_TTL_MS) {
  const cached = swrReadRaw(key);
  const saveFresh = (fresh, previous) => {
    const changed = JSON.stringify(fresh) !== JSON.stringify(previous);
    swrWriteRaw(key, { data: fresh, ts: Date.now() });
    if (changed && onFresh) onFresh(fresh);
  };
  if (cached) {
    if (Date.now() - cached.ts > ttlMs) {
      fetcher().then(fresh => saveFresh(fresh, cached.data)).catch(() => {});
    }
    return Promise.resolve(cached.data);
  }
  let returnedFallback = false;
  const request = fetcher()
    .then(fresh => {
      swrWriteRaw(key, { data: fresh, ts: Date.now() });
      if (returnedFallback && onFresh) onFresh(fresh);
      return fresh;
    })
    .catch(() => fallback);
  return withTimeout(request, WHEEL_FAST_MS, 'wheel-fast-timeout').catch(() => {
    returnedFallback = true;
    request.catch(() => {});
    return fallback;
  });
}

function wheelRefreshIfTab(tab, renderer, body) {
  if (STATE.currentView === 'wheel' && _wheelStaffTab === tab) renderer(body);
}

function wheelLoadingPanel(title = 'Загрузка Wheel of WOW') {
  return `<div class="panel wheel-admin-panel"><div class="wheel-admin-content"><div class="wheel-fast-loading"><div class="loading-spinner"></div><strong>${esc(title)}</strong><span>Экран открывается сразу, данные обновятся в фоне.</span></div></div></div>`;
}

function wheelPrizeTypeLabel(t) {
  return {
    coins: 'коины', xp: 'XP', shop_discount: 'скидка', extra_ticket: 'билет',
    spin_token: 'ещё вращение', badge: 'бейдж', raffle_ticket: 'розыгрыш',
    status: 'статус', manual_reward: 'приз', empty_consolation: 'приз',
  }[t] || t;
}

function wheelCleanText(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  const mojibakeScore = (text.match(/[РС][\u0400-\u04FF]?/g) || []).length;
  if (mojibakeScore >= 3 || /вЂ|Рџ|Рљ|РЈ|Рќ|РЎ|Р“|Р’/.test(text)) return fallback;
  return text;
}

function wheelPrizePresentation(prize) {
  const type = prize?.type || prize?.prize_type || '';
  const amount = Number(prize?.amount || 0);
  const title = wheelCleanText(prize?.title || prize?.prize, 'Приз Wheel of WOW');
  const map = {
    coins: {
      badge: `+${amount}`,
      line1: `+${amount}`,
      line2: amount === 1 ? 'коин' : 'коинов',
      description: 'Коины сразу поступят на ваш баланс.',
    },
    shop_discount: {
      badge: `${amount}%`,
      line1: `${amount}%`,
      line2: 'скидка',
      description: 'Скидка будет доступна для покупки в магазине.',
    },
    extra_ticket: {
      badge: '+1',
      line1: '+1',
      line2: 'билет',
      description: 'Дополнительная попытка вращения колеса.',
    },
    spin_token: {
      badge: '+1',
      line1: 'Ещё',
      line2: 'вращение',
      description: 'Ещё одна попытка вращения колеса.',
    },
    badge: {
      badge: 'B',
      line1: 'Бейдж',
      line2: 'дня',
      description: 'Памятный бейдж появится в вашем профиле.',
    },
    raffle_ticket: {
      badge: 'R',
      line1: 'Билет',
      line2: 'розыгрыша',
      description: 'Билет автоматически добавится в активный розыгрыш.',
    },
    manual_reward: {
      badge: 'WOW',
      line1: 'Особый',
      line2: 'приз',
      description: 'Руководитель свяжется с вами для вручения приза.',
    },
    status: {
      badge: 'S',
      line1: 'Особый',
      line2: 'статус',
      description: 'Специальный статус оператора.',
    },
  };
  return { title, color: prize?.color || '#1F8FFF', ...(map[type] || {
    badge: 'WOW', line1: title.split(' ')[0] || 'Приз', line2: title.split(' ').slice(1, 3).join(' '),
    description: 'Описание и порядок получения указаны в названии приза.',
  }) };
}

function buildWheelPrizeCatalog(items) {
  return `<div class="wheel-v2-prize-list">${items.map(prize => {
    const ui = wheelPrizePresentation(prize);
    return `<article class="wheel-v2-prize-item">
      <span class="wheel-v2-prize-mark" style="--prize-color:${esc(ui.color)}">${esc(ui.badge)}</span>
      <div><b>${esc(ui.title)}</b><small>${esc(ui.description)}</small></div>
    </article>`;
  }).join('')}</div>`;
}

function wheelTicketGuide() {
  return `<div class="wheel-v2-guide">
    <span>Получить билет можно за:</span>
    <div><b>01</b> дневную цель</div>
    <div><b>02</b> место в топ-3</div>
    <div><b>03</b> выдачу руководителем</div>
  </div>`;
}

function renderWheel() {
  const el = document.getElementById('view-wheel');
  if (!el) return;
  const role = STATE.user?.role || 'operator';
  if (isAdmin(role)) {
    renderWheelStaffView(el);
  } else {
    renderWheelOperatorView(el);
  }
}

/* ---------- Оператор: колесо ---------- */
async function renderWheelOperatorView(el) {
  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Геймификация</div>
        <h2 class="section-title">Wheel of WOW</h2>
      </div>
    </div>
    <div class="panel"><div class="empty-state"><div class="loading-spinner"></div><p>Загрузка колеса…</p></div></div>`;

  const fallbackStatus = { __fallback: true, campaign: { id: 0, title: 'Wheel of WOW' }, available_tickets: 0, spins_used_today: 0, max_spins_per_day: 0, spins_used_this_week: 0, max_spins_per_week: 0, can_spin: false };
  const fallbackItems = { __fallback: true, items: [] };
  const fallbackHistory = { items: [] };
  const rerenderFresh = () => { if (STATE.currentView === 'wheel' && !isAdmin(STATE.user?.role || 'operator')) renderWheelOperatorView(el); };
  const [status, prizes, history] = await Promise.all([
    wheelCachedFetch('wheel:status', () => api.getWheelStatus(), fallbackStatus, rerenderFresh, WHEEL_TTL_MS),
    wheelCachedFetch('wheel:prizes', () => api.getWheelPrizes(), fallbackItems, rerenderFresh, WHEEL_STATIC_TTL_MS),
    wheelCachedFetch('wheel:my-history', () => api.getWheelMyHistory().catch(() => ({ items: [] })), fallbackHistory, rerenderFresh, WHEEL_TTL_MS),
  ]);

  const items = prizes.items || [];
  if (status.__fallback || prizes.__fallback) {
    el.innerHTML = `<div class="view-header"><h2 class="section-title">Wheel of WOW</h2></div>${wheelLoadingPanel('Готовим колесо')}`;
    return;
  }
  if (!status.campaign || !items.length) {
    el.innerHTML = `<div class="view-header"><h2 class="section-title">Wheel of WOW</h2></div>
      <div class="panel"><div class="empty-state"><p>Колесо сейчас недоступно. Загляните позже.</p></div></div>`;
    return;
  }

  const tickets = status.available_tickets || 0;
  // Единый источник истины — backend (ТЗ п.13/17). Если поля нет (старый
  // ответ), падаем на прежний расчёт по лимитам.
  const canSpin = (typeof status.can_spin === 'boolean')
    ? status.can_spin
    : (tickets > 0
        && (!status.max_spins_per_day || status.spins_used_today < status.max_spins_per_day)
        && (!status.max_spins_per_week || status.spins_used_this_week < status.max_spins_per_week));
  const cannotReason = status.reason_if_cannot_spin || (tickets > 0 ? 'Лимит на сегодня исчерпан' : 'Нет билетов');

  const safeCannotReason = wheelCleanText(
    status.reason_if_cannot_spin,
    tickets > 0 ? 'Лимит на сегодня исчерпан' : 'Нет доступных прокруток'
  );
  const safeNextTicketReason = wheelCleanText(status.next_ticket_reason);

  el.innerHTML = `
    <div class="view-header wheel-v2-header">
      <div>
        <div class="section-kicker">Геймификация</div>
        <h2 class="section-title">Колесо наград</h2>
        <p class="wheel-v2-subtitle">Используйте билет и получите один из призов Wheel of WOW</p>
      </div>
      <div class="wheel-v2-counters">
        <div><span>Билеты</span><b id="wheel-ticket-count-value">${tickets}</b></div>
        <div><span>Сегодня</span><b id="wheel-today-limit">${status.spins_used_today} из ${status.max_spins_per_day || '∞'}</b></div>
        <div><span>Неделя</span><b id="wheel-week-limit">${status.spins_used_this_week} из ${status.max_spins_per_week || '∞'}</b></div>
      </div>
    </div>

    <div class="wheel-v2-layout">
      <section class="panel wheel-v2-stage-panel">
        <div class="wheel-v2-panel-head">
          <div><span>Ваш билет</span><h3>${canSpin ? 'Всё готово к вращению' : 'Сначала получите билет'}</h3></div>
          <span class="wheel-v2-status ${canSpin ? 'is-ready' : ''}">${canSpin ? 'Доступно' : 'Нет билета'}</span>
        </div>
        <div class="wheel-v2-stage-body">
          <div class="wheel-stage">
            <div class="wheel-pointer wheel-pointer-v2" aria-hidden="true"></div>
            <div class="wheel-rotor" id="wheel-rotor">${buildWheelSvg(items)}</div>
            <button class="wheel-hub wheel-hub-btn" id="wheel-spin-btn" ${canSpin ? '' : 'disabled'} aria-label="${canSpin ? 'Крутить колесо' : 'Нет доступных билетов'}"><b>${canSpin ? 'Крутить' : 'Нет билета'}</b><span>PULS WOW</span></button>
          </div>
          <div class="wheel-v2-action">
            <div class="wheel-v2-ticket-summary">
              <span>Доступно вращений</span>
              <strong>${tickets}</strong>
              <small>${safeNextTicketReason ? `Билет получен: ${esc(safeNextTicketReason)}` : esc(safeCannotReason)}</small>
            </div>
            ${!canSpin ? wheelTicketGuide() : '<p class="wheel-v2-action-note">Нажмите «Крутить» в центре колеса — оно остановится на одном из призов.</p>'}
          </div>
        </div>
      </section>

      <section class="panel wheel-v2-prizes-panel">
        <div class="wheel-v2-panel-head"><div><span>Состав колеса</span><h3>Что можно выиграть</h3></div><b>${items.length} призов</b></div>
        ${buildWheelPrizeCatalog(items)}
        <p class="wheel-v2-prize-note">Каждый активный сектор приносит приз. Пустых секторов в колесе нет.</p>
      </section>
    </div>

    <section class="panel wheel-v2-history-panel">
      <div class="wheel-v2-panel-head"><div><span>История</span><h3>Мои выигрыши</h3></div><b>${(history.items || []).length} записей</b></div>
      <div id="wheel-history-body">${buildWheelHistory(history.items || [])}</div>
    </section>`;

  // Раскладываем сектора по кругу для дальнейшего расчёта угла остановки
  STATE.wheel = { items, rotation: 0, spinning: false };

  const btn = document.getElementById('wheel-spin-btn');
  if (btn && canSpin) btn.onclick = () => doWheelSpin(el);
}

// Резервная палитра, если у приза не задан цвет
