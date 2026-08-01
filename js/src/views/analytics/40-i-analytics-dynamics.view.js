/* Выделено из 40-reports-analytics.view.js (2671 строка).
   Вкладки «Динамика» и «Штрафы». */

async function loadDynamicsTab(content) {
  content.innerHTML = `
    <div class="an-card">
      <div class="an-card-head-row">
        <span>Динамика по дням</span>
        <div class="metric-tabs" id="an-dyn-tabs2">
          <button class="metric-tab active" data-metric="calls">Звонки</button>
          <button class="metric-tab" data-metric="kvz">КВЗ</button>
          <button class="metric-tab" data-metric="operators">Операторы</button>
        </div>
      </div>
      <div id="an-dyn-chart2"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
    </div>
    <div class="an-card">
      <div class="an-card-head-row">
        <span>Тепловая карта по дням</span>
        <div class="metric-tabs" id="an-heatmap-tabs2">
          <button class="metric-tab active" data-metric="quality">Качество</button>
          <button class="metric-tab" data-metric="calls">Звонки</button>
          <button class="metric-tab" data-metric="kvz">КВЗ</button>
          <button class="metric-tab" data-metric="efficiency">Эфф.</button>
          <button class="metric-tab" data-metric="penalty">Штрафы</button>
        </div>
      </div>
      <div id="an-heatmap-body2"><div class="loading-state" style="padding:20px"><div class="loading-spinner"></div></div></div>
    </div>`;

  const base = analyticsBaseParams();

  async function loadDyn(metric) {
    const box = document.getElementById('an-dyn-chart2');
    try {
      const d = await analyticsFetch('daily-dynamics', { ...base, metric });
      box.innerHTML = renderDynChart(d.items || [], metric);
    } catch(e) { box.innerHTML = `<div class="empty-line">${esc(e.message)}</div>`; }
  }
  document.querySelectorAll('#an-dyn-tabs2 .metric-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#an-dyn-tabs2 .metric-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      loadDyn(btn.dataset.metric);
    });
  });
  loadDyn('calls');

  async function loadHm(metric) {
    const box = document.getElementById('an-heatmap-body2');
    try {
      const d = await analyticsFetch('heatmap', { ...base, metric });
      box.innerHTML = renderHeatmapTable(d, metric);
    } catch(e) { box.innerHTML = `<div class="empty-line">${esc(e.message)}</div>`; }
  }
  document.querySelectorAll('#an-heatmap-tabs2 .metric-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#an-heatmap-tabs2 .metric-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      loadHm(btn.dataset.metric);
    });
  });
  loadHm('quality');
}

/* ── Вкладка: Штрафы ──────────────────────────────────────────*/
async function loadPenaltiesTab(content) {
  const penalties = await analyticsFetch('penalties', analyticsBaseParams());
  content.innerHTML = renderPenaltiesBlock(penalties);
}

/* ── Вкладка: Риски ───────────────────────────────────────────*/
