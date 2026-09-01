/* ══════════════════════════════════════════════════════════════
   Экран «Пользователи» по макету 2026.

   Объявлен позже 30-admin-coins-groups-operators.view.js, поэтому
   переопределяет тамошний renderUsersPage — старый файл на 3428 строк
   не трогаем, его модалки и действия переиспользуются как есть.

   Отличия от прежнего экрана: строка раскрывается карточкой с копируемыми
   полями и действиями, появилась пагинация (раньше на экран вываливались
   все 200 записей сразу), фильтр по уровню наконец что-то делает —
   в API добавлен параметр level_id.
══════════════════════════════════════════════════════════════ */

const USERS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

function usersInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  const letters = parts.slice(0, 2).map(p => p[0]).join('');
  return letters.toUpperCase();
}

/** «Сегодня, 10:24» / «Вчера, 18:03» / «12.02.2024» — как в макете. */
function usersWhen(value, { withTime = true } = {}) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = n => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return withTime ? `Сегодня, ${time}` : 'Сегодня';
  if (sameDay(d, yesterday)) return withTime ? `Вчера, ${time}` : 'Вчера';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Активность свежее пяти минут показываем зелёной точкой. */
function usersIsOnline(value) {
  if (!value) return false;
  const t = new Date(value).getTime();
  return !Number.isNaN(t) && Date.now() - t < 5 * 60 * 1000;
}

const USERS_ROLE_LABEL = {
  operator: 'Оператор',
  supervisor: 'Супервайзер',
  manager: 'Руководитель',
  admin: 'Администратор',
};

const USERS_STATUS_LABEL = {
  active: 'Активен',
  inactive: 'Неактивен',
  blocked: 'Заблокирован',
  dismissed: 'Уволен',
};

function usersStatusTone(status) {
  if (status === 'active') return 'ok';
  if (status === 'blocked' || status === 'dismissed') return 'danger';
  return 'muted';
}

