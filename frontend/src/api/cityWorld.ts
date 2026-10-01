import { request } from "./client";

export type DepartmentId = "support" | "sales";
export interface TeamDistrict { id: string; name: string; mine: boolean; assigned: boolean; supervisor: string | null; construction?: boolean; prepared?: number }
export interface DepartmentCity { id: DepartmentId; name: string; districts: TeamDistrict[] }
export interface CityWorld { revision: number; cities: DepartmentCity[]; home_city: DepartmentId | null; home_district: string | null; currency: "coins"; can_edit: boolean }
export interface WorldSettings {
  revision: number;
  cities: { id: DepartmentId; name: string; districts: { id: string; name: string; group_ids: number[]; construction?: boolean }[] }[];
}
export interface WorldEditorData extends WorldSettings {
  can_edit: boolean;
  groups: { id: number; name: string; supervisor_id: number | null; supervisor_name: string | null }[];
}
export const cityWorld = {
  get: () => request<CityWorld>("/api/v1/learning/city/world"),
  settings: () => request<WorldEditorData>("/api/v1/admin/learning/city/world"),
  save: (json: WorldSettings) => request<WorldSettings>("/api/v1/admin/learning/city/world", { method: "PUT", json }),
};
export const SALES_RESOURCES = ["Академия продаж", "CRM отдела продаж", "Телефония", "Продукты и тарифы", "Воронка продаж", "Переговоры", "Документы", "Контроль качества", "База знаний", "Новый ресурс"];
