/* ══════════════════════════════════════════════════════════════
   Общие примитивы по ТЗ: Card, KPI, Table, Pagination, Chart shell.

   Modal (showModal/closeModal) и Toast (showToast) уже существуют —
   здесь они не дублируются. Состояния loading / empty / error /
   forbidden живут в 10-states.js и переиспользуются как есть.

   Всё возвращает строку разметки: экраны собирают её в innerHTML, как и
   раньше. Обработчики вешаются отдельно — uiBindTable и uiBindPagination,
   чтобы разметка оставалась чистой, без inline onclick.
══════════════════════════════════════════════════════════════ */

const UI_PAGE_SIZES = [10, 25, 50, 100];

/**
 * Карточка-контейнер: заголовок, подпись, действия и тело.
 * Вокруг таблиц, списков и графиков — одна и та же рамка на всех экранах.
 */
function uiCard({ title = '', subtitle = '', actions = '', body = '', tone = '', id = '', flush = false } = {}) {
  const head = (title || subtitle || actions) ? `
    <header class="ui-card-head">
      <div class="ui-card-head-text">
        ${title ? `<h2 class="ui-card-title">${esc(title)}</h2>` : ''}
        ${subtitle ? `<p class="ui-card-sub">${esc(subtitle)}</p>` : ''}
      </div>
      ${actions ? `<div class="ui-card-actions">${actions}</div>` : ''}
    </header>` : '';
  return `<section class="ui-card${tone ? ` ui-tone-${esc(tone)}` : ''}${flush ? ' is-flush' : ''}"${id ? ` id="${esc(id)}"` : ''}>
    ${head}<div class="ui-card-body">${body}</div>
  </section>`;
}

/**
 * KPI-карточка. Показывает только то, что реально пришло: значение, цель,
 * выборку, изменение. Отсутствующее поле не выдумывается и не рисуется —
 * ТЗ прямо запрещает подставлять фиктивные значения.
 *
 * tone задаётся статусом с бэкенда, а не порогом на фронте.
 */
function uiKpi({ label, value, unit = '', target = null, sample = null, tone = 'neutral',
                 delta = '', note = '', hint = '', chart = '' } = {}) {
  const hasValue = value !== null && value !== undefined && value !== '';
  const meta = [];
  if (target !== null && target !== undefined && target !== '') meta.push(`Цель: ${esc(String(target))}${esc(unit)}`);
  if (sample !== null && sample !== undefined) meta.push(`выборка: ${esc(String(sample))}`);
  return `
    <article class="ui-kpi ui-tone-${esc(tone)}">
      <header class="ui-kpi-head">
        <h3 class="ui-kpi-label">${esc(label)}</h3>
        ${hint ? `<button class="ui-kpi-hint" type="button" title="${esc(hint)}"
          aria-label="Что означает показатель «${esc(label)}»">i</button>` : ''}
      </header>
      <p class="ui-kpi-value">${hasValue ? `${esc(String(value))}${esc(unit)}` : '<span class="ui-kpi-nodata">нет данных</span>'}</p>
      ${meta.length ? `<p class="ui-kpi-meta">${meta.join(' · ')}</p>` : ''}
      ${chart}
      ${note ? `<p class="ui-kpi-note">${esc(note)}</p>` : ''}
      ${delta}
    </article>`;
}

/** Изменение к прошлому периоду. Без сравнения — честная подпись, а не ноль. */
function uiKpiDelta(change, { lowerIsBetter = false, suffix = 'к прошлому периоду' } = {}) {
  if (change === null || change === undefined || Number.isNaN(Number(change))) {
    return `<span class="ui-delta is-none">Нет сравнения ${esc(suffix)}</span>`;
  }
  const num = Number(change);
  const improved = lowerIsBetter ? num < 0 : num > 0;
  const cls = num === 0 ? 'is-flat' : (improved ? 'is-up' : 'is-down');
  const sign = num > 0 ? '+' : '';
  return `<span class="ui-delta ${cls}">${sign}${esc(String(Math.round(num * 10) / 10))} ${esc(suffix)}</span>`;
}

/**
 * Таблица по канону ТЗ: липкая шапка, сортировка с aria-sort, scope у
 * заголовков, колонка действий справа, карточный режим на узком экране.
 *
 * columns: [{ key, label, sortable, numeric, actions }]
 * rows:    [{ id, cells: [html], detail, expanded }]
 */
