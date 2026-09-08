import { request } from "./client";

export interface DriverPark { id: string; name: string; commission: number }
export interface DriverProfile {
  stage: "services" | "cooperation" | "loading" | "offline";
  service: "taxi" | null;
  park: DriverPark | null;
  created_at: string;
  last_login_at: string | null;
}
export interface DriverState {
  profile: DriverProfile | null; parks: DriverPark[];
  last_result: { attempt_id: number; title: string; state: "passed" | "failed"; score: number | null } | null;
}
export interface DriverAction { action: "taxi" | "services" | "park" | "enter"; park_id?: string }
export const driver = {
  state: () => request<DriverState>("/api/v1/learning/driver"),
  start: () => request<DriverState>("/api/v1/learning/driver/start", { method: "POST" }),
  action: (json: DriverAction) => request<DriverState>("/api/v1/learning/driver/action", { method: "PUT", json }),
  parks: () => request<{ parks: DriverPark[] }>("/api/v1/admin/learning/driver-parks"),
  saveParks: (parks: DriverPark[]) => request<{ parks: DriverPark[] }>("/api/v1/admin/learning/driver-parks", { method: "PUT", json: { parks } }),
};
