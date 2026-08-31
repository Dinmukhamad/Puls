/* ══════════════════════════════════════
   РОЗЫГРЫШИ (ТЗ P2)
   Билеты — только из Колеса WOW. Оператор вкладывает билеты в розыгрыш,
   админ запускает тираж (или он проходит автоматически по дате).
══════════════════════════════════════ */

function _raffleStatusBadge(status) {
  const map = {
    active: '<span class="badge badge-ok">активен</span>',
    drawn: '<span class="badge badge-muted">завершён</span>',
    cancelled: '<span class="badge badge-warning">отменён</span>',
  };
  return map[status] || esc(status);
}

function _rafflePrizeText(r) {
  const parts = [];
  if (r.prize_coins > 0) parts.push(`${r.prize_coins} ₡`);
  if (r.prize_description) parts.push(esc(r.prize_description));
  return parts.length ? parts.join(' + ') : '—';
}

function _raffleWinnersHtml(r) {
  if (r.status !== 'drawn' || !r.winners || !r.winners.length) return '';
  return `<div class="raffle-winners">
    <div class="raffle-winners-title">🏆 Победители</div>
    ${r.winners.map(w => `<div class="raffle-winner-row">${esc(w.operator_name || ('#' + w.operator_id))}${w.prize_coins ? ` · +${w.prize_coins} ₡` : ''}</div>`).join('')}
  </div>`;
}

async function renderRaffles() {
  const el = document.getElementById('view-raffles');
  if (!el) return;
  const admin = isAdmin(STATE.user?.role);
  el.innerHTML = uiLoadingBlock('Загрузка розыгрышей');
  try {
    if (admin) await renderRafflesAdmin(el);
    else await renderRafflesOperator(el);
  } catch (e) {
    el.innerHTML = `<div class="empty-state">Не удалось загрузить: ${esc(e.message || e)}</div>`;
  }
}

