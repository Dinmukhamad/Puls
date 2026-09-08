import { ApiError, buildQuery, request } from "./client";
import type { DashboardOut, Page, Role, ShopRequestOut, TransactionOut, UserBrief, UserOut } from "./types";

export interface TeamGroup {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  supervisor: UserBrief | null;
  member_count: number;
  operator_count: number;
}

export interface TeamUserInput {
  phone: string | null;
  full_name: string;
  email: string | null;
  role: Role;
  group_id: number | null;
  hired_on: string | null;
}

export interface TeamUserCreate extends TeamUserInput {
  login: string;
  password: string;
}

export interface TeamGroupInput {
  name: string;
  supervisor_id: number | null;
}

export const team = {
  users: (params: Record<string, unknown>, signal?: AbortSignal) =>
    request<Page<UserOut>>(`/api/v1/admin/users${buildQuery(params)}`, { signal }),
  user: (id: number) => request<UserOut>(`/api/v1/admin/users/${id}`),
  createUser: (json: TeamUserCreate) => request<UserOut>("/api/v1/admin/users", { method: "POST", json }),
  updateUser: (id: number, json: Partial<TeamUserInput> & { is_active?: boolean }) =>
    request<UserOut>(`/api/v1/admin/users/${id}`, { method: "PATCH", json }),
  resetPassword: (id: number, password: string) =>
    request<{ detail: string }>(`/api/v1/admin/users/${id}/password`, { method: "POST", json: { password } }),
  resetLogin: (id: number, login: string) =>
    request<UserOut>(`/api/v1/admin/users/${id}/login`, { method: "POST", json: { login } }),
  dashboard: (id: number, weekId?: number) =>
    request<DashboardOut>(`/api/v1/admin/users/${id}/dashboard${buildQuery({ week_id: weekId })}`),
  transactions: (id: number, page: number) =>
    request<Page<TransactionOut>>(`/api/v1/admin/users/${id}/transactions${buildQuery({ page, size: 20 })}`),
  purchases: (id: number, page: number) =>
    request<Page<ShopRequestOut>>(`/api/v1/admin/users/${id}/purchases${buildQuery({ page, size: 20 })}`),
  groups: () => request<TeamGroup[]>("/api/v1/admin/groups"),
  createGroup: (json: TeamGroupInput & { code: string }) =>
    request<TeamGroup>("/api/v1/admin/groups", { method: "POST", json }),
  updateGroup: (id: number, json: Partial<TeamGroupInput> & { is_active?: boolean }) =>
    request<TeamGroup>(`/api/v1/admin/groups/${id}`, { method: "PATCH", json }),
  supervisors: async () => {
    const items: UserOut[] = [];
    let page = 1;
    while (true) {
      const result = await team.users({ role: "supervisor", only_active: true, size: 100, page });
      items.push(...result.items);
      if (items.length >= result.total || result.items.length === 0) return items;
      page++;
    }
  },
};

export function teamError(error: unknown, fallback = "Не удалось сохранить изменения. Попробуйте ещё раз."): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "Нет соединения с сервером. Проверьте интернет и повторите попытку.";
    if (error.status === 404) return "Сотрудник или группа не найдены либо недоступны для вашей роли.";
    if (error.status === 403) return "Для этого действия недостаточно прав. Обратитесь к администратору.";
    if (error.status === 422) return "Проверьте заполнение полей: имя, email, роль и длину пароля.";
    if ([400, 409].includes(error.status) && typeof error.body.detail === "string") return error.body.detail;
  }
  return fallback;
}
