/* Operator rating v4: a focused competition dashboard without data tables. */

const rcManagementRating = window.renderRating;

function rcPoints(value) {
  return `${opNum(value, 1)} баллов`;
}

function rcInitials(name) {
  return String(name || 'Оператор')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('') || 'О';
}

function rcGap(value) {
  return opNum(Math.max(0, Number(value || 0)), 1);
}

function rcPlaceChange(value) {
  const delta = Number(value);
  if (!Number.isFinite(delta) || delta === 0) {
    return '<span class="rc-rank-change is-neutral">Место без изменений</span>';
  }
  return `<span class="rc-rank-change ${delta > 0 ? 'is-up' : 'is-down'}">${delta > 0 ? '↑' : '↓'} ${delta > 0 ? 'Подъём' : 'Снижение'} на ${Math.abs(delta)}</span>`;
}

function rcAvatar(person, tone = '') {
  return `<span class="rc-avatar ${tone}" aria-hidden="true">${esc(rcInitials(person?.full_name))}</span>`;
}

function rcFindNeighbour(items, rank) {
  return items.find(item => Number(item.rank) === Number(rank)) || null;
}

function rcChallengeCard(current, ahead, behind) {
  if (!current) {
    return `<section class="rc-hero-card rc-hero-empty">${opEmpty('Ваш результат ещё не рассчитан', 'Как только появятся данные периода, здесь будет ближайший соперник и разрыв в баллах.')}</section>`;
  }

  const leader = Number(current.rank) === 1;
  const target = leader ? behind : ahead;
  const gap = target
    ? Math.abs(Number(current.points || 0) - Number(target.points || 0))
    : 0;
  const progress = !leader && ahead?.points
    ? Math.max(6, Math.min(100, Number(current.points || 0) / Number(ahead.points) * 100))
    : 100;
  const title = leader
    ? (target ? `${target.full_name} пытается вас догнать` : 'Вы удерживаете лидерство')
    : (target ? `Следующая цель — ${target.full_name}` : 'Ближайшая цель определяется');
  const description = leader
    ? (target ? `Ваш запас — ${rcGap(gap)} балла. Сохраняйте темп, чтобы остаться первым.` : 'Продолжайте удерживать темп до конца периода.')
    : (target ? `Вы отстаёте на ${rcGap(gap)} балла. Каждый новый балл сокращает разрыв.` : 'После следующего расчёта здесь появится разрыв до соперника.');

  return `<section class="rc-hero-card">
    <div class="rc-rank-block">
      <span class="rc-eyebrow">Ваше место</span>
      <div class="rc-rank-number">#${Number(current.rank)}</div>
      <b>из ${Number(current.total_participants || 0)} операторов</b>
      ${rcPlaceChange(current.rank_change)}
    </div>
    <div class="rc-target-block">
      <span class="rc-eyebrow">${leader ? 'Защита позиции' : 'Ближайшая цель'}</span>
      <h2>${esc(title)}</h2>
      <p>${esc(description)}</p>
      <div class="rc-target-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}" aria-label="Прогресс до ближайшего соперника">
        <i style="width:${progress}%"></i>
        <span class="rc-progress-runner" style="left:${progress}%" aria-hidden="true">›</span>
      </div>
      <div class="rc-target-values">
        <span><b>${opNum(current.points, 1)}</b> ваши баллы</span>
        <span>${target ? `<b>${opNum(target.points, 1)}</b> ${leader ? 'у преследователя' : 'у соперника'}` : '<b>—</b> цель'}</span>
      </div>
    </div>
  </section>`;
}

