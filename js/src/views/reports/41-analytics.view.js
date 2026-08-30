/* ══════════════════════════════════════
   АНАЛИТИКА — экран руководителя колл-центра

   Весь экран приходит одним ответом /api/analytics/dashboard: значения,
   цели, статусы и человеческие объяснения считает бэкенд. Здесь только
   отрисовка и фильтры.

   Правила подачи:
   · цвет никогда не единственный носитель смысла — рядом всегда текст
     статуса, потому что зелёный и оранжевый неразличимы при протанопии;
   · у каждого показателя есть «что это значит» и «что делать»;
   · сверху только главное, детали раскрываются по клику.
══════════════════════════════════════ */

const AN_STATE = {
  tab: 'summary',       // summary | operators | quality
  preset: '30d',
  start: null,
  end: null,
  groupId: null,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  metric: 'quality',
  open: { trend: true, weekdays: false, groups: false, attention: true, leaders: true },
  expanded: null,       // ключ метрики с раскрытым объяснением
  loading: false,
  data: null,
  error: null,
  // Вкладки «Операторы»/«Качество» — своя серверная выборка (пагинация/сортировка/поиск)
  ops: { items: [], total: 0, page: 1, pageSize: 50, sortBy: 'final_points', sortOrder: 'desc', query: '', loading: false, error: null, loadedKey: null },
  // Лидеры периода для «Сводки» — топ операторов по итоговому баллу (тот же /operators)
  leaders: { items: [], key: null, loading: false },
};

const AN_TABS = [
  { key: 'summary', label: 'Общая сводка' },
  { key: 'operators', label: 'Операторы' },
  { key: 'quality', label: 'Качество' },
];

const AN_PRESETS = [
  { key: 'today', label: 'Сегодня', days: 1 },
  { key: '7d', label: '7 дней', days: 7 },
  { key: '30d', label: '30 дней', days: 30 },
  { key: 'custom', label: 'Свой период', days: null },
];

const AN_STATUS_TEXT = {
  good: 'Норма',
  watch: 'Ниже нормы',
  bad: 'Критично',
  neutral: 'Справочно',
  unknown: 'Нет данных',
};

const AN_STATUS_ICON = { good: '✓', watch: '!', bad: '✕', neutral: '·', unknown: '–' };

function anEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function anIsoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function anResolveRange() {
  const preset = AN_PRESETS.find(p => p.key === AN_STATE.preset);
  if (!preset || preset.key === 'custom') {
    return { start: AN_STATE.start, end: AN_STATE.end };
  }
  return { start: anIsoDaysAgo(preset.days - 1), end: anIsoDaysAgo(0) };
}

function anFmt(value, decimals) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: decimals || 0,
    maximumFractionDigits: decimals || 0,
  });
}

/* ── Точка входа ─────────────────────────────────────────── */

async function renderAnalytics() {
  const el = document.getElementById('view-analytics');
  if (!el) return;
  AN_STATE.tab = anReadTab();
  if (!el.dataset.built) {
    el.innerHTML = anShellHtml();
    el.dataset.built = '1';
    anBindShell(el);
  }
  await anLoad(el);
}

function anReadTab() {
  const t = new URLSearchParams(location.search).get('atab');
  return AN_TABS.some(x => x.key === t) ? t : 'summary';
}

function anWriteTab(tab) {
  const u = new URL(location.href);
  u.searchParams.set('atab', tab);
  history.replaceState(null, '', u);
}

function anShellHtml() {
  return `
    <div class="view-header">
      <div>
        <div class="section-kicker">Колл-центр</div>
        <h1 class="section-title">Аналитика</h1>
        <p class="an2-lede" id="an2-lede">Загружаем показатели…</p>
      </div>
      <div class="header-right">
        <button class="btn-outline btn-sm" id="an2-glossary-btn" type="button">
          Что означают показатели
        </button>
        <button class="btn-outline btn-sm" id="an2-export" type="button">Выгрузить в Excel</button>
      </div>
    </div>
    <nav class="an2-tabs" id="an2-tabs" role="tablist">
      ${AN_TABS.map(t => `<button type="button" class="an2-tab ${t.key === AN_STATE.tab ? 'active' : ''}" data-an2="tab" data-value="${t.key}" role="tab" aria-selected="${t.key === AN_STATE.tab}">${anEsc(t.label)}</button>`).join('')}
    </nav>
    <div class="an2-filters" id="an2-filters"></div>
    <div id="an2-body"></div>`;
}

