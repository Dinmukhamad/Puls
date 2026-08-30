/**
 * Требования раздела 4 ТЗ к оболочке приложения.
 *
 * Что было не так:
 *  · свёрнутая навигация занимала 64px при требуемых 72–80;
 *  · кнопка «Выйти» красилась инлайном в rgba(255,255,255,.3) — это 2.73:1
 *    на тёмной навигации, и ещё два правила «подстраивали её под тему»,
 *    накладывая цвет светлой темы на тёмный фон (3.61:1);
 *  · выдвижная панель на телефоне не закрывалась по Escape, и фокус в неё
 *    не уходил: с клавиатуры она была недостижима, Tab обходил страницу
 *    под затемнением.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const tokens = await readFile(new URL('css/tokens.css', root), 'utf8');
const shell = await readFile(new URL('js/src/app/00-core-shell.js', root), 'utf8');
const html = await readFile(new URL('index.html', root), 'utf8');
const layout = await readFile(new URL('css/src/base/00-base-layout.css', root), 'utf8');
const dash = await readFile(new URL('css/src/views/20-rating-shop-dashboard.css', root), 'utf8');

test('ширины навигации заданы токенами и попадают в диапазон ТЗ', () => {
  const open = tokens.match(/--nav-w:\s*(\d+)px/);
  const collapsed = tokens.match(/--nav-w-collapsed:\s*(\d+)px/);
  assert.ok(open && collapsed, 'ширины навигации не объявлены токенами');
  const w = Number(open[1]);
  const c = Number(collapsed[1]);
  assert.ok(w >= 248 && w <= 260, `раскрытая навигация ${w}px вне 248–260`);
  assert.ok(c >= 72 && c <= 80, `свёрнутая навигация ${c}px вне 72–80`);
});

test('ширина свёрнутой навигации нигде не записана числом', () => {
  const bad = [];
  for (const [name, css] of [['00-base-layout.css', layout]]) {
    for (const m of css.matchAll(/([^{}]*side-nav[^{}]*)\{([^}]*)\}/g)) {
      const hit = m[2].match(/width:\s*64px/);
      if (hit) bad.push(`${name}: ${m[1].trim().slice(0, 50)} — ${hit[0]}`);
    }
  }
  assert.deepEqual(bad, [], `ширина мимо токена:\n  ${bad.join('\n  ')}`);
});

test('кнопка выхода не красится инлайном и не подстраивается под светлую тему', () => {
  const btn = html.match(/<button[^>]*id="auth-logout-btn"[^>]*>/);
  assert.ok(btn, 'кнопка выхода не найдена');
  assert.doesNotMatch(btn[0], /style=/, 'цвет снова задан инлайном');
  assert.match(btn[0], /class="side-logout-btn"/, 'кнопка без своего класса');
  assert.match(btn[0], /title=/, 'у кнопки нет подсказки');
  // Навигация тёмная в обеих темах: правил «под тему» для неё быть не должно.
  assert.doesNotMatch(dash, /html\[data-theme="(light|dark)"\]\s*#auth-logout-btn/,
    'вернулось правило цвета выхода под конкретную тему');
  assert.match(layout, /\.side-logout-btn\s*\{[\s\S]*?color:\s*var\(--sidebar-text\)/,
    'цвет выхода не из токена навигации');
  assert.match(layout, /\.side-logout-btn:hover[\s\S]*?var\(--sidebar-danger\)/,
    'наведение не отмечает опасность действия');
});

test('выдвижная панель управляется с клавиатуры', () => {
  const nav = shell.match(/function initNav\(\)[\s\S]*?\n\}/)[0];
  assert.match(nav, /event\.key !== 'Escape'/, 'Escape не закрывает панель');
  assert.match(nav, /sideNav\.querySelector\('\.side-nav-link'\)\?\.focus/,
    'фокус не уходит внутрь открытой панели');
  assert.match(nav, /mobileToggle\.focus/, 'фокус не возвращается на кнопку');
  assert.match(nav, /event\.key !== 'Tab'/, 'Tab выпускает фокус из панели');
  assert.match(nav, /aria-expanded/, 'состояние панели не объявляется');
  assert.match(nav, /mobile-nav-backdrop/, 'нет затемнения фона');
});

test('у каждой ссылки навигации есть подсказка для свёрнутого состояния', () => {
  const links = [...html.matchAll(/<a class="side-nav-link"[^>]*>/g)].map(m => m[0]);
  assert.ok(links.length >= 14, `ссылок навигации ${links.length}, ожидалось не меньше 14`);
  const noTitle = links.filter(l => !/title="/.test(l));
  assert.deepEqual(noTitle, [], `ссылки без подсказки:\n  ${noTitle.join('\n  ')}`);
});

test('кнопки-иконки навигации подписаны и имеют подсказку', () => {
  for (const id of ['side-bell-btn', 'theme-toggle']) {
    const m = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
    assert.ok(m, `кнопка ${id} не найдена`);
    assert.match(m[0], /aria-label=/, `${id} без aria-label`);
    assert.match(m[0], /title=/, `${id} без подсказки`);
  }
});