/* ── Оператор ─────────────────────────────────────────── */
async function renderRafflesOperator(el) {
  const data = await swrFetch(
    'raffles:me',
    () => api.getMyRaffles(),
    () => { if (STATE.currentView === 'raffles' && !isAdmin(STATE.user?.role)) renderRafflesOperator(el); },
    SWR_FAST_TTL_MS,
  );
  const tickets = data.raffle_tickets || 0;
  const raffles = data.raffles || [];
  const active = raffles.filter(r => r.status === 'active');
  const finished = raffles.filter(r => r.status !== 'active');

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Геймификация</div>
        <h1 class="section-title">Розыгрыши</h1>
      </div>
      <div class="raffle-tickets-badge">🎟 Мои билеты: <b>${tickets}</b></div>
    </div>
    <p class="panel-hint" style="margin:-4px 0 16px">Билеты можно выиграть в Колесе WOW. Вложите билеты в розыгрыш — чем больше билетов, тем выше шанс.</p>

    ${active.length ? `<div class="raffle-grid">${active.map(r => _raffleCardOperator(r, tickets)).join('')}</div>`
      : '<div class="empty-state">Сейчас нет активных розыгрышей</div>'}

    ${finished.length ? `<h3 class="panel-subtitle" style="margin-top:24px">Завершённые</h3>
      <div class="raffle-grid">${finished.map(r => _raffleCardOperator(r, tickets)).join('')}</div>` : ''}`;

  el.querySelectorAll('[data-enter-raffle]').forEach(btn => {
    btn.onclick = () => _openEnterRaffleModal(parseInt(btn.dataset.enterRaffle, 10), tickets);
  });
}

function _raffleCardOperator(r, myTickets) {
  const canEnter = r.status === 'active' && myTickets > 0;
  return `<div class="raffle-card ${r.status !== 'active' ? 'raffle-card-done' : ''}">
    <div class="raffle-card-head">
      <div class="raffle-card-title">${esc(r.title)}</div>
      ${_raffleStatusBadge(r.status)}
    </div>
    ${r.description ? `<div class="raffle-card-desc">${esc(r.description)}</div>` : ''}
    <div class="raffle-card-prize">Приз: <b>${_rafflePrizeText(r)}</b>${r.winners_count > 1 ? ` · ${r.winners_count} победителей` : ''}</div>
    <div class="raffle-card-meta">
      Участников: ${r.participants} · Билетов всего: ${r.total_tickets}
      ${r.ends_at ? ` · до ${fmtDateTime(r.ends_at)}` : ''}
    </div>
    ${r.my_tickets_in > 0 ? `<div class="raffle-card-mine">Вы вложили: ${r.my_tickets_in} билет(ов)</div>` : ''}
    ${_raffleWinnersHtml(r)}
    ${r.status === 'active' ? `<button class="btn-primary btn-sm" data-enter-raffle="${r.id}" ${canEnter ? '' : 'disabled'}>
      ${myTickets > 0 ? (r.my_tickets_in > 0 ? 'Добавить билеты' : 'Участвовать') : 'Нет билетов'}
    </button>` : ''}
  </div>`;
}

function _openEnterRaffleModal(raffleId, maxTickets) {
  showModal(`
    <h3 class="modal-title">Участие в розыгрыше</h3>
    <div class="form-group">
      <label class="form-label">Сколько билетов вложить? <span class="hint">(доступно: ${maxTickets})</span></label>
      <input id="raffle-enter-tickets" class="form-input" type="number" min="1" max="${maxTickets}" value="1">
    </div>
    <div id="raffle-enter-err" class="status-line"></div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" onclick="submitEnterRaffle(${raffleId})">Участвовать</button>
    </div>`);
}

async function submitEnterRaffle(raffleId) {
  const input = document.getElementById('raffle-enter-tickets');
  const errEl = document.getElementById('raffle-enter-err');
  const tickets = parseInt(input?.value, 10);
  if (!tickets || tickets < 1) { if (errEl) errEl.textContent = 'Укажите число билетов'; return; }
  try {
    await api.enterRaffle(raffleId, tickets);
    swrInvalidate('raffles:');
    swrInvalidate('wheel:');
    showToast('Вы в игре! Удачи 🍀', 'ok');
    closeModal();
    renderRaffles();
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}

/* ── Админ ────────────────────────────────────────────── */
async function renderRafflesAdmin(el) {
  const raffles = await swrFetch(
    'raffles:admin',
    () => api.listRafflesAdmin(),
    () => { if (STATE.currentView === 'raffles' && isAdmin(STATE.user?.role)) renderRafflesAdmin(el); },
    SWR_FAST_TTL_MS,
  );
  const active = raffles.filter(r => r.status === 'active');
  const finished = raffles.filter(r => r.status !== 'active');

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Геймификация</div>
        <h1 class="section-title">Розыгрыши</h1>
      </div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="renderRaffles()">Обновить</button>
        <button class="btn-primary" onclick="openCreateRaffleModal()">+ Новый розыгрыш</button>
      </div>
    </div>
    <p class="panel-hint" style="margin:-4px 0 16px">Участники вкладывают билеты, выигранные в Колесе WOW. Тираж можно запустить вручную или он пройдёт автоматически по дате окончания.</p>

    ${active.length ? `<div class="raffle-grid">${active.map(_raffleCardAdmin).join('')}</div>`
      : '<div class="empty-state">Нет активных розыгрышей</div>'}

    ${finished.length ? `<h3 class="panel-subtitle" style="margin-top:24px">Архив</h3>
      <div class="raffle-grid">${finished.map(_raffleCardAdmin).join('')}</div>` : ''}`;

  el.querySelectorAll('[data-draw-raffle]').forEach(btn => {
    btn.onclick = async () => {
      const confirmed = await uiConfirmAction({
        title: 'Запустить тираж сейчас?',
        description: 'Победители будут определены окончательно. Отменить результат после запуска нельзя.',
        confirmLabel: 'Запустить тираж',
      });
      if (!confirmed) return;
      try { await api.drawRaffle(parseInt(btn.dataset.drawRaffle, 10)); swrInvalidate('raffles:'); showToast('Розыгрыш проведён', 'ok'); renderRaffles(); }
      catch (e) { showToast(e.message, 'error'); }
    };
  });
  el.querySelectorAll('[data-cancel-raffle]').forEach(btn => {
    btn.onclick = async () => {
      const confirmed = await uiConfirmAction({
        title: 'Отменить розыгрыш?',
        description: 'Розыгрыш будет закрыт, а вложенные билеты вернутся участникам.',
        confirmLabel: 'Отменить розыгрыш',
      });
      if (!confirmed) return;
      try { await api.cancelRaffle(parseInt(btn.dataset.cancelRaffle, 10)); swrInvalidate('raffles:'); showToast('Розыгрыш отменён', 'ok'); renderRaffles(); }
      catch (e) { showToast(e.message, 'error'); }
    };
  });
}

