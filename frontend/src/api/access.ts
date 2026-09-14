import { buildQuery, request } from "./client";
import type { Page, Role } from "./types";

export type SectionCode = "personal" | "results" | "training" | "rewards" | "overview" | "team" | "analytics" | "performance" | "learning_admin" | "motivation" | "reports" | "system";
export type AccessMap = Partial<Record<SectionCode, boolean>>;
export type TargetType = "all" | "role" | "group" | "user";
export type Effect = "allow" | "deny" | "inherit";
export interface SectionDefinition { code: SectionCode; title: string; description: string; defaults: Role[]; admin_only: boolean }
export interface AccessState {
  capabilities: { manage_sessions: boolean };
  allowed: AccessMap;
  decisions: Record<SectionCode, { allowed: boolean; source: TargetType | "default" | "admin_only" }>;
  revision: number;
  role: Role;
  group_id: number | null;
  scope_groups?: number[];
}
export interface AccessRule { target_type: TargetType; target_id: string; section: SectionCode; effect: Exclude<Effect, "inherit"> }
export interface AccessPolicy { revision: number; sections: SectionDefinition[]; rules: AccessRule[] }
export interface AccessUpdate { revision: number; target_type: TargetType; target_ids: string[]; changes: { section: SectionCode; effect: Effect }[] }
export interface AccessSubject { id: string; name: string; role: Role | null; is_active: boolean }
export interface AccessPreviewSection {
  state: "on" | "off" | "mixed";
  before_state: "on" | "off" | "mixed";
  effect: Effect | "mixed";
  has_override: boolean;
  original_override: boolean;
  sources: Partial<Record<TargetType | "default" | "admin_only", number>>;
  before_allowed: number;
  after_allowed: number;
  changed: number;
  exceptions: number;
  locked: boolean;
}
export interface AccessPreview { revision: number; total: number; sections: Record<SectionCode, AccessPreviewSection> }
export interface UserOption { id: number; user_id: number; full_name: string; role: Role; group_name: string | null }

export const accessApi = {
  mine: (signal?: AbortSignal) => request<AccessState>("/api/v1/me/access", { signal }),
  policy: (signal?: AbortSignal) => request<AccessPolicy>("/api/v1/admin/access", { signal }),
  save: (json: AccessUpdate) => request<{ revision: number; detail: string }>("/api/v1/admin/access", { method: "PUT", json }),
  preview: (json: AccessUpdate, signal?: AbortSignal) => request<AccessPreview>("/api/v1/admin/access/preview", { method: "POST", json, signal }),
  subjects: (kind: "user" | "group", search: string, page = 1, signal?: AbortSignal) => request<Page<AccessSubject>>(`/api/v1/admin/access/subjects${buildQuery({ kind, search, page, size: 20 })}`, { signal }),
  inspect: (id: string, signal?: AbortSignal) => request<AccessState & { user_id: number; full_name: string }>(`/api/v1/admin/access/users/${id}`, { signal }),
};

export const lookups = {
  users: (params: { search?: string; size?: number; role?: Role }, signal?: AbortSignal) => request<Page<UserOption>>(`/api/v1/lookups/users${buildQuery(params)}`, { signal }),
  operators: (params: { search?: string; size?: number }, signal?: AbortSignal) => lookups.users({ ...params, role: "operator" }, signal),
  groups: () => request<{ id: number; name: string }[]>("/api/v1/lookups/groups"),
};
