export interface ManualCoinsRules { manual_max_abs_amount: number; manual_reason_min_length: number }

export function validManualCoins(amount: string, reason: string, direction: "credit" | "debit", rules: ManualCoinsRules | undefined, available: number | undefined): boolean {
  const value = Number(amount);
  const note = reason.trim();
  return Boolean(rules && available !== undefined && Number.isSafeInteger(value) && value > 0
    && value <= rules.manual_max_abs_amount && (direction !== "debit" || value <= available)
    && note.length >= Math.max(1, rules.manual_reason_min_length) && note.length <= 500);
}
