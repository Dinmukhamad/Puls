import { request } from "./client";

export interface ScenarioSummary {
  key: string; title: string; description: string; minutes: number; revision: number;
  pass_percent: number; critical_required: boolean; coins_reward: number;
  completed: boolean; enabled: boolean; attempt_id: number | null; state: "new" | "in_progress" | "passed" | "failed" | null;
}
export interface ScenarioCatalog { items: ScenarioSummary[]; is_preview: boolean; city: "support" }
export interface ScenarioStep { speaker: string; text: string; options: string[]; critical: boolean; kind?: "reply" | "action"; prompt?: string; resource?: "classifier" | "office"; explanation?: string; answered_correctly?: boolean }
export interface ScenarioDriver { id: string; name: string; phone: string; license_number: string; park_id: string; park: string; city: string }
export interface ScenarioClassifierEntry { brand: string; model: string; min_year: number; colors: string[] }
export interface ScenarioAttempt {
  id: number; scenario_key: string; revision: number; state: "in_progress" | "passed" | "failed";
  title: string; description: string; opening_message?: string | null;
  phase: "dialogue" | "dispatch" | "crm" | "complete"; current_step: number;
  steps: ScenarioStep[]; answers: Record<number, number>; first_answers?: Record<number, number>; feedback: { correct: boolean; explanation: string } | null;
  practice: { dispatch: boolean; crm: boolean; crm_appeal_id?: number | null; inspections?: { profile: boolean; car: boolean; classifier?: boolean }; required_section?: "profile" | "car" | "classifier" | null };
  driver: ScenarioDriver;
  classifier: { title: string; checked_on: string; source_url: string; notice: string; min_rating?: number; entries: ScenarioClassifierEntry[] };
  office?: { name: string; address: string; hours: string; notice: string } | null;
  crm_requirements: { key: string; label: string }[];
  coins_reward: number; awarded_coins: number; reward_already_claimed: boolean; score: number | null;
  pass_percent: number; is_preview: boolean; finished_at: string | null;
}
export interface ScenarioDispatchInput { driver_id: string; license_number: string; brand: string; model: string; year: number; color: string; employment: string; park: string; city: string; classification_result: "not_confirmed" | "confirmed" }
export interface ScenarioInspectionInput { driver_id: string; park_id: string; section: "profile" | "car" | "classifier"; classification_result?: "eligible" | "not_eligible" }

const BASE = "/api/v1/learning/scenarios";
const attemptPath = (id: string | number) => `${BASE}/attempts/${encodeURIComponent(id)}`;
export const scenarioKeys = {
  catalog: ["learning-scenarios"] as const,
  attempt: (id: string | number) => ["learning-scenario-attempt", String(id)] as const,
};
export const scenarios = {
  catalog: (signal?: AbortSignal) => request<ScenarioCatalog>(BASE, { signal, timeoutMs: 15000 }),
  start: (key: string) => request<ScenarioAttempt>(`${BASE}/${encodeURIComponent(key)}/start`, { method: "POST", json: {}, timeoutMs: 20000 }),
  attempt: (id: string | number, signal?: AbortSignal) => request<ScenarioAttempt>(attemptPath(id), { signal, timeoutMs: 15000 }),
  answer: (id: string | number, step: number, answer: number) => request<ScenarioAttempt>(`${attemptPath(id)}/answer`, { method: "PUT", json: { step, answer }, timeoutMs: 20000 }),
  dispatchCheck: (id: string | number, input: ScenarioDispatchInput) => request<ScenarioAttempt>(`${attemptPath(id)}/dispatch-check`, { method: "POST", json: input, timeoutMs: 20000 }),
  inspect: (id: string | number, input: ScenarioInspectionInput) => request<ScenarioAttempt>(`${attemptPath(id)}/inspect`, { method: "POST", json: input, timeoutMs: 20000 }),
  crmCheck: (id: string | number, appealId: number) => request<ScenarioAttempt>(`${attemptPath(id)}/crm-check`, { method: "POST", json: { appeal_id: appealId }, timeoutMs: 20000 }),
  finish: (id: string | number) => request<ScenarioAttempt>(`${attemptPath(id)}/finish`, { method: "POST", json: {}, timeoutMs: 20000 }),
};

/** Navigation stays in the same server attempt across both training sites. */
const workspaceKey = (actor: number | string, attempt: number | string) => `scenario-workspace:${actor}:${attempt}`;
const workspaceFields = ["site", "view", "appeal", "driver", "screen", "fleet", "fpark"];
export function rememberScenarioWorkspace(actor: number | string, attempt: number | string, params: URLSearchParams) {
  const saved = new URLSearchParams();
  for (const key of workspaceFields) { const value = params.get(key); if (value) saved.set(key, value); }
  try { sessionStorage.setItem(workspaceKey(actor, attempt), saved.toString()); } catch { /* Optional navigation memory. */ }
}
export function scenarioWorkSite(attempt: Pick<ScenarioAttempt, "id" | "driver"> & Partial<Pick<ScenarioAttempt, "revision" | "practice">>, site: "crm" | "dispatch", actor?: number | string) {
  let saved = "";
  try { if (actor !== undefined) saved = sessionStorage.getItem(workspaceKey(actor, attempt.id)) ?? ""; } catch { /* Navigation still works without browser storage. */ }
  const params = new URLSearchParams();
  const previous = new URLSearchParams(saved);
  for (const key of workspaceFields) { const value = previous.get(key); if (value) params.set(key, value); }
  params.set("scenarioAttempt", String(attempt.id));
  params.set("site", site);
  if (site === "dispatch") {
    if (params.has("fleet")) return `/training/work-sites?${params}`;
    if ((attempt.revision ?? 1) < 2 || attempt.practice?.inspections?.profile) {
      params.set("fleet", `driver/${attempt.driver.id}`); params.set("fpark", attempt.driver.park_id);
    } else params.set("fleet", "contractors");
  } else if ((attempt.revision ?? 1) < 2) params.set("view", "create");
  return `/training/work-sites?${params}`;
}

export function preserveScenarioContext(next: URLSearchParams, current: URLSearchParams) {
  const id = current.get("scenarioAttempt");
  if (id) next.set("scenarioAttempt", id);
  return next;
}
