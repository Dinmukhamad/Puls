/**
 * Единственный источник типов приложения.
 *
 * Правило, которое стоит держать в голове при правках: типы описывают
 * предметную область, а не форму компонентов. Если поле нужно только для
 * отрисовки, ему здесь не место — оно выводится из данных.
 */

/* ── Роли и период ───────────────────────────────────────── */

export type Role = 'operator' | 'manager';

/** Период закрывается вручную, поэтому у него ровно два состояния. */
export type PeriodStatus = 'draft' | 'calculated';

export type ThemeMode = 'dark' | 'light';

/* ── Квалификация ────────────────────────────────────────── */

/**
 * Ступень квалификации. Множитель применяется к коинам, а не к баллам:
 * баллы — это измерение работы и должны сравниваться между людьми
 * напрямую, а квалификация влияет на вознаграждение.
 */
export interface Grade {
  id: GradeId;
  name: string;
  multiplier: number;
  minQuality: number;
  minDensity: number;
  description: string;
}

export type GradeId = 'trainee' | 'junior' | 'operator' | 'pro';

/* ── Операторы ───────────────────────────────────────────── */

export type TeamId = 'alpha' | 'beta' | 'gamma' | 'delta';

export interface Team {
  id: TeamId;
  name: string;
  lead: string;
}

/** Сырые показатели за период — то, что приходит из АТС и ОКК. */
export interface OperatorMetrics {
  /** Средняя оценка речи по проверенным звонкам, %. */
  quality: number;
  /** КВЗ: звонков на час на линии. */
  density: number;
  /** Часы на линии за период. */
  hours: number;
  /** Минуты нарушений дисциплины. */
  penaltyMinutes: number;
  /** Количество проверенных звонков — вес оценки качества. */
  auditedCalls: number;
}

export interface Operator {
  id: string;
  name: string;
  teamId: TeamId;
  gradeId: GradeId;
  metrics: OperatorMetrics;
  coins: number;
  tickets: number;
  hiredWeeksAgo: number;
}

/* ── Расчёт ──────────────────────────────────────────────── */

/** Разложение итогового балла по вкладу каждой составляющей. */
export interface ScoreBreakdown {
  qualityPart: number;
  densityPart: number;
  hoursPart: number;
  penaltyPart: number;
  total: number;
}

export interface PayoutRow {
  operatorId: string;
  name: string;
  team: string;
  grade: string;
  multiplier: number;
  breakdown: ScoreBreakdown;
  coins: number;
}

/* ── Миссии ──────────────────────────────────────────────── */

export type MissionStepKind = 'quality' | 'density' | 'test' | 'shift' | 'manual';

export interface MissionStep {
  id: string;
  label: string;
  kind: MissionStepKind;
  /** Текущее значение и порог: прогресс показывается их отношением. */
  current: number;
  target: number;
  unit: string;
}

export type MissionState = 'locked' | 'active' | 'ready' | 'claimed';

export interface Mission {
  id: string;
  chapterId: string;
  title: string;
  summary: string;
  category: string;
  deadlineHours: number | null;
  steps: MissionStep[];
  rewardCoins: number;
  rewardTickets: number;
  state: MissionState;
}

export interface Chapter {
  id: string;
  title: string;
  subtitle: string;
}

/* ── Тесты ───────────────────────────────────────────────── */

export interface TestOption {
  id: string;
  text: string;
}

export interface TestQuestion {
  id: string;
  text: string;
  options: TestOption[];
  correctOptionId: string;
}

export interface KnowledgeTest {
  id: string;
  title: string;
  topic: string;
  minutes: number;
  passPercent: number;
  rewardCoins: number;
  rewardTickets: number;
  questions: TestQuestion[];
  /** null — ещё не проходили; число — последний результат в процентах. */
  lastScore: number | null;
}

/* ── Колесо ──────────────────────────────────────────────── */

export type WheelPrizeKind = 'coins' | 'ticket' | 'spin' | 'nothing';

export interface WheelSector {
  id: string;
  label: string;
  kind: WheelPrizeKind;
  amount: number;
  /** Вес в жеребьёвке. Сумма весов не обязана давать сто. */
  weight: number;
}

export interface SpinRecord {
  id: string;
  at: string;
  label: string;
  kind: WheelPrizeKind;
  amount: number;
}

/* ── Розыгрыши ───────────────────────────────────────────── */

export interface Raffle {
  id: string;
  title: string;
  prize: string;
  season: string;
  endsIn: string;
  totalTickets: number;
  myTickets: number;
  participants: number;
}

/* ── Магазин ─────────────────────────────────────────────── */

export type ShopCategory = 'schedule' | 'merch' | 'certificate';

export interface ShopItem {
  id: string;
  title: string;
  description: string;
  category: ShopCategory;
  price: number;
  stock: number | null;
}

/* ── Транзакции ──────────────────────────────────────────── */

export type LedgerSource = 'period' | 'mission' | 'wheel' | 'shop' | 'bonus' | 'test' | 'raffle';

export interface LedgerEntry {
  id: string;
  at: string;
  operatorId: string;
  operatorName: string;
  source: LedgerSource;
  /** Отрицательное значение — списание. Знак несёт смысл, а не цвет. */
  amount: number;
  comment: string;
}

/* ── Уведомления ─────────────────────────────────────────── */

export interface AppNotification {
  id: string;
  at: string;
  title: string;
  detail: string;
  read: boolean;
}

/* ── Аналитика ───────────────────────────────────────────── */

export interface WeeklyPoint {
  week: string;
  quality: number;
  density: number;
  penalties: number;
}

export interface HourlyLoad {
  hour: string;
  calls: number;
}

/* ── Сессии ──────────────────────────────────────────────── */

export interface DeviceSession {
  id: string;
  operatorName: string;
  device: string;
  ip: string;
  location: string;
  lastSeen: string;
  current: boolean;
}

/* ── Навигация ───────────────────────────────────────────── */

export type ViewId =
  | 'summary'
  | 'cabinet'
  | 'rating'
  | 'missions'
  | 'tests'
  | 'wheel'
  | 'raffles'
  | 'shop'
  | 'staff'
  | 'grades'
  | 'teams'
  | 'coins'
  | 'analytics'
  | 'period'
  | 'sessions';

export interface NavItem {
  id: ViewId;
  label: string;
  hint: string;
  managerOnly: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}
