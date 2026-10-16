import { request } from "./client";

export type CrmTaskKey = "crm_first" | "crm_phone" | "crm_closed";
export interface CrmTrainingCheck { key: string; label: string; ok: boolean; message: string }
export interface CrmTrainingStep { key: string; label: string; status: "pending" | "passed" | "failed" }
export interface CrmTrainingDriver { id: string; name: string; phone: string; license: string; park: string; city: string; link: string; new_phone?: string }
export interface CrmTrainingTask {
  key: CrmTaskKey; title: string; speech: string; goal: string;
  state: "available" | "in_progress" | "passed" | "locked";
  driver: CrmTrainingDriver; category_path: string[]; steps: CrmTrainingStep[]; checks: CrmTrainingCheck[];
  appeal_id: number | null; started_at: string | null; passed_at: string | null;
}
export interface CrmTrainingState {
  revision: number; completed: number; active_task: CrmTaskKey | null; tasks: CrmTrainingTask[];
  last_result?: { task_key: CrmTaskKey; appeal_id: number; passed: boolean; checks: CrmTrainingCheck[]; checked_at: string };
}
export const crmTrainingKey = (userId?: number) => ["crm-training", userId] as const;
export const crmTraining = {
  state: (signal?: AbortSignal) => request<CrmTrainingState>("/api/v1/learning/crm/training", { signal }),
  start: (key: CrmTaskKey) => request<CrmTrainingState>(`/api/v1/learning/crm/training/tasks/${key}/start`, { method: "POST", json: { request_id: crypto.randomUUID() } }),
  check: (key: CrmTaskKey, appealId: number, requestId: string) => request<CrmTrainingState>(`/api/v1/learning/crm/training/tasks/${key}/check`, { method: "POST", json: { appeal_id: appealId, request_id: requestId } }),
};
