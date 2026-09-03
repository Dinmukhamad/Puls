/**
 * Верхняя панель приложения (ТЗ «App shell», стр. 6).
 *
 * Панели не было вовсе: колокол и настройки жили только в подвале
 * навигации, поиска по приложению не существовало. ТЗ отдельно
 * оговаривает: «Если поиск не реализован, поле нельзя оставлять
 * декоративным; минимум — навигация по доступным маршрутам и поиск
 * пользователей через /api/users… для разрешённых ролей».
 *
 * Поэтому тест проверяет не наличие поля, а что оно действительно
 * ходит в API и берёт разделы из прав роли.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const topbar = await readFile(new URL('js/src/app/06-topbar.js', root), 'utf8');
const shell = await readFile(new URL('js/src/app/00-core-shell.js', root), 'utf8');
const notif = await readFile(new URL('js/src/app/05-notifications.js', root), 'utf8');
const css = await readFile(new URL('css/src/components/70-topbar.css', root), 'utf8');

test('панель размечена: поиск, колокол, меню профиля', () => {
  assert.match(html, /<div class="topbar" id="topbar" hidden>/, 'нет панели или она не скрыта по умолчанию');
  const input = html.match(/<input id="global-search"[^>]*>/);
  assert.ok(input, 'нет поля поиска');
  assert.match(input[0], /role="combobox"/, 'поле не объявлено как combobox');
  assert.match(input[0], /aria-expanded="false"/, 'нет состояния раскрытия');
  assert.match(input[0], /aria-controls="global-search-results"/, 'поле не связано со списком');
  assert.match(input[0], /aria-autocomplete="list"/, 'не объявлено автодополнение');
  assert.match(html, /id="global-search-results"[^>]*role="listbox"/, 'список не listbox');
  assert.ok(html.includes('<label class="sr-only" for="global-search">'), 'поле без подписи');

  for (const id of ['topbar-bell', 'topbar-avatar']) {
    const btn = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
    assert.ok(btn, `нет кнопки ${id}`);
    assert.match(btn[0], /aria-label=/, `${id} без подписи`);
    assert.match(btn[0], /title=/, `${id} без подсказки`);
  }
  const avatar = html.match(/<button[^>]*id="topbar-avatar"[^>]*>/)[0];
  assert.match(avatar, /aria-haspopup="menu"/, 'меню профиля не объявлено');
  assert.match(avatar, /aria-controls="topbar-menu"/, 'кнопка не связана с меню');
  assert.match(html, /id="topbar-menu"[^>]*role="menu"/, 'меню без роли');
});

test('поиск не декоративный: ходит в реальный API', () => {
  assert.match(topbar, /api\.listUsers\(\{ search: needle/, 'поиск людей не обращается к API');
  // Параметр именно search: у /api/users он так называется, а ТЗ ставит
  // контракт backend выше собственного текста.
  assert.doesNotMatch(topbar, /listUsers\(\{ q:/, 'используется параметр q, которого у endpoint нет');
  assert.match(topbar, /needle\.length < 2/, 'запрос уходит на слишком короткую строку');
  assert.match(topbar, /seq !== _topbarSeq/, 'ответ устаревшего запроса не отбрасывается');
  assert.match(topbar, /usersState: 'error'/, 'ошибка поиска людей не показывается');
});

test('разделы берутся из прав роли, а не из списка в коде', () => {
  const fn = topbar.match(/function topbarRouteMatches[\s\S]*?\n\}/)[0];
  assert.match(fn, /allowedViewsForRole\(role\)/, 'разделы не сверяются с правами роли');
  assert.match(fn, /ROUTES\[view\]\?\.title/, 'названия разделов не из реестра маршрутов');
  assert.doesNotMatch(fn, /\['summary'|"summary"/, 'список разделов зашит в код');
});

test('выбор человека действительно показывает его на экране', () => {
  const fn = topbar.match(/function topbarPick[\s\S]*?\n\}/)[0];
  assert.match(fn, /STATE\.usersFilters/, 'найденный человек не попадает в фильтр экрана');
  assert.match(fn, /navigateTo\('operators'\)/, 'переход не на экран пользователей');
});

test('панель управляется клавиатурой', () => {
  assert.match(topbar, /event\.key === 'ArrowDown'/, 'нет перехода по списку вниз');
  assert.match(topbar, /event\.key === 'ArrowUp'/, 'нет перехода по списку вверх');
  assert.match(topbar, /aria-activedescendant/, 'активный вариант не объявляется');
  assert.match(topbar, /event\.key\.toLowerCase\(\) === 'k'/, 'нет быстрого доступа к поиску');
  assert.match(topbar, /returnFocus/, 'фокус не возвращается после закрытия меню');
});

test('панель принадлежит вошедшему пользователю', () => {
  assert.match(shell, /initTopbar\(\);/, 'панель не инициализируется при входе');
  const authFn = shell.match(/function showAuth\(\)[\s\S]*?\n\}/)[0];
  assert.match(authFn, /hideTopbar\(\)/, 'панель остаётся на экране входа');
});

test('счётчик уведомлений один для колокола в навигации и в панели', () => {
  const fn = notif.match(/async function refreshNotificationBadge[\s\S]*?\n\}/)[0];
  assert.match(fn, /'side-bell-badge', 'topbar-bell-badge'/, 'счётчик обновляется только в одном месте');
  assert.match(fn, /getUnreadNotificationCount/, 'счётчик не из API');
});

test('на телефоне панель переносится и цели нажатия увеличены', () => {
  const mobile = css.slice(css.lastIndexOf('@media (max-width: 640px)'));
  assert.match(mobile, /flex-wrap: wrap/, 'панель не переносится');
  assert.match(mobile, /min-height: var\(--control-h-lg\)/, 'цели нажатия не увеличены');
});
