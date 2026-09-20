import { request } from "./client";

export type DriverProgressState = "not_started" | "in_progress" | "completed";
export interface DriverCheck { key: string; title: string; done: boolean; required: boolean; path: string }
export interface DriverAnalyticsRow {
  user_id: number; full_name: string; login: string; is_active: boolean;
  hired_on: string | null; tenure_days: number | null; state: DriverProgressState;
  completed_orders: number; sessions: number; active_shift: boolean;
  current_stage: string; scenario: string | null; session_orders: number;
  session_target: number | null; mode: string | null; score: number | null;
  checks: DriverCheck[]; errors: number; hints: number; last_activity_at: string | null;
  attention: string[]; done_checks: number; required_checks: number;
}
export interface DriverAnalyticsReport {
  items: DriverAnalyticsRow[];
  operators: { id: number; full_name: string; login: string }[];
  summary: Record<DriverProgressState | "total" | "completed_orders" | "active", number>;
  target_orders: number; updated_at: string;
  skills: { key: string; title: string; done: number; pending: number; not_required: number; not_started: number }[];
  activity: { date: string; orders: number; started: number; finished: number }[];
  insights: { average_score: number | null; scored_sessions: number; sessions: number;
    finished_sessions: number; needs_attention: number;
    error_breakdown: { key: string; title: string; value: number }[] };
}
export interface DriverSession {
  id: string; title: string; mode: string; created_at: string; finished_at: string | null;
  last_activity_at: string; orders: number; target: number; score: number | null;
  pass_percent: number | null; passed: boolean | null; elapsed_seconds: number | null;
  errors: number; hints: number; error_breakdown: Record<string, number>;
  checks: DriverCheck[]; done_checks: number; required_checks: number;
}
export interface DriverParticipant {
  user_id: number; full_name: string; login: string; hired_on: string | null; is_active: boolean;
  sessions: DriverSession[]; completed_orders: number; errors: number; hints: number;
  average_score: number | null; scored_sessions: number;
}
export interface DriverJourney {
  session: DriverSession;
  orders: { id: string; number: number; origin: string; destination: string; stage: string;
    created_at: string; finished_at: string | null;
    timeline: { at: string; stage: string; action: string }[] }[];
  events: { at: string; title: string; kind: string; order_id: string | null; detail?: string | null }[];
}
export const getDriverParticipant = (id: number, signal?: AbortSignal) => request<DriverParticipant>(`/api/v1/admin/learning-analytics/driver/operators/${id}`, { signal });
export const getDriverJourney = (id: number, shift: string, signal?: AbortSignal) => request<DriverJourney>(`/api/v1/admin/learning-analytics/driver/operators/${id}/shifts/${shift}`, { signal });

export function driverReportParams(params: URLSearchParams) {
  const query = new URLSearchParams();
  for (const key of ["operator_ids", "tenure", "state", "activity", "employment", "target_orders", "days"]) {
    params.getAll(key).forEach(value => { if (value) query.append(key, value); });
  }
  return query;
}
export function getDriverAnalytics(params: URLSearchParams, signal?: AbortSignal) {
  const query = driverReportParams(params);
  return request<DriverAnalyticsReport>(`/api/v1/admin/learning-analytics/driver?${query}`, { signal });
}
