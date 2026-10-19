import { request } from "./client";

export type CloudVoiceProvider = "yandex" | "google" | "azure";
export type VoiceLanguage = "ru" | "kk";
export type VoiceProvider = CloudVoiceProvider | "browser";
export interface VoiceSpeechProvider { id: CloudVoiceProvider; label: string; voice: string }
export interface VoiceSpeechConfig { default_provider: VoiceProvider; providers: VoiceSpeechProvider[] }
export interface VoiceSpeechAudio { audio_base64: string; mime_type: "audio/mpeg"; provider: CloudVoiceProvider; voice: string }

export type VoicePersona = "calm" | "confused" | "hurried" | "irritated" | "aggressive";
export interface VoiceScenario { key: string; title: string; description: string; minutes: number; languages?: { key: VoiceLanguage; label: string }[]; custom?: boolean }
export interface VoiceAttemptSummary {
  id: number; scenario_key: string; title: string; persona: VoicePersona; language?: VoiceLanguage;
  state: "in_progress" | "completed"; stage: string; turn: number;
  score: number | null; created_at: string; finished_at: string | null;
  review_status: "pending" | "reviewed" | "awaiting_grade" | null;
  channel?: VoiceChannel;
  /** Claude spoke for the driver; Claude graded the call (or gave its review beside the rules'). */
  ai_driver?: boolean; ai_grade?: boolean;
}
/** «oktell»: the driver called the operator's Oktell; «page»: a call started on the trainer page before. */
export type VoiceChannel = "oktell" | "page";
/** `ai`: a driver's line said by Claude; without it the trainer's prepared line was said. */
export interface VoiceTranscript { role: "driver" | "operator"; text: string; turn: number; ai?: boolean }
export interface VoiceCriterion {
  key: string; label: string; passed: boolean; feedback: string;
  quote: string | null; turn: number | null; role?: "driver" | "operator"; example: string | null;
}
export interface VoiceResult {
  /** null while a mentor has not graded a call from the scenario editor. */
  score: number | null; criteria: VoiceCriterion[];
  critical_errors: { text: string; quote: string; turn: number }[];
  review_status?: "pending" | "reviewed" | "awaiting_grade" | null; mentor_comment?: string | null; mentor_name?: string;
  /** A scenario from the editor: the score is the mentor's, the steps show what the trainer understood. */
  manual?: boolean; solution?: string; reached_end?: boolean;
  /** Graded by the AI model from the scenario card; a mentor answers a dispute. */
  ai?: boolean; model?: string; summary?: string;
  /** A call the rules graded, sent to Claude afterwards: its grade stands beside this one. */
  ai_review?: VoiceResult | null; rules_score?: number;
}
/** For mentors: whether Claude plays the editor's drivers and grades their calls, and its spend. */
export interface VoiceAIStatus { configured: boolean; active: boolean; model: string; budget_usd: number; spent_usd: number; calls: number }
export interface VoiceAttempt {
  id: number; scenario_key: string; title: string; description: string; revision: number;
  persona: VoicePersona; language?: VoiceLanguage; state: "in_progress" | "completed";
  stage: "opening" | "lost_sim" | "clarify" | "next_step" | "resolved";
  turn: number; driver: { id: string; name: string; phone: string; park_id: string; park: string };
  incoming_phone: string; transcript: VoiceTranscript[];
  practice: { dispatch: boolean; oktell: boolean; compared: boolean };
  result: VoiceResult | null; can_finish: boolean; retry_of?: number | null;
  /** A scenario from the editor: no training systems, the author's notes instead. */
  custom?: boolean; notes?: string; channel?: VoiceChannel;
  /** Claude spoke for the driver in this call. */
  ai_driver?: boolean;
  created_at: string; finished_at: string | null;
}
/** A finished call in brief: the best or the hardest one. */
export interface VoiceCallBrief { id: number; title: string; persona: VoicePersona; score: number; created_at: string }
/** A criterion missed in recent calls: how often it was met and how it could have been said. */
export interface VoiceSkill { label: string; passed: number; total: number; example: string | null; attempt_id: number | null }
/** The operator's own picture over his graded calls. */
export interface VoiceProgress {
  calls: number; calls_30d: number; average: number | null; average_30d: number | null;
  best: VoiceCallBrief | null; worst: VoiceCallBrief | null; weak: VoiceSkill[];
}
/** `ai_active`: Claude takes part in calls right now (connected, within the month's budget). */
export interface VoiceCatalog { scenarios: VoiceScenario[]; attempts: VoiceAttemptSummary[]; ai_active?: boolean; progress?: VoiceProgress }

/** Who gave a call its score; «awaiting» while a mentor has not graded a call from the editor. */
export type VoiceGrader = "ai" | "rules" | "mentor" | "awaiting";
export type VoicePeriod = 7 | 30 | 90;
/** One call of the team in a leader's list. */
export interface VoiceTeamCall {
  id: number; user_id: number; user_name: string; group_name: string | null; title: string; custom: boolean;
  persona: VoicePersona; language: VoiceLanguage; state: "in_progress" | "completed";
  score: number | null; grader: VoiceGrader | null; review_status: VoiceAttemptSummary["review_status"];
  critical: boolean; ai_driver: boolean; ai_review: number | null; created_at: string; finished_at: string | null;
  /** In the queue: the operator's words of the dispute and when he asked. */
  comment?: string; requested_at?: string;
}
export interface VoiceTeamOperator {
  id: number; name: string; role: "operator" | "trainee"; group_id: number | null; group_name: string | null;
  calls: number; average: number | null; change: number | null; best: number | null;
  last: { id: number; score: number | null; at: string } | null; ai_calls: number; waiting: number; weak: string[];
}
export interface VoiceTeam {
  period: { days: VoicePeriod; since: string; until: string };
  groups: { id: number; name: string }[]; group_id: number | null;
  summary: {
    calls: number; calls_before: number; average: number | null; average_before: number | null;
    operators: number; practiced: number; ai_graded: number; awaiting_grade: number; disputes: number; low: number;
  };
  operators: VoiceTeamOperator[]; skills: VoiceSkill[]; calls: VoiceTeamCall[]; queue: VoiceTeamCall[];
  ai: VoiceAIStatus; scenarios: number;
}
/** An operator's call as a leader opens it: the review, the operator, and whether it waits for him. */
export type VoiceTeamCallDetail = VoiceAttempt & {
  learner: { id: number; name: string; group_id: number | null; group_name: string | null };
  review: { comment: string; created_at: string; kind?: string } | null; needs_answer: boolean;
};
export interface VoiceInspection { system: "dispatch" | "oktell" | "compare"; driver_id?: string; park_id?: string; incoming_phone?: string; registration_phone?: string }

