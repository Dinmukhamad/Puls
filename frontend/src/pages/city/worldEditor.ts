import { worldSavePayload, type DepartmentId, type WorldEditorData, type WorldSaveSettings } from "../../api/cityWorld";

export interface WorldDraftState { draft: WorldSaveSettings; baseline: WorldSaveSettings; dirty: boolean }

export function worldDraftState(data: WorldEditorData): WorldDraftState {
  const draft = worldSavePayload(data);
  return { draft, baseline: structuredClone(draft), dirty: false };
}

/** A background refresh updates access and directories in the view, but never replaces unfinished work. */
export function refreshWorldDraft(state: WorldDraftState, data: WorldEditorData): WorldDraftState {
  return state.dirty ? state : worldDraftState(data);
}

export function changeWorldCity(state: WorldDraftState, cityId: DepartmentId, update: (city: WorldSaveSettings["cities"][number]) => void): WorldDraftState {
  const draft = structuredClone(state.draft);
  const city = draft.cities.find(item => item.id === cityId);
  if (!city) return state;
  update(city);
  return { ...state, draft, dirty: JSON.stringify(draft) !== JSON.stringify(state.baseline) };
}

export function canEditWorldCity(data: WorldEditorData, cityId: DepartmentId): boolean {
  return data.can_edit && data.editable_city_ids.includes(cityId);
}

/** Preserve a revoked city's draft on screen, while preventing its submission under the new rights. */
export function hasRevokedWorldChanges(state: WorldDraftState, data: WorldEditorData): boolean {
  return state.draft.cities.some(city => {
    const baseline = state.baseline.cities.find(item => item.id === city.id);
    if (!baseline) return true;
    if (!data.can_manage_heads && city.head_id !== baseline.head_id) return true;
    return !canEditWorldCity(data, city.id) && (city.name !== baseline.name || JSON.stringify(city.districts) !== JSON.stringify(baseline.districts));
  });
}

export function supervisorAssignment(settings: WorldSaveSettings, supervisorId: number, exceptDistrict: string, data?: WorldEditorData): string | null {
  const supervisorGroups = data?.supervisors.find(person => person.id === supervisorId)?.group_ids ?? [];
  for (const city of settings.cities) {
    const district = city.districts.find(item => {
      if (item.id === exceptDistrict) return false;
      if (item.supervisor_id === supervisorId) return true;
      if (item.supervisor_id !== undefined) return false;
      const legacy = data?.cities.find(saved => saved.id === city.id)?.districts.find(saved => saved.id === item.id);
      return legacy?.group_ids.some(id => supervisorGroups.includes(id));
    });
    if (district) return `${district.name} · ${city.name}`;
  }
  return null;
}

/** Assignment changes affect both cities, personal inventory and staff reports. */
export const WORLD_QUERY_KEYS = ["city-world", "city-world-settings", "city-estate", "city-estates", "city-estates-report", "city", "city-groups", "city-participants"] as const;
