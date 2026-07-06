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

  const ticketCard = tickets > 0
    ? `<div class="wheel-ticket-badge wheel-ticket-have">
         <span class="wheel-ticket-count">${tickets}</span>
         <span>${tickets === 1 ? 'доступная прокрутка' : 'доступных прокруток'}</span>
         ${status.next_ticket_reason ? `<div class="wheel-ticket-reason">Причина: ${esc(status.next_ticket_reason)}</div>` : ''}
       </div>`
    : `<div class="wheel-ticket-badge wheel-ticket-none">
         <strong>У вас пока нет доступных прокруток.</strong>
         <div class="wheel-hint">Как получить билет:<br>• выполнить дневную цель (эффективность, норма часов, без опозданий);<br>• попасть в топ-3 рейтинга;<br>• получить билет от супервайзера.</div>
       </div>`;

  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Геймификация</div>
        <h2 class="section-title">Wheel of WOW</h2>
      </div>
      <div class="wheel-limits">
        <span title="Прокруток сегодня">Сегодня: ${status.spins_used_today}/${status.max_spins_per_day || '∞'}</span>
        <span title="Прокруток за неделю">Неделя: ${status.spins_used_this_week}/${status.max_spins_per_week || '∞'}</span>
      </div>
    </div>

    <div class="wheel-layout">
      <div class="panel wheel-stage-panel">
        <div class="wheel-stage">
          <div class="wheel-pointer" aria-hidden="true">
            <svg viewBox="0 0 40 52" width="38" height="49" xmlns="http://www.w3.org/2000/svg">
              <defs><linearGradient id="wheelPinG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#FDE68A"/><stop offset="1" stop-color="#F59E0B"/>
              </linearGradient></defs>
              <path d="M20 50 L5 21 A15 15 0 1 1 35 21 Z" fill="url(#wheelPinG)" stroke="#B45309" stroke-width="2"/>
              <circle cx="20" cy="18" r="5.5" fill="#fff" opacity=".92"/>
            </svg>
          </div>
          <div class="wheel-rotor" id="wheel-rotor">${buildWheelSvg(items)}</div>
          <div class="wheel-hub">WOW</div>
        </div>
        <div class="wheel-controls">
          ${ticketCard}
          <button class="btn-primary wheel-spin-btn" id="wheel-spin-btn" ${canSpin ? '' : 'disabled'}>
            ${canSpin ? 'Крутить колесо' : esc(cannotReason)}
          </button>
        </div>
      </div>

      <div class="panel wheel-history-panel">
        <h3 class="panel-title">🏆 Мои выигрыши</h3>
        <div id="wheel-history-body">${buildWheelHistory(history.items || [])}</div>
      </div>
    </div>`;

  // Раскладываем сектора по кругу для дальнейшего расчёта угла остановки
  STATE.wheel = { items, rotation: 0, spinning: false };

  const btn = document.getElementById('wheel-spin-btn');
  if (btn && canSpin) btn.onclick = () => doWheelSpin(el);
}

// Резервная палитра, если у приза не задан цвет
const WHEEL_FALLBACK_COLORS = ['#38BDF8', '#818CF8', '#A78BFA', '#F472B6', '#FB7185', '#FBBF24', '#34D399', '#22D3EE'];

// hex -> {r,g,b}
function wheelHexRgb(hex) {
  const h = String(hex || '').trim().replace('#', '');
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(s || '38bdf8', 16);
  if (Number.isNaN(n)) return { r: 56, g: 189, b: 248 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
// Осветлить (pct>0) или затемнить (pct<0) цвет — для объёмного градиента
function wheelShade(hex, pct) {
  const { r, g, b } = wheelHexRgb(hex);
  const t = pct < 0 ? 0 : 255;
  const p = Math.abs(pct);
  const mix = (c) => Math.round((t - c) * p + c);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
// Контрастный цвет подписи, чтобы читалась на любом секторе
function wheelTextColor(hex) {
  const { r, g, b } = wheelHexRgb(hex);
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.62 ? '#1E293B' : '#FFFFFF';
}

// Строит SVG-колесо: N равных секторов с объёмом, золотым ободом и читаемыми подписями
function buildWheelSvg(items) {
  const n = items.length;
  const cx = 160, cy = 160;
  const rOuter = 158; // внешний золотой обод
  const rSeg = 148;   // радиус секторов
  const seg = 360 / n;
  let defs = '';
  let paths = '';
  let labels = '';
  let lights = '';

  for (let i = 0; i < n; i++) {
    const base = items[i].color || WHEEL_FALLBACK_COLORS[i % WHEEL_FALLBACK_COLORS.length];
    const a0 = i * seg, a1 = (i + 1) * seg;
    const p0 = wheelPoint(cx, cy, rSeg, a0);
    const p1 = wheelPoint(cx, cy, rSeg, a1);
    const large = seg > 180 ? 1 : 0;
    defs += `<radialGradient id="wheelSeg${i}" cx="50%" cy="50%" r="72%">`
      + `<stop offset="0%" stop-color="${wheelShade(base, 0.30)}"/>`
      + `<stop offset="62%" stop-color="${base}"/>`
      + `<stop offset="100%" stop-color="${wheelShade(base, -0.16)}"/>`
      + `</radialGradient>`;
    paths += `<path d="M${cx},${cy} L${p0.x.toFixed(2)},${p0.y.toFixed(2)} A${rSeg},${rSeg} 0 ${large} 1 ${p1.x.toFixed(2)},${p1.y.toFixed(2)} Z" fill="url(#wheelSeg${i})" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>`;
    // Подпись всегда вертикально (не вверх ногами), крупно и читаемо
    const mid = a0 + seg / 2;
    const lp = wheelPoint(cx, cy, rSeg * 0.64, mid);
    const icon = WHEEL_PRIZE_ICON[items[i].type] || '★';
    const short = items[i].type === 'coins' ? `+${items[i].amount}` : icon;
    labels += `<text x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="20" font-weight="800" fill="${wheelTextColor(base)}" style="paint-order:stroke;stroke:rgba(15,23,42,.16);stroke-width:.6px;">${esc(short)}</text>`;
  }

  // Лампочки по ободу — «казино»-эффект
  const nLights = n * 2;
  for (let i = 0; i < nLights; i++) {
    const lpt = wheelPoint(cx, cy, rSeg + 5.5, i * 360 / nLights);
    lights += `<circle cx="${lpt.x.toFixed(1)}" cy="${lpt.y.toFixed(1)}" r="2.6" fill="#FFFFFF" opacity=".9"/>`;
  }

  return `<svg viewBox="0 0 320 320" class="wheel-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      ${defs}
      <radialGradient id="wheelRim" cx="50%" cy="35%" r="75%">
        <stop offset="0%" stop-color="#FDE68A"/>
        <stop offset="45%" stop-color="#F59E0B"/>
        <stop offset="100%" stop-color="#B45309"/>
      </radialGradient>
      <radialGradient id="wheelGloss" cx="50%" cy="26%" r="72%">
        <stop offset="0%" stop-color="rgba(255,255,255,.5)"/>
        <stop offset="38%" stop-color="rgba(255,255,255,.08)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="url(#wheelRim)"/>
    <circle cx="${cx}" cy="${cy}" r="${rSeg + 2}" fill="#0f172a" opacity=".08"/>
    ${paths}
    ${lights}
    <circle cx="${cx}" cy="${cy}" r="${rSeg}" fill="url(#wheelGloss)" pointer-events="none"/>
    ${labels}
  </svg>`;
}

// Точка на окружности: угол в градусах, 0° = верх (12 часов), по часовой
function wheelPoint(cx, cy, r, deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildWheelHistory(rows) {
  if (!rows.length) return '<div class="wheel-history-empty"><span class="wheel-history-empty-emoji">🎁</span><p>Пока пусто.<br>Выиграйте первый приз!</p></div>';
  return `<ul class="wheel-history-list">${rows.map(r => `
    <li class="wheel-history-item">
      <span class="wheel-history-icon">${WHEEL_PRIZE_ICON[r.prize_type] || '★'}</span>
      <span class="wheel-history-main">
        <strong>${esc(r.prize)}</strong>
        ${r.reason ? `<span class="wheel-history-reason">${esc(r.reason)}</span>` : ''}
      </span>
      <span class="wheel-history-date">${esc(fmtDate(r.date))}</span>
    </li>`).join('')}</ul>`;
}

// Прокрутка: backend выбирает приз, frontend только докручивает колесо к нему
async function doWheelSpin(el) {
  const w = STATE.wheel;
  if (!w || w.spinning) return;
  const btn = document.getElementById('wheel-spin-btn');
  const rotor = document.getElementById('wheel-rotor');
  if (!rotor) return;

  w.spinning = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Крутим…'; }

  let result;
  try {
    result = await api.spinWheel();
    swrInvalidate('wheel:');
  } catch (err) {
    w.spinning = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Крутить колесо'; }
    showToast(err.message || 'Не удалось прокрутить колесо', 'error');
    return;
  }

  // Индекс выигранного сектора
  const idx = w.items.findIndex(p => p.id === result.prize.id);
  const n = w.items.length;
  const seg = 360 / n;
  const safeIdx = idx >= 0 ? idx : 0;
  // Центр сектора относительно верхней стрелки; докручиваем так, чтобы он встал наверх.
  const center = safeIdx * seg + seg / 2;
  const jitter = (Math.random() - 0.5) * seg * 0.5; // лёгкий разброс внутри сектора
  const spins = 5; // полных оборотов для эффекта
  const target = spins * 360 - center - jitter;
  const from = w.rotation % 360;
  const total = from + (spins * 360 - center - jitter - (from % 360));
  w.rotation = target;

  rotor.style.transition = 'transform 4.2s cubic-bezier(0.16, 1, 0.3, 1)';
  rotor.style.transform = `rotate(${target}deg)`;

  setTimeout(() => {
    w.spinning = false;
    showWheelResultModal(result);
    // Обновляем статус и историю без полной перерисовки колеса (оно уже стоит на призе)
    refreshWheelSidebar(el);
  }, 4400);
}

function showWheelResultModal(result) {
  const icon = WHEEL_PRIZE_ICON[result.prize.type] || '🎉';
  const html = `
    <div class="modal-overlay wheel-result-overlay" id="wheel-result-modal">
      <div class="modal-card wheel-result-card">
        <div class="wheel-result-icon">${icon}</div>
        <h3>Поздравляем!</h3>
        <p class="wheel-result-prize">${esc(result.prize.title)}</p>
        <p class="wheel-result-msg">${esc(result.message)}</p>
        ${result.reason ? `<p class="wheel-result-reason">Причина допуска: ${esc(result.reason)}</p>` : ''}
        ${result.prize.type === 'coins' ? '<p class="wheel-result-note">Коины уже добавлены на ваш баланс.</p>' : ''}
        <button class="btn-primary" onclick="document.getElementById('wheel-result-modal')?.remove()">Отлично</button>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function refreshWheelSidebar(el) {
  try {
    const [status, history] = await Promise.all([
      api.getWheelStatus(),
      api.getWheelMyHistory().catch(() => ({ items: [] })),
    ]);
    const histBody = document.getElementById('wheel-history-body');
    if (histBody) histBody.innerHTML = buildWheelHistory(history.items || []);
    const btn = document.getElementById('wheel-spin-btn');
    const tickets = status.available_tickets || 0;
    const canSpin = tickets > 0
      && (!status.max_spins_per_day || status.spins_used_today < status.max_spins_per_day)
      && (!status.max_spins_per_week || status.spins_used_this_week < status.max_spins_per_week);
    if (btn) {
      btn.disabled = !canSpin;
      btn.textContent = canSpin ? 'Крутить колесо' : (tickets > 0 ? 'Лимит на сегодня исчерпан' : 'Нет билетов');
      if (canSpin) btn.onclick = () => doWheelSpin(el);
    }
  } catch { /* тихо: колесо уже показало приз */ }
}

/* ---------- Супервайзер / руководитель ---------- */
let _wheelStaffTab = 'operations';

async function renderWheelStaffView(el) {
  if (!el.dataset.wheelRuleDelegated) {
    el.dataset.wheelRuleDelegated = '1';
    el.addEventListener('click', (event) => {
      const openRuleBtn = event.target.closest('#wr-open-create, [data-wheel-rule-open]');
      if (!openRuleBtn) return;
      event.preventDefault();
      const body = document.getElementById('wheel-staff-body');
      showWheelRuleModal(body);
    });
  }
  el.innerHTML = `
    <div class="view-header">
      <div>
        <div class="section-kicker">Геймификация</div>
        <h2 class="section-title">Wheel of WOW</h2>
      </div>
    </div>
    <div class="filter-tabs wheel-tabs">
        <button class="filter-tab ${_wheelStaffTab === 'campaign' ? 'active' : ''}" data-wheel-tab="campaign">Кампания</button>
        <button class="filter-tab ${_wheelStaffTab === 'prizes' ? 'active' : ''}" data-wheel-tab="prizes">Сектора</button>
        <button class="filter-tab ${_wheelStaffTab === 'operations' || _wheelStaffTab === 'tickets' || _wheelStaffTab === 'history' || _wheelStaffTab === 'stats' ? 'active' : ''}" data-wheel-tab="operations">Операции</button>
        <button class="filter-tab ${_wheelStaffTab === 'rules' ? 'active' : ''}" data-wheel-tab="rules">Правила</button>
        <button class="filter-tab ${_wheelStaffTab === 'logs' ? 'active' : ''}" data-wheel-tab="logs">Логи</button>
        <button class="filter-tab ${_wheelStaffTab === 'issue' ? 'active' : ''}" data-wheel-tab="issue">Выдать билет</button>
    </div>
    <div id="wheel-staff-body">${wheelLoadingPanel()}</div>`;

  el.querySelectorAll('[data-wheel-tab]').forEach(b => {
    b.onclick = () => { _wheelStaffTab = b.dataset.wheelTab; renderWheelStaffView(el); };
  });

  const body = document.getElementById('wheel-staff-body');
  if (_wheelStaffTab === 'campaign') {
    await renderWheelCampaignTab(body);
  } else if (_wheelStaffTab === 'prizes') {
    await renderWheelPrizesTab(body);
  } else if (_wheelStaffTab === 'operations' || _wheelStaffTab === 'tickets' || _wheelStaffTab === 'history' || _wheelStaffTab === 'stats') {
    _wheelStaffTab = 'operations';
    await renderWheelOperationsTab(body);
  } else if (_wheelStaffTab === 'issue') {
    await renderWheelIssueTab(body);
  } else if (_wheelStaffTab === 'stats') {
    await renderWheelStatsTab(body);
  } else if (_wheelStaffTab === 'rules') {
    await renderWheelRulesTab(body);
  } else if (_wheelStaffTab === 'logs') {
    await renderWheelLogsTab(body);
  } else {
    _wheelStaffTab = 'operations';
    await renderWheelOperationsTab(body);
  }
}

/* ---------- Стафф: кампания (ТЗ 11.1) ---------- */
let _wheelCampaignEditId = null;

const WHEEL_PRIZE_TYPES = [
  ['coins', 'Коины'], ['shop_discount', 'Скидка в магазине'], ['extra_ticket', 'Доп. билет'],
  ['badge', 'Бейдж'], ['spin_token', 'Ещё вращение'], ['manual_reward', 'Ручной приз'],
];

async function renderWheelCampaignTab(body) {
  const data = await wheelCachedFetch(
    'wheel:admin:campaigns',
    () => api.getWheelCampaigns(),
    { __fallback: true, items: [] },
    () => wheelRefreshIfTab('campaign', renderWheelCampaignTab, body),
    WHEEL_STATIC_TTL_MS
  );
  if (data.__fallback) {
    body.innerHTML = wheelLoadingPanel('Загрузка кампании');
    return;
  }
  const items = data.items || [];
  if (!items.length) {
    body.innerHTML = `
      <div class="panel wheel-admin-panel">
        <div class="panel-head"><h3>Кампания колеса</h3></div>
        <div class="wheel-admin-content">
          <div class="empty-state wheel-empty"><p>Кампаний пока нет.</p></div>
          <button class="btn-primary" id="wheel-camp-create">Создать кампанию</button>
        </div>
      </div>`;
    document.getElementById('wheel-camp-create').onclick = () => createDefaultCampaign(body);
    return;
  }

  const current = items.find(c => c.is_active) || items[0];
  _wheelCampaignEditId = current.id;

  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head">
        <div>
          <h3>Настройки кампании</h3>
          <p class="panel-hint">Глобальные настройки колеса, лимиты прокруток и срок жизни билетов.</p>
        </div>
        <span class="badge badge-ok">активно всегда</span>
      </div>
      <div class="wheel-admin-content">
        <div class="wheel-campaign-shell">
          <section class="wheel-campaign-main">
            <div class="wheel-campaign-title-card">
              <label class="form-group">
                <span class="form-label">Название</span>
                <input type="text" id="wc-title" class="form-input" value="${esc(current.title)}" maxlength="200">
              </label>
              <label class="form-group">
                <span class="form-label">Описание</span>
                <input type="text" id="wc-desc" class="form-input" value="${esc(current.description || '')}">
              </label>
            </div>
            <div class="form-grid wheel-campaign-grid">
              <label class="form-group">
                <span class="form-label">Прокруток в день</span>
                <input type="number" id="wc-day" class="form-input" min="0" max="50" value="${current.max_spins_per_day}">
              </label>
              <label class="form-group">
                <span class="form-label">Прокруток в неделю</span>
                <input type="number" id="wc-week" class="form-input" min="0" max="200" value="${current.max_spins_per_week}">
              </label>
              <label class="form-group">
                <span class="form-label">Билет действует</span>
                <input type="number" id="wc-ttl" class="form-input" min="1" max="90" value="${current.ticket_ttl_days}">
              </label>
            </div>
          </section>

          <aside class="wheel-campaign-side">
            <div class="wheel-campaign-status is-active">
              <span>Колесо активно всегда</span>
              <strong>${esc(current.title)}</strong>
            </div>
            <div class="wheel-campaign-summary">
              <div><span>${current.max_spins_per_day}</span><p>в день</p></div>
              <div><span>${current.max_spins_per_week}</span><p>в неделю</p></div>
              <div><span>${current.ticket_ttl_days}</span><p>дней билет</p></div>
            </div>
            <div class="wheel-campaign-actions">
              <button class="btn-primary" id="wc-save">Сохранить</button>
            </div>
            <div id="wc-status" class="status-line"></div>
          </aside>
        </div>
      </div>
    </div>`;

  document.getElementById('wc-save').onclick = async () => {
    const statusEl = document.getElementById('wc-status');
    const payload = {
      title: document.getElementById('wc-title').value.trim(),
      description: document.getElementById('wc-desc').value.trim(),
      max_spins_per_day: parseInt(document.getElementById('wc-day').value, 10) || 0,
      max_spins_per_week: parseInt(document.getElementById('wc-week').value, 10) || 0,
      ticket_ttl_days: parseInt(document.getElementById('wc-ttl').value, 10) || 3,
      is_active: true,
      start_date: null,
      end_date: null,
    };
    if (!payload.title) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Укажите название'; return; }
    try {
      await api.updateWheelCampaign(current.id, payload);
      swrInvalidate('wheel:admin:campaigns');
      showToast('Кампания сохранена', 'ok');
      renderWheelCampaignTab(body);
    } catch (err) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = err.message || 'Не удалось сохранить';
    }
  };
}

async function createDefaultCampaign(body) {
  try {
    const c = await api.createWheelCampaign({
      title: 'Wheel of WOW', description: '', is_active: true,
      max_spins_per_day: 1, max_spins_per_week: 3, ticket_ttl_days: 3,
    });
    swrInvalidate('wheel:admin:campaigns');
    _wheelCampaignEditId = c.id;
    showToast('Кампания создана', 'ok');
    renderWheelCampaignTab(body);
  } catch (err) {
    showToast(err.message || 'Не удалось создать кампанию', 'error');
  }
}

/* ---------- Стафф: сектора (ТЗ 11.2) ---------- */
async function renderWheelPrizesTab(body) {
  const data = await wheelCachedFetch(
    'wheel:admin:prizes',
    () => api.getWheelAdminPrizes(),
    { __fallback: true, items: [] },
    () => wheelRefreshIfTab('prizes', renderWheelPrizesTab, body),
    WHEEL_STATIC_TTL_MS
  );
  if (data.__fallback) {
    body.innerHTML = wheelLoadingPanel('Загрузка секторов');
    return;
  }
  const rows = data.items || [];
  const totalWeight = rows.filter(r => r.is_active).reduce((s, r) => s + (r.weight || 0), 0);
  const typeOptions = (val) => WHEEL_PRIZE_TYPES.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('');
  const chance = (w) => totalWeight > 0 ? Math.round((w / totalWeight) * 100) : 0;
  const typeOrder = new Map(WHEEL_PRIZE_TYPES.map(([value], index) => [value, index]));
  const groupedRows = [...rows]
    .sort((a, b) => {
      const typeDiff = (typeOrder.get(a.prize_type) ?? 999) - (typeOrder.get(b.prize_type) ?? 999);
      if (typeDiff) return typeDiff;
      if (Boolean(a.is_active) !== Boolean(b.is_active)) return a.is_active ? -1 : 1;
      const weightDiff = (b.weight || 0) - (a.weight || 0);
      if (weightDiff) return weightDiff;
      return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
    })
    .reduce((groups, row) => {
      let group = groups.find(item => item.type === row.prize_type);
      if (!group) {
        group = { type: row.prize_type, items: [] };
        groups.push(group);
      }
      group.items.push(row);
      return groups;
    }, []);
  const prizeRowHtml = (r) => `<tr data-prize-id="${r.id}">
            <td><input type="color" class="wp-color" value="${esc(r.color || '#38BDF8')}"></td>
            <td><input type="text" class="form-input wp-title" value="${esc(r.title)}"></td>
            <td><select class="form-input wp-type">${typeOptions(r.prize_type)}</select></td>
            <td><input type="number" class="form-input wp-amount" value="${r.amount}"></td>
            <td><input type="number" class="form-input wp-weight" value="${r.weight}" min="0"></td>
            <td><span class="wheel-chance">${chance(r.is_active ? r.weight : 0)}%</span></td>
            <td><input type="number" class="form-input wp-maxtotal" value="${r.max_wins_total}" min="0" title="0 — без лимита"></td>
            <td><input type="number" class="form-input wp-maxop" value="${r.max_wins_per_operator}" min="0" title="0 — без лимита"></td>
            <td style="text-align:center"><input type="checkbox" class="wp-active" ${r.is_active ? 'checked' : ''}></td>
            <td><button class="btn-outline btn-sm wp-save">Сохранить</button></td>
          </tr>`;
  const prizeGroupHtml = (group) => {
    const activeItems = group.items.filter(r => r.is_active);
    const groupWeight = activeItems.reduce((sum, r) => sum + (r.weight || 0), 0);
    const groupChance = totalWeight > 0 ? Math.round((groupWeight / totalWeight) * 100) : 0;
    const rawLabel = wheelPrizeTypeLabel(group.type) || group.type || 'Другое';
    const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
    return `<tr class="wheel-prize-group-row"><td colspan="10">
              <div class="wheel-prize-group-title">
                <span class="wheel-prize-group-name">${esc(label)}</span>
                <span class="wheel-prize-group-meta">${group.items.length} сектор(ов) · активных ${activeItems.length} · вес ${groupWeight} · шанс ${groupChance}%</span>
              </div>
            </td></tr>${group.items.map(prizeRowHtml).join('')}`;
  };

  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head">
        <h3>Сектора колеса</h3>
        <span class="panel-badge">${rows.length} · сумма весов ${totalWeight}</span>
      </div>
      <div class="wheel-admin-content">
        <div class="table-wrap wheel-prizes-wrap"><table class="data-table wheel-prizes-table">
          <colgroup>
            <col class="wp-col-color"><col class="wp-col-title"><col class="wp-col-type">
            <col class="wp-col-num"><col class="wp-col-num"><col class="wp-col-chance">
            <col class="wp-col-limit"><col class="wp-col-limit"><col class="wp-col-active"><col class="wp-col-action">
          </colgroup>
          <thead><tr><th>Цвет</th><th>Название</th><th>Тип</th><th>Кол-во</th><th>Вес</th><th title="Шанс выпадения">Шанс</th><th>Лимит всего</th><th>Лимит/оператор</th><th>Активен</th><th></th></tr></thead>
          <tbody>
          ${groupedRows.map(prizeGroupHtml).join('') || '<tr><td colspan="10" class="empty-line">Секторов пока нет</td></tr>'}
          </tbody>
        </table></div>
        <div class="wheel-newprize">
          <h4 class="panel-subtitle">Добавить сектор</h4>
          <div class="form-grid wheel-newprize-grid">
            <input type="text" id="np-title" class="form-input" placeholder="Название">
            <select id="np-type" class="form-input">${typeOptions('coins')}</select>
            <input type="number" id="np-amount" class="form-input" placeholder="Кол-во" value="1">
            <input type="number" id="np-weight" class="form-input" placeholder="Вес" value="10" min="0">
            <input type="color" id="np-color" value="#38BDF8">
            <button class="btn-primary" id="np-add">Добавить</button>
          </div>
          <div id="np-status" class="status-line" style="margin-top:8px"></div>
        </div>
        <div class="status-line muted" style="margin-top:10px">Сектор «ничего» запрещён (ТЗ п.6.3): минимальный приз — «+1 коин». Чтобы убрать сектор, выключите «Активен».</div>
      </div>
    </div>`;

  body.querySelectorAll('tr[data-prize-id]').forEach(tr => {
    const id = parseInt(tr.dataset.prizeId, 10);
    tr.querySelector('.wp-save').onclick = async () => {
      const payload = {
        title: tr.querySelector('.wp-title').value.trim(),
        prize_type: tr.querySelector('.wp-type').value,
        amount: parseInt(tr.querySelector('.wp-amount').value, 10) || 0,
        weight: parseInt(tr.querySelector('.wp-weight').value, 10) || 0,
        color: tr.querySelector('.wp-color').value,
        max_wins_total: parseInt(tr.querySelector('.wp-maxtotal').value, 10) || 0,
        max_wins_per_operator: parseInt(tr.querySelector('.wp-maxop').value, 10) || 0,
        is_active: tr.querySelector('.wp-active').checked,
      };
      if (!payload.title) { showToast('Укажите название сектора', 'error'); return; }
      try {
        await api.updateWheelPrize(id, payload);
        swrInvalidate('wheel:admin:prizes');
        swrInvalidate('wheel:prizes');
        showToast('Сектор сохранён', 'ok');
        renderWheelPrizesTab(body);
      } catch (err) { showToast(err.message || 'Не удалось сохранить', 'error'); }
    };
  });

  document.getElementById('np-add').onclick = async () => {
    const statusEl = document.getElementById('np-status');
    const payload = {
      title: document.getElementById('np-title').value.trim(),
      prize_type: document.getElementById('np-type').value,
      amount: parseInt(document.getElementById('np-amount').value, 10) || 0,
      weight: parseInt(document.getElementById('np-weight').value, 10) || 0,
      color: document.getElementById('np-color').value,
    };
    if (!payload.title) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Укажите название'; return; }
    try {
      await api.createWheelPrize(payload);
      swrInvalidate('wheel:admin:prizes');
      swrInvalidate('wheel:prizes');
      showToast('Сектор добавлен', 'ok');
      renderWheelPrizesTab(body);
    } catch (err) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = err.message || 'Не удалось добавить';
    }
  };
}

