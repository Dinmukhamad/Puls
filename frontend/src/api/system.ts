import { buildQuery, request } from "./client";
import type { Page } from "./types";
export interface DeviceSession { id: string; user_id: number; full_name: string; device: string; ip_address: string | null; created_at: string; last_active_at: string; expires_at: string; current: boolean }
export interface AuditEntry { id: number; created_at: string; actor_name: string | null; action: string; entity_type: string; entity_id: string | null; changes: Record<string, unknown> | null; comment: string | null; ip_address: string | null }
export const systemApi = {
  sessions: (admin = false) => request<DeviceSession[]>(`/api/v1/${admin ? "admin" : "me"}/sessions`),
  revoke: (id: string, admin = false) => request(`/api/v1/${admin ? "admin" : "me"}/sessions/${id}/revoke`, { method: "POST" }),
  revokeOthers: () => request("/api/v1/me/sessions/revoke-others", { method: "POST" }),
  audit: (filters: Record<string, unknown>) => request<Page<AuditEntry>>(`/api/v1/admin/audit${buildQuery(filters)}`),
};
