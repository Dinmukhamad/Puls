/**
 * Раздел 6 ТЗ: игровые экраны оператора и администратора.
 *
 * Что было не так:
 *  · «Рейтинг». Помощники opNum/opCoin/opPercent считали значение через
 *    Number(value || 0), поэтому null, undefined и пустая строка выдавались
 *    за ноль: карточка «Мой результат» показывала «Баллы 0 · Качество 0%»
 *    оператору, у которого периода ещё не было. Definition of Done
 *    требует различать zero, null и missing.
 *  · «Рейтинг», зона гонки. Пустой сосед сверху трактовался однозначно как
 *    лидерство, и операторам без места экран писал «Вы лидер. Выше вас
 *    сейчас никого нет» — утверждение о том, чего мы не знаем.
 *  · «Розыгрыши». Не было ни одного из четырёх показателей.
 *  · Повторная отправка. У POST /raffles/{id}/enter и /tests/{id}/finish
 *    нет Idempotency-Key, а билеты и попытка расходуются. finishTestRun
 *    обнулял _activeTestRun уже после await, поэтому клик по «Завершить» и
 *    сработавший таймер отправляли запрос дважды; у входа в розыгрыш
 *    защиты не было вовсе.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

const rating = await read('js/src/views/rating/99-operator-cabinet-rating-redesign.view.js');
const race = await read('js/src/views/rating/zz-operator-rating-competition.view.js');
const raffles = await read('js/src/views/raffles/70-raffles.view.js');
const tests = await read('js/src/views/wheel/60-wheel-tests.view.js');
const utils = await read('js/src/utils/10-ui-system.js');
const schemas = await read('app/modules/raffles/schemas.py');

function extractFn(source, name) {
  const start = source.search(new RegExp(`function ${name}\\s*\\(`));
  assert.notEqual(start, -1, `нет функции ${name}`);
  let depth = 0;
  for (let j = source.indexOf('{', start); j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(start, j + 1);
  }
  throw new Error(`не нашёл конец функции ${name}`);
}

const box = new Function(`
  const UI_COIN = '₡';
  ${utils.match(/function fmtCoins[\s\S]*?\n\}/)[0]}
  ${extractFn(rating, 'opNum')}
  ${extractFn(rating, 'opCoin')}
  ${extractFn(rating, 'opPercent')}
  return { opNum, opCoin, opPercent };
`)();

/* ── Ноль и отсутствие данных ────────────────────────────────── */

test('отсутствие данных показывается прочерком, а не нулём', () => {
  for (const missing of [null, undefined, '']) {
    assert.equal(box.opNum(missing), '—', `opNum(${JSON.stringify(missing)}) выдал значение за ноль`);
    assert.equal(box.opCoin(missing), '—', `opCoin(${JSON.stringify(missing)}) выдал значение за ноль`);
    assert.equal(box.opPercent(missing), '—', `opPercent(${JSON.stringify(missing)}) выдал значение за ноль`);
  }
});

test('настоящий ноль остаётся нулём', () => {
  // Ноль — это результат периода, а не пустота: подменять его прочерком
  // так же неверно, как показывать прочерк нулём.
  assert.equal(box.opNum(0), '0');
  assert.match(box.opCoin(0), /^0\s?₡$/u);
  assert.equal(box.opPercent(0), '0%');
});

test('суммы в коинах идут через общий форматтер', () => {
  assert.match(box.opCoin(1250), /1\s?250\s?₡/u, 'нет разряда или знака коина');
  assert.match(box.opCoin(-40), /^-/, 'минус должен стоять перед числом');
  assert.match(box.opCoin(40, true), /^\+/, 'знак «плюс» не проставлен');
});

/* ── Зона гонки ──────────────────────────────────────────────── */

test('лидерство не заявляется без рассчитанного места', () => {
  const card = extractFn(race, 'rcRivalCard');
  assert.match(card, /Number\(current\?\.rank\)\s*>\s*0/,
    'карточка не проверяет наличие места');
  const leaderLine = card.match(/const leader\s*=\s*[^;]+;/)[0];
  assert.ok(/ranked/.test(leaderLine) && /rank\)?\s*===\s*1/.test(leaderLine),
    'лидерство должно требовать и наличия места, и rank === 1');
});

