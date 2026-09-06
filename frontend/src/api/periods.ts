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
