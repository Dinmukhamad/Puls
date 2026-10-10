/** Имя окна телефона: по нему Puls внутри рамки понимает, что открыт в телефоне симулятора. */
export const PHONE_FRAME_NAME = "puls-phone";

/**
 * Телефон показывается на компьютере: мышь и окно, где он помещается.
 * Телефоны и планшеты открывают симулятор во весь экран, как раньше.
 */
export const PHONE_STAGE_QUERY = "(hover: hover) and (pointer: fine) and (min-width: 900px) and (min-height: 600px)";

/** Высота экрана в точках CSS, как у iPhone 14. Ниже минимальной высоты телефон уменьшается целиком. */
export const PHONE_SCREEN = { height: 844, minHeight: 640 };
/** Чёрная рамка вокруг экрана и металлический обод (как в driver-phone.css), поле от краёв окна. */
export const PHONE_BEZEL = 12, PHONE_RIM = 3, PHONE_MARGIN = 24;

/** Высота экрана и масштаб телефона для окна заданной высоты. */
export function phoneFit(viewportHeight: number): { screen: number; scale: number } {
  const frame = 2 * (PHONE_BEZEL + PHONE_RIM), room = viewportHeight - 2 * PHONE_MARGIN;
  const screen = Math.min(PHONE_SCREEN.height, Math.max(PHONE_SCREEN.minHeight, room - frame));
  return { screen, scale: Math.min(1, room / (screen + frame)) };
}

/** В телефоне живёт только приложение водителя; остальные разделы открываются в самом Puls. */
export function staysInPhone(pathname: string): boolean {
  return pathname === "/simulator";
}

const localPath = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");

/** Ссылка внутри телефона, которая ведёт в другой раздел Puls: путь для страницы с телефоном. */
export function phoneExit(href: string, origin: string): string | null {
  const url = new URL(href, origin);
  return url.origin === origin && !staysInPhone(url.pathname) ? url.pathname + url.search + url.hash : null;
}

/** Подсказка оператору из фотоконтроля: что сейчас видит водитель и что ему сказать. */
export interface PhoneCoach { title: string; body: [string, string][] }

export type PhoneMessage =
  | { type: "puls:phone-location"; path: string }
  | { type: "puls:phone-leave"; path: string }
  | { type: "puls:phone-signed-out" }
  | { type: "puls:phone-colors"; top: string; bottom: string }
  | { type: "puls:phone-coach"; coach: PhoneCoach | null };

const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit;

function readCoach(value: unknown): PhoneCoach | null {
  if (!value || typeof value !== "object") return null;
  const { title, body } = value as Record<string, unknown>;
  if (!text(title, 200) || !Array.isArray(body) || body.length > 8) return null;
  const rows = body.filter((row): row is [string, string] => Array.isArray(row) && row.length === 2 && text(row[0], 100) && text(row[1], 1000));
  return rows.length === body.length ? { title, body: rows } : null;
}

/** Сообщение из телефона. Чужие и испорченные сообщения отбрасываются. */
export function readPhoneMessage(data: unknown): PhoneMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case "puls:phone-location":
      return localPath(message.path) && staysInPhone(new URL(message.path, "http://puls").pathname) ? { type: message.type, path: message.path } : null;
    case "puls:phone-leave":
      return localPath(message.path) ? { type: message.type, path: message.path } : null;
    case "puls:phone-signed-out":
      return { type: message.type };
    case "puls:phone-colors":
      return parseColor(message.top) && parseColor(message.bottom) ? { type: message.type, top: message.top as string, bottom: message.bottom as string } : null;
    case "puls:phone-coach": {
      if (message.coach === null) return { type: message.type, coach: null };
      const coach = readCoach(message.coach);
      return coach ? { type: message.type, coach } : null;
    }
    default:
      return null;
  }
}

/** Цвет в том виде, в каком его отдаёт getComputedStyle: rgb() или rgba(). */
export function parseColor(value: unknown): { red: number; green: number; blue: number; alpha: number } | null {
  if (typeof value !== "string") return null;
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(value);
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1);
  return { red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]), alpha };
}

/** Строка состояния тёмная на светлом приложении и светлая на тёмном, как на настоящем телефоне. */
export function inkFor(color: string): "light" | "dark" {
  const parsed = parseColor(color);
  // Полупрозрачный слой лежит поверх чёрного экрана и читается как тёмный.
  if (!parsed || parsed.alpha < 0.5) return "light";
  const channel = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = 0.2126 * channel(parsed.red) + 0.7152 * channel(parsed.green) + 0.0722 * channel(parsed.blue);
  // Порог, при котором белый и чёрный текст контрастны одинаково.
  return luminance > 0.179 ? "dark" : "light";
}
