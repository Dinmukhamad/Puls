import { request } from "./client";

export interface DriverPark { id: string; name: string; commission: number }
export interface DriverProfile {
  stage: "services" | "cooperation" | "phone" | "otp" | "loading" | "offline";
  service: "taxi" | null;
  park: DriverPark | null;
  created_at: string;
  last_login_at: string | null;
}
export interface DriverState {
  authentication: DriverAuthentication;
  profile: DriverProfile | null; parks: DriverPark[];
  last_result: { attempt_id: number; title: string; state: "passed" | "failed"; score: number | null } | null;
}
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
  state: () => request<DriverState>("/api/v1/learning/driver", { headers: driverDeviceHeaders() }),
  start: () => request<DriverState>("/api/v1/learning/driver/start", { method: "POST", headers: driverDeviceHeaders() }),
  action: (json: DriverAction) => request<DriverState>("/api/v1/learning/driver/action", { method: "PUT", json, headers: driverDeviceHeaders() }),
  code: (phone: string) => request<DriverState>("/api/v1/learning/driver/code", { method: "POST", json: { phone }, headers: driverDeviceHeaders() }),
  verify: (code: string) => request<DriverState>("/api/v1/learning/driver/verify", { method: "POST", json: { code }, headers: driverDeviceHeaders() }),
  forget: () => request<DriverState>("/api/v1/learning/driver/device", { method: "DELETE", headers: driverDeviceHeaders() }),
  parks: () => request<{ parks: DriverPark[] }>("/api/v1/admin/learning/driver-parks"),
  saveParks: (parks: DriverPark[]) => request<{ parks: DriverPark[] }>("/api/v1/admin/learning/driver-parks", { method: "PUT", json: { parks } }),
};
