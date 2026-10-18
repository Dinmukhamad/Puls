import { request } from "./client";
import type { VoiceLanguage } from "./voiceTraining";

/** A scenario the staff write in the editor (app/services/voice_scenarios.py). */
export interface ScenarioReply { keywords: string[]; driver: string; next: string }
export interface ScenarioStep { id: string; name: string; replies: ScenarioReply[]; fallback: string }
export interface ScenarioForbidden { keywords: string[]; text: string; driver: string }
export interface ScenarioContent {
  title: string; description: string; language: VoiceLanguage; minutes: number;
  driver: { name: string; phone: string; park: string }; notes: string; solution: string;
  opening: string; steps: ScenarioStep[]; forbidden: ScenarioForbidden[];
}
export type ScenarioStatus = "draft" | "published" | "changed" | "withdrawn";
export interface ScenarioSummary {
  id: number; key: string; title: string; language: VoiceLanguage; status: ScenarioStatus; revision: number; steps: number;
  updated_at: string | null; updated_by: string | null; published_at: string | null; published_by: string | null;
}
export interface ScenarioDetail extends ScenarioSummary {
  draft: ScenarioContent; draft_version: number; published: ScenarioContent | null;
  problems: string[]; unreachable: string[]; created_by: string | null;
}
export interface ScenarioTurn {
  role: "driver" | "operator"; text: string; stage?: string; step?: string | null;
  keyword?: string | null; fallback?: boolean; forbidden?: { text: string; keyword: string }[];
}
export interface ScenarioRun { turns: ScenarioTurn[]; stage: string | null; resolved: boolean; problems: string[]; unreachable: string[] }

const BASE = "/api/v1/admin/learning/voice-scenarios";
export const scenarioKeys = {
  list: ["voice-scenarios"] as const,
  detail: (id: string | number) => ["voice-scenario", String(id)] as const,
};
export const voiceScenarios = {
  list: (signal?: AbortSignal) => request<{ scenarios: ScenarioSummary[] }>(BASE, { signal, timeoutMs: 15000 }),
  create: () => request<ScenarioDetail>(BASE, { method: "POST", json: {}, timeoutMs: 15000 }),
  get: (id: string | number, signal?: AbortSignal) => request<ScenarioDetail>(`${BASE}/${encodeURIComponent(id)}`, { signal, timeoutMs: 15000 }),
  save: (id: string | number, draftVersion: number, content: ScenarioContent) => request<ScenarioDetail>(`${BASE}/${encodeURIComponent(id)}`, { method: "PUT", json: { draft_version: draftVersion, content }, timeoutMs: 20000 }),
  publish: (id: string | number, draftVersion: number) => request<ScenarioDetail>(`${BASE}/${encodeURIComponent(id)}/publish`, { method: "POST", json: { draft_version: draftVersion }, timeoutMs: 20000 }),
  withdraw: (id: string | number) => request<ScenarioDetail>(`${BASE}/${encodeURIComponent(id)}/withdraw`, { method: "POST", json: {}, timeoutMs: 20000 }),
  remove: (id: string | number) => request<{ deleted: number }>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE", timeoutMs: 20000 }),
  test: (content: ScenarioContent, answers: string[], signal?: AbortSignal) => request<ScenarioRun>(`${BASE}/test`, { method: "POST", json: { content, answers }, signal, timeoutMs: 15000 }),
};

/** The next free step id: s1, s2, … (ids stay put when steps move or go). */
export function nextStepId(steps: readonly ScenarioStep[]): string {
  const used = new Set(steps.map(step => step.id));
  let n = steps.length + 1;
  while (used.has(`s${n}`)) n += 1;
  for (let i = 1; i < n; i += 1) if (!used.has(`s${i}`)) return `s${i}`;
  return `s${n}`;
}

/** A step leaves; the answers that led to it now lead nowhere and must be pointed again. */
export function removeStep(content: ScenarioContent, id: string): ScenarioContent {
  return {
    ...content,
    steps: content.steps.filter(step => step.id !== id).map(step => ({
      ...step, replies: step.replies.map(reply => reply.next === id ? { ...reply, next: "" } : reply),
    })),
  };
}

/** Keywords from typed or pasted text: commas, semicolons and new lines separate them. */
export function splitKeywords(text: string): string[] {
  return text.split(/[,;\n]+/).map(item => item.trim().replace(/\s+/g, " ")).filter(Boolean);
}
