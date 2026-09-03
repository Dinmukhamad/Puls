/**
 * Форматирование чисел. Одно место на всё приложение — иначе баланс в
 * шапке и баланс в кабинете начинают выглядеть по-разному, и пользователь
 * решает, что это разные числа.
 */

/** Узкий неразрывный пробел: разряды не разъезжаются при переносе. */
const THIN = ' ';

export function fmtNumber(value: number, digits = 0): string {
  return value
    .toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    .replace(/ /g, THIN);
}

/** Сумма в коинах. Знак ставится перед числом, а не после. */
export function fmtCoins(value: number, withSign = false): string {
  const sign = value < 0 ? '−' : withSign && value > 0 ? '+' : '';
  return `${sign}${fmtNumber(Math.abs(value))}`;
}

export function fmtPercent(value: number, digits = 1): string {
  return `${fmtNumber(value, digits)}%`;
}

/** Отсутствие данных — прочерк, а не ноль: это разные утверждения. */
export function orDash(value: number | null | undefined, format: (v: number) => string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return format(value);
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${fmtTime(iso)}`;
}

export function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
