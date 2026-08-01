/* Выделено из 60-wheel-tests.view.js (2603 строки).
   Вкладка правил начисления билетов и её модальное окно. */

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