function anBindShell(el) {
  el.addEventListener('click', async event => {
    const target = event.target.closest('[data-an2]');
    if (!target) return;
    const action = target.dataset.an2;
    const value = target.dataset.value;

    if (action === 'tab') {
      if (AN_STATE.tab === value) return;
      AN_STATE.tab = value;
      anWriteTab(value);
      el.querySelectorAll('#an2-tabs .an2-tab').forEach(b => {
        const on = b.dataset.value === value;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on);
      });
      if (value === 'operators' || value === 'quality') anEnsureOps(el);
      else anPaint(el);
    } else if (action === 'ops-page') {
      AN_STATE.ops.page = Math.max(1, AN_STATE.ops.page + (value === 'prev' ? -1 : 1));
      AN_STATE.ops.loadedKey = null;
      anEnsureOps(el);
    } else if (action === 'ops-sort') {
      if (AN_STATE.ops.sortBy === value) {
        AN_STATE.ops.sortOrder = AN_STATE.ops.sortOrder === 'desc' ? 'asc' : 'desc';
      } else {
        AN_STATE.ops.sortBy = value; AN_STATE.ops.sortOrder = 'desc';
      }
      AN_STATE.ops.page = 1; AN_STATE.ops.loadedKey = null;
      anEnsureOps(el);
    } else if (action === 'ops-row') {
      AN_STATE.ops.expandedRow = AN_STATE.ops.expandedRow === value ? null : value;
      anPaint(el);
    } else if (action === 'preset') {
      AN_STATE.preset = value;
      if (value === 'custom') {
        const range = anResolveRange();
        AN_STATE.start = AN_STATE.start || range.start || anIsoDaysAgo(29);
        AN_STATE.end = AN_STATE.end || range.end || anIsoDaysAgo(0);
      }
      await anLoad(el);
    } else if (action === 'weekday') {
      const day = Number(value);
      const picked = new Set(AN_STATE.weekdays);
      if (picked.has(day)) picked.delete(day); else picked.add(day);
      AN_STATE.weekdays = picked.size ? [...picked].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
      await anLoad(el);
    } else if (action === 'weekdays-all') {
      AN_STATE.weekdays = [0, 1, 2, 3, 4, 5, 6];
      await anLoad(el);
    } else if (action === 'metric') {
      AN_STATE.metric = value;
      await anLoad(el);
    } else if (action === 'explain') {
      AN_STATE.expanded = AN_STATE.expanded === value ? null : value;
      anPaint(el);
    } else if (action === 'toggle') {
      AN_STATE.open[value] = !AN_STATE.open[value];
      anPaint(el);
    } else if (action === 'glossary') {
      anOpenGlossary();
    }
  });

  // Строки таблицы раскрываются по клику и объявлены focusable (tabindex=0),
  // но <tr> — не кнопка: Enter/Space по ней сами по себе клик не генерируют.
  // Без этого обработчика детали строки были недоступны с клавиатуры.
  el.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('[data-an2="ops-row"]');
    if (!row) return;
    event.preventDefault();
    row.click();
  });

  el.addEventListener('change', async event => {
    const target = event.target;
    if (target.id === 'an2-group') {
      AN_STATE.groupId = target.value ? Number(target.value) : null;
      await anLoad(el);
    } else if (target.id === 'an2-start') {
      AN_STATE.start = target.value; AN_STATE.preset = 'custom'; await anLoad(el);
    } else if (target.id === 'an2-ops-search') {
      AN_STATE.ops.query = target.value.trim();
      AN_STATE.ops.page = 1; AN_STATE.ops.loadedKey = null;
      anEnsureOps(el);
    } else if (target.id === 'an2-end') {
      AN_STATE.end = target.value; AN_STATE.preset = 'custom'; await anLoad(el);
    }
  });

  el.querySelector('#an2-glossary-btn')?.addEventListener('click', anOpenGlossary);
  el.querySelector('#an2-export')?.addEventListener('click', () => {
    const { start, end } = anResolveRange();
    if (!start || !end) return;
    const params = { start_date: start, end_date: end };
    if (AN_STATE.groupId) params.group_id = AN_STATE.groupId;
    window.open(api.exportUrl('/api/analytics/export.xlsx', params), '_blank');
  });
}

/* Гонка фильтров: смена периода и группы подряд запускает несколько запросов,
   и без маркера последовательности выигрывает тот, кто ответил последним, —
   на экране оказываются данные уже отменённого фильтра. Каждый загрузчик
   получает номер; результат применяется, только если он всё ещё актуален. */
const AN_SEQ = { main: 0, ops: 0, leaders: 0 };

async function anLoad(el) {
  const { start, end } = anResolveRange();
  if (!start || !end) return;

  const seq = ++AN_SEQ.main;
  AN_STATE.loading = true;
  AN_STATE.error = null;
  anPaint(el);

  try {
    const params = {
      start_date: start,
      end_date: end,
      metric: AN_STATE.metric,
    };
    if (AN_STATE.groupId) params.group_id = AN_STATE.groupId;
    if (AN_STATE.weekdays.length < 7) params.weekdays = AN_STATE.weekdays.join(',');
    const data = await api.analyticsGet('dashboard', params);
    if (seq !== AN_SEQ.main) return;   // ответ устарел — его уже отменил новый фильтр
    AN_STATE.data = data;
    if (!AN_STATE.groups) {
      AN_STATE.groups = (await api.analyticsGet('groups-list', {}))?.items || [];
    }
  } catch (error) {
    if (seq !== AN_SEQ.main) return;
    AN_STATE.error = error?.message || 'Не удалось загрузить данные';
  } finally {
    if (seq === AN_SEQ.main) {
      AN_STATE.loading = false;
      AN_STATE.ops.loadedKey = null;   // фильтры могли измениться — таблицу перегрузим
      AN_STATE.leaders.key = null;     // и лидеров пересчитаем
      anPaint(el);
      if (AN_STATE.tab === 'operators' || AN_STATE.tab === 'quality') anEnsureOps(el);
      if (AN_STATE.tab === 'summary') anEnsureLeaders(el);
    }
  }
}

async function anEnsureLeaders(el) {
  const { start, end } = anResolveRange();
  if (!start || !end) return;
  const key = [start, end, AN_STATE.groupId].join('|');
  if (AN_STATE.leaders.key === key && !AN_STATE.leaders.loading) return;
  const seq = ++AN_SEQ.leaders;
  AN_STATE.leaders.loading = true;
  try {
    const params = { start_date: start, end_date: end, page: 1, page_size: 5, sort_by: 'final_points', sort_order: 'desc' };
    if (AN_STATE.groupId) params.group_id = AN_STATE.groupId;
    const res = await api.analyticsGet('operators', params);
    if (seq !== AN_SEQ.leaders) return;
    AN_STATE.leaders.items = (res.items || []).filter(x => x.final_points != null);
    AN_STATE.leaders.key = key;
  } catch {
    if (seq !== AN_SEQ.leaders) return;
    AN_STATE.leaders.items = [];
  } finally {
    if (seq === AN_SEQ.leaders) {
      AN_STATE.leaders.loading = false;
      if (AN_STATE.tab === 'summary') anPaint(el);
    }
  }
}

