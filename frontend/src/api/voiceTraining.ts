import { request } from "./client";

export type VoicePersona = "calm" | "confused" | "hurried" | "irritated";
export interface VoiceScenario { key: string; title: string; description: string; minutes: number }
export interface VoiceAttemptSummary {
  id: number; scenario_key: string; title: string; persona: VoicePersona;
  state: "in_progress" | "completed"; stage: string; turn: number;
  score: number | null; created_at: string; finished_at: string | null;
  review_status: "pending" | "reviewed" | null;
}
export interface VoiceTranscript { role: "driver" | "operator"; text: string; turn: number }
export interface VoiceCriterion {
  key: string; label: string; passed: boolean; feedback: string;
  quote: string | null; turn: number | null; role?: "driver" | "operator"; example: string;
}
export interface VoiceResult {
  score: number; criteria: VoiceCriterion[];
  critical_errors: { text: string; quote: string; turn: number }[];
  review_status?: "pending" | "reviewed" | null; mentor_comment?: string | null;
}
export interface VoiceAttempt {
  id: number; scenario_key: string; title: string; description: string; revision: number;
  persona: VoicePersona; state: "in_progress" | "completed";
  stage: "opening" | "lost_sim" | "clarify" | "next_step" | "resolved";
  turn: number; driver: { id: string; name: string; phone: string; park_id: string; park: string };
  incoming_phone: string; transcript: VoiceTranscript[];
  practice: { dispatch: boolean; oktell: boolean; compared: boolean };
  result: VoiceResult | null; can_finish: boolean; retry_of?: number | null;
  created_at: string; finished_at: string | null;
}
export interface VoiceCatalog { scenarios: VoiceScenario[]; attempts: VoiceAttemptSummary[] }
export interface VoiceInspection { system: "dispatch" | "oktell" | "compare"; driver_id?: string; park_id?: string; incoming_phone?: string; registration_phone?: string }

const BASE = "/api/v1/learning/voice";
const path = (id: string | number) => `${BASE}/attempts/${encodeURIComponent(id)}`;
export const voiceKeys = {
  catalog: ["learning-voice"] as const,
  attempt: (id: string | number) => ["learning-voice-attempt", String(id)] as const,
};
export const voiceTraining = {
  catalog: (signal?: AbortSignal) => request<VoiceCatalog>(BASE, { signal, timeoutMs: 15000 }),
  start: (scenarioKey: string, persona: VoicePersona) => request<VoiceAttempt>(`${BASE}/start`, { method: "POST", json: { scenario_key: scenarioKey, persona }, timeoutMs: 20000 }),
  attempt: (id: string | number, signal?: AbortSignal) => request<VoiceAttempt>(path(id), { signal, timeoutMs: 15000 }),
  answer: (id: string | number, input: { request_id: string; turn: number; text: string }) => request<VoiceAttempt>(`${path(id)}/answer`, { method: "POST", json: input, timeoutMs: 25000 }),
  inspect: (id: string | number, input: VoiceInspection) => request<VoiceAttempt>(`${path(id)}/inspect`, { method: "POST", json: input, timeoutMs: 20000 }),
  finish: (id: string | number) => request<VoiceAttempt>(`${path(id)}/finish`, { method: "POST", json: {}, timeoutMs: 20000 }),
  retry: (id: string | number, turn: number) => request<VoiceAttempt>(`${path(id)}/retry`, { method: "POST", json: { turn }, timeoutMs: 20000 }),
  review: (id: string | number, comment: string) => request<VoiceAttempt>(`${path(id)}/review`, { method: "POST", json: { comment }, timeoutMs: 20000 }),
};

/** Open a work site in the same saved voice attempt. Account selection remains a training action. */
export function voiceWorkSite(attempt: Pick<VoiceAttempt, "id" | "driver">, site: "crm" | "dispatch" | "oktell") {
  const params = new URLSearchParams({ site, voiceAttempt: String(attempt.id) });
  if (site === "dispatch") { params.set("fleet", "contractors"); params.set("fpark", attempt.driver.park_id); }
  if (site === "oktell") params.set("oscreen", "phone");
  return `/training/work-sites?${params}`;
}
