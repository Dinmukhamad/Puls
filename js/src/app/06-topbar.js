/* ══════════════════════════════════════════════════════════════
   ВЕРХНЯЯ ПАНЕЛЬ — поиск, уведомления, меню профиля

   ТЗ (App shell, стр. 6) требует top utility bar. Отдельно оговорено:
   «Если поиск не реализован, поле нельзя оставлять декоративным;
   минимум — навигация по доступным маршрутам и поиск пользователей
   через /api/users… для разрешённых ролей.»

   Поэтому поиск делает ровно две вещи, и обе настоящие:
     · переключает разделы из ROUTES, отфильтрованные правами роли;
     · ищет людей через api.listUsers — тем же endpoint, что и экран
       «Пользователи», поэтому область видимости считает backend.
   Выбор человека ведёт на #operators и подставляет его в фильтр поиска,
   то есть строка действительно оказывается на экране, а не «где-то там».

   Параметр запроса — search, а не q: у /api/users он называется так.
   ТЗ ставит контракт backend выше собственного текста (стр. 3).
══════════════════════════════════════════════════════════════ */

const TOPBAR_SEARCH_DEBOUNCE_MS = 250;
const TOPBAR_MAX_ROUTES = 6;
const TOPBAR_MAX_USERS = 6;

let _topbarBound = false;
let _topbarSearchTimer = null;
let _topbarItems = [];
let _topbarActiveIndex = -1;
let _topbarSeq = 0;

function topbarInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map(word => word[0]).join('').toUpperCase() || '?';
}

/** Разделы, доступные текущей роли, — источник тот же, что у навигации. */
function topbarRouteMatches(query) {
  const role = STATE.user?.role;
  const allowed = typeof allowedViewsForRole === 'function' ? allowedViewsForRole(role) : [];
  const needle = query.trim().toLowerCase();
  const out = [];
  for (const view of allowed) {
    const title = ROUTES[view]?.title;
    if (!title) continue;
    if (needle && !title.toLowerCase().includes(needle)) continue;
    out.push({ kind: 'route', view, title });
    if (out.length >= TOPBAR_MAX_ROUTES) break;
  }
  return out;
}

function topbarRenderResults(routes, users, { query, usersState }) {
  const host = document.getElementById('global-search-results');
  const input = document.getElementById('global-search');
  if (!host || !input) return;

  _topbarItems = [...routes, ...users];
  _topbarActiveIndex = -1;

  const parts = [];
  if (routes.length) {
    parts.push('<div class="topbar-results-group">Разделы</div>');
    routes.forEach((item, i) => {
      parts.push(`<button type="button" class="topbar-result" role="option" aria-selected="false"
        id="topbar-opt-${i}" data-topbar-index="${i}">
        <span class="topbar-result-mark" aria-hidden="true">→</span>
        <span><b>${esc(item.title)}</b></span></button>`);
    });
  }
  if (usersState === 'loading') {
    parts.push('<div class="topbar-results-group">Пользователи</div>');
    parts.push(`<div class="topbar-results-empty" role="status">Ищем людей…</div>`);
  } else if (usersState === 'error') {
    parts.push('<div class="topbar-results-group">Пользователи</div>');
    parts.push('<div class="topbar-results-empty" role="status">Поиск людей недоступен</div>');
  } else if (users.length) {
    parts.push('<div class="topbar-results-group">Пользователи</div>');
    users.forEach((item, i) => {
      const index = routes.length + i;
      const meta = [item.username, roleLabel(item.role)].filter(Boolean).join(' · ');
      parts.push(`<button type="button" class="topbar-result" role="option" aria-selected="false"
        id="topbar-opt-${index}" data-topbar-index="${index}">
        <span class="topbar-result-mark" aria-hidden="true">${esc(topbarInitials(item.title))}</span>
        <span><b>${esc(item.title)}</b><small>${esc(meta)}</small></span></button>`);
    });
  }

  if (!parts.length) {
    parts.push(`<div class="topbar-results-empty" role="status">Ничего не найдено${
      query.trim() ? ` по запросу «${esc(query.trim())}»` : ''}</div>`);
  }

  host.innerHTML = parts.join('');
  host.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  input.removeAttribute('aria-activedescendant');
}

