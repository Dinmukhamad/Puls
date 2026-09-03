/**
 * Раздел 7 ТЗ: тёмная тема, клавиатура, меньшее движение.
 *
 * Что было не так:
 *  · Счётчик на активной вкладке фильтра осветлял акцентную заливку белым
 *    (rgba(255,255,255,.22) и .25 в двух разных правилах). Фон поднимался с
 *    #5E5CE6 до rgb(134,133,236), и белая цифра давала 3.19:1 против нужных
 *    4.5 по WCAG 2.2 AA — в обеих темах, потому что заливка активной вкладки
 *    одинаковая. Затемнение на 24% даёт 7.6:1.
 *  · Боковая панель идёт в разметке до содержимого, а ссылки обхода не было
 *    (WCAG 2.4.1 Bypass Blocks). Приложение ставит фокус на заголовок
 *    экрана, поэтому проход по всей панели требовался не всегда — но при
 *    входе в страницу с начала документа обойти навигацию было нечем.
 *
 * Контраст здесь считается из токенов, а не сверяется со строкой: правило
 * должно оставаться верным и после смены палитры.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

const tokens = await read('css/tokens.css');
const controls = await read('css/src/components/30-controls.css');
const overrides = await read('css/src/views/40-coins-tests-wheel-overrides.css');
const layout = await read('css/src/base/00-base-layout.css');
const html = await read('index.html');
const topbar = await read('js/src/app/06-topbar.js');
const shell = await read('js/src/app/00-core-shell.js');

/* ── Контраст ────────────────────────────────────────────────── */

const hex = value => {
  const clean = value.trim().replace('#', '');
  const full = clean.length === 3 ? [...clean].map(c => c + c).join('') : clean;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
};
const channel = c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const blend = (over, alpha, under) => over.map((v, i) => Math.round(v * alpha + under[i] * (1 - alpha)));

const tokenValue = name => {
  const found = tokens.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{3,8})`));
  assert.ok(found, `нет токена --${name}`);
  return hex(found[1]);
};

// Оба правила задают фон бейджа: каноническое и более позднее
// переопределение. Проверяем каждое — расхождение снова уронило бы контраст.
const badgeRules = [
  ['30-controls.css', controls.match(/\.filter-tab\.active \.filter-tab-count,[\s\S]*?\}/)],
  ['40-coins-tests-wheel-overrides.css', overrides.match(/\.filter-tab\.active \.filter-tab-count \{[^}]*\}/)],
];

test('бейдж активной вкладки читается в обеих темах', () => {
  const fill = tokenValue('accent-fill');
  const text = tokenValue('accent-fill-text');
  for (const [file, match] of badgeRules) {
    assert.ok(match, `в ${file} не нашлось правило бейджа`);
    const rule = match[0];
    const rgba = rule.match(/background:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
    assert.ok(rgba, `в ${file} фон бейджа задан не через rgba — проверка контраста не применима`);
    const overlay = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
    const alpha = Number(rgba[4]);
    const ratio = contrast(text, blend(overlay, alpha, fill));
    assert.ok(ratio >= 4.5, `${file}: контраст цифры на бейдже ${ratio.toFixed(2)}, нужно 4.5`);
  }
});

test('заливка активной вкладки затемняется, а не осветляется', () => {
  // Осветление белым — именно та ошибка, что давала 3.19:1. Ограничение
  // держим явно, чтобы значение не вернули обратно «для красоты».
  for (const [file, match] of badgeRules) {
    assert.doesNotMatch(match[0], /background:\s*rgba\(\s*255\s*,\s*255\s*,\s*255/,
      `${file}: осветление белым поверх акцента снова уронит контраст`);
  }
});

test('текст на акцентной заливке проходит по контрасту', () => {
  const ratio = contrast(tokenValue('accent-fill-text'), tokenValue('accent-fill'));
  assert.ok(ratio >= 4.5, `белый на акценте ${ratio.toFixed(2)}, нужно 4.5`);
});

/* ── Обход навигации ────────────────────────────────────────── */

test('ссылка обхода стоит до навигации и ведёт в содержимое', () => {
  const skipAt = html.indexOf('id="skip-to-content"');
  const navAt = html.indexOf('<nav class="side-nav"');
  const mainAt = html.indexOf('id="main-content"');
  assert.notEqual(skipAt, -1, 'нет ссылки обхода навигации');
  assert.ok(skipAt < navAt, 'ссылка обхода должна идти до навигации, иначе обходить нечего');
  assert.notEqual(mainAt, -1, 'у main нет цели для перехода');
  assert.match(html, /<main[^>]*id="main-content"[^>]*tabindex="-1"/,
    'main должен принимать фокус, иначе переход только прокрутит страницу');
});

test('переход не может увести роутер', () => {
  // Маршруты приложения живут в хеше. Ссылка с href="#main-content" сломала
  // бы навигацию в тот момент, когда обработчик ещё не привязался, поэтому
  // обход сделан кнопкой — и существующий тест routing-roles, требующий,
  // чтобы каждый href="#..." был настоящим маршрутом, остаётся в силе.
  const control = html.match(/<[a-z]+[^>]*id="skip-to-content"[^>]*>/)[0];
  assert.match(control, /^<button/, 'обход должен быть кнопкой, а не ссылкой на хеш');
  assert.doesNotMatch(control, /href=/, 'href увёл бы роутер на несуществующий раздел');
  const fn = topbar.match(/function initSkipLink\(\)[\s\S]*?\n\}/);
  assert.ok(fn, 'нет обработчика обхода навигации');
  assert.match(fn[0], /\.app-view\.active h1/, 'фокус должен уходить на заголовок открытого экрана');
  assert.match(shell, /initSkipLink\(\)/, 'обработчик не подключён при запуске');
});

test('на экране входа ссылка обхода скрыта', () => {
  const fn = topbar.match(/function hideTopbar\(\)[\s\S]*?\n\}/)[0];
  assert.match(fn, /skip-to-content/, 'на экране входа ссылка ведёт в пустой main');
});

test('сфокусированная ссылка обхода видна', () => {
  // Прятать её через .sr-only нельзя: сфокусированный элемент обязан быть
  // видимым, иначе фокус пропадает с экрана.
  const base = layout.match(/\.skip-link \{[^}]*\}/);
  const focus = layout.match(/\.skip-link:focus \{[^}]*\}/);
  assert.ok(base && focus, 'нет стиля ссылки обхода или её состояния фокуса');
  assert.match(base[0], /transform:\s*translateY\(/, 'ссылка не убрана за край экрана');
  assert.match(focus[0], /transform:\s*translateY\(0\)/, 'при фокусе ссылка не выезжает на экран');
  assert.match(focus[0], /outline:/, 'у сфокусированной ссылки нет обводки');
});

/* ── Меньшее движение ───────────────────────────────────────── */

test('движение отключается по запросу системы', () => {
  const sources = [['00-base-layout.css', layout], ['30-controls.css', controls]];
  for (const [name, css] of sources) {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/,
      `${name}: нет блока для prefers-reduced-motion`);
  }
  const block = layout.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)[0];
  assert.match(block, /animation|transition/, 'блок не трогает ни анимации, ни переходы');
});
