import { buildQuery, downloadFile, request } from "./client";

export interface CrmCategory { id: string; parent_id: string | null; label: string; hint: string; rules: string[]; disabled: boolean; custom: boolean }
export interface CrmInstruction { key: string; title: string; body: string; steps: string[]; revision: number }
export interface CrmCatalog { parks: string[]; cities: string[]; categories: CrmCategory[]; instructions: Record<string, CrmInstruction> }
export interface CrmInput {
  request_id: string; channel: string; phone: string; license_number: string; driver_id: string;
  contacted_at: string; park: string; city: string; category_ids: string[]; details: Record<string, string>;
  comment: string; is_ticket: boolean;
}
export interface CrmAppeal extends Omit<CrmInput, "request_id"> {
  id: number; author_id: number; author_name: string; category_labels: string[];
  status: string; created_at: string; attachments: { id: number; name: string; mime: string; size: number }[];
}
export const CRM_STATUS: Record<string, string> = { recorded: "Зафиксировано", new: "Новый тикет", in_progress: "В работе", closed: "Закрыт" };
export const CRM_FIELDS: Record<string, string> = { company: "Название компании", callback: "Номер для обратного звонка", service: "Предлагаемая услуга", employee: "Имя сотрудника", transaction: "Транзакция / РРН", conditions: "Условия работы", error_description: "Описание ошибки" };
export const crm = {
  catalog: () => request<CrmCatalog>("/api/v1/learning/crm/catalog"),
  instruction: ({ key, ...input }: CrmInstruction) => request<CrmInstruction>(`/api/v1/admin/learning/crm/instructions/${encodeURIComponent(key)}`, { method: "PUT", json: input }),
  list: (params: Record<string, unknown>) => request<{ items: CrmAppeal[]; total: number; page: number; size: number; counts: Record<string, number> }>(`/api/v1/learning/crm/appeals${buildQuery(params)}`),
  appeal: (id: number) => request<CrmAppeal>(`/api/v1/learning/crm/appeals/${id}`),
  create: (input: CrmInput, files: File[]) => {
    const multipart = new FormData(); multipart.append("payload", JSON.stringify(input));
    files.forEach(file => multipart.append("files", file));
    return request<CrmAppeal>("/api/v1/learning/crm/appeals", { method: "POST", multipart });
  },
  category: (input: { label: string; parent_id: string | null; hint: string }) => request<CrmCategory>("/api/v1/admin/learning/crm/categories", { method: "POST", json: input }),
  status: (id: number, status: string) => request<CrmAppeal>(`/api/v1/admin/learning/crm/appeals/${id}/status`, { method: "PATCH", json: { status } }),
  download: (id: number, name: string) => downloadFile(`/api/v1/learning/crm/attachments/${id}`, name),
};

export function selectedCategories(nodes: CrmCategory[], ids: string[]) { return ids.map(id => nodes.find(node => node.id === id)).filter((node): node is CrmCategory => !!node); }
export function categoryRules(nodes: CrmCategory[], ids: string[]) { return new Set(selectedCategories(nodes, ids).flatMap(node => node.rules)); }
export function extraFields(rules: Set<string>) {
  return [...(rules.has("cooperation") ? ["company", "callback", "service"] : []), ...(rules.has("employee") ? ["employee"] : []), ...(rules.has("transaction") ? ["transaction"] : []), ...(rules.has("conditions") ? ["conditions"] : []), ...(rules.has("error_description") ? ["error_description"] : [])];
}
