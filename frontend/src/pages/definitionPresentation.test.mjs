import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const built = await build({ entryPoints: [fileURLToPath(new URL("./definitionPresentation.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", write: false });
const { definitionPresentation } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const row = (extra = {}) => ({ id: 1274, code: "hidden_internal_code", title: "Название", description: null, is_active: true, sort_order: 100, ...extra });
const metrics = [row({ code: "quality", title: "Качество работы", unit: "%" }), row({ code: "lateness", title: "Опоздания", unit: "шт" }), row({ code: "driver_gratitudes", title: "Благодарности от водителей", unit: "шт" })];
const values = (data) => Object.fromEntries(data.facts.map((fact) => [fact.label, fact.value]));

test("positive indicators retain goals, points, direction and the configured overachievement option", () => {
  const card = definitionPresentation("metrics", row({ kind: "positive", unit: "%", target_value: 95, max_points: 25, direction: "lower_is_better", allow_overachievement: true }));
  assert.deepEqual(values(card), { "Цель": "95 %", "Баллы за цель": "25 баллов", "Расчёт": "Меньше — лучше · перевыполнение разрешено" });
  assert.equal(card.facts.length, 3);
  assert.doesNotMatch(JSON.stringify(card), /hidden_internal_code|1274|lower_is_better/);
});

test("penalties are described as points deducted before coin conversion, not coins debited", () => {
  const card = definitionPresentation("metrics", row({ kind: "anti", penalty_per_unit: 3, unit: "шт", target_value: 95, max_points: 25 }));
  assert.deepEqual(values(card), { "Штраф": "3 балла", "За каждую": "1 шт", "Применение": "До перевода баллов в коины" });
  assert.match(card.description, /снижает итоговый балл/);
  assert.doesNotMatch(JSON.stringify(card), /95|25|списание|списывает/);
});

test("stock penalty wording is simplified only in the presentation and custom descriptions remain intact", () => {
  const stock = row({ kind: "anti", description: "Антипоказатель: снижает итоговый балл до перевода в коины" });
  assert.equal(definitionPresentation("metrics", stock).description, "Штраф снижает итоговый балл до перевода в коины.");
  assert.equal(stock.description, "Антипоказатель: снижает итоговый балл до перевода в коины");
  const custom = row({ kind: "anti", description: "Антипоказатель: индивидуальное условие за каждые 15 минут опоздания." });
  assert.equal(definitionPresentation("metrics", custom).description, custom.description);
  const positive = { ...stock, kind: "positive" };
  assert.equal(definitionPresentation("metrics", positive).description, stock.description);
});

test("small configured targets and nomination thresholds are preserved without display rounding to zero", () => {
  assert.equal(values(definitionPresentation("metrics", row({ target_value: 0.000001, max_points: 1 }))).Цель, "0,000001");
  const card = definitionPresentation("nominations", row({ metric_code: "quality", min_value: 0.000001, coins_reward: 5 }), metrics);
  assert.match(values(card)["Условие победы"], /участие от 0,000001 %/);
});

test("zero nominations select the highest final score among zero values and retain eligibility thresholds", () => {
  const card = definitionPresentation("nominations", row({ metric_code: "lateness", require_zero: true, direction: "lower_is_better", min_value: 0, coins_reward: 5 }), metrics);
  assert.deepEqual(values(card), { "Награда": "5 коинов", "Показатель": "Опоздания", "Условие победы": "Нулевое значение; максимум итоговых баллов; участие от 0 шт" });
  assert.doesNotMatch(JSON.stringify(card), /Минимальное значение|lateness|hidden_internal_code/);
});

test("minimum and maximum nominations display direction independently of minimum eligibility", () => {
  for (const [direction, expected] of [["lower_is_better", "Минимальное значение"], ["higher_is_better", "Максимальное значение"]]) {
    const card = definitionPresentation("nominations", row({ metric_code: "quality", direction, min_value: 80, coins_reward: 1 }), metrics);
    assert.equal(values(card)["Условие победы"], `${expected}; участие от 80 %`);
    assert.equal(values(card).Награда, "1 коин");
  }
});

test("progress nominations use a human name and explain the need for the previous week's result", () => {
  const card = definitionPresentation("nominations", row({ metric_code: "__progress__", min_value: 0.01, coins_reward: 5 }), metrics);
  assert.equal(values(card).Показатель, "Прирост баллов к прошлой неделе");
  assert.match(card.description, /нужен результат прошлой недели/);
  assert.match(values(card)["Условие победы"], /0,01 баллов/);
  assert.doesNotMatch(JSON.stringify(card), /__progress__/);
});

test("badge streaks and accumulated values resolve the metric title and keep all numeric conditions", () => {
  const threshold = definitionPresentation("badges", row({ rule_type: "metric_threshold_streak", rule_params: { metric: "quality", gte: 95, weeks: 2 }, coins_reward: 75 }), metrics);
  assert.equal(values(threshold).Условие, "Качество работы: не ниже 95 % · 2 недели подряд");
  assert.match(threshold.description, /Отсутствие данных прерывает серию/);
  const zero = definitionPresentation("badges", row({ rule_type: "zero_metric_streak", rule_params: { metric: "lateness", weeks: 3 } }), metrics);
  assert.equal(values(zero).Условие, "Опоздания: 0 · 3 недели подряд");
  const total = definitionPresentation("badges", row({ rule_type: "metric_total", rule_params: { metric: "driver_gratitudes", gte: 20 } }), metrics);
  assert.equal(values(total).Условие, "Благодарности от водителей: накопить 20 шт");
  for (const card of [threshold, zero, total]) {
    assert.equal(card.facts.length, 3);
    assert.doesNotMatch(JSON.stringify(card), /hidden_internal_code|metric_threshold_streak|driver_gratitudes|lateness/);
  }
});

test("badge repetition never implies repeating the coin reward and zero rewards are stated honestly", () => {
  const card = definitionPresentation("badges", row({ rule_type: "learning_count", rule_params: { gte: 3 }, coins_reward: 50, is_repeatable: true }), metrics);
  assert.equal(values(card).Условие, "Пройти 3 разных учебных задания");
  assert.equal(values(card).Награда, "50 коинов при первом получении");
  assert.equal(values(card).Получение, "Можно получать повторно");
  const zero = definitionPresentation("badges", row({ rule_type: "top_rank", rule_params: { max_rank: 3 }, coins_reward: 0, is_repeatable: false }), metrics);
  assert.equal(values(zero).Награда, "Без дополнительного начисления коинов");
  assert.equal(values(zero).Получение, "Один раз");
});

test("missing descriptions receive useful hints and missing metric names never expose an internal code", () => {
  const nomination = definitionPresentation("nominations", row({ metric_code: "private_metric_code", coins_reward: 0 }), []);
  assert.equal(values(nomination).Показатель, "Показатель недоступен");
  assert.equal(values(nomination).Награда, "Без начисления коинов");
  assert.doesNotMatch(JSON.stringify(nomination), /private_metric_code/);
  assert.equal(definitionPresentation("metrics", row({ description: "  Авторское описание  " })).description, "Авторское описание");
});

test("rank, lifetime coins, nominations and learning badges keep their distinct configured conditions", () => {
  for (const [rule_type, rule_params, expected] of [
    ["top_rank", { max_rank: 5 }, "Войти в топ-5 рейтинга"],
    ["total_earned", { gte: 1000 }, "Заработать 1\u00a0000 коинов за всё время"],
    ["nomination_count", { gte: 5 }, "Получить 5 номинаций"],
    ["learning_count", { gte: 1 }, "Пройти 1 разное учебное задание"],
  ]) {
    const card = definitionPresentation("badges", row({ rule_type, rule_params }), metrics);
    assert.equal(values(card).Условие, expected);
    assert.equal(card.facts.length, 3);
  }
});
