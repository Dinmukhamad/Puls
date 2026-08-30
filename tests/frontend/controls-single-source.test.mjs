/**
 * Инвариант: внешний вид общих управляющих элементов описан в одном месте.
 *
 * До объединения кнопка описывалась в одиннадцати файлах: min-height
 * объявлялся как 36, 38, 40, 42 и 44 px, фон .btn-primary — четырьмя
 * разными способами, а побеждал тот файл, что грузился последним. Из-за
 * этого «Обновить» на разных экранах выглядела по-разному.
 *
 * Тест разбирает все исходники стилей и падает, если какой-то файл, кроме
 * канонического, снова задаёт внешний вид общего класса без контекста.
 * Контекстные правила (#view-wheel .btn-primary { width: 100% }) разрешены:
 * это геометрия конкретного экрана, а не переопределение вида.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../css/src/', import.meta.url);
const CANON = 'components/30-controls.css';

async function sources() {
  const out = [];
  for (const dir of await readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of await readdir(new URL(`${dir.name}/`, root))) {
      if (!f.endsWith('.css')) continue;
      const rel = `${dir.name}/${f}`;
      out.push({ rel, css: await readFile(new URL(rel, root), 'utf8') });
    }
  }
  return out;
}

/** Свойства, определяющие именно внешний вид, а не место на экране. */
const LOOK = /(^|;)\s*(background|background-color|color|border|border-color|border-radius|box-shadow|min-height|font-weight|font-size)\s*:/;

function bareSelectors(pattern, files) {
  const bad = [];
  for (const { rel, css } of files) {
    if (rel === CANON) continue;
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const body = m[2];
      if (!LOOK.test(`;${body}`)) continue;
      for (const part of m[1].split(',')) {
        const sel = part.trim().split('*/').pop().trim();
        if (!pattern.test(sel)) continue;
        const props = [...body.matchAll(/(^|;)\s*([a-z-]+)\s*:/g)]
          .map(p => p[2]).filter(p => LOOK.test(`;${p}:`));
        bad.push(`${rel}: ${sel} { ${props.join(', ')} }`);
      }
    }
  }
  return bad;
}

const files = await sources();

test('канонический файл управляющих элементов существует', async () => {
  const canon = files.find(f => f.rel === CANON);
  assert.ok(canon, `нет ${CANON}`);
  for (const cls of ['.btn-primary', '.btn-secondary', '.btn-danger', '.btn-ghost', '.ui-icon-button']) {
    assert.ok(canon.css.includes(cls), `в каноне не описан ${cls}`);
  }
});

test('внешний вид кнопок задаётся только в каноне', () => {
  // Голый класс с псевдоклассами, но без предков и без вложенности.
  const bare = /^\.(btn-primary|btn-secondary|btn-outline|btn-ghost|btn-danger|btn-ok)((:|::)[a-z-]+(\([^)]*\))?)*$/;
  const bad = bareSelectors(bare, files);
  assert.deepEqual(bad, [], `внешний вид кнопки переопределён вне канона:\n  ${bad.join('\n  ')}`);
});

test('внешний вид вкладок задаётся только в каноне', () => {
  const bare = /^\.(filter-tab|analytics-tab|an2-tab|coins-page-tab|shop-v2-tab|tab-btn)((\.[a-z-]+)*)((:|::)[a-z-]+(\([^)]*\))?)*$/;
  const bad = bareSelectors(bare, files);
  assert.deepEqual(bad, [], `внешний вид вкладки переопределён вне канона:\n  ${bad.join('\n  ')}`);
});

test('у кнопок нет !important на фоне и цвете', () => {
  const bad = [];
  for (const { rel, css } of files) {
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/\.btn-(primary|secondary|outline|ghost|danger|ok)\b/.test(m[1])) continue;
      for (const d of m[2].matchAll(/(background|color|border)[a-z-]*\s*:[^;]*!important/g)) {
        bad.push(`${rel}: ${m[1].trim().slice(0, 50)} — ${d[0].slice(0, 46)}`);
      }
    }
  }
  assert.deepEqual(bad, [], `!important возвращает войну файлов:\n  ${bad.join('\n  ')}`);
});

test('высота кнопки берётся из токена, а не из числа', () => {
  const canon = files.find(f => f.rel === CANON).css;
  assert.match(canon, /min-height:\s*var\(--control-h\)/, 'базовая высота не из токена');
  const bad = [];
  for (const { rel, css } of files) {
    if (rel === CANON) continue;
    for (const m of css.matchAll(/([^{}]*\.btn-[a-z]+[^{}]*)\{([^}]*)\}/g)) {
      const hit = m[2].match(/min-height:\s*(\d+)px/);
      if (hit) bad.push(`${rel}: ${m[1].trim().split('*/').pop().trim().slice(0, 54)} — ${hit[0]}`);
    }
  }
  assert.deepEqual(bad, [], `высота кнопки задана числом мимо токена:\n  ${bad.join('\n  ')}`);
});
