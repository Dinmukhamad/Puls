import { buildQuery, request } from "./client";
import type { Page } from "./types";

export type LearningKind = "test" | "mission" | "simulator";
export interface LearningStep { speaker: string; text: string; options: string[]; correct?: number; explanation?: string }
export interface LearningContent {
  id: number; kind: LearningKind; title: string; description: string; world: string;
  difficulty: "basic" | "medium" | "advanced"; minutes: number; status: "draft" | "published" | "archived";
  is_required: boolean; deadline: string | null; allow_back: boolean; pass_percent: number; coins_reward: number; revision: number; step_count: number; steps?: LearningStep[];
  attempt_id?: number; state?: "new" | "in_progress" | "passed" | "failed"; completed?: boolean; answered?: number;
}
export type ContentInput = Omit<LearningContent, "id" | "revision" | "step_count" | "attempt_id" | "state" | "completed" | "answered"> & { steps: LearningStep[] };
export interface LearningAttempt {
  id: number; content_id: number; content: LearningContent & { steps: LearningStep[] };
  answers: Record<string, number>; state: "in_progress" | "passed" | "failed"; sim_stage: string;
  score: number | null; correct: number | null; awarded_coins: number; finished_at: string | null;
}
export interface LearningResult {
  id: number; user_id: number; full_name: string; content_id: number; title: string; kind: LearningKind;
  state: string; answered: number; total: number; score: number | null;
  awarded_coins: number; finished_at: string | null;
}
export const learning = {
  catalog: () => request<LearningContent[]>("/api/v1/learning"),
  start: (id: number) => request<LearningAttempt>(`/api/v1/learning/${id}/start`, { method: "POST" }),
  attempt: (id: number) => request<LearningAttempt>(`/api/v1/learning/attempts/${id}`),
  answer: (id: number, step: number, answer: number) => request<LearningAttempt>(`/api/v1/learning/attempts/${id}/answer`, { method: "PUT", json: { step, answer } }),
  finish: (id: number) => request<LearningAttempt>(`/api/v1/learning/attempts/${id}/finish`, { method: "POST" }),
  simulator: (id: number, action: string) => request<LearningAttempt>(`/api/v1/learning/attempts/${id}/simulator`, { method: "POST", json: { action } }),
  definitions: () => request<LearningContent[]>("/api/v1/admin/learning"),
  save: (data: ContentInput, id?: number) => request<LearningContent>(`/api/v1/admin/learning${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", json: data }),
  results: (params: { page?: number; user_id?: number; content_id?: number; kind?: LearningKind } = {}) => request<Page<LearningResult>>(`/api/v1/admin/learning-results${buildQuery(params)}`),
};
export const LEARNING_LABELS: Record<LearningKind, string> = { test: "Тесты", mission: "Миссии", simulator: "Driver Simulator" };
export const DIFFICULTY = { basic: "Начальная", medium: "Средняя", advanced: "Высокая" };
export function attemptPath(attempt: LearningAttempt) {
  return attempt.content.kind === "simulator" ? `/simulator/attempts/${attempt.id}` : `/training/attempts/${attempt.id}`;
}