function anOpsKey() {
  const { start, end } = anResolveRange();
  const o = AN_STATE.ops;
  return [start, end, AN_STATE.groupId, o.page, o.pageSize, o.sortBy, o.sortOrder, o.query].join('|');
}

async function anEnsureOps(el) {
  const key = anOpsKey();
  if (AN_STATE.ops.loadedKey === key && !AN_STATE.ops.loading) { anPaint(el); return; }
  const { start, end } = anResolveRange();
  if (!start || !end) return;
  const seq = ++AN_SEQ.ops;
  AN_STATE.ops.loading = true;
  AN_STATE.ops.error = null;
  anPaint(el);
  try {
    const params = {
      start_date: start, end_date: end,
      page: AN_STATE.ops.page, page_size: AN_STATE.ops.pageSize,
      sort_by: AN_STATE.ops.sortBy, sort_order: AN_STATE.ops.sortOrder,
    };
    if (AN_STATE.groupId) params.group_id = AN_STATE.groupId;
    if (AN_STATE.ops.query) params.operator_query = AN_STATE.ops.query;
    const res = await api.analyticsGet('operators', params);
    if (seq !== AN_SEQ.ops) return;   // пришёл ответ на прежнюю сортировку/страницу
    AN_STATE.ops.items = res.items || [];
    AN_STATE.ops.total = res.total || 0;
    AN_STATE.ops.loadedKey = key;
  } catch (error) {
    if (seq !== AN_SEQ.ops) return;
    AN_STATE.ops.error = error?.message || 'Не удалось загрузить операторов';
  } finally {
    if (seq === AN_SEQ.ops) {
      AN_STATE.ops.loading = false;
      anPaint(el);
    }
  }
}

/* ── Отрисовка ───────────────────────────────────────────── */

function anPaint(el) {
  const filters = el.querySelector('#an2-filters');
  const body = el.querySelector('#an2-body');
  const lede = el.querySelector('#an2-lede');
  if (!filters || !body) return;

  filters.innerHTML = anFiltersHtml();

  // Лид-строка контекста (период/группа). Раньше она обновлялась только при
  // непустых данных, поэтому на пустом периоде навсегда оставалось
  // «Загружаем показатели…», хотя тело уже показывало «данных нет».
  if (AN_STATE.data) {
    const period = AN_STATE.data.period?.label;
    const group = AN_STATE.data.filters?.group_label;
    if (period) {
      lede.textContent = [period, group].filter(Boolean).join(' · ')
        + (AN_STATE.data.filters?.all_weekdays === false ? ' · только выбранные дни недели' : '');
    } else {
      lede.textContent = 'Показатели колл-центра за выбранный период.';
    }
  }

  // Вкладки «Операторы»/«Качество» — свои данные и состояния, dashboard их не блокирует.
  if (AN_STATE.tab === 'operators' || AN_STATE.tab === 'quality') {
    body.innerHTML = AN_STATE.tab === 'operators' ? anOperatorsBody() : anQualityBody();
    return;
  }

  // Вкладка «Общая сводка» — из /dashboard.
  if (AN_STATE.error) {
    lede.textContent = 'Не удалось загрузить показатели.';
    body.innerHTML = `<div class="an2-alert an2-alert-bad">
      <b>Данные не загрузились</b>
      <span>${anEsc(AN_STATE.error)}</span>
    </div>`;
    return;
  }
  if (AN_STATE.loading && !AN_STATE.data) {
    lede.textContent = 'Загружаем показатели…';
    body.innerHTML = `<div role="status" aria-live="polite"><span class="sr-only">Считаем показатели</span>${uiSkeleton({ cards: 4 })}${uiSkeleton({ lines: 4 })}</div>`;
    return;
  }

  const data = AN_STATE.data;
  if (!data) return;

  if (data.empty) {
    body.innerHTML = `<div class="an2-alert an2-alert-empty">
      <b>За этот период данных нет</b>
      <span>${anEsc(data.empty_reason || '')}</span>
    </div>`;
    return;
  }

  body.innerHTML = anSummaryBody(data);
  anBindTrendHover(el);
}

function anSummaryBody(data) {
  const wd = (data.weekdays || []).filter(d => d.value != null);
  const weekdaysBlock = wd.length >= 3
    ? anSectionHtml('weekdays', 'Разрез по дням недели', anWeekdaysHtml(data))
    : '';
  return [
    anVerdictHtml(data),
    anCoverageHtml(data),
    anMetricsHtml(data),
    anSectionHtml('leaders', 'Лидеры периода', anLeadersHtml()),
    anSectionHtml('attention', 'Кому нужно внимание', anAttentionHtml(data)),
    anSectionHtml('trend', 'Как менялось по дням', anTrendHtml(data)),
    anSectionHtml('groups', 'Сравнение групп', anGroupsHtml(data)),
    weekdaysBlock,
  ].join('');
}

/* ── Словесная сводка: что происходит, одним абзацем ─────── */

