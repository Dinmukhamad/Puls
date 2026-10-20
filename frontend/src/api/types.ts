/** Типы ответов API. Повторяют схемы Pydantic из бэкенда. */

export type Role = "trainee" | "operator" | "trainer" | "supervisor" | "head" | "admin";

export type WeekStatus = "open" | "calculated" | "closed";

export type ShopRequestStatus =
  | "new"
  | "approved"
  | "rejected"
  | "fulfilled"
  | "cancelled";

export type MetricKind = "positive" | "anti";

export type TxType =
  | "weekly_points"
  | "rank_bonus"
  | "no_lateness_bonus"
  | "no_sites_bonus"
  | "nomination_bonus"
  | "driver_gratitude"
  | "manual_credit"
  | "manual_debit"
  | "purchase"
  | "purchase_refund"
  | "correction"
  | "learning_reward"
  | "game_reward"
  | "achievement_reward"
  | "city_build"
  | "city_contribution"
  | "fine"
  | "game_stake";

export interface Token {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface GroupBrief {
  id: number;
  code: string;
  name: string;
}

/** Направление оператора: линия (звонки) или чаты — свои показатели и своё соревнование. */
export type Channel = "line" | "chat";

export interface UserOut {
  created_at?: string;
  can_manage_credentials?: boolean;
  phone: string | null;
  id: number;
  login: string;
  email: string | null;
  full_name: string;
  role: Role;
  is_active: boolean;
  is_developer: boolean;
  hired_on: string | null;
  /** Линия или чаты (docs/CHANNELS.md); у остальных ролей — линия. */
  channel?: Channel;
  group: GroupBrief | null;
  /** Фигура оператора в центре учебного города. */
  gender?: Gender | null;
  /** Имя, которое оператор дал помощнику вместо «Пульсар». */
  guide_name?: string | null;
  /** Как оператор двигает камеру в городе; null — ещё не выбрал, город спросит при входе. */
  city_controls?: CityControls | null;
  /** Подсказки Пульсара на рабочих сайтах, которые учётная запись уже видела. */
  tours_seen?: Partial<Record<string, "done" | "closed">> | null;
}

export type Gender = "male" | "female";
/** «orbit» — вращение: тянуть вращает, правая кнопка двигает. «map» — как карту: тянуть двигает, правая кнопка поворачивает. */
export type CityControls = "orbit" | "map";

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

/* --- кабинет --- */

export interface BalanceBlock {
  balance: number;
  reserved: number;
  available: number;
  earned_this_week: number;
  total_earned: number;
  total_spent: number;
  rank: number | null;
  participants: number;
  previous_rank: number | null;
  rank_delta: number | null;
}

export interface MetricProgress {
  code: string;
  title: string;
  unit: string | null;
  kind: MetricKind;
  value: number | null;
  target: number;
  completion: number | null;
  points: number;
  max_points: number;
  penalty: number;
  /** A bonus over the 100 points (overtime): the metric it builds on, and whether that one is met. */
  bonus_for?: string | null;
  unlocked?: boolean | null;
}

export interface WeekMetricsBlock {
  week_id: number | null;
  week_label: string | null;
  week_status: string | null;
  starts_on: string | null;
  ends_on: string | null;
  base_points: number;
  penalty_points: number;
  final_points: number;
  metrics: MetricProgress[];
  coins_from_points: number;
  coins_rank_bonus: number;
  coins_discipline_bonus: number;
  coins_nomination_bonus: number;
  coins_total: number;
  is_final: boolean;
}

export interface NominationBrief {
  code: string;
  title: string;
  coins_awarded: number;
}

export interface DashboardOut {
  user_id: number;
  full_name: string;
  group_name: string | null;
  balance: BalanceBlock;
  week: WeekMetricsBlock;
  badges_unlocked: number;
  badges_total: number;
  my_nominations: NominationBrief[];
  pending_shop_requests: number;
}

export interface TransactionOut {
  id: number;
  amount: number;
  tx_type: TxType;
  reason: string;
  balance_after: number;
  created_at: string;
  week_id: number | null;
  shop_request_id: number | null;
  author_name: string | null;
}

export interface BadgeOut {
  coins_reward: number; coins_awarded: number; category: "level" | "work"; action_url: string | null;
  code: string;
  title: string;
  description: string | null;
  icon: string | null;
  unlocked: boolean;
  awarded_at: string | null;
  progress_current: number;
  progress_target: number;
  progress_percent: number;
  hint: string;
}

/* --- рейтинг --- */

export interface WeekOut {
  id: number;
  iso_year: number;
  iso_week: number;
  label: string;
  title: string;
  starts_on: string;
  ends_on: string;
  status: WeekStatus;
  calculated_at: string | null;
  closed_at: string | null;
}

export interface RatingRowOut {
  rank: number | null;
  user_id: number;
  full_name: string;
  group_name: string | null;
  points: number;
  coins_week: number;
  balance: number | null;
  rank_delta: number | null;
  is_me: boolean;
}

export interface PodiumEntry extends RatingRowOut {
  medal: string;
}

export interface NominationOut {
  code: string;
  title: string;
  description: string | null;
  winner_id: number | null;
  winner_name: string | null;
  winner_group: string | null;
  value: number;
  coins_awarded: number;
  winner_hidden: boolean;
}

export interface RatingHeader {
  contest_title: string;
  week_id: number;
  week_label: string;
  period_start: string;
  period_end: string;
  status: WeekStatus;
  participants: number;
  updated_at: string | null;
}

export interface RatingOut {
  header: RatingHeader;
  podium: PodiumEntry[];
  nominations: NominationOut[];
  rows: RatingRowOut[];
  total: number;
  page: number;
  size: number;
  my_row: RatingRowOut | null;
  view_mode: "personal" | "table";
  my_gap_to_podium: number | null;
  my_podium_state: "uncalculated" | "not_participating" | "on_podium" | "outside_podium";
}

/* --- «Гонка недели» (GET /rating/race) --- */

/** An operator in the week's race; the others are named «Имя Ф.». gap = their points − mine. */
export interface RacePlace {
  rank: number;
  name: string;
  points: number;
  gap: number | null;
  rank_delta: number | null;
  is_me: boolean;
}

export interface RaceMetric {
  code: string;
  title: string;
  unit: string | null;
  direction: string;
  value: number | null;
  target: number;
  points: number;
  max_points: number;
  /** Points the metric still lacks to its maximum. */
  lost: number;
  reported: boolean;
  /** Points one unit more brings, for "more is better" metrics up to the target. */
  per_unit: number | null;
  /** Thresholds instead of a share of the target (docs/CHANNELS.md): from each value up, its points. */
  bands?: { from: number; points: number }[] | null;
  /** A bonus over the 100 points (overtime); locked until the metric it builds on is met. */
  bonus?: boolean;
  locked?: boolean;
}

/** Raising one metric: the value to show and the points it really adds. */
export interface RaceOption {
  code: string;
  title: string;
  unit: string | null;
  value: number | null;
  need: number;
  gain: number;
}

export interface RacePlan {
  reachable: boolean;
  steps: RaceOption[];
  gain: number;
}

export interface RaceOut {
  week: { id: number; label: string; starts_on: string; ends_on: string; status: WeekStatus } | null;
  /** The week is not calculated: the places come from the metrics loaded so far. */
  live: boolean;
  /** "month": prizes once a month; "week": the week's places pay `prizes`. */
  period: string;
  prizes: number[];
  participants: number;
  /** The week's 100 points; bonuses (overtime) come on top, up to `bonus_max`. */
  max_points: number;
  bonus_max?: number;
  me: { rank: number; points: number; rank_delta: number | null; shared_with: string[] } | null;
  next: RacePlace | null;
  behind: (RacePlace & { lead: number }) | null;
  podium: { place: number; name: string; points: number; gap: number | null; reached: boolean }[];
  standings: RacePlace[];
  metrics: RaceMetric[];
  advice: {
    room: number;
    next: { rank: number; name: string; gap: number; options: RaceOption[]; plan: RacePlan } | null;
    podium: { place: number; name: string; gap: number; plan: RacePlan } | null;
  } | null;
}

/* --- магазин --- */

export interface ShopItemOut {
  id: number;
  code: string;
  title: string;
  description: string | null;
  price: number;
  is_active: boolean;
  stock_limit: number | null;
  per_user_monthly_limit: number | null;
  /** Pieces for everyone in a calendar month; null — no limit. */
  monthly_stock?: number | null;
  /** What the bonus costs the company in tenge; it counts against the shop's monthly budget. */
  cost_tenge?: number | null;
  requires_approval: boolean;
  sort_order: number;
}

export interface ShopItemForOperator extends ShopItemOut {
  can_buy: boolean;
  missing_coins: number;
  blocked_reason: string | null;
  /** Pieces left this month; null — no monthly limit. */
  month_left?: number | null;
}

export interface ShopCatalogOut {
  balance: number;
  available: number;
  items: ShopItemForOperator[];
}

export interface UserBrief {
  id: number;
  full_name: string;
  group: GroupBrief | null;
}

export interface ShopRequestOut {
  id: number;
  status: ShopRequestStatus;
  price: number;
  comment: string | null;
  decision_comment: string | null;
  created_at: string;
  decided_at: string | null;
  fulfilled_at: string | null;
  item: ShopItemOut;
  user: UserBrief | null;
  decided_by: UserBrief | null;
}

/* --- админ-панель --- */

export interface SummaryOut {
  operators_total: number;
  operators_active: number;
  coins_awarded_this_week: number;
  new_shop_requests: number;
  average_rank: number | null;
  week_label: string | null;
  week_status: string | null;
  date_from?: string | null;
  date_to?: string | null;
  coins_awarded_in_period?: number | null;
  scored_weeks_count?: number;
  metrics_available?: boolean;
}

export interface OperatorRowOut {
  user_id: number;
  full_name: string;
  login: string;
  group_name: string | null;
  rank: number | null;
  points: number;
  coins_week: number;
  balance: number;
  reserved: number;
  total_earned: number;
  total_spent: number;
  lateness: number;
  forbidden_sites: number;
  metrics_available?: boolean;
  scored_weeks_count?: number;
  /** Линия или чаты: место считается внутри направления (docs/CHANNELS.md). */
  channel?: Channel;
}

/** Тело ошибки, которое возвращает бэкенд для доменных исключений. */
export interface ApiErrorBody {
  code?: string;
  detail?: string | { msg: string }[];
  required?: number;
  available?: number;
  missing?: number;
}

/** «Рейтинг» оператора (GET /rating/compare): таблица, места по неделям, команды и показатели против всех. */
export interface CompareWeek { id: number; label: string; starts_on: string; ends_on: string; status: string; live: boolean }
export interface CompareMark { rank: number | null; points: number }
export interface CompareRow {
  user_id: number; name: string; group_id: number | null; group: string | null;
  rank: number | null; points: number; rank_delta: number | null;
  weeks: number | null; prize: number | null; is_me: boolean;
  trail: (CompareMark | null)[];
}
export interface CompareTeam {
  group_id: number; name: string; rank: number; members: number; points: number; total: number;
  best: { name: string; points: number; is_me: boolean }; is_mine: boolean; trail: (number | null)[];
}
export interface CompareMetric {
  code: string; title: string; unit: string | null; direction: string; target: number;
  me: number | null; average: number; best: number; reported: number; place: number | null;
  points: number | null; max_points: number;
  /** A bonus over the 100 points (overtime). */
  bonus?: boolean;
}
/** Направление рядом с другим (docs/CHANNELS.md): средняя неделя оператора из 100 баллов. */
export interface CompareChannel {
  channel: Channel; participants: number; average: number | null;
  best: { name: string; points: number; is_me: boolean } | null; is_mine: boolean;
  metrics: { title: string; max_points: number; bonus?: boolean }[];
}
export interface CompareOut {
  period: "week" | "month"; title: string; status: string; live: boolean;
  channel?: Channel; channels?: CompareChannel[];
  week: CompareWeek | null; month: { year: number; month: number; name: string; weeks_planned: number } | null;
  participants: number; weeks: CompareWeek[]; operators: CompareRow[]; teams: CompareTeam[]; metrics: CompareMetric[];
}
