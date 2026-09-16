import { request } from "./client";
import { driverDeviceHeaders, type DriverState } from "./driver";
import type { NavigationSpec } from "./driverNavigation";

export interface SupportStep { question: string; options: string[]; correct: number; explanation: string }
export interface DriverScenario {
  real_location_required: boolean; arrival_radius: number; free_wait_seconds: number; boarding_seconds: number; fare_per_km: number; virtual_speed: number;
  title: string; required_park: string; target_orders: number; fare: number; service_percent: number; service_tax_percent: number;
  wait_per_minute: number; initial_balance: number; initial_points: number; priority_base: number; priority_complete: number;
  priority_missed: number; priority_cancelled: number; offer_seconds: number; require_photo: boolean; require_documents: boolean;
  require_support: boolean; route_event: boolean; ratings: number[];
  levels: { name: string; threshold: number; benefits: string }[];
  tariffs: { id: string; name: string; available: boolean; reason: string }[];
  support_steps?: SupportStep[];
}
export interface DriverPreferences {
  theme: "dark" | "light" | "system"; volume: number; vibration: boolean; hide_income: boolean; widgets: boolean;
  auto_arrive: boolean; auto_start: boolean; destination_marker: boolean; navigation: "internal" | "overview";
  location: "virtual" | "gps"; demand: boolean; traffic: boolean; bonus_zones: boolean; special_zones: boolean;
}
export interface LedgerEntry { id: string; title: string; amount: number; kind: string; order_id: string | null; status: "complete" | "pending" | "failed"; at: string; note: string }
export interface DriverMessage { id: string; channel: string; title: string; text: string; at: string; amount?: number; transaction_id?: string }
export interface DriverCar { id: string; brand: string; model: string; year: number; plate: string; status: string }
export interface IntercityOffer { id: string; origin: string; destination: string; date?: string; from_time?: string; to_time?: string; seats?: number; type?: string; price: number; status: string }
export interface ShiftResult { trips?: { id: string; origin: string; destination: string; fare: number; payment: string; navigation: NavigationSpec }[]; score: number | null; penalties: number; checks: { key: string; title: string; path: string; done: boolean; weight: number }[]; orders: number; target: number; seconds: number; errors: number; hints: number }
export interface DriverShift {
  is_preview?: boolean; content_id?: number | null;
  id: string; mode: "free" | "assessment"; config: DriverScenario; version: number; created_at: string; finished_at: string | null; result: ShiftResult | null;
  events: { id: string; action: string; at: string; details: Record<string, unknown> }[];
  data: {
    online: boolean; completed: number; missed: number; cancelled: number; hints: number; priority: number; points: number; seen: string[];
    photo_steps: number[]; photo_status: string; settings: DriverPreferences; tariffs: string[]; payment: "any" | "cash" | "card";
    cars: DriverCar[]; car_id: string; provider: string | null; documents: { id: string; title: string; period: string; status: string; signed_at: string | null }[];
    ledger: LedgerEntry[]; messages: DriverMessage[]; bookings: IntercityOffer[]; intercity_alerts: { text: string; at: string }[];
    rentals: { car: string; contact: string; status: string }[]; fuel: { liters: number; amount: number; at: string }[];
    promos: string[]; lessons: string[]; passenger_messages: { order_id: string; text: string; reply: string; at: string }[];
    work_mode: string; mode_address: string; support_completed: number; support_errors: number; support_checked_wallet: boolean; payout_problem: boolean;
    level_restored: boolean; points_history: { order_id: string; points: number; at: string }[]; rating_votes: number[];
    balance: number; available: number; reserved: number;
  };
}
export interface SupportCase { id: string; topic: string; status: string; step: number; total: number; created_at: string; finished_at: string | null; order_id: string | null }
export type ShiftActionName = "visit" | "setting" | "tariff" | "payment" | "car_add" | "car_select" | "photo_step" | "photo_submit" | "photo_restart" | "doc_sign" | "provider" | "wallet" | "promo" | "intercity_create" | "intercity_book" | "rental" | "refuel" | "learning" | "work_mode" | "online" | "offline" | "hint" | "finish" | "passenger" | "route_change" | "level_restore" | "intercity_cancel";
export type ShiftAct = (action: ShiftActionName, values?: Record<string, unknown>) => void;
export const driverShift = {
  results: (page: number, userId?: number) => request<{ total: number; items: { id: string; full_name: string; title: string; mode: string; completed: number; created_at: string; finished_at: string | null; result: ShiftResult | null }[] }>(`/api/v1/admin/learning/driver-results?page=${page}&size=20${userId ? `&user_id=${userId}` : ""}`),
  start: (json: { id: string; mode: "free" | "assessment"; content_id?: number }) => request<DriverState>("/api/v1/learning/driver/shifts", { method: "POST", json, headers: driverDeviceHeaders() }),
  act: ({ id, ...json }: { id: string; request_id: string; action: ShiftActionName; values: Record<string, unknown> }) => request<DriverState>(`/api/v1/learning/driver/shifts/${id}/action`, { method: "PUT", json, headers: driverDeviceHeaders() }),
  support: ({ shift_id, ...json }: { shift_id: string; id: string; topic: "payment" | "passenger" | "account" }) => request<{ case: SupportCase; url: string | null }>(`/api/v1/learning/driver/shifts/${shift_id}/support`, { method: "POST", json, headers: driverDeviceHeaders() }),
  config: () => request<DriverScenario>("/api/v1/admin/learning/driver-scenario"),
  saveConfig: (json: DriverScenario) => request<DriverScenario>("/api/v1/admin/learning/driver-scenario", { method: "PUT", json }),
};
