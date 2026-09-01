/* ══════════════════════════════════════════════════════════════
   СОСТОЯНИЯ СТРАНИЦЫ — общие построители разметки

   Одна и та же ситуация обязана выглядеть одинаково во всех разделах.
   До этого каждый раздел писал свою вёрстку: «Рейтинг» при ошибке
   оставался пустым, «Миссии» показывали строку текста, «Аналитика» и
   «Сводка» — два разных варианта ошибки.

   Все функции возвращают строку HTML и ничего не вставляют сами —
   вызывающий решает, куда её положить. Пользовательский текст всегда
   проходит через esc().

   Стили — css/src/components/20-states.css.
══════════════════════════════════════════════════════════════ */

/** Загрузка раздела. slowNote показывается, когда ожидание затянулось. */
function uiPageLoader(message = 'Загружаем данные', slowNote = '') {
  return `
    <div class="page-loader" role="status" aria-live="polite">
      <div class="page-loader-spinner" aria-hidden="true"></div>
      <span>${esc(message)}</span>
      ${slowNote ? `<p class="page-loader-slow">${esc(slowNote)}</p>` : ''}
    </div>`;
}

/**
 * Запускает загрузку с honest-ожиданием: если ответ не пришёл за
 * threshold мс, текст меняется на объяснение, а не крутится вечно.
 * Возвращает функцию отмены — вызовите её, когда данные пришли.
 */
function uiPageLoaderWithDelay(host, message, slowNote, threshold = 3000) {
  if (!host) return () => {};
  host.innerHTML = uiPageLoader(message);
  const timer = setTimeout(() => {
    const note = host.querySelector('.page-loader');
    if (!note || note.querySelector('.page-loader-slow')) return;
    const p = document.createElement('p');
    p.className = 'page-loader-slow';
    p.textContent = slowNote || 'Ответ идёт дольше обычного. Сервер мог «уснуть» — подождите ещё немного.';
    note.appendChild(p);
  }, threshold);
  return () => clearTimeout(timer);
}

/** Скелетон под будущий контент: строки или карточки. */
function uiSkeleton({ lines = 3, cards = 0 } = {}) {
  if (cards > 0) {
    return `<div class="skeleton-row">${
      Array.from({ length: cards }, () => '<div class="skeleton skeleton-card"></div>').join('')
    }</div>`;
  }
  return `<div class="skeleton-group"><div class="skeleton skeleton-title"></div>${
    Array.from({ length: lines }, (_, i) =>
      `<div class="skeleton skeleton-line" style="width:${95 - i * 12}%"></div>`).join('')
  }</div>`;
}

/**
 * Скелетон строк таблицы: пока данные едут, экран сохраняет свою форму,
 * и содержимое не прыгает при подстановке. Пять–восемь строк — столько,
 * чтобы каркас читался, но не выглядел как готовый список.
 *
 * @param {number} columns сколько колонок в таблице
 * @param {number} rows    сколько строк-заглушек нарисовать
 * @param {number[]} numeric индексы колонок с числами (выравниваются вправо)
 */
function uiTableSkeleton(columns, rows = 6, numeric = []) {
  const count = Math.max(1, Math.min(8, rows));
  const nums = new Set(numeric);
  const cells = Array.from({ length: Math.max(1, columns) }, (_, i) =>
    `<td class="${nums.has(i) ? 'num' : ''}"><div class="skeleton skeleton-cell"></div></td>`).join('');
  return Array.from({ length: count }, () =>
    `<tr class="is-skeleton" aria-hidden="true">${cells}</tr>`).join('');
}

/**
 * Скелетон списка: строка с кружком и двумя полосками. Подходит там, где
 * грузится перечень людей, операций или уведомлений.
 */
function uiListSkeleton(rows = 5) {
  return `<div class="skeleton-list">${
    Array.from({ length: Math.max(1, Math.min(8, rows)) }, () => `
      <div class="skeleton-list__row">
        <div class="skeleton skeleton-avatar"></div>
        <div class="skeleton-list__text">
          <div class="skeleton skeleton-line" style="width:42%"></div>
          <div class="skeleton skeleton-line" style="width:68%"></div>
        </div>
      </div>`).join('')
  }</div>`;
}

