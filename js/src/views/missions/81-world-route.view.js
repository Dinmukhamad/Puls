function renderLearningWorldRoute(el, world) {
  const missions = world.missions || [];
  el.innerHTML = `<div class="missions-page world-route-page" style="--world-accent:${esc(world.accent_color)}">
    <header class="world-route-header"><button type="button" class="mission-back-btn" onclick="backToLearningWorlds()">← <span>Все территории</span></button><div class="world-route-title"><div>${learningWorldIllustration(world)}</div><span class="missions-eyebrow">Территория</span><h1>${esc(world.title)}</h1><p>${esc(world.description)}</p></div><div class="world-route-summary"><b>${world.percent}%</b><span>${world.completed_count} из ${world.total_count}</span><small>P ${missionCoinLabel(world.coins_available)} доступно</small></div></header>
    <section class="world-mission-route panel" aria-label="Маршрут миссий">
      <div class="world-route-track" aria-hidden="true"></div>
      ${missions.length ? missions.map((mission, index) => `<div class="world-route-node ${index % 2 ? 'is-right' : ''}">${missionRouteCard(mission)}</div>`).join('') : '<div class="missions-empty">Уроки этой территории готовятся.</div>'}
      <article class="world-coming-node" aria-disabled="true"><span>+</span><div><b>Следующий урок</b><small>Скоро появится на маршруте</small></div></article>
    </section>
  </div>`;
}