function topbarCloseResults() {
  const host = document.getElementById('global-search-results');
  const input = document.getElementById('global-search');
  if (host) { host.hidden = true; host.innerHTML = ''; }
  if (input) {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  _topbarItems = [];
  _topbarActiveIndex = -1;
}

function topbarHighlight(index) {
  const host = document.getElementById('global-search-results');
  const input = document.getElementById('global-search');
  if (!host) return;
  const options = [...host.querySelectorAll('.topbar-result')];
  if (!options.length) return;
  const next = (index + options.length) % options.length;
  options.forEach(option => {
    option.classList.remove('is-active');
    option.setAttribute('aria-selected', 'false');
  });
  const active = options[next];
  active.classList.add('is-active');
  active.setAttribute('aria-selected', 'true');
  active.scrollIntoView({ block: 'nearest' });
  input?.setAttribute('aria-activedescendant', active.id);
  _topbarActiveIndex = Number(active.dataset.topbarIndex);
}

function topbarPick(index) {
  const item = _topbarItems[index];
  if (!item) return;
  const input = document.getElementById('global-search');
  topbarCloseResults();
  if (input) input.value = '';
  if (item.kind === 'route') {
    navigateTo(item.view);
    return;
  }
  // Человек: открываем «Пользователей» и подставляем его в поиск экрана,
  // иначе переход показывал бы просто список без найденной строки.
  STATE.usersFilters = Object.assign(STATE.usersFilters || {}, { search: item.title });
  navigateTo('operators');
}

async function topbarSearch(query) {
  const routes = topbarRouteMatches(query);
  const needle = query.trim();
  const role = STATE.user?.role;
  const canSearchUsers = typeof isAdmin === 'function' && isAdmin(role);

  // Пустая строка и слишком короткий запрос людей не запрашивают: это лишняя
  // нагрузка и мусорные результаты.
  if (!canSearchUsers || needle.length < 2) {
    topbarRenderResults(routes, [], { query, usersState: 'idle' });
    return;
  }

  topbarRenderResults(routes, [], { query, usersState: 'loading' });
  const seq = ++_topbarSeq;
  try {
    const data = await api.listUsers({ search: needle, limit: TOPBAR_MAX_USERS });
    if (seq !== _topbarSeq) return; // пришёл ответ на устаревший запрос
    const users = (data?.items || data || []).slice(0, TOPBAR_MAX_USERS).map(user => ({
      kind: 'user',
      id: user.id,
      title: user.full_name || user.username || '—',
      username: user.username || '',
      role: user.role || '',
    }));
    topbarRenderResults(routes, users, { query, usersState: 'ready' });
  } catch {
    if (seq !== _topbarSeq) return;
    topbarRenderResults(routes, [], { query, usersState: 'error' });
  }
}

function topbarCloseMenu({ returnFocus = false } = {}) {
  const menu = document.getElementById('topbar-menu');
  const trigger = document.getElementById('topbar-avatar');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  if (returnFocus) trigger?.focus({ preventScroll: true });
}

function topbarOpenMenu() {
  const menu = document.getElementById('topbar-menu');
  const trigger = document.getElementById('topbar-avatar');
  if (!menu) return;
  menu.hidden = false;
  trigger?.setAttribute('aria-expanded', 'true');
  menu.querySelector('.topbar-menu-item')?.focus({ preventScroll: true });
}

function topbarBind() {
  if (_topbarBound) return;
  _topbarBound = true;

  const input = document.getElementById('global-search');
  const results = document.getElementById('global-search-results');

  input?.addEventListener('input', () => {
    clearTimeout(_topbarSearchTimer);
    const value = input.value;
    _topbarSearchTimer = setTimeout(() => topbarSearch(value), TOPBAR_SEARCH_DEBOUNCE_MS);
  });
  input?.addEventListener('focus', () => {
    // На фокусе показываем доступные разделы: панель сразу полезна.
    if (!results || results.hidden) topbarSearch(input.value);
  });
  input?.addEventListener('keydown', event => {
    if (event.key === 'Escape') { topbarCloseResults(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); topbarHighlight(_topbarActiveIndex + 1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); topbarHighlight(_topbarActiveIndex - 1); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      topbarPick(_topbarActiveIndex >= 0 ? _topbarActiveIndex : 0);
    }
  });

  results?.addEventListener('mousedown', event => {
    // mousedown, а не click: иначе blur успевает закрыть список до выбора.
    const option = event.target.closest('.topbar-result');
    if (!option) return;
    event.preventDefault();
    topbarPick(Number(option.dataset.topbarIndex));
  });

  document.getElementById('topbar-bell')?.addEventListener('click', () => showNotificationsModal());

  const trigger = document.getElementById('topbar-avatar');
  trigger?.addEventListener('click', () => {
    const menu = document.getElementById('topbar-menu');
    if (menu?.hidden) topbarOpenMenu(); else topbarCloseMenu({ returnFocus: true });
  });

  document.getElementById('topbar-menu')?.addEventListener('click', event => {
    const action = event.target.closest('[data-topbar-action]')?.dataset.topbarAction;
    if (!action) return;
    topbarCloseMenu({ returnFocus: true });
    if (action === 'account') showAccountSettingsModal();
    if (action === 'theme') document.getElementById('theme-toggle')?.click();
    if (action === 'logout') logoutAndReload();
  });

  // Клик вне панели закрывает и список, и меню.
  document.addEventListener('click', event => {
    if (!event.target.closest('.topbar-search')) topbarCloseResults();
    if (!event.target.closest('.topbar-profile')) topbarCloseMenu();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') topbarCloseMenu({ returnFocus: true });
    // Ctrl/Cmd+K — общий приём для поиска по приложению.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      const field = document.getElementById('global-search');
      if (!field || document.getElementById('topbar')?.hidden) return;
      event.preventDefault();
      field.focus();
      field.select();
    }
  });
}

