/* ══════════════════════════════════════════════════════════════
   Экран «Группы» по макету 2026 (ТЗ, раздел 6.6).

   Объявлен позже 30-admin-coins-groups-operators.view.js, поэтому
   переопределяет тамошний renderGroups. Модалки создания, изменения,
   переключения статуса и удаления оттуда переиспользуются как есть —
   бизнес-логика не трогается.

   ОГОВОРКА ТЗ (стр. 17) выполнена буквально: GroupRead содержит только
   id, name, status, operator_count, created_at, updated_at. Полей «Код»
   и «Подгруппы» с макета в API нет, поэтому их здесь нет — вместо них
   в KPI стоят реальные вычисления по этому же ответу. Ничего не
   выдумываем.

   Отличия от прежнего экрана: KPI, поиск по названию, фильтр статуса,
   сортировка по четырём колонкам, пагинация, даты создания и обновления,
   раздельные пустые состояния и удаление только для админа.
══════════════════════════════════════════════════════════════ */

const GROUPS_STATUS_LABEL = { active: 'Активна', inactive: 'Отключена' };

function groupsState() {
  return STATE.groupsPage || (STATE.groupsPage = {
    search: '',
    status: '',
    sort: { key: 'name', dir: 'asc' },
    paging: { page: 1, perPage: 10 },
  });
}