function anVerdictHtml(data) {
  const metrics = data.metrics || [];
  const scored = metrics.filter(m => m.status === 'good' || m.status === 'watch' || m.status === 'bad');
  const bad = scored.filter(m => m.status === 'bad');
  const watch = scored.filter(m => m.status === 'watch');

  let headline, cls;
  if (bad.length) { headline = `Есть критичные показатели (${bad.length})`; cls = 'bad'; }
  else if (watch.length) { headline = `Есть отклонения от целей (${watch.length})`; cls = 'watch'; }
  else if (scored.length) { headline = 'Ключевые показатели в норме'; cls = 'good'; }
  else { headline = 'Недостаточно данных для оценки'; cls = 'neutral'; }

  const byKey = k => metrics.find(m => m.key === k);
  const phrases = [];
  ['quality', 'kvz', 'efficiency', 'penalty'].forEach(k => {
    const m = byKey(k);
    if (!m || m.value == null || m.status === 'neutral' || m.status === 'unknown') return;
    const val = anFmt(m.value, m.decimals || 0) + anUnitSuffix(m.unit);
    phrases.push(`${anEsc(m.short || m.label)} ${val} — ${AN_STATUS_TEXT[m.status].toLowerCase()}`);
  });

  const groups = (data.groups || []).filter(g => g.quality != null);
  let groupLine = '';
  if (groups.length >= 2) {
    groupLine = `Сильнее всех группа «${anEsc(groups[0].name)}», слабее — «${anEsc(groups[groups.length - 1].name)}».`;
  }

  const attn = (data.attention || []).length;
  const attnLine = attn
    ? `${attn} ${anPlural(attn, 'оператор требует', 'оператора требуют', 'операторов требуют')} внимания.`
    : 'Операторов в красной зоне нет.';

  const cov = data.coverage || {};
  const covLine = cov.total_days ? `Данные за ${cov.days_with_data} из ${cov.total_days} дней периода.` : '';

  const body = [phrases.join('; ') + (phrases.length ? '.' : ''), groupLine, attnLine, covLine]
    .filter(Boolean).join(' ');

  return `<div class="an2-verdict an2-verdict-${cls}">
    <div class="an2-verdict-head">
      <span class="an2-verdict-badge">${AN_STATUS_ICON[cls] || '·'}</span>
      <b>${anEsc(headline)}</b>
    </div>
    <p class="an2-verdict-body">${body}</p>
  </div>`;
}

/* ── Лидеры периода (топ по итоговому баллу) ─────────────── */

function anLeadersHtml() {
  const L = AN_STATE.leaders;
  if (L.loading && !L.items.length) {
    return '<p class="an2-nodata">Загружаем лидеров…</p>';
  }
  if (!L.items.length) {
    return '<p class="an2-nodata">Пока некого выделить — нет операторов с данными за период.</p>';
  }
  const items = L.items.map((x, i) => `
    <li class="an2-lead">
      <span class="an2-lead-rank">${i + 1}</span>
      <span class="an2-lead-name">${anEsc(x.full_name)}<small>${anEsc(x.group_name || '—')}</small></span>
      <span class="an2-lead-score"><b>${anFmt(x.final_points, 1)}</b> балл</span>
      <span class="an2-lead-extra">качество ${x.quality_avg != null ? anFmt(x.quality_avg, 1) + '%' : '—'} · ${anFmt(x.kvz, 1)} зв/ч</span>
    </li>`).join('');
  return `<p class="an2-hint">Топ операторов по итоговому баллу за период.</p>
    <ol class="an2-lead-list">${items}</ol>`;
}

/* ── Вкладка «Операторы» ─────────────────────────────────── */

const AN_RISK_LABEL = { stable: 'Норма', watch: 'Внимание', critical: 'Критично', no_data: 'Нет данных' };
const AN_RISK_CLASS = { stable: 'good', watch: 'watch', critical: 'bad', no_data: 'neutral' };

function anSortArrow(key) {
  if (AN_STATE.ops.sortBy !== key) return '';
  return AN_STATE.ops.sortOrder === 'desc' ? ' ↓' : ' ↑';
}

/* Заголовок сортируемой колонки.

   Сортировка — настоящая <button> внутри <th>, а не role="button" на самой
   ячейке: ARIA-роль не даёт нативной обработки Enter/Space, поэтому такие
   заголовки не работали с клавиатуры вовсе, и <th> терял смысл заголовка
   колонки для скринридера. Направление сортировки дублируется в aria-sort —
   стрелка ↓/↑ остаётся только визуальной подсказкой. */
function anTh(label, key, numeric = true) {
  const active = AN_STATE.ops.sortBy === key;
  const ariaSort = active
    ? (AN_STATE.ops.sortOrder === 'desc' ? 'descending' : 'ascending')
    : 'none';
  const cls = numeric ? 'num an2-sortable' : 'an2-sortable';
  return `<th class="${cls}" aria-sort="${ariaSort}" scope="col">`
    + `<button type="button" class="an2-sort-btn" data-an2="ops-sort" data-value="${key}">`
    + `${label}<span aria-hidden="true">${anSortArrow(key)}</span></button></th>`;
}

function anOperatorsBody() {
  const o = AN_STATE.ops;
  const toolbar = `<div class="an2-ops-toolbar">
    <input type="search" id="an2-ops-search" class="an2-input" placeholder="Поиск по ФИО или группе" value="${anEsc(o.query)}" autocomplete="off">
    <span class="an2-ops-count">${o.loading ? 'Загрузка…' : `Найдено: ${anFmt(o.total)}`}</span>
  </div>`;

  if (o.error) {
    return toolbar + `<div class="an2-alert an2-alert-bad"><b>Не удалось загрузить</b><span>${anEsc(o.error)}</span></div>`;
  }
  if (o.loading && !o.items.length) {
    return toolbar + `<div class="table-wrap" role="status" aria-live="polite"><span class="sr-only">Загружаем операторов</span><table class="data-table"><tbody>${uiTableSkeleton(7, 6, [2, 3, 4, 5, 6])}</tbody></table></div>`;
  }
  if (!o.items.length) {
    return toolbar + `<div class="an2-alert an2-alert-empty"><b>Операторы не найдены</b><span>Измените фильтры, период или поиск.</span></div>`;
  }
  return toolbar + anOpsTable(o) + anOpsPager(o);
}

