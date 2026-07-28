let _missionWorldCode = sessionStorage.getItem('puls-mission-world') || '';

function learningWorldIllustration(world) {
  const icon = ({
    yandex_pro: '<rect x="27" y="20" width="46" height="74" rx="12"/><path d="M36 70 49 57l10 8 8-13"/><circle cx="50" cy="84" r="3"/>',
    taxi_pro: '<path d="M18 68h82l-9-27H38L25 55Z"/><circle cx="38" cy="72" r="10"/><circle cx="82" cy="72" r="10"/><path d="M60 30v24m-12-12h24"/>',
    crm_requests: '<rect x="24" y="17" width="72" height="82" rx="12"/><path d="M40 39h40M40 56h40M40 73h25"/><circle cx="85" cy="82" r="14"/><path d="m79 82 4 4 8-10"/>',
    self_employment_docs: '<path d="M31 16h45l17 18v65H31Z"/><path d="M76 16v19h17M45 51h34M45 66h22"/><circle cx="76" cy="80" r="16"/><path d="m69 80 5 5 10-13"/>',
  })[world.code] || '<circle cx="60" cy="60" r="38"/>';
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${icon}</g></svg>`;
}

function renderLearningWorldMap(el, data) {
  const worlds = data.worlds || [];
  el.innerHTML = `<div class="missions-page learning-world-page">
    <header class="missions-header world-map-header"><div><span class="missions-eyebrow">Карта обучения</span><h1>Рабочие территории</h1><p>Выбери систему или тему и пройди её практический маршрут.</p></div><div class="world-overall"><b>${data.percent || 0}%</b><span>Выполнено ${data.completed || 0} из ${data.total || 0}</span><small>Получено: ${missionCoinLabel(data.reward_earned)}</small><small>Доступно: ${missionCoinLabel(data.reward_available)}</small></div></header>
    <div class="world-pulse-line" aria-hidden="true"></div>
    <section class="learning-world-grid" aria-label="Территории обучения">
      ${worlds.map((world, index) => learningWorldCard(world, index)).join('')}
    </section>
    <aside class="world-pulsar-note"><div>${pulsarSvg('idle')}</div><p><b>Пульсар рядом.</b> Прогресс считается отдельно для каждой темы, а награды остаются в общем кошельке Pulse.</p></aside>
  </div>`;
}

function learningWorldCard(world, index) {
  const soon = world.availability === 'coming_soon';
  const status = soon ? 'Уроки готовятся' : (world.percent === 100 && world.total_count ? 'Завершено' : 'Доступно');
  const rewardLabel = world.completed_count === world.total_count && world.total_count
    ? `Получено: ${missionCoinLabel(world.reward_earned)}`
    : `Доступно: ${missionCoinLabel(world.reward_available)}`;
  return `<article class="learning-world-card ${soon ? 'is-soon' : ''}" style="--world-accent:${esc(world.accent_color)}" data-world-index="${index}">
    <div class="world-card-visual">${learningWorldIllustration(world)}</div>
    <div class="world-card-copy"><div class="world-card-status"><span>${esc(status)}</span><b>${world.completed_count}/${world.total_count}</b></div><h2>${esc(world.title)}</h2><p>${esc(world.description)}</p>
      <div class="world-card-progress" aria-label="Прогресс ${world.percent}%"><i style="width:${world.percent}%"></i></div>
      <div class="world-card-meta"><span>${world.total_count ? `${world.total_count} мисс.` : 'Новые уроки'}</span><span>${rewardLabel}</span></div>
    </div>
    <button type="button" ${soon ? 'disabled' : ''} onclick="openLearningWorld('${esc(world.code)}')">${soon ? 'Скоро' : 'Открыть маршрут'}</button>
  </article>`;
}

async function openLearningWorld(code) {
  const el = document.getElementById('view-missions');
  missionLoading(el, 'Открываем территорию');
  try {
    const world = await api.getMissionWorld(code);
    _missionWorldCode = code;
    sessionStorage.setItem('puls-mission-world', code);
    renderLearningWorldRoute(el, world);
  } catch (error) {
    _missionWorldCode = '';
    sessionStorage.removeItem('puls-mission-world');
    renderMissionError(el, error);
  }
}

function backToLearningWorlds() {
  _missionWorldCode = '';
  sessionStorage.removeItem('puls-mission-world');
  renderMissions();
}