/** Вызывается из bootApp: панель появляется только для вошедшего пользователя. */
function initTopbar() {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  const name = STATE.user?.full_name || STATE.user?.username || '';
  const role = roleLabel(STATE.user?.role);
  setText('topbar-initials', topbarInitials(name));
  setText('topbar-menu-name', name || '—');
  setText('topbar-menu-role', role || '');
  document.getElementById('topbar-avatar')?.setAttribute(
    'aria-label', name ? `Меню профиля: ${name}` : 'Меню профиля',
  );
  bar.hidden = false;
  topbarBind();
}

function hideTopbar() {
  topbarCloseResults();
  topbarCloseMenu();
  const bar = document.getElementById('topbar');
  if (bar) bar.hidden = true;
  // На экране входа обходить нечего: боковой панели нет, а ссылка увела бы
  // фокус в пустой main.
  const skip = document.getElementById('skip-to-content');
  if (skip) skip.hidden = true;
}

/**
 * Обход навигации (WCAG 2.4.1 Bypass Blocks). Это кнопка, а не ссылка:
 * маршруты приложения живут в хеше, и href="#main-content" увёл бы роутер
 * на несуществующий раздел, если бы обработчик не успел привязаться.
 * Фокус ставим на заголовок открытого экрана, а если его ещё нет — на main.
 */
function initSkipLink() {
  const skip = document.getElementById('skip-to-content');
  if (!skip || initSkipLink._bound) return;
  initSkipLink._bound = true;
  skip.hidden = false;
  skip.addEventListener('click', () => {
    const target = document.querySelector('.app-view.active h1')
      || document.getElementById('main-content');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
    target.scrollIntoView({ block: 'start' });
  });
}