function _raffleCardAdmin(r) {
  return `<div class="raffle-card ${r.status !== 'active' ? 'raffle-card-done' : ''}">
    <div class="raffle-card-head">
      <div class="raffle-card-title">${esc(r.title)}</div>
      ${_raffleStatusBadge(r.status)}
    </div>
    ${r.description ? `<div class="raffle-card-desc">${esc(r.description)}</div>` : ''}
    <div class="raffle-card-prize">Приз: <b>${_rafflePrizeText(r)}</b> · победителей: ${r.winners_count}</div>
    <div class="raffle-card-meta">
      Участников: ${r.participants} · Билетов всего: ${r.total_tickets}
      ${r.ends_at ? ` · до ${fmtDateTime(r.ends_at)}` : ''}
      ${r.drawn_at ? ` · разыгран ${fmtDateTime(r.drawn_at)}` : ''}
    </div>
    ${_raffleWinnersHtml(r)}
    ${r.status === 'active' ? `<div class="raffle-card-actions">
      <button class="btn-primary btn-sm" data-draw-raffle="${r.id}" ${r.participants > 0 ? '' : 'disabled'}>Разыграть сейчас</button>
      <button class="btn-danger btn-sm" data-cancel-raffle="${r.id}">Отменить</button>
    </div>` : ''}
  </div>`;
}

function openCreateRaffleModal() {
  showModal(`
    <h3 class="modal-title">Новый розыгрыш</h3>
    <div class="form-group"><label class="form-label">Название</label>
      <input id="nr-title" class="form-input" placeholder="Например: Розыгрыш сертификата"></div>
    <div class="form-group"><label class="form-label">Описание <span class="hint">(необязательно)</span></label>
      <input id="nr-desc" class="form-input" placeholder="Условия, детали приза"></div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Приз в коинах <span class="hint">(0 — без коинов)</span></label>
        <input id="nr-coins" class="form-input" type="number" min="0" value="0"></div>
      <div class="form-group"><label class="form-label">Число победителей</label>
        <input id="nr-winners" class="form-input" type="number" min="1" value="1"></div>
    </div>
    <div class="form-group"><label class="form-label">Приз (текст) <span class="hint">(если не коины)</span></label>
      <input id="nr-prize-desc" class="form-input" placeholder="Например: сертификат на 5000 ₸"></div>
    <div class="form-group"><label class="form-label">Дата окончания <span class="hint">(необязательно — иначе только вручную)</span></label>
      <input id="nr-ends" class="form-input" type="datetime-local"></div>
    <div id="nr-err" class="status-line"></div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" onclick="submitCreateRaffle()">Создать</button>
    </div>`);
}

async function submitCreateRaffle() {
  const title = document.getElementById('nr-title')?.value?.trim();
  const errEl = document.getElementById('nr-err');
  if (!title) { if (errEl) errEl.textContent = 'Укажите название'; return; }
  const payload = {
    title,
    description: document.getElementById('nr-desc')?.value?.trim() || '',
    prize_coins: parseInt(document.getElementById('nr-coins')?.value, 10) || 0,
    prize_description: document.getElementById('nr-prize-desc')?.value?.trim() || '',
    winners_count: parseInt(document.getElementById('nr-winners')?.value, 10) || 1,
    ends_at: document.getElementById('nr-ends')?.value || null,
  };
  try {
    await api.createRaffle(payload);
    swrInvalidate('raffles:');
    showToast('Розыгрыш создан', 'ok');
    closeModal();
    renderRaffles();
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}

window.renderRaffles = renderRaffles;
window.submitEnterRaffle = submitEnterRaffle;
window.openCreateRaffleModal = openCreateRaffleModal;
window.submitCreateRaffle = submitCreateRaffle;
