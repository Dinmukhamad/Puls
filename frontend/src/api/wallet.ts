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
export const walletApi = {
  report: (administrative: boolean, params: { page: number; kind: WalletKind; date_from: string; date_to: string; user_id?: number }) =>
    request<WalletReport>(`/api/v1/${administrative ? "admin" : "me"}/wallet${buildQuery({ ...params, size: 20 })}`),
  operators: (params: { search?: string; page?: number; size?: number; user_id?: number }, signal?: AbortSignal) =>
    request<Page<WalletOperator>>(`/api/v1/admin/wallet/operators${buildQuery(params)}`, { signal }),
};

export function canManageCoins(role?: Role): boolean {
  return role === "supervisor" || role === "head" || role === "admin";
}

export function walletAuthor(tx: Pick<WalletTransaction, "author_name" | "is_system" | "tx_type">): string {
  if (tx.author_name) return tx.author_name;
  if (tx.is_system === false || ["manual_credit", "manual_debit", "driver_gratitude"].includes(tx.tx_type)) return "Автор недоступен";
  return "Система";
}
