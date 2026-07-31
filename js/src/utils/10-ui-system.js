/* Shared UI contracts. Keep screen-specific views free from raw enums and ad-hoc formats. */
const UI_TIME_ZONE = 'Asia/Almaty';

const UI_STATUS_META = Object.freeze({
  active: ['Активен', 'success'],
  inactive: ['Неактивен', 'neutral'],
  blocked: ['Заблокирован', 'danger'],
  locked: ['Заблокирована', 'neutral'],
  dismissed: ['Уволен', 'neutral'],
  available: ['Доступна', 'success'],
  unavailable: ['Недоступна', 'neutral'],
  not_available: ['Недоступна', 'neutral'],
  coming_soon: ['Скоро', 'neutral'],
  upcoming: ['Скоро', 'neutral'],
  in_progress: ['В процессе', 'info'],
  completed: ['Завершена', 'success'],
  finished: ['Завершён', 'success'],
  drawn: ['Разыгран', 'success'],
  failed: ['Не пройден', 'danger'],
  passed: ['Пройден', 'success'],
  cancelled: ['Отменена', 'neutral'],
  canceled: ['Отменена', 'neutral'],
  expired: ['Истекла', 'neutral'],
  used: ['Использована', 'neutral'],
  pending: ['На рассмотрении', 'warning'],
  new: ['Новая', 'info'],
  approved: ['Одобрена', 'success'],
  processing: ['Выполняется', 'info'],
  fulfilled: ['Получена', 'success'],
  issued: ['Получена', 'success'],
  rejected: ['Отклонена', 'danger'],
  refunded: ['Возврат', 'neutral'],
  draft: ['Черновик', 'neutral'],
  published: ['Опубликовано', 'success'],
  archived: ['В архиве', 'neutral'],
  paused: ['Приостановлена', 'warning'],
  scheduled: ['Запланирована', 'info'],
  partially_available: ['Доступна частично', 'warning'],
});

function uiNumber(value, maximumFractionDigits = 1) {
  if (value === null || value === undefined || value === '') return 'Нет данных';
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Нет данных';
  return number.toLocaleString('ru-KZ', { maximumFractionDigits });
}

function uiDate(value) {
  if (!value) return 'Нет данных';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-KZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: UI_TIME_ZONE,
  }).format(date);
}

function uiDateTime(value) {
  if (!value) return 'Нет данных';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-KZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: UI_TIME_ZONE,
  }).format(date).replace(',', '');
}

function uiCoin(value, options = {}) {
  if (value === null || value === undefined || value === '') return 'Нет данных';
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Нет данных';
  const formatted = uiNumber(number, options.maximumFractionDigits ?? 0);
  if (options.symbol) return `${formatted} ₡`;
  if (options.sign && number > 0) return `+${formatted} коинов`;
  return `${formatted} ${pluralize(Math.abs(number), 'коин', 'коина', 'коинов')}`;
}

function uiStatusMeta(value) {
  const key = String(value || '').trim().toLowerCase();
  return UI_STATUS_META[key] || ['Статус не определён', 'neutral'];
}

function uiStatusLabel(value) {
  return uiStatusMeta(value)[0];
}