function rcRivalCard(person, current, kind) {
  if (!person) {
    const title = kind === 'ahead' ? 'Вы лидер' : 'Никого рядом';
    const text = kind === 'ahead' ? 'Выше вас сейчас никого нет' : 'Ближайший преследователь не определён';
    return `<article class="rc-rival-card is-empty"><span>${title}</span><small>${text}</small></article>`;
  }
  const isMe = kind === 'me';
  const diff = isMe ? 0 : Number(person.points || 0) - Number(current?.points || 0);
  const label = kind === 'ahead' ? 'Впереди вас' : kind === 'behind' ? 'Догоняет вас' : 'Это вы';
  const gap = isMe ? 'Текущая позиция' : diff > 0 ? `+${opNum(diff, 1)} к вашим` : `${opNum(Math.abs(diff), 1)} позади`;
  return `<article class="rc-rival-card ${isMe ? 'is-me' : ''}">
    <div class="rc-rival-top"><span>${esc(label)}</span><b>#${Number(person.rank || current?.rank || 0)}</b></div>
    <div class="rc-rival-person">
      ${rcAvatar(person, isMe ? 'is-me' : '')}
      <div><b>${esc(isMe ? 'Вы' : person.full_name || 'Оператор')}</b><small>${esc(person.group || current?.group || 'Без группы')}</small></div>
    </div>
    <div class="rc-rival-score"><strong>${opNum(person.points ?? current?.points, 1)}</strong><span>${esc(gap)}</span></div>
  </article>`;
}

function rcRivalLane(current, ahead, behind) {
  return `<section class="rc-card rc-rivals">
    <header class="rc-card-head"><div><span class="rc-eyebrow">Ваша зона гонки</span><h3>Ближайшие соперники</h3></div><p>Только те, кто влияет на вашу следующую позицию</p></header>
    <div class="rc-rival-lane">
      ${rcRivalCard(ahead, current, 'ahead')}
      <span class="rc-lane-arrow" aria-hidden="true">→</span>
      ${rcRivalCard(current, current, 'me')}
      <span class="rc-lane-arrow" aria-hidden="true">→</span>
      ${rcRivalCard(behind, current, 'behind')}
    </div>
  </section>`;
}

function rcGroupCard(group, index, currentGroup, currentAverage) {
  if (!group) {
    return '<article class="rc-group-rival is-empty"><b>—</b><span>Нет соседней группы</span></article>';
  }
  const isCurrent = group.group === currentGroup;
  const diff = Number(group.avg_points || 0) - Number(currentAverage || 0);
  return `<article class="rc-group-rival ${isCurrent ? 'is-current' : ''}">
    <span class="rc-group-place">#${index + 1}</span>
    <div><b>${esc(isCurrent ? 'Ваша группа' : group.group || 'Без группы')}</b><small>${isCurrent ? esc(group.group || 'Без группы') : diff > 0 ? `впереди на ${opNum(diff, 1)}` : `позади на ${opNum(Math.abs(diff), 1)}`}</small></div>
    <strong>${opNum(group.avg_points, 1)}<small> средний балл</small></strong>
  </article>`;
}

function rcGroupBattle(groups, current) {
  const sorted = [...(groups || [])].sort((a, b) => Number(b.avg_points || 0) - Number(a.avg_points || 0));
  if (!sorted.length || !current?.group) {
    return `<section class="rc-card rc-group-card"><header class="rc-card-head"><div><span class="rc-eyebrow">Командная гонка</span><h3>Моя группа</h3></div></header>${opEmpty('Групповой рейтинг ещё не рассчитан', 'После расчёта здесь появятся место группы и ближайшие команды.')}</section>`;
  }
  const currentIndex = sorted.findIndex(group => group.group === current.group);
  if (currentIndex < 0) {
    return `<section class="rc-card rc-group-card"><header class="rc-card-head"><div><span class="rc-eyebrow">Командная гонка</span><h3>${esc(current.group)}</h3></div></header>${opEmpty('Группа пока вне рейтинга', 'Для сравнения нужен рассчитанный средний балл группы.')}</section>`;
  }
  const mine = sorted[currentIndex];
  const ahead = sorted[currentIndex - 1] || null;
  const behind = sorted[currentIndex + 1] || null;
  const leagueAverage = sorted.reduce((sum, group) => sum + Number(group.avg_points || 0), 0) / sorted.length;
  const leaderAverage = Number(sorted[0]?.avg_points || 0);
  const mineAverage = Number(mine.avg_points || 0);
  const scale = Math.max(leaderAverage, mineAverage, leagueAverage, 1);

  return `<section class="rc-card rc-group-card">
    <header class="rc-card-head"><div><span class="rc-eyebrow">Командная гонка</span><h3>${esc(current.group)}</h3></div><div class="rc-group-rank">#${currentIndex + 1}<small> из ${sorted.length}</small></div></header>
    <div class="rc-group-neighbours">
      ${rcGroupCard(ahead, currentIndex - 1, current.group, mineAverage)}
      ${rcGroupCard(mine, currentIndex, current.group, mineAverage)}
      ${rcGroupCard(behind, currentIndex + 1, current.group, mineAverage)}
    </div>
    <div class="rc-group-bars" aria-label="Сравнение среднего балла группы">
      <div><span>Ваша группа</span><i><b class="is-mine" style="width:${mineAverage / scale * 100}%"></b></i><strong>${opNum(mineAverage, 1)}</strong></div>
      <div><span>Среднее всех групп</span><i><b style="width:${leagueAverage / scale * 100}%"></b></i><strong>${opNum(leagueAverage, 1)}</strong></div>
      <div><span>Группа-лидер</span><i><b class="is-leader" style="width:${leaderAverage / scale * 100}%"></b></i><strong>${opNum(leaderAverage, 1)}</strong></div>
    </div>
  </section>`;
}

