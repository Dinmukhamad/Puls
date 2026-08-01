/* ══════════════════════════════════════════════════════════════════════════
   APP SHELL — топбар и мобильный таб-бар
   --------------------------------------------------------------------------
   Права доступа здесь не дублируются: список разделов всегда приходит из
   allowedViewsForRole() в 00-core-shell.js, а разметка пунктов клонируется
   из уже отрендеренного сайдбара. Добавили раздел в сайдбар — он появится
   и в таб-баре без правок этого файла.
══════════════════════════════════════════════════════════════════════════ */

/* Первые разделы таб-бара по роли. Всё, что не поместилось, доступно
   через «Ещё» — полный список открывается шторкой (тот же .side-nav). */
const TABBAR_PRIORITY = {
  operator: ['cabinet', 'rating', 'missions', 'shop'],
  admin: ['summary', 'analytics', 'operators', 'coins'],
};
const TABBAR_MAX_PRIMARY = 4;

/* Понятные заголовки страниц для топбара. Если раздела нет в словаре,
   берём подпись из соответствующей ссылки сайдбара. */
const VIEW_TITLES = {
  summary: 'Сводка',
  analytics: 'Аналитика',
  operators: 'Операторы',
  groups: 'Группы',
  coins: 'Коины',
  shop: 'Магазин',
  rating: 'Рейтинг',
  cabinet: 'Кабинет',
  missions: 'Миссии',
  tests: 'Тесты',
  wheel: 'Колесо',
  'operator-levels': 'Уровни',
  'period-report': 'Импорт данных',
  sessions: 'Сессии',
};

function shellNavLink(view) {
  return document.querySelector(`.side-nav-link[data-nav-target="${view}"]`);
}

function shellViewTitle(view) {
  if (VIEW_TITLES[view]) return VIEW_TITLES[view];
  const label = shellNavLink(view)?.querySelector('span')?.textContent?.trim();
  return label || 'Puls';
}

/* Заголовок топбара. Вызывается из navigateTo() после смены раздела. */
function syncTopbarTitle(view) {
  const title = document.getElementById('app-topbar-title');
  if (title) title.textContent = shellViewTitle(view);
  document.title = view ? `${shellViewTitle(view)} — Puls` : 'Puls';
}

/* Активный пункт таб-бара. Вызывается из navigateTo(). */
function syncTabbarActive(view) {
  document.querySelectorAll('.app-tabbar__item[data-nav-target]').forEach(item => {
    item.classList.toggle('active', item.dataset.navTarget === view);
  });
  const more = document.getElementById('app-tabbar-more');
  if (more) {
    const primary = [...document.querySelectorAll('.app-tabbar__item[data-nav-target]')]
      .some(item => item.dataset.navTarget === view);
    more.classList.toggle('active', !primary);
  }
}

/* Сборка таб-бара под роль. Вызывается из renderSidebar(). */
function buildTabbar(role) {
  const bar = document.getElementById('app-tabbar');
  if (!bar || typeof allowedViewsForRole !== 'function') return;

  const allowed = allowedViewsForRole(role);
  const isAdminRole = typeof isAdmin === 'function' && isAdmin(role);
  const priority = TABBAR_PRIORITY[isAdminRole ? 'admin' : 'operator'] || [];

  // Приоритетные разделы, затем остальные разрешённые — до лимита.
  const primary = [
    ...priority.filter(v => allowed.includes(v)),
    ...allowed.filter(v => !priority.includes(v)),
  ].slice(0, TABBAR_MAX_PRIMARY);

  bar.textContent = '';
  for (const view of primary) {
    const source = shellNavLink(view);
    if (!source) continue;
    const item = document.createElement('a');
    item.className = 'app-tabbar__item';
    item.href = '#';
    item.dataset.navTarget = view;
    const icon = source.querySelector('svg');
    if (icon) item.appendChild(icon.cloneNode(true));
    const label = document.createElement('span');
    label.textContent = shellViewTitle(view);
    item.appendChild(label);
    bar.appendChild(item);
  }

  // «Ещё» открывает ту же шторку, что и бургер в топбаре — отдельной
  // копии списка разделов не существует.
  if (allowed.length > primary.length) {
    const more = document.createElement('button');
    more.type = 'button';
    more.id = 'app-tabbar-more';
    more.className = 'app-tabbar__item';
    more.setAttribute('aria-controls', 'primary-navigation');
    more.setAttribute('aria-expanded', 'false');
    more.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">'
      + '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'
      + '</svg><span>Ещё</span>';
    more.addEventListener('click', () => setShellNav(!document.body.classList.contains('mobile-nav-open')));
    bar.appendChild(more);
  }

  syncTabbarActive(STATE?.currentView || '');
}

/* Единственная точка открытия/закрытия шторки навигации: ею пользуются
   бургер в топбаре, кнопка «Ещё», подложка и Escape. */
function setShellNav(open) {
  document.body.classList.toggle('mobile-nav-open', open);
  const menu = document.getElementById('app-topbar-menu');
  if (menu) {
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Закрыть навигацию' : 'Открыть навигацию');
  }
  document.getElementById('app-tabbar-more')?.setAttribute('aria-expanded', String(open));
}

function initAppShell() {
  const sideNav = document.querySelector('.side-nav');
  if (sideNav && !sideNav.id) sideNav.id = 'primary-navigation';

  document.getElementById('app-topbar-menu')
    ?.addEventListener('click', () => setShellNav(!document.body.classList.contains('mobile-nav-open')));

  if (!document.querySelector('.mobile-nav-backdrop')) {
    const backdrop = document.createElement('button');
    backdrop.className = 'mobile-nav-backdrop';
    backdrop.type = 'button';
    backdrop.setAttribute('aria-label', 'Закрыть навигацию');
    backdrop.addEventListener('click', () => setShellNav(false));
    document.body.appendChild(backdrop);
  }

  // Escape закрывает шторку и возвращает фокус на кнопку, которая её открыла.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !document.body.classList.contains('mobile-nav-open')) return;
    setShellNav(false);
    document.getElementById('app-topbar-menu')?.focus();
  });
}
