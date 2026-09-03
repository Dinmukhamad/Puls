/**
 * Формат сумм и клавиатура полос вкладок (ТЗ, стр. 6 и 16).
 *
 * Что было не так:
 *  · суммы подставлялись в разметку как есть, поэтому вместо «1 250 ₡» из
 *    ТЗ выводилось «1250 ₡» — разряды не разделялись нигде в приложении;
 *  · панель вкладок «Коинов» не имела role="tabpanel" и связи с активной
 *    вкладкой, то есть шаблон вкладок был собран наполовину;
 *  · полосы вкладок обходились только табом: семь вкладок «Коинов» были
 *    семью остановками подряд, стрелки не работали.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const utils = await readFile(new URL('js/src/utils/10-ui-system.js', root), 'utf8');
const tablist = await readFile(new URL('js/src/app/07-tablist.js', root), 'utf8');
const coins = await readFile(new URL('js/src/views/coins/30-admin-coins-groups-operators.view.js', root), 'utf8');
const shell = await readFile(new URL('js/src/app/00-core-shell.js', root), 'utf8');

/** Прогоняем сам форматтер, а не проверяем строки в исходнике. */
function loadFormatter() {
  const body = utils.match(/function fmtCoins[\s\S]*?\n\}/)[0];
  // eslint-disable-next-line no-new-func
  return new Function(`const UI_COIN = '₡'; ${body}; return fmtCoins;`)();
}

test('суммы форматируются по образцу ТЗ', () => {
  const fmtCoins = loadFormatter();
  const nb = ' ';
  assert.equal(fmtCoins(1250), `1${nb}250${nb}₡`, 'разряды не разделены');
  assert.equal(fmtCoins(1234567), `1${nb}234${nb}567${nb}₡`);
  assert.equal(fmtCoins(98, { sign: true }), `+98${nb}₡`, 'нет знака у положительной суммы');
  assert.equal(fmtCoins(-5), `-5${nb}₡`, 'минус должен стоять перед числом');
  // Ноль — значение, а не пустота.
  assert.equal(fmtCoins(0), `0${nb}₡`);
  assert.equal(fmtCoins(0, { sign: true }), `0${nb}₡`, 'у нуля не должно быть знака');
  assert.equal(fmtCoins(null), '—', 'отсутствие суммы не должно превращаться в ноль');
  assert.equal(fmtCoins(''), '—');
});

test('в разметке нет сумм мимо форматтера', async () => {
  const base = new URL('js/src/', root);
  const files = [];
  const walk = async dir => {
    for (const e of await readdir(new URL(dir, base), { withFileTypes: true })) {
      if (e.isDirectory()) await walk(`${dir}${e.name}/`);
      else if (e.name.endsWith('.js')) files.push(`${dir}${e.name}`);
    }
  };
  await walk('');
  const bad = [];
  for (const rel of files) {
    if (rel.startsWith('utils/')) continue;
    const code = await readFile(new URL(rel, base), 'utf8');
    // ${выражение} ₡ — подстановка значения мимо форматтера. Подписи вида
    // «Начислено ₡» под шаблон не подпадают, у них нет подстановки.
    for (const m of code.matchAll(/\$\{([^{}]+)\}\s₡/g)) {
      if (!m[1].includes('fmtCoins')) bad.push(`${rel}: ${m[0].slice(0, 44)}`);
    }
  }
  assert.deepEqual(bad, [], `сумма выводится мимо fmtCoins:\n  ${bad.join('\n  ')}`);
});

test('панель вкладок «Коинов» собрана полностью', () => {
  assert.match(coins, /id="coins-tab-\$\{id\}"/, 'у вкладок нет идентификаторов');
  assert.match(coins, /aria-controls="coins-tab-body"/, 'вкладки не связаны с панелью');
  assert.match(coins, /role="tabpanel" aria-labelledby="coins-tab-\$\{tab\}"/,
    'панель без роли или без связи с активной вкладкой');
});

test('полосы вкладок управляются стрелками и имеют одну остановку в обходе', () => {
  assert.match(shell, /initTablistKeyboard\(\);/, 'обработчик не подключён');
  assert.match(tablist, /ArrowLeft|ArrowRight/, 'стрелки не обрабатываются');
  assert.match(tablist, /event\.key === 'Home'/, 'нет перехода к первой вкладке');
  assert.match(tablist, /event\.key === 'End'/, 'нет перехода к последней вкладке');
  assert.match(tablist, /tab\.tabIndex = tab === active \? 0 : -1/,
    'все вкладки остаются остановками в обходе');
  // Переключение только по намеренному действию: стрелки меняют адрес и
  // грузят данные, «проматывание» запускало бы лишние запросы.
  const handler = tablist.match(/document\.addEventListener\('keydown'[\s\S]*?\n  \}\);/)[0];
  assert.doesNotMatch(handler, /if \(back \|\| forward\)[\s\S]{0,200}\.click\(\)/,
    'стрелка сразу переключает вкладку');
});