function groupsWhen(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  // ТЗ: интерфейс показывает DD.MM.YYYY и местное время.
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function groupsStatusBadge(status) {
  const label = GROUPS_STATUS_LABEL[status] || status || '—';
  const tone = status === 'active' ? 'success' : 'neutral';
  // Точка и текст: статус читается и без различения цветов.
  return `<span class="ui-badge ui-badge--${tone}">${esc(label)}</span>`;
}

function groupsFiltered(all) {
  const s = groupsState();
  const needle = s.search.trim().toLowerCase();
  return all.filter(g => {
    if (s.status && g.status !== s.status) return false;
    if (needle && !String(g.name || '').toLowerCase().includes(needle)) return false;
    return true;
  });
}

function groupsSorted(rows) {
  const { key, dir } = groupsState().sort;
  const value = g => {
    if (key === 'operators') return Number(g.operator_count || 0);
    if (key === 'status') return GROUPS_STATUS_LABEL[g.status] || '';
    if (key === 'created') return new Date(g.created_at || 0).getTime();
    if (key === 'updated') return new Date(g.updated_at || 0).getTime();
    return String(g.name || '');
  };
  return [...rows].sort((a, b) => {
    const av = value(a); const bv = value(b);
    const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ru');
    return dir === 'desc' ? -cmp : cmp;
  });
}

function groupsRowActions(group) {
  const canDelete = STATE.user?.role === 'admin';
  const nextStatus = group.status === 'active' ? 'inactive' : 'active';
  const toggleLabel = group.status === 'active' ? 'Отключить' : 'Включить';
  return `
    <div class="row-actions">
      <button class="btn-outline btn-sm" type="button" data-group-edit="${group.id}">Изменить</button>
      <button class="btn-outline btn-sm" type="button"
              data-group-toggle="${group.id}" data-group-next="${nextStatus}">${toggleLabel}</button>
      ${canDelete ? `<button class="btn-danger btn-sm" type="button" data-group-delete="${group.id}">Удалить</button>` : ''}
    </div>`;
}

function renderGroups() {
  const el = document.getElementById('view-groups');
  if (!el) return;

  if (!canManageGroups()) {
    el.innerHTML = uiForbiddenState(
      'Раздел недоступен',
      'Управление группами доступно руководителю и администратору.',
    );
    return;
  }

  // Ошибка загрузки — это не «групп нет». Иначе экран предлагает завести
  // первую группу, когда их шесть.
  if (STATE.groupsError && !(STATE.groups || []).length) {
    el.innerHTML = `
      <header class="ui-page-header">
        <div class="ui-page-header__copy">
          <span class="ui-page-header__eyebrow">Группы</span>
          <h1 tabindex="-1">Управление группами</h1>
        </div>
      </header>
      ${uiCard({ body: uiErrorStateFor(STATE.groupsError, { retryLabel: 'Загрузить снова' }) })}`;
    uiBindStateActions(el, { retry: () => reloadGroupsList() });
    return;
  }

  // Мутации из старого файла (создание, переименование, смена статуса,
  // удаление) делают swrInvalidate('groups:') и зовут renderGroups. Экран
  // рисуется из STATE, поэтому сам факт инвалидации и означает «данные
  // устарели»: без этой ветки бейдж статуса оставался прежним после
  // успешного отключения группы.
  if (Array.isArray(STATE.groups) && !swrPeek('groups:list')) {
    reloadGroupsList({ keepContent: true });
  }

  // Списка ещё нет — показываем каркас нужной формы и запускаем загрузку.
  // Пустой массив от пустого состояния отличаем по самому факту загрузки.
  if (!Array.isArray(STATE.groups)) {
    el.innerHTML = `
      <header class="ui-page-header">
        <div class="ui-page-header__copy">
          <span class="ui-page-header__eyebrow">Группы</span>
          <h1 tabindex="-1">Управление группами</h1>
        </div>
      </header>
      ${uiCard({ flush: true, body: `<div class="ui-table-wrap"><table class="data-table"><tbody>${
        uiTableSkeleton(6, 5, [1])}</tbody></table></div>` })}`;
    reloadGroupsList();
    return;
  }

  const s = groupsState();
  const all = STATE.groups;
  const filtered = groupsSorted(groupsFiltered(all));

  // KPI считаются по тому же ответу, что и таблица: никаких отдельных
  // источников и никаких полей, которых нет в GroupRead.
  const activeCount = all.filter(g => g.status === 'active').length;
  const operatorsTotal = all.reduce((sum, g) => sum + Number(g.operator_count || 0), 0);
  const inactiveCount = all.length - activeCount;

  const total = filtered.length;
  const perPage = s.paging.perPage;
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (s.paging.page > pages) s.paging.page = pages;
  const from = (s.paging.page - 1) * perPage;
  const pageRows = filtered.slice(from, from + perPage);

  const hasFilters = Boolean(s.search.trim() || s.status);
  const columns = [
    { key: 'name', label: 'Группа', sortable: true },
    { key: 'operators', label: 'Операторов', sortable: true, numeric: true },
    { key: 'status', label: 'Статус', sortable: true },
    { key: 'created', label: 'Дата создания', sortable: true },
    { key: 'updated', label: 'Обновлено', sortable: true },
    { key: 'actions', label: 'Действия', actions: true },
  ];

  const rows = pageRows.map(g => ({
    id: g.id,
    cells: [
      `<b>${esc(g.name || '—')}</b>`,
      String(g.operator_count || 0),
      groupsStatusBadge(g.status),
      `<span class="nowrap">${esc(groupsWhen(g.created_at))}</span>`,
      `<span class="nowrap">${esc(groupsWhen(g.updated_at))}</span>`,
      groupsRowActions(g),
    ],
  }));

  const empty = hasFilters
    ? uiNoResultsState('Ничего не найдено', 'Измените запрос или сбросьте фильтры.',
      [{ id: 'reset', label: 'Сбросить фильтры' }], true)
    : uiEmptyState('Группы не созданы', 'Создайте первую группу — в неё можно будет переводить операторов.',
      [{ id: 'create', label: 'Создать группу' }], true);

  el.innerHTML = `
    <header class="ui-page-header">
      <div class="ui-page-header__copy">
        <span class="ui-page-header__eyebrow">Группы</span>
        <h1 tabindex="-1">Управление группами</h1>
        <p>Организация и контроль команд операторов</p>
      </div>
      <div class="ui-page-header__actions">
        <button class="ui-icon-button" type="button" data-groups-refresh
                aria-label="Обновить список групп" title="Обновить список групп">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>
          </svg>
        </button>
        <button class="btn-primary" type="button" data-groups-create>Добавить группу</button>
      </div>
    </header>

    <div class="ui-kpi-grid">
      ${uiKpi({ label: 'Всего групп', value: all.length })}
      ${uiKpi({ label: 'Активных', value: activeCount, tone: 'ok' })}
      ${uiKpi({ label: 'Операторов в группах', value: operatorsTotal })}
      ${uiKpi({ label: 'Отключённых', value: inactiveCount, tone: inactiveCount ? 'warn' : 'neutral' })}
    </div>

    ${uiCard({
      flush: true,
      body: `
        <div class="ui-toolbar">
          <label class="ui-toolbar-search">
            <span class="sr-only">Поиск по названию группы</span>
            <input class="form-input" type="search" autocomplete="off" data-groups-search
                   placeholder="Поиск по названию…" value="${esc(s.search)}">
          </label>
          <label class="ui-filter-field">
            <span>Статус</span>
            <select class="form-select" data-groups-status>
              <option value="">Все статусы</option>
              <option value="active" ${s.status === 'active' ? 'selected' : ''}>Активные</option>
              <option value="inactive" ${s.status === 'inactive' ? 'selected' : ''}>Отключённые</option>
            </select>
          </label>
          <span class="ui-toolbar-count" aria-live="polite">Показано: <b>${total}</b> из ${all.length}</span>
          ${hasFilters ? '<button class="btn-link" type="button" data-groups-reset>Сбросить</button>' : ''}
        </div>
        ${uiTable({ columns, rows, sort: s.sort, caption: 'Группы операторов', empty })}
        ${total > 0 ? uiPagination({
          page: s.paging.page, perPage, total, label: 'групп',
        }) : ''}`,
    })}`;

  bindGroupsPage(el);
}

function bindGroupsPage(el) {
  const rerender = () => renderGroups();
  const s = groupsState();

  uiBindTable(el, s.sort, rerender);
  uiBindPagination(el, s.paging, rerender);
  uiBindStateActions(el, {
    create: () => showAddGroupModal(),
    reset: () => { s.search = ''; s.status = ''; s.paging.page = 1; rerender(); },
    retry: () => reloadGroupsList(),
  });

  // Поиск ждёт паузу в наборе: перерисовывать таблицу на каждый символ незачем.
  const search = el.querySelector('[data-groups-search]');
  if (search) {
    let timer = null;
    search.addEventListener('input', event => {
      s.search = event.target.value;
      s.paging.page = 1;
      clearTimeout(timer);
      timer = setTimeout(() => {
        rerender();
        const field = el.querySelector('[data-groups-search]');
        field?.focus();
        field?.setSelectionRange(field.value.length, field.value.length);
      }, 250);
    });
  }

  el.querySelector('[data-groups-status]')?.addEventListener('change', event => {
    s.status = event.target.value;
    s.paging.page = 1;
    rerender();
    el.querySelector('[data-groups-status]')?.focus();
  });

  el.querySelector('[data-groups-reset]')?.addEventListener('click', () => {
    s.search = ''; s.status = ''; s.paging.page = 1;
    rerender();
  });

  el.querySelector('[data-groups-create]')?.addEventListener('click', () => showAddGroupModal());
  el.querySelector('[data-groups-refresh]')?.addEventListener('click', () => reloadGroupsList());

  el.querySelectorAll('[data-group-edit]').forEach(btn => btn.addEventListener('click',
    () => showEditGroupModal(Number(btn.dataset.groupEdit))));
  el.querySelectorAll('[data-group-toggle]').forEach(btn => btn.addEventListener('click',
    () => toggleGroupStatus(Number(btn.dataset.groupToggle), btn.dataset.groupNext)));
  el.querySelectorAll('[data-group-delete]').forEach(btn => btn.addEventListener('click',
    () => confirmDeleteGroup(Number(btn.dataset.groupDelete))));
}

let _groupsReloading = false;

/**
 * Перезагрузка списка. Ошибку запоминаем, чтобы экран показал её вместо
 * «групп нет»: пустой список и упавший запрос — разные состояния.
 *
 * keepContent — фоновое обновление: данные на экране остаются, крутится
 * только кнопка. ТЗ требует не очищать экран при refreshing.
 */
async function reloadGroupsList({ keepContent = false } = {}) {
  if (_groupsReloading) return;
  _groupsReloading = true;
  const el = document.getElementById('view-groups');
  el?.querySelector('[data-groups-refresh]')?.classList.add('is-loading');
  try {
    STATE.groups = await swrFetch('groups:list', () => api.listGroups(false), null, SWR_STATIC_TTL_MS);
    STATE.groupsError = null;
  } catch (error) {
    STATE.groupsError = error;
    if (!keepContent) STATE.groups = STATE.groups || [];
  } finally {
    _groupsReloading = false;
  }
  if (STATE.currentView === 'groups') renderGroups();
}
