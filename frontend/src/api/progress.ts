import { buildQuery, request } from "./client";
import type { Page } from "./types";
export interface ProgressLevel { id: number; title: string; description: string | null; min_coins: number; is_active: boolean }
export interface CoinProgressData { total: number; available: number; current: ProgressLevel | null; next: ProgressLevel | null; level_number: number; remaining: number; progress: number; levels: ProgressLevel[]; achievements: import("./types").BadgeOut[] }
export interface NotificationEntry { id: number; title: string; body: string; kind: string; link: string | null; read_at: string | null; created_at: string }
export const progressApi = {
  summary: (userId?: number) => request<CoinProgressData>(userId ? `/api/v1/admin/progress/users/${userId}` : "/api/v1/me/progress"),
  levels: () => request<ProgressLevel[]>("/api/v1/admin/progress/levels"),
  saveLevel: (value: Omit<ProgressLevel, "id">, id?: number) => request<ProgressLevel>(`/api/v1/admin/progress/levels${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", json: value }),
  notifications: (page: number, unread: boolean) => request<Page<NotificationEntry>>(`/api/v1/me/notifications${buildQuery({ page, size: 20, unread })}`),
  read: (id?: number) => request(`/api/v1/me/notifications${id ? `/${id}` : ""}/read`, { method: "POST" }),
};
