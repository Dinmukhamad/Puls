import { buildQuery, request } from "./client";
import type {
  BadgeOut,
  LevelDefinitionOut,
  DashboardOut,
  OperatorRowOut,
  Page,
  RatingOut,
  ShopCatalogOut,
  ShopRequestOut,
  ShopRequestStatus,
  SummaryOut,
  Token,
  TransactionOut,
  UserOut,
  WeekOut,
} from "./types";

const V1 = "/api/v1";

/* --- аутентификация --- */

export const auth = {
  logout: () => request<{ detail: string }>(`${V1}/auth/logout`, { method: "POST", signal: AbortSignal.timeout(15000) }),
  login: (login: string, password: string) =>
    request<Token>(`${V1}/auth/login`, {
      method: "POST",
      form: { username: login, password },
      auth: false,
    }),
  me: () => request<UserOut>(`${V1}/auth/me`),
  changePassword: (currentPassword: string, password: string) =>
    request<{ detail: string }>(`${V1}/auth/password`, {
      method: "POST",
      json: { current_password: currentPassword, password },
    }),
};

/* --- кабинет оператора --- */

export interface HistoryFilters {
  page?: number;
  size?: number;
  kind?: "accrual" | "writeoff" | "purchase" | "";
  date_from?: string;
  date_to?: string;
}

export const cabinet = {
  dashboard: (weekId?: number) =>
    request<DashboardOut>(`${V1}/me/dashboard${buildQuery({ week_id: weekId })}`),
  transactions: (filters: HistoryFilters) =>
    request<Page<TransactionOut>>(`${V1}/me/transactions${buildQuery({ ...filters })}`),
  badges: () => request<BadgeOut[]>(`${V1}/me/badges`),
  levels: () => request<LevelDefinitionOut[]>(`${V1}/me/levels`),
  myRequests: (page = 1, size = 20) =>
    request<Page<ShopRequestOut>>(`${V1}/me/shop-requests${buildQuery({ page, size })}`),
};

/* --- рейтинг --- */

export const rating = {
  progress: (weekId?: number, count = 8) => request<{ points: { week_id: number | null; label: string; starts_on: string; status: string | null; rank: number | null; points: number | null; coins: number | null }[] }>(`${V1}/rating/me/progress${buildQuery({ week_id: weekId, count })}`),
  weeks: (limit = 20) => request<WeekOut[]>(`${V1}/rating/weeks${buildQuery({ limit })}`),
  leaderboard: (params: { week_id?: number; page?: number; size?: number; search?: string }) =>
    request<RatingOut>(`${V1}/rating${buildQuery({ ...params })}`),
};

/* --- магазин --- */

export const shop = {
  catalog: () => request<ShopCatalogOut>(`${V1}/shop/items`),
  buy: (itemId: number, comment?: string) =>
    request<ShopRequestOut>(`${V1}/shop/requests`, {
      method: "POST",
      json: { item_id: itemId, comment: comment || null },
    }),
  cancel: (requestId: number) =>
    request<ShopRequestOut>(`${V1}/shop/requests/${requestId}/cancel`, { method: "POST" }),
};

/* --- админ-панель --- */

export const admin = {
  summary: (weekId?: number) =>
    request<SummaryOut>(`${V1}/admin/summary${buildQuery({ week_id: weekId })}`),
  operators: (params: { week_id?: number; page?: number; size?: number; search?: string }) =>
    request<Page<OperatorRowOut>>(`${V1}/admin/operators${buildQuery({ ...params })}`),
  exportPath: (weekId?: number) => `${V1}/admin/operators/export${buildQuery({ week_id: weekId })}`,

  manualCoins: (userId: number, amount: number, reason: string, requestId?: string) =>
    request<TransactionOut>(`${V1}/admin/coins/manual`, {
      method: "POST",
      json: { user_id: userId, amount, reason, request_id: requestId },
    }),
  gratitude: (userId: number, driverRef?: string, requestId?: string) =>
    request<TransactionOut>(`${V1}/admin/coins/gratitude`, {
      method: "POST",
      json: { user_id: userId, driver_ref: driverRef || null, request_id: requestId },
    }),

  shopRequests: (params: { status?: ShopRequestStatus | ""; page?: number; size?: number }) =>
    request<Page<ShopRequestOut>>(`${V1}/admin/shop/requests${buildQuery({ ...params })}`),
  approve: (id: number, comment?: string) =>
    request<ShopRequestOut>(`${V1}/admin/shop/requests/${id}/approve`, {
      method: "POST",
      json: { comment: comment || null },
    }),
  reject: (id: number, comment: string) =>
    request<ShopRequestOut>(`${V1}/admin/shop/requests/${id}/reject`, {
      method: "POST",
      json: { comment },
    }),
  fulfill: (id: number, comment?: string) =>
    request<ShopRequestOut>(`${V1}/admin/shop/requests/${id}/fulfill`, {
      method: "POST",
      json: { comment: comment || null },
    }),
};
