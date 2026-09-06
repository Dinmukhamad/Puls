import { buildQuery, request } from "./client";
import type { MetricKind, WeekOut } from "./types";

export interface MetricSummary {
  code: string;
  title: string;
  unit: string | null;
  direction: "higher_is_better" | "lower_is_better";
  kind: MetricKind;
  target: number;
  value: number | null;
  previous: number | null;
  delta: number | null;
  improved: boolean | null;
  reported: number;
  total: number;
  coverage: number | null;
  below_target: number;
}

export interface TrendPoint {
  week_id: number | null;
  label: string;
  starts_on: string;
  value: number | null;
  reported: number;
}

export interface ComparisonSeries {
  id: number;
  name: string;
  value: number | null;
  previous: number | null;
  delta: number | null;
  improved: boolean | null;
  reported: number;
  total: number;
  values: (number | null)[];
}

export interface AnalyticsOperator {
  user_id: number;
  full_name: string;
  group_id: number | null;
  group_name: string | null;
  value: number | null;
  previous: number | null;
  delta: number | null;
  improved: boolean | null;
  target_met: boolean | null;
  points: number | null;
  rank: number | null;
  missing_metrics: string[];
  values: Record<string, number | null>;
  trend: (number | null)[];
}

export interface AnalyticsOut {
  week: WeekOut | null;
  metric_code: string | null;
  operator_count: number;
  operators_with_data: number;
  pending_requests: number;
  coins_awarded: number;
  metrics: MetricSummary[];
  trend: TrendPoint[];
  groups: ComparisonSeries[];
  comparisons: ComparisonSeries[];
  operators: AnalyticsOperator[];
  methodology: string;
}

export interface AnalyticsFilters {
  week_id?: number;
  group_id?: number;
  metric_code?: string;
  operator_ids?: string;
}

export const analytics = {
  summary: (filters: AnalyticsFilters, signal?: AbortSignal) =>
    request<AnalyticsOut>(`/api/v1/analytics/summary${buildQuery({ ...filters })}`, { signal }),
  mine: (filters: Pick<AnalyticsFilters, "week_id" | "metric_code"> = {}, signal?: AbortSignal) =>
    request<AnalyticsOut>(`/api/v1/analytics/me${buildQuery({ ...filters })}`, { signal }),
};
