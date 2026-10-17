import { buildQuery, request } from "./client";
import type { CrmAttachment, CrmInput } from "./crm";

export interface CrmDraft {
  draft_key: string | null;
  task: string | null;
  revision: number;
  form: Partial<CrmInput>;
  attachments: CrmAttachment[];
  updated_at: string | null;
  appeal_id?: number | null;
  remove_appeal_attachment_ids?: number[];
}
export interface CrmDraftWrite {
  task?: string;
  draft_key: string | null;
  revision: number;
  form: CrmInput;
  remove_attachment_ids: number[];
  appeal_id?: number;
  remove_appeal_attachment_ids: number[];
}
const path = (task?: string) => `/api/v1/learning/crm/draft${buildQuery({ task })}`;
export const crmDraftApi = {
  loadTicket: (id: number) => request<CrmDraft>(`/api/v1/learning/crm/tickets/${id}/draft`),
  saveTicket: (id: number, write: CrmDraftWrite, files: File[]) => {
    const multipart = new FormData(); multipart.append("payload", JSON.stringify({ ...write, task: undefined }));
    files.forEach(file => multipart.append("files", file));
    return request<CrmDraft>(`/api/v1/learning/crm/tickets/${id}/draft`, { method: "PUT", multipart });
  },
  load: (task?: string) => request<CrmDraft>(path(task)),
  save: (write: CrmDraftWrite, files: File[]) => {
    const multipart = new FormData();
    multipart.append("payload", JSON.stringify(write));
    files.forEach(file => multipart.append("files", file));
    return request<CrmDraft>(path(write.task), { method: "PUT", multipart });
  },
  clear: (task?: string) => request<void>(path(task), { method: "DELETE" }),
};
