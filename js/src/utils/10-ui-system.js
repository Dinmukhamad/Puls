/* Shared UI contracts. Keep screen-specific views free from raw enums and ad-hoc formats. */
const UI_TIME_ZONE = 'Asia/Almaty';

const UI_STATUS_META = Object.freeze({
  active: ['Активен', 'success'],
  inactive: ['Неактивен', 'neutral'],
  blocked: ['Заблокирован', 'danger'],
  dismissed: ['Уволен', 'neutral'],
  available: ['Доступна', 'success'],
  coming_soon: ['Скоро', 'neutral'],
  upcoming: ['Скоро', 'neutral'],
  in_progress: ['В процессе', 'info'],
  completed: ['Завершена', 'success'],
  finished: ['Завершён', 'success'],
  cancelled: ['Отменена', 'neutral'],
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