/** Скелетон формы: подпись и поле, столько пар, сколько полей ожидается. */
function uiFormSkeleton(fields = 4) {
  return `<div class="skeleton-form">${
    Array.from({ length: Math.max(1, Math.min(10, fields)) }, () => `
      <div class="skeleton-form__field">
        <div class="skeleton skeleton-line" style="width:32%;height:10px"></div>
        <div class="skeleton skeleton-input"></div>
      </div>`).join('')
  }</div>`;
}

/**
 * Общее состояние загрузки. Вместо крутящегося кружка с подписью рисует
 * каркас будущего содержимого: страница сохраняет форму, и при подстановке
 * данных ничего не прыгает. Текст остаётся для скринридера.
 *
 * @param {string} text что именно грузится
 * @param {{cards?: number, lines?: number}} shape форма каркаса
 */
function uiLoadingBlock(text = 'Загружаем данные', shape = { lines: 4 }) {
  const body = shape.cards ? uiSkeleton({ cards: shape.cards }) : uiSkeleton({ lines: shape.lines || 4 });
  return `<div class="ui-loading" role="status" aria-live="polite">`
    + `<span class="sr-only">${esc(text)}</span>${body}</div>`;
}

function uiStateActions(actions = []) {
  const buttons = actions.filter(Boolean).map(a => {
    const cls = a.variant === 'ghost' ? 'btn-outline' : 'btn-primary';
    return `<button class="${cls}" type="button" data-ui-action="${esc(a.id)}">${esc(a.label)}</button>`;
  }).join('');
  return buttons ? `<div class="state-actions">${buttons}</div>` : '';
}

function uiStateBlock({ kind, icon, title, text, detail, requestId, actions, rawActions, compact }) {
  return `
    <div class="state-block state-${esc(kind)}${compact ? ' state-compact' : ''}"${kind === 'error' ? ' role="alert"' : ''}>
      <div class="state-icon" aria-hidden="true">${esc(icon)}</div>
      <h2 class="state-title">${esc(title)}</h2>
      ${text ? `<p class="state-text">${esc(text)}</p>` : ''}
      ${detail ? `<p class="state-detail">${esc(detail)}</p>` : ''}
      ${requestId ? `<p class="state-meta">Код обращения: <code>${esc(requestId)}</code></p>` : ''}
      ${rawActions ? `<div class="state-actions">${rawActions}</div>` : uiStateActions(actions)}
    </div>`;
}

/**
 * Данных ещё нет — это нормальный сценарий, а не сбой.
 *
 * Принимает три формы вызова, потому что в проекте исторически сложились
 * все три и ломать существующие экраны ради единообразия сигнатуры нельзя:
 *   uiEmptyState('Заголовок', 'Текст')
 *   uiEmptyState('Заголовок', 'Текст', '<button>…</button>')   — готовый HTML
 *   uiEmptyState({ title, description, action })               — объектом
 */
function uiEmptyState(title, text, actions = [], compact = false) {
  if (title && typeof title === 'object') {
    const o = title;
    return uiStateBlock({
      kind: 'empty', icon: '—',
      title: o.title, text: o.description || o.text,
      actions: [], rawActions: o.action || '', compact: Boolean(o.compact),
    });
  }
  if (typeof actions === 'string') {
    return uiStateBlock({ kind: 'empty', icon: '—', title, text, actions: [], rawActions: actions, compact });
  }
  return uiStateBlock({ kind: 'empty', icon: '—', title, text, actions, compact });
}

/** Данные есть, но фильтры ничего не нашли. Отличается от пустоты. */
function uiNoResultsState(title = 'Ничего не найдено', text = 'Измените условия поиска или сбросьте фильтры.', actions = [], compact = false) {
  return uiStateBlock({ kind: 'no-results', icon: '∅', title, text, actions, compact });
}

