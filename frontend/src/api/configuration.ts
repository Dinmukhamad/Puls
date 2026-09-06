import { ApiError, request } from "./client";
import type { ShopItemOut } from "./types";

export type DefinitionKind = "metrics" | "nominations" | "badges";
export type FieldValue = string | number | boolean | null | Record<string, string | number>;
export interface Definition {
  [key: string]: FieldValue;
  id: number;
  code: string;
  title: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}
export type DefinitionInput = Record<string, FieldValue>;
export interface Rules {
  points_per_coin: number;
  rank1_bonus: number;
  rank2_bonus: number;
  rank3_bonus: number;
  no_lateness_bonus: number;
  no_forbidden_sites_bonus: number;
  nomination_bonus_default: number;
  driver_gratitude_bonus: number;
  lateness_metric_code: string;
  forbidden_sites_metric_code: string;
  manual_max_abs_amount: number;
  manual_reason_min_length: number;
  discipline_requires_reported: boolean;
  rating_show_balance_to_operators: boolean;
  nomination_min_participants: number;
}
export type StoreItemInput = Omit<ShopItemOut, "id">;

const base = "/api/v1/admin/config";
export const configuration = {
  rules: () => request<Rules>(`${base}/rules`),
  updateRules: (json: Rules) => request<Rules>(`${base}/rules`, { method: "PUT", json }),
  definitions: (kind: DefinitionKind) => request<Definition[]>(`${base}/${kind}`),
  saveDefinition: (kind: DefinitionKind, json: DefinitionInput, id?: number) =>
    request<Definition>(`${base}/${kind}${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", json }),
  store: () => request<ShopItemOut[]>(`${base}/shop-items`),
  createItem: (json: StoreItemInput) => request<ShopItemOut>(`${base}/shop-items`, { method: "POST", json }),
  updateItem: (id: number, json: Partial<Omit<StoreItemInput, "code">>) =>
    request<ShopItemOut>(`${base}/shop-items/${id}`, { method: "PATCH", json }),
};

export function configurationError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "Сервер не отвечает. Проверьте соединение и попробуйте снова.";
    if (error.status === 403) return "Для изменения настроек нужны права руководителя или администратора.";
    if (error.status === 404) return "Запись больше не доступна. Обновите список.";
    if (error.status === 422) return "Проверьте обязательные поля, числовые значения и выбранные условия.";
    if ([400, 409].includes(error.status) && typeof error.body.detail === "string") return error.body.detail;
  }
  return "Не удалось выполнить действие. Попробуйте ещё раз.";
}
