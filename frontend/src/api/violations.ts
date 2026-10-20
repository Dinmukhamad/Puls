import { buildQuery, request } from "./client";

/** A supervisor's record of foreign sites noticed during a shift (docs/CHANNELS.md). */
export interface Violation {
  id: number; user_id: number; user_name: string; count: number; noticed_on: string; comment: string | null;
  /** The week it counts towards: the noticed day's, or the current one when that is published. */
  week_id: number; week_label: string; week_starts_on: string; week_ends_on: string; week_status: string;
  author_name: string | null; created_at: string; cancelled: boolean;
}
export interface ViolationInput { user_id: number; count: number; noticed_on?: string; comment: string }

const base = "/api/v1/admin/violations";
export const violations = {
  list: (params: { user_id?: number; week_id?: number; limit?: number }) => request<Violation[]>(`${base}${buildQuery(params)}`),
  record: (json: ViolationInput) => request<Violation>(base, { method: "POST", json }),
  cancel: (id: number) => request<Violation>(`${base}/${id}`, { method: "DELETE" }),
};
