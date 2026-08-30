/**
 * Требования разделов 6.1, 6.8 и 9 ТЗ.
 *
 * Что было не так:
 *  · на экране входа не было показа пароля, кнопка оставалась активной на
 *    пустой форме, ошибка не объявлялась скринридером, а на телефоне
 *    скрывался весь фирменный блок — вместе с логотипом и слоганом;
 *  · зона загрузки знала только состояние «файл выбран»: не было
 *    перетаскивания, размера файла, удаления выбранного и отдельных
 *    сообщений о неверном формате и слишком большом файле;
 *  · prefers-reduced-motion гасил переходы, но не анимации — пульсации и
 *    мерцание каркасов продолжались.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const shell = await readFile(new URL('js/src/app/00-core-shell.js', root), 'utf8');
const layout = await readFile(new URL('css/src/base/00-base-layout.css', root), 'utf8');
const report = await readFile(new URL('js/src/views/reports/40-period-report.view.js', root), 'utf8');
const reportCss = await readFile(new URL('css/src/views/30-period-report.css', root), 'utf8');
const states = await readFile(new URL('css/src/components/20-states.css', root), 'utf8');

test('вход: пароль можно показать, ошибка объявляется, кнопка ждёт заполнения', () => {
  const toggle = html.match(/<button[^>]*id="auth-password-toggle"[^>]*>/);
  assert.ok(toggle, 'нет кнопки показа пароля');
  assert.match(toggle[0], /aria-pressed="false"/, 'состояние кнопки не объявлено');
  assert.match(toggle[0], /aria-label=/, 'кнопка без подписи');

  const err = html.match(/<div[^>]*id="auth-error"[^>]*>/);
  assert.match(err[0], /role="alert"/, 'ошибка входа не в живой области');

  const btn = html.match(/<button[^>]*id="auth-login-btn"[^>]*>/);
  assert.match(btn[0], /\bdisabled\b/, 'кнопка активна на пустой форме');
  assert.doesNotMatch(btn[0], /style=/, 'размеры кнопки заданы инлайном');

  assert.match(shell, /function syncAuthSubmit\(\)/, 'нет пересчёта доступности кнопки');
  assert.match(shell, /auth-password-toggle/, 'показ пароля не привязан');
  assert.match(shell, /classList\.add\('is-loading'\)/, 'у входа нет состояния загрузки');
});

test('вход на телефоне сохраняет логотип и слоган', () => {
  // Раньше .auth-visual скрывался целиком.
  const mobile = layout.match(/@media[^{]*max-width: 760px\)[\s\S]*?\n\}/);
  const block = mobile ? mobile[0] : layout;
  assert.doesNotMatch(block, /\.auth-visual \{\s*display: none/, 'фирменный блок снова скрыт целиком');
  assert.match(layout, /\.auth-pulse,\s*\n\s*\.auth-decorlines/, 'декоративные части не отделены от бренда');
});

test('зона загрузки знает все состояния из ТЗ', () => {
  const fn = report.match(/function bindFileDrop[\s\S]*?\n  \}/)[0];
  for (const [needle, what] of [
    ["'dragenter', 'dragover'", 'перетаскивание'],
    ["addEventListener('drop'", 'приём файла'],
    ['humanSize(file.size)', 'размер файла'],
    ['pr-file-remove', 'удаление выбранного'],
    ["нужен файл .xlsx", 'сообщение о формате'],
    ['MAX_FILE_BYTES', 'предел размера'],
  ]) {
    assert.ok(fn.includes(needle), `нет состояния: ${what}`);
  }
  // Предел на клиенте не должен быть строже серверного.
  assert.match(report, /MAX_FILE_BYTES = 60 \* 1024 \* 1024/, 'изменён клиентский предел размера');
  for (const cls of ['pr-file-drop-over', 'pr-file-drop-error', 'pr-file-remove']) {
    assert.ok(reportCss.includes(`.${cls}`), `нет стиля состояния .${cls}`);
  }
});

test('меньше движения останавливает и анимации, а не только переходы', () => {
  // В файле есть и более узкое правило, поэтому берём последний блок.
  const at = states.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.notEqual(at, -1, 'нет глобального правила');
  const block = states.slice(at);
  assert.ok(block.includes('animation-iteration-count: 1 !important'),
    'повторяющиеся анимации не останавливаются');
  assert.ok(block.includes('animation-duration: 0.01ms !important'),
    'длительность анимаций не гасится');
  assert.ok(block.includes('.skeleton { background: var(--bg-muted); }'),
    'каркас без мерцания остаётся невидимым');
});
