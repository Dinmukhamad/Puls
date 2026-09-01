/* ══════════════════════════════════════════════════════════════
   «Сводка» по макету 2026.

   Переопределяет renderSummaryData из 19-management-summary.view.js —
   он объявлен раньше по порядку сборки. Фильтры, загрузка, экспорт и
   обработка ошибок остаются там же: меняется только отрисовка данных.

   Спарклайна в KPI-карточках нет намеренно: бэкенд отдаёт по метрике
   значение, цель, выборку и изменение к прошлому периоду, но не ряд по
   дням. Вместо выдуманной кривой показываем достижение цели — это то,
   что действительно посчитано.
══════════════════════════════════════════════════════════════ */

function smNum(value, unit) {
  if (value === null || value === undefined) return '—';
  return `${analyticsMetricValue(value, unit)}`;
}

function renderSummaryData(el, content, warning, data) {
  const health = data.team_health || {};
  const metrics = data.metric_cards || [];
  const groups = data.groups || [];
  const priorities = data.priority_operators || [];

  warning.innerHTML = data.data_availability_warning
    ? `<div class="an-availability-note">${esc(data.data_availability_warning)}</div>` : '';
  const updated = el.querySelector('#summary-updated');
  if (updated) updated.textContent = `Обновлено: ${new Date().toLocaleString('ru-RU')}`;

  const noData = Math.max(0, (health.operators_count || 0) - (health.operators_with_data || 0));
  const tone = chartTone(health.status);

  content.innerHTML = `
    <div class="sm">

      <section class="sm-health" aria-label="Состояние команды">
        <div class="sm-health-main">
          ${chartGauge(health.score || 0, {
            tone,
            caption: `Индекс состояния команды: ${health.score || 0} из 100`,
          })}
          <div class="sm-health-text">
            <p class="sm-health-kicker">Состояние команды</p>
            <p class="sm-health-verdict sm-tone-${tone}">
              <span class="sm-dot" aria-hidden="true"></span>${esc(analyticsStatusLabel(health.status))}
            </p>
            <p class="sm-health-note">${health.attention_count
              ? `${health.attention_count} ${uiPlural(health.attention_count, 'оператор требует', 'оператора требуют', 'операторов требуют')} внимания, критично — ${health.critical_count || 0}.`
              : 'Отклонений по доступным данным не обнаружено.'}</p>
          </div>
        </div>
        <dl class="sm-coverage">
          <div><dt>учтено</dt><dd>${health.operators_with_data || 0}</dd></div>
          <div><dt>без данных</dt><dd class="${noData ? 'is-warn' : ''}">${noData}</dd></div>
        </dl>
      </section>

      <section class="sm-kpis" aria-label="Ключевые показатели">
        ${metrics.map(m => {
          const t = chartTone(m.status);
          return uiKpi({
            label: m.label,
            // Значение и цель форматируются словарём аналитики: у штрафов
            // единица «мин», у качества «%» — правило одно на весь продукт.
            value: m.value === null || m.value === undefined ? null : smNum(m.value, m.unit),
            target: m.target === null || m.target === undefined ? null : smNum(m.target, m.unit),
            sample: m.operators_with_data || 0,
            tone: t,
            hint: m.definition || '',
            chart: chartScaleBar(m.attainment ?? 0, {
              max: 120, tone: t, label: `Достижение цели: ${m.attainment ?? 0}%`,
            }),
            note: m.operators_below_target
              ? `${m.operators_below_target} ${uiPlural(m.operators_below_target, 'оператор', 'оператора', 'операторов')} ниже цели`
              : 'Все в пределах цели',
            // У штрафов меньше — лучше, поэтому минус здесь улучшение.
            delta: uiKpiDelta(m.change, { lowerIsBetter: m.key === 'penalty' }),
          });
        }).join('') || '<p class="ch-empty">Показатели за период не рассчитаны</p>'}
      </section>

      <div class="sm-grid">
        ${uiCard({
          title: 'Группы',
          subtitle: 'Сначала группы с риском',
          actions: `<button class="btn-outline btn-sm" type="button"
                      onclick="navigateTo('analytics',{tab:'groups'})">Подробнее</button>`,
          flush: true,
          body: `<div class="sm-groups">
            ${groups.slice(0, 5).map(g => `
              <article class="sm-group sm-tone-${chartTone(g.status)}">
                <div class="sm-group-top">
                  <h3 class="sm-group-name">${esc(g.group_name)}</h3>
                  <p class="sm-group-meta">${g.operators_count} ${uiPlural(g.operators_count, 'оператор', 'оператора', 'операторов')}, данные ${g.coverage_percent}%</p>
                </div>
                <p class="sm-group-score">${g.health_score}<span>/100</span></p>
                ${chartScaleBar(g.health_score, { tone: chartTone(g.status), label: `Индекс группы ${esc(g.group_name)}: ${g.health_score} из 100` })}
                <p class="sm-group-risk">${g.operators_in_risk} требуют внимания</p>
              </article>`).join('')
              || uiEmptyState('Групп пока нет', 'Заведите группу, чтобы видеть срез по командам.', [], true)}
          </div>`,
        })}

        ${uiCard({
          title: 'Требуют внимания',
          subtitle: 'Главные приоритеты периода',
          actions: `<button class="btn-outline btn-sm" type="button"
                      onclick="navigateTo('analytics',{tab:'operators'})">Все операторы</button>`,
          flush: true,
          body: `<ul class="sm-attention">
            ${priorities.slice(0, 6).map(p => `
              <li class="sm-attention-item sm-tone-${chartTone(p.status)}">
                <span class="sm-dot" aria-hidden="true"></span>
                <span class="sm-attention-text">
                  <span class="sm-attention-name">${esc(p.full_name)}</span>
                  <span class="sm-attention-note">${esc(p.recommendation || '')}</span>
                </span>
                <span class="sm-attention-score" title="Индекс состояния">${p.health_score}</span>
              </li>`).join('')
              || `<li class="sm-attention-ok">Все доступные показатели в норме</li>`}
          </ul>`,
        })}
      </div>
    </div>`;
}