/* ---------- Стафф: билеты (ТЗ 12.3, 17) ---------- */
let _wheelTicketFilter = '';
async function renderWheelOperationsTab(body) {
  body.innerHTML = `<div class="panel wheel-admin-panel"><div class="empty-state"><div class="loading-spinner"></div></div></div>`;
  const ticketKey = `wheel:admin:tokens:${_wheelTicketFilter || 'all'}`;
  const rerender = () => wheelRefreshIfTab('operations', renderWheelOperationsTab, body);
  const [ticketsData, spinsData, stats] = await Promise.all([
    wheelCachedFetch(ticketKey, () => api.getWheelTokens(_wheelTicketFilter ? { token_status: _wheelTicketFilter, limit: 80 } : { limit: 80 }), { __fallback: true, items: [] }, rerender),
    wheelCachedFetch('wheel:admin:spins', () => api.getWheelSpins({ limit: 80 }), { __fallback: true, items: [] }, rerender),
    wheelCachedFetch('wheel:admin:stats', () => api.getWheelStats(), { __fallback: true, tokens_issued: 0, tokens_used: 0, tokens_expired: 0, spins_completed: 0, coins_awarded: 0, manual_granted: 0, prizes_histogram: [], top_sources: [] }, rerender),
  ]);

  const tickets = ticketsData.items || [];
  const spins = spinsData.items || [];
  const statusBadge = { available: 'badge-ok', used: 'badge-muted', expired: 'badge-warning', cancelled: 'badge-muted' };
  const statusLabel = { available: 'доступен', used: 'использован', expired: 'истёк', cancelled: 'отменён' };
  const filters = [['', 'Все'], ['available', 'Доступные'], ['used', 'Использованные'], ['expired', 'Истёкшие'], ['cancelled', 'Отменённые']];
  const uniqueOperators = new Set(spins.map(r => r.operator_id).filter(Boolean)).size;

  body.innerHTML = `
    <div class="wheel-ops-shell">
      <div class="wheel-ops-hero">
        <div>
          <div class="section-kicker">Операции</div>
          <h3>Билеты, прокрутки и статистика</h3>
          <p>Единый контроль попыток Wheel of WOW без переключения между отдельными экранами.</p>
        </div>
        <button class="btn-primary" data-wheel-go-issue>Выдать билет</button>
      </div>

      <div class="wheel-metric-grid">
        <div class="wheel-metric"><span>${stats?.tokens_issued ?? 0}</span><p>попыток выдано сегодня</p></div>
        <div class="wheel-metric"><span>${stats?.tokens_used ?? 0}</span><p>использовано</p></div>
        <div class="wheel-metric"><span>${stats?.spins_completed ?? 0}</span><p>прокруток сегодня</p></div>
        <div class="wheel-metric"><span>${stats?.coins_awarded ?? 0}</span><p>коинов выдано</p></div>
        <div class="wheel-metric"><span>${uniqueOperators}</span><p>участников в истории</p></div>
      </div>

      <div class="wheel-ops-grid">
        <section class="panel wheel-admin-panel">
          <div class="panel-head">
            <h3>Билеты</h3>
            <span class="panel-badge">${tickets.length}</span>
          </div>
          <div class="wheel-admin-content">
            <div class="filter-tabs wheel-subtabs">
              ${filters.map(([f, l]) => `<button class="filter-tab ${_wheelTicketFilter === f ? 'active' : ''}" data-ticket-filter="${f}">${l}</button>`).join('')}
            </div>
            ${tickets.length ? `<div class="table-wrap wheel-table-wrap"><table class="data-table">
              <thead><tr><th>Оператор</th><th>Причина</th><th>Истекает</th><th>Статус</th></tr></thead>
              <tbody>${tickets.map(t => `<tr>
                <td class="name-cell"><strong>${esc(t.operator_name)}</strong><div class="muted-sm">${esc(fmtDateTime(t.created_at))}</div></td>
                <td>${esc(t.reason_text || wheelSourceLabel(t.reason_type) || '—')}<div class="muted-sm">${esc(wheelSourceLabel(t.reason_type))}</div></td>
                <td>${t.expires_at ? esc(fmtDateTime(t.expires_at)) : '—'}</td>
                <td><span class="badge ${statusBadge[t.status] || 'badge-muted'}">${statusLabel[t.status] || t.status}</span></td>
              </tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty-state wheel-empty"><p>Билетов пока нет.</p></div>'}
          </div>
        </section>

        <section class="panel wheel-admin-panel">
          <div class="panel-head">
            <h3>История прокруток</h3>
            <span class="panel-badge">${spins.length}</span>
          </div>
          <div class="wheel-admin-content">
            ${spins.length ? `<div class="table-wrap wheel-table-wrap"><table class="data-table">
              <thead><tr><th>Оператор</th><th>Приз</th><th>Причина</th><th>Дата</th></tr></thead>
              <tbody>${spins.map(r => `<tr>
                <td class="name-cell"><strong>${esc(r.operator_name)}</strong><div class="muted-sm">${esc(r.group_name || '—')}</div></td>
                <td><span class="wheel-type-pill">${esc(wheelPrizeTypeLabel(r.prize_type))}</span><div><strong>${esc(r.prize)}</strong></div></td>
                <td>${esc(r.reason || '—')}</td>
                <td>${esc(fmtDateTime(r.date))}</td>
              </tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty-state wheel-empty"><p>Прокруток пока нет.</p></div>'}
          </div>
        </section>
      </div>

      <section class="panel wheel-admin-panel">
        <div class="panel-head"><h3>Статистика по призам и источникам</h3></div>
        <div class="wheel-admin-content">
          <div class="two-col-grid">
            <div>
              <h4 class="panel-subtitle">Частота призов</h4>
              ${(stats?.prizes_histogram || []).length ? `<div class="wheel-chip-list">${stats.prizes_histogram.map(h => `<span class="wheel-data-chip"><strong>${esc(h.title)}</strong>${h.count}</span>`).join('')}</div>` : '<div class="empty-line">Прокруток сегодня нет</div>'}
            </div>
            <div>
              <h4 class="panel-subtitle">Источники попыток</h4>
              ${(stats?.top_sources || []).length ? `<div class="wheel-chip-list">${stats.top_sources.map(x => `<span class="wheel-data-chip"><strong>${esc(wheelSourceLabel(x.reason_type))}</strong>${x.count}</span>`).join('')}</div>` : '<div class="empty-line">Токенов сегодня не выдавалось</div>'}
            </div>
          </div>
        </div>
      </section>
    </div>`;

  body.querySelectorAll('[data-ticket-filter]').forEach(b => {
    b.onclick = () => { _wheelTicketFilter = b.dataset.ticketFilter; renderWheelOperationsTab(body); };
  });
  const issueBtn = body.querySelector('[data-wheel-go-issue]');
  if (issueBtn) issueBtn.onclick = () => { _wheelStaffTab = 'issue'; renderWheelStaffView(document.getElementById('view-wheel')); };
}

async function renderWheelTicketsTab(body) {
  let data;
  try {
    data = await api.getWheelTokens(_wheelTicketFilter ? { token_status: _wheelTicketFilter, limit: 300 } : { limit: 300 });
  } catch (err) {
    body.innerHTML = `<div class="panel"><div class="status-line status-error">${esc(err.message)}</div></div>`;
    return;
  }
  const rows = data.items || [];
  const statusBadge = { available: 'badge-ok', used: 'badge-muted', expired: 'badge-warning', cancelled: 'badge-muted' };
  const statusLabel = { available: 'доступен', used: 'использован', expired: 'истёк', cancelled: 'отменён' };
  const filters = [['', 'Все'], ['available', 'Доступные'], ['used', 'Использованные'], ['expired', 'Истёкшие'], ['cancelled', 'Отменённые']];

  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head"><h3>Билеты</h3><span class="panel-badge">${rows.length}</span></div>
      <div class="wheel-admin-content">
        <div class="filter-tabs" style="margin-bottom:14px">
          ${filters.map(([f, l]) => `<button class="filter-tab ${_wheelTicketFilter === f ? 'active' : ''}" data-ticket-filter="${f}">${l}</button>`).join('')}
        </div>
        ${rows.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Создан</th><th>Оператор</th><th>Причина</th><th>Источник</th><th>Истекает</th><th>Использован</th><th>Статус</th></tr></thead>
          <tbody>${rows.map(t => `<tr>
            <td>${esc(fmtDateTime(t.created_at))}</td>
            <td class="name-cell">${esc(t.operator_name)}</td>
            <td>${esc(t.reason_text || '—')}</td>
            <td>${esc(wheelSourceLabel(t.reason_type))}</td>
            <td>${t.expires_at ? esc(fmtDateTime(t.expires_at)) : '—'}</td>
            <td>${t.used_at ? esc(fmtDateTime(t.used_at)) : '—'}</td>
            <td><span class="badge ${statusBadge[t.status] || 'badge-muted'}">${statusLabel[t.status] || t.status}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty-state wheel-empty"><p>Билетов пока нет.</p></div>'}
      </div>
    </div>`;

  body.querySelectorAll('[data-ticket-filter]').forEach(b => {
    b.onclick = () => { _wheelTicketFilter = b.dataset.ticketFilter; renderWheelTicketsTab(body); };
  });
}

async function renderWheelSpinsTab(body) {
  let data;
  try {
    data = await api.getWheelSpins({ limit: 200 });
  } catch (err) {
    body.innerHTML = `<div class="panel"><div class="status-line status-error">${esc(err.message)}</div></div>`;
    return;
  }
  const rows = data.items || [];
  const totalCoins = rows.filter(r => r.prize_type === 'coins').reduce((s, r) => s + (r.amount || 0), 0);
  const uniqueOperators = new Set(rows.map(r => r.operator_id).filter(Boolean)).size;
  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head">
        <h3>История прокруток</h3>
        <span class="panel-badge">${rows.length} записей</span>
      </div>
      <div class="wheel-admin-content">
        <div class="wheel-stats-row">
          <div class="wheel-stat"><span class="wheel-stat-num">${rows.length}</span><span>прокруток</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${totalCoins}</span><span>коинов выдано</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${uniqueOperators}</span><span>участников</span></div>
        </div>
        ${rows.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Дата</th><th>Оператор</th><th>Группа</th><th>Причина</th><th>Приз</th><th>Тип</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td>${esc(fmtDateTime(r.date))}</td>
            <td class="name-cell">${esc(r.operator_name)}</td>
            <td>${esc(r.group_name || '—')}</td>
            <td>${esc(r.reason || '—')}</td>
            <td><strong>${esc(r.prize)}</strong></td>
            <td><span class="wheel-type-pill">${esc(wheelPrizeTypeLabel(r.prize_type))}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty-state wheel-empty"><p>Прокруток пока нет.</p></div>'}
      </div>
    </div>`;
}

/* ---------- Стафф: статистика (ТЗ 16) ---------- */
async function renderWheelStatsTab(body) {
  let s;
  try {
    s = await api.getWheelStats();
  } catch (err) {
    body.innerHTML = `<div class="panel"><div class="status-line status-error">${esc(err.message)}</div></div>`;
    return;
  }
  const hist = s.prizes_histogram || [];
  const src = s.top_sources || [];
  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head"><h3>Статистика за сегодня</h3></div>
      <div class="wheel-admin-content">
        <div class="wheel-stats-row">
          <div class="wheel-stat"><span class="wheel-stat-num">${s.tokens_issued}</span><span>выдано попыток</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${s.tokens_used}</span><span>использовано</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${s.tokens_expired}</span><span>сгорело</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${s.coins_awarded}</span><span>коинов выдано</span></div>
          <div class="wheel-stat"><span class="wheel-stat-num">${s.manual_granted}</span><span>выдано вручную</span></div>
        </div>
        <div class="two-col-grid">
          <div>
            <h4 class="panel-subtitle">Частота призов</h4>
            ${hist.length ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Приз</th><th>Раз</th></tr></thead>
              <tbody>${hist.map(h => `<tr><td>${esc(h.title)}</td><td><strong>${h.count}</strong></td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty-line">Прокруток сегодня нет</div>'}
          </div>
          <div>
            <h4 class="panel-subtitle">Топ источников попыток</h4>
            ${src.length ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Источник</th><th>Токенов</th></tr></thead>
              <tbody>${src.map(x => `<tr><td>${esc(wheelSourceLabel(x.reason_type))}</td><td><strong>${x.count}</strong></td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty-line">Токенов сегодня не выдавалось</div>'}
          </div>
        </div>
      </div>
    </div>`;
}

function wheelSourceLabel(t) {
  return {
    tests: 'Тесты', period_reports: 'Расчёт периода', missions: 'Миссии',
    test_score: 'Тест дня', test_passed: 'Тест', simulation_passed: 'Симуляция',
    quality_score: 'Качество', no_late: 'Без опозданий', no_violations: 'Без нарушений',
    efficiency_percent: 'Эффективность', work_hours_percent: 'Норма часов',
    rating_place: 'Рейтинг', manual: 'Вручную', manual_grant: 'Ручная выдача',
    extra_ticket: 'Приз колеса',
  }[t] || t;
}

/* ---------- Стафф: правила (ТЗ 15) ---------- */
const WHEEL_RULE_SOURCE_OPTIONS = [
  ['tests', 'Тесты'],
  ['period_reports', 'Расчёт периода'],
  ['missions', 'Миссии'],
  ['manual', 'Ручной источник'],
];
const WHEEL_RULE_METRIC_OPTIONS = [
  ['test_score', 'Результат теста'],
  ['quality_avg', 'Качество звонков'],
  ['late_minutes', 'Минуты опозданий'],
  ['efficiency_percent', 'Эффективность'],
  ['work_hours_percent', 'Норма часов'],
  ['rating_place', 'Место в рейтинге'],
  ['simulation_passed', 'Симуляция пройдена'],
  ['custom', 'Свой показатель'],
];

async function renderWheelRulesTab(body) {
  const data = await wheelCachedFetch(
    'wheel:admin:rules',
    () => api.getWheelRules(),
    { __fallback: true, items: [] },
    () => wheelRefreshIfTab('rules', renderWheelRulesTab, body),
    WHEEL_STATIC_TTL_MS
  );
  if (data.__fallback) {
    body.innerHTML = wheelLoadingPanel('Загрузка правил');
    return;
  }
  const rows = data.items || [];
  const opLabel = { gte: '≥', lte: '≤', eq: '=', between: 'между', is_true: 'да' };
  body.innerHTML = `
    <section class="panel wheel-admin-panel wheel-rules-panel">
      <div class="panel-head wheel-rules-head">
        <div>
          <h3>Правила выдачи попыток</h3>
          <p class="panel-hint">Условия, по которым операторы получают билеты Wheel of WOW.</p>
        </div>
        <div class="wheel-head-actions">
          <span class="panel-badge">${rows.length}</span>
          <button class="btn-primary btn-sm" id="wr-open-create" type="button" data-wheel-rule-open onclick="window.openWheelRuleModal?.(); return false;">Добавить правило</button>
        </div>
      </div>
      <div class="wheel-admin-content">
        ${rows.length ? `<div class="table-wrap wheel-table-wrap wheel-rules-table-wrap"><table class="data-table wheel-rules-table">
          <thead><tr><th>Правило</th><th>Источник</th><th>Условие</th><th>Период</th><th>Лимит</th><th>TTL</th><th>Статус</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td><strong>${esc(r.title)}</strong><div class="muted-sm">${esc(r.code)}</div></td>
            <td><span class="wheel-type-pill">${esc(wheelSourceLabel(r.source_module))}</span></td>
            <td>${esc(r.metric_key || r.rule_type)} ${esc(opLabel[r.operator] || r.operator)} ${esc(String(r.threshold_value))}${r.operator === 'between' && r.threshold_value_max != null ? '…' + esc(String(r.threshold_value_max)) : ''}</td>
            <td>${esc(r.period_type)}</td>
            <td>${r.max_tokens_per_period}</td>
            <td>${r.token_ttl_hours}ч</td>
            <td><span class="badge ${r.is_active ? 'badge-ok' : 'badge-muted'}">${r.is_active ? 'активно' : 'выкл'}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty-state wheel-empty"><p>Правил пока нет.</p></div>'}
      </div>
    </section>`;

  const btn = body.querySelector('#wr-open-create');
  if (btn) {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showWheelRuleModal(body);
    });
  }
}

function showWheelRuleModal(body) {
  document.getElementById('wheel-rule-modal')?.remove();
  const sourceOptions = WHEEL_RULE_SOURCE_OPTIONS.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  const metricOptions = WHEEL_RULE_METRIC_OPTIONS.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  const modal = document.createElement('div');
  modal.className = 'modal-overlay wheel-rule-modal-overlay';
  modal.id = 'wheel-rule-modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-card wheel-rule-modal" role="dialog" aria-modal="true" aria-labelledby="wheel-rule-modal-title">
      <div class="modal-head wheel-rule-modal-head">
        <div>
          <div class="section-kicker">Wheel of WOW</div>
          <h3 class="modal-title" id="wheel-rule-modal-title">Добавить правило</h3>
          <p class="panel-hint">Настройте условие, лимит и срок действия билета.</p>
        </div>
        <button class="modal-close" type="button" data-wheel-rule-close aria-label="Закрыть">×</button>
      </div>
      <div class="wheel-rule-modal-body">
        <div class="form-grid wheel-rule-modal-grid">
          <label class="form-group wheel-rule-wide">
            <span class="form-label">Название</span>
            <input id="wr-title" class="form-input" placeholder="Например: Тест дня 80%+">
          </label>
          <label class="form-group">
            <span class="form-label">Код</span>
            <input id="wr-code" class="form-input" placeholder="test_score_80">
          </label>
          <label class="form-group">
            <span class="form-label">Источник</span>
            <select id="wr-source" class="form-input">${sourceOptions}</select>
          </label>
          <label class="form-group">
            <span class="form-label">Показатель</span>
            <select id="wr-metric" class="form-input">${metricOptions}</select>
          </label>
          <label class="form-group">
            <span class="form-label">Оператор</span>
            <select id="wr-operator" class="form-input">
              <option value="gte">Больше или равно</option>
              <option value="lte">Меньше или равно</option>
              <option value="eq">Равно</option>
              <option value="between">Между</option>
              <option value="is_true">Да/истина</option>
            </select>
          </label>
          <label class="form-group">
            <span class="form-label">Порог</span>
            <input id="wr-threshold" class="form-input" type="number" step="0.01" value="80">
          </label>
          <label class="form-group">
            <span class="form-label">Верхний порог</span>
            <input id="wr-threshold-max" class="form-input" type="number" step="0.01" placeholder="для «между»">
          </label>
          <label class="form-group">
            <span class="form-label">Период</span>
            <select id="wr-period" class="form-input">
              <option value="daily">День</option>
              <option value="weekly">Неделя</option>
              <option value="monthly">Месяц</option>
              <option value="once">Один раз</option>
            </select>
          </label>
          <label class="form-group">
            <span class="form-label">Лимит билетов</span>
            <input id="wr-limit" class="form-input" type="number" min="0" value="1">
          </label>
          <label class="form-group">
            <span class="form-label">TTL, часов</span>
            <input id="wr-ttl" class="form-input" type="number" min="1" value="24">
          </label>
          <label class="form-group">
            <span class="form-label">Приоритет</span>
            <input id="wr-priority" class="form-input" type="number" value="0">
          </label>
          <label class="wheel-toggle-row wheel-rule-toggle">
            <span><strong>Активно</strong><small>Правило начнёт выдавать билеты после сохранения.</small></span>
            <input id="wr-active" type="checkbox" checked>
          </label>
          <label class="form-group wheel-rule-wide">
            <span class="form-label">Описание</span>
            <input id="wr-description" class="form-input" placeholder="Коротко поясните, за что выдаётся билет">
          </label>
        </div>
      </div>
      <div class="modal-actions wheel-rule-modal-actions">
        <button class="btn-outline" type="button" id="wr-fill-quality">Шаблон качества 90+</button>
        <span id="wr-status" class="status-line"></span>
        <button class="btn-outline" type="button" data-wheel-rule-close>Отмена</button>
        <button class="btn-primary" type="button" id="wr-create">Добавить правило</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelectorAll('[data-wheel-rule-close]').forEach(b => b.onclick = close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  const setVal = (id, value) => { const n = document.getElementById(id); if (n) n.value = value; };
  const titleEl = document.getElementById('wr-title');
  const codeEl = document.getElementById('wr-code');
  if (titleEl) titleEl.addEventListener('input', () => {
    if (codeEl && !codeEl.dataset.touched) {
      codeEl.value = titleEl.value.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 64);
    }
  });
  if (codeEl) codeEl.addEventListener('input', () => { codeEl.dataset.touched = '1'; });
  const tmpl = document.getElementById('wr-fill-quality');
  if (tmpl) tmpl.onclick = () => {
    setVal('wr-title', 'Качество звонков за период 90+');
    setVal('wr-code', 'quality_90');
    setVal('wr-source', 'period_reports');
    setVal('wr-metric', 'quality_avg');
    setVal('wr-operator', 'gte');
    setVal('wr-threshold', '90');
    setVal('wr-period', 'weekly');
    setVal('wr-ttl', '72');
    setVal('wr-description', 'Билет за высокое качество звонков по итогам периода');
    if (codeEl) codeEl.dataset.touched = '1';
  };
  const createBtn = document.getElementById('wr-create');
  if (createBtn) createBtn.onclick = async () => {
    const statusEl = document.getElementById('wr-status');
    const metric = document.getElementById('wr-metric').value;
    const payload = {
      title: document.getElementById('wr-title').value.trim(),
      code: document.getElementById('wr-code').value.trim(),
      description: document.getElementById('wr-description').value.trim(),
      source_module: document.getElementById('wr-source').value,
      rule_type: metric,
      metric_key: metric === 'custom' ? '' : metric,
      operator: document.getElementById('wr-operator').value,
      threshold_value: parseFloat(document.getElementById('wr-threshold').value || '0'),
      threshold_value_max: document.getElementById('wr-threshold-max').value ? parseFloat(document.getElementById('wr-threshold-max').value) : null,
      period_type: document.getElementById('wr-period').value,
      max_tokens_per_period: parseInt(document.getElementById('wr-limit').value, 10) || 0,
      token_ttl_hours: parseInt(document.getElementById('wr-ttl').value, 10) || 24,
      priority: parseInt(document.getElementById('wr-priority').value, 10) || 0,
      is_active: document.getElementById('wr-active').checked,
    };
    if (!payload.title || !payload.code) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = 'Укажите название и код правила';
      return;
    }
    createBtn.disabled = true;
    try {
      await api.createWheelRule(payload);
      swrInvalidate('wheel:admin:rules');
      showToast('Правило добавлено', 'ok');
      close();
      renderWheelRulesTab(body);
    } catch (err) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = err.message || 'Не удалось добавить правило';
    } finally {
      createBtn.disabled = false;
    }
  };
  setTimeout(() => titleEl?.focus(), 30);
}

window.openWheelRuleModal = function openWheelRuleModal() {
  showWheelRuleModal(document.getElementById('wheel-staff-body'));
};

if (!window.__pulsWheelRuleModalClickFix) {
  window.__pulsWheelRuleModalClickFix = true;
  document.addEventListener('click', (event) => {
    const btn = event.target?.closest?.('#wr-open-create, [data-wheel-rule-open]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    window.openWheelRuleModal();
  }, true);
}

/* ---------- Стафф: логи проверок (ТЗ 8.7, 15) ---------- */
async function renderWheelLogsTab(body) {
  const data = await wheelCachedFetch(
    'wheel:admin:logs',
    () => api.getWheelEvaluationLogs({ limit: 80 }),
    { __fallback: true, items: [] },
    () => wheelRefreshIfTab('logs', renderWheelLogsTab, body)
  );
  if (data.__fallback) {
    body.innerHTML = wheelLoadingPanel('Загрузка логов');
    return;
  }
  const rows = data.items || [];
  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head"><h3>Логи проверки условий</h3><span class="panel-badge">${rows.length}</span></div>
      <div class="wheel-admin-content">
        ${rows.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Дата</th><th>Оператор</th><th>Источник</th><th>Значение</th><th>Порог</th><th>Итог</th><th>Причина</th></tr></thead>
          <tbody>${rows.map(l => `<tr>
            <td>${esc(fmtDateTime(l.created_at))}</td>
            <td class="name-cell">${esc(l.operator_name)}</td>
            <td>${esc(l.source_module)}${l.source_entity_id ? ' #' + l.source_entity_id : ''}</td>
            <td>${l.metric_value != null ? esc(String(l.metric_value)) : '—'}</td>
            <td>${l.threshold_value != null ? esc(l.operator) + ' ' + esc(String(l.threshold_value)) : '—'}</td>
            <td><span class="badge ${l.is_eligible ? 'badge-ok' : 'badge-muted'}">${l.is_eligible ? 'выдан' : 'нет'}</span></td>
            <td>${esc(l.reason || '—')}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty-state wheel-empty"><p>Логов пока нет.</p></div>'}
      </div>
    </div>`;
}

async function renderWheelIssueTab(body) {
  // Загружаем операторов для поиска (ТЗ п.4.2 — searchable dropdown)
  let operators = STATE.adminOperators;
  if (!operators || !operators.length) {
    operators = await wheelCachedFetch(
      'wheel:operators',
      () => api.listOperators().catch(() => []),
      [],
      (fresh) => {
        STATE.adminOperators = fresh || [];
        wheelRefreshIfTab('issue', renderWheelIssueTab, body);
      },
      SWR_USER_TTL_MS
    );
    STATE.adminOperators = operators;
  }
  const active = (operators || []).filter(o => o.is_active !== false);

  body.innerHTML = `
    <div class="panel wheel-issue-panel">
      <div class="panel-head">
        <h3>Ручная выдача билета</h3>
        <span class="panel-badge">Staff</span>
      </div>
      <div class="wheel-admin-content">
      <div class="form-grid wheel-issue-grid">
        <label class="form-group">
          <span class="form-label">Оператор</span>
          <input type="text" id="wheel-op-search" class="form-input" placeholder="Поиск по имени, фамилии, группе…" autocomplete="off">
          <div id="wheel-op-results" class="wheel-op-results" hidden></div>
          <input type="hidden" id="wheel-op-id">
          <div id="wheel-op-chosen" class="wheel-op-chosen" hidden></div>
        </label>
        <label class="form-group">
          <span class="form-label">Причина</span>
          <input type="text" id="wheel-reason" class="form-input" placeholder="Например: помощь новому сотруднику" maxlength="500">
        </label>
        <label class="form-group">
          <span class="form-label">Срок действия, дней</span>
          <input type="number" id="wheel-ttl" class="form-input" min="1" max="30" value="3">
        </label>
      </div>
      <div class="wheel-issue-actions">
        <button class="btn-primary" id="wheel-issue-btn" disabled>Выдать билет</button>
      </div>
      <div id="wheel-issue-status" class="status-line" style="margin-top:10px"></div>
      </div>
    </div>`;

  const search = document.getElementById('wheel-op-search');
  const results = document.getElementById('wheel-op-results');
  const hidden = document.getElementById('wheel-op-id');
  const chosen = document.getElementById('wheel-op-chosen');
  const issueBtn = document.getElementById('wheel-issue-btn');

  function matches(o, q) {
    const hay = `${o.full_name || ''} ${o.group_name || o.group || ''}`.toLowerCase();
    return hay.includes(q);
  }
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { results.hidden = true; return; }
    const found = active.filter(o => matches(o, q)).slice(0, 8);
    results.innerHTML = found.length
      ? found.map(o => `<div class="wheel-op-option" data-op-id="${o.id}" data-op-name="${esc(o.full_name)}">
          <strong>${esc(o.full_name)}</strong><span>${esc(o.group_name || o.group || '')}</span></div>`).join('')
      : '<div class="wheel-op-empty">Не найдено</div>';
    results.hidden = false;
    results.querySelectorAll('[data-op-id]').forEach(opt => {
      opt.onclick = () => {
        hidden.value = opt.dataset.opId;
        chosen.textContent = `Выбран: ${opt.dataset.opName}`;
        chosen.hidden = false;
        results.hidden = true;
        search.value = opt.dataset.opName;
        issueBtn.disabled = false;
      };
    });
  };

  issueBtn.onclick = async () => {
    const operatorId = parseInt(hidden.value, 10);
    const reason = document.getElementById('wheel-reason').value.trim();
    const ttl = parseInt(document.getElementById('wheel-ttl').value, 10) || 3;
    const statusEl = document.getElementById('wheel-issue-status');
    if (!operatorId) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Выберите оператора'; return; }
    if (!reason) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Укажите причину'; return; }
    issueBtn.disabled = true;
    try {
      await api.issueWheelTicket({ operator_id: operatorId, reason_text: reason, ttl_days: ttl });
      swrInvalidate('wheel:');
      statusEl.className = 'status-line status-ok';
      statusEl.textContent = 'Билет выдан';
      showToast('Билет выдан', 'ok');
      document.getElementById('wheel-reason').value = '';
      chosen.hidden = true; hidden.value = ''; search.value = '';
    } catch (err) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = err.message || 'Не удалось выдать билет';
    } finally {
      issueBtn.disabled = false;
    }
  };
}

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

const TESTS_SWR_TTL_MS = 15_000; // короткий TTL — статус теста (открыт/просрочен) должен быстро актуализироваться

async function renderTestsOperatorView(el) {
  const myNavGen = STATE.navGen;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Тесты</div><h2 class="section-title">Мои тесты</h2></div>
      <button class="btn-outline btn-sm" onclick="renderTests()">Обновить</button>
    </div>
    <div id="tests-op-body"><div class="loading-state"><div class="loading-spinner"></div></div></div>`;

  let data;
  try {
    data = await swrFetch('tests:my', () => api.myTests(), null, TESTS_SWR_TTL_MS);
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
  const finished = items.filter(t => ['finished', 'expired'].includes(t.status));
  const upcoming = items.filter(t => t.status === 'upcoming');

  const body = el.querySelector('#tests-op-body');
  if (!items.length) {
    body.innerHTML = `<div class="empty-state"><p>Доступных тестов пока нет.</p></div>`;
    return;
  }

  body.innerHTML = `
    ${upcoming.length ? `<div class="rcard-title" style="margin-top:6px">Скоро откроются</div><div class="test-card-grid">${upcoming.map(testCardHtml).join('')}</div>` : ''}
    <div class="rcard-title" style="margin-top:18px">Доступные</div>
    ${available.length ? `<div class="test-card-grid">${available.map(testCardHtml).join('')}</div>` : `<div class="empty-line">Доступных тестов пока нет.</div>`}
    <div class="rcard-title" style="margin-top:18px">Завершённые / история</div>
    ${finished.length ? `<div class="test-card-grid">${finished.map(testCardHtml).join('')}</div>` : `<div class="empty-line">Вы пока не проходили тесты.</div>`}
  `;

  body.querySelectorAll('[data-test-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const testId = Number(btn.dataset.testId);
      const action = btn.dataset.testAction;
      if (action === 'start' || action === 'continue') openTestRunner(testId);
      if (action === 'result') openTestResultModal(btn.dataset.attemptId);
    });
  });
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
  const rewardLine = t.reward_type === 'none' ? '' :
    `<div class="test-card-row"><span>Награда</span><span>${t.reward_type.includes('coins') ? `до ${t.reward_coins} коинов` : ''}${t.reward_type.includes('points') ? ` ${t.reward_points} баллов` : ''}</span></div>`;

  let actionHtml = '';
  if (t.status === 'available') {
    actionHtml = `<button class="btn-primary btn-sm" data-test-action="start" data-test-id="${t.id}">Начать тест</button>`;
  } else if (t.status === 'in_progress') {
    actionHtml = `<button class="btn-primary btn-sm" data-test-action="continue" data-test-id="${t.id}">Продолжить</button>`;
  } else if (t.status === 'upcoming') {
    actionHtml = `<div class="test-card-disabled-note">Тест откроется ${fmtDateTime(t.opens_at)}</div>`;
  } else if (t.status === 'finished') {
    actionHtml = `<div class="test-card-result"><b>Результат:</b> ${t.correct_count} / ${t.questions_count} · <b>${fmtA(t.score_percent,0)}%</b></div>
      ${t.reward_coins_earned ? `<div class="test-card-result">+${t.reward_coins_earned} коинов</div>` : ''}
      <button class="btn-outline btn-sm" data-test-action="result" data-attempt-id="${t.attempt_id}">Подробнее</button>`;
  } else if (t.status === 'expired') {
    actionHtml = `<div class="test-card-disabled-note">Срок прохождения истёк</div>`;
  } else {
    actionHtml = `<div class="test-card-disabled-note">Недоступен</div>`;
  }

  return `<div class="test-card">
    <div class="test-card-head">
      <div class="test-card-title">${esc(t.title)}</div>
      ${testStatusBadge(t.status)}
    </div>
    ${t.description ? `<div class="test-card-desc">${esc(t.description)}</div>` : ''}
    <div class="test-card-meta">
      ${t.opens_at ? `<div class="test-card-row"><span>Открыт</span><span>${fmtDateTime(t.opens_at)}</span></div>` : ''}
      ${t.closes_at ? `<div class="test-card-row"><span>Закрывается</span><span>${fmtDateTime(t.closes_at)}</span></div>` : ''}
      <div class="test-card-row"><span>Время на прохождение</span><span>${t.time_limit_minutes} мин</span></div>
      <div class="test-card-row"><span>Вопросов</span><span>${t.questions_count}</span></div>
      ${rewardLine}
    </div>
    <div class="test-card-actions">${actionHtml}</div>
  </div>`;
}


/* ── Прохождение теста ────────────────────────────────────────── */
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
      answers: {},
      expiresAt: new Date(data.expires_at).getTime(),
    };
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
        answers: {},
        expiresAt: new Date(data.expires_at).getTime(),
      };
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
  const q = run.questions[run.currentIndex];
  const selected = run.answers[q.id] || [];

  el.innerHTML = `
    <div class="test-runner">
      <div class="test-runner-head">
        <div class="test-runner-title">${esc(run.testTitle)}</div>
        <div class="test-runner-timer" id="test-timer">--:--</div>
      </div>
      <div class="test-runner-progress">
        <div class="test-runner-progress-bar"><div class="test-runner-progress-fill" style="width:${Math.round((run.currentIndex+1)/run.questions.length*100)}%"></div></div>
        <div class="test-runner-progress-label">Вопрос ${run.currentIndex+1} из ${run.questions.length}</div>
      </div>
      <div class="test-runner-question">
        <div class="test-runner-question-text">${esc(q.question_text)}</div>
        <div class="test-runner-answers">
          ${q.answers.map(a => `
            <label class="test-runner-answer-row ${selected.includes(a.id) ? 'selected' : ''}">
              <input type="${q.question_type === 'multiple_choice' ? 'checkbox' : 'radio'}" name="test-answer" value="${a.id}" ${selected.includes(a.id) ? 'checked' : ''}>
              <span>${esc(a.answer_text)}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="test-runner-nav">
        <button class="btn-outline" id="test-nav-back" ${run.currentIndex === 0 ? 'disabled' : ''}>Назад</button>
        <div style="flex:1"></div>
        ${run.currentIndex < run.questions.length - 1
          ? '<button class="btn-primary" id="test-nav-next">Далее</button>'
          : '<button class="btn-primary" id="test-nav-finish">Завершить тест</button>'}
      </div>
    </div>`;

  el.querySelectorAll('input[name="test-answer"]').forEach(input => {
    input.addEventListener('change', () => {
      const answerId = Number(input.value);
      if (q.question_type === 'multiple_choice') {
        const set = new Set(run.answers[q.id] || []);
        if (input.checked) set.add(answerId); else set.delete(answerId);
        run.answers[q.id] = [...set];
      } else {
        run.answers[q.id] = [answerId];
      }
      el.querySelectorAll('.test-runner-answer-row').forEach(row => row.classList.remove('selected'));
      input.closest('.test-runner-answer-row').classList.add('selected');
      api.saveTestAnswer(run.attemptId, q.id, run.answers[q.id]).catch(() => {});
    });
  });

  el.querySelector('#test-nav-back')?.addEventListener('click', () => {
    run.currentIndex = Math.max(0, run.currentIndex - 1);
    renderTestRunnerScreen();
  });
  el.querySelector('#test-nav-next')?.addEventListener('click', () => {
    run.currentIndex = Math.min(run.questions.length - 1, run.currentIndex + 1);
    renderTestRunnerScreen();
  });
  el.querySelector('#test-nav-finish')?.addEventListener('click', () => finishTestRun());

  startTestTimer();
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
    _activeTestRun = null;
    swrInvalidate('tests:my'); // статус теста изменился (finished) — следующий заход в список не должен показать устаревшее "in_progress"
    renderTestResultScreen(result);
  } catch(e) {
    showToast(e.message || 'Не удалось завершить тест', 'error');
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
  return `<div class="test-result-card">
    <div class="test-result-title">${esc(result.test_title)}</div>
    <div class="test-result-grid">
      <div class="test-result-stat"><div class="test-result-stat-label">Правильных ответов</div><div class="test-result-stat-value">${result.correct_count} из ${result.questions_count}</div></div>
      <div class="test-result-stat"><div class="test-result-stat-label">Процент</div><div class="test-result-stat-value">${fmtA(result.score_percent,0)}%</div></div>
      <div class="test-result-stat"><div class="test-result-stat-label">Баллы</div><div class="test-result-stat-value">${fmtA(result.score_points,1)}</div></div>
      <div class="test-result-stat"><div class="test-result-stat-label">Статус</div><div class="test-result-stat-value">${passed === null ? '—' : (passed ? '<span class="badge badge-success">Пройден</span>' : '<span class="badge badge-danger">Не пройден</span>')}</div></div>
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
    <div class="rcard-title" style="margin-top:18px">Разбор ответов</div>
    ${result.questions.map(q => {
      const yourIds = (result.your_answers && result.your_answers[q.id]) || [];
      return `<div class="test-result-question">
        <div class="test-result-question-text">${esc(q.question_text)}</div>
        ${q.answers.map(a => {
          const wasSelected = yourIds.includes(a.id);
          const cls = a.is_correct ? 'correct' : (wasSelected ? 'incorrect' : '');
          return `<div class="test-result-answer-row ${cls}">${wasSelected ? '☑' : '☐'} ${esc(a.answer_text)}</div>`;
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

async function renderTestsStaffView(el) {
  const myNavGen = STATE.navGen;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Тесты</div><h2 class="section-title">Управление тестами</h2></div>
      <div class="header-right">
        <button class="btn-primary btn-sm" id="tests-new-btn">+ Новый тест</button>
        <button class="btn-outline btn-sm" onclick="renderTests()">Обновить</button>
      </div>
    </div>
    <div id="tests-staff-body"><div class="loading-state"><div class="loading-spinner"></div></div></div>`;

  el.querySelector('#tests-new-btn').addEventListener('click', () => openTestBuilder(null));

  let data;
  try {
    data = await swrFetch('tests:admin-list', () => api.listAdminTests(), null, TESTS_SWR_TTL_MS);
  } catch(e) {
    if (isNavStale(myNavGen)) return;
    el.querySelector('#tests-staff-body').innerHTML = `<div class="status-line status-error">${esc(e.message)}</div>`;
    return;
  }
  if (isNavStale(myNavGen)) return;

  const items = data.items || [];
  const body = el.querySelector('#tests-staff-body');
  if (!items.length) {
    body.innerHTML = `<div class="empty-state"><p>Тестов пока нет. Создайте первый тест.</p></div>`;
    return;
  }

  const statusLabel = { draft: 'Черновик', scheduled: 'Запланирован', open: 'Открыт', finished: 'Завершён', archived: 'Архив' };
  const statusBadgeClass = { draft: 'badge-neutral', scheduled: 'badge-info', open: 'badge-success', finished: 'badge-warning', archived: 'badge-neutral' };

  body.innerHTML = `<div class="table-wrap"><table class="data-table">
    <thead><tr>
      <th>Название</th><th>Статус</th><th>Автор</th><th>Открытие</th><th>Закрытие</th>
      <th class="num">Вопросов</th><th class="num">Прошли</th><th class="num">Средний %</th><th>Действия</th>
    </tr></thead>
    <tbody>
      ${items.map(t => `<tr>
        <td class="name-cell">${esc(t.title)}</td>
        <td><span class="badge ${statusBadgeClass[t.status]||'badge-neutral'}">${statusLabel[t.status]||t.status}</span></td>
        <td>${esc(t.created_by_name||'—')}</td>
        <td>${t.opens_at?fmtDateTime(t.opens_at):'—'}</td>
        <td>${t.closes_at?fmtDateTime(t.closes_at):'—'}</td>
        <td class="num">${t.questions_count}</td>
        <td class="num">${t.attempts_finished}</td>
        <td class="num">${t.average_percent!=null?t.average_percent+'%':'—'}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn-outline btn-sm" data-test-edit="${t.id}">Изменить</button>
            <button class="btn-outline btn-sm" data-test-results="${t.id}">Результаты</button>
            ${t.status==='draft'||t.status==='scheduled' ? `<button class="btn-primary btn-sm" data-test-publish="${t.id}">Опубликовать</button>` : ''}
            ${t.status==='open' ? `<button class="btn-outline btn-sm" data-test-close="${t.id}">Закрыть</button>` : ''}
          </div>
        </td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;

  body.querySelectorAll('[data-test-edit]').forEach(btn => btn.addEventListener('click', () => openTestBuilder(Number(btn.dataset.testEdit))));
  body.querySelectorAll('[data-test-results]').forEach(btn => btn.addEventListener('click', () => openTestResultsView(Number(btn.dataset.testResults))));
  body.querySelectorAll('[data-test-publish]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api.publishTest(Number(btn.dataset.testPublish));
      swrInvalidate('tests:'); // публикация меняет статус — сбрасываем и admin-list, и операторский my-list
      showToast('Тест опубликован', 'ok');
      renderTests();
    }
    catch(e) { showToast(e.message, 'error'); }
  }));
  body.querySelectorAll('[data-test-close]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api.closeTest(Number(btn.dataset.testClose));
      swrInvalidate('tests:');
      showToast('Тест закрыт', 'ok');
      renderTests();
    }
    catch(e) { showToast(e.message, 'error'); }
  }));
}

/* ── Конструктор теста ────────────────────────────────────────── */
let _testBuilderState = null; // { testId, test, questions: [...], assignTargetType, assignTargetIds }

async function openTestBuilder(testId) {
  const el = document.getElementById('view-tests');
  if (!el) return;

  let test = null;
  let questions = [];
  if (testId) {
    try {
      const list = await api.listAdminTests();
      test = (list.items || []).find(t => t.id === testId);
    } catch(e) { /* fallthrough — test stays null, builder treats as new */ }
  }

  _testBuilderState = {
    testId: testId,
    title: test?.title || '',
    description: '',
    instruction: '',
    time_limit_minutes: test?.time_limit_minutes || 30,
    opens_at: utcISOStringToLocalDateTimeInput(test?.opens_at),
    closes_at: utcISOStringToLocalDateTimeInput(test?.closes_at),
    passing_percent: 70,
    show_result_after_finish: true,
    show_correct_answers: false,
    allow_retake: false,
    max_attempts: 1,
    reward_type: 'none',
    reward_points: 0,
    reward_coins: 0,
    reward_min_percent: 70,
    reward_mode: 'fixed',
    questions: [],
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
    <div class="view-header">
      <div><div class="section-kicker">Тесты</div><h2 class="section-title">${s.testId ? 'Редактирование теста' : 'Новый тест'}</h2></div>
      <button class="btn-outline btn-sm" onclick="renderTests()">К списку</button>
    </div>
    ${isOpen ? '<div class="status-line status-error" style="margin-bottom:14px">Тест уже открыт — можно изменить только дату закрытия и назначение.</div>' : ''}
    <div class="test-builder-card">
      <div class="rcard-title">1. Основная информация</div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Название теста</label><input id="tb-title" class="form-input" value="${esc(s.title)}" ${isOpen?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Время на прохождение (мин)</label><input id="tb-time-limit" type="number" min="1" class="form-input" value="${s.time_limit_minutes}" ${isOpen?'disabled':''}></div>
      </div>
      <div class="form-group"><label class="form-label">Описание</label><textarea id="tb-description" class="form-input" rows="2" ${isOpen?'disabled':''}>${esc(s.description)}</textarea></div>
      <div class="form-group"><label class="form-label">Инструкция для операторов</label><textarea id="tb-instruction" class="form-input" rows="2" ${isOpen?'disabled':''}>${esc(s.instruction)}</textarea></div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Дата и время открытия</label><input id="tb-opens-at" type="datetime-local" class="form-input" value="${s.opens_at}" ${isOpen?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Дата и время закрытия</label><input id="tb-closes-at" type="datetime-local" class="form-input" value="${s.closes_at}"></div>
      </div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Проходной процент</label><input id="tb-passing-percent" type="number" min="0" max="100" class="form-input" value="${s.passing_percent}" ${isOpen?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Максимум попыток</label><input id="tb-max-attempts" type="number" min="1" class="form-input" value="${s.max_attempts}" ${isOpen?'disabled':''}></div>
      </div>
      <label class="an-checkbox-label"><input type="checkbox" id="tb-show-result" ${s.show_result_after_finish?'checked':''} ${isOpen?'disabled':''}> Показывать результат сразу после завершения</label>
      <label class="an-checkbox-label"><input type="checkbox" id="tb-show-correct" ${s.show_correct_answers?'checked':''} ${isOpen?'disabled':''}> Показывать правильные ответы после завершения</label>
      <label class="an-checkbox-label"><input type="checkbox" id="tb-allow-retake" ${s.allow_retake?'checked':''} ${isOpen?'disabled':''}> Разрешить повторное прохождение</label>
    </div>

    <div class="test-builder-card">
      <div class="rcard-title">Награда</div>
      <div class="form-group"><label class="form-label">Тип награды</label>
        <select id="tb-reward-type" class="form-select" ${isOpen?'disabled':''}>
          <option value="none" ${s.reward_type==='none'?'selected':''}>Без награды</option>
          <option value="points" ${s.reward_type==='points'?'selected':''}>Баллы</option>
          <option value="coins" ${s.reward_type==='coins'?'selected':''}>Коины</option>
          <option value="points_and_coins" ${s.reward_type==='points_and_coins'?'selected':''}>Баллы + коины</option>
        </select>
      </div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Максимум баллов</label><input id="tb-reward-points" type="number" min="0" class="form-input" value="${s.reward_points}" ${isOpen?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Максимум коинов</label><input id="tb-reward-coins" type="number" min="0" class="form-input" value="${s.reward_coins}" ${isOpen?'disabled':''}></div>
      </div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Минимальный % для награды</label><input id="tb-reward-min-percent" type="number" min="0" max="100" class="form-input" value="${s.reward_min_percent}" ${isOpen?'disabled':''}></div>
        <div class="form-group"><label class="form-label">Режим начисления</label>
          <select id="tb-reward-mode" class="form-select" ${isOpen?'disabled':''}>
            <option value="fixed" ${s.reward_mode==='fixed'?'selected':''}>Фиксированная</option>
            <option value="proportional" ${s.reward_mode==='proportional'?'selected':''}>Пропорциональная</option>
          </select>
        </div>
      </div>
    </div>

    <div class="test-builder-card">
      <div class="rcard-title-row"><div class="rcard-title">2. Вопросы</div>${!isOpen?'<button class="btn-outline btn-sm" id="tb-add-question">+ Добавить вопрос</button>':''}</div>
      <div id="tb-questions-list">${s.questions.map((q,i) => questionEditorHtml(q,i,isOpen)).join('') || '<div class="empty-line">Вопросов пока нет</div>'}</div>
    </div>

    <div class="test-builder-card">
      <div class="rcard-title">3. Назначение — кому назначить тест</div>
      <div class="form-group">
        <select id="tb-assign-type" class="form-select">
          <option value="all" ${s.assignTargetType==='all'?'selected':''}>Все операторы</option>
          <option value="group" ${s.assignTargetType==='group'?'selected':''}>По группам</option>
          <option value="operator" ${s.assignTargetType==='operator'?'selected':''}>Отдельные операторы</option>
        </select>
      </div>
      <div id="tb-assign-targets"></div>
    </div>

    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn-outline" id="tb-save-draft">Сохранить ${s.testId?'':'как черновик'}</button>
      <button class="btn-primary" id="tb-save-and-publish">${s.status==='open'?'Сохранить изменения':'Сохранить и опубликовать'}</button>
    </div>
  `;

  el.querySelector('#tb-add-question')?.addEventListener('click', () => {
    s.questions.push({ question_text: '', question_type: 'single_choice', points: 1, answers: [{answer_text:'',is_correct:false},{answer_text:'',is_correct:false}] });
    renderTestBuilderScreen();
  });

  bindQuestionEditorEvents(el, isOpen);
  renderAssignTargetsBlock(el);
  el.querySelector('#tb-assign-type').addEventListener('change', (e) => { s.assignTargetType = e.target.value; renderAssignTargetsBlock(el); });

  el.querySelector('#tb-save-draft').addEventListener('click', () => saveTestBuilder(false));
  el.querySelector('#tb-save-and-publish').addEventListener('click', () => saveTestBuilder(true));
}

function questionEditorHtml(q, index, isOpen) {
  return `<div class="test-question-editor" data-q-index="${index}">
    <div class="test-question-editor-head">
      <input class="form-input" placeholder="Текст вопроса" value="${esc(q.question_text)}" data-q-field="question_text" ${isOpen?'disabled':''}>
      <select class="form-select" data-q-field="question_type" style="max-width:200px" ${isOpen?'disabled':''}>
        <option value="single_choice" ${q.question_type==='single_choice'?'selected':''}>Один ответ</option>
        <option value="multiple_choice" ${q.question_type==='multiple_choice'?'selected':''}>Несколько ответов</option>
      </select>
      <input class="form-input" type="number" min="0" style="max-width:90px" placeholder="Баллы" value="${q.points}" data-q-field="points" ${isOpen?'disabled':''}>
      ${!isOpen?`<button class="btn-outline btn-sm" data-q-delete>×</button>`:''}
    </div>
    <div class="test-answer-options">
      ${q.answers.map((a,ai) => `<div class="test-answer-option-row" data-a-index="${ai}">
        <input type="${q.question_type==='multiple_choice'?'checkbox':'radio'}" data-a-field="is_correct" ${a.is_correct?'checked':''} ${isOpen?'disabled':''}>
        <input class="form-input" placeholder="Вариант ответа" value="${esc(a.answer_text)}" data-a-field="answer_text" ${isOpen?'disabled':''}>
        ${!isOpen&&q.answers.length>2?`<button class="btn-outline btn-sm" data-a-delete>×</button>`:''}
      </div>`).join('')}
    </div>
    ${!isOpen && q.answers.length < 10 ? `<button class="btn-outline btn-sm" data-q-add-answer>+ Добавить вариант ответа</button>` : ''}
  </div>`;
}

function bindQuestionEditorEvents(el, isOpen) {
  const s = _testBuilderState;
  el.querySelectorAll('[data-q-index]').forEach(qDiv => {
    const qi = Number(qDiv.dataset.qIndex);
    qDiv.querySelectorAll('[data-q-field]').forEach(input => {
      input.addEventListener('input', () => { s.questions[qi][input.dataset.qField] = input.type === 'number' ? Number(input.value) : input.value; });
      input.addEventListener('change', () => {
        if (input.dataset.qField === 'question_type') renderTestBuilderScreen();
      });
    });
    qDiv.querySelector('[data-q-delete]')?.addEventListener('click', () => { s.questions.splice(qi,1); renderTestBuilderScreen(); });
    qDiv.querySelector('[data-q-add-answer]')?.addEventListener('click', () => { s.questions[qi].answers.push({answer_text:'',is_correct:false}); renderTestBuilderScreen(); });

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
      aDiv.querySelector('[data-a-delete]')?.addEventListener('click', () => { s.questions[qi].answers.splice(ai,1); renderTestBuilderScreen(); });
    });
  });
}

function renderAssignTargetsBlock(el) {
  const s = _testBuilderState;
  const box = el.querySelector('#tb-assign-targets');
  if (s.assignTargetType === 'all') { box.innerHTML = ''; return; }
  if (s.assignTargetType === 'group') {
    box.innerHTML = `<div class="form-group"><label class="form-label">Группы</label>
      <div class="test-target-checklist">${(STATE.groups||[]).map(g => `<label class="an-checkbox-label"><input type="checkbox" value="${g.id}" ${s.assignTargetIds.includes(g.id)?'checked':''}> ${esc(g.name)}</label>`).join('')}</div></div>`;
  } else {
    box.innerHTML = `<div class="form-group"><label class="form-label">Операторы</label>
      <input class="form-input" id="tb-operator-search" placeholder="Поиск по ФИО" style="margin-bottom:8px">
      <div class="test-target-checklist" id="tb-operator-checklist">${(STATE.adminOperators||[]).map(o => `<label class="an-checkbox-label" data-op-name="${esc(o.full_name).toLowerCase()}"><input type="checkbox" value="${o.id}" ${s.assignTargetIds.includes(o.id)?'checked':''}> ${esc(o.full_name)}</label>`).join('')}</div></div>`;
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

  const payload = {
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

  if (!payload.title.trim()) { showToast('Укажите название теста', 'error'); return; }

  try {
    let testId = s.testId;
    if (testId) {
      await api.updateTest(testId, payload);
    } else {
      const created = await api.createTest(payload);
      testId = created.id;
      s.testId = testId;
    }

    for (const q of s.questions) {
      if (q.answers.filter(a => a.is_correct).length === 0) {
        showToast(`У вопроса "${q.question_text || '(без текста)'}" не указан правильный ответ`, 'error');
        return;
      }
      const qPayload = { question_text: q.question_text, question_type: q.question_type, points: q.points, sort_order: 0, answers: q.answers };
      if (q.id) await api.updateTestQuestion(q.id, qPayload);
      else { const created = await api.addTestQuestion(testId, qPayload); q.id = created.id; }
    }

    await api.assignTest(testId, { target_type: s.assignTargetType, target_ids: s.assignTargetIds });

    if (publish) {
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
async function openTestResultsView(testId) {
  const el = document.getElementById('view-tests');
  if (!el) return;

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Тесты</div><h2 class="section-title">Результаты</h2></div>
      <button class="btn-outline btn-sm" onclick="renderTests()">К списку</button>
    </div>
    <div class="filter-tabs" id="tr-tabs">
      <button class="filter-tab active" data-tr-tab="results">Результаты</button>
      <button class="filter-tab" data-tr-tab="analytics">Аналитика</button>
    </div>
    <div id="tr-body"><div class="loading-state"><div class="loading-spinner"></div></div></div>`;

  el.querySelectorAll('[data-tr-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('[data-tr-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.trTab === 'results') loadTestResultsTable(testId);
      else loadTestAnalyticsBlock(testId);
    });
  });

  await loadTestResultsTable(testId);
}

async function loadTestResultsTable(testId) {
  const body = document.getElementById('tr-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div></div>';
  try {
    const data = await api.getTestResults(testId);
    const items = data.items || [];
    if (!items.length) {
      body.innerHTML = `<div class="empty-state"><p>По выбранным фильтрам операций не найдено.</p></div>`;
      return;
    }
    body.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>Оператор</th><th>Группа</th><th>Статус</th><th>Начал</th><th>Завершил</th>
        <th class="num">Время</th><th class="num">Правильных</th><th class="num">%</th>
        <th class="num">Баллы</th><th class="num">Коины</th><th class="num">Попытка</th>
      </tr></thead>
      <tbody>
        ${items.map(r => `<tr>
          <td class="name-cell">${esc(r.operator_name)}</td>
          <td>${esc(r.group_name||'—')}</td>
          <td>${testStatusBadge(r.status==='finished'?(r.passed?'finished':'expired'):r.status)}</td>
          <td>${fmtDateTime(r.started_at)}</td>
          <td>${r.finished_at?fmtDateTime(r.finished_at):'—'}</td>
          <td class="num">${r.duration_seconds!=null?Math.round(r.duration_seconds/60)+' мин':'—'}</td>
          <td class="num">${r.correct_count}/${r.questions_count}</td>
          <td class="num"><b>${fmtA(r.score_percent,0)}%</b></td>
          <td class="num">${fmtA(r.score_points,1)}</td>
          <td class="num">${r.reward_coins||0}</td>
          <td class="num">${r.attempt_number}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  } catch(e) {
    body.innerHTML = `<div class="status-line status-error">${esc(e.message)}</div>`;
  }
}

async function loadTestAnalyticsBlock(testId) {
  const body = document.getElementById('tr-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div></div>';
  try {
    const a = await api.getTestAnalytics(testId);
    body.innerHTML = `
      <div class="an-kpi-grid">
        <div class="an-kpi-cell"><div class="an-kpi-label">Всего назначено</div><div class="an-kpi-value">${a.total_assigned}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Начали</div><div class="an-kpi-value">${a.started}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Завершили</div><div class="an-kpi-value">${a.finished}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Не начали</div><div class="an-kpi-value">${a.not_started}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Средний %</div><div class="an-kpi-value">${a.average_percent!=null?a.average_percent+'%':'—'}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Среднее время</div><div class="an-kpi-value">${a.average_duration_seconds!=null?Math.round(a.average_duration_seconds/60)+' мин':'—'}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Прошли</div><div class="an-kpi-value">${a.passed}</div></div>
        <div class="an-kpi-cell"><div class="an-kpi-label">Не прошли</div><div class="an-kpi-value">${a.failed}</div></div>
      </div>
      <div class="rcard-title" style="margin-top:18px">Вопросы, вызывающие больше всего ошибок</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Вопрос</th><th class="num">Правильных</th><th class="num">Неправильных</th><th class="num">% ошибок</th></tr></thead>
        <tbody>
          ${(a.questions||[]).sort((x,y)=>(y.error_percent||0)-(x.error_percent||0)).map(q => `<tr>
            <td>${esc(q.question_text)}</td>
            <td class="num">${q.correct_count}</td>
            <td class="num">${q.incorrect_count}</td>
            <td class="num"><b>${q.error_percent!=null?q.error_percent+'%':'—'}</b></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    `;
  } catch(e) {
    body.innerHTML = `<div class="status-line status-error">${esc(e.message)}</div>`;
  }
}
