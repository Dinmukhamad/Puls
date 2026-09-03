import type { Grade, GradeId, Operator, PayoutRow, ScoreBreakdown, Team } from '../types';

/**
 * Расчётное ядро. Формула живёт здесь и больше нигде: как только её можно
 * посчитать в двух местах, через месяц она посчитана по-разному, и
 * ведомость перестаёт сходиться с тем, что видит оператор.
 *
 *   Итоговые баллы = качество × 0.4
 *                  + КВЗ      × 0.3
 *                  + часы     × 0.3
 *                  − штрафные минуты × коэффициент
 *
 * Веса вынесены в константы, потому что они предмет договорённости, а не
 * деталь реализации: их меняют, и менять их нужно в одном месте.
 */
export const WEIGHTS = {
  quality: 0.4,
  density: 0.3,
  hours: 0.3,
  penalty: 0.5,
} as const;

/** Порог качества, ниже которого оператор попадает в красную зону. */
export const QUALITY_RED_LINE = 88;

/** Сколько баллов стоит один коин до применения множителя квалификации. */
export const POINTS_PER_COIN = 2;

export function scoreOf(operator: Operator): ScoreBreakdown {
  const { quality, density, hours, penaltyMinutes } = operator.metrics;
  const qualityPart = round2(quality * WEIGHTS.quality);
  const densityPart = round2(density * WEIGHTS.density);
  const hoursPart = round2(hours * WEIGHTS.hours);
  const penaltyPart = round2(penaltyMinutes * WEIGHTS.penalty);
  return {
    qualityPart,
    densityPart,
    hoursPart,
    penaltyPart,
    total: round2(qualityPart + densityPart + hoursPart - penaltyPart),
  };
}

/**
 * Коины за период. Множитель квалификации применяется к результату, а не
 * к баллам: баллы сравнивают людей между собой и должны оставаться
 * сопоставимыми, а квалификация влияет на вознаграждение.
 *
 * Отрицательный итог обнуляется — уводить оператора в минус за период
 * нельзя, это удержание, а не начисление.
 */
export function coinsFor(operator: Operator, grade: Grade): number {
  const points = scoreOf(operator).total;
  if (points <= 0) return 0;
  return Math.round((points / POINTS_PER_COIN) * grade.multiplier);
}

export function isInRedZone(operator: Operator): boolean {
  return operator.metrics.quality < QUALITY_RED_LINE;
}

/**
 * Средняя оценка команды взвешивается по числу проверенных звонков:
 * иначе человек с тремя проверками весит столько же, сколько с тремя
 * сотнями, и среднее перестаёт что-либо значить.
 */
export function teamQuality(members: Operator[]): number | null {
  const audited = members.reduce((sum, o) => sum + o.metrics.auditedCalls, 0);
  if (audited === 0) return null;
  const weighted = members.reduce(
    (sum, o) => sum + o.metrics.quality * o.metrics.auditedCalls,
    0,
  );
  return round2(weighted / audited);
}

export function averageOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

export function buildPayout(
  operators: Operator[],
  grades: Record<GradeId, Grade>,
  teams: Record<TeamId_, Team>,
): PayoutRow[] {
  return operators.map((operator) => {
    const grade = grades[operator.gradeId];
    return {
      operatorId: operator.id,
      name: operator.name,
      team: teams[operator.teamId].name,
      grade: grade.name,
      multiplier: grade.multiplier,
      breakdown: scoreOf(operator),
      coins: coinsFor(operator, grade),
    };
  });
}

type TeamId_ = Team['id'];

/**
 * Ведомость в CSV. Разделитель — точка с запятой, а десятичный знак —
 * запятая: Excel в русской локали иначе разносит числа по столбцам как
 * текст. BOM в начале нужен ему же, чтобы не сломать кириллицу.
 */
export function payoutToCsv(rows: PayoutRow[], period: string): string {
  const header = [
    'Период',
    'Оператор',
    'Команда',
    'Квалификация',
    'Множитель',
    'Качество × 0.4',
    'КВЗ × 0.3',
    'Часы × 0.3',
    'Штрафы',
    'Итоговые баллы',
    'Коины к начислению',
  ];
  const body = rows.map((r) => [
    period,
    r.name,
    r.team,
    r.grade,
    fmtCsvNumber(r.multiplier),
    fmtCsvNumber(r.breakdown.qualityPart),
    fmtCsvNumber(r.breakdown.densityPart),
    fmtCsvNumber(r.breakdown.hoursPart),
    fmtCsvNumber(-r.breakdown.penaltyPart),
    fmtCsvNumber(r.breakdown.total),
    String(r.coins),
  ]);
  const lines = [header, ...body].map((cells) =>
    cells.map((c) => (c.includes(';') ? `"${c}"` : c)).join(';'),
  );
  return '﻿' + lines.join('\r\n');
}

function fmtCsvNumber(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
