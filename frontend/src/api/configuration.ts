import { ApiError, request } from "./client";
import type { ShopItemOut } from "./types";

export type DefinitionKind = "metrics" | "nominations" | "badges";
/** A metric's threshold: from this value up the metric gives these points (docs/CHANNELS.md). */
export interface MetricBand { from: number; points: number }
export type FieldValue = string | number | boolean | null | Record<string, string | number>;
/** A value of a definition: a field, or a metric's thresholds. */
export type DefinitionValue = FieldValue | MetricBand[];
export interface Definition {
  [key: string]: DefinitionValue;
  id: number;
  code: string;
  title: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}
export type DefinitionInput = Record<string, DefinitionValue>;
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
  /** Places and nominations: every week or once a month (docs/COIN_ECONOMY.md). */
  contest_period: "week" | "month";
  lateness_fine: number;
  forbidden_site_fine: number;
  gratitude_monthly_limit: number;
  manual_monthly_limit: number;
  coin_rate_tenge: number;
  shop_monthly_budget_tenge: number;
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
    if ([400, 409].includes(error.status) && typeof error.body.detail === "string") {
      const detail = error.body.detail;
      if (detail === "Заполните название и код") return "Заполните название и выберите обязательные условия.";
      if (detail === "Название или код слишком длинные") return "Название слишком длинное. Сократите его и попробуйте снова.";
      if (detail === "Этот код уже используется. Выберите другой код.") return "Не удалось добавить запись. Закройте форму и попробуйте создать её снова.";
      if (detail === "Коды level_ зарезервированы для достижений за уровни") return "Достижения за уровни настраиваются в разделе «Уровни».";
      return detail;
    }
  }
  return "Не удалось выполнить действие. Попробуйте ещё раз.";
}
