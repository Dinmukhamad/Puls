/**
 * Механика ленты призов.
 *
 * Раньше розыгрыш был CSS-диском с одним переходом между двумя углами: он
 * не разгонялся и не выбегал, просто доезжал. Теперь движение считается
 * покадрово, и есть два места, где легко ошибиться незаметно:
 *
 *   · профиль скорости — если она ненулевая на концах, лента дёргается на
 *     старте и обрывается на финише;
 *   · посадка — приз выбирает сервер, и лента обязана остановиться ровно
 *     на нём. Промах означал бы, что человек видит один результат, а
 *     получает другой.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("./spinPhysics.ts", import.meta.url), "utf8");
const built = await transform(source, { loader: "ts", format: "esm" });
const { spinProgress, fitCanvas, stripTarget, prizeUnderMark } = await import(
  `data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`
);

/* ── Профиль скорости ──────────────────────────────────────── */

test("путь начинается в нуле и заканчивается единицей", () => {
  assert.equal(spinProgress(0), 0);
  assert.equal(spinProgress(1), 1);
  // За границами тоже: кадр может прийти позже конца анимации.
  assert.equal(spinProgress(-0.2), 0);
  assert.equal(spinProgress(1.4), 1);
});

test("лента не едет назад", () => {
  let previous = 0;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const value = spinProgress(t);
    assert.ok(value >= previous - 1e-12, `на t=${t.toFixed(2)} путь уменьшился`);
    previous = value;
  }
});

test("скорость нулевая на обоих концах", () => {
  // Это и отличает живое движение от перемотки: лента трогается с места
  // и останавливается, а не возникает уже в движении.
  const h = 1e-4;
  const atStart = (spinProgress(h) - spinProgress(0)) / h;
  const atEnd = (spinProgress(1) - spinProgress(1 - h)) / h;
  assert.ok(atStart < 0.05, `на старте скорость ${atStart.toFixed(3)}, ожидался покой`);
  assert.ok(atEnd < 0.05, `на финише скорость ${atEnd.toFixed(3)}, ожидался покой`);
});

test("сначала разгон, потом выбег", () => {
  const speed = (t) => (spinProgress(t + 1e-4) - spinProgress(t - 1e-4)) / 2e-4;
  assert.ok(speed(0.1) < speed(0.22), "скорость не растёт на разгоне");
  assert.ok(speed(0.8) < speed(0.22), "скорость не падает на выбеге");
  // Выбег длиннее разгона: так движение читается как инерция.
  assert.ok(speed(0.5) > speed(0.9), "торможение не растянуто");
});

test("ветви профиля стыкуются без перелома", () => {
  const at = 0.22;
  const left = (spinProgress(at) - spinProgress(at - 1e-5)) / 1e-5;
  const right = (spinProgress(at + 1e-5) - spinProgress(at)) / 1e-5;
  assert.ok(Math.abs(left - right) < 0.01, `перелом скорости: ${left.toFixed(3)} против ${right.toFixed(3)}`);
});

/* ── Посадка ленты ─────────────────────────────────────────── */

const PITCH = 160;

test("лента останавливается ровно на призе, который выбрал сервер", () => {
  for (const count of [2, 5, 8, 12]) {
    for (let prize = 0; prize < count; prize += 1) {
      const offset = stripTarget(0, prize, count, PITCH);
      assert.equal(prizeUnderMark(offset, count, PITCH), prize, `приз ${prize} из ${count}`);
    }
  }
});

test("вторая прокрутка идёт вперёд, а не отматывает назад", () => {
  const first = stripTarget(0, 2, 8, PITCH);
  const second = stripTarget(first, 5, 8, PITCH);
  assert.ok(second > first, "лента поехала назад");
  // И проходит несколько полных наборов, иначе это не розыгрыш,
  // а сдвиг на одну карточку.
  assert.ok(second - first >= PITCH * 8 * 3, "слишком короткий проход");
});

test("повтор того же приза тоже даёт полноценный проход", () => {
  // Самый неудобный случай: сервер дважды подряд выдал один и тот же приз.
  // Наивная реализация оставила бы ленту на месте.
  const first = stripTarget(0, 3, 8, PITCH);
  const second = stripTarget(first, 3, 8, PITCH);
  assert.ok(second - first >= PITCH * 8 * 3, "лента не сдвинулась при повторе приза");
  assert.equal(prizeUnderMark(second, 8, PITCH), 3);
});

test("посадка остаётся верной после многих прокруток", () => {
  let offset = 0;
  for (let i = 0; i < 50; i += 1) {
    const prize = (i * 3) % 7;
    offset = stripTarget(offset, prize, 7, PITCH);
    assert.equal(prizeUnderMark(offset, 7, PITCH), prize, `прокрутка ${i + 1}`);
  }
});

test("набор из двух призов — тоже рабочий случай", () => {
  // Минимум, который допускает сервер: два сектора.
  const offset = stripTarget(0, 1, 2, PITCH);
  assert.equal(prizeUnderMark(offset, 2, PITCH), 1);
});

/* ── Размер холста ─────────────────────────────────────────── */

test("буфер холста повторяет его размер на экране", () => {
  // Ровно та ошибка, что была на круге: размер буфера по умолчанию 300x150,
  // проверка шла по одной ширине, она совпадала с нужной — и высота
  // оставалась 150. Картинка рисовалась обрезанной, при этом типы, сборка
  // и тесты были зелёными.
  const canvas = { width: 300, height: 150, clientWidth: 300, clientHeight: 168 };
  assert.equal(fitCanvas(canvas, 1), true);
  assert.equal(canvas.width, 300);
  assert.equal(canvas.height, 168);
});

test("плотность пикселей увеличивает буфер", () => {
  const canvas = { width: 0, height: 0, clientWidth: 600, clientHeight: 168 };
  fitCanvas(canvas, 2);
  assert.equal(canvas.width, 1200);
  assert.equal(canvas.height, 336);
});

test("повторный вызов ничего не трогает", () => {
  // Присваивание размера очищает холст, поэтому лишнее — это мигание
  // на каждом кадре.
  const canvas = { width: 600, height: 168, clientWidth: 600, clientHeight: 168 };
  assert.equal(fitCanvas(canvas, 1), false);
});
