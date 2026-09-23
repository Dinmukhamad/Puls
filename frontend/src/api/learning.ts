import { buildQuery, request } from "./client";
import type { Page } from "./types";
import type { DriverScenario } from "./driverShift";

export type LearningKind = "test" | "mission" | "simulator";
// Temporary presentation policy: keep existing content and attempts in storage.
export const VISIBLE_LEARNING_KINDS: readonly LearningKind[] = ["simulator"];
export const visibleLearning = <T extends { kind: LearningKind }>(items: T[]): T[] => items.filter(item => VISIBLE_LEARNING_KINDS.includes(item.kind));
export const learningKindFilter = (kind: string | null): "all" | "simulator" => kind === "simulator" ? "simulator" : "all";
export const visibleLearningFilters = (params: Record<string, unknown>) => ({ ...params, kind: "simulator" });
export interface LearningStep { speaker: string; text: string; options: string[]; correct?: number; explanation?: string }
export interface LearningContent {
  is_driver?: boolean; driver_config?: DriverScenario | null; assigned?: boolean;
  id: number; kind: LearningKind; title: string; description: string; world: string;
  difficulty: "basic" | "medium" | "advanced"; minutes: number; status: "draft" | "published" | "archived";
  is_required: boolean; deadline: string | null; allow_back: boolean; pass_percent: number; coins_reward: number; revision: number; step_count: number; steps?: LearningStep[];
  attempt_id?: number; state?: "new" | "in_progress" | "passed" | "failed"; completed?: boolean; answered?: number;
}
export type ContentInput = Omit<LearningContent, "id" | "revision" | "step_count" | "attempt_id" | "state" | "completed" | "answered" | "is_driver" | "assigned"> & { steps: LearningStep[] };
export interface LearningAttempt {
  is_preview?: boolean;
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
  preview: (id: number) => request<LearningAttempt>(`/api/v1/admin/learning/${id}/preview`, { method: "POST" }),
  assign: (id: number, json: { user_ids: number[]; all_operators: boolean; deadline: string | null }) => request<{ assigned: number; already_assigned: number; total: number }>(`/api/v1/admin/learning/${id}/assign`, { method: "POST", json }),
  analytics: (params: Record<string, unknown>) => request<TrainingAnalytics>(`/api/v1/admin/learning-analytics${buildQuery(visibleLearningFilters(params))}`),
  catalog: async () => visibleLearning(await request<LearningContent[]>("/api/v1/learning")),
  start: (id: number) => request<LearningAttempt>(`/api/v1/learning/${id}/start`, { method: "POST" }),
  attempt: (id: number) => request<LearningAttempt>(`/api/v1/learning/attempts/${id}`),
  answer: (id: number, step: number, answer: number) => request<LearningAttempt>(`/api/v1/learning/attempts/${id}/answer`, { method: "PUT", json: { step, answer } }),
  finish: (id: number) => request<LearningAttempt>(`/api/v1/learning/attempts/${id}/finish`, { method: "POST" }),
  simulator: (id: number, action: string) => request<LearningAttempt>(`/api/v1/learning/attempts/${id}/simulator`, { method: "POST", json: { action } }),
  definitions: async () => visibleLearning(await request<LearningContent[]>("/api/v1/admin/learning")),
  save: (data: ContentInput, id?: number) => request<LearningContent>(`/api/v1/admin/learning${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", json: data }),
  results: (params: { page?: number; user_id?: number; content_id?: number; kind?: LearningKind } = {}) => request<Page<LearningResult>>(`/api/v1/admin/learning-results${buildQuery(visibleLearningFilters(params))}`),
};
export interface TrainingAnalytics {
  summary: Record<string, number | null>;
  items: { user_id: number; full_name: string; login: string; content_id: number; title: string; kind: LearningKind; assigned: boolean; deadline: string | null; state: string; attempts: number; score: number | null; finished_at: string | null; errors: number; checks: { key: string; title: string; done: boolean; path: string }[] }[];
  questions: { content_id: number; title: string; revision: number; number: number; question: string; answers: number; errors: number; error_percent: number }[];
}
export const LEARNING_LABELS: Record<LearningKind, string> = { test: "Тесты", mission: "Миссии", simulator: "Driver Simulator" };
export const DIFFICULTY = { basic: "Начальная", medium: "Средняя", advanced: "Высокая" };
export function attemptPath(attempt: LearningAttempt) {
  return attempt.content.kind === "simulator" ? `/simulator/attempts/${attempt.id}` : `/training/attempts/${attempt.id}`;
}
