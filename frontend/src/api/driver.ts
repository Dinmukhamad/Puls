import { request } from "./client";
import type { DriverShift, ShiftResult, SupportCase } from "./driverShift";

export interface DriverPark { id: string; name: string; commission: number }
export interface DriverProfile {
  stage: "services" | "cooperation" | "phone" | "otp" | "loading" | "offline";
  service: "taxi" | null;
  park: DriverPark | null;
  created_at: string;
  last_login_at: string | null;
}
export interface DriverState {
  shift?: DriverShift | null;
  shift_history?: { id: string; mode: string; finished_at: string; result: ShiftResult }[];
  shift_best?: number | null;
  support_cases?: SupportCase[];
  order: DriverOrder | null;
  order_summary: DriverOrderSummary;
  order_history: DriverOrder[];
  server_now: string;
  authentication: DriverAuthentication;
  profile: DriverProfile | null; parks: DriverPark[];
  last_result: { attempt_id: number; title: string; state: "passed" | "failed"; score: number | null } | null;
}

export type OrderStage = "searching" | "offer" | "pickup" | "waiting" | "trip" | "payment" | "complete" | "cancelled";
export type OrderAction = "offer" | "accept" | "arrive" | "start_trip" | "finish" | "pay" | "cancel" | "missed";
export interface DriverOrder {
  shift_id?: string | null;
  details?: { service_fee: number; service_tax: number; waiting_fee: number; base_fare: number; offer_seconds: number; tariff: string; route_event: boolean; route_changed: boolean } | null;
  id: string; stage: OrderStage; origin: string; destination: string; payment: "cash" | "card";
  fare: number; commission: number; net: number; park: DriverPark; version: number;
  created_at: string; stage_started_at: string; finished_at: string | null; duration_seconds: number;
  events: { action: OrderAction; from: OrderStage; to: OrderStage; at: string; request_id: string }[];
}
export interface DriverOrderSummary { count: number; gross: number; commission: number; net: number }
export interface OrderCreate { id: string; origin: string; destination: string }
export interface OrderCommand { id: string; action: OrderAction; request_id: string }
export const orderActive = (order: DriverOrder | null | undefined) => !!order && order.stage !== "complete" && order.stage !== "cancelled";
export interface DriverAuthentication {
  remember_days: number;
  verified: boolean; valid_until: string | null; phone_set: boolean;
  telegram_connected: boolean; telegram_configured: boolean;
  code_pending: boolean; code_expires_at: string | null; next_send_at: string | null;
}

// Случайный секрет браузера. Сервер хранит только хеш с привязкой к аккаунту.
// Он не заменяет вход в Puls и не удаляется при обычном выходе из Puls.
export function driverDeviceHeaders(): Record<string, string> {
  const key = "pulse.driver-device";
  try {
    let token = localStorage.getItem(key);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      localStorage.setItem(key, token);
    }
    return { "X-Driver-Device": token };
  } catch {
    throw new Error("Для подтверждения браузера разрешите сохранение данных сайта.");
  }
}
export interface DriverAction { action: "taxi" | "services" | "park" | "enter"; park_id?: string }
export const driver = {
  createOrder: (json: OrderCreate) => request<DriverState>("/api/v1/learning/driver/orders", { method: "POST", json, headers: driverDeviceHeaders() }),
  orderAction: ({ id, ...json }: OrderCommand) => request<DriverState>(`/api/v1/learning/driver/orders/${id}/action`, { method: "PUT", json, headers: driverDeviceHeaders() }),
  state: () => request<DriverState>("/api/v1/learning/driver", { headers: driverDeviceHeaders() }),
  start: () => request<DriverState>("/api/v1/learning/driver/start", { method: "POST", headers: driverDeviceHeaders() }),
  action: (json: DriverAction) => request<DriverState>("/api/v1/learning/driver/action", { method: "PUT", json, headers: driverDeviceHeaders() }),
  code: (phone: string) => request<DriverState>("/api/v1/learning/driver/code", { method: "POST", json: { phone }, headers: driverDeviceHeaders() }),
  verify: (code: string) => request<DriverState>("/api/v1/learning/driver/verify", { method: "POST", json: { code }, headers: driverDeviceHeaders() }),
  forget: () => request<DriverState>("/api/v1/learning/driver/device", { method: "DELETE", headers: driverDeviceHeaders() }),
  parks: () => request<{ parks: DriverPark[] }>("/api/v1/admin/learning/driver-parks"),
  saveParks: (parks: DriverPark[]) => request<{ parks: DriverPark[] }>("/api/v1/admin/learning/driver-parks", { method: "PUT", json: { parks } }),
};
