/* Выделено из 60-wheel-tests.view.js (2603 строки).
   Палитра, отрисовка SVG-колеса, вращение, результат, боковая панель. */

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