function uiTable({ columns = [], rows = [], sort = null, caption = '', mobile = 'cards', empty = '' } = {}) {
  if (!rows.length) return empty || uiEmptyState('Нет данных', 'Пока показывать нечего.', [], true);

  const th = columns.map(c => {
    const active = sort && sort.key === c.key;
    const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    const cls = ['ui-th', c.numeric ? 'num' : '', c.actions ? 'ui-th-actions' : '', active ? 'is-sorted' : '']
      .filter(Boolean).join(' ');
    const label = c.actions
      ? `<span class="sr-only">${esc(c.label || 'Действия')}</span>`
      : (c.sortable
        ? `<button class="ui-sort" type="button" data-ui-sort="${esc(c.key)}">${esc(c.label)}<span class="ui-sort-i" aria-hidden="true">${active ? (sort.dir === 'asc' ? '↑' : '↓') : '⇅'}</span></button>`
        : esc(c.label));
    return `<th class="${cls}" scope="col" aria-sort="${ariaSort}">${label}</th>`;
  }).join('');

  const body = rows.map(r => {
    const cells = r.cells.map((html, i) => {
      const c = columns[i] || {};
      const label = c.actions ? '' : ` data-label="${esc(c.label || '')}"`;
      return `<td class="${c.numeric ? 'num' : ''}${c.actions ? ' ui-td-actions' : ''}"${label}>${html}</td>`;
    }).join('');
    const detail = r.detail
      ? `<tr class="ui-detail-row"><td colspan="${columns.length}">${r.detail}</td></tr>` : '';
    return `<tr class="ui-row${r.expanded ? ' is-open' : ''}"${r.id != null ? ` data-ui-row="${esc(String(r.id))}"` : ''}>${cells}</tr>${detail}`;
  }).join('');

  return `<div class="ui-table-wrap">
    <table class="data-table ui-table" data-mobile="${esc(mobile)}">
      ${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ''}
      <thead><tr>${th}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

/**
 * Пагинация: диапазон, страницы и размер страницы.
 * ТЗ требует показывать и диапазон, и общее число — «1–10 из 60».
 */
function uiPagination({ page = 1, perPage = 10, total = 0, pageSizes = UI_PAGE_SIZES, label = 'записей' } = {}) {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pageCount);
  const from = total ? (current - 1) * perPage + 1 : 0;
  const to = Math.min(total, current * perPage);

  const nums = [];
  const push = n => { if (n >= 1 && n <= pageCount && !nums.includes(n)) nums.push(n); };
  push(1);
  for (let n = current - 1; n <= current + 1; n++) push(n);
  push(pageCount);
  nums.sort((a, b) => a - b);

  let pages = '';
  let prev = 0;
  for (const n of nums) {
    if (prev && n - prev > 1) pages += '<span class="ui-page-gap">…</span>';
    pages += `<button class="ui-page${n === current ? ' is-current' : ''}" type="button"
      data-ui-page="${n}"${n === current ? ' aria-current="page"' : ''}>${n}</button>`;
    prev = n;
  }

  return `<nav class="ui-pager" aria-label="Постраничная навигация">
    <p class="ui-pager-range">Показано ${from}–${to} из ${total} ${esc(label)}</p>
    ${pageCount > 1 ? `<div class="ui-pages">
      <button class="ui-page ui-page-nav" type="button" data-ui-page="${current - 1}"
        ${current === 1 ? 'disabled' : ''} aria-label="Предыдущая страница">‹</button>
      ${pages}
      <button class="ui-page ui-page-nav" type="button" data-ui-page="${current + 1}"
        ${current === pageCount ? 'disabled' : ''} aria-label="Следующая страница">›</button>
    </div>` : '<div class="ui-pages"></div>'}
    <label class="ui-perpage">
      <span class="sr-only">Записей на странице</span>
      <select class="ui-perpage-select" data-ui-perpage>
        ${pageSizes.map(n => `<option value="${n}"${n === perPage ? ' selected' : ''}>${n} на странице</option>`).join('')}
      </select>
    </label>
  </nav>`;
}

/**
 * Оболочка графика. ТЗ требует: подпись, единицу, легенду и обязательную
 * текстовую альтернативу — скрытую таблицу данных. Без данных показывается
 * честное пустое состояние, а не линия из одной точки.
 */
function uiChartShell({ title = '', subtitle = '', unit = '', controls = '', chart = '',
                        legend = '', rows = [], columns = [], emptyText = '' } = {}) {
  if (!chart) {
    return uiEmptyState(
      'Недостаточно данных для графика',
      emptyText || 'Точек за выбранный период слишком мало. Измените период или дождитесь расчёта.',
      [], true,
    );
  }
  const table = rows.length ? `
    <details class="ui-chart-data">
      <summary>Данные графика таблицей</summary>
      <table class="data-table ui-chart-table">
        <thead><tr>${columns.map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(String(v))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </details>` : '';
  return `
    <figure class="ui-chart">
      ${(title || controls) ? `<figcaption class="ui-chart-head">
        <div class="ui-chart-head-text">
          ${title ? `<span class="ui-chart-title">${esc(title)}</span>` : ''}
          ${subtitle ? `<span class="ui-chart-sub">${esc(subtitle)}</span>` : ''}
          ${unit ? `<span class="ui-chart-unit">${esc(unit)}</span>` : ''}
        </div>
        ${controls ? `<div class="ui-chart-controls">${controls}</div>` : ''}
      </figcaption>` : ''}
      <div class="ui-chart-body">${chart}</div>
      ${legend}
      ${table}
    </figure>`;
}

/** Сортировка таблицы: клик по заголовку переключает направление. */
function uiBindTable(host, state, onChange) {
  host?.querySelectorAll('[data-ui-sort]').forEach(btn => btn.addEventListener('click', () => {
    const key = btn.dataset.uiSort;
    if (state.key === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    else { state.key = key; state.dir = 'asc'; }
    onChange();
  }));
}

/** Страницы и размер страницы. Смена размера всегда возвращает на первую. */
function uiBindPagination(host, state, onChange) {
  host?.querySelectorAll('[data-ui-page]').forEach(btn => btn.addEventListener('click', () => {
    const n = Number(btn.dataset.uiPage);
    if (!Number.isFinite(n) || n < 1) return;
    state.page = n;
    onChange();
  }));
  host?.querySelector('[data-ui-perpage]')?.addEventListener('change', e => {
    state.perPage = Number(e.target.value) || 10;
    state.page = 1;
    onChange();
  });
}
