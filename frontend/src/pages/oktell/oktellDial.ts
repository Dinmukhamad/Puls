/**
 * A driver is called back through his park's line: the park's code, then his number from 7 without
 * «+», e.g. 0880 7 707 505 36 36 for iTaxi. The server applies the same rules; these give the hint
 * while the operator types.
 */
export type DialCheck =
  | { ok: true; digits: string; code: string; park: string; phone: string }
  | { ok: false; hint: string };

const PHONE_DIGITS = 11;
const digitsLeft = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "цифра" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "цифры" : "цифр"}`;

/** What was typed reads as a number to dial rather than a colleague's name or extension. */
export function looksLikeNumber(input: string, extensions: string[] = []) {
  const text = input.trim(), digits = text.replace(/\D/g, "");
  return /^[\d\s+()-]+$/.test(text) && digits.length >= 4 && !extensions.includes(digits);
}

export function checkDial(input: string, parks: Record<string, string>): DialCheck {
  const digits = input.replace(/[\s-]/g, "");
  if (digits.includes("+")) return { ok: false, hint: "Номер набирается без «+»: код таксопарка, затем номер водителя с 7" };
  if (!/^\d+$/.test(digits)) return { ok: false, hint: "Наберите цифрами код таксопарка, затем номер водителя с 7" };
  const code = digits.slice(0, 4), phone = digits.slice(4), park = parks[code];
  if (!park) return { ok: false, hint: `Сначала наберите код таксопарка: ${Object.entries(parks).map(([key, name]) => `${name} — ${key}`).join(", ")}` };
  if (!phone) return { ok: false, hint: "После кода таксопарка наберите номер водителя с 7" };
  if (!phone.startsWith("7")) return { ok: false, hint: "После кода таксопарка номер водителя начинается с 7, без «+» и без 8" };
  if (phone.length < PHONE_DIGITS) return { ok: false, hint: `Наберите номер до конца: ещё ${digitsLeft(PHONE_DIGITS - phone.length)}` };
  if (phone.length > PHONE_DIGITS) return { ok: false, hint: "В номере водителя 11 цифр с 7 в начале, например 77075053636" };
  return { ok: true, digits, code, park, phone };
}

/** «0880 · 7 707 505 36 36» for a driver's line; anything else as it was dialled. */
export function formatNumber(number: string, parks: Record<string, string>) {
  const code = number.slice(0, 4), phone = number.slice(4);
  if (!parks[code] || phone.length !== PHONE_DIGITS || !/^\d+$/.test(number)) return number;
  return `${code} · ${phone[0]} ${phone.slice(1, 4)} ${phone.slice(4, 7)} ${phone.slice(7, 9)} ${phone.slice(9)}`;
}
