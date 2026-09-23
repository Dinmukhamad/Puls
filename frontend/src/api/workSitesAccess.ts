import { request } from "./client";

export interface WorkSitesAccessState { required: boolean; granted: boolean; pending_until: string | null }
export interface WorkSitesQr { granted: boolean; payload: string | null; expires_at: string | null }
export interface QrRecipient {
  user_id: number; full_name: string; login: string; device: string;
  requested_at: string; expires_at: string; section: string;
}
export const workSitesAccess = {
  status: () => request<WorkSitesAccessState>("/api/v1/work-sites-access/status"),
  issue: () => request<WorkSitesQr>("/api/v1/work-sites-access/request", { method: "POST" }),
  preview: (payload: string) => request<QrRecipient>("/api/v1/work-sites-access/preview", { method: "POST", json: { payload } }),
  approve: (payload: string) => request<{ granted: boolean; user_id: number; full_name: string }>("/api/v1/work-sites-access/approve", { method: "POST", json: { payload } }),
};
