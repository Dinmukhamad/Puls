import { request } from "./client";
import type { Page } from "./types";
export interface WheelSegment { title: string; weight: number; xp: number; coins: number }
export interface WheelConfig { enabled: boolean; daily_spins: number; segments: WheelSegment[]; used_today: number }
export interface WheelSpin { id: number; segment: number; reward: WheelSegment; segments: WheelSegment[]; created_at: string }
export interface Raffle { id: number; title: string; description: string; prize: string; closes_at: string; status: "draft" | "published" | "closed"; xp_reward: number; coins_reward: number; participants: number; entered: boolean; winner_name: string | null; won: boolean; drawn_at: string | null; accepting_entries: boolean }
export type RaffleInput = Pick<Raffle,"title" | "description" | "prize" | "closes_at" | "xp_reward" | "coins_reward"> & { status: "draft" | "published" };
export const games = {
  wheel: () => request<WheelConfig>("/api/v1/games/wheel"),
  configureWheel: (config: Omit<WheelConfig,"used_today">) => request<WheelConfig>("/api/v1/admin/games/wheel", { method: "PUT", json: config }),
  spin: (request_id: string) => request<WheelSpin>("/api/v1/games/wheel/spin", { method: "POST", json: { request_id } }),
  history: (page: number) => request<Page<WheelSpin>>(`/api/v1/games/wheel/history?page=${page}`),
  raffles: (admin = false) => request<Raffle[]>(`/api/v1/${admin ? "admin/" : ""}games/raffles`),
  saveRaffle: (data: RaffleInput, id?: number) => request<Raffle>(`/api/v1/admin/games/raffles${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", json: data }),
  enter: (id: number) => request<{ detail: string }>(`/api/v1/games/raffles/${id}/enter`, { method: "POST" }),
  draw: (id: number) => request<Raffle>(`/api/v1/admin/games/raffles/${id}/draw`, { method: "POST" }),
};
