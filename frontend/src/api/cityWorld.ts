import { request } from "./client";
import { CITY_READ_TIMEOUT_MS } from "./city";

export type DepartmentId = "support" | "sales";
export interface TeamDistrict { id: string; name: string; mine: boolean; assigned: boolean; supervisor: string | null; construction?: boolean; prepared?: number }
export interface DepartmentCity { id: DepartmentId; name: string; districts: TeamDistrict[] }
export interface CityWorld { revision: number; cities: DepartmentCity[]; home_city: DepartmentId | null; home_district: string | null; currency: "coins"; can_edit: boolean }
export interface WorldDistrict { id: string; name: string; supervisor_id: number | null; group_ids: number[]; construction?: boolean; legacy_assignment?: boolean }
export interface WorldCity { id: DepartmentId; name: string; head_id: number | null; districts: WorldDistrict[] }
export interface WorldSettings { revision: number; cities: WorldCity[] }
export interface WorldSaveSettings {
  revision: number;
  cities: { id: DepartmentId; name: string; head_id: number | null; districts: { id: string; name: string; supervisor_id?: number | null; construction: boolean }[] }[];
}
export interface WorldSupervisor { id: number; name: string; group_ids: number[]; group_names: string[]; operator_count: number }
export interface WorldEditorData extends WorldSettings {
  can_edit: boolean;
  can_manage_heads: boolean;
  editable_city_ids: DepartmentId[];
  heads: { id: number; name: string }[];
  supervisors: WorldSupervisor[];
  groups: { id: number; name: string; supervisor_id: number | null; supervisor_name: string | null }[];
}
/** Only editable settings belong in a save: group membership and rights always come from the server. */
export function worldSavePayload(settings: WorldSettings | WorldSaveSettings): WorldSaveSettings {
  return { revision: settings.revision, cities: settings.cities.map(city => ({
    id: city.id, name: city.name, head_id: city.head_id,
    districts: city.districts.map(district => ({
      id: district.id, name: district.name, construction: !!district.construction,
      // Ambiguous legacy groups have no single supervisor. Preserve them until an explicit UI assignment/clear.
      ...("supervisor_id" in district && district.supervisor_id !== undefined && !(district.supervisor_id === null && (("legacy_assignment" in district && district.legacy_assignment) || ("group_ids" in district && district.group_ids.length)))
        ? { supervisor_id: district.supervisor_id } : {}),
    })),
  })) };
}
export const cityWorld = {
  get: (signal?: AbortSignal) => request<CityWorld>("/api/v1/learning/city/world", { signal, timeoutMs: CITY_READ_TIMEOUT_MS }),
  settings: () => request<WorldEditorData>("/api/v1/admin/learning/city/world"),
  save: (json: WorldSaveSettings) => request<WorldEditorData>("/api/v1/admin/learning/city/world", { method: "PUT", json: worldSavePayload(json) }),
};
export const SALES_RESOURCES = ["Академия продаж", "CRM отдела продаж", "Телефония", "Продукты и тарифы", "Воронка продаж", "Переговоры", "Документы", "Контроль качества", "База знаний", "Новый ресурс"];
