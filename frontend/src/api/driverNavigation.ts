import { request } from "./client";
import { driverDeviceHeaders, type DriverState } from "./driver";
import type { GeoPoint, LocationFix } from "../utils/driverLocation";

export interface RoutePoint extends GeoPoint { label: string }
export interface RoadRoute { coordinates: [number, number][]; distance: number; duration: number }
export type TravelMode = "real" | "virtual" | "demo";
export interface RouteDraft { id: string; pickup: RoutePoint; destination: RoutePoint; route: RoadRoute; mode: TravelMode; transport: "car" | "foot"; fare: number; arrival_radius: number; expires_at: string }
export interface NavigationSpec {
  version: number; route_id: string; mode: TravelMode; transport: "car" | "foot"; pickup: RoutePoint; destination: RoutePoint;
  planned_distance: number; planned_duration: number; actual_distance?: number; trip_seconds?: number; wait_seconds?: number; reroutes?: number;
  rules: { arrival_radius: number; boarding_seconds: number; free_wait_seconds: number; virtual_speed: number };
  score?: number | null; result?: { key: string; title: string; weight: number; done: boolean }[];
}
export interface NavigationState {
  order_id: string; status: string; mode: TravelMode; route: RoadRoute; current: LocationFix | null;
  gps_available: boolean; message: string; distance_to_target: number | null; can_arrive: boolean; can_start: boolean; can_finish: boolean;
  wait_seconds: number; free_wait_seconds: number; boarding_seconds: number; arrival_radius: number; actual_distance: number; reroutes: number;
  projection: { snapped: GeoPoint; off_route: number; progress: number; remaining: number; eta: number } | null;
}
const base = "/api/v1/learning/driver";
const post = <T>(url: string, json: unknown) => request<T>(base + url, { method: "POST", json, headers: driverDeviceHeaders() });
export const driverNavigation = {
  search: (query: string, near?: GeoPoint) => post<{ items: RoutePoint[] }>("/maps/search", { query, near }),
  reverse: (point: GeoPoint) => post<{ address: RoutePoint | null }>("/maps/reverse", point),
  prepare: (json: { pickup: RoutePoint; destination: RoutePoint; mode: TravelMode; transport: "car" | "foot"; location?: LocationFix }) => post<RouteDraft>("/routes", json),
  position: (id: string, location?: LocationFix) => post<DriverState>(`/orders/${id}/position`, { location }),
  demo: (id: string, action: "pause" | "resume" | "advance", request_id: string) => post<DriverState>(`/orders/${id}/demo`, { action, request_id }),
  destination: (id: string, destination: RoutePoint, request_id: string, location?: LocationFix) => request<DriverState>(`${base}/orders/${id}/destination`, { method: "PUT", json: { destination, request_id, location }, headers: driverDeviceHeaders() }),
};