function anOpsTable(o) {
  const hasNorm = o.items.some(x => x.individual_norm_hours != null);
  const rows = o.items.map((x, i) => {
    const idx = String((o.page - 1) * o.pageSize + i);
    const rk = x.risk_status || 'no_data';
    const detailOpen = AN_STATE.ops.expandedRow === idx;
    const detailCells = [
      ['Ставка', x.rate != null ? String(x.rate) : '—'],
      ['База часов', anFmt(x.base_hours, 1)],
      ['Время в разговоре, ч', anFmt(x.call_time_hours, 1)],
      ['Оценённых звонков', anFmt(x.quality_calls_count)],
      ['Переработка, ч', x.overtime_hours ? '+' + anFmt(x.overtime_hours, 1) : '—'],
      ['Норма часов', x.individual_norm_hours != null ? anFmt(x.individual_norm_hours, 1) : '—'],
    ];
    const detail = detailOpen
      ? `<tr class="an2-ops-detail"><td colspan="11"><div class="an2-ops-detail-grid">${detailCells.map(([k, v]) => `<div><span>${k}</span><b>${anEsc(v)}</b></div>`).join('')}</div></td></tr>`
      : '';
    return `<tr class="an2-ops-row" data-an2="ops-row" data-value="${idx}" tabindex="0" aria-expanded="${detailOpen}">
      <td class="an2-rank">${(o.page - 1) * o.pageSize + i + 1}</td>
      <td class="an2-name">${anEsc(x.full_name)}<small>${anEsc(x.group_name || '—')}</small></td>
      <td class="num">${anFmt(x.total_hours, 1)}</td>
      <td class="num">${x.norm_completion_percent != null ? anFmt(x.norm_completion_percent, 0) + '%' : '—'}</td>
      <td class="num">${anFmt(x.calls_total)}</td>
      <td class="num">${anFmt(x.kvz, 1)}</td>
      <td class="num">${anFmt(x.efficiency_percent, 1)}</td>
      <td class="num">${x.quality_avg != null ? anFmt(x.quality_avg, 1) : '<span class="an2-muted">нет оценок</span>'}</td>
      <td class="num">${anFmt(x.penalty_minutes, 1)}</td>
      <td class="num"><b>${anFmt(x.final_points, 1)}</b></td>
      <td><span class="an2-badge an2-badge-${AN_RISK_CLASS[rk]}">${AN_RISK_LABEL[rk]}</span></td>
    </tr>${detail}`;
  }).join('');

  return `<div class="table-wrap an2-ops-wrap"><table class="data-table an2-ops-table">
    <thead><tr>
      <th class="an2-rank" scope="col">#</th>
      ${anTh('Оператор', 'full_name', false)}
      <th class="num" scope="col">Часы</th>
      <th class="num" scope="col">Норма</th>
      ${anTh('Звонки', 'calls_total')}
      ${anTh('КВЗ', 'kvz')}
      ${anTh('Эфф.%', 'efficiency_percent')}
      ${anTh('Качество', 'quality_avg')}
      ${anTh('Штраф', 'penalty_minutes')}
      ${anTh('Итог', 'final_points')}
      <th scope="col">Риск</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <p class="an2-hint">Нажмите на строку, чтобы раскрыть детали. Пустое качество — оценок за период не было (не считается за ноль).${hasNorm ? '' : ' Норма часов не задана для этой выборки.'}</p>`;
}

function anOpsPager(o) {
  const pages = Math.max(1, Math.ceil(o.total / o.pageSize));
  if (pages <= 1) return '';
  const from = (o.page - 1) * o.pageSize + 1;
  const to = Math.min(o.total, o.page * o.pageSize);
  return `<div class="an2-pager">
    <span>Показано ${from}–${to} из ${anFmt(o.total)}</span>
    <div class="an2-pager-btns">
      <button type="button" class="btn-outline btn-sm" data-an2="ops-page" data-value="prev" ${o.page <= 1 ? 'disabled' : ''}>← Назад</button>
      <span class="an2-pager-label">Стр. ${o.page} из ${pages}</span>
      <button type="button" class="btn-outline btn-sm" data-an2="ops-page" data-value="next" ${o.page >= pages ? 'disabled' : ''}>Вперёд →</button>
    </div>
  </div>`;
}

/* ── Вкладка «Качество» ──────────────────────────────────── */

function anQualityBody() {
  const data = AN_STATE.data;
  const parts = ['<p class="an2-hint">Контроль качества прослушанных звонков за выбранный период. Средняя оценка считается только по проверенным звонкам — операторы без проверок в неё не входят.</p>'];

  if (AN_STATE.loading && !data) {
    return parts.join('') + `<div role="status" aria-live="polite"><span class="sr-only">Считаем показатели</span>${uiSkeleton({ cards: 3 })}</div>`;
  }
  if (data && !data.empty) {
    const qCards = (data.metrics || []).filter(m => ['quality', 'quality_coverage', 'quality_calls'].includes(m.key));
    if (qCards.length) parts.push(`<div class="an2-metrics">${qCards.map(anMetricCard).join('')}</div>`);
    parts.push(anCoverageHtml(data));
    parts.push(anSectionHtml('attention', 'Кому нужно внимание по качеству', anAttentionHtml(data)));
  } else if (data && data.empty) {
    parts.push(`<div class="an2-alert an2-alert-empty"><b>За этот период данных нет</b><span>${anEsc(data.empty_reason || '')}</span></div>`);
  }
  return parts.join('');
}

