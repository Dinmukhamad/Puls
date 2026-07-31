let _ratingActiveTab = 'overview';

async function exportRatingFromRatingPage() {
  try {
    const summary = await swrFetch('admin-summary:', () => api.getAdminSummary({}), null, SWR_FAST_TTL_MS);
    if (!summary.period_start) { showToast('Нет рассчитанных недель для экспорта', 'error'); return; }
    window.open(api.exportUrl('/api/exports/rating', { period_start: summary.period_start, period_end: summary.period_end, format: 'csv' }), '_blank');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function renderStaffRating() {
  const el = document.getElementById('view-rating');
  if (!el) return;
  const myNavGen = STATE.navGen; // раздел "Рейтинг" уже активен — фиксируем текущее поколение

  el.innerHTML = `
    <div class="view-header">
      <div><div class="section-kicker">Рейтинг</div><h2 class="section-title">Турнирная таблица</h2></div>
      <div class="header-right">
        ${isAdmin(STATE.user?.role) ? '<button class="btn-outline btn-sm" onclick="exportRatingFromRatingPage()">Экспорт CSV</button>' : ''}
        <button class="btn-outline btn-sm" onclick="renderRating()">Обновить</button>
      </div>
    </div>
    <div class="analytics-tabs" id="rating-tabs">
      ${RATING_TABS.map(t => `<button class="analytics-tab ${t.key===_ratingActiveTab?'active':''}" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
    </div>
    <div id="rating-tab-content"></div>
  `;

  el.querySelectorAll('.analytics-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.analytics-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _ratingActiveTab = btn.dataset.tab;
      loadStaffRatingTab(_ratingActiveTab);
    });
  });

  if (isNavStale(myNavGen)) return; // пользователь уже ушёл с "Рейтинга" — дальше не рисуем
  await loadStaffRatingTab(_ratingActiveTab);
}

async function loadStaffRatingTab(tab) {
  const content = document.getElementById('rating-tab-content');
  if (!content) return;
  const myNavGen = STATE.navGen;
  const myTabGen = bumpRatingTabGen(); // отменяет любой ещё не завершённый рендер предыдущей вкладки
  // Спиннер с задержкой 150мс — если данные уже в кеше (sessionStorage),
  // swrFetch отдаст их синхронно внутри render*Tab-функций раньше, чем
  // успеет сработать таймер, и переключение вкладок будет мгновенным.
  const spinnerTimer = setTimeout(() => {
    if (isNavStale(myNavGen) || isRatingTabStale(myTabGen)) return;
    content.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>';
  }, 150);

  try {
    if (tab === 'overview') await renderRatingOverviewTab(content);
    else if (tab === 'race') await renderRatingRaceTab(content);
    else if (tab === 'groups') await renderRatingGroupsTab(content);
    else if (tab === 'progress') await renderRatingProgressTab(content);
  } catch(e) {
    clearTimeout(spinnerTimer);
    if (isNavStale(myNavGen) || isRatingTabStale(myTabGen)) return; // ушли в другой раздел/вкладку — не показываем чужую ошибку
    content.innerHTML = `<div class="rating-card"><div class="status-line status-error">Не удалось загрузить: ${esc(e.message)}</div></div>`;
    return;
  }
  clearTimeout(spinnerTimer);
  // Успешный рендер прошёл, но пока ждали ответ сервера пользователь мог уже
  // переключиться на другой раздел или другую вкладку — в этом случае контент,
  // который только что записали внутренние render*Tab-функции, всё равно устарел.
  if (isNavStale(myNavGen) || isRatingTabStale(myTabGen)) {
    content.innerHTML = '';
  }
}

/* ── Вкладка: Гонка баллов ─────────────────────────────────────*/
let _raceState = { groupId: '', mode: 'my_zone' };

async function fetchRace(params, onUpdate) {
  const key = 'race:' + JSON.stringify(params || {});
  return swrFetch(key, async () => {
    return api.getRatingRace(params);
  }, onUpdate, ANALYTICS_SWR_TTL_MS);
}

async function renderRatingRaceTab(content) {
  let groupOptions = '<option value="">Все группы</option>';
  try {
    const groups = await swrFetch('groups:active', () => api.listGroups(true), null, SWR_STATIC_TTL_MS);
    groupOptions += (groups || []).map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  } catch(e) { /* ignore */ }

  // У admin/manager/supervisor нет своего operator_id — для них "Моя зона"
  // и "Ваш результат" не имеют смысла (нет личного места в рейтинге
  // операторов). Принудительно переключаем на "Топ-10" и не показываем
  // кнопку "Моя зона" вовсе, чтобы не путать управленческий аккаунт.
  const hasOwnOperatorRecord = Boolean(STATE.user?.operator_id);
  if (!hasOwnOperatorRecord && _raceState.mode === 'my_zone') {
    _raceState.mode = 'top10';
  }

  content.innerHTML = `
    <div class="race-card">
      <div class="race-header-row">
        <div>
          <div class="race-title">Гонка баллов</div>
          <div class="race-subtitle">Сравните свои баллы с другими операторами и группами</div>
        </div>
        <div id="race-my-place-badge"></div>
      </div>
      <div class="race-filters-row">
        <select id="race-group-filter" class="race-select">${groupOptions}</select>
        <div class="race-segmented" id="race-mode-switcher">
          ${hasOwnOperatorRecord ? `<button class="race-seg-btn ${_raceState.mode==='my_zone'?'active':''}" data-mode="my_zone">Моя зона</button>` : ''}
          <button class="race-seg-btn ${_raceState.mode==='top10'?'active':''}" data-mode="top10">Топ-10</button>
          <button class="race-seg-btn ${_raceState.mode==='top20'?'active':''}" data-mode="top20">Топ-20</button>
          <button class="race-seg-btn ${_raceState.mode==='all'?'active':''}" data-mode="all">Все</button>
        </div>
      </div>
      <div id="race-chart-wrap"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
    </div>
    <div id="race-bottom-grid"></div>
  `;

  const groupFilter = content.querySelector('#race-group-filter');
  groupFilter.value = _raceState.groupId;
  if (groupFilter.value !== _raceState.groupId) _raceState.groupId = groupFilter.value;

  async function reload() {
    const params = { mode: _raceState.mode };
    if (_raceState.groupId) params.group_id = _raceState.groupId;
    const data = await fetchRace(params);
    renderRaceContent(content, data);
  }

  groupFilter.addEventListener('change', (e) => {
    _raceState.groupId = e.target.value;
    reload();
  });
  content.querySelectorAll('#race-mode-switcher .race-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('#race-mode-switcher .race-seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _raceState.mode = btn.dataset.mode;
      reload();
    });
  });

  await reload();
}

/**
 * Перестраивает порядок элементов под режим "Моя зона": текущий оператор
 * в центре, слева — те, у кого баллов больше (выше по рейтингу),
 * справа — те, у кого меньше. Бэкенд возвращает срез ±5 от оператора,
 * уже отсортированный по убыванию баллов (rank 1..N) — здесь просто
 * физически переставляем массив так, чтобы "Я" оказался посередине.
 */
function reorderForMyZone(items) {
  const meIdx = items.findIndex(i => i.is_current_user);
  if (meIdx === -1) return items; // нет своих данных — оставляем как есть (Топ-N логика)

  const above = items.slice(0, meIdx);       // у кого баллов больше (rank меньше)
  const me = items[meIdx];
  const below = items.slice(meIdx + 1);      // у кого баллов меньше

  // above уже идёт от дальнего к ближнему (по убыванию rank, т.е. ближе к концу — ближе к "Я")
  // Хотим: [дальние слева ... близкие слева][Я][близкие справа ... дальние справа]
  return [...above, me, ...below];
}

function renderRaceContent(content, data) {
  const itemsRaw = data.items || [];
  const cu = data.current_user;
  const items = _raceState.mode === 'my_zone' ? reorderForMyZone(itemsRaw) : itemsRaw;

  const badgeEl = content.querySelector('#race-my-place-badge');
  if (badgeEl) {
    badgeEl.innerHTML = cu
      ? `<div class="race-place-badge">Ваше место: <b>#${cu.rank}</b> из ${cu.total_participants}</div>`
      : '';
  }

  if (!items.length) {
    content.querySelector('#race-chart-wrap').innerHTML = `<div class="race-empty-line">${esc(data.message || 'Нет данных для отображения')}</div>`;
    content.querySelector('#race-bottom-grid').innerHTML = '';
    return;
  }

  content.querySelector('#race-chart-wrap').innerHTML = renderRaceSummary(itemsRaw, cu, data) + renderRaceChart(items);

  content.querySelector('#race-bottom-grid').innerHTML = `
    <div class="race-detail-grid">
      ${renderRaceMyCard(cu, data.not_in_group_note, items)}
      ${renderRaceTopTable(itemsRaw, cu)}
    </div>
  `;
}

function renderRaceSummary(items, cu, data) {
  const visible = items || [];
  const leader = visible[0];
  const avg = visible.length
    ? Math.round(visible.reduce((sum, item) => sum + (Number(item.points) || 0), 0) / visible.length)
    : 0;
  const currentPoints = cu ? Math.round(cu.points || 0) : null;
  const nextGap = cu?.points_to_next_rank != null ? Math.round(cu.points_to_next_rank) : null;

  return `<div class="race-summary-strip">
    <div class="race-summary-item">
      <span class="race-summary-label">Лидер</span>
      <b>${leader ? esc(leader.full_name) : '—'}</b>
      <em>${leader ? Math.round(leader.points) + ' баллов' : 'нет данных'}</em>
    </div>
    <div class="race-summary-item">
      <span class="race-summary-label">Участников</span>
      <b>${data.total_participants || visible.length}</b>
      <em>${_raceState.mode === 'my_zone' ? 'в вашей зоне' : 'в выборке'}</em>
    </div>
    <div class="race-summary-item">
      <span class="race-summary-label">Средний балл</span>
      <b>${avg}</b>
      <em>по показанным</em>
    </div>
    <div class="race-summary-item race-summary-item-accent">
      <span class="race-summary-label">Ваш результат</span>
      <b>${currentPoints ?? '—'}</b>
      <em>${nextGap && nextGap > 0 ? `до следующего ${nextGap}` : 'позиция актуальна'}</em>
    </div>
  </div>`;
}

/* Цвет машинки по месту: топ-1/2/3 — особые цвета, текущий оператор — синий,
   остальные — циклически по палитре (используем реальные PNG-иконки болидов). */
const RACE_CAR_IMAGES = {
  current: 'img/cars/blue.webp',
  rank1:   'img/cars/yellow.webp',  // золото/лидер
  rank2:   'img/cars/green.webp',   // серебро (зелёный — нейтральный, не путать с топ-1)
  rank3:   'img/cars/orange.webp',  // бронза
  default: ['img/cars/purple.webp', 'img/cars/red.webp'],
};

function raceCarImageSrc(rank, isCurrentUser) {
  if (isCurrentUser) return RACE_CAR_IMAGES.current;
  if (rank === 1) return RACE_CAR_IMAGES.rank1;
  if (rank === 2) return RACE_CAR_IMAGES.rank2;
  if (rank === 3) return RACE_CAR_IMAGES.rank3;
  const palette = RACE_CAR_IMAGES.default;
  return palette[rank % palette.length];
}

function raceCarRankClass(rank, isCurrentUser) {
  if (isCurrentUser) return 'is-current-user';
  if (rank === 1) return 'rank-1';
  if (rank === 2) return 'rank-2';
  if (rank === 3) return 'rank-3';
  return 'default';
}

function renderRaceChart(items) {
  const maxPoints = Math.max(...items.map(i => i.points), 1);
  const rawMax = maxPoints * 1.3;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax || 1)));
  const niceMax = Math.ceil(rawMax / (magnitude / 2)) * (magnitude / 2) || 100;
  const ticks = [];
  for (let v = 0; v <= niceMax; v += niceMax / 5) ticks.push(Math.round(v));

  // ── Геометрия столбца сверху вниз (от верха контейнера к низу) ──
  // [ цифра баллов ]  18px текста + 6px зазор до машинки
  // [ зазор 6px ]
  // [ машинка ]        36px макс. высота (растёт вверх от carBottom)
  // [ зазор 14px ]     визуальный воздух между машинкой и верхом столбца
  // [ столбец ]        высота = barH, пропорциональна баллам
  // [ подпись инициалов ]  внизу, в зоне padBottom

  const labelH = 24;     // высота строки с цифрой баллов
  const labelGap = 8;    // зазор между цифрой и машинкой
  const carH = 44;       // максимальная высота машинки
  const carGap = 12;     // зазор между машинкой и верхом столбца
  const padTop = labelH + labelGap + carH + carGap + 10;
  const padBottom = 58;
  const plotH = items.length <= 12 ? 228 : 216;
  const chartH = plotH + padTop + padBottom;
  const usableH = plotH;

  const n = items.length;
  const barW = n <= 6 ? 64 : n <= 12 ? 54 : 42;
  const gap = n <= 6 ? 28 : n <= 12 ? 20 : 14;
  const stretch = n <= 12;

  return `<div class="race-chart-scroll">
    <div class="race-chart ${stretch ? 'race-chart-stretch' : ''}" style="height:${chartH}px">
      <div class="race-axis-labels" style="height:${usableH}px;margin-top:${padTop}px">
        ${ticks.slice().reverse().map(t => `<div class="race-axis-tick">${t}</div>`).join('')}
      </div>
      <div class="race-bars-area" style="height:${chartH}px;gap:${gap}px;${stretch ? '' : `min-width:${n * (barW+gap) + 40}px`}">
        ${ticks.map((t,i) => i>0 ? `<div class="race-grid-line" style="bottom:${padBottom + (t/niceMax)*usableH}px"></div>` : '').join('')}
        ${items.map(it => {
          const barH = Math.max(4, (it.points / niceMax) * usableH);
          const rankClass = raceCarRankClass(it.rank, it.is_current_user);
          const colWidth = stretch ? `calc((100% - ${(n-1)*gap}px) / ${n})` : `${barW}px`;
          // carBottom — нижняя точка машинки (она сама растёт вверх на свою высоту через CSS transform)
          const labelBottom = padBottom + barH + carGap;
          // labelBottom — нижний край текста, должен быть выше верха машинки (carBottom + carH) + зазор
          const carBottom = labelBottom + labelH + labelGap;
          return `<div class="race-col ${rankClass} ${it.is_current_user?'race-col-me':''}" style="width:${colWidth};flex:${stretch?'1 1 0':'0 0 auto'}" data-race-operator="${it.operator_id}"
              title="${esc(it.full_name)}${it.group?' · '+esc(it.group):''} · место #${it.rank} · ${Math.round(it.points)} баллов">
            <div class="race-points-label" style="bottom:${labelBottom}px">${Math.round(it.points)}</div>
            <img class="race-car-icon ${rankClass}" style="bottom:${carBottom}px" src="${raceCarImageSrc(it.rank, it.is_current_user)}" alt="" loading="lazy">
            <div class="race-bar ${it.is_current_user?'race-bar-me':''} ${rankClass}" style="height:${barH}px;bottom:${padBottom}px"></div>
            <div class="race-x-label ${it.is_current_user?'race-x-label-me':''}">
              <span>${esc(it.initials)}</span>
              <small>#${it.rank}</small>
              ${it.is_current_user ? '<div class="race-you-tag">Вы</div>' : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function renderRaceMyCard(cu, note, visibleItems) {
  const hasOwnOperatorRecord = Boolean(STATE.user?.operator_id);
  if (!hasOwnOperatorRecord) {
    // У управленческого аккаунта (admin/manager/supervisor) нет личного
    // места в рейтинге операторов — карточка "Ваш результат" здесь
    // бессмысленна, поэтому просто не показываем её вовсе.
    return '';
  }
  if (!cu) {
    return `<div class="rating-card race-side-card"><div class="rcard-title">Ваш результат</div>
      <div class="r-empty-state"><div>Ваши баллы за выбранный период пока не рассчитаны.</div></div>
    </div>`;
  }

  let hint;
  if (cu.rank === 1) {
    const nextBest = visibleItems?.find(i => !i.is_current_user);
    const gap = nextBest ? Math.round(cu.points - nextBest.points) : null;
    hint = gap != null
      ? `Вы лидер рейтинга. Ближайший оператор отстаёт на ${gap} баллов.`
      : `Вы лидер рейтинга. Удерживайте позицию.`;
  } else if (cu.points_to_next_rank != null && cu.points_to_next_rank > 0) {
    const above = visibleItems?.find(i => i.rank === cu.rank - 1);
    hint = above
      ? `Чтобы обогнать ${esc(above.full_name)}, нужно набрать ещё ${Math.round(cu.points_to_next_rank)} баллов.`
      : `До следующего места: <b>${Math.round(cu.points_to_next_rank)} баллов</b>`;
  } else {
    hint = '—';
  }

  const below = visibleItems?.filter(i => !i.is_current_user && i.points < cu.points).length ?? null;
  const nearestAbove = visibleItems?.filter(i => !i.is_current_user && i.points > cu.points).sort((a,b)=>a.points-b.points)[0];

  return `<div class="rating-card race-side-card">
    <div class="rcard-title">Ваш результат</div>
    ${cu.outside_selected_group ? `<div class="race-note">${esc(note || 'Вы не входите в выбранную группу.')}</div>` : ''}
    <div class="rms-list">
      <div class="rms-row"><span class="rms-label">Место</span><span class="rms-val">#${cu.rank} из ${cu.total_participants}</span></div>
      <div class="rms-row"><span class="rms-label">Баллы</span><span class="rms-val accent">${Math.round(cu.points)}</span></div>
      <div class="rms-row"><span class="rms-label">Группа</span><span class="rms-val">${esc(cu.group||'—')}</span></div>
      ${cu.points_to_top_3 != null && cu.points_to_top_3 > 0 ? `<div class="rms-row"><span class="rms-label">До топ-3</span><span class="rms-val">${Math.round(cu.points_to_top_3)} баллов</span></div>` : ''}
      <div class="rms-row"><span class="rms-label">Изменение</span><span class="rms-val">${cu.rank_change!=null ? (cu.rank_change>0?`<span class="rd-up">↑ +${cu.rank_change}</span>`:cu.rank_change<0?`<span class="rd-down">↓ ${Math.abs(cu.rank_change)}</span>`:'<span class="rd-neutral">без изменений</span>') : '—'}</span></div>
    </div>
    ${below != null ? `<div class="race-extra-line">Вы опережаете ${below} операторов${nearestAbove ? ` · отстаёте от ближайшего на ${Math.round(nearestAbove.points - cu.points)} баллов` : ''}</div>` : ''}
    <div class="race-hint">${hint}</div>
  </div>`;
}

function renderRaceTopTable(items, cu) {
  const myPoints = cu ? cu.points : null;
  return `<div class="rating-card race-side-card">
    <div class="rcard-title">Топ операторов</div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>#</th><th>Оператор</th><th>Группа</th><th class="num">Баллы</th><th class="num">Разница с вами</th></tr></thead>
      <tbody>
        ${items.slice(0, 10).map(it => {
          const diff = myPoints != null ? Math.round(it.points - myPoints) : null;
          const diffHtml = it.is_current_user ? '—' : (diff == null ? '—' : (diff > 0 ? `<span style="color:var(--danger)">+${diff}</span>` : diff < 0 ? `<span style="color:var(--success)">${diff}</span>` : '0'));
          return `<tr class="${it.is_current_user?'rating-my-row':''}">
            <td>${it.rank}</td>
            <td class="name-cell">${it.is_current_user?'Вы':esc(it.full_name)}</td>
            <td>${esc(it.group||'—')}</td>
            <td class="num"><b>${Math.round(it.points)}</b></td>
            <td class="num">${diffHtml}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
  </div>`;
}

/* ── Вкладка: Сравнение групп ────────────────────────────────────*/
async function renderRatingGroupsTab(content) {
  const data = await fetchRace({ mode: 'all' });
  const groups = data.groups || [];
  const cu = data.current_user;

  if (!groups.length) {
    content.innerHTML = `<div class="rating-card"><div class="empty-line">Нет данных для сравнения групп</div></div>`;
    return;
  }

  const rows = groups.map(g => ({ label: g.group, value: g.avg_points, isMe: false }));
  if (cu) rows.push({ label: 'Вы', value: cu.points, isMe: true });
  rows.sort((a,b) => b.value - a.value);
  const maxV = Math.max(...rows.map(r => r.value), 1);

  content.innerHTML = `
    <div class="rating-card">
      <div class="rcard-title">Сравнение групп</div>
      <div class="an-bar-chart">
        ${rows.map(r => `<div class="an-bar-row">
          <div class="an-bar-date" style="width:120px;${r.isMe?'font-weight:700;color:var(--accent-primary)':''}">${esc(r.label)}</div>
          <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.round((r.value/maxV)*100)}%;${r.isMe?'background:var(--accent-primary)':''}"></div></div>
          <div class="an-bar-val">${Math.round(r.value)}</div>
        </div>`).join('')}
      </div>
    </div>
  `;
}

/* ── Вкладка: Мой прогресс ───────────────────────────────────────*/
async function renderRatingProgressTab(content) {
  const role = STATE.user?.role || 'operator';
  const isOp = role === 'operator';

  if (!isOp) {
    content.innerHTML = `<div class="rating-card"><div class="empty-line">Выберите оператора во вкладке «Общий рейтинг», чтобы увидеть прогресс</div></div>`;
    return;
  }

  try {
    const dyn = await api.getMyRatingDynamics('place', 8);
    content.innerHTML = `<div class="rating-card">
      <div class="rcard-title">Динамика места за последние недели</div>
      ${renderDynamics ? renderDynamics(dyn) : '<div class="empty-line">Нет данных</div>'}
    </div>`;
  } catch(e) {
    content.innerHTML = `<div class="rating-card"><div class="empty-line">Нет данных о прогрессе</div></div>`;
  }
}

window.renderRating = renderRating;

const WHEEL_PRIZE_ICON = {
  coins: '₡', shop_discount: '%', extra_ticket: '+1', badge: '★', manual_reward: '!',
};
const WHEEL_FAST_MS = 900;
const WHEEL_TTL_MS = 45_000;
const WHEEL_STATIC_TTL_MS = 5 * 60_000;
