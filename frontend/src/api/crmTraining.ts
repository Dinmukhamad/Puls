import { request } from "./client";

export type CrmTaskKey = "crm_first" | "crm_phone" | "crm_closed" | "crm_intro_v2" | "crm_phone_v2" | "crm_mismatch_v2" | "crm_rework_v2" | "crm_practice_v2";
export interface CrmCourseCapture { id: number; name: string; data_url: string }
export interface CrmTrainingCheck { key: string; label: string; ok: boolean; message: string }
export interface CrmTrainingStep { key: string; label: string; status: "pending" | "passed" | "failed" }
/** `type`: «Самозанятый водитель» or «Обычный водитель», where the category of the appeal starts. */
export interface CrmTrainingDriver { id: string; name: string; phone: string; license: string; park: string; city: string; link: string; new_phone?: string; type?: string }
export interface CrmTrainingTask {
  key: CrmTaskKey; title: string; speech: string; goal: string;
  state: "available" | "in_progress" | "passed" | "locked";
  driver: CrmTrainingDriver; category_path: string[]; steps: CrmTrainingStep[]; checks: CrmTrainingCheck[];
  appeal_id: number | null; started_at: string | null; passed_at: string | null;
  incoming_phone?: string; ticket_id?: number | null; capture?: CrmCourseCapture | null;
  call_form?: { note: string; result: string };
}
export interface CrmTrainingState {
  revision: number; completed: number; active_task: CrmTaskKey | null; tasks: CrmTrainingTask[];
  last_result?: { task_key: CrmTaskKey; appeal_id: number; passed: boolean; checks: CrmTrainingCheck[]; checked_at: string };
}
export const crmTrainingKey = (userId?: number) => ["crm-training", userId] as const;
export const crmTraining = {
  state: (signal?: AbortSignal) => request<CrmTrainingState>("/api/v1/learning/crm/course", { signal }),
  start: (key: CrmTaskKey) => request<CrmTrainingState>(`/api/v1/learning/crm/course/tasks/${key}/start`, { method: "POST" }),
  action: (key: CrmTaskKey, input: { action: "list" | "inspect" | "advice" | "call_form"; driver_id?: string; choices?: string[]; note?: string; call_result?: string }) => request<CrmTrainingState>(`/api/v1/learning/crm/course/tasks/${key}/actions`, { method: "POST", json: input }),
  capture: (key: CrmTaskKey, image: Blob) => { const multipart = new FormData(); multipart.append("file", image, "call.png"); return request<CrmTrainingState>(`/api/v1/learning/crm/course/tasks/${key}/capture`, { method: "POST", multipart }); },
  check: (key: CrmTaskKey, appealId: number, requestId: string) => request<CrmTrainingState>(`/api/v1/learning/crm/training/tasks/${key}/check`, { method: "POST", json: { appeal_id: appealId, request_id: requestId } }),
};