function anFiltersHtml() {
  const { start, end } = anResolveRange();
  const presets = AN_PRESETS.map(p => `
    <button type="button" class="an2-chip ${AN_STATE.preset === p.key ? 'is-on' : ''}"
            data-an2="preset" data-value="${p.key}">${p.label}</button>`).join('');

  const custom = AN_STATE.preset === 'custom' ? `
    <div class="an2-dates">
      <label>с <input type="date" id="an2-start" value="${anEsc(start || '')}"></label>
      <label>по <input type="date" id="an2-end" value="${anEsc(end || '')}"></label>
    </div>` : '';

  const groups = (AN_STATE.groups || []).map(g =>
    `<option value="${g.id}" ${AN_STATE.groupId === g.id ? 'selected' : ''}>${anEsc(g.name)}</option>`
  ).join('');

  const weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const days = weekdayLabels.map((label, index) => `
    <button type="button" class="an2-day ${AN_STATE.weekdays.includes(index) ? 'is-on' : ''}"
            data-an2="weekday" data-value="${index}"
            aria-pressed="${AN_STATE.weekdays.includes(index)}"
            title="${label}">${label}</button>`).join('');

  return `
    <div class="an2-filter-row">
      <div class="an2-filter">
        <span class="an2-filter-label">Период</span>
        <div class="an2-chips">${presets}</div>
        ${custom}
      </div>
      <div class="an2-filter">
        <span class="an2-filter-label">Группа</span>
        <select class="form-select an2-select" id="an2-group">
          <option value="">Все группы</option>${groups}
        </select>
      </div>
      <div class="an2-filter">
        <span class="an2-filter-label">
          Дни недели
          ${AN_STATE.weekdays.length < 7
            ? '<button type="button" class="an2-reset" data-an2="weekdays-all">сбросить</button>'
            : ''}
        </span>
        <div class="an2-days">${days}</div>
      </div>
    </div>`;
}

function anCoverageHtml(data) {
  const { days_with_data: withData, days_in_selection: total, operators } = data.coverage;
  const partial = withData < total;
  return `
    <div class="an2-coverage ${partial ? 'is-partial' : ''}">
      <span>Данные есть за <b>${withData}</b> ${anPlural(withData, 'день', 'дня', 'дней')} из ${total}</span>
      <span>·</span>
      <span>Операторов в расчёте: <b>${operators}</b></span>
      ${partial ? '<span class="an2-coverage-note">Пустые дни в графике — это дни без загруженных отчётов, а не нули.</span>' : ''}
    </div>`;
}

function anPlural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/* ── Главные показатели ──────────────────────────────────── */

function anMetricsHtml(data) {
  const cards = data.metrics.map(m => anMetricCard(m)).join('');
  return `<div class="an2-metrics">${cards}</div>`;
}

function anMetricCard(m) {
  const expanded = AN_STATE.expanded === m.key;
  const status = m.status || 'unknown';
  const target = m.target === null || m.target === undefined
    ? '<span class="an2-target an2-target-none">без цели — справочный</span>'
    : `<span class="an2-target">цель ${m.direction === 'down' ? 'не больше' : 'от'} ${anFmt(m.target, m.decimals)}${anUnitSuffix(m.unit)}</span>`;

  const delta = anDeltaHtml(m);
  const isTrend = AN_STATE.metric === m.key;

  return `
    <article class="an2-card an2-status-${status} ${expanded ? 'is-open' : ''}">
      <header class="an2-card-top">
        <span class="an2-card-label">${anEsc(m.label)}</span>
        <span class="an2-badge an2-badge-${status}">
          <span class="an2-badge-icon" aria-hidden="true">${AN_STATUS_ICON[status]}</span>
          ${AN_STATUS_TEXT[status]}
        </span>
      </header>

      <div class="an2-value">
        ${anFmt(m.value, m.decimals)}<span class="an2-unit">${anEsc(m.unit)}</span>
      </div>

      <div class="an2-meta">${target}${delta}</div>

      <p class="an2-plain">${anEsc(m.definition)}</p>

      <footer class="an2-card-actions">
        <button type="button" class="an2-link" data-an2="explain" data-value="${m.key}"
                aria-expanded="${expanded}">
          ${expanded ? 'Свернуть' : 'Подробнее'}
        </button>
        ${m.key !== 'operators' ? `
          <button type="button" class="an2-link ${isTrend ? 'is-active' : ''}"
                  data-an2="metric" data-value="${m.key}">
            ${isTrend ? 'Показан на графике' : 'Показать на графике'}
          </button>` : ''}
      </footer>

      ${expanded ? `
        <div class="an2-explain">
          <div><b>Хорошо, когда:</b> ${anEsc(m.good)}</div>
          <div><b>Плохо, когда:</b> ${anEsc(m.bad)}</div>
          <div class="an2-explain-action"><b>Что делать:</b> ${anEsc(m.action)}</div>
          <code class="an2-formula">${anEsc(m.formula)}</code>
        </div>` : ''}
    </article>`;
}

function anUnitSuffix(unit) {
  return unit === '%' ? '%' : '';
}

function anDeltaHtml(m) {
  const d = m.delta || {};
  if (d.value === null || d.value === undefined) {
    return '<span class="an2-delta an2-delta-none">не с чем сравнить</span>';
  }
  if (d.value === 0) return '<span class="an2-delta an2-delta-none">как в прошлом периоде</span>';

  const arrow = d.value > 0 ? '↑' : '↓';
  const amount = `${anFmt(Math.abs(d.value), m.decimals)}${anUnitSuffix(m.unit)}`;

  // У справочных метрик (без цели) рост и падение не бывают «лучше» или
  // «хуже» — иначе подпись спорит с описанием самой карточки.
  if (m.target === null || m.target === undefined) {
    const word = d.value > 0 ? 'больше' : 'меньше';
    return `<span class="an2-delta an2-delta-none">
        <span aria-hidden="true">${arrow}</span>
        ${amount} ${word}, чем в прошлом периоде
      </span>`;
  }

  const better = d.improved;
  const cls = better === null ? 'none' : (better ? 'up' : 'down');
  const word = better ? 'лучше' : 'хуже';
  return `<span class="an2-delta an2-delta-${cls}">
      <span aria-hidden="true">${arrow}</span>
      ${amount} ${word}, чем в прошлом периоде
    </span>`;
}

