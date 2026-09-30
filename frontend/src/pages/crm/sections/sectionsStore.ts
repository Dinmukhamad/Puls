/** Each participant's own copy of the CRM sections «Акции», «ЭДО» and «Регистрация водителей». */
import type { TrainingDriver } from "../drivers/driverData";
import { seedParticipants, type Backdated, type ConditionAdd, type Participant } from "./promoData";
import { seedRegistrations, type Registration } from "./registrationData";
import { seedEdo, seedProvider, type EdoRow, type ProviderRow } from "./edoData";

export interface SectionsState {
  version: 1; nextId: number;
  participants: Participant[]; backdated: Backdated[]; conditionAdds: ConditionAdd[];
  registrations: Registration[]; edo: EdoRow[]; provider: ProviderRow[];
}
export type SectionGroup = "promo" | "registration" | "edo";

export function seedSections(drivers: TrainingDriver[]): SectionsState {
  return { version: 1, nextId: 20_000, participants: seedParticipants(drivers), backdated: [], conditionAdds: [], registrations: seedRegistrations(), edo: seedEdo(), provider: seedProvider() };
}
/** Starts one group of sections over; the others keep the operator's work. */
export function resetGroup(state: SectionsState, group: SectionGroup, drivers: TrainingDriver[]): SectionsState {
  const fresh = seedSections(drivers);
  if (group === "promo") return { ...state, participants: fresh.participants, backdated: [], conditionAdds: [] };
  if (group === "registration") return { ...state, registrations: fresh.registrations };
  return { ...state, edo: fresh.edo, provider: fresh.provider };
}

// v2: the drivers are the fleet accounts of «Диспетчерская»; v1 copies named parks and accounts that are gone.
export const sectionsKey = (userId?: number) => `crm-sections:v2:${userId ?? "guest"}`;
/** The saved copy, or a fresh one once the fleet's drivers are known; null while they load. */
export function loadSections(userId: number | undefined, drivers: TrainingDriver[]): SectionsState | null {
  try {
    const saved = JSON.parse(localStorage.getItem(sectionsKey(userId)) ?? "null");
    if (saved?.version === 1 && ["participants", "backdated", "conditionAdds", "registrations", "edo", "provider"].every(k => Array.isArray(saved[k]))) return saved;
  } catch { /* A broken or blocked store falls back to fresh data. */ }
  return drivers.length ? seedSections(drivers) : null;
}
export function saveSections(userId: number | undefined, state: SectionsState) {
  try { localStorage.setItem(sectionsKey(userId), JSON.stringify(state)); } catch { /* Practice still works for this visit. */ }
}
