import { buildQuery, request } from "./client";
import type { Page, Role, TransactionOut } from "./types";

export type WalletKind = "" | "accrual" | "writeoff" | "refund" | "purchase";
export interface WalletTransaction extends TransactionOut {
  user_id: number;
  full_name: string;
  author_role: Role | null;
  is_system: boolean;
}
export interface WalletOperator {
  user_id: number;
  full_name: string;
  group_name: string | null;
  is_active: boolean;
  balance: number;
  reserved: number;
  available: number;
}
export interface WalletReport {
  summary: { balance: number; reserved: number; available: number; earned_total: number; awarded: number; spent: number; refunded: number; accounts: number };
  history: Page<WalletTransaction>;
}
export interface WalletGroup { group_id: number; name: string; operators_count: number }
export type CoinRecipients = { user_ids: number[] } | { group_ids: number[] } | { all_operators: true };
export interface ManualCoinsPreview {
  count: number;
  eligible_count: number;
  insufficient_count: number;
  balance: number;
  reserved: number;
  available: number;
  min_available: number | null;
  amount: number;
  total_amount: number;
  can_submit: boolean;
  selection_token: string;
}
export type ManualCoinsBatch = CoinRecipients & { amount: number; reason: string; request_id: string; selection_token: string };
export interface ManualCoinsResult { count: number; total_amount: number; transaction_ids: number[] }
export const walletApi = {
  report: (administrative: boolean, params: { page: number; kind: WalletKind; date_from: string; date_to: string; user_id?: number }) =>
    request<WalletReport>(`/api/v1/${administrative ? "admin" : "me"}/wallet${buildQuery({ ...params, size: 20 })}`),
  operators: (params: { search?: string; page?: number; size?: number; user_id?: number }, signal?: AbortSignal) =>
    request<Page<WalletOperator>>(`/api/v1/admin/wallet/operators${buildQuery(params)}`, { signal }),
  groups: (signal?: AbortSignal) => request<WalletGroup[]>("/api/v1/admin/wallet/groups", { signal }),
  preview: (recipients: CoinRecipients, amount: number, signal?: AbortSignal) =>
    request<ManualCoinsPreview>("/api/v1/admin/coins/manual/bulk/preview", { method: "POST", json: { ...recipients, amount }, signal }),
  manualBatch: (command: ManualCoinsBatch) =>
    request<ManualCoinsResult>("/api/v1/admin/coins/manual/bulk/apply", { method: "POST", json: command }),
};

export function canManageCoins(role?: Role): boolean {
  return role === "supervisor" || role === "head" || role === "admin";
}

export function walletAuthor(tx: Pick<WalletTransaction, "author_name" | "is_system" | "tx_type">): string {
  if (tx.author_name) return tx.author_name;
  if (tx.is_system === false || ["manual_credit", "manual_debit", "driver_gratitude"].includes(tx.tx_type)) return "Автор недоступен";
  return "Система";
}
