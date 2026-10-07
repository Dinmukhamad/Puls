import { ApiError } from "../api/client";
import type { CoinRecipientIdentity, CoinRecipients, ManualCoinsBatch, ManualCoinsPreview } from "../api/wallet";

export type ManualCommand = { direction: "credit" | "debit"; batch: ManualCoinsBatch }
  | { direction: "gratitude"; operator: CoinRecipientIdentity; driverRef: string; requestId: string };
export interface ManualCoinsConfirmation {
  command: ManualCommand;
  recipients: CoinRecipientIdentity[];
  count: number;
  amount: number;
  totalAmount: number;
  reason: string;
  expiresAt?: string;
}

/** Copy the checked server snapshot; subsequent cache or form changes cannot alter it. */
export function confirmManualCoins(selection: CoinRecipients, reason: string, checked: ManualCoinsPreview, requestId: string): ManualCoinsConfirmation {
  if (!checked.can_submit || !checked.count || checked.recipients?.length !== checked.count
    || !Number.isSafeInteger(checked.amount) || !checked.amount
    || !Number.isSafeInteger(checked.total_amount) || checked.total_amount !== checked.amount * checked.count
    || new Set(checked.recipients.map((person) => person.user_id)).size !== checked.count) {
    throw new Error("Не удалось подтвердить получателей. Проверьте операцию ещё раз.");
  }
  return {
    command: { direction: checked.amount < 0 ? "debit" : "credit", batch: {
      ...structuredClone(selection), amount: checked.amount, reason: reason.trim(),
      request_id: requestId, selection_token: checked.selection_token,
    } },
    recipients: checked.recipients.map((person) => ({ user_id: person.user_id, full_name: person.full_name })),
    count: checked.count, amount: checked.amount, totalAmount: checked.total_amount,
    reason: reason.trim(), expiresAt: checked.expires_at,
  };
}

/** A committed result may be unknown after network/5xx failure; keep the same request. */
export function needsNewCoinCheck(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

const pending = new Map<number, ManualCoinsConfirmation>();
const key = (actorId: number) => `puls.manual-coins.pending.${actorId}`;

export function savePendingCoins(actorId: number, confirmation: ManualCoinsConfirmation): void {
  const snapshot = structuredClone(confirmation);
  pending.set(actorId, snapshot);
  try { sessionStorage.setItem(key(actorId), JSON.stringify(snapshot)); } catch { /* Memory still protects retries if storage is unavailable. */ }
}

export function clearPendingCoins(actorId: number): void {
  pending.delete(actorId);
  try { sessionStorage.removeItem(key(actorId)); } catch { /* Unavailable storage has no persistent entry. */ }
}

export function readPendingCoins(actorId: number): ManualCoinsConfirmation | null {
  let candidate: unknown = pending.get(actorId);
  try {
    const saved = sessionStorage.getItem(key(actorId));
    if (saved) candidate = JSON.parse(saved);
  } catch { /* A malformed or inaccessible entry must never send an operation. */ }
  if (!validPending(candidate)) return null;
  return structuredClone(candidate);
}

function validPending(value: unknown): value is ManualCoinsConfirmation {
  if (!value || typeof value !== "object") return false;
  const item = value as ManualCoinsConfirmation;
  if (!Number.isSafeInteger(item.count) || item.count < 1 || !Number.isSafeInteger(item.amount)
    || !Number.isSafeInteger(item.totalAmount) || item.totalAmount !== item.amount * item.count
    || typeof item.reason !== "string" || !Array.isArray(item.recipients) || item.recipients.length !== item.count
    || item.recipients.some((person) => !Number.isSafeInteger(person.user_id) || person.user_id <= 0 || typeof person.full_name !== "string")
    || !item.command) return false;
  const command = item.command;
  if (command.direction === "gratitude") return item.count === 1 && item.amount > 0 && item.amount <= 9999 && command.operator?.user_id === item.recipients[0].user_id
    && typeof command.driverRef === "string" && typeof command.requestId === "string" && command.requestId.length >= 16;
  if (command.direction !== "credit" && command.direction !== "debit") return false;
  const batch = command.batch;
  return Boolean(batch && batch.amount === item.amount && batch.reason === item.reason
    && (command.direction === "debit" ? item.amount < 0 : item.amount > 0) && Math.abs(item.amount) <= 9999
    && typeof batch.request_id === "string" && batch.request_id.length >= 16
    && typeof batch.selection_token === "string" && batch.selection_token.length > 0
    && ("all_operators" in batch ? batch.all_operators === true
      : "group_ids" in batch ? positiveIds(batch.group_ids) : "user_ids" in batch && positiveIds(batch.user_ids)));
}

function positiveIds(ids: unknown): boolean {
  return Array.isArray(ids) && ids.length > 0 && ids.every((id) => Number.isSafeInteger(id) && id > 0);
}
