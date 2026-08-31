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
        <h1 class="section-title">Wheel of WOW</h1>
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
    el.innerHTML = `<div class="view-header"><h1 class="section-title">Wheel of WOW</h1></div>${wheelLoadingPanel('Готовим колесо')}`;
    return;
  }
  if (!status.campaign || !items.length) {
    el.innerHTML = `<div class="view-header"><h1 class="section-title">Wheel of WOW</h1></div>
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
        <h1 class="section-title">Колесо наград</h1>
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

// Гармоничная «коническая» палитра Puls: цвет сектора зависит от его позиции по
// кругу, поэтому колесо читается как плавный круговой градиент при любом числе
// призов (2–20). Работает без привязки к количеству секторов.
const WHEEL_CONIC_PALETTE = ['#7C5CFC', '#6366F1', '#38BDF8', '#2DD4BF', '#34D399', '#FBBF24', '#FB923C', '#F472B6'];
function wheelLerpHex(a, b, t) {
  const A = wheelHexRgb(a), B = wheelHexRgb(b);
  const m = (x, y) => Math.round(x + (y - x) * t);
  const hh = (v) => v.toString(16).padStart(2, '0');
  return `#${hh(m(A.r, B.r))}${hh(m(A.g, B.g))}${hh(m(A.b, B.b))}`;
}
function wheelConicColor(t) {
  const P = WHEEL_CONIC_PALETTE;
  const p = (((t % 1) + 1) % 1) * P.length;
  const k = Math.floor(p);
  return wheelLerpHex(P[k % P.length], P[(k + 1) % P.length], p - k);
}

// Строит спокойное плоское колесо Puls с понятными двухстрочными названиями.
function buildWheelSvg(items) {
  const n = items.length;
  const cx = 160, cy = 160;
  const rOuter = 158;
  const rSeg = 148;
  const seg = 360 / n;
  let defs = '';
  let paths = '';
  let labels = '';

  const goldMid = '#E5B446';
  for (let i = 0; i < n; i++) {
    const base = items[i].color || wheelConicColor((i + 0.5) / n);
    const a0 = i * seg, a1 = (i + 1) * seg;
    const p0 = wheelPoint(cx, cy, rSeg, a0);
    const p1 = wheelPoint(cx, cy, rSeg, a1);
    const large = seg > 180 ? 1 : 0;
    paths += `<path d="M${cx},${cy} L${p0.x.toFixed(2)},${p0.y.toFixed(2)} A${rSeg},${rSeg} 0 ${large} 1 ${p1.x.toFixed(2)},${p1.y.toFixed(2)} Z" fill="${base}" stroke="rgba(255,255,255,.95)" stroke-width="2" stroke-linejoin="round"/>`;
    const mid = a0 + seg / 2;
    const twoLines = n <= 12;
    const fs1 = n <= 8 ? 15 : n <= 12 ? 12.5 : n <= 16 ? 10.5 : 9.5;
    const lp = wheelPoint(cx, cy, rSeg * (twoLines ? 0.66 : 0.72), mid);
    const ui = wheelPrizePresentation(items[i]);
    const fill = wheelTextColor(base);
    const halo = 'style="paint-order:stroke;stroke:rgba(30,20,60,.28);stroke-width:2.5px"';
    if (twoLines) {
      labels += `<text x="${lp.x.toFixed(1)}" y="${(lp.y - 5).toFixed(1)}" text-anchor="middle" font-size="${fs1}" font-weight="800" fill="${fill}" ${halo}><tspan x="${lp.x.toFixed(1)}">${esc(ui.line1)}</tspan><tspan x="${lp.x.toFixed(1)}" dy="${(fs1 + 1).toFixed(0)}" font-size="${(fs1 * 0.66).toFixed(1)}" font-weight="700">${esc(ui.line2)}</tspan></text>`;
    } else {
      labels += `<text x="${lp.x.toFixed(1)}" y="${(lp.y + fs1 * 0.35).toFixed(1)}" text-anchor="middle" font-size="${fs1}" font-weight="800" fill="${fill}" ${halo}>${esc(ui.line1)}</text>`;
    }
  }

  // Золотой обод с мягкими огоньками — не зависит от числа секторов.
  let bulbs = '';
  for (let b = 0; b < 16; b++) {
    const bp = wheelPoint(cx, cy, (rSeg + 3 + rOuter) / 2, b * 22.5 + 11.25);
    bulbs += `<circle cx="${bp.x.toFixed(1)}" cy="${bp.y.toFixed(1)}" r="2.6" fill="#FFFDF4" stroke="#B9861F" stroke-width="1"/>`;
  }

  defs = `<linearGradient id="wheelGoldRim" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#F8D877"/><stop offset="50%" stop-color="${goldMid}"/><stop offset="100%" stop-color="#C9962B"/></linearGradient>`;

  return `<svg viewBox="0 0 320 320" class="wheel-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      ${defs}
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="url(#wheelGoldRim)"/>
    <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="none" stroke="#B9861F" stroke-width="1.5"/>
    <circle cx="${cx}" cy="${cy}" r="${rSeg + 3}" fill="#FFFFFF"/>
    ${paths}
    <circle cx="${cx}" cy="${cy}" r="${rSeg}" fill="none" stroke="#FFFFFF" stroke-width="3"/>
    <circle cx="${cx}" cy="${cy}" r="${rSeg + 1}" fill="none" stroke="${goldMid}" stroke-width="1.5"/>
    ${bulbs}
    ${labels}
  </svg>`;
}

