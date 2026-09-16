/** Форматирование значений для интерфейса. Везде русская локаль. */

const numberFormat = new Intl.NumberFormat("ru-RU");

export function coins(value: number): string {
  return numberFormat.format(value);
}

/** Знак обязателен: цвет не должен быть единственным признаком направления. */
export function signed(value: number): string {
  return value > 0 ? `+${numberFormat.format(value)}` : numberFormat.format(value);
}

export function points(value: number | null | undefined): string {
  if (value == null) return "—";
  return numberFormat.format(Math.round(value * 100) / 100);
}

export function percent(fraction: number | null | undefined): string {
  if (fraction == null) return "—";
  return `${Math.round(fraction * 100)} %`;
}

/** API timestamps are UTC; SQLite may serialize them without a timezone suffix. */
export function parseTimestamp(iso: string): Date {
  return new Date(/T/.test(iso) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? `${iso}Z` : iso);
}

export function dateTime(iso: string): string {
  return parseTimestamp(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function periodLabel(start: string, end: string): string {
  const from = new Date(start).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
  const to = new Date(end).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
  return `${from} - ${to}`;
}

/** Склонение существительного: 1 коин, 2 коина, 5 коинов. */
export function plural(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function coinsWithUnit(value: number): string {
  return `${coins(value)} ${plural(value, "коин", "коина", "коинов")}`;
}

export const TX_LABELS: Record<string, string> = {
  weekly_points: "Итог недели",
  rank_bonus: "Призовое место",
  no_lateness_bonus: "Без опозданий",
  no_sites_bonus: "Без посторонних сайтов",
  nomination_bonus: "Номинация недели",
  driver_gratitude: "Благодарность водителя",
  manual_credit: "Ручное начисление",
  manual_debit: "Ручное списание",
  purchase: "Покупка в магазине",
  purchase_refund: "Возврат",
  correction: "Корректировка",
  learning_reward: "Обучение",
  achievement_reward: "Достижение",
  game_reward: "Игровая награда",
};

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  new: "Новая",
  approved: "Одобрена",
  rejected: "Отклонена",
  fulfilled: "Выполнена",
  cancelled: "Отозвана",
};

export const WEEK_STATUS_LABELS: Record<string, string> = {
  open: "Идёт",
  calculated: "Рассчитана",
  closed: "Закрыта",
};

export const ROLE_LABELS: Record<string, string> = {
  operator: "Оператор",
  trainer: "Тренер",
  supervisor: "Супервайзер",
  head: "Руководитель",
  admin: "Администратор",
};