function renderUsersPage() {
  const el = document.getElementById('view-operators');
  if (!el) return;

  // Список не загрузился — это не «никого нет». Показываем ошибку с
  // повтором, иначе экран врёт: предлагает завести первого сотрудника,
  // когда в базе их шестьдесят.
  if (STATE.usersError && !(STATE.users || []).length) {
    el.innerHTML = `
      <div class="up">
        <header class="up-head">
          <div class="up-head-text">
            <h1 class="up-title">Пользователи</h1>
            <p class="up-count">Список не загрузился</p>
          </div>
        </header>
        <div class="up-card up-card-state">
          ${uiErrorStateFor(STATE.usersError, { retryLabel: 'Загрузить снова' })}
        </div>
      </div>`;
    uiBindStateActions(el, { retry: () => reloadUsersList() });
    return;
  }

  const all = Array.isArray(STATE.users) ? STATE.users : [];
  const f = STATE.usersFilters || (STATE.usersFilters = {});
  const sort = STATE.usersSort || (STATE.usersSort = { key: 'full_name', dir: 'asc' });
  const expanded = STATE.usersExpanded || (STATE.usersExpanded = new Set());
  if (!STATE.usersPaging) STATE.usersPaging = { page: 1, perPage: 10 };
  const paging = STATE.usersPaging;

  const isInactive = u => u.status !== 'active';
  const tab = f.tab || 'all';

  // ── Фильтрация ───────────────────────────────────────────────────────
  const search = (f.search || '').trim().toLowerCase();
  let rows = all.filter(u => {
    if (tab === 'active' && isInactive(u)) return false;
    if (tab === 'inactive' && !isInactive(u)) return false;
    if (f.role && u.role !== f.role) return false;
    if (f.group && String(u.group_id || '') !== String(f.group)) return false;
    if (f.level && String(u.level?.id || '') !== String(f.level)) return false;
    if (f.status && u.status !== f.status) return false;
    if (search) {
      const hay = [u.full_name, u.login, u.username, u.email].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // ── Сортировка ───────────────────────────────────────────────────────
  const dir = sort.dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const pick = u => {
      if (sort.key === 'group') return u.group_name || '';
      if (sort.key === 'level') return u.level?.sort_order ?? 999;
      if (sort.key === 'status') return USERS_STATUS_LABEL[u.status] || u.status || '';
      return u.full_name || '';
    };
    const x = pick(a); const y = pick(b);
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y), 'ru') * dir;
  });

  // ── Пагинация ────────────────────────────────────────────────────────
  const perPage = paging.perPage;
  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  if (paging.page > pageCount) paging.page = pageCount;
  const page = paging.page;
  const from = (page - 1) * perPage;
  const pageRows = rows.slice(from, from + perPage);

  const counts = {
    all: all.length,
    active: all.filter(u => !isInactive(u)).length,
    inactive: all.filter(isInactive).length,
  };

  const groups = [...new Map(all.filter(u => u.group_id)
    .map(u => [u.group_id, u.group_name])).entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ru'));
  const levels = [...new Map(all.filter(u => u.level)
    .map(u => [u.level.id, u.level])).values()]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const roles = [...new Set(all.map(u => u.role).filter(Boolean))];

  const hasFilters = Boolean(search || f.role || f.group || f.level || f.status || tab !== 'all');

  el.innerHTML = `
    <div class="up">
      <header class="up-head">
        <div class="up-head-text">
          <h1 class="up-title">Пользователи</h1>
          <p class="up-count">${all.length} ${uiPlural(all.length, 'учётная запись', 'учётные записи', 'учётных записей')}</p>
        </div>
        <div class="up-head-actions">
          <button class="btn-outline" type="button" data-up="norms">
            ${upIcon('clock')}<span>Нормы часов</span>
          </button>
          <button class="btn-primary" type="button" data-up="create">
            ${upIcon('plus')}<span>Новый пользователь</span>
          </button>
        </div>
      </header>

      <div class="up-tabs" role="tablist" aria-label="Фильтр по состоянию">
        ${[['all', 'Все', counts.all], ['active', 'Активные', counts.active], ['inactive', 'Неактивные', counts.inactive]]
          .map(([key, label, n]) => `
            <button class="up-tab${tab === key ? ' is-active' : ''}" role="tab"
                    aria-selected="${tab === key}" data-up-tab="${key}">
              ${label}<span class="up-tab-count">${n}</span>
            </button>`).join('')}
      </div>

      <div class="up-toolbar">
        <label class="up-search">
          <span class="sr-only">Поиск по ФИО, логину или email</span>
          ${upIcon('search')}
          <input class="up-search-input" type="search" value="${esc(f.search || '')}"
                 placeholder="Поиск по ФИО, логину или email…" data-up="search">
        </label>
        ${upSelect('role', 'Роль', f.role, roles.map(r => [r, USERS_ROLE_LABEL[r] || r]), 'Все роли')}
        ${upSelect('group', 'Группа', f.group, groups, 'Все группы')}
        ${upSelect('level', 'Уровень', f.level, levels.map(l => [l.id, l.name]), 'Все уровни')}
        ${upSelect('status', 'Статус', f.status, Object.entries(USERS_STATUS_LABEL), 'Все статусы')}
        ${hasFilters ? `<button class="up-reset" type="button" data-up="reset">Сбросить</button>` : ''}
      </div>

      <div class="up-card">
        ${pageRows.length ? `
          <table class="data-table up-table">
            <thead>
              <tr>
                ${upTh('full_name', 'Пользователь', sort)}
                ${upTh('group', 'Группа', sort)}
                ${upTh('level', 'Уровень', sort)}
                ${upTh('status', 'Статус', sort)}
                <th class="up-th-actions" scope="col"><span class="sr-only">Действия</span></th>
              </tr>
            </thead>
            <tbody>
              ${pageRows.map(u => upRow(u, expanded.has(u.id))).join('')}
            </tbody>
          </table>
          <div class="up-pager">
            <p class="up-pager-range">
              Показано ${from + 1}–${from + pageRows.length} из ${rows.length}
            </p>
            ${upPages(page, pageCount)}
            <label class="up-perpage">
              <span class="sr-only">Записей на странице</span>
              <select class="up-perpage-select" data-up="perpage">
                ${USERS_PER_PAGE_OPTIONS.map(n =>
                  `<option value="${n}"${n === perPage ? ' selected' : ''}>${n} на странице</option>`).join('')}
              </select>
            </label>
          </div>
        ` : (hasFilters
          ? uiNoResultsState('Никого не нашли',
              'Под выбранные условия не подходит ни одна запись. Измените фильтры или сбросьте их.',
              [{ label: 'Сбросить фильтры', action: 'up-reset', kind: 'outline' }])
          : uiEmptyState('Пользователей пока нет',
              'Добавьте первого сотрудника кнопкой «Новый пользователь».'))}
      </div>
    </div>`;

  bindUsersPage(el);
}

