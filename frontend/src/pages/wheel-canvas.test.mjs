/**
 * Физика колеса WOW.
 *
 * Прежде колесо было CSS-диском с одним переходом между двумя углами: оно
 * не разгонялось и не выбегало, просто доезжало. Теперь вращение считается
 * покадрово, и появились два места, где легко ошибиться незаметно:
 *
 *   · профиль скорости — если она ненулевая на концах, колесо дёргается на
 *     старте и обрывается на финише;
 *   · целевой угол — приз выбирает сервер, и клиент обязан остановиться
 *     ровно на его секторе. Промах здесь означал бы, что человек видит
 *     один результат, а получает другой.
 *
 * Обе функции чистые и вынесены из компонента именно ради этой проверки.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("./WheelCanvas.tsx", import.meta.url), "utf8");
// Компонент тянет React; чистые функции лежат до него, их и берём.
const head = source.slice(0, source.indexOf("export function WheelCanvas"));
const built = await transform(head.replace(/^import[\s\S]*?;$/gm, ""), { loader: "tsx", format: "esm" });
const { spinProgress, targetAngle, fitCanvas } = await import(
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

test("колесо не едет назад", () => {
  let previous = 0;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const value = spinProgress(t);
    assert.ok(value >= previous - 1e-12, `на t=${t.toFixed(2)} путь уменьшился`);
    previous = value;
  }
});

test("скорость нулевая на обоих концах", () => {
  // Именно это отличает живое вращение от поворота картинки: колесо
  // трогается с места и останавливается, а не возникает в движении.
  const h = 1e-4;
  const atStart = (spinProgress(h) - spinProgress(0)) / h;
  const atEnd = (spinProgress(1) - spinProgress(1 - h)) / h;
  assert.ok(atStart < 0.05, `на старте скорость ${atStart.toFixed(3)}, ожидался покой`);
  assert.ok(atEnd < 0.05, `на финише скорость ${atEnd.toFixed(3)}, ожидался покой`);
});

test("сначала разгон, потом выбег", () => {
  const speed = (t) => (spinProgress(t + 1e-4) - spinProgress(t - 1e-4)) / 2e-4;
  const early = speed(0.1);
  const peak = speed(0.22);
  const late = speed(0.8);
  assert.ok(early < peak, "скорость не растёт на разгоне");
  assert.ok(late < peak, "скорость не падает на выбеге");
  // Выбег длиннее разгона: так вращение читается как инерция, а не как
  // симметричное туда-обратно.
  assert.ok(speed(0.5) > speed(0.9), "торможение не растянуто");
});

test("ветви профиля стыкуются без перелома", () => {
  // Разгон и выбег — разные формулы. Если они сходятся только по значению,
  // на стыке будет заметный рывок.
  const at = 0.22;
  const left = (spinProgress(at) - spinProgress(at - 1e-5)) / 1e-5;
  const right = (spinProgress(at + 1e-5) - spinProgress(at)) / 1e-5;
  assert.ok(Math.abs(left - right) < 0.01, `перелом скорости: ${left.toFixed(3)} против ${right.toFixed(3)}`);
});

/* ── Целевой угол ──────────────────────────────────────────── */

const under = (angle, count) => {
  // Какой сектор оказался под стрелкой: стрелка сверху, сектор i занимает
  // [i·360/n, (i+1)·360/n] по часовой стрелке от неё.
  const normalized = ((-angle % 360) + 360) % 360;
  return Math.floor(normalized / (360 / count));
};

test("колесо останавливается ровно на секторе, который выбрал сервер", () => {
  for (const count of [6, 8, 12]) {
    for (let segment = 0; segment < count; segment += 1) {
      const angle = targetAngle(0, segment, count);
      assert.equal(under(angle, count), segment, `сектор ${segment} из ${count}`);
    }
  }
});

test("остановка приходится на середину сектора, а не на его край", () => {
  // На границе достаточно ошибки в доли градуса, чтобы стрелка показала
  // соседний сектор.
  const count = 8;
  const angle = targetAngle(0, 3, count);
  const normalized = ((-angle % 360) + 360) % 360;
  const step = 360 / count;
  const offset = normalized - 3 * step;
  assert.ok(Math.abs(offset - step / 2) < 1e-9, `смещение ${offset.toFixed(2)}° вместо середины ${step / 2}°`);
});

test("вторая прокрутка идёт вперёд, а не отматывает назад", () => {
  const first = targetAngle(0, 2, 8);
  const second = targetAngle(first, 5, 8);
  assert.ok(second > first, "колесо поехало назад");
  // И делает хотя бы несколько полных оборотов, иначе это не вращение,
  // а доворот на пару градусов.
  assert.ok(second - first >= 360 * 3, `всего ${((second - first) / 360).toFixed(1)} оборота`);
});

test("угол остаётся верным после многих прокруток", () => {
  // Угол накапливается и никогда не сбрасывается; проверяем, что арифметика
  // не уплывает после долгой сессии.
  let angle = 0;
  for (let i = 0; i < 50; i += 1) {
    const segment = i % 8;
    angle = targetAngle(angle, segment, 8);
    assert.equal(under(angle, 8), segment, `прокрутка ${i + 1}`);
  }
});

/* ── Размер холста ─────────────────────────────────────────── */

test("буфер холста квадратный даже при стандартной высоте 150", () => {
  // Ровно та ошибка, что была: у холста размер буфера по умолчанию 300x150.
  // Проверка шла по одной ширине, она совпадала с нужной, присваивание не
  // выполнялось — и низ круга обрезался. Типы, сборка и тесты при этом
  // оставались зелёными, увидеть это можно было только глазами.
  const canvas = { width: 300, height: 150, clientWidth: 300 };
  assert.equal(fitCanvas(canvas, 1), true);
  assert.equal(canvas.width, 300);
  assert.equal(canvas.height, 300);
});

test("плотность пикселей увеличивает буфер, но не растягивает его", () => {
  const canvas = { width: 300, height: 150, clientWidth: 320 };
  fitCanvas(canvas, 2);
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 640);
});

test("повторный вызов ничего не трогает", () => {
  // Присваивание размера очищает холст, поэтому лишнее — это мигание
  // на каждом кадре анимации.
  const canvas = { width: 400, height: 400, clientWidth: 400 };
  assert.equal(fitCanvas(canvas, 1), false);
});
