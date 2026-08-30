/**
 * Требования разделов 5 и 11 ТЗ к таблицам и состояниям загрузки.
 *
 * Что было не так:
 *  · у 101 заголовка колонки не было scope — скринридер не связывал ячейку
 *    с её колонкой;
 *  · таблица попыток в «Миссиях» вообще не имела класса, поэтому не получала
 *    ни липкой шапки, ни границ, ни выравнивания;
 *  · количество операторов в «Группах» выравнивалось влево;
 *  · загрузка показывалась крутящимся кружком с подписью «Загрузка…» в
 *    одиннадцати местах, а в «Аналитике» строка «Загружаем показатели…»
 *    оставалась навсегда, если данных за период не было: она обновлялась
 *    только на непустом ответе.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function viewSources() {
  const out = [];
  const base = new URL('js/src/', root);
  const walk = async (dir) => {
    for (const e of await readdir(new URL(dir, base), { withFileTypes: true })) {
      if (e.isDirectory()) await walk(`${dir}${e.name}/`);
      else if (e.name.endsWith('.js')) {
        out.push({ rel: `${dir}${e.name}`, code: await readFile(new URL(`${dir}${e.name}`, base), 'utf8') });
      }
    }
  };
  await walk('');
  return out;
}

const sources = await viewSources();
const table = await readFile(new URL('css/src/components/40-table.css', root), 'utf8');
const states = await readFile(new URL('js/src/components/10-states.js', root), 'utf8');

test('каждый заголовок колонки объявляет scope', () => {
  const bad = [];
  for (const { rel, code } of sources) {
    for (const head of code.matchAll(/<thead[\s\S]*?<\/thead>/g)) {
      for (const th of head[0].matchAll(/<th(?![a-zA-Z])([^>]*)>/g)) {
        if (!/scope=/.test(th[1])) bad.push(`${rel}: ${th[0].slice(0, 46)}`);
      }
    }
  }
  assert.deepEqual(bad, [], `заголовки без scope:\n  ${bad.join('\n  ')}`);
});

test('каждая видимая таблица размечена общим классом', () => {
  const bad = [];
  for (const { rel, code } of sources) {
    for (const m of code.matchAll(/<table(?![a-zA-Z])([^>]*)>/g)) {
      if (!/class="[^"]*\b(data-table|ui-data-table)\b/.test(m[1])) {
        bad.push(`${rel}: ${m[0].slice(0, 46)}`);
      }
    }
  }
  assert.deepEqual(bad, [], `таблицы без общего класса:\n  ${bad.join('\n  ')}`);
});

test('канон таблицы описывает шапку, высоту строки и выравнивание чисел', () => {
  assert.match(table, /\.data-table th[\s\S]*?background: var\(--table-header-bg\)/, 'нет фона шапки');
  assert.match(table, /height: var\(--row-h\)/, 'высота строки не из токена');
  assert.match(table, /\.data-table td\.num[\s\S]*?text-align: right/, 'числа не выравниваются вправо');
  assert.match(table, /font-variant-numeric: tabular-nums/, 'цифры не моноширинные');
  assert.match(table, /data-mobile="cards"/, 'нет карточного представления на телефоне');
  assert.match(table, /content: attr\(data-label\)/, 'у ячеек карточки нет подписей');
});

test('состояния загрузки — каркасы, а не кружок с подписью', () => {
  const bad = [];
  for (const { rel, code } of sources) {
    if (rel.startsWith('components/')) continue;
    for (const m of code.matchAll(/<div class="loading-state"[^>]*>\s*<div class="loading-spinner">/g)) {
      bad.push(`${rel}: ${m[0].slice(0, 50)}`);
    }
  }
  assert.deepEqual(bad, [], `вернулся кружок вместо каркаса:\n  ${bad.join('\n  ')}`);
});

test('набор каркасов покрывает таблицу, список, форму и общий случай', () => {
  for (const fn of ['uiTableSkeleton', 'uiListSkeleton', 'uiFormSkeleton', 'uiLoadingBlock']) {
    assert.ok(states.includes(`function ${fn}(`), `нет ${fn}`);
  }
  // Каркас таблицы ограничен восемью строками: больше выглядит как готовый
  // список и вводит в заблуждение.
  assert.match(states, /Math\.min\(8, rows\)/, 'число строк каркаса не ограничено');
});

test('строка-лид аналитики обновляется и когда данных за период нет', () => {
  const view = sources.find(s => s.rel.endsWith('41-analytics.view.js')).code;
  const paint = view.match(/function anPaint\(el\)[\s\S]*?\n\}/)[0];
  // Прежнее условие обновляло лид только на непустом ответе.
  assert.doesNotMatch(paint, /if \(AN_STATE\.data && !AN_STATE\.data\.empty\) \{/,
    'лид снова обновляется только на непустых данных');
  assert.match(paint, /if \(AN_STATE\.data\) \{/, 'лид не обновляется по приходу данных');
});

test('текст только для скринридера действительно скрыт', async () => {
  // Класс .sr-only использовался в разметке в восьми местах, но не был описан
  // ни в одном файле стилей: подписи полей и статусы загрузки показывались как
  // обычный текст. Проверяем не наличие правила, а его действие.
  const layout = await readFile(new URL('css/src/base/00-base-layout.css', root), 'utf8');
  const rule = layout.match(/\.sr-only\s*\{[^}]*\}/);
  assert.ok(rule, 'класс .sr-only не описан');
  assert.match(rule[0], /position:\s*absolute/, '.sr-only не выводится из потока');
  assert.match(rule[0], /clip-path:\s*inset\(50%\)/, '.sr-only не обрезается');
  assert.match(rule[0], /width:\s*1px/, '.sr-only занимает место');

  // Каждое использование в разметке должно опираться на этот же класс.
  let uses = 0;
  for (const { code } of sources) uses += (code.match(/sr-only/g) || []).length;
  assert.ok(uses > 0, 'класс перестал использоваться — проверка потеряла смысл');
});
