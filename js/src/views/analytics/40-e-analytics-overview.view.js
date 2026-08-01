/* Выделено из 40-reports-analytics.view.js (2671 строка).
   Вкладка «Обзор» и управленческий дашборд. */

async function loadOverviewTab(content) {
  const [dashboard, dynamics] = await Promise.all([
    analyticsFetch('management-dashboard', analyticsOpParams()),
    analyticsFetch('daily-dynamics', { ...analyticsBaseParams(), metric: 'calls' }).catch(() => ({ items: [] })),
  ]);

  const warnBox = document.getElementById('an-availability-warning');
  if (warnBox && dashboard.data_availability_warning) {
    warnBox.innerHTML = `<div class="an-availability-note">${esc(dashboard.data_availability_warning)}</div>`;
  } else if (warnBox) {
    warnBox.innerHTML = '';
  }

  content.innerHTML = renderManagementDashboard(dashboard, dynamics.items || []);
  bindManagementDashboard(content);
}

function analyticsStatusLabel(status) {
  return riskStatusLabel(status);
}

function analyticsMetricValue(value, unit) {
  return value == null ? '—' : `${fmtA(value, value % 1 ? 1 : 0)}${unit || ''}`;
}

function renderManagementDashboard(data, dynamics) {
  const health = data.team_health || {};
  const metrics = data.metric_cards || [];
  const risks = data.risk_distribution || {};
  const bottlenecks = data.bottlenecks || [];
  const groups = data.groups || [];
  const priorities = data.priority_operators || [];
  const leaders = data.top_performers || [];
  const totalRisk = (risks.stable || 0) + (risks.watch || 0) + (risks.critical || 0) + (risks.no_data || 0) || 1;
  const maxBottleneck = Math.max(...bottlenecks.map(item => item.count || 0), 1);

  if (!health.operators_count) return renderAnalyticsEmptyState();

  return `<div class="an-executive-dashboard">
    <section class="an-exec-hero an-status-${esc(health.status || 'no_data')}">
      <div class="an-health-ring" style="--an-health:${Math.max(0, Math.min(100, health.score || 0))}">
        <div><strong>${health.score || 0}</strong><span>из 100</span></div>
      </div>
      <div class="an-exec-hero-copy">
        <span class="an-exec-eyebrow">Индекс выполнения целей</span>
        <h3>${analyticsStatusLabel(health.status)}</h3>
        <p>${health.attention_count ? `${health.attention_count} оператор(ов) требуют внимания, из них критично: ${health.critical_count || 0}.` : 'Все операторы с данными находятся в целевой зоне.'}</p>
      </div>
      <div class="an-exec-hero-stats">
        <div><span>Операторов</span><strong>${health.operators_count || 0}</strong></div>
        <div><span>Покрытие данных</span><strong>${health.data_coverage_percent || 0}%</strong></div>
        <div><span>Покрытие качества</span><strong>${health.quality_coverage_percent || 0}%</strong></div>
      </div>
    </section>

    <section class="an-exec-section">
      <div class="an-exec-section-head"><div><span>Ключевые показатели</span><small>Факт относительно управленческой цели</small></div></div>
      <div class="an-exec-metrics">
        ${metrics.map(metric => `<article class="an-exec-metric an-status-${esc(metric.status)}">
          <div class="an-exec-metric-head"><span>${esc(metric.label)}</span><b>${analyticsStatusLabel(metric.status)}</b></div>
          <strong>${analyticsMetricValue(metric.value, metric.unit)}</strong>
          <div class="an-exec-goal"><span>Цель ${analyticsMetricValue(metric.target, metric.unit)}</span><span>${metric.attainment || 0}%</span></div>
          <div class="an-exec-progress"><i style="width:${Math.min(100, metric.attainment || 0)}%"></i></div>
          <small>${metric.operators_below_target || 0} из ${metric.operators_with_data || 0} ниже цели</small>
        </article>`).join('')}
      </div>
    </section>

    <div class="an-exec-grid an-exec-grid-main">
      <section class="an-exec-section">
        <div class="an-exec-section-head"><div><span>Карта рисков</span><small>Распределение команды по зонам</small></div><button type="button" data-an-open-tab="risks">Подробнее</button></div>
        <div class="an-risk-strip" aria-label="Распределение рисков">
          ${['stable','watch','critical','no_data'].map(key => `<i class="an-risk-strip-${key}" style="width:${((risks[key] || 0) / totalRisk) * 100}%"></i>`).join('')}
        </div>
        <div class="an-risk-legend-v2">
          ${['stable','watch','critical','no_data'].map(key => `<button type="button" data-an-open-tab="risks" class="an-risk-legend-item an-status-${key}"><i></i><span>${riskStatusLabel(key)}</span><strong>${risks[key] || 0}</strong></button>`).join('')}
        </div>
      </section>
      <section class="an-exec-section">
        <div class="an-exec-section-head"><div><span>Что тормозит результат</span><small>Частые причины попадания в зону внимания</small></div></div>
        <div class="an-bottleneck-list">
          ${bottlenecks.length ? bottlenecks.slice(0,5).map(item => `<div class="an-bottleneck-row">
            <div><span>${esc(item.label)}</span><small>${item.critical_count || 0} критично</small></div>
            <div class="an-bottleneck-track"><i style="width:${Math.round((item.count / maxBottleneck) * 100)}%"></i></div>
            <strong>${item.count}</strong>
          </div>`).join('') : '<div class="empty-line">Отклонений не обнаружено</div>'}
        </div>
      </section>
    </div>

    <section class="an-exec-section">
      <div class="an-exec-section-head"><div><span>Состояние групп</span><small>Сначала показаны группы с наибольшим риском</small></div><button type="button" data-an-open-tab="groups">Сравнить группы</button></div>
      <div class="an-group-health-list">
        ${groups.length ? groups.map(group => `<article class="an-group-health-row an-status-${esc(group.status)}">
          <div class="an-group-health-name"><i></i><div><strong>${esc(group.group_name)}</strong><small>${group.operators_count} оператор(ов) · данные ${group.coverage_percent}%</small></div></div>
          <div class="an-group-health-meter"><span><i style="width:${group.health_score}%"></i></span><b>${group.health_score}/100</b></div>
          <div class="an-group-health-risk"><strong>${group.operators_in_risk}</strong><span>требуют внимания</span></div>
        </article>`).join('') : '<div class="empty-line">Нет данных по группам</div>'}
      </div>
    </section>

    <div class="an-exec-grid an-exec-grid-operators">
      <section class="an-exec-section">
        <div class="an-exec-section-head"><div><span>Приоритет на разбор</span><small>Операторы отсортированы по срочности</small></div><button type="button" data-an-open-tab="operators">Все операторы</button></div>
        <div class="an-priority-list">
          ${priorities.length ? priorities.slice(0,6).map((operator, index) => `<article class="an-priority-row an-status-${esc(operator.status)}">
            <div class="an-priority-rank">${index + 1}</div>
            <div class="an-priority-person"><strong>${esc(operator.full_name)}</strong><small>${esc(operator.group_name || 'Без группы')}</small></div>
            <div class="an-priority-issues">${(operator.issues || []).slice(0,2).map(issue => `<span class="an-issue-chip an-status-${esc(issue.severity)}">${esc(issue.label)} ${issue.value == null ? 'нет данных' : analyticsMetricValue(issue.value, issue.unit)}</span>`).join('')}</div>
            <div class="an-priority-score"><strong>${operator.health_score}</strong><span>индекс</span></div>
            <p>${esc(operator.recommendation)}</p>
          </article>`).join('') : '<div class="an-positive-state">Все показатели команды находятся в целевой зоне.</div>'}
        </div>
      </section>
      <aside class="an-exec-section">
        <div class="an-exec-section-head"><div><span>Лидеры периода</span><small>По итоговому баллу</small></div></div>
        <div class="an-leader-list">
          ${leaders.length ? leaders.map((operator, index) => `<div class="an-leader-row"><b>${index + 1}</b><div><strong>${esc(operator.full_name)}</strong><small>${esc(operator.group_name || 'Без группы')}</small></div><span>${fmtA(operator.metrics?.final_points || 0, 1)}</span></div>`).join('') : '<div class="empty-line">Нет данных</div>'}
        </div>
      </aside>
    </div>

    <section class="an-exec-section">
      <div class="an-exec-section-head"><div><span>Нагрузка по дням</span><small>Количество обработанных звонков</small></div><button type="button" data-an-open-tab="dynamics">Открыть динамику</button></div>
      <div class="an-exec-dynamics">${renderDynChart(dynamics, 'calls')}</div>
    </section>
  </div>`;
}

function bindManagementDashboard(content) {
  content.querySelectorAll('[data-an-open-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.dataset.anOpenTab;
      const tabButton = document.querySelector(`#an-tabs [data-tab="${tab}"]`);
      if (tabButton) tabButton.click();
    });
  });
}

function renderAnalyticsEmptyState() {
  return `<div class="an-exec-section"><div class="an-empty-state">
    <div class="an-empty-mark" aria-hidden="true"></div>
    <div class="an-empty-title">Нет данных для аналитики</div>
    <div class="an-empty-sub">Загрузите Report и Monthly Report, затем выполните расчёт периода.</div>
    <button class="btn-primary btn-sm" onclick="navigateTo('period-report')" style="margin-top:12px">Перейти к расчёту периода</button>
  </div></div>`;
}

/* ── Вкладка: Операторы (таблица эффективности + зона внимания) ─*/
