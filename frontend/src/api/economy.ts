import { request } from "./client";

/** The monthly contest (app/services/months.py): places and nominations among all operators. */
export interface MonthStanding { user_id: number; name: string | null; rank: number | null; points: number; weeks: number; coins_rank_bonus: number; coins_nomination_bonus: number; mine: boolean; channel?: "line" | "chat" }
export interface MonthNomination { nomination_id: number; title: string; user_id: number; name: string | null; value: number; coins: number }
export interface ContestMonth {
  id: number | null; year: number; month: number; label: string; name: string;
  status: "open" | "calculated" | "closed"; closed_at: string | null;
  weeks: { id: number; label: string; starts_on: string; status: string }[]; weeks_planned: number;
  standings: MonthStanding[]; nominations: MonthNomination[];
}
export interface MonthOption { year: number; month: number; label: string; name: string; status: string }

/** The month's coin economy (app/services/economy.py report). */
export interface EconomyReport {
  year: number; month: number; operators: number; earners: number;
  issued: Record<"results" | "contest" | "gratitude" | "learning" | "games" | "manual", number>;
  burned: Record<"city" | "shop" | "games" | "fines" | "manual", number>;
  corrections: number; total_issued: number; total_burned: number; net: number;
  average_income: number; median_balance: number; months_held: number | null;
  signal: "inflation" | "shortage" | "balanced" | "no_data";
  shop_tenge: number; shop_budget_tenge: number; coin_rate_tenge: number; fine_debt: number;
}

const month = (year?: number, value?: number) => (year && value ? `?year=${year}&month=${value}` : "");
export const economy = {
  month: (year?: number, value?: number) => request<ContestMonth>(`/api/v1/contest/month${month(year, value)}`),
  months: () => request<MonthOption[]>("/api/v1/contest/months"),
  calculate: (year: number, value: number) => request<ContestMonth>(`/api/v1/admin/contest/month/calculate${month(year, value)}`, { method: "POST" }),
  close: (year: number, value: number) => request<{ report: { coins_awarded: number }; month: ContestMonth }>(`/api/v1/admin/contest/month/close${month(year, value)}`, { method: "POST" }),
  report: (year?: number, value?: number) => request<EconomyReport>(`/api/v1/admin/economy/report${month(year, value)}`),
};
