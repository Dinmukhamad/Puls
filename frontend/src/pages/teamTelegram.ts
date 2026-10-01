import type { TelegramStatus } from "../api/telegram";

export interface TeamTelegramDraft {
  value: string;
  original: string;
  clearBinding?: boolean;
}

export function normalizeTelegramUsername(value: string): string {
  const trimmed = value.trim();
  const url = trimmed.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{4,31})\/?$/);
  return (url?.[1] ?? trimmed.replace(/^@/, "")).toLowerCase();
}

export function loadTelegramDraft(draft: TeamTelegramDraft | null, status: TelegramStatus): TeamTelegramDraft {
  // A background status refresh must not replace an unsaved edit or its baseline.
  if (draft) return draft;
  const username = normalizeTelegramUsername(status.pending_username ?? status.username ?? "");
  return { value: username, original: username };
}

export function telegramUpdate(draft: TeamTelegramDraft | null, ownAccount: boolean): { telegram_username?: string | null } {
  // Omission preserves the binding, including while status is still loading.
  if (!draft || ownAccount) return {};
  if (draft.clearBinding) return { telegram_username: null };
  const username = normalizeTelegramUsername(draft.value);
  return username === draft.original ? {} : { telegram_username: username || null };
}
