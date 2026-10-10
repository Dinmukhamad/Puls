import type { Definition, DefinitionKind, FieldValue } from "../api/configuration";
import { coinsWithUnit, points, plural } from "../utils/format";

export interface DefinitionFact { label: string; value: string }
export interface DefinitionPresentation { description: string; facts: DefinitionFact[] }

const preciseNumber = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 20 });
const defaultPenaltyDescription = "Штраф снижает итоговый балл до перевода в коины.";

function numeric(value: FieldValue | undefined, fallback = 0): number {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: FieldValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Unlike a score, a configured target may use more than two decimal places. */
function quantity(value: number): string {
  return Math.round(value * 100) / 100 === value ? points(value) : preciseNumber.format(value);
}

function measured(value: number, unit: string): string {
  return `${quantity(value)}${unit ? ` ${unit}` : ""}`;
}

function score(value: number): string {
  return `${quantity(value)} ${plural(value, "балл", "балла", "баллов")}`;
}

function metricName(code: string, metrics: readonly Definition[]): string {
  if (code === "__progress__") return "Прирост баллов к прошлой неделе";
  return metrics.find((metric) => metric.code === code)?.title.trim() || "Показатель недоступен";
}

function metricUnit(code: string, metrics: readonly Definition[]): string {
  return code === "__progress__" ? "баллов" : text(metrics.find((metric) => metric.code === code)?.unit);
}

function weeks(value: number): string {
  return `${quantity(value)} ${plural(value, "неделю", "недели", "недель")} подряд`;
}

function badgeCondition(row: Definition, metrics: readonly Definition[]): { condition: string; hint: string } {
  const params = typeof row.rule_params === "object" && row.rule_params ? row.rule_params : {};
  const rule = text(row.rule_type);
  if (rule === "top_rank") return {
    condition: `Войти в топ-${quantity(numeric(params.max_rank, 3))} рейтинга`,
    hint: "Учитывается лучшее место оператора в рейтинге закрытых недель.",
  };
  if (rule === "learning_count") {
    const count = numeric(params.gte, 3);
    return {
      condition: `Пройти ${quantity(count)} ${plural(count, "разное учебное задание", "разных учебных задания", "разных учебных заданий")}`,
      hint: "Учитываются разные успешно пройденные учебные задания.",
    };
  }
  if (rule === "total_earned") return {
    condition: `Заработать ${coinsWithUnit(numeric(params.gte, 100))} за всё время`,
    hint: "Учитывается общий заработок коинов, а не текущий баланс кошелька.",
  };
  if (rule === "nomination_count") {
    const count = numeric(params.gte, 1);
    return {
      condition: `Получить ${quantity(count)} ${plural(count, "номинацию", "номинации", "номинаций")}`,
      hint: "Учитываются выигранные номинации в закрытых неделях.",
    };
  }
  if (["zero_metric_streak", "metric_threshold_streak", "metric_total"].includes(rule)) {
    const code = text(params.metric) || (rule === "zero_metric_streak" ? "lateness" : rule === "metric_threshold_streak" ? "quality" : "driver_gratitudes");
    const name = metricName(code, metrics);
    if (rule === "metric_total") return {
      condition: `${name}: накопить ${measured(numeric(params.gte, 1), metricUnit(code, metrics))}`,
      hint: "Учитывается сумма подтверждённых значений показателя за закрытые недели.",
    };
    const streak = weeks(numeric(params.weeks, rule === "zero_metric_streak" ? 3 : 1));
    return {
      condition: `${name}: ${rule === "zero_metric_streak" ? "0" : `не ниже ${measured(numeric(params.gte), metricUnit(code, metrics))}`} · ${streak}`,
      hint: "Учитываются подряд закрытые недели с подтверждёнными данными показателя. Отсутствие данных прерывает серию.",
    };
  }
  return { condition: "Настроенное условие достижения", hint: "Достижение открывается после выполнения настроенного условия." };
}

/** Business wording only: internal codes are used to resolve names and never rendered. */
export function definitionPresentation(kind: DefinitionKind, row: Definition, metrics: readonly Definition[] = []): DefinitionPresentation {
  const description = text(row.description);
  if (kind === "metrics") {
    if (row.kind === "anti") return {
      description: !description || description === "Антипоказатель: снижает итоговый балл до перевода в коины"
        ? defaultPenaltyDescription : description,
      facts: [
        { label: "Штраф", value: score(numeric(row.penalty_per_unit)) },
        { label: "За каждую", value: text(row.unit) ? `1 ${text(row.unit)}` : "Единицу показателя" },
        { label: "Применение", value: "До перевода баллов в коины" },
      ],
    };
    return {
      description: description || "Баллы начисляются по степени выполнения цели показателя.",
      facts: [
        { label: "Цель", value: measured(numeric(row.target_value), text(row.unit)) },
        { label: "Баллы за цель", value: score(numeric(row.max_points)) },
        { label: "Расчёт", value: `${row.direction === "lower_is_better" ? "Меньше — лучше" : "Больше — лучше"}${row.allow_overachievement ? " · перевыполнение разрешено" : ""}` },
      ],
    };
  }
  if (kind === "nominations") {
    const code = text(row.metric_code);
    const selection = row.require_zero
      ? "Нулевое значение; максимум итоговых баллов"
      : row.direction === "lower_is_better" ? "Минимальное значение" : "Максимальное значение";
    const eligibility = row.min_value == null ? "" : `; участие от ${measured(numeric(row.min_value), metricUnit(code, metrics))}`;
    return {
      description: description || (row.require_zero
        ? "Среди операторов с нулевым значением показателя побеждает лучший по итоговым баллам недели."
        : code === "__progress__"
          ? "Сравнивается прирост итогового балла к прошлой неделе. Для участия нужен результат прошлой недели."
          : "Сравниваются результаты операторов по выбранному показателю. При равенстве побеждает лучший по итоговым баллам недели."),
      facts: [
        { label: "Награда", value: numeric(row.coins_reward) > 0 ? coinsWithUnit(numeric(row.coins_reward)) : "Без начисления коинов" },
        { label: "Показатель", value: metricName(code, metrics) },
        { label: "Условие победы", value: `${selection}${eligibility}` },
      ],
    };
  }
  const condition = badgeCondition(row, metrics);
  const reward = numeric(row.coins_reward);
  return {
    description: description || condition.hint,
    facts: [
      { label: "Условие", value: condition.condition },
      { label: "Награда", value: reward > 0 ? `${coinsWithUnit(reward)} при первом получении` : "Без дополнительного начисления коинов" },
      { label: "Получение", value: row.is_repeatable ? "Можно получать повторно" : "Один раз" },
    ],
  };
}