function uiErrorMessage(error, fallback = 'Не удалось выполнить действие') {
  const raw = String(error?.message || error?.detail || '').trim();
  if (!raw) return fallback;
  if (/traceback|exception|sqlalchemy|psycopg|internal server error|<!doctype|\{\s*"/i.test(raw)) return fallback;
  return raw.length > 240 ? `${raw.slice(0, 237)}…` : raw;
}

function uiStatusBadge(value) {
  const [label, tone] = uiStatusMeta(value);
  return `<span class="ui-status ui-status--${tone}">${esc(label)}</span>`;
}

function uiPageHeader({ eyebrow = '', title, description = '', meta = '', actions = '' }) {
  return `<header class="ui-page-header">
    <div class="ui-page-header__copy">
      ${eyebrow ? `<span class="ui-page-header__eyebrow">${esc(eyebrow)}</span>` : ''}
      <h1 tabindex="-1">${esc(title)}</h1>
      ${description ? `<p>${esc(description)}</p>` : ''}
    </div>
    ${meta || actions ? `<div class="ui-page-header__side">${meta}${actions ? `<div class="ui-page-header__actions">${actions}</div>` : ''}</div>` : ''}
  </header>`;
}

function uiButton({ label, variant = 'secondary', type = 'button', id = '', attributes = '', icon = '' }) {
  const allowed = ['primary', 'secondary', 'tertiary', 'destructive', 'icon'];
  const kind = allowed.includes(variant) ? variant : 'secondary';
  const className = kind === 'destructive' ? 'btn-danger' : kind === 'tertiary' ? 'btn-ghost' : kind === 'icon' ? 'icon-button' : `btn-${kind}`;
  return `<button${id ? ` id="${esc(id)}"` : ''} class="${className}" type="${type === 'submit' ? 'submit' : 'button'}" ${attributes}>${icon}${label ? `<span>${esc(label)}</span>` : ''}</button>`;
}

function uiKpiCard({ label, value, detail = '', trend = '', tone = 'neutral' }) {
  return `<article class="ui-kpi-card ui-kpi-card--${esc(tone)}">
    <span class="ui-kpi-card__label">${esc(label)}</span>
    <strong class="ui-kpi-card__value">${esc(value)}</strong>
    ${detail || trend ? `<div class="ui-kpi-card__footer">${detail ? `<span>${esc(detail)}</span>` : ''}${trend ? `<b>${esc(trend)}</b>` : ''}</div>` : ''}
  </article>`;
}

function uiProgressBar(value, { label = 'Прогресс', max = 100 } = {}) {
  const safeMax = Math.max(1, Number(max) || 100);
  const safeValue = Math.min(safeMax, Math.max(0, Number(value) || 0));
  const percent = Math.round((safeValue / safeMax) * 100);
  return `<div class="ui-progress" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${safeMax}" aria-valuenow="${safeValue}"><span style="--ui-progress:${percent}%"></span><small>${percent}%</small></div>`;
}

function uiSkeleton({ rows = 3, label = 'Загрузка данных' } = {}) {
  return `<div class="ui-skeleton" role="status" aria-label="${esc(label)}">${Array.from({ length: Math.max(1, rows) }, (_, index) => `<span style="--skeleton-width:${92 - (index % 3) * 13}%"></span>`).join('')}<span class="sr-only">${esc(label)}</span></div>`;
}

function uiErrorState(title, description = '', retryAction = '') {
  return `<div class="ui-state ui-state--error" role="alert"><span class="ui-state__icon" aria-hidden="true">!</span><strong>${esc(title)}</strong>${description ? `<p>${esc(description)}</p>` : ''}${retryAction}</div>`;
}

function uiAvatar(name, { size = 'md', image = '' } = {}) {
  const initials = String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
  return image
    ? `<span class="ui-avatar ui-avatar--${esc(size)}"><img src="${esc(image)}" alt=""></span>`
    : `<span class="ui-avatar ui-avatar--${esc(size)}" aria-hidden="true">${esc(initials)}</span>`;
}

function uiPagination({ page = 1, totalPages = 1, idPrefix = 'page' } = {}) {
  const current = Math.max(1, Number(page) || 1);
  const total = Math.max(1, Number(totalPages) || 1);
  return `<nav class="ui-pagination" aria-label="Страницы"><button class="btn-secondary" type="button" data-${esc(idPrefix)}="prev" ${current <= 1 ? 'disabled' : ''}>Назад</button><span>Страница ${current} из ${total}</span><button class="btn-secondary" type="button" data-${esc(idPrefix)}="next" ${current >= total ? 'disabled' : ''}>Далее</button></nav>`;
}

function uiEmptyState(title, description = '', action = '') {
  return `<div class="ui-empty-state" role="status">
    <strong>${esc(title)}</strong>
    ${description ? `<p>${esc(description)}</p>` : ''}
    ${action}
  </div>`;
}

function uiSetBusy(button, busy, label = 'Сохраняем…') {
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<span class="ui-button-spinner" aria-hidden="true"></span>${esc(label)}`;
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = button.dataset.idleLabel || button.textContent;
  }
}

let UI_CONFIRM_RESOLVER = null;

function uiResolveConfirm(confirmed) {
  const resolver = UI_CONFIRM_RESOLVER;
  UI_CONFIRM_RESOLVER = null;
  closeModal();
  if (resolver) resolver(Boolean(confirmed));
}

function uiCancelPendingConfirm() {
  const resolver = UI_CONFIRM_RESOLVER;
  UI_CONFIRM_RESOLVER = null;
  if (resolver) resolver(false);
}

function uiConfirmAction({
  title = 'Подтвердите действие',
  description = 'Вы уверены, что хотите продолжить?',
  confirmLabel = 'Подтвердить',
  danger = true,
} = {}) {
  if (typeof showModal !== 'function') {
    console.error('Puls modal system is unavailable; destructive action was cancelled.');
    return Promise.resolve(false);
  }
  uiCancelPendingConfirm();
  return new Promise(resolve => {
    UI_CONFIRM_RESOLVER = resolve;
    showModal(`
      <div class="ui-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ui-confirm-title">
        <h3 class="modal-title" id="ui-confirm-title">${esc(title)}</h3>
        <p>${esc(description)}</p>
        <div class="ui-confirm-dialog__actions">
          <button class="btn-outline" type="button" onclick="uiResolveConfirm(false)">Отмена</button>
          <button class="${danger ? 'btn-danger' : 'btn-primary'}" type="button" onclick="uiResolveConfirm(true)">${esc(confirmLabel)}</button>
        </div>
      </div>`);
  });
}

function uiSyncQuery(values, { replace = true } = {}) {
  const url = new URL(location.href);
  Object.entries(values).forEach(([key, value]) => {
    if (value === '' || value === null || value === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  });
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
}

function uiReadQuery(defaults = {}) {
  const params = new URLSearchParams(location.search);
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [key, params.get(key) ?? fallback]),
  );
}

function uiEnhanceTable(table) {
  if (!table) return;
  const headers = Array.from(table.querySelectorAll('thead th')).map(cell => cell.textContent.trim());
  if (!headers.length) return;
  table.dataset.uiEnhanced = 'true';
  const complex = table.matches('.an-heatmap, .an-quality-grid, [data-keep-table]')
    || table.closest('.an-heatmap, .an-quality-grid, [data-keep-table]');
  if (!complex) table.dataset.mobileCards = 'true';
  table.querySelectorAll('tbody tr').forEach(row => {
    Array.from(row.children).forEach((cell, index) => {
      if (!cell.hasAttribute('data-label') && Number(cell.getAttribute('colspan') || 1) === 1) {
        cell.setAttribute('data-label', headers[index] || '');
      }
    });
  });
  const wrapper = table.closest('.table-wrap, .data-table-wrap, .an-table-scroll, .sessions-table-wrap, .users-table-wrap');
  if (wrapper && !wrapper.hasAttribute('tabindex')) {
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    const heading = wrapper.closest('section, article, .panel, .card')?.querySelector('h2, h3, .panel-title');
    wrapper.setAttribute('aria-label', heading?.textContent?.trim() || 'Таблица данных');
  }
}

function uiEnhanceRenderedContent(root = document) {
  const scope = root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_NODE ? root : document;
  const query = selector => [
    ...(scope.matches?.(selector) ? [scope] : []),
    ...scope.querySelectorAll(selector),
  ];
  const containingTable = scope.closest?.('table');
  if (containingTable) uiEnhanceTable(containingTable);
  query('table').forEach(uiEnhanceTable);
  query('button').forEach(button => {
    if (button.hasAttribute('aria-label') || button.textContent.trim()) return;
    button.setAttribute('aria-label', button.getAttribute('title') || 'Действие');
  });
  query('svg').forEach(svg => {
    if (svg.closest('button, a') || svg.hasAttribute('aria-label') || svg.getAttribute('aria-hidden') === 'true') return;
    const container = svg.closest('.chart-container, .an-card, .race-chart-wrap');
    if (!container) return;
    const title = container.querySelector('h2, h3, .an-card-head')?.textContent?.trim() || 'График показателей';
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', title);
  });
  query('img:not([alt])').forEach(image => image.setAttribute('alt', ''));
}

document.addEventListener('DOMContentLoaded', () => {
  uiEnhanceRenderedContent(document);
  // Observe the shell and lazily-created overlays/toasts with one batched
  // observer. Attribute changes made by the enhancer are intentionally not
  // observed, so this cannot recurse.
  const root = document.body;
  let queued = false;
  const pendingRoots = new Set();
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) pendingRoots.add(node);
    }));
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      pendingRoots.forEach(node => uiEnhanceRenderedContent(node));
      pendingRoots.clear();
    });
  });
  observer.observe(root, { childList: true, subtree: true });
});