function rcTrendChart(items) {
  const rows = (items || []).map((item, index) => ({
    label: item.label || item.weekday || item.date || `День ${index + 1}`,
    date: item.date || '',
    value: Number(item.daily_points ?? item.value ?? 0),
  }));
  if (rows.length < 2) {
    return opEmpty('Недостаточно истории', 'График появится, когда будут результаты минимум за два дня.');
  }
  const width = 640;
  const height = 210;
  const padX = 22;
  const padY = 24;
  const values = rows.map(row => row.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const points = rows.map((row, index) => {
    const x = padX + index / Math.max(rows.length - 1, 1) * (width - padX * 2);
    const y = height - padY - (row.value - min) / range * (height - padY * 2);
    return { ...row, x, y };
  });
  const line = points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `M ${points[0].x.toFixed(1)} ${height - padY} L ${line.replaceAll(',', ' ')} L ${points.at(-1).x.toFixed(1)} ${height - padY} Z`;
  const change = values.at(-1) - values[0];
  const best = points.reduce((winner, point) => point.value > winner.value ? point : winner, points[0]);

  return `<div class="rc-trend-wrap">
    <div class="rc-trend-summary">
      <div><span>Сейчас</span><b>${opNum(values.at(-1), 1)}</b></div>
      <div><span>Изменение</span><b class="${change >= 0 ? 'is-positive' : 'is-negative'}">${change > 0 ? '+' : ''}${opNum(change, 1)}</b></div>
      <div><span>Лучший день</span><b>${esc(best.label)}</b></div>
    </div>
    <div class="rc-chart-scroll">
      <svg class="rc-trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Динамика личных баллов за ${rows.length} дней">
        <defs><linearGradient id="rcTrendArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent-primary)" stop-opacity=".28"/><stop offset="100%" stop-color="var(--accent-primary)" stop-opacity="0"/></linearGradient></defs>
        <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" class="rc-chart-axis"/>
        <path d="${area}" fill="url(#rcTrendArea)"/>
        <polyline points="${line}" class="rc-chart-line"/>
        ${points.map((point, index) => `<g><circle cx="${point.x}" cy="${point.y}" r="${index === points.length - 1 ? 7 : 4}" class="${index === points.length - 1 ? 'is-current' : ''}"/><text x="${point.x}" y="${height - 5}" text-anchor="middle">${esc(point.label)}</text><title>${esc(point.label)}: ${opNum(point.value, 1)} баллов</title></g>`).join('')}
      </svg>
    </div>
  </div>`;
}

function rcTrendPanel(points, ranks, current) {
  const rankItems = ranks?.items || [];
  const latestRank = rankItems.at(-1)?.rank;
  const previousRank = rankItems.at(-2)?.rank;
  const rankText = latestRank
    ? `Место #${latestRank}${previousRank && previousRank !== latestRank ? ` · было #${previousRank}` : ''}`
    : (current?.rank ? `Место #${current.rank}` : 'Место не рассчитано');
  return `<section class="rc-card rc-trend-card">
    <header class="rc-card-head"><div><span class="rc-eyebrow">Личный темп</span><h3>Как растут мои показатели</h3></div><span class="rc-current-rank">${esc(rankText)}</span></header>
    ${rcTrendChart(points?.items || [])}
  </section>`;
}

function rcPodium(items, current) {
  const top = (items || []).slice(0, 3);
  if (!top.length) return '';
  return `<section class="rc-card rc-podium-card">
    <header class="rc-card-head"><div><span class="rc-eyebrow">Ориентир недели</span><h3>Тройка лидеров</h3></div>${current?.rank > 3 ? `<p>До топ-3: ${rcGap(current.points_to_top_3)} балла</p>` : '<p>Вы уже в зоне лидеров</p>'}</header>
    <div class="rc-podium">
      ${top.map((person, index) => `<article class="is-${index + 1} ${person.is_current_user ? 'is-me' : ''}"><span class="rc-medal">${index + 1}</span>${rcAvatar(person)}<div><b>${esc(person.is_current_user ? 'Вы' : person.full_name)}</b><small>${esc(person.group || 'Без группы')}</small></div><strong>${opNum(person.points, 1)}</strong></article>`).join('')}
    </div>
  </section>`;
}

async function rcLoadOperatorRating(host) {
  const nav = STATE.navGen;
  const [race, overview, points, ranks] = await Promise.all([
    swrFetch('rating:competition:race', () => api.getRatingRace({ mode: 'all' }), null, SWR_FAST_TTL_MS),
    swrFetch('rating:competition:overview', () => api.getRating(), null, SWR_FAST_TTL_MS),
    opRatingRequest('/api/rating/operator-dynamics?mode=points&limit=8', { items: [], summary: {} }),
    opRatingRequest('/api/rating/operator-dynamics?mode=rank&limit=8', { items: [], summary: {} }),
  ]);
  if (isNavStale(nav) || !host.isConnected) return;

  const items = [...(race?.items || [])].sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
  const current = race?.current_user || null;
  const ahead = current ? rcFindNeighbour(items, Number(current.rank) - 1) : null;
  const behind = current ? rcFindNeighbour(items, Number(current.rank) + 1) : null;
  const period = overview?.period || 'Текущий период';

  host.innerHTML = `
    <div class="rc-period-strip"><span><i aria-hidden="true"></i> Гонка обновлена</span><b>${esc(period)}</b><small>${items.length || race?.total_participants || 0} участников</small></div>
    ${rcChallengeCard(current, ahead, behind)}
    ${rcRivalLane(current, ahead, behind)}
    <div class="rc-insight-grid">
      ${rcGroupBattle(race?.groups || [], current)}
      ${rcTrendPanel(points, ranks, current)}
    </div>
    ${rcPodium(items, current)}
  `;
}

async function rcRenderOperatorRating() {
  const el = document.getElementById('view-rating');
  if (!el) return;
  el.innerHTML = `<div class="op-page rc-page">
    <div class="op-page-head rc-page-head"><div><span>Рейтинг операторов</span><h1>Моя гонка</h1><p>Кого догнать, кто догоняет вас и как движется ваша группа</p></div><button class="btn-outline btn-sm" data-rc-refresh>Обновить</button></div>
    <div id="rc-rating-content"><div class="loading-state"><div class="loading-spinner"></div><p>Собираем вашу гонку…</p></div></div>
  </div>`;
  el.querySelector('[data-rc-refresh]')?.addEventListener('click', () => {
    swrInvalidate('rating:competition:');
    swrInvalidate('race:');
    rcRenderOperatorRating();
  });
  const host = el.querySelector('#rc-rating-content');
  try {
    await rcLoadOperatorRating(host);
  } catch (error) {
    if (host?.isConnected) {
      host.innerHTML = opEmpty('Не удалось загрузить рейтинг', error?.message || 'Обновите страницу и попробуйте ещё раз.');
    }
  }
}

async function rcRatingEntry() {
  if (!STATE.user?.operator_id) {
    return rcManagementRating();
  }
  return rcRenderOperatorRating();
}

window.renderRating = rcRatingEntry;
