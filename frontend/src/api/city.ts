import { buildQuery, request } from "./client";

export type DistrictId = "academy" | "driver" | "crm" | "dispatch" | "opteo";
export type MissionState = "available" | "in_progress" | "ready" | "locked" | "completed" | "unavailable";
export interface MissionDefinition { title: string; description: string; pulsar: string; target: number; xp: number; coins: number; enabled: boolean; prerequisite: string | null }
export interface CityMission extends MissionDefinition { key: string; district: DistrictId; objective: string; path: string; current: number; state: MissionState; claimed_at: string | null }
export interface CityDistrict { id: DistrictId; name: string; subtitle: string; soon: boolean }
export interface CityData { revision: number; user_id: number; full_name: string; preview: boolean; inspecting: boolean; can_claim: boolean; districts: CityDistrict[]; missions: CityMission[]; xp: number; level: number; level_progress: number; level_target: number; balance: number }
export interface CitySettings { revision: number; missions: Record<string, MissionDefinition> }
export interface CityReward { already_claimed: boolean; title: string; xp: number; coins: number }
export interface CityParticipant { user_id: number; full_name: string; login: string; completed: number; total: number; ready: number; xp: number; level: number; orders: number; appeals: number; missions: Pick<CityMission, "key" | "title" | "state" | "current" | "target">[] }
export const city = {
  own: () => request<CityData>("/api/v1/learning/city"),
  operator: (id: number) => request<CityData>(`/api/v1/admin/learning/city/operators/${id}`),
  claim: (key: string, revision: number) => request<CityReward>(`/api/v1/learning/city/missions/${key}/claim`, { method: "POST", json: { revision } }),
  settings: () => request<CitySettings>("/api/v1/admin/learning/city/settings"),
  save: (json: CitySettings) => request<CitySettings>("/api/v1/admin/learning/city/settings", { method: "PUT", json }),
  participants: (q: string, page: number) => request<{ items: CityParticipant[]; total: number; size: number; page: number }>(`/api/v1/admin/learning/city/participants${buildQuery({q,page})}`),
};
export const MISSION_STATES: Record<MissionState, string> = { available: "Доступно", in_progress: "В процессе", ready: "Можно завершить", locked: "Впереди", completed: "Пройдено", unavailable: "На паузе" };
export function nextMission(missions: CityMission[]) {
  return missions.find(m => m.state === "ready") ?? missions.find(m => m.state === "in_progress") ?? missions.find(m => m.state === "available") ?? missions[0];
}