/** Запрос не удался. Всегда с возможностью повторить. */
function uiErrorState(title, text, { detail = '', requestId = '', actions = [], compact = false } = {}) {
  return uiStateBlock({ kind: 'error', icon: '!', title, text, detail, requestId, actions, compact });
}

/** Нет прав. Не путаем с ошибкой сервера. */
function uiForbiddenState(title = 'Раздел недоступен', text = 'У вашей роли нет доступа к этим данным. Обратитесь к администратору, если доступ нужен для работы.', compact = false, actions = []) {
  return uiStateBlock({ kind: 'forbidden', icon: '×', title, text, compact, actions });
}

/** Плашка «показаны неполные данные» — поверх уже отрисованного контента. */
function uiPartialNotice(text) {
  return `
    <div class="state-partial" role="status">
      <span class="state-partial-mark" aria-hidden="true">!</span>
      <span>${esc(text)}</span>
    </div>`;
}

/** Компактная ошибка рядом с блоком, когда старые данные остаются на экране. */
function uiInlineError(text, requestId = '') {
  return `
    <div class="state-inline-error" role="alert">
      <span class="state-partial-mark" aria-hidden="true">!</span>
      <span>${esc(text)}${requestId ? ` <code>${esc(requestId)}</code>` : ''}</span>
    </div>`;
}

/**
 * Приводит ошибку fetch к состоянию, понятному пользователю.
 * Разные причины требуют разных слов: отсутствие прав — не сбой сервера,
 * а обрыв сети — не ошибка данных.
 */
function uiClassifyError(error) {
  const status = error?.status;
  const message = String(error?.message || '');
  const requestId = error?.requestId || error?.request_id || '';

  if (status === 401) {
    return { kind: 'session', title: 'Сессия завершена', text: 'Войдите заново, чтобы продолжить работу.', requestId };
  }
  if (status === 403) {
    return { kind: 'forbidden', title: 'Раздел недоступен', text: 'У вашей роли нет доступа к этим данным.', requestId };
  }
  if (status === 404) {
    return { kind: 'empty', title: 'Данных за период нет', text: 'За выбранный период записи не найдены. Попробуйте другой период.', requestId };
  }
  if (status === 400 || status === 422) {
    return { kind: 'validation', title: 'Некорректные параметры', text: message || 'Проверьте выбранный период и фильтры.', requestId };
  }
  if (status >= 500) {
    return { kind: 'server', title: 'Сервер не ответил', text: 'Похоже, это временный сбой. Повторите попытку через несколько секунд.', detail: message, requestId };
  }
  if (!status) {
    return { kind: 'network', title: 'Нет связи с сервером', text: 'Проверьте подключение к сети и повторите попытку.', detail: message, requestId };
  }
  return { kind: 'server', title: 'Не удалось загрузить', text: message || 'Неизвестная ошибка.', requestId };
}

/**
 * Готовый блок ошибки по объекту исключения: сам выбирает формулировку
 * и добавляет кнопку повтора там, где повтор имеет смысл.
 */
function uiErrorStateFor(error, { retryLabel = 'Повторить', compact = false } = {}) {
  const info = uiClassifyError(error);
  if (info.kind === 'forbidden') return uiForbiddenState(info.title, info.text, compact);
  if (info.kind === 'empty') return uiEmptyState(info.title, info.text, [], compact);
  const actions = info.kind === 'session'
    ? [{ id: 'reload', label: 'Войти заново' }]
    : [{ id: 'retry', label: retryLabel }];
  return uiErrorState(info.title, info.text, {
    detail: info.detail || '',
    requestId: info.requestId,
    actions,
    compact,
  });
}

/** Навешивает обработчики на кнопки состояния внутри контейнера. */
function uiBindStateActions(host, handlers = {}) {
  if (!host) return;
  host.querySelectorAll('[data-ui-action]').forEach(btn => {
    const id = btn.dataset.uiAction;
    const fn = handlers[id] || (id === 'reload' ? () => location.reload() : null);
    if (fn) btn.addEventListener('click', fn);
  });
}
