import { request } from "./client";
export interface WheelSegment { title: string; weight: number; coins: number }
/** Free spins a day, then up to `paid_spins` more at `spin_cost` coins each (0 — none). */
export interface WheelConfig { enabled: boolean; daily_spins: number; paid_spins: number; spin_cost: number; segments: WheelSegment[]; used_today: number; free_left?: number; paid_left?: number;
  /** The chest of the day opens once today's daily tasks are answered. */
  chest?: { unlocked: boolean; answered: number; total: number } }
export interface WheelSpin { id: number; segment: number; reward: WheelSegment; segments: WheelSegment[]; created_at: string }
export interface Raffle { id: number; title: string; description: string; prize: string; closes_at: string; status: "draft" | "published" | "closed"; coins_reward: number; entry_cost: number; participants: number; entered: boolean; winner_name: string | null; won: boolean; drawn_at: string | null; accepting_entries: boolean }
export type RaffleInput = Pick<Raffle,"title" | "description" | "prize" | "closes_at" | "coins_reward" | "entry_cost"> & { status: "draft" | "published" };
export const games = {
  wheel: () => request<WheelConfig>("/api/v1/games/wheel"),
  configureWheel: (config: Omit<WheelConfig,"used_today" | "free_left" | "paid_left" | "chest">) => request<WheelConfig>("/api/v1/admin/games/wheel", { method: "PUT", json: config }),
  spin: (request_id: string, paid = false) => request<WheelSpin>("/api/v1/games/wheel/spin", { method: "POST", json: { request_id, paid } }),
  raffles: (admin = false) => request<Raffle[]>(`/api/v1/${admin ? "admin/" : ""}games/raffles`),
  saveRaffle: (data: RaffleInput, id?: number) => request<Raffle>(`/api/v1/admin/games/raffles${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", json: data }),
  enter: (id: number) => request<{ detail: string }>(`/api/v1/games/raffles/${id}/enter`, { method: "POST" }),
  draw: (id: number) => request<Raffle>(`/api/v1/admin/games/raffles/${id}/draw`, { method: "POST" }),
};