/* ── Раскрывающиеся секции ───────────────────────────────── */

function anSectionHtml(key, title, inner) {
  const open = !!AN_STATE.open[key];
  return `
    <section class="an2-section ${open ? 'is-open' : ''}">
      <button type="button" class="an2-section-head" data-an2="toggle" data-value="${key}"
              aria-expanded="${open}">
        <span class="an2-section-title">${anEsc(title)}</span>
        <span class="an2-section-caret" aria-hidden="true">${open ? '▾' : '▸'}</span>
      </button>
      ${open ? `<div class="an2-section-body">${inner}</div>` : ''}
    </section>`;
}

/* ── График динамики (линия) ─────────────────────────────── */

function anTrendHtml(data) {
  const switcher = (data.trend_metrics || []).map(m => `
    <button type="button" class="an2-chip an2-chip-sm ${data.trend.metric === m.key ? 'is-on' : ''}"
            data-an2="metric" data-value="${m.key}">${anEsc(m.short)}</button>`).join('');

  return `
    <div class="an2-trend-head">
      <div class="an2-chips">${switcher}</div>
      <span class="an2-trend-unit">${anEsc(data.trend.label)}, ${anEsc(data.trend.unit)}</span>
    </div>
    ${anLineChart(data.trend)}
    ${anTrendTable(data.trend)}`;
}

