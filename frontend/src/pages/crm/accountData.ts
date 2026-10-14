/**
 * The driver's data an appeal carries over from his account in the Диспетчерская: what the
 * operator copied there and whether the appeal's fields hold this account's phone, ВУ, ID and link.
 */
export interface AccountData { id: string; phone: string; license: string }
export type CopyKind = "phone" | "license" | "id" | "link";

/** Copy buttons announce what they put on the clipboard: they raise no «copy» event of their own. */
export const COPY_EVENT = "work-sites-copy";

export const digits = (value: string) => value.replace(/\D/g, "");
/** A ВУ the way the server compares it: no spaces, upper case. */
export const plainLicense = (value: string) => value.replace(/\s+/g, "").toUpperCase();
/** One phone however it is written: +7, 8 or spaces before the last ten digits. */
const samePhone = (value: string, phone: string) => {
  const typed = digits(value);
  return typed.length >= 10 && typed.length <= 12 && typed.slice(-10) === digits(phone).slice(-10);
};

/** What a copied piece of text is for the account; "" when it is none of its data. */
export function copyKind(text: string, account: AccountData): CopyKind | "" {
  const value = text.trim(), id = account.id.toLowerCase();
  if (!value) return "";
  if (value.toLowerCase() === id) return "id";
  if (value.toLowerCase().includes(`contractors/${id}`)) return "link";
  if (/^[+\d\s()-]+$/.test(value) && samePhone(value, account.phone)) return "phone";
  return account.license && plainLicense(value) === plainLicense(account.license) ? "license" : "";
}

/**
 * How a field of the appeal holds the account's data: "true", "false" when it holds something
 * else, "" while empty. «ID водителя» with the whole link in it is "link".
 */
export function fieldMatch(field: "phone" | "license_number" | "driver_id", value: string, account?: AccountData) {
  const typed = value.trim();
  if (!typed || !account) return "";
  if (field === "phone") return String(samePhone(typed, account.phone));
  if (field === "license_number") return String(plainLicense(typed) === plainLicense(account.license));
  const id = account.id.toLowerCase();
  return typed.toLowerCase() === id ? "true" : typed.toLowerCase().includes(id) ? "link" : "false";
}

/** A request's comment names the account by its link: "ok", "missing", or "" while it is empty. */
export function linkMatch(comment: string, account?: AccountData) {
  if (!comment.trim() || !account) return "";
  return comment.toLowerCase().includes(account.id.toLowerCase()) ? "ok" : "missing";
}

/** Copies the way the operator would and tells the work sites what was copied. */
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { return false; }
  window.dispatchEvent(new CustomEvent(COPY_EVENT, { detail: text }));
  return true;
}

/** What the operator copied with the keyboard or the menu: the selection inside a field or on the page. */
export function selectedText() {
  const field = document.activeElement;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
  return window.getSelection()?.toString() ?? "";
}
