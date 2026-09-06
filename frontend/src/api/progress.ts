import { buildQuery, request } from "./client";
import type { Page } from "./types";
export interface XpLevel { id: number; title: string; description: string | null; min_xp: number; is_active: boolean }
export interface XpSummary { total: number; current: XpLevel | null; next: XpLevel | null; remaining: number; progress: number; levels: XpLevel[] }
export interface XpEntry { id: number; user_id: number; amount: number; total_after: number; reason: string; source: string; created_at: string; full_name: string | null }
export interface NotificationEntry { id: number; title: string; body: string; kind: string; link: string | null; read_at: string | null; created_at: string }
export const progressApi = {
  summary: () => request<XpSummary>("/api/v1/me/xp"),
  history: (page: number, administrative = false, userId?: number) => request<Page<XpEntry>>(`/api/v1/${administrative ? "admin/xp" : "me/xp/history"}${buildQuery({ page, size: 20, user_id: userId })}`),
  grant: (user_id: number, amount: number, reason: string, request_id: string) => request("/api/v1/admin/xp/grant", { method: "POST", json: { user_id, amount, reason, request_id } }),
  levels: () => request<XpLevel[]>("/api/v1/admin/xp/levels"),
  saveLevel: (value: Omit<XpLevel, "id">, id?: number) => request<XpLevel>(`/api/v1/admin/xp/levels${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", json: value }),
  notifications: (page: number, unread: boolean) => request<Page<NotificationEntry>>(`/api/v1/me/notifications${buildQuery({ page, size: 20, unread })}`),
  read: (id?: number) => request(`/api/v1/me/notifications${id ? `/${id}` : ""}/read`, { method: "POST" }),
};
