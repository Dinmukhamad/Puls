/**
 * Тексты на карточке уровня обязаны описывать то, что делает сервер.
 *
 * Две ошибки, от которых защищают эти проверки:
 *   • «при каждом присвоении» у выключенной награды — на сервере
 *     reward_once=false означает «не начислять вовсе» (service.py);
 *   • условие «не больше» с подстановкой value_min — расчёт (_rule_ok)
 *     для lte смотрит только value_max, и подпись показывала бы не то
 *     условие, по которому уровень реально присваивается.
 *
 * Отдельно закреплено, что карточка не берёт серверный reward_label:
 * он собран из одного reward_coins и про reward_once ничего не знает.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const view = await readFile(new URL('js/src/views/operator-levels/13-levels-2026.view.js', root), 'utf8');

function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `в исходнике нет функции ${name}`);
  let i = source.indexOf('(', start);
  let paren = 0;
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  let depth = 0;
  for (let j = source.indexOf('{', i); j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(start, j + 1);
  }
  throw new Error(`не нашёл конец функции ${name}`);
}

// Подпись награды форматирует сумму общим fmtCoins, поэтому песочнице нужна
// та же зависимость: иначе проверяется не текст, а отсутствие функции.
const utilsSource = await readFile(
  new URL('../../js/src/utils/10-ui-system.js', import.meta.url), 'utf8');

const card = new Function(`
  const UI_COIN = '₡';
  ${utilsSource.match(/function fmtCoins[\s\S]*?\n\}/)[0]}
  ${extractFn(view, 'levelRuleText')}
  ${extractFn(view, 'levelRewardText')}
  ${extractFn(view, 'levelsSorted')}
  return { levelRuleText, levelRewardText, levelsSorted };
`)();

/* ── Награда ─────────────────────────────────────────────────── */

test('включённая награда описана как разовая', () => {
  const text = card.levelRewardText({ reward_coins: 5, reward_once: true });
  assert.match(text, /5\s?₡/, 'в подписи нет суммы награды');
  assert.match(text, /один раз/);
});

test('выключенная награда не обещает начисления', () => {
  const text = card.levelRewardText({ reward_coins: 5, reward_once: false });
  assert.doesNotMatch(text, /при каждом|каждый раз/,
    'подпись обещает повторные начисления, которых сервер не делает');
  assert.match(text, /выключено/, 'пользователь не поймёт, что коины не придут');
});

test('серверный reward_label не подменяет собой честный текст', () => {
  // Бэкенд отдаёт эту подпись, не зная про reward_once.
  const text = card.levelRewardText({
    reward_coins: 3, reward_once: false, reward_label: '3 коина при повышении',
  });
  assert.doesNotMatch(text, /при повышении/,
    'карточка снова доверилась reward_label и обещает награду, которой не будет');
});

test('уровень без награды говорит об этом прямо', () => {
  assert.match(card.levelRewardText({ reward_coins: 0 }), /Без награды/);
});

test('множитель и скидка попадают в подпись', () => {
  const text = card.levelRewardText({
    reward_coins: 0, coin_multiplier_percent: 10, shop_discount_percent: 5,
  });
  assert.match(text, /×1\.1/);
  assert.match(text, /скидка 5%/);
});

/* ── Условия ─────────────────────────────────────────────────── */

test('«не больше» опирается на верхнюю границу', () => {
  const text = card.levelRuleText({
    metric_label: 'Штрафы', operator: 'lte', value_min: 99, value_max: 20,
  });
  assert.match(text, /не больше 20/);
  assert.doesNotMatch(text, /99/, 'подставилась нижняя граница, которую расчёт не смотрит');
});

test('диапазон показывает обе границы', () => {
  const text = card.levelRuleText({
    metric_label: 'Стаж', operator: 'between', value_min: 0, value_max: 7,
  });
  assert.match(text, /от 0 до 7/);
});

test('«не ниже» показывает нижнюю границу', () => {
  assert.match(
    card.levelRuleText({ metric_label: 'Качество', operator: 'gte', value_min: 80 }),
    /от 80/,
  );
});

test('готовый текст условия с сервера имеет приоритет', () => {
  const text = card.levelRuleText({ condition_text: 'Качество не ниже 80%', operator: 'gte' });
  assert.equal(text, 'Качество не ниже 80%');
});

test('без подписи показателя берётся его код', () => {
  const text = card.levelRuleText({ metric_code: 'kvz', operator: 'gte', value_min: 8 });
  assert.match(text, /kvz/);
});

/* ── Порядок ─────────────────────────────────────────────────── */

test('уровни идут по sort_order, а не по порядку ответа', () => {
  const sorted = card.levelsSorted([
    { name: 'Профи', sort_order: 4 },
    { name: 'Стажёр', sort_order: 1 },
    { name: 'Оператор', sort_order: 3 },
  ]);
  assert.deepEqual(sorted.map(l => l.name), ['Стажёр', 'Оператор', 'Профи']);
});

test('уровень без sort_order не ломает сортировку', () => {
  const sorted = card.levelsSorted([{ name: 'Б', sort_order: 2 }, { name: 'А' }]);
  assert.deepEqual(sorted.map(l => l.name), ['А', 'Б']);
});