function anLineChart(trend) {
  const points = (trend.points || []).filter(p => p.has_data && p.value !== null);
  if (points.length < 2) {
    return `<p class="an2-nodata">Для графика нужно минимум два дня с данными. Сейчас есть ${points.length}.</p>`;
  }

  const W = 760, H = 240, PAD_L = 46, PAD_R = 14, PAD_T = 16, PAD_B = 30;
  const values = points.map(p => p.value);
  const target = trend.target;
  let min = Math.min(...values, target ?? Infinity);
  let max = Math.max(...values, target ?? -Infinity);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.12; max += span * 0.12;

  const x = i => PAD_L + (i * (W - PAD_L - PAD_R)) / (points.length - 1);
  const y = v => PAD_T + (H - PAD_T - PAD_B) * (1 - (v - min) / (max - min));

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${(H - PAD_B).toFixed(1)}L${PAD_L},${(H - PAD_B).toFixed(1)}Z`;

  // Сетка: 4 линии, подписи слева.
  const ticks = [0, 1, 2, 3].map(i => {
    const v = min + (max - min) * (i / 3);
    return `<g>
      <line class="an2-grid" x1="${PAD_L}" y1="${y(v).toFixed(1)}" x2="${W - PAD_R}" y2="${y(v).toFixed(1)}"></line>
      <text class="an2-axis" x="${PAD_L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${anFmt(v, trend.decimals)}</text>
    </g>`;
  }).join('');

  const targetLine = (target === null || target === undefined) ? '' : `
    <g>
      <line class="an2-target-line" x1="${PAD_L}" y1="${y(target).toFixed(1)}" x2="${W - PAD_R}" y2="${y(target).toFixed(1)}"></line>
      <text class="an2-target-text" x="${W - PAD_R}" y="${(y(target) - 6).toFixed(1)}" text-anchor="end">цель ${anFmt(target, trend.decimals)}</text>
    </g>`;

  // Подписи по X — только первая, средняя и последняя, чтобы не слипались.
  const labelIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const xLabels = [...new Set(labelIdx)].map(i => `
    <text class="an2-axis" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${anEsc(points[i].label)}</text>`).join('');

  const dots = points.map((p, i) => `
    <circle class="an2-dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4"
            data-label="${anEsc(p.label)}" data-value="${anFmt(p.value, trend.decimals)} ${anEsc(trend.unit)}"></circle>`).join('');

  return `
    <figure class="an2-chart" data-chart="trend">
      <svg viewBox="0 0 ${W} ${H}" role="img"
           aria-label="Динамика показателя «${anEsc(trend.label)}» по дням">
        ${ticks}
        <path class="an2-area" d="${area}"></path>
        <path class="an2-line" d="${line}"></path>
        ${targetLine}
        ${dots}
      </svg>
      <div class="an2-tip" id="an2-tip" hidden></div>
    </figure>`;
}

function anTrendTable(trend) {
  const rows = (trend.points || []).map(p => `
    <tr><td>${anEsc(p.label)}</td><td>${p.has_data ? anFmt(p.value, trend.decimals) : 'нет данных'}</td></tr>`).join('');
  return `
    <details class="an2-table-toggle">
      <summary>Показать таблицей</summary>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th scope="col">День</th><th scope="col">${anEsc(trend.label)}, ${anEsc(trend.unit)}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>`;
}

function anBindTrendHover(el) {
  const figure = el.querySelector('[data-chart="trend"]');
  const tip = el.querySelector('#an2-tip');
  if (!figure || !tip) return;
  figure.querySelectorAll('.an2-dot').forEach(dot => {
    const show = () => {
      tip.hidden = false;
      // Через dataset значение возвращается уже РАСКОДИРОВАННЫМ: экранирование,
      // сделанное при записи атрибута, здесь теряется, и innerHTML снова
      // трактовал бы содержимое как разметку. Пишем текстом.
      tip.textContent = '';
      const labelEl = document.createElement('b');
      labelEl.textContent = dot.dataset.label || '';
      const valueEl = document.createElement('span');
      valueEl.textContent = dot.dataset.value || '';
      tip.append(labelEl, valueEl);
      const box = figure.getBoundingClientRect();
      const point = dot.getBoundingClientRect();
      tip.style.left = `${point.left - box.left + point.width / 2}px`;
      tip.style.top = `${point.top - box.top}px`;
      dot.classList.add('is-hot');
    };
    const hide = () => { tip.hidden = true; dot.classList.remove('is-hot'); };
    dot.addEventListener('mouseenter', show);
    dot.addEventListener('mouseleave', hide);
    dot.addEventListener('focus', show);
    dot.addEventListener('blur', hide);
    dot.setAttribute('tabindex', '0');
  });
}

/* ── Дни недели ──────────────────────────────────────────── */

function anWeekdaysHtml(data) {
  const rows = data.weekdays.filter(w => w.days > 0);
  if (!rows.length) return '<p class="an2-nodata">Нет данных для разреза по дням недели.</p>';
  const max = Math.max(...rows.map(r => r.value ?? 0), data.trend.target ?? 0) || 1;

  const bars = rows.map(r => {
    const width = Math.max(2, ((r.value ?? 0) / max) * 100);
    return `
      <div class="an2-wd-row">
        <span class="an2-wd-name">${anEsc(r.full)}</span>
        <div class="an2-wd-track">
          <div class="an2-wd-fill an2-fill-${r.status}" style="width:${width.toFixed(1)}%"></div>
        </div>
        <span class="an2-wd-val">${anFmt(r.value, data.trend.decimals)}</span>
        <span class="an2-wd-status an2-badge-${r.status}">${AN_STATUS_TEXT[r.status]}</span>
      </div>`;
  }).join('');

  return `
    <p class="an2-hint">Показатель «${anEsc(data.trend.label)}» в среднем по каждому дню недели.
       Так видно, в какие дни команда проседает.</p>
    <div class="an2-wd">${bars}</div>`;
}

/* ── Группы ──────────────────────────────────────────────── */

function anGroupsHtml(data) {
  if (!data.groups.length) return '<p class="an2-nodata">Нет данных по группам.</p>';
  const rows = data.groups.map(g => `
    <tr>
      <td class="name-cell">${anEsc(g.name)}</td>
      <td>${g.operators}</td>
      <td>${anFmt(g.quality, 1)}</td>
      <td>${anFmt(g.kvz, 1)}</td>
      <td>${anFmt(g.efficiency, 1)}</td>
      <td>${anFmt(g.penalty, 0)}</td>
      <td><span class="an2-badge an2-badge-${g.status}">
        <span class="an2-badge-icon" aria-hidden="true">${AN_STATUS_ICON[g.status]}</span>
        ${AN_STATUS_TEXT[g.status]}</span></td>
    </tr>`).join('');

  return `
    <p class="an2-hint">Группы отсортированы по качеству — сверху те, кто работает лучше.</p>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th scope="col">Группа</th><th scope="col">Людей</th><th scope="col">Качество, %</th><th scope="col">Звонков/ч</th>
          <th scope="col">В разговоре, %</th><th scope="col">Штрафы, мин</th><th scope="col">Оценка</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ── Кому нужно внимание ─────────────────────────────────── */

function anAttentionHtml(data) {
  if (!data.attention.length) {
    return `<p class="an2-nodata an2-nodata-good">
      Никто не в критической зоне за выбранный период. Это хорошая новость.</p>`;
  }
  const items = data.attention.map(a => `
    <li class="an2-att">
      <div class="an2-att-top">
        <span class="an2-att-name">${anEsc(a.name)}</span>
        <span class="an2-att-group">${anEsc(a.group)}</span>
      </div>
      <div class="an2-att-fact">
        ${anEsc(a.metric_label)}: <b>${anFmt(a.value, a.decimals)}${anUnitSuffix(a.unit)}</b>
        <span class="an2-att-target">при цели ${anFmt(a.target, a.decimals)}${anUnitSuffix(a.unit)}</span>
      </div>
      <div class="an2-att-action">${anEsc(a.action)}</div>
    </li>`).join('');

  return `
    <p class="an2-hint">Операторы, у которых хотя бы один показатель в красной зоне.
       Сверху — те, кто дальше всех от цели.</p>
    <ul class="an2-att-list">${items}</ul>`;
}

/* ── Глоссарий ───────────────────────────────────────────── */

async function anOpenGlossary() {
  let metrics = [];
  try {
    metrics = (await api.analyticsGet('glossary', {}))?.metrics || [];
  } catch {
    return showToast('Не удалось загрузить справочник', 'error');
  }
  const rows = metrics.map(m => `
    <div class="an2-gloss-item">
      <div class="an2-gloss-head">
        <b>${anEsc(m.label)}</b>
        <span>${anEsc(m.unit)}</span>
      </div>
      <p>${anEsc(m.definition)}</p>
      <div class="an2-gloss-line"><b>Хорошо:</b> ${anEsc(m.good || '')}</div>
      <div class="an2-gloss-line"><b>Плохо:</b> ${anEsc(m.bad || '')}</div>
      ${m.target !== null && m.target !== undefined
        ? `<div class="an2-gloss-line"><b>Цель:</b> ${anFmt(m.target, m.decimals)}${anUnitSuffix(m.unit)}</div>`
        : '<div class="an2-gloss-line an2-gloss-muted">Справочный показатель — цели нет.</div>'}
    </div>`).join('');

  showModal(`
    <h3 class="modal-title">Что означают показатели</h3>
    <p class="an2-hint">Одинаковые определения используются и в расчёте, и в выгрузке.</p>
    <div class="an2-gloss">${rows}</div>`);
}

window.renderAnalytics = renderAnalytics;
