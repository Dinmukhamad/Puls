import { buildQuery, request } from "./client";
import type { Page, Role } from "./types";
export interface DeviceSession { id: string; user_id: number; full_name: string; login: string; role: Role; device: string; ip_address: string | null; created_at: string; last_active_at: string; expires_at: string; current: boolean }
export type SessionRevokeScope = "selected" | "user" | "role" | "all";
export interface SessionBulkRevokeInput { scope: SessionRevokeScope; session_ids: string[]; user_id?: number; role?: Role; keep_current: boolean }
export interface SessionBulkRevokeResult { revoked_count: number; user_count: number; current_revoked: boolean; detail: string }
export interface AuditEntry { id: number; created_at: string; actor_name: string | null; action: string; entity_type: string; entity_id: string | null; changes: Record<string, unknown> | null; comment: string | null; ip_address: string | null }
export const systemApi = {
  sessions: (admin = false) => request<DeviceSession[]>(`/api/v1/${admin ? "admin" : "me"}/sessions`),
  revoke: (id: string, admin = false) => request(`/api/v1/${admin ? "admin" : "me"}/sessions/${id}/revoke`, { method: "POST" }),
  revokeOthers: () => request("/api/v1/me/sessions/revoke-others", { method: "POST" }),
  revokeBulk: (body: SessionBulkRevokeInput) => request<SessionBulkRevokeResult>("/api/v1/admin/sessions/revoke-bulk", { method: "POST", json: body }),
  audit: (filters: Record<string, unknown>) => request<Page<AuditEntry>>(`/api/v1/admin/audit${buildQuery(filters)}`),
};
