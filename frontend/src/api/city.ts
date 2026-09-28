import { buildQuery, request } from "./client";

export type DistrictId = "academy" | "driver" | "crm" | "dispatch" | "oktell";
export type MissionState = "available" | "in_progress" | "ready" | "locked" | "completed" | "unavailable";
export interface MissionDefinition { title: string; description: string; pulsar: string; target: number; xp: number; coins: number; enabled: boolean; prerequisite: string | null }
export interface CityMission extends MissionDefinition { key: string; district: DistrictId; objective: string; path: string; current: number; state: MissionState; claimed_at: string | null }
export interface CityDistrict { id: DistrictId; name: string; subtitle: string; soon: boolean }
export interface CityData { revision: number; user_id: number; full_name: string; gender?: "male" | "female" | null; guide_name?: string | null; preview: boolean; inspecting: boolean; can_claim: boolean; districts: CityDistrict[]; missions: CityMission[]; xp: number; level: number; level_progress: number; level_target: number; balance: number; available: number; plots: CityPlot[]; buildings: CityBuilding[]; can_build: boolean; group: CityGroup | null; quests: CityQuests | null }
export type BuildingKey = "garden" | "gazebo" | "playground" | "sports" | "fountain" | "cottage" | "house" | "tower";
/** A plot of the operator's own district; `item` is what stands on it. */
export interface CityPlot { key: string; district: DistrictId; unlocked: boolean; item: BuildingKey | null }
export interface CityBuilding { key: BuildingKey; name: string; description: string; icon: string; price: number }
export interface CityBuilt { plot: string; item: BuildingKey; name: string; price: number; balance: number }
/** A daily situation: `right` and `explanation` come only once it is answered. */
export interface CityQuest { slot: number; giver: "driver" | "client" | "guide"; title: string; speaker: string; text: string; options: string[]; answered: boolean; answer: number | null; correct: boolean | null; right: number | null; explanation: string | null; coins: number }
export interface CityQuests { day: string; coins: number; items: CityQuest[] }
export type SiteStage = "planned" | "foundation" | "frame" | "floors" | "done";
export type PointKind = "missions" | "materials" | "quests" | "orders" | "appeals" | "closed";
/** The operator's group city: stages only, and the operator's own points. */
export interface CityGroup { name: string; small: boolean; projects: { key: string; name: string; stage: SiteStage }[]; mine: Record<PointKind | "points", number>; points: Record<PointKind, number> }
/** Staff: a group's quarters with points, and every member's contribution. */
export interface CityGroupOverview { id: number; name: string; total: number; projects: { key: string; name: string; stage: SiteStage; points: number; cost: number }[]; members: ({ user_id: number; full_name: string } & Record<PointKind | "points", number>)[] }
export const SITE_STAGES: Record<SiteStage, string> = { planned: "Запланирован", foundation: "Фундамент", frame: "Каркас", floors: "Этажи", done: "Построен" };
export const POINT_KINDS: Record<PointKind, string> = { missions: "Миссии города", materials: "Пройденные материалы", quests: "Задания дня", orders: "Учебные заказы", appeals: "Обращения CRM", closed: "Закрытые тикеты" };
export interface CitySettings { revision: number; missions: Record<string, MissionDefinition> }
export interface CityReward { already_claimed: boolean; title: string; xp: number; coins: number }
export interface CityParticipant { user_id: number; full_name: string; login: string; completed: number; total: number; ready: number; xp: number; level: number; orders: number; appeals: number; missions: Pick<CityMission, "key" | "title" | "state" | "current" | "target">[] }
export const city = {
  own: () => request<CityData>("/api/v1/learning/city"),
  operator: (id: number) => request<CityData>(`/api/v1/admin/learning/city/operators/${id}`),
  claim: (key: string, revision: number) => request<CityReward>(`/api/v1/learning/city/missions/${key}/claim`, { method: "POST", json: { revision } }),
  build: (plot: string, item: BuildingKey) => request<CityBuilt>(`/api/v1/learning/city/plots/${plot}/build`, { method: "POST", json: { item } }),
  answer: (slot: number, answer: number) => request<CityQuest>(`/api/v1/learning/city/quests/${slot}/answer`, { method: "POST", json: { answer } }),
  groups: () => request<{ items: CityGroupOverview[]; points: Record<PointKind, number> }>("/api/v1/admin/learning/city/groups"),
  settings: () => request<CitySettings>("/api/v1/admin/learning/city/settings"),
  save: (json: CitySettings) => request<CitySettings>("/api/v1/admin/learning/city/settings", { method: "PUT", json }),
  participants: (q: string, page: number) => request<{ items: CityParticipant[]; total: number; size: number; page: number }>(`/api/v1/admin/learning/city/participants${buildQuery({q,page})}`),
};
export const MISSION_STATES: Record<MissionState, string> = { available: "Доступно", in_progress: "В процессе", ready: "Можно завершить", locked: "Впереди", completed: "Пройдено", unavailable: "На паузе" };
export function nextMission(missions: CityMission[]) {
  return missions.find(m => m.state === "ready") ?? missions.find(m => m.state === "in_progress") ?? missions.find(m => m.state === "available") ?? missions[0];
}
