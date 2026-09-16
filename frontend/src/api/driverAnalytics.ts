import { request } from "./client";

export type DriverProgressState = "not_started" | "in_progress" | "completed";
export interface DriverAnalyticsRow {
  user_id: number; full_name: string; login: string; is_active: boolean;
  hired_on: string | null; tenure_days: number | null; state: DriverProgressState;
  completed_orders: number; sessions: number; active_shift: boolean;
  current_stage: string; scenario: string | null; session_orders: number;
  session_target: number | null; mode: string | null; score: number | null;
  checks: { key: string; title: string; done: boolean }[];
}
export interface DriverAnalyticsReport {
  items: DriverAnalyticsRow[];
  operators: { id: number; full_name: string; login: string }[];
  summary: Record<DriverProgressState | "total" | "completed_orders" | "active", number>;
  target_orders: number; updated_at: string;
}
export function getDriverAnalytics(params: URLSearchParams, signal?: AbortSignal) {
  const query = new URLSearchParams();
  for (const key of ["operator_ids", "tenure", "state", "activity", "employment", "target_orders"]) {
    params.getAll(key).forEach(value => { if (value) query.append(key, value); });
  }
  return request<DriverAnalyticsReport>(`/api/v1/admin/learning-analytics/driver?${query}`, { signal });
}
