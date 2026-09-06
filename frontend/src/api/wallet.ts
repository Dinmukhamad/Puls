import { buildQuery, request } from "./client";
import type { Page, TransactionOut } from "./types";

export type WalletKind = "" | "accrual" | "writeoff" | "refund" | "purchase";
export interface WalletTransaction extends TransactionOut { user_id: number; full_name: string }
export interface WalletReport {
  summary: { balance: number; reserved: number; available: number; awarded: number; spent: number; refunded: number; accounts: number };
  history: Page<WalletTransaction>;
}
export const walletApi = {
  report: (administrative: boolean, params: { page: number; kind: WalletKind; date_from: string; date_to: string; user_id?: number }) =>
    request<WalletReport>(`/api/v1/${administrative ? "admin" : "me"}/wallet${buildQuery({ ...params, size: 20 })}`),
};
