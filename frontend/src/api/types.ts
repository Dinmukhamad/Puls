/** Типы ответов API. Повторяют схемы Pydantic из бэкенда. */

export type Role = "operator" | "supervisor" | "head" | "admin";

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
  | "achievement_reward";

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

export interface UserOut {
  phone: string | null;
  id: number;
  login: string;
  email: string | null;
  full_name: string;
  role: Role;
  is_active: boolean;
  is_developer: boolean;
  hired_on: string | null;
  group: GroupBrief | null;
}

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
  requires_approval: boolean;
  sort_order: number;
}

export interface ShopItemForOperator extends ShopItemOut {
  can_buy: boolean;
  missing_coins: number;
  blocked_reason: string | null;
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
}

/** Тело ошибки, которое возвращает бэкенд для доменных исключений. */
export interface ApiErrorBody {
  code?: string;
  detail?: string | { msg: string }[];
  required?: number;
  available?: number;
  missing?: number;
}
