/* Operator workspace v3: one visual system for cabinet and rating. */

const OP_COIN = '₡';

function opNum(value, digits = 0) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('ru-RU', { maximumFractionDigits: digits }) : '0';
}

function opCoin(value, sign = false) {
  const number = Number(value || 0);
  return `${sign && number > 0 ? '+' : ''}${opNum(number)} <span class="op-coin">${OP_COIN}</span>`;
}

function opPercent(value) {
  return `${opNum(value, 1)}%`;
}

function opEmpty(title, text) {
  return `<div class="op-empty"><div class="op-empty-mark">—</div><b>${esc(title)}</b><span>${esc(text || '')}</span></div>`;
}

function opPanel(title, body, meta = '', className = '') {
  return `<section class="op-panel ${className}">
    <header class="op-panel-head"><h3>${title}</h3>${meta ? `<span>${meta}</span>` : ''}</header>
    <div class="op-panel-body">${body}</div>
  </section>`;
}

function opMetric(label, value, target, tone = '') {
  const metricNumber = raw => Number(String(raw ?? 0).replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
  const current = metricNumber(value);
  const goal = metricNumber(target);
  const width = goal > 0 ? Math.min(100, Math.max(0, current / goal * 100)) : Math.min(100, Math.max(0, current));
  return `<div class="op-metric">
    <div class="op-metric-line"><span>${esc(label)}</span><b>${esc(String(value))}${target ? ` <small>/ ${esc(String(target))}</small>` : ''}</b></div>
    <div class="op-progress"><i class="${tone}" style="width:${width}%"></i></div>
  </div>`;
}

function opCabinetLevel(levelInfo) {
  if (!levelInfo) return opEmpty('Уровень не рассчитан', 'Данные появятся после первого расчёта периода.');
  const level = levelInfo.level || {};
  const gaps = levelInfo.gaps || [];
  return `<div class="op-level-main">
    <div><span class="op-label">Текущий уровень</span><div class="op-level-name">${levelBadgeHtml(level)} <strong>${esc(level.name || 'Стажёр')}</strong></div></div>
    <div class="op-level-tenure"><span>Стаж</span><b>${esc(formatTenureDays(levelInfo.metrics?.tenure_days || 0))}</b></div>
  </div>
  ${levelInfo.next_level ? `<div class="op-next-level"><span>Следующий уровень</span>${levelBadgeHtml(levelInfo.next_level)}</div>` : '<div class="op-success-line">Максимальный уровень достигнут</div>'}
  <div class="op-requirements">${gaps.length ? gaps.slice(0, 4).map(g => `<div class="op-requirement ${g.ok ? 'is-ready' : ''}"><span>${esc(g.label)}</span><b>${metricValueHtml(g)}</b><small>${g.ok ? 'Выполнено' : levelRequirementHtml(g)}</small></div>`).join('') : '<div class="op-success-line">Все требования выполнены</div>'}</div>`;
}

function opCabinetAchievements(data) {
  const completed = data?.completed || [];
  const pending = data?.in_progress || [];
  const rows = [...completed.map(x => ({ ...x, done: true })), ...pending.map(x => ({ ...x, done: false }))];
  if (!rows.length) return opEmpty('Достижений пока нет', 'Новые цели появятся после расчёта показателей.');
  return `<div class="op-achievement-grid">${rows.slice(0, 8).map(row => {
    const goal = Number(row.condition_value || 0);
    const progress = Number(row.progress_value || 0);
    const pct = row.done ? 100 : (goal > 0 ? Math.min(100, progress / goal * 100) : 0);
    return `<article class="op-achievement ${row.done ? 'is-done' : ''}">
      <span class="op-achievement-icon">${esc(row.icon || '★')}</span>
      <div><b>${esc(row.title || 'Достижение')}</b><small>${row.done ? 'Получено' : `${opNum(progress, 1)} из ${opNum(goal, 1)}`}</small><div class="op-mini-progress"><i style="width:${pct}%"></i></div></div>
    </article>`;
  }).join('')}</div>`;
}

function opCabinetWeek(metrics) {
  if (!metrics) return opEmpty('Период ещё не рассчитан', 'После загрузки отчёта здесь появятся показатели недели.');
  return `${opMetric('Выработка часов', opNum(metrics.hours, 1), opNum(metrics.hours_target, 1), 'is-green')}
    ${opMetric('Качество', opPercent(metrics.quality), opPercent(metrics.quality_target), 'is-blue')}
    ${opMetric('Эффективность', opPercent(metrics.efficiency), '', 'is-violet')}
    <div class="op-stat-triplet">
      <div><span>Звонков в час</span><b>${opNum(metrics.calls_per_hour, 1)}</b></div>
      <div><span>Опоздания</span><b>${opNum(metrics.late_minutes)} мин</b></div>
      <div><span>Нарушения</span><b>${opNum(metrics.violations)}</b></div>
    </div>`;
}

function opCabinetCoins(calc) {
  if (!calc) return opEmpty('Расчёта пока нет', 'Коины появятся после расчёта периода.');
  const bonuses = calc.bonuses || [];
  return `<div class="op-calc-total"><span>Итоговый балл</span><b>${opNum(calc.contest_points, 1)}</b></div>
    <div class="op-calc-row"><span>Базовые коины</span><b>${opCoin(calc.base_coins)}</b></div>
    ${bonuses.map(b => `<div class="op-calc-row is-bonus"><span>${esc(b.label || b.type)}</span><b>${opCoin(b.coins, true)}</b></div>`).join('')}
    <div class="op-calc-final"><span>Итого за неделю</span><b>${opCoin(calc.total_week_coins)}</b></div>
    <div class="op-calc-note">${calc.is_final ? 'Начисление применено' : 'Предварительный расчёт'}</div>`;
}

function opCabinetWheel(status, winners) {
  const tickets = Number(status?.available_tickets || 0);
  const top = winners?.top;
  return `<div class="op-wheel-main">
    <div class="op-wheel-badge">WOW</div>
    <div><span class="op-label">Доступные вращения</span><strong>${tickets}</strong><p>${esc(status?.message || 'Выполняйте условия, чтобы получить билет.')}</p></div>
    <button class="${tickets ? 'btn-primary' : 'btn-outline'}" onclick="navigateTo('wheel')">${tickets ? 'Крутить' : 'Открыть колесо'}</button>
  </div>
  ${top ? `<div class="op-winner"><span>Крупнейший приз сегодня</span><b>${esc(top.operator_name || '—')}</b><strong>${top.prize_type === 'coins' ? opCoin(top.amount, true) : esc(top.prize || '—')}</strong></div>` : '<div class="op-wheel-foot">Сегодня победителей пока нет</div>'}`;
}

function opTransactions(items) {
  if (!items?.length) return opEmpty('Операций пока нет', 'История начислений появится здесь.');
  return `<div class="op-list">${items.slice(0, 6).map(row => `<div class="op-list-row"><div><b>${esc(row.comment || row.type || 'Операция')}</b><small>${fmtDate(row.date || row.created_at)}</small></div><strong class="${Number(row.amount) >= 0 ? 'is-positive' : 'is-negative'}">${opCoin(row.amount, true)}</strong></div>`).join('')}</div>`;
}

function opTopWeek(rows, currentId) {
  if (!rows?.length) return opEmpty('Рейтинг ещё не рассчитан', 'Результаты появятся после расчёта периода.');
  return `<div class="op-rank-list">${rows.slice(0, 5).map((row, index) => `<div class="op-rank-row ${Number(row.operator_id) === Number(currentId) ? 'is-me' : ''}"><span>${row.rank_position || index + 1}</span><div><b>${esc(row.operator_name || row.full_name || 'Оператор')}</b><small>${esc(row.group_name || 'Без группы')}</small></div><strong>${opNum(row.contest_points || row.final_score, 1)}</strong></div>`).join('')}</div>`;
}

function renderCabinet() {
  const el = document.getElementById('view-cabinet');
  if (!el) return;
  if (!['operator', 'supervisor'].includes(STATE.user?.role)) {
    el.innerHTML = `<div class="op-page">${opEmpty('Личный кабинет недоступен', 'Он предназначен для аккаунтов, связанных с оператором.')}</div>`;
    return;
  }
  const snapshot = STATE.cabinetSnapshot;
  if (!snapshot) {
    el.innerHTML = `<div class="op-page"><div class="op-page-head"><div><span>Кабинет</span><h1>Мой рабочий день</h1></div></div>${cabinetLoadingHtml()}</div>`;
    const nav = STATE.navGen;
    loadCabinetSnapshot(false).then(() => { if (!isNavStale(nav)) renderCabinet(); }).catch(() => { if (!isNavStale(nav)) renderCabinet(); });
    return;
  }
  syncCabinetSnapshot(snapshot);
  const wallet = snapshot.wallet || {};
  const rating = snapshot.rating || {};
  const level = snapshot.level || {};
  const tenure = formatTenureDays(level.metrics?.tenure_days || 0);
  const completed = snapshot.achievements?.completed?.length || 0;
  el.innerHTML = `<div class="op-page op-cabinet-page">
    <div class="op-page-head"><div><span>Кабинет оператора</span><h1>Мой рабочий день</h1><p>Главные результаты, цели и награды в одном месте</p></div><button class="btn-outline btn-sm" onclick="reloadCabinet()">Обновить</button></div>
    <div class="op-kpi-grid">
      <article class="op-kpi is-primary"><span>Баланс</span><strong>${opCoin(wallet.balance)}</strong><small>доступно для покупок</small></article>
      <article class="op-kpi"><span>За неделю</span><strong>${opCoin(wallet.earned_this_week)}</strong><small>заработано коинов</small></article>
      <article class="op-kpi"><span>Место</span><strong>${rating.place ? `#${rating.place} <small>из ${rating.total_participants}</small>` : '—'}</strong><small>${rating.delta ? `${rating.delta > 0 ? 'Выше' : 'Ниже'} на ${Math.abs(rating.delta)}` : 'без изменений'}</small></article>
      <article class="op-kpi"><span>Стаж</span><strong class="is-text">${esc(tenure)}</strong><small>${completed} достижений получено</small></article>
    </div>
    <div class="op-dashboard-grid op-dashboard-top">
      ${opPanel('Мой уровень', opCabinetLevel(snapshot.level), '', 'op-level-panel')}
      ${opPanel('Мои достижения', opCabinetAchievements(snapshot.achievements), `${completed} получено`, 'op-achievements-panel')}
    </div>
    <div class="op-dashboard-grid op-dashboard-week">
      ${opPanel('Показатели недели', opCabinetWeek(snapshot.week_metrics), snapshot.week_metrics ? `${fmtDate(snapshot.week_metrics.period_start)} — ${fmtDate(snapshot.week_metrics.period_end)}` : '')}
      ${opPanel('Расчёт коинов', opCabinetCoins(snapshot.coin_calculation), snapshot.coin_calculation?.is_final ? 'Начислено' : 'Предварительно')}
    </div>
    ${opPanel('Колесо WOW', opCabinetWheel(snapshot.wheel, snapshot.winners_today), '', 'op-wheel-panel')}
    <div class="op-dashboard-grid op-dashboard-bottom">
      ${opPanel('История начислений', opTransactions(snapshot.recent_transactions), `${snapshot.recent_transactions?.length || 0} операций`)}
      ${opPanel('Топ недели', opTopWeek(snapshot.top_week, snapshot.operator?.id), '', 'op-top-panel')}
    </div>
    <div class="op-shop-strip"><div><b>Магазин бонусов</b><span>Доступно ${opCoin(wallet.balance)} для обмена</span></div><button class="btn-primary" onclick="navigateTo('shop')">Открыть магазин</button></div>
  </div>`;
}

async function opRatingRequest(path, fallback) {
  try { return await api._req('GET', path); } catch (_) { return fallback; }
}

function opRatingTabs() {
  return `<div class="op-tabs">${RATING_TABS.map(tab => `<button class="${tab.key === _ratingActiveTab ? 'active' : ''}" data-op-rating-tab="${tab.key}">${esc(tab.label)}</button>`).join('')}</div>`;
}

async function renderRating() {
  const el = document.getElementById('view-rating');
  if (!el) return;
  el.innerHTML = `<div class="op-page op-rating-page"><div class="op-page-head"><div><span>Рейтинг</span><h1>Мои результаты</h1><p>Позиция, динамика и сравнение с командой</p></div><button class="btn-outline btn-sm" data-rating-refresh>Обновить</button></div>${opRatingTabs()}<div id="rating-tab-content" class="op-rating-content"><div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div></div></div>`;
  el.querySelector('[data-rating-refresh]')?.addEventListener('click', () => { swrInvalidate('rating'); swrInvalidate('race:'); renderRating(); });
  el.querySelectorAll('[data-op-rating-tab]').forEach(button => button.addEventListener('click', () => {
    _ratingActiveTab = button.dataset.opRatingTab;
    el.querySelectorAll('[data-op-rating-tab]').forEach(item => item.classList.toggle('active', item === button));
    loadRatingTab(_ratingActiveTab);
  }));
  await loadRatingTab(_ratingActiveTab);
}

async function loadRatingTab(tab) {
  const host = document.getElementById('rating-tab-content');
  if (!host) return;
  const nav = STATE.navGen;
  host.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>Загрузка…</p></div>';
  try {
    if (tab === 'overview') await opRenderRatingOverview(host);
    else if (tab === 'race') await opRenderRatingRace(host);
    else if (tab === 'groups') await opRenderRatingGroups(host);
    else await opRenderRatingProgress(host);
  } catch (error) {
    if (!isNavStale(nav)) host.innerHTML = opEmpty('Не удалось загрузить раздел', error.message || 'Попробуйте обновить страницу.');
  }
}

function opRatingRow(row, index, maxPoints) {
  const points = Number(row.contest_points || row.final_score || row.points || 0);
  const width = Math.max(4, Math.round(points / Math.max(maxPoints, 1) * 100));
  return `<div class="op-leader-row ${row.is_current_user ? 'is-me' : ''}"><span class="op-place">${row.rank_position || row.rank || index + 1}</span><div class="op-person"><b>${esc(row.operator_name || row.full_name || 'Оператор')}</b><small>${esc(row.group_name || row.group || 'Без группы')}</small></div><div class="op-score-bar"><i style="width:${width}%"></i></div><strong>${opNum(points, 1)}<small> баллов</small></strong><em>${opCoin(row.coins_earned || 0)}</em></div>`;
}

async function opRenderRatingOverview(host) {
  const [overview, me, nominations, dynamics] = await Promise.all([
    swrFetch('rating:v3:overview', () => api.getRating(), null, SWR_FAST_TTL_MS),
    opRatingRequest('/api/rating/me', {}),
    opRatingRequest('/api/rating/nominations', { items: [] }),
    opRatingRequest('/api/rating/operator-dynamics?mode=points&limit=6', { items: [] }),
  ]);
  const rows = overview?.items || [];
  const max = Math.max(...rows.map(row => Number(row.contest_points || row.final_score || 0)), 1);
  const podium = rows.slice(0, 3);
  host.innerHTML = `<div class="op-rating-summary">
    <div><span>Период</span><b>${esc(overview.period || 'Не рассчитан')}</b></div><div><span>Участников</span><b>${rows.length}</b></div><div><span>Моё место</span><b>${me.place ? `#${me.place} из ${me.total_participants}` : '—'}</b></div><div><span>Мой баланс</span><b>${opCoin(me.total_balance)}</b></div>
  </div>
  <div class="op-dashboard-grid op-rating-hero-grid">
    ${opPanel('Мой результат', `<div class="op-my-result"><span class="op-big-place">${me.place ? `#${me.place}` : '—'}</span><div><b>${esc(me.full_name || STATE.user?.full_name || 'Оператор')}</b><small>${esc(me.group_name || 'Без группы')}</small></div></div><div class="op-result-stats"><div><span>Баллы</span><b>${opNum(me.weekly_points, 1)}</b></div><div><span>Коины</span><b>${opCoin(me.weekly_coins)}</b></div><div><span>Качество</span><b>${opPercent(me.quality_score)}</b></div></div>`)}
    ${opPanel('Лидеры недели', podium.length ? `<div class="op-podium">${podium.map((row, i) => `<article><span>${i + 1}</span><b>${esc(row.operator_name)}</b><small>${esc(row.group_name || 'Без группы')}</small><strong>${opNum(row.contest_points, 1)}</strong></article>`).join('')}</div>` : opEmpty('Нет результатов', 'Рейтинг появится после расчёта периода.'))}
  </div>
  <div class="op-dashboard-grid op-rating-insights">
    ${opPanel('Динамика последних дней', opDynamicsMini(dynamics.items || []))}
    ${opPanel('Номинации недели', opNominations(nominations.items || []))}
  </div>
  ${opPanel('Общий рейтинг', rows.length ? `<div class="op-leader-list">${rows.map((row, i) => opRatingRow(row, i, max)).join('')}</div>` : opEmpty('Рейтинг пока пуст', 'После расчёта периода здесь появятся участники.'), `${rows.length} участников`)} `;
}

function opDynamicsMini(items) {
  if (!items.length) return opEmpty('Недостаточно истории', 'Динамика появится после нескольких рабочих дней.');
  const max = Math.max(...items.map(item => Number(item.daily_points || item.value || 0)), 1);
  return `<div class="op-dynamics-bars">${items.map(item => { const value = Number(item.daily_points || item.value || 0); return `<div><span>${esc(item.label || item.week || '')}</span><i><b style="width:${Math.max(4, value / max * 100)}%"></b></i><strong>${opNum(value, 1)}</strong></div>`; }).join('')}</div>`;
}

function opNominations(items) {
  if (!items.length) return opEmpty('Номинаций пока нет', 'Они появятся после расчёта недели.');
  return `<div class="op-nominations">${items.slice(0, 4).map(item => `<article><span>${item.is_current_user ? 'Это вы' : 'Номинация'}</span><b>${esc(item.title || item.name || 'Лучший результат')}</b><small>${esc(item.winner_name || item.operator_name || '—')} · ${esc(item.value || '')}</small><strong>${item.coins_bonus ? opCoin(item.coins_bonus, true) : ''}</strong></article>`).join('')}</div>`;
}

async function opRenderRatingRace(host) {
  const data = await swrFetch('race:v3:all', () => api.getRatingRace({ mode: 'all' }), null, SWR_FAST_TTL_MS);
  const items = data.items || [];
  const current = data.current_user;
  const max = Math.max(...items.map(item => Number(item.points || 0)), 1);
  host.innerHTML = `${opPanel('Гонка баллов', `<div class="op-race-intro"><div><b>${current?.rank ? `Вы на ${current.rank}-м месте` : 'Ваше место пока не рассчитано'}</b><span>${current?.points_to_next_rank ? `До следующего места: ${opNum(current.points_to_next_rank, 1)} балла` : 'Сравнение строится по итоговому баллу периода'}</span></div><div class="op-race-legend"><span><i></i>Вы</span><span><i></i>Другие участники</span></div></div>${items.length ? `<div class="op-race-list">${items.map((row, i) => opRatingRow({ ...row, contest_points: row.points }, i, max)).join('')}</div>` : opEmpty('Нет участников гонки', 'Данные появятся после расчёта периода.')}`, `${items.length} участников`, 'op-race-panel')}`;
}

async function opRenderRatingGroups(host) {
  const data = await swrFetch('race:v3:groups', () => api.getRatingRace({ mode: 'all' }), null, SWR_FAST_TTL_MS);
  const groups = [...(data.groups || [])].sort((a, b) => Number(b.avg_points) - Number(a.avg_points));
  const members = {};
  (data.items || []).forEach(item => { const name = item.group || 'Без группы'; members[name] = (members[name] || 0) + 1; });
  const max = Math.max(...groups.map(group => Number(group.avg_points || 0)), 1);
  host.innerHTML = `<div class="op-rating-summary"><div><span>Групп</span><b>${groups.length}</b></div><div><span>Лидер</span><b>${esc(groups[0]?.group || '—')}</b></div><div><span>Лучший средний балл</span><b>${opNum(groups[0]?.avg_points, 1)}</b></div><div><span>Участников</span><b>${data.total_participants || 0}</b></div></div>
  ${opPanel('Сравнение групп', groups.length ? `<div class="op-group-list">${groups.map((group, i) => `<article><span>${i + 1}</span><div><b>${esc(group.group || 'Без группы')}</b><small>${members[group.group] || 0} участников</small></div><i><b style="width:${Math.max(4, Number(group.avg_points || 0) / max * 100)}%"></b></i><strong>${opNum(group.avg_points, 1)}<small> средний балл</small></strong></article>`).join('')}</div>` : opEmpty('Недостаточно данных для сравнения', 'Нужно рассчитать результаты хотя бы одной группы.'), `${groups.length} групп`)}`;
}

async function opRenderRatingProgress(host) {
  const [points, coins, ranks, me] = await Promise.all([
    opRatingRequest('/api/rating/operator-dynamics?mode=points&limit=8', { items: [], summary: {} }),
    opRatingRequest('/api/rating/operator-dynamics?mode=coins&limit=8', { items: [], summary: {} }),
    opRatingRequest('/api/rating/operator-dynamics?mode=rank&limit=8', { items: [], summary: {} }),
    opRatingRequest('/api/rating/me', {}),
  ]);
  const items = points.items || [];
  host.innerHTML = `<div class="op-rating-summary"><div><span>Текущий результат</span><b>${opNum(points.summary?.today_value, 1)} балла</b></div><div><span>Среднее</span><b>${opNum(points.summary?.average_4_days, 1)}</b></div><div><span>Коины за день</span><b>${opCoin(coins.summary?.today_value)}</b></div><div><span>Текущее место</span><b>${me.place ? `#${me.place}` : '—'}</b></div></div>
  ${opPanel('Мой прогресс', items.length ? `<div class="op-progress-table"><div class="op-progress-head"><span>Дата</span><span>Баллы</span><span>Коины</span><span>Место</span></div>${items.map((item, i) => `<div class="op-progress-row"><div><b>${esc(item.label || item.date)}</b><small>${esc(item.weekday || '')}</small></div><strong>${opNum(item.daily_points, 1)}</strong><strong>${opCoin(coins.items?.[i]?.daily_coins || item.daily_coins)}</strong><strong>${ranks.items?.[i]?.rank ? `#${ranks.items[i].rank}` : '—'}</strong></div>`).join('')}</div>` : opEmpty('Истории прогресса пока нет', 'Загрузите рабочие показатели минимум за два дня. После этого здесь появится динамика баллов, коинов и места.'), `${items.length} дней`)}`;
}

window.renderCabinet = renderCabinet;
window.renderRating = renderRating;
