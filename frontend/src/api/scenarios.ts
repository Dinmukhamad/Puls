import { request } from "./client";

export interface ScenarioSummary {
  key: string; title: string; description: string; minutes: number; revision: number;
  pass_percent: number; critical_required: boolean; coins_reward: number;
  completed: boolean; enabled: boolean; attempt_id: number | null; state: "new" | "in_progress" | "passed" | "failed" | null;
}
export interface ScenarioCatalog { items: ScenarioSummary[]; is_preview: boolean; city: "support" }
export interface ScenarioStep { speaker: string; text: string; options: string[]; critical: boolean; explanation?: string; answered_correctly?: boolean }
export interface ScenarioDriver { id: string; name: string; phone: string; license_number: string; park_id: string; park: string; city: string }
export interface ScenarioClassifierEntry { brand: string; model: string; min_year: number; colors: string[] }
export interface ScenarioAttempt {
  id: number; scenario_key: string; revision: number; state: "in_progress" | "passed" | "failed";
  title: string; description: string;
  phase: "dialogue" | "dispatch" | "crm" | "complete"; current_step: number;
  steps: ScenarioStep[]; answers: Record<number, number>; feedback: { correct: boolean; explanation: string } | null;
  practice: { dispatch: boolean; crm: boolean; crm_appeal_id?: number | null };
  driver: ScenarioDriver;
  classifier: { title: string; checked_on: string; source_url: string; notice: string; entries: ScenarioClassifierEntry[] };
  crm_requirements: { key: string; label: string }[];
  coins_reward: number; awarded_coins: number; reward_already_claimed: boolean; score: number | null;
  pass_percent: number; is_preview: boolean; finished_at: string | null;
}
export interface ScenarioDispatchInput { driver_id: string; license_number: string; brand: string; model: string; year: number; color: string; employment: string; park: string; city: string; classification_result: "not_confirmed" | "confirmed" }

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
  crmCheck: (id: string | number, appealId: number) => request<ScenarioAttempt>(`${attemptPath(id)}/crm-check`, { method: "POST", json: { appeal_id: appealId }, timeoutMs: 20000 }),
  finish: (id: string | number) => request<ScenarioAttempt>(`${attemptPath(id)}/finish`, { method: "POST", json: {}, timeoutMs: 20000 }),
};

/** Navigation stays in the same server attempt across both training sites. */
export function scenarioWorkSite(attempt: Pick<ScenarioAttempt, "id" | "driver">, site: "crm" | "dispatch") {
  const params = new URLSearchParams({ scenarioAttempt: String(attempt.id) });
  if (site === "dispatch") {
    params.set("site", "dispatch"); params.set("fleet", `driver/${attempt.driver.id}`); params.set("fpark", attempt.driver.park_id);
  } else params.set("view", "create");
  return `/training/work-sites?${params}`;
}

export function preserveScenarioContext(next: URLSearchParams, current: URLSearchParams) {
  const id = current.get("scenarioAttempt");
  if (id) next.set("scenarioAttempt", id);
  return next;
}
