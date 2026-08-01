/* Выделено из 60-wheel-tests.view.js (2603 строки).
   Административный экран и вкладка кампаний. */

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
        <h2 class="section-title">Wheel of WOW</h2>
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