/** Склонение: 1 запись / 2 записи / 5 записей. */
function uiPlural(n, one, few, many) {
  const mod10 = n % 10; const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function upIcon(name) {
  const paths = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16v4Z"/>',
    role: '<path d="M12 3v18M5 8h14"/>',
    key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9m-3 0v3"/>',
    off: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6m0-6-6 6"/>',
  };
  return `<svg class="up-i" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function upSelect(key, label, value, pairs, allLabel) {
  return `
    <label class="up-filter">
      <span class="sr-only">${esc(label)}</span>
      <select class="up-filter-select" data-up-filter="${key}">
        <option value="">${esc(label)}: ${esc(allLabel)}</option>
        ${pairs.map(([v, t]) =>
          `<option value="${esc(String(v))}"${String(value || '') === String(v) ? ' selected' : ''}>${esc(String(t))}</option>`).join('')}
      </select>
    </label>`;
}

function upTh(key, label, sort) {
  const active = sort.key === key;
  const next = active && sort.dir === 'asc' ? 'по убыванию' : 'по возрастанию';
  return `<th class="up-th${active ? ' is-sorted' : ''}" scope="col" aria-sort="${active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
    <button class="up-sort" type="button" data-up-sort="${key}" title="Сортировать ${next}">
      ${esc(label)}<span class="up-sort-i" aria-hidden="true">${active ? (sort.dir === 'asc' ? '↑' : '↓') : '⇅'}</span>
    </button>
  </th>`;
}

function upPages(page, pageCount) {
  if (pageCount <= 1) return '<div class="up-pages"></div>';
  const nums = [];
  const push = n => { if (!nums.includes(n)) nums.push(n); };
  push(1);
  for (let n = page - 1; n <= page + 1; n++) if (n > 1 && n < pageCount) push(n);
  push(pageCount);
  nums.sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of nums) {
    if (prev && n - prev > 1) out.push('<span class="up-gap">…</span>');
    out.push(`<button class="up-page${n === page ? ' is-current' : ''}" type="button"
      data-up-page="${n}"${n === page ? ' aria-current="page"' : ''}>${n}</button>`);
    prev = n;
  }
  return `<div class="up-pages">
    <button class="up-page up-nav" type="button" data-up-page="${page - 1}"
      ${page === 1 ? 'disabled' : ''} aria-label="Предыдущая страница">‹</button>
    ${out.join('')}
    <button class="up-page up-nav" type="button" data-up-page="${page + 1}"
      ${page === pageCount ? 'disabled' : ''} aria-label="Следующая страница">›</button>
  </div>`;
}

function upField(label, value, copyable) {
  if (!value) return '';
  return `<div class="up-field">
    <dt class="up-field-label">${esc(label)}</dt>
    <dd class="up-field-value">
      <span>${esc(String(value))}</span>
      ${copyable ? `<button class="up-copy" type="button" data-up-copy="${esc(String(value))}"
        aria-label="Скопировать ${esc(label.toLowerCase())}">${upIcon('copy')}</button>` : ''}
    </dd>
  </div>`;
}

function upRow(u, isOpen) {
  const role = USERS_ROLE_LABEL[u.role] || u.role || '';
  const login = u.login || u.username || '';
  const online = usersIsOnline(u.last_seen_at);
  const seen = usersWhen(u.last_seen_at) || 'Ни разу не заходил';
  const added = usersWhen(u.created_at, { withTime: false }) || '—';

  return `
    <tr class="up-row${isOpen ? ' is-open' : ''}" data-up-row="${u.id}">
      <td class="up-cell-user">
        <button class="up-expand" type="button" data-up-expand="${u.id}"
                aria-expanded="${isOpen}" aria-label="${isOpen ? 'Свернуть' : 'Развернуть'} карточку">
          ${upIcon('chevron')}
        </button>
        <span class="up-avatar" aria-hidden="true">${esc(usersInitials(u.full_name))}</span>
        <span class="up-user">
          <span class="up-user-name">${esc(u.full_name || '—')}</span>
          <span class="up-user-sub">${esc(role)}${login ? ` · ${esc(login)}` : ''}</span>
        </span>
      </td>
      <td class="up-cell-group">${u.group_name ? esc(u.group_name) : '<span class="up-dash">Не назначена</span>'}</td>
      <td class="up-cell-level">${u.level
        ? `<span class="up-level">${esc(u.level.name)}</span>`
        : '<span class="up-dash">—</span>'}</td>
      <td class="up-cell-status">
        <span class="up-status up-status-${usersStatusTone(u.status)}">
          ${esc(USERS_STATUS_LABEL[u.status] || u.status || '—')}
        </span>
      </td>
      <td class="up-cell-actions">
        <button class="up-more" type="button" data-up-menu="${u.id}" aria-label="Действия">···</button>
      </td>
    </tr>
    ${isOpen ? `
    <tr class="up-detail-row">
      <td colspan="5">
        <div class="up-detail">
          <dl class="up-fields">
            ${upField('Email', u.email, true)}
            ${upField('Логин', login, true)}
            ${upField('Дата добавления', added, false)}
            <div class="up-field">
              <dt class="up-field-label">Последняя активность</dt>
              <dd class="up-field-value">
                <span class="up-seen${online ? ' is-online' : ''}">${esc(seen)}</span>
              </dd>
            </div>
          </dl>
          <div class="up-detail-actions">
            <button class="btn-outline btn-sm up-act-primary" type="button" data-up-edit="${u.id}">
              ${upIcon('edit')}<span>Редактировать пользователя</span>
            </button>
            <button class="btn-outline btn-sm" type="button" data-up-role="${u.id}">
              ${upIcon('role')}<span>Сменить роль</span>
            </button>
            <button class="btn-outline btn-sm" type="button" data-up-password="${u.id}">
              ${upIcon('key')}<span>Сбросить пароль</span>
            </button>
            <button class="btn-outline btn-sm up-act-danger" type="button" data-up-off="${u.id}"
              ${u.status !== 'active' ? 'disabled title="Учётная запись уже неактивна"' : ''}>
              ${upIcon('off')}<span>Деактивировать</span>
            </button>
          </div>
        </div>
      </td>
    </tr>` : ''}`;
}

function bindUsersPage(el) {
  const f = STATE.usersFilters;
  const paging = STATE.usersPaging;
  const rerender = () => renderUsersPage();

  el.querySelector('[data-up="create"]')?.addEventListener('click', () => showUserManagementModal?.());
  el.querySelector('[data-up="norms"]')?.addEventListener('click', () => window.showWorkNormsModal?.());

  el.querySelectorAll('[data-up-tab]').forEach(b => b.addEventListener('click', () => {
    f.tab = b.dataset.upTab; paging.page = 1; rerender();
  }));

  const search = el.querySelector('[data-up="search"]');
  if (search) {
    // Ждём паузу в наборе: перерисовывать таблицу на каждый символ незачем.
    let t = null;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        f.search = search.value; paging.page = 1; rerender();
        const again = document.querySelector('[data-up="search"]');
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 250);
    });
  }

  el.querySelectorAll('[data-up-filter]').forEach(s => s.addEventListener('change', () => {
    f[s.dataset.upFilter] = s.value; paging.page = 1; rerender();
  }));
  el.querySelectorAll('[data-up="reset"], [data-action="up-reset"]').forEach(b =>
    b.addEventListener('click', () => {
      STATE.usersFilters = { tab: 'all' }; paging.page = 1; rerender();
    }));

  el.querySelectorAll('[data-up-sort]').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.upSort;
    const sort = STATE.usersSort;
    if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
    else { sort.key = key; sort.dir = 'asc'; }
    rerender();
  }));

  el.querySelectorAll('[data-up-page]').forEach(b => b.addEventListener('click', () => {
    const n = Number(b.dataset.upPage);
    if (!Number.isFinite(n) || n < 1) return;
    paging.page = n; rerender();
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }));
  el.querySelector('[data-up="perpage"]')?.addEventListener('change', e => {
    paging.perPage = Number(e.target.value) || 10; paging.page = 1; rerender();
  });

  el.querySelectorAll('[data-up-expand]').forEach(b => b.addEventListener('click', () => {
    const id = Number(b.dataset.upExpand);
    const set = STATE.usersExpanded;
    if (set.has(id)) set.delete(id); else set.add(id);
    rerender();
  }));

  el.querySelectorAll('[data-up-copy]').forEach(b => b.addEventListener('click', async () => {
    const text = b.dataset.upCopy;
    try {
      await navigator.clipboard.writeText(text);
      uiToast?.('Скопировано', 'success');
    } catch (e) {
      uiToast?.('Браузер не дал доступ к буферу обмена', 'error');
    }
  }));

  const byId = id => (STATE.users || []).find(u => u.id === Number(id));
  el.querySelectorAll('[data-up-edit]').forEach(b => b.addEventListener('click',
    () => showUserManagementModal?.(byId(b.dataset.upEdit))));
  el.querySelectorAll('[data-up-menu]').forEach(b => b.addEventListener('click',
    () => showUserManagementModal?.(byId(b.dataset.upMenu))));
  el.querySelectorAll('[data-up-role]').forEach(b => b.addEventListener('click',
    () => showChangeUsernameModal?.(byId(b.dataset.upRole))));
  el.querySelectorAll('[data-up-password]').forEach(b => b.addEventListener('click',
    () => showUserResetPasswordModal?.(byId(b.dataset.upPassword))));
  el.querySelectorAll('[data-up-off]').forEach(b => b.addEventListener('click',
    () => deactivateUserUi?.(Number(b.dataset.upOff))));
}


/**
 * Повторная загрузка списка после ошибки: сбрасываем кеш ключа, иначе
 * swrFetch отдаст то, что лежит, и повтор окажется бессмысленным.
 */
async function reloadUsersList() {
  const el = document.getElementById('view-operators');
  if (el) el.innerHTML = uiPageLoader('Загружаем пользователей');
  try {
    swrInvalidate('users:list');
    const data = await api.listUsers({ limit: 200 });
    STATE.users = Array.isArray(data) ? data : (data.items || []);
    STATE.usersError = null;
  } catch (err) {
    STATE.usersError = err;
    STATE.users = [];
  }
  renderUsersPage();
}
