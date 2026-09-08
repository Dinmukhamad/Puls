import { request } from "./client";

export interface TelegramStatus {
  configured: boolean; connected: boolean; username: string | null;
  linked_at: string | null; bot_username: string | null;
}
export const telegram = {
  status: () => request<TelegramStatus>("/api/v1/auth/telegram"),
  link: (current_password: string) => request<{ url: string; expires_at: string }>("/api/v1/auth/telegram/link", { method: "POST", json: { current_password } }),
  disconnect: (current_password: string) => request<TelegramStatus>("/api/v1/auth/telegram/disconnect", { method: "POST", json: { current_password } }),
};