test('без места вместо расстановки соперников показана причина', () => {
  const lane = extractFn(race, 'rcRivalLane');
  assert.match(lane, /!\(Number\(current\.rank\) > 0\)/,
    'полоса соперников не проверяет место');
  assert.match(lane, /opEmpty\(/, 'нет объяснения, почему соперников нет');
});

/* ── Показатели розыгрышей ───────────────────────────────────── */

test('на экране розыгрышей есть все четыре показателя', () => {
  const block = raffles.match(/<div class="ui-kpi-grid">[\s\S]*?\n {4}<\/div>/);
  assert.ok(block, 'нет сетки показателей');
  for (const label of ['Активных розыгрышей', 'Участий', 'Билетов вложено', 'Победителей определено']) {
    assert.ok(block[0].includes(label), `нет показателя «${label}»`);
  }
});

test('показатели считаются по полям, которые отдаёт сервер', () => {
  const model = schemas.match(/class RaffleRead\(BaseModel\):[\s\S]*?\n\n/)[0];
  for (const field of ['participants', 'total_tickets', 'winners']) {
    assert.ok(model.includes(`${field}:`), `RaffleRead не отдаёт ${field}`);
    assert.ok(raffles.includes(field), `экран не использует ${field}`);
  }
});

test('участия названы участиями, а не людьми', () => {
  // participants суммируется по нескольким розыгрышам, и один оператор
  // может участвовать в каждом: «Участников: N» было бы неправдой.
  const block = raffles.match(/<div class="ui-kpi-grid">[\s\S]*?\n {4}<\/div>/)[0];
  assert.doesNotMatch(block, /label: 'Участников/, 'сумма по розыгрышам — это участия');
  assert.match(block, /hint: '[^']*участия, а не число людей/, 'нет пояснения к показателю');
});

/* ── Повторная отправка ──────────────────────────────────────── */

test('вход в розыгрыш нельзя отправить дважды', () => {
  const fn = extractFn(raffles, 'submitEnterRaffle');
  assert.match(fn, /if \(_raffleEnterBusy\) return;/, 'нет защиты от повторного вызова');
  const guardAt = fn.indexOf('_raffleEnterBusy = true');
  const awaitAt = fn.indexOf('await api.enterRaffle');
  assert.ok(guardAt !== -1 && guardAt < awaitAt,
    'флаг должен ставиться до запроса, иначе второй клик успеет пройти');
  assert.match(fn, /submit\.disabled = true/, 'кнопка не блокируется');
});

test('завершение теста снимает попытку до запроса, а не после ответа', () => {
  const fn = extractFn(tests, 'finishTestRun');
  const clearAt = fn.indexOf('_activeTestRun = null');
  const awaitAt = fn.indexOf('await api.finishTest');
  assert.ok(clearAt !== -1, 'попытка не снимается');
  assert.ok(clearAt < awaitAt,
    'пока попытка снимается за await, таймер и кнопка отправляют finishTest дважды');
  assert.match(fn, /_activeTestRun = run;/, 'при ошибке попытку нужно вернуть, иначе тест брошен');
});

test('прокрутка колеса закрывается флагом до запроса', () => {
  const fn = extractFn(tests, 'doWheelSpin');
  const guardAt = fn.indexOf('w.spinning = true');
  const awaitAt = fn.indexOf('await api.spinWheel');
  assert.ok(guardAt !== -1 && guardAt < awaitAt, 'флаг прокрутки ставится не до запроса');
});

/* ── Пустые состояния ────────────────────────────────────────── */

test('пустые состояния игровых экранов объясняют причину', () => {
  // Односложное «Нет активных розыгрышей» не говорит ни почему пусто, ни
  // что делать дальше.
  for (const [source, name] of [[raffles, 'розыгрыши'], [tests, 'тесты']]) {
    const bare = source.match(/<div class="empty-state">[^<]{0,60}<\/div>/g) || [];
    assert.deepEqual(bare, [], `в ${name} осталось пустое состояние без объяснения: ${bare[0]}`);
  }
  assert.match(raffles, /Копите билеты в Колесе WOW/, 'оператору не сказано, откуда берутся билеты');
  assert.match(tests, /Тесты назначает руководитель/, 'оператору не сказано, откуда берутся тесты');
});