// Точка на окружности: угол в градусах, 0° = верх (12 часов), по часовой
function wheelPoint(cx, cy, r, deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildWheelHistory(rows) {
  if (!rows.length) return '<div class="wheel-history-empty"><p>Выигрышей пока нет. Используйте первый билет, и приз появится здесь.</p></div>';
  return `<ul class="wheel-history-list">${rows.map(r => `
    <li class="wheel-history-item">
      <span class="wheel-history-icon">${esc(wheelPrizePresentation({ type:r.prize_type, amount:r.amount, title:r.prize }).badge)}</span>
      <span class="wheel-history-main">
        <strong>${esc(r.prize)}</strong>
        <span class="wheel-history-reason">${esc(wheelPrizePresentation({ type:r.prize_type, amount:r.amount, title:r.prize }).description)}</span>
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
    if (btn) { btn.disabled = false; btn.textContent = 'Крутить'; }
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
  const spins = 3; // полных оборотов — достаточно для эффекта при более быстрой анимации

  // Баг был здесь: раньше target считался как АБСОЛЮТНЫЙ угол (spins*360 - center),
  // то есть всегда попадал в один и тот же узкий диапазон ~[720°,1080°] независимо
  // от того, где колесо уже стоит. При второй и последующих прокрутках CSS-переход
  // просто анимировал крошечную разницу между «уже стоим на ~900°» и «новая цель
  // тоже ~900°» — визуально колесо чуть дёргалось вместо полного оборота. Правильно:
  // всегда крутить ВПЕРЁД от текущего угла минимум на spins полных оборотов.
  const desiredFinalAngle = (((360 - center - jitter) % 360) + 360) % 360;
  const currentAngle = ((w.rotation % 360) + 360) % 360;
  let forwardDelta = desiredFinalAngle - currentAngle;
  if (forwardDelta <= 0) forwardDelta += 360; // никогда не крутим назад и не остаёмся на месте
  const target = w.rotation + spins * 360 + forwardDelta;
  w.rotation = target;

  const SPIN_ANIMATION_MS = 2600; // держим синхронно с MIN_SECONDS_BETWEEN_SPINS на backend
  rotor.style.transition = `transform ${SPIN_ANIMATION_MS / 1000}s cubic-bezier(0.16, 1, 0.3, 1)`;
  rotor.style.transform = `rotate(${target}deg)`;

  setTimeout(() => {
    w.spinning = false;
    showWheelResultModal(result);
    // Обновляем статус и историю без полной перерисовки колеса (оно уже стоит на призе)
    refreshWheelSidebar(el);
  }, SPIN_ANIMATION_MS + 100);
}

function showWheelResultModal(result) {
  const ui = wheelPrizePresentation(result.prize);
  const html = `
    <div class="modal-overlay wheel-result-overlay" id="wheel-result-modal">
      <div class="modal-card wheel-result-card">
        <div class="wheel-result-icon">${esc(ui.badge)}</div>
        <span class="wheel-result-kicker">Ваш приз</span>
        <h3>Поздравляем</h3>
        <p class="wheel-result-prize">${esc(result.prize.title)}</p>
        <p class="wheel-result-msg">${esc(ui.description)}</p>
        ${result.reason ? `<p class="wheel-result-reason">Причина допуска: ${esc(result.reason)}</p>` : ''}
        ${result.prize.type === 'coins' ? '<p class="wheel-result-note">Коины уже добавлены на ваш баланс.</p>' : ''}
        <button class="btn-primary" onclick="document.getElementById('wheel-result-modal')?.remove()">Понятно</button>
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
      btn.textContent = canSpin ? 'Крутить' : (tickets > 0 ? 'Лимит' : 'Нет билета');
      if (canSpin) btn.onclick = () => doWheelSpin(el);
    }
    const ticketCount = document.getElementById('wheel-ticket-count-value');
    if (ticketCount) ticketCount.textContent = String(tickets);
    const todayLimit = document.getElementById('wheel-today-limit');
    if (todayLimit) todayLimit.textContent = `${status.spins_used_today} из ${status.max_spins_per_day || '∞'}`;
    const weekLimit = document.getElementById('wheel-week-limit');
    if (weekLimit) weekLimit.textContent = `${status.spins_used_this_week} из ${status.max_spins_per_week || '∞'}`;
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
        <div class="section-kicker">Управление мотивацией</div>
        <h1 class="section-title">Wheel of WOW</h1>
        <p class="section-subtitle">Настройте призы, правила получения попыток и контролируйте прокрутки.</p>
      </div>
    </div>
    <div class="filter-tabs wheel-tabs">
        <button class="filter-tab ${_wheelStaffTab === 'campaign' ? 'active' : ''}" data-wheel-tab="campaign">Настройки</button>
        <button class="filter-tab ${_wheelStaffTab === 'prizes' ? 'active' : ''}" data-wheel-tab="prizes">Призы</button>
        <button class="filter-tab ${_wheelStaffTab === 'operations' || _wheelStaffTab === 'tickets' || _wheelStaffTab === 'history' || _wheelStaffTab === 'stats' ? 'active' : ''}" data-wheel-tab="operations">Операции</button>
        <button class="filter-tab ${_wheelStaffTab === 'rules' ? 'active' : ''}" data-wheel-tab="rules">Автоматизация</button>
        <button class="filter-tab ${_wheelStaffTab === 'logs' ? 'active' : ''}" data-wheel-tab="logs">Журнал</button>
        <button class="filter-tab ${_wheelStaffTab === 'issue' ? 'active' : ''}" data-wheel-tab="issue">Выдача билетов</button>
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
let _wheelSelectedPrizeIds = new Set();

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
  _wheelSelectedPrizeIds = new Set([..._wheelSelectedPrizeIds].filter(id => rows.some(r => r.id === id)));
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
  const prizeRowHtml = (r) => `<article class="wheel-prize-card ${r.is_active ? '' : 'is-disabled'}" data-prize-id="${r.id}" style="--wheel-prize-color:${esc(r.color || '#38BDF8')}">
            <div class="wheel-prize-card-head">
              <label class="wheel-prize-select"><input type="checkbox" class="wp-select" ${_wheelSelectedPrizeIds.has(r.id) ? 'checked' : ''}><span>Выбрать</span></label>
              <div class="wheel-prize-card-summary">
                <span class="wheel-chance">${chance(r.is_active ? r.weight : 0)}% шанс</span>
                <span class="badge ${r.is_active ? 'badge-ok' : 'badge-muted'}">${r.is_active ? 'Активен' : 'Выключен'}</span>
              </div>
            </div>
            <div class="wheel-prize-identity">
              <label class="wheel-prize-color"><span class="form-label">Цвет</span><input type="color" class="wp-color" value="${esc(r.color || '#38BDF8')}" title="Цвет сектора"></label>
              <label class="form-group"><span class="form-label">Название приза</span><input type="text" class="form-input wp-title" value="${esc(r.title)}"></label>
            </div>
            <div class="wheel-prize-config">
              <section class="wheel-prize-config-block">
                <div class="wheel-prize-config-title"><strong>Награда</strong><span>Что получит оператор</span></div>
                <div class="wheel-prize-config-fields wheel-prize-reward-fields">
                  <label class="form-group wheel-prize-type"><span class="form-label">Тип</span><select class="form-input wp-type">${typeOptions(r.prize_type)}</select></label>
                  <label class="form-group"><span class="form-label">Количество</span><input type="number" class="form-input wp-amount" value="${r.amount}"></label>
                </div>
              </section>
              <section class="wheel-prize-config-block">
                <div class="wheel-prize-config-title"><strong>Вероятность</strong><span>Доля сектора на колесе</span></div>
                <label class="form-group"><span class="form-label">Вес приза</span><input type="number" class="form-input wp-weight" value="${r.weight}" min="0"></label>
              </section>
              <section class="wheel-prize-config-block">
                <div class="wheel-prize-config-title"><strong>Ограничения</strong><span>0 означает без лимита</span></div>
                <div class="wheel-prize-config-fields">
                  <label class="form-group"><span class="form-label">Всего выдач</span><input type="number" class="form-input wp-maxtotal" value="${r.max_wins_total}" min="0" title="0 — без лимита"></label>
                  <label class="form-group"><span class="form-label">Одному оператору</span><input type="number" class="form-input wp-maxop" value="${r.max_wins_per_operator}" min="0" title="0 — без лимита"></label>
                </div>
              </section>
            </div>
            <div class="wheel-prize-card-foot">
              <label class="wheel-switch-label"><input type="checkbox" class="wp-active" ${r.is_active ? 'checked' : ''}><span>Доступен для розыгрыша</span></label>
              <button class="btn-primary btn-sm wp-save">Сохранить изменения</button>
            </div>
          </article>`;
  const prizeGroupHtml = (group) => {
    const activeItems = group.items.filter(r => r.is_active);
    const groupWeight = activeItems.reduce((sum, r) => sum + (r.weight || 0), 0);
    const groupChance = totalWeight > 0 ? Math.round((groupWeight / totalWeight) * 100) : 0;
    const rawLabel = wheelPrizeTypeLabel(group.type) || group.type || 'Другое';
    const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
    return `<section class="wheel-prize-group">
              <div class="wheel-prize-group-title">
                <div><span class="wheel-prize-group-name">${esc(label)}</span><small>${group.items.length} ${group.items.length === 1 ? 'приз' : 'приза'}</small></div>
                <span class="wheel-prize-group-meta">Активных: ${activeItems.length} · общий шанс: ${groupChance}%</span>
              </div>
              <div class="wheel-prize-card-grid">${group.items.map(prizeRowHtml).join('')}</div>
            </section>`;
  };

  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head">
        <div><h3>Призы колеса</h3><p class="panel-hint">Каждая карточка — отдельный сектор. Чем больше вес, тем выше вероятность выпадения.</p></div>
        <span class="panel-badge">${rows.length} призов · вес ${totalWeight}</span>
      </div>
      <div class="wheel-admin-content">
        <div class="wheel-bulk-bar ${_wheelSelectedPrizeIds.size ? 'is-visible' : ''}" id="wheel-bulk-bar">
          <span><b id="wheel-bulk-count">${_wheelSelectedPrizeIds.size}</b> выбрано</span>
          <button class="btn-danger btn-sm" id="wheel-bulk-disable">Отключить выбранные</button>
          <button class="btn-outline btn-sm" id="wheel-bulk-enable">Включить выбранные</button>
          <button class="btn-link" id="wheel-bulk-clear">Снять выбор</button>
        </div>
        <label class="wheel-select-all"><input type="checkbox" id="wp-select-all"><span>Выбрать все призы</span></label>
        <div class="wheel-prize-groups">${groupedRows.map(prizeGroupHtml).join('') || '<div class="empty-state wheel-empty"><p>Призов пока нет.</p></div>'}</div>
        <div class="wheel-newprize">
          <h4 class="panel-subtitle">Добавить сектор</h4>
          <div class="form-grid wheel-newprize-grid">
            <label class="wheel-newprize-field"><span class="form-label">Название</span><input type="text" id="np-title" class="form-input" placeholder="Название"></label>
            <label class="wheel-newprize-field"><span class="form-label">Тип</span><select id="np-type" class="form-input">${typeOptions('coins')}</select></label>
            <label class="wheel-newprize-field"><span class="form-label">Кол-во</span><input type="number" id="np-amount" class="form-input" placeholder="Кол-во" value="1"></label>
            <label class="wheel-newprize-field"><span class="form-label">Вес</span><input type="number" id="np-weight" class="form-input" placeholder="Вес" value="10" min="0"></label>
            <label class="wheel-newprize-field"><span class="form-label">Цвет</span><input type="color" id="np-color" value="#38BDF8"></label>
            <button class="btn-primary" id="np-add">Добавить</button>
          </div>
          <div id="np-status" class="status-line" style="margin-top:8px"></div>
        </div>
        <div class="status-line muted" style="margin-top:10px">Сектор «ничего» запрещён (ТЗ п.6.3): минимальный приз — «+1 коин». Чтобы убрать сектор, выключите «Активен» (или выберите несколько и нажмите «Отключить выбранные»).</div>
      </div>
    </div>`;

  function updateBulkBar() {
    const bar = document.getElementById('wheel-bulk-bar');
    const count = document.getElementById('wheel-bulk-count');
    if (!bar || !count) return;
    count.textContent = _wheelSelectedPrizeIds.size;
    bar.classList.toggle('is-visible', _wheelSelectedPrizeIds.size > 0);
  }

  body.querySelectorAll('[data-prize-id]').forEach(card => {
    const id = parseInt(card.dataset.prizeId, 10);
    card.querySelector('.wp-select').onchange = (e) => {
      if (e.target.checked) _wheelSelectedPrizeIds.add(id);
      else _wheelSelectedPrizeIds.delete(id);
      updateBulkBar();
    };
    card.querySelector('.wp-save').onclick = async () => {
      const payload = {
        title: card.querySelector('.wp-title').value.trim(),
        prize_type: card.querySelector('.wp-type').value,
        amount: parseInt(card.querySelector('.wp-amount').value, 10) || 0,
        weight: parseInt(card.querySelector('.wp-weight').value, 10) || 0,
        color: card.querySelector('.wp-color').value,
        max_wins_total: parseInt(card.querySelector('.wp-maxtotal').value, 10) || 0,
        max_wins_per_operator: parseInt(card.querySelector('.wp-maxop').value, 10) || 0,
        is_active: card.querySelector('.wp-active').checked,
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

  document.getElementById('wp-select-all').onchange = (e) => {
    body.querySelectorAll('[data-prize-id]').forEach(card => {
      const id = parseInt(card.dataset.prizeId, 10);
      card.querySelector('.wp-select').checked = e.target.checked;
      if (e.target.checked) _wheelSelectedPrizeIds.add(id); else _wheelSelectedPrizeIds.delete(id);
    });
    updateBulkBar();
  };

  async function bulkSetActive(isActive) {
    const ids = [..._wheelSelectedPrizeIds];
    if (!ids.length) return;
    if (!isActive) {
      const confirmed = await uiConfirmAction({
        title: 'Отключить выбранные секторы?',
        description: `${ids.length} ${pluralize(ids.length, 'сектор', 'сектора', 'секторов')} перестанут участвовать в Колесе WOW.`,
        confirmLabel: 'Отключить',
      });
      if (!confirmed) return;
    }
    const results = await Promise.allSettled(ids.map(id => api.updateWheelPrize(id, { is_active: isActive })));
    const failed = results.filter(r => r.status === 'rejected').length;
    swrInvalidate('wheel:admin:prizes');
    swrInvalidate('wheel:prizes');
    showToast(failed ? `Готово, но ${failed} не удалось` : `${isActive ? 'Включено' : 'Отключено'}: ${ids.length}`, failed ? 'error' : 'ok');
    _wheelSelectedPrizeIds.clear();
    renderWheelPrizesTab(body);
  }
  document.getElementById('wheel-bulk-disable').onclick = () => bulkSetActive(false);
  document.getElementById('wheel-bulk-enable').onclick = () => bulkSetActive(true);
  document.getElementById('wheel-bulk-clear').onclick = () => { _wheelSelectedPrizeIds.clear(); renderWheelPrizesTab(body); };

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
            ${tickets.length ? `<div class="wheel-record-list">${tickets.map(t => `<article class="wheel-record-row">
                <div class="wheel-record-main"><strong>${esc(t.operator_name)}</strong><span>${esc(t.reason_text || wheelSourceLabel(t.reason_type) || 'Без пояснения')}</span></div>
                <div class="wheel-record-meta"><span>Выдан ${esc(fmtDateTime(t.created_at))}</span><span>${t.expires_at ? 'До ' + esc(fmtDateTime(t.expires_at)) : 'Без срока'}</span></div>
                <span class="badge ${statusBadge[t.status] || 'badge-muted'}">${statusLabel[t.status] || t.status}</span>
              </article>`).join('')}</div>` : '<div class="empty-state wheel-empty"><p>Билетов пока нет.</p></div>'}
          </div>
        </section>

        <section class="panel wheel-admin-panel">
          <div class="panel-head">
            <h3>История прокруток</h3>
            <span class="panel-badge">${spins.length}</span>
          </div>
          <div class="wheel-admin-content">
            ${spins.length ? `<div class="wheel-record-list">${spins.map(r => `<article class="wheel-record-row wheel-spin-record">
                <div class="wheel-record-main"><strong>${esc(r.operator_name)}</strong><span>${esc(r.group_name || 'Без группы')}</span></div>
                <div class="wheel-record-prize"><span class="wheel-type-pill">${esc(wheelPrizeTypeLabel(r.prize_type))}</span><strong>${esc(r.prize)}</strong></div>
                <div class="wheel-record-reason">${esc(r.reason || 'Без пояснения')}</div>
                <time>${esc(fmtDateTime(r.date))}</time>
              </article>`).join('')}</div>` : '<div class="empty-state wheel-empty"><p>Прокруток пока нет.</p></div>'}
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
          <thead><tr><th scope="col">Создан</th><th scope="col">Оператор</th><th scope="col">Причина</th><th scope="col">Источник</th><th scope="col">Истекает</th><th scope="col">Использован</th><th scope="col">Статус</th></tr></thead>
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
          <thead><tr><th scope="col">Дата</th><th scope="col">Оператор</th><th scope="col">Группа</th><th scope="col">Причина</th><th scope="col">Приз</th><th scope="col">Тип</th></tr></thead>
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
              <thead><tr><th scope="col">Приз</th><th scope="col">Раз</th></tr></thead>
              <tbody>${hist.map(h => `<tr><td>${esc(h.title)}</td><td><strong>${h.count}</strong></td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty-line">Прокруток сегодня нет</div>'}
          </div>
          <div>
            <h4 class="panel-subtitle">Топ источников попыток</h4>
            ${src.length ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th scope="col">Источник</th><th scope="col">Токенов</th></tr></thead>
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

function wheelRuleMetricLabel(metric) {
  return {
    test_score: 'Результат теста',
    quality_avg: 'Среднее качество звонков',
    late_minutes: 'Минуты опозданий',
    efficiency_percent: 'Эффективность',
    work_hours_percent: 'Выполнение нормы часов',
    rating_place: 'Место в рейтинге',
    simulation_passed: 'Симуляция пройдена',
  }[metric] || metric || 'Показатель';
}

function wheelRulePeriodLabel(period) {
  return {
    daily: 'Каждый день',
    weekly: 'Каждую неделю',
    monthly: 'Каждый месяц',
    once: 'Один раз',
  }[period] || period || 'Без периода';
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
        ${rows.length ? `<div class="wheel-rule-card-grid">${rows.map(r => `<article class="wheel-rule-card">
          <div class="wheel-rule-card-head"><span class="wheel-type-pill">${esc(wheelSourceLabel(r.source_module))}</span><span class="badge ${r.is_active ? 'badge-ok' : 'badge-muted'}">${r.is_active ? 'Работает' : 'Выключено'}</span></div>
          <div><h4>${esc(r.title)}</h4><code>${esc(r.code)}</code></div>
          <div class="wheel-rule-condition"><span>Условие</span><strong>${esc(wheelRuleMetricLabel(r.metric_key || r.rule_type))} ${esc(opLabel[r.operator] || r.operator)} ${esc(String(r.threshold_value))}${r.operator === 'between' && r.threshold_value_max != null ? '…' + esc(String(r.threshold_value_max)) : ''}</strong></div>
          <div class="wheel-rule-facts"><span><b>${esc(wheelRulePeriodLabel(r.period_type))}</b> периодичность</span><span><b>${r.max_tokens_per_period}</b> ${r.max_tokens_per_period === 1 ? 'билет' : 'билета'}</span><span><b>${r.token_ttl_hours} ч</b> срок билета</span></div>
        </article>`).join('')}</div>` : '<div class="empty-state wheel-empty"><p>Правил пока нет.</p></div>'}
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

  // Окно правила — собственная реализация, но ведёт себя как все остальные:
  // Escape закрывает, фон не прокручивается, фокус входит внутрь, не выходит
  // за пределы окна и возвращается туда, откуда окно открыли.
  const opener = document.activeElement;
  const dialog = modal.querySelector('.wheel-rule-modal');
  document.body.classList.add('modal-open');

  const onKey = event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
    )].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('modal-open');
    modal.remove();
    if (opener?.isConnected) opener.focus?.({ preventScroll: true });
  };

  document.addEventListener('keydown', onKey, true);
  modal.querySelectorAll('[data-wheel-rule-close]').forEach(b => b.onclick = close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  (dialog.querySelector('input:not([type=hidden]):not([disabled])') || dialog).focus?.({ preventScroll: true });

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
  const opLabel = { gte: '≥', lte: '≤', eq: '=', between: 'между', is_true: 'да' };
  body.innerHTML = `
    <div class="panel wheel-admin-panel">
      <div class="panel-head"><h3>Логи проверки условий</h3><span class="panel-badge">${rows.length}</span></div>
      <div class="wheel-admin-content">
        ${rows.length ? `<div class="wheel-log-list">${rows.map(l => `<article class="wheel-log-row">
            <time>${esc(fmtDateTime(l.created_at))}</time>
            <div class="wheel-log-operator"><strong>${esc(l.operator_name)}</strong><span>${esc(wheelSourceLabel(l.source_module))}${l.source_entity_id ? ' · запись ' + l.source_entity_id : ''}</span></div>
            <div class="wheel-log-condition"><span>Значение: <b>${l.metric_value != null ? esc(String(l.metric_value)) : 'нет данных'}</b></span><span>Условие: <b>${l.threshold_value != null ? esc(opLabel[l.operator] || l.operator) + ' ' + esc(String(l.threshold_value)) : '—'}</b></span></div>
            <span class="badge ${l.is_eligible ? 'badge-ok' : 'badge-muted'}">${l.is_eligible ? 'Билет выдан' : 'Не выдан'}</span>
            <p>${esc(l.reason || 'Причина не указана')}</p>
          </article>`).join('')}</div>` : `<div class="empty-state wheel-empty">
          <p>Логов пока нет.</p>
          <p class="cell-muted" style="font-size:12px;max-width:480px;margin:6px auto 0">
            Запись появляется автоматически, когда оператор завершает тест или сохраняется расчёт периода —
            и только если для этого источника есть активное правило допуска (вкладка «Правила»)
            в активной кампании. Если ни один оператор ещё не завершал тест/расчёт периода после
            включения колеса — здесь и должно быть пусто.
          </p>
        </div>`}
      </div>
    </div>`;
}

let _wheelIssueSelected = [];

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
  _wheelIssueSelected = _wheelIssueSelected.filter(sel => active.some(o => o.id === sel.id));

  body.innerHTML = `
    <div class="panel wheel-issue-panel">
      <div class="panel-head">
        <h3>Ручная выдача билетов</h3>
        <span class="panel-badge">Staff</span>
      </div>
      <div class="wheel-admin-content">
      <div class="wheel-issue-recipient">
        <label class="form-group">
          <span class="form-label">Получатели</span>
          <input type="text" id="wheel-op-search" class="form-input" placeholder="Найдите оператора по имени или группе" autocomplete="off">
          <div id="wheel-op-results" class="wheel-op-results" hidden></div>
        </label>
        <div id="wheel-op-chosen-list" class="wheel-op-chosen-list"></div>
      </div>
      <div class="form-grid wheel-issue-grid">
        <label class="form-group">
          <span class="form-label">Билетов оператору</span>
          <input type="number" id="wheel-qty" class="form-input" min="1" max="20" value="1">
        </label>
        <label class="form-group wheel-issue-reason">
          <span class="form-label">Причина выдачи</span>
          <input type="text" id="wheel-reason" class="form-input" placeholder="Например: помощь новому сотруднику" maxlength="500">
        </label>
        <label class="form-group">
          <span class="form-label">Действует, дней</span>
          <input type="number" id="wheel-ttl" class="form-input" min="1" max="30" value="3">
        </label>
        <div class="wheel-issue-actions">
          <button class="btn-primary" id="wheel-issue-btn" disabled>Выдать билеты</button>
        </div>
      </div>
      <div id="wheel-issue-status" class="status-line" style="margin-top:10px"></div>
      </div>
    </div>`;

  const search = document.getElementById('wheel-op-search');
  const results = document.getElementById('wheel-op-results');
  const chosenList = document.getElementById('wheel-op-chosen-list');
  const issueBtn = document.getElementById('wheel-issue-btn');

  function matches(o, q) {
    const hay = `${o.full_name || ''} ${o.group_name || o.group || ''}`.toLowerCase();
    return hay.includes(q);
  }
  function renderChosenList() {
    chosenList.innerHTML = _wheelIssueSelected.map(sel => `
      <span class="wheel-op-chip" data-chip-id="${sel.id}">${esc(sel.full_name)} <button type="button" aria-label="Убрать">×</button></span>
    `).join('');
    chosenList.querySelectorAll('[data-chip-id]').forEach(chip => {
      chip.querySelector('button').onclick = () => {
        const id = parseInt(chip.dataset.chipId, 10);
        _wheelIssueSelected = _wheelIssueSelected.filter(s => s.id !== id);
        renderChosenList();
        issueBtn.disabled = _wheelIssueSelected.length === 0;
      };
    });
  }
  renderChosenList();

  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { results.hidden = true; return; }
    const found = active.filter(o => matches(o, q) && !_wheelIssueSelected.some(s => s.id === o.id)).slice(0, 8);
    results.innerHTML = found.length
      ? found.map(o => `<div class="wheel-op-option" data-op-id="${o.id}" data-op-name="${esc(o.full_name)}">
          <strong>${esc(o.full_name)}</strong><span>${esc(o.group_name || o.group || '')}</span></div>`).join('')
      : '<div class="wheel-op-empty">Не найдено</div>';
    results.hidden = false;
    results.querySelectorAll('[data-op-id]').forEach(opt => {
      opt.onclick = () => {
        _wheelIssueSelected.push({ id: parseInt(opt.dataset.opId, 10), full_name: opt.dataset.opName });
        renderChosenList();
        results.hidden = true;
        search.value = '';
        issueBtn.disabled = false;
      };
    });
  };

  issueBtn.onclick = async () => {
    const reason = document.getElementById('wheel-reason').value.trim();
    const ttl = parseInt(document.getElementById('wheel-ttl').value, 10) || 3;
    const quantity = parseInt(document.getElementById('wheel-qty').value, 10) || 1;
    const statusEl = document.getElementById('wheel-issue-status');
    if (!_wheelIssueSelected.length) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Выберите хотя бы одного оператора'; return; }
    if (!reason) { statusEl.className = 'status-line status-error'; statusEl.textContent = 'Укажите причину'; return; }
    issueBtn.disabled = true;
    try {
      const res = await api.issueWheelTicketsBulk({
        operator_ids: _wheelIssueSelected.map(s => s.id),
        quantity, reason_text: reason, ttl_days: ttl,
      });
      swrInvalidate('wheel:');
      const failedNote = res.failed?.length ? ` Не удалось: ${res.failed.length} (см. подробности в консоли).` : '';
      if (res.failed?.length) console.warn('Wheel bulk issue failures:', res.failed);
      statusEl.className = res.issued_count > 0 ? 'status-line status-ok' : 'status-line status-error';
      statusEl.textContent = `Выдано билетов: ${res.issued_count}.${failedNote}`;
      showToast(`Выдано билетов: ${res.issued_count}`, res.issued_count > 0 ? 'ok' : 'error');
      document.getElementById('wheel-reason').value = '';
      _wheelIssueSelected = [];
      renderChosenList();
    } catch (err) {
      statusEl.className = 'status-line status-error';
      statusEl.textContent = err.message || 'Не удалось выдать билеты';
    } finally {
      issueBtn.disabled = _wheelIssueSelected.length === 0;
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

async function renderTestsOperatorView(el) {
  const myNavGen = STATE.navGen;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Обучение</div><h1 class="section-title">Мои тесты</h1><div class="section-subtitle">Проверяйте знания и получайте награды за результат.</div></div>
      <button class="btn-outline btn-sm" onclick="renderTests()">Обновить</button>
    </div>
    <div id="tests-op-body">${uiLoadingBlock('Загружаем данные')}</div>`;

  let data;
  try {
    // Статус попытки нельзя брать из stale-while-revalidate кеша: sessionStorage
    // переживает F5, поэтому сохранённый до старта список мог вернуть тест как
    // available и скрыть уже идущую попытку. Для этого экрана всегда читаем
    // серверное состояние напрямую и лишь обновляем кеш для фонового prefetch.
    data = await api.myTests();
    swrWriteRaw('tests:my', { data, ts: Date.now() });
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
  const completed = items.filter(t => t.status === 'finished');
  const expired = items.filter(t => t.status === 'expired');
  const history = [...completed, ...expired].sort((a, b) =>
    new Date(b.finished_at || 0) - new Date(a.finished_at || 0)
  );
  const upcoming = items.filter(t => t.status === 'upcoming');
  const averageScore = completed.length
    ? completed.reduce((sum, test) => sum + Number(test.score_percent || 0), 0) / completed.length
    : null;

  const body = el.querySelector('#tests-op-body');
  if (!items.length) {
    body.innerHTML = `<div class="empty-state"><p>Доступных тестов пока нет.</p></div>`;
    return;
  }

  body.innerHTML = `
    <div class="tests-summary-strip">
      <div><span>Новые задания</span><strong>${available.length}</strong></div>
      <div><span>Пройдено тестов</span><strong>${completed.length}</strong></div>
      <div><span>Средний результат</span><strong>${averageScore === null ? '—' : `${fmtA(averageScore, 0)}%`}</strong></div>
    </div>
    <section class="tests-section">
      <div class="tests-section-head"><div><h3>Новые задания</h3><p>Тесты, которые можно пройти сейчас.</p></div></div>
      ${available.length ? `<div class="test-card-grid">${available.map(testCardHtml).join('')}</div>` : `<div class="tests-empty-compact">Сейчас нет тестов для прохождения.</div>`}
    </section>
    ${upcoming.length ? `<section class="tests-section"><div class="tests-section-head"><div><h3>Скоро откроются</h3><p>Будущие задания.</p></div></div><div class="test-card-grid">${upcoming.map(testCardHtml).join('')}</div></section>` : ''}
    <section class="tests-section">
      <div class="tests-section-head"><div><h3>Мои результаты</h3><p>Пройденные тесты и полученные награды.</p></div></div>
      ${history.length ? `<div class="test-history-list">${history.map(testHistoryItemHtml).join('')}</div>` : `<div class="tests-empty-compact">Завершённых тестов пока нет.</div>`}
    </section>`;

  body.querySelectorAll('[data-test-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const testId = Number(btn.dataset.testId);
      const action = btn.dataset.testAction;
      if (action === 'start' || action === 'continue') openTestRunner(testId);
      if (action === 'result') openTestResultModal(btn.dataset.attemptId);
    });
  });
}

function testHistoryItemHtml(t) {
  const isFinished = t.status === 'finished';
  const dateLabel = t.finished_at ? fmtDate(t.finished_at) : 'Дата не указана';
  const resultLabel = t.passed === true ? 'Пройден' : (t.passed === false ? 'Нужно повторить' : 'Не завершён');
  const resultClass = t.passed === true ? 'is-passed' : (t.passed === false ? 'is-failed' : 'is-expired');
  const earned = [];
  if (Number(t.reward_coins_earned) > 0) earned.push(`+${fmtA(t.reward_coins_earned, 0)} коинов`);
  if (Number(t.reward_points_earned) > 0) earned.push(`+${fmtA(t.reward_points_earned, 0)} баллов`);

  return `<article class="test-history-item">
    <div class="test-history-main">
      <div class="test-history-date">${esc(dateLabel)}</div>
      <h4>${esc(t.title)}</h4>
      ${t.description ? `<p>${esc(t.description)}</p>` : `<p>${t.questions_count} вопросов</p>`}
    </div>
    <div class="test-history-score">
      ${isFinished ? `<strong>${fmtA(t.score_percent, 0)}%</strong><span>${t.correct_count} из ${t.questions_count} правильно</span>` : `<strong>—</strong><span>Тест не завершён</span>`}
    </div>
    <div class="test-history-outcome">
      <span class="test-history-status ${resultClass}">${resultLabel}</span>
      ${earned.length ? `<small>${earned.join(' · ')}</small>` : '<small>Без награды</small>'}
    </div>
    <div class="test-history-action">
      ${isFinished ? `<button class="btn-outline btn-sm" data-test-action="result" data-attempt-id="${t.attempt_id}">Посмотреть результат</button>` : ''}
    </div>
  </article>`;
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
  const rewardParts = [];
  if (t.reward_type?.includes('coins')) rewardParts.push(`${t.reward_coins} ₡`);
  if (t.reward_type?.includes('points')) rewardParts.push(`${fmtA(t.reward_points, 0)} баллов`);
  const rewardLabel = rewardParts.join(' + ') || 'Без награды';

  let actionHtml = '';
  if (t.status === 'available') {
    actionHtml = `<button class="btn-primary btn-sm" data-test-action="start" data-test-id="${t.id}">Начать тест</button>`;
  } else if (t.status === 'in_progress') {
    actionHtml = `<button class="btn-primary btn-sm" data-test-action="continue" data-test-id="${t.id}">Продолжить</button>`;
  } else if (t.status === 'upcoming') {
    actionHtml = `<div class="test-card-disabled-note">Тест откроется ${fmtDateTime(t.opens_at)}</div>`;
  } else if (t.status === 'finished') {
    actionHtml = `<div class="test-card-result"><b>${fmtA(t.score_percent,0)}%</b><span>${t.correct_count} из ${t.questions_count} верно</span></div>
      ${t.reward_coins_earned ? `<div class="test-card-reward-earned">Получено +${t.reward_coins_earned} ₡</div>` : ''}
      <button class="btn-outline btn-sm" data-test-action="result" data-attempt-id="${t.attempt_id}">Подробнее</button>`;
  } else if (t.status === 'expired') {
    actionHtml = `<div class="test-card-disabled-note">Срок прохождения истёк</div>`;
  } else {
    actionHtml = `<div class="test-card-disabled-note">Недоступен</div>`;
  }

  return `<article class="test-card">
    <div class="test-card-head">
      <div><div class="test-card-title">${esc(t.title)}</div>${t.description ? `<div class="test-card-desc">${esc(t.description)}</div>` : ''}</div>
      ${testStatusBadge(t.status)}
    </div>
    <div class="test-card-meta">
      <span>${t.questions_count} вопросов</span><span>${t.time_limit_minutes} мин</span><span class="test-card-reward">${esc(rewardLabel)}</span>
    </div>
    ${t.closes_at && ['available', 'in_progress', 'upcoming'].includes(t.status) ? `<div class="test-card-deadline">До ${fmtDateTime(t.closes_at)}</div>` : ''}
    <div class="test-card-actions">${actionHtml}</div>
  </article>`;
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
      <div><div class="section-kicker">Тесты</div><h1 class="section-title">Результат теста</h1></div>
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

async function renderTestsStaffView(el) {
  const myNavGen = STATE.navGen;
  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Обучение команды</div><h1 class="section-title">Тесты</h1><div class="section-subtitle">Создавайте проверки знаний и отслеживайте результаты операторов.</div></div>
      <div class="header-right">
        <button class="btn-outline btn-sm" onclick="renderTests()">Обновить</button>
        <button class="btn-primary btn-sm" id="tests-new-btn">Создать тест</button>
      </div>
    </div>
    <div id="tests-staff-body">${uiLoadingBlock('Загружаем данные')}</div>`;

  el.querySelector('#tests-new-btn').addEventListener('click', () => openTestBuilder(null));

  let data;
  try {
    data = await swrFetch('tests:admin-list', () => api.listAdminTests(), null, SWR_FAST_TTL_MS);
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

  const openCount = items.filter(t => t.status === 'open').length;
  const draftCount = items.filter(t => ['draft', 'scheduled'].includes(t.status)).length;
  const finishedAttempts = items.reduce((sum, t) => sum + Number(t.attempts_finished || 0), 0);
  const averages = items.filter(t => t.average_percent != null).map(t => Number(t.average_percent));
  const averageScore = averages.length ? Math.round(averages.reduce((sum, value) => sum + value, 0) / averages.length) : 0;

  body.innerHTML = `
    <div class="tests-admin-summary">
      <div><span>Всего тестов</span><strong>${items.length}</strong></div>
      <div><span>Открыты сейчас</span><strong>${openCount}</strong></div>
      <div><span>Черновики и планы</span><strong>${draftCount}</strong></div>
      <div><span>Завершено попыток</span><strong>${finishedAttempts}</strong></div>
      <div><span>Средний результат</span><strong>${averageScore}%</strong></div>
    </div>
    <div class="tests-admin-panel">
      <div class="tests-admin-toolbar">
        <div class="filter-tabs tests-filter-tabs">
          <button class="filter-tab active" data-tests-filter="all">Все <span>${items.length}</span></button>
          <button class="filter-tab" data-tests-filter="open">Открытые <span>${openCount}</span></button>
          <button class="filter-tab" data-tests-filter="draft">Черновики <span>${draftCount}</span></button>
          <button class="filter-tab" data-tests-filter="finished">Завершённые <span>${items.filter(t => t.status === 'finished').length}</span></button>
        </div>
      </div>
      <div class="tests-admin-list">
        ${items.map(t => `<article class="tests-admin-row" data-test-status="${t.status}">
          <div class="tests-admin-main">
            <div class="tests-admin-title-line"><h3>${esc(t.title)}</h3><span class="badge ${statusBadgeClass[t.status]||'badge-neutral'}">${statusLabel[t.status]||t.status}</span></div>
            <div class="tests-admin-meta"><span>${t.questions_count} вопросов</span><span>${t.time_limit_minutes} мин</span><span>${t.opens_at ? `Старт ${fmtDateTime(t.opens_at)}` : 'Без даты старта'}</span></div>
          </div>
          <div class="tests-admin-result"><span>Прошли</span><strong>${t.attempts_finished}</strong></div>
          <div class="tests-admin-result"><span>Средний результат</span><strong>${t.average_percent != null ? t.average_percent + '%' : '—'}</strong></div>
          <div class="tests-admin-actions">
            <button class="btn-outline btn-sm" data-test-results="${t.id}">Результаты</button>
            <button class="btn-outline btn-sm" data-test-edit="${t.id}">Настроить</button>
            ${t.status==='draft'||t.status==='scheduled' ? `<button class="btn-primary btn-sm" data-test-publish="${t.id}">Опубликовать</button>` : ''}
            ${t.status==='open' ? `<button class="btn-outline btn-sm" data-test-close="${t.id}">Закрыть</button>` : ''}
          </div>
        </article>`).join('')}
      </div>
    </div>`;

  body.querySelectorAll('[data-tests-filter]').forEach(button => button.addEventListener('click', () => {
    body.querySelectorAll('[data-tests-filter]').forEach(item => item.classList.toggle('active', item === button));
    const filter = button.dataset.testsFilter;
    body.querySelectorAll('[data-test-status]').forEach(row => {
      const status = row.dataset.testStatus;
      const visible = filter === 'all' || status === filter || (filter === 'draft' && ['draft', 'scheduled'].includes(status));
      row.hidden = !visible;
    });
  }));

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
      <div><div class="section-kicker">Конструктор теста</div><h1 class="section-title">${s.testId ? 'Настройка теста' : 'Новый тест'}</h1><div class="section-subtitle">Заполните параметры, добавьте вопросы и назначьте аудиторию.</div></div>
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
async function openTestResultsView(testId) {
  const el = document.getElementById('view-tests');
  if (!el) return;

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Тесты</div><h1 class="section-title">Результаты</h1></div>
      <button class="btn-outline btn-sm" onclick="renderTests()">К списку</button>
    </div>
    <div class="filter-tabs" id="tr-tabs">
      <button class="filter-tab active" data-tr-tab="results">Результаты</button>
      <button class="filter-tab" data-tr-tab="analytics">Аналитика</button>
    </div>
    <div id="tr-body">${uiLoadingBlock('Загружаем данные')}</div>`;

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
  body.innerHTML = uiLoadingBlock('Загружаем данные');
  try {
    const data = await api.getTestResults(testId);
    const items = data.items || [];
    if (!items.length) {
      body.innerHTML = `<div class="empty-state"><p>По выбранным фильтрам операций не найдено.</p></div>`;
      return;
    }
    body.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th scope="col">Оператор</th><th scope="col">Группа</th><th scope="col">Статус</th><th scope="col">Начал</th><th scope="col">Завершил</th>
        <th scope="col" class="num">Время</th><th scope="col" class="num">Правильных</th><th scope="col" class="num">%</th>
        <th scope="col" class="num">Баллы</th><th scope="col" class="num">Коины</th><th scope="col" class="num">Попытка</th>
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
  body.innerHTML = uiLoadingBlock('Загружаем данные');
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
        <thead><tr><th scope="col">Вопрос</th><th scope="col" class="num">Правильных</th><th scope="col" class="num">Неправильных</th><th scope="col" class="num">% ошибок</th></tr></thead>
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
