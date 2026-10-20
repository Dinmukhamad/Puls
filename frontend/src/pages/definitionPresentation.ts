import type { Definition, DefinitionKind, DefinitionValue, MetricBand } from "../api/configuration";
import { coinsWithUnit, points, plural } from "../utils/format";

export interface DefinitionFact { label: string; value: string }
export interface DefinitionPresentation { description: string; facts: DefinitionFact[] }

const preciseNumber = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 20 });
const defaultPenaltyDescription = "Штраф снижает итоговый балл до перевода в коины.";

function numeric(value: DefinitionValue | undefined, fallback = 0): number {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: DefinitionValue | undefined): string {
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
  const params = typeof row.rule_params === "object" && row.rule_params && !Array.isArray(row.rule_params) ? row.rule_params : {};
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

/** «Линия», «Чаты», «Общий»: whose points a metric gives (docs/CHANNELS.md). */
export const METRIC_CHANNELS: Record<string, string> = { line: "Линия", chat: "Чаты", all: "Общий для линии и чатов" };
/** Among whom a nomination is played (docs/CHANNELS.md). */
export const NOMINATION_CHANNELS: Record<string, string> = { line: "Операторы линии", chat: "Операторы чатов", all: "Все операторы" };

function percent(share: number): string {
  return `${quantity(Math.round(share * 1000) / 10)} %`;
}

/** A metric's thresholds, lowest first; none for a metric scored by its target. */
export function bandsOf(row: Definition): MetricBand[] {
  return Array.isArray(row.bands) ? [...row.bands].sort((a, b) => a.from - b.from) : [];
}

/** «от 80 % — 20 · от 86 % — 40»: the thresholds in words. */
export function bandsText(row: Definition): string {
  return bandsOf(row).map((band) => `от ${measured(band.from, text(row.unit))} — ${quantity(band.points)}`).join(" · ");
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
    const channel = { label: "Направление", value: METRIC_CHANNELS[text(row.channel) || "line"] ?? "Линия" };
    const base = text(row.bonus_for);
    if (base) return {
      description: description || "Бонус сверх 100 баллов, когда основной показатель выполнен.",
      facts: [
        { label: "Бонус к показателю", value: `${metricName(base, metrics)} — когда он выполнен на 100 %` },
        { label: "Максимум", value: `${score(numeric(row.max_points))} сверх 100 · ${percent(numeric(row.bonus_share, .4))} баллов показателя` },
        { label: "Полностью", value: `с ${measured(numeric(row.target_value), text(row.unit))}` },
        channel,
      ],
    };
    if (bandsOf(row).length) return {
      description: description || "Баллы по ступеням: значение от порога и выше даёт баллы этой ступени.",
      facts: [
        { label: "Ступени", value: bandsText(row) },
        { label: "Максимум", value: score(numeric(row.max_points)) },
        channel,
      ],
    };
    return {
      description: description || "Баллы начисляются по степени выполнения цели показателя.",
      facts: [
        { label: "Цель", value: measured(numeric(row.target_value), text(row.unit)) },
        { label: "Баллы за цель", value: score(numeric(row.max_points)) },
        { label: "Расчёт", value: `${row.direction === "lower_is_better" ? "Меньше — лучше" : "Больше — лучше"}${row.allow_overachievement ? " · перевыполнение разрешено" : ""}` },
        channel,
      ],
    };
  }
  if (kind === "nominations") {
    const code = text(row.metric_code);
    const selection = row.require_zero
      ? "Нулевое значение; максимум итоговых баллов"
      : row.direction === "lower_is_better" ? "Минимальное значение" : "Максимальное значение";
    const eligibility = row.min_value == null ? "" : `; участие от ${measured(numeric(row.min_value), metricUnit(code, metrics))}`;
    const among = NOMINATION_CHANNELS[text(row.channel)];
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
        ...(among && text(row.channel) !== "all" ? [{ label: "Среди кого", value: among }] : []),
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

export interface DefinitionRow { meta: string; value: string; hint: string; coin: boolean }

/**
 * One line of a list in «Показатели» and «Мотивация → Достижения» (docs/PERFORMANCE_SECTION.md): what it is under the
 * title, the number that matters on the right — a metric's target or fine, a nomination's or an achievement's reward.
 */
export function definitionRow(kind: DefinitionKind, row: Definition, metrics: readonly Definition[] = []): DefinitionRow {
  const description = text(row.description);
  if (kind === "metrics") {
    if (row.kind === "anti") {
      const penalty = numeric(row.penalty_per_unit);
      return {
        meta: description && description !== "Антипоказатель: снижает итоговый балл до перевода в коины" ? description : defaultPenaltyDescription,
        // A fine in coins is set in «Правила расчёта»; a zero here is no fine in points, not no fine at all.
        value: penalty > 0 ? `−${score(penalty)}` : "Без штрафа в баллах",
        hint: penalty > 0 ? `за каждую ${text(row.unit) ? `1 ${text(row.unit)}` : "единицу"}` : "штраф в коинах — в правилах расчёта",
        coin: false,
      };
    }
    if (text(row.bonus_for)) return {
      meta: description || `Бонус к «${metricName(text(row.bonus_for), metrics)}», когда он выполнен на 100 %`,
      value: `До +${score(numeric(row.max_points))}`,
      hint: `сверх 100, полностью с ${measured(numeric(row.target_value), text(row.unit))}`,
      coin: false,
    };
    if (bandsOf(row).length) return {
      meta: `Ступени: ${bandsText(row)}`,
      value: `До ${score(numeric(row.max_points))}`,
      hint: "по ступеням",
      coin: false,
    };
    return {
      meta: [row.direction === "lower_is_better" ? "Меньше — лучше" : "Больше — лучше", row.allow_overachievement ? "перевыполнение разрешено" : "", description].filter(Boolean).join(" · "),
      value: `Цель ${measured(numeric(row.target_value), text(row.unit))}`,
      // A metric without points is shown for analytics until the settings give it some.
      hint: numeric(row.max_points) > 0 ? `${score(numeric(row.max_points))} за цель` : "без баллов",
      coin: false,
    };
  }
  const facts = definitionPresentation(kind, row, metrics).facts;
  const reward = numeric(row.coins_reward);
  if (kind === "nominations") return {
    meta: [text(row.channel) && text(row.channel) !== "all" ? METRIC_CHANNELS[text(row.channel)] : "", facts[1].value, facts[2].value].filter(Boolean).join(" · "),
    value: reward > 0 ? coinsWithUnit(reward) : "Без коинов",
    hint: "победителю",
    coin: reward > 0,
  };
  return {
    meta: `${facts[0].value} · ${row.is_repeatable ? "можно получать повторно" : "один раз"}`,
    value: reward > 0 ? coinsWithUnit(reward) : "Без коинов",
    hint: reward > 0 ? "при первом получении" : "только достижение",
    coin: reward > 0,
  };
}

/** The seeded achievements name their icon in a word; an emoji written by an admin is shown as it is. */
const BADGE_ICONS: Record<string, string> = { star: "⭐", medal: "🏅", clock: "⏰", heart: "❤️", crown: "👑", trophy: "🏆", fire: "🔥", target: "🎯", book: "📚", rocket: "🚀", gift: "🎁", spark: "✨" };
export function badgeIcon(icon: DefinitionValue | undefined): string {
  const value = text(icon);
  if (!value) return "★";
  return BADGE_ICONS[value.toLowerCase()] ?? (/^[\x20-\x7e]+$/.test(value) ? "★" : value);
}
