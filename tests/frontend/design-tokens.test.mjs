/**
 * Инварианты палитры.
 *
 * Тест не сверяет строки, а считает контраст по формуле WCAG прямо из
 * css/tokens.css. До переработки палитра давала 80 нечитаемых мест на 13
 * экранах: --text-muted (#8E8E93) давал 2.60:1 на сером фоне, --success
 * (#34C759) — 2.22:1 как текст на белом, белый на тёмном --accent-primary
 * (#7D78F0) — 3.61:1. Если кто-то снова осветлит текстовый токен или вернёт
 * яркий системный цвет в роль текста, тест это поймает.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../../css/tokens.css', import.meta.url), 'utf8');

/** Значения светлой и тёмной темы объявлены в разных блоках. */
function palette(theme) {
  const start = css.indexOf('html[data-theme="dark"]');
  // Комментарии убираем до разбора: внутри них встречаются имена токенов,
  // и без точки с запятой они «склеиваются» со следующим объявлением.
  const src = (theme === 'dark' ? css.slice(start) : css.slice(0, start))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const map = {};
  for (const m of src.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) map[m[1]] = m[2].trim();
  return map;
}

function rgb(value, palette, depth = 0) {
  if (depth > 6) throw new Error(`не удалось раскрыть ${value}`);
  const v = value.trim();
  const varRef = v.match(/^var\((--[a-z0-9-]+)\)$/);
  if (varRef) return rgb(palette[varRef[1]], palette, depth + 1);
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const fn = v.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const p = fn[1].split(',').map(s => parseFloat(s));
    return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
  }
  throw new Error(`неизвестный формат цвета: ${value}`);
}

/** Полупрозрачный фон накладываем на подложку — иначе контраст не посчитать. */
function over(color, base) {
  const a = color[3];
  return [0, 1, 2].map(i => color[i] * a + base[i] * (1 - a)).concat(1);
}

function contrast(fg, bg) {
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const AA = 4.5;

for (const theme of ['light', 'dark']) {
  const p = palette(theme);
  const surfaces = ['--bg-page', '--bg-surface', '--bg-muted', '--bg-subtle', '--card-bg'];

  test(`${theme}: основной и вторичный текст читаются на всех поверхностях`, () => {
    for (const text of ['--text-primary', '--text-secondary', '--text-muted']) {
      for (const surface of surfaces) {
        const ratio = contrast(rgb(p[text], p), rgb(p[surface], p));
        assert.ok(ratio >= AA,
          `${theme}: ${text} на ${surface} даёт ${ratio.toFixed(2)}:1, нужно ${AA}`);
      }
    }
  });

  test(`${theme}: текстовые варианты семантики проходят AA на своей подложке`, () => {
    const card = rgb(p['--card-bg'], p);
    for (const name of ['success', 'danger', 'warning', 'info']) {
      const fg = rgb(p[`--${name}-text`], p);
      for (const bg of [p['--card-bg'], p[`--${name}-soft`]]) {
        const ratio = contrast(fg, over(rgb(bg, p), card));
        assert.ok(ratio >= AA,
          `${theme}: --${name}-text на ${bg} даёт ${ratio.toFixed(2)}:1, нужно ${AA}`);
      }
    }
  });

  test(`${theme}: акцентный текст читается на своей мягкой подложке`, () => {
    // Пара «--accent-primary на --accent-primary-soft» встречается в активных
    // вкладках, аватарах и чипах. На прежней подложке она давала 4.47:1.
    for (const soft of ['--accent-primary-soft', '--accent-secondary-soft']) {
      const card = rgb(p['--card-bg'], p);
      const ratio = contrast(rgb(p['--accent-primary'], p), over(rgb(p[soft], p), card));
      assert.ok(ratio >= AA,
        `${theme}: --accent-primary на ${soft} даёт ${ratio.toFixed(2)}:1, нужно ${AA}`);
    }
  });

  test(`${theme}: текст на заливке акцента читается`, () => {
    const ratio = contrast(rgb(p['--accent-fill-text'], p), rgb(p['--accent-fill'], p));
    assert.ok(ratio >= AA,
      `${theme}: --accent-fill-text на --accent-fill даёт ${ratio.toFixed(2)}:1, нужно ${AA}`);
  });
}

test('яркие системные цвета не используются как цвет текста', async () => {
  // Они верны как заливка, иконка и рамка, но не как текст: для текста есть
  // отдельные --*-text. Легаси-псевдонимы --ok/--warn туда же.
  const { readdir } = await import('node:fs/promises');
  const root = new URL('../../css/src/', import.meta.url);
  const dirs = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    for (const f of await readdir(new URL(`${d.name}/`, root))) {
      if (f.endsWith('.css')) files.push(new URL(`${d.name}/${f}`, root));
    }
  }
  assert.ok(files.length > 10, 'исходники стилей не найдены');
  const bad = [];
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    for (const m of text.matchAll(/(?<![-a-zA-Z])color:\s*var\(--(success|danger|warning|info|ok|warn)\)/g)) {
      bad.push(`${f.pathname.split('/css/src/')[1]}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, [], `яркий цвет использован как текст:\n  ${bad.join('\n  ')}`);
});