const BASE = "/api/v1/learning/voice";
const path = (id: string | number) => `${BASE}/attempts/${encodeURIComponent(id)}`;
export const voiceKeys = {
  catalog: ["learning-voice"] as const,
  speechConfig: (userId: string | number) => ["learning-voice-speech", String(userId)] as const,
  ai: (userId: string | number) => ["learning-voice-ai", String(userId)] as const,
  attempt: (id: string | number) => ["learning-voice-attempt", String(id)] as const,
  team: (userId: string | number, days: number, group: number | null) => ["learning-voice-team", String(userId), days, group ?? "all"] as const,
  teamCall: (id: string | number) => ["learning-voice-team-call", String(id)] as const,
};
export const voiceTraining = {
  speechConfig: (signal?: AbortSignal) => request<VoiceSpeechConfig>(`${BASE}/speech/config`, { signal, timeoutMs: 20000 }),
  speechPreview: (provider: CloudVoiceProvider, persona: VoicePersona, language: VoiceLanguage = "ru", signal?: AbortSignal) => request<VoiceSpeechAudio>(`${BASE}/speech/preview`, { method: "POST", json: { provider, persona, language }, signal, timeoutMs: 20000 }),
  speech: (id: string | number, provider: CloudVoiceProvider, turn: number, signal?: AbortSignal) => request<VoiceSpeechAudio>(`${path(id)}/speech`, { method: "POST", json: { provider, turn }, signal, timeoutMs: 20000 }),
  catalog: (signal?: AbortSignal) => request<VoiceCatalog>(BASE, { signal, timeoutMs: 15000 }),
  aiStatus: (signal?: AbortSignal) => request<VoiceAIStatus>(`${BASE}/ai`, { signal, timeoutMs: 15000 }),
  start: (scenarioKey: string, persona: VoicePersona, language: VoiceLanguage = "ru") => request<VoiceAttempt>(`${BASE}/start`, { method: "POST", json: { scenario_key: scenarioKey, persona, language }, timeoutMs: 20000 }),
  attempt: (id: string | number, signal?: AbortSignal) => request<VoiceAttempt>(path(id), { signal, timeoutMs: 15000 }),
  answer: (id: string | number, input: { request_id: string; turn: number; text: string }) => request<VoiceAttempt>(`${path(id)}/answer`, { method: "POST", json: input, timeoutMs: 30000 }),
  inspect: (id: string | number, input: VoiceInspection) => request<VoiceAttempt>(`${path(id)}/inspect`, { method: "POST", json: input, timeoutMs: 20000 }),
  finish: (id: string | number) => request<VoiceAttempt>(`${path(id)}/finish`, { method: "POST", json: {}, timeoutMs: 45000 }),
  retry: (id: string | number, turn: number) => request<VoiceAttempt>(`${path(id)}/retry`, { method: "POST", json: { turn }, timeoutMs: 20000 }),
  review: (id: string | number, comment: string) => request<VoiceAttempt>(`${path(id)}/review`, { method: "POST", json: { comment }, timeoutMs: 20000 }),
  /** «Оценить с ИИ»: Claude grades a finished call the rules graded; both grades stay. */
  aiReview: (id: string | number) => request<VoiceAttempt>(`${path(id)}/ai-review`, { method: "POST", json: {}, timeoutMs: 45000 }),
  /** Leaders: their operators over a period, optionally one group. */
  team: (days: VoicePeriod, groupId: number | null, signal?: AbortSignal) => request<VoiceTeam>(`${BASE}/team?days=${days}${groupId === null ? "" : `&group_id=${groupId}`}`, { signal, timeoutMs: 20000 }),
  teamCall: (id: string | number, signal?: AbortSignal) => request<VoiceTeamCallDetail>(`${BASE}/team/calls/${encodeURIComponent(id)}`, { signal, timeoutMs: 15000 }),
  teamAiReview: (id: string | number) => request<VoiceTeamCallDetail>(`${BASE}/team/calls/${encodeURIComponent(id)}/ai-review`, { method: "POST", json: {}, timeoutMs: 45000 }),
  /** A mentor's answer to a dispute, or the score of a call from the editor. */
  resolve: (id: string | number, comment: string, score: number | null) => request<VoiceTeamCallDetail>(`${BASE}/reviews/${encodeURIComponent(id)}/resolve`, { method: "POST", json: score === null ? { comment } : { comment, score }, timeoutMs: 20000 }),
};

export const OKTELL_CALLS = "/training/work-sites?site=oktell";
/** «Повторить момент»: the same driver rings again in Oktell, from the chosen answer. */
export function oktellRetry(attemptId: number, turn: number) {
  return `${OKTELL_CALLS}&voiceRetry=${encodeURIComponent(attemptId)}&voiceTurn=${encodeURIComponent(turn)}`;
}
