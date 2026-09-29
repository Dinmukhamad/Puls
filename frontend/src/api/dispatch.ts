import { request } from "./client";

/** Training copy of the fleet cabinet «Диспетчерская». The server keeps each operator's copy. */
export interface FleetPark { id: string; name: string; city: string; color: string; park_id: string }
export interface FleetCar {
  brand: string; model: string; year: number; color: string; plate: string; callsign: string; vin: string;
  tariffs: string[]; wrap: boolean; wrap_checked: boolean; lightbox: boolean; transmission: string; fuel: string;
}
export interface FleetOrder {
  id: string; status: "complete" | "cancelled"; cancel_reason: string; created_at: string; finished_at: string;
  from: string; to: string; tariff: string; distance: number; duration: number; price: number; payment: "cash" | "card"; tips: number;
}
export interface PriorityItem { label: string; points: number; max: number; hint: string }
export interface FleetDriver {
  id: string; park: string; last_name: string; first_name: string; middle_name: string; phone: string;
  license: string; license_country: string; license_issued: string; license_expires: string; experience_since: string;
  iin: string; address: string; segment: "active" | "new" | "churn" | "archive"; works: boolean;
  status: "free" | "order" | "busy" | "offline"; gps: boolean; employment: string; profession: string; rule: string; provider: string;
  balance: number; account_limit: number; withdraw_limit: number; rating: number | null; car: FleetCar | null;
  thermobox: { type: InventoryType; number: string } | null;
  diagnostics: { ok: boolean; title: string; reasons: string[] };
  priority: { value: number; max: number; label: string; got: PriorityItem[]; can: PriorityItem[] };
  bonus: { done: number; target: number; amount: number; from: string; to: string; place: string; tariffs: string } | null;
  comment: string; source: string; device: string; app_version: string; created: string; photo_checks: string[]; orders: FleetOrder[];
}
export type InventoryType = "eda" | "delivery";
export interface InventoryRow { employee: string; driver: string | null; driver_name: string; operation: string; type: InventoryType; number: string; qty: number; at: string; park: string | null }
export interface FleetTicket {
  id: string; question: string; theme: string; subtheme: string; status: string; reply: string; author: string;
  created_at: string; updated_at: string; private: boolean; kind: "text" | "call"; license: string; files: string[]; park: string; mine: boolean;
}
export interface AntifraudRow { driver: string; driver_name: string; park: string; amount: number; rule: string; value: string; limit: string; at: string; order: string | null; from: string; to: string }
export type CallState = "new" | "crm" | "solved";
export interface FleetCall {
  id: string; mission: string; title: string; speech: string; goal: string; steps: string[]; kind: "action" | "answer";
  question: string; options: [string, string][]; code: boolean; crm: boolean; driver: string; driver_name: string; park: string;
  state: CallState; done: string; attempts: number; active_code: { value: string; expires_in: number } | null;
}
export interface FleetState {
  now: string; login: string; parks: FleetPark[]; drivers: FleetDriver[]; rules: { name: string; count: number; default: boolean }[];
  antifraud: AntifraudRow[]; antifraud_rules: string[]; inventory: { stock: Record<InventoryType, number>; log: InventoryRow[] };
  tickets: FleetTicket[]; calls: FleetCall[];
  catalog: { tariffs: string[]; providers: string[]; inventory: Record<InventoryType, string>; themes: Record<string, string[]> };
  revision: number;
}
export interface FleetResult { note?: string; checks?: { label: string; ok: boolean }[]; solved?: boolean; correct?: boolean; text?: string; code?: string; expires_in?: number; driver?: string; name?: string }
export interface FleetResponse { state: FleetState; result: FleetResult }
export interface TicketInput { park: string; kind: "text" | "call"; private: boolean; theme: string; subtheme: string; license: string; text: string; files: string[] }
export interface InventoryInput { park: string; type: InventoryType; code: string; number: string }

const BASE = "/api/v1/learning/dispatch";
// A fresh id for every press: the server acts once even if the request is repeated.
const send = (path: string, method: string, body: object = {}) => request<FleetResponse>(`${BASE}${path}`, { method, json: { request_id: crypto.randomUUID(), ...body } });

export const fleet = {
  state: () => request<FleetState>(BASE),
  details: (driver: string, provider: string) => send(`/drivers/${encodeURIComponent(driver)}/details`, "PUT", { provider }),
  car: (driver: string, input: { tariffs: string[]; wrap: boolean; lightbox: boolean }) => send(`/drivers/${encodeURIComponent(driver)}/car`, "PUT", input),
  code: (driver: string) => send("/codes", "POST", { driver }),
  issue: (input: InventoryInput) => send("/inventory", "POST", input),
  giveBack: (input: InventoryInput) => send("/inventory/return", "POST", input),
  ticket: (input: TicketInput) => send("/tickets", "POST", input),
  answer: (call: string, option: string) => send(`/calls/${encodeURIComponent(call)}/answer`, "POST", { option }),
  reset: () => send("/reset", "POST"),
};
