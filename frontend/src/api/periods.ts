import { request } from "./client";
import type { WeekOut } from "./types";

export interface ImportIssue { row: number | null; field: string | null; code: string; message: string }
export interface ImportPreview {
  filename: string; format: "long" | "wide"; total_rows: number; operator_count: number;
  valid_values: number; values: { user_id: number; metric_code: string; value: number }[];
  errors: ImportIssue[]; warnings: ImportIssue[]; can_apply: boolean;
}
export interface PeriodPreview {
  week_id: number; week_label: string; status: string; participants: number; coins_total: number;
  missing_metrics: string[];
  rows: { user_id: number; full_name: string; rank: number | null; final_points: number;
    coins_total: number; coins_from_points: number; coins_rank_bonus: number;
    coins_discipline_bonus: number; coins_nomination_bonus: number; missing_metrics: string[] }[];
}
export interface CloseReport {
  week_id: number; week_label: string; participants: number; coins_awarded: number;
  nominations_awarded: number; badges_awarded: number; already_closed: boolean;
}
const base = "/api/v1/admin/weeks";
export const periods = {
  list: () => request<WeekOut[]>(base),
  create: (any_day: string) => request<WeekOut>(base, { method: "POST", json: { any_day } }),
  inspect: (id: number, file: File) => {
    const multipart = new FormData(); multipart.append("file", file);
    return request<ImportPreview>(`${base}/${id}/import/preview`, { method: "POST", multipart });
  },
  apply: (id: number, preview: ImportPreview) => request<{ detail: string }>(`${base}/${id}/metrics`, {
    method: "POST", json: { values: preview.values, source: "import", replace: false },
  }),
  preview: (id: number) => request<PeriodPreview>(`${base}/${id}/preview`),
  calculate: (id: number) => request<PeriodPreview>(`${base}/${id}/recalculate`, { method: "POST" }),
  publish: (id: number) => request<CloseReport>(`${base}/${id}/close`, { method: "POST" }),
};

export interface ReportsResult {
  month: string; matched: number; matched_names: string[]; unmatched: string[];
  without_data: number; day_values: number; detail: string | null;
  files: { filename: string; kind: "team" | "quality" | "unknown"; people: number }[];
  weeks: { label: string; starts_on: string; ends_on: string; status: string; operators: number }[];
}
const reportsForm = (files: File[], month: string) => {
  const multipart = new FormData();
  for (const file of files) multipart.append("files", file);
  if (month) multipart.append("month", month);
  return multipart;
};
export const reports = {
  inspect: (files: File[], month: string) => request<ReportsResult>("/api/v1/admin/day-metrics/reports/preview", { method: "POST", multipart: reportsForm(files, month) }),
  save: (files: File[], month: string) => request<ReportsResult>("/api/v1/admin/day-metrics/reports", { method: "POST", multipart: reportsForm(files, month) }),
};
