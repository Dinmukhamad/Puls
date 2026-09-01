/**
 * Требования разделов 5, 7 и 8 ТЗ к модальным окнам, уведомлениям и
 * целям нажатия.
 *
 * Что было не так:
 *  · updateModal пересобирал кнопку закрытия без aria-label, терял связь
 *    заголовка с окном и не переводил фокус — после подмены содержимого
 *    окно переставало быть доступным;
 *  · окно правила в «Колесе» — отдельная реализация: не закрывалось по
 *    Escape, не блокировало прокрутку фона и выпускало фокус;
 *  · у длинных форм не было липкого подвала: до кнопки сохранения
 *    приходилось прокручивать всё окно;
 *  · toast был плашкой сплошного цвета с белым текстом — 2.62:1 на зелёном
 *    и 3.76:1 на красном, без живой области и с white-space: nowrap;
 *  · вкладки и чипы на телефоне были 32px при требуемых 44.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const coins = await readFile(new URL('js/src/views/coins/30-admin-coins-groups-operators.view.js', root), 'utf8');
const wheel = await readFile(new URL('js/src/views/wheel/60-wheel-tests.view.js', root), 'utf8');
const modalCss = await readFile(new URL('css/src/components/50-modal.css', root), 'utf8');
const controls = await readFile(new URL('css/src/components/30-controls.css', root), 'utf8');
const layout = await readFile(new URL('css/src/base/00-base-layout.css', root), 'utf8');

test('оформление окна одинаково при открытии и при подмене содержимого', () => {
  assert.match(coins, /function _decorateModal\(/, 'нет общей функции оформления');
  const dec = coins.match(/function _decorateModal[\s\S]*?\n\}/)[0];
  assert.match(dec, /aria-labelledby/, 'заголовок не связывается с окном');
  assert.match(dec, /\.modal-close/, 'кнопка закрытия не привязывается');
  assert.match(dec, /focus\?\.\(/, 'фокус не переводится внутрь');

  const upd = coins.match(/function updateModal[\s\S]*?\n\}/)[0];
  assert.match(upd, /_decorateModal\(/, 'подмена содержимого идёт мимо общего оформления');
  assert.match(upd, /aria-label="Закрыть окно"/, 'кнопка закрытия снова без подписи');
  assert.doesNotMatch(upd, /onclick="closeModal\(\)"/, 'вернулся инлайновый обработчик закрытия');
});

test('окно правила в «Колесе» ведёт себя как остальные окна', () => {
  const fn = wheel.match(/function showWheelRuleModal[\s\S]*?\n\}/)[0];
  assert.match(fn, /event\.key === 'Escape'/, 'Escape не закрывает окно');
  assert.match(fn, /classList\.add\('modal-open'\)/, 'фон прокручивается под окном');
  assert.match(fn, /event\.key !== 'Tab'/, 'фокус выходит за пределы окна');
  assert.match(fn, /opener\?\.isConnected/, 'фокус не возвращается на кнопку');
});

test('подвал окна остаётся на виду при длинной форме', () => {
  assert.match(modalCss, /\.modal-actions,[\s\S]*?position: sticky/, 'подвал не липкий');
  assert.match(modalCss, /\[data-modal-cancel\] \{ margin-right: auto; \}/, 'отмена не отделена от основного действия');
  assert.match(modalCss, /body\.modal-open \{ overflow: hidden; \}/, 'фон не блокируется');
  // Оба длинных окна получили подвал с отменой и основным действием.
  const actions = coins.match(/<div class="modal-actions">/g) || [];
  assert.ok(actions.length >= 2, `подвалов с действиями ${actions.length}, ожидалось не меньше 2`);
});

test('уведомление читаемо и объявляется', () => {
  const css = layout.match(/\.toast \{[\s\S]*?\}/)[0];
  assert.doesNotMatch(css, /white-space: nowrap/, 'длинный текст снова уезжает за экран');
  assert.match(css, /background: var\(--bg-surface\)/, 'вернулась плашка сплошного цвета');
  assert.match(css, /color: var\(--text-primary\)/, 'текст не из токена основного цвета');
  // Тип действия показан не только цветом: есть полоса слева и точка.
  assert.match(layout, /\.toast-ok\s*\{ border-left-color: var\(--success\); \}/, 'тип не отмечен полосой');
  assert.match(layout, /\.toast::before/, 'нет точки-индикатора');

  const fn = coins.match(/function showToast[\s\S]*?\n\}/)[0];
  assert.match(fn, /aria-live/, 'сообщение не объявляется');
  assert.match(fn, /'assertive' : 'polite'/, 'ошибка не объявляется сразу');
});

test('на телефоне цели нажатия не меньше 44px', () => {
  // Блок обязан стоять последним: правила вкладок и чипов ниже по файлу
  // задают ту же min-height и перебили бы медиазапрос.
  const mobileAt = controls.lastIndexOf('@media (max-width: 640px)');
  const tabsAt = controls.indexOf('.coins-page-tab,');
  assert.ok(mobileAt > tabsAt, 'мобильный блок стоит раньше определений вкладок и будет перебит');

  const block = controls.slice(mobileAt);
  for (const sel of ['.an2-chip', '.filter-tab', '.btn-link', '.users-expand', '.level-cond-remove']) {
    assert.ok(block.includes(sel), `${sel} не доведён до цели нажатия`);
  }
  assert.match(block, /min-height: var\(--control-h-lg\)/, 'высота не из токена');
});

test('мелкий текст не опускается ниже минимума ТЗ', async () => {
  // Раздел 3 ТЗ: вспомогательный текст 12–13px. В проекте было 210 объявлений
  // размером 7–10.5px, включая подписи полей в 8px и пояснение в превью в 7px.
  const { readdir } = await import('node:fs/promises');
  const root = new URL('../../css/src/', import.meta.url);
  const bad = [];
  for (const dir of await readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of await readdir(new URL(`${dir.name}/`, root))) {
      if (!f.endsWith('.css')) continue;
      const css = await readFile(new URL(`${dir.name}/${f}`, root), 'utf8');
      for (const m of css.matchAll(/font-size:\s*([0-9.]+)px/g)) {
        if (Number(m[1]) < 11) bad.push(`${dir.name}/${f}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(bad, [], `текст мельче 11px:\n  ${bad.slice(0, 12).join('\n  ')}`);
});

test('разрушительные действия оформлены соответствующей кнопкой', async () => {
  const { readdir } = await import('node:fs/promises');
  const root = new URL('../../js/src/views/', import.meta.url);
  const files = [];
  const walk = async dir => {
    for (const e of await readdir(new URL(dir, root), { withFileTypes: true })) {
      if (e.isDirectory()) await walk(`${dir}${e.name}/`);
      else if (e.name.endsWith('.js')) files.push(`${dir}${e.name}`);
    }
  };
  await walk('');
  const bad = [];
  for (const rel of files) {
    const code = await readFile(new URL(rel, root), 'utf8');
    // Кнопка с разрушительной надписью не должна быть обычной вторичной.
    for (const m of code.matchAll(/<button[^>]*class="([^"]*)"[^>]*>\s*(Удалить|Завершить сессию|Отменить розыгрыш)\b/g)) {
      if (!/btn-danger/.test(m[1])) bad.push(`${rel}: ${m[2]} — class="${m[1]}"`);
    }
  }
  assert.deepEqual(bad, [], `разрушительное действие как обычная кнопка:\n  ${bad.join('\n  ')}`);
});

test('в боковой панели роль не дублирует имя, пустой уровень скрыт', async () => {
  const core = await readFile(new URL('../../js/src/app/00-core-shell.js', import.meta.url), 'utf8');
  assert.match(core, /roleEl\.hidden = duplicate/, 'дубль роли снова показывается');
  assert.match(core, /function setSideLevel\(value\)/, 'нет отдельной установки уровня');
  assert.doesNotMatch(core, /setText\('side-level', '—'\)/, 'вернулся прочерк вместо скрытия');
});

test('правило, гасящее рамку вокруг заголовка раздела, на месте', async () => {
  const base = await readFile(new URL('../../css/src/base/00-base-layout.css', import.meta.url), 'utf8');
  assert.match(base, /\[tabindex="-1"\]:focus[\s\S]{0,120}outline: none/,
    'вокруг заголовка снова рисуется рамка фокуса');

  // Это проверка наличия правила, а не результата: раньше тест назывался
  // «не рисует рамку», хотя рамку возвращал общий [tabindex]:focus-visible
  // с той же специфичностью, объявленный позже. Текстом такое не поймать —
  // каскад проверяется в браузере, tests/e2e/levels-forms.spec.mjs.
});
